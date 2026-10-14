// LIBRARY V2 P4-S5-B - Import Center UI in a REAL browser (headless Edge/Chromium): the real view, the real engine (reader + Worker + validator + plan + run helpers + AUDIT module) with a scriptable fake
// commit controller and an in-memory auditLogs store (harness.html). Covers the advisory DUPLICATE-FILE warning (found / pending / unavailable / throwing / stale / resume) and the AUDIT events
// (completed / rolledBack / partial, idempotency, failure after a successful import, retry, no audit for non-confirmed outcomes), 375 px layout, no network writes.
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p4-s5/ui.e2e.mjs   (optional P4S5_SHOTS=<dir>)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { workbookBytes } from "../library-v2-p4-s2/helpers.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const pw = await import(path.isAbsolute(pkg) ? pathToFileURL(pkg).href : pkg);
const chromium = pw.chromium || pw.default.chromium;
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };
const requests = [];
const server = createServer((req, res) => { try { const p = path.resolve(REPO, "." + decodeURIComponent(req.url.split("?")[0])); if (!p.startsWith(REPO) || !existsSync(p)) { res.writeHead(404); return res.end("nf"); } res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p)); } catch { res.writeHead(500); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
await page.goto(`${base}/test/library-v2-p4-s5/harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P4S5_SHOTS) await page.screenshot({ path: path.join(process.env.P4S5_SHOTS, name + ".png"), fullPage: true }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => ev((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const count = (sel) => page.locator(sel).count();
const ORG = (extra = {}) => ({ id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active", ...extra });
const mount = async (opts = {}) => { await ev(async (o) => { const h = window.__h; if (!o.keep) h.reset(); if (o.org) h.org(o.org); for (const m of o.members || []) h.member(m); for (const c of o.caps || []) h.capability(c); if (o.incomplete) h.incomplete = o.incomplete; if (o.busyLock) h.locks.busy = true; if (o.setup) await (new Function("h", "return (async () => {" + o.setup + "})()"))(h); await h.mount(o); }, { keep: false, ...opts, org: opts.org === undefined ? ORG() : opts.org }); };
const file = (name, bytes) => ({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
const choose = async (f) => { await page.setInputFiles("#impFile", f); await page.waitForFunction(() => !document.querySelector("#impReading") && (document.querySelector("#impResults") || document.querySelector("#impFailed")), null, { timeout: 60000 }); };
const D = (n) => Array.from({ length: n }, (_, i) => i);
const calls = () => ev(() => window.__h.calls.map((c) => ({ ...c, planRef: undefined })));
const commitCalls = async () => (await calls()).filter((c) => c.op === "commit");
const OK = workbookBytes({});                                                                // 2 subjects + 3 lessons = 5 nodes
const OTHER = workbookBytes({ subjects: [["Z1", "Môn Z", 1]], lessons: [] });
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const phase = () => ev(() => document.querySelector("#impRunPhase")?.dataset.phase || "");
const valid = async (opts = {}) => { await mount(opts); await page.waitForSelector("#impPick:not([disabled])", { timeout: 30000 }); await choose(file("mau.xlsx", OK)); await page.waitForSelector("#impConfirm", { timeout: 30000 }); };
const ack = async () => { await page.check("#impConfirmAck"); };
const waitRun = (sel) => page.waitForSelector(sel, { timeout: 20000 });


try {
  const FOUND = `async () => ({ ok: true, found: true, count: 2, more: false, items: [{ id: "Old00000000000000001", finishedAt: new Date("2026-10-10T03:00:00"), nodes: 5, importer: "uid-admin" }, { id: "Old00000000000000002", finishedAt: new Date("2026-10-01T09:30:00"), nodes: 5, importer: "uid-admin" }] })`;
  const entries = () => ev(() => [...window.__h.audit.store.entries()]);
  const auditState = () => ev(() => document.querySelector('[data-run="audit"]')?.dataset.auditState || "");
  const waitAudit = (state) => page.waitForSelector(`[data-run="audit"][data-audit-state="${state}"]`, { timeout: 20000 });
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const runCommit = async () => { await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='result'], #impRun [data-run='stop']"); };

  await step("DUPLICATE FOUND (advisory): a previously COMPLETED import of the same file is announced in Vietnamese with date and size before confirmation; it never blocks - the same acknowledgement still gates, and the import then proceeds as a NEW batch", async () => {
    await valid({ setup: `h.script.dup = ${FOUND};` });
    await page.waitForSelector('#impDup[data-dup="found"]');
    const t = await text("#impDup"); assert.match(t, /Tệp này đã được nhập thành công trước đó/); assert.match(t, /cùng mã SHA-256/); assert.match(t, /10\/10\/2026/); assert.match(t, /01\/10\/2026/); assert.match(t, /5 mục/); assert.match(t, /khung nháp MỚI/);
    assert.equal(await count("#impConfirmBtn[disabled]"), 1, "the main acknowledgement still gates"); await shot("s5b-01-duplicate-found");
    const dupCalls = (await calls()).filter((c) => c.op === "dup"); assert.equal(dupCalls.length, 1); assert.equal(dupCalls[0].orgId, "orgA"); assert.match(dupCalls[0].sha, /^[0-9a-f]{64}$/);
    await ack(); assert.equal(await count("#impConfirmBtn[disabled]"), 0, "advisory: no extra gate"); await page.click("#impConfirmBtn"); await waitRun("[data-run='result']");
    assert.equal((await commitCalls()).length, 1);
  });
  await step("DUPLICATE CHECK PENDING: while the lookup is running the confirm button stays disabled with an explanation (an acknowledged checkbox cannot bypass it); the clean result then says so and enables confirmation", async () => {
    await valid({ setup: `h.gate("dup");` });
    await page.waitForSelector('#impDup[data-dup="checking"]'); assert.match(await text("#impDup"), /Đang kiểm tra lịch sử nhập tệp/);
    await ack(); assert.equal(await count("#impConfirmBtn[disabled]"), 1); assert.match(await text("#impConfirmHint"), /Đang kiểm tra lịch sử nhập tệp/);
    await page.click("#impConfirmBtn", { force: true }).catch(() => {}); assert.equal((await commitCalls()).length, 0);
    await ev(() => window.__h.open("dup"));
    await page.waitForSelector('#impDup[data-dup="none"]'); assert.match(await text("#impDup"), /Đã kiểm tra: chưa có lần nhập hoàn tất nào của tệp này trong đơn vị/);
    assert.equal(await count("#impConfirmBtn[disabled]"), 0);
  });
  await step("DUPLICATE CHECK UNAVAILABLE: \"Không thể kiểm tra lịch sử nhập tệp\" - never shown as 'no duplicate'; confirmation needs a SECOND explicit acknowledgement; KIỂM TRA LẠI re-runs the lookup and resets that acknowledgement", async () => {
    await valid({ setup: `h.script.dup = async ({ n }) => (n === 1 ? { ok: false, kind: "transient" } : (${FOUND})());` });
    await page.waitForSelector('#impDup[data-dup="unavailable"]');
    const t = await text("#impDup"); assert.match(t, /Không thể kiểm tra lịch sử nhập tệp/); assert.match(t, /KHÔNG có nghĩa là “chưa nhập”/); assert.doesNotMatch(t, /chưa có lần nhập hoàn tất nào/); await shot("s5b-02-duplicate-unavailable");
    await ack(); assert.equal(await count("#impConfirmBtn[disabled]"), 1, "main acknowledgement alone is not enough"); assert.match(await text("#impConfirmHint"), /KIỂM TRA LẠI/);
    await page.click("#impConfirmBtn", { force: true }).catch(() => {}); assert.equal((await commitCalls()).length, 0);
    await page.check("#impDupAck"); assert.equal(await count("#impConfirmBtn[disabled]"), 0, "acknowledged: the user may continue");
    await page.click("#impDupRetry"); await page.waitForSelector('#impDup[data-dup="found"]');
    assert.equal(await count("#impDupAck"), 0); assert.equal(await count("#impConfirmBtn[disabled]"), 0, "the main acknowledgement is kept; the lookup now answered");
    assert.equal((await calls()).filter((c) => c.op === "dup").length, 2);
  });
  await step("DUPLICATE LOOKUP that THROWS is the same as unavailable (never 'none'); continuing after the second acknowledgement imports normally", async () => {
    await valid({ setup: `h.script.dup = async () => { throw new Error("boom"); };` });
    await page.waitForSelector('#impDup[data-dup="unavailable"]'); await ack(); await page.check("#impDupAck"); await page.click("#impConfirmBtn"); await waitRun("[data-run='result']"); assert.equal((await commitCalls()).length, 1);
  });
  await step("RESUME does not look up duplicates (the same file is expected); a stale lookup of a PREVIOUS file never overwrites the result of the file chosen later", async () => {
    const batch = await ev((b) => window.__h.batchFor(b, { batchId: "Resume00000000000001" }), b64(OK));
    await mount({ incomplete: [batch] }); await page.waitForSelector("#impRecovery"); await page.click("[data-imp-action='resume-pick']"); await choose(file("mau.xlsx", OK)); await page.waitForSelector("#impConfirm");
    assert.equal((await calls()).filter((c) => c.op === "dup").length, 0, "no lookup when resuming"); assert.equal(await count("#impDup"), 0);
    await mount({ setup: `h.script.dup = async ({ n }) => { if (n === 1) { await h.gate("first"); return (${FOUND})(); } return { ok: true, found: false, count: 0, more: false, items: [] }; };` });
    await page.waitForSelector("#impPick:not([disabled])"); await choose(file("mau.xlsx", OK)); await page.waitForSelector('#impDup[data-dup="checking"]');
    await choose(file("khac.xlsx", OTHER)); await page.waitForSelector('#impDup[data-dup="none"]');
    await ev(() => window.__h.open("first")); await page.waitForTimeout(400);
    assert.equal(await ev(() => document.querySelector("#impDup")?.dataset.dup), "none", "the stale answer was ignored");
  });

  await step("AUDIT completed: after a confirmed completed import exactly one `curriculum.import.completed` entry is written with the deterministic id, actor, organization, batch, framework and importer; the page tells the user it was recorded; the success text never depends on it", async () => {
    await valid(); await runCommit(); await waitAudit("recorded");
    assert.match(await text("#impRunTitle"), /Đã nhập xong và kiểm tra đầy đủ/); assert.match(await text('[data-run="audit"]'), /Đã ghi nhật ký hoạt động/);
    const e = await entries(); assert.equal(e.length, 1); const [id, doc] = e[0];
    assert.equal(id, "import_FakeBatch0000000001_completed"); assert.equal(doc.action, "curriculum.import.completed"); assert.equal(doc.entityType, "importBatch"); assert.equal(doc.entityId, "FakeBatch0000000001"); assert.equal(doc.actorId, "uid-admin"); assert.equal(doc.createdAt, "SERVER_TIMESTAMP");
    assert.deepEqual({ o: doc.detail.organizationId, b: doc.detail.batchId, f: doc.detail.frameworkId, i: doc.detail.importerId, r: doc.detail.resumed }, { o: "orgA", b: "FakeBatch0000000001", f: "FakeBatch0000000001", i: "uid-admin", r: false });
    assert.equal(await ev(() => window.__h.audit.sets), 1); await shot("s5b-03-audit-recorded");
  });
  await step("AUDIT FAILURE after a SUCCESSFUL import (account cannot confirm): the success stays, a clear warning says the audit entry is unconfirmed and the data is unaffected; nothing is rolled back; GHI LẠI NHẬT KÝ retries with the SAME id and ends with exactly one entry", async () => {
    await valid({ setup: `h.audit.failWrite = () => Object.assign(new Error("denied"), { code: "permission-denied" }); h.audit.readable = false;` }); await runCommit(); await waitAudit("unverified");
    assert.match(await text("#impRunTitle"), /Đã nhập xong và kiểm tra đầy đủ/); assert.match(await text('[data-run="audit"]'), /nhưng chưa xác nhận được việc ghi nhật ký hoạt động\. Dữ liệu không bị ảnh hưởng/);
    assert.equal(await count("#impAuditRetry"), 1); assert.equal((await entries()).length, 0); assert.equal((await commitCalls()).length, 1); await shot("s5b-04-audit-warning");
    await ev(() => { window.__h.audit.failWrite = null; window.__h.audit.readable = true; });
    await page.click("#impAuditRetry"); await waitAudit("recorded");
    assert.equal((await entries()).length, 1); assert.equal(await count("#impAuditRetry"), 0); assert.equal((await commitCalls()).length, 1, "retrying the audit never re-runs the import");
  });
  await step("AUDIT FAILED (readable account, write refused): the warning says the entry was NOT written and the import stays valid and is not rolled back", async () => {
    await valid({ setup: `h.audit.failWrite = () => Object.assign(new Error("denied"), { code: "permission-denied" });` }); await runCommit(); await waitAudit("failed");
    assert.match(await text('[data-run="audit"]'), /chưa ghi được nhật ký hoạt động\. Dữ liệu nhập vẫn hợp lệ và không bị hoàn tác/); assert.equal(await count("#impAuditRetry"), 1); assert.match(await text("#impRunTitle"), /Đã nhập xong/);
  });
  await step("AUDIT idempotency in the page: an entry that already exists (another client) is reported as already recorded, never duplicated", async () => {
    await valid({ setup: `h.audit.store.set("import_FakeBatch0000000001_completed", { actorId: "uid-other", action: "curriculum.import.completed", entityType: "importBatch", entityId: "FakeBatch0000000001", detail: { organizationId: "orgA", batchId: "FakeBatch0000000001" } });` });
    await runCommit(); await waitAudit("already"); assert.match(await text('[data-run="audit"]'), /đã có sẵn/); assert.equal((await entries()).length, 1);
  });
  await step("AUDIT rolledBack: a confirmed rollback records exactly one `curriculum.import.rolledBack` entry; a rollback that STOPS records nothing", async () => {
    const partial = await ev((b) => window.__h.batchFor(b, { batchId: "Partial0000000000001", status: "partial" }), b64(OK));
    await mount({ incomplete: [partial], setup: `h.script.rollback = async () => ({ ok: false, state: "paused", nodesDeleted: 3 });` }); await page.waitForSelector("#impRecovery");
    await page.click("[data-imp-action='rollback-open']"); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitRun("[data-run='stop']");
    assert.equal(await count('[data-run="audit"]'), 0); assert.equal((await entries()).length, 0, "a stopped rollback is not audited");
    await mount({ incomplete: [partial] }); await page.waitForSelector("#impRecovery");
    await page.click("[data-imp-action='rollback-open']"); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitRun("[data-run='result']"); await waitAudit("recorded");
    const e = await entries(); assert.equal(e.length, 1); assert.equal(e[0][0], "import_Partial0000000000001_rolledBack"); assert.equal(e[0][1].action, "curriculum.import.rolledBack"); assert.equal(e[0][1].detail.resultCode, "ROLLED_BACK"); assert.equal(e[0][1].detail.nodesDeleted, 10);
    assert.match(await text("#impRunTitle"), /Đã hoàn tác lần nhập/);
  });
  await step("AUDIT partial: only a verification failure that DURABLY marked the batch partial (confirmed batch present) records `curriculum.import.partial`; paused / denied / unmarked failures and the rollback barrier (ROLLBACK_STARTED) record nothing", async () => {
    const partialResult = `async ({ plan }) => ({ ok: false, state: "verification-failed", phase: "verify", markedPartial: true, verification: { counts: { missing: 0, extra: 1, altered: 0 } }, batch: h.confirmedBatch(plan, "uid-admin", "partial", { resultCode: "VERIFY_FAILED" }) })`;
    await valid({ setup: `h.script.commit = ${partialResult};` }); await runCommit(); await waitAudit("recorded");
    assert.match(await text('#impRun [data-run="stop"]'), /KHÔNG khớp kế hoạch/); const e = await entries(); assert.equal(e.length, 1); assert.equal(e[0][0], "import_FakeBatch0000000001_partial"); assert.equal(e[0][1].action, "curriculum.import.partial"); assert.equal(e[0][1].detail.resultCode, "VERIFY_FAILED"); assert.equal(e[0][1].detail.phase, "verify");
    const silent = {
      "marking not confirmed": `async () => ({ ok: false, state: "verification-failed", phase: "verify", markedPartial: false, verification: { counts: {} } })`,
      "no confirmed batch": `async () => ({ ok: false, state: "verification-failed", phase: "verify", markedPartial: true, verification: { counts: {} } })`,
      "paused": `async () => ({ ok: false, state: "paused", nodesWritten: 2 })`,
      "denied": `async () => ({ ok: false, state: "denied" })`,
      "barrier state": `async ({ plan }) => ({ ok: false, state: "verification-failed", phase: "verify", markedPartial: true, verification: { counts: {} }, batch: h.confirmedBatch(plan, "uid-admin", "partial", { resultCode: "ROLLBACK_STARTED" }) })`
    };
    for (const [label, script] of Object.entries(silent)) { await valid({ setup: `h.script.commit = ${script};` }); await runCommit(); assert.equal(await count('[data-run="audit"]'), 0, label); assert.equal((await entries()).length, 0, label); }
  });
  await step("WITHOUT audit tools (S4 behaviour): the import completes, no audit line is shown and no audit write is attempted", async () => {
    await valid({ auditOn: false }); await runCommit(); assert.equal(await count('[data-run="audit"]'), 0); assert.equal(await ev(() => window.__h.audit.sets), 0);
  });
  await step("NARROW LAYOUT (375 px): the duplicate card, the unavailable card and the audit warning do not scroll horizontally; controls stay >= 44 px", async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await valid({ setup: `h.script.dup = ${FOUND};` }); await page.waitForSelector('#impDup[data-dup="found"]'); assert.equal(await noOverflow(), true); await shot("s5b-05-narrow-duplicate");
    await valid({ setup: `h.script.dup = async () => ({ ok: false, kind: "transient" });` }); await page.waitForSelector('#impDup[data-dup="unavailable"]'); assert.equal(await noOverflow(), true);
    const h = await ev(() => document.querySelector("#impDupRetry").getBoundingClientRect().height); assert.ok(h >= 40, "retry target height " + h);
    await valid({ setup: `h.audit.failWrite = () => Object.assign(new Error("denied"), { code: "permission-denied" }); h.audit.readable = false;` }); await runCommit(); await waitAudit("unverified"); assert.equal(await noOverflow(), true); await shot("s5b-06-narrow-audit-warning");
    await page.setViewportSize({ width: 1100, height: 900 });
  });
  await step("SAFETY: no network request other than GET static files was made by the harness (the page never writes anywhere except through the injected fakes)", async () => {
    const bad = requests.filter((r) => r.method !== "GET" && !r.url.startsWith(base)); assert.deepEqual(bad, []); assert.ok(!requests.some((r) => /firestore|googleapis|firebase/i.test(r.url)));
  });
  await step("final: no unexpected page or console error", async () => { assert.deepEqual(errors, [], "no page errors: " + errors.join(" | ")); });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  process.exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S5_SHOTS || tmpdir(), "p4s5-ui-failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", errors.slice(-5));
} finally {
  await browser.close().catch(() => {}); server.close();
}

