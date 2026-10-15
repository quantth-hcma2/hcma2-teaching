// LIBRARY V2 P4-S5 (Gate D0-F1, TEST-ONLY) - negative evidence for the P4-S4 "HISTORICAL TESTS" guard.
// The guard now ignores the slice's own NEW tests under test/library-v2-p4-s5/ (they are not earlier-slice tests). This file proves the guard is NOT weakened:
// it still rejects an unauthorized change of an earlier-slice test, an oversized change of an aligned guard and a new test file of any other (later) slice.
// Everything happens in a throw-away clone in the OS temp folder (git clone --shared: objects are only READ from this repository); this repository is never modified.
// Run: node --test test/library-v2-p4-s5/historical-guard.negative.test.mjs
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const GUARD = "test/library-v2-p4-s4/source-guard.test.mjs";
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let tmp, repo;

// fresh throw-away tree = the committed HEAD of this repository + the CURRENT working-tree copy of the guard under test (so an uncommitted fix is what gets proven)
const fresh = () => { git(repo, "reset", "-q", "--hard", "HEAD"); git(repo, "clean", "-fdq"); copyFileSync(join(root, GUARD), join(repo, GUARD)); };
const runGuard = () => { const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern=HISTORICAL TESTS", GUARD], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_TEST_CONTEXT: undefined } }); const out = (r.stdout || "") + (r.stderr || "");
  const num = (k) => Number((new RegExp("^# " + k + " (\\d+)", "m").exec(out) || [])[1]); return { status: r.status, out, pass: num("pass"), fail: num("fail") }; };

before(() => { tmp = mkdtempSync(join(tmpdir(), "p4s5-hist-")); repo = join(tmp, "repo"); git(root, "clone", "-q", "--shared", "--no-checkout", root, repo); git(repo, "checkout", "-q", git(root, "rev-parse", "HEAD").trim()); });
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder only */ } });

test("CONTROL: the guard passes on the committed tree plus the current guard file (the F1 false positive is gone)", () => {
  fresh(); const r = runGuard();
  assert.equal(r.status, 0, r.out.slice(-1500)); assert.equal(r.pass, 1); assert.equal(r.fail, 0);
});
test("NEGATIVE 1: an earlier-slice test changed by anything other than a Rules SHA pin is still rejected", () => {
  fresh(); appendFileSync(join(repo, "test/library-v2-p3-s5/clone-delete.rules.test.mjs"), "\n// unauthorized edit of a historical test\n");
  const r = runGuard(); assert.notEqual(r.status, 0); assert.equal(r.fail, 1); assert.match(r.out, /must only re-pin the Rules SHA-256/);
});
test("NEGATIVE 2: an aligned guard may change only a little (>= 40 off-pin lines is still rejected)", () => {
  fresh(); appendFileSync(join(repo, "test/library-v2-p2-s2/source-guard.test.mjs"), Array.from({ length: 60 }, (_, i) => "// unauthorized line " + i).join("\n") + "\n");
  const r = runGuard(); assert.notEqual(r.status, 0); assert.equal(r.fail, 1); assert.match(r.out, /alignment is small/);
});
test("NEGATIVE 3: the exemption is limited to the P4-S5 directory - a new test file of any other (later) slice is still rejected", () => {
  fresh(); mkdirSync(join(repo, "test/library-v2-p4-s6"), { recursive: true }); writeFileSync(join(repo, "test/library-v2-p4-s6/new.test.mjs"), "// a later slice file\n"); git(repo, "add", "test/library-v2-p4-s6/new.test.mjs");
  const r = runGuard(); assert.notEqual(r.status, 0); assert.equal(r.fail, 1); assert.match(r.out, /must only re-pin the Rules SHA-256/);
});
test("NEGATIVE 4: a similarly named directory is NOT exempt (prefix is the exact directory test/library-v2-p4-s5/)", () => {
  fresh(); mkdirSync(join(repo, "test/library-v2-p4-s5x"), { recursive: true }); writeFileSync(join(repo, "test/library-v2-p4-s5x/new.test.mjs"), "// not the P4-S5 directory\n"); git(repo, "add", "test/library-v2-p4-s5x/new.test.mjs");
  const r = runGuard(); assert.notEqual(r.status, 0); assert.equal(r.fail, 1);
});
test("POSITIVE 5: an allowed Rules-SHA re-pin of a historical test is still accepted", () => {
  fresh(); appendFileSync(join(repo, "test/library-v2-p3-s5/clone-delete.rules.test.mjs"), "// pin F6B9DE01 re-pinned\n");
  const r = runGuard(); assert.equal(r.status, 0, r.out.slice(-1200)); assert.equal(r.pass, 1);
});
