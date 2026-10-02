// GROUP PDF V1 — pure unit tests for group-pdf-export.mjs and the orchestration in group-pdf-runtime.mjs.
// No browser, no Firebase, no network, no vendored library: the document builder is data in, JSON out.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfFileName, nfc, createTextPolicy, isGlyphSupported, REPLACEMENT_GLYPH, sortByCreatedAtThenId,
  normalizeGroupPdfInput, collectImageRequests, buildGroupPdfDocument, richBlocksToNodes, formatBytes, toMillis,
  PDF_APP_URL_BASE
} from "../../group-pdf-export.mjs";
import { exportGroupPdf } from "../../group-pdf-runtime.mjs";
import { validateRichText } from "../../rich-text-contract.mjs";
import * as fx from "./fixtures.mjs";
import { renderRichText } from "../../rich-text-renderer.mjs";
import { FakeDocument } from "../gate2b-rt-contract/fake-dom.mjs";

const cp = (n) => String.fromCodePoint(n);
const ts = (ms) => ({ toMillis: () => ms });
const NOW = new Date(Date.UTC(2026, 9, 2, 1, 15, 7));
const OWNER = "ownerA", ACT = "act123";
const run = (text, extra = {}) => ({ text, ...extra });
const para = (runs, extra = {}) => ({ type: "paragraph", runs: Array.isArray(runs) ? runs : [run(runs)], ...extra });
const rich = (...blocks) => ({ version: 2, blocks });
const IMG = (name, extra = {}) => ({ type: "image", storagePath: `groupActivityContent/${OWNER}/${ACT}/common/${name}.jpg`, alt: "", mimeType: "image/jpeg", size: 1000, ...extra });
const GIMG = (name, g) => ({ type: "image", storagePath: `groupActivityContent/${OWNER}/${ACT}/groups/${g}/${name}.png`, alt: "", mimeType: "image/png", size: 1000 });
const SUB = (g, uid, sid, ext = "jpg") => `groupActivitySubmissions/${OWNER}/${ACT}/groups/${g}/${uid}/${sid}/asset1.${ext}`;

function activity(extra = {}) {
  return { id: ACT, ownerId: OWNER, title: "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị", className: "K77.B02 TPHCM", status: "closed",
    createdAt: ts(Date.UTC(2026, 9, 1, 2, 0, 0)), startedAt: ts(Date.UTC(2026, 9, 1, 2, 5, 0)), durationSec: 900, collectStudentNames: false, ...extra };
}
function build(input, opts = {}) {
  const model = normalizeGroupPdfInput({ activity: activity(), group: 3, topic: null, notes: [], photos: [], files: [], members: [], ...input });
  return { model, ...buildGroupPdfDocument(model, { now: NOW, timeZone: "UTC", ...opts }) };
}
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (k !== "images") strings(v, out); }
  return out;
}
function linkNodes(doc) {
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (v.link) out.push(v); for (const [k, x] of Object.entries(v)) if (k !== "images") walk(x); } };
  walk(doc.docDefinition.content);
  return out;
}
const flat = (doc) => JSON.stringify({ ...doc.docDefinition, footer: undefined, images: undefined });
const allText = (doc) => strings(doc.docDefinition.content).join("\n");

// ------------------------------------------------------------------ filename
test("filename: {title} - {class} - Nhóm {n}.pdf keeps Vietnamese diacritics", () => {
  assert.equal(buildPdfFileName({ title: "Đồng kiến tạo tri thức", className: "K77.B02 TPHCM", group: 3 }), "Đồng kiến tạo tri thức - K77.B02 TPHCM - Nhóm 3.pdf");
});
test("filename: class segment omitted when empty or whitespace", () => {
  assert.equal(buildPdfFileName({ title: "Thảo luận", className: "", group: 2 }), "Thảo luận - Nhóm 2.pdf");
  assert.equal(buildPdfFileName({ title: "Thảo luận", className: "   ", group: 2 }), "Thảo luận - Nhóm 2.pdf");
});
test("filename: NFD input is normalized to NFC", () => {
  const name = buildPdfFileName({ title: "Đồng kiến tạo".normalize("NFD"), className: "Ơ".normalize("NFD"), group: 5 });
  assert.equal(name, name.normalize("NFC"));
  assert.equal(name, "Đồng kiến tạo - Ơ - Nhóm 5.pdf");
});
test("filename: Windows-invalid and control characters are stripped and whitespace collapsed", () => {
  const dirty = `Thảo luận: "AI" / nhóm?  <1>|*\\ ${cp(0)}${cp(7)}${cp(0x200B)}${cp(0x202E)}  hết`;
  const name = buildPdfFileName({ title: dirty, className: "Lớp A\\B", group: 12 });
  assert.equal(name, "Thảo luận AI nhóm 1 hết - Lớp A B - Nhóm 12.pdf");
  assert.doesNotMatch(name, /[\\/:*?"<>|\u0000-\u001f]/);
});
test("filename: trailing dots/spaces trimmed, empty title falls back, length limited, surrogate-safe", () => {
  assert.equal(buildPdfFileName({ title: "Tên...   ", className: "", group: 1 }), "Tên - Nhóm 1.pdf");
  assert.equal(buildPdfFileName({ title: "///", className: "", group: 1 }), "Thảo luận nhóm - Nhóm 1.pdf");
  const long = buildPdfFileName({ title: "a".repeat(500), className: "b".repeat(500), group: 7 });
  assert.ok(long.length <= 80 + 40 + " -  - Nhóm 7.pdf".length + 2, `length ${long.length}`);
  const emoji = buildPdfFileName({ title: "😀".repeat(100), className: "", group: 1 });
  assert.ok(emoji.isWellFormed(), "no lone surrogate after truncation");
});

// ------------------------------------------------------------------ NFC
test("NFC: every string that reaches the PDF is NFC, even when the sources are NFD", () => {
  const d = (s) => s.normalize("NFD");
  const doc = build({
    activity: activity({ title: d("Đồng kiến tạo"), className: d("Lớp Ơ"), collectStudentNames: true, instructionsRich: rich(para([run(d("Hướng dẫn chung ế"), { bold: true })]), { type: "table", rows: [{ cells: [d("ô thường")] }] }) }),
    topic: { topicRich: rich(para(d("Nhiệm vụ nhóm ỳ"))) },
    notes: [{ id: "n1", group: 3, text: d("Ý kiến của tôi ặ"), participantId: "u1", createdAt: ts(1) }],
    files: [{ id: "f1", group: 3, name: d("Báo cáo ế.pdf"), size: 2048, storagePath: SUB(3, "u1", "f1", "pdf"), participantId: "u1", createdAt: ts(2) }],
    members: [{ uid: "u1", displayName: d("Nguyễn Thị Ánh") }]
  });
  const bad = strings(doc.docDefinition.content).filter((s) => s !== s.normalize("NFC"));
  assert.deepEqual(bad, []);
  assert.equal(nfc(d("ế")), "ế");
  assert.ok(allText(doc).includes("Ý kiến của tôi ặ"));
  assert.ok(allText(doc).includes("Nguyễn Thị Ánh"));
});

// ------------------------------------------------------------------ deterministic ordering
test("sorting: createdAt ASC then document id, independent of input order; missing createdAt first", () => {
  const items = [
    { id: "c", createdAt: ts(500) }, { id: "b", createdAt: ts(500) }, { id: "a", createdAt: ts(900) },
    { id: "z", createdAt: null }, { id: "y" }, { id: "d", createdAt: ts(100) }
  ];
  const expected = ["y", "z", "d", "b", "c", "a"];
  assert.deepEqual(sortByCreatedAtThenId(items).map((x) => x.id), expected);
  assert.deepEqual(sortByCreatedAtThenId(items.slice().reverse()).map((x) => x.id), expected);
  assert.deepEqual(sortByCreatedAtThenId([items[3], items[0], items[5], items[1], items[2], items[4]]).map((x) => x.id), expected);
  assert.equal(toMillis(new Date(5)), 5);
  assert.equal(toMillis("not a date"), 0);
});
test("sorting: notes, photos and files in the model all use it and only include the selected group", () => {
  const mk = (id, g, ms) => ({ id, group: g, createdAt: ts(ms), text: id, name: id, storagePath: SUB(g, "u", id), contentType: "image/jpeg" });
  const { model } = build({
    notes: [mk("n2", 3, 20), mk("n1", 3, 20), mk("n0", 3, 5), mk("other", 4, 1)],
    photos: [mk("p2", 3, 9), mk("p1", 3, 9), mk("pX", 2, 1)],
    files: [mk("f2", 3, 7), mk("f1", 3, 7), mk("fX", 5, 1)]
  });
  assert.deepEqual(model.notes.map((n) => n.id), ["n0", "n1", "n2"]);
  assert.deepEqual(model.photos.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(model.files.map((f) => f.id), ["f1", "f2"]);
});

// ------------------------------------------------------------------ no leaks
test("leaks: participantId and storagePath never appear in the document, and student names follow collectStudentNames", () => {
  const input = {
    notes: [{ id: "n1", group: 3, text: "Ý kiến", participantId: "UIDSENTINEL999", createdAt: ts(1) }],
    photos: [{ id: "p1", group: 3, name: "anh.jpg", storagePath: SUB(3, "UIDSENTINEL999", "p1"), contentType: "image/jpeg", participantId: "UIDSENTINEL999", createdAt: ts(2) }],
    files: [
      { id: "f1", group: 3, name: "bao-cao.pdf", size: 5000, storagePath: SUB(3, "UIDSENTINEL999", "f1", "pdf"), participantId: "UIDSENTINEL999", createdAt: ts(3) },
      { id: "f2", group: 3, name: "Liên kết nhóm", link: "https://drive.google.com/x", participantId: "UIDSENTINEL999", createdAt: ts(4) }
    ],
    members: [{ uid: "UIDSENTINEL999", displayName: "Trần Văn Bình", group: 3 }]
  };
  const images = new Map([["photo:p1", { dataUrl: "data:image/jpeg;base64,AAAA", width: 100, height: 50 }]]);
  const doc = build({ activity: activity({ collectStudentNames: true }), ...input }, { images });
  const json = flat(doc);
  for (const secret of ["UIDSENTINEL999", "groupActivitySubmissions", "participantId", "storagePath", "firebasestorage", "token="]) assert.ok(!json.includes(secret), `leaked ${secret}`);
  assert.ok(json.includes("Trần Văn Bình"), "name shown when collectStudentNames is true and the member has a displayName");
  assert.ok(!JSON.stringify(doc.docDefinition.info).includes("UIDSENTINEL999"));
  assert.deepEqual(Object.keys(doc.docDefinition.images), ["img1"]);
});
test("student names: hidden when collectStudentNames is false/absent, never invented when no displayName exists", () => {
  const base = { notes: [{ id: "n1", group: 3, text: "Ý kiến", participantId: "u1", createdAt: ts(1) }, { id: "n2", group: 3, text: "Khác", participantId: "u2", createdAt: ts(2) }], members: [{ uid: "u1", displayName: "Lê Thị Cúc" }] };
  assert.ok(!allText(build({ activity: activity({ collectStudentNames: false }), ...base })).includes("Lê Thị Cúc"));
  const noFlag = activity(); delete noFlag.collectStudentNames;
  assert.ok(!allText(build({ activity: noFlag, ...base })).includes("Lê Thị Cúc"));
  const on = allText(build({ activity: activity({ collectStudentNames: true }), ...base }));
  assert.ok(on.includes("Lê Thị Cúc"));
  assert.ok(!/Học viên/.test(on), "no invented placeholder name");
  assert.equal(normalizeGroupPdfInput({ activity: activity({ collectStudentNames: true }), group: 3, ...base }).notes[1].authorName, "");
});

// ------------------------------------------------------------------ unsupported glyphs
test("glyphs: Vietnamese, punctuation and currency are preserved untouched in both families", () => {
  const sample = "Đồng kiến tạo tri thức — “ăn quả nhớ kẻ trồng cây”… 1.500.000 ₫ € ≥ •";
  for (const family of ["Roboto", "Tinos"]) {
    const policy = createTextPolicy();
    assert.equal(policy.text(sample, family), sample);
    assert.equal(policy.stats.replacements, 0);
  }
  const tones = "aăâeêioôơuưy".split("").flatMap((v) => ["", cp(0x300), cp(0x309), cp(0x303), cp(0x301), cp(0x323)].map((t) => (v + t).normalize("NFC")));
  const policy = createTextPolicy();
  assert.equal(policy.text(tones.join(" ") + tones.join(" ").toUpperCase(), "Roboto"), tones.join(" ") + tones.join(" ").toUpperCase());
  assert.equal(policy.stats.replacements, 0);
});
test("glyphs: emoji, arrow, star and CJK become an explicit U+FFFD placeholder, are counted, never silently dropped or turned into '?'", () => {
  assert.equal(REPLACEMENT_GLYPH, cp(0xFFFD));
  assert.ok(isGlyphSupported(0xFFFD, "Roboto") && isGlyphSupported(0xFFFD, "Tinos"), "placeholder must exist in the embedded fonts");
  const cases = [
    ["Vui 😀 quá", `Vui ${REPLACEMENT_GLYPH} quá`, 1],
    ["đẹp ★ lắm", `đẹp ${REPLACEMENT_GLYPH} lắm`, 1],
    ["đi → đến", `đi ${REPLACEMENT_GLYPH} đến`, 1],
    ["học 中文", `học ${REPLACEMENT_GLYPH}${REPLACEMENT_GLYPH}`, 2],
    ["tốt 👍🏽 nhé", `tốt ${REPLACEMENT_GLYPH} nhé`, 1],
    ["nhà 👨‍👩‍👧 mình", `nhà ${REPLACEMENT_GLYPH} mình`, 1],
    ["cờ 🇻🇳 đỏ", `cờ ${REPLACEMENT_GLYPH} đỏ`, 1]
  ];
  for (const [input, expected, count] of cases) {
    const policy = createTextPolicy();
    assert.equal(policy.text(input, "Roboto"), expected, input);
    assert.equal(policy.stats.replacements, count, input);
    assert.ok(!policy.text(input, "Roboto").includes("?"));
  }
});
test("glyphs: coverage is per font family (arrow exists in Tinos, not Roboto); invisible controls are removed without a placeholder", () => {
  const roboto = createTextPolicy(), tinos = createTextPolicy();
  assert.equal(roboto.text("a → b", "Roboto"), `a ${REPLACEMENT_GLYPH} b`);
  assert.equal(tinos.text("a → b", "Tinos"), "a → b");
  assert.equal(tinos.stats.replacements, 0);
  const policy = createTextPolicy();
  assert.equal(policy.text(`a${cp(0xFEFF)}b${cp(0x202E)}c${cp(0xFE0F)}d${cp(0)}e`, "Roboto"), "abcde");
  assert.equal(policy.stats.replacements, 0);
});
test("glyphs: replacements anywhere in the document are summed in stats (title, note, RichText run, table cell)", () => {
  const doc = build({
    activity: activity({ title: "Họp 😀", instructionsRich: rich(para([run("Chung ★")]), { type: "table", rows: [{ cells: [{ runs: [run("ô 中")] }] }] }) }),
    topic: { topicRich: rich(para([run("Nhóm → mũi tên", { font: "times" })])) },
    notes: [{ id: "n1", group: 3, text: "ý kiến 🔥", participantId: "u", createdAt: ts(1) }]
  });
  assert.equal(doc.stats.replacements, 4, "title + common run + table cell + note; Tinos arrow is supported so not counted");
  assert.ok(allText(doc).includes(REPLACEMENT_GLYPH));
  assert.ok(allText(doc).includes("→"), "the Tinos run keeps its arrow");
});

// ------------------------------------------------------------------ RichText mapper
const ctxFor = (images = new Map()) => {
  const policy = createTextPolicy();
  return { images, policy, usedFamilies: new Set(["Roboto"]), imageNames: new Map(), imageDefs: {}, stats: { imageFailures: 0, imagesEmbedded: 0 } };
};
const BLANK = cp(0xA0);

test("blank paragraph: exactly one visible blank line (non-breaking space at base size), for empty runs and empty-text runs", () => {
  const nodes = richBlocksToNodes(ctxFor(), rich(para("A"), { type: "paragraph", runs: [] }, para([run("")]), para("B")));
  assert.equal(nodes.length, 4);
  for (const i of [1, 2]) { assert.equal(nodes[i].text, BLANK); assert.equal(nodes[i].fontSize, 12); }
  const blankList = richBlocksToNodes(ctxFor(), rich({ type: "paragraph", runs: [], list: "bullet" }));
  assert.equal(blankList[0].columns[1].text, BLANK, "a blank list item still keeps its marker line");
  assert.ok(blankList[0].columns[0].text.length > 0);
});
test("mapper: bold/italic/underline/strike, colors, sizes and font tokens", () => {
  const ctx = ctxFor();
  const [node] = richBlocksToNodes(ctx, rich(para([
    run("a", { bold: true }), run("b", { italic: true }), run("c", { underline: true }), run("d", { strike: true }),
    run("e", { underline: true, strike: true, bold: true, italic: true }), run("f", { color: "red", size: 24 }),
    run("g", { font: "arial" }), run("h", { font: "roboto" }), run("i", { font: "default" }), run("j", { font: "times" })
  ])));
  const r = Object.fromEntries(node.text.map((t) => [t.text, t]));
  assert.equal(r.a.bold, true); assert.equal(r.b.italics, true);
  assert.deepEqual(r.c.decoration, ["underline"]); assert.deepEqual(r.d.decoration, ["lineThrough"]);
  assert.deepEqual(r.e.decoration, ["underline", "lineThrough"]); assert.equal(r.e.bold, true); assert.equal(r.e.italics, true);
  assert.equal(r.f.color, "#b91c1c"); assert.equal(r.f.fontSize, 18);
  for (const k of ["a", "g", "h", "i"]) assert.equal(r[k].font, "Roboto", k);
  assert.equal(r.j.font, "Tinos");
  assert.ok(ctx.usedFamilies.has("Tinos"));
  const plain = ctxFor(); richBlocksToNodes(plain, rich(para([run("x", { font: "arial" })])));
  assert.ok(!plain.usedFamilies.has("Tinos"), "Tinos is only requested when a times run exists");
});
test("mapper: alignment, indent 1-4, line spacing and paragraph spacing come from the production token maps", () => {
  const nodes = richBlocksToNodes(ctxFor(), rich(
    para("l"), para("c", { align: "center" }), para("r", { align: "right" }), para("j", { align: "justify" }),
    para("i1", { indent: 1 }), para("i2", { indent: 2 }), para("i3", { indent: 3 }), para("i4", { indent: 4 }),
    para("s1"), para("s115", { lineSpacing: "1.15" }), para("s15", { lineSpacing: "1.5" }), para("s2", { lineSpacing: "2" }),
    para("p1", { spacing: "compact" }), para("p2", { spacing: "normal" }), para("p3", { spacing: "wide" })
  ));
  assert.equal(nodes[0].alignment, undefined);
  assert.deepEqual(nodes.slice(1, 4).map((n) => n.alignment), ["center", "right", "justify"]);
  assert.deepEqual(nodes.slice(4, 8).map((n) => n.margin[0]), [18, 36, 54, 72]);
  assert.deepEqual(nodes.slice(8, 12).map((n) => n.lineHeight), [1.2, 1.38, 1.8, 2.4]);
  assert.deepEqual(nodes.slice(12, 15).map((n) => n.margin[3]), [1.8, 6, 15]);
});
test("mapper: lists use marker columns with the production gutter, indent adds to it, numbering restarts like production", () => {
  const nodes = richBlocksToNodes(ctxFor(), rich(
    para("a", { list: "number" }), para("b", { list: "number" }), para("c", { list: "bullet" }), para("d", { list: "number", indent: 1 }),
    para("e", { list: "number", indent: 1 }), para("f", { list: "number" }), para("plain"), para("g", { list: "number" }), para("h", { list: "number" })
  ));
  const markers = nodes.map((n) => (n.columns ? n.columns[0].text : null));
  assert.deepEqual(markers, ["1.", "2.", "•", "1.", "2.", "1.", null, "1.", "2."]);
  assert.equal(nodes[0].columns[0].width, 18, "marker gutter = LIST_MARKER_GUTTER_PX * 0.75");
  assert.deepEqual(nodes[3].margin.slice(0, 1), [18]);
  assert.equal(nodes[0].columns[1].width, "*");
});
test("mapper: numbering matches the production renderer exactly (parity with rich-text-renderer.mjs)", () => {
  const blocks = [
    para("1", { list: "number" }), para("2", { list: "number" }), para("b", { list: "bullet" }), para("n", { list: "number" }), para("n", { list: "number" }),
    para("x", { list: "number", indent: 2 }), para("x", { list: "number", indent: 2 }), para("y", { list: "number" }), para("z", { list: "number" }),
    IMG("a"), para("1", { list: "number" }), para("2", { list: "number" }), { type: "table", rows: [{ cells: ["c"] }] }, para("1", { list: "number" })
  ];
  const doc = rich(...blocks);
  const d = new FakeDocument(), container = d.createElement("div");
  renderRichText(container, doc, "", d, { imageContext: { ownerId: OWNER, activityId: ACT, scope: "common", allowLegacy: true } });
  const production = [];
  for (const child of container.children) for (const c of child.children || []) if (c.className === "rt-list-marker") production.push(c.textContent);
  const mine = richBlocksToNodes(ctxFor(), doc).filter((n) => n.columns).map((n) => n.columns[0].text);
  assert.deepEqual(mine, production);
  assert.ok(production.length >= 10);
});
test("mapper: image sizing preserves aspect ratio, never upscales a small image, and a missing image becomes a placeholder", () => {
  const key = (n) => `rich:groupActivityContent/${OWNER}/${ACT}/common/${n}.jpg`;
  const images = new Map([
    [key("big"), { dataUrl: "data:image/jpeg;base64,AA", width: 1600, height: 1067 }],
    [key("small"), { dataUrl: "data:image/jpeg;base64,AB", width: 200, height: 100 }],
    [key("tall"), { dataUrl: "data:image/jpeg;base64,AC", width: 300, height: 1600 }]
  ]);
  const ctx = ctxFor(images);
  const nodes = richBlocksToNodes(ctx, rich(IMG("big"), IMG("small"), IMG("tall"), IMG("gone", { alt: "Sơ đồ" })));
  const ratio = (n) => n.width / n.height;
  assert.ok(Math.abs(ratio(nodes[0]) - 1600 / 1067) < 0.01); assert.ok(nodes[0].width <= 515.28);
  assert.deepEqual([nodes[1].width, nodes[1].height], [150, 75]);
  assert.ok(Math.abs(ratio(nodes[2]) - 300 / 1600) < 0.01); assert.ok(nodes[2].height <= 520);
  assert.match(nodes[3].text, /^\[Không tải được ảnh: Sơ đồ\]$/);
  assert.equal(ctx.stats.imageFailures, 1);
  assert.equal(ctx.stats.imagesEmbedded, 3);
  assert.deepEqual(Object.keys(ctx.imageDefs), ["img1", "img2", "img3"]);
});
test("mapper: table keeps formatted runs, legacy string cells and equal-width columns", () => {
  const ctx = ctxFor();
  const [t] = richBlocksToNodes(ctx, rich({ type: "table", rows: [
    { cells: [{ runs: [run("Phương án", { bold: true })] }, { runs: [run("Ưu", { font: "times", italic: true })] }, "chuỗi cũ"] },
    { cells: [{ runs: [] }, { runs: [run("ặ ằ ẳ")] }, { runs: [run("x", { strike: true })] }] }
  ] }));
  assert.deepEqual(t.table.widths, ["*", "*", "*"]);
  assert.equal(t.table.body[0][0].text[0].bold, true);
  assert.equal(t.table.body[0][2].text, "chuỗi cũ");
  assert.equal(t.table.body[1][1].text[0].text, "ặ ằ ẳ");
  assert.ok(ctx.usedFamilies.has("Tinos"));
});

// ------------------------------------------------------------------ whole document
test("document: header, optional class/metadata, five sections in order, each heading grouped with its first node", () => {
  const doc = build({
    activity: activity({ instructionsRich: rich(para("Chung")) }), topic: { topicRich: rich(para("Nhóm")) },
    notes: [{ id: "n", group: 3, text: "Ý", participantId: "u", createdAt: ts(1) }]
  });
  const c = doc.docDefinition.content;
  assert.equal(c[0].text, "HCMA2 TEACHING"); assert.equal(c[1].text, "KẾT QUẢ THẢO LUẬN NHÓM");
  const rows = c[2].table.body.map((r) => r[0]);
  assert.deepEqual(rows, ["Tên buổi thảo luận", "Lớp", "Nhóm", "Trạng thái", "Ngày tạo", "Bắt đầu", "Thời lượng"]);
  assert.equal(c[2].table.body[3][1], "Đã đóng");
  assert.match(c[2].table.body[4][1], /01\/10\/2026/);
  const headings = c.filter((n) => n.unbreakable && n.stack?.[0]?.bold).map((n) => n.stack[0].text);
  assert.deepEqual(headings, ["NHIỆM VỤ / HƯỚNG DẪN CHUNG", "NHIỆM VỤ CỦA NHÓM", "Ý KIẾN CỦA NHÓM", "HÌNH ẢNH", "TỆP ĐÍNH KÈM / LIÊN KẾT"]);
  for (const n of c.filter((x) => x.unbreakable && x.stack?.[0]?.bold && x.stack[0].color === "#0e7490")) assert.equal(n.stack.length, 2);
});
test("document: class row and optional metadata rows are omitted when the data does not exist", () => {
  const doc = build({ activity: activity({ className: "", status: "", createdAt: null, startedAt: null, durationSec: undefined }) });
  assert.deepEqual(doc.docDefinition.content[2].table.body.map((r) => r[0]), ["Tên buổi thảo luận", "Nhóm"]);
  assert.equal(doc.fileName, "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị - Nhóm 3.pdf");
});
test("document: empty sections state it explicitly instead of disappearing", () => {
  const text = allText(build({}));
  for (const s of ["Không có nội dung.", "Chưa có nhiệm vụ cho nhóm này.", "Nhóm chưa gửi ý kiến nào.", "Nhóm chưa gửi hình ảnh nào.", "Nhóm chưa gửi tệp hoặc liên kết nào."]) assert.ok(text.includes(s), s);
});
test("document: footer shows Trang x/y plus the export timestamp; notes carry createdAt", () => {
  const doc = build({ notes: [{ id: "n", group: 3, text: "Ý", participantId: "u", createdAt: ts(Date.UTC(2026, 9, 2, 8, 30, 5)) }] });
  const footer = doc.docDefinition.footer(2, 5);
  assert.equal(footer.columns[1].text, "Trang 2/5");
  assert.match(footer.columns[0].text, /Xuất lúc 01:15:07 02\/10\/2026/);
  assert.match(allText(doc), /08:30:05 02\/10\/2026/);
});
test("document: RichText that fails validation falls back to the plain-text mirror, as the live panel does", () => {
  const doc = build({ activity: activity({ instructions: "Dòng 1\nDòng 2", instructionsRich: { version: 9, blocks: [] } }) });
  assert.ok(allText(doc).includes("Dòng 1\nDòng 2"));
  const foreign = build({ activity: activity({ instructions: "Mirror", instructionsRich: rich(IMG("x", { storagePath: "groupActivityContent/otherOwner/otherAct/common/x.jpg" })) }) });
  assert.ok(allText(foreign).includes("Mirror"), "an image path outside this activity invalidates the document");
  assert.equal(collectImageRequests(foreign.model).length, 0);
});

// ------------------------------------------------------------------ files and links
test("files: uploaded files link to the authenticated HCMA2 group page, never to Storage", () => {
  const doc = build({
    activity: activity({ id: "ab c/1" }),
    files: [{ id: "f1", group: 3, name: "Báo cáo nhóm 3.pdf", size: 2461000, storagePath: SUB(3, "u", "f1", "pdf"), participantId: "u", createdAt: ts(1) }]
  });
  const links = linkNodes(doc);
  assert.equal(links.length, 1);
  assert.equal(links[0].text, "Mở trong HCMA2 Teaching");
  assert.equal(links[0].link, `${PDF_APP_URL_BASE}ab%20c%2F1`);
  assert.equal(PDF_APP_URL_BASE, "https://teaching.quantth.vn/#/group/");
  const text = allText(doc);
  assert.ok(text.includes("Báo cáo nhóm 3.pdf") && text.includes("2,3 MB"));
  assert.ok(!/firebasestorage|groupActivitySubmissions|token=/.test(flat(doc)));
});
test("files: external links are direct hyperlinks only after safeGroupFileLinkUrl; unsafe or legacy entries never become links", () => {
  const doc = build({ files: [
    { id: "a", group: 3, name: "Liên kết nhóm", link: "https://drive.google.com/file/d/1AbC/view?usp=sharing", createdAt: ts(1) },
    { id: "b", group: 3, name: "Liên kết nhóm", link: "javascript:alert(1)", createdAt: ts(2) },
    { id: "c", group: 3, name: "Liên kết nhóm", link: "data:text/html,x", createdAt: ts(3) },
    { id: "d", group: 3, name: "tep-cu.docx", storagePath: "groupActivityContent/o/a/tep-cu.docx", createdAt: ts(4) },
    { id: "e", group: 3, name: "khong-co", createdAt: ts(5) }
  ] });
  assert.deepEqual(linkNodes(doc).map((n) => n.link), ["https://drive.google.com/file/d/1AbC/view?usp=sharing"]);
  assert.ok(allText(doc).includes("liên kết không hợp lệ hoặc không an toàn"));
  assert.ok(allText(doc).includes("tệp cũ chưa được chuyển sang vùng lưu trữ an toàn"));
  assert.ok(allText(doc).includes("tep-cu.docx") && allText(doc).includes("khong-co"));
  assert.equal(formatBytes(512), "512 B"); assert.equal(formatBytes(2048), "2 KB"); assert.equal(formatBytes(0), "");
});

// ------------------------------------------------------------------ images: request plan
test("image plan: RichText + photo requests are deduplicated, scoped to the activity/group, and never include unsafe photo paths", () => {
  const { model } = build({
    activity: activity({ instructionsRich: rich(IMG("one"), IMG("one"), IMG("two")) }),
    topic: { topicRich: rich(GIMG("g1", 3)) },
    photos: [
      { id: "p1", group: 3, name: "a", storagePath: SUB(3, "u", "p1"), contentType: "image/png", createdAt: ts(1) },
      { id: "p2", group: 3, name: "b", storagePath: "groupActivityContent/legacy/x.jpg", contentType: "image/jpeg", createdAt: ts(2) }
    ]
  });
  const plan = collectImageRequests(model);
  assert.deepEqual(plan.map((r) => r.key), [`rich:groupActivityContent/${OWNER}/${ACT}/common/one.jpg`, `rich:groupActivityContent/${OWNER}/${ACT}/common/two.jpg`, `rich:groupActivityContent/${OWNER}/${ACT}/groups/3/g1.png`, "photo:p1"]);
  assert.deepEqual(plan[0].context, { ownerId: OWNER, activityId: ACT, scope: "common", allowLegacy: true });
  assert.deepEqual(plan[2].context, { ownerId: OWNER, activityId: ACT, scope: "group", groupId: 3, allowLegacy: true });
  const doc = buildGroupPdfDocument(model, { now: NOW, timeZone: "UTC" });
  assert.equal(doc.stats.imageFailures, 6, "3 common placements + 1 group-task placement + 2 photos, all without bytes, each a visible placeholder");
});

// ------------------------------------------------------------------ orchestration (runtime, injected deps)
function exportInput(extra = {}) {
  return {
    activity: activity({ instructionsRich: rich(para("Chung"), IMG("a"), IMG("b")) }), group: 3, topic: null,
    notes: [], photos: [{ id: "p1", group: 3, name: "x.jpg", storagePath: SUB(3, "u", "p1"), contentType: "image/jpeg", createdAt: ts(1) }], files: [], members: [], ...extra
  };
}
test("export: one inaccessible image does not abort the PDF; it becomes a placeholder and is counted; progress is reported", async () => {
  const saved = [], progress = [], fetched = [];
  const result = await exportGroupPdf(exportInput(), {
    fetchImageBytes: async (req) => { fetched.push(req.key); if (req.key.endsWith("/b.jpg")) throw Object.assign(new Error("denied"), { code: "storage/unauthorized" }); return new Uint8Array([1, 2, 3]); },
    prepareImage: async () => ({ dataUrl: "data:image/jpeg;base64,AAAA", width: 800, height: 600 }),
    loadLibrary: async (families) => { saved.push(["load", [...families]]); return { lib: true }; },
    save: async (lib, docDefinition, fileName) => { saved.push(["save", fileName, docDefinition]); },
    now: NOW, timeZone: "UTC", onProgress: (p) => progress.push(p.stage)
  });
  assert.equal(result.stats.imageFailures, 1);
  assert.equal(result.stats.imagesEmbedded, 2);
  assert.equal(fetched.length, 3);
  assert.deepEqual(saved[0], ["load", ["Roboto"]], "Tinos is not requested when no times run exists");
  assert.equal(saved[1][1], "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị - K77.B02 TPHCM - Nhóm 3.pdf");
  assert.ok(allText({ docDefinition: saved[1][2] }).includes("[Không tải được ảnh]"));
  assert.deepEqual([...new Set(progress)], ["images", "layout", "library", "render"]);
});
test("export: Tinos is requested only when the content contains a times run; every image failing still completes", async () => {
  const loaded = [];
  const result = await exportGroupPdf(exportInput({ topic: { topicRich: rich(para([run("Serif", { font: "times" })])) } }), {
    fetchImageBytes: async () => { throw new Error("offline"); },
    prepareImage: async () => { throw new Error("unused"); },
    loadLibrary: async (families) => { loaded.push([...families].sort()); return {}; }, save: async () => {}, now: NOW
  });
  assert.deepEqual(loaded, [["Roboto", "Tinos"]]);
  assert.equal(result.stats.imageFailures, 3);
});
test("export: prepare failures count as image failures; library/save errors propagate (they are real failures)", async () => {
  const ok = await exportGroupPdf(exportInput(), { fetchImageBytes: async () => new Uint8Array([1]), prepareImage: async () => { throw new Error("decode"); }, loadLibrary: async () => ({}), save: async () => {}, now: NOW });
  assert.equal(ok.stats.imageFailures, 3);
  await assert.rejects(exportGroupPdf(exportInput(), { fetchImageBytes: async () => new Uint8Array(), prepareImage: async () => ({ dataUrl: "data:,", width: 1, height: 1 }), loadLibrary: async () => { throw new Error("không tải được"); }, save: async () => {}, now: NOW }), /không tải được/);
});

test("fixtures: the sample and long RichText documents are valid under the production contract (so they exercise the rich path, not the plain fallback)", () => {
  const ctx = { ownerId: fx.OWNER, activityId: fx.ACTIVITY_ID, allowLegacy: true };
  for (const input of [fx.sampleExportInput(), fx.longExportInput()]) {
    assert.equal(validateRichText(input.activity.instructionsRich, { ...ctx, scope: "common" }), true);
    assert.equal(validateRichText(input.topic.topicRich, { ...ctx, scope: "group", groupId: fx.GROUP }), true);
    const model = normalizeGroupPdfInput(input);
    assert.equal(model.common.kind, "rich"); assert.equal(model.groupTask.kind, "rich");
  }
  const plan = collectImageRequests(normalizeGroupPdfInput(fx.sampleExportInput()));
  assert.deepEqual(plan.map((r) => r.key), [`rich:${fx.commonImagePath}`, `rich:${fx.groupImagePath}`, "photo:p1", "photo:p2", "photo:p3"]);
});
