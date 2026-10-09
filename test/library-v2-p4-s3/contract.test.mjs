// LIBRARY V2 P4-S3 final correction B + C - (B) the two approved downloads (blank + example) share ONE frozen XLSX v1 schema, identical to the P4-S2 closure;
// (C) framework code: the deployed P3 framework schema has NO code field, so the template has no framework-code column and the preview states "không áp dụng".
// Run: node --test test/library-v2-p4-s3/contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as current from "../../import-template.mjs";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import { materializePayloads, prepareCommit } from "../../import-plan.mjs";
import { validateRaw } from "../library-v2-p4-s2/helpers.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "61ce3061c8b2cf6a52eb7c9517640632cc60e463";
const text = (p) => readFileSync(root + p, "utf8");

test("B. TWO TEMPLATES, ONE SCHEMA: blank and example differ ONLY in data rows; sheets, order, headers, column definitions, _meta and checksum are identical to each other and to the P4-S2 closure (no column added, no metadata changed)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p4s3-base-"));
  for (const name of ["import-template.mjs", "import-sha256.mjs"]) writeFileSync(join(dir, name), execFileSync("git", ["show", BASE + ":" + name], { cwd: root, maxBuffer: 1 << 26 }));   // the closure copy and its only dependency
  const base = await import(pathToFileURL(join(dir, "import-template.mjs")).href);
  assert.deepEqual(current.SHEET_COLUMNS, base.SHEET_COLUMNS); assert.deepEqual([...current.TEMPLATE_SHEET_NAMES], [...base.TEMPLATE_SHEET_NAMES]);
  assert.deepEqual([...current.META_KEYS], [...base.META_KEYS]); assert.equal(current.TEMPLATE_HEADER_CHECKSUM, base.TEMPLATE_HEADER_CHECKSUM);
  assert.equal(current.TEMPLATE_ID, base.TEMPLATE_ID); assert.equal(current.TEMPLATE_SCHEMA_VERSION, base.TEMPLATE_SCHEMA_VERSION); assert.equal(current.TEMPLATE_GENERATOR, base.TEMPLATE_GENERATOR);
  assert.deepEqual(current.TEMPLATE_STRICTNESS, base.TEMPLATE_STRICTNESS); assert.deepEqual(current.IMPORT_LIMITS, base.IMPORT_LIMITS);
  const closureBlank = base.buildTemplateSheets(), blank = current.buildTemplateSheets(), example = current.buildTemplateSheets({ withExample: true });
  assert.deepEqual(blank, closureBlank, "the blank template is byte-for-byte the P4-S2 closure template");
  assert.deepEqual(Object.keys(example), Object.keys(blank));
  assert.deepEqual(example["_meta"], blank["_meta"], "_meta is identical");
  for (const sheet of Object.keys(blank)) {
    if (!Array.isArray(blank[sheet])) continue;
    assert.deepEqual(example[sheet][0], blank[sheet][0], sheet + ": header row identical");
    if (sheet !== "HƯỚNG DẪN") assert.deepEqual(example[sheet][0].length, blank[sheet][0].length, sheet + ": same column count");
  }
  for (const sheet of ["KHUNG", "MÔN", "BÀI"]) {
    const widths = new Set([...(blank[sheet] || [])].concat(example[sheet] || []).map((row) => row.length));
    assert.equal(widths.size, 1, sheet + ": every row of both templates has the frozen number of columns");
  }
  assert.equal(example.KHUNG.length, 2); assert.equal(example.MÔN.length, 4); assert.equal(example.BÀI.length, 8);
  assert.equal(blank.KHUNG.length, 1); assert.equal(blank.MÔN.length, 1); assert.equal(blank.BÀI.length, 1);
});

test("B. DECISION RECORD: the two download buttons, their distinct file names and the Vietnamese explanation of the difference exist in the Import Center", () => {
  const view = text("import-center-view.mjs");
  assert.ok(view.includes('id="impTemplateBlank"') && view.includes('id="impTemplateExample"'));
  assert.notEqual(current.TEMPLATE_FILE_NAMES.blank, current.TEMPLATE_FILE_NAMES.example);
  assert.match(current.TEMPLATE_FILE_NAMES.example, /co_vi_du/);
});

test("C. FRAMEWORK CODE = UNSUPPORTED by the deployed P3 schema: the Rules' framework shape, the P3 write contract and the P4 plan payload carry no `code` field; the template has no framework-code column", () => {
  const rules = text("firestore.rules.production-candidate");
  const shape = rules.slice(rules.indexOf("function fwShapeOk(d)"), rules.indexOf("allow create", rules.indexOf("function fwShapeOk(d)")));
  assert.ok(shape.includes("hasAll(['schemaVersion', 'organizationId', 'scope', 'name', 'status', 'createdAt', 'createdBy', 'updatedAt'])"));
  assert.ok(shape.includes("hasOnly(['schemaVersion', 'organizationId', 'scope', 'name', 'status', 'createdAt', 'createdBy', 'updatedAt', 'activatedAt', 'statusChangedAt', 'statusChangedBy', 'cloneSource'])"));
  assert.ok(!/'code'/.test(shape), "the framework document shape has no code");
  const contract = createCurriculumWriteContract({ serverTimestamp: () => "TS" });
  const created = contract.buildFrameworkCreate({ organization: { id: "orgA", status: "active" }, name: "Khung kiểm tra" }, "u1");
  assert.ok(!("code" in created)); assert.deepEqual(Object.keys(created).sort(), ["createdAt", "createdBy", "name", "organizationId", "schemaVersion", "scope", "status", "updatedAt"]);
  const r = validateRaw({ subjects: [["A", "Môn A", 1]], lessons: [["A", "A-1", "Bài 1", 1]] });
  assert.equal(r.ok, true);
  const prepared = prepareCommit(r.model, { organization: { id: "orgA", status: "active" }, batchId: "Ab12Cd34Ef56Gh78Ij90", actorUid: "u1" });
  assert.equal(prepared.ok, true);
  const payloads = materializePayloads(prepared.plan, { actorUid: "u1", serverTimestamp: () => "TS" });
  assert.ok(!("code" in payloads.framework.data), "the planned framework document has no code");
  assert.ok(payloads.chunks.flatMap((c) => c.writes).every((w) => "code" in w.data), "codes exist on subject/lesson NODES (business code per node)");
  assert.deepEqual(current.SHEET_COLUMNS.KHUNG.map((c) => c.header), ["Tên khung chương trình"], "the KHUNG sheet is the framework NAME only");
});

test("C. PREVIEW WORDING: the preview shows the framework NAME and says the framework code does not apply (codes live on subjects and lessons); it promises no internal code", () => {
  const view = text("import-center-view.mjs");
  assert.ok(view.includes("Mã khung: không áp dụng (khung chương trình chỉ có tên; mã nghiệp vụ nằm ở từng môn và bài)"));
  assert.ok(!view.includes("hệ thống cấp mã nội bộ"), "the earlier wording promised an internal framework code that the schema does not have");
});
