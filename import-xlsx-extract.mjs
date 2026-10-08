// Library V2 P4-S2 - raw workbook EXTRACTION (parser adapter `parser.xlsx.v1`, step 1): container gate -> SheetJS CE read -> plain data.
// Runs inside the dedicated parsing Worker (import-xlsx-worker.mjs) and, in tests, directly. The spreadsheet library is INJECTED (`XLSX`), so this module
// has no import of it and works with any build; the vendored one is SheetJS CE 0.20.3 (vendor/sheetjs-0.20.3/).
//
// Division of labour (R2 s8): the library only READS cells. This module turns them into a plain, structured-clone-safe, parser-independent RawWorkbook:
//   { parser, library, sheetNames:[as in the file], sheets:[{ name, state, ref, rowsTruncated, cells:[{r,c,t,v,w,f,long}], merges, hiddenRows, hiddenColumns }], zip }
// where r is the EXCEL row (1-based), c the column index (0-based), t one of s|n|b|d|e, f true for a formula cell. Strings are clipped at
// IMPORT_LIMITS.sheet.maxCellChars (+ `long: true`). Nothing is evaluated: formulas are only FLAGGED (the validators reject them), hyperlinks/comments are
// ignored, and no SheetJS object leaves this module. Validation/interpretation of the template is NOT done here (import-normalize.mjs / import-validate.mjs).
import { DATA_SHEET_NAMES, IMPORT_LIMITS, PARSER_ADAPTER_ID } from "./import-template.mjs";
import { diag } from "./import-diagnostics.mjs";
import { inspectContainer } from "./import-xlsx-container.mjs";

const LIM = IMPORT_LIMITS;
const nfc = (text) => String(text).normalize("NFC");
const SHEET_STATE = ["visible", "hidden", "veryHidden"];

// Reader options: everything not needed is switched off (no VBA, no dependencies/properties, no HTML, no number formats). cellDates makes date-formatted
// numbers arrive as dates (t:'d') so they can be REJECTED instead of being mistaken for numbers; cellStyles is needed only to learn about hidden rows/columns.
const readOptions = (extra) => ({
  type: "array", cellFormula: true, cellDates: true, cellText: true, cellHTML: false, cellNF: false, cellStyles: true, bookVBA: false, bookDeps: false, bookProps: false,
  dense: false, raw: false, ...extra
});

function cellOf(XLSX, address, cell) {
  if (!cell || typeof cell !== "object") return null;
  const position = XLSX.utils.decode_cell(address);
  const out = { r: position.r + 1, c: position.c, t: cell.t, v: null, w: null, f: (typeof cell.f === "string" && cell.f !== "") || cell.F !== undefined };
  if (cell.t === "z") return null;                                  // stub cell: no value
  if (cell.t === "s") {
    const text = typeof cell.v === "string" ? cell.v : String(cell.v ?? "");
    if (text.length > LIM.sheet.maxCellChars) { out.v = text.slice(0, LIM.sheet.maxCellChars + 1); out.long = true; } else out.v = text;
  } else if (cell.t === "n") { out.v = typeof cell.v === "number" ? cell.v : Number(cell.v); }
  else if (cell.t === "b") out.v = !!cell.v;
  else if (cell.t === "d") out.v = cell.v instanceof Date && !Number.isNaN(cell.v.getTime()) ? cell.v.toISOString() : "invalid-date";
  else if (cell.t === "e") out.v = typeof cell.v === "number" ? cell.v : 0;
  else return null;
  if (cell.t === "n" || cell.t === "e") out.w = typeof cell.w === "string" ? cell.w.slice(0, 80) : null;
  return out;
}

function extractSheet(XLSX, ws, name, state) {
  const sheet = { name, state, ref: null, rowsTruncated: false, cells: [], merges: [], hiddenRows: [], hiddenColumns: [], widestColumn: -1 };
  if (!ws) return sheet;
  sheet.ref = typeof ws["!ref"] === "string" ? ws["!ref"] : null;
  if (typeof ws["!fullref"] === "string" && ws["!fullref"] !== ws["!ref"]) sheet.rowsTruncated = true;
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 33) continue;                         // "!ref", "!merges", ... (not cells)
    const cell = cellOf(XLSX, key, ws[key]);
    if (!cell) continue;
    if (cell.c > sheet.widestColumn) sheet.widestColumn = cell.c;
    if (cell.c < LIM.sheet.maxCols) sheet.cells.push(cell);
  }
  sheet.cells.sort((a, b) => (a.r - b.r) || (a.c - b.c));
  const merges = Array.isArray(ws["!merges"]) ? ws["!merges"] : [];
  for (const merge of merges.slice(0, 50)) sheet.merges.push(XLSX.utils.encode_range(merge));
  const rows = Array.isArray(ws["!rows"]) ? ws["!rows"] : [];
  for (let i = 0; i < rows.length && sheet.hiddenRows.length < 100; i++) if (rows[i] && rows[i].hidden) sheet.hiddenRows.push(i + 1);
  const cols = Array.isArray(ws["!cols"]) ? ws["!cols"] : [];
  for (let i = 0; i < cols.length && sheet.hiddenColumns.length < 100; i++) if (cols[i] && cols[i].hidden) sheet.hiddenColumns.push(i);
  return sheet;
}

// bytes: Uint8Array. Returns { ok, diagnostics, raw }. Never throws; hostile input yields diagnostics and `raw: null`.
export async function extractRawWorkbook(XLSX, bytes, { fileName, size, makeInflater } = {}) {
  let gate;
  try { gate = await inspectContainer(bytes, { fileName, size, makeInflater }); }
  catch (error) { return { ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null }; }   // e.g. no DecompressionStream in this browser: fail CLOSED, never parse unchecked
  if (!gate.ok) return { ok: false, diagnostics: gate.diagnostics, raw: null };
  try {
    const listing = XLSX.read(bytes, readOptions({ bookSheets: true, cellStyles: false }));
    const names = Array.isArray(listing.SheetNames) ? listing.SheetNames.slice(0, 100) : [];
    if (names.length === 0) return { ok: false, diagnostics: [diag("PARSE_NO_SHEETS")], raw: null };
    const wanted = names.filter((name) => DATA_SHEET_NAMES.includes(nfc(name)));
    const workbook = XLSX.read(bytes, readOptions({ sheets: wanted, sheetRows: LIM.sheet.maxRows + 1 }));
    const states = workbook.Workbook && Array.isArray(workbook.Workbook.Sheets) ? workbook.Workbook.Sheets : [];
    const diagnostics = [];
    const sheets = [];
    const seen = new Set();
    names.forEach((name, index) => {
      const key = nfc(name);
      const hidden = states[index] && Number.isInteger(states[index].Hidden) ? states[index].Hidden : 0;
      const state = SHEET_STATE[hidden] || "visible";
      if (!wanted.includes(name) || seen.has(key)) { sheets.push({ name: key, state, ref: null, rowsTruncated: false, cells: [], merges: [], hiddenRows: [], hiddenColumns: [], widestColumn: -1, notRead: true }); return; }
      seen.add(key);
      const sheet = extractSheet(XLSX, workbook.Sheets[name], key, state);
      if (sheet.widestColumn >= LIM.sheet.maxCols) diagnostics.push(diag("SHEET_TOO_LARGE", { what: "số cột", count: sheet.widestColumn + 1, max: LIM.sheet.maxCols, name: key }));
      sheets.push(sheet);
    });
    return {
      ok: diagnostics.length === 0, diagnostics,
      raw: { parser: PARSER_ADAPTER_ID, library: "SheetJS CE " + (XLSX.version || "?"), sheetNames: names.map(nfc), sheets, zip: { entries: gate.stats.entries, totalBytes: gate.stats.totalBytes } }
    };
  } catch (error) {
    return { ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null };
  }
}
