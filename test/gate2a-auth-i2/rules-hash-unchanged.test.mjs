// Gate 2A-AUTH-I2 — Task M source guard, realigned by Gate 2A-AUTH-I2-CORRECTION-R1.
//
// The original version of this test pinned the WHOLE Rules file to a single sha256 hash,
// correct for Gate 2A-AUTH-I2 itself (which really was frontend-only) but structurally
// incompatible with any later, separately-authorized gate ever touching Rules again — which was
// always going to happen eventually (Stage 3 itself will touch topics/notes/photos/files).
// Rather than re-pin a new whole-file hash (which would just repeat the same problem one commit
// later) or delete this test (losing real coverage), it now proves the SAME underlying security
// intent semantically: relative to the exact AUTH-I2 production baseline, the get/create/update/
// delete rules on groupActivities/{id}/members/{uid} are unchanged (ignoring comment wording),
// topics/notes/photos/files are byte-identical, and the only new capability anywhere is the
// owner/admin `list` clause Gate 2A-AUTH-I2-CORRECTION added. Any unrelated Rules change —
// including any Stage-3-style tightening of topics/notes/photos/files, or any weakening of the
// member get/create/update/delete policy — fails this test.

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
function namedBlock(text, collectionName) {
  const pattern = new RegExp(`match /${collectionName}/\\{[a-zA-Z]+\\} \\{[\\s\\S]*?\\n {6}\\}`);
  const m = text.match(pattern);
  assert.ok(m, `could not locate ${collectionName}{} block`);
  return m[0];
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

for (const collectionName of ["topics", "notes", "photos", "files"]) {
  test(`${collectionName.toUpperCase()}: byte-identical to the AUTH-I2 baseline — no Stage-3 tightening introduced`, () => {
    assert.equal(namedBlock(candidate, collectionName), namedBlock(baseline, collectionName));
  });
}
