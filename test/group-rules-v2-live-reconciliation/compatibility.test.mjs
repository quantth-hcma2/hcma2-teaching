import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {
  doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,deleteDoc,
  writeBatch,serverTimestamp
} from "firebase/firestore";

const baselineRules=readFileSync(resolve(".reconciliation/live-rules/firestore-rules-live-before-4r.rules"),"utf8");
const candidateRules=readFileSync(resolve("firestore.rules.production-candidate"),"utf8");
const port=Number(process.env.FIRESTORE_EMULATOR_PORT||8411);
let baseline,candidate;

const fixture={ownerId:"owner",classId:"c",className:"C",title:"Group",instructions:"Discuss",groupCount:2,durationSec:300,allowText:true,allowPhoto:true,allowFile:true,joinCode:"JOIN1",status:"open",startedAt:null,createdAt:new Date(),updatedAt:new Date()};
const auth=(env,uid,provider="password")=>env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}).firestore();
const raw=(env,fn)=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
async function seed(env){await raw(env,async db=>{
  await setDoc(doc(db,"users","owner"),{role:"teacher",status:"active"});
  await setDoc(doc(db,"users","foreign"),{role:"teacher",status:"active"});
  await setDoc(doc(db,"users","admin"),{role:"admin",status:"active"});
  await setDoc(doc(db,"groupActivities","g1"),fixture);
  await setDoc(doc(db,"groupJoinCodes","JOIN1"),{activityId:"g1",ownerId:"owner",createdAt:new Date()});
  await setDoc(doc(db,"groupActivities","g1","members","student"),{group:1,joinedAt:new Date(),joinCode:"JOIN1"});
  await setDoc(doc(db,"groupActivities","g1","topics","1"),{group:1,topic:"One",updatedAt:new Date()});
  await setDoc(doc(db,"groupActivities","g1","topics","2"),{group:2,topic:"Two",updatedAt:new Date()});
});}
async function allowed(p){try{await p;return true;}catch{return false;}}
async function same(label,operation,expected){
  const before=await allowed(operation(baseline));
  const after=await allowed(operation(candidate));
  assert.equal(before,expected,`${label}: production baseline outcome`);
  assert.equal(after,expected,`${label}: V2 outcome`);
  assert.equal(after,before,`${label}: compatibility`);
}

test.before(async()=>{
  baseline=await initializeTestEnvironment({projectId:"demo-group-v2-baseline",firestore:{rules:baselineRules,host:"127.0.0.1",port}});
  candidate=await initializeTestEnvironment({projectId:"demo-group-v2-candidate",firestore:{rules:candidateRules,host:"127.0.0.1",port}});
});
test.after(async()=>{await baseline?.cleanup();await candidate?.cleanup();});
test.beforeEach(async()=>{await baseline.clearFirestore();await candidate.clearFirestore();await seed(baseline);await seed(candidate);});

test("root role/read/list semantics match",async()=>{
  await same("owner get",e=>getDoc(doc(auth(e,"owner"),"groupActivities","g1")),true);
  await same("anonymous get",e=>getDoc(doc(auth(e,"anon","anonymous"),"groupActivities","g1")),true);
  await same("owner scoped list",e=>getDocs(query(collection(auth(e,"owner"),"groupActivities"),where("ownerId","==","owner"))),true);
  await same("foreign broad list",e=>getDocs(collection(auth(e,"foreign"),"groupActivities")),false);
  await same("admin list",e=>getDocs(collection(auth(e,"admin"),"groupActivities")),true);
});

test("root legacy/timer/runtime/delete semantics match",async()=>{
  await same("owner legacy update",e=>updateDoc(doc(auth(e,"owner"),"groupActivities","g1"),{title:"Changed",updatedAt:serverTimestamp()}),true);
  await same("foreign legacy update",e=>updateDoc(doc(auth(e,"foreign"),"groupActivities","g1"),{title:"No",updatedAt:serverTimestamp()}),false);
  await same("owner timer update",e=>updateDoc(doc(auth(e,"owner"),"groupActivities","g1"),{durationSec:60,startedAt:serverTimestamp(),pausedRemainingSec:null,updatedAt:serverTimestamp()}),true);
  await same("foreign delete",e=>deleteDoc(doc(auth(e,"foreign"),"groupActivities","g1")),false);
  await same("owner delete",e=>deleteDoc(doc(auth(e,"owner"),"groupActivities","g1")),true);
});

test("atomic activation and sibling-existence semantics match",async()=>{
  const activate=async(e,complete=true)=>{
    await raw(e,db=>updateDoc(doc(db,"groupActivities","g1"),{status:"closed"}));
    const db=auth(e,"owner"),b=writeBatch(db),root=doc(db,"groupActivities","g1");
    b.update(root,{editContractVersion:1,configRevision:0,currentConfigId:"cfg0",lastOperationId:"op0",contractActivatedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    if(complete){
      b.set(doc(db,"groupActivities","g1","configVersions","cfg0"),{revision:0,parentConfigId:null,kind:"activation_baseline",source:"legacy_snapshot",createdAt:serverTimestamp(),createdBy:"owner",activatedFromLegacy:true,active:true,title:"Group",instructions:"Discuss"});
      b.set(doc(db,"groupActivities","g1","editHistory","op0"),{operationId:"op0",actorUid:"owner",operationType:"activate_contract",baseRevision:-1,resultingRevision:0,previousConfigId:null,resultingConfigId:"cfg0",changedFields:[],createdAt:serverTimestamp(),lifecycleBefore:"legacy",lifecycleAfter:"closed"});
    }
    await b.commit();
  };
  await same("valid atomic activation",e=>activate(e,true),true);
  await same("missing siblings denied",e=>activate(e,false),false);
});

test("atomic apply-config semantics match",async()=>{
  const apply=async(e,complete=true)=>{
    await raw(e,async db=>{
      await updateDoc(doc(db,"groupActivities","g1"),{status:"closed",editContractVersion:1,configRevision:0,currentConfigId:"cfg0",lastOperationId:"op0",contractActivatedAt:new Date()});
      await setDoc(doc(db,"groupActivities","g1","configVersions","cfg0"),{revision:0,parentConfigId:null,kind:"activation_baseline",source:"legacy_snapshot",createdAt:new Date(),createdBy:"owner",activatedFromLegacy:true,active:true,title:"Group",instructions:"Discuss"});
    });
    const db=auth(e,"owner"),b=writeBatch(db),configId=complete?"cfg1":"cfg-missing",operationId=complete?"op1":"op-missing";
    b.update(doc(db,"groupActivities","g1"),{configRevision:1,currentConfigId:configId,lastOperationId:operationId,updatedAt:serverTimestamp()});
    if(complete){
      b.set(doc(db,"groupActivities","g1","configVersions","cfg1"),{revision:1,parentConfigId:"cfg0",kind:"config",source:"editor",createdAt:serverTimestamp(),createdBy:"owner",activatedFromLegacy:false,active:true,title:"Group 2",instructions:"Discuss 2"});
      b.set(doc(db,"groupActivities","g1","editHistory","op1"),{operationId:"op1",actorUid:"owner",operationType:"apply_config",baseRevision:0,resultingRevision:1,previousConfigId:"cfg0",resultingConfigId:"cfg1",changedFields:["title"],createdAt:serverTimestamp(),lifecycleBefore:"closed",lifecycleAfter:"closed"});
    }
    await b.commit();
  };
  await same("valid atomic apply",e=>apply(e,true),true);
  await same("apply missing siblings denied",e=>apply(e,false),false);
});

test("admin and foreign-teacher root boundaries match",async()=>{
  await same("admin legacy update",e=>updateDoc(doc(auth(e,"admin"),"groupActivities","g1"),{title:"Admin",updatedAt:serverTimestamp()}),true);
  await same("foreign timer update",e=>updateDoc(doc(auth(e,"foreign"),"groupActivities","g1"),{durationSec:30,startedAt:null,pausedRemainingSec:30,updatedAt:serverTimestamp()}),false);
});

test("root create and atomic join-code mapping semantics match",async()=>{
  const create=async(e,uid)=>{const db=auth(e,uid);const b=writeBatch(db);b.set(doc(db,"groupActivities","new"),{...fixture,ownerId:uid,status:"draft",joinCode:"NEW",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});b.set(doc(db,"groupJoinCodes","NEW"),{activityId:"new",ownerId:uid,createdAt:serverTimestamp()});await b.commit();};
  await same("owner create activity+mapping",e=>create(e,"owner"),true);
  await same("foreign forged owner",async e=>{const db=auth(e,"foreign");await setDoc(doc(db,"groupActivities","forged"),{...fixture,ownerId:"owner",status:"draft",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});},false);
});

test("topics owner/student/cross-group semantics match",async()=>{
  await same("student own topic",e=>getDoc(doc(auth(e,"student","anonymous"),"groupActivities","g1","topics","1")),true);
  await same("student other topic",e=>getDoc(doc(auth(e,"student","anonymous"),"groupActivities","g1","topics","2")),false);
  await same("owner topic update",e=>updateDoc(doc(auth(e,"owner"),"groupActivities","g1","topics","1"),{topic:"Changed",updatedAt:serverTimestamp()}),true);
  await same("student topic update",e=>updateDoc(doc(auth(e,"student","anonymous"),"groupActivities","g1","topics","1"),{topic:"No"}),false);
});

test("notes/photos/files submission semantics match",async()=>{
  const s=e=>auth(e,"student","anonymous");
  await same("valid note",e=>setDoc(doc(s(e),"groupActivities","g1","notes","n"),{group:1,participantId:"student",text:"ok",createdAt:serverTimestamp()}),true);
  await same("cross-group note",e=>setDoc(doc(s(e),"groupActivities","g1","notes","nx"),{group:2,participantId:"student",text:"no",createdAt:serverTimestamp()}),false);
  await same("valid photo",e=>setDoc(doc(s(e),"groupActivities","g1","photos","p"),{group:1,participantId:"student",name:"p.jpg",storagePath:"groupActivitySubmissions/owner/g1/groups/1/student/p/p.jpg",size:1,contentType:"image/jpeg",createdAt:serverTimestamp()}),true);
  await same("invalid photo path",e=>setDoc(doc(s(e),"groupActivities","g1","photos","bad"),{group:1,participantId:"student",name:"p.jpg",storagePath:"legacy/p.jpg",size:1,contentType:"image/jpeg",createdAt:serverTimestamp()}),false);
  await same("valid file",e=>setDoc(doc(s(e),"groupActivities","g1","files","f"),{group:1,participantId:"student",name:"f.docx",storagePath:"groupActivitySubmissions/owner/g1/groups/1/student/f/f.docx",size:1,contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",createdAt:serverTimestamp()}),true);
  await same("unsafe link",e=>setDoc(doc(s(e),"groupActivities","g1","files","bad"),{group:1,participantId:"student",name:"Liên kết nhóm",link:"javascript:1",createdAt:serverTimestamp()}),false);
});

test("live-only name collection compatibility matches",async()=>{
  const join=(e,uid,payload)=>setDoc(doc(auth(e,uid,"anonymous"),"groupActivities","g1","members",uid),payload);
  await same("legacy missing toggle",e=>join(e,"legacy",{group:1,joinedAt:serverTimestamp(),joinCode:"JOIN1"}),true);
  const setMode=async(e,value)=>raw(e,db=>updateDoc(doc(db,"groupActivities","g1"),{collectStudentNames:value}));
  await setMode(baseline,false);await setMode(candidate,false);
  await same("explicit false nameless",e=>join(e,"off",{group:1,joinedAt:serverTimestamp(),joinCode:"JOIN1"}),true);
  await setMode(baseline,true);await setMode(candidate,true);
  await same("name required",e=>join(e,"missing",{group:1,joinedAt:serverTimestamp(),joinCode:"JOIN1"}),false);
  await same("valid displayName",e=>join(e,"named",{group:1,joinedAt:serverTimestamp(),joinCode:"JOIN1",displayName:"Nguyễn An"}),true);
});

test("RichText V1/V2 and 40-block live boundary match",async()=>{
  const rich=(version,count)=>({version,blocks:Array.from({length:count},()=>({type:"p",runs:[{text:"x"}]}))});
  const create=(e,id,value)=>setDoc(doc(auth(e,"owner"),"groupActivities",id),{...fixture,status:"draft",joinCode:id,ownerId:"owner",instructionsRich:value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await same("V1 20 blocks",e=>create(e,"v120",rich(1,20)),true);
  await same("V2 40 blocks",e=>create(e,"v240",rich(2,40)),true);
  await same("V2 41 denied",e=>create(e,"v241",rich(2,41)),false);
});

test("membership and join-code semantics match",async()=>{
  await same("signed join-code get",e=>getDoc(doc(auth(e,"fresh","anonymous"),"groupJoinCodes","JOIN1")),true);
  await same("valid member join",e=>setDoc(doc(auth(e,"fresh","anonymous"),"groupActivities","g1","members","fresh"),{group:2,joinedAt:serverTimestamp(),joinCode:"JOIN1"}),true);
  await same("invalid join code",e=>setDoc(doc(auth(e,"bad","anonymous"),"groupActivities","g1","members","bad"),{group:1,joinedAt:serverTimestamp(),joinCode:"NOPE"}),false);
  await same("owner correction",e=>updateDoc(doc(auth(e,"owner"),"groupActivities","g1","members","student"),{group:2}),true);
  await same("student correction",e=>updateDoc(doc(auth(e,"student","anonymous"),"groupActivities","g1","members","student"),{group:2}),false);
  await same("owner mapping delete",e=>deleteDoc(doc(auth(e,"owner"),"groupJoinCodes","JOIN1")),true);
});
