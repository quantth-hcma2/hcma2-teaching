// MINI GAME TAB R1 - scope / safety guard (pure). The slice adds ONE pure module (mini-game-registry.mjs), five additive lines in
// index.html (import, two menu entries, two route lines), its own tests, and aligns three earlier SCOPE guards + the P4-S5 reversal.
// NO Rules, index, Storage, Auth, dependency, data or schema change; every other production file is byte-identical to the web release ce89869.
// Run: node --test test/minigame-r1/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_MINIGAME, reverseMiniGameIndexEdits, applyMiniGameIndexEdits, MINIGAME_IMPORT, MINIGAME_MENU_ENTRY } from "./minigame-edits.mjs";
import { reverseSsoIndexEdits } from "../minigame-sso-r1/sso-edits.mjs";   // MINI GAME SSO R1 aligned

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "ce898696034cd1f9f9ec4904cb569f1c4f822bd5";   // production web release (origin/main) = the approved baseline of this slice
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, p) => execFileSync("git", ["show", rev + ":" + p], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const ADDED_OK = [/^mini-game-registry\.mjs$/, /^test\/minigame-r1\/[A-Za-z0-9._-]+$/, /^mini-game-sso\.mjs$/, /^test\/minigame-sso-r1\/[A-Za-z0-9._-]+$/];   // MINI GAME SSO R1 aligned
const MODIFIED_OK = new Set([
  "index.html",                                                                                   // the slice's own five additive lines
  "test/library-v2-p4-s5/p4s5-edits.mjs",                                                         // chain: Mini Game reversal applied first
  "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p4-s4/source-guard.test.mjs", "test/library-v2-p4-s5/source-guard.test.mjs",   // earlier SCOPE guards aligned
  "test/library-v2-p2-s2/source-guard.test.mjs", "test/onboarding-o2/source-guard.test.mjs"                                                     // root-module list / menu pins aligned
]);

test("SCOPE: relative to the production release ce89869 the tree only ADDS the Mini Game registry and its tests, and modifies ONLY the approved files (no deletion or rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  for (const [status, p] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(p)), "added outside the allow-list: " + p);
    else if (status === "M") assert.ok(MODIFIED_OK.has(p), "modified outside the allow-list: " + p);
    else assert.fail("only additions and approved modifications are allowed: " + status + " " + p);
  }
  assert.ok(all.some(([, p]) => p === "mini-game-registry.mjs"));
});

test("PINS: Firestore Rules, indexes, legacy rules, package manifest, app-environment (auth/emulator gate), vendor and all other modules are byte-identical to ce89869; no Storage/firebase.json/CORS file", () => {
  const files = git("ls-tree", "-r", "--name-only", BASE).split("\n").filter((p) => p && !p.startsWith("test/") && p !== "index.html");
  assert.ok(files.length > 50);
  for (const f of files) assert.equal(sha(readFileSync(root + f)), sha(gitBuf(BASE, f)), f + " unchanged");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f), f + " must not exist at the repository root");
});

test("EDITS: index.html differs from ce89869 by EXACTLY five additive lines; reversing them restores the ce89869 bytes", () => {
  assert.equal(INDEX_EDITS_MINIGAME.length, 5);
  const html = text("index.html");
  assert.equal(sha(Buffer.from(reverseMiniGameIndexEdits(html), "utf8")), sha(gitBuf(BASE, "index.html")));
  // MINI GAME SSO R1 aligned: after reversing the later SSO edits, index.html is EXACTLY ce89869 + these five additive lines
  const base = gitBuf(BASE, "index.html").toString("utf8");
  assert.equal(reverseSsoIndexEdits(html), applyMiniGameIndexEdits(base));
  const added = reverseSsoIndexEdits(html).split(String.fromCharCode(10)).map((l) => l.replace(/\r$/, "")).filter((l) => !base.split(String.fromCharCode(10)).map((x) => x.replace(/\r$/, "")).includes(l));
  assert.deepEqual(added, [MINIGAME_IMPORT, "  " + MINIGAME_MENU_ENTRY, '  if(key==="minigames") return mountMiniGameHub(c, esc);', "  " + MINIGAME_MENU_ENTRY, '  if(key==="minigames") return mountMiniGameHub(c, esc);']);
});

test("NAVIGATION: Mini Game sits right after Thảo luận nhóm in BOTH the teacher and the admin menu; all other entries keep their order; both routes mount the hub", () => {
  const html = text("index.html");
  const block = (start) => html.slice(html.indexOf(start), html.indexOf("];", html.indexOf(start)));
  const keys = (b) => [...b.matchAll(/\{key:([^,]+),/g)].map((m) => m[1]);
  const base = gitBuf(BASE, "index.html").toString("utf8");
  const baseBlock = (start) => base.slice(base.indexOf(start), base.indexOf("];", base.indexOf(start)));
  for (const start of ["const TEACHER_MENU = [", "const ADMIN_MENU = ["]) {
    const now = keys(block(start)), before = keys(baseBlock(start));
    const gi = now.indexOf('"groups"');
    assert.equal(now[gi + 1], '"minigames"', start);
    assert.deepEqual(now.filter((k) => k !== '"minigames"'), before, start + " other entries unchanged");
  }
  assert.equal(html.split('if(key==="minigames") return mountMiniGameHub(c, esc);').length - 1, 2);
  assert.ok(html.indexOf('if(key==="minigames")') > html.indexOf("function adminRoute(key)") && html.lastIndexOf('if(key==="minigames")') > html.indexOf("function teacherRoute()"));
});

test("MODULE HYGIENE: mini-game-registry.mjs imports nothing and uses no Firebase, Auth, storage, network, iframe, postMessage, window.open or user data", () => {
  const src = text("mini-game-registry.mjs");
  const code = src.replace(/\/\/.*$/gm, "");
  assert.ok(!/^\s*import\s/m.test(code) && !/\bimport\s*\(/.test(code), "no imports");
  for (const re of [/firebase|firestore|getAuth|auth\./i, /localStorage|sessionStorage|indexedDB|document\.cookie/, /\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/, /<iframe|postMessage|window\.open/i, /STATE|uid|email|token|idToken/])
    assert.ok(!re.test(code), "forbidden pattern in module: " + re);
  assert.ok(text("index.html").split("<iframe").length - 1 === gitBuf(BASE, "index.html").toString("utf8").split("<iframe").length - 1, "index.html gains no iframe");
});

test("ACCESS: the hub is reachable only from the active admin/teacher shells; the account gate, the student flow and the login screen are unchanged", () => {
  const html = text("index.html"), base = gitBuf(BASE, "index.html").toString("utf8");
  const seg = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
  for (const [a, b] of [["function studentShellHtml(", "function studentBodyError("], ['if(p.status === "suspended"){', 'if(p.role === "teacher") return renderTeacherShell();']])
    assert.equal(seg(html, a, b), seg(base, a, b), "unchanged: " + a);
  assert.equal(html.split("mountMiniGameHub(").length - 1, 2, "mounted only from the two shell routers");
});
