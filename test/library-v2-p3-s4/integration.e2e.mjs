// LIBRARY V2 P3-S4 - synthetic browser flow (MON -> BAI node editor opened from the curriculum framework list inside Organization Detail): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P3-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p3-s4/integration.e2e.mjs      (optional P3S4_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p3s4-e2e-"));
writeFileSync(path.join(here, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { host: "127.0.0.1", port: 9099 }, firestore: { host: "127.0.0.1", port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }));
const PROJECT = "demo-hcma2-production-prep";
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const pkg = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const pw = await import(path.isAbsolute(pkg) ? pathToFileURL(pkg).href : pkg);
const chromium = pw.chromium || pw.default.chromium;

copyFileSync(path.join(REPO, "firestore.rules.production-candidate"), path.join(here, "firestore.rules"));
const emu = spawn("firebase.cmd", ["emulators:start", "--only", "auth,firestore", "--project", PROJECT, "--config", path.join(here, "firebase.json")], { cwd: here, shell: true, stdio: ["ignore", "pipe", "pipe"] });
let emuLog = ""; emu.stdout.on("data", (d) => (emuLog += d)); emu.stderr.on("data", (d) => (emuLog += d));
const stopEmu = () => { try { execSync(`taskkill /pid ${emu.pid} /T /F`, { stdio: "ignore" }); } catch {} };
process.on("exit", stopEmu);
async function waitFor(url, label) { for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error(`${label} did not start\n${emuLog.slice(-1500)}`); }
await waitFor("http://127.0.0.1:8080/", "firestore emulator"); await waitFor("http://127.0.0.1:9099/", "auth emulator");

function enc(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(f) {
  if ("stringValue" in f) return f.stringValue; if ("integerValue" in f) return Number(f.integerValue); if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue; if ("nullValue" in f) return null; if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) return (f.arrayValue.values || []).map(dec);
  if ("mapValue" in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, dec(v)]));
}
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const put = async (p, data) => { const r = await fetch(`${FS}/${p}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error("seed " + p + " " + r.status + " " + (await r.text())); };
const get = async (p) => { const r = await fetch(`${FS}/${p}`, { headers: H }); if (r.status === 404) return null; const j = await r.json(); return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, dec(v)])); };
const list = async (col) => { const r = await fetch(`${FS}/${col}?pageSize=300`, { headers: H }); const j = await r.json(); return (j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])) })); };
const rootCollections = async () => (await (await fetch(`${FS}:listCollectionIds`, { method: "POST", headers: H, body: "{}" })).json()).collectionIds || [];
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp " + JSON.stringify(j)); return { uid: j.localId, token: j.idToken }; }

const PASS = "Pw-" + Math.random().toString(36).slice(2) + "-A1";
const ADMIN = "quan.tri.he.thong@example.test", TEACHER = "gv.thu.nghiem@example.test";
const admin = await signUp(ADMIN, PASS), teacher = await signUp(TEACHER, PASS);
const D = (day) => new Date(Date.UTC(2026, 9, day, 0, 0, 0));
await put(`users/${admin.uid}`, { uid: admin.uid, role: "admin", status: "active", displayName: "Quản trị hệ thống (thử nghiệm)", email: ADMIN, approvedBy: null, approvedAt: null, createdAt: D(1) });
await put(`users/${teacher.uid}`, { uid: teacher.uid, role: "teacher", status: "active", displayName: "GV Thử nghiệm", email: TEACHER, approvedBy: null, approvedAt: null, createdAt: D(1) });

const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(readFileSync(p)); } catch { res.writeHead(500); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const errorsOf = (page, bucket) => { page.on("pageerror", (e) => bucket.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebChannel|net::ERR/.test(m.text())) bucket.push("console: " + m.text()); }); };
const adminErrors = [], teacherErrors = [];
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctxA.newPage(); errorsOf(page, adminErrors); page.on("dialog", (d) => d.accept());
const shot = async (p, name) => { if (process.env.P3S4_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P3S4_SHOTS, name + ".png") }); } };
const text = (sel, p = page) => p.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const navLabels = (p = page) => p.evaluate(() => [...document.querySelectorAll(".navlink")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
const orgDocs = async () => (await list("organizations"));
const auditBy = async (action) => (await list("auditLogs")).filter((a) => a.action === action);
async function login(p, email) {
  await p.goto(`${base}/index.html?emulator=1`);
  await p.waitForSelector("#loginEmail", { timeout: 60000 });
  await p.fill("#loginEmail", email); await p.fill("#loginPass", PASS); await p.click("#loginBtn");
  await p.waitForSelector(".navlink", { timeout: 60000 });
}
const openOrgs = async () => { await page.click('[data-nav="organizations"]'); await page.waitForSelector("#orgCreateBtn, #orgBackBtn, #orgRetryBtn", { timeout: 30000 }); };
const openCreate = async () => { await page.click("#orgCreateBtn"); await page.waitForSelector("#orgCreateName"); };

const live = () => text("#edLive");
let exitCode = 0;

// ---- P3-S4 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const fwDoc = (orgId, name, status, day, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, scope: "organization", name, status, createdAt: D(day), createdBy: admin.uid, updatedAt: D(day), ...(status === "draft" ? {} : { activatedAt: D(day + 1), statusChangedAt: D(day + 1), statusChangedBy: admin.uid }), ...extra });
const nodeSeed = (orgId, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn thử", status: "active", createdAt: D(6), updatedAt: D(6), ...extra });
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("organizations/orgOther", org("Đơn vị khác", "don-vi-khac"));
await put("curriculumFrameworks/fwBuild", fwDoc("orgMain", "Khung xây dựng", "draft", 5));
await put("curriculumFrameworks/fwActive", fwDoc("orgFull", "Khung đang áp dụng", "active", 5));
await put("curriculumFrameworks/fwArchived", fwDoc("orgFull", "Khung đã lưu trữ", "archived", 3));
await put("curriculumFrameworks/fwDeep", fwDoc("orgFull", "Khung nhiều cấp", "draft", 4));
await put("curriculumFrameworks/fwOther", fwDoc("orgOther", "Khung của đơn vị khác", "active", 8));
await put("curriculumFrameworks/fwArchOrg", fwDoc("orgArch", "Khung trong đơn vị lưu trữ", "active", 5));
await put("curriculumFrameworks/fwArchOrgD", fwDoc("orgArch", "Bản nháp trong đơn vị lưu trữ", "draft", 4));
await put("curriculumFrameworks/fwActive/nodes/a1", nodeSeed("orgFull", { name: "Môn đang dùng", code: "AC1" }));
await put("curriculumFrameworks/fwActive/nodes/a2", nodeSeed("orgFull", { name: "Bài đang dùng", kind: "lesson", parentId: "a1", ancestors: ["a1"] }));
await put("curriculumFrameworks/fwArchived/nodes/z1", nodeSeed("orgFull", { name: "Môn đã lưu trữ" }));
await put("curriculumFrameworks/fwArchOrg/nodes/o1", nodeSeed("orgArch", { name: "Môn của đơn vị lưu trữ" }));
await put("curriculumFrameworks/fwArchOrgD/nodes/o2", nodeSeed("orgArch", { name: "Môn nháp lưu trữ" }));
const deep = [["d1", null, [], "subject", 0], ["d2", "d1", ["d1"], "lesson", 0], ["d3", "d2", ["d1", "d2"], "unit", 0], ["d4", "d3", ["d1", "d2", "d3"], "unit", 0]];
for (const [id, parentId, ancestors, kind, order] of deep) await put(`curriculumFrameworks/fwDeep/nodes/${id}`, nodeSeed("orgFull", { name: "Nút cấp " + (ancestors.length + 1), parentId, ancestors, kind, order, code: "DP" + (ancestors.length + 1) }));
await put("curriculumFrameworks/fwDeep/nodes/foreign", nodeSeed("orgOther", { name: "Nút của đơn vị khác (không được hiện)" }));   // a node stamped with ANOTHER organization inside this framework
const count = (sel) => page.locator(sel).count();
const nodesOf = async (fwId) => (await list(`curriculumFrameworks/${fwId}/nodes`)).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
const nodeGet = (fwId, id) => get(`curriculumFrameworks/${fwId}/nodes/${id}`);
const fwGet = (id) => get(`curriculumFrameworks/${id}`);
const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent).join(" | "));
const waitSection = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 30000 });
const waitEditor = () => page.waitForFunction(() => { const b = document.querySelector("#edBody"); return b && b.getAttribute("aria-busy") === "false" && !document.querySelector("#edLoading"); }, null, { timeout: 30000 });
const openOrg = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection(); };
const openEditorOf = async (fwId) => { await page.click(`[data-fw-id="${fwId}"][data-fw-action="open"]`); await page.waitForSelector("#edTitle", { timeout: 30000 }); await waitEditor(); };
const dialogGone = () => page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'), null, { timeout: 30000 });
const btn = (action, id) => `[data-ed-action="${action}"][data-node-id="${id}"]`;
const rowIds = () => page.evaluate(() => [...document.querySelectorAll("[data-node-row]")].map((r) => r.dataset.nodeRow));
const nameOf = (id) => text(`[data-node-row="${id}"] [data-node-name]`);
const idByName = async (name) => page.evaluate((n) => { const el = [...document.querySelectorAll("[data-node-row]")].find((r) => r.querySelector("[data-node-name]").textContent.trim() === n); return el ? el.dataset.nodeRow : null; }, name);
const baselineUsers = await (async () => JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))))();
const nodeAudits = async () => (await list("auditLogs")).filter((a) => /^curriculum\.node\./.test(a.action));
let mon = null, bai1 = null, bai2 = null;

try {
  await step("Platform Admin opens Organization Detail: every framework row now has MỞ (CHỈ XEM for archived), no new top-level menu entry; MỞ replaces the detail with the editor ('← Quay lại đơn vị'); opening writes nothing", async () => {
    await login(page, ADMIN);
    assert.equal((await page.evaluate(() => document.querySelectorAll(".navlink").length)), 12);
    await openOrgs(); await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    assert.equal(await text('[data-fw-id="fwBuild"][data-fw-action="open"]'), "MỞ");
    const auditsBefore = (await list("auditLogs")).length;
    await openEditorOf("fwBuild");
    assert.equal(await count("#orgDetailTitle"), 0, "the editor replaced the detail"); assert.equal(await count("#edBack"), 1); assert.equal(await text("#edTitle"), "Khung xây dựng");
    assert.ok((await text("#edHeader")).includes("Khoa Quản trị")); assert.equal(await text("#edFwBadge"), "📝 Bản nháp");
    assert.equal(await count("#edEmpty"), 1); assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "blocked");
    assert.equal((await list("auditLogs")).length, auditsBefore); assert.equal((await nodesOf("fwBuild")).length, 0);
    await shot(page, "01-editor-empty");
  });

  await step("build from scratch THROUGH THE DEPLOYED RULES: create Môn (+ code), then two Bài with 'Thêm và nhập tiếp'; exact stored fields, orders and ancestors; audit entries; readiness turns green", async () => {
    await page.click("#edEmptyAdd"); await page.waitForSelector("#edName");
    await page.fill("#edName", "Triết học Mác - Lênin"); await page.fill("#edCode", "TRI-01"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    let nodes = await nodesOf("fwBuild"); assert.equal(nodes.length, 1); const m = nodes[0]; mon = m.id;
    assert.deepEqual(Object.keys(m).filter((k) => k !== "id").sort(), ["ancestors", "code", "createdAt", "kind", "name", "order", "organizationId", "parentId", "schemaVersion", "status", "updatedAt"]);
    assert.deepEqual([m.kind, m.parentId, m.ancestors, m.order, m.code, m.name, m.status, m.organizationId, m.schemaVersion], ["subject", null, [], 0, "TRI-01", "Triết học Mác - Lênin", "active", "orgMain", 1]);
    assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready");
    await page.click(btn("add-child", mon)); await page.waitForSelector("#edName");
    await page.fill("#edName", "Bài 1: Vật chất và ý thức"); await page.fill("#edCode", "B01"); await page.click("#edSubmitMore");
    await page.waitForFunction(() => document.querySelector("#edInfo") && !document.querySelector("#edInfo").classList.contains("hidden")); await waitEditor();
    assert.equal(await page.inputValue("#edName"), "");
    await page.fill("#edName", "Bài 2: Phép biện chứng"); await page.fill("#edCode", "B02"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    nodes = await nodesOf("fwBuild"); assert.equal(nodes.length, 3);
    const lessons = nodes.filter((n) => n.kind === "lesson"); assert.deepEqual(lessons.map((n) => [n.name, n.order, n.code, n.parentId, n.ancestors]), [["Bài 1: Vật chất và ý thức", 0, "B01", mon, [mon]], ["Bài 2: Phép biện chứng", 1, "B02", mon, [mon]]]);
    bai1 = lessons[0].id; bai2 = lessons[1].id;
    const adds = (await nodeAudits()).filter((a) => a.action === "curriculum.node.add"); assert.equal(adds.length, 3); for (const a of adds) { assert.equal(a.actorId, admin.uid); assert.equal(a.entityType, "curriculumFramework"); assert.equal(a.entityId, "fwBuild"); assert.equal(a.detail.organizationId, "orgMain"); }
    assert.equal(await text("#edSummary"), "1 Môn · 2 Bài");
    await shot(page, "02-built");
  });

  await step("canonical duplicate codes are refused in the UI with the other node named (case / whitespace / full-width), NOTHING is written; a distinct code is accepted by the Rules", async () => {
    const before = (await nodesOf("fwBuild")).length;
    await page.click(btn("add-child", mon)); await page.waitForSelector("#edName");
    for (const dup of ["b01", "  B02  ", "Ｂ０１"]) { await page.fill("#edName", "Bài trùng mã"); await page.fill("#edCode", dup); await page.click("#edSubmit"); await page.waitForSelector("#edCodeErr:not(.hidden)"); assert.ok((await text("#edCodeErr")).includes("đã được dùng bởi")); }
    assert.ok((await text("#edCodeErr")).includes("“Bài 1: Vật chất và ý thức”")); await shot(page, "03-duplicate-code");
    assert.equal((await nodesOf("fwBuild")).length, before);
    await page.fill("#edCode", "B03"); await page.fill("#edName", "Bài 3: Quy luật"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    assert.equal((await nodesOf("fwBuild")).length, before + 1);
  });

  await step("edit name/code through the Rules (only changed fields), retire a Môn with confirmation (per node: children untouched), restore without confirmation; audit entries", async () => {
    await page.click(btn("edit", bai2)); await page.waitForSelector("#edName"); await page.fill("#edName", "Bài 2: Phép biện chứng duy vật"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    let d = await nodeGet("fwBuild", bai2); assert.equal(d.name, "Bài 2: Phép biện chứng duy vật"); assert.equal(d.code, "B02"); assert.equal(d.order, 1);
    const childBefore = JSON.stringify(await nodeGet("fwBuild", bai1));
    await page.click(btn("retire", mon)); await page.waitForSelector("#edConfirm"); assert.ok((await text('#globalModal [role="dialog"]')).includes("không phải là xóa")); await shot(page, "04-retire-confirm");
    await page.click("#edConfirm"); await dialogGone(); await waitEditor();
    assert.equal((await nodeGet("fwBuild", mon)).status, "retired"); assert.equal(JSON.stringify(await nodeGet("fwBuild", bai1)), childBefore, "no cascade");
    assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "blocked"); assert.equal(await count('[data-note="parent-retired"]'), 3);
    await shot(page, "05-retired");
    await page.click(btn("restore", mon)); await waitEditor(); assert.equal((await nodeGet("fwBuild", mon)).status, "active"); assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready");
    const actions = (await nodeAudits()).map((a) => a.action); for (const a of ["curriculum.node.update", "curriculum.node.retire", "curriculum.node.restore"]) assert.ok(actions.includes(a), a);
    const upd = (await nodeAudits()).find((a) => a.action === "curriculum.node.update"); assert.deepEqual([upd.detail.from.name, upd.detail.to.name], ["Bài 2: Phép biện chứng", "Bài 2: Phép biện chứng duy vật"]);
  });

  await step("reorder Up/Down through the Rules (one atomic batch, stored orders verified); boundaries disabled", async () => {
    const lessonsOrder = async () => (await nodesOf("fwBuild")).filter((n) => n.kind === "lesson").map((n) => n.name.slice(0, 5));
    assert.deepEqual(await lessonsOrder(), ["Bài 1", "Bài 2", "Bài 3"]);
    assert.equal(await count(`${btn("up", bai1)}[disabled]`), 1);
    await page.click(btn("down", bai1)); await waitEditor(); assert.deepEqual(await lessonsOrder(), ["Bài 2", "Bài 1", "Bài 3"]);
    assert.deepEqual((await nodesOf("fwBuild")).filter((n) => n.kind === "lesson").map((n) => n.order), [0, 1, 2]);
    await page.click(btn("up", bai1)); await waitEditor(); assert.deepEqual(await lessonsOrder(), ["Bài 1", "Bài 2", "Bài 3"]);
    const b3 = await idByName("Bài 3: Quy luật"); assert.equal(await count(`${btn("down", b3)}[disabled]`), 1);
    assert.ok((await nodeAudits()).filter((a) => a.action === "curriculum.node.reorder").every((a) => a.detail.count === 2));
    assert.equal(await live(), "Đã chuyển “Bài 1: Vật chất và ý thức” lên vị trí 1/3.");
  });

  await step("full S3 + S4 path: 'Quay lại đơn vị' returns to Organization Detail with focus on the framework's MỞ and a refreshed list; the framework is now ready and ACTIVATES through the S3 dialog (accepted by the Rules)", async () => {
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.fwAction + ":" + document.activeElement.dataset.fwId), "open:fwBuild");
    await page.click('[data-fw-id="fwBuild"][data-fw-action="activate"]'); await page.waitForSelector("#orgFwConfirm:not([disabled])");
    assert.equal(await text("#orgFwStats"), "Cây chương trình: 4 nút đang hoạt động / 4 nút");
    await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    const d = await fwGet("fwBuild"); assert.equal(d.status, "active"); assert.ok(d.activatedAt);
    await openEditorOf("fwBuild"); assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "active"); assert.equal(await text("#edFwBadge"), "🟢 Đang áp dụng");
    await page.click(btn("add-child", mon)); await page.waitForSelector("#edName"); await page.fill("#edName", "Bài 4 (thêm sau kích hoạt)"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    assert.equal((await nodesOf("fwBuild")).length, 5); assert.equal((await fwGet("fwBuild")).status, "active");
    await page.click(btn("retire", await idByName("Bài 4 (thêm sau kích hoạt)"))); assert.ok((await text('#globalModal [role="dialog"]')).includes("có hiệu lực ngay")); await page.click("#edCancel"); await dialogGone();
    await shot(page, "06-active-editor");
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
  });

  await step("ARCHIVED framework opens read-only (CHỈ XEM): banner, no mutation control, disabled create with reason; the data is untouched", async () => {
    await openOrg("orgFull");
    assert.equal(await text('[data-fw-id="fwArchived"][data-fw-action="open"]'), "MỞ (CHỈ XEM)");
    const before = JSON.stringify(await nodesOf("fwArchived"));
    await openEditorOf("fwArchived");
    assert.ok((await text("#edModeBanner")).includes("Khung đã lưu trữ")); assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0); assert.equal(await count("#edAddSubject[disabled]"), 1);
    assert.equal(JSON.stringify(await nodesOf("fwArchived")), before); await shot(page, "07-archived-framework");
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
  });

  await step("ARCHIVED Organization (seeded): MỞ (CHỈ XEM) for active and draft frameworks, read-only editor with the Organization banner and no mutation control; nothing can be written", async () => {
    await openOrg("orgArch");
    for (const id of ["fwArchOrg", "fwArchOrgD"]) assert.equal(await text(`[data-fw-id="${id}"][data-fw-action="open"]`), "MỞ (CHỈ XEM)");
    await openEditorOf("fwArchOrgD");
    assert.ok((await text("#edModeBanner")).includes("Đơn vị đã lưu trữ")); assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0); assert.equal(await count("#edAddSubject[disabled]"), 1); assert.equal(await count("#edReadiness"), 0);
    assert.deepEqual(await rowIds(), ["o2"]); await shot(page, "08-archived-org");
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
  });

  await step("depth 3 / 4 seeded tree displays and is manageable (rename a depth-4 node through the Rules); a node stamped with another organization is NEVER shown (query isolation)", async () => {
    await openOrg("orgFull"); await openEditorOf("fwDeep");
    assert.deepEqual(await rowIds(), ["d1", "d2", "d3", "d4"]); assert.equal(await count('[data-node-row="foreign"]'), 0); assert.ok(!(await text("#edRoot")).includes("không được hiện"));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("[data-node-row]")].map((r) => r.dataset.nodeDepth)), ["1", "2", "3", "4"]);
    assert.equal(await count('[data-ed-action="add-child"]'), 1);
    await page.click(btn("edit", "d4")); await page.waitForSelector("#edName"); await page.fill("#edName", "Mục sâu đã đổi tên"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    const d = await nodeGet("fwDeep", "d4"); assert.equal(d.name, "Mục sâu đã đổi tên"); assert.deepEqual(d.ancestors, ["d1", "d2", "d3"]); assert.equal(d.parentId, "d3");
    await page.click(btn("retire", "d4")); await page.click("#edConfirm"); await dialogGone(); await waitEditor(); assert.equal((await nodeGet("fwDeep", "d4")).status, "retired");
    await shot(page, "09-deep");
  });

  await step("stale protection against the REAL data: the Organization is archived while the editor is open -> the next save aborts BEFORE any write and the editor repaints read-only", async () => {
    const before = JSON.stringify(await nodeGet("fwDeep", "d1"));
    await page.click(btn("edit", "d1")); await page.waitForSelector("#edName"); await page.fill("#edName", "Tên bị chặn");
    await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan", "archived"));
    await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    assert.equal(JSON.stringify(await nodeGet("fwDeep", "d1")), before); assert.ok((await toastText()).includes("Đơn vị đã được lưu trữ.")); assert.equal(await count("#edModeBanner"), 1); assert.equal(await count("[data-node-row] button[data-ed-action]:not([data-ed-action=toggle])"), 0);
    await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan"));
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
  });

  await step("the S3 list and the rest of Organization Detail still work after returning from the editor (rename a framework, members section renders)", async () => {
    await page.click('[data-fw-id="fwDeep"][data-fw-action="rename"]'); await page.waitForSelector("#orgFwName"); await page.fill("#orgFwName", "Khung nhiều cấp (đổi tên)"); await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    assert.equal((await fwGet("fwDeep")).name, "Khung nhiều cấp (đổi tên)");
    assert.equal(await count("#orgMembersCard"), 1); assert.equal(await count("#orgRenameForm"), 1); assert.equal(await count("#orgCurriculumCard"), 1);
  });

  await step("phone width: the editor has no horizontal overflow and every control is a >= 44px tap target; screenshots", async () => {
    await openEditorOf("fwDeep"); await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 1, "overflow " + overflow);
    const small = await page.evaluate(() => [...document.querySelectorAll("#edRoot button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43).length); assert.equal(small, 0);
    await shot(page, "10-mobile"); await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle");
  });

  await step("final: only the expected collections exist; every audit entry is by the Platform Admin with an expected action; no teacher/user data changed; no unexpected page error", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "curriculumFrameworks", "organizations", "users"], "no capability, import or mapping collection");
    const audits = await list("auditLogs");
    for (const a of audits) assert.equal(a.actorId, admin.uid);
    for (const a of [...new Set(audits.map((x) => x.action))]) assert.ok(/^(organization\.(members\.add|member\.(suspend|restore|remove|reinstate)|archive|restore)|curriculum\.framework\.(create|rename|activate|archive|restore)|curriculum\.node\.(add|update|retire|restore|reorder))$/.test(a), "unexpected audit action " + a);
    assert.equal(await usersViewNow(), baselineUsers);
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e) && !/PERMISSION_DENIED|permission|Missing or insufficient/i.test(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /curriculum|editor/i.test(e)), "no error mentions the curriculum modules");
    assert.equal((await list("curriculumFrameworks")).length, 7, "no framework was created or deleted by node editing");
  });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(here, "failure.png"), fullPage: true }); console.error("screenshot:", path.join(here, "failure.png")); } catch {}
  console.error("recent errors:", adminErrors.slice(-5), teacherErrors.slice(-3));
} finally {
  await browser.close().catch(() => {}); server.close(); stopEmu();
  process.exit(exitCode);
}
async function usersViewNow() { return JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))); }
