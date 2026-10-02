// GATE 2B-RT-EDITOR — DOM <-> RichText V1 serializer, loader, and small pure helpers shared by the
// interactive editor (rich-text-editor.mjs). This module owns the TRUST BOUNDARY between whatever
// the browser's contenteditable engine actually produced in the DOM (untrusted, even though the
// editor built it originally — the DOM is not trusted storage) and the RichText V1 contract
// (rich-text-contract.mjs), which IS trusted once produced here.
//
// Reuse, never duplicate: this module calls validateRichTextV1 / normalizeRichTextV1 /
// richTextToPlainText from rich-text-contract.mjs for every piece of contract logic. It never
// re-implements validation checks or token allowlists. Export partitions long spans using the
// contract's run limit and Unicode code-point policy before final validation. It calls
// FONT_CSS_MAP / SIZE_CSS_MAP / COLOR_CSS_MAP from rich-text-renderer.mjs for the editor's visual
// styling, so the editing surface renders identically to the safe read-only renderer.
//
// Canonical editor DOM shape (owned entirely by this module + rich-text-editor.mjs — nothing else
// in the codebase creates or reads these nodes):
//   <text-region data-rt-text-region="1" contenteditable="true">   groups 1+ CONSECUTIVE paragraph
//                                                                   blocks under one native editing
//                                                                   surface — a pure DOM container,
//                                                                   never persisted, never itself a
//                                                                   block in the contract.
//     <block-container data-rt-block="paragraph" data-rt-align="..."?>   one per RichText
//                                                          paragraph block; data-rt-align is
//                                                          present only for a non-"left" alignment
//       <br>                                              ONLY when the paragraph has zero runs
//       -- or --
//       <span data-rt-run="1" data-rt-bold="1"? data-rt-italic="1"? data-rt-font="..."?
//             data-rt-size="..."? data-rt-color="...">text via textContent only</span>
//       ... one span per run ...
//     ... one paragraph div per consecutive paragraph ...
//   </text-region>
//   <block-container data-rt-block="image">...</block-container>     sibling, NEVER inside a region
//   <block-container data-rt-block="table">...</block-container>     sibling, NEVER inside a region
//   <text-region>...</text-region>   a NEW region resumes after an image/table interrupts the run
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

import { validateRichText, normalizeRichText, DEFAULT_SIZE, MAX_RUN_TEXT_LENGTH } from "./rich-text-contract.mjs";
import { FONT_CSS_MAP, SIZE_CSS_MAP, COLOR_CSS_MAP, ALIGN_CSS_MAP, LINE_SPACING_CSS_MAP, SPACING_CSS_MAP, INDENT_PX_PER_LEVEL } from "./rich-text-renderer.mjs";

export const DATA_BLOCK_ATTR = "data-rt-block";
export const DATA_RUN_ATTR = "data-rt-run";
export const DATA_BOLD_ATTR = "data-rt-bold";
export const DATA_ITALIC_ATTR = "data-rt-italic";
export const DATA_UNDERLINE_ATTR = "data-rt-underline";
export const DATA_STRIKE_ATTR = "data-rt-strike";
export const DATA_FONT_ATTR = "data-rt-font";
export const DATA_SIZE_ATTR = "data-rt-size";
export const DATA_COLOR_ATTR = "data-rt-color";
// Paragraph-level (block, not run) formatting. The default value of each is never represented by
// its attribute at all — absence IS the default, matching every run-level formatting field's own
// "absent means default" convention (see createBlockElement/the setBlockXxx helpers below).
export const DATA_ALIGN_ATTR = "data-rt-align";
export const DATA_LIST_ATTR = "data-rt-list";
export const DATA_INDENT_ATTR = "data-rt-indent";
export const DATA_LINE_SPACING_ATTR = "data-rt-line-spacing";
export const DATA_SPACING_ATTR = "data-rt-spacing";
// A list-item's bullet/number marker is a NON-EDITABLE, purely presentational DOM node (never
// stored, never read as run content — see isListMarkerElement/readRunsFromBlock below) inserted as
// the first child of a list paragraph. contenteditable="false" makes native contenteditable treat
// it as an atomic island the caret skips over, so a user can never type into or merge text with it.
export const DATA_LIST_MARKER_ATTR = "data-rt-list-marker";
export const DATA_IMAGE_PATH_ATTR = "data-rt-image-path";
export const DATA_IMAGE_MIME_ATTR = "data-rt-image-mime";
export const DATA_IMAGE_SIZE_ATTR = "data-rt-image-size";
export const DATA_TABLE_ATTR = "data-rt-table";
// A Text region is a container, never a block itself: it groups one or more consecutive paragraph
// blocks under ONE shared contenteditable="true" surface so native browser editing (Backspace/
// Delete across paragraphs, arrow-key flow, cross-paragraph selection/copy, undo) works for free.
// Image/Table blocks are never placed inside a region — they always sit as siblings, which is what
// splits the document into separate regions. Purely a DOM/editor concept: never persisted, never
// part of the RichText V1/V2 block contract.
export const DATA_TEXT_REGION_ATTR = "data-rt-text-region";

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
  const decorations = [];
  if (run.underline === true) { span.setAttribute(DATA_UNDERLINE_ATTR, "1"); decorations.push("underline"); }
  if (run.strike === true) { span.setAttribute(DATA_STRIKE_ATTR, "1"); decorations.push("line-through"); }
  if (decorations.length > 0) span.style.textDecoration = decorations.join(" ");
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

function createBlockElement(doc, meta = {}) {
  const el = doc.createElement("div");
  el.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  if (meta.align) setBlockAlign(el, meta.align);
  if (meta.list) setBlockList(el, meta.list);
  if (meta.indent) setBlockIndent(el, meta.indent);
  if (meta.lineSpacing) setBlockLineSpacing(el, meta.lineSpacing);
  // Unlike the four calls above (each a no-op for its own default), spacing must always run — see
  // setBlockSpacing's own comment: margin-bottom's browser-native default (0) does not equal this
  // contract's semantic "normal" default (0.5em), so every paragraph needs it explicitly applied.
  setBlockSpacing(el, meta.spacing);
  return el;
}

// Pure DOM surgery (no Range/Selection knowledge) applying or clearing a paragraph block's
// alignment: sets both the semantic data-rt-align attribute (the only thing ever read back by
// readRecognizedBlock below) and the matching textAlign CSS so the editing surface visually
// matches rich-text-renderer.mjs's own read-only rendering. "left" (or anything falsy, or a value
// outside ALIGN_CSS_MAP) clears both — mirroring createRunSpan's own attribute+style pairing for
// bold/italic/font/size/color, and never writing a stored token directly into a CSS value (only
// ever through the fixed ALIGN_CSS_MAP lookup).
export function setBlockAlign(blockEl, align) {
  if (align && align !== "left" && Object.prototype.hasOwnProperty.call(ALIGN_CSS_MAP, align)) {
    blockEl.setAttribute(DATA_ALIGN_ATTR, align);
    blockEl.style.textAlign = ALIGN_CSS_MAP[align] || "";
  } else {
    blockEl.removeAttribute(DATA_ALIGN_ATTR);
    blockEl.style.textAlign = "";
  }
}

// GATE RICHTEXT-V3: the remaining paragraph-level setters below follow the exact same pattern as
// setBlockAlign — set/clear a semantic attribute plus the matching fixed-map-derived CSS, never a
// raw stored value written directly into a style property.

export function setBlockList(blockEl, list) {
  if (list === "bullet" || list === "number") blockEl.setAttribute(DATA_LIST_ATTR, list);
  else blockEl.removeAttribute(DATA_LIST_ATTR);
}

export function setBlockIndent(blockEl, indent) {
  const n = Number.isInteger(indent) ? indent : 0;
  if (n > 0) {
    blockEl.setAttribute(DATA_INDENT_ATTR, String(n));
    blockEl.style.marginLeft = `${n * INDENT_PX_PER_LEVEL}px`;
  } else {
    blockEl.removeAttribute(DATA_INDENT_ATTR);
    blockEl.style.marginLeft = "";
  }
}

export function setBlockLineSpacing(blockEl, lineSpacing) {
  if (lineSpacing && lineSpacing !== "1" && Object.prototype.hasOwnProperty.call(LINE_SPACING_CSS_MAP, lineSpacing)) {
    blockEl.setAttribute(DATA_LINE_SPACING_ATTR, lineSpacing);
    blockEl.style.lineHeight = LINE_SPACING_CSS_MAP[lineSpacing] || "";
  } else {
    blockEl.removeAttribute(DATA_LINE_SPACING_ATTR);
    blockEl.style.lineHeight = "";
  }
}

// GATE RICHTEXT-V3-QA-R1 root cause: unlike every sibling setter above (align/indent/lineSpacing),
// this one used to only set/clear the data-rt-spacing ATTRIBUTE and never touched a CSS style at
// all — so the editor's live paragraph-spacing control had literally no visual effect, while
// export/serialize/round-trip (which only reads the attribute) looked completely correct, which is
// exactly why this passed every prior automated check. The other three fields' "do nothing when
// default" shortcut was safe only because the BROWSER's own native default for text-align/margin-
// left/line-height already equals this contract's semantic default (left/0/"1") — but a plain
// paragraph <div>'s native margin-bottom is 0, not the intended "normal" default of 0.5em, so
// margin-bottom must always be explicitly applied (falling back to "normal" when absent/invalid),
// matching rich-text-renderer.mjs's own unconditional `p.style.margin` — while the semantic
// data-rt-spacing ATTRIBUTE still follows the usual "omit at the default" convention, so an
// existing document with no `spacing` field still round-trips with no `spacing` key.
export function setBlockSpacing(blockEl, spacing) {
  const token = spacing && Object.prototype.hasOwnProperty.call(SPACING_CSS_MAP, spacing) ? spacing : "normal";
  if (token === "normal") blockEl.removeAttribute(DATA_SPACING_ATTR);
  else blockEl.setAttribute(DATA_SPACING_ATTR, token);
  blockEl.style.marginBottom = SPACING_CSS_MAP[token];
}

// The block's CURRENT EFFECTIVE paragraph formatting, for editor-side reflection (toolbar state,
// Enter inheritance) — the default value when the attribute is absent. Unlike readRecognizedBlock's
// export-time read (below), these are never written into a persisted block object, so defaulting
// here is purely a display/UX convenience, not a contract concern.
export function effectiveBlockAlign(blockEl) {
  const align = blockEl.getAttribute(DATA_ALIGN_ATTR);
  return align === null ? "left" : align;
}
export function effectiveBlockList(blockEl) {
  return blockEl.getAttribute(DATA_LIST_ATTR) || "";
}
export function effectiveBlockIndent(blockEl) {
  return Number(blockEl.getAttribute(DATA_INDENT_ATTR) || "0");
}
export function effectiveBlockLineSpacing(blockEl) {
  return blockEl.getAttribute(DATA_LINE_SPACING_ATTR) || "1";
}
export function effectiveBlockSpacing(blockEl) {
  return blockEl.getAttribute(DATA_SPACING_ATTR) || "normal";
}

// A list-item marker is created fresh (never mutated-in-place beyond its own textContent — see
// renormalizeListMarkers) with contenteditable="false" so it is an atomic, non-editable island; its
// text is always either the fixed bullet glyph or a small computed integer, never derived from
// stored/authored content.
export function createListMarkerElement(doc, markerText) {
  const marker = doc.createElement("span");
  marker.setAttribute(DATA_LIST_MARKER_ATTR, "1");
  marker.setAttribute("contenteditable", "false");
  marker.style.userSelect = "none";
  marker.style.marginRight = "0.5em";
  marker.style.flex = "0 0 auto";
  marker.textContent = markerText;
  return marker;
}

export function isListMarkerElement(node) {
  return !!node && node.nodeType === 1 && node.tagName === "SPAN" && node.getAttribute(DATA_LIST_MARKER_ATTR) === "1";
}

// Recomputes and (re)inserts the marker element as the first child of every list paragraph under
// `rootEl`, in document order — the one and only place list-item numbers are ever computed (never
// stored; see rich-text-contract.mjs's `list` field doc and rich-text-renderer.mjs's identical
// read-only counter logic). Call after ANY DOM mutation that could change list membership, order,
// or indent: native typing/paste/merge (via _normalizeAllBlocks), Enter, toolbar list/indent
// actions, or inserting an Image/Table that splits a list run. Pure DOM surgery, safe to call
// liberally — a no-op walk when nothing list-related changed.
export function renormalizeListMarkers(doc, rootEl) {
  function applyToRegionParagraphs(paragraphs) {
    let prevKey = null, counter = 0;
    for (const block of paragraphs) {
      const list = block.getAttribute(DATA_LIST_ATTR);
      const existingMarker = Array.from(block.childNodes).find(isListMarkerElement);
      if (list !== "bullet" && list !== "number") {
        prevKey = null; counter = 0;
        if (existingMarker) block.removeChild(existingMarker);
        block.style.display = "";
        continue;
      }
      const indent = Number(block.getAttribute(DATA_INDENT_ATTR) || "0");
      const key = `${list}|${indent}`;
      counter = key === prevKey ? counter + 1 : 1;
      prevKey = key;
      const markerText = list === "bullet" ? "•" : `${counter}.`;
      if (existingMarker) {
        if (existingMarker.textContent !== markerText) existingMarker.textContent = markerText;
        if (block.firstChild !== existingMarker) block.insertBefore(existingMarker, block.firstChild);
      } else {
        block.insertBefore(createListMarkerElement(doc, markerText), block.firstChild);
      }
      block.style.display = "flex";
    }
  }
  // Manual childNodes walk rather than querySelectorAll — this runs against both the real DOM AND
  // the dependency-free FakeDocument the pure node-test suite uses (which implements childNodes/
  // appendChild/etc. but not a selector engine), and richTextToDom (below) calls this on document
  // fragments that may not even be attached yet. Paragraph blocks never nest, so once one is found
  // there is no need to recurse into it.
  function collectParagraphs(node, out) {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1) continue;
      if (child.getAttribute(DATA_BLOCK_ATTR) === "paragraph") { out.push(child); continue; }
      collectParagraphs(child, out);
    }
  }
  // Numbering is scoped PER TEXT REGION and resets at every region boundary. A region boundary
  // exists ONLY because an Image/Table interrupted the paragraph run (see
  // createTextRegionElement's doc comment) — so this is equivalent to, and implements, "reset
  // numbering after an Image/Table", matching rich-text-renderer.mjs's own identical read-only
  // counter policy exactly.
  for (const child of rootEl.childNodes || []) {
    if (child.nodeType !== 1) continue;
    if (child.getAttribute(DATA_TEXT_REGION_ATTR) === "1") {
      const paragraphs = [];
      collectParagraphs(child, paragraphs);
      applyToRegionParagraphs(paragraphs);
    }
  }
}

// Editability now lives on the shared region, not on each individual paragraph — this is what lets
// native contenteditable handle Backspace/Delete/arrow-navigation/selection across paragraphs.
export function createTextRegionElement(doc) {
  const el = doc.createElement("div");
  el.setAttribute(DATA_TEXT_REGION_ATTR, "1");
  el.setAttribute("contenteditable", "true");
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
// already validated `richValue` (the editor's loader does this before calling in). Consecutive
// paragraph blocks are grouped under one shared text-region wrapper; an image/table block always
// flushes the current region (it is never placed inside one) and the next paragraph, if any,
// starts a fresh region — this is pure DOM grouping, invisible to the flat block array itself.
export function richTextToDom(doc, richValue) {
  const frag = doc.createDocumentFragment();
  let openRegion = null;
  function flushRegion() {
    if (openRegion) { frag.appendChild(openRegion); openRegion = null; }
  }
  for (const block of richValue.blocks) {
    if (block.type === "image") {
      flushRegion();
      const el = doc.createElement("div"); el.setAttribute(DATA_BLOCK_ATTR, "image");
      el.setAttribute(DATA_IMAGE_PATH_ATTR, block.storagePath); el.setAttribute(DATA_IMAGE_MIME_ATTR, block.mimeType); el.setAttribute(DATA_IMAGE_SIZE_ATTR, String(block.size));
      const label = doc.createElement("span"); label.textContent = "Ảnh: ";
      const alt = doc.createElement("input"); alt.type = "text"; alt.maxLength = 300; alt.value = block.alt; alt.setAttribute("data-rt-image-alt", "1");
      const remove=doc.createElement("button"); remove.type="button"; remove.textContent="Xóa ảnh"; remove.setAttribute("data-rt-remove-block","1");
      el.appendChild(label); el.appendChild(alt); el.appendChild(remove); frag.appendChild(el); continue;
    }
    if (block.type === "table") {
      flushRegion();
      const el = doc.createElement("div"); el.setAttribute(DATA_BLOCK_ATTR, "table"); el.setAttribute(DATA_TABLE_ATTR, "1");
      const table = doc.createElement("table"); const tbody = doc.createElement("tbody");
      block.rows.forEach(row => { const tr=doc.createElement("tr"); row.cells.forEach(cell => { const td=doc.createElement("td"); const input=doc.createElement("div"); input.contentEditable="true"; input.setAttribute("role","textbox"); input.setAttribute("data-rt-cell","1"); appendRunsOrPlaceholder(doc,input,typeof cell === "string" ? (cell ? [{text:cell}] : []) : cell.runs); td.appendChild(input); tr.appendChild(td); }); tbody.appendChild(tr); });
      table.appendChild(tbody); el.appendChild(table);
      for (const [action,label] of [["row","+ Hàng"],["column","+ Cột"],["remove-row","− Hàng"],["remove-column","− Cột"]]) { const button=doc.createElement("button"); button.type="button"; button.textContent=label; button.setAttribute(`data-rt-table-${action}`,"1"); el.appendChild(button); }
      const remove=doc.createElement("button"); remove.type="button"; remove.textContent="Xóa bảng"; remove.setAttribute("data-rt-remove-block","1"); el.appendChild(remove);
      frag.appendChild(el); continue;
    }
    if (!openRegion) openRegion = createTextRegionElement(doc);
    const blockEl = createBlockElement(doc, block);
    appendRunsOrPlaceholder(doc, blockEl, block.runs);
    openRegion.appendChild(blockEl);
  }
  flushRegion();
  // Markers are always computed fresh here rather than being part of the loop above, so every
  // caller (editor, tests, createEmptyDocumentDom) gets correct list numbering "for free" without
  // needing to remember a separate call — see renormalizeListMarkers's own doc comment.
  renormalizeListMarkers(doc, frag);
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

// A single bare empty paragraph div (no region wrapper) — for the rare defensive case where a
// text region ends up with no paragraph child left (e.g. after an unanticipated native multi-
// paragraph deletion) and needs exactly one re-inserted into the EXISTING region, as opposed to
// createEmptyDocumentDom's own fresh region-wrapped fragment used when the whole document is empty.
export function createEmptyParagraphElement(doc) {
  const el = createBlockElement(doc);
  el.appendChild(doc.createElement("br"));
  return el;
}

// Legacy plain-text loader: splits on any line-ending variant, one paragraph per line, mirroring
// richTextToPlainText's own "\n"-joins-paragraphs policy in reverse. A blank line becomes an empty
// paragraph (runs: []), exactly like any other empty paragraph. Export partitions long lines
// into bounded runs without truncating or migrating stored data. Legacy content exceeding the
// document/block limits still loads intact but fails validation on export.
export function legacyPlainTextToDom(doc, legacyText) {
  const frag = doc.createDocumentFragment();
  const lines = String(legacyText ?? "").split(/\r\n|\r|\n/);
  const effectiveLines = lines.length === 0 ? [""] : lines;
  const region = createTextRegionElement(doc);
  for (const line of effectiveLines) {
    const blockEl = createBlockElement(doc);
    if (line.length === 0) {
      blockEl.appendChild(doc.createElement("br"));
    } else {
      blockEl.appendChild(createRunSpan(doc, { text: line }));
    }
    region.appendChild(blockEl);
  }
  frag.appendChild(region);
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
  if (span.getAttribute(DATA_UNDERLINE_ATTR) === "1") run.underline = true;
  if (span.getAttribute(DATA_STRIKE_ATTR) === "1") run.strike = true;
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
    if (isListMarkerElement(child)) {
      // The non-editable bullet/number marker — never content, never a run; see
      // createListMarkerElement/renormalizeListMarkers.
      continue;
    }
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

// Reads one of the three recognized block kinds from a marked DIV, or returns null for anything
// else (a bare text-region wrapper, a stray node, etc.) so callers can apply their own hostile-DOM
// fallback for whatever this does not recognize.
function readRecognizedBlock(node) {
  if (!isElement(node) || node.tagName !== "DIV") return null;
  const kind = node.getAttribute(DATA_BLOCK_ATTR);
  if (kind === "paragraph") {
    const block = { type: "paragraph", runs: readRunsFromBlock(node) };
    // Each added only when its attribute is actually present — an ordinary (never-touched)
    // paragraph round-trips with none of these keys at all, exactly like today's documents. Read
    // as-is, unvalidated: same documented policy as readRunFromMarkedSpan's `size` attribute above
    // — a tampered/invalid value is passed through for validateRichTextV1's allowlists to reject
    // fail-closed downstream, not silently repaired here.
    const align = node.getAttribute(DATA_ALIGN_ATTR);
    if (align !== null) block.align = align;
    const list = node.getAttribute(DATA_LIST_ATTR);
    if (list !== null) block.list = list;
    const indent = node.getAttribute(DATA_INDENT_ATTR);
    if (indent !== null) block.indent = Number(indent);
    const lineSpacing = node.getAttribute(DATA_LINE_SPACING_ATTR);
    if (lineSpacing !== null) block.lineSpacing = lineSpacing;
    const spacing = node.getAttribute(DATA_SPACING_ATTR);
    if (spacing !== null) block.spacing = spacing;
    return block;
  }
  if (kind === "image") {
    return { type:"image", storagePath:node.getAttribute(DATA_IMAGE_PATH_ATTR)||"", alt:node.querySelector('[data-rt-image-alt="1"]')?.value||"", mimeType:node.getAttribute(DATA_IMAGE_MIME_ATTR)||"", size:Number(node.getAttribute(DATA_IMAGE_SIZE_ATTR)||0) };
  }
  if (kind === "table") {
    const rows=Array.from(node.querySelectorAll("tr")).map(tr=>({cells:Array.from(tr.querySelectorAll('[data-rt-cell="1"]')).map(input=>({runs:readRunsFromBlock(input)}))}));
    return { type:"table", rows };
  }
  return null;
}

// Hostile-DOM fallback for a node that is neither a recognized block nor a text-region container:
// its whole textContent becomes its own single-run paragraph (or an empty paragraph if blank),
// rather than being dropped or aborting the export.
function inertParagraphFromNode(node) {
  const text = node?.textContent ?? "";
  return { type: "paragraph", runs: text.length > 0 ? [inertTextRun(text)] : [] };
}

// Walks the editor root's children into an intermediate { version, blocks } object. Always
// structurally sound by construction (every value has the right JS type and shape), so the only
// way normalizeRichTextV1() can throw afterward is a genuine bug in this function itself. A
// text-region wrapper is transparent here: it is never itself a block — its paragraph children are
// flattened straight into the same flat `blocks` array the contract has always used, exactly
// preserving document order across region/image/table boundaries.
function domToRichTextIntermediate(rootEl) {
  const blocks = [];
  const children = rootEl.childNodes || [];
  for (const child of children) {
    if (isElement(child) && child.getAttribute(DATA_TEXT_REGION_ATTR) === "1") {
      const inner = child.childNodes || [];
      let any = false;
      for (const grandchild of inner) {
        const recognized = readRecognizedBlock(grandchild);
        if (recognized) { blocks.push(recognized); any = true; continue; }
        if (isElement(grandchild) || isTextNode(grandchild)) {
          const text = grandchild.textContent ?? "";
          if (text.length > 0) { blocks.push(inertParagraphFromNode(grandchild)); any = true; }
        }
      }
      // A region that somehow ended up with no usable content still contributes one empty
      // paragraph, matching the same "never silently drop a structural position" policy as the
      // whole-document fallback below — this should not occur in practice (_ensureBlockHasContent
      // always leaves a <br> placeholder behind), but a region must never vanish without a trace.
      if (!any) blocks.push({ type: "paragraph", runs: [] });
      continue;
    }
    const recognized = readRecognizedBlock(child);
    if (recognized) { blocks.push(recognized); continue; }
    // Unexpected top-level node (not a recognized block div, not a region) — hostile-DOM policy.
    blocks.push(inertParagraphFromNode(child));
  }
  if (blocks.length === 0) blocks.push({ type: "paragraph", runs: [] });
  return { version: blocks.some(block => block.type !== "paragraph") ? 2 : 1, blocks };
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
    normalized = normalizeRichText(intermediate);
    // Editing merges same-format spans and paste/legacy loading can create long spans.
    // A DOM span is not a storage run: partition its text without changing paragraphs,
    // formatting, or the live DOM/caret. Array.from preserves whole Unicode code points.
    // Validate AFTER partitioning so run-count, total-text and byte limits still fail
    // closed, with no truncation or weakening of the stored RichText contract.
    for (const block of normalized.blocks) {
      if (block.type !== "paragraph") continue;
      block.runs = block.runs.flatMap(run => {
        const points = Array.from(run.text);
        if (points.length <= MAX_RUN_TEXT_LENGTH) return [run];
        const chunks = [];
        for (let start = 0; start < points.length; start += MAX_RUN_TEXT_LENGTH) {
          chunks.push({ ...run, text: points.slice(start, start + MAX_RUN_TEXT_LENGTH).join("") });
        }
        return chunks;
      });
    }
  } catch (error) {
    return { ok: false, reason: "internal_error", error };
  }
  if (!validateRichText(normalized)) {
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

const FORMAT_KEYS = Object.freeze(["bold", "italic", "underline", "strike", "font", "size", "color"]);

function defaultedRunInfo(run) {
  return {
    bold: run.bold === true,
    italic: run.italic === true,
    underline: run.underline === true,
    strike: run.strike === true,
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
      bold: false, italic: false, underline: false, strike: false, font: "default", size: DEFAULT_SIZE, color: "default",
      mixed: { bold: false, italic: false, underline: false, strike: false, font: false, size: false, color: false }
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

// Block-level analog of computeFormatState above, generic over any single paragraph-level
// property (alignment, list, indent, line spacing, paragraph spacing): given the effective value
// of that property for every paragraph touched by the current selection, returns the uniform
// value, or null + mixed:true when they disagree, for toolbar reflection (Word-like: applying one
// value to a mixed selection makes all of them that value — never lying to the user about a
// value that isn't actually uniform). An empty array (nothing selected / no content) reports
// `defaultValue`, matching computeFormatState's own all-default behavior.
export function computeUniformState(values, defaultValue) {
  if (values.length === 0) return { value: defaultValue, mixed: false };
  const first = values[0];
  const uniform = values.every((v) => v === first);
  return { value: uniform ? first : null, mixed: !uniform };
}

// Kept as its own named export (pre-existing call sites/tests use this name) — a thin wrapper
// around computeUniformState with the `align`-specific default and result-key naming.
export function computeAlignState(alignValues) {
  const { value, mixed } = computeUniformState(alignValues, "left");
  return { align: value, mixed };
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
