// P4-S4 - the pure full read-back verification (verifyImportedDataset), identity matching and error classification. Run: node --test test/library-v2-p4-s4/verify.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { verifyImportedDataset, batchMatchesPlan, classifyError } from "../../import-commit-controller.mjs";
import { toBatchCreatePayload, toFrameworkPayload, toNodePayload } from "../../import-plan.mjs";
import { planFor, big, BATCH } from "./helpers.mjs";

const now = () => new Date("2026-10-09T00:00:00Z");
const plan = planFor(big(3, 6));                       // 3 subjects + 18 lessons = 21 nodes
const storedOf = (p = plan) => ({
  framework: { id: p.framework.id, ...toFrameworkPayload(p, { actorUid: "pa", serverTimestamp: now }) },
  batch: { id: p.batch.id, ...toBatchCreatePayload(p, { actorUid: "pa", serverTimestamp: now }) },
  nodes: p.nodes.map((n) => ({ id: n.id, ...toNodePayload(n, { serverTimestamp: now }) }))
});
const verify = (mutate) => { const s = storedOf(); mutate && mutate(s); return verifyImportedDataset({ plan, framework: s.framework, batch: s.batch, nodes: s.nodes }); };
const codes = (r) => r.issues.map((i) => i.code);

test("EXACT dataset: no issue, exact counts, finalNodeId present, digests equal", () => {
  const r = verify();
  assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.deepEqual(r.counts, { expected: 21, found: 21, missing: 0, extra: 0, altered: 0 });
  assert.equal(r.repairable, false);
});
test("MISSING node: blocks completion, is repairable (a resume writes it); a missing PARENT and the missing FINAL node are reported too", () => {
  const leaf = verify((s) => { s.nodes.splice(7, 1); });
  assert.equal(leaf.ok, false); assert.ok(codes(leaf).includes("NODES_MISSING") && codes(leaf).includes("NODE_COUNT")); assert.equal(leaf.counts.missing, 1); assert.equal(leaf.repairable, true);
  const parent = verify((s) => { s.nodes.splice(0, 1); });                 // first subject: its lessons become orphans
  assert.ok(codes(parent).includes("TREE_PARENT_MISSING")); assert.equal(parent.repairable, true);
  const final = verify((s) => { s.nodes.pop(); });
  assert.ok(codes(final).includes("FINAL_NODE_MISSING")); assert.equal(final.repairable, true);
  const all = verify((s) => { s.nodes.length = 0; }); assert.equal(all.counts.missing, 21); assert.equal(all.repairable, true);
});
test("EXTRA node: blocks completion and is NOT repairable", () => {
  const r = verify((s) => { s.nodes.push({ ...s.nodes[3], id: "f".repeat(32) }); });
  assert.equal(r.ok, false); assert.ok(codes(r).includes("NODES_EXTRA")); assert.equal(r.counts.extra, 1); assert.equal(r.repairable, false); assert.deepEqual(r.extraIds, ["f".repeat(32)]);
});
test("ALTERED node: every verified field is detected (name, code, order, kind, parent, ancestors, status, organization, extra key, missing key, schema version, timestamps) and is NOT repairable", () => {
  const cases = {
    name: (n) => { n.name = "Tên khác"; }, code: (n) => { n.code = "ZZ"; }, order: (n) => { n.order = 99; }, kind: (n) => { n.kind = "unit"; },
    parentId: (n) => { n.parentId = "a".repeat(32); }, ancestors: (n) => { n.ancestors = ["a".repeat(32)]; }, status: (n) => { n.status = "retired"; },
    organizationId: (n) => { n.organizationId = "orgB"; }, keys: (n) => { n.extra = 1; }, schemaVersion: (n) => { n.schemaVersion = 2; }, timestamps: (n) => { n.createdAt = null; }
  };
  for (const [field, change] of Object.entries(cases)) {
    const r = verify((s) => change(s.nodes[10]));
    assert.equal(r.ok, false, field); assert.ok(codes(r).includes("NODES_ALTERED"), field); assert.equal(r.repairable, false, field); assert.equal(r.altered[0].id, plan.nodes[10].id);
  }
  const deleted = verify((s) => { delete s.nodes[10].code; });
  assert.ok(deleted.altered[0].fields.includes("keys"));
});
test("STRUCTURE / ORDER / CODES on what is really stored: duplicate canonical codes, duplicate sibling order, cycles and wrong hierarchy are reported even if the plan comparison is bypassed", () => {
  const dup = verify((s) => { s.nodes[4].code = s.nodes[5].code.toUpperCase(); });
  assert.ok(codes(dup).includes("TREE_DUPLICATE_CODE") && codes(dup).includes("NODES_ALTERED"));
  const order = verify((s) => { s.nodes[5].order = s.nodes[4].order; });
  assert.ok(codes(order).includes("TREE_DUPLICATE_ORDER"));
  const chain = verify((s) => { const lesson = s.nodes.find((n) => n.kind === "lesson"); lesson.ancestors = []; lesson.parentId = null; });
  assert.ok(codes(chain).includes("NODES_ALTERED"));
});
test("IDENTITY: framework/batch/organization/plan facts are all verified (name, status, activation, clone marker, batch ids, counts, chunks, final node, source file, status)", () => {
  assert.ok(codes(verify((s) => { s.framework.status = "active"; })).includes("FRAMEWORK_STATUS"));
  assert.ok(codes(verify((s) => { s.framework.activatedAt = now(); })).includes("FRAMEWORK_STATUS"));
  assert.ok(codes(verify((s) => { s.framework.cloneSource = { frameworkId: "x", nodeCount: 1 }; })).includes("FRAMEWORK_STATUS"));
  assert.ok(codes(verify((s) => { s.framework.name = "Khác"; })).includes("FRAMEWORK_FACTS"));
  assert.ok(codes(verify((s) => { s.framework.organizationId = "orgB"; })).includes("ORGANIZATION_MISMATCH"));
  assert.ok(codes(verify((s) => { s.framework.id = "other"; })).includes("IDENTITY_MISMATCH"));
  assert.ok(codes(verify((s) => { s.batch.organizationId = "orgB"; })).includes("ORGANIZATION_MISMATCH"));
  assert.ok(codes(verify((s) => { s.batch.destination = { type: "curriculumFramework", frameworkId: "other" }; })).includes("IDENTITY_MISMATCH"));
  assert.ok(codes(verify((s) => { s.batch.counts = { ...s.batch.counts, accepted: 1 }; })).includes("BATCH_FACTS"));
  assert.ok(codes(verify((s) => { s.batch.chunksTotal = 9; })).includes("BATCH_FACTS"));
  assert.ok(codes(verify((s) => { s.batch.finalNodeId = "e".repeat(32); })).includes("BATCH_FACTS"));
  assert.ok(codes(verify((s) => { s.batch.sourceFile = { ...s.batch.sourceFile, sha256: "0".repeat(64) }; })).includes("BATCH_FACTS"));
  assert.ok(codes(verify((s) => { s.batch.status = "partial"; })).includes("BATCH_STATUS"));
  assert.ok(codes(verify((s) => { s.batch = null; })).includes("BATCH_MISSING"));
  assert.ok(codes(verify((s) => { s.framework = null; })).includes("FRAMEWORK_MISSING"));
  assert.equal(verify((s) => { s.batch.status = "completed"; }).ok, true, "a completed batch re-verifies");
  const other = verifyImportedDataset({ plan, ...storedOf(), organizationId: "orgB" }); assert.ok(codes(other).includes("ORGANIZATION_MISMATCH"));
});
test("PLAN INTEGRITY: a plan that is not an executable, untampered P4-S2 plan is refused outright", () => {
  const s = storedOf();
  assert.equal(verifyImportedDataset({ plan: { ...plan }, ...s }).issues[0].code, "PLAN_INTEGRITY");
  assert.equal(verifyImportedDataset({ plan: null, ...s }).ok, false);
});
test("batchMatchesPlan: only the batch frozen from THIS plan in THIS organization matches (re-selecting a different file or organization never resumes someone else's batch)", () => {
  const { batch } = storedOf();
  assert.equal(batchMatchesPlan(batch, plan, "orgA"), true);
  assert.equal(batchMatchesPlan(batch, plan, "orgB"), false);
  assert.equal(batchMatchesPlan({ ...batch, id: "x" }, plan, "orgA"), false);
  assert.equal(batchMatchesPlan({ ...batch, sourceFile: { ...batch.sourceFile, sha256: "1".repeat(64) } }, plan, "orgA"), false);
  assert.equal(batchMatchesPlan({ ...batch, counts: { ...batch.counts, parsed: 1 } }, plan, "orgA"), false);
  assert.equal(batchMatchesPlan({ ...batch, finalNodeId: "d".repeat(32) }, plan, "orgA"), false);
  assert.equal(batchMatchesPlan(null, plan, "orgA"), false); assert.equal(batchMatchesPlan(batch, {}, "orgA"), false);
  const other = planFor(big(2, 3)); assert.equal(batchMatchesPlan(batch, other, "orgA"), false);
  assert.equal(BATCH.length, 20);
});
test("classifyError: permission / transient / conflict / not-found / unknown; raw errors never decide anything else", () => {
  const c = (code, message) => classifyError(Object.assign(new Error(message || "x"), code ? { code } : {}));
  assert.equal(c("permission-denied"), "permission"); assert.equal(c("firestore/permission-denied"), "permission"); assert.equal(c("unauthenticated"), "permission");
  for (const code of ["unavailable", "deadline-exceeded", "aborted", "resource-exhausted", "internal", "cancelled"]) assert.equal(c(code), "transient", code);
  assert.equal(c("already-exists"), "conflict"); assert.equal(c("not-found"), "not-found"); assert.equal(c("invalid-argument"), "unknown");
  assert.equal(c(null, "Failed to get document because the client is offline."), "transient"); assert.equal(c(null, "boom"), "unknown"); assert.equal(classifyError(null), "unknown");
});
