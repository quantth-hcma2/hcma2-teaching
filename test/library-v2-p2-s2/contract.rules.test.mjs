// Library V2 P2-S2 - EMULATOR CONTRACT PROOF: the client builders/queries match the EXACT deployed P2-S1 Firestore Rules.
// Rules under test = firestore.rules.production-candidate (SHA-256 7EA5D7A5..., production ruleset 7e4333e7-a927-47aa-b20d-74c58f778e7b).
// Run: firebase emulators:exec --only firestore --project demo-p2s2 --config test/library-v2-p2-s1/firebase.json "node --test test/library-v2-p2-s2/contract.rules.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, seedWorld, candidateRules, sha, D, memberDoc,
  assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy, limit, startAfter, documentId, writeBatch, serverTimestamp
} from "../library-v2-p2-s1/helpers.mjs";
import { createOrganizationWriteContract, chunkCapabilityWrites, CAPABILITY_WRITE_CHUNK_DEFAULT, OrganizationContractError } from "../../organization-write-contract.mjs";
import { createOrganizationQueries, createPlatformAdminOrganizationQueries } from "../../organization-queries.mjs";
import { resolveOrganizationContext } from "../../organization-context.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7EA5D7A5EBAC9DF18E995C9A1644B2648E4143FA4FE3046C0DE7F8737FCC1DDD", "contract is proven against the deployed Rules artifact");
const env = await makeEnv("demo-p2s2-contract", rules);
await seedWorld(env);
// 24 extra ordinary members (no capability documents) and 120 members for paging in orgA
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (let i = 0; i < 24; i++) {
    const uid = "cx" + String(i).padStart(2, "0");
    await setDoc(doc(db, "users", uid), { uid, role: "teacher", status: "active", approvedBy: null, approvedAt: null, createdAt: D(1) });
    await setDoc(doc(db, "organizationMembers", "orgA_" + uid), memberDoc("orgA", uid));
  }
  for (let i = 0; i < 120; i++) await setDoc(doc(db, "organizationMembers", "orgA_pg" + String(i).padStart(3, "0")), memberDoc("orgA", "pg" + String(i).padStart(3, "0")));
});
const as = actors(env);
const C = createOrganizationWriteContract({ serverTimestamp });
const Q = createOrganizationQueries({ collection, doc, query, where, orderBy, limit, startAfter, documentId, getDocs, getDoc });
const PQ = createPlatformAdminOrganizationQueries({ collection, query, orderBy, limit, getDocs });
test.after(async () => env.cleanup());
const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const create = (db, col, id, data) => setDoc(doc(db, col, id), data);
const update = (db, col, id, data) => updateDoc(doc(db, col, id), data);

// Mutation harness: every mutation of a builder-valid payload must be rejected.
function mutations(payload, { required = [], extra = { unexpectedField: 1 }, replacements = {} } = {}) {
  const out = [["adds an unknown field", { ...payload, ...extra }]];
  for (const key of required) { const { [key]: _drop, ...rest } = payload; out.push(["drops " + key, rest]); }
  for (const [key, values] of Object.entries(replacements)) for (const v of values) out.push(["sets " + key + " = " + JSON.stringify(v), { ...payload, [key]: v }]);
  return out;
}
async function everyMutationDenied(label, mutate, list) {
  for (const [name, data] of list) await assertFails(mutate(data), label + " " + name);
}

test("deployed Rules artifact pinned; builder output is accepted for every Platform Admin organization action (create, rename, archive, restore)", async () => {
  const pa = as("pa");
  await ok(create(pa, "organizations", "ctOrg1", C.buildNewOrganization({ name: "Đơn vị hợp đồng", code: "hop-dong" }, "pa")));
  await ok(create(pa, "organizations", "ctOrg3", C.buildNewOrganization({ name: "Ba chữ", code: "abc" }, "pa")));                              // 3-char code
  await ok(create(pa, "organizations", "ctOrg40", C.buildNewOrganization({ name: "x".repeat(120), code: "a" + "b".repeat(38) + "c" }, "pa"))); // 40-char code, 120-char name
  await ok(update(pa, "organizations", "ctOrg1", C.buildOrganizationRename("Tên mới của đơn vị")));
  await ok(update(pa, "organizations", "ctOrg1", C.buildOrganizationArchive("pa")));
  await ok(update(pa, "organizations", "ctOrg1", C.buildOrganizationRestore()));
  await ok(update(pa, "organizations", "ctOrg1", C.buildOrganizationRename("Tên sau khi khôi phục")));                                         // rename after restore (no archive keys changed)
  for (const u of ["oaA", "mA1", "out"]) await no(create(as(u), "organizations", "ctNo" + u, C.buildNewOrganization({ name: "Không được", code: "khong-duoc" }, u)));
});

test("mutated organization payloads are rejected by the Rules", async () => {
  const pa = as("pa");
  const base = C.buildNewOrganization({ name: "Đơn vị đột biến", code: "dot-bien" }, "pa");
  await everyMutationDenied("create org", (d) => create(pa, "organizations", "ctMut", d), mutations(base, {
    required: ["schemaVersion", "name", "code", "status", "createdAt", "createdBy", "updatedAt"],
    replacements: { schemaVersion: [2, "1", 0], status: ["archived", "suspended", "ACTIVE"], code: ["", "AB", "a b", "ab"], name: ["", "ab", 12], createdBy: ["someone", 7], createdAt: [new Date(), "now"], updatedAt: [new Date()] }
  }));
  for (const [label, data] of [["rename + code", { ...C.buildOrganizationRename("Tên hợp lệ"), code: "doi-ma" }], ["rename + createdBy", { ...C.buildOrganizationRename("Tên hợp lệ"), createdBy: "x" }], ["rename without updatedAt", { name: "Tên hợp lệ" }], ["rename with Date updatedAt", { name: "Tên hợp lệ", updatedAt: new Date() }], ["archive without metadata", { status: "archived", updatedAt: serverTimestamp() }], ["archive with wrong actor", { ...C.buildOrganizationArchive("pa"), archivedBy: "x" }], ["status suspended", { status: "suspended", updatedAt: serverTimestamp() }]]) {
    await assertFails(update(pa, "organizations", "ctOrg3", data), label);
  }
});

test("membership builders: accepted for the Platform Admin (member, appointed org_admin, with display snapshot); denied for an Organization Admin; denied in an archived organization", async () => {
  const pa = as("pa");
  const m1 = C.buildNewMembership({ organizationId: "orgA", uid: "ctU1", displayName: "Nguyễn Văn A", email: "a@example.test" }, "pa");
  const m2 = C.buildNewMembership({ organizationId: "orgA", uid: "ctU2", orgRole: "org_admin" }, "pa");
  await ok(create(pa, "organizationMembers", m1.id, m1.data));
  await ok(create(pa, "organizationMembers", m2.id, m2.data));
  const m3 = C.buildNewMembership({ organizationId: "orgA", uid: "ctU3" }, "oaA");
  await no(create(as("oaA"), "organizationMembers", m3.id, m3.data));                                   // no Organization-Admin add path (D1)
  const m4 = C.buildNewMembership({ organizationId: "orgA", uid: "ctU4", orgRole: "org_admin" }, "oaA");
  await no(create(as("oaA"), "organizationMembers", m4.id, m4.data));                                   // nor appointing
  for (const u of ["mA1", "out", "susp"]) { const x = C.buildNewMembership({ organizationId: "orgA", uid: "ctU5" }, u); await no(create(as(u), "organizationMembers", x.id, x.data)); }
  const archived = C.buildNewMembership({ organizationId: "orgC", uid: "ctU6" }, "pa");
  await no(create(pa, "organizationMembers", archived.id, archived.data));                              // archived organization: no new activity
  // bulk: 400 builder-made memberships in ONE batch (default membership chunk)
  const batch = writeBatch(pa);
  for (let i = 0; i < 400; i++) { const x = C.buildNewMembership({ organizationId: "orgB", uid: "bulk" + String(i).padStart(3, "0") }, "pa"); batch.set(doc(pa, "organizationMembers", x.id), x.data); }
  await ok(batch.commit());
});

test("re-adding a removed member: buildNewMembership on the existing document is rejected (set = update, createdAt would change); the status-change builder is the correct path and is Platform-Admin-only", async () => {
  const pa = as("pa"), oa = as("oaA");
  const again = C.buildNewMembership({ organizationId: "orgA", uid: "rm" }, "pa");                     // orgA_rm exists with status removed
  await no(create(pa, "organizationMembers", again.id, again.data));
  await no(update(oa, "organizationMembers", "orgA_rm", C.buildMembershipStatusChange("active", "oaA")));
  await ok(update(pa, "organizationMembers", "orgA_rm", C.buildMembershipStatusChange("active", "pa")));
  await ok(update(pa, "organizationMembers", "orgA_rm", C.buildMembershipStatusChange("removed", "pa")));
});

test("mutated membership payloads are rejected", async () => {
  const pa = as("pa");
  const built = C.buildNewMembership({ organizationId: "orgA", uid: "ctMut", displayName: "Tên", email: "e@x.test" }, "pa");
  await everyMutationDenied("create membership", (d) => create(pa, "organizationMembers", built.id, d), mutations(built.data, {
    required: ["schemaVersion", "organizationId", "uid", "orgRole", "status", "addedBy", "createdAt", "updatedAt"],
    replacements: { schemaVersion: [2], orgRole: ["owner", "admin"], status: ["suspended", "removed"], addedBy: ["x"], createdAt: [new Date()], updatedAt: [new Date()], displayName: ["x".repeat(121), 5], email: ["x".repeat(201), 5], uid: ["other"], organizationId: ["orgB"] }
  }));
  await no(create(pa, "organizationMembers", "orgA_wrongId", built.data));                                  // id disagrees with fields
});

test("status-change builder: Organization Admin may suspend/restore/remove ordinary members only; removed->active, org_admin targets and role changes are Platform-Admin-only", async () => {
  const oa = as("oaA"), pa = as("pa");
  await ok(update(oa, "organizationMembers", "orgA_mA2", C.buildMembershipStatusChange("suspended", "oaA")));
  await ok(update(oa, "organizationMembers", "orgA_mA2", C.buildMembershipStatusChange("active", "oaA")));
  await ok(update(oa, "organizationMembers", "orgA_mA2", C.buildMembershipStatusChange("removed", "oaA")));
  await no(update(oa, "organizationMembers", "orgA_mA2", C.buildMembershipStatusChange("active", "oaA")));         // removed stays removed for an Organization Admin
  await ok(update(pa, "organizationMembers", "orgA_mA2", C.buildMembershipStatusChange("active", "pa")));
  await no(update(oa, "organizationMembers", "orgA_ctU2", C.buildMembershipStatusChange("suspended", "oaA")));     // org_admin target
  await no(update(oa, "organizationMembers", "orgA_oaA", C.buildMembershipStatusChange("removed", "oaA")));       // self
  await no(update(as("mA1"), "organizationMembers", "orgA_mA3", C.buildMembershipStatusChange("suspended", "mA1")));
  await no(update(oa, "organizationMembers", "orgA_mA3", C.buildMembershipStatusChange("suspended", "someoneElse")));   // actor must be the caller
  await no(update(as("oaB"), "organizationMembers", "orgA_mA3", C.buildMembershipStatusChange("suspended", "oaB")));      // other organization's admin
  // role change and snapshot refresh: Platform Admin only
  await ok(update(pa, "organizationMembers", "orgA_mA3", C.buildMembershipRoleChange("org_admin")));
  await ok(update(pa, "organizationMembers", "orgA_mA3", C.buildMembershipRoleChange("member")));
  await no(update(oa, "organizationMembers", "orgA_mA3", C.buildMembershipRoleChange("org_admin")));
  await ok(update(pa, "organizationMembers", "orgA_mA3", C.buildMembershipSnapshotRefresh({ displayName: "Tên làm mới", email: "moi@example.test" })));
  await no(update(oa, "organizationMembers", "orgA_mA3", C.buildMembershipSnapshotRefresh({ displayName: "Giả mạo" })));
  // 120 status changes in one batch by an Organization Admin
  const batch = writeBatch(oa);
  for (let i = 0; i < 120; i++) batch.update(doc(oa, "organizationMembers", "orgA_pg" + String(i).padStart(3, "0")), C.buildMembershipStatusChange("suspended", "oaA"));
  await ok(batch.commit());
  for (const [label, data] of [["status without audit metadata", { status: "suspended", updatedAt: serverTimestamp() }], ["wrong statusChangedAt", { ...C.buildMembershipStatusChange("suspended", "oaA"), statusChangedAt: new Date() }], ["extra displayName", { ...C.buildMembershipStatusChange("suspended", "oaA"), displayName: "x" }], ["changes uid", { ...C.buildMembershipStatusChange("suspended", "oaA"), uid: "x" }], ["changes organizationId", { ...C.buildMembershipStatusChange("suspended", "oaA"), organizationId: "orgB" }], ["changes addedBy", { ...C.buildMembershipStatusChange("suspended", "oaA"), addedBy: "x" }], ["invalid status", { ...C.buildMembershipStatusChange("suspended", "oaA"), status: "banned" }], ["promotes", { ...C.buildMembershipStatusChange("suspended", "oaA"), orgRole: "org_admin" }]]) {
    await assertFails(update(oa, "organizationMembers", "orgA_cx00", data), label);
  }
});

test("capability builders: accepted for Platform Admin and Organization Admin on ordinary members; chunk default (10) commits; org_admin/self/non-member/other-organization denied", async () => {
  const oa = as("oaA"), pa = as("pa");
  const c1 = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "cx00", caps: ["library.review"] }, "oaA");
  await ok(create(oa, "userCapabilities", c1.id, c1.data));
  await ok(update(oa, "userCapabilities", c1.id, C.buildCapabilityUpdate({ caps: ["library.review", "library.publish", "library.manage", "curriculum.manage"], denied: ["library.contribute"] }, "oaA")));
  await ok(update(oa, "userCapabilities", c1.id, C.buildCapabilityUpdate({ caps: [] }, "oaA")));                       // revocation = update to caps: []
  const own = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "oaA", caps: ["library.review"] }, "oaA");
  await no(create(oa, "userCapabilities", own.id, own.data));                                                         // self
  const adminTarget = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "ctU2", caps: ["library.review"] }, "oaA");
  await no(create(oa, "userCapabilities", adminTarget.id, adminTarget.data));                                         // org_admin target
  await no(create(pa, "userCapabilities", adminTarget.id, adminTarget.data));                                         // not even for the Platform Admin
  const nonMember = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "out", caps: ["library.review"] }, "oaA");
  await no(create(oa, "userCapabilities", nonMember.id, nonMember.data));
  const crossOrg = C.buildNewCapabilityDocument({ organizationId: "orgB", uid: "mB1", caps: ["library.review"] }, "oaA");
  await no(create(oa, "userCapabilities", crossOrg.id, crossOrg.data));
  await no(update(oa, "userCapabilities", "orgB_mB1", C.buildCapabilityUpdate({ caps: [] }, "oaA")));
  const memberSelf = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "mA1", caps: ["library.publish"] }, "mA1");
  await no(update(as("mA1"), "userCapabilities", "orgA_mA1", C.buildCapabilityUpdate({ caps: ["library.publish"] }, "mA1")));
  await no(create(as("cx01"), "userCapabilities", "orgA_cx01", C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "cx01", caps: ["library.publish"] }, "cx01").data));
  // default chunk size commits for both principals
  const targets = Array.from({ length: 21 }, (_, i) => "cx" + String(i + 1).padStart(2, "0"));
  for (const [actor, db, slice] of [["oaA", oa, targets.slice(0, 10)], ["pa", pa, targets.slice(11, 21)]]) {
    const [chunk] = chunkCapabilityWrites(slice.map((uid) => C.buildNewCapabilityDocument({ organizationId: "orgA", uid, caps: ["library.review"] }, actor)));
    assert.equal(chunk.length, CAPABILITY_WRITE_CHUNK_DEFAULT);
    const batch = writeBatch(db);
    for (const x of chunk) batch.set(doc(db, "userCapabilities", x.id), x.data);
    await ok(batch.commit());
  }
});

test("mutated capability payloads are rejected; builder-invalid inputs are also rejected by the Rules when sent raw (client validation mirrors the Rules)", async () => {
  const oa = as("oaA");
  const built = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "cx11", caps: ["library.review"], denied: [] }, "oaA");
  await ok(create(oa, "userCapabilities", built.id, built.data));            // existing document for the update mutations below
  await no(create(oa, "userCapabilities", "orgA_wrongId", built.data));
  // use an ordinary member without a capability document for creates
  const fresh = C.buildNewCapabilityDocument({ organizationId: "orgA", uid: "cx00x", caps: [] }, "oaA");
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "organizationMembers", "orgA_cx00x"), memberDoc("orgA", "cx00x")); });
  await everyMutationDenied("create caps", (d) => create(oa, "userCapabilities", fresh.id, d), mutations(fresh.data, {
    required: ["schemaVersion", "organizationId", "uid", "caps", "denied", "updatedBy", "createdAt", "updatedAt"],
    replacements: { schemaVersion: [2], caps: [["library.contribute"], ["library.review", "library.review"], "library.review", ["x"], ["library.review", "library.publish", "library.manage", "curriculum.manage", "library.review"]], denied: [["library.review"], ["library.contribute", "library.contribute"], "library.contribute"], updatedBy: ["someoneElse"], createdAt: [new Date()], updatedAt: [new Date()], uid: ["other"], organizationId: ["orgB"] }
  }));
  // raw payloads that the builder refuses must also be refused by the Rules
  const refused = [
    [{ organizationId: "orgA", uid: "cx00x", caps: ["library.contribute"] }, "caps with the implicit capability"],
    [{ organizationId: "orgA", uid: "cx00x", caps: ["library.review", "library.review"] }, "duplicate caps"],
    [{ organizationId: "orgA", uid: "cx00x", caps: ["unknown.cap"] }, "unknown capability"],
    [{ organizationId: "orgA", uid: "cx00x", denied: ["library.review"] }, "denied other than library.contribute"]
  ];
  for (const [input, label] of refused) {
    assert.throws(() => C.buildNewCapabilityDocument(input, "oaA"), OrganizationContractError, label);
    const raw = { schemaVersion: 1, organizationId: input.organizationId, uid: input.uid, caps: input.caps || [], denied: input.denied || [], updatedBy: "oaA", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(create(oa, "userCapabilities", "orgA_cx00x", raw), "raw " + label);
  }
  for (const [label, data] of [["updated with scopes", { ...C.buildCapabilityUpdate({ caps: [] }, "oaA"), scopes: { x: 1 } }], ["changes uid", { ...C.buildCapabilityUpdate({ caps: [] }, "oaA"), uid: "x" }], ["changes createdAt", { ...C.buildCapabilityUpdate({ caps: [] }, "oaA"), createdAt: new Date() }], ["wrong updatedBy", { ...C.buildCapabilityUpdate({ caps: [] }, "oaA"), updatedBy: "x" }], ["Date updatedAt", { ...C.buildCapabilityUpdate({ caps: [] }, "oaA"), updatedAt: new Date() }]]) {
    await assertFails(update(oa, "userCapabilities", "orgA_cx11", data), label);
  }
});

test("name/code length semantics: client character counting agrees with the Rules at the 120/121 boundary (Vietnamese precomposed and astral characters)", async () => {
  const pa = as("pa");
  const viet = "Đ".repeat(120), vietOver = "Đ".repeat(121);
  await ok(create(pa, "organizations", "ctLen1", C.buildNewOrganization({ name: viet, code: "do-dai-1" }, "pa")));
  assert.throws(() => C.buildNewOrganization({ name: vietOver, code: "do-dai-2" }, "pa"), OrganizationContractError);
  await no(create(pa, "organizations", "ctLen2", { ...C.buildNewOrganization({ name: viet, code: "do-dai-2" }, "pa"), name: vietOver }));
  // astral characters (emoji, 2 UTF-16 units each): the Rules count UTF-16 code units (not code points, not UTF-8 bytes);
  // 60 emoji = 120 units must be accepted, 61 emoji = 122 units rejected - and the client must agree on both sides of the boundary.
  const emoji = String.fromCodePoint(0x1F600);
  for (const [count, expectAccepted] of [[60, true], [61, false]]) {
    const name = emoji.repeat(count);
    let rules = true;
    try { await assertSucceeds(create(pa, "organizations", "ctAstral" + count, { ...C.buildNewOrganization({ name: "xxx", code: "ky-tu-" + count }, "pa"), name })); } catch { rules = false; }
    let client = true;
    try { C.buildNewOrganization({ name, code: "ky-tu-" + count }, "pa"); } catch { client = false; }
    assert.equal(rules, expectAccepted, "Rules: " + count + " emoji (" + count * 2 + " UTF-16 units)");
    assert.equal(client, rules, "client agrees with the Rules for " + count + " emoji");
  }
});

test("real query functions against the Rules: allowed for the right principal, denied otherwise; paging is bounded and complete", async () => {
  const oa = as("oaA"), m = as("mA1"), pa = as("pa");
  const first = await Q.membersOfOrganization(oa, "orgA", { pageSize: 50 });
  assert.equal(first.items.length, 50); assert.equal(first.hasMore, true);
  const seen = new Set(first.items.map((x) => x.id)); let page = first, guard = 0;
  while (page.hasMore && guard++ < 20) { page = await Q.membersOfOrganization(oa, "orgA", { pageSize: 50, cursor: page.cursor }); for (const x of page.items) { assert.ok(!seen.has(x.id), "no duplicate across pages"); seen.add(x.id); } }
  assert.ok(seen.size >= 120 + 14 && [...seen].every((id) => id.startsWith("orgA_")), "complete, single-organization result (" + seen.size + ")");
  assert.ok((await Q.capabilitiesOfOrganization(oa, "orgA")).items.every((x) => x.organizationId === "orgA"));
  await assert.rejects(() => Q.membersOfOrganization(m, "orgA"));                                                       // ordinary member: denied by Rules
  await assert.rejects(() => Q.membersOfOrganization(oa, "orgB"));                                                      // other organization: denied by Rules
  await assert.rejects(() => Q.capabilitiesOfOrganization(m, "orgA"));
  const own = await Q.membershipsOfUser(m, "mA1"); assert.deepEqual(own.map((x) => x.id), ["orgA_mA1"]);
  await assert.rejects(() => Q.membershipsOfUser(m, "oaA"));                                                            // someone else's memberships
  assert.equal((await Q.organizationById(m, "orgA")).code, "don-vi-a");
  await assert.rejects(() => Q.organizationById(m, "orgB"));
  assert.equal((await Q.membershipOf(m, "orgA", "mA1")).orgRole, "member");
  assert.deepEqual((await Q.capabilityOf(m, "orgA", "mA1")).caps.includes("library.review"), true);
  const all = await PQ.listAllOrganizationsAsPlatformAdminOnly(pa);
  assert.ok(all.length >= 3);
  for (const u of ["oaA", "mA1", "out", "susp"]) await assert.rejects(() => PQ.listAllOrganizationsAsPlatformAdminOnly(as(u)));
  // a raw multi-organization query (which the factory refuses on the client) is also denied by the Rules
  await no(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "in", ["orgA", "orgB"]))));
  await no(getDocs(collection(oa, "users")));                                                                           // no user discovery path
});

test("context resolver fed with REAL query results: multi-membership, archived organization and governance cases", async () => {
  const resolve = async (uid, preferred) => {
    const db = as(uid);
    let memberships = [];
    try { memberships = await Q.membershipsOfUser(db, uid); } catch { /* denied (suspended platform account) */ }
    const organizations = [];
    for (const m of memberships) { try { const o = await Q.organizationById(db, m.organizationId); if (o) organizations.push(o); } catch { /* not readable (suspended/removed) */ } }
    return resolveOrganizationContext({ memberships, organizations, preferredOrganizationId: preferred });
  };
  const multi = await resolve("multi");
  assert.deepEqual([multi.status, multi.candidates.map((c) => c.organizationId)], ["ready", ["orgA", "orgB"]]);
  assert.equal(multi.currentOrganizationId, "orgA");
  assert.equal((await resolve("multi", "orgB")).currentOrganizationId, "orgB");
  const archivedMember = await resolve("mC");
  assert.deepEqual([archivedMember.status, archivedMember.governed], ["none", []]);
  const archivedAdmin = await resolve("oaC");
  assert.deepEqual([archivedAdmin.status, archivedAdmin.governed.map((g) => g.organizationId)], ["none", ["orgC"]]);
  const admin = await resolve("oaA");
  assert.deepEqual([admin.currentOrganizationId, admin.isOrgAdmin], ["orgA", true]);
  const suspendedAccount = await resolve("susp");                                                                       // platform account suspended: Rules return nothing
  assert.equal(suspendedAccount.status, "none");
  const stranger = await resolve("out"); assert.equal(stranger.status, "none");
});
