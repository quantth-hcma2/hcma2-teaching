// GROUP PDF V1 — browser runtime around the pure builder in group-pdf-export.mjs:
//   - lazy-loads the vendored pdfmake bundle and ONLY the font families the document actually uses
//     (Roboto always, Tinos only when a `times` run exists) — nothing is fetched until a teacher exports;
//   - prepares images (EXIF-correct decode, max ~1600px, JPEG normally, PNG only for real transparency);
//   - orchestrates one export: fetch images -> build document -> load library -> save the PDF.
// Image bytes come from an injected `fetchImageBytes` (index.html wires it to the existing authenticated
// Storage getBytes path). This module never builds a Storage URL and never touches Firebase itself.

import { normalizeGroupPdfInput, collectImageRequests, buildGroupPdfDocument } from "./group-pdf-export.mjs";

export const PDFMAKE_VERSION = "0.3.11";
const VENDOR_BASE = new URL("./vendor/pdf/", import.meta.url);
const FONT_FILES = Object.freeze({
  Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Bold.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-BoldItalic.ttf" },
  Tinos: { normal: "Tinos-Regular.ttf", bold: "Tinos-Bold.ttf", italics: "Tinos-Italic.ttf", bolditalics: "Tinos-BoldItalic.ttf" }
});
export const MAX_IMAGE_SIDE_PX = 1600;
const JPEG_QUALITY = 0.85;
const TRANSPARENT_PIXEL_RATIO = 0.002;
const IMAGE_CONCURRENCY = 3;

let libraryPromise = null;
const familyPromises = new Map();

function injectScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Không tải được bộ tạo PDF. Hãy kiểm tra kết nối mạng rồi thử lại."));
    document.head.appendChild(el);
  });
}

function ensureLibrary() {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      if (!globalThis.pdfMake) await injectScript(new URL(`pdfmake.min.js?v=${PDFMAKE_VERSION}`, VENDOR_BASE).href);
      const lib = globalThis.pdfMake;
      if (!lib || typeof lib.createPdf !== "function") throw new Error("Bộ tạo PDF không khả dụng.");
      // The document only ever contains data: images; forbid any other fetch during generation.
      if (typeof lib.setUrlAccessPolicy === "function") lib.setUrlAccessPolicy(() => false);
      return lib;
    })().catch((error) => { libraryPromise = null; throw error; });
  }
  return libraryPromise;
}

function ensureFamily(lib, family) {
  if (!familyPromises.has(family)) {
    const faces = FONT_FILES[family];
    familyPromises.set(family, (async () => {
      if (!faces) throw new Error(`Phông PDF không được hỗ trợ: ${family}`);
      await Promise.all(Object.values(faces).map(async (file) => {
        const response = await fetch(new URL(`fonts/${file}`, VENDOR_BASE).href);
        if (!response.ok) throw new Error("Không tải được phông chữ cho PDF. Hãy thử lại.");
        lib.virtualfs.writeFileSync(file, await response.arrayBuffer());
      }));
      lib.addFonts({ [family]: faces });
    })().catch((error) => { familyPromises.delete(family); throw error; }));
  }
  return familyPromises.get(family);
}

export async function loadPdfMake(families) {
  const lib = await ensureLibrary();
  await Promise.all([...families].map((family) => ensureFamily(lib, family)));
  return lib;
}

// ------------------------------------------------------------------ images
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function hasMeaningfulTransparency(context, width, height) {
  const data = context.getImageData(0, 0, width, height).data;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
  return transparent / (width * height) > TRANSPARENT_PIXEL_RATIO;
}

// createImageBitmap applies EXIF orientation (a raw JPEG embedded as-is would not), so every image is decoded
// and re-encoded here. JPEG/opaque PNG/opaque WebP -> JPEG; PNG/WebP with real transparency -> PNG.
export async function prepareImageForPdf(bytes, mimeType, { maxSide = MAX_IMAGE_SIDE_PX } = {}) {
  if (!bytes || !bytes.byteLength) throw new Error("empty image");
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType || "" }));
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (mimeType !== "image/jpeg") {
      context.drawImage(bitmap, 0, 0, width, height);
      if (hasMeaningfulTransparency(context, width, height)) {
        const png = await canvasToBlob(canvas, "image/png");
        return { dataUrl: await blobToDataUrl(png), width, height, format: "png" };
      }
      context.clearRect(0, 0, width, height);
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
    return { dataUrl: await blobToDataUrl(jpeg), width, height, format: "jpeg" };
  } finally {
    bitmap.close?.();
  }
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; await worker(items[index], index); }
  });
  await Promise.all(lanes);
}

async function defaultSave(lib, docDefinition, fileName) {
  await lib.createPdf(docDefinition).download(fileName);
}

// One export of one group. Image failures never abort the PDF: the document gets a visible placeholder and
// the failure is counted in `stats.imageFailures`. Everything else (library load, layout) throws.
export async function exportGroupPdf(input, deps) {
  const {
    fetchImageBytes, prepareImage = prepareImageForPdf, loadLibrary = loadPdfMake, save = defaultSave,
    now = new Date(), timeZone, onProgress = () => {}
  } = deps || {};
  if (typeof fetchImageBytes !== "function") throw new TypeError("exportGroupPdf: fetchImageBytes is required");
  const model = normalizeGroupPdfInput(input);
  const requests = collectImageRequests(model);
  const images = new Map();
  let done = 0;
  onProgress({ stage: "images", done, total: requests.length });
  await mapLimit(requests, IMAGE_CONCURRENCY, async (request) => {
    try {
      const bytes = await fetchImageBytes(request);
      images.set(request.key, await prepareImage(bytes, request.mimeType));
    } catch { /* placeholder is rendered by the builder and counted */ }
    onProgress({ stage: "images", done: ++done, total: requests.length });
  });
  onProgress({ stage: "layout" });
  const built = buildGroupPdfDocument(model, { images, now, timeZone });
  onProgress({ stage: "library" });
  const lib = await loadLibrary(built.usedFamilies);
  onProgress({ stage: "render" });
  await save(lib, built.docDefinition, built.fileName);
  return { fileName: built.fileName, stats: built.stats, usedFamilies: [...built.usedFamilies] };
}
