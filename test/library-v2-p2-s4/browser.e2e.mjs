// LIBRARY V2 P2-S4 - synthetic browser flow (ordinary membership management): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P2-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p2-s4/browser.e2e.mjs      (optional P2S4_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p2s4-e2e-"));
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
const shot = async (p, name) => { if (process.env.P2S4_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P2S4_SHOTS, name + ".png") }); } };
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

// ---- P2-S4 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
const tsusp = await signUp("gv.tam.khoa@example.test", PASS);
await put(`users/${tsusp.uid}`, { uid: tsusp.uid, role: "teacher", status: "suspended", displayName: "GV Tạm khóa", email: "gv.tam.khoa@example.test", approvedBy: null, approvedAt: null, createdAt: D(2) });
await put("users/tpend", { uid: "tpend", role: "teacher", status: "pending", displayName: "GV Chờ duyệt", email: "gv.cho.duyet@example.test", approvedBy: null, approvedAt: null, createdAt: D(2) });
const NAMES = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Hoàng Cường", "Phạm Thu Dung", "Đỗ Minh Em", "Vũ Quốc Phong", "Hoàng Lan Giang", "Bùi Thanh Hà"];
for (let i = 1; i <= 8; i++) { const id = "t0" + i; await put(`users/${id}`, { uid: id, role: "teacher", status: "active", displayName: NAMES[i - 1], email: `gv0${i}@example.test`, approvedBy: null, approvedAt: null, createdAt: D(10 + i) }); }
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const mem = (orgId, uid, orgRole = "member", status = "active", extra = {}) => ({ schemaVersion: 1, organizationId: orgId, uid, orgRole, status, displayName: "Snapshot " + uid, email: uid + "@example.test", addedBy: admin.uid, createdAt: D(2), updatedAt: D(2), ...extra });
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgPaged", org("Đơn vị nhiều thành viên", "nhieu-thanh-vien"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("organizations/orgTemp", org("Đơn vị tạm", "don-vi-tam"));
for (let i = 0; i < 30; i++) { const uid = "pg" + String(i).padStart(2, "0"); await put(`organizationMembers/orgPaged_${uid}`, mem("orgPaged", uid, "member", "active", { displayName: "Thành viên " + String(i).padStart(2, "0") })); }
await put("organizationMembers/orgArch_aM1", mem("orgArch", "aM1", "member", "active", { displayName: "Thành viên đơn vị cũ" }));
await put("organizationMembers/orgArch_aM2", mem("orgArch", "aM2", "member", "suspended", { displayName: "Thành viên tạm ngưng cũ" }));
await put("organizationMembers/orgTemp_oaTemp", mem("orgTemp", "oaTemp", "org_admin", "active", { displayName: "Quản trị đơn vị tạm" }));
await put("organizationMembers/orgTemp_mTemp", mem("orgTemp", "mTemp", "member", "active", { displayName: "Thành viên đơn vị tạm" }));
await put(`organizationMembers/orgTemp_${tsusp.uid}`, mem("orgTemp", tsusp.uid, "member", "active", { displayName: "GV Tạm khóa (snapshot)" }));
// the existing login routine stamps lastLoginAt/updatedAt on a user's OWN profile; those two keys are excluded, everything else must stay identical
const usersView = async () => JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id)));
const usersSnapshot = await usersView();
const members = async (orgId) => (await list("organizationMembers")).filter((m) => m.organizationId === orgId);
const memberOf = (orgId, uid) => get(`organizationMembers/${orgId}_${uid}`);
const rowOrder = () => page.evaluate(() => [...document.querySelectorAll("[data-member-row]")].map((r) => r.dataset.memberRow.replace(/^[^_]+_/, "")));
const row = (orgId, uid) => page.locator(`[data-member-row="${orgId}_${uid}"]`);
const rowText = async (orgId, uid) => ((await row(orgId, uid).textContent()) || "").replace(/\s+/g, " ").trim();
const openOrg = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); };
const openPicker = async () => { await page.click("#orgMemberAddBtn"); await page.waitForSelector("#orgPickerList"); };
const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent).join(" | "));
const act = async (orgId, uid, action) => { await page.click(`[data-member-id="${orgId}_${uid}"][data-member-action="${action}"]`); await page.waitForSelector("#orgMemberConfirmOk"); };
const confirmOk = async () => { await page.click("#orgMemberConfirmOk"); await page.waitForFunction(() => !document.querySelector("#orgMemberConfirmOk"), null, { timeout: 30000 }); await page.waitForSelector("#orgMembersCard"); };

try {
  await step("Platform Admin logs in; the existing Admin screens and the S3 organization list still work", async () => {
    await login(page, ADMIN);
    const keys = await page.evaluate(() => [...document.querySelectorAll(".navlink")].map((b) => b.dataset.nav));
    assert.equal(keys.length, 12);
    assert.deepEqual(keys.slice(0, 4), ["overview", "knowledge", "teachers", "organizations"]);
    for (const key of keys.filter((k) => k !== "organizations")) { await page.click(`[data-nav="${key}"]`); await page.waitForFunction(() => (document.querySelector("#mainContent")?.textContent || "").trim().length > 20, null, { timeout: 30000 }); await page.waitForTimeout(1200); }
    await openOrgs();
    assert.equal(await page.locator("#orgTable tbody tr").count(), 4);
    assert.equal(await page.locator("#orgCreateBtn").count(), 1);
  });

  await step("empty member state: the organization detail keeps its lifecycle UI and shows a clear empty members section", async () => {
    await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersCard", { timeout: 30000 });
    assert.equal(await page.locator("#orgRenameForm").count(), 1); assert.equal(await page.locator("#orgArchiveBtn").count(), 1); assert.equal(await page.locator("#orgDetailCode").count(), 1);
    assert.ok((await text("#orgMembersEmpty")).includes("Chưa có thành viên"));
    assert.equal(await page.locator("#orgMembersTable").count(), 0);
    // Add Teacher is promoted to the upper Organization Detail action area: ONE button, outside the member card, visible without scrolling.
    assert.equal(await page.locator("#orgMemberAddBtn").count(), 1, "exactly one add button");
    assert.equal(await page.locator("#orgMembersCard #orgMemberAddBtn").count(), 0, "not inside the member card");
    assert.equal(await page.locator("#orgPrimaryActions #orgMemberAddBtn").count(), 1);
    assert.ok(await page.isEnabled("#orgMemberAddBtn"));
    assert.ok(await page.evaluate(() => { const r = document.querySelector("#orgMemberAddBtn").getBoundingClientRect(); const c = document.querySelector("#orgMembersCard").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.top < c.top; }), "visible in the viewport above the member card, no scrolling");
    assert.equal(await page.locator("#orgMembersSummary").count(), 0, "empty list shows no summary");
    assert.ok((await text("#orgMembersCard")).includes("không phải dữ liệu tài khoản"));
    assert.equal((await members("orgMain")).length, 0);
    await shot(page, "01-members-empty");
  });

  await step("add dialog: only ACTIVE teachers are offered (no suspended, pending or admin accounts); submit stays disabled until a selection; search narrows the list", async () => {
    await openPicker();
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-picker-check]")].map((c) => c.dataset.pickerCheck));
    assert.ok(["t01", "t02", "t03", "t04", "t05", "t06", "t07", "t08"].every((id) => ids.includes(id)));
    assert.ok(!ids.includes("tpend") && !ids.includes(tsusp.uid) && !ids.includes(admin.uid), "suspended, pending and admin accounts are never offered");
    assert.ok(await page.isDisabled("#orgPickerSubmit"));
    assert.ok((await text("#orgPickerList")).includes("Nguyễn Văn An") && (await text("#orgPickerList")).includes("gv01@example.test"));
    await page.fill("#orgPickerSearch", "trần thị");
    await page.waitForFunction(() => document.querySelectorAll("[data-picker-check]").length === 1);
    assert.equal(await page.locator('[data-picker-check="t02"]').count(), 1);
    await shot(page, "02-picker");
    await page.fill("#orgPickerSearch", "");
    await page.click("#orgPickerCancel");
    assert.equal(await modalOpen(), 0);
    assert.equal((await members("orgMain")).length, 0, "nothing was added automatically");
  });

  await step("add ONE teacher: written only through the contract (exact fields, ordinary member, display snapshot), listed immediately, audited once", async () => {
    await openPicker();
    await page.check('[data-picker-check="t01"]');
    assert.equal(await text("#orgPickerCount"), "1");
    await page.click("#orgPickerSubmit");
    await page.waitForSelector("#orgMembersTable", { timeout: 30000 });
    assert.equal(await modalOpen(), 0);
    const d = await memberOf("orgMain", "t01");
    assert.deepEqual(Object.keys(d).sort(), ["addedBy", "createdAt", "displayName", "email", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
    assert.equal(d.orgRole, "member"); assert.equal(d.status, "active"); assert.equal(d.addedBy, admin.uid); assert.equal(d.organizationId, "orgMain"); assert.equal(d.uid, "t01");
    assert.equal(d.displayName, "Nguyễn Văn An"); assert.equal(d.email, "gv01@example.test"); assert.equal(d.schemaVersion, 1);
    assert.deepEqual(await rowOrder(), ["t01"]);
    const r = await rowText("orgMain", "t01"); assert.ok(r.includes("Nguyễn Văn An") && r.includes("gv01@example.test") && r.includes("Thành viên") && r.includes("Đang hoạt động"));
    const audit = await auditBy("organization.members.add"); assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, admin.uid); assert.equal(audit[0].entityType, "organization"); assert.equal(audit[0].entityId, "orgMain");
    assert.deepEqual(audit[0].detail, { count: 1, uids: ["t01"], skipped: 0 });
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizationMembers", "organizations", "users"], "no capability or other collection created");
  });

  await step("add MULTIPLE teachers in one action; all become ordinary active members; one summary audit entry", async () => {
    await openPicker();
    for (const id of ["t02", "t03", "t04"]) await page.check(`[data-picker-check="${id}"]`);
    assert.equal(await text("#orgPickerCount"), "3");
    await page.click("#orgPickerSubmit");
    await page.waitForFunction(() => document.querySelectorAll("#orgMembersTable tbody tr").length === 4, null, { timeout: 30000 });
    // newest first: the separately-added later batch is above t01; members of ONE batch share createdAt and are ordered by document id DESC
    assert.deepEqual(await rowOrder(), ["t04", "t03", "t02", "t01"], "newest membership first; same-batch order deterministic (document id desc)");
    for (const id of ["t02", "t03", "t04"]) { const d = await memberOf("orgMain", id); assert.equal(d.orgRole, "member"); assert.equal(d.status, "active"); assert.equal(d.addedBy, admin.uid); }
    const audit = (await auditBy("organization.members.add")).filter((a) => a.detail.count === 3); assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].detail.uids.sort(), ["t02", "t03", "t04"]);
    await shot(page, "03-members-list");
  });

  await step("already-associated teachers are clearly marked and cannot be selected (active, suspended, removed and Organization Admin)", async () => {
    await put("organizationMembers/orgMain_t06", mem("orgMain", "t06", "member", "removed", { displayName: NAMES[5], email: "gv06@example.test" }));
    await put("organizationMembers/orgMain_t07", mem("orgMain", "t07", "org_admin", "active", { displayName: NAMES[6], email: "gv07@example.test" }));
    await page.click('[data-nav="classes"]'); await openOrg("orgMain");
    await openPicker();
    for (const id of ["t01", "t02", "t03", "t04", "t06", "t07"]) {
      assert.ok(await page.isDisabled(`[data-picker-check="${id}"]`), id + " is disabled");
      assert.ok((await text(`[data-picker-assoc="${id}"]`)).includes("Đã có trong đơn vị"), id + " is labelled");
    }
    assert.ok((await text('[data-picker-assoc="t06"]')).includes("Đã gỡ")); assert.ok((await text('[data-picker-assoc="t07"]')).includes("Quản trị đơn vị"));
    assert.equal(await page.locator('[data-picker-assoc="t05"]').count(), 0); assert.ok(await page.isEnabled('[data-picker-check="t05"]'));
    await shot(page, "04-picker-associated");
  });

  await step("duplicate race: a membership created elsewhere while the dialog is open is detected at submit; nothing is overwritten, no duplicate document, the rest is added", async () => {
    await page.check('[data-picker-check="t05"]'); await page.check('[data-picker-check="t08"]');
    await put("organizationMembers/orgMain_t05", mem("orgMain", "t05", "member", "active", { displayName: "Đã được thêm trước", email: "truoc@example.test", addedBy: "someoneElse" }));
    const before = await memberOf("orgMain", "t05");
    await page.click("#orgPickerSubmit");
    await page.waitForFunction(() => document.querySelectorAll("#orgMembersTable tbody tr").length >= 7, null, { timeout: 30000 });
    assert.match(await toastText(), /bỏ qua 1/);
    assert.deepEqual(await memberOf("orgMain", "t05"), before, "the existing membership is untouched");
    assert.equal((await memberOf("orgMain", "t08")).status, "active");
    assert.equal((await rowOrder())[0], "t08", "the newest addition is the first row");
    assert.equal((await members("orgMain")).filter((m) => m.uid === "t05").length, 1);
    const audit = (await auditBy("organization.members.add")).filter((a) => a.detail.skipped === 1); assert.equal(audit.length, 1); assert.deepEqual(audit[0].detail.uids, ["t08"]);
  });

  await step("suspend an ordinary member: confirmation text, Hủy changes nothing, confirm writes status + statusChanged meta only, audited", async () => {
    await act("orgMain", "t01", "suspend");
    const text0 = await text("#globalModal .modal");
    assert.ok(text0.includes("Tạm ngưng thành viên?") && text0.toLowerCase().includes("tài khoản hcma2 của giảng viên không bị ảnh hưởng"));
    await page.click("#orgMemberConfirmCancel");
    assert.equal((await memberOf("orgMain", "t01")).status, "active");
    const before = await memberOf("orgMain", "t01");
    await act("orgMain", "t01", "suspend"); await confirmOk();
    const d = await memberOf("orgMain", "t01");
    assert.equal(d.status, "suspended"); assert.equal(d.statusChangedBy, admin.uid); assert.ok(d.statusChangedAt);
    for (const k of ["orgRole", "organizationId", "uid", "addedBy", "createdAt", "displayName", "email", "schemaVersion"]) assert.deepEqual(d[k], before[k], k + " unchanged");
    assert.ok((await rowText("orgMain", "t01")).includes("Tạm ngưng"));
    assert.match(await text("#orgMembersSummary"), /^8 thành viên · 6 hoạt động · 1 tạm ngưng · 1 đã gỡ$/, "summary follows the change");
    assert.equal(await page.locator('[data-member-id="orgMain_t01"][data-member-action="restore"]').count(), 1);
    const audit = await auditBy("organization.member.suspend"); assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].detail, { organizationId: "orgMain", uid: "t01", from: "active", to: "suspended" }); assert.equal(audit[0].entityType, "organizationMember"); assert.equal(audit[0].entityId, "orgMain_t01");
    await shot(page, "05-suspended");
  });

  await step("restore the suspended member: active again, audited", async () => {
    await act("orgMain", "t01", "restore"); await confirmOk();
    assert.equal((await memberOf("orgMain", "t01")).status, "active");
    assert.ok((await rowText("orgMain", "t01")).includes("Đang hoạt động"));
    assert.equal((await auditBy("organization.member.restore")).length, 1);
  });

  await step("soft-remove: the membership document is KEPT with status 'removed' (snapshot retained); the row offers only 'KHÔI PHỤC THÀNH VIÊN'; audited", async () => {
    await act("orgMain", "t02", "remove");
    const t = await text("#globalModal .modal"); assert.ok(t.includes("Gỡ khỏi đơn vị?") && t.includes("Hồ sơ thành viên được giữ lại"));
    await shot(page, "06-remove-confirm");
    await confirmOk();
    const d = await memberOf("orgMain", "t02");
    assert.ok(d, "document still exists"); assert.equal(d.status, "removed"); assert.equal(d.displayName, "Trần Thị Bình"); assert.equal(d.orgRole, "member");
    const r = await rowText("orgMain", "t02"); assert.ok(r.includes("Đã gỡ"));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-member-id="orgMain_t02"]')].map((b) => b.dataset.memberAction)), ["reinstate"]);
    assert.equal(await text('[data-member-id="orgMain_t02"]'), "KHÔI PHỤC THÀNH VIÊN", "removed-member action label");
    assert.equal((await auditBy("organization.member.remove")).length, 1);
    assert.equal((await members("orgMain")).filter((m) => m.uid === "t02").length, 1, "no deletion, no duplicate");
  });

  await step("already-removed membership: shown as 'Đã gỡ', not re-addable from the picker (no duplicate), and reinstatable through the Platform Admin authority the Rules allow", async () => {
    await openPicker();
    assert.ok(await page.isDisabled('[data-picker-check="t02"]')); assert.ok((await text('[data-picker-assoc="t02"]')).includes("Đã gỡ"));
    await page.click("#orgPickerCancel");
    await act("orgMain", "t02", "reinstate");
    assert.ok((await text("#globalModal .modal")).includes("Khôi phục thành viên đã gỡ?") && (await text("#orgMemberConfirmOk")) === "KHÔI PHỤC THÀNH VIÊN");
    await confirmOk();
    assert.equal((await memberOf("orgMain", "t02")).status, "active");
    assert.equal((await auditBy("organization.member.reinstate")).length, 1);
    assert.equal((await members("orgMain")).filter((m) => m.uid === "t02").length, 1);
  });

  await step("Organization Admin rows are read-only in S4 (no suspend/remove/appoint controls); there is no appoint-admin control anywhere in the section", async () => {
    const r = await rowText("orgMain", "t07");
    assert.ok(r.includes("Quản trị đơn vị"));
    assert.equal(await page.locator('[data-member-id="orgMain_t07"]').count(), 0);
    const section = (await text("#orgMembersCard")).toLowerCase();
    assert.ok(!/bổ nhiệm|appoint|đặt làm quản trị|cấp quyền/.test(section));
  });

  await step("refresh / reopen persistence: after a full page reload and navigating back, every membership state is exactly as written", async () => {
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await openOrgs(); await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersTable", { timeout: 30000 });
    const expected = { t01: "Đang hoạt động", t02: "Đang hoạt động", t03: "Đang hoạt động", t04: "Đang hoạt động", t05: "Đang hoạt động", t06: "Đã gỡ", t07: "Đang hoạt động", t08: "Đang hoạt động" };
    for (const [uid, label] of Object.entries(expected)) assert.ok((await rowText("orgMain", uid)).includes(label), uid + " " + label);
    assert.equal(await page.locator("#orgMembersTable tbody tr").count(), 8);
    assert.match(await text("#orgMembersSummary"), /^8 thành viên · 7 hoạt động · 1 đã gỡ$/, "exact summary when every member is loaded");
    const NEWEST_FIRST = ["t08", "t04", "t03", "t02", "t01", "t07", "t06", "t05"];   // t08 (latest batch) ... t01 (first batch), then the older seeded t07/t06/t05 (same createdAt, id desc)
    assert.deepEqual(await rowOrder(), NEWEST_FIRST, "order persists after a full page refresh");
    // status changes never move a member: createdAt (immutable) drives the order
    await page.click('[data-nav="classes"]'); await openOrg("orgMain");
    assert.deepEqual(await rowOrder(), NEWEST_FIRST, "order persists after reopening Organization Detail");
    // logout / login
    await page.click("#btnLogoutTop"); await page.waitForSelector("#loginEmail", { timeout: 30000 });
    await login(page, ADMIN); await openOrg("orgMain");
    assert.deepEqual(await rowOrder(), NEWEST_FIRST, "order persists after logout/login");
    await shot(page, "03b-newest-first-after-login");
  });

  await step("paged member list: 25 members per page with 'TẢI THÊM'; the remaining members append without duplicates", async () => {
    await page.click('[data-nav="classes"]'); await openOrg("orgPaged");
    assert.equal(await page.locator("#orgMembersTable tbody tr").count(), 25);
    assert.equal(await page.locator("#orgMembersMore").count(), 1);
    const partial = await text("#orgMembersSummary");
    assert.ok(partial.startsWith("Đã tải 25 thành viên") && partial.includes("còn thêm"), "partial summary is labelled: " + partial);
    assert.ok(!/^30 thành viên|^25 thành viên/.test(partial), "never a misleading global total");
    await shot(page, "07-members-paged");
    await page.click("#orgMembersMore");
    await page.waitForFunction(() => document.querySelectorAll("#orgMembersTable tbody tr").length === 30, null, { timeout: 30000 });
    assert.equal(await page.locator("#orgMembersMore").count(), 0);
    assert.equal(await text("#orgMembersSummary"), "30 thành viên · 30 hoạt động", "exact once everything is loaded");
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-member-row]")].map((r) => r.dataset.memberRow));
    assert.equal(new Set(ids).size, 30);
  });

  await step("newest first with a large population: a teacher added to the 30-member organization is the FIRST row of page 1; load-more yields every older member exactly once", async () => {
    await page.click('[data-nav="classes"]'); await openOrg("orgPaged");
    await openPicker(); await page.check('[data-picker-check="t01"]'); await page.click("#orgPickerSubmit");
    await page.waitForFunction(() => document.querySelector("[data-member-row]")?.dataset.memberRow === "orgPaged_t01", null, { timeout: 30000 });
    assert.equal(await page.locator("#orgMembersTable tbody tr").count(), 25);
    assert.equal((await rowOrder())[0], "t01");
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await openOrgs(); await page.click('[data-org-open="orgPaged"]'); await page.waitForSelector("#orgMembersTable", { timeout: 30000 });
    assert.equal((await rowOrder())[0], "t01", "still first after refresh");
    await page.click("#orgMembersMore");
    await page.waitForFunction(() => document.querySelectorAll("#orgMembersTable tbody tr").length === 31, null, { timeout: 30000 });
    const ids = await rowOrder();
    assert.equal(new Set(ids).size, 31, "no duplicates");
    const expectedOlder = Array.from({ length: 30 }, (_, i) => "pg" + String(29 - i).padStart(2, "0"));    // seeded with one shared createdAt: document id desc
    assert.deepEqual(ids, ["t01", ...expectedOlder], "no omissions and a deterministic order");
    assert.equal(await text("#orgMembersSummary"), "31 thành viên · 31 hoạt động");
  });

  await step("archived organization: members stay visible, the banner explains, 'Thêm giảng viên' is disabled and no member action is offered; nothing is written", async () => {
    const before = JSON.stringify(await members("orgArch"));
    await page.click('[data-nav="classes"]'); await openOrg("orgArch");
    assert.ok((await text("#orgMembersArchivedNote")).includes("Không thể thêm hoặc thay đổi thành viên"));
    assert.ok(await page.isDisabled("#orgMemberAddBtn"));
    assert.equal(await page.locator("#orgMemberAddBtn").count(), 1);
    assert.equal(await page.locator("#orgPrimaryActions #orgMemberAddBtn").count(), 1);
    assert.equal(await page.locator("[data-member-action]").count(), 0);
    assert.equal(await page.locator("#orgMembersTable tbody tr").count(), 2);
    assert.equal(await text("#orgMembersSummary"), "2 thành viên · 1 hoạt động · 1 tạm ngưng");
    await page.click("#orgMemberAddBtn", { force: true, timeout: 2000 }).catch(() => {});
    assert.equal(await modalOpen(), 0);
    assert.equal(JSON.stringify(await members("orgArch")), before);
    await shot(page, "08-members-archived");
  });

  await step("archiving an organization from the S3 UI immediately blocks membership actions; restoring re-enables them", async () => {
    await page.click('[data-nav="classes"]'); await openOrg("orgTemp");
    assert.equal(await page.locator('[data-member-id="orgTemp_mTemp"][data-member-action="suspend"]').count(), 1);
    assert.equal(await page.locator('[data-member-id="orgTemp_oaTemp"]').count(), 0, "org_admin row read-only");
    await page.click("#orgArchiveBtn"); await page.click("#orgConfirmOk");
    await page.waitForSelector("#orgMembersArchivedNote", { timeout: 30000 });
    assert.ok(await page.isDisabled("#orgMemberAddBtn")); assert.equal(await page.locator("[data-member-action]").count(), 0);
    await page.click("#orgRestoreBtn"); await page.click("#orgConfirmOk");
    await page.waitForFunction(() => !document.querySelector("#orgMembersArchivedNote") && document.querySelector('[data-member-action="suspend"]'), null, { timeout: 30000 });
    assert.ok(await page.isEnabled("#orgMemberAddBtn"));
  });

  await step("archived while the screen is open: the Rules reject a membership create in an archived organization and the screen reports it without writing", async () => {
    await openPicker();
    await page.check('[data-picker-check="t05"]');
    await put("organizations/orgTemp", { ...org("Đơn vị tạm", "don-vi-tam", "archived") });
    await page.click("#orgPickerSubmit");
    await page.waitForFunction(() => !document.querySelector("#orgPickerErr")?.classList.contains("hidden"), null, { timeout: 30000 });
    assert.ok((await text("#orgPickerErr")).length > 5);
    assert.equal(await modalOpen(), 1);
    assert.equal(await memberOf("orgTemp", "t05"), null);
    await page.click("#orgPickerCancel");
    await put("organizations/orgTemp", org("Đơn vị tạm", "don-vi-tam"));
  });

  await step("suspended PLATFORM account is not membership authority: its membership still says active, yet its token cannot read the organization; S4 never touched users", async () => {
    assert.equal((await memberOf("orgTemp", tsusp.uid)).status, "active");
    const si = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "gv.tam.khoa@example.test", password: PASS, returnSecureToken: true }) })).json();
    const T = { Authorization: "Bearer " + si.idToken, "Content-Type": "application/json" };
    assert.equal((await fetch(`${FS}/organizations/orgTemp`, { headers: T })).status, 403);
    assert.equal((await fetch(`${FS}/organizationMembers/orgTemp_${tsusp.uid}`, { headers: T })).status, 403);
    assert.equal(await usersView(), usersSnapshot, "no users document changed");
  });

  await step("mobile width (375px): the members section and the picker are usable without horizontal overflow", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.click("#btnHamburger"); await page.click('[data-nav="organizations"]'); await page.waitForSelector("#orgCreateBtn");
    await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersTable", { timeout: 30000 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(await overflow(), "members: no horizontal overflow");
    await shot(page, "09-members-mobile");
    await openPicker(); assert.ok(await overflow(), "picker: no horizontal overflow");
    await shot(page, "10-picker-mobile");
    await page.click("#orgPickerCancel");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ---------------------------------------------------------------- non-Platform-Admin
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tpage = await ctxT.newPage(); errorsOf(tpage, teacherErrors); tpage.on("dialog", (d) => d.accept());
  await step("a teacher cannot reach membership management: no 'Đơn vị' entry, and the Rules deny listing/creating/changing memberships for their token", async () => {
    await login(tpage, TEACHER);
    const labels = await navLabels(tpage);
    assert.ok(!labels.some((l) => l.includes("Đơn vị")));
    const si = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: TEACHER, password: PASS, returnSecureToken: true }) })).json();
    const T = { Authorization: "Bearer " + si.idToken, "Content-Type": "application/json" };
    const body = (uid) => JSON.stringify({ fields: Object.fromEntries(Object.entries(mem("orgMain", uid)).map(([k, v]) => [k, enc(v)])) });
    assert.equal((await fetch(`${FS}/organizationMembers/orgMain_${teacher.uid}`, { method: "PATCH", headers: T, body: body(teacher.uid) })).status, 403);
    assert.equal((await fetch(`${FS}/organizationMembers?pageSize=5`, { headers: T })).status, 403);
    assert.equal((await fetch(`${FS}/organizationMembers/orgMain_t01?updateMask.fieldPaths=status`, { method: "PATCH", headers: T, body: JSON.stringify({ fields: { status: { stringValue: "removed" } } }) })).status, 403);
    assert.equal((await memberOf("orgMain", teacher.uid)), null); assert.equal((await memberOf("orgMain", "t01")).status, "active");
  });

  await step("P1 Library navigation and the teacher experience are unchanged (hub, inert group card, disabled 'DÙNG CHUNG ĐƠN VỊ · Sắp có', Back)", async () => {
    await tpage.click('[data-nav="library"]'); await tpage.waitForSelector(".library-hub-grid");
    assert.equal(await tpage.locator("button.library-hub-card").count(), 1);
    assert.ok((await tpage.textContent('[data-library-upcoming="group"]')).includes("ĐANG CHUẨN BỊ"));
    await tpage.click("#openInteractionLibrary"); await tpage.waitForSelector("#backToLibraryHub");
    assert.ok((await tpage.textContent(".library-scope")).includes("DÙNG CHUNG ĐƠN VỊ") && (await tpage.textContent(".library-scope")).includes("Sắp có"));
    assert.ok(await tpage.isDisabled(".library-scope-pill.is-soon"));
    await tpage.click("#backToLibraryHub"); await tpage.waitForSelector(".library-hub-grid");
  });

  await step("final: only users/organizations/organizationMembers/auditLogs exist (no capabilities); every membership audit entry is by the Platform Admin; no page errors beyond the known pre-existing race", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizationMembers", "organizations", "users"]);
    const audits = await list("auditLogs");
    for (const a of audits) assert.equal(a.actorId, admin.uid);
    const actions = [...new Set(audits.map((a) => a.action))].sort();
    for (const a of actions) assert.ok(/^organization\.(members\.add|member\.(suspend|restore|remove|reinstate)|archive|restore)$/.test(a), "unexpected audit action " + a);
    for (const m of await list("organizationMembers")) { assert.ok(["member", "org_admin"].includes(m.orgRole)); }
    assert.equal((await members("orgMain")).filter((m) => m.orgRole === "org_admin").length, 1, "the only org_admin is the one seeded; S4 appointed none");
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e) && !/PERMISSION_DENIED|permission|Missing or insufficient/i.test(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /membership|organization-membership/i.test(e)), "no error mentions the membership screen");
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
