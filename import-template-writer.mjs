// Library V2 P4-S3 - Template Center: builds the downloadable `hcma2.curriculum.xlsx` (schemaVersion 1) from the ONE template definition (import-template.mjs).
// Runs on the page (the data is ours and trusted, nothing is read from a user file here). The spreadsheet library is the SAME vendored, hash-pinned SheetJS CE 0.20.3
// that P4-S2 qualified, loaded LAZILY on the first download (`loadXlsx`); the V1 roster-export library vendor/xlsx.full.min.js (0.18.5) is not touched or used.
// Two variants: the BLANK template (frozen: data sheets hold only the header row) and the worked-example template (same workbook + example rows + a note).
// Both carry the hidden `_meta` sheet with templateId, schemaVersion, generator and the header checksum, so the P4-S2 validator recognises them.
import {
  buildTemplateSheets, TEMPLATE_SHEET_NAMES, SHEET_GUIDE, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META, TEMPLATE_FILE_NAMES, TEMPLATE_ID, TEMPLATE_SCHEMA_VERSION
} from "./import-template.mjs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const COLUMN_WIDTHS = Object.freeze({
  [SHEET_GUIDE]: [150], [SHEET_FRAMEWORK]: [70], [SHEET_SUBJECTS]: [14, 44, 10], [SHEET_LESSONS]: [14, 16, 56, 10], [SHEET_META]: [18, 64]
});

export function createTemplateWriter({ loadXlsx = () => import("./vendor/sheetjs-0.20.3/xlsx.mjs") } = {}) {
  if (typeof loadXlsx !== "function") throw new TypeError("createTemplateWriter requires { loadXlsx }");
  // -> { bytes: Uint8Array, fileName, mime, withExample, sheetNames, templateId, schemaVersion }
  async function build({ withExample = false } = {}) {
    const XLSX = await loadXlsx();
    const sheets = buildTemplateSheets({ withExample: !!withExample });
    const workbook = XLSX.utils.book_new();
    for (const name of TEMPLATE_SHEET_NAMES) {
      const sheet = XLSX.utils.aoa_to_sheet(sheets[name].map((row) => row.slice()));
      sheet["!cols"] = COLUMN_WIDTHS[name].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    workbook.Workbook = { Sheets: TEMPLATE_SHEET_NAMES.map((name) => ({ Hidden: name === SHEET_META ? 1 : 0 })) };   // `_meta` is a hidden sheet (frozen contract s9)
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }));
    return Object.freeze({ bytes, fileName: withExample ? TEMPLATE_FILE_NAMES.example : TEMPLATE_FILE_NAMES.blank, mime: XLSX_MIME, withExample: !!withExample, sheetNames: Object.freeze([...TEMPLATE_SHEET_NAMES]), templateId: TEMPLATE_ID, schemaVersion: TEMPLATE_SCHEMA_VERSION });
  }
  return Object.freeze({ build });
}
