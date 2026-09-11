// Gate 1B.2C — lifecycle-bridge emulator tests. Real local Firestore emulator loaded with the
// UNCHANGED Gate 1B.2B candidate Rules (this gate does not modify Rules at all). Proves the
// exact write shapes teacherLiveControl's handlers use (openSession/closeSession/reopenSession/
// archiveSession/toggleResults/switchQuestion/editSessionTime) still succeed against an
// activated contract session and never mutate contract identity/config fields, proves the
// stale-legacy-client DENY still holds, proves resolveSessionSemantics() reads the real
// Firestore-backed facade correctly (not just the pure mock facade), and proves a SYNTHETIC
// (emulator-only, never production) revision-1 fixture resolves to the revision-1 manifest, not
// the frozen root fields. Everything here is synthetic/emulator only — no production write of
// any kind, and applyConfigRevision() itself is never called from production in this suite.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract } from "../../contract-writer.mjs";
import { resolveSessionSemantics, assertLegacyWritable, isContractSession, makeFirestoreDbFacade, ReaderError } from "../../session-reader.mjs";
import { qrModalViewModel, presentationRenderState, buildInteractionJsonExport } from "../../session-view.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B2C_EMULATOR_PORT || 8180);
const PROJECT_ID = "demo-hcma2-gate1b2c";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
  });
}

const legacySessionFixture = (overrides) => ({
  ownerId: "teacher-a", classId: "c1", className: "K77.A01", title: "Cũ", description: "Mô tả cũ",
  status: "closed", accessToken: "tok-xxxxxxxxxxxxxxxxxxxxxxxxxxx", shortCode: "ABC123",
  showResults: "hidden", allowMultipleResponses: false, anonymous: true, showResponderCount: true,
  startedAt: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  questionCount: 1, responseCount: 0, activeQuestionId: "q1", activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1, ...overrides
});
async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "sessions", id), legacySessionFixture(overrides)); });
}
async function seedQuestion(sessionId, id, overrides) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", id), { ownerId: "teacher-a", sessionId, order: 0, question: "Câu hỏi?", type: "single", chartType: "bar", timeLimit: 0, ...overrides });
  });
}

function writerFor(ctx) { return { db: db(ctx), firestore: firestoreFns }; }

async function activateAndFetch(sessionId) {
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId, actorUid: "teacher-a", operationId: "op-" + sessionId });
  const root = (await getDoc(doc(w.db, "sessions", sessionId))).data();
  return { activation, root, w };
}

function contractIdentity(root) {
  return {
    editContractVersion: root.editContractVersion,
    configRevision: root.configRevision,
    currentConfigId: root.currentConfigId,
    lastOperationId: root.lastOperationId,
    contractActivatedAtMillis: root.contractActivatedAt.toMillis()
  };
}

// =====================================================================================
// LIFECYCLE — exact write shapes teacherLiveControl's handlers use, post-activation
// =====================================================================================

test("bridge lifecycle: reopen (closed->open), matching reopenSession()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root: before, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  const sessionRef = doc(a, "sessions", "s1");

  await assertSucceeds(updateDoc(sessionRef, {
    status: "open", closedAt: null, activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.status, "open");
  assert.deepEqual(contractIdentity(after), contractIdentity(before));
});

test("bridge lifecycle: open (ready/draft->open), matching openSession()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" }); await seedQuestion("s1", "q1");
  const { root: activated, w } = await activateAndFetch("s1");
  // Force back to a pre-open lifecycle state the way a fresh contract session would sit (this
  // fixture activates from closed per family rules, so simulate a subsequent close->reopen->open
  // cycle instead of an unrealistic ready-state contract session).
  const a = db(teacherCtx("teacher-a"));
  const sessionRef = doc(a, "sessions", "s1");
  await assertSucceeds(updateDoc(sessionRef, {
    status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.status, "open");
  assert.deepEqual(contractIdentity(after), contractIdentity(activated));
});

test("bridge lifecycle: close, matching closeSession()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root: activated, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  const sessionRef = doc(a, "sessions", "s1");
  await assertSucceeds(updateDoc(sessionRef, { status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(sessionRef, { status: "closed", closedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.status, "closed");
  assert.deepEqual(contractIdentity(after), contractIdentity(activated));
});

test("bridge lifecycle: archive, matching archiveSession()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root: before, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "archived", updatedAt: serverTimestamp() }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.status, "archived");
  assert.deepEqual(contractIdentity(after), contractIdentity(before));
});

test("bridge lifecycle: toggle results, matching toggleResults()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root: before, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { showResults: "live", updatedAt: serverTimestamp() }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.showResults, "live");
  assert.deepEqual(contractIdentity(after), contractIdentity(before));
});

test("bridge lifecycle: switch active question, matching switchQuestion()'s exact write, PASS and contract identity unchanged — never touches questions/{id} content", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1"); await seedQuestion("s1", "q2", { order: 1 });
  const { root: before, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { activeQuestionId: "q2", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.activeQuestionId, "q2");
  assert.deepEqual(contractIdentity(after), contractIdentity(before));
  const q2 = (await getDoc(doc(w.db, "questions", "q2"))).data();
  assert.equal(q2.question, "Câu hỏi?", "switching the active pointer must never touch question content");
});

test("bridge lifecycle: timer change, matching editSessionTime()'s exact write shape (session-root part + questions/{id}.timeLimit part), PASS, contract identity unchanged, question TEXT untouched", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1", { timeLimit: 0 });
  const { w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  // editSessionTime()'s "session is open" branch also touches activeQuestionStartedAt — open
  // the session first via the same lifecycle write already proven above.
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const before = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  // Mirrors editSessionTime()'s writeBatch(): questions/{id}.timeLimit + session-root activeQuestionStartedAt/updatedAt.
  const batch = firestoreFns.writeBatch(a);
  batch.update(doc(a, "questions", "q1"), { timeLimit: 60, updatedAt: serverTimestamp() });
  batch.update(doc(a, "sessions", "s1"), { activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  const afterRoot = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  const afterQ = (await getDoc(doc(w.db, "questions", "q1"))).data();
  assert.equal(afterQ.timeLimit, 60);
  assert.equal(afterQ.question, "Câu hỏi?", "timer change must never touch question text");
  assert.deepEqual(contractIdentity(afterRoot), contractIdentity(before));
});

test("bridge lifecycle: responseCount/liveAggregate auto-write, matching watchResponses()'s exact write, PASS and contract identity unchanged", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root: before, w } = await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), {
    responseCount: 3, updatedAt: serverTimestamp(),
    liveAggregate: { questionId: "q1", chartType: "bar", agg: {}, respondedCount: 3, openAnswers: [], updatedAt: new Date() }
  }));
  const after = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(after.responseCount, 3);
  assert.deepEqual(contractIdentity(after), contractIdentity(before));
});

// =====================================================================================
// STALE LEGACY CLIENT — must still be denied (bridge must not weaken this)
// =====================================================================================

test("bridge must not weaken stale-client protection: direct title/description write after activation still DENY", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  await activateAndFetch("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { title: "Sửa lén qua bridge", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", title: "Sửa lén kèm status hợp lệ", updatedAt: serverTimestamp() }));
});

test("Gate 1A editor guard (assertLegacyWritable) still rejects a contract session even called directly, outside the UI", async () => {
  await seedUsers(); await seedSession("s1"); await seedQuestion("s1", "q1");
  const { root } = await activateAndFetch("s1");
  assert.equal(isContractSession(root), true);
  assert.throws(
    () => assertLegacyWritable(root),
    (e) => { assert.ok(e instanceof ReaderError); assert.equal(e.code, "CONTRACT_SESSION_NOT_WRITABLE"); return true; }
  );
});

test("Gate 1A editor guard: legacy (non-activated) session is unaffected — assertLegacyWritable does not throw", async () => {
  await seedUsers(); await seedSession("s1");
  const snap = await getDoc(doc(db(teacherCtx("teacher-a")), "sessions", "s1"));
  assert.doesNotThrow(() => assertLegacyWritable(snap.data()));
});

// =====================================================================================
// resolveSessionSemantics() AGAINST THE REAL FIRESTORE-BACKED FACADE (not the pure mock)
// =====================================================================================

test("resolveSessionSemantics via the real Firestore facade: revision 0 matches the activation baseline", async () => {
  await seedUsers(); await seedSession("s1", { title: "Khởi động", description: "Mô tả cũ" }); await seedQuestion("s1", "q1");
  const { activation, root, w } = await activateAndFetch("s1");
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const result = await resolveSessionSemantics(dbFacade, "sessions/s1", root, "interaction");
  assert.equal(result.source, "contract");
  assert.equal(result.configId, activation.resultingConfigId);
  assert.equal(result.title, "Khởi động");
  assert.equal(result.description, "Mô tả cũ");
});

test("SYNTHETIC (emulator-only) revision 1 fixture: resolveSessionSemantics via the real Firestore facade returns the revision-1 manifest, never the frozen root fields — never created in production", async () => {
  await seedUsers();
  // Build a synthetic post-apply_config state directly via rules-disabled seeding, exactly as
  // the P2/P1 gates' own tests do for fixture setup — this never touches production and
  // applyConfigRevision() itself is never called anywhere in this suite.
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1"), legacySessionFixture({
      title: "Khởi động (cũ)", description: "Mô tả cũ",
      editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1",
      lastOperationId: "op-rev1", contractActivatedAt: new Date()
    }));
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg0"), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (cũ)", description: "Mô tả cũ"
    });
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg1"), {
      revision: 1, kind: "interaction", source: "apply_config", parentConfigId: "cfg0",
      active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (đã sửa — REVISION 1)", description: "Mô tả MỚI sau apply_config"
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const root = (await getDoc(doc(a, "sessions", "s1"))).data();
  const dbFacade = makeFirestoreDbFacade(a, firestoreFns);
  const result = await resolveSessionSemantics(dbFacade, "sessions/s1", root, "interaction");
  assert.equal(result.configId, "cfg1");
  assert.equal(result.title, "Khởi động (đã sửa — REVISION 1)");
  assert.equal(result.description, "Mô tả MỚI sau apply_config");
  assert.notEqual(result.title, root.title, "sanity: the synthetic fixture's root and effective title really do differ");
});

// =====================================================================================
// REGRESSION: legacy (non-activated) session lifecycle unchanged
// =====================================================================================

test("regression: legacy (non-activated) session — full lifecycle continues to work exactly as before, resolveSessionSemantics returns root fields", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed", title: "Phiên chưa kích hoạt", description: "Mô tả" }); await seedQuestion("s1", "q1");
  const a = db(teacherCtx("teacher-a"));
  const sessionRef = doc(a, "sessions", "s1");
  await assertSucceeds(updateDoc(sessionRef, { status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(sessionRef, { title: "Đổi tên qua Gate 1A", description: "Mô tả mới", updatedAt: serverTimestamp() }));
  const root = (await getDoc(sessionRef)).data();
  assert.equal(root.title, "Đổi tên qua Gate 1A");
  const dbFacade = makeFirestoreDbFacade(a, firestoreFns);
  const result = await resolveSessionSemantics(dbFacade, "sessions/s1", root, "interaction");
  assert.equal(result.source, "legacy");
  assert.equal(result.title, "Đổi tên qua Gate 1A");
});

// =====================================================================================
// GATE 1B.2C-T — END-TO-END CONSUMER CHAIN: real Firestore revision-1 fixture ->
// resolveSessionSemantics() -> the exact view-model functions showQrModal/teacherReportView's
// export path call. This is the direct proof that the CONSUMERS use the resolved value, not
// just that resolveSessionSemantics() itself is correct in isolation.
// =====================================================================================

test("end-to-end: QR modal view-model reflects the REAL emulator-resolved revision-1 title, never the stale root title teacherLiveControl would have shown before this fix", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1"), legacySessionFixture({
      title: "Khởi động (cũ)", description: "Mô tả cũ", shortCode: "QRC001",
      editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1",
      lastOperationId: "op-rev1", contractActivatedAt: new Date()
    }));
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg0"), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (cũ)", description: "Mô tả cũ"
    });
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg1"), {
      revision: 1, kind: "interaction", source: "apply_config", parentConfigId: "cfg0",
      active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (đã sửa — REVISION 1)", description: "Mô tả MỚI sau apply_config"
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const root = (await getDoc(doc(a, "sessions", "s1"))).data();
  // Exactly what teacherLiveControl does before wiring the QR button's onclick.
  const dbFacade = makeFirestoreDbFacade(a, firestoreFns);
  const displaySemantics = await resolveSessionSemantics(dbFacade, "sessions/s1", root, "interaction");
  // Exactly what showQrModal(session, sessionId, displaySemantics.title) does internally.
  const qrVm = qrModalViewModel(root, displaySemantics.title);
  assert.equal(qrVm.title, "Khởi động (đã sửa — REVISION 1)");
  assert.notEqual(qrVm.title, root.title, "must differ from the session's own stale root title");
});

test("end-to-end: JSON export payload reflects the REAL emulator-resolved revision-1 title, never the stale root title", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1"), legacySessionFixture({
      title: "Khởi động (cũ)", description: "Mô tả cũ",
      editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1",
      lastOperationId: "op-rev1", contractActivatedAt: new Date()
    }));
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg0"), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (cũ)", description: "Mô tả cũ"
    });
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfg1"), {
      revision: 1, kind: "interaction", source: "apply_config", parentConfigId: "cfg0",
      active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Khởi động (đã sửa — REVISION 1)", description: "Mô tả MỚI sau apply_config"
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const root = (await getDoc(doc(a, "sessions", "s1"))).data();
  // Exactly what teacherReportView does before wiring the JSON export button.
  const dbFacade = makeFirestoreDbFacade(a, firestoreFns);
  const displaySemantics = await resolveSessionSemantics(dbFacade, "sessions/s1", root, "interaction");
  // Exactly what exportSessionJSON(session, className, questionBlocks, displaySemantics.title) does internally.
  const jsonPayload = buildInteractionJsonExport(root, "K77.A01", [], displaySemantics.title);
  assert.equal(jsonPayload.hoatDong, "Khởi động (đã sửa — REVISION 1)");
  assert.notEqual(jsonPayload.hoatDong, root.title, "must differ from the session's own stale root title");
});

test("end-to-end: a REAL activated (revision 0) contract session's Presentation render state is contract-unsupported, never displays any title (old or new)", async () => {
  await seedUsers(); await seedSession("s1", { title: "Khởi động", status: "closed" }); await seedQuestion("s1", "q1");
  const { root } = await activateAndFetch("s1");
  const state = presentationRenderState(root);
  assert.equal(state.mode, "contract-unsupported");
  assert.equal("title" in state, false);
});
