// Library V2 P4-S4 - IMPORT COMMIT / RECOVERY / ROLLBACK controller (no DOM, no Firebase import: the Firestore functions are injected, like the P3 writers).
//
// It executes the deterministic, already validated import plan of P4-S2 against the P4-S4 IMPORT-FREEZE Rules (candidate; the deployed P4-S1 ruleset 0b6910c3 does not freeze incomplete imports):
//   authorize -> importBatches/{X} (committing) -> curriculumFrameworks/{X} (draft) -> node chunks (<= 400 writes, separate commits) -> progress
//   -> SEAL (progress chunksDone := chunksTotal, written only when EVERY planned node is present: from this write the Rules freeze all node and framework mutations)
//   -> FULL server read-back verification of every planned node -> importBatches/{X} completed (only after the verification passed) -> server read-back of the final state before success.
// Rollback: committing -> partial (the BARRIER: atomic, stops every resume / seal / completion) -> delete nodes -> delete the framework -> partial -> rolled_back. The batch is never deleted.
// The Rules only witness the final node (finalNodeId); the seal + this controller's complete read-back are what make "completed" mean "exactly the plan".
//
// Design facts:
//  * ONE algorithm for a new import and for a resume / authorized takeover: read the batch (create it if absent), read the framework (create it if absent), list the nodes that exist,
//    classify them against the plan, write ONLY the missing nodes (atomic chunks), seal, verify, complete. Retries are idempotent; a progress counter is never trusted for completeness.
//  * Progress (chunksDone) is committed SEPARATELY after each node chunk (400 node writes + a progress write would exceed the 400-write cap; the frozen P4-S2 plan keeps 400-node chunks).
//    chunksDone is derived from the nodes that really exist; its final value (= chunksTotal) is the SEAL and is written only after the last node is present.
//  * Interrupted imports stay `committing` (anybody authorized may resume). `partial` is a durable stop (verification failed, abandoned, rollback started): per the Rules it can only go to `rolled_back`.
//  * Authorization is re-checked through `authorize()` before the batch, the framework, every chunk, the seal, the verification, the completion and every rollback phase; the organization is locked by the caller.
//  * There is NO fallback to the old transaction / re-read completion: the safety of the final interval comes from the Rules (see test/library-v2-p4-s4).
import { toBatchCreatePayload, toFrameworkPayload, toNodePayload, verifyPlanIntegrity, isExecutablePlan, canonicalJson } from "./import-plan.mjs";
import { sha256Hex } from "./import-sha256.mjs";
import { validateTree, activationReadiness, CURRICULUM_MAX_NODES, isValidId } from "./curriculum-model.mjs";

const freeze = Object.freeze;
export const NODE_PAGE = 500;                                  // read pages of the verification / rollback listing (<= 5000 nodes -> <= 11 pages)
export const MAX_ROLLBACK_ROUNDS = 40;                         // safety bound of the delete loop (5000 nodes = 13 rounds of 400)
export const RETRY_DELAYS_MS = freeze([400, 1200]);            // 3 attempts per step
export const STEP_TIMEOUT_MS = 90000;                          // a Firestore write queued while offline never settles: a write step that does not settle in time counts as a transient failure
export const READ_TIMEOUT_MS = 120000;                         // server reads fail fast when offline; this only bounds a read that hangs
export const RESULT_CODES = freeze({ verifyFailed: "VERIFY_FAILED", abandoned: "ABANDONED", rollbackStarted: "ROLLBACK_STARTED", rolledBack: "ROLLED_BACK" });
const NODE_KEYS = freeze(["schemaVersion", "organizationId", "kind", "parentId", "ancestors", "order", "code", "name", "status", "createdAt", "updatedAt"]);
const TRANSIENT = new Set(["unavailable", "deadline-exceeded", "aborted", "resource-exhausted", "internal", "cancelled", "unknown"]);

// ---------------------------------------------------------------- error classification (the view maps these to Vietnamese; raw errors never reach the user)
export function classifyError(error) {
  const code = error && typeof error.code === "string" ? error.code.replace(/^firestore\//, "") : "";
  if (code === "permission-denied" || code === "unauthenticated") return "permission";
  if (TRANSIENT.has(code)) return "transient";
  if (code === "not-found") return "not-found";
  if (code === "already-exists" || code === "failed-precondition") return "conflict";
  if (!code && error && /network|offline|fetch|timeout|failed to get document because the client is offline/i.test(String(error.message || ""))) return "transient";
  return "unknown";
}

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isTimestamp = (value) => !!value && (typeof value.toMillis === "function" || value instanceof Date);
const sameJson = (a, b) => canonicalJson(a === undefined ? null : a) === canonicalJson(b === undefined ? null : b);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const plainDoc = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });
// A "server" read still overlays this client's own queued writes (latency compensation). Such a document is NOT yet acknowledged by the server, so it can prove nothing:
// the read is reported as transient (the retry / resume reads again once the server has acknowledged or rejected the write).
const unsettled = () => Object.assign(new Error("document has pending (unacknowledged) writes"), { code: "unavailable" });
const settledOrThrow = (snapshot) => { if (snapshot && (snapshot.metadata?.hasPendingWrites || snapshot.metadata?.fromCache)) throw unsettled(); return snapshot; };
const minimalNode = (n) => ({ id: n.id, kind: n.kind, parentId: n.parentId, ancestors: n.ancestors, code: n.code, name: n.name, order: n.order, status: n.status, organizationId: n.organizationId });

// ================================================================ pure: full read-back verification
// stored: { framework, batch, nodes } as read back from Firestore (nodes = [{ id, ...data }]). Never throws. `repairable` is true only when the SOLE problem is missing nodes
// (a resume can write them); any extra / altered / structural problem makes the import non-repairable (rollback is the only way forward).
export function verifyImportedDataset({ plan, framework, batch, nodes, organizationId } = {}) {
  const issues = [];
  const add = (code, detail) => issues.push(detail === undefined ? { code } : { code, detail });
  if (!isExecutablePlan(plan) || !verifyPlanIntegrity(plan)) return freeze({ ok: false, repairable: false, issues: [{ code: "PLAN_INTEGRITY" }], counts: { expected: 0, found: 0, missing: 0, extra: 0, altered: 0 }, missingIds: [], extraIds: [], altered: [] });
  const org = organizationId === undefined ? plan.organizationId : organizationId;
  // ---- identity: batch / framework / plan / locked organization
  if (org !== plan.organizationId) add("ORGANIZATION_MISMATCH", "plan");
  if (!batch) add("BATCH_MISSING");
  else {
    if (batch.id !== plan.batch.id || !batch.destination || batch.destination.frameworkId !== plan.framework.id || batch.destination.type !== "curriculumFramework") add("IDENTITY_MISMATCH", "batch");
    if (batch.organizationId !== org) add("ORGANIZATION_MISMATCH", "batch");
    if (batch.kind !== "curriculum" || batch.templateId !== plan.batch.templateId || batch.templateVersion !== plan.batch.templateVersion) add("BATCH_FACTS", "template");
    if (!sameJson(batch.counts, plan.batch.counts) || batch.chunksTotal !== plan.batch.chunksTotal || batch.finalNodeId !== plan.batch.finalNodeId) add("BATCH_FACTS", "plan facts");
    if (!batch.sourceFile || batch.sourceFile.sha256 !== plan.batch.sourceFile.sha256 || batch.sourceFile.size !== plan.batch.sourceFile.size) add("BATCH_FACTS", "source file");
    if (batch.status !== "committing" && batch.status !== "completed") add("BATCH_STATUS", batch.status);
  }
  if (!framework) add("FRAMEWORK_MISSING");
  else {
    if (framework.id !== plan.framework.id) add("IDENTITY_MISMATCH", "framework");
    if (framework.organizationId !== org) add("ORGANIZATION_MISMATCH", "framework");
    if (framework.scope !== "organization" || framework.name !== plan.framework.name) add("FRAMEWORK_FACTS", "name/scope");
    if (framework.status !== "draft" || has(framework, "activatedAt") || has(framework, "cloneSource")) add("FRAMEWORK_STATUS", framework.status);
  }
  // ---- nodes
  const list = Array.isArray(nodes) ? nodes : [];
  const expected = plan.verification.expectedNodes;
  const expectedById = new Map(expected.map((node) => [node.id, node]));
  const storedById = new Map();
  for (const node of list) storedById.set(node.id, node);
  const missingIds = expected.filter((node) => !storedById.has(node.id)).map((node) => node.id);
  const extraIds = list.filter((node) => !expectedById.has(node.id)).map((node) => node.id);
  const altered = [];
  for (const node of list) {
    const want = expectedById.get(node.id);
    if (!want) continue;
    const fields = [];
    const keys = Object.keys(node).filter((key) => key !== "id").sort();
    if (keys.length !== NODE_KEYS.length || NODE_KEYS.some((key) => !keys.includes(key))) fields.push("keys");
    if (node.schemaVersion !== 1) fields.push("schemaVersion");
    for (const key of ["organizationId", "kind", "parentId", "code", "name", "order", "status"]) if (!sameJson(node[key], want[key])) fields.push(key);
    if (!sameJson(node.ancestors, want.ancestors)) fields.push("ancestors");
    if (!isTimestamp(node.createdAt) || !isTimestamp(node.updatedAt)) fields.push("timestamps");
    if (fields.length) altered.push({ id: node.id, fields });
  }
  if (missingIds.length) add("NODES_MISSING", missingIds.length);
  if (extraIds.length) add("NODES_EXTRA", extraIds.length);
  if (altered.length) add("NODES_ALTERED", altered.length);
  if (list.length !== expected.length) add("NODE_COUNT", list.length);
  if (!storedById.has(plan.verification.finalNodeId)) add("FINAL_NODE_MISSING");
  // ---- structure, ordering, canonical code uniqueness, hierarchy (the P3 validators over what is REALLY stored)
  const live = list.map((node) => ({ id: node.id, schemaVersion: node.schemaVersion, organizationId: node.organizationId, kind: node.kind, parentId: node.parentId === undefined ? null : node.parentId, ancestors: Array.isArray(node.ancestors) ? node.ancestors : [], order: node.order, code: node.code === undefined ? null : node.code, name: node.name, status: node.status }));
  const tree = validateTree(live, { organizationId: org });
  for (const issue of tree.issues) add("TREE_" + issue.code, issue.nodeId);
  if (framework && framework.status === "draft") {
    const readiness = activationReadiness({ status: "draft", organizationId: org }, live);
    if (!readiness.ready && !tree.issues.length) for (const error of readiness.errors) add(error.code);
  }
  // ---- digests: the stored dataset must equal the planned dataset (set of ids and exact content)
  const sorted = list.map(minimalNode).sort(byId);
  if (sha256Hex(sorted.map((node) => node.id).join("\n")) !== plan.verification.nodeIdSetDigest) add("DIGEST_IDS");
  if (sha256Hex(canonicalJson(sorted)) !== plan.verification.contentDigest) add("DIGEST_CONTENT");
  const repairableCodes = new Set(["NODES_MISSING", "NODE_COUNT", "FINAL_NODE_MISSING", "DIGEST_IDS", "DIGEST_CONTENT", "TREE_PARENT_MISSING", "NO_ACTIVE_SUBJECT"]);
  const repairable = issues.length > 0 && missingIds.length > 0 && extraIds.length === 0 && altered.length === 0 && issues.every((issue) => repairableCodes.has(issue.code));
  return freeze({
    ok: issues.length === 0, repairable, issues,
    counts: { expected: expected.length, found: list.length, missing: missingIds.length, extra: extraIds.length, altered: altered.length },
    missingIds: missingIds.slice(0, 20), extraIds: extraIds.slice(0, 20), altered: altered.slice(0, 20)
  });
}

// Which batch is this stored batch about: the re-selected file must rebuild EXACTLY the plan facts that were frozen in the batch at creation (immutable fields).
export function batchMatchesPlan(batch, plan, organizationId) {
  if (!batch || !isExecutablePlan(plan)) return false;
  return batch.id === plan.batch.id && batch.organizationId === organizationId && plan.organizationId === organizationId && batch.kind === "curriculum" &&
    batch.destination && batch.destination.type === "curriculumFramework" && batch.destination.frameworkId === plan.framework.id &&
    batch.templateId === plan.batch.templateId && batch.templateVersion === plan.batch.templateVersion &&
    sameJson(batch.counts, plan.batch.counts) && batch.chunksTotal === plan.batch.chunksTotal && batch.finalNodeId === plan.batch.finalNodeId &&
    !!batch.sourceFile && batch.sourceFile.sha256 === plan.batch.sourceFile.sha256 && batch.sourceFile.size === plan.batch.sourceFile.size;
}

// ================================================================ the controller
export function createImportCommitController({ db, firestore, sleep, retryDelays = RETRY_DELAYS_MS, stepTimeoutMs = STEP_TIMEOUT_MS, readTimeoutMs = READ_TIMEOUT_MS } = {}) {
  const fs = firestore || {};
  for (const name of ["collection", "doc", "getDocFromServer", "getDocsFromServer", "query", "where", "limit", "orderBy", "startAfter", "documentId", "writeBatch", "setDoc", "updateDoc", "deleteDoc", "serverTimestamp"]) {
    if (typeof fs[name] !== "function") throw new TypeError("createImportCommitController requires the Firestore function: " + name);
  }
  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const batchRef = (id) => fs.doc(db, "importBatches", id);
  const frameworkRef = (id) => fs.doc(db, "curriculumFrameworks", id);
  const nodeRef = (frameworkId, id) => fs.doc(db, "curriculumFrameworks", frameworkId, "nodes", id);
  const nodesCol = (frameworkId) => fs.collection(db, "curriculumFrameworks", frameworkId, "nodes");

  const stop = (state, extra = {}) => freeze({ ok: false, state, ...extra });
  const emit = (onProgress, event) => { if (typeof onProgress === "function") { try { onProgress(event); } catch { /* a UI callback can never break a commit */ } } };

  // ---------------------------------------------------------------- reads
  // A non-admin's read of a document that does NOT exist is answered permission-denied by the deployed Rules (null resource): it is treated as "absent".
  // If the user really may not touch the document, the WRITE that follows is refused by the Rules - nothing is ever granted by this reading.
  async function readDoc(ref) {
    try { const s = settledOrThrow(await fs.getDocFromServer(ref)); return s.exists() ? plainDoc(s) : null; }
    catch (error) { if (classifyError(error) === "permission") return null; throw error; }
  }
  const readBatch = (id) => readDoc(batchRef(id));
  const readFramework = (id) => readDoc(frameworkRef(id));
  const nodeExists = async (frameworkId, id) => (await readDoc(nodeRef(frameworkId, id))) !== null;
  // Every node of ONE framework, paged by document id (the approved P3 form: one organizationId equality, document-id order: no composite index). Bounded by `maxNodes + 1`.
  async function readNodes(frameworkId, organizationId, { maxNodes = CURRICULUM_MAX_NODES + 1, onPage } = {}) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < 40; page++) {
      const constraints = [fs.where("organizationId", "==", organizationId), fs.orderBy(fs.documentId())];
      if (cursor) constraints.push(fs.startAfter(cursor));
      constraints.push(fs.limit(NODE_PAGE));
      const snapshot = await fs.getDocsFromServer(fs.query(nodesCol(frameworkId), ...constraints));
      for (const d of snapshot.docs) items.push(plainDoc(settledOrThrow(d)));
      if (typeof onPage === "function") onPage(items.length);
      if (snapshot.docs.length < NODE_PAGE || items.length >= maxNodes) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    return items;
  }
  // The caller's organization incomplete batches (committing | partial): two equality-only queries (no `in`, no composite index), bounded.
  async function findIncomplete(organizationId) {
    if (!isValidId(organizationId)) throw new TypeError("organizationId is required");
    const found = [];
    for (const status of ["committing", "partial"]) {
      const snapshot = await fs.getDocsFromServer(fs.query(fs.collection(db, "importBatches"), fs.where("organizationId", "==", organizationId), fs.where("status", "==", status), fs.limit(21)));
      for (const d of snapshot.docs) { const batch = plainDoc(d); if (batch.organizationId === organizationId) found.push(batch); }
    }
    return found.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // ---------------------------------------------------------------- guarded steps
  // Runs one step with bounded retries and a settle timeout. A transient failure waits and retries; anything else (or the last transient failure) is reported, never swallowed.
  // Every read goes to the SERVER (getDocFromServer / getDocsFromServer): a locally queued write or a cached document is never mistaken for committed data.
  const settle = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("step did not settle"), { code: "deadline-exceeded" })), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  const WRITE_LABELS = /^(create-|chunk-|delete-|progress|partial|complete|rolled-back)/;
  async function withRetry(step, label) {
    const ms = WRITE_LABELS.test(label) ? stepTimeoutMs : readTimeoutMs;  
    let last = null;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try { return { ok: true, value: await settle(Promise.resolve().then(() => step(attempt)), ms) }; }
      catch (error) {
        last = error;
        if (classifyError(error) !== "transient" || attempt === retryDelays.length) break;
        await wait(retryDelays[attempt]);
      }
    }
    return { ok: false, error: last, kind: classifyError(last), label };
  }
  async function checkAuthorized(authorize) {
    if (typeof authorize !== "function") return { allowed: false, reason: "NO_AUTHORIZER" };
    try { const verdict = await authorize(); return verdict && verdict.allowed === true ? { allowed: true } : { allowed: false, reason: (verdict && verdict.reason) || "DENIED" }; }
    catch { return { allowed: false, reason: "ACCESS_CHECK_FAILED" }; }
  }
  const failureState = (kind) => (kind === "permission" ? "denied" : kind === "transient" ? "paused" : "error");

  async function markPartial(batchId, resultCode) {
    return withRetry(() => fs.updateDoc(batchRef(batchId), { status: "partial", resultCode, finishedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }), "partial");
  }

  // ---------------------------------------------------------------- COMMIT (new import or resume: the same idempotent algorithm)
  // options: { plan, organizationId (locked), actorUid, authorize(), onProgress(), resume: boolean }
  async function commit({ plan, organizationId, actorUid, authorize, onProgress, resume = false } = {}) {
    if (!isExecutablePlan(plan) || !verifyPlanIntegrity(plan)) return stop("invalid-plan");
    if (!isValidId(organizationId) || plan.organizationId !== organizationId) return stop("organization-mismatch");
    const batchId = plan.batch.id;
    const total = plan.nodes.length;
    const progress = (phase, extra = {}) => emit(onProgress, { phase, nodesTotal: total, chunksTotal: plan.chunks.length, ...extra });
    const auth = async () => (await checkAuthorized(authorize));
    let denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason });
    if (!isValidId(actorUid)) return stop("invalid-actor");

    // 1. the batch (the Rules: it can only be created while no framework with the same id exists)
    progress("batch", { nodesWritten: 0 });
    let batch = null;
    { const r = await withRetry(() => readBatch(batchId), "read-batch"); if (!r.ok) return stop(failureState(r.kind), { phase: "batch", kind: r.kind }); batch = r.value; }
    if (!batch) {
      if (resume) return stop("batch-missing");
      const existing = await withRetry(() => findIncomplete(organizationId), "find-incomplete");
      if (!existing.ok) return stop(failureState(existing.kind), { phase: "batch", kind: existing.kind });
      if (existing.value.length) return stop("blocked", { reason: "INCOMPLETE_EXISTS", batches: existing.value });
      const data = toBatchCreatePayload(plan, { actorUid, serverTimestamp: fs.serverTimestamp });
      const created = await withRetry(async () => {
        try { await fs.setDoc(batchRef(batchId), data); }
        catch (error) { const again = await readBatch(batchId).catch(() => null); if (again && batchMatchesPlan(again, plan, organizationId) && again.status === "committing") return again; throw error; }   // ambiguous success
      }, "create-batch");
      if (!created.ok) return stop(failureState(created.kind), { phase: "batch", kind: created.kind });
      const r = await withRetry(() => readBatch(batchId), "read-batch"); if (!r.ok || !r.value) return stop("paused", { phase: "batch", kind: "transient" });
      batch = r.value;
    }
    if (!batchMatchesPlan(batch, plan, organizationId)) return stop("identity-mismatch", { phase: "batch" });
    if (batch.status !== "committing") return stop("not-committing", { status: batch.status, phase: "batch" });

    // 2. the framework (draft, real name)
    denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "framework" });
    progress("framework", { nodesWritten: 0 });
    let framework = null;
    { const r = await withRetry(() => readFramework(batchId), "read-framework"); if (!r.ok) return stop(failureState(r.kind), { phase: "framework", kind: r.kind }); framework = r.value; }
    if (!framework) {
      const data = toFrameworkPayload(plan, { actorUid, serverTimestamp: fs.serverTimestamp });
      const created = await withRetry(async () => {
        try { await fs.setDoc(frameworkRef(batchId), data); }
        catch (error) { const again = await readFramework(batchId).catch(() => null); if (again && again.organizationId === organizationId && again.status === "draft") return again; throw error; }
      }, "create-framework");
      if (!created.ok) return stop(failureState(created.kind), { phase: "framework", kind: created.kind });
    }

    // 3. what really exists -> only the MISSING nodes are written (idempotent retries; no counter is trusted)
    progress("scan", { nodesWritten: 0 });
    let existing = [];
    { const r = await withRetry(() => readNodes(batchId, organizationId), "scan-nodes"); if (!r.ok) return stop(failureState(r.kind), { phase: "scan", kind: r.kind }); existing = r.value; }
    const interim = verifyImportedDataset({ plan, framework: await readFramework(batchId).catch(() => null), batch, nodes: existing });
    if (interim.counts.extra > 0 || interim.counts.altered > 0) return await failVerification({ plan, organizationId, verification: interim, batchId, phase: "scan" });
    const present = new Set(existing.map((node) => node.id));
    let written = present.size;
    progress("nodes", { nodesWritten: written, chunk: 0 });
    // a SEALED batch (chunksDone == chunksTotal) is frozen by the Rules: a planned node that is missing there can never be written again -> durable stop, rollback is the only way forward
    if ((batch.chunksDone || 0) >= plan.chunks.length && present.size < plan.nodes.length) return await failVerification({ plan, organizationId, verification: interim, batchId, phase: "scan" });

    // 4. node chunks (atomic, <= 400 writes) in plan order; progress is committed separately
    for (const chunk of plan.chunks) {
      const missing = plan.nodes.slice(chunk.from, chunk.to).filter((node) => !present.has(node.id));
      if (missing.length) {
        denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "nodes", nodesWritten: written });
        const writes = missing.map((node) => ({ id: node.id, data: toNodePayload(node, { serverTimestamp: fs.serverTimestamp }) }));
        const wrote = await withRetry(async () => {
          // an earlier attempt may have committed although the client saw an error: the chunk is atomic, so one probe tells (the LAST node of the chunk)
          const probe = writes[writes.length - 1];
          if (await nodeExists(batchId, probe.id)) return "already";
          const atomic = fs.writeBatch(db);
          for (const item of writes) atomic.set(nodeRef(batchId, item.id), item.data);
          try { await atomic.commit(); } catch (error) { if (await nodeExists(batchId, probe.id).catch(() => false)) return "committed"; throw error; }
          return "committed";
        }, "chunk-" + chunk.index);
        if (!wrote.ok) return stop(failureState(wrote.kind), { phase: "nodes", kind: wrote.kind, chunk: chunk.index, nodesWritten: written });
        for (const item of writes) present.add(item.id);
        written = present.size;
      }
      // chunksDone = number of LEADING chunks that are completely present (monotonic: the Rules refuse a decrease)
      let done = 0; for (const c of plan.chunks) { if (plan.nodes.slice(c.from, c.to).every((node) => present.has(node.id))) done++; else break; }
      progress("nodes", { nodesWritten: written, chunk: chunk.index + 1 });
      if (done > (batch.chunksDone || 0) && done < plan.chunks.length) {
        const p = await withRetry(() => fs.updateDoc(batchRef(batchId), { chunksDone: done, updatedAt: fs.serverTimestamp() }), "progress");
        if (p.ok) batch = { ...batch, chunksDone: done };
        else if (p.kind === "permission") return stop("denied", { phase: "progress" });
        // a failed progress write is not fatal: the data is what counts and the final verification decides
      }
    }

    // 5. SEAL: every planned node is present, so declare it (progress chunksDone := chunksTotal). From this write on the Rules freeze every node and framework mutation until the batch leaves
    //    'committing': the node set read back next is exactly the node set at completion. Never written while a planned node is missing.
    if (present.size !== plan.nodes.length) return stop("incomplete", { phase: "seal", nodesWritten: written });
    if ((batch.chunksDone || 0) < plan.chunks.length) {
      denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "seal", nodesWritten: written });
      progress("seal", { nodesWritten: written });
      const sealed = await withRetry(() => fs.updateDoc(batchRef(batchId), { chunksDone: plan.chunks.length, updatedAt: fs.serverTimestamp() }), "progress");
      if (!sealed.ok) { const again = await readBatch(batchId).catch(() => null); if (again && again.status !== "committing") return stop("not-committing", { status: again.status, phase: "seal" }); return stop(failureState(sealed.kind), { phase: "seal", kind: sealed.kind, nodesWritten: written }); }
      batch = { ...batch, chunksDone: plan.chunks.length };
    }

    // 6. FULL read-back verification of everything that exists (never "the counter says so")
    denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "verify" });
    progress("verify", { nodesWritten: written, verified: 0 });
    let readBack = null;
    { const r = await withRetry(async () => {
        const nodes = await readNodes(batchId, organizationId, { onPage: (count) => progress("verify", { nodesWritten: written, verified: count }) });
        const [fw, b] = await Promise.all([readFramework(batchId), readBatch(batchId)]);
        return { nodes, fw, b };
      }, "verify-read");
      if (!r.ok) return stop(failureState(r.kind), { phase: "verify", kind: r.kind, nodesWritten: written }); readBack = r.value; }
    const verification = verifyImportedDataset({ plan, framework: readBack.fw, batch: readBack.b, nodes: readBack.nodes });
    if (!verification.ok) {
      return await failVerification({ plan, organizationId, verification, batchId, phase: "verify" });
    }

    // 7. completion (the Rules: committing -> completed needs chunksDone == chunksTotal, the paired draft framework and the witness node) and server read-back of the final state
    denied = await auth(); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "complete" });
    progress("complete", { nodesWritten: written, verified: total });
    const completed = await withRetry(async () => {
      try { await fs.updateDoc(batchRef(batchId), { status: "completed", chunksDone: plan.chunks.length, finishedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }); }
      catch (error) { const again = await readBatch(batchId).catch(() => null); if (again && again.status === "completed") return "already"; throw error; }
    }, "complete");
    if (!completed.ok) {                                                    // another client may have stopped the import (rollback barrier / abandon) inside the window: say so
      const again = await readBatch(batchId).catch(() => null);
      if (again && again.status !== "committing" && again.status !== "completed") return stop("not-committing", { status: again.status, phase: "complete" });
      return stop(failureState(completed.kind), { phase: "complete", kind: completed.kind, verification, nodesWritten: written });
    }
    const [finalBatch, finalFramework] = await Promise.all([readBatch(batchId).catch(() => null), readFramework(batchId).catch(() => null)]);
    if (!finalBatch || finalBatch.status !== "completed" || !finalFramework || finalFramework.status !== "draft" || has(finalFramework, "activatedAt")) return stop("unconfirmed", { phase: "complete", verification });
    const eligibility = activationEligibility({ batch: finalBatch, framework: finalFramework, nodes: readBack.nodes });
    progress("done", { nodesWritten: written, verified: total });
    return freeze({ ok: true, state: "completed", batchId, frameworkId: batchId, nodesWritten: written, verification, eligibility, batch: finalBatch });
  }

  // verification failure that a resume cannot repair: durable `partial` (only rollback can follow) - the batch can never be completed afterwards
  async function failVerification({ plan, organizationId, verification, batchId, phase }) {
    const marked = await markPartial(batchId, RESULT_CODES.verifyFailed);
    return stop("verification-failed", { phase, verification, markedPartial: marked.ok, organizationId });
  }

  // Draft activation eligibility: only a COMPLETED batch + a never-activated draft framework + a ready tree (the P3 lifecycle then activates it; the Rules enforce the batch).
  function activationEligibility({ batch, framework, nodes }) {
    const readiness = framework && framework.status === "draft" ? activationReadiness({ status: "draft", organizationId: framework.organizationId }, (nodes || []).map((n) => ({ id: n.id, schemaVersion: n.schemaVersion, organizationId: n.organizationId, kind: n.kind, parentId: n.parentId === undefined ? null : n.parentId, ancestors: n.ancestors || [], order: n.order, code: n.code === undefined ? null : n.code, name: n.name, status: n.status }))) : { ready: false, errors: [{ code: "NOT_DRAFT" }] };
    const eligible = !!batch && batch.status === "completed" && !!framework && framework.status === "draft" && !has(framework, "activatedAt") && readiness.ready;
    return freeze({ eligible, batchCompleted: !!batch && batch.status === "completed", readiness: readiness.ready, errors: readiness.errors.map((e) => e.code) });
  }

  // ---------------------------------------------------------------- explicit abandonment (a deliberate, durable stop; rollback is then the only way forward)
  async function abandon({ batchId, organizationId, authorize } = {}) {
    if (!isValidId(batchId) || !isValidId(organizationId)) return stop("invalid");
    const denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason });
    const batch = await readBatch(batchId).catch(() => null);
    if (!batch || batch.organizationId !== organizationId) return stop("organization-mismatch");
    if (batch.status !== "committing") return stop("not-committing", { status: batch.status });
    const marked = await markPartial(batchId, RESULT_CODES.abandoned);
    return marked.ok ? freeze({ ok: true, state: "partial" }) : stop(failureState(marked.kind), { kind: marked.kind });
  }

  // ---------------------------------------------------------------- ROLLBACK (Rules order: nodes, then the framework, then importBatches -> rolled_back; the batch is never deleted)
  async function rollback({ batchId, organizationId, authorize, onProgress } = {}) {
    if (!isValidId(batchId) || !isValidId(organizationId)) return stop("invalid");
    const progress = (phase, extra = {}) => emit(onProgress, { phase, ...extra });
    let denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason });
    const batchRead = await withRetry(() => readBatch(batchId), "read-batch"); if (!batchRead.ok) return stop(failureState(batchRead.kind), { kind: batchRead.kind });
    const batch = batchRead.value;
    if (!batch || batch.organizationId !== organizationId || !batch.destination || batch.destination.frameworkId !== batchId) return stop("organization-mismatch");   // never another organization's batch
    if (batch.status === "rolled_back") return freeze({ ok: true, state: "rolled_back", already: true });
    if (batch.status !== "committing" && batch.status !== "partial") return stop("not-rollbackable", { status: batch.status });
    const frameworkRead = await withRetry(() => readFramework(batchId), "read-framework"); if (!frameworkRead.ok) return stop(failureState(frameworkRead.kind), { kind: frameworkRead.kind });
    let framework = frameworkRead.value;
    if (framework && (framework.organizationId !== organizationId || framework.status !== "draft" || has(framework, "activatedAt"))) return stop("framework-not-deletable", { status: framework.status });
    // 0. BARRIER: committing -> partial. The Rules read the batch status on every node create / seal / completion, so after this atomic write nobody can create a node or complete the import;
    //    a concurrent resume (another client) simply stops. Already partial (abandoned / verification failed / rollback started by someone else): the barrier is in place.
    if (batch.status === "committing") {
      denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "barrier" });
      const barrier = await withRetry(() => fs.updateDoc(batchRef(batchId), { status: "partial", resultCode: RESULT_CODES.rollbackStarted, finishedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }), "partial");
      if (!barrier.ok) {
        const again = await readBatch(batchId).catch(() => null);
        if (!again || again.status === "completed") return stop("not-rollbackable", { status: again ? again.status : "missing" });   // completed is terminal: the import finished first
        if (again.status !== "partial" && again.status !== "rolled_back") return stop(failureState(barrier.kind), { phase: "barrier", kind: barrier.kind });
      }
    }
    // 1. nodes (repeat: list a page, delete it in atomic batches of <= 400, until the framework holds none)
    let deleted = 0;
    for (let round = 0; round < MAX_ROLLBACK_ROUNDS; round++) {
      denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "nodes", nodesDeleted: deleted });
      const page = await withRetry(async () => {
        const snapshot = await fs.getDocsFromServer(fs.query(nodesCol(batchId), fs.where("organizationId", "==", organizationId), fs.orderBy(fs.documentId()), fs.limit(NODE_PAGE)));
        return snapshot.docs.map((d) => d.id);
      }, "list-nodes");
      if (!page.ok) return stop(failureState(page.kind), { phase: "nodes", kind: page.kind, nodesDeleted: deleted });
      if (page.value.length === 0) break;
      for (let from = 0; from < page.value.length; from += 400) {
        const ids = page.value.slice(from, from + 400);
        const r = await withRetry(async () => { const atomic = fs.writeBatch(db); for (const id of ids) atomic.delete(nodeRef(batchId, id)); await atomic.commit(); }, "delete-nodes");
        if (!r.ok) return stop(failureState(r.kind), { phase: "nodes", kind: r.kind, nodesDeleted: deleted });
        deleted += ids.length;
        progress("rollback-nodes", { nodesDeleted: deleted });
      }
    }
    const leftover = await withRetry(async () => (await fs.getDocsFromServer(fs.query(nodesCol(batchId), fs.where("organizationId", "==", organizationId), fs.limit(1)))).docs.length, "check-empty");
    if (!leftover.ok) return stop(failureState(leftover.kind), { phase: "nodes", kind: leftover.kind });
    if (leftover.value > 0) return stop("nodes-remain", { phase: "nodes", nodesDeleted: deleted });
    // 2. the framework (a never-activated draft: the Rules)
    if (framework) {
      denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "framework" });
      progress("rollback-framework", { nodesDeleted: deleted });
      const r = await withRetry(async () => { try { await fs.deleteDoc(frameworkRef(batchId)); } catch (error) { if (!(await readFramework(batchId).catch(() => framework))) return; throw error; } }, "delete-framework");
      if (!r.ok) return stop(failureState(r.kind), { phase: "framework", kind: r.kind, nodesDeleted: deleted });
    }
    framework = await readFramework(batchId).catch(() => framework);
    if (framework) return stop("framework-remains", { phase: "framework" });
    // 3. the batch (never deleted): rolled_back only now that the framework and the witness node are gone
    denied = await checkAuthorized(authorize); if (!denied.allowed) return stop("denied", { reason: denied.reason, phase: "batch" });
    progress("rollback-batch", { nodesDeleted: deleted });
    const r = await withRetry(async () => {
      try { await fs.updateDoc(batchRef(batchId), { status: "rolled_back", resultCode: RESULT_CODES.rolledBack, finishedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }); }
      catch (error) { const again = await readBatch(batchId).catch(() => null); if (again && again.status === "rolled_back") return; throw error; }
    }, "rolled-back");
    if (!r.ok) return stop(failureState(r.kind), { phase: "batch", kind: r.kind, nodesDeleted: deleted });
    const finalBatch = await readBatch(batchId).catch(() => null);
    if (!finalBatch || finalBatch.status !== "rolled_back") return stop("unconfirmed", { phase: "batch" });
    return freeze({ ok: true, state: "rolled_back", nodesDeleted: deleted, batch: finalBatch });
  }

  return freeze({
    newBatchId: () => fs.doc(fs.collection(db, "importBatches")).id,
    findIncomplete, commit, rollback, abandon, readBatch, readFramework, readNodes, activationEligibility
  });
}
