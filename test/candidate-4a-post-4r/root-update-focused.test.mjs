import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {deleteField,doc,serverTimestamp,updateDoc} from 'firebase/firestore';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const rules=readFileSync(path.join(root,'firestore.rules.production-candidate'),'utf8');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8412';
const require=createRequire(import.meta.url);
const admin=require(path.join(root,'.local-tools/firebase-admin-diagnostic/node_modules/firebase-admin'));
const app=admin.initializeApp({projectId:'demo-candidate-4a-post-4r'},'root-update-focused');
const adminDb=admin.firestore(app);
const activity={ownerId:'owner',classId:null,className:'',title:'Old',instructions:'Discuss',groupCount:2,
  durationSec:300,allowText:true,allowPhoto:true,allowFile:true,collectStudentNames:false,
  joinCode:'JOIN1',status:'open',startedAt:null,createdAt:new Date('2026-09-01'),updatedAt:new Date('2026-09-01')};

test('Candidate 4A exact root-update focused regression',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
    firestore:{rules,host:'127.0.0.1',port:8412}});
  try{
    const cases=[
      {name:'active owner title edit',deleted:false,actor:'owner',change:{title:'New'},expect:'allow'},
      {name:'deleted owner title edit',deleted:true,actor:'owner',change:{title:'New'},expect:'permission-denied'},
      {name:'deleted owner restore',deleted:true,actor:'owner',change:{status:'open',
        statusBeforeDelete:deleteField(),deletedAt:deleteField(),deletedBy:deleteField(),
        updatedAt:serverTimestamp()},expect:'allow'},
      {name:'deleted owner forged restore plus title',deleted:true,actor:'owner',change:{status:'open',
        statusBeforeDelete:deleteField(),deletedAt:deleteField(),deletedBy:deleteField(),
        title:'New',updatedAt:serverTimestamp()},expect:'permission-denied'},
      {name:'deleted foreign teacher title edit',deleted:true,actor:'foreign',change:{title:'New'},expect:'permission-denied'},
      {name:'deleted foreign teacher restore',deleted:true,actor:'foreign',change:{status:'open',
        statusBeforeDelete:deleteField(),deletedAt:deleteField(),deletedBy:deleteField(),
        updatedAt:serverTimestamp()},expect:'permission-denied'}
    ];
    for(const c of cases){
      await env.clearFirestore();
      await adminDb.doc('users/owner').set({role:'teacher',status:'active'});
      await adminDb.doc('users/foreign').set({role:'teacher',status:'active'});
      await adminDb.doc('groupActivities/g1').set(activity);
      if(c.deleted){
        const ownerDb=env.authenticatedContext('owner',{firebase:{sign_in_provider:'password'}}).firestore();
        await updateDoc(doc(ownerDb,'groupActivities','g1'),{status:'deleted',statusBeforeDelete:'open',
          deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()});
      }
      const before=await adminDb.doc('groupActivities/g1').get();
      assert.equal(before.exists,true);
      assert.equal(before.data().ownerId,'owner');
      assert.equal(before.data().status,c.deleted?'deleted':'open');
      if(c.deleted){
        assert.equal(before.data().statusBeforeDelete,'open');
        assert.equal(before.data().deletedBy,'owner');
        assert.ok(before.data().deletedAt);
      }
      const db=env.authenticatedContext(c.actor,{firebase:{sign_in_provider:'password'}}).firestore();
      let error;
      try{await updateDoc(doc(db,'groupActivities','g1'),c.change);}catch(e){error=e;}
      const actual=error?.code||'allow';
      const after=await adminDb.doc('groupActivities/g1').get();
      assert.equal(actual,c.expect,c.name);
      if(c.expect==='permission-denied')assert.equal(after.data().title,'Old');
      console.log('FOCUSED_ROOT_RESULT',JSON.stringify({name:c.name,path:'groupActivities/g1',
        authUid:c.actor,ownerUid:'owner',before:before.data(),
        changedKeys:Object.keys(c.change),permission:actual,
        after:{status:after.data().status,title:after.data().title},
        diagnostic:/Null value error/i.test(error?.message||'')?'genuine-null':
          /evaluation error/i.test(error?.message||'')?'evaluation-error-false':'none',
        message:error?.message||''}));
      if(c.name==='deleted owner title edit'){
        const response=await fetch('http://127.0.0.1:8412/emulator/v1/projects/demo-candidate-4a-post-4r:ruleCoverage');
        const coverage=await response.json();
        const relevant=[];
        const walk=nodes=>{for(const n of nodes||[]){
          const line=n.sourcePosition?.line;
          if([896,897,898,993,994,995,996,1088,1089,1090,1091,1092].includes(line))
            for(const v of n.values||[])if(typeof v.value?.boolValue==='boolean'||
              Object.keys(v.value||{}).some(k=>/error/i.test(k)))
              relevant.push({line,col:n.sourcePosition.column,value:v.value,count:v.count});
          walk(n.children);
        }};
        walk(coverage.report);
        console.log('FOCUSED_ROOT_COVERAGE',JSON.stringify(relevant.slice(-40)));
      }
    }
  }finally{await env.cleanup();await app.delete();}
});
