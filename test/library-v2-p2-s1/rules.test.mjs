// LIBRARY V2 P2-S1 - organization Rules authorization matrix (Firestore emulator, real candidate Rules + test-only probes).
// Run: firebase emulators:exec --only firestore --project demo-p2s1 --config test/library-v2-p2-s1/firebase.json "node --test test/library-v2-p2-s1/"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, withProbes, candidateRules, seedWorld, newOrgPayload, newMemberPayload, statusChange, newCapPayload, capUpdate, memberDoc,
  assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, serverTimestamp
} from "./helpers.mjs";

const env = await makeEnv("demo-p2s1-rules", withProbes(candidateRules()));
await seedWorld(env);
const as = actors(env);
const anon = () => as("anonStudent", "anonymous");
test.after(async () => env.cleanup());

const ok = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);
const members = (db, org, n) => getDocs(query(collection(db, "organizationMembers"), where("organizationId", "==", org), orderBy(documentId()), limit(n || 50)));
const myMemberships = (db, uid) => getDocs(query(collection(db, "organizationMembers"), where("uid", "==", uid)));
const caps = (db, org) => getDocs(query(collection(db, "userCapabilities"), where("organizationId", "==", org)));
const probe = (db, kind, id) => getDoc(doc(db, "_probe_" + kind, id));

test("same organization: allow", async () => {
  await ok(getDoc(doc(as("mA1"), "organizations", "orgA")));
  await ok(members(as("oaA"), "orgA"));
  await ok(caps(as("oaA"), "orgA"));
  await ok(updateDoc(doc(as("oaA"), "organizationMembers", "orgA_mA1"), statusChange("oaA", "suspended")));
  await ok(updateDoc(doc(as("oaA"), "organizationMembers", "orgA_mA1"), statusChange("oaA", "active")));
  await ok(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), capUpdate("oaA", ["library.review", "library.publish"])));
  await ok(setDoc(doc(as("oaA"), "userCapabilities", "orgA_mA3"), newCapPayload("orgA", "mA3", "oaA", ["library.manage"], [])));
  await ok(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA2"), capUpdate("oaA", ["library.manage"], ["library.contribute"])));
  await ok(getDoc(doc(as("mA1"), "userCapabilities", "orgA_mA1")));
  await ok(myMemberships(as("mA1"), "mA1"));
});

test("cross-organization: deny (including Organization Admin of another organization)", async () => {
  const a = as("oaA"), m = as("mA1");
  await no(getDoc(doc(a, "organizations", "orgB")));
  await no(members(a, "orgB"));
  await no(caps(a, "orgB"));
  await no(getDoc(doc(a, "organizationMembers", "orgB_mB1")));
  await no(updateDoc(doc(a, "organizationMembers", "orgB_mB1"), statusChange("oaA", "suspended")));
  await no(updateDoc(doc(a, "userCapabilities", "orgB_mB1"), capUpdate("oaA", [])));
  await no(setDoc(doc(a, "userCapabilities", "orgB_oaB"), newCapPayload("orgB", "oaB", "oaA", [])));
  await no(getDoc(doc(m, "organizations", "orgB")));
  await no(members(m, "orgB"));
  await no(getDoc(doc(as("oaB"), "organizations", "orgA")));
  await no(updateDoc(doc(as("oaB"), "organizationMembers", "orgA_mA1"), statusChange("oaB", "suspended")));
  await no(probe(m, "cap", "b")); await no(probe(m, "contrib", "b")); await no(probe(a, "gov", "b")); await no(probe(a, "write", "b"));
  await ok(getDoc(doc(as("pa"), "organizations", "orgB")));
  await ok(members(as("pa"), "orgB"));
});

test("platform suspension is independent: suspended/pending account with an ACTIVE membership is denied everywhere", async () => {
  const s = as("susp"), p = as("pend");
  await no(getDoc(doc(s, "organizations", "orgA")));
  await no(myMemberships(s, "susp"));
  await no(getDoc(doc(s, "organizationMembers", "orgA_susp")));
  await no(probe(s, "contrib", "a")); await no(probe(s, "cap", "a")); await no(probe(s, "activemember", "a"));
  await no(getDoc(doc(p, "organizations", "orgA")));
  // a platform admin that is itself suspended loses every admin power
  const sp = as("spa");
  await no(getDoc(doc(sp, "organizations", "orgA")));
  await no(getDocs(collection(sp, "organizations")));
  await no(setDoc(doc(sp, "organizations", "newOrg"), newOrgPayload("spa")));
  // an Organization Admin whose PLATFORM account is suspended: flip the platform status only (membership untouched)
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "users", "oaA"), { status: "suspended" }); });
  await no(members(as("oaA"), "orgA"));
  await no(updateDoc(doc(as("oaA"), "organizationMembers", "orgA_mA2"), statusChange("oaA", "suspended")));
  await no(probe(as("oaA"), "gov", "a"));
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "users", "oaA"), { status: "active" }); });
  await ok(members(as("oaA"), "orgA"));
});

test("suspended or removed membership: denied organization access and effective capabilities; own record still readable", async () => {
  for (const u of ["sm", "rm"]) {
    const d = as(u);
    await no(getDoc(doc(d, "organizations", "orgA")));
    await no(probe(d, "contrib", "a")); await no(probe(d, "cap", "a")); await no(probe(d, "activemember", "a"));
    await ok(getDoc(doc(d, "organizationMembers", "orgA_" + u)));
    await ok(myMemberships(d, u));
    await no(members(d, "orgA"));
  }
  // a member cannot reactivate themself
  await no(updateDoc(doc(as("sm"), "organizationMembers", "orgA_sm"), statusChange("sm", "active")));
});

test("archived organization: ordinary members see only the record and their own membership; governance read stays; writes denied", async () => {
  const m = as("mC"), oa = as("oaC"), pa = as("pa");
  await ok(getDoc(doc(m, "organizations", "orgC")));
  await ok(getDoc(doc(m, "organizationMembers", "orgC_mC")));
  await no(members(m, "orgC"));
  await no(probe(m, "contrib", "c")); await no(probe(m, "cap", "c")); await no(probe(m, "write", "c"));
  await ok(members(oa, "orgC")); await ok(caps(oa, "orgC")); await ok(probe(oa, "gov", "c"));
  await no(probe(oa, "write", "c")); await no(probe(oa, "cap", "c")); await no(probe(oa, "contrib", "c"));
  await no(updateDoc(doc(oa, "organizationMembers", "orgC_mC"), statusChange("oaC", "suspended")));
  await no(setDoc(doc(oa, "userCapabilities", "orgC_mC"), newCapPayload("orgC", "mC", "oaC", ["library.review"])));
  await no(setDoc(doc(pa, "organizationMembers", "orgC_out"), newMemberPayload("orgC", "out", "pa")));   // no NEW institutional activity, even for the Platform Admin
  await ok(probe(pa, "write", "c")); await ok(probe(pa, "cap", "c"));                                       // Platform Admin governs/recovers
  await ok(updateDoc(doc(pa, "organizations", "orgC"), { status: "active", archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), name: "Don vi C" }));
  await ok(setDoc(doc(pa, "organizationMembers", "orgC_out"), newMemberPayload("orgC", "out", "pa")));       // allowed after restore
  await ok(updateDoc(doc(pa, "organizations", "orgC"), { status: "archived", archivedAt: serverTimestamp(), archivedBy: "pa", updatedAt: serverTimestamp(), name: "Don vi C" }));
});

test("multiple memberships: acts only inside each organization; no cross-effect; own list returns all", async () => {
  const d = as("multi");
  await ok(getDoc(doc(d, "organizations", "orgA"))); await ok(getDoc(doc(d, "organizations", "orgB")));
  await no(getDoc(doc(d, "organizations", "orgC")));
  const snap = await myMemberships(d, "multi");
  assert.deepEqual(snap.docs.map((x) => x.id).sort(), ["orgA_multi", "orgB_multi"]);
  await no(members(d, "orgA")); await no(members(d, "orgB"));                    // ordinary member in both: no member lists
  await ok(probe(d, "contrib", "a")); await ok(probe(d, "contrib", "b"));
  await no(probe(d, "cap", "a")); await no(probe(d, "gov", "a"));
  // admin in A gives nothing in B: promote multi to org_admin in A only
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "organizationMembers", "orgA_multi"), { orgRole: "org_admin" }); });
  await ok(members(d, "orgA")); await no(members(d, "orgB")); await ok(probe(d, "gov", "a")); await no(probe(d, "gov", "b"));
  await no(updateDoc(doc(d, "organizationMembers", "orgB_mB1"), statusChange("multi", "suspended")));
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "organizationMembers", "orgA_multi"), { orgRole: "member" }); });
});

test("capability contract: effective capabilities, implicit contribute, org_admin implies all, denied list", async () => {
  await ok(probe(as("mA1"), "cap", "a"));                  // library.review granted
  await no(probe(as("mA2"), "cap", "a"));                  // no capability
  await ok(probe(as("oaA"), "cap", "a"));                  // org_admin implies all
  await ok(probe(as("pa"), "cap", "a"));                   // Platform Admin implies all
  await ok(probe(as("mA1"), "contrib", "a"));              // implicit library.contribute
  await no(probe(as("mA2"), "contrib", "a"));              // explicitly denied
  await ok(probe(as("oaA"), "contrib", "a"));
  await no(probe(as("out"), "contrib", "a"));              // no membership
  await no(probe(as("out"), "activemember", "a"));
  await no(probe(anon(), "contrib", "a"));
  await ok(probe(as("mA1"), "activemember", "a"));
});

test("capability self-grant denial and Organization-Admin limits", async () => {
  // ordinary member cannot write capabilities for anyone (including themself)
  await no(updateDoc(doc(as("mA1"), "userCapabilities", "orgA_mA1"), capUpdate("mA1", ["library.review", "library.publish", "library.manage", "curriculum.manage"])));
  await no(setDoc(doc(as("mA2"), "userCapabilities", "orgA_mA2"), newCapPayload("orgA", "mA2", "mA2", ["library.publish"])));
  // Organization Admin cannot grant capabilities to themself (an org_admin target is not an ordinary member)
  await no(setDoc(doc(as("oaA"), "userCapabilities", "orgA_oaA"), newCapPayload("orgA", "oaA", "oaA", ["library.review"])));
  // nor to a removed-from-org / non-member target
  await no(setDoc(doc(as("oaA"), "userCapabilities", "orgA_out"), newCapPayload("orgA", "out", "oaA", ["library.review"])));
  // shape violations
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), capUpdate("oaA", ["library.contribute"])));
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), capUpdate("oaA", ["library.review", "library.review"])));
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), capUpdate("oaA", [], ["library.review"])));
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), { ...capUpdate("oaA", []), scopes: { "library.review": ["x|y"] } }));
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), { ...capUpdate("oaA", []), updatedBy: "someoneElse" }));
  await no(updateDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1"), { ...capUpdate("oaA", []), organizationId: "orgB" }));
  // Platform Admin can write for an ordinary member but still not for an org_admin
  await ok(updateDoc(doc(as("pa"), "userCapabilities", "orgA_mA1"), capUpdate("pa", ["curriculum.manage"])));
  await no(setDoc(doc(as("pa"), "userCapabilities", "orgA_oaA"), newCapPayload("orgA", "oaA", "pa", ["library.review"])));
  // and the user can read but never delete their own document
  await no(deleteDoc(doc(as("oaA"), "userCapabilities", "orgA_mA1")));
  await no(deleteDoc(doc(as("pa"), "userCapabilities", "orgA_mA1")));
});

test("Organization Admin cannot appoint, change or remove Organization Admins and cannot add members; discovers no platform users", async () => {
  const oa = as("oaA");
  await no(setDoc(doc(oa, "organizationMembers", "orgA_out"), newMemberPayload("orgA", "out", "oaA", "member")));        // D1: no Organization-Admin add
  await no(setDoc(doc(oa, "organizationMembers", "orgA_out"), newMemberPayload("orgA", "out", "oaA", "org_admin")));
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_mA1"), { orgRole: "org_admin", updatedAt: serverTimestamp() }));  // appoint
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_oaA"), statusChange("oaA", "removed")));                         // self
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "organizationMembers", "orgA_oa2"), memberDoc("orgA", "oa2", "org_admin")); });
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_oa2"), statusChange("oaA", "suspended")));                       // another admin
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_oa2"), { orgRole: "member", updatedAt: serverTimestamp() }));      // demote
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_rm"), statusChange("oaA", "active")));                           // removed -> active is Platform Admin only
  await ok(updateDoc(doc(oa, "organizationMembers", "orgA_sm"), statusChange("oaA", "active")));                           // suspended -> active (restore) is allowed
  await ok(updateDoc(doc(oa, "organizationMembers", "orgA_sm"), statusChange("oaA", "suspended")));
  await ok(updateDoc(doc(oa, "organizationMembers", "orgA_mA2"), statusChange("oaA", "removed")));
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_mA2"), statusChange("oaA", "active")));                           // removed stays removed for Organization Admin
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_mA1"), { ...statusChange("oaA", "suspended"), displayName: "forged" }));
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_mA1"), { ...statusChange("oaA", "suspended"), statusChangedBy: "pa" }));
  await no(updateDoc(doc(oa, "organizationMembers", "orgA_mA1"), { status: "suspended", updatedAt: serverTimestamp() }));  // missing audit metadata
  // platform user discovery: the Organization Admin has no access to users beyond their own document
  await no(getDocs(collection(oa, "users")));
  await no(getDocs(query(collection(oa, "users"), where("role", "==", "teacher"))));
  await no(getDoc(doc(oa, "users", "mA1")));
  await ok(getDoc(doc(oa, "users", "oaA")));
  // Platform Admin can do all of the above
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_mA1"), { orgRole: "org_admin", updatedAt: serverTimestamp() }));
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_mA1"), { orgRole: "member", updatedAt: serverTimestamp() }));
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_rm"), statusChange("pa", "active")));
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_rm"), statusChange("pa", "removed")));
  await ok(setDoc(doc(as("pa"), "organizationMembers", "orgA_out"), newMemberPayload("orgA", "out", "pa", "member")));
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_out"), statusChange("pa", "removed")));
});

test("organizations: only Platform Admin creates/lists/renames/archives; shape and immutability enforced; never deleted", async () => {
  const pa = as("pa");
  await ok(setDoc(doc(pa, "organizations", "orgNew"), newOrgPayload("pa", "Don vi moi", "don-vi-moi")));
  await ok(getDocs(query(collection(pa, "organizations"), orderBy("createdAt", "desc"), limit(100))));
  await ok(updateDoc(doc(pa, "organizations", "orgNew"), { name: "Ten moi", updatedAt: serverTimestamp() }));
  await ok(updateDoc(doc(pa, "organizations", "orgNew"), { status: "archived", archivedAt: serverTimestamp(), archivedBy: "pa", updatedAt: serverTimestamp() }));
  await ok(updateDoc(doc(pa, "organizations", "orgNew"), { status: "active", archivedAt: null, archivedBy: null, updatedAt: serverTimestamp() }));
  await no(updateDoc(doc(pa, "organizations", "orgNew"), { code: "doi-ma", updatedAt: serverTimestamp() }));            // code immutable
  await no(updateDoc(doc(pa, "organizations", "orgNew"), { createdBy: "x", updatedAt: serverTimestamp() }));
  await no(updateDoc(doc(pa, "organizations", "orgNew"), { status: "suspended", updatedAt: serverTimestamp() }));         // suspended not accepted
  await no(updateDoc(doc(pa, "organizations", "orgNew"), { status: "archived", updatedAt: serverTimestamp() }));          // archive needs metadata
  await no(updateDoc(doc(pa, "organizations", "orgNew"), { name: "ab", updatedAt: serverTimestamp() }));
  await no(setDoc(doc(pa, "organizations", "bad1"), newOrgPayload("pa", "Don vi", "BAD CODE")));
  await no(setDoc(doc(pa, "organizations", "bad2"), { ...newOrgPayload("pa"), extra: 1 }));
  await no(setDoc(doc(pa, "organizations", "bad3"), { ...newOrgPayload("pa"), status: "archived" }));
  await no(setDoc(doc(pa, "organizations", "bad4"), { ...newOrgPayload("pa"), createdBy: "someone" }));
  await no(setDoc(doc(pa, "organizations", "bad5"), { ...newOrgPayload("pa"), schemaVersion: 2 }));
  await no(setDoc(doc(pa, "organizations", "bad6"), { ...newOrgPayload("pa"), createdAt: new Date() }));
  await no(deleteDoc(doc(pa, "organizations", "orgNew")));
  for (const u of ["oaA", "mA1", "out", "susp"]) {
    await no(setDoc(doc(as(u), "organizations", "orgX" + u), newOrgPayload(u)));
    await no(updateDoc(doc(as(u), "organizations", "orgA"), { name: "Doi ten", updatedAt: serverTimestamp() }));
    await no(getDocs(collection(as(u), "organizations")));
  }
  await no(getDoc(doc(as("out"), "organizations", "orgA")));
  await no(getDoc(doc(anon(), "organizations", "orgA")));
});

test("organizationMembers: shape, deterministic id, immutability, no delete, Platform-Admin-only creation", async () => {
  const pa = as("pa");
  await no(setDoc(doc(pa, "organizationMembers", "orgA_wrongid"), newMemberPayload("orgA", "out", "pa")));               // id disagrees with fields
  await no(setDoc(doc(pa, "organizationMembers", "orgA_n1"), { ...newMemberPayload("orgA", "n1", "pa"), extra: true }));
  await no(setDoc(doc(pa, "organizationMembers", "orgA_n2"), { ...newMemberPayload("orgA", "n2", "pa"), status: "suspended" }));
  await no(setDoc(doc(pa, "organizationMembers", "orgA_n3"), { ...newMemberPayload("orgA", "n3", "pa"), addedBy: "other" }));
  await no(setDoc(doc(pa, "organizationMembers", "orgA_n4"), { ...newMemberPayload("orgA", "n4", "pa"), orgRole: "owner" }));
  await no(setDoc(doc(pa, "organizationMembers", "orgNope_out"), newMemberPayload("orgNope", "out", "pa")));              // organization must exist
  await ok(setDoc(doc(pa, "organizationMembers", "orgA_out2"), newMemberPayload("orgA", "out2", "pa")));
  await no(updateDoc(doc(pa, "organizationMembers", "orgA_out2"), { uid: "other", updatedAt: serverTimestamp() }));
  await no(updateDoc(doc(pa, "organizationMembers", "orgA_out2"), { organizationId: "orgB", updatedAt: serverTimestamp() }));
  await no(updateDoc(doc(pa, "organizationMembers", "orgA_out2"), { addedBy: "x", updatedAt: serverTimestamp() }));
  await no(deleteDoc(doc(pa, "organizationMembers", "orgA_out2")));
  await no(deleteDoc(doc(as("oaA"), "organizationMembers", "orgA_mA1")));
  for (const u of ["mA1", "out", "susp", "multi"]) {
    await no(setDoc(doc(as(u), "organizationMembers", "orgA_" + u + "_self"), newMemberPayload("orgA", u + "_self", u)));
    await no(setDoc(doc(as(u), "organizationMembers", "orgB_" + u), newMemberPayload("orgB", u, u)));                      // cannot self-join
  }
  await no(setDoc(doc(anon(), "organizationMembers", "orgA_anon"), newMemberPayload("orgA", "anon", "anon")));
  await ok(updateDoc(doc(pa, "organizationMembers", "orgA_out2"), { displayName: "Ten hien thi moi", updatedAt: serverTimestamp() }));   // display snapshot refresh
});

test("query discipline: no unfiltered or multi-organization member/capability queries for non-platform principals", async () => {
  const oa = as("oaA"), m = as("mA1");
  await no(getDocs(collection(oa, "organizationMembers")));
  await no(getDocs(collection(oa, "userCapabilities")));
  await no(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "in", ["orgA", "orgB"]))));
  await no(getDocs(query(collection(oa, "userCapabilities"), where("organizationId", "in", ["orgA", "orgB"]))));
  await no(getDocs(query(collection(oa, "organizationMembers"), where("status", "==", "active"))));
  await no(getDocs(query(collection(m, "organizationMembers"), where("organizationId", "==", "orgA"))));
  await no(getDocs(query(collection(m, "organizationMembers"), where("uid", "==", "oaA"))));                      // someone else's memberships
  await ok(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "==", "orgA"))));
  await ok(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "==", "orgA"), where("status", "==", "active"))));
  await ok(getDocs(query(collection(m, "organizationMembers"), where("uid", "==", "mA1"))));
});

test("anonymous and unrelated principals: everything denied; default deny still covers unknown collections", async () => {
  const an = anon(), out = as("out");
  for (const p of ["organizations/orgA", "organizationMembers/orgA_mA1", "userCapabilities/orgA_mA1"]) { await no(getDoc(doc(an, p))); await no(getDoc(doc(out, p))); }
  await no(getDocs(collection(an, "organizations")));
  await no(getDoc(doc(as("pa"), "organizationInvites", "x")));                 // not defined in P2 -> default deny
  await no(setDoc(doc(as("pa"), "organizationInvites", "x"), { a: 1 }));
  await no(getDoc(doc(as("pa"), "libraryResources", "x")));                      // later phases are NOT enabled
  await no(setDoc(doc(as("pa"), "curriculumFrameworks", "x"), { a: 1 }));
  await no(setDoc(doc(as("pa"), "importBatches", "x"), { a: 1 }));
});

test("existing self-grant finding is unchanged: teachers can still add arbitrary fields to their own users document (why capabilities live elsewhere)", async () => {
  // documents finding F1; the users rule is NOT modified by P2-S1
  await ok(updateDoc(doc(as("out"), "users", "out"), { capabilities: ["library.publish"] }));
  // ... and it grants nothing: no organization rule reads users.capabilities
  await no(probe(as("out"), "cap", "a"));
  await no(updateDoc(doc(as("out"), "users", "out"), { role: "admin" }));
  await no(updateDoc(doc(as("out"), "users", "out"), { status: "active", approvedBy: "x" }));
});
