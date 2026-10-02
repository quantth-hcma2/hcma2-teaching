// Targeted regression for GATE RICHTEXT-V3-QA-R2 — two related owner-reported defects on the
// frozen QA-R1 candidate (c0546f3): (A) the editor's writing inset was still too tight for
// comfortable caret placement at the true start of a Left/Justify paragraph, and (B) — the
// critical defect — applying Bullet/Number to a paragraph containing multiple differently-
// formatted inline runs broke the paragraph's natural text flow (each run became an independent
// block-level box via `display:flex` blockifying every flex-item child), making the sentence
// visually fragment/wrap at formatting boundaries instead of flowing as one continuous paragraph.
// Root cause and fix for both: see rich-text-editor-serializer.mjs's createListMarkerElement /
// renormalizeListMarkers doc comments and rich-text-renderer.mjs's matching change — the list
// marker is now taken out of flow via position:absolute in a reserved padding-left gutter, so the
// paragraph's `display` is never touched and every run span stays plain inline content, list or
// not. Run with a locally installed Playwright package; serves only this repository on loopback.
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

async function reset() { await page.evaluate(() => window.__editor.setPlainText("")); }
async function richText() { return page.evaluate(() => window.__editor.getRichText()); }
async function clickAction(action) { await page.locator(`#mount [data-rt-toolbar] [data-rt-action="${action}"]`).click(); }

// The structural (DOM-level) invariant this whole gate exists to protect: every run span
// belonging to a paragraph must be display:inline (never block/flex-item-blockified), a direct
// child of exactly that ONE paragraph block (never promoted to a sibling block of it), in
// original document order, with no block-level element ever inserted between two run spans of the
// same paragraph. This is the dev/test helper the task asked for ("add a development/test helper
// if useful to assert this invariant").
async function assertParagraphRunInvariant(blockIndex = 0) {
  const result = await page.evaluate((idx) => {
    const block = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[idx];
    const runs = Array.from(block.querySelectorAll('span[data-rt-run]'));
    const directChildren = Array.from(block.childNodes).filter(n => n.nodeType === 1 && n.getAttribute && n.getAttribute('data-rt-run') === '1');
    return {
      blockDisplay: getComputedStyle(block).display,
      allRunsAreDirectChildren: runs.length === directChildren.length && runs.every((r, i) => r === directChildren[i]),
      allRunsInline: runs.every(r => getComputedStyle(r).display === "inline"),
      noBlockLevelSiblingBetweenRuns: (() => {
        // Walk block's children in order; once we've seen the (optional) marker, every remaining
        // child up to the end must be either a run span or (at most one, trailing) <br> — never
        // another DIV/P or any other block-level element wedged between run spans.
        for (const child of block.childNodes) {
          if (child.nodeType !== 1) continue;
          const isMarker = child.getAttribute('data-rt-list-marker') === '1';
          const isRun = child.getAttribute('data-rt-run') === '1';
          const isBr = child.tagName === 'BR';
          if (!isMarker && !isRun && !isBr) return false;
        }
        return true;
      })(),
      runCount: runs.length
    };
  }, blockIndex);
  assert.equal(result.blockDisplay, "block", "a paragraph's own display must never become flex/grid/etc — see this file's header comment");
  assert.equal(result.allRunsAreDirectChildren, true, "every run span must be a direct child of its one paragraph, never nested inside another wrapper or promoted elsewhere");
  assert.equal(result.allRunsInline, true, "every run span must stay display:inline, list or not — the exact invariant GATE RICHTEXT-V3-QA-R2 exists to protect");
  assert.equal(result.noBlockLevelSiblingBetweenRuns, true, "no block-level element may ever sit between two run spans of the same paragraph");
  return result;
}

async function paragraphText(n = 0) {
  return page.evaluate((idx) => document.querySelectorAll('#mount [data-rt-block="paragraph"]')[idx].textContent.replace(/^[•\d.]*/, "").trim(), n);
}

async function setOneSentenceWithFormatting(runs) {
  await reset();
  await page.evaluate((r) => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", runs: r }] }), runs);
}

const SENTENCE = "Anh chi hay phan tich nguyen nhan va de xuat giai phap phu hop cho tinh huong tren";

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // ===================================================================================
  // ISSUE A — document writing inset (measured geometry, not just "CSS contains padding")
  // ===================================================================================

  await check("A1. Left and Justify paragraphs share the same, clearly visible content origin", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [
      { type: "paragraph", runs: [{ text: "Left text" }] },
      { type: "paragraph", align: "justify", runs: [{ text: "Justify text that is long enough to wrap across more than one line in this narrow width." }] }
    ]}));
    const mountX = await page.evaluate(() => document.querySelector('#mount').getBoundingClientRect().x);
    const [leftX, justifyX] = await Promise.all([0, 1].map((n) => page.evaluate((idx) => {
      const span = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[idx].querySelector('span[data-rt-run]');
      const r = document.createRange();
      r.setStart(span.firstChild, 0); r.setEnd(span.firstChild, 1);
      return r.getBoundingClientRect().x;
    }, n)));
    assert.equal(leftX, justifyX, "Left and Justify must use the identical content origin");
    const inset = leftX - mountX;
    assert.ok(inset >= 20, `expected a deliberate document-writing inset (>=20px), measured ${inset}px`);
  });

  await check("A2. caret at character offset 0 is visibly inside the editable area, comfortably clickable", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Click near my start" }] }] }));
    const geo = await page.evaluate(() => {
      const editable = document.querySelector('#mount [data-rt-editable]');
      const span = document.querySelector('#mount [data-rt-block="paragraph"] span[data-rt-run]');
      const er = editable.getBoundingClientRect();
      const r = document.createRange();
      r.setStart(span.firstChild, 0); r.setEnd(span.firstChild, 1);
      const cr = r.getBoundingClientRect();
      return { editableLeft: er.left, charLeft: cr.left, gap: cr.left - er.left };
    });
    assert.ok(geo.gap >= 20, `expected a comfortable click-before-first-character margin (>=20px), measured ${geo.gap}px`);
  });

  await check("A3. a bullet/number marker fits entirely inside the editable content area", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 2, blocks: [{ type: "paragraph", list: "number", runs: [{ text: "Item" }] }] }));
    const geo = await page.evaluate(() => {
      const editable = document.querySelector('#mount [data-rt-editable]').getBoundingClientRect();
      const marker = document.querySelector('#mount [data-rt-list-marker]').getBoundingClientRect();
      return { editableLeft: editable.left, editableRight: editable.right, markerLeft: marker.left, markerRight: marker.right };
    });
    assert.ok(geo.markerLeft >= geo.editableLeft && geo.markerRight <= geo.editableRight, "marker must sit entirely within the editable's own bounds");
  });

  await check("A4. user Indent level 1 visibly starts beyond the normal document inset", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 1, blocks: [
      { type: "paragraph", runs: [{ text: "Base" }] },
      { type: "paragraph", indent: 1, runs: [{ text: "Indented" }] }
    ]}));
    const [baseX, indentedX] = await Promise.all([0, 1].map((n) => page.evaluate((idx) => {
      const span = document.querySelectorAll('#mount [data-rt-block="paragraph"]')[idx].querySelector('span[data-rt-run]');
      const r = document.createRange(); r.setStart(span.firstChild, 0); r.setEnd(span.firstChild, 1);
      return r.getBoundingClientRect().x;
    }, n)));
    assert.ok(indentedX > baseX, `indent level 1 (x=${indentedX}) must start to the right of the base document inset (x=${baseX})`);
  });

  await check("A5. Image/Table never inherit paragraph indentation, but share the same base document inset", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({ version: 2, blocks: [
      { type: "paragraph", runs: [{ text: "Base" }] },
      { type: "image", storagePath: "groupActivityContent/o/a/common/p.jpg", alt: "", mimeType: "image/jpeg", size: 10 }
    ]}));
    const info = await page.evaluate(() => {
      const img = document.querySelector('#mount [data-rt-block="image"]');
      const para = document.querySelector('#mount [data-rt-block="paragraph"]');
      return { imgLeft: img.getBoundingClientRect().left, imgMarginLeft: getComputedStyle(img).marginLeft, imgHasIndentAttr: img.hasAttribute("data-rt-indent"), paraLeft: para.getBoundingClientRect().left };
    });
    assert.equal(info.imgHasIndentAttr, false, "an image block must never carry a data-rt-indent attribute");
    assert.equal(info.imgMarginLeft, "0px", "an image block must never inherit a paragraph's indent margin-left");
    assert.equal(info.imgLeft, info.paraLeft, "image and paragraph must still share the SAME base document inset");
  });

  await check("A6. Common Task and Per-group Task editors apply the identical CSS writing inset", async () => {
    // Compares the actual applied CSS padding (what determines the inset) directly, rather than a
    // derived pixel offset from two different container contexts — the latter can differ by a
    // sub-pixel due to each container's own unrelated border/margin, which is not what this check
    // is about (both instances share the exact same [data-rt-editable] CSS rule either way).
    await reset();
    const padding1 = await page.evaluate(() => getComputedStyle(document.querySelector('#mount [data-rt-editable]')).paddingLeft);
    const padding2 = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "second" });
      const result = getComputedStyle(mount2.querySelector('[data-rt-editable]')).paddingLeft;
      editor2.destroy();
      mount2.remove();
      return result;
    });
    assert.equal(padding1, padding2, "the two editor instances must apply the exact same writing-inset CSS");
  });

  // ===================================================================================
  // ISSUE B — the owner's exact reproduction workflow, with DOM/layout assertions, not just JSON
  // ===================================================================================

  await check("B1. one sentence, no formatting -> Bullet: still one paragraph, text unchanged", async () => {
    await setOneSentenceWithFormatting([{ text: SENTENCE }]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].list, "bullet");
  });

  await check("B2. Bold a middle phrase -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1, "must still be exactly one paragraph — not fragmented");
    assert.equal(r.value.blocks[0].runs.map(ru => ru.text).join(""), SENTENCE);
  });

  await check("B3. Underline a middle phrase -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay phan tich nguyen nhan va " }, { text: "de xuat giai phap", underline: true }, { text: " phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
  });

  await check("B4. Bold + Underline on different phrases -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va " }, { text: "de xuat giai phap", underline: true }, { text: " phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].runs.filter(ru => ru.bold).length, 1);
    assert.equal(r.value.blocks[0].runs.filter(ru => ru.underline).length, 1);
  });

  await check("B5. Bold + color + underline on one phrase -> Numbering", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true, underline: true, color: "red" }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-number");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].list, "number");
  });

  await check("B6. multiple adjacent formatted runs -> Numbering", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich", bold: true }, { text: " nguyen nhan", italic: true }, { text: " va de xuat " }, { text: "giai phap", underline: true }, { text: " phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-number");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
  });

  await check("B7. formatting at the very start of the paragraph -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay", bold: true }, { text: " phan tich nguyen nhan va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    assert.equal((await richText()).value.blocks.length, 1);
  });

  await check("B8. formatting at the very end of the paragraph -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay phan tich nguyen nhan va de xuat giai phap phu hop cho tinh huong" }, { text: " tren", underline: true }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    assert.equal((await richText()).value.blocks.length, 1);
  });

  await check("B9. formatting in the exact middle -> Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay phan tich nguyen nhan va " }, { text: "de xuat", bold: true }, { text: " giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
  });

  await check("B10. Bullet -> remove Bullet: sentence remains one paragraph, formatting intact", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await clickAction("list-bullet"); // toggles back off
    await assertParagraphRunInvariant();
    assert.equal(await paragraphText(), SENTENCE);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].list, undefined);
    assert.equal(r.value.blocks[0].runs.filter(ru => ru.bold).length, 1, "the bold formatting must survive the round trip through list-on-then-off");
  });

  await check("B11. Number -> Bullet -> normal paragraph: no run fragmentation at any step", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", underline: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-number");
    await assertParagraphRunInvariant();
    assert.equal((await richText()).value.blocks.length, 1);
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    assert.equal((await richText()).value.blocks.length, 1);
    await clickAction("list-bullet"); // off
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(await paragraphText(), SENTENCE);
  });

  await check("B12. Alignment applied AFTER inline formatting + Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await clickAction("align-center");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks[0].align, "center");
    assert.equal(r.value.blocks.length, 1);
  });

  await check("B13. Indent applied AFTER inline formatting + Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await clickAction("indent");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks[0].indent, 1);
    assert.equal(r.value.blocks.length, 1);
  });

  await check("B14. Line spacing applied AFTER inline formatting + Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", underline: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="line-spacing"]', "1.5");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks[0].lineSpacing, "1.5");
  });

  await check("B15. Paragraph spacing applied AFTER inline formatting + Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "wide");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks[0].spacing, "wide");
  });

  await check("B16. Undo/Redo the list transformation preserves run structure at every step", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    await clickAction("undo");
    await assertParagraphRunInvariant();
    assert.equal((await richText()).value.blocks[0].list, undefined);
    await clickAction("redo");
    await assertParagraphRunInvariant();
    assert.equal((await richText()).value.blocks[0].list, "bullet");
    assert.equal(await paragraphText(), SENTENCE);
  });

  await check("B17. Save -> Reload preserves run structure and formatting after Bullet", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va " }, { text: "de xuat giai phap", underline: true }, { text: " phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    const before = await richText();
    await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    await assertParagraphRunInvariant();
    const after = await richText();
    assert.deepEqual(after.value, before.value);
  });

  await check("B18. Vietnamese sentence with diacritics -> Bullet", async () => {
    const viSentence = "Anh/chị hãy phân tích nguyên nhân và đề xuất giải pháp phù hợp cho tình huống trên.";
    await setOneSentenceWithFormatting([
      { text: "Anh/chị hãy " }, { text: "phân tích nguyên nhân", bold: true }, { text: " và " }, { text: "đề xuất giải pháp", underline: true }, { text: " phù hợp cho tình huống trên." }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks[0].runs.map(ru => ru.text).join(""), viSentence);
    assert.equal(r.value.blocks.length, 1);
  });

  await check("B19. long justified Vietnamese paragraph with several differently-formatted runs -> Numbering, wraps naturally", async () => {
    const longVi = "Hội nghị tổng kết công tác đào tạo, bồi dưỡng cán bộ năm học vừa qua tại Học viện Chính trị khu vực II đã diễn ra thành công tốt đẹp với sự tham gia đông đủ của các đơn vị chức năng.";
    await setOneSentenceWithFormatting([
      { text: "Hội nghị tổng kết công tác đào tạo, " }, { text: "bồi dưỡng cán bộ", bold: true }, { text: " năm học vừa qua tại " }, { text: "Học viện Chính trị khu vực II", underline: true }, { text: " đã diễn ra thành công tốt đẹp với sự tham gia đông đủ của các đơn vị chức năng." }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("align-justify");
    await clickAction("list-number");
    const invariant = await assertParagraphRunInvariant();
    assert.ok(invariant.runCount >= 5, "the long paragraph must still have multiple distinct runs, not have been collapsed/corrupted");
    // Prove genuine inline wrapping: the paragraph must occupy MULTIPLE visual lines (a block-
    // level/flex-item-blockified run could never have a multi-line bounding box the way true
    // inline content wrapping mid-run can).
    const paraHeight = await page.evaluate(() => document.querySelector('#mount [data-rt-block="paragraph"]').getBoundingClientRect().height);
    const lineHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#mount [data-rt-block="paragraph"] span[data-rt-run]')).lineHeight) || 21);
    assert.ok(paraHeight > lineHeight * 1.5, `expected this long paragraph to wrap across multiple lines (height=${paraHeight}, ~1 line=${lineHeight})`);
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].runs.map(ru => ru.text).join(""), longVi);
  });

  await check("B20. Common Task: full owner workflow end to end", async () => {
    await setOneSentenceWithFormatting([
      { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va " }, { text: "de xuat giai phap", underline: true }, { text: " phu hop cho tinh huong tren" }
    ]);
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await clickAction("list-bullet");
    await clickAction("list-number");
    await clickAction("align-left");
    await assertParagraphRunInvariant();
    const r = await richText();
    assert.equal(r.value.blocks.length, 1);
    assert.equal(r.value.blocks[0].list, "number");
  });

  await check("B21. Per-group Task: a second independent editor instance reproduces the exact owner workflow correctly", async () => {
    const result = await page.evaluate(async (SENTENCE) => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "second" });
      editor2.setRichText({ version: 1, blocks: [{ type: "paragraph", runs: [
        { text: "Anh chi hay " }, { text: "phan tich nguyen nhan", bold: true }, { text: " va de xuat giai phap phu hop cho tinh huong tren" }
      ] }] });
      const firstBlock = mount2.querySelector('[data-rt-block="paragraph"]');
      firstBlock.closest('[data-rt-text-region]').focus();
      const range = document.createRange();
      range.selectNodeContents(firstBlock);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      mount2.querySelector('[data-rt-toolbar] [data-rt-action="list-bullet"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      mount2.querySelector('[data-rt-toolbar] [data-rt-action="list-bullet"]').click();
      const runs = Array.from(mount2.querySelectorAll('span[data-rt-run]'));
      const allInline = runs.every(r => getComputedStyle(r).display === "inline");
      const blockDisplay = getComputedStyle(firstBlock).display;
      const exported = editor2.getRichText();
      const text = exported.value.blocks[0].runs.map(r => r.text).join("");
      editor2.destroy();
      mount2.remove();
      return { allInline, blockDisplay, blocksLength: exported.value.blocks.length, textMatches: text === SENTENCE };
    }, SENTENCE);
    assert.equal(result.allInline, true);
    assert.equal(result.blockDisplay, "block");
    assert.equal(result.blocksLength, 1);
    assert.equal(result.textMatches, true);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
