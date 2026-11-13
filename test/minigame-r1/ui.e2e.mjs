// MINI GAME TAB R1 - browser end-to-end (EMULATOR ONLY, synthetic accounts) + before/after screenshots.
// Serves TWO static trees on 127.0.0.1: "before" = the production web release ce89869 (git archive) and "after" = this working tree,
// both talking only to the LOCAL Auth/Firestore emulators (project demo-hcma2-production-prep, live Rules bytes). The Mini Game
// origin is intercepted by the browser (a stub page), so the test never contacts the real Mini Game or any production service.
// Run: node test/minigame-r1/ui.e2e.mjs      Needs: firebase CLI, Java 21+, Playwright (PLAYWRIGHT_PACKAGE or "playwright"), ports 8080/9099 free.
// Optional: MINIGAME_SHOTS=<dir> (default test-results-minigame-r1 inside the system temp dir).
import { spawn, execSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_REV = "ce898696034cd1f9f9ec4904cb569f1c4f822bd5";
const PROJECT = "demo-hcma2-production-prep";
const MINIGAME_ORIGIN = "https://hcma2-interactive.hcma2-interactive-v1.workers.dev";
const SHOTS = process.env.MINIGAME_SHOTS || path.join(os.tmpdir(), "test-results-minigame-r1");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE || "playwright");

function ensureJava() {
  const major = () => { try { const m = /version "(\d+)/.exec(execSync("java -version 2>&1", { encoding: "utf8" })); return m ? Number(m[1]) : 0; } catch { return 0; } };
  if (major() >= 21) return;
  const base = "C:\\Program Files\\Eclipse Adoptium";
  if (existsSync(base)) { const dir = readdirSync(base).filter((n) => /^(jre|jdk)-?2\d/.test(n)).sort().pop(); if (dir) { process.env.JAVA_HOME = path.join(base, dir); process.env.PATH = path.join(base, dir, "bin") + path.delimiter + process.env.PATH; } }
  if (major() < 21) throw new Error("Java 21+ required for the Firestore emulator");
}
ensureJava();
for (const name of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN"]) delete process.env[name];

// ---------------------------------------------------------------- trees: before (ce89869) and after (working tree)
const beforeDir = mkdtempSync(path.join(os.tmpdir(), "hcma2-minigame-before-"));
execFileSync("git", ["archive", "--format=tar", "-o", path.join(beforeDir, "t.tar"), BASE_REV], { cwd: REPO });
execFileSync("tar", ["-xf", "t.tar"], { cwd: beforeDir }); // relative path: GNU tar reads "C:..." as a remote host

// ---------------------------------------------------------------- emulators (live Rules bytes)
const work = mkdtempSync(path.join(os.tmpdir(), "hcma2-minigame-emu-"));
writeFileSync(path.join(work, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { host: "127.0.0.1", port: 9099 }, firestore: { host: "127.0.0.1", port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }));
copyFileSync(path.join(REPO, "firestore.rules.production-candidate"), path.join(work, "firestore.rules"));
const busy = async (u) => { try { await fetch(u); return true; } catch { return false; } };
if (await busy("http://127.0.0.1:8080/") || await busy("http://127.0.0.1:9099/")) throw new Error("ports 8080/9099 busy");
const emu = spawn(process.platform === "win32" ? "firebase.cmd" : "firebase", ["emulators:start", "--only", "auth,firestore", "--project", PROJECT, "--config", path.join(work, "firebase.json")], { cwd: work, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
let emuLog = ""; emu.stdout.on("data", (d) => (emuLog += d)); emu.stderr.on("data", (d) => (emuLog += d));
const servers = [];
const stopAll = () => { for (const s of servers) try { s.close(); } catch { /* ignore */ } try { if (process.platform === "win32") execSync(`taskkill /pid ${emu.pid} /T /F`, { stdio: "ignore" }); else emu.kill("SIGTERM"); } catch { /* ignore */ } };
process.on("exit", stopAll);
async function waitFor(url) { for (let i = 0; i < 160; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("emulator did not start: " + emuLog.slice(-1500)); }
await waitFor("http://127.0.0.1:8080/"); await waitFor("http://127.0.0.1:9099/");

const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const enc = (v) => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) });
const put = async (p, data) => { const r = await fetch(`${FS}/${p}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) }); if (!r.ok) throw new Error("seed " + p + " " + r.status); };
async function signUp(email, password) { const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error("signUp " + JSON.stringify(j)); return { uid: j.localId }; }
const PASS = "QA-" + randomBytes(6).toString("hex") + "-A1";
const ADMIN = "quan.tri.qa@example.test", TEACHER = "giang.vien.qa@example.test", PENDING = "cho.duyet.qa@example.test";
const admin = await signUp(ADMIN, PASS), teacher = await signUp(TEACHER, PASS), pending = await signUp(PENDING, PASS);
const D = new Date(Date.UTC(2026, 10, 1));
await put(`users/${admin.uid}`, { uid: admin.uid, role: "admin", status: "active", displayName: "Quản trị hệ thống (QA)", email: ADMIN, approvedBy: null, approvedAt: null, createdAt: D });
await put(`users/${teacher.uid}`, { uid: teacher.uid, role: "teacher", status: "active", displayName: "Giảng viên (QA)", email: TEACHER, approvedBy: null, approvedAt: null, createdAt: D });
await put(`users/${pending.uid}`, { uid: pending.uid, role: "teacher", status: "pending", displayName: "Giảng viên chờ duyệt (QA)", email: PENDING, approvedBy: null, approvedAt: null, createdAt: D });

// ---------------------------------------------------------------- static servers (loopback only, ?emulator=1 enforced)
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".ttf": "font/ttf" };
async function serve(root) {
  const s = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/" || (url.pathname === "/index.html" && url.searchParams.get("emulator") !== "1")) { res.writeHead(302, { location: "/index.html?emulator=1" }); return res.end(); }
    const p = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (!p.startsWith(root) || !existsSync(p) || /[\\/]\.git[\\/]|[\\/]node_modules[\\/]/.test(p)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p));
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}
const BEFORE = await serve(beforeDir), AFTER = await serve(REPO);

// ---------------------------------------------------------------- checks
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
async function newPage(base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  // the Mini Game origin is served by a stub so the test never reaches the real application
  await ctx.route(MINIGAME_ORIGIN + "/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><title>MINIGAME-STUB</title><body><p id="stub">stub</p><script>document.getElementById("stub").textContent=JSON.stringify({opener:window.opener===null?"null":"present",referrer:document.referrer})</script></body>` }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(base + " " + e.message));
  return { ctx, p };
}
async function login(p, base, email) {
  await p.goto(`${base}/index.html?emulator=1`);
  await p.waitForSelector("#loginEmail", { timeout: 60000 });
  await p.fill("#loginEmail", email); await p.fill("#loginPass", PASS); await p.click("#loginBtn");
}
const menuLabels = (p) => p.$$eval("#sidebarNav .navlink", (els) => els.map((e) => e.textContent.trim()));

try {
  // BEFORE (production ce89869): teacher + admin menus, no Mini Game
  for (const [who, email] of [["teacher", TEACHER], ["admin", ADMIN]]) {
    const { ctx, p } = await newPage(BEFORE);
    await login(p, BEFORE, email);
    await p.waitForSelector(".navlink", { timeout: 60000 });
    await p.waitForTimeout(1200);
    const labels = await menuLabels(p);
    check(`BEFORE ${who}: production menu has no Mini Game`, !labels.some((l) => /Mini Game/.test(l)), labels.join(" | "));
    await p.screenshot({ path: path.join(SHOTS, `before-${who}-menu.png`) });
    await ctx.close();
  }

  // AFTER: teacher
  {
    const { ctx, p } = await newPage(AFTER);
    await login(p, AFTER, TEACHER);
    await p.waitForSelector(".navlink", { timeout: 60000 });
    await p.waitForTimeout(1200);
    const labels = await menuLabels(p);
    const gi = labels.findIndex((l) => /Thảo luận nhóm/.test(l)), mi = labels.findIndex((l) => /Mini Game/.test(l));
    check("AFTER teacher: menu shows exactly one Mini Game entry, right after Thảo luận nhóm", labels.filter((l) => /Mini Game/.test(l)).length === 1 && mi === gi + 1, labels.join(" | "));
    await p.screenshot({ path: path.join(SHOTS, "after-teacher-menu.png") });
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector("[data-minigame-hub]", { timeout: 10000 });
    const active = await p.$eval('#sidebarNav .navlink.active', (e) => e.dataset.nav);
    check("AFTER teacher: clicking Mini Game opens the hub and marks the menu entry active", active === "minigames");
    const card = p.locator('[data-minigame-open="quiz"]');
    const attrs = await card.evaluate((a) => ({ tag: a.tagName, href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), rp: a.getAttribute("referrerpolicy") }));
    check("AFTER teacher: Trắc nghiệm tương tác card is a plain link to the Mini Game, new tab, noopener noreferrer", attrs.tag === "A" && attrs.href === MINIGAME_ORIGIN + "/" && attrs.target === "_blank" && /noopener/.test(attrs.rel) && /noreferrer/.test(attrs.rel) && attrs.rp === "no-referrer", JSON.stringify(attrs));
    check("AFTER teacher: no iframe anywhere on the page", (await p.locator("iframe").count()) === 0);
    const hubText = await p.locator("#mainContent").innerText();
    check("AFTER teacher: hub explains new tab, separate Mini Game account and PIN/QR for students", /tab mới/.test(hubText) && /tài khoản Mini Game riêng/.test(hubText) && /PIN/.test(hubText));
    await p.screenshot({ path: path.join(SHOTS, "after-teacher-minigame-hub.png") });
    const [popup] = await Promise.all([ctx.waitForEvent("page"), card.click()]);
    await popup.waitForLoadState();
    const stub = JSON.parse(await popup.locator("#stub").innerText());
    check("AFTER teacher: card opens the Mini Game in a NEW tab without opener or referrer; the Teaching tab stays put", popup.url() === MINIGAME_ORIGIN + "/" && stub.opener === "null" && stub.referrer === "" && p.url().startsWith(AFTER), JSON.stringify({ url: popup.url(), ...stub }));
    check("AFTER teacher: nothing about the Teaching user is put in the Mini Game URL", !/[?#]/.test(popup.url()));
    await popup.close();
    // other navigation still works (regression): Thảo luận nhóm and THƯ VIỆN
    await p.click('#sidebarNav .navlink[data-nav="library"]');
    await p.waitForFunction(() => /THƯ VIỆN/.test(document.querySelector("#mainContent")?.innerText || ""), null, { timeout: 15000 });
    check("AFTER teacher: THƯ VIỆN still opens", true);
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector("[data-minigame-hub]", { timeout: 10000 });
    check("AFTER teacher: returning to Mini Game re-renders the hub", true);
    // narrow (phone) layout
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, "after-teacher-minigame-hub-mobile.png") });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("AFTER teacher (390px): hub fits without horizontal scrolling", overflow <= 1, "overflow " + overflow + "px");
    await ctx.close();
  }

  // AFTER: admin
  {
    const { ctx, p } = await newPage(AFTER);
    await login(p, AFTER, ADMIN);
    await p.waitForSelector(".navlink", { timeout: 60000 });
    await p.waitForTimeout(1500);
    const labels = await menuLabels(p);
    const gi = labels.findIndex((l) => /Thảo luận nhóm/.test(l)), mi = labels.findIndex((l) => /Mini Game/.test(l));
    check("AFTER admin: menu shows Mini Game right after Thảo luận nhóm", mi === gi + 1 && mi > 0, labels.join(" | "));
    await p.screenshot({ path: path.join(SHOTS, "after-admin-menu.png") });
    await p.click('#sidebarNav .navlink[data-nav="minigames"]');
    await p.waitForSelector('[data-minigame-open="quiz"]', { timeout: 10000 });
    check("AFTER admin: hub opens with the quiz card", true);
    await ctx.close();
  }

  // AFTER: a PENDING teacher gets no shell (and therefore no Mini Game) - unchanged gate
  {
    const { ctx, p } = await newPage(AFTER);
    await login(p, AFTER, PENDING);
    await p.waitForTimeout(4000);
    const navCount = await p.locator(".navlink").count();
    const txt = await p.locator("body").innerText();
    check("AFTER pending teacher: no menu, no Mini Game (account gate unchanged)", navCount === 0 && !/Mini Game/.test(txt), "navlinks " + navCount);
    await p.screenshot({ path: path.join(SHOTS, "after-pending-teacher.png") });
    await ctx.close();
  }

  // AFTER: anonymous visitor (not signed in) sees no Mini Game
  {
    const { ctx, p } = await newPage(AFTER);
    await p.goto(`${AFTER}/index.html?emulator=1`);
    await p.waitForSelector("#loginEmail", { timeout: 60000 });
    check("AFTER anonymous: login screen shows no Mini Game", !/Mini Game/.test(await p.locator("body").innerText()));
    await ctx.close();
  }
  check("no JavaScript page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("unexpected failure", false, String(e?.message || e).slice(0, 400));
} finally {
  await browser.close();
  stopAll();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(SHOTS, "ui-e2e-results.json"), JSON.stringify({ date: new Date().toISOString(), base: BASE_REV, results }, null, 2));
console.log(`\nMINI GAME R1 UI E2E: ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}  (screenshots: ${SHOTS})`);
process.exit(failed.length ? 1 : 0);
