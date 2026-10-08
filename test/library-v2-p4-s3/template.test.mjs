// LIBRARY V2 P4-S3 - Template Center: the generated XLSX v1 templates honour the frozen contract and RE-IMPORT through the approved P4-S2 reader/validator.
// Run: node --test test/library-v2-p4-s3/template.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as XLSX from "../../vendor/sheetjs-0.20.3/xlsx.mjs";
import { createTemplateWriter, XLSX_MIME } from "../../import-template-writer.mjs";
import { extractRawWorkbook } from "../../import-xlsx-extract.mjs";
import { inspectContainer } from "../../import-xlsx-container.mjs";
import { createXlsxReader } from "../../import-xlsx-reader.mjs";
import { validateImport } from "../../import-validate.mjs";
import { prepareCommit } from "../../import-plan.mjs";
import { sha256Hex } from "../../import-sha256.mjs";
import {
  TEMPLATE_SHEET_NAMES, SHEET_COLUMNS, TEMPLATE_HEADER_CHECKSUM, TEMPLATE_ID, TEMPLATE_GENERATOR, TEMPLATE_FILE_NAMES, TEMPLATE_EXAMPLE, buildTemplateSheets, expectedHeaders
} from "../../import-template.mjs";
import { nodeWorkerFactory, codes } from "../library-v2-p4-s2/helpers.mjs";

const writer = createTemplateWriter({ loadXlsx: async () => XLSX });
const validate = async (built) => {
  const extracted = await extractRawWorkbook(XLSX, built.bytes, { fileName: built.fileName, size: built.bytes.length });
  return { extracted, result: validateImport({ ...extracted, file: { name: built.fileName, size: built.bytes.length, sha256: sha256Hex(built.bytes) } }) };
};
const read = (bytes) => XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: true });

test("STRUCTURE (blank and example): exactly the frozen sheets in order, _meta hidden, exact headers, exact _meta keys/values, header checksum, XLSX mime and file names", async () => {
  for (const withExample of [false, true]) {
    const built = await writer.build({ withExample });
    assert.equal(built.mime, XLSX_MIME); assert.equal(built.fileName, withExample ? TEMPLATE_FILE_NAMES.example : TEMPLATE_FILE_NAMES.blank); assert.ok(built.fileName.endsWith(".xlsx"));
    assert.ok(built.bytes instanceof Uint8Array && built.bytes.length > 1000 && built.bytes.length < 100 * 1024);
    assert.deepEqual([...built.bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], "a ZIP package");
    const wb = read(built.bytes);
    assert.deepEqual(wb.SheetNames, ["HƯỚNG DẪN", "KHUNG", "MÔN", "BÀI", "_meta"]); assert.deepEqual(wb.SheetNames, [...TEMPLATE_SHEET_NAMES]);
    assert.deepEqual(wb.Workbook.Sheets.map((s) => s.Hidden), [0, 0, 0, 0, 1], "_meta is a hidden sheet, the others are visible");
    const aoa = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false });
    assert.deepEqual(aoa("KHUNG")[0], ["Tên khung chương trình"]); assert.deepEqual(aoa("MÔN")[0], ["Mã môn", "Tên môn", "Thứ tự"]); assert.deepEqual(aoa("BÀI")[0], ["Mã môn", "Mã bài", "Tên bài", "Thứ tự"]);
    for (const name of ["KHUNG", "MÔN", "BÀI"]) assert.deepEqual(aoa(name)[0], expectedHeaders(name));
    assert.deepEqual(aoa("_meta"), [["templateId", TEMPLATE_ID], ["schemaVersion", 1], ["generator", TEMPLATE_GENERATOR], ["headerChecksum", TEMPLATE_HEADER_CHECKSUM]]);
    assert.equal(aoa("KHUNG").length, withExample ? 2 : 1); assert.equal(aoa("MÔN").length, withExample ? 4 : 1); assert.equal(aoa("BÀI").length, withExample ? 8 : 1);
    assert.deepEqual(built.sheetNames, TEMPLATE_SHEET_NAMES);
  }
});
test("CONTENT: the guide sheet carries the Vietnamese instructions (columns, rules, limits, worked example text); the example variant adds a visible note; the blank data sheets have NO example rows", async () => {
  const blank = read((await writer.build()).bytes), example = read((await writer.build({ withExample: true })).bytes);
  const guide = (wb) => XLSX.utils.sheet_to_json(wb.Sheets["HƯỚNG DẪN"], { header: 1, defval: "", blankrows: false }).flat().join("\n");
  for (const text of [guide(blank), guide(example)]) {
    for (const needle of ["HƯỚNG DẪN NHẬP KHUNG CHƯƠNG TRÌNH TỪ EXCEL", "KHUNG", "MÔN", "BÀI", "Mã môn", "Tên bài", "Thứ tự", "định dạng cột Mã môn và Mã bài là Văn bản", "5000 mục", "5 MiB", "VÍ DỤ"]) assert.ok(text.includes(needle), needle);
  }
  assert.ok(!guide(blank).includes("DỮ LIỆU VÍ DỤ")); assert.ok(guide(example).includes("DỮ LIỆU VÍ DỤ trong các sheet KHUNG, MÔN, BÀI"));
  assert.equal(XLSX.utils.sheet_to_json(blank.Sheets["MÔN"], { header: 1, blankrows: false }).length, 1);
  assert.ok(TEMPLATE_EXAMPLE.framework.length >= 3 && TEMPLATE_EXAMPLE.framework.length <= 120);
});
test("RE-IMPORT (example): the generated example workbook passes the whole P4-S2 pipeline - 3 subjects, 7 lessons, one lesson without a code, explicit orders, stage 10 plan", async () => {
  const built = await writer.build({ withExample: true });
  const { extracted, result } = await validate(built);
  assert.equal(extracted.ok, true, JSON.stringify(codes(extracted.diagnostics))); assert.equal(result.ok, true, JSON.stringify(result.errors)); assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.counts, { subjects: 3, lessons: 7, total: 10 });
  assert.equal(result.model.framework.name, TEMPLATE_EXAMPLE.framework); assert.equal(result.model.nodes.filter((n) => n.code === null).length, 1);
  assert.deepEqual(result.model.nodes.filter((n) => n.kind === "subject").map((n) => [n.code, n.order, n.orderSource]), [["VP01", 1, "explicit"], ["VP02", 2, "explicit"], ["VP03", 3, "explicit"]]);
  const prepared = prepareCommit(result.model, { organization: { id: "orgA", status: "active" }, batchId: "preview1234567890123", actorUid: "pa" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.diagnostics)); assert.equal(prepared.plan.nodes.length, 10);
});
test("RE-IMPORT (blank): the blank template is STRUCTURALLY valid - container gate, sheets, _meta, template id/version, headers and checksum all pass; the only complaint is the missing data", async () => {
  const built = await writer.build();
  const gate = await inspectContainer(built.bytes, { fileName: built.fileName });
  assert.equal(gate.ok, true, JSON.stringify(codes(gate.diagnostics)));
  const { extracted, result } = await validate(built);
  assert.equal(extracted.ok, true); assert.equal(result.ok, false); assert.equal(result.model, null);
  assert.deepEqual(codes(result.errors), ["FRAMEWORK_ROW_COUNT"], "no sheet, header, template or checksum error");
  assert.equal(result.errors[0].sheet, "KHUNG"); assert.match(result.errors[0].message, /đúng một dòng dữ liệu \(dòng 2\), hiện có 0/);
  for (const forbidden of ["SHEET_MISSING", "SHEET_UNEXPECTED", "HEADER_MISSING", "HEADER_MISMATCH", "HEADER_CHECKSUM_MISMATCH", "TEMPLATE_ID_MISMATCH", "TEMPLATE_VERSION_INVALID", "META_MISSING_KEY"]) assert.ok(!codes(result.diagnostics).includes(forbidden), forbidden);
  // fill the blank template the way a user would (rows 2+ in the three data sheets) and it must validate
  const wb = read(built.bytes);
  XLSX.utils.sheet_add_aoa(wb.Sheets["KHUNG"], [["Khung do người dùng điền"]], { origin: "A2" });
  XLSX.utils.sheet_add_aoa(wb.Sheets["MÔN"], [["T01", "Số học", 1], ["T02", "Hình học", 2]], { origin: "A2" });
  XLSX.utils.sheet_add_aoa(wb.Sheets["BÀI"], [["T01", "T01-B1", "Tập hợp", 1], ["T02", null, "Điểm", 1]], { origin: "A2" });
  const filled = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }));
  const out = await validate({ bytes: filled, fileName: "dien.xlsx" });
  assert.equal(out.result.ok, true, JSON.stringify(out.result.errors)); assert.deepEqual(out.result.counts, { subjects: 2, lessons: 2, total: 4 });
});
test("RE-IMPORT through the REAL parsing Worker (module worker_threads adapter): both variants read identically to the in-process path", async () => {
  const reader = createXlsxReader({ createWorker: nodeWorkerFactory() });
  for (const withExample of [false, true]) {
    const built = await writer.build({ withExample });
    const viaWorker = await reader.readXlsx(built.bytes, { fileName: built.fileName });
    assert.equal(viaWorker.ok, true, JSON.stringify(codes(viaWorker.diagnostics)));
    const direct = await extractRawWorkbook(XLSX, built.bytes, { fileName: built.fileName, size: built.bytes.length });
    assert.deepEqual(JSON.parse(JSON.stringify(viaWorker.raw)), JSON.parse(JSON.stringify(direct.raw)));
    assert.equal(validateImport(viaWorker).ok, withExample);
  }
});
test("DETERMINISM / ISOLATION: structure is identical on every build; the writer loads the library only when building; it creates no DOM or network side effect; V1's export library is untouched", async () => {
  const a = await writer.build({ withExample: true }), b = await writer.build({ withExample: true });
  const names = (built) => read(built.bytes).SheetNames.join("|") + JSON.stringify(XLSX.utils.sheet_to_json(read(built.bytes).Sheets["MÔN"], { header: 1 }));
  assert.equal(names(a), names(b));
  let loads = 0;
  const lazy = createTemplateWriter({ loadXlsx: async () => { loads++; return XLSX; } });
  assert.equal(loads, 0, "creating the writer loads nothing"); await lazy.build(); assert.equal(loads, 1);
  assert.throws(() => createTemplateWriter({ loadXlsx: 5 }), TypeError);
  const frozen = buildTemplateSheets({ withExample: true });
  assert.ok(Object.isFrozen(frozen)); assert.equal(buildTemplateSheets({ withExample: true })["MÔN"].length, 4); assert.equal(buildTemplateSheets()["MÔN"].length, 1, "the blank definition is unchanged by the example option");
  const source = readFileSync(new URL("../../import-template-writer.mjs", import.meta.url), "utf8").split("\n").map((l) => (l.includes("//") ? l.slice(0, l.indexOf("//")) : l)).join("\n");
  assert.ok(!/\bdocument\.|window\.|fetch\(|XMLHttpRequest|localStorage|firebase|firestore/.test(source));
  assert.match(source, /import\("\.\/vendor\/sheetjs-0\.20\.3\/xlsx\.mjs"\)/);
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../vendor/xlsx.full.min.js", import.meta.url))).digest("hex"), "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99");
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../group-roster.mjs", import.meta.url))).digest("hex").length, 64);
});
test("A template with ANY header/meta tampering is still rejected: the template download is the only blessed way to a valid structure", async () => {
  const built = await writer.build({ withExample: true });
  const mutate = (fn) => { const wb = read(built.bytes); fn(wb); return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true })); };
  const cases = {
    renamedHeader: (wb) => { wb.Sheets["MÔN"].A1.v = "Mã"; },
    droppedMeta: (wb) => { delete wb.Sheets["_meta"].B4; },
    wrongVersion: (wb) => { wb.Sheets["_meta"].B2.v = 2; },
    extraSheet: (wb) => { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Thêm"); },
    removedSheet: (wb) => { delete wb.Sheets["BÀI"]; wb.SheetNames = wb.SheetNames.filter((n) => n !== "BÀI"); }
  };
  for (const [name, fn] of Object.entries(cases)) {
    const { result } = await validate({ bytes: mutate(fn), fileName: name + ".xlsx" });
    assert.equal(result.ok, false, name); assert.equal(result.model, null, name);
  }
});
