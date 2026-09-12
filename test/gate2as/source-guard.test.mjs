// Gate 2A-S — SOURCE GUARD. Pins index.html's real render call sites so this exact class of
// regression (a future edit reintroducing href="${esc(f.link)}" directly, bypassing the
// http(s)-only render barrier) cannot recur unnoticed, without needing a browser to catch it.
// Mirrors the SOURCE GUARD pattern established in test/gate-e6/activation-facade.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const html = readFileSync(indexHtmlPath, "utf8");

test("SOURCE GUARD: group-file-link-safety.mjs is imported by index.html", () => {
  assert.match(html, /import\s*\{\s*safeGroupFileLinkUrl\s*\}\s*from\s*"\.\/group-file-link-safety\.mjs"/);
});

test("SOURCE GUARD: groupFileAnchorHtml() is defined and calls safeGroupFileLinkUrl() for the link branch, not a raw href", () => {
  const m = html.match(/function groupFileAnchorHtml\(f\)\{[\s\S]*?\n\}/);
  assert.ok(m, "could not locate groupFileAnchorHtml() in index.html");
  const body = m[0];
  assert.match(body, /safeGroupFileLinkUrl\(f\.link\)/, "groupFileAnchorHtml must route f.link through safeGroupFileLinkUrl()");
  assert.doesNotMatch(body, /href="\$\{esc\(f\.link\)\}"/, "must never put the raw, unvalidated f.link directly into an href");
});

test("SOURCE GUARD: both group-file render call sites use groupFileAnchorHtml(), not an inline f.link ternary", () => {
  const occurrences = [...html.matchAll(/fs\.map\(f=>groupFileAnchorHtml\(f\)\)/g)];
  assert.equal(occurrences.length, 2, `expected exactly 2 render call sites routed through groupFileAnchorHtml(), found ${occurrences.length}`);
  assert.doesNotMatch(html, /fs\.map\(f=>f\.link\?`<a[^`]*href="\$\{esc\(f\.link\)\}"/, "no render call site may reintroduce the old inline f.link?...esc(f.link) href pattern");
});
