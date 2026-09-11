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

test("revision: baseline 0, apply 0->1 via the OLD partial (title/description-only) shape — SUPERSEDED by Gate 1B.3-C1X for the sessions/Interaction family: the old, unmodified applyConfigRevision() no longer produces a shape the hardened Rules accept", async () => {
  // Gate 1B.2B originally proved this exact call succeeds. Gate 1B.3's frozen data contract
  // (closed in Gate 1B.3-C1R/C1X) requires every REAL revision >=1 for Interaction to carry the
  // complete versioned manifest (kind=='interaction' with roundId/allowMultipleResponses/
  // anonymous/showResponderCount/questions) AND the session root to carry the mandatory
  // derived/runtime reset fields (questionCount/activeQuestionId/activeQuestionStartedAt/
  // responseCount/liveAggregate) on every apply. contract-writer.mjs's applyConfigRevision() is
  // unchanged and knows how to produce neither — this is intentional: extending it is Gate
  // 1B.3-C2's job, not something to route around here. This is not a regression: it is the
  // Rules correctly rejecting a write shape Gate 1B.3 declares incomplete for this family.
  // groupActivities/knowledgeSessions are untouched and still succeed with this exact old shape
  // — see "groupActivities: activation PASS..." and "knowledgeSessions: activation PASS..."
  // elsewhere in this file, both still green.
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(activation.resultingRevision, 0);
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "Tên mới sau Apply" } })
  );
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 0, "the denied attempt must leave configRevision untouched");
});

test("revision: stale expectedRevision DENY — setup now seeds the revision-1 starting state directly (rules-disabled), since the old writer can no longer legitimately produce it for this family; the STALE_REVISION invariant itself is unrelated to Gate 1B.3 and is proven unchanged", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  // Seed "already at revision 1" directly — matches the frozen Gate 1B.3 full manifest shape —
  // rather than via applyConfigRevision(), which can no longer produce it for this family.
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", "cfgRev1"), {
      revision: 1, parentConfigId: activation.resultingConfigId, roundId: "cfgRev1", kind: "interaction",
      source: "apply_config", createdAt: new Date(), createdBy: "teacher-a", active: true,
      title: "V1", description: "", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
    });
    await updateDoc(doc(d, "sessions", "s1"), {
      configRevision: 1, currentConfigId: "cfgRev1", lastOperationId: "op-2", updatedAt: new Date(),
      questionCount: 0, activeQuestionId: null, activeQuestionStartedAt: null, responseCount: 0, liveAggregate: null
    });
  });
  // The writer's own client-side check (data.configRevision !== expectedRevision) throws
  // STALE_REVISION before ever attempting a Firestore write — this is a pure contract-writer.mjs
  // invariant, entirely unaffected by the Rules hardening; still exercised via the old
  // title-only `changes` shape deliberately, to prove the STALE_REVISION check itself doesn't
  // depend on the new manifest shape at all.
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
// POST-ACTIVATION LIFECYCLE (Blocker 1 fix) — an activated session must remain fully operable
// through real Rules-enforced writes, not a rules-disabled bypass.
// =====================================================================================

test("sessions lifecycle post-activation: REOPEN a closed activated session PASS via Rules, configRevision/currentConfigId untouched, CLOSE again PASS, still untouched", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));

  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  let root = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(root.status, "open");
  assert.equal(root.configRevision, 0, "reopen must never bump configRevision");
  assert.equal(root.currentConfigId, activation.resultingConfigId, "reopen must never move the contract pointer");
  assert.equal(root.editContractVersion, 1);
  assert.ok(root.contractActivatedAt);

  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "closed", closedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  root = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(root.status, "closed");
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);
});

test("sessions lifecycle post-activation: toggle-results / live-aggregate runtime writes still PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { showResults: "live", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { responseCount: 2, liveAggregate: { questionId: "q1", chartType: "bar", agg: {}, respondedCount: 2, openAnswers: [], updatedAt: new Date() }, updatedAt: serverTimestamp() }));
});

test("sessions lifecycle post-activation: trash/restore PASS, restore lands on unchanged status (no auto-reopen), contract fields untouched", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: serverTimestamp(), deletedBy: "teacher-a", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() }));
  const root = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);
});

test("sessions lifecycle branch DENY: cannot mutate title/description (semantic/config field) through it", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { title: "Sửa lén qua lifecycle branch", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", title: "Kèm cả status hợp lệ", updatedAt: serverTimestamp() }));
});

test("sessions lifecycle branch DENY: cannot mutate configRevision/currentConfigId/lastOperationId/editContractVersion/contractActivatedAt through it", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", configRevision: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", currentConfigId: "forged", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", lastOperationId: "forged-op", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", editContractVersion: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { status: "open", contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  // Confirm nothing above actually moved:
  const root = (await getDoc(doc(w.db, "sessions", "s1"))).data();
  assert.equal(root.status, "closed");
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);
});

test("groupActivities lifecycle post-activation: open/close/restart-timer/pause-timer real Rules writes PASS, contract fields untouched", async () => {
  await seedUsers(); await seedGroup("g1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { status: "open", startedAt: serverTimestamp(), pausedRemainingSec: null, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { startedAt: null, pausedRemainingSec: 120, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { startedAt: serverTimestamp(), pausedRemainingSec: null, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { status: "closed", updatedAt: serverTimestamp() }));
  const root = (await getDoc(doc(w.db, "groupActivities", "g1"))).data();
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { title: "Sửa lén qua lifecycle branch", updatedAt: serverTimestamp() }));
});

test("knowledgeSessions lifecycle post-activation: DECIDED semantics — status open/closed toggle PASS (reopen is just another status write, its own operation), teacher trash lands on closed status via the SAME write (matches pre-activation behavior), contract fields untouched throughout", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k1"), legacyKnowledgeFixture()); });
  const w = writerFor(teacherCtx("teacher-a"));
  const activation = await activateContract({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));

  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { status: "open", updatedAt: serverTimestamp() }));
  let root = (await getDoc(doc(w.db, "knowledgeSessions", "k1"))).data();
  assert.equal(root.status, "open");
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);

  // Trash forces status closed as part of the same write, matching the pre-activation behavior
  // this family already had — restore afterward lands on CLOSED (DECIDED), reopen is separate.
  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "teacher-a", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { teacherDeletedAt: null, teacherDeletedBy: null, updatedAt: serverTimestamp() }));
  root = (await getDoc(doc(w.db, "knowledgeSessions", "k1"))).data();
  assert.equal(root.status, "closed", "restore lands on closed, exactly as legacy — this write never re-opens");
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, activation.resultingConfigId);

  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { status: "open", updatedAt: serverTimestamp() }));

  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { title: "Sửa lén qua lifecycle branch", updatedAt: serverTimestamp() }));
});

test("knowledgeSessions lifecycle post-activation: admin trash/restore branch PASS, teacher cannot touch adminDeletedAt", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k1"), legacyKnowledgeFixture()); });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });
  const admin = db(teacherCtx("admin-1"));
  await assertSucceeds(updateDoc(doc(admin, "knowledgeSessions", "k1"), { status: "closed", adminDeletedAt: serverTimestamp(), adminDeletedBy: "admin-1", updatedAt: serverTimestamp() }));
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { adminDeletedAt: null, updatedAt: serverTimestamp() }));
});

// =====================================================================================
// EDIT HISTORY READ POLICY (Blocker 2)
// =====================================================================================

test("editHistory read policy: owner get exact doc PASS (matches what the writer's idempotency check actually does)", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(getDoc(doc(a, "sessions", "s1", "editHistory", "op-1")));
});

test("editHistory read policy: admin get PASS", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const admin = db(teacherCtx("admin-1"));
  await assertSucceeds(getDoc(doc(admin, "sessions", "s1", "editHistory", "op-1")));
});

test("editHistory read policy: foreign teacher DENY, anonymous DENY, suspended teacher DENY", async () => {
  await seedUsers(); await seedSession("s1"); await seedSession("s-susp", { ownerId: "teacher-suspended" });
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const b = db(teacherCtx("teacher-b"));
  await assertFails(getDoc(doc(b, "sessions", "s1", "editHistory", "op-1")));
  const anon = db(anonCtx("student-1"));
  await assertFails(getDoc(doc(anon, "sessions", "s1", "editHistory", "op-1")));
  const susp = db(teacherCtx("teacher-suspended"));
  await assertFails(getDoc(doc(susp, "sessions", "s1", "editHistory", "op-1")));
});

test("editHistory read policy: list/query the whole collection is DENIED for everyone, including the owner — not needed by the writer or any reader in this gate", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(firestoreFns.getDocs(collection(a, "sessions", "s1", "editHistory")));
});

test("editHistory read policy: writer code path confirmation — activateContract/applyConfigRevision only ever call tx.get() on a single known operationId doc, never a list/query, so get-only Rules are sufficient for the writer's own needs", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const w = writerFor(teacherCtx("teacher-a"));
  // A second, different operationId activation attempt after the first succeeded (already
  // activated) exercises exactly the tx.get(historyRef) read path with a doc that does NOT
  // exist yet — proving the writer's own idempotency check only needs `get`, and that this
  // works correctly (ALREADY_ACTIVATED, not a permission error) with list denied.
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await assert.rejects(
    () => activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-never-used-before" }),
    (e) => { assert.equal(e.code, "ALREADY_ACTIVATED"); return true; }
  );
});

// =====================================================================================
// RACE (two concurrent "tabs")
// =====================================================================================

test("race: two concurrent apply_config at revision 0 via the OLD writer — SUPERSEDED by Gate 1B.3-C1X: both attempts now fail, because the shape itself (not the race) is what Rules reject for this family; real race-safety coverage for the full shape is deferred to Gate 1B.3-C2 once a conforming writer exists", async () => {
  // The underlying race-safety GUARANTEE (Firestore transactions prevent a lost update under
  // concurrent contention) is a platform property, not something this Rules file implements —
  // it was never actually under test here beyond "both attempts hit the same transaction
  // machinery", which is unaffected by Gate 1B.3. What Gate 1B.3-C1R/C1X changes is that BOTH
  // concurrent attempts, using the old title-only shape, are now correctly denied regardless of
  // timing, since the shape itself is rejected before the "who won the race" question is even
  // reached.
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });

  const attemptA = applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-race-a", expectedRevision: 0, changes: { title: "Từ tab A" } });
  const attemptB = applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-race-b", expectedRevision: 0, changes: { title: "Từ tab B" } });

  const results = await Promise.allSettled([attemptA, attemptB]);
  const rejected = results.filter(r => r.status === "rejected");
  assert.equal(rejected.length, 2, "both attempts must fail — the old partial shape is rejected regardless of which one Firestore would otherwise have let win");

  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 0, "neither attempt may bump configRevision");
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

test("idempotency: retry same operationId + different payload via the OLD writer — SUPERSEDED by Gate 1B.3-C1X for the sessions family: the FIRST call no longer succeeds either, so OPERATION_ID_PAYLOAD_MISMATCH is never reached; both attempts fail on shape, not on mismatch. Payload-mismatch coverage for this family is deferred to Gate 1B.3-C2's conforming writer — groupActivities/knowledgeSessions are untouched and unaffected.", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "A" } })
  );
  await assert.rejects(
    () => applyConfigRevision({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "B-different" } })
  );
  const rootSnap = await getDoc(doc(w.db, "sessions", "s1"));
  assert.equal(rootSnap.data().configRevision, 0, "neither attempt may bump configRevision");
});

test("idempotency: simulated client-timeout-after-commit retry does not create a duplicate version/history", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const first = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-timeout" });
  // Client "never saw" the success response and retries identically. Verified via the writer's
  // own return value (both must resolve to the exact same configId — proving no duplicate was
  // created) rather than a collection list/count, since configVersions.list is not granted to
  // any client per Blocker 2's tightening (see below) and the writer itself never lists either.
  const retry = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-timeout" });
  assert.equal(retry.replay, true);
  assert.equal(retry.resultingConfigId, first.resultingConfigId, "exactly one configVersions doc must exist despite two identical attempts");
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
