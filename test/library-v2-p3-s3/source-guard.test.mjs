// LIBRARY V2 P3-S3 - source/version/index guards (pure). The curriculum section stays an injected, UI-only view of the P3-S2 APIs; the edits to released files are exactly
// the approved ones; Rules, indexes, Storage, the P3-S2 modules and every other released file are byte-identical. Run: node --test test/library-v2-p3-s3/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseS3IndexEdits, reverseS3AdminViewEdits, INDEX_EDITS, ADMIN_VIEW_EDITS, INDEX_ADDED } from "./s3-edits.mjs";
import { reverseS4SectionViewEdits, reverseS4ModelEdits, reverseS4IndexEdits } from "../library-v2-p3-s4/s4-edits.mjs";   // P3-S4 aligned: every assertion below describes the P3-S3 candidate bytes (c95595a), i.e. with the approved S4 edits reversed first

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const shaText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const NL = String.fromCharCode(10);
const code = (p) => text(p).split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
const codeOf = (src) => src.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
const view = codeOf(reverseS4SectionViewEdits(text("curriculum-admin-view.mjs")));
const count = (src, token) => src.split(token).length - 1;

test("the view imports NOTHING: no import statements, no Firebase, no dynamic import, no direct Firestore reads/writes/ordering (only the transport-only writer touches setDoc/updateDoc)", () => {
  assert.equal(count(view, NL + "import "), 0); assert.ok(!/^import /.test(view));
  for (const token of ["from \"firebase", "import(", "require(", "getDocs(", "getDoc(", "addDoc(", "deleteDoc(", "writeBatch", "runTransaction", "onSnapshot", "serverTimestamp", "orderBy", "startAfter", "collectionGroup", "documentId", "query("]) assert.ok(!view.includes(token), "must not contain " + token);
  assert.equal(count(view, "setDoc("), 1); assert.equal(count(view, "updateDoc("), 1);       // both inside createCurriculumWriter
  assert.equal(count(view, "\"curriculumFrameworks\""), 3, "collection named only by the writer (newId/create/update)"); assert.ok(!view.includes("\"nodes\""));
});
test("no domain logic or payload is duplicated in the view: it never defines readiness/tree/canonicalization/availability, never builds a Firestore payload, never touches nodes", () => {
  for (const token of ["function activationReadiness", "function validateTree", "function frameworkAvailability", "function canonicalize", "function buildTree", "isNeverActivated", "FRAMEWORK_TRANSITIONS"]) assert.ok(!view.includes(token), token);
  for (const token of ["schemaVersion", "createdBy", "statusChangedAt", "statusChangedBy", "createdAt:", "updatedAt:", "activatedAt:", "scope:"]) assert.ok(!view.includes(token), "payload key leaked: " + token);
  for (const token of ["buildNode", "planClone", "planDeleteDraft", "planSiblingMove", "canonicalizeNodeCode", "userCapabilities", "organizationMembers", "importBatches", "xlsx", "XLSX", "STATE.", "organization-context", "mapKeys", "deleteDoc", "data-fw-action=\"delete\"", "Sắp có", "Xóa"]) assert.ok(!view.includes(token), "excluded feature: " + token);
});
test("focus restoration is ONE contract: every dismissal path (Cancel, Escape, close after success, backdrop click) goes through restoreFocus; the shared openModal is not modified", () => {
  assert.equal(count(view, "function restoreFocus()"), 1); assert.equal(count(view, "restoreFocus();"), 2, "dialogClose and the backdrop listener");
  assert.equal(count(view, "querySelector(\"#modalBackdrop\")"), 1); assert.ok(view.includes("if (event.target === backdrop) restoreFocus();"));
  // openModal/closeModal in index.html stay untouched: the reversal test above proves index.html differs from the baseline ONLY by the three approved edits
});
test("P3-S2 API consumption is exactly the approved set (model, queries, contract); every write goes through contract builders; nothing else is called", () => {
  const modelFns = new Set([...view.matchAll(/model\.([A-Za-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...modelFns].sort(), ["activationReadiness", "frameworkAvailability"]);   // used by the factory guard and the activation gate
  const destructured = (view.match(/const \{ ([^}]+) \} = model;/) || [])[1].split(",").map((s) => s.trim()).sort();
  assert.deepEqual(destructured, ["FRAMEWORK_LIST_LIMIT", "FRAMEWORK_LIST_STATUS_ORDER", "FRAMEWORK_NAME_MAX", "FRAMEWORK_NAME_MIN", "frameworkAvailability", "millisOf", "validateFrameworkName"]);
  assert.deepEqual([...new Set([...view.matchAll(/queries\.([A-Za-z]+)\(/g)].map((m) => m[1]))].sort(), ["frameworkById", "frameworksOfOrganization", "nodesOfFramework"]);
  assert.deepEqual([...new Set([...view.matchAll(/contract\.([A-Za-z]+)\(/g)].map((m) => m[1]))].sort(), ["buildFrameworkActivate", "buildFrameworkArchive", "buildFrameworkCreate", "buildFrameworkRename", "buildFrameworkRestore"]);
  assert.deepEqual([...new Set([...view.matchAll(/organizationQueries\.([A-Za-z]+)\(/g)].map((m) => m[1]))], ["organizationById"]);
  assert.deepEqual([...new Set([...view.matchAll(/writer\.([A-Za-z]+)\(/g)].map((m) => m[1]))].sort(), ["create", "newId", "update"]);
  assert.ok(view.includes("onOpenFramework") && view.includes("const canOpen = typeof onOpenFramework === \"function\";"));   // the S4 boundary is a hook, nothing else
});

test("edits to released files are EXACTLY the approved ones: reversing them restores the ec67a9c bytes (index.html B7A46DC0..., organization-admin-view 7F7F5350...)", () => {
  assert.equal(shaText(reverseS3IndexEdits(text("index.html"))), "b7a46dc0a222c5c64ceb6b72c8de42652b80e3b8663391772366042be40be63e");
  assert.equal(shaText(reverseS3AdminViewEdits(text("organization-admin-view.mjs"))), "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f");
  assert.equal(INDEX_EDITS.length, 3); assert.equal(ADMIN_VIEW_EDITS.length, 4);
  assert.notEqual(sha("index.html"), "b7a46dc0a222c5c64ceb6b72c8de42652b80e3b8663391772366042be40be63e"); assert.notEqual(sha("organization-admin-view.mjs"), "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f");
});
test("index.html wiring: versioned imports (queries/contract p3s2, view p3s3; model deliberately bare = one instance), one curriculumSection dependency, NO onOpenFramework hook, no new top-level menu entry, no Open destination", () => {
  const html = reverseS4IndexEdits(text("index.html"));   // P3-S4 aligned: the P3-S3 candidate wiring (the S4 additions are guarded by test/library-v2-p3-s4)
  for (const block of Object.values(INDEX_ADDED)) assert.equal(count(html, block), 1);
  assert.ok(html.includes("import * as CURRICULUM_MODEL from \"./curriculum-model.mjs\";"));
  assert.ok(html.includes("from \"./curriculum-queries.mjs?v=20261007-p3s2\"") && html.includes("from \"./curriculum-write-contract.mjs?v=20261007-p3s2\"") && html.includes("from \"./curriculum-admin-view.mjs?v=20261007-p3s3\""));
  assert.equal(count(html, "curriculumSection:createCurriculumSection({"), 1); assert.ok(!/onOpenFrameworks*[:,=(]/.test(html), "no hook is passed (only a comment may mention it)"); assert.ok(!html.includes("frameworkEditor"));
  assert.ok(html.indexOf("curriculumSection:createCurriculumSection({") < html.indexOf("membershipSection:createOrganizationMembershipSection({"), "curriculum dependency is declared above the membership one");
  assert.equal(count(html, "{key:getAdminFeature(\"organizations\").routeKey, label:\"Đơn vị\", icon:\"🏢\"}"), 1); assert.equal(count(html, "const ADMIN_MENU = ["), 1);
  assert.deepEqual([...html.matchAll(/\{key:"([a-z]+)"/g)].map((m) => m[1]).filter((k) => /curric|chuong|framework/i.test(k)), []);
  for (const f of ["curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs", "curriculum-admin-view.mjs"]) assert.ok(existsSync(new URL(f, root)), f);
  const admin = text("organization-admin-view.mjs");
  assert.ok(admin.indexOf("id=\"orgCurriculumSection\"") > -1 && admin.indexOf("id=\"orgCurriculumSection\"") < admin.indexOf("id=\"orgMembersSection\""), "host above the members host");
  assert.equal(count(admin, "await Promise.allSettled(mounts);"), 1); assert.ok(!admin.includes("curriculum-") && !admin.includes("buildFramework"), "the admin view only gained the optional hook");
});
test("ZERO-INDEX guard and identity: Rules (deployed P3-S1), firestore.indexes.json, repo firestore.rules, package, Storage, the three P3-S2 modules and every other released file are byte-identical; no ordering anywhere in the curriculum read path", () => {
  const pinned = {
    "firestore.rules.production-candidate": "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "curriculum-model.mjs": "80e992e7de69d73f9d470dfa95b001020179adf8efe115e0f82df62c81506471",
    "curriculum-queries.mjs": "969f6bd5682388510035ef574f9454588f353a187d629cb93775e9cc42af2769",
    "curriculum-write-contract.mjs": "efc9aef867a3127a8aca766f6ddac13518610ac08202f6e3dfdbf0157211b32d",
    "organization-membership-view.mjs": "d1347229b6b06e1cb1d09fba130045b2e4c54a2c91c5996dc9bf2cd736aed1ea",
    "teacher-organization-enrollment.mjs": "75d6c6afaf657f118408c9182faecd560d259ac5d97eb796695bd9b88023653e",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0"
  };
  for (const [f, h] of Object.entries(pinned)) assert.equal(f === "curriculum-model.mjs" ? shaText(reverseS4ModelEdits(text(f))) : sha(f), h, f);   // the model: P3-S4 added codeConflictOf only (guarded by test/library-v2-p3-s4)
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const manifest = JSON.parse(text("firestore.indexes.json")); assert.equal(manifest.indexes.length, 14);          // untouched, drifted manifest is never deployed
  assert.ok(!code("curriculum-queries.mjs").includes("orderBy")); assert.ok(!view.includes("orderBy"));
  const rootMjs = readdirSync(new URL("./", root)).filter((f) => f.endsWith(".mjs") && f.startsWith("curriculum-") && f !== "curriculum-editor-view.mjs" && f !== "curriculum-clone-delete.mjs").sort();   // P3-S4 aligned: the node editor view is guarded by test/library-v2-p3-s4
  assert.deepEqual(rootMjs, ["curriculum-admin-view.mjs", "curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs"]);
});
test("harness and e2e fixtures are test-only: nothing under test/ is referenced by index.html or the production modules", () => {
  const html = reverseS4IndexEdits(text("index.html"));
  assert.ok(!html.includes("harness.html") && !html.includes("test/library-v2-p3-s3"));
  assert.ok(!view.includes("harness"));
});
