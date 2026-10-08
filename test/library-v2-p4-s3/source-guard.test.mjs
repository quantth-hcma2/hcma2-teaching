// LIBRARY V2 P4-S3 - scope / safety / version guard (pure). The slice is a UI/PREVIEW layer: it adds the Import Center view, the lazy engine and the Template Center writer, wires them into
// Organization Detail with exactly the approved edits, and writes NOTHING. Run: node --test test/library-v2-p4-s3/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_P4S3, SECTION_VIEW_EDITS_P4S3, ORG_VIEW_EDITS_P4S3, reverseP4S3IndexEdits, reverseP4S3SectionViewEdits, reverseP4S3OrgViewEdits } from "./p4s3-edits.mjs";
import { buildTemplateSheets, TEMPLATE_STRICTNESS, TEMPLATE_HEADER_CHECKSUM } from "../../import-template.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "61ce3061c8b2cf6a52eb7c9517640632cc60e463";                  // P4-S2 closure = the approved baseline of this slice
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, path) => execFileSync("git", ["show", rev + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(root + p)).digest("hex");
const shaText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const code = (p) => text(p).split("\n").map((line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line)).join("\n");
const NEW_MODULES = ["import-center-view.mjs", "import-center-engine.mjs", "import-template-writer.mjs"];
const ADDED_OK = [/^import-(center-view|center-engine|template-writer)\.mjs$/, /^test\/library-v2-p4-s3\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "index.html", "curriculum-admin-view.mjs", "organization-admin-view.mjs", "import-template.mjs",                                              // the slice's own edits (pinned below)
  "test/library-v2-p2-s2/source-guard.test.mjs", "test/library-v2-p2-s3/source-guard.test.mjs", "test/library-v2-p2-s4/source-guard.test.mjs",   // historical guards aligned
  "test/library-v2-p3-s4/source-guard.test.mjs", "test/library-v2-p3-s4/s4-edits.mjs", "test/library-v2-p3-s5/source-guard.test.mjs", "test/library-v2-p3-s5/s5-edits.mjs",
  "test/library-v2-p4-s2/source-guard.test.mjs", "test/library-v2-p4-s2/reader-qualification.test.mjs"
]);

test("SCOPE: relative to the P4-S2 closure the tree only ADDS the three UI modules and this slice's tests, and modifies ONLY the approved files (no deletion or rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((line) => line.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  assert.ok(all.length > 0);
  for (const [status, path] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(path)), "added outside the allow-list: " + path);
    else if (status === "M") assert.ok(MODIFIED_OK.has(path), "modified outside the allow-list: " + path);
    else assert.fail("only additions and approved modifications are allowed: " + status + " " + path);
  }
  for (const m of NEW_MODULES) assert.ok(all.some(([, p]) => p === m), m + " is part of the slice");
});
test("PINS: Firestore Rules, indexes, package manifest, V1 roster export library, the P4-S2 reader/security modules and the vendored SheetJS 0.20.3 are byte-identical to the baseline; no Storage config", () => {
  for (const f of ["firestore.rules.production-candidate", "firestore.indexes.json", "firestore.rules", "package.json", "package-lock.json", "vendor/xlsx.full.min.js", "vendor/sheetjs-0.20.3/xlsx.mjs", "vendor/sheetjs-0.20.3/LICENSE", "group-roster.mjs", "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-queries.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs",
    "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-normalize.mjs", "import-validate.mjs", "import-plan.mjs", "import-diagnostics.mjs", "import-sha256.mjs", "import-capabilities.mjs", "import-xml-wellformed.mjs"]) assert.equal(sha(f), createHash("sha256").update(gitBuf(BASE, f)).digest("hex"), f + " unchanged");
  assert.equal(sha("firestore.rules.production-candidate"), "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485"); assert.equal(sha("vendor/sheetjs-0.20.3/xlsx.mjs"), "1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f), f + " must not exist at the repository root");
});
test("EDITS: the three pre-existing files this slice edits differ from the baseline by EXACTLY the pinned edit pairs (reversal restores the baseline bytes) and the edit counts are the approved ones", () => {
  assert.equal(INDEX_EDITS_P4S3.length, 5); assert.equal(SECTION_VIEW_EDITS_P4S3.length, 6); assert.equal(ORG_VIEW_EDITS_P4S3.length, 5);
  assert.equal(shaText(reverseP4S3IndexEdits(text("index.html"))), createHash("sha256").update(gitBuf(BASE, "index.html")).digest("hex"));
  assert.equal(shaText(reverseP4S3SectionViewEdits(text("curriculum-admin-view.mjs"))), createHash("sha256").update(gitBuf(BASE, "curriculum-admin-view.mjs")).digest("hex"));
  assert.equal(shaText(reverseP4S3OrgViewEdits(text("organization-admin-view.mjs"))), createHash("sha256").update(gitBuf(BASE, "organization-admin-view.mjs")).digest("hex"));
  // the additions are small and additive: no line of the existing logic was removed except the three call/signature lines that gained an optional argument
  for (const [file, maxRemoved] of [["index.html", 2], ["curriculum-admin-view.mjs", 4], ["organization-admin-view.mjs", 4]]) {
    const removed = git("diff", "-U0", "--no-color", BASE, "--", file).split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    assert.ok(removed <= maxRemoved, file + " removed " + removed + " lines");
  }
});
test("TEMPLATE DEFINITION: the blank template and the strictness policy are byte-identical in meaning to the P4-S2 closure (only the example option was added); the header checksum is unchanged", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(buildTemplateSheets())).digest("hex"), "c1ae049aeada6e54c5bb0044783694bba0228b7576e7230afc6958fa0591b50a");
  assert.equal(createHash("sha256").update(JSON.stringify(TEMPLATE_STRICTNESS)).digest("hex"), "870143f4eb89464bea51be0dc0096cc203be409cab518227cfcaa8501eaba84f");
  assert.equal(TEMPLATE_HEADER_CHECKSUM, "e2d6e0b37a6cdfe38f90ee7dc91e285a5d8d6c33a17a874f1366c633ff70607d");
});
test("READ-ONLY: no new module can write Firestore or Storage, upload, persist, or name an import/curriculum collection; the view imports nothing and has no Firestore dependency at all", () => {
  for (const file of NEW_MODULES) {
    const body = code(file).replace(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');   // drop string/template literals: only CODE is checked
    assert.ok(!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|serverTimestamp|uploadBytes|uploadString|ref\s*\(|getStorage|getFirestore|collection\s*\(|doc\s*\(|query\s*\()/.test(body), file + " references a Firestore/Storage API");
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|caches)\b/.test(body), file + " uses a network/persistence API");
    assert.ok(!/importBatches|curriculumFrameworks|curriculumNodes/.test(code(file)), file + " names a curriculum/import collection");
  }
  const view = text("import-center-view.mjs");
  assert.ok(!/^\s*import\s/m.test(view) && !/\bimport\s*\(/.test(code("import-center-view.mjs")), "the view imports nothing (every dependency is injected)");
  assert.ok(!/\bdb\.|\bgetDoc|\bgetDocs/.test(code("import-center-view.mjs")), "the view never touches the database object");
  const imports = [...text("import-center-engine.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./import-capabilities.mjs", "./import-plan.mjs", "./import-template-writer.mjs", "./import-template.mjs", "./import-validate.mjs", "./import-xlsx-reader.mjs"]);
  assert.ok(!code("import-template-writer.mjs").includes("xlsx.full.min.js") && !/window\.XLSX/.test(code("import-template-writer.mjs")), "the V1 library is not referenced by code");
});
test("CONFIRM: the only 'confirm import' control in the view is rendered disabled with no handler; there is no enabling path", () => {
  const view = text("import-center-view.mjs");
  const matches = [...view.matchAll(/XÁC NHẬN NHẬP/g)];
  assert.equal(matches.length, 1);
  assert.match(view, /id="impConfirmDisabled" disabled aria-disabled="true" aria-describedby="impConfirmHint"/);
  assert.ok(!/impConfirmDisabled[^`]*onclick|\.disabled\s*=\s*false|removeAttribute\("disabled"\)|data-imp-action="confirm/.test(view));
  assert.ok(!/confirm-import|doImport|commitImport|startImport|executeImport/i.test(view), "no import-execution entry point exists");
});
test("WIRING: the engine is imported ONLY dynamically (lazy); the view and the two edited screens use the P4-S3 cache token; the Import Center is a Platform Admin dependency inside the Organization screen; no new menu entry or route", () => {
  const html = text("index.html");
  assert.equal([...html.matchAll(/import\("\.\/import-center-engine\.mjs\?v=20261008-p4s3"\)/g)].length, 1);
  assert.ok(!/^\s*import\s[^;]*import-center-engine/m.test(html), "no static import of the engine");
  assert.ok(!/import-xlsx|import-template-writer|sheetjs-0\.20\.3/.test(html), "reader, writer and SheetJS are never referenced statically by the page");
  assert.ok(html.includes('import { createImportCenter } from "./import-center-view.mjs?v=20261008-p4s3";'));
  assert.ok(html.includes('from "./organization-admin-view.mjs?v=20261008-p4s3"') && html.includes('from "./curriculum-admin-view.mjs?v=20261008-p4s3"'));
  assert.equal([...html.matchAll(/importCenter:createImportCenter\(\{/g)].length, 1);
  const block = html.slice(html.indexOf("importCenter:createImportCenter({"), html.indexOf("membershipSection:createOrganizationMembershipSection({"));
  assert.ok(block.includes('isPlatformAdmin:STATE.profile?.role==="admin"') && block.includes("downloadFile:downloadImportFile") && !block.includes("writer:") && !/setDoc|updateDoc|writeBatch/.test(block), "no writer is injected");
  assert.equal([...html.matchAll(/getAdminFeature\("organizations"\)\.routeKey, label:"Đơn vị"/g)].length, 1, "no new menu entry");
  assert.ok(html.includes("function downloadImportFile(bytes,fileName,mime)") && html.includes("function downloadBlob(filename, content, mime)"), "the V1 download helper is untouched next to the new one");
});
