// LIBRARY V2 P3-S4 - pure editor layer (labels, controls matrix, tree presentation, stale comparators, error mapping, markup, transport). No DOM, no Firestore.
// Run: node --test test/library-v2-p3-s4/editor.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../../curriculum-model.mjs";
import { createCurriculumViewHelpers } from "../../curriculum-admin-view.mjs";
import { createCurriculumEditorHelpers, createCurriculumNodeWriter } from "../../curriculum-editor-view.mjs";

const viewHelpers = createCurriculumViewHelpers({ model });
const E = createCurriculumEditorHelpers({ model, viewHelpers });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ORG = (status = "active") => ({ id: "org1", name: "Đơn vị <b>A</b>", status });
const FW = (status = "draft", extra = {}) => ({ id: "fw1", organizationId: "org1", name: "Khung 2026", status, createdAt: { seconds: 1 }, ...extra });
let seq = 0;
const N = (id, parentId, ancestors, order, extra = {}) => ({ id, organizationId: "org1", kind: ancestors.length === 0 ? "subject" : ancestors.length === 1 ? "lesson" : "unit", parentId, ancestors, order, code: null, name: "Nút " + id, status: "active", updatedAt: { seconds: ++seq }, ...extra });
const TREE = () => [N("s1", null, [], 0), N("s2", null, [], 1), N("l1", "s1", ["s1"], 0), N("l2", "s1", ["s1"], 1, { status: "retired" }), N("l3", "s1", ["s1"], 2)];

test("labels and status views: Môn / Mục / Bài, retire is 'Ngừng sử dụng' (never a delete wording)", () => {
  assert.equal(E.kindLabel("subject"), "Môn"); assert.equal(E.kindLabel("unit"), "Mục"); assert.equal(E.kindLabel("lesson"), "Bài"); assert.equal(E.kindLabel("x"), "Nút");
  assert.equal(E.nodeStatusView("active").label, "Đang sử dụng"); assert.equal(E.nodeStatusView("retired").label, "Ngừng sử dụng"); assert.equal(E.nodeStatusView("zzz").label, "Không xác định");
  const all = JSON.stringify([E.MESSAGES, E.nodeStatusView("retired")]);
  assert.ok(!/[Xx]óa nút|Xóa Môn|Xóa Bài/.test(all));
});
test("editorMode: editable only for an active Organization AND a draft/active framework; reasons for the read-only cases (Organization wins)", () => {
  assert.deepEqual({ ...E.editorMode(FW("draft"), ORG()) }, { editable: true, readOnly: false, reason: null });
  assert.equal(E.editorMode(FW("active"), ORG()).editable, true);
  assert.deepEqual({ ...E.editorMode(FW("archived"), ORG()) }, { editable: false, readOnly: true, reason: "frameworkArchived" });
  assert.equal(E.editorMode(FW("draft"), ORG("archived")).reason, "organizationArchived");
  assert.equal(E.editorMode(FW("archived"), ORG("archived")).reason, "organizationArchived");
  assert.equal(E.editorMode(FW("draft", { organizationId: "other" }), ORG()).editable, false);
});
test("nodeControls matrix: node status x depth x mode x position", () => {
  const subject = N("s", null, [], 0), lesson = N("l", "s", ["s"], 0), unit = N("u", "l", ["s", "l"], 0), deep = N("d", "u", ["s", "l", "u"], 0);
  const on = (node, ctx = {}) => E.nodeControls(node, { editable: true, siblingIndex: 1, siblingCount: 3, ...ctx });
  const c = on(subject); assert.deepEqual([c.edit, c.retire, c.restore, c.addChild, c.addChildKind, c.reorder, c.upDisabled, c.downDisabled], [true, true, false, true, "lesson", true, false, false]);
  assert.equal(on(lesson).addChild, false); assert.equal(on(lesson).addChildKind, null, "a Bài never gets a child offer");
  for (const node of [unit, deep]) { const x = on(node); assert.equal(x.addChild, false); assert.equal(x.edit, true); assert.equal(x.retire, true); assert.equal(x.reorder, true); }
  const retired = on({ ...subject, status: "retired" });
  assert.deepEqual([retired.edit, retired.retire, retired.restore, retired.addChild], [true, false, true, false]);
  assert.match(retired.addChildBlocked, /Khôi phục Môn/);
  assert.equal(on({ ...lesson, status: "retired" }).addChildBlocked, null);
  assert.equal(on(subject, { siblingIndex: 0 }).upDisabled, true); assert.equal(on(subject, { siblingIndex: 2 }).downDisabled, true); assert.equal(on(subject, { siblingCount: 1, siblingIndex: 0 }).downDisabled, true);
  const hidden = on(subject, { siblingsHidden: true }); assert.equal(hidden.upDisabled, true); assert.equal(hidden.downDisabled, true); assert.ok(hidden.reorderHint);
  for (const ctx of [{ editable: false }, undefined]) { const none = E.nodeControls(subject, ctx); assert.deepEqual([none.edit, none.retire, none.restore, none.addChild, none.reorder], [false, false, false, false, false]); }
  assert.equal(E.nodeControls(null, { editable: true }).edit, false);
});
test("presentTree: ordered rows, counts, child-of-retired notes, orphans reported, retired toggle never hides a live node", () => {
  const nodes = [...TREE(), N("o1", "ghost", ["ghost"], 0)];
  const p = E.presentTree(nodes);
  assert.deepEqual(p.rows.map((r) => r.node.id), ["s1", "s2"]);
  assert.deepEqual(p.rows[0].children.map((r) => r.node.id), ["l1", "l2", "l3"]);
  assert.deepEqual(p.orphans.map((n) => n.id), ["o1"]);
  assert.equal(p.rows[0].childCount, 3); assert.equal(p.rows[0].retiredChildCount, 1);
  assert.deepEqual(p.rows[0].children.map((r) => [r.siblingIndex, r.siblingCount]), [[0, 3], [1, 3], [2, 3]]);
  assert.deepEqual(p.expandable, ["s1"]);
  assert.deepEqual({ ...p.stats }, { total: 6, subjects: 2, units: 0, lessons: 3, retired: 1 });
  const hide = E.presentTree(nodes, { showRetired: false });
  assert.deepEqual(hide.rows[0].children.map((r) => r.node.id), ["l1", "l3"]); assert.equal(hide.hiddenCount, 1);
  assert.equal(hide.rows[0].children.every((r) => r.siblingsHidden), true, "reordering is disabled while siblings are hidden");
  assert.equal(hide.rows[1].siblingsHidden, false);
  // retired parent with an ACTIVE child stays visible (dimmed) so no live node is hidden; the child carries the child-of-retired flag
  const tricky = [N("s", null, [], 0, { status: "retired" }), N("l", "s", ["s"], 0), N("l9", "s", ["s"], 1, { status: "retired" }), N("t", null, [], 1, { status: "retired" }), N("tl", "t", ["t"], 0, { status: "retired" })];
  const t = E.presentTree(tricky, { showRetired: false });
  assert.deepEqual(t.rows.map((r) => r.node.id), ["s"]); assert.deepEqual(t.rows[0].children.map((r) => r.node.id), ["l"]);
  assert.equal(t.rows[0].children[0].parentRetired, true); assert.equal(t.hiddenCount, 3);
  assert.deepEqual(E.presentTree([]).rows, []);
});
test("depth 3 and 4 nodes present generically (no hard-coded two levels)", () => {
  const nodes = [N("s", null, [], 0), N("l", "s", ["s"], 0), N("u", "l", ["s", "l"], 0), N("d", "u", ["s", "l", "u"], 0)];
  const p = E.presentTree(nodes);
  assert.deepEqual([p.rows[0].depth, p.rows[0].children[0].depth, p.rows[0].children[0].children[0].depth, p.rows[0].children[0].children[0].children[0].depth], [1, 2, 3, 4]);
  const html = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW(), mode: E.editorMode(FW(), ORG()), presentation: p, esc });
  assert.match(html, /data-node-depth="4"/); assert.match(html, /Mục/);
  assert.equal((html.match(/data-ed-action="add-child"/g) || []).length, 1, "only the Môn offers + Thêm Bài");
});
test("summary text and default collapse threshold", () => {
  assert.equal(E.summaryText(E.summarizeNodes(TREE())), "2 Môn · 2 Bài · 1 ngừng sử dụng");
  assert.equal(E.summaryText(E.summarizeNodes([])), "0 Môn · 0 Bài");
  assert.equal(E.defaultCollapsed(new Array(61).fill(0), ["a"]).size, 1); assert.equal(E.defaultCollapsed(new Array(60).fill(0), ["a"]).size, 0);
});
test("stale comparators: node (missing/status/updatedAt) and siblings (ids + orders)", () => {
  const loaded = N("a", null, [], 0, { updatedAt: { seconds: 5 } });
  assert.deepEqual({ ...E.nodeChangedSince(loaded, null) }, { changed: true, reason: "missing" });
  assert.deepEqual({ ...E.nodeChangedSince(loaded, { ...loaded }) }, { changed: false, reason: null });
  assert.equal(E.nodeChangedSince(loaded, { ...loaded, status: "retired" }).reason, "status");
  assert.equal(E.nodeChangedSince(loaded, { ...loaded, updatedAt: { seconds: 6 } }).reason, "updatedAt");
  const base = TREE();
  assert.equal(E.siblingsChangedSince(base, base.map((n) => ({ ...n })), "s1"), false);
  assert.equal(E.siblingsChangedSince(base, base.map((n) => (n.id === "l1" ? { ...n, order: 7 } : n)), "s1"), true);
  assert.equal(E.siblingsChangedSince(base, base.filter((n) => n.id !== "l3"), "s1"), true);
  assert.equal(E.siblingsChangedSince(base, base.map((n) => (n.id === "l1" ? { ...n, name: "đổi tên" } : n)), "s1"), false, "a rename does not change sibling order");
  assert.equal(E.siblingsChangedSince(base, [...base, N("s3", null, [], 2)], "s1"), false); assert.equal(E.siblingsChangedSince(base, [...base, N("s3", null, [], 2)], null), true);
});
test("error mapping: every contract code; duplicate-code message names the other node (retired flagged); not a contract error -> null", () => {
  const err = (code) => Object.assign(new Error(code), { name: "CurriculumContractError", code });
  const kinds = Object.fromEntries(["NAME", "CODE", "DUPLICATE_CODE", "ORGANIZATION_ARCHIVED", "FRAMEWORK_READ_ONLY", "ORGANIZATION_MISMATCH", "TRANSITION", "PARENT_NOT_FOUND", "NODE_NOT_FOUND", "DUPLICATE_ORDER", "DEPTH_EXCEEDED", "NODE_COUNT_EXCEEDED", "IMMUTABLE_FIELD"].map((c) => [c, E.describeNodeError(err(c))]));
  assert.deepEqual([kinds.NAME.kind, kinds.NAME.field, kinds.CODE.field, kinds.DUPLICATE_CODE.field], ["validation", "name", "code", "code"]);
  assert.deepEqual([kinds.ORGANIZATION_ARCHIVED.abort, kinds.FRAMEWORK_READ_ONLY.abort, kinds.ORGANIZATION_MISMATCH.abort, kinds.TRANSITION.abort, kinds.PARENT_NOT_FOUND.abort, kinds.NODE_NOT_FOUND.abort, kinds.DUPLICATE_ORDER.abort], ["orgArchived", "stale", "stale", "nodeStale", "parentGone", "nodeMissing", "siblingsChanged"]);
  assert.equal(kinds.DEPTH_EXCEEDED.kind, "message"); assert.equal(kinds.NODE_COUNT_EXCEEDED.kind, "message"); assert.match(kinds.IMMUTABLE_FIELD.message, /IMMUTABLE_FIELD/);
  assert.equal(E.describeNodeError(new Error("x")), null); assert.equal(E.describeNodeError(null), null);
  assert.match(E.duplicateCodeMessage("B01", { name: "Bài 1", status: "retired" }), /“B01”.*“Bài 1” \(đã ngừng sử dụng\)/);
  assert.doesNotMatch(E.duplicateCodeMessage("B01", { name: "Bài 1", status: "active" }), /ngừng sử dụng/);
  assert.equal(E.duplicateCodeMessage("B01", null), E.MESSAGES.duplicateCodeGeneric);
});
test("markup: nested lists (no table), ARIA, labelled buttons, escaping, mode banners and states", () => {
  const mode = E.editorMode(FW(), ORG());
  const nodes = [N("s1", null, [], 0, { name: "<img src=x onerror=alert(1)>", code: "A&B" }), N("l1", "s1", ["s1"], 0, { status: "retired", name: "Bài \"x\"" })];
  const html = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW(), mode, presentation: E.presentTree(nodes), readiness: model.activationReadiness(FW(), nodes, { organization: ORG() }), esc });
  assert.ok(!html.includes("<table") && !html.includes("role=\"tree\"")); assert.ok(html.includes("<ul") && html.includes("<li "));
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x")); assert.ok(html.includes("A&amp;B")); assert.ok(html.includes("Đơn vị &lt;b&gt;A&lt;/b&gt;"));
  for (const label of ["Sửa: ", "Chuyển lên: ", "Chuyển xuống: ", "Ngừng sử dụng: ", "Khôi phục: ", "Thêm Bài vào: "]) assert.ok(html.includes("aria-label=\"" + label) || html.includes("aria-label=\"" + esc(label)), label);
  assert.match(html, /aria-expanded="true" aria-controls="edKids-s1"/); assert.match(html, /id="edLive"[^>]*aria-live="polite"/); assert.match(html, /id="edTitle" tabindex="-1"/);
  assert.match(html, /id="edBack"[^>]*>← Quay lại đơn vị/); assert.match(html, /data-readiness="blocked"|data-readiness="ready"/);
  assert.ok(html.includes("aria-pressed=\"true\"") && html.includes("Ẩn nút ngừng sử dụng"));
  const ro = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW("archived"), mode: E.editorMode(FW("archived"), ORG()), presentation: E.presentTree(nodes), esc });
  for (const forbidden of ["data-ed-action=\"edit\"", "data-ed-action=\"up\"", "data-ed-action=\"retire\"", "data-ed-action=\"restore\"", "data-ed-action=\"add-child\"", "data-readiness"]) assert.ok(!ro.includes(forbidden), forbidden);
  assert.match(ro, /id="edModeBanner"/); assert.match(ro, /id="edAddSubject"[^>]*disabled/);
  const orgRo = E.renderEditorHtml({ phase: "ready", organization: ORG("archived"), framework: FW(), mode: E.editorMode(FW(), ORG("archived")), presentation: E.presentTree(nodes), esc });
  assert.match(orgRo, /Đơn vị đã lưu trữ/); assert.ok(!orgRo.includes("data-ed-action=\"edit\""));
  const empty = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW(), mode, presentation: E.presentTree([]), esc });
  assert.match(empty, /id="edEmpty"/); assert.match(empty, /id="edEmptyAdd"/);
  const allHidden = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW(), mode, presentation: E.presentTree([N("s", null, [], 0, { status: "retired" })], { showRetired: false }), showRetired: false, esc });
  assert.match(allHidden, /id="edAllHidden"/); assert.match(allHidden, /Đang ẩn 1 nút/);
  for (const [phase, id] of [["loading", "edLoading"], ["error", "edError"], ["notFound", "edNotFound"], ["tooLarge", "edTooLarge"]]) assert.match(E.renderEditorHtml({ phase, organization: ORG(), framework: FW(), mode, errorMessage: "m <x>", esc }), new RegExp("id=\"" + id + "\""));
  assert.match(E.renderEditorHtml({ phase: "error", organization: ORG(), framework: FW(), mode, errorMessage: "m <x>", esc }), /m &lt;x&gt;/);
  const orphan = E.renderEditorHtml({ phase: "ready", organization: ORG(), framework: FW(), mode, presentation: E.presentTree([...nodes, N("o", "ghost", ["ghost"], 0)]), esc });
  assert.match(orphan, /id="edOrphans"/); assert.match(orphan, /data-orphan="o"/);
});
test("readiness panel: draft ready / blocked (with reasons), active note, none for archived or read-only", () => {
  const mode = E.editorMode(FW(), ORG()), ok = [N("s", null, [], 0)];
  const base = (framework, nodesIn, m = mode, organization = ORG()) => E.renderEditorHtml({ phase: "ready", organization, framework, mode: m, presentation: E.presentTree(nodesIn), readiness: model.activationReadiness(framework, nodesIn, { organization }), esc });
  assert.match(base(FW(), ok), /data-readiness="ready"/); assert.match(base(FW(), ok), /1 Môn đang sử dụng · 1 nút/);
  const blocked = base(FW(), []); assert.match(blocked, /data-readiness="blocked"/); assert.match(blocked, /data-reason="NO_ACTIVE_SUBJECT"/); assert.match(blocked, /Cần ít nhất một Môn/);
  assert.match(base(FW("active"), ok), /data-readiness="active"/);
  assert.ok(!base(FW("archived"), ok, E.editorMode(FW("archived"), ORG())).includes("data-readiness"));
});
test("dialog markup: create (Môn / Bài, add-and-continue button), edit (prefilled, escaped), retire confirmation (not-a-delete copy, active-framework note)", () => {
  const parent = N("s1", null, [], 0, { name: "Toán <b>" });
  const subject = E.renderNodeFormHtml({ mode: "create", parent: null, kind: "subject", esc });
  assert.match(subject, /Thêm Môn/); assert.match(subject, /id="edSubmitMore"[^>]*>THÊM VÀ NHẬP TIẾP/); assert.match(subject, /role="dialog" aria-modal="true" aria-labelledby="edDialogTitle"/);
  assert.match(subject, /aria-describedby="edNameErr"/); assert.match(subject, /maxlength="200"/);
  const lesson = E.renderNodeFormHtml({ mode: "create", parent, kind: "lesson", esc });
  assert.match(lesson, /Thêm Bài vào Toán &lt;b&gt;/); assert.ok(!lesson.includes("Toán <b>"));
  const edit = E.renderNodeFormHtml({ mode: "edit", node: N("l", "s1", ["s1"], 0, { name: "A \"q\" <i>", code: "B&1" }), esc });
  assert.match(edit, /value="A &quot;q&quot; &lt;i&gt;"/); assert.match(edit, /value="B&amp;1"/); assert.ok(!edit.includes("edSubmitMore")); assert.match(edit, /id="edSubmit"[^>]*>LƯU/);
  const retire = E.renderRetireConfirmHtml({ node: parent, framework: FW("draft"), esc });
  assert.match(retire, /Ngừng sử dụng Môn\?/); assert.match(retire, /không phải là xóa/); assert.match(retire, /Các nút con giữ nguyên/); assert.match(retire, /id="edConfirm"/); assert.ok(!retire.includes("có hiệu lực ngay"));
  assert.match(E.renderRetireConfirmHtml({ node: parent, framework: FW("active"), esc }), /có hiệu lực ngay/);
});
test("createCurriculumNodeWriter is transport-only: node paths, one atomic batch, bounded", async () => {
  const log = [];
  const collection = (_db, ...path) => ({ path: path.join("/") });
  const doc = (a, ...path) => (path.length ? { path: path.join("/") } : { id: "auto-" + a.path, path: a.path + "/auto" });
  const batch = { update: (ref, data) => log.push(["batch.update", ref.path, data]), commit: async () => log.push(["commit"]) };
  const w = createCurriculumNodeWriter({ collection, doc, setDoc: async (ref, data) => log.push(["set", ref.path, data]), updateDoc: async (ref, data) => log.push(["update", ref.path, data]), writeBatch: () => batch, maxBatch: 3 });
  assert.equal(w.newId("db", "fw9"), "auto-curriculumFrameworks/fw9/nodes");
  await w.create("db", "fw9", "n1", { a: 1 }); await w.update("db", "fw9", "n1", { b: 2 });
  await w.updateMany("db", "fw9", [{ id: "n1", data: { order: 1 } }, { id: "n2", data: { order: 0 } }]);
  assert.deepEqual(log, [["set", "curriculumFrameworks/fw9/nodes/n1", { a: 1 }], ["update", "curriculumFrameworks/fw9/nodes/n1", { b: 2 }], ["batch.update", "curriculumFrameworks/fw9/nodes/n1", { order: 1 }], ["batch.update", "curriculumFrameworks/fw9/nodes/n2", { order: 0 }], ["commit"]]);
  await assert.rejects(() => w.updateMany("db", "fw9", []), TypeError); await assert.rejects(() => w.updateMany("db", "fw9", [1, 2, 3, 4].map((i) => ({ id: "n" + i, data: {} }))), TypeError);
  assert.throws(() => createCurriculumEditorHelpers({ model: {} , viewHelpers }), TypeError); assert.throws(() => createCurriculumEditorHelpers({ model, viewHelpers: {} }), TypeError);
});
