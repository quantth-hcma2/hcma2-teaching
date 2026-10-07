// LIBRARY V2 P3-S3 - section CONTROLLER state machine in a REAL browser (headless Edge) against an in-memory fake Firestore (harness.html). No emulator, no
// production, no network. Provokes every state/race/failure of the approved mini-spec deterministically. Real P3-S2 modules + real view are used.
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p3-s3/controller.e2e.mjs   (optional P3S3_SHOTS=<dir>)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const pw = await import(path.isAbsolute(pkg) ? pathToFileURL(pkg).href : pkg);
const chromium = pw.chromium || pw.default.chromium;
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(readFileSync(p)); } catch { res.writeHead(500); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
await page.goto(`${base}/test/library-v2-p3-s3/harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P3S3_SHOTS) await page.screenshot({ path: path.join(process.env.P3S3_SHOTS, "ctl-" + name + ".png") }); };

// ---- helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const ORG = (status = "active") => ({ id: "orgA", name: "Khoa Quản trị", code: "khoa", status, createdAt: { seconds: 5 } });
const FW = (id, status, sec, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", scope: "organization", name: "Khung " + id, status, createdAt: { seconds: sec, nanoseconds: 0 }, createdBy: "pa1", updatedAt: { seconds: sec, nanoseconds: 0 }, ...(status === "draft" ? {} : { activatedAt: { seconds: sec + 1, nanoseconds: 0 }, statusChangedAt: { seconds: sec + 1, nanoseconds: 0 }, statusChangedBy: "pa1" }), ...extra });
const NODE = (id, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn " + id, status: "active", createdAt: { seconds: 1 }, updatedAt: { seconds: 1 }, ...extra });
async function setup({ org = ORG(), frameworks = [], nodes = {}, canOpen = false, isAdmin = true } = {}) {
  await ev(({ org, frameworks, nodes }) => { const h = window.__h; h.reset(); h.seedOrg(org); frameworks.forEach((f) => h.seedFramework(f)); Object.entries(nodes).forEach(([fw, list]) => list.forEach((n) => h.seedNode(fw, n))); }, { org, frameworks, nodes });
  await ev(({ canOpen, isAdmin }) => window.__h.mount({ canOpen, isAdmin }), { canOpen, isAdmin });
}
const text = (sel) => ev((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const count = (sel) => page.locator(sel).count();
const rows = () => ev(() => [...document.querySelectorAll("[data-fw-row]")].map((r) => r.dataset.fwRow + ":" + r.dataset.fwStatus));
const groups = () => ev(() => [...document.querySelectorAll("[data-fw-group]")].map((g) => g.textContent.replace(/\s+/g, " ").trim()));
const actionsOf = (id) => ev((i) => [...document.querySelectorAll(`[data-fw-id="${i}"][data-fw-action]`)].map((b) => b.dataset.fwAction), id);
const toasts = () => ev(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.className.replace("toast", "").trim() + ":" + t.textContent));
const calls = (op) => ev((o) => window.__h.FAKE.calls.filter((c) => c.op === o).map((c) => ({ path: c.path, data: c.data, constraints: c.constraints })), op);
const audit = () => ev(() => window.__h.FAKE.audit);
const doc = (p) => ev((x) => window.__h.get(x), p);
const waitIdle = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 15000 });
const dialogOpen = () => count('#globalModal [role="dialog"]');
const clickAction = async (id, action) => { await page.click(`[data-fw-id="${id}"][data-fw-action="${action}"]`); };
const flush = () => page.waitForTimeout(150);
const live = () => text("#orgFwLive");
const setFail = (f) => ev((x) => window.__h.FAKE.failures.push(x), f);

await step("loading state is shown while the list loads, then the EMPTY state with the create control (a11y landmark, no table)", async () => {
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "K", code: "k", status: "active" }); h.FAKE.delays.getDocs = 600; });
  const mounting = ev(() => window.__h.mount({}));
  await page.waitForSelector("#orgCurriculumLoading");
  assert.equal(await page.getAttribute("#orgCurriculumCard", "aria-busy"), "true"); assert.equal(await count("#orgCurriculumLoading [role=status]"), 1);
  await mounting; await waitIdle();
  assert.ok((await text("#orgCurriculumEmpty")).includes("Chưa có khung chương trình"));
  assert.equal(await count("#orgFwCreateBtn:not([disabled])"), 1); assert.equal(await count("section#orgCurriculumCard[aria-labelledby=orgCurriculumTitle]"), 1); assert.equal(await count("table"), 0);
  const c = await calls("getDocs"); assert.equal(c.length, 1); assert.deepEqual(c[0].constraints, ["where:organizationId==orgA", "limit:101"]); assert.equal(c[0].path, "curriculumFrameworks");
  await shot("empty");
});

await step("populated list: grouped Đang áp dụng -> Bản nháp -> Đã lưu trữ, newest first inside groups, summary, row actions per status (no Open without the hook)", async () => {
  await setup({ frameworks: [FW("z-old", "archived", 10), FW("d-old", "draft", 20), FW("a-old", "active", 30), FW("d-new", "draft", 90), FW("a-new", "active", 80)] });
  assert.deepEqual(await rows(), ["a-new:active", "a-old:active", "d-new:draft", "d-old:draft", "z-old:archived"]);
  assert.deepEqual(await groups(), ["Đang áp dụng (2)", "Bản nháp (2)", "Đã lưu trữ (1)"]);
  assert.equal(await text("#orgCurriculumSummary"), "5 khung · 2 đang áp dụng · 2 bản nháp · 1 đã lưu trữ");
  assert.deepEqual(await actionsOf("a-new"), ["rename", "archive"]); assert.deepEqual(await actionsOf("d-new"), ["rename", "activate"]); assert.deepEqual(await actionsOf("z-old"), ["restore"]);
  assert.equal(await count('[data-fw-action="open"]'), 0); assert.equal(await count("[data-fw-action=delete]"), 0);
  assert.equal(await count("[data-fw-id][disabled]"), 0);
  const c = await calls("getDocs"); assert.ok(c.every((x) => !x.constraints.some((k) => /orderBy/.test(k)))); assert.equal(c[0].constraints.length, 2);
  await shot("populated");
});

await step("truncation: 101+ frameworks show exactly 100 and the honest note says '100 khung đầu tiên' (never 'mới nhất')", async () => {
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "K", code: "k", status: "active" }); for (let i = 0; i < 130; i++) h.seedFramework({ id: "f" + String(i).padStart(3, "0"), organizationId: "orgA", name: "Khung " + i, status: "draft", createdAt: h.stamp(100 + i), updatedAt: h.stamp(100 + i) }); });
  await ev(() => window.__h.mount({})); await waitIdle();
  assert.equal(await count("[data-fw-row]"), 100); const note = await text("#orgCurriculumTruncated");
  assert.ok(note.includes("100 khung đầu tiên")); assert.ok(!/mới nhất/i.test(note)); assert.ok((await text("#orgCurriculumSummary")).startsWith("Ít nhất 100 khung"));
  assert.equal((await calls("getDocs"))[0].constraints[1], "limit:101");
});

await step("read failures: network failure -> card error with THỬ LẠI (retry recovers); permission-denied on read is NEVER shown as 'not found'", async () => {
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "K", code: "k", status: "active" }); h.seedFramework({ id: "f1", organizationId: "orgA", name: "Khung 1", status: "draft", createdAt: h.stamp(5), updatedAt: h.stamp(5) }); h.FAKE.failures.push({ op: "read", code: "unavailable" }); });
  await ev(() => window.__h.mount({})); await page.waitForSelector("#orgCurriculumError");
  assert.ok((await text("#orgCurriculumError")).includes("Không thể kết nối máy chủ")); assert.equal(await count("#orgFwCreateBtn"), 1);
  await page.click("#orgCurriculumRetry"); await page.waitForSelector("[data-fw-row]"); assert.deepEqual(await rows(), ["f1:draft"]);
  await ev(() => { window.__h.FAKE.failures.push({ op: "read", code: "permission-denied" }); });
  await page.reload(); await page.waitForFunction(() => window.__ready === true);
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "K", code: "k", status: "active" }); h.FAKE.failures.push({ op: "read", code: "permission-denied" }); });
  await ev(() => window.__h.mount({})); await page.waitForSelector("#orgCurriculumError");
  const msg = await text("#orgCurriculumError"); assert.ok(msg.includes("Không có quyền xem chương trình của đơn vị này.")); assert.ok(!/không tìm thấy/i.test(msg)); assert.equal(await count('#orgCurriculumError[role="alert"]'), 1);
});

await step("create (no confirmation): validation errors never write; success writes ONE exact payload, audits, toasts, announces, moves focus, shows the new draft", async () => {
  await setup({ frameworks: [FW("a1", "active", 30)] });
  await page.click("#orgFwCreateBtn"); await page.waitForSelector("#orgFwName");
  assert.equal(await dialogOpen(), 1); assert.equal(await page.getAttribute('#globalModal [role="dialog"]', "aria-modal"), "true");
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "orgFwName");
  for (const bad of ["", "  ", "ab"]) { await page.fill("#orgFwName", bad); await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwNameErr:not(.hidden)"); assert.equal(await text("#orgFwNameErr"), "Tên khung cần từ 3 đến 120 ký tự."); }
  assert.equal(await page.getAttribute("#orgFwName", "maxlength"), "120");
  assert.equal((await calls("set")).length, 0);
  await page.fill("#orgFwName", "  Chương trình Trung cấp LLCT 2026  "); await page.click("#orgFwSubmit");
  await page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]')); await waitIdle();
  const sets = await calls("set"); assert.equal(sets.length, 1); assert.equal(sets[0].path, "curriculumFrameworks/AUTO001");
  const d = sets[0].data; assert.deepEqual(Object.keys(d).sort(), ["createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
  assert.deepEqual([d.name, d.organizationId, d.scope, d.status, d.createdBy, d.schemaVersion], ["Chương trình Trung cấp LLCT 2026", "orgA", "organization", "draft", "pa1", 1]);
  const a = await audit(); assert.equal(a.length, 1); assert.equal(a[0].action, "curriculum.framework.create"); assert.equal(a[0].entityType, "curriculumFramework"); assert.equal(a[0].entityId, "AUTO001"); assert.deepEqual(a[0].detail, { organizationId: "orgA", name: "Chương trình Trung cấp LLCT 2026" });
  assert.deepEqual(await rows(), ["a1:active", "AUTO001:draft"]); assert.ok((await toasts()).includes("ok:Đã tạo khung chương trình.")); assert.equal(await live(), "Đã tạo khung chương trình.");
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "orgCurriculumTitle");
  assert.ok((await ev(() => document.querySelector('[data-fw-row="AUTO001"]').style.background)).length > 0);   // brief highlight
  assert.equal((await calls("getDocs")).length, 2);   // no optimistic UI: the list was RE-READ
});

await step("create pending-id: uncertain outcome (write applied, response lost) -> inline 'Chưa xác định được kết quả'; retry creates NO duplicate and audits once", async () => {
  await setup({});
  await setFail({ op: "write", code: "unavailable", applied: true });
  await page.click("#orgFwCreateBtn"); await page.fill("#orgFwName", "Khung không trùng"); await page.click("#orgFwSubmit");
  await page.waitForSelector("#orgFwErr:not(.hidden)");
  const msg = await text("#orgFwErr"); assert.ok(msg.includes("Không thể kết nối máy chủ")); assert.ok(msg.includes("Chưa xác định được kết quả")); assert.equal(await dialogOpen(), 1);
  assert.equal((await ev(() => window.__h.list("curriculumFrameworks/").length)), 1);          // it WAS written
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector('#orgFwSubmit')); await waitIdle();
  assert.equal(await ev(() => window.__h.list("curriculumFrameworks/").length), 1);           // still exactly one document
  const sets = await calls("set"); assert.equal(sets.length, 1);                              // the retry found the pending id and did not write again
  assert.equal((await audit()).length, 1); assert.deepEqual(await rows(), ["AUTO001:draft"]);
});
await step("create pending-id: uncertain outcome (write NOT applied) -> the retry reuses the SAME document id and creates it once", async () => {
  await setup({});
  await setFail({ op: "write", code: "deadline-exceeded", applied: false });
  await page.click("#orgFwCreateBtn"); await page.fill("#orgFwName", "Khung thử lại"); await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwErr:not(.hidden)");
  assert.equal(await ev(() => window.__h.list("curriculumFrameworks/").length), 0);
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  const sets = await calls("set"); assert.equal(sets.length, 2); assert.equal(sets[0].path, sets[1].path); assert.equal(sets[1].path, "curriculumFrameworks/AUTO001");
  assert.equal(await ev(() => window.__h.list("curriculumFrameworks/").length), 1); assert.equal((await audit()).length, 1);
  // a NEW modal session gets a NEW id
  await page.click("#orgFwCreateBtn"); await page.fill("#orgFwName", "Khung thứ hai"); await page.click("#orgFwSubmit"); await waitIdle(); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit"));
  assert.equal((await calls("set")).at(-1).path, "curriculumFrameworks/AUTO002");
});
await step("create when the organization was archived after the page loaded: fresh pre-check aborts BEFORE any write, closes the dialog, repaints read-only", async () => {
  await setup({ frameworks: [FW("a1", "active", 30)] });
  await page.click("#orgFwCreateBtn"); await page.fill("#orgFwName", "Khung muộn");
  await ev(() => { const h = window.__h; const o = h.FAKE.store.get("organizations/orgA"); h.FAKE.store.set("organizations/orgA", { ...o, status: "archived" }); });
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgCurriculumArchivedNote"); await waitIdle();
  assert.equal((await calls("set")).length, 0); assert.equal(await dialogOpen(), 0); assert.ok((await toasts()).some((t) => t.startsWith("warn:Đơn vị đã được lưu trữ.")));
  assert.equal(await count("#orgFwCreateBtn[disabled]"), 1); assert.deepEqual(await actionsOf("a1"), []);
});

await step("rename: validation and 'Tên chưa thay đổi' never write; success writes only {name, updatedAt}, audits from/to, keeps the row group", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20), FW("a1", "active", 30)] });
  await clickAction("d1", "rename"); await page.waitForSelector("#orgFwName");
  assert.equal(await page.inputValue("#orgFwName"), "Khung d1");
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwNameErr:not(.hidden)"); assert.equal(await text("#orgFwNameErr"), "Tên chưa thay đổi.");
  await page.fill("#orgFwName", "ab"); await page.click("#orgFwSubmit"); assert.equal(await text("#orgFwNameErr"), "Tên khung cần từ 3 đến 120 ký tự.");
  assert.equal((await calls("update")).length, 0);
  await page.fill("#orgFwName", "  Khung đã đổi tên "); await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  const u = await calls("update"); assert.equal(u.length, 1); assert.equal(u[0].path, "curriculumFrameworks/d1"); assert.deepEqual(Object.keys(u[0].data).sort(), ["name", "updatedAt"]); assert.equal(u[0].data.name, "Khung đã đổi tên");
  assert.deepEqual((await audit()).map((x) => [x.action, x.detail.from, x.detail.to]), [["curriculum.framework.rename", "Khung d1", "Khung đã đổi tên"]]);
  assert.deepEqual(await rows(), ["a1:active", "d1:draft"]); assert.ok((await ev(() => document.querySelector('[data-fw-row="d1"]').textContent)).includes("Khung đã đổi tên"));
});
await step("rename STALE: framework changed elsewhere (status or updatedAt) -> abort, no write, message, reload", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên mới sau cùng");
  await ev(() => { const h = window.__h; h.FAKE.store.set("curriculumFrameworks/d1", { ...h.FAKE.store.get("curriculumFrameworks/d1"), updatedAt: h.stamp(999) }); });
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách.")); assert.equal(await live(), "Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách.");
  await setup({ frameworks: [FW("d2", "draft", 20)] });
  await clickAction("d2", "rename"); await page.fill("#orgFwName", "Tên mới khác");
  await ev(() => { const h = window.__h; h.FAKE.store.set("curriculumFrameworks/d2", { ...h.FAKE.store.get("curriculumFrameworks/d2"), status: "active", activatedAt: h.stamp(5) }); });
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.equal((await calls("update")).length, 0); assert.deepEqual(await rows(), ["d2:active"]);
});
await step("framework NOT FOUND (deleted elsewhere): clear message, list reloads; permission-denied is diagnosed by a safe re-read and is never reported as 'not found'", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20), FW("d2", "draft", 21)] });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên mới ở đây");
  await ev(() => window.__h.FAKE.store.delete("curriculumFrameworks/d1"));
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.ok((await toasts()).some((t) => t.startsWith("err:Không tìm thấy khung"))); assert.deepEqual(await rows(), ["d2:draft"]); assert.equal((await calls("update")).length, 0);
  // permission-denied on WRITE with everything still consistent -> permission message (no state to blame), dialog stays open, NOT 'not found'
  await clickAction("d2", "rename"); await page.fill("#orgFwName", "Tên bị từ chối"); await setFail({ op: "write", code: "permission-denied" });
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwErr:not(.hidden)");
  const denied = await text("#orgFwErr"); assert.ok(denied.startsWith("Không có quyền thực hiện thao tác này.")); assert.ok(!/không tìm thấy/i.test(denied)); assert.equal(await dialogOpen(), 1);
  // permission-denied because the organization got archived in between -> diagnosis says so
  await setFail({ op: "write", code: "permission-denied" });
  await ev(() => { const h = window.__h; h.FAKE.beforeWrite = async () => { h.FAKE.store.set("organizations/orgA", { ...h.FAKE.store.get("organizations/orgA"), status: "archived" }); h.FAKE.beforeWrite = null; }; });
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgCurriculumArchivedNote"); await waitIdle();
  assert.ok((await toasts()).some((t) => t.startsWith("warn:Đơn vị đã được lưu trữ."))); assert.equal(await dialogOpen(), 0);
});
await step("permission-denied diagnosis: framework changed state in between -> 'đã được thay đổi'; framework gone -> 'không tìm thấy khung'; a write 'not-found' error -> missing", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên chẩn đoán"); await setFail({ op: "write", code: "permission-denied" });
  await ev(() => { const h = window.__h; h.FAKE.beforeWrite = async () => { h.FAKE.store.set("curriculumFrameworks/d1", { ...h.FAKE.store.get("curriculumFrameworks/d1"), status: "active", activatedAt: h.stamp(7) }); h.FAKE.beforeWrite = null; }; });
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách."));
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên chẩn đoán 2"); await setFail({ op: "write", code: "permission-denied" });
  await ev(() => { const h = window.__h; h.FAKE.beforeWrite = async () => { h.FAKE.store.delete("curriculumFrameworks/d1"); h.FAKE.beforeWrite = null; }; });
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.ok((await toasts()).some((t) => t.startsWith("err:Không tìm thấy khung")));
});

await step("activate BLOCKED: a draft without an active Môn shows the plain-language reason, the confirm button stays disabled, nothing is written, nothing is auto-fixed", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await clickAction("d1", "activate"); await page.waitForSelector("#orgFwBlocked");
  assert.ok((await text("#orgFwReasons")).includes("Cần ít nhất một Môn đang hoạt động.")); assert.equal(await count("#orgFwConfirm[disabled]"), 1);
  assert.ok((await text('#globalModal [role="dialog"]')).includes("không tự sửa dữ liệu"));
  await page.click("#orgFwConfirm", { force: true, timeout: 1000 }).catch(() => {});
  assert.equal((await calls("update")).length, 0); assert.equal((await calls("set")).length, 0);
  assert.equal(await ev(() => window.__h.list("curriculumFrameworks/d1/nodes/").length), 0);
  await page.click("#orgFwCancel"); await page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'));
  assert.equal(await ev(() => document.activeElement && document.activeElement.dataset.fwAction), "activate");   // focus returns to the trigger
  await shot("activation-blocked");
});
await step("activate READY: readiness comes from P3-S2 on FRESH data; confirm writes the exact lifecycle payload (activatedAt once), audits counts, moves the row to Đang áp dụng", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)], nodes: { d1: [NODE("s1"), NODE("l1", { kind: "lesson", parentId: "s1", ancestors: ["s1"] }), NODE("s2", { order: 1, status: "retired" })] } });
  await clickAction("d1", "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled])");
  assert.equal(await text("#orgFwStats"), "Cây chương trình: 2 nút đang hoạt động / 3 nút"); assert.ok((await text('#globalModal [role="dialog"]')).includes("không thể xóa"));
  const reads = await calls("getDocs"); assert.ok(reads.some((c) => c.path === "curriculumFrameworks/d1/nodes" && c.constraints.join() === "where:organizationId==orgA,limit:5001"));
  await page.click("#orgFwConfirm"); await page.waitForFunction(() => !document.querySelector("#orgFwConfirm")); await waitIdle();
  const u = await calls("update"); assert.equal(u.length, 1); assert.deepEqual(Object.keys(u[0].data).sort(), ["activatedAt", "status", "statusChangedAt", "statusChangedBy", "updatedAt"]); assert.equal(u[0].data.status, "active"); assert.equal(u[0].data.statusChangedBy, "pa1");
  assert.deepEqual((await audit()).map((x) => [x.action, x.detail.nodeCount, x.detail.activeCount]), [["curriculum.framework.activate", 3, 2]]);
  assert.deepEqual(await rows(), ["d1:active"]); assert.deepEqual(await groups(), ["Đang áp dụng (1)"]); assert.ok((await toasts()).includes("ok:Đã kích hoạt khung."));
  assert.deepEqual(await actionsOf("d1"), ["rename", "archive"]);
});
await step("activate races: tree broken between the check and the confirm -> dialog switches to BLOCKED (no write); status changed elsewhere -> abort; tree too large -> blocked without truncated validation", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)], nodes: { d1: [NODE("s1")] } });
  await clickAction("d1", "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled])");
  await ev(() => { const h = window.__h; h.seedNode("d1", { id: "dup", schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Trùng thứ tự", status: "active" }); });
  await page.click("#orgFwConfirm"); await page.waitForSelector("#orgFwBlocked"); assert.ok((await text("#orgFwReasons")).includes("Có hai nút cùng thứ tự trong một cấp.")); assert.equal((await calls("update")).length, 0);
  await setup({ frameworks: [FW("d1", "draft", 20)], nodes: { d1: [NODE("s1")] } });
  await clickAction("d1", "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled])");
  await ev(() => { const h = window.__h; h.FAKE.store.set("curriculumFrameworks/d1", { ...h.FAKE.store.get("curriculumFrameworks/d1"), status: "active", activatedAt: h.stamp(9) }); });
  await page.click("#orgFwConfirm"); await page.waitForFunction(() => !document.querySelector("#orgFwConfirm")); await waitIdle();
  assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách."));
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "K", code: "k", status: "active" }); h.seedFramework({ id: "big", organizationId: "orgA", name: "Khung lớn", status: "draft", createdAt: h.stamp(5), updatedAt: h.stamp(5) }); for (let i = 0; i < 5001; i++) h.seedNode("big", { id: "n" + String(i).padStart(4, "0"), schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: i, code: null, name: "N", status: "active" }); });
  await ev(() => window.__h.mount({})); await waitIdle(); await clickAction("big", "activate"); await page.waitForSelector("#orgFwBlocked");
  assert.ok((await text("#orgFwBlocked")).includes("Khung quá lớn để kiểm tra")); assert.equal(await count("#orgFwConfirm[disabled]"), 1); assert.equal((await calls("update")).length, 0);
});
await step("activate when the organization is archived: the dialog never reaches a write (archived banner after the fresh read)", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)], nodes: { d1: [NODE("s1")] } });
  await ev(() => { const h = window.__h; h.FAKE.store.set("organizations/orgA", { ...h.FAKE.store.get("organizations/orgA"), status: "archived" }); });
  await clickAction("d1", "activate"); await page.waitForSelector("#orgCurriculumArchivedNote"); await waitIdle();
  assert.equal((await calls("update")).length, 0); assert.equal(await dialogOpen(), 0);
});

await step("archive (confirmation with consequence) and restore (light confirmation): exact lifecycle payloads, activatedAt untouched, group changes, audits; stale status aborts", async () => {
  await setup({ frameworks: [FW("a1", "active", 30)] });
  await clickAction("a1", "archive"); await page.waitForSelector("#orgFwConfirm");
  const t = await text('#globalModal [role="dialog"]'); assert.ok(t.includes("Lưu trữ khung?") && t.includes("không sửa được") && t.includes("khôi phục bất cứ lúc nào"));
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "orgFwCancel");                 // destructive confirmation focuses the safe button
  await page.click("#orgFwConfirm"); await page.waitForFunction(() => !document.querySelector("#orgFwConfirm")); await waitIdle();
  let u = await calls("update"); assert.deepEqual(Object.keys(u[0].data).sort(), ["status", "statusChangedAt", "statusChangedBy", "updatedAt"]); assert.equal(u[0].data.status, "archived");
  assert.deepEqual(await rows(), ["a1:archived"]); assert.deepEqual(await actionsOf("a1"), ["restore"]); assert.equal(await doc("curriculumFrameworks/a1").then((d) => d.activatedAt.seconds), 31);
  await clickAction("a1", "restore"); await page.waitForSelector("#orgFwConfirm"); assert.ok((await text('#globalModal [role="dialog"]')).includes("Khôi phục khung?"));
  await page.click("#orgFwConfirm"); await page.waitForFunction(() => !document.querySelector("#orgFwConfirm")); await waitIdle();
  u = await calls("update"); assert.equal(u[1].data.status, "active"); assert.ok(!("activatedAt" in u[1].data)); assert.deepEqual(await rows(), ["a1:active"]); assert.equal(await doc("curriculumFrameworks/a1").then((d) => d.activatedAt.seconds), 31);
  assert.deepEqual((await audit()).map((x) => x.action), ["curriculum.framework.archive", "curriculum.framework.restore"]); assert.deepEqual((await toasts()).filter((x) => x.startsWith("ok")), ["ok:Đã lưu trữ khung.", "ok:Đã khôi phục khung."]);
  await setup({ frameworks: [FW("a2", "active", 30)] });
  await clickAction("a2", "archive"); await page.waitForSelector("#orgFwConfirm");
  await ev(() => { const h = window.__h; h.FAKE.store.set("curriculumFrameworks/a2", { ...h.FAKE.store.get("curriculumFrameworks/a2"), status: "archived" }); });
  await page.click("#orgFwConfirm"); await page.waitForFunction(() => !document.querySelector("#orgFwConfirm")); await waitIdle();
  assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách."));
});

await step("archived ORGANIZATION: curriculum stays readable, create disabled with a visible reason, NO row mutation control exists, nothing can attempt a write", async () => {
  await setup({ org: ORG("archived"), frameworks: [FW("a1", "active", 30), FW("d1", "draft", 20), FW("z1", "archived", 10)] });
  assert.equal(await count("#orgCurriculumArchivedNote"), 1); assert.equal(await count("#orgFwCreateBtn[disabled]"), 1); assert.ok((await text("#orgFwCreateHint")).includes("Đơn vị đã lưu trữ"));
  assert.deepEqual(await rows(), ["a1:active", "d1:draft", "z1:archived"]); assert.equal(await count("[data-fw-action]"), 0);
  await page.click("#orgFwCreateBtn", { force: true, timeout: 800 }).catch(() => {});
  assert.equal(await dialogOpen(), 0); assert.equal((await calls("set")).length + (await calls("update")).length, 0);
  assert.equal(await count("#orgCurriculumArchivedNote"), 1);
  await shot("archived-org");
  await setup({ org: ORG("archived"), frameworks: [FW("a1", "active", 30)], canOpen: true });
  assert.deepEqual(await actionsOf("a1"), ["open"]); assert.ok((await text('[data-fw-action="open"]')).includes("MỞ (CHỈ XEM)"));
  await setup({ org: ORG("archived") }); assert.ok((await text("#orgCurriculumEmpty")).includes("Đơn vị đã lưu trữ: chưa có khung chương trình nào để xem."));
});

await step("MỞ integration boundary: no button without the hook; with the hook the click calls onOpenFramework(framework, organization) and performs NO read or write", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20), FW("a1", "active", 30)], canOpen: false });
  assert.equal(await count('[data-fw-action="open"]'), 0); assert.ok(!(await text("#orgCurriculumCard")).includes("Sắp có"));
  await setup({ frameworks: [FW("d1", "draft", 20), FW("a1", "active", 30), FW("z1", "archived", 10)], canOpen: true });
  assert.deepEqual(await actionsOf("a1"), ["open", "rename", "archive"]); assert.deepEqual(await actionsOf("z1"), ["open", "restore"]);
  const before = (await ev(() => window.__h.FAKE.calls.length));
  await clickAction("d1", "open"); await flush();
  assert.deepEqual(await ev(() => window.__hook), [{ frameworkId: "d1", organizationId: "orgA", status: "draft" }]); assert.equal(await ev(() => window.__h.FAKE.calls.length), before);
  assert.equal(await dialogOpen(), 0);
});

await step("busy guard: a slow write cannot be double-submitted; every other control is disabled meanwhile and the submit label shows the progress", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await ev(() => { window.__h.FAKE.delays.write = 700; });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên chậm một chút");
  await page.dblclick("#orgFwSubmit"); await page.waitForTimeout(250);
  assert.equal(await text("#orgFwSubmit"), "ĐANG XỬ LÝ…"); assert.equal(await count("#orgFwCancel[disabled]"), 1); assert.equal(await count("#orgCurriculumCard button:not([disabled])"), 0);
  assert.equal(await page.getAttribute("#orgCurriculumCard", "aria-busy"), "true");
  await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  assert.equal((await calls("update")).length, 1); assert.equal((await audit()).length, 1);
});

await step("dialog accessibility: focus moves into the dialog, Escape closes it and returns focus to the trigger, Cancel closes, backdrop works, Escape is ignored while busy", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)] });
  await clickAction("d1", "rename"); await page.waitForSelector("#orgFwName");
  assert.equal(await ev(() => document.activeElement.id), "orgFwName"); assert.equal(await count('[role=dialog][aria-labelledby=orgFwDialogTitle]'), 1);
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'));
  assert.equal(await ev(() => document.activeElement && document.activeElement.dataset.fwAction), "rename");
  await page.click("#orgFwCreateBtn"); await page.waitForSelector("#orgFwName"); await page.click("#orgFwCancel"); await page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'));
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "orgFwCreateBtn");
  await ev(() => { window.__h.FAKE.delays.write = 600; });
  await clickAction("d1", "rename"); await page.fill("#orgFwName", "Tên đang xử lý"); await page.click("#orgFwSubmit"); await page.waitForTimeout(150); await page.keyboard.press("Escape");
  assert.equal(await dialogOpen(), 1); await page.waitForFunction(() => !document.querySelector("#orgFwSubmit")); await waitIdle();
  await clickAction("d1", "activate"); await page.waitForSelector("#orgFwBlocked"); await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'));   // Escape still works after the dialog re-rendered
});

await step("non-admin mounts nothing; no console or page errors in the whole run", async () => {
  await setup({ frameworks: [FW("d1", "draft", 20)], isAdmin: false });
  assert.equal(await ev(() => document.getElementById("host").innerHTML.trim()), ""); assert.equal((await calls("getDocs")).length, 0);
  assert.deepEqual(errors, []);
});

await step("responsive: no horizontal overflow at 375 / 768 / 1280 with very long names; tap targets >= 44px on actions; section reads in one column on phones", async () => {
  const longName = "Chương trình đào tạo rất dài không có khoảng trắng " + "A".repeat(80);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await setup({ frameworks: [FW("d1", "draft", 20, { name: longName }), FW("a1", "active", 30, { name: longName + "2" })] });
    const overflow = await ev(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 1, "overflow at " + width + ": " + overflow);
    const small = await ev(() => [...document.querySelectorAll("#orgCurriculumCard button")].filter((b) => b.getBoundingClientRect().height < 43).length); assert.equal(small, 0, "tap targets at " + width);
    await shot("width-" + width);
  }
  await page.setViewportSize({ width: 1100, height: 900 });
});

console.log("ALL PASS " + results.length + "/" + results.length);
await browser.close(); server.close();
