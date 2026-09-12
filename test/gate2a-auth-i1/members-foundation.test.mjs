// Gate 2A-AUTH-I1 — Stage 1 (purely additive) membership foundation emulator tests. Runs
// against a real local Firestore emulator loaded with the CANDIDATE rules content
// (firestore.rules.production-candidate on branch gate-2a-auth-i1-membership-foundation, i.e.
// the verified production baseline PLUS only this gate's new groupActivities/{id}/members/{uid}
// match block — nothing else). Never uses `firebase deploy` in any form. Run via
// `npm run test:gate2a-auth-i1` (starts/stops the emulator itself), not directly — see
// run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2A_AUTH_I1_EMULATOR_PORT || 8190);
const PROJECT_ID = "demo-hcma2-gate2a-auth-i1";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function studentCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
  });
}

const openGroupFixture = {
  ownerId: "teacher-a", classId: "class-1", className: "K77.A01", title: "Thảo luận", instructions: "Làm việc nhóm",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "GRPJOIN1", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
};
async function seedActivity(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", id), { ...openGroupFixture, ...overrides }); });
}
async function seedJoinCode(code, activityId, ownerId = "teacher-a") {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupJoinCodes", code), { activityId, ownerId, createdAt: new Date() }); });
}

function validMembership(overrides) {
  return { group: 1, joinedAt: serverTimestamp(), joinCode: "GRPJOIN1", ...overrides };
}

// =====================================================================================
// TASK C — JOIN-CODE PROOF TEST: ALLOW
// =====================================================================================

test("members create — ALLOW: signed-in anonymous student, own uid doc, valid open activity, valid matching joinCode, valid group", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertSucceeds(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({})));
});

// =====================================================================================
// TASK C — JOIN-CODE PROOF TEST: DENY matrix
// =====================================================================================

test("members create — DENY: unauthenticated", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({})));
});

test("members create — DENY: wrong uid document ID (writing to someone else's member doc)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-2"), validMembership({})));
});

test("members create — DENY: invalid (garbage) join code", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ joinCode: "NOTREAL" })));
});

test("members create — DENY: non-existent join code document", async () => {
  await seedUsers(); await seedActivity("g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ joinCode: "GRPJOIN1" })));
});

test("members create — DENY: join code belongs to a DIFFERENT activity", async () => {
  await seedUsers();
  await seedActivity("g1");
  await seedActivity("g2", { joinCode: "OTHERCOD" });
  await seedJoinCode("OTHERCOD", "g2");
  const d = db(studentCtx("student-1"));
  // Attempting to join g1 using a code that actually maps to g2.
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ joinCode: "OTHERCOD" })));
});

test("members create — DENY: closed activity", async () => {
  await seedUsers(); await seedActivity("g1", { status: "closed" }); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({})));
});

test("members create — DENY: group 0 (below minimum)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ group: 0 })));
});

test("members create — DENY: group > groupCount", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ group: 999 })));
});

test("members create — DENY: non-integer group", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ group: "1" })));
});

test("members create — DENY: wrong joinedAt (not server time)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ joinedAt: new Date() })));
});

test("members create — DENY: missing required field (joinCode)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  const { joinCode, ...rest } = validMembership({});
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), rest));
});

test("members create — DENY: extra unknown field", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ extraField: "x" })));
});

// =====================================================================================
// IDEMPOTENCY / IMMUTABILITY
// =====================================================================================

test("members — DENY: existing member cannot overwrite itself via a second create-shaped write (classified as update, immutable)", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = db(studentCtx("student-1"));
  await assertSucceeds(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({})));
  // Second setDoc on the same, now-existing doc is classified by Firestore as `update`, not
  // `create` — must be denied since student updates are never allowed.
  await assertFails(setDoc(doc(d, "groupActivities", "g1", "members", "student-1"), validMembership({ group: 2 })));
});

test("members — DENY: student cannot change their own group", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2 }));
});

test("members — DENY: student cannot change joinCode", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { joinCode: "HACKED" }));
});

test("members — DENY: student cannot change joinedAt", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { joinedAt: serverTimestamp() }));
});

test("members — DENY: student cannot delete their own membership", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  await assertFails(deleteDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
});

test("members — DENY: student cannot read another member's document", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-2"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  await assertFails(getDoc(doc(d, "groupActivities", "g1", "members", "student-2")));
});

test("members — ALLOW: student can read their own membership document", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(studentCtx("student-1"));
  const snap = await assertSucceeds(getDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
  assert.equal(snap.data().group, 1);
});

test("members — DENY: student cannot list members (no `list` rule declared; falls through to the catch-all deny)", async () => {
  await seedUsers(); await seedActivity("g1");
  const { collection, getDocs } = await import("firebase/firestore");
  const d = db(studentCtx("student-1"));
  await assertFails(getDocs(collection(d, "groupActivities", "g1", "members")));
});

// =====================================================================================
// TASK D — OWNER / ADMIN TESTS
// =====================================================================================

test("members — ALLOW: owner reassigns a member's group (legitimate correction)", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 3 }));
});

test("members — DENY: an unrelated teacher (not the owner) cannot reassign a member's group", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 3 }));
});

test("members — DENY: owner cannot reassign group out of bounds", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 999 }));
});

test("members — DENY: owner cannot mutate joinCode/joinedAt provenance fields even alongside a valid group change", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 2, joinCode: "CHANGED" }));
});

test("members — ALLOW: owner can delete a member (reset a mistaken join)", async () => {
  await seedUsers(); await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("teacher-a"));
  await assertSucceeds(deleteDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
});

test("members — ALLOW: admin can read, reassign, and delete any member regardless of owner", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "users", "admin-1"), { role: "admin", status: "active" });
  });
  await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = db(teacherCtx("admin-1"));
  const snap = await assertSucceeds(getDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
  assert.equal(snap.data().group, 1);
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "g1", "members", "student-1"), { group: 4 }));
  await assertSucceeds(deleteDoc(doc(d, "groupActivities", "g1", "members", "student-1")));
});

// =====================================================================================
// NEW-DEVICE / RE-ENROLLMENT
// =====================================================================================

test("members — ALLOW: a different uid (new device) can independently join the same activity with the same valid code", async () => {
  await seedUsers(); await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d1 = db(studentCtx("student-1"));
  await assertSucceeds(setDoc(doc(d1, "groupActivities", "g1", "members", "student-1"), validMembership({})));
  const d2 = db(studentCtx("student-1-device-2"));
  await assertSucceeds(setDoc(doc(d2, "groupActivities", "g1", "members", "student-1-device-2"), validMembership({})));
});
