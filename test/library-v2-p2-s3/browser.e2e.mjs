// LIBRARY V2 P2-S3 - synthetic browser flow: the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P2-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p2-s3/browser.e2e.mjs      (optional P2S3_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p2s3-e2e-"));
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
const shot = async (p, name) => { if (process.env.P2S3_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P2S3_SHOTS, name + ".png") }); } };
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

let exitCode = 0, createdId = null;
try {
  await step("Platform Admin logs in (local Auth emulator); the Admin sidebar keeps its original items and gains 'Đơn vị' after 'Quản lý giảng viên'", async () => {
    await login(page, ADMIN);
    const labels = await navLabels();
    const expected = ["Tổng quan", "Đồng kiến tạo tri thức", "Quản lý giảng viên", "Đơn vị", "Lớp học", "Phiên tương tác", "QR vĩnh viễn", "Thảo luận nhóm", "Thư viện câu hỏi", "Nhật ký hoạt động", "Thống kê hệ thống", "Cài đặt"];
    assert.deepEqual(labels.map((l) => l.replace(/^\S+\s/, "")), expected);
  });

  await step("no regression: every pre-existing Admin screen still opens and renders", async () => {
    const keys = await page.evaluate(() => [...document.querySelectorAll(".navlink")].map((b) => b.dataset.nav).filter((k) => k !== "organizations"));
    assert.equal(keys.length, 11);
    for (const key of keys) {
      await page.click(`[data-nav="${key}"]`);
      await page.waitForFunction(() => (document.querySelector("#mainContent")?.textContent || "").trim().length > 20, null, { timeout: 30000 });
      assert.ok(await page.locator(`[data-nav="${key}"].active`).count(), "sidebar highlight follows " + key);
      await page.waitForTimeout(1500);                                  // human pace: let each screen finish its own async rendering
    }
    await page.click('[data-nav="library"]'); await page.waitForSelector("#alGrid", { timeout: 30000 });
  });

  await step("Đơn vị: empty state is clear and offers 'Tạo đơn vị'", async () => {
    await openOrgs();
    assert.equal(await text("#mainContent h2"), "🏢 Đơn vị");
    assert.ok((await text("#orgEmpty")).includes("Chưa có đơn vị nào"));
    assert.equal(await page.locator("#orgTable").count(), 0);
    assert.deepEqual(await rootCollections().then((c) => c.filter((x) => !["users"].includes(x))), []);
    await shot(page, "01-list-empty");
  });

  await step("create: name suggests an unaccented code; invalid input shows Vietnamese field errors; nothing is written", async () => {
    await openCreate();
    await shot(page, "02-create-modal");
    await page.fill("#orgCreateName", "Đơn vị thử nghiệm");
    assert.equal(await page.inputValue("#orgCreateCode"), "don-vi-thu-nghiem");
    await page.fill("#orgCreateName", "ab"); await page.fill("#orgCreateCode", "ab");
    await page.click("#orgCreateSubmit");
    await page.waitForFunction(() => !document.querySelector("#orgCreateNameErr")?.classList.contains("hidden"));
    assert.match(await text("#orgCreateNameErr"), /từ 3 đến 120 ký tự/); assert.match(await text("#orgCreateCodeErr"), /3–40 ký tự/);
    assert.equal((await orgDocs()).length, 0);
    await page.click("#orgCreateCancel");
    assert.equal(await modalOpen(), 0);
  });

  await step("create: valid organization is written ONLY through the contract (exact fields) and opens its detail; audit entry recorded", async () => {
    await openCreate();
    await page.fill("#orgCreateName", "Đơn vị thử nghiệm");
    await page.click("#orgCreateSubmit");
    await page.waitForSelector("#orgDetailTitle", { timeout: 30000 });
    assert.equal(await text("#orgDetailTitle"), "Đơn vị thử nghiệm"); assert.equal(await text("#orgDetailCode"), "don-vi-thu-nghiem");
    assert.ok((await text("#orgDetailStatus")).includes("Đang hoạt động"));
    const docs = await orgDocs(); assert.equal(docs.length, 1);
    const d = docs[0]; createdId = d.id;
    assert.deepEqual(Object.keys(d).sort(), ["code", "createdAt", "createdBy", "id", "name", "schemaVersion", "status", "updatedAt"]);
    assert.equal(d.status, "active"); assert.equal(d.createdBy, admin.uid); assert.equal(d.schemaVersion, 1); assert.equal(d.name, "Đơn vị thử nghiệm"); assert.equal(d.code, "don-vi-thu-nghiem");
    assert.ok(createdId && !(await page.textContent("#mainContent")).replace(/<details[\s\S]*?<\/details>/, "").includes("zzzz"));
    const audit = await auditBy("organization.create");
    assert.equal(audit.length, 1); assert.equal(audit[0].actorId, admin.uid); assert.equal(audit[0].entityType, "organization"); assert.equal(audit[0].entityId, createdId); assert.deepEqual(audit[0].detail, { name: "Đơn vị thử nghiệm", code: "don-vi-thu-nghiem" });
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizations", "users"], "no membership/capability/other collection was created");
    await shot(page, "03-detail-active");
  });

  await step("duplicate code: rejected (case-insensitive) against active and archived organizations; nothing is written; modal stays open for correction", async () => {
    await put("organizations/seedArchived", { schemaVersion: 1, name: "Trung tâm cũ", code: "trung-tam-cu", status: "archived", createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), archivedAt: D(3), archivedBy: admin.uid });
    await page.click("#orgBackBtn"); await page.waitForSelector("#orgTable");
    assert.equal(await page.locator("#orgTable tbody tr").count(), 2);
    await openCreate();
    await page.fill("#orgCreateName", "Tên khác hẳn"); await page.fill("#orgCreateCode", "DON-VI-THU-NGHIEM");
    await page.click("#orgCreateSubmit");
    await page.waitForFunction(() => !document.querySelector("#orgCreateCodeErr")?.classList.contains("hidden"));
    assert.match(await text("#orgCreateCodeErr"), /đã được dùng bởi đơn vị “Đơn vị thử nghiệm”/);
    assert.equal(await modalOpen(), 1); assert.equal((await orgDocs()).length, 2);
    await shot(page, "04-duplicate-code");
    await page.fill("#orgCreateCode", "trung-tam-cu"); await page.click("#orgCreateSubmit");
    await page.waitForFunction(() => /đã lưu trữ/.test(document.querySelector("#orgCreateCodeErr")?.textContent || ""));
    assert.equal((await orgDocs()).length, 2);
    await page.click("#orgCreateCancel");
    assert.equal((await auditBy("organization.create")).length, 1);
  });

  await step("list shows status badges (Đang hoạt động / Đã lưu trữ), hides internal ids, and flags a duplicate-code race if one ever exists", async () => {
    assert.ok((await text("#orgTable")).includes("Đang hoạt động") && (await text("#orgTable")).includes("Đã lưu trữ"));
    assert.ok(!(await text("#orgTable")).includes(createdId));
    assert.equal(await page.locator("#mainContent [role='alert']").count(), 0);
    await shot(page, "05-list-with-organizations");
    await put("organizations/seedRace", { schemaVersion: 1, name: "Trùng mã do đua", code: "don-vi-thu-nghiem", status: "active", createdAt: D(4), createdBy: admin.uid, updatedAt: D(4) });
    await page.click('[data-nav="classes"]'); await openOrgs();
    assert.equal(await page.locator("#mainContent [role='alert']").count(), 1);
    assert.match(await text("#mainContent [role='alert']"), /Có đơn vị trùng mã/);
    await shot(page, "06-duplicate-warning");
    await fetch(`${FS}/organizations/seedRace`, { method: "DELETE", headers: H });
  });

  await step("rename: validated, written via the contract (name + updatedAt only), audited; invalid and unchanged names are rejected without a write", async () => {
    await page.click('[data-nav="classes"]'); await openOrgs();
    await page.click(`[data-org-open="${createdId}"]`); await page.waitForSelector("#orgRenameForm");
    const before = await get(`organizations/${createdId}`);
    await page.fill("#orgRenameInput", "ab"); await page.click("#orgRenameBtn");
    await page.waitForFunction(() => !document.querySelector("#orgRenameErr")?.classList.contains("hidden"));
    assert.match(await text("#orgRenameErr"), /từ 3 đến 120 ký tự/);
    await page.fill("#orgRenameInput", "Đơn vị thử nghiệm"); await page.click("#orgRenameBtn");
    await page.waitForFunction(() => /Tên chưa thay đổi/.test(document.querySelector("#orgRenameErr")?.textContent || ""));
    assert.deepEqual(await get(`organizations/${createdId}`), before);
    await page.fill("#orgRenameInput", "Đơn vị đã đổi tên"); await page.click("#orgRenameBtn");
    await page.waitForFunction(() => document.querySelector("#orgDetailTitle")?.textContent === "Đơn vị đã đổi tên", null, { timeout: 30000 });
    const after = await get(`organizations/${createdId}`);
    assert.equal(after.name, "Đơn vị đã đổi tên"); assert.equal(after.code, before.code); assert.equal(after.createdAt, before.createdAt); assert.equal(after.status, "active"); assert.notEqual(after.updatedAt, before.updatedAt);
    const audit = await auditBy("organization.rename"); assert.equal(audit.length, 1); assert.deepEqual(audit[0].detail, { from: "Đơn vị thử nghiệm", to: "Đơn vị đã đổi tên" });
  });

  await step("archive: clear confirmation (cancel changes nothing); confirm archives, shows 'Đã lưu trữ', banner and a disabled rename; audited", async () => {
    await page.click("#orgArchiveBtn"); await page.waitForSelector("#orgConfirmOk");
    const dialog = await text("#globalModal .modal");
    assert.ok(dialog.includes("Lưu trữ đơn vị?") && dialog.includes("dừng mọi hoạt động mới") && dialog.includes("giữ nguyên") && dialog.includes("khôi phục bất cứ lúc nào"));
    await shot(page, "07-archive-confirm");
    await page.click("#orgConfirmCancel");
    assert.equal(await modalOpen(), 0); assert.equal((await get(`organizations/${createdId}`)).status, "active");
    await page.click("#orgArchiveBtn"); await page.click("#orgConfirmOk");
    await page.waitForSelector("#orgArchivedBanner", { timeout: 30000 });
    assert.ok((await text("#orgDetailStatus")).includes("Đã lưu trữ"));
    assert.equal(await page.locator("#orgRenameForm").count(), 0); assert.ok(await page.isDisabled("#orgRenameInput")); assert.ok((await text("#orgDetailTitle")).length > 0);
    assert.ok((await page.textContent("#mainContent")).includes("Khôi phục đơn vị để đổi tên."));
    const d = await get(`organizations/${createdId}`);
    assert.equal(d.status, "archived"); assert.equal(d.archivedBy, admin.uid); assert.ok(d.archivedAt);
    const audit = await auditBy("organization.archive"); assert.equal(audit.length, 1); assert.equal(audit[0].actorId, admin.uid);
    await shot(page, "08-detail-archived");
  });

  await step("refresh / reopen persistence: after a full page reload the archived state is still shown in the list and the detail", async () => {
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await openOrgs();
    const row = page.locator(`[data-org-row="${createdId}"]`);
    assert.ok((await row.textContent()).includes("Đã lưu trữ") && (await row.textContent()).includes("Đơn vị đã đổi tên"));
    await page.click(`[data-org-open="${createdId}"]`); await page.waitForSelector("#orgArchivedBanner");
    assert.ok((await text("#orgDetailStatus")).includes("Đã lưu trữ"));
  });

  await step("restore: confirmed, reactivates the organization (archive fields cleared), rename works again; audited", async () => {
    await page.click("#orgRestoreBtn"); await page.waitForSelector("#orgConfirmOk");
    assert.ok((await text("#globalModal .modal")).includes("hoạt động trở lại"));
    await page.click("#orgConfirmCancel"); assert.equal((await get(`organizations/${createdId}`)).status, "archived");
    await page.click("#orgRestoreBtn"); await page.click("#orgConfirmOk");
    await page.waitForSelector("#orgArchiveBtn", { timeout: 30000 });
    assert.ok((await text("#orgDetailStatus")).includes("Đang hoạt động")); assert.equal(await page.locator("#orgArchivedBanner").count(), 0);
    const d = await get(`organizations/${createdId}`);
    assert.equal(d.status, "active"); assert.equal(d.archivedAt, null); assert.equal(d.archivedBy, null);
    assert.equal((await auditBy("organization.restore")).length, 1);
    await page.fill("#orgRenameInput", "Đơn vị sau khôi phục"); await page.click("#orgRenameBtn");
    await page.waitForFunction(() => document.querySelector("#orgDetailTitle")?.textContent === "Đơn vị sau khôi phục", null, { timeout: 30000 });
  });

  await step("a failing write is reported to the administrator in Vietnamese and leaves the data unchanged (the organization document is removed behind the screen)", async () => {
    const snapshot = await get(`organizations/${createdId}`);
    await fetch(`${FS}/organizations/${createdId}`, { method: "DELETE", headers: H });
    await page.click("#orgArchiveBtn"); await page.click("#orgConfirmOk");
    await page.waitForFunction(() => !document.querySelector("#orgConfirmErr")?.classList.contains("hidden"), null, { timeout: 30000 });
    assert.ok((await text("#orgConfirmErr")).length > 5);
    assert.equal(await modalOpen(), 1, "the dialog stays open so the administrator can retry or cancel");
    assert.equal(await get(`organizations/${createdId}`), null);
    assert.equal((await auditBy("organization.archive")).length, 1, "no audit entry for the failed action");
    await page.click("#orgConfirmCancel");
    await put(`organizations/${createdId}`, snapshot);
  });

  await step("mobile width (375px): list and detail are usable without horizontal overflow", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.click("#btnHamburger"); await page.click('[data-nav="organizations"]'); await page.waitForSelector("#orgCreateBtn");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(await overflow(), "list: no horizontal overflow");
    await shot(page, "09-list-mobile");
    await page.click(`[data-org-open="${createdId}"]`); await page.waitForSelector("#orgDetailTitle");
    assert.ok(await overflow(), "detail: no horizontal overflow");
    await shot(page, "10-detail-mobile");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ---------------------------------------------------------------- non-Platform-Admin
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tpage = await ctxT.newPage(); errorsOf(tpage, teacherErrors); tpage.on("dialog", (d) => d.accept());
  await step("a teacher has no access: no 'Đơn vị' entry, and the Rules deny organization writes and listing for their token", async () => {
    await login(tpage, TEACHER);
    const labels = await navLabels(tpage);
    assert.ok(!labels.some((l) => l.includes("Đơn vị")), "teacher sidebar has no organization entry");
    assert.equal(await tpage.locator('[data-nav="organizations"]').count(), 0);
    const signIn = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: TEACHER, password: PASS, returnSecureToken: true }) })).json();
    const T = { Authorization: "Bearer " + signIn.idToken, "Content-Type": "application/json" };
    const create = await fetch(`${FS}/organizations/tryTeacher`, { method: "PATCH", headers: T, body: JSON.stringify({ fields: { schemaVersion: { integerValue: "1" }, name: { stringValue: "Không được" }, code: { stringValue: "khong-duoc" }, status: { stringValue: "active" } } }) });
    assert.equal(create.status, 403);
    assert.equal((await fetch(`${FS}/organizations?pageSize=5`, { headers: T })).status, 403);
    assert.equal((await orgDocs()).filter((o) => o.id === "tryTeacher").length, 0);
  });

  await step("P1 Library navigation is unchanged for teachers (hub, Tạo tương tác child, inert Thảo luận nhóm, Back)", async () => {
    await tpage.click('[data-nav="library"]'); await tpage.waitForSelector(".library-hub-grid");
    assert.equal(await tpage.locator("button.library-hub-card").count(), 1);
    assert.ok((await tpage.textContent('[data-library-upcoming="group"]')).includes("ĐANG CHUẨN BỊ"));
    await tpage.click("#openInteractionLibrary"); await tpage.waitForSelector("#backToLibraryHub");
    assert.ok((await tpage.textContent(".library-scope")).includes("DÙNG CHUNG ĐƠN VỊ") && (await tpage.textContent(".library-scope")).includes("Sắp có"));
    assert.ok(await tpage.isDisabled(".library-scope-pill.is-soon"));
    await tpage.click("#backToLibraryHub"); await tpage.waitForSelector(".library-hub-grid");
    assert.equal(await tpage.locator('[data-nav="library"].active').count(), 1);
  });

  await step("final: only users, organizations (synthetic) and auditLogs exist; every audit entry is by the Platform Admin; no page errors beyond the known pre-existing race", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizations", "users"]);
    for (const a of await list("auditLogs")) assert.equal(a.actorId, admin.uid);
    // Pre-existing rapid-navigation races of OTHER Admin/Teacher screens (identical errors reproduced on the S2 baseline tree without any S3 code
    // by the same click-through): adminOverview / adminLibrary / adminAuditLog / teacherOverview write into the DOM after the user already left, and a chart canvas.
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null (setting .innerHTML.)|Cannot read properties of null (reading .innerHTML.)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e)), [], "no error from the new screen or anything else");
    assert.ok(!all.some((e) => /organization/i.test(e)), "no error mentions the organization screen");
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
