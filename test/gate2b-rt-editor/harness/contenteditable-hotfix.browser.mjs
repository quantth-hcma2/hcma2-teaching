// Targeted regression for the "_insertParagraphBreakAtCaret missing contenteditable" hotfix.
// Run with a locally installed Playwright package; serves only this repository on loopback.
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

function paragraphs() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#mount [data-rt-block="paragraph"]')).map(b => ({
      contenteditable: b.getAttribute("contenteditable"),
      text: b.textContent
    }))
  );
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/gate2b-rt-editor/harness/index.html`);
  await page.waitForFunction(() => !!window.__editor);

  // 1. Empty editor: first paragraph editable.
  await check("1. empty editor: sole first paragraph is contenteditable=true", async () => {
    const blocks = await paragraphs();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].contenteditable, "true");
  });

  // 2 & 3. Enter creates new paragraphs; every one ends up contenteditable=true.
  await check("2&3. multiple real Enter presses: every resulting paragraph is contenteditable=true", async () => {
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("line one");
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Enter");
      await page.keyboard.type("line " + (i + 2));
    }
    const blocks = await paragraphs();
    assert.equal(blocks.length, 5);
    for (const b of blocks) assert.equal(b.contenteditable, "true", `block "${b.text}" must be contenteditable=true`);
  });

  // 4. Paste 20 lines -> 20/20 blocks contenteditable=true.
  await check("4. paste 20 lines: 20/20 resulting blocks are contenteditable=true", async () => {
    await page.evaluate(() => window.__editor.setPlainText(""));
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    const text = Array.from({ length: 20 }, (_, i) => "Pasted line " + (i + 1)).join("\n");
    await page.evaluate((t) => {
      const editable = document.querySelector("#mount [data-rt-editable]");
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    const blocks = await paragraphs();
    assert.equal(blocks.length, 20);
    const editableCount = blocks.filter(b => b.contenteditable === "true").length;
    assert.equal(editableCount, 20, `expected 20/20 editable, got ${editableCount}/20`);
  });

  // 5, 6, 7. Click/focus first, middle, last paragraph.
  await check("5. click/focus FIRST paragraph focuses it", async () => {
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    const active = await page.evaluate(() => document.activeElement?.getAttribute("data-rt-block"));
    assert.equal(active, "paragraph");
  });
  await check("6. click/focus MIDDLE paragraph focuses it", async () => {
    const blocks = page.locator('#mount [data-rt-block="paragraph"]');
    await blocks.nth(9).click();
    const activeText = await page.evaluate(() => document.activeElement?.textContent);
    const expectedText = await blocks.nth(9).textContent();
    assert.equal(activeText, expectedText);
    const activeAttr = await page.evaluate(() => document.activeElement?.getAttribute("data-rt-block"));
    assert.equal(activeAttr, "paragraph", "activeElement must be the clicked paragraph block itself, not body");
  });
  await check("7. click/focus LAST paragraph focuses it", async () => {
    const blocks = page.locator('#mount [data-rt-block="paragraph"]');
    await blocks.last().click();
    const activeAttr = await page.evaluate(() => document.activeElement?.getAttribute("data-rt-block"));
    assert.equal(activeAttr, "paragraph", "activeElement must be the clicked paragraph block itself, not body");
  });

  // 8. Table cells remain editable (unrelated code path, must be unaffected).
  await check("8. table cells remain contenteditable=true", async () => {
    await page.evaluate(() => window.__editor.setPlainText(""));
    await page.locator('[data-rt-toolbar] [data-rt-action="table"]').click();
    const cellStates = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#mount [data-rt-cell="1"]')).map(c => c.getAttribute("contenteditable"))
    );
    assert.equal(cellStates.length, 9);
    assert.ok(cellStates.every(c => c === "true"));
  });

  // 9 & 10. Serialization round-trip: schema unchanged, and reopening rebuilds ALL blocks editable
  // (contenteditable is DOM-only, never persisted, so a fresh setRichText load self-heals — no
  // data migration needed for existing documents with blocks created by the buggy code path).
  await check("9&10. export -> reload round-trip preserves schema and makes every rebuilt block contenteditable=true", async () => {
    await page.evaluate(() => window.__editor.setPlainText(""));
    await page.locator('#mount [data-rt-block="paragraph"]').first().click();
    await page.keyboard.type("alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("beta");
    await page.keyboard.press("Enter");
    await page.keyboard.type("gamma");
    const before = await page.evaluate(() => window.__editor.getRichText());
    assert.equal(before.ok, true);
    assert.equal(before.value.blocks.length, 3);
    assert.deepEqual(Object.keys(before.value), ["version", "blocks"]);
    for (const b of before.value.blocks) assert.deepEqual(Object.keys(b).sort(), ["runs", "type"]);

    // Reload exactly like reopening a saved document: destroy the DOM, rebuild from the exported
    // JSON only (contenteditable is never part of that JSON).
    const reloadResult = await page.evaluate((doc) => window.__editor.setRichText(doc), before.value);
    assert.equal(reloadResult.ok, true);
    const blocks = await paragraphs();
    assert.equal(blocks.length, 3);
    for (const b of blocks) assert.equal(b.contenteditable, "true");
  });

  // 11. General Task and Per-group Task share the same fix: two independent editor instances of
  // the same class both benefit, since the fix lives in the shared RichTextEditor class itself.
  await check("11. a second, independent editor instance (simulating a per-group editor) also gets the fix", async () => {
    const secondBlocks = await page.evaluate(async () => {
      const mod = await import("/rich-text-editor.mjs");
      const mount2 = document.createElement("div");
      document.body.appendChild(mount2);
      const editor2 = new mod.RichTextEditor({ container: mount2, ariaLabel: "Per-group editor" });
      const editable2 = mount2.querySelector("[data-rt-editable]");
      editable2.focus();
      const range = document.createRange();
      range.selectNodeContents(editable2.querySelector('[data-rt-block="paragraph"]'));
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData("text/plain", "group line 1\ngroup line 2\ngroup line 3");
      editable2.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const blocks = Array.from(mount2.querySelectorAll('[data-rt-block="paragraph"]')).map(b => b.getAttribute("contenteditable"));
      editor2.destroy();
      mount2.remove();
      return blocks;
    });
    assert.equal(secondBlocks.length, 3);
    assert.ok(secondBlocks.every(c => c === "true"));
  });

  assert.deepEqual(errors, []);
  console.log(`\n${checks.length}/${checks.length} PASS`);
} finally {
  await browser.close();
  server.close();
}
