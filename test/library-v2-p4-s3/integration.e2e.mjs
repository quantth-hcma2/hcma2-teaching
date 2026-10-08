// LIBRARY V2 P4-S3 - synthetic browser flow for the Template Center + Import Center (UI / PREVIEW ONLY): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with
// the production Rules (this repo's production-candidate = ruleset 0b6910c3). Synthetic accounts/organizations only; nothing here can reach production (the app refuses emulator mode on the
// production host). Proves: entry from Organization Detail, template download + re-import, validation/preview in the real app, organization isolation, access, NO Firestore write, P3 UI regression.
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p4-s3/integration.e2e.mjs      (optional P4S3_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p4s3-e2e-"));
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
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const errorsOf = (page, bucket) => { page.on("pageerror", (e) => bucket.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebChannel|net::ERR/.test(m.text())) bucket.push("console: " + m.text()); }); };
const adminErrors = [], teacherErrors = [];
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctxA.newPage(); errorsOf(page, adminErrors); page.on("dialog", (d) => d.accept());
const shot = async (p, name) => { if (process.env.P4S3_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P4S3_SHOTS, name + ".png") }); } };
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

try {
  await login(page, ADMIN);
  page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
  await openOrgs();
  const before = await snapshot();

  await step("ENTRY: Organization Detail shows NHẬP TỪ EXCEL in the Chương trình card (enabled for an active organization, DISABLED with the reason for an archived one); the P3 controls are all still there", async () => {
    await page.click('[data-org-open="orgMain"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    assert.equal(await count("#orgImportBtn"), 1); assert.equal(await page.locator("#orgImportBtn").isDisabled(), false); assert.match(await text("#orgImportBtn"), /NHẬP TỪ EXCEL/);
    assert.equal(await count("#orgFwCreateBtn"), 1); assert.equal(await count('[data-fw-id="fwMain"][data-fw-action="open"]'), 1); assert.equal(await count("#orgMembersCard"), 1);
    await shot(page, "01-detail");
    await page.click('[data-nav="classes"]'); await openOrgs(); await page.click('[data-org-open="orgArch"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    assert.equal(await page.locator("#orgImportBtn").isDisabled(), true); assert.match(await text("#orgImportHint"), /Đơn vị đã lưu trữ: không thể nhập tệp mới\. Hãy khôi phục đơn vị trước\./);
  });

  await step("OPEN / BACK: the Import Center replaces Organization Detail for THAT organization (name, code, id), loads the engine lazily, and Quay lại restores the detail with focus on NHẬP TỪ EXCEL", async () => {
    await openOrg("orgMain");
    requests.length = 0;
    await page.click("#orgImportBtn"); await page.waitForSelector("#impOrg"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    assert.equal(await count("#orgDetailTitle"), 0, "the detail is replaced"); assert.equal(await text("#impOrgName"), "Khoa Quản trị"); assert.equal(await text("#impOrgCode"), "khoa-quan-tri"); assert.equal(await text("#impOrgId"), "orgMain");
    assert.ok(requests.some((r) => /import-center-engine\.mjs/.test(r.url)), "engine requested only now"); assert.ok(!requests.some((r) => /vendor\/sheetjs/.test(r.url)));
    assert.equal(await count("#impConfirmDisabled"), 0);
    await shot(page, "02-import-center");
    await page.click("#impBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "orgImportBtn", "focus returns to the entry button");
    assert.equal(await text("#orgDetailTitle"), "Khoa Quản trị");
  });

  await step("TEMPLATE CENTER (real download): both files download with the right names; the downloaded bytes validate through the approved pipeline (example = 3 subjects/7 lessons, blank = structure OK)", async () => {
    await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    const [blankDl] = await Promise.all([page.waitForEvent("download"), page.click("#impTemplateBlank")]);
    const [exampleDl] = await Promise.all([page.waitForEvent("download"), page.click("#impTemplateExample")]);
    assert.equal(blankDl.suggestedFilename(), "HCMA2_mau_khung_chuong_trinh_v1.xlsx"); assert.equal(exampleDl.suggestedFilename(), "HCMA2_mau_khung_chuong_trinh_v1_co_vi_du.xlsx");
    const blankBytes = new Uint8Array(fs.readFileSync(await blankDl.path())), exampleBytes = new Uint8Array(fs.readFileSync(await exampleDl.path()));
    const e = await validateBuffer("example.xlsx", exampleBytes); assert.equal(e.r.ok, true, JSON.stringify(e.r.errors)); assert.deepEqual(e.r.counts, { subjects: 3, lessons: 7, total: 10 });
    const b = await validateBuffer("blank.xlsx", blankBytes); assert.deepEqual(b.r.errors.map((x) => x.code), ["FRAMEWORK_ROW_COUNT"]);
    globalThis.__example = exampleBytes; globalThis.__blank = blankBytes;
  });

  await step("VALID FILE in the real app: re-selecting the downloaded example gives the preview (org identity, framework, 3 subjects / 7 lessons, hierarchy, plan 12 documents / 1 chunk) and a DISABLED confirm", async () => {
    await chooseFile("example.xlsx", globalThis.__example);
    assert.match(await text("#impVerdict"), /Tệp hợp lệ, không có lỗi hay cảnh báo\./); assert.equal(await text('[data-prev="counts"]'), "3 môn · 7 bài · 10 mục"); assert.equal(await text('[data-prev="org"]'), "Khoa Quản trị");
    assert.match(await text("#impPreviewSummary"), /khoa-quan-tri · orgMain/); assert.equal(await count("[data-subject-key]"), 3); assert.equal(await count('[data-kind="lesson"]'), 7);
    assert.equal(await text('[data-plan="documents"]'), "12"); assert.equal(await text('[data-plan="chunks"]'), "1 đợt");
    assert.equal(await page.locator("#impConfirmDisabled").isDisabled(), true); assert.match(await text("#impConfirmHint"), /Chức năng nhập dữ liệu chưa được bật/);
    await page.click("#impConfirmDisabled", { force: true, timeout: 2000 }).catch(() => {});
    await shot(page, "03-preview");
  });

  await step("INVALID FILES in the real app: blank template, duplicate codes and a >5 MiB file show Vietnamese diagnostics; row inspection works; no preview", async () => {
    await chooseFile("blank.xlsx", globalThis.__blank);
    assert.match(await text("#impVerdict"), /1 lỗi/); assert.equal(await count("#impPreview, #impPlan"), 0);
    await chooseFile("trung.xlsx", workbookBytes({ subjects: [["A1", "Một", 1], ["a1", "Hai", 2]], lessons: [] }));
    assert.match(await text("#impResults"), /trùng với dòng 2 \(sheet MÔN\)/); await page.click('[data-diag-item] [data-imp-action="inspect"]'); assert.equal(await count("[data-diag-rows]"), 1);
    await chooseFile("lon.xlsx", new Uint8Array(5 * 1024 * 1024 + 1).fill(0x50)); assert.match(await text("#impResults"), /vượt giới hạn/);
    await shot(page, "04-errors");
  });

  await step("ORGANIZATION ISOLATION: the same flow for another organization shows only THAT organization (its name/id) - no switcher, and nothing from the first organization leaks", async () => {
    await page.click("#impBack"); await page.waitForSelector("#orgDetailTitle"); await page.click("#orgBackBtn"); await page.waitForSelector("[data-org-open]");
    await page.click('[data-org-open="orgOther"]'); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    await page.click("#orgImportBtn"); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 });
    assert.equal(await text("#impOrgName"), "Trung tâm khác"); assert.equal(await text("#impOrgId"), "orgOther"); assert.equal(await count("#impResults, #impPreview"), 0);
    await chooseFile("example.xlsx", globalThis.__example); assert.equal(await text('[data-prev="org"]'), "Trung tâm khác"); assert.doesNotMatch(await text("#impPreviewSummary"), /orgMain|Khoa Quản trị/);
    assert.equal(await count("#impOrgHost select, #orgSwitch"), 0);
  });

  await step("P3 REGRESSION in the same session: framework list, MỞ -> node editor -> Quay lại, and the Import Center entry all still work", async () => {
    await openOrg("orgMain");
    await page.click('[data-fw-id="fwMain"][data-fw-action="open"]'); await page.waitForSelector("#edBody", { timeout: 30000 }); await page.waitForFunction(() => document.querySelector("#edBody")?.getAttribute("aria-busy") === "false", null, { timeout: 30000 });
    assert.ok((await text("#edBody")).includes("Triết học")); await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    assert.equal(await count('[data-fw-id="fwMain"][data-fw-action="open"]'), 1); await page.click("#orgImportBtn"); await page.waitForSelector("#impOrg"); await page.click("#impBack"); await page.waitForSelector("#orgDetailTitle");
  });

  await step("ACCESS: a teacher account has no Organization screen and therefore no Import Center entry; no teacher request ever touched the engine", async () => {
    const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const tp = await ctxT.newPage(); errorsOf(tp, teacherErrors);
    const treq = []; tp.on("request", (r) => treq.push(r.url()));
    await login(tp, TEACHER);
    assert.equal(await count('[data-nav="organizations"]', tp), 0); assert.equal(await count("#orgImportBtn", tp), 0);
    assert.ok(!treq.some((u) => /import-center-engine|import-xlsx|vendor\/sheetjs/.test(u)), "the engine is never fetched for a teacher");
    await ctxT.close();
  });

  await step("NO WRITES: Firestore is unchanged by the whole flow - no importBatches/framework/node/organization/audit/user change; the file was never uploaded; no unexpected non-GET request left the browser", async () => {
    const after = await snapshot();
    assert.equal(after, before, "emulator state identical before and after the import flows");
    assert.ok(!JSON.parse(after).collections.includes("importBatches"));
    const writes = requests.filter((r) => r.method !== "GET" && !/identitytoolkit|securetoken|:lookup|:signIn|127\.0\.0\.1:(8080|9099)/.test(r.url));
    assert.deepEqual(writes, [], "no unexpected non-GET request");
    assert.ok(!requests.some((r) => /firebasestorage|storage\.googleapis/.test(r.url)), "nothing sent to Storage");
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e) && !/PERMISSION_DENIED|permission|Missing or insufficient/i.test(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /import|curriculum/i.test(e)), "no error mentions the import or curriculum modules");
  });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S3_SHOTS || here, "failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", adminErrors.slice(-5), teacherErrors.slice(-3));
} finally {
  await browser.close().catch(() => {}); server.close(); stopEmu();
  process.exit(exitCode);
}
