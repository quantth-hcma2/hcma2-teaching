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

test("GATE 4C-F.4 RECONCILED (was: entire JS byte-identical to baseline; category F): the JS module script equals baseline once EXACTLY the frozen, authorized GATE 4C-F.2 Search V1 delta is reversed back out — proving no OTHER (unauthorized) JS change exists beyond the two independently-approved, independently-tested features", () => {
  const knownSearchAdditions = [
    [
      'const KN_PARTICIPANT_FIELD_LABELS={fullName:"Họ và tên",className:"Lớp",email:"Email",phone:"Số điện thoại"};\n' +
      '// GATE 4C-F.2: Search V1 normalization — case/diacritic-insensitive, deterministic, never\n' +
      '// touches stored participant data or CSV values. NFD decomposition + combining-mark strip\n' +
      '// handles standard Vietnamese tone marks; đ/Đ is a separate codepoint (doesn\'t decompose via\n' +
      '// NFD) so it needs its own explicit replace.\n' +
      'function knPfNormalizeSearch(s){\n' +
      '  return String(s==null?"":s).trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"d");\n' +
      '}\n' +
      'function knPfSearchableText(r){\n' +
      '  return knPfNormalizeSearch(r.fullName)+" "+knPfNormalizeSearch(r.className);\n' +
      '}\n',
      'const KN_PARTICIPANT_FIELD_LABELS={fullName:"Họ và tên",className:"Lớp",email:"Email",phone:"Số điện thoại"};\n',
    ],
    [
      "let knPfFullscreenEscHandler=null;\n" +
      "  // GATE 4C-F.2: the one pending Search debounce timer, if any. Unconditionally cancelled at the\n" +
      "  // top of wireParticipantControls() (which runs on every participant rerender, from any trigger)\n" +
      "  // so a stale timer can never later fire against a mode/host that's no longer current.\n" +
      "  let knPfSearchDebounceTimer=null;\n",
      "let knPfFullscreenEscHandler=null;\n",
    ],
    [
      "function knowledgeParticipantsMarkup(participantsArg,countsArg,sessionArg,statusFilter,classFilter,searchQuery){",
      "function knowledgeParticipantsMarkup(participantsArg,countsArg,sessionArg,statusFilter,classFilter){",
    ],
    [
      '    // GATE 4C-F.2: Search V1 — simple normalized substring only, deliberately NOT tokenized (a\n' +
      '    // reordered/partial-token query is not required to match; see test/gate4c-f2 for the frozen\n' +
      '    // contract). Derived visible-row predicate only — never mutates participantsArg/rows/counts.\n' +
      '    const normalizedQuery=knPfNormalizeSearch(searchQuery);\n' +
      '    const filtered=rows.filter(r=>{\n' +
      '      const searchOk=normalizedQuery===""||knPfSearchableText(r).includes(normalizedQuery);\n',
      '    const filtered=rows.filter(r=>{\n',
    ],
    ["      return searchOk&&statusOk&&classOk;\n", "      return statusOk&&classOk;\n"],
    [
      '<input type="text" id="knPfSearch" placeholder="Tìm theo họ tên hoặc lớp..." style="max-width:220px"><select id="knPfFilter">',
      '<select id="knPfFilter">',
    ],
    [
      "  function wireParticipantControls(host,rerender){\n" +
      "    // GATE 4C-F.2: unconditionally cancel any pending Search debounce at the very top of every\n" +
      "    // participant rerender (this function runs on every one: Compact, Expanded, mode toggle,\n" +
      "    // Refresh, filter change, submissions rerender). A stale timer can therefore never later fire\n" +
      "    // against a mode/host that is no longer current — it is superseded by whatever fresh listener\n" +
      "    // this same call is about to attach below.\n" +
      "    if(knPfSearchDebounceTimer){clearTimeout(knPfSearchDebounceTimer);knPfSearchDebounceTimer=null;}\n" +
      "    const searchInput=host.querySelector('#knPfSearch');\n" +
      "    if(searchInput){\n" +
      "      searchInput.value=knPfViewState.search;\n" +
      "      searchInput.oninput=(e)=>{\n" +
      "        knPfViewState.search=e.target.value;\n" +
      "        const selStart=e.target.selectionStart,selEnd=e.target.selectionEnd;\n" +
      "        if(knPfSearchDebounceTimer)clearTimeout(knPfSearchDebounceTimer);\n" +
      "        knPfSearchDebounceTimer=setTimeout(()=>{\n" +
      "          knPfSearchDebounceTimer=null;\n" +
      "          rerender();\n" +
      "          // Compact's `host` (its persistent #knPfWrap node) is never replaced across rerenders\n" +
      "          // (knowledgeRenderParticipantsCompact() only ever does wrap.innerHTML=... on the SAME\n" +
      "          // node), so it is still valid here and needs no re-lookup. Expanded/Fullscreen is the\n" +
      "          // one case that DOES need a fresh query: rerender() there replaces #globalModal's\n" +
      "          // entire subtree via openModal(), so the closure-captured `host` (the previous .modal\n" +
      "          // element) is now detached and can never be focused again. This mirrors\n" +
      "          // knowledgeRenderParticipantsCurrentMode()'s own mode-based dispatch.\n" +
      "          const liveHost=knPfViewState.mode==='expanded'?document.querySelector('#globalModal .modal'):host;\n" +
      "          const freshInput=liveHost?liveHost.querySelector('#knPfSearch'):null;\n" +
      "          if(freshInput){\n" +
      "            freshInput.focus();\n" +
      "            if(selStart!=null&&selEnd!=null){try{freshInput.setSelectionRange(selStart,selEnd);}catch(err){}}\n" +
      "          }\n" +
      "        },150);\n" +
      "      };\n" +
      "    }\n" +
      "    const statusSel=host.querySelector('#knPfFilter');",
      "  function wireParticipantControls(host,rerender){\n" +
      "    const statusSel=host.querySelector('#knPfFilter');",
    ],
    [
      "if(refreshBtn)refreshBtn.onclick=()=>{if(!participantsLoading){if(knPfSearchDebounceTimer){clearTimeout(knPfSearchDebounceTimer);knPfSearchDebounceTimer=null;}loadParticipants();}};",
      "if(refreshBtn)refreshBtn.onclick=()=>{if(!participantsLoading)loadParticipants();};",
    ],
    [
      "wrap.innerHTML=knowledgeParticipantsMarkup(participants,participantCounts,session,knPfViewState.statusFilter,knPfViewState.classFilter,knPfViewState.search);",
      "wrap.innerHTML=knowledgeParticipantsMarkup(participants,participantCounts,session,knPfViewState.statusFilter,knPfViewState.classFilter);",
    ],
    [
      "const tableHtml=knowledgeParticipantsMarkup(participants,participantCounts,session,knPfViewState.statusFilter,knPfViewState.classFilter,knPfViewState.search);",
      "const tableHtml=knowledgeParticipantsMarkup(participants,participantCounts,session,knPfViewState.statusFilter,knPfViewState.classFilter);",
    ],
  ];
  let stripped = scriptSrc;
  for (const [withSearch, withoutSearch] of knownSearchAdditions) {
    assert.ok(stripped.includes(withSearch), `expected known Search addition not found verbatim: ${JSON.stringify(withSearch.slice(0, 80))}...`);
    stripped = stripped.split(withSearch).join(withoutSearch);
  }
  assert.equal(stripped, baselineScriptSrc, "after reversing exactly the known Search delta, the JS must be byte-identical to the pre-hotfix, pre-Search baseline (no other JS change)");
});

// ===================================================================================
// Item 5 — no Search implementation anywhere (this hotfix is fully independent of, and must
// never absorb, the separate uncommitted Search V1 candidate)
// ===================================================================================

test("GATE 4C-F.4 RECONCILED (was: no Search implementation exists in this worktree; category E): knPfSearch is now the authorized GATE 4C-F.2 Search V1 implementation (frozen contract + full coverage in test/gate4c-f2/search.test.mjs) — its presence here is expected, not a hotfix-scope violation", () => {
  assert.match(source, /knPfSearch/);
  assert.match(source, /knPfNormalizeSearch/);
  assert.match(source, /knPfSearchableText/);
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
