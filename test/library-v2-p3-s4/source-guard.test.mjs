// LIBRARY V2 P3-S4 - source/version/index guards (pure). Edits to files owned by earlier slices are exactly the approved ones (reversal restores the P3-S3 candidate bytes
// c95595a / the P3-S2 model bytes); nothing else changed. Run: node --test test/library-v2-p3-s4/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseP4S4IndexEdits } from "../library-v2-p4-s4/p4s4-edits.mjs";   // P4-S4 aligned: index.html is read with the P4-S4 edits reversed, so every assertion below keeps describing the bytes of its own slice
import { reverseS4ModelEdits, reverseS4SectionViewEdits, reverseS4AdminViewEdits, MODEL_EDITS, SECTION_VIEW_EDITS, ADMIN_VIEW_EDITS_S4 } from "./s4-edits.mjs";
import { reverseP4S3OrgViewEdits } from "../library-v2-p4-s3/p4s3-edits.mjs";   // P4-S3 aligned: the S4 organization-admin-view assertions describe the S4 bytes, i.e. with the P4-S3 edits reversed

const root = new URL("../../", import.meta.url);
const text = (p) => (p === "index.html" ? reverseP4S4IndexEdits(readFileSync(new URL(p, root), "utf8")) : readFileSync(new URL(p, root), "utf8"));
const sha = (p) => createHash("sha256").update(p === "index.html" ? Buffer.from(reverseP4S4IndexEdits(readFileSync(new URL(p, root), "utf8")), "utf8") : readFileSync(new URL(p, root))).digest("hex");
const shaText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const count = (src, token) => src.split(token).length - 1;

test("S4.0 edits to the closed P3-S2 model are ADDITIVE only: reversing them restores the P3-S2 bytes (80e992e7...); codeInUse stays and delegates", () => {
  assert.equal(shaText(reverseS4ModelEdits(text("curriculum-model.mjs"))), "80e992e7de69d73f9d470dfa95b001020179adf8efe115e0f82df62c81506471");
  assert.equal(MODEL_EDITS.length, 1);
  const model = text("curriculum-model.mjs");
  assert.equal(count(model, "export function codeConflictOf("), 1); assert.equal(count(model, "export function codeInUse("), 1);
  assert.ok(model.includes("return codeConflictOf(nodes, code, exceptId) !== null;"));
  assert.equal(count(model, "canonicalizeNodeCode("), 4, "definition + validateTree + codeConflictOf (2: guard + compare); no second canonicalization anywhere");
  for (const f of ["curriculum-queries.mjs", "curriculum-write-contract.mjs"]) assert.equal(sha(f), { "curriculum-queries.mjs": "969f6bd5682388510035ef574f9454588f353a187d629cb93775e9cc42af2769", "curriculum-write-contract.mjs": "efc9aef867a3127a8aca766f6ddac13518610ac08202f6e3dfdbf0157211b32d" }[f], f);
});
test("S4.0 seam edits to the P3-S3 section view are exactly the approved ones (reversal restores c95595a); without options the S3 behavior is unchanged", () => {
  const view = text("curriculum-admin-view.mjs");
  const s3 = reverseS4SectionViewEdits(view);
  assert.notEqual(s3, view); assert.equal(SECTION_VIEW_EDITS.length, 4);
  assert.ok(s3.includes("const canOpen = typeof onOpenFramework === \"function\";") && s3.includes("async function mount(host, organization) {"));
  assert.ok(view.includes("async function mount(host, organization, options = {}) {") && view.includes("typeof options.onOpenFramework === \"function\" ? options.onOpenFramework : onOpenFramework"));
  assert.equal(count(view, "openHook(framework, org)"), 1); assert.ok(!view.includes("onOpenFramework(framework, org)"));
  // the view still imports nothing and still has exactly one restoreFocus contract
  assert.equal(count(view, "\nimport "), 0); assert.equal(count(view, "function restoreFocus()"), 1);
});
test("S4.0 edits to organization-admin-view are exactly the approved ones: optional frameworkEditor dependency, showDetail focus option, curriculum mount options, showFrameworkEditor", () => {
  const current = text("organization-admin-view.mjs");
  const admin = reverseP4S3OrgViewEdits(current);   // the S4 bytes
  assert.equal(ADMIN_VIEW_EDITS_S4.length, 5);
  assert.notEqual(reverseS4AdminViewEdits(current), admin);
  assert.equal(count(admin, "function showFrameworkEditor(framework, organization) {"), 1);
  assert.equal(count(admin, "frameworkEditor.mount(container, { organization, framework, onBack:"), 1);
  assert.ok(admin.includes("async function showDetail(id, { focusFrameworkId } = {}) {"));
  assert.ok(admin.includes("...(frameworkEditor ? { onOpenFramework:"), "without a frameworkEditor dependency no Open control can appear (S3 behavior)");
  assert.ok(!admin.includes("curriculum-") && !admin.includes("buildFramework") && !admin.includes("buildNode"), "the admin view stays free of curriculum domain logic");
});

// ================================================================ S4.1 / S4.2: the editor module, the wiring and the unchanged-everything-else guarantees
import { reverseS4IndexEdits, INDEX_EDITS_S4, INDEX_ADDED_S4 } from "./s4-edits.mjs";
import { reverseS5IndexEdits } from "../library-v2-p3-s5/s5-edits.mjs";   // P3-S5 aligned: the S4 wiring assertions describe the S4 candidate bytes, i.e. with the S5 index edits reversed
import { existsSync, readdirSync } from "node:fs";
const NL = String.fromCharCode(10);
const code = (p) => text(p).split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
const editor = code("curriculum-editor-view.mjs");
const namesOf = (re, src = editor) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();

test("the editor imports NOTHING and calls no Firestore function except through its transport-only writer (setDoc/updateDoc/writeBatch live only inside createCurriculumNodeWriter)", () => {
  assert.equal(count(editor, NL + "import "), 0); assert.ok(!/^import /.test(editor));
  for (const token of ["from \"firebase", "import(", "require(", "getDocs(", "getDoc(", "addDoc(", "deleteDoc(", "runTransaction", "onSnapshot", "serverTimestamp", "orderBy", "startAfter", "collectionGroup", "documentId", "query(", "where(", "limit("]) assert.ok(!editor.includes(token), "must not contain " + token);
  assert.equal(count(editor, "setDoc("), 1); assert.equal(count(editor, "updateDoc("), 1); assert.equal(count(editor, "writeBatch("), 1); assert.equal(count(editor, "batch.update("), 1); assert.equal(count(editor, "batch.commit()"), 1);
  assert.equal(count(editor, "\"curriculumFrameworks\""), 2, "the collection is named only by the writer (nodes/ref helpers)"); assert.equal(count(editor, "\"nodes\""), 2);
  const start = editor.indexOf("export function createCurriculumNodeWriter"), end = editor.indexOf("class FlowAbort");
  const writerBlock = editor.slice(start, end), rest = editor.slice(0, start) + editor.slice(end);
  for (const token of ["setDoc(", "updateDoc(", "writeBatch(", "\"curriculumFrameworks\""]) assert.ok(writerBlock.includes(token) && !rest.includes(token), token + " only inside the writer");
  assert.equal(count(rest, "writer."), count(rest, "writer.create(") + count(rest, "writer.update(") + count(rest, "writer.updateMany(") + count(rest, "writer.newId("));
});
test("no domain logic or payload is duplicated in the editor: no readiness/tree/canonicalization/planning/conflict logic, no Firestore payload keys, no excluded feature", () => {
  for (const token of ["function activationReadiness", "function validateTree", "function frameworkAvailability", "function canonicalize", "function buildTree", "function planSiblingMove", "function codeConflictOf", "function codeInUse", "function nextSiblingOrder", "toLowerCase", "toUpperCase", "normalize("]) assert.ok(!editor.includes(token), token);
  for (const token of ["schemaVersion", "createdBy", "statusChangedAt", "statusChangedBy", "createdAt:", "updatedAt:", "activatedAt:", "ancestors:", "scope:"]) assert.ok(!editor.includes(token), "payload key leaked: " + token);
  for (const token of ["buildFramework", "buildClone", "planClone", "planDeleteDraft", "buildNodeRename", "buildNodeCodeChange", "userCapabilities", "organizationMembers", "importBatches", "xlsx", "XLSX", "organization-context", "deleteDoc", "data-ed-action=\"delete\"", "draggable", "ondrag", "ondrop", "dragstart", "reparent", "re-parent", "KÍCH HOẠT", "buildFrameworkActivate"]) assert.ok(!editor.includes(token), "excluded feature: " + token);
  assert.ok(!/>\s*Xóa|XÓA/.test(editor), "retire is never presented as a delete");
});
test("P3-S2 API consumption is exactly the approved set (model, queries, contract, writer, Organization read, S3 helper instance)", () => {
  assert.deepEqual(namesOf(/model\.([A-Za-z_]+)/g), ["activationReadiness", "buildTree", "codeConflictOf", "frameworkAvailability", "normalizeNodeCode", "planSiblingMove", "sortedSiblings", "uiKindForParent", "validateNodeName"]);
  const helperDestructure = (editor.match(/const \{ ([^}]+) \} = model;/) || [])[1].split(",").map((s) => s.trim()).sort();
  assert.deepEqual(helperDestructure, ["CURRICULUM_MAX_NODES", "NODE_CODE_MAX", "NODE_NAME_MAX", "NODE_NAME_MIN", "NODE_WRITE_CHUNK", "buildTree", "canAddChild", "frameworkAvailability", "millisOf", "sortedSiblings", "uiKindForParent"]);
  assert.deepEqual(namesOf(/queries\.([A-Za-z]+)\(/g), ["frameworkById", "nodesOfFramework"]);
  assert.deepEqual(namesOf(/contract\.([A-Za-z]+)\(/g), ["buildNodeCreate", "buildNodeReorder", "buildNodeRestore", "buildNodeRetire", "buildNodeUpdate"]);
  assert.deepEqual(namesOf(/organizationQueries\.([A-Za-z]+)\(/g), ["organizationById"]);
  assert.deepEqual(namesOf(/writer\.([A-Za-z]+)\(/g), ["create", "newId", "update", "updateMany"]);
  assert.deepEqual(namesOf(/viewHelpers\.([A-Za-z]+)/g), ["MESSAGES", "classifyFirebaseError", "describeReadiness", "frameworkStatusView"]);
  assert.equal(count(editor, "model.codeConflictOf("), 2, "create and edit use the model's canonical conflict policy (plus the factory check), never a copy");
});
test("every mutation goes through the exclusive busy section and starts from a fresh read (readFresh); no optimistic UI, no auto-retry, no transaction; one focus-restoration contract", () => {
  const body = editor.slice(editor.indexOf("export function createCurriculumEditor("));
  assert.equal(count(body, "await readFresh("), 5, "create, edit, retire/restore, reorder, plus the permission diagnosis");
  assert.equal(count(body, "exclusive(async () =>"), 5, "create submit, edit submit, retire confirm, restore, reorder");
  for (const token of ["setInterval", "retry(", "runTransaction", "optimistic"]) assert.ok(!body.includes(token), token);
  assert.equal(count(body, "await writer.create("), 1); assert.equal(count(body, "await writer.update("), 2); assert.equal(count(body, "await writer.updateMany("), 1);
  assert.equal(count(body, "function restoreFocus()"), 1); assert.equal(count(body, "function dialogClose()"), 1);
});
test("S4 edits to released/S3 files are EXACTLY the approved ones: reversal restores the P3-S3 candidate bytes c95595a (index.html 8880A558..., organization-admin-view 856E9DFA..., curriculum-admin-view 69A5A5A4..., curriculum-model 80E992E7...)", () => {
  assert.equal(shaText(reverseS4IndexEdits(text("index.html"))), "8880a558890390c185ee156a07192287e4006a7ae04d871df40d762eb3bef4a8");
  assert.equal(shaText(reverseS4AdminViewEdits(text("organization-admin-view.mjs"))), "856e9dfa0858252f61b46d3c7a7a3a5500756c866885bceb072295f85309c9a5");
  assert.equal(shaText(reverseS4SectionViewEdits(text("curriculum-admin-view.mjs"))), "69a5a5a446b7afdc2eaaacdb8c36d1a331a9a9db10aba7b459d7d099888354ab");
  assert.equal(shaText(reverseS4ModelEdits(text("curriculum-model.mjs"))), "80e992e7de69d73f9d470dfa95b001020179adf8efe115e0f82df62c81506471");
  assert.equal(INDEX_EDITS_S4.length, 2);
});
test("index.html wiring: model/view/editor imported with the S4 cache token (queries/contract keep the S2 token), ONE frameworkEditor dependency after curriculumSection, NO construction-time onOpenFramework hook, no new menu entry, no route", () => {
  const html = reverseS5IndexEdits(text("index.html"));
  for (const block of Object.values(INDEX_ADDED_S4)) assert.equal(count(html, block), 1);
  assert.ok(html.includes("import * as CURRICULUM_MODEL from \"./curriculum-model.mjs?v=20261007-p3s4\";"));
  assert.ok(html.includes("from \"./curriculum-queries.mjs?v=20261007-p3s2\"") && html.includes("from \"./curriculum-write-contract.mjs?v=20261007-p3s2\""));
  assert.ok(html.includes("from \"./curriculum-admin-view.mjs?v=20261007-p3s4\"") && html.includes("from \"./curriculum-editor-view.mjs?v=20261007-p3s4\""));
  assert.equal(count(html, "frameworkEditor:createCurriculumEditor({"), 1); assert.equal(count(html, "curriculumSection:createCurriculumSection({"), 1);
  assert.ok(html.indexOf("curriculumSection:createCurriculumSection({") < html.indexOf("frameworkEditor:createCurriculumEditor({") && html.indexOf("frameworkEditor:createCurriculumEditor({") < html.indexOf("membershipSection:createOrganizationMembershipSection({"));
  assert.ok(!/onOpenFrameworks*[:,=(]/.test(html), "the screen supplies the hook through frameworkEditor; index.html passes none");
  assert.equal(count(html, "{key:getAdminFeature(\"organizations\").routeKey, label:\"Đơn vị\", icon:\"🏢\"}"), 1); assert.equal(count(html, "const ADMIN_MENU = ["), 1);
  assert.deepEqual([...html.matchAll(/\{key:"([a-z]+)"/g)].map((m) => m[1]).filter((k) => /curric|chuong|framework|node/i.test(k)), []);
  assert.ok(existsSync(new URL("curriculum-editor-view.mjs", root)));
  const block = html.slice(html.indexOf("frameworkEditor:createCurriculumEditor({"), html.indexOf("membershipSection:createOrganizationMembershipSection({"));
  assert.ok(block.includes("createCurriculumNodeWriter({collection,doc,setDoc,updateDoc,writeBatch})"));
});
test("ZERO-INDEX guard and identity: Rules (deployed P3-S1), firestore.indexes.json, repo firestore.rules, package, Storage and the unchanged P3-S2 modules are byte-identical; only the approved root modules exist", () => {
  const pinned = {
    "firestore.rules.production-candidate": "f6b9de012c7f7d3d0fce6efc19d760b3b2e0bca9c9979811786ede93c9b17d4a",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
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
  for (const [f, h] of Object.entries(pinned)) assert.equal(sha(f), h, f);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  assert.equal(JSON.parse(text("firestore.indexes.json")).indexes.length, 14);
  assert.ok(!code("curriculum-queries.mjs").includes("orderBy")); assert.ok(!editor.includes("orderBy"));
  const rootMjs = readdirSync(new URL("./", root)).filter((f) => f.endsWith(".mjs") && f.startsWith("curriculum-")).sort();
  assert.deepEqual(rootMjs, ["curriculum-admin-view.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs", "curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs"]);
});
test("harness and e2e fixtures are test-only: nothing under test/ is referenced by index.html or the production modules", () => {
  const html = text("index.html");
  assert.ok(!html.includes("editor-harness") && !html.includes("test/library-v2-p3-s4") && !editor.includes("harness"));
});
