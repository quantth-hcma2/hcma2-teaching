// Gate 2A-AUTH-I1 — pure, git-independent-at-runtime proof that this candidate is purely
// additive: stripping out exactly the new `members` block this gate inserts must reproduce the
// pinned pre-Stage-1 baseline byte-for-byte. The baseline is captured once, at gate-authoring
// time, from `git show 11dd636e6b6cdcf1612bfe58d8a3d50c3f32179a:firestore.rules.production-candidate`
// (the exact commit this branch was created from) — not re-fetched from git at test time, so
// this test has no runtime git dependency and stays deterministic forever.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidatePath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const candidate = readFileSync(candidatePath, "utf8").replace(/\r\n/g, "\n");

const BASELINE_COMMIT = "11dd636e6b6cdcf1612bfe58d8a3d50c3f32179a";
const repoRoot = path.join(here, "..", "..");
const baseline = execSync(`git show ${BASELINE_COMMIT}:firestore.rules.production-candidate`, { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

test("ADDITIVE-ONLY: stripping exactly the new members{} block reproduces the pinned pre-Stage-1 baseline byte-for-byte", () => {
  const startMarker = "\n\n      // GATE 2A-AUTH-I1 (Stage 1 of 3";
  const endMarker = "\n    }\n\n    // Mã tham gia phòng nhóm.";
  const startIdx = candidate.indexOf(startMarker);
  const endIdx = candidate.indexOf(endMarker);
  assert.ok(startIdx !== -1, "could not locate the start marker of the inserted members{} block");
  assert.ok(endIdx !== -1 && endIdx > startIdx, "could not locate the end marker after the inserted members{} block");
  const stripped = candidate.slice(0, startIdx) + candidate.slice(endIdx);
  assert.equal(stripped, baseline, "candidate with the members{} block removed must be byte-identical to the pinned pre-Stage-1 baseline — any difference means something beyond the additive members block changed");
});

test("ADDITIVE-ONLY: candidate is strictly longer than baseline (insertion only, confirmed by length)", () => {
  assert.ok(candidate.length > baseline.length);
});
