// P4-S2 FINAL CORRECTION (Architect review of c48d7de): Unicode preservation, strict styles.xml, derivative-orphan grouping, documented template strictness,
// machine-readable unsupported-browser diagnostic. Run: node --test test/library-v2-p4-s2/corrections.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XLSX, workbookBytes, validateBytes, validateRaw, rawWorkbook, fileInfo, codes, nodeWorkerFactory } from "./helpers.mjs";
import { writeZip, readZip } from "./zipkit.mjs";
import { checkWellFormedXml } from "../../import-xml-wellformed.mjs";
import { extractRawWorkbook } from "../../import-xlsx-extract.mjs";
import { inspectContainer } from "../../import-xlsx-container.mjs";
import { createXlsxReader, browserWorkerFactory, UnsupportedBrowserError } from "../../import-xlsx-reader.mjs";
import { detectReaderCapabilities, detectWorkerSideCapabilities, unsupportedBrowserDiagnostic, CAPABILITY_IDS } from "../../import-capabilities.mjs";
import { validateImport } from "../../import-validate.mjs";
import { buildImportPlan, materializePayloads } from "../../import-plan.mjs";
import { TEMPLATE_STRICTNESS, IMPORT_LIMITS } from "../../import-template.mjs";
import { DIAGNOSTIC_CODES } from "../../import-diagnostics.mjs";

const run = async (options) => (await validateBytes(workbookBytes(options))).result;
const has = (result, code, where = {}) => result.diagnostics.some((d) => d.code === code && Object.entries(where).every(([k, v]) => (k === "otherRow" ? d.refs[0] && d.refs[0].row === v : d[k] === v)));
const bytesOf = (text) => new TextEncoder().encode(text);
const entriesOf = (bytes = workbookBytes()) => readZip(bytes).map((e) => ({ name: e.name, data: e.data }));
const withStyles = (data, extra = {}) => writeZip(entriesOf().map((e) => (e.name === "xl/styles.xml" ? { ...e, data, ...extra } : e)));
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// ------------------------------------------------------------------------------------------- 1. Unicode preservation
test("UNICODE: stored/display values keep the user's exact sequence (NFC stays NFC, NFD stays NFD, mixed stays mixed) - only surrounding whitespace is trimmed", async () => {
  const nfc = "Số học", nfd = "Số học".normalize("NFD"), mixed = "S" + "ố".normalize("NFD") + " h" + "ọ".normalize("NFC") + "c";
  assert.notEqual(nfc, nfd);
  const result = await run({ framework: ["Chương trình".normalize("NFD")], subjects: [["A", nfc, 1], ["B", nfd, 2], ["C", mixed, 3]], lessons: [["A", "bài-à".normalize("NFD"), "tập hợp".normalize("NFD"), 1]] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const [a, b, c, lesson] = result.model.nodes;
  assert.equal(a.name, nfc); assert.equal(b.name, nfd); assert.equal(c.name, mixed);
  assert.equal(lesson.name, "tập hợp".normalize("NFD")); assert.equal(lesson.code, "bài-à".normalize("NFD"));
  assert.equal(result.model.framework.name, "Chương trình".normalize("NFD"));
  for (const node of result.model.nodes) assert.ok(!node.notes.some((n) => n.endsWith(":nfc")) && !node.original, "no normalization note and no 'original' when only the sequence is preserved");
  assert.ok(!("original" in result.model.framework));
  const fullWidth = "Ｔ01-Đ";
  const keep = await run({ subjects: [[fullWidth, "n", null]], lessons: [] });
  assert.equal(keep.model.nodes[0].code, fullWidth, "NFKC is a comparison key only");
});
test("UNICODE: trimming is the only change; inner whitespace, NBSP inside, double spaces and the exact sequence survive; the untrimmed original is kept", async () => {
  const nbsp = String.fromCharCode(0xa0);
  const result = await run({ subjects: [["  A1 ", nbsp + "Môn  một" + nbsp + "hai " + nbsp, null]], lessons: [] });
  assert.equal(result.ok, true);
  const node = result.model.nodes[0];
  assert.equal(node.code, "A1"); assert.equal(node.name, "Môn  một" + nbsp + "hai");
  assert.deepEqual([...node.notes].sort(), ["code:trim", "name:trim"]); assert.equal(node.original.code, "  A1 "); assert.equal(node.original.name, nbsp + "Môn  một" + nbsp + "hai " + nbsp);
});
test("UNICODE: canonical equivalence is used ONLY for comparisons (P3): NFC/NFD/full-width/case duplicates still collide, subject references still match, nothing is rewritten", async () => {
  const dup = await run({ subjects: [["Đạo-1", "a", null], ["Đạo-1".normalize("NFD"), "b", null]], lessons: [] });
  assert.ok(has(dup, "CODE_DUPLICATE", { sheet: "MÔN", row: 3, otherRow: 2 }));
  assert.ok(has(await run({ subjects: [["ab1", "a", null], ["ＡＢ１", "b", null]], lessons: [] }), "CODE_DUPLICATE"));
  const ref = await run({ subjects: [["Toán-Đ", "Toán", null]], lessons: [["Toán-Đ".normalize("NFD"), "x", "Bài", null], ["TOÁN-đ", "y", "Bài 2", null]] });
  assert.equal(ref.ok, true, JSON.stringify(ref.errors));
  assert.ok(ref.model.nodes.filter((n) => n.kind === "lesson").every((n) => n.parentKey === "MON:2"));
  assert.equal(ref.model.nodes[1].subjectCodeRef, "Toán-Đ".normalize("NFD"), "the reference text is preserved as typed, matched canonically");
});
test("UNICODE: the preserved sequence reaches the plan, the payloads and the verification block unchanged; P3 length bounds apply to the stored sequence", async () => {
  const nfd = "Hình học phẳng".normalize("NFD");
  const r = validateRaw({ subjects: [["H1", nfd, null]], lessons: [["H1", "h-1".normalize("NFD"), "Điểm và đường thẳng".normalize("NFD"), null]], framework: "Khung".normalize("NFD") + " " + "Việt".normalize("NFD") });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const plan = buildImportPlan(r.model, { organizationId: "orgA", batchId: "Ab12Cd34Ef56Gh78Ij90" });
  assert.equal(plan.nodes[0].name, nfd); assert.equal(plan.framework.name, "Khung".normalize("NFD") + " " + "Việt".normalize("NFD"));
  assert.equal(plan.verification.expectedNodes[1].name, "Điểm và đường thẳng".normalize("NFD"));
  const payloads = materializePayloads(plan, { actorUid: "pa", serverTimestamp: () => "TS" });
  assert.equal(payloads.chunks[0].writes[0].data.name, nfd); assert.equal(payloads.framework.data.name, plan.framework.name);
  const long = "ế".repeat(150);                                                                     // 150 UTF-16 units precomposed, 300 decomposed (ế = e + circumflex + acute)
  assert.equal((await run({ subjects: [["A", long, null]], lessons: [] })).ok, true);
  const inflated = await run({ subjects: [["A", long.normalize("NFD"), null]], lessons: [] });
  assert.ok(has(inflated, "NAME_LENGTH", { sheet: "MÔN", row: 2 }), "the limit is measured on the stored sequence (P3 validateNodeName)");
});
test("UNICODE: template identity (sheet names, headers, _meta keys) is compared after NFC but never stored; NFD headers/sheet names are accepted", async () => {
  const result = await run({ headers: { "MÔN": ["Mã môn".normalize("NFD"), "Tên môn".normalize("NFD"), "Thứ tự".normalize("NFD")] } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.model.generator, "hcma2-teaching/import-template@1");
});

// ------------------------------------------------------------------------------------------- 2. styles.xml
test("XML CHECKER: well-formed documents are accepted (declaration, BOM, comments, CDATA, PI, entities, prefixes, self-closing, UTF-16 with BOM)", () => {
  const ok = (text, options) => { const r = checkWellFormedXml(typeof text === "string" ? bytesOf(text) : text, options); assert.equal(r.ok, true, String(text).slice(0, 60) + " -> " + r.detail); return r; };
  ok('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<styleSheet xmlns="' + NS + '"><fonts count="1"><font><sz val="11"/></font></fonts></styleSheet>', { rootName: "styleSheet" });
  ok("<a/>"); ok("<a></a>"); ok("<a b='1' c=\"2\"/>"); ok("<a>text &amp; &lt; &gt; &quot; &apos; &#65; &#x41;</a>"); ok("<a><!-- ok --><![CDATA[ <raw> & ]]><?pi data?></a>");
  ok("<!-- lead --><?x y?><a/><!-- tail -->"); ok("<x:styleSheet xmlns:x='" + NS + "'><x:fonts/></x:styleSheet>", { rootName: "styleSheet" });
  ok(new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf("<a>Số học</a>")]));
  const utf16 = (text, le) => { const out = new Uint8Array(2 + text.length * 2); out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]); for (let i = 0; i < text.length; i++) { const cu = text.charCodeAt(i); out[2 + i * 2 + (le ? 0 : 1)] = cu & 255; out[2 + i * 2 + (le ? 1 : 0)] = cu >> 8; } return out; };
  ok(utf16('<?xml version="1.0" encoding="UTF-16"?><a>Việt</a>', true)); ok(utf16("<a>Việt</a>", false));
  ok("<a>" + "<b>".repeat(60) + "</b>".repeat(60) + "</a>");
});
test("XML CHECKER: malformed documents are rejected with a reason (never a crash), including hostile nesting and encodings", () => {
  const bad = (input, options) => { const r = checkWellFormedXml(typeof input === "string" ? bytesOf(input) : input, options); assert.equal(r.ok, false, String(input).slice(0, 60)); assert.ok(r.detail.length > 3); return r.detail; };
  for (const text of ["", "   ", "text", "<a>", "<a></b>", "<a><b></a></b>", "</a>", "<a/><b/>", "<a/>trailing", "text<a/>", "<a b=1/>", "<a b='1' b='2'/>", "<a b='1'c='2'/>", "<a b/>", "<a b=/>", "<a b='x/>", "<a b='<'/>",
    "<a>&</a>", "<a>&foo;</a>", "<a>&#xZZ;</a>", "<a>&#0;</a>", "<a>&#x110000;</a>", "<a>]]></a>", "<a><!-- -- --></a>", "<a><!-- unclosed</a>", "<a><![CDATA[ unclosed</a>", "<a><?pi unclosed</a>",
    "<1a/>", "<a b='1' / >", "<a/ >", "<?xml version=\"1.0\"?><?xml version=\"1.0\"?><a/>", "<?xml?><a/>", "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><a/>",
    "<!DOCTYPE a [<!ENTITY x 'y'>]><a/>", "<a><!DOCTYPE b></a>", "<a><!ELEMENT x></a>", "<a>" + String.fromCharCode(1) + "</a>", "<a>" + String.fromCharCode(0xfffe) + "</a>"]) bad(text);
  bad(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0xfd, 0x3c, 0x2f, 0x61, 0x3e]));             // invalid UTF-8
  bad(new Uint8Array([0xff, 0xfe, 0x3c]));                                                              // truncated UTF-16
  bad("<a>" + "<b>".repeat(100) + "</b>".repeat(100) + "</a>");                                          // depth bomb
  bad("<a " + Array.from({ length: 300 }, (_, i) => "x" + i + "='1'").join(" ") + "/>");                // attribute bomb
  bad("<a/>", { rootName: "styleSheet" }); bad("<styleSheetX/>", { rootName: "styleSheet" });
  bad(new Uint8Array(5 * 1024 * 1024).fill(0x20), { maxBytes: 4 * 1024 * 1024 });
  assert.match(bad("<a></b>"), /không khớp/);
});
test("STYLES (workbook level): a MALFORMED xl/styles.xml is rejected before the library reads it - truncated, mismatched, unquoted, duplicate attribute, bad entity, wrong root/namespace, invalid UTF-8, empty, binary, depth bomb, oversized", async () => {
  const good = entriesOf().find((e) => e.name === "xl/styles.xml").data.toString("utf8");
  const variants = {
    truncated: good.slice(0, Math.floor(good.length / 2)),
    unclosedRoot: good.replace("</styleSheet>", ""),
    mismatched: good.replace("</fonts>", "</font>"),
    unquotedAttribute: good.replace('count="1"', "count=1"),
    duplicateAttribute: good.replace('<fonts count="1"', '<fonts count="1" count="2"'),
    badEntity: good.replace("<fonts", "<fonts note=\"a &bogus; b\""),
    bareAmpersand: good.replace("<fonts", "<fonts note=\"a & b\""),
    textBeforeRoot: "junk" + good,
    secondRoot: good + "<styleSheet/>",
    wrongRoot: "<workbook xmlns=\"" + NS + "\"/>",
    wrongNamespace: good.split(NS).join("urn:not-spreadsheetml"),
    empty: "",
    plainText: "garbage",
    binary: String.fromCharCode(0, 1, 2, 3, 4, 5),
    controlChar: good.replace("<fonts", "<fonts note=\"a" + String.fromCharCode(1) + "b\""),
    depthBomb: '<styleSheet xmlns="' + NS + '">' + "<x>".repeat(120) + "</x>".repeat(120) + "</styleSheet>"
  };
  for (const [name, text] of Object.entries(variants)) {
    for (const method of [8, 0]) {
      const r = await extractRawWorkbook(XLSX, withStyles(Buffer.from(text, "utf8"), { method }), { fileName: "a.xlsx" });
      assert.equal(r.ok, false, name + "/method " + method); assert.equal(r.raw, null);
      assert.ok(codes(r.diagnostics).includes("STYLES_INVALID"), name + " -> " + JSON.stringify(codes(r.diagnostics)));
    }
  }
  const invalidUtf8 = await extractRawWorkbook(XLSX, withStyles(Buffer.concat([Buffer.from(good.slice(0, 200)), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from(good.slice(200))])), { fileName: "a.xlsx" });
  assert.ok(codes(invalidUtf8.diagnostics).includes("STYLES_INVALID"));
  const { randomBytes } = await import("node:crypto");
  const oversized = await extractRawWorkbook(XLSX, withStyles(Buffer.from('<styleSheet xmlns="' + NS + '"><!--' + randomBytes(IMPORT_LIMITS.zip.maxStylesBytes / 2 + 100).toString("hex") + '--></styleSheet>')), { fileName: "a.xlsx" });
  assert.ok(codes(oversized.diagnostics).includes("STYLES_INVALID"), "a styles part above the bound is rejected, not skipped");
  const dtd = await extractRawWorkbook(XLSX, withStyles(Buffer.from('<?xml version="1.0"?><!DOCTYPE styleSheet [<!ENTITY a "b">]><styleSheet xmlns="' + NS + '"/>')), { fileName: "a.xlsx" });
  assert.deepEqual(codes(dtd.diagnostics), ["XML_DTD_FORBIDDEN"]);
  const message = (await extractRawWorkbook(XLSX, withStyles(Buffer.from(variants.mismatched)), { fileName: "a.xlsx" })).diagnostics[0].message;
  assert.match(message, /xl\/styles\.xml/); assert.match(message, /hỏng hoặc không hợp lệ/);
  const result = (await validateBytes(withStyles(Buffer.from(variants.mismatched)))).result;
  assert.equal(result.ok, false); assert.equal(result.model, null);
});
test("STYLES (workbook level): VALID optional styles behave per OOXML - an absent part is fine, SheetJS' own part, an Excel-style part with BOM/CRLF/comments/prefix, and a declared-UTF-8 part are all accepted and the data is read", async () => {
  const base = entriesOf();
  // a package WITHOUT a styles part is valid OOXML only if nothing refers to it: drop the part, its content-type override and its relationship
  const dropLines = (text, marker) => text.split("<").filter((piece) => !piece.includes(marker)).join("<");
  const noStyles = writeZip(base.filter((e) => e.name !== "xl/styles.xml").map((e) => (e.name === "[Content_Types].xml" ? { ...e, data: dropLines(e.data.toString(), 'PartName="/xl/styles.xml"') } : e.name === "xl/_rels/workbook.xml.rels" ? { ...e, data: dropLines(e.data.toString(), 'Target="styles.xml"') } : e)));
  const absent = await validateBytes(noStyles);
  assert.equal(absent.extracted.ok, true, JSON.stringify(codes(absent.extracted.diagnostics))); assert.equal(absent.result.ok, true, JSON.stringify(absent.result.errors)); assert.equal(absent.result.counts.total, 5);
  const excel = '﻿<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<!-- generated -->\r\n<styleSheet xmlns="' + NS + '" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">\r\n  <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₫&quot;#,##0"/></numFmts>\r\n  <fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>\r\n  <fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>\r\n  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>\r\n</styleSheet>';
  for (const text of [excel, excel.replace("﻿", "")]) {
    const r = await validateBytes(withStyles(Buffer.from(text, "utf8")));
    assert.equal(r.extracted.ok, true, JSON.stringify(codes(r.extracted.diagnostics))); assert.equal(r.result.ok, true, JSON.stringify(r.result.errors));
  }
  const prefixed = '<x:styleSheet xmlns:x="' + NS + '"><x:fonts count="0"/></x:styleSheet>';
  const gate = await inspectContainer(withStyles(Buffer.from(prefixed)), { fileName: "a.xlsx" });
  assert.equal(gate.ok, true, JSON.stringify(codes(gate.diagnostics)));
  const strictNs = '<styleSheet xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main"/>';
  assert.equal((await inspectContainer(withStyles(Buffer.from(strictNs)), { fileName: "a.xlsx" })).ok, true, "ISO strict namespace");
  assert.equal((await validateBytes(workbookBytes())).result.ok, true, "the part the writer itself produces");
});

// ------------------------------------------------------------------------------------------- 3. derivative orphans
test("ORPHANS: when a subject's CODE cell is already rejected, lessons that point at that same text are NOT reported as orphans - one grouped warning, the root cause stays", async () => {
  const formula = (wb) => { wb.Sheets["MÔN"].A2 = { t: "s", v: "T01", f: 'CONCAT("T","01")' }; };
  const result = await run({ mutate: formula });
  assert.equal(result.ok, false); assert.equal(result.model, null);
  assert.ok(has(result, "CELL_FORMULA", { sheet: "MÔN", row: 2, field: "subjectCode" }), "root cause preserved");
  assert.ok(!has(result, "LESSON_ORPHAN"), "no derivative orphan errors: " + JSON.stringify(codes(result.errors)));
  const grouped = result.diagnostics.filter((d) => d.code === "LESSONS_OF_INVALID_SUBJECT");
  assert.equal(grouped.length, 1); assert.equal(grouped[0].severity, "warning");
  assert.match(grouped[0].message, /^Sheet “BÀI”, dòng 2, cột “Mã môn”: 2 bài tham chiếu mã môn “T01” của dòng 2 \(sheet MÔN\)/);
  assert.deepEqual(grouped[0].refs.map((r) => r.sheet + ":" + r.row), ["MÔN:2", "BÀI:2", "BÀI:3"]);
  assert.deepEqual(result.errors.map((e) => e.code), ["CELL_FORMULA"], "exactly the root cause is an error");
  const mixed = await run({ mutate: formula, lessons: [["T01", "a", "x", 1], ["T01", "b", "y", 2], ["KHAC", "c", "z", 3], ["T02", "d", "w", 1]] });
  const orphans = mixed.errors.filter((e) => e.code === "LESSON_ORPHAN");
  assert.deepEqual(orphans.map((e) => [e.sheet, e.row]), [["BÀI", 4]], "a genuinely unknown subject is still an error");
  assert.equal(mixed.diagnostics.find((d) => d.code === "LESSONS_OF_INVALID_SUBJECT").refs.length, 3);
  assert.equal(mixed.errors.length, 2);
});
test("ORPHANS: derivative grouping applies to every rejected-code cause with readable text (formula, control character) and matches canonically (case, Unicode form, spaces)", async () => {
  const ctrl = String.fromCharCode(1);
  const control = await run({ subjects: [["T01" + ctrl, "Toán", 1]], lessons: [["T01" + ctrl, "a", "x", 1]] });
  assert.ok(has(control, "CHAR_CONTROL", { sheet: "MÔN", row: 2 })); assert.ok(has(control, "CHAR_CONTROL", { sheet: "BÀI", row: 2 }), "the lesson's own reference cell is rejected for the same reason");
  assert.ok(!has(control, "LESSON_ORPHAN"), "a lesson whose reference cell is itself rejected is never an orphan");
  const loose = await run({ mutate: (wb) => { wb.Sheets["MÔN"].A2 = { t: "s", v: "Đạo-1", f: '"x"' }; }, subjects: [["x", "Toán", 1], ["T02", "Hình", 2]], lessons: [[" ĐẠO-1 ".normalize("NFD"), "a", "x", 1]] });
  assert.ok(!has(loose, "LESSON_ORPHAN")); assert.equal(loose.diagnostics.filter((d) => d.code === "LESSONS_OF_INVALID_SUBJECT").length, 1);
  const blank = await run({ subjects: [[null, "Môn thiếu mã", 1], ["T02", "Hình", 2]], lessons: [["T01", "a", "x", 1]] });
  assert.ok(has(blank, "REQUIRED_MISSING", { sheet: "MÔN", row: 2 })); assert.ok(has(blank, "LESSON_ORPHAN"), "a blank subject code gives no readable text: the lesson error stays");
  const boolean = await run({ subjects: [[true, "Toán", 1]], lessons: [["TRUE", "a", "x", 1]] });
  assert.ok(has(boolean, "CELL_TYPE_BOOLEAN")); assert.ok(has(boolean, "LESSON_ORPHAN"), "no text recoverable -> not claimed to be derivative");
});
test("ORPHANS: grouping never makes an invalid workbook importable (still no model, no plan)", async () => {
  const bad = await run({ mutate: (wb) => { wb.Sheets["MÔN"].A2 = { t: "s", v: "T01", f: '"T01"' }; } });
  assert.equal(bad.model, null); assert.equal(bad.ok, false); assert.equal(bad.ready, false);
  assert.throws(() => buildImportPlan(bad.model, { organizationId: "o", batchId: "b1" }));
});

// ------------------------------------------------------------------------------------------- 4. documented strictness
test("STRICTNESS: unexpected worksheets and formulas remain ERRORS; the Architect-approved policy is a pinned, machine-readable constant", async () => {
  assert.deepEqual({ ...TEMPLATE_STRICTNESS }, { unexpectedWorksheets: "error", formulaCells: "error", malformedStylesPart: "error", booleanDateErrorCells: "error", numericTextFields: "error", unicode: "preserve-after-trim", unsupportedBrowser: "fail-closed" });
  assert.ok(Object.isFrozen(TEMPLATE_STRICTNESS));
  const extra = await run({ extraSheets: { "Ghi chú": [["x"]] } });
  assert.equal(extra.errors.find((e) => e.code === "SHEET_UNEXPECTED").severity, "error"); assert.equal(extra.model, null);
  const formula = await run({ mutate: (wb) => { wb.Sheets["BÀI"].C2 = { t: "s", v: "Bài", f: '"Bài"' }; } });
  assert.equal(formula.errors.find((e) => e.code === "CELL_FORMULA").severity, "error"); assert.equal(formula.model, null);
  const source = readFileSync(new URL("../../import-template.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("Architect-approved") && source.includes("STRICTER than the R2 s9 table"));
});

// ------------------------------------------------------------------------------------------- 5. unsupported browser
test("BROWSER: the machine-readable BROWSER_UNSUPPORTED diagnostic carries stable capability ids and Vietnamese text; it is frozen JSON data", () => {
  const d = unsupportedBrowserDiagnostic(["decompression-stream", "module-worker"]);
  assert.equal(d.code, "BROWSER_UNSUPPORTED"); assert.equal(d.severity, "error"); assert.equal(d.stage, 1);
  assert.deepEqual(d.data.missing, ["decompression-stream", "module-worker"]); assert.ok(d.data.missing.every((id) => CAPABILITY_IDS.includes(id)));
  assert.equal(typeof d.data.minimum.firefox, "number"); assert.ok(Object.isFrozen(d.data) && Object.isFrozen(d.data.missing));
  assert.match(d.message, /chưa hỗ trợ đọc tệp Excel một cách an toàn \(thiếu: decompression-stream, module-worker\)/); assert.match(d.hint, /Chrome, Edge, Firefox hoặc Safari/);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), { ...d, refs: [], data: d.data }, "survives postMessage/JSON");
  assert.ok(DIAGNOSTIC_CODES.includes("BROWSER_UNSUPPORTED"));
  assert.deepEqual([...CAPABILITY_IDS], ["worker", "module-worker", "decompression-stream", "readable-stream", "text-decoder"]);
});
test("BROWSER: capability detection is a pure function of the scope; the UI can pre-check before a file is chosen", () => {
  const full = { Worker: function Worker() {}, DecompressionStream: function D() {}, ReadableStream: function R() {}, TextDecoder: function T() {} };
  assert.deepEqual({ ...detectReaderCapabilities(full) }, { supported: true, missing: [] });
  assert.deepEqual([...detectReaderCapabilities({ ...full, DecompressionStream: undefined }).missing], ["decompression-stream"]);
  assert.deepEqual([...detectReaderCapabilities({}).missing], ["worker", "decompression-stream", "readable-stream", "text-decoder"]);
  assert.deepEqual([...detectWorkerSideCapabilities({ ...full, Worker: undefined }).missing], [], "the Worker scope does not need Worker itself");
  assert.equal(detectWorkerSideCapabilities().supported, true, "this runtime has the Worker-side capabilities");
});
test("BROWSER: the default worker factory reports a missing Worker and a browser that ignores { type: 'module' }; it never falls back", () => {
  assert.throws(() => browserWorkerFactory({}), (e) => e instanceof UnsupportedBrowserError && e.missing.length === 1 && e.missing[0] === "worker");
  let terminated = 0;
  const legacy = { Worker: function Worker(url, options) { this.terminate = () => { terminated++; }; /* a legacy engine never reads options.type */ } };
  assert.throws(() => browserWorkerFactory(legacy), (e) => e.missing[0] === "module-worker"); assert.equal(terminated, 1, "the classic-script worker that was created is terminated at once");
  let urlSeen = null;
  const modern = { Worker: function Worker(url, options) { urlSeen = String(url); assert.equal(options.type, "module"); this.terminate = () => {}; } };
  assert.ok(browserWorkerFactory(modern)); assert.match(urlSeen, /import-xlsx-worker\.mjs$/);
});
test("BROWSER: the reader returns unsupportedBrowser + the diagnostic when the Worker cannot exist; validateImport exposes it machine-readably; no model, no parse", async () => {
  const reader = createXlsxReader({ createWorker: () => { throw new UnsupportedBrowserError(["module-worker"]); } });
  const reading = await reader.readXlsx(workbookBytes(), { fileName: "a.xlsx" });
  assert.equal(reading.ok, false); assert.equal(reading.unsupportedBrowser, true); assert.equal(reading.raw, null); assert.deepEqual(codes(reading.diagnostics), ["BROWSER_UNSUPPORTED"]);
  assert.deepEqual(reading.diagnostics[0].data.missing, ["module-worker"]);
  const result = validateImport(reading);
  assert.equal(result.ok, false); assert.equal(result.model, null); assert.equal(result.unsupportedBrowser, true); assert.deepEqual(result.missingCapabilities, ["module-worker"]);
  const normal = validateImport({ ok: false, diagnostics: [], raw: null });
  assert.equal(normal.unsupportedBrowser, false); assert.deepEqual(normal.missingCapabilities, []);
  const generic = await createXlsxReader({ createWorker: () => { throw new Error("boom"); } }).readXlsx(workbookBytes(), { fileName: "a.xlsx" });
  assert.deepEqual(codes(generic.diagnostics), ["PARSE_EXCEPTION"]); assert.notEqual(generic.unsupportedBrowser, true);
});
test("BROWSER: inside the Worker scope a missing DecompressionStream fails CLOSED with BROWSER_UNSUPPORTED - the library never sees the file", async () => {
  const saved = globalThis.DecompressionStream;
  let reads = 0;
  const spy = { ...XLSX, read: (...args) => { reads++; return XLSX.read(...args); } };
  try {
    delete globalThis.DecompressionStream;
    const bytes = workbookBytes();
    const r = await extractRawWorkbook(spy, bytes, { fileName: "a.xlsx", size: bytes.length });
    assert.equal(r.ok, false); assert.equal(r.raw, null); assert.equal(r.unsupportedBrowser, true);
    assert.deepEqual(codes(r.diagnostics), ["BROWSER_UNSUPPORTED"]); assert.deepEqual(r.diagnostics[0].data.missing, ["decompression-stream"]);
    assert.equal(reads, 0, "no unsafe fallback: the spreadsheet library was never called");
  } finally { globalThis.DecompressionStream = saved; }
  const bytes = workbookBytes();
  assert.equal((await extractRawWorkbook(spy, bytes, { fileName: "a.xlsx", size: bytes.length })).ok, true, "restored: the same file is read");
});
test("BROWSER: end to end through the real Worker the unsupported state is propagated by the Worker message, and the reader module has no main-thread parsing path", async () => {
  const text = readFileSync(new URL("../../import-xlsx-reader.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/import-xlsx-extract|vendor\/|inspectContainer|scanEntries|inspectZip|XLSX\./.test(text), "the page-side reader cannot parse a workbook itself");
  const fakeWorker = (diagnostics) => () => {
    const listeners = { message: new Set(), error: new Set(), messageerror: new Set() };
    return { postMessage: (m) => queueMicrotask(() => listeners.message.forEach((fn) => fn({ data: { type: "result", id: m.id, ok: false, diagnostics, raw: null } }))), terminate() {}, addEventListener: (t, fn) => listeners[t].add(fn), removeEventListener: (t, fn) => listeners[t].delete(fn) };
  };
  const reading = await createXlsxReader({ createWorker: fakeWorker([unsupportedBrowserDiagnostic(["decompression-stream"])]) }).readXlsx(workbookBytes(), { fileName: "a.xlsx" });
  assert.equal(reading.unsupportedBrowser, true); assert.deepEqual(reading.diagnostics[0].data.missing, ["decompression-stream"]);
  const real = await createXlsxReader({ createWorker: nodeWorkerFactory() }).readXlsx(workbookBytes(), { fileName: "a.xlsx" });
  assert.equal(real.ok, true, "a supported runtime is unaffected");
});
