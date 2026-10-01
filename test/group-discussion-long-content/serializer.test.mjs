import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument } from '../gate2b-rt-editor/fake-editor-dom.mjs';
import { legacyPlainTextToDom, richTextToDom, serializeToRichText, createRunSpan } from '../../rich-text-editor-serializer.mjs';
import { validateRichTextV1, richTextToPlainText, codePointLength } from '../../rich-text-contract.mjs';
import { renderRichText } from '../../rich-text-renderer.mjs';

function rootFor(text) {
  const doc = new FakeDocument(), root = doc.createElement('div');
  root.appendChild(legacyPlainTextToDom(doc, text));
  return { doc, root };
}

for (const field of ['instructions', 'topic']) {
  for (const length of [500, 501, 1500, 9999, 10000]) {
    test(`${field}: ${length} code points survive export, mirror, reload and render`, () => {
      const text = 'ế'.repeat(length), { doc, root } = rootFor(text);
      const result = serializeToRichText(root);
      assert.equal(result.ok, true);
      assert.equal(validateRichTextV1(result.value), true);
      assert.equal(richTextToPlainText(result.value), text);
      assert.equal(root.textContent, text);
      assert.ok(result.value.blocks[0].runs.every(r => codePointLength(r.text) <= 500));
      const reload = doc.createElement('div');
      reload.appendChild(richTextToDom(doc, result.value));
      assert.deepEqual(serializeToRichText(reload), result);
      const view = doc.createElement('div');
      renderRichText(view, result.value, text, doc);
      assert.equal(view.textContent, text);
    });
  }
  test(`${field}: multiline legacy and long formatting survive unchanged`, () => {
    const text = '😀'.repeat(750) + '\r\n\r\n' + 'Nhiệm vụ ế '.repeat(100);
    const { doc, root } = rootFor(text);
    const format = { bold: true, italic: true, font: 'times', size: 24, color: 'blue' };
    // root.firstChild is now the shared text region (GATE 2B-RT-CONTINUOUS); the first paragraph,
    // and the first run span within it, are each one level deeper than before.
    root.firstChild.firstChild.firstChild.setAttribute('data-rt-bold', '1');
    const first = root.firstChild.firstChild;
    first.removeChild(first.firstChild);
    first.appendChild(createRunSpan(doc, { text: '😀'.repeat(750), ...format }));
    const result = serializeToRichText(root);
    assert.equal(result.ok, true);
    assert.equal(richTextToPlainText(result.value), text.replace(/\r\n/g, '\n'));
    assert.equal(result.value.blocks.length, 3);
    for (const run of result.value.blocks[0].runs) {
      assert.deepEqual({ ...run, text: '' }, { text: '', ...format });
      assert.equal(run.text.includes('\uFFFD'), false);
    }
    const view = doc.createElement('div');
    renderRichText(view, result.value, '', doc);
    assert.equal(view.childNodes[0].textContent, '😀'.repeat(750));
    assert.equal(view.childNodes[0].firstChild.style.fontWeight, '700');
    assert.equal(view.childNodes[2].textContent, 'Nhiệm vụ ế '.repeat(100));
  });
}

// GATE 2B-RT-CONTINUOUS §8 raised MAX_TOTAL_TEXT_LENGTH 10000 -> 40000, MAX_BLOCKS/MAX_V2_BLOCKS
// 20 -> 80 (same value as each other, by design), and MAX_SERIALIZED_BYTE_LENGTH 64 KiB -> 256 KiB,
// to give teachers room for several pages of instructions (see rich-text-contract.mjs for the full
// rationale). The boundary-enforcement tests below are updated to the new thresholds; they still
// prove the same fail-closed invariant, just at the new, larger, intentionally-approved limits.
test('40001 total characters fail closed without modifying authored content', () => {
  const { root } = rootFor('a'.repeat(20000) + '\n' + 'b'.repeat(20001));
  const before = root.textContent;
  assert.deepEqual(serializeToRichText(root), { ok: false, reason: 'limit_exceeded' });
  assert.equal(root.textContent, before);
});

test('80 paragraphs accepted; 81 rejected; separator characters follow existing contract', () => {
  const text = Array(80).fill('x'.repeat(500)).join('\n');
  const result = serializeToRichText(rootFor(text).root);
  assert.equal(result.ok, true);
  assert.equal(codePointLength(richTextToPlainText(result.value)), 40079);
  assert.equal(serializeToRichText(rootFor(text + '\n').root).ok, false);
});

test('partitioning cannot bypass 20 runs per block with mixed formatting', () => {
  const { doc, root } = rootFor('x'.repeat(9501));
  // root.firstChild is the shared text region; the lone paragraph is one level deeper.
  root.firstChild.firstChild.appendChild(createRunSpan(doc, { text: 'y', bold: true }));
  assert.equal(serializeToRichText(root).ok, false);
});

test('escaped control characters still obey the 256 KiB serialized limit', () => {
  const { root } = rootFor('\u0000'.repeat(10000));
  // Max out formatting metadata while keeping text/run/block counts legal under the new, raised
  // caps: 80 blocks x 20 runs/block x 25 escaped-null chars = 40000 total code points (at, not
  // over, MAX_TOTAL_TEXT_LENGTH), but the per-run formatting keys plus \u0000's 6-byte JSON escaping
  // push the serialized payload well past the 256 KiB byte guard on its own.
  const doc = new FakeDocument(), richRoot = doc.createElement('div');
  richRoot.appendChild(richTextToDom(doc, { version: 1, blocks: Array.from({ length: 80 }, () => ({
    type: 'paragraph', runs: Array.from({ length: 20 }, () => ({ text: '\u0000'.repeat(25), bold: true, italic: true, font: 'times', size: 24, color: 'purple' }))
  })) }));
  assert.equal(serializeToRichText(root).ok, true);
  assert.equal(serializeToRichText(richRoot).ok, false);
});

test('long hostile DOM remains inert text; unsafe formatting is rejected', () => {
  const text = '<img src=x onerror=alert(1)><script>alert(2)</script>'.repeat(25);
  const { doc, root } = rootFor('');
  const hostile = doc.createElement('a');
  hostile.setAttribute('href', 'javascript:alert(1)');
  hostile.textContent = text;
  // root.firstChild is the shared text region; nest the hostile node inside the actual (lone,
  // empty) paragraph, exactly as it was nested directly in root.firstChild before the region
  // wrapper existed.
  root.firstChild.firstChild.appendChild(hostile);
  const result = serializeToRichText(root);
  assert.equal(result.ok, true);
  assert.equal(richTextToPlainText(result.value), text);
  const view = doc.createElement('div');
  renderRichText(view, result.value, '', doc);
  assert.equal(view.textContent, text);
  assert.ok(view.firstChild.childNodes.every(n => n.tagName === 'SPAN' && n.getAttribute('href') === null));
  const marked = rootFor('x'.repeat(501));
  marked.root.firstChild.firstChild.firstChild.setAttribute('data-rt-color', 'url(javascript:alert(1))');
  assert.equal(serializeToRichText(marked.root).ok, false);
  assert.equal(validateRichTextV1({ version: 1, blocks: [{ type: 'paragraph', runs: [{ text: 'x'.repeat(501) }] }] }), false);
});
