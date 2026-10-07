// LIBRARY V2 P3-S2 - curriculum-model.mjs (pure domain logic). No Firestore, no browser.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../curriculum-model.mjs";

const n = (id, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Nut " + id, status: "active", ...extra });
const child = (id, parent, extra = {}) => n(id, { kind: "lesson", parentId: parent.id, ancestors: [...parent.ancestors, parent.id], ...extra });
const codes = (r) => r.issues.map((i) => i.code);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof M.CurriculumContractError && e.code === code, "expected " + code);

test("constants mirror the approved contract and the deployed Rules", () => {
  assert.equal(M.CURRICULUM_SCHEMA_VERSION, 1); assert.equal(M.FRAMEWORK_SCOPE, "organization");
  assert.deepEqual([...M.FRAMEWORK_STATUSES], ["draft", "active", "archived"]);
  assert.deepEqual([...M.NODE_KINDS], ["subject", "unit", "lesson"]); assert.deepEqual([...M.NODE_STATUSES], ["active", "retired"]);
  assert.equal(M.CURRICULUM_MAX_DEPTH, 4); assert.equal(M.CURRICULUM_MAX_ANCESTORS, 3); assert.equal(M.CURRICULUM_MAX_NODES, 5000); assert.equal(M.CURRICULUM_UI_LEVELS, 2);
  assert.deepEqual([M.FRAMEWORK_NAME_MIN, M.FRAMEWORK_NAME_MAX, M.NODE_NAME_MIN, M.NODE_NAME_MAX, M.NODE_CODE_MIN, M.NODE_CODE_MAX, M.NODE_ORDER_MIN, M.NODE_ORDER_MAX], [3, 120, 1, 200, 1, 40, 0, 100000]);
  assert.equal(M.FRAMEWORK_LIST_LIMIT, 100); assert.equal(M.CLONE_NODE_COUNT_MAX, 5000); assert.equal(M.NODE_WRITE_CHUNK, 400);
  assert.deepEqual({ ...M.UI_KIND_BY_DEPTH }, { 1: "subject", 2: "lesson" });
  for (const frozen of [M.FRAMEWORK_STATUSES, M.NODE_KINDS, M.NODE_STATUSES, M.FRAMEWORK_TRANSITIONS, M.UI_KIND_BY_DEPTH, M.FRAMEWORK_LIST_STATUS_ORDER]) assert.ok(Object.isFrozen(frozen));
});

test("framework name: trimmed, 3..120 characters; everything else rejected", () => {
  assert.equal(M.validateFrameworkName("  Khung chuong trinh  "), "Khung chuong trinh");
  assert.equal(M.validateFrameworkName("abc"), "abc"); assert.equal(M.validateFrameworkName("x".repeat(120)).length, 120);
  for (const bad of ["", "ab", "  a ", "x".repeat(121), 123, null, undefined, {}, ["abc"]]) throwsCode(() => M.validateFrameworkName(bad), "NAME");
});
test("node name: trimmed, 1..200; node code optional (blank -> null), 1..40, trimmed", () => {
  assert.equal(M.validateNodeName(" Bai 1 "), "Bai 1"); assert.equal(M.validateNodeName("x".repeat(200)).length, 200);
  for (const bad of ["", "   ", "x".repeat(201), 5, null, undefined]) throwsCode(() => M.validateNodeName(bad), "NAME");
  for (const blank of [undefined, null, "", "   "]) assert.equal(M.normalizeNodeCode(blank), null);
  assert.equal(M.normalizeNodeCode(" B01 "), "B01"); assert.equal(M.normalizeNodeCode("A".repeat(40)).length, 40);
  for (const bad of ["A".repeat(41), 7, {}, []]) throwsCode(() => M.normalizeNodeCode(bad), "CODE");
});
test("order, kind, status validators (boundaries)", () => {
  for (const ok of [0, 1, 100000]) assert.equal(M.validateNodeOrder(ok), ok);
  for (const bad of [-1, 100001, 1.5, "1", NaN, Infinity, null, undefined]) throwsCode(() => M.validateNodeOrder(bad), "ORDER");
  for (const k of ["subject", "unit", "lesson"]) assert.equal(M.validateNodeKind(k), k);
  for (const bad of ["chapter", "", null, undefined, "Subject"]) throwsCode(() => M.validateNodeKind(bad), "KIND");
  for (const s of ["active", "retired"]) assert.equal(M.validateNodeStatus(s), s);
  for (const bad of ["draft", "archived", "", null]) throwsCode(() => M.validateNodeStatus(bad), "STATUS");
  for (const s of ["draft", "active", "archived"]) assert.equal(M.validateFrameworkStatus(s), s);
  for (const bad of ["retired", "", null]) throwsCode(() => M.validateFrameworkStatus(bad), "STATUS");
});
test("ids: non-empty string, no slash, at most 128", () => {
  assert.ok(M.isValidId("a")); assert.ok(M.isValidId("x".repeat(128)));
  for (const bad of ["", "a/b", "x".repeat(129), 5, null, undefined, ["a"]]) assert.ok(!M.isValidId(bad));
  throwsCode(() => M.requireId("a/b", "x"), "ID");
});

test("lifecycle: exactly draft->active, active->archived, archived->active are allowed (6 ordered non-identity pairs)", () => {
  const all = ["draft", "active", "archived"]; const allowed = new Set(["draft>active", "active>archived", "archived>active"]);
  for (const a of all) for (const b of all) assert.equal(M.isAllowedFrameworkTransition(a, b), allowed.has(a + ">" + b), a + ">" + b);
  assert.deepEqual({ ...M.FRAMEWORK_TRANSITIONS.activate }, { from: "draft", to: "active" });
  assert.deepEqual({ ...M.FRAMEWORK_TRANSITIONS.archive }, { from: "active", to: "archived" });
  assert.deepEqual({ ...M.FRAMEWORK_TRANSITIONS.restore }, { from: "archived", to: "active" });
  assert.equal(M.requireFrameworkAction({ status: "draft" }, "activate").to, "active");
  throwsCode(() => M.requireFrameworkAction({ status: "active" }, "activate"), "TRANSITION");
  throwsCode(() => M.requireFrameworkAction({ status: "draft" }, "archive"), "TRANSITION");
  throwsCode(() => M.requireFrameworkAction({ status: "draft" }, "bogus"), "ACTION");
  throwsCode(() => M.requireFrameworkAction(null, "activate"), "TRANSITION");
});
test("activatedAt semantics: 'never activated' = draft AND the activatedAt key is ABSENT (a present null still counts as activated)", () => {
  assert.equal(M.isNeverActivated({ status: "draft" }), true);
  assert.equal(M.isNeverActivated({ status: "draft", activatedAt: null }), false);
  assert.equal(M.isNeverActivated({ status: "draft", activatedAt: { seconds: 1 } }), false);
  assert.equal(M.isNeverActivated({ status: "active" }), false); assert.equal(M.isNeverActivated({ status: "archived" }), false); assert.equal(M.isNeverActivated(null), false);
});
test("organization and framework availability: archived organization or archived framework is read-only; delete only for never-activated drafts", () => {
  const org = { id: "orgA", status: "active" }, arch = { id: "orgA", status: "archived" };
  const fw = (status, extra = {}) => ({ id: "f", organizationId: "orgA", status, ...extra });
  const a = M.frameworkAvailability(fw("draft"), org);
  assert.deepEqual({ ...a }, { organizationWritable: true, readOnly: false, canRename: true, canEditNodes: true, canActivate: true, canArchive: false, canRestore: false, canDelete: true, neverActivated: true });
  const b = M.frameworkAvailability(fw("active", { activatedAt: 1 }), org);
  assert.deepEqual([b.canRename, b.canActivate, b.canArchive, b.canRestore, b.canDelete, b.readOnly], [true, false, true, false, false, false]);
  const c = M.frameworkAvailability(fw("archived", { activatedAt: 1 }), org);
  assert.deepEqual([c.canRename, c.canEditNodes, c.canRestore, c.canArchive, c.readOnly], [false, false, true, false, true]);
  assert.equal(M.frameworkAvailability(fw("draft", { activatedAt: null }), org).canDelete, false);
  for (const status of ["draft", "active", "archived"]) {
    const x = M.frameworkAvailability(fw(status), arch);   // archived ORGANIZATION: nothing writable, even for the Platform Admin (P3-S1 Rules)
    assert.deepEqual([x.organizationWritable, x.readOnly, x.canRename, x.canActivate, x.canArchive, x.canRestore, x.canDelete], [false, true, false, false, false, false, false], status);
  }
  const other = M.frameworkAvailability({ id: "f", organizationId: "orgB", status: "draft" }, org);
  assert.equal(other.organizationWritable, false); assert.equal(other.canRename, false);
  assert.equal(M.isOrganizationWritable(null), false); assert.equal(M.isOrganizationWritable({ id: "o", status: "archived" }), false);
  throwsCode(() => M.requireWritableOrganization({ id: "o", status: "archived" }), "ORGANIZATION_ARCHIVED");
  throwsCode(() => M.requireWritableOrganization({ status: "active" }), "ORGANIZATION");
  throwsCode(() => M.requireEditableFramework(fw("archived")), "FRAMEWORK_READ_ONLY");
  throwsCode(() => M.requireSameOrganization(fw("draft", { organizationId: "orgB" }), org), "ORGANIZATION_MISMATCH");
});

test("clone marker: fields bounded; the source must belong to the SAME organization; completeness = active node count equals the marker", () => {
  assert.deepEqual(M.validateCloneSourceFields({ frameworkId: "fw", nodeCount: 0 }), { frameworkId: "fw", nodeCount: 0 });
  assert.equal(M.validateCloneSourceFields({ frameworkId: "fw", nodeCount: 5000 }).nodeCount, 5000);
  for (const nodeCount of [-1, 5001, 1.5, "3", null, undefined]) throwsCode(() => M.validateCloneSourceFields({ frameworkId: "fw", nodeCount }), "CLONE_SOURCE");
  throwsCode(() => M.validateCloneSourceFields({ frameworkId: "", nodeCount: 1 }), "ID");
  const org = { id: "orgA", status: "active" };
  assert.equal(M.requireSameOrganizationCloneSource({ id: "s", organizationId: "orgA" }, org).id, "s");
  throwsCode(() => M.requireSameOrganizationCloneSource({ id: "s", organizationId: "orgB" }, org), "CLONE_SOURCE_ORGANIZATION");
  throwsCode(() => M.requireSameOrganizationCloneSource(null, org), "CLONE_SOURCE");
  assert.deepEqual({ ...M.cloneCompleteness({ status: "draft" }, []) }, { isClone: false, complete: true, expected: null, actual: null });
  const fw = { status: "draft", cloneSource: { frameworkId: "s", nodeCount: 2 } };
  assert.deepEqual({ ...M.cloneCompleteness(fw, [n("a"), n("b")]) }, { isClone: true, complete: true, expected: 2, actual: 2 });
  assert.equal(M.cloneCompleteness(fw, [n("a")]).complete, false);
  assert.equal(M.cloneCompleteness(fw, [n("a"), n("b", { status: "retired" })]).actual, 1);   // retired nodes are not counted (as P3 Design R1 section 10)
});

test("structure: depth <= 4 (at most 3 ancestors), unique string ancestors, no self in ancestors, parent == last ancestor", () => {
  const ok = (s) => assert.deepEqual(M.structureIssues(s), [], JSON.stringify(s));
  const bad = (s, code) => assert.ok(M.structureIssues(s).some((i) => i.code === code), code + " for " + JSON.stringify(s));
  ok({ id: "x", parentId: null, ancestors: [] }); ok({ id: "x", parentId: "a", ancestors: ["a"] }); ok({ id: "x", parentId: "c", ancestors: ["a", "b", "c"] });
  bad({ id: "x", parentId: "d", ancestors: ["a", "b", "c", "d"] }, "DEPTH_EXCEEDED");
  bad({ id: "x", parentId: "a", ancestors: ["a", "a"] }, "ANCESTORS_DUPLICATE");
  bad({ id: "x", parentId: "p", ancestors: ["x", "p"] }, "SELF_IN_ANCESTORS");
  bad({ id: "x", parentId: "x", ancestors: ["x"] }, "SELF_PARENT");
  bad({ id: "x", parentId: null, ancestors: ["a"] }, "PARENT_MISMATCH");
  bad({ id: "x", parentId: "a", ancestors: [] }, "PARENT_MISMATCH");
  bad({ id: "x", parentId: "a", ancestors: ["a", "b"] }, "PARENT_MISMATCH");
  bad({ id: "x", parentId: "b", ancestors: [1, "b"] }, "ANCESTOR_TYPE");
  bad({ id: "x", parentId: 3, ancestors: [3] }, "PARENT_TYPE");
  bad({ id: "x", parentId: null, ancestors: "a" }, "ANCESTORS_TYPE");
  assert.deepEqual(M.structureIssues({ parentId: null, ancestors: [] }), []);   // id optional (before the id exists)
});
test("ancestorsForChild / canAddChild / depth / UI kind policy (MON -> BAI only)", () => {
  const s = n("s"), l = child("l", s), u = child("u", l, { kind: "unit" }), d4 = child("d4", u);
  assert.deepEqual(M.ancestorsForChild(null), []); assert.deepEqual(M.ancestorsForChild(s), ["s"]); assert.deepEqual(M.ancestorsForChild(l), ["s", "l"]);
  assert.deepEqual([M.depthOf(s), M.depthOf(l), M.depthOf(u), M.depthOf(d4)], [1, 2, 3, 4]);
  assert.equal(M.canAddChild(null), true); assert.equal(M.canAddChild(s), true); assert.equal(M.canAddChild(l), true); assert.equal(M.canAddChild(u), true); assert.equal(M.canAddChild(d4), false);
  assert.equal(M.uiKindForParent(null), "subject"); assert.equal(M.uiKindForParent(s), "lesson"); assert.equal(M.uiKindForParent(l), null); assert.equal(M.uiKindForParent(u), null);
  throwsCode(() => M.ancestorsForChild({ id: "x" }), "PARENT");
});

test("nodeIssues: mirrors the Rules node shape facts (never throws)", () => {
  assert.deepEqual(M.nodeIssues(n("a"), { organizationId: "orgA" }), []);
  const c = (node, code, opts) => assert.ok(M.nodeIssues(node, opts).some((i) => i.code === code), code);
  c(n("a", { kind: "chapter" }), "KIND"); c(n("a", { status: "draft" }), "STATUS"); c(n("a", { order: -1 }), "ORDER"); c(n("a", { order: 100001 }), "ORDER"); c(n("a", { order: 1.5 }), "ORDER");
  c(n("a", { name: "" }), "NAME"); c(n("a", { name: "x".repeat(201) }), "NAME"); c(n("a", { code: "" }), "CODE"); c(n("a", { code: "A".repeat(41) }), "CODE"); c(n("a", { code: 5 }), "CODE");
  c(n("a", { organizationId: 5 }), "ORGANIZATION"); c(n("a"), "ORGANIZATION_MISMATCH", { organizationId: "orgB" }); c(n("a", { schemaVersion: 2 }), "SCHEMA_VERSION");
  c(n("a", { parentId: "p", ancestors: ["p", "q"] }), "PARENT_MISMATCH"); c({ id: "" }, "ID"); c(null, "NODE_TYPE");
});

test("ordering: siblings sorted by (order, id); next order; exhausted order space is an error", () => {
  const a = n("a", { order: 2 }), b = n("b", { order: 1 }), c = n("c", { order: 1 });
  assert.deepEqual(M.sortedSiblings([a, b, c], null).map((x) => x.id), ["b", "c", "a"]);
  assert.equal(M.nextSiblingOrder([a, b, c], null), 3); assert.equal(M.nextSiblingOrder([], null), 0);
  const l = child("l", a, { order: 7 }); assert.equal(M.nextSiblingOrder([a, b, c, l], "a"), 8); assert.equal(M.nextSiblingOrder([a, b, c, l], undefined), 3);
  throwsCode(() => M.nextSiblingOrder([n("z", { order: 100000 })], null), "ORDER_EXHAUSTED");
});
test("planSiblingMove: swaps two order values (2 writes), no-op at the ends, renumbers when orders collide, never touches other parents", () => {
  const a = n("a", { order: 0 }), b = n("b", { order: 5 }), c = n("c", { order: 9 }), other = child("o", a, { order: 0 });
  const nodes = [a, b, c, other];
  assert.deepEqual(M.planSiblingMove(nodes, "b", "up").changes.map((x) => ({ ...x })), [{ id: "b", order: 0 }, { id: "a", order: 5 }]);
  assert.deepEqual(M.planSiblingMove(nodes, "b", "down").changes.map((x) => ({ ...x })), [{ id: "c", order: 5 }, { id: "b", order: 9 }]);
  assert.equal(M.planSiblingMove(nodes, "a", "up").noop, true); assert.equal(M.planSiblingMove(nodes, "c", "down").noop, true);
  assert.equal(M.planSiblingMove(nodes, "o", "up").noop, true); assert.equal(M.planSiblingMove(nodes, "o", "down").noop, true);   // only child of its parent
  const dup = [n("a", { order: 1 }), n("b", { order: 1 }), n("c", { order: 1 })];
  const plan = M.planSiblingMove(dup, "c", "up");   // sorted a,b,c -> a,c,b -> renumber 0,1,2
  assert.equal(plan.renumbered, true); assert.deepEqual(plan.changes.map((x) => ({ ...x })), [{ id: "a", order: 0 }, { id: "b", order: 2 }]);   // c keeps order 1; only changed nodes are returned
  assert.throws(() => M.planSiblingMove(nodes, "b", "sideways"), (e) => e.code === "DIRECTION");
  assert.throws(() => M.planSiblingMove(nodes, "zzz", "up"), (e) => e.code === "NODE_NOT_FOUND");
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.changes));
});

test("buildTree: roots/children sorted deterministically with depth; orphans and cycles are returned, never dropped", () => {
  const s1 = n("s1", { order: 1 }), s0 = n("s0", { order: 0 }), l2 = child("l2", s0, { order: 2 }), l1 = child("l1", s0, { order: 1 });
  const orphan = n("or", { parentId: "ghost", ancestors: ["ghost"] }), c1 = n("c1", { parentId: "c2", ancestors: ["c2"] }), c2 = n("c2", { parentId: "c1", ancestors: ["c1"] });
  const t = M.buildTree([s1, l2, s0, l1, orphan, c1, c2]);
  assert.deepEqual(t.roots.map((r) => r.node.id), ["s0", "s1"]);
  assert.deepEqual(t.roots[0].children.map((c) => c.node.id), ["l1", "l2"]); assert.equal(t.roots[0].children[0].depth, 2); assert.equal(t.roots[0].depth, 1);
  assert.deepEqual(t.orphans.map((o) => o.id).sort(), ["c1", "c2", "or"]);
  assert.deepEqual(M.buildTree(undefined).roots, []); assert.equal(t.index.get("l1").node.id, "l1");
});

test("validateTree: a consistent tree is valid; every integrity failure is reported with its code", () => {
  const s = n("s", { order: 0, code: "M1" }), l = child("l", s, { order: 0, code: "B1" }), l2 = child("l2", s, { order: 1 });
  const good = M.validateTree([s, l, l2], { organizationId: "orgA" });
  assert.equal(good.valid, true); assert.deepEqual(good.issues, []); assert.deepEqual({ ...good.stats }, { nodeCount: 3, activeCount: 3, rootCount: 1, orphanCount: 0, maxDepth: 2 });
  const t = (nodes, code, opts = { organizationId: "orgA" }) => assert.ok(codes(M.validateTree(nodes, opts)).includes(code), code);
  t([s, child("x", s, { ancestors: [] })], "PARENT_MISMATCH");
  t([s, child("x", s, { ancestors: ["other", "s"] })], "ANCESTORS_MISMATCH");                       // parent ok, stored ancestors wrong (extra element)
  t([s, n("x", { parentId: "s", ancestors: ["zzz"] })], "ANCESTORS_MISMATCH");                       // consistent with parentId? no: last ancestor != parent -> also PARENT_MISMATCH
  t([n("x", { parentId: "ghost", ancestors: ["ghost"] })], "PARENT_MISSING");
  t([n("a", { parentId: "b", ancestors: ["b"] }), n("b", { parentId: "a", ancestors: ["a"] })], "CYCLE");
  t([n("a", { parentId: "a", ancestors: ["a"] })], "SELF_PARENT");
  t([n("a", { parentId: "p", ancestors: ["a", "p"] }), n("p")], "SELF_IN_ANCESTORS");
  t([s, child("a", s, { order: 1 }), child("b", s, { order: 1 })], "DUPLICATE_ORDER");
  const deep = []; let prev = null; for (let i = 0; i < 5; i++) { const node = n("d" + i, prev ? { parentId: prev.id, ancestors: [...prev.ancestors, prev.id], kind: "unit" } : {}); deep.push(node); prev = node; }
  t(deep, "DEPTH_EXCEEDED");
  t([s, n("s2", { order: 0 })], "DUPLICATE_ORDER");
  t([n("s", { code: "M1" }), n("s2", { order: 1, code: "M1" })], "DUPLICATE_CODE");
  t([s, n("s2", { order: 1, organizationId: "orgB" })], "ORGANIZATION_MISMATCH");
  t([s, n("s", { order: 3 })], "DUPLICATE_ID");
  t([n("a", { kind: "chapter" })], "KIND");
  const big = Array.from({ length: 5001 }, (_, i) => n("n" + i, { order: i }));
  assert.ok(codes(M.validateTree(big, { organizationId: "orgA" })).includes("NODE_COUNT_EXCEEDED"));
  assert.equal(M.validateTree(big.slice(0, 5000), { organizationId: "orgA" }).valid, true);          // exactly 5000 is allowed
  assert.equal(M.validateTree([], {}).valid, true); assert.equal(M.validateTree(undefined).valid, true);
});
test("codes: duplicate detection uses the canonical comparison; blank codes never conflict; the node's own code is excluded", () => {
  const nodes = [n("a", { code: "M1" }), n("b", { code: null, order: 1 }), n("c", { code: "M2", order: 2 })];
  assert.equal(M.codeInUse(nodes, "M1"), true); assert.equal(M.codeInUse(nodes, "M1", "a"), false); assert.equal(M.codeInUse(nodes, "M3"), false);
  assert.equal(M.codeInUse(nodes, null), false); assert.equal(M.codeInUse(nodes, ""), false); assert.equal(M.codeInUse(nodes, "   "), false); assert.equal(M.codeInUse(nodes, 7), false);
  assert.equal(M.validateTree(nodes, { organizationId: "orgA" }).valid, true);
});

// ---- P3-S2 policy refinement D2: ONE canonical comparison policy (trim -> NFKC -> case-insensitive fold), display code untouched
const NFC = (s) => s.normalize("NFC"), NFD = (s) => s.normalize("NFD");
const viet = "B" + String.fromCharCode(0xe0) + "i 1";                       // precomposed a-grave (NFC)
const fullWidth = String.fromCharCode(0xff22, 0xff10, 0xff11);              // fullwidth B, 0, 1
test("canonicalizeNodeCode: trim -> NFKC -> case-insensitive; blank/null -> null; idempotent; locale-independent; version 1", () => {
  assert.equal(M.CODE_CANONICAL_FORM_VERSION, 1);
  for (const blank of [undefined, null, "", "   ", String.fromCharCode(9, 10, 32)]) assert.equal(M.canonicalizeNodeCode(blank), null);
  for (const bad of [5, {}, [], true]) assert.throws(() => M.canonicalizeNodeCode(bad), (e) => e instanceof M.CurriculumContractError && e.code === "CODE");
  assert.equal(M.canonicalizeNodeCode("B01"), M.canonicalizeNodeCode("b01"));
  for (const sample of ["  B01  ", "M-1 / a", viet, NFD(viet), fullWidth, "Stra" + String.fromCharCode(0xdf) + "e", String.fromCharCode(0x130) + "x"]) assert.equal(M.canonicalizeNodeCode(M.canonicalizeNodeCode(sample)), M.canonicalizeNodeCode(sample), "idempotent");
  assert.ok(!M.canonicalizeNodeCode(viet).includes(String.fromCharCode(0x300)));       // composed, not combining
});
test("canonical collision: whitespace, upper/lower case and Unicode-normalization-equivalent variants are the SAME code; genuinely different codes are not", () => {
  const same = (a, b) => assert.equal(M.canonicalizeNodeCode(a), M.canonicalizeNodeCode(b), JSON.stringify([a, b]));
  const diff = (a, b) => assert.notEqual(M.canonicalizeNodeCode(a), M.canonicalizeNodeCode(b), JSON.stringify([a, b]));
  same("B01", "  B01  "); same("B01", "b01"); same("B01", " b01\t"); same("Mon-A", "mON-a");                     // whitespace + case
  same(NFC(viet), NFD(viet)); same(NFC(viet).toUpperCase(), NFD(viet).toLowerCase());                           // Unicode-normalization-equivalent (+ case)
  assert.notEqual(NFC(viet), NFD(viet)); assert.notEqual(NFC(viet).length, NFD(viet).length);                   // really different code point sequences
  same(fullWidth, "B01"); same("Stra" + String.fromCharCode(0xdf) + "e", "STRASSE");                            // compatibility forms / full case folding
  diff("B01", "B02"); diff("B01", "B 01"); diff("B01", "B-01"); diff("A", "A" + String.fromCharCode(0x301)); diff("A", String.fromCharCode(0xc1)); // no diacritic stripping, no inner-space collapsing
  diff("M1", "M1" + String.fromCharCode(0x200b));                                                                // a zero-width space is NOT silently dropped
});
test("uniqueness policy: codeInUse and validateTree collide on every equivalent variant; the stored display code is never altered", () => {
  const stored = [n("a", { code: NFC(viet) }), n("b", { code: "m-1", order: 1 })];
  for (const variant of ["  " + NFC(viet) + "  ", NFD(viet), NFC(viet).toUpperCase(), NFD(viet).toLowerCase(), "M-1", " M-1", "m-1 "]) assert.equal(M.codeInUse(stored, variant), true, JSON.stringify(variant));
  assert.equal(M.codeInUse(stored, NFD(viet), "a"), false); assert.equal(M.codeInUse(stored, "M-2"), false);
  for (const [x, y] of [["B01", "b01"], ["B01", " B01 "], [NFC(viet), NFD(viet)], [fullWidth, "B01"]]) {
    const r = M.validateTree([n("p", { code: x }), n("q", { code: y, order: 1 })], { organizationId: "orgA" });
    assert.deepEqual(r.issues.map((i) => i.code), ["DUPLICATE_CODE"], JSON.stringify([x, y]));
    assert.deepEqual(r.issues[0], { code: "DUPLICATE_CODE", nodeId: "q", message: r.issues[0].message }); assert.ok(r.issues[0].message.includes("node p"));
  }
  assert.equal(M.validateTree([n("p", { code: "B01" }), n("q", { code: "B02", order: 1 }), n("r", { code: null, order: 2 }), n("s", { code: null, order: 3 })], { organizationId: "orgA" }).valid, true);
  assert.equal(M.normalizeNodeCode("  b01 "), "b01"); assert.equal(M.normalizeNodeCode(NFD(viet)), NFD(viet));   // display/stored code: trim only (no upper-casing, no normalization)
});

test("activationReadiness: draft + writable organization + valid tree + at least one active subject + complete clone", () => {
  const org = { id: "orgA", status: "active" };
  const fw = { id: "f", organizationId: "orgA", status: "draft" };
  const s = n("s"), l = child("l", s);
  const ready = M.activationReadiness(fw, [s, l], { organization: org });
  assert.equal(ready.ready, true); assert.deepEqual(ready.errors, []);
  const errs = (framework, nodes, opts) => M.activationReadiness(framework, nodes, opts).errors.map((e) => e.code);
  assert.ok(errs(fw, [], { organization: org }).includes("NO_ACTIVE_SUBJECT"));
  assert.ok(errs(fw, [n("s", { status: "retired" })], { organization: org }).includes("NO_ACTIVE_SUBJECT"));
  assert.ok(errs(fw, [n("u", { kind: "unit" })], { organization: org }).includes("NO_ACTIVE_SUBJECT"));
  assert.ok(errs({ ...fw, status: "active" }, [s]).includes("NOT_DRAFT")); assert.ok(errs({ ...fw, status: "archived" }, [s]).includes("NOT_DRAFT"));
  assert.ok(errs(fw, [s], { organization: { id: "orgA", status: "archived" } }).includes("ORGANIZATION_READ_ONLY"));
  assert.ok(errs(fw, [s, n("s", { order: 1 })]).includes("TREE_DUPLICATE_ID"));
  assert.ok(errs(fw, [s, child("x", s, { ancestors: ["q", "s"] })]).some((c) => c.startsWith("TREE_")));
  assert.ok(errs(fw, [n("s", { organizationId: "orgB" })]).includes("TREE_ORGANIZATION_MISMATCH"));
  const clone = { ...fw, cloneSource: { frameworkId: "src", nodeCount: 3 } };
  assert.ok(errs(clone, [s, l]).includes("INCOMPLETE_CLONE")); assert.equal(M.activationReadiness(clone, [s, l, child("l2", s, { order: 1 })]).ready, true);
  assert.equal(M.activationReadiness(null, [s]).ready, false);
});

test("sortFrameworksForList: status group (active, draft, archived) then newest first then id; supports Timestamp-like values; does not mutate", () => {
  const ts = (s) => ({ seconds: s, nanoseconds: 0 });
  const list = [{ id: "d1", status: "draft", createdAt: ts(5) }, { id: "a1", status: "active", createdAt: ts(1) }, { id: "a2", status: "active", createdAt: ts(9) }, { id: "z", status: "archived", createdAt: ts(99) }, { id: "d0", status: "draft", createdAt: { toMillis: () => 7000 } }, { id: "a3", status: "active", createdAt: ts(9) }];
  const copy = list.slice();
  assert.deepEqual(M.sortFrameworksForList(list).map((x) => x.id), ["a2", "a3", "a1", "d0", "d1", "z"]);
  assert.deepEqual(list, copy);
  assert.deepEqual(M.sortFrameworksForList(list, ["draft", "active", "archived"]).map((x) => x.id), ["d0", "d1", "a2", "a3", "a1", "z"]);
  assert.equal(M.millisOf(new Date(5)), 5); assert.equal(M.millisOf(7), 7); assert.equal(M.millisOf(null), 0); assert.equal(M.millisOf({}), 0);
  assert.deepEqual(M.sortFrameworksForList(undefined), []);
});
