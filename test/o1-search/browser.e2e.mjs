// LIBRARY V2 O1 - synthetic browser flow (Add-Teacher exception search): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P2-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/o1-search/browser.e2e.mjs      (optional O1_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "o1-search-e2e-"));
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
const shot = async (p, name) => { if (process.env.O1_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.O1_SHOTS, name + ".png") }); } };
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

const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent).join(" | "));
// ---- O1 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
let fsPosts = 0;
page.on("request", (r) => { if (r.method() === "POST" && /google\.firestore\.v1\.Firestore\//.test(r.url())) fsPosts += 1; });
const user = (id, name, email, role = "teacher", status = "active") => put(`users/${id}`, { uid: id, role, status, displayName: name, email, approvedBy: null, approvedAt: null, createdAt: D(10), updatedAt: D(10), lastLoginAt: D(10) });
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const mem = (orgId, uid, orgRole, status, name, email) => ({ schemaVersion: 1, organizationId: orgId, uid, orgRole, status, displayName: name, email, addedBy: admin.uid, createdAt: D(2), updatedAt: D(2) });
await user("uEl", "Giảng viên Hợp lệ", "el01@example.test");
await user("uEl2", "Giảng viên Hợp lệ Hai", "el02@example.test");
await user("uAct", "Giảng viên Đã Là Thành Viên", "act01@example.test");
await user("uSus", "Giảng viên Tạm Ngưng", "sus01@example.test");
await user("uRem", "Giảng viên Đã Gỡ", "rem01@example.test");
await user("uOa", "Giảng viên Quản Trị Đơn Vị", "oadm01@example.test");
await user("uPend", "Giảng viên Chờ Duyệt", "pend01@example.test", "teacher", "pending");
await user("uLock", "Giảng viên Bị Khóa", "lock01@example.test", "teacher", "suspended");
await user("uRace", "Giảng viên Cạnh Tranh", "race01@example.test");
await user("uDbl", "Giảng viên Nhấp Đúp", "dbl01@example.test");
await user("uMid", "Giảng viên Đổi Trạng Thái", "mid01@example.test");
await user("uArch", "Giảng viên Đơn Vị Lưu Trữ", "arch01@example.test");
for (let i = 1; i <= 25; i++) await user("uB" + i, "Giảng viên Nhiều " + i, `bulk${String(i).padStart(2, "0")}@example.test`);
for (let i = 1; i <= 20; i++) await user("uX" + i, "Giảng viên Đúng Hai Mươi " + i, `exact${String(i).padStart(2, "0")}@example.test`);
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("organizationMembers/orgMain_uAct", mem("orgMain", "uAct", "member", "active", "Giảng viên Đã Là Thành Viên", "act01@example.test"));
await put("organizationMembers/orgMain_uSus", mem("orgMain", "uSus", "member", "suspended", "Giảng viên Tạm Ngưng", "sus01@example.test"));
await put("organizationMembers/orgMain_uRem", mem("orgMain", "uRem", "member", "removed", "Giảng viên Đã Gỡ", "rem01@example.test"));
await put("organizationMembers/orgMain_uOa", mem("orgMain", "uOa", "org_admin", "active", "Giảng viên Quản Trị Đơn Vị", "oadm01@example.test"));
await put("organizationMembers/orgArch_uArch", mem("orgArch", "uArch", "member", "active", "Giảng viên Đơn Vị Lưu Trữ", "arch01@example.test"));
const usersView = async () => JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id)));
const usersSnapshot = await usersView();
const memberDocs = async () => list("organizationMembers");
const addAudits = async () => (await list("auditLogs")).filter((a) => a.action === "organization.members.add");
const openOrgDetail = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); };
const openDialog = async () => { await page.click("#orgMemberAddBtn"); await page.waitForSelector("#orgSearchInput"); };
const resultsReady = () => page.waitForFunction(() => { const r = document.querySelector("#orgSearchResults"); return r && !r.querySelector(".spinner") && r.textContent.trim().length > 0 && !r.querySelector("#orgSearchHint"); }, null, { timeout: 30000 });
const searchEnter = async (term) => { await page.fill("#orgSearchInput", term); await page.press("#orgSearchInput", "Enter"); await resultsReady(); };
const searchButton = async (term) => { await page.fill("#orgSearchInput", term); await page.click("#orgSearchBtn"); await resultsReady(); };
const kindOf = (id) => page.locator(`[data-search-row="${id}"]`).getAttribute("data-search-kind");
const note = (id) => text(`[data-search-note="${id}"]`);
const rows = () => page.evaluate(() => [...document.querySelectorAll("[data-search-row]")].map((r) => r.dataset.searchRow));
const closeDialog = async () => { await page.click("#orgSearchClose"); await page.waitForFunction(() => !document.querySelector("#globalModal .modal")); };

try {
  await step("Platform Admin logs in and opens an active Organization; the Add-Teacher entry is the single header button", async () => {
    await login(page, ADMIN);
    await page.waitForFunction(() => (document.querySelector("#mainContent")?.textContent || "").trim().length > 20, null, { timeout: 30000 });
    await page.waitForTimeout(2500);                      // human pace: let the Admin overview finish its own async rendering (known pre-existing navigation race)
    await openOrgs();
    await page.click('[data-org-open="orgMain"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 });
    assert.equal(await page.locator("#orgMemberAddBtn").count(), 1);
    assert.ok(await page.isEnabled("#orgMemberAddBtn"));
  });

  await step("the dialog initially EMPTY: no teacher population, no checkbox, no TẢI THÊM, only the search box, TÌM and a hint; typing alone never searches", async () => {
    await openDialog();
    assert.ok((await text("#orgSearchRoot h3")) === "Thêm giảng viên");
    assert.equal(await page.getAttribute("#orgSearchInput", "placeholder"), "Nhập email giảng viên…");
    assert.equal(await text("#orgSearchBtn"), "TÌM");
    assert.equal(await page.locator("[data-search-row]").count(), 0);
    assert.equal(await page.locator('#globalModal input[type="checkbox"]').count(), 0);
    assert.equal(await page.locator("#orgPickerMore, #orgPickerSubmit, #orgPickerList").count(), 0, "the old picker is gone");
    assert.ok((await text("#orgSearchHint")).includes("3 ký tự đầu của email") && (await text("#orgSearchHint")).includes("TÌM"));
    const before = fsPosts;
    await page.fill("#orgSearchInput", "el0"); await page.waitForTimeout(1200);          // 3+ characters typed, but no Enter / TÌM: NO auto-search (no debounce)
    assert.equal(await page.locator("[data-search-row]").count(), 0);
    assert.ok((await text("#orgSearchHint")).length > 10);
    assert.equal(fsPosts, before, "typing never sends a Firestore request");
    await shot(page, "01-empty");
  });

  await step("fewer than 3 normalized characters never query Firestore (Enter and TÌM): a clear message, no results", async () => {
    await page.fill("#orgSearchInput", "  EL  ");
    const before = fsPosts;
    await page.press("#orgSearchInput", "Enter"); await page.waitForTimeout(1200);
    assert.ok((await text("#orgSearchResults")).includes("Nhập thêm ký tự (tối thiểu 3)."));
    await page.click("#orgSearchBtn"); await page.waitForTimeout(1200);
    assert.ok((await text("#orgSearchResults")).includes("tối thiểu 3"));
    assert.equal(await page.locator("[data-search-row]").count(), 0);
    assert.equal(fsPosts, before, "no Firestore request was sent for a 2-character term");
  });

  await step("Enter and TÌM both search (trimmed, case-insensitive): an eligible teacher gets THÊM VÀO ĐƠN VỊ; the scope-accurate empty state names what was searched", async () => {
    const postsBeforeSearch = fsPosts;
    await searchEnter("  EL01@Example.TEST ");
    assert.ok(fsPosts > postsBeforeSearch, "sanity: a real search DOES send Firestore requests, so the no-request assertions above are meaningful");
    assert.deepEqual(await rows(), ["uEl"]);
    assert.equal(await kindOf("uEl"), "eligible");
    assert.equal(await page.locator('[data-search-add="uEl"]').count(), 1);
    assert.equal(await text('[data-search-add="uEl"]'), "THÊM VÀO ĐƠN VỊ");
    assert.ok((await text("#orgSearchTerm")).includes("el01@example.test"));
    await searchButton("el0");
    assert.deepEqual((await rows()).sort(), ["uEl", "uEl2"]);
    await searchButton("zzzz");
    assert.ok((await text("#orgSearchEmpty")).includes("Không tìm thấy tài khoản nào có email bắt đầu bằng “zzzz”."));
    assert.ok(!(await text("#orgSearchResults")).includes("Hiện không có giảng viên nào chưa được thêm vào đơn vị"), "never a global claim");
    await shot(page, "02-eligible");
  });

  await step("existing memberships are information rows with the right guidance and NO add button: active, suspended, removed, Organization Admin", async () => {
    await searchEnter("act01");
    assert.equal(await kindOf("uAct"), "member-active"); assert.ok((await note("uAct")).includes("Đã là thành viên"));
    await searchEnter("sus01");
    assert.equal(await kindOf("uSus"), "member-suspended"); assert.ok((await note("uSus")).includes("Đang tạm ngưng") && (await note("uSus")).includes("Đơn vị → Thành viên"));
    await searchEnter("rem01");
    assert.equal(await kindOf("uRem"), "member-removed"); assert.ok((await note("uRem")).includes("Đã gỡ khỏi đơn vị") && (await note("uRem")).includes("Đơn vị → Thành viên → Khôi phục thành viên"));
    await shot(page, "03-removed");
    await searchEnter("oadm01");
    assert.equal(await kindOf("uOa"), "member-org-admin"); assert.ok((await note("uOa")).includes("quản trị đơn vị"));
    for (const id of ["uAct", "uSus", "uRem", "uOa"]) assert.equal(await page.locator(`[data-search-add="${id}"]`).count(), 0);
    assert.equal(await page.locator('#globalModal input[type="checkbox"]').count(), 0);
  });

  await step("accounts that are not addable are shown with a clear reason: pending teacher, locked (suspended) account, and a Platform Admin account", async () => {
    await searchEnter("pend01"); assert.equal(await kindOf("uPend"), "not-active-teacher"); assert.ok((await note("uPend")).includes("đang chờ duyệt"));
    await searchEnter("lock01"); assert.equal(await kindOf("uLock"), "not-active-teacher"); assert.ok((await note("uLock")).includes("đã bị khóa"));
    await searchEnter("quan.tri"); assert.equal(await kindOf(admin.uid), "not-active-teacher"); assert.ok((await note(admin.uid)).includes("không phải giảng viên"));
    for (const id of ["uPend", "uLock", admin.uid]) assert.equal(await page.locator(`[data-search-add="${id}"]`).count(), 0);
    assert.equal((await memberDocs()).filter((m) => ["uPend", "uLock", admin.uid].includes(m.uid)).length, 0);
  });

  await step("successful add: ONE teacher per click; confirmation naming teacher and Organization; the row becomes an existing-member state (no actionable button); toast; exact membership fields; audit with via; newest first", async () => {
    await searchEnter("el01");
    await page.click('[data-search-add="uEl"]');
    await page.waitForFunction(() => /Đã thêm/.test(document.querySelector('[data-search-note="uEl"]')?.textContent || ""), null, { timeout: 30000 });
    assert.ok((await note("uEl")).includes("✅ Đã thêm Giảng viên Hợp lệ vào Khoa Quản trị."));
    assert.equal(await page.locator('[data-search-add="uEl"]').count(), 0, "no actionable Add button remains");
    assert.match(await toastText(), /Đã thêm Giảng viên Hợp lệ vào Khoa Quản trị\./);
    const d = await get("organizationMembers/orgMain_uEl");
    assert.deepEqual(Object.keys(d).sort(), ["addedBy", "createdAt", "displayName", "email", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
    assert.deepEqual([d.orgRole, d.status, d.addedBy, d.organizationId, d.uid, d.displayName, d.email, d.schemaVersion], ["member", "active", admin.uid, "orgMain", "uEl", "Giảng viên Hợp lệ", "el01@example.test", 1]);
    const audits = await addAudits(); assert.equal(audits.length, 1);
    assert.deepEqual([audits[0].entityType, audits[0].entityId, audits[0].actorId], ["organization", "orgMain", admin.uid]);
    assert.deepEqual(audits[0].detail, { count: 1, uids: ["uEl"], skipped: 0, via: "exception-search" });
    await shot(page, "04-added");
    await searchEnter("el01");
    assert.equal(await kindOf("uEl"), "member-active", "a fresh search shows the teacher as an existing member");
    await closeDialog();
    await page.waitForSelector('[data-member-row="orgMain_uEl"]', { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelector("[data-member-row]").dataset.memberRow), "orgMain_uEl", "the new member is the first row (newest first)");
    assert.equal(await usersView(), usersSnapshot, "no users document was changed");
  });

  await step("double-click / repeated click: exactly one membership and one audit entry", async () => {
    await openDialog(); await searchEnter("dbl01");
    await page.locator('[data-search-add="uDbl"]').dblclick();
    await page.waitForFunction(() => /Đã thêm/.test(document.querySelector('[data-search-note="uDbl"]')?.textContent || ""), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    assert.equal((await memberDocs()).filter((m) => m.uid === "uDbl").length, 1);
    assert.equal((await addAudits()).filter((a) => a.detail.uids[0] === "uDbl").length, 1);
    await closeDialog();
  });

  await step("race: a membership created elsewhere while the result is on screen is detected before the write (nothing overwritten, no duplicate, no audit); platform status and Organization status changes are re-checked too", async () => {
    await openDialog(); await searchEnter("race01");
    assert.equal(await kindOf("uRace"), "eligible");
    await put("organizationMembers/orgMain_uRace", mem("orgMain", "uRace", "member", "active", "Đã được thêm trước", "truoc@example.test"));
    const before = await get("organizationMembers/orgMain_uRace");
    await page.click('[data-search-add="uRace"]');
    await page.waitForFunction(() => /Đã là thành viên/.test(document.querySelector('[data-search-note="uRace"]')?.textContent || ""), null, { timeout: 30000 });
    assert.deepEqual(await get("organizationMembers/orgMain_uRace"), before);
    assert.equal((await addAudits()).filter((a) => a.detail.uids[0] === "uRace").length, 0);
    await searchEnter("mid01");
    assert.equal(await kindOf("uMid"), "eligible");
    await put("users/uMid", { uid: "uMid", role: "teacher", status: "suspended", displayName: "Giảng viên Đổi Trạng Thái", email: "mid01@example.test", approvedBy: null, approvedAt: null, createdAt: D(10), updatedAt: D(10), lastLoginAt: D(10) });
    await page.click('[data-search-add="uMid"]');
    await page.waitForFunction(() => /đã bị khóa/.test(document.querySelector('[data-search-note="uMid"]')?.textContent || ""), null, { timeout: 30000 });
    assert.equal(await get("organizationMembers/orgMain_uMid"), null);
    await closeDialog();
  });

  await step("repeated and overlapping manual searches never show stale rows; closing during a search leaves nothing behind", async () => {
    await openDialog();
    for (let round = 0; round < 5; round++) {
      await page.evaluate(() => {
        const input = document.querySelector("#orgSearchInput"), form = document.querySelector("#orgSearchForm");
        for (const term of ["bulk0", "exact0", "act01", "el02"]) { input.value = term; form.requestSubmit(); }
      });
      await resultsReady();
      await page.waitForTimeout(400);
      assert.deepEqual(await rows(), ["uEl2"], "round " + round + ": only the LAST search is displayed");
      assert.ok((await text("#orgSearchTerm")).includes("el02"));
    }
    await page.evaluate(() => { const input = document.querySelector("#orgSearchInput"); input.value = "bulk"; document.querySelector("#orgSearchForm").requestSubmit(); });
    await page.click("#orgSearchClose");
    await page.waitForTimeout(1500);
    assert.equal(await modalOpen(), 0, "closing during a search leaves no dialog behind");
    await openDialog();
    assert.equal(await page.locator("[data-search-row]").count(), 0, "a re-opened dialog starts empty (no stale result from the closed one)");
    await closeDialog();
  });

  await step("21-result truncation: 25 matches show 20 rows and the honest 'more' note; exactly 20 matches show no note", async () => {
    await openDialog();
    await searchEnter("bulk");
    assert.equal((await rows()).length, 20);
    assert.ok((await text("#orgSearchMore")).includes("Có thêm kết quả. Hãy nhập thêm ký tự để thu hẹp tìm kiếm."));
    await shot(page, "05-more");
    await searchEnter("exact");
    assert.equal((await rows()).length, 20);
    assert.equal(await page.locator("#orgSearchMore").count(), 0, "exactly 20 matches: no 'more' note");
    await searchEnter("bulk2");
    assert.deepEqual((await rows()).length, 6);
    assert.equal(await page.locator("#orgSearchMore").count(), 0);
    await closeDialog();
  });

  await step("archived Organization: the Add-Teacher button is disabled and no dialog can be opened; an Organization archived while the dialog is open stops the write", async () => {
    await openOrgDetail("orgArch");
    assert.ok(await page.isDisabled("#orgMemberAddBtn"));
    await page.click("#orgMemberAddBtn", { force: true, timeout: 2000 }).catch(() => {});
    assert.equal(await modalOpen(), 0);
    await openOrgDetail("orgMain");
    await openDialog(); await searchEnter("el02");
    await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri", "archived"));
    await page.click('[data-search-add="uEl2"]');
    await page.waitForFunction(() => /đã được lưu trữ/.test(document.querySelector('[data-search-note="uEl2"]')?.textContent || ""), null, { timeout: 30000 });
    assert.equal(await page.locator('[data-search-add="uEl2"]').count(), 0);
    assert.equal(await get("organizationMembers/orgMain_uEl2"), null);
    await closeDialog();
    await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
  });

  await step("the S4 membership authority is unchanged: member list still newest-first with lifecycle actions; the added teacher can be suspended and restored", async () => {
    await openOrgDetail("orgMain");
    const first = await page.evaluate(() => [...document.querySelectorAll("[data-member-row]")].map((r) => r.dataset.memberRow));
    assert.ok(first.indexOf("orgMain_uDbl") < first.indexOf("orgMain_uEl"), "newest first");
    await page.click('[data-member-id="orgMain_uEl"][data-member-action="suspend"]'); await page.waitForSelector("#orgMemberConfirmOk"); await page.click("#orgMemberConfirmOk");
    await page.waitForFunction(() => /Tạm ngưng/.test(document.querySelector('[data-member-row="orgMain_uEl"]')?.textContent || ""), null, { timeout: 30000 });
    await page.click('[data-member-id="orgMain_uEl"][data-member-action="restore"]'); await page.waitForSelector("#orgMemberConfirmOk"); await page.click("#orgMemberConfirmOk");
    await page.waitForFunction(() => /Đang hoạt động/.test(document.querySelector('[data-member-row="orgMain_uEl"]')?.textContent || ""), null, { timeout: 30000 });
  });

  await step("mobile width (375px): the search dialog with results is usable without horizontal overflow", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.click("#btnHamburger"); await page.click('[data-nav="organizations"]'); await page.waitForSelector("#orgCreateBtn");
    await page.click('[data-org-open="orgMain"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 });
    await openDialog(); await searchEnter("rem01");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow");
    await shot(page, "06-mobile");
    await closeDialog();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tpage = await ctxT.newPage(); errorsOf(tpage, teacherErrors); tpage.on("dialog", (d) => d.accept());
  await step("a teacher cannot reach the search: no Đơn vị entry, and the Rules deny the email-range query on users for their token", async () => {
    await login(tpage, TEACHER);
    assert.ok(!(await navLabels(tpage)).some((l) => l.includes("Đơn vị")));
    const si = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: TEACHER, password: PASS, returnSecureToken: true }) })).json();
    const T = { Authorization: "Bearer " + si.idToken, "Content-Type": "application/json" };
    const q = { structuredQuery: { from: [{ collectionId: "users" }], where: { compositeFilter: { op: "AND", filters: [{ fieldFilter: { field: { fieldPath: "email" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: "el0" } } }, { fieldFilter: { field: { fieldPath: "email" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: "el0" + String.fromCharCode(0xf8ff) } } }] } }, orderBy: [{ field: { fieldPath: "email" }, direction: "ASCENDING" }], limit: 21 } };
    const resp = await fetch(`${FS}:runQuery`, { method: "POST", headers: T, body: JSON.stringify(q) });
    const body = await resp.json();
    assert.ok(resp.status === 403 || (Array.isArray(body) && body.some((x) => x.error)), "the teacher token is denied: " + resp.status);
  });

  await step("final: only users/organizations/organizationMembers/auditLogs exist; every add audit carries via 'exception-search'; no capabilities; no unexpected page error", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizationMembers", "organizations", "users"]);
    const adds = await addAudits();
    assert.ok(adds.length >= 2 && adds.every((a) => a.detail.count === 1 && a.detail.via === "exception-search" && a.actorId === admin.uid));
    for (const m of await memberDocs()) assert.ok(["member", "org_admin"].includes(m.orgRole));
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e)), [], "no unexpected page error");
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
