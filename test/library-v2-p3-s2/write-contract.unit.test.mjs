// LIBRARY V2 P3-S2 - curriculum-write-contract.mjs (pure payload builders). Rules acceptance of these payloads is proven in contract.rules.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createCurriculumWriteContract, buildCloneSource, FRAMEWORK_IMMUTABLE_FIELDS, NODE_IMMUTABLE_FIELDS, NODE_UPDATABLE_FIELDS } from "../../curriculum-write-contract.mjs";
import { CurriculumContractError, planSiblingMove } from "../../curriculum-model.mjs";

let ticks = 0;
const serverTimestamp = () => ({ __serverTimestamp: ++ticks });
const C = createCurriculumWriteContract({ serverTimestamp });
const isTs = (v) => v && typeof v === "object" && typeof v.__serverTimestamp === "number";
const keys = (o) => Object.keys(o).sort();
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof CurriculumContractError && e.code === code, "expected " + code);

const org = { id: "orgA", status: "active" }, archivedOrg = { id: "orgA", status: "archived" };
const fw = (status = "draft", extra = {}) => ({ id: "fw1", organizationId: "orgA", name: "Khung", status, ...(status === "draft" ? {} : { activatedAt: 1 }), ...extra });
const node = (id, extra = {}) => ({ id, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Nut " + id, status: "active", ...extra });
const kid = (id, parent, extra = {}) => node(id, { kind: "lesson", parentId: parent.id, ancestors: [...parent.ancestors, parent.id], ...extra });
const ctx = (nodes = [], over = {}) => ({ organization: org, framework: fw("draft"), nodes, ...over });

test("factory requires the injected serverTimestamp; no builder is exported outside the factory except the clone-source helper", () => {
  assert.throws(() => createCurriculumWriteContract(), TypeError); assert.throws(() => createCurriculumWriteContract({}), TypeError);
  assert.deepEqual(Object.keys(C).sort(), ["buildFrameworkActivate", "buildFrameworkArchive", "buildFrameworkCreate", "buildFrameworkRename", "buildFrameworkRestore", "buildNodeCodeChange", "buildNodeCreate", "buildNodeRename", "buildNodeReorder", "buildNodeRestore", "buildNodeRetire", "buildNodeUpdate"]);
  assert.ok(Object.isFrozen(C));
  assert.deepEqual([...FRAMEWORK_IMMUTABLE_FIELDS], ["organizationId", "scope", "createdAt", "createdBy", "schemaVersion", "cloneSource"]);
  assert.deepEqual([...NODE_IMMUTABLE_FIELDS], ["organizationId", "kind", "parentId", "ancestors", "createdAt", "schemaVersion"]);
  assert.deepEqual([...NODE_UPDATABLE_FIELDS], ["name", "code", "order", "status"]);
});

test("framework create: exact Rules key set, scope organization, draft, no activation metadata, server timestamps, trimmed name", () => {
  const d = C.buildFrameworkCreate({ organization: org, name: "  Chuong trinh 2026 " }, "pa");
  assert.deepEqual(keys(d), ["createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
  assert.equal(d.schemaVersion, 1); assert.equal(d.organizationId, "orgA"); assert.equal(d.scope, "organization"); assert.equal(d.status, "draft");
  assert.equal(d.name, "Chuong trinh 2026"); assert.equal(d.createdBy, "pa"); assert.ok(isTs(d.createdAt) && isTs(d.updatedAt)); assert.notEqual(d.createdAt, d.updatedAt);
  for (const k of ["activatedAt", "statusChangedAt", "statusChangedBy", "cloneSource"]) assert.ok(!(k in d), k);
});
test("framework create: invalid inputs rejected (name bounds, actor, organization state, missing organization)", () => {
  for (const name of ["", "ab", "x".repeat(121), 5, undefined, null]) throwsCode(() => C.buildFrameworkCreate({ organization: org, name }, "pa"), "NAME");
  assert.equal(C.buildFrameworkCreate({ organization: org, name: "x".repeat(120) }, "pa").name.length, 120);
  throwsCode(() => C.buildFrameworkCreate({ organization: org, name: "Khung" }, ""), "ID"); throwsCode(() => C.buildFrameworkCreate({ organization: org, name: "Khung" }), "ID");
  throwsCode(() => C.buildFrameworkCreate({ organization: archivedOrg, name: "Khung" }, "pa"), "ORGANIZATION_ARCHIVED");
  throwsCode(() => C.buildFrameworkCreate({ name: "Khung" }, "pa"), "ORGANIZATION"); throwsCode(() => C.buildFrameworkCreate(undefined, "pa"), "ORGANIZATION");
});
test("framework create with cloneSource: same-organization source only; nodeCount 0..5000; marker has exactly {frameworkId,nodeCount}", () => {
  const src = fw("active", { id: "src" });
  const d = C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: { framework: src, nodeCount: 12 } }, "pa");
  assert.deepEqual(d.cloneSource, { frameworkId: "src", nodeCount: 12 }); assert.deepEqual(keys(d.cloneSource), ["frameworkId", "nodeCount"]);
  assert.equal(C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: { framework: src, nodeCount: 0 } }, "pa").cloneSource.nodeCount, 0);
  assert.equal(C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: null }, "pa").cloneSource, undefined);
  throwsCode(() => C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: { framework: fw("active", { id: "src", organizationId: "orgB" }), nodeCount: 1 } }, "pa"), "CLONE_SOURCE_ORGANIZATION");
  for (const nodeCount of [-1, 5001, 1.5, "3", undefined]) throwsCode(() => C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: { framework: src, nodeCount } }, "pa"), "CLONE_SOURCE");
  throwsCode(() => C.buildFrameworkCreate({ organization: org, name: "Ban sao", cloneSource: { nodeCount: 1 } }, "pa"), "CLONE_SOURCE");
  assert.deepEqual(buildCloneSource(src, org, 3), { frameworkId: "src", nodeCount: 3 });
});

test("framework rename: only {name, updatedAt}; draft/active only; same organization; writable organization", () => {
  const d = C.buildFrameworkRename(fw("draft"), " Ten moi ", { organization: org });
  assert.deepEqual(keys(d), ["name", "updatedAt"]); assert.equal(d.name, "Ten moi"); assert.ok(isTs(d.updatedAt));
  assert.equal(C.buildFrameworkRename(fw("active"), "Ten khac", { organization: org }).name, "Ten khac");
  throwsCode(() => C.buildFrameworkRename(fw("archived"), "Ten khac", { organization: org }), "FRAMEWORK_READ_ONLY");
  throwsCode(() => C.buildFrameworkRename(fw("draft", { organizationId: "orgB" }), "Ten khac", { organization: org }), "ORGANIZATION_MISMATCH");
  throwsCode(() => C.buildFrameworkRename(fw("draft"), "Ten khac", { organization: archivedOrg }), "ORGANIZATION_ARCHIVED");
  throwsCode(() => C.buildFrameworkRename(fw("draft"), "ab", { organization: org }), "NAME"); throwsCode(() => C.buildFrameworkRename(fw("draft"), "Ten khac"), "ORGANIZATION");
});
test("framework lifecycle: activate stamps activatedAt once; archive/restore never touch activatedAt; every status change carries writer metadata; wrong source status refused", () => {
  const s = node("s");
  const a = C.buildFrameworkActivate(fw("draft"), "pa", { organization: org, nodes: [s] });
  assert.deepEqual(keys(a), ["activatedAt", "status", "statusChangedAt", "statusChangedBy", "updatedAt"]); assert.equal(a.status, "active"); assert.equal(a.statusChangedBy, "pa");
  assert.ok(isTs(a.activatedAt) && isTs(a.statusChangedAt) && isTs(a.updatedAt));
  const r = C.buildFrameworkArchive(fw("active"), "pa", { organization: org });
  assert.deepEqual(keys(r), ["status", "statusChangedAt", "statusChangedBy", "updatedAt"]); assert.equal(r.status, "archived"); assert.ok(!("activatedAt" in r));
  const u = C.buildFrameworkRestore(fw("archived"), "pa", { organization: org });
  assert.deepEqual(keys(u), ["status", "statusChangedAt", "statusChangedBy", "updatedAt"]); assert.equal(u.status, "active"); assert.ok(!("activatedAt" in u));
  for (const [fn, status] of [[C.buildFrameworkActivate, "active"], [C.buildFrameworkActivate, "archived"], [C.buildFrameworkArchive, "draft"], [C.buildFrameworkArchive, "archived"], [C.buildFrameworkRestore, "draft"], [C.buildFrameworkRestore, "active"]]) {
    throwsCode(() => fn(fw(status), "pa", { organization: org, nodes: [s] }), "TRANSITION");
  }
  throwsCode(() => C.buildFrameworkArchive(fw("active"), "", { organization: org }), "ID");
  for (const fn of [C.buildFrameworkActivate, C.buildFrameworkArchive, C.buildFrameworkRestore]) throwsCode(() => fn(fw(fn === C.buildFrameworkActivate ? "draft" : fn === C.buildFrameworkArchive ? "active" : "archived"), "pa", { organization: archivedOrg, nodes: [s] }), "ORGANIZATION_ARCHIVED");
  throwsCode(() => C.buildFrameworkArchive(fw("active", { organizationId: "orgB" }), "pa", { organization: org }), "ORGANIZATION_MISMATCH");
});
test("framework activation validates readiness: nodes required, at least one active subject, valid tree, complete clone", () => {
  const f = fw("draft"), s = node("s");
  throwsCode(() => C.buildFrameworkActivate(f, "pa", { organization: org }), "NODES");
  throwsCode(() => C.buildFrameworkActivate(f, "pa", { organization: org, nodes: [] }), "NOT_READY");
  throwsCode(() => C.buildFrameworkActivate(f, "pa", { organization: org, nodes: [node("s", { status: "retired" })] }), "NOT_READY");
  throwsCode(() => C.buildFrameworkActivate(f, "pa", { organization: org, nodes: [s, kid("x", s, { ancestors: [] })] }), "NOT_READY");
  throwsCode(() => C.buildFrameworkActivate({ ...f, cloneSource: { frameworkId: "src", nodeCount: 5 } }, "pa", { organization: org, nodes: [s] }), "NOT_READY");
  assert.equal(C.buildFrameworkActivate({ ...f, cloneSource: { frameworkId: "src", nodeCount: 1 } }, "pa", { organization: org, nodes: [s] }).status, "active");
});

test("node create: exact Rules key set; root subject then lesson with ancestors; status active; timestamps; code normalized", () => {
  const s = C.buildNodeCreate({ kind: "subject", name: " Mon A ", code: "  M1 " }, ctx());
  assert.deepEqual(keys(s), ["ancestors", "code", "createdAt", "kind", "name", "order", "organizationId", "parentId", "schemaVersion", "status", "updatedAt"]);
  assert.deepEqual([s.schemaVersion, s.organizationId, s.kind, s.parentId, s.ancestors, s.order, s.code, s.name, s.status], [1, "orgA", "subject", null, [], 0, "M1", "Mon A", "active"]);
  assert.ok(isTs(s.createdAt) && isTs(s.updatedAt));
  const parent = node("s1", { order: 0 });
  const l = C.buildNodeCreate({ parent, kind: "lesson", name: "Bai 1" }, ctx([parent]));
  assert.deepEqual([l.parentId, l.ancestors, l.order, l.code], ["s1", ["s1"], 0, null]);
  const second = C.buildNodeCreate({ parent, kind: "lesson", name: "Bai 2" }, ctx([parent, kid("l1", parent, { order: 0 })]));
  assert.equal(second.order, 1);                                                      // next free order among THESE siblings
  assert.equal(C.buildNodeCreate({ kind: "subject", name: "Mon B" }, ctx([parent])).order, 1);   // root siblings
  assert.equal(C.buildNodeCreate({ kind: "subject", name: "Mon B", code: "" }, ctx()).code, null);
});
test("node create: depth <= 4 (3 ancestors) accepted, 5th level refused; unit kind supported by the model", () => {
  const s = node("s"), l = kid("l", s, { kind: "unit" }), u = kid("u", l, { kind: "unit" });
  const d4 = C.buildNodeCreate({ parent: u, kind: "lesson", name: "Muc 4" }, ctx([s, l, u]));
  assert.deepEqual(d4.ancestors, ["s", "l", "u"]); assert.equal(d4.ancestors.length + 1, 4);
  const level4 = kid("d4", u);
  throwsCode(() => C.buildNodeCreate({ parent: level4, kind: "lesson", name: "Muc 5" }, ctx([s, l, u, level4])), "DEPTH_EXCEEDED");
  assert.equal(C.buildNodeCreate({ parent: l, kind: "unit", name: "Don vi" }, ctx([s, l])).kind, "unit");
});
test("node create: invalid input and consistency failures", () => {
  const s = node("s", { code: "M1" });
  for (const kind of ["chapter", "", undefined, null]) throwsCode(() => C.buildNodeCreate({ kind, name: "X" }, ctx()), "KIND");
  for (const name of ["", "   ", "x".repeat(201), undefined, 4]) throwsCode(() => C.buildNodeCreate({ kind: "subject", name }, ctx()), "NAME");
  for (const code of ["A".repeat(41), 5]) throwsCode(() => C.buildNodeCreate({ kind: "subject", name: "X", code }, ctx()), "CODE");
  throwsCode(() => C.buildNodeCreate({ kind: "subject", name: "X", code: "M1", order: 5 }, ctx([s])), "DUPLICATE_CODE");
  for (const order of [-1, 100001, 1.5, "2", null]) throwsCode(() => C.buildNodeCreate({ kind: "subject", name: "X", order }, ctx()), "ORDER");
  throwsCode(() => C.buildNodeCreate({ kind: "subject", name: "X", order: 0 }, ctx([s])), "DUPLICATE_ORDER");
  assert.equal(C.buildNodeCreate({ kind: "subject", name: "X", order: 3 }, ctx([s])).order, 3);
  assert.equal(C.buildNodeCreate({ kind: "subject", name: "X", order: 100000 }, ctx()).order, 100000);
  throwsCode(() => C.buildNodeCreate({ parent: node("ghost"), kind: "lesson", name: "X" }, ctx([s])), "PARENT_NOT_FOUND");
  throwsCode(() => C.buildNodeCreate({ parent: node("s2", { organizationId: "orgB" }), kind: "lesson", name: "X" }, ctx([node("s2", { organizationId: "orgB" })])), "ORGANIZATION_MISMATCH");
  assert.equal(C.buildNodeCreate({ id: "newNode", kind: "subject", name: "X", order: 9 }, ctx([s])).parentId, null);
  throwsCode(() => C.buildNodeCreate({ id: "s", kind: "subject", name: "X" }, ctx([s])), "DUPLICATE_ID");
  throwsCode(() => C.buildNodeCreate({ id: "a/b", kind: "subject", name: "X" }, ctx()), "ID");
  throwsCode(() => C.buildNodeCreate({ id: "s", parent: s, kind: "lesson", name: "X" }, ctx([s])), "DUPLICATE_ID");   // own id cannot equal an existing node (incl. its own parent)
  const full = Array.from({ length: 5000 }, (_, i) => node("n" + i, { order: i }));
  throwsCode(() => C.buildNodeCreate({ kind: "subject", name: "X" }, ctx(full)), "NODE_COUNT_EXCEEDED");
  assert.equal(C.buildNodeCreate({ kind: "subject", name: "X" }, ctx(full.slice(0, 4999))).order, 4999);
});
test("node create: writable organization, editable framework of the SAME organization, loaded nodes required", () => {
  const input = { kind: "subject", name: "X" };
  throwsCode(() => C.buildNodeCreate(input, ctx([], { organization: archivedOrg })), "ORGANIZATION_ARCHIVED");
  throwsCode(() => C.buildNodeCreate(input, ctx([], { framework: fw("archived") })), "FRAMEWORK_READ_ONLY");
  throwsCode(() => C.buildNodeCreate(input, ctx([], { framework: fw("draft", { organizationId: "orgB" }) })), "ORGANIZATION_MISMATCH");
  throwsCode(() => C.buildNodeCreate(input, { organization: org, framework: fw("draft") }), "NODES");
  throwsCode(() => C.buildNodeCreate(input, undefined), "ORGANIZATION");
  assert.equal(C.buildNodeCreate(input, ctx([], { framework: fw("active") })).status, "active");   // an ACTIVE framework still accepts new nodes
});

test("node update: label / code / order / status only; trimmed; code and order checked against the loaded siblings; every immutable field refused by name", () => {
  const a = node("a", { code: "A1", order: 0 }), b = node("b", { code: "B1", order: 1 });
  const nodes = [a, b];
  const d = C.buildNodeUpdate(a, { name: " Moi ", code: " A2 ", order: 5, status: "retired" }, ctx(nodes));
  assert.deepEqual(keys(d), ["code", "name", "order", "status", "updatedAt"]); assert.deepEqual([d.name, d.code, d.order, d.status], ["Moi", "A2", 5, "retired"]); assert.ok(isTs(d.updatedAt));
  assert.deepEqual(keys(C.buildNodeUpdate(a, { name: "Chi doi ten" }, ctx(nodes))), ["name", "updatedAt"]);
  assert.equal(C.buildNodeUpdate(a, { code: "" }, ctx(nodes)).code, null); assert.equal(C.buildNodeUpdate(a, { code: null }, ctx(nodes)).code, null);
  assert.equal(C.buildNodeCodeChange(a, "A1", ctx(nodes)).code, "A1");                         // own current code is not a conflict
  assert.equal(C.buildNodeRename(a, "Doi ten", ctx(nodes)).name, "Doi ten");
  throwsCode(() => C.buildNodeUpdate(a, { code: "B1" }, ctx(nodes)), "DUPLICATE_CODE");
  throwsCode(() => C.buildNodeUpdate(a, { order: 1 }, ctx(nodes)), "DUPLICATE_ORDER");
  for (const field of NODE_IMMUTABLE_FIELDS) throwsCode(() => C.buildNodeUpdate(a, { [field]: "x" }, ctx(nodes)), "IMMUTABLE_FIELD");
  throwsCode(() => C.buildNodeUpdate(a, { frameworkId: "f" }, ctx(nodes)), "UNKNOWN_FIELD"); throwsCode(() => C.buildNodeUpdate(a, { updatedAt: 1 }, ctx(nodes)), "UNKNOWN_FIELD");
  throwsCode(() => C.buildNodeUpdate(a, {}, ctx(nodes)), "CHANGES"); throwsCode(() => C.buildNodeUpdate(a, null, ctx(nodes)), "CHANGES"); throwsCode(() => C.buildNodeUpdate(a, [], ctx(nodes)), "CHANGES");
  throwsCode(() => C.buildNodeUpdate(a, { name: "" }, ctx(nodes)), "NAME"); throwsCode(() => C.buildNodeUpdate(a, { order: -1 }, ctx(nodes)), "ORDER"); throwsCode(() => C.buildNodeUpdate(a, { status: "draft" }, ctx(nodes)), "STATUS");
  throwsCode(() => C.buildNodeUpdate(node("ghost"), { name: "X" }, ctx(nodes)), "NODE_NOT_FOUND"); throwsCode(() => C.buildNodeUpdate(null, { name: "X" }, ctx(nodes)), "NODE_NOT_FOUND");
  throwsCode(() => C.buildNodeUpdate(a, { name: "X" }, ctx(nodes, { framework: fw("archived") })), "FRAMEWORK_READ_ONLY");
  throwsCode(() => C.buildNodeUpdate(a, { name: "X" }, ctx(nodes, { organization: archivedOrg })), "ORGANIZATION_ARCHIVED");
  throwsCode(() => C.buildNodeUpdate(node("a", { organizationId: "orgB" }), { name: "X" }, ctx([node("a", { organizationId: "orgB" })])), "ORGANIZATION_MISMATCH");
});
test("node retire / restore: only active -> retired and retired -> active", () => {
  const a = node("a"), r = node("r", { status: "retired", order: 1 });
  assert.equal(C.buildNodeRetire(a, ctx([a, r])).status, "retired"); assert.equal(C.buildNodeRestore(r, ctx([a, r])).status, "active");
  throwsCode(() => C.buildNodeRetire(r, ctx([a, r])), "TRANSITION"); throwsCode(() => C.buildNodeRestore(a, ctx([a, r])), "TRANSITION");
  assert.deepEqual(keys(C.buildNodeRetire(a, ctx([a, r]))), ["status", "updatedAt"]);
  throwsCode(() => C.buildNodeRetire(a, ctx([a, r], { framework: fw("archived") })), "FRAMEWORK_READ_ONLY");
});
test("node reorder: builds one {id,data} per planned change; refuses no-op, unknown nodes, mixed parents and duplicate resulting orders", () => {
  const a = node("a", { order: 0 }), b = node("b", { order: 1 }), c = node("c", { order: 2 }), k = kid("k", a, { order: 0 });
  const nodes = [a, b, c, k];
  const out = C.buildNodeReorder(planSiblingMove(nodes, "b", "up"), ctx(nodes));
  assert.deepEqual(out.map((x) => [x.id, x.data.order]), [["b", 0], ["a", 1]]); for (const x of out) { assert.deepEqual(keys(x.data), ["order", "updatedAt"]); assert.ok(isTs(x.data.updatedAt)); }
  throwsCode(() => C.buildNodeReorder(planSiblingMove(nodes, "a", "up"), ctx(nodes)), "NOOP");
  throwsCode(() => C.buildNodeReorder(null, ctx(nodes)), "PLAN"); throwsCode(() => C.buildNodeReorder({ changes: "x" }, ctx(nodes)), "PLAN");
  throwsCode(() => C.buildNodeReorder({ changes: [{ id: "zzz", order: 1 }] }, ctx(nodes)), "NODE_NOT_FOUND");
  throwsCode(() => C.buildNodeReorder({ changes: [{ id: "a", order: 1 }, { id: "k", order: 5 }] }, ctx(nodes)), "PLAN");
  throwsCode(() => C.buildNodeReorder({ changes: [{ id: "a", order: 1 }] }, ctx(nodes)), "DUPLICATE_ORDER");
  throwsCode(() => C.buildNodeReorder({ changes: [{ id: "a", order: -1 }] }, ctx(nodes)), "ORDER");
  const dup = [node("x", { order: 1 }), node("y", { order: 1 }), node("z", { order: 1 })];
  assert.deepEqual(C.buildNodeReorder(planSiblingMove(dup, "z", "up"), ctx(dup)).map((x) => [x.id, x.data.order]), [["x", 0], ["y", 2]]);   // renumber plan passes
  throwsCode(() => C.buildNodeReorder(planSiblingMove(nodes, "b", "down"), ctx(nodes, { framework: fw("archived") })), "FRAMEWORK_READ_ONLY");
});

test("builders never mutate their inputs and call serverTimestamp() per timestamp field (no shared sentinel)", () => {
  const parent = Object.freeze(node("p")), nodes = Object.freeze([parent]);
  const before = JSON.stringify(nodes);
  const d = C.buildNodeCreate({ parent, kind: "lesson", name: "X" }, { organization: Object.freeze({ ...org }), framework: Object.freeze(fw("draft")), nodes });
  assert.equal(JSON.stringify(nodes), before); assert.notEqual(d.createdAt, d.updatedAt); assert.deepEqual(d.ancestors, ["p"]); assert.notEqual(d.ancestors, parent.ancestors);
});
