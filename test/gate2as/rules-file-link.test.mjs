// Gate 2A-S — Firestore Rules emulator tests for the groupActivities/{id}/files/{fileId}.link
// http(s)-only scheme barrier. Runs against a real local Firestore emulator loaded with the
// CANDIDATE rules content (firestore.rules.production-candidate on branch
// gate-2a-s-group-file-link-xss, i.e. the verified production baseline PLUS only this gate's
// single added scheme check on the `link` create branch — nothing else). Never uses
// `firebase deploy` in any form. Run via `npm run test:gate2as` (starts/stops the emulator
// itself), not directly — see run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE2AS_EMULATOR_PORT || 8187);
const PROJECT_ID = "demo-hcma2-gate2as";
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
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active", email: "a@x.test" });
  });
}

const openGroupFixture = {
  ownerId: "teacher-a", classId: "class-1", className: "K77.A01", title: "Thảo luận", instructions: "Làm việc nhóm",
  groupCount: 6, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
  joinCode: "GRPJOIN1", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
};
async function seedOpenGroup(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", id), { ...openGroupFixture, ...overrides }); });
}
// GATE 2A-AUTH-I3 realignment: notes/photos/files create AND read now additionally require the
// caller to have an own membership record whose group matches — a requirement that didn't exist
// when this file was originally written (Gate 2A-S predates Gate 2A-AUTH-I1/I2/I3 entirely).
// This does not change what Gate 2A-S itself is testing (the file-link scheme barrier); it just
// satisfies the now-mandatory precondition so each test isolates the ONE thing it names, rather
// than failing on an unrelated, confounding reason.
async function seedMembership(activityId, uid, group) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "groupActivities", activityId, "members", uid), { group, joinedAt: new Date(), joinCode: openGroupFixture.joinCode }); });
}

function fileDoc(overrides) {
  return { group: 1, participantId: "student-1", createdAt: serverTimestamp(), ...overrides };
}

// =====================================================================================
// ALLOW — http(s) links, and the pre-existing url/storagePath (Storage-backed) branch
// =====================================================================================

test("files.link — ALLOW: https:// link", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertSucceeds(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({ name: "Liên kết nhóm", link: "https://example.com/doc" })));
});

test("files.link — ALLOW: http:// link", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertSucceeds(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({ name: "Liên kết nhóm", link: "http://example.com/doc" })));
});

test("files — REGRESSION ALLOW: unaffected Storage-backed url/storagePath branch still passes", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertSucceeds(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({
    name: "bai.pdf", url: "https://firebasestorage.googleapis.com/v0/b/x/o/bai.pdf", storagePath: "groupActivities/g1/files/student-1/1_bai.pdf", size: 1000, contentType: "application/pdf"
  })));
});

// =====================================================================================
// DENY — every unsafe scheme / bypass shape named in the gate's own required test matrix
// =====================================================================================

const denyLinks = {
  "javascript: scheme": "javascript:alert(1)",
  "JAVASCRIPT: scheme (case-insensitive check)": "JAVASCRIPT:alert(1)",
  "data: scheme": "data:text/html,<script>alert(1)</script>",
  "vbscript: scheme": "vbscript:msgbox(1)",
  "file: scheme": "file:///etc/passwd",
  "blob: scheme": "blob:https://example.com/9c1f-uuid",
  "protocol-relative //host": "//evil.example/path",
  "leading-whitespace-prefixed javascript:": " javascript:alert(1)",
  "embedded-newline smuggling": "https://example.com/\njavascript:alert(1)",
  "malformed non-URL string": "not a url at all"
};

for (const [label, link] of Object.entries(denyLinks)) {
  test(`files.link — DENY: ${label}`, async () => {
    await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
    const d = db(studentCtx("student-1"));
    await assertFails(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({ name: "x", link })));
  });
}

test("files.link — DENY: still rejects oversized value (>2000 chars) [pre-existing constraint, regression]", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertFails(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({ name: "x", link: "https://example.com/" + "a".repeat(2000) })));
});

test("files.link — DENY: still rejects wrong type (number) [pre-existing constraint, regression]", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertFails(addDoc(collection(d, "groupActivities", "g1", "files"), fileDoc({ name: "x", link: 12345 })));
});

// =====================================================================================
// LEGACY COMPATIBILITY — a pre-existing historical document (written before this gate,
// hypothetically bypassing the old scheme-less Rules) must remain READABLE. No migration,
// no automatic deletion/rewrite. The client-render fail-closed behavior is proven separately
// in safe-group-file-link.test.mjs against the exact same value.
// =====================================================================================

test("files — LEGACY: a historical doc with an unsafe link (seeded with Rules disabled, simulating pre-Gate-2A-S data) remains readable, is never modified or deleted by this gate", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "groupActivities", "g1", "files", "legacy-bad-1"), fileDoc({ name: "old", link: "javascript:alert(1)" }));
  });
  const d = db(studentCtx("student-1"));
  const snap = await assertSucceeds(getDoc(doc(d, "groupActivities", "g1", "files", "legacy-bad-1")));
  assert.equal(snap.data().link, "javascript:alert(1)");
});

// =====================================================================================
// GROUP REGRESSION — unrelated Group Discussion writes untouched by this gate still pass
// =====================================================================================

test("notes — REGRESSION ALLOW: unrelated Group write path untouched by this gate", async () => {
  await seedUsers(); await seedOpenGroup("g1"); await seedMembership("g1", "student-1", 1);
  const d = db(studentCtx("student-1"));
  await assertSucceeds(addDoc(collection(d, "groupActivities", "g1", "notes"), { group: 1, text: "Ý kiến của tôi", participantId: "student-1", createdAt: serverTimestamp() }));
});

test("groupActivities.instructions — REGRESSION ALLOW: owner edit of common task untouched by this gate", async () => {
  await seedUsers(); await seedOpenGroup("g1", { status: "closed" });
  const d = db(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(d, "groupActivities", "g1"), { instructions: "Nhiệm vụ mới", updatedAt: serverTimestamp() }));
});
