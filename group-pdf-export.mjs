// GROUP PDF V1 — pure data -> pdfmake document construction for ONE group of a Group Discussion
// activity. No DOM, no Firebase, no network: everything here is deterministic and unit-testable.
// Fetching images, lazy-loading pdfmake and saving the file live in group-pdf-runtime.mjs.
//
// Hard rules (each is covered by test/group-pdf-v1/builder.test.mjs):
//   - every string that reaches the PDF is NFC-normalized and passed through the unsupported-glyph
//     policy for the font family it will be drawn with;
//   - participantId, storagePath and Storage URLs never appear in the generated document;
//   - student displayName is shown only when it exists AND the activity has collectStudentNames === true;
//   - RichText semantics (tokens, numbering, indent/gutter widths) come from rich-text-renderer.mjs's
//     exported maps/constants instead of being redefined here.

import { validateRichText, legacyImageTextFallback } from "./rich-text-contract.mjs";
import {
  COLOR_CSS_MAP, SIZE_CSS_MAP, LINE_SPACING_CSS_MAP, SPACING_CSS_MAP, INDENT_PX_PER_LEVEL, LIST_MARKER_GUTTER_PX
} from "./rich-text-renderer.mjs";
import { safeGroupFileLinkUrl } from "./group-file-link-safety.mjs";
import { FONT_COVERAGE } from "./group-pdf-font-coverage.mjs";

export const PDF_APP_URL_BASE = "https://teaching.quantth.vn/#/group/";
export const REPLACEMENT_GLYPH = "\uFFFD";
export const PX_TO_PT = 0.75;
export const BASE_PT = 16 * PX_TO_PT;          // default run size (16px) = 12pt
const round2 = (n) => Math.round(n * 100) / 100;
const BASE_LINE_HEIGHT = 1.2;                  // pdfmake lineHeight for the "1" token
const PAGE_MARGINS = [40, 52, 40, 52];
const CONTENT_WIDTH_PT = 595.28 - PAGE_MARGINS[0] - PAGE_MARGINS[2];
const SECURE_SUBMISSION_PATH = /^groupActivitySubmissions\/[^/]+\/[^/]+\/groups\/[1-9][0-9]*\/[^/]+\/[^/]+\/[^/]+$/;
const LIST_KINDS = new Set(["bullet", "number"]);

export const nfc = (value) => String(value ?? "").normalize("NFC");
export const isSecureSubmissionPath = (path) => typeof path === "string" && SECURE_SUBMISSION_PATH.test(path);

// ---------------------------------------------------------------- fonts / unsupported glyphs
export function fontFamilyForToken(token) { return token === "times" ? "Tinos" : "Roboto"; }

function inRanges(ranges, cp) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, [a, b] = ranges[mid];
    if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return true;
  }
  return false;
}
export function isGlyphSupported(codePoint, family = "Roboto") {
  const ranges = FONT_COVERAGE[family];
  return !!ranges && inRanges(ranges, codePoint);
}

const isDroppedInvisible = (cp) =>
  (cp < 0x20 && cp !== 0x0A) || (cp >= 0x7F && cp <= 0x9F) || cp === 0xFEFF || cp === 0x200E || cp === 0x200F ||
  (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069);
const isVariationSelector = (cp) => (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF);
const isEmojiTail = (cp) => (cp >= 0x1F3FB && cp <= 0x1F3FF) || (cp >= 0xE0020 && cp <= 0xE007F) || cp === 0x20E3;
const isRegionalIndicator = (cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF;

// One policy instance per exported document: it owns the replacement counter.
// A "replacement" is one visible U+FFFD placeholder. Emoji sequences (ZWJ joins, skin-tone modifiers,
// variation selectors, flag pairs) collapse into a single placeholder; zero-width controls are removed
// without a placeholder because they have no glyph to lose.
export function createTextPolicy() {
  const stats = { replacements: 0 };
  function text(input, family = "Roboto") {
    const source = nfc(input).replace(/\r\n?|\u2028|\u2029/g, "\n").replace(/\t/g, "    ");
    let out = "", lastReplaced = false, joinPending = false, riOpen = false;
    for (const ch of source) {
      const cp = ch.codePointAt(0);
      if (isDroppedInvisible(cp)) continue;
      if (cp === 0x0A || isGlyphSupported(cp, family)) { out += ch; lastReplaced = false; joinPending = false; riOpen = false; continue; }
      if (cp === 0x200D) { if (lastReplaced) joinPending = true; continue; }
      if (isVariationSelector(cp)) continue;
      if (lastReplaced && (isEmojiTail(cp) || joinPending)) { joinPending = false; continue; }
      if (lastReplaced && isRegionalIndicator(cp) && riOpen) { riOpen = false; continue; }
      out += REPLACEMENT_GLYPH; stats.replacements++;
      lastReplaced = true; joinPending = false; riOpen = isRegionalIndicator(cp);
    }
    return out;
  }
  return { text, stats };
}

// ---------------------------------------------------------------- small pure helpers
export function toMillis(ts) {
  try {
    if (ts && typeof ts.toMillis === "function") { const n = ts.toMillis(); return Number.isFinite(n) ? n : 0; }
    if (ts instanceof Date) { const n = ts.getTime(); return Number.isFinite(n) ? n : 0; }
    if (typeof ts === "number") return Number.isFinite(ts) ? ts : 0;
    if (typeof ts === "string" && ts) { const n = new Date(ts).getTime(); return Number.isFinite(n) ? n : 0; }
  } catch { /* fall through */ }
  return 0;
}

export function formatDateTime(ms, timeZone) {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23", ...(timeZone ? { timeZone } : {})
    }).format(new Date(ms));
  } catch { return ""; }
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1).replace(".", ",")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function formatDurationSec(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 60) return `${Math.round(s)} giây`;
  return s % 60 === 0 ? `${s / 60} phút` : `${Math.floor(s / 60)} phút ${Math.round(s % 60)} giây`;
}

const STATUS_LABELS = { draft: "Nháp", open: "Đang mở", closed: "Đã đóng" };

// Deterministic: createdAt ascending (missing = 0, like the live panel), then document id (plain code-unit
// comparison, never locale dependent). Input order never matters.
export function sortByCreatedAtThenId(items) {
  return items.slice().sort((a, b) => {
    const d = toMillis(a.createdAt) - toMillis(b.createdAt);
    if (d !== 0) return d;
    const x = String(a.id ?? ""), y = String(b.id ?? "");
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

const cpSlice = (s, max) => Array.from(s).slice(0, max).join("");
const INVALID_FILENAME_CHARS = /[\u0000-\u001F\u007F-\u009F\\/:*?"<>|\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;
function cleanNamePart(value, max) {
  return cpSlice(nfc(value).replace(INVALID_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim(), max)
    .replace(/[. ]+$/g, "").replace(/^[. ]+/g, "").trim();
}

// `{title} - {className} - Nhóm {n}.pdf`: Vietnamese diacritics kept, NFC, Windows-invalid and control
// characters removed, whitespace collapsed, each segment length-limited, class segment omitted when empty.
export function buildPdfFileName({ title, className, group }) {
  const parts = [cleanNamePart(title, 80) || "Thảo luận nhóm", cleanNamePart(className, 40), `Nhóm ${Number(group) || 0}`].filter(Boolean);
  return `${parts.join(" - ")}.pdf`;
}

// ---------------------------------------------------------------- input model (explicit field picks only)
function resolveRichSource(rich, plain, imageContext) {
  if (rich !== null && rich !== undefined && validateRichText(rich, imageContext)) return { kind: "rich", rich };
  const compat = rich !== null && rich !== undefined ? legacyImageTextFallback(rich, imageContext) : null;
  return { kind: "plain", text: String(compat ?? plain ?? "") };
}

function richHasContent(rich) {
  return rich.blocks.some((b) => b.type !== "paragraph" || b.runs.some((r) => r.text.trim() !== ""));
}

export function normalizeGroupPdfInput({ activity, group, topic, notes = [], photos = [], files = [], members = [] }) {
  if (!activity || typeof activity.id !== "string" || !activity.id) throw new TypeError("Group PDF: activity.id is required");
  const groupNo = Number(group);
  if (!Number.isInteger(groupNo) || groupNo < 1) throw new TypeError("Group PDF: group must be a positive integer");
  const base = { ownerId: activity.ownerId, activityId: activity.id, allowLegacy: true };
  const names = new Map();
  if (activity.collectStudentNames === true) {
    for (const m of members) {
      const name = typeof m?.displayName === "string" ? nfc(m.displayName).replace(/\s+/g, " ").trim() : "";
      if (name && typeof m.uid === "string") names.set(m.uid, name);
    }
  }
  const inGroup = (x) => Number(x?.group) === groupNo;
  return {
    activity: {
      id: activity.id,
      ownerId: activity.ownerId,
      title: typeof activity.title === "string" ? activity.title : "",
      className: typeof activity.className === "string" ? activity.className.trim() : "",
      status: typeof activity.status === "string" ? activity.status : "",
      createdAt: activity.createdAt, startedAt: activity.startedAt,
      durationSec: activity.durationSec
    },
    group: groupNo,
    common: resolveRichSource(activity.instructionsRich, activity.instructions, { ...base, scope: "common" }),
    groupTask: resolveRichSource(topic?.topicRich, topic?.topic, { ...base, scope: "group", groupId: groupNo }),
    notes: sortByCreatedAtThenId(notes.filter(inGroup)).map((n) => ({
      id: String(n.id ?? ""), text: String(n.text ?? ""), createdAt: n.createdAt,
      authorName: names.get(n.participantId) || ""
    })),
    photos: sortByCreatedAtThenId(photos.filter(inGroup)).map((p) => ({
      id: String(p.id ?? ""), name: String(p.name ?? ""), createdAt: p.createdAt,
      path: isSecureSubmissionPath(p.storagePath) ? p.storagePath : "", mimeType: String(p.contentType ?? "")
    })),
    files: sortByCreatedAtThenId(files.filter(inGroup)).map((f) => ({
      id: String(f.id ?? ""), name: String(f.name ?? ""), size: Number(f.size) || 0, createdAt: f.createdAt,
      link: typeof f.link === "string" ? f.link : "",
      hasSecurePath: isSecureSubmissionPath(f.storagePath), hasLegacyPath: !!f.storagePath && !isSecureSubmissionPath(f.storagePath)
    }))
  };
}

// Image fetch plan. `path` is for the runtime's authenticated Storage read only; it is never put in the document.
export function collectImageRequests(model) {
  const requests = new Map();
  const add = (source, scope, groupId) => {
    if (source.kind !== "rich") return;
    const context = { ownerId: model.activity.ownerId, activityId: model.activity.id, scope, ...(groupId ? { groupId } : {}), allowLegacy: true };
    for (const block of source.rich.blocks) {
      if (block.type !== "image") continue;
      const key = `rich:${block.storagePath}`;
      if (!requests.has(key)) requests.set(key, { key, kind: "rich", path: block.storagePath, mimeType: block.mimeType, context });
    }
  };
  add(model.common, "common", null);
  add(model.groupTask, "group", model.group);
  for (const p of model.photos) if (p.path) requests.set(`photo:${p.id}`, { key: `photo:${p.id}`, kind: "photo", path: p.path, mimeType: p.mimeType, context: null });
  return [...requests.values()];
}

// ---------------------------------------------------------------- RichText -> pdfmake nodes
function createContext({ images, policy }) {
  return { images, policy, usedFamilies: new Set(["Roboto"]), imageNames: new Map(), imageDefs: {}, stats: { imageFailures: 0, imagesEmbedded: 0 } };
}

function placeImage(ctx, key, { maxW, maxH }) {
  const info = ctx.images.get(key);
  if (!info || !info.dataUrl || !(info.width > 0) || !(info.height > 0)) return null;
  let name = ctx.imageNames.get(key);
  if (!name) { name = `img${ctx.imageNames.size + 1}`; ctx.imageNames.set(key, name); ctx.imageDefs[name] = info.dataUrl; }
  const w = info.width * PX_TO_PT, h = info.height * PX_TO_PT;
  const scale = Math.min(1, maxW / w, maxH / h);
  ctx.stats.imagesEmbedded++;
  return { image: name, width: Math.round(w * scale * 100) / 100, height: Math.round(h * scale * 100) / 100 };
}

function runNode(ctx, run) {
  const family = fontFamilyForToken(run.font);
  ctx.usedFamilies.add(family);
  const node = { text: ctx.policy.text(run.text, family), font: family };
  if (run.bold === true) node.bold = true;
  if (run.italic === true) node.italics = true;
  const decoration = [];
  if (run.underline === true) decoration.push("underline");
  if (run.strike === true) decoration.push("lineThrough");
  if (decoration.length) node.decoration = decoration;
  const size = run.size && SIZE_CSS_MAP[run.size];
  if (size) node.fontSize = round2(parseFloat(size) * PX_TO_PT);
  const color = run.color && COLOR_CSS_MAP[run.color];
  if (color) node.color = color;
  return node;
}

function paragraphMetrics(block) {
  const spacing = SPACING_CSS_MAP[block.spacing] ?? SPACING_CSS_MAP.normal;
  const lineMultiplier = parseFloat(LINE_SPACING_CSS_MAP[block.lineSpacing]) || 1;
  const indent = Number.isInteger(block.indent) ? block.indent : 0;
  return {
    alignment: block.align && block.align !== "left" ? block.align : undefined,
    lineHeight: Math.round(BASE_LINE_HEIGHT * lineMultiplier * 1000) / 1000,
    after: round2(parseFloat(spacing) * BASE_PT),
    left: round2(indent * INDENT_PX_PER_LEVEL * PX_TO_PT),
    indent
  };
}

// A blank paragraph is exactly one visible blank line (a non-breaking space at the base size), matching the editor.
const BLANK_LINE = "\u00A0";

export function richBlocksToNodes(ctx, rich) {
  const nodes = [];
  let prevKey = null, counter = 0;
  const gutter = round2(LIST_MARKER_GUTTER_PX * PX_TO_PT);
  for (const block of rich.blocks) {
    if (block.type !== "paragraph" || !block.list) { prevKey = null; counter = 0; }
    if (block.type === "image") { nodes.push(imageNode(ctx, block)); continue; }
    if (block.type === "table") { nodes.push(tableNode(ctx, block)); continue; }
    const m = paragraphMetrics(block);
    const runs = block.runs.map((r) => runNode(ctx, r));
    const blank = runs.length === 0 || runs.every((r) => r.text === "");
    const content = blank ? { text: BLANK_LINE, font: "Roboto", fontSize: BASE_PT } : { text: runs };
    if (block.list && LIST_KINDS.has(block.list)) {
      const key = `${block.list}|${m.indent}`;
      counter = key === prevKey ? counter + 1 : 1;
      prevKey = key;
      const marker = block.list === "bullet" ? "•" : `${counter}.`;
      nodes.push({
        columns: [
          { width: gutter, text: marker, font: "Roboto" },
          { width: "*", ...content, ...(m.alignment ? { alignment: m.alignment } : {}), lineHeight: m.lineHeight }
        ],
        columnGap: 0, margin: [m.left, 0, 0, m.after]
      });
      continue;
    }
    nodes.push({ ...content, ...(m.alignment ? { alignment: m.alignment } : {}), lineHeight: m.lineHeight, margin: [m.left, 0, 0, m.after] });
  }
  return nodes;
}

function placeholderLine(text) {
  return { text, italics: true, color: "#b91c1c", alignment: "center", margin: [0, 4, 0, 8] };
}

function imageNode(ctx, block) {
  const alt = ctx.policy.text(block.alt || "", "Roboto");
  const img = placeImage(ctx, `rich:${block.storagePath}`, { maxW: CONTENT_WIDTH_PT, maxH: 520 });
  if (!img) { ctx.stats.imageFailures++; return placeholderLine(`[Không tải được ảnh${alt ? `: ${alt}` : ""}]`); }
  const picture = { ...img, alignment: "center", margin: [0, 4, 0, alt ? 2 : 8] };
  return alt
    ? { unbreakable: true, stack: [picture, { text: alt, italics: true, fontSize: 9.75, color: "#64748b", alignment: "center", margin: [0, 0, 0, 8] }] }
    : picture;
}

function tableNode(ctx, block) {
  const body = block.rows.map((row) => row.cells.map((cell) =>
    typeof cell === "string" ? { text: ctx.policy.text(cell, "Roboto") } : { text: cell.runs.map((r) => runNode(ctx, r)) }));
  return {
    table: { widths: block.rows[0].cells.map(() => "*"), body, dontBreakRows: true },
    layout: {
      hLineWidth: () => 0.75, vLineWidth: () => 0.75, hLineColor: () => "#cbd5e1", vLineColor: () => "#cbd5e1",
      paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4
    },
    margin: [0, 4, 0, 8]
  };
}

function plainTextNodes(ctx, text) {
  return [{ text: ctx.policy.text(text, "Roboto"), margin: [0, 0, 0, 6] }];
}

function emptyLine(text) { return { text, italics: true, color: "#64748b", margin: [0, 0, 0, 6] }; }

function sourceNodes(ctx, source, emptyText) {
  if (source.kind === "rich") return richHasContent(source.rich) ? richBlocksToNodes(ctx, source.rich) : [emptyLine(emptyText)];
  return source.text.trim() ? plainTextNodes(ctx, source.text) : [emptyLine(emptyText)];
}

// Heading + first content node stay together unless the first node is a long, freely-breakable text
// (those split by line, so a heading can never be left alone with nothing after it).
function textLength(node) {
  if (!node) return 0;
  if (typeof node.text === "string") return node.text.length;
  if (Array.isArray(node.text)) return node.text.reduce((n, t) => n + (typeof t === "string" ? t.length : (t.text || "").length), 0);
  return 0;
}
function section(title, nodes) {
  const heading = { text: title, fontSize: 13, bold: true, color: "#0e7490", margin: [0, 14, 0, 6] };
  const [first, ...rest] = nodes;
  const freelyBreakable = first && !first.columns && !first.table && !first.image && !first.stack && textLength(first) > 800;
  if (!first || freelyBreakable) return [heading, ...nodes];
  return [{ unbreakable: true, stack: [heading, first] }, ...rest];
}

function linkRun(text, url) {
  return { text, link: url, color: "#1d4ed8", decoration: "underline" };
}

// ---------------------------------------------------------------- the document
export function buildGroupPdfDocument(model, { images = new Map(), now = new Date(), timeZone } = {}) {
  const policy = createTextPolicy();
  const ctx = createContext({ images, policy });
  const t = (s) => policy.text(s, "Roboto");
  const a = model.activity;
  const title = a.title.trim();
  const fileName = buildPdfFileName({ title, className: a.className, group: model.group });

  const metaRows = [
    ["Tên buổi thảo luận", { text: t(title || "Thảo luận nhóm"), bold: true }]
  ];
  if (a.className) metaRows.push(["Lớp", t(a.className)]);
  metaRows.push(["Nhóm", { text: `Nhóm ${model.group}`, bold: true }]);
  if (STATUS_LABELS[a.status] || a.status) metaRows.push(["Trạng thái", t(STATUS_LABELS[a.status] || a.status)]);
  const created = formatDateTime(toMillis(a.createdAt), timeZone); if (created) metaRows.push(["Ngày tạo", created]);
  const started = formatDateTime(toMillis(a.startedAt), timeZone); if (started) metaRows.push(["Bắt đầu", started]);
  const duration = formatDurationSec(a.durationSec); if (duration) metaRows.push(["Thời lượng", duration]);

  const content = [
    { text: "HCMA2 TEACHING", fontSize: 10, color: "#0e7490", bold: true },
    { text: "KẾT QUẢ THẢO LUẬN NHÓM", fontSize: 20, bold: true, margin: [0, 2, 0, 8] },
    {
      table: { widths: [120, "*"], body: metaRows },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => "#cbd5e1", paddingTop: () => 3, paddingBottom: () => 3 },
      margin: [0, 0, 0, 6]
    },
    ...section("NHIỆM VỤ / HƯỚNG DẪN CHUNG", sourceNodes(ctx, model.common, "Không có nội dung.")),
    ...section("NHIỆM VỤ CỦA NHÓM", sourceNodes(ctx, model.groupTask, "Chưa có nhiệm vụ cho nhóm này.")),
    ...section("Ý KIẾN CỦA NHÓM", noteNodes(ctx, model, timeZone)),
    ...section("HÌNH ẢNH", photoNodes(ctx, model, timeZone)),
    ...section("TỆP ĐÍNH KÈM / LIÊN KẾT", fileNodes(ctx, model))
  ];

  const stamp = formatDateTime(now.getTime(), timeZone);
  const docDefinition = {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    defaultStyle: { font: "Roboto", fontSize: BASE_PT, lineHeight: BASE_LINE_HEIGHT },
    info: { title: `${nfc(title || "Thảo luận nhóm").replace(/[\u0000-\u001F\u007F]/g, " ")} - Nhóm ${model.group}`, author: "HCMA2 Teaching", creator: "HCMA2 Teaching", subject: "Kết quả thảo luận nhóm" },
    content,
    images: ctx.imageDefs,
    footer: (current, total) => ({
      columns: [
        { text: `HCMA2 Teaching · Xuất lúc ${stamp}`, fontSize: 8, color: "#64748b", margin: [PAGE_MARGINS[0], 0, 0, 0] },
        { text: `Trang ${current}/${total}`, alignment: "right", fontSize: 8, color: "#64748b", margin: [0, 0, PAGE_MARGINS[2], 0] }
      ],
      margin: [0, 18, 0, 0]
    })
  };
  return {
    docDefinition, fileName, usedFamilies: ctx.usedFamilies,
    stats: {
      replacements: policy.stats.replacements, imageFailures: ctx.stats.imageFailures, imagesEmbedded: ctx.stats.imagesEmbedded,
      notes: model.notes.length, photos: model.photos.length, files: model.files.length
    }
  };
}

function noteNodes(ctx, model, timeZone) {
  if (!model.notes.length) return [emptyLine("Nhóm chưa gửi ý kiến nào.")];
  return model.notes.map((n, i) => {
    const when = formatDateTime(toMillis(n.createdAt), timeZone);
    const head = [{ text: `#${i + 1}`, bold: true }];
    if (n.authorName) head.push({ text: `  ${ctx.policy.text(n.authorName, "Roboto")}` });
    if (when) head.push({ text: `  ·  ${when}`, color: "#64748b" });
    const body = ctx.policy.text(n.text, "Roboto");
    return { unbreakable: body.length < 300, margin: [0, 0, 0, 8], stack: [{ text: head, fontSize: 9.5 }, { text: body, margin: [0, 2, 0, 0] }] };
  });
}

function photoNodes(ctx, model, timeZone) {
  if (!model.photos.length) return [emptyLine("Nhóm chưa gửi hình ảnh nào.")];
  return model.photos.map((p) => {
    const when = formatDateTime(toMillis(p.createdAt), timeZone);
    const caption = [ctx.policy.text(p.name || "Ảnh", "Roboto"), when].filter(Boolean).join(" — ");
    const img = p.path ? placeImage(ctx, `photo:${p.id}`, { maxW: CONTENT_WIDTH_PT, maxH: 420 }) : null;
    if (!img) { ctx.stats.imageFailures++; return { unbreakable: true, margin: [0, 0, 0, 8], stack: [placeholderLine("[Không tải được ảnh]"), { text: caption, fontSize: 9, color: "#64748b", alignment: "center" }] }; }
    return { unbreakable: true, margin: [0, 0, 0, 10], stack: [{ ...img, alignment: "center", margin: [0, 2, 0, 2] }, { text: caption, fontSize: 9, color: "#64748b", alignment: "center" }] };
  });
}

function fileNodes(ctx, model) {
  if (!model.files.length) return [emptyLine("Nhóm chưa gửi tệp hoặc liên kết nào.")];
  const deepLink = `${PDF_APP_URL_BASE}${encodeURIComponent(model.activity.id)}`;
  const t = (s) => ctx.policy.text(s, "Roboto");
  return model.files.map((f) => {
    const name = t(f.name || "Tệp");
    let parts;
    if (f.link) {
      const safe = safeGroupFileLinkUrl(f.link);
      parts = safe
        ? [{ text: t(f.name || "Liên kết ngoài"), bold: true }, "  —  ", linkRun(safe, safe)]
        : [{ text: t(f.name || "Liên kết"), bold: true }, "  —  ", { text: "liên kết không hợp lệ hoặc không an toàn, đã bỏ qua", italics: true, color: "#b91c1c" }];
    } else if (f.hasSecurePath) {
      const size = formatBytes(f.size);
      parts = [{ text: name, bold: true }, "  —  ", ...(size ? [size, "  —  "] : []), linkRun("Mở trong HCMA2 Teaching", deepLink)];
    } else {
      parts = [{ text: name, bold: true }, "  —  ", { text: "tệp cũ chưa được chuyển sang vùng lưu trữ an toàn, không có liên kết mở", italics: true, color: "#64748b" }];
    }
    return { text: parts, margin: [0, 0, 0, 5] };
  });
}

export const GROUP_PDF_CONSTANTS = Object.freeze({ CONTENT_WIDTH_PT, PAGE_MARGINS, BASE_LINE_HEIGHT });
