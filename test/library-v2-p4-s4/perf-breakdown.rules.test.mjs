// P4-S4 IMPORT FREEZE - 5,000-node controller run, phase by phase (idle machine, emulator): node writing, seal, verification read, completion, final-state read. A MEASUREMENT (prints a table; asserts only
// completion). The earlier design-gate comparison against the completion-transaction variant is recorded in the design document (transaction 40-50 s extra; paged verification read 4-7 s).
// Run: firebase emulators:exec --only firestore --project demo-p4s4p2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/perf-breakdown.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, seedWorld } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, big, planFor, allowAlways, faulty, noSleep, freezeCandidateRules } from "./helpers.mjs";

const env = await makeEnv("demo-p4s4p2", freezeCandidateRules());
after(async () => env.cleanup());
const sec = (ms) => (ms / 1000).toFixed(1) + " s";
test("MEASURE: 5,000-node run with the seal protocol (freeze Rules candidate)", { timeout: 1800000 }, async () => {
  const rows = [];
  for (const uid of ["capA", "pa"]) {
    const as = actors(env); await env.clearFirestore(); await seedWorld(env);
    const plan = planFor(big(50, 99), { actorUid: uid });
    const counters = {}; const stamps = []; const t0 = Date.now();
    const controller = createImportCommitController({ db: as(uid), firestore: faulty(BASE_FS, {}, counters), retryDelays: [0, 0], sleep: noSleep });
    const result = await controller.commit({ plan, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), onProgress: (e) => { const last = stamps[stamps.length - 1]; if (!last || last.phase !== e.phase) stamps.push({ phase: e.phase, at: Date.now() - t0 }); } });
    const total = Date.now() - t0; assert.equal(result.state, "completed", JSON.stringify(result).slice(0, 200));
    const at = (p) => (stamps.find((s) => s.phase === p) || {}).at ?? 0;
    rows.push({ actor: uid, total: sec(total), "setup+scan": sec(at("nodes")), "node writing": sec(at("seal") - at("nodes")), seal: sec(at("verify") - at("seal")), "verification read": sec(at("complete") - at("verify")), "completion + final-state read": sec(at("done") - at("complete")), reads: counters.reads, commits: counters.commits });
  }
  console.log("\n" + JSON.stringify(rows, null, 1)); console.table(rows);
});
