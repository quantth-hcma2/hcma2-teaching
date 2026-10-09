// P4-S4 - the REAL commit / recovery / rollback controller against the PRODUCTION Firestore Rules artifact (ruleset 0b6910c3, SHA-256 7F7C790E...0485) on the emulator.
// The Rules are NOT modified. Synthetic data only. Fault injection wraps the Firestore functions handed to the controller (network failure, ambiguous commit, hung write, tampering).
// Run: firebase emulators:exec --only firestore --project demo-p4s4 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/controller.rules.test.mjs"   (Java 21)
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, getDoc, getDocs, collection, fwTransition, newFwPayload, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController, RESULT_CODES } from "../../import-commit-controller.mjs";
import { toNodePayload } from "../../import-plan.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, faulty, transientError, never, noSleep } from "./helpers.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485", "the Rules under test are the production artifact");
const env = await makeEnv("demo-p4s4", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const ctl = (uid, fs = BASE_FS, extra = {}) => createImportCommitController({ db: as(uid), firestore: fs, retryDelays: [0, 0], stepTimeoutMs: 30000, sleep: noSleep, ...extra });
const adm = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (path) => adm(async (db) => { const s = await getDoc(doc(db, path)); return s.exists() ? { id: s.id, ...s.data() } : null; });
const nodesOf = (id = BATCH) => adm(async (db) => (await getDocs(collection(db, "curriculumFrameworks", id, "nodes"))).docs.map((d) => ({ id: d.id, ...d.data() })));
const run = (uid, plan, extra = {}) => ctl(uid, extra.fs || BASE_FS, extra.ctl).commit({ plan, organizationId: plan.organizationId, actorUid: uid, authorize: "authorize" in extra ? extra.authorize : allowAlways(uid), onProgress: extra.onProgress, resume: !!extra.resume });
const flip = (uid, n) => { let calls = 0; return Object.assign(async () => (++calls <= n ? { allowed: true } : { allowed: false, reason: "FLIPPED" }), { actorUid: uid }); };
const activate = (uid) => fwTransition(uid, "active", { activatedAt: serverTimestamp() });
const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const clean = async (id = BATCH) => ({ batch: await read("importBatches/" + id), framework: await read("curriculumFrameworks/" + id), nodes: (await nodesOf(id)).length });

for (const uid of ["pa", "oaA", "capA"]) {
  test("COMMIT (" + uid + "): batch -> framework -> chunks -> full read-back -> completed; the read-back state is confirmed; activation is then eligible and the P3 lifecycle activates it", async () => {
    const plan = planFor(big(3, 20), { actorUid: uid });
    const events = [];
    const r = await run(uid, plan, { onProgress: (e) => events.push(e.phase) });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, "completed"); assert.equal(r.nodesWritten, 63);
    assert.deepEqual([...new Set(events)], ["batch", "framework", "scan", "nodes", "verify", "complete", "confirm", "done"]);
    const s = await clean(); assert.equal(s.nodes, 63); assert.equal(s.batch.status, "completed"); assert.equal(s.batch.chunksDone, s.batch.chunksTotal); assert.equal(s.batch.importer, uid);
    assert.equal(s.framework.status, "draft"); assert.equal(s.framework.createdBy, uid); assert.equal(s.framework.name, plan.framework.name);
    assert.equal(r.eligibility.eligible, true); assert.equal(r.verification.ok, true);
    await ok(updateDoc(doc(as(uid), "curriculumFrameworks/" + BATCH), activate(uid)));
  });
}

test("AUTHORIZATION: unauthorized principals write NOTHING - denied by the pre-write check, and (even with a stale/rogue allow) by the production Rules", async () => {
  const plan = planFor(big(2, 5), { organization: "orgA" });
  for (const uid of ["mA", "revA", "noMember", "capSuspMem", "capRemoved", "tSusp"]) {
    const refused = await run(uid, plan, { authorize: async () => ({ allowed: false, reason: "NO_CAPABILITY" }) });
    assert.equal(refused.state, "denied"); assert.equal((await clean()).batch, null);
    const rogue = await run(uid, plan);                                       // the pre-write check says yes: the Rules still say no
    assert.equal(rogue.ok, false, uid); assert.equal(rogue.state, "denied", uid); assert.deepEqual(await clean(), { batch: null, framework: null, nodes: 0 });
  }
  const failing = await run("pa", plan, { authorize: async () => { throw new Error("boom"); } }); assert.equal(failing.state, "denied"); assert.equal(failing.reason, "ACCESS_CHECK_FAILED");
  assert.equal((await run("pa", plan, { authorize: undefined })).reason, "NO_AUTHORIZER"); assert.deepEqual(await clean(), { batch: null, framework: null, nodes: 0 });
});

test("ARCHIVED ORGANIZATION: nothing is written for ANY writer (Platform Admin, Organization Admin, capability holder); the Rules are the authority", async () => {
  for (const uid of ["pa", "oaC", "capC"]) {
    const plan = planFor(big(2, 3), { organization: "orgC", actorUid: uid, status: "active" });          // the client believes it is active; the Rules know it is archived
    const r = await run(uid, plan);
    assert.equal(r.ok, false, uid); assert.equal(r.state, "denied", uid); assert.deepEqual(await clean(), { batch: null, framework: null, nodes: 0 }, uid);
  }
});

test("CROSS-ORGANIZATION: another organization's admin cannot import into, resume, abandon or roll back an organization it does not govern; the locked organization must equal the plan's", async () => {
  const plan = planFor(big(2, 5), { organization: "orgA" });
  const mismatch = await ctl("pa").commit({ plan, organizationId: "orgB", actorUid: "pa", authorize: allowAlways("pa") }); assert.equal(mismatch.state, "organization-mismatch");
  const wrong = await run("oaB", plan); assert.equal(wrong.state, "denied"); assert.deepEqual(await clean(), { batch: null, framework: null, nodes: 0 });
  assert.equal((await run("pa", plan)).state, "completed");
  const batchBefore = await read("importBatches/" + BATCH);
  assert.equal((await ctl("oaB").rollback({ batchId: BATCH, organizationId: "orgB", authorize: allowAlways("oaB") })).state, "organization-mismatch");        // batch belongs to orgA
  const rogue = await ctl("oaB").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaB") }); assert.equal(rogue.ok, false);
  assert.equal((await ctl("oaB").abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaB") })).ok, false);
  assert.deepEqual(await read("importBatches/" + BATCH), batchBefore); assert.equal((await nodesOf()).length, 12);
});

test("NETWORK: a transient failure before the commit is retried; the dataset is exact and every retry is idempotent", async () => {
  const plan = planFor(big(3, 300));                                    // 903 nodes -> 3 chunks
  const counters = {}; let failed = 0;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { if (ctx.commitIndex === 2 && failed++ < 1) throw transientError(); return ctx.perform(); } }, counters);
  const r = await run("pa", plan, { fs });
  assert.equal(r.state, "completed", JSON.stringify(r)); assert.equal(failed, 1); assert.equal((await nodesOf()).length, 903); assert.equal(r.verification.counts.missing, 0);
});
test("AMBIGUOUS COMMIT: the commit reached the server but the client saw an error - the chunk probe finds it and nothing is duplicated or rejected", async () => {
  const plan = planFor(big(3, 300)); let thrown = 0;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); if (ctx.commitIndex === 2 && thrown++ < 1) throw transientError(); } });
  const r = await run("pa", plan, { fs });
  assert.equal(r.state, "completed", JSON.stringify(r)); assert.equal(thrown, 1); assert.equal((await nodesOf()).length, 903);
});
test("NETWORK DOWN -> PAUSED -> RESUME: a persistent failure pauses with the batch still committing; a NEW controller (browser refresh) resumes and completes without duplicates", async () => {
  const plan = planFor(big(3, 300));
  const down = faulty(BASE_FS, { commit: async (ctx) => { if (ctx.commitIndex >= 2) throw transientError(); return ctx.perform(); } });
  const first = await run("pa", plan, { fs: down });
  assert.equal(first.state, "paused", JSON.stringify(first)); assert.equal(first.phase, "nodes"); assert.equal(first.nodesWritten, 400);
  let s = await clean(); assert.equal(s.batch.status, "committing"); assert.equal(s.nodes, 400); assert.equal(s.framework.status, "draft"); assert.equal(s.batch.chunksDone, 1);
  const found = await ctl("pa").findIncomplete("orgA"); assert.equal(found.length, 1); assert.equal(found[0].id, BATCH);
  const rebuilt = planFor(big(3, 300));                                // re-selecting the same file rebuilds the same deterministic plan
  const second = await run("pa", rebuilt, { resume: true });
  assert.equal(second.state, "completed", JSON.stringify(second)); s = await clean(); assert.equal(s.nodes, 903); assert.equal(s.batch.status, "completed");
  assert.deepEqual(await ctl("pa").findIncomplete("orgA"), []);
});
test("HUNG WRITE (offline queue): a commit that never settles times out as transient, is retried, and the server state decides - no duplicate, no false success", async () => {
  const plan = planFor(big(3, 300)); let hung = 0;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { if (ctx.commitIndex === 2 && hung++ < 1) return never(); return ctx.perform(); } });
  const r = await run("pa", plan, { fs, ctl: { stepTimeoutMs: 15000 } });
  assert.equal(r.state, "completed", JSON.stringify(r)); assert.equal(hung, 1); assert.equal((await nodesOf()).length, 903);
});
test("PARTIAL DATA (not chunk aligned) is reconciled: only the MISSING nodes are written, progress is derived from real data, the counter is never trusted", async () => {
  const plan = planFor(big(3, 30));                                    // 93 nodes, 1 chunk
  const pa = as("pa");
  await ok(setDoc(doc(pa, "importBatches/" + BATCH), { schemaVersion: 1, kind: "curriculum", organizationId: "orgA", destination: { type: "curriculumFramework", frameworkId: BATCH }, templateId: plan.batch.templateId, templateVersion: plan.batch.templateVersion, sourceFile: plan.batch.sourceFile, importer: "pa", status: "committing", counts: plan.batch.counts, chunksDone: 0, chunksTotal: plan.batch.chunksTotal, warningsSummary: plan.batch.warningsSummary, finalNodeId: plan.batch.finalNodeId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await ok(setDoc(doc(pa, "curriculumFrameworks/" + BATCH), newFwPayload("orgA", "pa", { name: plan.framework.name })));
  const picks = [plan.nodes[3], plan.nodes[40], plan.nodes[92], plan.nodes[0]];
  for (const n of picks) await ok(setDoc(doc(pa, "curriculumFrameworks/" + BATCH + "/nodes/" + n.id), toNodePayload(n, { serverTimestamp })));
  const counters = {}; const sizes = [];
  const fs = faulty(BASE_FS, { commit: async (ctx) => { sizes.push(ctx.ops.length); return ctx.perform(); } }, counters);
  const r = await run("pa", plan, { fs, resume: true });
  assert.equal(r.state, "completed", JSON.stringify(r)); assert.deepEqual(sizes, [93 - picks.length]); assert.equal((await nodesOf()).length, 93);
});
test("REFRESH / RE-ENTRY: an interrupted import is found by findIncomplete, matches only the SAME file, and a fresh controller finishes it; a different file never resumes it", async () => {
  const plan = planFor(big(3, 300));
  const stopped = await run("pa", plan, { authorize: flip("pa", 3) });             // batch, framework, chunk 0 allowed; chunk 1 refused (the "tab was closed")
  assert.equal(stopped.state, "denied"); assert.equal(stopped.nodesWritten, 400);
  const [incomplete] = await ctl("pa").findIncomplete("orgA");
  assert.equal(incomplete.status, "committing"); assert.equal(incomplete.organizationId, "orgA");
  const other = planFor(big(2, 3), { batchId: incomplete.id });
  const mismatch = await run("pa", other, { resume: true }); assert.equal(mismatch.state, "identity-mismatch");
  assert.equal((await ctl("pa").findIncomplete("orgB")).length, 0, "other organizations see nothing");
  const done = await run("pa", planFor(big(3, 300), { batchId: incomplete.id }), { resume: true }); assert.equal(done.state, "completed", JSON.stringify(done)); assert.equal((await nodesOf()).length, 903);
});
test("DUPLICATE EXECUTION: a second NEW import is blocked while one is incomplete; two concurrent executions of the same plan end with ONE exact dataset; a finished import allows the next one", async () => {
  const plan = planFor(big(3, 100));
  const [a, b] = await Promise.all([run("pa", plan), run("pa", plan)]);
  assert.ok([a, b].some((r) => r.state === "completed"), JSON.stringify([a.state, b.state, a.phase, b.phase]));
  const s = await clean(); assert.equal(s.nodes, 303); assert.equal(s.batch.status === "completed" || s.batch.status === "committing", true);
  if (s.batch.status !== "completed") assert.equal((await run("pa", plan, { resume: true })).state, "completed");
  assert.equal((await ctl("pa").readBatch(BATCH)).status, "completed"); assert.equal((await nodesOf()).length, 303);
  const frameworks = await adm(async (db) => (await getDocs(collection(db, "curriculumFrameworks"))).docs.filter((d) => d.data().organizationId === "orgA" && d.id === BATCH).length); assert.equal(frameworks, 1);
  // blocked while incomplete
  const second = planFor(big(2, 5), { batchId: "Zy98Xw76Vu54Ts32Rq10" });
  await run("pa", planFor(big(3, 300), { batchId: "Mn11Op22Qr33St44Uv55" }), { authorize: flip("pa", 3) });
  const blocked = await run("pa", second); assert.equal(blocked.state, "blocked"); assert.equal(blocked.reason, "INCOMPLETE_EXISTS"); assert.equal(await read("importBatches/Zy98Xw76Vu54Ts32Rq10"), null);
  assert.equal((await ctl("pa").rollback({ batchId: "Mn11Op22Qr33St44Uv55", organizationId: "orgA", authorize: allowAlways("pa") })).state, "rolled_back");
  assert.equal((await run("pa", second)).state, "completed");
});

test("VERIFICATION - MISSING node (deleted behind the controller's back before the read-back): completion is blocked, the batch stays committing, a resume repairs it", async () => {
  const plan = planFor(big(3, 300)); const victim = plan.nodes[500].id;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); if (ctx.commitIndex === 3) await adm(async (db) => { await (await import("firebase/firestore")).deleteDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + victim)); }); } });
  const r = await run("pa", plan, { fs });
  assert.equal(r.state, "incomplete", JSON.stringify(r)); assert.equal(r.verification.counts.missing, 1); assert.equal(r.verification.repairable, true);
  let s = await clean(); assert.equal(s.batch.status, "committing"); assert.equal(s.nodes, 902);
  const fixed = await run("pa", planFor(big(3, 300)), { resume: true }); assert.equal(fixed.state, "completed", JSON.stringify(fixed)); assert.equal((await nodesOf()).length, 903);
});
test("VERIFICATION - EXTRA node: completion is blocked, the batch becomes partial (only rollback can follow), activation is impossible", async () => {
  const plan = planFor(big(3, 20));
  const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); await adm((db) => setDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + "e".repeat(32)), { ...toNodePayload(plan.nodes[5], { serverTimestamp: () => new Date() }), name: "Nút thừa", code: "EXTRA" })); } });
  const r = await run("pa", plan, { fs });
  assert.equal(r.state, "verification-failed", JSON.stringify(r)); assert.equal(r.verification.counts.extra, 1); assert.equal(r.markedPartial, true);
  const s = await clean(); assert.equal(s.batch.status, "partial"); assert.equal(s.batch.resultCode, RESULT_CODES.verifyFailed);
  await no(updateDoc(doc(as("pa"), "curriculumFrameworks/" + BATCH), activate("pa")));
  assert.equal((await run("pa", planFor(big(3, 20)), { resume: true })).state, "not-committing");
  const rb = await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") }); assert.equal(rb.state, "rolled_back"); assert.deepEqual(await clean(), { batch: { ...(await read("importBatches/" + BATCH)) }, framework: null, nodes: 0 });
});
test("VERIFICATION - ALTERED nodes (name, order, duplicate canonical code): each blocks completion, marks the batch partial, and never reaches 'completed'", async () => {
  const variants = [
    ["name", (plan) => ({ id: plan.nodes[8].id, change: { name: "Tên bị sửa" } })],
    ["order", (plan) => ({ id: plan.nodes[9].id, change: { order: 77 } })],
    ["code", (plan) => ({ id: plan.nodes[10].id, change: { code: plan.nodes[11].code.toLowerCase() } })]
  ];
  for (const [label, pick] of variants) {
    await env.clearFirestore(); await seedWorld(env);
    const plan = planFor(big(3, 20)); const { id, change } = pick(plan);
    const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); await adm((db) => updateDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + id), change)); } });
    const r = await run("pa", plan, { fs });
    assert.equal(r.state, "verification-failed", label + JSON.stringify(r)); assert.ok(r.verification.counts.altered >= 1, label);
    assert.equal((await clean()).batch.status, "partial", label);
  }
});
test("WHY THE CONTROLLER VERIFIES: the Rules alone accept 'completed' with a missing middle node (they only witness the final node) - and the controller refuses to get there", async () => {
  const plan = planFor(big(3, 20));
  // build a complete import by hand, then remove a MIDDLE node: the Rules still allow completion (documented P4-S1 limit)
  const pa = as("pa");
  await ok(setDoc(doc(pa, "importBatches/" + BATCH), { schemaVersion: 1, kind: "curriculum", organizationId: "orgA", destination: { type: "curriculumFramework", frameworkId: BATCH }, templateId: plan.batch.templateId, templateVersion: plan.batch.templateVersion, sourceFile: plan.batch.sourceFile, importer: "pa", status: "committing", counts: plan.batch.counts, chunksDone: 0, chunksTotal: plan.batch.chunksTotal, warningsSummary: plan.batch.warningsSummary, finalNodeId: plan.batch.finalNodeId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await ok(setDoc(doc(pa, "curriculumFrameworks/" + BATCH), newFwPayload("orgA", "pa", { name: plan.framework.name })));
  for (const n of plan.nodes) if (n.ordinal !== 20) await ok(setDoc(doc(pa, "curriculumFrameworks/" + BATCH + "/nodes/" + n.id), toNodePayload(n, { serverTimestamp })));
  const raw = await ok(updateDoc(doc(pa, "importBatches/" + BATCH), { status: "completed", chunksDone: plan.batch.chunksTotal, finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }).then(() => true));
  assert.ok(raw !== false);
  assert.equal((await read("importBatches/" + BATCH)).status, "completed");
  assert.equal((await nodesOf()).length, plan.nodes.length - 1, "completed with a hole - exactly what the controller's read-back prevents");
  await env.clearFirestore(); await seedWorld(env);
  const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); await adm((db) => import("firebase/firestore").then((m) => m.deleteDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + plan.nodes[20].id)))); } });
  const guarded = await run("pa", plan, { fs }); assert.notEqual(guarded.state, "completed"); assert.equal((await read("importBatches/" + BATCH)).status, "committing");
});

test("COMPLETION & ACTIVATION RULES (production Rules): activation is denied while committing and partial, allowed once completed; 'completed' needs chunksDone == chunksTotal and the paired draft framework", async () => {
  const plan = planFor(big(3, 300));
  const stopped = await run("pa", plan, { authorize: flip("pa", 3) }); assert.equal(stopped.state, "denied");
  const pa = as("pa");
  await no(updateDoc(doc(pa, "curriculumFrameworks/" + BATCH), activate("pa")));                                       // committing
  await no(updateDoc(doc(pa, "importBatches/" + BATCH), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));   // chunksDone 1 != 3 (and no witness yet)
  assert.equal((await ctl("pa").abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") })).state, "partial");
  await no(updateDoc(doc(pa, "curriculumFrameworks/" + BATCH), activate("pa")));                                       // partial
  await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  const again = planFor(big(3, 300), { batchId: "Qa11Wb22Ec33Rd44Tf55" });
  assert.equal((await run("pa", again)).state, "completed");
  await ok(updateDoc(doc(pa, "curriculumFrameworks/Qa11Wb22Ec33Rd44Tf55"), activate("pa")));                         // completed -> P3 activation allowed
  await no(updateDoc(doc(pa, "importBatches/Qa11Wb22Ec33Rd44Tf55"), { status: "partial", resultCode: "X", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));   // completed is terminal
});
test("NO LAUNDERING THROUGH CLONE: an incomplete (committing / partial) import cannot be cloned; a completed one can; a rolled-back one has nothing to clone", async () => {
  const plan = planFor(big(3, 300));
  await run("pa", plan, { authorize: flip("pa", 3) });                                                                    // committing, 400 nodes
  const pa = as("pa"); const cloneOf = (id, name) => ({ ...newFwPayload("orgA", "pa", { name }), cloneSource: { frameworkId: id, nodeCount: 400 } });
  await no(setDoc(doc(pa, "curriculumFrameworks/cloneA"), cloneOf(BATCH, "Bản sao A")));
  await ctl("pa").abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  await no(setDoc(doc(pa, "curriculumFrameworks/cloneB"), cloneOf(BATCH, "Bản sao B")));
  await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  await no(setDoc(doc(pa, "curriculumFrameworks/cloneC"), cloneOf(BATCH, "Bản sao C")));
  const done = planFor(big(2, 5), { batchId: "Ll11Mm22Nn33Oo44Pp55" });
  assert.equal((await run("pa", done)).state, "completed");
  await ok(setDoc(doc(pa, "curriculumFrameworks/cloneD"), { ...newFwPayload("orgA", "pa", { name: "Bản sao D" }), cloneSource: { frameworkId: "Ll11Mm22Nn33Oo44Pp55", nodeCount: 7 } }));
});

test("ROLLBACK from committing / partial / batch-only: nodes, then the framework, then rolled_back; the batch is kept; unrelated data is untouched; a repeat is a no-op", async () => {
  const unrelated = await clean("fwA_draft"); assert.equal(unrelated.nodes, 2);
  const unrelatedNodes = JSON.stringify((await nodesOf("fwA_draft")).map((n) => n.id).sort());
  // A. mid-way (committing)
  const plan = planFor(big(3, 300));
  await run("pa", plan, { authorize: flip("pa", 3) });
  const events = [];
  const rb = await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa"), onProgress: (e) => events.push(e.phase) });
  assert.equal(rb.state, "rolled_back", JSON.stringify(rb)); assert.equal(rb.nodesDeleted, 400); assert.deepEqual([...new Set(events)], ["rollback-nodes", "rollback-framework", "rollback-batch"]);
  let s = await clean(); assert.equal(s.framework, null); assert.equal(s.nodes, 0); assert.equal(s.batch.status, "rolled_back"); assert.equal(s.batch.resultCode, RESULT_CODES.rolledBack); assert.ok(s.batch.finishedAt);
  assert.equal((await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") })).already, true);
  // B. partial (abandoned)
  const planB = planFor(big(2, 10), { batchId: "Bb11Cc22Dd33Ee44Ff55" });
  await run("pa", planB, { authorize: flip("pa", 2) });                                                               // batch + framework, no nodes
  assert.equal((await ctl("pa").abandon({ batchId: planB.batch.id, organizationId: "orgA", authorize: allowAlways("pa") })).state, "partial");
  assert.equal((await ctl("pa").rollback({ batchId: planB.batch.id, organizationId: "orgA", authorize: allowAlways("pa") })).state, "rolled_back");
  // C. batch only (the framework was never created)
  const planC = planFor(big(2, 10), { batchId: "Gg11Hh22Ii33Jj44Kk55" });
  await run("pa", planC, { authorize: flip("pa", 1) });
  assert.equal((await read("importBatches/" + planC.batch.id)).status, "committing"); assert.equal(await read("curriculumFrameworks/" + planC.batch.id), null);
  assert.equal((await ctl("pa").rollback({ batchId: planC.batch.id, organizationId: "orgA", authorize: allowAlways("pa") })).state, "rolled_back");
  assert.equal(JSON.stringify((await nodesOf("fwA_draft")).map((n) => n.id).sort()), unrelatedNodes); assert.equal((await clean("fwA_draft")).framework.status, "draft");
});
test("ROLLBACK safety: a completed batch is not rolled back by the controller (terminal); unauthorized users and an archived organization cannot roll back; the capability holder can", async () => {
  const done = planFor(big(2, 5), { batchId: "Dd11Ee22Ff33Gg44Hh55" });
  assert.equal((await run("pa", done)).state, "completed");
  assert.equal((await ctl("pa").rollback({ batchId: done.batch.id, organizationId: "orgA", authorize: allowAlways("pa") })).state, "not-rollbackable");
  const plan = planFor(big(3, 300));
  await run("capA", plan, { authorize: flip("capA", 3) });
  assert.equal((await ctl("mA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: async () => ({ allowed: false, reason: "NO_CAPABILITY" }) })).state, "denied");
  const rogue = await ctl("mA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("mA") }); assert.equal(rogue.ok, false);
  assert.equal((await clean()).nodes, 400);
  assert.equal((await ctl("capA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("capA") })).state, "rolled_back");
  assert.equal((await ctl("pa").rollback({ batchId: "ghost", organizationId: "orgA", authorize: allowAlways("pa") })).state, "organization-mismatch");
});
test("ROLLBACK of a NETWORK-INTERRUPTED rollback resumes and finishes (idempotent, the batch is never deleted)", async () => {
  const plan = planFor(big(3, 300)); await run("pa", plan);                       // completed? no: use an incomplete one instead
  await env.clearFirestore(); await seedWorld(env);
  await run("pa", plan, { authorize: flip("pa", 5) });                            // 800 nodes written
  let failing = true;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { if (failing && ctx.commitIndex >= 2) throw transientError(); return ctx.perform(); } });
  const first = await ctl("pa", fs).rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  assert.equal(first.state, "paused", JSON.stringify(first)); assert.equal((await clean()).batch.status, "committing");
  failing = false;
  const second = await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") }); assert.equal(second.state, "rolled_back"); assert.deepEqual({ ...(await clean()), batch: (await clean()).batch.status }, { batch: "rolled_back", framework: null, nodes: 0 });
});

test("5,000-NODE MAXIMUM: 13 chunks, full read-back of every node, completed, activation eligible; the same size rolls back completely", { timeout: 600000 }, async () => {
  const plan = planFor(big(50, 99));                                              // 50 + 4950 = 5000 nodes
  assert.equal(plan.nodes.length, 5000); assert.equal(plan.chunks.length, 13);
  const sizes = []; let peak = 0;
  const fs = faulty(BASE_FS, { commit: async (ctx) => { sizes.push(ctx.ops.length); peak = Math.max(peak, ctx.ops.length); return ctx.perform(); } });
  const t0 = Date.now(); const r = await run("capA", plan, { fs });
  assert.equal(r.state, "completed", JSON.stringify(r).slice(0, 400)); assert.equal(r.nodesWritten, 5000); assert.equal(r.verification.counts.found, 5000); assert.equal(r.eligibility.eligible, true);
  assert.equal(sizes.length, 13); assert.ok(peak <= 400, "atomic chunks never exceed 400 writes"); assert.equal(sizes.reduce((a, b) => a + b, 0), 5000);
  const s = await clean(); assert.equal(s.nodes, 5000); assert.equal(s.batch.status, "completed"); assert.equal(s.batch.chunksDone, 13);
  console.log("5000-node commit + full verification:", Date.now() - t0, "ms");
  // rollback of a second 5000-node import (interrupted at the end)
  const plan2 = planFor(big(50, 99), { batchId: "Xx11Yy22Zz33Aa44Bb55" });
  await run("capA", plan2, { authorize: flip("capA", 15) });                      // batch, framework, 13 chunks written; the verification step is refused
  assert.equal((await clean("Xx11Yy22Zz33Aa44Bb55")).nodes, 5000);
  const t1 = Date.now(); const rb = await ctl("capA").rollback({ batchId: "Xx11Yy22Zz33Aa44Bb55", organizationId: "orgA", authorize: allowAlways("capA") });
  assert.equal(rb.state, "rolled_back", JSON.stringify(rb)); assert.equal(rb.nodesDeleted, 5000); assert.equal((await clean("Xx11Yy22Zz33Aa44Bb55")).nodes, 0);
  assert.equal((await clean()).nodes, 5000, "the other (completed) import is untouched");
  console.log("5000-node rollback:", Date.now() - t1, "ms");
});
