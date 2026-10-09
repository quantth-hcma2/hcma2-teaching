// P4-S4 RULES DESIGN GATE - deployment-order compatibility between the controller generations and the two Rules generations (emulator, test-only Rules copy).
//   prototype (seal + barrier) controller  on PRODUCTION Rules : works (the seal and the barrier are ordinary progress / partial writes) - it can ship BEFORE the Rules
//   reviewed controller (317e854 / 49654c9) on FREEZE Rules    : commit + abandon + rollback-from-partial work; ROLLBACK DIRECTLY FROM `committing` breaks (node deletes are frozen) - so the Rules must not be released before the new controller
// Run: firebase emulators:exec --only firestore --project demo-p4s4k --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/compat.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, candidateRules, seedWorld, doc, getDoc, getDocs, collection, sha } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController } from "../../import-commit-controller.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, noSleep } from "./helpers.mjs";
import { freezeRules } from "./import-freeze-rules.mjs";
import { loadSealedController } from "./sealed-protocol.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485");
const SC = await loadSealedController();
const envProd = await makeEnv("demo-p4s4k", rules), envFreeze = await makeEnv("demo-p4s4k-freeze", freezeRules(rules));
after(async () => { await envProd.cleanup(); await envFreeze.cleanup(); });
const plan = planFor(big(3, 300), { actorUid: "pa" });
const flip = (uid, n) => { let c = 0; return Object.assign(async () => (++c <= n ? { allowed: true } : { allowed: false }), { actorUid: uid }); };
const state = async (env) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); const b = await getDoc(doc(db, "importBatches/" + BATCH)); const f = await getDoc(doc(db, "curriculumFrameworks/" + BATCH)); out = { batch: b.exists() ? b.data().status : null, framework: f.exists(), nodes: (await getDocs(collection(db, "curriculumFrameworks", BATCH, "nodes"))).size }; }); return out; };
const mk = (Mod, env, uid) => Mod.createImportCommitController({ db: actors(env)(uid), firestore: BASE_FS, retryDelays: [0, 0], sleep: noSleep });
const common = (uid, extra = {}) => ({ plan, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), ...extra });

test("NEW controller on PRODUCTION Rules (ships first): commit completes, an interrupted import rolls back through the barrier", { timeout: 600000 }, async () => {
  await envProd.clearFirestore(); await seedWorld(envProd);
  assert.equal((await mk(SC, envProd, "pa").commit(common("pa"))).state, "completed");
  await envProd.clearFirestore(); await seedWorld(envProd);
  await mk(SC, envProd, "pa").commit(common("pa", { authorize: flip("pa", 3) }));
  assert.equal((await mk(SC, envProd, "oaA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") })).state, "rolled_back");
  assert.deepEqual(await state(envProd), { batch: "rolled_back", framework: false, nodes: 0 });
});
test("REVIEWED controller on FREEZE Rules: commit works; abandon then rollback works; ROLLBACK DIRECTLY FROM committing is refused (so the Rules must be released after the new controller)", { timeout: 600000 }, async () => {
  await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  assert.equal((await mk({ createImportCommitController }, envFreeze, "pa").commit(common("pa"))).state, "completed");
  await envFreeze.clearFirestore(); await seedWorld(envFreeze);
  await mk({ createImportCommitController }, envFreeze, "pa").commit(common("pa", { authorize: flip("pa", 3) }));
  const direct = await mk({ createImportCommitController }, envFreeze, "oaA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") });
  assert.notEqual(direct.state, "rolled_back", "direct rollback from committing is frozen: " + JSON.stringify(direct).slice(0, 120)); assert.equal((await state(envFreeze)).batch, "committing");
  assert.equal((await mk({ createImportCommitController }, envFreeze, "oaA").abandon({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") })).state, "partial");
  assert.equal((await mk({ createImportCommitController }, envFreeze, "oaA").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("oaA") })).state, "rolled_back");
  assert.deepEqual(await state(envFreeze), { batch: "rolled_back", framework: false, nodes: 0 });
});
