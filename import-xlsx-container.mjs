// Library V2 P4-S2 - XLSX CONTAINER security: everything that is decided about the file BEFORE any spreadsheet library parses it.
// Pure and inert (no DOM, no network, no clock, no SheetJS). Runs inside the dedicated parsing Worker (and in tests).
//
//   checkFileEnvelope(bytes, { fileName })   extension, size, magic number (ZIP vs legacy/encrypted OLE vs anything else)
//   inspectZip(bytes)                        strict ZIP structure from the central directory WITHOUT inflating anything; cross-checks the central
//                                            directory against the local headers, because the spreadsheet library trusts the LOCAL headers (parser
//                                            differential defence), rejects ZIP64, encryption, odd compression, hidden/overlapping/duplicate entries
//   scanEntries(bytes, entries)              BOUNDED streaming inflation (DecompressionStream) that counts REAL bytes against the declared sizes and
//                                            the limits, counts <row>/<c>/<si> tags, forbids DOCTYPE/ENTITY, and finds macro content types; it aborts the
//                                            moment a limit is crossed, so a lying header cannot cause unbounded allocation downstream
//
// A file that passes these three gates has: <= 100 entries, <= 20 MiB per entry and <= 50 MiB in total (REAL sizes), no macros, no external links or
// data connections, no embedded objects, no DTDs, and sheet row/cell/shared-string counts inside the limits. Only then is it handed to the reader.
import { IMPORT_LIMITS } from "./import-template.mjs";
import { diag } from "./import-diagnostics.mjs";
import { checkWellFormedXml } from "./import-xml-wellformed.mjs";

const LIM = IMPORT_LIMITS;
const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50, SIG_EOCD64_LOCATOR = 0x07064b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const ZIP64_EXTRA_ID = 0x0001;
const hex = (bytes) => Array.from(bytes, (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");

// ---------------------------------------------------------------- 1. envelope
export function checkFileEnvelope(bytes, { fileName, size } = {}) {
  const out = [];
  const length = bytes ? bytes.length : 0;
  if (typeof fileName === "string" && !/\.xlsx$/i.test(fileName.trim())) out.push(diag("FILE_EXTENSION"));
  const declared = typeof size === "number" ? size : length;
  if (length === 0 || declared === 0) { out.push(diag("FILE_EMPTY")); return out; }
  if (length > LIM.maxFileBytes || declared > LIM.maxFileBytes) { out.push(diag("FILE_TOO_LARGE", { size: Math.max(length, declared), max: LIM.maxFileBytes })); return out; }
  const magic = hex(bytes.subarray(0, 8));
  if (magic === "d0cf11e0a1b11ae1") out.push(diag("FILE_LEGACY_OR_ENCRYPTED"));
  else if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) out.push(diag("FILE_NOT_ZIP"));
  return out;
}

// ---------------------------------------------------------------- 2. strict ZIP structure (no inflation)
function decodeName(bytes) {
  let text = "";
  for (const byte of bytes) { if (byte < 0x20 || byte > 0x7e || byte === 0x5c) return null; text += String.fromCharCode(byte); }
  return text;
}
const nameIsSafe = (name) => name.length > 0 && name.length <= LIM.zip.maxNameBytes && !name.startsWith("/") && !name.split("/").some((part) => part === ".." || part === ".") && !name.includes("//");
function hasZip64Extra(view, start, length) {
  let pos = start; const end = start + length;
  while (pos + 4 <= end) {
    const id = view.getUint16(pos, true), size = view.getUint16(pos + 2, true);
    if (id === ZIP64_EXTRA_ID) return true;
    pos += 4 + size;
  }
  return pos > end; // a truncated extra field is also malformed
}

// Returns { entries, diagnostics }. `entries` is null when the structure is unusable. Never inflates, never throws on hostile input.
export function inspectZip(bytes) {
  const diagnostics = [];
  const fail = (code, details) => { diagnostics.push(diag(code, details)); return { entries: null, diagnostics }; };
  try {
    const length = bytes.length;
    if (length < 22) return fail("ZIP_BROKEN", { detail: "tệp quá ngắn" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The spreadsheet library takes the LAST "PK\x05\x06" in the file: use exactly the same record, then require that it is the true end of the file.
    let eocd = -1;
    for (let p = length - 22; p >= Math.max(0, length - MAX_EOCD_SEARCH); p--) if (view.getUint32(p, true) === SIG_EOCD) { eocd = p; break; }
    if (eocd < 0) return fail("ZIP_BROKEN", { detail: "không thấy bản ghi kết thúc" });
    const commentLength = view.getUint16(eocd + 20, true);
    if (eocd + 22 + commentLength !== length) return fail("ZIP_TRAILING_DATA");
    if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_EOCD64_LOCATOR) return fail("ZIP64_UNSUPPORTED");
    const disk = view.getUint16(eocd + 4, true), cdDisk = view.getUint16(eocd + 6, true), onDisk = view.getUint16(eocd + 8, true), total = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true), cdOffset = view.getUint32(eocd + 16, true);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return fail("ZIP64_UNSUPPORTED");
    if (disk !== 0 || cdDisk !== 0 || onDisk !== total) return fail("ZIP_BROKEN", { detail: "gói nhiều phần" });
    if (total === 0) return fail("ZIP_BROKEN", { detail: "gói không có thành phần" });
    if (total > LIM.zip.maxEntries) return fail("ZIP_TOO_MANY_ENTRIES", { count: total, max: LIM.zip.maxEntries });
    if (cdOffset + cdSize !== eocd) return fail("ZIP_BROKEN", { detail: "thư mục trung tâm không liền kề" });

    const entries = [];
    const seen = new Set();
    let pos = cdOffset, bad = false;
    for (let i = 0; i < total; i++) {
      if (pos + 46 > eocd || view.getUint32(pos, true) !== SIG_CENTRAL) return fail("ZIP_BROKEN", { detail: "thư mục trung tâm bị hỏng" });
      const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
      const crc = view.getUint32(pos + 16, true), compressedSize = view.getUint32(pos + 20, true), uncompressedSize = view.getUint32(pos + 24, true);
      const nameLength = view.getUint16(pos + 28, true), extraLength = view.getUint16(pos + 30, true), commentLen = view.getUint16(pos + 32, true);
      const diskStart = view.getUint16(pos + 34, true), localOffset = view.getUint32(pos + 42, true);
      if (pos + 46 + nameLength + extraLength + commentLen > eocd) return fail("ZIP_BROKEN", { detail: "thư mục trung tâm bị cắt" });
      const rawName = bytes.subarray(pos + 46, pos + 46 + nameLength);
      const name = decodeName(rawName);
      if (name === null || !nameIsSafe(name)) { diagnostics.push(diag("ZIP_ENTRY_NAME_INVALID", { name: String.fromCharCode(...Array.from(rawName.subarray(0, 60)).map((b) => (b >= 0x20 && b < 0x7f ? b : 0x3f))) })); bad = true; }
      else {
        const key = name.toLowerCase();
        if (seen.has(key)) { diagnostics.push(diag("ZIP_DUPLICATE_ENTRY", { name })); bad = true; } else seen.add(key);
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff || hasZip64Extra(view, pos + 46 + nameLength, extraLength)) { diagnostics.push(diag("ZIP64_UNSUPPORTED")); bad = true; }
      if (flags & 0x2041) { diagnostics.push(diag("ZIP_ENCRYPTED_ENTRY")); bad = true; }
      if (method !== 0 && method !== 8) { diagnostics.push(diag("ZIP_METHOD_UNSUPPORTED", { name: name || "?", method })); bad = true; }
      if (diskStart !== 0) { diagnostics.push(diag("ZIP_BROKEN", { detail: "gói nhiều phần" })); bad = true; }
      entries.push({ name: name === null ? "?" : name, flags, method, crc, compressedSize, uncompressedSize, localOffset, extraLength, nameLength, dataStart: 0, dataEnd: 0 });
      pos += 46 + nameLength + extraLength + commentLen;
    }
    if (pos !== eocd) return fail("ZIP_BROKEN", { detail: "thư mục trung tâm không khớp số thành phần" });
    if (bad) { const unique = new Map(diagnostics.map((item) => [item.code + "|" + item.message, item])); return { entries: null, diagnostics: [...unique.values()] }; }

    // central directory <-> LOCAL header cross-check (the reader trusts the local header: name, sizes, flags, method)
    for (const entry of entries) {
      const at = entry.localOffset;
      if (at + 30 > cdOffset || view.getUint32(at, true) !== SIG_LOCAL) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      const lFlags = view.getUint16(at + 6, true), lMethod = view.getUint16(at + 8, true);
      const lCrc = view.getUint32(at + 14, true), lComp = view.getUint32(at + 18, true), lUncomp = view.getUint32(at + 22, true);
      const lNameLength = view.getUint16(at + 26, true), lExtraLength = view.getUint16(at + 28, true);
      const dataStart = at + 30 + lNameLength + lExtraLength;
      if (at + 30 + lNameLength + lExtraLength > cdOffset) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      const lName = decodeName(bytes.subarray(at + 30, at + 30 + lNameLength));
      if (lName !== entry.name) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      if (hasZip64Extra(view, at + 30 + lNameLength, lExtraLength)) return fail("ZIP64_UNSUPPORTED");
      if ((lFlags & 0x2041) || lMethod !== entry.method) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      const descriptor = (entry.flags & 0x0008) !== 0;
      const sizesAgree = lComp === entry.compressedSize && lUncomp === entry.uncompressedSize && lCrc === entry.crc;
      const sizesDeferred = descriptor && lComp === 0 && lUncomp === 0;
      if (!sizesAgree && !sizesDeferred) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      entry.dataStart = dataStart;
      entry.dataEnd = dataStart + entry.compressedSize;
      if (entry.dataEnd > cdOffset) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
      if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) return fail("ZIP_LOCAL_HEADER_INVALID", { name: entry.name });
    }
    // overlap / hidden-prefix defence: entries are disjoint, in the file before the central directory, and the first starts at offset 0
    const byOffset = entries.slice().sort((a, b) => a.localOffset - b.localOffset);
    if (byOffset[0].localOffset !== 0) return fail("ZIP_TRAILING_DATA");
    for (let i = 1; i < byOffset.length; i++) if (byOffset[i].localOffset < byOffset[i - 1].dataEnd) return fail("ZIP_OVERLAP");
    return { entries, diagnostics };
  } catch (error) {
    return fail("ZIP_BROKEN", { detail: "cấu trúc không đọc được" });
  }
}

// ---------------------------------------------------------------- 3. part policy (names only) + declared-size limits
const FORBIDDEN_LINK = [/^xl\/externalLinks\//i, /^xl\/connections\.xml$/i, /^xl\/queryTables\//i, /^xl\/webExtensions\//i];
const FORBIDDEN_PART = [/^xl\/macrosheets\//i, /^xl\/dialogsheets\//i, /^xl\/activeX\//i, /^xl\/embeddings\//i, /^xl\/ctrlProps\//i, /^xl\/vbaProjectSignature\.bin$/i];
const isMacro = (name) => /(^|\/)vbaProject\.bin$/i.test(name);
const isBinary = (name) => /\.bin$/i.test(name) && !/^xl\/printerSettings\//i.test(name);

export function checkParts(entries) {
  const out = [];
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  for (const required of ["[content_types].xml", "xl/workbook.xml"]) if (!names.has(required)) out.push(diag("NOT_XLSX", { part: required === "xl/workbook.xml" ? "xl/workbook.xml" : "[Content_Types].xml" }));
  let macros = false, links = false;
  for (const entry of entries) {
    const name = entry.name;
    if (isMacro(name)) macros = true;
    else if (FORBIDDEN_LINK.some((re) => re.test(name))) links = true;
    else if (FORBIDDEN_PART.some((re) => re.test(name)) || isBinary(name)) out.push(diag("XLSX_UNSUPPORTED_PART", { name }));
  }
  if (macros) out.push(diag("XLSX_MACROS"));
  if (links) out.push(diag("XLSX_EXTERNAL_LINKS"));
  return out;
}

export function checkDeclaredSizes(entries, fileSize) {
  const out = [];
  let total = 0;
  for (const entry of entries) {
    total += entry.uncompressedSize;
    if (entry.uncompressedSize > LIM.zip.maxEntryBytes) out.push(diag("ZIP_ENTRY_TOO_LARGE", { name: entry.name, size: entry.uncompressedSize, max: LIM.zip.maxEntryBytes }));
    else if (entry.uncompressedSize >= LIM.zip.ratioMinEntryBytes && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > LIM.zip.maxRatio) out.push(diag("ZIP_RATIO_TOO_HIGH", { name: entry.name, max: LIM.zip.maxRatio }));
  }
  if (total > LIM.zip.maxTotalBytes) out.push(diag("ZIP_TOTAL_TOO_LARGE", { size: total, max: LIM.zip.maxTotalBytes }));
  else if (fileSize > 0 && total / fileSize > LIM.zip.maxRatio) out.push(diag("ZIP_RATIO_TOO_HIGH", { max: LIM.zip.maxRatio }));
  return out;
}

// A macro-enabled workbook declares it in [Content_Types].xml: the main part /xl/workbook.xml has a macroEnabled content type, or a VBA project type exists.
// (A mere Default for the ".bin" extension - which SheetJS itself writes into every file - is NOT a macro signal.)
export function contentTypesAreMacroEnabled(text) {
  if (/vbaProject/i.test(text)) return true;
  return text.split("<Override").slice(1).some((part) => part.includes('PartName="/xl/workbook.xml"') && /macroEnabled/i.test(part));
}

// ---------------------------------------------------------------- 4. bounded streaming inflation + tag counting
const isXmlName = (name) => /\.(xml|rels|vml)$/i.test(name);
const STYLES_PART = /^xl\/styles\.xml$/i;
const STYLES_NAMESPACE = /schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main|purl\.oclc\.org\/ooxml\/spreadsheetml\/main/;
const isSheetXml = (name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
const TOKENS_SHEET = [["<row ", "rows"], ["<row>", "rows"], ["<c ", "cells"], ["<c>", "cells"]];
const TOKENS_SST = [["<si>", "strings"], ["<si ", "strings"]];
const TOKENS_DTD = ["<!DOCTYPE", "<!ENTITY"];

function countTokens(text, carryLength, tokens, counts) {
  for (const [token, key] of tokens) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at < 0) break;
      if (at + token.length > carryLength) counts[key] = (counts[key] || 0) + 1;   // ignore matches that lie entirely inside the carried-over tail
      from = at + 1;
    }
  }
}
function containsToken(text, carryLength, tokens) {
  for (const token of tokens) { const at = text.indexOf(token); if (at >= 0 && at + token.length > carryLength) return true; }
  return false;
}

// Inflates ONE entry through DecompressionStream, never holding more than one chunk. Returns { bytes, rows, cells, strings, dtd, text } or { error }.
async function scanEntry(bytes, entry, { limitBytes, makeInflater, capture }) {
  const counts = { rows: 0, cells: 0, strings: 0 };
  let dtd = false, captured = "";
  // xl/styles.xml is tolerated silently by the spreadsheet library, so its bytes are kept (bounded) for the well-formedness check
  const kept = STYLES_PART.test(entry.name) ? { chunks: [], size: 0, overflow: false } : null;
  const keep = (chunk) => { if (!kept || kept.overflow) return; kept.size += chunk.length; if (kept.size > LIM.zip.maxStylesBytes) { kept.overflow = true; kept.chunks = []; } else kept.chunks.push(chunk.slice()); };
  const stylesBytes = () => { if (!kept) return null; if (kept.overflow) return { overflow: true }; const out = new Uint8Array(kept.size); let at = 0; for (const c of kept.chunks) { out.set(c, at); at += c.length; } return { bytes: out }; };
  const xml = isXmlName(entry.name);
  const sheet = isSheetXml(entry.name);
  const sst = /^xl\/sharedStrings\.xml$/i.test(entry.name);
  const tokens = sheet ? TOKENS_SHEET : sst ? TOKENS_SST : null;
  const decoder = xml ? new TextDecoder("utf-8", { fatal: false }) : null;
  let carry = "", actual = 0, aborted = false;
  const feed = (chunk, final) => {
    if (!decoder) return;
    const piece = decoder.decode(chunk, { stream: !final });
    const text = carry + piece;
    if (containsToken(text, carry.length, TOKENS_DTD)) dtd = true;
    if (tokens) countTokens(text, carry.length, tokens, counts);
    if (capture && captured.length < LIM.zip.maxContentTypesBytes) captured += piece;
    carry = text.slice(-9);
  };
  const raw = bytes.subarray(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) {
    actual = raw.length;
    if (actual > limitBytes) return { error: "size", bytes: actual };
    for (let offset = 0; offset < raw.length; offset += 65536) { const part = raw.subarray(offset, Math.min(raw.length, offset + 65536)); keep(part); feed(part, false); }
    feed(new Uint8Array(0), true);
    return { bytes: actual, ...counts, dtd, text: captured, styles: stylesBytes() };
  }
  const reader = makeInflater(raw).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      actual += value.length;
      if (actual > limitBytes) { await reader.cancel().catch(() => {}); return { error: "size", bytes: actual }; }
      keep(value);
      feed(value, false);
      if (dtd) { aborted = true; await reader.cancel().catch(() => {}); break; }
      if (sheet && (counts.rows > LIM.sheet.maxRows || counts.cells > LIM.sheet.maxCellsPerSheet)) { aborted = true; await reader.cancel().catch(() => {}); break; }
      if (sst && counts.strings > LIM.zip.maxSharedStrings) { aborted = true; await reader.cancel().catch(() => {}); break; }
    }
    feed(new Uint8Array(0), true);
  } catch (error) {
    return { error: "inflate" };
  }
  return { bytes: actual, aborted, ...counts, dtd, text: captured, styles: stylesBytes() };
}

function defaultInflater(raw) {
  const source = new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } });
  return source.pipeThrough(new DecompressionStream("deflate-raw"));
}

// entries: result of inspectZip. Returns { diagnostics, stats }. Aborts per entry as soon as a limit is crossed.
export async function scanEntries(bytes, entries, { makeInflater = defaultInflater } = {}) {
  const diagnostics = [];
  const stats = { totalBytes: 0, entries: entries.length, sheets: {}, sharedStrings: 0, totalCells: 0 };
  let total = 0;
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    const limitBytes = Math.min(LIM.zip.maxEntryBytes, entry.uncompressedSize);
    const result = await scanEntry(bytes, entry, { limitBytes, makeInflater, capture: /^\[content_types\]\.xml$/i.test(entry.name) });
    if (result.error === "size") { diagnostics.push(diag("ZIP_SIZE_MISMATCH", { name: entry.name, declared: entry.uncompressedSize })); continue; }
    if (result.error) { diagnostics.push(diag("ZIP_INFLATE_FAILED", { name: entry.name })); continue; }
    if (!result.aborted && result.bytes !== entry.uncompressedSize) { diagnostics.push(diag("ZIP_SIZE_MISMATCH", { name: entry.name, declared: entry.uncompressedSize })); continue; }
    total += result.bytes;
    if (total > LIM.zip.maxTotalBytes) { diagnostics.push(diag("ZIP_TOTAL_TOO_LARGE", { size: total, max: LIM.zip.maxTotalBytes })); break; }
    if (result.dtd) diagnostics.push(diag("XML_DTD_FORBIDDEN", { name: entry.name }));
    else if (result.styles) {
      // Optional part (a workbook without styles is valid OOXML); when present it must be well-formed XML with a styleSheet root in the SpreadsheetML namespace.
      if (result.styles.overflow) diagnostics.push(diag("STYLES_INVALID", { detail: "tệp quá lớn" }));
      else {
        const verdict = checkWellFormedXml(result.styles.bytes, { rootName: "styleSheet" });
        if (!verdict.ok) diagnostics.push(diag("STYLES_INVALID", { detail: verdict.detail }));
        else if (!STYLES_NAMESPACE.test(verdict.head)) diagnostics.push(diag("STYLES_INVALID", { detail: "sai không gian tên SpreadsheetML" }));
      }
    }
    if (isSheetXml(entry.name)) {
      stats.sheets[entry.name] = { rows: result.rows, cells: result.cells };
      stats.totalCells += result.cells;
      if (result.rows > LIM.sheet.maxRows) diagnostics.push(diag("SHEET_TOO_LARGE", { what: "số dòng", count: result.rows, max: LIM.sheet.maxRows, name: entry.name }));
      if (result.cells > LIM.sheet.maxCellsPerSheet) diagnostics.push(diag("SHEET_TOO_LARGE", { what: "số ô", count: result.cells, max: LIM.sheet.maxCellsPerSheet, name: entry.name }));
    }
    if (/^xl\/sharedStrings\.xml$/i.test(entry.name)) {
      stats.sharedStrings = result.strings;
      if (result.strings > LIM.zip.maxSharedStrings) diagnostics.push(diag("XLSX_SHARED_STRINGS_LIMIT", { count: result.strings, max: LIM.zip.maxSharedStrings }));
    }
    if (/^\[content_types\]\.xml$/i.test(entry.name) && contentTypesAreMacroEnabled(result.text)) diagnostics.push(diag("XLSX_MACROS"));
  }
  stats.totalBytes = total;
  if (stats.totalCells > LIM.sheet.maxTotalCells) diagnostics.push(diag("SHEET_TOO_LARGE", { what: "tổng số ô", count: stats.totalCells, max: LIM.sheet.maxTotalCells }));
  // de-duplicate identical diagnostics (e.g. macro detected by name and by content type)
  const unique = [];
  const seen = new Set();
  for (const item of diagnostics) { const key = item.code + "|" + item.message; if (!seen.has(key)) { seen.add(key); unique.push(item); } }
  return { diagnostics: unique, stats };
}

// One call for the whole container gate. Returns { ok, diagnostics, entries, stats }.
export async function inspectContainer(bytes, { fileName, size, makeInflater } = {}) {
  const diagnostics = [...checkFileEnvelope(bytes, { fileName, size })];
  if (diagnostics.length) return { ok: false, diagnostics, entries: null, stats: null };
  const zip = inspectZip(bytes);
  if (!zip.entries) return { ok: false, diagnostics: zip.diagnostics, entries: null, stats: null };
  diagnostics.push(...checkParts(zip.entries), ...checkDeclaredSizes(zip.entries, bytes.length));
  if (diagnostics.length) return { ok: false, diagnostics, entries: zip.entries, stats: null };
  const scan = await scanEntries(bytes, zip.entries, { makeInflater });
  diagnostics.push(...scan.diagnostics);
  return { ok: diagnostics.length === 0, diagnostics, entries: zip.entries, stats: scan.stats };
}
