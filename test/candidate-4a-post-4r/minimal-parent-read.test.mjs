import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';

const folder=path.join(path.dirname(fileURLToPath(import.meta.url)),'minimal-parent-read');
const direct=readFileSync(path.join(folder,'minimal.rules'),'utf8');
const expression="get(/databases/$(database)/documents/parents/$(id)).data.status == 'open'";
const pathExpr='/databases/$(database)/documents/parents/$(id)';
const formulations={
  direct:expression,
  exists:`exists(${pathExpr}) && ${expression}`,
  helper:`parentStatus(id) == 'open'`,
  safeMap:`exists(${pathExpr}) && get(${pathExpr}).data.keys().hasAll(['status']) && ${expression}`
};
const helper=`function parentStatus(parentId) {
        let parent = get(/databases/$(database)/documents/parents/$(parentId));
        return parent.data.status;
      }
      `;
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8412';
const require=createRequire(import.meta.url);
const admin=require(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../.local-tools/firebase-admin-diagnostic/node_modules/firebase-admin'));
const app=admin.initializeApp({projectId:'demo-candidate-4a-post-4r'},'minimal-parent-read');
const adminDb=admin.firestore(app);

test('minimal parent-get evaluation matrix',async()=>{
  try{
  for(const [form,expr] of Object.entries(formulations))for(const state of ['open','closed','missing']){
      const rules=direct.replace('match /members/{uid} {',`match /members/{uid} {\n      ${form==='helper'?helper:''}`)
        .replace(expression,expr);
      const env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
        firestore:{rules,host:'127.0.0.1',port:8412}});
      try{
      await env.clearFirestore();
      if(state!=='missing')await adminDb.doc('parents/p1').set({status:state});
      const snapshot=await adminDb.doc('parents/p1').get();
      const adminState={exists:snapshot.exists,status:snapshot.data()?.status};
      assert.equal(adminState.exists,state!=='missing');
      console.log('ADMIN_CONFIRM',JSON.stringify({form,state,...adminState}));
      const db=env.authenticatedContext('anon',{firebase:{sign_in_provider:'anonymous'}}).firestore();
      let error;
      try{await setDoc(doc(db,'parents','p1','members','anon'),{joined:true});}
      catch(e){error=e;}
      const message=error?.message||'';
      console.log('RESULT',JSON.stringify({form,state,permission:error?.code||'allow',
        evaluationError:/evaluation error/i.test(message),message:message.slice(0,600)}));
      assert.equal(error?.code||'allow',state==='open'?'allow':'permission-denied');
      const coverage=await fetch('http://127.0.0.1:8412/emulator/v1/projects/demo-candidate-4a-post-4r:ruleCoverage');
      const body=await coverage.json();
      const values=[];
      const walk=nodes=>{for(const n of nodes||[]){
        if(n.sourcePosition?.line>=4 && n.sourcePosition?.line<=14)
          for(const v of n.values||[])if(Object.keys(v.value||{}).some(k=>/undefined|error/i.test(k)))
            values.push({line:n.sourcePosition.line,col:n.sourcePosition.column,value:v.value,count:v.count});
        walk(n.children);
      }};
      walk(body.report);
      console.log('COVERAGE',JSON.stringify({form,state,undefinedCount:values.length,
        samples:values.slice(0,4)}));
      }finally{await env.cleanup();}
  }
  }finally{await app.delete();}
});
