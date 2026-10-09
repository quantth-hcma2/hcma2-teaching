// P4-S4 RULES DESIGN GATE - why a 5,000-node controller run went from ~45 s (reviewed candidate 317e854 before the transaction) to ~209 s (after it).
// Not a pass/fail test: it MEASURES (idle machine, emulator) and prints a phase table. Separate: node writing, verification read-back, completion step (transaction or plain write), post-commit
// confirmation read, transaction retries, plus micro-benchmarks that separate emulator overhead and per-document Rules cost (Platform Admin short-circuits the capability checks, capA does not).
// Run: firebase emulators:exec --only firestore --project demo-p4s4p2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/perf-breakdown.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, candidateRules, seedWorld, doc, sha } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, big, planFor, allowAlways, faulty, noSleep } from "./helpers.mjs";
import { freezeRules } from "./import-freeze-rules.mjs";
import { loadSealedController } from "./sealed-protocol.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485");
const SC = await loadSealedController();
const envProd = await makeEnv("demo-p4s4p2", rules);
const envFreeze = await makeEnv("demo-p4s4p2-freeze", freezeRules(rules));
after(async () => { await envProd.cleanup(); await envFreeze.cleanup(); });
const sec = (ms) => (ms / 1000).toFixed(1) + " s";

async function measured(env, Mod, uid, label, opts = {}) {
  const as = actors(env); await env.clearFirestore(); await seedWorld(env);
  const plan = planFor(big(50, 99), { actorUid: uid });
  const counters = {}; const stamps = []; const t0 = Date.now();
  const fs = faulty(BASE_FS, {}, counters);
  const controller = Mod.createImportCommitController({ db: as(uid), firestore: fs, retryDelays: [0, 0], sleep: noSleep, ...opts });
  const result = await controller.commit({ plan, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), onProgress: (e) => { const last = stamps[stamps.length - 1]; if (!last || last.phase !== e.phase) stamps.push({ phase: e.phase, at: Date.now() - t0 }); } });
  const total = Date.now() - t0; assert.equal(result.state, "completed", label + " " + JSON.stringify(result).slice(0, 200));
  const at = (p) => (stamps.find((s) => s.phase === p) || {}).at;
  const row = {
    label, actor: uid, total: sec(total),
    "setup+scan": sec(at("nodes") ?? 0), "node writing": sec((at("verify") ?? 0) - (at("nodes") ?? 0)),
    "verification read": sec((at("complete") ?? 0) - (at("verify") ?? 0)), "completion step": sec(((at("confirm") ?? at("done")) ?? 0) - (at("complete") ?? 0)), "post-commit read": at("confirm") === undefined ? "-" : sec((at("done") ?? 0) - at("confirm")),
    "tx attempts": counters.tx ?? "-", reads: counters.reads, commits: counters.commits
  };
  return row;
}

test("MEASURE: 5,000-node controller run, phase by phase (idle machine, emulator)", { timeout: 1800000 }, async () => {
  const rows = [];
  rows.push(await measured(envProd, { createImportCommitController }, "capA", "reviewed code, plain completion (no tx) + confirm", { completionMode: "plain" }));
  rows.push(await measured(envProd, { createImportCommitController }, "capA", "reviewed code, completion TRANSACTION + confirm"));
  rows.push(await measured(envProd, { createImportCommitController }, "pa", "reviewed code, completion TRANSACTION + confirm"));
  rows.push(await measured(envFreeze, SC, "capA", "freeze Rules + seal protocol (plain completion, no confirm)"));
  console.log("\n" + JSON.stringify(rows, null, 1));
  console.table(rows);
});

test("MICRO-BENCHMARKS: emulator overhead and per-document Rules cost of reading 5,000 nodes - paged queries versus 5,000 transactional lookups, Platform Admin versus capability holder", { timeout: 1800000 }, async () => {
  const as = actors(envProd); await envProd.clearFirestore(); await seedWorld(envProd);
  const plan = planFor(big(50, 99), { actorUid: "pa" });
  const done = await createImportCommitController({ db: as("pa"), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep }).commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: allowAlways("pa") });
  assert.equal(done.state, "completed");
  const out = [];
  for (const uid of ["pa", "capA"]) {
    const c = createImportCommitController({ db: as(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });
    let t = Date.now(); const nodes = await c.readNodes(plan.framework.id, "orgA"); const paged = Date.now() - t; assert.equal(nodes.length, 5000);
    t = Date.now();
    await BASE_FS.runTransaction(as(uid), async (tx) => { for (let from = 0; from < plan.nodes.length; from += 250) await Promise.all(plan.nodes.slice(from, from + 250).map((n) => tx.get(BASE_FS.doc(as(uid), "curriculumFrameworks", plan.framework.id, "nodes", n.id)))); });
    const txRead = Date.now() - t;
    t = Date.now();
    await BASE_FS.runTransaction(as(uid), async (tx) => { for (let from = 0; from < plan.nodes.length; from += 50) await Promise.all(plan.nodes.slice(from, from + 50).map((n) => tx.get(BASE_FS.doc(as(uid), "curriculumFrameworks", plan.framework.id, "nodes", n.id)))); });
    const txRead50 = Date.now() - t;
    out.push({ actor: uid, "10 paged queries (500/page)": sec(paged), "5000 tx lookups (groups of 250)": sec(txRead), "5000 tx lookups (groups of 50)": sec(txRead50) });
  }
  console.log("\n" + JSON.stringify(out, null, 1)); console.table(out);
});
