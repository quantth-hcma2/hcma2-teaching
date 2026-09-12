// Gate 2A-AUTH-I1 — realigned by Gate 2A-AUTH-I3.
//
// The original version of this test proved "stripping the members{} block reproduces the exact
// pre-Stage-1 file byte-for-byte" — a claim that was true of Gate 2A-AUTH-I1's own commit, but
// structurally cannot survive ANY later, separately-authorized change anywhere near that region
// (Gate 2A-AUTH-I3 added new top-level helper functions immediately before groupActivities, and
// reworded the members{} block's own leading comment to reflect that topics/notes/photos/files
// now depend on it — neither is a change to I1's own scope). Rather than re-pin a byte-exact
// snapshot that would break again at the next legitimate gate, this proves the same underlying
// intent — did I1's own get/create/update/delete/list policy change — semantically, per clause,
// against the I2-CORRECTION baseline (the last commit before I3 touched anything in this area).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidatePath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const candidate = readFileSync(candidatePath, "utf8").replace(/\r\n/g, "\n");

const BASELINE_COMMIT = "e05476bcbbc3ac887915fa61db62710b9b4a47fc"; // Gate 2A-AUTH-I2-CORRECTION production HEAD — last commit before Gate 2A-AUTH-I3
const repoRoot = path.join(here, "..", "..");
const baseline = execSync(`git show ${BASELINE_COMMIT}:firestore.rules.production-candidate`, { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function membersBlock(text) {
  const startIdx = text.indexOf("match /members/{uid} {");
  const endIdx = text.indexOf("// Mã tham gia phòng nhóm");
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, "could not locate the members{} block");
  return text.slice(startIdx, endIdx);
}
function extractAllow(block, keyword) {
  const m = block.match(new RegExp(`allow ${keyword}:[\\s\\S]*?;`));
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

const candidateMembers = membersBlock(candidate);
const baselineMembers = membersBlock(baseline);

for (const keyword of ["get", "list", "create", "update", "delete"]) {
  test(`ADDITIVE-ONLY (I1 scope, realigned): members{} '${keyword}' clause is unchanged by Gate 2A-AUTH-I3 (comment wording ignored)`, () => {
    const c = extractAllow(candidateMembers, keyword);
    const b = extractAllow(baselineMembers, keyword);
    assert.ok(b, `baseline ${keyword} clause not found`);
    assert.equal(c, b);
  });
}

test("ADDITIVE-ONLY: candidate is strictly longer than the I2-CORRECTION baseline (I3 only ever adds)", () => {
  assert.ok(candidate.length > baseline.length);
});
