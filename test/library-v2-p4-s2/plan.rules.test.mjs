// P4-S2 - the import PLAN against the PRODUCTION Firestore Rules (candidate artifact = deployed ruleset 0b6910c3, SHA-256 7F7C790E...0485) on the emulator.
// The plan executes nothing in production code; THIS TEST plays the (future P4-S4) controller to prove the plan is Rules-compatible: batch -> framework -> node
// chunks -> completion witness -> activation, for a small plan and for the 5000-node maximum. Synthetic data only; the Rules file is not modified.
// Run: firebase emulators:exec --only firestore --project demo-p4s2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s2/plan.rules.test.mjs"
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, getDoc, getDocs, collection, writeBatch, serverTimestamp, fwTransition, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { validateRaw } from "./helpers.mjs";
import { buildImportPlan, materializePayloads, prepareCommit } from "../../import-plan.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A", "the Rules under test are the production artifact");
const env = await makeEnv("demo-p4s2-plan", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });
const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const BATCH = "Ab12Cd34Ef56Gh78Ij90";
const big = (subjectsCount, lessonsPer) => {
  const subjects = Array.from({ length: subjectsCount }, (_, i) => ["S" + i, "Môn " + i, i]);
  const lessons = [];
  for (let s = 0; s < subjectsCount; s++) for (let l = 0; l < lessonsPer; l++) lessons.push(["S" + s, "S" + s + "-L" + l, "Bài " + l, l]);
  return { subjects, lessons };
};
const planFor = (options, batchId = BATCH, organization = "orgA") => {
  const r = validateRaw(options); assert.equal(r.ok, true);
  const prepared = prepareCommit(r.model, { organization: { id: organization, status: "active" }, batchId, actorUid: "pa" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.diagnostics));
  return prepared.plan;
};
const ref = (db, path) => doc(db, path);

// plays the controller with the caller's Firestore client; returns the committed plan
async function executePlan(db, plan, actorUid, { stopAfterChunks = Infinity, complete = true } = {}) {
  const payloads = materializePayloads(plan, { actorUid, serverTimestamp });
  await ok(setDoc(ref(db, payloads.batch.path), payloads.batch.data));
  await ok(setDoc(ref(db, payloads.framework.path), payloads.framework.data));
  let done = 0;
  for (const chunk of payloads.chunks) {
    if (done >= stopAfterChunks) break;
    const batch = writeBatch(db);
    for (const write of chunk.writes) batch.set(ref(db, write.path), write.data);
    await ok(batch.commit());
    done++;
    await ok(updateDoc(ref(db, payloads.batch.path), { chunksDone: done, updatedAt: serverTimestamp() }));
  }
  if (complete) await ok(updateDoc(ref(db, payloads.batch.path), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  return payloads;
}
const activate = (uid) => fwTransition(uid, "active", { activatedAt: serverTimestamp() });
const nodeCount = async (db, id = BATCH) => (await getDocs(collection(db, "curriculumFrameworks", id, "nodes"))).size;

for (const writer of ["pa", "oaA", "capA"]) {
  test("RULES COMPATIBILITY (" + writer + "): batch -> framework -> node chunks -> completed -> activation succeeds for a 63-node plan, and every node the plan promised exists", async () => {
    const plan = planFor(big(3, 20));
    const db = as(writer);
    await executePlan(db, plan, writer);
    assert.equal(await nodeCount(as("pa")), plan.nodes.length);
    const stored = await getDoc(ref(as("pa"), "importBatches/" + BATCH));
    assert.equal(stored.data().status, "completed"); assert.equal(stored.data().finalNodeId, plan.verification.finalNodeId); assert.equal(stored.data().chunksDone, plan.batch.chunksTotal);
    // verification the controller (P4-S4) must do and the Rules cannot: read back EVERY node and compare with the plan
    const nodes = (await getDocs(collection(as("pa"), "curriculumFrameworks", BATCH, "nodes"))).docs.map((d) => ({ id: d.id, ...d.data() }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const expected of plan.verification.expectedNodes) {
      const got = byId.get(expected.id); assert.ok(got, "node present " + expected.id);
      for (const key of ["kind", "parentId", "ancestors", "code", "name", "order", "status", "organizationId"]) assert.deepEqual(got[key], expected[key], expected.id + "." + key);
    }
    await ok(updateDoc(ref(db, "curriculumFrameworks/" + BATCH), activate(writer)));
  });
}
test("RULES COMPATIBILITY: activation of the imported framework is DENIED until the batch is completed, then allowed (authoritative P4-S1 guard)", async () => {
  const plan = planFor(big(2, 5));
  const db = as("pa");
  await executePlan(db, plan, "pa", { complete: false });
  await no(updateDoc(ref(db, "curriculumFrameworks/" + BATCH), activate("pa")));
  await ok(updateDoc(ref(db, "importBatches/" + BATCH), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await ok(updateDoc(ref(db, "curriculumFrameworks/" + BATCH), activate("pa")));
});
test("RULES COMPATIBILITY: the Rules' completion witness is the plan's finalNodeId - completing before the last chunk is denied, completing after is allowed (the witness is NOT proof of completeness)", async () => {
  const plan = planFor(big(4, 150));
  assert.ok(plan.chunks.length >= 2);
  const db = as("pa");
  await executePlan(db, plan, "pa", { stopAfterChunks: 1, complete: false });
  await no(updateDoc(ref(db, "importBatches/" + BATCH), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));   // chunksDone != chunksTotal and the last node is missing
  const payloads = materializePayloads(plan, { actorUid: "pa", serverTimestamp });
  for (const chunk of payloads.chunks.slice(1)) { const b = writeBatch(db); for (const w of chunk.writes) b.set(ref(db, w.path), w.data); await ok(b.commit()); }
  await ok(updateDoc(ref(db, "importBatches/" + BATCH), { chunksDone: plan.chunks.length, updatedAt: serverTimestamp() }));
  await ok(updateDoc(ref(db, "importBatches/" + BATCH), { status: "completed", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test("RULES COMPATIBILITY: the MAXIMUM plan (5000 nodes, 13 chunks of <= 400 writes) commits and completes under the production Rules", async () => {
  const plan = planFor(big(50, 99));
  assert.equal(plan.nodes.length, 5000); assert.equal(plan.chunks.length, 13);
  const db = as("pa");
  await executePlan(db, plan, "pa");
  assert.equal(await nodeCount(as("pa")), 5000);
  const stored = (await getDoc(ref(as("pa"), "importBatches/" + BATCH))).data();
  assert.equal(stored.status, "completed"); assert.equal(stored.chunksTotal, 13); assert.deepEqual(stored.counts, { parsed: 5000, accepted: 5000, skipped: 0, failed: 0 });
  await ok(updateDoc(ref(db, "curriculumFrameworks/" + BATCH), activate("pa")));
});
test("RULES COMPATIBILITY: non-writers and another organization's actors cannot execute the plan; an inactive organization blocks it already at stage 10", async () => {
  const plan = planFor(big(1, 2));
  const payloads = materializePayloads(plan, { actorUid: "mA", serverTimestamp });
  await no(setDoc(ref(as("mA"), payloads.batch.path), payloads.batch.data));
  const forB = materializePayloads(plan, { actorUid: "oaB", serverTimestamp });
  await no(setDoc(ref(as("oaB"), forB.batch.path), forB.batch.data));
  const r = validateRaw();
  assert.equal(prepareCommit(r.model, { organization: { id: "orgC", status: "archived" }, batchId: BATCH, actorUid: "oaC" }).ok, false);
  const archivedPlan = planFor(undefined, "Zz98Yx76Wv54Ut32Sr10", "orgC");                   // a plan can be BUILT for an id, but the Rules deny writes into an archived organization
  const archivedPayloads = materializePayloads(archivedPlan, { actorUid: "pa", serverTimestamp });
  await no(setDoc(ref(as("pa"), archivedPayloads.batch.path), archivedPayloads.batch.data));
});
test("RULES COMPATIBILITY: a manual framework cannot be 'paired' afterwards - the batch of an id whose framework already exists is denied (paired-id contract)", async () => {
  const plan = planFor(big(1, 1));
  const db = as("pa");
  const payloads = materializePayloads(plan, { actorUid: "pa", serverTimestamp });
  await ok(setDoc(ref(db, payloads.framework.path), payloads.framework.data));
  await no(setDoc(ref(db, payloads.batch.path), payloads.batch.data));
});
test("EVIDENCE: the Rules under test are byte-identical to the production artifact and the plan module never touches Firestore", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../firestore.rules.production-candidate", import.meta.url))).digest("hex").toUpperCase(), "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A");
  assert.ok(!/firebase|firestore/i.test(readFileSync(new URL("../../import-plan.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "").replace(/"[^"]*"/g, "")));
});
