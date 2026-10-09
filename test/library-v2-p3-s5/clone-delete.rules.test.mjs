// LIBRARY V2 P3-S5 - clone and delete-draft proven against the DEPLOYED P3-S1 Firestore Rules (EXACT artifact, Firestore emulator, synthetic data only): the clone plan's
// payloads (framework with cloneSource, 400-node create batches, retire pass, final node) and the delete-draft sequence (children first, framework last) are ACCEPTED where
// intended and DENIED where the Rules say so. No Rules change.
// Run: firebase emulators:exec --only firestore --project demo-p3s5 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p3-s5/clone-delete.rules.test.mjs"
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { collection, doc, query, where, limit, getDocs, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { makeEnv, actors, candidateRules, seedWorld, sha, assertSucceeds, assertFails, nodeDoc, fwDoc, D } from "../library-v2-p3-s1/helpers.mjs";
import * as M from "../../curriculum-model.mjs";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import { createCurriculumQueries } from "../../curriculum-queries.mjs";
import { createCloneDeleteHelpers, createCurriculumCloneWriter } from "../../curriculum-clone-delete.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A", "proven against the deployed P3-S1 Rules artifact");
const env = await makeEnv("demo-p3s5-clone", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const C = createCurriculumWriteContract({ serverTimestamp });
const Q = createCurriculumQueries({ collection, doc, query, where, limit, getDocs, getDoc });
const X = createCloneDeleteHelpers({ model: M });
const W = createCurriculumCloneWriter({ collection, doc, setDoc, writeBatch, deleteDoc });
const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const orgA = { id: "orgA", status: "active" };
const WRITERS = ["pa", "oaA", "capA"];
const nodesOf = async (db, fwId) => (await Q.nodesOfFramework(db, fwId, "orgA")).items;

// source tree seeded out of band (security rules disabled): depth 4, one retired node, collision-free orders
async function seedSource(fwId, status = "active", size = 0) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(), put = (id, d) => setDoc(doc(db, "curriculumFrameworks", fwId, "nodes", id), d);
    await setDoc(doc(db, "curriculumFrameworks", fwId), fwDoc("orgA", status));
    await put("s1", nodeDoc("orgA", { name: "Mon 1", code: "S1" }));
    await put("l1", nodeDoc("orgA", { kind: "lesson", parentId: "s1", ancestors: ["s1"], name: "Bai 1", code: "L1", order: 0 }));
    await put("l2", nodeDoc("orgA", { kind: "lesson", parentId: "s1", ancestors: ["s1"], name: "Bai 2", code: "L2", order: 1, status: "retired" }));
    await put("u1", nodeDoc("orgA", { kind: "unit", parentId: "l1", ancestors: ["s1", "l1"], name: "Muc 1", order: 0 }));
    await put("d1", nodeDoc("orgA", { kind: "unit", parentId: "u1", ancestors: ["s1", "l1", "u1"], name: "Muc sau", code: "D1", order: 0 }));
    await put("s2", nodeDoc("orgA", { name: "Mon 2", order: 1 }));
    for (let i = 0; i < size; i++) await put("x" + String(i).padStart(4, "0"), nodeDoc("orgA", { name: "Mon x" + i, order: 10 + i, code: "X" + i, status: i % 9 === 4 ? "retired" : "active" }));
  });
}

// the controller's clone sequence (same phases as curriculum-admin-view.mjs), driven by a given actor against the REAL Rules
async function runClone(db, actor, srcId, name, { stopAfter = null } = {}) {
  const src = await Q.frameworkById(db, srcId, { organizationId: "orgA" });
  const sourceNodes = await nodesOf(db, srcId);
  const destId = W.newFrameworkId(db);
  const plan = X.planClone({ nodes: sourceNodes, organizationId: "orgA", newId: () => W.newNodeId(db, destId) });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  const data = C.buildFrameworkCreate({ organization: orgA, name, cloneSource: { framework: src, nodeCount: plan.total } }, actor);
  const payloads = X.buildClonePayloads({ contract: C, organization: orgA, destination: { id: destId, organizationId: "orgA", status: "draft" }, plan });
  const itemOf = (item) => ({ id: item.newId, data: payloads.creates.get(item.newId) });
  const log = [];
  await ok(W.createFramework(db, destId, data)); log.push("framework");
  if (stopAfter === "framework") return { destId, plan, log };
  for (const items of plan.createChunks) { await ok(W.createNodes(db, destId, items.map(itemOf))); log.push("create:" + items.length); }
  if (stopAfter === "chunks") return { destId, plan, log };
  for (const ids of plan.retireChunks) { await ok(W.updateNodes(db, destId, ids.map((id) => ({ id, data: payloads.retires.get(id) })))); log.push("retire:" + ids.length); }
  if (stopAfter === "retire") return { destId, plan, log };
  if (plan.finalItems.length) { await ok(W.createNodes(db, destId, plan.finalItems.map(itemOf))); log.push("final:" + plan.finalItems.length); }
  return { destId, plan, log };
}
async function deleteDraft(db, fwId) {
  const nodes = await nodesOf(db, fwId);
  for (const ids of X.planDeleteDraft(nodes).chunks) await ok(W.deleteNodes(db, fwId, ids));
  await ok(W.deleteFramework(db, fwId));
}

test("clone accepted by the Rules for Platform Admin, Organization Admin and the capability holder: framework + nodes + retire pass + final node; verified copy, source byte-identical, completeness and readiness hold", async () => {
  for (const actor of WRITERS) {
    await seedSource("src_" + actor);
    const db = as(actor), before = JSON.stringify(await nodesOf(as("pa"), "src_" + actor));
    const { destId, plan, log } = await runClone(db, actor, "src_" + actor, "Ban sao " + actor);
    assert.deepEqual(log, ["framework", "create:5", "retire:1", "final:1"]);
    const fw = await Q.frameworkById(db, destId, { organizationId: "orgA" });
    assert.deepEqual([fw.status, fw.organizationId, fw.createdBy, fw.cloneSource], ["draft", "orgA", actor, { frameworkId: "src_" + actor, nodeCount: 6 }]); assert.ok(!("activatedAt" in fw));
    const dest = await nodesOf(db, destId); assert.equal(dest.length, 6); assert.equal(X.verifyClone(plan, dest), true);
    assert.equal(M.validateTree(dest, { organizationId: "orgA" }).valid, true); assert.equal(M.cloneCompleteness(fw, dest).complete, true);
    assert.ok(dest.every((n) => !["s1", "l1", "l2", "u1", "d1", "s2"].includes(n.id)), "no node document is shared with the source");
    assert.equal(JSON.stringify(await nodesOf(as("pa"), "src_" + actor)), before, "the source nodes are untouched");
    assert.equal(M.activationReadiness(fw, dest, { organization: orgA }).ready, true);
    await ok(updateDoc(doc(db, "curriculumFrameworks", destId), C.buildFrameworkActivate(fw, actor, { organization: orgA, nodes: dest })));   // the clone activates like any ready draft
  }
});
test("clone writers outside the guard are DENIED: ordinary member, other organization's admin, archived organization", async () => {
  await seedSource("src");
  for (const actor of ["mA", "revA", "oaB", "capB", "tSusp"]) await no(setDoc(doc(collection(as(actor), "curriculumFrameworks")), C.buildFrameworkCreate({ organization: orgA, name: "Ban sao", cloneSource: { framework: { id: "src", organizationId: "orgA" }, nodeCount: 6 } }, actor)));
  await no(setDoc(doc(collection(as("pa"), "curriculumFrameworks")), C.buildFrameworkCreate({ organization: { id: "orgC", status: "active" }, name: "Ban sao", cloneSource: { framework: { id: "src", organizationId: "orgC" }, nodeCount: 1 } }, "pa")));
});
test("LARGE clone (850 nodes, retired ones included) stays inside the Rules' document budget: bounded 400-write batches are all accepted; completeness is a monotone lower bound across the phases", async () => {
  await seedSource("big", "active", 844);   // 6 + 844 = 850
  const pa = as("pa");
  const { destId, plan, log } = await runClone(pa, "pa", "big", "Ban sao lon");
  assert.equal(plan.total, 850); assert.deepEqual(log.filter((l) => l.startsWith("create")), ["create:400", "create:400", "create:49"]); assert.ok(log.some((l) => l.startsWith("retire")), log.join()); assert.equal(log.at(-1), "final:1");
  const fw = await Q.frameworkById(pa, destId, { organizationId: "orgA" }), dest = await nodesOf(pa, destId);
  assert.equal(dest.length, 850); assert.equal(X.verifyClone(plan, dest), true); assert.equal(M.cloneCompleteness(fw, dest).complete, true); assert.equal(M.validateTree(dest, { organizationId: "orgA" }).valid, true);
  assert.equal(dest.filter((n) => n.status === "retired").length, (await nodesOf(pa, "big")).filter((n) => n.status === "retired").length);
  // later legitimate edits never flip completeness
  const [one] = dest.filter((n) => n.status === "active");
  await ok(updateDoc(doc(pa, "curriculumFrameworks", destId, "nodes", one.id), C.buildNodeRetire(one, { organization: orgA, framework: fw, nodes: dest })));
  assert.equal(M.cloneCompleteness(fw, await nodesOf(pa, destId)).complete, true);
});
test("an interrupted clone is DETECTABLY incomplete at every phase before the final commit (activation blocked by readiness), complete only after it; the partial draft is deletable (children first)", async () => {
  await seedSource("src");
  const pa = as("pa");
  for (const stage of ["framework", "chunks", "retire"]) {
    const { destId } = await runClone(pa, "pa", "src", "Dang do " + stage, { stopAfter: stage });
    const fw = await Q.frameworkById(pa, destId, { organizationId: "orgA" }), nodes = await nodesOf(pa, destId);
    assert.equal(M.cloneCompleteness(fw, nodes).complete, false, stage); assert.ok(M.activationReadiness(fw, nodes, { organization: orgA }).errors.some((e) => e.code === "INCOMPLETE_CLONE"), stage);
    assert.throws(() => C.buildFrameworkActivate(fw, "pa", { organization: orgA, nodes }), (e) => e.code === "NOT_READY", "the builder refuses activation at stage " + stage);
    await deleteDraft(pa, destId);   // the leftover is a never-activated draft: deletable
    assert.equal(await Q.frameworkById(pa, destId, { organizationId: "orgA" }), null); assert.equal((await nodesOf(pa, destId)).length, 0);
  }
});
test("rollback sequence is accepted by the Rules (nodes in bounded batches, then the draft framework) for the three writers; nothing remains", async () => {
  for (const actor of WRITERS) {
    await seedSource("src_" + actor);
    const db = as(actor), { destId } = await runClone(db, actor, "src_" + actor, "Se hoan tac", { stopAfter: "chunks" });
    await deleteDraft(db, destId);
    // existence is verified as the Platform Admin: for a NON-admin writer, reading a document that no longer exists is an evaluation error (resource is null) = permission-denied
    assert.equal(await Q.frameworkById(as("pa"), destId, { organizationId: "orgA" }), null); assert.equal((await nodesOf(as("pa"), destId)).length, 0);
  }
});
test("delete-draft: a never-activated draft with 850 nodes is removed by bounded batch deletes + the framework (children first); no orphan nodes remain", async () => {
  await seedSource("big", "draft", 844);
  const pa = as("pa");
  const nodes = await nodesOf(pa, "big"); const plan = X.planDeleteDraft(nodes); assert.deepEqual(plan.chunks.map((c) => c.length), [400, 400, 50]);
  for (const ids of plan.chunks) await ok(W.deleteNodes(pa, "big", ids));
  await ok(W.deleteFramework(pa, "big"));
  assert.equal(await Q.frameworkById(pa, "big", { organizationId: "orgA" }), null); assert.equal((await nodesOf(pa, "big")).length, 0);
  for (const actor of ["oaA", "capA"]) { await seedSource("d_" + actor, "draft"); await deleteDraft(as(actor), "d_" + actor); assert.equal(await Q.frameworkById(pa, "d_" + actor, { organizationId: "orgA" }), null); await no(getDoc(doc(as(actor), "curriculumFrameworks", "d_" + actor))); }   // a non-admin read of the vanished document is itself denied (null resource)
});
test("delete is DENIED by the Rules for everything that is not a never-activated draft: active, archived, restored (previously activated), a draft carrying activatedAt; their nodes cannot be deleted either; non-writers and archived organizations cannot delete a draft", async () => {
  const pa = as("pa");
  for (const id of ["fwA_active", "fwA_archived", "fwA_draftAct"]) { await no(W.deleteFramework(pa, id)); await no(W.deleteNodes(pa, id, ["s1", "l1"])); await no(W.deleteNodes(as("oaA"), id, ["s1"])); }
  // a framework activated through the lifecycle, archived and restored is never deletable
  await seedSource("life", "draft");
  const fw0 = await Q.frameworkById(pa, "life", { organizationId: "orgA" }), nodes0 = await nodesOf(pa, "life");
  await ok(updateDoc(doc(pa, "curriculumFrameworks", "life"), C.buildFrameworkActivate(fw0, "pa", { organization: orgA, nodes: nodes0 })));
  await no(W.deleteFramework(pa, "life")); await no(W.deleteNodes(pa, "life", ["s1"]));
  const act = await Q.frameworkById(pa, "life", { organizationId: "orgA" });
  await ok(updateDoc(doc(pa, "curriculumFrameworks", "life"), C.buildFrameworkArchive(act, "pa", { organization: orgA })));
  await no(W.deleteFramework(pa, "life"));
  const arc = await Q.frameworkById(pa, "life", { organizationId: "orgA" });
  await ok(updateDoc(doc(pa, "curriculumFrameworks", "life"), C.buildFrameworkRestore(arc, "pa", { organization: orgA })));
  await no(W.deleteFramework(pa, "life")); await no(W.deleteNodes(pa, "life", ["s1", "l1"]));
  assert.equal((await Q.frameworkById(pa, "life", { organizationId: "orgA" })).status, "active");
  // non-writers and the archived organization
  for (const actor of ["mA", "revA", "oaB", "capB", "tSusp", "capSuspMem"]) { await no(W.deleteFramework(as(actor), "fwA_draft")); await no(W.deleteNodes(as(actor), "fwA_draft", ["s1"])); }
  for (const actor of ["pa", "oaC"]) { await no(W.deleteFramework(as(actor), "fwC_draft")); await no(W.deleteNodes(as(actor), "fwC_draft", ["s1"])); }
  assert.equal((await Q.frameworkById(pa, "fwA_draft", { organizationId: "orgA" })).status, "draft", "nothing was deleted by the denied attempts");
});
test("why children go FIRST: the Rules would also let a never-activated draft framework be deleted while nodes remain (orphans, cleaned up later); the controller never does that, and an orphan can still be cleaned up", async () => {
  await seedSource("odd", "draft");
  const pa = as("pa");
  await ok(W.deleteFramework(pa, "odd"));   // permitted by the Rules, therefore the CLIENT order (nodes first) is what prevents orphans
  assert.equal((await nodesOf(pa, "odd")).length, 6);
  await ok(W.deleteNodes(pa, "odd", ["s1", "l1", "l2", "u1", "d1", "s2"]));   // orphan cleanup is allowed once the framework is gone
  assert.equal((await nodesOf(pa, "odd")).length, 0);
});
test("the Rules do NOT know clone completeness (like code uniqueness it is client/domain protection): a raw activation of a partial clone is accepted by the Rules - the guard is activationReadiness/buildFrameworkActivate", async () => {
  await seedSource("src");
  const pa = as("pa");
  const { destId } = await runClone(pa, "pa", "src", "Dang do", { stopAfter: "framework" });
  const fw = await Q.frameworkById(pa, destId, { organizationId: "orgA" });
  const raw = { status: "active", statusChangedAt: serverTimestamp(), statusChangedBy: "pa", updatedAt: serverTimestamp(), activatedAt: serverTimestamp() };
  await ok(updateDoc(doc(pa, "curriculumFrameworks", destId), raw));   // documented limitation: the screen/builder never sends this for an incomplete clone
  assert.equal((await Q.frameworkById(pa, destId, { organizationId: "orgA" })).status, "active"); assert.ok(fw.cloneSource);
});
