// LIBRARY V2 P1 — repeatable synthetic browser flow: the REAL index.html in headless Edge against LOCAL Auth +
// Firestore emulators loaded with this repo's production-candidate Rules. Synthetic accounts/data only; nothing
// here can reach production (the app itself refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p1/browser.e2e.mjs
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p1-e2e-"));
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
async function waitFor(url, label) { for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error(`${label} did not start\n${emuLog.slice(-1500)}`); }
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
  return undefined;
}
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const put = async (p, data) => { const r = await fetch(`${FS}/${p}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error("seed " + p + " " + r.status + " " + (await r.text())); };
const get = async (p) => { const r = await fetch(`${FS}/${p}`, { headers: H }); if (r.status === 404) return null; const j = await r.json(); return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, dec(v)])); };
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp " + JSON.stringify(j)); return j.localId; }
// Whole-database snapshot (ids + updateTime of every root-collection document): proves "navigation creates/changes nothing".
async function snapshot() {
  const ids = await (await fetch(`${FS}:listCollectionIds`, { method: "POST", headers: H, body: "{}" })).json();
  const out = {};
  for (const col of ids.collectionIds || []) {
    const j = await (await fetch(`${FS}/${col}?pageSize=1000`, { headers: H })).json();
    out[col] = Object.fromEntries((j.documents || []).map((d) => [d.name.split("/").pop(), d.updateTime]));
  }
  return out;
}

const EMAIL = "gv.thu.nghiem@example.test", PASS = "Pw-" + Math.random().toString(36).slice(2) + "-A1", OTHER_EMAIL = "gv.khac@example.test";
const ownerUid = await signUp(EMAIL, PASS), otherUid = await signUp(OTHER_EMAIL, PASS + "x");
const D = (day, hour) => new Date(Date.UTC(2026, 8, day, hour, 0, 0));
await put(`users/${ownerUid}`, { role: "teacher", status: "active", displayName: "GV Thử nghiệm", email: EMAIL, createdAt: D(1, 0) });
await put(`users/${otherUid}`, { role: "teacher", status: "active", displayName: "GV Khác", email: OTHER_EMAIL, createdAt: D(1, 0) });
await put("classes/c1", { ownerId: ownerUid, name: "K77.A01", code: "A01", status: "active", createdAt: D(2, 0) });
const LIB = [["lib1", "Khởi động", "single", "Câu hỏi khởi động số 1?", ["A", "B"], 5], ["lib2", "Ôn tập", "open", "Câu hỏi ôn tập mở số 2?", null, 4], ["lib3", "Đánh giá", "truefalse", "Nhận định đúng sai số 3.", ["Đúng", "Sai"], 3]];
for (const [id, category, type, question, options, day] of LIB) await put(`library/${id}`, { ownerId: ownerUid, category, type, question, description: "", options, scaleMin: null, scaleMax: null, createdAt: D(day, 0), updatedAt: D(day, 0) });
await put("library/libOther", { ownerId: otherUid, category: "Khởi động", type: "open", question: "Câu hỏi của giảng viên khác", description: "", options: null, createdAt: D(6, 0), updatedAt: D(6, 0) });
await put("questionSets/set1", { ownerId: ownerUid, name: "Bộ câu hỏi mẫu thử nghiệm", description: "", category: "Khởi động", questions: [{ question: "Câu trong bộ 1?", description: "", type: "open", options: [], required: true, chartType: "wordcloud", scaleMin: 1, scaleMax: 5, timeLimit: 0, allowChangeAnswer: false, saveToLibrary: false, libraryCategory: "Khởi động", sourceLibraryId: null }], questionCount: 1, createdAt: D(7, 0), updatedAt: D(7, 0) });
console.log("seeded: 1 teacher class, 3 own library questions, 1 foreign library question, 1 question set");

const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(readFileSync(p)); } catch { res.writeHead(500); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = []; page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebChannel|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const text = (sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const activeNav = () => page.evaluate(() => document.querySelector(".navlink.active")?.dataset.nav);
const selected = (id) => page.getAttribute("#" + id, "aria-selected");
const cards = () => page.locator("#libGrid .card");
const shot = async (name) => { if (process.env.P1_SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: path.join(process.env.P1_SHOTS, name + ".png") }); } };
const hubVisible = async () => assert.equal((await text("#mainContent h2")), "THƯ VIỆN");
const childVisible = async () => assert.ok(await page.locator("#backToLibraryHub").isVisible());

let exitCode = 0;
try {
  await page.goto(`${base}/index.html?emulator=1`);
  await step("login with a synthetic teacher account (local Auth emulator)", async () => {
    await page.waitForSelector("#loginEmail", { timeout: 60000 });
    await page.fill("#loginEmail", EMAIL); await page.fill("#loginPass", PASS); await page.click("#loginBtn");
    await page.waitForSelector('[data-nav="library"]', { timeout: 60000 });
    await page.waitForSelector("#btnQuickLib", { timeout: 60000 });
  });

  // ------------------------------------------------------------------ pure navigation phase (no writes allowed)
  const before = await snapshot();

  await step("1. THƯ VIỆN opens the canonical hub: Tạo tương tác card enabled, Thảo luận nhóm shown as 'đang chuẩn bị' (no control)", async () => {
    await page.click('[data-nav="library"]');
    await page.waitForSelector(".library-hub-grid");
    await hubVisible();
    assert.equal(await activeNav(), "library");
    assert.equal(await page.locator(".library-hub-card").count(), 2);
    assert.equal(await page.locator("button.library-hub-card").count(), 1, "exactly one actionable card");
    assert.ok((await text("#openInteractionLibrary")).includes("TẠO TƯƠNG TÁC") && (await text("#openInteractionLibrary")).includes("MỞ THƯ VIỆN"));
    const g = page.locator('[data-library-upcoming="group"]');
    assert.equal(await g.getAttribute("aria-disabled"), "true");
    const gt = await g.textContent();
    assert.ok(gt.includes("THẢO LUẬN NHÓM") && gt.includes("ĐANG CHUẨN BỊ") && gt.includes("Tình huống / Nội dung thảo luận") && gt.includes("Nhiệm vụ nhóm") && !gt.includes("Chưa dùng được"));
    assert.equal(await text("#mainContent .section-title p"), "Lưu trữ và sử dụng lại các tài nguyên phục vụ giảng dạy.");
    const geo = await page.evaluate(() => { const a = document.querySelector("#openInteractionLibrary").getBoundingClientRect(); const g = document.querySelector("[data-library-upcoming]").getBoundingClientRect(); const copy = document.querySelector("#openInteractionLibrary .library-card-copy").getBoundingClientRect(); const act = document.querySelector("#openInteractionLibrary .library-card-action").getBoundingClientRect(); return { aTop: a.top, gTop: g.top, aH: a.height, gH: g.height, aLeft: a.left, gLeft: g.left, gap: act.top - copy.bottom, tail: a.bottom - act.bottom }; });
    assert.ok(geo.gTop > 0 && Math.abs(geo.aTop - geo.gTop) < 2 && geo.gLeft > geo.aLeft, "two balanced columns on one row, top-aligned");
    assert.ok(geo.gap <= 24, "MỞ THƯ VIỆN sits right under the description (gap " + geo.gap + ")");
    assert.ok(geo.tail <= 40, "no large empty area below the action (tail " + geo.tail + ")");
    assert.ok(Math.abs(geo.aH - geo.gH) <= 160, "cards are content-height, not stretched");
    assert.equal(await g.locator("button, a, input").count(), 0, "no control inside the upcoming card");
    assert.ok(!(await page.textContent("#mainContent")).includes("SẮP PHÁT TRIỂN"));
    await shot("hub-desktop");
  });

  await step("9. Clicking the Thảo luận nhóm card does nothing and writes nothing", async () => {
    await page.click('[data-library-upcoming="group"]');
    await hubVisible();
    assert.equal(await page.locator("#backToLibraryHub").count(), 0, "still on the hub — no dead-end screen");
    assert.deepEqual(await snapshot(), before);
  });

  await step("2/3. TẠO TƯƠNG TÁC opens the existing V1 Library on CÂU HỎI with the owner's questions only", async () => {
    await page.click("#openInteractionLibrary");
    await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    await childVisible();
    assert.equal(await selected("libraryQuestionsTab"), "true"); assert.equal(await selected("libraryQuestionSetsTab"), "false");
    assert.equal(await cards().count(), 3);
    const all = await page.textContent("#libGrid");
    assert.ok(all.includes("Câu hỏi khởi động số 1?") && all.includes("Nhận định đúng sai số 3.") && !all.includes("giảng viên khác"));
    assert.equal(await text("#interactionLibraryTitle"), "THƯ VIỆN TẠO TƯƠNG TÁC");
    assert.ok(await page.locator("#btnNewLib").isVisible());
    assert.equal(await page.locator("#libFilterBar .chip").count(), 8);
    await shot("child-desktop");
  });

  await step("scope pills: CỦA TÔI is current, DÙNG CHUNG ĐƠN VỊ is disabled 'Sắp có' and inert", async () => {
    assert.equal(await text(".library-scope-pill.is-current"), "CỦA TÔI");
    const shared = page.locator(".library-scope-pill.is-soon");
    assert.equal(await shared.count(), 1);
    assert.ok(await shared.isDisabled());
    assert.ok((await shared.textContent()).includes("DÙNG CHUNG ĐƠN VỊ") && (await shared.textContent()).includes("Sắp có"));
    await shared.evaluate((el) => el.click());           // a forced click must not navigate or write anything
    assert.equal(await selected("libraryQuestionsTab"), "true");
    assert.equal(await cards().count(), 3);
  });

  await step("4. BỘ CÂU HỎI tab shows the V1 question sets; CÂU HỎI tab returns", async () => {
    await page.click("#libraryQuestionSetsTab");
    await page.waitForSelector("#qsetGrid", { timeout: 30000 });
    await page.waitForFunction(() => (document.querySelector("#qsetGrid")?.textContent || "").includes("Bộ câu hỏi mẫu thử nghiệm"), null, { timeout: 30000 });
    assert.equal(await selected("libraryQuestionSetsTab"), "true");
    assert.ok(await page.locator("#newQSet").isVisible());
    await page.click("#libraryQuestionsTab");
    await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    assert.equal(await selected("libraryQuestionsTab"), "true");
  });

  await step("8. Back: child → hub (breadcrumb button), sidebar THƯ VIỆN from a child → hub, no unrelated screen", async () => {
    await page.click("#backToLibraryHub");
    await page.waitForSelector(".library-hub-grid"); await hubVisible();
    await page.click("#openInteractionLibrary"); await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    await page.click('[data-nav="library"]');
    await page.waitForSelector(".library-hub-grid"); await hubVisible();
    assert.equal(await activeNav(), "library");
  });

  await step("7. Overview shortcuts route into the canonical child library (same shell, correct tab, Back → hub)", async () => {
    await page.click('[data-nav="overview"]'); await page.waitForSelector("#btnQuickLib");
    assert.deepEqual(await page.locator("#btnQuickLib, #btnQuickSets").allTextContents(), ["📚 THƯ VIỆN CÂU HỎI", "🗂️ BỘ CÂU HỎI MẪU"]);
    await page.click("#btnQuickLib");
    await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    assert.equal(await selected("libraryQuestionsTab"), "true"); assert.equal(await activeNav(), "library"); await childVisible();
    await page.click("#backToLibraryHub"); await page.waitForSelector(".library-hub-grid"); await hubVisible();
    await page.click('[data-nav="overview"]'); await page.waitForSelector("#btnQuickSets");
    await page.click("#btnQuickSets");
    await page.waitForSelector("#qsetGrid", { timeout: 30000 });
    assert.equal(await selected("libraryQuestionSetsTab"), "true"); assert.equal(await activeNav(), "library"); await childVisible();
    await page.click("#backToLibraryHub"); await page.waitForSelector(".library-hub-grid"); await hubVisible();
  });

  await step("11. Pure navigation created/changed NO Firestore documents or collections", async () => {
    assert.deepEqual(await snapshot(), before);
  });

  await step("10. Mobile width (375px): hub, child and tabs are usable, no horizontal overflow, cards stacked", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload(); await page.waitForSelector('[data-nav="library"]', { timeout: 60000 });
    await page.click("#btnHamburger"); await page.click('[data-nav="library"]');
    await page.waitForSelector(".library-hub-grid");
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(await noOverflow(), "hub: no horizontal overflow");
    const boxes = await page.locator(".library-hub-card").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }));
    assert.equal(boxes[0][0], boxes[1][0], "cards share the same left edge (single column)"); assert.ok(boxes[1][1] > boxes[0][1], "stacked");
    assert.ok(boxes[0][2] <= 375);
    await shot("hub-mobile");
    await page.click("#openInteractionLibrary"); await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    assert.ok(await noOverflow(), "child: no horizontal overflow");
    await shot("child-mobile");
    const tab = await page.locator("#libraryQuestionsTab").boundingBox(); assert.ok(tab.height >= 36 && tab.x >= 0 && tab.x + tab.width <= 375);
    await page.click("#libraryQuestionSetsTab"); await page.waitForSelector("#qsetGrid", { timeout: 30000 });
    assert.ok(await noOverflow(), "question sets: no horizontal overflow");
    await page.click("#backToLibraryHub"); await page.waitForSelector(".library-hub-grid");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ------------------------------------------------------------------ V1 behavior preserved (intentional V1 writes)
  await step("5. Existing question flows intact: create, edit, duplicate, delete (V1 `library` documents)", async () => {
    await page.click('[data-nav="library"]'); await page.click("#openInteractionLibrary"); await page.waitForSelector("#libGrid .card", { timeout: 30000 });
    await page.click("#btnNewLib"); await page.waitForSelector("#libForm");
    await page.selectOption("#libCat", "Tình huống"); await page.fill("#libQ", "Câu hỏi tạo mới từ P1 QA?");
    const optInputs = page.locator("#libOptions .optText");
    await optInputs.nth(0).fill("Phương án một");
    await optInputs.nth(1).fill("Phương án hai");
    await page.click('#libForm button[type="submit"]');
    await page.waitForFunction(() => (document.querySelector("#libGrid")?.textContent || "").includes("Câu hỏi tạo mới từ P1 QA?"), null, { timeout: 30000 });
    assert.equal(await cards().count(), 4);
    const card = () => cards().filter({ hasText: "Câu hỏi tạo mới từ P1 QA?" }).first();
    await card().locator("[data-e]").click(); await page.waitForSelector("#libForm");
    await page.fill("#libQ", "Câu hỏi tạo mới từ P1 QA đã sửa?"); await page.click('#libForm button[type="submit"]');
    await page.waitForFunction(() => (document.querySelector("#libGrid")?.textContent || "").includes("đã sửa?"), null, { timeout: 30000 });
    await cards().filter({ hasText: "đã sửa?" }).first().locator("[data-cp]").click();
    await page.waitForFunction(() => (document.querySelector("#libGrid")?.textContent || "").includes("(bản sao)"), null, { timeout: 30000 });
    assert.equal(await cards().count(), 5);
    await cards().filter({ hasText: "(bản sao)" }).first().locator("[data-d]").click();
    await page.waitForFunction(() => !(document.querySelector("#libGrid")?.textContent || "").includes("(bản sao)"), null, { timeout: 30000 });
    assert.equal(await cards().count(), 4);
  });

  await step("5b. DÙNG TRONG TƯƠNG TÁC starts the wizard with the library question (copy, not link)", async () => {
    await cards().filter({ hasText: "Câu hỏi khởi động số 1?" }).first().locator("[data-use]").click();
    await page.waitForSelector("#wTitle", { timeout: 30000 });
    assert.ok((await page.url()).includes("#/wizard"));
    await page.fill("#wTitle", "Phiên thử từ thư viện"); await page.click("#wizNext");
    await page.waitForSelector("#wClass"); await page.selectOption("#wClass", "c1"); await page.click("#wizNext");
    await page.waitForSelector("#wQ", { timeout: 30000 });
    assert.equal(await page.inputValue("#wQ"), "Câu hỏi khởi động số 1?");
    assert.ok((await page.textContent("#mainContent")).includes("sao chép từ Thư viện"));
  });

  await step("6. Wizard Library picker is contextual, unchanged, and adds selected copies", async () => {
    assert.ok(await page.locator("#wizFromLibrary").isVisible());
    await page.click("#wizFromLibrary");
    await page.waitForSelector(".library-picker-item", { timeout: 30000 });
    assert.ok((await page.textContent("#libPickList")).includes("Nhận định đúng sai số 3."));
    assert.ok(!(await page.textContent("#libPickList")).includes("giảng viên khác"));
    await page.fill("#libPickSearch", "đúng sai");
    assert.equal(await page.locator(".library-picker-item").count(), 1);
    await page.locator('[data-libpick]').first().check();
    assert.equal(await text("#libPickCount"), "1 câu được chọn");
    await page.click("#libPickAdd");
    await page.waitForFunction(() => (document.querySelector("#wQ")?.value || "") === "Nhận định đúng sai số 3.", null, { timeout: 30000 });
    assert.equal(await page.locator("#libPickList").count(), 0, "picker closed");
  });

  await step("wizard Hủy bỏ still returns to Overview (V1 behavior unchanged); THƯ VIỆN remains reachable", async () => {
    await page.click("#wizCancel"); await page.waitForSelector("#btnQuickLib", { timeout: 30000 });
    await page.click('[data-nav="library"]'); await page.waitForSelector(".library-hub-grid"); await hubVisible();
  });

  await step("final: no collection other than the production set exists (no libraryResources / userCapabilities / curriculum / imports)", async () => {
    const snap = await snapshot();
    const allowed = new Set(["users", "classes", "library", "questionSets", "auditLogs", "sessions", "questions"]);
    for (const col of Object.keys(snap)) assert.ok(allowed.has(col), "unexpected collection " + col);
    assert.equal(Object.keys(snap.library).length, 5, "3 seeded + 1 foreign + 1 created-and-edited (duplicate deleted)");
    assert.equal(await get("library/lib1").then((d) => d.question), "Câu hỏi khởi động số 1?", "the library original was not modified by 'use in interaction'");
  });

  const knownBaseline = errors.filter((e) => e.includes("teacherOverview") || e === "pageerror: Cannot set properties of null (setting 'innerHTML')");
  console.log(`known pre-existing teacherOverview race occurrences: ${knownBaseline.length}`);
  assert.deepEqual(errors.filter((e) => !knownBaseline.includes(e)), [], "no other page errors");
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(here, "failure.png"), fullPage: true }); console.error("screenshot:", path.join(here, "failure.png")); } catch {}
  console.error("recent errors:", errors.slice(-5));
} finally {
  await browser.close().catch(() => {}); server.close(); stopEmu();
  process.exit(exitCode);
}
