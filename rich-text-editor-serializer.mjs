// GATE 2B-RT-EDITOR — DOM <-> RichText V1 serializer, loader, and small pure helpers shared by the
// interactive editor (rich-text-editor.mjs). This module owns the TRUST BOUNDARY between whatever
// the browser's contenteditable engine actually produced in the DOM (untrusted, even though the
// editor built it originally — the DOM is not trusted storage) and the RichText V1 contract
// (rich-text-contract.mjs), which IS trusted once produced here.
//
// Reuse, never duplicate: this module calls validateRichTextV1 / normalizeRichTextV1 /
// richTextToPlainText from rich-text-contract.mjs for every piece of contract logic. It never
// re-implements limit checks, token allowlists, or Unicode length policy itself. It calls
// FONT_CSS_MAP / SIZE_CSS_MAP / COLOR_CSS_MAP from rich-text-renderer.mjs for the editor's visual
// styling, so the editing surface renders identically to the safe read-only renderer.
//
// Canonical editor DOM shape (owned entirely by this module + rich-text-editor.mjs — nothing else
// in the codebase creates or reads these nodes):
//   <block-container data-rt-block="paragraph">        one per RichText block (V1: paragraph only)
//     <br>                                              ONLY when the paragraph has zero runs
//     -- or --
//     <span data-rt-run="1" data-rt-bold="1"? data-rt-italic="1"? data-rt-font="..."?
//           data-rt-size="..."? data-rt-color="...">text via textContent only</span>
//     ... one span per run ...
//
// Hostile/unexpected DOM policy (see GATE 2B-RT-EDITOR report item on this): if the export walk
// encounters a node it did not create (missing/incorrect markers, wrong tag name, or any element
// injected by something other than this editor), it is REDUCED TO INERT PLAIN TEXT — its
// `.textContent` (never `.innerHTML`, never an attribute, never an event handler, never a URL) is
// taken as unformatted run text. This is a deliberate choice over rejecting the whole export
// outright: a stray node (e.g. a transient element some browser feature inserts) should not cost
// the user their authored content when its text can be safely recovered as plain text. The chosen
// text still passes through the exact same normalize + validate + fail-closed pipeline as anything
// else, so a hostile/oversized result still fails closed rather than being silently accepted.

import { validateRichTextV1, normalizeRichTextV1, DEFAULT_SIZE } from "./rich-text-contract.mjs";
import { FONT_CSS_MAP, SIZE_CSS_MAP, COLOR_CSS_MAP } from "./rich-text-renderer.mjs";

export const DATA_BLOCK_ATTR = "data-rt-block";
export const DATA_RUN_ATTR = "data-rt-run";
export const DATA_BOLD_ATTR = "data-rt-bold";
export const DATA_ITALIC_ATTR = "data-rt-italic";
export const DATA_FONT_ATTR = "data-rt-font";
export const DATA_SIZE_ATTR = "data-rt-size";
export const DATA_COLOR_ATTR = "data-rt-color";

// ---------------- DOM writing (RichText -> editor DOM). createElement/textContent/setAttribute
// only — never innerHTML, matching the safe renderer's hard rule. ----------------

export function createRunSpan(doc, run) {
  const span = doc.createElement("span");
  span.setAttribute(DATA_RUN_ATTR, "1");
  span.textContent = run.text;
  if (run.bold === true) {
    span.setAttribute(DATA_BOLD_ATTR, "1");
    span.style.fontWeight = "700";
  }
  if (run.italic === true) {
    span.setAttribute(DATA_ITALIC_ATTR, "1");
    span.style.fontStyle = "italic";
  }
  if (typeof run.font === "string" && run.font !== "default") {
    span.setAttribute(DATA_FONT_ATTR, run.font);
    if (FONT_CSS_MAP[run.font]) span.style.fontFamily = FONT_CSS_MAP[run.font];
  }
  if (typeof run.size === "number" && run.size !== DEFAULT_SIZE) {
    span.setAttribute(DATA_SIZE_ATTR, String(run.size));
    if (SIZE_CSS_MAP[run.size]) span.style.fontSize = SIZE_CSS_MAP[run.size];
  }
  if (typeof run.color === "string" && run.color !== "default") {
    span.setAttribute(DATA_COLOR_ATTR, run.color);
    if (COLOR_CSS_MAP[run.color]) span.style.color = COLOR_CSS_MAP[run.color];
  }
  return span;
}

function createBlockElement(doc) {
  const el = doc.createElement("div");
  el.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  return el;
}

function appendRunsOrPlaceholder(doc, blockEl, runs) {
  if (runs.length === 0) {
    blockEl.appendChild(doc.createElement("br"));
    return;
  }
  for (const run of runs) blockEl.appendChild(createRunSpan(doc, run));
}

// Builds a DocumentFragment for a validated RichText V1 document. Caller is responsible for having
// already validated `richValue` (the editor's loader does this before calling in).
export function richTextToDom(doc, richValue) {
  const frag = doc.createDocumentFragment();
  for (const block of richValue.blocks) {
    const blockEl = createBlockElement(doc);
    appendRunsOrPlaceholder(doc, blockEl, block.runs);
    frag.appendChild(blockEl);
  }
  return frag;
}

// The canonical minimum valid RichText V1 document, and its DOM form — used when the editor has
// neither a rich value nor legacy text to load (e.g. a brand-new activity/topic).
export function emptyRichTextDocument() {
  return { version: 1, blocks: [{ type: "paragraph", runs: [] }] };
}

export function createEmptyDocumentDom(doc) {
  return richTextToDom(doc, emptyRichTextDocument());
}

// Legacy plain-text loader: splits on any line-ending variant, one paragraph per line, mirroring
// richTextToPlainText's own "\n"-joins-paragraphs policy in reverse. A blank line becomes an empty
// paragraph (runs: []), exactly like any other empty paragraph. NOTE (scope): a legacy string with
// more lines/characters than the V1 contract's limits (MAX_BLOCKS / MAX_RUN_TEXT_LENGTH / etc.) can
// load into a DOM that later fails validateRichTextV1 on first export — this candidate gate does
// not implement a legacy-migration truncation/splitting policy, since the editor is not yet wired
// to any real legacy field. That policy question is left to GATE 2B-RT-INTEGRATION.
export function legacyPlainTextToDom(doc, legacyText) {
  const frag = doc.createDocumentFragment();
  const lines = String(legacyText ?? "").split(/\r\n|\r|\n/);
  const effectiveLines = lines.length === 0 ? [""] : lines;
  for (const line of effectiveLines) {
    const blockEl = createBlockElement(doc);
    if (line.length === 0) {
      blockEl.appendChild(doc.createElement("br"));
    } else {
      blockEl.appendChild(createRunSpan(doc, { text: line }));
    }
    frag.appendChild(blockEl);
  }
  return frag;
}

// ---------------- DOM reading (editor DOM -> RichText). Trust boundary: only textContent is ever
// read from a node this module did not itself create with the expected markers. ----------------

function isElement(node) {
  return !!node && node.nodeType === 1;
}
function isTextNode(node) {
  return !!node && node.nodeType === 3;
}

export function readRunFromMarkedSpan(span) {
  const run = { text: span.textContent ?? "" };
  if (span.getAttribute(DATA_BOLD_ATTR) === "1") run.bold = true;
  if (span.getAttribute(DATA_ITALIC_ATTR) === "1") run.italic = true;
  const font = span.getAttribute(DATA_FONT_ATTR);
  if (font !== null && font !== undefined) run.font = font;
  const sizeAttr = span.getAttribute(DATA_SIZE_ATTR);
  if (sizeAttr !== null && sizeAttr !== undefined) {
    const n = Number(sizeAttr);
    // Deliberately NOT validated/clamped here — an out-of-range or non-numeric value is passed
    // through as-is so validateRichTextV1 rejects it downstream (fail-closed on tampered/corrupt
    // attributes), rather than this reader silently repairing it.
    run.size = n;
  }
  const color = span.getAttribute(DATA_COLOR_ATTR);
  if (color !== null && color !== undefined) run.color = color;
  return run;
}

// A run produced by reducing an unrecognized node to inert plain text — always fully unformatted,
// since we do not trust anything about a node we did not create (including any inline style it
// might carry).
function inertTextRun(text) {
  return { text };
}

// Merges adjacent unformatted runs so the hostile-DOM fallback path does not inflate run counts
// (e.g. several consecutive stray text nodes) beyond what a human author would ever produce.
function pushRunMerged(runs, run) {
  const prev = runs[runs.length - 1];
  const isPlain = (r) => !r.bold && !r.italic && !r.font && r.size === undefined && !r.color;
  if (prev && isPlain(prev) && isPlain(run)) {
    prev.text += run.text;
  } else {
    runs.push(run);
  }
}

function readRunsFromBlock(blockEl) {
  const runs = [];
  const children = blockEl.childNodes || [];
  for (const child of children) {
    if (isElement(child) && child.tagName === "BR") {
      // The empty-paragraph placeholder — contributes no run. Any BR that is NOT the sole child
      // (e.g. hostile DOM with a BR in the middle of real runs) contributes nothing either: a
      // literal line-break glyph has no V1 representation, so it is dropped rather than invented
      // as run text (there is no safe inert-text equivalent for "insert a paragraph break here").
      continue;
    }
    if (isElement(child) && child.tagName === "SPAN" && child.getAttribute(DATA_RUN_ATTR) === "1") {
      pushRunMerged(runs, readRunFromMarkedSpan(child));
      continue;
    }
    if (isTextNode(child)) {
      const text = child.textContent ?? "";
      if (text.length > 0) pushRunMerged(runs, inertTextRun(text));
      continue;
    }
    if (isElement(child)) {
      // Unexpected element (wrong tag, or SPAN missing the run marker) — hostile-DOM policy:
      // reduce to inert plain text via textContent only.
      const text = child.textContent ?? "";
      if (text.length > 0) pushRunMerged(runs, inertTextRun(text));
      continue;
    }
    // Any other node type (comment, etc.) contributes nothing.
  }
  return runs;
}

// Walks the editor root's children into an intermediate { version, blocks } object. Always
// structurally sound by construction (every value has the right JS type and shape), so the only
// way normalizeRichTextV1() can throw afterward is a genuine bug in this function itself.
function domToRichTextIntermediate(rootEl) {
  const blocks = [];
  const children = rootEl.childNodes || [];
  for (const child of children) {
    if (isElement(child) && child.tagName === "DIV" && child.getAttribute(DATA_BLOCK_ATTR) === "paragraph") {
      blocks.push({ type: "paragraph", runs: readRunsFromBlock(child) });
      continue;
    }
    // Unexpected top-level node (not a recognized block div) — hostile-DOM policy: treat its
    // whole textContent as its own single-run paragraph (or an empty paragraph if blank), rather
    // than dropping it or aborting the export.
    const text = child.textContent ?? "";
    blocks.push({ type: "paragraph", runs: text.length > 0 ? [inertTextRun(text)] : [] });
  }
  if (blocks.length === 0) blocks.push({ type: "paragraph", runs: [] });
  return { version: 1, blocks };
}

// The trusted export function. Never throws for routine "content exceeds limits" cases — that is
// signaled as { ok: false, reason: "limit_exceeded" } so the caller can tell the user to shorten
// their content, with their authored text left completely untouched in the editor (no truncation).
// A genuine internal error (should be unreachable given domToRichTextIntermediate's construction)
// is signaled as { ok: false, reason: "internal_error", error } rather than propagating a throw.
export function serializeToRichText(rootEl) {
  const intermediate = domToRichTextIntermediate(rootEl);
  let normalized;
  try {
    normalized = normalizeRichTextV1(intermediate);
  } catch (error) {
    return { ok: false, reason: "internal_error", error };
  }
  if (!validateRichTextV1(normalized)) {
    return { ok: false, reason: "limit_exceeded" };
  }
  return { ok: true, value: normalized };
}

// ---------------- Pure DOM-surgery helper reused by selection-based formatting (the interactive
// editor drives *which* span and *what* offset from a real Range; this function itself needs
// nothing but a document and an element, so it is independently unit-testable). ----------------

// Splits `span` (a run span, still unattached-agnostic — must already be in `span.parentNode`) at
// `offset` UTF-16 code units into two sibling spans carrying identical formatting attributes, and
// returns [firstHalf, secondHalf]. Either half may be empty-text (offset 0 or offset === length) —
// callers are responsible for discarding an empty half if they don't want a zero-length run
// span left behind.
export function splitRunAtOffset(doc, span, offset) {
  const text = span.textContent ?? "";
  // Guard against splitting a UTF-16 surrogate pair in half (see rich-text-contract.mjs's own
  // Unicode-length-policy note): if `offset` lands between a high surrogate and the low surrogate
  // that completes it, nudge the split point forward by one UTF-16 code unit so the whole
  // character stays together in the "before" half, rather than producing two halves each holding a
  // lone, invalid surrogate.
  let safeOffset = offset;
  if (safeOffset > 0 && safeOffset < text.length) {
    const before = text.charCodeAt(safeOffset - 1);
    const after = text.charCodeAt(safeOffset);
    const isHighSurrogate = before >= 0xd800 && before <= 0xdbff;
    const isLowSurrogate = after >= 0xdc00 && after <= 0xdfff;
    if (isHighSurrogate && isLowSurrogate) safeOffset += 1;
  }
  const before = text.slice(0, safeOffset);
  const after = text.slice(safeOffset);
  const firstRun = readRunFromMarkedSpan(span);
  const secondRun = { ...firstRun };
  firstRun.text = before;
  secondRun.text = after;
  const firstSpan = createRunSpan(doc, firstRun);
  const secondSpan = createRunSpan(doc, secondRun);
  const parent = span.parentNode;
  parent.insertBefore(firstSpan, span);
  parent.insertBefore(secondSpan, span);
  parent.removeChild(span);
  return [firstSpan, secondSpan];
}

// ---------------- Pure formatting-state helpers (toolbar reflection, incl. "mixed"). ----------------

const FORMAT_KEYS = Object.freeze(["bold", "italic", "font", "size", "color"]);

function defaultedRunInfo(run) {
  return {
    bold: run.bold === true,
    italic: run.italic === true,
    font: typeof run.font === "string" ? run.font : "default",
    size: typeof run.size === "number" ? run.size : DEFAULT_SIZE,
    color: typeof run.color === "string" ? run.color : "default"
  };
}

// Given an array of run-like objects (already read from spans, or a single pending typing-state
// object), returns the uniform value per formatting property, or null where the selection is
// "mixed" (runs disagree), plus an explicit `mixed` map for the UI to render an indeterminate
// control state. An empty array (nothing selected / no content yet) reports the all-default state.
export function computeFormatState(runLikeObjects) {
  if (runLikeObjects.length === 0) {
    return {
      bold: false, italic: false, font: "default", size: DEFAULT_SIZE, color: "default",
      mixed: { bold: false, italic: false, font: false, size: false, color: false }
    };
  }
  const infos = runLikeObjects.map(defaultedRunInfo);
  const first = infos[0];
  const result = {};
  const mixed = {};
  for (const key of FORMAT_KEYS) {
    const uniform = infos.every((info) => info[key] === first[key]);
    mixed[key] = !uniform;
    result[key] = uniform ? first[key] : null;
  }
  result.mixed = mixed;
  return result;
}

// ---------------- Pure paste-text normalization (no DOM at all). ----------------

// V1 has no tab-stop concept; a pasted tab is deterministically expanded to 4 spaces rather than
// silently dropped or left as a raw \t character (which the contract does not forbid in run text,
// but which would render inconsistently and is not a formatting feature this editor exposes).
export const PASTE_TAB_REPLACEMENT = "    ";

// Normalizes CRLF and lone CR to LF, then expands tabs. Pure string function, independent of any
// paragraph-splitting decision (see pastedTextToParagraphLines).
export function normalizePastedPlainText(text) {
  const s = String(text ?? "");
  const lfNormalized = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return lfNormalized.replace(/\t/g, PASTE_TAB_REPLACEMENT);
}

// Splits normalized pasted text into paragraph lines: each "\n" is a paragraph boundary (matching
// richTextToPlainText's own join-with-"\n" policy and the editor's Enter-key semantics), so pasting
// text that contains newlines creates multiple paragraphs, including empty ones for consecutive
// blank lines. Limit enforcement (MAX_BLOCKS etc.) is the caller's responsibility, applied through
// the normal serializeToRichText() fail-closed path after the paste is inserted.
export function pastedTextToParagraphLines(text) {
  return normalizePastedPlainText(text).split("\n");
}
