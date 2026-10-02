// Library V2 P2-S2 - read-side query contract for the organization collections (pure factory, inert).
// Frozen invariants (Library V2 contracts v1.1 section 11, I1/I2/I6):
//  - every organization-scoped query takes EXACTLY ONE organizationId (a plain non-empty string);
//  - no `in`, no `array-contains-any`, no multi-organization fetch, no client-side cross-organization filtering;
//  - every list is bounded (page size 1-100) with a snapshot cursor, like trash-query-contract.mjs;
//  - there is NO query over the platform `users` collection and no teacher discovery anywhere in this module.
// The Firestore functions are injected (`db` is passed per call), so this file has no Firebase import and is unit-testable.
import { membershipDocId, capabilityDocId } from "./organization-write-contract.mjs";

export const ORGANIZATION_PAGE_SIZE_DEFAULT = 50;
export const ORGANIZATION_PAGE_SIZE_MAX = 100;

function singleId(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.includes("/")) {
    throw new TypeError(field + " must be exactly one non-empty id string (arrays, objects and multiple organizations are not accepted)");
  }
  return value;
}
const singleOrganizationId = (value) => singleId(value, "organizationId");
const singleUid = (value) => singleId(value, "uid");

function pageSizeOf(value) {
  if (value === undefined) return ORGANIZATION_PAGE_SIZE_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > ORGANIZATION_PAGE_SIZE_MAX) {
    throw new RangeError("pageSize must be an integer from 1 to " + ORGANIZATION_PAGE_SIZE_MAX);
  }
  return value;
}
const plain = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

// Ordinary application queries. Contains no function that lists organizations.
export function createOrganizationQueries({ collection, doc, query, where, orderBy, limit, startAfter, documentId, getDocs, getDoc }) {
  async function pageByOrganization(db, collectionName, organizationId, { pageSize, cursor } = {}) {
    const size = pageSizeOf(pageSize);
    const constraints = [where("organizationId", "==", singleOrganizationId(organizationId)), orderBy(documentId())];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(size + 1));
    const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
    const documents = snapshot.docs.slice(0, size);
    return { items: documents.map(plain), cursor: documents.at(-1) || null, hasMore: snapshot.docs.length > size };
  }
  async function byId(db, collectionName, id) {
    const snapshot = await getDoc(doc(db, collectionName, id));
    return snapshot.exists() ? plain(snapshot) : null;
  }
  return Object.freeze({
    // The signed-in user's OWN memberships (all organizations, by definition of identity); bounded by the user's membership count.
    async membershipsOfUser(db, uid) {
      const snapshot = await getDocs(query(collection(db, "organizationMembers"), where("uid", "==", singleUid(uid))));
      return snapshot.docs.map(plain);
    },
    organizationById: async (db, organizationId) => byId(db, "organizations", singleOrganizationId(organizationId)),
    membershipOf: async (db, organizationId, uid) => byId(db, "organizationMembers", membershipDocId(singleOrganizationId(organizationId), singleUid(uid))),
    capabilityOf: async (db, organizationId, uid) => byId(db, "userCapabilities", capabilityDocId(singleOrganizationId(organizationId), singleUid(uid))),
    membersOfOrganization: async (db, organizationId, options) => pageByOrganization(db, "organizationMembers", organizationId, options),
    capabilitiesOfOrganization: async (db, organizationId, options) => pageByOrganization(db, "userCapabilities", organizationId, options)
  });
}

// PLATFORM-ADMIN INFRASTRUCTURE ONLY. A separate factory with an unmistakable name: ordinary application code must not import it
// or treat it as a general query. The Rules allow listing organizations only to an active Platform Admin; anyone else is denied.
export function createPlatformAdminOrganizationQueries({ collection, query, orderBy, limit, getDocs }) {
  return Object.freeze({
    async listAllOrganizationsAsPlatformAdminOnly(db, { pageSize } = {}) {
      const size = pageSizeOf(pageSize === undefined ? ORGANIZATION_PAGE_SIZE_MAX : pageSize);
      const snapshot = await getDocs(query(collection(db, "organizations"), orderBy("createdAt", "desc"), limit(size)));
      return snapshot.docs.map(plain);
    }
  });
}
