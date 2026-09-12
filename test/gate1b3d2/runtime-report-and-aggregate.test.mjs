// Gate 1B.3-D2R — executable proof (not merely helper-level reasoning) for two narrow gaps
// ChatGPT's review flagged: (A) the REAL teacher report/export path across a rev1->rev2
// transition, and (B) showResponderCount's runtime propagation through the REAL live-aggregate
// write path. Real local Firestore emulator loaded with the frozen, UNCHANGED Gate 1B.3-C1X
// Rules candidate (sha256 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) —
// this gate never modifies Rules. No `firebase deploy`. No production write of any kind.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract, applyInteractionRevision } from "../../contract-writer.mjs";
import { makeFirestoreDbFacade } from "../../session-reader.mjs";
import { buildInteractionJsonExport, buildInteractionCsvRows, resolveShowResponderCount } from "../../session-view.mjs";
import { resolveReportQuestionBlocks, resolveRuntimeSettings, writeLiveAggregate } from "../../contract-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B3D2_EMULATOR_PORT || 8184);
// A distinct project id from contract-runtime.test.mjs's, even though both share the same
// emulator port/process — node's test runner may run these two files concurrently, and two
// suites clearFirestore()-ing the SAME project between each other's tests causes exactly the
// cross-contamination this separation avoids (confirmed empirically: sharing one project id
// here produced spurious "maximum of 1000 expressions" / permission-denied errors that were
// really the other file's beforeEach wiping data mid-test, not a real Rules regression).
const PROJECT_ID = "demo-hcma2-gate1b3d2b";
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
async function activateSession(sessionId = "s1", overrides = {}) {
  await seedUsers();
  await seedSession(sessionId, overrides);
  const w = writerFor(teacherCtx("teacher-a"));
  await activateContract({ ...w, family: "sessions", sessionId, actorUid: "teacher-a", operationId: "op-activate" });
  return w;
}
function sessionLevelFields(overrides = {}) {
  return { title: "T", description: "D", allowMultipleResponses: false, anonymous: true, showResponderCount: true, ...overrides };
}
async function seedResponse(sessionId, questionId, participantId, extra) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", sessionId, "responses", `${questionId}_${participantId}`), {
      sessionId, questionId, participantId, answer: null, selectedOptions: [], submittedAt: new Date(), ...extra
    });
  });
}
async function getRootDoc(w, sessionId) { return (await getDoc(doc(w.db, "sessions", sessionId))).data(); }
function dbFacadeFor(w) { return makeFirestoreDbFacade(w.db, firestoreFns); }

// =====================================================================================
// A. HISTORICAL REPORT / EXPORT — executable proof against the real rev1 -> rev2 path
// =====================================================================================

test("EXECUTABLE PROOF (item A): rev1 response stays labeled with rev1 semantics after rev2 exists; rev2 response resolves rev2 semantics; both blocks coexist", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: {
      ...sessionLevelFields(),
      questions: [{
        type: "single", question: "Rev1 Question Text", description: "D1", required: true, chartType: "bar",
        timeLimit: 30, allowChangeAnswer: false,
        options: [{ label: "A", text: "Rev1 Option A", value: null, isCorrect: null }, { label: "B", text: "Rev1 Option B", value: null, isCorrect: null }]
      }],
      legacyQuestions: []
    }
  });
  const rev1QuestionId = r1.resultingQuestions[0].questionId;
  await seedResponse("s1", rev1QuestionId, "student-rev1", { selectedOptions: ["o0"] });

  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: {
      ...sessionLevelFields({ title: "T2" }),
      questions: [{
        type: "single", question: "Rev2 DIFFERENT Question Text", description: "D2", required: true, chartType: "bar",
        timeLimit: 45, allowChangeAnswer: false,
        options: [{ label: "A", text: "Rev2 DIFFERENT Option A", value: null, isCorrect: null }, { label: "B", text: "Rev2 DIFFERENT Option B", value: null, isCorrect: null }]
      }]
    }
  });
  const rev2QuestionId = r2.resultingQuestions[0].questionId;
  assert.notEqual(rev2QuestionId, rev1QuestionId);
  await seedResponse("s1", rev2QuestionId, "student-rev2", { selectedOptions: ["o1"] });

  // Real report path: resolveReportQuestionBlocks() is the exact function teacherReportView calls.
  const facade = dbFacadeFor(w);
  let allResponses = [];
  await seedWithRulesDisabled(async (d) => {
    const { getDocs, collection } = firestoreFns;
    const snap = await getDocs(collection(d, "sessions", "s1", "responses"));
    allResponses = snap.docs.map((x) => x.data());
  });
  assert.equal(allResponses.length, 2);

  const blocks = await resolveReportQuestionBlocks(facade, "s1", "teacher-a", allResponses);
  assert.equal(blocks.length, 2, "both rev1's and rev2's question documents must appear as separate blocks");

  const rev1Block = blocks.find((b) => b.q.id === rev1QuestionId);
  const rev2Block = blocks.find((b) => b.q.id === rev2QuestionId);
  assert.ok(rev1Block); assert.ok(rev2Block);

  // rev1 response still labeled with rev1 semantics, NEVER relabeled under rev2's.
  assert.equal(rev1Block.q.question, "Rev1 Question Text");
  assert.equal(rev1Block.options[0].text, "Rev1 Option A");
  assert.equal(rev1Block.docs.length, 1);
  assert.equal(rev1Block.docs[0].participantId, "student-rev1");

  // rev2 response resolves rev2 semantics, distinctly.
  assert.equal(rev2Block.q.question, "Rev2 DIFFERENT Question Text");
  assert.equal(rev2Block.options[0].text, "Rev2 DIFFERENT Option A");
  assert.equal(rev2Block.docs.length, 1);
  assert.equal(rev2Block.docs[0].participantId, "student-rev2");

  // Cross-contamination check: neither block's response list contains the other's participant.
  assert.ok(!rev1Block.docs.some((d) => d.participantId === "student-rev2"));
  assert.ok(!rev2Block.docs.some((d) => d.participantId === "student-rev1"));

  // ---- Real JSON export path ----
  const jsonOut = buildInteractionJsonExport({ createdAt: null }, "K77.A01", blocks, "T2");
  const jsonRev1 = jsonOut.cauHoi.find((q) => q.cauHoi === "Rev1 Question Text");
  const jsonRev2 = jsonOut.cauHoi.find((q) => q.cauHoi === "Rev2 DIFFERENT Question Text");
  assert.ok(jsonRev1); assert.ok(jsonRev2);
  assert.equal(jsonRev1.cauTraLoi.length, 1);
  assert.equal(jsonRev1.cauTraLoi[0].participantId, "student-rev1");
  assert.equal(jsonRev2.cauTraLoi.length, 1);
  assert.equal(jsonRev2.cauTraLoi[0].participantId, "student-rev2");
  assert.deepEqual(jsonRev1.phuongAn, ["Rev1 Option A", "Rev1 Option B"]);
  assert.deepEqual(jsonRev2.phuongAn, ["Rev2 DIFFERENT Option A", "Rev2 DIFFERENT Option B"]);

  // ---- Real CSV export path ----
  const csvRows = buildInteractionCsvRows(blocks);
  assert.equal(csvRows[0][0], "Cau hoi"); // header preserved
  const dataRows = csvRows.slice(1);
  assert.equal(dataRows.length, 2);
  const csvRev2Row = dataRows.find((r) => r[0] === "Rev2 DIFFERENT Question Text");
  const csvRev1Row = dataRows.find((r) => r[0] === "Rev1 Question Text");
  assert.ok(csvRev1Row); assert.ok(csvRev2Row);
  assert.equal(csvRev1Row[3], "Rev1 Option A"); // selectedOptions:["o0"] -> option 0's text
  assert.equal(csvRev2Row[3], "Rev2 DIFFERENT Option B"); // selectedOptions:["o1"] -> option 1's text
});

// =====================================================================================
// B. showResponderCount RUNTIME PROPAGATION — real write path
// =====================================================================================

test("EXECUTABLE PROOF (item B): rev1 showResponderCount=false propagates through the real aggregate write, student resolution sees false, root never overrides it", async () => {
  const w = await activateSession("s1");
  const r1 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-1", expectedRevision: 0,
    changes: { ...sessionLevelFields({ showResponderCount: false }), questions: [{ type: "open", question: "Q1", description: "", required: true, chartType: "list", timeLimit: 0, allowChangeAnswer: false, options: [] }], legacyQuestions: [] }
  });
  const q1Id = r1.resultingQuestions[0].questionId;
  const facade = dbFacadeFor(w);
  const sessionAfterR1 = await getRootDoc(w, "s1");

  const settingsR1 = await resolveRuntimeSettings(facade, "sessions/s1", sessionAfterR1);
  assert.equal(settingsR1.showResponderCount, false);

  // Real write path (through real Rules), exactly what watchResponses() calls.
  await writeLiveAggregate({
    db: w.db, firestore: w.firestore, sessionId: "s1", ownerId: "teacher-a",
    question: { id: q1Id }, chartType: "list", agg: null, respondedCount: 3, openAnswers: ["x"],
    showResponderCount: settingsR1.showResponderCount, totalResponseCount: 3
  });

  const aggDocR1 = (await getDoc(doc(w.db, "sessions", "s1", "liveAggregates", q1Id))).data();
  assert.equal(aggDocR1.showResponderCount, false);
  const rootAfterWriteR1 = await getRootDoc(w, "s1");
  assert.equal(rootAfterWriteR1.liveAggregate.showResponderCount, false);
  assert.equal(rootAfterWriteR1.liveAggregate.questionId, q1Id);

  // Student resolution: root's OWN showResponderCount is stale-by-design (true, from
  // activation) — the aggregate's carried value must win, proving root never overrides it.
  assert.equal(rootAfterWriteR1.showResponderCount, true, "sanity: root really is stale here");
  assert.equal(resolveShowResponderCount(rootAfterWriteR1.liveAggregate, rootAfterWriteR1), false);

  // ---- rev2: change ONLY showResponderCount to true ----
  const r2 = await applyInteractionRevision({
    ...w, sessionId: "s1", actorUid: "teacher-a", operationId: "op-2", expectedRevision: 1,
    changes: { ...sessionLevelFields({ showResponderCount: true }), questions: [{ type: "open", question: "Q1", description: "", required: true, chartType: "list", timeLimit: 0, allowChangeAnswer: false, options: [] }] }
  });
  const q2Id = r2.resultingQuestions[0].questionId;
  assert.notEqual(q2Id, q1Id);

  // Root's liveAggregate must be reset to null by the writer's own frozen contract on every
  // apply_config — no stale rev1 aggregate value can leak through the root surface into rev2.
  const rootAfterR2 = await getRootDoc(w, "s1");
  assert.equal(rootAfterR2.liveAggregate, null, "no stale rev1 aggregate may leak on the root surface after a revision change");

  const settingsR2 = await resolveRuntimeSettings(facade, "sessions/s1", rootAfterR2);
  assert.equal(settingsR2.showResponderCount, true);

  await writeLiveAggregate({
    db: w.db, firestore: w.firestore, sessionId: "s1", ownerId: "teacher-a",
    question: { id: q2Id }, chartType: "list", agg: null, respondedCount: 1, openAnswers: ["y"],
    showResponderCount: settingsR2.showResponderCount, totalResponseCount: 1
  });
  const rootAfterWriteR2 = await getRootDoc(w, "s1");
  assert.equal(rootAfterWriteR2.liveAggregate.showResponderCount, true);
  assert.equal(rootAfterWriteR2.liveAggregate.questionId, q2Id);
  assert.equal(resolveShowResponderCount(rootAfterWriteR2.liveAggregate, rootAfterWriteR2), true);

  // The rev1 subcollection doc is a durable per-question record, NOT read by any consumer
  // (session.liveAggregate is the only surface any reader consumes) — it still physically
  // exists with the OLD false value, but that can never diverge incorrectly because nothing
  // reads it back.
  const staleSubcollectionDoc = (await getDoc(doc(w.db, "sessions", "s1", "liveAggregates", q1Id))).data();
  assert.equal(staleSubcollectionDoc.showResponderCount, false);
  assert.notEqual(rootAfterWriteR2.liveAggregate.questionId, q1Id, "the current-facing root aggregate must point at the CURRENT question, never the retired one");
});

test("REGRESSION (item B): legacy/rev0 showResponderCount resolution is unaffected by any D2R change", async () => {
  await seedUsers();
  await seedSession("s1", { showResponderCount: false });
  const w = writerFor(teacherCtx("teacher-a"));
  const session = await getRootDoc(w, "s1");
  assert.equal(resolveShowResponderCount(null, session), false);
  assert.equal(resolveShowResponderCount(undefined, session), false);

  const w2 = await activateSession("s2", { showResponderCount: true });
  const facade = dbFacadeFor(w2);
  const rev0Session = await getRootDoc(w2, "s2");
  const rev0Settings = await resolveRuntimeSettings(facade, "sessions/s2", rev0Session);
  assert.equal(rev0Settings.showResponderCount, true);
  assert.equal(resolveShowResponderCount(null, rev0Session), true);
});
