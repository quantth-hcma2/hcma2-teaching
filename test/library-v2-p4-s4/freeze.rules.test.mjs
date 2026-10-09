// P4-S4 IMPORT FREEZE - the Rules CANDIDATE (firestore.rules.production-candidate with the import freeze; NOT deployed) and the REAL controller on the emulator.
//   1. permission matrix: every P3 mutation path x import state (importing / sealed / partial / completed) x actor (Platform Admin, Organization Admin, curriculum.manage holder)
//   2. P3 behaviour is not weakened: ordinary frameworks (no paired batch) and completed imports behave exactly as in production
//   3. recovery ownership: takeover / resume / abandon / rollback by ANY authorized writer of the same organization, nothing for unauthorized or other-organization users
// Run: firebase emulators:exec --only firestore --project demo-p4s4f --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/freeze.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, doc, setDoc, updateDoc, deleteDoc, getDoc, fwRename, fwTransition, newFwPayload, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { toNodePayload } from "../../import-plan.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, noSleep, freezeCandidateRules } from "./helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";

const SC = { createImportCommitController };
const env = await makeEnv("demo-p4s4f", freezeCandidateRules());                       // SHA-256 of the candidate asserted by the helper
const as = actors(env);
after(async () => env.cleanup());

const plan = planFor(big(3, 20), { actorUid: "pa" });                                    // 63 nodes, 1 chunk
const subject = plan.nodes.find((n) => n.kind === "subject"), lesson = plan.nodes.find((n) => n.kind === "lesson");
const ctl = (uid) => SC.createImportCommitController({ db: as(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });
const flip = (uid, n) => { let c = 0; return Object.assign(async () => (++c <= n ? { allowed: true } : { allowed: false, reason: "STOP" }), { actorUid: uid }); };
const adm = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const fwPath = "curriculumFrameworks/" + BATCH, nodePath = (id) => fwPath + "/nodes/" + id;

async function setup(status) {
  await env.clearFirestore(); await seedWorld(env);
  const c = ctl("pa");
  if (status === "completed") { const r = await c.commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa") }); assert.equal(r.state, "completed", JSON.stringify(r).slice(0, 200)); return; }
  if (status === "importing") {                                                       // batch + framework + the 63 nodes, NOT sealed (chunksDone 0 of 1)
    await c.commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 2) });
    await adm(async (db) => { for (const n of plan.nodes) await setDoc(doc(db, nodePath(n.id)), toNodePayload(n, { serverTimestamp: () => new Date() })); });
    return;
  }
  const r = await c.commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 4) });      // all nodes written and SEALED (start, framework, chunk 0, seal), verification not reached
  assert.equal(r.state, "denied"); const b = await adm(async (db) => (await getDoc(doc(db, "importBatches/" + BATCH))).data()); assert.equal(b.chunksDone, b.chunksTotal);
  if (status === "partial") assert.equal((await c.abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") })).state, "partial");
}
const OPS = ["nodeCreateHex", "nodeCreateAuto", "nodeUpdate", "nodeReorder", "nodeDelete", "rename", "deleteFramework", "activate", "archive", "clone"];
const attempt = {
  nodeCreateHex: (db) => setDoc(doc(db, nodePath("c".repeat(32))), lessonPayload("orgA", subject.id, { name: "Nút thêm (id hex)", order: 999, code: "ZZ-HEX" })),
  nodeCreateAuto: (db) => setDoc(doc(db, nodePath("AutoId0123456789abcde")), lessonPayload("orgA", subject.id, { name: "Nút thêm (id tự sinh)", order: 998, code: "ZZ-AUTO" })),
  nodeUpdate: (db) => updateDoc(doc(db, nodePath(lesson.id)), nodeEdit({ name: "Bài đổi tên" })),
  nodeReorder: (db) => updateDoc(doc(db, nodePath(lesson.id)), nodeEdit({ order: 77 })),
  nodeDelete: (db) => deleteDoc(doc(db, nodePath(lesson.id))),
  rename: (db) => updateDoc(doc(db, fwPath), fwRename("Tên khung mới")),
  deleteFramework: (db) => deleteDoc(doc(db, fwPath)),
  activate: (db, uid) => updateDoc(doc(db, fwPath), fwTransition(uid, "active", { activatedAt: serverTimestamp() })),
  archive: (db, uid) => updateDoc(doc(db, fwPath), fwTransition(uid, "archived")),
  clone: (db, uid) => setDoc(doc(db, "curriculumFrameworks/cloneOfImport"), { ...newFwPayload("orgA", uid, { name: "Bản sao" }), cloneSource: { frameworkId: BATCH, nodeCount: 63 } })
};
const can = async (p) => { try { await assertSucceeds(p); return true; } catch { return false; } };
const E = (ok) => Object.fromEntries(OPS.map((o) => [o, ok.includes(o) ? "ALLOWED" : "denied"]));
const print = (rows) => { console.log("\nFINAL PROPOSAL (test-only copy)\n" + ["state / actor".padEnd(22), ...OPS.map((o) => o.padEnd(15))].join("")); for (const [k, r] of Object.entries(rows)) console.log([k.padEnd(22), ...OPS.map((o) => r[o].padEnd(15))].join("")); };

test("1. PERMISSION MATRIX: importing = node create with an import-shaped id only; sealed = nothing; partial = deletes only; completed = ordinary P3 draft - identical for Platform Admin, Organization Admin and curriculum.manage holder", { timeout: 900000 }, async () => {
  const rows = {};
  for (const status of ["importing", "sealed", "partial", "completed"]) for (const actor of ["pa", "oaA", "capA"]) {
    const row = {};
    for (const op of OPS) { await setup(status); row[op] = (await can(attempt[op](as(actor), actor))) ? "ALLOWED" : "denied"; }
    rows[status + " / " + actor] = row;
  }
  print(rows);
  const expected = { importing: ["nodeCreateHex"], sealed: [], partial: ["nodeDelete", "deleteFramework"], completed: ["nodeCreateHex", "nodeCreateAuto", "nodeUpdate", "nodeReorder", "nodeDelete", "rename", "deleteFramework", "activate", "clone"] };
  for (const [key, row] of Object.entries(rows)) assert.deepEqual(row, E(expected[key.split(" / ")[0]]), key);
});

test("2. P3 IS NOT WEAKENED: an ordinary framework (no paired batch) keeps every P3 path for all three writer types; orphan nodes of a rolled-back import can be cleaned up; unauthorized users still cannot do anything", { timeout: 600000 }, async () => {
  for (const actor of ["pa", "oaA", "capA"]) {
    const db = () => as(actor);
    const ops = {
      rename: () => updateDoc(doc(db(), "curriculumFrameworks/fwA_draft"), fwRename("Đổi tên khung thường")),
      nodeCreate: () => setDoc(doc(db(), "curriculumFrameworks/fwA_draft/nodes/" + "AutoId0123456789abcde"), lessonPayload("orgA", "s1", { name: "Bài mới", order: 50, code: "NEW" })),
      nodeUpdate: () => updateDoc(doc(db(), "curriculumFrameworks/fwA_draft/nodes/l1"), nodeEdit({ name: "Bài đổi tên", order: 5 })),
      nodeDelete: () => deleteDoc(doc(db(), "curriculumFrameworks/fwA_draft/nodes/l1")),
      activate: () => updateDoc(doc(db(), "curriculumFrameworks/fwA_draft"), fwTransition(actor, "active", { activatedAt: serverTimestamp() })),
      clone: () => setDoc(doc(db(), "curriculumFrameworks/cloneOfPlain"), { ...newFwPayload("orgA", actor, { name: "Bản sao khung thường" }), cloneSource: { frameworkId: "fwA_draft", nodeCount: 2 } }),
      deleteFramework: () => deleteDoc(doc(db(), "curriculumFrameworks/fwA_draft"))
    };
    for (const [name, run] of Object.entries(ops)) { await env.clearFirestore(); await seedWorld(env); await assertSucceeds(run()); void name; }
  }
  // 400-write atomic batches (create then delete) on an ordinary framework: the extra batch lookup stays inside the call budget
  await env.clearFirestore(); await seedWorld(env);
  const { writeBatch } = await import("firebase/firestore"); const db = as("capA");
  const ids = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(32, "0"));
  const create = writeBatch(db); for (const [i, id] of ids.entries()) create.set(doc(db, "curriculumFrameworks/fwA_draft/nodes/" + id), lessonPayload("orgA", "s1", { name: "Bài " + i, order: 100 + i, code: "B" + i })); await assertSucceeds(create.commit());
  const del = writeBatch(db); for (const id of ids) del.delete(doc(db, "curriculumFrameworks/fwA_draft/nodes/" + id)); await assertSucceeds(del.commit());
  // rolled back import: framework and batch rules leave orphans deletable
  await setup("sealed"); await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  assert.equal((await adm(async (d) => (await getDoc(doc(d, "importBatches/" + BATCH))).data().status)), "rolled_back");
  await adm((d) => setDoc(doc(d, nodePath("d".repeat(32))), lessonPayload("orgA", "x", { name: "Mồ côi" })));
  await assertSucceeds(deleteDoc(doc(as("capA"), nodePath("d".repeat(32)))));
  // unauthorized
  await setup("importing");
  for (const uid of ["mA", "revA", "noMember", "capSuspMem", "tSusp", "oaB", "capB"]) for (const op of ["nodeCreateHex", "rename", "deleteFramework"]) assert.equal(await can(attempt[op](as(uid), uid)), false, uid + " " + op);
});

test("3. RECOVERY OWNERSHIP (not tied to the importer): any authorized writer of the SAME organization can take over (resume node writes), seal, complete, abandon or roll back an interrupted import; unauthorized and other-organization users cannot", { timeout: 900000 }, async () => {
  const big3 = planFor(big(3, 300), { actorUid: "pa" });                                // 903 nodes, 3 chunks
  for (const taker of ["oaA", "capA", "pa"]) {
    await env.clearFirestore(); await seedWorld(env);
    const interrupted = await ctl("pa").commit({ plan: big3, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 3) });      // importer stops after chunk 0
    assert.equal(interrupted.state, "denied"); assert.equal(interrupted.nodesWritten, 400);
    const resumed = await ctl(taker).commit({ plan: big3, organizationId: "orgA", actorUid: taker, authorize: allowAlways(taker), resume: true });
    assert.equal(resumed.state, "completed", taker + " " + JSON.stringify(resumed).slice(0, 300));
    const batch = await adm(async (d) => (await getDoc(doc(d, "importBatches/" + BATCH))).data()); assert.equal(batch.status, "completed"); assert.equal(batch.importer, "pa", "provenance (importer) is immutable: a takeover does not rewrite it");
  }
  for (const taker of ["oaA", "capA"]) {                                                // abandon + rollback by someone else
    await env.clearFirestore(); await seedWorld(env);
    await ctl("pa").commit({ plan: big3, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 3) });
    const rb = await ctl(taker).rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways(taker) });
    assert.equal(rb.state, "rolled_back", taker + " " + JSON.stringify(rb).slice(0, 200));
    assert.equal(await adm(async (d) => (await getDoc(doc(d, "curriculumFrameworks/" + BATCH))).exists()), false);
  }
  await env.clearFirestore(); await seedWorld(env);
  await ctl("pa").commit({ plan: big3, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 3) });
  for (const uid of ["mA", "noMember", "oaB", "capB", "tSusp", "capSuspMem"]) {
    const resume = await ctl(uid).commit({ plan: big3, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), resume: true }); assert.notEqual(resume.state, "completed", uid + " resume");
    const abandon = await ctl(uid).abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways(uid) }); assert.equal(abandon.ok, false, uid + " abandon");
    const rollback = await ctl(uid).rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways(uid) }); assert.equal(rollback.ok, false, uid + " rollback");
  }
  const still = await adm(async (d) => (await getDoc(doc(d, "importBatches/" + BATCH))).data()); assert.equal(still.status, "committing", "nothing of the unauthorized attempts took effect");
});

test("4. INTERRUPTED BEFORE AND AFTER THE SEAL: before the seal anybody authorized resumes, seals and completes; after the seal the batch is frozen and anybody authorized completes it (no re-seal) or rolls it back; a sealed batch that lost a node can only be rolled back", { timeout: 900000 }, async () => {
  const batchOf = () => adm(async (d) => (await getDoc(doc(d, "importBatches/" + BATCH))).data());
  // A. all nodes written, interruption right BEFORE the seal (the seal authorization is refused)
  await env.clearFirestore(); await seedWorld(env);
  const before = await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 3) });
  assert.equal(before.state, "denied"); assert.equal(before.phase, "seal"); let b = await batchOf(); assert.equal(b.status, "committing"); assert.ok(b.chunksDone < b.chunksTotal, "not sealed");
  assert.equal(await can(attempt.nodeCreateHex(as("capA"))), true, "before the seal an import-shaped create is still admitted (resume)");
  await env.clearFirestore(); await seedWorld(env); await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 3) });
  const resumed = await ctl("capA").commit({ plan, organizationId: "orgA", actorUid: "capA", authorize: allowAlways("capA"), resume: true });
  assert.equal(resumed.state, "completed", JSON.stringify(resumed).slice(0, 200)); b = await batchOf(); assert.equal(b.status, "completed"); assert.equal(b.chunksDone, b.chunksTotal);
  // B. interruption right AFTER the seal (the verification authorization is refused): frozen, completed by someone else
  await env.clearFirestore(); await seedWorld(env);
  const after = await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 4) });
  assert.equal(after.state, "denied"); assert.equal(after.phase, "verify"); b = await batchOf(); assert.equal(b.status, "committing"); assert.equal(b.chunksDone, b.chunksTotal, "sealed");
  for (const op of ["nodeCreateHex", "nodeUpdate", "nodeDelete", "rename", "deleteFramework"]) assert.equal(await can(attempt[op](as("oaA"), "oaA")), false, "sealed: " + op);
  const finished = await ctl("oaA").commit({ plan, organizationId: "orgA", actorUid: "oaA", authorize: allowAlways("oaA"), resume: true });
  assert.equal(finished.state, "completed", JSON.stringify(finished).slice(0, 200)); assert.equal((await batchOf()).status, "completed");
  // C. sealed, then rolled back by someone else
  await env.clearFirestore(); await seedWorld(env); await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 4) });
  assert.equal((await ctl("capA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).state, "rolled_back");
  assert.deepEqual({ fw: await adm(async (d) => (await getDoc(doc(d, "curriculumFrameworks/" + BATCH))).exists()), status: (await batchOf()).status }, { fw: false, status: "rolled_back" });
  // D. sealed but a planned node vanished (administrative tool): unrepairable -> partial, then rollback
  await env.clearFirestore(); await seedWorld(env); await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flip("pa", 4) });
  await adm((d) => deleteDoc(doc(d, nodePath(lesson.id))));
  const lost = await ctl("capA").commit({ plan, organizationId: "orgA", actorUid: "capA", authorize: allowAlways("capA"), resume: true });
  assert.equal(lost.state, "verification-failed", JSON.stringify(lost).slice(0, 200)); assert.equal((await batchOf()).status, "partial");
  assert.equal((await ctl("oaA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") })).state, "rolled_back");
});
