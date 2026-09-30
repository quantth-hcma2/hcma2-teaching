import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,serverTimestamp,updateDoc} from 'firebase/firestore';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8412';
const require=createRequire(import.meta.url);
const admin=require(path.resolve(here,'../../.local-tools/firebase-admin-diagnostic/node_modules/firebase-admin'));
const app=admin.initializeApp({projectId:'demo-candidate-4a-post-4r'},'c7-family-isolation');
const adb=admin.firestore(app);
const wrap=body=>`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`;
const rules={
  time:wrap(`match /activities/{id} { allow update: if request.auth.uid == resource.data.ownerId &&
    request.resource.data.deletedAt == request.time; }`),
  member:wrap(`match /activities/{id}/photos/{photoId} { allow get: if
    request.auth.uid == get(/databases/$(database)/documents/activities/$(id)).data.ownerId ||
    (get(/databases/$(database)/documents/activities/$(id)).data.status == 'open' &&
     exists(/databases/$(database)/documents/activities/$(id)/members/$(request.auth.uid)) &&
     get(/databases/$(database)/documents/activities/$(id)/members/$(request.auth.uid)).data.group == resource.data.group); }`),
  memberNegation:wrap(`match /activities/{id}/photos/{photoId} { allow get: if
    !exists(/databases/$(database)/documents/activities/$(id)/members/$(request.auth.uid)); }`),
  memberUnsafe:wrap(`match /activities/{id}/photos/{photoId} { allow get: if
    get(/databases/$(database)/documents/activities/$(id)/members/$(request.auth.uid)).data.group == resource.data.group; }`),
  restore:wrap(`match /activities/{id} { allow update: if request.auth.uid == resource.data.ownerId &&
    resource.data.status == 'deleted' &&
    resource.data.statusBeforeDelete in ['draft','open','closed'] &&
    request.resource.data.status == resource.data.statusBeforeDelete; }`)
};

async function runCase(family,label,seed,operation,expected){
  const env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
    firestore:{rules:rules[family],host:'127.0.0.1',port:8412}});
  try{
    await env.clearFirestore();
    await seed();
    const db=env.authenticatedContext(family==='member'?'foreign':'owner',
      {firebase:{sign_in_provider:'password'}}).firestore();
    let error;
    try{await operation(db);}catch(e){error=e;}
    const actual=error?.code||'allow';
    assert.equal(actual,expected);
    const message=error?.message||'';
    if(family==='memberUnsafe')assert.match(message,/Null value error/i);
    else assert.doesNotMatch(message,/Null value error|maximum of 1000 expressions|too many document access calls/i);
    console.log('C7_CASE',JSON.stringify({family,label,expected,actual,message}));
    const coverage=await (await fetch('http://127.0.0.1:8412/emulator/v1/projects/demo-candidate-4a-post-4r:ruleCoverage')).json();
    const values=[];
    const visit=nodes=>{for(const node of nodes||[]){for(const v of node.values||[])values.push(v.value);
      visit(node.children);}};
    visit(coverage.report);
    console.log('C7_COVERAGE',JSON.stringify({family,label,
      trueValues:values.filter(v=>v?.boolValue===true).length,
      falseValues:values.filter(v=>v?.boolValue===false).length,
      errorValues:values.filter(v=>Object.keys(v||{}).some(k=>/error/i.test(k))).length}));
  }finally{await env.cleanup();}
}

test('D05 timestamp comparison: typed true and false',async()=>{
  for(const [label,value,expected] of [
    ['server-time',serverTimestamp(),'allow'],['old-timestamp',new Date('2020-01-01'),'permission-denied']]){
    await runCase('time',label,async()=>{
      await adb.doc('activities/a1').set({ownerId:'owner',status:'open',deletedAt:new Date('2026-09-01')});
      const s=await adb.doc('activities/a1').get();
      assert.equal(s.exists,true);assert.equal(s.data().ownerId,'owner');
      assert.ok(s.data().deletedAt instanceof admin.firestore.Timestamp);
      console.log('C7_ADMIN',JSON.stringify({family:'time',label,path:s.ref.path,exists:s.exists,
        deletedAtType:'timestamp'}));
    },db=>updateDoc(doc(db,'activities','a1'),{deletedAt:value}),expected);
  }
});

test('D11 absent member: exists, negation, and guarded dereference',async()=>{
  for(const [label,memberPresent,expected] of [
    ['member-present',true,'allow'],['member-absent',false,'permission-denied']]){
    await runCase('member',label,async()=>{
      await adb.doc('activities/a1').set({ownerId:'owner',status:'open'});
      await adb.doc('activities/a1/photos/p').set({group:1});
      if(memberPresent)await adb.doc('activities/a1/members/foreign').set({group:1});
      const [parent,photo,member]=await Promise.all([
        adb.doc('activities/a1').get(),adb.doc('activities/a1/photos/p').get(),
        adb.doc('activities/a1/members/foreign').get()]);
      assert.equal(parent.exists,true);assert.equal(photo.exists,true);
      assert.equal(member.exists,memberPresent);
      console.log('C7_ADMIN',JSON.stringify({family:'member',label,parent:parent.exists,
        photo:photo.exists,member:member.exists}));
    },db=>getDoc(doc(db,'activities','a1','photos','p')),expected);
  }
  const seedMissing=async()=>{
    await adb.doc('activities/a1').set({ownerId:'owner',status:'open'});
    await adb.doc('activities/a1/photos/p').set({group:1});
    assert.equal((await adb.doc('activities/a1/members/foreign').get()).exists,false);
  };
  await runCase('memberNegation','member-absent-negated-exists',seedMissing,
    db=>getDoc(doc(db,'activities','a1','photos','p')),'allow');
  await runCase('memberUnsafe','member-absent-direct-get',seedMissing,
    db=>getDoc(doc(db,'activities','a1','photos','p')),'permission-denied');
});

test('D13/D15 restore-state equality: valid and forged typed strings',async()=>{
  for(const prior of ['draft','closed'])for(const [label,next,expected] of [
    ['legitimate',prior,'allow'],['forged','open','permission-denied']]){
    await runCase('restore',`${prior}-${label}`,async()=>{
      await adb.doc('activities/a1').set({ownerId:'owner',status:'deleted',
        statusBeforeDelete:prior,deletedAt:new Date('2026-09-01'),deletedBy:'owner'});
      const s=await adb.doc('activities/a1').get();
      assert.equal(s.exists,true);assert.equal(typeof s.data().statusBeforeDelete,'string');
      assert.equal(typeof s.data().status,'string');
      console.log('C7_ADMIN',JSON.stringify({family:'restore',prior,label,path:s.ref.path,
        exists:s.exists,status:s.data().status,statusBeforeDelete:s.data().statusBeforeDelete}));
    },db=>updateDoc(doc(db,'activities','a1'),{status:next}),expected);
  }
});

test.after(async()=>{await app.delete();});
