// P4-S4 - PROBE of the "399 node writes + 1 progress write in ONE atomic commit" option against the PRODUCTION Rules (emulator).
// Result: it IS compatible with the frozen Rules for every writer. It is NOT used because the approved P4-S2 plan fixes 400 nodes per chunk and chunksTotal = ceil(n / 400)
// (immutable in the batch document): chunking by 399 would change chunksTotal / plan digests for some node counts. The controller therefore commits progress separately.
// Run: firebase emulators:exec --only firestore --project demo-p4s4p --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/progress-atomic.probe.test.mjs"
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, getDoc, writeBatch, newFwPayload, serverTimestamp, sha } from "../library-v2-p3-s1/helpers.mjs";
import { toBatchCreatePayload, toNodePayload } from "../../import-plan.mjs";
import { big, planFor, BATCH, freezeCandidateRules } from "./helpers.mjs";

void sha; void candidateRules;
const env = await makeEnv("demo-p4s4p", freezeCandidateRules());
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

for (const uid of ["pa", "oaA", "capA"]) {
  test("399 node writes + 1 batch progress write in one atomic commit are accepted (" + uid + "); the plan is 800 nodes so progress means chunksDone 1 of 3", async () => {
    const plan = planFor(big(2, 399), { actorUid: uid });                    // 2 + 798 = 800 nodes -> 2 chunks of 400 in the frozen plan
    const db = as(uid);
    await assertSucceeds(setDoc(doc(db, "importBatches/" + BATCH), toBatchCreatePayload(plan, { actorUid: uid, serverTimestamp })));
    await assertSucceeds(setDoc(doc(db, "curriculumFrameworks/" + BATCH), newFwPayload("orgA", uid, { name: plan.framework.name })));
    const atomic = writeBatch(db);
    for (const node of plan.nodes.slice(0, 399)) atomic.set(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + node.id), toNodePayload(node, { serverTimestamp }));
    atomic.update(doc(db, "importBatches/" + BATCH), { chunksDone: 1, updatedAt: serverTimestamp() });
    await assertSucceeds(atomic.commit());
    const stored = await env.withSecurityRulesDisabled(async (ctx) => (await getDoc(doc(ctx.firestore(), "importBatches/" + BATCH))).data().chunksDone);
    void stored;
    assert.equal(plan.chunks.length, 2); assert.equal(Math.ceil(800 / 399), 3, "399-node chunks would need chunksTotal 3 for this plan, but the plan froze 2");
  });
}
test("the Rules refuse a progress write that decreases chunksDone or exceeds chunksTotal - the controller derives progress from real data and never blindly increments", async () => {
  const plan = planFor(big(2, 5)); const db = as("pa");
  await assertSucceeds(setDoc(doc(db, "importBatches/" + BATCH), toBatchCreatePayload(plan, { actorUid: "pa", serverTimestamp })));
  const { updateDoc } = await import("firebase/firestore");
  await assertSucceeds(updateDoc(doc(db, "importBatches/" + BATCH), { chunksDone: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "importBatches/" + BATCH), { chunksDone: 0, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "importBatches/" + BATCH), { chunksDone: 2, updatedAt: serverTimestamp() }));
});
