// Library V2 P2-S4 - source guards: the S4 change set is exactly ordinary membership management. Nothing else changed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const html = text("index.html");
const view = text("organization-membership-view.mjs");
const adminView = text("organization-admin-view.mjs");
const code = (src) => src.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith("//")).join(String.fromCharCode(10));

test("membership view module: only the S2 write contract is imported; no Firebase import, no hand-built membership payload, no fields of its own", () => {
  const src = code(view);
  const imports = [...src.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((x) => x[1]);
  assert.deepEqual(imports, ["./organization-write-contract.mjs"]);
  for (const token of ["firebase", "serverTimestamp", "schemaVersion", "createdAt:", "updatedAt:", "addedBy:", "statusChangedAt", "statusChangedBy", "caps", "denied", "userCapabilities", "runTransaction", "onSnapshot", "deleteDoc", "deleteField", "fetch(", "localStorage", "import(", "setDoc"]) {
    assert.ok(!src.includes(token), "membership view must not contain " + token);
  }
});

test("scope: ordinary members only - no Organization Admin appointment/revocation/role change, no capability or context logic", () => {
  const used = [...view.matchAll(/contract\.build[A-Za-z]+/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i).sort();
  assert.deepEqual(used, ["contract.buildMembershipStatusChange", "contract.buildNewMembership"], "only the new-membership and status-change builders are used");
  assert.ok(!view.includes("buildMembershipRoleChange") && !view.includes("buildNewCapability") && !view.includes("buildCapabilityUpdate") && !view.includes("buildMembershipSnapshotRefresh"));
  assert.equal([...view.matchAll(/orgRole: "([a-z_]+)"/g)].map((m) => m[1]).join(","), "member", "a membership is only ever created with orgRole member");
  assert.ok(!/appoint|promote|org_admin.*contract\.build/i.test(code(view).replace(/membershipRoleLabel[^\n]*/g, "").replace(/"org_admin"/g, "")), "no appoint/promote logic");
  assert.ok(view.includes('member.orgRole !== "member"'), "org_admin rows are read-only");
  assert.ok(view.includes('organization.status !== "active"'), "archived organizations offer no membership action");
  for (const word of ["resolveOrganizationContext", "organization-context", "STATE.", "switcher"]) assert.ok(!code(view).includes(word), "no context wiring: " + word);
});

test("collections: `organizationMembers` is named only in the thin writer, `users` only in the picker query (one place, one query shape)", () => {
  const src = code(view);
  const writer = src.slice(src.indexOf("export function createMembershipWriter"), src.indexOf("// PICKER QUERY"));
  assert.equal((src.match(/"organizationMembers"/g) || []).length, 2, "two uses, both inside the writer");
  assert.equal((writer.match(/"organizationMembers"/g) || []).length, 2);
  const picker = src.slice(src.indexOf("export function createActiveTeacherPickerQuery"), src.indexOf("// ---------------------------------------------------------------- controller"));
  assert.equal((src.match(/"users"/g) || []).length, 1);
  assert.equal((picker.match(/"users"/g) || []).length, 1);
  assert.equal((src.match(/where\(/g) || []).length, 2, "exactly two where() filters (role, status)");
  assert.ok(picker.includes('where("role", "==", "teacher"), where("status", "==", "active"), orderBy("createdAt", "desc")'));
  assert.ok(picker.includes("limit(pageSize + 1)") && picker.includes("pageSize > 100"), "bounded and paged");
  assert.ok(!src.includes("getDocs(collection"), "no unbounded collection read");
  // the picker query is only reachable through the add dialog
  assert.equal((view.match(/picker\.pageActiveTeachersForMembershipPicker/g) || []).length, 1);
  assert.ok(view.indexOf("picker.pageActiveTeachersForMembershipPicker") > view.indexOf("async function openPicker"));
});

test("audit: existing best-effort logAudit only; one summary entry per add operation and one entry per status change", () => {
  const actions = [...view.matchAll(/logAudit\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(actions, ['"organization.member." + action', '"organization.members.add"']);
  assert.ok(!view.includes("addDoc") && !view.includes("auditLogs"));
});

test("safety: the admin view only gained the optional membershipSection hook (S3 behavior preserved without it); membership writes are Platform-Admin-gated", () => {
  assert.ok(adminView.includes("if (membershipSection) await membershipSection.mount("));
  assert.equal((code(adminView).match(/membershipSection/g) || []).length, 3, "dependency destructuring and the optional call site (guarded)");
  assert.ok(!adminView.includes("organization-membership-view") && !adminView.includes("buildNewMembership"));
  assert.ok(view.includes("if (!isPlatformAdmin) { host.innerHTML = \"\"; return; }"));
  assert.ok(html.includes('isPlatformAdmin:STATE.profile?.role==="admin",\n      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,\n      queries:ORGANIZATION_QUERIES, picker:ORGANIZATION_TEACHER_PICKER') || /membershipSection:createOrganizationMembershipSection\(\{[\s\S]*?isPlatformAdmin:STATE\.profile\?\.role==="admin"/.test(html));
});

test("no new dynamic import(), no new collection in index.html; Rules, indexes, Storage, package, vendor, S2 modules byte-pinned", () => {
  assert.equal(html.split("import(").length - 1, 1);
  const names = new Set();
  for (const m of html.matchAll(/(?:collection|doc|collectionGroup)\((?:db|publicDb)\s*,\s*"([A-Za-z]+)"/g)) names.add(m[1]);
  for (const m of html.matchAll(/(?:collection|doc)\((?:db|publicDb)\s*,\s*(GROUP_COLLECTION|GROUP_JOIN_COLLECTION)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), ["GROUP_COLLECTION", "GROUP_JOIN_COLLECTION", "auditLogs", "classes", "joinCodes", "knowledgeJoinCodes", "knowledgeSessions", "library", "questionSets", "questions", "responses", "sessionTokens", "sessions", "users"]);
  for (const n of ["organizationMembers", "userCapabilities", "libraryResources", "curriculumFrameworks", "importBatches"]) assert.ok(!html.includes(n), n);
  const pinned = {
    "firestore.rules.production-candidate": "7ea5d7a5ebac9df18e995c9a1644b2648e4143fa4fe3046c0de7f8737fcc1ddd",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "organization-queries.mjs": "f47a2380eecd4f8484bec075fcce7e8771dcceab9cb6ffc661fbbb673b6da520",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88"
  };
  for (const [file, hash] of Object.entries(pinned)) assert.equal(sha(file), hash, file);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const mjs = readdirSync(new URL("./", root)).filter((f) => f.startsWith("organization-") || f.startsWith("admin-")).sort();
  assert.deepEqual(mjs, ["admin-feature-registry.mjs", "organization-admin-view.mjs", "organization-context.mjs", "organization-membership-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs"]);
});

test("existing navigation preserved: Admin menu order and TEACHER_MENU unchanged (S4 adds no menu entry, no teacher-visible surface)", () => {
  const menu = html.slice(html.indexOf("const ADMIN_MENU = ["), html.indexOf("];", html.indexOf("const ADMIN_MENU = [")));
  const keys = [...menu.matchAll(/\{key:("[a-zA-Z]+"|getAdminFeature\("organizations"\)\.routeKey)/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['"overview"', '"knowledge"', '"teachers"', 'getAdminFeature("organizations").routeKey', '"classes"', '"sessions"', '"qrlinks"', '"groups"', '"library"', '"audit"', '"stats"', '"settings"']);
  const teacher = html.slice(html.indexOf("const TEACHER_MENU = ["), html.indexOf("];", html.indexOf("const TEACHER_MENU = [")));
  assert.equal(createHash("sha256").update(teacher).digest("hex"), "3bff38d3c4cdadc2c370985252e7909c256905d0973356e7d605892a2e9f46d8");
});
