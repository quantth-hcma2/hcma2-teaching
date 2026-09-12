// Gate 2A-AUTH-I3 — Firestore Rules emulator tests for final Stage-3 authorization tightening:
// topics/notes/photos/files read/write now require an OPEN activity AND the caller's own
// membership.group to match — client-selected group is never trusted. Owner/admin retain
// unconditional access (including after close). Runs against a real local Firestore emulator
// loaded with the CANDIDATE rules (firestore.rules.production-candidate on branch
// gate-2a-auth-i3-final-hardening). Never uses `firebase deploy` in any form.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, setDoc, updateDoc, getDoc, getDocs, addDoc, collection, query, where, serverTimestamp
} from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2A_AUTH_I3_EMULATOR_PORT || 8194);
const PROJECT_ID = "demo-hcma2-gate2a-auth-i3";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function studentCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
function anonCtx() { return testEnv.unauthenticatedContext(); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); }); }

const baseActivity = {
  ownerId: "teacher-a", classId: "c1", className: "K1", title: "I3 Activity", instructions: "common",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "I3JOIN1", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
};

async function seedBaseline() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active" });
    await setDoc(doc(d, "groupActivities", "act1"), baseActivity);
    await setDoc(doc(d, "groupJoinCodes", "I3JOIN1"), { activityId: "act1", ownerId: "teacher-a", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "members", "student-1"), { group: 1, joinedAt: new Date(), joinCode: "I3JOIN1" });
    await setDoc(doc(d, "groupActivities", "act1", "members", "student-2"), { group: 2, joinedAt: new Date(), joinCode: "I3JOIN1" });
    await setDoc(doc(d, "groupActivities", "act1", "topics", "1"), { group: 1, topic: "T1", updatedAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "topics", "2"), { group: 2, topic: "T2", updatedAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "notes", "n1"), { group: 1, text: "note1", participantId: "student-1", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "notes", "n2"), { group: 2, text: "note2", participantId: "student-2", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "photos", "p1"), { group: 1, url: "https://x/p1", storagePath: "sp1", size: 100, participantId: "student-1", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "photos", "p2"), { group: 2, url: "https://x/p2", storagePath: "sp2", size: 100, participantId: "student-2", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "files", "f1"), { group: 1, url: "https://x/f1", storagePath: "sfp1", size: 100, participantId: "student-1", createdAt: new Date() });
    await setDoc(doc(d, "groupActivities", "act1", "files", "f2"), { group: 2, link: "https://drive.example/f2", participantId: "student-2", createdAt: new Date() });
  });
}
async function closeActivity() {
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1"), { status: "closed" }); });
}
async function reopenActivity() {
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1"), { status: "open" }); });
}

// =====================================================================================
// TOPICS
// =====================================================================================

test("TOPICS A (OPEN/own): student-1 gets topics/1", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  const snap = await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  assert.equal(snap.data().topic, "T1");
});

test("TOPICS B (OPEN/other): student-1 denied topics/2", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "2")));
});

test("TOPICS C (CLOSED/own): student-1 denied topics/1 once closed", async () => {
  await seedBaseline(); await closeActivity();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
});

test("TOPICS E/F (owner OPEN+CLOSED): owner gets and lists all topics regardless of status", async () => {
  await seedBaseline();
  const dOwnerOpen = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDoc(doc(dOwnerOpen, "groupActivities", "act1", "topics", "2")));
  await assertSucceeds(getDocs(collection(dOwnerOpen, "groupActivities", "act1", "topics")));
  await closeActivity();
  const dOwnerClosed = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDoc(doc(dOwnerClosed, "groupActivities", "act1", "topics", "1")));
  await assertSucceeds(getDocs(collection(dOwnerClosed, "groupActivities", "act1", "topics")));
});

test("TOPICS G (admin OPEN/CLOSED): admin gets any topic regardless of status", async () => {
  await seedBaseline();
  const d = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await closeActivity();
  const d2 = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDoc(doc(d2, "groupActivities", "act1", "topics", "1")));
});

test("TOPICS J (no membership): a signed-in student with no membership record is denied", async () => {
  await seedBaseline();
  const d = studentCtx("student-no-membership").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
});

test("TOPICS: unrelated teacher denied (not owner, not admin)", async () => {
  await seedBaseline();
  const d = teacherCtx("teacher-b").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
});

test("TOPICS: unauthenticated denied", async () => {
  await seedBaseline();
  const d = anonCtx().firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
});

test("TOPICS: student list is denied (owner/admin-only; students only ever get a single doc)", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDocs(collection(d, "groupActivities", "act1", "topics")));
});

// =====================================================================================
// NOTES
// =====================================================================================

test("NOTES A (OPEN/own): student-1 reads note in group 1 (get + scoped query)", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "notes", "n1")));
  const snap = await assertSucceeds(getDocs(query(collection(d, "groupActivities", "act1", "notes"), where("group", "==", 1))));
  assert.equal(snap.size, 1);
});

test("NOTES B (OPEN/other): student-1 denied note in group 2, and denied a group==2 query", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "notes", "n2")));
  await assertFails(getDocs(query(collection(d, "groupActivities", "act1", "notes"), where("group", "==", 2))));
});

test("NOTES M (broad query denied): an unfiltered notes query is denied for a student", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDocs(collection(d, "groupActivities", "act1", "notes")));
});

test("NOTES C (CLOSED/own): student-1 denied their own group's notes once closed", async () => {
  await seedBaseline(); await closeActivity();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "notes", "n1")));
  await assertFails(getDocs(query(collection(d, "groupActivities", "act1", "notes"), where("group", "==", 1))));
});

test("NOTES E/F (owner OPEN+CLOSED): owner reads all notes, unfiltered, regardless of status", async () => {
  await seedBaseline();
  const dOpen = teacherCtx("teacher-a").firestore();
  const snapOpen = await assertSucceeds(getDocs(collection(dOpen, "groupActivities", "act1", "notes")));
  assert.equal(snapOpen.size, 2);
  await closeActivity();
  const dClosed = teacherCtx("teacher-a").firestore();
  const snapClosed = await assertSucceeds(getDocs(collection(dClosed, "groupActivities", "act1", "notes")));
  assert.equal(snapClosed.size, 2);
});

test("NOTES G (admin OPEN/CLOSED): admin reads all notes regardless of status", async () => {
  await seedBaseline();
  const d = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDocs(collection(d, "groupActivities", "act1", "notes")));
  await closeActivity();
  const d2 = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDocs(collection(d2, "groupActivities", "act1", "notes")));
});

test("NOTES: create — student-1 (group 1) can submit a note tagged group 1", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "hello", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("NOTES: create — student-1 CANNOT submit a note tagged group 2 (membership mismatch, client-selected group not trusted)", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 2, text: "hello", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("NOTES: create — denied once activity is closed, even for the student's own group", async () => {
  await seedBaseline(); await closeActivity();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "hello", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("NOTES O (allowText false): create denied even for a matching own-group submission", async () => {
  await seedBaseline();
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1"), { allowText: false }); });
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "hello", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("NOTES: create denied with no membership record at all", async () => {
  await seedBaseline();
  const d = studentCtx("student-no-membership").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "hello", participantId: "student-no-membership", createdAt: serverTimestamp() }));
});

test("NOTES K (cross-student participantId spoof): student-1 cannot submit a note claiming to be student-2", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "hello", participantId: "student-2", createdAt: serverTimestamp() }));
});

// =====================================================================================
// PHOTOS
// =====================================================================================

test("PHOTOS A/B (OPEN own vs other): student-1 reads own group's photo, denied the other group's", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "photos", "p1")));
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "photos", "p2")));
});

test("PHOTOS C (CLOSED/own): denied once closed", async () => {
  await seedBaseline(); await closeActivity();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "photos", "p1")));
});

test("PHOTOS E/F/G (owner+admin OPEN/CLOSED): unrestricted regardless of status", async () => {
  await seedBaseline();
  const dOwner = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDocs(collection(dOwner, "groupActivities", "act1", "photos")));
  await closeActivity();
  const dOwner2 = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDocs(collection(dOwner2, "groupActivities", "act1", "photos")));
  const dAdmin = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDocs(collection(dAdmin, "groupActivities", "act1", "photos")));
});

test("PHOTOS: create — student-1 can submit a Storage-shaped photo tagged own group", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(addDoc(collection(d, "groupActivities", "act1", "photos"), { group: 1, url: "https://x/new", storagePath: "sp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

test("PHOTOS: create — student-1 cannot submit a photo tagged group 2", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "photos"), { group: 2, url: "https://x/new", storagePath: "sp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

test("PHOTOS P (allowPhoto false): create denied even for a matching own-group submission", async () => {
  await seedBaseline();
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1"), { allowPhoto: false }); });
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "photos"), { group: 1, url: "https://x/new", storagePath: "sp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

// =====================================================================================
// FILES + LINKS (Gate 2A-S preservation)
// =====================================================================================

test("FILES A/B (OPEN own vs other): student-1 reads own group's file, denied the other group's", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "files", "f1")));
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "files", "f2")));
});

test("FILES C (CLOSED/own): denied once closed", async () => {
  await seedBaseline(); await closeActivity();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "files", "f1")));
});

test("FILES E/F/G (owner+admin OPEN/CLOSED): unrestricted regardless of status", async () => {
  await seedBaseline();
  const dOwner = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDocs(collection(dOwner, "groupActivities", "act1", "files")));
  await closeActivity();
  const dOwner2 = teacherCtx("teacher-a").firestore();
  await assertSucceeds(getDocs(collection(dOwner2, "groupActivities", "act1", "files")));
  const dAdmin = teacherCtx("admin-1").firestore();
  await assertSucceeds(getDocs(collection(dAdmin, "groupActivities", "act1", "files")));
});

test("FILES: create — student-1 can submit a Storage-shaped file tagged own group", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 1, url: "https://x/newf", storagePath: "sfp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

test("FILES: create — student-1 cannot submit a file tagged group 2", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 2, url: "https://x/newf", storagePath: "sfp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

test("FILES Q (allowFile false): create denied even for a matching own-group submission", async () => {
  await seedBaseline();
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1"), { allowFile: false }); });
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 1, url: "https://x/newf", storagePath: "sfp-new", size: 500, participantId: "student-1", createdAt: serverTimestamp() }));
});

test("FILES R (malicious link still denied): javascript: link scheme is still rejected for a valid own-group, allowFile=true submission", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 1, link: "javascript:alert(1)", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("FILES S (valid http/https link preserved): an https link is accepted for a valid own-group submission", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 1, link: "https://drive.example/doc", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("FILES: a valid-scheme link tagged the WRONG group is still denied (membership check applies independently of the XSS check)", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "files"), { group: 2, link: "https://drive.example/doc", participantId: "student-1", createdAt: serverTimestamp() }));
});

// =====================================================================================
// REOPEN (I)
// =====================================================================================

test("REOPEN: OPEN -> CLOSED -> OPEN preserves existing membership and restores own-group access, without recreating membership", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await closeActivity();
  const d2 = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d2, "groupActivities", "act1", "topics", "1")));
  await reopenActivity();
  const d3 = studentCtx("student-1").firestore();
  const snap = await assertSucceeds(getDoc(doc(d3, "groupActivities", "act1", "members", "student-1")));
  assert.equal(snap.data().group, 1, "membership must be untouched by the close/reopen cycle");
  await assertSucceeds(getDoc(doc(d3, "groupActivities", "act1", "topics", "1")));
});

// =====================================================================================
// MEMBERSHIP CORRECTION 1 -> 2 (H)
// =====================================================================================

test("CORRECTION: after owner reassigns student-1 from group 1 to group 2, group-1 reads are denied and group-2 reads/writes are allowed", async () => {
  await seedBaseline();
  await seedWithRulesDisabled(async (d) => { await updateDoc(doc(d, "groupActivities", "act1", "members", "student-1"), { group: 2 }); });
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "topics", "2")));
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "x", participantId: "student-1", createdAt: serverTimestamp() }));
  await assertSucceeds(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 2, text: "x", participantId: "student-1", createdAt: serverTimestamp() }));
});

// =====================================================================================
// LEGACY OPEN BOOTSTRAP (J) — no membership yet
// =====================================================================================

test("LEGACY BOOTSTRAP: a brand-new student with no membership yet has no group-child access before joining, then gains own-group access after a valid join", async () => {
  await seedBaseline();
  const d = studentCtx("student-new").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await assertFails(getDocs(collection(d, "groupActivities", "act1", "notes")));
  // Valid join under existing AUTH-I1 conditions:
  await assertSucceeds(setDoc(doc(d, "groupActivities", "act1", "members", "student-new"), { group: 3, joinedAt: serverTimestamp(), joinCode: "I3JOIN1" }));
  const d2 = studentCtx("student-new").firestore();
  await assertFails(getDoc(doc(d2, "groupActivities", "act1", "topics", "1")), "still denied group 1 — only their own group 3");
});

// =====================================================================================
// CROSS-USER / UNAUTHENTICATED (K)
// =====================================================================================

test("CROSS-USER: student-1 cannot get or list student-2's membership document", async () => {
  await seedBaseline();
  const d = studentCtx("student-1").firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "members", "student-2")));
  await assertFails(getDocs(collection(d, "groupActivities", "act1", "members")));
});

test("UNAUTHENTICATED: denied read and write on notes/photos/files/topics", async () => {
  await seedBaseline();
  const d = anonCtx().firestore();
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "notes", "n1")));
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "photos", "p1")));
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "files", "f1")));
  await assertFails(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await assertFails(addDoc(collection(d, "groupActivities", "act1", "notes"), { group: 1, text: "x", participantId: "nobody", createdAt: serverTimestamp() }));
});

// =====================================================================================
// OWNER/ADMIN REGRESSION (do not accidentally require them to have a membership)
// =====================================================================================

test("OWNER/ADMIN REGRESSION: owner has no membership record at all yet still reads everything, corrects membership, and lists memberships", async () => {
  await seedBaseline();
  const d = teacherCtx("teacher-a").firestore();
  const memberSnap = await getDoc(doc(d, "groupActivities", "act1", "members", "teacher-a"));
  assert.equal(memberSnap.exists(), false, "owner deliberately has no membership doc of their own");
  await assertSucceeds(getDoc(doc(d, "groupActivities", "act1", "topics", "1")));
  await assertSucceeds(getDocs(collection(d, "groupActivities", "act1", "members")));
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "act1", "members", "student-1"), { group: 3 }));
});
