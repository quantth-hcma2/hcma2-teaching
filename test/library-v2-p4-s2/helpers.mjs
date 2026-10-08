// Test helpers for P4-S2: fixture workbooks (written with the vendored SheetJS 0.20.3 writer), the Node worker adapter and a one-call pipeline.
import * as XLSX from "../../vendor/sheetjs-0.20.3/xlsx.mjs";
import { Worker } from "node:worker_threads";
import { createXlsxReader } from "../../import-xlsx-reader.mjs";
import { extractRawWorkbook } from "../../import-xlsx-extract.mjs";
import { validateImport } from "../../import-validate.mjs";
import { sha256Hex } from "../../import-sha256.mjs";
import { buildTemplateSheets, SHEET_GUIDE, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META, TEMPLATE_ID, TEMPLATE_HEADER_CHECKSUM } from "../../import-template.mjs";

export { XLSX };
export const ROOT = new URL("../../", import.meta.url);
export const DEFAULT_SUBJECTS = [["T01", "Số học", 1], ["T02", "Hình học", 2]];
export const DEFAULT_LESSONS = [["T01", "T01-B01", "Tập hợp số tự nhiên", 1], ["T01", "T01-B02", "Phép cộng và phép trừ", 2], ["T02", "T02-B01", "Điểm và đường thẳng", 1]];

// Builds a template-conformant workbook; every option can break one thing on purpose.
export function workbookBytes({ framework = ["Chương trình Toán 6"], subjects = DEFAULT_SUBJECTS, lessons = DEFAULT_LESSONS, meta, headers = {}, omitSheets = [], extraSheets = {}, hideMeta = true, mutate, cellDates = false, bookType = "xlsx", compression = true } = {}) {
  const sheets = buildTemplateSheets();
  const wb = XLSX.utils.book_new();
  const metaRows = meta ?? sheets[SHEET_META].map((row) => row.slice());
  const aoa = {
    [SHEET_GUIDE]: sheets[SHEET_GUIDE].map((r) => r.slice()),
    [SHEET_FRAMEWORK]: [headers[SHEET_FRAMEWORK] ?? sheets[SHEET_FRAMEWORK][0].slice(), ...(framework ? [framework] : [])],
    [SHEET_SUBJECTS]: [headers[SHEET_SUBJECTS] ?? sheets[SHEET_SUBJECTS][0].slice(), ...subjects],
    [SHEET_LESSONS]: [headers[SHEET_LESSONS] ?? sheets[SHEET_LESSONS][0].slice(), ...lessons],
    [SHEET_META]: metaRows
  };
  const order = [SHEET_GUIDE, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META].filter((n) => !omitSheets.includes(n));
  for (const name of order) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa[name], { cellDates }), name);
  for (const [name, rows] of Object.entries(extraSheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  wb.Workbook = { Sheets: wb.SheetNames.map((n) => ({ Hidden: n === SHEET_META && hideMeta ? 1 : 0 })) };
  if (mutate) mutate(wb, XLSX);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType, cellDates, compression }));
}
export const metaWith = (overrides = {}) => {
  const rows = { templateId: TEMPLATE_ID, schemaVersion: 1, generator: "test", headerChecksum: TEMPLATE_HEADER_CHECKSUM, ...overrides };
  return Object.entries(rows).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v]);
};

// Worker adapter: runs the REAL worker module (import-xlsx-worker.mjs) inside a worker_threads Worker behind a Web-Worker-like facade.
const SHIM = new URL("./node-worker-shim.mjs", import.meta.url);
export function nodeWorkerFactory(entry = new URL("../../import-xlsx-worker.mjs", import.meta.url)) {
  return () => {
    const worker = new Worker(SHIM, { workerData: { entry: entry.href } });
    const listeners = { message: new Set(), error: new Set(), messageerror: new Set() };
    worker.on("message", (data) => listeners.message.forEach((fn) => fn({ data })));
    worker.on("error", (error) => listeners.error.forEach((fn) => fn(error)));
    worker.on("messageerror", (error) => listeners.messageerror.forEach((fn) => fn(error)));
    return {
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      terminate: () => { terminated.count++; return worker.terminate(); },
      addEventListener: (type, fn) => listeners[type] && listeners[type].add(fn),
      removeEventListener: (type, fn) => listeners[type] && listeners[type].delete(fn),
      raw: worker
    };
  };
}
export const terminated = { count: 0 };

export async function readAndValidate(bytes, { fileName = "mau.xlsx", reader = createXlsxReader({ createWorker: nodeWorkerFactory() }) } = {}) {
  const reading = await reader.readXlsx(bytes, { fileName });
  return { reading, result: validateImport(reading) };
}
// In-process variant (no Worker): extract -> validate. Used where the Worker adds nothing.
export async function validateBytes(bytes, { fileName = "mau.xlsx" } = {}) {
  const extracted = await extractRawWorkbook(XLSX, bytes, { fileName, size: bytes.length });
  const file = { name: fileName, size: bytes.length, sha256: sha256Hex(bytes) };
  return { extracted, result: validateImport({ ...extracted, file }) };
}
export const codes = (list) => list.map((d) => d.code);

// Hand-built RawWorkbook (what ANY parser must emit): fast fixtures for large/edge plans without writing an .xlsx.
const s = (r, c, v) => ({ r, c, t: "s", v });
export function rawWorkbook({ framework = "Khung thử nghiệm", subjects = DEFAULT_SUBJECTS, lessons = DEFAULT_LESSONS } = {}) {
  const sheet = (name, cells, state = "visible") => ({ name, state, ref: null, rowsTruncated: false, cells, merges: [], hiddenRows: [], hiddenColumns: [], widestColumn: -1 });
  const put = (rows) => rows.flatMap((row, i) => row.map((v, c) => (v === null || v === undefined ? null : typeof v === "number" ? { r: i + 1, c, t: "n", v, w: String(v) } : s(i + 1, c, v))).filter(Boolean));
  const meta = [["templateId", TEMPLATE_ID], ["schemaVersion", "1"], ["generator", "raw-fixture"], ["headerChecksum", TEMPLATE_HEADER_CHECKSUM]];
  const sheets = buildTemplateSheets();
  return {
    parser: "parser.xlsx.v1", library: "raw-fixture", sheetNames: ["HƯỚNG DẪN", "KHUNG", "MÔN", "BÀI", "_meta"],
    sheets: [
      { ...sheet("HƯỚNG DẪN", []), notRead: true },
      sheet("KHUNG", put([sheets.KHUNG[0], [framework]])), sheet("MÔN", put([sheets["MÔN"][0], ...subjects])), sheet("BÀI", put([sheets["BÀI"][0], ...lessons])), sheet("_meta", put(meta), "hidden")
    ],
    zip: { entries: 1, totalBytes: 1 }
  };
}
export const fileInfo = (name = "raw.xlsx") => ({ name, size: 1000, sha256: sha256Hex(name) });
export const validateRaw = (options) => validateImportFromRaw(rawWorkbook(options));
import { validateImport as validateImportFromRaw0 } from "../../import-validate.mjs";
function validateImportFromRaw(raw) { return validateImportFromRaw0({ ok: true, diagnostics: [], raw, file: fileInfo() }); }
