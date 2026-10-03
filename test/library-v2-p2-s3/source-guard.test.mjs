// Library V2 P2-S3 - source guards: the S3 change set is exactly the Platform Admin organization lifecycle screen. Nothing else changed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
const html = text("index.html");
const view = text("organization-admin-view.mjs");
const code = (src) => src.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);

// P2-S4 (membership management) adds its own delta on top of S3; it is reversed first so this guard still proves the S3 delta exactly.
const S4_EDITS = [
  [`import { createOrganizationAdminScreen, createOrganizationWriter } from "./organization-admin-view.mjs?v=20261004-p2s4";
import { createOrganizationMembershipSection, createMembershipWriter, createActiveTeacherPickerQuery } from "./organization-membership-view.mjs?v=20261004-p2s4";`, `import { createOrganizationAdminScreen, createOrganizationWriter } from "./organization-admin-view.mjs?v=20261003-p2s3";`],
  [`
const ORGANIZATION_TEACHER_PICKER=createActiveTeacherPickerQuery({collection,query,where,orderBy,limit,startAfter,getDocs});`, ""],
  [`,
    // P2-S4: ordinary membership management inside Organization Detail (Platform Admin only; no Organization Admin / capability work).
    membershipSection:createOrganizationMembershipSection({
      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
      queries:ORGANIZATION_QUERIES, picker:ORGANIZATION_TEACHER_PICKER, contract:ORGANIZATION_CONTRACT,
      writer:createMembershipWriter({collection,doc,writeBatch,updateDoc})
    })`, ""]
];
test("index.html delta versus the S2 baseline is EXACTLY the five wiring edits plus the S4 delta (reverse them and the S2 baseline hash returns)", () => {
  const edits = [
    ["startAfter, documentId, onSnapshot, serverTimestamp,", "startAfter, onSnapshot, serverTimestamp,"],
    [`import { createOrganizationQueries, createPlatformAdminOrganizationQueries } from "./organization-queries.mjs?v=20261003-p2s3";
import { createOrganizationWriteContract } from "./organization-write-contract.mjs?v=20261003-p2s3";
import { getAdminFeature } from "./admin-feature-registry.mjs?v=20261003-p2s3";
import { createOrganizationAdminScreen, createOrganizationWriter } from "./organization-admin-view.mjs?v=20261003-p2s3";
`, ""],
    [`  {key:getAdminFeature("organizations").routeKey, label:"Đơn vị", icon:"🏢"},
`, ""],
    [`  if(key==="organizations") return adminOrganizations(c);
`, ""],
    [`// Library V2 P2-S3: Platform Admin organization lifecycle screen (list / create / rename / archive / restore). Reads and writes go
// through the S2 query and write contracts; no membership, capability or context logic lives here.
const ORGANIZATION_QUERIES=createOrganizationQueries({collection,doc,query,where,orderBy,limit,startAfter,documentId,getDocs,getDoc});
const ORGANIZATION_PLATFORM_QUERIES=createPlatformAdminOrganizationQueries({collection,query,orderBy,limit,getDocs});
const ORGANIZATION_CONTRACT=createOrganizationWriteContract({serverTimestamp});
function adminOrganizations(c){
  return createOrganizationAdminScreen({
    db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
    esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
    queries:ORGANIZATION_QUERIES, platformQueries:ORGANIZATION_PLATFORM_QUERIES, contract:ORGANIZATION_CONTRACT,
    writer:createOrganizationWriter({collection,doc,setDoc,updateDoc})
  }).mount(c);
}
`, ""]
  ];
  let restored = html;
  for (const [added, original] of S4_EDITS) {
    let hit = restored.split(added).length - 1, a = added, o = original;
    if (hit !== 1) { a = added.split(NL).join(CRLF); o = original.split(NL).join(CRLF); hit = restored.split(a).length - 1; }
    assert.equal(hit, 1, "S4 wiring edit present exactly once: " + added.slice(0, 60));
    restored = restored.replace(a, () => o);
  }
  assert.equal(createHash("sha256").update(restored, "utf8").digest("hex"), "62077a34d9ec70061c874e58bebcf31a091626720f53166e30d260274948e2e4", "S3 index.html restored");
  for (const [added, original] of edits) {
    // the file mixes LF and CRLF lines: try the text as written, then with CRLF line endings
    let hit = restored.split(added).length - 1;
    let a = added, o = original;
    if (hit !== 1) { a = added.split(NL).join(CRLF); o = original.split(NL).join(CRLF); hit = restored.split(a).length - 1; }
    assert.equal(hit, 1, "wiring edit present exactly once: " + added.slice(0, 60));
    restored = restored.replace(a, () => o);
  }
  assert.equal(createHash("sha256").update(restored, "utf8").digest("hex"), "4315bf598e52067983b4865e5f2ccf70c4d097d80a61286322f8fdf1a042c90d");
});

test("existing navigation preserved: the eleven original Admin menu entries keep their order; TEACHER_MENU and the P1 hub registry are untouched", () => {
  const menu = html.slice(html.indexOf("const ADMIN_MENU = ["), html.indexOf("];", html.indexOf("const ADMIN_MENU = [")));
  const keys = [...menu.matchAll(/\{key:("[a-zA-Z]+"|getAdminFeature\("organizations"\)\.routeKey)/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['"overview"', '"knowledge"', '"teachers"', 'getAdminFeature("organizations").routeKey', '"classes"', '"sessions"', '"qrlinks"', '"groups"', '"library"', '"audit"', '"stats"', '"settings"']);
  const teacher = html.slice(html.indexOf("const TEACHER_MENU = ["), html.indexOf("];", html.indexOf("const TEACHER_MENU = [")));
  assert.equal(createHash("sha256").update(teacher).digest("hex"), "3bff38d3c4cdadc2c370985252e7909c256905d0973356e7d605892a2e9f46d8");
  assert.ok(teacher.includes('{key:"library", label:"THƯ VIỆN", icon:"📚"}') && !teacher.includes("Đơn vị"));
  assert.equal(sha("library-hub-registry.mjs"), "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0");
});

test("view module: UI only - no Firebase import, no payload construction, no collection/membership/capability logic", () => {
  const src = code(view);
  const imports = [...src.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((x) => x[1]);
  assert.deepEqual(imports, ["./organization-write-contract.mjs"]);
  for (const token of ["firebase", "serverTimestamp", "schemaVersion", "createdAt:", "updatedAt:", "archivedAt:", "archivedBy:", "createdBy:", "status:", "where(", "getDocs", "getDoc(", "writeBatch", "onSnapshot", "runTransaction", "organizationMembers", "userCapabilities", "orgRole", "caps", "fetch(", "localStorage", "import("]) {
    assert.ok(!src.includes(token), "view module must not contain " + token);
  }
  assert.ok(!/["']users["']/.test(src), "no users collection");
  const writer = src.slice(src.indexOf("export function createOrganizationWriter"), src.indexOf("// ---------------------------------------------------------------- screen controller"));
  assert.equal((writer.match(/"organizations"/g) || []).length, 3, "the collection is named only inside the thin writer");
  assert.equal((src.match(/"organizations"/g) || []).length, 3);
});

test("the screen is wired only through the S2 contracts and is Platform-Admin-gated", () => {
  assert.ok(html.includes('isPlatformAdmin:STATE.profile?.role==="admin"'));
  assert.ok(view.includes("if (!isPlatformAdmin)") && view.includes("Chỉ quản trị viên hệ thống"));
  for (const used of ["contract.buildNewOrganization", "contract.buildOrganizationRename", "contract.buildOrganizationArchive", "contract.buildOrganizationRestore", "platformQueries.listAllOrganizationsAsPlatformAdminOnly", "queries.organizationById"]) assert.ok(view.includes(used), used);
  assert.equal([...view.matchAll(/contract\.build[A-Za-z]+/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i).sort().join(","), "contract.buildNewOrganization,contract.buildOrganizationArchive,contract.buildOrganizationRename,contract.buildOrganizationRestore", "only the four organization-lifecycle builders are used (no membership/capability builders)");
  assert.ok(!view.includes("buildNewMembership") && !view.includes("buildNewCapability") && !view.includes("buildMembership"));
  assert.ok(view.includes('logAudit("organization.create"') && view.includes('logAudit("organization.rename"'));
});

test("no new dynamic import(), no new collection in index.html, no membership/capability references; Rules, indexes, Storage, package, vendor byte-pinned", () => {
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
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88"
  };
  for (const [file, hash] of Object.entries(pinned)) if (hash) assert.equal(sha(file), hash, file);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const mjs = readdirSync(new URL("./", root)).filter((f) => f.startsWith("organization-") || f.startsWith("admin-")).sort();
  assert.deepEqual(mjs, ["admin-feature-registry.mjs", "organization-admin-view.mjs", "organization-context.mjs", "organization-membership-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs"]);
});
