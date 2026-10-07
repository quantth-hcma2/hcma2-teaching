// LIBRARY V2 P3-S4 - source/version/index guards (pure). Edits to files owned by earlier slices are exactly the approved ones (reversal restores the P3-S3 candidate bytes
// c95595a / the P3-S2 model bytes); nothing else changed. Run: node --test test/library-v2-p3-s4/source-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseS4ModelEdits, reverseS4SectionViewEdits, reverseS4AdminViewEdits, MODEL_EDITS, SECTION_VIEW_EDITS, ADMIN_VIEW_EDITS_S4 } from "./s4-edits.mjs";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const shaText = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const count = (src, token) => src.split(token).length - 1;

test("S4.0 edits to the closed P3-S2 model are ADDITIVE only: reversing them restores the P3-S2 bytes (80e992e7...); codeInUse stays and delegates", () => {
  assert.equal(shaText(reverseS4ModelEdits(text("curriculum-model.mjs"))), "80e992e7de69d73f9d470dfa95b001020179adf8efe115e0f82df62c81506471");
  assert.equal(MODEL_EDITS.length, 1);
  const model = text("curriculum-model.mjs");
  assert.equal(count(model, "export function codeConflictOf("), 1); assert.equal(count(model, "export function codeInUse("), 1);
  assert.ok(model.includes("return codeConflictOf(nodes, code, exceptId) !== null;"));
  assert.equal(count(model, "canonicalizeNodeCode("), 4, "definition + validateTree + codeConflictOf (2: guard + compare); no second canonicalization anywhere");
  for (const f of ["curriculum-queries.mjs", "curriculum-write-contract.mjs"]) assert.equal(sha(f), { "curriculum-queries.mjs": "969f6bd5682388510035ef574f9454588f353a187d629cb93775e9cc42af2769", "curriculum-write-contract.mjs": "efc9aef867a3127a8aca766f6ddac13518610ac08202f6e3dfdbf0157211b32d" }[f], f);
});
test("S4.0 seam edits to the P3-S3 section view are exactly the approved ones (reversal restores c95595a); without options the S3 behavior is unchanged", () => {
  const view = text("curriculum-admin-view.mjs");
  const s3 = reverseS4SectionViewEdits(view);
  assert.notEqual(s3, view); assert.equal(SECTION_VIEW_EDITS.length, 4);
  assert.ok(s3.includes("const canOpen = typeof onOpenFramework === \"function\";") && s3.includes("async function mount(host, organization) {"));
  assert.ok(view.includes("async function mount(host, organization, options = {}) {") && view.includes("typeof options.onOpenFramework === \"function\" ? options.onOpenFramework : onOpenFramework"));
  assert.equal(count(view, "openHook(framework, org)"), 1); assert.ok(!view.includes("onOpenFramework(framework, org)"));
  // the view still imports nothing and still has exactly one restoreFocus contract
  assert.equal(count(view, "\nimport "), 0); assert.equal(count(view, "function restoreFocus()"), 1);
});
test("S4.0 edits to organization-admin-view are exactly the approved ones: optional frameworkEditor dependency, showDetail focus option, curriculum mount options, showFrameworkEditor", () => {
  const admin = text("organization-admin-view.mjs");
  assert.equal(ADMIN_VIEW_EDITS_S4.length, 5);
  assert.notEqual(reverseS4AdminViewEdits(admin), admin);
  assert.equal(count(admin, "function showFrameworkEditor(framework, organization) {"), 1);
  assert.equal(count(admin, "frameworkEditor.mount(container, { organization, framework, onBack:"), 1);
  assert.ok(admin.includes("async function showDetail(id, { focusFrameworkId } = {}) {"));
  assert.ok(admin.includes("...(frameworkEditor ? { onOpenFramework:"), "without a frameworkEditor dependency no Open control can appear (S3 behavior)");
  assert.ok(!admin.includes("curriculum-") && !admin.includes("buildFramework") && !admin.includes("buildNode"), "the admin view stays free of curriculum domain logic");
});
