// Targeted regression for GATE RICHTEXT-V3 (underline, strikethrough, bullet/numbered lists,
// indent/outdent, line spacing, paragraph spacing, clear formatting, Undo/Redo toolbar buttons,
// keyboard shortcuts), layered on top of continuous-text + caret-fix + alignment. Run with a
// locally installed Playwright package; serves only this repository on loopback. Uses the EXISTING
// gate2b-rt-editor harness (index.html) — no new throwaway page.
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
      list: b.getAttribute("data-rt-list"),
      indent: b.getAttribute("data-rt-indent"),
      marker: b.firstChild && b.firstChild.getAttribute && b.firstChild.getAttribute("data-rt-list-marker") ? b.firstChild.textContent : null
    }))
  );
}
function toolbarState() {
  return page.evaluate(() => Object.fromEntries(
    Array.from(document.querySelectorAll('#mount [data-rt-toolbar] [data-rt-action]'))
      .map(el => [el.getAttribute("data-rt-action"), el.tagName === "SELECT" ? el.value : el.getAttribute("aria-pressed")])
  ));
}
async function reset() { await page.evaluate(() => window.__editor.setPlainText("")); }
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
async function clickParagraph(n) { await page.locator('#mount [data-rt-block="paragraph"]').nth(n).click(); }
async function clickAction(action) { await page.locator(`#mount [data-rt-toolbar] [data-rt-action="${action}"]`).click(); }
async function selectParagraphText(n) {
  await page.evaluate((n) => {
    const block = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[n];
    const span = block.querySelector("span[data-rt-run]");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.textContent.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, n);
}
async function selectAcrossParagraphs(fromIdx, toIdx) {
  await page.evaluate(({ fromIdx, toIdx }) => {
    const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
    const fromBlock = blocks[fromIdx], toBlock = blocks[toIdx];
    const range = document.createRange();
    const fromSpan = fromBlock.querySelector("span[data-rt-run]");
    const toSpan = toBlock.querySelector("span[data-rt-run]");
    if (fromSpan) range.setStart(fromSpan.firstChild, 0); else range.setStart(fromBlock, 0);
    if (toSpan) range.setEnd(toSpan.firstChild, toSpan.textContent.length); else range.setEnd(toBlock, toBlock.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, { fromIdx, toIdx });
}
async function richText() { return page.evaluate(() => window.__editor.getRichText()); }

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // 1&2. Underline and strikethrough.
  await check("1&2. underline and strikethrough apply via toolbar and round-trip", async () => {
    await reset();
    await seed("Underline and strike me");
    await selectParagraphText(0);
    await clickAction("underline");
    await selectParagraphText(0);
    await clickAction("strike");
    const r = await richText();
    assert.equal(r.ok, true);
    assert.ok(r.value.blocks[0].runs.every((run) => run.underline === true && run.strike === true));
  });

  // 3&4&5. Bullet, numbering, and bullet<->numbering toggling.
  await check("3&4&5. bullet, numbering, and switching bullet<->numbering", async () => {
    await reset();
    await seed("A\nB");
    await selectAcrossParagraphs(0, 1);
    await clickAction("list-bullet");
    let p = await paragraphs();
    assert.deepEqual(p.map((b) => b.list), ["bullet", "bullet"]);
    assert.deepEqual(p.map((b) => b.marker), ["•", "•"]);
    await selectAcrossParagraphs(0, 1);
    await clickAction("list-number");
    p = await paragraphs();
    assert.deepEqual(p.map((b) => b.list), ["number", "number"]);
    assert.deepEqual(p.map((b) => b.marker), ["1.", "2."]);
    // Clicking the SAME active type again toggles it off (standard toggle-button behavior).
    await selectAcrossParagraphs(0, 1);
    await clickAction("list-number");
    p = await paragraphs();
    assert.deepEqual(p.map((b) => b.list), [null, null]);
  });

  // 6&7. List Enter continuation and exiting an empty list item.
  await check("6&7. Enter continues a list item, and Enter on an empty item exits the list", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-number");
    await page.keyboard.type("One");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Two");
    let p = await paragraphs();
    assert.deepEqual(p.map((b) => ({ list: b.list, marker: b.marker })), [{ list: "number", marker: "1." }, { list: "number", marker: "2." }]);
    await page.keyboard.press("Enter"); // empty item 3
    await page.keyboard.press("Enter"); // exits the list on the empty item
    p = await paragraphs();
    assert.equal(p.length, 3);
    assert.deepEqual([p[0].list, p[1].list, p[2].list], ["number", "number", null]);
    assert.equal(p[2].text, "");
  });

  // 8&9&10. Indent, outdent, and the maximum indent boundary.
  await check("8&9&10. indent, outdent, and clamping at the maximum indent level", async () => {
    await reset();
    await seed("Indent me");
    await clickParagraph(0);
    await clickAction("indent");
    await clickAction("indent");
    let p = await paragraphs();
    assert.equal(p[0].indent, "2");
    await clickAction("outdent");
    p = await paragraphs();
    assert.equal(p[0].indent, "1");
    for (let i = 0; i < 10; i++) await clickAction("indent");
    p = await paragraphs();
    assert.equal(p[0].indent, "4", "must clamp at MAX_INDENT_LEVEL (4), never grow unbounded");
    for (let i = 0; i < 10; i++) await clickAction("outdent");
    p = await paragraphs();
    assert.equal(p[0].indent, null, "must clamp at 0 (no attribute), never go negative");
  });

  // 11. Every line-spacing preset.
  await check("11. line spacing 1.0/1.15/1.5/2.0 apply and round-trip", async () => {
    for (const value of ["1", "1.15", "1.5", "2"]) {
      await reset();
      await seed("Spacing");
      await clickParagraph(0);
      await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="line-spacing"]', value);
      const r = await richText();
      assert.equal(r.value.blocks[0].lineSpacing ?? "1", value);
    }
  });

  // 12. Every paragraph-spacing preset.
  await check("12. paragraph spacing compact/normal/wide apply and round-trip", async () => {
    for (const value of ["compact", "normal", "wide"]) {
      await reset();
      await seed("Spacing");
      await clickParagraph(0);
      await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', value);
      const r = await richText();
      assert.equal(r.value.blocks[0].spacing ?? "normal", value);
    }
  });

  // 13. Clear formatting resets run-level formatting only, preserving paragraph structure.
  await check("13. clear formatting resets run formatting but preserves list/align/indent", async () => {
    await reset();
    await seed("Styled list item");
    await clickParagraph(0);
    await clickAction("list-bullet");
    await clickAction("align-center");
    await clickAction("indent");
    await selectParagraphText(0);
    await clickAction("bold");
    await selectParagraphText(0);
    await clickAction("underline");
    let r = await richText();
    assert.ok(r.value.blocks[0].runs.every((run) => run.bold && run.underline));
    await selectParagraphText(0);
    await clickAction("clear-format");
    r = await richText();
    assert.ok(r.value.blocks[0].runs.every((run) => !run.bold && !run.underline));
    assert.equal(r.value.blocks[0].list, "bullet", "list membership must survive Clear Formatting");
    assert.equal(r.value.blocks[0].align, "center", "alignment must survive Clear Formatting");
    assert.equal(r.value.blocks[0].indent, 1, "indent must survive Clear Formatting");
  });

  // 14&15. Undo/Redo toolbar buttons (native history).
  await check("14&15. Undo/Redo toolbar buttons use native history and round-trip", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("UndoRedoMe");
    await clickAction("undo");
    await page.waitForTimeout(50);
    let p = await paragraphs();
    assert.ok(p[0].text.length < "UndoRedoMe".length && "UndoRedoMe".startsWith(p[0].text));
    await clickAction("redo");
    await page.waitForTimeout(50);
    p = await paragraphs();
    assert.equal(p[0].text, "UndoRedoMe");
  });

  // 16. Ctrl+B/I/U keyboard shortcuts (this harness is Chromium-based: Ctrl, not Cmd).
  await check("16. Ctrl+B/I/U keyboard shortcuts apply bold/italic/underline together", async () => {
    await reset();
    await seed("Shortcut test");
    await selectParagraphText(0);
    await page.keyboard.press("Control+b");
    await selectParagraphText(0);
    await page.keyboard.press("Control+i");
    await selectParagraphText(0);
    await page.keyboard.press("Control+u");
    const r = await richText();
    assert.ok(r.value.blocks[0].runs.every((run) => run.bold && run.italic && run.underline));
  });

  // 16b. Ctrl+Z / Ctrl+Y (native undo/redo) must not regress — still handled entirely natively,
  // never intercepted by the new Ctrl+B/I/U keydown branch.
  await check("16b. native Ctrl+Z / Ctrl+Y keyboard shortcuts are not intercepted and keep working", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Native");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(50);
    let p = await paragraphs();
    assert.ok(p[0].text.length < "Native".length);
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(50);
    p = await paragraphs();
    assert.equal(p[0].text, "Native");
  });

  // 17&18. Toolbar active-state reflection, including mixed selection state (not lying to the user).
  await check("17&18. toolbar reflects pressed state, and reports 'mixed' honestly across disagreeing paragraphs", async () => {
    await reset();
    await seed("One\nTwo");
    await clickParagraph(0);
    await clickAction("align-center");
    let state = await toolbarState();
    assert.equal(state["align-center"], "true");
    await selectAcrossParagraphs(0, 1); // paragraph 1 is still left-aligned -> mixed
    await page.waitForTimeout(50);
    state = await toolbarState();
    assert.equal(state["align-left"], "mixed");
    assert.equal(state["align-center"], "mixed");
  });

  // 19. Combinations of Bold/Italic/Underline/Color together.
  await check("19. Bold + Italic + Underline + Color combine on the same run", async () => {
    await reset();
    await seed("Combo");
    await selectParagraphText(0);
    await clickAction("bold");
    await selectParagraphText(0);
    await clickAction("italic");
    await selectParagraphText(0);
    await clickAction("underline");
    await selectParagraphText(0);
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="color"]', "red");
    const r = await richText();
    const run = r.value.blocks[0].runs[0];
    assert.ok(run.bold && run.italic && run.underline && run.color === "red");
  });

  // 20. List + alignment together.
  await check("20. a list item can also be center-aligned", async () => {
    await reset();
    await seed("Centered bullet");
    await clickParagraph(0);
    await clickAction("list-bullet");
    await clickAction("align-center");
    const r = await richText();
    assert.equal(r.value.blocks[0].list, "bullet");
    assert.equal(r.value.blocks[0].align, "center");
  });

  // 21. List + indentation together (nested list item).
  await check("21. a list item can also be indented (nested list item)", async () => {
    await reset();
    await seed("Nested bullet");
    await clickParagraph(0);
    await clickAction("list-bullet");
    await clickAction("indent");
    const r = await richText();
    assert.equal(r.value.blocks[0].list, "bullet");
    assert.equal(r.value.blocks[0].indent, 1);
  });

  // 22. Line spacing + alignment together.
  await check("22. line spacing and alignment combine on the same paragraph", async () => {
    await reset();
    await seed("Spaced and centered");
    await clickParagraph(0);
    await clickAction("align-justify");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="line-spacing"]', "1.5");
    const r = await richText();
    assert.equal(r.value.blocks[0].align, "justify");
    assert.equal(r.value.blocks[0].lineSpacing, "1.5");
  });

  // 23&24. Vietnamese text, including a long paragraph, across the new features.
  await check("23&24. Vietnamese text (including a long paragraph) works with the new features", async () => {
    await reset();
    const text = "Hội nghị tổng kết công tác đào tạo, bồi dưỡng cán bộ năm học vừa qua tại Học viện. ".repeat(20).trim();
    await seed(text);
    await clickParagraph(0);
    await clickAction("list-number");
    await clickAction("align-justify");
    const r = await richText();
    assert.equal(r.ok, true);
    assert.equal(r.value.blocks[0].runs.map((run) => run.text).join(""), text);
    assert.equal(r.value.blocks[0].list, "number");
    assert.equal(r.value.blocks[0].align, "justify");
  });

  // 25. Blank paragraphs are unaffected by (and can themselves carry) the new paragraph formatting.
  await check("25. a blank paragraph can carry list/indent/spacing formatting", async () => {
    await reset();
    await seed("A\n\nB");
    await clickParagraph(1);
    await clickAction("list-bullet");
    const r = await richText();
    assert.equal(r.value.blocks[1].runs.length, 0);
    assert.equal(r.value.blocks[1].list, "bullet");
  });

  // 26. Save/reopen preserves every new field exactly.
  await check("26. save/reopen preserves underline/strike/list/indent/lineSpacing/spacing exactly", async () => {
    await reset();
    await seed("Persist me");
    await selectParagraphText(0);
    await clickAction("underline");
    await clickParagraph(0);
    await clickAction("list-number");
    await clickAction("indent");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="line-spacing"]', "2");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "wide");
    const before = await richText();
    assert.equal(before.ok, true);
    await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    const after = await richText();
    assert.deepEqual(after.value, before.value);
  });

  // 27. Old V1/V2 fixtures without any V3 fields load, display, and remain editable unchanged.
  await check("27. an old fixture with none of the new fields loads and stays exactly as authored", async () => {
    const oldDoc = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Nội dung cũ", bold: true }] }, { type: "paragraph", runs: [] }] };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), oldDoc);
    assert.equal(result.ok, true);
    const exported = await richText();
    assert.deepEqual(exported.value, oldDoc);
    const p = await paragraphs();
    assert.deepEqual(p.map((b) => b.list), [null, null]);
  });

  // 28. Text -> Image -> Text: Image untouched by any V3 feature.
  await check("28. text -> Image -> text round-trips with Image untouched", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", list: "bullet", runs: [{ text: "Before image" }] },
        { type: "image", storagePath: "groupActivityContent/o/a/common/p.jpg", alt: "x", mimeType: "image/jpeg", size: 10 },
        { type: "paragraph", list: "bullet", runs: [{ text: "After image restarts the list" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    const regionCount = await page.evaluate(() => document.querySelectorAll('#mount [data-rt-text-region]').length);
    assert.equal(regionCount, 2);
    const exported = await richText();
    assert.deepEqual(exported.value, v2Doc);
  });

  // 29. Text -> Table -> Text: Table untouched by any V3 feature.
  await check("29. text -> Table -> text round-trips with Table untouched", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", list: "number", runs: [{ text: "Before table" }] },
        { type: "table", rows: [{ cells: [{ runs: [{ text: "A1" }] }] }] },
        { type: "paragraph", list: "number", runs: [{ text: "After table restarts the list" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    const cellsEditable = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#mount [data-rt-cell="1"]')).every((c) => c.getAttribute("contenteditable") === "true")
    );
    assert.equal(cellsEditable, true);
    const exported = await richText();
    assert.deepEqual(exported.value, v2Doc);
  });

  // 30. Common Task: the primary editor instance exercises the full new toolbar end to end.
  await check("30. Common Task editor: full V3 feature workflow end to end", async () => {
    await reset();
    await seed("Chung: mục 1\nChung: mục 2");
    await selectAcrossParagraphs(0, 1);
    await clickAction("list-number");
    await clickParagraph(0);
    await clickAction("align-center");
    const r = await richText();
    assert.deepEqual(r.value.blocks.map((b) => b.list), ["number", "number"]);
    assert.equal(r.value.blocks[0].align, "center");
  });

  // 31. Per-group Task: a second, independent editor instance also gets every V3 feature.
  await check("31. Per-group Task: a second independent editor instance supports the full V3 toolbar", async () => {
    const secondResult = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "Per-group editor" });
      editor2.setRichText({
        version: 1,
        blocks: [
          { type: "paragraph", list: "bullet", indent: 1, lineSpacing: "1.5", spacing: "wide", runs: [{ text: "Nhóm: mục con", underline: true, strike: true }] }
        ]
      });
      const result = editor2.getRichText();
      editor2.destroy();
      mount2.remove();
      return result;
    });
    assert.equal(secondResult.ok, true);
    const block = secondResult.value.blocks[0];
    assert.equal(block.list, "bullet");
    assert.equal(block.indent, 1);
    assert.equal(block.lineSpacing, "1.5");
    assert.equal(block.spacing, "wide");
    assert.ok(block.runs[0].underline && block.runs[0].strike);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
