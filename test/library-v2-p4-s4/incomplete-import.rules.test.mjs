// P4-S4 SAFETY REVIEW - CONTROL: every P3 mutation path against a framework whose paired import batch is NOT completed, under the DEPLOYED ruleset text (0b6910c3 = the candidate with the freeze edits
// reversed): which operations are denied and which remain possible (documented, asserted, printed). This is the gap the import freeze closes; the freeze matrix itself is freeze.rules.test.mjs. Run: firebase emulators:exec --only firestore --project demo-p4s4m --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/incomplete-import.rules.test.mjs"
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, fwRename, fwTransition, newFwPayload, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, noSleep, deployedRulesText } from "./helpers.mjs";

void sha; void candidateRules;
const envProd = await makeEnv("demo-p4s4m", deployedRulesText());
after(async () => { await envProd.cleanup(); });

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

