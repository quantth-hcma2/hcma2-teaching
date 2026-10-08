// Shared harness for the Library V2 P3-S1 (curriculum Rules) suites. Firestore emulator only; synthetic data only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

export { assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, writeBatch, serverTimestamp, Timestamp };

export const HOST = "127.0.0.1";
export const PORT = 8451;
export const RULES_PATH = new URL("../../firestore.rules.production-candidate", import.meta.url);
export const NL = String.fromCharCode(10);
export const P2_BEGIN = "    // ===== LIBRARY V2 P2-S1 (ORGANIZATION FOUNDATION) - BEGIN =====";
export const P2_END = "    // ===== LIBRARY V2 P2-S1 (ORGANIZATION FOUNDATION) - END =====";
export const BEGIN = "    // ===== LIBRARY V2 P3-S1 (CURRICULUM) - BEGIN =====";
export const END = "    // ===== LIBRARY V2 P3-S1 (CURRICULUM) - END =====";
export const DEFAULT_DENY_MARKER = "    // ---------------- M" + String.fromCharCode(0x1EB7) + "c " + String.fromCharCode(0x111) + String.fromCharCode(0x1ECB) + "nh: ch" + String.fromCharCode(0x1EB7) + "n t" + String.fromCharCode(0x1EA5) + "t c" + String.fromCharCode(0x1EA3) + " ----------------";
// Deployed production Rules (ruleset 7e4333e7-a927-47aa-b20d-74c58f778e7b) and the P2-S1 region as deployed.
export const DEPLOYED_SHA = "7ea5d7a5ebac9df18e995c9a1644b2648e4143fa4fe3046c0de7f8737fcc1ddd";

export const sha = (text) => createHash("sha256").update(text).digest("hex");
export const candidateRules = () => readFileSync(RULES_PATH, "utf8");

export function regionBetween(rules, begin, end) {
  const a = rules.indexOf(begin);
  const e = rules.indexOf(end);
  if (a < 0 || e < 0 || e < a) throw new Error("region markers not found: " + begin);
  const endLine = rules.indexOf(NL, e) + 1;
  return rules.slice(a, endLine + 1);
}
export const p3Region = (rules) => regionBetween(rules, BEGIN, END);
// P4-S1 aligned: the additive P4-S1 import-batch region (a second, separate insertion after the P3 region).
export const P4_BEGIN = "    // ===== LIBRARY V2 P4-S1 (IMPORT BATCHES) - BEGIN =====";
export const P4_END = "    // ===== LIBRARY V2 P4-S1 (IMPORT BATCHES) - END =====";
export const p4Region = (rules) => regionBetween(rules, P4_BEGIN, P4_END);
export const p2Region = (rules) => regionBetween(rules, P2_BEGIN, P2_END);
// The deployed baseline = candidate minus the single P3 region (P4-S1 aligned: and minus the additive P4-S1 region when present). NOTE: the two P4-S1 single-clause edits INSIDE the
// P3 region are not removed here; the P4-S1 text proof (test/library-v2-p4-s1/regression.test.mjs) reverses them exactly and proves the P3-S1 deployed artifact byte for byte.
export const baselineRules = (rules = candidateRules()) => { const noP3 = rules.replace(p3Region(rules), ""); return noP3.includes(P4_BEGIN) ? noP3.replace(p4Region(noP3), "") : noP3; };

// Test-only probes appended to the candidate Rules (NEVER part of the production file).
export function withProbes(rules, extra = "") {
  const probes = [
    "    match /_probe_read/{id} { allow get: if mayReadCurriculum(resource.data.organizationId); }",
    "    match /_probe_write/{id} { allow get: if mayWriteCurriculum(resource.data.organizationId); }",
    extra
  ].join(NL) + NL + NL;
  const at = rules.indexOf(DEFAULT_DENY_MARKER);
  if (at < 0) throw new Error("default-deny marker not found");
  return rules.slice(0, at) + probes + rules.slice(at);
}

export async function makeEnv(projectId, rules) {
  return initializeTestEnvironment({ projectId, firestore: { host: HOST, port: PORT, rules } });
}

// as(uid) -> authenticated Firestore; as(null) -> unauthenticated; as(uid, "anonymous") -> anonymous provider
export function actors(env) {
  const cache = new Map();
  return (uid, provider = "password") => {
    const key = uid + "|" + provider;
    if (!cache.has(key)) cache.set(key, uid === null ? env.unauthenticatedContext().firestore() : env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore());
    return cache.get(key);
  };
}

export const D = (day = 1) => new Date(Date.UTC(2026, 9, day, 0, 0, 0));
export const memberDoc = (organizationId, uid, orgRole = "member", status = "active", extra = {}) => ({
  schemaVersion: 1, organizationId, uid, orgRole, status, displayName: "Name " + uid, email: uid + "@example.test",
  addedBy: "pa", createdAt: D(2), updatedAt: D(2), ...extra
});
export const orgDoc = (name, code, status = "active") => ({ schemaVersion: 1, name, code, status, createdAt: D(1), createdBy: "pa", updatedAt: D(1) });
export const capSeed = (organizationId, uid, caps = [], denied = []) => ({
  schemaVersion: 1, organizationId, uid, caps, denied, updatedBy: "pa", createdAt: D(3), updatedAt: D(3)
});

// Seeded (rules-disabled) documents
export const fwDoc = (organizationId, status = "draft", extra = {}) => ({
  schemaVersion: 1, organizationId, scope: "organization", name: "Khung " + organizationId + " " + status, status,
  createdAt: D(4), createdBy: "pa", updatedAt: D(4),
  ...(status === "draft" ? {} : { activatedAt: D(5), statusChangedAt: D(5), statusChangedBy: "pa" }),
  ...extra
});
export const nodeDoc = (organizationId, extra = {}) => ({
  schemaVersion: 1, organizationId, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Mon hoc", status: "active",
  createdAt: D(6), updatedAt: D(6), ...extra
});

// Client-style payloads (server timestamps, exactly as the later UI will write them)
export const newFwPayload = (organizationId, uid, extra = {}) => ({
  schemaVersion: 1, organizationId, scope: "organization", name: "Khung chuong trinh moi", status: "draft",
  createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), ...extra
});
export const fwRename = (name) => ({ name, updatedAt: serverTimestamp() });
export const fwTransition = (uid, status, extra = {}) => ({ status, statusChangedAt: serverTimestamp(), statusChangedBy: uid, updatedAt: serverTimestamp(), ...extra });
export const newNodePayload = (organizationId, extra = {}) => ({
  schemaVersion: 1, organizationId, kind: "subject", parentId: null, ancestors: [], order: 1, code: null, name: "Mon moi", status: "active",
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra
});
export const lessonPayload = (organizationId, parentId, extra = {}) => newNodePayload(organizationId, { kind: "lesson", parentId, ancestors: [parentId], name: "Bai moi", ...extra });
export const nodeEdit = (fields) => ({ ...fields, updatedAt: serverTimestamp() });

export const fwRef = (db, id) => doc(db, "curriculumFrameworks", id);
export const nodeRef = (db, fwId, id) => doc(db, "curriculumFrameworks", fwId, "nodes", id);
export const nodesCol = (db, fwId) => collection(db, "curriculumFrameworks", fwId, "nodes");

// Standard world used by the matrix suites.
//   org A active, org B active, org C archived.
export const WORLD = {
  users: [
    ["pa", "admin", "active"], ["paSusp", "admin", "suspended"], ["tPend", "teacher", "pending"], ["tSusp", "teacher", "suspended"],
    ["mA", "teacher", "active"], ["capA", "teacher", "active"], ["revA", "teacher", "active"], ["oaA", "teacher", "active"],
    ["mB", "teacher", "active"], ["capB", "teacher", "active"], ["oaB", "teacher", "active"],
    ["capSuspMem", "teacher", "active"], ["capRemoved", "teacher", "active"], ["ghost", "teacher", "active"], ["noMember", "teacher", "active"],
    ["mC", "teacher", "active"], ["oaC", "teacher", "active"], ["capC", "teacher", "active"]
  ]
};
export async function seedWorld(env, { extra } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    for (const [id, role, status] of WORLD.users) await put("users/" + id, { uid: id, role, status, displayName: id, email: id + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(1) });
    await put("organizations/orgA", orgDoc("Don vi A", "don-vi-a"));
    await put("organizations/orgB", orgDoc("Don vi B", "don-vi-b"));
    await put("organizations/orgC", orgDoc("Don vi C", "don-vi-c", "archived"));
    const mem = (org, uid, role = "member", status = "active") => put("organizationMembers/" + org + "_" + uid, memberDoc(org, uid, role, status));
    const cap = (org, uid, caps) => put("userCapabilities/" + org + "_" + uid, capSeed(org, uid, caps));
    await mem("orgA", "mA"); // ordinary member, no capability document
    await mem("orgA", "capA"); await cap("orgA", "capA", ["curriculum.manage"]);
    await mem("orgA", "revA"); await cap("orgA", "revA", ["library.review"]);
    await mem("orgA", "oaA", "org_admin");
    await mem("orgA", "tSusp"); await cap("orgA", "tSusp", ["curriculum.manage"]); // globally suspended account with an active membership + capability
    await mem("orgA", "capSuspMem", "member", "suspended"); await cap("orgA", "capSuspMem", ["curriculum.manage"]);
    await mem("orgA", "capRemoved", "member", "removed"); await cap("orgA", "capRemoved", ["curriculum.manage"]);
    await cap("orgA", "ghost", ["curriculum.manage"]);                                // capability document without any membership
    await mem("orgB", "mB"); await mem("orgB", "capB"); await cap("orgB", "capB", ["curriculum.manage"]); await mem("orgB", "oaB", "org_admin");
    await mem("orgC", "mC"); await mem("orgC", "oaC", "org_admin"); await mem("orgC", "capC"); await cap("orgC", "capC", ["curriculum.manage"]);
    // frameworks
    await put("curriculumFrameworks/fwA_draft", fwDoc("orgA", "draft"));
    await put("curriculumFrameworks/fwA_active", fwDoc("orgA", "active"));
    await put("curriculumFrameworks/fwA_archived", fwDoc("orgA", "archived"));
    await put("curriculumFrameworks/fwA_draftAct", fwDoc("orgA", "draft", { activatedAt: D(5) }));   // impossible through Rules; seeded to prove delete guard
    await put("curriculumFrameworks/fwB_draft", fwDoc("orgB", "draft"));
    await put("curriculumFrameworks/fwC_draft", fwDoc("orgC", "draft"));
    await put("curriculumFrameworks/fwC_active", fwDoc("orgC", "active"));
    // nodes
    for (const fw of ["fwA_draft", "fwA_active", "fwA_archived", "fwA_draftAct"]) {
      await put("curriculumFrameworks/" + fw + "/nodes/s1", nodeDoc("orgA", { name: "Mon 1" }));
      await put("curriculumFrameworks/" + fw + "/nodes/l1", nodeDoc("orgA", { kind: "lesson", parentId: "s1", ancestors: ["s1"], name: "Bai 1" }));
    }
    await put("curriculumFrameworks/fwB_draft/nodes/s1", nodeDoc("orgB"));
    await put("curriculumFrameworks/fwC_draft/nodes/s1", nodeDoc("orgC"));
    await put("curriculumFrameworks/fwC_active/nodes/s1", nodeDoc("orgC"));
    await put("curriculumFrameworks/fwGone/nodes/orphan1", nodeDoc("orgA", { name: "Mo coi" }));   // orphan: parent framework document does not exist
    await put("curriculumFrameworks/fwGoneC/nodes/orphanC", nodeDoc("orgC", { name: "Mo coi C" }));
    if (extra) await extra(db, put);
  });
}

// P2 organization payloads (for the differential regression of the existing organization semantics)
export const newOrgPayload = (uid, name = "Don vi thu nghiem", code = "thu-nghiem") => ({
  schemaVersion: 1, name, code, status: "active", createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp()
});
export const newMemberPayload = (orgId, uid, byUid, orgRole = "member") => ({
  schemaVersion: 1, organizationId: orgId, uid, orgRole, status: "active", displayName: "Name " + uid, email: uid + "@example.test",
  addedBy: byUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});
export const statusChange = (byUid, status) => ({ status, statusChangedAt: serverTimestamp(), statusChangedBy: byUid, updatedAt: serverTimestamp() });
export const newCapPayload = (orgId, uid, byUid, caps = [], denied = []) => ({
  schemaVersion: 1, organizationId: orgId, uid, caps, denied, updatedBy: byUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});
export const capUpdate = (byUid, caps, denied = []) => ({ caps, denied, updatedBy: byUid, updatedAt: serverTimestamp() });
