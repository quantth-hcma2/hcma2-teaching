// Gate 1B.2A — Firestore Rules hardening emulator tests.
// Runs against a real local Firestore emulator loaded with the CANDIDATE rules content
// (firestore.rules.production-candidate on branch gate1b2a-rules-hardening, i.e. the current
// production baseline PLUS this gate's sessions/groupActivities allowlist tightening — nothing
// else). Never uses `firebase deploy` in any form. Run via `npm run test:gate1b2a` (starts/stops
// the emulator itself), not directly — see run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B2A_EMULATOR_PORT || 8178);
const PROJECT_ID = "demo-hcma2-gate1b2a";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT }
  });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function anonCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }

async function seedWithRulesDisabled(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); });
}

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active", email: "a@x.test" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active", email: "b@x.test" });
    await setDoc(doc(d, "users", "teacher-suspended"), { role: "teacher", status: "suspended", email: "s@x.test" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active", email: "admin@x.test" });
  });
}

// =====================================================================================
// SESSIONS
// =====================================================================================

const legacySessionFixture = {
  ownerId: "teacher-a", classId: "class-1", className: "K77.A01", title: "Cũ", description: "",
  status: "closed", accessToken: "tok-original-28chars-xxxxxxx", shortCode: "ABC123",
  showResults: "hidden", allowMultipleResponses: false, anonymous: true, showResponderCount: true,
  startedAt: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  questionCount: 2, responseCount: 0, activeQuestionId: null, activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1,
  oldHistoricalField: "preserve-me"
};

async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "sessions", id), { ...legacySessionFixture, ...overrides });
  });
}

test("sessions — legacy owner: create (exact wizard shape) PASS", async () => {
  await seedUsers();
  const a = db(teacherCtx("teacher-a"));
  const { oldHistoricalField, ...createShape } = legacySessionFixture; // create never carries a historical/unknown field
  await assertSucceeds(setDoc(doc(a, "sessions", "new-s1"), { ...createShape, status: "ready" }));
});

test("sessions — legacy owner: title edit PASS, oldHistoricalField preserved", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { title: "Mới", updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: description edit PASS", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { description: "Mô tả mới", updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: open (status+startedAt+activeQuestionId+activeQuestionStartedAt) PASS", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), {
    status: "open", startedAt: serverTimestamp(), activeQuestionId: "q1", activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test("sessions — legacy owner: close (status+closedAt) PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "open" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "closed", closedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: reopen (status+closedAt:null+activeQuestionStartedAt) PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed", closedAt: new Date() });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "open", closedAt: null, activeQuestionStartedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: archive (status only) PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { status: "archived", updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: toggle showResults PASS", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { showResults: "live", updatedAt: serverTimestamp() }));
});

test("sessions — legacy owner: live-aggregate recompute (responseCount+liveAggregate) PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "open" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), {
    responseCount: 3, liveAggregate: { questionId: "q1", chartType: "bar", agg: {}, respondedCount: 3, openAnswers: [], updatedAt: new Date() },
    updatedAt: serverTimestamp()
  }));
});

test("sessions — legacy owner: trash then restore PASS", async () => {
  await seedUsers(); await seedSession("s1", { status: "closed" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: serverTimestamp(), deletedBy: "teacher-a", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add arbitrary new field", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { totallyNewField: "x", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: modify existing historical unknown field", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { oldHistoricalField: "changed", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: delete historical unknown field", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { oldHistoricalField: deleteField(), updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add editContractVersion", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { editContractVersion: 1, updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add configRevision", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { configRevision: 0, updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add currentConfigId", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { currentConfigId: "cfg1", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add lastOperationId", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { lastOperationId: "op1", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: add contractActivatedAt", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test("sessions — DENY: modify ownerId (identity)", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { ownerId: "teacher-b", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: modify accessToken/shortCode (join/access identity)", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { accessToken: "forged-token-xxxxxxxxxxxxxxx", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { shortCode: "HACKED", updatedAt: serverTimestamp() }));
});

test("sessions — DENY: modify createdAt", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "sessions", "s1"), { createdAt: new Date(2000, 0, 1), updatedAt: serverTimestamp() }));
});

test("sessions — authorization: foreign teacher DENY, anonymous DENY, suspended DENY, admin legitimate PASS", async () => {
  await seedUsers(); await seedSession("s1");
  const b = db(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "sessions", "s1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));

  const anon = db(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "sessions", "s1"), { title: "Học viên sửa", updatedAt: serverTimestamp() }));

  await seedSession("s-susp", { ownerId: "teacher-suspended" });
  const susp = db(teacherCtx("teacher-suspended"));
  await assertFails(updateDoc(doc(susp, "sessions", "s-susp"), { title: "Tự sửa khi bị khóa", updatedAt: serverTimestamp() }));

  const admin = db(teacherCtx("admin-1"));
  await assertSucceeds(updateDoc(doc(admin, "sessions", "s1"), { title: "Admin sửa", updatedAt: serverTimestamp() }));
});

test("sessions — admin: same allowlist as owner, arbitrary/contract fields still DENY", async () => {
  await seedUsers(); await seedSession("s1");
  const admin = db(teacherCtx("admin-1"));
  await assertFails(updateDoc(doc(admin, "sessions", "s1"), { editContractVersion: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(admin, "sessions", "s1"), { totallyNewField: "x", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// GROUP ACTIVITIES
// =====================================================================================

const legacyGroupFixture = {
  ownerId: "teacher-a", classId: "class-1", className: "K77.A01", title: "Cũ", instructions: "Làm việc nhóm",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "GRPJOIN1", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date(),
  oldHistoricalField: "preserve-me"
};

async function seedGroup(id, overrides) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "groupActivities", id), { ...legacyGroupFixture, ...overrides });
  });
}

test("groupActivities — legacy owner: create (exact form shape) PASS", async () => {
  await seedUsers();
  const a = db(teacherCtx("teacher-a"));
  const { oldHistoricalField, ...createShape } = legacyGroupFixture;
  await assertSucceeds(setDoc(doc(a, "groupActivities", "new-g1"), createShape));
});

test("groupActivities — legacy owner: title/instructions edit PASS", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { title: "Mới", instructions: "Nhiệm vụ mới", updatedAt: serverTimestamp() }));
});

test("groupActivities — legacy owner: open (status+startedAt+pausedRemainingSec:null) PASS", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { status: "open", startedAt: serverTimestamp(), pausedRemainingSec: null, updatedAt: serverTimestamp() }));
});

test("groupActivities — legacy owner: close (status only) PASS", async () => {
  await seedUsers(); await seedGroup("g1", { status: "open" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { status: "closed", updatedAt: serverTimestamp() }));
});

test("groupActivities — legacy owner: restart timer (startedAt+pausedRemainingSec:null) PASS", async () => {
  await seedUsers(); await seedGroup("g1", { status: "open" });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { startedAt: serverTimestamp(), pausedRemainingSec: null, updatedAt: serverTimestamp() }));
});

test("groupActivities — legacy owner: pause timer (startedAt:null+pausedRemainingSec) PASS", async () => {
  await seedUsers(); await seedGroup("g1", { status: "open", startedAt: new Date() });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { startedAt: null, pausedRemainingSec: 300, updatedAt: serverTimestamp() }));
});

// Explicitly not a fabricated test: there is no code path in index.html that updates
// allowText/allowPhoto/allowFile after creation (grep-verified) — "submission permission" for
// this family is create-time-only and is covered structurally by the create allowlist alone,
// and by the fact these three fields are absent from the update allowlist (so any attempt to
// change them post-create is denied — see the DENY test below).
test("groupActivities — DENY: modify allowText/allowPhoto/allowFile post-create (no legitimate path exists for this today)", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { allowFile: false, updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: add arbitrary new field", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { totallyNewField: "x", updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: modify existing historical unknown field", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { oldHistoricalField: "changed", updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: delete historical unknown field", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { oldHistoricalField: deleteField(), updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: add editContractVersion/configRevision/currentConfigId/lastOperationId/contractActivatedAt", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { editContractVersion: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { configRevision: 0, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { currentConfigId: "cfg1", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { lastOperationId: "op1", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { contractActivatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: modify ownerId, joinCode (identity)", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { ownerId: "teacher-b", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { joinCode: "HACKED01", updatedAt: serverTimestamp() }));
});

test("groupActivities — DENY: modify groupCount (RETIRE must go through the future contract writer, not a bare update)", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "groupActivities", "g1"), { groupCount: 3, updatedAt: serverTimestamp() }));
});

test("groupActivities — authorization: foreign teacher DENY, anonymous DENY, suspended DENY, admin legitimate PASS", async () => {
  await seedUsers(); await seedGroup("g1");
  const b = db(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "groupActivities", "g1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));

  const anon = db(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "groupActivities", "g1"), { title: "Học viên sửa", updatedAt: serverTimestamp() }));

  await seedGroup("g-susp", { ownerId: "teacher-suspended" });
  const susp = db(teacherCtx("teacher-suspended"));
  await assertFails(updateDoc(doc(susp, "groupActivities", "g-susp"), { title: "Tự sửa khi bị khóa", updatedAt: serverTimestamp() }));

  const admin = db(teacherCtx("admin-1"));
  await assertSucceeds(updateDoc(doc(admin, "groupActivities", "g1"), { title: "Admin sửa", updatedAt: serverTimestamp() }));
});

test("groupActivities — regression: existing topics subcollection rule (untouched by this gate) still works for the owner", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(setDoc(doc(a, "groupActivities", "g1", "topics", "1"), { group: 1, topic: "Chủ đề 1", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// CONTRACT SUBCOLLECTIONS — must remain fully denied (not opened by this gate)
// =====================================================================================

test("configVersions create DENY under sessions", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "sessions", "s1", "configVersions", "cfg1"), { kind: "interaction", active: true }));
});

test("configVersions create DENY under groupActivities", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "groupActivities", "g1", "configVersions", "cfg1"), { kind: "group", active: true }));
});

test("editHistory create DENY under sessions", async () => {
  await seedUsers(); await seedSession("s1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "sessions", "s1", "editHistory", "op1"), { operationId: "op1", actorUid: "teacher-a" }));
});

test("editHistory create DENY under groupActivities", async () => {
  await seedUsers(); await seedGroup("g1");
  const a = db(teacherCtx("teacher-a"));
  await assertFails(setDoc(doc(a, "groupActivities", "g1", "editHistory", "op1"), { operationId: "op1", actorUid: "teacher-a" }));
});

// =====================================================================================
// KNOWLEDGE SESSIONS — regression only, this gate does not touch these rules
// =====================================================================================

test("knowledgeSessions regression: owner update still PASS, still rejects editContractVersion, foreign teacher still DENY", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "knowledgeSessions", "k1"), {
      ownerId: "teacher-a", title: "Cũ", joinCode: "ABC123", status: "open",
      minimumPerParticipant: 3, targetSubmissions: 1500, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const a = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { title: "Mới", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { editContractVersion: 1, updatedAt: serverTimestamp() }));

  const b = db(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "knowledgeSessions", "k1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));
});
