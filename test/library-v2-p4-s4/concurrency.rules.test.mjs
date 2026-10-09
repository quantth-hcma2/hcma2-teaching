// P4-S4 RULES DESIGN GATE - two-client concurrency and completion integrity.
//   PART 1  resume (client A) versus rollback (client B) on the SAME batch
//           1a production Rules + the reviewed controller: UNSAFE interleaving reproduced (rolled_back with an orphan node left behind)
//           1b FINAL proposal + prototype controller (rollback barrier): the same injection point is harmless; randomized real concurrency keeps the invariants
//   PART 2  completion integrity: a concurrent client acts at every point between the last node write and the completion
//           2a FINAL proposal + prototype (seal): nothing can be added / changed / deleted after the seal; before the seal only an import-shaped create is possible and it is detected
//           2b control: prototype WITHOUT the Rules (production Rules): the seal alone proves nothing - the Rules are the invariant
//           2c concurrent completion / concurrent rollback
// Run: firebase emulators:exec --only firestore --project demo-p4s4c --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/concurrency.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, fwRename, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController, verifyImportedDataset } from "../../import-commit-controller.mjs";
import { toNodePayload } from "../../import-plan.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, faulty, noSleep } from "./helpers.mjs";
import { freezeRules } from "./import-freeze-rules.mjs";
import { loadSealedController } from "./sealed-protocol.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485", "the base is the production artifact");
const SC = await loadSealedController();
const envProd = await makeEnv("demo-p4s4c", rules);
const envFreeze = await makeEnv("demo-p4s4c-freeze", freezeRules(rules));
after(async () => { await envProd.cleanup(); await envFreeze.cleanup(); });

const small = planFor(big(3, 20), { actorUid: "pa" });                                    // 63 nodes
const medium = planFor(big(3, 300), { actorUid: "pa" });                                  // 903 nodes, 3 chunks
const flip = (uid, n) => { let c = 0; return Object.assign(async () => (++c <= n ? { allowed: true } : { allowed: false, reason: "STOP" }), { actorUid: uid }); };
const adm = async (env, fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const snapshot = (env) => adm(env, async (db) => {
  const get = async (p) => { const s = await getDoc(doc(db, p)); return s.exists() ? { id: s.id, ...s.data() } : null; };
  return { batch: await get("importBatches/" + BATCH), framework: await get("curriculumFrameworks/" + BATCH), nodes: (await getDocs(collection(db, "curriculumFrameworks", BATCH, "nodes"))).docs.map((d) => ({ id: d.id, ...d.data() })) };
});
const exact = (plan, s) => !!s.framework && !!s.batch && verifyImportedDataset({ plan, framework: s.framework, batch: { ...s.batch, status: "committing" }, nodes: s.nodes }).ok;
const mk = (Mod, as, uid, extra = {}) => Mod.createImportCommitController({ db: as(uid), firestore: extra.fs || BASE_FS, retryDelays: [0, 0], sleep: noSleep, ...(extra.opts || {}) });
const run = (c, uid, plan, extra = {}) => c.commit({ plan, organizationId: "orgA", actorUid: uid, authorize: extra.authorize || allowAlways(uid), resume: !!extra.resume });
const rollback = (c, uid) => c.rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways(uid) });
const nodePayload = (plan, i) => toNodePayload(plan.nodes[i], { serverTimestamp });
const nodeRef = (db, id) => doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + id);

test("1a. PRODUCTION RULES + reviewed controller: resume (A) versus rollback (B) is UNSAFE - A creates a node after B's emptiness check; B deletes the framework and marks rolled_back; an ORPHAN node survives under a rolled_back batch", { timeout: 600000 }, async () => {
  const as = actors(envProd); await envProd.clearFirestore(); await seedWorld(envProd);
  await run(createImportCommitController({ db: as("pa"), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep }), "pa", medium, { authorize: flip("pa", 3) });   // interrupted after chunk 0 (400 nodes)
  let injected = false;
  const fs = faulty(BASE_FS, { write: async (ctx) => {
    if (ctx.op === "deleteDoc" && ctx.path === "curriculumFrameworks/" + BATCH && !injected) { injected = true; await setDoc(nodeRef(as("capA"), medium.nodes[600].id), nodePayload(medium, 600)); }   // client A (another administrator) resumes a write
    return ctx.perform();
  } });
  const result = await rollback(createImportCommitController({ db: as("oaA"), firestore: fs, retryDelays: [0, 0], sleep: noSleep }), "oaA");
  assert.equal(result.state, "rolled_back", "B believes the rollback is complete: " + JSON.stringify(result).slice(0, 160));
  const s = await snapshot(envProd);
  assert.equal(s.batch.status, "rolled_back"); assert.equal(s.framework, null); assert.equal(s.nodes.length, 1, "UNSAFE: an orphan node remains although the batch says rolled_back");
});

test("1b. FINAL PROPOSAL + rollback barrier: the same injection is refused (the batch is already partial), the rollback completes with ZERO nodes; an injection BEFORE the barrier is simply deleted afterwards", { timeout: 600000 }, async () => {
  const as = actors(envFreeze); await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  await run(mk(SC, as, "pa"), "pa", medium, { authorize: flip("pa", 3) });
  let outcome = null;
  const fs = faulty(BASE_FS, { write: async (ctx) => {
    if (ctx.op === "deleteDoc" && ctx.path === "curriculumFrameworks/" + BATCH && outcome === null) { try { await setDoc(nodeRef(as("capA"), medium.nodes[600].id), nodePayload(medium, 600)); outcome = "allowed"; } catch { outcome = "denied"; } }
    return ctx.perform();
  } });
  const result = await rollback(mk(SC, as, "oaA", { fs }), "oaA");
  assert.equal(outcome, "denied", "A's resume write is refused once the barrier (partial) is in place");
  assert.equal(result.state, "rolled_back", JSON.stringify(result).slice(0, 200));
  const s = await snapshot(envFreeze); assert.equal(s.batch.status, "rolled_back"); assert.equal(s.framework, null); assert.equal(s.nodes.length, 0, "no orphan");
  // injection BEFORE the barrier (A writes while B is still reading): the node exists, B's listing runs after the barrier and deletes it
  await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  await run(mk(SC, as, "pa"), "pa", medium, { authorize: flip("pa", 3) });
  let early = null;
  const fsEarly = faulty(BASE_FS, { write: async (ctx) => {
    if (ctx.op === "updateDoc" && ctx.data && ctx.data.status === "partial" && early === null) { try { await setDoc(nodeRef(as("capA"), medium.nodes[601].id), nodePayload(medium, 601)); early = "allowed"; } catch { early = "denied"; } }   // right before the barrier commits
    return ctx.perform();
  } });
  const r2 = await rollback(mk(SC, as, "oaA", { fs: fsEarly }), "oaA");
  assert.equal(early, "allowed"); assert.equal(r2.state, "rolled_back"); assert.equal((await snapshot(envFreeze)).nodes.length, 0);
});

test("1c. RANDOMIZED REAL CONCURRENCY (FINAL proposal): resume by A and rollback by B started with different offsets always end in ONE consistent terminal state - completed with the exact dataset, or rolled_back with no framework and no node", { timeout: 900000 }, async () => {
  const as = actors(envFreeze); const seen = {};
  for (const delayMs of [0, 150, 900, 2500, 5000, 8000, 11000]) {
    await envFreeze.clearFirestore(); await seedWorld(envFreeze);
    await run(mk(SC, as, "pa"), "pa", medium, { authorize: flip("pa", 3) });
    const A = run(mk(SC, as, "capA"), "capA", medium, { resume: true });
    const B = new Promise((r) => setTimeout(r, delayMs)).then(() => rollback(mk(SC, as, "oaA"), "oaA"));
    const [a, b] = await Promise.all([A, B]);
    let s = await snapshot(envFreeze);
    if (s.batch.status === "partial") { const again = await rollback(mk(SC, as, "oaA"), "oaA"); assert.equal(again.state, "rolled_back", JSON.stringify(again).slice(0, 160)); s = await snapshot(envFreeze); }
    const key = s.batch.status; seen[key] = (seen[key] || 0) + 1;
    if (s.batch.status === "completed") { assert.equal(exact(medium, s), true, "completed => exact dataset (offset " + delayMs + ")"); assert.notEqual(b.state, "rolled_back"); }
    else { assert.equal(s.batch.status, "rolled_back", "offset " + delayMs + ": A=" + a.state + " B=" + b.state); assert.equal(s.framework, null); assert.equal(s.nodes.length, 0, "no orphan (offset " + delayMs + ")"); assert.notEqual(a.state, "completed"); }
  }
  console.log("terminal states over 7 offsets:", JSON.stringify(seen));
});

// ---------------------------------------------------------------- PART 2
const tampers = {
  extraHex: (db) => setDoc(nodeRef(db, "e".repeat(32)), lessonPayload("orgA", small.nodes[0].id, { name: "Nút thừa (hex)", order: 999, code: "ZZ-HEX" })),
  extraAuto: (db) => setDoc(nodeRef(db, "AutoId0123456789abcde"), lessonPayload("orgA", small.nodes[0].id, { name: "Nút thừa (tự sinh)", order: 998, code: "ZZ-AUTO" })),
  update: (db) => updateDoc(nodeRef(db, small.nodes[5].id), nodeEdit({ name: "Sửa đổi đồng thời" })),
  reorder: (db) => updateDoc(nodeRef(db, small.nodes[5].id), nodeEdit({ order: 77 })),
  deleteNode: (db) => deleteDoc(nodeRef(db, small.nodes[5].id)),
  rename: (db) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH), fwRename("Đổi tên đồng thời")),
  deleteFramework: (db) => deleteDoc(doc(db, "curriculumFrameworks/" + BATCH))
};
// points: beforeSeal (right before the seal write), afterSeal (right after it, before the verification read), beforeCompletion (after the verification, right before the completion write)
async function windowRun(env, Mod, as, point, kind, opts = {}) {
  await env.clearFirestore(); await seedWorld(env);
  const out = { tamper: null }; let fired = false;
  const fire = async () => { if (fired) return; fired = true; try { await tampers[kind](as("capA")); out.tamper = "allowed"; } catch { out.tamper = "denied"; } };
  const total = small.chunks.length;
  const fs = faulty(BASE_FS, { write: async (ctx) => {
    const isSeal = ctx.op === "updateDoc" && ctx.data && ctx.data.chunksDone === total && !ctx.data.status;
    const isComplete = ctx.op === "updateDoc" && ctx.data && ctx.data.status === "completed";
    if (point === "beforeSeal" && isSeal) await fire();
    if (point === "beforeCompletion" && isComplete) await fire();
    const r = await ctx.perform();
    if (point === "afterSeal" && isSeal) await fire();
    return r;
  } });
  const result = await run(mk(Mod, as, "pa", { fs, opts }), "pa", small);
  const s = await snapshot(env);
  return { out, result, s };
}

test("2a. FINAL PROPOSAL + seal: after the seal nothing can be created / changed / deleted by a concurrent client; the import completes over exactly the verified dataset", { timeout: 900000 }, async () => {
  const as = actors(envFreeze); const table = [];
  for (const point of ["afterSeal", "beforeCompletion"]) for (const kind of Object.keys(tampers)) {
    const { out, result, s } = await windowRun(envFreeze, SC, as, point, kind);
    table.push([point, kind, out.tamper, result.state, s.batch.status]);
    assert.equal(out.tamper, "denied", point + "/" + kind + ": the Rules refuse the concurrent client");
    assert.equal(result.state, "completed", point + "/" + kind + " " + JSON.stringify(result).slice(0, 200)); assert.equal(exact(small, s), true, point + "/" + kind);
  }
  console.log(table.map((r) => r.join(" | ")).join("\n"));
});

test("2a'. BEFORE the seal the only possible concurrent mutation is an import-shaped CREATE (32 hex) - the post-seal verification sees it and the batch becomes partial, never completed; everything else is refused", { timeout: 900000 }, async () => {
  const as = actors(envFreeze);
  for (const kind of Object.keys(tampers)) {
    const { out, result, s } = await windowRun(envFreeze, SC, as, "beforeSeal", kind);
    if (kind === "extraHex") { assert.equal(out.tamper, "allowed"); assert.equal(result.state, "verification-failed", JSON.stringify(result).slice(0, 200)); assert.equal(s.batch.status, "partial"); assert.equal(result.verification.counts.extra, 1); }
    else { assert.equal(out.tamper, "denied", kind); assert.equal(result.state, "completed", kind + " " + JSON.stringify(result).slice(0, 200)); assert.equal(exact(small, s), true, kind); }
  }
});

test("2b. CONTROL - the prototype controller WITHOUT the freeze Rules (production Rules): the concurrent client gets through and the batch completes over drift - the seal protocol proves nothing by itself, the RULES are the invariant", { timeout: 900000 }, async () => {
  const as = actors(envProd);
  for (const kind of ["extraHex", "update", "deleteNode", "rename"]) {
    const { out, result, s } = await windowRun(envProd, SC, as, "beforeCompletion", kind);
    assert.equal(out.tamper, "allowed", kind); assert.equal(s.batch.status, "completed", kind + " " + result.state); assert.equal(exact(small, s), false, kind + ": completed over a drifted dataset");
  }
});

test("2c. CONCURRENT COMPLETION and CONCURRENT ROLLBACK in the window (FINAL proposal): a second completer is harmless; a rollback barrier inside the window stops the completion and the rollback finishes cleanly; completion after a finished rollback is impossible", { timeout: 900000 }, async () => {
  const as = actors(envFreeze);
  // two completers: B completes first (inside A's window); A's completion finds the batch completed
  await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  const fs = faulty(BASE_FS, { write: async (ctx) => { if (ctx.op === "updateDoc" && ctx.data && ctx.data.status === "completed" && !fs.done) { fs.done = true; const b = await run(mk(SC, as, "oaA"), "oaA", small, { resume: true }); fs.other = b.state; } return ctx.perform(); } });
  const a = await run(mk(SC, as, "pa", { fs }), "pa", small);
  assert.equal(fs.other, "completed"); assert.equal(a.state, "completed", JSON.stringify(a).slice(0, 200)); assert.equal((await snapshot(envFreeze)).batch.status, "completed"); assert.equal(exact(small, await snapshot(envFreeze)), true);
  // rollback barrier inside the window
  await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  const fs2 = faulty(BASE_FS, { write: async (ctx) => { if (ctx.op === "updateDoc" && ctx.data && ctx.data.status === "completed" && !fs2.done) { fs2.done = true; fs2.other = await ctx.perform === undefined ? null : (await mk(SC, as, "capA").abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).state; } return ctx.perform(); } });
  const a2 = await run(mk(SC, as, "pa", { fs: fs2 }), "pa", small);
  assert.equal(fs2.other, "partial"); assert.notEqual(a2.state, "completed"); assert.equal(a2.state, "not-committing", JSON.stringify(a2).slice(0, 200));
  assert.equal((await rollback(mk(SC, as, "capA"), "capA")).state, "rolled_back"); const s = await snapshot(envFreeze); assert.equal(s.nodes.length, 0); assert.equal(s.framework, null);
  // completion after a finished rollback is impossible
  const late = await run(mk(SC, as, "pa"), "pa", small, { resume: true }); assert.notEqual(late.state, "completed"); assert.equal((await snapshot(envFreeze)).batch.status, "rolled_back");
});
