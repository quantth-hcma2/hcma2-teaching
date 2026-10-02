// Usage: node tools/gen-pdf-font-coverage.mjs <font-dir> <out.mjs>   (fontkit 2.0.4 must resolve, e.g. from pdfmake's tree)
// Generates group-pdf-font-coverage.mjs: for each family, the code points present in ALL FOUR faces (intersection),
// as sorted inclusive [start,end] ranges. Run from a folder where `fontkit` (pdfmake's dependency) resolves.
import * as fontkit from "fontkit"; import { readFileSync, writeFileSync } from "node:fs"; import { createHash } from "node:crypto";
const FONT_DIR = process.argv[2], OUT = process.argv[3];
const fams = { Roboto: ["Regular", "Bold", "Italic", "BoldItalic"], Tinos: ["Regular", "Bold", "Italic", "BoldItalic"] };
const out = {}, meta = {};
for (const [fam, styles] of Object.entries(fams)) {
  let inter = null; meta[fam] = {};
  for (const st of styles) { const buf = readFileSync(`${FONT_DIR}/${fam}-${st}.ttf`); const f = fontkit.create(buf); const set = new Set(f.characterSet);
    meta[fam][st] = { sha256: createHash("sha256").update(buf).digest("hex").toUpperCase(), version: f.version, glyphs: f.numGlyphs, codepoints: set.size };
    inter = inter ? new Set([...inter].filter(c => set.has(c))) : set; }
  const cps = [...inter].sort((a, b) => a - b); const ranges = []; let s = cps[0], p = cps[0];
  for (let i = 1; i < cps.length; i++) { if (cps[i] === p + 1) { p = cps[i]; continue; } ranges.push([s, p]); s = p = cps[i]; } ranges.push([s, p]);
  out[fam] = ranges; meta[fam].intersection = cps.length;
}
const hex = n => "0x" + n.toString(16).toUpperCase();
const body = Object.entries(out).map(([fam, r]) => `  ${fam}: [${r.map(([a, b]) => a === b ? `[${hex(a)},${hex(a)}]` : `[${hex(a)},${hex(b)}]`).join(",")}]`).join(",\n");
const header = `// GENERATED FILE — do not edit by hand. Code points that EVERY face (Regular/Bold/Italic/BoldItalic) of each
// embedded PDF font family can render, as sorted inclusive [start,end] ranges. Source: the cmap tables of the
// vendored TTF files listed in vendor/pdf/PROVENANCE.md (Roboto 3.015, Tinos 1.340), read with fontkit.
// Regenerate with tools/gen-pdf-font-coverage.mjs whenever a vendored font changes.
`;
writeFileSync(OUT, `${header}export const FONT_COVERAGE = Object.freeze({\n${body}\n});\n`);
console.log(JSON.stringify(meta, null, 1)); console.log("ranges:", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
