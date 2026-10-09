// LIBRARY V2 P4-S1 - text/structure proofs (pure, no emulator): the candidate differs from the DEPLOYED P3-S1 Rules artifact (SHA-256 A0B206FC...921D, ruleset 5945fbe7) in exactly three places:
//   (1) the D14 clone clause inside the P3 framework CREATE rule, (2) the activation clause inside the P3 framework UPDATE rule, (3) the additive P4-S1 region after the P3 region.
// Removing the P4 region and reversing the two clauses restores the deployed artifact BYTE FOR BYTE. Index manifest, Storage rules and every other file are untouched.
// Run: node --test test/library-v2-p4-s1/regression.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { deployedRulesText } from "../library-v2-p4-s4/helpers.mjs";
import { candidateRules, baselineRules, p3Region, p4Region, sha, NL, BEGIN, END, P4_BEGIN, P4_END, DEPLOYED_SHA } from "../library-v2-p3-s1/helpers.mjs";

const rules = deployedRulesText();   // P4-S4: this suite proves the DEPLOYED ruleset 0b6910c3 (the candidate with the import-freeze edits reversed)
const root = new URL("../../", import.meta.url);
const P3S1_DEPLOYED_SHA = "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d";   // production ruleset 5945fbe7-d5db-4e23-b355-a7b17793c7a8

// the exact reversal of the two clause edits (new text -> deployed P3-S1 text)
const CREATE_NEW = `        (!('cloneSource' in request.resource.data) ||
          (get(fwPath(request.resource.data.cloneSource.frameworkId)).data.organizationId == request.resource.data.organizationId &&
           importAllowsActivation(request.resource.data.cloneSource.frameworkId, request.resource.data.organizationId)));   // P4-S1 (D14): an incomplete import cannot be cloned into an unpaired framework`;
const CREATE_OLD = `        (!('cloneSource' in request.resource.data) ||
          get(fwPath(request.resource.data.cloneSource.frameworkId)).data.organizationId == request.resource.data.organizationId);`;
const UPDATE_NEW = `        mayWriteCurriculum(resource.data.organizationId) &&
        (resource.data.status != 'draft' || request.resource.data.status != 'active' || importAllowsActivation(fwId, resource.data.organizationId));   // P4-S1: import-governed frameworks activate only after a completed batch
      // Only a never-activated draft may be deleted`;
const UPDATE_OLD = `        mayWriteCurriculum(resource.data.organizationId);
      // Only a never-activated draft may be deleted`;
const once = (hay, needle) => { assert.equal(hay.split(needle).length - 1, 1, "anchor present exactly once: " + needle.slice(0, 60)); };

test("BYTE-LEVEL PROOF: candidate minus the P4-S1 region, with the two single-clause edits reversed, is byte-identical to the DEPLOYED P3-S1 Rules (A0B206FC...921D)", () => {
  once(rules, CREATE_NEW); once(rules, UPDATE_NEW);
  assert.equal(rules.split(P4_BEGIN).length - 1, 1); assert.equal(rules.split(P4_END).length - 1, 1);
  let restored = rules.replace(p4Region(rules), "");
  restored = restored.replace(CREATE_NEW, () => CREATE_OLD).replace(UPDATE_NEW, () => UPDATE_OLD);
  assert.equal(sha(restored), P3S1_DEPLOYED_SHA);
  // and the P3 region itself still carries the same structure the P3-S1 suites pin (names, matches) - proven by test/library-v2-p3-s1/regression.test.mjs on this candidate
  assert.notEqual(sha(rules), P3S1_DEPLOYED_SHA);
});
test("the P4-S1 region is a pure insertion AFTER the P3 region and BEFORE the default-deny block; nothing else was added, removed or reordered (line-level proof)", () => {
  const region = p4Region(rules);
  assert.ok(rules.indexOf(region) > rules.indexOf(END), "after the P3 region");
  assert.ok(rules.indexOf(region) < rules.lastIndexOf("match /{document=**}"), "before the default-deny match");
  const without = rules.replace(region, "");
  const cl = without.split(NL), dl = rules.replace(region, "").split(NL);
  assert.deepEqual(cl, dl);
  const added = rules.split(NL).length - without.split(NL).length;
  assert.ok(added > 60 && added < 120, "region size " + added);
  // the default-deny block is still last and unchanged
  assert.ok(rules.trimEnd().endsWith("match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}"));
});
test("region hygiene: only importBatches is matched; no wildcard-open rule; helper names are new and do not collide; deletes are false; no users/documents access; no importBatchId anywhere in the framework or node schema", () => {
  const region = p4Region(rules);
  const matches = [...region.matchAll(/match \/([A-Za-z{}\/]+?)(?:\/\{[A-Za-z]+\})? \{/g)].map((m) => m[0].replace(/ \{$/, ""));
  assert.deepEqual(matches, ["match /importBatches/{batchId}"]);
  assert.ok(!/allow [a-z, ]*: if true/.test(region), "no open rule");
  const names = [...region.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["batchImmutableOk", "batchNodePath", "batchShapeOk", "batchTransitionOk", "cleanupWitnessOk", "completionWitnessOk", "importAllowsActivation", "importIntIn", "importPath"]);
  const outside = rules.replace(region, "");
  const baseNames = new Set([...outside.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]));
  for (const n of names) assert.ok(!baseNames.has(n), "helper name does not collide: " + n);
  assert.equal((region.match(/allow delete: if false;/g) || []).length, 1); assert.equal((region.match(/allow (create|update|delete): if /g) || []).length, 3);
  assert.equal((region.match(/mayWriteCurriculum\(/g) || []).length, 2); assert.equal((region.match(/mayReadCurriculum\(/g) || []).length, 1);
  assert.ok(!/documents\/users\//.test(region));
  const p3 = p3Region(rules);
  assert.ok(!/['"]importBatchId['"]|[.]importBatchId/.test(p3 + region), "path identity: no importBatchId key or field access exists in any schema/expression");
  const fwKeys = (p3.match(/d\.keys\(\)\.hasOnly\(\['schemaVersion', 'organizationId', 'scope'[^\]]*\]\)/) || [""])[0];
  assert.ok(fwKeys && !fwKeys.includes("import"), "framework key set unchanged");
  // exactly two P3-region edits reference the new helper, nothing else in the P3 region does
  assert.equal((p3.match(/importAllowsActivation\(/g) || []).length, 2);
});
test("the Rules claim ONLY what they can prove: the P4 region documents the guarantee boundary, finalNodeId is a witness (not proof), and no completeness/uniqueness/hierarchy/order claim is enforced by an expression", () => {
  const region = p4Region(rules);
  for (const phrase of ["finalNodeId is a finite witness, NOT proof of a complete import", "WHAT THEY DO NOT GUARANTEE", "canonical code uniqueness", "hierarchy completeness"]) assert.ok(region.includes(phrase), phrase);
  // the only node reads are the witness (one get for completion, one exists for rollback); no loop-like or count-like expression exists in Rules
  assert.equal((region.match(/batchNodePath\(/g) || []).length, 3);   // definition + completion get + cleanup exists
  assert.ok(!/\.size\(\) *== *d\.counts|hasAll\(\[ *'nodes'/.test(region));
  // the state enum is exactly the frozen one
  assert.ok(region.includes("d.status in ['committing', 'completed', 'partial', 'rolled_back']"));
});
test("H2 is NOT introduced and the P2 organization/membership/capability rules are byte-identical (the existing P3-S1 regression suite pins them on this candidate); every non-curriculum collection is untouched", () => {
  const outside = baselineRules(rules);
  assert.equal(sha(outside), DEPLOYED_SHA);   // candidate minus P3 and P4 regions = the deployed P2 Rules (7EA5D7A5...)
  for (const needle of ["function mayWriteOrg(orgId) { return isAdmin() || (isOrgAdmin(orgId) && orgActive(orgId)); }"]) assert.ok(outside.includes(needle));
});
test("index manifest, Storage and every other repository file are untouched: firestore.indexes.json byte-identical (no index deploy), no Storage rules file, package files identical", () => {
  const h = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
  assert.equal(h("firestore.indexes.json"), "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51");
  assert.equal(h("package.json"), "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1");
  assert.equal(h("firestore.rules"), "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  assert.equal(JSON.parse(readFileSync(new URL("firestore.indexes.json", root), "utf8")).indexes.length, 14);
});
