import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,updateDoc} from 'firebase/firestore';

const here=path.dirname(fileURLToPath(import.meta.url));
const template=readFileSync(path.join(here,'minimal-root-update','minimal.rules'),'utf8');
const forms={
  A:"resource.data.status != 'deleted'",
  B:"request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title']) && resource.data.status != 'deleted'",
  C:"request.auth.uid == resource.data.ownerId && (deletionKeysChanged() ? false : notDeleted(resource.data) && legacyEdit())",
  D:"!('deletedAt' in resource.data) || resource.data.deletedAt == null"
};
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8412';
const require=createRequire(import.meta.url);
const admin=require(path.resolve(here,'../../.local-tools/firebase-admin-diagnostic/node_modules/firebase-admin'));
const app=admin.initializeApp({projectId:'demo-candidate-4a-post-4r'},'minimal-root-update');
const adminDb=admin.firestore(app);

test('minimal independent root-update false-guard matrix',async()=>{
  try{
    for(const [form,expression] of Object.entries(forms)){
      const rules=template.replace('__EXPRESSION__',expression);
      for(const status of ['open','deleted']){
        const env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
          firestore:{rules,host:'127.0.0.1',port:8412}});
        try{
          await env.clearFirestore();
          const original={ownerId:'owner',status,title:'Old',
            ...(status==='deleted'?{deletedAt:new Date('2026-09-01'),deletedBy:'owner',statusBeforeDelete:'open'}:{})};
          await adminDb.doc('activities/a1').set(original);
          const before=await adminDb.doc('activities/a1').get();
          assert.equal(before.exists,true);
          assert.deepEqual(Object.keys(before.data()).sort(),Object.keys(original).sort());
          console.log('ROOT_ADMIN_CONFIRM',JSON.stringify({form,status,path:before.ref.path,resource:before.data()}));
          const db=env.authenticatedContext('owner',{firebase:{sign_in_provider:'password'}}).firestore();
          let error;
          try{await updateDoc(doc(db,'activities','a1'),{title:'New'});}catch(e){error=e;}
          const message=error?.message||'';
          const after=await adminDb.doc('activities/a1').get();
          assert.equal(error?.code||'allow',status==='open'?'allow':'permission-denied');
          assert.equal(after.data().title,status==='open'?'New':'Old');
          console.log('ROOT_RESULT',JSON.stringify({form,status,authUid:'owner',ownerUid:'owner',
            request:{...original,title:'New'},changedKeys:['title'],permission:error?.code||'allow',
            evaluationError:/evaluation error/i.test(message),nullError:/Null value error/i.test(message),message}));
          const response=await fetch('http://127.0.0.1:8412/emulator/v1/projects/demo-candidate-4a-post-4r:ruleCoverage');
          const coverage=await response.json();
          const values=[];
          const walk=nodes=>{for(const n of nodes||[]){
            if(n.sourcePosition?.line>=4&&n.sourcePosition?.line<=18)
              for(const v of n.values||[])values.push({line:n.sourcePosition.line,col:n.sourcePosition.column,
                value:v.value,count:v.count});
            walk(n.children);
          }};
          walk(coverage.report);
          console.log('ROOT_COVERAGE',JSON.stringify({form,status,
            booleans:[...new Set(values.filter(v=>typeof v.value?.boolValue==='boolean').map(v=>v.value.boolValue))],
            undefinedEntries:values.filter(v=>'undefined' in (v.value||{})).length,
            errorEntries:values.filter(v=>Object.keys(v.value||{}).some(k=>/error/i.test(k))).length}));
        }finally{await env.cleanup();}
      }
    }
  }finally{await app.delete();}
});
