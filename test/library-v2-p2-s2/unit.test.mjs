// Library V2 P2-S2 - pure unit tests (no emulator): context resolver, query contract (with recording stubs), write contract, registry.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrganizationContext, organizationPreferenceKey, ORGANIZATION_PREFERENCE_KEY_PREFIX } from "../../organization-context.mjs";
import { createOrganizationQueries, createPlatformAdminOrganizationQueries, ORGANIZATION_PAGE_SIZE_DEFAULT, ORGANIZATION_PAGE_SIZE_MAX } from "../../organization-queries.mjs";
import * as W from "../../organization-write-contract.mjs";
import { ADMIN_FEATURES, ADMIN_FEATURE_AUDIENCES, getAdminFeature, adminFeaturesForAudience, visibleAdminFeatures } from "../../admin-feature-registry.mjs";

// ---------------- organization-context ----------------
const mem = (organizationId, orgRole = "member", status = "active") => ({ organizationId, uid: "u", orgRole, status });
const orgs = { oA: { name: "Đơn vị A", status: "active" }, oB: { name: "Bình", status: "active" }, oC: { name: "Công", status: "archived" }, oD: { name: "Đức", status: "active" } };

test("context: no memberships / garbage input -> none", () => {
  for (const input of [undefined, {}, { memberships: [] }, { memberships: null, organizations: orgs }, { memberships: [null, 1, {}, { organizationId: 5 }] , organizations: orgs }]) {
    const r = resolveOrganizationContext(input);
    assert.deepEqual([r.status, r.currentOrganizationId, r.candidates, r.isOrgAdmin], ["none", null, [], false]);
  }
});

test("context: only active memberships in active organizations are candidates; deterministic order (org_admin first, then name, then id)", () => {
  const memberships = [mem("oD"), mem("oB"), mem("oA", "org_admin"), mem("oC", "member"), mem("missing"), mem("oA2", "member", "suspended"), mem("oB2", "member", "removed")];
  const r = resolveOrganizationContext({ memberships, organizations: { ...orgs, oA2: { name: "X", status: "active" }, oB2: { name: "Y", status: "active" } } });
  assert.equal(r.status, "ready");
  assert.deepEqual(r.candidates.map((c) => c.organizationId), ["oA", "oB", "oD"]);
  assert.equal(r.currentOrganizationId, "oA"); assert.equal(r.isOrgAdmin, true);
  assert.deepEqual(r.governed, []);
  const shuffled = resolveOrganizationContext({ memberships: [...memberships].reverse(), organizations: { ...orgs, oA2: { name: "X", status: "active" }, oB2: { name: "Y", status: "active" } } });
  assert.deepEqual(shuffled, r, "input order never changes the result");
});

test("context: preference wins only when it is a candidate; otherwise the deterministic default", () => {
  const memberships = [mem("oB"), mem("oD"), mem("oC")];
  const base = { memberships, organizations: orgs };
  assert.equal(resolveOrganizationContext(base).currentOrganizationId, "oB");
  assert.equal(resolveOrganizationContext({ ...base, preferredOrganizationId: "oD" }).currentOrganizationId, "oD");
  assert.equal(resolveOrganizationContext({ ...base, preferredOrganizationId: "oC" }).currentOrganizationId, "oB", "archived preference ignored");
  assert.equal(resolveOrganizationContext({ ...base, preferredOrganizationId: "other" }).currentOrganizationId, "oB", "unknown preference ignored");
  assert.equal(resolveOrganizationContext({ ...base, preferredOrganizationId: 42 }).currentOrganizationId, "oB");
  assert.equal(resolveOrganizationContext({ ...base, preferredOrganizationId: "oD" }).isOrgAdmin, false);
});

test("context: Vietnamese collation, ties by id, org_admin of the current organization sets isOrgAdmin", () => {
  const o = { x1: { name: "Đại học", status: "active" }, x2: { name: "Đại học", status: "active" }, x3: { name: "An", status: "active" }, x4: { name: "Ê", status: "active" } };
  const r = resolveOrganizationContext({ memberships: [mem("x2"), mem("x1"), mem("x4"), mem("x3")], organizations: o });
  assert.deepEqual(r.candidates.map((c) => c.organizationId), ["x3", "x1", "x2", "x4"]);
  const admin = resolveOrganizationContext({ memberships: [mem("x3"), mem("x1", "org_admin")], organizations: o, preferredOrganizationId: "x3" });
  assert.equal(admin.currentOrganizationId, "x3"); assert.equal(admin.isOrgAdmin, false);
  assert.equal(resolveOrganizationContext({ memberships: [mem("x3"), mem("x1", "org_admin")], organizations: o }).isOrgAdmin, true);
});

test("context: archived organizations never become current; an active org_admin there is reported in governed (read-only); members get nothing", () => {
  const r1 = resolveOrganizationContext({ memberships: [mem("oC", "org_admin")], organizations: orgs });
  assert.equal(r1.status, "none"); assert.deepEqual(r1.governed, [{ organizationId: "oC", name: "Công", orgRole: "org_admin", status: "archived" }]);
  const r2 = resolveOrganizationContext({ memberships: [mem("oC", "member")], organizations: orgs });
  assert.deepEqual([r2.status, r2.governed], ["none", []]);
  const r3 = resolveOrganizationContext({ memberships: [mem("oC", "org_admin", "suspended")], organizations: orgs });
  assert.deepEqual(r3.governed, []);
});

test("context: accepts organizations as object map, Map or array; duplicates keep the stronger role; result is plain data", () => {
  const memberships = [mem("oA"), mem("oA", "org_admin")];
  const asMap = new Map([["oA", { name: "A", status: "active" }]]);
  const asArray = [{ id: "oA", name: "A", status: "active" }];
  for (const organizations of [{ oA: { name: "A", status: "active" } }, asMap, asArray]) {
    const r = resolveOrganizationContext({ memberships, organizations });
    assert.deepEqual(r.candidates, [{ organizationId: "oA", name: "A", orgRole: "org_admin" }]);
  }
  assert.deepEqual(Object.keys(resolveOrganizationContext({})).sort(), ["candidates", "currentOrganizationId", "governed", "isOrgAdmin", "status"]);
  assert.equal(organizationPreferenceKey("abc"), ORGANIZATION_PREFERENCE_KEY_PREFIX + "abc");
  assert.throws(() => organizationPreferenceKey(""), TypeError);
});

// ---------------- organization-queries (recording stubs) ----------------
function makeDeps(pages = []) {
  const log = [];
  const deps = {
    collection: (db, name) => ({ t: "collection", name }),
    doc: (db, name, id) => ({ t: "doc", name, id }),
    where: (field, op, value) => ({ t: "where", field, op, value }),
    orderBy: (field, dir) => ({ t: "orderBy", field: field && field.t === "documentId" ? "__name__" : field, dir }),
    limit: (n) => ({ t: "limit", n }),
    startAfter: (c) => ({ t: "startAfter", c }),
    documentId: () => ({ t: "documentId" }),
    query: (source, ...constraints) => ({ t: "query", source, constraints }),
    getDocs: async (q) => { log.push(q); const docs = pages.shift() || []; return { docs }; },
    getDoc: async (ref) => { log.push(ref); return { exists: () => ref.id !== "missing", id: ref.id, data: () => ({ x: 1 }) }; }
  };
  return { deps, log };
}
const snap = (id, data = {}) => ({ id, data: () => data });

test("queries: membersOfOrganization uses exactly one organizationId equality, NEWEST-FIRST order (createdAt desc, document id desc), bounded page+1, snapshot cursor", async () => {
  const docs = Array.from({ length: 51 }, (_, i) => snap("o1_u" + i, { organizationId: "o1" }));
  const { deps, log } = makeDeps([docs]);
  const q = createOrganizationQueries(deps);
  const page = await q.membersOfOrganization({}, "o1");
  const c = log[0].constraints;
  assert.deepEqual(c.filter((x) => x.t === "where"), [{ t: "where", field: "organizationId", op: "==", value: "o1" }]);
  assert.deepEqual(c.map((x) => x.t), ["where", "orderBy", "orderBy", "limit"]);
  assert.deepEqual(c.filter((x) => x.t === "orderBy").map((x) => [x.field, x.dir]), [["createdAt", "desc"], ["__name__", "desc"]], "newest first with a deterministic descending document-id tie-break");
  assert.equal(c.find((x) => x.t === "limit").n, ORGANIZATION_PAGE_SIZE_DEFAULT + 1);
  assert.equal(page.items.length, ORGANIZATION_PAGE_SIZE_DEFAULT); assert.equal(page.hasMore, true); assert.equal(page.cursor.id, "o1_u49");
  const { deps: d2, log: l2 } = makeDeps([[snap("o1_u1")]]);
  const p2 = await createOrganizationQueries(d2).membersOfOrganization({}, "o1", { pageSize: 10, cursor: page.cursor });
  assert.deepEqual(l2[0].constraints.map((x) => x.t), ["where", "orderBy", "orderBy", "startAfter", "limit"]); assert.equal(l2[0].constraints[4].n, 11); assert.equal(p2.hasMore, false);
});

test("queries: every organization-scoped function accepts exactly one organizationId (arrays/objects/empty/path-like rejected before any read)", async () => {
  const { deps, log } = makeDeps();
  const q = createOrganizationQueries(deps);
  const bad = [["o1", "o2"], { id: "o1" }, "", "a/b", null, undefined, 7, new Set(["o1"])];
  for (const value of bad) {
    await assert.rejects(() => q.membersOfOrganization({}, value), TypeError);
    await assert.rejects(() => q.capabilitiesOfOrganization({}, value), TypeError);
    await assert.rejects(() => q.organizationById({}, value), TypeError);
    await assert.rejects(() => q.membershipOf({}, value, "u"), TypeError);
    await assert.rejects(() => q.capabilityOf({}, value, "u"), TypeError);
  }
  await assert.rejects(() => q.membershipsOfUser({}, ["u1", "u2"]), TypeError);
  await assert.rejects(() => q.membershipOf({}, "o1", ["u1"]), TypeError);
  assert.equal(log.length, 0, "no Firestore call was made for rejected input");
});

test("queries: page size is bounded 1-100; membershipsOfUser / byId lookups use the exact documents", async () => {
  const { deps, log } = makeDeps([[snap("o1_u")], [snap("o1_u")]]);
  const q = createOrganizationQueries(deps);
  for (const pageSize of [0, 101, 1.5, "10", -1]) await assert.rejects(() => q.membersOfOrganization({}, "o1", { pageSize }), RangeError);
  assert.equal(ORGANIZATION_PAGE_SIZE_MAX, 100);
  await q.membershipsOfUser({}, "u");
  assert.deepEqual(log[0].constraints, [{ t: "where", field: "uid", op: "==", value: "u" }]);
  assert.deepEqual(await q.membershipOf({}, "o1", "u"), { id: "o1_u", x: 1 });
  assert.deepEqual(log.at(-1), { t: "doc", name: "organizationMembers", id: "o1_u" });
  assert.deepEqual(await q.capabilityOf({}, "o1", "u"), { id: "o1_u", x: 1 });
  assert.deepEqual(log.at(-1), { t: "doc", name: "userCapabilities", id: "o1_u" });
  assert.equal(await q.organizationById({}, "missing"), null);
});

test("queries: the ordinary factory has no all-organizations function; the Platform-Admin factory is separately and explicitly named and bounded", async () => {
  const { deps } = makeDeps();
  const q = createOrganizationQueries(deps);
  assert.deepEqual(Object.keys(q).sort(), ["capabilitiesOfOrganization", "capabilityOf", "membersOfOrganization", "membershipOf", "membershipsOfUser", "organizationById"]);
  const { deps: d2, log } = makeDeps([[snap("o1", { name: "A" })]]);
  const admin = createPlatformAdminOrganizationQueries(d2);
  assert.deepEqual(Object.keys(admin), ["listAllOrganizationsAsPlatformAdminOnly"]);
  const result = await admin.listAllOrganizationsAsPlatformAdminOnly({});
  assert.deepEqual(result, [{ id: "o1", name: "A" }]);
  assert.deepEqual(log[0].constraints.map((x) => x.t), ["orderBy", "limit"]); assert.equal(log[0].constraints[1].n, 100);
  await assert.rejects(() => admin.listAllOrganizationsAsPlatformAdminOnly({}, { pageSize: 101 }), RangeError);
});

// ---------------- organization-write-contract ----------------
const TS = Symbol("serverTimestamp");
const contract = W.createOrganizationWriteContract({ serverTimestamp: () => TS });

test("write contract: factory requires serverTimestamp; builders return exactly the Rules-allowed keys", () => {
  assert.throws(() => W.createOrganizationWriteContract(), TypeError);
  assert.throws(() => W.createOrganizationWriteContract({}), TypeError);
  assert.deepEqual(contract.buildNewOrganization({ name: "Đơn vị mẫu", code: "don-vi-mau" }, "pa"), { schemaVersion: 1, name: "Đơn vị mẫu", code: "don-vi-mau", status: "active", createdAt: TS, createdBy: "pa", updatedAt: TS });
  assert.deepEqual(contract.buildOrganizationRename("Tên mới"), { name: "Tên mới", updatedAt: TS });
  assert.deepEqual(contract.buildOrganizationArchive("pa"), { status: "archived", archivedAt: TS, archivedBy: "pa", updatedAt: TS });
  assert.deepEqual(contract.buildOrganizationRestore(), { status: "active", archivedAt: null, archivedBy: null, updatedAt: TS });
  assert.deepEqual(contract.buildNewMembership({ organizationId: "o1", uid: "u1", displayName: "A", email: "a@x.test" }, "pa"), { id: "o1_u1", data: { schemaVersion: 1, organizationId: "o1", uid: "u1", orgRole: "member", status: "active", addedBy: "pa", createdAt: TS, updatedAt: TS, displayName: "A", email: "a@x.test" } });
  assert.deepEqual(Object.keys(contract.buildNewMembership({ organizationId: "o1", uid: "u1", orgRole: "org_admin" }, "pa").data).sort(), ["addedBy", "createdAt", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
  assert.deepEqual(contract.buildMembershipStatusChange("suspended", "oa"), { status: "suspended", statusChangedAt: TS, statusChangedBy: "oa", updatedAt: TS });
  assert.deepEqual(contract.buildMembershipRoleChange("org_admin"), { orgRole: "org_admin", updatedAt: TS });
  assert.deepEqual(contract.buildMembershipSnapshotRefresh({ displayName: "B" }), { updatedAt: TS, displayName: "B" });
  assert.deepEqual(contract.buildNewCapabilityDocument({ organizationId: "o1", uid: "u1", caps: ["library.review"], denied: ["library.contribute"] }, "oa"), { id: "o1_u1", data: { schemaVersion: 1, organizationId: "o1", uid: "u1", caps: ["library.review"], denied: ["library.contribute"], updatedBy: "oa", createdAt: TS, updatedAt: TS } });
  assert.deepEqual(contract.buildCapabilityUpdate({ caps: ["library.publish"] }, "oa"), { caps: ["library.publish"], denied: [], updatedBy: "oa", updatedAt: TS });
});

test("write contract: client validation mirrors the Rules (throws OrganizationContractError)", () => {
  const bad = (fn, field) => assert.throws(fn, (e) => e instanceof W.OrganizationContractError && e.field === field, field);
  bad(() => contract.buildNewOrganization({ name: "ab", code: "ok-code" }, "pa"), "name");
  bad(() => contract.buildNewOrganization({ name: "x".repeat(121), code: "ok-code" }, "pa"), "name");
  for (const code of ["AB", "a", "ab", "-abc", "abc-", "a b c", "a_b", "x".repeat(41), "mã-việt"]) bad(() => contract.buildNewOrganization({ name: "Hợp lệ", code }, "pa"), "code");
  for (const code of ["abc", "a-b", "abc-123", "x".repeat(40)]) assert.ok(contract.buildNewOrganization({ name: "Hợp lệ", code }, "pa"));
  bad(() => contract.buildNewOrganization({ name: "Hợp lệ", code: "abc" }, ""), "actorUid");
  bad(() => contract.buildNewMembership({ organizationId: "o_1", uid: "u" }, "pa"), "organizationId");
  bad(() => contract.buildNewMembership({ organizationId: "o1", uid: "a/b" }, "pa"), "uid");
  bad(() => contract.buildNewMembership({ organizationId: "o1", uid: "u", orgRole: "owner" }, "pa"), "orgRole");
  bad(() => contract.buildNewMembership({ organizationId: "o1", uid: "u", displayName: "x".repeat(121) }, "pa"), "displayName");
  bad(() => contract.buildNewMembership({ organizationId: "o1", uid: "u", email: "x".repeat(201) }, "pa"), "email");
  bad(() => contract.buildMembershipStatusChange("banned", "oa"), "status");
  bad(() => contract.buildMembershipRoleChange("owner"), "orgRole");
  bad(() => contract.buildNewCapabilityDocument({ organizationId: "o1", uid: "u", caps: ["library.contribute"] }, "oa"), "caps");
  bad(() => contract.buildNewCapabilityDocument({ organizationId: "o1", uid: "u", caps: ["library.review", "library.review"] }, "oa"), "caps");
  bad(() => contract.buildNewCapabilityDocument({ organizationId: "o1", uid: "u", caps: "library.review" }, "oa"), "caps");
  bad(() => contract.buildNewCapabilityDocument({ organizationId: "o1", uid: "u", denied: ["library.review"] }, "oa"), "denied");
  bad(() => contract.buildCapabilityUpdate({ caps: ["curriculum.manage", "x"] }, "oa"), "caps");
});

test("write contract: ids are deterministic; chunking is generic and defaults are implementation safety margins, not domain limits", () => {
  assert.equal(W.membershipDocId("o1", "u1"), "o1_u1"); assert.equal(W.capabilityDocId("o1", "u1"), "o1_u1");
  assert.throws(() => W.membershipDocId("o_1", "u"), W.OrganizationContractError);
  assert.equal(W.CAPABILITY_WRITE_CHUNK_DEFAULT, 10); assert.equal(W.MEMBERSHIP_WRITE_CHUNK_DEFAULT, 400);
  const items = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(W.chunkCapabilityWrites(items).map((c) => c.length), [10, 10, 3]);
  assert.deepEqual(W.chunkCapabilityWrites(items, 16).map((c) => c.length), [16, 7]);
  assert.deepEqual(W.chunkMembershipWrites(Array.from({ length: 850 }, (_, i) => i)).map((c) => c.length), [400, 400, 50]);
  assert.deepEqual(W.chunkWrites([], 5), []);
  for (const size of [0, -1, 1.5, "3", undefined]) assert.throws(() => W.chunkWrites(items, size), W.OrganizationContractError);
  assert.throws(() => W.chunkWrites("abc", 2), W.OrganizationContractError);
});

test("write contract: no add-member-by-Organization-Admin builder and no user-discovery helper exist (D1)", () => {
  const names = [...Object.keys(W), ...Object.keys(contract)];
  for (const n of names) assert.ok(!/discover|searchUsers|listUsers|findUser|inviteMember|addMemberAsOrgAdmin|orgAdminAdd/i.test(n), "forbidden export " + n);
  assert.deepEqual(Object.keys(contract).sort(), [
    "buildCapabilityUpdate", "buildMembershipRoleChange", "buildMembershipSnapshotRefresh", "buildMembershipStatusChange", "buildNewCapabilityDocument",
    "buildNewMembership", "buildNewOrganization", "buildOrganizationArchive", "buildOrganizationRename", "buildOrganizationRestore"
  ]);
  assert.ok(Object.isFrozen(contract));
});

// ---------------- admin-feature-registry ----------------
test("registry: minimal metadata only (key, audience, routeKey, requiredCapability); two features; visibility by principal", () => {
  assert.deepEqual(ADMIN_FEATURES.map((f) => Object.keys(f).sort()), [["audience", "key", "requiredCapability", "routeKey"], ["audience", "key", "requiredCapability", "routeKey"]]);
  assert.deepEqual(ADMIN_FEATURES.map((f) => [f.key, f.audience, f.routeKey, f.requiredCapability]), [["organizations", "platform", "organizations", null], ["organizationAdmin", "organization", "orgAdmin", "org.members.manage"]]);
  assert.deepEqual(ADMIN_FEATURE_AUDIENCES, { PLATFORM: "platform", ORGANIZATION: "organization" });
  assert.ok(Object.isFrozen(ADMIN_FEATURES) && ADMIN_FEATURES.every(Object.isFrozen));
  assert.equal(getAdminFeature("organizations").audience, "platform"); assert.equal(getAdminFeature("nope"), null);
  assert.deepEqual(adminFeaturesForAudience("organization").map((f) => f.key), ["organizationAdmin"]);
  assert.deepEqual(visibleAdminFeatures().map((f) => f.key), []);
  assert.deepEqual(visibleAdminFeatures({ isPlatformAdmin: true }).map((f) => f.key), ["organizations"]);
  assert.deepEqual(visibleAdminFeatures({ isOrgAdmin: true }).map((f) => f.key), ["organizationAdmin"]);
  assert.deepEqual(visibleAdminFeatures({ isPlatformAdmin: "yes", isOrgAdmin: 1 }).map((f) => f.key), [], "only strict booleans grant visibility");
});

test("queries: capabilitiesOfOrganization keeps document-id order (only the membership list is newest-first; no index exists for capabilities)", async () => {
  const { deps, log } = makeDeps([[snap("o1_u1", { organizationId: "o1" })]]);
  await createOrganizationQueries(deps).capabilitiesOfOrganization({}, "o1");
  assert.deepEqual(log[0].constraints.map((x) => x.t), ["where", "orderBy", "limit"]);
  assert.deepEqual(log[0].constraints.filter((x) => x.t === "orderBy").map((x) => [x.field, x.dir]), [["__name__", undefined]]);
});
