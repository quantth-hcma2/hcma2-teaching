// GATE 4C-E.3 — narrow-viewport (~390x700) Fullscreen hotfix for the Knowledge participant
// Expanded/Fullscreen view. PURE test, no emulator, no browser. Extracts real shipped source out
// of index.html and diffs against the exact pre-hotfix baseline commit via git — never a
// hand-copied frozen string. This is a NEW test area; no historical test file is modified.
//
// The geometry claims this hotfix is built on (table-wrap ~34.4px pre-fix vs. ~327.4px post-fix
// at 390x700, zero horizontal/document overflow, sticky header intact) were established by real
// Playwright browser measurement during the read-only audit and the implementation-candidate
// verification pass for this gate; they are not re-derivable from static source alone and are not
// re-asserted numerically here. What IS statically provable — and is what this file proves — is
// that the CSS added to reach that measured result is exactly as narrow, additive, and
// non-destructive as the audit specified.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const indexPath = path.join(repoRoot, "index.html");
const BASELINE = "affb0edb7ab2c5787113ad82519a4207e758cd83"; // pre-hotfix HEAD of this worktree

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const baselineSource = execFileSync("git", ["show", `${BASELINE}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const cssBlock = sliceBetween(source, "<style>", "</style>", "css");
const baselineCssBlock = sliceBetween(baselineSource, "<style>", "</style>", "baseline css");
const scriptSrc = sliceBetween(source, '<script type="module">', "</script>", "script");
const baselineScriptSrc = sliceBetween(baselineSource, '<script type="module">', "</script>", "baseline script");

const HOTFIX_START_MARKER = "/* GATE 4C-E.3:";
const HOTFIX_END_MARKER = ".modal.is-fullscreen .kn-pf-expanded > .flex.gap-8.mt-8 > select,\n.modal.is-fullscreen .kn-pf-expanded > .flex.gap-8.mt-8 > input[type=text]{width:auto; flex:1 1 150px; min-width:120px;}";
const hotfixCss = sliceBetween(cssBlock, HOTFIX_START_MARKER, HOTFIX_END_MARKER, "hotfix css") + HOTFIX_END_MARKER;
// the hotfix's own explanatory comment prose mentions "width:100%" and ".table-wrap" as prior-art
// context, so rule-body checks below must operate on the rules alone, comment stripped.
const hotfixCssRulesOnly = hotfixCss.replace(/\/\*[\s\S]*?\*\//, "").trim();

// ===================================================================================
// Item 1/6/7/8 — the hotfix CSS is scoped exclusively to Knowledge-participant Fullscreen:
// every rule requires the compound `.modal.is-fullscreen .kn-pf-expanded` ancestor chain, which
// is structurally impossible to match Compact (no .modal ancestor), normal non-Fullscreen
// Expanded (.modal-lg without .is-fullscreen), or any other .modal/.modal-lg consumer (none use
// .kn-pf-expanded).
// ===================================================================================

test("GATE 4C-E.3: every hotfix CSS rule requires the compound .modal.is-fullscreen .kn-pf-expanded ancestor chain", () => {
  const ruleSelectors = hotfixCss
    .replace(/\/\*[\s\S]*?\*\//, "") // strip the leading comment
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => line.slice(0, line.indexOf("{")).trim());
  assert.ok(ruleSelectors.length >= 4, "expected at least 4 hotfix rules");
  for (const sel of ruleSelectors) {
    for (const part of sel.split(",")) {
      assert.match(part.trim(), /^\.modal\.is-fullscreen \.kn-pf-expanded\b/, `rule "${part.trim()}" is not scoped to .modal.is-fullscreen .kn-pf-expanded`);
    }
  }
});

test("GATE 4C-E.3: kn-pf-expanded never appears in any other feature's JS (confining the hotfix's reach to the Knowledge dashboard closure)", () => {
  const styleEnd = source.indexOf("</style>");
  const knowledgeSectionStart = source.indexOf("async function knowledgeDashboard(");
  assert.notEqual(styleEnd, -1);
  assert.notEqual(knowledgeSectionStart, -1);
  const idxs = [];
  let idx = source.indexOf("kn-pf-expanded");
  while (idx !== -1) { idxs.push(idx); idx = source.indexOf("kn-pf-expanded", idx + 1); }
  assert.ok(idxs.length > 0);
  const inOtherFeatureCode = idxs.some((i) => i >= styleEnd && i < knowledgeSectionStart);
  assert.equal(inOtherFeatureCode, false);
});

test("GATE 4C-E.3: is-fullscreen remains applied only conditionally (wantFullscreen guard), so normal Expanded can never carry it", () => {
  const expandedFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsExpanded(", "\n  }", "expandedFn") + "\n  }";
  assert.match(expandedFnSrc, /if\(wantFullscreen\)modalEl\.classList\.add\('is-fullscreen'\);/);
});

test("GATE 4C-E.3: Compact's own render path never opens a .modal and never carries kn-pf-expanded", () => {
  const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "compactFn") + "\n  }";
  assert.doesNotMatch(compactFnSrc, /openModal\(/);
  assert.doesNotMatch(compactFnSrc, /kn-pf-expanded/);
});

// ===================================================================================
// Item 2/3 — the pre-existing GLOBAL .grid-3 rule and the global select/input width:100% rule
// are untouched; the hotfix works entirely by adding new, more-specific overrides, never by
// editing the general-purpose rules shared by every other feature.
// ===================================================================================

test("GATE 4C-E.3: global .grid-3 rule and its <600px stacking media query are byte-identical to baseline (no shared rule edited)", () => {
  const globalGrid3 = sliceBetween(cssBlock, ".grid-3{", "}", "global grid-3") + "}";
  const baselineGlobalGrid3 = sliceBetween(baselineCssBlock, ".grid-3{", "}", "baseline global grid-3") + "}";
  assert.equal(globalGrid3, baselineGlobalGrid3);
  const mediaQuery = "@media(max-width:600px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr;}}";
  assert.match(cssBlock, new RegExp(mediaQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("GATE 4C-E.3: global input/select width:100% rule is byte-identical to baseline (no shared rule edited)", () => {
  const globalControlStart = "input[type=text], input[type=email], input[type=password], input[type=number], input[type=date],\nselect, textarea{";
  const globalControlRule = sliceBetween(cssBlock, globalControlStart, "\n}", "global control rule") + "\n}";
  const baselineGlobalControlRule = sliceBetween(baselineCssBlock, globalControlStart, "\n}", "baseline global control rule") + "\n}";
  assert.equal(globalControlRule, baselineGlobalControlRule);
});

// ===================================================================================
// Item 4/17/18/19 — no JS production change whatsoever: the entire module script is
// byte-identical to the pre-hotfix baseline, which by construction also preserves the ESC
// contract, the Close contract, Refresh, CSV export, and introduces zero new Firestore
// reads/listeners (all of it is JS, none of it touched).
// ===================================================================================

test("GATE 4C-E.3: the entire JS module script is byte-identical to the pre-hotfix baseline (pure-CSS hotfix, zero JS change — this alone preserves ESC/Close/Refresh/CSV/Firestore-call-count contracts)", () => {
  assert.equal(scriptSrc, baselineScriptSrc);
});

// ===================================================================================
// Item 5 — no Search implementation anywhere (this hotfix is fully independent of, and must
// never absorb, the separate uncommitted Search V1 candidate)
// ===================================================================================

test("GATE 4C-E.3: no Search implementation exists in this worktree (knPfSearch absent everywhere)", () => {
  assert.doesNotMatch(source, /knPfSearch/);
  assert.doesNotMatch(source, /knPfNormalizeSearch/);
  assert.doesNotMatch(source, /knPfSearchableText/);
});

// ===================================================================================
// Item 9/10 — the two concrete overrides the audit specified are present verbatim: 3-column
// summary grid preserved at narrow width, and controls compacted onto a flex-wrap row instead of
// each forcing width:100%.
// ===================================================================================

test("GATE 4C-E.3: Fullscreen summary grid override keeps repeat(3,1fr) (undoes the global <600px single-column stacking, Fullscreen-participant-scoped only)", () => {
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3\{grid-template-columns:repeat\(3,1fr\); gap:8px;\}/);
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3 \.card\.knowledge-stat\{padding:10px;\}/);
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3 \.card\.knowledge-stat strong\{font-size:20px;\}/);
});

test("GATE 4C-E.3: Fullscreen control-row override compacts status/class selects onto a flex-wrap row (undoes the global width:100% forcing, Fullscreen-participant-scoped only)", () => {
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded > \.flex\.gap-8\.mt-8 > select,\n\.modal\.is-fullscreen \.kn-pf-expanded > \.flex\.gap-8\.mt-8 > input\[type=text\]\{width:auto; flex:1 1 150px; min-width:120px;\}/);
});

// ===================================================================================
// Item 11 — table-wrap receives usable height purely as a consequence of shrinking its siblings;
// the hotfix must contain no rule that targets .table-wrap directly (the pre-existing table-wrap
// flex/min-height CSS from GATE 4C-E was already correct and is left untouched).
// ===================================================================================

test("GATE 4C-E.3: the hotfix contains no rule targeting .table-wrap directly (height gain comes from shrinking siblings, not from touching table-wrap's own already-correct flex CSS)", () => {
  assert.doesNotMatch(hotfixCssRulesOnly, /\.table-wrap/);
  const tableWrapRule = ".modal.is-fullscreen .kn-pf-expanded .table-wrap{flex:1 1 auto; min-height:0; max-height:none; overflow-y:auto;}";
  assert.match(cssBlock, new RegExp(tableWrapRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(baselineCssBlock, new RegExp(tableWrapRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ===================================================================================
// Item 12 — sticky header rule (pre-existing, shared by Compact and Expanded) is untouched
// ===================================================================================

test("GATE 4C-E.3: .kn-pf-expanded sticky thead rule is byte-identical to baseline", () => {
  const stickyRule = ".kn-pf-expanded .table-wrap thead th{position:sticky; top:0; background:var(--card); z-index:1;}";
  assert.match(cssBlock, new RegExp(stickyRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(baselineCssBlock, new RegExp(stickyRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ===================================================================================
// Item 13/14 — no fixed oversized pixel widths and no document/body-level overflow/height
// properties introduced (the structural preconditions for "no horizontal overflow" / "no
// document overflow"; the numeric zero-overflow result itself was proven by real browser
// measurement during verification, not re-derived here).
// ===================================================================================

test("GATE 4C-E.3: the hotfix uses only relative/flex sizing (no fixed pixel widths that could force horizontal overflow) and touches no document/body/html rule", () => {
  const declaredWidths = hotfixCssRulesOnly.match(/(?<![\w-])width:\s*[^;]+;/g) || [];
  assert.ok(declaredWidths.length > 0, "expected at least one width declaration to check");
  for (const w of declaredWidths) {
    assert.match(w, /^width:\s*(auto)\s*;$/, `unexpected fixed-width declaration in hotfix CSS: "${w}"`);
  }
  assert.doesNotMatch(hotfixCssRulesOnly, /\bhtml\b|\bbody\b/);
});

// ===================================================================================
// Item 20 — protected infrastructure (Rules, indexes, Auth-adjacent modules, package files)
// remains byte-identical to baseline
// ===================================================================================

test("GATE 4C-E.3: protected infrastructure files are byte-identical to baseline (Rules/schema/Auth/package files untouched)", () => {
  const protectedFiles = [
    "firestore.rules",
    "firestore.rules.production-candidate",
    "firestore.indexes.json",
    "package.json",
    "package-lock.json",
  ];
  const diff = execFileSync("git", ["diff", BASELINE, "--", ...protectedFiles], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(diff.trim(), "", `expected empty diff against baseline for protected files, got:\n${diff}`);
});
