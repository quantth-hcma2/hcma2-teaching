// Runs against a real local Firestore emulator loaded with the ACTUAL currently-deployed
// production Rules file (firestore.rules.production-candidate, sha256 verified in the
// implementation report — never a stale/guessed local firestore.rules). This file is not
// modified by Gate 1B.1; it is only read here.
//
// Covers: (a) Gate 1A regression — owner/foreign-teacher/admin/anonymous/suspended-teacher
// permissions on the three session collections, unaffected by anything in this gate; (b) the
// new Gate 1B.1 reader/UI layer wired against a real, Rules-enforced Firestore client.
//
// Run via `npm run test:emulator` (starts/stops the emulator itself), not directly — see
// run-emulator-tests.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { makeFirestoreDbFacade } from "../../session-reader.mjs";
import { loadSessionRootForTeacher, ReaderUiError } from "../../session-reader-ui.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "../../firestore.rules.production-candidate");
const PORT = Number(process.env.GATE1B1_EMULATOR_PORT || 8177);
const PROJECT_ID = "demo-hcma2-gate1b1";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT }
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

function firestoreModuleFor(ctx) {
  // ctx.firestore() already returns a modular-SDK Firestore instance for this rules-unit-
  // testing version; the {doc,getDoc,...} functions imported above operate on it directly.
  return ctx.firestore();
}

async function seedWithRulesDisabled(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(firestoreModuleFor(ctx));
  });
}

function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function adminCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function anonCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "users", "teacher-a"), { role: "teacher", status: "active", email: "a@x.test" });
    await setDoc(doc(db, "users", "teacher-b"), { role: "teacher", status: "active", email: "b@x.test" });
    await setDoc(doc(db, "users", "teacher-suspended"), { role: "teacher", status: "suspended", email: "s@x.test" });
    await setDoc(doc(db, "users", "admin-1"), { role: "admin", status: "active", email: "admin@x.test" });
  });
}

// ---------------------------------------------------------------------------
// Gate 1A regression: same permission shape Gate 1A's openSessionInfoEditor relies on.
// ---------------------------------------------------------------------------

test("Gate 1A regression — sessions: owner can update title, foreign teacher/anonymous/suspended cannot, admin can", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "sessions", "s1"), { ownerId: "teacher-a", title: "Cũ", status: "open", createdAt: new Date() });
    await setDoc(doc(db, "sessions", "s-suspended"), { ownerId: "teacher-suspended", title: "Cũ", status: "open", createdAt: new Date() });
  });

  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "sessions", "s1"), { title: "Mới", updatedAt: serverTimestamp() }));

  const b = firestoreModuleFor(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "sessions", "s1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));

  const anon = firestoreModuleFor(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "sessions", "s1"), { title: "Học viên sửa", updatedAt: serverTimestamp() }));

  const admin = firestoreModuleFor(adminCtx("admin-1"));
  await assertSucceeds(updateDoc(doc(admin, "sessions", "s1"), { title: "Admin sửa", updatedAt: serverTimestamp() }));

  const suspended = firestoreModuleFor(teacherCtx("teacher-suspended"));
  await assertFails(updateDoc(doc(suspended, "sessions", "s-suspended"), { title: "Tự sửa khi bị khóa", updatedAt: serverTimestamp() }));
});

test("Gate 1A regression — sessions: create still works for an active teacher only", async () => {
  await seedUsers();
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  await assertSucceeds(setDoc(doc(a, "sessions", "new-s1"), { ownerId: "teacher-a", title: "Phiên mới", status: "draft", createdAt: serverTimestamp() }));

  const suspended = firestoreModuleFor(teacherCtx("teacher-suspended"));
  await assertFails(setDoc(doc(suspended, "sessions", "new-s2"), { ownerId: "teacher-suspended", title: "X", status: "draft", createdAt: serverTimestamp() }));
});

test("Gate 1A regression — groupActivities: owner can update, foreign teacher cannot", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "groupActivities", "g1"), { ownerId: "teacher-a", title: "Cũ", instructions: "", groupCount: 3, status: "draft" });
  });
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "groupActivities", "g1"), { title: "Mới", updatedAt: serverTimestamp() }));
  const b = firestoreModuleFor(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "groupActivities", "g1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));
});

test("Gate 1A regression — knowledgeSessions: owner can update title/targetSubmissions, foreign teacher and anonymous cannot", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "knowledgeSessions", "k1"), {
      ownerId: "teacher-a", title: "Cũ", joinCode: "ABC123", status: "open",
      minimumPerParticipant: 3, targetSubmissions: 1500, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { title: "Mới", targetSubmissions: 20, updatedAt: serverTimestamp() }));

  const b = firestoreModuleFor(teacherCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "knowledgeSessions", "k1"), { title: "Chiếm quyền", updatedAt: serverTimestamp() }));

  const anon = firestoreModuleFor(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "knowledgeSessions", "k1"), { title: "Học viên sửa", updatedAt: serverTimestamp() }));
});

// ---------------------------------------------------------------------------
// Section 9 verification: the currently-deployed Rules already block a client from adding
// contract-marker fields through the existing update path — Gate 1B.1 needs no Rules change
// for this to be true, it is just verified here.
// ---------------------------------------------------------------------------

test("currently-deployed Rules already reject adding editContractVersion via the existing knowledgeSessions update path", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "knowledgeSessions", "k1"), {
      ownerId: "teacher-a", title: "Cũ", joinCode: "ABC123", status: "open",
      minimumPerParticipant: 3, targetSubmissions: 1500, createdAt: new Date(), updatedAt: new Date()
    });
  });
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), {
    title: "Mới", editContractVersion: 1, currentConfigId: "cfg1", updatedAt: serverTimestamp()
  }));
});

// ---------------------------------------------------------------------------
// Gate 1B.1 reader/UI layer, exercised against the real Rules-enforced emulator.
// ---------------------------------------------------------------------------

test("loadSessionRootForTeacher succeeds for the real owner against a real Firestore client", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "sessions", "s1"), { ownerId: "teacher-a", title: "Phiên A", status: "open" });
  });
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  const facade = makeFirestoreDbFacade(a, await import("firebase/firestore"));
  const root = await loadSessionRootForTeacher(facade, "sessions", "s1", { uid: "teacher-a", role: "teacher", status: "active" });
  assert.equal(root.isContract, false);
  assert.equal(root.sessionData.title, "Phiên A");
});

test("loadSessionRootForTeacher fails closed (Rules permission-denied surfaces as ReaderUiError) for a foreign teacher", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "sessions", "s1"), { ownerId: "teacher-a", title: "Phiên A", status: "draft" });
  });
  const b = firestoreModuleFor(teacherCtx("teacher-b"));
  const facade = makeFirestoreDbFacade(b, await import("firebase/firestore"));
  await assert.rejects(
    () => loadSessionRootForTeacher(facade, "sessions", "s1", { uid: "teacher-b", role: "teacher", status: "active" }),
    (err) => { assert.ok(err instanceof ReaderUiError); return true; }
  );
});

test("loadSessionRootForTeacher detects a real configRevision race and fails closed with STALE_CONFIG_REVISION", async () => {
  await seedUsers();
  await seedWithRulesDisabled(async (db) => {
    await setDoc(doc(db, "knowledgeSessions", "k1"), { ownerId: "teacher-a", title: "Phiên K", status: "open", configRevision: 1 });
  });
  const a = firestoreModuleFor(teacherCtx("teacher-a"));
  const real = await import("firebase/firestore");
  const facade = makeFirestoreDbFacade(a, real);
  let calls = 0;
  const racingFacade = {
    ...facade,
    async getDoc(p) {
      calls++;
      if (calls === 2) {
        // Simulate a concurrent edit landing between this function's own two internal reads.
        await seedWithRulesDisabled(async (db2) => {
          await setDoc(doc(db2, "knowledgeSessions", "k1"), { ownerId: "teacher-a", title: "Phiên K", status: "open", configRevision: 2 });
        });
      }
      return facade.getDoc(p);
    }
  };
  await assert.rejects(
    () => loadSessionRootForTeacher(racingFacade, "knowledgeSessions", "k1", { uid: "teacher-a", role: "teacher", status: "active" }),
    (err) => { assert.ok(err instanceof ReaderUiError); assert.equal(err.code, "STALE_CONFIG_REVISION"); return true; }
  );
  assert.equal(calls, 2);
});
