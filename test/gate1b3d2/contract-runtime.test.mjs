// Gate 1B.3-D2 — Contract Interaction runtime bridge + reopen integrity guard tests. Real local
// Firestore emulator loaded with the frozen, UNCHANGED Gate 1B.3-C1X Rules candidate (sha256
// 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) — D2 never modifies Rules.
// Exercises contract-runtime.mjs against the real writer/reader contract, never a rules-disabled
// shortcut for the behavior under test. No `firebase deploy`. No production write of any kind.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract, applyInteractionRevision, ContractWriterError } from "../../contract-writer.mjs";
import { makeFirestoreDbFacade } from "../../session-reader.mjs";
import { presentationRenderState, qrModalViewModel } from "../../session-view.mjs";
import {
  isEmbeddedOptionsQuestion, isQuestionCurrentForSession, resolveRuntimeQuestions,
  resolveRuntimeSettings, verifyReopenIntegrity, ContractRuntimeError
} from "../../contract-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B3D2_EMULATOR_PORT || 8184);
const PROJECT_ID = "demo-hcma2-gate1b3d2";
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
async function seedLegacyQuestionWithOptions(sessionId, questionId, qOverrides, options) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", questionId), {
      sessionId, ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi cũ?",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date(), ...qOverrides
    });
    for (const [i, opt] of (options || [{ label: "A", text: "Đáp án A" }, { label: "B", text: "Đáp án B" }]).entries()) {
      await setDoc(doc(d, "questions", questionId, "options", `opt${i}`), {
        label: opt.label, text: opt.text, order: i, value: opt.value ?? null, isCorrect: opt.isCorrect ?? null, createdAt: new Date()
      });
    }
  });
}
async function activateSession(sessionId = "s1", overrides = {}) {
  await seedUsers();
  await seedSession(sessionId, overrides);
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId, actorUid: "teacher-a", operationId: "op-activate" });
  return w;
}
function authoredQuestion(overrides = {}) {
  return {
    type: "single", question: "Câu hỏi?", description: "Mô tả", required: true, chartType: "bar",
    timeLimit: 30, allowChangeAnswer: false,
    options: [{ label: "A", text: "Đáp án A", value: null, isCorrect: null }, { label: "B", text: "Đáp án B", value: null, isCorrect: null }],
    ...overrides
  };
}
function sessionLevelFields(overrides = {}) {
  return { title: "T", description: "D", allowMultipleResponses: false, anonymous: true, showResponderCount: true, ...overrides };
}
async function getRootDoc(w, sessionId) { return (await getDoc(doc(w.db, "sessions", sessionId))).data(); }
function dbFacadeFor(w) { return makeFirestoreDbFacade(w.db, firestoreFns); }

// =====================================================================================
// 1/3. MANDATORY REOPEN INTEGRITY GUARD
// =====================================================================================

test("PASS: legacy and rev0 sessions skip the guard trivially", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const legacyResult = await verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" });
  assert.equal(legacyResult.ok, true); assert.equal(legacyResult.skipped, true);

  const w2 = await activateSession("s2");
  const rev0Result = await verifyReopenIntegrity({ db: w2.db, firestore: w2.firestore, sessionId: "s2" });
  assert.equal(rev0Result.ok, true); assert.equal(rev0Result.skipped, true);
});

test("PASS: valid rev>=1 integrity -> reopen guard passes", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] }
  });
  const result = await verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.verifiedCount, 2);
});

test("BLOCK: missing Contract question -> reopen guard fails, session remains CLOSED", async () => {
  const w = await activateSession("s1");
  const result1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] }
  });
  const victimId = result1.resultingQuestions[1].questionId;
  await seedWithRulesDisabled(async (d) => { await deleteDoc(doc(d, "questions", victimId)); });
  await assert.rejects(
    verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" }),
    (e) => { assert.ok(e instanceof ContractRuntimeError); assert.equal(e.code, "REOPEN_INTEGRITY_FAILED"); assert.equal(e.details.reason, "MISSING"); return true; }
  );
  const root = await getRootDoc(w, "s1");
  assert.equal(root.status, "closed");
});

test("BLOCK: semantic mismatch (question content mutated out-of-band) -> reopen guard fails", async () => {
  const w = await activateSession("s1");
  const result1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const victimId = result1.resultingQuestions[0].questionId;
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "questions", victimId), { question: "Đã bị sửa ngoài luồng" }); });
  await assert.rejects(
    verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" }),
    (e) => { assert.equal(e.code, "REOPEN_INTEGRITY_FAILED"); assert.equal(e.details.reason, "MISMATCH"); return true; }
  );
  const root = await getRootDoc(w, "s1");
  assert.equal(root.status, "closed");
});

test("BLOCK: wrong order (question field tampered out-of-band) -> reopen guard fails, no repair", async () => {
  const w = await activateSession("s1");
  const result1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] }
  });
  const victimId = result1.resultingQuestions[1].questionId;
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "questions", victimId), { order: 5 }); });
  await assert.rejects(
    verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" }),
    (e) => { assert.equal(e.code, "REOPEN_INTEGRITY_FAILED"); assert.equal(e.details.reason, "MISMATCH"); return true; }
  );
  const root2 = await getRootDoc(w, "s1");
  assert.equal(root2.status, "closed");
  assert.equal(root2.configRevision, 1); // untouched, no compensating write
});

test("BLOCK: wrong configId (config document deleted out-of-band) -> reopen guard fails", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const root = await getRootDoc(w, "s1");
  await seedWithRulesDisabled(async (d) => { await deleteDoc(doc(d, "sessions", "s1", "configVersions", root.currentConfigId)); });
  await assert.rejects(
    verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" }),
    (e) => { assert.equal(e.code, "REOPEN_INTEGRITY_FAILED"); assert.equal(e.details.reason, "CONFIG_MISSING"); return true; }
  );
});

test("BLOCK: wrong revision (config document's own revision tampered out-of-band) -> reopen guard fails", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const root = await getRootDoc(w, "s1");
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1", "configVersions", root.currentConfigId), { revision: 99 }); });
  await assert.rejects(
    verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" }),
    (e) => { assert.equal(e.code, "REOPEN_INTEGRITY_FAILED"); assert.equal(e.details.reason, "CONFIG_REVISION_MISMATCH"); return true; }
  );
});

test("PASS: valid rev2 (after a second apply) integrity -> reopen guard passes against the NEW revision only", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { ...sessionLevelFields({ title: "T2" }), questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })] }
  });
  const result = await verifyReopenIntegrity({ db: w.db, firestore: w.firestore, sessionId: "s1" });
  assert.equal(result.ok, true);
  assert.equal(result.verifiedCount, 2);
});

// =====================================================================================
// 2/4/9. SINGLE CONTRACT SEMANTIC SOURCE — resolveRuntimeQuestions / resolveRuntimeSettings
// =====================================================================================

test("PASS: legacy session resolveRuntimeQuestions returns live legacy questions with embedded options", async () => {
  await seedUsers(); await seedSession("s1");
  await seedLegacyQuestionWithOptions("s1", "legacyQ1", { question: "Câu cũ?", order: 0 });
  const w = writerFor(teacherCtx("teacher-a"));
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const result = await resolveRuntimeQuestions(facade, "sessions/s1", sessionData, "s1");
  assert.equal(result.source, "legacy");
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].id, "legacyQ1");
  assert.equal(result.questions[0].options.length, 2);
});

test("PASS: rev1 -> rev2 resolveRuntimeQuestions returns ONLY the current revision's fresh questions, never a prior revision's", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion({ question: "Rev1 Q" })], legacyQuestions: [] }
  });
  const facade = dbFacadeFor(w);
  const sessionAfterR1 = await getRootDoc(w, "s1");
  const afterR1 = await resolveRuntimeQuestions(facade, "sessions/s1", sessionAfterR1, "s1");
  assert.equal(afterR1.source, "contract-revision");
  assert.equal(afterR1.questions.length, 1);
  assert.equal(afterR1.questions[0].question, "Rev1 Q");
  const rev1Ids = afterR1.questions.map((q) => q.id);

  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion({ question: "Rev2 Q" })] }
  });
  const sessionAfterR2 = await getRootDoc(w, "s1");
  const afterR2 = await resolveRuntimeQuestions(facade, "sessions/s1", sessionAfterR2, "s1");
  assert.equal(afterR2.questions.length, 1);
  assert.equal(afterR2.questions[0].question, "Rev2 Q");
  assert.ok(!rev1Ids.includes(afterR2.questions[0].id), "rev2's resolved question ID must be fresh, never reused from rev1");
});

test("PASS: resolveRuntimeSettings resolves from root for legacy/rev0 and from the Contract config for rev>=1", async () => {
  const w = await activateSession("s1", { allowMultipleResponses: true, showResponderCount: false });
  const facade = dbFacadeFor(w);
  const rev0Session = await getRootDoc(w, "s1");
  const rev0Settings = await resolveRuntimeSettings(facade, "sessions/s1", rev0Session);
  assert.equal(rev0Settings.allowMultipleResponses, true);
  assert.equal(rev0Settings.showResponderCount, false);

  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T1", description: "D1", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [], legacyQuestions: [] }
  });
  const rev1Session = await getRootDoc(w, "s1");
  const rev1Settings = await resolveRuntimeSettings(facade, "sessions/s1", rev1Session);
  // root's own (stale) allowMultipleResponses/showResponderCount are still true/false from
  // activation — the resolved runtime settings must come from the CONFIG, not from root.
  assert.equal(rev1Settings.title, "T1");
  assert.equal(rev1Settings.allowMultipleResponses, false);
  assert.equal(rev1Settings.showResponderCount, true);
  // root itself is untouched (still the activation-time values) — proves the resolver is
  // genuinely reading the config, not silently falling back to root for rev>=1.
  assert.equal(rev1Session.allowMultipleResponses, true);
  assert.equal(rev1Session.showResponderCount, false);
});

// =====================================================================================
// 5. STUDENT FAIL-CLOSED HELPERS
// =====================================================================================

test("isEmbeddedOptionsQuestion / isQuestionCurrentForSession: pure fail-closed logic", () => {
  const legacyQuestion = { type: "single", question: "x" };
  const currentContractQuestion = { configId: "cfgA", type: "single" };
  const staleContractQuestion = { configId: "cfgOLD", type: "single" };
  const sessionData = { currentConfigId: "cfgA" };

  assert.equal(isEmbeddedOptionsQuestion(legacyQuestion), false);
  assert.equal(isEmbeddedOptionsQuestion(currentContractQuestion), true);

  assert.equal(isQuestionCurrentForSession(legacyQuestion, sessionData), true, "a legacy question is always current");
  assert.equal(isQuestionCurrentForSession(currentContractQuestion, sessionData), true);
  assert.equal(isQuestionCurrentForSession(staleContractQuestion, sessionData), false, "a stale/foreign-revision question must fail closed");
  assert.equal(isQuestionCurrentForSession(null, sessionData), false);
});

test("PASS: a real rev1 question is current for its session, and becomes stale once rev2 replaces it", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const rev1Question = (await getDoc(doc(w.db, "questions", r1.resultingQuestions[0].questionId))).data();
  const sessionAfterR1 = await getRootDoc(w, "s1");
  assert.equal(isQuestionCurrentForSession(rev1Question, sessionAfterR1), true);

  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion({ question: "Rev2" })] }
  });
  const sessionAfterR2 = await getRootDoc(w, "s1");
  assert.equal(isQuestionCurrentForSession(rev1Question, sessionAfterR2), false, "the rev1 question must now be recognized as stale");
});

// =====================================================================================
// 8. QR / JOIN STABILITY
// =====================================================================================

test("PASS: sessionId, shortCode, and accessToken are unaffected by a semantic revision", async () => {
  const w = await activateSession("s1", { shortCode: "XYZ999", accessToken: "tok-stable-000000000000000" });
  const before = await getRootDoc(w, "s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const after = await getRootDoc(w, "s1");
  assert.equal(after.shortCode, before.shortCode);
  assert.equal(after.accessToken, before.accessToken);
  assert.equal(qrModalViewModel(before, "X").shortCode, qrModalViewModel(after, "X").shortCode);
});

// =====================================================================================
// 10. PRESENTATION — legacy unchanged, Contract rev>=1 explicitly fails closed
// =====================================================================================

test("PASS: Presentation stays fail-closed (contract-unsupported) for a REAL rev1 session, legacy unaffected", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const rev1Session = await getRootDoc(w, "s1");
  assert.deepEqual(presentationRenderState(rev1Session), { mode: "contract-unsupported" });

  await seedUsers(); await seedSession("legacy1", { status: "open", activeQuestionId: "q1" });
  const legacySession = (await getDoc(doc(w.db, "sessions", "legacy1"))).data();
  assert.equal(presentationRenderState(legacySession).mode, "question");
});

// =====================================================================================
// 15. REGRESSION GUARD — legacy/rev0 completely unaffected by any D2 resolver
// =====================================================================================

test("REGRESSION GUARD: resolveRuntimeQuestions/resolveRuntimeSettings for rev0 baseline match the pre-D2 live-legacy behavior exactly", async () => {
  const w = await activateSession("s1");
  await seedLegacyQuestionWithOptions("s1", "legacyQ1", { question: "Câu rev0?" });
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const runtimeQ = await resolveRuntimeQuestions(facade, "sessions/s1", sessionData, "s1");
  assert.equal(runtimeQ.source, "contract-baseline");
  assert.equal(runtimeQ.questions[0].question, "Câu rev0?");
  const settings = await resolveRuntimeSettings(facade, "sessions/s1", sessionData);
  assert.equal(settings.title, "Cũ");
});
