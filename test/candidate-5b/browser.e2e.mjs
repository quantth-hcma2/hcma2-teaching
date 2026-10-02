// CANDIDATE 5B — repeatable synthetic browser flow: the REAL index.html in headless Edge against LOCAL Auth +
// Firestore emulators loaded with this repo's production-candidate Rules. Synthetic accounts/data only; nothing
// here can reach production (the app itself refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/candidate-5b/browser.e2e.mjs
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "candidate-5b-e2e-"));
writeFileSync(path.join(here, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { host: "127.0.0.1", port: 9099 }, firestore: { host: "127.0.0.1", port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }));                     // worktree under test
const PROJECT = "demo-hcma2-production-prep";             // the project id the app's emulator mode expects
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const pkg = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const pw = await import(path.isAbsolute(pkg) ? pathToFileURL(pkg).href : pkg);
const chromium = pw.chromium || pw.default.chromium;

// ---- emulators (Java 21 comes from the caller's PATH) ----
copyFileSync(path.join(REPO, "firestore.rules.production-candidate"), path.join(here, "firestore.rules"));
const emu = spawn("firebase.cmd", ["emulators:start", "--only", "auth,firestore", "--project", PROJECT, "--config", path.join(here, "firebase.json")], { cwd: here, shell: true, stdio: ["ignore", "pipe", "pipe"] });
let emuLog = ""; emu.stdout.on("data", (d) => (emuLog += d)); emu.stderr.on("data", (d) => (emuLog += d));
const stopEmu = () => { try { execSync(`taskkill /pid ${emu.pid} /T /F`, { stdio: "ignore" }); } catch {} };
process.on("exit", stopEmu);
async function waitFor(url, label) { for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error(`${label} did not start\n${emuLog.slice(-1500)}`); }
await waitFor("http://127.0.0.1:8080/", "firestore emulator"); await waitFor("http://127.0.0.1:9099/", "auth emulator");

// ---- seeding helpers (admin bypass via the emulator's "owner" bearer token) ----
function enc(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
const put = async (p, data) => { const r = await fetch(`${FS}/${p}`, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error(`seed ${p}: ${r.status} ${await r.text()}`); };
function dec(f) { if ("stringValue" in f) return f.stringValue; if ("integerValue" in f) return Number(f.integerValue); if ("booleanValue" in f) return f.booleanValue; if ("nullValue" in f) return null; if ("timestampValue" in f) return f.timestampValue; if ("mapValue" in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, dec(v)])); return f; }
const get = async (p) => { const r = await fetch(`${FS}/${p}`, { headers: { Authorization: "Bearer owner" } }); if (r.status === 404) return null; const j = await r.json(); return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, dec(v)])); };
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp failed " + JSON.stringify(j)); return j.localId; }

const EMAIL = "gv.thu.nghiem@example.test", PASS = "Pw-" + Math.random().toString(36).slice(2) + "-A1", OTHER_EMAIL = "gv.khac@example.test";
const ownerUid = await signUp(EMAIL, PASS), otherUid = await signUp(OTHER_EMAIL, PASS + "x");
const D = (day, hour) => new Date(Date.UTC(2026, 8, day, hour, 0, 0));
await put(`users/${ownerUid}`, { role: "teacher", status: "active", displayName: "GV Thử nghiệm", email: EMAIL, createdAt: D(1, 0) });
await put(`users/${otherUid}`, { role: "teacher", status: "active", displayName: "GV Khác", email: OTHER_EMAIL, createdAt: D(1, 0) });
const deletedSessions = [];
for (let day = 1; day <= 25; day++) { const id = `sdel${String(day).padStart(2, "0")}`; deletedSessions.push({ id, day }); await put(`sessions/${id}`, { ownerId: ownerUid, title: `Phiên đã xóa ${day}`, status: "closed", createdAt: D(day, 0), deletedAt: D(day, 1), deletedBy: ownerUid, questionCount: 1, responseCount: 0, className: "K77", accessToken: "tok" + day, shortCode: "ABC-" + day, updatedAt: D(day, 1) }); }
for (const [id, title] of [["sact1", "Phiên đang hoạt động A"], ["sact2", "Phiên đang hoạt động B"]]) await put(`sessions/${id}`, { ownerId: ownerUid, title, status: "closed", createdAt: D(26, 0), questionCount: 1, responseCount: 0, className: "K77", accessToken: "tk" + id, shortCode: "XYZ-1" });
await put("sessions/sother", { ownerId: otherUid, title: "Phiên của giảng viên khác (đã xóa)", status: "closed", createdAt: D(2, 0), deletedAt: D(27, 1), deletedBy: otherUid });
const GROUP_DAYS = [[28, "closed"], [23, "open"], [14, "draft"], [9, "closed"], [5, "open"], [2, "draft"]];
const deletedGroups = [];
for (const [day, prior] of GROUP_DAYS) { const id = `gdel${day}`; deletedGroups.push({ id, day, prior }); await put(`groupActivities/${id}`, { ownerId: ownerUid, title: `Nhóm đã xóa ${day}`, className: "K77.B02", status: "deleted", statusBeforeDelete: prior, deletedAt: D(day, 2), deletedBy: ownerUid, groupCount: 3, joinCode: "J" + String(day).padStart(5, "0"), durationSec: 900, allowText: true, allowPhoto: true, allowFile: true, createdAt: D(1, 0), updatedAt: D(day, 2) }); await put(`groupActivities/${id}/topics/1`, { group: 1, topic: "Nhiệm vụ " + day }); await put(`groupJoinCodes/J${String(day).padStart(5, "0")}`, { activityId: id, ownerId: ownerUid, createdAt: D(1, 0) }); }
await put("groupActivities/gother", { ownerId: otherUid, title: "Nhóm của giảng viên khác (đã xóa)", status: "deleted", statusBeforeDelete: "open", deletedAt: D(29, 2), deletedBy: otherUid, groupCount: 2 });
await put("groupActivities/gactive", { ownerId: ownerUid, title: "Thảo luận nhóm đang hoạt động", className: "K77.B02", status: "open", groupCount: 3, joinCode: "ACTIVE1", durationSec: 900, allowText: true, allowPhoto: true, allowFile: true, collectStudentNames: false, createdAt: D(26, 3), updatedAt: D(26, 3) });
await put("groupJoinCodes/ACTIVE1", { activityId: "gactive", ownerId: ownerUid, createdAt: D(26, 3) });
for (let g = 1; g <= 3; g++) await put(`groupActivities/gactive/topics/${g}`, { group: g, topic: "Chủ đề nhóm " + g });
await put("groupActivities/gactive/notes/n1", { group: 1, text: "Ý kiến thử nghiệm của nhóm 1.", participantId: "uidSENTINEL", createdAt: D(26, 4) });
console.log("seeded:", deletedSessions.length, "deleted sessions,", deletedGroups.length, "deleted groups, 1 active group, foreign items");

// ---- static server for the worktree (loopback only) ----
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream"); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- browser flow ----
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebChannel|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const rows = () => page.locator("#unifiedTrashList tbody tr");
const rowTexts = () => page.evaluate(() => [...document.querySelectorAll("#unifiedTrashList tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim())));
const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent));

let exitCode = 0;
try {
  await page.goto(`${base}/index.html?emulator=1`);
  await step("login with a synthetic teacher account (local Auth emulator)", async () => {
    await page.waitForSelector("#loginEmail", { timeout: 60000 });
    await page.fill("#loginEmail", EMAIL); await page.fill("#loginPass", PASS); await page.click("#loginBtn");
    await page.waitForSelector('[data-nav="trash"]', { timeout: 60000 });
  });

  const expected = [...deletedSessions.map((s) => ({ title: `Phiên đã xóa ${s.day}`, t: D(s.day, 1).getTime(), kind: "Tạo tương tác" })), ...deletedGroups.map((g) => ({ title: `Nhóm đã xóa ${g.day}`, t: D(g.day, 2).getTime(), kind: "Thảo luận nhóm", prior: g.prior }))].sort((a, b) => b.t - a.t);

  await step("Unified Trash: both modules merged by deletedAt desc, first 20 shown, foreign items excluded", async () => {
    await page.click('[data-nav="trash"]');
    await page.waitForSelector("#unifiedTrashList table", { timeout: 30000 });
    assert.equal((await page.textContent("#unifiedTrash h2")).trim(), "THÙNG RÁC");
    const t = await rowTexts();
    assert.equal(t.length, 20);
    assert.deepEqual(t.map((r) => r[1]), expected.slice(0, 20).map((e) => e.title));
    assert.deepEqual(t.map((r) => r[0]), expected.slice(0, 20).map((e) => e.kind));
    const all = await page.textContent("#unifiedTrash");
    assert.ok(!all.includes("giảng viên khác"), "foreign owner's deleted items must not appear");
    assert.equal(await page.locator("#unifiedTrash [data-hard], #unifiedTrash >> text=XÓA VĨNH VIỄN").count(), 0, "no permanent delete in Unified Trash");
    assert.ok(!/Knowledge|Đồng kiến tạo/.test(all), "Knowledge is not part of V1");
    assert.deepEqual(await page.locator("#unifiedTrashFilters button").allTextContents(), ["Tất cả", "Tạo tương tác", "Thảo luận nhóm"]);
  });

  await step("pagination: XEM THÊM loads the rest (31 total) in the same global order, then disappears", async () => {
    assert.ok(await page.locator("#unifiedTrashMore").isVisible());
    await page.click("#unifiedTrashMore");
    await page.waitForFunction(() => document.querySelectorAll("#unifiedTrashList tbody tr").length === 31, null, { timeout: 30000 });
    assert.deepEqual((await rowTexts()).map((r) => r[1]), expected.map((e) => e.title));
    assert.ok(!(await page.locator("#unifiedTrashMore").isVisible()));
  });

  await step("filters: Tạo tương tác / Thảo luận nhóm / Tất cả; group rows show their previous status", async () => {
    await page.click('[data-trash-filter="group"]');
    const g = await rowTexts();
    assert.equal(g.length, 6); assert.ok(g.every((r) => r[0] === "Thảo luận nhóm"));
    const label = { draft: "Bản nháp", open: "Đang mở", closed: "Đã đóng" };
    for (const e of expected.filter((x) => x.kind === "Thảo luận nhóm")) assert.ok(g.find((r) => r[1] === e.title)[4].includes(label[e.prior]), e.title);
    await page.click('[data-trash-filter="interaction"]');
    const i = await rowTexts(); assert.equal(i.length, 20); assert.ok(i.every((r) => r[0] === "Tạo tương tác"));
    assert.equal(await page.locator('[data-trash-filter="interaction"]').getAttribute("aria-pressed"), "true");
    await page.click('[data-trash-filter="all"]');
    assert.equal((await rowTexts()).length, 20);
  });

  await step("restore a Group item: previous status restored, join code and descendants intact, item leaves Unified Trash", async () => {
    await page.click('[data-trash-filter="group"]');
    const row = rows().filter({ hasText: "Nhóm đã xóa 28" });
    await row.locator("[data-unified-restore]").click();
    await page.waitForFunction(() => ![...document.querySelectorAll("#unifiedTrashList tbody tr")].some((tr) => tr.textContent.includes("Nhóm đã xóa 28")), null, { timeout: 30000 });
    assert.ok((await toastText()).some((t) => t.includes("Đã khôi phục.")));
    const doc = await get("groupActivities/gdel28");
    assert.equal(doc.status, "closed"); assert.equal(doc.joinCode, "J00028"); assert.ok(!("deletedAt" in doc) && !("statusBeforeDelete" in doc) && !("deletedBy" in doc));
    assert.equal((await get("groupActivities/gdel28/topics/1")).topic, "Nhiệm vụ 28");
  });

  await step("restore an Interaction item: deletedAt cleared, item leaves Unified Trash, returns to Interaction history", async () => {
    await page.click('[data-trash-filter="interaction"]');
    await rows().filter({ hasText: "Phiên đã xóa 25" }).locator("[data-unified-restore]").click();
    await page.waitForFunction(() => ![...document.querySelectorAll("#unifiedTrashList tbody tr")].some((tr) => tr.textContent.includes("Phiên đã xóa 25")), null, { timeout: 30000 });
    const doc = await get("sessions/sdel25"); assert.equal(doc.deletedAt, null);
    await page.click('[data-nav="create"]');
    await page.waitForSelector("#hTable table", { timeout: 30000 });
    const hist = await page.textContent("#hTable");
    assert.ok(hist.includes("Phiên đã xóa 25") && hist.includes("Phiên đang hoạt động A"));
    assert.ok(!hist.includes("Phiên đã xóa 24"), "still-deleted sessions stay out of history");
  });

  await step("module-local THÙNG RÁC PHIÊN remains: old screen with restore AND permanent-delete controls, back button works", async () => {
    await page.click("#btnInteractionLocalTrash");
    await page.waitForSelector("#trashTable table", { timeout: 30000 });
    assert.ok((await page.textContent("main, #mainContent, body")).includes("Thùng rác phiên tương tác"));
    assert.ok((await page.locator("#trashTable [data-restore]").count()) >= 20);
    assert.ok((await page.locator("#trashTable [data-hard]").count()) >= 20, "permanent delete lives only in the module-local screen");
    assert.ok(!(await page.textContent("#trashTable")).includes("Phiên đã xóa 25"), "restored session is no longer in the local trash");
    await page.click("#interactionTrashBack");
    await page.waitForSelector("#hTable", { timeout: 30000 });
  });

  await step("Group module: restored activity is back in the active list; ĐÃ XÓA tab lists the remaining deleted ones", async () => {
    await page.click('[data-nav="groups"]');
    await page.waitForSelector("#groupHistory table", { timeout: 30000 });
    const active = await page.textContent("#groupHistory");
    assert.ok(active.includes("Nhóm đã xóa 28") && active.includes("J00028") && active.includes("Thảo luận nhóm đang hoạt động"));
    await page.click("#groupDeletedBtn");
    await page.waitForFunction(() => { const t = document.querySelector("#groupHistory")?.textContent || ""; return t.includes("Nhóm đã xóa 23") && !t.includes("Nhóm đã xóa 28"); }, null, { timeout: 30000 });
  });

  await step("coexistence: RichText V3 editor loads in the Group create form", async () => {
    await page.click("#groupActiveBtn");
    await page.click("#groupNewBtn");
    await page.waitForSelector("#gInstructionsEditor [data-rt-toolbar]", { timeout: 30000 });
    assert.ok((await page.locator("#gInstructionsEditor [data-rt-action]").count()) >= 15, "full V3 toolbar present");
    assert.ok(await page.locator('#gInstructionsEditor [data-rt-action="list-bullet"]').count());
    await page.click("#gCancel");
  });

  await step("coexistence: Group PDF V1 — live view shows TẢI PDF per group and a real export downloads a Vietnamese-named PDF", async () => {
    await page.evaluate(() => { window.location.hash = "#/group/gactive"; });
    await page.waitForSelector("[data-group-pdf]", { timeout: 30000 });
    assert.equal(await page.locator("[data-group-pdf]").count(), 3);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click('[data-group-pdf="1"]')]);
    assert.equal(download.suggestedFilename(), "Thảo luận nhóm đang hoạt động - K77.B02 - Nhóm 1.pdf");
    const file = path.join(here, "pdf-from-app.pdf"); await download.saveAs(file);
    assert.ok(readFileSync(file).length > 5000);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-group-pdf]")].every((b) => !b.disabled && b.textContent === "TẢI PDF"), null, { timeout: 30000 });
  });

  // Known, pre-existing race reproduced on the untouched 87ff3bd baseline (teacherOverview sets innerHTML after the
  // teacher navigated away); it is not part of 5B and is tracked separately.
  const knownBaseline = errors.filter((e) => e.includes("teacherOverview") || e === "pageerror: Cannot set properties of null (setting 'innerHTML')");
  console.log(`known pre-existing teacherOverview race occurrences: ${knownBaseline.length}`);
  assert.deepEqual(errors.filter((e) => !knownBaseline.includes(e)), [], "no other page errors");
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAILED:", e.message); try { await page.screenshot({ path: path.join(here, "failure.png") }); console.error("page url:", page.url()); } catch {}
  if (errors.length) console.error("page errors:", errors.slice(0, 5));
} finally {
  await browser.close(); server.close(); stopEmu();
  process.exit(exitCode);
}
