import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createExpirySound,createTimerAudioObserver,TIMER_AUDIO_ASSET_URL} from '../../group-classroom-timer.mjs';
function fixture(){const events=[];let media;const sound=createExpirySound(()=>{media={currentTime:0,paused:true,muted:false,ended:false,play(){this.paused=false;if(!this.muted)events.push({offset:this.currentTime});return Promise.resolve()},pause(){this.paused=true},removeAttribute(){},load(){}};return media});const observe=createTimerAudioObserver(sound);let now=100000,a={durationSec:11,startedAt:new Date(100000)};return{events,get media(){return media},sound,async enable(){await sound.enable(true)},tick(seconds,patch={},visible=true){now+=seconds*1000;a={...a,...patch};const remain=a.startedAt?Math.max(0,Math.round((+a.startedAt+a.durationSec*1000-now)/1000)):a.pausedRemainingSec;observe(a,remain,now,visible)},at(patch){this.tick(0,patch)},get now(){return now}}}

test('exact combined MP3 hash, ASCII production URL, and both old assets fully removed',()=>{
  assert.ok(TIMER_AUDIO_ASSET_URL.endsWith('/assets/audio/timer-expiry-combined.mp3'));
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../assets/audio/timer-expiry-combined.mp3',import.meta.url))).digest('hex'),'d8f56754fae95a46278e779e8d0675d53dad1fe2a1536ce69bafa9d4cae106ac');
  assert.equal(existsSync(new URL('../../assets/audio/countdown-10s.mp3',import.meta.url)),false);
  assert.equal(existsSync(new URL('../../assets/audio/timer-expired-alarm.mp3',import.meta.url)),false);
  const src=readFileSync(new URL('../../group-classroom-timer.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/countdown-10s\.mp3/);
  assert.doesNotMatch(src,/timer-expired-alarm\.mp3/);
  assert.doesNotMatch(src,/TIMER_AUDIO_ASSETS\b/);
});

test('one media element only: enable() never creates a second Audio instance',async()=>{
  let created=0;
  const sound=createExpirySound(()=>{created++;return{currentTime:0,paused:true,muted:false,play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true},removeAttribute(){},load(){}}});
  await sound.enable(true);
  await sound.enable(true);
  assert.equal(created,1);
});

test('single play at the 10s threshold; repeated identical observations never duplicate',async()=>{
  const f=fixture();await f.enable();
  f.tick(0);f.tick(.75);
  assert.deepEqual(f.events,[{offset:.25}]);
  for(let i=0;i<3;i++)f.tick(0);
  assert.equal(f.events.length,1);
});

test('late observer entering below 10s seeks into the track instead of replaying from the start',async()=>{
  const f=fixture();await f.enable();
  f.tick(4);
  assert.equal(f.events.length,1);
  assert.ok(Math.abs(f.events[0].offset-3.5)<0.01);
});

test('no stop/reset/replace at 00:00; the same play continues untouched through and past zero',async()=>{
  const f=fixture();await f.enable();
  f.tick(0);f.tick(.75);
  assert.equal(f.events.length,1);
  for(let i=0;i<15;i++){f.tick(1);f.tick(0)}
  assert.equal(f.events.length,1);
  assert.equal(f.media.paused,false);
});

test('media reaching its own natural end is never touched by the controller',async()=>{
  const f=fixture();await f.enable();
  f.tick(1);
  assert.equal(f.events.length,1);
  f.media.paused=true;f.media.ended=true;
  for(let i=0;i<5;i++)f.tick(2);
  assert.equal(f.events.length,1);
  assert.equal(f.media.paused,true);
});

test('pause stops playback; resume plays a fresh cycle seeked to the remaining position',async()=>{
  const f=fixture();await f.enable();
  f.tick(2);
  assert.equal(f.events.length,1);
  f.at({startedAt:null,pausedRemainingSec:9});
  assert.ok(f.media.paused);
  f.tick(5);
  f.at({startedAt:new Date(f.now),durationSec:9});
  assert.equal(f.events.length,2);
  assert.equal(f.events[1].offset,1.5);
});

test('reset/restart grants a fresh sequence',async()=>{
  const f=fixture();await f.enable();
  f.tick(1);
  assert.equal(f.events.length,1);
  f.at({startedAt:null,pausedRemainingSec:11});
  f.at({startedAt:new Date(f.now),durationSec:11});
  f.tick(1);
  assert.equal(f.events.length,2);
});

test('plus/minus reseeks without a replay storm; dropping straight to zero duration stays silent',async()=>{
  const f=fixture();await f.enable();
  f.tick(2);
  assert.equal(f.events.length,1);
  f.at({startedAt:new Date(f.now),durationSec:69});
  assert.ok(f.media.paused);
  f.at({startedAt:new Date(f.now),durationSec:9});
  f.tick(1);
  assert.equal(f.events.length,2);
  assert.equal(f.events[1].offset,1.5);
  f.at({durationSec:0});
  assert.equal(f.events.length,2);
});

test('expired reload and clock rollback stay silent',async()=>{
  const f=fixture();await f.enable();
  f.tick(20);
  f.tick(-15);
  f.tick(10);
  assert.equal(f.events.length,0);
});

test('reload/open past expiry stays silent even if audio is turned ON afterwards',async()=>{
  const f=fixture();
  f.tick(20);
  assert.equal(f.events.length,0);
  await f.enable();
  f.tick(1);
  assert.equal(f.events.length,0);
});

test('OFF then ON again after the tail is already in flight does not restart the track from zero',async()=>{
  const f=fixture();await f.enable();
  f.tick(1);
  assert.equal(f.events.length,1);
  for(let i=0;i<12;i++)f.tick(1);
  assert.equal(f.events.length,1);
  await f.sound.enable(false);
  assert.ok(f.media.paused);
  await f.enable();
  f.tick(1);
  assert.equal(f.events.length,1);
});

test('ON inside the countdown window synchronizes; OFF stops the alarm tail immediately',async()=>{
  const f=fixture();
  f.tick(2);
  assert.equal(f.events.length,0);
  await f.enable();
  f.tick(1);
  assert.equal(f.events.length,1);
  for(let i=0;i<10;i++)f.tick(1);
  assert.equal(f.media.paused,false);
  await f.sound.enable(false);
  assert.ok(f.media.paused);
});

test('rejected play promises and seek failure cannot break the timer or storm',async()=>{
  let count=0;
  const sound=createExpirySound(()=>({play(){count++;return Promise.reject(Error('blocked'))},pause(){},set currentTime(v){throw Error('seek')},removeAttribute(){},load(){}}));
  await sound.enable(true);
  for(let i=0;i<20;i++)sound.start(i/4);
  sound.dispose();
  assert.equal(count,1);
  await new Promise(r=>setTimeout(r,0));
});

test('cleanup stops the asset and prevents new playback',async()=>{
  const f=fixture();await f.enable();
  f.tick(1);
  f.sound.dispose();
  f.tick(1);
  await f.enable();
  assert.equal(f.events.length,1);
  assert.ok(f.media.paused);
});

test('no oscillators, no two-asset references; timer transaction prefix, index, presentation, rules and schema unchanged',()=>{
  const root=new URL('../../',import.meta.url);
  const before=name=>execFileSync('git',['show','9b7d7b6737af680167e46a1da1afd9e4d1362385:'+name],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
  const read=name=>readFileSync(new URL(name,root),'utf8').replaceAll('\r\n','\n');
  assert.equal(read('group-classroom-timer.mjs').split('// Exact user assets')[0],before('group-classroom-timer.mjs').split('// Audio is unlocked')[0]);
  assert.doesNotMatch(read('group-classroom-timer.mjs'),/createOscillator/);
  for(const name of ['group-classroom-presentation.mjs','firestore.rules','firestore.rules.production-candidate','firestore.indexes.json'])assert.equal(read(name),before(name));
  // GATE 4C-C.2 RECONCILIATION: index.html is compared separately, with stripItem4() applied to
  // both sides first — see the identical helper (and its full rationale) in
  // test/classroom-presentation/boundaries.test.mjs. This keeps the byte-equality guard on
  // every Classroom-Presentation/Timer/schema-relevant part of index.html while excluding only
  // the three narrow, separately-approved Item 4 participant-panel insertion points.
  assert.equal(stripItem4(read('index.html')),stripItem4(before('index.html')));
});
function stripItem4(source){
  source=source.replace(' class="kn-pf-compact"','');
  const cssStart=source.indexOf('/* GATE 4C-B: Knowledge participant Compact card only');
  if(cssStart!==-1){
    const cssEnd=source.indexOf('\n\n/* Badges */',cssStart);
    source=source.slice(0,cssStart)+source.slice(cssEnd+1);
  }
  source=source.replaceAll('knowledgeRenderParticipantsCompact','knowledgeRenderParticipants');
  const aStart=source.indexOf('const participantCounts=new Map();\n');
  const aEnd=source.indexOf('  const openerUid=STATE.user.uid;',aStart);
  if(aStart!==-1&&aEnd!==-1)source=source.slice(0,aStart+'const participantCounts=new Map();\n'.length)+source.slice(aEnd);
  const closeAnchor='    knowledgeRenderParticipants();\n  }\n';
  const closePos=source.indexOf(closeAnchor);
  const bStart=closePos!==-1?closePos+closeAnchor.length:-1;
  const bEnd=source.indexOf('function knowledgeSpreadsheetSafe(',bStart);
  if(bStart!==-1&&bEnd!==-1)source=source.slice(0,bStart)+source.slice(bEnd);
  return source;
}
