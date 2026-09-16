import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,runTransaction,serverTimestamp,onSnapshot} from 'firebase/firestore';
import {writeTimer} from '../../group-classroom-timer.mjs';
let env;
const port=Number(process.env.CLASSROOM_EMULATOR_PORT||8298);
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-classroom-presentation',firestore:{host:'127.0.0.1',port,rules:readFileSync(new URL('../../firestore.rules.production-candidate',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
const activity={ownerId:'teacher',title:'Test only',instructions:'Keep me',groupCount:2,durationSec:900,startedAt:null,pausedRemainingSec:null,status:'open',allowText:true,allowPhoto:true,allowFile:true,joinCode:'DEMOAA'};
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const [uid,role,status] of [['teacher','teacher','active'],['other','teacher','active'],['suspended','teacher','suspended'],['admin','admin','active']])await setDoc(doc(db,'users',uid),{role,status});
    await setDoc(doc(db,'groupActivities','timer-demo'),activity);
    await setDoc(doc(db,'groupActivities','timer-demo','members','student'),{group:1,joinCode:'DEMOAA',joinedAt:new Date()});
    await setDoc(doc(db,'groupActivities','timer-demo','topics','1'),{group:1,topic:'Keep topic'});
  });
});
function client(uid='teacher'){const db=env.authenticatedContext(uid).firestore();return {db,ref:doc(db,'groupActivities','timer-demo'),runTransaction,serverTimestamp};}
const valid=()=>({durationSec:300,startedAt:serverTimestamp(),pausedRemainingSec:null,updatedAt:serverTimestamp()});
test('real transactions: set/start/pause/resume/reset/+1/-1, preserve all non-timer fields',async()=>{
  const c=client();
  for(const [action,seconds] of [['reset',300],['start',300],['pause'],['resume'],['add'],['subtract'],['reset',120]])await assertSucceeds(writeTimer(c,action,seconds));
  const saved=(await getDoc(c.ref)).data();
  for(const key of Object.keys(activity).filter(k=>!['durationSec','startedAt','pausedRemainingSec'].includes(k)))assert.deepEqual(saved[key],activity[key]);
  assert.equal(saved.durationSec,120);assert.equal(saved.pausedRemainingSec,120);assert.equal(saved.startedAt,null);
  assert.equal((await getDoc(doc(c.db,'groupActivities','timer-demo','members','student'))).data().group,1);
  assert.equal((await getDoc(doc(c.db,'groupActivities','timer-demo','topics','1'))).data().topic,'Keep topic');
});
test('admin can adjust timer',()=>assertSucceeds(updateDoc(client('admin').ref,valid())));
test('concurrent teacher/admin increments use transactions without losing updates',async()=>{
  const teacher=client(),admin=client('admin');
  await writeTimer(teacher,'reset',300);
  await Promise.all([writeTimer(teacher,'add'),writeTimer(admin,'add')]);
  assert.equal((await getDoc(teacher.ref)).data().pausedRemainingSec,420);
});
test('student listener receives persisted duration/start/pause updates',async()=>{
  const student=client('student');
  const observed=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{stop();reject(Error('listener timeout'));},5000);
    const stop=onSnapshot(student.ref,s=>{if(s.data().pausedRemainingSec===180){clearTimeout(timeout);stop();resolve(s.data());}},reject);
  });
  await writeTimer(client(),'reset',180);
  const saved=await observed;assert.equal(saved.durationSec,180);assert.equal(saved.startedAt,null);assert.equal(saved.status,'open');
});
for(const uid of ['student','other','suspended'])test('reject duration writer '+uid,()=>assertFails(updateDoc(client(uid).ref,valid())));
test('reject unauthenticated writer',()=>assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(),'groupActivities','timer-demo'),valid())));
for(const value of [-1,86401,1.5,'300',null])test('reject invalid duration '+value,()=>assertFails(updateDoc(client().ref,{...valid(),durationSec:value})));
for(const extra of [{status:'closed'},{instructions:'changed'},{ownerId:'other'},{groupCount:3},{configRevision:0},{arbitrary:1}])test('reject timer write with '+Object.keys(extra)[0],()=>assertFails(updateDoc(client().ref,{...valid(),...extra})));
test('reject fabricated start and invalid paused remainder on duration write',async()=>{
  await assertFails(updateDoc(client().ref,{...valid(),startedAt:new Date(0)}));
  await assertFails(updateDoc(client().ref,{...valid(),startedAt:null,pausedRemainingSec:-1}));
});
test('activated session duration stays denied',async()=>{
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'groupActivities','timer-demo'),{configRevision:0}));
  await assertFails(updateDoc(client().ref,valid()));
});
test('expiry/zero does not close activity or prevent a valid student submission; restart works',async()=>{
  const c=client();await assertSucceeds(updateDoc(c.ref,{...valid(),durationSec:0}));
  const db=env.authenticatedContext('student').firestore();
  await assertSucceeds(setDoc(doc(db,'groupActivities','timer-demo','notes','after-expiry'),{group:1,text:'Still allowed',participantId:'student',createdAt:serverTimestamp()}));
  await assertSucceeds(writeTimer(c,'start',300));
  assert.equal((await getDoc(c.ref)).data().status,'open');
  assert.equal((await getDoc(doc(c.db,'groupActivities','timer-demo','notes','after-expiry'))).data().text,'Still allowed');
});
