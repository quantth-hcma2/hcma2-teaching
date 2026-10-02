// GROUP PDF V1 — the vendored pdfmake bundle, fonts and licenses must stay byte-identical to the recorded
// provenance. A change to any file under vendor/pdf requires updating SHA256SUMS.txt and PROVENANCE.md together.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendor = path.join(root, "vendor", "pdf");
const sums = readFileSync(path.join(vendor, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/).map((line) => {
  const m = /^([0-9A-F]{64})\s+(.+)$/.exec(line.trim());
  assert.ok(m, `bad SHA256SUMS line: ${line}`);
  return { sha: m[1], file: m[2] };
});
const provenance = readFileSync(path.join(vendor, "PROVENANCE.md"), "utf8").toUpperCase();

test("vendor: every recorded SHA-256 matches the shipped file byte for byte", () => {
  assert.ok(sums.length >= 12);
  for (const { sha, file } of sums) {
    const full = path.join(vendor, file);
    assert.ok(existsSync(full), `missing ${file}`);
    assert.equal(createHash("sha256").update(readFileSync(full)).digest("hex").toUpperCase(), sha, file);
  }
});

test("vendor: exactly the pinned artifacts are present (pdfmake 0.3.11, Roboto x4, Tinos x4, licenses)", () => {
  const files = sums.map((s) => s.file).sort();
  assert.deepEqual(files, [
    "PDFMAKE-LICENSE.txt", "fonts/Roboto-Bold.ttf", "fonts/Roboto-BoldItalic.ttf", "fonts/Roboto-Italic.ttf", "fonts/Roboto-OFL.txt",
    "fonts/Roboto-Regular.ttf", "fonts/Tinos-Bold.ttf", "fonts/Tinos-BoldItalic.ttf", "fonts/Tinos-Italic.ttf", "fonts/Tinos-OFL.txt",
    "fonts/Tinos-Regular.ttf", "pdfmake.min.js"
  ]);
  assert.match(readFileSync(path.join(vendor, "pdfmake.min.js"), "utf8").slice(0, 200), /pdfmake v0\.3\.11, @license MIT/);
  assert.match(readFileSync(path.join(vendor, "fonts", "Roboto-OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i);
  assert.match(readFileSync(path.join(vendor, "fonts", "Tinos-OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i);
});

test("vendor: PROVENANCE.md records the SHA-256 of the bundle and of every font file", () => {
  for (const { sha, file } of sums) {
    if (file.endsWith(".ttf") || file === "pdfmake.min.js") assert.ok(provenance.includes(sha), `PROVENANCE.md is missing the SHA-256 of ${file}`);
  }
  for (const needle of ["PDFMAKE@0.3.11", "ROBOTO 3.015", "TINOS 1.340", "SHA512-"]) assert.ok(provenance.includes(needle), needle);
});

test("vendor: .gitattributes pins the folder byte-exact (no line-ending conversion)", () => {
  assert.match(readFileSync(path.join(vendor, ".gitattributes"), "utf8"), /^\* -text\s*$/m);
});
