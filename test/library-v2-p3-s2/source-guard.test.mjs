// LIBRARY V2 P3-S2 - source guards (pure): the three curriculum modules stay pure/inert/UI-free, aligned with the deployed Rules text, and NOTHING
// else changed (Rules, indexes, Storage, UI, existing modules, package). Run: node --test test/library-v2-p3-s2/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import * as M from "../../curriculum-model.mjs";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const MODULES = ["curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs"];
const code = (p) => text(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");        // comments excluded from token scans

test("module boundaries: model imports nothing; queries and write contract import ONLY the model; no Firebase/DOM/clock/network/storage token in any module", () => {
  const imports = (p) => [...text(p).matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports("curriculum-model.mjs"), []);
  assert.deepEqual(imports("curriculum-queries.mjs"), ["./curriculum-model.mjs"]);
  assert.deepEqual(imports("curriculum-write-contract.mjs"), ["./curriculum-model.mjs"]);
  for (const p of MODULES) {
    const c = code(p);
    assert.ok(!/from\s+"firebase|import\(|require\(/.test(c), p + ": no Firebase import / dynamic import");
    for (const token of ["document.", "window.", "localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "Date.now", "new Date(", "setTimeout", "setInterval", "innerHTML", "onclick", "addEventListener", "console."]) assert.ok(!c.includes(token), p + " must not contain " + token);
  }
});
test("read adapters: no ordering, cursor, second filter, `in`, array-contains, collection-group, documentId or cross-organization function (zero composite indexes)", () => {
  const c = code("curriculum-queries.mjs");
  for (const token of ["orderBy", "startAfter", "startAt", "endBefore", "endAt", "collectionGroup", "documentId", "array-contains", "\"in\"", "'in'", "not-in", "\"!=\"", "\"<\"", "\">\"", "\"<=\"", "\">=\""]) assert.ok(!c.includes(token), "curriculum-queries.mjs must not contain " + token);
  assert.equal((c.match(/where\(/g) || []).length, 2, "exactly the two organizationId equality filters (Q1, Q3)");
  assert.equal((c.match(/where\("organizationId", "==", /g) || []).length, 2);
  assert.equal((c.match(/getDocs\(/g) || []).length, 2); assert.equal((c.match(/getDoc\(/g) || []).length, 1);
});
test("code canonicalization is ONE policy in ONE place: defined once in the model, locale-independent, and no other module re-implements case/Unicode folding (P4 must reuse it)", () => {
  const model = code("curriculum-model.mjs");
  assert.equal((model.match(/export function canonicalizeNodeCode/g) || []).length, 1);
  assert.ok(model.includes("normalize(\"NFKC\")") && model.includes("toUpperCase().toLowerCase()"));
  for (const p of MODULES) assert.ok(!/toLocale(Lower|Upper)Case/.test(code(p)), p + " must not use locale-dependent case conversion");
  for (const p of ["curriculum-queries.mjs", "curriculum-write-contract.mjs"]) { const c = code(p); assert.ok(!c.includes(".normalize(") && !c.includes("toLowerCase") && !c.includes("toUpperCase"), p + " must delegate code comparison to the model (codeInUse)"); }
  assert.ok(code("curriculum-write-contract.mjs").includes("codeInUse(")); assert.ok(model.includes("export function codeInUse") && model.includes("canonicalizeNodeCode(node.code)"));
});
test("D1 is recorded in the source: clone completeness is DEFERRED TO P3-S5 and must not become a permanent live checksum", () => {
  const src = text("curriculum-model.mjs");
  assert.ok(src.includes("DEFERRED TO P3-S5") && src.includes("permanent live checksum") && src.includes("BEFORE"));
});
test("no excluded feature leaked into the modules (UI, clone/delete planning, import, capabilities/Org Admin, context wiring, memberships, indexes, Storage)", () => {
  for (const p of MODULES) {
    const c = code(p);
    for (const token of ["planClone", "planDeleteDraft", "importBatches", "xlsx", "XLSX", "docx", "userCapabilities", "buildNewMembership", "buildCapabilityUpdate", "organizationMembers", "org_admin", "STATE.", "organization-context", "organization-queries", "organization-write-contract", "organization-admin-view", "organization-membership-view", "teacher-organization-enrollment", "admin-feature-registry", "firestore.indexes", "storage", "mapKeys", "curriculumMappings", "logAudit", "auditLogs"]) assert.ok(!c.includes(token), p + " must not contain " + token);
  }
});

// ---- alignment with the DEPLOYED Rules text (the Rules are authoritative)
const rules = text("firestore.rules.production-candidate");
const region = rules.slice(rules.indexOf("LIBRARY V2 P3-S1 (CURRICULUM) - BEGIN"), rules.indexOf("LIBRARY V2 P3-S1 (CURRICULUM) - END"));
const list = (re, s = region) => { const m = s.match(re); assert.ok(m, "pattern not found in the Rules: " + re); return m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")); };
test("key sets and constants in the modules equal the deployed Rules (framework and node allowlists, enums, bounds)", () => {
  const fwBlock = region.slice(region.indexOf("function fwShapeOk"), region.indexOf("function fwImmutableOk"));
  const nodeBlock = region.slice(region.indexOf("function nodeShapeOk"), region.indexOf("function nodeImmutableOk"));
  const fwAll = list(/d\.keys\(\)\.hasAll\(\[([^\]]*)\]\)/, fwBlock), fwOnly = list(/d\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/, fwBlock);
  const nodeAll = list(/d\.keys\(\)\.hasAll\(\[([^\]]*)\]\)/, nodeBlock), nodeOnly = list(/d\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/, nodeBlock);
  const C = createCurriculumWriteContract({ serverTimestamp: () => ({}) });
  const org = { id: "orgA", status: "active" }, fw = { id: "f", organizationId: "orgA", status: "draft" };
  const created = C.buildFrameworkCreate({ organization: org, name: "Khung", cloneSource: { framework: { id: "s", organizationId: "orgA" }, nodeCount: 1 } }, "pa");
  assert.deepEqual(Object.keys(C.buildFrameworkCreate({ organization: org, name: "Khung" }, "pa")).sort(), [...fwAll].sort());          // required == what a plain create writes
  for (const k of Object.keys(created)) assert.ok(fwOnly.includes(k), "framework key allowed by the Rules: " + k);
  for (const k of fwAll) assert.ok(fwOnly.includes(k));
  const nodeData = C.buildNodeCreate({ kind: "subject", name: "N" }, { organization: org, framework: fw, nodes: [] });
  assert.deepEqual(Object.keys(nodeData).sort(), [...nodeAll].sort()); assert.deepEqual([...nodeAll].sort(), [...nodeOnly].sort());       // node allowlist == required list == builder output
  assert.deepEqual(list(/d\.status in \[([^\]]*)\]/, fwBlock), [...M.FRAMEWORK_STATUSES]); assert.deepEqual(list(/d\.kind in \[([^\]]*)\]/, nodeBlock), [...M.NODE_KINDS]);
  assert.deepEqual(list(/d\.status in \[([^\]]*)\]/, nodeBlock), [...M.NODE_STATUSES]);
  assert.ok(fwBlock.includes("d.scope == '" + M.FRAMEWORK_SCOPE + "'")); assert.ok(fwBlock.includes("d.schemaVersion == " + M.CURRICULUM_SCHEMA_VERSION) && nodeBlock.includes("d.schemaVersion == " + M.CURRICULUM_SCHEMA_VERSION));
  assert.ok(region.includes("n.size() >= " + M.FRAMEWORK_NAME_MIN + " && n.size() <= " + M.FRAMEWORK_NAME_MAX));
  assert.ok(nodeBlock.includes("d.name.size() >= " + M.NODE_NAME_MIN + " && d.name.size() <= " + M.NODE_NAME_MAX));
  assert.ok(nodeBlock.includes("d.code.size() >= " + M.NODE_CODE_MIN + " && d.code.size() <= " + M.NODE_CODE_MAX));
  assert.ok(nodeBlock.includes("d.order >= " + M.NODE_ORDER_MIN + " && d.order <= " + M.NODE_ORDER_MAX));
  assert.ok(nodeBlock.includes("d.ancestors.size() <= " + M.CURRICULUM_MAX_ANCESTORS));
  assert.ok(fwBlock.includes("d.cloneSource.nodeCount >= 0 && d.cloneSource.nodeCount <= " + M.CLONE_NODE_COUNT_MAX));
  // updatable node fields and immutables
  assert.deepEqual(list(/affectedKeys\(\)\.hasOnly\(\[([^\]]*)\]\)/).filter((k) => k !== "updatedAt"), ["name", "code", "order", "status"]);
  // lifecycle pairs in the Rules == the model's table
  for (const [a, b] of Object.values(M.FRAMEWORK_TRANSITIONS).map((t) => [t.from, t.to])) assert.ok(region.includes("b.status == '" + a + "' && a.status == '" + b + "'"), a + ">" + b);
  assert.equal((region.match(/b\.status == '[a-z]+' && a\.status == '[a-z]+'/g) || []).length, Object.keys(M.FRAMEWORK_TRANSITIONS).length);
});

test("nothing else changed: Rules (deployed P3-S1), indexes, Storage, index.html, package, existing organization modules are byte-pinned; the modules are not wired anywhere", () => {
  const pinned = {
    "firestore.rules.production-candidate": "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "index.html": "b7a46dc0a222c5c64ceb6b72c8de42652b80e3b8663391772366042be40be63e",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "organization-membership-view.mjs": "d1347229b6b06e1cb1d09fba130045b2e4c54a2c91c5996dc9bf2cd736aed1ea",
    "teacher-organization-enrollment.mjs": "75d6c6afaf657f118408c9182faecd560d259ac5d97eb796695bd9b88023653e",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-admin-view.mjs": "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413"
  };
  for (const [f, h] of Object.entries(pinned)) assert.equal(sha(f), h, f);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const html = text("index.html");
  for (const p of [...MODULES, "curriculum"]) assert.ok(!html.includes(p), "index.html must not reference " + p + " (P3-S3 will wire the UI)");
  for (const p of ["curriculum-admin-view.mjs"]) assert.ok(!existsSync(new URL(p, root)), p + " must not exist (UI is P3-S3/S4)");
  for (const f of ["organization-context.mjs", "admin-feature-registry.mjs", "organization-admin-view.mjs", "organization-membership-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs", "teacher-organization-enrollment.mjs", "library-hub-registry.mjs"]) assert.ok(!text(f).includes("curriculum-"), f + " does not consume the curriculum modules");
});
