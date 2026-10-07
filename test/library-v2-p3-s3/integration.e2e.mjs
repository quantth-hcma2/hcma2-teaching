// LIBRARY V2 P3-S3 - synthetic browser flow (curriculum framework list + lifecycle inside Organization Detail): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P3-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p3-s3/integration.e2e.mjs      (optional P3S3_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p3s3-e2e-"));
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
const shot = async (p, name) => { if (process.env.P3S3_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P3S3_SHOTS, name + ".png") }); } };
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
const modalOpen = () => page.locator("#globalModal .modal").count();


let exitCode = 0;

// ---- P3-S3 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const fwDoc = (orgId, name, status, day, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, scope: "organization", name, status, createdAt: D(day), createdBy: admin.uid, updatedAt: D(day), ...(status === "draft" ? {} : { activatedAt: D(day + 1), statusChangedAt: D(day + 1), statusChangedBy: admin.uid }), ...extra });
const nodeDoc = (orgId, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn thử", status: "active", createdAt: D(6), updatedAt: D(6), ...extra });
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("organizations/orgOther", org("Đơn vị khác", "don-vi-khac"));
await put("curriculumFrameworks/fwA1", fwDoc("orgFull", "Chương trình A1 (cũ)", "active", 5));
await put("curriculumFrameworks/fwA2", fwDoc("orgFull", "Chương trình A2 (mới)", "active", 9));
await put("curriculumFrameworks/fwD1", fwDoc("orgFull", "Bản nháp D1", "draft", 7));
await put("curriculumFrameworks/fwD2", fwDoc("orgFull", "Bản nháp D2", "draft", 3));
await put("curriculumFrameworks/fwZ1", fwDoc("orgFull", "Khung lưu trữ Z1", "archived", 2));
await put("curriculumFrameworks/fwOther", fwDoc("orgOther", "Khung của đơn vị khác", "active", 8));
await put("curriculumFrameworks/fwArchA", fwDoc("orgArch", "Khung đang áp dụng (đơn vị lưu trữ)", "active", 5));
await put("curriculumFrameworks/fwArchD", fwDoc("orgArch", "Bản nháp (đơn vị lưu trữ)", "draft", 4));
await put("curriculumFrameworks/fwArchZ", fwDoc("orgArch", "Khung lưu trữ (đơn vị lưu trữ)", "archived", 3));
for (let i = 1; i <= 3; i++) { const uid = "m0" + i; await put(`organizationMembers/orgFull_${uid}`, { schemaVersion: 1, organizationId: "orgFull", uid, orgRole: "member", status: "active", displayName: "Thành viên " + i, email: uid + "@example.test", addedBy: admin.uid, createdAt: D(2 + i), updatedAt: D(2 + i) }); }
const count = (sel) => page.locator(sel).count();
const fws = async (orgId) => (await list("curriculumFrameworks")).filter((f) => f.organizationId === orgId);
const fwGet = (id) => get(`curriculumFrameworks/${id}`);
const rows = () => page.evaluate(() => [...document.querySelectorAll("[data-fw-row]")].map((r) => r.dataset.fwRow + ":" + r.dataset.fwStatus));
const actionsOf = (id) => page.evaluate((i) => [...document.querySelectorAll(`[data-fw-id="${i}"][data-fw-action]`)].map((b) => b.dataset.fwAction), id);
const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent).join(" | "));
const waitSection = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 30000 });
const openOrg = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection(); };
const dialogGone = () => page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'), null, { timeout: 30000 });
const clickAction = (id, action) => page.click(`[data-fw-id="${id}"][data-fw-action="${action}"]`);
const baselineUsers = await (async () => JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))))();
let createdId = null;

try {
  await step("Platform Admin logs in; Organization Detail now shows the curriculum card ABOVE the members card; the rest of the screen is unchanged", async () => {
    await login(page, ADMIN);
    const keys = await page.evaluate(() => [...document.querySelectorAll(".navlink")].map((b) => b.dataset.nav)); assert.equal(keys.length, 12);   // no new top-level Admin menu entry
    await openOrgs(); await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    const order = await page.evaluate(() => { const c = document.querySelector("#orgCurriculumSection"), m = document.querySelector("#orgMembersSection"); return !!(c && m && (c.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)); }); assert.ok(order, "curriculum section precedes members section");
    assert.equal(await count("#orgCurriculumSection #orgCurriculumCard"), 1);
    assert.equal(await count("#orgRenameForm"), 1); assert.equal(await count("#orgArchiveBtn"), 1); assert.equal(await count("#orgPrimaryActions #orgMemberAddBtn"), 1); assert.equal(await count("#orgMembersCard"), 1); assert.equal(await count("#orgActionErr"), 1);
    assert.ok((await text("#orgCurriculumEmpty")).includes("Chưa có khung chương trình")); assert.equal(await count("#orgFwCreateBtn:not([disabled])"), 1);
    assert.equal(await count('[data-fw-action="open"]'), 0); assert.ok(!(await text("#orgCurriculumCard")).includes("Sắp có"));
    assert.deepEqual((await fws("orgMain")).length, 0);
    await shot(page, "01-org-detail-empty");
  });

  await step("create: validation error writes nothing; a valid name creates ONE draft through the deployed Rules with the exact fields, an audit entry, and shows it under Bản nháp", async () => {
    await page.click("#orgFwCreateBtn"); await page.waitForSelector("#orgFwName");
    await page.fill("#orgFwName", "ab"); await page.click("#orgFwSubmit"); await page.waitForSelector("#orgFwNameErr:not(.hidden)");
    assert.equal(await text("#orgFwNameErr"), "Tên khung cần từ 3 đến 120 ký tự."); assert.equal((await fws("orgMain")).length, 0);
    await page.fill("#orgFwName", "  Chương trình thử nghiệm  "); await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    const list1 = await fws("orgMain"); assert.equal(list1.length, 1); const d = list1[0]; createdId = d.id;
    assert.deepEqual(Object.keys(d).filter((k) => k !== "id").sort(), ["createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
    assert.deepEqual([d.name, d.organizationId, d.scope, d.status, d.createdBy, d.schemaVersion], ["Chương trình thử nghiệm", "orgMain", "organization", "draft", admin.uid, 1]);
    assert.deepEqual(await rows(), [createdId + ":draft"]); assert.ok((await toastText()).includes("Đã tạo khung chương trình."));
    const a = await auditBy("curriculum.framework.create"); assert.equal(a.length, 1); assert.equal(a[0].actorId, admin.uid); assert.equal(a[0].entityType, "curriculumFramework"); assert.equal(a[0].entityId, createdId); assert.deepEqual(a[0].detail, { organizationId: "orgMain", name: "Chương trình thử nghiệm" });
    assert.deepEqual(await actionsOf(createdId), ["rename", "activate"]);
    await shot(page, "02-created-draft");
  });

  await step("rename through the Rules: only name/updatedAt change; audit records from/to", async () => {
    await clickAction(createdId, "rename"); await page.waitForSelector("#orgFwName");
    await page.click("#orgFwSubmit"); assert.equal(await text("#orgFwNameErr"), "Tên chưa thay đổi.");
    await page.fill("#orgFwName", "Chương trình LLCT 2026"); await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    const d = await fwGet(createdId); assert.equal(d.name, "Chương trình LLCT 2026"); assert.equal(d.status, "draft"); assert.ok(!("activatedAt" in d));
    const a = await auditBy("curriculum.framework.rename"); assert.equal(a.length, 1); assert.deepEqual([a[0].detail.from, a[0].detail.to], ["Chương trình thử nghiệm", "Chương trình LLCT 2026"]);
  });

  await step("activation is BLOCKED for a draft without a Môn: plain-language reason, confirm disabled, NOTHING written", async () => {
    const before = JSON.stringify(await fwGet(createdId));
    await clickAction(createdId, "activate"); await page.waitForSelector("#orgFwBlocked");
    assert.ok((await text("#orgFwReasons")).includes("Cần ít nhất một Môn đang hoạt động.")); assert.equal(await count("#orgFwConfirm[disabled]"), 1);
    await shot(page, "03-activation-blocked");
    await page.click("#orgFwCancel"); await dialogGone();
    assert.equal(JSON.stringify(await fwGet(createdId)), before); assert.equal((await auditBy("curriculum.framework.activate")).length, 0);
  });

  await step("activation READY and accepted by the deployed Rules (nodes seeded out of band; node editing is P3-S4): exact transition, activatedAt stamped, audit with counts, row moves to Đang áp dụng", async () => {
    await put(`curriculumFrameworks/${createdId}/nodes/s1`, nodeDoc("orgMain", { name: "Môn 1" }));
    await put(`curriculumFrameworks/${createdId}/nodes/l1`, nodeDoc("orgMain", { kind: "lesson", parentId: "s1", ancestors: ["s1"], name: "Bài 1" }));
    await clickAction(createdId, "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled])");
    assert.equal(await text("#orgFwStats"), "Cây chương trình: 2 nút đang hoạt động / 2 nút");
    await shot(page, "04-activation-ready");
    await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    const d = await fwGet(createdId); assert.equal(d.status, "active"); assert.ok(d.activatedAt); assert.equal(d.statusChangedBy, admin.uid); assert.ok(d.statusChangedAt);
    const a = await auditBy("curriculum.framework.activate"); assert.equal(a.length, 1); assert.deepEqual([a[0].detail.nodeCount, a[0].detail.activeCount], [2, 2]);
    assert.deepEqual(await rows(), [createdId + ":active"]); assert.deepEqual(await actionsOf(createdId), ["rename", "archive"]);
  });

  await step("archive (confirmation) and restore (confirmation) through the Rules; activatedAt never changes; the framework is read-only while archived", async () => {
    const first = (await fwGet(createdId)).activatedAt;
    await clickAction(createdId, "archive"); await page.waitForSelector("#orgFwConfirm"); assert.ok((await text('#globalModal [role="dialog"]')).includes("không sửa được"));
    await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    let d = await fwGet(createdId); assert.equal(d.status, "archived"); assert.equal(d.activatedAt, first); assert.deepEqual(await actionsOf(createdId), ["restore"]);
    await clickAction(createdId, "restore"); await page.waitForSelector("#orgFwConfirm"); await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    d = await fwGet(createdId); assert.equal(d.status, "active"); assert.equal(d.activatedAt, first);
    assert.deepEqual((await list("auditLogs")).filter((x) => /^curriculum\.framework\.(archive|restore)$/.test(x.action)).map((x) => x.action).sort(), ["curriculum.framework.archive", "curriculum.framework.restore"]);
  });

  await step("populated Organization: grouped and ordered active -> draft -> archived, newest first; frameworks of ANOTHER organization never appear; no Open control", async () => {
    await openOrg("orgFull");
    assert.deepEqual(await rows(), ["fwA2:active", "fwA1:active", "fwD1:draft", "fwD2:draft", "fwZ1:archived"]);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("[data-fw-group]")].map((g) => g.textContent.replace(/\s+/g, " ").trim())), ["Đang áp dụng (2)", "Bản nháp (2)", "Đã lưu trữ (1)"]);
    assert.equal(await text("#orgCurriculumSummary"), "5 khung · 2 đang áp dụng · 2 bản nháp · 1 đã lưu trữ"); assert.equal(await count('[data-fw-id="fwOther"]'), 0);
    assert.equal(await count('[data-fw-action="open"]'), 0); assert.equal(await count("#orgCurriculumTruncated"), 0);
    await shot(page, "05-populated");
  });

  await step("a framework deleted elsewhere / changed elsewhere between load and action: stale protection aborts without writing and reloads", async () => {
    await clickAction("fwD2", "rename"); await page.waitForSelector("#orgFwName"); await page.fill("#orgFwName", "Tên mới của D2");
    const before = JSON.stringify(await fwGet("fwD2"));
    await put("curriculumFrameworks/fwD2", fwDoc("orgFull", "Bản nháp D2", "draft", 3, { updatedAt: D(20) }));        // another admin touched it (updatedAt moved)
    await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    assert.ok((await toastText()).includes("Khung đã được thay đổi ở nơi khác.")); assert.notEqual(JSON.stringify(await fwGet("fwD2")), before); assert.equal((await fwGet("fwD2")).name, "Bản nháp D2");
    await put("curriculumFrameworks/fwD2", fwDoc("orgFull", "Bản nháp D2", "draft", 3));
    await page.reload(); await page.waitForSelector(".navlink"); await openOrg("orgFull");
    await clickAction("fwD2", "rename"); await page.waitForSelector("#orgFwName"); await page.fill("#orgFwName", "Tên khi đã bị xóa");
    await fetch(`${FS}/curriculumFrameworks/fwD2`, { method: "DELETE", headers: H });
    await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    assert.ok((await toastText()).includes("Không tìm thấy khung")); assert.ok(!(await rows()).some((r) => r.startsWith("fwD2")));
    await put("curriculumFrameworks/fwD2", fwDoc("orgFull", "Bản nháp D2", "draft", 3));
  });

  await step("the organization is archived while the create dialog is open: the fresh pre-check aborts, NO framework is written, the section repaints read-only", async () => {
    await page.reload(); await page.waitForSelector(".navlink"); await openOrg("orgFull");
    const before = (await fws("orgFull")).length;
    await page.click("#orgFwCreateBtn"); await page.fill("#orgFwName", "Khung bị chặn");
    await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan", "archived"));
    await page.click("#orgFwSubmit"); await page.waitForSelector("#orgCurriculumArchivedNote", { timeout: 30000 }); await waitSection();
    assert.equal((await fws("orgFull")).length, before); assert.ok((await toastText()).includes("Đơn vị đã được lưu trữ.")); assert.equal(await page.locator('#globalModal [role="dialog"]').count(), 0);
    await put("organizations/orgFull", org("Khoa Lý luận", "khoa-ly-luan"));
  });

  await step("ARCHIVED organization (seeded): curriculum readable, banner + disabled create with visible reason, NO mutation control on any row; the real Rules would reject every write", async () => {
    await page.reload(); await page.waitForSelector(".navlink"); await openOrg("orgArch");
    assert.equal(await count("#orgCurriculumArchivedNote"), 1); assert.equal(await count("#orgFwCreateBtn[disabled]"), 1); assert.ok((await text("#orgFwCreateHint")).includes("Đơn vị đã lưu trữ"));
    assert.deepEqual(await rows(), ["fwArchA:active", "fwArchD:draft", "fwArchZ:archived"]); assert.equal(await count("[data-fw-action]"), 0);
    await page.click("#orgFwCreateBtn", { force: true, timeout: 800 }).catch(() => {});
    assert.equal(await page.locator('#globalModal [role="dialog"]').count(), 0);
    await shot(page, "06-archived-org");
  });

  await step("lifecycle integration: archiving an organization through the EXISTING screen flips the curriculum section to read-only on repaint; restoring makes it writable again", async () => {
    await page.reload(); await page.waitForSelector(".navlink"); await openOrg("orgFull");
    assert.equal(await count("#orgFwCreateBtn:not([disabled])"), 1);
    await page.click("#orgArchiveBtn"); await page.waitForSelector("#orgConfirmOk"); await page.click("#orgConfirmOk");
    await page.waitForSelector("#orgCurriculumArchivedNote", { timeout: 30000 }); await waitSection();
    assert.equal(await count("[data-fw-action]"), 0); assert.equal(await count("#orgFwCreateBtn[disabled]"), 1);
    await page.click("#orgRestoreBtn"); await page.waitForSelector("#orgConfirmOk"); await page.click("#orgConfirmOk");
    await page.waitForSelector("#orgArchiveBtn", { timeout: 30000 }); await waitSection();
    assert.equal(await count("#orgCurriculumArchivedNote"), 0); assert.equal(await count("#orgFwCreateBtn:not([disabled])"), 1); assert.ok((await actionsOf("fwD1")).includes("activate"));
  });

  await step("members section regression: still renders its card, summary and rows under the curriculum card; a member action still works through the Rules", async () => {
    assert.equal(await count("#orgMembersCard"), 1); assert.equal(await count("[data-member-row]"), 3); assert.ok((await text("#orgMembersSummary")).length > 0);
    assert.equal(await count("#orgPrimaryActions #orgMemberAddBtn"), 1);
    await page.click('[data-member-id="orgFull_m01"][data-member-action="suspend"]'); await page.waitForSelector("#orgMemberConfirmOk"); await page.click("#orgMemberConfirmOk");
    await page.waitForFunction(() => !document.querySelector("#orgMemberConfirmOk"), null, { timeout: 30000 }); await page.waitForSelector("#orgMembersCard");
    assert.equal((await get("organizationMembers/orgFull_m01")).status, "suspended");
    assert.equal(await count("#orgCurriculumCard"), 1);
  });

  await step("phone width: Organization Detail has no horizontal overflow and every curriculum button is a >= 44px tap target; screenshots", async () => {
    await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);   // the Organization Detail stays open; the layout simply reflows
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 1, "overflow " + overflow);
    const small = await page.evaluate(() => [...document.querySelectorAll("#orgCurriculumCard button")].filter((b) => b.getBoundingClientRect().height < 43).length); assert.equal(small, 0);
    await shot(page, "07-mobile"); await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("final: only the expected collections exist; every audit entry is by the Platform Admin with an expected action; no teacher/user data changed; no unexpected page error", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "curriculumFrameworks", "organizationMembers", "organizations", "users"], "no capability, import or mapping collection");
    const audits = await list("auditLogs");
    for (const a of audits) assert.equal(a.actorId, admin.uid);
    for (const a of [...new Set(audits.map((x) => x.action))]) assert.ok(/^(organization\.(members\.add|member\.(suspend|restore|remove|reinstate)|archive|restore)|curriculum\.framework\.(create|rename|activate|archive|restore))$/.test(a), "unexpected audit action " + a);
    assert.equal(await usersViewNow(), baselineUsers);
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e) && !/PERMISSION_DENIED|permission|Missing or insufficient/i.test(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /curriculum/i.test(e)), "no error mentions the curriculum section");
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
