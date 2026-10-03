// LIBRARY V2 Onboarding O2 - synthetic browser flow (post-approval Organization step): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P2-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/onboarding-o2/browser.e2e.mjs      (optional O2_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "onboarding-o2-e2e-"));
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
const shot = async (p, name) => { if (process.env.O2_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.O2_SHOTS, name + ".png") }); } };
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

// ---- O2 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
const NEWBIE = "nu.moi@example.test";
const newbie = await signUp(NEWBIE, PASS);
const pendingUser = (id, name, email, status = "pending") => { const day = 30 - Number(id.slice(1)); return put(`users/${id}`, { uid: id, role: "teacher", status, displayName: name, email, approvedBy: null, approvedAt: null, createdAt: D(day), updatedAt: D(day), lastLoginAt: D(day) }); };   // p01 is the newest pending account, so the overview list (newest 10) shows p01..p10
await put(`users/${newbie.uid}`, { uid: newbie.uid, role: "teacher", status: "pending", displayName: "GV Mới Đăng Ký", email: NEWBIE, approvedBy: null, approvedAt: null, createdAt: D(5), updatedAt: D(5), lastLoginAt: D(5) });
const P = (n) => "p" + String(n).padStart(2, "0");
for (let i = 1; i <= 12; i++) await pendingUser(P(i), "Giảng viên chờ " + i, `cho${i}@example.test`);
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const mem = (orgId, uid, orgRole = "member", status = "active") => ({ schemaVersion: 1, organizationId: orgId, uid, orgRole, status, displayName: "Snapshot " + uid, email: uid + "@example.test", addedBy: admin.uid, createdAt: D(2), updatedAt: D(2) });
const memberDocs = async () => list("organizationMembers");
const auditAdds = async () => (await list("auditLogs")).filter((a) => a.action === "organization.members.add");
const userDoc = (id) => get(`users/${id}`);
const modalText = () => page.evaluate(() => (document.querySelector("#globalModal .modal")?.textContent || "").replace(/\s+/g, " ").trim());
const waitEnroll = () => page.waitForSelector("#orgEnrollRoot", { timeout: 30000 }).then(() => page.waitForFunction(() => !document.querySelector("#orgEnrollRoot .spinner"), null, { timeout: 30000 }));
const gone = () => page.waitForFunction(() => !document.querySelector("#globalModal .modal"), null, { timeout: 15000 });
const openTeachers = async () => { await page.click('[data-nav="teachers"]'); await page.waitForSelector('[data-a="approve"]', { timeout: 30000 }); };
const approveInTeachers = async (id) => { await openTeachers(); await page.click(`[data-a="approve"][data-id="${id}"]`); await waitEnroll(); };
const V1_KEYS = ["approvedAt", "approvedBy", "createdAt", "displayName", "email", "lastLoginAt", "role", "status", "uid", "updatedAt"];

try {
  await step("Platform Admin logs in; the V1 pending list works with NO organization in the system", async () => {
    await login(page, ADMIN);
    await page.click('[data-nav="overview"]');
    await page.waitForSelector("[data-approve]", { timeout: 30000 });
    assert.ok((await page.locator("[data-approve]").count()) >= 5);
  });

  await step("zero Organizations (overview entry point): approval succeeds exactly as in V1; the continuation says there is no active Organization and writes nothing", async () => {
    const before = await userDoc(P(1));
    await page.click(`[data-approve="${P(1)}"]`);
    await waitEnroll();
    const t = await modalText();
    assert.ok(t.includes("Đã duyệt tài khoản giảng viên") && t.includes("Chưa có đơn vị nào đang hoạt động") && t.includes("Giảng viên đã có thể sử dụng hệ thống"));
    assert.equal(await page.locator("#orgEnrollAdd").count(), 0);
    const after = await userDoc(P(1));
    assert.equal(after.status, "active"); assert.equal(after.approvedBy, admin.uid); assert.ok(after.approvedAt);
    assert.deepEqual(Object.keys(after).sort(), V1_KEYS, "no field added to users");
    for (const k of ["uid", "role", "email", "displayName", "createdAt"]) assert.deepEqual(after[k], before[k], k + " unchanged");
    assert.equal((await memberDocs()).length, 0); assert.equal((await auditAdds()).length, 0);
    await shot(page, "01-none");
    await page.click("#orgEnrollClose"); await gone();
    await page.waitForFunction((id) => !document.querySelector(`[data-approve="${id}"]`), P(1), { timeout: 15000 });   // V1 callback re-rendered the pending list
  });

  await put("organizations/orgOne", org("Khoa Quản trị", "khoa-quan-tri"));
  await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));

  await step("exactly one active Organization (teachers-screen entry point): it is preselected; ĐỂ SAU leaves the teacher active without membership and writes nothing", async () => {
    await approveInTeachers(P(2));
    const t = await modalText();
    assert.ok(t.includes("Đã duyệt tài khoản giảng viên") && t.includes("Bước tiếp theo (tùy chọn)") && t.includes("không hủy việc duyệt") && t.includes("Khoa Quản trị"));
    assert.ok(!t.includes("Trung tâm cũ"), "archived Organization is not offered");
    assert.ok(await page.isChecked('[data-enroll-org="orgOne"]'), "single Organization preselected");
    assert.ok(await page.isEnabled("#orgEnrollAdd"));
    await shot(page, "02-single");
    await page.click("#orgEnrollLater"); await gone();
    assert.equal((await userDoc(P(2))).status, "active");
    assert.equal((await memberDocs()).length, 0); assert.equal((await auditAdds()).length, 0);
  });

  await step("Esc and backdrop dismissal also mean ĐỂ SAU: approval stays, nothing is written", async () => {
    await approveInTeachers(P(3));
    await page.keyboard.press("Escape"); await gone();
    assert.equal((await userDoc(P(3))).status, "active");
    await approveInTeachers(P(4));
    await page.mouse.click(5, 5); await gone();
    assert.equal((await userDoc(P(4))).status, "active");
    assert.equal((await memberDocs()).length, 0); assert.equal((await auditAdds()).length, 0);
  });

  await step("one Organization + THÊM VÀO ĐƠN VỊ: exactly one ordinary active member via the S4 contract; users unchanged by the membership step; audit carries via; teacher is first in the member list", async () => {
    await approveInTeachers(P(5));
    const afterApproval = await userDoc(P(5));
    await page.click("#orgEnrollAdd"); await gone();
    const docs = await memberDocs();
    assert.equal(docs.length, 1);
    const d = docs[0];
    assert.deepEqual(Object.keys(d).sort(), ["addedBy", "createdAt", "displayName", "email", "id", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
    assert.deepEqual([d.id, d.orgRole, d.status, d.addedBy, d.organizationId, d.uid, d.displayName, d.email, d.schemaVersion], ["orgOne_" + P(5), "member", "active", admin.uid, "orgOne", P(5), "Giảng viên chờ 5", "cho5@example.test", 1]);
    assert.deepEqual(await userDoc(P(5)), afterApproval, "the membership step did not touch users");
    const adds = await auditAdds();
    assert.equal(adds.length, 1);
    assert.deepEqual([adds[0].entityType, adds[0].entityId, adds[0].actorId], ["organization", "orgOne", admin.uid]);
    assert.deepEqual(adds[0].detail, { count: 1, uids: [P(5)], skipped: 0, via: "teacher-approval" });
    await page.click('[data-nav="classes"]'); await openOrgs(); await page.click('[data-org-open="orgOne"]');
    await page.waitForSelector("#orgMembersTable", { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelector("[data-member-row]").dataset.memberRow), "orgOne_" + P(5));
  });

  await step("already-member states: removed and suspended memberships are never recreated and are pointed to Member Management", async () => {
    await put(`organizationMembers/orgOne_${P(6)}`, mem("orgOne", P(6), "member", "removed"));
    await put(`organizationMembers/orgOne_${P(7)}`, mem("orgOne", P(7), "member", "suspended"));
    for (const [id, label, status] of [[P(6), "Đã gỡ", "removed"], [P(7), "Tạm ngưng", "suspended"]]) {
      const before = await get(`organizationMembers/orgOne_${id}`);
      await approveInTeachers(id);
      const t = await modalText();
      assert.ok(t.includes("Đã duyệt tài khoản giảng viên") && t.includes(label) && t.includes("quản lý trong mục Thành viên") && !t.includes("Chưa có đơn vị"));
      assert.equal(await page.locator("#orgEnrollAdd").count(), 0);
      await page.click("#orgEnrollClose"); await gone();
      assert.deepEqual(await get(`organizationMembers/orgOne_${id}`), before);
      assert.equal((await userDoc(id)).status, "active");
      assert.equal((await get(`organizationMembers/orgOne_${id}`)).status, status);
    }
    assert.equal((await auditAdds()).length, 1, "no new audit entry");
  });

  await put("organizations/orgTwo", org("Trung tâm Bồi dưỡng", "bo-duong"));

  await step("two active Organizations: nothing preselected, archived absent, button disabled until a selection; multi-select writes one separate membership per Organization", async () => {
    await approveInTeachers(P(8));
    const t = await modalText();
    assert.ok(t.includes("Khoa Quản trị") && t.includes("Trung tâm Bồi dưỡng") && !t.includes("Trung tâm cũ") && t.includes("có thể chọn nhiều đơn vị"));
    assert.equal(await page.locator("[data-enroll-org]:checked").count(), 0, "no default");
    assert.ok(await page.isDisabled("#orgEnrollAdd"));
    await shot(page, "03-multi");
    await page.check('[data-enroll-org="orgOne"]'); await page.check('[data-enroll-org="orgTwo"]');
    assert.ok(await page.isEnabled("#orgEnrollAdd"));
    await page.click("#orgEnrollAdd"); await gone();
    for (const o of ["orgOne", "orgTwo"]) { const d = await get(`organizationMembers/${o}_${P(8)}`); assert.deepEqual([d.orgRole, d.status, d.addedBy], ["member", "active", admin.uid]); }
    const adds = (await auditAdds()).filter((a) => a.detail.uids[0] === P(8));
    assert.equal(adds.length, 2); assert.ok(adds.every((a) => a.detail.count === 1 && a.detail.via === "teacher-approval"));
    assert.deepEqual((await userDoc(P(8))).status, "active");
  });

  await step("partial outcome: an Organization archived while the prompt is open is skipped with a clear note, the other membership is still created, approval intact", async () => {
    await approveInTeachers(P(9));
    await page.check('[data-enroll-org="orgOne"]'); await page.check('[data-enroll-org="orgTwo"]');
    await put("organizations/orgTwo", org("Trung tâm Bồi dưỡng", "bo-duong", "archived"));
    await page.click("#orgEnrollAdd");
    await page.waitForSelector('[data-enroll-note="orgTwo"]', { timeout: 30000 });
    assert.match(await page.textContent('[data-enroll-note="orgTwo"]'), /đã được lưu trữ/);
    assert.match(await page.textContent('[data-enroll-note="orgOne"]'), /Đã thêm vào đơn vị/);
    assert.equal((await get(`organizationMembers/orgOne_${P(9)}`)).status, "active");
    assert.equal(await get(`organizationMembers/orgTwo_${P(9)}`), null);
    assert.equal((await userDoc(P(9))).status, "active");
    await page.click("#orgEnrollLater"); await gone();
    await put("organizations/orgTwo", org("Trung tâm Bồi dưỡng", "bo-duong"));
  });

  await step("teacher no longer active when the Administrator continues: blocked with a clear message, nothing written", async () => {
    await approveInTeachers(P(10));
    await put(`users/${P(10)}`, { ...(await userDoc(P(10))), status: "suspended" });
    await page.check('[data-enroll-org="orgOne"]');
    await page.click("#orgEnrollAdd");
    await page.waitForFunction(() => /không còn là giảng viên đang hoạt động/.test(document.querySelector("#globalModal .modal")?.textContent || ""), null, { timeout: 30000 });
    assert.ok((await modalText()).includes("Việc duyệt trước đó không bị ảnh hưởng"));
    assert.equal(await get(`organizationMembers/orgOne_${P(10)}`), null);
    await page.click("#orgEnrollClose"); await gone();
  });

  await step("concurrent approvals: a second approval replaces the first prompt (= ĐỂ SAU for the first teacher); no queue, no residue", async () => {
    await put("organizations/orgTwo", org("Trung tâm Bồi dưỡng", "bo-duong", "archived"));
    await approveInTeachers(P(11));
    assert.ok((await modalText()).includes("Giảng viên chờ 11"));
    await page.evaluate((id) => document.querySelector(`[data-a="approve"][data-id="${id}"]`).click(), P(12));
    await page.waitForFunction(() => /Giảng viên chờ 12/.test(document.querySelector("#globalModal .modal")?.textContent || ""), null, { timeout: 30000 });
    await waitEnroll();
    const t = await modalText();
    assert.ok(t.includes("Giảng viên chờ 12") && !t.includes("Giảng viên chờ 11"));
    assert.equal(await page.locator("#globalModal #orgEnrollRoot").count(), 1, "one prompt only");
    assert.equal((await userDoc(P(11))).status, "active"); assert.equal((await userDoc(P(12))).status, "active");
    assert.equal(await get(`organizationMembers/orgOne_${P(11)}`), null);
    await page.click("#orgEnrollLater"); await gone();
  });

  await step("V1 is unaffected for the approved teacher: a newly approved teacher without any membership signs in and gets the normal teacher shell; the same approval writes only the V1 fields", async () => {
    const before = await userDoc(newbie.uid);
    await openTeachers();
    await page.click(`[data-a="approve"][data-id="${newbie.uid}"]`); await waitEnroll();
    await page.keyboard.press("Escape"); await gone();
    const after = await userDoc(newbie.uid);
    assert.equal(after.status, "active"); assert.equal(after.approvedBy, admin.uid);
    assert.deepEqual(Object.keys(after).sort(), V1_KEYS);
    for (const k of ["uid", "role", "email", "displayName", "createdAt"]) assert.deepEqual(after[k], before[k]);
    assert.equal((await memberDocs()).filter((m) => m.uid === newbie.uid).length, 0);
    const ctxN = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const npage = await ctxN.newPage(); errorsOf(npage, teacherErrors);
    await login(npage, NEWBIE);
    const labels = await navLabels(npage);
    assert.ok(labels.some((l) => l.includes("THƯ VIỆN")) && !labels.some((l) => l.includes("Đơn vị")));
    await npage.click('[data-nav="library"]'); await npage.waitForSelector(".library-hub-grid");
    await ctxN.close();
  });

  await step("mobile width (375px): the continuation modal is usable without horizontal overflow", async () => {
    await put("organizations/orgTwo", org("Trung tâm Bồi dưỡng", "bo-duong"));
    await pendingUser("p13", "Giảng viên chờ 13", "cho13@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.click("#btnHamburger"); await page.click('[data-nav="teachers"]');
    await page.waitForSelector('[data-a="approve"][data-id="p13"]', { timeout: 30000 });
    await page.click('[data-a="approve"][data-id="p13"]'); await waitEnroll();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow");
    await shot(page, "04-mobile");
    await page.click("#orgEnrollLater"); await gone();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("final: only users, organizations, organizationMembers and auditLogs exist; every membership is an ordinary active-or-seeded member; no capabilities; every audit entry is by the Platform Admin", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "organizationMembers", "organizations", "users"]);
    for (const m of await memberDocs()) assert.equal(m.orgRole, "member");
    for (const a of await list("auditLogs")) assert.equal(a.actorId, admin.uid);
    const kinds = new Set((await list("auditLogs")).map((a) => a.action));
    assert.deepEqual([...kinds], ["organization.members.add"], "O2 audits only the membership creation (approval itself stays unaudited: accepted debt, later O3)");
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /enroll/i.test(e)), "no error mentions the enrollment step");
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
