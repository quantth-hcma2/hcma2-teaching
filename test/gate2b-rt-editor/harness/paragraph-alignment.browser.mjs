// Targeted regression for GATE RICHTEXT-ALIGN: Word-like PARAGRAPH-level alignment (left/center/
// right/justify) layered on top of the continuous-text-region candidate + first-keystroke caret
// fix. Run with a locally installed Playwright package; serves only this repository on loopback.
// Uses the EXISTING gate2b-rt-editor harness (index.html) — no new throwaway page.
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

function paragraphAligns() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#mount [data-rt-block="paragraph"]')).map(b => b.getAttribute("data-rt-align"))
  );
}
function alignButtonState() {
  return page.evaluate(() => Object.fromEntries(
    Array.from(document.querySelectorAll('#mount [data-rt-toolbar] [data-rt-action^="align-"]'))
      .map(b => [b.getAttribute("data-rt-action"), b.getAttribute("aria-pressed")])
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
async function clickParagraph(n) {
  await page.locator('#mount [data-rt-block="paragraph"]').nth(n).click();
}
async function clickAlign(align) {
  await page.locator(`#mount [data-rt-toolbar] [data-rt-action="align-${align}"]`).click();
}
// Selects from a point in paragraph `fromIdx` to a point in paragraph `toIdx` (both inclusive),
// via a real programmatic Range/Selection — the standard way these suites drive a cross-paragraph
// selection (see continuous-text.browser.mjs's own check 9).
async function selectAcrossParagraphs(fromIdx, toIdx) {
  await page.evaluate(({ fromIdx, toIdx }) => {
    const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
    const fromBlock = blocks[fromIdx], toBlock = blocks[toIdx];
    const range = document.createRange();
    const fromSpan = fromBlock.querySelector("span");
    const toSpan = toBlock.querySelector("span");
    if (fromSpan) range.setStart(fromSpan.firstChild, 0); else range.setStart(fromBlock, 0);
    if (toSpan) range.setEnd(toSpan.firstChild, toSpan.textContent.length); else range.setEnd(toBlock, toBlock.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, { fromIdx, toIdx });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // 1-4: each alignment value, applied via the toolbar, round-trips through getRichText().
  for (const align of ["left", "center", "right", "justify"]) {
    await check(`${align} paragraph: toolbar click sets it and it round-trips through getRichText()`, async () => {
      await reset();
      await seed("Đoạn văn kiểm tra căn lề");
      await clickParagraph(0);
      await clickAlign(align);
      const doms = await paragraphAligns();
      assert.equal(doms[0], align === "left" ? null : align, "DOM attribute must match (absent for left)");
      const result = await page.evaluate(() => window.__editor.getRichText());
      assert.equal(result.ok, true);
      assert.equal(result.value.blocks[0].align ?? "left", align);
      const btnState = await alignButtonState();
      assert.equal(btnState[`align-${align}`], "true", "the clicked alignment's button must show pressed");
    });
  }

  // 5. Different alignments in consecutive paragraphs within ONE text region.
  await check("5. different alignments in consecutive paragraphs within one Text Region", async () => {
    await reset();
    await seed("Tiêu đề\nNội dung một\nNội dung hai\nGhi chú");
    await clickParagraph(0); await clickAlign("center");
    await clickParagraph(1); await clickAlign("justify");
    await clickParagraph(2); await clickAlign("justify");
    await clickParagraph(3); await clickAlign("right");
    const doms = await paragraphAligns();
    assert.deepEqual(doms, ["center", "justify", "justify", "right"]);
    const regionCount = await page.evaluate(() => document.querySelectorAll('#mount [data-rt-text-region]').length);
    assert.equal(regionCount, 1, "mixed per-paragraph alignment must still share one continuous text region");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(result.value.blocks.map(b => b.align ?? "left"), ["center", "justify", "justify", "right"]);
  });

  // 6. Alignment with caret only (collapsed selection) affects only that one paragraph.
  await check("6. alignment with caret only affects just that paragraph", async () => {
    await reset();
    await seed("Một\nHai\nBa");
    await clickParagraph(1);
    await clickAlign("center");
    const doms = await paragraphAligns();
    assert.deepEqual(doms, [null, "center", null]);
  });

  // 7. Alignment across a multi-paragraph selection affects every touched paragraph.
  await check("7. alignment across a multi-paragraph selection affects all of them", async () => {
    await reset();
    await seed("Một\nHai\nBa\nBốn");
    await selectAcrossParagraphs(1, 2);
    await clickAlign("right");
    const doms = await paragraphAligns();
    assert.deepEqual(doms, [null, "right", "right", null]);
  });

  // 8. Mixed selection -> applying one alignment makes all selected paragraphs use it.
  await check("8. mixed-alignment selection converges to one alignment on click", async () => {
    await reset();
    await seed("Một\nHai\nBa");
    await clickParagraph(0); await clickAlign("left");
    await clickParagraph(1); await clickAlign("center");
    await clickParagraph(2); await clickAlign("right");
    let doms = await paragraphAligns();
    assert.deepEqual(doms, [null, "center", "right"], "precondition: mixed alignment across the three paragraphs");
    await selectAcrossParagraphs(0, 2);
    // selectionchange fires asynchronously; give the editor's own listener a tick to refresh the
    // toolbar before reading its state (the alignment APPLICATION path below re-reads the live
    // Selection directly and is unaffected by this timing).
    await page.waitForTimeout(50);
    const btnStateBefore = await alignButtonState();
    assert.equal(btnStateBefore["align-left"], "mixed");
    await clickAlign("justify");
    doms = await paragraphAligns();
    assert.deepEqual(doms, ["justify", "justify", "justify"]);
  });

  // 9. Blank paragraph alignment.
  await check("9. a blank paragraph can be aligned", async () => {
    await reset();
    await seed("Trước");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // leaves a blank paragraph between
    await clickParagraph(1); // the blank one
    await clickAlign("center");
    const doms = await paragraphAligns();
    assert.equal(doms[1], "center");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.value.blocks[1].runs.length, 0, "still a blank paragraph");
    assert.equal(result.value.blocks[1].align, "center");
  });

  // 10. Enter inheritance: a new paragraph split from an aligned one starts with the same alignment.
  await check("10. Enter inherits the alignment of the paragraph it split from", async () => {
    await reset();
    await seed("Tiêu đề căn giữa");
    await clickParagraph(0);
    await clickAlign("center");
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Dòng tiếp theo");
    const doms = await paragraphAligns();
    assert.deepEqual(doms, ["center", "center"], "the newly split paragraph must start Center too");
    // User can then choose a different alignment for just the new paragraph.
    await clickAlign("left");
    const after = await paragraphAligns();
    assert.deepEqual(after, ["center", null]);
  });

  // 11. Save/reopen preserves per-paragraph alignment exactly.
  await check("11. save/reopen preserves per-paragraph alignment", async () => {
    await reset();
    await seed("A\nB\nC");
    await clickParagraph(0); await clickAlign("center");
    await clickParagraph(2); await clickAlign("justify");
    const before = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(before.ok, true);
    await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    const after = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(after.value, before.value);
    const doms = await paragraphAligns();
    assert.deepEqual(doms, ["center", null, "justify"]);
  });

  // 12. An existing paragraph without `align` behaves exactly as before — default left, no attribute.
  await check("12. an existing paragraph without align loads as left with no DOM attribute", async () => {
    const legacyDoc = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Nội dung cũ chưa có align" }] }] };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), legacyDoc);
    assert.equal(result.ok, true);
    const doms = await paragraphAligns();
    assert.deepEqual(doms, [null]);
    await clickParagraph(0);
    const btnState = await alignButtonState();
    assert.equal(btnState["align-left"], "true");
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(exported.value, legacyDoc, "no align key must be introduced for an untouched legacy paragraph");
  });

  // 13. Invalid alignment value fails safe (never silently accepted, never crashes).
  await check("13. an invalid alignment value fails closed on export", async () => {
    await reset();
    await seed("X");
    await page.evaluate(() => {
      const block = document.querySelector('#mount [data-rt-block="paragraph"]');
      block.setAttribute("data-rt-align", "javascript:alert(1)");
    });
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, false, "a tampered/invalid align token must fail closed, not be silently accepted");
    // The direct-contract-level check (same allow-list) for completeness:
    const directCheckOk = await page.evaluate(async () => {
      const mod = await import("/rich-text-contract.mjs");
      return mod.validateRichTextV1({ version: 1, blocks: [{ type: "paragraph", align: "center; }</style><script>", runs: [] }] });
    });
    assert.equal(directCheckOk, false);
  });

  // 14. Bold/italic/font/color formatting and alignment coexist on the same paragraph.
  await check("14. bold/italic/font/color + alignment together", async () => {
    await reset();
    await seed("Định dạng đầy đủ");
    await selectAcrossParagraphs(0, 0);
    await page.locator('#mount [data-rt-toolbar] [data-rt-action="bold"]').click();
    await page.locator('#mount [data-rt-toolbar] [data-rt-action="italic"]').click();
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="font"]', "times");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="color"]', "blue");
    await clickParagraph(0);
    await clickAlign("right");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    const block = result.value.blocks[0];
    assert.equal(block.align, "right");
    assert.ok(block.runs.every(r => r.bold === true && r.italic === true && r.font === "times" && r.color === "blue"));
  });

  // 15. Vietnamese text with alignment.
  await check("15. Vietnamese text aligns and round-trips correctly", async () => {
    await reset();
    const text = "Học viện Chính trị khu vực — nội dung tiếng Việt có dấu đầy đủ";
    await seed(text);
    await clickParagraph(0);
    await clickAlign("center");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.value.blocks[0].align, "center");
    assert.equal(result.value.blocks[0].runs.map(r => r.text).join(""), text);
  });

  // 16. A long justified Vietnamese paragraph.
  await check("16. a long justified Vietnamese paragraph stays correct", async () => {
    await reset();
    const text = "Nội dung hướng dẫn chi tiết cho hoạt động thảo luận nhóm của lớp học phần này. ".repeat(40).trim();
    await seed(text);
    await clickParagraph(0);
    await clickAlign("justify");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(result.ok, true);
    assert.equal(result.value.blocks[0].align, "justify");
    assert.equal(result.value.blocks[0].runs.map(r => r.text).join(""), text);
  });

  // 17. Text -> Image -> aligned Text: alignment on paragraphs around an Image block, Image unchanged.
  await check("17. text -> Image -> aligned text round-trips with Image untouched", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", align: "center", runs: [{ text: "Trước ảnh, căn giữa" }] },
        { type: "image", storagePath: "groupActivityContent/owner1/act1/common/pic.jpg", alt: "Mô tả", mimeType: "image/jpeg", size: 12345 },
        { type: "paragraph", align: "justify", runs: [{ text: "Sau ảnh, căn đều" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    const regionCount = await page.evaluate(() => document.querySelectorAll('#mount [data-rt-text-region]').length);
    assert.equal(regionCount, 2);
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(exported.value, v2Doc);
  });

  // 18. Text -> Table -> aligned Text: alignment on paragraphs around a Table block, Table unchanged.
  await check("18. text -> Table -> aligned text round-trips with Table untouched", async () => {
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", align: "right", runs: [{ text: "Trước bảng, căn phải" }] },
        { type: "table", rows: [{ cells: [{ runs: [{ text: "A1" }] }, { runs: [{ text: "B1" }] }] }] },
        { type: "paragraph", align: "center", runs: [{ text: "Sau bảng, căn giữa" }] }
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    const cellsEditable = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#mount [data-rt-cell="1"]')).every(c => c.getAttribute("contenteditable") === "true")
    );
    assert.equal(cellsEditable, true);
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(exported.value, v2Doc);
  });

  // 19. Common Task: the primary mounted editor (General Task uses this same class/instance shape).
  await check("19. Common Task editor: full alignment workflow end to end", async () => {
    await reset();
    await seed("Chung: Tiêu đề\nChung: Nội dung");
    await clickParagraph(0); await clickAlign("center");
    await clickParagraph(1); await clickAlign("justify");
    const result = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(result.value.blocks.map(b => b.align ?? "left"), ["center", "justify"]);
  });

  // 20. Per-group Task: a second, independent editor instance also gets alignment.
  await check("20. Per-group Task: a second independent editor instance supports alignment too", async () => {
    const secondResult = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "Per-group editor" });
      editor2.setRichText({
        version: 1,
        blocks: [
          { type: "paragraph", align: "center", runs: [{ text: "Nhóm: Tiêu đề" }] },
          { type: "paragraph", runs: [{ text: "Nhóm: Nội dung" }] }
        ]
      });
      const doms = Array.from(mount2.querySelectorAll('[data-rt-block="paragraph"]')).map(b => b.getAttribute("data-rt-align"));
      // Exercise the toolbar directly on this second instance too.
      const secondParagraph = mount2.querySelectorAll('[data-rt-block="paragraph"]')[1];
      secondParagraph.closest('[data-rt-text-region]').focus();
      const range = document.createRange();
      range.selectNodeContents(secondParagraph);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      mount2.querySelector('[data-rt-toolbar] [data-rt-action="align-right"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      mount2.querySelector('[data-rt-toolbar] [data-rt-action="align-right"]').click();
      const result = editor2.getRichText();
      editor2.destroy();
      mount2.remove();
      return { doms, resultOk: result.ok, aligns: result.value.blocks.map(b => b.align ?? "left") };
    });
    assert.deepEqual(secondResult.doms, ["center", null]);
    assert.equal(secondResult.resultOk, true);
    assert.deepEqual(secondResult.aligns, ["center", "right"]);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
