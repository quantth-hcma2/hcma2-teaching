// Library V2 P3-S2 - client-side WRITE contract for the curriculum collections (pure, inert).
// UI code must never build framework / node payloads by hand: every payload comes from here and matches the DEPLOYED P3-S1 Firestore Rules
// (ruleset 5945fbe7..., SHA-256 A0B206FC...921D) exactly; test/library-v2-p3-s2/contract.rules.test.mjs proves builder output is accepted by those Rules
// and mutated output is rejected. No Firestore, DOM, storage, clock or network access: the caller injects Firestore's serverTimestamp() factory.
//
// Client validation is EARLY validation only (clear errors before a doomed write, facts the Rules cannot prove such as ancestors consistency,
// sibling order and code uniqueness). It never replaces the Rules and never relaxes them: where this module and the Rules differ, the Rules win.
//
// Deliberately absent (later slices): clone planning and bulk writes, delete-draft planning (P3-S5); every builder for import, mapping or member
// read; no builder re-parents a node (structure is immutable in P3) and none changes `kind`, `organizationId`, `scope` or `cloneSource` after create.
import {
  CURRICULUM_SCHEMA_VERSION, FRAMEWORK_SCOPE, CURRICULUM_MAX_NODES, CURRICULUM_MAX_ANCESTORS,
  fail, requireId, normalizeNodeCode, validateFrameworkName, validateNodeName, validateNodeOrder, validateNodeKind, validateNodeStatus,
  validateCloneSourceFields, requireSameOrganizationCloneSource, requireWritableOrganization, requireEditableFramework, requireSameOrganization, requireFrameworkAction,
  ancestorsForChild, canAddChild, structureIssues, nextSiblingOrder, siblingsOf, codeInUse, activationReadiness
} from "./curriculum-model.mjs";

// Fields that can never change after create (Rules: fwImmutableOk / nodeImmutableOk). Named so a caller gets a precise error instead of a generic denial.
export const FRAMEWORK_IMMUTABLE_FIELDS = Object.freeze(["organizationId", "scope", "createdAt", "createdBy", "schemaVersion", "cloneSource"]);
export const NODE_IMMUTABLE_FIELDS = Object.freeze(["organizationId", "kind", "parentId", "ancestors", "createdAt", "schemaVersion"]);
export const NODE_UPDATABLE_FIELDS = Object.freeze(["name", "code", "order", "status"]);

// { frameworkId, nodeCount } for a framework created as a clone. The source must be a framework of the SAME organization (the Rules re-prove it).
export function buildCloneSource(sourceFramework, organization, nodeCount) {
  requireSameOrganizationCloneSource(sourceFramework, organization);
  return validateCloneSourceFields({ frameworkId: sourceFramework.id, nodeCount });
}

function uid(value) { return requireId(value, "actorUid"); }
function nodeContext({ organization, framework, nodes } = {}) {
  requireWritableOrganization(organization);
  requireEditableFramework(framework);
  requireSameOrganization(framework, organization);
  if (!Array.isArray(nodes)) fail("nodes", "the loaded node list of the framework is required (ancestors, order and code checks need it)", "NODES");
  return { organization, framework, nodes };
}
function requireLoadedNode(node, ctx) {
  const loaded = node && ctx.nodes.find((item) => item.id === node.id);
  if (!loaded) fail("node", "node is not among the loaded nodes of this framework", "NODE_NOT_FOUND");
  if (loaded.organizationId !== ctx.organization.id) fail("organizationId", "node belongs to another organization", "ORGANIZATION_MISMATCH");
  return loaded;
}
function parentKey(node) { return node.parentId === undefined || node.parentId === null ? null : node.parentId; }

export function createCurriculumWriteContract({ serverTimestamp } = {}) {
  if (typeof serverTimestamp !== "function") throw new TypeError("createCurriculumWriteContract requires { serverTimestamp }");
  const now = () => serverTimestamp();

  // ---------------------------------------------------------- frameworks (Platform Admin today; the Rules also admit curriculum.manage holders)
  // A framework is always created as a never-activated draft in an ACTIVE organization. cloneSource (optional): { framework: <source>, nodeCount }.
  function buildFrameworkCreate({ organization, name, cloneSource } = {}, actorUid) {
    requireWritableOrganization(organization);
    const data = {
      schemaVersion: CURRICULUM_SCHEMA_VERSION,
      organizationId: organization.id,
      scope: FRAMEWORK_SCOPE,
      name: validateFrameworkName(name),
      status: "draft",
      createdAt: now(),
      createdBy: uid(actorUid),
      updatedAt: now()
    };
    if (cloneSource !== undefined && cloneSource !== null) data.cloneSource = buildCloneSource(cloneSource.framework, organization, cloneSource.nodeCount);
    return data;
  }
  // Rename: draft or active frameworks only (an archived framework is read-only).
  function buildFrameworkRename(framework, name, { organization } = {}) {
    requireWritableOrganization(organization);
    requireEditableFramework(framework);
    requireSameOrganization(framework, organization);
    return { name: validateFrameworkName(name), updatedAt: now() };
  }
  function statusChange(framework, action, actorUid, organization) {
    requireWritableOrganization(organization);
    requireSameOrganization(framework, organization);
    const transition = requireFrameworkAction(framework, action);
    return { status: transition.to, statusChangedAt: now(), statusChangedBy: uid(actorUid), updatedAt: now() };
  }
  // draft -> active. Requires the loaded nodes: the activation precondition (structure, at least one active subject, complete clone) is validated here.
  // The FIRST activation stamps activatedAt (the Rules require exactly request.time and never allow it to change afterwards).
  function buildFrameworkActivate(framework, actorUid, { organization, nodes } = {}) {
    requireWritableOrganization(organization);
    if (!Array.isArray(nodes)) fail("nodes", "the loaded node list is required to validate activation", "NODES");
    const data = statusChange(framework, "activate", actorUid, organization);
    const readiness = activationReadiness(framework, nodes, { organization });
    if (!readiness.ready) fail("activation", "framework is not ready to activate: " + readiness.errors.map((e) => e.code).join(", "), "NOT_READY");
    return { ...data, activatedAt: now() };
  }
  // active -> archived (activatedAt untouched).
  const buildFrameworkArchive = (framework, actorUid, { organization } = {}) => statusChange(framework, "archive", actorUid, organization);
  // archived -> active (activatedAt untouched: it records the FIRST activation only).
  const buildFrameworkRestore = (framework, actorUid, { organization } = {}) => statusChange(framework, "restore", actorUid, organization);

  // ---------------------------------------------------------- nodes
  // ctx = { organization, framework, nodes } - the writable organization, the editable (draft/active) framework and its LOADED nodes.
  // input: { parent (loaded node | null), kind, name, code?, order?, id? }. `id` is optional (Firestore auto-ids are generated by doc(collection)); when
  // supplied it is checked against the ancestors (a node can never be its own ancestor or parent).
  function buildNodeCreate({ parent = null, kind, name, code, order, id } = {}, ctx) {
    const { organization, nodes } = nodeContext(ctx);
    let parentNode = null;
    if (parent !== null && parent !== undefined) {
      parentNode = nodes.find((item) => item.id === parent.id);
      if (!parentNode) fail("parent", "parent is not among the loaded nodes of this framework", "PARENT_NOT_FOUND");
      if (parentNode.organizationId !== organization.id) fail("organizationId", "parent belongs to another organization", "ORGANIZATION_MISMATCH");
    }
    if (!canAddChild(parentNode)) fail("parent", "maximum depth reached: a node can have at most " + CURRICULUM_MAX_ANCESTORS + " ancestors", "DEPTH_EXCEEDED");
    if (nodes.length >= CURRICULUM_MAX_NODES) fail("nodes", "a framework holds at most " + CURRICULUM_MAX_NODES + " nodes", "NODE_COUNT_EXCEEDED");
    const ancestors = ancestorsForChild(parentNode);
    const parentId = parentNode ? parentNode.id : null;
    if (id !== undefined) {
      requireId(id, "id");
      if (nodes.some((item) => item.id === id)) fail("id", "a node with this id already exists", "DUPLICATE_ID");
    }
    const structure = structureIssues({ id, parentId, ancestors });
    if (structure.length) fail("ancestors", "invalid node structure: " + structure.map((i) => i.code).join(", "), structure[0].code);
    const normalizedCode = normalizeNodeCode(code);
    if (codeInUse(nodes, normalizedCode)) fail("code", "code '" + normalizedCode + "' is already used in this framework", "DUPLICATE_CODE");
    const finalOrder = order === undefined ? nextSiblingOrder(nodes, parentId) : validateNodeOrder(order);
    if (order !== undefined && siblingsOf(nodes, parentId).some((item) => item.order === finalOrder)) fail("order", "another sibling already uses order " + finalOrder, "DUPLICATE_ORDER");
    return {
      schemaVersion: CURRICULUM_SCHEMA_VERSION,
      organizationId: organization.id,
      kind: validateNodeKind(kind),
      parentId,
      ancestors,
      order: finalOrder,
      code: normalizedCode,
      name: validateNodeName(name),
      status: "active",
      createdAt: now(),
      updatedAt: now()
    };
  }

  // Partial update of label / code / order / status only. Structure, kind and organization are immutable in P3: naming them is an error.
  function buildNodeUpdate(node, changes, ctx) {
    const { nodes } = nodeContext(ctx);
    const loaded = requireLoadedNode(node, ctx);
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) fail("changes", "changes must be an object", "CHANGES");
    const keys = Object.keys(changes);
    if (keys.length === 0) fail("changes", "at least one change is required", "CHANGES");
    for (const key of keys) {
      if (NODE_IMMUTABLE_FIELDS.includes(key)) fail(key, key + " is immutable after create (no re-parenting or kind change in P3)", "IMMUTABLE_FIELD");
      if (!NODE_UPDATABLE_FIELDS.includes(key)) fail(key, "unsupported field: " + key, "UNKNOWN_FIELD");
    }
    const data = {};
    if (has(changes, "name")) data.name = validateNodeName(changes.name);
    if (has(changes, "code")) {
      data.code = normalizeNodeCode(changes.code);
      if (codeInUse(nodes, data.code, loaded.id)) fail("code", "code '" + data.code + "' is already used in this framework", "DUPLICATE_CODE");
    }
    if (has(changes, "order")) {
      data.order = validateNodeOrder(changes.order);
      if (siblingsOf(nodes, parentKey(loaded)).some((item) => item.id !== loaded.id && item.order === data.order)) fail("order", "another sibling already uses order " + data.order, "DUPLICATE_ORDER");
    }
    if (has(changes, "status")) data.status = validateNodeStatus(changes.status);
    return { ...data, updatedAt: now() };
  }
  const buildNodeRename = (node, name, ctx) => buildNodeUpdate(node, { name }, ctx);
  const buildNodeCodeChange = (node, code, ctx) => buildNodeUpdate(node, { code }, ctx);
  function buildNodeRetire(node, ctx) {
    nodeContext(ctx);
    const loaded = requireLoadedNode(node, ctx);
    if (loaded.status !== "active") fail("status", "only an active node can be retired", "TRANSITION");
    return buildNodeUpdate(loaded, { status: "retired" }, ctx);
  }
  function buildNodeRestore(node, ctx) {
    nodeContext(ctx);
    const loaded = requireLoadedNode(node, ctx);
    if (loaded.status !== "retired") fail("status", "only a retired node can be restored", "TRANSITION");
    return buildNodeUpdate(loaded, { status: "active" }, ctx);
  }
  // plan = result of planSiblingMove(nodes, nodeId, direction). Returns [{ id, data: { order, updatedAt } }] (commit them in ONE batch). The resulting
  // sibling orders must be unique (a renumbering plan passes through temporary duplicates only inside the batch).
  function buildNodeReorder(plan, ctx) {
    const { nodes } = nodeContext(ctx);
    if (!plan || !Array.isArray(plan.changes)) fail("plan", "a planSiblingMove result is required", "PLAN");
    if (plan.noop || plan.changes.length === 0) fail("plan", "nothing to reorder", "NOOP");
    const next = new Map(nodes.map((item) => [item.id, { ...item }]));
    for (const change of plan.changes) {
      if (!next.has(change.id)) fail("plan", "plan references a node that is not loaded: " + change.id, "NODE_NOT_FOUND");
      validateNodeOrder(change.order);
      next.get(change.id).order = change.order;
    }
    const touchedParents = new Set(plan.changes.map((change) => parentKey(next.get(change.id))));
    if (touchedParents.size !== 1) fail("plan", "a reorder plan must stay among the siblings of ONE parent", "PLAN");
    const [parentId] = [...touchedParents];
    const orders = siblingsOf([...next.values()], parentId).map((item) => item.order);
    if (new Set(orders).size !== orders.length) fail("plan", "the plan would leave duplicate sibling orders", "DUPLICATE_ORDER");
    return plan.changes.map((change) => ({ id: change.id, data: { order: change.order, updatedAt: now() } }));
  }

  return Object.freeze({
    buildFrameworkCreate, buildFrameworkRename, buildFrameworkActivate, buildFrameworkArchive, buildFrameworkRestore,
    buildNodeCreate, buildNodeUpdate, buildNodeRename, buildNodeCodeChange, buildNodeRetire, buildNodeRestore, buildNodeReorder
  });
}
function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
