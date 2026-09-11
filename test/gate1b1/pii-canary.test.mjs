import test from "node:test";
import assert from "node:assert/strict";
import { createMockDb } from "./mock-db-facade.mjs";
import { stripPii, resolveParticipantPolicy, PII_FIELDS } from "../../session-reader.mjs";
import { loadOwnParticipantPolicyPublic, ReaderUiError } from "../../session-reader-ui.mjs";

// PII boundary canary: fullName/className/email/phone must never appear in a public/version
// projection, an audit projection, an aggregate, or any mock downstream (e.g. AI/Second Brain)
// projection. This module does NOT claim free-text `text` fields are scanned or scrubbed of
// self-entered personal information — that is explicitly out of scope for Gate 1B.1 and is
// documented as such in docs/READER-CONTRACT.md.

test("stripPii removes exactly the four PII fields and nothing else", () => {
  const record = { fullName: "Nguyễn Văn A", className: "K77.A01", email: "a@example.com", phone: "0900000000", minimumPerParticipant: 3, status: "resolved" };
  const stripped = stripPii(record);
  for (const field of PII_FIELDS) assert.equal(field in stripped, false, `${field} must be stripped`);
  assert.equal(stripped.minimumPerParticipant, 3);
  assert.equal(stripped.status, "resolved");
});

test("stripPii is a no-op on fields it doesn't recognize as PII (documents the boundary, doesn't overreach)", () => {
  const record = { text: "Tôi tên là Nguyễn Văn A, sđt 0900000000" };
  const stripped = stripPii(record);
  assert.equal(stripped.text, record.text, "free text is never scanned/redacted by this reader — participants can still self-disclose PII in free text, and that is a known, documented non-goal, not a false claim of cleanliness");
});

test("resolveParticipantPolicy's own return shape never carries a PII field key for a legacy session", async () => {
  const db = createMockDb({});
  const session = {
    ownerId: "t1", collectParticipantProfile: true,
    participantFields: { fullName: { enabled: true, required: true }, email: { enabled: true, required: false } },
    classOptions: ["A1"], minimumPerParticipant: 3
  };
  const policy = await resolveParticipantPolicy(db, "knowledgeSessions/k1", session, "uid-1");
  for (const field of PII_FIELDS) assert.equal(field in policy, false);
});

test("resolveParticipantPolicy's own return shape never carries a PII field key for a contract session", async () => {
  const db = createMockDb({
    "knowledgeSessions/k1/configVersions/cfg1": { parentConfigId: null, kind: "knowledge", active: true, minimumPerParticipant: 3, classOptions: ["A1"], participantFields: { fullName: { enabled: true, required: true } } },
    "knowledgeSessions/k1/enrollments/uid-1": { configId: "cfg1" }
  });
  const session = { ownerId: "t1", editContractVersion: 1, currentConfigId: "cfg1" };
  const policy = await resolveParticipantPolicy(db, "knowledgeSessions/k1", session, "uid-1");
  for (const field of PII_FIELDS) assert.equal(field in policy, false);
});

test("loadOwnParticipantPolicyPublic runs the result through stripPii as defense in depth", async () => {
  const db = createMockDb({});
  const session = { ownerId: "t1", collectParticipantProfile: true, participantFields: {}, classOptions: [], minimumPerParticipant: 3 };
  const policy = await loadOwnParticipantPolicyPublic(db, "k1", session, "uid-1");
  for (const field of PII_FIELDS) assert.equal(field in policy, false);
});

test("loadOwnParticipantPolicyPublic refuses (fails closed) with no uid rather than reading anything", async () => {
  const db = createMockDb({});
  await assert.rejects(
    () => loadOwnParticipantPolicyPublic(db, "k1", { ownerId: "t1" }, null),
    (err) => { assert.ok(err instanceof ReaderUiError); assert.equal(err.code, "FORBIDDEN"); return true; }
  );
  assert.deepEqual(db.touched, [], "must not read Firestore at all before the uid check");
});

test("mock downstream/aggregate projection built from participant policy objects stays PII-free across many participants", async () => {
  // Note: `participantFields` is the policy *schema* (which fields are turned on/required) —
  // it legitimately contains keys named after the PII fields (e.g. participantFields.fullName
  // = {enabled:true}). That is not a PII leak: no participant's actual name/class/email/phone
  // *value* is present anywhere. The check below is on each policy object's own top-level
  // shape, matching what stripPii() actually guarantees, not a blanket string search that
  // would also (wrongly) flag the schema descriptor.
  const db = createMockDb({});
  const uids = ["p1", "p2", "p3"];
  const session = { ownerId: "t1", collectParticipantProfile: true, participantFields: { fullName: { enabled: true, required: true } }, classOptions: ["A1", "A2"], minimumPerParticipant: 3 };
  const aggregate = [];
  for (const uid of uids) aggregate.push(await loadOwnParticipantPolicyPublic(db, "k1", session, uid));
  for (const policy of aggregate) {
    for (const field of PII_FIELDS) assert.equal(field in policy, false);
  }
});
