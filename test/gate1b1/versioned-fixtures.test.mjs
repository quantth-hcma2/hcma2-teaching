import test from "node:test";
import assert from "node:assert/strict";
import { createMockDb } from "./mock-db-facade.mjs";
import {
  resolveEffectiveConfig,
  readInteractionReport,
  readGroupHistoricalData,
  resolveParticipantPolicy,
  validateManifestShape,
  ReaderError,
  LIMITS
} from "../../session-reader.mjs";

// All fixtures below are synthetic. Nothing here is written to, or read from, production.

test("interaction: two rounds keep independent question/option IDs and correct class attribution", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg1": {
      parentConfigId: null, kind: "interaction", roundId: "round-1", active: false, sealed: true,
      questions: [
        { questionId: "r1-q1", roundId: "round-1", type: "single", text: "Vòng 1 câu 1", options: [{ optionId: "r1-q1-a", text: "A" }, { optionId: "r1-q1-b", text: "B" }] }
      ]
    },
    "sessions/s1/configVersions/cfg2": {
      parentConfigId: "cfg1", kind: "interaction", roundId: "round-2", active: true, sealed: false,
      questions: [
        { questionId: "r2-q1", roundId: "round-2", type: "scale", text: "Vòng 2 câu 1", options: [{ optionId: "r2-q1-1", text: "1" }, { optionId: "r2-q1-5", text: "5" }] }
      ]
    }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfg2", classId: "K77.A01" };
  const report = await readInteractionReport(db, "sessions/s1", session);
  assert.equal(report.legacy, false);
  assert.equal(report.rounds.length, 2);
  const byRound = Object.fromEntries(report.rounds.map(r => [r.roundId, r]));
  assert.deepEqual(byRound["round-1"].questions.map(q => q.questionId), ["r1-q1"]);
  assert.deepEqual(byRound["round-2"].questions.map(q => q.questionId), ["r2-q1"]);
  // Option IDs never collide across rounds.
  const allOptionIds = report.rounds.flatMap(r => r.questions.flatMap(q => q.options.map(o => o.optionId)));
  assert.equal(new Set(allOptionIds).size, allOptionIds.length);
  assert.equal(byRound["round-1"].sealed, true);
  assert.equal(byRound["round-2"].sealed, false);
});

test("interaction: scale/ranking question types are not conflated across versions", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfgScale": { parentConfigId: null, kind: "interaction", roundId: "r1", active: false, questions: [{ questionId: "q-scale", roundId: "r1", type: "scale", options: [] }] },
    "sessions/s1/configVersions/cfgRanking": { parentConfigId: "cfgScale", kind: "interaction", roundId: "r2", active: true, questions: [{ questionId: "q-ranking", roundId: "r2", type: "ranking", options: [] }] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgRanking" };
  const report = await readInteractionReport(db, "sessions/s1", session);
  const types = report.rounds.flatMap(r => r.questions.map(q => q.type));
  assert.deepEqual(types.sort(), ["ranking", "scale"]);
});

test("manifest loop (cycle) fails closed with ANCESTRY_CYCLE, never silently falls back to legacy", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfgA": { parentConfigId: "cfgB", kind: "interaction", roundId: "a", active: true, questions: [] },
    "sessions/s1/configVersions/cfgB": { parentConfigId: "cfgA", kind: "interaction", roundId: "b", active: false, questions: [] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgA" };
  await assert.rejects(
    () => resolveEffectiveConfig(db, "sessions/s1", session, "interaction"),
    (err) => { assert.ok(err instanceof ReaderError); assert.equal(err.code, "ANCESTRY_CYCLE"); return true; }
  );
});

test("broken ancestry (missing parent doc) fails closed with BROKEN_ANCESTRY", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfgLeaf": { parentConfigId: "cfg-does-not-exist", kind: "interaction", roundId: "a", active: true, questions: [] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgLeaf" };
  await assert.rejects(
    () => resolveEffectiveConfig(db, "sessions/s1", session, "interaction"),
    (err) => { assert.equal(err.code, "BROKEN_ANCESTRY"); return true; }
  );
});

test("reused questionId across two different rounds fails closed with REUSED_QUESTION_ID", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg1": { parentConfigId: null, kind: "interaction", roundId: "round-1", active: false, questions: [{ questionId: "dup", roundId: "round-1", options: [] }] },
    "sessions/s1/configVersions/cfg2": { parentConfigId: "cfg1", kind: "interaction", roundId: "round-2", active: true, questions: [{ questionId: "dup", roundId: "round-2", options: [] }] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfg2" };
  await assert.rejects(
    () => readInteractionReport(db, "sessions/s1", session),
    (err) => { assert.equal(err.code, "REUSED_QUESTION_ID"); return true; }
  );
});

test("oversized manifest fails validateManifestShape and fails closed via resolveEffectiveConfig", async () => {
  const bigText = "x".repeat(LIMITS.manifestBytes + 100);
  const oversized = { parentConfigId: null, kind: "interaction", roundId: "r1", active: true, questions: [{ questionId: "q1", roundId: "r1", text: bigText, options: [] }] };
  const shape = validateManifestShape(oversized, "interaction");
  assert.equal(shape.ok, false);
  assert.equal(shape.reason, "MANIFEST_TOO_LARGE");

  const db = createMockDb({ "sessions/s1/configVersions/big": oversized });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "big" };
  await assert.rejects(
    () => resolveEffectiveConfig(db, "sessions/s1", session, "interaction"),
    (err) => { assert.equal(err.code, "MANIFEST_INVALID"); return true; }
  );
});

test("a prepared-but-not-active config is not treated as official history", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfgActive": { parentConfigId: null, kind: "interaction", roundId: "round-1", active: true, questions: [{ questionId: "q-active", roundId: "round-1", options: [] }] },
    // Prepared for a future publish, never referenced by currentConfigId.
    "sessions/s1/configVersions/cfgPrepared": { parentConfigId: "cfgActive", kind: "interaction", roundId: "round-2", active: false, questions: [{ questionId: "q-prepared", roundId: "round-2", options: [] }] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgActive" };
  const report = await readInteractionReport(db, "sessions/s1", session);
  const allQuestionIds = report.rounds.flatMap(r => r.questions.map(q => q.questionId));
  assert.deepEqual(allQuestionIds, ["q-active"]);
});

test("resolveEffectiveConfig rejects an active config not actually marked active:true", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfgX": { parentConfigId: null, kind: "interaction", roundId: "r1", active: false, questions: [] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgX" };
  await assert.rejects(
    () => resolveEffectiveConfig(db, "sessions/s1", session, "interaction"),
    (err) => { assert.equal(err.code, "MANIFEST_INVALID"); return true; }
  );
});

test("group: a retired group (present only in an ancestor manifest) is still viewable/exportable", async () => {
  const db = createMockDb({
    "groupActivities/g1/configVersions/cfgOld": { parentConfigId: null, kind: "group", active: false, groupCount: 5, tasks: [{ group: 4, topic: "Nhiệm vụ nhóm 4 (đã thu gọn)" }] },
    "groupActivities/g1/configVersions/cfgNew": { parentConfigId: "cfgOld", kind: "group", active: true, groupCount: 3, tasks: [{ group: 1, topic: "Nhiệm vụ 1" }] },
    "groupActivities/g1/topics/4": { group: 4, topic: "Chủ đề lịch sử nhóm 4" }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgNew" };
  const history = await readGroupHistoricalData(db, "groupActivities/g1", session);
  assert.deepEqual(history.knownGroupNumbers, [1, 2, 3, 4, 5]);
  const topic4 = history.topics.find(t => t.id === "4");
  assert.equal(topic4.resolved, true, "group 4 is retired (not in the current manifest) but must remain resolved because it existed in an ancestor manifest");
});

test("group: a record referencing a group unknown to every manifest is reported unresolved, not deleted/filtered", async () => {
  const db = createMockDb({
    "groupActivities/g1/configVersions/cfgOnly": { parentConfigId: null, kind: "group", active: true, groupCount: 2, tasks: [] },
    "groupActivities/g1/notes/n1": { group: 99, text: "Ghi chú không rõ nhóm" }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgOnly" };
  const history = await readGroupHistoricalData(db, "groupActivities/g1", session);
  const n1 = history.notes.find(n => n.id === "n1");
  assert.ok(n1, "must still be present");
  assert.equal(n1.resolved, false);
});

test("group: groupCount out of the 2-12 range fails validateManifestShape", () => {
  const tooFew = validateManifestShape({ kind: "group", groupCount: 1, tasks: [] }, "group");
  assert.equal(tooFew.ok, false);
  assert.equal(tooFew.reason, "GROUP_COUNT_OUT_OF_RANGE");
  const tooMany = validateManifestShape({ kind: "group", groupCount: 13, tasks: [] }, "group");
  assert.equal(tooMany.ok, false);
});

test("knowledge: pinned policy — a participant who enrolled under an older config keeps that config's minimum, not the session's current minimum", async () => {
  const db = createMockDb({
    "knowledgeSessions/k1/configVersions/cfgOld": { parentConfigId: null, kind: "knowledge", active: false, minimumPerParticipant: 3, classOptions: ["A1"], participantFields: { fullName: { enabled: true, required: true } } },
    "knowledgeSessions/k1/configVersions/cfgNew": { parentConfigId: "cfgOld", kind: "knowledge", active: true, minimumPerParticipant: 5, classOptions: ["A1", "A2"], participantFields: { fullName: { enabled: true, required: true }, phone: { enabled: true, required: false } } },
    "knowledgeSessions/k1/enrollments/uid-old": { configId: "cfgOld" }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgNew" };
  const policy = await resolveParticipantPolicy(db, "knowledgeSessions/k1", session, "uid-old");
  assert.equal(policy.status, "resolved");
  assert.equal(policy.minimumPerParticipant, 3, "must stay pinned to the config active at enrollment time");
});

test("knowledge: a participant with no enrollment record resolves to status unknown, never a guess", async () => {
  const db = createMockDb({
    "knowledgeSessions/k1/configVersions/cfgNew": { parentConfigId: null, kind: "knowledge", active: true, minimumPerParticipant: 5, classOptions: [] }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfgNew" };
  const policy = await resolveParticipantPolicy(db, "knowledgeSessions/k1", session, "uid-missing");
  assert.deepEqual(policy, { status: "unknown" });
});

test("knowledge: minimumPerParticipant outside 1-20 fails validateManifestShape", () => {
  assert.equal(validateManifestShape({ kind: "knowledge", minimumPerParticipant: 0, classOptions: [] }, "knowledge").ok, false);
  assert.equal(validateManifestShape({ kind: "knowledge", minimumPerParticipant: 21, classOptions: [] }, "knowledge").ok, false);
  assert.equal(validateManifestShape({ kind: "knowledge", minimumPerParticipant: 20, classOptions: [] }, "knowledge").ok, true);
});

test("knowledge: class name over 40 chars fails validateManifestShape", () => {
  const longName = "K".repeat(41);
  const shape = validateManifestShape({ kind: "knowledge", classOptions: [longName] }, "knowledge");
  assert.equal(shape.ok, false);
  assert.equal(shape.reason, "CLASS_NAME_INVALID");
});
