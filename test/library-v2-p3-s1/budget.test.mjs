// LIBRARY V2 P3-S1 - document-access budget for the ACTUAL curriculum guard composition (Firestore emulator).
// Limits observed in P2-S1: 10 distinct documents per single request, ~20 per batched write, repeated reads of the same document cached.
// The curriculum guard must stay inside the budget for single writes AND for 400-write batches (clone / delete-draft chunks).
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, withProbes, candidateRules, memberDoc, orgDoc, capSeed, fwDoc, nodeDoc, newNodePayload, lessonPayload, nodeEdit, newFwPayload, D, NL,
  fwRef, nodeRef, nodesCol,
  assertFails, assertSucceeds, doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, writeBatch
} from "./helpers.mjs";

const X = (n) => "get(/databases/$(database)/documents/_x/x" + n + ").data.v == 1";
const heads = {
  read: "mayReadCurriculum(resource.data.organizationId)",
  write: "mayWriteCurriculum(resource.data.organizationId)",
  nodeWrite: "mayWriteCurriculum(resource.data.organizationId) && get(fwPath('fwA')).data.status in ['draft','active'] && get(fwPath('fwA')).data.organizationId == resource.data.organizationId",
  nodeDelete: "mayWriteCurriculum(resource.data.organizationId) && (!exists(fwPath('fwNone')) || (get(fwPath('fwA')).data.status == 'draft' && !('activatedAt' in get(fwPath('fwA')).data)))",
  cloneCreate: "mayWriteCurriculum(resource.data.organizationId) && get(fwPath('fwA')).data.organizationId == resource.data.organizationId"
};
const extraRules = [];
for (const [name, head] of Object.entries(heads)) {
  for (let k = 0; k <= 10; k++) {
    const extras = Array.from({ length: k }, (_, i) => " && " + X(i + 1)).join("");
    extraRules.push("    match /_hr_" + name + "_" + k + "/{id} { allow get: if " + head + extras + "; }");
  }
}
const env = await makeEnv("demo-p3s1-budget", withProbes(candidateRules(), extraRules.join(NL)));
const as = actors(env);
test.after(async () => env.cleanup());

const BULK = 400;
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
  await put("curriculumFrameworks/fwAct", fwDoc("orgA", "active"));
  for (let i = 1; i <= 10; i++) await put("_x/x" + i, { v: 1 });
  for (const name of Object.keys(heads)) for (let k = 0; k <= 10; k++) await put("_hr_" + name + "_" + k + "/a", { organizationId: "orgA" });
});
async function seedNodes(fw, prefix, count, org = "orgA") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let c = 0; c < count; c += 100) {
      const b = writeBatch(db);
      for (let i = c; i < Math.min(count, c + 100); i++) b.set(doc(db, "curriculumFrameworks", fw, "nodes", prefix + String(i).padStart(4, "0")), nodeDoc(org, { order: i, name: "Nut " + i }));
      await b.commit();
    }
  });
}
async function clearNodes(fw) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const snap = await getDocs(collection(db, "curriculumFrameworks", fw, "nodes"));
    for (let c = 0; c < snap.docs.length; c += 200) { const b = writeBatch(db); snap.docs.slice(c, c + 200).forEach((d) => b.delete(d.ref)); await b.commit(); }
  });
}
const observed = {};

test("bulk create: 400 nodes in ONE batch into a draft framework succeed for the Platform Admin, an Organization Admin and a capability holder (also into an ACTIVE framework)", async () => {
  for (const u of ["pa", "oaA", "capA"]) {
    for (const fw of ["fwA", "fwAct"]) {
      await clearNodes(fw);
      const db = as(u), b = writeBatch(db);
      for (let i = 0; i < BULK; i++) b.set(nodeRef(db, fw, "c" + String(i).padStart(4, "0")), newNodePayload("orgA", { order: i, name: "Nut " + i }));
      await assertSucceeds(b.commit());
      observed["createBatch_" + u + "_" + fw] = BULK;
    }
  }
  await clearNodes("fwA"); await clearNodes("fwAct");
});

test("bulk create: a batch that contains ONE bad node is rejected as a whole (atomic)", async () => {
  const db = as("pa"), b = writeBatch(db);
  for (let i = 0; i < 50; i++) b.set(nodeRef(db, "fwA", "a" + i), newNodePayload("orgA", { order: i }));
  b.set(nodeRef(db, "fwA", "bad"), newNodePayload("orgB"));
  await assertFails(b.commit());
  const snap = await getDocs(collection(as("pa"), "curriculumFrameworks", "fwA", "nodes"));
  assert.equal(snap.size, 0);
});

test("bulk update and delete: 400-node batches of order updates and (never-activated draft) deletes succeed; deletes in an ACTIVE framework are denied", async () => {
  await seedNodes("fwA", "u", BULK); await seedNodes("fwAct", "u", BULK);
  for (const u of ["pa", "oaA", "capA"]) {
    for (const fw of ["fwA", "fwAct"]) {
      const db = as(u), b = writeBatch(db);
      for (let i = 0; i < BULK; i++) b.update(nodeRef(db, fw, "u" + String(i).padStart(4, "0")), nodeEdit({ order: BULK - i }));
      await assertSucceeds(b.commit());
    }
  }
  const dbm = as("capA"), bm = writeBatch(dbm);
  for (let i = 0; i < BULK; i++) bm.delete(nodeRef(dbm, "fwAct", "u" + String(i).padStart(4, "0")));
  await assertFails(bm.commit());
  for (const u of ["pa", "oaA", "capA"]) {
    await clearNodes("fwA"); await seedNodes("fwA", "u", BULK);
    const db = as(u), b = writeBatch(db);
    for (let i = 0; i < BULK; i++) b.delete(nodeRef(db, "fwA", "u" + String(i).padStart(4, "0")));
    await assertSucceeds(b.commit());
    observed["deleteBatch_" + u] = BULK;
  }
  await clearNodes("fwA"); await clearNodes("fwAct");
});

test("full-tree load: 5001-limit organization-filtered node query works for governance principals with the full 5000-node bound", async () => {
  await seedNodes("fwA", "t", 1200);
  const q = (db) => getDocs(query(nodesCol(db, "fwA"), where("organizationId", "==", "orgA"), limit(5001)));
  for (const u of ["pa", "oaA", "capA"]) { const s = await assertSucceeds(q(as(u))); assert.equal(s.size, 1200, u); }
  await assertFails(q(as("mA")));
  observed.fullTreeLoaded = 1200;
  await clearNodes("fwA");
});

test("headroom: distinct get/exists calls consumed by each curriculum guard composition (budget 10 per request)", async () => {
  const who = { read: ["pa", "oaA", "capA"], write: ["pa", "oaA", "capA"], nodeWrite: ["pa", "oaA", "capA"], nodeDelete: ["pa", "oaA", "capA"], cloneCreate: ["pa", "oaA", "capA"] };
  const rows = [];
  for (const [name, users] of Object.entries(who)) {
    for (const u of users) {
      let kmax = -1;
      for (let k = 0; k <= 10; k++) {
        try { await getDoc(doc(as(u), "_hr_" + name + "_" + k, "a")); kmax = k; } catch { break; }
      }
      assert.ok(kmax >= 0, name + "/" + u + ": base guard must pass");
      rows.push({ guard: name, principal: u, extraDistinctReadsAllowed: kmax, callsUsed: 10 - kmax });
    }
  }
  observed.headroom = rows;
  for (const r of rows) assert.ok(r.callsUsed <= 8, JSON.stringify(r));
});

test.after(() => { console.log("BUDGET OBSERVATIONS " + JSON.stringify(observed)); });
