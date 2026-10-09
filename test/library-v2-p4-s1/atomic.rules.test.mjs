// LIBRARY V2 P4-S1 - FINAL SECURITY GATE: atomic-write (batched write) behavior of the P4-S1 candidate Rules against the EXACT candidate artifact (Firestore emulator, synthetic data only).
// Question: can ANY ordering of writes inside one atomic batch bypass paired-ID governance (activation protection, clone protection, completed/rolled_back witnesses)?
// Mechanism under test: the candidate Rules use exists()/get() ONLY, which read the state BEFORE the batch (never existsAfter()/getAfter()), so a guard can never be satisfied by a write
// that sits in the same commit as the guarded write. A probe environment (probe rules appended to the candidate, test-only) shows the pre-state semantics empirically.
// Run: firebase emulators:exec --only firestore --project demo-p4s1c --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s1/atomic.rules.test.mjs"
import test, { beforeEach } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  p3Region, p4Region, sha, makeEnv, actors, candidateRules, withProbes, seedWorld, assertSucceeds, assertFails, nodeDoc, fwDoc, newFwPayload, newNodePayload, fwTransition, D, NL,
  doc, setDoc, updateDoc, getDoc, deleteDoc, collection, writeBatch, serverTimestamp, fwRef, nodeRef
} from "../library-v2-p3-s1/helpers.mjs";
import { deployedRulesText } from "../library-v2-p4-s4/helpers.mjs";

const rules = deployedRulesText();   // P4-S4: these tests document the DEPLOYED ruleset 0b6910c3 (the candidate with the import-freeze edits reversed); the freeze itself is covered by test/library-v2-p4-s4
const env = await makeEnv("demo-p4s1-atomic", rules);
const as = actors(env);
// probe environment: the SAME candidate Rules + two test-only probe collections that contrast exists() with existsAfter()
const probes = [
  "    match /_pre/{id} { allow create: if exists(/databases/$(database)/documents/_target/t); }",
  "    match /_post/{id} { allow create: if existsAfter(/databases/$(database)/documents/_target/t); }",
  "    match /_target/{id} { allow create, update, delete: if true; }"
].join(NL);
const probeEnv = await makeEnv("demo-p4s1-atomic-probe", withProbes(rules, probes));
test.after(async () => { await env.cleanup(); await probeEnv.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const WRITERS = ["pa", "oaA", "capA"];
const FINAL = "f".repeat(32);
const batchRef = (db, id) => doc(db, "importBatches", id);
const batchBody = (org, uid, id, extra = {}) => ({
  schemaVersion: 1, kind: "curriculum", organizationId: org, destination: { type: "curriculumFramework", frameworkId: id }, templateId: "hcma2.curriculum.xlsx", templateVersion: 1,
  sourceFile: { name: "khung.xlsx", size: 2048, sha256: "a".repeat(64) }, importer: uid, status: "committing",
  counts: { parsed: 6, accepted: 6, skipped: 0, failed: 0 }, chunksDone: 0, chunksTotal: 1, warningsSummary: {}, finalNodeId: FINAL, ...extra
});
const newBatch = (org, uid, id, extra = {}) => ({ ...batchBody(org, uid, id, extra), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
async function seed(fn) { await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); await fn(db, (p, d) => setDoc(doc(db, p), d)); }); }
const seedBatch = (id, org = "orgA", status = "committing", extra = {}) => seed((db, put) => put("importBatches/" + id, {
  ...batchBody(org, "pa", id, { chunksDone: status === "completed" ? 1 : 0, status, ...(status === "committing" ? {} : { finishedAt: D(8) }), ...extra }), createdAt: D(7), updatedAt: D(7)
}));
const seedFw = (id, org = "orgA", status = "draft", extra = {}) => seed((db, put) => put("curriculumFrameworks/" + id, fwDoc(org, status, extra)));
const seedNode = (fw, id, org = "orgA", extra = {}) => seed((db, put) => put("curriculumFrameworks/" + fw + "/nodes/" + id, nodeDoc(org, extra)));
const finish = (status, fields = {}) => ({ status, finishedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...fields });
const activate = (u) => fwTransition(u, "active", { activatedAt: serverTimestamp() });
const status = async (path) => (await getDoc(doc(as("pa"), path))).data()?.status;

test("0. SEMANTICS (empirical, same emulator): exists()/get() read the state BEFORE the batch; existsAfter()/getAfter() read the state AFTER it - the candidate uses only the former", async () => {
  const strip = (s) => s.split(NL).map((l) => (l.indexOf("//") >= 0 ? l.slice(0, l.indexOf("//")) : l)).join(NL);   // comments excluded (the P4 region comments discuss the *After functions)
  const mine = strip(p3Region(rules) + NL + p4Region(rules));   // the P3 curriculum region (incl. the D14 clause and the activation clause) + the P4-S1 region: every expression this slice owns or edits
  assert.ok(!mine.includes("existsAfter(") && !mine.includes("getAfter("), "the curriculum + import-batch Rules never use existsAfter()/getAfter() in an expression");
  assert.ok(mine.includes(" exists(") || mine.includes("!exists("));
  assert.ok(mine.includes("get("));
  const db = probeEnv.authenticatedContext("u1").firestore();
  const b1 = writeBatch(db); b1.set(doc(db, "_target", "t"), { v: 1 }); b1.set(doc(db, "_pre", "a"), { v: 1 });
  await no(b1.commit());                                                // pre-state: the target does not exist yet -> the exists() probe denies the whole batch
  const b2 = writeBatch(db); b2.set(doc(db, "_target", "t"), { v: 1 }); b2.set(doc(db, "_post", "a"), { v: 1 });
  await ok(b2.commit());                                                // post-state: existsAfter() sees the target created in the same batch
  const b3 = writeBatch(db); b3.set(doc(db, "_pre", "b"), { v: 1 });
  await ok(b3.commit());                                                // once the target is committed, exists() sees it
});

test("1. batch + framework created in ONE atomic batch: allowed (in either order) for every writer and the pair is governed exactly as if created in two commits - activation stays denied; activating inside the same batch is denied; direct active/completed creation is denied", async () => {
  for (const u of WRITERS) {
    const id = "pair_" + u, db = as(u), b = writeBatch(db);
    b.set(batchRef(db, id), newBatch("orgA", u, id)); b.set(fwRef(db, id), newFwPayload("orgA", u, { name: "Nhap " + u }));
    await ok(b.commit());
    await no(updateDoc(fwRef(db, id), activate(u)));                                   // governed: committing batch
  }
  { const id = "pair_rev", db = as("pa"), b = writeBatch(db); b.set(fwRef(db, id), newFwPayload("orgA", "pa")); b.set(batchRef(db, id), newBatch("orgA", "pa", id)); await ok(b.commit()); await no(updateDoc(fwRef(db, id), activate("pa"))); }   // reversed order: same result
  // activating inside the SAME batch that creates the pair (set then update of the same document)
  { const id = "pair_act", db = as("pa"), b = writeBatch(db); b.set(batchRef(db, id), newBatch("orgA", "pa", id)); b.set(fwRef(db, id), newFwPayload("orgA", "pa")); b.update(fwRef(db, id), activate("pa")); await no(b.commit()); assert.equal((await getDoc(fwRef(as("pa"), id))).exists(), false, "atomic: nothing was written"); }
  { const id = "pair_act2", db = as("pa"), b = writeBatch(db); b.set(batchRef(db, id), newBatch("orgA", "pa", id)); b.set(fwRef(db, id), newFwPayload("orgA", "pa", { status: "active", activatedAt: serverTimestamp(), statusChangedAt: serverTimestamp(), statusChangedBy: "pa" })); await no(b.commit()); }
  { const id = "pair_done", db = as("pa"), b = writeBatch(db); b.set(batchRef(db, id), newBatch("orgA", "pa", id, { status: "completed", finishedAt: serverTimestamp(), chunksDone: 1 })); b.set(fwRef(db, id), newFwPayload("orgA", "pa")); await no(b.commit()); }
  // a framework that ALREADY exists (manual) can never be paired later, in one batch or two
  { const db = as("pa"), b = writeBatch(db); b.set(batchRef(db, "fwA_draft"), newBatch("orgA", "pa", "fwA_draft")); await no(b.commit()); }
  { const db = as("pa"), b = writeBatch(db); b.delete(fwRef(db, "fwA_draft")); b.set(batchRef(db, "fwA_draft"), newBatch("orgA", "pa", "fwA_draft")); await no(b.commit()); assert.equal((await getDoc(fwRef(as("pa"), "fwA_draft"))).exists(), true); }   // deleting the framework in the same batch does not help: exists() is pre-state
  // two commits: delete the never-activated manual draft, then create a batch for the freed id -> the NEW framework at that id is governed (non-activatable until completed): no bypass
  await ok(deleteDoc(fwRef(as("pa"), "fwA_draft")));
  await ok(setDoc(batchRef(as("pa"), "fwA_draft"), newBatch("orgA", "pa", "fwA_draft")));
  await ok(setDoc(fwRef(as("pa"), "fwA_draft"), newFwPayload("orgA", "pa", { name: "Tai tao" })));
  await no(updateDoc(fwRef(as("pa"), "fwA_draft"), activate("pa")));
});

test("2. activation + importBatch status update in ONE atomic batch: denied in both orders (the guard sees the committed `committing` state); completion and activation only work as TWO commits in that order; the witness must already EXIST before the completing commit", async () => {
  await seedBatch("a1"); await seedFw("a1"); await seedNode("a1", FINAL);
  for (const order of ["batchFirst", "frameworkFirst"]) {
    const db = as("pa"), b = writeBatch(db);
    if (order === "batchFirst") { b.update(batchRef(db, "a1"), finish("completed", { chunksDone: 1 })); b.update(fwRef(db, "a1"), activate("pa")); }
    else { b.update(fwRef(db, "a1"), activate("pa")); b.update(batchRef(db, "a1"), finish("completed", { chunksDone: 1 })); }
    await no(b.commit());
    assert.equal(await status("importBatches/a1"), "committing"); assert.equal(await status("curriculumFrameworks/a1"), "draft");
  }
  { const db = as("pa"), b = writeBatch(db); b.update(fwRef(db, "a1"), activate("pa")); b.update(batchRef(db, "a1"), finish("partial")); await no(b.commit()); }   // activation alongside ANY other batch state change
  { const db = as("pa"), b = writeBatch(db); b.update(fwRef(db, "a1"), activate("pa")); b.update(batchRef(db, "a1"), { updatedAt: serverTimestamp(), chunksDone: 1 }); await no(b.commit()); }
  // POSITIVE CONTROLS (the denials above are semantic, not a size/limit artifact): the same shapes of multi-write batch are ALLOWED when the pre-state satisfies the guard
  await seedBatch("a1c", "orgA", "completed"); await seedFw("a1c"); await seedBatch("a1d"); await seedFw("a1d");
  { const db = as("pa"), b = writeBatch(db); b.update(fwRef(db, "a1c"), activate("pa")); b.update(batchRef(db, "a1d"), { updatedAt: serverTimestamp(), chunksDone: 1 }); await ok(b.commit()); }   // governed activation (batch already completed) + unrelated batch progress
  await seedBatch("a1e"); await seedFw("a1e"); await seedNode("a1e", FINAL);
  { const db = as("pa"), b = writeBatch(db); b.update(batchRef(db, "a1e"), finish("completed", { chunksDone: 1 })); b.update(fwRef(db, "fwA_draft"), { name: "Doi ten", updatedAt: serverTimestamp() }); await ok(b.commit()); }   // completion + unrelated framework write
  await ok(updateDoc(batchRef(as("pa"), "a1"), finish("completed", { chunksDone: 1 })));      // commit 1: completed (witness + draft framework pre-exist)
  await ok(updateDoc(fwRef(as("pa"), "a1"), activate("pa")));                                    // commit 2: activation
  assert.equal(await status("curriculumFrameworks/a1"), "active");
  // the witness node must exist BEFORE the completing commit: creating it in the same batch is denied
  await seedBatch("a2"); await seedFw("a2");
  { const db = as("pa"), b = writeBatch(db); b.set(nodeRef(db, "a2", FINAL), newNodePayload("orgA")); b.update(batchRef(db, "a2"), finish("completed", { chunksDone: 1 })); await no(b.commit()); assert.equal(await status("importBatches/a2"), "committing"); }
  await ok(setDoc(nodeRef(as("pa"), "a2", FINAL), newNodePayload("orgA"))); await ok(updateDoc(batchRef(as("pa"), "a2"), finish("completed", { chunksDone: 1 })));
  // a paired id whose framework is created in the same batch as the completion cannot complete either (framework must pre-exist)
  await seedBatch("a3"); { const db = as("pa"), b = writeBatch(db); b.set(fwRef(db, "a3"), newFwPayload("orgA", "pa")); b.set(nodeRef(db, "a3", FINAL), newNodePayload("orgA")); b.update(batchRef(db, "a3"), finish("completed", { chunksDone: 1 })); await no(b.commit()); }
});

test("3. clone creation + importBatch state change in ONE atomic batch: denied (the clone clause reads the committed batch state); a clone of a source whose batch is completed in the SAME batch, or of a source created in the same batch, is denied; the legitimate two-commit sequence works", async () => {
  await seedBatch("z1"); await seedFw("z1"); await seedNode("z1", FINAL);
  const cloneBody = (src) => newFwPayload("orgA", "pa", { name: "Ban sao", cloneSource: { frameworkId: src, nodeCount: 1 } });
  { const db = as("pa"), b = writeBatch(db); b.update(batchRef(db, "z1"), finish("completed", { chunksDone: 1 })); b.set(doc(collection(db, "curriculumFrameworks")), cloneBody("z1")); await no(b.commit()); assert.equal(await status("importBatches/z1"), "committing"); }
  { const db = as("pa"), b = writeBatch(db); b.set(doc(collection(db, "curriculumFrameworks")), cloneBody("z1")); b.update(batchRef(db, "z1"), finish("completed", { chunksDone: 1 })); await no(b.commit()); }
  { const db = as("pa"), b = writeBatch(db); b.update(batchRef(db, "z1"), finish("rolled_back")); b.set(doc(collection(db, "curriculumFrameworks")), cloneBody("z1")); await no(b.commit()); }   // (rolled_back itself is denied here too: framework still exists)
  // clone of a framework created in the same batch (source must pre-exist)
  { const db = as("pa"), b = writeBatch(db); b.set(batchRef(db, "z2"), newBatch("orgA", "pa", "z2")); b.set(fwRef(db, "z2"), newFwPayload("orgA", "pa")); b.set(doc(collection(db, "curriculumFrameworks")), cloneBody("z2")); await no(b.commit()); assert.equal((await getDoc(fwRef(as("pa"), "z2"))).exists(), false); }
  { const db = as("pa"), b = writeBatch(db); const manualClone = doc(collection(db, "curriculumFrameworks")); b.set(fwRef(db, "z3"), newFwPayload("orgA", "pa")); b.set(manualClone, cloneBody("z3")); await no(b.commit()); }   // manual source created in the same batch: also denied (pre-state)
  // while the batch is committing a clone is denied; after completion (separate commit) it is allowed
  await no(setDoc(doc(collection(as("pa"), "curriculumFrameworks")), cloneBody("z1")));
  await ok(updateDoc(batchRef(as("pa"), "z1"), finish("completed", { chunksDone: 1 })));
  await ok(setDoc(doc(collection(as("pa"), "curriculumFrameworks")), cloneBody("z1")));
  // the clone and a batch state change of an UNRELATED batch in one batch are independent: allowed when the source is clean
  await seedBatch("z4"); await seedFw("z4"); await seedNode("z4", FINAL);
  { const db = as("pa"), b = writeBatch(db); b.set(doc(collection(db, "curriculumFrameworks")), cloneBody("fwA_active")); b.update(batchRef(db, "z4"), { updatedAt: serverTimestamp(), chunksDone: 1 }); await ok(b.commit()); }
});

test("4. rolled_back + deletes in ONE atomic batch: denied (the cleanup witness is pre-state); deletes then rolled_back in two commits works; re-creating the paired framework in the same batch as rolled_back is allowed but leaves a governed, NON-activatable framework (fail-closed)", async () => {
  await seedBatch("rb1"); await seedFw("rb1"); await seedNode("rb1", FINAL);
  { const db = as("pa"), b = writeBatch(db); b.delete(nodeRef(db, "rb1", FINAL)); b.delete(fwRef(db, "rb1")); b.update(batchRef(db, "rb1"), finish("rolled_back", { resultCode: "COMMIT_FAILED" })); await no(b.commit()); assert.equal(await status("importBatches/rb1"), "committing"); }
  { const db = as("pa"), b = writeBatch(db); b.delete(nodeRef(db, "rb1", FINAL)); b.delete(fwRef(db, "rb1")); await ok(b.commit()); }
  await ok(updateDoc(batchRef(as("pa"), "rb1"), finish("rolled_back", { resultCode: "COMMIT_FAILED" })));
  // recreate in the same batch as the status change
  await seedBatch("rb2");
  { const db = as("pa"), b = writeBatch(db); b.update(batchRef(db, "rb2"), finish("rolled_back")); b.set(fwRef(db, "rb2"), newFwPayload("orgA", "pa", { name: "Tao lai" })); await ok(b.commit()); }
  assert.equal(await status("importBatches/rb2"), "rolled_back");
  await no(updateDoc(fwRef(as("pa"), "rb2"), activate("pa")));          // fail-closed: governed by a non-completed batch forever
});

test("5. ordering/overwrite bypass battery for the pairing: no sequence inside one atomic batch (set/update/delete of the pair, overwrite of an existing batch, status rewrites) activates a framework whose batch is not completed or detaches a framework from its batch", async () => {
  await seedBatch("o1"); await seedFw("o1"); await seedNode("o1", FINAL);
  const pa = as("pa");
  // overwrite / re-create the batch to a better state (set over an existing document is an UPDATE)
  await no(setDoc(batchRef(pa, "o1"), newBatch("orgA", "pa", "o1", { status: "completed", finishedAt: serverTimestamp(), chunksDone: 1 })));
  await ok(setDoc(batchRef(pa, "o1"), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp(), chunksDone: 1 }, { merge: true }));   // a merge-set is just an update: the legal completion (witness exists)
  assert.equal(await status("importBatches/o1"), "completed");
  // detach: delete the batch (never), recreate the framework under another id and clone (needs completed source)
  await no(deleteDoc(batchRef(pa, "o1")));
  for (const id of ["o2", "o3"]) await seedBatch(id);
  { const db = pa, b = writeBatch(db); b.update(batchRef(db, "o2"), { updatedAt: serverTimestamp(), organizationId: "orgB" }); await no(b.commit()); }
  { const db = pa, b = writeBatch(db); b.update(batchRef(db, "o3"), { updatedAt: serverTimestamp(), kind: "question" }); await no(b.commit()); }
  { const db = pa, b = writeBatch(db); b.set(batchRef(db, "o4"), newBatch("orgA", "pa", "o4")); b.set(batchRef(db, "o4"), newBatch("orgA", "pa", "o4", { status: "completed", finishedAt: serverTimestamp(), chunksDone: 1 })); await no(b.commit()); }   // create then "upgrade" in the same batch
  // a governed framework cannot be re-pointed: changing a framework's own id is impossible; creating another framework with the same id again is an update (immutable organization/scope/createdBy)
  await seedBatch("o5"); await seedFw("o5");
  await no(setDoc(fwRef(pa, "o5"), newFwPayload("orgA", "pa", { status: "active", activatedAt: serverTimestamp(), statusChangedAt: serverTimestamp(), statusChangedBy: "pa" })));
  await no(updateDoc(fwRef(pa, "o5"), activate("pa")));
  // activation with an unrelated completed batch of ANOTHER id does not help
  await seedBatch("o6", "orgA", "completed"); await seedFw("o7"); await seedBatch("o7");
  await no(updateDoc(fwRef(pa, "o7"), activate("pa")));
});

test("6. ACCEPTED TRUST-BOUNDARY LIMITATION (documented, not a Rules guarantee): an AUTHORIZED writer can set `completed` with only the witness node present, and the framework then activates; Rules cannot count or inspect the node set - completeness is verified by the P4-S4 controller read-back, not by Rules", async () => {
  // 600 nodes were planned (counts.accepted = 600) but only the witness node exists: Rules accept `completed`
  await seedBatch("t1", "orgA", "committing", { counts: { parsed: 600, accepted: 600, skipped: 0, failed: 0 }, chunksTotal: 2 });
  await seedFw("t1"); await seedNode("t1", FINAL);
  await ok(updateDoc(batchRef(as("pa"), "t1"), finish("completed", { chunksDone: 2 })));
  await ok(updateDoc(fwRef(as("pa"), "t1"), activate("pa")));
  assert.equal(await status("curriculumFrameworks/t1"), "active");
  // the same holds for an Organization Admin / capability holder (the authority is the P3 curriculum-write authority)
  for (const u of ["oaA", "capA"]) { const id = "t_" + u; await seedBatch(id); await seedFw(id); await seedNode(id, FINAL); await ok(updateDoc(batchRef(as(u), id), finish("completed", { chunksDone: 1 }))); await ok(updateDoc(fwRef(as(u), id), activate(u))); }
  // the witness is a point-in-time pre-state check: it may be deleted in the same batch that completes, and nodes of a not-yet-activated completed import stay editable/deletable draft data
  await seedBatch("t2"); await seedFw("t2"); await seedNode("t2", FINAL); await seedNode("t2", "other");
  { const db = as("pa"), b = writeBatch(db); b.update(batchRef(db, "t2"), finish("completed", { chunksDone: 1 })); b.delete(nodeRef(db, "t2", FINAL)); await ok(b.commit()); }
  assert.equal(await status("importBatches/t2"), "completed"); assert.equal((await getDoc(nodeRef(as("pa"), "t2", FINAL))).exists(), false, "witness gone after completion");
  await ok(updateDoc(fwRef(as("pa"), "t2"), activate("pa")));    // a completed batch is what the Rules require; node-level truth is NOT re-checked at activation
  // what the Rules DO still refuse: completion by a non-writer, in an archived organization, with the framework already active, or without ANY witness
  await seedBatch("t3"); await seedFw("t3"); await no(updateDoc(batchRef(as("pa"), "t3"), finish("completed", { chunksDone: 1 })));
  for (const u of ["mA", "revA", "oaB", "tSusp"]) { const id = "n_" + u; await seedBatch(id); await seedFw(id); await seedNode(id, FINAL); await no(updateDoc(batchRef(as(u), id), finish("completed", { chunksDone: 1 }))); }
  await seedBatch("t4"); await seedFw("t4", "orgA", "active"); await seedNode("t4", FINAL); await no(updateDoc(batchRef(as("pa"), "t4"), finish("completed", { chunksDone: 1 })));
});

test("7. the legitimate controller pattern works atomically: a chunk of node creates TOGETHER with the batch progress update in ONE commit (399 + 1 writes) succeeds for every writer, and is denied for a non-writer, so the guard does not make the atomic chunk commit unusable and does not open it to others", async () => {
  for (const u of WRITERS) {
    const id = "ch_" + u; await seedBatch(id); await seedFw(id);
    const db = as(u), b = writeBatch(db);
    for (let i = 0; i < 399; i++) b.set(nodeRef(db, id, "n" + String(i).padStart(4, "0")), newNodePayload("orgA", { order: i, name: "Nut " + i }));
    b.update(batchRef(db, id), { chunksDone: 1, updatedAt: serverTimestamp() });
    await ok(b.commit());
    assert.equal((await getDoc(batchRef(as("pa"), id))).data().chunksDone, 1);
  }
  await seedBatch("ch_x"); await seedFw("ch_x");
  { const db = as("mA"), b = writeBatch(db); for (let i = 0; i < 5; i++) b.set(nodeRef(db, "ch_x", "n" + i), newNodePayload("orgA", { order: i })); b.update(batchRef(db, "ch_x"), { chunksDone: 1, updatedAt: serverTimestamp() }); await no(b.commit()); }
  { const db = as("oaB"), b = writeBatch(db); b.update(batchRef(db, "ch_x"), { chunksDone: 1, updatedAt: serverTimestamp() }); await no(b.commit()); }
});

test("8. EXPRESSION-LIMIT HEADROOM (measurement): the emulator trace of a DENIED batch update mentions the 1000-expression evaluation cap. Measure the headroom of each P4-S1 update transition per principal by adding N copies of a minimal test-only predicate (importIntIn(1, 0, 5)) to the update rule of a test-only Rules variant; the production file is never changed", async () => {
  const marker = "allow update: if batchShapeOk(request.resource.data) &&";
  assert.equal(rules.split(marker).length - 1, 1);
  const cases = {
    progress: { fields: () => ({ chunksDone: 1, updatedAt: serverTimestamp() }), seedStatus: "committing", prep: [] },
    completed: { fields: () => finish("completed", { chunksDone: 1 }), seedStatus: "committing", prep: ["fw", "node"] },
    partial: { fields: () => finish("partial", { chunksDone: 0 }), seedStatus: "committing", prep: [] },
    rolled_back: { fields: () => finish("rolled_back"), seedStatus: "committing", prep: [] }
  };
  const ns = [0, 1, 2, 3, 4, 6, 8, 12, 16];
  const results = {};
  for (const n of ns) {
    const variant = rules.replace(marker, () => marker + " " + Array(n).fill("importIntIn(1, 0, 5) &&").join(" "));
    let venv; try { venv = await makeEnv("demo-p4s1-atomic-v" + n, variant); } catch { for (const cname of Object.keys(cases)) for (const u of ["pa", "oaA", "capA"]) (results[cname + "/" + u] ||= {})[n] = false; continue; }   // too complex to compile = not a usable variant
    try {
      for (const [cname, c] of Object.entries(cases)) for (const u of ["pa", "oaA", "capA"]) {
        const id = cname + "_" + u;
        await seedWorld(venv, { extra: async (db, put) => {
          if (c.prep.includes("fw")) await put("curriculumFrameworks/" + id, fwDoc("orgA", "draft"));
          if (c.prep.includes("node")) await put("curriculumFrameworks/" + id + "/nodes/" + FINAL, nodeDoc("orgA"));
          await put("importBatches/" + id, { ...batchBody("orgA", "pa", id, { chunksDone: 0 }), createdAt: D(7), updatedAt: D(7) });
        } });
        let passed = true;
        try { await assertSucceeds(updateDoc(batchRef(venv.authenticatedContext(u).firestore(), id), c.fields())); } catch { passed = false; }
        (results[cname + "/" + u] ||= {})[n] = passed;
      }
    } finally { await venv.cleanup(); }
  }
  const summary = {};
  for (const [k, v] of Object.entries(results)) summary[k] = Math.max(-1, ...ns.filter((n) => v[n]));
  console.log("P4-S1 ATOMIC EXPRESSION HEADROOM (largest N of the minimal predicate that still passes; -1 = baseline fails) " + JSON.stringify(summary));
  for (const [k, v] of Object.entries(results)) assert.equal(v[0], true, "baseline passes: " + k);
});

test("9. EXPRESSION-LIMIT HEADROOM OF THE TWO EDITED P3 PATHS (measurement): candidate vs the DEPLOYED P3-S1 Rules, same method (N copies of a trivial predicate in a test-only variant) - the edit must not materially reduce the margin of paths that are LIVE today", async () => {
  const deployed = execFileSync("git", ["show", "4a017ede0ebefe5fbc2bd37f1b6ec636f6f8708c:firestore.rules.production-candidate"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });   // the P3-S1 artifact deployed to production (ruleset 5945fbe7), read from git history so the evidence is self-contained
  assert.equal(sha(deployed), "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d", "the deployed P3-S1 artifact");
  const upd = "allow update: if fwShapeOk(request.resource.data) &&", crt = "allow create: if fwShapeOk(request.resource.data) &&";
  for (const r of [rules, deployed]) { assert.equal(r.split(upd).length - 1, 1); assert.equal(r.split(crt).length - 1, 1); }
  const ns = [0, 2, 4, 8, 16, 24, 32, 48];
  const out = { candidate: {}, deployed: {} };
  for (const [label, base] of [["candidate", rules], ["deployed", deployed]]) {
    for (const n of ns) {
      const pad = Array(n).fill("(1 == 1) &&").join(" ");
      let venv; try { venv = await makeEnv("demo-p4s1-atomic-w" + label + n, base.replace(upd, () => upd + " " + pad).replace(crt, () => crt + " " + pad)); } catch { for (const k of ["activate", "clone"]) for (const u of ["pa", "oaA", "capA"]) (out[label][k + "/" + u] ||= {})[n] = false; continue; }
      try {
        await seedWorld(venv, { extra: async (db, put) => { for (const u of ["pa", "oaA", "capA"]) await put("curriculumFrameworks/act_" + u, fwDoc("orgA", "draft")); } });
        for (const u of ["pa", "oaA", "capA"]) {
          const db = venv.authenticatedContext(u).firestore();
          let p1 = true, p2 = true;
          try { await assertSucceeds(updateDoc(fwRef(db, "act_" + u), activate(u))); } catch { p1 = false; }
          try { await assertSucceeds(setDoc(doc(collection(db, "curriculumFrameworks")), newFwPayload("orgA", u, { name: "Ban sao", cloneSource: { frameworkId: "fwA_active", nodeCount: 2 } }))); } catch { p2 = false; }
          (out[label]["activate/" + u] ||= {})[n] = p1; (out[label]["clone/" + u] ||= {})[n] = p2;
        }
      } finally { await venv.cleanup(); }
    }
  }
  const summary = {};
  for (const label of Object.keys(out)) { summary[label] = {}; for (const [k, v] of Object.entries(out[label])) summary[label][k] = Math.max(-1, ...ns.filter((n) => v[n])); }
  console.log("P4-S1 ATOMIC EDITED-P3-PATH HEADROOM (largest N of the trivial predicate that still passes) " + JSON.stringify(summary));
  for (const label of Object.keys(out)) for (const [k, v] of Object.entries(out[label])) assert.equal(v[0], true, label + " baseline passes: " + k);
});
