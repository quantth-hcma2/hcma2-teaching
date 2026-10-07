// Library V2 — P1 source guards: navigation-first scope lock. Pins that P1 changed only the hub navigation:
// V1 Library/wizard code is byte-identical to production 5c4effc, no new data model/Rules/indexes/Storage/vendor
// change, no new dynamic import(), and the hub itself performs no Firestore access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const NL = String.fromCharCode(10);
const html = read("index.html");
const registry = read("library-hub-registry.mjs");

function sliceFn(src, name) {
  const key = "function " + name + "(";
  let at = src.indexOf(NL + key);
  if (at >= 0) at += 1; else { at = src.indexOf(NL + "async " + key); assert.ok(at >= 0, "missing " + name); at += 1; }
  const from = at + 10;
  const ends = [NL + "function ", NL + "async function ", NL + "/* ----"].map((e) => src.indexOf(e, from)).filter((i) => i >= 0);
  return src.slice(at, ends.length ? Math.min(...ends) : src.length);
}
const shaText = (s) => createHash("sha256").update(s).digest("hex");

test("V1 Library, question-set, wizard-picker and finalize code is byte-identical to production 5c4effc7", () => {
  const pinned = {
    teacherLibrary: "60637e4938ef92422d3d87858af9aa3d8e628e763586ef363ad5572ddccdcade",
    openLibraryForm: "5631bee03575a43e34cc39d3218194ddfaed80541d28f3eb109e10c361aeae07",
    teacherQuestionSets: "d3c034984e68df9a4a56a4adcfd3d65fbb0667f166fb272d4bb24e42b057c7c4",
    openQuestionSetBuilder: "3a9a02ee0c4c07055acf0c01824434a1c048055299b33a83f4a203b34dd7a58f",
    wizardQuestionFromLibrary: "9a1d6dc0e3f914b93b1a71bc56bd525f93238b0779d21e34c356b2f830155f97",
    isWizardBlankQuestion: "85e4d0a12e3d9e66b5366ee9aa9e738cdfa45a605a6fc97e41e851a526d40d2a",
    openWizardLibraryPicker: "a245daa9a3069edc1012fc1ba28b3dd78183e6f6b87319454174e354d4f0c45a",
    finalizeWizard: "cbc4e7113262405b0b01056d94d5ef49179a750651c50ac1ba1bf6ba3bcb2a29",
    blankQuestion: "c1ba359721026f77248adc71b8444925145de9bd80964b497e7ce762afbf2df8",
    adminLibrary: "f4287a086456159c1c02feac85235deba120dac2efdf1be807189ddbbe66a744"
  };
  for (const [name, hash] of Object.entries(pinned)) assert.equal(shaText(sliceFn(html, name)), hash, name);
});

test("no data-model, Rules, indexes, Storage or dependency change (byte-pinned to production)", () => {
  const pinned = {
    "firestore.rules.production-candidate": "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d", // P3-S1 candidate Rules (7ea5d7a5... after P2-S1, 218bff3b... at P1)
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "rich-text-renderer.mjs": "9cd8ddd64a82074614b81331556d051e70c3d464994ef6deb310950d3136e985",
    "rich-text-editor.mjs": "5bb755871204e52f0f3be016f167e7f8f16ddc1f2edce98651e07fd646ef0f8d",
    "rich-text-editor-serializer.mjs": "4638eaacf8861d532c7d969ec8c5325b7c540f6bc04c158bd1c8a6b9b5608d0d",
    "group-pdf-export.mjs": "a94d0505c9177236aa602fd69a3f5c6f66b91cd5946d19087db3f6e31aba3775",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "group-pdf-font-coverage.mjs": "a5ef7c9f62b8c3f6a4f5b84ceb823a304077a5ea48be8cfaff463dcdc959316e",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99"
  };
  for (const [file, hash] of Object.entries(pinned)) assert.equal(sha(file), hash, file);
  for (const forbidden of ["storage.rules", "firebase.json", "cors.json", "functions"]) assert.ok(!existsSync(new URL(forbidden, root)), forbidden + " must not exist at the repo root");
});

test("P1 adds no collection: the set of Firestore collections referenced by index.html is exactly the production set", () => {
  const names = new Set();
  for (const m of html.matchAll(/(?:collection|doc|collectionGroup)\((?:db|publicDb)\s*,\s*"([A-Za-z]+)"/g)) names.add(m[1]);
  for (const m of html.matchAll(/(?:collection|doc)\((?:db|publicDb)\s*,\s*(GROUP_COLLECTION|GROUP_JOIN_COLLECTION)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), ["GROUP_COLLECTION", "GROUP_JOIN_COLLECTION", "auditLogs", "classes", "joinCodes", "knowledgeJoinCodes", "knowledgeSessions", "library", "questionSets", "questions", "responses", "sessionTokens", "sessions", "users"]);
  for (const forbidden of ["libraryResources", "userCapabilities", "curriculumFrameworks", "curriculumMappings", "importBatches", "libraryAssets", "libraryUsageEvents"]) {
    assert.ok(!html.includes(forbidden), "index.html must not reference " + forbidden);
    assert.ok(!registry.includes(forbidden), "registry must not reference " + forbidden);
  }
});

test("module script keeps exactly the one baseline dynamic import(); the registry is a STATIC import", () => {
  assert.equal(html.split("import(").length - 1, 1, "gate4c-e3 pins the dynamic import() count");
  assert.equal(html.split('from "./library-hub-registry.mjs?v=20261002-library-p1"').length - 1, 1);
});

test("registry is pure: no imports, no Firestore/network/storage/DOM access", () => {
  assert.ok(!registry.split(NL).some((line) => line.startsWith("import ")), "no imports");
  for (const token of ["firebase", "firestore", "fetch(", "localStorage", "sessionStorage", "indexedDB", "document.", "window.", "addDoc", "setDoc", "updateDoc", "deleteDoc", "getDoc", "getDocs", "onSnapshot", "writeBatch", "runTransaction"]) {
    assert.ok(!registry.includes(token), "registry must not contain " + token);
  }
});

test("hub shell performs no Firestore access of its own; V1 views are only mounted", () => {
  const hub = sliceFn(html, "teacherLibraryHub") + sliceFn(html, "renderTeacherLibraryView") + sliceFn(html, "navigateTeacherLibrary");
  for (const token of ["getDoc", "getDocs", "addDoc", "setDoc", "updateDoc", "deleteDoc", "writeBatch", "onSnapshot", "runTransaction", "collection(", "doc(", "query("]) {
    assert.ok(!hub.includes(token), "hub shell must not contain " + token);
  }
  assert.ok(hub.includes("teacherLibrary(host)") && hub.includes("teacherQuestionSets(host)"));
});

test("entry points: sidebar, Overview shortcuts and hub cards all resolve through the registry", () => {
  const nav = sliceFn(html, "navigateTeacherTopLevel");
  assert.ok(nav.includes("libraryLocationForTarget(libraryTarget)"));
  assert.ok(nav.includes("$$(\"#sidebarNav .navlink\").forEach(b=>b.classList.toggle(\"active\",b.dataset.nav===key));"), "programmatic navigation keeps the sidebar highlight in sync");
  assert.ok(html.includes('$("#btnQuickLib").onclick=()=>navigateTeacherLibrary("interaction","questions");'));
  assert.ok(html.includes('$("#btnQuickSets").onclick=()=>navigateTeacherLibrary("interaction","questionSets");'));
  assert.ok(html.includes('{key:"library", label:"THƯ VIỆN", icon:"📚"}'));
  assert.ok(sliceFn(html, "teacherLibraryHub").includes("libraryLocationForTarget({child:b.dataset.libraryOpen})"));
  // no second, independent hub implementation and no leftover hard-coded placeholder copy
  assert.ok(!html.includes("SẮP PHÁT TRIỂN") && !html.includes('id="groupLibraryCardTitle"'));
  assert.equal(html.split("function teacherLibraryHub(").length - 1, 1);
});

test("wizard picker keeps its own contextual entry (not routed through the hub)", () => {
  assert.ok(html.includes("openWizardLibraryPicker"));
  assert.ok(!sliceFn(html, "openWizardLibraryPicker").includes("teacherLibraryHub"));
});
