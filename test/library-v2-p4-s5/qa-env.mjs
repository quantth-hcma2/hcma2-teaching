// LIBRARY V2 P4-S5-B - EMULATOR-ONLY Owner QA environment for the Import Center (preview, confirm, progress, completion, resume, rollback, P3 incomplete-import labels, activation, audit, duplicate warning,
// Vietnamese messages, narrow layout). Synthetic data only. It starts LOCAL Auth + Firestore emulators loaded with the LIVE Rules bytes and serves THIS working tree on 127.0.0.1.
//
// CANNOT REACH PRODUCTION:  (1) the Firebase project id is the demo id `demo-hcma2-production-prep` (no credentials, no network to a real project);  (2) the app itself only runs on loopback with
// `?emulator=1` and then talks to 127.0.0.1:8080 / 9099 only (app-environment.mjs: loopback without the flag is refused, there is no production fallback) - this server redirects every page request to
// add the flag;  (3) the server binds 127.0.0.1 only;  (4) the launcher refuses to start unless the Rules file is the approved live artifact (SHA-256 F6B9DE01...7D4A), the app-environment guard is
// present, and the emulator ports are free;  (5) credentials are random per run and exist only inside the emulator.
//
// Run:   node test/library-v2-p4-s5/qa-env.mjs                (stay running; Ctrl+C stops everything)       Options: --port 8212   --files <dir>   --self-test (automatic check, then exit)
// Needs: Firebase CLI on PATH, Java 21+ (JAVA_HOME or Eclipse Adoptium auto-detected), ports 8080 / 9099 / <port> free.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const SELF_TEST = args.includes("--self-test");
const PORT = Number(opt("--port", SELF_TEST ? "0" : "8212"));
const PROJECT = "demo-hcma2-production-prep";
const APPROVED_RULES_SHA = "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A";
const say = (s = "") => console.log(s);
const die = (s) => { console.error("\n⛔ " + s + "\n"); process.exit(2); };

// ---------------------------------------------------------------- safety gates (all must hold before anything starts)
if (!/^demo-/.test(PROJECT)) die("Mã dự án Firebase không phải mã demo: từ chối chạy.");
const rulesBytes = readFileSync(path.join(REPO, "firestore.rules.production-candidate"));
const rulesSha = createHash("sha256").update(rulesBytes).digest("hex").toUpperCase();
if (rulesSha !== APPROVED_RULES_SHA) die("Tệp Rules không phải bản đang chạy trên production (SHA-256 " + rulesSha + "). Từ chối chạy để môi trường QA luôn giống production.");
const envGuard = readFileSync(path.join(REPO, "app-environment.mjs"), "utf8");
if (!envGuard.includes("Bản thử cục bộ bắt buộc có ?emulator=1.") || !envGuard.includes("Không cho phép tham số Emulator trên domain production.")) die("Thiếu cơ chế chặn production trong app-environment.mjs: từ chối chạy.");
for (const name of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN"]) if (process.env[name]) { delete process.env[name]; say("ℹ Đã bỏ biến môi trường " + name + " cho tiến trình QA (không cần cho emulator)."); }

// ---------------------------------------------------------------- Java 21
function ensureJava() {
  const major = () => { try { const out = execSync("java -version 2>&1", { encoding: "utf8" }); const m = /version "(\d+)/.exec(out); return m ? Number(m[1]) : 0; } catch { return 0; } };
  if (major() >= 21) return;
  const base = "C:\\Program Files\\Eclipse Adoptium";
  if (existsSync(base)) { const dir = readdirSync(base).filter((n) => /^(jre|jdk)-?2\d/.test(n)).sort().pop(); if (dir) { process.env.JAVA_HOME = path.join(base, dir); process.env.PATH = path.join(base, dir, "bin") + path.delimiter + process.env.PATH; } }
  if (major() < 21) die("Cần Java 21 trở lên cho Firestore emulator (đặt JAVA_HOME).");
}
ensureJava();

// ---------------------------------------------------------------- emulators
const work = mkdtempSync(path.join(os.tmpdir(), "hcma2-p4s5-qa-"));
writeFileSync(path.join(work, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { host: "127.0.0.1", port: 9099 }, firestore: { host: "127.0.0.1", port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }));
copyFileSync(path.join(REPO, "firestore.rules.production-candidate"), path.join(work, "firestore.rules"));
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
async function portBusy(url) { try { await fetch(url); return true; } catch { return false; } }
if (await portBusy("http://127.0.0.1:8080/") || await portBusy("http://127.0.0.1:9099/")) die("Cổng 8080 hoặc 9099 đang được dùng. Hãy tắt emulator/QA khác rồi chạy lại.");
const emu = spawn(process.platform === "win32" ? "firebase.cmd" : "firebase", ["emulators:start", "--only", "auth,firestore", "--project", PROJECT, "--config", path.join(work, "firebase.json")], { cwd: work, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
let emuLog = ""; emu.stdout.on("data", (d) => (emuLog += d)); emu.stderr.on("data", (d) => (emuLog += d));
let server = null;
const stopAll = () => { try { if (server) server.close(); } catch { /* ignore */ } try { if (process.platform === "win32") execSync(`taskkill /pid ${emu.pid} /T /F`, { stdio: "ignore" }); else emu.kill("SIGTERM"); } catch { /* ignore */ } };
process.on("exit", stopAll); process.on("SIGINT", () => { say("\nĐang tắt môi trường QA…"); stopAll(); process.exit(0); });
async function waitFor(url, label) { for (let i = 0; i < 160; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); } stopAll(); die(label + " không khởi động được.\n" + emuLog.slice(-1200)); }
say("Đang khởi động Firestore + Auth emulator (cục bộ)…");
await waitFor("http://127.0.0.1:8080/", "Firestore emulator"); await waitFor("http://127.0.0.1:9099/", "Auth emulator");

// ---------------------------------------------------------------- REST helpers (emulator owner bearer; bypasses Rules - used ONLY for seeding / QA aids)
const enc = (v) => { if (v === null) return { nullValue: null }; if (v instanceof Date) return { timestampValue: v.toISOString() }; if (typeof v === "string") return { stringValue: v }; if (typeof v === "boolean") return { booleanValue: v }; if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }; if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }; return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }; };
const dec = (f) => { if ("stringValue" in f) return f.stringValue; if ("integerValue" in f) return Number(f.integerValue); if ("doubleValue" in f) return f.doubleValue; if ("booleanValue" in f) return f.booleanValue; if ("nullValue" in f) return null; if ("timestampValue" in f) return f.timestampValue; if ("arrayValue" in f) return (f.arrayValue.values || []).map(dec); if ("mapValue" in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, dec(v)])); };
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const put = async (p, data) => { const r = await fetch(`${FS_BASE}/${p}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error("seed " + p + " " + r.status); };
const list = async (col) => { const out = []; let token = ""; do { const r = await fetch(`${FS_BASE}/${col}?pageSize=300${token ? "&pageToken=" + token : ""}`, { headers: H }); const j = await r.json(); out.push(...(j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])) }))); token = j.nextPageToken || ""; } while (token); return out; };
const wipe = async () => { await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" }); };
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp " + JSON.stringify(j)); return { uid: j.localId }; }

// ---------------------------------------------------------------- synthetic world
const PASS = "QA-" + randomBytes(6).toString("hex") + "-A1";
const ADMIN = "quan.tri.qa@example.test", TEACHER = "giang.vien.qa@example.test";
const admin = await signUp(ADMIN, PASS), teacher = await signUp(TEACHER, PASS);
const D = (day) => new Date(Date.UTC(2026, 9, day, 0, 0, 0));
async function seed() {
  await put(`users/${admin.uid}`, { uid: admin.uid, role: "admin", status: "active", displayName: "Quản trị hệ thống (QA)", email: ADMIN, approvedBy: null, approvedAt: null, createdAt: D(1) });
  await put(`users/${teacher.uid}`, { uid: teacher.uid, role: "teacher", status: "active", displayName: "Giảng viên (QA)", email: TEACHER, approvedBy: null, approvedAt: null, createdAt: D(1) });
  const org = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(2), createdBy: admin.uid, updatedAt: D(2), ...(status === "archived" ? { archivedAt: D(3), archivedBy: admin.uid } : {}) });
  await put("organizations/orgMain", org("Khoa Quản trị (QA)", "khoa-quan-tri-qa")); await put("organizations/orgOther", org("Trung tâm khác (QA)", "trung-tam-khac-qa")); await put("organizations/orgArch", org("Đơn vị cũ (QA)", "don-vi-cu-qa", "archived"));
  await put("curriculumFrameworks/fwMain", { schemaVersion: 1, organizationId: "orgMain", scope: "organization", name: "Chương trình hiện có (QA)", status: "active", createdAt: D(5), createdBy: admin.uid, updatedAt: D(5), activatedAt: D(6), statusChangedAt: D(6), statusChangedBy: admin.uid });
  await put("curriculumFrameworks/fwMain/nodes/s1", { schemaVersion: 1, organizationId: "orgMain", kind: "subject", parentId: null, ancestors: [], order: 0, code: "TRI", name: "Triết học (QA)", status: "active", createdAt: D(6), updatedAt: D(6) });
}
await seed();

// ---------------------------------------------------------------- synthetic XLSX files for the file chooser
const filesDir = opt("--files", path.join(os.tmpdir(), "hcma2-p4s5-qa-files"));
mkdirSync(filesDir, { recursive: true });
const { workbookBytes } = await import(new URL("../library-v2-p4-s2/helpers.mjs", import.meta.url).href);
const book = (subjects, per, name) => { const s = Array.from({ length: subjects }, (_, i) => ["S" + i, "Môn " + i, i]); const l = []; for (let a = 0; a < subjects; a++) for (let b = 0; b < per; b++) l.push(["S" + a, "S" + a + "-L" + b, "Bài " + b, b]); return workbookBytes({ framework: [name], subjects: s, lessons: l }); };
const FILES = {
  "01-mau-hop-le-5-muc.xlsx": workbookBytes({}),
  "02-lon-1200-muc.xlsx": book(12, 99, "Khung lớn 1.200 mục (QA)"),
  "03-lon-5000-muc.xlsx": book(50, 99, "Khung lớn 5.000 mục (QA)"),
  "04-loi-trung-ma.xlsx": workbookBytes({ subjects: [["M1", "Môn một", 1], ["M1", "Môn hai trùng mã", 2]], lessons: [] }),
  "05-tep-khac.xlsx": workbookBytes({ subjects: [["Z1", "Môn Z", 1]], lessons: [] })
};
for (const [name, bytes] of Object.entries(FILES)) writeFileSync(path.join(filesDir, name), bytes);

// ---------------------------------------------------------------- QA aids
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body, null, 2)); };
async function status() {
  const batches = (await list("importBatches")).map((b) => ({ id: b.id, status: b.status, resultCode: b.resultCode || null, chunks: `${b.chunksDone}/${b.chunksTotal}`, file: b.sourceFile && b.sourceFile.name }));
  const audits = (await list("auditLogs")).filter((a) => /^curriculum\.import\./.test(a.action || "")).map((a) => ({ id: a.id, action: a.action, actor: a.actorEmail, resultCode: a.detail && a.detail.resultCode || null }));
  return { batches, importAuditEntries: audits, frameworks: (await list("curriculumFrameworks")).map((f) => ({ id: f.id, name: f.name, status: f.status })) };
}
async function tamper() {
  const batch = (await list("importBatches")).filter((b) => b.status === "committing").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!batch) return { ok: false, message: "Không có lần nhập nào đang ở trạng thái 'Đang nhập dở'. Hãy bắt đầu nhập tệp lớn rồi tải lại trang giữa chừng." };
  const nodes = await list(`curriculumFrameworks/${batch.id}/nodes`);
  if (!nodes.length) return { ok: false, message: "Khung của lần nhập chưa có mục nào; hãy thử lại sau vài giây." };
  const r = await fetch(`${FS_BASE}/curriculumFrameworks/${batch.id}/nodes/${nodes[0].id}?updateMask.fieldPaths=name`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { name: { stringValue: "Đã sửa ngoài luồng (QA)" } } }) });
  return { ok: r.ok, batchId: batch.id, nodeId: nodes[0].id, message: "Đã đổi tên 1 mục bên ngoài ứng dụng. Bây giờ chọn TIẾP TỤC với đúng tệp: lần đọc lại sẽ KHÔNG khớp và lần nhập sẽ dừng ở trạng thái 'một phần' (kèm nhật ký curriculum.import.partial)." };
}
const helpPage = () => `<!doctype html><meta charset="utf-8"><title>QA nhập Excel (emulator)</title><body style="font:16px system-ui;max-width:860px;margin:24px auto;padding:0 16px;line-height:1.5">
<h1>🧪 Môi trường QA nhập Excel — CHỈ emulator, dữ liệu giả</h1>
<p><b>Không kết nối production.</b> Ứng dụng chỉ chạy với <code>?emulator=1</code> và chỉ nói chuyện với 127.0.0.1.</p>
<ul><li><a href="/index.html?emulator=1">Mở ứng dụng (bản trong cây mã này)</a></li><li><a href="/__status">Trạng thái lô nhập / nhật ký nhập</a></li><li><a href="/__tamper">Làm hỏng 1 mục của lần nhập đang dở (để tạo trạng thái “một phần”)</a></li><li><a href="/__reset">Khôi phục dữ liệu mẫu</a> · <a href="/__clear-imports">Xóa toàn bộ lần nhập + khung đã nhập + nhật ký nhập</a></li></ul>
<p>Tệp để chọn nằm ở thư mục: <code>${filesDir}</code> (01 hợp lệ 5 mục · 02 lớn 1.200 mục · 03 lớn 5.000 mục · 04 lỗi trùng mã · 05 tệp khác).</p>
<p>Tài khoản Platform Admin: <code>${ADMIN}</code> — mật khẩu in ở cửa sổ dòng lệnh đang chạy (ngẫu nhiên mỗi lần). Giảng viên thử: <code>${TEACHER}</code>.</p></body>`;
server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/" || (url.pathname === "/index.html" && url.searchParams.get("emulator") !== "1")) { res.writeHead(302, { location: "/index.html?emulator=1" }); return res.end(); }
    if (url.pathname === "/__help") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(helpPage()); }
    if (url.pathname === "/__status") return json(res, 200, await status());
    if (url.pathname === "/__tamper") return json(res, 200, await tamper());
    if (url.pathname === "/__reset") { await wipe(); await seed(); return json(res, 200, { ok: true, message: "Đã khôi phục dữ liệu mẫu." }); }
    if (url.pathname === "/__clear-imports") { for (const col of ["importBatches", "auditLogs"]) for (const d of await list(col)) await fetch(`${FS_BASE}/${col}/${d.id}`, { method: "DELETE", headers: H }); for (const f of await list("curriculumFrameworks")) if (f.id !== "fwMain" && f.id !== "fwOther") { for (const n of await list(`curriculumFrameworks/${f.id}/nodes`)) await fetch(`${FS_BASE}/curriculumFrameworks/${f.id}/nodes/${n.id}`, { method: "DELETE", headers: H }); await fetch(`${FS_BASE}/curriculumFrameworks/${f.id}`, { method: "DELETE", headers: H }); } return json(res, 200, { ok: true }); }
    const p = path.resolve(REPO, "." + decodeURIComponent(url.pathname));
    if (!p.startsWith(REPO) || !existsSync(p) || /[\\/]\.git[\\/]|[\\/]node_modules[\\/]/.test(p)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p));
  } catch (e) { res.writeHead(500); res.end("error"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

if (SELF_TEST) {
  const assert = (await import("node:assert/strict")).default;
  const noFollow = await fetch(base + "/", { redirect: "manual" }); assert.equal(noFollow.status, 302); assert.match(noFollow.headers.get("location"), /emulator=1/);
  const noFlag = await fetch(base + "/index.html", { redirect: "manual" }); assert.equal(noFlag.status, 302);
  const page = await fetch(base + "/index.html?emulator=1"); assert.equal(page.status, 200); assert.match(await page.text(), /HCMA2 - TEACHING/);
  assert.equal((await fetch(base + "/.git/config")).status, 404); assert.equal((await fetch(base + "/node_modules/x")).status, 404);
  const s = await (await fetch(base + "/__status")).json(); assert.deepEqual(s.batches, []); assert.equal(s.frameworks.length, 1);
  assert.equal((await (await fetch(base + "/__tamper")).json()).ok, false);
  assert.equal(readdirSync(filesDir).filter((n) => n.endsWith(".xlsx")).length, 5);
  assert.equal(server.address().address, "127.0.0.1");
  say("QA-ENV SELF-TEST PASS"); stopAll(); process.exit(0);
}

say("\n════════════════════════════════════════════════════════════════════════");
say(" 🧪 MÔI TRƯỜNG QA NHẬP EXCEL — CHỈ EMULATOR (dữ liệu giả, không chạm production)");
say("════════════════════════════════════════════════════════════════════════");
say(" Mở ứng dụng : " + base + "/index.html?emulator=1");
say(" Trang trợ giúp QA: " + base + "/__help");
say(" Tài khoản Platform Admin : " + ADMIN);
say(" Mật khẩu (ngẫu nhiên, chỉ dùng trong emulator): " + PASS);
say(" Tài khoản giảng viên thử  : " + TEACHER + " (cùng mật khẩu)");
say(" Thư mục tệp XLSX để chọn  : " + filesDir);
say(" Đường dẫn QA: Đơn vị → “Khoa Quản trị (QA)” → Chương trình → NHẬP TỪ EXCEL");
say(" Nhấn Ctrl+C để tắt tất cả.\n");
await new Promise(() => {});
