// GATE 2B-RT-CONTRACT — canonical RichText V1 contract: schema constants, strict validator,
// normalizer, and the plain-text mirror derivation. Editor-independent: this module knows
// nothing about contenteditable, DOM events, or any future editor implementation — a future
// editor must conform to THIS contract, not the other way around. Contains no DOM access at all
// (see rich-text-renderer.mjs for the DOM-facing safe renderer that builds on this module).
//
// RichText V1 is STRUCTURED DATA — a small, fixed, versioned document shape. It never stores or
// carries arbitrary HTML, CSS, attributes, or URLs. See the GATE 2B-RT-DESIGN report for the full
// architecture rationale (why structured blocks/runs over sanitized-HTML or offset/range models).
//
// Canonical shape:
//   {
//     version: 1,
//     blocks: [
//       { type: "paragraph", runs: [ { text: "...", bold, italic, font, size, color } ] }
//     ]
//   }
//
// V1 supports ONLY: paragraph blocks, text runs, bold, italic, a font token, a size token, and a
// color token. No links, no HTML, no images, no tables, no lists, no arbitrary CSS/attributes.

export const RICH_TEXT_VERSION = 1;
export const RICH_TEXT_VERSION_V2 = 2;

// ---------------- Contract limits (classroom-scale, deliberately conservative — see GATE
// 2B-RT-DESIGN §17/§18; these are PRODUCT limits, not derived from Firestore's 1 MiB document
// limit, which is far larger and not relied upon here). ----------------
export const MAX_BLOCKS = 20;
export const MAX_V2_BLOCKS = 40;
export const MAX_RUNS_PER_BLOCK = 20;
export const MAX_RUN_TEXT_LENGTH = 500;
export const MAX_TOTAL_TEXT_LENGTH = 10000;

// A conservative guard on the serialized JSON payload size itself, independent of the
// block/run/text counting above (defense in depth against a document that is structurally within
// every count limit above but still unreasonably large, e.g. via unusual Unicode expansion).
// This is a product-level guard, not a Firestore-imposed one (Firestore's own per-document limit
// is 1 MiB — this is deliberately far smaller).
export const MAX_SERIALIZED_BYTE_LENGTH = 64 * 1024; // 64 KiB

export const ALLOWED_BLOCK_TYPES = Object.freeze(["paragraph"]);
export const FONT_TOKENS = Object.freeze(["default", "arial", "times", "roboto"]);
export const SIZE_TOKENS = Object.freeze([14, 16, 18, 20, 24]);
export const COLOR_TOKENS = Object.freeze(["default", "red", "blue", "green", "orange", "purple"]);
export const MAX_TABLE_ROWS = 10;
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_CELL_LENGTH = 1000;
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const TOP_LEVEL_KEYS = new Set(["version", "blocks"]);
const BLOCK_KEYS = new Set(["type", "runs"]);
const IMAGE_BLOCK_KEYS = new Set(["type", "storagePath", "alt", "mimeType", "size"]);
const TABLE_BLOCK_KEYS = new Set(["type", "rows"]);
const RUN_KEYS = new Set(["text", "bold", "italic", "font", "size", "color"]);
const FONT_TOKEN_SET = new Set(FONT_TOKENS);
const SIZE_TOKEN_SET = new Set(SIZE_TOKENS);
const COLOR_TOKEN_SET = new Set(COLOR_TOKENS);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Unicode length policy (deterministic, documented, tested — see GATE 2B-RT-DESIGN "Unicode /
// Vietnamese" section): JS string `.length` counts UTF-16 CODE UNITS, not Unicode code points —
// an astral character (most emoji, e.g. "😀" U+1F600) is a surrogate PAIR and therefore counts as
// 2 under `.length`, even though it is one code point. Vietnamese diacritics (precomposed, e.g.
// "ế", or decomposed as base + combining marks) are entirely within the Basic Multilingual Plane,
// so `.length` and code-point counting agree for them — the discrepancy only ever affects astral
// characters. This module counts and truncates by UNICODE CODE POINT, not UTF-16 code unit, using
// `Array.from(str)` (which iterates by code point, correctly treating a surrogate pair as a
// single element) for two reasons: (1) it never splits a surrogate pair in half, which naive
// `str.slice(0, N)` truncation can do, producing a corrupted lone surrogate; (2) it gives a
// single, deterministic, testable definition of "length" used identically everywhere a limit is
// enforced. This module deliberately does NOT attempt full Unicode grapheme-cluster counting
// (e.g. via Intl.Segmenter) — a base character plus combining marks may count as more than one
// "visual character" under this policy, which is a cosmetic difference only, not a
// security-relevant one, and keeps this module free of any conditional-availability concern.
export function codePointLength(str) {
  return Array.from(str).length;
}

// Safe truncation to at most `maxCodePoints` Unicode code points — never splits a surrogate pair.
export function truncateToCodePoints(str, maxCodePoints) {
  const codePoints = Array.from(str);
  if (codePoints.length <= maxCodePoints) return str;
  return codePoints.slice(0, maxCodePoints).join("");
}

function hasOnlyKeys(obj, allowedKeySet) {
  return Object.keys(obj).every((k) => allowedKeySet.has(k));
}

function isValidRun(run) {
  if (!isPlainObject(run)) return false;
  if (!hasOnlyKeys(run, RUN_KEYS)) return false;
  if (!("text" in run) || typeof run.text !== "string") return false;
  if (codePointLength(run.text) > MAX_RUN_TEXT_LENGTH) return false;
  if ("bold" in run && typeof run.bold !== "boolean") return false;
  if ("italic" in run && typeof run.italic !== "boolean") return false;
  if ("font" in run && !FONT_TOKEN_SET.has(run.font)) return false;
  if ("size" in run && !SIZE_TOKEN_SET.has(run.size)) return false;
  if ("color" in run && !COLOR_TOKEN_SET.has(run.color)) return false;
  return true;
}

function isValidBlock(block) {
  if (!isPlainObject(block)) return false;
  if (!hasOnlyKeys(block, BLOCK_KEYS)) return false;
  if (block.type !== "paragraph") return false;
  if (!Array.isArray(block.runs)) return false;
  if (block.runs.length > MAX_RUNS_PER_BLOCK) return false;
  return block.runs.every(isValidRun);
}

export function parseRichImageStoragePath(storagePath) {
  if (typeof storagePath !== "string") return null;
  const parts = storagePath.split("/");
  if (parts[0] !== "groupActivityContent" || parts.length < 4) return null;
  const token = /^[A-Za-z0-9_-]{1,128}$/;
  const asset = /^[A-Za-z0-9_-]{1,128}\.(?:jpg|jpeg|png|webp)$/;
  const ownerId = parts[1], activityId = parts[2];
  if (!token.test(ownerId) || !token.test(activityId)) return null;
  if (parts.length === 4 && asset.test(parts[3])) return { ownerId, activityId, scope: "legacy", assetName: parts[3] };
  if (parts.length === 5 && parts[3] === "common" && asset.test(parts[4])) return { ownerId, activityId, scope: "common", assetName: parts[4] };
  if (parts.length === 6 && parts[3] === "groups" && token.test(parts[4]) && asset.test(parts[5])) {
    return { ownerId, activityId, scope: "group", groupId: parts[4], assetName: parts[5] };
  }
  return null;
}

export function imagePathMatchesContext(storagePath, context) {
  const parsed = parseRichImageStoragePath(storagePath);
  if (!parsed) return false;
  if (!context) return true; // structural/classification mode; no authorization is inferred
  if (parsed.ownerId !== String(context.ownerId) || parsed.activityId !== String(context.activityId)) return false;
  if (parsed.scope === "legacy") return context.allowLegacy === true;
  if (context.scope === "common") return parsed.scope === "common";
  if (context.scope === "group") return parsed.scope === "group" && parsed.groupId === String(context.groupId);
  return false;
}

function isValidV2Block(block, imageContext) {
  if (!isPlainObject(block) || typeof block.type !== "string") return false;
  if (block.type === "paragraph") return isValidBlock(block);
  if (block.type === "image") {
    return hasOnlyKeys(block, IMAGE_BLOCK_KEYS) &&
      typeof block.storagePath === "string" &&
      imagePathMatchesContext(block.storagePath, imageContext) &&
      typeof block.alt === "string" && codePointLength(block.alt) <= 300 &&
      IMAGE_MIME_TYPES.includes(block.mimeType) &&
      Number.isInteger(block.size) && block.size > 0 && block.size <= MAX_IMAGE_BYTES;
  }
  if (block.type === "table") {
    if (!hasOnlyKeys(block, TABLE_BLOCK_KEYS) || !Array.isArray(block.rows) || block.rows.length < 1 || block.rows.length > MAX_TABLE_ROWS) return false;
    const width = isPlainObject(block.rows[0]) && Array.isArray(block.rows[0].cells) ? block.rows[0].cells.length : 0;
    return width >= 1 && width <= MAX_TABLE_COLUMNS && block.rows.every(row =>
      isPlainObject(row) && hasOnlyKeys(row,new Set(["cells"])) && Array.isArray(row.cells) && row.cells.length === width && row.cells.every(cell => {
        // Early V2 candidate tables stored cells as strings. Keep reading them; newly edited
        // cells use the same safe run model as paragraphs so toolbar formatting works in-table.
        if (typeof cell === "string") return codePointLength(cell) <= MAX_TABLE_CELL_LENGTH;
        return isPlainObject(cell) && hasOnlyKeys(cell,new Set(["runs"])) && Array.isArray(cell.runs) &&
          cell.runs.length <= MAX_RUNS_PER_BLOCK && cell.runs.every(isValidRun) &&
          cell.runs.reduce((sum,run)=>sum+codePointLength(run.text),0) <= MAX_TABLE_CELL_LENGTH;
      })
    );
  }
  return false;
}

// Strict, whole-document validator. A document is valid ONLY if every block and every run
// satisfies the contract exactly — there is no partial validity. An unknown field ANYWHERE
// (top level, block level, or run level) makes the WHOLE document invalid, matching the
// whole-document fail-closed policy enforced by the renderer (rich-text-renderer.mjs never
// renders only the valid subset of an invalid document).
export function validateRichTextV1(value) {
  if (!isPlainObject(value)) return false;
  if (!hasOnlyKeys(value, TOP_LEVEL_KEYS)) return false;
  if (value.version !== RICH_TEXT_VERSION) return false;
  if (!Array.isArray(value.blocks)) return false;
  if (value.blocks.length < 1 || value.blocks.length > MAX_BLOCKS) return false;

  let totalTextLength = 0;
  for (const block of value.blocks) {
    if (!isValidBlock(block)) return false;
    for (const run of block.runs) {
      totalTextLength += codePointLength(run.text);
    }
  }
  if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) return false;

  // Defense-in-depth serialized-size guard (see MAX_SERIALIZED_BYTE_LENGTH above). Measured in
  // UTF-8 bytes via the same JSON encoding a Firestore write would use, not JS string length.
  const serializedByteLength = new TextEncoder().encode(JSON.stringify(value)).length;
  if (serializedByteLength > MAX_SERIALIZED_BYTE_LENGTH) return false;

  return true;
}

export function validateRichText(value, imageContext) {
  if (value?.version === RICH_TEXT_VERSION) return validateRichTextV1(value);
  if (!isPlainObject(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS) || value.version !== RICH_TEXT_VERSION_V2 || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > MAX_V2_BLOCKS) return false;
  if (!value.blocks.every(block => isValidV2Block(block, imageContext))) return false;
  if (value.blocks.filter(block => block.type === "image").length > MAX_IMAGES) return false;
  let totalTextLength = 0;
  for (const block of value.blocks) {
    if (block.type === "paragraph") for (const run of block.runs) totalTextLength += codePointLength(run.text);
    if (block.type === "table") for (const row of block.rows) for (const cell of row.cells)
      totalTextLength += typeof cell === "string" ? codePointLength(cell) : cell.runs.reduce((sum,run)=>sum+codePointLength(run.text),0);
  }
  if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_SERIALIZED_BYTE_LENGTH;
}

// ---------------- Normalization (canonicalization) — separate from validation. ----------------
// Normalization is for the TRUSTED future editor serializer to call BEFORE a write, to produce a
// deterministic canonical shape. It is NOT a repair function for hostile/malformed storage, and it
// does NOT enforce the formatting-token allowlists itself (that remains validateRichTextV1's job)
// — callers MUST still validate the normalized result before treating it as safe to store or
// render. Given structurally-sound input (right shape, right primitive types), normalize():
//   - omits `bold`/`italic` when false (canonical "unset" representation)
//   - omits `font` when "default"
//   - omits `size` when the default size (16)
//   - omits `color` when "default"
// This keeps the canonical stored form minimal (smaller payload) and matches the schema's own
// "absent means default" semantics. Throws (rather than silently coercing) on structurally
// unsound input — that indicates a bug in the calling editor code, not user-supplied data to be
// defensively repaired.
export const DEFAULT_SIZE = 16;

export function normalizeRichTextV1(value) {
  if (!isPlainObject(value)) throw new TypeError("normalizeRichTextV1: expected an object");
  if (value.version !== RICH_TEXT_VERSION) throw new TypeError("normalizeRichTextV1: unsupported or missing version");
  if (!Array.isArray(value.blocks)) throw new TypeError("normalizeRichTextV1: blocks must be an array");
  return { version: RICH_TEXT_VERSION, blocks: value.blocks.map(normalizeBlock) };
}

export function normalizeRichText(value) {
  if (value?.version === RICH_TEXT_VERSION) return normalizeRichTextV1(value);
  if (!isPlainObject(value) || value.version !== RICH_TEXT_VERSION_V2 || !Array.isArray(value.blocks)) throw new TypeError("normalizeRichText: invalid V2 document");
  return { version: RICH_TEXT_VERSION_V2, blocks: value.blocks.map(block => {
    if (block.type === "paragraph") return normalizeBlock(block);
    if (block.type === "image") return { type: "image", storagePath: block.storagePath, alt: block.alt, mimeType: block.mimeType, size: block.size };
    if (block.type === "table") return { type: "table", rows: block.rows.map(row => ({cells:row.cells.map(cell =>
      typeof cell === "string" ? cell : {runs:cell.runs.map(normalizeRun)}
    )})) };
    throw new TypeError("normalizeRichText: unsupported block type");
  }) };
}

function normalizeBlock(block) {
  if (!isPlainObject(block)) throw new TypeError("normalizeRichTextV1: block must be an object");
  if (block.type !== "paragraph") throw new TypeError("normalizeRichTextV1: unsupported block type");
  if (!Array.isArray(block.runs)) throw new TypeError("normalizeRichTextV1: block.runs must be an array");
  return { type: "paragraph", runs: block.runs.map(normalizeRun) };
}

function normalizeRun(run) {
  if (!isPlainObject(run)) throw new TypeError("normalizeRichTextV1: run must be an object");
  if (typeof run.text !== "string") throw new TypeError("normalizeRichTextV1: run.text must be a string");
  const out = { text: run.text };
  if (run.bold === true) out.bold = true;
  if (run.italic === true) out.italic = true;
  if (typeof run.font === "string" && run.font !== "default") out.font = run.font;
  if (typeof run.size === "number" && run.size !== DEFAULT_SIZE) out.size = run.size;
  if (typeof run.color === "string" && run.color !== "default") out.color = run.color;
  return out;
}

// ---------------- Plain-text mirror ----------------
// Derives the legacy plain-text mirror (the `instructions`/`topic` string field) from a RichText
// V1 document, for the future write path to keep both fields in sync. V1 rule: concatenate every
// run's text within a paragraph (no separator between runs — formatting boundaries do not affect
// the text), then join paragraphs with exactly "\n". No HTML stripping, no DOM parsing — purely a
// structural walk of the already-typed contract. Returns "" for anything that does not validate,
// rather than throwing — this function may be called in contexts (e.g. a preview) where a
// best-effort empty string is preferable to a crash.
export function richTextToPlainText(value) {
  if (!validateRichText(value)) return "";
  return value.blocks.map((block) => {
    if (block.type === "paragraph") return block.runs.map((run) => run.text).join("");
    if (block.type === "image") return `[Ảnh: ${block.alt || "không có mô tả"}]`;
    return block.rows.map(row => row.cells.map(cell => typeof cell === "string" ? cell : cell.runs.map(run=>run.text).join("")).join("\t")).join("\n");
  }).join("\n");
}

// Text-only compatibility path for a structurally valid V2 document whose only contextual
// incompatibility is a legacy image path from the same owner/activity. This never authorizes or
// resolves the image; it only permits safe paragraph/table text to reach a textContent fallback.
export function legacyImageTextFallback(value, imageContext) {
  if (!imageContext || !validateRichText(value) || validateRichText(value, imageContext)) return null;
  const images=value.blocks.filter(block=>block.type==="image");
  if (!images.length || !images.every(block=>{
    const parsed=parseRichImageStoragePath(block.storagePath);
    return parsed?.scope==="legacy" && parsed.ownerId===String(imageContext.ownerId) && parsed.activityId===String(imageContext.activityId);
  })) return null;
  const text=value.blocks.flatMap(block=>{
    if(block.type==="paragraph") return [block.runs.map(run=>run.text).join("")];
    if(block.type==="table") return [block.rows.map(row=>row.cells.map(cell=>typeof cell==="string"?cell:cell.runs.map(run=>run.text).join("")).join("\t")).join("\n")];
    return [];
  }).filter(Boolean).join("\n");
  return [text,"[Ảnh cũ chưa được hỗ trợ ở chế độ xem này]"].filter(Boolean).join("\n");
}
