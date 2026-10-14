// LIBRARY V2 P4-S5-B - synthetic browser flow for the AUDIT events and the DUPLICATE-FILE warning in the REAL index.html against LOCAL Auth + Firestore emulators loaded with the LIVE Rules bytes
// (firestore.rules.production-candidate = ruleset 02ca5a30, SHA F6B9DE01...7D4A) and the REAL controller / audit module. Synthetic accounts and organizations only; nothing here can reach production.
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.   Run: node test/library-v2-p4-s5/integration.e2e.mjs   (optional P4S5_SHOTS=<dir>)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p4s5b-e2e-"));
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
const shot = async (p, name) => { if (process.env.P4S5_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P4S5_SHOTS, name + ".png") }); } };
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
  const otherBefore0 = JSON.stringify({ fw: await fwGet("fwOther"), nodes: await nodesOf("fwOther") });
  const importAudits = async () => (await list("auditLogs")).filter((a) => /^curriculum\.import\./.test(a.action || "")).sort((a, b) => a.id.localeCompare(b.id));
  const patchName = async (p, name) => { const r = await fetch(`${FS}/${p}?updateMask.fieldPaths=name`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { name: { stringValue: name } } }) }); if (!r.ok) throw new Error("tamper " + r.status); };
  const waitAuditUi = (state) => page.waitForSelector(`[data-run="audit"][data-audit-state="${state}"]`, { timeout: 30000 });
  const midRun = (total) => page.waitForFunction((t) => { const el = document.querySelector("#impRunPhase"); return el && el.dataset.phase === "nodes" && new RegExp("\\b(4\\d\\d|[5-9]\\d\\d|1[01]\\d\\d)/" + t).test(el.textContent); }, total, { timeout: 180000, polling: 25 });
  const reloadToOverview = async () => { await page.reload(); await page.waitForSelector(".navlink", { timeout: 60000 }); await page.waitForFunction(() => { const p = document.querySelector("#ovPending"); return !!document.querySelector("#ovGrid .stat") && !!p && !/Đang tải/.test(p.textContent || ""); }, null, { timeout: 60000 }); };
  const startBig = async (fileName, book) => { await page.click("#impRunBack, #impBack").catch(() => {}); await openOrg("orgMain"); await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 }); await chooseFile(fileName, book); await page.waitForSelector("#impConfirm"); };
  let exampleBytes = null, firstId = null;

  await step("COMPLETED IMPORT -> AUDIT (real app, real Rules): the example import completes, the page shows 'Đã ghi nhật ký hoạt động', and auditLogs holds exactly ONE `curriculum.import.completed` entry with the deterministic id, actor, organization, batch, framework and importer", async () => {
    await importCenterOf("orgMain");
    const dl = await Promise.all([page.waitForEvent("download"), page.click("#impTemplateExample")]); exampleBytes = new Uint8Array(fs.readFileSync(await dl[0].path()));
    await chooseFile("example.xlsx", exampleBytes); await page.waitForSelector("#impConfirm");
    await page.waitForSelector('#impDup[data-dup="none"]'); assert.match(await text("#impDup"), /chưa có lần nhập hoàn tất nào của tệp này/);
    await confirmRun(); await waitDone(60000); await waitAuditUi("recorded");
    assert.match(await text("#impRunTitle"), /Đã nhập xong và kiểm tra đầy đủ/); assert.match(await text('[data-run="audit"]'), /Đã ghi nhật ký hoạt động/); await shot(page, "s5b-i1-audit-recorded");
    const b = await batches(); assert.equal(b.length, 1); firstId = b[0].id; assert.equal(b[0].status, "completed");
    const audits = await importAudits(); assert.equal(audits.length, 1); const a = audits[0];
    assert.equal(a.id, `import_${firstId}_completed`); assert.equal(a.action, "curriculum.import.completed"); assert.equal(a.entityType, "importBatch"); assert.equal(a.entityId, firstId); assert.equal(a.actorId, admin.uid); assert.equal(a.actorRole, "admin"); assert.equal(a.actorEmail, ADMIN);
    assert.deepEqual({ o: a.detail.organizationId, b: a.detail.batchId, f: a.detail.frameworkId, i: a.detail.importerId, outcome: a.detail.outcome, resumed: a.detail.resumed }, { o: "orgMain", b: firstId, f: firstId, i: admin.uid, outcome: "completed", resumed: false });
    assert.ok(typeof a.createdAt === "string" && !Number.isNaN(Date.parse(a.createdAt)), "server timestamp"); assert.deepEqual(a.detail.counts, b[0].counts);
  });
  await step("DUPLICATE WARNING (real query, real Rules): choosing the SAME file again shows the advisory warning with the earlier completed import; it can still be imported again as a NEW batch with its own audit entry; the first entry is untouched", async () => {
    await page.click("#impRunBack"); await page.waitForSelector("#orgDetailTitle"); await importCenterOf("orgMain");
    const before = JSON.stringify((await importAudits())[0]);
    await chooseFile("example-again.xlsx", exampleBytes); await page.waitForSelector("#impConfirm"); await page.waitForSelector('#impDup[data-dup="found"]');
    const t = await text("#impDup"); assert.match(t, /Tệp này đã được nhập thành công trước đó/); assert.match(t, /10 mục/); assert.match(t, /khung nháp MỚI/); await shot(page, "s5b-i2-duplicate-warning");
    assert.deepEqual((await batches()).map((x) => x.id), [firstId], "the lookup wrote nothing");
    await confirmRun(); await waitDone(60000); await waitAuditUi("recorded");
    const b = await batches(); assert.equal(b.length, 2); assert.ok(b.every((x) => x.status === "completed")); const audits = await importAudits(); assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((a) => a.id).sort(), b.map((x) => `import_${x.id}_completed`).sort()); assert.equal(JSON.stringify(audits.find((a) => a.id === `import_${firstId}_completed`)), before, "the first audit entry was not modified");
  });
  let rolledId = null;
  await step("ROLLED-BACK IMPORT: interrupted import (page reloaded mid-run) is rolled back from the recovery card -> exactly one `curriculum.import.rolledBack` entry and NO `partial` entry (the rollback barrier is not audited); afterwards the same file shows NO duplicate warning (rolled_back does not count) and is not blocked", async () => {
    const book = bigBook(12, 99, "Khung hoàn tác S5"); const NODES = 1200;
    await startBig("big-a.xlsx", book); await confirmRun(); await midRun(NODES); await reloadToOverview();
    const b = (await batches()).find((x) => x.sourceFile.name === "big-a.xlsx"); assert.ok(b && b.status === "committing"); rolledId = b.id;
    await importCenterOf("orgMain"); await page.waitForSelector("#impRecovery");
    await page.click(`[data-imp-action="rollback-open"][data-batch="${rolledId}"]`); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitDone(240000); await waitAuditUi("recorded");
    assert.match(await text("#impRunTitle"), /Đã hoàn tác lần nhập/);
    const rb = await get(`importBatches/${rolledId}`); assert.equal(rb.status, "rolled_back");
    const audits = (await importAudits()).filter((a) => a.entityId === rolledId); assert.deepEqual(audits.map((a) => a.action), ["curriculum.import.rolledBack"], "only the rolledBack event");
    assert.equal(audits[0].id, `import_${rolledId}_rolledBack`); assert.equal(audits[0].detail.resultCode, "ROLLED_BACK"); assert.equal(audits[0].detail.trigger, "operator"); assert.ok(audits[0].detail.nodesDeleted > 0);
    await page.click("#impRunDismiss, [data-imp-action='run-dismiss']").catch(() => {});
    await chooseFile("big-a-again.xlsx", book); await page.waitForSelector("#impConfirm"); await page.waitForSelector('#impDup[data-dup="none"]');
    assert.equal(await count('#impDup[data-dup="found"]'), 0); await page.check("#impConfirmAck"); assert.equal(await page.locator("#impConfirmBtn").isDisabled(), false, "a rolled-back earlier attempt does not block or warn");
  });
  let partialId = null;
  await step("PARTIAL IMPORT (verification failure): a node altered behind the controller's back makes the resumed import fail verification -> durable partial -> exactly one `curriculum.import.partial` entry (VERIFY_FAILED); the later rollback adds exactly one `rolledBack` entry; the batch never becomes completed", async () => {
    const book = bigBook(12, 99, "Khung dừng S5"); const NODES = 1200;
    await startBig("big-b.xlsx", book); await confirmRun(); await midRun(NODES); await reloadToOverview();
    const b = (await batches()).find((x) => x.sourceFile.name === "big-b.xlsx"); assert.ok(b && b.status === "committing"); partialId = b.id;
    const nodes = await nodesOf(partialId); assert.ok(nodes.length > 0 && nodes.length < NODES); await patchName(`curriculumFrameworks/${partialId}/nodes/${nodes[0].id}`, "Đã sửa ngoài luồng");
    await importCenterOf("orgMain"); await page.waitForSelector("#impRecovery");
    await page.click(`[data-imp-action="resume-pick"][data-batch="${partialId}"]`); await chooseFile("big-b.xlsx", book); await page.waitForSelector("#impConfirm");
    assert.equal(await count("#impDup"), 0, "no duplicate lookup when resuming");
    await confirmRun(); await waitStop(240000); await waitAuditUi("recorded"); await shot(page, "s5b-i3-partial-audit");
    assert.match(await text('#impRun [data-run="stop"]'), /KHÔNG khớp kế hoạch/);
    const pb = await get(`importBatches/${partialId}`); assert.equal(pb.status, "partial"); assert.equal(pb.resultCode, "VERIFY_FAILED");
    let audits = (await importAudits()).filter((a) => a.entityId === partialId); assert.deepEqual(audits.map((a) => a.action), ["curriculum.import.partial"]); assert.equal(audits[0].id, `import_${partialId}_partial`); assert.equal(audits[0].detail.resultCode, "VERIFY_FAILED");
    await page.waitForSelector("#impRecovery"); await page.click(`[data-imp-action="rollback-open"][data-batch="${partialId}"]`); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitDone(240000); await waitAuditUi("recorded");
    audits = (await importAudits()).filter((a) => a.entityId === partialId); assert.deepEqual(audits.map((a) => a.action).sort(), ["curriculum.import.partial", "curriculum.import.rolledBack"]);
    const totals = (await importAudits()).reduce((m, a) => ({ ...m, [a.action]: (m[a.action] || 0) + 1 }), {}); assert.deepEqual(totals, { "curriculum.import.completed": 2, "curriculum.import.rolledBack": 2, "curriculum.import.partial": 1 });
  });
  await step("AUDIT RESULTS are visible to the Platform Admin in Nhật ký hoạt động (existing screen, no change): the three import actions are listed and searchable", async () => {
    await page.click("#impRunDismiss, [data-imp-action='run-dismiss']").catch(() => {}); await page.click("#impBack").catch(() => {});
    await page.click('[data-nav="audit"]'); await page.waitForSelector("#auditTable table", { timeout: 30000 });
    await page.fill("#auditSearch", "curriculum.import"); await page.waitForTimeout(300);
    const t = await text("#auditTable"); for (const a of ["curriculum.import.completed", "curriculum.import.rolledBack", "curriculum.import.partial"]) assert.ok(t.includes(a), a); await shot(page, "s5b-i4-audit-screen");
  });
  await step("BOUNDARIES: nothing is sent to Storage; no source-file upload; no unexpected page errors; other organizations and frameworks untouched", async () => {
    assert.ok(!requests.some((r) => /firebasestorage|storage\.googleapis/.test(r.url))); assert.ok(!requests.some((r) => r.method === "POST" && /\.xlsx/.test(r.url)));
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const unexpected = adminErrors.filter((e) => !known(e)); assert.deepEqual(unexpected, [], "no unexpected page errors: " + unexpected.join(" | "));
    assert.equal(JSON.stringify({ fw: await fwGet("fwOther"), nodes: await nodesOf("fwOther") }), otherBefore0, "another organization untouched");
  });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S5_SHOTS || os.tmpdir(), "p4s5-integration-failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", adminErrors.slice(-5), teacherErrors.slice(-3));
} finally {
  await browser.close().catch(() => {}); server.close(); stopEmu(); process.exit(exitCode);
}

