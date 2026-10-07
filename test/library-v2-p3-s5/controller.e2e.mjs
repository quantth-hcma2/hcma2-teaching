// LIBRARY V2 P3-S5 - clone / delete-draft CONTROLLER state machine in a REAL browser (headless Edge) against an in-memory fake Firestore with set/update/delete batches and
// failure injection (harness.html). No emulator, no production, no network. Real P3-S2 modules + real S3 section + real clone tools.
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p3-s5/controller.e2e.mjs   (optional P3S5_SHOTS=<dir>)
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
await page.goto(`${base}/test/library-v2-p3-s5/harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P3S5_SHOTS) await page.screenshot({ path: path.join(process.env.P3S5_SHOTS, "s5-" + name + ".png") }); };

// ---- fixtures and helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const ORG = (status = "active") => ({ id: "orgA", name: "Khoa Quản trị", code: "khoa", status, createdAt: { seconds: 5 } });
const FW = (id, status, sec, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", scope: "organization", name: "Khung " + id, status, createdAt: { seconds: sec, nanoseconds: 0 }, createdBy: "pa1", updatedAt: { seconds: sec, nanoseconds: 0 }, ...(status === "draft" ? {} : { activatedAt: { seconds: sec + 1, nanoseconds: 0 }, statusChangedAt: { seconds: sec + 1, nanoseconds: 0 }, statusChangedBy: "pa1" }), ...extra });
let stamp = 100;
const NODE = (id, extra = {}) => ({ id, schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn " + id, status: "active", createdAt: { seconds: 1 }, updatedAt: { seconds: ++stamp }, ...extra });
const LESSON = (id, parent, order, extra = {}) => NODE(id, { kind: "lesson", parentId: parent, ancestors: [parent], order, name: "Bài " + id, ...extra });
const UNIT = (id, parent, anc, order, extra = {}) => NODE(id, { kind: "unit", parentId: parent, ancestors: anc, order, name: "Mục " + id, ...extra });
const TREE = () => [NODE("s1", { code: "S1", order: 0 }), LESSON("l1", "s1", 0, { code: "L1" }), LESSON("l2", "s1", 1, { status: "retired", code: "L2" }), NODE("s2", { order: 1 }), UNIT("u1", "l1", ["s1", "l1"], 0), UNIT("d1", "u1", ["s1", "l1", "u1"], 0, { code: "D1" })];
async function setup({ org = ORG(), frameworks = [], nodes = {}, tools = true } = {}) {
  await ev(({ org, frameworks, nodes }) => { const h = window.__h; h.reset(); h.seedOrg(org); frameworks.forEach((f) => h.seedFramework(f)); Object.entries(nodes).forEach(([fw, list]) => list.forEach((n) => h.seedNode(fw, n))); }, { org, frameworks, nodes });
  await ev((t) => window.__h.mount({ tools: t }), tools); await waitIdle();
}
const text = (sel) => ev((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const count = (sel) => page.locator(sel).count();
const rows = () => ev(() => [...document.querySelectorAll("[data-fw-row]")].map((r) => r.dataset.fwRow + ":" + r.dataset.fwStatus));
const actionsOf = (id) => ev((i) => [...document.querySelectorAll(`[data-fw-id="${i}"][data-fw-action]`)].map((b) => b.dataset.fwAction), id);
const calls = (op) => ev((o) => window.__h.FAKE.calls.filter((c) => c.op === o), op);
const allWrites = () => ev(() => window.__h.FAKE.calls.filter((c) => ["set", "update", "batch", "deleteDoc"].includes(c.op)).map((c) => c.op + (c.op === "batch" ? ":" + c.kinds + ":" + c.size : "")));
const audit = () => ev(() => window.__h.FAKE.audit);
const doc = (p) => ev((x) => window.__h.get(x), p);
const list = (prefix) => ev((p) => window.__h.list(p), prefix);
const toasts = () => ev(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.className.replace("toast", "").trim() + ":" + t.textContent));
const waitIdle = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 30000 });
const dialogOpen = () => count('#globalModal [role="dialog"]');
const closed = () => page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'), null, { timeout: 30000 });
const clickAction = (id, action) => page.click(`[data-fw-id="${id}"][data-fw-action="${action}"]`);
const live = () => text("#orgFwLive");
const setFail = (f) => ev((x) => window.__h.FAKE.failures.push(x), f);
const snapshot = async (prefix) => JSON.stringify(await ev((p) => window.__h.list(p).sort().map((k) => [k, window.__h.get(k)]), prefix));
const nodesOf = (fwId) => ev((id) => window.__h.list("curriculumFrameworks/" + id + "/nodes/").map((k) => ({ id: k.split("/").pop(), ...window.__h.get(k) })), fwId);
const frameworkIds = () => ev(() => window.__h.list("curriculumFrameworks/").filter((k) => k.split("/").length === 2).map((k) => k.split("/")[1]).sort());
const newFw = async (excluding) => (await frameworkIds()).filter((id) => !excluding.includes(id));
const bigTree = (n) => ev((count) => { const h = window.__h; for (let i = 0; i < count; i++) h.seedNode("big", { id: "n" + String(i).padStart(4, "0"), organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: i, code: "C" + i, name: "Môn " + i, status: i % 7 === 3 ? "retired" : "active", createdAt: h.stamp(1), updatedAt: h.stamp(1) }); }, n);
const runClone = async (id, name) => { await clickAction(id, "clone"); await page.waitForSelector("#orgFwName"); if (name !== undefined) await page.fill("#orgFwName", name); await page.click("#orgFwSubmit"); };

await step("row controls: NHÂN BẢN on every framework of an ACTIVE organization, XÓA BẢN NHÁP ONLY on a never-activated draft (never active / archived / a draft that carries activatedAt); none without the tools or in an archived organization", async () => {
  const fws = [FW("act", "active", 30), FW("arc", "archived", 20), FW("dra", "draft", 40), FW("reborn", "draft", 50, { activatedAt: { seconds: 51, nanoseconds: 0 } })];
  await setup({ frameworks: fws });
  assert.deepEqual(await actionsOf("dra"), ["rename", "clone", "activate", "delete-draft"]); assert.deepEqual(await actionsOf("act"), ["rename", "clone", "archive"]); assert.deepEqual(await actionsOf("arc"), ["clone", "restore"]);
  assert.deepEqual(await actionsOf("reborn"), ["rename", "clone", "activate"], "a draft with an activatedAt key was activated once: NOT deletable");
  assert.equal(await count('[data-fw-action="delete-draft"]'), 1);
  assert.equal(await text('[data-fw-id="dra"][data-fw-action="delete-draft"]'), "XÓA BẢN NHÁP"); assert.equal(await text('[data-fw-id="dra"][data-fw-action="clone"]'), "NHÂN BẢN");
  assert.ok((await ev(() => getComputedStyle(document.querySelector('[data-fw-action="delete-draft"]')).color)).length > 0);
  await setup({ frameworks: fws, tools: false }); assert.equal(await count('[data-fw-action="clone"], [data-fw-action="delete-draft"]'), 0, "without cloneTools the S3 screen is unchanged");
  await setup({ org: ORG("archived"), frameworks: fws }); assert.equal(await count('[data-fw-action="clone"], [data-fw-action="delete-draft"]'), 0, "archived organization: read-only");
  await setup({ frameworks: fws }); await shot("controls");
});

await step("clone: default name '<source> (bản sao)', validation never writes, Cancel writes nothing, the source is not touched by opening the dialog", async () => {
  await setup({ frameworks: [FW("src", "active", 30)], nodes: { src: TREE() } });
  await clickAction("src", "clone"); await page.waitForSelector("#orgFwName");
  assert.equal(await page.inputValue("#orgFwName"), "Khung src (bản sao)"); assert.equal(await ev(() => document.activeElement.id), "orgFwName"); assert.equal(await page.getAttribute("#orgFwName", "maxlength"), "120");
  for (const bad of ["", "ab", "   "]) { await page.fill("#orgFwName", bad); await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwNameErr:not(.hidden)"); assert.equal(await text("#orgFwNameErr"), "Tên khung cần từ 3 đến 120 ký tự."); }
  assert.deepEqual(await allWrites(), []);
  await page.click("#orgFwCancel"); await closed(); assert.deepEqual(await allWrites(), []); assert.equal(await ev(() => document.activeElement.dataset.fwAction + ":" + document.activeElement.dataset.fwId), "clone:src");
});

await step("clone succeeds: NEW independent draft in the SAME organization, exact framework payload (cloneSource, never activated), all nodes copied with NEW ids, parents/ancestors remapped, order/code/names/retired state kept, source untouched, audit, focus", async () => {
  await setup({ frameworks: [FW("src", "active", 30)], nodes: { src: TREE() } });
  const sourceBefore = await snapshot("curriculumFrameworks/src");
  await runClone("src", "  Bản sao đầu tiên  "); await closed(); await waitIdle();
  const [destId] = await newFw(["src"]); assert.ok(destId);
  const writes = await allWrites(); assert.deepEqual(writes, ["set", "batch:set:5", "batch:update:1", "batch:set:1"], "framework, 5 nodes, retire pass (1), the final node alone");
  const fw = await doc("curriculumFrameworks/" + destId);
  assert.deepEqual(Object.keys(fw).sort(), ["cloneSource", "createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
  assert.deepEqual([fw.name, fw.status, fw.organizationId, fw.scope, fw.createdBy], ["Bản sao đầu tiên", "draft", "orgA", "organization", "pa1"]); assert.deepEqual(fw.cloneSource, { frameworkId: "src", nodeCount: 6 });
  assert.ok(!("activatedAt" in fw) && !("statusChangedAt" in fw), "never-activated semantics");
  const nodes = await nodesOf(destId); assert.equal(nodes.length, 6);
  assert.ok(nodes.every((n) => !["s1", "l1", "l2", "s2", "u1", "d1"].includes(n.id) && n.organizationId === "orgA"), "new ids only");
  const by = (name) => nodes.find((n) => n.name === name), byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const s1 = by("Môn s1"), l1 = by("Bài l1"), l2 = by("Bài l2"), u1 = by("Mục u1"), d1 = by("Mục d1"), s2 = by("Môn s2");
  assert.deepEqual([s1.parentId, s1.ancestors, s1.kind, s1.code, s1.order], [null, [], "subject", "S1", 0]);
  assert.deepEqual([l1.parentId, l1.ancestors, l1.code, l1.order], [s1.id, [s1.id], "L1", 0]); assert.deepEqual([l2.parentId, l2.order, l2.code, l2.status], [s1.id, 1, "L2", "retired"]);
  assert.deepEqual([u1.parentId, u1.ancestors, u1.kind], [l1.id, [s1.id, l1.id], "unit"]); assert.deepEqual([d1.parentId, d1.ancestors, d1.code], [u1.id, [s1.id, l1.id, u1.id], "D1"]); assert.equal(d1.ancestors.length, 3, "depth 4 preserved");
  assert.deepEqual([s2.status, s2.order, s2.code], ["active", 1, null]); assert.ok(nodes.filter((n) => n.status === "retired").length === 1);
  for (const n of nodes) for (const a of n.ancestors) assert.ok(byId[a], "every ancestor is a destination node");
  assert.equal(await snapshot("curriculumFrameworks/src"), sourceBefore, "the source framework and ALL its nodes are byte-identical");
  const a = (await audit()).at(-1); assert.deepEqual([a.action, a.entityType, a.entityId], ["curriculum.framework.clone", "curriculumFramework", destId]); assert.deepEqual(a.detail, { organizationId: "orgA", name: "Bản sao đầu tiên", sourceFrameworkId: "src", nodeCount: 6 });
  assert.ok((await rows()).includes(destId + ":draft")); assert.ok((await toasts()).includes("ok:Đã nhân bản khung chương trình.")); assert.equal(await live(), "Đã nhân bản khung chương trình.");
  assert.equal(await ev(() => document.activeElement.id), "orgCurriculumTitle");
  assert.deepEqual(await actionsOf(destId), ["rename", "clone", "activate", "delete-draft"], "the clone is a never-activated draft: deletable and activatable");
  await shot("cloned");
  // the clone is independent: editing it leaves the source alone, and later edits do not make it incomplete
  await ev((id) => { const h = window.__h; h.seedNode(id, { id: "extra1", organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 9, code: null, name: "Môn thêm", status: "active", createdAt: h.stamp(1), updatedAt: h.stamp(1) }); const s = h.list("curriculumFrameworks/" + id + "/nodes/"); for (const k of s) if (!k.endsWith("extra1")) h.patch(k, { status: "retired" }); }, destId);
  await clickAction(destId, "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled]), #orgFwBlocked");
  assert.equal(await count("#orgFwBlocked"), 0, "retiring/adding after the clone never trips INCOMPLETE_CLONE"); await page.click("#orgFwCancel"); await closed();
});

await step("clone of an EMPTY framework: only the framework document (nodeCount 0), complete by definition", async () => {
  await setup({ frameworks: [FW("src", "draft", 30)] });
  await runClone("src", "Bản sao trống"); await closed(); await waitIdle();
  const [destId] = await newFw(["src"]); assert.deepEqual(await allWrites(), ["set"]); assert.deepEqual((await doc("curriculumFrameworks/" + destId)).cloneSource, { frameworkId: "src", nodeCount: 0 }); assert.equal((await nodesOf(destId)).length, 0);
});

await step("clone of an ARCHIVED source and of a draft source works (read-only sources are fine); the destination is always a fresh draft", async () => {
  await setup({ frameworks: [FW("arc", "archived", 30), FW("dra", "draft", 40)], nodes: { arc: [NODE("a1")], dra: [NODE("d1"), LESSON("d2", "d1", 0)] } });
  await runClone("arc", "Từ khung lưu trữ"); await closed(); await waitIdle();
  await runClone("dra", "Từ bản nháp"); await closed(); await waitIdle();
  const dest = await newFw(["arc", "dra"]); assert.equal(dest.length, 2);
  for (const id of dest) { const fw = await doc("curriculumFrameworks/" + id); assert.equal(fw.status, "draft"); assert.ok(!("activatedAt" in fw)); }
  assert.equal((await doc("curriculumFrameworks/arc")).status, "archived");
});

await step("LARGE clone (850 nodes incl. retired) respects the batch limit: bounded chunks, retire pass, the final node alone, progress shown, every node verified, completeness semantics hold", async () => {
  await setup({ frameworks: [FW("big", "active", 30)], mode: "x" });
  await bigTree(850); await ev(() => window.__h.mount({}));
  await waitIdle(); await ev(() => { window.__h.FAKE.calls.length = 0; });
  await runClone("big", "Bản sao lớn"); await page.waitForFunction(() => /Đã sao chép/.test(document.querySelector("#orgFwProgress")?.textContent || "") || !document.querySelector("#orgFwProgress")); await closed(); await waitIdle();
  const [destId] = await newFw(["big"]); const batches = (await calls("batch"));
  const created = batches.filter((b) => b.kinds === "set"), retired = batches.filter((b) => b.kinds === "update");
  assert.deepEqual(created.map((b) => b.size), [400, 400, 49, 1], "849 nodes in 3 bounded batches + the final one"); assert.ok(batches.every((b) => b.size <= 400));
  const nodes = await nodesOf(destId); assert.equal(nodes.length, 850); assert.equal(new Set(nodes.map((n) => n.id)).size, 850);
  const srcRetired = (await nodesOf("big")).filter((n) => n.status === "retired").length; assert.equal(nodes.filter((n) => n.status === "retired").length, srcRetired);
  assert.equal(retired.map((b) => b.size).reduce((s, x) => s + x, 0), srcRetired, "the retire pass covers exactly the retired source nodes");
  assert.equal((await doc("curriculumFrameworks/" + destId)).cloneSource.nodeCount, 850); assert.equal((await audit()).filter((x) => x.action === "curriculum.framework.clone").length, 1);
  const order = (await ev(() => window.__h.FAKE.calls.filter((c) => c.op === "set" || c.op === "batch").map((c) => c.op === "set" ? "framework" : c.kinds + ":" + c.size))); assert.deepEqual(order.slice(0, 1), ["framework"]); assert.equal(order.at(-1), "set:1", "the final commit is the LAST write");
});

await step("clone failure in the middle of the node chunks: automatic ROLLBACK (nodes, then the draft framework), nothing remains, source untouched, honest message", async () => {
  await setup({ frameworks: [FW("big", "active", 30)], mode: "x" });
  await bigTree(850); await ev(() => window.__h.mount({})); await waitIdle();
  const before = await snapshot("curriculumFrameworks/big");
  await ev(() => { let n = 0; window.__h.FAKE.beforeWrite = async (op) => { if (op === "batch" && ++n === 2) { window.__h.FAKE.beforeWrite = null; const e = new Error("unavailable"); e.code = "unavailable"; throw e; } }; });
  await runClone("big", "Bản sao hỏng"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 }); await waitIdle();
  const msg = await text("#orgFwErr"); assert.ok(msg.includes("Không thể kết nối máy chủ")); assert.ok(msg.includes("Nhân bản không thành công. Mọi thứ đã được hoàn tác")); assert.ok(!msg.includes("chưa dọn dẹp"));
  assert.deepEqual(await frameworkIds(), ["big"], "no destination framework remains"); assert.equal(await snapshot("curriculumFrameworks/big"), before);
  assert.equal(await list("curriculumFrameworks/").then((l) => l.filter((k) => !k.startsWith("curriculumFrameworks/big")).length), 0, "no orphan nodes of the abandoned clone");
  assert.equal((await audit()).filter((x) => x.action === "curriculum.framework.clone").length, 0); assert.equal(await dialogOpen(), 1, "the dialog stays so the admin can retry");
  const deletes = await calls("batch"); assert.ok(deletes.some((b) => b.kinds === "delete"), "rollback used bounded batch deletes"); assert.deepEqual((await calls("deleteDoc")).length, 1);
  // the retry (a NEW destination id) succeeds from scratch
  await page.click("#orgFwSubmit"); await closed(); await waitIdle(); const dest = await newFw(["big"]); assert.equal(dest.length, 1); assert.equal((await nodesOf(dest[0])).length, 850);
});

await step("clone failure in the retire pass and failure of the FINAL commit are rolled back too; a lost response on the final commit that actually completed the clone is VERIFIED and kept (never roll back a good clone)", async () => {
  await setup({ frameworks: [FW("src", "active", 30)], nodes: { src: TREE() } });
  await ev(() => { window.__h.FAKE.beforeWrite = async (op) => { if (op === "batch" && window.__h.FAKE.calls.filter((c) => c.op === "batch").length === 2) { window.__h.FAKE.beforeWrite = null; const e = new Error("x"); e.code = "deadline-exceeded"; throw e; } }; });   // the 2nd batch = the retire pass
  await ev(() => { window.__h.FAKE.calls.length = 0; });
  await runClone("src", "Bản sao lỗi retire"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 }); assert.ok((await text("#orgFwErr")).includes("đã được hoàn tác")); assert.deepEqual(await frameworkIds(), ["src"]);
  await ev(() => { window.__h.FAKE.calls.length = 0; });
  await ev(() => { window.__h.FAKE.beforeWrite = async (op) => { if (op === "batch" && window.__h.FAKE.calls.filter((c) => c.op === "batch" && c.kinds === "set").length === 2) { window.__h.FAKE.beforeWrite = null; const e = new Error("x"); e.code = "unavailable"; throw e; } }; });   // the FINAL set batch
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 }); assert.deepEqual(await frameworkIds(), ["src"], "rolled back");
  await setFail({ op: "write", code: "unavailable", applied: false }); // framework create fails with nothing written
  await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 }); assert.deepEqual(await frameworkIds(), ["src"]);
  // lost response on the final commit: the write APPLIED (complete clone) -> verified, kept, audited once
  await ev(() => { window.__h.FAKE.failures.length = 0; window.__h.FAKE.beforeWrite = null; window.__h.FAKE.calls.length = 0; });
  await ev(() => { let n = 0; const orig = window.__h.FAKE.failures; window.__h.FAKE.beforeWrite = async (op) => { if (op === "batch" && window.__h.FAKE.calls.filter((c) => c.op === "batch" && c.kinds === "set").length === 2 && !window.__lost) { window.__lost = true; orig.push({ op: "write", code: "unavailable", applied: true }); } }; window.__lost = false; });
  await page.click("#orgFwSubmit"); await closed(); await waitIdle();
  const dest = await newFw(["src"]); assert.equal(dest.length, 1); assert.equal((await nodesOf(dest[0])).length, 6); assert.equal((await audit()).filter((x) => x.action === "curriculum.framework.clone").length, 1); assert.ok((await toasts()).includes("ok:Đã nhân bản khung chương trình."));
});

await step("rollback that ALSO fails leaves a detectably INCOMPLETE draft: the message says so, activation is BLOCKED with the clone reason, and XÓA BẢN NHÁP cleans it up", async () => {
  await setup({ frameworks: [FW("src", "active", 30)], nodes: { src: TREE() } });
  await ev(() => { window.__h.FAKE.beforeWrite = async (op) => { const calls = window.__h.FAKE.calls.filter((c) => c.op === "batch").length; if (op === "batch" && calls >= 2) { const e = new Error("x"); e.code = op === "batch" ? "unavailable" : "unavailable"; throw e; } if (op === "deleteDoc") { const e = new Error("x"); e.code = "unavailable"; throw e; } }; });
  await runClone("src", "Bản sao dở dang"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 }); await waitIdle();
  const msg = await text("#orgFwErr"); assert.ok(msg.includes("chưa dọn dẹp được")); assert.ok(msg.includes("XÓA BẢN NHÁP")); assert.ok(!msg.includes("đã được hoàn tác"));
  const [leftover] = await newFw(["src"]); assert.ok(leftover); assert.ok((await nodesOf(leftover)).length < 6, "partial");
  await ev(() => { window.__h.FAKE.beforeWrite = null; }); await page.click("#orgFwCancel"); await closed();
  assert.ok((await rows()).includes(leftover + ":draft")); assert.ok((await actionsOf(leftover)).includes("delete-draft"));
  await clickAction(leftover, "activate"); await page.waitForSelector("#orgFwBlocked"); assert.ok((await text("#orgFwReasons")).includes("Bản sao chưa đầy đủ.")); assert.equal(await count("#orgFwConfirm[disabled]"), 1); await page.click("#orgFwCancel"); await closed();
  assert.equal((await doc("curriculumFrameworks/" + leftover)).status, "draft");
  await clickAction(leftover, "delete-draft"); await page.waitForSelector("#orgFwConfirm"); await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await frameworkIds(), ["src"]); assert.equal((await list("curriculumFrameworks/")).filter((k) => !k.startsWith("curriculumFrameworks/src")).length, 0, "no orphan nodes");
  await shot("incomplete-deleted");
});

await step("clone pre-flight refusals write NOTHING: orphan/structurally invalid source, duplicate canonical codes in the source, all-retired source; source changed or Organization archived while the dialog is open", async () => {
  await setup({ frameworks: [FW("bad", "active", 30), FW("dup", "active", 31), FW("ret", "active", 32), FW("ok", "active", 33)], nodes: { bad: [NODE("a"), LESSON("o", "ghost", 0, { ancestors: ["ghost"] })], dup: [NODE("a", { code: "x1" }), NODE("b", { order: 1, code: " X1 " })], ret: [NODE("a", { status: "retired" })], ok: [NODE("a")] } });
  for (const [id, needle] of [["bad", "lỗi cấu trúc"], ["dup", "lỗi cấu trúc"], ["ret", "không có Môn/Bài nào đang sử dụng"]]) {
    await runClone(id, "Bản sao thử"); await page.waitForSelector("#orgFwErr:not(.hidden)"); assert.ok((await text("#orgFwErr")).includes(needle), id); assert.deepEqual(await allWrites(), []); assert.equal(await dialogOpen(), 1); await page.click("#orgFwCancel"); await closed();
  }
  await clickAction("ok", "clone"); await page.waitForSelector("#orgFwName"); await ev(() => window.__h.patch("curriculumFrameworks/ok", { updatedAt: window.__h.stamp(999) })); await page.click("#orgFwSubmit"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), []); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách."));
  await clickAction("ok", "clone"); await page.waitForSelector("#orgFwName"); await ev(() => window.__h.patch("organizations/orgA", { status: "archived" })); await page.click("#orgFwSubmit"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), []); assert.equal(await count("#orgCurriculumArchivedNote"), 1); assert.equal(await count('[data-fw-action="clone"]'), 0);
});

await step("delete draft: explicit confirmation (permanent wording, distinguishes LƯU TRỮ), Cancel writes nothing; confirm deletes the CHILDREN FIRST in bounded chunks and the framework LAST; no orphan nodes; audit; list updated", async () => {
  await setup({ frameworks: [FW("big", "draft", 30), FW("keep", "draft", 40)], nodes: { keep: [NODE("k1")] }, mode: "x" });
  await bigTree(850); await ev(() => window.__h.mount({})); await waitIdle(); await ev(() => { window.__h.FAKE.calls.length = 0; });
  await clickAction("big", "delete-draft"); await page.waitForSelector("#orgFwConfirm");
  assert.equal(await text("#orgFwDialogTitle"), "Xóa bản nháp?"); const copy = await text('#globalModal [role="dialog"]'); assert.ok(copy.includes("Xóa vĩnh viễn, không thể khôi phục")); assert.ok(copy.includes("LƯU TRỮ (có thể khôi phục)")); assert.equal(await ev(() => document.activeElement.id), "orgFwCancel", "safe default focus");
  await shot("delete-confirm");
  await page.click("#orgFwCancel"); await closed(); assert.deepEqual(await allWrites(), []); assert.equal(await ev(() => document.activeElement.dataset.fwAction + ":" + document.activeElement.dataset.fwId), "delete-draft:big");
  await clickAction("big", "delete-draft"); await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), ["batch:delete:400", "batch:delete:400", "batch:delete:50", "deleteDoc"], "children first, the framework LAST");
  assert.equal((await list("curriculumFrameworks/big")).length, 0, "framework and ALL nodes are gone: no orphans"); assert.equal((await nodesOf("keep")).length, 1, "other frameworks untouched");
  const a = (await audit()).at(-1); assert.deepEqual([a.action, a.entityType, a.entityId], ["curriculum.framework.deleteDraft", "curriculumFramework", "big"]); assert.deepEqual(a.detail, { organizationId: "orgA", name: "Khung big", nodeCount: 850 });
  assert.deepEqual(await rows(), ["keep:draft"]); assert.ok((await toasts()).includes("ok:Đã xóa bản nháp.")); assert.equal(await live(), "Đã xóa bản nháp."); assert.equal(await ev(() => document.activeElement.id), "orgCurriculumTitle");
});

await step("delete failure in the middle leaves a smaller DRAFT (never orphans) with an honest message; the retry deletes only what is left; permission-denied is diagnosed (never 'not found')", async () => {
  await setup({ frameworks: [FW("big", "draft", 30)], mode: "x" });
  await bigTree(850); await ev(() => window.__h.mount({})); await waitIdle();
  await ev(() => { let n = 0; window.__h.FAKE.beforeWrite = async (op) => { if (op === "batch" && ++n === 2) { window.__h.FAKE.beforeWrite = null; const e = new Error("x"); e.code = "unavailable"; throw e; } }; });
  await clickAction("big", "delete-draft"); await page.click("#orgFwConfirm"); await page.waitForSelector("#orgFwErr:not(.hidden)", { timeout: 30000 });
  const msg = await text("#orgFwErr"); assert.ok(msg.includes("Không thể kết nối máy chủ")); assert.ok(msg.includes("Khung vẫn còn")); assert.equal((await doc("curriculumFrameworks/big")).status, "draft");
  assert.equal((await nodesOf("big")).length, 450, "exactly the first chunk was removed (atomic batches)"); assert.equal(await dialogOpen(), 1);
  await ev(() => { window.__h.FAKE.calls.length = 0; });
  await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), ["batch:delete:400", "batch:delete:50", "deleteDoc"], "the retry deletes only the remaining nodes"); assert.equal((await list("curriculumFrameworks/")).length, 0);
  await setup({ frameworks: [FW("d", "draft", 30)], nodes: { d: [NODE("a")] } });
  await setFail({ op: "write", code: "permission-denied" }); await clickAction("d", "delete-draft"); await page.click("#orgFwConfirm"); await page.waitForSelector("#orgFwErr:not(.hidden)");
  const perm = await text("#orgFwErr"); assert.ok(perm.includes("Không có quyền thực hiện thao tác này")); assert.ok(!/không tìm thấy/i.test(perm)); assert.equal((await doc("curriculumFrameworks/d")).status, "draft");
});

await step("delete races: the draft was ACTIVATED elsewhere (or archived organization / framework deleted elsewhere) -> abort BEFORE any delete, reload, explanation", async () => {
  await setup({ frameworks: [FW("d", "draft", 30)], nodes: { d: [NODE("a"), NODE("b", { order: 1 })] } });
  await clickAction("d", "delete-draft"); await page.waitForSelector("#orgFwConfirm"); await ev(() => window.__h.patch("curriculumFrameworks/d", { status: "active", activatedAt: window.__h.stamp(9), statusChangedAt: window.__h.stamp(9), statusChangedBy: "pa1" }));
  await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), []); assert.equal((await nodesOf("d")).length, 2); assert.ok((await toasts()).includes("err:Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách.")); assert.equal(await count('[data-fw-id="d"][data-fw-action="delete-draft"]'), 0, "an activated framework has no delete control");
  await setup({ frameworks: [FW("d", "draft", 30)], nodes: { d: [NODE("a")] } });
  await clickAction("d", "delete-draft"); await page.waitForSelector("#orgFwConfirm"); await ev(() => window.__h.patch("organizations/orgA", { status: "archived" })); await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), []); assert.equal(await count("#orgCurriculumArchivedNote"), 1); assert.equal(await count('[data-fw-action="delete-draft"], [data-fw-action="clone"]'), 0);
  await setup({ frameworks: [FW("d", "draft", 30)], nodes: { d: [NODE("a")] } });
  await clickAction("d", "delete-draft"); await page.waitForSelector("#orgFwConfirm"); await ev(() => { window.__h.remove("curriculumFrameworks/d"); }); await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.deepEqual(await allWrites(), []); assert.ok((await toasts()).some((t) => t.includes("Không tìm thấy khung")));
});

await step("an archived framework that was previously activated is NEVER deletable: it offers only clone/restore and its documents are never touched by any S5 control", async () => {
  await setup({ frameworks: [FW("old", "archived", 30), FW("act", "active", 31)], nodes: { old: [NODE("a")], act: [NODE("b")] } });
  assert.deepEqual(await actionsOf("old"), ["clone", "restore"]); assert.deepEqual(await actionsOf("act"), ["rename", "clone", "archive"]);
  await clickAction("old", "restore"); await page.waitForSelector("#orgFwConfirm"); await page.click("#orgFwConfirm"); await closed(); await waitIdle();
  assert.equal((await doc("curriculumFrameworks/old")).status, "active"); assert.deepEqual(await actionsOf("old"), ["rename", "clone", "archive"], "a restored (previously activated) framework is still not deletable");
  assert.equal(await count('[data-fw-action="delete-draft"]'), 0);
});

await step("busy guard + dialog focus: a slow clone cannot be double-submitted; Escape/Cancel are blocked while busy; Escape/backdrop return focus to the opening control afterwards", async () => {
  await setup({ frameworks: [FW("src", "active", 30)], nodes: { src: TREE() } });
  await clickAction("src", "clone"); await page.waitForSelector("#orgFwName"); await ev(() => { window.__h.FAKE.delays.write = 300; });
  await page.click("#orgFwSubmit"); await page.waitForFunction(() => document.querySelector("#orgFwSubmit")?.textContent.includes("ĐANG NHÂN BẢN"));
  assert.equal(await page.isDisabled("#orgFwCancel"), true); await page.keyboard.press("Escape"); assert.equal(await dialogOpen(), 1, "Escape ignored while busy");
  await page.dispatchEvent("#orgFwSubmit", "click"); await closed(); await waitIdle(); await ev(() => { window.__h.FAKE.delays = {}; });
  assert.equal((await newFw(["src"])).length, 1, "exactly one clone");
  await clickAction("src", "clone"); await page.waitForSelector("#orgFwName"); await page.keyboard.press("Escape"); await closed(); assert.equal(await ev(() => document.activeElement.dataset.fwAction + ":" + document.activeElement.dataset.fwId), "clone:src");
});

await step("responsive: rows with the new buttons wrap without horizontal overflow at 375 / 768 / 1280; every control >= 44px high; no console errors in the whole run", async () => {
  await setup({ frameworks: [FW("dra", "draft", 40, { name: "Khung nháp có tên rất dài ".repeat(5).trim() }), FW("act", "active", 30)], nodes: { dra: [NODE("a")] } });
  for (const [w, h] of [[375, 800], [768, 900], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(80);
    const m = await ev(() => ({ over: document.documentElement.scrollWidth - innerWidth, small: [...document.querySelectorAll("#orgCurriculumCard button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()) }));
    assert.ok(m.over <= 0, "overflow at " + w); assert.deepEqual(m.small, [], "tap targets at " + w);
  }
  await page.setViewportSize({ width: 375, height: 800 }); await shot("phone"); await clickAction("dra", "delete-draft"); await page.waitForSelector("#orgFwConfirm"); await shot("phone-delete");
  const dlg = await ev(() => { const r = document.querySelector("#globalModal .modal").getBoundingClientRect(); return { right: r.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; }); assert.ok(dlg.right <= dlg.w + 1 && dlg.over <= 0);
  await page.click("#orgFwCancel"); await closed(); await page.setViewportSize({ width: 1100, height: 900 });
  assert.deepEqual(errors, []);
});

console.log(`ALL PASS ${results.length}/${results.length}`);
await browser.close(); server.close();
