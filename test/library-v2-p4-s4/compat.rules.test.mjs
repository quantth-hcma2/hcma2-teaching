// P4-S4 IMPORT FREEZE - the controller on the two Rules generations (emulator): on the DEPLOYED ruleset text it still commits and rolls back (the seal and the barrier are ordinary progress / partial
// writes) but is NOT protected against concurrent writers (see concurrency.rules.test.mjs 1a / 2b); on the freeze candidate it is. Release order: Rules first (production has no import execution yet), then the web release.
// Run: firebase emulators:exec --only firestore --project demo-p4s4k --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/compat.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, seedWorld, doc, getDoc, getDocs, collection } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, noSleep, deployedRulesText, freezeCandidateRules } from "./helpers.mjs";

const envOld = await makeEnv("demo-p4s4k", deployedRulesText()), envNew = await makeEnv("demo-p4s4k-freeze", freezeCandidateRules());
after(async () => { await envOld.cleanup(); await envNew.cleanup(); });
const plan = planFor(big(3, 300), { actorUid: "pa" });
const flip = (uid, n) => { let c = 0; return Object.assign(async () => (++c <= n ? { allowed: true } : { allowed: false }), { actorUid: uid }); };
const state = async (env) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); const b = await getDoc(doc(db, "importBatches/" + BATCH)); const f = await getDoc(doc(db, "curriculumFrameworks/" + BATCH)); out = { batch: b.exists() ? b.data().status : null, framework: f.exists(), nodes: (await getDocs(collection(db, "curriculumFrameworks", BATCH, "nodes"))).size }; }); return out; };
const mk = (env, uid) => createImportCommitController({ db: actors(env)(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });
const common = (uid, extra = {}) => ({ plan, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), ...extra });

for (const [label, env] of [["DEPLOYED ruleset text", envOld], ["FREEZE candidate", envNew]]) {
  test("the controller works on the " + label + ": commit completes; an interrupted import is rolled back by another administrator through the barrier", { timeout: 600000 }, async () => {
    await env.clearFirestore(); await seedWorld(env);
    assert.equal((await mk(env, "pa").commit(common("pa"))).state, "completed");
    await env.clearFirestore(); await seedWorld(env);
    await mk(env, "pa").commit(common("pa", { authorize: flip("pa", 3) }));
    assert.equal((await mk(env, "oaA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") })).state, "rolled_back");
    assert.deepEqual(await state(env), { batch: "rolled_back", framework: false, nodes: 0 });
  });
}
