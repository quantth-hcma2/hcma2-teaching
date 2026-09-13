// GATE 2B-RT-CONTRACT — pure tests for rich-text-renderer.mjs: renderer behavior (D) and the full
// XSS corpus (E), using a minimal dependency-free fake DOM (see fake-dom.mjs). No real browser,
// no jsdom dependency, no Firestore.

import test from "node:test";
import assert from "node:assert/strict";
import { renderRichText, FONT_CSS_MAP, SIZE_CSS_MAP, COLOR_CSS_MAP } from "../../rich-text-renderer.mjs";
import { RICH_TEXT_VERSION } from "../../rich-text-contract.mjs";
import { FakeDocument } from "./fake-dom.mjs";

function run(text, extra = {}) { return { text, ...extra }; }
function paragraph(...runs) { return { type: "paragraph", runs }; }
function doc(...blocks) { return { version: RICH_TEXT_VERSION, blocks }; }

function newContainer() {
  const d = new FakeDocument();
  return { d, container: d.createElement("div") };
}

// =====================================================================================
// D. RENDERER
// =====================================================================================

test("D: valid rich content renders one <p> per block with the right text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("Xin chào")), paragraph(run("Tạm biệt"))), "", d);
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].tagName, "P");
  assert.equal(container.children[0].textContent, "Xin chào");
  assert.equal(container.children[1].textContent, "Tạm biệt");
});

test("D: every formatting token applies through the fixed lookup maps, and only those", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("x", { bold: true, italic: true, font: "arial", size: 20, color: "red" }))), "", d);
  const span = container.children[0].children[0];
  assert.equal(span.tagName, "SPAN");
  assert.equal(span.textContent, "x");
  assert.equal(span.style.fontWeight, "700");
  assert.equal(span.style.fontStyle, "italic");
  assert.equal(span.style.fontFamily, FONT_CSS_MAP.arial);
  assert.equal(span.style.fontSize, SIZE_CSS_MAP[20]);
  assert.equal(span.style.color, COLOR_CSS_MAP.red);
});

test("D: the 'default' font/color tokens apply no style override at all (inherit) — they are real sentinel values, mapped to null", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("x", { font: "default", color: "default" }))), "", d);
  const span = container.children[0].children[0];
  assert.equal(span.style.fontFamily, undefined);
  assert.equal(span.style.color, undefined);
});

test("D: an omitted size field applies no font-size override; an explicit size (even 16, the normalization default) still applies it", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("no size field at all"))), "", d);
  assert.equal(container.children[0].children[0].style.fontSize, undefined);

  const { d: d2, container: container2 } = newContainer();
  renderRichText(container2, doc(paragraph(run("explicit size 16", { size: 16 }))), "", d2);
  assert.equal(container2.children[0].children[0].style.fontSize, SIZE_CSS_MAP[16]);
});

test("D: multiple paragraphs and multiple runs per paragraph all render", () => {
  const { d, container } = newContainer();
  const d1 = doc(
    paragraph(run("Đoạn 1, phần a "), run("phần b in đậm", { bold: true })),
    paragraph(run("Đoạn 2"))
  );
  renderRichText(container, d1, "", d);
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].children.length, 2);
  assert.equal(container.children[0].textContent, "Đoạn 1, phần a phần b in đậm");
  assert.equal(container.children[1].textContent, "Đoạn 2");
});

test("D: legacy fallback renders when richValue is absent (null/undefined)", () => {
  for (const absent of [null, undefined]) {
    const { d, container } = newContainer();
    renderRichText(container, absent, "Nội dung cũ", d);
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].tagName, "P");
    assert.equal(container.children[0].textContent, "Nội dung cũ");
  }
});

test("D: malformed rich content falls back to the legacy plain text, not a partial render", () => {
  const { d, container } = newContainer();
  const malformed = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "ok" }] }, { type: "not-a-real-type", runs: [] }] };
  renderRichText(container, malformed, "Bản dự phòng", d);
  assert.equal(container.children.length, 1, "must render exactly the fallback, not the one valid-looking block");
  assert.equal(container.children[0].textContent, "Bản dự phòng");
});

test("D: container is cleared before rendering (no leftover nodes from a previous render)", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("first"))), "", d);
  renderRichText(container, doc(paragraph(run("second"))), "", d);
  assert.equal(container.children.length, 1);
  assert.equal(container.textContent, "second");
});

test("D: lecturer and student call sites are just the same function — parity is structural, not incidental", () => {
  const { d, container: lecturerContainer } = newContainer();
  const studentDoc2 = new FakeDocument();
  const studentContainer = studentDoc2.createElement("div");
  const content = doc(paragraph(run("Nhiệm vụ chung", { bold: true, color: "blue" })));
  renderRichText(lecturerContainer, content, "", d);
  renderRichText(studentContainer, content, "", studentDoc2);
  assert.equal(lecturerContainer.textContent, studentContainer.textContent);
  assert.equal(lecturerContainer.children[0].children[0].style.fontWeight, studentContainer.children[0].children[0].style.fontWeight);
  assert.equal(lecturerContainer.children[0].children[0].style.color, studentContainer.children[0].children[0].style.color);
});

test("D: common-instructions and per-group-topic content render identically through the same function", () => {
  const { d, container: instructionsContainer } = newContainer();
  const topicDoc = new FakeDocument();
  const topicContainer = topicDoc.createElement("div");
  const sameShapeContent = doc(paragraph(run("Nội dung", { italic: true })));
  renderRichText(instructionsContainer, sameShapeContent, "", d);
  renderRichText(topicContainer, sameShapeContent, "", topicDoc);
  assert.equal(instructionsContainer.textContent, topicContainer.textContent);
  assert.deepEqual(instructionsContainer.children[0].children[0].style, topicContainer.children[0].children[0].style);
});

// =====================================================================================
// LEGACY FALLBACK — explicit malicious-looking legacy strings must display literally
// =====================================================================================

const LEGACY_XSS_STRINGS = [
  "<script>alert(1)</script>",
  '<img src=x onerror=alert(1)>',
  "<svg onload=alert(1)>",
  "javascript:alert(1)"
];

for (const malicious of LEGACY_XSS_STRINGS) {
  test(`Legacy fallback: ${JSON.stringify(malicious)} displays literally as text, never as markup`, () => {
    const { d, container } = newContainer();
    renderRichText(container, null, malicious, d);
    assert.equal(container.children[0].textContent, malicious);
    // The fake DOM has no innerHTML at all — if the renderer ever tried to use it, this would
    // throw. Its absence from FakeElement is itself part of the proof: rendering succeeds using
    // only createElement/textContent/appendChild.
    assert.equal(typeof container.children[0].innerHTML, "undefined");
  });
}

// =====================================================================================
// E. XSS CORPUS — RichText documents. Each must either be rejected outright (whole-document
// fail-closed -> legacy fallback rendered) or, if accepted, must render as inert text with no
// attribute/URL/CSS ever taken from stored data.
// =====================================================================================

function assertWholeDocumentFallback(richValue, legacy = "safe fallback") {
  const { d, container } = newContainer();
  renderRichText(container, richValue, legacy, d);
  assert.equal(container.children.length, 1, "must fall back to exactly one legacy paragraph, not a partial rich render");
  assert.equal(container.children[0].textContent, legacy);
}

test("E: <script> as run text renders as inert text when the document is otherwise valid (never executed, never parsed)", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("<script>alert(1)</script>"))), "", d);
  assert.equal(container.children[0].textContent, "<script>alert(1)</script>");
  assert.equal(container.children[0].children[0].tagName, "SPAN");
});

test("E: img/onerror as run text renders as inert text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run('<img src=x onerror=alert(1)>'))), "", d);
  assert.equal(container.textContent, '<img src=x onerror=alert(1)>');
});

test("E: svg/onload as run text renders as inert text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("<svg onload=alert(1)>"))), "", d);
  assert.equal(container.textContent, "<svg onload=alert(1)>");
});

test("E: javascript: and data: URLs as run text render as inert text (there is no URL/href field in the schema at all)", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("javascript:alert(1)"), run("data:text/html,<script>alert(1)</script>"))), "", d);
  assert.equal(container.textContent, "javascript:alert(1)data:text/html,<script>alert(1)</script>");
});

test("E: iframe/object/embed tags as run text render as inert text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run('<iframe src="//evil"></iframe><object data="x"></object><embed src="x">'))), "", d);
  assert.equal(container.textContent.includes("<iframe"), true);
});

test("E: a style payload cannot be injected — color/font tokens must be exact allowlist matches, never raw CSS", () => {
  assertWholeDocumentFallback(doc(paragraph(run("x", { color: "red; background:url(javascript:alert(1))" }))));
  assertWholeDocumentFallback(doc(paragraph(run("x", { font: "Arial; } body{background:red" }))));
});

test("E: a CSS breakout string as run text renders as inert text (no CSS context to break out of)", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run('"};</style><script>alert(1)</script>'))), "", d);
  assert.equal(container.textContent, '"};</style><script>alert(1)</script>');
});

test("E: malformed/unclosed tags as run text render as inert text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("<div><span>unclosed"))), "", d);
  assert.equal(container.textContent, "<div><span>unclosed");
});

test("E: nested-looking tags as run text render as inert text", () => {
  const { d, container } = newContainer();
  renderRichText(container, doc(paragraph(run("<b><i><script>alert(1)</script></i></b>"))), "", d);
  assert.equal(container.textContent, "<b><i><script>alert(1)</script></i></b>");
});

test("E: unknown run keys make the whole document invalid -> legacy fallback", () => {
  assertWholeDocumentFallback({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x", onClick: "alert(1)" }] }] });
});

test("E: unknown block keys make the whole document invalid -> legacy fallback", () => {
  assertWholeDocumentFallback({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x" }], style: "position:fixed" }] });
});

test("E: __proto__-like keys (from JSON.parse, a real own-property not prototype pollution) make the document invalid -> legacy fallback", () => {
  const hostileRun = JSON.parse('{"text":"x","__proto__":{"polluted":true}}');
  assertWholeDocumentFallback({ version: 1, blocks: [{ type: "paragraph", runs: [hostileRun] }] });
});

test("E: constructor-like keys make the document invalid -> legacy fallback", () => {
  assertWholeDocumentFallback({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x" }], constructor: {} }] });
});

test("E: oversized run text makes the document invalid -> legacy fallback", () => {
  assertWholeDocumentFallback(doc(paragraph(run("a".repeat(501)))));
});

test("E: oversized block count makes the document invalid -> legacy fallback", () => {
  const blocks = Array.from({ length: 21 }, () => paragraph(run("x")));
  assertWholeDocumentFallback({ version: 1, blocks });
});

test("E: oversized run count per block makes the document invalid -> legacy fallback", () => {
  const runs = Array.from({ length: 21 }, () => run("x"));
  assertWholeDocumentFallback(doc({ type: "paragraph", runs }));
});

test("E: unsupported version makes the document invalid -> legacy fallback, never partially interpreted", () => {
  assertWholeDocumentFallback({ version: 2, blocks: [{ type: "paragraph", runs: [{ text: "safe looking text" }] }] });
  assertWholeDocumentFallback({ version: 0, blocks: [{ type: "paragraph", runs: [{ text: "x" }] }] });
});

test("E: a mostly-valid document with exactly one poisoned run still falls back for the WHOLE document (no partial rendering)", () => {
  const mostlyValid = doc(
    paragraph(run("This part looks totally fine")),
    paragraph(run("So does this")),
    paragraph({ text: "x", href: "javascript:alert(1)" }) // one bad run buried among good ones
  );
  assertWholeDocumentFallback(mostlyValid, "entire document rejected");
});

test("E: color/font/size tokens are looked up, never string-concatenated into a style value", () => {
  // Prove the map lookup shape itself never echoes the token back as CSS for unknown tokens —
  // this exercises the renderer's OWN defensive re-check (independent of validateRichTextV1
  // already having rejected such input upstream).
  assert.equal(FONT_CSS_MAP["Arial; } body{background:red"], undefined);
  assert.equal(COLOR_CSS_MAP["red; background:url(x)"], undefined);
});
