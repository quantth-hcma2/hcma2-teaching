import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,serverTimestamp} from 'firebase/firestore';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let rules=process.env.HCMA2_TEST_BASELINE_RULES
  ?execFileSync('git',['show','HEAD:firestore.rules.production-candidate'],{cwd:root,encoding:'utf8'})
  :readFileSync(path.join(root,'firestore.rules.production-candidate'),'utf8');
if(process.env.HCMA2_DIAG_NO_BASE){
  rules=rules.replaceAll('groupMemberJoinBase(groupActivityData(activityId), activityId, uid)','false');
}
if(process.env.HCMA2_DIAG_HELPER_STATUS){
  const expr=process.env.HCMA2_DIAG_HELPER_STATUS==='literal'?'false':
    process.env.HCMA2_DIAG_HELPER_STATUS==='ternary'?"activity.status == 'open' ? true : false":
    "activity.status == 'open'";
  rules=rules.replace(/function groupMemberJoinBase\(activity, activityId, uid\) \{[\s\S]*?\n    \}/,
    `function groupMemberJoinBase(activity, activityId, uid) { return ${expr}; }`);
}
if(process.env.HCMA2_DIAG_EXISTS_GUARD){
  const start=rules.indexOf('match /members/{uid} {',rules.indexOf('match /groupActivities/{activityId} {'));
  const end=rules.indexOf('allow update:',start);
  const prefix=rules.slice(0,start),block=rules.slice(start,end),suffix=rules.slice(end);
  rules=prefix+block.replaceAll('allow create: if ',
    'allow create: if exists(/databases/$(database)/documents/groupActivities/$(activityId)) && groupActivityData(activityId).status == \'open\' && ')+suffix;
}
if(process.env.HCMA2_DIAG_SINGLE_BRANCH){
  const start=rules.indexOf('allow create:',rules.indexOf('match /members/{uid} {',rules.indexOf('match /groupActivities/{activityId} {')));
  const end=rules.indexOf('// Immutable to the student',start);
  rules=rules.slice(0,start)+`allow create: if groupActivityData(activityId).status == 'open' &&
          request.resource.data.keys().hasOnly(['group','joinedAt','joinCode']) &&
          groupMemberJoinBase(groupActivityData(activityId), activityId, uid);

        `+rules.slice(end);
}
if(process.env.HCMA2_DIAG_AFTER){
  const start=rules.indexOf('allow create:',rules.indexOf('match /members/{uid} {',rules.indexOf('match /groupActivities/{activityId} {')));
  const end=rules.indexOf('// Immutable to the student',start);
  rules=rules.slice(0,start)+rules.slice(start,end).replaceAll('groupActivityData(activityId)','groupActivityDataAfter(activityId)')+rules.slice(end);
}
const activity={ownerId:'owner',groupCount:2,collectStudentNames:false,joinCode:'JOIN1',
  status:'deleted',statusBeforeDelete:'open',deletedAt:new Date('2026-09-30T00:00:00Z'),deletedBy:'owner'};
if(process.env.HCMA2_DIAG_OPEN){activity.status='open';delete activity.statusBeforeDelete;
  delete activity.deletedAt;delete activity.deletedBy;}
if(process.env.HCMA2_DIAG_CLOSED){activity.status='closed';delete activity.statusBeforeDelete;
  delete activity.deletedAt;delete activity.deletedBy;}

test('one anonymous member create against deleted activity',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
    firestore:{rules,host:'127.0.0.1',port:8412}});
  try{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx=>{
      const db=ctx.firestore();
      if(!process.env.HCMA2_DIAG_NO_PARENT)await setDoc(doc(db,'groupActivities','g1'),activity);
      await setDoc(doc(db,'groupJoinCodes','JOIN1'),{activityId:'g1',ownerId:'owner'});
      console.log('SEEDED_PARENT',JSON.stringify((await getDoc(doc(db,'groupActivities','g1'))).data()));
    });
    const db=env.authenticatedContext('anon-new',{firebase:{sign_in_provider:'anonymous'}}).firestore();
    if(process.env.HCMA2_DIAG_PARENT_READ){try{console.log('ANON_PARENT_READ',JSON.stringify((await getDoc(doc(db,'groupActivities','g1'))).data()));}
      catch(e){console.log('ANON_PARENT_READ_ERROR',e.code,e.message);}}
    const target='groupActivities/g1/members/anon-new';
    const data={group:1,joinedAt:'serverTimestamp()',joinCode:'JOIN1'};
    console.log('DIAGNOSTIC',JSON.stringify({target,auth:{uid:'anon-new',provider:'anonymous'},
      request:data,parent:activity,joinCode:{activityId:'g1',ownerId:'owner'},otherSiblings:'none'}));
    let error;
    try{await setDoc(doc(db,target),{group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1'});}
    catch(e){error=e;console.log('RULES_DENIAL',JSON.stringify({code:e.code,message:e.message}));}
    if(process.env.HCMA2_DIAG_OPEN)assert.equal(error,undefined);
    else assert.equal(error?.code,'permission-denied');
    if(process.env.HCMA2_DIAG_COVERAGE){
      const res=await fetch('http://127.0.0.1:8412/emulator/v1/projects/demo-candidate-4a-post-4r:ruleCoverage');
      const report=await res.json();
      console.log('COVERAGE_STATUS',res.status,'COVERAGE_KEYS',Object.keys(report));
      console.log('COVERAGE_ERRORS',JSON.stringify(report).match(/.{0,180}"error".{0,350}/g)?.slice(0,20));
      const special=[];
      const walk=nodes=>{for(const n of nodes||[]){for(const v of n.values||[]){
        const keys=Object.keys(v.value||{});
        if(keys.some(k=>/undefined|error|null/i.test(k)))special.push({line:n.sourcePosition?.line,
          column:n.sourcePosition?.column,value:v.value,count:v.count});
      }walk(n.children);}};
      walk(report.report);
      console.log('COVERAGE_SPECIAL',JSON.stringify(special.filter(x=>[888,922].includes(x.line))).slice(0,2000));
      const relevant=[];
      const walkRelevant=nodes=>{for(const n of nodes||[]){if([888,922,1272].includes(n.sourcePosition?.line))
        relevant.push({line:n.sourcePosition.line,column:n.sourcePosition.column,
          values:(n.values||[]).map(v=>({kind:Object.keys(v.value||{}),count:v.count}))});
        walkRelevant(n.children);}};
      walkRelevant(report.report);
      console.log('COVERAGE_RELEVANT',JSON.stringify(relevant).slice(0,5000));
    }
  }finally{await env.cleanup();}
});
