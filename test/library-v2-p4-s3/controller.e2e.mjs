// LIBRARY V2 P4-S3 - Import Center CONTROLLER in a REAL browser (headless Edge/Chromium): the real view, the real P4-S2 engine, the real module Worker and SheetJS 0.20.3, with only
// the Organization lookup / toast / download faked (harness.html). Covers: lazy loading, template downloads + re-import, valid preview, invalid-file diagnostics (filters, paging, row
// inspector, navigation), orphan grouping, large frameworks, unsupported browser, archived organization, organization isolation, XSS, mobile layout, network audit, disabled confirm action.
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p4-s3/controller.e2e.mjs   (optional P4S3_SHOTS=<dir>)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { workbookBytes, validateBytes, XLSX } from "../library-v2-p4-s2/helpers.mjs";
import { extractRawWorkbook } from "../../import-xlsx-extract.mjs";
import { validateImport } from "../../import-validate.mjs";
import { sha256Hex } from "../../import-sha256.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const pw = await import(path.isAbsolute(pkg) ? pathToFileURL(pkg).href : pkg);
const chromium = pw.chromium || pw.default.chromium;
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };
const requests = [];
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end("nf"); } res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p)); } catch { res.writeHead(500); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
await page.goto(`${base}/test/library-v2-p4-s3/harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P4S3_SHOTS) await page.screenshot({ path: path.join(process.env.P4S3_SHOTS, name + ".png"), fullPage: true }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => ev((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const count = (sel) => page.locator(sel).count();
const ORG = (extra = {}) => ({ id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active", ...extra });
const mount = async (opts = {}) => { await ev(async (o) => { const h = window.__h; if (!o.keep) h.reset(); if (o.org) h.org(o.org); for (const m of o.members || []) h.member(m); for (const c of o.caps || []) h.capability(c); await h.mount(o); }, { keep: false, ...opts, org: opts.org === undefined ? ORG() : opts.org }); };
const file = (name, bytes) => ({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
const choose = async (f) => { await page.setInputFiles("#impFile", f); await page.waitForSelector("#impResults, #impFailed, #impUnsupported[data-after-read]", { timeout: 60000 }).catch(() => {}); await page.waitForFunction(() => !document.querySelector("#impReading"), null, { timeout: 60000 }); };
const downloads = () => ev(() => window.__h.downloads);
const fromB64 = (b64) => new Uint8Array(Buffer.from(b64, "base64"));
const D = (n) => Array.from({ length: n }, (_, i) => i);

// ---- fixtures
const exampleBytes = null;
const manyErrors = workbookBytes({ subjects: D(250).map((i) => [null, "Môn " + i, null]), lessons: [] });                 // 250 REQUIRED_MISSING on MÔN
const big = (() => { const subjects = D(50).map((i) => ["S" + i, "Môn số " + i, i]); const lessons = []; for (let s = 0; s < 50; s++) for (let l = 0; l < 99; l++) lessons.push(["S" + s, "S" + s + "-B" + l, "Bài " + l + " của môn " + s, l]); return workbookBytes({ subjects, lessons }); })();

try {
  await step("MOUNT (admin): the engine loads lazily on open (reader code yes, SheetJS no); organization name, code and id are shown and fixed; Quay lại works; template + file cards present", async () => {
    requests.length = 0;
    await mount({});
    await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    assert.ok(requests.some((r) => /import-center-engine\.mjs/.test(r.url)) && requests.some((r) => /import-xlsx-reader\.mjs/.test(r.url)), "engine loaded on demand");
    assert.ok(!requests.some((r) => /vendor\/sheetjs/.test(r.url)), "SheetJS is not loaded until a file is parsed or a template is built");
    assert.equal(await text("#impOrgName"), "Khoa Quản trị"); assert.equal(await text("#impOrgCode"), "khoa-quan-tri"); assert.equal(await text("#impOrgId"), "orgA"); assert.equal(await ev(() => document.querySelector("[data-org-id]").dataset.orgId), "orgA");
    assert.match(await text("#impTitle"), /Nhập chương trình từ Excel/);
    assert.equal(await count("#impTemplateBlank"), 1); assert.equal(await count("#impTemplateExample"), 1);
    assert.equal(await ev(() => window.__h.orgReads.join(",")), "orgA", "one read-only Organization lookup");
    assert.equal(await ev(() => document.activeElement && document.activeElement.id), "impTitle", "focus moves to the screen heading");
    assert.equal(await count("#impConfirmDisabled"), 0, "no confirm action before a valid preview");
    await page.click("#impBack"); assert.equal(await ev(() => window.__h.backs), 1);
    await shot("01-open");
  });

  await step("ACCESS MATRIX (approved P2/P3 contract): Platform Admin, Organization Admin and an active member with curriculum.manage get the Import Center; unprivileged members, suspended members, outsiders and capability-less accounts see only a Vietnamese denial; the engine and the reader are NOT requested for a denied principal", async () => {
    const M = (uid, extra = {}) => ({ organizationId: "orgA", uid, orgRole: "member", status: "active", ...extra });
    const C = (uid, caps, denied = [], extra = {}) => ({ organizationId: "orgA", uid, caps, denied, ...extra });
    const denied = [
      ["outsider (no membership)", { uid: "u-out" }, "NOT_MEMBER"],
      ["unprivileged member (no capability document)", { uid: "u-m", members: [M("u-m")] }, "NO_CAPABILITY"],
      ["member holding only another capability", { uid: "u-r", members: [M("u-r")], caps: [C("u-r", ["library.review"])] }, "NO_CAPABILITY"],
      ["member whose curriculum.manage is explicitly denied", { uid: "u-d", members: [M("u-d")], caps: [C("u-d", ["curriculum.manage"], ["curriculum.manage"])] }, "NO_CAPABILITY"],
      ["suspended member with the capability", { uid: "u-s", members: [M("u-s", { status: "suspended" })], caps: [C("u-s", ["curriculum.manage"])] }, "MEMBERSHIP_INACTIVE"],
      ["removed organization admin", { uid: "u-x", members: [M("u-x", { status: "removed", orgRole: "org_admin" })] }, "MEMBERSHIP_INACTIVE"],
      ["another organization's membership", { uid: "u-o", members: [M("u-o", { organizationId: "orgB" })], caps: [C("u-o", ["curriculum.manage"], [], { organizationId: "orgB" })] }, "NOT_MEMBER"],
      ["inactive account", { uid: "u-i", accountActive: false, members: [M("u-i", { orgRole: "org_admin" })] }, "ACCOUNT_INACTIVE"]
    ];
    for (const [label, who, reason] of denied) {
      requests.length = 0;
      await mount({ isAdmin: false, ...who });
      assert.equal(await count("#impDenied"), 1, label); assert.equal(await ev(() => document.querySelector("#impDenied").dataset.reason), reason, label);
      assert.equal(await count("#impFile, #impTemplateBlank, #impOrg"), 0, label + ": no panel"); assert.doesNotMatch(await text("#host"), /Khoa Quản trị/, label + ": the organization name is not shown to a denied principal");
      assert.equal(await ev(() => window.__h.engineLoads), 0, label + ": engine not loaded"); assert.equal(await ev(() => window.__h.readerCalls), 0);
      assert.ok(!requests.some((r) => /import-center-engine|import-xlsx|sheetjs/.test(r.url)), label + ": nothing lazy was fetched");
    }
    assert.match(await text("#impDenied"), /Tài khoản của bạn hiện không hoạt động/);
    const allowed = [
      ["Organization Admin", { uid: "u-a", members: [M("u-a", { orgRole: "org_admin" })] }, ["membership"]],
      ["member with curriculum.manage", { uid: "u-c", members: [M("u-c")], caps: [C("u-c", ["library.review", "curriculum.manage"])] }, ["membership", "capability"]]
    ];
    for (const [label, who, reads] of allowed) {
      await mount({ isAdmin: false, ...who });
      assert.equal(await count("#impDenied"), 0, label); assert.equal(await count("#impOrg"), 1, label); assert.match(await text("#impOrgName"), /Khoa Quản trị/);
      assert.equal(await count("#impTemplateBlank"), 1); assert.equal(await count("#impFile:not([disabled])"), 1, label + ": the file chooser is enabled for an active organization");
      assert.deepEqual(await ev(() => window.__h.accessReads.map((r) => r[0])), reads, label + ": only the user's OWN membership (and capability for an ordinary member) was read");
      assert.equal(await ev(() => window.__h.engineLoads), 1);
      assert.equal(await count("#impConfirmDisabled[disabled]"), 0, "confirm is only rendered with a preview");
    }
    // archived: Organization Admin may open (read-only governance) but cannot prepare; a capability holder is denied outright
    await mount({ isAdmin: false, uid: "u-a", org: ORG({ status: "archived" }), members: [M("u-a", { orgRole: "org_admin" })] });
    assert.equal(await count("#impDenied"), 0); assert.equal(await count("#impOrgArchived"), 1); assert.equal(await count("#impFile[disabled]"), 1); assert.equal(await count("#impTemplateBlank:not([disabled])"), 1);
    await mount({ isAdmin: false, uid: "u-c", org: ORG({ status: "archived" }), members: [M("u-c")], caps: [C("u-c", ["curriculum.manage"])] });
    assert.equal(await ev(() => document.querySelector("#impDenied").dataset.reason), "ORGANIZATION_ARCHIVED"); assert.equal(await count("#impFile, #impTemplateBlank"), 0);
    // Platform Admin: no membership or capability reads at all
    await mount({ isAdmin: true });
    assert.equal(await count("#impDenied"), 0); assert.deepEqual(await ev(() => window.__h.accessReads), []);
    await mount({ isAdmin: true, accountActive: false }); assert.equal(await ev(() => document.querySelector("#impDenied").dataset.reason), "ACCOUNT_INACTIVE");
    await mount({ org: null }); assert.equal(await count("#impDenied"), 1);
  });

  await step("ACCESS CHECK FAILURE: a transient failure shows a retry (never access); THỬ LẠI recovers and then applies the real decision", async () => {
    await ev(async () => {
      const h = window.__h; h.reset(); h.org({ id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active" });
      h.member({ organizationId: "orgA", uid: "u-c", orgRole: "member", status: "active" }); h.capability({ organizationId: "orgA", uid: "u-c", caps: ["curriculum.manage"], denied: [] });
    });
    await ev(async () => { const h = window.__h; h.failNextMembership = true; await h.mount({ isAdmin: false, uid: "u-c", org: { id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active" } }); });
    assert.equal(await count("#impAccessFailed"), 1); assert.equal(await count("#impFile, #impTemplateBlank, #impDenied"), 0); assert.equal(await ev(() => window.__h.engineLoads), 0);
    await page.click("#impAccessRetry");
    await page.waitForSelector("#impFile", { timeout: 15000 });
    assert.equal(await count("#impAccessFailed"), 0); assert.match(await text("#impOrgName"), /Khoa Quản trị/);
  });

  await step("TEMPLATE CENTER: both downloads are generated locally with the right names and mime; the bytes RE-IMPORT through the approved pipeline (example = valid 3/7/10, blank = structure OK)", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await page.click("#impTemplateBlank"); await page.waitForFunction(() => window.__h.downloads.length === 1, null, { timeout: 30000 });
    await page.click("#impTemplateExample"); await page.waitForFunction(() => window.__h.downloads.length === 2, null, { timeout: 30000 });
    const [blank, example] = await downloads();
    assert.equal(blank.fileName, "HCMA2_mau_khung_chuong_trinh_v1.xlsx"); assert.equal(example.fileName, "HCMA2_mau_khung_chuong_trinh_v1_co_vi_du.xlsx");
    assert.equal(blank.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(await text("#impTemplateStatus"), /Đã tạo tệp mẫu\. Tệp được tạo ngay trên máy của bạn\./);
    assert.ok(requests.some((r) => /vendor\/sheetjs-0\.20\.3\/xlsx\.mjs/.test(r.url)), "SheetJS 0.20.3 loaded lazily for the template");
    assert.ok(!requests.some((r) => /vendor\/xlsx\.full\.min\.js/.test(r.url)), "the V1 export library is not involved");
    const check = async (dl) => { const bytes = fromB64(dl.b64); const ex = await extractRawWorkbook(XLSX, bytes, { fileName: dl.fileName, size: bytes.length }); return { ex, r: validateImport({ ...ex, file: { name: dl.fileName, size: bytes.length, sha256: sha256Hex(bytes) } }) }; };
    const e = await check(example); assert.equal(e.ex.ok, true); assert.equal(e.r.ok, true, JSON.stringify(e.r.errors)); assert.deepEqual(e.r.counts, { subjects: 3, lessons: 7, total: 10 });
    const b = await check(blank); assert.equal(b.ex.ok, true); assert.deepEqual(b.r.errors.map((x) => x.code), ["FRAMEWORK_ROW_COUNT"]);
    assert.equal(await ev(() => window.__h.toasts.filter((t) => t.type === "ok").length), 2);
  });

  await step("VALID FILE: the downloaded EXAMPLE template re-imports in the browser -> verdict, counts, framework name, hierarchy with codes/names/order/source rows, org identity, read-only plan (12 documents, 1 chunk), DISABLED confirm", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await page.click("#impTemplateExample"); await page.waitForFunction(() => window.__h.downloads.length === 1);
    const example = (await downloads())[0];
    await choose(file(example.fileName, fromB64(example.b64)));
    assert.equal(await count("#impResults"), 1); assert.match(await text("#impVerdict"), /Tệp hợp lệ, không có lỗi hay cảnh báo\./);
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 0"); assert.equal(await text("#impWarningCount"), "⚠️ Cảnh báo: 0");
    assert.equal(await ev(() => document.activeElement && document.activeElement.id), "impResultTitle");
    assert.match(await text("#impFileLine"), /HCMA2_mau_khung_chuong_trinh_v1_co_vi_du\.xlsx/);
    assert.equal(await text('[data-prev="org"]'), "Khoa Quản trị"); assert.match(await text("#impPreviewSummary"), /khoa-quan-tri.*orgA/);
    assert.match(await text('[data-prev="framework"]'), /Khung ví dụ: Nghiệp vụ văn phòng/); assert.match(await text("#impPreviewSummary"), /Mã khung: không áp dụng/);
    assert.equal(await text('[data-prev="counts"]'), "3 môn · 7 bài · 10 mục"); assert.match(await text("#impPreviewSummary"), /9 mục có mã · 1 mục không mã/);
    assert.equal(await count("[data-subject-key]"), 3); assert.equal(await count('[data-kind="lesson"]'), 7, "small framework: subjects open by default");
    const subjects = await ev(() => [...document.querySelectorAll("[data-subject-key]")].map((li) => li.querySelector("div div").textContent.replace(/\s+/g, " ").trim()));
    assert.match(subjects[0], /^Môn 1 · VP01 · Soạn thảo văn bản hành chính/); assert.match(subjects[2], /^Môn 3 · VP03 · Giao tiếp công sở/);
    const vp03 = await ev(() => [...document.querySelectorAll('[data-subject-key="MON:4"] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, " ").trim())));
    assert.deepEqual(vp03.map((r) => r.slice(0, 4)), [["1", "1", "VP03-B01", "Giao tiếp qua điện thoại và thư điện tử"], ["2", "2", "—", "Ứng xử với khách đến làm việc (bài này không có mã)"]]);
    assert.equal(await text('[data-plan="documents"]'), "12"); assert.match(await text("#impPlan"), /1 lô nhập \+ 1 khung \+ 10 mục \(3 môn, 7 bài\)/); assert.equal(await text('[data-plan="chunks"]'), "1 đợt"); assert.match(await text("#impPlan"), /Bản nháp/);
    assert.match(await text("#impPreview"), /Chưa có dữ liệu nào được ghi/);
    assert.equal(await ev(() => document.querySelector("#impConfirmDisabled").disabled), true); assert.equal(await ev(() => document.querySelector("#impConfirmDisabled").getAttribute("aria-disabled")), "true");
    assert.match(await text("#impConfirmHint"), /Chức năng nhập dữ liệu chưa được bật\. Việc ghi vào hệ thống sẽ có trong bản phát hành sau/);
    await page.click("#impConfirmDisabled", { force: true, timeout: 2000 }).catch(() => {});
    assert.equal(await ev(() => window.__h.downloads.length), 1); assert.match(await text("#impFileLine"), /SHA-256/);
    await shot("02-preview");
  });

  await step("INVALID FILES: blank template, duplicate codes and orphan lessons show worksheet/row/column/field/message/hint with error+warning counts; no preview or plan is offered", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await page.click("#impTemplateBlank"); await page.waitForFunction(() => window.__h.downloads.length === 1);
    const blank = (await downloads())[0];
    await choose(file(blank.fileName, fromB64(blank.b64)));
    assert.match(await text("#impVerdict"), /Tệp có 1 lỗi cần sửa trong Excel rồi chọn lại tệp\./); assert.equal(await count("#impPreview, #impPlan, #impFuture"), 0);
    const item = await ev(() => { const li = document.querySelector("[data-diag-item]"); return { where: li.querySelector("[data-diag-where]").textContent, message: li.querySelector("[data-diag-message]").textContent, hint: li.querySelector("[data-diag-hint]")?.textContent || "", code: li.dataset.code, severity: li.dataset.severity }; });
    assert.match(item.where, /Sheet “KHUNG”/); assert.match(item.message, /đúng một dòng dữ liệu \(dòng 2\), hiện có 0/); assert.match(item.hint, /Gợi ý: Chỉ điền tên khung ở dòng 2/); assert.equal(item.code, "FRAMEWORK_ROW_COUNT"); assert.equal(item.severity, "error");
    await choose(file("trung.xlsx", workbookBytes({ subjects: [["A1", "Môn <b>một</b>", 1], ["a1", "Môn hai", 2]], lessons: [["KHONGCO", "x", "Bài mồ côi", 1], ["A1", "A1", "Bài trùng mã môn", 2]] })));
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 3"); assert.match(await text("#impVerdict"), /3 lỗi/);
    const rows = await ev(() => [...document.querySelectorAll("[data-diag-item]")].map((li) => ({ code: li.dataset.code, where: li.querySelector("[data-diag-where]").textContent.replace(/\s+/g, " ").trim(), msg: li.querySelector("[data-diag-message]").textContent.trim() })));
    const dup = rows.find((r) => r.code === "CODE_DUPLICATE" && /MÔN/.test(r.where)); assert.match(dup.where, /Sheet “MÔN” · dòng 3 · cột “Mã môn” · trường subjectCode/); assert.match(dup.msg, /trùng với dòng 2 \(sheet MÔN\)/);
    const orphan = rows.find((r) => r.code === "LESSON_ORPHAN"); assert.match(orphan.where, /Sheet “BÀI” · dòng 2 · cột “Mã môn”/); assert.match(orphan.msg, /“KHONGCO” không có trong sheet MÔN/);
    assert.equal(await count("#impPreview"), 0); assert.equal(await count("[data-diag-message] b"), 0, "no markup injected from file content");
    await shot("03-errors");
  });

  await step("DERIVATIVE ORPHANS: a formula in a subject code gives ONE error (the root cause) plus one grouped warning - not an error per lesson", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("congthuc.xlsx", workbookBytes({ mutate: (wb) => { wb.Sheets["MÔN"].A2 = { t: "s", v: "T01", f: '"T01"' }; } })));
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 1"); assert.equal(await text("#impWarningCount"), "⚠️ Cảnh báo: 1");
    const codesShown = await ev(() => [...document.querySelectorAll("[data-diag-item]")].map((li) => li.dataset.code));
    assert.deepEqual(codesShown.sort(), ["CELL_FORMULA", "LESSONS_OF_INVALID_SUBJECT"]);
    assert.match(await text('[data-code="LESSONS_OF_INVALID_SUBJECT"]'), /2 bài tham chiếu mã môn “T01” của dòng 2/);
  });

  await step("DIAGNOSTICS UX: 250 errors -> first 100 shown, 'show more', severity/sheet filters, MỤC SAU/TRƯỚC navigation moves focus, XEM DÒNG shows the raw row with headers", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("nhieu-loi.xlsx", manyErrors));
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 250"); assert.equal(await count("[data-diag-item]"), 100); assert.match(await text("#impDiagCount"), /Đang hiển thị 100\/250 mục\./);
    await page.click('[data-imp-action="more-diag"]'); assert.equal(await count("[data-diag-item]"), 200); await page.click('[data-imp-action="more-diag"]'); assert.equal(await count("[data-diag-item]"), 250); assert.equal(await count('[data-imp-action="more-diag"]'), 0);
    await page.selectOption("#impFilterSeverity", "warning"); assert.equal(await count("[data-diag-item]"), 0); assert.equal(await count("#impDiagNone"), 1);
    await page.selectOption("#impFilterSeverity", "error"); await page.selectOption("#impFilterSheet", "MÔN"); assert.equal(await count("[data-diag-item]"), 100);
    assert.equal(await count('#impFilterSheet option[value="KHUNG"]'), 0, "the sheet filter offers only sheets that have diagnostics"); await page.selectOption("#impFilterSheet", "all");
    await page.click('[data-imp-action="next-diag"]'); const first = await ev(() => document.activeElement.dataset.diagItem); await page.click('[data-imp-action="next-diag"]'); const second = await ev(() => document.activeElement.dataset.diagItem);
    assert.notEqual(first, second); await page.click('[data-imp-action="prev-diag"]'); assert.equal(await ev(() => document.activeElement.dataset.diagItem), first);
    await page.click('[data-diag-item="0"] [data-imp-action="inspect"]');
    const cells = await ev(() => [...document.querySelectorAll('[data-diag-item="0"] [data-diag-rows] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())));
    assert.deepEqual(cells.map((c) => c.slice(0, 2)), [["B", "Tên môn"]]); assert.equal(cells[0][3], "Môn 0");
    await page.click('[data-diag-item="0"] [data-imp-action="inspect"]'); assert.equal(await count("[data-diag-rows]"), 0);
    await shot("04-many-errors");
  });

  await step("PREVIEW GOTO: a warning links to its node in the preview (subject opened, lesson paged in, row highlighted)", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("canh-bao.xlsx", workbookBytes({ subjects: [["A", "Môn không bài", 1], ["B", "Môn có bài", 2]], lessons: [["B", "b1", "Bài có mã số 007", 1]] })));
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 0"); assert.equal(await text("#impWarningCount"), "⚠️ Cảnh báo: 1");
    await page.click('[data-imp-action="close-all"]'); assert.equal(await count('[data-kind="lesson"]'), 0);
    await page.click('[data-diag-item="0"] [data-imp-action="goto-tree"]');
    assert.equal(await ev(() => document.activeElement.dataset.nodeKey), "MON:2"); assert.equal(await count('[data-node-key="MON:2"][style*="fef9c3"]'), 1);
    await page.click('[data-imp-action="open-all"]'); assert.equal(await count('[data-kind="lesson"]'), 1);
  });

  await step("LARGE FRAMEWORK (5000 nodes): result in seconds, subjects collapsed, opening shows 100 lessons with show-more, plan = 5002 documents in 13 chunks; keyboard-operable toggles", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    const t0 = Date.now();
    await choose(file("lon.xlsx", big));
    assert.ok(Date.now() - t0 < 30000, "5000 nodes read+validated in " + (Date.now() - t0) + " ms");
    assert.equal(await text('[data-prev="counts"]'), "50 môn · 4950 bài · 5000 mục"); assert.equal(await count('[data-kind="lesson"]'), 0); assert.match(await text("#impPreview"), /Khung lớn \(5000 mục\)/);
    assert.equal(await text('[data-plan="documents"]'), "5002"); assert.equal(await text('[data-plan="chunks"]'), "13 đợt"); assert.match(await text("#impPlan"), /đợt cuối 200 mục/);
    await page.focus('[data-imp-action="toggle-subject"][data-subject="MON:2"]'); await page.keyboard.press("Enter");
    assert.equal(await count('[data-kind="lesson"]'), 99); assert.equal(await ev(() => document.activeElement.dataset.subject), "MON:2");
    await page.click('[data-imp-action="open-all"]'); assert.equal(await count('[data-kind="lesson"]'), 50 * 99);
    await page.click('[data-imp-action="close-all"]'); assert.equal(await count('[data-kind="lesson"]'), 0);
    await shot("05-large");
  });

  await step("FILE LIMITS: a file over 5 MiB, a non-xlsx file and a macro workbook are rejected with Vietnamese file-level diagnostics (no preview)", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("qua-lon.xlsx", new Uint8Array(5 * 1024 * 1024 + 1).fill(0x50)));
    assert.match(await text("#impResults"), /Tệp lớn 5\.242\.881 byte, vượt giới hạn 5\.242\.880 byte \(5 MiB\)|Tệp lớn 5,242,881 byte/); assert.equal(await count("#impPreview"), 0);
    await choose(file("van-ban.xlsx", new TextEncoder().encode("a,b\n1,2\n"))); assert.match(await text("#impResults"), /không phải sổ làm việc \.xlsx hợp lệ/);
    await choose(file("bang.csv", new TextEncoder().encode("a,b\n"))); assert.match(await text("#impResults"), /Chỉ nhận tệp Excel có đuôi \.xlsx/);
    assert.doesNotMatch(await text("#host"), /at \w|stack|TypeError|\.mjs:\d/, "no stack traces");
  });

  await step("UNSUPPORTED BROWSER (pre-check): BROWSER_UNSUPPORTED explanation lists each missing capability in Vietnamese, the file chooser is disabled with a reason, template downloads still work; no read is attempted", async () => {
    await mount({ mode: "noCaps" }); await page.waitForSelector("#impUnsupported");
    assert.match(await text("#impUnsupported"), /Trình duyệt này chưa hỗ trợ đọc tệp Excel một cách an toàn/); assert.equal(await ev(() => document.querySelector("#impUnsupported").dataset.missing), "decompression-stream,readable-stream");
    assert.equal(await count("#impUnsupported [data-capability]"), 2); assert.match(await text("#impUnsupported"), /Giải nén an toàn \(DecompressionStream\).*Luồng dữ liệu \(ReadableStream\)/); assert.match(await text("#impUnsupported"), /không đọc tệp bằng cách kém an toàn hơn/);
    assert.equal(await ev(() => document.querySelector("#impPick").disabled), true); assert.equal(await ev(() => document.querySelector("#impFile").disabled), true); assert.match(await text("#impPickHint"), /Trình duyệt chưa hỗ trợ/);
    await page.click("#impTemplateBlank"); await page.waitForFunction(() => window.__h.downloads.length === 1, null, { timeout: 30000 });
    assert.equal(await ev(() => window.__h.readerCalls), 0); await shot("06-unsupported");
  });
  await step("UNSUPPORTED BROWSER (at read time, e.g. no module Worker): the reader's BROWSER_UNSUPPORTED result drives the same Vietnamese explanation via missingCapabilities and locks the chooser", async () => {
    await mount({ mode: "readerUnsupported" }); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("a.xlsx", workbookBytes()));
    assert.equal(await count("#impUnsupported"), 1); assert.equal(await ev(() => document.querySelector("#impUnsupported").dataset.missing), "module-worker"); assert.match(await text("#impUnsupported"), /Tiến trình nền dạng module/);
    assert.equal(await ev(() => document.querySelector("#impPick").disabled), true); assert.equal(await count("#impPreview"), 0);
    assert.equal(await text("#impErrorCount"), "⛔ Lỗi: 1");
  });
  await step("ENGINE LOAD FAILURE: a failed lazy load shows a Vietnamese retry message (no stack); THỬ LẠI recovers", async () => {
    await mount({ mode: "engineFailOnce" }); await page.waitForSelector("#impFailed");
    assert.match(await text("#impFailed"), /Không tải được bộ đọc tệp Excel/); assert.doesNotMatch(await text("#host"), /Error|network/);
    await page.click('[data-imp-action="retry-engine"]'); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 }); assert.equal(await count("#impFailed"), 0);
  });

  await step("ARCHIVED ORGANIZATION: banner, chooser disabled with the reason, no preview path; template download still allowed", async () => {
    await mount({ org: ORG({ status: "archived" }) }); await page.waitForSelector("#impOrgArchived");
    assert.match(await text("#impOrgArchived"), /Đơn vị đã lưu trữ/); await page.waitForFunction(() => document.querySelector("#impPickHint"));
    assert.equal(await ev(() => document.querySelector("#impPick").disabled), true); assert.match(await text("#impPickHint"), /Đơn vị đã lưu trữ: không thể kiểm tra hoặc nhập tệp mới/);
    await page.click("#impTemplateExample"); await page.waitForFunction(() => window.__h.downloads.length === 1, null, { timeout: 30000 });
  });
  await step("ARCHIVED (status changes while open): the fresh Organization read applies the archived state", async () => {
    await ev(() => { const h = window.__h; h.reset(); h.org({ id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "archived" }); });
    await ev(async () => { await window.__h.mount({ org: { id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active" } }); });
    await page.waitForSelector("#impOrgArchived", { timeout: 10000 }); assert.equal(await ev(() => document.querySelector("#impPick").disabled), true);
  });

  await step("ORGANIZATION ISOLATION: the organization is frozen at mount; mounting another organization on the same host replaces EVERYTHING and a slow read of the first can never paint into the second", async () => {
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await ev(() => { window.__h.delays.read = 1500; });
    const pending = page.setInputFiles("#impFile", file("a.xlsx", workbookBytes()));
    await page.waitForSelector("#impReading");
    await ev(async () => { const h = window.__h; h.delays.read = 0; h.org({ id: "orgB", name: "Trung tâm B", code: "trung-tam-b", status: "active" }); await h.mount({ org: { id: "orgB", name: "Trung tâm B", code: "trung-tam-b", status: "active" }, keep: true }); });
    await pending; await page.waitForSelector("#impPick:not([disabled])"); await page.waitForTimeout(2200);
    assert.equal(await text("#impOrgName"), "Trung tâm B"); assert.equal(await ev(() => document.querySelector("[data-org-id]").dataset.orgId), "orgB");
    assert.equal(await count("#impResults, #impPreview, #impReading"), 0, "no state or late result leaked from organization A"); assert.equal(await count("[data-org-id='orgA']"), 0);
    assert.deepEqual(await ev(() => window.__h.orgReads), ["orgA", "orgB"]);
    await choose(file("b.xlsx", workbookBytes())); assert.equal(await text('[data-prev="org"]'), "Trung tâm B"); assert.match(await text("#impPreviewSummary"), /orgB/); assert.doesNotMatch(await text("#impPreviewSummary"), /orgA/);
    assert.equal(await count("select[name*='org' i], #orgSwitch"), 0, "there is no organization switcher");
  });

  await step("SAFETY: file content is escaped (no script runs, no markup), nothing is uploaded (no non-GET request, no Firebase/Storage host), no persistence, no importBatches mention, only the lazy modules were fetched", async () => {
    requests.length = 0; await ev(() => { window.__xss = undefined; localStorage.clear(); sessionStorage.clear(); });
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2<\/script>';
    await choose(file("xss.xlsx", workbookBytes({ framework: [evil + " khung"], subjects: [["X1", evil, 1]], lessons: [["X1", "l1", evil, 1]] })));
    assert.equal(await ev(() => window.__xss), undefined); assert.equal(await count("#host img, #host script"), 0); assert.ok((await text("#impTree")).includes("<img src=x"), "shown as text");
    assert.deepEqual(requests.filter((r) => r.method !== "GET"), [], "no POST/PUT/DELETE of any kind");
    assert.ok(requests.every((r) => r.url.startsWith(base) || r.url.startsWith("blob:") || r.url.startsWith("data:")), "no cross-origin request: " + JSON.stringify(requests.filter((r) => !r.url.startsWith(base)).slice(0, 3)));
    assert.ok(!requests.some((r) => /firestore|googleapis|firebasestorage|identitytoolkit/i.test(r.url)));
    assert.equal(await ev(() => localStorage.length + sessionStorage.length), 0, "nothing persisted");
    assert.equal(await ev(async () => (indexedDB.databases ? (await indexedDB.databases()).length : 0)), 0);
    assert.equal((await ev(() => document.getElementById("host").innerHTML)).includes("importBatches"), false);
  });

  await step("LAYOUT: at a 375 px phone width the page does not scroll horizontally with a preview, with errors and with the unsupported card; touch targets are >= 44 px", async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mount({}); await page.waitForSelector("#impPick:not([disabled])");
    await choose(file("a.xlsx", workbookBytes())); assert.ok(await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "preview");
    await choose(file("loi.xlsx", workbookBytes({ subjects: [["A1", "a", 1], ["a1", "b", 2]] }))); assert.ok(await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "errors");
    await mount({ mode: "noCaps" }); await page.waitForSelector("#impUnsupported"); assert.ok(await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "unsupported");
    const small = await ev(() => [...document.querySelectorAll("#host button:not([disabled])")].map((b) => b.getBoundingClientRect()).filter((r) => r.height < 36).length);
    assert.equal(small, 0, "no tiny buttons"); await shot("07-mobile"); await page.setViewportSize({ width: 1100, height: 900 });
  });

  await step("final: no unexpected page or console error; no Firestore-shaped call exists in this harness (the view is never given a write function)", async () => {
    assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  process.exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S3_SHOTS || ".", "failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", errors.slice(-5));
} finally {
  await browser.close().catch(() => {}); server.close();
}
