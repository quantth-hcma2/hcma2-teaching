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
  createRunSpan,
  richTextToDom,
  legacyPlainTextToDom,
  createEmptyDocumentDom,
  emptyRichTextDocument,
  serializeToRichText,
  splitRunAtOffset,
  computeFormatState,
  normalizePastedPlainText,
  pastedTextToParagraphLines,
  PASTE_TAB_REPLACEMENT
} from "../../rich-text-editor-serializer.mjs";
import { validateRichTextV1, MAX_BLOCKS, MAX_RUNS_PER_BLOCK, MAX_RUN_TEXT_LENGTH, MAX_TOTAL_TEXT_LENGTH } from "../../rich-text-contract.mjs";

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
  const blockEl = root.firstChild;
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
  const blockEl = root.firstChild;
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

test("16: a run exceeding MAX_RUN_TEXT_LENGTH fails the export closed", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const block = doc.createElement("div");
  block.setAttribute(DATA_BLOCK_ATTR, "paragraph");
  block.appendChild(createRunSpan(doc, { text: "x".repeat(MAX_RUN_TEXT_LENGTH + 1) }));
  root.appendChild(block);

  const result = serializeToRichText(root);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "limit_exceeded");
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
    bold: false, italic: false, font: "default", size: 16, color: "default",
    mixed: { bold: false, italic: false, font: false, size: false, color: false }
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
  assert.match(src, /import\s*\{\s*validateRichTextV1,\s*normalizeRichTextV1,\s*DEFAULT_SIZE\s*\}\s*from\s*"\.\/rich-text-contract\.mjs";/);
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
