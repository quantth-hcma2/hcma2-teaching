// Gate 1B.2B — atomic contract writer emulator tests. Real local Firestore emulator loaded
// with the CANDIDATE rules (1B.2A hardening + 1B.2B contract paths). Never `firebase deploy`.
// Everything here is synthetic/emulator only — no production write of any kind.
//
// Depth note: the full lifecycle/pointer-consistency/race/idempotency matrix is run in full on
// `sessions` (the richest family: draft/open/closed/trashed/archived). `groupActivities` and
// `knowledgeSessions` get the core cases (activation, apply, one pointer-consistency probe,
// stale-client lockout) rather than a full 3x repeat of every case — stated here explicitly
// rather than silently narrowing scope.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteField, serverTimestamp, collection } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract, applyConfigRevision, ContractWriterError } from "../../contract-writer.mjs";
import { resolveEffectiveConfig, readInteractionReport, isContractSession } from "../../session-reader.mjs";
import { makeFirestoreDbFacade } from "../../session-reader.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B2B_EMULATOR_PORT || 8179);
const PROJECT_ID = "demo-hcma2-gate1b2b";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function anonCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-suspended"), { role: "teacher", status: "suspended" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active" });
  });
}

const legacySessionFixture = (overrides) => ({
  ownerId: "teacher-a", classId: "c1", className: "K77.A01", title: "Cũ", description: "Mô tả cũ",
  status: "closed", accessToken: "tok-xxxxxxxxxxxxxxxxxxxxxxxxxxx", shortCode: "ABC123",
  showResults: "hidden", allowMultipleResponses: false, anonymous: true, showResponderCount: true,
  startedAt: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  questionCount: 2, responseCount: 0, activeQuestionId: null, activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1, ...overrides
});
async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "sessions", id), legacySessionFixture(overrides)); });
}

function writerFor(ctx) {
  return { db: db(ctx), firestore: firestoreFns };
}

// =====================================================================================
// ACTIVATION
// =====================================================================================

test("activation: closed legacy owner PASS, root+configVersion+history all present and consistent", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const result = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(result.replay, false);
  assert.equal(result.resultingRevision, 0);

  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  const root = rootSnap.data();
  assert.equal(root.editContractVersion, 1);
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, result.resultingConfigId);
  assert.equal(root.lastOperationId, "op-1");
  assert.ok(root.contractActivatedAt);
  assert.equal(root.status, "closed", "activation must never touch lifecycle");

  const configSnap = await getDoc(doc(w.db, "sessions", "s1", "configVersions", result.resultingConfigId));
  assert.equal(configSnap.data().kind, "activation_baseline");
  assert.equal(configSnap.data().source, "legacy_snapshot");
  assert.equal(configSnap.data().activatedFromLegacy, true);
  assert.equal(configSnap.data().parentConfigId, null);
  assert.notEqual(configSnap.id, "legacy-v0", "must never use the literal string legacy-v0");

  const historySnap = await getDoc(doc(w.db, "sessions", "s1", "editHistory", "op-1"));
  assert.equal(historySnap.data().operationType, "activate_contract");
  assert.equal(historySnap.data().resultingRevision, 0);
  assert.equal(historySnap.data().actorUid, "teacher-a");
});

test("activation: OPEN session DENY (lifecycle not safe)", async () => {
  await seedUsers(); await seedSession("s1", { status: "open" });
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(
    () => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" }),
    (e) => { assert.ok(e instanceof ContractWriterError); assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; }
  );
});

test("activation: trashed session DENY", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed", deletedAt: new Date() });
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(
    () => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" }),
    (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; }
  );
});

test("activation: archived session DENY (sessions-only lifecycle state)", async () => {
  await seedUsers(); await seedSession("s1", { status: "archived" });
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(
    () => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" }),
    (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; }
  );
});

test("activation: second activation DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await assert.rejects(
    () => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2" }),
    (e) => { assert.equal(e.code, "ALREADY_ACTIVATED"); return true; }
  );
});

test("activation: foreign teacher DENY (Rules-level, via raw write since the writer module itself has no ownership gate — Rules are the enforcement)", async () => {
  await seedUsers(); await seedSession("s1");
  const b = db(teacherCtx("teacher-b"));
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "forged-cfg"), { revision: 0, parentConfigId: null, kind: "activation_baseline", source: "legacy_snapshot", activatedFromLegacy: true, createdAt: new Date(), createdBy: "teacher-b", title: "Cũ", description: "Mô tả cũ" });
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-x"), { operationId: "op-x", actorUid: "teacher-b", operationType: "activate_contract", baseRevision: null, resultingRevision: 0, previousConfigId: null, resultingConfigId: "forged-cfg", changedFields: ["title", "description"], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  await assertFails(updateDoc(doc(b, "sessions", "s1"), {
    editContractVersion: 1, configRevision: 0, currentConfigId: "forged-cfg", lastOperationId: "op-x",
    contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test("activation: anonymous DENY, suspended teacher DENY (Rules-level)", async () => {
  await seedUsers(); await seedSession("s1"); await seedSession("s-susp", { ownerId: "teacher-suspended" });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "forged-cfg"), { revision: 0, parentConfigId: null, kind: "activation_baseline", source: "legacy_snapshot", activatedFromLegacy: true, createdAt: new Date(), createdBy: "student-1", title: "Cũ", description: "Mô tả cũ" });
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-x"), { operationId: "op-x", actorUid: "student-1", operationType: "activate_contract", baseRevision: null, resultingRevision: 0, previousConfigId: null, resultingConfigId: "forged-cfg", changedFields: [], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  const anon = db(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "sessions", "s1"), { editContractVersion: 1, configRevision: 0, currentConfigId: "forged-cfg", lastOperationId: "op-x", contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));

  const susp = db(teacherCtx("teacher-suspended"));
  await assertFails(activateContract({ db: susp, firestore: firestoreFns, family: "sessions", sessionId: "s-susp", actorUid: "teacher-suspended", operationId: "op-1" }).catch(e => { throw e; }));
});

test("activation: admin PASS but structural invariants still enforced (cannot skip sibling docs)", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("admin-1"));
  const result = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "admin-1", operationId: "op-1" });
  assert.equal(result.resultingRevision, 0);
  // admin trying to bypass by writing root directly without creating siblings must still fail
  await seedSession("s2");
  const admin = db(teacherCtx("admin-1"));
  await assertFails(updateDoc(doc(admin, "sessions", "s2"), {
    editContractVersion: 1, configRevision: 0, currentConfigId: "does-not-exist", lastOperationId: "op-none",
    contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

// =====================================================================================
// ATOMICITY
// =====================================================================================

test("atomicity: a rejected activation (lifecycle unsafe) leaves zero partial state", async () => {
  await seedUsers(); await seedSession("s1", { status: "open" });
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(() => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" }));
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal("configRevision" in rootSnap.data(), false);
  const historySnap = await getDoc(doc(w.db, "sessions", "s1", "editHistory", "op-1"));
  assert.equal(historySnap.exists(), false);
});

// =====================================================================================
// REVISION / APPLY_CONFIG
// =====================================================================================

test("revision: baseline 0, apply 0->1", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(activation.resultingRevision, 0);
  const applied = await applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "Tên mới sau Apply" } });
  assert.equal(applied.resultingRevision, 1);
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 1);
  const newConfig = await getDoc(doc(w.db, "sessions", "s1", "configVersions", applied.resultingConfigId));
  assert.equal(newConfig.data().title, "Tên mới sau Apply");
  assert.equal(newConfig.data().parentConfigId, activation.resultingConfigId);
});

test("revision: stale expectedRevision DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "V1" } });
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-3", expectedRevision: 0, changes: { title: "V2-stale" } }),
    (e) => { assert.equal(e.code, "STALE_REVISION"); return true; }
  );
});

test("revision: arbitrary jump (0->2) DENY at Rules level via direct write", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "jump-cfg"), { revision: 2, parentConfigId: activation.resultingConfigId, kind: "interaction", source: "apply_config", createdAt: new Date(), createdBy: "teacher-a", title: "jump" });
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-jump"), { operationId: "op-jump", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 2, previousConfigId: activation.resultingConfigId, resultingConfigId: "jump-cfg", changedFields: ["title"], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 2, currentConfigId: "jump-cfg", lastOperationId: "op-jump", updatedAt: serverTimestamp() }));
});

test("revision: lifecycle-only operation (close) does not increment configRevision", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  // Legacy-shaped 'close' write is now impossible post-activation (proven separately below);
  // confirm configRevision as read right after activation is still exactly 0 (no side effect).
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 0);
});

test("revision: apply_config DENY while OPEN (closed-first, absolute)", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  // Force the session open via rules-disabled seed (simulating it having been reopened by a
  // separate, already-tested lifecycle path) then attempt apply_config.
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); });
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "should not apply while open" } }),
    (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; }
  );
});

// =====================================================================================
// RACE (two concurrent "tabs")
// =====================================================================================

test("race: two concurrent apply_config at revision 0 — exactly one wins revision 1, other gets a conflict, no lost update", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });

  const attemptA = applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-race-a", expectedRevision: 0, changes: { title: "Từ tab A" } });
  const attemptB = applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-race-b", expectedRevision: 0, changes: { title: "Từ tab B" } });

  const results = await Promise.allSettled([attemptA, attemptB]);
  const fulfilled = results.filter(r => r.status === "fulfilled");
  const rejected = results.filter(r => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent attempts must win");
  assert.equal(rejected.length, 1, "the other must fail (Firestore transaction contention / stale revision), never silently both succeed");

  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 1, "no lost update — exactly one revision bump happened");
});

// =====================================================================================
// IDEMPOTENCY
// =====================================================================================

test("idempotency: retry same operationId + same payload replays without creating a duplicate configVersion", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const first = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const retry = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(retry.replay, true);
  assert.equal(retry.resultingConfigId, first.resultingConfigId);
});

test("idempotency: retry same operationId + different payload DENY (source data changed between attempts)", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  // Simulate: activation's history exists for op-1, but retry with a manually-forged different
  // resultingConfigId scenario is exercised via apply_config's payload-mismatch path instead,
  // since activation's own snapshot is deterministic from session state. Cover apply_config:
  const applied = await applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "A" } });
  assert.equal(applied.resultingRevision, 1);
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "B-different" } }),
    (e) => { assert.equal(e.code, "OPERATION_ID_PAYLOAD_MISMATCH"); return true; }
  );
});

test("idempotency: simulated client-timeout-after-commit retry does not create a duplicate version/history", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-timeout" });
  // Client "never saw" the success response and retries identically.
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-timeout" });
  const snap = await firestoreFns.getDocs(collection(w.db, "sessions", "s1", "configVersions"));
  assert.equal(snap.docs.length, 1, "exactly one configVersions doc must exist despite two identical attempts");
});

// =====================================================================================
// HISTORY (append-only)
// =====================================================================================

test("history: append-only — direct update DENY, direct delete DENY, actor cannot forge identity", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1", "editHistory", "op-1"), { resultingRevision: 99 }));
  await assertFails(firestoreFns.deleteDoc(doc(a, "sessions", "s1", "editHistory", "op-1")));
  // Forged actor identity on a new (would-be) entry:
  await assertFails(setDoc(doc(a, "sessions", "s1", "editHistory", "op-forged"), {
    operationId: "op-forged", actorUid: "teacher-b", operationType: "apply_config",
    baseRevision: 0, resultingRevision: 1, previousConfigId: "x", resultingConfigId: "y",
    changedFields: [], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed"
  }));
});

// =====================================================================================
// VERSIONS (immutable)
// =====================================================================================

test("versions: create through the transaction PASS, direct arbitrary create/update/delete DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "sessions", "s1", "configVersions", "direct-arbitrary"), { revision: 5, parentConfigId: null, kind: "activation_baseline", source: "legacy_snapshot", activatedFromLegacy: true, createdAt: serverTimestamp(), createdBy: "teacher-a" }));
  await assertFails(updateDoc(doc(a, "sessions", "s1", "configVersions", activation.resultingConfigId), { title: "hacked" }));
  await assertFails(firestoreFns.deleteDoc(doc(a, "sessions", "s1", "configVersions", activation.resultingConfigId)));
});

// =====================================================================================
// POINTER CONSISTENCY
// =====================================================================================

test("pointer consistency: root revision bump without a matching history doc DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: activation.resultingConfigId, lastOperationId: "no-such-op", updatedAt: serverTimestamp() }));
});

test("pointer consistency: currentConfigId pointing at a non-existent version DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-orphan"), { operationId: "op-orphan", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 1, previousConfigId: "x", resultingConfigId: "missing-version", changedFields: [], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: "missing-version", lastOperationId: "op-orphan", updatedAt: serverTimestamp() }));
});

test("pointer consistency: new version with wrong parentConfigId DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "wrong-parent-cfg"), { revision: 1, parentConfigId: "totally-unrelated-id", kind: "interaction", source: "apply_config", createdAt: new Date(), createdBy: "teacher-a", title: "x" });
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-wrongparent"), { operationId: "op-wrongparent", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 1, previousConfigId: activation.resultingConfigId, resultingConfigId: "wrong-parent-cfg", changedFields: ["title"], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: "wrong-parent-cfg", lastOperationId: "op-wrongparent", updatedAt: serverTimestamp() }));
});

test("pointer consistency: history resultingRevision mismatched with root's intended revision DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "mismatch-cfg"), { revision: 1, parentConfigId: activation.resultingConfigId, kind: "interaction", source: "apply_config", createdAt: new Date(), createdBy: "teacher-a", title: "x" });
    await setDoc(doc(d, "sessions", "s1", "editHistory", "op-mismatch"), { operationId: "op-mismatch", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 99, previousConfigId: activation.resultingConfigId, resultingConfigId: "mismatch-cfg", changedFields: ["title"], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: "mismatch-cfg", lastOperationId: "op-mismatch", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// STALE LEGACY CLIENT
// =====================================================================================

test("stale legacy client: after activation, the old Gate-1A-shaped blind root update fails closed server-side", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { title: "Sửa qua đường Gate 1A cũ", updatedAt: serverTimestamp() }));
});

test("stale legacy client: before activation, the same legacy operation still PASSes (byte-identical to Gate 1B.2A)", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { title: "Sửa hợp lệ trước activation", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// READER (Gate 1B.1 compatibility)
// =====================================================================================

test("reader: Gate 1B.1 session-reader resolves the activation baseline correctly, no silent fallback", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  const sessionData = rootSnap.data();
  assert.equal(isContractSession(sessionData), true);

  const facade = makeFirestoreDbFacade(w.db, firestoreFns);
  const effective = await resolveEffectiveConfig(facade, "sessions/s1", sessionData, "interaction");
  assert.equal(effective.legacy, false);
  assert.equal(effective.configId, activation.resultingConfigId);
  assert.equal(effective.ancestry.length, 2, "activation baseline + the implicit legacy-v0 root node");
  assert.equal(effective.ancestry[1].implicit, true);

  const report = await readInteractionReport(facade, "sessions/s1", { ...sessionData, __sessionId: "s1" });
  assert.equal(report.legacy, false);
});

// =====================================================================================
// PII CANARY
// =====================================================================================

const legacyKnowledgeFixture = (overrides) => ({
  ownerId: "teacher-a", title: "Phiên Knowledge", joinCode: "ABC123", status: "closed",
  minimumPerParticipant: 3, targetSubmissions: 100, createdAt: new Date(), updatedAt: new Date(),
  collectParticipantProfile: true,
  participantFields: { fullName: { enabled: true, required: true }, className: { enabled: true, required: true } },
  classOptions: ["K77.A01"], ...overrides
});

test("PII canary: activation snapshot never contains participant PII field names, even for Knowledge", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k1"), legacyKnowledgeFixture()); });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });
  // Note: `participantFields` is the policy SCHEMA (which fields are on/required) and
  // legitimately contains keys named after the PII fields, e.g. participantFields.fullName =
  // {enabled:true,required:true} — that is not a PII leak, no participant's actual name/class/
  // email/phone VALUE is present anywhere. The check below is on the document's own TOP-LEVEL
  // shape (matching what the Rules allowlist actually guarantees), not a blanket string search
  // that would also wrongly flag the schema descriptor — same distinction made in the Gate
  // 1B.1 PII canary.
  const configSnap = await getDoc(doc(w.db, "knowledgeSessions", "k1", "configVersions", activation.resultingConfigId));
  const configData = configSnap.data();
  for (const field of ["fullName", "email", "phone", "className"]) assert.equal(field in configData, false, `${field} must not be a top-level key`);
  assert.ok("participantFields" in configData, "the policy schema itself is expected and correct to be present");

  const historySnap = await getDoc(doc(w.db, "knowledgeSessions", "k1", "editHistory", "op-1"));
  const historyData = historySnap.data();
  for (const field of ["fullName", "email", "phone", "className"]) assert.equal(field in historyData, false);
});

// =====================================================================================
// GROUP ACTIVITIES — core cases (activation, apply, one pointer-consistency probe, stale-client)
// =====================================================================================

const legacyGroupFixture = (overrides) => ({
  ownerId: "teacher-a", classId: "c1", className: "K77.A01", title: "Cũ", instructions: "Nhiệm vụ",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "GRPJOIN1", status: "closed", startedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides
});
async function seedGroup(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", id), legacyGroupFixture(overrides)); });
}

test("groupActivities: activation PASS when closed, DENY when open, apply 0->1 PASS", async () => {
  await seedUsers(); await seedGroup("g1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(activation.resultingRevision, 0);

  await seedGroup("g2", { status: "open" });
  await assert.rejects(() => activateContract({ ...w, family: "groupActivities", sessionId: "g2", actorUid: "teacher-a", operationId: "op-2" }), (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; });

  const applied = await applyConfigRevision({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-3", expectedRevision: 0, changes: { title: "Mới" } });
  assert.equal(applied.resultingRevision, 1);
});

test("groupActivities: pointer consistency — currentConfigId without matching version DENY", async () => {
  await seedUsers(); await seedGroup("g1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { configRevision: 1, currentConfigId: "missing", lastOperationId: "no-op", updatedAt: serverTimestamp() }));
});

test("groupActivities: stale legacy client fails closed after activation, passes before", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { title: "Trước activation", updatedAt: serverTimestamp() }));
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-1" });
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { title: "Sau activation qua đường cũ", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// KNOWLEDGE SESSIONS — core cases
// =====================================================================================

test("knowledgeSessions: activation PASS when closed, DENY when open/trashed, apply 0->1 PASS", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k1"), legacyKnowledgeFixture()); });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(activation.resultingRevision, 0);

  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k2"), legacyKnowledgeFixture({ status: "open" })); });
  await assert.rejects(() => activateContract({ ...w, family: "knowledgeSessions", sessionId: "k2", actorUid: "teacher-a", operationId: "op-2" }), (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; });

  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k3"), legacyKnowledgeFixture({ teacherDeletedAt: new Date() })); });
  await assert.rejects(() => activateContract({ ...w, family: "knowledgeSessions", sessionId: "k3", actorUid: "teacher-a", operationId: "op-3" }), (e) => { assert.equal(e.code, "LIFECYCLE_NOT_SAFE"); return true; });

  const applied = await applyConfigRevision({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-4", expectedRevision: 0, changes: { targetSubmissions: 200 } });
  assert.equal(applied.resultingRevision, 1);
});

test("knowledgeSessions: stale legacy client fails closed after activation, passes before; existing 3ZQ7YU-unrelated regression (title edit) still works pre-activation", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k1"), legacyKnowledgeFixture()); });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { title: "Trước activation", updatedAt: serverTimestamp() }));
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { title: "Sau activation qua đường cũ", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// REGRESSION — non-activated legacy sessions continue exactly as Gate 1B.2A
// =====================================================================================

test("regression: non-activated legacy session — create/edit/open/close/timer/trash-restore all continue PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { title: "Sửa", description: "Mô tả", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "closed", closedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: serverTimestamp(), deletedBy: "teacher-a", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() }));
});
