// Library V2 P4-S2 - dedicated MODULE Web Worker that parses an uploaded `.xlsx` (R2 D15). The page never parses a workbook itself.
// Protocol (structured clone):  page -> worker  { type: "parse", id, buffer: ArrayBuffer (transferred), fileName, size }
//                               worker -> page  { type: "result", id, ok, diagnostics, raw }       (raw: plain RawWorkbook, see import-xlsx-extract.mjs)
// One worker handles one file and is TERMINATED by the page afterwards (import-xlsx-reader.mjs); a hard timeout there terminates a pathological parse.
// The spreadsheet library is the SEPARATE, locally vendored SheetJS CE 0.20.3 (vendor/sheetjs-0.20.3/xlsx.mjs): no CDN, and V1's 0.18.5 is untouched.
import * as XLSX from "./vendor/sheetjs-0.20.3/xlsx.mjs";
import { extractRawWorkbook } from "./import-xlsx-extract.mjs";
import { diag } from "./import-diagnostics.mjs";

const scope = globalThis;
scope.addEventListener("message", async (event) => {
  const message = event && event.data;
  if (!message || message.type !== "parse") return;
  const reply = (body) => scope.postMessage({ type: "result", id: message.id, ...body });
  try {
    if (!(message.buffer instanceof ArrayBuffer)) { reply({ ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null }); return; }
    const result = await extractRawWorkbook(XLSX, new Uint8Array(message.buffer), { fileName: message.fileName, size: message.size });
    reply({ ok: result.ok, diagnostics: result.diagnostics, raw: result.raw });
  } catch (error) {
    reply({ ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null });
  }
});
