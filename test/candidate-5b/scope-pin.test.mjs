// CANDIDATE 5B (reconciled onto production 87ff3bd) — scope pins. Pure file/git reads; no browser, no emulator.
// Proves the Unified Trash candidate changes ONLY its intended files and leaves RichText V3, Group PDF V1, the
// vendored PDF assets, Firestore Rules and Storage/CORS configuration byte-identical to production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = "87ff3bd9d9086bdfdeafaf1667a5d0a6c7ebd6e2";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
const shaOf = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();
const sha = (file) => shaOf(readFileSync(path.join(root, file)));
const baselineSha = (file) => shaOf(execFileSync("git", ["show", `${BASELINE}:${file}`], { cwd: root, maxBuffer: 1 << 26 }));

test("baseline: the pinned production commit exists and is the ancestor this candidate was built on", () => {
  assert.equal(git("cat-file", "-t", BASELINE).trim(), "commit");
  git("merge-base", "--is-ancestor", BASELINE, "HEAD");
});

test("scope: relative to production 87ff3bd only the intended Unified Trash files differ", () => {
  const changed = git("diff", "--name-only", BASELINE).split(/\r?\n/).filter(Boolean).sort();
  const allowed = new Set(["firestore.indexes.json", "index.html", "trash-query-contract.mjs"]);
  const extras = changed.filter((f) => !allowed.has(f) && !f.startsWith("test/candidate-5b/"));
  assert.deepEqual(extras, [], `unexpected changed files: ${extras.join(", ")}`);
  assert.ok(changed.includes("trash-query-contract.mjs") && changed.includes("index.html") && changed.includes("firestore.indexes.json"));
});

test("RichText V3: every RichText module is byte-identical to production", () => {
  for (const f of ["rich-text-contract.mjs", "rich-text-renderer.mjs", "rich-text-editor.mjs", "rich-text-editor-serializer.mjs", "group-file-link-safety.mjs"]) assert.equal(sha(f), baselineSha(f), f);
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(html.includes("[data-rt-text-region]{outline:none; padding:0 8px;}"), "R3 inner caret gutter CSS still present");
});

test("Group PDF V1: modules, vendored assets and index.html wiring are untouched", () => {
  for (const f of ["group-pdf-export.mjs", "group-pdf-runtime.mjs", "group-pdf-font-coverage.mjs", "vendor/pdf/SHA256SUMS.txt", "vendor/pdf/PROVENANCE.md", "package.json"]) assert.equal(sha(f), baselineSha(f), f);
  const dir = path.join(root, "vendor", "pdf");
  const lines = readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 12);
  for (const line of lines) { const [hash, file] = line.trim().split(/\s+/); assert.equal(shaOf(readFileSync(path.join(dir, file))), hash, `vendor/pdf/${file}`); }
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  for (const needle of ['import { exportGroupPdf } from "./group-pdf-runtime.mjs?v=20261002-pdf-v1";', 'data-group-pdf="${i}"', "async function startGroupPdfExport(group){", "async function groupPdfFetchImageBytes(request){"]) assert.ok(html.includes(needle), needle);
});

test("Rules and Storage/CORS: Firestore Rules unchanged; no Storage rules or CORS file exists or was added", () => {
  for (const f of ["firestore.rules", "firestore.rules.production-candidate"]) assert.equal(sha(f), baselineSha(f), f);
  assert.equal(sha("firestore.rules.production-candidate"), "218BFF3BDB4D82CA82E2161583E23CCB95589F288F8B8573B5863E65B6C3880F", "raw hash of the file saved in the Vault as effective ruleset f1677b5a");
  const files = git("ls-files").split(/\r?\n/).filter((f) => /(^|\/)(storage\.rules|cors\.json)$/i.test(f));
  assert.deepEqual(files, []);
  assert.ok(!existsSync(path.join(root, "storage.rules")) && !existsSync(path.join(root, "cors.json")));
});

test("indexes: the file differs from production by EXACTLY the one Interaction trash index declaration", () => {
  const base = JSON.parse(execFileSync("git", ["show", `${BASELINE}:firestore.indexes.json`], { cwd: root, encoding: "utf8" }));
  const now = JSON.parse(readFileSync(path.join(root, "firestore.indexes.json"), "utf8"));
  const added = { collectionGroup: "sessions", queryScope: "COLLECTION", fields: [{ fieldPath: "ownerId", order: "ASCENDING" }, { fieldPath: "deletedAt", order: "DESCENDING" }] };
  const key = (i) => JSON.stringify(i);
  assert.deepEqual(now.indexes.map(key).sort(), [...base.indexes, added].map(key).sort());
  assert.deepEqual({ ...now, indexes: undefined }, { ...base, indexes: undefined });
});

test("contract module: the frozen 5A/5B query contract is byte-identical to the previously reviewed file", () => {
  assert.equal(sha("trash-query-contract.mjs"), "A4639903403D88BB4CC1BB0D197E6C16A0B967242554975F2C47B33121EFC7EA");
});

test("Unified Trash V1 boundaries in index.html: restore only, three filters, no central collection, no Knowledge, module-local trash kept", () => {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const a = html.indexOf("async function teacherTrash(c){"), b = html.indexOf("async function teacherHistory(", a);
  assert.ok(a > 0 && b > a);
  const unified = html.slice(a, b);
  for (const needle of ['data-trash-filter="all"', 'data-trash-filter="interaction"', 'data-trash-filter="group"', "data-unified-restore", "restoreInteractionSession(id)", "restoreGroupActivity(id)"]) assert.ok(unified.includes(needle), needle);
  for (const forbidden of ["data-hard", "confirmAndDeleteSession", "deleteDoc(", "XÓA VĨNH VIỄN", "knowledge", "Knowledge", "setDoc(", "addDoc(", "writeBatch("]) assert.ok(!unified.includes(forbidden), `Unified Trash must not contain ${forbidden}`);
  assert.ok(html.includes('id="btnInteractionLocalTrash"') && html.includes("async function teacherInteractionTrash(c){"), "module-local THÙNG RÁC PHIÊN remains");
  const local = html.slice(html.indexOf("async function teacherInteractionTrash(c){"), a);
  assert.ok(local.includes("data-hard") && local.includes("confirmAndDeleteSession"), "permanent delete stays only in the module-local screen");
  assert.ok(!/collection\(db,\s*["'](trash|unifiedTrash|trashItems)["']/.test(html), "no central trash collection");
});
