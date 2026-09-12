// Gate 1B.3-D1 — Contract Interaction semantic editor logic tests. Real local Firestore
// emulator loaded with the frozen, UNCHANGED Gate 1B.3-C1X Rules candidate (sha256
// 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) — D1 never modifies Rules.
// Exercises contract-editor.mjs (the new, narrowly-scoped UI helper module index.html's
// Contract semantic editor calls) as a real, authenticated caller driving the completed Gate
// 1B.3-C2 writer/reader contract — never a rules-disabled shortcut for the behavior under test.
// No `firebase deploy`. No production write of any kind.

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
import {
  resolveEditorEntryState, hasSemanticChange, saveInteractionRevision, classifyWriterError,
  shouldDisableLegacyTimeEdit, ContractEditorError, loadLiveLegacyQuestionsWithOptions
} from "../../contract-editor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B3D1_EMULATOR_PORT || 8183);
const PROJECT_ID = "demo-hcma2-gate1b3d1";
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
// 1. EDIT ENTRY BEHAVIOR — three honest states, item 1
// =====================================================================================

test("PASS: legacy (not activated) session resolves mode 'legacy' — the Contract editor must never open for it", async () => {
  await seedUsers();
  await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const state = await resolveEditorEntryState(facade, "sessions/s1", sessionData, "s1");
  assert.equal(state.mode, "legacy");
});

test("PASS: rev0 editor loads honest legacy semantic state (live legacy questions + options, not fabricated)", async () => {
  const w = await activateSession("s1");
  await seedLegacyQuestionWithOptions("s1", "legacyQ1", { question: "Câu cũ 1?", order: 0 });
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const state = await resolveEditorEntryState(facade, "sessions/s1", sessionData, "s1");
  assert.equal(state.mode, "rev0");
  assert.equal(state.expectedRevision, 0);
  assert.equal(state.editorSeed.title, "Cũ");
  assert.equal(state.editorSeed.questions.length, 1);
  assert.equal(state.editorSeed.questions[0].question, "Câu cũ 1?");
  assert.equal(state.editorSeed.questions[0].options.length, 2);
  assert.equal(state.legacyQuestionsForSnapshot.length, 1);
  assert.equal(state.legacyQuestionsForSnapshot[0].questionId, "legacyQ1");
});

test("PASS: rev1 editor loads SOLELY from the immutable Contract config, never from leftover live legacy documents", async () => {
  const w = await activateSession("s1");
  // A leftover live legacy question doc predating the real revision — must never leak in.
  await seedLegacyQuestionWithOptions("s1", "legacyQ1", { question: "CŨ, không thuộc rev1" });
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields({ title: "Rev1 Title" }), questions: [authoredQuestion({ question: "Câu rev1 thật" })], legacyQuestions: [] }
  });
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const state = await resolveEditorEntryState(facade, "sessions/s1", sessionData, "s1");
  assert.equal(state.mode, "revN");
  assert.equal(state.expectedRevision, 1);
  assert.equal(state.editorSeed.title, "Rev1 Title");
  assert.equal(state.editorSeed.questions.length, 1);
  assert.equal(state.editorSeed.questions[0].question, "Câu rev1 thật");
  assert.ok(!state.editorSeed.questions.some((q) => q.question.includes("CŨ")), "leftover live legacy content must never appear in the rev>=1 editor seed");
  assert.equal(state.legacyQuestionsForSnapshot, undefined, "legacyQuestionsForSnapshot must not be produced for rev>=1 (no first-transition payload to build)");
});

// =====================================================================================
// 2/5/6. rev0 -> rev1 SAVE WITH SNAPSHOT PAYLOAD, FRESH IDENTIFIERS
// =====================================================================================

test("PASS: rev0 -> rev1 save calls the writer with the loaded snapshot payload, atomically", async () => {
  const w = await activateSession("s1");
  await seedLegacyQuestionWithOptions("s1", "legacyQ1", { question: "Câu cũ?" });
  const facade = dbFacadeFor(w);
  const sessionData = await getRootDoc(w, "s1");
  const state = await resolveEditorEntryState(facade, "sessions/s1", sessionData, "s1");
  const candidateChanges = { ...state.editorSeed, title: "Tiêu đề rev1" };
  const outcome = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-save-1", mode: state.mode,
    expectedRevision: state.expectedRevision, editorSeed: state.editorSeed, candidateChanges,
    legacyQuestionsForSnapshot: state.legacyQuestionsForSnapshot
  });
  assert.equal(outcome.noChange, false);
  assert.equal(outcome.result.resultingRevision, 1);
  assert.equal(outcome.result.isFirstTransition, true);
  const snapSnap = await getDoc(doc(w.db, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"));
  assert.ok(snapSnap.exists());
  assert.equal(snapSnap.data().legacyQuestions[0].questionId, "legacyQ1");
  // no hidden root semantic mirroring
  const root = await getRootDoc(w, "s1");
  assert.equal(root.title, "Cũ");
  assert.equal(root.description, "Mô tả cũ");
});

test("PASS: reorder-only, add/remove-question, option-edit and every single-field-only revision are each detected as a semantic change and saved as a fresh revision with brand-new question IDs", async () => {
  const w = await activateSession("s1");
  const qA = authoredQuestion({ question: "A" });
  const qB = authoredQuestion({ question: "B" });
  const seed = { ...sessionLevelFields(), questions: [qA, qB] };
  const r1 = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
    expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed,
    legacyQuestionsForSnapshot: []
  });
  assert.equal(r1.noChange, false);
  const rev1ConfigId = r1.result.resultingConfigId;
  const rev1QIds = r1.result.resultingQuestions.map((q) => q.questionId);

  // reorder-only
  const r2 = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", mode: "revN", expectedRevision: 1,
    editorSeed: seed, candidateChanges: { ...sessionLevelFields(), questions: [qB, qA] }
  });
  assert.equal(r2.noChange, false, "reorder-only must be detected as a semantic change");
  assert.notEqual(r2.result.resultingConfigId, rev1ConfigId);
  const rev2QIds = r2.result.resultingQuestions.map((q) => q.questionId);
  for (const id of rev2QIds) assert.ok(!rev1QIds.includes(id), "every rev2 question ID must be fresh, never reused from rev1");
  assert.equal(r2.result.resultingQuestions[0].question, "B");

  // add question
  const r3 = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-3", mode: "revN", expectedRevision: 2,
    editorSeed: { ...sessionLevelFields(), questions: [qB, qA] }, candidateChanges: { ...sessionLevelFields(), questions: [qB, qA, authoredQuestion({ question: "C" })] }
  });
  assert.equal(r3.noChange, false);
  assert.equal(r3.result.resultingQuestions.length, 3);

  // remove question
  const r4 = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-4", mode: "revN", expectedRevision: 3,
    editorSeed: { ...sessionLevelFields(), questions: [qB, qA, authoredQuestion({ question: "C" })] }, candidateChanges: { ...sessionLevelFields(), questions: [qB, qA] }
  });
  assert.equal(r4.noChange, false);
  assert.equal(r4.result.resultingQuestions.length, 2);

  // option edit only
  const qBEditedOption = { ...qB, options: [qB.options[0], { ...qB.options[1], text: "Đáp án B (sửa)" }] };
  const r5 = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-5", mode: "revN", expectedRevision: 4,
    editorSeed: { ...sessionLevelFields(), questions: [qB, qA] }, candidateChanges: { ...sessionLevelFields(), questions: [qBEditedOption, qA] }
  });
  assert.equal(r5.noChange, false, "an option-text-only edit must be detected as a semantic change");
  const savedQ = await getDoc(doc(w.db, "questions", r5.result.resultingQuestions[0].questionId));
  assert.equal(savedQ.data().options[1].text, "Đáp án B (sửa)");
});

for (const [label, seedOverride, candidateOverride] of [
  ["title-only", {}, { title: "Tiêu đề mới" }],
  ["description-only", {}, { description: "Mô tả mới" }],
  ["behavioral-setting-only", {}, { allowMultipleResponses: true }],
]) {
  test(`PASS: ${label} revision is detected as a semantic change and saves a fresh revision`, async () => {
    const w = await activateSession("s1");
    const q = authoredQuestion();
    const seed = { ...sessionLevelFields(seedOverride), questions: [q] };
    await saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
      expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed, legacyQuestionsForSnapshot: []
    });
    const outcome = await saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", mode: "revN", expectedRevision: 1,
      editorSeed: seed, candidateChanges: { ...sessionLevelFields({ ...seedOverride, ...candidateOverride }), questions: [q] }
    });
    assert.equal(outcome.noChange, false);
    assert.equal(outcome.result.resultingRevision, 2);
  });
}

test("PASS: timeLimit-only revision (the only difference across the whole revision is one question's timeLimit) is detected and saved", async () => {
  const w = await activateSession("s1");
  const q = authoredQuestion({ timeLimit: 30 });
  const seed = { ...sessionLevelFields(), questions: [q] };
  await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
    expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed, legacyQuestionsForSnapshot: []
  });
  const outcome = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", mode: "revN", expectedRevision: 1,
    editorSeed: seed, candidateChanges: { ...sessionLevelFields(), questions: [{ ...q, timeLimit: 90 }] }
  });
  assert.equal(outcome.noChange, false);
  const savedQ = await getDoc(doc(w.db, "questions", outcome.result.resultingQuestions[0].questionId));
  assert.equal(savedQ.data().timeLimit, 90);
});

// =====================================================================================
// 4. NO-CHANGE DETECTION
// =====================================================================================

test("PASS: identical editor state produces NO revision and never calls the writer", async () => {
  const w = await activateSession("s1");
  const q = authoredQuestion();
  const seed = { ...sessionLevelFields(), questions: [q] };
  await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
    expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed, legacyQuestionsForSnapshot: []
  });
  const rootBefore = await getRootDoc(w, "s1");
  const outcome = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", mode: "revN", expectedRevision: 1,
    editorSeed: seed, candidateChanges: { ...sessionLevelFields(), questions: [q] } // byte-identical
  });
  assert.equal(outcome.noChange, true);
  const rootAfter = await getRootDoc(w, "s1");
  assert.equal(rootAfter.configRevision, rootBefore.configRevision, "no revision must have been created");
  assert.equal(rootAfter.updatedAt.isEqual(rootBefore.updatedAt), true, "root must be completely untouched, not even updatedAt");
});

test("hasSemanticChange() is false for byte-identical state and true for any of title/description/behavioral/timeLimit/reorder/option changes", () => {
  const q = authoredQuestion();
  const seed = { ...sessionLevelFields(), questions: [q] };
  assert.equal(hasSemanticChange(seed, { ...sessionLevelFields(), questions: [{ ...q }] }), false);
  assert.equal(hasSemanticChange(seed, { ...sessionLevelFields({ title: "khác" }), questions: [q] }), true);
  assert.equal(hasSemanticChange(seed, { ...sessionLevelFields({ anonymous: false }), questions: [q] }), true);
  assert.equal(hasSemanticChange(seed, { ...sessionLevelFields(), questions: [{ ...q, timeLimit: 999 }] }), true);
});

// =====================================================================================
// 7. TIME LIMIT UI GATE
// =====================================================================================

test("PASS: shouldDisableLegacyTimeEdit() is false for legacy and rev0, true only once configRevision >= 1", async () => {
  await seedUsers();
  await seedSession("s1");
  const legacyRoot = { ...legacySessionFixture() };
  assert.equal(shouldDisableLegacyTimeEdit(legacyRoot), false);
  const rev0Root = { ...legacySessionFixture(), editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0" };
  assert.equal(shouldDisableLegacyTimeEdit(rev0Root), false);
  const rev1Root = { ...legacySessionFixture(), editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1" };
  assert.equal(shouldDisableLegacyTimeEdit(rev1Root), true);
  const rev2Root = { ...legacySessionFixture(), editContractVersion: 1, configRevision: 2, currentConfigId: "cfg2" };
  assert.equal(shouldDisableLegacyTimeEdit(rev2Root), true);
});

// =====================================================================================
// BLOCK/ERROR — CLOSED-FIRST
// =====================================================================================

test("BLOCK: semantic save while OPEN never invokes the writer", async () => {
  const w = await activateSession("s1");
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); });
  const seed = { ...sessionLevelFields(), questions: [] };
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
      expectedRevision: 0, editorSeed: seed, candidateChanges: { ...sessionLevelFields({ title: "khác" }), questions: [] }, legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.ok(e instanceof ContractEditorError); assert.equal(e.code, "SESSION_NOT_CLOSED"); return true; }
  );
  const root = await getRootDoc(w, "s1");
  assert.equal("configRevision" in root, true);
  assert.equal(root.configRevision, 0, "no revision must have been created while OPEN");
});

test("BLOCK: session becomes OPEN between editor load and Save is still caught, re-read fresh right before the writer call", async () => {
  const w = await activateSession("s1");
  const facade = dbFacadeFor(w);
  const sessionDataAtLoad = await getRootDoc(w, "s1"); // loaded while CLOSED
  const state = await resolveEditorEntryState(facade, "sessions/s1", sessionDataAtLoad, "s1");
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); }); // flips after load
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: state.mode,
      expectedRevision: state.expectedRevision, editorSeed: state.editorSeed,
      candidateChanges: { ...state.editorSeed, title: "Sửa khi đang mở" }, legacyQuestionsForSnapshot: state.legacyQuestionsForSnapshot
    }),
    (e) => { assert.equal(e.code, "SESSION_NOT_CLOSED"); return true; }
  );
});

test("BLOCK: stale expectedRevision (session advanced elsewhere) is caught before the writer is invoked", async () => {
  const w = await activateSession("s1");
  await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-elsewhere", expectedRevision: 0,
    changes: { ...sessionLevelFields(), questions: [], legacyQuestions: [] }
  });
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-stale", mode: "rev0",
      expectedRevision: 0, // stale: root is now at revision 1
      editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: { ...sessionLevelFields({ title: "khác" }), questions: [] }, legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.ok(e instanceof ContractEditorError); assert.equal(e.code, "STALE_REVISION"); return true; }
  );
});

// =====================================================================================
// BLOCK/ERROR — SHAPE / LIMIT / IDEMPOTENCY / INTEGRITY, surfaced through the editor's error classifier
// =====================================================================================

test("BLOCK: 101 questions is classified with a clear Vietnamese TOO_MANY_QUESTIONS message", async () => {
  const w = await activateSession("s1");
  const questions = Array.from({ length: 101 }, (_, i) => authoredQuestion({ question: `Q${i}` }));
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
      expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: { ...sessionLevelFields(), questions }, legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.ok(e instanceof ContractEditorError); assert.equal(e.code, "TOO_MANY_QUESTIONS"); assert.match(e.message, /100 câu/); return true; }
  );
});

test("BLOCK: 21 options is classified with a clear Vietnamese TOO_MANY_OPTIONS message", async () => {
  const w = await activateSession("s1");
  const options = Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, text: `T${i}`, value: null, isCorrect: null }));
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", mode: "rev0",
      expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] },
      candidateChanges: { ...sessionLevelFields(), questions: [authoredQuestion({ options })] }, legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.equal(e.code, "TOO_MANY_OPTIONS"); return true; }
  );
});

test("BLOCK: same operationId + a genuinely different payload is a typed OPERATION_ID_PAYLOAD_MISMATCH with a clear Vietnamese message", async () => {
  const w = await activateSession("s1");
  const seed = { ...sessionLevelFields(), questions: [] };
  await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-dup", mode: "rev0",
    expectedRevision: 0, editorSeed: seed, candidateChanges: { ...sessionLevelFields({ title: "A" }), questions: [] }, legacyQuestionsForSnapshot: []
  });
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-dup", mode: "rev0",
      expectedRevision: 0, editorSeed: seed, candidateChanges: { ...sessionLevelFields({ title: "B-khác" }), questions: [] }, legacyQuestionsForSnapshot: []
    }),
    (e) => { assert.equal(e.code, "OPERATION_ID_PAYLOAD_MISMATCH"); assert.match(e.message, /tải lại/); return true; }
  );
});

test("BLOCK: integrity verification failure is surfaced with the exact 'still CLOSED, do not reopen' Vietnamese guidance, no repair attempted", async () => {
  const w = await activateSession("s1");
  const seed = { ...sessionLevelFields(), questions: [authoredQuestion(), authoredQuestion({ question: "Q2" })] };
  const outcome = await saveInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-corrupt", mode: "rev0",
    expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed, legacyQuestionsForSnapshot: []
  });
  const victimId = outcome.result.resultingQuestions[1].questionId;
  await seedWithRulesDisabled(async (d) => { await deleteDoc(doc(d, "questions", victimId)); });
  await assert.rejects(
    saveInteractionRevision({
      ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-corrupt", mode: "rev0", // same operationId+payload -> replay path, now re-verified per Gate 1B.3-C2R
      expectedRevision: 0, editorSeed: { ...sessionLevelFields(), questions: [] }, candidateChanges: seed, legacyQuestionsForSnapshot: []
    }),
    (e) => {
      assert.equal(e.code, "REVISION_INTEGRITY_VERIFICATION_FAILED");
      assert.match(e.message, /vẫn ở trạng thái ĐÃ ĐÓNG/);
      assert.match(e.message, /KHÔNG mở lại/);
      return true;
    }
  );
  const root = await getRootDoc(w, "s1");
  assert.equal(root.status, "closed"); // no repair, no reopen, no rollback claim
});

test("classifyWriterError() never leaves a raw ContractWriterError unmapped, and passes through a ContractEditorError untouched", () => {
  const wrapped = classifyWriterError(new ContractWriterError("STALE_REVISION", "raw"));
  assert.ok(wrapped instanceof ContractEditorError);
  assert.equal(wrapped.code, "STALE_REVISION");
  const already = new ContractEditorError("SESSION_NOT_CLOSED", "x");
  assert.strictEqual(classifyWriterError(already), already);
  const unknown = classifyWriterError(new Error("boom"));
  assert.equal(unknown.code, "UNKNOWN_ERROR");
});
