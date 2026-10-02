import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { createTrashQueryContract, mergeTrashItems, unifiedTrashView } from '../../trash-query-contract.mjs';

const rules = readFileSync(new URL('../../firestore.rules.production-candidate', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({projectId:'demo-candidate-5b',firestore:{host:'127.0.0.1',port:8418,rules}});
const adapter = createTrashQueryContract({collection,query,where,orderBy,limit,startAfter,getDocs});
const teacher = id => env.authenticatedContext(id,{firebase:{sign_in_provider:'password'}}).firestore();
const student = () => env.authenticatedContext('student',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const raw = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const date = day => new Date(`2026-09-${String(day).padStart(2,'0')}T00:00:00Z`);
const user = (db,id) => setDoc(doc(db,'users',id),{role:'teacher',status:'active'});
test.after(async () => env.cleanup());

test('presentation state: empty, filters, mixed order, one adapter failure', () => {
  const record=(module,id,day)=>({module,sourceId:id,deletedAt:date(day)});
  const pages={interaction:{items:[],error:null,hasMore:false},group:{items:[],error:null,hasMore:false}};
  assert.deepEqual(unifiedTrashView(pages).items,[]);
  pages.interaction.items=[record('interaction','s1',23),record('interaction','s2',18)];
  assert.deepEqual(unifiedTrashView(pages).items.map(x=>x.sourceId),['s1','s2']);
  pages.group.items=[record('group','g1',20)];
  assert.deepEqual(unifiedTrashView(pages).items.map(x=>x.sourceId),['s1','g1','s2']);
  assert.deepEqual(unifiedTrashView(pages,'interaction').items.map(x=>x.sourceId),['s1','s2']);
  assert.deepEqual(unifiedTrashView(pages,'group').items.map(x=>x.sourceId),['g1']);
  pages.interaction.error=new Error('offline');
  assert.deepEqual(unifiedTrashView(pages).failed,['interaction']);
  assert.deepEqual(unifiedTrashView(pages,'group').items.map(x=>x.sourceId),['g1']);
  pages.group.hasMore=true;
  assert.equal(unifiedTrashView(pages,'group').hasMore,true);
  assert.throws(()=>unifiedTrashView(pages,'knowledge'));
});

test('empty, Interaction only, 305-active boundary, cursor, ownership, anonymous denial, restore', async () => {
  await env.clearFirestore();
  await raw(async db => {
    await Promise.all([user(db,'owner'),user(db,'other'),user(db,'student')]);
    await Promise.all(Array.from({length:305},(_,i)=>setDoc(doc(db,'sessions',`active-${i}`),
      {ownerId:'owner',title:'Active',status:'closed',createdAt:date(25)})));
  });
  const db=teacher('owner');
  assert.equal((await adapter.interaction({db,ownerId:'owner'})).items.length,0);
  await raw(async admin => {
    await setDoc(doc(admin,'sessions','old'),{ownerId:'owner',title:'Old',status:'closed',createdAt:date(1),deletedAt:date(2)});
    await setDoc(doc(admin,'sessions','new'),{ownerId:'owner',title:'New',status:'closed',createdAt:date(25),deletedAt:date(26)});
    await setDoc(doc(admin,'sessions','foreign'),{ownerId:'other',title:'Foreign',status:'closed',deletedAt:date(27)});
  });
  const p1=await assertSucceeds(adapter.interaction({db,ownerId:'owner',pageSize:1}));
  const p2=await assertSucceeds(adapter.interaction({db,ownerId:'owner',pageSize:1,cursor:p1.cursor}));
  assert.deepEqual([...p1.items,...p2.items].map(x=>x.sourceId),['new','old']);
  assert.equal(p1.hasMore,true);assert.equal(p2.hasMore,false);
  await assertFails(adapter.interaction({db,ownerId:'other'}));
  await assertFails(adapter.interaction({db:student(),ownerId:'owner'}));
  await assertFails(updateDoc(doc(teacher('other'),'sessions','old'),{deletedAt:null,deletedBy:null,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(db,'sessions','old'),{deletedAt:null,deletedBy:null,updatedAt:serverTimestamp()}));
  assert.deepEqual((await adapter.interaction({db,ownerId:'owner'})).items.map(x=>x.sourceId),['new']);
});

test('Group only and mixed order, owner isolation, prior status, descendants and join code preserved', async () => {
  await env.clearFirestore();
  await raw(async db => {
    await Promise.all([user(db,'owner'),user(db,'other'),user(db,'student')]);
    await setDoc(doc(db,'groupActivities','g1'),{ownerId:'owner',title:'Group',status:'deleted',statusBeforeDelete:'closed',deletedAt:date(20),deletedBy:'owner',joinCode:'ABCDE1',updatedAt:date(20)});
    await setDoc(doc(db,'groupActivities','g1','topics','1'),{topic:'Unchanged'});
    await setDoc(doc(db,'groupActivities','g-active'),{ownerId:'owner',status:'open',createdAt:date(21)});
    await setDoc(doc(db,'groupActivities','g-other'),{ownerId:'other',status:'deleted',statusBeforeDelete:'draft',deletedAt:date(25)});
  });
  const db=teacher('owner');
  assert.equal((await adapter.interaction({db,ownerId:'owner'})).items.length,0);
  const gp=await assertSucceeds(adapter.group({db,ownerId:'owner'}));
  assert.deepEqual(gp.items.map(x=>x.sourceId),['g1']);
  assert.equal(gp.items[0].originalStatus,'closed');
  await raw(db=>setDoc(doc(db,'sessions','s1'),{ownerId:'owner',title:'Session',status:'closed',deletedAt:date(22)}));
  const ip=await adapter.interaction({db,ownerId:'owner'});
  assert.deepEqual(mergeTrashItems(ip.items,gp.items).map(x=>x.sourceId),['s1','g1']);
  assert.deepEqual(mergeTrashItems(ip.items,[]).map(x=>x.module),['interaction']);
  assert.deepEqual(mergeTrashItems([],gp.items).map(x=>x.module),['group']);
  await assertFails(adapter.group({db,ownerId:'other'}));
  await assertFails(adapter.group({db:student(),ownerId:'owner'}));
  await assertFails(updateDoc(doc(teacher('other'),'groupActivities','g1'),{status:'closed',statusBeforeDelete:deleteField(),deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(db,'groupActivities','g1'),{status:'closed',statusBeforeDelete:deleteField(),deletedAt:deleteField(),deletedBy:deleteField(),updatedAt:serverTimestamp()}));
  const restored=await getDoc(doc(db,'groupActivities','g1'));
  assert.equal(restored.data().joinCode,'ABCDE1');assert.equal(restored.data().status,'closed');
  assert.equal((await getDoc(doc(db,'groupActivities','g1','topics','1'))).data().topic,'Unchanged');
  assert.equal((await adapter.group({db,ownerId:'owner'})).items.length,0);
});
