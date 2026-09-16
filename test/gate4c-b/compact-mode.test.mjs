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
// Bounded by a stable CODE token (the function's own last statement), not a neighboring
// comment, so this never silently over-captures if a nearby comment is reworded (as happened
// once GATE 4C-D.2 inserted wireParticipantControls() with its own leading comment).
const markupSrc = sliceBetween(source, "function knowledgeParticipantsMarkup(", "</tbody></table></div>`;\n  }", "knowledgeParticipantsMarkup()") + "</tbody></table></div>`;\n  }";
const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "knowledgeRenderParticipantsCompact()") + "\n  }";
const cssBlock = sliceBetween(source, ":root{", "\n/* Badges */", "root CSS block");

// ===================================================================================
// 2/3/4/5 — knowledgeParticipantsMarkup() and knowledgeRenderParticipantsCompact()
// (columns, filtering, progress/status, Refresh wiring) must be byte-identical to 4C-A
// ===================================================================================

// NOTE: the "knowledgeParticipantsMarkup() unchanged since 4C-A" byte-identity test that
// originally stood here is retired as of GATE 4C-C.2, which explicitly and correctly changed
// knowledgeParticipantsMarkup()'s signature and filtering body (added classFilter as a second,
// AND-combined dimension) — 4C-B's own diff never touched this function (only CSS + one class
// attribute), so there is no narrower true statement left to make here. See
// test/gate4c-c2/filter-contract.test.mjs for the up-to-date, in-depth coverage of this
// function's actual current behavior.

test("GATE 4C-B: knowledgeRenderParticipantsCompact() still wires Refresh/Export (now via the shared wireParticipantControls() helper introduced by GATE 4C-D.2)", () => {
  // Narrowed again at GATE 4C-D.2: that gate factored the inline Refresh/Export wiring into a
  // shared helper reused by Expanded — the exact behavior is now verified in depth by
  // test/gate4c-d2/expanded-mode.test.mjs. What 4C-B itself actually touched (and must stay
  // true) is that Compact still ends up correctly wired, through whatever indirection exists now.
  assert.match(compactFnSrc, /wireParticipantControls\(wrap,knowledgeRenderParticipantsCompact\)/);
});

// ===================================================================================
// 6/17 — CSV export and 16 — loadParticipants(): must still be untouched since origin/main
// ===================================================================================

test("GATE 4C-B: knowledgeExportParticipants() still byte-identical to the 4C-A-verified frozen baseline; loadParticipants()'s fetch logic unchanged (only its final dispatch line legitimately changed, by GATE 4C-D.2)", () => {
  // Bounded by the catch-block-close + final participantsLoading=false reset — the last line
  // every version of loadParticipants() has always shared before its dispatch call.
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "loadParticipants()") + commonTail;
  const checkpointLoad = sliceBetween(checkpointSource, "async function loadParticipants(){", commonTail, "checkpoint loadParticipants()") + commonTail;
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

test("GATE 4C-B: vertical scroll cap is scoped to .kn-pf-compact only (requirement 4/7) — GATE 4C-D.2 SMOKE FIX legitimately added a second, equally-scoped .kn-pf-expanded rule for Expanded's own table area; this still guards against any BARE, unscoped .table-wrap rule", () => {
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap\{max-height:320px; overflow-y:auto;\}/);
  // must NOT exist as a bare, unscoped rule on .table-wrap itself — .kn-pf-compact and
  // .kn-pf-expanded are the only two approved scopes (see test/gate4c-d2/expanded-mode.test.mjs
  // for the up-to-date, in-depth guard on the Expanded-specific rule).
  assert.doesNotMatch(cssBlock, /(?<!kn-pf-compact |kn-pf-expanded )\.table-wrap\{[^}]*max-height/);
});

test("GATE 4C-B: sticky header is scoped to .kn-pf-compact only (requirement 5/9/10) — GATE 4C-D.2 SMOKE FIX legitimately added a second, equally-scoped .kn-pf-expanded sticky header rule; this still guards against any BARE, unscoped thead sticky rule", () => {
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap thead th\{position:sticky; top:0;/);
  // the ONLY other position:sticky rules in this CSS block must be the pre-existing, unrelated
  // app-shell top bar (frozen, Item-unrelated) and the GATE 4C-D.2 SMOKE FIX .kn-pf-expanded
  // table header — never a bare `thead th{position:sticky` or any other unscoped rule.
  assert.doesNotMatch(cssBlock, /(?<!kn-pf-compact \.table-wrap |kn-pf-expanded \.table-wrap )thead th\{position:sticky/);
  const stickyOccurrences = (cssBlock.match(/position:\s*sticky/g) || []).length;
  assert.equal(stickyOccurrences, 3, "expected exactly 3 position:sticky rules: the pre-existing app-shell bar + kn-pf-compact header + the GATE 4C-D.2 SMOKE FIX kn-pf-expanded header");
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

test("GATE 4C-B: no Fullscreen or Search exist yet", () => {
  assert.doesNotMatch(source, /TOÀN MÀN HÌNH/);
  assert.doesNotMatch(source, /is-fullscreen/);
  // knPfViewState (4C-C) and MỞ RỘNG/Expanded (4C-D.2): out of scope for 4C-B itself (still
  // true), but both were later added by their own authorized gates — see
  // test/gate4c-d2/expanded-mode.test.mjs for the up-to-date guard on what's still not built.
  assert.doesNotMatch(source, /knPfSearch/);
});
