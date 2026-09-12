// Gate 2A-AUTH-I2 — Task M source guard, realigned by Gate 2A-AUTH-I2-CORRECTION-R1, then again
// by Gate 2A-AUTH-I3.
//
// The original version of this test pinned the WHOLE Rules file to a single sha256 hash,
// correct for Gate 2A-AUTH-I2 itself (which really was frontend-only) but structurally
// incompatible with any later, separately-authorized gate ever touching Rules again. R1 replaced
// that with per-clause proofs on members{} plus a "topics/notes/photos/files byte-identical, no
// Stage-3 tightening" check — which was itself exactly the assertion Gate 2A-AUTH-I3 (the actual
// Stage-3 gate) was always going to make false on purpose. That check has now been retired (see
// below); the members{} get/create/update/delete/list proofs remain, since I3 did not touch
// membership policy at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const repoRoot = path.join(here, "..", "..");
const AUTH_I2_BASELINE_COMMIT = "289183dee639e8a847d0dc010945687fb958af81"; // Gate 2A-AUTH-I2-PROD production HEAD — the last commit before any owner/admin `list` capability existed

const candidate = readFileSync(rulesPath, "utf8").replace(/\r\n/g, "\n");
const baseline = execSync(`git show ${AUTH_I2_BASELINE_COMMIT}:firestore.rules.production-candidate`, { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function membersBlock(text) {
  const startIdx = text.indexOf("match /members/{uid} {");
  const endIdx = text.indexOf("// Mã tham gia phòng nhóm");
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, "could not locate the members{} block");
  return text.slice(startIdx, endIdx);
}
// Extracts just the rule expression for one `allow <keyword>:` statement, ignoring whatever
// comment precedes it and normalizing whitespace — so a pure comment reword (like the one Gate
// 2A-AUTH-I2-CORRECTION made to the `get` comment) does not register as a functional change.
function extractAllow(block, keyword) {
  const m = block.match(new RegExp(`allow ${keyword}:[\\s\\S]*?;`));
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

const candidateMembers = membersBlock(candidate);
const baselineMembers = membersBlock(baseline);

test("MEMBERS get: unchanged relative to the AUTH-I2 baseline (comment wording ignored)", () => {
  const c = extractAllow(candidateMembers, "get");
  const b = extractAllow(baselineMembers, "get");
  assert.ok(b, "baseline get clause not found");
  assert.equal(c, b);
});

test("MEMBERS create (student join-code proof): unchanged relative to the AUTH-I2 baseline", () => {
  const c = extractAllow(candidateMembers, "create");
  const b = extractAllow(baselineMembers, "create");
  assert.ok(b, "baseline create clause not found");
  assert.equal(c, b);
});

test("MEMBERS update (owner/admin group-only correction): unchanged relative to the AUTH-I2 baseline", () => {
  const c = extractAllow(candidateMembers, "update");
  const b = extractAllow(baselineMembers, "update");
  assert.ok(b, "baseline update clause not found");
  assert.equal(c, b);
  assert.match(c, /hasOnly\(\['group'\]\)/, "student/owner correction must still be restricted to the group field only");
});

test("MEMBERS delete: unchanged relative to the AUTH-I2 baseline (owner/admin only)", () => {
  const c = extractAllow(candidateMembers, "delete");
  const b = extractAllow(baselineMembers, "delete");
  assert.ok(b, "baseline delete clause not found");
  assert.equal(c, b);
});

test("MEMBERS list: did NOT exist in the AUTH-I2 baseline, exists now, and is owner/admin only — the one authorized new capability", () => {
  assert.equal(extractAllow(baselineMembers, "list"), null, "the AUTH-I2 baseline must not have had a list clause at all");
  const c = extractAllow(candidateMembers, "list");
  assert.ok(c, "candidate must have a list clause");
  assert.match(c, /isAdmin\(\)/);
  assert.match(c, /isActiveTeacher\(\)/);
  assert.match(c, /\.data\.ownerId == request\.auth\.uid/);
  assert.doesNotMatch(c, /request\.auth\.uid == uid/, "list must not be grantable to a student by uid match — students get no list at all");
});

// The topics/notes/photos/files "byte-identical — no Stage-3 tightening" assertions that used to
// live here were retired by GATE 2A-AUTH-I3: their entire premise (these collections must stay
// untouched) is exactly what I3 is explicitly authorized to change, so re-asserting it would be
// asserting a now-intentionally-false claim, not a stale-but-harmless one. The historical fact
// this test protected — that Gate 2A-AUTH-I2 (and I2-CORRECTION) themselves never touched these
// collections — remains true and is preserved by this file's diff history; the CURRENT shape of
// topics/notes/photos/files is now covered by test/gate2a-auth-i3/final-hardening.test.mjs
// instead, which is the correct successor for that invariant going forward.
