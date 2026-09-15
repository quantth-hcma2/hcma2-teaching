// GATE 4C-B — Compact participant mode: density/scroll-cap/sticky-header only.
// PURE test, no emulator. Extracts real shipped source from index.html (never a hand-written
// reimplementation) and, where the gate requires "unchanged", diffs against the exact 4C-A
// checkpoint commit (c5d649b8d4f4eecdd4336d513575fc293621d01e) via git — not a hand-copied
// frozen string, so this can never silently drift from what was actually approved at 4C-A.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const indexPath = path.join(repoRoot, "index.html");
const CHECKPOINT_4CA = "c5d649b8d4f4eecdd4336d513575fc293621d01e";

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const checkpointSource = execFileSync("git", ["show", `${CHECKPOINT_4CA}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const escSrc = sliceBetween(source, "function esc(s){", "\n", "esc()");
const labelsSrc = sliceBetween(source, "const KN_PARTICIPANT_FIELD_LABELS=", ";", "KN_PARTICIPANT_FIELD_LABELS") + ";";
const markupSrc = sliceBetween(source, "function knowledgeParticipantsMarkup(", "\n  }\n  // GATE 4C-A: Compact mount", "knowledgeParticipantsMarkup()") + "\n  }";
const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "knowledgeRenderParticipantsCompact()") + "\n  }";
const cssBlock = sliceBetween(source, ":root{", "\n/* Badges */", "root CSS block");

// ===================================================================================
// 2/3/4/5 — knowledgeParticipantsMarkup() and knowledgeRenderParticipantsCompact()
// (columns, filtering, progress/status, Refresh wiring) must be byte-identical to 4C-A
// ===================================================================================

test("GATE 4C-B: knowledgeParticipantsMarkup() unchanged since 4C-A checkpoint (columns/filter/progress semantics frozen)", () => {
  const checkpointMarkup = sliceBetween(checkpointSource, "function knowledgeParticipantsMarkup(", "\n  }\n  // GATE 4C-A: Compact mount", "checkpoint markup") + "\n  }";
  assert.equal(markupSrc, checkpointMarkup);
});

test("GATE 4C-B: knowledgeRenderParticipantsCompact()'s Refresh/Export wiring unchanged since 4C-A checkpoint", () => {
  // Narrowed at GATE 4C-C: that gate's own explicitly authorized scope was to move this
  // function's filter-handling lines into knPfViewState (see test/gate4c-c/view-state.test.mjs
  // for the up-to-date guard on that), so whole-function byte-identity against the 4C-A
  // checkpoint is no longer the correct invariant here. What 4C-B itself actually touched
  // (and must stay true) is that it never touched Refresh/Export — verify only that.
  assert.match(compactFnSrc, /\$\("#knPfRefresh"\)\.onclick=\(\)=>\{if\(!participantsLoading\)loadParticipants\(\);\};/);
  assert.match(compactFnSrc, /\$\("#knPfExport"\)\.onclick=knowledgeExportParticipants;/);
});

// ===================================================================================
// 6/17 — CSV export and 16 — loadParticipants(): must still be untouched since origin/main
// ===================================================================================

test("GATE 4C-B: loadParticipants() and knowledgeExportParticipants() still byte-identical to the 4C-A-verified frozen baseline", () => {
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", "\n  }", "loadParticipants()") + "\n  }";
  const checkpointLoad = sliceBetween(checkpointSource, "async function loadParticipants(){", "\n  }", "checkpoint loadParticipants()") + "\n  }";
  assert.equal(loadSrc, checkpointLoad);
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }", "knowledgeExportParticipants()") + "\n  }";
  const checkpointExport = sliceBetween(checkpointSource, "async function knowledgeExportParticipants(){", "\n  }", "checkpoint knowledgeExportParticipants()") + "\n  }";
  assert.equal(exportSrc, checkpointExport);
});

// ===================================================================================
// 1 — Compact card still renders, now carrying the kn-pf-compact scope class
// ===================================================================================

test("GATE 4C-B: #knPfWrap now carries the kn-pf-compact class (Compact card still renders)", () => {
  assert.match(source, /<div id="knPfWrap" class="kn-pf-compact">/);
});

// ===================================================================================
// 7/8/9/10 — CSS scoping: vertical cap + sticky header, scoped only to Compact,
// horizontal-scroll base rule untouched, no global sticky leakage onto unrelated tables
// ===================================================================================

test("GATE 4C-B: base .table-wrap horizontal-scroll rule is untouched (requirement 6/8)", () => {
  assert.match(cssBlock, /\.table-wrap\{overflow-x:auto;\}/);
});

test("GATE 4C-B: vertical scroll cap is scoped to .kn-pf-compact only (requirement 4/7)", () => {
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap\{max-height:320px; overflow-y:auto;\}/);
  // must NOT exist as a bare, unscoped rule on .table-wrap itself
  assert.doesNotMatch(cssBlock, /(?<!kn-pf-compact )\.table-wrap\{[^}]*max-height/);
});

test("GATE 4C-B: sticky header is scoped to .kn-pf-compact only (requirement 5/9/10)", () => {
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap thead th\{position:sticky; top:0;/);
  // the ONLY other position:sticky in this CSS block must be the pre-existing, unrelated
  // app-shell top bar (frozen, Item-unrelated) — never a bare `thead th{position:sticky`
  // or any other unscoped table-header rule.
  assert.doesNotMatch(cssBlock, /(?<!kn-pf-compact \.table-wrap )thead th\{position:sticky/);
  const stickyOccurrences = (cssBlock.match(/position:\s*sticky/g) || []).length;
  assert.equal(stickyOccurrences, 2, "expected exactly 2 position:sticky rules: the pre-existing app-shell bar + the new kn-pf-compact header");
});

// ===================================================================================
// 11 — empty state still correct, executed against the real extracted function
// ===================================================================================

function buildMarkupFn() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;`, sandbox);
  return sandbox.__markup;
}

test("GATE 4C-B: empty state (0 participants) still renders correctly through the Compact-scoped markup", () => {
  const markup = buildMarkupFn();
  const html = markup([], new Map(), { minimumPerParticipant: 3, participantFields: {} }, "all");
  assert.match(html, /Không có người tham gia phù hợp\./);
  assert.match(html, /<strong>0<\/strong>\s*<span>Đã đăng ký<\/span>/);
});

// ===================================================================================
// 12/13/14/15 — no future Item 4 controls exist yet
// ===================================================================================

test("GATE 4C-B: no Expanded, Fullscreen, or Search exist yet", () => {
  assert.doesNotMatch(source, /MỞ RỘNG/);
  assert.doesNotMatch(source, /TOÀN MÀN HÌNH/);
  assert.doesNotMatch(source, /is-fullscreen/);
  // knPfViewState: out of scope for 4C-B itself (still true), but GATE 4C-C later added it as
  // its own authorized shared UI state foundation — see test/gate4c-c/view-state.test.mjs.
  assert.doesNotMatch(source, /knPfSearch/);
});
