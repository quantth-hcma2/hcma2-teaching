// LOCAL ONLY: demo project + loopback emulator. Exercises the actual index.html save function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { assertLegacyWritable } from '../../session-reader.mjs';
import { valuesEqualDeep, findConflictKey } from '../../session-info-compare.mjs';
import { FakeDocument } from '../gate2b-rt-editor/fake-editor-dom.mjs';
import { legacyPlainTextToDom, serializeToRichText, richTextToDom } from '../../rich-text-editor-serializer.mjs';
import { richTextToPlainText } from '../../rich-text-contract.mjs';
import { renderRichText } from '../../rich-text-renderer.mjs';

const PORT = Number(process.env.GROUP_LONG_EMULATOR_PORT || 8299);
const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const saveSource = source.slice(source.indexOf('function sessionInfoError('), source.indexOf('// GATE 2B-RT-INTEGRATION: which SESSION_INFO_FIELDS'));
let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-hcma2-group-long', firestore: {
    host: '127.0.0.1', port: PORT, rules: readFileSync(new URL('../../firestore.rules.production-candidate', import.meta.url), 'utf8')
  } });
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const uid of ['owner', 'other']) await setDoc(doc(db, 'users', uid), { role: 'teacher', status: 'active' });
    await setDoc(doc(db, 'groupActivities', 'synthetic-long'), {
      ownerId: 'owner', title: 'Synthetic only', groupCount: 2, status: 'open', instructions: 'old'
    });
    await setDoc(doc(db, 'groupActivities', 'synthetic-long', 'topics', '1'), { group: 1, topic: 'old' });
    await setDoc(doc(db, 'groupActivities', 'synthetic-long', 'topics', '2'), { group: 2, topic: 'other group' });
    await setDoc(doc(db, 'groupActivities', 'synthetic-long', 'members', 'student'), { group: 1, joinedAt: new Date(), joinCode: 'SYNTHETIC' });
  });
});
function teacher(uid = 'owner') { return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore(); }
function student(uid = 'student') { return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore(); }
function patch(field, text) {
  const d = new FakeDocument(), root = d.createElement('div');
  root.appendChild(legacyPlainTextToDom(d, text));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  return { richKey: field + 'Rich', richValue: result.value, plainKey: field, plainValue: richTextToPlainText(result.value) };
}
async function saveFixture(db) {
  // Keep the extracted function in the SDK's realm: a VM Object prototype is rejected by
  // Firestore's plain-object check even though the actual browser save has no realm boundary.
  const bindings = { db, doc, getDoc, runTransaction, serverTimestamp, assertLegacyWritable,
    valuesEqualDeep, findConflictKey, STATE: { user: { uid: 'owner' }, profile: { role: 'teacher', status: 'active' } } };
  const ctx = new Function(...Object.keys(bindings), saveSource + '\nreturn { saveSessionInfo };')(...Object.values(bindings));
  const refs = [doc(db, 'groupActivities', 'synthetic-long'), doc(db, 'groupActivities', 'synthetic-long', 'topics', '1')];
  const rows = await Promise.all(refs.map(async (ref, i) => ({ ref, original: (await getDoc(ref)).data(), fields: i ? ['topic'] : ['title', 'instructions'], ...(i ? { group: 1 } : {}) })));
  return { ctx, model: { kind: 'groupActivities', uid: 'owner', rows }, values: [{ title: 'Synthetic only' }, {}] };
}
for (const field of ['instructions', 'topic']) {
  test(`${field}: actual transaction saves 10000 chars + mirror; student reads and safe renderer retains all`, async () => {
    const db = teacher(), { ctx, model, values } = await saveFixture(db);
    const rp = patch(field, 'ế😀'.repeat(5000)), patches = field === 'instructions' ? [rp, null] : [null, rp];
    assert.equal(await ctx.saveSessionInfo(model, values, patches), true);
    const index = field === 'instructions' ? 0 : 1;
    const refPath = model.rows[index].ref.path;
    const stored = (await getDoc(doc(student(), refPath))).data();
    assert.equal(stored[field], rp.plainValue);
    assert.deepEqual(stored[field + 'Rich'], rp.richValue);
    const d = new FakeDocument(), view = d.createElement('div'), reload = d.createElement('div');
    renderRichText(view, stored[field + 'Rich'], stored[field], d);
    assert.equal(view.textContent, rp.plainValue);
    reload.appendChild(richTextToDom(d, stored[field + 'Rich']));
    assert.deepEqual(serializeToRichText(reload).value, rp.richValue);
    await assertFails(updateDoc(doc(student(), refPath), { [field]: 'unauthorized' }));
    await assertFails(updateDoc(doc(teacher('other'), refPath), { [field]: 'unauthorized' }));
  });
}
test('common + topic save atomically with multiline/HTML-like inert text and rich formatting', async () => {
  const { ctx, model, values } = await saveFixture(teacher());
  const text = '<img src=x onerror=alert(1)>'.repeat(50) + '\n\n' + 'Nhiệm vụ '.repeat(100);
  const patches = [patch('instructions', text), patch('topic', text)];
  for (const p of patches) for (const run of p.richValue.blocks[0].runs) run.bold = true;
  assert.equal(await ctx.saveSessionInfo(model, values, patches), true);
  for (let i = 0; i < 2; i++) {
    const stored = (await getDoc(model.rows[i].ref)).data(), p = patches[i];
    assert.equal(stored[p.plainKey], text);
    assert.equal(stored[p.richKey].blocks[0].runs[0].bold, true);
  }
  await assertFails(getDoc(doc(student(), 'groupActivities', 'synthetic-long', 'topics', '2')));
  await assertFails(getDoc(doc(student('nonmember'), 'groupActivities', 'synthetic-long', 'topics', '1')));
});
test('concurrent topic edit blocks the whole transaction, leaving common unchanged', async () => {
  const db = teacher(), { ctx, model, values } = await saveFixture(db);
  await updateDoc(model.rows[1].ref, { topic: 'external edit' });
  await assert.rejects(ctx.saveSessionInfo(model, values, [patch('instructions', 'a'.repeat(1000)), patch('topic', 'b'.repeat(1000))]));
  assert.equal((await getDoc(model.rows[0].ref)).data().instructions, 'old');
  assert.equal((await getDoc(model.rows[1].ref)).data().topic, 'external edit');
});
