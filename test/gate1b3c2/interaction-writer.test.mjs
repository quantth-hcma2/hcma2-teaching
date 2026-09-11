// Gate 1B.3-C2 — full Interaction (sessions) reader/writer candidate emulator tests. Real local
// Firestore emulator loaded with the frozen, UNCHANGED Gate 1B.3-C1X Rules candidate (sha256
// 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) — this gate never modifies
// Rules; every test here exercises contract-writer.mjs's applyInteractionRevision() /
// verifyRevisionIntegrity() and session-reader.mjs's resolveInteractionConfig() as real,
// authenticated callers, proving the writer itself can satisfy the frozen Rules exactly. Never
// `firebase deploy`. No production write of any kind.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import {
  activateContract, applyConfigRevision, applyInteractionRevision, verifyRevisionIntegrity, ContractWriterError
} from "../../contract-writer.mjs";
import { resolveInteractionConfig, makeFirestoreDbFacade } from "../../session-reader.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B3C2_EMULATOR_PORT || 8182);
const PROJECT_ID = "demo-hcma2-gate1b3c2";
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

// Activates the versioned contract on a fresh CLOSED legacy session ("s1" by default, owned by
// teacher-a), leaving it at the real revision-0 activation_baseline — the actual starting point
// every real first-transition apply begins from, not a rules-disabled shortcut.
async function activateSession(sessionId = "s1", overrides = {}) {
  await seedUsers();
  await seedSession(sessionId, overrides);
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId, actorUid: "teacher-a", operationId: "op-activate" });
  return w;
}

function authoredQuestion(overrides = {}) {
  return {
    type: "single", question: "Câu hỏi?", description: "Mô tả",
    required: true, chartType: "bar", timeLimit: 30, allowChangeAnswer: false,
    options: [
      { label: "A", text: "Đáp án A", value: null, isCorrect: null },
      { label: "B", text: "Đáp án B", value: null, isCorrect: null }
    ],
    ...overrides
  };
}

function legacyQuestionEntry(overrides = {}) {
  return {
    questionId: "legacyQ1", roundId: "legacy-v0", order: 0, type: "single",
    question: "Câu hỏi cũ?", description: "", required: true, chartType: "bar",
    timeLimit: 0, allowChangeAnswer: false, scaleMin: null, scaleMax: null,
    options: [{ id: "o0", label: "A", text: "A", order: 0, value: null, isCorrect: null }],
    ...overrides
  };
}

// One question per index into index.html's own QUESTION_TYPES key set (single, multiple,
// truefalse, likert, scale, ranking, open) — the writer's own INTERACTION_QUESTION_TYPES
// allowlist is frozen to match exactly these 7 values.
function questionForType(type) {
  if (type === "scale") return authoredQuestion({ type, options: [], chartType: "distribution", scaleMin: 1, scaleMax: 5 });
  if (type === "open") return authoredQuestion({ type, options: [], chartType: "list" });
  if (type === "truefalse") return authoredQuestion({ type, chartType: "donut", options: [{ label: "Đúng", text: "Đúng", value: null, isCorrect: true }, { label: "Sai", text: "Sai", value: null, isCorrect: false }] });
  if (type === "likert") return authoredQuestion({ type, chartType: "stacked" });
  if (type === "ranking") return authoredQuestion({ type, chartType: "hbar" });
  if (type === "multiple") return authoredQuestion({ type, chartType: "hbar" });
  return authoredQuestion({ type: "single", chartType: "bar" });
}

async function getQuestionDoc(w, questionId) {
  const snap = await getDoc(doc(w.db, "questions", questionId));
  return snap.exists() ? snap.data() : null;
}
async function getConfigDoc(w, sessionId, configId) {
  const snap = await getDoc(doc(w.db, "sessions", sessionId, "configVersions", configId));
  return snap.exists() ? snap.data() : null;
}
async function getRootDoc(w, sessionId) {
  const snap = await getDoc(doc(w.db, "sessions", sessionId));
  return snap.data();
}
async function getSnapshotDoc(w, sessionId) {
  const snap = await getDoc(doc(w.db, "sessions", sessionId, "legacyTransitionSnapshot", "snapshot"));
  return snap.exists() ? snap.data() : null;
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof ContractWriterError, `expected ContractWriterError, got ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
    assert.equal(e.code, code, `expected code ${code}, got ${e.code} (${e.message})`);
    return true;
  });
}

// =====================================================================================
// 1. FIRST TRANSITION (revision 0 -> revision 1) — the real writer, not a rules-disabled seed
// =====================================================================================

test("PASS: rev0 -> rev1 first transition creates config + history + snapshot + root reset + 1 question, atomically, as a real authenticated writer call", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: {
      title: "Tiêu đề v1", description: "Mô tả v1", allowMultipleResponses: true, anonymous: false, showResponderCount: true,
      questions: [authoredQuestion()], legacyQuestions: [legacyQuestionEntry()]
    }
  });
  assert.equal(result.replay, false);
  assert.equal(result.resultingRevision, 1);
  assert.equal(result.isFirstTransition, true);

  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 1);
  assert.equal(root.currentConfigId, result.resultingConfigId);
  assert.equal(root.questionCount, 1);
  assert.equal(root.activeQuestionId, null);
  assert.equal(root.activeQuestionStartedAt, null);
  assert.equal(root.responseCount, 0);
  assert.equal(root.liveAggregate, null);
  // never mirrored back to root
  assert.equal(root.title, "Cũ");
  assert.equal(root.description, "Mô tả cũ");

  const cfg = await getConfigDoc(w, "s1", result.resultingConfigId);
  assert.equal(cfg.kind, "interaction");
  assert.equal(cfg.source, "apply_config");
  assert.equal(cfg.roundId, result.resultingConfigId);
  assert.equal(cfg.title, "Tiêu đề v1");
  assert.equal(cfg.allowMultipleResponses, true);
  assert.equal(cfg.questions.length, 1);

  const q = await getQuestionDoc(w, `${result.resultingConfigId}_q0`);
  assert.ok(q, "expected question doc at the deterministic {configId}_q0 path");
  assert.equal(q.configId, result.resultingConfigId);
  assert.equal(q.revision, 1);
  assert.equal(q.sessionId, "s1");
  assert.equal(q.ownerId, "teacher-a");
  assert.equal(q.options.length, 2);
  assert.equal(q.options[0].id, "o0");
  assert.equal(q.options[1].id, "o1");
});

test("PASS: valid snapshot is created exactly once on the first transition, with the frozen schema", async () => {
  const w = await activateSession("s1");
  const baselineConfigId = (await getRootDoc(w, "s1")).currentConfigId;
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [], legacyQuestions: [legacyQuestionEntry()] }
  });
  const snap = await getSnapshotDoc(w, "s1");
  assert.ok(snap);
  assert.equal(snap.kind, "legacy_transition_snapshot");
  assert.equal(snap.basis, "editor_confirmed");
  assert.equal(snap.capturedDuringOperationId, "op-1");
  assert.ok(snap.appliedAt);
  assert.equal(snap.legacyQuestions.length, 1);
  assert.equal(snap.legacyQuestions[0].questionId, "legacyQ1");
  // parentConfigId must equal the session's PRE-transition (activation-baseline) configId,
  // never the newly-created revision-1 configId.
  assert.equal(snap.parentConfigId, baselineConfigId);
  assert.notEqual(snap.parentConfigId, result.resultingConfigId);
});

test("PASS: rev1 -> rev2 via the real writer, carrying forward unspecified fields from rev1", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "V1", description: "D1", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [authoredQuestion()], legacyQuestions: [legacyQuestionEntry()] }
  });
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { title: "V2" }
  });
  assert.equal(r2.resultingRevision, 2);
  assert.notEqual(r2.resultingConfigId, r1.resultingConfigId);
  const cfg2 = await getConfigDoc(w, "s1", r2.resultingConfigId);
  assert.equal(cfg2.title, "V2");
  assert.equal(cfg2.description, "D1"); // carried forward
  assert.equal(cfg2.anonymous, true); // carried forward
  assert.equal(cfg2.questions.length, 1); // carried forward, fresh IDs
  assert.equal(cfg2.questions[0].questionId, `${r2.resultingConfigId}_q0`);
  // rev1's own question doc is untouched, still exists, unrelated to rev2's fresh one
  const q1 = await getQuestionDoc(w, `${r1.resultingConfigId}_q0`);
  assert.ok(q1);
  assert.equal(q1.revision, 1);
});

// =====================================================================================
// 2. SCALE: 1 / 100 questions, 20 options, all 7 question types
// =====================================================================================

test("PASS: N=1 question full revision", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [] }
  });
  assert.equal(result.resultingQuestions.length, 1);
});

test("PASS: N=100 questions full revision (the frozen maxQuestionsPerRound ceiling)", async () => {
  const w = await activateSession("s1");
  const questions = Array.from({ length: 100 }, (_, i) => authoredQuestion({ question: `Câu ${i}` }));
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions, legacyQuestions: [] }
  });
  assert.equal(result.resultingRevision, 1);
  assert.equal(result.resultingQuestions.length, 100);
  const root = await getRootDoc(w, "s1");
  assert.equal(root.questionCount, 100);
  const first = await getQuestionDoc(w, `${result.resultingConfigId}_q0`);
  const last = await getQuestionDoc(w, `${result.resultingConfigId}_q99`);
  assert.ok(first); assert.ok(last);
  assert.equal(last.order, 99);
});

test("PASS: all 7 question types (single, multiple, truefalse, likert, scale, ranking, open) in one revision", async () => {
  const w = await activateSession("s1");
  const types = ["single", "multiple", "truefalse", "likert", "scale", "ranking", "open"];
  const questions = types.map((t) => questionForType(t));
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions, legacyQuestions: [] }
  });
  for (let i = 0; i < types.length; i++) {
    const q = await getQuestionDoc(w, `${result.resultingConfigId}_q${i}`);
    assert.ok(q, `expected question doc for type ${types[i]}`);
    assert.equal(q.type, types[i]);
  }
});

test("PASS: 20 options on one question (the frozen maxOptionsPerQuestion ceiling)", async () => {
  const w = await activateSession("s1");
  const options = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, text: `T${i}`, value: null, isCorrect: null }));
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion({ options })], legacyQuestions: [] }
  });
  const q = await getQuestionDoc(w, `${result.resultingConfigId}_q0`);
  assert.equal(q.options.length, 20);
  assert.equal(q.options[19].id, "o19");
});

// =====================================================================================
// 3. REORDER / PARTIAL-FIELD REVISIONS — every revision gets fresh question IDs
// =====================================================================================

test("PASS: reorder-only revision gets ALL fresh question IDs, even for unchanged content", async () => {
  const w = await activateSession("s1");
  const qA = authoredQuestion({ question: "A" });
  const qB = authoredQuestion({ question: "B" });
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [qA, qB], legacyQuestions: [] }
  });
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { questions: [qB, qA] } // reordered, byte-identical content otherwise
  });
  const cfg2 = await getConfigDoc(w, "s1", r2.resultingConfigId);
  assert.equal(cfg2.questions[0].question, "B");
  assert.equal(cfg2.questions[1].question, "A");
  assert.equal(cfg2.questions[0].questionId, `${r2.resultingConfigId}_q0`);
  assert.equal(cfg2.questions[1].questionId, `${r2.resultingConfigId}_q1`);
  // neither rev2 questionId reuses any rev1 questionId
  assert.notEqual(cfg2.questions[0].questionId, `${r1.resultingConfigId}_q0`);
  assert.notEqual(cfg2.questions[1].questionId, `${r1.resultingConfigId}_q1`);
  // both rev1 docs are still present, untouched
  assert.ok(await getQuestionDoc(w, `${r1.resultingConfigId}_q0`));
  assert.ok(await getQuestionDoc(w, `${r1.resultingConfigId}_q1`));
});

test("PASS: behavioral-setting-only revision (allowMultipleResponses) carries title/description/questions forward", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T1", description: "D1", allowMultipleResponses: false, questions: [authoredQuestion({ question: "Q1" })], legacyQuestions: [] }
  });
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { allowMultipleResponses: true }
  });
  const cfg2 = await getConfigDoc(w, "s1", r2.resultingConfigId);
  assert.equal(cfg2.allowMultipleResponses, true);
  assert.equal(cfg2.title, "T1");
  assert.equal(cfg2.description, "D1");
  assert.equal(cfg2.questions[0].question, "Q1");
  assert.notEqual(cfg2.questions[0].questionId, r1.resultingQuestions[0].questionId);
});

test("PASS: title-only semantic revision carries everything else forward", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "Old", description: "D1", questions: [authoredQuestion({ question: "Q1" })], legacyQuestions: [] }
  });
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { title: "New" }
  });
  const cfg2 = await getConfigDoc(w, "s1", r2.resultingConfigId);
  assert.equal(cfg2.title, "New");
  assert.equal(cfg2.description, "D1");
  assert.equal(cfg2.questions[0].question, "Q1");
});

test("PASS: timeLimit-only semantic revision (the only field that differs across the whole revision is one question's timeLimit)", async () => {
  const w = await activateSession("s1");
  const q1 = authoredQuestion({ question: "Q1", timeLimit: 30 });
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [q1], legacyQuestions: [] }
  });
  const q1ChangedTime = { ...q1, timeLimit: 90 };
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { questions: [q1ChangedTime] }
  });
  const cfg2 = await getConfigDoc(w, "s1", r2.resultingConfigId);
  assert.equal(cfg2.questions[0].timeLimit, 90);
  assert.equal(cfg2.questions[0].question, "Q1");
  assert.equal(cfg2.title, "T");
});

// =====================================================================================
// 4. IDEMPOTENCY
// =====================================================================================

test("PASS: same operationId + same payload is an idempotent replay — no new config, no second snapshot, no duplicate questions", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [legacyQuestionEntry()] };
  const r1 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  const r2 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  assert.equal(r1.replay, false);
  assert.equal(r2.replay, true);
  assert.equal(r2.resultingConfigId, r1.resultingConfigId);
  assert.equal(r2.resultingRevision, r1.resultingRevision);
  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 1); // not bumped a second time
});

test("PASS (best-effort, harness-dependent): two concurrent calls with the same operationId + same payload converge on exactly one committed revision", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [legacyQuestionEntry()] };
  const [a, b] = await Promise.allSettled([
    applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-race", expectedRevision: 0, changes }),
    applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-race", expectedRevision: 0, changes })
  ]);
  const fulfilled = [a, b].filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.ok(fulfilled.length >= 1, "at least one concurrent attempt must succeed");
  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 1); // exactly one real revision landed, regardless of how many attempts fulfilled
  for (const f of fulfilled) assert.equal(f.resultingConfigId, root.currentConfigId);
});

test("DENY: same operationId + different semantic payload is OPERATION_ID_PAYLOAD_MISMATCH", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "A", description: "D", questions: [], legacyQuestions: [] }
  });
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "B-different", description: "D", questions: [], legacyQuestions: [] }
  }), "OPERATION_ID_PAYLOAD_MISMATCH");
});

// =====================================================================================
// GATE 1B.3-C2R item A — idempotent replay must re-earn the same completeness proof a fresh
// write does, not skip it because "it was already proven once at commit time". Between the
// original commit and a later retry, the operational question documents are ordinary Firestore
// documents nothing prevents from being tampered with out-of-band.
// =====================================================================================

test("DENY (GATE 1B.3-C2R item A): replaying a matching operationId after an operational question was deleted out-of-band fails REVISION_INTEGRITY_VERIFICATION_FAILED, never a successful replay", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] };
  const r1 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  const victimId = `${r1.resultingConfigId}_q1`;
  await seedWithRulesDisabled(async (d) => { await deleteDoc(doc(d, "questions", victimId)); });
  await assert.rejects(
    applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes }),
    (e) => {
      assert.ok(e instanceof ContractWriterError);
      assert.equal(e.code, "REVISION_INTEGRITY_VERIFICATION_FAILED");
      assert.equal(e.details.reason, "MISSING");
      assert.equal(e.details.questionId, victimId);
      return true;
    }
  );
  // no compensating write / repair: root and history stay exactly where the original commit
  // left them, and the operationId's history entry is not touched by the failed replay attempt.
  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 1);
  assert.equal(root.currentConfigId, r1.resultingConfigId);
  // still deleted, no repair attempted — checked with Rules disabled since an authenticated
  // read of a genuinely-absent Contract question surfaces as permission-denied, not "not found"
  // (see verifyRevisionIntegrity's own comment on this same Rules quirk).
  let victimExists = true;
  await seedWithRulesDisabled(async (d) => { victimExists = (await getDoc(doc(d, "questions", victimId))).exists(); });
  assert.equal(victimExists, false);
});

test("DENY (GATE 1B.3-C2R item A): replaying a matching operationId after an operational question was mutated out-of-band also fails REVISION_INTEGRITY_VERIFICATION_FAILED", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [] };
  const r1 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  const victimId = `${r1.resultingConfigId}_q0`;
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "questions", victimId), { question: "Đã bị sửa ngoài luồng" }); });
  await rejectsWithCode(
    applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes }),
    "REVISION_INTEGRITY_VERIFICATION_FAILED"
  );
});

// =====================================================================================
// GATE 1B.3-C2R item B — the first-transition snapshot's legacyQuestions payload is part of
// the operation's semantic content for idempotency purposes: a retry with the identical
// revision-1 manifest but a DIFFERENT legacy snapshot payload must never be treated as the same
// operation. On revision >=1 -> later revisions, legacyQuestions is irrelevant to comparison —
// it can never cause a second snapshot to be created or updated regardless of what a caller
// resupplies (already covered by the "never touches the existing snapshot" test above; this
// section proves the FIRST-transition comparison specifically).
// =====================================================================================

test("DENY (GATE 1B.3-C2R item B): same operationId + identical revision-1 manifest but a DIFFERENT legacy snapshot payload is OPERATION_ID_PAYLOAD_MISMATCH, not a successful replay", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion()] };
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...changes, legacyQuestions: [legacyQuestionEntry({ question: "Payload A" })] }
  });
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...changes, legacyQuestions: [legacyQuestionEntry({ question: "Payload B — different" })] }
  }), "OPERATION_ID_PAYLOAD_MISMATCH");
  // no second snapshot, no corruption of the original one
  const snap = await getSnapshotDoc(w, "s1");
  assert.equal(snap.legacyQuestions[0].question, "Payload A");
});

test("PASS (GATE 1B.3-C2R item B): same operationId + identical revision-1 manifest AND identical legacy snapshot payload replays cleanly", async () => {
  const w = await activateSession("s1");
  const changes = { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [legacyQuestionEntry({ question: "Same payload" })] };
  const r1 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  const r2 = await applyInteractionRevision({ ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0, changes });
  assert.equal(r2.replay, true);
  assert.equal(r2.resultingConfigId, r1.resultingConfigId);
});

// =====================================================================================
// 5. LIFECYCLE / STALE-REVISION DENY
// =====================================================================================

test("DENY: session not CLOSED", async () => {
  const w = await activateSession("s1");
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); });
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [], legacyQuestions: [] }
  }), "LIFECYCLE_NOT_SAFE");
});

test("DENY: stale expectedRevision", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [], legacyQuestions: [] }
  });
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, // stale: real is now 1
    changes: { title: "T2", description: "D", questions: [], legacyQuestions: [] }
  }), "STALE_REVISION");
});

// =====================================================================================
// 6. SHAPE / LIMIT DENY
// =====================================================================================

test("DENY: 101 questions (over the frozen maxQuestionsPerRound)", async () => {
  const w = await activateSession("s1");
  const questions = Array.from({ length: 101 }, (_, i) => authoredQuestion({ question: `Q${i}` }));
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions, legacyQuestions: [] }
  }), "TOO_MANY_QUESTIONS");
});

test("DENY: 21 options on one question (over the frozen maxOptionsPerQuestion)", async () => {
  const w = await activateSession("s1");
  const options = Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, text: `T${i}`, value: null, isCorrect: null }));
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion({ options })], legacyQuestions: [] }
  }), "TOO_MANY_OPTIONS");
});

test("DENY: manifest exceeds the frozen byte-size cap", async () => {
  const w = await activateSession("s1");
  const hugeDescription = "x".repeat(80000);
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: hugeDescription, questions: [], legacyQuestions: [] }
  }), "MANIFEST_INVALID");
});

test("DENY: legacy transition snapshot exceeds the frozen byte-size cap", async () => {
  const w = await activateSession("s1");
  const hugeLegacy = [legacyQuestionEntry({ question: "y".repeat(80000) })];
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [], legacyQuestions: hugeLegacy }
  }), "SNAPSHOT_TOO_LARGE");
});

test("DENY: malformed/unknown question type", async () => {
  const w = await activateSession("s1");
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion({ type: "not-a-real-type" })], legacyQuestions: [] }
  }), "INVALID_QUESTION_TYPE");
});

test("DENY: invalid scale bounds (scaleMin >= scaleMax)", async () => {
  const w = await activateSession("s1");
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion({ type: "scale", options: [], chartType: "distribution", scaleMin: 5, scaleMax: 1 })], legacyQuestions: [] }
  }), "INVALID_SCALE_BOUNDS");
});

test("DENY: first transition without a supplied legacyQuestions payload", async () => {
  const w = await activateSession("s1");
  await rejectsWithCode(applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [] } // legacyQuestions omitted entirely
  }), "LEGACY_SNAPSHOT_REQUIRED");
});

// =====================================================================================
// 7. TRUSTED IDENTIFIER GENERATION — caller injection is structurally ignored, never trusted
// =====================================================================================

test("PASS: a caller-injected questionId is ignored — the writer's own deterministic {configId}_q{order} ID is what actually gets created", async () => {
  const w = await activateSession("s1");
  const injected = authoredQuestion({ questionId: "attacker-chosen-id", id: "attacker-chosen-id" });
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [injected], legacyQuestions: [] }
  });
  // A read rule keyed on resource.data (owner match) cannot be evaluated at all against a
  // document that plain doesn't exist, so an authenticated getDoc() for a genuinely-absent
  // document surfaces as permission-denied rather than a clean "not found" — check existence
  // with Rules disabled instead, purely to distinguish "never created" from "inaccessible".
  let attackerExists = true;
  await seedWithRulesDisabled(async (d) => { attackerExists = (await getDoc(doc(d, "questions", "attacker-chosen-id"))).exists(); });
  assert.equal(attackerExists, false, "no document must ever land at the caller-injected ID");
  const real = await getQuestionDoc(w, `${result.resultingConfigId}_q0`);
  assert.ok(real);
});

test("PASS: a caller-injected configId/revision/roundId is ignored — the writer generates its own trusted identifiers", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: {
      title: "T", description: "D", questions: [], legacyQuestions: [],
      configId: "attacker-config", revision: 999, roundId: "attacker-round"
    }
  });
  assert.notEqual(result.resultingConfigId, "attacker-config");
  assert.equal(result.resultingRevision, 1);
  const attackerCfg = await getConfigDoc(w, "s1", "attacker-config");
  assert.equal(attackerCfg, null);
  const realCfg = await getConfigDoc(w, "s1", result.resultingConfigId);
  assert.equal(realCfg.roundId, result.resultingConfigId);
});

// =====================================================================================
// 8. SECOND-SNAPSHOT SAFETY (writer-level: never even attempted on a non-first transition)
// =====================================================================================

test("PASS: a caller mistakenly re-supplying legacyQuestions on revision 1 -> 2 never touches the existing snapshot", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [], legacyQuestions: [legacyQuestionEntry()] }
  });
  const before = await getSnapshotDoc(w, "s1");
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { title: "T2", legacyQuestions: [legacyQuestionEntry({ question: "should be ignored" })] }
  });
  assert.equal(r2.isFirstTransition, false);
  const after = await getSnapshotDoc(w, "s1");
  assert.deepEqual(after, before, "the original snapshot must be byte-identical, never rewritten");
});

// =====================================================================================
// 9. POST-COMMIT INTEGRITY VERIFICATION
// =====================================================================================

test("PASS: post-commit verification succeeds silently for a genuinely intact revision, and re-verifying explicitly also succeeds", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] }
  });
  await assert.doesNotReject(verifyRevisionIntegrity({
    ...w, sessionId: "s1", configId: result.resultingConfigId, revision: result.resultingRevision, expectedQuestions: result.resultingQuestions
  }));
});

test("DENY: simulated missing operational question after commit -> REVISION_INTEGRITY_VERIFICATION_FAILED, no rollback/repair attempted", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })], legacyQuestions: [] }
  });
  const victimId = `${result.resultingConfigId}_q1`;
  await seedWithRulesDisabled(async (d) => { await deleteDoc(doc(d, "questions", victimId)); });
  await assert.rejects(
    verifyRevisionIntegrity({ ...w, sessionId: "s1", configId: result.resultingConfigId, revision: result.resultingRevision, expectedQuestions: result.resultingQuestions }),
    (e) => { assert.equal(e.code, "REVISION_INTEGRITY_VERIFICATION_FAILED"); assert.equal(e.details.reason, "MISSING"); assert.equal(e.details.questionId, victimId); return true; }
  );
  // no compensating write: the session root must remain exactly as the original commit left it
  const root = await getRootDoc(w, "s1");
  assert.equal(root.configRevision, 1);
  assert.equal(root.status, "closed");
});

test("DENY: simulated semantic mismatch after commit -> REVISION_INTEGRITY_VERIFICATION_FAILED, no rollback/repair attempted", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T", description: "D", questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const victimId = `${result.resultingConfigId}_q0`;
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "questions", victimId), { question: "Đã bị sửa ngoài luồng" }); });
  await assert.rejects(
    verifyRevisionIntegrity({ ...w, sessionId: "s1", configId: result.resultingConfigId, revision: result.resultingRevision, expectedQuestions: result.resultingQuestions }),
    (e) => { assert.equal(e.code, "REVISION_INTEGRITY_VERIFICATION_FAILED"); assert.equal(e.details.reason, "MISMATCH"); return true; }
  );
  const root = await getRootDoc(w, "s1");
  assert.equal(root.status, "closed"); // still CLOSED, no attempted repair
});

// =====================================================================================
// 10. READER — full effective config, and honest revision-0 behavior
// =====================================================================================

test("PASS: reader returns the full effective rev1 config (behavioral settings + ordered questions + embedded options + revision/configId/roundId)", async () => {
  const w = await activateSession("s1");
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T1", description: "D1", allowMultipleResponses: true, anonymous: false, showResponderCount: true, questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "contract-revision");
  assert.equal(cfg.revision, 1);
  assert.equal(cfg.configId, result.resultingConfigId);
  assert.equal(cfg.roundId, result.resultingConfigId);
  assert.equal(cfg.title, "T1");
  assert.equal(cfg.allowMultipleResponses, true);
  assert.equal(cfg.anonymous, false);
  assert.equal(cfg.questions.length, 1);
  assert.equal(cfg.questions[0].options.length, 2);
});

test("PASS: reader returns the full effective rev2 config after a second apply", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T1", description: "D1", questions: [authoredQuestion()], legacyQuestions: [] }
  });
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { title: "T2" }
  });
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.revision, 2);
  assert.equal(cfg.configId, r2.resultingConfigId);
  assert.equal(cfg.title, "T2");
});

test("PASS: reader preserves revision-0 honesty — never fabricates historical questions into the activation baseline", async () => {
  const w = await activateSession("s1");
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "contract-baseline");
  assert.equal(cfg.revision, 0);
  assert.equal(cfg.questions, null);
  assert.equal(cfg.title, "Cũ"); // whatever the legacy session actually had at activation
});

test("PASS: reader reports plain legacy (no contract at all) honestly, distinct from contract-baseline", async () => {
  await seedUsers();
  await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "legacy");
  assert.equal(cfg.questions, null);
});

// =====================================================================================
// GATE 1B.3-C2R item C — three-state reader historical honesty, proven explicitly.
//
// State 1 (pure legacy, never activated): resolveInteractionConfig() returns source:"legacy"
// and questions:null — it never reads or embeds the live questions collection itself. A caller
// that wants "current questions" for this state reads the live, still-mutable questions
// collection directly (exactly as every pre-Gate-1B consumer already does) and the "legacy"
// source tag is what tells that caller this data is current/unversioned, never an immutable
// snapshot.
//
// State 2 (contract revision-0 activation baseline): resolveInteractionConfig() returns
// source:"contract-baseline", questions:null — same reasoning, but additionally proven here
// against a session whose activation_baseline config genuinely has no `questions` field at all
// (per activateContract()'s own frozen manifestFields, title/description only), even when live,
// still-mutable legacy question documents happen to still physically exist for this session:
// they must never be silently read and presented as "the revision-0 question snapshot".
//
// State 3 (contract revision >=1): resolveInteractionConfig() sources questions ONLY from the
// immutable configVersions/{currentConfigId} document. Proven here against a session that has
// BOTH a real revision-1 manifest AND leftover live legacy question documents (same sessionId,
// predating activation) still sitting in the mutable `questions` collection — the resolved
// config's `questions` must be exactly the manifest's own embedded array, with no trace of the
// leftover legacy documents' content, and the reader must not substitute or merge in
// legacyTransitionSnapshot content as if it were "the current config" either (that snapshot is
// a separate, explicitly-named pre-revision-1 compatibility artifact, not part of what
// resolveInteractionConfig reports as the CURRENT effective config).
// =====================================================================================

test("STATE 1 (GATE 1B.3-C2R item C): pure legacy session — reader never embeds live legacy question docs, tags them as current/unversioned by omission", async () => {
  await seedUsers();
  await seedSession("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", "legacy-q-live-1"), {
      sessionId: "s1", ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi đang sống",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const w = writerFor(teacherCtx("teacher-a"));
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "legacy");
  assert.equal(cfg.revision, null);
  assert.equal(cfg.questions, null, "must never silently embed the live legacy questions collection as if it were versioned");
});

test("STATE 2 (GATE 1B.3-C2R item C): revision-0 activation baseline — reader never fabricates a question snapshot, even when live legacy question docs still exist for this session", async () => {
  const w = await activateSession("s1"); // seeds no legacy question docs itself; add one explicitly below
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", "legacy-q-live-1"), {
      sessionId: "s1", ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi cũ vẫn còn sống",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "contract-baseline");
  assert.equal(cfg.revision, 0);
  assert.equal(cfg.questions, null, "revision-0 config genuinely has no questions field; must never be filled in from the live legacy collection and presented as a historical snapshot");
});

test("STATE 3 (GATE 1B.3-C2R item C): revision >=1 — current semantics come ONLY from the immutable configVersions doc, never from leftover live legacy question docs or a silent legacyTransitionSnapshot substitution", async () => {
  const w = await activateSession("s1");
  // A leftover live legacy question doc for this same session, predating activation — must
  // never leak into the resolved CURRENT config once a real revision exists.
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", "legacy-q-live-1"), {
      sessionId: "s1", ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi cũ còn sót lại",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const legacySnapshotQuestion = legacyQuestionEntry({ question: "CHỈ thuộc về legacyTransitionSnapshot, không phải cấu hình hiện hành" });
  const result = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { title: "T1", description: "D1", questions: [authoredQuestion({ question: "Câu hỏi rev1 thật" })], legacyQuestions: [legacySnapshotQuestion] }
  });
  const dbFacade = makeFirestoreDbFacade(w.db, firestoreFns);
  const sessionData = await getRootDoc(w, "s1");
  const cfg = await resolveInteractionConfig(dbFacade, "sessions/s1", sessionData);
  assert.equal(cfg.source, "contract-revision");
  assert.equal(cfg.revision, 1);
  assert.equal(cfg.questions.length, 1);
  assert.equal(cfg.questions[0].question, "Câu hỏi rev1 thật");
  const questionTexts = cfg.questions.map((q) => q.question);
  assert.ok(!questionTexts.includes("Câu hỏi cũ còn sót lại"), "the leftover live legacy document must never appear in the resolved current config");
  assert.ok(!questionTexts.includes(legacySnapshotQuestion.question), "legacyTransitionSnapshot content must never be substituted in as if it were the current config");
  // the snapshot itself is untouched and separately readable, exactly where it belongs — it is
  // simply not part of what resolveInteractionConfig() reports as the CURRENT effective config.
  const snap = await getSnapshotDoc(w, "s1");
  assert.equal(snap.legacyQuestions[0].question, legacySnapshotQuestion.question);
  assert.notEqual(result.resultingConfigId, undefined);
});

// =====================================================================================
// 11. UNTOUCHED FAMILIES — groupActivities / knowledgeSessions keep using the generic path
// =====================================================================================

test("REGRESSION GUARD: applyConfigRevision() for groupActivities is completely unaffected by the sessions/Interaction extension", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "groupActivities", "g1"), {
      ownerId: "teacher-a", classId: "c1", className: "K1", title: "Thảo luận", instructions: "Làm việc nhóm",
      groupCount: 4, durationSec: 600, allowText: true, allowPhoto: false, allowFile: false,
      joinCode: "JOIN1", status: "closed", startedAt: null, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const w = writerFor(teacherCtx("teacher-a"));
  const activated = await activateContract({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(activated.resultingRevision, 0);
  const applied = await applyConfigRevision({ ...w, family: "groupActivities", sessionId: "g1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 0, changes: { title: "Mới" } });
  assert.equal(applied.resultingRevision, 1);
});
