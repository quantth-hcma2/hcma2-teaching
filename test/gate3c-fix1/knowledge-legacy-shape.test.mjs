// GATE 3C-FIX-CANDIDATE — permanent regression suite for the Knowledge legacy
// minimumPerParticipant Rules fix. Real local Firestore emulator, the actual candidate Rules
// content, never `firebase deploy`, never production contact of any kind.
//
// Root cause (GATE 3A-AUDIT, proven): the legacy (non-contract-activated) teacher and admin
// knowledgeSessions update branches compared request.resource.data.minimumPerParticipant ==
// resource.data.minimumPerParticipant directly, which throws a CEL evaluation error (and denies
// the whole write) when the field is missing from a historical/legacy document — blocking BOTH
// trash and restore, not just restore.
//
// Fix (GATE 3B-FIX-DESIGN, implemented here): the teacher branch's existing
// diff(resource.data).affectedKeys().hasOnly([...]) positive allowlist already excludes
// minimumPerParticipant, so it already fully protects the field's immutability without ever
// dereferencing it — the buggy direct-equality line was simply redundant and removed. The admin
// branch had no equivalent positive allowlist, so minimumPerParticipant was added to its existing
// diff(resource.data).affectedKeys().hasAny([...]) blocklist (the same idiom already used there
// for analysisFence/analysisLease/adminDeleting/deletingAt/deleteRunId), and its own redundant
// direct-equality line was removed the same way.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const PORT = Number(process.env.GATE3C_EMULATOR_PORT || 8211);
const PROJECT_ID = "demo-hcma2-gate3c";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function authedCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
function anonCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "teacher-b"), { role: "teacher", status: "active" });
    await setDoc(doc(d, "users", "admin-1"), { role: "admin", status: "active" });
  });
}

// Exact shape of legacyKnowledgeFixture() in test/gate1b2b/contract-writer.test.mjs — kept in
// sync deliberately so both suites agree on what "modern/full" means for this collection.
const fullFixture = () => ({
  ownerId: "teacher-a", title: "Phien Knowledge", joinCode: "ABC123", status: "closed",
  minimumPerParticipant: 3, targetSubmissions: 100, createdAt: new Date(), updatedAt: new Date(),
  collectParticipantProfile: true,
  participantFields: { fullName: { enabled: true, required: true }, className: { enabled: true, required: true } },
  classOptions: ["K77.A01"]
});

async function seedKnowledge(id, omit = [], overrides = {}) {
  await seedWithRulesDisabled(async (d) => {
    const fx = fullFixture();
    for (const k of omit) delete fx[k];
    await setDoc(doc(d, "knowledgeSessions", id), { ...fx, ...overrides });
  });
}

// ===================================================================================
// COMPATIBILITY — fixtures A-D, teacher and admin, trash then restore must both succeed
// ===================================================================================

const FIXTURES = {
  A: { label: "A: full/modern document", omit: [] },
  B: { label: "B: missing minimumPerParticipant", omit: ["minimumPerParticipant"] },
  C: { label: "C: missing collectParticipantProfile+participantFields+classOptions", omit: ["collectParticipantProfile", "participantFields", "classOptions"] },
  D: { label: "D: missing minimumPerParticipant + those 3 profile fields", omit: ["minimumPerParticipant", "collectParticipantProfile", "participantFields", "classOptions"] }
};

for (const [key, fx] of Object.entries(FIXTURES)) {
  test(`compatibility [${fx.label}] — TEACHER trash then restore both succeed`, async () => {
    await seedUsers();
    await seedKnowledge("k1", fx.omit);
    const t = db(authedCtx("teacher-a"));
    await assertSucceeds(updateDoc(doc(t, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "teacher-a", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(t, "knowledgeSessions", "k1"), { teacherDeletedAt: null, teacherDeletedBy: null, updatedAt: serverTimestamp() }));
  });

  test(`compatibility [${fx.label}] — ADMIN trash then restore both succeed`, async () => {
    await seedUsers();
    await seedKnowledge("k1", fx.omit);
    const a = db(authedCtx("admin-1"));
    await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { status: "closed", adminDeletedAt: serverTimestamp(), adminDeletedBy: "admin-1", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(a, "knowledgeSessions", "k1"), { adminDeletedAt: null, adminDeletedBy: null, updatedAt: serverTimestamp() }));
  });
}

// ===================================================================================
// SECURITY-NEGATIVE — immutability must not be weakened by the fix
// ===================================================================================

test("security: TEACHER changing minimumPerParticipant value during an otherwise-legal update -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1");
  const t = db(authedCtx("teacher-a"));
  await assertFails(updateDoc(doc(t, "knowledgeSessions", "k1"), { minimumPerParticipant: 7, title: "Sua", updatedAt: serverTimestamp() }));
});

test("security: ADMIN changing minimumPerParticipant value -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1");
  const a = db(authedCtx("admin-1"));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { minimumPerParticipant: 7, status: "closed", updatedAt: serverTimestamp() }));
});

test("security: TEACHER removing minimumPerParticipant from a modern document -> DENY", async () => {
  // updateDoc can't literally delete a field without deleteField(), but a client reconstructing
  // the whole document (e.g. a buggy full-object write) and omitting it is exactly the shape
  // this proves against: the merged request.resource.data must not end up missing the field.
  const { deleteField } = await import("firebase/firestore");
  await seedUsers(); await seedKnowledge("k1");
  const t = db(authedCtx("teacher-a"));
  await assertFails(updateDoc(doc(t, "knowledgeSessions", "k1"), { minimumPerParticipant: deleteField(), title: "Sua", updatedAt: serverTimestamp() }));
});

test("security: ADMIN removing minimumPerParticipant from a modern document -> DENY", async () => {
  const { deleteField } = await import("firebase/firestore");
  await seedUsers(); await seedKnowledge("k1");
  const a = db(authedCtx("admin-1"));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { minimumPerParticipant: deleteField(), status: "closed", updatedAt: serverTimestamp() }));
});

test("security: TEACHER injecting minimumPerParticipant into a legacy document during an otherwise-authorized trash -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1", ["minimumPerParticipant"]);
  const t = db(authedCtx("teacher-a"));
  await assertFails(updateDoc(doc(t, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "teacher-a", minimumPerParticipant: 5, updatedAt: serverTimestamp() }));
});

test("security: ADMIN injecting minimumPerParticipant into a legacy document during an otherwise-authorized trash -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1", ["minimumPerParticipant"]);
  const a = db(authedCtx("admin-1"));
  await assertFails(updateDoc(doc(a, "knowledgeSessions", "k1"), { status: "closed", adminDeletedAt: serverTimestamp(), adminDeletedBy: "admin-1", minimumPerParticipant: 5, updatedAt: serverTimestamp() }));
});

test("security: non-owner teacher cannot trash or restore another teacher's session -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1");
  const b = db(authedCtx("teacher-b"));
  await assertFails(updateDoc(doc(b, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "teacher-b", updatedAt: serverTimestamp() }));
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "knowledgeSessions", "k2"), { ...fullFixture(), teacherDeletedAt: new Date(), teacherDeletedBy: "teacher-a" }); });
  await assertFails(updateDoc(doc(b, "knowledgeSessions", "k2"), { teacherDeletedAt: null, teacherDeletedBy: null, updatedAt: serverTimestamp() }));
});

test("security: anonymous/student cannot trash or restore -> DENY", async () => {
  await seedUsers(); await seedKnowledge("k1", [], { status: "open" });
  const anon = db(anonCtx("student-1"));
  await assertFails(updateDoc(doc(anon, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "student-1", updatedAt: serverTimestamp() }));
});

// ===================================================================================
// CONTRACT-ACTIVATED REGRESSION PIN — unaffected by this fix, still correct
// ===================================================================================

test("contract-activated: trash/restore still succeed, minimumPerParticipant mutation still DENIED (branch untouched by this fix)", async () => {
  await seedUsers(); await seedKnowledge("k1");
  const { activateContract } = await import("../../contract-writer.mjs");
  const t = db(authedCtx("teacher-a"));
  await activateContract({ db: t, firestore: await import("firebase/firestore"), family: "knowledgeSessions", sessionId: "k1", actorUid: "teacher-a", operationId: "op-1" });

  await assertSucceeds(updateDoc(doc(t, "knowledgeSessions", "k1"), { status: "closed", teacherDeletedAt: serverTimestamp(), teacherDeletedBy: "teacher-a", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(t, "knowledgeSessions", "k1"), { teacherDeletedAt: null, teacherDeletedBy: null, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(t, "knowledgeSessions", "k1"), { minimumPerParticipant: 9, updatedAt: serverTimestamp() }));
});
