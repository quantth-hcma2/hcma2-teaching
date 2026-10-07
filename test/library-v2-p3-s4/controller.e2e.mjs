// LIBRARY V2 P3-S4 - node EDITOR controller state machine in a REAL browser (headless Edge) against an in-memory fake Firestore with batch support (editor-harness.html).
// No emulator, no production, no network. Provokes every state/race/failure of the approved mini-spec deterministically. Real P3-S2 modules + real S3 section + real editor.
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p3-s4/controller.e2e.mjs   (optional P3S4_SHOTS=<dir>)
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
await page.goto(`${base}/test/library-v2-p3-s4/editor-harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P3S4_SHOTS) await page.screenshot({ path: path.join(process.env.P3S4_SHOTS, "ed-" + name + ".png") }); };

// ---- fixtures and helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const ORG = (status = "active") => ({ id: "orgA", name: "Khoa Quản trị", code: "khoa", status, createdAt: { seconds: 5 } });
const FW = (id, status = "draft", extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", scope: "organization", name: "Khung " + id, status, createdAt: { seconds: 50, nanoseconds: 0 }, createdBy: "pa1", updatedAt: { seconds: 50, nanoseconds: 0 }, ...(status === "draft" ? {} : { activatedAt: { seconds: 51, nanoseconds: 0 }, statusChangedAt: { seconds: 51, nanoseconds: 0 }, statusChangedBy: "pa1" }), ...extra });
let stampSeed = 100;
const NODE = (id, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn " + id, status: "active", createdAt: { seconds: 1 }, updatedAt: { seconds: ++stampSeed }, ...extra });
const LESSON = (id, parent, order, extra = {}) => NODE(id, { kind: "lesson", parentId: parent, ancestors: [parent], order, name: "Bài " + id, ...extra });
async function setup({ org = ORG(), framework = FW("fw1"), nodes = [], extraFrameworks = [], mode = "editor" } = {}) {
  await ev(({ org, framework, nodes, extraFrameworks }) => { const h = window.__h; h.reset(); h.seedOrg(org); h.seedFramework(framework); extraFrameworks.forEach((f) => h.seedFramework(f)); nodes.forEach((n) => h.seedNode(framework.id, n)); }, { org, framework, nodes, extraFrameworks });
  if (mode === "editor") { await ev(() => window.__h.mountEditor({})); await settled(); }
}
const text = (sel) => ev((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const count = (sel) => page.locator(sel).count();
const calls = (op) => ev((o) => window.__h.FAKE.calls.filter((c) => c.op === o), op);
const audit = () => ev(() => window.__h.FAKE.audit);
const doc = (p) => ev((x) => window.__h.get(x), p);
const toasts = () => ev(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.className.replace("toast", "").trim() + ":" + t.textContent));
const settled = () => page.waitForFunction(() => { const b = document.querySelector("#edBody"); return b && b.getAttribute("aria-busy") === "false" && !document.querySelector("#edLoading"); }, null, { timeout: 15000 });
const dialogCount = () => count('#globalModal [role="dialog"]');
const closed = () => page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'));
const live = () => text("#edLive");
const activeId = () => ev(() => { const a = document.activeElement; return a ? (a.id || a.dataset.edAction + ":" + (a.dataset.nodeId || "") || a.tagName) : null; });
const focusInfo = () => ev(() => { const a = document.activeElement; return a ? { id: a.id || "", action: a.dataset.edAction || "", node: a.dataset.nodeId || "", name: a.hasAttribute("data-node-name"), row: a.closest("[data-node-row]") ? a.closest("[data-node-row]").dataset.nodeRow : "" } : null; });
const NODE_PREFIX = "curriculumFrameworks/fw1/nodes/";
const rowIds = () => ev(() => [...document.querySelectorAll("[data-node-row]")].map((r) => r.dataset.nodeRow));
const rowFlags = () => ev(() => Object.fromEntries([...document.querySelectorAll("[data-node-row]")].map((r) => [r.dataset.nodeRow, r.dataset.nodeStatus + "/" + r.dataset.nodeKind + "/d" + r.dataset.nodeDepth])));
const btn = (action, id) => `[data-ed-action="${action}"][data-node-id="${id}"]`;
const setFail = (f) => ev((x) => window.__h.FAKE.failures.push(x), f);
const nodeDoc = (id) => doc(NODE_PREFIX + id);
const submitCreate = async (name, code = "", more = false) => { await page.fill("#edName", name); await page.fill("#edCode", code); await page.click(more ? "#edSubmitMore" : "#edSubmit"); };

await step("S3 -> editor seam: MỞ comes from the options hook, the editor replaces the detail, reads Organization + framework + tree (no write), and 'Quay lại đơn vị' returns with focus on the framework's MỞ and a fresh re-read", async () => {
  await setup({ framework: FW("fw1", "draft"), nodes: [NODE("s1", { name: "Triết học" })], mode: "flow" });
  await ev(() => window.__h.mountFlow({})); await page.waitForSelector("[data-fw-row]");
  assert.equal(await count('[data-fw-action="open"]'), 1);
  const beforeReads = (await calls("getDocs")).length;
  await page.click('[data-fw-action="open"]'); await page.waitForSelector("#edTitle"); await settled();
  assert.deepEqual(await ev(() => window.__flow.filter((f) => f.event === "open")), [{ event: "open", frameworkId: "fw1", organizationId: "orgA" }]);
  assert.equal(await count("#orgDetailStub"), 0, "the editor REPLACED the detail");
  assert.equal(await text("#edTitle"), "Khung fw1"); assert.ok((await text("#edHeader")).includes("Khoa Quản trị")); assert.equal(await text("#edFwBadge"), "📝 Bản nháp");
  assert.equal((await calls("set")).length + (await calls("update")).length + (await calls("batch")).length, 0, "opening writes nothing");
  const reads = (await calls("getDocs")).slice(beforeReads), orgReads = await calls("org");
  assert.deepEqual(reads.map((r) => r.path + "|" + r.constraints.join(",")), ["curriculumFrameworks/fw1/nodes|where:organizationId==orgA,limit:5001"]);
  assert.ok(orgReads.length >= 1, "the Organization is re-read on entry");
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "edTitle");
  await page.click("#edBack"); await page.waitForSelector("[data-fw-row]"); await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.fwAction === "open");
  assert.deepEqual(await ev(() => window.__flow.at(-1)), { event: "detail", focusFrameworkId: "fw1" });
  assert.equal(await ev(() => document.activeElement.dataset.fwId), "fw1");
  assert.ok((await calls("getDocs")).filter((c) => c.path === "curriculumFrameworks").length >= 2, "the list was re-read on return");
  await shot("seam");
});

await step("non-admin mounts nothing and reads nothing; a missing container never throws", async () => {
  await setup({ mode: "none" });
  await ev(() => window.__h.mountEditor({ isAdmin: false }));
  assert.equal(await ev(() => document.getElementById("host").innerHTML.trim()), ""); assert.equal((await calls("getDocs")).length + (await calls("org")).length, 0);
});

await step("loading -> EMPTY tree: framework header, status badge, draft readiness blocked (needs an active Môn), create CTA, zero indexes (equality + limit only)", async () => {
  await ev(() => { const h = window.__h; h.reset(); h.seedOrg({ id: "orgA", name: "Khoa Quản trị", status: "active" }); h.seedFramework({ id: "fw1", organizationId: "orgA", name: "Khung fw1", status: "draft", createdAt: h.stamp(50), updatedAt: h.stamp(50) }); h.FAKE.delays.getDocs = 500; });
  await ev(() => window.__h.mountEditor({}));
  await page.waitForSelector("#edLoading"); assert.equal(await page.getAttribute("#edBody", "aria-busy"), "true"); assert.equal(await count("#edLoading [role=status]"), 1);
  await settled(); await ev(() => { window.__h.FAKE.delays = {}; });
  assert.ok((await text("#edEmpty")).includes("Khung chưa có Môn nào")); assert.equal(await count("#edEmptyAdd"), 1); assert.equal(await count("#edAddSubject:not([disabled])"), 1);
  assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "blocked"); assert.equal(await count('#edReadiness [data-reason="NO_ACTIVE_SUBJECT"]'), 1);
  assert.equal(await text("#edSummary"), "0 Môn · 0 Bài"); assert.equal(await count("table"), 0); assert.equal(await count("#edToggleAll"), 0);
  assert.ok((await calls("getDocs")).every((c) => !c.constraints.some((k) => /orderBy/.test(k))));
  await shot("empty");
});

await step("create Môn: validation never writes; success writes ONE exact payload (root, order 0), audits, announces, focuses the new row, readiness turns ready", async () => {
  await setup({});
  await page.click("#edEmptyAdd"); await page.waitForSelector("#edName");
  assert.equal(await dialogCount(), 1); assert.equal(await page.getAttribute('#globalModal [role="dialog"]', "aria-modal"), "true"); assert.equal(await text("#edDialogTitle"), "Thêm Môn");
  assert.equal(await ev(() => document.activeElement && document.activeElement.id), "edName");
  for (const bad of ["", "   "]) { await submitCreate(bad); await page.waitForSelector("#edNameErr:not(.hidden)"); assert.equal(await text("#edNameErr"), "Tên cần từ 1 đến 200 ký tự."); }
  await page.fill("#edName", "x".repeat(201)); assert.equal((await page.inputValue("#edName")).length, 200, "maxlength 200");
  await page.fill("#edName", "Môn hợp lệ"); await page.fill("#edCode", "c".repeat(41)); await page.click("#edSubmit"); await page.waitForSelector("#edCodeErr:not(.hidden)"); assert.equal(await text("#edCodeErr"), "Mã tối đa 40 ký tự.");
  assert.equal((await calls("set")).length, 0);
  await submitCreate("  Triết học Mác - Lênin  ", "  tri-01 "); await closed(); await settled();
  const sets = await calls("set"); assert.equal(sets.length, 1); assert.equal(sets[0].path, NODE_PREFIX + "AUTO001");
  const d = sets[0].data; assert.deepEqual(Object.keys(d).sort(), ["ancestors", "code", "createdAt", "kind", "name", "order", "organizationId", "parentId", "schemaVersion", "status", "updatedAt"]);
  assert.deepEqual([d.kind, d.parentId, d.ancestors, d.order, d.code, d.name, d.status, d.organizationId, d.schemaVersion], ["subject", null, [], 0, "tri-01", "Triết học Mác - Lênin", "active", "orgA", 1]);
  const a = await audit(); assert.equal(a.length, 1); assert.deepEqual([a[0].action, a[0].entityType, a[0].entityId], ["curriculum.node.add", "curriculumFramework", "fw1"]); assert.deepEqual(a[0].detail, { organizationId: "orgA", nodeId: "AUTO001", kind: "subject", name: "Triết học Mác - Lênin", code: "tri-01" });
  assert.deepEqual(await rowIds(), ["AUTO001"]); assert.ok((await toasts()).includes("ok:Đã thêm Môn: Triết học Mác - Lênin.")); assert.equal(await live(), "Đã thêm Môn: Triết học Mác - Lênin.");
  assert.deepEqual(await focusInfo(), { id: "", action: "", node: "", name: true, row: "AUTO001" });
  assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready"); assert.equal(await text("#edSummary"), "1 Môn · 0 Bài");
  assert.equal(await count("#edEmpty"), 0);
  // order = end of the siblings
  await page.click("#edAddSubject"); await submitCreate("Môn thứ hai"); await closed(); await settled();
  assert.equal((await nodeDoc("AUTO002")).order, 1); assert.equal((await nodeDoc("AUTO002")).code, null);
  await shot("created");
});

await step("create Bài under a Môn: exact payload (kind lesson, parentId, ancestors, next order); the new row is focused and its Môn stays expanded; Bài rows offer no add-child", async () => {
  await setup({ nodes: [NODE("s1", { name: "Triết học" }), LESSON("l1", "s1", 0), LESSON("l2", "s1", 5)] });
  await page.click(btn("add-child", "s1")); await page.waitForSelector("#edName");
  assert.equal(await text("#edDialogTitle"), "Thêm Bài vào Triết học");
  await submitCreate("Bài mới", "B-9"); await closed(); await settled();
  const set = (await calls("set"))[0]; assert.equal(set.path, NODE_PREFIX + "AUTO001");
  assert.deepEqual([set.data.kind, set.data.parentId, set.data.ancestors, set.data.order, set.data.code], ["lesson", "s1", ["s1"], 6, "B-9"]);
  assert.deepEqual(await rowIds(), ["s1", "l1", "l2", "AUTO001"]);
  assert.deepEqual(await focusInfo(), { id: "", action: "", node: "", name: true, row: "AUTO001" });
  assert.equal(await count('[data-node-row="AUTO001"] [data-ed-action="add-child"]'), 0); assert.equal(await count('[data-node-row="l1"] [data-ed-action="add-child"]'), 0);
  assert.equal(await text('[data-node-row="s1"] .small.mut'), "Môn · 3 nút con");
  assert.equal((await audit()).at(-1).detail.kind, "lesson");
  await shot("lesson");
});

await step("add-and-continue: each node is individually validated and committed; the dialog stays open, fields reset, focus returns to the name field, a new id per node; failures preserve the entered values", async () => {
  await setup({ nodes: [NODE("s1", { name: "Triết học" })] });
  await page.click(btn("add-child", "s1")); await page.waitForSelector("#edName");
  await submitCreate("Bài 1", "b1", true); await page.waitForFunction(() => document.querySelector("#edInfo") && !document.querySelector("#edInfo").classList.contains("hidden")); await settled();
  assert.equal(await dialogCount(), 1); assert.equal(await page.inputValue("#edName"), ""); assert.equal(await page.inputValue("#edCode"), ""); assert.equal(await ev(() => document.activeElement.id), "edName");
  assert.ok((await text("#edInfo")).includes("Đã thêm Bài: Bài 1.")); assert.ok((await toasts()).includes("ok:Đã thêm Bài: Bài 1."));
  assert.deepEqual(await rowIds(), ["s1", "AUTO001"], "the tree behind the dialog is already refreshed");
  await page.click("#edName", { force: true });
  // a failure keeps what the admin typed and writes nothing new
  await setFail({ op: "write", code: "unavailable", applied: false });
  await submitCreate("Bài 2", "b2", true); await page.waitForSelector("#edErr:not(.hidden)");
  assert.equal(await page.inputValue("#edName"), "Bài 2"); assert.equal(await page.inputValue("#edCode"), "b2"); assert.ok((await text("#edErr")).includes("Chưa xác định được kết quả"));
  assert.equal((await ev(() => window.__h.list("curriculumFrameworks/fw1/nodes/").length)), 2);
  // the retry reuses the SAME pending id (no duplicate), then continues with a NEW id
  await page.click("#edSubmitMore"); await page.waitForFunction(() => document.querySelector("#edInfo") && document.querySelector("#edInfo").textContent.includes("Bài 2")); await settled();
  const sets = await calls("set"); assert.deepEqual(sets.map((s) => s.path), [NODE_PREFIX + "AUTO001", NODE_PREFIX + "AUTO002", NODE_PREFIX + "AUTO002"]);
  assert.deepEqual((await ev(() => window.__h.list("curriculumFrameworks/fw1/nodes/"))).length, 3);
  assert.equal(await page.inputValue("#edName"), "");
  await submitCreate("Bài 3", "", true); await page.waitForFunction(() => document.querySelector("#edInfo").textContent.includes("Bài 3")); await settled();
  assert.equal((await calls("set")).at(-1).path, NODE_PREFIX + "AUTO003"); assert.deepEqual([(await nodeDoc("AUTO001")).order, (await nodeDoc("AUTO002")).order, (await nodeDoc("AUTO003")).order], [0, 1, 2]);
  assert.deepEqual((await audit()).filter((x) => x.action === "curriculum.node.add").map((x) => x.detail.name), ["Bài 1", "Bài 2", "Bài 3"]);
  // closing with the primary button after the last continue returns focus to the opener (the + Thêm Bài of the Môn)
  await page.click("#edCancel"); await closed();
  assert.equal(await ev(() => document.activeElement.dataset.edAction + ":" + document.activeElement.dataset.nodeId), "add-child:s1");
  await shot("continue");
});

await step("canonical duplicate codes: case, whitespace, Unicode (NFD vs NFC) and full-width variants are refused with a message NAMING the other node (retired ones too); nothing is written", async () => {
  const nfc = "Toán", nfd = "Toán";
  await setup({ nodes: [NODE("s1", { name: "Môn A", code: "TOAN-1" }), LESSON("l1", "s1", 0, { name: "Bài Toán", code: nfc }), LESSON("l2", "s1", 1, { name: "Bài cũ", code: "OLD", status: "retired" }), NODE("s2", { name: "Môn B", order: 1 })] });
  const attempt = async (code) => { await page.click("#edAddSubject"); await page.waitForSelector("#edName"); await submitCreate("Môn mới", code); await page.waitForSelector("#edCodeErr:not(.hidden)"); const msg = await text("#edCodeErr"); await page.click("#edCancel"); await closed(); return msg; };
  assert.ok((await attempt("toan-1")).includes("“toan-1” đã được dùng bởi “Môn A”")); assert.ok((await attempt("  TOAN-1  ")).includes("“Môn A”"));
  assert.ok((await attempt(nfd)).includes("“Bài Toán”")); assert.ok((await attempt("ＴＯＡＮ-１")).includes("“Môn A”"), "full-width equals ASCII");
  const retiredMsg = await attempt("old"); assert.ok(retiredMsg.includes("“Bài cũ” (đã ngừng sử dụng)")); assert.ok(retiredMsg.includes("sửa mã của nút đó"));
  assert.equal((await calls("set")).length, 0);
  assert.equal(await ev(() => document.activeElement.id), "edAddSubject");
  // a different code is accepted
  await page.click("#edAddSubject"); await submitCreate("Môn mới", "TOAN-2"); await closed(); await settled(); assert.equal((await calls("set")).length, 1);
  // creating a Bài with the Môn's code conflicts too (policy is framework-wide)
  await page.click(btn("add-child", "s2")); await submitCreate("Bài dup", "toan-2"); await page.waitForSelector("#edCodeErr:not(.hidden)"); assert.ok((await text("#edCodeErr")).includes("“Môn mới”")); await page.click("#edCancel"); await closed();
  assert.equal((await calls("set")).length, 1);
  await shot("dup-code");
});

const openEdit = async (id) => { await page.click(btn("edit", id)); await page.waitForSelector("#edName"); };
const changed = (id) => ev((p) => window.__h.get(p), NODE_PREFIX + id);

await step("edit name/code: prefilled dialog, 'no change' never writes, ONLY changed fields are sent, cleared code = null, self-exclusion (same code in another case), audit curriculum.node.update with from/to", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A", code: "A1" }), NODE("s2", { name: "Môn B", code: "B1", order: 1 })] });
  await openEdit("s1");
  assert.equal(await text("#edDialogTitle"), "Sửa Môn"); assert.equal(await page.inputValue("#edName"), "Môn A"); assert.equal(await page.inputValue("#edCode"), "A1"); assert.equal(await count("#edSubmitMore"), 0);
  assert.equal(await ev(() => document.activeElement.id), "edName");
  await page.click("#edSubmit"); await page.waitForSelector("#edErr:not(.hidden)"); assert.equal(await text("#edErr"), "Chưa có thay đổi nào để lưu."); assert.equal((await calls("update")).length, 0);
  await page.fill("#edName", "  Môn A (đổi tên) "); await page.click("#edSubmit"); await closed(); await settled();
  let up = await calls("update"); assert.equal(up.length, 1); assert.equal(up[0].path, NODE_PREFIX + "s1"); assert.deepEqual(Object.keys(up[0].data).sort(), ["name", "updatedAt"]); assert.equal(up[0].data.name, "Môn A (đổi tên)");
  assert.equal((await nodeDoc("s1")).code, "A1"); assert.deepEqual(await focusInfo(), { id: "", action: "", node: "", name: true, row: "s1" });
  let a = (await audit()).at(-1); assert.equal(a.action, "curriculum.node.update"); assert.deepEqual(a.detail, { organizationId: "orgA", nodeId: "s1", kind: "subject", from: { name: "Môn A", code: "A1" }, to: { name: "Môn A (đổi tên)", code: "A1" } });
  assert.equal(await live(), "Đã lưu Môn.");
  // code only, same canonical code in another case: self-exclusion lets it save
  await openEdit("s1"); await page.fill("#edCode", "a1"); await page.click("#edSubmit"); await closed(); await settled();
  up = await calls("update"); assert.deepEqual(Object.keys(up[1].data).sort(), ["code", "updatedAt"]); assert.equal((await nodeDoc("s1")).code, "a1");
  // clearing the code
  await openEdit("s1"); await page.fill("#edCode", "   "); await page.click("#edSubmit"); await closed(); await settled();
  assert.equal((await nodeDoc("s1")).code, null); assert.equal((await calls("update"))[2].data.code, null);
  // both fields; and a conflict with ANOTHER node is refused before any write
  await openEdit("s1"); await page.fill("#edCode", "b1"); await page.click("#edSubmit"); await page.waitForSelector("#edCodeErr:not(.hidden)");
  assert.ok((await text("#edCodeErr")).includes("“Môn B”")); assert.equal((await calls("update")).length, 3); assert.equal(await dialogCount(), 1);
  await page.fill("#edName", "Môn A mới"); await page.fill("#edCode", "A9"); await page.click("#edSubmit"); await closed(); await settled();
  up = await calls("update"); assert.deepEqual(Object.keys(up[3].data).sort(), ["code", "name", "updatedAt"]);
  assert.equal((await audit()).filter((x) => x.action === "curriculum.node.update").length, 4);
  // validation of the name
  await openEdit("s2"); await page.fill("#edName", ""); await page.click("#edSubmit"); await page.waitForSelector("#edNameErr:not(.hidden)"); assert.equal(await text("#edNameErr"), "Tên cần từ 1 đến 200 ký tự."); await page.click("#edCancel"); await closed();
  assert.equal((await calls("update")).length, 4);
});

await step("retired nodes stay editable and keep their codes RESERVED until edited: editing the retired node frees the code for a new node", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" }), LESSON("l1", "s1", 0, { name: "Bài cũ", code: "L-OLD", status: "retired" })] });
  await page.click(btn("add-child", "s1")); await submitCreate("Bài thay thế", "l-old"); await page.waitForSelector("#edCodeErr:not(.hidden)"); assert.ok((await text("#edCodeErr")).includes("(đã ngừng sử dụng)"));
  await page.click("#edCancel"); await closed();
  await openEdit("l1"); assert.equal(await text("#edDialogTitle"), "Sửa Bài"); await page.fill("#edCode", "L-OLD-RETIRED"); await page.click("#edSubmit"); await closed(); await settled();
  assert.equal((await nodeDoc("l1")).code, "L-OLD-RETIRED"); assert.equal((await nodeDoc("l1")).status, "retired");
  await page.click(btn("add-child", "s1")); await submitCreate("Bài thay thế", "l-old"); await closed(); await settled();
  assert.equal((await nodeDoc((await calls("set")).at(-1).path.split("/").pop())).code, "l-old");
});

await step("retire is PER NODE: confirmation says it is NOT a delete, Cancel writes nothing, confirm retires only that node (children untouched, shown as 'thuộc nút đã ngừng sử dụng'), audit, focus lands on KHÔI PHỤC", async () => {
  await setup({ nodes: [NODE("s1", { name: "Triết học", code: "TH" }), LESSON("l1", "s1", 0), LESSON("l2", "s1", 1, { status: "retired" }), NODE("s2", { order: 1 })] });
  const childBefore = await nodeDoc("l1");
  await page.click(btn("retire", "s1")); await page.waitForSelector("#edConfirm");
  assert.equal(await text("#edDialogTitle"), "Ngừng sử dụng Môn?"); const copy = await text('#globalModal [role="dialog"]'); assert.ok(copy.includes("không phải là xóa")); assert.ok(copy.includes("Các nút con giữ nguyên")); assert.ok(!copy.includes("có hiệu lực ngay"));
  assert.equal(await ev(() => document.activeElement.id), "edCancel", "safe default focus");
  await page.click("#edCancel"); await closed(); assert.equal((await calls("update")).length, 0); assert.equal(await ev(() => document.activeElement.dataset.edAction + ":" + document.activeElement.dataset.nodeId), "retire:s1");
  await page.click(btn("retire", "s1")); await page.click("#edConfirm"); await closed(); await settled();
  const up = await calls("update"); assert.equal(up.length, 1); assert.equal(up[0].path, NODE_PREFIX + "s1"); assert.deepEqual(Object.keys(up[0].data).sort(), ["status", "updatedAt"]); assert.equal(up[0].data.status, "retired");
  assert.equal((await calls("batch")).length, 0, "no cascade: exactly one document is written");
  assert.deepEqual(await nodeDoc("l1"), childBefore); assert.equal((await nodeDoc("l1")).status, "active");
  const flags = await rowFlags(); assert.equal(flags.s1, "retired/subject/d1"); assert.equal(flags.l1, "active/lesson/d2");
  assert.equal(await text('[data-node-row="l1"] [data-note="parent-retired"]'), "thuộc nút đã ngừng sử dụng"); assert.equal(await count('[data-node-row="l2"] [data-note]'), 0);
  assert.equal(await text("#edSummary"), "1 Môn · 1 Bài · 2 ngừng sử dụng");
  assert.deepEqual(await focusInfo(), { id: "", action: "restore", node: "s1", name: false, row: "s1" });
  const a = (await audit()).at(-1); assert.deepEqual([a.action, a.entityType, a.entityId, a.detail.nodeId, a.detail.name], ["curriculum.node.retire", "curriculumFramework", "fw1", "s1", "Triết học"]);
  assert.ok((await toasts()).includes("ok:Đã ngừng sử dụng “Triết học”.")); assert.equal(await live(), "Đã ngừng sử dụng “Triết học”.");
  assert.equal(await count(btn("add-child", "s1")), 0); assert.ok((await text('[data-node-row="s1"] [data-hint="add-child-blocked"]')).includes("Khôi phục Môn"));
  assert.equal(await count(btn("retire", "s1")), 0); assert.equal(await count(btn("edit", "s1")), 1);
  await shot("retired");
  // restore: NO confirmation, immediate, focus on NGỪNG SỬ DỤNG
  await page.click(btn("restore", "s1")); await settled();
  assert.equal(await dialogCount(), 0); const up2 = await calls("update"); assert.equal(up2.length, 2); assert.equal(up2[1].data.status, "active"); assert.equal((await nodeDoc("s1")).status, "active");
  assert.deepEqual(await focusInfo(), { id: "", action: "retire", node: "s1", name: false, row: "s1" });
  assert.equal((await audit()).at(-1).action, "curriculum.node.restore"); assert.equal(await count('[data-note="parent-retired"]'), 0); assert.equal(await count(btn("add-child", "s1")), 1);
  assert.equal(await live(), "Đã khôi phục “Triết học”.");
});

await step("active framework: retire confirmation adds 'có hiệu lực ngay'; the header says the framework is in use; readiness panel is replaced by the active note", async () => {
  await setup({ framework: FW("fw1", "active"), nodes: [NODE("s1")] });
  assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "active"); assert.ok((await text("#edReadiness")).includes("có hiệu lực ngay")); assert.equal(await text("#edFwBadge"), "🟢 Đang áp dụng");
  await page.click(btn("retire", "s1")); await page.waitForSelector("#edConfirm"); assert.ok((await text('#globalModal [role="dialog"]')).includes("có hiệu lực ngay"));
  await page.click("#edConfirm"); await closed(); await settled(); assert.equal((await nodeDoc("s1")).status, "retired");
  assert.equal(await count("#edReadiness"), 1);
});

await step("readiness follows the tree: retiring the only active Môn blocks activation (reason shown, nothing auto-fixed), restoring makes it ready; the editor has NO activate control", async () => {
  await setup({ nodes: [NODE("s1")] });
  assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready"); assert.ok((await text("#edReadiness")).includes("1 Môn đang sử dụng · 1 nút"));
  await page.click(btn("retire", "s1")); await page.click("#edConfirm"); await closed(); await settled();
  assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "blocked"); assert.equal(await count('#edReadiness [data-reason="NO_ACTIVE_SUBJECT"]'), 1); assert.ok((await text("#edReadiness")).includes("Cần ít nhất một Môn"));
  await page.click(btn("restore", "s1")); await settled(); assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready");
  assert.equal(await count('[data-ed-action="activate"], [data-fw-action="activate"]'), 0); assert.ok(!/KÍCH HOẠT/.test(await text("#edRoot")));
  assert.equal((await ev(() => window.__h.get("curriculumFrameworks/fw1"))).status, "draft", "the editor never changes the framework");
});

await step("retired toggle: hides fully-retired branches only (a live child under a retired parent stays visible), keeps count + aria-pressed + focus, and disables reordering while siblings are hidden", async () => {
  await setup({ nodes: [NODE("s1"), LESSON("l1", "s1", 0), LESSON("l2", "s1", 1, { status: "retired" }), LESSON("l3", "s1", 2), NODE("s2", { order: 1, status: "retired" }), LESSON("l4", "s2", 0, { status: "retired" }), NODE("s3", { order: 2, status: "retired" }), LESSON("l5", "s3", 0)] });
  assert.deepEqual(await rowIds(), ["s1", "l1", "l2", "l3", "s2", "l4", "s3", "l5"]); assert.equal(await page.getAttribute("#edToggleRetired", "aria-pressed"), "true"); assert.equal(await text("#edToggleRetired"), "Ẩn nút ngừng sử dụng");
  await page.click("#edToggleRetired");
  assert.deepEqual(await rowIds(), ["s1", "l1", "l3", "s3", "l5"], "s2 + l4 + l2 hidden; s3 stays because its child l5 is live");
  assert.equal(await page.getAttribute("#edToggleRetired", "aria-pressed"), "false"); assert.equal(await text("#edToggleRetired"), "Hiện nút ngừng sử dụng"); assert.equal(await text("#edHiddenNote"), "Đang ẩn 3 nút ngừng sử dụng.");
  assert.equal(await ev(() => document.activeElement.id), "edToggleRetired"); assert.equal((await calls("update")).length, 0);
  assert.equal(await count(`${btn("up", "l1")}[disabled]`), 1); assert.equal(await count(`${btn("down", "l1")}[disabled]`), 1); assert.ok((await page.getAttribute(btn("down", "l1"), "title")).includes("hiện các nút đã ngừng sử dụng"));
  assert.equal(await count(`${btn("up", "s3")}[disabled]`), 1, "root siblings are hidden too (s2), so reordering is disabled there as well");
  await shot("hidden");
  await page.click("#edToggleRetired"); assert.equal((await rowIds()).length, 8); assert.equal(await count("#edHiddenNote"), 0);
  assert.equal(await count(`${btn("down", "l1")}:not([disabled])`), 1);
});

await step("collapse / expand: native buttons with aria-expanded, focus kept; 'Thu gọn tất cả' / 'Mở rộng tất cả'", async () => {
  await setup({ nodes: [NODE("s1"), LESSON("l1", "s1", 0), NODE("s2", { order: 1 }), LESSON("l2", "s2", 0)] });
  assert.equal(await page.getAttribute(btn("toggle", "s1"), "aria-expanded"), "true"); assert.equal(await count("#edKids-s1.hidden"), 0);
  await page.click(btn("toggle", "s1")); assert.equal(await page.getAttribute(btn("toggle", "s1"), "aria-expanded"), "false"); assert.equal(await count("#edKids-s1.hidden"), 1); assert.equal(await ev(() => document.activeElement.dataset.nodeId), "s1");
  assert.equal(await page.getAttribute(btn("toggle", "s1"), "aria-controls"), "edKids-s1");
  assert.equal(await text("#edToggleAll"), "Thu gọn tất cả"); await page.click("#edToggleAll"); assert.equal(await count("ul[id^=edKids-].hidden"), 2); assert.equal(await text("#edToggleAll"), "Mở rộng tất cả");
  await page.click("#edToggleAll"); assert.equal(await count("ul[id^=edKids-].hidden"), 0); assert.equal((await calls("update")).length, 0);
});

await step("reorder Up/Down: boundaries disabled; ONE atomic batch of 2 updates with exact orders; focus stays on the moved node's button (or its counterpart at an end); announcement; audit; siblings only", async () => {
  await setup({ nodes: [NODE("s1", { order: 0 }), NODE("s2", { order: 1 }), NODE("s3", { order: 2 }), LESSON("l1", "s1", 0), LESSON("l2", "s1", 1)] });
  assert.equal(await count(`${btn("up", "s1")}[disabled]`), 1); assert.equal(await count(`${btn("down", "s3")}[disabled]`), 1); assert.equal(await count(`${btn("up", "s2")}:not([disabled])`), 1); assert.equal(await count(`${btn("down", "l2")}[disabled]`), 1);
  await page.click(btn("down", "s2")); await settled();
  const batch = await calls("batch"); assert.equal(batch.length, 1); assert.equal((await calls("update")).length, 0);
  assert.deepEqual(batch[0].paths, [NODE_PREFIX + "s3", NODE_PREFIX + "s2"]); assert.deepEqual(batch[0].data.map((d) => d.order), [1, 2]); assert.ok(batch[0].data.every((d) => Object.keys(d).sort().join() === "order,updatedAt"));
  assert.deepEqual([(await nodeDoc("s1")).order, (await nodeDoc("s2")).order, (await nodeDoc("s3")).order], [0, 2, 1]);
  assert.deepEqual((await rowIds()).filter((i) => i.startsWith("s")), ["s1", "s3", "s2"]);
  assert.equal(await live(), "Đã chuyển “Môn s2” xuống vị trí 3/3."); assert.deepEqual(await focusInfo(), { id: "", action: "up", node: "s2", name: false, row: "s2" }, "at the end: the counterpart button gets focus");
  const a = (await audit()).at(-1); assert.deepEqual([a.action, a.detail.nodeId, a.detail.direction, a.detail.count], ["curriculum.node.reorder", "s2", "down", 2]); assert.equal((await audit()).filter((x) => x.action === "curriculum.node.reorder").length, 1);
  await page.click(btn("up", "s2")); await settled(); assert.deepEqual((await rowIds()).filter((i) => i.startsWith("s")), ["s1", "s2", "s3"]); assert.equal(await live(), "Đã chuyển “Môn s2” lên vị trí 2/3.");
  assert.deepEqual(await focusInfo(), { id: "", action: "up", node: "s2", name: false, row: "s2" });
  // moving a Bài stays inside its Môn
  await page.click(btn("up", "l2")); await settled(); assert.deepEqual([(await nodeDoc("l1")).order, (await nodeDoc("l2")).order], [1, 0]); assert.deepEqual([(await nodeDoc("s1")).order, (await nodeDoc("s2")).order, (await nodeDoc("s3")).order], [0, 1, 2]);
  assert.equal(await text('[data-node-row="s1"] > div .small.mut'), "Môn · 2 nút con");
  assert.equal(await count(`${btn("up", "l2")}[disabled]`), 1, "l2 is now first among its siblings");
  await shot("reordered");
});

await step("reorder with colliding stored orders renumbers the siblings 0..n-1 in ONE batch (only changed documents), result strictly ordered", async () => {
  await setup({ nodes: [NODE("a", { order: 4 }), NODE("b", { order: 4 }), NODE("c", { order: 4 })] });
  assert.deepEqual(await rowIds(), ["a", "b", "c"]);
  await page.click(btn("down", "a")); await settled();
  const batch = await calls("batch"); assert.equal(batch.length, 1); const stored = [await nodeDoc("a"), await nodeDoc("b"), await nodeDoc("c")].map((n) => n.order);
  assert.equal(new Set(stored).size, 3); assert.deepEqual(await rowIds(), ["b", "a", "c"]); assert.deepEqual(stored, [1, 0, 2]); assert.equal(batch[0].paths.length, 3);
});

await step("reorder stale/atomic: siblings changed elsewhere -> abort, NOTHING written, reloaded; a failing batch applies NOTHING (atomic); uncertain outcome is reloaded and reported", async () => {
  await setup({ nodes: [NODE("s1", { order: 0 }), NODE("s2", { order: 1 }), NODE("s3", { order: 2 })] });
  await ev(() => window.__h.patch("curriculumFrameworks/fw1/nodes/s3", { order: 0 })); await ev(() => window.__h.patch("curriculumFrameworks/fw1/nodes/s1", { order: 2 }));
  await page.click(btn("down", "s2")); await settled();
  assert.equal((await calls("batch")).length, 0); assert.ok((await toasts()).includes("err:Thứ tự các nút đã thay đổi ở nơi khác. Đã tải lại, chưa có thay đổi nào được ghi.")); assert.deepEqual((await rowIds()), ["s3", "s2", "s1"]);
  assert.equal(await live(), "Thứ tự các nút đã thay đổi ở nơi khác. Đã tải lại, chưa có thay đổi nào được ghi."); assert.equal(await ev(() => document.activeElement.id), "edTitle");
  await setFail({ op: "write", code: "unavailable", applied: false });
  await page.click(btn("down", "s3")); await settled();
  assert.deepEqual([(await nodeDoc("s3")).order, (await nodeDoc("s2")).order, (await nodeDoc("s1")).order], [0, 1, 2], "an atomic batch that fails writes nothing");
  assert.ok((await toasts()).some((t) => t.startsWith("err:Không thể kết nối máy chủ") && t.includes("Chưa xác định được kết quả"))); assert.deepEqual(await rowIds(), ["s3", "s2", "s1"]);
  await setFail({ op: "write", code: "deadline-exceeded", applied: true });
  await page.click(btn("down", "s3")); await settled();
  assert.deepEqual(await rowIds(), ["s2", "s3", "s1"], "uncertain outcome: the editor reloads and shows the TRUE state"); assert.equal((await audit()).filter((x) => x.action === "curriculum.node.reorder").length, 0, "no audit for an unconfirmed write");
});

await step("depth 3 and 4 nodes (seeded / imported later) display and are fully manageable (edit, retire, restore, reorder) but offer no add-child; the UI is not hard-wired to two levels", async () => {
  const U = (id, parent, anc, order, extra = {}) => NODE(id, { kind: "unit", parentId: parent, ancestors: anc, order, name: "Mục " + id, ...extra });
  await setup({ nodes: [NODE("s1"), LESSON("l1", "s1", 0), U("u1", "l1", ["s1", "l1"], 0), U("u2", "l1", ["s1", "l1"], 1), U("d1", "u1", ["s1", "l1", "u1"], 0), U("d2", "u1", ["s1", "l1", "u1"], 1)] });
  const flags = await rowFlags(); assert.deepEqual([flags.s1, flags.l1, flags.u1, flags.d1], ["active/subject/d1", "active/lesson/d2", "active/unit/d3", "active/unit/d4"]);
  assert.equal(await count('[data-ed-action="add-child"]'), 1); assert.equal(await count(btn("add-child", "s1")), 1);
  assert.equal(await text('[data-node-row="d1"] > div .small.mut'), "Mục"); assert.equal(await text("#edSummary"), "1 Môn · 4 Mục · 1 Bài");
  await openEdit("d1"); assert.equal(await text("#edDialogTitle"), "Sửa Mục"); await page.fill("#edName", "Mục sâu"); await page.fill("#edCode", "D1"); await page.click("#edSubmit"); await closed(); await settled();
  assert.equal((await nodeDoc("d1")).name, "Mục sâu"); assert.equal((await nodeDoc("d1")).parentId, "u1"); assert.deepEqual((await nodeDoc("d1")).ancestors, ["s1", "l1", "u1"]);
  await page.click(btn("down", "d1")); await settled(); assert.deepEqual([(await nodeDoc("d1")).order, (await nodeDoc("d2")).order], [1, 0]);
  await page.click(btn("retire", "d2")); await page.click("#edConfirm"); await closed(); await settled(); assert.equal((await nodeDoc("d2")).status, "retired");
  await page.click(btn("restore", "d2")); await settled(); assert.equal((await nodeDoc("d2")).status, "active");
  for (const call of await calls("update")) assert.ok(Object.keys(call.data).every((k) => ["name", "code", "order", "status", "updatedAt"].includes(k)), "no structural field is ever written");
  await shot("deep");
});

await step("framework / Organization states: draft & active editable; ARCHIVED framework and ARCHIVED Organization are read-only (banner, no mutation control, disabled create with reason)", async () => {
  await setup({ framework: FW("fw1", "archived"), nodes: [NODE("s1"), LESSON("l1", "s1", 0), LESSON("l2", "s1", 1, { status: "retired" })] });
  assert.ok((await text("#edModeBanner")).includes("Khung đã lưu trữ")); assert.equal(await text("#edFwBadge"), "📦 Đã lưu trữ");
  assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0); assert.equal(await count("#edAddSubject[disabled]"), 1); assert.ok((await text("#edAddSubjectHint")).length > 10); assert.equal(await count("#edReadiness"), 0);
  assert.deepEqual(await rowIds(), ["s1", "l1", "l2"]); assert.equal(await count(btn("toggle", "s1")), 1);
  assert.equal((await calls("set")).length + (await calls("update")).length + (await calls("batch")).length, 0);
  await shot("archived-fw");
  await setup({ org: ORG("archived"), framework: FW("fw1", "active"), nodes: [NODE("s1"), LESSON("l1", "s1", 0)] });
  assert.ok((await text("#edModeBanner")).includes("Đơn vị đã lưu trữ")); assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0); assert.equal(await count("#edAddSubject[disabled]"), 1); assert.equal(await count("#edReadiness"), 0);
  assert.equal(await count("#edToggleRetired:not([disabled])"), 1, "viewing aids still work");
  await shot("archived-org");
  await setup({ org: ORG("archived"), framework: FW("fw1", "archived"), nodes: [] });
  assert.ok((await text("#edModeBanner")).includes("Đơn vị đã lưu trữ")); assert.equal(await count("#edEmptyAdd"), 0); assert.ok((await text("#edEmpty")).includes("chưa có nội dung"));
});

await step("stale Organization: archived after the editor opened -> the next mutation aborts BEFORE any write, repaints read-only, tells the user", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" })] });
  await openEdit("s1"); await ev(() => window.__h.patch("organizations/orgA", { status: "archived" }));
  await page.fill("#edName", "Tên mới"); await page.click("#edSubmit"); await closed(); await settled();
  assert.equal((await calls("update")).length + (await calls("set")).length + (await calls("batch")).length, 0);
  assert.ok((await toasts()).includes("warn:Đơn vị đã được lưu trữ. Không thể thay đổi chương trình.")); assert.equal(await live(), "Đơn vị đã được lưu trữ. Không thể thay đổi chương trình.");
  assert.equal(await count("#edModeBanner"), 1); assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0); assert.equal(await ev(() => document.activeElement.id), "edTitle");
  assert.equal((await nodeDoc("s1")).name, "Môn A");
});

await step("stale framework: archived / activated elsewhere -> 'đã được thay đổi ở nơi khác', no write, mode repainted; deleted elsewhere -> not-found state with the way back", async () => {
  await setup({ nodes: [NODE("s1")] });
  await page.click("#edAddSubject"); await page.waitForSelector("#edName"); await ev(() => window.__h.patch("curriculumFrameworks/fw1", { status: "archived", activatedAt: window.__h.stamp(9) }));
  await submitCreate("Môn mới"); await closed(); await settled();
  assert.equal((await calls("set")).length, 0); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại.")); assert.equal(await count("#edModeBanner"), 1); assert.equal(await text("#edFwBadge"), "📦 Đã lưu trữ");
  await setup({ nodes: [NODE("s1")] });
  await ev(() => window.__h.patch("curriculumFrameworks/fw1", { status: "active", activatedAt: window.__h.stamp(9) }));
  await page.click(btn("retire", "s1")); await page.click("#edConfirm"); await closed(); await settled();
  assert.equal((await calls("update")).length, 0); assert.equal(await text("#edFwBadge"), "🟢 Đang áp dụng"); assert.equal((await nodeDoc("s1")).status, "active");
  await setup({ nodes: [NODE("s1")] });
  await openEdit("s1"); await ev(() => window.__h.remove("curriculumFrameworks/fw1"));
  await page.fill("#edName", "Đổi"); await page.click("#edSubmit"); await closed(); await page.waitForSelector("#edNotFound");
  assert.ok((await text("#edNotFound")).includes("Không tìm thấy khung")); assert.equal(await count("#edBack"), 1); assert.equal((await calls("update")).length, 0);
  await page.click("#edBack"); assert.equal((await ev(() => window.__backs)).length, 1);
});

await step("stale node: changed elsewhere (updatedAt/status) or removed elsewhere -> abort with explanation, no write, reload; parent retired/removed while the create dialog is open -> abort", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" }), LESSON("l1", "s1", 0), LESSON("l2", "s1", 1)] });
  await openEdit("l1"); await ev(() => window.__h.patch("curriculumFrameworks/fw1/nodes/l1", { name: "Đổi ở tab khác", updatedAt: window.__h.stamp(777) }));
  await page.fill("#edName", "Tab này"); await page.click("#edSubmit"); await closed(); await settled();
  assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Nút đã được thay đổi ở nơi khác. Đã tải lại.")); assert.equal(await text('[data-node-row="l1"] [data-node-name]'), "Đổi ở tab khác");
  await ev(() => window.__h.remove("curriculumFrameworks/fw1/nodes/l2"));
  await page.click(btn("retire", "l2")); await page.click("#edConfirm"); await closed(); await settled();
  assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Không tìm thấy nút (có thể đã bị thay đổi ở nơi khác). Đã tải lại.")); assert.deepEqual(await rowIds(), ["s1", "l1"]);
  await page.click(btn("add-child", "s1")); await page.waitForSelector("#edName"); await ev(() => window.__h.patch("curriculumFrameworks/fw1/nodes/s1", { status: "retired", updatedAt: window.__h.stamp(900) }));
  await submitCreate("Bài mới"); await closed(); await settled();
  assert.equal((await calls("set")).length, 0); assert.ok((await toasts()).some((t) => t.includes("Nút cha đã ngừng sử dụng"))); assert.equal(await count(btn("add-child", "s1")), 0);
  await setup({ nodes: [NODE("s1")] });
  await page.click(btn("add-child", "s1")); await page.waitForSelector("#edName"); await ev(() => window.__h.remove("curriculumFrameworks/fw1/nodes/s1"));
  await submitCreate("Bài mồ côi"); await closed(); await settled();
  assert.equal((await calls("set")).length, 0); assert.ok((await toasts()).includes("err:Nút cha không còn tồn tại. Đã tải lại.")); assert.deepEqual(await rowIds(), []);
  // restore of a node that is no longer retired -> stale
  await setup({ nodes: [NODE("s1", { status: "retired" })] });
  await ev(() => window.__h.patch("curriculumFrameworks/fw1/nodes/s1", { status: "active", updatedAt: window.__h.stamp(950) }));
  await page.click(btn("restore", "s1")); await settled(); assert.equal((await calls("update")).length, 0); assert.ok((await toasts()).includes("err:Nút đã được thay đổi ở nơi khác. Đã tải lại."));
});

await step("write permission-denied is DIAGNOSED by safe re-reads (never 'not found'): consistent -> permission message; Organization archived / framework changed / framework gone -> the matching abort; node removed at write time -> not found node", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" })] });
  await openEdit("s1"); await setFail({ op: "write", code: "permission-denied" }); await page.fill("#edName", "X"); await page.click("#edSubmit"); await page.waitForSelector("#edErr:not(.hidden)");
  const msg = await text("#edErr"); assert.ok(msg.includes("Không có quyền thực hiện thao tác này")); assert.ok(!/không tìm thấy/i.test(msg)); assert.equal(await dialogCount(), 1); await page.click("#edCancel"); await closed();
  await ev(() => { window.__h.FAKE.beforeWrite = async () => { window.__h.patch("organizations/orgA", { status: "archived" }); window.__h.FAKE.beforeWrite = null; }; });
  await openEdit("s1"); await setFail({ op: "write", code: "permission-denied" }); await page.fill("#edName", "Y"); await page.click("#edSubmit"); await closed(); await settled();
  assert.ok((await toasts()).includes("warn:Đơn vị đã được lưu trữ. Không thể thay đổi chương trình.")); assert.equal(await count("#edModeBanner"), 1);
  await setup({ nodes: [NODE("s1", { name: "Môn A" })] });
  await ev(() => { window.__h.FAKE.beforeWrite = async () => { window.__h.patch("curriculumFrameworks/fw1", { status: "archived", activatedAt: window.__h.stamp(9) }); window.__h.FAKE.beforeWrite = null; }; });
  await openEdit("s1"); await setFail({ op: "write", code: "permission-denied" }); await page.fill("#edName", "Z"); await page.click("#edSubmit"); await closed(); await settled();
  assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại.")); assert.equal(await text("#edFwBadge"), "📦 Đã lưu trữ");
  await setup({ nodes: [NODE("s1", { name: "Môn A" })] });
  await ev(() => { window.__h.FAKE.beforeWrite = async () => { window.__h.remove("curriculumFrameworks/fw1"); window.__h.FAKE.beforeWrite = null; }; });
  await openEdit("s1"); await setFail({ op: "write", code: "permission-denied" }); await page.fill("#edName", "W"); await page.click("#edSubmit"); await closed(); await page.waitForSelector("#edNotFound");
  await setup({ nodes: [NODE("s1", { name: "Môn A" }), NODE("s2", { order: 1 })] });
  await ev(() => { window.__h.FAKE.beforeWrite = async () => { window.__h.remove("curriculumFrameworks/fw1/nodes/s2"); window.__h.FAKE.beforeWrite = null; }; });
  await page.click(btn("retire", "s2")); await page.click("#edConfirm"); await closed(); await settled();
  assert.ok((await toasts()).includes("err:Không tìm thấy nút (có thể đã bị thay đổi ở nơi khác). Đã tải lại.")); assert.deepEqual(await rowIds(), ["s1"]);
});

await step("read failures: network error -> error state with THỬ LẠI (retry recovers); permission-denied on read is NEVER 'not found'; framework missing at open -> not-found state", async () => {
  await setup({ nodes: [NODE("s1")], mode: "none" });
  await setFail({ op: "read", code: "unavailable" }); await ev(() => window.__h.mountEditor({})); await page.waitForSelector("#edError");
  assert.ok((await text("#edError")).includes("Không thể kết nối máy chủ")); assert.equal(await count("#edBack"), 1);
  await page.click("#edRetry"); await page.waitForSelector("[data-node-row]"); assert.deepEqual(await rowIds(), ["s1"]);
  await setup({ nodes: [NODE("s1")], mode: "none" });
  await setFail({ op: "read", code: "permission-denied" }); await ev(() => window.__h.mountEditor({})); await page.waitForSelector("#edError");
  const msg = await text("#edError"); assert.ok(msg.includes("Không có quyền xem chương trình của đơn vị này.")); assert.ok(!/không tìm thấy/i.test(msg)); assert.equal(await count('#edError[role="alert"]'), 1);
  await setup({ nodes: [NODE("s1")], mode: "none" }); await ev(() => { window.__h.remove("curriculumFrameworks/fw1"); });
  await ev(() => window.__h.mountEditor({ fwId: "fw1" })); await page.waitForSelector("#edNotFound"); assert.ok((await text("#edNotFound")).includes("Không tìm thấy khung"));
  await setup({ mode: "none", nodes: [] }); await ev(() => { window.__h.patch("curriculumFrameworks/fw1", { organizationId: "orgB" }); });
  await ev(() => window.__h.mountEditor({})); await page.waitForSelector("#edNotFound");
});

await step("structural problems are reported, never dropped or edited: orphans block + readiness reason; > 5000 nodes shows a read-only 'too large' state (no tree, no create)", async () => {
  await setup({ nodes: [NODE("s1"), LESSON("o1", "ghost", 0, { name: "Bài mồ côi", ancestors: ["ghost"] })] });
  assert.equal(await count("#edOrphans"), 1); assert.equal(await count('[data-orphan="o1"]'), 1); assert.equal(await count('[data-node-row="o1"]'), 0); assert.ok((await text("#edOrphans")).includes("Bài mồ côi"));
  assert.equal(await count('#edReadiness [data-reason="TREE_PARENT_MISSING"]'), 1); assert.equal(await count("#edOrphans button"), 0);
  await setup({ nodes: [], mode: "none" });
  await ev(() => { const h = window.__h; for (let i = 0; i < 5001; i++) h.seedNode("fw1", { id: "n" + String(i).padStart(5, "0"), organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: i, code: null, name: "N" + i, status: "active", createdAt: h.stamp(1), updatedAt: h.stamp(1) }); });
  await ev(() => window.__h.mountEditor({})); await page.waitForSelector("#edTooLarge"); assert.ok((await text("#edTooLarge")).includes("5000")); assert.equal(await count("[data-node-row]"), 0); assert.equal(await count("#edAddSubject"), 0); assert.equal(await count("#edTree"), 0);
  assert.equal((await calls("getDocs")).at(-1).constraints.at(-1), "limit:5001");
});

await step("busy guard: a slow write cannot be double-submitted; every other control is disabled meanwhile (incl. back), the label shows progress", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" }), NODE("s2", { order: 1 })] });
  await openEdit("s1"); await page.fill("#edName", "Chậm"); await ev(() => { window.__h.FAKE.delays.write = 700; });
  await page.click("#edSubmit"); await page.waitForFunction(() => document.querySelector("#edSubmit")?.textContent.includes("ĐANG XỬ LÝ"));
  assert.equal(await page.getAttribute("#edSubmit", "disabled") !== null, true); assert.equal(await page.isDisabled("#edBack"), true); assert.equal(await page.isDisabled("#edCancel"), true); assert.equal(await page.isDisabled(btn("up", "s2")), true);
  await page.keyboard.press("Escape"); assert.equal(await dialogCount(), 1, "Escape is ignored while busy");
  await page.dispatchEvent("#edSubmit", "click"); await page.dispatchEvent(btn("retire", "s2"), "click");
  await closed(); await settled(); assert.equal((await calls("update")).length, 1); await ev(() => { window.__h.FAKE.delays = {}; });
  assert.equal(await page.isDisabled("#edBack"), false);
  // a second click on a reorder while the first is running is ignored too
  await ev(() => { window.__h.FAKE.delays.write = 500; }); await page.click(btn("down", "s1")); await page.dispatchEvent(btn("down", "s1"), "click"); await page.dispatchEvent(btn("up", "s2"), "click"); await settled();
  assert.equal((await calls("batch")).length, 1); await ev(() => { window.__h.FAKE.delays = {}; });
});

await step("dialog accessibility and focus: focus enters the dialog, Escape / Cancel / BACKDROP return focus to the opener (found again after repaints), clicks inside the dialog do not dismiss, keyboard-only create works", async () => {
  await setup({ nodes: [NODE("s1", { name: "Môn A" }), LESSON("l1", "s1", 0)] });
  const opener = async () => ev(() => { const a = document.activeElement; return (a.id || "") + "|" + (a.dataset.edAction || "") + ":" + (a.dataset.nodeId || ""); });
  await page.focus("#edAddSubject"); await page.keyboard.press("Enter"); await page.waitForSelector("#edName"); assert.equal(await ev(() => document.activeElement.id), "edName");
  await page.keyboard.press("Escape"); await closed(); assert.equal(await opener(), "edAddSubject|add-subject:");
  await page.click(btn("edit", "l1")); await page.waitForSelector("#edName"); await page.click("#edDialogTitle"); assert.equal(await dialogCount(), 1, "a click on dialog text does not dismiss"); await page.keyboard.press("Escape"); await closed(); assert.equal(await opener(), "|edit:l1");
  await page.click(btn("retire", "l1")); await page.waitForSelector("#edConfirm"); await page.click("#modalBackdrop", { position: { x: 5, y: 5 } }); await closed(); assert.equal(await opener(), "|retire:l1", "backdrop dismissal follows the same contract");
  await page.click(btn("add-child", "s1")); await page.waitForSelector("#edName"); await page.click("#edCancel"); await closed(); assert.equal(await opener(), "|add-child:s1");
  // keyboard only: type into the fields and submit with Enter
  await page.focus("#edAddSubject"); await page.keyboard.press("Space"); await page.waitForSelector("#edName"); await page.keyboard.type("Môn gõ phím"); await page.keyboard.press("Tab"); await page.keyboard.type("KB-1"); await page.keyboard.press("Enter"); await closed(); await settled();
  const kbId = (await calls("set")).at(-1).path.split("/").pop(); assert.equal((await nodeDoc(kbId)).name, "Môn gõ phím"); assert.equal((await nodeDoc(kbId)).code, "KB-1");
  // every control is a native button: no role=button / click-only elements, every action button has an accessible name
  assert.equal(await count('[role="button"], [onclick]:not(button)'), 0);
  assert.equal(await ev(() => [...document.querySelectorAll("#edRoot button")].filter((b) => !(b.textContent.trim() || b.getAttribute("aria-label"))).length), 0);
  assert.equal(await ev(() => [...document.querySelectorAll("[data-node-row] button[data-ed-action]")].filter((b) => !b.getAttribute("aria-label")).length), 0);
});

await step("responsive: no horizontal overflow at 375 / 768 / 1280 with very long names and 4 levels; tap targets >= 44px high; one column rows on phones", async () => {
  const long = "Rất dài ".repeat(25).trim(), U = (id, parent, anc, order) => NODE(id, { kind: "unit", parentId: parent, ancestors: anc, order, name: long });
  await setup({ nodes: [NODE("s1", { name: long, code: "C".repeat(40) }), LESSON("l1", "s1", 0, { name: long }), U("u1", "l1", ["s1", "l1"], 0), U("d1", "u1", ["s1", "l1", "u1"], 0), NODE("s2", { order: 1, name: long, status: "retired" })] });
  for (const [w, h] of [[375, 800], [768, 900], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(80);
    const m = await ev(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, small: [...document.querySelectorAll("#edRoot button, #edRoot input")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim() || b.id) }));
    assert.ok(m.over <= 0, "overflow at " + w + ": " + m.over); assert.deepEqual(m.small, [], "tap targets at " + w);
  }
  await page.setViewportSize({ width: 375, height: 800 }); await page.click(btn("edit", "s1")); await page.waitForSelector("#edName");
  const dlg = await ev(() => { const r = document.querySelector("#globalModal .modal").getBoundingClientRect(); return { right: r.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; }); assert.ok(dlg.right <= dlg.w + 1 && dlg.over <= 0);
  await shot("phone-dialog"); await page.click("#edCancel"); await closed(); await shot("phone");
  await page.setViewportSize({ width: 1100, height: 900 });
});

// ============ results
await step("no console or page errors in the whole run", async () => { assert.deepEqual(errors, []); });
console.log(`ALL PASS ${results.length}/${results.length}`);
await browser.close(); server.close();
