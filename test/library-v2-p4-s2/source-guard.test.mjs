// P4-S2 - scope guard (pure): the slice is ADDITIVE and INERT. Nothing existing is modified or wired; Rules, indexes, Storage, V1 export and the web are untouched.
// Run: node --test test/library-v2-p4-s2/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "a736469ad3666ac8be245a21b0428f73414589fa";           // P4-S1 closure = the approved baseline (origin/main)
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha = (path) => createHash("sha256").update(readFileSync(root + path)).digest("hex");
const ALLOWED = [/^import-(capabilities|diagnostics|normalize|plan|sha256|template|validate|xml-wellformed)\.mjs$/, /^import-xlsx-(container|extract|reader|worker)\.mjs$/, /^vendor\/sheetjs-0\.20\.3\/(xlsx\.mjs|LICENSE|PROVENANCE\.md)$/, /^test\/library-v2-p4-s2\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/];

test("SCOPE: relative to the approved baseline the working tree only ADDS files from the P4-S2 allow-list (no modification, deletion or rename of any existing file)", () => {
  const changed = git("diff", "--name-status", BASE).split("\n").filter(Boolean).map((line) => line.split("\t"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((path) => ["A", path]);
  const all = [...changed, ...untracked];
  assert.ok(all.length > 0);
  const ALIGNED = "test/library-v2-p2-s2/source-guard.test.mjs";      // historical "only these root modules exist" list: the ten new module names are appended (precedent P3-S2/S4 alignments)
  for (const [status, path] of all) {
    if (path === ALIGNED) { assert.equal(status, "M"); continue; }
    assert.equal(status, "A", "only additions are allowed: " + status + " " + path);
    assert.ok(ALLOWED.some((re) => re.test(path)), "outside the allow-list: " + path);
  }
  const diff = git("diff", "-U0", BASE, "--", ALIGNED).split(String.fromCharCode(10)).filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
  assert.equal(diff.length, 2, "exactly one line replaced in the aligned guard");
  const removed = diff.find((l) => l.startsWith("-")).slice(1), added = diff.find((l) => l.startsWith("+")).slice(1);
  const stem = removed.slice(0, removed.indexOf("].sort());"));
  assert.ok(added.startsWith(stem), "the original expectation is preserved verbatim and only extended");
  assert.ok(!removed.includes("import-diagnostics"));
  assert.equal([...added.matchAll(/"import-[a-z0-9-]+\.mjs"/g)].length, 12, "exactly the twelve new module names are appended");
  assert.ok(all.some(([, path]) => path === "import-xlsx-worker.mjs") && all.some(([, path]) => path === "vendor/sheetjs-0.20.3/xlsx.mjs"));
});
test("SCOPE: Firestore Rules, indexes, package manifest, the V1 roster export library and index.html are byte-identical to the baseline", () => {
  const pins = {
    "firestore.rules.production-candidate": "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99"
  };
  for (const [path, expected] of Object.entries(pins)) assert.equal(sha(path), expected, path);
  for (const path of ["index.html", "group-roster.mjs", "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-clone-delete.mjs", "curriculum-queries.mjs", "curriculum-admin-view.mjs", "curriculum-editor-view.mjs", "organization-admin-view.mjs", "admin-feature-registry.mjs"]) {
    assert.equal(sha(path), createHash("sha256").update(execFileSync("git", ["show", BASE + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 })).digest("hex"), path + " unchanged");
  }
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.throws(() => readFileSync(root + f), /ENOENT/, f + " must not exist at the repository root");
});
test("INERT: no existing module or page imports the new import modules or the new vendored reader (nothing is wired; P4-S3 owns the UI)", () => {
  const offenders = [];
  for (const file of readdirSync(root).filter((name) => /\.(mjs|html|js)$/.test(name))) {
    if (/^import-(capabilities|diagnostics|normalize|plan|sha256|template|validate|xml-wellformed|xlsx-)/.test(file)) continue;
    const text = readFileSync(root + file, "utf8");
    if (/import-(capabilities|diagnostics|normalize|plan|sha256|template|validate|xml-wellformed|xlsx-(container|extract|reader|worker))|sheetjs-0\.20\.3/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
test("BOUNDARIES: no P4-S3/S4 artefact exists (no Import Center view, no batch writer, no Firestore access in any new module)", () => {
  const files = readdirSync(root).filter((name) => /^import-.*\.mjs$/.test(name));
  assert.deepEqual(files.sort(), ["import-capabilities.mjs", "import-diagnostics.mjs", "import-normalize.mjs", "import-plan.mjs", "import-sha256.mjs", "import-template.mjs", "import-validate.mjs", "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-xml-wellformed.mjs"]);
  for (const file of files) {
    const code = readFileSync(root + file, "utf8").split("\n").map((line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line)).join("\n");
    assert.ok(!/firebase|firestore|setDoc|updateDoc|writeBatch|addDoc|deleteDoc|runTransaction|localStorage|sessionStorage|indexedDB|document\./.test(code), file + " touches storage/Firestore/DOM");
  }
});
