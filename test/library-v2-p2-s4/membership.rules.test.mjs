// Library V2 P2-S4 - EMULATOR CONTRACT PROOF for ordinary membership management against the EXACT deployed P2-S1 Firestore Rules
// (firestore.rules.production-candidate, SHA-256 A0B206FC... = P3-S1 candidate = the deployed ruleset 7e4333e7-a927-47aa-b20d-74c58f778e7b / 7EA5D7A5... plus the P3 region). Synthetic data only.
// Run: firebase emulators:exec --only firestore --project demo-p2s4 --config test/library-v2-p2-s1/firebase.json "node --test test/library-v2-p2-s4/membership.rules.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, seedWorld, candidateRules, sha, D, memberDoc,
  assertFails, assertSucceeds, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where, orderBy, limit, startAfter, documentId, writeBatch, serverTimestamp
} from "../library-v2-p2-s1/helpers.mjs";
import { createOrganizationWriteContract } from "../../organization-write-contract.mjs";
import { createOrganizationQueries } from "../../organization-queries.mjs";
import { createMembershipWriter, createTeacherEmailSearchQuery, planMembershipAdditions, availableMemberActions, nextStatusForAction } from "../../organization-membership-view.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "A0B206FCDDA3843DB2E08EEEEB00A9704B5A1415B97B9E488477D8F21AA4921D", "proven against the approved P3-S1 Rules artifact");
const env = await makeEnv("demo-p2s4-membership", rules);
await seedWorld(env);
// 60 additional active teachers (candidates), 2 suspended and 1 pending teacher, plus 130 existing members in orgA for paging.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (let i = 0; i < 60; i++) {
    const uid = "cand" + String(i).padStart(3, "0");
    await setDoc(doc(db, "users", uid), { uid, role: "teacher", status: "active", displayName: "Ứng viên " + i, email: uid + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(1 + (i % 25)) });
  }
  for (const [uid, status] of [["candS1", "suspended"], ["candS2", "suspended"], ["candP", "pending"]]) await setDoc(doc(db, "users", uid), { uid, role: "teacher", status, displayName: uid, email: uid + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(3) });
  for (let i = 0; i < 400; i++) { const uid = "bulk" + String(i).padStart(3, "0"); await setDoc(doc(db, "users", uid), { uid, role: "teacher", status: "active", displayName: uid, email: uid + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(2) }); }
  for (let i = 0; i < 130; i++) await setDoc(doc(db, "organizationMembers", "orgA_pg" + String(i).padStart(3, "0")), memberDoc("orgA", "pg" + String(i).padStart(3, "0")));
});
const as = actors(env);
const C = createOrganizationWriteContract({ serverTimestamp });
const Q = createOrganizationQueries({ collection, doc, query, where, orderBy, limit, startAfter, documentId, getDocs, getDoc });
const W = createMembershipWriter({ collection, doc, writeBatch, updateDoc });
const P = createTeacherEmailSearchQuery({ collection, query, where, orderBy, limit, getDocs });
test.after(async () => env.cleanup());
const ok = (p, m) => assertSucceeds(p, m), no = (p, m) => assertFails(p, m);
const orgActive = { id: "orgB", status: "active" };

async function addAsAdmin(orgId, uids, actor = "pa") {
  const db = as(actor);
  const org = { id: orgId, status: "active" };
  const teachers = await Promise.all(uids.map(async (uid) => ({ id: uid, ...(await getDoc(doc(as("pa"), "users", uid))).data() })));
  const existing = new Map(await Promise.all(uids.map(async (uid) => [uid, await Q.membershipOf(as("pa"), orgId, uid)])));
  const plan = planMembershipAdditions({ organization: org, candidates: teachers, existingByUid: existing, actorUid: actor, contract: C });
  await W.createMany(db, plan.toCreate);
  return plan;
}

test("Platform Admin adds ONE teacher: contract payload accepted; snapshot stored; the member can then read the organization", async () => {
  const plan = await addAsAdmin("orgB", ["cand000"]);
  assert.equal(plan.toCreate.length, 1);
  const stored = (await getDoc(doc(as("pa"), "organizationMembers", "orgB_cand000"))).data();
  assert.equal(stored.orgRole, "member"); assert.equal(stored.status, "active"); assert.equal(stored.addedBy, "pa");
  assert.equal(stored.displayName, "Ứng viên 0"); assert.equal(stored.email, "cand000@example.test");
  await ok(getDoc(doc(as("cand000"), "organizations", "orgB")));
});

test("Platform Admin adds MANY teachers in one operation (one batch) and in multiple chunks", async () => {
  const uids = Array.from({ length: 12 }, (_, i) => "cand" + String(i + 1).padStart(3, "0"));
  const plan = await addAsAdmin("orgB", uids);
  assert.equal(plan.toCreate.length, 12);
  const page = await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 100 });
  for (const uid of uids) assert.ok(page.items.some((m) => m.uid === uid && m.orgRole === "member" && m.status === "active"));
  // chunking is an implementation safety value: 3 teachers with chunk size 2 -> 2 batches, all accepted
  const three = ["cand020", "cand021", "cand022"];
  const teachers = three.map((uid) => ({ id: uid, role: "teacher", status: "active", displayName: uid, email: uid + "@example.test" }));
  const p2 = planMembershipAdditions({ organization: orgActive, candidates: teachers, existingByUid: new Map(three.map((u) => [u, null])), actorUid: "pa", contract: C });
  assert.equal(await W.createMany(as("pa"), p2.toCreate, 2), 3);
  // and a full default chunk (400) of builder-made memberships passes the Rules in ONE batch (same evidence as S2, through the S4 writer)
  const bulk = Array.from({ length: 400 }, (_, i) => "bulk" + String(i).padStart(3, "0")).map((uid) => ({ id: uid, role: "teacher", status: "active", displayName: uid, email: uid + "@example.test" }));
  const p3 = planMembershipAdditions({ organization: orgActive, candidates: bulk, existingByUid: new Map(bulk.map((t) => [t.id, null])), actorUid: "pa", contract: C });
  assert.equal(await W.createMany(as("pa"), p3.toCreate), 400);
});

test("DUPLICATE membership is impossible: re-creating an existing id (any status) is rejected by the Rules and overwrites nothing; the UI plan skips associated users", async () => {
  const before = (await getDoc(doc(as("pa"), "organizationMembers", "orgB_cand000"))).data();
  const forced = C.buildNewMembership({ organizationId: "orgB", uid: "cand000", displayName: "Đổi tên", email: "doi@example.test" }, "pa");
  await no(W.createMany(as("pa"), [forced]), "second create on an existing id");
  const after = (await getDoc(doc(as("pa"), "organizationMembers", "orgB_cand000"))).data();
  assert.deepEqual(after, before, "existing membership untouched");
  // one duplicate inside a batch rejects the WHOLE batch atomically (so the UI always pre-checks and skips)
  const fresh = C.buildNewMembership({ organizationId: "orgB", uid: "cand040" }, "pa");
  await no(W.createMany(as("pa"), [fresh, forced]));
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgB_cand040"))).exists(), false, "no partial write");
  // removed / suspended / org_admin memberships are also not re-creatable
  for (const uid of ["rm", "sm", "oaA"]) await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgA", uid }, "pa")]), uid);
  // plan-level: associated users are skipped
  const teachers = ["rm", "sm", "oaA", "cand041"].map((id) => ({ id, role: "teacher", status: "active", displayName: id, email: "" }));
  const existing = new Map(await Promise.all(teachers.map(async (t) => [t.id, await Q.membershipOf(as("pa"), "orgA", t.id)])));
  const plan = planMembershipAdditions({ organization: { id: "orgA", status: "active" }, candidates: teachers, existingByUid: existing, actorUid: "pa", contract: C });
  assert.deepEqual(plan.toCreate.map((x) => x.id), ["orgA_cand041"]);
  assert.deepEqual(plan.skipped.map((s) => s.uid), ["rm", "sm", "oaA"]);
});

test("exact lookup of a NON-existent membership by the Platform Admin returns null (not a permission error) - needed for duplicate pre-checks", async () => {
  assert.equal(await Q.membershipOf(as("pa"), "orgB", "cand055"), null);
  assert.ok((await Q.membershipOf(as("pa"), "orgA", "mA1")).uid === "mA1");
});

test("status lifecycle through contract builders: suspend, restore, soft-remove, reinstate (Platform Admin); meta fields recorded; documents never deleted", async () => {
  const id = "orgB_cand001", ref = doc(as("pa"), "organizationMembers", id);
  const step = async (action) => {
    await ok(updateDoc(ref, C.buildMembershipStatusChange(nextStatusForAction(action), "pa")), action);
    return (await getDoc(ref)).data();
  };
  let d = await step("suspend"); assert.equal(d.status, "suspended"); assert.equal(d.statusChangedBy, "pa"); assert.ok(d.statusChangedAt);
  d = await step("restore"); assert.equal(d.status, "active");
  d = await step("remove"); assert.equal(d.status, "removed"); assert.equal(d.orgRole, "member"); assert.equal(d.displayName, "Ứng viên 1", "snapshot retained");
  assert.deepEqual(availableMemberActions({ ...d, id }, { id: "orgB", status: "active" }), ["reinstate"]);
  d = await step("reinstate"); assert.equal(d.status, "active");
  await no(deleteDoc(ref), "memberships are never deleted");
  for (const uid of ["oaB", "cand001", "out"]) await no(deleteDoc(doc(as(uid), "organizationMembers", id)), "delete by " + uid);
});

test("a removed/suspended member loses organization access at once; a globally suspended platform account is NOT treated as active membership authority", async () => {
  const ref = doc(as("pa"), "organizationMembers", "orgB_cand002");
  await ok(getDoc(doc(as("cand002"), "organizations", "orgB")));
  await ok(updateDoc(ref, C.buildMembershipStatusChange("suspended", "pa")));
  await no(getDoc(doc(as("cand002"), "organizations", "orgB")), "suspended membership");
  await ok(updateDoc(ref, C.buildMembershipStatusChange("active", "pa")));
  await ok(getDoc(doc(as("cand002"), "organizations", "orgB")));
  await ok(updateDoc(ref, C.buildMembershipStatusChange("removed", "pa")));
  await no(getDoc(doc(as("cand002"), "organizations", "orgB")), "removed membership");
  // membership says active, but the platform account is suspended (seed user "susp", member of orgA): denied; membership status is unchanged
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgA_susp"))).data().status, "active");
  await no(getDoc(doc(as("susp"), "organizations", "orgA")), "suspended platform account");
  // platform suspension is independent: nothing in the S4 flow writes users or cascades into memberships
  assert.equal((await getDoc(doc(as("pa"), "users", "susp"))).data().status, "suspended");
});

test("ARCHIVED organization: membership creation is denied by the Rules; the UI also offers no action (Rules do not block Platform Admin status updates there - OBSERVATION)", async () => {
  await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgC", uid: "cand050" }, "pa")]), "create in archived organization");
  assert.throws(() => planMembershipAdditions({ organization: { id: "orgC", status: "archived" }, candidates: [], existingByUid: new Map(), actorUid: "pa", contract: C }), /organization-archived/);
  for (const status of ["active", "suspended", "removed"]) assert.deepEqual(availableMemberActions({ orgRole: "member", status }, { id: "orgC", status: "archived" }), []);
  // OBSERVATION (reported to the Owner, Rules deliberately not changed in S4): the deployed Rules let the Platform Admin change status in an archived organization.
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgC_mC"), C.buildMembershipStatusChange("suspended", "pa")), "Platform Admin status update in archived org is Rules-permitted");
  // an Organization Admin cannot (isOrgAdmin + orgActive required)
  await no(updateDoc(doc(as("oaC"), "organizationMembers", "orgC_mC"), C.buildMembershipStatusChange("active", "oaC")), "Organization Admin in archived org");
});

test("authorization: non-Platform-Admins cannot create, list or manage memberships through S4 paths; Organization Admin cannot add or reinstate", async () => {
  for (const actor of ["oaB", "mB1", "out", "susp", "spa"]) await no(W.createMany(as(actor), [C.buildNewMembership({ organizationId: "orgB", uid: "cand053" }, actor)]), "create by " + actor);
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgB_cand053"))).exists(), false);
  await no(Q.membersOfOrganization(as("mB1"), "orgB", { pageSize: 10 }), "ordinary member lists members");
  await no(Q.membersOfOrganization(as("out"), "orgB", { pageSize: 10 }), "outsider lists members");
  await no(Q.membersOfOrganization(as("oaA"), "orgB", { pageSize: 10 }), "other-organization admin lists members");
  await ok(Q.membersOfOrganization(as("oaB"), "orgB", { pageSize: 10 }), "own organization admin may read (Rules; S4 screen is still Platform Admin only)");
  // Organization Admin cannot reinstate a removed member (resource status removed is excluded for the org-admin branch)
  await no(updateDoc(doc(as("oaB"), "organizationMembers", "orgB_cand002"), C.buildMembershipStatusChange("active", "oaB")), "org admin reinstate");
  await no(updateDoc(doc(as("mB1"), "organizationMembers", "orgB_cand003"), C.buildMembershipStatusChange("removed", "mB1")), "member removes another member");
});

test("paged member list: 25 per page over 130+ members, cursor continuity, no duplicates, never unbounded", async () => {
  const seen = new Set(); let cursor, pages = 0, hasMore = true;
  while (hasMore) {
    const page = await Q.membersOfOrganization(as("pa"), "orgA", { pageSize: 25, cursor });
    assert.ok(page.items.length <= 25);
    for (const m of page.items) { assert.ok(!seen.has(m.id), "no duplicate across pages"); seen.add(m.id); assert.equal(m.organizationId, "orgA"); }
    cursor = page.cursor; hasMore = page.hasMore; pages++;
    assert.ok(pages < 20);
  }
  assert.ok(seen.size >= 130 && pages >= 6, `${seen.size} members over ${pages} pages`);
  await assert.rejects(() => Q.membersOfOrganization(as("pa"), "orgA", { pageSize: 101 }), RangeError);
});

test("the O1 email-prefix search query is allowed for the Platform Admin only and returns bounded results", async () => {
  const found = await P.searchByEmailPrefix(as("pa"), "cand00");
  assert.ok(found.users.length >= 1 && found.users.length <= 20 && found.users.every((u) => u.email.startsWith("cand00")));
  assert.equal(found.more, false);
  for (const actor of ["mB1", "oaB", "out"]) await no(P.searchByEmailPrefix(as(actor), "cand00"), "email search by " + actor);
});

test("S4 never touches users, capabilities or Organization-Admin roles through the contract it uses", async () => {
  // the S4 builders cannot express an org_admin appointment or a role change (guarded statically too)
  assert.equal(C.buildNewMembership({ organizationId: "orgB", uid: "x" }, "pa").data.orgRole, "member");
  assert.deepEqual(Object.keys(C.buildMembershipStatusChange("suspended", "pa")).sort(), ["statusChangedAt", "statusChangedBy", "status", "updatedAt"].sort());
  // and the Rules would refuse a role smuggled into a status change by a non-admin
  await no(updateDoc(doc(as("oaB"), "organizationMembers", "orgB_mB1"), { ...C.buildMembershipStatusChange("suspended", "oaB"), orgRole: "org_admin" }));
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgB_mB1"))).data().orgRole, "member");
});

test("NEWEST FIRST: persistent order createdAt DESC + document id DESC; separate adds ordered by time, same-batch adds deterministic; status changes never reorder", async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const addBatch = async (orgId, uids) => { const b = writeBatch(as("pa")); for (const uid of uids) { const m = C.buildNewMembership({ organizationId: orgId, uid }, "pa"); b.set(doc(collection(as("pa"), "organizationMembers"), m.id), m.data); } await ok(b.commit()); };
  // orgB already holds older seeded/earlier members (createdAt in the past); add three batches with real time between them
  await addBatch("orgB", ["zz3", "zz1", "zz2"]); await sleep(1100);
  await addBatch("orgB", ["zz9"]); await sleep(1100);
  await addBatch("orgB", ["zz5", "zz7"]);
  const first = await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 6 });
  assert.deepEqual(first.items.slice(0, 6).map((m) => m.uid), ["zz7", "zz5", "zz9", "zz3", "zz2", "zz1"], "latest batch first (id desc inside a batch), then earlier batches");
  // status changes (updatedAt moves, createdAt is immutable) must not move anyone
  const { updateDoc } = await import("../library-v2-p2-s1/helpers.mjs");
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgB_zz1"), C.buildMembershipStatusChange("suspended", "pa")));
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgB_zz9"), C.buildMembershipStatusChange("removed", "pa")));
  assert.deepEqual((await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 6 })).items.map((m) => m.uid), ["zz7", "zz5", "zz9", "zz3", "zz2", "zz1"]);
  // cursor pagination over the WHOLE organization (400+ members here): traversal with a small page equals traversal with the maximum page, no duplicates, no omissions
  const traverse = async (size) => { const out = []; let cursor, more = true, pages = 0; while (more) { const p = await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: size, cursor }); out.push(...p.items.map((m) => m.id)); cursor = p.cursor; more = p.hasMore; if (++pages > 500) throw new Error("runaway paging"); } return out; };
  const everything = await traverse(100);
  const paged = await traverse(7);
  assert.ok(everything.length >= 400, "large population: " + everything.length);
  assert.deepEqual(paged, everything, "paged traversal equals the single ordered list");
  assert.equal(new Set(paged).size, paged.length);
  // a member added while the administrator is on page 2 does not disturb 'load more' (new items sort BEFORE the cursor)
  const p1 = await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 3 });
  await sleep(1100); await addBatch("orgB", ["zzNew"]);
  const p2 = await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 3, cursor: p1.cursor });
  assert.deepEqual(p2.items.map((m) => m.id), everything.slice(3, 6), "load-more continues exactly where page 1 ended");
  assert.equal((await Q.membersOfOrganization(as("pa"), "orgB", { pageSize: 1 })).items[0].uid, "zzNew", "the newest member is the first row of a fresh page 1");
  // capabilities listing keeps its document-id order (no index was approved for it)
  assert.ok(Array.isArray((await Q.capabilitiesOfOrganization(as("pa"), "orgB")).items));
});
