// Library V2 P2-S2 - current-organization context resolver (pure, inert).
// A pure function from data to data: given the user's OWN memberships and the organization records they refer to, return which
// organization is current. It supports many memberships and an optionally remembered preference, and it is deterministic. It is NOT
// a switcher: there is no state, no storage access and no UI concept here. Rules never trust this result (they always read the
// membership); it only decides which organization the client asks about.
//
// Eligible organization = the user's membership status is 'active' AND the organization exists AND its status is 'active'.
// Archived organizations never become current; an active org_admin membership in an archived organization is reported in `governed`
// (read-only governance), nothing else is.

export const ORGANIZATION_PREFERENCE_KEY_PREFIX = "hcma2.currentOrganizationId.";
// The key a caller may use to remember a preference (the caller owns any storage; this module touches none).
export function organizationPreferenceKey(uid) {
  if (typeof uid !== "string" || uid.length < 1) throw new TypeError("uid must be a non-empty string");
  return ORGANIZATION_PREFERENCE_KEY_PREFIX + uid;
}

const collator = new Intl.Collator("vi");

function organizationIndex(organizations) {
  const index = new Map();
  const add = (id, data) => {
    if (typeof id === "string" && id && data && typeof data === "object") index.set(id, data);
  };
  if (Array.isArray(organizations)) for (const entry of organizations) add(entry?.id ?? entry?.organizationId, entry);
  else if (organizations instanceof Map) for (const [id, data] of organizations) add(id, data);
  else if (organizations && typeof organizations === "object") for (const [id, data] of Object.entries(organizations)) add(id, data);
  return index;
}

const ROLE_RANK = { org_admin: 0, member: 1 };

// -> { status: 'none'|'ready', currentOrganizationId, candidates: [{organizationId,name,orgRole}],
//      governed: [{organizationId,name,orgRole,status}], isOrgAdmin }
export function resolveOrganizationContext({ memberships, organizations, preferredOrganizationId } = {}) {
  const orgs = organizationIndex(organizations);
  const best = new Map(); // one entry per organization (a duplicate membership document cannot exist, but be safe)
  const governed = [];
  for (const membership of Array.isArray(memberships) ? memberships : []) {
    const organizationId = membership?.organizationId;
    if (typeof organizationId !== "string" || !organizationId || membership.status !== "active") continue;
    if (!(membership.orgRole in ROLE_RANK)) continue;
    const organization = orgs.get(organizationId);
    if (!organization) continue;
    const name = typeof organization.name === "string" ? organization.name : "";
    if (organization.status === "active") {
      const previous = best.get(organizationId);
      if (!previous || ROLE_RANK[membership.orgRole] < ROLE_RANK[previous.orgRole]) best.set(organizationId, { organizationId, name, orgRole: membership.orgRole });
    } else if (organization.status === "archived" && membership.orgRole === "org_admin") {
      governed.push({ organizationId, name, orgRole: "org_admin", status: "archived" });
    }
  }
  const order = (a, b) => (ROLE_RANK[a.orgRole] - ROLE_RANK[b.orgRole]) || collator.compare(a.name, b.name) || (a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0);
  const candidates = [...best.values()].sort(order);
  governed.sort(order);
  if (!candidates.length) return { status: "none", currentOrganizationId: null, candidates: [], governed, isOrgAdmin: false };
  const preferred = typeof preferredOrganizationId === "string" ? candidates.find((c) => c.organizationId === preferredOrganizationId) : undefined;
  const current = preferred || candidates[0];
  return { status: "ready", currentOrganizationId: current.organizationId, candidates, governed, isOrgAdmin: current.orgRole === "org_admin" };
}
