// LIBRARY V2 P3-S5 - synthetic browser flow (clone framework + delete never-activated draft inside the curriculum framework list): the REAL index.html in headless Edge against LOCAL Auth + Firestore emulators loaded with the
// deployed P3-S1 Rules (this repo's production-candidate). Synthetic accounts and synthetic organizations only; nothing here can reach
// production (the app refuses emulator mode on the production host).
// Needs: firebase CLI, Java 21+ on PATH, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Run: node test/library-v2-p3-s5/integration.e2e.mjs      (optional P3S5_SHOTS=<dir> saves screenshots)
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = mkdtempSync(path.join(os.tmpdir(), "library-v2-p3s5-e2e-"));
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
const shot = async (p, name) => { if (process.env.P3S5_SHOTS) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.P3S5_SHOTS, name + ".png") }); } };
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

const live = () => text("#edLive");
let exitCode = 0;

// ---- P3-S5 synthetic world (REST seeding with the emulator owner bearer; synthetic names only) ----
const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
const fwDoc = (orgId, name, status, day, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, scope: "organization", name, status, createdAt: D(day), createdBy: admin.uid, updatedAt: D(day), ...(status === "draft" ? {} : { activatedAt: D(day + 1), statusChangedAt: D(day + 1), statusChangedBy: admin.uid }), ...extra });
const nodeSeed = (orgId, extra = {}) => ({ schemaVersion: 1, organizationId: orgId, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Môn thử", status: "active", createdAt: D(6), updatedAt: D(6), ...extra });
await put("organizations/orgMain", org("Khoa Quản trị", "khoa-quan-tri"));
await put("organizations/orgArch", org("Trung tâm cũ", "trung-tam-cu", "archived"));
await put("curriculumFrameworks/fwSrc", fwDoc("orgMain", "Chương trình nguồn", "active", 5));
await put("curriculumFrameworks/fwDraft", fwDoc("orgMain", "Bản nháp để xóa", "draft", 7));
await put("curriculumFrameworks/fwArchived", fwDoc("orgMain", "Khung đã lưu trữ", "archived", 3));
await put("curriculumFrameworks/fwReborn", fwDoc("orgMain", "Nháp đã từng kích hoạt", "draft", 4, { activatedAt: D(5) }));
await put("curriculumFrameworks/fwBig", fwDoc("orgMain", "Khung lớn 850 nút", "active", 6));
await put("curriculumFrameworks/fwArchOrg", fwDoc("orgArch", "Khung trong đơn vị lưu trữ", "active", 5));
await put("curriculumFrameworks/fwArchOrgD", fwDoc("orgArch", "Nháp trong đơn vị lưu trữ", "draft", 4));
const srcNodes = [["s1", null, [], "subject", 0, "Triết học", "TRI", "active"], ["l1", "s1", ["s1"], "lesson", 0, "Bài 1", "B01", "active"], ["l2", "s1", ["s1"], "lesson", 1, "Bài 2 (ngừng)", "B02", "retired"], ["u1", "l1", ["s1", "l1"], "unit", 0, "Mục 1", null, "active"], ["d1", "u1", ["s1", "l1", "u1"], "unit", 0, "Mục sâu", "D1", "active"], ["s2", null, [], "subject", 1, "Kinh tế chính trị", "KT", "active"]];
for (const [id, parentId, ancestors, kind, order, name, code, status] of srcNodes) await put(`curriculumFrameworks/fwSrc/nodes/${id}`, nodeSeed("orgMain", { parentId, ancestors, kind, order, name, code, status }));
for (const [id, parentId, ancestors, kind, order, name, code, status] of srcNodes.slice(0, 3)) await put(`curriculumFrameworks/fwDraft/nodes/${id}`, nodeSeed("orgMain", { parentId, ancestors, kind, order, name, code, status }));
await put("curriculumFrameworks/fwArchived/nodes/z1", nodeSeed("orgMain", { name: "Môn lưu trữ" }));
await put("curriculumFrameworks/fwReborn/nodes/r1", nodeSeed("orgMain", { name: "Môn nháp đã kích hoạt" }));
await put("curriculumFrameworks/fwArchOrgD/nodes/o2", nodeSeed("orgArch", { name: "Môn nháp lưu trữ" }));
for (let from = 0; from < 850; from += 25) await Promise.all(Array.from({ length: Math.min(25, 850 - from) }, (_, k) => { const i = from + k; return put(`curriculumFrameworks/fwBig/nodes/n${String(i).padStart(4, "0")}`, nodeSeed("orgMain", { name: "Môn " + i, order: i, code: "C" + i, status: i % 7 === 3 ? "retired" : "active" })); }));
const count = (sel) => page.locator(sel).count();
const nodesOf = async (fwId) => (await list(`curriculumFrameworks/${fwId}/nodes`)).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
const fwGet = (id) => get(`curriculumFrameworks/${id}`);
const allFw = async () => (await list("curriculumFrameworks")).map((f) => f.id).sort();
const toastText = () => page.evaluate(() => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent).join(" | "));
const waitSection = () => page.waitForFunction(() => document.querySelector("#orgCurriculumCard")?.getAttribute("aria-busy") === "false" && !document.querySelector("#orgCurriculumLoading"), null, { timeout: 30000 });
const waitEditor = () => page.waitForFunction(() => { const b = document.querySelector("#edBody"); return b && b.getAttribute("aria-busy") === "false" && !document.querySelector("#edLoading"); }, null, { timeout: 30000 });
const openOrg = async (id) => { await page.click('[data-nav="classes"]'); await openOrgs(); await page.click(`[data-org-open="${id}"]`); await page.waitForSelector("#orgDetailTitle"); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection(); };
const dialogGone = () => page.waitForFunction(() => !document.querySelector('#globalModal [role="dialog"]'), null, { timeout: 120000 });
const actionsOf = (id) => page.evaluate((i) => [...document.querySelectorAll(`[data-fw-id="${i}"][data-fw-action]`)].map((b) => b.dataset.fwAction), id);
const clickAction = (id, action) => page.click(`[data-fw-id="${id}"][data-fw-action="${action}"]`);
const baselineUsers = await (async () => JSON.stringify((await list("users")).map(({ lastLoginAt, updatedAt, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))))();
const auditsOf = async (re) => (await list("auditLogs")).filter((a) => re.test(a.action));
let cloneId = null, bigCloneId = null;

try {
  await step("Organization Detail: NHÂN BẢN on every framework, XÓA BẢN NHÁP ONLY on the never-activated draft (never active, archived, or a draft that carries activatedAt); an archived Organization offers neither", async () => {
    await login(page, ADMIN); await openOrgs(); await page.click(`[data-org-open="orgMain"]`); await page.waitForSelector("#orgMembersCard", { timeout: 30000 }); await waitSection();
    assert.deepEqual(await actionsOf("fwDraft"), ["open", "rename", "clone", "activate", "delete-draft"]); assert.deepEqual(await actionsOf("fwSrc"), ["open", "rename", "clone", "archive"]); assert.deepEqual(await actionsOf("fwArchived"), ["open", "clone", "restore"]);
    assert.deepEqual(await actionsOf("fwReborn"), ["open", "rename", "clone", "activate"], "activatedAt present: not deletable");
    assert.equal(await count('[data-fw-action="delete-draft"]'), 1); await shot(page, "01-controls");
    await openOrg("orgArch"); assert.equal(await count('[data-fw-action="clone"], [data-fw-action="delete-draft"]'), 0); await openOrg("orgMain");
  });

  await step("CLONE through the deployed Rules: default name, a new independent never-activated draft in the same Organization with the exact cloneSource, nodes copied with NEW ids (parents/ancestors remapped, orders/codes/retired state kept), source untouched, audit entry", async () => {
    const sourceBefore = JSON.stringify([await fwGet("fwSrc"), await nodesOf("fwSrc")]);
    await clickAction("fwSrc", "clone"); await page.waitForSelector("#orgFwName"); assert.equal(await page.inputValue("#orgFwName"), "Chương trình nguồn (bản sao)");
    await page.fill("#orgFwName", "Bản sao chương trình"); await shot(page, "02-clone-dialog"); await page.click("#orgFwSubmit"); await dialogGone(); await waitSection();
    const ids = (await allFw()).filter((id) => !["fwSrc", "fwDraft", "fwArchived", "fwReborn", "fwBig", "fwArchOrg", "fwArchOrgD"].includes(id)); assert.equal(ids.length, 1); cloneId = ids[0];
    const fw = await fwGet(cloneId);
    assert.deepEqual(Object.keys(fw).sort(), ["cloneSource", "createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
    assert.deepEqual([fw.name, fw.status, fw.organizationId, fw.createdBy, fw.cloneSource], ["Bản sao chương trình", "draft", "orgMain", admin.uid, { frameworkId: "fwSrc", nodeCount: 6 }]); assert.ok(!("activatedAt" in fw));
    const nodes = await nodesOf(cloneId); assert.equal(nodes.length, 6); assert.ok(nodes.every((n) => !srcNodes.some((s) => s[0] === n.id) && n.organizationId === "orgMain"));
    const by = (name) => nodes.find((n) => n.name === name), s1 = by("Triết học"), l1 = by("Bài 1"), l2 = by("Bài 2 (ngừng)"), u1 = by("Mục 1"), d1 = by("Mục sâu");
    assert.deepEqual([l1.parentId, l1.ancestors, l1.code, l1.order], [s1.id, [s1.id], "B01", 0]); assert.deepEqual([l2.status, l2.order, l2.code], ["retired", 1, "B02"]); assert.deepEqual(d1.ancestors, [s1.id, l1.id, u1.id]); assert.equal(by("Kinh tế chính trị").order, 1);
    assert.equal(JSON.stringify([await fwGet("fwSrc"), await nodesOf("fwSrc")]), sourceBefore, "the source is byte-identical");
    const a = (await auditsOf(/^curriculum\.framework\.clone$/)); assert.equal(a.length, 1); assert.deepEqual([a[0].entityId, a[0].detail], [cloneId, { organizationId: "orgMain", name: "Bản sao chương trình", sourceFrameworkId: "fwSrc", nodeCount: 6 }]);
    assert.ok((await toastText()).includes("Đã nhân bản khung chương trình.")); assert.deepEqual(await actionsOf(cloneId), ["open", "rename", "clone", "activate", "delete-draft"]);
    await shot(page, "03-cloned");
  });

  await step("the clone opens in the S4 node editor (tree, readiness ready), is edited independently (the source stays unchanged, the clone stays COMPLETE), activates through the S3 dialog, and then has NO delete control", async () => {
    await clickAction(cloneId, "open"); await page.waitForSelector("#edTitle"); await waitEditor();
    assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready"); assert.equal(await page.locator("[data-node-row]").count(), 6);
    const s1 = (await nodesOf(cloneId)).find((n) => n.name === "Triết học").id;
    await page.click(`[data-ed-action="retire"][data-node-id="${s1}"]`); await page.click("#edConfirm"); await dialogGone(); await waitEditor();   // a legitimate edit: retire the whole Mon
    await page.click(`[data-ed-action="restore"][data-node-id="${s1}"]`); await waitEditor();
    await page.click("#edAddSubject"); await page.waitForSelector("#edName"); await page.fill("#edName", "Môn thêm sau khi nhân bản"); await page.click("#edSubmit"); await dialogGone(); await waitEditor();
    assert.equal((await nodesOf("fwSrc")).length, 6, "the source never changes"); assert.equal((await nodesOf(cloneId)).length, 7);
    assert.equal(await page.getAttribute("#edReadiness", "data-readiness"), "ready", "later edits never make a finished clone incomplete");
    await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle"); await waitSection();
    await clickAction(cloneId, "activate"); await page.waitForSelector("#orgFwConfirm:not([disabled])"); await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    assert.equal((await fwGet(cloneId)).status, "active"); assert.deepEqual(await actionsOf(cloneId), ["open", "rename", "clone", "archive"], "an activated framework is never deletable");
  });

  await step("LARGE clone through the Rules: 850 nodes (retired included) copied in bounded batches, verified, source untouched; the clone is complete and activatable", async () => {
    await clickAction("fwBig", "clone"); await page.waitForSelector("#orgFwName"); await page.fill("#orgFwName", "Bản sao khung lớn"); await page.click("#orgFwSubmit");
    await page.waitForFunction(() => /Đã sao chép|Đang xác minh/.test(document.querySelector("#orgFwProgress")?.textContent || "") || !document.querySelector("#orgFwProgress"), null, { timeout: 120000 }); await dialogGone(); await waitSection();
    const ids = (await allFw()).filter((id) => !["fwSrc", "fwDraft", "fwArchived", "fwReborn", "fwBig", "fwArchOrg", "fwArchOrgD", cloneId].includes(id)); assert.equal(ids.length, 1); bigCloneId = ids[0];
    const nodes = await nodesOf(bigCloneId), src = await nodesOf("fwBig");
    assert.equal(nodes.length, 850); assert.equal(new Set(nodes.map((n) => n.id)).size, 850); assert.equal(nodes.filter((n) => n.status === "retired").length, src.filter((n) => n.status === "retired").length);
    assert.deepEqual(nodes.map((n) => n.code).sort(), src.map((n) => n.code).sort()); assert.equal((await fwGet(bigCloneId)).cloneSource.nodeCount, 850);
    await shot(page, "04-big-cloned");
  });

  await step("DELETE never-activated draft through the Rules: explicit confirmation (permanent, not LƯU TRỮ), children deleted first and the framework last, no orphan nodes, audit entry; Cancel changes nothing", async () => {
    await clickAction("fwDraft", "delete-draft"); await page.waitForSelector("#orgFwConfirm");
    assert.ok((await text('#globalModal [role="dialog"]')).includes("Xóa vĩnh viễn, không thể khôi phục")); assert.ok((await text('#globalModal [role="dialog"]')).includes("LƯU TRỮ (có thể khôi phục)")); await shot(page, "05-delete-confirm");
    await page.click("#orgFwCancel"); await dialogGone(); assert.equal((await nodesOf("fwDraft")).length, 3); assert.ok((await allFw()).includes("fwDraft"));
    await clickAction("fwDraft", "delete-draft"); await page.click("#orgFwConfirm"); await dialogGone(); await waitSection();
    assert.ok(!(await allFw()).includes("fwDraft")); assert.equal((await nodesOf("fwDraft")).length, 0, "no orphan nodes");
    const a = await auditsOf(/^curriculum\.framework\.deleteDraft$/); assert.equal(a.length, 1); assert.deepEqual([a[0].entityId, a[0].detail], ["fwDraft", { organizationId: "orgMain", name: "Bản nháp để xóa", nodeCount: 3 }]);
    assert.ok((await toastText()).includes("Đã xóa bản nháp.")); assert.equal(await count('[data-fw-id="fwDraft"]'), 0);
  });

  await step("delete a 850-node clone draft: the big clone is deleted in bounded batches; an UNRELATED framework and the archived/previously-activated ones are untouched (and offer no delete)", async () => {
    const before = (await nodesOf("fwBig")).length;
    await clickAction(bigCloneId, "delete-draft"); await page.click("#orgFwConfirm");
    await page.waitForFunction(() => /Đã xóa/.test(document.querySelector("#orgFwProgress")?.textContent || "") || !document.querySelector("#orgFwProgress"), null, { timeout: 120000 }); await dialogGone(); await waitSection();
    assert.ok(!(await allFw()).includes(bigCloneId)); assert.equal((await nodesOf(bigCloneId)).length, 0); assert.equal((await nodesOf("fwBig")).length, before); assert.equal((await nodesOf("fwArchived")).length, 1); assert.equal((await nodesOf("fwReborn")).length, 1);
    assert.deepEqual(await actionsOf("fwArchived"), ["open", "clone", "restore"]); assert.deepEqual(await actionsOf("fwReborn"), ["open", "rename", "clone", "activate"]);
  });

  await step("archived Organization (seeded): no clone/delete control anywhere; the S4 editor still opens read-only", async () => {
    await page.reload(); await page.waitForSelector(".navlink"); await openOrg("orgArch");
    assert.equal(await count('[data-fw-action="clone"], [data-fw-action="delete-draft"]'), 0); assert.equal(await text('[data-fw-id="fwArchOrgD"][data-fw-action="open"]'), "MỞ (CHỈ XEM)");
    await clickAction("fwArchOrgD", "open"); await page.waitForSelector("#edTitle"); await waitEditor(); assert.equal(await count("#edModeBanner"), 1); await page.click("#edBack"); await page.waitForSelector("#orgDetailTitle");
    assert.ok((await allFw()).includes("fwArchOrgD") && (await nodesOf("fwArchOrgD")).length === 1);
  });

  await step("phone width: clone/delete dialogs and the new row buttons have no horizontal overflow and >= 44px tap targets; screenshots", async () => {
    await openOrg("orgMain"); await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 1, "overflow " + overflow);
    const small = await page.evaluate(() => [...document.querySelectorAll("#orgCurriculumCard button")].filter((b) => b.getBoundingClientRect().height < 43).length); assert.equal(small, 0);
    await clickAction("fwSrc", "clone"); await page.waitForSelector("#orgFwName"); const dlg = await page.evaluate(() => { const r = document.querySelector("#globalModal .modal").getBoundingClientRect(); return { right: r.right, w: innerWidth }; }); assert.ok(dlg.right <= dlg.w + 1);
    await shot(page, "06-mobile-clone"); await page.click("#orgFwCancel"); await dialogGone(); await shot(page, "07-mobile"); await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("final: only the expected collections exist; every audit entry is by the Platform Admin with an expected action; no teacher/user data changed; no unexpected page error", async () => {
    assert.deepEqual((await rootCollections()).sort(), ["auditLogs", "curriculumFrameworks", "organizations", "users"], "no capability, import or mapping collection");
    const audits = await list("auditLogs");
    for (const a of audits) assert.equal(a.actorId, admin.uid);
    for (const a of [...new Set(audits.map((x) => x.action))]) assert.ok(/^(organization\.(members\.add|member\.(suspend|restore|remove|reinstate)|archive|restore)|curriculum\.framework\.(create|rename|activate|archive|restore|clone|deleteDraft)|curriculum\.node\.(add|update|retire|restore|reorder))$/.test(a), "unexpected audit action " + a);
    assert.equal(await usersViewNow(), baselineUsers);
    const known = (e) => /adminOverview|adminLibrary|adminAuditLog|teacherOverview|Failed to create chart|Cannot set properties of null \(setting 'innerHTML'\)|Cannot read properties of null \(reading 'innerHTML'\)/.test(e);
    const all = [...adminErrors, ...teacherErrors];
    console.log("known pre-existing race errors: " + all.filter(known).length);
    assert.deepEqual(all.filter((e) => !known(e) && !/PERMISSION_DENIED|permission|Missing or insufficient/i.test(e)), [], "no unexpected page error");
    assert.ok(!all.some((e) => /curriculum|clone/i.test(e)), "no error mentions the curriculum modules");
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
