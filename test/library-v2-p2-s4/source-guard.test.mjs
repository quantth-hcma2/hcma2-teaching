// Library V2 P2-S4 - source guards: the S4 change set is exactly ordinary membership management. Nothing else changed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseS3IndexEdits, reverseS3AdminViewEdits } from "../library-v2-p3-s3/s3-edits.mjs";   // P3-S3 aligned: older byte-pins keep their meaning by reversing the P3-S3 edits first

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const html = text("index.html");
const view = text("organization-membership-view.mjs");
const adminViewNow = text("organization-admin-view.mjs");
const adminView = reverseS3AdminViewEdits(adminViewNow);   // P3-S3 aligned: the S4 assertions below describe the S4 admin view (P3-S3 edits reversed)
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

test("collections: `organizationMembers` is named only in the thin writer (the `users` search query is guarded by the O1 source guard)", () => {
  const src = code(view);
  const writer = src.slice(src.indexOf("export function createMembershipWriter"), src.indexOf("export function createTeacherEmailSearchQuery"));
  assert.equal((src.match(/"organizationMembers"/g) || []).length, 2, "two uses, both inside the writer");
  assert.equal((writer.match(/"organizationMembers"/g) || []).length, 2);
  assert.ok(!src.includes("getDocs(collection"), "no unbounded collection read");
});

test("audit: existing best-effort logAudit only; one summary entry per add operation and one entry per status change", () => {
  const actions = [...view.matchAll(/logAudit\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual([...actions].sort(), ['"organization.member." + action', '"organization.members.add"'].sort());
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
  assert.equal(html.split("import(").length - 1, 2);   // P4-S3 aligned: +1 = the lazy import() of the Import Center engine (Platform Admin, on demand)
  const names = new Set();
  for (const m of html.matchAll(/(?:collection|doc|collectionGroup)\((?:db|publicDb)\s*,\s*"([A-Za-z]+)"/g)) names.add(m[1]);
  for (const m of html.matchAll(/(?:collection|doc)\((?:db|publicDb)\s*,\s*(GROUP_COLLECTION|GROUP_JOIN_COLLECTION)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), ["GROUP_COLLECTION", "GROUP_JOIN_COLLECTION", "auditLogs", "classes", "joinCodes", "knowledgeJoinCodes", "knowledgeSessions", "library", "questionSets", "questions", "responses", "sessionTokens", "sessions", "users"]);
  for (const n of ["organizationMembers", "userCapabilities", "libraryResources", "curriculumFrameworks", "importBatches"]) assert.ok(!html.includes(n), n);
  const pinned = {
    "firestore.rules.production-candidate": "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485", // P3-S1 candidate Rules (deployed 7EA5D7A5... + the P3 region)
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
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

test("UX revision: ONE add-teacher button, rendered into the detail header action area (not the member card); summary uses only loaded data; reinstate wording", () => {
  const src = code(view);
  assert.equal((src.match(/id="orgMemberAddBtn"/g) || []).length, 1, "the add button markup exists exactly once");
  const card = src.slice(src.indexOf("export function renderMembersSectionHtml"), src.indexOf("export function renderAddTeacherActionHtml"));
  assert.ok(!card.includes("orgMemberAddBtn"), "not inside the member card markup");
  assert.ok(src.includes('querySelector("#orgPrimaryActions")'));
  assert.equal((adminView.match(/id="orgPrimaryActions"/g) || []).length, 1, "the detail view provides the single action placeholder");
  const summary = src.slice(src.indexOf("export function summarizeMembers"), src.indexOf("export function normalizeEmailTerm"));
  for (const token of ["getCountFromServer", "getDocs", "query(", "queries.", "await", "fetch("]) assert.ok(!summary.includes(token), "summary is pure over loaded members: " + token);
  assert.ok(src.includes("KHÔI PHỤC THÀNH VIÊN") && !src.includes("ĐƯA TRỞ LẠI") && src.includes("GỠ KHỎI ĐƠN VỊ"));
  assert.ok(!/getCountFromServer|aggregate|collectionGroup/.test(src), "no new aggregation architecture");
});

test("newest-first: the membership list orders by createdAt DESC then document id DESC in the database query (no client-side sort/prepend); one approved index only", () => {
  const q = code(text("organization-queries.mjs"));
  assert.ok(q.includes('order === "newestFirst" ? [orderBy("createdAt", "desc"), orderBy(documentId(), "desc")] : [orderBy(documentId())]'));
  assert.ok(q.includes('{ ...options, order: "newestFirst" }') && q.split("newestFirst").length === 3, "only membersOfOrganization uses the newest-first order");
  assert.ok(!/\.sort\(|\.reverse\(|unshift\(/.test(q), "no client-side sorting in the query module");
  const v = code(view);
  assert.ok(!/\.sort\(|\.reverse\(|unshift\(/.test(v), "no client-side sorting or prepending in the membership view");
  assert.ok(v.includes("await loadPage(true)") && v.includes("await reload()"), "after a successful add the list is reloaded from Firestore (page 1)");
  // the repository index manifest is untouched (the live index was created by a single targeted call, never by deploying this file)
  assert.equal(sha("firestore.indexes.json"), "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51");
});
