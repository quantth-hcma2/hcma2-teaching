// Library V2 P2-S2 - minimal Admin feature registry (pure, inert; NOT wired to any menu in S2).
// Only what later Admin wiring needs: audience, route key and the required capability. No labels, icons, plugins or entitlements.
// `requiredCapability` is a capability name evaluated inside the CURRENT organization; null means "Platform Admin only".
// 'org.members.manage' is implicit for an organization's org_admin (it is never a stored/grantable capability).

const freeze = Object.freeze;

export const ADMIN_FEATURE_AUDIENCES = freeze({ PLATFORM: "platform", ORGANIZATION: "organization" });

export const ADMIN_FEATURES = freeze([
  freeze({ key: "organizations", audience: "platform", routeKey: "organizations", requiredCapability: null }),
  freeze({ key: "organizationAdmin", audience: "organization", routeKey: "orgAdmin", requiredCapability: "org.members.manage" })
]);

export function getAdminFeature(key) {
  return ADMIN_FEATURES.find((feature) => feature.key === key) || null;
}

export function adminFeaturesForAudience(audience) {
  return ADMIN_FEATURES.filter((feature) => feature.audience === audience);
}

// Which features a principal may see: Platform Admin -> platform features; an org_admin of the CURRENT organization -> organization
// features. (Ordinary members and anonymous users see none; Rules remain the authority.)
export function visibleAdminFeatures({ isPlatformAdmin = false, isOrgAdmin = false } = {}) {
  return ADMIN_FEATURES.filter((feature) => (feature.audience === "platform" ? isPlatformAdmin === true : isOrgAdmin === true));
}
