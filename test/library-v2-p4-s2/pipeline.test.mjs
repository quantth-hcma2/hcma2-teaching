// P4-S2 - normalization + the 10-stage validation pipeline (template contract, cell types, characters, structure, order, canonical codes, determinism, diagnostics).
// Workbooks are built with the vendored SheetJS writer, read back through the REAL gate (extractRawWorkbook), then interpreted/validated.
// Run: node --test test/library-v2-p4-s2/pipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { XLSX, workbookBytes, metaWith, validateBytes, codes, DEFAULT_SUBJECTS, DEFAULT_LESSONS } from "./helpers.mjs";
import { validateImport, isValidatedModel } from "../../import-validate.mjs";
import { buildImportPlan } from "../../import-plan.mjs";
import { canonicalJson } from "../../import-plan.mjs";
import { DIAGNOSTIC_CODES, STAGES } from "../../import-diagnostics.mjs";
import { IMPORT_LIMITS, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META, TEMPLATE_HEADER_CHECKSUM, TEMPLATE_SHEET_NAMES, buildTemplateSheets, headerChecksumOf, expectedHeaders } from "../../import-template.mjs";
import { scanCharacters } from "../../import-normalize.mjs";
import { sha256Hex } from "../../import-sha256.mjs";

const run = async (options, fileName) => (await validateBytes(workbookBytes(options), { fileName })).result;
const has = (result, code, where = {}) => result.diagnostics.some((d) => d.code === code && Object.entries(where).every(([k, v]) => (k === "otherRow" ? d.refs[0] && d.refs[0].row === v : k === "otherSheet" ? d.refs[0] && d.refs[0].sheet === v : d[k] === v)));
const only = (result) => codes(result.errors);
const fc = String.fromCharCode;

// ------------------------------------------------------------------------------------------- template contract
test("TEMPLATE: the frozen sheet set, headers, _meta keys and checksum are defined once; sheet names are NFC; the guide sheet is generated", () => {
  assert.deepEqual([...TEMPLATE_SHEET_NAMES], ["HƯỚNG DẪN", "KHUNG", "MÔN", "BÀI", "_meta"]);
  for (const name of TEMPLATE_SHEET_NAMES) assert.equal(name, name.normalize("NFC"));
  assert.deepEqual(expectedHeaders(SHEET_FRAMEWORK), ["Tên khung chương trình"]);
  assert.deepEqual(expectedHeaders(SHEET_SUBJECTS), ["Mã môn", "Tên môn", "Thứ tự"]);
  assert.deepEqual(expectedHeaders(SHEET_LESSONS), ["Mã môn", "Mã bài", "Tên bài", "Thứ tự"]);
  const sheets = buildTemplateSheets();
  assert.equal(sheets[SHEET_FRAMEWORK].length, 1, "data sheets hold only the header row (no example rows)");
  assert.deepEqual(sheets[SHEET_META].map((r) => r[0]), ["templateId", "schemaVersion", "generator", "headerChecksum"]);
  assert.equal(sheets[SHEET_META][3][1], TEMPLATE_HEADER_CHECKSUM);
  assert.match(TEMPLATE_HEADER_CHECKSUM, /^[0-9a-f]{64}$/);
  assert.equal(TEMPLATE_HEADER_CHECKSUM, "e2d6e0b37a6cdfe38f90ee7dc91e285a5d8d6c33a17a874f1366c633ff70607d", "pinned: a header or separator change is a template version change");
  assert.notEqual(headerChecksumOf({ KHUNG: ["x"], "MÔN": [], "BÀI": [] }), TEMPLATE_HEADER_CHECKSUM);
  assert.ok(sheets["HƯỚNG DẪN"].flat().join(" ").includes("Mã môn"));
});
test("SHA-256: the pure implementation is byte-identical to node:crypto (empty, boundary lengths, long, non-ASCII)", async () => {
  const { createHash } = await import("node:crypto");
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(1000), "Tiếng Việt: ươ ế ợ", "x".repeat(100000)]) assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"), text.slice(0, 20));
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) & 255);
  assert.equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"));
});

// ------------------------------------------------------------------------------------------- valid
test("VALID: the default template data passes all ten stages and yields a frozen, registered model with exact structure", async () => {
  const result = await run();
  assert.equal(result.ok, true); assert.equal(result.ready, true); assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.counts, { subjects: 2, lessons: 3, total: 5 });
  assert.equal(result.stages.length, 10); assert.deepEqual(result.stages.map((s) => s.name), Object.values(STAGES));
  const model = result.model;
  assert.ok(isValidatedModel(model)); assert.ok(Object.isFrozen(model) && Object.isFrozen(model.nodes[0]));
  assert.equal(model.kind, "curriculum"); assert.equal(model.templateId, "hcma2.curriculum.xlsx"); assert.equal(model.schemaVersion, 1);
  assert.equal(model.framework.name, "Chương trình Toán 6"); assert.deepEqual(model.framework.sourceRef, { sheet: "KHUNG", row: 2 });
  assert.deepEqual(model.nodes.map((n) => [n.key, n.kind, n.parentKey, n.code, n.name, n.order]), [
    ["MON:2", "subject", null, "T01", "Số học", 1], ["MON:3", "subject", null, "T02", "Hình học", 2],
    ["BAI:2", "lesson", "MON:2", "T01-B01", "Tập hợp số tự nhiên", 1], ["BAI:3", "lesson", "MON:2", "T01-B02", "Phép cộng và phép trừ", 2], ["BAI:4", "lesson", "MON:3", "T02-B01", "Điểm và đường thẳng", 1]
  ]);
  assert.match(model.source.sha256, /^[0-9a-f]{64}$/);
});
test("VALID: multi-subject / multi-lesson data with optional codes, optional order and empty rows between data", async () => {
  const result = await run({
    subjects: [["TOAN", "Toán", null], [null, null, null], ["VAN", "Ngữ văn", null], ["ANH", "Tiếng Anh", null]],
    lessons: [["TOAN", null, "Bài không mã 1", null], ["VAN", "V-1", "Đọc hiểu", null], ["TOAN", "T-2", "Bài có mã", null], [null, null, null, null], ["ANH", null, "Bài không mã 2", null], ["VAN", null, "Viết đoạn văn", null]]
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const nodes = result.model.nodes;
  assert.equal(nodes.length, 3 + 5);
  const subjects = nodes.filter((n) => n.kind === "subject");
  assert.deepEqual(subjects.map((n) => [n.code, n.order, n.orderSource]), [["TOAN", 0, "position"], ["VAN", 1, "position"], ["ANH", 2, "position"]], "order = row position among the non-empty rows");
  const toan = nodes.filter((n) => n.parentKey === "MON:2");
  assert.deepEqual(toan.map((n) => [n.code, n.order]), [[null, 0], ["T-2", 1]]);
  assert.ok(nodes.filter((n) => n.kind === "lesson").every((n) => n.parentKey !== null));
  assert.ok(has(result, "SUBJECT_EMPTY") === false);
});
test("VALID: an empty subject is only a warning; explicit orders may be sparse; leading/trailing spaces are trimmed with a visible note", async () => {
  const result = await run({ subjects: [["A1", "Môn có bài", 10], ["B1", "  Môn trống  ", 30]], lessons: [["A1", " L1 ", "  Bài một  ", 5]] });
  assert.equal(result.ok, true); assert.ok(has(result, "SUBJECT_EMPTY", { sheet: "MÔN", row: 3 }));
  const lesson = result.model.nodes.find((n) => n.kind === "lesson");
  assert.equal(lesson.name, "Bài một"); assert.equal(lesson.code, "L1"); assert.ok(lesson.notes.includes("name:trim") && lesson.notes.includes("code:trim"));
  assert.equal(lesson.original.name, "  Bài một  "); assert.equal(lesson.order, 5); assert.equal(lesson.orderSource, "explicit");
});

// ------------------------------------------------------------------------------------------- sheets / template identity
test("SHEETS: each missing sheet, an unexpected sheet, a wrong-case sheet name and a missing guide are errors with the sheet named", async () => {
  for (const name of TEMPLATE_SHEET_NAMES) { const r = await run({ omitSheets: [name] }); assert.ok(has(r, "SHEET_MISSING", { sheet: name }), name); assert.equal(r.model, null); }
  const extra = await run({ extraSheets: { "Ghi chú": [["tự do"]] } });
  assert.ok(has(extra, "SHEET_UNEXPECTED", { sheet: "Ghi chú" })); assert.equal(extra.model, null);
  const wrongCase = await run({ extraSheets: { "khung": [["x"]] } });
  assert.ok(has(wrongCase, "SHEET_NAME_CASE")); assert.equal(wrongCase.model, null);
  assert.ok(has(await run({ extraSheets: { "Mon": [["x"]] } }), "SHEET_NAME_CASE"), "MÔN without diacritics/case");
});
test("TEMPLATE IDENTITY: templateId, schemaVersion, header checksum and missing/duplicate/unknown _meta keys", async () => {
  assert.ok(has(await run({ meta: metaWith({ templateId: "hcma2.questions.xlsx" }) }), "TEMPLATE_ID_MISMATCH"));
  assert.ok(has(await run({ meta: metaWith({ schemaVersion: 2 }) }), "TEMPLATE_VERSION_NEWER"));
  assert.ok(has(await run({ meta: metaWith({ schemaVersion: 0 }) }), "TEMPLATE_VERSION_INVALID"));
  assert.ok(has(await run({ meta: metaWith({ schemaVersion: "abc" }) }), "TEMPLATE_VERSION_INVALID"));
  assert.ok(has(await run({ meta: metaWith({ schemaVersion: 1.5 }) }), "TEMPLATE_VERSION_INVALID"));
  assert.equal((await run({ meta: metaWith({ schemaVersion: "1" }) })).ok, true, "text '1' is accepted");
  assert.ok(has(await run({ meta: metaWith({ headerChecksum: "0".repeat(64) }) }), "HEADER_CHECKSUM_MISMATCH"));
  assert.ok(has(await run({ meta: metaWith({ headerChecksum: undefined }) }), "META_MISSING_KEY", { sheet: "_meta" }));
  assert.ok(has(await run({ meta: [...metaWith(), ["templateId", "hcma2.curriculum.xlsx"]] }), "META_DUPLICATE_KEY"));
  const unknown = await run({ meta: [...metaWith(), ["note", "x"]] });
  assert.equal(unknown.ok, true); assert.ok(has(unknown, "META_UNKNOWN_KEY"));
  assert.ok(has(await run({ meta: [["templateId", "hcma2.curriculum.xlsx"]] }), "META_MISSING_KEY"));
  const upper = await run({ meta: metaWith({ headerChecksum: TEMPLATE_HEADER_CHECKSUM.toUpperCase() }) });
  assert.equal(upper.ok, true, "hex case is not significant");
});
test("SCHEMA: missing, renamed and reordered headers, stray columns and the header checksum are all enforced; formulas in _meta are rejected", async () => {
  const subjectsHeader = ["Mã môn", "Tên môn", "Thứ tự"];
  const renamed = await run({ headers: { [SHEET_SUBJECTS]: ["Mã", "Tên môn", "Thứ tự"] } });
  assert.ok(has(renamed, "HEADER_MISMATCH", { sheet: "MÔN", row: 1 })); assert.equal(renamed.model, null);
  assert.ok(has(await run({ headers: { [SHEET_SUBJECTS]: ["Tên môn", "Mã môn", "Thứ tự"] } }), "HEADER_MISMATCH"), "reordered");
  assert.ok(has(await run({ headers: { [SHEET_SUBJECTS]: ["Mã môn", "Tên môn"] } }), "HEADER_MISSING", { sheet: "MÔN" }));
  assert.ok(has(await run({ headers: { [SHEET_LESSONS]: ["Mã môn", "Mã bài", "Tên bài"] } }), "HEADER_MISSING", { sheet: "BÀI" }));
  assert.ok(has(await run({ headers: { [SHEET_FRAMEWORK]: ["Tên khung"] } }), "HEADER_MISMATCH", { sheet: "KHUNG" }));
  assert.ok(has(await run({ headers: { [SHEET_SUBJECTS]: [...subjectsHeader, "Ghi chú"] } }), "EXTRA_COLUMN_DATA", { sheet: "MÔN", row: 1 }));
  assert.ok(has(await run({ subjects: [["A", "B", 1, "dữ liệu thừa"]] }), "EXTRA_COLUMN_DATA", { sheet: "MÔN", row: 2 }), "data outside the template columns is an error, never silently dropped");
  assert.equal((await run({ headers: { [SHEET_SUBJECTS]: ["  Mã môn ", "Tên môn", "Thứ tự"] } })).ok, true, "surrounding spaces in a header are tolerated");
  assert.ok(has(await run({ mutate: (wb) => { wb.Sheets[SHEET_META].B2 = { t: "n", v: 1, f: "1+0" }; } }), "CELL_FORMULA", { sheet: "_meta" }));
});
test("KHUNG: exactly one data row with a 3-120 character name", async () => {
  assert.ok(has(await run({ framework: null }), "FRAMEWORK_ROW_COUNT"));
  assert.ok(has(await run({ mutate: (wb) => { XLSX.utils.sheet_add_aoa(wb.Sheets[SHEET_FRAMEWORK], [["Khung thứ hai"]], { origin: "A3" }); } }), "FRAMEWORK_ROW_COUNT"));
  assert.ok(has(await run({ framework: [null] }), "FRAMEWORK_ROW_COUNT"), "blank row = no row");
  assert.ok(has(await run({ framework: ["ab"] }), "FRAMEWORK_NAME_LENGTH", { sheet: "KHUNG", row: 2 }));
  assert.equal((await run({ framework: ["abc"] })).ok, true);
  assert.equal((await run({ framework: ["x".repeat(120)] })).ok, true, "D9 rejected: the real P3 limit of 120 applies");
  assert.ok(has(await run({ framework: ["x".repeat(121)] }), "FRAMEWORK_NAME_LENGTH"));
});

// ------------------------------------------------------------------------------------------- structure
test("STRUCTURE: orphan lessons (case/space/Unicode-insensitive match), no subjects, subjects without code or name", async () => {
  const orphan = await run({ lessons: [["KHONGCO", "x", "Bài mồ côi", 1]] });
  assert.ok(has(orphan, "LESSON_ORPHAN", { sheet: "BÀI", row: 2, field: "subjectCode" })); assert.equal(orphan.model, null);
  assert.match(orphan.errors.find((e) => e.code === "LESSON_ORPHAN").message, /^Sheet “BÀI”, dòng 2, cột “Mã môn”: Mã môn “KHONGCO” không có trong sheet MÔN\./);
  const loose = await run({ subjects: [["Toán-1", "Toán", null]], lessons: [[" TOÁN-1 ", null, "A", null], ["toán-1", null, "B", null], ["TOÁN-1".normalize("NFD"), null, "C", null]] });
  assert.equal(loose.ok, true, JSON.stringify(loose.errors)); assert.ok(loose.model.nodes.filter((n) => n.kind === "lesson").every((n) => n.parentKey === "MON:2"));
  assert.ok(has(await run({ subjects: [], lessons: [] }), "NO_SUBJECT"));
  assert.ok(has(await run({ subjects: [[null, "Môn thiếu mã", 1]], lessons: [] }), "REQUIRED_MISSING", { sheet: "MÔN", row: 2, field: "subjectCode" }));
  assert.ok(has(await run({ subjects: [["A", null, 1]], lessons: [] }), "REQUIRED_MISSING", { sheet: "MÔN", row: 2, field: "subjectName" }));
  assert.ok(has(await run({ lessons: [["T01", "x", null, 1]] }), "REQUIRED_MISSING", { sheet: "BÀI", field: "lessonName" }));
  assert.ok(has(await run({ lessons: [[null, "x", "Bài", 1]] }), "REQUIRED_MISSING", { sheet: "BÀI", field: "subjectCode" }));
});
test("ORDER: mixed explicit/blank, duplicates, range, non-integers and digit text; either all rows of a group have an order or none", async () => {
  const mixed = await run({ subjects: [["A", "A", 1], ["B", "B", null]], lessons: [] });
  assert.ok(has(mixed, "ORDER_MIXED", { sheet: "MÔN", row: 3 })); assert.equal(mixed.model, null);
  assert.ok(has(await run({ subjects: [["A", "A", 1], ["B", "B", 1]], lessons: [] }), "ORDER_DUPLICATE", { sheet: "MÔN", row: 3, otherRow: 2 }));
  const perGroup = await run({ subjects: [["A", "A", 2], ["B", "B", 1]], lessons: [["A", "a1", "x", 1], ["A", "a2", "y", 2], ["B", "b1", "z", null]] });
  assert.equal(perGroup.ok, true, "each subject's lessons are a separate group");
  assert.deepEqual(perGroup.model.nodes.filter((n) => n.parentKey === "MON:3").map((n) => n.order), [0]);
  assert.ok(has(await run({ subjects: [["A", "A", -1]], lessons: [] }), "ORDER_RANGE"));
  assert.ok(has(await run({ subjects: [["A", "A", 100001]], lessons: [] }), "ORDER_RANGE"));
  assert.equal((await run({ subjects: [["A", "A", 0], ["B", "B", 100000]], lessons: [] })).ok, true, "0 and 100000 are the inclusive bounds");
  assert.ok(has(await run({ subjects: [["A", "A", 1.5]], lessons: [] }), "ORDER_NOT_INTEGER"));
  assert.ok(has(await run({ subjects: [["A", "A", "abc"]], lessons: [] }), "ORDER_NOT_INTEGER"));
  assert.ok(has(await run({ subjects: [["A", "A", "1e3"]], lessons: [] }), "ORDER_NOT_INTEGER"));
  const text = await run({ subjects: [["A", "A", " 7 "]], lessons: [] });
  assert.equal(text.ok, true); assert.ok(has(text, "ORDER_FROM_TEXT")); assert.equal(text.model.nodes[0].order, 7);
  assert.ok(has(await run({ subjects: [["A", "A", "-3"]], lessons: [] }), "ORDER_NOT_INTEGER"));
  const invalidOnly = await run({ subjects: [["A", "A", 1.5], ["B", "B", 2]], lessons: [] });
  assert.ok(!has(invalidOnly, "ORDER_MIXED"), "an order that already failed is not additionally reported as 'mixed'");
});
test("CANONICAL CODES: P3 policy - case, surrounding spaces, Unicode forms and full-width characters collide; MÔN and BÀI share ONE namespace; both rows are named", async () => {
  const same = await run({ subjects: [["MATH1", "Toán", null], ["math1", "Toán 2", null]], lessons: [] });
  assert.ok(has(same, "CODE_DUPLICATE", { sheet: "MÔN", row: 3, otherRow: 2, otherSheet: "MÔN" }));
  assert.match(same.errors.find((e) => e.code === "CODE_DUPLICATE").message, /trùng với dòng 2 \(sheet MÔN\)/);
  assert.ok(has(await run({ subjects: [["A1", "a", null], [" A1 ", "b", null]], lessons: [] }), "CODE_DUPLICATE"), "surrounding spaces");
  assert.ok(has(await run({ subjects: [["Đạo-1", "a", null], ["Đạo-1".normalize("NFD"), "b", null]], lessons: [] }), "CODE_DUPLICATE"), "NFC vs NFD");
  assert.ok(has(await run({ subjects: [["AB1", "a", null], [fc(0xff21) + fc(0xff22) + fc(0xff11), "b", null]], lessons: [] }), "CODE_DUPLICATE"), "full-width forms (NFKC)");
  const cross = await run({ subjects: [["T01", "Toán", null]], lessons: [["T01", "t01", "Bài trùng mã môn", null]] });
  assert.ok(has(cross, "CODE_DUPLICATE", { sheet: "BÀI", row: 2, otherSheet: "MÔN", otherRow: 2 }), "a lesson code equal to a subject code");
  const lessons = await run({ subjects: [["A", "a", null], ["B", "b", null]], lessons: [["A", "L1", "x", null], ["B", "l1", "y", null]] });
  assert.ok(has(lessons, "CODE_DUPLICATE", { sheet: "BÀI", row: 3, otherRow: 2 }), "unique across the whole framework, not per subject");
  const distinct = await run({ subjects: [["A", "a", null]], lessons: [["A", "Ɛ1", "x", null], ["A", "É1", "y", null], ["A", "E1", "z", null], ["A", null, "n1", null], ["A", null, "n2", null]] });
  assert.equal(distinct.ok, true, "no diacritic stripping; blank codes never conflict: " + JSON.stringify(distinct.errors));
});
test("DOMAIN (P3): name/code length bounds use the P3 limits", async () => {
  assert.equal((await run({ subjects: [["C".repeat(40), "N".repeat(200), null]], lessons: [] })).ok, true, "40-char code and 200-char name are the inclusive bounds");
  assert.ok(has(await run({ subjects: [["C".repeat(41), "n", null]], lessons: [] }), "CODE_LENGTH", { sheet: "MÔN", row: 2 }));
  assert.ok(has(await run({ subjects: [["C", "N".repeat(201), null]], lessons: [] }), "NAME_LENGTH", { sheet: "MÔN", row: 2 }));
  assert.ok(has(await run({ lessons: [["T01", "C".repeat(41), "n", null]] }), "CODE_LENGTH", { sheet: "BÀI", field: "lessonCode" }));
  assert.ok(has(await run({ lessons: [["T01", "c", "N".repeat(201), null]] }), "NAME_LENGTH", { sheet: "BÀI" }));
  assert.ok(has(await run({ lessons: [["C".repeat(41), "c", "n", null]] }), "CODE_LENGTH", { field: "subjectCode" }));
  const huge = await run({ subjects: [["A", "x".repeat(1500), null]], lessons: [] });
  assert.ok(has(huge, "CELL_TOO_LONG", { sheet: "MÔN", row: 2 })); assert.ok(!JSON.stringify(huge.diagnostics).includes("x".repeat(100)), "diagnostics carry a bounded excerpt, never the whole cell");
});

// ------------------------------------------------------------------------------------------- cell types
test("NUMERIC CODES: text cells keep leading zeros; numeric cells become text with a warning; the displayed zeros of a number format are kept", async () => {
  const text = await run({ subjects: [["007", "Môn 007", null], ["0010", "Môn 10", null]], lessons: [["007", "00-1", "Bài", null], ["0010", "00-2", "Bài hai", null]] });
  assert.equal(text.ok, true); assert.deepEqual(text.model.nodes.filter((n) => n.kind === "subject").map((n) => n.code), ["007", "0010"]); assert.deepEqual(text.warnings, []);
  const numeric = await run({ subjects: [[12, "Môn số", null], [7, "Môn bảy", null]], lessons: [], mutate: (wb) => { wb.Sheets[SHEET_SUBJECTS].A3.z = "000"; } });
  assert.equal(numeric.ok, true, JSON.stringify(numeric.errors));
  assert.deepEqual(numeric.model.nodes.map((n) => n.code), ["12", "007"], "number format 000 shows 007: the visible text is kept");
  assert.equal(numeric.warnings.filter((w) => w.code === "CELL_NUMERIC_CODE").length, 2);
  assert.match(numeric.warnings[0].message, /^Sheet “MÔN”, dòng 2, cột “Mã môn”: Mã “12” được đọc từ ô số/);
  const decimal = await run({ subjects: [[1.5, "Môn", null]], lessons: [] });
  assert.equal(decimal.ok, true); assert.equal(decimal.model.nodes[0].code, "1.5");
  const bigNum = await run({ subjects: [[12345678901234567890, "Môn", null]], lessons: [] });
  assert.equal(bigNum.ok, true); assert.match(bigNum.model.nodes[0].code, /^12345678901234567/);
  const lessonNumeric = await run({ subjects: [["1", "M", null]], lessons: [[1, 2, "Bài", null]] });
  assert.equal(lessonNumeric.ok, true, JSON.stringify(lessonNumeric.errors)); assert.ok(has(lessonNumeric, "CELL_NUMERIC_CODE", { sheet: "BÀI" }));
  assert.ok(has(await run({ framework: [2024] }), "CELL_TYPE_NOT_TEXT", { sheet: "KHUNG" }), "numbers are not accepted as names");
  assert.ok(has(await run({ subjects: [["A", 123, null]], lessons: [] }), "CELL_TYPE_NOT_TEXT", { sheet: "MÔN", field: "subjectName" }));
});
test("CELL TYPES: formulas, booleans, dates and error cells are rejected where literal values are required", async () => {
  const f = (sheet, address, formula) => (wb) => { const ws = wb.Sheets[sheet]; ws[address] = { t: "s", v: "kết quả", f: formula }; };
  assert.ok(has(await run({ mutate: f(SHEET_SUBJECTS, "A2", 'CONCAT("T","01")') }), "CELL_FORMULA", { sheet: "MÔN", row: 2, field: "subjectCode" }));
  assert.ok(has(await run({ mutate: f(SHEET_SUBJECTS, "B2", "A3") }), "CELL_FORMULA", { field: "subjectName" }));
  assert.ok(has(await run({ mutate: (wb) => { wb.Sheets[SHEET_SUBJECTS].C2 = { t: "n", v: 3, f: "1+2" }; } }), "CELL_FORMULA", { field: "order" }));
  assert.ok(has(await run({ mutate: f(SHEET_LESSONS, "C2", "KHUNG!A2") }), "CELL_FORMULA", { sheet: "BÀI", field: "lessonName" }));
  assert.ok(has(await run({ mutate: f(SHEET_FRAMEWORK, "A2", '"Khung"&"A"') }), "CELL_FORMULA", { sheet: "KHUNG" }));
  assert.ok(has(await run({ subjects: [["A", "n", true]], lessons: [] }), "CELL_TYPE_BOOLEAN", { field: "order" }));
  assert.ok(has(await run({ subjects: [[false, "n", 1]], lessons: [] }), "CELL_TYPE_BOOLEAN", { field: "subjectCode" }));
  assert.ok(has(await run({ subjects: [["A", new Date(Date.UTC(2026, 0, 5)), 1]], lessons: [], cellDates: true }), "CELL_TYPE_DATE"));
  assert.ok(has(await run({ subjects: [[new Date(Date.UTC(2026, 0, 5)), "n", 1]], lessons: [], cellDates: true }), "CELL_TYPE_DATE", { field: "subjectCode" }));
  assert.ok(has(await run({ mutate: (wb) => { wb.Sheets[SHEET_SUBJECTS].B2 = { t: "e", v: 0x17, w: "#REF!" }; } }), "CELL_TYPE_ERROR", { field: "subjectName" }));
  assert.ok(has(await run({ mutate: (wb) => { wb.Sheets[SHEET_SUBJECTS].C2 = { t: "d", v: new Date(Date.UTC(2026, 0, 5)) }; }, cellDates: true }), "CELL_TYPE_DATE", { field: "order" }));
  const formulaResult = await run({ mutate: f(SHEET_SUBJECTS, "A2", "1+1") });
  assert.equal(formulaResult.model, null); assert.equal(formulaResult.ok, false, "a formula never reaches a model: the cached value is not trusted");
});
test("CHARACTERS: control characters, bidirectional overrides and CR are errors; zero-width characters warn; whitespace-only cells are blank; inner LF/TAB are allowed", async () => {
  const bidi = fc(0x202e), isolate = fc(0x2066), zwsp = fc(0x200b);
  assert.ok(has(await run({ subjects: [["A", "tên" + bidi + "ngược", null]], lessons: [] }), "CHAR_BIDI", { sheet: "MÔN", row: 2 }));
  assert.ok(has(await run({ subjects: [["A" + isolate, "ten", null]], lessons: [] }), "CHAR_BIDI"));
  assert.ok(has(await run({ subjects: [["A", "tên" + fc(1) + "x", null]], lessons: [] }), "CHAR_CONTROL"));
  assert.ok(has(await run({ subjects: [["A", "tên\rkhác", null]], lessons: [] }), "CHAR_CONTROL"), "CR is a control character");
  assert.ok(has(await run({ subjects: [["A", "tên" + fc(0x7f), null]], lessons: [] }), "CHAR_CONTROL"), "DEL");
  assert.ok(has(await run({ subjects: [["A", "tên" + fc(0x85), null]], lessons: [] }), "CHAR_CONTROL"), "C1 control");
  assert.equal((await run({ subjects: [["A", "dòng một\ndòng hai\tcột", null]], lessons: [] })).ok, true, "LF and TAB are accepted");
  const invisible = await run({ subjects: [["A", "tên" + zwsp + "ẩn", null]], lessons: [] });
  assert.equal(invisible.ok, true); assert.ok(has(invisible, "CHAR_INVISIBLE"));
  const blank = await run({ subjects: [["A", "tên", null], ["   ", "   ", null]], lessons: [] });
  assert.equal(blank.ok, true, "whitespace-only cells are blank: the row is skipped"); assert.equal(blank.model.nodes.length, 1);
  assert.deepEqual(scanCharacters("a" + bidi), { control: false, bidi: true, invisible: false });
  assert.deepEqual(scanCharacters("ok tên"), { control: false, bidi: false, invisible: false });
});
test("UNICODE: text is stored in NFC (canonical composition only); the original NFD value is kept for the preview; NFKC/case folding never rewrite stored text", async () => {
  const nfd = "Số học".normalize("NFD"), code = "Ｔ01-Đ";                                 // full-width T must NOT be rewritten in storage
  const result = await run({ framework: ["Chương trình".normalize("NFD")], subjects: [[code, nfd, null]], lessons: [[code, "bài-à".normalize("NFD"), "tập hợp".normalize("NFD"), null]] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const [subject, lesson] = result.model.nodes;
  assert.equal(subject.name, "Số học".normalize("NFC")); assert.equal(subject.original.name, nfd); assert.ok(subject.notes.includes("name:nfc"));
  assert.equal(subject.code, code, "NFKC is a comparison key only: the stored code keeps the full-width character");
  assert.equal(lesson.code, "bài-à".normalize("NFC")); assert.equal(result.model.framework.name, "Chương trình".normalize("NFC"));
  assert.equal(result.model.framework.original, "Chương trình".normalize("NFD"));
  assert.equal(subject.code, subject.code.trim());
});
test("VISIBILITY: hidden rows/columns and merged cells are warnings; the data is still read as written", async () => {
  const result = await run({ mutate: (wb) => {
    const ws = wb.Sheets[SHEET_SUBJECTS]; ws["!rows"] = [{}, { hidden: true }]; ws["!cols"] = [{}, { hidden: true }]; ws["!merges"] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }];
  } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(has(result, "ROW_HIDDEN", { sheet: "MÔN", row: 2 })); assert.ok(has(result, "COLUMN_HIDDEN", { sheet: "MÔN" })); assert.ok(has(result, "CELL_MERGED", { sheet: "MÔN", row: 3 }));
  assert.equal(result.model.diagnostics.filter((d) => d.severity === "warning").length >= 3, true, "warnings travel with the model for the preview");
});

// ------------------------------------------------------------------------------------------- diagnostics
test("DIAGNOSTICS: every diagnostic is structured Vietnamese with severity, code, stage, worksheet, row, field and bounded excerpt; the catalog is complete", async () => {
  const result = await run({ subjects: [["A", "x".repeat(250), 1], ["A", "n", 1]], lessons: [["ZZ", "B", null, 9]], framework: ["ab"] });
  assert.ok(result.errors.length >= 5);
  for (const d of result.diagnostics) {
    assert.ok(d.severity === "error" || d.severity === "warning"); assert.ok(DIAGNOSTIC_CODES.includes(d.code)); assert.ok(d.stage >= 1 && d.stage <= 10);
    assert.equal(typeof d.message, "string"); assert.ok(d.message.length > 10); assert.ok(Array.isArray(d.refs)); assert.ok(Object.isFrozen(d));
    assert.ok(d.value === null || d.value.length <= 61);
    if (d.sheet) assert.ok(d.message.startsWith("Sheet “" + d.sheet + "”"), d.message);
  }
  const duplicate = result.errors.find((e) => e.code === "CODE_DUPLICATE" || e.code === "ORDER_DUPLICATE");
  assert.ok(duplicate && duplicate.refs.length === 1 && duplicate.refs[0].sheet === "MÔN");
  const orphan = result.errors.find((e) => e.code === "LESSON_ORPHAN");
  assert.deepEqual([orphan.sheet, orphan.row, orphan.field], ["BÀI", 2, "subjectCode"]);
  const sorted = result.diagnostics.map((d) => [d.stage, d.severity === "error" ? 0 : 1, d.sheet || "", d.row || 0]);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1][0] < sorted[i][0] || (sorted[i - 1][0] === sorted[i][0] && sorted[i - 1][1] <= sorted[i][1]), "deterministic order by stage then severity");
  const text = JSON.stringify(result.diagnostics);
  assert.ok(/[ạảãàáâấầẩẫậắằẳẵặẹẻẽèéêếềểễệỉịọỏõòóôốồổỗộớờởỡợụủũùúưứừửữựỳỵỷỹý]/.test(text), "messages are Vietnamese");
  assert.ok(!/[0-9a-f]{32}/.test(text.replace(result.file ? result.file.sha256 : "", "")), "no ids in messages");
});
test("DIAGNOSTICS: the error list is bounded (1000) and says so once; invalid files never produce a model or a plan", async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ["C" + i, null, null]);
  const result = await run({ subjects: many, lessons: [] });
  assert.equal(result.errors.filter((e) => e.code === "REQUIRED_MISSING").length, 1000);
  assert.equal(result.errors.filter((e) => e.code === "ERRORS_TRUNCATED").length, 1);
  assert.equal(result.ok, false); assert.equal(result.model, null);
  assert.throws(() => buildImportPlan(result.model, { organizationId: "o", batchId: "b1" }), /validation/);
  const good = (await run()).model;
  const clone = JSON.parse(JSON.stringify(good));
  assert.throws(() => buildImportPlan(clone, { organizationId: "o", batchId: "b1" }), /validation/, "a look-alike model is not accepted");
  assert.throws(() => buildImportPlan({ ...good }, { organizationId: "o", batchId: "b1" }), /validation/);
  assert.throws(() => buildImportPlan(null, {}), /validation/);
});
test("DIAGNOSTICS: validateImport tolerates hostile or missing input and never throws", () => {
  for (const input of [null, undefined, {}, { ok: true }, { ok: true, raw: {} }, { ok: false, diagnostics: [] }, 5, "x"]) {
    const r = validateImport(input);
    assert.equal(r.ok, false); assert.equal(r.model, null); assert.ok(r.errors.length >= 1);
  }
  const raw = { parser: "parser.xlsx.v1", library: "x", sheetNames: ["KHUNG"], sheets: [{ name: "KHUNG", cells: [], merges: [], hiddenRows: [], hiddenColumns: [] }] };
  const r = validateImport({ ok: true, diagnostics: [], raw, file: { name: "a.xlsx", size: 1, sha256: "a".repeat(64) } });
  assert.equal(r.ok, false); assert.ok(codes(r.errors).includes("SHEET_MISSING"));
  const badFile = validateImport({ ok: true, diagnostics: [], raw, file: { name: "", size: 1, sha256: "zz" } });
  assert.ok(codes(badFile.errors).includes("FILE_INFO_INVALID"));
});

// ------------------------------------------------------------------------------------------- determinism / parser independence
test("DETERMINISM: the same logical workbook gives a byte-identical model regardless of cell order in the RawWorkbook, repeated runs and NFC/NFD input; the model is parser-independent", async () => {
  const a = await validateBytes(workbookBytes());
  const b = await validateBytes(workbookBytes());
  assert.equal(canonicalJson(a.result.model), canonicalJson(b.result.model));
  const shuffled = JSON.parse(JSON.stringify(a.extracted.raw));
  for (const sheet of shuffled.sheets) sheet.cells.reverse();
  const c = validateImport({ ok: true, diagnostics: [], raw: shuffled, file: a.result.file });
  assert.equal(canonicalJson(c.model), canonicalJson(a.result.model), "cell order inside the RawWorkbook is irrelevant");
  const nfd = await run({ framework: ["Chương trình Toán 6".normalize("NFD")], subjects: DEFAULT_SUBJECTS.map(([c1, n, o]) => [c1, n.normalize("NFD"), o]), lessons: DEFAULT_LESSONS.map(([s, c1, n, o]) => [s, c1, n.normalize("NFD"), o]) });
  const strip = (m) => m.nodes.map((n) => [n.key, n.kind, n.parentKey, n.code, n.name, n.order]);
  assert.deepEqual(strip(nfd.model), strip(a.result.model), "NFD and NFC input normalize to the same model");
  // a different parser only has to emit the same RawWorkbook: hand-built raw data validates identically
  const handmade = { parser: "parser.xlsx.v1", library: "handmade", sheetNames: ["HƯỚNG DẪN", "KHUNG", "MÔN", "BÀI", "_meta"], sheets: [
    { name: "HƯỚNG DẪN", state: "visible", cells: [], merges: [], hiddenRows: [], hiddenColumns: [], notRead: true },
    { name: "KHUNG", state: "visible", cells: [{ r: 1, c: 0, t: "s", v: "Tên khung chương trình" }, { r: 2, c: 0, t: "s", v: "Khung thủ công" }], merges: [], hiddenRows: [], hiddenColumns: [] },
    { name: "MÔN", state: "visible", cells: [{ r: 1, c: 0, t: "s", v: "Mã môn" }, { r: 1, c: 1, t: "s", v: "Tên môn" }, { r: 1, c: 2, t: "s", v: "Thứ tự" }, { r: 2, c: 0, t: "s", v: "M1" }, { r: 2, c: 1, t: "s", v: "Môn một" }], merges: [], hiddenRows: [], hiddenColumns: [] },
    { name: "BÀI", state: "visible", cells: [{ r: 1, c: 0, t: "s", v: "Mã môn" }, { r: 1, c: 1, t: "s", v: "Mã bài" }, { r: 1, c: 2, t: "s", v: "Tên bài" }, { r: 1, c: 3, t: "s", v: "Thứ tự" }, { r: 2, c: 0, t: "s", v: "m1" }, { r: 2, c: 2, t: "s", v: "Bài một" }], merges: [], hiddenRows: [], hiddenColumns: [] },
    { name: "_meta", state: "hidden", cells: [["templateId", "hcma2.curriculum.xlsx"], ["schemaVersion", "1"], ["generator", "other-parser"], ["headerChecksum", TEMPLATE_HEADER_CHECKSUM]].flatMap(([k, v], i) => [{ r: i + 1, c: 0, t: "s", v: k }, { r: i + 1, c: 1, t: "s", v }]), merges: [], hiddenRows: [], hiddenColumns: [] }
  ] };
  const r = validateImport({ ok: true, diagnostics: [], raw: handmade, file: { name: "x.xlsx", size: 10, sha256: "b".repeat(64) } });
  assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.equal(r.model.parser, "parser.xlsx.v1"); assert.equal(r.model.nodes[1].parentKey, "MON:2");
});

test("CANONICAL CODES: the O(n) key-map used by stage 7 reports EXACTLY what P3 codeConflictOf reports (first accepted node wins) on adversarial data", async () => {
  const { codeConflictOf, normalizeNodeCode } = await import("../../curriculum-model.mjs");
  const pool = ["A1", "a1", " A1 ", "Ａ１", "É1", "E1", "é1", "É1".normalize("NFD"), "ǅ", "ǆ", "Ǆ", "ß", "SS", "ss", "İ", "i̇", "K", "K", "ﬁ", "fi", "FI", "Đ", "đ", "Σ", "ς", "σ", "x-1", "X-1", "1", "01", "٣", "3", "００７", "007", "Ω", "Ω", "ａ", "A"];
  let seed = 12345; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 25; round++) {
    const codes = Array.from({ length: 18 }, () => pool[Math.floor(rand() * pool.length)]);
    const subjects = codes.map((c, i) => [c, "Môn " + i, null]);
    const result = await run({ subjects, lessons: [] });
    const accepted = [], expected = [];
    codes.forEach((raw, i) => {
      const code = normalizeNodeCode(raw);
      if (code === null) return;
      const conflict = codeConflictOf(accepted, code);
      if (conflict) expected.push([i + 2, conflict.id]); else accepted.push({ id: i + 2, code });
    });
    const reported = result.errors.filter((e) => e.code === "CODE_DUPLICATE").map((e) => [e.row, e.refs[0].row]);
    assert.deepEqual(reported, expected, JSON.stringify(codes));
  }
});
