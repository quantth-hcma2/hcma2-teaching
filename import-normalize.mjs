// Library V2 P4-S2 - template INTERPRETATION and cell NORMALIZATION (validation stages 2, 3 and 4). Parser-independent: the input is the plain RawWorkbook
// produced by import-xlsx-extract.mjs (or any future parser that emits the same shape); no SheetJS object, DOM, network or clock is involved.
//
// Allowed, visible normalization of TEXT (R1 s6 "No silent repair"; the Architect asked for Unicode normalization and whitespace handling):
//   - trim leading/trailing whitespace (note `trim`);
//   - Unicode NFC (canonical composition ONLY - never NFKC, never case folding, never inner-whitespace collapsing; note `nfc`). NFKC/case folding exist only
//     inside the P3 comparison key canonicalizeNodeCode, which is used for duplicate detection and never rewrites the stored text;
//   - a numeric cell that is a code candidate becomes text (note `numeric`, warning CELL_NUMERIC_CODE; the displayed text is kept when the number format
//     preserves leading zeros); a text cell in an order column becomes an integer (note `order-text`, warning ORDER_FROM_TEXT); blank -> null.
// Everything else is rejected with a diagnostic: formulas, booleans, dates, error cells, numbers in text fields, control characters, bidirectional
// override/embedding/isolate characters, over-long cells. The original user-visible value is kept in `original` whenever it differs from the normalized one.
import {
  TEMPLATE_ID, SUPPORTED_TEMPLATE_VERSIONS, TEMPLATE_SHEET_NAMES, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META, SHEET_COLUMNS, META_KEYS,
  TEMPLATE_HEADER_CHECKSUM, headerChecksumOf, IMPORT_LIMITS
} from "./import-template.mjs";
import { diag, columnLetter } from "./import-diagnostics.mjs";

const LIM = IMPORT_LIMITS;
const nfc = (text) => String(text).normalize("NFC");
const COMBINING = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const looseKey = (text) => nfc(text).normalize("NFD").replace(COMBINING, "").toLowerCase();
const isControl = (cu) => (cu < 0x20 && cu !== 0x09 && cu !== 0x0a) || (cu >= 0x7f && cu <= 0x9f);
const isBidi = (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
const isInvisible = (cp) => cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || cp === 0x00ad;

// Scans a string once: { control, bidi, invisible }.
export function scanCharacters(text) {
  const out = { control: false, bidi: false, invisible: false };
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isControl(cp) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) out.control = true;
    else if (isBidi(cp)) out.bidi = true;
    else if (isInvisible(cp)) out.invisible = true;
  }
  return out;
}

function indexSheet(sheet) {
  const rows = new Map();
  for (const cell of sheet.cells) { if (!rows.has(cell.r)) rows.set(cell.r, new Map()); rows.get(cell.r).set(cell.c, cell); }
  return { sheet, rows, maxRow: sheet.cells.reduce((m, c) => Math.max(m, c.r), 0) };
}
const isBlankCell = (cell) => !cell || (cell.t === "s" && !cell.f && cell.v.trim() === "");

// ---------------------------------------------------------------- cell readers (each pushes diagnostics through `report`)
// kind: "text" (names, framework name) | "code" (codes and the subject reference)
function readTextCell(cell, ctx, { kind, column, field }) {
  const here = { sheet: ctx.sheet, row: cell ? cell.r : ctx.row, column, field };
  if (isBlankCell(cell) && !(cell && cell.f)) return { blank: true, text: null, original: null, notes: [], failed: false };
  if (cell.f) { ctx.report(diag("CELL_FORMULA", here)); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (cell.t === "b") { ctx.report(diag("CELL_TYPE_BOOLEAN", here)); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (cell.t === "d") { ctx.report(diag("CELL_TYPE_DATE", here)); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (cell.t === "e") { ctx.report(diag("CELL_TYPE_ERROR", { ...here, value: cell.w })); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (cell.t === "n") {
    if (kind !== "code") { ctx.report(diag("CELL_TYPE_NOT_TEXT", { ...here, value: cell.w ?? cell.v })); return { blank: false, text: null, original: null, notes: [], failed: true }; }
    const v = cell.v;
    const shown = Number.isSafeInteger(v) && typeof cell.w === "string" && /^[0-9]+$/.test(cell.w) && Number(cell.w) === v ? cell.w : String(v);
    ctx.report(diag("CELL_NUMERIC_CODE", { ...here, value: shown }));
    return { blank: false, text: shown, original: cell.w ?? String(v), notes: ["numeric"], failed: false };
  }
  // string
  if (cell.long) { ctx.report(diag("CELL_TOO_LONG", { ...here, max: LIM.sheet.maxCellChars })); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  const chars = scanCharacters(cell.v);
  if (chars.control) { ctx.report(diag("CHAR_CONTROL", { ...here, value: cell.v })); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (chars.bidi) { ctx.report(diag("CHAR_BIDI", { ...here, value: cell.v })); return { blank: false, text: null, original: null, notes: [], failed: true }; }
  if (chars.invisible) ctx.report(diag("CHAR_INVISIBLE", { ...here, value: cell.v }));
  const composed = cell.v.normalize("NFC");
  const text = composed.trim();
  const notes = [];
  if (composed !== cell.v) notes.push("nfc");
  if (text !== composed) notes.push("trim");
  return { blank: false, text, original: notes.length ? cell.v : null, notes, failed: false };
}

function readOrderCell(cell, ctx, column) {
  const here = { sheet: ctx.sheet, row: cell ? cell.r : ctx.row, column, field: "order" };
  if (isBlankCell(cell) && !(cell && cell.f)) return { blank: true, value: null, notes: [], failed: false };
  if (cell.f) { ctx.report(diag("CELL_FORMULA", here)); return { blank: false, value: null, notes: [], failed: true }; }
  if (cell.t === "b") { ctx.report(diag("CELL_TYPE_BOOLEAN", here)); return { blank: false, value: null, notes: [], failed: true }; }
  if (cell.t === "d") { ctx.report(diag("CELL_TYPE_DATE", here)); return { blank: false, value: null, notes: [], failed: true }; }
  if (cell.t === "e") { ctx.report(diag("CELL_TYPE_ERROR", { ...here, value: cell.w })); return { blank: false, value: null, notes: [], failed: true }; }
  let number, notes = [];
  if (cell.t === "n") number = cell.v;
  else {
    const chars = scanCharacters(cell.v);
    if (chars.control || chars.bidi) { ctx.report(diag(chars.bidi ? "CHAR_BIDI" : "CHAR_CONTROL", { ...here, value: cell.v })); return { blank: false, value: null, notes: [], failed: true }; }
    const text = cell.v.normalize("NFC").trim();
    if (!/^[0-9]{1,9}$/.test(text)) { ctx.report(diag("ORDER_NOT_INTEGER", { ...here, value: cell.v })); return { blank: false, value: null, notes: [], failed: true }; }
    number = Number(text);
    notes = ["order-text"];
    ctx.report(diag("ORDER_FROM_TEXT", { ...here, value: cell.v }));
  }
  if (!Number.isInteger(number)) { ctx.report(diag("ORDER_NOT_INTEGER", { ...here, value: cell.w ?? number })); return { blank: false, value: null, notes: [], failed: true }; }
  if (number < 0 || number > 100000) { ctx.report(diag("ORDER_RANGE", { ...here, value: number })); return { blank: false, value: null, notes: [], failed: true }; }
  return { blank: false, value: number, notes, failed: false };
}

// ---------------------------------------------------------------- stage 2 helpers
function matchSheetNames(raw, report) {
  const found = new Map();                                   // exact (NFC) template name -> raw sheet
  const counts = new Map();
  for (const name of raw.sheetNames) counts.set(name, (counts.get(name) || 0) + 1);
  for (const [name, count] of counts) if (count > 1) report(diag("SHEET_DUPLICATE", { sheet: name }));
  const loose = new Map(TEMPLATE_SHEET_NAMES.map((name) => [looseKey(name), name]));
  for (const name of raw.sheetNames) {
    if (TEMPLATE_SHEET_NAMES.includes(name)) { if (!found.has(name)) found.set(name, raw.sheets.find((s) => s.name === name && !s.notRead) || null); continue; }
    const similar = loose.get(looseKey(name));
    if (similar) report(diag("SHEET_NAME_CASE", { sheet: name, expected: similar }));
    else report(diag("SHEET_UNEXPECTED", { sheet: name }));
  }
  for (const required of TEMPLATE_SHEET_NAMES) if (!found.has(required) && !raw.sheetNames.some((n) => looseKey(n) === looseKey(required))) report(diag("SHEET_MISSING", { sheet: required }));
  return found;
}

function readMeta(indexed, report) {
  const ctx = { sheet: SHEET_META, row: 1, report };
  const values = new Map();
  const seen = new Set();
  for (const [row, cells] of indexed.rows) {
    if (row > LIM.metaRows) { report(diag("SHEET_TOO_LARGE", { what: "số dòng", count: indexed.maxRow, max: LIM.metaRows, name: SHEET_META })); break; }
    for (const [col, cell] of cells) if (col >= 2 && !isBlankCell(cell)) report(diag("EXTRA_COLUMN_DATA", { sheet: SHEET_META, row, columnLetter: columnLetter(col) }));
    const keyCell = cells.get(0), valueCell = cells.get(1);
    if (isBlankCell(keyCell) && isBlankCell(valueCell)) continue;
    const key = keyCell && keyCell.t === "s" && !keyCell.f ? nfc(keyCell.v).trim() : null;
    if (key === null) { report(diag("META_UNKNOWN_KEY", { sheet: SHEET_META, row, key: keyCell ? keyCell.v : "" })); continue; }
    if (!META_KEYS.includes(key)) { report(diag("META_UNKNOWN_KEY", { sheet: SHEET_META, row, key })); continue; }
    if (seen.has(key)) { report(diag("META_DUPLICATE_KEY", { sheet: SHEET_META, row, key })); continue; }
    seen.add(key);
    if (valueCell && valueCell.f) { report(diag("CELL_FORMULA", { sheet: SHEET_META, row, field: key })); continue; }
    if (valueCell && (valueCell.t === "b" || valueCell.t === "d" || valueCell.t === "e")) { report(diag("CELL_TYPE_NOT_TEXT", { sheet: SHEET_META, row, field: key })); continue; }
    values.set(key, valueCell && !isBlankCell(valueCell) ? (valueCell.t === "n" ? valueCell.v : nfc(valueCell.v).trim()) : null);
  }
  for (const key of META_KEYS) if (!values.has(key) || values.get(key) === null) report(diag("META_MISSING_KEY", { sheet: SHEET_META, key }));
  return values;
}

// ---------------------------------------------------------------- stage 3 + 4 per data sheet
function readHeaders(indexed, sheetName, report) {
  const columns = SHEET_COLUMNS[sheetName];
  const row1 = indexed.rows.get(1) || new Map();
  const actual = [];
  let ok = true;
  columns.forEach((column, index) => {
    const cell = row1.get(index);
    const text = cell && cell.t === "s" && !cell.f ? nfc(cell.v).trim() : null;
    actual.push(text === null ? "" : text);
    if (isBlankCell(cell)) { report(diag("HEADER_MISSING", { sheet: sheetName, row: 1, header: column.header, columnLetter: columnLetter(index) })); ok = false; }
    else if (text !== column.header) { report(diag("HEADER_MISMATCH", { sheet: sheetName, row: 1, header: column.header, found: cell.v ?? cell.w, columnLetter: columnLetter(index) })); ok = false; }
  });
  for (const [col, cell] of row1) if (col >= columns.length && !isBlankCell(cell)) { report(diag("EXTRA_COLUMN_DATA", { sheet: sheetName, row: 1, columnLetter: columnLetter(col) })); ok = false; }
  return { ok, actual };
}

function sheetLevelWarnings(sheet, columnsCount, report) {
  for (const range of sheet.merges) {
    const match = /^[A-Z]+([0-9]+)/.exec(range);
    report(diag("CELL_MERGED", { sheet: sheet.name, row: match ? Number(match[1]) : null }));
  }
  for (const col of sheet.hiddenColumns) if (col < columnsCount) report(diag("COLUMN_HIDDEN", { sheet: sheet.name, columnLetter: columnLetter(col) }));
}

// Iterates the data rows (>= 2) of an indexed sheet that carry any content in the expected columns or beyond.
function* dataRows(indexed, columnsCount, sheetName, report) {
  const rowNumbers = [...indexed.rows.keys()].filter((row) => row >= 2).sort((a, b) => a - b);
  for (const row of rowNumbers) {
    const cells = indexed.rows.get(row);
    for (const [col, cell] of cells) if (col >= columnsCount && !isBlankCell(cell)) report(diag("EXTRA_COLUMN_DATA", { sheet: sheetName, row, columnLetter: columnLetter(col) }));
    const inside = [...cells.entries()].filter(([col]) => col < columnsCount);
    if (inside.every(([, cell]) => isBlankCell(cell))) continue;              // fully empty row: skipped
    yield { row, cells };
  }
}

function requireField(result, column, sheet, row, field, report) {
  if (result.failed) return false;
  if (result.blank) { report(diag("REQUIRED_MISSING", { sheet, row, column, field })); return false; }
  return true;
}

// raw -> { usable, template, framework, subjects, lessons, headers }. `report` receives every diagnostic. Never throws.
export function interpretWorkbook(raw, report) {
  const out = { usable: false, template: null, framework: null, subjects: [], lessons: [], sheetsRead: [] };
  const found = matchSheetNames(raw, report);
  const meta = found.get(SHEET_META) ? readMeta(indexSheet(found.get(SHEET_META)), report) : new Map();
  let templateOk = !!found.get(SHEET_META);
  if (templateOk && meta.has("templateId") && meta.get("templateId") !== TEMPLATE_ID) { report(diag("TEMPLATE_ID_MISMATCH", { sheet: SHEET_META, found: meta.get("templateId") })); templateOk = false; }
  let version = null;
  if (templateOk && meta.has("schemaVersion") && meta.get("schemaVersion") !== null) {
    const v = meta.get("schemaVersion");
    version = typeof v === "number" ? (Number.isInteger(v) ? v : null) : /^[0-9]{1,6}$/.test(v) ? Number(v) : null;
    if (version === null || version < 1) { report(diag("TEMPLATE_VERSION_INVALID", { sheet: SHEET_META, found: v })); templateOk = false; }
    else if (version > Math.max(...SUPPORTED_TEMPLATE_VERSIONS)) { report(diag("TEMPLATE_VERSION_NEWER", { sheet: SHEET_META, found: version, supported: SUPPORTED_TEMPLATE_VERSIONS.join(", ") })); templateOk = false; }
    else if (!SUPPORTED_TEMPLATE_VERSIONS.includes(version)) { report(diag("TEMPLATE_VERSION_UNSUPPORTED", { sheet: SHEET_META, found: version, supported: SUPPORTED_TEMPLATE_VERSIONS.join(", ") })); templateOk = false; }
  } else if (templateOk) templateOk = false;                                  // schemaVersion missing: already reported by readMeta
  if (!templateOk) return out;
  out.template = { templateId: TEMPLATE_ID, schemaVersion: version, generator: typeof meta.get("generator") === "string" ? meta.get("generator").slice(0, 200) : "" };

  // ---- stage 3: headers of the three data sheets
  const headersBySheet = {};
  const indexed = {};
  let schemaOk = true;
  for (const name of [SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS]) {
    const sheet = found.get(name);
    if (!sheet) { schemaOk = false; continue; }
    indexed[name] = indexSheet(sheet);
    if (sheet.rowsTruncated) { report(diag("SHEET_TOO_LARGE", { what: "số dòng", count: LIM.sheet.maxRows + 1, max: LIM.sheet.maxRows, name })); schemaOk = false; }
    const headers = readHeaders(indexed[name], name, report);
    headersBySheet[name] = headers.actual;
    if (!headers.ok) schemaOk = false;
  }
  if (schemaOk) {
    const actualChecksum = headerChecksumOf(headersBySheet);
    const declared = typeof meta.get("headerChecksum") === "string" ? meta.get("headerChecksum").toLowerCase() : null;
    if (declared !== TEMPLATE_HEADER_CHECKSUM || actualChecksum !== TEMPLATE_HEADER_CHECKSUM) { report(diag("HEADER_CHECKSUM_MISMATCH", { sheet: SHEET_META })); schemaOk = false; }
  }
  if (!schemaOk) return out;

  // ---- stage 4: KHUNG
  const frameworkSheet = indexed[SHEET_FRAMEWORK];
  sheetLevelWarnings(frameworkSheet.sheet, 1, report);
  const frameworkRows = [...dataRows(frameworkSheet, 1, SHEET_FRAMEWORK, report)];
  if (frameworkRows.length !== 1) report(diag("FRAMEWORK_ROW_COUNT", { sheet: SHEET_FRAMEWORK, count: frameworkRows.length }));
  else {
    const { row, cells } = frameworkRows[0];
    const ctx = { sheet: SHEET_FRAMEWORK, row, report };
    const name = readTextCell(cells.get(0), ctx, { kind: "text", column: SHEET_COLUMNS[SHEET_FRAMEWORK][0].header, field: "frameworkName" });
    if (requireField(name, SHEET_COLUMNS[SHEET_FRAMEWORK][0].header, SHEET_FRAMEWORK, row, "frameworkName", report)) out.framework = { name: name.text, original: name.original, notes: name.notes, sourceRef: { sheet: SHEET_FRAMEWORK, row } };
  }
  for (const row of frameworkSheet.sheet.hiddenRows) if (frameworkSheet.rows.has(row) && row >= 2) report(diag("ROW_HIDDEN", { sheet: SHEET_FRAMEWORK, row }));

  // ---- stage 4: MÔN
  const subjectSheet = indexed[SHEET_SUBJECTS];
  const subjectColumns = SHEET_COLUMNS[SHEET_SUBJECTS];
  sheetLevelWarnings(subjectSheet.sheet, subjectColumns.length, report);
  for (const { row, cells } of dataRows(subjectSheet, subjectColumns.length, SHEET_SUBJECTS, report)) {
    const ctx = { sheet: SHEET_SUBJECTS, row, report };
    const code = readTextCell(cells.get(0), ctx, { kind: "code", column: subjectColumns[0].header, field: "subjectCode" });
    const name = readTextCell(cells.get(1), ctx, { kind: "text", column: subjectColumns[1].header, field: "subjectName" });
    const order = readOrderCell(cells.get(2), ctx, subjectColumns[2].header);
    const okCode = requireField(code, subjectColumns[0].header, SHEET_SUBJECTS, row, "subjectCode", report);
    const okName = requireField(name, subjectColumns[1].header, SHEET_SUBJECTS, row, "subjectName", report);
    if (subjectSheet.sheet.hiddenRows.includes(row)) report(diag("ROW_HIDDEN", { sheet: SHEET_SUBJECTS, row }));
    out.subjects.push({ row, code: okCode ? code.text : null, codeOriginal: code.original, name: okName ? name.text : null, nameOriginal: name.original, explicitOrder: order.value, orderFailed: order.failed, notes: [...code.notes.map((n) => "code:" + n), ...name.notes.map((n) => "name:" + n), ...order.notes.map((n) => "order:" + n)], failed: !(okCode && okName) || order.failed });
  }
  // ---- stage 4: BÀI
  const lessonSheet = indexed[SHEET_LESSONS];
  const lessonColumns = SHEET_COLUMNS[SHEET_LESSONS];
  sheetLevelWarnings(lessonSheet.sheet, lessonColumns.length, report);
  for (const { row, cells } of dataRows(lessonSheet, lessonColumns.length, SHEET_LESSONS, report)) {
    const ctx = { sheet: SHEET_LESSONS, row, report };
    const ref = readTextCell(cells.get(0), ctx, { kind: "code", column: lessonColumns[0].header, field: "subjectCode" });
    const code = readTextCell(cells.get(1), ctx, { kind: "code", column: lessonColumns[1].header, field: "lessonCode" });
    const name = readTextCell(cells.get(2), ctx, { kind: "text", column: lessonColumns[2].header, field: "lessonName" });
    const order = readOrderCell(cells.get(3), ctx, lessonColumns[3].header);
    const okRef = requireField(ref, lessonColumns[0].header, SHEET_LESSONS, row, "subjectCode", report);
    const okName = requireField(name, lessonColumns[2].header, SHEET_LESSONS, row, "lessonName", report);
    if (lessonSheet.sheet.hiddenRows.includes(row)) report(diag("ROW_HIDDEN", { sheet: SHEET_LESSONS, row }));
    out.lessons.push({ row, subjectCodeRef: okRef ? ref.text : null, code: code.failed ? null : code.text, codeOriginal: code.original, name: okName ? name.text : null, nameOriginal: name.original, explicitOrder: order.value, orderFailed: order.failed, notes: [...ref.notes.map((n) => "ref:" + n), ...code.notes.map((n) => "code:" + n), ...name.notes.map((n) => "name:" + n), ...order.notes.map((n) => "order:" + n)], failed: !(okRef && okName) || code.failed || order.failed });
  }
  out.usable = true;
  return out;
}
