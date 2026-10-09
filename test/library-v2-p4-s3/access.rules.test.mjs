// LIBRARY V2 P4-S3 final correction A - PARITY of the Import Center authorization with the deployed Rules, on the emulator with the PRODUCTION Rules artifact
// (ruleset 0b6910c3, SHA-256 7F7C790E...0485). For every principal x organization of the standard P3 world the test performs, with that principal's own Firestore client:
//   1. the EXACT reads the Import Center makes (real createOrganizationQueries: organization, own membership, own capability) -> resolveImportAccess
//   2. the ground truth: may this principal LIST the organization's curriculum frameworks (mayReadCurriculum)  and  CREATE a draft framework (mayWriteCurriculum)
// and asserts   allowed === may-read   and   canPrepare === may-write.   No Rules change; synthetic data only.
// Run: firebase emulators:exec --only firestore --project demo-p4s3-access --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s3/access.rules.test.mjs"   (Java 21)
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, WORLD, assertSucceeds, assertFails, doc, setDoc, getDoc, getDocs, collection, query, where, limit, orderBy, documentId, newFwPayload, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { createOrganizationQueries } from "../../organization-queries.mjs";
import { resolveImportAccess, loadImportAccess } from "../../import-center-view.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A", "the Rules under test are the production artifact");
const env = await makeEnv("demo-p4s3-access", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const queries = createOrganizationQueries({ collection, doc, query, where, orderBy, limit, startAfter: undefined, documentId, getDocs, getDoc });
const ORGS = ["orgA", "orgB", "orgC"];                       // A and B active, C archived
const userRow = new Map(WORLD.users.map(([id, role, status]) => [id, { role, status }]));
const mayRead = async (db, org) => { try { await assertSucceeds(getDocs(query(collection(db, "curriculumFrameworks"), where("organizationId", "==", org), limit(1)))); return true; } catch { return false; } };
let seq = 0;
const mayWrite = async (db, org, uid) => { try { await assertSucceeds(setDoc(doc(db, "curriculumFrameworks", "probe" + (++seq)), newFwPayload(org, uid))); return true; } catch { return false; } };

async function decisionFor(principal, org) {
  const row = userRow.get(principal) || { role: "none", status: "none" };
  const db = as(principal === "anonymous" ? null : principal);
  const loaded = await loadImportAccess({ db, organizationQueries: queries, actorUid: principal, organizationId: org, isPlatformAdmin: row.role === "admin" });
  if (!loaded.organization) return { allowed: false, canPrepare: false, role: null, reason: "NOT_MEMBER" };
  return resolveImportAccess({ isPlatformAdmin: row.role === "admin", accountActive: row.status === "active", actorUid: principal, organization: loaded.organization, membership: loaded.membership, capability: loaded.capability });
}

const PRINCIPALS = [...WORLD.users.map(([id]) => id), "anonymous"];

test("PARITY: for every principal x organization, 'allowed' equals the Rules' curriculum READ decision and 'canPrepare' equals the Rules' curriculum WRITE decision", async () => {
  const rows = [];
  for (const principal of PRINCIPALS) {
    for (const org of ORGS) {
      const decision = await decisionFor(principal, org);
      const db = as(principal === "anonymous" ? null : principal);
      const read = await mayRead(db, org), write = await mayWrite(db, org, principal);
      rows.push({ principal, org, role: decision.role, allowed: decision.allowed, canPrepare: decision.canPrepare, reason: decision.reason, read, write });
      assert.equal(decision.allowed, read, principal + " @ " + org + ": allowed must equal mayReadCurriculum (" + JSON.stringify(decision) + ")");
      assert.equal(decision.canPrepare, write, principal + " @ " + org + ": canPrepare must equal mayWriteCurriculum (" + JSON.stringify(decision) + ")");
    }
  }
  // the matrix must actually exercise every outcome class (otherwise the parity could be vacuous)
  const has = (pred) => rows.some(pred);
  assert.ok(has((r) => r.role === "platform_admin" && r.canPrepare), "platform admin prepares in an active organization");
  assert.ok(has((r) => r.role === "platform_admin" && r.allowed && !r.canPrepare), "platform admin opens but cannot prepare in an archived organization");
  assert.ok(has((r) => r.role === "org_admin" && r.canPrepare), "organization admin prepares");
  assert.ok(has((r) => r.role === "org_admin" && r.allowed && !r.canPrepare), "organization admin opens an archived organization read-only");
  assert.ok(has((r) => r.role === "capability_holder" && r.canPrepare), "capability holder prepares");
  assert.ok(has((r) => r.reason === "NO_CAPABILITY" && !r.read), "ordinary member without the capability is denied");
  for (const p of ["capSuspMem", "capRemoved", "tSusp", "paSusp", "ghost", "noMember", "anonymous"]) assert.ok(rows.filter((r) => r.principal === p).every((r) => !r.allowed && !r.read && !r.write), p + " is denied everywhere (suspended/removed members and inactive accounts cannot even read the organization)");
  assert.ok(has((r) => r.reason === "ORGANIZATION_ARCHIVED" && !r.read), "capability holder in an archived organization is denied");
  assert.ok(has((r) => r.reason === "NOT_MEMBER"), "outsiders are denied");
  console.log("parity rows:", rows.length, "allowed:", rows.filter((r) => r.allowed).length, "canPrepare:", rows.filter((r) => r.canPrepare).length);
});

test("PARITY (named principals): the documented matrix", async () => {
  const expect = {
    "pa|orgA": ["platform_admin", true, true], "pa|orgC": ["platform_admin", true, false],
    "oaA|orgA": ["org_admin", true, true], "oaA|orgB": [null, false, false], "oaC|orgC": ["org_admin", true, false],
    "capA|orgA": ["capability_holder", true, true], "capA|orgB": [null, false, false], "capC|orgC": [null, false, false],
    "mA|orgA": [null, false, false], "revA|orgA": [null, false, false], "noMember|orgA": [null, false, false],
    "capSuspMem|orgA": [null, false, false], "capRemoved|orgA": [null, false, false], "ghost|orgA": [null, false, false],
    "tSusp|orgA": [null, false, false], "paSusp|orgA": [null, false, false], "anonymous|orgA": [null, false, false]
  };
  for (const [key, [role, allowed, canPrepare]] of Object.entries(expect)) {
    const [principal, org] = key.split("|");
    const d = await decisionFor(principal, org);
    assert.deepEqual([d.role, d.allowed, d.canPrepare], [role, allowed, canPrepare], key);
  }
});
