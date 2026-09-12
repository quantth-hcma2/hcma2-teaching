// Gate 2A-AUTH-I2 — emulator tests for group-membership.mjs's ensureGroupMembership() and
// validStoredGroup(), the EXACT functions index.html imports and calls (not a reimplementation).
// Runs against a real local Firestore emulator loaded with the AUTH-I1 candidate rules (already
// deployed to production — frozen, unchanged in this gate; see rules-hash-unchanged.test.mjs).
// Never uses `firebase deploy` in any form. Run via `npm run test:gate2a-auth-i2` (starts/stops
// the emulator itself), not directly — see run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ensureGroupMembership, validStoredGroup, GroupMembershipError } from "../../group-membership.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2A_AUTH_I2_EMULATOR_PORT || 8191);
const PROJECT_ID = "demo-hcma2-gate2a-auth-i2";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

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
async function seedJoinCode(code, activityId) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupJoinCodes", code), { activityId, ownerId: "teacher-a", createdAt: new Date() }); });
}

// The EXACT facade shape index.html constructs (groupMembershipFirestore in index.html) —
// mirrors the real call site, not the whole SDK namespace (same discipline as Gate E6).
const realFacade = () => ({ doc, getDoc, setDoc, serverTimestamp });

// =====================================================================================
// NEW MEMBER
// =====================================================================================

test("NEW MEMBER: valid join creates membership and returns the selected group", async () => {
  await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = studentCtx("student-1").firestore();
  const result = await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 3 });
  assert.equal(result, 3);
  const snap = await getDoc(doc(d, "groupActivities", "g1", "members", "student-1"));
  assert.equal(snap.data().group, 3);
  assert.equal(snap.data().joinCode, "GRPJOIN1");
});

test("NEW MEMBER: membership is created exactly once — a second bootstrap call with a different selection does not overwrite it", async () => {
  await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = studentCtx("student-1").firestore();
  await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 3 });
  const second = await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 5 });
  assert.equal(second, 3, "the second call must return the ORIGINAL stored group, never the newly-passed selection");
});

test("NEW MEMBER: fails closed when membership is absent and the activity is closed (Rules deny the create)", async () => {
  await seedActivity("g1", { status: "closed" }); await seedJoinCode("GRPJOIN1", "g1");
  const d = studentCtx("student-1").firestore();
  await assert.rejects(ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 3 }));
  const snap = await getDoc(doc(d, "groupActivities", "g1", "members", "student-1"));
  assert.equal(snap.exists(), false, "no membership document may be left behind by a failed attempt");
});

test("NEW MEMBER: fails closed with an invalid join code", async () => {
  await seedActivity("g1");
  const d = studentCtx("student-1").firestore();
  await assert.rejects(ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "BADCODE!", groupCount: 6, selectedGroup: 3 }));
});

// =====================================================================================
// RETURNING MEMBER
// =====================================================================================

test("RETURNING MEMBER: existing membership causes no write and the stored group wins", async () => {
  await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 2, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = studentCtx("student-1").firestore();
  const result = await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 3 });
  assert.equal(result, 2, "a newly-passed selectedGroup must NEVER override an existing stored membership");
});

test("RETURNING MEMBER: a different newly-selected group cannot override the stored one, even across separate calls", async () => {
  await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = studentCtx("student-1").firestore();
  const first = await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 1 });
  for (const attempt of [2, 3, 4, 5, 6]) {
    const result = await ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: attempt });
    assert.equal(result, first);
  }
});

// =====================================================================================
// RACE
// =====================================================================================

test("RACE: a create conflict (membership appears between getDoc and write) recovers safely via a single re-read, no blind retry", async () => {
  await seedActivity("g1"); await seedJoinCode("GRPJOIN1", "g1");
  const d = studentCtx("student-1").firestore();
  // Simulate a second tab/device winning the race: seed the membership directly (bypassing
  // this call's own getDoc), so THIS call's setDoc attempt is the one that gets rejected.
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 4, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  // A facade whose getDoc always reports "not found" the first time (forcing the create path
  // to be attempted, exactly reproducing the getDoc-then-someone-else-wins-then-write-fails race)
  // but whose retry re-read sees the real, already-seeded document.
  let getDocCalls = 0;
  const racingFacade = {
    doc, setDoc, serverTimestamp,
    getDoc: async (ref) => {
      getDocCalls++;
      if (getDocCalls === 1) return { exists: () => false };
      return getDoc(ref);
    }
  };
  const result = await ensureGroupMembership({ db: d, firestore: racingFacade, activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 1 });
  assert.equal(result, 4, "must recover the ACTUAL stored group (the race winner's), not the local selection");
  assert.equal(getDocCalls, 2, "exactly one initial getDoc plus exactly one recovery re-read — no additional blind retries");
});

// =====================================================================================
// FAIL CLOSED
// =====================================================================================

test("FAIL CLOSED: malformed stored membership (non-integer group) throws GroupMembershipError", () => {
  assert.throws(() => validStoredGroup({ group: "not-a-number" }, 6), GroupMembershipError);
});

test("FAIL CLOSED: out-of-range stored group (0) throws", () => {
  assert.throws(() => validStoredGroup({ group: 0 }, 6), GroupMembershipError);
});

test("FAIL CLOSED: out-of-range stored group (> groupCount) throws", () => {
  assert.throws(() => validStoredGroup({ group: 7 }, 6), GroupMembershipError);
});

test("FAIL CLOSED: an existing-but-malformed membership record causes ensureGroupMembership itself to throw, not silently create a second one", async () => {
  await seedActivity("g1");
  await seedWithRulesDisabled(async (d2) => {
    await setDoc(doc(d2, "groupActivities", "g1", "members", "student-1"), { group: 999, joinedAt: new Date(), joinCode: "GRPJOIN1" });
  });
  const d = studentCtx("student-1").firestore();
  await assert.rejects(
    ensureGroupMembership({ db: d, firestore: realFacade(), activityId: "g1", uid: "student-1", joinCode: "GRPJOIN1", groupCount: 6, selectedGroup: 1 }),
    GroupMembershipError
  );
});
