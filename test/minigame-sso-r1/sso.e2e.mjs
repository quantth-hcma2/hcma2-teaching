// MINI GAME SSO R1 - CROSS-SYSTEM browser end-to-end (EMULATOR ONLY, synthetic accounts).
//  - HCMA2 Teaching = THIS working tree, served on 127.0.0.1 with ?emulator=1, Auth + Firestore emulators loaded with the LIVE Rules bytes.
//  - Mini Game = the Cloudflare build of MINIGAME_REPO run by `wrangler dev --local-protocol https` (workerd), SSO enabled for the demo project;
//    it verifies the emulator ID token (demo-* only) and reads users/{uid} from the Firestore EMULATOR with that token (Rules apply).
//  - The browser serves Teaching's registry with the Mini Game origin swapped for the local one (the only test substitution).
// Nothing here can reach production: demo project id, loopback only, emulator-only tokens.
// Run: node test/minigame-sso-r1/sso.e2e.mjs     Env: MINIGAME_REPO (default D:/QuantTH-Dev/HCMA2-Interactive-V1, needs web/dist-cf),
//      PLAYWRIGHT_PACKAGE, SSO_SHOTS (screenshots dir). Needs firebase CLI, Java 21+, ports 8080/9099 free.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MG = process.env.MINIGAME_REPO || "D:/QuantTH-Dev/HCMA2-Interactive-V1";
const PROJECT = "demo-hcma2-production-prep";
const PROD_MG_ORIGIN = "https://hcma2-interactive.hcma2-interactive-v1.workers.dev";
const SHOTS = process.env.SSO_SHOTS || path.join(os.tmpdir(), "test-results-minigame-sso-r1");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE || "playwright");
if (!existsSync(path.join(MG, "web", "dist-cf", "index.html"))) throw new Error("Mini Game Cloudflare build missing: npm run build:cf in " + MG);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // ONLY for polling the local self-signed wrangler https server from this test process

function ensureJava() {
  const major = () => { try { const m = /version "(\d+)/.exec(execSync("java -version 2>&1", { encoding: "utf8" })); return m ? Number(m[1]) : 0; } catch { return 0; } };
  if (major() >= 21) return;
  const base = "C:\\Program Files\\Eclipse Adoptium";
  if (existsSync(base)) { const dir = readdirSync(base).filter((n) => /^(jre|jdk)-?2\d/.test(n)).sort().pop(); if (dir) { process.env.JAVA_HOME = path.join(base, dir); process.env.PATH = path.join(base, dir, "bin") + path.delimiter + process.env.PATH; } }
  if (major() < 21) throw new Error("Java 21+ required");
}
ensureJava();
for (const name of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN"]) delete process.env[name];

// ---------------------------------------------------------------- emulators
const work = mkdtempSync(path.join(os.tmpdir(), "hcma2-sso-emu-"));
writeFileSync(path.join(work, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { host: "127.0.0.1", port: 9099 }, firestore: { host: "127.0.0.1", port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }));
copyFileSync(path.join(REPO, "firestore.rules.production-candidate"), path.join(work, "firestore.rules"));
const busy = async (u) => { try { await fetch(u); return true; } catch { return false; } };
if (await busy("http://127.0.0.1:8080/") || await busy("http://127.0.0.1:9099/")) throw new Error("ports 8080/9099 busy");
const emu = spawn(process.platform === "win32" ? "firebase.cmd" : "firebase", ["emulators:start", "--only", "auth,firestore", "--project", PROJECT, "--config", path.join(work, "firebase.json")], { cwd: work, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
let emuLog = ""; emu.stdout.on("data", (d) => (emuLog += d)); emu.stderr.on("data", (d) => (emuLog += d));
let mg = null;
const servers = [];
const kill = (child) => { try { if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" }); else child.kill("SIGTERM"); } catch { /* ignore */ } };
const stopAll = () => { for (const s of servers) try { s.close(); } catch { /* ignore */ } kill(emu); if (mg) kill(mg); };
process.on("exit", stopAll);
async function waitFor(url, label) { for (let i = 0; i < 200; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(label + " did not start"); }
await waitFor("http://127.0.0.1:8080/", "firestore"); await waitFor("http://127.0.0.1:9099/", "auth");

const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const enc = (v) => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) });
const put = async (p, data) => { const r = await fetch(`${FS}/${p}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error("seed " + p); };
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp"); return j.localId; }
const PASS = "QA-" + randomBytes(6).toString("hex") + "-A1";
const D = new Date(Date.UTC(2026, 10, 1));
const people = { anh: ["anh.gv@example.test", "teacher", "active", "Giảng viên Anh"], binh: ["binh.gv@example.test", "teacher", "active", "Giảng viên Bình"], quan: ["quan.qt@example.test", "admin", "active", "Quản trị Quân"], cho: ["cho.duyet@example.test", "teacher", "pending", "Chờ duyệt"] };
const uid = {};
for (const [k, [email, role, status, name]] of Object.entries(people)) {
  uid[k] = await signUp(email, PASS);
  await put(`users/${uid[k]}`, { uid: uid[k], role, status, displayName: name, email, approvedBy: null, approvedAt: null, createdAt: D });
}

// ---------------------------------------------------------------- Teaching static server
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const tServer = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/" || (url.pathname === "/index.html" && url.searchParams.get("emulator") !== "1")) { url.pathname = "/index.html"; url.searchParams.set("emulator", "1"); res.writeHead(302, { location: url.pathname + url.search }); return res.end(); }
  const p = path.resolve(REPO, "." + decodeURIComponent(url.pathname));
  if (!p.startsWith(REPO) || !existsSync(p) || /[\\/]\.git[\\/]|[\\/]node_modules[\\/]/.test(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p));
});
await new Promise((r) => tServer.listen(0, "127.0.0.1", r));
servers.push(tServer);
const TEACHING = `http://127.0.0.1:${tServer.address().port}`;

// ---------------------------------------------------------------- Mini Game (wrangler dev, https, SSO on)
const mgPort = 20000 + Math.floor(Math.random() * 20000);
const SETUP = "setup-" + randomBytes(12).toString("hex");
const vars = { SETUP_TOKEN: SETUP, SSO_ENABLED: "1", SSO_PROJECT_ID: PROJECT, SSO_TEACHING_ORIGIN: TEACHING, SSO_FIRESTORE_BASE: "http://127.0.0.1:8080", SSO_JWKS_URL: "http://127.0.0.1:9/unused", SSO_ALLOW_EMULATOR_TOKENS: "1", SSO_SESSION_HOURS: "8", JOIN_LIMIT_PER_MIN: "100000", API_LIMIT_PER_MIN: "100000" };
const args = [path.join(MG, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--ip", "127.0.0.1", "--port", String(mgPort), "--inspector-port", String(mgPort + 1), "--local-protocol", "https", "--persist-to", mkdtempSync(path.join(os.tmpdir(), "hcma2-sso-mg-")), "--log-level", "error", "--show-interactive-dev-session=false"];
for (const [k, v] of Object.entries(vars)) args.push("--var", k + ":" + v);
mg = spawn(process.execPath, args, { cwd: MG, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let mgLog = ""; mg.stdout.on("data", (d) => (mgLog += d)); mg.stderr.on("data", (d) => (mgLog += d));
const MGO = `https://127.0.0.1:${mgPort}`;
await waitFor(MGO + "/api/health", "Mini Game");
const setup = await fetch(MGO + "/api/setup", { method: "POST", headers: { "X-HCMA": "1", "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", displayName: "Quản trị dự phòng", password: "break-glass-123", setupToken: SETUP }) });
if (setup.status !== 200) throw new Error("mini game setup " + setup.status);

// ---------------------------------------------------------------- browser
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const outbound = [];
const registrySrc = readFileSync(path.join(REPO, "mini-game-registry.mjs"), "utf8").split(PROD_MG_ORIGIN).join(MGO);
async function newCtx(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "vi-VN", ignoreHTTPSErrors: true });
  await ctx.route("**/mini-game-registry.mjs*", (r) => r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: registrySrc }));
  await ctx.route("https://evil.example/**", (r) => { outbound.push(r.request().url()); return r.fulfill({ status: 200, body: "evil" }); });
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(label + ": " + e.message)));
  return ctx;
}
async function teachingLogin(p, email) {
  await p.goto(`${TEACHING}/index.html?emulator=1`);
  await p.waitForSelector("#loginEmail", { timeout: 60000 });
  await p.fill("#loginEmail", email); await p.fill("#loginPass", PASS); await p.click("#loginBtn");
}
const mgMe = (p) => p.evaluate(async () => (await (await fetch("/api/me")).json()).user);
/** Teaching -> Mini Game tab -> card -> confirmation -> lands in Mini Game. Returns the Mini Game page. */
async function ssoFromTeaching(ctx, p, shotPrefix) {
  await p.click('#sidebarNav .navlink[data-nav="minigames"]');
  await p.waitForSelector('[data-minigame-open="quiz"]', { timeout: 15000 });
  const [tab] = await Promise.all([ctx.waitForEvent("page"), p.click('[data-minigame-open="quiz"]')]);
  await tab.waitForSelector("#mgSsoOverlay", { timeout: 60000 });
  if (shotPrefix) await tab.screenshot({ path: path.join(SHOTS, shotPrefix + "-confirm.png") });
  check(`${shotPrefix}: the new tab shows the Teaching confirmation and the SSO parameters were removed from its address`, tab.url().startsWith(TEACHING) && !/mg_sso_/.test(tab.url()), tab.url());
  await tab.click('[data-mg-sso="go"]');
  await tab.waitForURL((u) => u.toString().startsWith(MGO + "/"), { timeout: 30000 });
  await tab.waitForLoadState("networkidle");
  return tab;
}

try {
  // A. active teacher Anh: one sign-in only
  const ctxA = await newCtx("anh");
  const tA = await ctxA.newPage();
  await teachingLogin(tA, people.anh[0]);
  await tA.waitForSelector(".navlink", { timeout: 60000 });
  await tA.waitForTimeout(1000);
  const mgA = await ssoFromTeaching(ctxA, tA, "01-teacher");
  const meA = await mgMe(mgA);
  check("teacher: Mini Game session WITHOUT a second password; role teacher; name from Teaching; not the break-glass account", meA && meA.role === "teacher" && meA.displayName === "Giảng viên Anh" && meA.username !== "admin", JSON.stringify(meA));
  check("teacher: no token / code left in the Mini Game address", !/code=|token|mg_sso/.test(mgA.url()), mgA.url());
  await mgA.waitForTimeout(800);
  await mgA.screenshot({ path: path.join(SHOTS, "02-teacher-in-minigame.png") });

  // B. game still works for the SSO teacher: create, host, student joins by PIN (no login), answers, report
  const game = { title: "SSO kiểm thử", description: "", coverImage: null, settings: { defaultTimeSec: 15, speedBonus: true, previewSec: 3, resultSec: 2, leaderboardSec: 0, autoAdvance: true, endWhenAllAnswered: true, soundTheme: "calm", music: false, volume: 50 }, questions: [{ id: "q1", text: "Thủ đô Việt Nam?", image: null, choices: [{ id: "a", text: "Hà Nội" }, { id: "b", text: "Huế" }], correct: ["a"], timeSec: null, points: "standard" }] };
  const created = await mgA.evaluate(async (g) => { const h = { "X-HCMA": "1", "Content-Type": "application/json" }; const gr = await (await fetch("/api/games", { method: "POST", headers: h, body: JSON.stringify(g) })).json(); const rr = await (await fetch("/api/rooms", { method: "POST", headers: h, body: JSON.stringify({ gameId: gr.game.id }) })).json(); return { gameId: gr.game.id, ...rr }; }, game);
  await mgA.goto(`${MGO}/#/host/${created.roomId}`);
  await mgA.waitForSelector('[data-testid="pin"]', { timeout: 30000 });
  const ctxS = await newCtx("student", { width: 390, height: 844 });
  const st = await ctxS.newPage();
  await st.goto(`${MGO}/play/?pin=${created.pin}`);
  await st.fill('[data-testid="nick-input"]', "Học viên A");
  await st.click('[data-testid="join-btn"]');
  await st.getByText("Bạn đã vào phòng!").waitFor({ timeout: 20000 });
  await mgA.getByTestId("player-count").filter({ hasText: /^1$/ }).waitFor({ timeout: 15000 });
  await mgA.getByTestId("start").click();
  await mgA.getByTestId("countdown-321").waitFor({ timeout: 10000 });
  await st.getByTestId("choice-0").waitFor({ timeout: 15000 });
  await st.getByTestId("choice-0").click();
  await mgA.getByTestId("podium").waitFor({ timeout: 30000 });
  const rep = await mgA.evaluate(async (id) => (await (await fetch(`/api/rooms/${id}/report`)).json()).report.totals, created.roomId);
  check("SSO teacher hosts a full game: PIN join without login, WebSocket, countdown, scoring, podium, report", rep.players === 1 && rep.answers === 1 && rep.correctAnswers === 1, JSON.stringify(rep));
  await mgA.screenshot({ path: path.join(SHOTS, "03-teacher-hosted-game.png") });

  // C. teacher Binh cannot see Anh's data
  const ctxB = await newCtx("binh");
  const tB = await ctxB.newPage();
  await teachingLogin(tB, people.binh[0]);
  await tB.waitForSelector(".navlink", { timeout: 60000 });
  await tB.waitForTimeout(1000);
  const mgB = await ssoFromTeaching(ctxB, tB, "04-teacher2");
  const iso = await mgB.evaluate(async (ids) => ({ game: (await fetch(`/api/games/${ids.gameId}`)).status, report: (await fetch(`/api/rooms/${ids.roomId}/report`)).status, me: (await (await fetch("/api/me")).json()).user.displayName }), created);
  check("second teacher: own account, and 403 on the first teacher's game and report", iso.me === "Giảng viên Bình" && iso.game === 403 && iso.report === 403, JSON.stringify(iso));

  // D. Teaching admin -> Mini Game admin
  const ctxQ = await newCtx("quan");
  const tQ = await ctxQ.newPage();
  await teachingLogin(tQ, people.quan[0]);
  await tQ.waitForSelector(".navlink", { timeout: 60000 });
  await tQ.waitForTimeout(1500);
  const mgQ = await ssoFromTeaching(ctxQ, tQ, "05-admin");
  const adm = await mgQ.evaluate(async () => ({ me: (await (await fetch("/api/me")).json()).user.role, users: (await fetch("/api/users")).status }));
  check("Teaching admin: Mini Game role admin with account management", adm.me === "admin" && adm.users === 200, JSON.stringify(adm));

  // E. pending teacher: Teaching shows the pending screen (no shell, no confirmation); no Mini Game session
  const ctxP = await newCtx("pending");
  const tP = await ctxP.newPage();
  await teachingLogin(tP, people.cho[0]);
  await tP.waitForTimeout(3000);
  const mgP = await ctxP.newPage();
  await mgP.goto(`${MGO}/sso/begin`);
  await mgP.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 30000 });
  await mgP.waitForTimeout(4000);
  const pendingState = { overlay: await mgP.locator("#mgSsoOverlay").count(), navlinks: await mgP.locator(".navlink").count() };
  await mgP.goto(`${MGO}/`);
  const meP = await mgMe(mgP);
  check("pending teacher: no menu, no confirmation, no Mini Game session", pendingState.overlay === 0 && pendingState.navlinks === 0 && meP === null, JSON.stringify({ ...pendingState, meP }));
  await mgP.screenshot({ path: path.join(SHOTS, "06-pending-not-signed-in.png") });

  // F. foreign return origin: Teaching refuses BEFORE asking for the token; nothing is sent to the foreign origin
  const evil = await ctxA.newPage();
  const S = "A".repeat(43);
  await evil.goto(`${TEACHING}/index.html?emulator=1&mg_sso_state=${S}&mg_sso_challenge=${S}&mg_sso_return=${encodeURIComponent("https://evil.example")}`);
  await evil.waitForSelector("#mgSsoOverlay", { timeout: 60000 });
  const evilText = await evil.locator("#mgSsoOverlay").innerText();
  check("forged link with a foreign return origin: refused, ID token never sent anywhere", /không hợp lệ/.test(evilText) && outbound.length === 0 && !/mg_sso_/.test(evil.url()), JSON.stringify({ outbound, url: evil.url() }));
  await evil.screenshot({ path: path.join(SHOTS, "07-forged-link-refused.png") });

  // G. cancel keeps the user on Teaching and creates nothing
  const ctxC = await newCtx("cancel");
  const tC = await ctxC.newPage();
  await teachingLogin(tC, people.binh[0]);
  await tC.waitForSelector(".navlink", { timeout: 60000 });
  await tC.waitForTimeout(800);
  await tC.click('#sidebarNav .navlink[data-nav="minigames"]');
  const [ctab] = await Promise.all([ctxC.waitForEvent("page"), tC.click('[data-minigame-open="quiz"]')]);
  await ctab.waitForSelector("#mgSsoOverlay", { timeout: 60000 });
  await ctab.click('[data-mg-sso="cancel"]');
  await ctab.waitForTimeout(1000);
  const mgCheck = await ctxC.newPage();
  await mgCheck.goto(`${MGO}/`);
  check("cancel: stays on Teaching, no Mini Game session", ctab.url().startsWith(TEACHING) && (await mgMe(mgCheck)) === null);

  // H. Mini Game login page offers Teaching sign-in; logout ends the SSO session
  await mgCheck.waitForSelector('[data-testid="sso-login"]', { timeout: 20000 });
  check("Mini Game login page offers 'Đăng nhập bằng HCMA2 Teaching'", (await mgCheck.getAttribute('[data-testid="sso-login"]', "href")) === "/sso/begin");
  await mgCheck.screenshot({ path: path.join(SHOTS, "08-minigame-login-sso-button.png") });
  await mgA.evaluate(async () => fetch("/api/logout", { method: "POST", headers: { "X-HCMA": "1" } }));
  check("logout in Mini Game ends the SSO session", (await mgMe(mgA)) === null);

  // I. regression: Teaching menus, Thảo luận nhóm, Thư viện still work for the teacher
  await tA.click('#sidebarNav .navlink[data-nav="groups"]');
  await tA.waitForTimeout(1500);
  await tA.click('#sidebarNav .navlink[data-nav="library"]');
  await tA.waitForFunction(() => /THƯ VIỆN/.test(document.querySelector("#mainContent")?.innerText || ""), null, { timeout: 15000 });
  check("Teaching regression: Thảo luận nhóm and THƯ VIỆN still open", true);
  check("no JavaScript page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("unexpected failure", false, String(e?.message || e).slice(0, 500) + " | MG log: " + mgLog.slice(-400));
} finally {
  await browser.close();
  stopAll();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(SHOTS, "sso-e2e-results.json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
console.log(`\nMINI GAME SSO R1 E2E: ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}  (screenshots: ${SHOTS})`);
process.exit(failed.length ? 1 : 0);
