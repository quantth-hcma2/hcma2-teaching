// P4-S2 - READER QUALIFICATION GATE (R2 s8 "new first task of P4-S2"): SheetJS CE 0.20.3, vendored, hash-pinned, contained by the container gate + a dedicated Worker.
// Covers: provenance/isolation, valid workbooks, malformed and hostile fixtures (zip bombs, lying headers, overlapping/duplicate/traversal entries, macros, external links,
// DTDs, shared-string and row/column floods, legacy/encrypted files), CVE-class fixtures, prototype pollution, Worker timeout + termination.
// Run: node --test test/library-v2-p4-s2/reader-qualification.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { Worker } from "node:worker_threads";
import { XLSX, workbookBytes, nodeWorkerFactory, terminated, codes, validateBytes } from "./helpers.mjs";
import { writeZip, readZip } from "./zipkit.mjs";
import { createXlsxReader } from "../../import-xlsx-reader.mjs";
import { extractRawWorkbook } from "../../import-xlsx-extract.mjs";
import { inspectContainer, inspectZip, checkFileEnvelope, contentTypesAreMacroEnabled } from "../../import-xlsx-container.mjs";
import { IMPORT_LIMITS } from "../../import-template.mjs";

const root = new URL("../../", import.meta.url);
const sha = (path) => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
const base = () => workbookBytes();
const entriesOf = (bytes = base()) => readZip(bytes).map((e) => ({ name: e.name, data: e.data }));
const gate = (bytes, fileName = "mau.xlsx") => extractRawWorkbook(XLSX, bytes, { fileName, size: bytes.length });
const MiB = 1024 * 1024;

// ------------------------------------------------------------------------------------------- provenance / isolation
test("PROVENANCE: SheetJS CE 0.20.3 is vendored as a SEPARATE hash-pinned file with its Apache-2.0 license and a provenance record; V1's 0.18.5 is byte-identical", () => {
  assert.equal(sha("vendor/sheetjs-0.20.3/xlsx.mjs"), "1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
  assert.equal(sha("vendor/sheetjs-0.20.3/LICENSE"), "4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64");
  assert.equal(sha("vendor/sheetjs-0.20.3/LICENSE"), sha("vendor/XLSX-LICENSE.txt"), "same Apache-2.0 text as the V1 license file");
  assert.equal(sha("vendor/xlsx.full.min.js"), "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99", "V1 SheetJS 0.18.5 untouched");
  assert.equal(XLSX.version, "0.20.3");
  const provenance = readFileSync(new URL("vendor/sheetjs-0.20.3/PROVENANCE.md", root), "utf8");
  for (const needle of ["https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz", "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8", "Apache-2.0", "CVE-2023-30533", "CVE-2024-22363", "no CDN at runtime"]) assert.ok(provenance.includes(needle), needle);
  assert.ok(!/^\s*import\s/m.test(readFileSync(new URL("vendor/sheetjs-0.20.3/xlsx.mjs", root), "utf8")), "the vendored build has no import statement (no dependencies)");
});
test("ISOLATION: no runtime module references a CDN or any network API; exactly one module imports the vendored reader (the Worker); index.html does not load it", () => {
  const modules = ["import-template-writer.mjs", "import-xlsx-worker.mjs", "import-xlsx-extract.mjs", "import-xlsx-container.mjs", "import-xlsx-reader.mjs", "import-normalize.mjs", "import-validate.mjs", "import-plan.mjs", "import-template.mjs", "import-diagnostics.mjs", "import-sha256.mjs"];
  const importers = [];
  for (const file of modules) {
    const text = readFileSync(new URL(file, root), "utf8");
    assert.ok(!/cdn\.sheetjs|https?:\/\//i.test(text.replace(/\/\/.*$/gm, "")), file + " references a URL in code");
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|importScripts|localStorage|indexedDB|firebase)\b/.test(text.replace(/\/\/.*$/gm, "")), file + " touches a network/storage API");
    if (/vendor\/sheetjs-0\.20\.3\/xlsx\.mjs/.test(text.replace(/\/\/.*$/gm, ""))) importers.push(file);
  }
  assert.deepEqual(importers.sort(), ["import-template-writer.mjs", "import-xlsx-worker.mjs"], "P4-S3 aligned: the parsing Worker and the lazy Template Center writer (it only builds our own template) are the two importers");
  const index = readFileSync(new URL("index.html", root), "utf8");
  assert.ok(!index.includes("sheetjs-0.20.3") && !index.includes("import-xlsx"), "index.html does not load the new reader (not wired in P4-S2)");
});

// ------------------------------------------------------------------------------------------- valid workbooks
test("VALID: template-conformant workbooks pass the gate and extract plain, structured-clone-safe data (in-process and through the real Worker)", async () => {
  const bytes = base();
  const direct = await gate(bytes);
  assert.equal(direct.ok, true); assert.deepEqual(direct.diagnostics, []);
  assert.equal(direct.raw.parser, "parser.xlsx.v1"); assert.match(direct.raw.library, /0\.20\.3/);
  assert.deepEqual(direct.raw.sheetNames, ["HƯỚNG DẪN", "KHUNG", "MÔN", "BÀI", "_meta"]);
  assert.equal(direct.raw.sheets.find((s) => s.name === "_meta").state, "hidden");
  structuredClone(direct.raw);                                                  // must be cloneable (postMessage)
  const viaWorker = await createXlsxReader({ createWorker: nodeWorkerFactory() }).readXlsx(bytes, { fileName: "mau.xlsx" });
  assert.equal(viaWorker.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(viaWorker.raw)), JSON.parse(JSON.stringify(direct.raw)), "Worker output equals in-process output");
  assert.equal(viaWorker.file.size, bytes.length);
  assert.equal(viaWorker.file.sha256, createHash("sha256").update(bytes).digest("hex"));
});
test("VALID: the Worker is terminated after every parse (success, failure, timeout)", async () => {
  const before = terminated.count;
  const reader = createXlsxReader({ createWorker: nodeWorkerFactory() });
  await reader.readXlsx(base(), { fileName: "a.xlsx" });
  await reader.readXlsx(new Uint8Array([1, 2, 3, 4, 5]), { fileName: "a.xlsx" });                  // rejected before a Worker is even created
  await reader.readXlsx(entriesOf().length ? writeZip(entriesOf().filter((e) => e.name !== "xl/workbook.xml")) : base(), { fileName: "a.xlsx" });
  assert.equal(terminated.count - before, 2, "one terminate per Worker created; envelope rejections create none");
});

// ------------------------------------------------------------------------------------------- envelope
test("ENVELOPE: empty, oversized, wrong extension, plain text, legacy .xls / encrypted OLE and truncated files are rejected with specific codes", async () => {
  assert.deepEqual(codes(checkFileEnvelope(new Uint8Array(0), { fileName: "a.xlsx" })), ["FILE_EMPTY"]);
  assert.ok(codes(checkFileEnvelope(base(), { fileName: "a.xls" })).includes("FILE_EXTENSION"));
  for (const name of ["a.xlsm", "a.xlsb", "a.csv", "a.ods", "a.xlsx.exe", "a"]) assert.ok(codes(checkFileEnvelope(base(), { fileName: name })).includes("FILE_EXTENSION"), name);
  assert.ok(codes(checkFileEnvelope(new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1).fill(0x50), { fileName: "a.xlsx" })).includes("FILE_TOO_LARGE"));
  assert.deepEqual(codes(checkFileEnvelope(new TextEncoder().encode("a,b,c\n1,2,3\n"), { fileName: "a.xlsx" })), ["FILE_NOT_ZIP"]);
  const ole = new Uint8Array(2048); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.deepEqual(codes(checkFileEnvelope(ole, { fileName: "a.xlsx" })), ["FILE_LEGACY_OR_ENCRYPTED"]);
  const good = base();
  for (const cut of [10, 22, 60, Math.floor(good.length / 2)]) {
    const r = await gate(good.subarray(0, good.length - cut));
    assert.equal(r.ok, false, "truncated by " + cut); assert.equal(r.raw, null);
  }
  const reader = createXlsxReader({ createWorker: () => { throw new Error("must not create a Worker for a rejected envelope"); } });
  const declared = await reader.readXlsx({ size: IMPORT_LIMITS.maxFileBytes + 10, name: "big.xlsx", arrayBuffer: () => { throw new Error("must not read an oversized file"); } });
  assert.ok(codes(declared.diagnostics).includes("FILE_TOO_LARGE"));
});

// ------------------------------------------------------------------------------------------- structure
const mutateCentral = (bytes, index, apply) => {                       // edit one central-directory record in place
  const buf = Buffer.from(bytes);
  let eocd = buf.length - 22; while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < index; i++) pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  apply(buf, pos);
  return new Uint8Array(buf);
};
test("STRUCTURE: malformed archives are rejected by inspectZip WITHOUT inflating anything (names, duplicates, ZIP64, encryption, methods, overlap, local/central mismatch, trailing data)", () => {
  const E = entriesOf();
  const code = (bytes) => codes(inspectZip(bytes).diagnostics);
  assert.ok(inspectZip(writeZip(E)).entries, "control: the rebuilt archive is accepted");
  assert.ok(code(writeZip([...E, { name: "../../evil.txt", data: "x" }])).includes("ZIP_ENTRY_NAME_INVALID"));
  assert.ok(code(writeZip([...E, { name: "/abs.xml", data: "x" }])).includes("ZIP_ENTRY_NAME_INVALID"));
  assert.ok(code(writeZip([...E, { name: "xl\\evil.xml", data: "x" }])).includes("ZIP_ENTRY_NAME_INVALID"));
  assert.ok(code(writeZip([...E, { name: "xl/Tên.xml", data: "x" }])).includes("ZIP_ENTRY_NAME_INVALID"));
  assert.ok(code(writeZip([...E, { name: E[0].name, data: "x" }])).includes("ZIP_DUPLICATE_ENTRY"));
  assert.ok(code(writeZip([...E, { name: E[0].name.toUpperCase(), data: "x" }])).includes("ZIP_DUPLICATE_ENTRY"), "case-insensitive duplicates");
  assert.ok(code(writeZip([{ ...E[0], flags: 1 }, ...E.slice(1)])).includes("ZIP_ENCRYPTED_ENTRY"));
  assert.ok(code(writeZip([{ ...E[0], flags: 0x40 }, ...E.slice(1)])).includes("ZIP_ENCRYPTED_ENTRY"), "strong encryption bit");
  assert.ok(code(writeZip([{ ...E[0], method: 12 }, ...E.slice(1)])).includes("ZIP_METHOD_UNSUPPORTED"));
  const zip64 = Buffer.concat([Buffer.from([1, 0, 8, 0]), Buffer.alloc(8)]);
  assert.ok(code(writeZip([{ ...E[0], extra: zip64 }, ...E.slice(1)])).includes("ZIP64_UNSUPPORTED"), "ZIP64 extra field in the central directory");
  assert.ok(code(writeZip([{ ...E[0], localExtra: zip64 }, ...E.slice(1)])).includes("ZIP64_UNSUPPORTED"), "ZIP64 extra field in the local header");
  assert.ok(code(writeZip(E, { eocdTotal: 0xffff })).includes("ZIP64_UNSUPPORTED"));
  assert.deepEqual(code(writeZip(E, { diskNumber: 1 })), ["ZIP_BROKEN"], "multi-disk, reported once");
  assert.ok(code(writeZip([{ ...E[0], localName: "xl/other.xml" }, ...E.slice(1)])).includes("ZIP_LOCAL_HEADER_INVALID"), "local name differs from central name (parser differential)");
  assert.ok(code(writeZip([{ ...E[0], localSizes: "zero" }, ...E.slice(1)])).includes("ZIP_LOCAL_HEADER_INVALID"), "zero local sizes without the data-descriptor flag");
  assert.ok(code(writeZip([{ ...E[0], flags: 8, localSizes: "zero" }, ...E.slice(1)])).length === 0, "data-descriptor entries with zero local sizes are legitimate");
  assert.ok(code(Buffer.concat([writeZip(E), Buffer.from("TRAILING")]).valueOf()).includes("ZIP_TRAILING_DATA"));
  assert.ok(code(writeZip(E, { prefix: Buffer.from("MZ stub before the archive") })).includes("ZIP_BROKEN"), "data before the first local header shifts every offset");
  const many = Array.from({ length: IMPORT_LIMITS.zip.maxEntries + 1 }, (_, i) => ({ name: "extra/" + i + ".txt", data: "x" }));
  assert.ok(code(writeZip(many)).includes("ZIP_TOO_MANY_ENTRIES"));
  const overlapped = mutateCentral(writeZip(E), 1, (buf, pos) => { const first = (() => { let eocd = buf.length - 22; while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--; return buf.readUInt32LE(buf.readUInt32LE(eocd + 16) + 42); })(); buf.writeUInt32LE(first, pos + 42); });
  assert.ok(code(overlapped).length > 0, "two central records pointing at the same data (overlapping-entries bomb)");
  assert.ok(code(new Uint8Array(30)).length > 0 && inspectZip(new Uint8Array(30)).entries === null);
});
test("STRUCTURE: the reader's own EOCD choice matches the library's (last signature) - a fake end record in the comment cannot split the two parsers", () => {
  const E = entriesOf();
  const fake = Buffer.alloc(22); fake.writeUInt32LE(0x06054b50, 0);
  const withFake = writeZip(E, { comment: fake });
  const r = inspectZip(withFake);
  assert.equal(r.entries, null, "the last end-of-central-directory record is the fake one -> rejected, not silently accepted");
});

// ------------------------------------------------------------------------------------------- parts policy
test("PARTS: macros, external links, data connections, embedded objects, ActiveX, binary parts and non-XLSX packages are rejected", async () => {
  const E = entriesOf();
  const add = (extra) => writeZip([...E, ...extra]);
  assert.ok(codes((await gate(add([{ name: "xl/vbaProject.bin", data: "x" }]))).diagnostics).includes("XLSX_MACROS"));
  assert.ok(codes((await gate(add([{ name: "xl/externalLinks/externalLink1.xml", data: "<x/>" }]))).diagnostics).includes("XLSX_EXTERNAL_LINKS"));
  assert.ok(codes((await gate(add([{ name: "xl/connections.xml", data: "<x/>" }]))).diagnostics).includes("XLSX_EXTERNAL_LINKS"));
  for (const name of ["xl/embeddings/oleObject1.bin", "xl/activeX/activeX1.xml", "xl/macrosheets/sheet1.xml", "xl/dialogsheets/sheet1.xml", "xl/ctrlProps/ctrlProp1.xml", "xl/unknown.bin"]) assert.ok(codes((await gate(add([{ name, data: "<x/>" }]))).diagnostics).includes("XLSX_UNSUPPORTED_PART"), name);
  const macroTypes = E.map((e) => e.name === "[Content_Types].xml" ? { ...e, data: e.data.toString().replace("spreadsheetml.sheet.main+xml", "ms-excel.sheet.macroEnabled.main+xml") } : e);
  assert.ok(codes((await gate(writeZip(macroTypes))).diagnostics).includes("XLSX_MACROS"), ".xlsm content type on the main part");
  assert.equal(contentTypesAreMacroEnabled(E.find((e) => e.name === "[Content_Types].xml").data.toString()), false, "SheetJS' own Default for .bin is not a macro signal");
  assert.ok(codes((await gate(writeZip([{ name: "word/document.xml", data: "<w/>" }, { name: "[Content_Types].xml", data: "<Types/>" }]))).diagnostics).includes("NOT_XLSX"));
  assert.ok(codes((await gate(writeZip(E.filter((e) => e.name !== "xl/workbook.xml")))).diagnostics).includes("NOT_XLSX"));
  assert.ok(codes((await gate(writeZip(E.filter((e) => e.name !== "[Content_Types].xml")))).diagnostics).includes("NOT_XLSX"));
});

// ------------------------------------------------------------------------------------------- resource limits (real inflation)
const countingInflater = (counter) => (raw) => {
  const source = new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } });
  return source.pipeThrough(new DecompressionStream("deflate-raw")).pipeThrough(new TransformStream({ transform(chunk, controller) { counter.bytes += chunk.length; controller.enqueue(chunk); } }));
};
test("LIMITS: zip bombs - oversized entry, too many total bytes, high ratio - are rejected from DECLARED sizes without inflating", async () => {
  const E = entriesOf();
  const counter = { bytes: 0 };
  const inflate = countingInflater(counter);
  const big = (name, mib) => ({ name, data: Buffer.alloc(mib * MiB) });
  let r = await inspectContainer(writeZip([...E, big("xl/worksheets/sheet9.xml", 21)]), { fileName: "a.xlsx", makeInflater: inflate });
  assert.deepEqual(codes(r.diagnostics), ["ZIP_ENTRY_TOO_LARGE", "ZIP_RATIO_TOO_HIGH"]);
  r = await inspectContainer(writeZip([...E, big("a1.dat", 15), big("a2.dat", 15), big("a3.dat", 15), big("a4.dat", 15)]), { fileName: "a.xlsx", makeInflater: inflate });
  assert.ok(codes(r.diagnostics).includes("ZIP_TOTAL_TOO_LARGE") && codes(r.diagnostics).includes("ZIP_RATIO_TOO_HIGH"));
  r = await inspectContainer(writeZip([...E, big("xl/worksheets/sheet9.xml", 12)]), { fileName: "a.xlsx", makeInflater: inflate });
  assert.ok(codes(r.diagnostics).includes("ZIP_RATIO_TOO_HIGH"), "12 MiB of zeros in a few KiB");
  assert.equal(counter.bytes, 0, "declared-size rejections never inflate a single byte");
});
test("LIMITS: a LYING header (declares 100 bytes, really inflates to megabytes) is stopped after the declared size - bounded allocation", async () => {
  const E = entriesOf();
  const counter = { bytes: 0 };
  const lie = { name: "xl/worksheets/sheet9.xml", data: Buffer.alloc(8 * MiB, 0x20), declaredUncompressed: 100 };
  const r = await inspectContainer(writeZip([...E, lie]), { fileName: "a.xlsx", makeInflater: countingInflater(counter) });
  assert.ok(codes(r.diagnostics).includes("ZIP_SIZE_MISMATCH"), JSON.stringify(codes(r.diagnostics)));
  assert.ok(counter.bytes < 8 * MiB, "inflation cancelled early: " + counter.bytes + " of " + 8 * MiB + " bytes produced");
  const under = { name: "xl/worksheets/sheet9.xml", data: Buffer.from("<worksheet/>"), declaredUncompressed: 5000 };
  const r2 = await inspectContainer(writeZip([...E, under]), { fileName: "a.xlsx" });
  assert.ok(codes(r2.diagnostics).includes("ZIP_SIZE_MISMATCH"), "declared larger than real is also a mismatch");
  const garbage = { name: "xl/worksheets/sheet9.xml", data: Buffer.from("x"), rawCompressed: Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00]), declaredUncompressed: 10 };
  const r3 = await inspectContainer(writeZip([...E, garbage]), { fileName: "a.xlsx" });
  assert.ok(codes(r3.diagnostics).some((c) => c === "ZIP_INFLATE_FAILED" || c === "ZIP_SIZE_MISMATCH"));
});
test("LIMITS: DTD / entity declarations (billion laughs), shared-string floods, row floods and cell floods are rejected before the library parses", async () => {
  const E = entriesOf();
  const swap = (name, fn) => writeZip(E.map((e) => (e.name === name ? { ...e, data: fn(e.data.toString("utf8")) } : e)));
  const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>';
  const r = await gate(swap("xl/worksheets/sheet2.xml", (x) => x.replace(/^<\?xml[^>]*\?>/, laughs)));
  assert.ok(codes(r.diagnostics).includes("XML_DTD_FORBIDDEN"), JSON.stringify(codes(r.diagnostics)));
  const sst = "<?xml version=\"1.0\"?><sst xmlns=\"x\">" + "<si><t>a</t></si>".repeat(IMPORT_LIMITS.zip.maxSharedStrings + 5) + "</sst>";
  const withSst = writeZip([...E.filter((e) => e.name !== "xl/sharedStrings.xml"), { name: "xl/sharedStrings.xml", data: sst }]);
  assert.ok(codes((await gate(withSst)).diagnostics).includes("XLSX_SHARED_STRINGS_LIMIT"));
  const rows = Array.from({ length: IMPORT_LIMITS.sheet.maxRows + 50 }, (_, i) => ["M" + i, "Môn " + i, i]);
  const manyRows = await gate(workbookBytes({ subjects: rows, lessons: [] }));
  assert.equal(manyRows.ok, false); assert.ok(codes(manyRows.diagnostics).includes("SHEET_TOO_LARGE"));
  const wide = await gate(workbookBytes({ subjects: [["A", "B", 1, "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"]] }));
  assert.equal(wide.ok, false); assert.ok(codes(wide.diagnostics).includes("SHEET_TOO_LARGE"));
  const sheetXml = "<worksheet><sheetData><row r=\"1\">" + "<c r=\"A1\"/>".repeat(IMPORT_LIMITS.sheet.maxCellsPerSheet + 10) + "</row></sheetData></worksheet>";
  const cells = await gate(swap("xl/worksheets/sheet3.xml", () => sheetXml));
  assert.ok(codes(cells.diagnostics).includes("SHEET_TOO_LARGE"));
});
test("LIMITS: effective limits hold for LEGITIMATE maximum-size data: 5000 nodes (13 chunks of curriculum) pass the gate and the whole pipeline in well under the timeout", async () => {
  const subjects = Array.from({ length: 50 }, (_, i) => ["S" + String(i).padStart(2, "0"), "Môn số " + i, i]);
  const lessons = [];
  for (let s = 0; s < 50; s++) for (let l = 0; l < 99; l++) lessons.push(["S" + String(s).padStart(2, "0"), "S" + String(s).padStart(2, "0") + "-B" + String(l).padStart(3, "0"), "Bài học số " + l + " của môn " + s, l]);
  const bytes = workbookBytes({ subjects, lessons });
  assert.ok(bytes.length < IMPORT_LIMITS.maxFileBytes);
  const t0 = Date.now();
  const { extracted, result } = await validateBytes(bytes);
  assert.equal(extracted.ok, true, JSON.stringify(codes(extracted.diagnostics)));
  assert.equal(result.ok, true, JSON.stringify(result.errors.slice(0, 3)));
  assert.equal(result.counts.total, 5000);
  assert.ok(Date.now() - t0 < 15000, "5000-node workbook processed in " + (Date.now() - t0) + " ms");
  const overflow = await validateBytes(workbookBytes({ subjects, lessons: [...lessons, ["S00", "X-1", "một bài nữa", 999]] }));
  assert.ok(codes(overflow.result.diagnostics).includes("NODE_LIMIT"), "5001 nodes exceed the P3 cap");
});

// ------------------------------------------------------------------------------------------- library-level hostile content
test("HOSTILE CONTENT: malformed XML inside a valid package, garbage sheet data and corrupted shared strings never produce a model", async () => {
  const E = entriesOf();
  const corrupt = (name, fn) => writeZip(E.map((e) => (e.name === name ? { ...e, data: fn(e.data) } : e)));
  for (const [name, fn] of [
    ["xl/worksheets/sheet3.xml", (d) => d.subarray(0, Math.floor(d.length / 2))],
    ["xl/worksheets/sheet3.xml", () => Buffer.from("<<<not xml at all>>>")],
    ["xl/workbook.xml", () => Buffer.from("<workbook><sheets><sheet name=\"x\"/></sheets>")],
    ["xl/workbook.xml", () => Buffer.alloc(200, 0x00)],
    ["xl/worksheets/sheet2.xml", () => Buffer.from("<worksheet><sheetData><row r=\"2\"><c r=\"A2\" t=\"s\"><v>999999</v></c></row></sheetData></worksheet>")]
  ]) {
    const bytes = corrupt(name, fn);
    const { extracted, result } = await validateBytes(bytes);
    assert.equal(result.model, null, name + " must not yield a model");
    assert.equal(result.ok, false);
    assert.equal(extracted.raw === null || result.errors.length > 0, true);
  }
});
test("CVE CLASSES: crafted number formats (ReDoS, CVE-2024-22363 class) and crafted names (prototype pollution, CVE-2023-30533 class) are handled by 0.20.3 inside the time budget", async () => {
  const E = entriesOf();
  const styles = E.find((e) => e.name === "xl/styles.xml").data.toString();
  const formats = ["[" + "$-".repeat(40000) + "]0", "0".repeat(60000) + ";" + "0".repeat(60000), "\"" + "a".repeat(100000), "#" + " ".repeat(80000) + "#", "_(".repeat(30000), "0." + "0?".repeat(30000), "[Red]".repeat(20000) + "0"];
  for (const format of formats) {
    const hostile = styles.replace(/<styleSheet[^>]*>/, (m) => m + "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"" + format.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + "\"/></numFmts>");
    const t0 = Date.now();
    const r = await gate(writeZip(E.map((e) => (e.name === "xl/styles.xml" ? { ...e, data: hostile } : e))));
    assert.ok(Date.now() - t0 < 4000, "format of length " + format.length + " took " + (Date.now() - t0) + " ms");
    assert.ok(typeof r.ok === "boolean");
  }
  const names = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"];
  for (const name of names) {
    let bytes;
    try { bytes = workbookBytes({ extraSheets: { [name]: [["polluted", "yes"]] } }); } catch (error) { continue; }
    const { result } = await validateBytes(bytes);
    assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
    assert.ok(codes(result.diagnostics).includes("SHEET_UNEXPECTED"), name + " is an unexpected sheet, never a crash");
  }
  const poisoned = workbookBytes({ subjects: [["__proto__", "polluted", 1], ["constructor", "x", 2]], lessons: [["__proto__", "toString", "y", 1]] });
  const { result } = await validateBytes(poisoned);
  assert.equal(({}).code, undefined); assert.equal(Object.keys(Object.prototype).length, 0);
  assert.ok(result.ok, "codes named like prototype members are ordinary text");
});

// ------------------------------------------------------------------------------------------- Worker containment
test("WORKER: a parse that never finishes is TERMINATED at the timeout (PARSE_TIMEOUT) and the host stays responsive", async () => {
  const hang = new URL("./hang-worker.mjs", import.meta.url);
  let rawWorker = null;
  const factory = () => { const w = new Worker(hang); rawWorker = w; const l = { message: new Set(), error: new Set(), messageerror: new Set() }; w.on("message", (d) => l.message.forEach((f) => f({ data: d }))); w.on("error", (e) => l.error.forEach((f) => f(e))); return { postMessage: (m, t) => w.postMessage(m, t), terminate: () => w.terminate(), addEventListener: (t, f) => l[t] && l[t].add(f), removeEventListener: (t, f) => l[t] && l[t].delete(f) }; };
  const reader = createXlsxReader({ createWorker: factory, timeoutMs: 300 });
  const t0 = Date.now();
  const result = await reader.readXlsx(base(), { fileName: "a.xlsx" });
  const elapsed = Date.now() - t0;
  assert.equal(result.ok, false); assert.equal(result.timedOut, true);
  assert.deepEqual(codes(result.diagnostics), ["PARSE_TIMEOUT"]);
  assert.ok(elapsed >= 250 && elapsed < 3000, "returned after " + elapsed + " ms");
  const exitCode = await new Promise((resolve) => { if (rawWorker.threadId === -1) resolve("already-exited"); else rawWorker.once("exit", resolve); });
  assert.ok(exitCode !== undefined, "the busy-looping Worker was actually terminated");
});
test("WORKER: the REAL Worker with a 1 ms budget times out cleanly; a Worker that errors or cannot be created yields one friendly error", async () => {
  const slow = await createXlsxReader({ createWorker: nodeWorkerFactory(), timeoutMs: 1 }).readXlsx(base(), { fileName: "a.xlsx" });
  assert.equal(slow.timedOut, true); assert.deepEqual(codes(slow.diagnostics), ["PARSE_TIMEOUT"]);
  const crashing = await createXlsxReader({ createWorker: nodeWorkerFactory(new URL("./crash-worker.mjs", import.meta.url)), timeoutMs: 5000 }).readXlsx(base(), { fileName: "a.xlsx" });
  assert.equal(crashing.ok, false); assert.deepEqual(codes(crashing.diagnostics), ["PARSE_EXCEPTION"]);
  const none = await createXlsxReader({ createWorker: () => { throw new Error("no Worker support"); } }).readXlsx(base(), { fileName: "a.xlsx" });
  assert.deepEqual(codes(none.diagnostics), ["PARSE_EXCEPTION"]);
  assert.match(none.diagnostics[0].message, /không đọc được/);
});
test("WORKER: concurrent reads use independent Workers and results never mix", async () => {
  const reader = createXlsxReader({ createWorker: nodeWorkerFactory() });
  const a = workbookBytes({ framework: ["Khung A đầu tiên"] }), b = workbookBytes({ framework: ["Khung B thứ hai"] });
  const [ra, rb] = await Promise.all([reader.readXlsx(a, { fileName: "a.xlsx" }), reader.readXlsx(b, { fileName: "b.xlsx" })]);
  const nameOf = (r) => r.raw.sheets.find((s) => s.name === "KHUNG").cells.find((c) => c.r === 2).v;
  assert.equal(nameOf(ra), "Khung A đầu tiên"); assert.equal(nameOf(rb), "Khung B thứ hai");
  assert.notEqual(ra.file.sha256, rb.file.sha256);
});
test("WORKER: the Worker module is a module worker with no DOM, storage or network dependency and replies only with plain data", () => {
  const text = readFileSync(new URL("import-xlsx-worker.mjs", root), "utf8");
  assert.ok(text.includes("addEventListener(\"message\"") && text.includes("postMessage"));
  assert.ok(!/document\.|window\.|localStorage|fetch\(/.test(text.replace(/\/\/.*$/gm, "")));
  assert.ok(readFileSync(new URL("import-xlsx-reader.mjs", root), "utf8").includes("{ type: \"module\" }"));
});

test("FAIL CLOSED: when the container gate cannot run (no DecompressionStream, inflater failure) the file is NOT parsed", async () => {
  const bytes = base();
  const broken = await extractRawWorkbook(XLSX, bytes, { fileName: "a.xlsx", size: bytes.length, makeInflater: () => { throw new ReferenceError("DecompressionStream is not defined"); } });
  assert.equal(broken.ok, false); assert.equal(broken.raw, null); assert.deepEqual(codes(broken.diagnostics), ["PARSE_EXCEPTION"]);
  let parsed = 0;
  const spy = { ...XLSX, read: (...args) => { parsed++; return XLSX.read(...args); } };
  await extractRawWorkbook(spy, bytes, { fileName: "a.xlsx", size: bytes.length, makeInflater: () => { throw new Error("x"); } });
  assert.equal(parsed, 0, "the library never sees a file the gate could not vet");
  await extractRawWorkbook(spy, writeZip([...entriesOf(), { name: "xl/vbaProject.bin", data: "x" }]), { fileName: "a.xlsx" });
  assert.equal(parsed, 0, "nor a file the gate rejected");
  await extractRawWorkbook(spy, bytes, { fileName: "a.xlsx", size: bytes.length });
  assert.equal(parsed, 2, "a vetted file is parsed exactly twice (sheet list, then the data sheets)");
});

test("RESOURCE BUDGET: the heaviest workbook the limits ALLOW (a 19 MiB worksheet: 5000 rows x 4 cells of 950 characters, ratio < 100:1) is read in a few seconds with bounded memory", async () => {
  const { randomBytes } = await import("node:crypto");
  const words = Array.from({ length: 400 }, () => randomBytes(5).toString("hex")).join(" ");
  const parts = ['<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  for (let r = 1; r <= 5000; r++) { parts.push('<row r="' + r + '">'); for (let c = 0; c < 4; c++) parts.push('<c r="' + String.fromCharCode(65 + c) + r + '" t="inlineStr"><is><t>' + words.slice((r * 7 + c * 13) % 500, (r * 7 + c * 13) % 500 + 950) + "</t></is></c>"); parts.push("</row>"); }
  parts.push("</sheetData></worksheet>");
  const xml = parts.join("");
  assert.ok(xml.length > 18 * MiB && xml.length < IMPORT_LIMITS.zip.maxEntryBytes);
  const bytes = writeZip(entriesOf().map((e) => (e.name === "xl/worksheets/sheet3.xml" ? { ...e, data: xml } : e)));
  assert.ok(bytes.length < IMPORT_LIMITS.maxFileBytes);
  const before = process.memoryUsage().rss, t0 = Date.now();
  const r = await gate(bytes);
  const elapsed = Date.now() - t0, grown = (process.memoryUsage().rss - before) / MiB;
  assert.equal(r.ok, true, JSON.stringify(codes(r.diagnostics)));
  assert.ok(elapsed < 10000, "took " + elapsed + " ms (timeout budget " + IMPORT_LIMITS.parseTimeoutMs + " ms)");
  assert.ok(grown < 400, "resident memory grew by " + grown.toFixed(0) + " MiB");
  console.log("# P4-S2 heaviest allowed workbook: " + elapsed + " ms, +" + grown.toFixed(0) + " MiB");
});
