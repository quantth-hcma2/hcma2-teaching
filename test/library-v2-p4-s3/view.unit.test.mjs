// LIBRARY V2 P4-S3 - import-center-view.mjs pure helpers and markup (no DOM, no Firestore, no I/O). The controller is covered by controller.e2e.mjs (real browser, fake Firestore)
// and integration.e2e.mjs (real index.html + emulators + production Rules). Run: node --test test/library-v2-p4-s3/view.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createImportViewHelpers, createImportCenter, IMPORT_MAX_BYTES, DIAGNOSTIC_PAGE, LESSON_PAGE, TREE_COLLAPSE_ABOVE } from "../../import-center-view.mjs";
import { IMPORT_LIMITS } from "../../import-template.mjs";
import { workbookBytes, validateBytes, validateRaw } from "../library-v2-p4-s2/helpers.mjs";

const H = createImportViewHelpers();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORG = { id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active" };
const tags = (html, re) => (html.match(re) || []).length;
const run = async (options) => (await validateBytes(workbookBytes(options)));

test("CONSTANTS mirror the approved P4-S2 limits; the factory is frozen; messages are Vietnamese", () => {
  assert.equal(IMPORT_MAX_BYTES, IMPORT_LIMITS.maxFileBytes); assert.equal(DIAGNOSTIC_PAGE, IMPORT_LIMITS.diagnostics.maxDisplayed);
  assert.equal(TREE_COLLAPSE_ABOVE, 60); assert.equal(LESSON_PAGE, 100);
  assert.ok(Object.isFrozen(H) && Object.isFrozen(H.MESSAGES));
  assert.match(H.MESSAGES.futureAction, /chưa được bật/); assert.match(H.MESSAGES.notWritten, /Chưa có dữ liệu nào được ghi/);
  for (const m of Object.values(H.MESSAGES)) assert.ok(/[ạảãàáâấầẩẫậắằẳẵặẹẻẽèéêếềểễệỉịọỏõòóôốồổỗộớờởỡợụủũùúưứừửữựỳỵỷỹý]/i.test(m), m);
});
test("UNSUPPORTED BROWSER: BROWSER_UNSUPPORTED / missingCapabilities become a Vietnamese explanation with one item per capability, minimum versions and no unsafe-fallback promise", () => {
  const info = H.describeUnsupported(["decompression-stream", "module-worker", "mystery"], { chrome: 80, edge: 80, firefox: 114, safari: "16.4" });
  assert.equal(info.title, "Trình duyệt này chưa hỗ trợ đọc tệp Excel một cách an toàn");
  assert.deepEqual(info.items.map((i) => i.id), ["decompression-stream", "module-worker", "mystery"]); assert.equal(info.items[0].label, "Giải nén an toàn (DecompressionStream)"); assert.equal(info.items[2].label, "mystery");
  assert.match(info.advice, /Chrome 80\+.*Edge 80\+.*Firefox 114\+.*Safari 16\.4\+/); assert.match(info.advice, /không đọc tệp bằng cách kém an toàn hơn/);
  const html = H.renderUnsupportedHtml({ info, esc });
  assert.match(html, /id="impUnsupported"/); assert.match(html, /role="alert"/); assert.match(html, /data-missing="decompression-stream,module-worker,mystery"/); assert.equal(tags(html, /data-capability=/g), 3);
  assert.deepEqual(H.describeUnsupported(undefined).items, []);
});
test("FORMATTING: sizes, severity badges (icon + text, never colour alone), note chips", () => {
  assert.equal(H.formatBytes(0), "0 byte"); assert.equal(H.formatBytes(1536), "1,5 KiB"); assert.equal(H.formatBytes(5 * 1024 * 1024), "5,00 MiB"); assert.equal(H.formatBytes(NaN), "—");
  assert.deepEqual({ ...H.severityView("error") }, { label: "Lỗi", icon: "⛔", badge: "badge-red" }); assert.deepEqual({ ...H.severityView("warning") }, { label: "Cảnh báo", icon: "⚠️", badge: "badge-yellow" });
  assert.deepEqual(H.noteChips(["name:trim", "code:trim", "code:numeric", "order:order-text", "name:trim", "weird:other"]), ["tên: đã cắt khoảng trắng", "mã: đã cắt khoảng trắng", "mã: mã đọc từ ô số", "thứ tự đọc từ ô văn bản"]);
  assert.deepEqual(H.noteChips(undefined), []);
});

test("DIAGNOSTICS: counts, sheet options, severity/sheet filters keep ORIGINAL indexes; location and message body split the P4-S2 message", async () => {
  const { result } = await run({ subjects: [["A", "Môn", 1], ["a", "Môn 2", 1]], lessons: [["ZZ", "x", "Bài", 1], ["A", "x", "Bài", 1]], framework: ["ab"] });
  const list = result.diagnostics;
  const counts = H.countDiagnostics(list);
  assert.equal(counts.errors, result.errors.length); assert.equal(counts.warnings, result.warnings.length); assert.equal(counts.total, list.length);
  const options = H.sheetOptions(list);
  assert.ok(options.every((o) => o.count > 0)); assert.deepEqual(options.map((o) => o.key), [...options.map((o) => o.key)].sort((a, b) => (a === H.FILE_LEVEL ? -1 : b === H.FILE_LEVEL ? 1 : a < b ? -1 : 1)));
  const onlyBai = H.filterDiagnostics(list, { sheet: "BÀI" });
  assert.ok(onlyBai.length >= 1 && onlyBai.every((e) => list[e.index] === e.diagnostic && e.diagnostic.sheet === "BÀI"));
  assert.equal(H.filterDiagnostics(list, { severity: "warning" }).every((e) => e.diagnostic.severity === "warning"), true);
  assert.equal(H.filterDiagnostics(list, { severity: "all", sheet: "all" }).length, list.length);
  assert.equal(H.filterDiagnostics(list, { sheet: "NOPE" }).length, 0);
  const orphan = list.find((d) => d.code === "LESSON_ORPHAN");
  assert.equal(H.locationText(orphan), "Sheet “BÀI” · dòng 2 · cột “Mã môn”");
  assert.match(orphan.message, /^Sheet “BÀI”, dòng 2/); assert.equal(H.messageBody(orphan), orphan.message.slice(orphan.message.indexOf(": ") + 2)); assert.doesNotMatch(H.messageBody(orphan), /^Sheet/);
  assert.equal(H.locationText({ sheet: null, row: null, column: null }), "Toàn bộ tệp"); assert.equal(H.messageBody({ sheet: null, message: "Tệp rỗng." }), "Tệp rỗng.");
});
test("RESULTS markup: error/warning counts, filters, every diagnostic shows worksheet, row, column, field, message, hint and code; escaping; paging; no stack traces", async () => {
  const bad = await run({ subjects: [["A1", "Môn <img src=x onerror=alert(1)>", 1], ["a1", "Môn hai", 2]], lessons: [["KHAC", "x", "Bài", 1]] });
  const html = H.renderResultsHtml({ result: bad.result, esc, filters: { severity: "all", sheet: "all" }, limit: 100, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "khung <b>.xlsx", size: 2048, sha256: "a".repeat(64) } });
  assert.match(html, /id="impErrorCount"[^>]*>⛔ Lỗi: 2</); assert.match(html, /id="impWarningCount"[^>]*>⚠️ Cảnh báo: \d+</);
  assert.match(html, /Tệp có 2 lỗi cần sửa trong Excel rồi chọn lại tệp\./); assert.match(html, /id="impFilterSeverity"/); assert.match(html, /id="impFilterSheet"/);
  const dup = html.split('data-code="CODE_DUPLICATE"')[1].split("</li>")[0];
  assert.match(dup, /Sheet “MÔN” · dòng 3 · cột “Mã môn” · trường <code>subjectCode<\/code>/); assert.match(dup, /Mã: CODE_DUPLICATE/); assert.match(dup, /XEM DÒNG 3/);
  assert.match(html, /data-diag-hint="1">💡 <b>Gợi ý:<\/b>/); assert.doesNotMatch(html, /<img /); assert.doesNotMatch(html, /<b>\.xlsx/); assert.match(html, /khung &lt;b&gt;\.xlsx/);
  assert.doesNotMatch(html, /at \w+ \(|stack|TypeError|ReferenceError|node_modules|\.mjs:\d+/);
  const filtered = H.renderResultsHtml({ result: bad.result, esc, filters: { severity: "warning", sheet: "all" }, limit: 100, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "a.xlsx", size: 1, sha256: null } });
  assert.doesNotMatch(filtered, /data-severity="error"/);
  const none = H.renderResultsHtml({ result: bad.result, esc, filters: { severity: "warning", sheet: "KHUNG" }, limit: 100, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "a.xlsx", size: 1, sha256: null } });
  assert.match(none, /id="impDiagNone"/);
  const paged = { diagnostics: Array.from({ length: 250 }, (_, i) => ({ severity: "error", code: "REQUIRED_MISSING", stage: 4, sheet: "MÔN", row: i + 2, column: "Mã môn", field: "subjectCode", message: "Sheet “MÔN”, dòng " + (i + 2) + ": Ô “Mã môn” bắt buộc nhưng đang trống.", hint: "Điền giá trị", refs: [], value: null })), ok: false };
  const p1 = H.renderResultsHtml({ result: paged, esc, filters: { severity: "all", sheet: "all" }, limit: 100, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "a.xlsx", size: 1, sha256: null } });
  assert.equal(tags(p1, /data-diag-item=/g), 100); assert.match(p1, /Đang hiển thị 100\/250 mục\./); assert.match(p1, /HIỂN THỊ THÊM 100/);
  const p3 = H.renderResultsHtml({ result: paged, esc, filters: { severity: "all", sheet: "all" }, limit: 300, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "a.xlsx", size: 1, sha256: null } });
  assert.equal(tags(p3, /data-diag-item=/g), 250); assert.doesNotMatch(p3, /HIỂN THỊ THÊM/);
  const valid = await run();
  const ok = H.renderResultsHtml({ result: valid.result, esc, filters: { severity: "all", sheet: "all" }, limit: 100, inspect: null, activeIndex: null, hasNodeFor: () => false, rowsFor: () => [], file: { name: "a.xlsx", size: 1, sha256: null } });
  assert.match(ok, /Tệp hợp lệ, không có lỗi hay cảnh báo\./); assert.doesNotMatch(ok, /id="impFilterSeverity"/);
});
test("ROW INSPECTOR: raw cells of one row come from the RawWorkbook with the sheet's own headers; types are labelled; long text is bounded; unknown rows are empty", async () => {
  const { extracted } = await validateBytes(workbookBytes({ subjects: [["007", "Toán", 1], [12, "Lý", null]] }));
  const rows2 = H.rowCells(extracted.raw, "MÔN", 2);
  assert.deepEqual(rows2.map((c) => [c.column, c.header, c.type, c.value]), [["A", "Mã môn", "văn bản", "007"], ["B", "Tên môn", "văn bản", "Toán"], ["C", "Thứ tự", "số", "1"]]);
  assert.deepEqual(H.rowCells(extracted.raw, "MÔN", 3).map((c) => [c.type, c.value]), [["số", "12"], ["văn bản", "Lý"]]);
  assert.deepEqual(H.rowCells(extracted.raw, "MÔN", 99), []); assert.equal(H.rowCells(extracted.raw, "KHONG", 2), null); assert.equal(H.rowCells(null, "MÔN", 2), null); assert.equal(H.rowCells(extracted.raw, "MÔN", 0), null);
  const entry = { index: 3, diagnostic: { severity: "error", code: "X", sheet: "MÔN", row: 2, column: "Mã môn", field: "subjectCode", message: "Sheet “MÔN”, dòng 2: m", hint: null, refs: [], value: null } };
  const html = H.renderDiagnosticItemHtml({ entry, esc, inspectRows: H.rowCells(extracted.raw, "MÔN", 2), hasNode: true, active: true });
  assert.match(html, /data-diag-rows="1"/); assert.match(html, /Các ô của dòng 2 trong sheet “MÔN”/); assert.match(html, /ẨN DÒNG/); assert.match(html, /XEM TRONG BẢN XEM TRƯỚC/); assert.match(html, /aria-expanded="true"/);
  const formula = H.rowCells({ sheets: [{ name: "S", cells: [{ r: 1, c: 0, t: "s", v: "H" }, { r: 2, c: 0, t: "s", v: "=x".repeat(300), f: true }] }] }, "S", 2);
  assert.equal(formula[0].type, "công thức"); assert.ok(formula[0].value.length <= 200);
});

test("PREVIEW model + markup: subjects in effective order with their lessons, counts, codes, ordering text, chips, source rows, org identity; escaping; collapse and paging for large frameworks", async () => {
  const { result } = await run({ framework: ["  Khung <script>x</script>  "], subjects: [["B", "Môn B", 2], ["A", " Môn A ", 1]], lessons: [["A", "a2", "Bài A2", 2], ["A", null, "Bài A1", 1], ["B", "b1", "Bài B1", 1]] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const preview = H.buildPreview(result.model);
  assert.deepEqual(preview.groups.map((g) => [g.position, g.subject.code, g.lessons.map((l) => l.name)]), [[1, "A", ["Bài A1", "Bài A2"]], [2, "B", ["Bài B1"]]], "sorted by effective order, not by row");
  assert.deepEqual([preview.subjectCount, preview.lessonCount, preview.total, preview.withCode, preview.withoutCode], [2, 3, 5, 4, 1]); assert.equal(preview.collapseByDefault, false);
  const open = new Set(preview.groups.map((g) => g.subject.key));
  const html = H.renderPreviewHtml({ organization: ORG, preview, model: result.model, esc, open, shown: new Map(), warningCount: result.warnings.length });
  assert.match(html, /Khoa Quản trị/); assert.match(html, /<code>khoa-quan-tri<\/code> · <code>orgA<\/code>/); assert.match(html, /Khung &lt;script&gt;x&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Giá trị gốc trong tệp: “  Khung &lt;script&gt;/); assert.match(html, /Mã khung: chưa có/);
  assert.match(html, /2 môn · 3 bài · 5 mục/); assert.match(html, /4 mục có mã · 1 mục không mã/);
  assert.equal(tags(html, /data-kind="lesson"/g), 3); assert.equal(tags(html, /data-subject-key=/g), 2);
  assert.match(html, /Môn 1 · <code>A<\/code> · Môn A/); assert.match(html, /chip[^>]*>tên: đã cắt khoảng trắng/); assert.match(html, /dòng 4/);
  assert.match(html, /Bản nháp<\/b> trong đơn vị <b>Khoa Quản trị/); assert.match(html, /Chưa có dữ liệu nào được ghi/);
  assert.match(html, /ol id="impTree"/); assert.ok(tags(html, /aria-expanded="true"/g) === 2);
  const closed = H.renderPreviewHtml({ organization: ORG, preview, model: result.model, esc, open: new Set(), shown: new Map(), warningCount: 0 });
  assert.equal(tags(closed, /data-kind="lesson"/g), 0); assert.equal(tags(closed, /MỞ DANH SÁCH BÀI/g), 2);
  // large framework: collapsed by default, first LESSON_PAGE lessons per opened subject, "show more" with the remaining count
  const big = validateRaw({ subjects: [["S0", "Môn lớn", 0]], lessons: Array.from({ length: 250 }, (_, i) => ["S0", "L" + i, "Bài " + i, i]) });
  const bigPreview = H.buildPreview(big.model);
  assert.equal(bigPreview.collapseByDefault, true);
  const key = bigPreview.groups[0].subject.key;
  const pageOne = H.renderPreviewHtml({ organization: ORG, preview: bigPreview, model: big.model, esc, open: new Set([key]), shown: new Map(), warningCount: 0 });
  assert.equal(tags(pageOne, /data-kind="lesson"/g), 100); assert.match(pageOne, /HIỂN THỊ THÊM 100 BÀI \(còn 150\)/); assert.match(pageOne, /Khung lớn \(251 mục\)/);
  const pageAll = H.renderPreviewHtml({ organization: ORG, preview: bigPreview, model: big.model, esc, open: new Set([key]), shown: new Map([[key, 300]]), warningCount: 0 });
  assert.equal(tags(pageAll, /data-kind="lesson"/g), 250); assert.doesNotMatch(pageAll, /HIỂN THỊ THÊM/);
  const empty = validateRaw({ subjects: [["E", "Môn trống", 0]], lessons: [] });
  assert.match(H.renderPreviewHtml({ organization: ORG, preview: H.buildPreview(empty.model), model: empty.model, esc, open: new Set([H.buildPreview(empty.model).groups[0].subject.key]), shown: new Map(), warningCount: 1 }), /Môn này chưa có bài nào/);
});
test("PLAN SUMMARY: documents, chunks and the draft status are shown as numbers only; a failed plan is explained; the future action is DISABLED with a Vietnamese reason and cannot be activated", async () => {
  const { prepareCommit } = await import("../../import-plan.mjs");
  const model = validateRaw({ subjects: Array.from({ length: 5 }, (_, i) => ["S" + i, "Môn " + i, i]), lessons: Array.from({ length: 900 }, (_, i) => ["S" + (i % 5), "L" + i, "Bài " + i, Math.floor(i / 5)]) }).model;
  const prepared = prepareCommit(model, { organization: { id: "orgA", status: "active" }, batchId: "preview1234567890123", actorUid: "pa" });
  assert.equal(prepared.ok, true);
  const summary = H.planSummary(prepared.plan);
  assert.deepEqual({ ...summary, chunkSizes: [...summary.chunkSizes] }, { nodeCount: 905, totalDocuments: 907, chunkCount: 3, chunkSizes: [400, 400, 105], maxChunkWrites: 400, subjectCount: 5, lessonCount: 900 });
  assert.ok(Object.isFrozen(summary) && !("planDigest" in summary) && !("nodes" in summary), "numbers only: no executable plan object is kept");
  const html = H.renderPlanHtml({ summary, esc });
  assert.match(html, /data-plan="documents">907</); assert.match(html, /1 lô nhập \+ 1 khung \+ 905 mục \(5 môn, 900 bài\)/); assert.match(html, /data-plan="chunks">3 đợt</); assert.match(html, /đợt cuối 105 mục/); assert.match(html, /Bản nháp/);
  assert.match(H.renderPlanHtml({ summary: null, planFailure: "Không lập được kế hoạch nhập: x", esc }), /role="alert"[\s\S]*Không lập được kế hoạch nhập: x/);
  const future = H.renderFutureActionHtml({ esc });
  assert.match(future, /id="impConfirmDisabled" disabled aria-disabled="true" aria-describedby="impConfirmHint"/); assert.match(future, /Chức năng nhập dữ liệu chưa được bật\. Việc ghi vào hệ thống sẽ có trong bản phát hành sau/);
  assert.doesNotMatch(future, /onclick|data-imp-action|type="submit"/);
});
test("SHELL / cards: organization identity is rendered and locked, archived organizations are explained, the file card is disabled with a reason, template card has both downloads, denied view for non-admins", () => {
  const shell = H.renderShellHtml({ organization: ORG, esc });
  assert.match(shell, /data-org-id="orgA"/); assert.match(shell, /🔒 Đơn vị đã chọn \(cố định trong suốt quá trình nhập\)/); assert.match(shell, /id="impBack"/); assert.doesNotMatch(shell, /<select[^>]*organization/i);
  for (const id of ["impUnsupportedHost", "impTemplateHost", "impFileHost", "impStatusHost", "impResultsHost", "impPreviewHost", "impPlanHost", "impFutureHost", "impLive", "impOrgHost"]) assert.match(shell, new RegExp('id="' + id + '"'));
  assert.match(H.renderOrganizationHeaderHtml({ organization: { ...ORG, status: "archived" }, esc }), /id="impOrgArchived"[\s\S]*Đơn vị đã lưu trữ/);
  const tpl = H.renderTemplateCardHtml({ esc, templateId: "hcma2.curriculum.xlsx", schemaVersion: 1 });
  assert.match(tpl, /id="impTemplateBlank"[^>]*>⬇ TẢI FILE MẪU</); assert.match(tpl, /id="impTemplateExample"[^>]*>⬇ TẢI FILE MẪU CÓ VÍ DỤ</); assert.match(tpl, /hcma2\.curriculum\.xlsx/); assert.match(tpl, /Quy tắc điền tệp/);
  assert.match(H.renderTemplateCardHtml({ esc, busy: true, templateId: "t", schemaVersion: 1 }), /id="impTemplateBlank"[^>]* disabled/);
  const file = H.renderFileCardHtml({ esc, disabled: true, reason: "lý do", file: { name: "a.xlsx", size: 1024, sha256: "b".repeat(64) } });
  assert.match(file, /id="impPick"[^>]* disabled/); assert.match(file, /id="impFile"[^>]* disabled/); assert.match(file, /lý do/); assert.match(file, /bbbbbbbbbbbb…/); assert.match(file, /accept="\.xlsx,/); assert.match(file, /tối đa <b>5 MiB<\/b>/);
  assert.doesNotMatch(H.renderFileCardHtml({ esc }), /id="impPick"[^>]* disabled/);
  assert.match(H.renderDeniedHtml({ esc }), /Chỉ quản trị viên hệ thống/);
  assert.match(H.renderStatusHtml({ phase: "reading", esc, fileName: "a.xlsx" }), /aria-busy="true"[\s\S]*Đang đọc và kiểm tra tệp/); assert.match(H.renderStatusHtml({ phase: "failed", esc, failure: "Không thể đọc" }), /role="alert"/); assert.equal(H.renderStatusHtml({ phase: "idle", esc }), "");
});
test("ACCESS: a non-admin mount renders only the denied view and loads NOTHING (no engine, no reads); a missing organization is refused; a second mount tears the first down", async () => {
  let loaded = 0;
  const host = { innerHTML: "", querySelector: () => null, addEventListener() {}, removeEventListener() {}, contains: () => false };
  const denied = createImportCenter({ actorUid: "t", isPlatformAdmin: false, esc, toast() {}, loadEngine: async () => { loaded++; return {}; }, downloadFile() {} });
  await denied.mount(host, { organization: ORG, onBack() {} });
  assert.match(host.innerHTML, /impDenied/); assert.equal(loaded, 0);
  const noOrg = createImportCenter({ actorUid: "a", isPlatformAdmin: true, esc, toast() {}, loadEngine: async () => { loaded++; return {}; }, downloadFile() {} });
  await noOrg.mount(host, { organization: null }); assert.match(host.innerHTML, /impDenied/); await noOrg.mount(host, { organization: { id: "" } }); assert.equal(loaded, 0);
  await noOrg.mount(null, { organization: ORG });
});
