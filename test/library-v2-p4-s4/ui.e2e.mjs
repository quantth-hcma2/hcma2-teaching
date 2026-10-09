// LIBRARY V2 P4-S4 - Import Center EXECUTION UI in a REAL browser (headless Edge/Chromium): the real view, the real P4-S2/S3/S4 engine (reader + module Worker + validator + plan + run helpers)
// with a SCRIPTABLE fake commit controller (harness.html) so every state can be provoked deterministically: confirmation gating, progress, success only after completion, pause/resume,
// denial, verification failure, recovery after "refresh", rollback, duplicate-click / second-tab guards, archived organization, authorization re-check, leaving the screen.
// The REAL controller is proven against the production Rules (controller.rules.test.mjs) and in the real app on emulators (integration.e2e.mjs).
// Needs: Playwright (PLAYWRIGHT_PACKAGE or "playwright"). Run: node test/library-v2-p4-s4/ui.e2e.mjs   (optional P4S4_SHOTS=<dir>)
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
await page.goto(`${base}/test/library-v2-p4-s4/harness.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const results = []; async function step(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
const shot = async (name) => { if (process.env.P4S4_SHOTS) await page.screenshot({ path: path.join(process.env.P4S4_SHOTS, name + ".png"), fullPage: true }); };
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
  await step("CONFIRM GATING: with a valid plan the confirm card shows the organization and planned counts in Vietnamese; the button is disabled until the explicit acknowledgement; nothing is written before the click", async () => {
    await valid();
    assert.equal(await count("#impConfirmDisabled"), 0, "the S3 disabled placeholder is replaced when execution is available");
    assert.match(await text("#impConfirmSummary"), /Khoa Quản trị[\s\S]*khoa-quan-tri/); assert.match(await text('[data-confirm="counts"]'), /2 môn · 3 bài · 5 mục/); assert.match(await text('[data-confirm="documents"]'), /7 tài liệu \(1 lô nhập \+ 1 khung \+ 5 mục\) trong 1 đợt ghi/);
    assert.equal(await count("#impConfirmBtn[disabled]"), 1); assert.match(await text("#impConfirmHint"), /giữ nguyên trang này/);
    await page.click("#impConfirmBtn", { force: true }).catch(() => {});
    assert.equal((await commitCalls()).length, 0, "a disabled confirm cannot start a commit");
    assert.equal(await ev(() => window.__h.calls.filter((c) => c.op === "findIncomplete").length), 1, "the recovery list was read once on entry");
    assert.equal(await count("#impPlan"), 1); assert.match(await text("#impPlan"), /kế hoạch sẽ được thực hiện khi bạn xác nhận/); assert.doesNotMatch(await text("#impPreview"), /chỉ là bản xem trước\./);
    await ack(); assert.equal(await count("#impConfirmBtn:not([disabled])"), 1);
    await page.uncheck("#impConfirmAck"); assert.equal(await count("#impConfirmBtn[disabled]"), 1);
    await shot("s4-01-confirm");
  });

  await step("COMMIT: the click commits the FROZEN plan for the LOCKED organization with a fresh batch id; progress phases are shown; success appears ONLY after the controller reports completed; the screen then offers the draft for activation", async () => {
    await valid({ setup: 'h.script.commit = async ({ plan, authorize, emit }) => { const a = await authorize(); if (!a.allowed) return { ok:false, state:"denied" }; emit({ phase:"batch", nodesWritten:0 }); emit({ phase:"nodes", nodesWritten:3, chunk:0 }); await h.gate("nodes"); emit({ phase:"nodes", nodesWritten:5, chunk:1 }); emit({ phase:"verify", nodesWritten:5, verified:2 }); await h.gate("verify"); emit({ phase:"complete", nodesWritten:5, verified:5 }); return { ok:true, state:"completed", nodesWritten:5, verification:{ ok:true }, eligibility:{ eligible:true, errors:[] } }; };' });
    await ack(); await page.click("#impConfirmBtn");
    await waitRun("#impRunPhase[data-phase='nodes']");
    assert.match(await text("#impRunPhase"), /Đang ghi môn và bài · 3\/5 mục/); assert.equal(await count("#impRun[aria-busy='true']"), 1); assert.equal(await count("progress#impRunBar"), 1);
    assert.doesNotMatch(await text("#host"), /Đã nhập xong/);
    const [c] = await commitCalls(); assert.equal(c.organizationId, "orgA"); assert.equal(c.planOrganizationId, "orgA"); assert.equal(c.batchId, "FakeBatch0000000001"); assert.equal(c.actorUid, "uid-admin"); assert.equal(c.frozen, true); assert.equal(c.nodes, 5); assert.equal(c.resume, false); assert.equal(c.framework, "Chương trình Toán 6");
    await ev(() => window.__h.open("nodes")); await page.waitForFunction(() => document.querySelector("#impRunPhase")?.dataset.phase === "verify");
    assert.match(await text("#impRunPhase"), /đã đối chiếu 2\/5 mục/); assert.doesNotMatch(await text("#host"), /Đã nhập xong/, "no success while the read-back is still running");
    await ev(() => window.__h.open("verify")); await waitRun("#impRun[role='status'] [data-run='result']");
    assert.match(await text("#impRunTitle"), /Đã nhập xong và kiểm tra đầy đủ/); assert.match(await text('[data-run="result"]'), /Đã đọc lại 5 mục \(2 môn, 3 bài\) từ máy chủ[\s\S]*khớp 100%/); assert.match(await text('[data-run="eligibility"]'), /Chương trình Toán 6[\s\S]*sẵn sàng để kích hoạt[\s\S]*chưa được kích hoạt/);
    assert.equal(await count("#impConfirm"), 0, "the confirm card is gone after a completed import"); assert.equal(await count("#impPreview"), 0); assert.equal(await ev(() => window.__h.locks.held), 1); assert.equal(await ev(() => window.__h.locks.released), 1, "the lock was released");
    await shot("s4-02-success");
    await page.click("#impRunBack"); assert.equal(await ev(() => window.__h.backs), 1);
  });

  await step("RUNNING LOCKS THE SCREEN: file chooser and templates are disabled, Quay lại is refused with an explanation, the browser's leave-page warning is armed, a second click cannot start a second commit; all restored afterwards", async () => {
    await valid({ setup: 'h.script.commit = async ({ plan, emit }) => { emit({ phase:"nodes", nodesWritten:1, chunk:0 }); await h.gate("go"); return { ok:true, state:"completed", nodesWritten:5, verification:{ ok:true }, eligibility:{ eligible:true, errors:[] } }; };' });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRunPhase[data-phase='nodes']");
    assert.equal(await count("#impPick[disabled]"), 1); assert.equal(await count("#impTemplateBlank[disabled]"), 1); assert.equal(await count("#impTemplateExample[disabled]"), 1);
    await page.click("#impBack"); assert.equal(await ev(() => window.__h.backs), 0, "back is refused while running");
    assert.match(await text("#impLive"), /chưa thể rời màn hình này/);
    const guarded = await ev(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }); assert.equal(guarded, true, "the leave-page warning is armed while running");
    await page.setInputFiles("#impFile", file("again.xlsx", OTHER), { force: true }).catch(() => {});
    await page.waitForTimeout(200); assert.equal((await commitCalls()).length, 1, "no second run and no file change during the run"); assert.equal(await count("#impConfirm"), 1, "the confirmed plan stays as it was");
    assert.match(await text("#impFileInfo"), /mau\.xlsx/, "the chosen file did not change");
    await ev(() => window.__h.open("go")); await waitRun("[data-run='result']");
    const released = await ev(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }); assert.equal(released, false, "the leave-page warning is removed after the run");
    await page.click("#impRunBack"); assert.equal(await ev(() => window.__h.backs), 1);
  });

  await step("DUPLICATE EXECUTION: a double click starts ONE commit; another tab holding the organization lock blocks the start with an explanation (nothing is written)", async () => {
    await valid({ setup: 'h.script.commit = async () => { await h.gate("go"); return { ok:true, state:"completed", nodesWritten:5, verification:{ ok:true }, eligibility:{ eligible:true, errors:[] } }; };' });
    await ack(); await page.dblclick("#impConfirmBtn"); await waitRun("#impRun[aria-busy='true']");
    await page.waitForTimeout(150); assert.equal((await commitCalls()).length, 1); assert.equal(await ev(() => window.__h.locks.held), 1);
    await ev(() => window.__h.open("go")); await waitRun("[data-run='result']");
    await valid({ busyLock: true }); await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']");
    assert.match(await text('[data-run="stop"]'), /đang chạy ở thẻ trình duyệt khác/); assert.equal((await commitCalls()).length, 0); assert.equal(await count("#impRunResume, #impRunRollback"), 0);
  });

  await step("PAUSED (network failure): the message keeps the written count, offers TIẾP TỤC (the SAME frozen plan) and HOÀN TÁC NHẬP; resume completes", async () => {
    await valid({ setup: 'h.n = 0; h.script.commit = async ({ plan, emit }) => { h.n++; emit({ phase:"nodes", nodesWritten:3, chunk:0 }); if (h.n === 1) return { ok:false, state:"paused", phase:"nodes", kind:"transient", nodesWritten:3 }; emit({ phase:"verify", nodesWritten:5, verified:5 }); return { ok:true, state:"completed", nodesWritten:5, verification:{ ok:true }, eligibility:{ eligible:true, errors:[] } }; };' });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']");
    assert.match(await text('[data-run="stop"]'), /Kết nối bị gián đoạn[\s\S]*giữ nguyên \(3 mục\)/); assert.equal(await count("#impRunResume"), 1); assert.equal(await count("#impRunRollback"), 1);
    assert.doesNotMatch(await text("#host"), /Đã nhập xong/); await shot("s4-03-paused");
    const firstDigest = (await commitCalls())[0].digest;
    await page.click("#impRunResume"); await waitRun("[data-run='result']");
    const all = await commitCalls(); assert.equal(all.length, 2); assert.equal(all[1].digest, firstDigest, "resume commits the same frozen plan"); assert.equal(all[1].batchId, all[0].batchId);
  });

  await step("VERIFICATION FAILED: no success, no resume, the batch is explained as stopped; only HOÀN TÁC NHẬP; rollback needs an explicit acknowledgement and then reports completion", async () => {
    await valid({ setup: 'h.script.commit = async () => ({ ok:false, state:"verification-failed", phase:"verify", verification:{ counts:{ missing:1, extra:2, altered:0 } }, markedPartial:true }); h.script.rollback = async ({ emit }) => { emit({ phase:"rollback-nodes", nodesDeleted:4 }); emit({ phase:"rollback-framework", nodesDeleted:4 }); return { ok:true, state:"rolled_back", nodesDeleted:4 }; };' });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']");
    assert.match(await text('[data-run="stop"]'), /KHÔNG khớp kế hoạch \(thiếu 1, thừa 2, sai khác 0\)[\s\S]*không thể kích hoạt/); assert.equal(await count("#impRunResume"), 0); assert.equal(await count("#impRunRollback"), 1);
    assert.doesNotMatch(await text("#host"), /Đã nhập xong/);
    await page.click("#impRunRollback"); await page.waitForSelector("#impRollbackConfirm"); assert.equal(await count("#impRbConfirm[disabled]"), 1); assert.match(await text("#impRollbackConfirm"), /bản ghi lần nhập được giữ lại/);
    await page.click("#impRbConfirm", { force: true }).catch(() => {}); assert.equal((await calls()).filter((c) => c.op === "rollback").length, 0, "no rollback without the acknowledgement");
    await shot("s4-04-verification-failed"); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitRun("#impRun [data-run='result']");
    assert.match(await text("#impRunTitle"), /Đã hoàn tác lần nhập/); assert.match(await text('[data-run="result"]'), /Đã xóa 4 mục và khung nháp/);
    const [rb] = (await calls()).filter((c) => c.op === "rollback"); assert.equal(rb.organizationId, "orgA"); assert.equal(rb.batchId, "FakeBatch0000000001");
  });

  await step("DENIED mid-run (authorization re-check): the message explains it, no resume/rollback is offered, no success is shown", async () => {
    await valid({ setup: 'h.script.commit = async () => ({ ok:false, state:"denied", reason:"DENIED", phase:"nodes", nodesWritten:2 });' });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']");
    assert.match(await text('[data-run="stop"]'), /không còn quyền[\s\S]*Không có thêm dữ liệu nào được ghi/); assert.equal(await count("#impRunResume, #impRunRollback"), 0);
    await page.click("[data-imp-action='run-dismiss']"); assert.equal(await count("#impRun"), 0);
  });

  await step("AUTHORIZATION RE-CHECK at confirmation: a capability removed after the preview stops the import BEFORE any controller call; the same applies to an organization archived meanwhile", async () => {
    const M = (uid, extra = {}) => ({ organizationId: "orgA", uid, orgRole: "member", status: "active", ...extra });
    await valid({ isAdmin: false, uid: "u-c", members: [M("u-c")], caps: [{ organizationId: "orgA", uid: "u-c", caps: ["curriculum.manage"], denied: [] }] });
    assert.equal(await count("#impConfirm"), 1);
    await ev(() => { window.__h.caps.clear(); });                                              // the capability is withdrawn while the preview is open
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']");
    assert.match(await text('[data-run="stop"]'), /không còn quyền/); assert.equal((await commitCalls()).length, 0, "the controller was never called");
    await valid(); await ev(() => { window.__h.store.set("orgA", { id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "archived" }); });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRun [data-run='stop']"); assert.equal((await commitCalls()).length, 0);
  });

  await step("RECOVERY after refresh: an interrupted import of THIS organization is offered on entry; TIẾP TỤC asks for the SAME file, accepts only that file (a different file is refused), commits the stored batch id with resume=true", async () => {
    const batch = await ev((b) => window.__h.batchFor(b, { batchId: "Resume00000000000001" }), b64(OK));
    await valid({ incomplete: [batch], setup: 'h.fakeBatchId = "SHOULD-NOT-BE-USED";' });
    assert.equal(await count("#impRecovery"), 1); assert.match(await text("#impRecovery"), /Có lần nhập chưa hoàn tất trong đơn vị này/); assert.equal(await count("#impConfirmBtn[disabled]"), 1, "a new import is blocked while one is incomplete");
    assert.match(await text("#impConfirmHint"), /chưa hoàn tất/); await shot("s4-05-recovery");
    await page.click("[data-imp-action='resume-pick']"); assert.match(await text("#impLive"), /chọn LẠI đúng tệp/); assert.equal(await count("#impConfirm"), 0, "the previous preview was cleared");
    await choose(file("khac.xlsx", OTHER)); await page.waitForSelector("#impResumeMismatch"); assert.match(await text("#impResumeMismatch"), /KHÔNG khớp với lần nhập đang dở/); assert.equal(await count("#impConfirmBtn"), 0);
    await choose(file("mau.xlsx", OK)); await page.waitForSelector("#impConfirm"); assert.match(await text("#impConfirmTitle"), /TIẾP TỤC lần nhập dở/); assert.equal(await count("#impConfirmBtn"), 1);
    await ack(); await page.click("#impConfirmBtn"); await waitRun("[data-run='result']");
    const [c] = await commitCalls(); assert.equal(c.batchId, "Resume00000000000001"); assert.equal(c.resume, true); assert.equal(c.organizationId, "orgA");
    assert.equal(await count("#impRecovery"), 0, "the completed batch is gone from the incomplete list after the refresh of the list");
  });
  await step("RECOVERY is organization-scoped and honest: other organizations' batches are never listed or acted on; a partial batch can only be rolled back; an archived organization disables the actions", async () => {
    const foreign = await ev((b) => window.__h.batchFor(b, { batchId: "Foreign0000000000001", orgId: "orgB" }), b64(OK));
    const partial = await ev((b) => window.__h.batchFor(b, { batchId: "Partial0000000000001", status: "partial" }), b64(OK));
    await mount({ incomplete: [foreign, partial] }); await page.waitForSelector("#impRecovery");
    assert.equal(await count('li[data-batch="Foreign0000000000001"]'), 0); assert.equal(await count('li[data-batch="Partial0000000000001"]'), 1);
    assert.equal(await count("[data-imp-action='resume-pick']"), 0); assert.equal(await count("[data-imp-action='rollback-open']"), 1);
    assert.deepEqual((await calls()).filter((c) => c.op === "findIncomplete").map((c) => c.orgId), ["orgA"]);
    await page.click("[data-imp-action='rollback-open']"); await page.check("#impRbAck"); await page.click("#impRbConfirm"); await waitRun("[data-run='result']");
    const [rb] = (await calls()).filter((c) => c.op === "rollback"); assert.equal(rb.batchId, "Partial0000000000001"); assert.equal(rb.organizationId, "orgA"); assert.equal(await count('li[data-batch="Partial0000000000001"]'), 0);
    await mount({ org: ORG({ status: "archived" }), incomplete: [partial] }); await page.waitForSelector("#impRecovery");
    assert.equal(await count("[data-imp-action='rollback-open'][disabled]"), 1); assert.match(await text("#impRecovery"), /Đơn vị đã lưu trữ: không thể tiếp tục hoặc hoàn tác/); assert.equal(await count("#impConfirm"), 0);
  });
  await step("RECOVERY load failure is reported, never silently ignored, and does not enable anything", async () => {
    await valid({ setup: 'h.script.findIncomplete = async () => { throw new Error("boom"); };' });
    assert.equal(await count("#impRecoveryFailed"), 1); assert.match(await text("#impRecoveryFailed"), /Không kiểm tra được các lần nhập đang dở/);
  });
  await step("LEAVING THE SCREEN mid-run (remount): the run is stopped at the next authorization check, a fresh mount starts clean; and execution is absent without commitTools (S3 read-only behaviour)", async () => {
    await valid({ setup: 'h.script.commit = async ({ authorize, emit }) => { emit({ phase:"nodes", nodesWritten:1, chunk:0 }); await h.gate("go"); const a = await authorize(); h.afterLeave = a; return a.allowed ? { ok:true, state:"completed", nodesWritten:5, verification:{ ok:true }, eligibility:{ eligible:true, errors:[] } } : { ok:false, state:"denied", reason:a.reason }; };' });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRunPhase[data-phase='nodes']");
    await ev(() => window.__h.mount({ isAdmin: true, org: { id: "orgB", name: "Đơn vị B", code: "b", status: "active" } }));                // another organization on the same host
    await ev(() => window.__h.open("go")); await page.waitForFunction(() => window.__h.afterLeave !== undefined);
    assert.deepEqual(await ev(() => window.__h.afterLeave), { allowed: false, reason: "LEFT_SCREEN" }); assert.equal(await count("#impOrgName"), 1); assert.equal(await text("#impOrgName"), "Đơn vị B"); assert.equal(await count("#impRun"), 0, "nothing of the first run paints into the second organization");
    await mount({ commit: false }); await page.waitForSelector("#impPick:not([disabled])"); await choose(file("mau.xlsx", OK));
    assert.equal(await count("#impConfirm"), 0); assert.equal(await count("#impConfirmDisabled[disabled]"), 1); assert.equal(await count("#impRecoveryHost > *"), 0);
  });
  await step("ESCAPING + NO NETWORK WRITES: hostile names are escaped everywhere in the execution UI; the harness saw no non-GET request and no Firebase/Storage host", async () => {
    const evil = workbookBytes({ framework: ["Khung <img src=x onerror=window.__xss=1>"], subjects: [["A", "Môn <script>window.__xss=2</script>", 1]], lessons: [] });
    await mount({ incomplete: [{ ...(await ev((b) => window.__h.batchFor(b, { batchId: "Evil00000000000000001" }), b64(OK))), sourceFile: { name: "<img src=x onerror=window.__xss=3>.xlsx", size: 10, sha256: "d".repeat(64) } }] });
    await page.waitForSelector("#impRecovery"); await choose(file("<b>evil</b>.xlsx", evil)); await page.waitForSelector("#impConfirm", { timeout: 20000 }).catch(() => {});
    assert.equal(await ev(() => window.__xss), undefined); assert.equal(await count("#impRecovery img, #impConfirm img, #impConfirm script, #impRun img"), 0);
    assert.ok(!requests.some((r) => r.method !== "GET" && !/blob:/.test(r.url)), "no write request"); assert.ok(!requests.some((r) => /firestore|firebase|googleapis|storage/i.test(r.url)));
  });
  await step("LAYOUT: at a 375 px phone width the execution UI (confirm, progress, stop, recovery) does not scroll horizontally and controls are >= 44 px", async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    const batch = await ev((b) => window.__h.batchFor(b, { batchId: "Mobile0000000000001" }), b64(OK));
    await valid({ incomplete: [batch], setup: 'h.script.commit = async ({ emit }) => { emit({ phase:"nodes", nodesWritten:2, chunk:0 }); await h.gate("go"); return { ok:false, state:"paused", nodesWritten:2 }; };' });
    const overflow = () => ev(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok((await overflow()) <= 1, "confirm + recovery");
    const small = await ev(() => [...document.querySelectorAll("#impConfirm button, #impRecovery button, #impConfirm label")].filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.disabled; }).map((e) => e.id || e.textContent.trim()));
    assert.deepEqual(small, [], "touch targets");
    await mount({ keep: false }); await page.waitForSelector("#impPick:not([disabled])"); await choose(file("mau.xlsx", OK)); await page.waitForSelector("#impConfirm");
    await ev(() => { window.__h.script.commit = async ({ emit }) => { emit({ phase: "nodes", nodesWritten: 2, chunk: 0 }); await window.__h.gate("go2"); return { ok: false, state: "paused", nodesWritten: 2 }; }; });
    await ack(); await page.click("#impConfirmBtn"); await waitRun("#impRunPhase"); assert.ok((await overflow()) <= 1, "progress");
    await ev(() => window.__h.open("go2")); await waitRun("#impRun [data-run='stop']"); assert.ok((await overflow()) <= 1, "stop"); await shot("s4-06-mobile-stop");
    await page.setViewportSize({ width: 1100, height: 900 });
  });
  await step("final: no unexpected page or console error", async () => { assert.deepEqual(errors, [], "no page errors: " + errors.join(" | ")); });
  console.log(`\n${results.length}/${results.length} PASS`);
} catch (e) {
  process.exitCode = 1; console.error("FAIL:", e && e.stack || e);
  try { await page.screenshot({ path: path.join(process.env.P4S4_SHOTS || tmpdir(), "p4s4-ui-failure.png"), fullPage: true }); } catch {}
  console.error("recent errors:", errors.slice(-5));
} finally {
  await browser.close().catch(() => {}); server.close();
}
