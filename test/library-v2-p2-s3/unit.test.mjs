// Library V2 P2-S3 - pure unit tests for the Platform Admin organization screen helpers (no DOM, no emulator).
import test from "node:test";
import assert from "node:assert/strict";
import {
  organizationStatusView, slugifyOrganizationCode, normalizeOrganizationCode, findDuplicateCodes, validateCreateInput,
  renderOrganizationListHtml, renderOrganizationDetailHtml, renderCreateOrganizationFormHtml, renderLifecycleConfirmHtml, createOrganizationWriter, ORGANIZATION_LIST_LIMIT
} from "../../organization-admin-view.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (v) => (v ? "10/02/2026" : "—");

test("status labels are Vietnamese-first and distinct", () => {
  assert.equal(organizationStatusView("active").label, "Đang hoạt động");
  assert.equal(organizationStatusView("archived").label, "Đã lưu trữ");
  assert.notEqual(organizationStatusView("active").badge, organizationStatusView("archived").badge);
  assert.equal(organizationStatusView("weird").label, "Không xác định");
});

test("slug: Vietnamese diacritics removed, hyphenated, bounded to 40, never ends with a hyphen", () => {
  assert.equal(slugifyOrganizationCode("Đại học Kinh tế – Khoa Quản trị!"), "dai-hoc-kinh-te-khoa-quan-tri");
  assert.equal(slugifyOrganizationCode("  Ê  "), "e");
  assert.equal(slugifyOrganizationCode("???"), "");
  assert.equal(slugifyOrganizationCode(null), "");
  const long = slugifyOrganizationCode("Tên rất dài ".repeat(10));
  assert.ok(long.length <= 40 && !long.endsWith("-") && !long.startsWith("-"));
  assert.equal(normalizeOrganizationCode("  AbC-1 "), "abc-1");
});

test("duplicate code detection: exact (case-insensitive) match across active AND archived organizations", () => {
  const list = [{ id: "a", name: "Đơn vị A", code: "don-vi-a", status: "active" }, { id: "b", name: "Đơn vị B", code: "don-vi-b", status: "archived" }];
  assert.deepEqual(findDuplicateCodes(list), []);
  const dup = findDuplicateCodes([...list, { id: "c", name: "Trùng", code: "DON-VI-A", status: "active" }]);
  assert.equal(dup.length, 1); assert.equal(dup[0].code, "don-vi-a"); assert.deepEqual(dup[0].organizations.map((o) => o.id), ["a", "c"]);
  assert.deepEqual(findDuplicateCodes(null), []);
  const ok = validateCreateInput({ name: "Đơn vị mới", code: "don-vi-moi" }, list);
  assert.deepEqual([ok.ok, ok.name, ok.code], [true, "Đơn vị mới", "don-vi-moi"]);
  const clash = validateCreateInput({ name: "Khác", code: "  DON-VI-A " }, list);
  assert.equal(clash.ok, false); assert.match(clash.fieldErrors.code, /đã được dùng bởi đơn vị “Đơn vị A”/);
  const clashArchived = validateCreateInput({ name: "Khác", code: "don-vi-b" }, list);
  assert.match(clashArchived.fieldErrors.code, /\(đã lưu trữ\)/);
});

test("create validation mirrors the contract: name 3-120, code pattern; Vietnamese messages", () => {
  assert.deepEqual(Object.keys(validateCreateInput({ name: "ab", code: "ok-code" }).fieldErrors), ["name"]);
  assert.deepEqual(Object.keys(validateCreateInput({ name: "x".repeat(121), code: "ok-code" }).fieldErrors), ["name"]);
  for (const code of ["", "ab", "-abc", "abc-", "a b c", "a_b", "mã-việt", "x".repeat(41)]) assert.ok(validateCreateInput({ name: "Hợp lệ", code }).fieldErrors.code, code);
  assert.match(validateCreateInput({ name: "", code: "" }).fieldErrors.name, /Tên đơn vị cần từ 3 đến 120/);
  assert.equal(validateCreateInput().ok, false);
  assert.equal(validateCreateInput({ name: "  Có khoảng trắng  ", code: "abc" }).name, "Có khoảng trắng");
});

test("list markup: empty state, rows with status badge, bounded-list note, duplicate-code warning; every dynamic value escaped", () => {
  const empty = renderOrganizationListHtml({ organizations: [], esc, fmtDate });
  assert.ok(empty.includes("Chưa có đơn vị nào") && empty.includes("id=\"orgCreateBtn\"") && !empty.includes("<table"));
  const orgs = [{ id: "o1", name: "<img src=x onerror=1> & Đơn vị", code: "ma", status: "active", createdAt: 1 }, { id: "o2", name: "Cũ", code: "cu", status: "archived", createdAt: 1 }];
  const html = renderOrganizationListHtml({ organizations: orgs, esc, fmtDate });
  assert.ok(!html.includes("<img") && html.includes("&lt;img") && html.includes("&amp;"));
  assert.ok(html.includes("Đang hoạt động") && html.includes("Đã lưu trữ") && html.includes("data-org-open=\"o1\"") && html.includes("data-org-open=\"o2\""));
  assert.ok(!html.includes("o1</td>"), "internal ids are not displayed in the list");
  assert.ok(!html.includes("Chỉ hiển thị tối đa"));
  assert.ok(renderOrganizationListHtml({ organizations: orgs, esc, fmtDate, truncated: true }).includes("Chỉ hiển thị tối đa " + ORGANIZATION_LIST_LIMIT));
  const warned = renderOrganizationListHtml({ organizations: orgs, esc, fmtDate, duplicates: [{ code: "ma", organizations: orgs }] });
  assert.ok(warned.includes("Có đơn vị trùng mã") && warned.includes("role=\"alert\""));
});

test("detail markup: active shows archive action and rename form; archived shows banner + restore and disables rename; internal id only under diagnostics", () => {
  const active = renderOrganizationDetailHtml({ organization: { id: "ID123", name: "Đơn vị", code: "don-vi", status: "active", createdAt: 1 }, esc, fmtDate });
  assert.ok(active.includes("id=\"orgArchiveBtn\"") && active.includes("LƯU TRỮ ĐƠN VỊ") && active.includes("id=\"orgRenameForm\"") && !active.includes("orgRestoreBtn") && !active.includes("orgArchivedBanner"));
  assert.ok(active.includes("Mã không thể đổi") && active.includes("Đang hoạt động"));
  assert.ok(active.includes("dừng mọi hoạt động mới"));
  const archived = renderOrganizationDetailHtml({ organization: { id: "ID123", name: "Đơn vị", code: "don-vi", status: "archived", createdAt: 1, archivedAt: 1 }, esc, fmtDate });
  assert.ok(archived.includes("orgArchivedBanner") && archived.includes("KHÔI PHỤC ĐƠN VỊ") && archived.includes("Đã lưu trữ") && archived.includes("Lưu trữ lúc"));
  assert.ok(archived.includes("id=\"orgRenameInput\"") && /id="orgRenameInput"[^>]*disabled/.test(archived) && !archived.includes("orgRenameForm") && archived.includes("Khôi phục đơn vị để đổi tên."));
  for (const html of [active, archived]) {
    const outside = html.replace(/<details[\s\S]*?<\/details>/, "");
    assert.ok(!outside.includes("ID123"), "internal id appears only inside the diagnostics block");
    assert.ok(html.includes("<details") && html.includes("ID123"));
  }
});

test("confirmation dialogs state the consequences clearly", () => {
  const archive = renderLifecycleConfirmHtml({ kind: "archive", organization: { name: "Đơn vị" }, esc });
  assert.ok(archive.includes("Lưu trữ đơn vị?") && archive.includes("dừng mọi hoạt động mới") && archive.includes("giữ nguyên") && archive.includes("khôi phục bất cứ lúc nào") && archive.includes("btn-danger") && archive.includes("id=\"orgConfirmCancel\""));
  const restore = renderLifecycleConfirmHtml({ kind: "restore", organization: { name: "Đơn vị" }, esc });
  assert.ok(restore.includes("Khôi phục đơn vị?") && restore.includes("hoạt động trở lại") && restore.includes("btn-ok"));
  assert.ok(renderCreateOrganizationFormHtml({ esc }).includes("không thể đổi"));
});

test("writer is a thin transport for payloads built elsewhere", async () => {
  const calls = [];
  const w = createOrganizationWriter({
    collection: (db, name) => ({ col: name }),
    doc: (a, b, c) => (c === undefined ? { id: "AUTO", col: a.col } : { path: b + "/" + c }),
    setDoc: async (ref, data) => calls.push(["set", ref.path, data]),
    updateDoc: async (ref, data) => calls.push(["update", ref.path, data])
  });
  assert.equal(w.newId({}), "AUTO");
  await w.create({}, "o1", { a: 1 }); await w.update({}, "o1", { b: 2 });
  assert.deepEqual(calls, [["set", "organizations/o1", { a: 1 }], ["update", "organizations/o1", { b: 2 }]]);
  assert.ok(Object.isFrozen(w));
});
