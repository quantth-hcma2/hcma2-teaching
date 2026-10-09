// LIBRARY V2 P4-S4 - synthetic browser flow for the Import Center EXECUTION (confirm -> batch -> framework -> node chunks -> FULL read-back -> completed), recovery after a browser refresh,
// network failure at the read-back, rollback, activation eligibility and duplicate-execution guards: the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// production Rules (this repo's production-candidate = ruleset 0b6910c3) and the REAL commit controller. Synthetic accounts/organizations only; nothing here can reach production.
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p4-s4/integration.e2e.mjs      (optional P4S4_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p4s4-e2e-"));
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
const list = async (col) => { const out = []; let token = ""; do { const r = await fetch(`${FS}/${col}?pageSize=300${token ? "&pageToken=" + token : ""}`, { headers: H }); const j = await r.json(); out.push(...(j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])) }))); token = j.nextPageToken || ""; } while (token); return out; };
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
const results = []; async function step(name, a, b) { const fn = b || a; await fn(); results.push(name); console.log("PASS " + name); }
const errorsOf = (page, bucket) => { page.on("pageerror", (e) => bucket.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebChannel|net::ERR/.test(m.text())) bucket.push("console: " + m.text()); }); };
const adminErrors = [], teacherErrors = [];
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctxA.newPage(); errorsOf(page, adminErrors); page.on("dialog", (d) => d.accept());
const shot = async (p, name) => { if (process.env.P4S4_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P4S4_SHOTS, name + ".png") }); } };
const text = (sel, p = page) => p.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const navLabels = (p = page) => p.evaluate(() => [...document.querySelectorAll(".navlink")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
const orgDocs = async () => (await list("organizations"));
const auditBy = async (action) => (await list("auditLogs")).filter((a) => a.action === action);
async function login(p, email) {
  await p.goto(`${base}/index.html?emulator=1`);
  await p.waitForSelector("#loginEmail", { timeout: 60000 });
  await p.fill("#loginEmail", email); await p.fill("#loginPass", PASS); await p.click("#loginBtn");
  await p.waitForSelector(".navlink", { timeout: 60000 });
  // Readiness, not a delay: the Admin landing page (adminOverview) finishes asynchronously and, if the test navigates away first, its late write replaces whatever screen was opened
  // meanwhile (that was the first-load flake). Wait until the overview has fully rendered (tiles present and the pending-teacher list no longer loading) before the first navigation.
  if (email === ADMIN) await p.waitForFunction(() => { const pending = document.querySelector("#ovPending"); return !!document.querySelector("#ovGrid .stat") && !!pending && !/Đang tải/.test(pending.textContent || ""); }, null, { timeout: 60000 });
}
const openOrgs = async () => { await page.click('[data-nav="organizations"]'); await page.waitForSelector("#orgCreateBtn, #orgBackBtn, #orgRetryBtn", { timeout: 30000 }); };
const openCreate = async () => { await page.click("#orgCreateBtn"); await page.waitForSelector("#orgCreateName"); };

// ---- Node-side use of the approved P4-S2 pipeline (to verify the bytes the browser downloaded)
const { XLSX, workbookBytes } = await import("../library-v2-p4-s2/helpers.mjs");
const { extractRawWorkbook } = await import("../../import-xlsx-extract.mjs");
const { validateImport } = await import("../../import-validate.mjs");
const { sha256Hex } = await import("../../import-sha256.mjs");
const validateBuffer = async (name, bytes) => { const ex = await extractRawWorkbook(XLSX, bytes, { fileName: name, size: bytes.length }); return { ex, r: validateImport({ ...ex, file: { name, size: bytes.length, sha256: sha256Hex(bytes) } }) }; };
let exitCode = 0;

// ---- synthetic world (REST seeding with the emulator owner bearer)
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const fwDoc = (orgId, name, status, day) => ({ schemaVersion: 1, organizationId: orgId, scope: "organization", name, status, createdAt: D(day), createdBy: admin.uid, updatedAt: D(day), ...(status === "draft" ? {} : { activatedAt: D(day + 1), statusChangedAt: D(day + 1), statusChangedBy: admin.uid }) });
const nodeSeed = (orgId, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn thử", status: "active", createdAt: D(6), updatedAt: D(6), ...extra });
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgOther", org("Trung tâm khác", "trung-tam-khac"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("curriculumFrameworks/fwMain", fwDoc("orgMain", "Chương trình hiện có", "active", 5));
await put("curriculumFrameworks/fwMain/nodes/s1", nodeSeed("orgMain", { name: "Triết học", code: "TRI" }));
await put("curriculumFrameworks/fwOther", fwDoc("orgOther", "Khung đơn vị khác", "active", 5));
await put("curriculumFrameworks/fwOther/nodes/s1", nodeSeed("orgOther", { name: "Môn khác" }));

const snapshot = async () => JSON.stringify({
  collections: (await rootCollections()).sort(),
  organizations: (await list("organizations")).map(({ updatedAt, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id)),
  frameworks: (await list("curriculumFrameworks")).sort((a, b) => a.id.localeCompare(b.id)),
  nodesMain: (await list("curriculumFrameworks/fwMain/nodes")).sort((a, b) => a.id.localeCompare(b.id)),
  nodesOther: (await list("curriculumFrameworks/fwOther/nodes")).sort((a, b) => a.id.localeCompare(b.id)),
  audit: (await list("auditLogs")).length,
  users: (await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))
});
const requests = [];
const count = (sel, p = page) => p.locator(sel).count();
const waitSection = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 30000 });
const openOrg = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection(); };
const chooseFile = async (name, bytes) => { await page.setInputFiles("#impFile", { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) }); await page.waitForFunction(() => document.querySelector("#impResults, #impFailed") && !document.querySelector("#impReading"), null, { timeout: 60000 }); };
const fs = await import("node:fs");

// ---- P4-S4 helpers
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const bigBook = (subjectsCount, lessonsPer, name = "Khung nhập thử") => { const subjects = Array.from({ length: subjectsCount }, (_, i) => ["S" + i, "Môn " + i, i]); const lessons = []; for (let s = 0; s < subjectsCount; s++) for (let l = 0; l < lessonsPer; l++) lessons.push(["S" + s, "S" + s + "-L" + l, "Bài " + l, l]); return workbookBytes({ framework: [name], subjects, lessons }); };
const batches = async () => (await list("importBatches")).sort((a, b) => a.id.localeCompare(b.id));
const nodesOf = async (id) => (await list(`curriculumFrameworks/${id}/nodes`));
const importCenterOf = async (orgId) => { await openOrg(orgId); await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 }); await page.waitForSelector("#impOrg"); };
const confirmRun = async () => { await page.check("#impConfirmAck"); await page.click("#impConfirmBtn"); };
const waitDone = (timeout = 240000) => page.waitForSelector("#impRun [data-run='result']", { timeout });
const waitStop = (timeout = 240000) => page.waitForSelector("#impRun [data-run='stop']", { timeout });
const runPhaseNow = () => page.evaluate(() => document.querySelector("#impRunPhase")?.dataset.phase || "");
const fwGet = (id) => get(`curriculumFrameworks/${id}`);
const dialogGone = () => page.waitForFunction(() => !document.querySelector("#modalBackdrop.open, .modal-backdrop.open, #orgFwConfirm"), null, { timeout: 15000 });
const sha = (bytes) => sha256Hex(bytes);

try {
  await login(page, ADMIN);
  page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
  await openOrgs();
  const otherBefore = JSON.stringify({ fw: await fwGet("fwOther"), nodes: await nodesOf("fwOther") });
  const mainBefore = JSON.stringify({ fw: await fwGet("fwMain"), nodes: await nodesOf("fwMain") });

  await step("EXECUTION IS OFFERED in the real app: the confirm card replaces the S3 disabled placeholder; it names the organization and counts and stays disabled until the explicit acknowledgement", async () => {
    await importCenterOf("orgMain");
    const dl = await Promise.all([page.waitForEvent("download"), page.click("#impTemplateExample")]);
    globalThis.__example = new Uint8Array(fs.readFileSync(await dl[0].path()));
    await chooseFile("example.xlsx", globalThis.__example);
    await page.waitForSelector("#impConfirm");
    assert.equal(await count("#impConfirmDisabled"), 0); assert.match(await text('[data-confirm="counts"]'), /3 môn · 7 bài · 10 mục/); assert.match(await text('[data-confirm="org"]'), /Khoa Quản trị[\s\S]*khoa-quan-tri/);
    assert.equal(await page.locator("#impConfirmBtn").isDisabled(), true);
    assert.deepEqual(await batches(), [], "nothing is written by merely previewing");
    await shot(page, "s4-01-confirm");
  });

  let smallId = null;
  await step("SMALL IMPORT (the example template, 10 nodes): confirm -> batch -> framework -> nodes -> full read-back -> completed; success is shown only after the read-back; Firestore holds exactly the planned dataset", async () => {
    await confirmRun();
    await waitDone(60000);
    assert.match(await text("#impRunTitle"), /Đã nhập xong và kiểm tra đầy đủ/); assert.match(await text('[data-run="result"]'), /Đã đọc lại 10 mục \(3 môn, 7 bài\)[\s\S]*khớp 100%/);
    assert.match(await text('[data-run="eligibility"]'), /sẵn sàng để kích hoạt/);
    await shot(page, "s4-02-success");
    const b = await batches(); assert.equal(b.length, 1); const batch = b[0]; smallId = batch.id;
    assert.equal(batch.status, "completed"); assert.equal(batch.kind, "curriculum"); assert.equal(batch.organizationId, "orgMain"); assert.equal(batch.importer, admin.uid); assert.equal(batch.chunksDone, batch.chunksTotal); assert.equal(batch.chunksTotal, 1);
    assert.deepEqual(batch.destination, { type: "curriculumFramework", frameworkId: batch.id }); assert.equal(batch.sourceFile.sha256, sha(globalThis.__example)); assert.equal(batch.sourceFile.size, globalThis.__example.length); assert.deepEqual(batch.counts, { parsed: 10, accepted: 10, skipped: 0, failed: 0 });
    assert.ok(batch.finishedAt && !("resultCode" in batch));
    const fw = await fwGet(batch.id); assert.equal(fw.status, "draft"); assert.ok(!("activatedAt" in fw)); assert.equal(fw.organizationId, "orgMain"); assert.equal(fw.createdBy, admin.uid); assert.match(fw.name, /^Khung ví dụ: Nghiệp vụ văn phòng/);
    const nodes = await nodesOf(batch.id); assert.equal(nodes.length, 10); assert.ok(nodes.every((n) => n.organizationId === "orgMain" && n.status === "active")); assert.ok(nodes.some((n) => n.id === batch.finalNodeId));
    assert.equal(nodes.filter((n) => n.kind === "subject").length, 3); assert.equal(nodes.filter((n) => n.kind === "lesson").length, 7);
    assert.equal(JSON.stringify({ fw: await fwGet("fwOther"), nodes: await nodesOf("fwOther") }), otherBefore, "another organization is untouched"); assert.equal(JSON.stringify({ fw: await fwGet("fwMain"), nodes: await nodesOf("fwMain") }), mainBefore, "the existing framework is untouched");
  });

  await step("ACTIVATION ELIGIBILITY in the P3 UI: the imported draft appears in the list, opens in the node editor with every imported node, and the existing KÍCH HOẠT flow activates it (the deployed Rules accept it only because the batch is completed)", async () => {
    await page.click("#impRunBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    await page.waitForSelector(`[data-fw-id="${smallId}"][data-fw-action="activate"]`);
    await page.click(`[data-fw-id="${smallId}"][data-fw-action="open"]`); await page.waitForSelector("#edBody", { timeout: 30000 }); await page.waitForFunction(() => document.querySelector("#edBody")?.getAttribute("aria-busy") === "false", null, { timeout: 30000 });
    const body = await text("#edBody"); for (const needle of ["Soạn thảo văn bản hành chính", "Quản lý hồ sơ và lưu trữ", "Giao tiếp công sở"]) assert.ok(body.includes(needle), needle);
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    await page.click(`[data-fw-id="${smallId}"][data-fw-action="activate"]`); await page.waitForSelector("#orgFwConfirm:not([disabled])"); await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    const fw = await fwGet(smallId); assert.equal(fw.status, "active"); assert.ok(fw.activatedAt); assert.equal((await get(`importBatches/${smallId}`)).status, "completed");
    await shot(page, "s4-03-activated");
  });

  await step("DUPLICATE EXECUTION in the real app: a double click on the confirm button creates exactly ONE batch, ONE framework and the exact node set", async () => {
    await importCenterOf("orgMain");
    await chooseFile("dup.xlsx", bigBook(4, 150, "Khung nhập kép"));                                   // 604 nodes -> 2 chunks
    await page.check("#impConfirmAck"); await page.dblclick("#impConfirmBtn");
    await page.waitForSelector("#impRun", { timeout: 30000 });
    await waitDone(120000);
    const done = (await batches()).filter((x) => x.sourceFile.name === "dup.xlsx"); assert.equal(done.length, 1, "exactly one batch for the double-clicked import"); assert.equal(done[0].status, "completed");
    assert.equal((await nodesOf(done[0].id)).length, 604); assert.equal((await list("curriculumFrameworks")).filter((f) => f.name === "Khung nhập kép").length, 1);
  });

  await step("5,000 NODES + BROWSER REFRESH MID-RUN: the page is reloaded while nodes are being written; on re-entry the interrupted batch is listed (committing), TIẾP TỤC with the SAME file writes only what is missing, reads everything back and completes - exactly 5000 nodes, no duplicates", { timeout: 600000 }, async () => {
    const book = bigBook(50, 99, "Khung năm nghìn nút"); const bookSha = sha(book);
    await page.click("#impBack").catch(() => {}); await openOrg("orgMain"); await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    await chooseFile("5000.xlsx", book); await page.waitForSelector("#impConfirm");
    assert.match(await text('[data-confirm="counts"]'), /50 môn · 4950 bài · 5000 mục/); assert.match(await text('[data-confirm="documents"]'), /5002 tài liệu[\s\S]*13 đợt ghi/);
    await confirmRun();
    await page.waitForFunction(() => { const el = document.querySelector("#impRunPhase"); return el && el.dataset.phase === "nodes" && /\b(1[2-9]\d\d|[2-9]\d\d\d)\/5000/.test(el.textContent); }, null, { timeout: 180000, polling: 25 });
    const midText = await text("#impRunPhase"); await shot(page, "s4-04-progress");
    // ---- a SECOND browser tab while the first import is running: the data-level guard offers only TIẾP TỤC of the incomplete batch; starting it is refused by the organization lock (Web Locks)
    {
      const running = (await batches()).find((x) => x.sourceFile.name === "5000.xlsx"); assert.ok(running && running.status === "committing");
      const second = await ctxA.newPage(); errorsOf(second, adminErrors); second.on("dialog", (d) => d.accept());
      await second.goto(`${base}/index.html?emulator=1`); await second.waitForSelector(".navlink", { timeout: 60000 });
      await second.waitForFunction(() => { const p = document.querySelector("#ovPending"); return !!document.querySelector("#ovGrid .stat") && !!p && !/Đang tải/.test(p.textContent || ""); }, null, { timeout: 60000 });
      await second.click('[data-nav="organizations"]'); await second.waitForSelector("[data-org-open]"); await second.click('[data-org-open="orgMain"]'); await second.waitForSelector("#orgMembersCard", { timeout: 30000 });
      await second.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false", null, { timeout: 30000 });
      await second.click("#orgImportBtn"); await second.waitForSelector("#impPick:not([disabled])", { timeout: 30000 }); await second.waitForSelector("#impRecovery", { timeout: 30000 });
      await second.setInputFiles("#impFile", { name: "other.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bigBook(2, 3, "Khung tab hai")) });
      await second.waitForSelector("#impConfirm", { timeout: 60000 }); assert.equal(await second.locator("#impConfirmBtn").isDisabled(), true, "a NEW import is blocked while one is incomplete (data-level guard)");
      await second.click(`[data-imp-action="resume-pick"][data-batch="${running.id}"]`); await second.setInputFiles("#impFile", { name: "5000.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(book) });
      await second.waitForSelector("#impConfirm", { timeout: 60000 }); await second.check("#impConfirmAck"); await second.click("#impConfirmBtn");
      await second.waitForSelector("#impRun [data-run='stop']", { timeout: 30000 });
      assert.match(await second.evaluate(() => document.querySelector("#impRun [data-run='stop']").textContent), /đang chạy ở thẻ trình duyệt khác/);
      assert.equal((await batches()).filter((x) => x.sourceFile.name === "other.xlsx").length, 0, "the second tab wrote nothing");
      await second.close();
    }

    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.waitForFunction(() => { const p = document.querySelector("#ovPending"); return !!document.querySelector("#ovGrid .stat") && !!p && !/Đang tải/.test(p.textContent || ""); }, null, { timeout: 60000 });
    const mid = (await batches()).filter((x) => x.sourceFile.name === "5000.xlsx"); assert.equal(mid.length, 1); assert.equal(mid[0].status, "committing", "an interrupted import stays committing (midText: " + midText + ")");
    const batchId = mid[0].id; const midNodes = (await nodesOf(batchId)).length; assert.ok(midNodes > 0 && midNodes < 5000, "partial data was written before the refresh: " + midNodes);
    await importCenterOf("orgMain");
    await page.waitForSelector("#impRecovery"); assert.match(await text("#impRecovery"), /5000\.xlsx[\s\S]*Đang nhập dở/); await shot(page, "s4-05-recovery");
    await page.click(`[data-imp-action="resume-pick"][data-batch="${batchId}"]`);
    await chooseFile("5000.xlsx", book); await page.waitForSelector("#impConfirm"); assert.match(await text("#impConfirmTitle"), /TIẾP TỤC lần nhập dở/);
    await confirmRun(); await waitDone(300000);
    assert.match(await text('[data-run="result"]'), /Đã đọc lại 5000 mục \(50 môn, 4950 bài\)/);
    const after = (await batches()).find((x) => x.id === batchId); assert.equal(after.status, "completed"); assert.equal(after.chunksDone, 13); assert.equal(after.sourceFile.sha256, bookSha);
    const all = await nodesOf(batchId); assert.equal(all.length, 5000); assert.equal(new Set(all.map((n) => n.id)).size, 5000); assert.equal((await fwGet(batchId)).status, "draft");
    assert.ok(all.some((n) => n.id === after.finalNodeId));
    await shot(page, "s4-06-5000-completed");
  });

  await step("NETWORK FAILURE at the read-back: going offline during verification pauses the run with the written data kept (no false success); back online, TIẾP TỤC verifies everything and completes", { timeout: 600000 }, async () => {
    const book = bigBook(20, 99, "Khung gián đoạn mạng");                                                    // 2000 nodes -> 5 chunks
    await page.click("#impRunBack").catch(() => {}); await openOrg("orgMain"); await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    await chooseFile("net.xlsx", book); await page.waitForSelector("#impConfirm"); await confirmRun();
    await page.waitForFunction(() => { const el = document.querySelector("#impRunPhase"); return el && el.dataset.phase === "verify"; }, null, { timeout: 180000, polling: 10 });
    await ctxA.setOffline(true);
    await waitStop(120000);
    assert.match(await text('[data-run="stop"]'), /Kết nối bị gián đoạn[\s\S]*giữ nguyên/); assert.equal(await count("#impRunResume"), 1); assert.doesNotMatch(await text("#host, body"), /Đã nhập xong và kiểm tra đầy đủ/);
    await shot(page, "s4-07-paused");
    await ctxA.setOffline(false);
    const net = (await batches()).find((x) => x.sourceFile.name === "net.xlsx"); assert.ok(net, "batch exists"); assert.ok(["committing", "completed"].includes(net.status));
    if (net.status === "committing") { await page.click("#impRunResume"); await waitDone(180000); }
    const final = (await batches()).find((x) => x.sourceFile.name === "net.xlsx"); assert.equal(final.status, "completed"); const nodes = await nodesOf(final.id); assert.equal(nodes.length, 2000); assert.equal(new Set(nodes.map((n) => n.id)).size, 2000);
  });

  await step("ROLLBACK in the real app: an interrupted import (page reloaded mid-run) is rolled back from the recovery card after an explicit acknowledgement - nodes and framework are deleted, the batch record stays as rolled_back, other frameworks are untouched", { timeout: 600000 }, async () => {
    const book = bigBook(20, 99, "Khung sẽ hoàn tác");
    await page.click("#impRunBack").catch(() => {}); await openOrg("orgMain"); await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    await chooseFile("rollback.xlsx", book); await page.waitForSelector("#impConfirm"); await confirmRun();
    await page.waitForFunction(() => { const el = document.querySelector("#impRunPhase"); return el && el.dataset.phase === "nodes" && /\b([4-9]\d\d|1\d\d\d)\/2000/.test(el.textContent); }, null, { timeout: 180000, polling: 25 });
    await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 });
    await page.waitForFunction(() => { const p = document.querySelector("#ovPending"); return !!document.querySelector("#ovGrid .stat") && !!p && !/Đang tải/.test(p.textContent || ""); }, null, { timeout: 60000 });
    const b = (await batches()).find((x) => x.sourceFile.name === "rollback.xlsx"); assert.equal(b.status, "committing"); const before = (await nodesOf(b.id)).length; assert.ok(before > 0);
    // ---- P3 PROTECTION: the interrupted import is marked "Đang nhập dữ liệu" in the P3 list and every action of its row is disabled (the Rules refuse the edits anyway)
    await openOrg("orgMain");
    {
      const row = page.locator(`[data-fw-row="${b.id}"]`); await row.waitFor({ timeout: 30000 });
      assert.match(await row.innerText(), /Đang nhập dữ liệu/); assert.match(await row.innerText(), /Chưa thể mở, đổi tên, kích hoạt, nhân bản hoặc xóa/);
      const states = await row.locator("button").evaluateAll((els) => els.map((e) => e.disabled && e.getAttribute("aria-disabled") === "true"));
      assert.ok(states.length >= 2 && states.every(Boolean), "every action of the frozen row is disabled: " + JSON.stringify(states));
      const ordinary = page.locator(`[data-fw-row="${smallId}"] button`); assert.ok((await ordinary.evaluateAll((els) => els.filter((e) => !e.disabled).length)) >= 1, "ordinary rows keep enabled actions");
      await row.scrollIntoViewIfNeeded(); await shot(page, "s4-p3-frozen-committing");
    }
    await importCenterOf("orgMain"); await page.waitForSelector("#impRecovery");
    await page.click(`[data-imp-action="rollback-open"][data-batch="${b.id}"]`); await page.waitForSelector("#impRollbackConfirm"); assert.equal(await page.locator("#impRbConfirm").isDisabled(), true);
    await page.check("#impRbAck"); await shot(page, "s4-08-rollback-confirm"); await page.click("#impRbConfirm"); await waitDone(240000);
    assert.match(await text("#impRunTitle"), /Đã hoàn tác lần nhập/);
    const rb = await get(`importBatches/${b.id}`); assert.equal(rb.status, "rolled_back"); assert.equal(rb.resultCode, "ROLLED_BACK"); assert.ok(rb.finishedAt); assert.equal(await fwGet(b.id), null); assert.equal((await nodesOf(b.id)).length, 0);
    assert.equal(JSON.stringify({ fw: await fwGet("fwOther"), nodes: await nodesOf("fwOther") }), otherBefore, "another organization is untouched"); assert.equal(JSON.stringify({ fw: await fwGet("fwMain"), nodes: await nodesOf("fwMain") }), mainBefore, "the pre-existing framework is untouched");
    assert.equal(await count("#impRecovery"), 0, "nothing incomplete remains");
  });

  await step("P3 PROTECTION (partial): a framework whose paired batch is `partial` is marked \"Nhập chưa hoàn tất\" with every action disabled; when the batch is completed the same framework is an ordinary draft again", async () => {
    const rb = (await batches()).find((x) => x.sourceFile.name === "rollback.xlsx"); const id = "PartialDemo000000001";
    await put(`curriculumFrameworks/${id}`, fwDoc("orgMain", "Khung nhập dở (thử nghiệm)", "draft", 8));
    await put(`importBatches/${id}`, { ...rb, status: "partial", resultCode: "ABANDONED", destination: { type: "curriculumFramework", frameworkId: id } });
    await page.click("#impRunBack, #impBack").catch(() => {}); await openOrg("orgMain");
    const row = page.locator(`[data-fw-row="${id}"]`); await row.waitFor({ timeout: 30000 });
    assert.match(await row.innerText(), /Nhập chưa hoàn tất/);
    const states = await row.locator("button").evaluateAll((els) => els.map((e) => e.disabled)); assert.ok(states.length >= 2 && states.every(Boolean));
    await row.scrollIntoViewIfNeeded(); await shot(page, "s4-p3-frozen-partial");
    await put(`importBatches/${id}`, { ...rb, status: "completed", destination: { type: "curriculumFramework", frameworkId: id } });
    await openOrg("orgMain"); const again = page.locator(`[data-fw-row="${id}"]`); await again.waitFor({ timeout: 30000 });
    assert.doesNotMatch(await again.innerText(), /Nhập chưa hoàn tất|Đang nhập dữ liệu/); assert.ok((await again.locator("button").evaluateAll((els) => els.filter((e) => !e.disabled).length)) >= 1, "a completed import is an ordinary draft with live actions");
    for (const p of [`curriculumFrameworks/${id}`, `importBatches/${id}`]) await fetch(`${FS}/${p}`, { method: "DELETE", headers: H });
  });

  await step("BOUNDARIES: archived organization offers no import; a teacher has no entry; no source file bytes or Storage requests left the browser; no unexpected page errors", async () => {
    await page.click("#impRunDismiss, [data-imp-action='run-dismiss']").catch(() => {});
    await page.click('[data-nav="classes"]'); await openOrgs(); await page.click('[data-org-open="orgArch"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    assert.equal(await page.locator("#orgImportBtn").isDisabled(), true);
    const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const tp = await ctxT.newPage(); errorsOf(tp, teacherErrors);
    await login(tp, TEACHER); assert.equal(await count('[data-nav="organizations"]', tp), 0); assert.equal(await count("#orgImportBtn", tp), 0); await ctxT.close();
    assert.ok(!requests.some((r) => /firebasestorage|storage\.googleapis/.test(r.url)), "nothing sent to Storage");
    assert.ok(!requests.some((r) => r.method === "POST" && /\.xlsx/.test(r.url)), "no file upload request");
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const unexpected = adminErrors.filter((e) => !known(e)); assert.deepEqual(unexpected, [], "no unexpected admin-page errors: " + unexpected.join(" | "));
    assert.deepEqual(teacherErrors.filter((e) => !known(e)), [], "no unexpected teacher-page errors");
  });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S4_SHOTS || os.tmpdir(), "p4s4-integration-failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", adminErrors.slice(-5), teacherErrors.slice(-3));
} finally {
  await browser.close().catch(() => {}); server.close(); stopEmu(); process.exit(exitCode);
}
