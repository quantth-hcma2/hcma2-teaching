// Shared harness for the Library V2 P2-S1 Rules suites (Firestore emulator only; synthetic data only).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, startAfter, writeBatch, serverTimestamp } from "firebase/firestore";

export { assertFails, assertSucceeds, doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, documentId, startAfter, writeBatch, serverTimestamp };

export const HOST = "127.0.0.1";
export const PORT = 8431;
export const RULES_PATH = new URL("../../firestore.rules.production-candidate", import.meta.url);
export const NL = String.fromCharCode(10);
export const BEGIN = "    // ===== LIBRARY V2 P2-S1 (ORGANIZATION FOUNDATION) - BEGIN =====";
export const END = "    // ===== LIBRARY V2 P2-S1 (ORGANIZATION FOUNDATION) - END =====";
export const DEFAULT_DENY_MARKER = "    // ---------------- M" + String.fromCharCode(0x1EB7) + "c " + String.fromCharCode(0x111) + String.fromCharCode(0x1ECB) + "nh: ch" + String.fromCharCode(0x1EB7) + "n t" + String.fromCharCode(0x1EA5) + "t c" + String.fromCharCode(0x1EA3) + " ----------------";

export const sha = (text) => createHash("sha256").update(text).digest("hex");
export const candidateRules = () => readFileSync(RULES_PATH, "utf8");

// The additive region exactly as inserted (BEGIN line .. END line + one blank line).
export function regionOf(rules) {
  const a = rules.indexOf(BEGIN);
  const e = rules.indexOf(END);
  if (a < 0 || e < 0 || e < a) throw new Error("P2-S1 region markers not found");
  const endLine = rules.indexOf(NL, e) + 1;
  return rules.slice(a, endLine + 1);
}
export const baselineRules = (rules = candidateRules()) => rules.replace(regionOf(rules), "");

// Test-only probes appended to the candidate Rules (NEVER part of the production file).
export function withProbes(rules, extra = "") {
  const probes = [
    "    match /_probe_cap/{id} { allow get: if hasOrgCap(resource.data.organizationId, resource.data.cap); }",
    "    match /_probe_contrib/{id} { allow get: if canContribute(resource.data.organizationId); }",
    "    match /_probe_gov/{id} { allow get: if orgGoverns(resource.data.organizationId); }",
    "    match /_probe_write/{id} { allow get: if mayWriteOrg(resource.data.organizationId); }",
    "    match /_probe_activemember/{id} { allow get: if isActiveOrgMember(resource.data.organizationId); }",
    extra
  ].join(NL) + NL + NL;
  const at = rules.indexOf(DEFAULT_DENY_MARKER);
  if (at < 0) throw new Error("default-deny marker not found");
  return rules.slice(0, at) + probes + rules.slice(at);
}

export async function makeEnv(projectId, rules) {
  return initializeTestEnvironment({ projectId, firestore: { host: HOST, port: PORT, rules } });
}

export function actors(env) {
  const cache = new Map();
  return (uid, provider = "password") => {
    const key = uid + "|" + provider;
    if (!cache.has(key)) cache.set(key, env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore());
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

// Client-style payloads (server timestamps, as the future UI will write them)
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

// Standard synthetic world for the authorization matrix.
export async function seedWorld(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, path), data);
    const user = (id, role, status) => put("users/" + id, { uid: id, role, status, displayName: id, email: id + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(1) });
    await user("pa", "admin", "active");
    await user("spa", "admin", "suspended");
    for (const t of ["oaA", "mA1", "mA2", "mA3", "oaB", "mB1", "multi", "oaC", "mC", "sm", "rm", "out"]) await user(t, "teacher", "active");
    await user("susp", "teacher", "suspended");
    await user("pend", "teacher", "pending");
    await put("organizations/orgA", orgDoc("Don vi A", "don-vi-a"));
    await put("organizations/orgB", orgDoc("Don vi B", "don-vi-b"));
    await put("organizations/orgC", orgDoc("Don vi C", "don-vi-c", "archived"));
    const m = (org, uid, role = "member", status = "active") => put("organizationMembers/" + org + "_" + uid, memberDoc(org, uid, role, status));
    await m("orgA", "oaA", "org_admin"); await m("orgA", "mA1"); await m("orgA", "mA2"); await m("orgA", "mA3"); await m("orgA", "sm", "member", "suspended"); await m("orgA", "rm", "member", "removed");
    await m("orgA", "multi"); await m("orgA", "susp");
    await m("orgB", "oaB", "org_admin"); await m("orgB", "mB1"); await m("orgB", "multi");
    await m("orgC", "oaC", "org_admin"); await m("orgC", "mC");
    await put("userCapabilities/orgA_mA1", capSeed("orgA", "mA1", ["library.review"]));
    await put("userCapabilities/orgA_mA2", capSeed("orgA", "mA2", [], ["library.contribute"]));
    await put("userCapabilities/orgB_mB1", capSeed("orgB", "mB1", ["library.publish"]));
    for (const [id, org] of [["a", "orgA"], ["b", "orgB"], ["c", "orgC"]]) {
      await put("_probe_cap/" + id, { organizationId: org, cap: "library.review" });
      await put("_probe_contrib/" + id, { organizationId: org });
      await put("_probe_gov/" + id, { organizationId: org });
      await put("_probe_write/" + id, { organizationId: org });
      await put("_probe_activemember/" + id, { organizationId: org });
    }
  });
}
