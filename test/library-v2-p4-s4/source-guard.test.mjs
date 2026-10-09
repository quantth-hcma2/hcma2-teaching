// LIBRARY V2 P4-S4 - scope / safety guard (pure). The slice adds the import COMMIT / RECOVERY / ROLLBACK controller and the execution UI helpers (both loaded lazily through the P4-S3
// engine), drives them from the Import Center view, wires them with the approved index.html edits, and changes NO Rules, indexes, Storage, V1 export, P4-S2 module or P3 contract.
// Run: node --test test/library-v2-p4-s4/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_P4S4, reverseP4S4IndexEdits } from "./p4s4-edits.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "6a05411f278c4ff925e30910ae92ce03df9500c7";                  // P4-S3 closure = the approved baseline of this slice
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, path) => execFileSync("git", ["show", rev + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(root + p)).digest("hex");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");
const stripLiterals = (s) => s.replace(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
const code = (p) => stripLiterals(text(p).split("\n").map((line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line)).join("\n"));
const ADDED_OK = [/^import-(commit-controller|run-helpers)\.mjs$/, /^test\/library-v2-p4-s4\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "index.html", "import-center-view.mjs", "import-center-engine.mjs",                                                                               // the slice's own edits
  "test/library-v2-p2-s2/source-guard.test.mjs", "test/library-v2-p2-s3/source-guard.test.mjs", "test/library-v2-p2-s4/source-guard.test.mjs",           // historical guards aligned
  "test/library-v2-p3-s3/source-guard.test.mjs", "test/library-v2-p3-s4/source-guard.test.mjs", "test/library-v2-p3-s5/source-guard.test.mjs",
  "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p4-s3/p4s3-edits.mjs", "test/library-v2-p4-s3/integration.e2e.mjs"
]);

test("SCOPE: relative to the P4-S3 closure the tree only ADDS the controller, the run helpers and this slice's tests, and modifies ONLY the approved files (no deletion or rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((line) => line.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  assert.ok(all.length > 0);
  for (const [status, path] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(path)), "added outside the allow-list: " + path);
    else if (status === "M") assert.ok(MODIFIED_OK.has(path), "modified outside the allow-list: " + path);
    else assert.fail("only additions and approved modifications are allowed: " + status + " " + path);
  }
  for (const m of ["import-commit-controller.mjs", "import-run-helpers.mjs"]) assert.ok(all.some(([, p]) => p === m), m + " is part of the slice");
});
test("PINS: Firestore Rules (production artifact), indexes, package manifest, V1 roster export library, the P4-S2 reader/validation/plan modules, the vendored SheetJS, the P3 contracts and the P4-S3 template/writer modules are byte-identical to the baseline; no Storage config", () => {
  for (const f of ["firestore.rules.production-candidate", "firestore.indexes.json", "firestore.rules", "package.json", "package-lock.json", "vendor/xlsx.full.min.js", "vendor/sheetjs-0.20.3/xlsx.mjs", "vendor/sheetjs-0.20.3/LICENSE", "group-roster.mjs",
    "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-queries.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs", "curriculum-admin-view.mjs", "organization-admin-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs",
    "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-normalize.mjs", "import-validate.mjs", "import-plan.mjs", "import-diagnostics.mjs", "import-sha256.mjs", "import-capabilities.mjs", "import-xml-wellformed.mjs",
    "import-template.mjs", "import-template-writer.mjs"]) assert.equal(sha(f), shaBuf(gitBuf(BASE, f)), f + " unchanged");
  assert.equal(sha("firestore.rules.production-candidate").toUpperCase(), "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485", "production Rules artifact (ruleset 0b6910c3) unchanged");
  assert.equal(sha("vendor/sheetjs-0.20.3/xlsx.mjs"), "1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f), f + " must not exist at the repository root");
});
test("EDITS: index.html differs from the baseline by EXACTLY the five pinned edit pairs (reversal restores the baseline bytes) and removes only the lines that gained an argument or a new token", () => {
  assert.equal(INDEX_EDITS_P4S4.length, 5);
  assert.equal(shaBuf(Buffer.from(reverseP4S4IndexEdits(text("index.html")), "utf8")), shaBuf(gitBuf(BASE, "index.html")));
  const removed = git("diff", "-U0", "--no-color", BASE, "--", "index.html").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  assert.ok(removed <= 6, "index.html removed " + removed + " lines");
  const html = text("index.html");
  assert.ok(html.includes('import { createImportCenter } from "./import-center-view.mjs?v=20261009-p4s4";'));
  assert.equal([...html.matchAll(/import\("\.\/import-center-engine\.mjs\?v=20261009-p4s4"\)/g)].length, 1, "the engine is still imported only dynamically (lazy)");
  assert.ok(!/^\s*import\s[^;]*import-(center-engine|commit-controller|run-helpers)/m.test(html), "no static import of the engine, controller or run helpers");
  assert.ok(html.includes("getDocFromServer, getDocsFromServer"), "server reads are imported");
  assert.equal([...html.matchAll(/commitTools:\{ firestore:\{collection,doc,getDocFromServer,getDocsFromServer,query,where,limit,orderBy,startAfter,documentId,writeBatch,setDoc,updateDoc,deleteDoc,serverTimestamp\}, acquireLock:acquireImportLock \}/g)].length, 1);
  assert.equal([...html.matchAll(/getAdminFeature\("organizations"\)\.routeKey, label:"Đơn vị"/g)].length, 1, "no new menu entry");
  assert.ok(html.includes("function downloadImportFile(bytes,fileName,mime)") && html.includes("function downloadBlob(filename, content, mime)"), "the V1 download helper is untouched next to the import helpers");
  assert.ok(!/importBatches|import-xlsx|sheetjs-0\.20\.3/.test(html.replace(/\/\/.*$/gm, "")), "the page never names the batch collection or the reader/SheetJS modules");
});
test("COLLECTIONS: only the commit controller names the import/curriculum collections, and it touches exactly importBatches, curriculumFrameworks and the framework's nodes subcollection - no users, organizations, capabilities, audit or Storage", () => {
  const body = code("import-commit-controller.mjs");
  const raw = text("import-commit-controller.mjs").replace(/\/\/.*$/gm, "");
  const names = new Set([...raw.matchAll(/"(importBatches|curriculumFrameworks|nodes|users|organizations|organizationMembers|userCapabilities|auditLogs|knowledge[A-Za-z]*|sessions|classes)"/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), ["curriculumFrameworks", "importBatches", "nodes"]);
  const withoutErrorRegex = body.replace(/\/network\|offline\|fetch[^/]*\/i/, "/ERROR_MESSAGE_PATTERN/i");   // classifyError matches the words of SDK offline messages; those words are not API uses
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|caches|document|window|navigator|uploadBytes|getStorage|ref\s*\()\b/.test(withoutErrorRegex), "no network, persistence, DOM or Storage API");
  for (const file of ["import-center-view.mjs", "import-run-helpers.mjs", "import-center-engine.mjs"]) {
    const c = code(file);
    assert.ok(!/importBatches|curriculumFrameworks|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\bwriteBatch\b|\baddDoc\b|\brunTransaction\b|uploadBytes|getStorage/.test(c), file + " names a collection or a write API");
  }
  assert.ok(!/^\s*import\s/m.test(text("import-center-view.mjs")) && !/^\s*import\s/m.test(text("import-run-helpers.mjs")), "the view and the run helpers import nothing (every dependency is injected)");
  const imports = [...text("import-commit-controller.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./curriculum-model.mjs", "./import-plan.mjs", "./import-sha256.mjs"], "the controller reuses the approved plan, model and hash modules only");
  const engine = [...text("import-center-engine.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(engine, ["./import-capabilities.mjs", "./import-commit-controller.mjs", "./import-plan.mjs", "./import-run-helpers.mjs", "./import-template-writer.mjs", "./import-template.mjs", "./import-validate.mjs", "./import-xlsx-reader.mjs"]);
});
test("NO CHEATING: no status value other than the frozen enum is ever written; completion is reached only through the full read-back verification; every read goes to the server; authorization is re-checked before each write phase", () => {
  const src = text("import-commit-controller.mjs").replace(/\/\/.*$/gm, "");
  const statuses = new Set([...src.matchAll(/status: "([a-z_]+)"/g)].map((m) => m[1]));
  for (const s of statuses) assert.ok(["committing", "completed", "partial", "rolled_back", "active", "draft", "retired"].includes(s), "unexpected status literal: " + s);
  const written = [...src.matchAll(/updateDoc\(batchRef\(batchId\), \{ ([^}]*)\}/g)].map((m) => m[1]);
  for (const w of written) if (/status:/.test(w)) assert.ok(/status: "(partial|completed|rolled_back)"/.test(w), "status write outside the allowed transitions: " + w);
  const completeAt = src.indexOf('status: "completed"'); const verifyAt = src.indexOf("verifyImportedDataset({ plan, framework: readBack.fw");
  assert.ok(verifyAt > 0 && completeAt > verifyAt, "the completion write comes after the full verification");
  assert.ok(/if \(!verification\.ok\) \{/.test(src), "a failed verification returns before the completion write");
  assert.ok(!/fs\.getDoc\(|fs\.getDocs\(/.test(src), "no cached read: only getDocFromServer / getDocsFromServer");
  assert.ok((src.match(/await auth\(\)/g) || []).length >= 5 && (src.match(/checkAuthorized\(authorize\)/g) || []).length >= 4, "authorization is re-checked before the batch, framework, each chunk, verification, completion and every rollback phase");
  assert.ok(!/deleteDoc\(batchRef|batchRef\([^)]*\)\)\s*;?\s*\/\/\s*delete/.test(src), "the batch record is never deleted");
  assert.ok(/NODE_PAGE = 500/.test(src) && /MAX_ROLLBACK_ROUNDS/.test(src), "reads and deletes are bounded");
});
test("CHUNKS: the controller never builds an atomic write larger than the frozen plan chunk (400): node chunks come from plan.chunks, rollback deletes are sliced by 400", () => {
  const src = text("import-commit-controller.mjs").replace(/\/\/.*$/gm, "");
  assert.ok(/for \(const chunk of plan\.chunks\)/.test(src) && /plan\.nodes\.slice\(chunk\.from, chunk\.to\)/.test(src));
  assert.ok(/from \+= 400/.test(src) && /slice\(from, from \+ 400\)/.test(src));
});
test("UI: execution is available only when the page injects commitTools; the S3 disabled placeholder remains for the read-only mode; confirmation needs an explicit acknowledgement; the success wording lives only in the completed branch", () => {
  const view = text("import-center-view.mjs"), helpers = text("import-run-helpers.mjs");
  assert.ok(/const commitTools = deps\.commitTools && deps\.commitTools\.firestore \? deps\.commitTools : null/.test(view));
  assert.equal([...view.matchAll(/XÁC NHẬN NHẬP/g)].length, 1, "the S3 read-only placeholder is still the only literal in the view");
  assert.ok(/id="impConfirmDisabled" disabled aria-disabled="true" aria-describedby="impConfirmHint"/.test(view));
  assert.ok(/data-imp-ack="1"/.test(helpers) && /disabled = !acknowledged \|\| !!blockedReason \|\| !canAct/.test(helpers));
  const successAt = [...helpers.matchAll(/Đã nhập xong và kiểm tra đầy đủ/g)]; assert.equal(successAt.length, 1, "the success title appears exactly once, inside run.done");
  assert.ok(/if \(run\.done\) \{[\s\S]*?Đã nhập xong và kiểm tra đầy đủ/.test(helpers));
  assert.ok(/if \(result\.ok\) \{\s*const nodes = plan\.verification\.expectedNodeCount;/.test(view), "success state is set only from a completed controller result");
  assert.ok(/organizationId: org\.id/.test(view) && /verifyPlanIntegrity|planDigest/.test(text("import-commit-controller.mjs")), "the locked organization and the plan digest travel with the commit");
});
