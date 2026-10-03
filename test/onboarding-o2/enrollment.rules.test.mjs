// Onboarding O2 - EMULATOR compatibility proof against the EXACT deployed Firestore Rules (firestore.rules.production-candidate,
// SHA-256 7EA5D7A5..., production ruleset 7e4333e7-a927-47aa-b20d-74c58f778e7b). Synthetic data only.
// Run: firebase emulators:exec --only firestore --project demo-o2 --config test/library-v2-p2-s1/firebase.json "node --test test/onboarding-o2/enrollment.rules.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, seedWorld, candidateRules, sha, D,
  assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, limit, writeBatch, serverTimestamp
} from "../library-v2-p2-s1/helpers.mjs";
import { addDoc } from "firebase/firestore";
import { createOrganizationWriteContract } from "../../organization-write-contract.mjs";
import { createOrganizationQueries } from "../../organization-queries.mjs";
import { createMembershipWriter } from "../../organization-membership-view.mjs";
import { createActiveOrganizationLookup, enrollTeacherInOrganizations } from "../../teacher-organization-enrollment.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "7EA5D7A5EBAC9DF18E995C9A1644B2648E4143FA4FE3046C0DE7F8737FCC1DDD", "proven against the deployed Rules artifact");
const env = await makeEnv("demo-o2-enrollment", rules);
await seedWorld(env);
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (let i = 0; i < 22; i++) await setDoc(doc(db, "organizations", "bulk" + String(i).padStart(2, "0")), { schemaVersion: 1, name: "Don vi " + String(i).padStart(2, "0"), code: "dv-" + String(i).padStart(2, "0"), status: "active", createdAt: D(1), createdBy: "pa", updatedAt: D(1) });
  await setDoc(doc(db, "users", "newbie"), { uid: "newbie", role: "teacher", status: "pending", displayName: "GV Moi", email: "moi@example.test", approvedBy: null, approvedAt: null, createdAt: D(3) });
});
const as = actors(env);
const C = createOrganizationWriteContract({ serverTimestamp });
const Q = createOrganizationQueries({ collection, doc, query, where, orderBy: () => { throw new Error("unused"); }, limit, startAfter: () => {}, documentId: () => {}, getDocs, getDoc });
const W = createMembershipWriter({ collection, doc, writeBatch, updateDoc });
const lookup = createActiveOrganizationLookup({ collection, query, where, limit, getDocs });
test.after(async () => env.cleanup());
const ok = (p, m) => assertSucceeds(p, m), no = (p, m) => assertFails(p, m);
const depsFor = (actor, audit = []) => ({
  readUser: async (db, uid) => { const s = await getDoc(doc(db, "users", uid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
  queries: Q, contract: C, writer: W,
  logAudit: async (action, entityType, entityId, detail) => { audit.push([action, entityType, entityId, detail]); await addDoc(collection(as(actor), "auditLogs"), { actorId: actor, actorRole: "admin", action, entityType, entityId, detail, createdAt: serverTimestamp() }); }
});

test("the active-Organization query shape is permitted for the Platform Admin and denied for everyone else; archived Organizations are excluded; 21 is a detector, not a limit", async () => {
  const result = await lookup.listActiveOrganizations(as("pa"));
  assert.equal(result.organizations.length, 20); assert.equal(result.truncated, true, "24 active Organizations exist: the UI can tell there are more than 20");
  assert.ok(!result.organizations.some((o) => o.id === "orgC"), "archived orgC is excluded");
  const raw = await getDocs(query(collection(as("pa"), "organizations"), where("status", "==", "active"), limit(100)));
  assert.equal(raw.docs.length, 24); assert.ok(raw.docs.every((d) => d.data().status === "active"));
  for (const actor of ["mA1", "oaA", "out", "susp", "spa"]) await no(getDocs(query(collection(as(actor), "organizations"), where("status", "==", "active"), limit(21))), "list by " + actor);
});

test("V1 approval write is accepted for the Platform Admin and denied for a teacher (the Rules are unchanged); the approval itself touches only status/approvedAt/approvedBy/updatedAt", async () => {
  await no(updateDoc(doc(as("out"), "users", "newbie"), { status: "active", approvedAt: serverTimestamp(), approvedBy: "out", updatedAt: serverTimestamp() }), "teacher cannot approve");
  await ok(updateDoc(doc(as("pa"), "users", "newbie"), { status: "active", approvedAt: serverTimestamp(), approvedBy: "pa", updatedAt: serverTimestamp() }));
  const u = (await getDoc(doc(as("pa"), "users", "newbie"))).data();
  assert.deepEqual([u.role, u.status, u.approvedBy], ["teacher", "active", "pa"]);
});

test("continuation after approval: ordinary active member created through the S4 contract; users document untouched; audit accepted with the additive `via` detail", async () => {
  const before = (await getDoc(doc(as("pa"), "users", "newbie"))).data();
  const audit = [];
  const out = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid: "newbie", organizationIds: ["orgB"], deps: depsFor("pa", audit) });
  assert.deepEqual(out.results.map((r) => r.outcome), ["created"]);
  const m = (await getDoc(doc(as("pa"), "organizationMembers", "orgB_newbie"))).data();
  assert.deepEqual([m.orgRole, m.status, m.addedBy, m.organizationId, m.uid, m.displayName, m.email], ["member", "active", "pa", "orgB", "newbie", "GV Moi", "moi@example.test"]);
  assert.deepEqual((await getDoc(doc(as("pa"), "users", "newbie"))).data(), before, "no write to users");
  const logs = await getDocs(query(collection(as("pa"), "auditLogs"), where("entityId", "==", "orgB")));
  const entry = logs.docs.map((d) => d.data()).find((d) => d.action === "organization.members.add" && d.detail.uids && d.detail.uids[0] === "newbie");
  assert.ok(entry, "audit entry accepted by the deployed Rules");
  assert.deepEqual(entry.detail, { count: 1, uids: ["newbie"], skipped: 0, via: "teacher-approval" });
  const first = (await getDocs(query(collection(as("pa"), "organizationMembers"), where("organizationId", "==", "orgB")))).docs.length;
  assert.ok(first >= 4);
});

test("exact re-check: active, suspended and removed memberships are never recreated (flow skips; a forced raw create is rejected by the Rules)", async () => {
  for (const [uid, status] of [["mA1", "active"], ["sm", "suspended"], ["rm", "removed"]]) {
    const audit = [];
    const out = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid, organizationIds: ["orgA"], deps: depsFor("pa", audit) });
    assert.deepEqual([out.results[0].outcome, out.results[0].membershipStatus], ["already-associated", status]);
    assert.equal(audit.length, 0);
    await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgA", uid }, "pa")]), "raw re-create of " + status);
    assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgA_" + uid))).data().status, status, "unchanged");
  }
});

test("teacher no longer active: blocked with no write (suspended / pending / admin); archived Organization: skipped by the flow and rejected by the Rules if forced", async () => {
  for (const uid of ["susp", "pend", "pa"]) {
    const audit = [];
    const out = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid, organizationIds: ["orgA"], deps: depsFor("pa", audit) });
    assert.equal(out.blocked, "not-active-teacher");
    assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgA_" + uid))).exists(), uid === "susp", uid + " (susp already had a seeded membership, nothing new written)");
    assert.equal(audit.length, 0);
  }
  const out = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid: "out", organizationIds: ["orgC"], deps: depsFor("pa") });
  assert.equal(out.results[0].outcome, "organization-archived");
  await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgC", uid: "out" }, "pa")]), "forced create in an archived Organization");
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgC_out"))).exists(), false);
});

test("multi-Organization: separate writes; one failure never undoes another; retry creates only what is missing and never duplicates", async () => {
  const flaky = new Set(["bulk01"]);
  const writer = { createMany: async (db, items) => { if (flaky.has(items[0].data.organizationId)) throw new Error("simulated write failure"); return W.createMany(db, items); } };
  const deps = { ...depsFor("pa"), writer };
  const first = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid: "mA2", organizationIds: ["bulk00", "bulk01", "orgC", "bulk02"], deps });
  assert.deepEqual(first.results.map((r) => r.outcome), ["created", "failed", "organization-archived", "created"]);
  for (const id of ["bulk00", "bulk02"]) assert.equal((await getDoc(doc(as("pa"), "organizationMembers", id + "_mA2"))).exists(), true);
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "bulk01_mA2"))).exists(), false);
  flaky.clear();
  const retry = await enrollTeacherInOrganizations({ db: as("pa"), actorUid: "pa", uid: "mA2", organizationIds: ["bulk00", "bulk01", "bulk02"], deps });
  assert.deepEqual(retry.results.map((r) => r.outcome), ["already-associated", "created", "already-associated"]);
  const all = await getDocs(query(collection(as("pa"), "organizationMembers"), where("uid", "==", "mA2")));
  assert.equal(all.docs.filter((d) => d.id.startsWith("bulk")).length, 3, "exactly one membership per Organization");
});

test("non-Platform-Admins cannot create memberships or write the continuation's audit as someone else; no users/capability write happened", async () => {
  for (const actor of ["oaB", "mB1", "out", "susp", "spa"]) await no(W.createMany(as(actor), [C.buildNewMembership({ organizationId: "orgB", uid: "mB3" }, actor)]), "create by " + actor);
  await no(addDoc(collection(as("out"), "auditLogs"), { actorId: "pa", action: "organization.members.add", entityType: "organization", entityId: "orgB", detail: { via: "teacher-approval" }, createdAt: serverTimestamp() }), "audit with a foreign actorId");
  const caps = await getDocs(query(collection(as("pa"), "userCapabilities"), where("organizationId", "==", "bulk00")));
  assert.equal(caps.docs.length, 0);
});
