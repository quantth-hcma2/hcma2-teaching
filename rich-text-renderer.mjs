// GATE 2B-RT-CONTRACT — shared SAFE renderer for RichText V1. Intended to eventually serve all
// four production call sites identically (lecturer common instructions, student common
// instructions, lecturer per-group topics, student per-group topics) — NOT wired into index.html
// in this gate; this module is standalone and independently testable.
//
// Whole-document fail-closed policy: if the stored rich value does not pass validateRichTextV1()
// in full, NOTHING from it is rendered — not even the valid-looking blocks. The legacy plain-text
// mirror is rendered instead, via the exact same safe textContent-based path used for genuinely
// legacy (pre-RichText) content. Lecturer and student get identical fallback behavior because both
// call this same function.
//
// Hard rules enforced by this module (see GATE 2B-RT-DESIGN §16 XSS threat matrix):
//   - never assigns stored content to .innerHTML
//   - never sets an attribute from stored data
//   - never parses stored content as HTML
//   - never interpolates a stored token string directly into a CSS value — every formatting
//     token is looked up in a fixed map; a token missing from the map is silently ignored
//     (falls back to inherited styling), never passed through as raw CSS.
//   - builds every node via createElement(); every piece of user text is written via
//     .textContent only.

import { validateRichText, legacyImageTextFallback } from "./rich-text-contract.mjs";

// Fixed lookup maps — the ONLY way a formatting token can ever influence a CSS property. A token
// not present here (which validateRichTextV1 should already have rejected upstream) is simply
// ignored by the renderer as an independent, defense-in-depth guard — it can never become a raw
// CSS value.
export const FONT_CSS_MAP = Object.freeze({
  default: null,
  arial: "Arial, Helvetica, sans-serif",
  times: '"Times New Roman", Times, serif',
  roboto: "Roboto, Arial, sans-serif"
});
export const SIZE_CSS_MAP = Object.freeze({
  14: "14px",
  16: "16px",
  18: "18px",
  20: "20px",
  24: "24px"
});
// Fixed, accessible (sufficient contrast against a light UI background) hex values — chosen once
// here, never derived from stored data.
export const COLOR_CSS_MAP = Object.freeze({
  default: null,
  red: "#b91c1c",
  blue: "#1d4ed8",
  green: "#15803d",
  orange: "#c2410c",
  purple: "#7e22ce"
});

function resolveDoc(explicitDoc) {
  if (explicitDoc) return explicitDoc;
  if (typeof document !== "undefined") return document;
  throw new TypeError("renderRichText: no document available — pass one explicitly outside a browser context");
}

function clearContainer(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function renderLegacyPlainText(container, legacyPlainText, doc) {
  const p = doc.createElement("p");
  p.style.whiteSpace = "pre-wrap";
  p.style.margin = "0";
  // The ONLY text-insertion mechanism anywhere in this module: textContent. A legacy string that
  // literally contains "<script>alert(1)</script>" (or any other markup-looking text) is written
  // here as inert text and displays exactly as typed — it is never parsed as markup.
  p.textContent = String(legacyPlainText ?? "");
  container.appendChild(p);
}

function renderRun(run, doc) {
  const span = doc.createElement("span");
  span.textContent = run.text;
  if (run.bold === true) span.style.fontWeight = "700";
  if (run.italic === true) span.style.fontStyle = "italic";
  if (run.font && Object.prototype.hasOwnProperty.call(FONT_CSS_MAP, run.font) && FONT_CSS_MAP[run.font]) {
    span.style.fontFamily = FONT_CSS_MAP[run.font];
  }
  if (run.size && Object.prototype.hasOwnProperty.call(SIZE_CSS_MAP, run.size) && SIZE_CSS_MAP[run.size]) {
    span.style.fontSize = SIZE_CSS_MAP[run.size];
  }
  if (run.color && Object.prototype.hasOwnProperty.call(COLOR_CSS_MAP, run.color) && COLOR_CSS_MAP[run.color]) {
    span.style.color = COLOR_CSS_MAP[run.color];
  }
  return span;
}

/**
 * Renders RichText V1 content (or a legacy plain-text fallback) into `container`.
 *
 * @param {*} container - a DOM element (or DOM-like object) to render into. Cleared first.
 * @param {*} richValue - the candidate RichText V1 document (or null/undefined/anything else).
 * @param {string} legacyPlainText - the plain-text mirror to fall back to when richValue is
 *   absent or fails whole-document validation.
 * @param {*} [doc] - optional Document-like object (for non-browser/test environments); defaults
 *   to the global `document` when available.
 */
export function renderRichText(container, richValue, legacyPlainText, doc, options = {}) {
  const d = resolveDoc(doc);
  clearContainer(container);

  const isValid = richValue !== null && richValue !== undefined && validateRichText(richValue, options.imageContext);
  if (!isValid) {
    const compatibleText=legacyImageTextFallback(richValue,options.imageContext);
    renderLegacyPlainText(container, compatibleText ?? legacyPlainText, d);
    return;
  }

  for (const block of richValue.blocks) {
    if (block.type === "image") {
      const figure = d.createElement("figure");
      figure.className = "rt-image";
      const img = d.createElement("img");
      img.alt = block.alt;
      img.loading = "lazy";
      figure.appendChild(img);
      if (block.alt) { const caption = d.createElement("figcaption"); caption.textContent = block.alt; figure.appendChild(caption); }
      container.appendChild(figure);
      if (typeof options.resolveImageUrl === "function") {
        Promise.resolve(options.resolveImageUrl(block.storagePath)).then(url => {
          if (typeof url === "string" && /^(?:https?:\/\/|blob:)/i.test(url) && img.isConnected) {
            img.src = url;
            // Blob URLs come only from the trusted resolver after an authenticated Storage read.
            // Revoke after the image has loaded/failed so the capability is process-local and
            // short-lived; stored RichText never controls a URL or attribute directly.
            if (/^blob:/i.test(url) && typeof img.addEventListener === "function") {
              const revoke=()=>URL.revokeObjectURL(url);
              img.addEventListener("load",revoke,{once:true}); img.addEventListener("error",revoke,{once:true});
            }
          }
        }).catch(error => { figure.classList.add("rt-image-error"); figure.dataset.imageError=String(error?.code||"load-failed").slice(0,80); });
      }
      continue;
    }
    if (block.type === "table") {
      const wrap = d.createElement("div"); wrap.className = "rt-table-wrap";
      const table = d.createElement("table"); table.className = "rt-table";
      const tbody = d.createElement("tbody");
      block.rows.forEach(row => { const tr = d.createElement("tr"); row.cells.forEach(cell => { const td = d.createElement("td"); if(typeof cell === "string") td.textContent = cell; else cell.runs.forEach(run=>td.appendChild(renderRun(run,d))); tr.appendChild(td); }); tbody.appendChild(tr); });
      table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
      continue;
    }
    const p = d.createElement("p");
    p.style.whiteSpace = "pre-wrap";
    p.style.margin = "0 0 0.5em 0";
    for (const run of block.runs) {
      p.appendChild(renderRun(run, d));
    }
    container.appendChild(p);
  }
}
