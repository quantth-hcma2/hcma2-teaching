// LIBRARY V2 P4-S5-B - scope / safety guard (pure). The slice adds the audit module, the duplicate-file lookup (controller), the advisory warning and the audit status in the Import Center view / helpers, the
// index.html wiring, tests and the emulator QA launcher. NO Rules, index, Storage, dependency or schema change; every other production file is byte-identical to the production web release c6c66ed.
// Run: node --test test/library-v2-p4-s5/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { INDEX_EDITS_P4S5, reverseP4S5IndexEdits } from "./p4s5-edits.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "c6c66edda294d30fca9db6fb19ea8afecbef782b";                      // production web release of P4-S4 = the approved baseline of this slice
const RULES_SHA = "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A";   // live ruleset 02ca5a30
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitBuf = (rev, path) => execFileSync("git", ["show", rev + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const text = (p) => readFileSync(root + p, "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(root + p)).digest("hex");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");
const noComments = (p) => text(p).replace(/\/\/.*$/gm, "");
const ADDED_OK = [/^import-audit\.mjs$/, /^test\/library-v2-p4-s5\/[A-Za-z0-9._-]+$/];
const MODIFIED_OK = new Set([
  "index.html", "import-center-view.mjs", "import-center-engine.mjs", "import-commit-controller.mjs", "import-run-helpers.mjs",                                // the slice's own edits
  "test/library-v2-p4-s4/source-guard.test.mjs", "test/library-v2-p4-s4/p4s4-edits.mjs", "test/library-v2-p4-s4/harness.html", "test/library-v2-p4-s4/ui.e2e.mjs", "test/library-v2-p4-s3/source-guard.test.mjs", "test/library-v2-p2-s2/source-guard.test.mjs"   // earlier guards aligned
]);

test("SCOPE: relative to the production web release c6c66ed the tree only ADDS the audit module and this slice's tests/launcher, and modifies ONLY the approved files (no deletion or rename)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((line) => line.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ["A", p]);
  const all = [...changed, ...untracked];
  assert.ok(all.length > 0);
  for (const [status, path] of all) {
    if (status === "A") assert.ok(ADDED_OK.some((re) => re.test(path)), "added outside the allow-list: " + path);
    else if (status === "M") assert.ok(MODIFIED_OK.has(path), "modified outside the allow-list: " + path);
    else assert.fail("only additions and approved modifications are allowed: " + status + " " + path);
  }
  assert.ok(all.some(([, p]) => p === "import-audit.mjs"));
});
test("PINS: Firestore Rules (live ruleset 02ca5a30), indexes, package manifest, the legacy firestore.rules, Storage, the V1 export library, the SheetJS vendor copy, the P2-P4 modules and the P3 contracts are byte-identical to the production release", () => {
  assert.equal(sha("firestore.rules.production-candidate").toUpperCase(), RULES_SHA, "the Rules candidate is exactly the live artifact");
  for (const f of ["firestore.rules.production-candidate", "firestore.indexes.json", "firestore.rules", "package.json", "package-lock.json", "vendor/xlsx.full.min.js", "vendor/sheetjs-0.20.3/xlsx.mjs", "group-roster.mjs",
    "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-queries.mjs", "curriculum-clone-delete.mjs", "curriculum-editor-view.mjs", "curriculum-admin-view.mjs", "organization-admin-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs",
    "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-normalize.mjs", "import-validate.mjs", "import-plan.mjs", "import-diagnostics.mjs", "import-sha256.mjs", "import-capabilities.mjs", "import-xml-wellformed.mjs",
    "import-template.mjs", "import-template-writer.mjs", "import-batch-status.mjs", "app-environment.mjs"]) assert.equal(sha(f), shaBuf(gitBuf(BASE, f)), f + " unchanged");
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(root + f), f + " must not exist at the repository root");
});
test("EDITS: index.html differs from the production release by EXACTLY the three pinned edit pairs (reversal restores the c6c66ed bytes): two cache tokens and ONE injected `auditTools` dependency", () => {
  assert.equal(INDEX_EDITS_P4S5.length, 3);
  const html = text("index.html");
  assert.equal(shaBuf(Buffer.from(reverseP4S5IndexEdits(html), "utf8")), shaBuf(gitBuf(BASE, "index.html")));
  assert.ok(html.includes('./import-center-view.mjs?v=20261014-p5b') && html.includes('./import-center-engine.mjs?v=20261014-p5b'));
  assert.equal([...html.matchAll(/auditTools:\{ firestore:\{doc,setDoc,getDocFromServer,serverTimestamp\}, actor:\(\)=>\(\{uid:STATE\.user\?\.uid\|\|null,email:STATE\.profile\?\.email\|\|STATE\.user\?\.email\|\|"",name:STATE\.profile\?\.displayName\|\|"",role:STATE\.profile\?\.role\|\|""\}\) \}/g)].length, 1, "exactly one audit dependency, with exactly four Firestore functions");
  assert.ok(!/addDoc\(collection\(db,"auditLogs"\)[^)]*import/.test(html), "the shared logAudit helper is not used for import events");
  const removed = git("diff", "-U0", "--no-color", BASE, "--", "index.html").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  assert.equal(removed, 3, "index.html removed lines: " + removed);
  assert.ok(/^\s*import\s*\{ createImportCenter \} from/m.test(html) && !/^\s*import\s[^;]*import-(audit|center-engine|commit-controller|run-helpers)/m.test(html), "the engine / audit module are never statically imported by the page (lazy)");
});
test("AUDIT MODULE: no imports; the ONLY file naming auditLogs among the import modules; creates through setDoc on a deterministic id (never addDoc / update / delete); exactly the three approved actions; the rollback barrier cannot yield `partial`", () => {
  const src = noComments("import-audit.mjs");
  assert.ok(!/^\s*import\s/m.test(src), "imports nothing (the Firestore functions and the actor are injected)");
  assert.ok(/AUDIT_COLLECTION = "auditLogs"/.test(src));
  assert.ok(!/\b(addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|collection\()/.test(src), "no non-idempotent or destructive API");
  assert.equal([...src.matchAll(/fs\.setDoc\(/g)].length, 1); assert.ok(/return "import_" \+ batchId \+ "_" \+ kind;|"import_" \+ batchId \+ "_" \+ kind/.test(src));
  const actions = [...src.matchAll(/"(curriculum\.import\.[A-Za-z]+)"/g)].map((m) => m[1]).sort(); assert.deepEqual([...new Set(actions)], ["curriculum.import.completed", "curriculum.import.partial", "curriculum.import.rolledBack"]);
  assert.ok(/ROLLBACK_STARTED/.test(src) && /ROLLBACK_BARRIER/.test(src), "the barrier state is refused");
  assert.ok(/NOT_COMPLETED/.test(src) && /NOT_ROLLED_BACK/.test(src) && /NOT_PARTIAL/.test(src), "an event needs the matching CONFIRMED batch status");
  for (const f of ["import-commit-controller.mjs", "import-center-view.mjs", "import-run-helpers.mjs", "import-center-engine.mjs", "import-batch-status.mjs"]) assert.ok(!/auditLogs/.test(noComments(f)), f + " does not name auditLogs");
});
test("VIEW: audit events are emitted from exactly three CONFIRMED points (completed, rolledBack, verification-failed with markedPartial and a confirmed batch); the view names no Firestore write API; a failed or unverified audit never changes the business result", () => {
  const view = noComments("import-center-view.mjs");
  assert.equal([...view.matchAll(/auditConfirmed\(state\.run, \{ kind: "(completed|rolledBack|partial)"/g)].map((m) => m[1]).sort().join(","), "completed,partial,rolledBack");
  assert.ok(/if \(result\.state === "verification-failed" && result\.markedPartial === true && result\.batch\) auditConfirmed/.test(view));
  assert.ok(/batch: result\.batch, resumed: !!resume/.test(view) && /batch: result\.batch, nodesDeleted: result\.nodesDeleted/.test(view), "events are built from the controller's confirmed batch");
  assert.ok(!/\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\b/.test(view) && !/importBatches|curriculumFrameworks|auditLogs/.test(view), "the view still names no write API and no collection");
  const recordAt = view.indexOf("async function recordAudit"), end = view.indexOf("function auditConfirmed");
  const body = view.slice(recordAt, end); assert.ok(!/state\.run\s*=\s*\{/.test(body) && !/rollback|commit\(/.test(body), "recordAudit only annotates the run; it never rewrites or re-runs the business result");
  assert.ok(/data-imp-action="audit-retry"|id="impAuditRetry"/.test(text("import-run-helpers.mjs")));
});
test("DUPLICATE LOOKUP: ONE query with exactly three equality filters (organizationId, sourceFile.sha256, status == completed) and a limit - no orderBy, no range, no `in`, no index; unknown is reported as ok:false; the view never calls it when resuming and gates confirmation on an unknown answer", () => {
  const src = noComments("import-commit-controller.mjs");
  const start = src.indexOf("async function findCompletedBySourceHash"), end = src.indexOf("const settle", start);
  const fn = src.slice(start, end);
  assert.deepEqual([...fn.matchAll(/fs\.where\("([A-Za-z0-9.]+)", "==", ([A-Za-z0-9"]+)\)/g)].map((m) => [m[1], m[2]]), [["organizationId", "organizationId"], ["sourceFile.sha256", "sha256"], ["status", "\"completed\""]]);
  assert.ok(/fs\.limit\(DUPLICATE_LOOKUP_LIMIT\)/.test(fn) && !/orderBy|startAfter|"in"|"array-contains"|"<"|">"/.test(fn));
  assert.ok(/if \(!r\.ok\) return freeze\(\{ ok: false, kind: r\.kind \}\);/.test(fn), "a failed lookup is UNKNOWN, never 'none'");
  const view = noComments("import-center-view.mjs");
  assert.ok(/if \(!commitEnabled\(\) \|\| !engine \|\| state\.resume \|\|/.test(view), "no lookup when resuming");
  assert.ok(/state\.dup\.status === "checking" \|\| \(state\.dup\.status === "unavailable" && !state\.dupAck\)/.test(view), "confirmation waits for the lookup / the explicit acknowledgement");
  assert.ok(/Không thể kiểm tra lịch sử nhập tệp/.test(text("import-run-helpers.mjs")));
});
test("COLLECTIONS: the controller still names exactly importBatches, curriculumFrameworks and nodes; the engine re-exports the audit module with a cache token; the launcher is emulator-only", () => {
  const raw = noComments("import-commit-controller.mjs");
  const names = new Set([...raw.matchAll(/"(importBatches|curriculumFrameworks|nodes|users|organizations|organizationMembers|userCapabilities|auditLogs|knowledge[A-Za-z]*|sessions|classes)"/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), ["curriculumFrameworks", "importBatches", "nodes"]);
  assert.deepEqual([...text("import-commit-controller.mjs").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort(), ["./curriculum-model.mjs", "./import-plan.mjs", "./import-sha256.mjs"]);
  const engine = text("import-center-engine.mjs");
  for (const m of ["import-audit", "import-commit-controller", "import-run-helpers"]) assert.ok(engine.includes('./' + m + '.mjs?v=20261014-p5b"'), m + " carries the cache token");
  const qa = text("test/library-v2-p4-s5/qa-env.mjs");
  assert.ok(/const PROJECT = "demo-hcma2-production-prep"/.test(qa) && /if \(!\/\^demo-\/\.test\(PROJECT\)\)/.test(qa), "demo project id only");
  assert.ok(/server\.listen\(PORT, "127\.0\.0\.1"/.test(qa), "binds the loopback interface only");
  assert.ok(qa.includes(RULES_SHA) && /Từ chối chạy/.test(qa), "refuses to start unless the Rules are the approved live artifact");
  assert.ok(!/firebase\.cmd?"?,\s*\[?"deploy|bo-phieu-hcma2|teaching\.quantth\.vn/.test(qa.replace(/\/\/.*$/gm, "")), "the launcher never names the production project, host or a deploy command");
});
