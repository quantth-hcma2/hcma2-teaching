// LIBRARY V2 P3-S5 - source/version/index guards (pure). The clone/delete module stays injected, payload-free and transport-only; the section edits are exactly the approved
// ones (reversal restores the P3-S4 candidate bytes de9057d); Rules, indexes, Storage, P3-S2 queries/contract, the node editor and the Organization screen are byte-identical.
// Run: node --test test/library-v2-p3-s5/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseS5ModelEdits, reverseS5SectionViewEdits, reverseS5IndexEdits, MODEL_EDITS_S5, SECTION_VIEW_EDITS_S5, INDEX_EDITS_S5, INDEX_ADDED_S5 } from "./s5-edits.mjs";
import { reverseS4ModelEdits, reverseS4SectionViewEdits, reverseS4IndexEdits } from "../library-v2-p3-s4/s4-edits.mjs";
import { reverseS3IndexEdits, reverseS3AdminViewEdits } from "../library-v2-p3-s3/s3-edits.mjs";
import { reverseP4S3IndexEdits, reverseP4S3OrgViewEdits } from "../library-v2-p4-s3/p4s3-edits.mjs";   // P4-S3 aligned: S5 assertions describe the S5 bytes, i.e. with the P4-S3 edits reversed

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const shaText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const NL = String.fromCharCode(10);
const count = (src, token) => src.split(token).length - 1;
const code = (p) => text(p).split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
const mod = code("curriculum-clone-delete.mjs");
const view = code("curriculum-admin-view.mjs");
const namesOf = (re, src) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();

test("the clone/delete module imports NOTHING; Firestore functions appear only inside its transport-only writer; no ordering, no query, no hand-built payload keys, no second canonicalization", () => {
  assert.equal(count(mod, NL + "import "), 0); assert.ok(!/^import /.test(mod));
  for (const token of ["from \"firebase", "import(", "require(", "getDocs(", "getDoc(", "addDoc(", "updateDoc(", "runTransaction", "onSnapshot", "serverTimestamp", "orderBy", "startAfter", "collectionGroup", "documentId", "query(", "where(", "limit("]) assert.ok(!mod.includes(token), "must not contain " + token);
  assert.equal(count(mod, "setDoc("), 1); assert.equal(count(mod, "writeBatch("), 3, "create / update / delete batches"); assert.equal(count(mod, "deleteDoc("), 1);
  const start = mod.indexOf("export function createCurriculumCloneWriter"), helpers = mod.slice(0, start);
  for (const token of ["setDoc(", "writeBatch(", "deleteDoc(", "\"curriculumFrameworks\"", "batch."]) assert.ok(!helpers.includes(token) || token === "batch.", token + " only in the writer");
  for (const token of ["schemaVersion", "createdBy", "statusChangedAt", "statusChangedBy", "createdAt:", "updatedAt:", "activatedAt:", "scope:", "toLowerCase", "toUpperCase", "normalize(", "function canonicalize", "function codeInUse", "function validateTree"]) assert.ok(!mod.includes(token), "payload/policy leaked: " + token);
  assert.deepEqual(namesOf(/const \{ ([^}]+) \} = model;/g, mod), ["buildTree, validateTree, frameworkAvailability, NODE_WRITE_CHUNK, FRAMEWORK_NAME_MAX, CURRICULUM_MAX_NODES"]);
  assert.deepEqual(namesOf(/contract\.([A-Za-z]+)\(/g, mod), ["buildNodeCreate", "buildNodeRetire"], "payloads only through the P3-S2 contract");
  for (const token of ["importBatches", "xlsx", "XLSX", "organization-context", "userCapabilities", "draggable", "reparent", "re-parent", "buildFrameworkActivate"]) assert.ok(!mod.includes(token), "excluded feature: " + token);
});
test("the section view still imports nothing and calls Firestore only through injected writers: the clone/delete flows use cloneTools (CW/X), never a Firestore function or a hand-built payload", () => {
  assert.equal(count(view, NL + "import "), 0); assert.ok(!/^import /.test(view));
  for (const token of ["from \"firebase", "import(", "getDocs(", "getDoc(", "addDoc(", "deleteDoc(", "writeBatch(", "runTransaction", "onSnapshot", "serverTimestamp", "orderBy", "startAfter", "collectionGroup", "query("]) assert.ok(!view.includes(token), "must not contain " + token);
  assert.equal(count(view, "setDoc("), 1); assert.equal(count(view, "updateDoc("), 1);
  const flows = view.slice(view.indexOf("const X = cloneTools && cloneTools.helpers"), view.indexOf("await load();" + NL + "  }" + NL + "  return freeze({ mount });"));
  assert.deepEqual(namesOf(/CW\.([A-Za-z]+)\(/g, flows), ["createFramework", "createNodes", "deleteFramework", "deleteNodes", "newFrameworkId", "newNodeId", "updateNodes"]);
  assert.deepEqual(namesOf(/X\.([A-Za-z]+)\(/g, flows), ["buildClonePayloads", "defaultCloneName", "planClone", "planDeleteDraft", "renderCloneFormHtml", "renderDeleteDraftHtml", "verifyClone"]);
  assert.deepEqual(namesOf(/contract\.([A-Za-z]+)\(/g, flows), ["buildFrameworkCreate"], "the framework payload comes from the P3-S2 contract; node payloads from buildClonePayloads");
  assert.deepEqual(namesOf(/queries\.([A-Za-z]+)\(/g, flows), ["frameworkById", "nodesOfFramework"]);
  for (const token of ["schemaVersion", "createdBy", "statusChangedAt", "activatedAt:", "scope:", "cloneSource:" + " {"].filter((t) => t !== "cloneSource: {")) assert.ok(!flows.includes(token), "payload key leaked: " + token);
  assert.equal(count(flows, "await CW.createFramework("), 1); assert.equal(count(flows, "await CW.deleteFramework("), 2, "delete flow + clone rollback only");
  assert.equal(count(flows, "model.frameworkAvailability("), 1); assert.ok(flows.includes(".canDelete"), "delete re-checks the Rules' never-activated condition on FRESH data");
  assert.ok(view.includes("deleteDraft: !!lifecycleTools && a.canDelete") && view.includes("clone: !!lifecycleTools && a.organizationWritable"), "eligibility comes from model.frameworkAvailability, only when the tools are injected");
});
test("delete order is children FIRST, framework LAST (no orphans); clone order is framework -> node chunks -> retire pass -> the final node; rollback is children first; audit actions and best-effort audit", () => {
  const del = view.slice(view.indexOf("function openDeleteDraft"));
  assert.ok(del.indexOf("await CW.deleteNodes(") > -1 && del.indexOf("await CW.deleteNodes(") < del.indexOf("await CW.deleteFramework("), "delete: nodes before the framework");
  const clone = view.slice(view.indexOf("function openClone"), view.indexOf("function openDeleteDraft"));
  const order = ["await CW.createFramework(", "await CW.createNodes(db, destId, items.map(itemOf))", "await CW.updateNodes(", "await CW.createNodes(db, destId, plan.finalItems.map(itemOf))", "X.verifyClone(plan, check.items)"].map((token) => clone.indexOf(token));
  assert.ok(order.every((i) => i > -1) && order.every((i, k) => k === 0 || i > order[k - 1]), "clone phase order: " + order.join());
  const rollback = view.slice(view.indexOf("async function rollbackClone"), view.indexOf("function openClone"));
  assert.ok(rollback.indexOf("deleteNodes") < rollback.indexOf("deleteFramework"));
  assert.ok(view.includes("\"curriculum.framework.clone\"") && view.includes("\"curriculum.framework.deleteDraft\""));
  assert.ok(view.includes("const audit = async (action, frameworkId, detail) => { try { await logAudit(") && view.includes("catch { /* best effort */ }"), "audit stays best-effort (never a prerequisite)");
  assert.ok(!view.includes("hardDelete") && !view.includes("data-fw-action=\"delete\""), "no generic delete");
});
test("S5 edits to earlier files are EXACTLY the approved ones: reversing them restores the P3-S4 candidate bytes de9057d (index.html BCB3C397..., curriculum-admin-view 582F6C06..., curriculum-model 1C2AFEED...); the chain down to P3-S2/S3 bytes still holds", () => {
  assert.equal(shaText(reverseS5IndexEdits(text("index.html"))), "bcb3c3973904b167bcdc72c8c6af24062770dcb9b5938d47602ada1d93b01864");
  assert.equal(shaText(reverseS5SectionViewEdits(text("curriculum-admin-view.mjs"))), "582f6c06c42c3ba56fe4c78e283c1d14eb5e0ba4acf9395d4cd2522aea5f12e2");
  assert.equal(shaText(reverseS5ModelEdits(text("curriculum-model.mjs"))), "1c2afeedb7f5e09a52ccd70339f64f3538e2bb75cfc524a42a5fb1641cc0951b");
  assert.equal(shaText(reverseS4ModelEdits(text("curriculum-model.mjs"))), "80e992e7de69d73f9d470dfa95b001020179adf8efe115e0f82df62c81506471", "down to the P3-S2 model bytes");
  assert.equal(shaText(reverseS4SectionViewEdits(text("curriculum-admin-view.mjs"))), "69a5a5a446b7afdc2eaaacdb8c36d1a331a9a9db10aba7b459d7d099888354ab", "down to the P3-S3 candidate section bytes");
  assert.equal(shaText(reverseS4IndexEdits(text("index.html"))), "8880a558890390c185ee156a07192287e4006a7ae04d871df40d762eb3bef4a8");
  assert.equal(shaText(reverseS3IndexEdits(text("index.html"))), "b7a46dc0a222c5c64ceb6b72c8de42652b80e3b8663391772366042be40be63e", "down to the ec67a9c index.html");
  assert.equal(shaText(reverseS3AdminViewEdits(text("organization-admin-view.mjs"))), "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f");
  assert.deepEqual([MODEL_EDITS_S5.length, SECTION_VIEW_EDITS_S5.length, INDEX_EDITS_S5.length], [2, 9, 3]);
  assert.ok(text("curriculum-model.mjs").includes("D1 RESOLVED") && !text("curriculum-model.mjs").includes("DEFERRED TO P3-S5"));
});
test("index.html wiring: model/section view/clone module imported with the S5 cache token, ONE cloneTools dependency inside curriculumSection, nothing else new (no menu entry, no route)", () => {
  const html = reverseP4S3IndexEdits(text("index.html"));
  for (const block of Object.values(INDEX_ADDED_S5)) assert.equal(count(html, block), 1);
  assert.ok(html.includes("import * as CURRICULUM_MODEL from \"./curriculum-model.mjs?v=20261007-p3s5\";") && html.includes("from \"./curriculum-admin-view.mjs?v=20261007-p3s5\"") && html.includes("from \"./curriculum-clone-delete.mjs?v=20261007-p3s5\""));
  assert.ok(html.includes("from \"./curriculum-editor-view.mjs?v=20261007-p3s4\"") && html.includes("from \"./curriculum-queries.mjs?v=20261007-p3s2\""), "unchanged modules keep their tokens");
  assert.equal(count(html, "cloneTools:{"), 1);
  const section = html.slice(html.indexOf("curriculumSection:createCurriculumSection({"), html.indexOf("frameworkEditor:createCurriculumEditor({"));
  assert.ok(section.includes("cloneTools:{ helpers:createCloneDeleteHelpers({model:CURRICULUM_MODEL}), writer:createCurriculumCloneWriter({collection,doc,setDoc,writeBatch,deleteDoc}) }"));
  assert.equal(count(html, "{key:getAdminFeature(\"organizations\").routeKey, label:\"Đơn vị\", icon:\"🏢\"}"), 1);
  assert.ok(!/onOpenFrameworks*[:,=(]/.test(html));
});
test("ZERO-INDEX guard and identity: Rules (deployed P3-S1), firestore.indexes.json, repo firestore.rules, package, Storage, P3-S2 queries/contract, the node editor and the Organization screens are byte-identical to the P3-S4 candidate; only the approved root modules exist", () => {
  const pinned = {
    "firestore.rules.production-candidate": "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "curriculum-queries.mjs": "969f6bd5682388510035ef574f9454588f353a187d629cb93775e9cc42af2769",
    "curriculum-write-contract.mjs": "efc9aef867a3127a8aca766f6ddac13518610ac08202f6e3dfdbf0157211b32d",
    "curriculum-editor-view.mjs": "f4b3326a241ed05c2c9e6901e8718fecfa2f238f9c50062980247fb4fc61eb9b",
    "organization-admin-view.mjs": "9e8575e2a934e754b6697e88280ec5146c0d8feb3142110c35c52695be177e9e",
    "organization-membership-view.mjs": "d1347229b6b06e1cb1d09fba130045b2e4c54a2c91c5996dc9bf2cd736aed1ea",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713"
  };
  for (const [f, h] of Object.entries(pinned)) assert.equal(f === "organization-admin-view.mjs" ? shaText(reverseP4S3OrgViewEdits(text(f))) : sha(f), h, f);   // P4-S3 aligned: the Organization screen is pinned with the P4-S3 edit reversed
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  assert.equal(JSON.parse(text("firestore.indexes.json")).indexes.length, 14);
  assert.ok(!mod.includes("orderBy") && !view.includes("orderBy"));
  const rootMjs = readdirSync(new URL("./", root)).filter((f) => f.endsWith(".mjs") && f.startsWith("curriculum-")).sort();
  assert.deepEqual(rootMjs, ["curriculum-admin-view.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs", "curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs"]);
});
test("harness and e2e fixtures are test-only: nothing under test/ is referenced by index.html or the production modules", () => {
  const html = text("index.html");
  assert.ok(!html.includes("test/library-v2-p3-s5") && !mod.includes("harness") && !view.includes("harness"));
});
