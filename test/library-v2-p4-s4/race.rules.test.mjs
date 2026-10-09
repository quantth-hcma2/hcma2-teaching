// P4-S4 SAFETY REVIEW (task 2) - the interval between the full read-back verification and the batch becoming 'completed', with a CONCURRENT CLIENT (another administrator's real client, subject to
// the Rules - not an emulator bypass) mutating the imported framework inside that interval. Everything runs against the PRODUCTION Rules artifact unless stated.
//   A. completionMode "plain" = the reviewed candidate 317e854 (one updateDoc): the race is REAL - the batch becomes completed over drifted data
//   B. completionMode "transaction" (the corrected candidate): alteration / deletion / rename / framework deletion between the read and the commit can no longer be completed over
//   C. what NO client-side mechanism closes: an EXTRA node created in that interval (the web SDK has no transactional query); it is detected right after completion and reported, never as success
//   D. the proposed Rules amendment (test-only copy, not deployed) closes all of it at the Rules level
// Run: firebase emulators:exec --only firestore --project demo-p4s4r --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/race.rules.test.mjs"   (Java 21)
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, deleteDoc, getDoc, fwRename, fwTransition, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController, verifyImportedDataset } from "../../import-commit-controller.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, faulty, noSleep } from "./helpers.mjs";
import { amendedRules } from "./amended-rules.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485", "the Rules under test are the production artifact");
const envProd = await makeEnv("demo-p4s4r", rules);
const envAmended = await makeEnv("demo-p4s4r-amended", amendedRules(rules));
after(async () => { await envProd.cleanup(); await envAmended.cleanup(); });

const plan = planFor(big(3, 20), { actorUid: "pa" });                                   // 63 nodes
const victim = plan.nodes.find((n) => n.kind === "lesson"), subject = plan.nodes.find((n) => n.kind === "subject");
const fwRef = (db) => doc(db, "curriculumFrameworks/" + BATCH), nodeRef = (db, id) => doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + id);
// the concurrent writer: another administrator's REAL client (capA), subject to the Rules
const tampers = {
  alter: (db) => updateDoc(nodeRef(db, victim.id), nodeEdit({ name: "Sửa đổi đồng thời" })),
  deleteNode: (db) => deleteDoc(nodeRef(db, victim.id)),
  rename: (db) => updateDoc(fwRef(db), fwRename("Tên khung đổi đồng thời")),
  extra: (db) => setDoc(nodeRef(db, "e".repeat(32)), lessonPayload("orgA", subject.id, { name: "Nút thêm đồng thời", order: 999, code: "ZZ-EXTRA" })),
  deleteFramework: (db) => deleteDoc(fwRef(db))
};
const stored = async (env) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); const { getDocs, collection } = await import("firebase/firestore"); const get = async (p) => { const s = await getDoc(doc(db, p)); return s.exists() ? { id: s.id, ...s.data() } : null; }; out = { batch: await get("importBatches/" + BATCH), framework: await get("curriculumFrameworks/" + BATCH), nodes: (await getDocs(collection(db, "curriculumFrameworks", BATCH, "nodes"))).docs.map((d) => ({ id: d.id, ...d.data() })) }; }); return out; };
const drifted = async (env) => { const s = await stored(env); return !verifyImportedDataset({ plan, framework: s.framework, batch: { ...s.batch, status: "committing" }, nodes: s.nodes }).ok; };

// runs the import as pa; `inject` fires ONCE in the interval (plain: right before the completion write; transaction: after the transaction callback finished reading, before the SDK commits)
async function raceRun(env, as, { mode, kind, tamperAs = "capA", expectTamperDenied = false }) {
  await env.clearFirestore(); await seedWorld(env);
  const outcome = { tamper: null }; let fired = false;
  const fire = async () => { if (fired) return; fired = true; try { await tampers[kind](as(tamperAs)); outcome.tamper = "allowed"; } catch { outcome.tamper = "denied"; } };
  const counters = {};
  const fs = faulty(BASE_FS, {
    write: async (ctx) => { if (mode === "plain" && ctx.op === "updateDoc" && ctx.data && ctx.data.status === "completed") await fire(); return ctx.perform(); },
    afterReads: async ({ attempt }) => { if (mode === "transaction" && attempt === 1) await fire(); }
  }, counters);
  const controller = createImportCommitController({ db: as("pa"), firestore: fs, retryDelays: [0, 0], sleep: noSleep, completionMode: mode });
  const result = await controller.commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa") });
  if (expectTamperDenied) assert.equal(outcome.tamper, "denied");
  return { result, outcome, counters };
}

test("A. REAL RACE (reviewed candidate, plain completion): a concurrent client's alteration / deletion / rename / extra node between the read-back and the completion is ACCEPTED by the Rules and the batch becomes completed over drifted data - the framework is then activation-eligible", { timeout: 600000 }, async () => {
  const as = actors(envProd);
  for (const kind of ["alter", "deleteNode", "rename", "extra"]) {
    const { result, outcome } = await raceRun(envProd, as, { mode: "plain", kind });
    assert.equal(outcome.tamper, "allowed", kind + ": the production Rules let the concurrent writer through");
    const s = await stored(envProd);
    assert.equal(s.batch.status, "completed", kind + ": the batch is completed (terminal)"); assert.equal(await drifted(envProd), true, kind + ": and the stored dataset differs from the plan");
    assert.equal(result.ok, false); assert.equal(result.state, "completed-drift", kind + ": only the post-completion confirmation notices (the reviewed candidate had no such step and would have reported success)");
    // the P3 lifecycle then ACCEPTS the activation of the drifted framework (Rules: batch completed)
    await assertSucceeds(updateDoc(fwRef(as("pa")), fwTransition("pa", "active", { activatedAt: serverTimestamp() })));
  }
  // deleting the framework in the window is the one thing the Rules witness: the completion is refused
  const { result, outcome } = await raceRun(envProd, as, { mode: "plain", kind: "deleteFramework" });
  assert.equal(outcome.tamper, "allowed"); assert.notEqual(result.state, "completed"); assert.equal((await stored(envProd)).batch.status, "committing");
});

test("B. TRANSACTIONAL COMPLETION: alteration / deletion / rename / framework deletion between the transaction's reads and its commit make the commit fail; the retry re-reads, finds the difference, and the batch is NEVER completed over it", { timeout: 600000 }, async () => {
  const as = actors(envProd);
  for (const kind of ["alter", "rename"]) {
    const { result, outcome, counters } = await raceRun(envProd, as, { mode: "transaction", kind });
    assert.equal(outcome.tamper, "allowed", kind); assert.ok(counters.tx >= 2, kind + ": the SDK re-ran the transaction (optimistic concurrency): attempts=" + counters.tx);
    assert.equal(result.state, "verification-failed", kind + " " + JSON.stringify(result).slice(0, 200)); assert.equal((await stored(envProd)).batch.status, "partial", kind + ": durable stop, never completed");
  }
  { const { result, outcome, counters } = await raceRun(envProd, as, { mode: "transaction", kind: "deleteNode" });
    assert.equal(outcome.tamper, "allowed"); assert.ok(counters.tx >= 2); assert.equal(result.state, "incomplete", JSON.stringify(result).slice(0, 200)); assert.equal((await stored(envProd)).batch.status, "committing", "a missing node is repairable: still committing");
    const fixed = await createImportCommitController({ db: as("pa"), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep }).commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa"), resume: true });
    assert.equal(fixed.state, "completed", "resume writes the missing node, re-verifies and completes: " + JSON.stringify(fixed).slice(0, 200)); assert.equal(await drifted(envProd), false); }
  { const { result, outcome } = await raceRun(envProd, as, { mode: "transaction", kind: "deleteFramework" });
    assert.equal(outcome.tamper, "allowed"); assert.notEqual(result.state, "completed"); assert.notEqual((await stored(envProd)).batch.status, "completed"); }
});

test("C. THE GAP NO CLIENT CAN CLOSE: an EXTRA node created by another client between the transaction's reads and its commit is invisible to the transaction (no transactional query on the web SDK) - the batch completes, the post-completion confirmation reports completed-drift (never success)", { timeout: 600000 }, async () => {
  const as = actors(envProd);
  const { result, outcome } = await raceRun(envProd, as, { mode: "transaction", kind: "extra" });
  assert.equal(outcome.tamper, "allowed", "the production Rules admit the extra node");
  assert.equal(result.ok, false); assert.equal(result.state, "completed-drift"); assert.equal(result.verification.counts.extra, 1); assert.equal(result.batchCompleted, true);
  assert.equal((await stored(envProd)).batch.status, "completed", "terminal: the batch cannot be un-completed");
  console.log("RESIDUAL: completed over", result.verification.counts, "-> only a Rules change (or an importer-only freeze) closes this");
});

test("D. PROPOSED RULES AMENDMENT (test-only copy): the concurrent writer is refused at the Rules level in BOTH completion modes, so the import completes over an exact dataset", { timeout: 600000 }, async () => {
  const as = actors(envAmended);
  for (const mode of ["plain", "transaction"]) for (const kind of ["alter", "deleteNode", "rename", "extra", "deleteFramework"]) {
    const { result, outcome } = await raceRun(envAmended, as, { mode, kind, expectTamperDenied: true });
    assert.equal(result.state, "completed", mode + "/" + kind + " " + JSON.stringify(result).slice(0, 200));
    assert.equal(await drifted(envAmended), false, mode + "/" + kind); assert.equal((await stored(envAmended)).batch.status, "completed");
    assert.equal(outcome.tamper, "denied");
  }
});

test("E. TWO CLIENTS: two controllers (two browsers, so no shared lock) complete the SAME import concurrently - the end state is one exact completed dataset and no error is reported as success", { timeout: 600000 }, async () => {
  const as = actors(envProd); await envProd.clearFirestore(); await seedWorld(envProd);
  const mk = (uid) => createImportCommitController({ db: as(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });
  const [a, b] = await Promise.all([mk("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa") }), mk("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa") })]);
  assert.ok([a, b].some((r) => r.state === "completed"), JSON.stringify([a.state, b.state]));
  const s = await stored(envProd); assert.equal(s.nodes.length, 63); assert.equal(await drifted(envProd), false);
  if (s.batch.status !== "completed") assert.equal((await mk("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa"), resume: true })).state, "completed");
  assert.equal((await stored(envProd)).batch.status, "completed");
});

test("F. TRANSACTION AT SCALE: the completion transaction re-reads all 5,000 planned nodes and commits (time recorded)", { timeout: 600000 }, async () => {
  const as = actors(envProd); await envProd.clearFirestore(); await seedWorld(envProd);
  const big5000 = planFor(big(50, 99), { actorUid: "capA" }); const counters = {}; let txMs = 0;
  const fs = faulty(BASE_FS, { afterReads: async () => { txMs = Date.now() - txStart; } }, counters); let txStart = 0;
  const wrapped = { ...fs, runTransaction: (db, fn, o) => { txStart = Date.now(); return fs.runTransaction(db, fn, o); } };
  const r = await createImportCommitController({ db: as("capA"), firestore: wrapped, retryDelays: [0, 0], sleep: noSleep }).commit({ plan: big5000, organizationId: "orgA", actorUid: "capA", authorize: allowAlways("capA") });
  assert.equal(r.state, "completed", JSON.stringify(r).slice(0, 300)); assert.equal(counters.tx, 1, "no contention: one attempt");
  console.log("5000-node completion transaction: reads finished after", txMs, "ms");
});
