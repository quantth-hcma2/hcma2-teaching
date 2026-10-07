// O1 - EMULATOR compatibility proof against the EXACT deployed Firestore Rules (firestore.rules.production-candidate,
// SHA-256 A0B206FC... = P3-S1 candidate = the deployed ruleset 7e4333e7-a927-47aa-b20d-74c58f778e7b / 7EA5D7A5... plus the P3 region). Synthetic data only.
// Run: firebase emulators:exec --only firestore --project demo-o1 --config test/library-v2-p2-s1/firebase.json "node --test test/o1-search/search.rules.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, seedWorld, candidateRules, sha, D,
  assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy, limit, writeBatch, serverTimestamp
} from "../library-v2-p2-s1/helpers.mjs";
import { addDoc } from "firebase/firestore";
import { createOrganizationWriteContract } from "../../organization-write-contract.mjs";
import { createOrganizationQueries } from "../../organization-queries.mjs";
import { createMembershipWriter, createTeacherEmailSearchQuery, addTeacherFromSearch } from "../../organization-membership-view.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "A0B206FCDDA3843DB2E08EEEEB00A9704B5A1415B97B9E488477D8F21AA4921D", "proven against the approved P3-S1 Rules artifact");
const env = await makeEnv("demo-o1-search", rules);
await seedWorld(env);
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const u = (id, email, role = "teacher", status = "active") => setDoc(doc(db, "users", id), { uid: id, role, status, displayName: "GV " + id, email, approvedBy: null, approvedAt: null, createdAt: D(3) });
  for (let i = 1; i <= 25; i++) await u("bulk" + i, `bulk${String(i).padStart(2, "0")}@example.test`);
  for (let i = 1; i <= 20; i++) await u("exact" + i, `exact${String(i).padStart(2, "0")}@example.test`);
  await u("fresh1", "fresh01@example.test"); await u("fresh2", "fresh02@example.test"); await u("fresh3", "fresh03@example.test");
});
const as = actors(env);
const C = createOrganizationWriteContract({ serverTimestamp });
const Q = createOrganizationQueries({ collection, doc, query, where, orderBy, limit, startAfter: () => {}, documentId: () => {}, getDocs, getDoc });
const W = createMembershipWriter({ collection, doc, writeBatch, updateDoc });
const S = createTeacherEmailSearchQuery({ collection, query, where, orderBy, limit, getDocs });
test.after(async () => env.cleanup());
const ok = (p, m) => assertSucceeds(p, m), no = (p, m) => assertFails(p, m);
const depsFor = (actor, audit = []) => ({
  readUser: async (db, uid) => { const s = await getDoc(doc(db, "users", uid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
  queries: Q, contract: C, writer: W,
  logAudit: async (action, entityType, entityId, detail) => { audit.push([action, entityType, entityId, detail]); await addDoc(collection(as(actor), "auditLogs"), { actorId: actor, actorRole: "admin", action, entityType, entityId, detail, createdAt: serverTimestamp() }); }
});

test("the email-range search query is allowed for the Platform Admin and denied for teacher / Organization Admin / outsider / suspended account", async () => {
  const found = await S.searchByEmailPrefix(as("pa"), "fresh0");
  assert.deepEqual(found.users.map((x) => x.id).sort(), ["fresh1", "fresh2", "fresh3"]);
  assert.equal(found.more, false);
  for (const actor of ["mA1", "oaA", "out", "susp", "spa"]) await no(S.searchByEmailPrefix(as(actor), "fresh0"), "search by " + actor);
});

test("bounded results: 25 matches -> 20 shown + 'more'; exactly 20 -> no 'more'; a term shorter than 3 characters never queries; trimmed / uppercase input is normalized", async () => {
  const many = await S.searchByEmailPrefix(as("pa"), "bulk");
  assert.deepEqual([many.users.length, many.more], [20, true]);
  assert.deepEqual(many.users.map((x) => x.email), [...many.users.map((x) => x.email)].sort(), "ordered by email");
  const exact = await S.searchByEmailPrefix(as("pa"), "exact");
  assert.deepEqual([exact.users.length, exact.more], [20, false]);
  const narrowed = await S.searchByEmailPrefix(as("pa"), "bulk2");
  assert.deepEqual([narrowed.users.length, narrowed.more], [6, false]);
  await assert.rejects(() => S.searchByEmailPrefix(as("pa"), "bu"), RangeError);
  const normalized = await S.searchByEmailPrefix(as("pa"), "  FRESH01@EXAMPLE.TEST ");
  assert.deepEqual(normalized.users.map((x) => x.id), ["fresh1"]);
});

test("adding one found teacher: ordinary active member via the S4 contract; users untouched; audit with `via: exception-search` accepted by the deployed Rules", async () => {
  const before = (await getDoc(doc(as("pa"), "users", "fresh1"))).data();
  const audit = [];
  const out = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgB", status: "active" }, uid: "fresh1", deps: depsFor("pa", audit) });
  assert.equal(out.outcome, "created");
  const m = (await getDoc(doc(as("pa"), "organizationMembers", "orgB_fresh1"))).data();
  assert.deepEqual([m.orgRole, m.status, m.addedBy, m.organizationId, m.uid, m.email], ["member", "active", "pa", "orgB", "fresh1", "fresh01@example.test"]);
  assert.deepEqual((await getDoc(doc(as("pa"), "users", "fresh1"))).data(), before, "no write to users");
  assert.deepEqual(audit[0][3], { count: 1, uids: ["fresh1"], skipped: 0, via: "exception-search" });
  const logs = await getDocs(query(collection(as("pa"), "auditLogs"), where("entityId", "==", "orgB")));
  assert.ok(logs.docs.some((d) => d.data().detail && d.data().detail.via === "exception-search"), "the audit entry with via is stored");
});

test("never recreates an existing membership (active, suspended, removed, org_admin): the flow skips and a forced raw create is rejected by the Rules", async () => {
  for (const [uid, status] of [["mA1", "active"], ["sm", "suspended"], ["rm", "removed"], ["oaA", "active"]]) {
    const out = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgA", status: "active" }, uid, deps: depsFor("pa") });
    assert.equal(out.outcome, "already-associated");
    assert.equal(out.membership.status, status);
    await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgA", uid }, "pa")]), "raw re-create of " + uid);
  }
});

test("teacher no longer active / Organization archived: no write; forced create in an archived Organization is rejected; duplicate impossible after a successful add", async () => {
  for (const uid of ["susp", "pend", "pa"]) {
    const out = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgA", status: "active" }, uid, deps: depsFor("pa") });
    assert.equal(out.outcome, "not-active-teacher");
  }
  const archived = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgC", status: "active" }, uid: "fresh2", deps: depsFor("pa") });
  assert.equal(archived.outcome, "organization-archived");
  await no(W.createMany(as("pa"), [C.buildNewMembership({ organizationId: "orgC", uid: "fresh2" }, "pa")]), "forced create in an archived Organization");
  assert.equal((await getDoc(doc(as("pa"), "organizationMembers", "orgC_fresh2"))).exists(), false);
  const a = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgB", status: "active" }, uid: "fresh3", deps: depsFor("pa") });
  const b = await addTeacherFromSearch({ db: as("pa"), actorUid: "pa", organization: { id: "orgB", status: "active" }, uid: "fresh3", deps: depsFor("pa") });
  assert.deepEqual([a.outcome, b.outcome], ["created", "already-associated"]);
});

test("non-admins cannot create memberships through this path; no capability, no org_admin created", async () => {
  for (const actor of ["oaB", "mB1", "out", "susp", "spa"]) await no(W.createMany(as(actor), [C.buildNewMembership({ organizationId: "orgB", uid: "bulk1" }, actor)]), "create by " + actor);
  const caps = await getDocs(query(collection(as("pa"), "userCapabilities"), where("organizationId", "==", "orgB")));
  assert.deepEqual(caps.docs.map((d) => d.id), ["orgB_mB1"], "only the pre-seeded capability document exists; nothing was created");
});
