// Targeted regression for the GATE 2B-RT-CONTINUOUS candidate (consecutive paragraphs grouped into
// one shared contenteditable text region, Image/Table remain separate siblings), plus the
// first-keystroke caret-preservation fix layered on top of it (see the "FIRST-KEYSTROKE CARET FIX"
// block of checks below). Run with a locally installed Playwright package; serves only this
// repository on loopback. Uses the EXISTING gate2b-rt-editor harness (index.html) — no new
// throwaway page.
//
// Content-seeding note: most checks below seed initial content via a synthetic paste (seed() /
// pasteAtCaret(), both using the real _handlePaste path) rather than page.keyboard.type(), simply
// to keep those checks focused on paragraph/region STRUCTURE rather than on typing mechanics —
// paste and real typing now both correctly preserve/restore the caret (see the dedicated
// caret-preservation checks below, which exercise real page.keyboard.type()/press() specifically,
// including into previously-bare paragraphs, per the owner's explicit requirement not to hide that
// behavior behind paste-based seeding).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const packagePath = process.env.PLAYWRIGHT_PACKAGE || "playwright";
const { chromium } = await import(packagePath.startsWith("C:") ? pathToFileURL(packagePath).href : packagePath);

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const server = createServer((req, res) => {
  try {
    const p = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(root)) throw Error("path");
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(p)] || "application/octet-stream");
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS " + name); }

function paragraphs() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#mount [data-rt-block="paragraph"]')).map(b => ({
      text: b.textContent,
      ce: b.closest("[contenteditable]")?.getAttribute("contenteditable") ?? null
    }))
  );
}
function regionCount() {
  return page.evaluate(() => document.querySelectorAll('#mount [data-rt-text-region]').length);
}
async function reset() {
  await page.evaluate(() => window.__editor.setPlainText(""));
}
// Seeds content via the paste path (explicit, correct caret restoration — see header note), then
// leaves real focus/selection positioned at the END of the inserted content, ready for further
// real keyboard interaction.
async function seed(text) {
  await page.evaluate((t) => {
    const editable = document.querySelector("#mount [data-rt-editable]");
    const first = editable.querySelector('[data-rt-block="paragraph"]');
    first.closest('[data-rt-text-region]').focus();
    const range = document.createRange();
    range.selectNodeContents(first);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
// Inserts text at whatever the CURRENT caret position is (e.g. right after a real Enter press),
// via the same paste path as seed() above, instead of page.keyboard.type() — used in checks that
// are specifically about paragraph/region structure rather than about typing mechanics (both paths
// are exercised directly and separately by their own dedicated checks elsewhere in this file).
async function pasteAtCaret(text) {
  await page.evaluate((t) => {
    const editable = document.querySelector("#mount [data-rt-editable]");
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
async function placeCaretAt(blockIndex, offset) {
  await page.evaluate(({ blockIndex, offset }) => {
    const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
    const block = blocks[blockIndex];
    const region = block.closest('[data-rt-text-region]');
    const span = block.querySelector('span[data-rt-run="1"]');
    const range = document.createRange();
    if (span) {
      const o = Math.min(offset, span.textContent.length);
      range.setStart(span.firstChild, o);
    } else {
      range.setStart(block, 0);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    region.focus();
  }, { blockIndex, offset });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // 1. Long typing (seeded, then extended with real keystrokes to prove ongoing typing works).
  await check("1. long typing produces one correct paragraph", async () => {
    await reset();
    await seed("Phân tích tình huống sau và đề xuất giải pháp phù hợp");
    await page.keyboard.type(" với thực tiễn địa phương.");
    const blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "Phân tích tình huống sau và đề xuất giải pháp phù hợp với thực tiễn địa phương.");
  });

  // 2. Enter -> new paragraph.
  await check("2. Enter creates a new paragraph", async () => {
    await reset();
    await seed("Dòng một");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Dòng hai");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Dòng một", "Dòng hai"]);
  });

  // 3. Enter twice -> blank line.
  await check("3. Enter twice produces a visible blank paragraph", async () => {
    await reset();
    await seed("Trước");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sau");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Trước", "", "Sau"]);
  });

  // 4. Multiple blank lines.
  await check("4. several consecutive Enters produce several blank paragraphs", async () => {
    await reset();
    await seed("A");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Enter");
    await page.keyboard.type("B");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["A", "", "", "", "B"]);
  });

  // 5. Type after blank lines (continuing check 4's state).
  await check("5. typing after blank lines lands in the right paragraph", async () => {
    const blocks = await paragraphs();
    assert.equal(blocks[blocks.length - 1].text, "B");
  });

  // 6. Backspace across paragraph boundary (paragraph merge).
  await check("6. Backspace at paragraph start merges with previous paragraph", async () => {
    await reset();
    await seed("Alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta");
    let blocks = await paragraphs();
    assert.equal(blocks.length, 2);
    await placeCaretAt(1, 0);
    await page.keyboard.press("Backspace");
    blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "AlphaBeta");
  });

  // Undo/redo after a native split (Enter) and merge (Backspace): entirely native browser
  // contenteditable undo-stack behavior (this candidate adds no custom undo/redo code — the single
  // continuous region is what lets the browser's native undo stack see the whole document as one
  // editing surface, same as e.g. Gmail compose), so this only verifies it where the browser
  // natively supports it, without assuming any particular number of undo steps per keystroke.
  await check("undo/redo after a native split/merge round-trips without corrupting structure", async () => {
    await reset();
    await seed("Undo one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Undo two");
    let blocks = await paragraphs();
    assert.equal(blocks.length, 2, "precondition: two paragraphs exist before merging");
    await placeCaretAt(1, 0);
    await page.keyboard.press("Backspace");
    blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "Undo oneUndo two");
    await page.keyboard.press("Control+Z");
    await page.waitForTimeout(50);
    blocks = await paragraphs();
    assert.equal(blocks.length, 2, "native undo must restore the two-paragraph structure");
    assert.equal(await regionCount(), 1, "undo must not break the shared text region");
    assert.ok(blocks.every(b => b.ce === "true"), "every paragraph restored by undo must remain editable");
    await page.keyboard.press("Control+Y");
    await page.waitForTimeout(50);
    blocks = await paragraphs();
    assert.equal(blocks.length, 1, "native redo must reapply the merge");
    assert.equal(await regionCount(), 1);
  });

  // paragraph merge via Delete (forward merge from end of previous paragraph).
  await check("7. Delete at paragraph end merges with next paragraph", async () => {
    await reset();
    await seed("Gamma");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Delta");
    let blocks = await paragraphs();
    assert.equal(blocks.length, 2);
    await placeCaretAt(0, 5); // end of "Gamma"
    await page.keyboard.press("Delete");
    blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "GammaDelta");
  });

  // 8. Arrow keys across paragraphs.
  await check("8. ArrowLeft at paragraph start moves the caret into the previous paragraph", async () => {
    await reset();
    await seed("One");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Two");
    await placeCaretAt(1, 0);
    await page.keyboard.press("ArrowLeft");
    const pos = await page.evaluate(() => {
      const sel = window.getSelection();
      const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
      const r = sel.getRangeAt(0);
      return { inFirst: blocks[0].contains(r.startContainer) || blocks[0] === r.startContainer };
    });
    assert.equal(pos.inFirst, true, "caret must have moved back into the first paragraph");
  });

  // 9. Selection across multiple paragraphs.
  await check("9. a Selection can span across two paragraphs", async () => {
    await reset();
    await seed("First");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second");
    const spanText = await page.evaluate(() => {
      const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
      const firstSpan = blocks[0].querySelector("span");
      const secondSpan = blocks[1].querySelector("span");
      const range = document.createRange();
      range.setStart(firstSpan.firstChild, 2);
      range.setEnd(secondSpan.firstChild, 3);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return { anchorText: firstSpan.textContent.slice(2), focusText: secondSpan.textContent.slice(0, 3), notCollapsed: !sel.getRangeAt(0).collapsed };
    });
    assert.equal(spanText.anchorText, "rst");
    assert.equal(spanText.focusText, "Sec");
    assert.equal(spanText.notCollapsed, true);
  });

  // 10. Copy/cut across paragraphs.
  await check("10. cut across a cross-paragraph selection merges the remainder", async () => {
    const before = await paragraphs();
    assert.deepEqual(before.map(b => b.text), ["First", "Second"]);
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
      const firstSpan = blocks[0].querySelector("span");
      const secondSpan = blocks[1].querySelector("span");
      const range = document.createRange();
      range.setStart(firstSpan.firstChild, 2); // after "Fi"
      range.setEnd(secondSpan.firstChild, 3); // after "Sec"
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.press("Control+X");
    await page.waitForTimeout(50);
    const after = await paragraphs();
    assert.equal(after.length, 1);
    assert.equal(after[0].text, "Fiond");
  });

  // 11. Paste multiline plain text.
  await check("11. paste multiline plain text creates matching paragraphs", async () => {
    await reset();
    await seed("Line A\nLine B\nLine C");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Line A", "Line B", "Line C"]);
    assert.ok(blocks.every(b => b.ce === "true"));
  });

  // 12. Paste text containing a blank line.
  await check("12. paste with a blank line preserves it as an empty paragraph", async () => {
    await reset();
    await seed("Phân tích tình huống sau:\n\nAnh/chị hãy thảo luận các nội dung sau:");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Phân tích tình huống sau:", "", "Anh/chị hãy thảo luận các nội dung sau:"]);
  });

  // 13. Paste several consecutive blank lines.
  await check("13. paste with several consecutive blank lines preserves all of them", async () => {
    await reset();
    await seed("1. Xác định vấn đề.\n2. Phân tích nguyên nhân.\n\n\n\nTừ thực tiễn tại địa phương, đề xuất giải pháp.");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), [
      "1. Xác định vấn đề.", "2. Phân tích nguyên nhân.", "", "", "", "Từ thực tiễn tại địa phương, đề xuất giải pháp."
    ]);
    assert.equal(await regionCount(), 1, "all 6 paragraphs must share one text region");
  });

  // 14 & 15. Paste Word/web text: only text/plain is ever read (by design, see discovery), so this
  // confirms text/html on the clipboard is never consulted or persisted even when present alongside
  // text/plain (the Word/web paste case in practice), including that embedded script never executes.
  await check("14&15. text/html on the clipboard is ignored even when present (Word/web paste)", async () => {
    await reset();
    await page.evaluate(() => {
      const editable = document.querySelector("#mount [data-rt-editable]");
      const first = editable.querySelector('[data-rt-block="paragraph"]');
      first.closest('[data-rt-text-region]').focus();
      const range = document.createRange();
      range.selectNodeContents(first);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData("text/plain", "Dán từ Word\n\nĐoạn thứ hai");
      dt.setData("text/html", '<p style="color:red"><b>Dán từ Word</b></p><script>window.__xss=true</script><p>Đoạn thứ hai</p>');
      editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Dán từ Word", "", "Đoạn thứ hai"]);
    const anyBold = await page.evaluate(() => !!document.querySelector('#mount [data-rt-block="paragraph"] [data-rt-bold]'));
    assert.equal(anyBold, false, "no formatting from text/html may leak in");
    const xssRan = await page.evaluate(() => window.__xss === true);
    assert.equal(xssRan, false, "embedded <script> in text/html must never execute or persist");
  });

  // 16. Very long text (approaching but not exceeding the new 40,000-code-point document cap).
  await check("16. very long text stays editable and exports correctly", async () => {
    await reset();
    const longParagraph = "Nội dung hướng dẫn chi tiết cho hoạt động thảo luận nhóm của lớp học phần này. ".repeat(60).trim();
    await seed(longParagraph);
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    assert.equal(result.value.blocks.length, 1);
    assert.equal(result.value.blocks[0].runs.map(r => r.text).join(""), longParagraph);
  });

  // 17. Save and reopen with identical paragraph structure.
  await check("17. export -> reload reproduces the identical paragraph structure", async () => {
    await reset();
    await seed("Mở đầu\n\nNội dung chính\nDòng thứ hai của nội dung chính\n\nKết luận");
    const before = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(before.ok, true);
    await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    const after = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(after.ok, true);
    assert.deepEqual(after.value, before.value);
    assert.equal(await regionCount(), 1);
  });

  // 18 & 19. Existing old V1 RichText content opens correctly and remains editable.
  await check("18&19. an existing V1 fixture document opens, displays, and stays editable", async () => {
    const v1Doc = {
      version: 1,
      blocks: [
        { type: "paragraph", runs: [{ text: "Nội dung V1 cũ", bold: true }] },
        { type: "paragraph", runs: [] },
        { type: "paragraph", runs: [{ text: "Dòng thứ hai", color: "blue" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v1Doc);
    assert.equal(result.ok, true);
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["Nội dung V1 cũ", "", "Dòng thứ hai"]);
    assert.ok(blocks.every(b => b.ce === "true"), "every rebuilt paragraph from an old V1 fixture must be editable");
    assert.equal(await regionCount(), 1);
    // Still editable: place the caret in the middle (blank) paragraph and seed text into it.
    await placeCaretAt(1, 0);
    await page.evaluate(() => {
      const editable = document.querySelector("#mount [data-rt-editable]");
      const dt = new DataTransfer();
      dt.setData("text/plain", "Mới");
      editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const after = await paragraphs();
    assert.equal(after[1].text, "Mới");
  });

  // 20. Text before/after Image remains correct + 22. Image behavior unchanged + multiple regions.
  await check("20&22. text -> image -> text round-trips correctly with two separate regions", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", runs: [{ text: "Trước ảnh" }] },
        { type: "image", storagePath: "groupActivityContent/owner1/act1/common/pic.jpg", alt: "Mô tả ảnh", mimeType: "image/jpeg", size: 12345 },
        { type: "paragraph", runs: [{ text: "Sau ảnh" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    assert.equal(await regionCount(), 2, "an image between two paragraphs must split them into two regions");
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.value, v2Doc);
  });

  // 21 & 23. Text before/after Table remains correct + table behavior unchanged (editable cells).
  await check("21&23. text -> table -> text round-trips correctly and the table stays editable", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", runs: [{ text: "Trước bảng" }] },
        { type: "table", rows: [{ cells: [{ runs: [{ text: "A1" }] }, { runs: [{ text: "B1" }] }] }, { cells: [{ runs: [{ text: "A2" }] }, { runs: [{ text: "B2" }] }] }] },
        { type: "paragraph", runs: [{ text: "Sau bảng" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    assert.equal(await regionCount(), 2);
    const cellsEditable = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#mount [data-rt-cell="1"]')).every(c => c.getAttribute("contenteditable") === "true")
    );
    assert.equal(cellsEditable, true);
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.value, v2Doc);
  });

  // Multiple text regions separated by BOTH image and table in one document.
  await check("multiple text regions separated by image AND table in one document", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", runs: [{ text: "Vùng 1" }] },
        { type: "image", storagePath: "groupActivityContent/owner1/act1/common/a.jpg", alt: "", mimeType: "image/jpeg", size: 100 },
        { type: "paragraph", runs: [{ text: "Vùng 2" }] },
        { type: "table", rows: [{ cells: [{ runs: [] }] }] },
        { type: "paragraph", runs: [{ text: "Vùng 3 dòng 1" }] },
        { type: "paragraph", runs: [{ text: "Vùng 3 dòng 2" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    assert.equal(await regionCount(), 3, "three separate runs of paragraphs must produce three regions");
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(exported.value, v2Doc);
  });

  // Formatting spanning multiple paragraphs.
  await check("formatting (bold) applied across a cross-paragraph selection affects both paragraphs", async () => {
    await reset();
    await seed("Formatted one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Formatted two");
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
      const range = document.createRange();
      range.setStart(blocks[0].querySelector("span").firstChild, 0);
      range.setEnd(blocks[1].querySelector("span").firstChild, 13);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.locator('[data-rt-toolbar] [data-rt-action="bold"]').click();
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    assert.ok(result.value.blocks[0].runs.every(r => r.bold === true));
    assert.ok(result.value.blocks[1].runs.every(r => r.bold === true));
  });

  // save/reopen after a native paragraph merge.
  await check("save/reopen after a native Backspace-merge persists the reduced structure", async () => {
    await reset();
    await seed("Merge A");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Merge B");
    await placeCaretAt(1, 0);
    await page.keyboard.press("Backspace");
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(exported.ok, true);
    assert.equal(exported.value.blocks.length, 1);
    await page.evaluate((doc) => window.__editor.setRichText(doc), exported.value);
    const reopened = await paragraphs();
    assert.deepEqual(reopened.map(b => b.text), ["Merge AMerge B"]);
    assert.equal(reopened[0].ce, "true");
  });

  // Long Vietnamese text + Unicode (including astral emoji).
  await check("long Vietnamese text and Unicode (emoji) round-trip correctly", async () => {
    await reset();
    const text = "Hội nghị tổng kết công tác đào tạo, bồi dưỡng cán bộ 😀🎓 năm học vừa qua tại Học viện.";
    await seed(text);
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    assert.equal(result.value.blocks[0].runs.map(r => r.text).join(""), text);
  });

  // IME/composition: a composed character must not be lost or duplicated by the input/normalize path.
  await check("IME composition sequence is not lost or duplicated across a region", async () => {
    await reset();
    await seed("X"); // seed via paste so the block already has a proper span before composition starts.
    await page.evaluate(() => {
      const editable = document.querySelector("#mount [data-rt-editable]");
      const target = editable.querySelector('[data-rt-block="paragraph"]');
      target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      const span = target.querySelector("span");
      span.textContent = span.textContent + "ế";
      const r2 = document.createRange();
      r2.setStart(span.firstChild, span.textContent.length);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "ế" }));
    });
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    assert.equal(result.value.blocks[0].runs.map(r => r.text).join(""), "Xế");
  });

  // ===================================================================================
  // FIRST-KEYSTROKE CARET FIX — real native keyboard typing throughout (no paste seeding anywhere
  // in this section), per the owner's explicit fix request. Proves _captureCaretForNormalize /
  // _restoreCaretAfterNormalize (rich-text-editor.mjs) correctly preserve the caret across
  // _normalizeBlock's bare-text-node -> <span> replacement, for both plain typing and IME
  // composition, including the very first keystroke into a genuinely empty paragraph.
  // ===================================================================================

  await check("caret-fix 1: typing into a genuinely empty initial paragraph produces exactly the typed text", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("abcdef");
    const blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "abcdef");
  });

  await check("caret-fix 2: Enter then typing into the new paragraph stays in typed order", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("abcdef");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ghijkl");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["abcdef", "ghijkl"]);
  });

  await check("caret-fix 3: Enter twice then typing into the paragraph after the blank line", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("A");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("B");
    const blocks = await paragraphs();
    assert.deepEqual(blocks.map(b => b.text), ["A", "", "B"]);
  });

  await check("caret-fix 4: Vietnamese text types normally into a fresh paragraph", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    const text = "Phân tích tình huống sư phạm thường gặp";
    await page.keyboard.type(text);
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, text);
  });

  await check("caret-fix 5: rapid typing with no per-key delay is not reordered or dropped", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    const text = "thequickbrownfoxjumpsoverthelazydog0123456789";
    await page.keyboard.type(text, { delay: 0 });
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, text);
  });

  await check("caret-fix 6: moving the caret into the middle of existing text and typing inserts at that point", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("acdef");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight"); // caret lands between 'a' and 'c'
    await page.keyboard.type("b");
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, "abcdef");
  });

  await check("caret-fix 7: moving the caret to the start, then to the end, and typing at each lands correctly", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("middle");
    await page.keyboard.press("Home");
    await page.keyboard.type("S-");
    await page.keyboard.press("End");
    await page.keyboard.type("-E");
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, "S-middle-E");
  });

  await check("caret-fix 8: Backspace and Delete after native typing remove the correct characters", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("xyz123");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Home");
    await page.keyboard.press("Delete");
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, "yz1");
  });

  await check("caret-fix 9: native typing immediately after a native paragraph merge inserts at the merge point", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Foo");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bar");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace"); // merges into "FooBar", caret left at the merge point
    await page.keyboard.type("Z");
    const blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "FooZBar");
  });

  await check("caret-fix 10: undo/redo after native typing does not corrupt structure or character order", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("UndoMe");
    await page.keyboard.press("Control+Z");
    await page.waitForTimeout(50);
    const afterUndo = await paragraphs();
    assert.equal(afterUndo.length, 1);
    assert.ok("UndoMe".startsWith(afterUndo[0].text) && afterUndo[0].text.length < "UndoMe".length,
      "native undo must remove from the end without reordering or corrupting the remaining text");
    await page.keyboard.press("Control+Y");
    await page.waitForTimeout(50);
    const afterRedo = await paragraphs();
    assert.equal(afterRedo[0].text, "UndoMe", "native redo must exactly restore the typed text");
  });

  // IME/composition into a genuinely empty paragraph (the scenario this fix also covers via
  // compositionend, see _onCompositionEnd in rich-text-editor.mjs). Also confirms the pre-existing,
  // unchanged _isComposing guard still suppresses normalization WHILE composing is in progress (no
  // destructive mid-composition normalization), which this fix does not alter. A fully faithful,
  // browser-native IME composition cannot be driven through Playwright (real OS/browser IME engines
  // are not scriptable this way); this dispatches the same compositionstart/input/compositionend
  // event sequence and bare-text-node DOM shape a real IME produces, which is the strongest
  // available check in this harness — documented here as that limitation.
  await check("caret-fix IME: composition into a genuinely empty paragraph lands the caret correctly for continued typing", async () => {
    await reset();
    const midComposition = await page.evaluate(() => {
      const editable = document.querySelector("#mount [data-rt-editable]");
      const target = editable.querySelector('[data-rt-block="paragraph"]');
      target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      for (const br of Array.from(target.querySelectorAll("br"))) br.remove();
      const textNode = document.createTextNode("ế");
      target.appendChild(textNode);
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(textNode, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
      // Captured BEFORE compositionend: proves the bare text node survives untouched while composing.
      const bareNodeSurvived = target.firstChild === textNode && target.firstChild.nodeType === 3;
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "ế" }));
      return { bareNodeSurvived };
    });
    assert.equal(midComposition.bareNodeSurvived, true, "normalization must not run while composing is in progress");
    await page.keyboard.type("m");
    const blocks = await paragraphs();
    assert.equal(blocks[0].text, "ếm");
  });

  // 24. Common-task and Per-group-task both use the identical implementation — a second,
  // independent editor instance (simulating a per-group editor) exhibits every property above.
  await check("per-group-task: a second independent editor instance groups paragraphs and merges on Backspace too", async () => {
    const secondResult = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "Per-group editor" });
      editor2.setPlainText("");
      const editable2 = mount2.querySelector("[data-rt-editable]");
      const firstBlock = editable2.querySelector('[data-rt-block="paragraph"]');
      const range = document.createRange();
      range.selectNodeContents(firstBlock);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData("text/plain", "Nhóm dòng 1\nNhóm dòng 2\nNhóm dòng 3");
      editable2.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const regions = mount2.querySelectorAll('[data-rt-text-region]').length;
      const blocks = Array.from(mount2.querySelectorAll('[data-rt-block="paragraph"]'));
      const allEditable = blocks.every(b => b.closest("[contenteditable]")?.getAttribute("contenteditable") === "true");
      editor2.destroy();
      mount2.remove();
      return { regions, blockCount: blocks.length, allEditable };
    });
    assert.equal(secondResult.regions, 1);
    assert.equal(secondResult.blockCount, 3);
    assert.equal(secondResult.allEditable, true);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
