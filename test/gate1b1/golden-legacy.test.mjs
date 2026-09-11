import test from "node:test";
import assert from "node:assert/strict";
import { createMockDb } from "./mock-db-facade.mjs";
import {
  isContractSession,
  assertLegacyWritable,
  effectiveLifecycleState,
  resolveEffectiveConfig,
  readInteractionReport,
  readGroupHistoricalData,
  resolveParticipantPolicy,
  ReaderError
} from "../../session-reader.mjs";

// A legacy session is any session with no editContractVersion field at all — i.e. every real
// session in production today. These tests prove the reader treats that shape exactly as
// before: no default fields are invented, no configVersions/enrollments collection is ever
// touched, and the output shape is stable (golden byte comparison).

test("isContractSession is false for every legacy shape", () => {
  assert.equal(isContractSession({ title: "x" }), false);
  assert.equal(isContractSession({ title: "x", editContractVersion: null }), false);
  assert.equal(isContractSession(null), false);
  assert.equal(isContractSession({ title: "x", editContractVersion: 1 }), true);
});

test("effectiveLifecycleState reflects existing trash/status flags, in existing priority order", () => {
  assert.equal(effectiveLifecycleState({ status: "open" }), "open");
  assert.equal(effectiveLifecycleState({ status: "open", deletedAt: {} }), "trashed");
  assert.equal(effectiveLifecycleState({ status: "open", teacherDeletedAt: {} }), "teacher_trashed");
  assert.equal(effectiveLifecycleState({ status: "open", adminDeletedAt: {} }), "admin_trashed");
  assert.equal(effectiveLifecycleState(null), "unknown");
});

test("resolveEffectiveConfig for a legacy session never reads Firestore", async () => {
  const db = createMockDb({}); // deliberately empty — no configVersions collection exists
  const session = { ownerId: "teacher-1", status: "open", title: "Khởi động" };
  const effective = await resolveEffectiveConfig(db, "sessions/s1", session, "interaction");
  assert.equal(effective.legacy, true);
  assert.equal(effective.configId, "legacy-v0");
  assert.deepEqual(db.touched, []);
});

test("legacy interaction report is a pass-through of the current questions collection, wrapped in one synthetic round", async () => {
  const db = createMockDb({
    "questions/q1": { ownerId: "teacher-1", sessionId: "s1", order: 0, text: "Câu 1" },
    "questions/q2": { ownerId: "teacher-1", sessionId: "s1", order: 1, text: "Câu 2" },
    "questions/other-session": { ownerId: "teacher-1", sessionId: "s2", order: 0, text: "Không liên quan" }
  });
  const session = { ownerId: "teacher-1", status: "open", __sessionId: "s1" };
  const report = await readInteractionReport(db, "sessions/s1", session);
  assert.equal(report.legacy, true);
  assert.equal(report.rounds.length, 1);
  assert.equal(report.rounds[0].roundId, "legacy-v0");
  assert.equal(report.rounds[0].sealed, null);
  const ids = report.rounds[0].questions.map(q => q.questionId).sort();
  assert.deepEqual(ids, ["q1", "q2"]);
  // Never touched configVersions/enrollments for a legacy session.
  assert.ok(db.touched.every(t => !t.path.includes("configVersions") && !t.path.includes("enrollments")));
});

test("legacy group historical data: an out-of-groupCount record is still returned (never silently dropped)", async () => {
  const db = createMockDb({
    "groupActivities/g1/topics/1": { group: 1, topic: "Chủ đề 1" },
    "groupActivities/g1/topics/2": { group: 2, topic: "Chủ đề 2" },
    // Simulates a group that used to exist (groupCount was higher before) and was since retired
    // by shrinking groupCount to 2 on the legacy session. The record must not vanish.
    "groupActivities/g1/notes/n1": { group: 5, text: "Ghi chú từ nhóm đã bị thu gọn" }
  });
  const session = { ownerId: "teacher-1", status: "open", groupCount: 2 };
  const history = await readGroupHistoricalData(db, "groupActivities/g1", session);
  assert.equal(history.legacy, true);
  assert.deepEqual(history.knownGroupNumbers, [1, 2]);
  const n1 = history.notes.find(n => n.id === "n1");
  assert.ok(n1, "the out-of-range note must still be present, not filtered out");
  assert.equal(n1.resolved, false);
  const t1 = history.topics.find(t => t.id === "1");
  assert.equal(t1.resolved, true);
});

test("legacy participant policy is a direct pass-through of the session root (no enrollments read)", async () => {
  const db = createMockDb({});
  const session = {
    ownerId: "teacher-1",
    collectParticipantProfile: true,
    participantFields: { fullName: { enabled: true, required: true } },
    classOptions: ["A1", "A2"],
    minimumPerParticipant: 3
  };
  const policy = await resolveParticipantPolicy(db, "knowledgeSessions/k1", session, "uid-x");
  assert.equal(policy.status, "resolved");
  assert.equal(policy.legacy, true);
  assert.equal(policy.minimumPerParticipant, 3);
  assert.deepEqual(db.touched, []); // enrollments must never be read for a legacy session
});

test("assertLegacyWritable: Gate 1A's editor stays writable on a legacy session", () => {
  assert.doesNotThrow(() => assertLegacyWritable({ ownerId: "t1", title: "x" }));
});

test("assertLegacyWritable: fails closed (throws) on any contract session, so Gate 1A never blind-writes onto versioned data", () => {
  assert.throws(
    () => assertLegacyWritable({ ownerId: "t1", editContractVersion: 1, currentConfigId: "cfg1" }),
    (err) => { assert.ok(err instanceof ReaderError); assert.equal(err.code, "CONTRACT_SESSION_NOT_WRITABLE"); return true; }
  );
});

test("golden byte shape: legacy interaction report JSON is stable", async () => {
  const db = createMockDb({
    "questions/qA": { ownerId: "t1", sessionId: "sA", order: 0, text: "Đồng ý hay không?" }
  });
  const session = { ownerId: "t1", status: "closed", __sessionId: "sA" };
  const report = await readInteractionReport(db, "sessions/sA", session);
  const golden = '{"legacy":true,"rounds":[{"roundId":"legacy-v0","sealed":null,"questions":[{"questionId":"qA","ownerId":"t1","sessionId":"sA","order":0,"text":"Đồng ý hay không?"}]}]}';
  assert.equal(JSON.stringify(report), golden);
});
