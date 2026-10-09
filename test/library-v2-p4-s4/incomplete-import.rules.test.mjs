// P4-S4 SAFETY REVIEW (task 1) - every existing P3 mutation path against a framework whose paired import batch is NOT completed, on the emulator.
//   A. the PRODUCTION Rules artifact (ruleset 0b6910c3): which operations are denied and which remain possible (documented, asserted, printed as a matrix)
//   B. a test-only in-memory COPY with the PROPOSED amendment (amended-rules.mjs): what it would close, that the importer keeps working, and the call budget.
// Nothing is deployed; the repository Rules are untouched. Run: firebase emulators:exec --only firestore --project demo-p4s4m --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/incomplete-import.rules.test.mjs"
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, fwRename, fwTransition, newFwPayload, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, noSleep } from "./helpers.mjs";
import { amendedRules } from "./amended-rules.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485", "the Rules under test are the production artifact");
const envProd = await makeEnv("demo-p4s4m", rules);
const envAmended = await makeEnv("demo-p4s4m-amended", amendedRules(rules));
after(async () => { await envProd.cleanup(); await envAmended.cleanup(); });

const OPS = ["rename", "deleteFramework", "activate", "archive", "clone", "nodeCreate", "nodeUpdate", "nodeReorder", "nodeDelete"];
const plan = planFor(big(3, 20), { actorUid: "pa" });                                    // 63 nodes: one chunk
const subject = plan.nodes.find((n) => n.kind === "subject"), lesson = plan.nodes.find((n) => n.kind === "lesson");
const ctl = (as, uid) => createImportCommitController({ db: as(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });

// builds the import state for ONE scenario on a clean emulator: committing | partial | completed
async function setup(env, as, status) {
  await env.clearFirestore(); await seedWorld(env);
  const importer = "pa";
  if (status === "completed") { const r = await ctl(as, importer).commit({ plan, organizationId: "orgA", actorUid: importer, authorize: allowAlways(importer) }); assert.equal(r.state, "completed", JSON.stringify(r).slice(0, 200)); return; }
  let calls = 0;
  const stopAtVerify = Object.assign(async () => (++calls <= 3 ? { allowed: true } : { allowed: false, reason: "STOP" }), { actorUid: importer });
  const r = await ctl(as, importer).commit({ plan, organizationId: "orgA", actorUid: importer, authorize: stopAtVerify });
  assert.equal(r.state, "denied");                                                   // batch + framework + all 63 nodes written, verification not reached
  if (status === "partial") assert.equal((await ctl(as, importer).abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways(importer) })).state, "partial");
}
const attempt = {
  rename: (db) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH), fwRename("Tên khung đổi bởi người khác")),
  deleteFramework: (db) => deleteDoc(doc(db, "curriculumFrameworks/" + BATCH)),
  activate: (db, uid) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH), fwTransition(uid, "active", { activatedAt: serverTimestamp() })),
  archive: (db, uid) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH), fwTransition(uid, "archived")),
  clone: (db, uid) => setDoc(doc(db, "curriculumFrameworks/cloneOfImport"), { ...newFwPayload("orgA", uid, { name: "Bản sao của lần nhập" }), cloneSource: { frameworkId: BATCH, nodeCount: 63 } }),
  nodeCreate: (db) => setDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + "c".repeat(32)), lessonPayload("orgA", subject.id, { name: "Bài thêm bởi người khác", order: 999, code: "ZZ-EXTRA" })),
  nodeUpdate: (db) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + lesson.id), nodeEdit({ name: "Bài đổi tên bởi người khác" })),
  nodeReorder: (db) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + lesson.id), nodeEdit({ order: 77 })),
  nodeDelete: (db) => deleteDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + lesson.id))
};
const allowed = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
async function matrix(env, as, status, actor) {
  const row = {};
  for (const op of OPS) { await setup(env, as, status); row[op] = (await allowed(attempt[op](as(actor), actor))) ? "ALLOWED" : "denied"; }
  return row;
}
const print = (title, rows) => { console.log("\n" + title); console.log(["status/actor".padEnd(22), ...OPS.map((o) => o.padEnd(15))].join("")); for (const [k, r] of Object.entries(rows)) console.log([k.padEnd(22), ...OPS.map((o) => r[o].padEnd(15))].join("")); };
const E = (allowedOps) => Object.fromEntries(OPS.map((o) => [o, allowedOps.includes(o) ? "ALLOWED" : "denied"]));

test("A. PRODUCTION RULES: for a framework with a committing / partial batch only activation, archiving and cloning are denied; rename, delete and every node mutation REMAIN possible for any authorized writer", { timeout: 600000 }, async () => {
  const as = actors(envProd);
  const rows = {};
  for (const status of ["committing", "partial", "completed"]) for (const actor of ["capA", "oaA", "pa"]) rows[status + " / " + actor] = await matrix(envProd, as, status, actor);
  print("PRODUCTION RULES (ruleset 0b6910c3) - P3 mutation paths on the imported framework", rows);
  const open = ["rename", "deleteFramework", "nodeCreate", "nodeUpdate", "nodeReorder", "nodeDelete"];
  for (const actor of ["capA", "oaA", "pa"]) {
    assert.deepEqual(rows["committing / " + actor], E(open), "committing / " + actor);
    assert.deepEqual(rows["partial / " + actor], E(open), "partial / " + actor);
    assert.deepEqual(rows["completed / " + actor], E([...open, "activate", "clone"]), "completed / " + actor);          // control: a completed import is an ordinary draft
  }
});

test("B. PROPOSED AMENDMENT (copy of the Rules, not deployed): while committing only the IMPORTER mutates; while partial only deletes (clean-up) are possible; a completed import is an ordinary draft again", { timeout: 600000 }, async () => {
  const as = actors(envAmended);
  const rows = {};
  for (const status of ["committing", "partial", "completed"]) for (const actor of ["capA", "oaA", "pa"]) rows[status + " / " + actor] = await matrix(envAmended, as, status, actor);
  print("PROPOSED AMENDMENT (test-only copy) - the same paths (importer = pa)", rows);
  for (const actor of ["capA", "oaA"]) assert.deepEqual(rows["committing / " + actor], E([]), "committing / non-importer " + actor);
  assert.deepEqual(rows["committing / pa"], E(["rename", "deleteFramework", "nodeCreate", "nodeUpdate", "nodeReorder", "nodeDelete"]), "committing / importer");
  for (const actor of ["capA", "oaA", "pa"]) {
    assert.deepEqual(rows["partial / " + actor], E(["deleteFramework", "nodeDelete"]), "partial / " + actor);
    assert.deepEqual(rows["completed / " + actor], E(["rename", "deleteFramework", "nodeCreate", "nodeUpdate", "nodeReorder", "nodeDelete", "activate", "clone"]), "completed / " + actor);
  }
});

test("B2. PROPOSED AMENDMENT keeps the whole import workflow working for every writer type and keeps ordinary P3 drafts untouched (call budget): commit, abandon by ANOTHER administrator then rollback, 400-write node batches on a plain framework", { timeout: 600000 }, async () => {
  const as = actors(envAmended);
  for (const uid of ["pa", "oaA", "capA"]) {
    await envAmended.clearFirestore(); await seedWorld(envAmended);
    const p = planFor(big(3, 300), { actorUid: uid });                                        // 903 nodes -> 3 chunks of <= 400 writes
    const r = await ctl(as, uid).commit({ plan: p, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid) });
    assert.equal(r.state, "completed", uid + " " + JSON.stringify(r).slice(0, 300));
  }
  // an interrupted import of one administrator is abandoned (committing -> partial) and rolled back by ANOTHER authorized writer
  await envAmended.clearFirestore(); await seedWorld(envAmended);
  let calls = 0; const stop = Object.assign(async () => (++calls <= 3 ? { allowed: true } : { allowed: false }), { actorUid: "oaA" });
  const p = planFor(big(3, 300), { actorUid: "oaA" });
  assert.equal((await ctl(as, "oaA").commit({ plan: p, organizationId: "orgA", actorUid: "oaA", authorize: stop })).state, "denied");
  const other = ctl(as, "capA");
  assert.equal((await other.rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).ok, false, "a non-importer cannot delete nodes of a COMMITTING import");
  assert.equal((await other.abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).state, "partial", "any authorized writer can stop it");
  assert.equal((await other.rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).state, "rolled_back", "...and clean it up");
  // ordinary P3 framework (no batch): 400 node creates and 400 node deletes in one atomic batch, as capA
  await envAmended.clearFirestore(); await seedWorld(envAmended);
  const db = as("capA"), ids = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(32, "0"));
  const create = writeBatch(db); for (const [i, id] of ids.entries()) create.set(doc(db, "curriculumFrameworks/fwA_draft/nodes/" + id), lessonPayload("orgA", "s1", { name: "Bài " + i, order: 100 + i, code: "B" + i })); await assertSucceeds(create.commit());
  const del = writeBatch(db); for (const id of ids) del.delete(doc(db, "curriculumFrameworks/fwA_draft/nodes/" + id)); await assertSucceeds(del.commit());
});
