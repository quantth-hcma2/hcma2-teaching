// Gate E2 — explicit Contract activation UI tests. Real local Firestore emulator loaded with
// the frozen, UNCHANGED Gate 1B.3-C1X Rules candidate (sha256
// 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) — E2 never modifies Rules.
// Exercises contract-activation.mjs (and its narrow additions to contract-editor.mjs /
// session-reader.mjs) against the real writer/reader contract, never a rules-disabled shortcut
// for the behavior under test. The literal sessionId `BRH8Uz8XvZxuxmPLADsH` used below is a
// synthetic document in this isolated emulator demo project — never the real production
// fixture of the same ID. No `firebase deploy`. No production write of any kind.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract, ContractWriterError } from "../../contract-writer.mjs";
import { saveInteractionRevision, shouldDisableLegacyTimeEdit, ContractEditorError } from "../../contract-editor.mjs";
import { PROTECTED_FIXTURE_SESSION_IDS, isProtectedFixture } from "../../session-reader.mjs";
import { canShowActivationAction, activateSessionExplicit, ContractActivationError } from "../../contract-activation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE_E2_EMULATOR_PORT || 8185);
const PROJECT_ID = "demo-hcma2-gate-e2";
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
function writerFor(ctx) { return { db: db(ctx), firestore: firestoreFns }; }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active" });
    await setDoc(doc(d, "users", "suspended-1"), { role: "teacher", status: "suspended" });
  });
}
const legacySessionFixture = (overrides) => ({
  ownerId: "teacher-a", classId: "c1", className: "K77.A01", title: "Cũ", description: "Mô tả cũ",
  status: "closed", accessToken: "tok-xxxxxxxxxxxxxxxxxxxxxxxxxxx", shortCode: "ABC123",
  showResults: "hidden", allowMultipleResponses: false, anonymous: true, showResponderCount: true,
  startedAt: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  questionCount: 1, responseCount: 0, activeQuestionId: null, activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1, ...overrides
});
async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "sessions", id), legacySessionFixture(overrides)); });
}
async function seedLegacyQuestionWithResponse(sessionId, questionId) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", questionId), {
      sessionId, ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi cũ?",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date()
    });
    await setDoc(doc(d, "sessions", sessionId, "responses", `${questionId}_student-1`), {
      sessionId, questionId, participantId: "student-1", answer: null, selectedOptions: ["a"], submittedAt: new Date()
    });
  });
}
async function getRootDoc(w, sessionId) { return (await getDoc(doc(w.db, "sessions", sessionId))).data(); }

// =====================================================================================
// VISIBILITY
// =====================================================================================

test("VISIBILITY: legacy CLOSED owner -> visible", async () => {
  await seedUsers(); await seedSession("s1");
  const session = legacySessionFixture();
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" } }), true);
});

test("VISIBILITY: legacy OPEN owner -> hidden", () => {
  const session = legacySessionFixture({ status: "open" });
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" } }), false);
});

test("VISIBILITY: legacy CLOSED unauthorized user -> hidden", () => {
  const session = legacySessionFixture();
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-b", actorProfile: { role: "teacher", status: "active" } }), false, "not the owner");
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "suspended" } }), false, "suspended owner");
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "anon-1", actorProfile: null }), false, "no profile at all");
});

test("VISIBILITY: Contract rev0 -> hidden (no re-activation)", () => {
  const session = legacySessionFixture({ editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0" });
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" } }), false);
});

test("VISIBILITY: Contract rev>=1 -> hidden", () => {
  const session = legacySessionFixture({ editContractVersion: 1, configRevision: 2, currentConfigId: "cfg2" });
  assert.equal(canShowActivationAction({ sessionId: "s1", sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" } }), false);
});

test("VISIBILITY: protected fixture -> hidden even though otherwise legacy/CLOSED/owner", () => {
  const session = legacySessionFixture();
  assert.equal(canShowActivationAction({ sessionId: PROTECTED_FIXTURE_SESSION_IDS[0], sessionData: session, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" } }), false);
});

// =====================================================================================
// CONFIRMATION (confirm -> exactly one activation; cancel is a pure DOM no-call, proven by
// code inspection — index.html's Cancel handler never references activateSessionExplicit)
// =====================================================================================

test("CONFIRMATION: confirm calls activateSessionExplicit exactly once and produces exactly one activation", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const result = await activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" });
  assert.equal(result.replay, false);
  assert.equal(result.resultingRevision, 0);
  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 0);
});

// =====================================================================================
// FRESH-STATE RACE
// =====================================================================================

test("RACE: CLOSED at render, OPEN before click confirmation -> blocked", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  // Simulates the render-time snapshot being CLOSED, then a status flip before the click.
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); });
  await assert.rejects(
    activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" }),
    (e) => { assert.ok(e instanceof ContractActivationError); assert.equal(e.code, "SESSION_NOT_CLOSED"); return true; }
  );
});

test("RACE: legacy at render, already Contract before the activation call -> blocked", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  // Simulates another tab/teacher activating it first, between render and this click.
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-elsewhere" });
  await assert.rejects(
    activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" }),
    (e) => { assert.equal(e.code, "ALREADY_CONTRACT"); return true; }
  );
});

// =====================================================================================
// ACTIVATION RESULT
// =====================================================================================

test("ACTIVATION RESULT: full field/document set, root title/description unchanged, responses untouched", async () => {
  await seedUsers(); await seedSession("s1");
  await seedLegacyQuestionWithResponse("s1", "q1");
  const w = writerFor(teacherCtx("teacher-a"));
  const result = await activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" });

  const root = await getRootDoc(w, "s1");
  assert.equal(root.editContractVersion, 1);
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, result.resultingConfigId);
  assert.equal(root.lastOperationId, "op-1");
  assert.ok(root.contractActivatedAt);
  assert.equal(root.title, "Cũ");
  assert.equal(root.description, "Mô tả cũ");

  const cfgDoc = (await getDoc(doc(w.db, "sessions", "s1", "configVersions", result.resultingConfigId))).data();
  assert.equal(cfgDoc.kind, "activation_baseline");
  assert.equal(cfgDoc.revision, 0);

  const historyDoc = (await getDoc(doc(w.db, "sessions", "s1", "editHistory", "op-1"))).data();
  assert.equal(historyDoc.operationType, "activate_contract");
  assert.equal(historyDoc.resultingConfigId, result.resultingConfigId);

  // Responses/participants untouched.
  const respDoc = (await getDoc(doc(w.db, "sessions", "s1", "responses", "q1_student-1"))).data();
  assert.equal(respDoc.participantId, "student-1");
  const questionDoc = (await getDoc(doc(w.db, "questions", "q1"))).data();
  assert.equal(questionDoc.question, "Câu hỏi cũ?");
});

// =====================================================================================
// ONE-WAY / IDEMPOTENCY
// =====================================================================================

test("ONE-WAY: a second explicit activation attempt (any operationId) is blocked once already Contract", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" });
  await assert.rejects(
    activateSessionExplicit({ ...w, sessionId: "s1", actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-2" }),
    (e) => { assert.equal(e.code, "ALREADY_CONTRACT"); return true; }
  );
});

test("ONE-WAY: the underlying activateContract() writer itself remains idempotent (unchanged, unredesigned) for a genuine same-operationId retry", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const r1 = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  const r2 = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(r1.replay, false);
  assert.equal(r2.replay, true);
  assert.equal(r2.resultingConfigId, r1.resultingConfigId);
});

// =====================================================================================
// FIXTURE PROTECTION (synthetic emulator document, isolated demo project)
// =====================================================================================

test("FIXTURE PROTECTION: activation is blocked before any read/write is attempted", async () => {
  await seedUsers();
  const fixtureId = PROTECTED_FIXTURE_SESSION_IDS[0];
  await seedSession(fixtureId);
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(
    activateSessionExplicit({ ...w, sessionId: fixtureId, actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1" }),
    (e) => { assert.ok(e instanceof ContractActivationError); assert.equal(e.code, "PROTECTED_FIXTURE"); return true; }
  );
  const root = await getRootDoc(w, fixtureId);
  assert.equal("editContractVersion" in root, false, "no activation must have occurred");
});

test("FIXTURE PROTECTION: a Contract revision save is blocked before the writer is ever called", async () => {
  await seedUsers();
  const fixtureId = PROTECTED_FIXTURE_SESSION_IDS[0];
  // Seed it already-activated (matching the real fixture's actual rev0 shape), exactly like
  // production — activation itself is not what E2 blocks; semantic SAVE is.
  await seedSession(fixtureId, { editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0", lastOperationId: "op-activate", contractActivatedAt: new Date() });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", fixtureId, "configVersions", "cfg0"), {
      revision: 0, parentConfigId: null, kind: "activation_baseline", source: "legacy_snapshot",
      createdAt: new Date(), createdBy: "teacher-a", active: true, title: "Cũ", description: "Mô tả cũ"
    });
  });
  const w = writerFor(teacherCtx("teacher-a"));
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: fixtureId, actorUid: "teacher-a", operationId: "op-x", mode: "rev0", expectedRevision: 0,
      editorSeed: { title: "Cũ", description: "Mô tả cũ", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] },
      candidateChanges: { title: "Đã đổi", description: "Mô tả cũ", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] },
      legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.ok(e instanceof ContractEditorError); assert.equal(e.code, "PROTECTED_FIXTURE"); return true; }
  );
  const root = await getRootDoc(w, fixtureId);
  assert.equal(root.configRevision, 0, "no revision may ever be written for the protected fixture");
});

test("FIXTURE PROTECTION: legacy time-edit is disabled for the protected fixture regardless of revision", () => {
  const fixtureId = PROTECTED_FIXTURE_SESSION_IDS[0];
  assert.equal(shouldDisableLegacyTimeEdit({ editContractVersion: 1, configRevision: 0 }, fixtureId), true);
  assert.equal(shouldDisableLegacyTimeEdit(legacySessionFixture(), fixtureId), true, "even a legacy-shaped session at this ID must be disabled");
});

test("isProtectedFixture(): true only for the exact known fixture ID, never a general deny-list", () => {
  assert.equal(isProtectedFixture(PROTECTED_FIXTURE_SESSION_IDS[0]), true);
  assert.equal(isProtectedFixture("3ZQ7YU"), false, "3ZQ7YU is protected by operational discipline, NOT this deny-list");
  assert.equal(isProtectedFixture("some-random-session"), false);
});

// =====================================================================================
// LEGACY REGRESSION
// =====================================================================================

test("LEGACY REGRESSION: shouldDisableLegacyTimeEdit is false for an ordinary legacy session (no sessionId arg needed)", () => {
  assert.equal(shouldDisableLegacyTimeEdit(legacySessionFixture()), false);
});

// =====================================================================================
// EXISTING CONTRACT REGRESSION — ordinary (non-fixture) rev0 save still works after E2
// =====================================================================================

test("REGRESSION: ordinary rev0 -> rev1 save (non-fixture session) is completely unaffected by the E2 fixture guard", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-activate" });
  const outcome = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-save", mode: "rev0", expectedRevision: 0,
    editorSeed: { title: "Cũ", description: "Mô tả cũ", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] },
    candidateChanges: { title: "Tiêu đề mới", description: "Mô tả cũ", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] },
    legacyQuestionsForSnapshot: []
  });
  assert.equal(outcome.noChange, false);
  assert.equal(outcome.result.resultingRevision, 1);
});
