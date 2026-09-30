import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment,assertFails as assertFailsBase,assertSucceeds} from '@firebase/rules-unit-testing';
import {collection,deleteDoc,deleteField,doc,getDoc,getDocs,limit,orderBy,query,
  serverTimestamp,setDoc,updateDoc,where} from 'firebase/firestore';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const rules=process.env.HCMA2_TEST_BASELINE_RULES
  ? execFileSync('git',['show','HEAD:firestore.rules.production-candidate'],{cwd:root,encoding:'utf8'})
  : readFileSync(path.join(root,'firestore.rules.production-candidate'),'utf8');
const port=8412;
let env;
const diagnostics={E2:0,R2:0,C3:0,null:0,expressionLimit:0,accessLimit:0,other:0,plainDeny:0};
const c3Ledger=new Map([
  ['D01',{rule:1088,status:'open'}],['D02',{rule:1088,status:'deleted'}],
  ['D03',{rule:1088,status:'open'}],['D04',{rule:1088,status:'open'}],
  ['D05',{rule:1088,status:'open'}],['D06',{rule:1357,status:'deleted'}],
  ['D07',{rule:1050,status:'deleted'}],['D08',{rule:1218,status:'deleted'}],
  ['D09',{rule:1234,status:'deleted'}],['D10',{rule:1253,status:'deleted'}],
  ['D11',{rule:1232,status:'open'}],['D12',{rule:1088,status:'deleted',prior:'draft'}],
  ['D13',{rule:1088,status:'deleted',prior:'draft'}],
  ['D14',{rule:1088,status:'deleted',prior:'closed'}],
  ['D15',{rule:1088,status:'deleted',prior:'closed'}]
]);
const c3Seen=new Map();
async function assertFails(request,kind='none'){
  const caller=new Error().stack?.split('\n')[2]?.trim()||'unknown';
  const error=await assertFailsBase(request);
  const message=error.message||'';
  let actual='plainDeny';
  if(/Null value error|undefined value/i.test(message))actual='null';
  else if(/maximum of 1000 expressions|expression limit/i.test(message))actual='expressionLimit';
  else if(/maximum number of.*document access calls|too many document access calls/i.test(message))actual='accessLimit';
  else if(/evaluation error/i.test(message)){
    let parent;
    await raw(async db=>{parent=(await getDoc(rootRef(db))).data();});
    const validParent=parent&&parent.ownerId==='owner';
    const memberDiagnostic=/evaluation error at L(?:1318|1322|1328):\d+/.test(message)&&
      /false for/.test(message);
    const rootDiagnostic=/evaluation error at L1088:\d+/.test(message)&&
      /false for/.test(message);
    const validDeleted=validParent&&parent.status==='deleted'&&
      ['draft','open','closed'].includes(parent.statusBeforeDelete)&&
      parent.deletedBy==='owner'&&parent.deletedAt;
    const ledgerId=kind.startsWith('C3-')?kind.slice(3):null;
    const ledger=ledgerId&&c3Ledger.get(ledgerId);
    let ledgerDocuments=false;
    if(ledger&&validParent){
      await raw(async db=>{
        const code=(await getDoc(codeRef(db))).data();
        const owner=(await getDoc(doc(db,'users','owner'))).data();
        const foreign=(await getDoc(doc(db,'users','foreign'))).data();
        const member=(await getDoc(childRef(db,'members','student'))).data();
        const foreignMember=(await getDoc(childRef(db,'members','foreign'))).exists();
        const photo=(await getDoc(childRef(db,'photos','p'))).data();
        ledgerDocuments=code?.activityId==='g1'&&owner?.role==='teacher'&&
          foreign?.role==='teacher'&&member?.group===1&&!foreignMember&&photo?.group===1;
      });
    }
    const expectedLine=ledger&&new RegExp(`evaluation error at L${ledger.rule}:\\d+ for '(?:get|create|update)'`).test(message);
    const validLedgerState=ledger&&parent.status===ledger.status&&
      (ledger.status!=='deleted'||validDeleted)&&
      (!ledger.prior||parent.statusBeforeDelete===ledger.prior);
    if(kind==='E2'&&validParent&&memberDiagnostic)actual='E2';
    else if(kind==='R2'&&validDeleted&&rootDiagnostic)actual='R2';
    else if(ledger&&expectedLine&&validLedgerState&&ledgerDocuments&&
      /false for/.test(message)&&!c3Seen.has(ledgerId)){
      actual='C3';
      c3Seen.set(ledgerId,1);
    }
    else actual='other';
  }
  diagnostics[actual]++;
  console.log('GATE_DENY',JSON.stringify({caller,ledgerId:kind.startsWith('C3-')?kind.slice(3):null,requestedKind:kind,actual,
    message:message.slice(0,500)}));
  return error;
}
const signed=(uid,provider='password')=>env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}).firestore();
const raw=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const rootRef=(db,id='g1')=>doc(db,'groupActivities',id);
const codeRef=(db,code='JOIN1')=>doc(db,'groupJoinCodes',code);
const childRef=(db,kind,id,activity='g1')=>doc(db,'groupActivities',activity,kind,id);
const activity={ownerId:'owner',classId:null,className:'',title:'Original',instructions:'Discuss',groupCount:2,
  durationSec:300,allowText:true,allowPhoto:true,allowFile:true,collectStudentNames:false,
  joinCode:'JOIN1',status:'open',startedAt:null,createdAt:new Date('2026-09-01'),updatedAt:new Date('2026-09-01')};
const photoPath='groupActivitySubmissions/owner/g1/groups/1/student/p/p.jpg';
const filePath='groupActivitySubmissions/owner/g1/groups/1/student/f/f.pdf';

async function seed(){
  await raw(async db=>{
    await setDoc(doc(db,'users','owner'),{role:'teacher',status:'active'});
    await setDoc(doc(db,'users','foreign'),{role:'teacher',status:'active'});
    await setDoc(doc(db,'users','admin'),{role:'admin',status:'active'});
    await setDoc(rootRef(db),activity);
    await setDoc(codeRef(db),{activityId:'g1',ownerId:'owner',createdAt:new Date()});
    await setDoc(childRef(db,'topics','1'),{group:1,topic:'Original topic',updatedAt:new Date()});
    await setDoc(childRef(db,'members','student'),{group:1,joinedAt:new Date(),joinCode:'JOIN1'});
    await setDoc(childRef(db,'notes','n0'),{group:1,text:'Historical note',participantId:'student',createdAt:new Date()});
    await setDoc(childRef(db,'photos','p'),{group:1,name:'p.jpg',storagePath:photoPath,
      size:1,contentType:'image/jpeg',participantId:'student',createdAt:new Date()});
    await setDoc(childRef(db,'files','f'),{group:1,name:'f.pdf',storagePath:filePath,
      size:1,contentType:'application/pdf',participantId:'student',createdAt:new Date()});
    assert.equal((await getDoc(rootRef(db))).data().status,'open');
  });
}
const softDelete=(db,id='g1')=>updateDoc(rootRef(db,id),{status:'deleted',statusBeforeDelete:'open',
  deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()});
const restore=(db,id='g1')=>updateDoc(rootRef(db,id),{status:'open',statusBeforeDelete:deleteField(),
  deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()});

test.before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-candidate-4a-post-4r',
    firestore:{rules,host:'127.0.0.1',port}});
});
test.after(async()=>{
  console.log('GATE_COUNTS',JSON.stringify(diagnostics));
  await env?.cleanup();
  if(!process.env.HCMA2_TEST_BASELINE_RULES&&!process.env.HCMA2_DIAGNOSTIC_ONLY)
  {
    assert.equal(diagnostics.null+diagnostics.expressionLimit+diagnostics.accessLimit+diagnostics.other,0,
      'Unapproved Candidate 4A Rules diagnostics');
    assert.equal(diagnostics.C3,15,'Documented C3 ledger must match exactly');
    for(const id of c3Ledger.keys())
      assert.equal(c3Seen.get(id),1,`Missing/extra C3 ${id}`);
  }
});
test.beforeEach(async()=>{await env.clearFirestore();await seed();});

test('owner normal management, soft delete, preserved tree and exact restore',async()=>{
  const owner=signed('owner');
  await assertSucceeds(updateDoc(rootRef(owner),{title:'Edited',updatedAt:serverTimestamp()}));
  await assertSucceeds(softDelete(owner));
  await raw(async db=>{
    const rootDoc=(await getDoc(rootRef(db))).data();
    assert.equal(rootDoc.status,'deleted');
    assert.equal(rootDoc.statusBeforeDelete,'open');
    assert.equal(rootDoc.deletedBy,'owner');
    assert.ok(rootDoc.deletedAt);
    assert.equal((await getDoc(childRef(db,'topics','1'))).data().topic,'Original topic');
    assert.equal((await getDoc(childRef(db,'members','student'))).data().group,1);
    assert.equal((await getDoc(childRef(db,'notes','n0'))).data().text,'Historical note');
    assert.equal((await getDoc(childRef(db,'photos','p'))).data().storagePath,photoPath);
    assert.equal((await getDoc(childRef(db,'files','f'))).data().storagePath,filePath);
    assert.equal((await getDoc(codeRef(db))).data().activityId,'g1');
  });
  await assertSucceeds(restore(owner));
  await raw(async db=>{
    const restored=(await getDoc(rootRef(db))).data();
    assert.equal(restored.status,'open');
    assert.equal(restored.title,'Edited');
    assert.ok(!('deletedAt' in restored));
    assert.ok(!('deletedBy' in restored));
    assert.ok(!('statusBeforeDelete' in restored));
    assert.equal((await getDoc(childRef(db,'topics','1'))).data().topic,'Original topic');
    assert.equal((await getDoc(childRef(db,'photos','p'))).data().storagePath,photoPath);
    assert.equal((await getDoc(childRef(db,'files','f'))).data().storagePath,filePath);
    assert.equal((await getDoc(codeRef(db))).data().activityId,'g1');
    assert.equal((await getDocs(collection(db,'groupActivities'))).size,1);
  });
  await assertSucceeds(getDoc(codeRef(signed('new','anonymous'))));
  const restoredStudent=signed('student','anonymous');
  assert.equal((await assertSucceeds(getDoc(childRef(restoredStudent,'photos','p')))).data().storagePath,photoPath);
  assert.equal((await assertSucceeds(getDoc(childRef(restoredStudent,'files','f')))).data().storagePath,filePath);
  await assertSucceeds(setDoc(childRef(signed('new','anonymous'),'members','new'),
    {group:2,joinedAt:serverTimestamp(),joinCode:'JOIN1'}));
});

test('foreign teacher and anonymous actor cannot delete or restore',async()=>{
  await assertFails(softDelete(signed('foreign')),'C3-D01');
  await assertFails(softDelete(signed('student','anonymous')));
  await assertSucceeds(softDelete(signed('owner')));
  await assertFails(restore(signed('foreign')),'C3-D02');
  await assertFails(restore(signed('student','anonymous')));
  await assertSucceeds(restore(signed('owner')));
});

test('admin follows post-4R management boundary',async()=>{
  const admin=signed('admin');
  await assertSucceeds(updateDoc(rootRef(admin),{status:'deleted',statusBeforeDelete:'open',
    deletedAt:serverTimestamp(),deletedBy:'admin',updatedAt:serverTimestamp()}));
  await assertSucceeds(restore(admin));
  await assertFails(deleteDoc(rootRef(admin)));
});

test('deletion metadata cannot be forged or bypassed',async()=>{
  const owner=signed('owner'),student=signed('student','anonymous');
  await assertFails(updateDoc(rootRef(student),{deletedAt:serverTimestamp(),deletedBy:'student'}));
  await assertFails(updateDoc(rootRef(owner),{status:'deleted',updatedAt:serverTimestamp()}),'C3-D03');
  await assertFails(updateDoc(rootRef(owner),{status:'deleted',statusBeforeDelete:'closed',
    deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()}),'C3-D04');
  await assertFails(updateDoc(rootRef(owner),{status:'deleted',statusBeforeDelete:'open',
    deletedAt:new Date('2020-01-01'),deletedBy:'owner',updatedAt:serverTimestamp()}),'C3-D05');
  await assertSucceeds(softDelete(owner));
  await assertFails(updateDoc(rootRef(owner),{status:'open',updatedAt:serverTimestamp()}),'R2');
  await assertFails(updateDoc(rootRef(owner),{title:'Changed while deleted',updatedAt:serverTimestamp()}),'R2');
  await assertFails(deleteDoc(rootRef(owner)));
  await assertFails(deleteDoc(codeRef(owner)));
});

test('candidate-only deleted root edit matches narrow R2 fixture',async()=>{
  const owner=signed('owner');
  await assertSucceeds(softDelete(owner));
  const error=await assertFails(updateDoc(rootRef(owner),
    {title:'Changed while deleted',updatedAt:serverTimestamp()}),'R2');
  assert.match(error.message,/evaluation error at L1088:24.*false for/);
});

test('deleted activity blocks code, student root, join and all submission writes',async()=>{
  const owner=signed('owner'),student=signed('student','anonymous'),fresh=signed('fresh','anonymous');
  await assertSucceeds(softDelete(owner));
  await assertFails(getDoc(codeRef(fresh)),'C3-D06');
  await assertFails(getDoc(rootRef(fresh)),'C3-D07');
  await assertFails(setDoc(childRef(fresh,'members','fresh'),{group:2,joinedAt:serverTimestamp(),joinCode:'JOIN1'}),'E2');
  await assertFails(setDoc(childRef(student,'notes','n1'),{group:1,text:'New',participantId:'student',createdAt:serverTimestamp()}),'C3-D08');
  await assertFails(setDoc(childRef(student,'photos','p1'),{group:1,name:'p.jpg',storagePath:
    'groupActivitySubmissions/owner/g1/groups/1/student/p1/p.jpg',size:1,contentType:'image/jpeg',
    participantId:'student',createdAt:serverTimestamp()}),'C3-D09');
  await assertFails(setDoc(childRef(student,'files','f1'),{group:1,name:'f.pdf',storagePath:
    'groupActivitySubmissions/owner/g1/groups/1/student/f1/f.pdf',size:1,contentType:'application/pdf',
    participantId:'student',createdAt:serverTimestamp()}),'C3-D10');
  await assertFails(updateDoc(childRef(student,'members','student'),{group:2}));
  await assertSucceeds(getDoc(rootRef(owner)));
});

test('baseline-only deleted child denial diagnostic', {skip:!process.env.HCMA2_TEST_BASELINE_RULES}, async()=>{
  await raw(async db=>updateDoc(rootRef(db),{status:'deleted',statusBeforeDelete:'open',
    deletedAt:new Date(),deletedBy:'owner'}));
  await raw(async db=>assert.equal((await getDoc(rootRef(db))).data().status,'deleted'));
  const student=signed('student','anonymous');
  await assertFails(setDoc(childRef(student,'notes','n1'),
    {group:1,text:'New',participantId:'student',createdAt:serverTimestamp()}));
  await assertFails(setDoc(childRef(student,'photos','p1'),{group:1,name:'p.jpg',storagePath:
    'groupActivitySubmissions/owner/g1/groups/1/student/p1/p.jpg',size:1,contentType:'image/jpeg',
    participantId:'student',createdAt:serverTimestamp()}));
  await assertFails(setDoc(childRef(student,'files','f1'),{group:1,name:'f.pdf',storagePath:
    'groupActivitySubmissions/owner/g1/groups/1/student/f1/f.pdf',size:1,contentType:'application/pdf',
    participantId:'student',createdAt:serverTimestamp()}));
  await assertFails(setDoc(childRef(signed('new','anonymous'),'members','new'),
    {group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1'}));
});

test('baseline-only foreign root denial diagnostic', {skip:!process.env.HCMA2_TEST_BASELINE_RULES}, async()=>{
  await raw(async db=>assert.equal((await getDoc(rootRef(db))).data().status,'open'));
  await assertFails(softDelete(signed('foreign')));
});

test('baseline-only existing open parent member-create diagnostic', {skip:!process.env.HCMA2_TEST_BASELINE_RULES}, async()=>{
  await raw(async db=>{
    await updateDoc(rootRef(db),{collectStudentNames:true});
    assert.equal((await getDoc(rootRef(db))).data().status,'open');
  });
  await assertFails(setDoc(childRef(signed('new','anonymous'),'members','new'),
    {group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1'}));
});

test('baseline-only deleted root title edit is allowed', {skip:!process.env.HCMA2_TEST_BASELINE_RULES}, async()=>{
  await raw(async db=>updateDoc(rootRef(db),{status:'deleted',statusBeforeDelete:'open',
    deletedAt:new Date(),deletedBy:'owner'}));
  await raw(async db=>assert.equal((await getDoc(rootRef(db))).data().status,'deleted'));
  await assertSucceeds(updateDoc(rootRef(signed('owner')),
    {title:'Baseline permits this edit',updatedAt:serverTimestamp()}));
});

test('existing field status supports bounded active and deleted queries without migration',async()=>{
  const owner=signed('owner');
  const active=()=>getDocs(query(collection(owner,'groupActivities'),where('ownerId','==','owner'),
    where('status','in',['draft','open','closed']),orderBy('createdAt','desc'),limit(100)));
  const deleted=()=>getDocs(query(collection(owner,'groupActivities'),where('ownerId','==','owner'),
    where('status','==','deleted'),orderBy('deletedAt','desc'),limit(100)));
  assert.equal((await assertSucceeds(active())).size,1);
  assert.equal((await assertSucceeds(deleted())).size,0);
  await assertSucceeds(softDelete(owner));
  assert.equal((await assertSucceeds(active())).size,0);
  assert.equal((await assertSucceeds(deleted())).size,1);
  await assertSucceeds(restore(owner));
  assert.equal((await assertSucceeds(active())).size,1);
  assert.equal((await assertSucceeds(deleted())).size,0);
});

test('admin queries all owners while owner query remains scoped',async()=>{
  await raw(async db=>setDoc(rootRef(db,'g2'),{...activity,ownerId:'foreign',joinCode:'JOIN2',status:'draft'}));
  const owner=signed('owner'),admin=signed('admin');
  const active=db=>getDocs(query(collection(db,'groupActivities'),
    where('status','in',['draft','open','closed']),orderBy('createdAt','desc'),limit(100)));
  const deleted=db=>getDocs(query(collection(db,'groupActivities'),
    where('status','==','deleted'),orderBy('deletedAt','desc'),limit(100)));
  assert.equal((await assertSucceeds(active(admin))).size,2);
  assert.equal((await assertSucceeds(getDocs(query(collection(owner,'groupActivities'),
    where('ownerId','==','owner'),where('status','in',['draft','open','closed']),
    orderBy('createdAt','desc'),limit(100))))).size,1);
  await assertSucceeds(softDelete(owner));
  assert.equal((await assertSucceeds(active(admin))).size,1);
  assert.equal((await assertSucceeds(deleted(admin))).size,1);
});

test('normal Group content and secure paths remain compatible',async()=>{
  const owner=signed('owner'),student=signed('student','anonymous');
  await assertSucceeds(getDoc(childRef(student,'topics','1')));
  await assertSucceeds(getDoc(childRef(student,'photos','p')));
  await assertSucceeds(getDoc(childRef(student,'files','f')));
  await assertSucceeds(setDoc(childRef(student,'notes','n1'),{group:1,text:'New',participantId:'student',createdAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(childRef(owner,'topics','1'),{topic:'Updated',updatedAt:serverTimestamp()}));
  await assertFails(getDoc(childRef(signed('foreign'),'photos','p')),'C3-D11');
});

test('candidate source and indexes preserve bounded lifecycle contract',()=>{
  const source=readFileSync(path.join(root,'index.html'),'utf8');
  const indexes=JSON.parse(readFileSync(path.join(root,'firestore.indexes.json'),'utf8'));
  const lifecycle=source.slice(source.indexOf('async function softDeleteGroupActivity'),source.indexOf('// GATE 2A-S: the only place'));
  assert.match(lifecycle,/updateDoc\(aRef,\{status:"deleted"/);
  assert.doesNotMatch(lifecycle,/deleteDoc|deleteObject|deleteRefsInChunks/);
  assert.match(source,/where\("status","in",\["draft","open","closed"\]\)/);
  assert.match(source,/where\("status","==","deleted"\)/);
  assert.match(source,/limit\(pageSize\)/);
  assert.equal(indexes.indexes.filter(x=>x.collectionGroup==='groupActivities').length,4);
});

test('draft and closed restore to exact prior state; repeated delete is denied',async()=>{
  const owner=signed('owner');
  for(const priorStatus of ['draft','closed']){
    await raw(db=>updateDoc(rootRef(db),{status:priorStatus}));
    await assertSucceeds(updateDoc(rootRef(owner),{status:'deleted',statusBeforeDelete:priorStatus,
      deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(rootRef(owner),{status:'deleted',statusBeforeDelete:priorStatus,
      deletedAt:serverTimestamp(),deletedBy:'owner',updatedAt:serverTimestamp()}),
      priorStatus==='draft'?'C3-D12':'C3-D14');
    await assertFails(updateDoc(rootRef(owner),{status:'open',statusBeforeDelete:deleteField(),
      deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()}),
      priorStatus==='draft'?'C3-D13':'C3-D15');
    await assertSucceeds(updateDoc(rootRef(owner),{status:priorStatus,statusBeforeDelete:deleteField(),
      deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()}));
    assert.equal((await getDoc(rootRef(owner))).data().status,priorStatus);
  }
});

test('open/closed lifecycle and timer edits remain available only while active',async()=>{
  const owner=signed('owner');
  await assertSucceeds(updateDoc(rootRef(owner),{status:'closed',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(rootRef(owner),{status:'open',startedAt:serverTimestamp(),
    pausedRemainingSec:null,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(rootRef(owner),{durationSec:600,startedAt:serverTimestamp(),
    updatedAt:serverTimestamp()}));
  await assertSucceeds(softDelete(owner));
  await assertFails(updateDoc(rootRef(owner),{durationSec:900,updatedAt:serverTimestamp()}),'R2');
});

test('collectStudentNames and member displayName contract stays compatible',async()=>{
  const fresh=signed('fresh','anonymous');
  await assertSucceeds(setDoc(childRef(fresh,'members','fresh'),
    {group:2,joinedAt:serverTimestamp(),joinCode:'JOIN1'}));
  await raw(db=>updateDoc(rootRef(db),{collectStudentNames:true}));
  const named=signed('named','anonymous');
  await assertFails(setDoc(childRef(named,'members','named'),
    {group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1'}),'E2');
  await assertSucceeds(setDoc(childRef(named,'members','named'),
    {group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1',displayName:'Student Name'}));
  await raw(db=>updateDoc(rootRef(db),{collectStudentNames:false}));
  const extra=signed('extra','anonymous');
  await assertSucceeds(setDoc(childRef(extra,'members','extra'),
    {group:1,joinedAt:serverTimestamp(),joinCode:'JOIN1'}));
});

test('RichText V1/V2 source and topic writes remain accepted',async()=>{
  const owner=signed('owner');
  for(const version of [1,2]){
    const rich={version,blocks:[{type:'paragraph',runs:[{text:'Hello'}]}]};
    await assertSucceeds(updateDoc(rootRef(owner),{instructionsRich:rich,updatedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(childRef(owner,'topics','1'),{topicRich:rich,updatedAt:serverTimestamp()}));
    assert.equal((await assertSucceeds(getDoc(rootRef(owner)))).data().instructionsRich.version,version);
  }
});
