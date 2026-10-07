// Library V2 P3-S2 - curriculum READ adapters (pure factory, inert). The Firestore functions are injected (`db` is passed per call): this file has no
// Firebase import, no DOM, no clock, and is not wired into index.html.
//
// Query matrix (P3 Design R1 section 7). EVERY query is one organizationId equality, nothing else, so Firestore serves it with the AUTOMATIC
// single-field index on `organizationId`: ZERO composite indexes (Owner decision D2). There is deliberately no orderBy, no second where, no
// `in` / `array-contains-any`, no collection-group query and no cross-organization function:
//   Q1 frameworksOfOrganization : curriculumFrameworks where organizationId == X, limit(FRAMEWORK_LIST_LIMIT + 1)       -> client sort (status group, newest first)
//   Q2 frameworkById            : getDoc(curriculumFrameworks/{fwId})  (+ optional organization consistency check)
//   Q3 nodesOfFramework         : curriculumFrameworks/{fwId}/nodes where organizationId == X, limit(CURRICULUM_MAX_NODES + 1)  (document-id order; the client builds the tree)
// Rules reality (P3-S1): non-Platform-Admin principals must send the organizationId filter (I6, proven by the Rules suite); the Platform Admin
// could list across organizations by Rules, so this client module always filters and verifies what it reads belongs to the requested organization.
import { CURRICULUM_MAX_NODES, FRAMEWORK_LIST_LIMIT, isValidId, sortFrameworksForList, CurriculumContractError } from "./curriculum-model.mjs";

export const CURRICULUM_COLLECTION = "curriculumFrameworks";
export const CURRICULUM_NODES_SUBCOLLECTION = "nodes";

function singleId(value, field) {
  if (!isValidId(value)) throw new TypeError(field + " must be exactly one non-empty id string (arrays, objects and multiple organizations are not accepted)");
  return value;
}
const plain = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });
function assertBelongs(items, organizationId, what) {
  for (const item of items) {
    if (item.organizationId !== organizationId) throw new CurriculumContractError("organizationId", what + " " + item.id + " does not belong to organization " + organizationId + " (cross-organization data refused)", "ORGANIZATION_MISMATCH");
  }
}

export function createCurriculumQueries({ collection, doc, query, where, limit, getDocs, getDoc }) {
  for (const [name, fn] of Object.entries({ collection, doc, query, where, limit, getDocs, getDoc })) {
    if (typeof fn !== "function") throw new TypeError("createCurriculumQueries requires the Firestore function: " + name);
  }
  return Object.freeze({
    // Q1. At most FRAMEWORK_LIST_LIMIT frameworks are returned; `truncated` is true when more exist (honest "showing 100" state, never silent).
    async frameworksOfOrganization(db, organizationId) {
      const orgId = singleId(organizationId, "organizationId");
      const snapshot = await getDocs(query(collection(db, CURRICULUM_COLLECTION), where("organizationId", "==", orgId), limit(FRAMEWORK_LIST_LIMIT + 1)));
      const truncated = snapshot.docs.length > FRAMEWORK_LIST_LIMIT;
      const items = snapshot.docs.slice(0, FRAMEWORK_LIST_LIMIT).map(plain);
      assertBelongs(items, orgId, "framework");
      return { items: sortFrameworksForList(items), truncated, limit: FRAMEWORK_LIST_LIMIT };
    },
    // Q2. null when the document does not exist. With `organizationId`, a framework of another organization is refused (Platform Admin safety).
    async frameworkById(db, frameworkId, { organizationId } = {}) {
      const id = singleId(frameworkId, "frameworkId");
      const expectedOrganizationId = organizationId === undefined ? undefined : singleId(organizationId, "organizationId");   // validate input before any read
      const snapshot = await getDoc(doc(db, CURRICULUM_COLLECTION, id));
      if (!snapshot.exists()) return null;
      const framework = plain(snapshot);
      if (expectedOrganizationId !== undefined) assertBelongs([framework], expectedOrganizationId, "framework");
      return framework;
    },
    // Q3. Whole tree of one framework (needed for sibling order, code uniqueness and depth validation). At most CURRICULUM_MAX_NODES nodes are
    // returned; `tooLarge` is true when more exist (the UI must show a read-only "too large" state, never a silently truncated tree).
    async nodesOfFramework(db, frameworkId, organizationId) {
      const id = singleId(frameworkId, "frameworkId");
      const orgId = singleId(organizationId, "organizationId");
      const snapshot = await getDocs(query(collection(db, CURRICULUM_COLLECTION, id, CURRICULUM_NODES_SUBCOLLECTION), where("organizationId", "==", orgId), limit(CURRICULUM_MAX_NODES + 1)));
      const tooLarge = snapshot.docs.length > CURRICULUM_MAX_NODES;
      const items = snapshot.docs.slice(0, CURRICULUM_MAX_NODES).map(plain);
      assertBelongs(items, orgId, "node");
      return { items, tooLarge, limit: CURRICULUM_MAX_NODES };
    }
  });
}
