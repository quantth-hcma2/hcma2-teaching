// MINI GAME SSO R1 - scope / safety guard (pure). Relative to the production release c2a978f (Mini Game tab R1) the slice ADDS the
// SSO module + its tests, changes the registry card url/note, makes three pinned index.html edits, and aligns earlier guards.
// NO Rules, index, Storage, Auth, dependency, data or schema change; every other production file is byte-identical to c2a978f.
// Run: node --test test/minigame-sso-r1/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_SSO, reverseSsoIndexEdits, SSO_HOOK } from "./sso-edits.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "c2a978f4eeeb5108481e4a67ad8f99fd00b586ac";   // production web release (origin/main) = Mini Game tab R1
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, p) => execFileSync("git", ["show", rev + ":" + p], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const code = (p) => text(p).replace(/\/\/.*$/gm, "");
const ADDED_OK = [/^mini-game-sso\.mjs$/, /^test\/minigame-sso-r1\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "index.html", "mini-game-registry.mjs",                                                                     // the slice's own edits
  "test/minigame-r1/minigame-edits.mjs", "test/minigame-r1/source-guard.test.mjs", "test/minigame-r1/registry.unit.test.mjs", "test/minigame-r1/ui.e2e.mjs",
  "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p4-s4/source-guard.test.mjs", "test/library-v2-p4-s5/source-guard.test.mjs", "test/library-v2-p2-s2/source-guard.test.mjs"
]);

test("SCOPE: relative to c2a978f only the SSO module and its tests are added; only the approved files change (no deletion / rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  for (const [status, p] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(p)), "added outside the allow-list: " + p);
    else if (status === "M") assert.ok(MODIFIED_OK.has(p), "modified outside the allow-list: " + p);
    else assert.fail("only additions and approved modifications: " + status + " " + p);
  }
  assert.ok(all.some(([, p]) => p === "mini-game-sso.mjs"));
});

test("PINS: Firestore Rules, indexes, package, app-environment (auth/emulator gate) and every other production file are byte-identical to c2a978f", () => {
  const files = git("ls-tree", "-r", "--name-only", BASE).split("\n").filter((p) => p && !p.startsWith("test/") && p !== "index.html" && p !== "mini-game-registry.mjs");
  assert.ok(files.length > 50);
  for (const f of files) assert.equal(sha(readFileSync(root + f)), sha(gitBuf(BASE, f)), f + " unchanged");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f));
});

test("EDITS: index.html = c2a978f + EXACTLY the three pinned SSO edits (reversal restores the bytes); the hook runs once per shell, after the menu", () => {
  assert.equal(INDEX_EDITS_SSO.length, 3);
  const html = text("index.html");
  assert.equal(sha(Buffer.from(reverseSsoIndexEdits(html), "utf8")), sha(gitBuf(BASE, "index.html")));
  assert.equal(html.split(SSO_HOOK).length - 1, 2);
  assert.ok(html.indexOf(SSO_HOOK) > html.indexOf("function renderAdminShell(") && html.lastIndexOf(SSO_HOOK) > html.indexOf("function renderTeacherShell("));
  // pending / suspended / invalid-role accounts never reach a shell, so they never reach the hook (account gate unchanged)
  const seg = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
  const base = gitBuf(BASE, "index.html").toString("utf8");
  assert.equal(seg(html, 'if(p.status === "suspended"){', 'if(p.role === "teacher") return renderTeacherShell();'), seg(base, 'if(p.status === "suspended"){', 'if(p.role === "teacher") return renderTeacherShell();'));
});

test("REGISTRY: only the quiz card url (-> /sso/begin on the SAME allow-listed origin) and its sign-in note changed", () => {
  const diff = git("diff", "-U0", "--no-color", BASE, "--", "mini-game-registry.mjs").split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  assert.deepEqual(diff.filter((l) => l.startsWith("-")).map((l) => l.trim()), [
    '-    url: "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/",',
    '-      "Giảng viên đăng nhập bằng tài khoản Mini Game riêng do quản trị Mini Game cấp — không dùng tài khoản HCMA2 Teaching.",'
  ].map((l) => l.trim()));
  assert.ok(text("mini-game-registry.mjs").includes('url: "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/sso/begin"'));
  assert.ok(text("mini-game-registry.mjs").includes('export const MINI_GAME_ALLOWED_ORIGINS = freeze(["https://hcma2-interactive.hcma2-interactive-v1.workers.dev"]);'), "allow-list unchanged");
});

test("SSO MODULE: imports only the registry; no Firestore / storage / cookies; the ID token goes ONLY in an Authorization header to <allow-listed origin>/api/sso/issue with credentials omitted", () => {
  const src = code("mini-game-sso.mjs");
  const imports = [...src.matchAll(/^\s*import\s[^;]*from\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./mini-game-registry.mjs?v=20261113-sso-r1"]);
  assert.ok(!/\bimport\s*\(/.test(src));
  for (const re of [/firestore|setDoc|addDoc|updateDoc|deleteDoc|getDoc/i, /localStorage|sessionStorage|indexedDB|document\.cookie/, /postMessage|window\.open|<iframe/i, /XMLHttpRequest|WebSocket|sendBeacon/])
    assert.ok(!re.test(src), "forbidden pattern: " + re);
  assert.ok(src.includes('readMiniGameSsoRequest(location.search)') && src.includes('allowedOrigins.includes(returnOrigin)'), "return origin is checked against the allow-list");
  assert.ok(src.includes('req.returnOrigin + "/api/sso/issue"') && src.includes('Authorization: "Bearer " + token') && src.includes('credentials: "omit"'));
  assert.equal(src.split("fetchImpl(").length - 1, 2, "exactly two network calls: issue (consent) and signout (OD01)");
  assert.ok(src.includes('origin + "/api/sso/signout"') && src.includes("for (const origin of origins)") && src.includes("deps.allowedOrigins || MINI_GAME_ALLOWED_ORIGINS"), "signout only to allow-listed origins");
  assert.equal((src.match(/credentials: "omit"/g) || []).length, 2, "no cookies on either call");
  assert.ok(!/searchParams\.set\("(token|id_token|idToken)"/.test(src), "the ID token is never put in a URL");
  assert.ok(src.includes('target.searchParams.set("code", data.code)') && src.includes('target.searchParams.set("state", req.state)'));
});
