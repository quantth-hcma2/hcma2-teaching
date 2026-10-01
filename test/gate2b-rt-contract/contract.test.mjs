// GATE 2B-RT-CONTRACT — pure tests for rich-text-contract.mjs: validation (A), normalization (B),
// plain-text mirror (C), and Unicode/length-policy behavior (F). No DOM, no Firestore, no editor —
// this module and its tests are entirely self-contained pure JS.

import test from "node:test";
import assert from "node:assert/strict";
import {
  RICH_TEXT_VERSION, MAX_BLOCKS, MAX_RUNS_PER_BLOCK, MAX_RUN_TEXT_LENGTH, MAX_TOTAL_TEXT_LENGTH,
  MAX_SERIALIZED_BYTE_LENGTH, FONT_TOKENS, SIZE_TOKENS, COLOR_TOKENS, ALIGN_TOKENS, DEFAULT_SIZE,
  validateRichTextV1, normalizeRichTextV1, richTextToPlainText,
  codePointLength, truncateToCodePoints
} from "../../rich-text-contract.mjs";

function run(text, extra = {}) { return { text, ...extra }; }
function paragraph(...runs) { return { type: "paragraph", runs }; }
function doc(...blocks) { return { version: RICH_TEXT_VERSION, blocks }; }

// =====================================================================================
// A. CONTRACT VALIDATION
// =====================================================================================

test("A: minimal valid document (one block, one plain run)", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("Xin chào")))), true);
});

test("A: valid document using every formatting field", () => {
  const d = doc(paragraph(run("Đậm nghiêng", { bold: true, italic: true, font: "arial", size: 20, color: "red" })));
  assert.equal(validateRichTextV1(d), true);
});

test("A: an empty-runs paragraph (blank line) is valid", () => {
  assert.equal(validateRichTextV1(doc(paragraph())), true);
});

test("A: maximal boundary — exactly MAX_BLOCKS blocks is valid", () => {
  const blocks = Array.from({ length: MAX_BLOCKS }, () => paragraph(run("x")));
  assert.equal(validateRichTextV1({ version: RICH_TEXT_VERSION, blocks }), true);
});

test("A: MAX_BLOCKS + 1 blocks is invalid", () => {
  const blocks = Array.from({ length: MAX_BLOCKS + 1 }, () => paragraph(run("x")));
  assert.equal(validateRichTextV1({ version: RICH_TEXT_VERSION, blocks }), false);
});

test("A: zero blocks is invalid (blocks must have at least 1)", () => {
  assert.equal(validateRichTextV1({ version: RICH_TEXT_VERSION, blocks: [] }), false);
});

test("A: exactly MAX_RUNS_PER_BLOCK runs is valid", () => {
  const runs = Array.from({ length: MAX_RUNS_PER_BLOCK }, () => run("x"));
  assert.equal(validateRichTextV1(doc({ type: "paragraph", runs })), true);
});

test("A: MAX_RUNS_PER_BLOCK + 1 runs is invalid", () => {
  const runs = Array.from({ length: MAX_RUNS_PER_BLOCK + 1 }, () => run("x"));
  assert.equal(validateRichTextV1(doc({ type: "paragraph", runs })), false);
});

test("A: a run exactly at MAX_RUN_TEXT_LENGTH code points is valid", () => {
  const text = "a".repeat(MAX_RUN_TEXT_LENGTH);
  assert.equal(validateRichTextV1(doc(paragraph(run(text)))), true);
});

test("A: a run one code point over MAX_RUN_TEXT_LENGTH is invalid", () => {
  const text = "a".repeat(MAX_RUN_TEXT_LENGTH + 1);
  assert.equal(validateRichTextV1(doc(paragraph(run(text)))), false);
});

test("A: MAX_TOTAL_TEXT_LENGTH is enforced across all runs/blocks combined", () => {
  // Many runs individually under MAX_RUN_TEXT_LENGTH, but summing over MAX_TOTAL_TEXT_LENGTH.
  const perRun = MAX_RUN_TEXT_LENGTH; // 500
  const runsNeeded = Math.ceil((MAX_TOTAL_TEXT_LENGTH + 1) / perRun);
  const blocks = [];
  let remaining = runsNeeded;
  while (remaining > 0) {
    const take = Math.min(MAX_RUNS_PER_BLOCK, remaining);
    blocks.push({ type: "paragraph", runs: Array.from({ length: take }, () => run("a".repeat(perRun))) });
    remaining -= take;
  }
  assert.ok(blocks.length <= MAX_BLOCKS, "test construction sanity check");
  assert.equal(validateRichTextV1({ version: RICH_TEXT_VERSION, blocks }), false);
});

test("A: total text exactly at MAX_TOTAL_TEXT_LENGTH is valid (split across runs and, if needed, blocks to respect MAX_RUN_TEXT_LENGTH/MAX_RUNS_PER_BLOCK)", () => {
  // A single block can hold at most MAX_RUNS_PER_BLOCK * MAX_RUN_TEXT_LENGTH characters, which
  // (since GATE 2B-RT-CONTINUOUS §8 raised MAX_TOTAL_TEXT_LENGTH well past that) can be smaller
  // than MAX_TOTAL_TEXT_LENGTH itself — so reaching the document-level cap legitimately requires
  // spreading the text across multiple paragraph blocks, same as real multi-paragraph content.
  const perBlockMax = MAX_RUNS_PER_BLOCK * MAX_RUN_TEXT_LENGTH;
  const blocksNeeded = Math.ceil(MAX_TOTAL_TEXT_LENGTH / perBlockMax);
  assert.ok(blocksNeeded <= MAX_BLOCKS, "test construction sanity check");
  let remaining = MAX_TOTAL_TEXT_LENGTH;
  const blocks = Array.from({ length: blocksNeeded }, () => {
    const blockLength = Math.min(remaining, perBlockMax);
    remaining -= blockLength;
    const runsNeeded = Math.ceil(blockLength / MAX_RUN_TEXT_LENGTH) || 1;
    let blockRemaining = blockLength;
    const runs = Array.from({ length: runsNeeded }, () => {
      const runLength = Math.min(blockRemaining, MAX_RUN_TEXT_LENGTH);
      blockRemaining -= runLength;
      return run("a".repeat(runLength));
    });
    return { type: "paragraph", runs };
  });
  const d = doc(...blocks);
  const actualTotal = blocks.reduce((sum, b) => sum + b.runs.reduce((s, r) => s + codePointLength(r.text), 0), 0);
  assert.equal(actualTotal, MAX_TOTAL_TEXT_LENGTH, "test construction sanity check");
  assert.equal(validateRichTextV1(d), true);
});

test("A: bad version — wrong number", () => {
  assert.equal(validateRichTextV1({ version: 2, blocks: [paragraph(run("x"))] }), false);
});

test("A: bad version — missing", () => {
  assert.equal(validateRichTextV1({ blocks: [paragraph(run("x"))] }), false);
});

test("A: bad version — string instead of number", () => {
  assert.equal(validateRichTextV1({ version: "1", blocks: [paragraph(run("x"))] }), false);
});

test("A: unknown top-level field makes the whole document invalid", () => {
  assert.equal(validateRichTextV1({ version: 1, blocks: [paragraph(run("x"))], extra: "nope" }), false);
});

test("A: unknown block field makes the whole document invalid", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph", runs: [run("x")], extra: "nope" })), false);
});

test("A: unknown run field makes the whole document invalid", () => {
  assert.equal(validateRichTextV1(doc(paragraph({ text: "x", extra: "nope" }))), false);
});

test("A: __proto__-like key on a run is rejected (not in the allowlist)", () => {
  const hostile = JSON.parse('{"text":"x","__proto__":"polluted"}');
  assert.equal(validateRichTextV1(doc(paragraph(hostile))), false);
});

test("A: constructor-like key on a block is rejected", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph", runs: [run("x")], constructor: "nope" })), false);
});

test("A: invalid block type is rejected", () => {
  assert.equal(validateRichTextV1(doc({ type: "heading", runs: [run("x")] })), false);
});

test("A: block missing 'runs' is rejected", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph" })), false);
});

test("A: block.runs not an array is rejected", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph", runs: "not-an-array" })), false);
});

test("A: run missing required 'text' is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph({ bold: true }))), false);
});

test("A: run.text wrong primitive type (number) is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph({ text: 123 }))), false);
});

test("A: run.bold wrong primitive type (string) is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { bold: "true" })))), false);
});

test("A: run.italic wrong primitive type (number) is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { italic: 1 })))), false);
});

test("A: every valid font token is accepted", () => {
  for (const font of FONT_TOKENS) {
    assert.equal(validateRichTextV1(doc(paragraph(run("x", { font })))), true, `font token ${font} should be valid`);
  }
});

test("A: an invalid font token is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { font: "Comic Sans MS" })))), false);
});

test("A: every valid size token is accepted", () => {
  for (const size of SIZE_TOKENS) {
    assert.equal(validateRichTextV1(doc(paragraph(run("x", { size })))), true, `size token ${size} should be valid`);
  }
});

test("A: an invalid size token is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { size: 15 })))), false);
});

test("A: a size passed as a numeric string is rejected (must be a number)", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { size: "16" })))), false);
});

test("A: every valid color token is accepted", () => {
  for (const color of COLOR_TOKENS) {
    assert.equal(validateRichTextV1(doc(paragraph(run("x", { color })))), true, `color token ${color} should be valid`);
  }
});

test("A: an invalid color token (arbitrary hex, not a palette token) is rejected", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { color: "#ff0000" })))), false);
});

test("A: null, undefined, arrays, and primitives are all rejected as the whole document", () => {
  for (const bad of [null, undefined, "string", 42, true, []]) {
    assert.equal(validateRichTextV1(bad), false, `${JSON.stringify(bad)} must be invalid`);
  }
});

test("A: unusual Unicode expansion (4-byte-UTF-8 astral characters) can be rejected by the serialized-size guard even while every count/code-point limit is individually satisfied", () => {
  // 400 runs (MAX_BLOCKS x MAX_RUNS_PER_BLOCK) x 25 emoji each = 10,000 code points total
  // (== MAX_TOTAL_TEXT_LENGTH), 25 code points per run (well under MAX_RUN_TEXT_LENGTH) — every
  // count-based and code-point-based limit is satisfied. But each emoji is 4 bytes in UTF-8 (vs 1
  // for ASCII), and full per-run formatting adds fixed JSON overhead per run, so the serialized
  // payload comfortably exceeds MAX_SERIALIZED_BYTE_LENGTH — proving this guard catches a case
  // the other limits alone do not.
  const emojiRunText = "😀".repeat(25);
  const blocks = Array.from({ length: MAX_BLOCKS }, () => ({
    type: "paragraph",
    runs: Array.from({ length: MAX_RUNS_PER_BLOCK }, () => ({
      text: emojiRunText, bold: true, italic: true, font: "roboto", size: 24, color: "purple"
    }))
  }));
  const bigDoc = { version: RICH_TEXT_VERSION, blocks };
  const totalCodePoints = bigDoc.blocks.reduce((sum, b) => sum + b.runs.reduce((s, r) => s + codePointLength(r.text), 0), 0);
  assert.equal(totalCodePoints, MAX_TOTAL_TEXT_LENGTH, "test construction sanity check");
  const byteLength = new TextEncoder().encode(JSON.stringify(bigDoc)).length;
  assert.ok(byteLength > MAX_SERIALIZED_BYTE_LENGTH, `expected constructed doc (${byteLength} bytes) to exceed the ${MAX_SERIALIZED_BYTE_LENGTH}-byte guard`);
  assert.equal(validateRichTextV1(bigDoc), false);
});

// =====================================================================================
// B. NORMALIZATION
// =====================================================================================

test("B: omitted bold/italic/font/size/color normalize to fully-omitted (defaults)", () => {
  const input = doc(paragraph({ text: "x" }));
  const normalized = normalizeRichTextV1(input);
  assert.deepEqual(normalized, { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] });
});

test("B: explicit false bold/italic normalize to omitted", () => {
  const input = doc(paragraph({ text: "x", bold: false, italic: false }));
  const normalized = normalizeRichTextV1(input);
  assert.deepEqual(normalized.blocks[0].runs[0], { text: "x" });
});

test("B: explicit default font/size/color normalize to omitted", () => {
  const input = doc(paragraph({ text: "x", font: "default", size: DEFAULT_SIZE, color: "default" }));
  const normalized = normalizeRichTextV1(input);
  assert.deepEqual(normalized.blocks[0].runs[0], { text: "x" });
});

test("B: non-default explicit values are preserved", () => {
  const input = doc(paragraph({ text: "x", bold: true, italic: true, font: "arial", size: 20, color: "red" }));
  const normalized = normalizeRichTextV1(input);
  assert.deepEqual(normalized.blocks[0].runs[0], { text: "x", bold: true, italic: true, font: "arial", size: 20, color: "red" });
});

test("B: normalization is deterministic — same input always produces the same output", () => {
  const input = doc(paragraph(run("a", { bold: true }), run("b")));
  assert.deepEqual(normalizeRichTextV1(input), normalizeRichTextV1(input));
});

test("B: normalization is idempotent — normalize(normalize(x)) === normalize(x)", () => {
  const input = doc(
    paragraph(run("a", { bold: true, font: "default", size: 16 }), run("b", { color: "default" })),
    paragraph(run("c", { italic: true, size: 24 }))
  );
  const once = normalizeRichTextV1(input);
  const twice = normalizeRichTextV1(once);
  assert.deepEqual(twice, once);
});

test("B: normalization does not preserve unknown fields (they are simply not copied)", () => {
  const input = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x", extra: "nope" }] }] };
  const normalized = normalizeRichTextV1(input);
  assert.deepEqual(normalized.blocks[0].runs[0], { text: "x" });
  assert.ok(!("extra" in normalized.blocks[0].runs[0]));
});

test("B: normalization throws on structurally unsound input (wrong version)", () => {
  assert.throws(() => normalizeRichTextV1({ version: 2, blocks: [] }), TypeError);
});

test("B: normalization throws when blocks is not an array", () => {
  assert.throws(() => normalizeRichTextV1({ version: 1, blocks: "nope" }), TypeError);
});

test("B: normalization throws when a run.text is not a string", () => {
  assert.throws(() => normalizeRichTextV1(doc(paragraph({ text: 5 }))), TypeError);
});

test("B: normalized output always validates (assuming legal tokens were used)", () => {
  const input = doc(paragraph(run("hello", { bold: true, font: "roboto", size: 18, color: "blue" })));
  assert.equal(validateRichTextV1(normalizeRichTextV1(input)), true);
});

// =====================================================================================
// C. PLAIN-TEXT MIRROR
// =====================================================================================

test("C: one paragraph, one run", () => {
  assert.equal(richTextToPlainText(doc(paragraph(run("Xin chào")))), "Xin chào");
});

test("C: multiple paragraphs join with exactly one newline", () => {
  const d = doc(paragraph(run("Đoạn một")), paragraph(run("Đoạn hai")), paragraph(run("Đoạn ba")));
  assert.equal(richTextToPlainText(d), "Đoạn một\nĐoạn hai\nĐoạn ba");
});

test("C: a blank paragraph contributes an empty line", () => {
  const d = doc(paragraph(run("Trên")), paragraph(), paragraph(run("Dưới")));
  assert.equal(richTextToPlainText(d), "Trên\n\nDưới");
});

test("C: multiple runs within one paragraph concatenate with no separator", () => {
  const d = doc(paragraph(run("Xin "), run("chào", { bold: true }), run(" bạn")));
  assert.equal(richTextToPlainText(d), "Xin chào bạn");
});

test("C: formatting never alters the derived text", () => {
  const plain = doc(paragraph(run("Nội dung")));
  const formatted = doc(paragraph(run("Nội dung", { bold: true, italic: true, font: "times", size: 24, color: "purple" })));
  assert.equal(richTextToPlainText(plain), richTextToPlainText(formatted));
});

test("C: Vietnamese diacritics survive exactly", () => {
  const text = "Đây là tiếng Việt: ă â ê ô ơ ư đ, dấu: à á ả ã ạ";
  assert.equal(richTextToPlainText(doc(paragraph(run(text)))), text);
});

test("C: an invalid document safely returns empty string rather than throwing", () => {
  assert.equal(richTextToPlainText({ version: 99, blocks: [] }), "");
  assert.equal(richTextToPlainText(null), "");
  assert.equal(richTextToPlainText(undefined), "");
});

// =====================================================================================
// F. UNICODE / LENGTH POLICY
// =====================================================================================

test("F: Vietnamese diacritics (precomposed) count as their visible number of code points", () => {
  // "ế" (precomposed U+1EBF) is a single code point.
  const text = "ế".repeat(10);
  assert.equal(codePointLength(text), 10);
});

test("F: combining marks each count as their own code point (decomposed form)", () => {
  // "e" + combining acute (U+0301) + combining circumflex (U+0302) = 3 code points, 1 visual glyph.
  const decomposed = "é̂";
  assert.equal(codePointLength(decomposed), 3);
});

test("F: an astral emoji (surrogate pair) counts as ONE code point, not two", () => {
  const grinning = "😀"; // U+1F600 — a surrogate pair in UTF-16
  assert.equal(grinning.length, 2, "sanity check: UTF-16 .length sees a surrogate pair as 2 units");
  assert.equal(codePointLength(grinning), 1, "code-point counting must see it as 1");
});

test("F: a run text made entirely of astral emoji is measured by code point for the MAX_RUN_TEXT_LENGTH limit", () => {
  const text = "😀".repeat(MAX_RUN_TEXT_LENGTH); // exactly at the limit by code-point count
  assert.equal(validateRichTextV1(doc(paragraph(run(text)))), true);
  const oneOver = "😀".repeat(MAX_RUN_TEXT_LENGTH + 1);
  assert.equal(validateRichTextV1(doc(paragraph(run(oneOver)))), false);
});

test("F: surrogate pairs are never split by safe truncation", () => {
  const text = "😀".repeat(5);
  const truncated = truncateToCodePoints(text, 3);
  assert.equal(truncated, "😀😀😀");
  assert.equal(codePointLength(truncated), 3);
  // Confirm no lone/corrupted surrogate: re-decoding must not throw and must round-trip cleanly.
  assert.equal(Array.from(truncated).length * 2, truncated.length);
});

test("F: truncateToCodePoints is a no-op when already within the limit", () => {
  assert.equal(truncateToCodePoints("hello", 100), "hello");
});

test("F: mixed Vietnamese text + emoji truncates safely at a code-point boundary", () => {
  const text = "Xin chào 😀 bạn 🎉 nhé";
  const truncated = truncateToCodePoints(text, 10);
  assert.equal(codePointLength(truncated), 10);
  assert.equal(truncated, Array.from(text).slice(0, 10).join(""));
});

// =====================================================================================
// G. PARAGRAPH ALIGNMENT (GATE RICHTEXT-ALIGN)
// =====================================================================================

test("G: each of the four alignment tokens is a valid paragraph block", () => {
  for (const align of ALIGN_TOKENS) {
    assert.equal(validateRichTextV1(doc({ type: "paragraph", align, runs: [run("x")] })), true, `align=${align} must be valid`);
  }
});

test("G: a paragraph with no align field is valid (existing documents, unchanged)", () => {
  assert.equal(validateRichTextV1(doc(paragraph(run("Nội dung cũ")))), true);
  assert.equal(Object.keys(paragraph(run("x"))).includes("align"), false);
});

test("G: an invalid align value fails closed, same as any other out-of-allowlist token", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph", align: "justify-all", runs: [] })), false);
  assert.equal(validateRichTextV1(doc({ type: "paragraph", align: "center; }</style>", runs: [] })), false);
  assert.equal(validateRichTextV1(doc({ type: "paragraph", align: 1, runs: [] })), false, "non-string align must be rejected");
  assert.equal(validateRichTextV1(doc({ type: "paragraph", align: null, runs: [] })), false, "null align must be rejected, not treated as absent");
});

test("G: align is a block-level field, not a run field — an unknown block key is still rejected", () => {
  assert.equal(validateRichTextV1(doc({ type: "paragraph", align: "center", bogus: true, runs: [] })), false);
  assert.equal(validateRichTextV1(doc(paragraph(run("x", { align: "center" })))), false, "align on a RUN (not a block) must be rejected — unknown run key");
});

test("G: normalization omits align when \"left\" or absent, keeps it otherwise, and does not itself enforce the allowlist", () => {
  assert.deepEqual(normalizeRichTextV1(doc({ type: "paragraph", align: "left", runs: [run("x")] })),
    { version: RICH_TEXT_VERSION, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] });
  assert.deepEqual(normalizeRichTextV1(doc(paragraph(run("x")))),
    { version: RICH_TEXT_VERSION, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] });
  assert.deepEqual(normalizeRichTextV1(doc({ type: "paragraph", align: "center", runs: [run("x")] })),
    { version: RICH_TEXT_VERSION, blocks: [{ type: "paragraph", align: "center", runs: [{ text: "x" }] }] });
  // Pass-through of an invalid value — isValidBlock's job (tested above) to reject it downstream.
  const normalizedInvalid = normalizeRichTextV1(doc({ type: "paragraph", align: "not-a-real-token", runs: [] }));
  assert.equal(normalizedInvalid.blocks[0].align, "not-a-real-token");
  assert.equal(validateRichTextV1(normalizedInvalid), false);
});

test("G: round-trip through normalize -> validate is stable for every alignment value", () => {
  for (const align of ALIGN_TOKENS) {
    const input = { type: "paragraph", align, runs: [run("Đoạn văn", { bold: true })] };
    const normalized = normalizeRichTextV1(doc(input));
    assert.equal(validateRichTextV1(normalized), true);
    assert.equal(normalized.blocks[0].align, align === "left" ? undefined : align);
  }
});
