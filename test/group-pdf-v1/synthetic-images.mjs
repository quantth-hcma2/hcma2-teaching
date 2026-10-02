// GROUP PDF V1 — browser-only helpers that fabricate image bytes in-page (canvas) so tests and the Owner QA page
// never need a real photo or Storage. Each image has a black top-left square and a red bottom-right triangle so
// orientation/aspect mistakes are visible.
function drawSample(w, h, { alpha = false, label = "Ảnh thử nghiệm" } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  if (!alpha) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#0e7490"); gr.addColorStop(1, "#f59e0b"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  else { g.clearRect(0, 0, w, h); g.fillStyle = "rgba(14,116,144,0.9)"; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.42, h * 0.4, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#fff"; g.font = `bold ${Math.max(12, Math.round(h / 9))}px sans-serif`; g.fillText(`${label} ${w}x${h}`, w * 0.06, h * 0.2);
  g.fillStyle = "#000"; g.fillRect(0, 0, Math.max(8, w / 20), Math.max(8, w / 20));
  g.fillStyle = "#dc2626"; g.beginPath(); g.moveTo(w - 4, h - 4); g.lineTo(w - w / 6, h - 4); g.lineTo(w - 4, h - h / 4); g.fill();
  return c;
}
const toBytes = async (canvas, type, q) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, type, q))).arrayBuffer());

export async function makeImageBytes(type, w, h, opts = {}) {
  const canvas = drawSample(w, h, opts);
  return toBytes(canvas, type, 0.9);
}

// Inserts an EXIF APP1 segment carrying only the Orientation tag right after SOI.
export function withExifOrientation(jpegBytes, orientation) {
  const tiff = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = exif.length + 2;
  const segment = [0xFF, 0xE1, (len >> 8) & 0xFF, len & 0xFF, ...exif];
  const out = new Uint8Array(jpegBytes.length + segment.length);
  out.set(jpegBytes.subarray(0, 2), 0); out.set(segment, 2); out.set(jpegBytes.subarray(2), 2 + segment.length);
  return out;
}

export async function inspectDataUrl(dataUrl) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const px = (x, y) => Array.from(g.getImageData(Math.max(0, Math.min(c.width - 1, x)), Math.max(0, Math.min(c.height - 1, y)), 1, 1).data);
  return { width: c.width, height: c.height, topLeft: px(3, 3), topRight: px(c.width - 4, 3), bottomLeft: px(3, c.height - 4), bottomRight: px(c.width - 6, c.height - 6), corner00: px(0, 0) };
}

// Image bytes for the sample fixtures, keyed like the builder's requests.
export async function sampleImageBytes(request) {
  if (request.key.endsWith("/p3.png") || request.key === "photo:p3") throw Object.assign(new Error("denied"), { code: "storage/unauthorized" });
  if (request.key === "photo:p1") return makeImageBytes("image/jpeg", 1200, 800, { label: "Ảnh nhóm" });
  if (request.key === "photo:p2") return makeImageBytes("image/webp", 900, 600, { label: "WebP" });
  if (request.key.endsWith("/pic2.png")) return makeImageBytes("image/png", 640, 400, { alpha: true, label: "PNG alpha" });
  return makeImageBytes("image/jpeg", 2400, 1500, { label: "Sơ đồ" });
}
