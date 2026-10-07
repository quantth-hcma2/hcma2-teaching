// Library V2 P3-S2 - curriculum DOMAIN model (pure, inert). Constants, normalization/validation, lifecycle facts, node-tree logic.
// No Firestore, DOM, storage, network or clock access; nothing here is wired into index.html (P3-S3/S4 will consume it).
//
// Authority: LIBRARY_V2_P3_DESIGN_R1.md (sections 4, 5, 9, 11), LIBRARY_V2_FROZEN_CONTRACTS_v1.1.md section 6, and the DEPLOYED P3-S1
// Firestore Rules (ruleset 5945fbe7-d5db-4e23-b355-a7b17793c7a8, SHA-256 A0B206FC...921D) - the Rules are authoritative. Everything here is
// EARLY validation for the UI and the write contract; it never replaces the Rules. Facts the Rules cannot prove (ancestors equal the real parent
// chain, sibling order and code uniqueness, the 5000-node / 100-framework bounds, a complete clone) are checked here by validateTree.
//
// Not in this module (later slices): clone planning, delete-draft planning, chunked writes (P3-S5); anything UI (P3-S3/S4).

const freeze = Object.freeze;
const has = (object, key) => object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);

// ---------------------------------------------------------------- constants (P3 Design R1 section 5.3, mirrored from the deployed Rules)
export const CURRICULUM_SCHEMA_VERSION = 1;
export const FRAMEWORK_SCOPE = "organization";
export const FRAMEWORK_STATUSES = freeze(["draft", "active", "archived"]);
export const NODE_KINDS = freeze(["subject", "unit", "lesson"]);
export const NODE_STATUSES = freeze(["active", "retired"]);
export const CURRICULUM_MAX_DEPTH = 4;
export const CURRICULUM_MAX_ANCESTORS = CURRICULUM_MAX_DEPTH - 1;
export const CURRICULUM_MAX_NODES = 5000;
export const CURRICULUM_UI_LEVELS = 2;
export const FRAMEWORK_NAME_MIN = 3;
export const FRAMEWORK_NAME_MAX = 120;
export const NODE_NAME_MIN = 1;
export const NODE_NAME_MAX = 200;
export const NODE_CODE_MIN = 1;
export const NODE_CODE_MAX = 40;
export const NODE_ORDER_MIN = 0;
export const NODE_ORDER_MAX = 100000;
export const CLONE_NODE_COUNT_MAX = CURRICULUM_MAX_NODES;
export const FRAMEWORK_LIST_LIMIT = 100;
// Implementation safety default (same measured budget as the membership chunks); consumed by the later bulk operations (P3-S5), not by S2.
export const NODE_WRITE_CHUNK = 400;
// Presentation default for the framework list (P3 Design R1 Q1: "status group, newest first"); the UI may override it per call.
export const FRAMEWORK_LIST_STATUS_ORDER = freeze(["active", "draft", "archived"]);
// P3 UI exposes MON -> BAI only (Frozen Contracts s6 "Initial UX exposes MON -> BAI"); `unit` stays in the model and in the Rules.
export const UI_KIND_BY_DEPTH = freeze({ 1: "subject", 2: "lesson" });

export class CurriculumContractError extends Error {
  constructor(field, message, code = "INVALID") {
    super(message);
    this.name = "CurriculumContractError";
    this.field = field;
    this.code = code;
  }
}
export const fail = (field, message, code) => { throw new CurriculumContractError(field, message, code); };

// ---------------------------------------------------------------- primitives
export const isValidId = (value) => typeof value === "string" && value.length >= 1 && value.length <= 128 && !value.includes("/");
export function requireId(value, field) {
  if (!isValidId(value)) fail(field, field + " must be a non-empty string without '/' (max 128)", "ID");
  return value;
}
// Normalization (deliberately minimal, not invented policy): trim only. No case folding, no whitespace collapsing.
export const normalizeText = (value) => (typeof value === "string" ? value.trim() : value);

export function validateFrameworkName(name) {
  const value = normalizeText(name);
  if (typeof value !== "string" || value.length < FRAMEWORK_NAME_MIN || value.length > FRAMEWORK_NAME_MAX) {
    fail("name", "framework name must be " + FRAMEWORK_NAME_MIN + "-" + FRAMEWORK_NAME_MAX + " characters", "NAME");
  }
  return value;
}
export function validateNodeName(name) {
  const value = normalizeText(name);
  if (typeof value !== "string" || value.length < NODE_NAME_MIN || value.length > NODE_NAME_MAX) {
    fail("name", "node name must be " + NODE_NAME_MIN + "-" + NODE_NAME_MAX + " characters", "NAME");
  }
  return value;
}
// A node code is optional: undefined / null / blank -> null; otherwise 1..40 characters after trimming.
export function normalizeNodeCode(code) {
  if (code === undefined || code === null) return null;
  if (typeof code !== "string") fail("code", "code must be a string or null", "CODE");
  const value = code.trim();
  if (value === "") return null;
  if (value.length < NODE_CODE_MIN || value.length > NODE_CODE_MAX) fail("code", "code must be " + NODE_CODE_MIN + "-" + NODE_CODE_MAX + " characters", "CODE");
  return value;
}
// ---- node code CANONICALIZATION (P3-S2 policy refinement D2) - the ONE reusable comparison policy for code uniqueness.
// canonical form v1 = trim -> Unicode NFKC normalization -> case-insensitive fold (toUpperCase then toLowerCase: locale-INDEPENDENT, never the toLocale* variants)
// -> NFKC again -> trim. So surrounding whitespace, upper/lower case and Unicode-normalization-equivalent strings (precomposed vs combining Vietnamese letters,
// full-width vs ASCII forms) collide. NOT done on purpose: no diacritic stripping (Vietnamese letters are distinct), no inner-whitespace collapsing, no
// punctuation rewriting. The result is for COMPARISON/VALIDATION only: the stored and displayed code is the user's own text (normalizeNodeCode: trim only,
// never forced to upper case). This is client/domain DUPLICATE PREVENTION, NOT authoritative uniqueness: the Firestore Rules do not enforce it and two
// concurrent clients may still race. P4 (imports) MUST reuse this helper, not invent an import-specific policy.
export const CODE_CANONICAL_FORM_VERSION = 1;
export function canonicalizeNodeCode(code) {
  if (code === undefined || code === null) return null;
  if (typeof code !== "string") fail("code", "code must be a string or null", "CODE");
  const canonical = code.trim().normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC").trim();
  return canonical === "" ? null : canonical;
}
export function validateNodeOrder(order) {
  if (!Number.isInteger(order) || order < NODE_ORDER_MIN || order > NODE_ORDER_MAX) fail("order", "order must be an integer " + NODE_ORDER_MIN + "-" + NODE_ORDER_MAX, "ORDER");
  return order;
}
export function validateNodeKind(kind) {
  if (!NODE_KINDS.includes(kind)) fail("kind", "kind must be one of " + NODE_KINDS.join(", "), "KIND");
  return kind;
}
export function validateNodeStatus(status) {
  if (!NODE_STATUSES.includes(status)) fail("status", "node status must be one of " + NODE_STATUSES.join(", "), "STATUS");
  return status;
}
export function validateFrameworkStatus(status) {
  if (!FRAMEWORK_STATUSES.includes(status)) fail("status", "framework status must be one of " + FRAMEWORK_STATUSES.join(", "), "STATUS");
  return status;
}

// ---------------------------------------------------------------- organization / framework lifecycle facts
// Curriculum WRITES (including the Platform Admin's) require an ACTIVE organization (P3-S1 Rules: mayWriteCurriculum).
export const isOrganizationWritable = (organization) => !!organization && typeof organization === "object" && isValidId(organization.id) && organization.status === "active";
export function requireWritableOrganization(organization) {
  if (!organization || typeof organization !== "object" || !isValidId(organization.id)) fail("organization", "an organization object with an id is required", "ORGANIZATION");
  if (organization.status !== "active") fail("organization", "the organization is not active; curriculum is read-only", "ORGANIZATION_ARCHIVED");
  return organization;
}
export const isFrameworkEditable = (framework) => !!framework && (framework.status === "draft" || framework.status === "active");
// The Rules' "never activated" marker is the ABSENCE of the activatedAt key (a present null still counts as activated).
export const isNeverActivated = (framework) => !!framework && framework.status === "draft" && !has(framework, "activatedAt");

// Lifecycle (Rules state machine): draft -> active (stamps activatedAt once), active -> archived, archived -> active. Nothing else.
export const FRAMEWORK_TRANSITIONS = freeze({
  activate: freeze({ from: "draft", to: "active" }),
  archive: freeze({ from: "active", to: "archived" }),
  restore: freeze({ from: "archived", to: "active" })
});
export function isAllowedFrameworkTransition(from, to) {
  return Object.values(FRAMEWORK_TRANSITIONS).some((t) => t.from === from && t.to === to);
}
export function requireFrameworkAction(framework, action) {
  const transition = FRAMEWORK_TRANSITIONS[action];
  if (!transition) fail("action", "unknown framework action: " + String(action), "ACTION");
  if (!framework || framework.status !== transition.from) fail("status", "cannot " + action + " a framework whose status is " + String(framework && framework.status) + " (requires " + transition.from + ")", "TRANSITION");
  return transition;
}
export function requireEditableFramework(framework) {
  if (!framework || typeof framework !== "object" || !isValidId(framework.id)) fail("framework", "a framework object with an id is required", "FRAMEWORK");
  if (!isFrameworkEditable(framework)) fail("framework", "framework status " + String(framework.status) + " is read-only (only draft/active frameworks are editable)", "FRAMEWORK_READ_ONLY");
  return framework;
}
export function requireSameOrganization(framework, organization) {
  if (!framework || framework.organizationId !== organization.id) fail("organizationId", "framework belongs to another organization", "ORGANIZATION_MISMATCH");
}

// What the UI may offer for a framework in an organization (mirrors the Rules; the Rules still decide).
export function frameworkAvailability(framework, organization) {
  const writable = isOrganizationWritable(organization) && !!framework && framework.organizationId === organization.id;
  const status = framework && framework.status;
  const editable = writable && isFrameworkEditable(framework);
  return freeze({
    organizationWritable: writable,
    readOnly: !editable,
    canRename: editable,
    canEditNodes: editable,
    canActivate: writable && status === "draft",
    canArchive: writable && status === "active",
    canRestore: writable && status === "archived",
    canDelete: writable && isNeverActivated(framework),
    neverActivated: isNeverActivated(framework)
  });
}

// ---------------------------------------------------------------- clone marker (same-organization source, completeness)
export function validateCloneSourceFields({ frameworkId, nodeCount }) {
  requireId(frameworkId, "cloneSource.frameworkId");
  if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > CLONE_NODE_COUNT_MAX) fail("cloneSource.nodeCount", "nodeCount must be an integer 0-" + CLONE_NODE_COUNT_MAX, "CLONE_SOURCE");
  return { frameworkId, nodeCount };
}
// The source framework must belong to the SAME organization (I2; the Rules prove it with one read on create).
export function requireSameOrganizationCloneSource(sourceFramework, organization) {
  if (!sourceFramework || !isValidId(sourceFramework.id)) fail("cloneSource", "a source framework with an id is required", "CLONE_SOURCE");
  if (!organization || sourceFramework.organizationId !== organization.id) fail("cloneSource", "the clone source belongs to another organization (cross-organization clone is not allowed)", "CLONE_SOURCE_ORGANIZATION");
  return sourceFramework;
}
// P3-S5 (D1 RESOLVED): cloneSource.nodeCount is the TOTAL number of source nodes (every status) that the clone operation committed to copy. The Rules make cloneSource
// immutable and force the framework to exist before its nodes, so it is fixed at creation and can only be PROVENANCE plus a completion LOWER BOUND, never a live checksum:
// a clone is complete when the destination holds AT LEAST that many nodes. The clone flow creates its last node in a final commit after every retire pass, so the count
// reaches nodeCount only when the clone is finished; later legitimate edits (rename, reorder, retire, restore, more nodes) can never push the count below it.
// (Individual node deletion is not offered for frameworks; the only delete is the whole never-activated draft.)
export function cloneCompleteness(framework, nodes) {
  const marker = framework && framework.cloneSource;
  if (!marker || typeof marker !== "object") return freeze({ isClone: false, complete: true, expected: null, actual: null });
  const actual = (nodes || []).filter((node) => node && typeof node === "object").length;
  return freeze({ isClone: true, complete: actual >= marker.nodeCount, expected: marker.nodeCount, actual });
}

// ---------------------------------------------------------------- node structure (the shape facts the Rules prove, mirrored)
export const depthOf = (node) => (node && Array.isArray(node.ancestors) ? node.ancestors.length + 1 : 1);
export function ancestorsForChild(parent) {
  if (parent === null || parent === undefined) return [];
  if (!parent || !isValidId(parent.id) || !Array.isArray(parent.ancestors)) fail("parent", "parent must be a node object with an id and ancestors", "PARENT");
  return [...parent.ancestors, parent.id];
}
export function canAddChild(parent) {
  if (parent === null || parent === undefined) return true;
  return ancestorsForChild(parent).length <= CURRICULUM_MAX_ANCESTORS;
}
// Kind offered by the P3 UI for a new child (null = the UI offers nothing at that level; `unit`/deeper levels are extension points only).
export function uiKindForParent(parent) {
  if (parent === null || parent === undefined) return UI_KIND_BY_DEPTH[1];
  return UI_KIND_BY_DEPTH[depthOf(parent) + 1] || null;
}

// Returns issues (never throws). Mirrors nodeShapeOk's structural clauses: ancestors <= 3 strings, unique, own id absent,
// parentId null iff ancestors empty, otherwise parentId == last ancestor and != own id.
export function structureIssues({ id, parentId, ancestors }) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (!Array.isArray(ancestors)) { add("ANCESTORS_TYPE", "ancestors must be an array"); return issues; }
  if (ancestors.length > CURRICULUM_MAX_ANCESTORS) add("DEPTH_EXCEEDED", "depth would exceed " + CURRICULUM_MAX_DEPTH + " levels");
  if (!ancestors.every(isValidId)) add("ANCESTOR_TYPE", "every ancestor must be a valid id string");
  if (new Set(ancestors).size !== ancestors.length) add("ANCESTORS_DUPLICATE", "ancestors must be unique");
  if (id !== undefined && ancestors.includes(id)) add("SELF_IN_ANCESTORS", "a node cannot be its own ancestor");
  if (parentId === null || parentId === undefined) {
    if (ancestors.length !== 0) add("PARENT_MISMATCH", "parentId is null but ancestors is not empty");
  } else {
    if (!isValidId(parentId)) add("PARENT_TYPE", "parentId must be null or a valid id string");
    if (id !== undefined && parentId === id) add("SELF_PARENT", "a node cannot be its own parent");
    if (ancestors.length < 1 || ancestors[ancestors.length - 1] !== parentId) add("PARENT_MISMATCH", "parentId must equal the last ancestor");
  }
  return issues;
}

// Full document check of an existing node (stored or about to be written), without timestamps. Returns issues (never throws).
export function nodeIssues(node, { organizationId } = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ code, nodeId: node && node.id !== undefined ? node.id : null, message });
  if (!node || typeof node !== "object") { add("NODE_TYPE", "node must be an object"); return issues; }
  if (!isValidId(node.id)) add("ID", "node id missing or invalid");
  if (node.schemaVersion !== undefined && node.schemaVersion !== CURRICULUM_SCHEMA_VERSION) add("SCHEMA_VERSION", "schemaVersion must be " + CURRICULUM_SCHEMA_VERSION);
  if (typeof node.organizationId !== "string") add("ORGANIZATION", "organizationId must be a string");
  if (organizationId !== undefined && node.organizationId !== organizationId) add("ORGANIZATION_MISMATCH", "node organizationId differs from the framework organization");
  if (!NODE_KINDS.includes(node.kind)) add("KIND", "invalid kind");
  if (!NODE_STATUSES.includes(node.status)) add("STATUS", "invalid status");
  if (!Number.isInteger(node.order) || node.order < NODE_ORDER_MIN || node.order > NODE_ORDER_MAX) add("ORDER", "order must be an integer " + NODE_ORDER_MIN + "-" + NODE_ORDER_MAX);
  if (typeof node.name !== "string" || node.name.length < NODE_NAME_MIN || node.name.length > NODE_NAME_MAX) add("NAME", "invalid name length");
  if (!(node.code === null || (typeof node.code === "string" && node.code.length >= NODE_CODE_MIN && node.code.length <= NODE_CODE_MAX))) add("CODE", "code must be null or 1-" + NODE_CODE_MAX + " characters");
  for (const issue of structureIssues(node)) issues.push({ ...issue, nodeId: node.id !== undefined ? node.id : null });
  return issues;
}

// ---------------------------------------------------------------- ordering
export const compareSiblings = (a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const siblingsOf = (nodes, parentId) => (nodes || []).filter((node) => (node.parentId === undefined ? null : node.parentId) === (parentId === undefined ? null : parentId));
export const sortedSiblings = (nodes, parentId) => siblingsOf(nodes, parentId).sort(compareSiblings);
export function nextSiblingOrder(nodes, parentId) {
  const siblings = siblingsOf(nodes, parentId);
  const next = siblings.length ? Math.max(...siblings.map((node) => node.order)) + 1 : NODE_ORDER_MIN;
  if (next > NODE_ORDER_MAX) fail("order", "no free order value is left among these siblings", "ORDER_EXHAUSTED");
  return next;
}
// Move one node among its siblings (up = earlier, down = later). Deterministic and minimal: with distinct orders the two nodes exchange their
// order values (2 writes); with duplicated orders every sibling is renumbered 0..n-1 in the new arrangement (only changed nodes are returned).
export function planSiblingMove(nodes, nodeId, direction) {
  if (direction !== "up" && direction !== "down") fail("direction", "direction must be 'up' or 'down'", "DIRECTION");
  const node = (nodes || []).find((item) => item.id === nodeId);
  if (!node) fail("nodeId", "node not found among the loaded nodes", "NODE_NOT_FOUND");
  const siblings = sortedSiblings(nodes, node.parentId === undefined ? null : node.parentId);
  const index = siblings.findIndex((item) => item.id === nodeId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return freeze({ noop: true, renumbered: false, changes: freeze([]) });
  const orders = siblings.map((item) => item.order);
  const distinct = new Set(orders).size === orders.length;
  const arranged = siblings.slice();
  [arranged[index], arranged[target]] = [arranged[target], arranged[index]];
  const wanted = distinct ? arranged.map((item, position) => ({ id: item.id, order: orders[position] })) : arranged.map((item, position) => ({ id: item.id, order: position }));
  const current = new Map(siblings.map((item) => [item.id, item.order]));
  const changes = wanted.filter((item) => current.get(item.id) !== item.order);
  for (const change of changes) validateNodeOrder(change.order);
  return freeze({ noop: false, renumbered: !distinct, changes: freeze(changes.map((change) => freeze(change))) });
}

// ---------------------------------------------------------------- tree
// buildTree: { roots, index, orphans }. TreeNode = { node, depth, children }. Siblings sorted by (order, id). Nodes whose parent chain does not
// reach a root (missing parent / cycle) are returned in `orphans` instead of being silently dropped.
export function buildTree(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const index = new Map();
  for (const node of list) index.set(node.id, { node, depth: 0, children: [] });
  const roots = [];
  for (const entry of index.values()) {
    const parentId = entry.node.parentId === undefined ? null : entry.node.parentId;
    if (parentId === null) roots.push(entry);
    else if (index.has(parentId)) index.get(parentId).children.push(entry);
  }
  const reached = new Set();
  const visit = (entry, depth) => {
    if (reached.has(entry.node.id)) return;
    reached.add(entry.node.id);
    entry.depth = depth;
    entry.children.sort((a, b) => compareSiblings(a.node, b.node));
    for (const child of entry.children) visit(child, depth + 1);
  };
  roots.sort((a, b) => compareSiblings(a.node, b.node));
  for (const root of roots) visit(root, 1);
  const orphans = list.filter((node) => !reached.has(node.id));
  return { roots, index, orphans };
}

// Early integrity validation of a LOADED framework tree (what the Rules cannot prove). Never throws; returns { valid, issues, stats }.
export function validateTree(nodes, { organizationId } = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const issues = [];
  const add = (code, nodeId, message) => issues.push({ code, nodeId, message });
  if (list.length > CURRICULUM_MAX_NODES) add("NODE_COUNT_EXCEEDED", null, "a framework holds at most " + CURRICULUM_MAX_NODES + " nodes (" + list.length + " loaded)");
  const byId = new Map();
  for (const node of list) {
    if (node && byId.has(node.id)) add("DUPLICATE_ID", node.id, "duplicate node id");
    if (node) byId.set(node.id, node);
    issues.push(...nodeIssues(node, { organizationId }));
  }
  // parent chain: reconstruct the real ancestors and compare with the stored ones
  for (const node of list) {
    if (!node || !Array.isArray(node.ancestors)) continue;
    const chain = [];
    const seen = new Set([node.id]);
    let cursor = node.parentId === undefined ? null : node.parentId;
    let broken = null;
    while (cursor !== null) {
      if (seen.has(cursor)) { broken = "CYCLE"; break; }
      seen.add(cursor);
      const parent = byId.get(cursor);
      if (!parent) { broken = "PARENT_MISSING"; break; }
      chain.push(cursor);
      cursor = parent.parentId === undefined ? null : parent.parentId;
      if (chain.length > CURRICULUM_MAX_NODES) { broken = "CYCLE"; break; }
    }
    if (broken === "CYCLE") add("CYCLE", node.id, "the parent chain loops");
    else if (broken === "PARENT_MISSING") add("PARENT_MISSING", node.id, "the parent chain reaches a missing node (orphan)");
    else {
      chain.reverse();
      if (chain.length !== node.ancestors.length || chain.some((id, i) => id !== node.ancestors[i])) add("ANCESTORS_MISMATCH", node.id, "stored ancestors differ from the real parent chain");
      if (chain.length + 1 > CURRICULUM_MAX_DEPTH) add("DEPTH_EXCEEDED", node.id, "real depth exceeds " + CURRICULUM_MAX_DEPTH);
    }
  }
  // sibling order uniqueness
  const orderSeen = new Map();
  for (const node of list) {
    if (!node || !Number.isInteger(node.order)) continue;
    const key = (node.parentId === undefined || node.parentId === null ? "" : node.parentId) + "|" + node.order;
    if (orderSeen.has(key)) add("DUPLICATE_ORDER", node.id, "two siblings share order " + node.order);
    else orderSeen.set(key, node.id);
  }
  // framework-wide uniqueness of non-empty codes under the canonical comparison (trim, NFKC, case-insensitive); the Rules cannot prove this and
  // concurrent clients may still race: this is client/domain duplicate prevention only
  const codeSeen = new Map();
  for (const node of list) {
    if (!node || typeof node.code !== "string") continue;
    const key = canonicalizeNodeCode(node.code);
    if (key === null) continue;
    if (codeSeen.has(key)) add("DUPLICATE_CODE", node.id, "code '" + node.code + "' duplicates the code of node " + codeSeen.get(key) + " (case/whitespace/Unicode-insensitive)");
    else codeSeen.set(key, node.id);
  }
  const tree = buildTree(list.filter((node) => node && typeof node === "object" && isValidId(node.id)));
  const maxDepth = Math.max(0, ...[...tree.index.values()].map((entry) => entry.depth));
  return freeze({
    valid: issues.length === 0,
    issues,
    stats: freeze({ nodeCount: list.length, activeCount: list.filter((n) => n && n.status === "active").length, rootCount: tree.roots.length, orphanCount: tree.orphans.length, maxDepth })
  });
}
// The FIRST node (array order, which is what validateTree reports as the original) other than exceptId whose code is canonically equal to `code` (see
// canonicalizeNodeCode), or null. Blank codes never conflict. Retired nodes count: their codes stay reserved until edited. P3-S4 uses it for an actionable duplicate-code
// message; P4 (imports) must reuse this same policy/API. codeInUse is the boolean form.
export function codeConflictOf(nodes, code, exceptId) {
  const key = typeof code === "string" ? canonicalizeNodeCode(code) : null;
  if (key === null) return null;
  for (const node of nodes || []) {
    if (!node || node.id === exceptId || typeof node.code !== "string") continue;
    if (canonicalizeNodeCode(node.code) === key) return node;
  }
  return null;
}
// True when another node (not exceptId) already uses a code that is canonically equal to `code`. Blank codes never conflict.
export function codeInUse(nodes, code, exceptId) {
  return codeConflictOf(nodes, code, exceptId) !== null;
}

// Activation precondition (P3 Design R1 section 9): draft, writable organization, structurally valid tree, at least one active subject,
// not an incomplete clone. Never throws; the UI shows `errors` in plain language.
export function activationReadiness(framework, nodes, { organization } = {}) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!framework || framework.status !== "draft") add("NOT_DRAFT", "only a draft framework can be activated");
  if (organization !== undefined && !isOrganizationWritable(organization)) add("ORGANIZATION_READ_ONLY", "the organization is not active");
  const tree = validateTree(nodes, { organizationId: framework && framework.organizationId });
  for (const issue of tree.issues) add("TREE_" + issue.code, issue.message + (issue.nodeId ? " [" + issue.nodeId + "]" : ""));
  if (!(nodes || []).some((node) => node && node.status === "active" && node.kind === "subject" && (node.parentId === null || node.parentId === undefined))) add("NO_ACTIVE_SUBJECT", "at least one active subject (root node) is required");
  const clone = cloneCompleteness(framework, nodes);
  if (clone.isClone && !clone.complete) add("INCOMPLETE_CLONE", "the clone is incomplete (expected at least " + clone.expected + " nodes, found " + clone.actual + ")");
  return freeze({ ready: errors.length === 0, errors, stats: tree.stats });
}

// ---------------------------------------------------------------- list ordering helper (Q1 client-side sort)
export function millisOf(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return 0;
}
// Status group (default active, draft, archived) then newest first (createdAt), then id for determinism. Returns a new array.
export function sortFrameworksForList(frameworks, statusOrder = FRAMEWORK_LIST_STATUS_ORDER) {
  const rank = (status) => { const i = statusOrder.indexOf(status); return i < 0 ? statusOrder.length : i; };
  return (frameworks || []).slice().sort((a, b) => (rank(a.status) - rank(b.status)) || (millisOf(b.createdAt) - millisOf(a.createdAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
