// Gate 2A-AUTH-I2-CORRECTION — Firestore Rules emulator tests for the new additive owner/admin
// `list` capability on groupActivities/{id}/members, and the (unchanged, pre-existing AUTH-I1)
// field-only `group` correction path. Runs against a real local Firestore emulator loaded with
// the CANDIDATE rules content (firestore.rules.production-candidate on branch
// gate-2a-auth-i2-teacher-correction — the verified AUTH-I2 production baseline PLUS only this
// gate's single new `allow list` clause). Never uses `firebase deploy` in any form. Run via
// `npm run test:gate2a-auth-i2-correction` (starts/stops the emulator itself), not directly —
// see run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDocs, collection, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2A_AUTH_I2_CORRECTION_EMULATOR_PORT || 8192);
const PROJECT_ID = "demo-hcma2-gate2a-auth-i2-correction";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function studentCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); }); }

const openGroupFixture = {
  ownerId: "teacher-a", classId: "class-1", className: "K77.A01", title: "Thảo luận", instructions: "Làm việc nhóm",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "GRPJOIN1", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
};
async function seedActivity(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", id), { ...openGroupFixture, ...overrides }); });
}
async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active" });
  });
}
async function seedMember(activityId, uid, group) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", activityId, "members", uid), { group, joinedAt: new Date(), joinCode: "GRPJOIN1" }); });
}

// =====================================================================================
// LECTURER ROSTER (list)
// =====================================================================================

test("ROSTER — ALLOW: owner can list memberships of their own activity", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedMember("g1", "student-1", 1); await seedMember("g1", "student-2", 2);
  const d = teacherCtx("teacher-a").firestore();
  const snap = await assertSucceeds(getDocs(collection(d, "groupActivities", "g1", "members")));
  assert.equal(snap.size, 2);
});

test("ROSTER — DENY: an unrelated teacher cannot list another owner's memberships", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-b").firestore();
  await assertFails(getDocs(collection(d, "groupActivities", "g1", "members")));
});

test("ROSTER — DENY: a student cannot list members at all", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = studentCtx("student-1").firestore();
  await assertFails(getDocs(collection(d, "groupActivities", "g1", "members")));
});

test("ROSTER — ALLOW: admin can list any activity's memberships", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("admin-1").firestore();
  const snap = await assertSucceeds(getDocs(collection(d, "groupActivities", "g1", "members")));
  assert.equal(snap.size, 1);
});

// =====================================================================================
// CORRECTION (updateDoc — pre-existing AUTH-I1 policy, re-verified unchanged here)
// =====================================================================================

test("CORRECTION — ALLOW: owner changes a member's group (1 -> 2)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2 }));
});

test("CORRECTION — ALLOW: admin changes a member's group", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 3 }));
});

test("CORRECTION — DENY: an unrelated teacher cannot change a member's group", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-b").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2 }));
});

test("CORRECTION — DENY: the student themselves cannot change their own group", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = studentCtx("student-1").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2 }));
});

test("CORRECTION — DENY: group 0 is rejected", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 0 }));
});

test("CORRECTION — DENY: group > groupCount is rejected", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 999 }));
});

test("CORRECTION — DENY: non-integer group is rejected", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: "2" }));
});

test("CORRECTION — DENY: joinedAt cannot be mutated, even by the owner", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { joinedAt: serverTimestamp() }));
});

test("CORRECTION — DENY: joinCode cannot be mutated, even by the owner", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { joinCode: "HACKED" }));
});

test("CORRECTION — DENY: an extra unknown field cannot be introduced alongside a valid group change", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const d = teacherCtx("teacher-a").firestore();
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2, name: "Nguyen Van A" }));
});

// =====================================================================================
// REGRESSION — unrelated members behavior (get/create/delete) untouched by this gate
// =====================================================================================

test("REGRESSION — ALLOW: student can still get their own membership (unchanged AUTH-I1 behavior)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const { getDoc } = await import("firebase/firestore");
  const d = studentCtx("student-1").firestore();
  const snap = await assertSucceeds(getDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
  assert.equal(snap.data().group, 1);
});

test("REGRESSION — DENY: a student still cannot delete their own membership (unchanged AUTH-I1 behavior)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedMember("g1", "student-1", 1);
  const { deleteDoc } = await import("firebase/firestore");
  const d = studentCtx("student-1").firestore();
  await assertFails(deleteDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
});
