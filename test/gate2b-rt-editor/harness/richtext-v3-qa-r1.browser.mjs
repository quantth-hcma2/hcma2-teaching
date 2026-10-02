// Targeted regression for GATE RICHTEXT-V3-QA-R1 — the owner's 3 manual-QA findings on the frozen
// V3 candidate (502c178): (1) editor-surface left padding too tight for comfortable caret
// placement, (2) Undo/Redo toolbar buttons not reliably useful in real editing, (3) paragraph
// spacing ("Tùy chọn đoạn") had no visible effect in the live editor. Run with a locally installed
// Playwright package; serves only this repository on loopback. Uses the EXISTING gate2b-rt-editor
// harness (index.html) — no new throwaway page.
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
    Array.from(document.querySelectorAll('#mount [data-rt-block="paragraph"]')).map(b => ({ text: b.textContent, indent: b.getAttribute("data-rt-indent") }))
  );
}
async function reset() { await page.evaluate(() => window.__editor.setPlainText("")); }
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
async function richText() { return page.evaluate(() => window.__editor.getRichText()); }
// Debounced typing-history commits settle 500ms after the last keystroke — _undo()/_redo()
// themselves flush synchronously, but checks that read toolbar/button STATE right after typing
// (rather than calling Undo) need to wait the debounce out first.
async function settleDebounce() { await page.waitForTimeout(600); }

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // ===================================================================================
  // ISSUE 1 — editor-surface left padding
  // ===================================================================================

  await check("1. editor surface has comfortable left padding, and it is never persisted or treated as data-rt-indent", async () => {
    await reset();
    const paddingLeft = await page.evaluate(() => {
      const editable = document.querySelector('#mount [data-rt-editable]');
      return parseFloat(getComputedStyle(editable).paddingLeft);
    });
    assert.ok(paddingLeft >= 16, `expected comfortable left padding (>=16px), got ${paddingLeft}px`);
    const p = await paragraphs();
    assert.equal(p[0].indent, null, "editor-surface padding must never be confused with paragraph data-rt-indent");
    const r = await richText();
    assert.equal(Object.prototype.hasOwnProperty.call(r.value.blocks[0], "indent"), false, "the padding must never be serialized into the stored contract");
  });

  // ===================================================================================
  // ISSUES 2 — Undo/Redo actually works, for every V3 formatting action
  // ===================================================================================

  await check("2. type -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Hello World");
    await clickAction("undo");
    let p = await paragraphs();
    assert.ok(p[0].text.length < "Hello World".length && "Hello World".startsWith(p[0].text));
    await clickAction("redo");
    p = await paragraphs();
    assert.equal(p[0].text, "Hello World");
  });

  await check("3. toolbar format (Bold) -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Bold me");
    await selectParagraphText(0);
    await clickAction("bold");
    let r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, true);
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, undefined);
    assert.equal(r.value.blocks[0].runs[0].text, "Bold me", "text itself must survive the undo");
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, true);
  });

  await check("4. alignment -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Align me");
    await clickAction("align-center");
    let r = await richText();
    assert.equal(r.value.blocks[0].align, "center");
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].align, undefined);
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].align, "center");
  });

  await check("5. bullet list -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("List me");
    await clickAction("list-bullet");
    let r = await richText();
    assert.equal(r.value.blocks[0].list, "bullet");
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].list, undefined);
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].list, "bullet");
  });

  await check("6. indent/outdent -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Indent me");
    await clickAction("indent");
    await clickAction("indent");
    let r = await richText();
    assert.equal(r.value.blocks[0].indent, 2);
    await clickAction("undo"); // undoes the SECOND indent click (one click = one step)
    r = await richText();
    assert.equal(r.value.blocks[0].indent, 1);
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].indent, 2);
  });

  await check("7. line spacing -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Spacing");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="line-spacing"]', "1.5");
    let r = await richText();
    assert.equal(r.value.blocks[0].lineSpacing, "1.5");
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].lineSpacing, undefined);
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].lineSpacing, "1.5");
  });

  await check("8. paragraph spacing -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Spacing");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "wide");
    let r = await richText();
    assert.equal(r.value.blocks[0].spacing, "wide");
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].spacing, undefined);
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].spacing, "wide");
  });

  await check("9. Clear Formatting -> Undo -> Redo", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Clear me");
    await selectParagraphText(0);
    await clickAction("bold");
    await selectParagraphText(0);
    await clickAction("clear-format");
    let r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, undefined);
    await clickAction("undo");
    r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, true, "undo of Clear Formatting must restore the bold");
    await clickAction("redo");
    r = await richText();
    assert.equal(r.value.blocks[0].runs[0].bold, undefined);
  });

  await check("10. a new edit after Undo discards the Redo branch", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("AAA");
    await clickAction("undo");
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("BBB");
    await settleDebounce();
    const redoDisabled = await page.evaluate(() => document.querySelector('#mount [data-rt-toolbar] [data-rt-action="redo"]').disabled);
    assert.equal(redoDisabled, true, "typing a new edit after Undo must clear the stale Redo branch");
    const r = await richText();
    assert.equal(r.value.blocks[0].runs[0].text, "BBB");
  });

  await check("11. Common Task and Per-group Task editors maintain fully independent Undo/Redo histories", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("CommonTaskText");
    const result = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "Per-group editor" });
      const firstBlock = mount2.querySelector('[data-rt-block="paragraph"]');
      firstBlock.closest('[data-rt-text-region]').focus();
      const range = document.createRange();
      range.selectNodeContents(firstBlock);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData("text/plain", "PerGroupText");
      mount2.querySelector("[data-rt-editable]").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const beforeUndo = editor2.getRichText().value.blocks[0].runs[0]?.text;
      editor2._undo();
      const afterUndoRuns = editor2.getRichText().value.blocks[0].runs.length;
      editor2.destroy();
      mount2.remove();
      return { beforeUndo, afterUndoRuns };
    });
    assert.equal(result.beforeUndo, "PerGroupText");
    assert.equal(result.afterUndoRuns, 0, "the second instance's own undo must have no run text left");
    // Undoing the second (now-destroyed) instance must never have touched the Common Task editor.
    const commonStillIntact = await richText();
    assert.equal(commonStillIntact.value.blocks[0].runs[0].text, "CommonTaskText");
  });

  await check("history bound: a long typing burst does not grow history unboundedly, and undo/redo keep working after it", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    // Many separate discrete toolbar actions (each its own immediate history entry) to exercise
    // the bounded ring without waiting on real wall-clock time for 100+ debounce cycles.
    for (let i = 0; i < 120; i++) {
      await clickAction(i % 2 === 0 ? "align-center" : "align-left");
    }
    const historyIsBounded = await page.evaluate(() => window.__editor._history.length <= window.__editor._historyMax);
    assert.equal(historyIsBounded, true, "history must never grow past _historyMax");
    await clickAction("undo");
    await clickAction("redo");
    const r = await richText();
    assert.ok(r.ok, "editor must remain functional after many history entries and an undo/redo");
  });

  // ===================================================================================
  // ISSUE 3 — paragraph spacing ("Tùy chọn đoạn") has a visible, distinguishable effect
  // ===================================================================================

  await check("12. Gọn/Bình thường/Rộng produce measurably different rendered spacing in the live editor", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    const margins = {};
    for (const [value, label] of [["compact", "compact"], ["normal", "normal"], ["wide", "wide"]]) {
      await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', value);
      margins[label] = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#mount [data-rt-block="paragraph"]')).marginBottom));
    }
    assert.ok(margins.compact < margins.normal, `compact (${margins.compact}px) must be visibly smaller than normal (${margins.normal}px)`);
    assert.ok(margins.normal < margins.wide, `normal (${margins.normal}px) must be visibly smaller than wide (${margins.wide}px)`);
    assert.ok(margins.wide - margins.compact >= 8, "the full compact-to-wide range must be clearly perceptible (>=8px), not a subtle/invisible difference");
  });

  await check("12b. paragraph spacing works for caret-only AND a multi-paragraph selection, on normal and already-aligned paragraphs, and on a list item", async () => {
    await reset();
    await page.evaluate(() => window.__editor.setRichText({
      version: 1,
      blocks: [
        { type: "paragraph", runs: [{ text: "Plain" }] },
        { type: "paragraph", align: "center", runs: [{ text: "Aligned" }] },
        { type: "paragraph", list: "bullet", runs: [{ text: "Listed" }] }
      ]
    }));
    // Caret-only on the plain paragraph.
    await page.locator('#mount [data-rt-block="paragraph"]').nth(0).click();
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "wide");
    let r = await richText();
    assert.equal(r.value.blocks[0].spacing, "wide");
    assert.equal(r.value.blocks[1].spacing, undefined, "only the touched paragraph changes");
    // Multi-paragraph selection across the aligned + list paragraphs.
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('#mount [data-rt-block="paragraph"]');
      const range = document.createRange();
      const fromSpan = blocks[1].querySelector('span[data-rt-run]');
      const toSpan = blocks[2].querySelector('span[data-rt-run]');
      range.setStart(fromSpan.firstChild, 0);
      range.setEnd(toSpan.firstChild, toSpan.textContent.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "compact");
    r = await richText();
    assert.equal(r.value.blocks[1].spacing, "compact");
    assert.equal(r.value.blocks[1].align, "center", "alignment must be unaffected by a spacing change");
    assert.equal(r.value.blocks[2].spacing, "compact");
    assert.equal(r.value.blocks[2].list, "bullet", "list membership must be unaffected by a spacing change");
  });

  await check("13. paragraph spacing survives serialize/save/reopen", async () => {
    await reset();
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("Persisted spacing");
    await page.selectOption('#mount [data-rt-toolbar] [data-rt-action="spacing"]', "compact");
    const before = await richText();
    assert.equal(before.value.blocks[0].spacing, "compact");
    await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    const after = await richText();
    assert.deepEqual(after.value, before.value);
    const marginAfterReopen = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#mount [data-rt-block="paragraph"]')).marginBottom));
    assert.ok(marginAfterReopen > 0 && marginAfterReopen < 8, `"compact" must still render its own smaller margin (<8px, the "normal" default) after reopen, got ${marginAfterReopen}px`);
  });

  await check("14. an old document with no spacing field renders with the SAME default margin as before this fix, unchanged", async () => {
    await reset();
    const oldDoc = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Old content, no spacing field" }] }] };
    const result = await page.evaluate((doc) => window.__editor.setRichText(doc), oldDoc);
    assert.equal(result.ok, true);
    const exported = await richText();
    assert.deepEqual(exported.value, oldDoc, "no spacing key must be introduced for an untouched legacy paragraph");
    const marginPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#mount [data-rt-block="paragraph"]')).marginBottom));
    // "normal" = 0.5em; at the harness's 16px base font that is exactly 8px — the same default
    // spacing paragraphs have always rendered with (pre-dating this fix), confirming backward
    // compatibility of the VISUAL result, not merely the stored contract.
    assert.ok(Math.abs(marginPx - 8) < 1, `expected the unchanged default ~8px margin, got ${marginPx}px`);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
