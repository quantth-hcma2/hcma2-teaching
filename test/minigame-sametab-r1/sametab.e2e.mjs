// MINI GAME SAME-TAB R1 - CROSS-SYSTEM browser end-to-end on Microsoft Edge AND Google Chrome (EMULATOR ONLY, synthetic accounts).
// Same tab Teaching -> Mini Game, Back/Forward, reload, "Quay ve HCMA2 Teaching" (+ live-room warning), locked / pending / suspended,
// Mini Game login-button path, stale intent, Teaching sign-out revocation, full game regression. Harness = test/minigame-sso-r1/sso.e2e.mjs.
//  - HCMA2 Teaching = THIS working tree, served on 127.0.0.1 with ?emulator=1, Auth + Firestore emulators loaded with the LIVE Rules bytes.
//  - Mini Game = the Cloudflare build of MINIGAME_REPO run by `wrangler dev --local-protocol https` (workerd), SSO enabled for the demo project;
//    it verifies the emulator ID token (demo-* only) and reads users/{uid} from the Firestore EMULATOR with that token (Rules apply).
//  - The browser serves Teaching's registry with the Mini Game origin swapped for the local one (the only test substitution).
// Nothing here can reach production: demo project id, loopback only, emulator-only tokens.
// Run: node test/minigame-sametab-r1/sametab.e2e.mjs (SAMETAB_CHANNELS=msedge,chrome)     Env: MINIGAME_REPO (default D:/QuantTH-Dev/HCMA2-Interactive-V1, needs web/dist-cf),
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
const SHOTS = process.env.SSO_SHOTS || path.join(os.tmpdir(), "test-results-minigame-sametab-r1");
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
const work = mkdtempSync(path.join(os.tmpdir(), "hcma2-sametab-emu-"));
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
const people = { anh: ["anh.gv@example.test", "teacher", "active", "Giảng viên Anh"], binh: ["binh.gv@example.test", "teacher", "active", "Giảng viên Bình"], quan: ["quan.qt@example.test", "admin", "active", "Quản trị Quân"], cho: ["cho.duyet@example.test", "teacher", "pending", "Chờ duyệt"], khoa: ["bi.khoa@example.test", "teacher", "suspended", "Bị khoá"] };
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
const vars = { SETUP_TOKEN: SETUP, SSO_ENABLED: "1", SSO_PROJECT_ID: PROJECT, SSO_TEACHING_ORIGIN: TEACHING, SSO_FIRESTORE_BASE: "http://127.0.0.1:8080", SSO_JWKS_URL: "http://127.0.0.1:9/unused", SSO_ALLOW_EMULATOR_TOKENS: "1", SSO_SESSION_MAX_S: "14400", SSO_IDLE_S: "1800", SSO_REVERIFY_S: "3600", SSO_RATE_PER_MIN: "100000", JOIN_LIMIT_PER_MIN: "100000", API_LIMIT_PER_MIN: "100000" };
const args = [path.join(MG, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--ip", "127.0.0.1", "--port", String(mgPort), "--inspector-port", String(mgPort + 1), "--local-protocol", "https", "--persist-to", mkdtempSync(path.join(os.tmpdir(), "hcma2-sso-mg-")), "--log-level", "error", "--show-interactive-dev-session=false"];
for (const [k, v] of Object.entries(vars)) args.push("--var", k + ":" + v);
mg = spawn(process.execPath, args, { cwd: MG, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let mgLog = ""; mg.stdout.on("data", (d) => (mgLog += d)); mg.stderr.on("data", (d) => (mgLog += d));
const MGO = `https://127.0.0.1:${mgPort}`;
await waitFor(MGO + "/api/health", "Mini Game");
const setup = await fetch(MGO + "/api/setup", { method: "POST", headers: { "X-HCMA": "1", "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", displayName: "Quản trị dự phòng", password: "break-glass-123", setupToken: SETUP }) });
if (setup.status !== 200) throw new Error("mini game setup " + setup.status);

// ---------------------------------------------------------------- browser (Edge + Chrome)
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const registrySrc = readFileSync(path.join(REPO, "mini-game-registry.mjs"), "utf8").split(PROD_MG_ORIGIN).join(MGO);
const TOKENISH = /eyJ[A-Za-z0-9_-]{20,}\.|id_?token=|password=/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mgFetch = async (p, init = {}, cookie = "") => {
  const r = await fetch(MGO + p, { ...init, headers: { "X-HCMA": "1", "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers || {}) } });
  return { status: r.status, data: await r.json().catch(() => null), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
};
async function breakglass() {
  const r = await mgFetch("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "break-glass-123" }) });
  if (r.status !== 200) throw new Error("break-glass login " + r.status);
  return r.cookie;
}

for (const channel of (process.env.SAMETAB_CHANNELS || "msedge,chrome").split(",")) {
  const B = channel === "msedge" ? "Edge" : "Chrome";
  const browser = await chromium.launch({ channel, headless: true });
  const errors = [];
  const urls = [];
  async function newCtx(label, viewport = { width: 1440, height: 900 }) {
    const ctx = await browser.newContext({ viewport, locale: "vi-VN", ignoreHTTPSErrors: true });
    await ctx.route("**/mini-game-registry.mjs*", (r) => r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: registrySrc }));
    ctx.on("request", (r) => urls.push(r.url()));
    ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(label + ": " + e.message)));
    return ctx;
  }
  const mgMe = (p) => p.evaluate(async () => { const j = await (await fetch("/api/me")).json(); return j.user ? { ...j.user, sso: j.sso } : null; });
  async function teachingLogin(p, email) {
    await p.goto(`${TEACHING}/index.html?emulator=1`);
    await p.waitForSelector("#loginEmail", { timeout: 60000 });
    await p.fill("#loginEmail", email); await p.fill("#loginPass", PASS); await p.click("#loginBtn");
  }
  async function shell(p) { await p.waitForSelector(".navlink", { timeout: 60000 }); await p.waitForTimeout(800); }
  async function openCard(p) {
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector('[data-minigame-open="quiz"]', { timeout: 15000 });
    await p.click('[data-minigame-open="quiz"]');
    await p.waitForURL((u) => u.toString().startsWith(MGO + "/") && !u.toString().includes("/sso/"), { timeout: 30000 });
    await p.waitForLoadState("networkidle");
  }
  const onTeaching = (p) => p.url().startsWith(TEACHING);
  try {
    // A. one tab: Teaching -> card -> Mini Game (no dialog click, no second password)
    const ctxA = await newCtx("anh-" + B);
    const p = await ctxA.newPage();
    await teachingLogin(p, people.anh[0]);
    await shell(p);
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector('[data-minigame-open="quiz"]', { timeout: 15000 });
    const card = true;
    const attrs = await p.locator('[data-minigame-open="quiz"]').evaluate((a) => ({ target: a.getAttribute("target"), rel: a.getAttribute("rel") }));
    check(`${B}: Mini Game card has no target (same tab), rel=noreferrer`, card && attrs.target === null && attrs.rel === "noreferrer", JSON.stringify(attrs));
    const hl0 = await p.evaluate(() => history.length);
    await p.click('[data-minigame-open="quiz"]');
    await p.waitForURL((u) => u.toString().startsWith(MGO + "/") && !u.toString().includes("/sso/"), { timeout: 30000 });
    await p.waitForLoadState("networkidle");
    const meA = await mgMe(p);
    check(`${B}: card opens Mini Game IN THE SAME TAB; no new tab; signed in via Teaching without a second password or a dialog click`, ctxA.pages().length === 1 && !!meA && meA.sso?.sso === true && meA.role === "teacher", JSON.stringify({ pages: ctxA.pages().length, role: meA?.role }));
    check(`${B}: final address has no code / state / token`, !/code=|state=|mg_sso|token/i.test(p.url()), p.url());
    const hl1 = await p.evaluate(() => history.length);
    check(`${B}: exactly ONE history entry added (Teaching -> Mini Game; the SSO hops are replaced, not stacked)`, hl1 === hl0 + 1, `${hl0} -> ${hl1}`);
    await p.screenshot({ path: path.join(SHOTS, `${B}-01-same-tab-minigame.png`) });
    check(`${B}: 'Quay về HCMA2 Teaching' button in the Mini Game header`, (await p.locator('[data-testid="back-to-teaching"]').count()) === 1);
    await p.reload(); await p.waitForLoadState("networkidle");
    check(`${B}: reload keeps the Mini Game session (HttpOnly cookie)`, (await mgMe(p))?.id === meA.id);
    const ck = (await ctxA.cookies(MGO)).find((c) => c.name === "hcma_sid");
    check(`${B}: session cookie HttpOnly + Secure + SameSite=Strict, <= 4h`, !!ck && ck.httpOnly && ck.secure && ck.sameSite === "Strict" && ck.expires - Date.now() / 1000 <= 14400 + 60);

    // Back / Forward: no loop
    await p.goBack({ waitUntil: "commit" }); await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 30000 }); await p.waitForTimeout(3500);
    check(`${B}: Back returns to Teaching and STAYS there (no redirect loop); no SSO dialog, no SSO params`, onTeaching(p) && !/mg_sso_/.test(p.url()) && (await p.locator("#mgSsoOverlay:visible").count()) === 0, p.url());
    await p.goForward({ waitUntil: "commit" }); await p.waitForURL((u) => u.toString().startsWith(MGO), { timeout: 30000 }); await p.waitForLoadState("load"); await p.waitForTimeout(1500);
    check(`${B}: Forward returns to Mini Game, still signed in`, p.url().startsWith(MGO) && (await mgMe(p))?.id === meA.id, p.url());

    // Quay ve (no live room) -> Teaching directly, no loop
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 20000 });
    await shell(p); await p.waitForTimeout(2500);
    check(`${B}: 'Quay về HCMA2 Teaching' (no live room) returns to Teaching in the same tab and stays (no loop)`, onTeaching(p) && (await p.locator(".navlink").count()) > 0 && (await p.locator("#mgSsoOverlay:visible").count()) === 0);

    // B. live room: warning, stay, pause-and-leave; game functions intact
    await openCard(p);
    const game = { title: "Cùng tab " + B, description: "", coverImage: null, settings: { defaultTimeSec: 60, speedBonus: true, previewSec: 3, resultSec: 2, leaderboardSec: 0, autoAdvance: false, endWhenAllAnswered: false, soundTheme: "calm", music: false, volume: 50 }, questions: [{ id: "q1", text: "Thủ đô Việt Nam?", image: null, choices: [{ id: "a", text: "Hà Nội" }, { id: "b", text: "Huế" }], correct: ["a"], timeSec: null, points: "standard" }, { id: "q2", text: "1+1?", image: null, choices: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: ["a"], timeSec: null, points: "standard" }] };
    const created = await p.evaluate(async (g) => { const h = { "X-HCMA": "1", "Content-Type": "application/json" }; const gr = await (await fetch("/api/games", { method: "POST", headers: h, body: JSON.stringify(g) })).json(); const rr = await (await fetch("/api/rooms", { method: "POST", headers: h, body: JSON.stringify({ gameId: gr.game.id }) })).json(); return { gameId: gr.game.id, ...rr }; }, game);
    await p.goto(`${MGO}/#/host/${created.roomId}`);
    await p.waitForSelector('[data-testid="pin"]', { timeout: 30000 });
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForSelector('[data-testid="back-warning"]', { timeout: 10000 });
    const warn = await p.locator('[data-testid="back-warning"]').innerText();
    check(`${B}: host screen (lobby): 'Quay về' warns that a room is live (PIN shown) before leaving`, warn.includes(created.pin) && /đang điều khiển phòng/i.test(warn));
    await p.screenshot({ path: path.join(SHOTS, `${B}-02-host-warning.png`) });
    await p.click('[data-testid="back-stay"]');
    check(`${B}: 'Ở lại Mini Game' keeps the host screen`, p.url().startsWith(MGO) && (await p.locator('[data-testid="back-warning"]').count()) === 0 && (await p.locator('[data-testid="pin"]').count()) === 1);
    const ctxS = await newCtx("student-" + B, { width: 390, height: 844 });
    const st = await ctxS.newPage();
    await st.goto(`${MGO}/play/?pin=${created.pin}`);
    await st.fill('[data-testid="nick-input"]', "Học viên A");
    await st.click('[data-testid="join-btn"]');
    await st.getByText("Bạn đã vào phòng!").waitFor({ timeout: 20000 });
    await p.getByTestId("player-count").filter({ hasText: /^1$/ }).waitFor({ timeout: 15000 });
    await p.getByTestId("start").click();
    await st.getByTestId("choice-0").waitFor({ timeout: 20000 });
    await st.getByTestId("choice-0").click();
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForSelector('[data-testid="back-pause-leave"]', { timeout: 10000 });
    await p.click('[data-testid="back-pause-leave"]');
    await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 20000 });
    check(`${B}: playing: 'Tạm dừng rồi quay về' returns to Teaching in the same tab`, onTeaching(p));
    // header (library) with a live room: warning from /api/rooms/active, then leave anyway
    await shell(p);
    await openCard(p);
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForSelector('[data-testid="back-warning"]', { timeout: 10000 });
    check(`${B}: library header: live room detected via the server -> warning`, (await p.locator('[data-testid="back-warning"]').innerText()).includes(created.pin));
    await p.click('[data-testid="back-leave"]');
    await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 20000 });
    // resume and finish the game from Mini Game: rooms, WebSocket, scoring, Top 10, report intact
    await shell(p);
    await openCard(p);
    await p.goto(`${MGO}/#/host/${created.roomId}`);
    const wasPaused = await p.waitForSelector('[data-testid="resume"]', { timeout: 30000 }).then(() => true).catch(() => false);
    check(`${B}: the game stayed PAUSED while the teacher was in Teaching (host sees 'Tiếp tục' on return)`, wasPaused);
    await p.getByTestId("resume").click();
    await p.getByTestId("next").click(); // ket thuc cau 1
    await p.waitForTimeout(1500);
    await p.getByTestId("next").click(); // sang cau 2
    await st.getByTestId("choice-0").waitFor({ timeout: 20000 });
    await st.getByTestId("choice-0").click();
    for (let i = 0; i < 6 && !(await p.getByTestId("podium").count()); i++) { await p.waitForTimeout(1200); if (await p.getByTestId("next").count()) await p.getByTestId("next").click().catch(() => {}); }
    await p.getByTestId("podium").waitFor({ timeout: 30000 });
    const rep = await p.evaluate(async (id) => (await (await fetch(`/api/rooms/${id}/report`)).json()).report.totals, created.roomId);
    const xlsx = await p.evaluate(async (id) => (await fetch(`/api/rooms/${id}/report.xlsx`)).status, created.roomId);
    check(`${B}: game resumed after returning: PIN join, WebSocket, scoring, podium/Top 10, report JSON + Excel`, rep.players === 1 && rep.answers === 2 && rep.correctAnswers === 2 && xlsx === 200, JSON.stringify({ ...rep, xlsx }));
    await ctxS.close();
    // ended room: no warning
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 20000 });
    check(`${B}: ended room: 'Quay về' leaves without a warning`, onTeaching(p));

    // C. Mini Game login button path (no click intent in Teaching): Teaching ASKS for confirmation
    const ctxC = await newCtx("binh-" + B);
    const c1 = await ctxC.newPage();
    await teachingLogin(c1, people.binh[0]); await shell(c1);
    const c2 = await ctxC.newPage();
    await c2.goto(MGO + "/");
    await c2.waitForSelector('[data-testid="sso-login"]', { timeout: 20000 });
    await c2.click('[data-testid="sso-login"]');
    await c2.waitForSelector("#mgSsoOverlay [data-mg-sso='go']", { timeout: 60000 });
    check(`${B}: arriving from the Mini Game login button (no card click in this tab) shows the Teaching confirmation`, onTeaching(c2) && !/mg_sso_/.test(c2.url()));
    await c2.click("[data-mg-sso='go']");
    await c2.waitForURL((u) => u.toString().startsWith(MGO + "/") && !u.toString().includes("/sso/"), { timeout: 30000 });
    check(`${B}: after confirming, Mini Game opens in the same tab, signed in`, (await mgMe(c2))?.sso?.sso === true);

    // D. stale / reused click intent -> confirmation again (one use, 2 minutes)
    await c2.goto(`${TEACHING}/index.html?emulator=1`); await shell(c2);
    await c2.evaluate((o) => sessionStorage.setItem("hcma2.miniGameSsoIntent", JSON.stringify({ origin: o, at: Date.now() - 10 * 60_000 })), MGO);
    await c2.goto(MGO + "/sso/begin");
    await c2.waitForSelector("#mgSsoOverlay [data-mg-sso='go']", { timeout: 60000 });
    const left = await c2.evaluate(() => sessionStorage.getItem("hcma2.miniGameSsoIntent"));
    check(`${B}: a stale click intent (10 min old) is NOT accepted: confirmation shown, intent erased`, left === null);
    await c2.click("[data-mg-sso='cancel']");
    check(`${B}: cancel keeps the user on Teaching`, onTeaching(c2) && (await c2.locator("#mgSsoOverlay").count()) === 0);

    // E. not signed in to Teaching: login screen first, then confirmation (never auto)
    const ctxE = await newCtx("anon-" + B);
    const e1 = await ctxE.newPage();
    await e1.goto(MGO + "/sso/begin");
    await e1.waitForSelector("#loginEmail", { timeout: 60000 });
    check(`${B}: not signed in to Teaching: /sso/begin shows the Teaching login (no dialog, no Mini Game session)`, onTeaching(e1) && (await e1.locator("#mgSsoOverlay").count()) === 0);
    await e1.fill("#loginEmail", people.binh[0]); await e1.fill("#loginPass", PASS); await e1.click("#loginBtn");
    await e1.waitForSelector("#mgSsoOverlay [data-mg-sso='go']", { timeout: 60000 });
    await e1.click("[data-mg-sso='go']");
    await e1.waitForURL((u) => u.toString().startsWith(MGO + "/") && !u.toString().includes("/sso/"), { timeout: 30000 });
    check(`${B}: after Teaching login + confirmation -> Mini Game in the same tab`, (await mgMe(e1))?.sso?.sso === true);

    // F. account locked in Mini Game: SSO refused, page offers the way back to Teaching (no loop)
    const bg = await breakglass();
    await mgFetch(`/api/users/${meA.id}/disabled`, { method: "POST", body: JSON.stringify({ disabled: true }) }, bg);
    await p.click('#sidebarNav .navlink[data-nav="minigames"]').catch(() => {});
    await shell(p);
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector('[data-minigame-open="quiz"]', { timeout: 15000 });
    await p.click('[data-minigame-open="quiz"]');
    await p.waitForURL((u) => u.toString().startsWith(MGO + "/sso/callback"), { timeout: 30000 });
    const locked = await p.locator("body").innerText();
    const lockedMe = await p.evaluate(async () => (await (await fetch("/api/me")).json()).user);
    check(`${B}: Mini Game-locked account: SSO refused (no session), page links back to Teaching`, /khoá/.test(locked) && lockedMe === null && (await p.locator(`a[href="${TEACHING}/"]`).count()) === 1);
    await p.screenshot({ path: path.join(SHOTS, `${B}-03-locked.png`) });
    await p.click(`a[href="${TEACHING}/"]`);
    await shell(p); await p.waitForTimeout(2500);
    check(`${B}: locked -> back to Teaching stays on Teaching (no loop)`, onTeaching(p));
    await mgFetch(`/api/users/${meA.id}/disabled`, { method: "POST", body: JSON.stringify({ disabled: false }) }, bg);

    // G. Teaching pending / suspended: no shell, no dialog, no Mini Game session
    for (const who of ["cho", "khoa"]) {
      const ctxG = await newCtx(who + "-" + B);
      const g1 = await ctxG.newPage();
      await teachingLogin(g1, people[who][0]);
      await g1.waitForTimeout(3000);
      await g1.goto(MGO + "/sso/begin");
      await g1.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 30000 });
      await g1.waitForTimeout(3500);
      const s = { overlayGo: await g1.locator("[data-mg-sso='go']").count(), nav: await g1.locator(".navlink").count() };
      await g1.goto(MGO + "/");
      check(`${B}: Teaching ${people[who][2]} account: no menu, no confirmation, no Mini Game session`, s.overlayGo === 0 && s.nav === 0 && (await mgMe(g1)) === null, JSON.stringify(s));
      await ctxG.close();
    }

    // H. Teaching sign-out still revokes the Mini Game session (same tab)
    await openCard(p);
    const before = await mgMe(p);
    await p.click('[data-testid="back-to-teaching"]');
    await p.waitForURL((u) => u.toString().startsWith(TEACHING), { timeout: 20000 });
    await shell(p);
    await p.waitForTimeout(1500);
    await p.click("#btnLogoutTop");
    await p.waitForSelector("#loginEmail", { timeout: 30000 });
    const chk = await ctxA.newPage();
    await chk.goto(MGO + "/");
    let after = "x";
    for (let i = 0; i < 20 && after !== null; i++) { await chk.waitForTimeout(300); after = await mgMe(chk); }
    check(`${B}: Teaching sign-out (after returning in the same tab) revokes the Mini Game session`, !!before && after === null);

    // I. no ID token / password ever in a URL
    check(`${B}: no Firebase ID token or password in any URL`, !urls.some((u) => TOKENISH.test(u)));
    check(`${B}: no JavaScript page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check(`${B}: unexpected failure`, false, String(e?.message || e).slice(0, 500) + " | MG log: " + mgLog.slice(-300));
  } finally {
    await browser.close();
  }
}
stopAll();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(SHOTS, "sametab-e2e-results.json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
console.log(`\nMINI GAME SAME-TAB R1 E2E: ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}  (screenshots: ${SHOTS})`);
process.exit(failed.length ? 1 : 0);
