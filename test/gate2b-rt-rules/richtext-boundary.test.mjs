// GATE 2B-RT-RULES — Firestore Rules emulator tests for the additive RichText V1 structural
// boundary on groupActivities.instructionsRich and groupActivities/{id}/topics/{groupId}.topicRich.
// Runs against a real local Firestore emulator loaded with the CANDIDATE rules
// (firestore.rules.production-candidate on branch gate-2b-rt-rules). Never uses `firebase deploy`
// in any form.
//
// Rules enforce ONLY the outermost structural/size boundary (isRichTextV1Boundary in the Rules
// file itself) — never the deep per-block/per-run shape, which is impractical to express safely
// for a variable-length nested array (see the Rules file's own comment). Category H below proves
// this three-layer defense concretely: a document that passes the Rules boundary but fails the
// full client validator is written successfully here, then shown to be rejected by
// validateRichTextV1 and to render via the safe legacy fallback — not partially rendered.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteField, getDoc, serverTimestamp } from "firebase/firestore";
import { validateRichTextV1 } from "../../rich-text-contract.mjs";
import { renderRichText } from "../../rich-text-renderer.mjs";
import { FakeDocument } from "../gate2b-rt-contract/fake-dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2B_RT_RULES_EMULATOR_PORT || 8197);
const PROJECT_ID = "demo-hcma2-gate2b-rt-rules";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function teacherCtx(uid = "teacher-a") { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function studentCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); }); }

const VALID_RICH = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Xin chào", bold: true }] }] };

const baseActivityFields = {
  ownerId: "teacher-a", classId: "c1", className: "K1", title: "RT Rules", groupCount: 2,
  durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "RTJOIN1", status: "draft", startedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
};

async function seedBaseline({ status = "open" } = {}) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "groupActivities", "act1"), { ...baseActivityFields, status });
    await setDoc(doc(d, "groupJoinCodes", "RTJOIN1"), { activityId: "act1", ownerId: "teacher-a", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "RTJOIN1" });
    await setDoc(doc(d, "groupActivities", "act1", "topics", "1"), { group: 1, topic: "Đề tài 1", updatedAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "topics", "2"), { group: 2, topic: "Đề tài 2", updatedAt: new Date() });
  });
}

// =====================================================================================
// A. COMMON LEGACY
// =====================================================================================

test("A: create a legacy activity without instructionsRich — PASS", async () => {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" }); });
  const t = teacherCtx().firestore();
  await assertSucceeds(setDoc(doc(t, "groupActivities", "legacy1"), { ...baseActivityFields }));
});

test("A: update a legacy activity without touching instructionsRich — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1"), { title: "Updated title", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// B. COMMON VALID RICH
// =====================================================================================

test("B: owner create with valid instructionsRich — PASS", async () => {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" }); });
  const t = teacherCtx().firestore();
  await assertSucceeds(setDoc(doc(t, "groupActivities", "rich1"), { ...baseActivityFields, instructionsRich: VALID_RICH }));
});

test("B: owner update to add valid instructionsRich — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1"), { instructionsRich: VALID_RICH, updatedAt: serverTimestamp() }));
});

test("B: owner remove instructionsRich (revert to plain instructions) — PASS", async () => {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "groupActivities", "act1"), { ...baseActivityFields, instructionsRich: VALID_RICH });
  });
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1"), { instructionsRich: deleteField(), updatedAt: serverTimestamp() }));
  const snap = await getDoc(doc(t, "groupActivities", "act1"));
  assert.equal("instructionsRich" in snap.data(), false);
});

// =====================================================================================
// C. COMMON INVALID RICH
// =====================================================================================

const invalidRichCases = {
  "wrong primitive (string instead of map)": "not a map",
  "missing version": { blocks: [{ type: "paragraph", runs: [] }] },
  "version != 1": { version: 2, blocks: [{ type: "paragraph", runs: [] }] },
  "unknown top-level key": { version: 1, blocks: [{ type: "paragraph", runs: [] }], extra: "nope" },
  "blocks non-list": { version: 1, blocks: "not-a-list" },
  "blocks empty": { version: 1, blocks: [] },
  "blocks >20": { version: 1, blocks: Array.from({ length: 21 }, () => ({ type: "paragraph", runs: [] })) }
};

for (const [label, badValue] of Object.entries(invalidRichCases)) {
  test(`C: instructionsRich ${label} — DENY`, async () => {
    await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" }); });
    const t = teacherCtx().firestore();
    await assertFails(setDoc(doc(t, "groupActivities", "bad1"), { ...baseActivityFields, instructionsRich: badValue }));
  });
}

// =====================================================================================
// D. TOPIC LEGACY
// =====================================================================================

test("D: legacy topic create (no topicRich) — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(setDoc(doc(t, "groupActivities", "act1", "topics", "1"), { group: 1, topic: "Cập nhật", updatedAt: serverTimestamp() }));
});

test("D: legacy topic update (no topicRich) — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1", "topics", "1"), { topic: "Cập nhật khác", updatedAt: serverTimestamp() }));
});

// =====================================================================================
// E. TOPIC VALID RICH
// =====================================================================================

test("E: owner create topic with valid topicRich — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(setDoc(doc(t, "groupActivities", "act1", "topics", "1"), { group: 1, topic: "Đề tài 1", topicRich: VALID_RICH, updatedAt: serverTimestamp() }));
});

test("E: owner update topic to add valid topicRich — PASS", async () => {
  await seedBaseline();
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1", "topics", "1"), { topicRich: VALID_RICH, updatedAt: serverTimestamp() }));
});

test("E: owner remove topicRich — PASS", async () => {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "groupActivities", "act1"), baseActivityFields);
    await setDoc(doc(d, "groupActivities", "act1", "topics", "1"), { group: 1, topic: "x", topicRich: VALID_RICH, updatedAt: new Date() });
  });
  const t = teacherCtx().firestore();
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1", "topics", "1"), { topicRich: deleteField(), updatedAt: serverTimestamp() }));
  const snap = await getDoc(doc(t, "groupActivities", "act1", "topics", "1"));
  assert.equal("topicRich" in snap.data(), false);
});

// =====================================================================================
// F. TOPIC INVALID RICH (same malformed boundary cases as C)
// =====================================================================================

for (const [label, badValue] of Object.entries(invalidRichCases)) {
  test(`F: topicRich ${label} — DENY`, async () => {
    await seedBaseline();
    const t = teacherCtx().firestore();
    await assertFails(updateDoc(doc(t, "groupActivities", "act1", "topics", "1"), { topicRich: badValue, updatedAt: serverTimestamp() }));
  });
}

// =====================================================================================
// G. AUTHORIZATION — I3 freeze proof
// =====================================================================================

test("G: student cannot write instructionsRich", async () => {
  await seedBaseline();
  const s = studentCtx("student-1").firestore();
  await assertFails(updateDoc(doc(s, "groupActivities", "act1"), { instructionsRich: VALID_RICH }));
});

test("G: student cannot write topicRich", async () => {
  await seedBaseline();
  const s = studentCtx("student-1").firestore();
  await assertFails(updateDoc(doc(s, "groupActivities", "act1", "topics", "1"), { topicRich: VALID_RICH }));
});

test("G: student own-group topic read PASS while OPEN", async () => {
  await seedBaseline({ status: "open" });
  const s = studentCtx("student-1").firestore();
  await assertSucceeds(getDoc(doc(s, "groupActivities", "act1", "topics", "1")));
});

test("G: student other-group topic read DENY", async () => {
  await seedBaseline({ status: "open" });
  const s = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(s, "groupActivities", "act1", "topics", "2")));
});

test("G: CLOSED activity denies student topic read", async () => {
  await seedBaseline({ status: "closed" });
  const s = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(s, "groupActivities", "act1", "topics", "1")));
});

test("G: owner/admin retain read access to topics while CLOSED", async () => {
  await seedBaseline({ status: "closed" });
  const t = teacherCtx().firestore();
  await assertSucceeds(getDoc(doc(t, "groupActivities", "act1", "topics", "1")));
});

// =====================================================================================
// H. HOSTILE-BUT-BOUNDARY-VALID DOCUMENT — proves the three-layer defense is real
// =====================================================================================

test("H: a document that satisfies the Rules structural boundary but fails the deep client validator — write succeeds, validator rejects it, renderer falls back to legacy text", async () => {
  // Passes isRichTextV1Boundary: it IS a map, keys are exactly {version, blocks}, version == 1,
  // blocks is a list of length 1 (within 1..20). But the one block has an unsupported `type`
  // ("heading" — V1 only ever defines "paragraph") and its one run carries an unsupported `font`
  // token ("ComicSans") — both are checks Rules deliberately does not attempt.
  const hostileButBoundaryValid = {
    version: 1,
    blocks: [{ type: "heading", runs: [{ text: "Trông có vẻ ổn nhưng không hợp lệ", font: "ComicSans" }] }]
  };

  await seedBaseline();
  const t = teacherCtx().firestore();

  // 1. Rules allow it — the structural boundary is satisfied.
  await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1"), { instructionsRich: hostileButBoundaryValid, updatedAt: serverTimestamp() }));

  // 2. The deep client validator rejects it (unsupported block type, unsupported font token).
  assert.equal(validateRichTextV1(hostileButBoundaryValid), false);

  // 3. The safe renderer, given this stored value, falls back to the legacy plain-text mirror —
  // never a partial/hostile render.
  const fakeDoc = new FakeDocument();
  const container = fakeDoc.createElement("div");
  renderRichText(container, hostileButBoundaryValid, "Nội dung thường (mirror)", fakeDoc);
  assert.equal(container.children.length, 1, "must render exactly the legacy fallback, not the boundary-valid-but-invalid blocks");
  assert.equal(container.children[0].textContent, "Nội dung thường (mirror)");
});
