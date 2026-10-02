// GATE 2B-RT-EDITOR — pure tests for rich-text-editor-serializer.mjs: the DOM<->RichText trust
// boundary. Runs against the dependency-free fake DOM (fake-editor-dom.mjs), not a real browser —
// real contenteditable/Selection/Range behavior is verified separately in
// test/gate2b-rt-editor/harness (browser-driven, see the GATE 2B-RT-EDITOR report).

import test from "node:test";
import assert from "node:assert/strict";
import { FakeDocument } from "./fake-editor-dom.mjs";
import {
  DATA_BLOCK_ATTR,
  DATA_RUN_ATTR,
  DATA_TEXT_REGION_ATTR,
  DATA_ALIGN_ATTR,
  DATA_LIST_ATTR,
  DATA_INDENT_ATTR,
  DATA_LIST_MARKER_ATTR,
  createRunSpan,
  richTextToDom,
  legacyPlainTextToDom,
  createEmptyDocumentDom,
  emptyRichTextDocument,
  serializeToRichText,
  splitRunAtOffset,
  setBlockAlign,
  effectiveBlockAlign,
  setBlockList,
  effectiveBlockList,
  setBlockIndent,
  effectiveBlockIndent,
  setBlockLineSpacing,
  effectiveBlockLineSpacing,
  setBlockSpacing,
  effectiveBlockSpacing,
  isListMarkerElement,
  renormalizeListMarkers,
  computeAlignState,
  computeUniformState,
  computeFormatState,
  normalizePastedPlainText,
  pastedTextToParagraphLines,
  PASTE_TAB_REPLACEMENT
} from "../../rich-text-editor-serializer.mjs";
import { validateRichTextV1, MAX_BLOCKS, MAX_RUNS_PER_BLOCK, MAX_RUN_TEXT_LENGTH, MAX_TOTAL_TEXT_LENGTH, ALIGN_TOKENS, LIST_TOKENS, MAX_INDENT_LEVEL } from "../../rich-text-contract.mjs";

function mount(doc, frag) {
  const root = doc.createElement("div");
  root.appendChild(frag);
  return root;
}

// ===================================================================================
// 1: round trip — richTextToDom then serializeToRichText recovers an equivalent document
// ===================================================================================

test("1: single paragraph, single unformatted run round-trips exactly", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "hello" }] }] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("2: multiple runs in one paragraph, each with distinct formatting, round-trips", () => {
  const doc = new FakeDocument();
  const value = {
    version: 1,
    blocks: [{
      type: "paragraph",
      runs: [
        { text: "bold", bold: true },
        { text: "italic", italic: true },
        { text: "arial-blue-20", font: "arial", size: 20, color: "blue" }
      ]
    }]
  };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("3: multiple paragraphs round-trip, including an empty paragraph in the middle", () => {
  const doc = new FakeDocument();
  const value = {
    version: 1,
    blocks: [
      { type: "paragraph", runs: [{ text: "first" }] },
      { type: "paragraph", runs: [] },
      { type: "paragraph", runs: [{ text: "third", bold: true }] }
    ]
  };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("4: block DOM shape uses the documented data-rt-block/data-rt-run markers, never innerHTML-style content", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x", bold: true }] }] };
  const root = mount(doc, richTextToDom(doc, value));
  // Consecutive paragraph blocks are grouped under a shared text-region wrapper (GATE
  // 2B-RT-CONTINUOUS); the paragraph itself is one level deeper than the region.
  const regionEl = root.firstChild;
  assert.equal(regionEl.getAttribute(DATA_TEXT_REGION_ATTR), "1");
  const blockEl = regionEl.firstChild;
  assert.equal(blockEl.tagName, "DIV");
  assert.equal(blockEl.getAttribute(DATA_BLOCK_ATTR), "paragraph");
  const runEl = blockEl.firstChild;
  assert.equal(runEl.tagName, "SPAN");
  assert.equal(runEl.getAttribute(DATA_RUN_ATTR), "1");
  assert.equal(runEl.getAttribute("data-rt-bold"), "1");
  assert.equal(runEl.textContent, "x");
});

// ===================================================================================
// 5-6: empty document
// ===================================================================================

test("5: emptyRichTextDocument() is a minimum-valid contract document", () => {
  const value = emptyRichTextDocument();
  assert.equal(validateRichTextV1(value), true);
  assert.deepEqual(value, { version: 1, blocks: [{ type: "paragraph", runs: [] }] });
});

test("6: createEmptyDocumentDom produces a single block with only a <br> placeholder, and serializes back to the empty document", () => {
  const doc = new FakeDocument();
  const root = mount(doc, createEmptyDocumentDom(doc));
  assert.equal(root.childNodes.length, 1);
  const regionEl = root.firstChild;
  assert.equal(regionEl.getAttribute(DATA_TEXT_REGION_ATTR), "1");
  assert.equal(regionEl.childNodes.length, 1);
  const blockEl = regionEl.firstChild;
  assert.equal(blockEl.childNodes.length, 1);
  assert.equal(blockEl.firstChild.tagName, "BR");
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, emptyRichTextDocument());
});

test("7: an empty editor root (no children at all) still serializes to the minimum-valid empty document, never to an invalid zero-block document", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, emptyRichTextDocument());
});

// ===================================================================================
// 8-9: legacy plain-text loader
// ===================================================================================

test("8: legacy plain text with LF line breaks loads as one paragraph per line, blank lines become empty paragraphs", () => {
  const doc = new FakeDocument();
  const root = mount(doc, legacyPlainTextToDom(doc, "line one\n\nline three"));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    version: 1,
    blocks: [
      { type: "paragraph", runs: [{ text: "line one" }] },
      { type: "paragraph", runs: [] },
      { type: "paragraph", runs: [{ text: "line three" }] }
    ]
  });
});

test("9: legacy plain text with CRLF and lone CR line breaks normalizes the same as LF", () => {
  const doc1 = new FakeDocument();
  const root1 = mount(doc1, legacyPlainTextToDom(doc1, "a\r\nb\rc\nd"));
  const doc2 = new FakeDocument();
  const root2 = mount(doc2, legacyPlainTextToDom(doc2, "a\nb\nc\nd"));
  assert.deepEqual(serializeToRichText(root1).value, serializeToRichText(root2).value);
});

// ===================================================================================
// 10-14: hostile / unexpected DOM — reduced to inert plain text, never preserved as markup
// ===================================================================================

test("10: an unmarked SPAN (missing the run marker attribute) is reduced to its textContent as a plain run, its tag/attributes are not preserved in any form", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const hostile = doc.createElement("span");
  hostile.setAttribute("onclick", "alert(1)");
  hostile.setAttribute("style", "color:red");
  hostile.textContent = "gotcha";
  block.appendChild(hostile);
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "gotcha" }] }] });
});

test("11: an entirely unexpected tag (e.g. injected DIV/IMG-like element) inside a block is reduced to inert plain text via textContent only", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const hostile = doc.createElement("img");
  hostile.setAttribute("src", "javascript:alert(1)");
  hostile.textContent = "";
  block.appendChild(hostile);
  const normal = createRunSpan(doc, { text: "safe" });
  block.appendChild(normal);
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  // The hostile IMG contributes empty textContent (nothing to recover) and only "safe" survives.
  assert.deepEqual(result.value, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "safe" }] }] });
});

test("12: a bare Text node sitting directly under a block (not wrapped in a run span) is treated as inert plain text", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(doc.createTextNode("bare text"));
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "bare text" }] }] });
});

test("13: consecutive hostile/bare nodes merge into a single plain run instead of inflating run count", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(doc.createTextNode("part1 "));
  const hostile = doc.createElement("b");
  hostile.textContent = "part2 ";
  block.appendChild(hostile);
  block.appendChild(doc.createTextNode("part3"));
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.blocks[0].runs, [{ text: "part1 part2 part3" }]);
});

test("14: an unrecognized top-level node (not a marked block DIV) becomes its own paragraph, text preserved, never dropped", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const stray = doc.createElement("p");
  stray.textContent = "orphaned paragraph";
  root.appendChild(stray);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "orphaned paragraph" }] }] });
});

test("15: a stray BR in the middle of real runs (not the sole empty-paragraph placeholder) contributes no run text of its own — no invented character for a line-break glyph V1 cannot represent. The two surrounding plain runs merge into one (harmless: richTextToPlainText and the renderer already concatenate adjacent run text with no separator, so 'before'+'after' as two runs vs one run render and read back identically)", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(createRunSpan(doc, { text: "before" }));
  block.appendChild(doc.createElement("br"));
  block.appendChild(createRunSpan(doc, { text: "after" }));
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.blocks[0].runs, [{ text: "beforeafter" }]);
});

// ===================================================================================
// 16-19: fail-closed on limit violations — whole export fails, nothing is truncated
// ===================================================================================

test("16: a long editor span exports as bounded runs without truncation", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(createRunSpan(doc, { text: "x".repeat(MAX_RUN_TEXT_LENGTH + 1) }));
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.equal(validateRichTextV1(result.value), true);
  assert.deepEqual(result.value.blocks[0].runs, [
    { text: "x".repeat(MAX_RUN_TEXT_LENGTH) }, { text: "x" }
  ]);
  assert.equal(block.textContent, "x".repeat(MAX_RUN_TEXT_LENGTH + 1));
});

test("17: more blocks than MAX_BLOCKS fails the export closed", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  for (let i = 0; i < MAX_BLOCKS + 1; i++) {
    const block = doc.createElement("div");
    block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
    block.appendChild(createRunSpan(doc, { text: "p" + i }));
    root.appendChild(block);
  }
  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "limit_exceeded");
});

test("18: more runs in one block than MAX_RUNS_PER_BLOCK fails closed (runs kept distinct via alternating formatting so they cannot merge)", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  for (let i = 0; i < MAX_RUNS_PER_BLOCK + 1; i++) {
    block.appendChild(createRunSpan(doc, { text: "r", bold: i % 2 === 0 }));
  }
  root.appendChild(block);
  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "limit_exceeded");
});

test("19: total text length across all blocks exceeding MAX_TOTAL_TEXT_LENGTH fails closed even when every individual run/block/run-count limit is respected (MAX_BLOCKS blocks, 2 runs of MAX_RUN_TEXT_LENGTH each — alternating bold so adjacent runs never merge back into one)", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const chunk = "y".repeat(MAX_RUN_TEXT_LENGTH);
  // MAX_BLOCKS * 2 * MAX_RUN_TEXT_LENGTH = 20 * 2 * 500 = 20000, comfortably over
  // MAX_TOTAL_TEXT_LENGTH (10000), while blocks<=MAX_BLOCKS and runs/block (2) <=
  // MAX_RUNS_PER_BLOCK and each run's own length stays exactly at (not over) MAX_RUN_TEXT_LENGTH.
  for (let i = 0; i < MAX_BLOCKS; i++) {
    const block = doc.createElement("div");
    block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
    block.appendChild(createRunSpan(doc, { text: chunk, bold: true }));
    block.appendChild(createRunSpan(doc, { text: chunk, bold: false }));
    root.appendChild(block);
  }
  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "limit_exceeded");
});

test("20: a tampered/corrupt data-rt-size attribute (not one of the fixed size tokens) fails the export closed rather than being silently coerced", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const span = createRunSpan(doc, { text: "x" });
  span.setAttribute("data-rt-size", "999");
  block.appendChild(span);
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "limit_exceeded");
});

test("21: a tampered data-rt-font attribute with a value outside the fixed allowlist fails the export closed", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const span = createRunSpan(doc, { text: "x" });
  span.setAttribute("data-rt-font", "comic-sans");
  block.appendChild(span);
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
});

// ===================================================================================
// 22-24: Unicode / astral-character correctness in the DOM round trip
// ===================================================================================

test("22: a run containing an astral character (surrogate pair) round-trips intact through the DOM", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "😀 hello 🎉" }] }] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("23: exactly MAX_RUN_TEXT_LENGTH astral code points (double that in UTF-16 length) is still valid — length is measured in code points, not UTF-16 units", () => {
  const doc = new FakeDocument();
  const text = "😀".repeat(MAX_RUN_TEXT_LENGTH);
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(createRunSpan(doc, { text }));
  const root = doc.createElement("div");
  root.appendChild(block);
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
});

test("24: splitRunAtOffset never splits a surrogate pair in half — an offset landing mid-pair is nudged so the character survives intact in one half", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const span = createRunSpan(doc, { text: "a😀b" }); // "a", high surrogate, low surrogate, "b" — offset 2 is mid-pair
  block.appendChild(span);
  root.appendChild(block);

  const [left, right] = splitRunAtOffset(doc, span, 2);
  // Neither half may contain a lone unpaired surrogate.
  for (const half of [left.textContent, right.textContent]) {
    for (let i = 0; i < half.length; i++) {
      const code = half.charCodeAt(i);
      const isHigh = code >= 0xd800 && code <= 0xdbff;
      if (isHigh) assert.ok(i + 1 < half.length && half.charCodeAt(i + 1) >= 0xdc00 && half.charCodeAt(i + 1) <= 0xdfff, "high surrogate must be immediately followed by its low surrogate within the same half");
    }
  }
  assert.equal(left.textContent + right.textContent, "a😀b");
});

// ===================================================================================
// 25: splitRunAtOffset preserves formatting on both halves
// ===================================================================================

test("25: splitRunAtOffset preserves bold/italic/font/size/color identically on both resulting halves", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  const span = createRunSpan(doc, { text: "helloworld", bold: true, italic: true, font: "times", size: 24, color: "purple" });
  block.appendChild(span);
  root.appendChild(block);

  const [left, right] = splitRunAtOffset(doc, span, 5);
  assert.equal(left.textContent, "hello");
  assert.equal(right.textContent, "world");
  for (const half of [left, right]) {
    assert.equal(half.getAttribute("data-rt-bold"), "1");
    assert.equal(half.getAttribute("data-rt-italic"), "1");
    assert.equal(half.getAttribute("data-rt-font"), "times");
    assert.equal(half.getAttribute("data-rt-size"), "24");
    assert.equal(half.getAttribute("data-rt-color"), "purple");
  }
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.blocks[0].runs, [
    { text: "hello", bold: true, italic: true, font: "times", size: 24, color: "purple" },
    { text: "world", bold: true, italic: true, font: "times", size: 24, color: "purple" }
  ]);
});

// ===================================================================================
// 26-31: computeFormatState (toolbar mixed-state detection) — pure, no DOM
// ===================================================================================

test("26: computeFormatState on an empty list reports the all-default, non-mixed state", () => {
  const state = computeFormatState([]);
  assert.deepEqual(state, {
    bold: false, italic: false, underline: false, strike: false, font: "default", size: 16, color: "default",
    mixed: { bold: false, italic: false, underline: false, strike: false, font: false, size: false, color: false }
  });
});

test("27: computeFormatState on a single run reports that run's exact (defaulted) state, never mixed", () => {
  const state = computeFormatState([{ text: "x", bold: true }]);
  assert.equal(state.bold, true);
  assert.equal(state.italic, false);
  assert.equal(state.mixed.bold, false);
});

test("28: computeFormatState reports bold=true, not mixed, when every touched run is bold", () => {
  const state = computeFormatState([{ bold: true }, { bold: true }, { bold: true }]);
  assert.equal(state.bold, true);
  assert.equal(state.mixed.bold, false);
});

test("29: computeFormatState reports mixed=true (and a null value) for bold when touched runs disagree", () => {
  const state = computeFormatState([{ bold: true }, { bold: false }]);
  assert.equal(state.mixed.bold, true);
  assert.equal(state.bold, null);
});

test("30: computeFormatState treats each of font/size/color independently — bold mixed does not force font mixed", () => {
  const state = computeFormatState([{ bold: true, font: "arial" }, { bold: false, font: "arial" }]);
  assert.equal(state.mixed.bold, true);
  assert.equal(state.mixed.font, false);
  assert.equal(state.font, "arial");
});

test("31: computeFormatState treats a missing property as its contract default (font/size/color 'default'/16) for comparison purposes", () => {
  const state = computeFormatState([{ text: "a" }, { text: "b", font: "default" }]);
  assert.equal(state.mixed.font, false);
  assert.equal(state.font, "default");
});

// ===================================================================================
// 32-38: paste text normalization — pure string functions, no DOM
// ===================================================================================

test("32: normalizePastedPlainText converts CRLF to LF", () => {
  assert.equal(normalizePastedPlainText("a\r\nb"), "a\nb");
});

test("33: normalizePastedPlainText converts lone CR to LF", () => {
  assert.equal(normalizePastedPlainText("a\rb"), "a\nb");
});

test("34: normalizePastedPlainText leaves existing LF alone", () => {
  assert.equal(normalizePastedPlainText("a\nb"), "a\nb");
});

test("35: normalizePastedPlainText expands each tab to the fixed 4-space replacement", () => {
  assert.equal(normalizePastedPlainText("a\tb"), "a" + PASTE_TAB_REPLACEMENT + "b");
});

test("36: normalizePastedPlainText handles null/undefined as empty string", () => {
  assert.equal(normalizePastedPlainText(null), "");
  assert.equal(normalizePastedPlainText(undefined), "");
});

test("37: pastedTextToParagraphLines splits on every newline, including consecutive blank lines", () => {
  assert.deepEqual(pastedTextToParagraphLines("a\n\nb\r\nc\rd"), ["a", "", "b", "c", "d"]);
});

test("38: pastedTextToParagraphLines on text with no newline at all returns a single line", () => {
  assert.deepEqual(pastedTextToParagraphLines("single line, no breaks"), ["single line, no breaks"]);
});

// ===================================================================================
// 39: contract reuse — the serializer never re-implements token allowlists or limit constants
// ===================================================================================

test("39: the serializer module imports validateRichTextV1/normalizeRichTextV1/DEFAULT_SIZE from rich-text-contract.mjs rather than redefining them", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "..", "rich-text-editor-serializer.mjs"), "utf8");
  assert.match(src, /import\s*\{\s*validateRichTextV1,\s*normalizeRichTextV1,\s*DEFAULT_SIZE,\s*MAX_RUN_TEXT_LENGTH\s*\}\s*from\s*"\.\/rich-text-contract\.mjs";/);
  assert.doesNotMatch(src, /FONT_TOKENS\s*=/, "must not redefine the font token allowlist");
  assert.doesNotMatch(src, /SIZE_TOKENS\s*=/, "must not redefine the size token allowlist");
  assert.doesNotMatch(src, /COLOR_TOKENS\s*=/, "must not redefine the color token allowlist");
  assert.doesNotMatch(src, /MAX_RUN_TEXT_LENGTH\s*=/, "must not redefine contract limit constants");
});

test("40: the interactive editor module imports validateRichTextV1/richTextToPlainText from rich-text-contract.mjs and serializeToRichText from the serializer, rather than re-implementing validation or plain-text derivation", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "..", "rich-text-editor.mjs"), "utf8");
  assert.match(src, /import\s*\{\s*validateRichTextV1,\s*richTextToPlainText,\s*DEFAULT_SIZE\s*\}\s*from\s*"\.\/rich-text-contract\.mjs";/);
  assert.match(src, /serializeToRichText/);
  assert.doesNotMatch(src, /function\s+validateRichTextV1/, "must not define its own validator");
  assert.doesNotMatch(src, /\.innerHTML\s*=/, "must never assign innerHTML anywhere");
});

// ===================================================================================
// 41+: PARAGRAPH ALIGNMENT (GATE RICHTEXT-ALIGN) — DOM write/read round-trip
// ===================================================================================

test("41: richTextToDom writes data-rt-align only for a non-left alignment, never for left/absent", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [
    { type: "paragraph", runs: [{ text: "a" }] },
    { type: "paragraph", align: "left", runs: [{ text: "b" }] },
    { type: "paragraph", align: "center", runs: [{ text: "c" }] },
    { type: "paragraph", align: "right", runs: [{ text: "d" }] },
    { type: "paragraph", align: "justify", runs: [{ text: "e" }] }
  ] };
  const root = mount(doc, richTextToDom(doc, value));
  const region = root.firstChild;
  const blocks = Array.from(region.childNodes);
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0].getAttribute(DATA_ALIGN_ATTR), null);
  assert.equal(blocks[1].getAttribute(DATA_ALIGN_ATTR), null, "explicit align:\"left\" must not be written to the DOM either");
  assert.equal(blocks[2].getAttribute(DATA_ALIGN_ATTR), "center");
  assert.equal(blocks[3].getAttribute(DATA_ALIGN_ATTR), "right");
  assert.equal(blocks[4].getAttribute(DATA_ALIGN_ATTR), "justify");
  assert.equal(blocks[2].style.textAlign, "center");
  assert.equal(blocks[3].style.textAlign, "right");
  assert.equal(blocks[4].style.textAlign, "justify");
  assert.ok(!blocks[0].style.textAlign, "left/absent must not carry an inline textAlign style either");
});

test("42: serializeToRichText reads data-rt-align back, omitting the key for an ordinary (left) paragraph", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [
    { type: "paragraph", runs: [{ text: "a" }] },
    { type: "paragraph", align: "center", runs: [{ text: "b" }] }
  ] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
  assert.equal(Object.prototype.hasOwnProperty.call(result.value.blocks[0], "align"), false);
});

test("43: full richTextToDom -> serializeToRichText round-trip is exact for every alignment value, including mixed consecutive paragraphs", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: ALIGN_TOKENS.map((align, i) => ({ type: "paragraph", ...(align === "left" ? {} : { align }), runs: [{ text: `p${i}` }] })) };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("44: an invalid data-rt-align attribute value fails closed on export (fail-safe, not silently dropped)", () => {
  const doc = new FakeDocument();
  const root = mount(doc, richTextToDom(doc, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] }));
  root.firstChild.firstChild.setAttribute(DATA_ALIGN_ATTR, "not-a-real-alignment");
  const result = serializeToRichText(root);
  assert.deepEqual(result, { ok: false, reason: "limit_exceeded" });
});

test("45: legacyPlainTextToDom produces paragraphs with no alignment (left, same as before this feature)", () => {
  const doc = new FakeDocument();
  const root = mount(doc, legacyPlainTextToDom(doc, "Line one\nLine two"));
  const blocks = Array.from(root.firstChild.childNodes);
  assert.ok(blocks.every(b => b.getAttribute(DATA_ALIGN_ATTR) === null));
});

test("46: setBlockAlign / effectiveBlockAlign are a correct, independent pure-DOM pair", () => {
  const doc = new FakeDocument();
  const el = doc.createElement("div");
  assert.equal(effectiveBlockAlign(el), "left", "no attribute means left by default");
  setBlockAlign(el, "center");
  assert.equal(el.getAttribute(DATA_ALIGN_ATTR), "center");
  assert.equal(effectiveBlockAlign(el), "center");
  setBlockAlign(el, "left");
  assert.equal(el.getAttribute(DATA_ALIGN_ATTR), null, "setting back to left clears the attribute");
  assert.equal(effectiveBlockAlign(el), "left");
  setBlockAlign(el, "right");
  setBlockAlign(el, "not-a-real-value");
  assert.equal(el.getAttribute(DATA_ALIGN_ATTR), null, "an unrecognized value clears the attribute rather than writing it through");
});

test("47: computeAlignState reports a uniform value, or null+mixed:true when paragraphs disagree", () => {
  assert.deepEqual(computeAlignState([]), { align: "left", mixed: false });
  assert.deepEqual(computeAlignState(["center"]), { align: "center", mixed: false });
  assert.deepEqual(computeAlignState(["center", "center", "center"]), { align: "center", mixed: false });
  assert.deepEqual(computeAlignState(["left", "center", "right"]), { align: null, mixed: true });
});

// ===================================================================================
// 48+: UNDERLINE / STRIKETHROUGH / LIST / INDENT / LINE SPACING / PARAGRAPH SPACING
// (GATE RICHTEXT-V3) — DOM write/read round-trip and the new pure helpers
// ===================================================================================

test("48: createRunSpan writes underline/strike attributes and the combined textDecoration style", () => {
  const doc = new FakeDocument();
  const both = createRunSpan(doc, { text: "x", underline: true, strike: true });
  assert.equal(both.getAttribute("data-rt-underline"), "1");
  assert.equal(both.getAttribute("data-rt-strike"), "1");
  assert.equal(both.style.textDecoration, "underline line-through");
  const onlyUnderline = createRunSpan(doc, { text: "x", underline: true });
  assert.equal(onlyUnderline.style.textDecoration, "underline");
  const neither = createRunSpan(doc, { text: "x" });
  assert.equal(neither.getAttribute("data-rt-underline"), null);
  assert.equal(neither.style.textDecoration, undefined);
});

test("49: computeUniformState is the generic form computeAlignState wraps — same semantics for any property", () => {
  assert.deepEqual(computeUniformState([], "normal"), { value: "normal", mixed: false });
  assert.deepEqual(computeUniformState(["bullet", "bullet"], ""), { value: "bullet", mixed: false });
  assert.deepEqual(computeUniformState(["bullet", "number"], ""), { value: null, mixed: true });
});

test("50: setBlockList/effectiveBlockList/setBlockIndent/effectiveBlockIndent/setBlockLineSpacing/setBlockSpacing round-trip correctly and clear on default", () => {
  const doc = new FakeDocument();
  const el = doc.createElement("div");
  assert.equal(effectiveBlockList(el), "");
  setBlockList(el, "bullet");
  assert.equal(el.getAttribute(DATA_LIST_ATTR), "bullet");
  assert.equal(effectiveBlockList(el), "bullet");
  setBlockList(el, null);
  assert.equal(el.getAttribute(DATA_LIST_ATTR), null);

  assert.equal(effectiveBlockIndent(el), 0);
  setBlockIndent(el, 3);
  assert.equal(el.getAttribute(DATA_INDENT_ATTR), "3");
  assert.equal(el.style.marginLeft, "72px");
  assert.equal(effectiveBlockIndent(el), 3);
  setBlockIndent(el, 0);
  assert.equal(el.getAttribute(DATA_INDENT_ATTR), null);
  assert.equal(el.style.marginLeft, "");

  assert.equal(effectiveBlockLineSpacing(el), "1");
  setBlockLineSpacing(el, "1.5");
  assert.equal(effectiveBlockLineSpacing(el), "1.5");
  setBlockLineSpacing(el, "1");
  assert.equal(el.getAttribute("data-rt-line-spacing"), null, "the default (1) is never itself persisted");

  assert.equal(effectiveBlockSpacing(el), "normal");
  setBlockSpacing(el, "compact");
  assert.equal(effectiveBlockSpacing(el), "compact");
  setBlockSpacing(el, "normal");
  assert.equal(el.getAttribute("data-rt-spacing"), null, "the default (normal) is never itself persisted");
});

test("51: richTextToDom writes list/indent/lineSpacing/spacing attributes only when non-default", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [
    { type: "paragraph", runs: [{ text: "plain" }] },
    { type: "paragraph", list: "number", indent: 2, lineSpacing: "2", spacing: "compact", runs: [{ text: "full" }] }
  ] };
  const root = mount(doc, richTextToDom(doc, value));
  const [plain, full] = root.firstChild.childNodes;
  assert.equal(plain.getAttribute(DATA_LIST_ATTR), null);
  assert.equal(plain.getAttribute(DATA_INDENT_ATTR), null);
  assert.equal(full.getAttribute(DATA_LIST_ATTR), "number");
  assert.equal(full.getAttribute(DATA_INDENT_ATTR), "2");
  assert.equal(full.getAttribute("data-rt-line-spacing"), "2");
  assert.equal(full.getAttribute("data-rt-spacing"), "compact");
});

test("52: a list paragraph gets a non-editable marker as its first child, correctly numbered, and it round-trips out of the export as plain runs (never leaking into content)", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [
    { type: "paragraph", list: "number", runs: [{ text: "one" }] },
    { type: "paragraph", list: "number", runs: [{ text: "two" }] }
  ] };
  const root = mount(doc, richTextToDom(doc, value));
  const [p1, p2] = root.firstChild.childNodes;
  assert.ok(isListMarkerElement(p1.firstChild));
  assert.equal(p1.firstChild.textContent, "1.");
  assert.equal(p1.firstChild.getAttribute("contenteditable"), "false");
  assert.equal(p2.firstChild.textContent, "2.");
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("53: renormalizeListMarkers resets numbering across a text-region boundary (equivalent to an Image/Table interrupting the run)", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const region1 = doc.createElement("div");
  region1.setAttribute(DATA_TEXT_REGION_ATTR, "1");
  const region2 = doc.createElement("div");
  region2.setAttribute(DATA_TEXT_REGION_ATTR, "1");
  function numberedParagraph(text) {
    const el = doc.createElement("div");
    el.setAttribute(DATA_BLOCK_ATTR, "paragraph");
    setBlockList(el, "number");
    const span = createRunSpan(doc, { text });
    el.appendChild(span);
    return el;
  }
  region1.appendChild(numberedParagraph("a"));
  region1.appendChild(numberedParagraph("b"));
  region2.appendChild(numberedParagraph("c"));
  root.appendChild(region1);
  root.appendChild(region2);
  renormalizeListMarkers(doc, root);
  assert.equal(region1.childNodes[0].firstChild.textContent, "1.");
  assert.equal(region1.childNodes[1].firstChild.textContent, "2.");
  assert.equal(region2.childNodes[0].firstChild.textContent, "1.", "numbering must restart in the new region");
});

test("54: an invalid list/indent/lineSpacing/spacing attribute value fails closed on export, same fail-safe policy as every other formatting field", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] };
  for (const [attr, badValue] of [[DATA_LIST_ATTR, "roman"], [DATA_INDENT_ATTR, "not-a-number"], ["data-rt-line-spacing", "99"], ["data-rt-spacing", "huge"]]) {
    const root = mount(doc, richTextToDom(doc, value));
    root.firstChild.firstChild.setAttribute(attr, badValue);
    const result = serializeToRichText(root);
    assert.equal(result.ok, false, `an invalid ${attr} value must fail closed`);
  }
});

test("55: every alignment/list/indent/lineSpacing/spacing token round-trips through richTextToDom -> serializeToRichText exactly, including every indent level", () => {
  const doc = new FakeDocument();
  const blocks = [];
  for (const list of LIST_TOKENS) {
    for (let indent = 1; indent <= MAX_INDENT_LEVEL; indent++) {
      blocks.push({ type: "paragraph", list, indent, runs: [{ text: `${list}-${indent}` }] });
    }
  }
  const value = { version: 1, blocks };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

// ===================================================================================
// 56+: GATE RICHTEXT-V3-QA-R2 — pushRunMerged's "isPlain" bare-merge check must account for
// underline/strike (found while investigating the owner's Issue B reproduction: an underline-only
// or strike-only run bordered by plain text was silently merged away, losing its formatting, on
// EVERY read — not only via the hostile-DOM fallback, but readRunsFromBlock's normal per-span
// path too, independent of any list action).
// ===================================================================================

test("56: an underline-only run bordered by plain text keeps its underline — does not get merged away as if it were plain", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [
    { text: "a " }, { text: "b", underline: true }, { text: " c" }
  ] }] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("57: a strike-only run bordered by plain text keeps its strike — does not get merged away as if it were plain", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [
    { text: "a " }, { text: "b", strike: true }, { text: " c" }
  ] }] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("58: bold then underline on two different phrases, separated by plain text, both survive independently", () => {
  const doc = new FakeDocument();
  const value = { version: 1, blocks: [{ type: "paragraph", runs: [
    { text: "a " }, { text: "b", bold: true }, { text: " c " }, { text: "d", underline: true }, { text: " e" }
  ] }] };
  const root = mount(doc, richTextToDom(doc, value));
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, value);
});

test("59: two adjacent runs that are BOTH genuinely plain still merge (the fix must not stop legitimate plain-run merging)", () => {
  const doc = new FakeDocument();
  const el = doc.createElement("div");
  const region = doc.createElement("div");
  region.setAttribute(DATA_TEXT_REGION_ATTR, "1");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(createRunSpan(doc, { text: "a " }));
  block.appendChild(createRunSpan(doc, { text: "b" })); // two separately-created but equally plain spans
  region.appendChild(block);
  el.appendChild(region);
  const result = serializeToRichText(el);
  assert.equal(result.ok, true);
  assert.equal(result.value.blocks[0].runs.length, 1, "two adjacent plain runs must still merge into one");
  assert.equal(result.value.blocks[0].runs[0].text, "a b");
});
