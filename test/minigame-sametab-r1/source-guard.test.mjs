// MINI GAME SAME-TAB R1 - scope / safety guard (pure). Relative to the released SSO commit adcfe7f the slice changes ONLY the Mini Game
// registry (card opens in the same tab) and the SSO module (one-use click intent), adds its own tests and aligns four earlier tests.
// index.html, Firestore Rules / indexes, package files and every other production file stay byte-identical.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..") + path.sep;
const BASE = "adcfe7f7defa9d593ace668068afcd67a0b1d389";   // production web release (origin/main) = Mini Game SSO R1 + OD01
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, p) => execFileSync("git", ["show", rev + ":" + p], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const code = (p) => text(p).replace(/\/\/.*$/gm, "");
const ADDED_OK = [/^test\/minigame-sametab-r1\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "mini-game-registry.mjs", "mini-game-sso.mjs",                                                                 // the slice's own edits
  "test/minigame-r1/registry.unit.test.mjs", "test/minigame-r1/source-guard.test.mjs", "test/minigame-r1/ui.e2e.mjs",  // aligned
  "test/minigame-sso-r1/source-guard.test.mjs", "test/minigame-sso-r1/sso.e2e.mjs",                              // aligned
  "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p4-s4/source-guard.test.mjs", "test/library-v2-p4-s5/source-guard.test.mjs"   // aligned
]);

test("SCOPE: relative to adcfe7f only the approved files change; only this slice's tests are added (no deletion / rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  for (const [status, p] of [...changed, ...untracked]) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(p)), "added outside the allow-list: " + p);
    else if (status === "M") assert.ok(MODIFIED_OK.has(p), "modified outside the allow-list: " + p);
    else assert.fail("only additions and approved modifications: " + status + " " + p);
  }
});

test("PINS: index.html, Firestore Rules, indexes, package and every other tracked production file are byte-identical to adcfe7f", () => {
  const files = git("ls-tree", "-r", "--name-only", BASE).split("\n").filter((f) => f && !f.startsWith("test/") && !MODIFIED_OK.has(f));
  assert.ok(files.length > 50 && files.includes("index.html") && files.some((f) => /^firestore\.rules/.test(f)));
  for (const f of files) assert.equal(sha(readFileSync(root + f)), sha(gitBuf(BASE, f)), f + " unchanged");
});

test("REGISTRY: only the card markup and wording change (same tab, rel=noreferrer); url and allow-list unchanged", () => {
  const src = text("mini-game-registry.mjs");
  assert.ok(src.includes('url: "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/sso/begin"'));
  assert.ok(src.includes('export const MINI_GAME_ALLOWED_ORIGINS = freeze(["https://hcma2-interactive.hcma2-interactive-v1.workers.dev"]);'));
  const c = code("mini-game-registry.mjs");
  assert.ok(!/target=|_blank|window\.open|<iframe|\bimport\b|fetch\(|sessionStorage|localStorage/.test(c));
  assert.ok(c.includes('rel="noreferrer" referrerpolicy="no-referrer"'));
});

test("SSO MODULE: storage used ONLY for the one-use click intent {origin, at}; still exactly two network calls with credentials omitted; no token in any URL", () => {
  const src = code("mini-game-sso.mjs");
  assert.equal((src.match(/sessionStorage/g) || []).length, 1, "single access point (safeStorage)");
  assert.ok(!/localStorage|indexedDB|document\.cookie|postMessage|window\.open|<iframe|XMLHttpRequest|WebSocket|sendBeacon/i.test(src));
  assert.equal((src.match(/\.setItem\(/g) || []).length, 1);
  assert.ok(src.includes("storage.setItem(INTENT_KEY, JSON.stringify({ origin, at: nowMs }))"), "the intent holds only origin + time");
  assert.ok(src.includes("storage.removeItem(INTENT_KEY)") && src.includes("nowMs - v.at <= INTENT_TTL_MS"));
  assert.ok(/export const INTENT_TTL_MS = 120_000;/.test(src));
  assert.ok(src.includes("const clicked = takeMiniGameIntent(sameTab.storage, req.returnOrigin) && !req.invalid;"), "intent consumed on every SSO arrival");
  assert.ok(src.indexOf("if (!eligible(deps.profile))") < src.indexOf("if (clicked) void run();"), "eligibility checked before any automatic request");
  assert.equal(src.split("fetchImpl(").length - 1, 2);
  assert.equal((src.match(/credentials: "omit"/g) || []).length, 2);
  assert.ok(src.includes("location.replace(target.toString())"), "SSO hop replaced in history (Back goes to Teaching, no loop)");
  assert.ok(!/searchParams\.set\("(token|id_token|idToken)"/.test(src));
});
