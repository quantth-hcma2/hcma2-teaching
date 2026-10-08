// Synthetic world + case builders for the Google projects.test gate. No production document is referenced; every path/value is invented test data.
const P = "/databases/%28default%29/documents";          // function-call arg encoding used by the evaluator
const RP = "/databases/(default)/documents";             // request.path encoding
const T = "2026-10-08T12:00:00Z";                         // request.time
const OLD = "2026-10-07T00:00:00Z";
const FINAL = "f".repeat(32);
const user = (uid, role = "teacher", status = "active") => ({ uid, role, status, displayName: uid, email: uid + "@example.test", approvedBy: null, approvedAt: null, createdAt: OLD });
const member = (org, uid, orgRole = "member", status = "active") => ({ schemaVersion: 1, organizationId: org, uid, orgRole, status, displayName: uid, email: uid + "@example.test", addedBy: "pa", createdAt: OLD, updatedAt: OLD });
const cap = (org, uid, caps) => ({ schemaVersion: 1, organizationId: org, uid, caps, denied: [], updatedBy: "pa", createdAt: OLD, updatedAt: OLD });
const baseWorld = () => ({
  ["users/pa"]: user("pa", "admin"), ["users/oaA"]: user("oaA"), ["users/capA"]: user("capA"), ["users/mA"]: user("mA"), ["users/oaB"]: user("oaB"), ["users/noMember"]: user("noMember"),
  ["organizations/orgA"]: { schemaVersion: 1, name: "Don vi A", code: "don-vi-a", status: "active", createdAt: OLD, createdBy: "pa", updatedAt: OLD },
  ["organizations/orgB"]: { schemaVersion: 1, name: "Don vi B", code: "don-vi-b", status: "active", createdAt: OLD, createdBy: "pa", updatedAt: OLD },
  ["organizationMembers/orgA_oaA"]: member("orgA", "oaA", "org_admin"),
  ["organizationMembers/orgA_capA"]: member("orgA", "capA"), ["userCapabilities/orgA_capA"]: cap("orgA", "capA", ["curriculum.manage"]),
  ["organizationMembers/orgA_mA"]: member("orgA", "mA"),
  ["organizationMembers/orgB_oaB"]: member("orgB", "oaB", "org_admin")
});
const ACTORS = { pa: { allow: true }, oaA: { allow: true }, capA: { allow: true }, mA: { allow: false }, oaB: { allow: false }, noMember: { allow: false }, anon: { allow: false } };
const batchDoc = (id, extra = {}) => ({
  schemaVersion: 1, kind: "curriculum", organizationId: "orgA", destination: { type: "curriculumFramework", frameworkId: id }, templateId: "hcma2.curriculum.xlsx", templateVersion: 1,
  sourceFile: { name: "khung.xlsx", size: 2048, sha256: "a".repeat(64) }, importer: "pa", status: "committing", counts: { parsed: 6, accepted: 6, skipped: 0, failed: 0 },
  chunksDone: 0, chunksTotal: 1, warningsSummary: {}, finalNodeId: FINAL, createdAt: OLD, updatedAt: OLD, ...extra
});
const fwDoc = (status = "draft", extra = {}) => ({ schemaVersion: 1, organizationId: "orgA", scope: "organization", name: "Khung A", status, createdAt: OLD, createdBy: "pa", updatedAt: OLD, ...(status === "draft" ? {} : { activatedAt: OLD, statusChangedAt: OLD, statusChangedBy: "pa" }), ...extra });
const nodeDoc = (extra = {}) => ({ schemaVersion: 1, organizationId: "orgA", kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "Mon hoc", status: "active", createdAt: OLD, updatedAt: OLD, ...extra });

// mocks: every world doc answers exists=true/get=data; every path in `missing` answers exists=false and get=undefined
function mocks(world, missing = []) {
  const out = [];
  for (const [p, d] of Object.entries(world)) {
    out.push({ function: "exists", args: [{ exactValue: P + "/" + p }], result: { value: true } });
    out.push({ function: "get", args: [{ exactValue: P + "/" + p }], result: { value: { data: d } } });
  }
  for (const p of missing) { out.push({ function: "exists", args: [{ exactValue: P + "/" + p }], result: { value: false } }); out.push({ function: "get", args: [{ exactValue: P + "/" + p }], result: { undefined: {} } }); }
  return out;
}
const authOf = (a) => a === "anon" ? undefined : { uid: a, token: { firebase: { sign_in_provider: "password" } } };
function tc(name, actor, method, path, { resource, next, world, missing, allow }) {
  return {
    expectation: allow ? "ALLOW" : "DENY", expressionReportLevel: "VISITED",
    request: { ...(authOf(actor) ? { auth: authOf(actor) } : {}), method, path: RP + "/" + path, time: T, ...(next ? { resource: { data: next } } : {}) },
    ...(resource ? { resource: { data: resource } } : {}),
    functionMocks: mocks({ ...baseWorld(), ...(world || {}) }, missing || [])
  };
}
module.exports = { P, RP, T, OLD, FINAL, baseWorld, ACTORS, batchDoc, fwDoc, nodeDoc, tc, mocks };
