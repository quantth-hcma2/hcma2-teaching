// Library V2 P4-S2 - deterministic, READ-ONLY IMPORT PLAN for a NEW draft framework (pure, inert: it executes nothing, writes nothing, reads no clock).
// Also validation stage 10 (`prepareCommit`): organization writable + stages 5-9 again + every payload built and checked BEFORE any write.
//
// ID ALLOCATION (R2 D1/D3 paired-id contract; deployed Rules P4-S1):
//   frameworkId = batchId (the caller generates ONE Firestore auto id, `doc(collection(db, "importBatches")).id`, and uses it for both documents);
//   nodeId      = first 32 lower-case hex characters of SHA-256(batchId + "|" + itemKey), itemKey = "MON:<excel row>" / "BAI:<excel row>".
//   A node id is therefore a pure function of (batchId, item) and never repeats across batches; the Rules witness `finalNodeId` matches ^[0-9a-f]{32}$.
// WRITE ORDER: every subject (MÔN rows in sheet order), then the lessons of each subject (subjects in sheet order, lessons in sheet order). The LAST node of
// this order is the `finalNodeId` witness (P4-S1 Rules). Chunks hold <= 400 node writes (frozen cap; 5000 nodes -> 13 chunks = the Rules' chunksTotal bound).
// Order of the commit (executed by P4-S4, NOT here): batch (committing) -> framework (real name, draft) -> node chunks (separate commits; the framework must
// exist first) -> read-back verification of EVERY node against `verification` -> batch `completed` (the Rules only witness the final node: complete node
// verification is the controller's duty).
import { sha256Hex } from "./import-sha256.mjs";
import { diag, warningsSummary } from "./import-diagnostics.mjs";
import { isValidatedModel, revalidateModel } from "./import-validate.mjs";
import {
  CURRICULUM_SCHEMA_VERSION, FRAMEWORK_SCOPE, CURRICULUM_MAX_NODES, NODE_WRITE_CHUNK, isOrganizationWritable, isValidId, nodeIssues, validateTree, activationReadiness
} from "./curriculum-model.mjs";

export const PLAN_VERSION = 1;
export const CHUNK_WRITES = NODE_WRITE_CHUNK;                           // 400
export const MAX_CHUNKS = Math.ceil(CURRICULUM_MAX_NODES / CHUNK_WRITES); // 13 (Rules: chunksTotal <= 13)
export const NODE_ID_PATTERN = /^[0-9a-f]{32}$/;
const ID_CHARS = /^[A-Za-z0-9_-]{1,128}$/;
const deepFreeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; };
const EXECUTABLE = new WeakSet();
export const isExecutablePlan = (plan) => !!plan && typeof plan === "object" && EXECUTABLE.has(plan);

export class ImportPlanError extends Error {
  constructor(code, message) { super(message); this.name = "ImportPlanError"; this.code = code; }
}

// Stable JSON: object keys sorted recursively, arrays keep their order. The input must be plain JSON data.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}
export const nodeIdOf = (batchId, itemKey) => sha256Hex(batchId + "|" + itemKey).slice(0, 32);

function writeOrder(model) {
  const subjects = model.nodes.filter((node) => node.kind === "subject");
  const lessonsOf = new Map(subjects.map((subject) => [subject.key, []]));
  for (const node of model.nodes) if (node.kind === "lesson" && lessonsOf.has(node.parentKey)) lessonsOf.get(node.parentKey).push(node);
  const ordered = [...subjects];
  for (const subject of subjects) ordered.push(...lessonsOf.get(subject.key));
  return ordered;
}

// model: produced by validateImport() (anything else is refused). Throws ImportPlanError; returns a frozen, executable plan.
export function buildImportPlan(model, { organizationId, batchId } = {}) {
  if (!isValidatedModel(model)) throw new ImportPlanError("NOT_VALIDATED", "an import plan can only be built from a model that passed validation");
  if (!isValidId(organizationId)) throw new ImportPlanError("ORGANIZATION", "organizationId is required");
  if (typeof batchId !== "string" || !ID_CHARS.test(batchId)) throw new ImportPlanError("BATCH_ID", "batchId must be one Firestore auto id (letters, digits, '-' or '_')");
  const ordered = writeOrder(model);
  if (ordered.length !== model.nodes.length || ordered.length < 1 || ordered.length > CURRICULUM_MAX_NODES) throw new ImportPlanError("NODES", "node set is inconsistent or out of bounds");
  const idByKey = new Map(ordered.map((node) => [node.key, nodeIdOf(batchId, node.key)]));
  if (new Set(idByKey.values()).size !== ordered.length) throw new ImportPlanError("ID_COLLISION", "deterministic node ids collided");
  const nodes = ordered.map((node, ordinal) => {
    const parentId = node.parentKey === null ? null : idByKey.get(node.parentKey);
    return {
      ordinal, key: node.key, id: idByKey.get(node.key), kind: node.kind, parentKey: node.parentKey, parentId, ancestors: parentId === null ? [] : [parentId],
      order: node.order, code: node.code, name: node.name, status: "active", organizationId, sourceRef: { sheet: node.sourceRef.sheet, row: node.sourceRef.row }
    };
  });
  const chunks = [];
  for (let from = 0; from < nodes.length; from += CHUNK_WRITES) {
    const slice = nodes.slice(from, from + CHUNK_WRITES);
    chunks.push({ index: chunks.length, from, to: from + slice.length, count: slice.length, nodeIds: slice.map((node) => node.id) });
  }
  if (chunks.length > MAX_CHUNKS) throw new ImportPlanError("CHUNKS", "too many chunks");
  const finalNodeId = nodes[nodes.length - 1].id;
  const expected = nodes.map((node) => ({ id: node.id, kind: node.kind, parentId: node.parentId, ancestors: node.ancestors, code: node.code, name: node.name, order: node.order, status: node.status, organizationId: node.organizationId }));
  const sortedById = expected.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const subjectCount = nodes.filter((node) => node.kind === "subject").length;
  const core = {
    planVersion: PLAN_VERSION, organizationId,
    framework: { id: batchId, name: model.framework.name, organizationId, scope: FRAMEWORK_SCOPE, status: "draft", schemaVersion: CURRICULUM_SCHEMA_VERSION },
    batch: {
      id: batchId, schemaVersion: 1, kind: "curriculum", organizationId, destination: { type: "curriculumFramework", frameworkId: batchId }, templateId: model.templateId, templateVersion: model.schemaVersion,
      sourceFile: { name: model.source.name, size: model.source.size, sha256: model.source.sha256 },
      counts: { parsed: nodes.length, accepted: nodes.length, skipped: 0, failed: 0 }, chunksTotal: chunks.length, warningsSummary: warningsSummary(model.diagnostics), finalNodeId
    },
    nodes, chunks,
    verification: {
      expectedNodeCount: nodes.length, subjectCount, lessonCount: nodes.length - subjectCount, finalNodeId, maxChunkWrites: CHUNK_WRITES, chunksTotal: chunks.length,
      nodeIdSetDigest: sha256Hex(sortedById.map((node) => node.id).join("\n")), contentDigest: sha256Hex(canonicalJson(sortedById)), expectedNodes: expected
    },
    idStrategy: { frameworkId: "batchId", nodeId: "sha256(batchId + '|' + itemKey)[0..32) lower-case hex", itemKey: "MON:<excel row> | BAI:<excel row>" },
    commitOrder: ["create importBatches/{batchId} (committing)", "create curriculumFrameworks/{batchId} (draft, real name)", "node chunks (<= 400 writes each, separate commits, subjects first)", "read back and verify every node against verification", "importBatches/{batchId} -> completed"]
  };
  const plan = deepFreeze({ ...core, planDigest: sha256Hex(canonicalJson(core)) });
  EXECUTABLE.add(plan);
  return plan;
}

// Recomputes the digest: S4 calls this between confirmation and the first write to prove the plan was not altered.
export function verifyPlanIntegrity(plan) {
  if (!isExecutablePlan(plan)) return false;
  const { planDigest, ...core } = plan;
  return sha256Hex(canonicalJson(core)) === planDigest;
}

// ---------------------------------------------------------------- Firestore payloads (no timestamps are invented: the caller injects serverTimestamp)
function stamp(serverTimestamp) { if (typeof serverTimestamp !== "function") throw new TypeError("serverTimestamp factory is required"); return serverTimestamp; }
export function toFrameworkPayload(plan, { actorUid, serverTimestamp }) {
  const now = stamp(serverTimestamp);
  return { schemaVersion: CURRICULUM_SCHEMA_VERSION, organizationId: plan.organizationId, scope: FRAMEWORK_SCOPE, name: plan.framework.name, status: "draft", createdAt: now(), createdBy: actorUid, updatedAt: now() };
}
export function toNodePayload(node, { serverTimestamp }) {
  const now = stamp(serverTimestamp);
  return { schemaVersion: CURRICULUM_SCHEMA_VERSION, organizationId: node.organizationId, kind: node.kind, parentId: node.parentId, ancestors: node.ancestors.slice(), order: node.order, code: node.code, name: node.name, status: "active", createdAt: now(), updatedAt: now() };
}
export function toBatchCreatePayload(plan, { actorUid, serverTimestamp }) {
  const now = stamp(serverTimestamp);
  const { id, ...batch } = plan.batch;
  return { ...JSON.parse(JSON.stringify(batch)), importer: actorUid, status: "committing", chunksDone: 0, createdAt: now(), updatedAt: now() };
}
export function materializePayloads(plan, { actorUid, serverTimestamp }) {
  return {
    batch: { path: "importBatches/" + plan.batch.id, data: toBatchCreatePayload(plan, { actorUid, serverTimestamp }) },
    framework: { path: "curriculumFrameworks/" + plan.framework.id, data: toFrameworkPayload(plan, { actorUid, serverTimestamp }) },
    chunks: plan.chunks.map((chunk) => ({ index: chunk.index, writes: plan.nodes.slice(chunk.from, chunk.to).map((node) => ({ path: "curriculumFrameworks/" + plan.framework.id + "/nodes/" + node.id, data: toNodePayload(node, { serverTimestamp }) })) }))
  };
}

// ---------------------------------------------------------------- stage 10: pre-write revalidation
// organization: the freshly re-read organization { id, status }. Returns { ok, diagnostics, plan|null, payloads|null }; nothing is written and nothing throws.
export function prepareCommit(model, { organization, batchId, actorUid, serverTimestamp = () => "SERVER_TIMESTAMP" } = {}) {
  const diagnostics = [];
  if (!isOrganizationWritable(organization)) diagnostics.push(diag("ORGANIZATION_READ_ONLY"));
  if (!isValidId(actorUid)) diagnostics.push(diag("PLAN_BUILD_FAILED", { detail: "thiếu người thực hiện" }));
  if (diagnostics.length === 0) diagnostics.push(...revalidateModel(model));
  if (diagnostics.length > 0) return { ok: false, diagnostics, plan: null, payloads: null };
  try {
    const plan = buildImportPlan(model, { organizationId: organization.id, batchId });
    const payloads = materializePayloads(plan, { actorUid, serverTimestamp });
    // every payload is checked with the P3 validators BEFORE the first write
    const live = plan.nodes.map((node) => ({ id: node.id, schemaVersion: 1, organizationId: node.organizationId, kind: node.kind, parentId: node.parentId, ancestors: node.ancestors.slice(), order: node.order, code: node.code, name: node.name, status: "active" }));
    const problems = [];
    for (const node of live) for (const issue of nodeIssues(node, { organizationId: organization.id })) problems.push(issue.code);
    const tree = validateTree(live, { organizationId: organization.id });
    for (const issue of tree.issues) problems.push(issue.code);
    const readiness = activationReadiness({ status: "draft", organizationId: organization.id }, live);
    if (!readiness.ready) problems.push(...readiness.errors.map((error) => error.code));
    if (plan.chunks.some((chunk) => chunk.count > CHUNK_WRITES) || plan.chunks.length > MAX_CHUNKS) problems.push("CHUNKS");
    if (payloads.chunks.reduce((total, chunk) => total + chunk.writes.length, 0) !== plan.nodes.length) problems.push("PAYLOAD_COUNT");
    if (!NODE_ID_PATTERN.test(plan.verification.finalNodeId)) problems.push("FINAL_NODE_ID");
    if (!verifyPlanIntegrity(plan)) problems.push("DIGEST");
    if (problems.length) return { ok: false, diagnostics: [diag("PLAN_BUILD_FAILED", { detail: [...new Set(problems)].join(", ") })], plan: null, payloads: null };
    return { ok: true, diagnostics: [], plan, payloads };
  } catch (error) {
    return { ok: false, diagnostics: [diag("PLAN_BUILD_FAILED", { detail: error && error.message ? error.message : "lỗi" })], plan: null, payloads: null };
  }
}
