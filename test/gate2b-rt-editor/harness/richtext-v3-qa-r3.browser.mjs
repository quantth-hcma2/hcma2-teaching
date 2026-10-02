// Targeted regression for GATE RICHTEXT-V3-QA-R3 — owner retest of the frozen QA-R2 candidate
// (154af88) reported Issue A (document writing inset) as STILL not resolved from a UX
// standpoint: R2 only widened the gap between the OUTER editor frame ([data-rt-editable]) and
// the visible Text block border (the [data-rt-text-region]:focus inset box-shadow) — it never put
// any space between that border and the first character/caret INSIDE it, because the region
// itself carried zero padding of its own. Root cause confirmed by direct geometry measurement:
// gap(region border -> first char) was exactly 0px on R2. Fix: a small, purely-visual horizontal
// padding (0 8px) added directly on [data-rt-text-region] in both index.html and this harness's
// index.html — an "inner caret/text gutter" nested INSIDE the region's own border, independent of
// R1/R2's outer [data-rt-editable] inset. This is NOT paragraph indent: no contract field is
// written or read by this change; it is pure CSS on the region element. The list-marker gutter
// (R2's position:absolute marker + paragraph-level padding-left) and the indent margin-left both
// continue to apply on top of this new base gutter, on the paragraph element, unaffected by where
// the region's own box starts. Run with a locally installed Playwright package; serves only this
// repository on loopback. Uses the EXISTING gate2b-rt-editor harness (index.html).
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

async function reset() { await page.evaluate(() => window.__editor.setPlainText("")); }
async function richText() { return page.evaluate(() => window.__editor.getRichText()); }

// Measures, for the paragraph at blockIndex, the horizontal distance between its own
// [data-rt-text-region]'s border and the first (or last, with fromRight) visible character --
// the exact geometry the owner is judging ("is the caret/first character visibly inside the
// Text block's own border, not touching it").
async function measureInnerGutter(blockIndex, { fromRight = false } = {}) {
  await page.locator('#mount [data-rt-block="paragraph"]').nth(blockIndex).click();
  return page.evaluate(({ blockIndex, fromRight }) => {
    const block = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[blockIndex];
    const region = block.closest('[data-rt-text-region]');
    const span = block.querySelector('span[data-rt-run]');
    const regionRect = region.getBoundingClientRect();
    const r = document.createRange();
    if (fromRight) {
      r.setStart(span.firstChild, span.firstChild.length - 1);
      r.setEnd(span.firstChild, span.firstChild.length);
    } else {
      r.setStart(span.firstChild, 0);
      r.setEnd(span.firstChild, 1);
    }
    const charRect = r.getBoundingClientRect();
    const marker = block.querySelector('[data-rt-list-marker]');
    const markerRect = marker ? marker.getBoundingClientRect() : null;
    return {
      gapFromRegionLeft: +(charRect.left - regionRect.left).toFixed(2),
      gapFromRegionRight: +(regionRect.right - charRect.right).toFixed(2),
      regionLeft: regionRect.left,
      regionRight: regionRect.right,
      charLeft: charRect.left,
      markerOverlapsChar: markerRect ? markerRect.right > charRect.left : null,
      markerInsideRegion: markerRect ? (markerRect.left >= regionRect.left && markerRect.right <= regionRect.right) : null,
    };
  }, { blockIndex, fromRight });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  await check("R3-1. [data-rt-text-region] carries the exact, deliberate inner gutter (6-10px range)", async () => {
    await reset();
    const paddingLeft = await page.evaluate(() => {
      const region = document.querySelector('#mount [data-rt-text-region]');
      return parseFloat(getComputedStyle(region).paddingLeft);
    });
    assert.ok(paddingLeft >= 6 && paddingLeft <= 10, `expected the region's own inner gutter to be in the 6-10px range, measured ${paddingLeft}px`);
  });

  await check("R3-2. Left paragraph: first character is visibly inside the Text block border (6-10px), not touching it", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", align: "left", runs: [{ text: "Left aligned text" }] }] }));
    const geo = await measureInnerGutter(0);
    assert.ok(geo.gapFromRegionLeft >= 6 && geo.gapFromRegionLeft <= 10, `expected 6-10px inner gutter, measured ${geo.gapFromRegionLeft}px`);
  });

  await check("R3-3. Justified paragraph: identical inner gutter to Left (same base content origin)", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [
      { type: "paragraph", align: "left", runs: [{ text: "Left aligned text" }] },
      { type: "paragraph", align: "justify", runs: [{ text: "Justified text that wraps across more than one line to prove the gutter holds for every wrapped line of a justified paragraph as well." }] }
    ]}));
    const left = await measureInnerGutter(0);
    const justify = await measureInnerGutter(1);
    assert.ok(justify.gapFromRegionLeft >= 6 && justify.gapFromRegionLeft <= 10, `expected 6-10px inner gutter, measured ${justify.gapFromRegionLeft}px`);
    assert.equal(justify.gapFromRegionLeft, left.gapFromRegionLeft, "Left and Justify must share the identical inner gutter");
  });

  await check("R3-4. Right paragraph: identical inner gutter mirrored on the right edge", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", align: "right", runs: [{ text: "Right text" }] }] }));
    const geo = await measureInnerGutter(0, { fromRight: true });
    assert.ok(geo.gapFromRegionRight >= 6 && geo.gapFromRegionRight <= 10, `expected 6-10px inner gutter from the right border, measured ${geo.gapFromRegionRight}px`);
  });

  await check("R3-5. Center paragraph still renders correctly (no regression) and stays within the region's bounds", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", align: "center", runs: [{ text: "Center text" }] }] }));
    const geo = await measureInnerGutter(0);
    assert.ok(geo.gapFromRegionLeft > 10, "centered text must sit well clear of the inner gutter, not pinned to it like Left/Justify");
    assert.ok(geo.charLeft >= geo.regionLeft, "centered text must never render to the left of its own region's border");
  });

  await check("R3-6. Bullet: inner gutter + marker gutter stack correctly, no overlap, marker stays inside the region", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 2, blocks: [{ type: "paragraph", list: "bullet", runs: [{ text: "Bullet item" }] }] }));
    const geo = await measureInnerGutter(0);
    assert.equal(geo.gapFromRegionLeft, 32, `expected base inner gutter (8) + list marker gutter (24) = 32, measured ${geo.gapFromRegionLeft}`);
    assert.equal(geo.markerOverlapsChar, false, "the list marker must never overlap the first character");
    assert.equal(geo.markerInsideRegion, true, "the list marker must stay entirely within the region's own bounds");
  });

  await check("R3-7. Number: inner gutter + marker gutter stack correctly, no overlap, marker stays inside the region", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 2, blocks: [{ type: "paragraph", list: "number", runs: [{ text: "Number item" }] }] }));
    const geo = await measureInnerGutter(0);
    assert.equal(geo.gapFromRegionLeft, 32, `expected base inner gutter (8) + list marker gutter (24) = 32, measured ${geo.gapFromRegionLeft}`);
    assert.equal(geo.markerOverlapsChar, false, "the list marker must never overlap the first character");
    assert.equal(geo.markerInsideRegion, true, "the list marker must stay entirely within the region's own bounds");
  });

  await check("R3-8. Indent level 1 stacks the indent margin on top of the base inner gutter, not replacing it", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", indent: 1, runs: [{ text: "Indented text" }] }] }));
    const geo = await measureInnerGutter(0);
    assert.equal(geo.gapFromRegionLeft, 32, `expected base inner gutter (8) + indent level 1 (24) = 32, measured ${geo.gapFromRegionLeft}`);
  });

  await check("R3-9. Clicking immediately before the first character of a Left paragraph places the caret at offset 0", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Left aligned text" }] }] }));
    await page.locator('#mount [data-rt-block="paragraph"]').nth(0).click();
    const clickPoint = await page.evaluate(() => {
      const block = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[0];
      const span = block.querySelector('span[data-rt-run]');
      const r = document.createRange();
      r.setStart(span.firstChild, 0); r.setEnd(span.firstChild, 0);
      const rect = r.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(clickPoint.x + 1, clickPoint.y);
    const sel = await page.evaluate(() => ({ offset: window.getSelection().anchorOffset, text: window.getSelection().anchorNode.textContent }));
    assert.equal(sel.offset, 0, "clicking right before the first character must place the caret at offset 0");
    assert.equal(sel.text, "Left aligned text");
  });

  await check("R3-10. Clicking immediately before the first character of a Justified paragraph places the caret at offset 0", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", align: "justify", runs: [{ text: "Justified text that wraps across more than one line to test the click target." }] }] }));
    await page.locator('#mount [data-rt-block="paragraph"]').nth(0).click();
    const clickPoint = await page.evaluate(() => {
      const block = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[0];
      const span = block.querySelector('span[data-rt-run]');
      const r = document.createRange();
      r.setStart(span.firstChild, 0); r.setEnd(span.firstChild, 0);
      const rect = r.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(clickPoint.x + 1, clickPoint.y);
    const sel = await page.evaluate(() => window.getSelection().anchorOffset);
    assert.equal(sel, 0, "clicking right before the first character of a justified paragraph must place the caret at offset 0");
  });

  await check("R3-11. Image/Table are structurally outside every text region and receive none of its new padding", async () => {
    await reset();
    const v2Doc = {
      version: 2,
      blocks: [
        { type: "paragraph", runs: [{ text: "Before" }] },
        { type: "image", storagePath: "groupActivityContent/owner1/act1/common/pic.jpg", alt: "x", mimeType: "image/jpeg", size: 100 },
        { type: "paragraph", runs: [{ text: "Middle" }] },
        { type: "table", rows: [{ cells: [{ runs: [{ text: "a" }] }, { runs: [{ text: "b" }] }] }] },
        { type: "paragraph", runs: [{ text: "After" }] },
      ]
    };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), v2Doc);
    assert.equal(result.ok, true);
    const out = await page.evaluate(() => {
      const img = document.querySelector('#mount [data-rt-block="image"]');
      const tbl = document.querySelector('#mount [data-rt-block="table"]');
      const regions = document.querySelectorAll('#mount [data-rt-text-region]');
      const inAnyRegion = (el) => Array.from(regions).some(r => el && r.contains(el));
      return {
        imgInsideAnyRegion: inAnyRegion(img),
        tblInsideAnyRegion: inAnyRegion(tbl),
        imgPaddingLeft: img ? getComputedStyle(img).paddingLeft : null,
        tblPaddingLeft: tbl ? getComputedStyle(tbl).paddingLeft : null,
      };
    });
    assert.equal(out.imgInsideAnyRegion, false, "an image block must never be a descendant of a text region");
    assert.equal(out.tblInsideAnyRegion, false, "a table block must never be a descendant of a text region");
    assert.equal(out.imgPaddingLeft, "0px", "the new region-level gutter must never leak onto an image block");
    assert.equal(out.tblPaddingLeft, "0px", "the new region-level gutter must never leak onto a table block");
    const exported = await page.evaluate(() => window.__editor.getRichText());
    assert.deepEqual(exported.value, v2Doc, "the document must round-trip exactly, unaffected by the purely-visual CSS change");
  });

  await check("R3-12. A normal paragraph with no explicit indent still serializes with indent absent (purely visual change, no contract write)", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Plain paragraph" }] }] }));
    const r = await richText();
    assert.equal(r.value.blocks[0].indent, undefined, "indent must stay absent — this fix must never write a persisted indent field");
    assert.equal("indent" in r.value.blocks[0], false);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
