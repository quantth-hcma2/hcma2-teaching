// Gate E6 — activation Firestore facade hotfix regression tests. Real local Firestore emulator
// loaded with the frozen, UNCHANGED Gate 1B.3-C1X Rules candidate (sha256
// 196d502ed2544d036c622d4f83633f1cf5941d866dfdf212acdc8589d232d4d0) — E6 never modifies Rules.
//
// This suite closes the exact gap Gate E5 diagnosed: Gate E2's own test suite exercised
// activateSessionExplicit()/activateContract() with the ENTIRE `firebase/firestore` module as
// the `firestore` facade (import * as firestoreFns), which never reproduces the narrower object
// literal index.html's real DOM wiring actually constructs by hand. Every test below builds the
// facade the SAME way index.html does — a plain object literal of named imports — never the
// whole module namespace.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, collection, runTransaction, serverTimestamp } from "firebase/firestore";
import { activateSessionExplicit, ContractActivationError } from "../../contract-activation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const PORT = Number(process.env.GATE_E6_EMULATOR_PORT || 8186);
const PROJECT_ID = "demo-hcma2-gate-e6";
const rulesSource = readFileSync(rulesPath, "utf8");

let testEnv;
test.before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
});
test.after(async () => { if (testEnv) await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

function db(ctx) { return ctx.firestore(); }
function teacherCtx(uid) { return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }); }
async function seedWithRulesDisabled(fn) { await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(db(ctx)); }); }

async function seedUsers() {
  await seedWithRulesDisabled(async (d) => {
    await setDoc(doc(d, "users", "teacher-a"), { role: "teacher", status: "active" });
  });
}
const legacySessionFixture = (overrides) => ({
  ownerId: "teacher-a", classId: "c1", className: "K77.A01", title: "Cũ", description: "Mô tả cũ",
  status: "closed", accessToken: "tok-xxxxxxxxxxxxxxxxxxxxxxxxxxx", shortCode: "ABC123",
  showResults: "hidden", allowMultipleResponses: false, anonymous: true, showResponderCount: true,
  startedAt: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(),
  questionCount: 1, responseCount: 0, activeQuestionId: null, activeQuestionStartedAt: null,
  sessionGroupId: null, roundNumber: 1, ...overrides
});
async function seedSession(id, overrides) {
  await seedWithRulesDisabled(async (d) => { await setDoc(doc(d, "sessions", id), legacySessionFixture(overrides)); });
}

// The EXACT object literal index.html now constructs by hand for the activation call site —
// built from individually-named imports, never `import * as` the whole module. This is what
// makes the difference from Gate E2's tests, which used the full module namespace and therefore
// never noticed the real wiring was short two required functions.
function realActivationFacade() {
  return { doc, getDoc, collection, runTransaction, serverTimestamp };
}

// =====================================================================================
// 1. THE REAL FACADE'S SHAPE
// =====================================================================================

test("REQUIRED FUNCTIONS PRESENT: the real activation facade exposes doc/getDoc/collection/runTransaction/serverTimestamp, all functions", () => {
  const facade = realActivationFacade();
  for (const key of ["doc", "getDoc", "collection", "runTransaction", "serverTimestamp"]) {
    assert.equal(typeof facade[key], "function", `facade.${key} must be a function`);
  }
});

// =====================================================================================
// 2. THE REAL FACADE ACTUALLY WORKS END TO END
// =====================================================================================

test("PASS: explicit activation through the EXACT real-wiring facade reaches and completes activateContract()", async () => {
  await seedUsers();
  await seedSession("s1");
  // ctx.firestore() must be captured exactly once and reused — calling it repeatedly returns
  // instances that conflict on settings ("Firestore has already been started...").
  const firestoreDb = db(teacherCtx("teacher-a"));
  const result = await activateSessionExplicit({
    db: firestoreDb, firestore: realActivationFacade(), sessionId: "s1",
    actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1"
  });
  assert.equal(result.replay, false);
  assert.equal(result.resultingRevision, 0);

  const root = (await getDoc(doc(firestoreDb, "sessions", "s1"))).data();
  assert.equal(root.editContractVersion, 1);
  assert.equal(root.configRevision, 0);
  assert.equal(root.currentConfigId, result.resultingConfigId);
  assert.equal(root.lastOperationId, "op-1");
  assert.ok(root.contractActivatedAt);

  const cfgDoc = (await getDoc(doc(firestoreDb, "sessions", "s1", "configVersions", result.resultingConfigId))).data();
  assert.equal(cfgDoc.kind, "activation_baseline");
  const historyDoc = (await getDoc(doc(firestoreDb, "sessions", "s1", "editHistory", "op-1"))).data();
  assert.equal(historyDoc.operationType, "activate_contract");
});

// =====================================================================================
// 3. THE INCOMPLETE FACADE REPRODUCES THE EXACT PRE-E6 PRODUCTION FAILURE
// =====================================================================================

test("REGRESSION: the old, incomplete {doc,getDoc}-only facade reproduces the exact Gate E5 production failure and leaves the session completely untouched", async () => {
  await seedUsers();
  await seedSession("s1");
  const firestoreDb = db(teacherCtx("teacher-a"));
  const incompleteFacade = { doc, getDoc }; // exactly what index.html passed before the E6 fix

  await assert.rejects(
    activateSessionExplicit({
      db: firestoreDb, firestore: incompleteFacade, sessionId: "s1",
      actorUid: "teacher-a", actorProfile: { role: "teacher", status: "active" }, operationId: "op-1"
    }),
    (e) => {
      // activateContract() throws a raw TypeError ("collection is not a function") before any
      // Firestore write is attempted; activateSessionExplicit's catch block cannot classify it
      // as ContractActivationError/ContractWriterError, so it falls through to the same generic
      // UNKNOWN_ERROR wrapping the real production UI actually showed.
      assert.ok(e instanceof ContractActivationError);
      assert.equal(e.code, "UNKNOWN_ERROR");
      assert.match(e.message, /Đã xảy ra lỗi không xác định khi kích hoạt/);
      return true;
    }
  );

  // Pre-commit, per Gate E5's diagnosis: the session must be exactly as before the attempt.
  const root = (await getDoc(doc(firestoreDb, "sessions", "s1"))).data();
  assert.equal("editContractVersion" in root, false);
  assert.equal("configRevision" in root, false);
  assert.equal(root.status, "closed");
});

// =====================================================================================
// 4. SOURCE GUARD — pins the real index.html call site so this exact class of regression
// (a hand-built facade object literal silently missing a required function) cannot recur
// unnoticed, without needing a browser to catch it.
// =====================================================================================

test("SOURCE GUARD: index.html's real activateSessionExplicit() call site passes the complete required Firestore facade", () => {
  const html = readFileSync(indexHtmlPath, "utf8");
  const m = html.match(/activateSessionExplicit\(\{[^}]*firestore:\{([^}]*)\}/);
  assert.ok(m, "could not locate the activateSessionExplicit(...) call site in index.html");
  const facadeKeys = m[1].split(",").map((s) => s.trim());
  for (const required of ["doc", "getDoc", "collection", "runTransaction", "serverTimestamp"]) {
    assert.ok(facadeKeys.includes(required), `index.html's activation call site is missing '${required}' from its firestore facade`);
  }
});
