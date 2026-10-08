// LIBRARY V2 P4-S1 - document-access budget of the NEW guard compositions (Firestore emulator). Firestore Rules allow a limited number of DISTINCT get()/exists() calls per request
// (observed in P2-S1/P3-S1: 10 per single request, repeated reads of the same document cached). Measured here with probe rules (test-only, appended to the candidate, NEVER part of the file):
// each probe replicates the exact guard composition of a P4-S1 rule and then adds k extra distinct get() calls; the largest k that still passes gives the headroom (calls used = 10 - k).
// Run: firebase emulators:exec --only firestore --project demo-p4s1b --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s1/budget.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, withProbes, candidateRules, memberDoc, orgDoc, capSeed, fwDoc, nodeDoc, newNodePayload, nodeEdit, D, NL,
  nodeRef, assertSucceeds, assertFails, doc, setDoc, getDoc, deleteDoc, writeBatch
} from "../library-v2-p3-s1/helpers.mjs";

const X = (n) => "get(/databases/$(database)/documents/_x/x" + n + ").data.v == 1";
const FINAL = "f".repeat(32);
const FW = (id) => "fwPath('" + id + "')";
const NODE = (fw) => "/databases/$(database)/documents/curriculumFrameworks/" + fw + "/nodes/" + FINAL;
const W = "mayWriteCurriculum(resource.data.organizationId)";
const heads = {
  batchCreate: W + " && !exists(" + FW("fwNew") + ")",
  activationManual: W + " && importAllowsActivation('fwA', resource.data.organizationId)",
  activationImported: W + " && importAllowsActivation('fwImp', resource.data.organizationId)",
  completion: W + " && get(" + FW("fwImp") + ").data.organizationId == resource.data.organizationId && get(" + FW("fwImp") + ").data.status == 'draft' && !('activatedAt' in get(" + FW("fwImp") + ").data) && get(" + NODE("fwImp") + ").data.organizationId == resource.data.organizationId",
  rollback: W + " && !exists(" + FW("fwGone") + ") && !exists(" + NODE("fwGone") + ")",
  cloneFromImport: W + " && get(" + FW("fwImp") + ").data.organizationId == resource.data.organizationId && importAllowsActivation('fwImp', resource.data.organizationId)",
  batchRead: "mayReadCurriculum(resource.data.organizationId)"
};
const extraRules = [];
for (const [name, head] of Object.entries(heads)) for (let k = 0; k <= 10; k++) {
  const extras = Array.from({ length: k }, (_, i) => " && " + X(i + 1)).join("");
  extraRules.push("    match /_p4_" + name + "_" + k + "/{id} { allow get: if " + head + extras + "; }");
}
const env = await makeEnv("demo-p4s1-budget", withProbes(candidateRules(), extraRules.join(NL)));
const as = actors(env);
test.after(async () => env.cleanup());
const BULK = 400;
const observed = {};
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const put = (p, d) => setDoc(doc(db, p), d);
  const user = (id, role = "teacher", status = "active") => put("users/" + id, { uid: id, role, status, approvedBy: null, approvedAt: null, createdAt: D(1) });
  await user("pa", "admin"); await user("oaA", "teacher"); await user("capA"); await user("mA");
  await put("organizations/orgA", orgDoc("Don vi A", "don-vi-a"));
  await put("organizationMembers/orgA_oaA", memberDoc("orgA", "oaA", "org_admin"));
  await put("organizationMembers/orgA_capA", memberDoc("orgA", "capA")); await put("userCapabilities/orgA_capA", capSeed("orgA", "capA", ["curriculum.manage"]));
  await put("organizationMembers/orgA_mA", memberDoc("orgA", "mA"));
  await put("curriculumFrameworks/fwA", fwDoc("orgA", "draft"));
  await put("curriculumFrameworks/fwImp", fwDoc("orgA", "draft"));
  await put("curriculumFrameworks/fwImp/nodes/" + FINAL, nodeDoc("orgA"));
  await put("importBatches/fwImp", { schemaVersion: 1, kind: "curriculum", organizationId: "orgA", status: "completed" });   // probe-level seed (shape irrelevant for the budget)
  for (let i = 1; i <= 10; i++) await put("_x/x" + i, { v: 1 });
  for (const name of Object.keys(heads)) for (let k = 0; k <= 10; k++) await put("_p4_" + name + "_" + k + "/a", { organizationId: "orgA" });
});

test("headroom: distinct get/exists calls consumed by each P4-S1 guard composition for the Platform Admin, an Organization Admin and a capability holder (budget 10 per request)", async () => {
  const rows = [];
  for (const name of Object.keys(heads)) {
    for (const u of ["pa", "oaA", "capA"]) {
      let kmax = -1;
      for (let k = 0; k <= 10; k++) { try { await getDoc(doc(as(u), "_p4_" + name + "_" + k, "a")); kmax = k; } catch { break; } }
      assert.ok(kmax >= 0, name + "/" + u + ": the base composition must pass");
      rows.push({ guard: name, principal: u, extraDistinctReadsAllowed: kmax, callsUsed: 10 - kmax });
    }
  }
  observed.headroom = rows;
  for (const r of rows) assert.ok(r.callsUsed <= 8, "margin of at least 2 calls: " + JSON.stringify(r));
  // the base P3 guard alone (for comparison): activation of a MANUAL framework costs exactly one more call than the P3 write guard
  const manual = rows.filter((r) => r.guard === "activationManual"), batch = rows.filter((r) => r.guard === "batchCreate");
  assert.ok(manual.every((r) => r.callsUsed >= 1) && batch.every((r) => r.callsUsed >= 1));
});

test("bulk node writes into an IMPORT-GOVERNED draft framework stay inside the budget: a 400-node create batch, a 400-update batch and a 400-delete batch succeed for the three writers (the node rules do not read the batch)", async () => {
  const seedNodes = async (count) => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let c = 0; c < count; c += 100) { const b = writeBatch(db); for (let i = c; i < Math.min(count, c + 100); i++) b.set(doc(db, "curriculumFrameworks", "fwImp", "nodes", "u" + String(i).padStart(4, "0")), nodeDoc("orgA", { order: i, name: "Nut " + i })); await b.commit(); }
  });
  for (const u of ["pa", "oaA", "capA"]) {
    const db = as(u), b = writeBatch(db);
    for (let i = 0; i < BULK; i++) b.set(nodeRef(db, "fwImp", "c" + u + String(i).padStart(4, "0")), newNodePayload("orgA", { order: i, name: "Nut " + i }));
    await assertSucceeds(b.commit());
    observed["importCreate_" + u] = BULK;
  }
  await seedNodes(BULK);
  for (const u of ["pa", "oaA", "capA"]) {
    const db = as(u), b = writeBatch(db);
    for (let i = 0; i < BULK; i++) b.update(nodeRef(db, "fwImp", "u" + String(i).padStart(4, "0")), nodeEdit({ order: BULK - i }));
    await assertSucceeds(b.commit());
  }
  const db = as("pa"), b = writeBatch(db);
  for (let i = 0; i < BULK; i++) b.delete(nodeRef(db, "fwImp", "u" + String(i).padStart(4, "0")));
  await assertSucceeds(b.commit());
  observed.importDelete = BULK;
});

test.after(() => { console.log("P4-S1 BUDGET OBSERVATIONS " + JSON.stringify(observed)); });
