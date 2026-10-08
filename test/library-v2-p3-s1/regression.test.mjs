// LIBRARY V2 P3-S1 - proof that EXISTING Rules behavior (V1 + P2 organization semantics) is unchanged by the additive P3 curriculum region.
//  (1) text proof: candidate minus the single P3 region is byte-identical to the DEPLOYED production Rules (SHA-256 7EA5D7A5..., ruleset 7e4333e7);
//      the P2-S1 region inside it is byte-identical to the deployed one; the P3 region is a pure insertion before the default-deny block;
//  (2) behavior proof: V1 corpus + P2 organization corpus (incl. the intended Platform Admin governance over ARCHIVED organizations)
//      run on baseline (candidate minus P3) and candidate Rules - outcomes must be identical operation by operation;
//  (3) default-deny proof: curriculum collections are denied by the baseline and later-phase collections stay denied by the candidate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  makeEnv, actors, candidateRules, baselineRules, p3Region, p4Region, p2Region, sha, seedWorld, NL, BEGIN, END, DEPLOYED_SHA, D,
  newMemberPayload, statusChange, newCapPayload, capUpdate, newOrgPayload,
  doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, serverTimestamp, assertFails
} from "./helpers.mjs";
import { seedV1, v1Ops } from "./v1-corpus.mjs";
import { createHash } from "node:crypto";
import { reverseS3IndexEdits, reverseS3AdminViewEdits } from "../library-v2-p3-s3/s3-edits.mjs";   // P3-S3 aligned: older byte-pins keep their meaning by reversing the P3-S3 edits first

const rules = candidateRules();
const baseline = baselineRules(rules);
const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const shaFile = (p) => sha(read(p));

test("text proof: removing the single additive P3 region restores the DEPLOYED Rules byte-for-byte; the P2-S1 region is untouched; the P3 region precedes the default-deny block", () => {
  assert.equal(sha(baseline), DEPLOYED_SHA);
  assert.equal(rules.split(BEGIN).length - 1, 1); assert.equal(rules.split(END).length - 1, 1);
  assert.equal(sha(p2Region(rules)), "cd7697bc79a238d2669f403fadea11fab58e44a238fbf3347878c7424442b9ed");
  assert.equal(sha(p2Region(baseline)), sha(p2Region(rules)));
  const region = p3Region(rules);
  assert.ok(rules.indexOf(region) > rules.indexOf("LIBRARY V2 P2-S1 (ORGANIZATION FOUNDATION) - END"), "P3 region follows the P2 region");
  assert.ok(rules.indexOf(region) < rules.lastIndexOf("match /{document=**}"), "P3 region precedes the default-deny match");
  // P4-S1 aligned: the additive P4-S1 region (a SEPARATE insertion after the P3 region, proven by test/library-v2-p4-s1/regression.test.mjs) is excluded here, so this proof still
  // describes the P3 insertion exactly (the two single-clause P4-S1 edits live INSIDE the P3 region, which is why the region is now two lines longer).
  const rulesNoP4 = rules.includes("LIBRARY V2 P4-S1 (IMPORT BATCHES) - BEGIN") ? rules.replace(p4Region(rules), "") : rules;
  const added = rulesNoP4.split(NL).length - baseline.split(NL).length;
  assert.ok(added > 100 && added < 180, "pure insertion of the region, " + added + " lines");
  // pure insertion: no baseline line removed or reordered
  const bl = baseline.split(NL), cl = rulesNoP4.split(NL);
  const start = cl.indexOf(BEGIN);
  assert.deepEqual(cl.slice(0, start), bl.slice(0, start)); assert.deepEqual(cl.slice(start + added), bl.slice(start));
});

test("region hygiene: only curriculumFrameworks (+ its nodes) is matched; no wildcard-open rule; helper names do not collide; users and P2 collections untouched", () => {
  const region = p3Region(rules);
  const matches = [...region.matchAll(/match \/([A-Za-z{}\/]+?)(?:\/\{[A-Za-z]+\})? \{/g)].map((m) => m[0].replace(/ \{$/, ""));
  assert.deepEqual(matches, ["match /curriculumFrameworks/{fwId}", "match /nodes/{nodeId}"]);
  assert.ok(!/match \/(users|organizations|organizationMembers|userCapabilities|library|questionSets|sessions|groupActivities|knowledgeSessions|auditLogs)\//.test(region));
  assert.ok(!/allow [a-z, ]*: if true/.test(region), "no open rule");
  const names = [...region.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]);
  const baseNames = new Set([...baseline.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]));
  assert.deepEqual(names.sort(), ["fwImmutableOk", "fwPath", "fwShapeOk", "fwTransitionOk", "mayReadCurriculum", "mayWriteCurriculum", "nodeImmutableOk", "nodeParent", "nodeShapeOk", "validFrameworkName"].sort());
  for (const n of names) assert.ok(!baseNames.has(n), "helper name does not collide with an existing function: " + n);
  // every write rule demands the active-organization-aware writer guard; every read rule the governance/capability reader guard
  const writes = [...region.matchAll(/allow (create|update|delete): if /g)].length;
  assert.equal(writes, 6); assert.equal((region.match(/mayWriteCurriculum\(/g) || []).length - 1, 6);   // minus the helper definition
  assert.equal((region.match(/mayReadCurriculum\(/g) || []).length - 1, 2);
  // no hard-coded identifiers, no get() of the users collection inside the region (platform account state comes only through existing helpers)
  assert.ok(!/documents\/users\//.test(region));
  // H2 (archived-organization membership hardening) is explicitly NOT part of this candidate: the P2 membership/capability rules are byte-identical
  for (const needle of ["function mayWriteOrg(orgId) { return isAdmin() || (isOrgAdmin(orgId) && orgActive(orgId)); }",
    "      allow update: if memberShapeOk(request.resource.data) &&\n        memberImmutableOk(resource.data, request.resource.data) &&\n        request.resource.data.updatedAt == request.time &&\n        statusMetaOk(resource.data, request.resource.data) &&\n        (isAdmin() ||"]) assert.ok(rules.includes(needle), "P2 semantics unchanged: " + needle.slice(0, 50));
});

test("no index, Storage, UI, dependency or data-model change (byte-pinned)", () => {
  const pinned = {
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "index.html": "b7a46dc0a222c5c64ceb6b72c8de42652b80e3b8663391772366042be40be63e",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "organization-membership-view.mjs": "d1347229b6b06e1cb1d09fba130045b2e4c54a2c91c5996dc9bf2cd736aed1ea",
    "teacher-organization-enrollment.mjs": "75d6c6afaf657f118408c9182faecd560d259ac5d97eb796695bd9b88023653e",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-admin-view.mjs": "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413"
  };
  const shaOfText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
  const actualOf = (f) => (f === "index.html" ? shaOfText(reverseS3IndexEdits(read(f).toString("utf8"))) : f === "organization-admin-view.mjs" ? shaOfText(reverseS3AdminViewEdits(read(f).toString("utf8"))) : shaFile(f));   // P3-S3 aligned: S3 edits reversed
  for (const [f, h] of Object.entries(pinned)) assert.equal(actualOf(f), h, f);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const html = reverseS3IndexEdits(read("index.html").toString("utf8"));   // P3-S3 aligned: the S3 wiring is guarded by test/library-v2-p3-s3
  for (const n of ["curriculumFrameworks", "curriculum-model", "curriculum-queries", "importBatches", "libraryResources"]) assert.ok(!html.includes(n), "index.html must not reference " + n);
  // P3-S2 aligned: the pure modules curriculum-model/queries/write-contract now exist (pinned and guarded by test/library-v2-p3-s2/source-guard.test.mjs); the UI module must still not exist (P3-S3/S4).
});

// ---------- behavior proof ----------
const envCand = await makeEnv("demo-p3s1-reg-cand", rules);
const envBase = await makeEnv("demo-p3s1-reg-base", baseline);
test.after(async () => { await envCand.cleanup(); await envBase.cleanup(); });
await seedV1(envCand); await seedV1(envBase);

async function run(env, ops) {
  const as = actors(env);
  const out = [];
  for (const [label, uid, fn] of ops) {
    const db = as(uid, uid === "stu" ? "anonymous" : "password");
    let result;
    try { await fn(db); result = "ALLOW"; } catch { result = "DENY"; }
    out.push(label + " => " + result);
  }
  return out;
}

test("behavior proof (V1): " + v1Ops.length + " operations over every pre-existing collection family give identical outcomes on baseline and candidate Rules", async () => {
  const cand = await run(envCand, v1Ops);
  const base = await run(envBase, v1Ops);
  assert.deepEqual(cand, base);
  const allow = cand.filter((x) => x.endsWith("ALLOW")).length, deny = cand.length - allow;
  console.log("DIFFERENTIAL V1 " + JSON.stringify({ operations: v1Ops.length, allow, deny, identical: true }));
  assert.ok(allow >= 15 && deny >= 15);
  const m = Object.fromEntries(cand.map((x) => x.split(" => ")));
  assert.equal(m["users: self adds arbitrary field"], "ALLOW"); assert.equal(m["users: self role escalation"], "DENY");
  assert.equal(m["library: owner create"], "ALLOW"); assert.equal(m["sessions: student get open"], "ALLOW"); assert.equal(m["sessions: student get draft"], "DENY");
});

// P2 organization semantics, including the intended Platform Admin governance over ARCHIVED organizations (orgC is archived in the world seed).
const sc = (by, st) => statusChange(by, st);
const p2Ops = [
  ["org: pa get active", "pa", (db) => getDoc(doc(db, "organizations", "orgA"))],
  ["org: member get own", "mA", (db) => getDoc(doc(db, "organizations", "orgA"))],
  ["org: outsider get", "noMember", (db) => getDoc(doc(db, "organizations", "orgA"))],
  ["org: member get archived own", "mC", (db) => getDoc(doc(db, "organizations", "orgC"))],
  ["org: pa list", "pa", (db) => getDocs(query(collection(db, "organizations"), limit(100)))],
  ["org: member list", "mA", (db) => getDocs(query(collection(db, "organizations"), limit(100)))],
  ["org: pa create", "pa", (db) => setDoc(doc(db, "organizations", "orgNew"), newOrgPayload("pa"))],
  ["org: oa create", "oaA", (db) => setDoc(doc(db, "organizations", "orgNew2"), newOrgPayload("oaA"))],
  ["org: pa archive", "pa", (db) => updateDoc(doc(db, "organizations", "orgNew"), { status: "archived", archivedAt: serverTimestamp(), archivedBy: "pa", updatedAt: serverTimestamp() })],
  ["org: pa restore", "pa", (db) => updateDoc(doc(db, "organizations", "orgNew"), { status: "active", archivedAt: null, archivedBy: null, updatedAt: serverTimestamp() })],
  ["org: oa rename", "oaA", (db) => updateDoc(doc(db, "organizations", "orgA"), { name: "Ten moi", updatedAt: serverTimestamp() })],
  ["member: own list", "mA", (db) => getDocs(query(collection(db, "organizationMembers"), where("uid", "==", "mA")))],
  ["member: oa list own org", "oaA", (db) => getDocs(query(collection(db, "organizationMembers"), where("organizationId", "==", "orgA")))],
  ["member: member list org", "mA", (db) => getDocs(query(collection(db, "organizationMembers"), where("organizationId", "==", "orgA")))],
  ["member: pa add to active org", "pa", (db) => setDoc(doc(db, "organizationMembers", "orgA_newbie"), newMemberPayload("orgA", "newbie", "pa"))],
  ["member: pa add to ARCHIVED org", "pa", (db) => setDoc(doc(db, "organizationMembers", "orgC_newbie"), newMemberPayload("orgC", "newbie", "pa"))],
  ["member: oa add member", "oaA", (db) => setDoc(doc(db, "organizationMembers", "orgA_newbie2"), newMemberPayload("orgA", "newbie2", "oaA"))],
  ["member: pa appoints org_admin", "pa", (db) => setDoc(doc(db, "organizationMembers", "orgA_boss"), newMemberPayload("orgA", "boss", "pa", "org_admin"))],
  ["member: oa suspends member (active org)", "oaA", (db) => updateDoc(doc(db, "organizationMembers", "orgA_mA"), sc("oaA", "suspended"))],
  ["member: oa restores member", "oaA", (db) => updateDoc(doc(db, "organizationMembers", "orgA_mA"), sc("oaA", "active"))],
  ["member: oa changes org_admin", "oaA", (db) => updateDoc(doc(db, "organizationMembers", "orgA_oaA"), sc("oaA", "suspended"))],
  ["member: pa suspends in ACTIVE org", "pa", (db) => updateDoc(doc(db, "organizationMembers", "orgB_mB"), sc("pa", "suspended"))],
  ["member: ARCHIVED org - pa governs (suspend)", "pa", (db) => updateDoc(doc(db, "organizationMembers", "orgC_mC"), sc("pa", "suspended"))],
  ["member: ARCHIVED org - pa governs (restore)", "pa", (db) => updateDoc(doc(db, "organizationMembers", "orgC_mC"), sc("pa", "active"))],
  ["member: ARCHIVED org - oa suspend denied", "oaC", (db) => updateDoc(doc(db, "organizationMembers", "orgC_capC"), sc("oaC", "suspended"))],
  ["member: self update", "mA", (db) => updateDoc(doc(db, "organizationMembers", "orgA_mA"), sc("mA", "removed"))],
  ["member: delete", "pa", (db) => deleteDoc(doc(db, "organizationMembers", "orgA_mA"))],
  ["cap: oa get own org", "oaA", (db) => getDoc(doc(db, "userCapabilities", "orgA_capA"))],
  ["cap: member get own", "capA", (db) => getDoc(doc(db, "userCapabilities", "orgA_capA"))],
  ["cap: other member get", "mA", (db) => getDoc(doc(db, "userCapabilities", "orgA_capA"))],
  ["cap: pa grant (active org)", "pa", (db) => setDoc(doc(db, "userCapabilities", "orgA_mA"), newCapPayload("orgA", "mA", "pa", ["library.review"]))],
  ["cap: oa update (active org)", "oaA", (db) => updateDoc(doc(db, "userCapabilities", "orgA_mA"), capUpdate("oaA", ["library.publish"]))],
  ["cap: oa grant to org_admin", "oaA", (db) => setDoc(doc(db, "userCapabilities", "orgA_oaA"), newCapPayload("orgA", "oaA", "oaA", ["library.review"]))],
  ["cap: self grant", "mA", (db) => updateDoc(doc(db, "userCapabilities", "orgA_mA"), capUpdate("mA", ["library.manage"]))],
  ["cap: ARCHIVED org - pa governs (grant)", "pa", (db) => setDoc(doc(db, "userCapabilities", "orgC_mC"), newCapPayload("orgC", "mC", "pa", ["library.review"]))],
  ["cap: ARCHIVED org - oa grant denied", "oaC", (db) => setDoc(doc(db, "userCapabilities", "orgC_capC2"), newCapPayload("orgC", "capC2", "oaC", ["library.review"]))],
  ["cap: delete", "pa", (db) => deleteDoc(doc(db, "userCapabilities", "orgA_capA"))],
  ["users: oa reads another user", "oaA", (db) => getDoc(doc(db, "users", "mB"))],
  ["users: cap holder lists users", "capA", (db) => getDocs(collection(db, "users"))]
];

test("behavior proof (P2 organization semantics): " + p2Ops.length + " operations give identical outcomes on baseline and candidate Rules; the intended Platform Admin governance over ARCHIVED organizations is preserved (H2 NOT applied)", async () => {
  await envCand.clearFirestore(); await envBase.clearFirestore(); await seedWorld(envCand); await seedWorld(envBase);
  const cand = await run(envCand, p2Ops);
  const base = await run(envBase, p2Ops);
  assert.deepEqual(cand, base);
  const allow = cand.filter((x) => x.endsWith("ALLOW")).length, deny = cand.length - allow;
  console.log("DIFFERENTIAL P2 " + JSON.stringify({ operations: p2Ops.length, allow, deny, identical: true }));
  const m = Object.fromEntries(cand.map((x) => x.split(" => ")));
  // the intended governance asserted by the existing P2-S1 suite stays ALLOW; everything else about archived organizations stays DENY
  assert.equal(m["member: ARCHIVED org - pa governs (suspend)"], "ALLOW"); assert.equal(m["member: ARCHIVED org - pa governs (restore)"], "ALLOW");
  assert.equal(m["cap: ARCHIVED org - pa governs (grant)"], "ALLOW");
  assert.equal(m["member: pa add to ARCHIVED org"], "DENY"); assert.equal(m["member: ARCHIVED org - oa suspend denied"], "DENY"); assert.equal(m["cap: ARCHIVED org - oa grant denied"], "DENY");
  assert.equal(m["member: pa add to active org"], "ALLOW"); assert.equal(m["member: oa add member"], "DENY"); assert.equal(m["cap: self grant"], "DENY");
  assert.ok(allow >= 15 && deny >= 10);
});

test("default-deny proof: curriculum collections are denied by the baseline (even for the Platform Admin); later-phase collections stay denied by the candidate", async () => {
  await envCand.clearFirestore(); await envBase.clearFirestore(); await seedWorld(envCand); await seedWorld(envBase);
  const a = actors(envBase), c = actors(envCand);
  for (const p of ["curriculumFrameworks/fwA_active", "curriculumFrameworks/fwA_active/nodes/s1"]) {
    await assertFails(getDoc(doc(a("pa"), p)));
    await assertFails(setDoc(doc(a("pa"), p), { x: 1 }));
  }
  // P4-S1 aligned: importBatches is INTENTIONALLY opened by P4-S1 (proven by test/library-v2-p4-s1); the remaining later-phase collections stay default-denied.
  for (const col of ["libraryResources", "curriculumMappings", "libraryUsageEvents", "organizationInvites", "libraryAssets"]) {
    await assertFails(setDoc(doc(c("pa"), col, "x"), { x: 1 }));
    await assertFails(getDoc(doc(c("pa"), col, "x")));
  }
  await assertFails(getDoc(doc(c("pa"), "curriculumFrameworks/fwA_active/mappingSuggestions/x")));
  await assertFails(getDoc(doc(c("pa"), "curriculumFrameworks/fwA_active/nodes/s1/children/x")));
});
