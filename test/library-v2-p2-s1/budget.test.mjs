// LIBRARY V2 P2-S1 - document-access budget observations for the ACTUAL helper composition (Firestore emulator).
// Firestore limits measured on 2026-10-02: 10 distinct documents per single request, ~20 per batched write; reads of the SAME
// document are cached; a list query whose rules need a distinct read per RESULT is denied.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeEnv, actors, withProbes, candidateRules, memberDoc, orgDoc, capSeed, newMemberPayload, statusChange, newCapPayload, capUpdate, D, NL,
  assertFails, assertSucceeds, doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, writeBatch
} from "./helpers.mjs";

// Headroom probes: base helper + k extra DISTINCT document reads. The largest k that still passes tells how many of the
// 10 allowed distinct documents the helper composition itself consumes (used = 10 - kmax).
const X = (n) => "get(/databases/$(database)/documents/_x/x" + n + ").data.v == 1";
const heads = {
  cap: "hasOrgCap(resource.data.organizationId, 'library.review')",
  contrib: "canContribute(resource.data.organizationId)",
  activemember: "isActiveOrgMember(resource.data.organizationId)",
  admin: "isOrgAdmin(resource.data.organizationId)",
  governs: "orgGoverns(resource.data.organizationId)",
  mayWrite: "mayWriteOrg(resource.data.organizationId)"
};
const extraRules = [];
for (const [name, head] of Object.entries(heads)) {
  for (let k = 0; k <= 10; k++) {
    const extras = Array.from({ length: k }, (_, i) => " && " + X(i + 1)).join("");
    extraRules.push("    match /_hr_" + name + "_" + k + "/{id} { allow get: if " + head + extras + "; }");
  }
}
const env = await makeEnv("demo-p2s1-budget", withProbes(candidateRules(), extraRules.join(NL)));
const as = actors(env);
test.after(async () => env.cleanup());

const BULK = 400;
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const put = (p, d) => setDoc(doc(db, p), d);
  const user = (id, role = "teacher", status = "active") => put("users/" + id, { uid: id, role, status, approvedBy: null, approvedAt: null, createdAt: D(1) });
  await user("pa", "admin"); await user("oaA", "teacher"); await user("mA1"); await user("mCap");
  await put("organizations/orgA", orgDoc("Don vi A", "don-vi-a"));
  await put("organizations/orgBulk", orgDoc("Don vi bulk", "don-vi-bulk"));
  await put("organizationMembers/orgA_oaA", memberDoc("orgA", "oaA", "org_admin"));
  await put("organizationMembers/orgA_mCap", memberDoc("orgA", "mCap"));
  await put("userCapabilities/orgA_mCap", capSeed("orgA", "mCap", ["library.review"]));
  await put("organizationMembers/orgA_mA1", memberDoc("orgA", "mA1"));           // member without a capability document
  for (let i = 1; i <= 10; i++) await put("_x/x" + i, { v: 1 });
  for (const name of Object.keys(heads)) for (let k = 0; k <= 10; k++) await put("_hr_" + name + "_" + k + "/a", { organizationId: "orgA" });
  // 400 members for the bulk status test + 40 ordinary members for capability batches
  for (let c = 0; c < BULK; c += 100) {
    const b = writeBatch(db);
    for (let i = c; i < c + 100; i++) b.set(doc(db, "organizationMembers", "orgA_bulk" + String(i).padStart(3, "0")), memberDoc("orgA", "bulk" + String(i).padStart(3, "0")));
    await b.commit();
  }
  const b2 = writeBatch(db);
  for (let i = 0; i < 40; i++) b2.set(doc(db, "organizationMembers", "orgA_cm" + String(i).padStart(2, "0")), memberDoc("orgA", "cm" + String(i).padStart(2, "0")));
  await b2.commit();
});

const observed = {};

test("bulk: Platform Admin creates 400 memberships in ONE batch (no per-target read)", async () => {
  const db = as("pa");
  const b = writeBatch(db);
  for (let i = 0; i < BULK; i++) b.set(doc(db, "organizationMembers", "orgBulk_n" + String(i).padStart(3, "0")), newMemberPayload("orgBulk", "n" + String(i).padStart(3, "0"), "pa"));
  await assertSucceeds(b.commit());
  observed.platformAdminMembershipBatch = BULK;
});

test("bulk: Organization Admin changes the status of 400 members in ONE batch", async () => {
  const db = as("oaA");
  for (const status of ["suspended", "active"]) {
    const b = writeBatch(db);
    for (let i = 0; i < BULK; i++) b.update(doc(db, "organizationMembers", "orgA_bulk" + String(i).padStart(3, "0")), statusChange("oaA", status));
    await assertSucceeds(b.commit());
  }
  observed.organizationAdminStatusBatch = BULK;
});

test("lists: Organization Admin pages and fully lists members of its organization; own-membership list; Platform Admin organization list", async () => {
  const oa = as("oaA");
  const page = await assertSucceeds(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "==", "orgA"), orderBy(documentId()), limit(100))));
  assert.equal(page.size, 100);
  const all = await assertSucceeds(getDocs(query(collection(oa, "organizationMembers"), where("organizationId", "==", "orgA"))));
  assert.ok(all.size >= BULK + 40);
  await assertSucceeds(getDocs(query(collection(oa, "userCapabilities"), where("organizationId", "==", "orgA"))));
  await assertSucceeds(getDocs(query(collection(as("mCap"), "organizationMembers"), where("uid", "==", "mCap"))));
  await assertSucceeds(getDocs(query(collection(as("pa"), "organizations"), limit(100))));
  observed.membersListed = all.size;
});

async function capBatch(actor, n, mode) {
  const db = as(actor);
  const batch = writeBatch(db);
  for (let i = 0; i < n; i++) {
    const uid = "cm" + String(i).padStart(2, "0");
    if (mode === "create") batch.set(doc(db, "userCapabilities", "orgA_" + uid), newCapPayload("orgA", uid, actor, ["library.review"]));
    else batch.update(doc(db, "userCapabilities", "orgA_" + uid), capUpdate(actor, ["library.publish"]));
  }
  try { await batch.commit(); return true; } catch { return false; }
}
async function resetCaps(withDocs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let i = 0; i < 40; i++) {
      const id = "orgA_cm" + String(i).padStart(2, "0"), uid = "cm" + String(i).padStart(2, "0");
      if (withDocs) await setDoc(doc(db, "userCapabilities", id), capSeed("orgA", uid, ["library.review"])); else await deleteDoc(doc(db, "userCapabilities", id));
    }
  });
}

test("capability batches (one target-membership get per write): observed largest passing batch for creates (setDoc) and updates", async () => {
  for (const actor of ["oaA", "pa"]) {
    for (const mode of ["create", "update"]) {
      let max = 0;
      for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 17, 18, 19, 20, 22, 25, 30]) {
        await resetCaps(mode === "update");
        if (await capBatch(actor, n, mode)) max = n;
      }
      await resetCaps(mode === "update");
      observed["capabilityBatchMax_" + actor + "_" + mode] = max;
      assert.ok(max >= 5, actor + "/" + mode + ": at least 5 capability writes per batch must pass (got " + max + ")");
      assert.ok(!(await capBatch(actor, 30, mode)), actor + "/" + mode + ": 30 distinct targets in one batch must be denied");
    }
  }
  await resetCaps(false);
});

test("headroom: get/exists calls consumed by each helper composition (budget 10)", async () => {
  const who = { cap: ["mCap", "oaA", "pa"], contrib: ["mCap", "mA1", "oaA"], activemember: ["mCap"], admin: ["oaA"], governs: ["oaA", "pa"], mayWrite: ["oaA", "pa"] };
  const rows = [];
  for (const [name, users] of Object.entries(who)) {
    for (const u of users) {
      let kmax = -1;
      for (let k = 0; k <= 10; k++) {
        try { await getDoc(doc(as(u), "_hr_" + name + "_" + k, "a")); kmax = k; } catch { break; }
      }
      assert.ok(kmax >= 0, name + "/" + u + ": base helper must pass");
      rows.push({ helper: name, principal: u, extraDistinctReadsAllowed: kmax, helperCallsUsed: 10 - kmax });
    }
  }
  observed.headroom = rows;
  // contract: every helper stays well inside the Firestore budget, leaving room for the parent resource core in later phases
  for (const r of rows) assert.ok(r.helperCallsUsed <= 6, JSON.stringify(r));
});

test.after(() => {
  try { writeFileSync(path.join(os.tmpdir(), "p2s1-budget-observations.json"), JSON.stringify(observed, null, 2)); } catch {}
  console.log("BUDGET OBSERVATIONS " + JSON.stringify(observed));
});
