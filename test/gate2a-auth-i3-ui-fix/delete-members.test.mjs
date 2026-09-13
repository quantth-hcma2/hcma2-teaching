// Gate 2A-AUTH-I3-UI-FIX — BUG B emulator proof. deleteGroupActivityDeep() (index.html) previously
// deleted topics/notes/photos/files + the join-code mapping + the parent activity, but omitted
// groupActivities/{id}/members/{uid}, leaving orphaned membership docs behind after a normal
// activity deletion. The fix added "members" to that same existing per-collection
// getDocs()+deleteRefsInChunks() loop — see the source-guard suite for the exact code-shape proof.
// This suite proves the underlying Firestore *behavior* is correct: the same
// getDocs()+writeBatch-delete pattern the real function uses, run here as the real owner/admin
// identity against the real candidate Rules, actually removes members (and everything else) for
// the targeted activity while leaving an unrelated activity and its own members completely
// untouched. Runs against a real local Firestore emulator loaded with the CANDIDATE rules
// (firestore.rules.production-candidate — unchanged by this gate). Never uses `firebase deploy`
// in any form.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, writeBatch, deleteDoc } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2A_AUTH_I3_UI_FIX_EMULATOR_PORT || 8195);
const PROJECT_ID = "demo-hcma2-gate2a-auth-i3-ui-fix";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); }); }

function activityFixture(overrides) {
  return {
    ownerId: "teacher-a", classId: "c1", className: "K1", title: "Deletable", instructions: "x",
    groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
    status: "closed", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    ...overrides
  };
}

async function seedFullActivity(activityId, joinCode) {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "groupActivities", activityId), activityFixture({ joinCode }));
    await setDoc(doc(d, "groupJoinCodes", joinCode), { activityId, ownerId: "teacher-a", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", activityId, "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode });
    await setDoc(doc(d, "groupActivities", activityId, "members", "student-2"), { group: 2, joinedAt: new Date(), joinCode });
    await setDoc(doc(d, "groupActivities", activityId, "topics", "1"), { group: 1, topic: "T1", updatedAt: new Date() });
    await setDoc(doc(d, "groupActivities", activityId, "topics", "2"), { group: 2, topic: "T2", updatedAt: new Date() });
    await setDoc(doc(d, "groupActivities", activityId, "notes", "n1"), { group: 1, text: "note1", participantId: "student-1", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", activityId, "photos", "p1"), { group: 1, url: "https://x/p1", storagePath: "sp1", size: 100, participantId: "student-1", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", activityId, "files", "f1"), { group: 1, url: "https://x/f1", storagePath: "sfp1", size: 100, participantId: "student-1", createdAt: new Date() });
  });
}

// Mirrors deleteRefsInChunks() in index.html exactly (400-per-batch), applied by the caller's own
// authenticated client — this is what proves Rules actually authorize the real deletion path, not
// just that the array literal contains the string "members".
async function deleteRefsInChunks(db, refs, chunkSize = 400) {
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// Mirrors deleteGroupActivityDeep() in index.html exactly, as of the GATE 2A-AUTH-I3-UI-FIX fix:
// topics/notes/photos/files/members, then the join-code mapping, then the parent — run as the
// real caller identity against the real candidate Rules.
async function deleteGroupActivityDeepAsClient(db, activityId, joinCode) {
  for (const sub of ["topics", "notes", "photos", "files", "members"]) {
    const snap = await getDocs(collection(db, "groupActivities", activityId, sub));
    await deleteRefsInChunks(db, snap.docs.map((d) => d.ref));
  }
  if (joinCode) await deleteDoc(doc(db, "groupJoinCodes", joinCode)).catch(() => {});
  await deleteDoc(doc(db, "groupActivities", activityId));
}

test("BUG B 1-8: owner deep-delete removes topics, notes, photos, files, members, join-code mapping, and the parent activity", async () => {
  await seedFullActivity("act-del", "DELJOIN1");
  const d = teacherCtx("teacher-a").firestore();
  await assertSucceeds(deleteGroupActivityDeepAsClient(d, "act-del", "DELJOIN1"));

  await seedWithRulesDisabled(async (raw) => {
    assert.equal((await getDocs(collection(raw, "groupActivities", "act-del", "topics"))).size, 0, "topics must be gone");
    assert.equal((await getDocs(collection(raw, "groupActivities", "act-del", "notes"))).size, 0, "notes must be gone");
    assert.equal((await getDocs(collection(raw, "groupActivities", "act-del", "photos"))).size, 0, "photos must be gone");
    assert.equal((await getDocs(collection(raw, "groupActivities", "act-del", "files"))).size, 0, "files must be gone");
    assert.equal((await getDocs(collection(raw, "groupActivities", "act-del", "members"))).size, 0, "members must be gone (this is the bug fix)");
    assert.equal((await getDoc(doc(raw, "groupJoinCodes", "DELJOIN1"))).exists(), false, "join-code mapping must be gone");
    assert.equal((await getDoc(doc(raw, "groupActivities", "act-del"))).exists(), false, "parent activity must be gone");
  });
});

test("BUG B 9-10: an unrelated activity and its own members are completely untouched by deleting a different activity", async () => {
  await seedFullActivity("act-del", "DELJOIN2");
  await seedFullActivity("act-keep", "KEEPJOIN1");
  const d = teacherCtx("teacher-a").firestore();
  await assertSucceeds(deleteGroupActivityDeepAsClient(d, "act-del", "DELJOIN2"));

  await seedWithRulesDisabled(async (raw) => {
    assert.equal((await getDoc(doc(raw, "groupActivities", "act-keep"))).exists(), true, "unrelated activity must still exist");
    const keepMembers = await getDocs(collection(raw, "groupActivities", "act-keep", "members"));
    assert.equal(keepMembers.size, 2, "unrelated activity's members must be untouched");
    const keepTopics = await getDocs(collection(raw, "groupActivities", "act-keep", "topics"));
    assert.equal(keepTopics.size, 2, "unrelated activity's topics must be untouched");
    assert.equal((await getDoc(doc(raw, "groupJoinCodes", "KEEPJOIN1"))).exists(), true, "unrelated activity's own join-code mapping must be untouched");
  });
});

test("REGRESSION: a non-owner teacher cannot delete another teacher's activity members (owner/admin authorization preserved)", async () => {
  await seedFullActivity("act-protected", "PROTJOIN1");
  await seedWithRulesDisabled(async (raw) => {
    await setDoc(doc(raw, "users", "teacher-b"), { role: "teacher", status: "active" });
  });
  const d = teacherCtx("teacher-b").firestore();
  // Known member ids from seedFullActivity() — a non-owner has no `list` on members at all (see
  // firestore.rules.production-candidate), so this addresses the docs directly rather than
  // querying, to isolate exactly the delete-authorization assertion this test names.
  const memberRefs = ["student-1", "student-2"].map((uid) => doc(d, "groupActivities", "act-protected", "members", uid));
  await assertFails(deleteRefsInChunks(d, memberRefs));
});
