// P4-S2 - scope guard (pure). The P4-S2 modules are inert, additive and FROZEN: after the slice closed (61ce306) later slices may add files and wire the UI, but the approved
// reader / security gates / validation / plan modules and the vendored reader stay byte-identical. (P4-S3 aligned: the original "working tree only ADDS files relative to the
// P4-S1 baseline" check became this frozen-bytes check; the scope of P4-S3 itself is guarded by test/library-v2-p4-s3/source-guard.test.mjs.)
// Run: node --test test/library-v2-p4-s2/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const P4S2_CLOSURE = "61ce3061c8b2cf6a52eb7c9517640632cc60e463";          // P4-S2 closure = origin/main when P4-S3 started
const BASE = "a736469ad3666ac8be245a21b0428f73414589fa";                  // P4-S1 closure
const gitShow = (rev, path) => execFileSync("git", ["show", rev + ":" + path], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sha = (path) => createHash("sha256").update(readFileSync(root + path)).digest("hex");
const shaBuf = (buf) => createHash("sha256").update(buf).digest("hex");
const P4S2_MODULES = ["import-capabilities.mjs", "import-diagnostics.mjs", "import-normalize.mjs", "import-plan.mjs", "import-sha256.mjs", "import-validate.mjs", "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-xml-wellformed.mjs"];

test("FROZEN: the approved P4-S2 reader, security gates, normalization, validation and plan modules and the vendored SheetJS 0.20.3 are byte-identical to the P4-S2 closure commit", () => {
  for (const file of [...P4S2_MODULES, "vendor/sheetjs-0.20.3/xlsx.mjs", "vendor/sheetjs-0.20.3/LICENSE", "vendor/sheetjs-0.20.3/PROVENANCE.md"]) assert.equal(sha(file), shaBuf(gitShow(P4S2_CLOSURE, file)), file + " must not change after the P4-S2 closure");
  assert.equal(sha("vendor/sheetjs-0.20.3/xlsx.mjs"), "1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
});
test("SCOPE: Firestore Rules, indexes, package manifest and the V1 roster export library are byte-identical to the P4-S1 baseline; existing curriculum/organization data modules are unchanged", () => {
  const pins = {
    "firestore.rules.production-candidate": "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99"
  };
  for (const [path, expected] of Object.entries(pins)) assert.equal(sha(path), expected, path);
  for (const path of ["group-roster.mjs", "curriculum-model.mjs", "curriculum-write-contract.mjs", "curriculum-clone-delete.mjs", "curriculum-queries.mjs", "curriculum-editor-view.mjs", "organization-queries.mjs", "organization-write-contract.mjs", "admin-feature-registry.mjs"]) {
    assert.equal(sha(path), shaBuf(gitShow(BASE, path)), path + " unchanged");
  }
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.throws(() => readFileSync(root + f), /ENOENT/, f + " must not exist at the repository root");
});
test("INERT: the P4-S2 modules are referenced only by the import modules themselves; no page or existing module references them or the vendored reader directly (the Import Center reaches them through the lazy engine)", () => {
  const offenders = [];
  for (const file of readdirSync(root).filter((name) => /\.(mjs|html|js)$/.test(name))) {
    if (/^import-/.test(file)) continue;
    const text = readFileSync(root + file, "utf8");
    if (/import-(capabilities|diagnostics|normalize|plan|sha256|validate|xml-wellformed|xlsx-(container|extract|reader|worker))|sheetjs-0\.20\.3/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
test("BOUNDARIES: the P4-S2 modules never touch Firestore, storage, the network or the DOM", () => {
  for (const file of P4S2_MODULES) {
    const code = readFileSync(root + file, "utf8").split("\n").map((line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line)).join("\n");
    assert.ok(!/firebase|firestore|setDoc|updateDoc|writeBatch|addDoc|deleteDoc|runTransaction|localStorage|sessionStorage|indexedDB|document\./.test(code), file + " touches storage/Firestore/DOM");
  }
});
