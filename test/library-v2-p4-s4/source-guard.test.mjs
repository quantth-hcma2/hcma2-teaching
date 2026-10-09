// LIBRARY V2 P4-S4 (with the IMPORT FREEZE) - scope / safety guard (pure). The slice adds the import COMMIT / RECOVERY / ROLLBACK controller (seal + rollback barrier, no completion transaction, no fallback), the execution UI
// helpers and a read-only import-status lookup; marks incomplete imports in the P3 list; wires them with the approved index.html edits; and changes the Firestore Rules CANDIDATE by EXACTLY the five approved import-freeze edits.
// No indexes, Storage, V1 export, P4-S2 module or P3 contract changes.
// Run: node --test test/library-v2-p4-s4/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_P4S4, SECTION_VIEW_EDITS_P4S4, reverseP4S4IndexEdits, reverseP4S4SectionViewEdits } from "./p4s4-edits.mjs";
import { FREEZE_ANCHORS, deployedRules } from "./import-freeze-rules.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "6a05411f278c4ff925e30910ae92ce03df9500c7";                  // P4-S3 closure = the approved baseline of this slice
const DEPLOYED_RULES_SHA = "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485";   // deployed ruleset 0b6910c3
const CANDIDATE_RULES_SHA = "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A";   // the import-freeze candidate
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, path) => execFileSync("git", ["show", rev + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(root + p)).digest("hex");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");
const stripLiterals = (s) => s.replace(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
const code = (p) => stripLiterals(text(p).split("\n").map((line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line)).join("\n"));
const noComments = (p) => text(p).replace(/\/\/.*$/gm, "");
const ADDED_OK = [/^import-(commit-controller|run-helpers|batch-status)\.mjs$/, /^test\/library-v2-p4-s4\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "index.html", "import-center-view.mjs", "import-center-engine.mjs", "curriculum-admin-view.mjs", "firestore.rules.production-candidate"                 // the slice's own edits
]);
const HISTORICAL_TEST_RE = /^test\/(?!library-v2-p4-s4\/)[A-Za-z0-9._\/-]+\.(mjs|cjs)$/;                                                                // historical tests: pin re-alignment only (checked below)

test("SCOPE: relative to the P4-S3 closure the tree only ADDS the controller, the run helpers, the import-status lookup and this slice's tests, and modifies ONLY the approved files plus historical tests (no deletion or rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((line) => line.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  assert.ok(all.length > 0);
  for (const [status, path] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(path)), "added outside the allow-list: " + path);
    else if (status === "M") assert.ok(MODIFIED_OK.has(path) || HISTORICAL_TEST_RE.test(path), "modified outside the allow-list: " + path);
    else assert.fail("only additions and approved modifications are allowed: " + status + " " + path);
  }
  for (const m of ["import-commit-controller.mjs", "import-run-helpers.mjs", "import-batch-status.mjs"]) assert.ok(all.some(([, p]) => p === m), m + " is part of the slice");
});
test("PINS: indexes, package manifest, the legacy firestore.rules, V1 roster export library, the P4-S2 reader/validation/plan modules, the vendored SheetJS, the P3 contracts (except the additive list marking) and the P4-S3 template/writer modules are byte-identical to the baseline; no Storage config", () => {
  for (const f of ["firestore.indexes.json", "firestore.rules", "package.json", "package-lock.json", "vendor/xlsx.full.min.js", "vendor/sheetjs-0.20.3/xlsx.mjs", "vendor/sheetjs-0.20.3/LICENSE", "group-roster.mjs",
    "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-queries.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs", "organization-admin-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs",
    "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-normalize.mjs", "import-validate.mjs", "import-plan.mjs", "import-diagnostics.mjs", "import-sha256.mjs", "import-capabilities.mjs", "import-xml-wellformed.mjs",
    "import-template.mjs", "import-template-writer.mjs"]) assert.equal(sha(f), shaBuf(gitBuf(BASE, f)), f + " unchanged");
  assert.equal(sha("vendor/sheetjs-0.20.3/xlsx.mjs"), "1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f), f + " must not exist at the repository root");
});
test("RULES: the Rules candidate differs from the deployed ruleset (0b6910c3) by EXACTLY the approved import-freeze edits - reversing them reproduces the deployed bytes; only five call sites and one comment-plus-helper block were added", () => {
  assert.equal(sha("firestore.rules.production-candidate").toUpperCase(), CANDIDATE_RULES_SHA, "the import-freeze Rules candidate SHA-256");
  assert.equal(shaBuf(gitBuf(BASE, "firestore.rules.production-candidate")).toUpperCase(), DEPLOYED_RULES_SHA, "the baseline is the deployed ruleset");
  assert.equal(FREEZE_ANCHORS.length, 6, "one helper block + five call sites");
  const reversed = deployedRules(readFileSync(root + "firestore.rules.production-candidate", "utf8"));
  assert.equal(shaBuf(Buffer.from(reversed, "utf8")).toUpperCase(), DEPLOYED_RULES_SHA, "reversal restores the deployed ruleset byte for byte");
  const [added, removed] = git("diff", "--numstat", BASE, "--", "firestore.rules.production-candidate").trim().split("\t");
  assert.equal(Number(added), 23); assert.equal(Number(removed), 5, "only the five call-site lines were rewritten");
  const rules = text("firestore.rules.production-candidate");
  for (const fn of ["importNodeCreateOk", "importNodeUpdateOk", "importNodeDeleteOk", "importFrameworkUpdateOk", "importFrameworkDeleteOk"]) assert.equal([...rules.matchAll(new RegExp("function " + fn + "\\(", "g"))].length, 1, fn + " defined once");
  assert.equal([...rules.matchAll(/(importNodeCreateOk|importNodeUpdateOk|importNodeDeleteOk|importFrameworkUpdateOk|importFrameworkDeleteOk)\(/g)].length, 10, "5 definitions + 5 call sites");
  assert.ok(!/sealedAt|frozenAt|importLock|'sealed'|'frozen'/i.test(rules), "no new status value and no new field: the frozen enum and schema are unchanged");
});
test("EDITS: index.html and the P3 curriculum list module differ from the baseline by EXACTLY the pinned edit pairs (reversal restores the baseline bytes)", () => {
  assert.equal(INDEX_EDITS_P4S4.length, 7);
  assert.equal(shaBuf(Buffer.from(reverseP4S4IndexEdits(text("index.html")), "utf8")), shaBuf(gitBuf(BASE, "index.html")));
  assert.equal(SECTION_VIEW_EDITS_P4S4.length, 10);
  assert.equal(shaBuf(Buffer.from(reverseP4S4SectionViewEdits(text("curriculum-admin-view.mjs")), "utf8")), shaBuf(gitBuf(BASE, "curriculum-admin-view.mjs")));
  const removed = git("diff", "-U0", "--no-color", BASE, "--", "index.html").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  assert.ok(removed <= 8, "index.html removed " + removed + " lines");
  const html = text("index.html");
  assert.ok(html.includes('import { createImportCenter } from "./import-center-view.mjs?v=20261009-p4s4";'));
  assert.ok(html.includes('import { createImportStatusReader } from "./import-batch-status.mjs?v=20261009-p4s4";') && html.includes("importStatus:createImportStatusReader({collection,query,where,limit,getDocs})"));
  assert.equal([...html.matchAll(/import\("\.\/import-center-engine\.mjs\?v=20261009-p4s4"\)/g)].length, 1, "the engine is still imported only dynamically (lazy)");
  assert.ok(!/^\s*import\s[^;]*import-(center-engine|commit-controller|run-helpers)/m.test(html), "no static import of the engine, controller or run helpers");
  assert.ok(html.includes("getDocFromServer, getDocsFromServer"), "server reads are imported");
  assert.equal([...html.matchAll(/commitTools:\{ firestore:\{collection,doc,getDocFromServer,getDocsFromServer,query,where,limit,orderBy,startAfter,documentId,writeBatch,setDoc,updateDoc,deleteDoc,serverTimestamp\}, acquireLock:acquireImportLock \}/g)].length, 1);
  assert.equal([...html.matchAll(/getAdminFeature\("organizations"\)\.routeKey, label:"Đơn vị"/g)].length, 1, "no new menu entry");
  assert.ok(html.includes("function downloadImportFile(bytes,fileName,mime)") && html.includes("function downloadBlob(filename, content, mime)"), "the V1 download helper is untouched next to the import helpers");
  assert.ok(!/importBatches|import-xlsx|sheetjs-0\.20\.3/.test(html.replace(/\/\/.*$/gm, "")), "the page never names the batch collection or the reader/SheetJS modules");
});
test("HISTORICAL TESTS: every modified earlier-slice test changes only a Rules SHA-256 pin, except the explicitly aligned guards whose extra lines are the list of the new allowed files / reversal chain", () => {
  const files = git("diff", "--name-only", BASE, "--", "test").split("\n").filter((p) => p && !p.startsWith("test/library-v2-p4-s4/"));
  const aligned = new Set(["test/library-v2-p2-s2/source-guard.test.mjs", "test/library-v2-p2-s3/source-guard.test.mjs", "test/library-v2-p2-s4/source-guard.test.mjs", "test/library-v2-p3-s3/source-guard.test.mjs",
    "test/library-v2-p3-s4/source-guard.test.mjs", "test/library-v2-p3-s5/source-guard.test.mjs", "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p4-s3/p4s3-edits.mjs", "test/library-v2-p4-s3/integration.e2e.mjs",
    "test/library-v2-p4-s1/atomic.rules.test.mjs", "test/library-v2-p4-s1/import-batch.rules.test.mjs", "test/library-v2-p4-s1/regression.test.mjs"]);          // the two P4-S1 Rules suites now run on the DEPLOYED ruleset text (one import + one line each)
  assert.ok(files.length >= 20);
  for (const f of files) {
    const lines = git("diff", "-U0", "--no-color", BASE, "--", f).split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    const offPin = lines.filter((l) => !/7F7C790E|F6B9DE01/i.test(l));
    if (!aligned.has(f)) assert.deepEqual(offPin, [], f + " must only re-pin the Rules SHA-256");
    else assert.ok(offPin.length < 40, f + " alignment is small: " + offPin.length);
  }
});
test("COLLECTIONS: only the commit controller names the import/curriculum collections for writing (importBatches, curriculumFrameworks, nodes); the status lookup only READS importBatches; nothing touches users, organizations, capabilities, audit or Storage", () => {
  const body = code("import-commit-controller.mjs");
  const raw = noComments("import-commit-controller.mjs");
  const names = new Set([...raw.matchAll(/"(importBatches|curriculumFrameworks|nodes|users|organizations|organizationMembers|userCapabilities|auditLogs|knowledge[A-Za-z]*|sessions|classes)"/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), ["curriculumFrameworks", "importBatches", "nodes"]);
  const withoutErrorRegex = body.replace(/\/network\|offline\|fetch[^/]*\/i/, "/ERROR_MESSAGE_PATTERN/i");   // classifyError matches the words of SDK offline messages; those words are not API uses
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|caches|document|window|navigator|uploadBytes|getStorage|ref\s*\()\b/.test(withoutErrorRegex), "no network, persistence, DOM or Storage API");
  for (const file of ["import-center-view.mjs", "import-run-helpers.mjs", "import-center-engine.mjs"]) {
    const c = code(file);
    assert.ok(!/importBatches|curriculumFrameworks|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\bwriteBatch\b|\baddDoc\b|\brunTransaction\b|uploadBytes|getStorage/.test(c), file + " names a collection or a write API");
  }
  const status = noComments("import-batch-status.mjs");
  assert.ok(!/^\s*import\s/m.test(status), "the status lookup imports nothing (the Firestore functions are injected)");
  assert.ok(!/\b(setDoc|updateDoc|deleteDoc|writeBatch|addDoc|runTransaction|onSnapshot|fetch|localStorage|sessionStorage)\b/.test(status), "the status lookup is read-only");
  assert.ok(/getDocs\(/.test(status) && !/\bgetDoc\(/.test(status));
  assert.equal([...status.matchAll(/where\(/g)].length, 2, "two equality constraints (organizationId, status); no orderBy and no composite index");
  assert.ok(!/orderBy|array-contains/.test(status));
  assert.ok(!/^\s*import\s/m.test(text("import-center-view.mjs")) && !/^\s*import\s/m.test(text("import-run-helpers.mjs")), "the view and the run helpers import nothing (every dependency is injected)");
  const imports = [...text("import-commit-controller.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./curriculum-model.mjs", "./import-plan.mjs", "./import-sha256.mjs"], "the controller reuses the approved plan, model and hash modules only");
  const engine = [...text("import-center-engine.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(engine, ["./import-capabilities.mjs", "./import-commit-controller.mjs", "./import-plan.mjs", "./import-run-helpers.mjs", "./import-template-writer.mjs", "./import-template.mjs", "./import-validate.mjs", "./import-xlsx-reader.mjs"]);
});
test("NO CHEATING: no status value other than the frozen enum is ever written; completion only after the seal and the full read-back verification; every read goes to the server; authorization is re-checked before each write phase", () => {
  const src = noComments("import-commit-controller.mjs");
  const statuses = new Set([...src.matchAll(/status: "([a-z_]+)"/g)].map((m) => m[1]));
  for (const s of statuses) assert.ok(["committing", "completed", "partial", "rolled_back", "active", "draft", "retired"].includes(s), "unexpected status literal: " + s);
  const written = [...src.matchAll(/updateDoc\(batchRef\(batchId\), \{ ([^}]*)\}/g)].map((m) => m[1]);
  for (const w of written) if (/status:/.test(w)) assert.ok(/status: "(partial|completed|rolled_back)"/.test(w), "status write outside the allowed transitions: " + w);
  const sealAt = src.indexOf("chunksDone: plan.chunks.length, updatedAt"), verifyAt = src.indexOf("verifyImportedDataset({ plan, framework: readBack.fw"), completeAt = src.indexOf('{ status: "completed", chunksDone: plan.chunks.length');
  assert.ok(sealAt > 0 && verifyAt > sealAt && completeAt > verifyAt, "order: seal, then the full verification, then the completion write");
  assert.ok(/if \(!verification\.ok\) \{\s*return await failVerification/.test(src), "a failed verification returns before the completion write");
  assert.ok(/if \(present\.size !== plan\.nodes\.length\) return stop\("incomplete", \{ phase: "seal"/.test(src), "the seal is never written while a planned node is missing");
  assert.ok(!/fs\.getDoc\(|fs\.getDocs\(/.test(src), "no cached read: only getDocFromServer / getDocsFromServer");
  assert.ok((src.match(/await auth\(\)/g) || []).length >= 5 && (src.match(/checkAuthorized\(authorize\)/g) || []).length >= 4, "authorization is re-checked before the batch, framework, each chunk, seal, verification, completion and every rollback phase");
  assert.ok(!/deleteDoc\(batchRef|batchRef\([^)]*\)\)\s*;?\s*\/\/\s*delete/.test(src), "the batch record is never deleted");
  assert.ok(/NODE_PAGE = 500/.test(src) && /MAX_ROLLBACK_ROUNDS/.test(src), "reads and deletes are bounded");
});
test("SEAL / BARRIER / NO FALLBACK: no completion transaction, no legacy completion mode, no post-commit drift protocol; rollback moves committing -> partial BEFORE it deletes anything and ends in rolled_back", () => {
  const src = noComments("import-commit-controller.mjs"), html = noComments("index.html"), view = noComments("import-center-view.mjs"), helpers = noComments("import-run-helpers.mjs");
  assert.ok(!/runTransaction|completeInTransaction|completionMode|tx\.get|tx\.update|completed-drift/.test(src + view + helpers), "the old completion protocol is gone from the controller and the UI");
  const commitTools = html.slice(html.indexOf("commitTools:"), html.indexOf("commitTools:") + 400);
  assert.ok(commitTools.length > 100 && !/completionMode|runTransaction/.test(commitTools), "the page never selects a completion mode nor hands over a transaction function");
  const barrierAt = src.indexOf("resultCode: RESULT_CODES.rollbackStarted"), deleteAt = src.indexOf("atomic.delete(", barrierAt > 0 ? barrierAt : 0), rolledAt = src.indexOf('status: "rolled_back"');
  assert.ok(barrierAt > 0 && deleteAt > barrierAt && rolledAt > deleteAt, "barrier write precedes every delete; rolled_back is the last step");
  assert.ok(/status: "partial", resultCode: RESULT_CODES\.rollbackStarted/.test(src), "the barrier is a plain committing -> partial transition");
  assert.ok(/rollbackStarted: "ROLLBACK_STARTED"/.test(src) && /rolledBack: "ROLLED_BACK"/.test(src));
});
test("CHUNKS: the controller never builds an atomic write larger than the frozen plan chunk (400): node chunks come from plan.chunks, rollback deletes are sliced by 400", () => {
  const src = noComments("import-commit-controller.mjs");
  assert.ok(/for \(const chunk of plan\.chunks\)/.test(src) && /plan\.nodes\.slice\(chunk\.from, chunk\.to\)/.test(src));
  assert.ok(/from \+= 400/.test(src) && /slice\(from, from \+ 400\)/.test(src));
});
test("UI (import): execution is available only when the page injects commitTools; the S3 disabled placeholder remains for the read-only mode; confirmation needs an explicit acknowledgement; the success wording lives only in the completed branch", () => {
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
test("UI (P3 protection): the curriculum list marks incomplete imports (committing / partial), disables every row action for them and ignores their clicks; the P3 view never names the batch collection", () => {
  const view = text("curriculum-admin-view.mjs"), status = text("import-batch-status.mjs");
  assert.ok(status.includes("Đang nhập dữ liệu") && status.includes("Nhập chưa hoàn tất"));
  assert.ok(/importStates/.test(view) && /describeImport/.test(view) && /aria-disabled=/.test(view) && /data-fw-import-note/.test(view));
  assert.ok(/importStatus/.test(view), "the section controller receives the lookup by injection");
  assert.ok(!/importBatches/.test(noComments("curriculum-admin-view.mjs")), "the P3 view never names the batch collection");
});
