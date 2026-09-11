// Gate 1B.3-C1 — Interaction Contract revision Rules candidate emulator tests. Real local
// Firestore emulator loaded with the CANDIDATE rules (Gate 1B.2B/1B.2C hardening + the new
// Gate 1B.3-C1 revision>=1 manifest / Contract-question / legacyTransitionSnapshot rules).
// Never `firebase deploy`. Everything here is synthetic/emulator only — no production write of
// any kind, no production activation, no production revision 1.
//
// contract-writer.mjs is NOT extended in this gate (that is Gate 1B.3-C2's job) — it has no
// function that can create a revision>=1 Interaction manifest with embedded questions. Tests
// that need "a session already sitting at revision 1" therefore seed that state directly via
// withSecurityRulesDisabled (the same established fixture-seeding pattern used by every prior
// gate's tests), then exercise the RULES under test as fresh, standalone authenticated writes —
// this is a test-fixture shortcut, not a claim that any such writer exists yet. Tests that
// specifically prove the configVersions/root/legacyTransitionSnapshot CREATE rules exercise a
// real authenticated writeBatch(), exactly mirroring what a future writer transaction would do.
//
// GATE 1B.3-C1X — RESOLVED, root cause found by bisection (not guessed): a real 3-document
// atomic batch touching the session root (configVersions create + editHistory create + root
// update) was tripping Firestore's per-request Rules expression-evaluation ceiling ("Unable to
// evaluate the expression as the maximum of 1000 expressions to evaluate has been reached").
// Systematically stripping the Rules file down to a minimal `users`+`sessions`-only file first
// disproved the "whole file size" hypothesis (the minimal file hit the exact same ceiling), then
// bisecting the apply_config branch's own additions isolated the exact cause: calling
// `request.resource.data.diff(resource.data)` a SECOND time (once for `hasOnly`, once for a
// separate `hasAll` "these fields are mandatory" check) — even when consolidated into one
// `let`-bound helper function — was what pushed this specific 3-document batch over budget.
// Removing `hasAll` (see the Rules file's own GATE 1B.3-C1X comment on the apply_config branch)
// resolved it, with the underlying security invariant preserved: the scalar value checks
// (activeQuestionId == null, etc.) are evaluated against request.resource.data — the FINAL
// MERGED document for this write, not just the fields this specific update() call touched — so
// a client that tries to omit one of these fields from its payload still has its final value
// checked, and a write that would leave a stale value is still denied (verified directly in the
// bisection diagnostic, not assumed).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy, writeBatch, serverTimestamp, deleteDoc } from "firebase/firestore";
import * as firestoreFns from "firebase/firestore";
import { activateContract } from "../../contract-writer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B3C1_EMULATOR_PORT || 8181);
const PROJECT_ID = "demo-hcma2-gate1b3c1";
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
  questionCount: 1, responseCount: 0, activeQuestionId: null, activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1, ...overrides
});
async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "sessions", id), legacySessionFixture(overrides)); });
}
async function seedLegacyQuestion(sessionId, questionId, overrides) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", questionId), {
      sessionId, ownerId: "teacher-a", order: 0, type: "single", question: "Câu hỏi cũ?",
      description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
      scaleMin: null, scaleMax: null, createdAt: new Date(), updatedAt: new Date(), ...overrides
    });
  });
}

function writerFor(ctx) { return { db: db(ctx), firestore: firestoreFns }; }

// A well-formed manifest question entry, and the matching operational question document —
// kept in lockstep so "valid" tests pass and single-field mutations can prove each check fires.
function manifestEntry({ configId, order = 0, overrides = {} }) {
  return {
    questionId: `${configId}_q${order}`, roundId: configId, order, type: "single",
    question: "Câu hỏi v1?", description: "Mô tả", required: true, chartType: "bar",
    timeLimit: 30, allowChangeAnswer: false, scaleMin: null, scaleMax: null,
    options: [
      { id: "o0", label: "A", text: "Đáp án A", order: 0, value: null, isCorrect: null },
      { id: "o1", label: "B", text: "Đáp án B", order: 1, value: null, isCorrect: null }
    ],
    ...overrides
  };
}
function operationalDocFromEntry({ sessionId, ownerId, configId, revision, entry, overrides = {} }) {
  return {
    sessionId, ownerId, configId, revision, order: entry.order, type: entry.type,
    question: entry.question, description: entry.description, required: entry.required,
    chartType: entry.chartType, timeLimit: entry.timeLimit, allowChangeAnswer: entry.allowChangeAnswer,
    scaleMin: entry.scaleMin, scaleMax: entry.scaleMax, options: entry.options,
    createdAt: serverTimestamp(), createdBy: ownerId, ...overrides
  };
}

// Seeds a session already sitting at a real revision-1 config (session root + configVersions +
// editHistory + one operational question doc), all consistent, via rules-disabled fixture setup
// — for tests that need "already at revision 1" as their STARTING state (immutability, options
// subdocument denial, snapshot second-create denial), not for testing the create rules
// themselves (those are tested via live authenticated writes elsewhere in this file).
async function seedRevision1Session(sessionId, { configId = "cfgRev1", parentConfigId = "cfgRev0", entries = [manifestEntry({ configId })] } = {}) {
  await seedSession(sessionId, {
    status: "closed", editContractVersion: 1, configRevision: 1, currentConfigId: configId,
    lastOperationId: "op-rev1", contractActivatedAt: new Date()
  });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", sessionId, "configVersions", parentConfigId), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a",
      title: "Cũ", description: "Mô tả cũ"
    });
    await setDoc(doc(d, "sessions", sessionId, "configVersions", configId), {
      revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config",
      createdAt: new Date(), createdBy: "teacher-a", active: true,
      title: "Tiêu đề v1", description: "Mô tả v1", allowMultipleResponses: false,
      anonymous: true, showResponderCount: true, questions: entries
    });
    await setDoc(doc(d, "sessions", sessionId, "editHistory", "op-rev1"), {
      operationId: "op-rev1", actorUid: "teacher-a", operationType: "apply_config",
      baseRevision: 0, resultingRevision: 1, previousConfigId: parentConfigId, resultingConfigId: configId,
      changedFields: ["questions"], createdAt: new Date(), lifecycleBefore: "closed", lifecycleAfter: "closed"
    });
    for (const entry of entries) {
      await setDoc(doc(d, "questions", entry.questionId), operationalDocFromEntry({ sessionId, ownerId: "teacher-a", configId, revision: 1, entry }));
    }
  });
  return { configId, parentConfigId, entries };
}

// =====================================================================================
// 1. PRESERVE LEGACY BEHAVIOR
// =====================================================================================

test("legacy question create/update path still works as before (no configId field anywhere)", async () => {
  await seedUsers(); await seedSession("s1", { status: "ready" });
  const a = db(teacherCtx("teacher-a"));
  const qRef = doc(collection(a, "questions"));
  await assertSucceeds(setDoc(qRef, {
    sessionId: "s1", ownerId: "teacher-a", order: 0, type: "single", question: "Q?",
    description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false,
    scaleMin: null, scaleMax: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(qRef, { question: "Q đã sửa?", updatedAt: serverTimestamp() }));
});

test("legacy option create/update/delete still works as before", async () => {
  await seedUsers(); await seedSession("s1"); await seedLegacyQuestion("s1", "q1");
  const a = db(teacherCtx("teacher-a"));
  const optRef = doc(collection(a, "questions", "q1", "options"));
  await assertSucceeds(setDoc(optRef, { label: "A", text: "Đáp án A", order: 0, value: null, isCorrect: null, createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(optRef, { text: "Đáp án A (sửa)" }));
  await assertSucceeds(deleteDoc(optRef));
});

test("legacy question is NOT subject to Contract immutable-question rules merely because C1 exists", async () => {
  await seedUsers(); await seedSession("s1"); await seedLegacyQuestion("s1", "q1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "questions", "q1"), { timeLimit: 60, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(a, "questions", "q1")));
});

// =====================================================================================
// 2/3. CONTRACT CONFIGVERSION REVISION >=1 CREATE + APPLY_CONFIG ROOT BRANCH
// =====================================================================================

test("valid activation baseline (revision 0) remains compatible, unaffected by the new fields", async () => {
  await seedUsers(); await seedSession("s1");
  const w = writerFor(teacherCtx("teacher-a"));
  const result = await activateContract({ ...w, family: "sessions", sessionId: "s1", actorUid: "teacher-a", operationId: "op-1" });
  assert.equal(result.resultingRevision, 0);
  const cfg = (await getDoc(doc(w.db, "sessions", "s1", "configVersions", result.resultingConfigId))).data();
  assert.equal(cfg.kind, "activation_baseline");
  assert.equal("questions" in cfg, false);
});

test("valid revision-1 config create + root apply, batched together as a real writer transaction would do it", async () => {
  await seedUsers();
  const parentConfigId = "cfgRev0";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 0, currentConfigId: parentConfigId, lastOperationId: "op-0", contractActivatedAt: new Date() });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", parentConfigId), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a", title: "Cũ", description: "Mô tả cũ"
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const entry = manifestEntry({ configId });
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), {
    revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true,
    title: "Tiêu đề v1", description: "Mô tả v1", allowMultipleResponses: true, anonymous: false,
    showResponderCount: true, questions: [entry]
  });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-1"), {
    operationId: "op-1", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0,
    resultingRevision: 1, previousConfigId: parentConfigId, resultingConfigId: configId,
    changedFields: ["questions"], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed"
  });
  batch.update(doc(a, "sessions", "s1"), {
    configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp(),
    questionCount: 1, activeQuestionId: null, activeQuestionStartedAt: null, responseCount: 0, liveAggregate: null
  });
  await assertSucceeds(batch.commit());
  const root = (await getDoc(doc(a, "sessions", "s1"))).data();
  assert.equal(root.configRevision, 1);
  assert.equal(root.activeQuestionId, null);
  assert.equal(root.responseCount, 0);
});

test("valid revision-N+1 (revision 2) config create batches successfully on top of an existing revision-1 session", async () => {
  await seedUsers();
  const { configId: cfg1 } = await seedRevision1Session("s1");
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const entry2 = manifestEntry({ configId: cfg2 });
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 2, parentConfigId: cfg1, roundId: cfg2, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true,
    title: "Tiêu đề v2", description: "Mô tả v2", allowMultipleResponses: false, anonymous: true,
    showResponderCount: true, questions: [entry2]
  });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-2"), {
    operationId: "op-2", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 1,
    resultingRevision: 2, previousConfigId: cfg1, resultingConfigId: cfg2, changedFields: ["questions"],
    createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed"
  });
  batch.update(doc(a, "sessions", "s1"), {
    configRevision: 2, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp(),
    questionCount: 1, activeQuestionId: null, activeQuestionStartedAt: null, responseCount: 0, liveAggregate: null
  });
  await assertSucceeds(batch.commit());
});

test("DENY: apply while open (closed-first)", async () => {
  await seedUsers();
  const { configId: cfg1 } = await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "sessions", "s1"), { status: "open" }); });
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 2, parentConfigId: cfg1, roundId: cfg2, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
  });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 2, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: stale revision (configRevision does not increment by exactly 1)", async () => {
  await seedUsers();
  const { configId: cfg1 } = await seedRevision1Session("s1");
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 3, parentConfigId: cfg1, roundId: cfg2, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
  });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 3, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: wrong parentConfigId on the new config", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 2, parentConfigId: "not-the-real-parent", roundId: cfg2, kind: "interaction",
    source: "apply_config", createdAt: serverTimestamp(), createdBy: "teacher-a", active: true,
    title: "x", description: "", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
  });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 2, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: revision jump (skips a number)", async () => {
  await seedUsers();
  const { configId: cfg1 } = await seedRevision1Session("s1");
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 5, parentConfigId: cfg1, roundId: cfg2, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
  });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 5, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: semantic root mirror attempt (trying to also write title onto the session root during apply)", async () => {
  await seedUsers();
  const { configId: cfg1 } = await seedRevision1Session("s1");
  const a = db(teacherCtx("teacher-a"));
  const cfg2 = "cfgRev2";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", cfg2), {
    revision: 2, parentConfigId: cfg1, roundId: cfg2, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "MỚI", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: []
  });
  batch.update(doc(a, "sessions", "s1"), {
    configRevision: 2, currentConfigId: cfg2, lastOperationId: "op-2", updatedAt: serverTimestamp(),
    title: "MỚI" // attempted semantic root mirror — must be denied
  });
  await assertFails(batch.commit());
});

test("DENY: manifest questions array exceeds max 100", async () => {
  await seedUsers();
  const parentConfigId = "cfgRev0";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 0, currentConfigId: parentConfigId, lastOperationId: "op-0", contractActivatedAt: new Date() });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", parentConfigId), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a", title: "Cũ", description: ""
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const tooMany = Array.from({ length: 101 }, (_, i) => manifestEntry({ configId, order: i }));
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), {
    revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: tooMany
  });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

// =====================================================================================
// 4. CONTRACT QUESTION CREATE RULE
// =====================================================================================

test("valid Contract question exactly matching its manifest entry succeeds", async () => {
  await seedUsers();
  const configId = "cfgRev1";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", contractActivatedAt: new Date() });
  const entry = manifestEntry({ configId });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", configId), {
      revision: 1, parentConfigId: null, roundId: configId, kind: "interaction", source: "apply_config",
      createdAt: new Date(), createdBy: "teacher-a", active: true, title: "x", description: "",
      allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [entry]
    });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(setDoc(doc(a, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry })));
});

async function setupSingleQuestionFixture() {
  await seedUsers();
  const configId = "cfgRev1";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", contractActivatedAt: new Date() });
  const entry = manifestEntry({ configId });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", configId), {
      revision: 1, parentConfigId: null, roundId: configId, kind: "interaction", source: "apply_config",
      createdAt: new Date(), createdBy: "teacher-a", active: true, title: "x", description: "",
      allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [entry]
    });
  });
  return { configId, entry };
}

test("DENY: Contract question with wrong configId", async () => {
  const { entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId: "some-other-config", revision: 1, entry })));
});

test("DENY: Contract question with wrong revision", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 99, entry })));
});

test("DENY: wrong deterministic question ID (does not match configId_q{order})", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "questions", "wrong-id-shape"), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry })));
});

test("DENY: negative order", async () => {
  await seedUsers();
  const configId = "cfgRev1";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", contractActivatedAt: new Date() });
  const entry = manifestEntry({ configId, order: 0 });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", configId), {
      revision: 1, parentConfigId: null, roundId: configId, kind: "interaction", source: "apply_config",
      createdAt: new Date(), createdBy: "teacher-a", active: true, title: "x", description: "",
      allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [entry]
    });
  });
  const a = db(teacherCtx("teacher-a"));
  const badEntry = { ...entry, order: -1 };
  await assertFails(setDoc(doc(a, "questions", `${configId}_q-1`), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry: badEntry })));
});

test("DENY: out-of-range order (order >= manifest.questions.length) — proves the bounds check runs before indexing", async () => {
  const { configId, entry } = await setupSingleQuestionFixture(); // manifest has exactly 1 entry, index 0
  const a = db(teacherCtx("teacher-a"));
  const outOfRangeEntry = { ...entry, order: 5, questionId: `${configId}_q5` };
  await assertFails(setDoc(doc(a, "questions", `${configId}_q5`), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry: outOfRangeEntry })));
});

test("DENY: question not declared at that manifest position (rogue extra question, Gate 1B.3-B3 §F attack)", async () => {
  const { configId } = await setupSingleQuestionFixture(); // manifest declares only order 0
  const a = db(teacherCtx("teacher-a"));
  // Attacker crafts a second, undeclared question claiming order 1 with a valid-looking
  // configId/revision but no matching manifest entry at that position.
  const rogueEntry = manifestEntry({ configId, order: 1 });
  await assertFails(setDoc(doc(a, "questions", `${configId}_q1`), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry: rogueEntry })));
});

test("DENY: question text differs from manifest", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  const tampered = operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry, overrides: { question: "Câu hỏi BỊ ĐỔI?" } });
  await assertFails(setDoc(doc(a, "questions", entry.questionId), tampered));
});

test("DENY: type differs from manifest", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  const tampered = operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry, overrides: { type: "multiple" } });
  await assertFails(setDoc(doc(a, "questions", entry.questionId), tampered));
});

test("DENY: timeLimit differs from manifest", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  const tampered = operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry, overrides: { timeLimit: 999 } });
  await assertFails(setDoc(doc(a, "questions", entry.questionId), tampered));
});

test("DENY: options array differs from manifest (extra option not declared)", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  const tamperedOptions = [...entry.options, { id: "o2", label: "C", text: "Đáp án C (lén thêm)", order: 2, value: null, isCorrect: null }];
  const tampered = operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry, overrides: { options: tamperedOptions } });
  await assertFails(setDoc(doc(a, "questions", entry.questionId), tampered));
});

test("DENY: extra semantic field not in the allowed key set", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const a = db(teacherCtx("teacher-a"));
  const tampered = { ...operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry }), sneaky: "leo quyền" };
  await assertFails(setDoc(doc(a, "questions", entry.questionId), tampered));
});

test("DENY: foreign teacher cannot create a Contract question for someone else's session", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const b = db(teacherCtx("teacher-b"));
  await assertFails(setDoc(doc(b, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry })));
});

test("DENY: anonymous participant cannot create a Contract question at all", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const anon = db(anonCtx("student-1"));
  await assertFails(setDoc(doc(anon, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry })));
});

test("DENY: suspended teacher cannot create a Contract question for their own (formerly owned) session", async () => {
  await seedUsers();
  const configId = "cfgRev1";
  await seedSession("s1", { ownerId: "teacher-suspended", status: "closed", editContractVersion: 1, configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", contractActivatedAt: new Date() });
  const entry = manifestEntry({ configId });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", configId), {
      revision: 1, parentConfigId: null, roundId: configId, kind: "interaction", source: "apply_config",
      createdAt: new Date(), createdBy: "teacher-suspended", active: true, title: "x", description: "",
      allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [entry]
    });
  });
  const susp = db(teacherCtx("teacher-suspended"));
  await assertFails(setDoc(doc(susp, "questions", entry.questionId), operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-suspended", configId, revision: 1, entry })));
});

test("Admin cannot structurally bypass the manifest-match proof either (admin is not exempt from the integrity check)", async () => {
  const { configId, entry } = await setupSingleQuestionFixture();
  const admin = db(teacherCtx("admin-1"));
  const tampered = operationalDocFromEntry({ sessionId: "s1", ownerId: "teacher-a", configId, revision: 1, entry, overrides: { question: "Admin cố sửa nội dung?" } });
  await assertFails(setDoc(doc(admin, "questions", entry.questionId), tampered));
});

// =====================================================================================
// 5. CONTRACT QUESTION UPDATE / DELETE — immutable forever, including the current revision
// =====================================================================================

test("DENY: Contract question update, including the current (not-yet-retired) revision, including timeLimit", async () => {
  await seedUsers();
  const { entries } = await seedRevision1Session("s1"); const entry = entries[0];
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "questions", entry.questionId), { timeLimit: 999, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "questions", entry.questionId), { question: "Sửa lén?" }));
});

test("DENY: Contract question delete", async () => {
  await seedUsers();
  const { entries } = await seedRevision1Session("s1"); const entry = entries[0];
  const a = db(teacherCtx("teacher-a"));
  await assertFails(deleteDoc(doc(a, "questions", entry.questionId)));
});

// =====================================================================================
// 6. OPTIONS SUBCOLLECTION — denied entirely for Contract-versioned questions
// =====================================================================================

test("DENY: Contract option subdocument create", async () => {
  await seedUsers();
  const { entries } = await seedRevision1Session("s1"); const entry = entries[0];
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(collection(a, "questions", entry.questionId, "options")), { label: "C", text: "Lén thêm", order: 2, value: null, isCorrect: null, createdAt: serverTimestamp() }));
});

test("DENY: Contract option subdocument update/delete (subdocument doesn't legitimately exist, but Rules must still deny both operations, not merely 'not found')", async () => {
  await seedUsers();
  const { entries } = await seedRevision1Session("s1"); const entry = entries[0];
  // Seed a stray option subdoc with rules disabled purely to prove update/delete are denied by
  // Rules themselves, not just absent by convention.
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "questions", entry.questionId, "options", "stray"), { label: "Z", text: "stray", order: 9, value: null, isCorrect: null, createdAt: new Date() });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "questions", entry.questionId, "options", "stray"), { text: "sửa" }));
  await assertFails(deleteDoc(doc(a, "questions", entry.questionId, "options", "stray")));
});

// =====================================================================================
// 7. LEGACY TRANSITION SNAPSHOT
// =====================================================================================

async function setupFirstTransitionFixture() {
  await seedUsers();
  const parentConfigId = "cfgRev0";
  await seedSession("s1", { status: "closed", editContractVersion: 1, configRevision: 0, currentConfigId: parentConfigId, lastOperationId: "op-0", contractActivatedAt: new Date() });
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "configVersions", parentConfigId), {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, createdAt: new Date(), createdBy: "teacher-a", title: "Cũ", description: ""
    });
  });
  return { parentConfigId };
}

test("valid snapshot created on the first transition, batched with the revision-1 apply", async () => {
  const { parentConfigId } = await setupFirstTransitionFixture();
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const entry = manifestEntry({ configId });
  const legacyQ = { questionId: "legacyQ1", roundId: parentConfigId, order: 0, type: "single", question: "Câu cũ?", description: "", required: true, chartType: "bar", timeLimit: 0, allowChangeAnswer: false, scaleMin: null, scaleMax: null, options: [] };
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), {
    revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config",
    createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "",
    allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [entry]
  });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-1"), {
    operationId: "op-1", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0,
    resultingRevision: 1, previousConfigId: parentConfigId, resultingConfigId: configId,
    changedFields: ["questions"], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed"
  });
  batch.set(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), {
    kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: serverTimestamp(),
    capturedDuringOperationId: "op-1", parentConfigId, legacyQuestions: [legacyQ]
  });
  batch.update(doc(a, "sessions", "s1"), {
    configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp(),
    questionCount: 1, activeQuestionId: null, activeQuestionStartedAt: null, responseCount: 0, liveAggregate: null
  });
  await assertSucceeds(batch.commit());
});

test("DENY: second snapshot create attempt on a session already past its first transition", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), {
      kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: new Date(),
      capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: []
    });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), {
    kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: serverTimestamp(),
    capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: []
  }));
});

test("DENY: wrong snapshot document ID (not the literal 'snapshot')", async () => {
  const { parentConfigId } = await setupFirstTransitionFixture();
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "not-the-fixed-id"), {
    kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: serverTimestamp(),
    capturedDuringOperationId: "op-1", parentConfigId, legacyQuestions: []
  }));
});

test("DENY: wrong basis value", async () => {
  const { parentConfigId } = await setupFirstTransitionFixture();
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), { revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config", createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-1"), { operationId: "op-1", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 1, previousConfigId: parentConfigId, resultingConfigId: configId, changedFields: [], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  batch.set(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "commit_time_verified", appliedAt: serverTimestamp(), capturedDuringOperationId: "op-1", parentConfigId, legacyQuestions: [] });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: wrong kind value", async () => {
  const { parentConfigId } = await setupFirstTransitionFixture();
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), { revision: 1, parentConfigId, roundId: configId, kind: "interaction", source: "apply_config", createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-1"), { operationId: "op-1", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 1, previousConfigId: parentConfigId, resultingConfigId: configId, changedFields: [], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  batch.set(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "activation_baseline", basis: "editor_confirmed", appliedAt: serverTimestamp(), capturedDuringOperationId: "op-1", parentConfigId, legacyQuestions: [] });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: wrong parentConfigId on the snapshot (doesn't match the session's actual pre-transition config)", async () => {
  const { } = await setupFirstTransitionFixture();
  const a = db(teacherCtx("teacher-a"));
  const configId = "cfgRev1";
  const batch = writeBatch(a);
  batch.set(doc(a, "sessions", "s1", "configVersions", configId), { revision: 1, parentConfigId: "cfgRev0", roundId: configId, kind: "interaction", source: "apply_config", createdAt: serverTimestamp(), createdBy: "teacher-a", active: true, title: "x", description: "", allowMultipleResponses: false, anonymous: true, showResponderCount: true, questions: [] });
  batch.set(doc(a, "sessions", "s1", "editHistory", "op-1"), { operationId: "op-1", actorUid: "teacher-a", operationType: "apply_config", baseRevision: 0, resultingRevision: 1, previousConfigId: "cfgRev0", resultingConfigId: configId, changedFields: [], createdAt: serverTimestamp(), lifecycleBefore: "closed", lifecycleAfter: "closed" });
  batch.set(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: serverTimestamp(), capturedDuringOperationId: "op-1", parentConfigId: "not-the-real-parent", legacyQuestions: [] });
  batch.update(doc(a, "sessions", "s1"), { configRevision: 1, currentConfigId: configId, lastOperationId: "op-1", updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("DENY: snapshot update", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: new Date(), capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: [] });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { basis: "commit_time_verified" }));
});

test("DENY: snapshot delete", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: new Date(), capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: [] });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(deleteDoc(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot")));
});

test("DENY: snapshot list", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: new Date(), capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: [] });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertFails(getDocs(collection(a, "sessions", "s1", "legacyTransitionSnapshot")));
});

test("snapshot get succeeds for owner, denied for foreign teacher and anonymous", async () => {
  await seedUsers();
  await seedRevision1Session("s1");
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", "s1", "legacyTransitionSnapshot", "snapshot"), { kind: "legacy_transition_snapshot", basis: "editor_confirmed", appliedAt: new Date(), capturedDuringOperationId: "op-rev1", parentConfigId: "cfgRev0", legacyQuestions: [] });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(getDoc(doc(a, "sessions", "s1", "legacyTransitionSnapshot", "snapshot")));
  const b = db(teacherCtx("teacher-b"));
  await assertFails(getDoc(doc(b, "sessions", "s1", "legacyTransitionSnapshot", "snapshot")));
  const anon = db(anonCtx("student-1"));
  await assertFails(getDoc(doc(anon, "sessions", "s1", "legacyTransitionSnapshot", "snapshot")));
});

test("no PII field name appears in the snapshot allowlist (structural check of the frozen schema)", () => {
  const allowedKeys = ["kind", "basis", "appliedAt", "capturedDuringOperationId", "parentConfigId", "legacyQuestions"];
  const piiLike = ["fullName", "className", "email", "phone", "participantId"];
  for (const k of piiLike) assert.equal(allowedKeys.includes(k), false, `${k} must never be part of the snapshot schema`);
});

// =====================================================================================
// 9. ACCEPTED RESIDUAL-RISK CONTRACT — documented, not a test failure
// =====================================================================================

test("ACCEPTED APPLICATION-INTEGRITY RESIDUAL — NOT A PARTICIPANT AUTHORIZATION BYPASS: a manifest may theoretically declare an entry whose operational document is absent, and Rules cannot prove reverse completeness at this scale — but a participant can never submit against that missing question", async () => {
  const { configId } = await setupSingleQuestionFixture();
  // The manifest at "s1" declares exactly one question (order 0), which WAS created. This test
  // documents, rather than exploits, the accepted gap: even if a teacher's manifest declared a
  // SECOND entry (order 1) whose backing document was never created (Rules cannot detect this
  // at configVersions-create time — see the create-rule comment and Gate 1B.3-B3.1 §G/H), a
  // student could still never submit against it, because response creation independently
  // requires questionData(questionId) to resolve via get() — a nonexistent question can never
  // become activeQuestionId-reachable or answerable. This is proven here by attempting a
  // response submission against a questionId that was declared in spirit (same ID shape) but
  // was never actually created as a document, and confirming it fails — not because of the
  // reverse-completeness gap being "caught", but because response creation has its own,
  // independent, always-enforced requirement that the question document exist.
  const neverCreatedQuestionId = `${configId}_q1`; // order 1 — never materialized, unlike order 0
  await seedWithRulesDisabled(async (d) => {
    await updateDoc(doc(d, "sessions", "s1"), { status: "open", activeQuestionId: neverCreatedQuestionId, activeQuestionStartedAt: new Date() });
  });
  const anon = db(anonCtx("student-1"));
  await assertFails(setDoc(doc(anon, "sessions", "s1", "responses", `${neverCreatedQuestionId}_student-1`), {
    sessionId: "s1", questionId: neverCreatedQuestionId, participantId: "student-1", answer: null,
    selectedOptions: ["o0"], submittedAt: serverTimestamp()
  }));
});
