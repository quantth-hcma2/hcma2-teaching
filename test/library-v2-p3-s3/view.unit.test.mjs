// LIBRARY V2 P3-S3 - curriculum-admin-view.mjs pure helpers and markup (no DOM, no Firestore). The controller state machine is covered by controller.e2e.mjs
// (fake Firestore in a real browser) and integration.e2e.mjs (real index.html + emulators + deployed Rules).
import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../../curriculum-model.mjs";
import { createCurriculumViewHelpers, createCurriculumWriter } from "../../curriculum-admin-view.mjs";

const H = createCurriculumViewHelpers({ model });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ts) => (ts && ts.seconds ? "d" + ts.seconds : "—");
const org = (status = "active") => ({ id: "orgA", name: "Khoa", status });
const ts = (s) => ({ seconds: s, nanoseconds: 0 });
const fw = (id, status, extra = {}) => ({ id, organizationId: "orgA", name: "Khung " + id, status, createdAt: ts(10), updatedAt: ts(10), ...(status === "draft" ? {} : { activatedAt: ts(20) }), ...extra });
const render = (over = {}) => H.renderSectionHtml({ phase: "ready", organization: org(), items: [], truncated: false, canOpen: false, esc, fmtDate, ...over });
const tags = (html, re) => (html.match(re) || []).length;

test("factory requires the curriculum-model module; the helper object is frozen", () => {
  assert.throws(() => createCurriculumViewHelpers(), TypeError); assert.throws(() => createCurriculumViewHelpers({ model: {} }), TypeError);
  assert.ok(Object.isFrozen(H));
});
test("status view: Vietnamese labels with diacritics, icon + text + badge class (never colour alone); unknown status is safe", () => {
  assert.deepEqual({ ...H.frameworkStatusView("draft") }, { label: "Bản nháp", badge: "badge-yellow", icon: "📝" });
  assert.deepEqual({ ...H.frameworkStatusView("active") }, { label: "Đang áp dụng", badge: "badge-green", icon: "🟢" });
  assert.deepEqual({ ...H.frameworkStatusView("archived") }, { label: "Đã lưu trữ", badge: "badge-gray", icon: "📦" });
  assert.equal(H.frameworkStatusView("weird").label, "Không xác định");
});
test("grouping keeps the P3-S2 order active -> draft -> archived and the incoming (newest-first) order inside a group; empty groups vanish; unknown statuses are not dropped", () => {
  const items = [fw("a1", "active"), fw("a2", "active"), fw("d1", "draft"), fw("z1", "archived"), fw("q", "mystery")];
  const groups = H.groupFrameworksByStatus(items);
  assert.deepEqual(groups.map((g) => g.status), ["active", "draft", "archived", "unknown"]);
  assert.deepEqual(groups[0].items.map((x) => x.id), ["a1", "a2"]); assert.deepEqual(groups[3].items.map((x) => x.id), ["q"]);
  assert.deepEqual(H.groupFrameworksByStatus([fw("d", "draft")]).map((g) => g.status), ["draft"]);
  assert.deepEqual(H.groupFrameworksByStatus([]), []); assert.deepEqual(H.groupFrameworksByStatus(undefined), []);
});
test("ordering contract end to end: the model sort + grouping give active -> draft -> archived, newest first, with no server ordering", () => {
  const raw = [fw("z-old", "archived"), fw("d-new", "draft", { createdAt: ts(50) }), fw("a-old", "active", { createdAt: ts(5) }), fw("a-new", "active", { createdAt: ts(90) }), fw("d-old", "draft", { createdAt: ts(1) })];
  const sorted = model.sortFrameworksForList(raw);
  assert.deepEqual(H.groupFrameworksByStatus(sorted).flatMap((g) => g.items.map((x) => x.id)), ["a-new", "a-old", "d-new", "d-old", "z-old"]);
});
test("summary and truncation copy: counts per status; truncation says the FIRST 100 (the query has no server ordering), never 'mới nhất'", () => {
  assert.equal(H.summarizeFrameworks([fw("a", "active"), fw("d", "draft"), fw("z", "archived")], false), "3 khung · 1 đang áp dụng · 1 bản nháp · 1 đã lưu trữ");
  assert.equal(H.summarizeFrameworks([fw("d", "draft")], false), "1 khung · 1 bản nháp");
  assert.equal(H.summarizeFrameworks([fw("d", "draft")], true), "Ít nhất 1 khung · 1 bản nháp");
  const note = H.truncationNote();
  assert.ok(note.includes("100 khung đầu tiên")); assert.ok(!/mới nhất/i.test(note)); assert.ok(note.includes("còn nhiều khung hơn"));
  assert.ok(/100 khung đầu tiên/.test(render({ items: [fw("d", "draft")], truncated: true }))); assert.ok(!/mới nhất/i.test(render({ items: [fw("d", "draft")], truncated: true })));
  assert.equal(tags(render({ items: [fw("d", "draft")], truncated: false }), /orgCurriculumTruncated/g), 0);
});

test("controls matrix (P3 mini-spec section 5): every framework status x organization status, with and without the Open hook; archived organization = nothing mutable", () => {
  // P3-S5 aligned: without cloneTools the clone / deleteDraft controls are always false (asserted here); with them they are covered by test/library-v2-p3-s5
  const C = (status, orgStatus, canOpen) => { const c = { ...H.controlsFor(fw("f", status), org(orgStatus), { canOpen }) }; assert.deepEqual([c.clone, c.deleteDraft], [false, false]); delete c.clone; delete c.deleteDraft; return c; };
  assert.deepEqual(C("draft", "active", true), { open: true, openReadOnly: false, rename: true, activate: true, archive: false, restore: false });
  assert.deepEqual(C("active", "active", true), { open: true, openReadOnly: false, rename: true, activate: false, archive: true, restore: false });
  assert.deepEqual(C("archived", "active", true), { open: true, openReadOnly: true, rename: false, activate: false, archive: false, restore: true });
  for (const status of ["draft", "active", "archived"]) assert.deepEqual(C(status, "archived", true), { open: true, openReadOnly: true, rename: false, activate: false, archive: false, restore: false }, status + " in an archived organization");
  for (const status of ["draft", "active", "archived"]) for (const o of ["active", "archived"]) assert.equal(C(status, o, false).open, false, "no Open control without the hook");
  assert.equal(H.controlsFor(fw("f", "draft", { organizationId: "orgB" }), org(), {}).rename, false);   // framework of another organization is never offered mutations
});
test("create is disabled with a reason only when the organization is not active", () => {
  assert.equal(H.createDisabledReason(org("active")), null);
  assert.ok(H.createDisabledReason(org("archived")).includes("Đơn vị đã lưu trữ")); assert.ok(H.createDisabledReason(null).includes("Đơn vị đã lưu trữ"));
});

test("stale detection: missing, status change, updatedAt change (only when asked); equal framework is unchanged", () => {
  const loaded = fw("f", "draft", { updatedAt: ts(10) });
  assert.deepEqual({ ...H.frameworkChangedSince(loaded, null) }, { changed: true, reason: "missing" });
  assert.deepEqual({ ...H.frameworkChangedSince(loaded, { ...loaded, status: "active" }) }, { changed: true, reason: "status" });
  assert.deepEqual({ ...H.frameworkChangedSince(loaded, { ...loaded, updatedAt: ts(11) }) }, { changed: false, reason: null });
  assert.deepEqual({ ...H.frameworkChangedSince(loaded, { ...loaded, updatedAt: ts(11) }, { compareUpdatedAt: true }) }, { changed: true, reason: "updatedAt" });
  assert.deepEqual({ ...H.frameworkChangedSince(loaded, { ...loaded, updatedAt: { toMillis: () => 10000 } }, { compareUpdatedAt: true }) }, { changed: false, reason: null });
  assert.equal(H.frameworkChangedSince(loaded, { ...loaded }).changed, false);
});

test("contract errors are recognised by NAME and CODE (a foreign module instance's class still works); unrelated errors are not claimed", () => {
  const foreign = (code) => Object.assign(new Error("x"), { name: "CurriculumContractError", code });
  assert.equal(H.describeContractError(foreign("NAME")).kind, "validation"); assert.equal(H.describeContractError(foreign("NAME")).message, "Tên khung cần từ 3 đến 120 ký tự.");
  assert.equal(H.describeContractError(foreign("ORGANIZATION_ARCHIVED")).kind, "orgArchived");
  for (const code of ["FRAMEWORK_READ_ONLY", "TRANSITION", "ORGANIZATION_MISMATCH"]) assert.equal(H.describeContractError(foreign(code)).kind, "stale", code);
  assert.equal(H.describeContractError(foreign("NOT_READY")).kind, "notReady"); assert.equal(H.describeContractError(foreign("WHATEVER")).kind, "unknown");
  assert.equal(H.describeContractError(new Error("x")), null); assert.equal(H.describeContractError(null), null); assert.equal(H.describeContractError(Object.assign(new Error("x"), { code: "permission-denied" })), null);
  try { model.validateFrameworkName("ab"); assert.fail(); } catch (e) { assert.equal(H.describeContractError(e).kind, "validation"); }
});
test("Firebase error classification: permission-denied and not-found are NEVER merged; transport problems are 'unknown outcome'", () => {
  const c = (code, opts) => H.classifyFirebaseError({ code }, opts);
  assert.equal(c("permission-denied"), "permission-denied"); assert.equal(c("firestore/permission-denied"), "permission-denied"); assert.equal(c("not-found"), "not-found");
  for (const code of ["unavailable", "deadline-exceeded", "cancelled", "aborted", "network-request-failed", "internal", "unknown"]) assert.equal(c(code), "unknown-outcome", code);
  assert.equal(c("invalid-argument"), "other"); assert.equal(c("permission-denied", { online: false }), "permission-denied"); assert.equal(c("invalid-argument", { online: false }), "unknown-outcome");
  assert.equal(H.classifyFirebaseError(new TypeError("fetch failed")), "unknown-outcome"); assert.equal(H.classifyFirebaseError(null), "other");
  assert.notEqual(H.MESSAGES.permissionRead, H.MESSAGES.missing); assert.ok(!/không tìm thấy/i.test(H.MESSAGES.permissionRead)); assert.ok(!/không tìm thấy/i.test(H.MESSAGES.permissionWrite));
});

test("readiness reasons: real P3-S2 readiness results become deduplicated Vietnamese reasons; unknown codes still render; nothing is auto-fixed", () => {
  const f = fw("f", "draft"), o = org();
  const n = (id, extra = {}) => ({ id, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "N" + id, status: "active", ...extra });
  const texts = (nodes, framework = f, opts = { organization: o }) => H.describeReadiness(model.activationReadiness(framework, nodes, opts)).map((r) => r.text);
  assert.deepEqual(texts([]), ["Cần ít nhất một Môn đang hoạt động."]);
  assert.ok(texts([n("a", { status: "retired" })]).includes("Cần ít nhất một Môn đang hoạt động."));
  assert.ok(texts([n("a"), n("b")]).some((t) => t.startsWith("Có hai nút cùng thứ tự")));
  const dup = H.describeReadiness(model.activationReadiness(f, [n("a"), n("b"), n("c")], { organization: o })).find((r) => r.code === "TREE_DUPLICATE_ORDER"); assert.equal(dup.count, 2);
  assert.ok(texts([n("a", { code: "B1" }), n("b", { code: " b1 ", order: 1 })]).includes("Có mã bị trùng trong khung."));
  assert.ok(texts([n("a")], { ...f, status: "active" }).includes("Chỉ khung ở trạng thái Bản nháp mới kích hoạt được."));
  assert.ok(texts([n("a")], f, { organization: org("archived") }).includes("Đơn vị đã được lưu trữ. Không thể thay đổi chương trình."));
  assert.ok(texts([n("a")], { ...f, cloneSource: { frameworkId: "s", nodeCount: 3 } }).includes("Bản sao chưa đầy đủ."));
  assert.ok(texts([n("a", { parentId: "ghost", ancestors: ["ghost"] })]).includes("Có nút mồ côi (không tìm thấy nút cha)."));
  assert.deepEqual(H.describeReadiness({ errors: [{ code: "TREE_NEW_THING" }, { code: "OTHER" }] }).map((r) => r.text), ["Có nút có dữ liệu không hợp lệ (new_thing).", "Chưa đủ điều kiện (OTHER)."]);
  assert.deepEqual(H.describeReadiness(model.activationReadiness(f, [n("a")], { organization: o })), []); assert.deepEqual(H.describeReadiness(null), []);
});

test("section markup states: loading, error (with retry), empty, populated; accessible landmark; no table; the create control sits in every variant", () => {
  const loading = render({ phase: "loading" });
  assert.ok(loading.includes('aria-busy="true"') && loading.includes("orgCurriculumLoading") && loading.includes('role="status"') && loading.includes("orgFwCreateBtn"));
  const error = render({ phase: "error", errorMessage: "Lỗi <b>x</b>" });
  assert.ok(error.includes('role="alert"') && error.includes("THỬ LẠI") && error.includes("Lỗi &lt;b&gt;x&lt;/b&gt;") && error.includes('aria-busy="false"'));
  const empty = render();
  assert.ok(empty.includes("Chưa có khung chương trình") && empty.includes("orgCurriculumEmpty") && empty.includes("Tạo khung đầu tiên")); assert.ok(!empty.includes("orgCurriculumSummary"));
  const populated = render({ items: [fw("a1", "active"), fw("d1", "draft")] });
  assert.ok(populated.includes('aria-labelledby="orgCurriculumTitle"') && populated.includes('id="orgCurriculumTitle"') && populated.includes('aria-live="polite"') && populated.includes("orgCurriculumSummary"));
  assert.equal(tags(populated, /<table/g), 0); assert.equal(tags(populated, /<ul /g), 2); assert.equal(tags(populated, /<li data-fw-row/g), 2);
  assert.ok(populated.indexOf('data-fw-group="active"') < populated.indexOf('data-fw-group="draft"'));
  for (const html of [loading, error, empty, populated]) { assert.ok(html.includes("+ Tạo khung chương trình")); assert.ok(html.includes("<section")); }
  assert.ok(populated.includes("Đang áp dụng <span") && populated.includes("Bản nháp <span"));
});
test("rows: name, status badge (icon aria-hidden + text), created and first-activation dates, clone chip only when cloneSource exists, id only in data attributes", () => {
  const html = render({ items: [fw("a1", "active", { cloneSource: { frameworkId: "s", nodeCount: 1 } }), fw("d1", "draft")] });
  assert.ok(html.includes("Tạo d10") && html.includes("Kích hoạt d20")); assert.ok(html.includes('data-fw-clone="1"')); assert.equal(tags(html, /data-fw-clone/g), 1);
  assert.equal(tags(html, /aria-hidden="true"/g), 2); assert.ok(html.includes('data-fw-status="active"') && html.includes('data-fw-status="draft"'));
  const draftRow = H.renderRowHtml({ framework: fw("d1", "draft"), organization: org(), controls: H.controlsFor(fw("d1", "draft"), org()), esc, fmtDate });
  assert.ok(!draftRow.includes("Kích hoạt d")); assert.ok(!draftRow.includes("Bản sao"));
});
test("row actions per status (active organization, Open hook absent): draft = Đổi tên + Kích hoạt; active = Đổi tên + Lưu trữ; archived = Khôi phục; NO Open and NO delete without the hook", () => {
  const actions = (status) => [...render({ items: [fw("f", status)] }).matchAll(/data-fw-action="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(actions("draft"), ["rename", "activate"]); assert.deepEqual(actions("active"), ["rename", "archive"]); assert.deepEqual(actions("archived"), ["restore"]);
  for (const s of ["draft", "active", "archived"]) { assert.ok(!actions(s).includes("open")); assert.ok(!actions(s).includes("delete")); assert.ok(!render({ items: [fw("f", s)] }).includes("Sắp có")); }
  const withHook = (status, o) => [...render({ items: [fw("f", status)], organization: o, canOpen: true }).matchAll(/data-fw-action="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(withHook("draft", org()), ["open", "rename", "activate"]); assert.deepEqual(withHook("archived", org()), ["open", "restore"]);
  assert.ok(render({ items: [fw("f", "archived")], canOpen: true }).includes("MỞ (CHỈ XEM)")); assert.ok(render({ items: [fw("f", "draft")], canOpen: true }).includes(">MỞ<"));
});
test("archived organization: banner, create disabled with a VISIBLE reason (not only title), no row mutation controls, Open stays read-only when the hook exists", () => {
  const items = [fw("a", "active"), fw("d", "draft"), fw("z", "archived")];
  const html = render({ organization: org("archived"), items, canOpen: true });
  assert.ok(html.includes("orgCurriculumArchivedNote") && html.includes("Đơn vị đã lưu trữ.") && html.includes("Khôi phục đơn vị để chỉnh sửa."));
  assert.ok(/id="orgFwCreateBtn" disabled/.test(html)); assert.ok(html.includes('id="orgFwCreateHint"') && html.includes('aria-describedby="orgFwCreateHint"'));
  assert.deepEqual([...html.matchAll(/data-fw-action="([a-z]+)"/g)].map((m) => m[1]), ["open", "open", "open"]);
  for (const forbidden of ["rename", "activate", "archive", "restore"]) assert.ok(!html.includes('data-fw-action="' + forbidden + '"'), forbidden);
  assert.equal(tags(html, />MỞ \(CHỈ XEM\)</g), 3);
  const noHook = render({ organization: org("archived"), items });
  assert.ok(!/data-fw-action=/.test(noHook));
  assert.ok(render({ organization: org("archived") }).includes("Đơn vị đã lưu trữ: chưa có khung chương trình nào để xem."));
  const active = render({ items });
  assert.ok(!/id="orgFwCreateBtn" disabled/.test(active)); assert.ok(!active.includes("orgFwCreateHint")); assert.ok(!active.includes("orgCurriculumArchivedNote"));
});
test("hostile framework names are escaped everywhere (section, rows, dialogs, aria-labels)", () => {
  const evil = fw("<img src=x onerror=alert(1)>", "draft", { name: '"><script>alert(1)</script>' });
  const html = render({ items: [evil] });
  assert.ok(!/<script>/i.test(html) && !/<img src=x/i.test(html)); assert.ok(html.includes("&lt;script&gt;"));
  for (const dialog of [H.renderRenameFormHtml({ framework: evil, esc }), H.renderConfirmHtml({ kind: "archive", framework: evil, esc }), H.renderConfirmHtml({ kind: "restore", framework: evil, esc }), H.renderActivationHtml({ phase: "ready", framework: evil, esc, stats: { rootCount: 1, activeCount: 1, nodeCount: 1 } }), H.renderActivationHtml({ phase: "blocked", framework: evil, esc, reasons: [{ code: "<x>", text: "<b>t</b>", count: 2 }] })]) assert.ok(!/<script>|<img src=x|<b>t<\/b>/i.test(dialog));
});

test("dialogs: role=dialog, aria-modal, aria-labelledby pointing at the title; named fields with hints/errors wired by aria-describedby; Cancel on the left, action on the right", () => {
  const dialogs = { create: H.renderCreateFormHtml({ esc }), rename: H.renderRenameFormHtml({ framework: fw("f", "draft"), esc }), archive: H.renderConfirmHtml({ kind: "archive", framework: fw("f", "active"), esc }), restore: H.renderConfirmHtml({ kind: "restore", framework: fw("f", "archived"), esc }), checking: H.renderActivationHtml({ phase: "checking", framework: fw("f", "draft"), esc }), blocked: H.renderActivationHtml({ phase: "blocked", framework: fw("f", "draft"), esc, reasons: [] }), ready: H.renderActivationHtml({ phase: "ready", framework: fw("f", "draft"), esc, stats: { rootCount: 2, activeCount: 7, nodeCount: 8 } }) };
  for (const [name, html] of Object.entries(dialogs)) {
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"') && html.includes('aria-labelledby="orgFwDialogTitle"') && html.includes('id="orgFwDialogTitle"'), name);
    assert.ok(html.indexOf("orgFwCancel") > -1 && html.indexOf("orgFwCancel") < html.search(/orgFwSubmit|orgFwConfirm|orgFwChecking/) || name === "checking", name + ": cancel first");
  }
  assert.ok(dialogs.create.includes('<label for="orgFwName">') && dialogs.create.includes('aria-describedby="orgFwNameHint orgFwNameErr"') && dialogs.create.includes('maxlength="120"') && dialogs.create.includes("TẠO KHUNG"));
  assert.ok(dialogs.rename.includes('value="Khung f"') && dialogs.rename.includes("LƯU TÊN"));
  assert.ok(dialogs.archive.includes("Lưu trữ khung?") && dialogs.archive.includes("btn btn-danger") && dialogs.archive.includes("không sửa được"));
  assert.ok(dialogs.restore.includes("Khôi phục khung?") && dialogs.restore.includes("btn btn-ok") && dialogs.restore.includes("Đang áp dụng"));
  assert.ok(dialogs.checking.includes("Đang kiểm tra chương trình") && dialogs.checking.includes('aria-live="polite"'));
  assert.ok(dialogs.ready.includes("Cây chương trình: 7 nút đang hoạt động / 8 nút") && dialogs.ready.includes("không thể xóa") && dialogs.ready.includes("không thể trở lại bản nháp") && !dialogs.ready.includes("disabled"));
  assert.ok(dialogs.blocked.includes("Chưa thể kích hoạt.") && dialogs.blocked.includes("không tự sửa dữ liệu") && /id="orgFwConfirm" disabled/.test(dialogs.blocked));
  const withReasons = H.renderActivationHtml({ phase: "blocked", framework: fw("f", "draft"), esc, reasons: [{ code: "NO_ACTIVE_SUBJECT", text: "Cần ít nhất một Môn đang hoạt động.", count: 1 }, { code: "TREE_DUPLICATE_ORDER", text: "Có hai nút cùng thứ tự trong một cấp.", count: 3 }] });
  assert.ok(withReasons.includes('data-reason="NO_ACTIVE_SUBJECT"') && withReasons.includes("(×3)") && !withReasons.includes("(×1)"));
  assert.ok(H.renderActivationHtml({ phase: "blocked", framework: fw("f", "draft"), esc, message: H.MESSAGES.tooLarge }).includes("Khung quá lớn"));
});

test("writer is transport only: newId/create/update on the curriculumFrameworks collection; it never builds or alters a payload", async () => {
  const calls = [];
  const W = createCurriculumWriter({ collection: (db, name) => ({ name }), doc: (a, ...p) => (a && a.name ? { id: "NEW", path: [a.name] } : { id: p.at(-1), path: p }), setDoc: async (ref, data) => calls.push(["set", ref.path.join("/"), data]), updateDoc: async (ref, data) => calls.push(["update", ref.path.join("/"), data]) });
  assert.equal(W.newId({}), "NEW"); const payload = { any: "thing" };
  await W.create({}, "fw1", payload); await W.update({}, "fw1", payload);
  assert.deepEqual(calls, [["set", "curriculumFrameworks/fw1", payload], ["update", "curriculumFrameworks/fw1", payload]]); assert.strictEqual(calls[0][2], payload);
  assert.ok(Object.isFrozen(W));
});
