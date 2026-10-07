// LIBRARY V2 P3-S5 - pure clone / delete-draft layer: eligibility, clone plan (ids, parents, order, status, phases, chunking), payloads through the REAL P3-S2 contract,
// clone completeness (D1 resolved), verification, delete plan, markup and the transport. No DOM, no Firestore.
// Run: node --test test/library-v2-p3-s5/clone-delete.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../curriculum-model.mjs";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import { createCloneDeleteHelpers, createCurriculumCloneWriter } from "../../curriculum-clone-delete.mjs";

const X = createCloneDeleteHelpers({ model: M });
const C = createCurriculumWriteContract({ serverTimestamp: () => ({ __ts: true }) });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ORG = (status = "active") => ({ id: "org1", name: "Đơn vị", status });
const FW = (status = "draft", extra = {}) => ({ id: "src", organizationId: "org1", name: "Khung nguồn", status, ...(status === "draft" ? {} : { activatedAt: { seconds: 1 } }), ...extra });
const N = (id, parentId, ancestors, order, extra = {}) => ({ id, organizationId: "org1", kind: ancestors.length === 0 ? "subject" : ancestors.length === 1 ? "lesson" : "unit", parentId, ancestors, order, code: null, name: "Nút " + id, status: "active", ...extra });
let counter = 0; const nextId = () => "N" + String(++counter).padStart(4, "0");
const TREE = () => [N("s1", null, [], 0, { code: "S1" }), N("l1", "s1", ["s1"], 0, { code: "L1" }), N("l2", "s1", ["s1"], 1, { status: "retired", code: "L2" }), N("s2", null, [], 1), N("u1", "l1", ["s1", "l1"], 0), N("d1", "u1", ["s1", "l1", "u1"], 0)];

test("eligibility mirrors the Rules: clone = any framework of an ACTIVE organization; delete-draft = ONLY a never-activated draft (a draft that carries activatedAt, active and archived never qualify)", () => {
  const L = (fw, org) => ({ ...X.lifecycleControls(fw, org) });
  assert.deepEqual(L(FW("draft"), ORG()), { clone: true, deleteDraft: true });
  assert.deepEqual(L(FW("active"), ORG()), { clone: true, deleteDraft: false });
  assert.deepEqual(L(FW("archived"), ORG()), { clone: true, deleteDraft: false });
  assert.deepEqual(L(FW("draft", { activatedAt: null }), ORG()), { clone: true, deleteDraft: false }, "a present activatedAt key means it WAS activated");
  for (const status of ["draft", "active", "archived"]) assert.deepEqual(L(FW(status), ORG("archived")), { clone: false, deleteDraft: false }, status + " in an archived organization");
  assert.deepEqual(L(FW("draft", { organizationId: "other" }), ORG()), { clone: false, deleteDraft: false });
});
test("default clone name: '<name> (bản sao)', never longer than the framework name limit, always valid", () => {
  assert.equal(X.defaultCloneName("Khung A"), "Khung A (bản sao)");
  for (const name of ["x".repeat(120), "ab", "", "  y  ", "z".repeat(500)]) { const out = X.defaultCloneName(name); assert.ok(out.length <= M.FRAMEWORK_NAME_MAX, name.length + ""); assert.doesNotThrow(() => M.validateFrameworkName(out)); }
});
test("clone plan: every node copied with a NEW id, parents remapped, kinds/names/codes/status kept, parents before children, one final ACTIVE node, retire pass for retired nodes", () => {
  counter = 0; const nodes = TREE();
  const plan = X.planClone({ nodes, organizationId: "org1", newId: nextId });
  assert.equal(plan.ok, true); assert.equal(plan.total, 6); assert.equal(plan.retiredCount, 1);
  assert.equal(new Set(plan.items.map((i) => i.newId)).size, 6); assert.ok(plan.items.every((i) => !nodes.some((n) => n.id === i.newId)), "no source id is reused");
  const bySource = Object.fromEntries(plan.items.map((i) => [i.sourceId, i]));
  assert.equal(bySource.s1.parentSourceId, null); assert.equal(bySource.l1.parentSourceId, "s1"); assert.equal(bySource.d1.parentSourceId, "u1");
  assert.deepEqual(plan.items.map((i) => i.sourceId), ["s1", "l1", "u1", "d1", "l2", "s2"], "parent-first depth-first in sibling order");
  assert.deepEqual([bySource.l2.retired, bySource.l1.retired], [true, false]); assert.deepEqual([bySource.s1.code, bySource.s2.code, bySource.l1.name], ["S1", null, "Nút l1"]);
  assert.deepEqual(plan.items.map((i) => i.order), [0, 0, 0, 0, 1, 1]);
  assert.deepEqual(plan.finalItems.map((i) => i.sourceId), ["s2"], "the LAST active node in plan order is committed alone at the very end");
  assert.equal(plan.createChunks.flat().length, 5); assert.ok(!plan.createChunks.flat().some((i) => i.sourceId === "s2"));
  assert.deepEqual(plan.retireChunks.flat(), [bySource.l2.newId]);
  assert.ok(Object.isFrozen(plan));
});
test("clone plan: the final node is always ACTIVE and a leaf; retired nodes are always created+retired BEFORE it (the count only completes at the end)", () => {
  counter = 0; const nodes = [N("a", null, [], 0, { status: "retired" }), N("b", null, [], 1, { status: "retired" }), N("c", null, [], 2), N("c1", "c", ["c"], 0, { status: "retired" })];
  const plan = X.planClone({ nodes, organizationId: "org1", newId: nextId });
  assert.deepEqual(plan.finalItems.map((i) => i.sourceId), ["c"], "c1 is retired, so the last ACTIVE node (c) is final");
  const retiredIds = plan.items.filter((i) => i.retired).map((i) => i.newId);
  assert.deepEqual(plan.retireChunks.flat().sort(), retiredIds.sort()); assert.ok(retiredIds.every((id) => plan.createChunks.flat().some((i) => i.newId === id)));
});
test("clone plan: order values are kept when distinct, renumbered by rank (relative order preserved) only when siblings collide", () => {
  counter = 0;
  const plan = X.planClone({ nodes: [N("a", null, [], 10), N("b", null, [], 3), N("c", null, [], 7), N("x", "a", ["a"], 4), N("y", "a", ["a"], 4), N("z", "a", ["a"], 4)], organizationId: "org1", newId: nextId });
  const orderOf = (id) => plan.items.find((i) => i.sourceId === id).order;
  assert.deepEqual(["b", "c", "a"].map(orderOf), [3, 7, 10], "distinct values kept");
  assert.deepEqual(["x", "y", "z"].map(orderOf), [0, 1, 2], "collisions renumbered by (order, id) rank");
});
test("clone plan refusals (never throws): empty source is a valid empty plan; all-retired source, invalid structure, duplicate canonical codes, cross-organization node and > 5000 nodes are refused", () => {
  counter = 0; const plan = (nodes) => X.planClone({ nodes, organizationId: "org1", newId: nextId });
  const empty = plan([]); assert.deepEqual([empty.ok, empty.total, empty.createChunks.length, empty.finalItems.length], [true, 0, 0, 0]);
  const allRetired = plan([N("a", null, [], 0, { status: "retired" })]); assert.equal(allRetired.ok, false); assert.equal(allRetired.reason, "NO_ACTIVE_NODES");
  const orphan = plan([N("a", null, [], 0), N("o", "ghost", ["ghost"], 0)]); assert.equal(orphan.ok, false); assert.equal(orphan.reason, "INVALID_SOURCE"); assert.ok(orphan.issues.includes("PARENT_MISSING"));
  const dup = plan([N("a", null, [], 0, { code: "x1" }), N("b", null, [], 1, { code: " X1 " })]); assert.equal(dup.ok, false); assert.ok(dup.issues.includes("DUPLICATE_CODE"), "the canonical policy decides");
  assert.equal(plan([N("a", null, [], 0), N("b", null, [], 1, { organizationId: "org2" })]).ok, false);
  const big = plan(Array.from({ length: 5001 }, (_, i) => N("n" + i, null, [], i))); assert.deepEqual([big.ok, big.reason], [false, "TOO_LARGE"]);
  assert.ok(plan([N("a", null, [], 0), N("b", null, [], 0)]).ok, "colliding orders alone are NOT a refusal (renumbered)");
});
test("chunk planning around the Firestore batch boundary (400): sizes, exact boundaries, nothing lost or duplicated, final commit always separate", () => {
  for (const total of [1, 2, 399, 400, 401, 799, 800, 801, 1234]) {
    counter = 0; const nodes = Array.from({ length: total }, (_, i) => N("n" + i, null, [], i));
    const plan = X.planClone({ nodes, organizationId: "org1", newId: nextId });
    assert.equal(plan.ok, true); assert.equal(plan.total, total);
    assert.ok(plan.createChunks.every((c) => c.length >= 1 && c.length <= M.NODE_WRITE_CHUNK), "chunk bound at " + total);
    assert.equal(plan.createChunks.flat().length + plan.finalItems.length, total); assert.equal(plan.finalItems.length, 1);
    assert.equal(new Set([...plan.createChunks.flat(), ...plan.finalItems].map((i) => i.newId)).size, total);
    assert.equal(plan.createChunks.length, Math.ceil((total - 1) / 400));
  }
  assert.deepEqual(X.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]); assert.deepEqual(X.chunk([], 3), []);
});
test("payloads come from the REAL P3-S2 contract: exact node keys, active status, ancestors with NEW ids, depth 4 supported, canonical duplicate codes refused BEFORE any write", () => {
  counter = 0; const org = ORG(), nodes = TREE(), plan = X.planClone({ nodes, organizationId: "org1", newId: nextId });
  const out = X.buildClonePayloads({ contract: C, organization: org, destination: { id: "dest", organizationId: "org1", status: "draft" }, plan });
  assert.equal(out.creates.size, 6); assert.equal(out.retires.size, 1);
  const idOf = Object.fromEntries(plan.items.map((i) => [i.sourceId, i.newId]));
  for (const [id, data] of out.creates) {
    assert.deepEqual(Object.keys(data).sort(), ["ancestors", "code", "createdAt", "kind", "name", "order", "organizationId", "parentId", "schemaVersion", "status", "updatedAt"]);
    assert.equal(data.status, "active"); assert.equal(data.organizationId, "org1"); assert.ok(!nodes.some((n) => n.id === id));
  }
  const d1 = out.creates.get(idOf.d1); assert.deepEqual(d1.ancestors, [idOf.s1, idOf.l1, idOf.u1]); assert.equal(d1.parentId, idOf.u1); assert.equal(M.depthOf(d1), 4);
  assert.equal(out.creates.get(idOf.s1).parentId, null); assert.deepEqual(out.creates.get(idOf.l1).ancestors, [idOf.s1]);
  assert.deepEqual(Object.keys(out.retires.get(idOf.l2)).sort(), ["status", "updatedAt"]); assert.equal(out.retires.get(idOf.l2).status, "retired");
  // the copy of the whole tree validates as a tree and is a faithful structural copy
  const asNodes = [...out.creates].map(([id, d]) => ({ id, ...d, status: out.retires.has(id) ? "retired" : "active" }));
  assert.equal(M.validateTree(asNodes, { organizationId: "org1" }).valid, true);
  assert.equal(asNodes.filter((n) => n.status === "retired").length, 1);
  assert.deepEqual(asNodes.map((n) => n.code).sort(), nodes.map((n) => n.code).sort());
  // a 4-level wide tree and a source mutated nowhere
  assert.deepEqual(nodes.map((n) => n.id), ["s1", "l1", "l2", "s2", "u1", "d1"]); assert.ok(nodes.every((n) => n.organizationId === "org1" && n.updatedAt === undefined));
});
test("payload failures are early validation errors, never partial writes: exceeding the node cap and invalid structure surface as contract errors", () => {
  counter = 0; const org = ORG();
  const plan = X.planClone({ nodes: [N("a", null, [], 0)], organizationId: "org1", newId: nextId });
  assert.throws(() => X.buildClonePayloads({ contract: C, organization: ORG("archived"), destination: { id: "d", organizationId: "org1", status: "draft" }, plan }), (e) => e.name === "CurriculumContractError" && e.code === "ORGANIZATION_ARCHIVED");
  assert.throws(() => X.buildClonePayloads({ contract: C, organization: org, destination: { id: "d", organizationId: "org1", status: "archived" }, plan }), (e) => e.code === "FRAMEWORK_READ_ONLY");
});
test("clone completeness (D1 resolved): nodeCount is a fixed provenance / lower bound - retired, renamed, reordered and ADDED nodes never make a finished clone look incomplete; a partial clone does", () => {
  const fw = FW("draft", { cloneSource: { frameworkId: "src", nodeCount: 4 } });
  const nodes = (n, extra = {}) => Array.from({ length: n }, (_, i) => N("n" + i, null, [], i, extra));
  assert.deepEqual({ ...M.cloneCompleteness(fw, nodes(4)) }, { isClone: true, complete: true, expected: 4, actual: 4 });
  assert.equal(M.cloneCompleteness(fw, nodes(3)).complete, false, "a partial clone");
  assert.equal(M.cloneCompleteness(fw, nodes(4, { status: "retired" })).complete, true, "retiring every node later does not matter");
  assert.equal(M.cloneCompleteness(fw, nodes(9)).complete, true, "nodes added later");
  assert.equal(M.cloneCompleteness(fw, []).complete, false); assert.equal(M.cloneCompleteness(FW("draft", { cloneSource: { frameworkId: "s", nodeCount: 0 } }), []).complete, true, "empty clone");
  assert.equal(M.cloneCompleteness(FW("draft"), []).isClone, false);
  // readiness: INCOMPLETE_CLONE blocks activation of a partial clone only
  const ready = (list) => M.activationReadiness(fw, list, { organization: ORG() });
  const partial = [N("a", null, [], 0), N("b", null, [], 1), N("c", null, [], 2)];
  assert.ok(ready(partial).errors.some((e) => e.code === "INCOMPLETE_CLONE")); assert.equal(ready([...partial, N("d", null, [], 3)]).ready, true);
  assert.equal(ready([...partial, N("d", null, [], 3, { status: "retired" })]).ready, true, "complete by count even when the last copied node is retired later");
});
test("verification of a finished clone: exact id set and statuses, nothing missing or extra", () => {
  counter = 0; const plan = X.planClone({ nodes: TREE(), organizationId: "org1", newId: nextId });
  const stored = plan.items.map((i) => ({ id: i.newId, status: i.retired ? "retired" : "active" }));
  assert.equal(X.verifyClone(plan, stored), true);
  assert.equal(X.verifyClone(plan, stored.slice(1)), false); assert.equal(X.verifyClone(plan, [...stored, { id: "extra", status: "active" }]), false);
  assert.equal(X.verifyClone(plan, stored.map((s, i) => (i === 0 ? { ...s, status: "retired" } : s))), false, "a node that should be active but is retired");
  assert.equal(X.verifyClone(plan, stored.map((s) => ({ ...s, status: "active" }))), false, "the retire pass is part of the clone");
  assert.equal(X.verifyClone(X.planClone({ nodes: [], organizationId: "org1", newId: nextId }), []), true);
});
test("delete-draft plan: every current node id in bounded chunks (children are removed before the framework by the controller)", () => {
  assert.deepEqual({ ...X.planDeleteDraft([]) }, { total: 0, chunks: [] });
  const plan = X.planDeleteDraft(Array.from({ length: 801 }, (_, i) => ({ id: "n" + i })));
  assert.equal(plan.total, 801); assert.deepEqual(plan.chunks.map((c) => c.length), [400, 400, 1]); assert.equal(new Set(plan.chunks.flat()).size, 801);
});
test("markup: clone dialog (default name escaped, progress + error regions, ARIA), delete dialog (permanent wording, distinguishes LƯU TRỮ, explicit confirm)", () => {
  const evil = FW("draft", { name: "<img src=x onerror=1>" });
  const clone = X.renderCloneFormHtml({ framework: evil, defaultName: X.defaultCloneName(evil.name), esc });
  assert.ok(!clone.includes("<img src=x") && clone.includes("&lt;img src=x")); assert.match(clone, /role="dialog" aria-modal="true" aria-labelledby="orgFwDialogTitle"/); assert.match(clone, /id="orgFwName"[^>]*maxlength="120"/);
  assert.match(clone, /id="orgFwProgress"[^>]*aria-live="polite"/); assert.match(clone, /id="orgFwErr"[^>]*role="alert"/); assert.match(clone, /id="orgFwSubmit"[^>]*>NHÂN BẢN/); assert.match(clone, /không bị thay đổi/);
  const del = X.renderDeleteDraftHtml({ framework: evil, esc });
  assert.ok(!del.includes("<img src=x")); assert.match(del, /Xóa vĩnh viễn, không thể khôi phục/); assert.match(del, /LƯU TRỮ<\/b> \(có thể khôi phục\)/); assert.match(del, /id="orgFwConfirm"[^>]*>XÓA BẢN NHÁP/); assert.match(del, /id="orgFwCancel"/);
});
test("transport is payload-agnostic and bounded: ids, framework set, ONE atomic batch per call, deletes", async () => {
  const log = [];
  const collection = (_db, ...path) => ({ path: path.join("/") });
  const doc = (a, ...path) => (path.length ? { path: path.join("/") } : { id: "auto-" + a.path, path: a.path + "/auto" });
  const batch = { set: (r, d) => log.push(["set", r.path, d]), update: (r, d) => log.push(["update", r.path, d]), delete: (r) => log.push(["delete", r.path]), commit: async () => log.push(["commit"]) };
  const w = createCurriculumCloneWriter({ collection, doc, setDoc: async (r, d) => log.push(["setDoc", r.path, d]), writeBatch: () => batch, deleteDoc: async (r) => log.push(["deleteDoc", r.path]), maxBatch: 2 });
  assert.equal(w.newFrameworkId("db"), "auto-curriculumFrameworks"); assert.equal(w.newNodeId("db", "fw"), "auto-curriculumFrameworks/fw/nodes");
  await w.createFramework("db", "fw", { a: 1 }); await w.createNodes("db", "fw", [{ id: "n1", data: { x: 1 } }, { id: "n2", data: { x: 2 } }]); await w.updateNodes("db", "fw", [{ id: "n1", data: { status: "retired" } }]); await w.deleteNodes("db", "fw", ["n1", "n2"]); await w.deleteFramework("db", "fw");
  assert.deepEqual(log.map((l) => l.slice(0, 2).join(":")), ["setDoc:curriculumFrameworks/fw", "set:curriculumFrameworks/fw/nodes/n1", "set:curriculumFrameworks/fw/nodes/n2", "commit", "update:curriculumFrameworks/fw/nodes/n1", "commit", "delete:curriculumFrameworks/fw/nodes/n1", "delete:curriculumFrameworks/fw/nodes/n2", "commit", "deleteDoc:curriculumFrameworks/fw"]);
  for (const call of [() => w.createNodes("db", "fw", []), () => w.createNodes("db", "fw", [1, 2, 3]), () => w.deleteNodes("db", "fw", ["a", "b", "c"]), () => w.updateNodes("db", "fw", [])]) await assert.rejects(async () => call(), TypeError);
  assert.throws(() => createCloneDeleteHelpers({ model: {} }), TypeError);
});
