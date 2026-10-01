import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {deleteField,doc,getDoc,serverTimestamp,setDoc,updateDoc,writeBatch} from 'firebase/firestore';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const variant=process.env.HCMA2_CREATE_RULES_VARIANT;
assert.ok(['baseline','r1','r2'].includes(variant),'choose baseline, r1, or r2');
const rules=variant==='r2'?readFileSync(path.join(root,'firestore.rules.production-candidate'),'utf8'):
  execFileSync('git',['-c','safe.directory=*','show',
    `${variant==='baseline'?'9e866fc475104cc6d6b32143ad79694d4fa2891f':'d05d3257de4ea3477908162785a227f62f7f51ab'}:firestore.rules.production-candidate`],
  {cwd:root,encoding:'utf8'});
const rich=text=>({version:2,blocks:[{type:'paragraph',runs:[{text}]}]});

test(`Group create preflight and batch / ${variant}`,async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-4a-create-preflight',
    firestore:{rules,host:'127.0.0.1',port:8412}});
  try{
    await env.withSecurityRulesDisabled(async ctx=>{
      await setDoc(doc(ctx.firestore(),'users','owner'),{role:'teacher',status:'active'});
    });
    const db=env.authenticatedContext('owner',{firebase:{sign_in_provider:'password'}}).firestore();
    const activityId='new-activity',code='JOIN01';
    const rootRef=doc(db,'groupActivities',activityId),codeRef=doc(db,'groupJoinCodes',code);
    let preflight;
    try{const snap=await getDoc(codeRef);preflight={result:'ALLOW',exists:snap.exists()};}
    catch(error){preflight={result:'DENY',code:error.code,message:error.message};}
    console.log('CREATE_PREFLIGHT',JSON.stringify({variant,path:codeRef.path,auth:'owner/password; users/owner teacher active',...preflight}));

    const payload={ownerId:'owner',classId:null,className:'',
      title:'SMOKE 4A-R1 2026-10-01 CODEX',
      instructions:'RichText smoke 4A-R1: nội dung thử nghiệm.',
      instructionsRich:rich('RichText smoke 4A-R1: nội dung thử nghiệm.'),
      groupCount:2,durationSec:900,allowText:true,allowPhoto:true,allowFile:true,
      collectStudentNames:true,joinCode:code,status:'draft',startedAt:null,
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    const batch=writeBatch(db);
    batch.set(rootRef,payload);
    batch.set(codeRef,{activityId,ownerId:'owner',createdAt:serverTimestamp()});
    for(let group=1;group<=2;group++)batch.set(doc(db,'groupActivities',activityId,'topics',String(group)),{
      group,topic:`Chủ đề thử nhóm ${group}`,topicRich:rich(`Chủ đề thử nhóm ${group}`),
      updatedAt:serverTimestamp()});
    let create;
    try{await batch.commit();create={result:'ALLOW'};}
    catch(error){create={result:'DENY',code:error.code,message:error.message};}
    console.log('CREATE_BATCH',JSON.stringify({variant,paths:[rootRef.path,codeRef.path,
      `groupActivities/${activityId}/topics/1`,`groupActivities/${activityId}/topics/2`],
      payloadKeys:Object.keys(payload),deletedFieldsPresent:false,...create}));
    assert.equal(create.result,'ALLOW');
    assert.equal(preflight.result,variant==='r1'?'DENY':'ALLOW');
    if(variant!=='r1')assert.equal(preflight.exists,false);
    if(variant==='r1')assert.match(preflight.message,/Null value error/);
    if(variant==='r2'){
      assert.equal((await getDoc(codeRef)).data().activityId,activityId);
      await updateDoc(rootRef,{status:'deleted',statusBeforeDelete:'draft',
        deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()});
      assert.equal((await getDoc(rootRef)).data().status,'deleted');
      let deletedMapping;
      try{await getDoc(codeRef);deletedMapping={result:'ALLOW'};}
      catch(error){deletedMapping={result:'DENY',code:error.code,message:error.message};}
      console.log('DELETED_MAPPING',JSON.stringify({variant,path:codeRef.path,...deletedMapping}));
      assert.equal(deletedMapping.result,'DENY');
      assert.doesNotMatch(deletedMapping.message,/Null value error|undefined value|expression limit|access.call.limit/i);
      await updateDoc(rootRef,{status:'draft',statusBeforeDelete:deleteField(),
        deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()});
      assert.equal((await getDoc(codeRef)).data().activityId,activityId);
    }
  }finally{await env.cleanup();}
});
