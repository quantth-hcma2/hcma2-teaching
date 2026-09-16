import test from 'node:test';
import assert from 'node:assert/strict';
import { timerSeconds, timerPatch, minutesToSeconds, createExpirySound } from '../../group-classroom-timer.mjs';
const start = new Date(100000), now = 110000;
const base = {durationSec:900,startedAt:start,pausedRemainingSec:null,status:'open',ownerId:'teacher'};
test('running, paused, unstarted and expired use the shared persisted model',()=>{
  assert.equal(timerSeconds(base,now),890);
  assert.equal(timerSeconds({...base,startedAt:null,pausedRemainingSec:42},now),42);
  assert.equal(timerSeconds({...base,startedAt:null},now),900);
  assert.equal(timerSeconds(base,1000000),0);
});
for(const [value,expected] of [['5',300],['0.5',30],['1440',86400]]) test('valid minutes '+value,()=>assert.equal(minutesToSeconds(value),expected));
for(const value of ['',0,-1,'x',Infinity,1441,0.001]) test('invalid minutes '+value,()=>assert.throws(()=>minutesToSeconds(value)));
test('start and reset use chosen minutes without modifying lifecycle/content',()=>{
  assert.deepEqual(timerPatch(base,'start',300,now,'server'),{durationSec:300,startedAt:'server',pausedRemainingSec:null,updatedAt:'server'});
  assert.deepEqual(timerPatch(base,'reset',300,now,'server'),{durationSec:300,startedAt:null,pausedRemainingSec:300,updatedAt:'server'});
});
test('pause freezes remaining; resume starts a fresh interval of that length',()=>{
  const paused={...base,...timerPatch(base,'pause',null,now,new Date(now))};
  assert.equal(timerSeconds(paused,now+500000),890);
  const resumed={...paused,...timerPatch(paused,'resume',null,now+500000,new Date(now+500000))};
  assert.equal(timerSeconds(resumed,now+503000),887);
  assert.equal(resumed.status,'open');
});
test('duplicate pause/resume is a no-op; expired timer can restart',()=>{
  assert.equal(timerPatch({...base,startedAt:null},'pause',null,now,'stamp'),null);
  assert.equal(timerPatch(base,'resume',null,now,'stamp'),null);
  assert.equal(timerPatch({...base,startedAt:null,pausedRemainingSec:0},'resume',null,now,'stamp'),null);
  const restarted={...base,...timerPatch(base,'start',300,1000000,new Date(1000000))};
  assert.equal(timerSeconds(restarted,1000000),300);
});
test('+/- one minute preserve running/paused state and clamp bounds',()=>{
  assert.equal(timerPatch(base,'add',null,now,'stamp').durationSec,950);
  assert.equal(timerPatch(base,'subtract',null,now,'stamp').durationSec,830);
  assert.equal(timerPatch({...base,startedAt:null,pausedRemainingSec:30},'subtract',null,now,'stamp').pausedRemainingSec,0);
  assert.equal(timerPatch({...base,startedAt:null,pausedRemainingSec:86400},'add',null,now,'stamp').durationSec,86400);
});
test('activated sessions fail closed',()=>assert.throws(()=>timerPatch({...base,configRevision:0},'start',300,now,'stamp')));
