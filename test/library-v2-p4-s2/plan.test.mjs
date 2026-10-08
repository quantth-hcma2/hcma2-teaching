// P4-S2 - deterministic READ-ONLY import plan: identity allocation, write order, chunking (<= 400), verification metadata, tamper detection, stage 10
// (prepareCommit) and compatibility with the P3 domain/write contract. Nothing here writes anything.
// Run: node --test test/library-v2-p4-s2/plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validateRaw, rawWorkbook, fileInfo, workbookBytes, validateBytes } from "./helpers.mjs";
import { buildImportPlan, prepareCommit, verifyPlanIntegrity, isExecutablePlan, nodeIdOf, canonicalJson, materializePayloads, toNodePayload, CHUNK_WRITES, MAX_CHUNKS, ImportPlanError, NODE_ID_PATTERN } from "../../import-plan.mjs";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import { validateTree, activationReadiness, nodeIssues, CURRICULUM_MAX_NODES, NODE_WRITE_CHUNK } from "../../curriculum-model.mjs";
import { sha256Hex } from "../../import-sha256.mjs";

const BATCH = "Ab12Cd34Ef56Gh78Ij90", ORG = "orgA";
const planOf = (options, batchId = BATCH) => { const r = validateRaw(options); assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3))); return buildImportPlan(r.model, { organizationId: ORG, batchId }); };
const big = (subjectsCount, lessonsPer) => {
  const subjects = Array.from({ length: subjectsCount }, (_, i) => ["S" + i, "Môn " + i, i]);
  const lessons = [];
  for (let s = 0; s < subjectsCount; s++) for (let l = 0; l < lessonsPer; l++) lessons.push(["S" + s, "S" + s + "-L" + l, "Bài " + l, l]);
  return { subjects, lessons };
};

test("IDENTITY: framework id = batch id; node id = first 32 hex of SHA-256(batchId|itemKey); deterministic, unique, batch-scoped", () => {
  const plan = planOf();
  assert.equal(plan.framework.id, BATCH); assert.equal(plan.batch.id, BATCH); assert.equal(plan.batch.destination.frameworkId, BATCH);
  for (const node of plan.nodes) {
    assert.match(node.id, NODE_ID_PATTERN);
    assert.equal(node.id, sha256Hex(BATCH + "|" + node.key).slice(0, 32)); assert.equal(node.id, nodeIdOf(BATCH, node.key));
  }
  assert.equal(new Set(plan.nodes.map((n) => n.id)).size, plan.nodes.length);
  const other = planOf(undefined, "Zz98Yx76Wv54Ut32Sr10");
  assert.ok(plan.nodes.every((n, i) => n.id !== other.nodes[i].id), "ids never repeat across batches");
  assert.equal(canonicalJson(planOf()), canonicalJson(plan), "same model + same batch id => identical plan (byte for byte)");
  assert.equal(planOf().planDigest, plan.planDigest);
});
test("STRUCTURE: write order is subjects first, then the lessons of each subject; parent/ancestors use REAL ids; orders are explicit or by position; final node = last", () => {
  const plan = planOf({
    subjects: [["B", "Môn B", null], ["A", "Môn A", null]],
    lessons: [["A", "a1", "Bài A1", null], ["B", "b1", "Bài B1", null], ["A", "a2", "Bài A2", null]]
  });
  assert.deepEqual(plan.nodes.map((n) => n.key), ["MON:2", "MON:3", "BAI:3", "BAI:2", "BAI:4"], "subjects first (B, A), then lessons of B, then lessons of A");
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const lesson = byKey.get("BAI:4");
  assert.equal(lesson.parentId, byKey.get("MON:3").id); assert.deepEqual(lesson.ancestors, [byKey.get("MON:3").id]);
  assert.equal(byKey.get("MON:2").parentId, null); assert.deepEqual(byKey.get("MON:2").ancestors, []);
  assert.deepEqual(plan.nodes.filter((n) => n.parentKey === "MON:3").map((n) => [n.key, n.order]), [["BAI:2", 0], ["BAI:4", 1]], "positions per subject, in sheet row order");
  assert.equal(plan.verification.finalNodeId, plan.nodes[plan.nodes.length - 1].id); assert.equal(plan.batch.finalNodeId, plan.verification.finalNodeId);
  assert.match(plan.batch.finalNodeId, /^[0-9a-f]{32}$/);
  assert.ok(plan.nodes.every((n, i) => n.ordinal === i && n.status === "active" && n.organizationId === ORG));
});
test("CHUNKS: <= 400 writes per chunk, no gaps/overlaps, 5000 nodes = 13 chunks (the Rules bound), 1 node = 1 chunk", () => {
  assert.equal(CHUNK_WRITES, 400); assert.equal(CHUNK_WRITES, NODE_WRITE_CHUNK); assert.equal(MAX_CHUNKS, 13);
  for (const [subjects, per, expectedChunks] of [[1, 0, 1], [1, 399, 1], [1, 400, 2], [4, 199, 2], [10, 79, 2], [50, 99, 13]]) {
    const plan = planOf(big(subjects, per));
    const total = subjects * (per + 1);
    assert.equal(plan.nodes.length, total); assert.equal(plan.chunks.length, expectedChunks, subjects + "x" + per);
    assert.ok(plan.chunks.every((c) => c.count <= 400 && c.count === c.to - c.from && c.nodeIds.length === c.count));
    assert.equal(plan.chunks.reduce((n, c) => n + c.count, 0), total);
    plan.chunks.forEach((c, i) => { assert.equal(c.index, i); if (i > 0) assert.equal(c.from, plan.chunks[i - 1].to); });
    assert.equal(plan.batch.chunksTotal, expectedChunks); assert.ok(plan.batch.chunksTotal <= 13);
    assert.equal(plan.verification.expectedNodeCount, total);
  }
  const max = planOf(big(50, 99));
  assert.equal(max.nodes.length, CURRICULUM_MAX_NODES); assert.deepEqual(max.chunks.map((c) => c.count), [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 200]);
});
test("VERIFICATION METADATA: expected nodes, counts, digests and the batch seed carry everything P4-S4 needs; the plan is deep-frozen and tamper-evident", () => {
  const plan = planOf();
  const v = plan.verification;
  assert.equal(v.expectedNodeCount, 5); assert.equal(v.subjectCount, 2); assert.equal(v.lessonCount, 3); assert.equal(v.maxChunkWrites, 400);
  assert.equal(v.expectedNodes.length, 5);
  for (const expected of v.expectedNodes) assert.deepEqual(Object.keys(expected).sort(), ["ancestors", "code", "id", "kind", "name", "order", "organizationId", "parentId", "status"]);
  const sorted = v.expectedNodes.map((n) => n.id).sort();
  assert.equal(v.nodeIdSetDigest, sha256Hex(sorted.join("\n")));
  assert.match(v.contentDigest, /^[0-9a-f]{64}$/); assert.match(plan.planDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(plan.batch.counts, { parsed: 5, accepted: 5, skipped: 0, failed: 0 });
  assert.equal(plan.batch.templateId, "hcma2.curriculum.xlsx"); assert.equal(plan.batch.templateVersion, 1); assert.deepEqual(plan.batch.destination, { type: "curriculumFramework", frameworkId: BATCH });
  assert.equal(plan.batch.sourceFile.sha256, fileInfo().sha256); assert.equal(plan.batch.sourceFile.name, "raw.xlsx"); assert.ok(Object.keys(plan.batch.warningsSummary).length <= 20);
  assert.deepEqual(plan.framework, { id: BATCH, name: "Khung thử nghiệm", organizationId: ORG, scope: "organization", status: "draft", schemaVersion: 1 });
  assert.ok(isExecutablePlan(plan) && verifyPlanIntegrity(plan));
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.nodes) && Object.isFrozen(plan.nodes[0]) && Object.isFrozen(plan.batch.counts) && Object.isFrozen(plan.verification.expectedNodes[0]));
  assert.throws(() => { plan.nodes[0].name = "đổi"; }, TypeError);
  const forged = JSON.parse(JSON.stringify(plan)); forged.nodes[0].name = "bị sửa";
  assert.equal(isExecutablePlan(forged), false, "a copy is not an executable plan");
  assert.equal(verifyPlanIntegrity(forged), false);
  assert.ok(plan.commitOrder.length === 5 && plan.commitOrder[0].includes("importBatches") && plan.commitOrder[1].includes("curriculumFrameworks"));
});
test("INPUT GUARDS: only validated models, a valid organization and a safe batch id build a plan; warnings travel into warningsSummary", async () => {
  const r = validateRaw();
  for (const bad of [undefined, "", "a/b", "a b", "x".repeat(129), 5]) assert.throws(() => buildImportPlan(r.model, { organizationId: ORG, batchId: bad }), (e) => e instanceof ImportPlanError && e.code === "BATCH_ID");
  assert.throws(() => buildImportPlan(r.model, { batchId: BATCH }), (e) => e.code === "ORGANIZATION");
  assert.throws(() => buildImportPlan(r.model, { organizationId: "a/b", batchId: BATCH }), (e) => e.code === "ORGANIZATION");
  const withWarning = validateRaw({ subjects: [["A", "Môn không bài", null]], lessons: [] });
  assert.equal(withWarning.ok, true);
  assert.deepEqual(buildImportPlan(withWarning.model, { organizationId: ORG, batchId: BATCH }).batch.warningsSummary, { SUBJECT_EMPTY: 1 });
});

// ------------------------------------------------------------------------------------------- compatibility with P3
test("P3 COMPATIBILITY (domain): plan nodes pass P3 nodeIssues, validateTree (ancestors, orders, canonical codes) and activationReadiness - for small and maximum-size plans", () => {
  for (const options of [undefined, big(7, 40), big(50, 99)]) {
    const plan = planOf(options);
    const nodes = plan.nodes.map((n) => ({ id: n.id, schemaVersion: 1, organizationId: ORG, kind: n.kind, parentId: n.parentId, ancestors: n.ancestors, order: n.order, code: n.code, name: n.name, status: "active" }));
    for (const node of nodes) assert.deepEqual(nodeIssues(node, { organizationId: ORG }), []);
    const tree = validateTree(nodes, { organizationId: ORG });
    assert.equal(tree.valid, true, JSON.stringify(tree.issues.slice(0, 3)));
    assert.equal(tree.stats.nodeCount, nodes.length); assert.equal(tree.stats.maxDepth, 2); assert.equal(tree.stats.orphanCount, 0);
    const ready = activationReadiness({ status: "draft", organizationId: ORG }, nodes);
    assert.equal(ready.ready, true, JSON.stringify(ready.errors));
  }
});
test("P3 COMPATIBILITY (write contract): every payload equals what the P3 builders produce, field for field (timestamps aside), including parents loaded incrementally", () => {
  const plan = planOf(big(6, 12));
  const contract = createCurriculumWriteContract({ serverTimestamp: () => "TS" });
  const organization = { id: ORG, status: "active" };
  const frameworkPayload = contract.buildFrameworkCreate({ organization, name: plan.framework.name }, "pa");
  assert.deepEqual(materializePayloads(plan, { actorUid: "pa", serverTimestamp: () => "TS" }).framework.data, frameworkPayload);
  const framework = { id: BATCH, organizationId: ORG, status: "draft", name: plan.framework.name };
  const loaded = [];
  for (const node of plan.nodes) {
    const parent = node.parentId ? loaded.find((l) => l.id === node.parentId) : null;
    const built = contract.buildNodeCreate({ parent, kind: node.kind, name: node.name, code: node.code ?? undefined, order: node.order, id: node.id }, { organization, framework, nodes: loaded });
    assert.deepEqual(toNodePayload(node, { serverTimestamp: () => "TS" }), built, node.key);
    loaded.push({ id: node.id, ...built });
  }
  assert.equal(loaded.length, plan.nodes.length);
});
test("PAYLOADS: materializePayloads creates the batch, framework and chunked node writes with the caller's timestamp factory only", () => {
  const plan = planOf(big(6, 80));
  let calls = 0;
  const payloads = materializePayloads(plan, { actorUid: "pa", serverTimestamp: () => { calls++; return { sentinel: calls }; } });
  assert.equal(payloads.batch.path, "importBatches/" + BATCH); assert.equal(payloads.framework.path, "curriculumFrameworks/" + BATCH);
  assert.equal(payloads.batch.data.status, "committing"); assert.equal(payloads.batch.data.chunksDone, 0); assert.equal(payloads.batch.data.importer, "pa");
  assert.deepEqual(Object.keys(payloads.batch.data).sort(), ["chunksDone", "chunksTotal", "counts", "createdAt", "destination", "finalNodeId", "importer", "kind", "organizationId", "schemaVersion", "sourceFile", "status", "templateId", "templateVersion", "updatedAt", "warningsSummary"]);
  assert.equal(payloads.chunks.length, plan.chunks.length); assert.ok(payloads.chunks.every((c) => c.writes.length <= 400));
  assert.equal(payloads.chunks.flatMap((c) => c.writes).length, plan.nodes.length);
  assert.ok(payloads.chunks[0].writes[0].path.startsWith("curriculumFrameworks/" + BATCH + "/nodes/"));
  assert.throws(() => materializePayloads(plan, { actorUid: "pa" }), TypeError);
  assert.ok(calls >= 2 * plan.nodes.length + 4);
});

// ------------------------------------------------------------------------------------------- stage 10
test("STAGE 10: prepareCommit re-reads the organization, re-runs stages 5-9 and builds every payload before any write; an inactive organization or a bad actor blocks it", () => {
  const model = validateRaw().model;
  const ok = prepareCommit(model, { organization: { id: ORG, status: "active" }, batchId: BATCH, actorUid: "pa" });
  assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics)); assert.ok(isExecutablePlan(ok.plan)); assert.equal(ok.payloads.chunks.length, 1);
  const archived = prepareCommit(model, { organization: { id: ORG, status: "archived" }, batchId: BATCH, actorUid: "pa" });
  assert.equal(archived.ok, false); assert.equal(archived.plan, null); assert.equal(archived.diagnostics[0].code, "ORGANIZATION_READ_ONLY"); assert.equal(archived.payloads, null);
  assert.equal(prepareCommit(model, { organization: null, batchId: BATCH, actorUid: "pa" }).diagnostics[0].code, "ORGANIZATION_READ_ONLY");
  assert.equal(prepareCommit(model, { organization: { id: ORG, status: "active" }, batchId: BATCH, actorUid: "" }).ok, false);
  assert.equal(prepareCommit(model, { organization: { id: ORG, status: "active" }, batchId: "bad/id", actorUid: "pa" }).diagnostics[0].code, "PLAN_BUILD_FAILED");
  const forged = prepareCommit(JSON.parse(JSON.stringify(model)), { organization: { id: ORG, status: "active" }, batchId: BATCH, actorUid: "pa" });
  assert.equal(forged.ok, false); assert.equal(forged.diagnostics[0].code, "PLAN_BUILD_FAILED");
  const none = prepareCommit(undefined, { organization: { id: ORG, status: "active" }, batchId: BATCH, actorUid: "pa" });
  assert.equal(none.ok, false); assert.equal(none.plan, null);
});
test("END TO END: a real .xlsx through the Worker-less gate, the validator and the plan produces the same plan twice; an invalid workbook produces no plan", async () => {
  const bytes = workbookBytes(big(3, 20));
  const a = await validateBytes(bytes), b = await validateBytes(bytes);
  const planA = buildImportPlan(a.result.model, { organizationId: ORG, batchId: BATCH }), planB = buildImportPlan(b.result.model, { organizationId: ORG, batchId: BATCH });
  assert.equal(planA.planDigest, planB.planDigest); assert.equal(planA.nodes.length, 3 + 60);
  assert.equal(a.result.model.source.sha256, planA.batch.sourceFile.sha256);
  const invalid = await validateBytes(workbookBytes({ lessons: [["NOPE", "x", "Bài", 1]] }));
  assert.equal(invalid.result.model, null);
  assert.throws(() => buildImportPlan(invalid.result.model, { organizationId: ORG, batchId: BATCH }));
});
test("READ-ONLY: building and preparing a plan touches no global state and no I/O (modules import only P3 pure modules and each other)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["import-plan.mjs", "import-validate.mjs", "import-normalize.mjs", "import-diagnostics.mjs", "import-template.mjs", "import-sha256.mjs"]) {
    const text = readFileSync(new URL("../../" + file, import.meta.url), "utf8");
    const imports = [...text.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const spec of imports) assert.ok(spec.startsWith("./") && !spec.includes("firebase") && !spec.includes("vendor"), file + " imports " + spec);
    assert.ok(!/\b(document|window|navigator|localStorage|fetch|Date\.now|new Date|Math\.random|crypto\.)\b/.test(text.replace(/\/\/.*$/gm, "")), file + " uses a clock/random/DOM API");
  }
});
