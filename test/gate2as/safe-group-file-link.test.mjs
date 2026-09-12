// Gate 2A-S — pure unit tests for group-file-link-safety.mjs, the client-render-time barrier.
// No emulator needed. This is the barrier that must fail closed even for a historical document
// that bypassed the (pre-Gate-2A-S) scheme-less Rules — see rules-file-link.test.mjs's LEGACY
// test for the matching Rules-side proof that such a document remains readable, unmodified.

import test from "node:test";
import assert from "node:assert/strict";
import { safeGroupFileLinkUrl } from "../../group-file-link-safety.mjs";

test("ALLOW: https:// link returns the normalized href", () => {
  assert.equal(safeGroupFileLinkUrl("https://example.com/doc"), "https://example.com/doc");
});

test("ALLOW: http:// link returns the normalized href", () => {
  assert.equal(safeGroupFileLinkUrl("http://example.com/doc"), "http://example.com/doc");
});

const unsafe = {
  "javascript: scheme": "javascript:alert(1)",
  "JAVASCRIPT: scheme (case-insensitive)": "JAVASCRIPT:alert(1)",
  "data: scheme": "data:text/html,<script>alert(1)</script>",
  "vbscript: scheme": "vbscript:msgbox(1)",
  "file: scheme": "file:///etc/passwd",
  "blob: scheme": "blob:https://example.com/9c1f-uuid",
  "protocol-relative //host (no explicit scheme)": "//evil.example/path",
  "leading-whitespace-prefixed javascript:": " javascript:alert(1)",
  "malformed non-URL string": "not a url at all",
  "empty string": "",
  "null": null,
  "undefined": undefined,
  "number": 12345,
  "object": { toString: () => "https://example.com" }
};

for (const [label, value] of Object.entries(unsafe)) {
  test(`DENY (render): ${label} -> null (never becomes an href)`, () => {
    assert.equal(safeGroupFileLinkUrl(value), null);
  });
}

test("LEGACY: fails closed for the exact historical value proven readable in the Rules test", () => {
  // Mirrors rules-file-link.test.mjs's "files — LEGACY" test: a pre-Gate-2A-S document could
  // exist with this exact value. Rules leave it readable (no migration); this is what makes it
  // safe to display anyway.
  assert.equal(safeGroupFileLinkUrl("javascript:alert(1)"), null);
});
