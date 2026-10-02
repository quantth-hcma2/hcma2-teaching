// GROUP PDF V1 — real-browser end-to-end test. Headless Microsoft Edge runs the production module with the real
// vendored pdfmake + fonts and triggers the real download; the downloaded file is then inspected INDEPENDENTLY
// with pdf.js (text layer, link annotations, image extents, page footers, embedded fonts).
//
// Needs two locally installed packages (not repo dependencies, same convention as the other browser tests):
//   PLAYWRIGHT_PACKAGE  path to playwright's index.js (default: "playwright")
//   PDFJS_PACKAGE       path to pdfjs-dist/legacy/build/pdf.mjs (default: "pdfjs-dist/legacy/build/pdf.mjs")
// Serves only this repository on loopback; no Firebase, no network beyond loopback.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const asSpecifier = (p) => (/^[A-Za-z]:[\\/]/.test(p) ? pathToFileURL(p).href : p);
const pw = await import(asSpecifier(process.env.PLAYWRIGHT_PACKAGE || "playwright"));
const chromium = pw.chromium || pw.default.chromium;
const pdfjs = await import(asSpecifier(process.env.PDFJS_PACKAGE || "pdfjs-dist/legacy/build/pdf.mjs"));
const OPS = pdfjs.OPS;

const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ttf": "font/ttf" };
const server = createServer((req, res) => {
  try {
    const p = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(root)) throw Error("path");
    res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const tmp = mkdtempSync(path.join(os.tmpdir(), "group-pdf-v1-"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log("PASS " + name); }

const cp = (n) => String.fromCodePoint(n);
const nfc = (s) => s.normalize("NFC");
// pdf.js drops the space at text-run boundaries ("CHUNG —Đồng"), so content is matched whitespace-insensitively.
const squash = (s) => nfc(s).replace(/\s+/g, "");
const has = (hay, needle) => squash(hay).includes(squash(needle));

async function exportAndDownload(evaluate) {
  const [download, result] = await Promise.all([page.waitForEvent("download"), evaluate()]);
  const file = path.join(tmp, `${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  await download.saveAs(file);
  return { result, suggested: download.suggestedFilename(), bytes: new Uint8Array(readFileSync(file)) };
}

async function inspect(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages = [], links = [], images = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const tc = await pg.getTextContent();
    const rows = new Map();
    for (const it of tc.items) if (it.str.trim()) { const y = Math.round(it.transform[5]); (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, its]) => ({ y, text: nfc(its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join("")) }));
    pages.push(lines);
    for (const a of await pg.getAnnotations()) if (a.subtype === "Link" && (a.url || a.unsafeUrl)) links.push(a.url || a.unsafeUrl);
    const ops = await pg.getOperatorList(); const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
    const mul = (m, k) => [m[0] * k[0] + m[2] * k[1], m[1] * k[0] + m[3] * k[1], m[0] * k[2] + m[2] * k[3], m[1] * k[2] + m[3] * k[3], m[0] * k[4] + m[2] * k[5] + m[4], m[1] * k[4] + m[3] * k[5] + m[5]];
    ops.fnArray.forEach((fn, i) => {
      const a = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice()); else if (fn === OPS.restore) ctm = stack.pop() || ctm; else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintImageXObject) images.push({ page: n, w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]) });
    });
  }
  const raw = Buffer.from(bytes).toString("latin1");
  const fonts = [...new Set([...raw.matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([A-Za-z0-9-]+)/g)].map((m) => m[1]))];
  const all = pages.flat().map((l) => l.text).join("\n");
  return { numPages: doc.numPages, pages, links, images, fonts, all, raw };
}

const HEADINGS = ["NHIỆM VỤ / HƯỚNG DẪN CHUNG", "NHIỆM VỤ CỦA NHÓM", "Ý KIẾN CỦA NHÓM", "HÌNH ẢNH", "TỆP ĐÍNH KÈM / LIÊN KẾT"];
const bodyLines = (pageLines) => pageLines.filter((l) => !/^Trang \d+\/\d+$/.test(l.text) && !/Xuất lúc/.test(l.text));

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/test/group-pdf-v1/harness.html`);
  await page.waitForFunction(() => !!window.__pdf);

  await check("lazy loading: nothing from vendor/pdf is requested before an export", async () => {
    assert.deepEqual((await page.evaluate(() => window.__pdf.resources())).filter((r) => r.includes("/vendor/pdf/")), []);
  });

  await check("image preparation: downscale to <=1600px, JPEG normally, PNG only for real transparency, WebP->JPEG, EXIF orientation honored, bad bytes rejected", async () => {
    const r = await page.evaluate(async () => {
      const P = window.__pdf, out = {};
      const big = await P.makeImageBytes("image/jpeg", 3000, 2000);
      const a = await P.prepareImageForPdf(big, "image/jpeg"); out.big = { w: a.width, h: a.height, f: a.format, head: a.dataUrl.slice(0, 22) };
      const png = await P.prepareImageForPdf(await P.makeImageBytes("image/png", 640, 400, { alpha: true }), "image/png"); out.alphaPng = { w: png.width, h: png.height, f: png.format, head: png.dataUrl.slice(0, 22), px: (await P.inspectDataUrl(png.dataUrl)).bottomLeft };
      const opaque = await P.prepareImageForPdf(await P.makeImageBytes("image/png", 400, 300), "image/png"); out.opaquePng = { f: opaque.format };
      const webp = await P.prepareImageForPdf(await P.makeImageBytes("image/webp", 900, 600), "image/webp"); out.webp = { w: webp.width, h: webp.height, f: webp.format, head: webp.dataUrl.slice(0, 22) };
      const small = await P.prepareImageForPdf(await P.makeImageBytes("image/jpeg", 200, 100), "image/jpeg"); out.small = { w: small.width, h: small.height };
      const exif = await P.prepareImageForPdf(P.withExifOrientation(await P.makeImageBytes("image/jpeg", 400, 200), 6), "image/jpeg");
      const ins = await P.inspectDataUrl(exif.dataUrl); out.exif = { w: exif.width, h: exif.height, topRight: ins.topRight };
      try { await P.prepareImageForPdf(new Uint8Array([1, 2, 3, 4]), "image/jpeg"); out.bad = "no-error"; } catch { out.bad = "rejected"; }
      try { await P.prepareImageForPdf(new Uint8Array(), "image/jpeg"); out.empty = "no-error"; } catch { out.empty = "rejected"; }
      return out;
    });
    assert.deepEqual([r.big.w, r.big.h, r.big.f], [1600, 1067, "jpeg"]); assert.equal(r.big.head, "data:image/jpeg;base64");
    assert.equal(r.alphaPng.f, "png"); assert.equal(r.alphaPng.head, "data:image/png;base64,"); assert.equal(r.alphaPng.px[3], 0, "transparent corner stays transparent");
    assert.equal(r.opaquePng.f, "jpeg"); assert.equal(r.webp.f, "jpeg"); assert.equal(r.webp.head, "data:image/jpeg;base64");
    assert.deepEqual([r.webp.w, r.webp.h], [900, 600]); assert.deepEqual([r.small.w, r.small.h], [200, 100]);
    assert.deepEqual([r.exif.w, r.exif.h], [200, 400], "EXIF orientation 6 swaps the dimensions");
    assert.ok(r.exif.topRight[0] < 60 && r.exif.topRight[1] < 60 && r.exif.topRight[2] < 60, "the black top-left marker moved to the top-right after the 90 degree rotation");
    assert.equal(r.bad, "rejected"); assert.equal(r.empty, "rejected");
  });

  let first;
  await check("export without a times run: real download, Roboto only is fetched (Tinos stays lazy)", async () => {
    first = await exportAndDownload(() => page.evaluate(() => window.__pdf.run(window.__pdf.sampleExportInput({ topic: { topic: "Nhiệm vụ", topicRich: null } }))));
    const res = await page.evaluate(() => window.__pdf.resources().filter((r) => r.includes("/vendor/pdf/")));
    assert.ok(res.some((r) => r.includes("pdfmake.min.js")));
    for (const f of ["Regular", "Bold", "Italic", "BoldItalic"]) assert.ok(res.some((r) => r.endsWith(`Roboto-${f}.ttf`)), `Roboto-${f}`);
    assert.ok(!res.some((r) => r.includes("Tinos")), "Tinos must not be fetched when no content uses a times run");
    assert.deepEqual(first.result.usedFamilies, ["Roboto"]);
    const info = await inspect(first.bytes);
    assert.ok(!info.fonts.some((f) => f.startsWith("Tinos")));
  });

  let main, info;
  await check("export with a times run: real download, filename, and Tinos is fetched only now", async () => {
    main = await exportAndDownload(() => page.evaluate(() => window.__pdf.run(window.__pdf.sampleExportInput())));
    assert.equal(main.suggested, "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị - K77.B02 TPHCM - Nhóm 3.pdf");
    assert.equal(main.suggested, main.suggested.normalize("NFC"));
    const res = await page.evaluate(() => window.__pdf.resources().filter((r) => r.includes("/vendor/pdf/")));
    for (const f of ["Regular", "Bold", "Italic", "BoldItalic"]) assert.ok(res.some((r) => r.endsWith(`Tinos-${f}.ttf`)), `Tinos-${f}`);
    assert.deepEqual(main.result.progress, ["images", "layout", "library", "render"]);
    info = await inspect(main.bytes);
    if (process.env.DEBUG_PDF) console.log(info.pages.map((pg, n) => [`--- page ${n + 1}`, ...pg.map((l) => l.text)].join("\n")).join("\n"));
    assert.ok(info.fonts.includes("Tinos-BoldItalic") || info.fonts.some((f) => f.startsWith("Tinos")), `fonts: ${info.fonts}`);
    for (const f of ["Roboto-Regular", "Roboto-Bold", "Roboto-Italic"]) assert.ok(info.fonts.includes(f), `${f} embedded (${info.fonts})`);
  });

  await check("PDF content: title, class, group, section order, common task, group task, formatted Vietnamese, table", async () => {
    const t = info.all;
    for (const s of ["HCMA2 TEACHING", "KẾT QUẢ THẢO LUẬN NHÓM", "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị", "K77.B02 TPHCM", "Nhóm 3", "Đã đóng", "15 phút"]) assert.ok(has(t, s), s);
    const at = HEADINGS.map((h) => squash(t).indexOf(squash(h)));
    assert.ok(at.every((i) => i >= 0), `all headings present: ${at}`);
    assert.deepEqual(at.slice().sort((a, b) => a - b), at, "headings appear in the frozen order");
    for (const s of ["NHIỆM VỤ CHUNG — Đồng kiến tạo tri thức", "Anh/chị hãy đọc kỹ tình huống sư phạm, thảo luận trong nhóm và không dùng ý kiến cá nhân", "Mỗi thành viên nêu ít nhất một ý kiến.", "Ý phụ thụt lề mức 2", "Xác định vấn đề chính.", "Đoạn thụt lề mức 3", "Đoạn sau một dòng trống",
      "Nhiệm vụ nhóm 3: Phân tích nguyên nhân và đề xuất giải pháp.", "Nêu nguyên nhân khách quan", "Phương án", "Tốn thời gian chuẩn bị", "ặ ằ ẳ ẵ ố ồ ổ ỗ ộ ứ ừ ử ữ ự", "Ô trống ở giữa"]) assert.ok(has(t, s), s);
    assert.ok(/(^|\n)•/.test(t) && /(^|\n)1\./.test(t) && /(^|\n)3\./.test(t), "bullet and numbered markers");
  });

  await check("PDF content: notes (names only where they exist, createdAt shown), other groups excluded, no participantId/storagePath, placeholders counted", async () => {
    const t = info.all;
    for (const s of ["Nguyễn Thị Ánh Tuyết", "Trần Đức Bảo", "02:10:07 01/10/2026", "Dòng thứ hai của ý kiến để kiểm tra giữ xuống dòng.", "Ý kiến không có tên học viên"]) assert.ok(has(t, s), s);
    const n3 = info.pages.flat().find((l) => /^#3\b/.test(l.text));
    assert.ok(n3 && !/Nguyễn|Trần|Học viên/.test(n3.text), `note #3 has no invented name: ${n3 && n3.text}`);
    for (const s of ["Ý kiến của nhóm khác", "Học viên nhóm khác", "uidSENTINEL", "participantId", "storagePath", "groupActivitySubmissions", "groupActivityContent"]) assert.ok(!t.includes(s), `must not appear: ${s}`);
    assert.ok(!info.raw.includes("uidSENTINEL") && !info.raw.includes("groupActivitySubmissions"), "not even in the raw PDF bytes");
    assert.equal(main.result.stats.replacements, 5);
    assert.equal((t.match(new RegExp(cp(0xFFFD), "g")) || []).length, 5, "five visible U+FFFD placeholders in the extracted text");
    assert.ok(has(t, "tiếng Việt có dấu: ặ ằ ẳ ẵ ế ề ể ễ ệ."), "Vietnamese around the replaced characters is untouched");
    assert.ok(!/[\u{1F600}★→学习]/u.test(t), "no unsupported glyph leaks through");
  });

  await check("PDF content: embedded images keep aspect ratio; the failed photo is a visible placeholder and is counted", async () => {
    assert.equal(info.images.length, 4);
    const ratios = info.images.map((i) => Math.round((i.w / i.h) * 100) / 100).sort();
    assert.deepEqual(ratios, [1.5, 1.5, 1.6, 1.6]);
    for (const i of info.images) assert.ok(i.w <= 515.4 && i.h <= 520.1, `${i.w}x${i.h}`);
    assert.equal(main.result.stats.imageFailures, 1);
    assert.equal(main.result.stats.imagesEmbedded, 4);
    assert.ok(has(info.all, "[Không tải được ảnh]"));
    assert.ok(has(info.all, "Sơ đồ quy trình đồng kiến tạo"), "RichText image alt caption");
    assert.ok(has(info.all, "so-do-nhom-3.jpg"));
  });

  await check("PDF content: hyperlinks are real annotations — HCMA2 group page for uploads, direct URL for safe external links, nothing from Storage", async () => {
    const L = new Set(info.links);
    assert.ok(L.has("https://teaching.quantth.vn/#/group/Ab12Cd34Ef56Gh78"));
    assert.ok(L.has("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing"));
    for (const u of L) assert.ok(/^https:\/\/(teaching\.quantth\.vn|drive\.google\.com)\//.test(u), `unexpected link ${u}`);
    assert.ok(![...L].some((u) => /javascript:|firebasestorage|googleapis|token=/.test(u)));
    for (const s of ["Báo cáo nhóm 3.pdf", "2,3 MB", "Mở trong HCMA2 Teaching", "liên kết không hợp lệ hoặc không an toàn", "tệp cũ chưa được chuyển sang vùng lưu trữ an toàn"]) assert.ok(has(info.all, s), s);
  });

  await check("PDF layout: Trang x/y on every page, export timestamp, no stranded heading, text is searchable", async () => {
    assert.ok(info.numPages >= 2, `pages: ${info.numPages}`);
    info.pages.forEach((lines, i) => {
      assert.ok(lines.some((l) => squash(l.text).endsWith(`Trang${i + 1}/${info.numPages}`)), `footer on page ${i + 1}`);
      assert.ok(lines.some((l) => /Xuất lúc 01:15:07 02\/10\/2026/.test(l.text)), `export timestamp on page ${i + 1}`);
      const last = bodyLines(lines).at(-1);
      assert.ok(!HEADINGS.includes(last.text), `page ${i + 1} must not end with a heading: ${last.text}`);
    });
    const find = (needle) => info.pages.map((lines, i) => (lines.some((l) => squash(l.text).includes(squash(needle))) ? i + 1 : 0)).filter(Boolean);
    for (const needle of ["Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị", "Phát huy tính chủ động", "Nguyễn Thị Ánh Tuyết"]) assert.ok(find(needle).length >= 1, `searchable: ${needle}`);
    assert.ok(main.bytes.length < 400_000, `PDF size ${main.bytes.length}`);
  });

  await check("all images failing still produces a complete PDF with visible placeholders", async () => {
    const out = await exportAndDownload(() => page.evaluate(() => window.__pdf.run(window.__pdf.sampleExportInput(), { failAll: true })));
    assert.equal(out.result.stats.imageFailures, 5);
    assert.equal(out.result.stats.imagesEmbedded, 0);
    const i = await inspect(out.bytes);
    assert.equal(i.images.length, 0);
    assert.ok((i.all.match(/\[Không tải được ảnh/g) || []).length >= 5);
    assert.ok(has(i.all, "Báo cáo nhóm 3.pdf"));
  });

  await check("long multi-page export: every note once and in order, long list item and tall table complete, footers consistent, no stranded heading", async () => {
    const out = await exportAndDownload(() => page.evaluate(() => window.__pdf.run(window.__pdf.longExportInput())));
    const i = await inspect(out.bytes);
    assert.ok(i.numPages >= 6, `pages: ${i.numPages}`);
    const markers = i.pages.flat().map((l) => /^#(\d+)/.exec(l.text)).filter(Boolean).map((m) => Number(m[1]));
    assert.deepEqual(markers, Array.from({ length: 70 }, (_, k) => k + 1), "70 notes, each exactly once, in createdAt order");
    assert.equal((i.all.match(/ENDLONGITEM/g) || []).length, 1);
    assert.ok(i.all.includes("R10C4"), "tall table completed");
    for (let k = 1; k <= 14; k++) assert.ok(i.all.includes(`Đoạn ${k}:`), `paragraph ${k}`);
    i.pages.forEach((lines, k) => {
      assert.ok(lines.some((l) => squash(l.text).endsWith(`Trang${k + 1}/${i.numPages}`)), `footer p${k + 1}`);
      assert.ok(!HEADINGS.includes(bodyLines(lines).at(-1).text), `page ${k + 1} ends with a heading`);
    });
    console.log(`     long case: ${i.numPages} pages, ${out.bytes.length} bytes`);
  });

  assert.deepEqual(errors, []);
  if (process.env.KEEP_PDF_DIR) writeFileSync(path.join(process.env.KEEP_PDF_DIR, "group-pdf-sample.pdf"), main.bytes);
  console.log(`\n${checks.length}/${checks.length} PASS  (sample PDF: ${main.bytes.length} bytes, ${info.numPages} pages)`);
} finally {
  await browser.close();
  server.close();
}
