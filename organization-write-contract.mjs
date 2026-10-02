// Library V2 P2-S2 - client-side write contract for the organization collections (pure, inert).
// UI code must never build organization / membership / capability payloads by hand: every payload comes from here and matches the
// deployed P2-S1 Firestore Rules exactly (ruleset 7e4333e7..., SHA-256 7EA5D7A5...). No Firestore, DOM, storage or network access.
//
// Boundaries encoded by what is (and is NOT) exported:
//  - Platform Admin only: buildNewOrganization, buildOrganizationRename, buildOrganizationArchive, buildOrganizationRestore,
//    buildNewMembership (includes appointing an org_admin), buildMembershipRoleChange, buildMembershipSnapshotRefresh.
//  - Platform Admin or Organization Admin (own organization, ordinary members only): buildMembershipStatusChange,
//    buildNewCapabilityDocument, buildCapabilityUpdate.
//  - There is deliberately NO builder through which an Organization Admin adds a member and NO user-discovery helper.

export const ORGANIZATION_SCHEMA_VERSION = 1;
export const ORGANIZATION_STATUSES = Object.freeze(["active", "archived"]);
export const MEMBERSHIP_ROLES = Object.freeze(["org_admin", "member"]);
export const MEMBERSHIP_STATUSES = Object.freeze(["active", "suspended", "removed"]);
export const CAPABILITIES = Object.freeze(["library.review", "library.publish", "library.manage", "curriculum.manage"]);
export const DENIABLE_CAPABILITIES = Object.freeze(["library.contribute"]);
export const ORGANIZATION_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const NAME_MIN = 3;
export const NAME_MAX = 120;
export const DISPLAY_NAME_MAX = 120;
export const EMAIL_MAX = 200;
// Implementation safety defaults only (measured in the Firestore emulator on 2026-10-02) - NOT domain or business limits.
// Later phases must re-measure when Rules helper composition changes.
export const CAPABILITY_WRITE_CHUNK_DEFAULT = 10;
export const MEMBERSHIP_WRITE_CHUNK_DEFAULT = 400;

export class OrganizationContractError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "OrganizationContractError";
    this.field = field;
  }
}
const fail = (field, message) => { throw new OrganizationContractError(field, message); };

function requireId(value, field, { noUnderscore = false } = {}) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.includes("/")) fail(field, field + " must be a non-empty string without '/' (max 128)");
  if (noUnderscore && value.includes("_")) fail(field, field + " must not contain '_' (it is the id separator)");
  return value;
}
const requireUid = (value, field = "uid") => requireId(value, field);
const requireOrganizationId = (value) => requireId(value, "organizationId", { noUnderscore: true });

export function validateOrganizationName(name) {
  if (typeof name !== "string" || name.length < NAME_MIN || name.length > NAME_MAX) fail("name", "name must be a string of " + NAME_MIN + "-" + NAME_MAX + " characters");
  return name;
}
export function validateOrganizationCode(code) {
  if (typeof code !== "string" || !ORGANIZATION_CODE_PATTERN.test(code)) fail("code", "code must match " + ORGANIZATION_CODE_PATTERN);
  return code;
}
export function validateMembershipRole(role) {
  if (!MEMBERSHIP_ROLES.includes(role)) fail("orgRole", "orgRole must be one of " + MEMBERSHIP_ROLES.join(", "));
  return role;
}
export function validateMembershipStatus(status) {
  if (!MEMBERSHIP_STATUSES.includes(status)) fail("status", "status must be one of " + MEMBERSHIP_STATUSES.join(", "));
  return status;
}
function uniqueSubset(list, allowed, field) {
  if (!Array.isArray(list)) fail(field, field + " must be an array");
  if (new Set(list).size !== list.length) fail(field, field + " must not contain duplicates");
  for (const item of list) if (!allowed.includes(item)) fail(field, field + " contains an unsupported value: " + String(item));
  return list.slice();
}
export const validateCapabilities = (caps) => uniqueSubset(caps, CAPABILITIES, "caps");
export const validateDeniedCapabilities = (denied) => uniqueSubset(denied, DENIABLE_CAPABILITIES, "denied");

// Deterministic document ids ({organizationId}_{uid}); the Rules re-derive them from the stored fields.
export function membershipDocId(organizationId, uid) { return requireOrganizationId(organizationId) + "_" + requireUid(uid); }
export function capabilityDocId(organizationId, uid) { return membershipDocId(organizationId, uid); }

// Generic chunking for bulk writes (the caller commits one batch per chunk).
export function chunkWrites(items, size) {
  if (!Array.isArray(items)) fail("items", "items must be an array");
  if (!Number.isInteger(size) || size < 1) fail("size", "chunk size must be a positive integer");
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
export const chunkCapabilityWrites = (items, size = CAPABILITY_WRITE_CHUNK_DEFAULT) => chunkWrites(items, size);
export const chunkMembershipWrites = (items, size = MEMBERSHIP_WRITE_CHUNK_DEFAULT) => chunkWrites(items, size);

// The only way to obtain payload builders: the caller injects Firestore's serverTimestamp() sentinel factory.
export function createOrganizationWriteContract({ serverTimestamp } = {}) {
  if (typeof serverTimestamp !== "function") throw new TypeError("createOrganizationWriteContract requires { serverTimestamp }");
  const now = () => serverTimestamp();

  // ---- organizations (Platform Admin only) ----
  function buildNewOrganization({ name, code } = {}, actorUid) {
    return {
      schemaVersion: ORGANIZATION_SCHEMA_VERSION,
      name: validateOrganizationName(name),
      code: validateOrganizationCode(code),
      status: "active",
      createdAt: now(),
      createdBy: requireUid(actorUid, "actorUid"),
      updatedAt: now()
    };
  }
  const buildOrganizationRename = (name) => ({ name: validateOrganizationName(name), updatedAt: now() });
  const buildOrganizationArchive = (actorUid) => ({ status: "archived", archivedAt: now(), archivedBy: requireUid(actorUid, "actorUid"), updatedAt: now() });
  const buildOrganizationRestore = () => ({ status: "active", archivedAt: null, archivedBy: null, updatedAt: now() });

  // ---- memberships ----
  // Platform Admin only. Returns { id, data } (the id is deterministic). Creating an org_admin membership is the "appoint" action.
  function buildNewMembership({ organizationId, uid, orgRole = "member", displayName, email } = {}, actorUid) {
    const data = {
      schemaVersion: ORGANIZATION_SCHEMA_VERSION,
      organizationId: requireOrganizationId(organizationId),
      uid: requireUid(uid),
      orgRole: validateMembershipRole(orgRole),
      status: "active",
      addedBy: requireUid(actorUid, "actorUid"),
      createdAt: now(),
      updatedAt: now()
    };
    // Display-only snapshot (decision D2): never authoritative for identity, account status or authorization.
    if (displayName !== undefined) {
      if (typeof displayName !== "string" || displayName.length > DISPLAY_NAME_MAX) fail("displayName", "displayName must be a string of at most " + DISPLAY_NAME_MAX);
      data.displayName = displayName;
    }
    if (email !== undefined) {
      if (typeof email !== "string" || email.length > EMAIL_MAX) fail("email", "email must be a string of at most " + EMAIL_MAX);
      data.email = email;
    }
    return { id: membershipDocId(organizationId, uid), data };
  }
  // Platform Admin, or Organization Admin on an ordinary member of its own active organization.
  function buildMembershipStatusChange(status, actorUid) {
    return { status: validateMembershipStatus(status), statusChangedAt: now(), statusChangedBy: requireUid(actorUid, "actorUid"), updatedAt: now() };
  }
  // Platform Admin only.
  const buildMembershipRoleChange = (orgRole) => ({ orgRole: validateMembershipRole(orgRole), updatedAt: now() });
  function buildMembershipSnapshotRefresh({ displayName, email } = {}) {
    const data = { updatedAt: now() };
    if (displayName !== undefined) {
      if (typeof displayName !== "string" || displayName.length > DISPLAY_NAME_MAX) fail("displayName", "displayName must be a string of at most " + DISPLAY_NAME_MAX);
      data.displayName = displayName;
    }
    if (email !== undefined) {
      if (typeof email !== "string" || email.length > EMAIL_MAX) fail("email", "email must be a string of at most " + EMAIL_MAX);
      data.email = email;
    }
    return data;
  }

  // ---- capabilities (Platform Admin or the organization's Admin; target must be an ordinary member) ----
  function buildNewCapabilityDocument({ organizationId, uid, caps = [], denied = [] } = {}, actorUid) {
    return {
      id: capabilityDocId(organizationId, uid),
      data: {
        schemaVersion: ORGANIZATION_SCHEMA_VERSION,
        organizationId: requireOrganizationId(organizationId),
        uid: requireUid(uid),
        caps: validateCapabilities(caps),
        denied: validateDeniedCapabilities(denied),
        updatedBy: requireUid(actorUid, "actorUid"),
        createdAt: now(),
        updatedAt: now()
      }
    };
  }
  const buildCapabilityUpdate = ({ caps = [], denied = [] } = {}, actorUid) => ({
    caps: validateCapabilities(caps),
    denied: validateDeniedCapabilities(denied),
    updatedBy: requireUid(actorUid, "actorUid"),
    updatedAt: now()
  });

  return Object.freeze({
    buildNewOrganization, buildOrganizationRename, buildOrganizationArchive, buildOrganizationRestore,
    buildNewMembership, buildMembershipStatusChange, buildMembershipRoleChange, buildMembershipSnapshotRefresh,
    buildNewCapabilityDocument, buildCapabilityUpdate
  });
}
