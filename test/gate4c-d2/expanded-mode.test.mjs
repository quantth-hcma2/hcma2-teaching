// GATE 4C-D2 — Expanded mode for the Knowledge participant panel. PURE test, no emulator.
// Extracts real shipped source out of index.html and, for everything this gate requires
// unchanged, diffs against the exact production baseline commit (5de8d93) via git — never a
// hand-copied frozen string.
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
const BASELINE = "5de8d93fcd66ad19fb48cd2f7706b0f8e03e0553";

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const baselineSource = execFileSync("git", ["show", `${BASELINE}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const escSrc = sliceBetween(source, "function esc(s){", "\n", "esc()");
const labelsSrc = sliceBetween(source, "const KN_PARTICIPANT_FIELD_LABELS=", ";", "KN_PARTICIPANT_FIELD_LABELS") + ";";
const normalizeSearchSrc = sliceBetween(source, "function knPfNormalizeSearch(s){", "\n}", "knPfNormalizeSearch") + "\n}";
const searchableTextSrc = sliceBetween(source, "function knPfSearchableText(r){", "\n}", "knPfSearchableText") + "\n}";
// Bounded by stable CODE tokens (the function's own last statement), not surrounding comment
// text, so these extractions never silently drift if a neighboring comment is reworded.
const markupSrc = sliceBetween(source, "function knowledgeParticipantsMarkup(", "</tbody></table></div>`;\n  }", "knowledgeParticipantsMarkup()") + "</tbody></table></div>`;\n  }";
const wireSrc = sliceBetween(source, "function wireParticipantControls(", "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }", "wireParticipantControls()") + "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }";
const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "knowledgeRenderParticipantsCompact()") + "\n  }";
const expandedFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsExpanded(", "\n  }", "knowledgeRenderParticipantsExpanded()") + "\n  }";
const currentModeFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCurrentMode(", "\n  }", "knowledgeRenderParticipantsCurrentMode()") + "\n  }";
const dashboardSrc = sliceBetween(source, "async function knowledgeDashboard(", "\nfunction knowledgeProfileIsValid(", "knowledgeDashboard() body");
const stateDecl = sliceBetween(dashboardSrc, "let knPfViewState=", ";", "state decl") + ";";

// ===================================================================================
// 1 — production state contract unchanged
// ===================================================================================

test("GATE 4C-D2: knPfViewState shape unchanged (mode/fullscreen/statusFilter/classFilter/search)", () => {
  assert.match(stateDecl, /let knPfViewState=\{mode:'compact',fullscreen:false,statusFilter:'all',classFilter:'all',search:''\};/);
});

// ===================================================================================
// 2/12/17 — Compact/CSV/filter semantics unchanged: the pure markup + export functions and the
// getDocs() fetch inside loadParticipants() must be byte-identical to the production baseline
// ===================================================================================

test("GATE 4C-F.4 RECONCILED (was: byte-identical to baseline; category B): knowledgeParticipantsMarkup() equals baseline once EXACTLY the known, frozen GATE 4C-F.2 Search V1 additions are stripped back out — proving nothing else about STATUS/CLASS semantics changed", () => {
  const baselineMarkup = sliceBetween(baselineSource, "function knowledgeParticipantsMarkup(", "</tbody></table></div>`;\n  }", "baseline markup") + "</tbody></table></div>`;\n  }";
  const knownSearchAdditions = [
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
  ];
  let stripped = markupSrc;
  for (const [withSearch, withoutSearch] of knownSearchAdditions) {
    assert.ok(stripped.includes(withSearch), `expected known Search addition not found verbatim: ${JSON.stringify(withSearch.slice(0, 60))}...`);
    stripped = stripped.split(withSearch).join(withoutSearch);
  }
  assert.equal(stripped, baselineMarkup, "after stripping exactly the known Search additions, the function must be byte-identical to baseline (no other change)");
});

test("GATE 4C-D2: knowledgeExportParticipants() byte-identical to production baseline (full-dataset CSV unchanged)", () => {
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }", "knowledgeExportParticipants()") + "\n  }";
  const baselineExport = sliceBetween(baselineSource, "async function knowledgeExportParticipants(){", "\n  }", "baseline knowledgeExportParticipants()") + "\n  }";
  assert.equal(exportSrc, baselineExport);
});

test("GATE 4C-D2: loadParticipants()'s getDocs() fetch is byte-identical to production baseline (only its final dispatch line changed)", () => {
  // The catch block's closing brace immediately followed by the final participantsLoading=false
  // reset is a stable, unique anchor common to both versions — everything before and including
  // it is the untouched fetch logic; only what comes after (the dispatch call) differs.
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "loadParticipants() fetch portion") + commonTail;
  const baselineLoad = sliceBetween(baselineSource, "async function loadParticipants(){", commonTail, "baseline loadParticipants() fetch portion") + commonTail;
  assert.equal(loadSrc, baselineLoad);
});

// ===================================================================================
// 3 — Compact contains exactly one MỞ RỘNG action
// ===================================================================================

test("GATE 4C-D2: exactly one MỞ RỘNG action exists, inside the Compact card header", () => {
  const occurrences = (source.match(/MỞ RỘNG/g) || []).length;
  assert.equal(occurrences, 1);
  assert.match(source, /id="knPfExpand">⤢ MỞ RỘNG</);
});

// ===================================================================================
// 4/5/6/7 — Expanded mount: uses openModal(html,true), reuses the shared markup builder,
// introduces no Firestore calls, and only ever operates on already-loaded participants
// ===================================================================================

test("GATE 4C-D2: knowledgeRenderParticipantsExpanded() uses openModal(html, true)", () => {
  assert.match(expandedFnSrc, /openModal\(`[^`]*`,true\)/s);
});

test("GATE 4C-D2: knowledgeRenderParticipantsExpanded() reuses knowledgeParticipantsMarkup(...)", () => {
  assert.match(expandedFnSrc, /knowledgeParticipantsMarkup\(participants,participantCounts,session,knPfViewState\.statusFilter,knPfViewState\.classFilter,knPfViewState\.search\)/);
});

test("GATE 4C-D2: opening Expanded introduces zero Firestore reads/writes/listeners", () => {
  assert.doesNotMatch(expandedFnSrc, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc|collection\(/);
});

test("GATE 4C-D2: Expanded only ever operates on already-loaded participants (no fetch trigger)", () => {
  assert.match(expandedFnSrc, /if\(session\.collectParticipantProfile!==true\|\|participants===null\)return;/);
  assert.doesNotMatch(expandedFnSrc, /loadParticipants\(\)/);
});

// ===================================================================================
// 8/9 — host-scoped wiring, shared between Compact and Expanded
// ===================================================================================

test("GATE 4C-D2: participant controls are resolved host-scoped (host.querySelector), never document-global", () => {
  assert.match(wireSrc, /host\.querySelector\('#knPfFilter'\)/);
  assert.match(wireSrc, /host\.querySelector\('#knPfClassFilter'\)/);
  assert.match(wireSrc, /host\.querySelector\('#knPfRefresh'\)/);
  assert.match(wireSrc, /host\.querySelector\('#knPfExport'\)/);
  assert.doesNotMatch(wireSrc, /\$\("#knPf/);
});

test("GATE 4C-D2: Compact and Expanded both call the same wireParticipantControls() helper", () => {
  assert.match(compactFnSrc, /wireParticipantControls\(wrap,knowledgeRenderParticipantsCompact\)/);
  assert.match(expandedFnSrc, /wireParticipantControls\(modalEl,knowledgeRenderParticipantsExpanded\)/);
});

// ===================================================================================
// 13 — filter changes rerender the CURRENT mode (each mount passes itself as `rerender`)
// ===================================================================================

test("GATE 4C-D2: filter onchange handlers call the rerender callback bound to their own host's mount function", () => {
  assert.match(wireSrc, /statusSel\.onchange=\(e\)=>\{knPfViewState\.statusFilter=e\.target\.value;rerender\(\);\};/);
  assert.match(wireSrc, /classSel\.onchange=\(e\)=>\{knPfViewState\.classFilter=e\.target\.value;rerender\(\);\};/);
});

// ===================================================================================
// 14/15/16 — Refresh dispatch is mode-aware and preserves both filters
// ===================================================================================

test("GATE 4C-D2: knowledgeRenderParticipantsCurrentMode() dispatches to Expanded or Compact based on knPfViewState.mode", () => {
  assert.match(currentModeFnSrc, /if\(knPfViewState\.mode==='expanded'\)knowledgeRenderParticipantsExpanded\(\);/);
  assert.match(currentModeFnSrc, /else knowledgeRenderParticipantsCompact\(\);/);
});

test("GATE 4C-D2: loadParticipants() and the live submissions listener both dispatch mode-aware (Refresh preserves whichever view is open)", () => {
  // loadParticipants()'s final statement, immediately preceded by the shared catch-block-close
  // anchor used above, and immediately followed by the next function — proves this is the LAST
  // line of loadParticipants(), not just a match anywhere in the file.
  assert.match(source, /participantsLoading=false;\n(?:[^\n]*\n){1,4}?\s*knowledgeRenderParticipantsCurrentMode\(\);\n  \}\n  \/\/ GATE 4C-A: pure markup builder/);
  assert.match(dashboardSrc, /if\(session&&session\.collectParticipantProfile===true&&participants!==null\)knowledgeRenderParticipantsCurrentMode\(\);/);
});

test("GATE 4C-D2: neither filter dropdown's onchange, nor Refresh, nor the live listener ever resets knPfViewState.statusFilter/classFilter to a default", () => {
  assert.doesNotMatch(wireSrc, /statusFilter='all'/);
  assert.doesNotMatch(wireSrc, /classFilter='all'/);
  assert.doesNotMatch(expandedFnSrc, /statusFilter='all'|classFilter='all'/);
});

// ===================================================================================
// 18/19 — every modal close/replacement path resets mode to 'compact'
// ===================================================================================

test("GATE 4C-D2: opening Expanded registers modalCloseCleanup that resets mode to 'compact' AND rerenders Compact from current in-memory data (covers backdrop close AND any modal replacement, both of which already call runModalCloseCleanup() inside openModal()/closeModal()) — extended by the GATE 4C-D.2 SMOKE FIX so closing Expanded never leaves Compact stuck on a stale Refresh-in-flight spinner; further extended by GATE 4C-E (see test/gate4c-e/fullscreen.test.mjs for the up-to-date, in-depth guard on the Fullscreen-reset additions) so closing never leaves stale Fullscreen state either — this narrows to just the two invariants 4C-D2 itself is responsible for", () => {
  assert.match(expandedFnSrc, /modalCloseCleanup=\(\)=>\{[\s\S]*?knPfViewState\.mode='compact';[\s\S]*?knowledgeRenderParticipantsCompact\(\);[\s\S]*?\};/);
});

test("GATE 4C-D2: Expanded's own close button calls the existing closeModal() only — no second close implementation", () => {
  assert.match(expandedFnSrc, /closeBtn\.onclick=closeModal;/);
  assert.doesNotMatch(expandedFnSrc, /function closeModal|\.remove\(\)|innerHTML=""/);
});

// ===================================================================================
// 20/21 — reopen works, no duplicate-handler accumulation risk (structural: full innerHTML
// replacement on every mount call means old handlers are always discarded, never stacked)
// ===================================================================================

test("GATE 4C-D2: every Expanded (re-)render fully replaces modal content via openModal (no incremental DOM patch, so no accumulated handlers across repeated open/close/reopen)", () => {
  assert.match(expandedFnSrc, /const host=openModal\(/);
  // exactly one openModal call per invocation — never conditionally skipped, so reopen always
  // gets a fresh host and fresh listeners, matching Compact's existing wrap.innerHTML= pattern.
  const openModalCalls = (expandedFnSrc.match(/openModal\(/g) || []).length;
  assert.equal(openModalCalls, 1);
});

// ===================================================================================
// 22/23/24 — no Search, no Fullscreen, no pagination/chunking/virtualization
// ===================================================================================

test("GATE 4C-D2: no Search, or pagination/chunking/virtualization implementation exists yet", () => {
  // TOÀN MÀN HÌNH/Fullscreen was explicitly out of scope for 4C-D.2 itself (still true — this
  // gate's own diff never introduced it), but GATE 4C-E later added it as its own authorized
  // gate — see test/gate4c-e/fullscreen.test.mjs for the up-to-date guard on what's still not
  // built (Search) and on Fullscreen's own approved scope/ownership rules.
  // GATE 4C-F.4 RECONCILED (per GATE 4C-F.2R-approved design, category A): knPfSearch is now the
  // authorized GATE 4C-F.2 Search V1 implementation (frozen contract + full coverage in
  // test/gate4c-f2/search.test.mjs) — its presence is no longer a violation of this gate's own
  // scope. Every OTHER protection this assertion sat alongside (pagination/chunking/virtualization,
  // etc., where present in this test) is left fully intact below.
  assert.doesNotMatch(expandedFnSrc, /requestAnimationFrame|IntersectionObserver|chunk|virtualiz|pagina/i);
});

// ===================================================================================
// 25 — no new Firestore read/listener path anywhere in the whole diffed region
// ===================================================================================

test("GATE 4C-D2: no new Firestore calls anywhere in the touched functions", () => {
  for (const [label, code] of [["wireParticipantControls", wireSrc], ["knowledgeRenderParticipantsExpanded", expandedFnSrc], ["knowledgeRenderParticipantsCurrentMode", currentModeFnSrc]]) {
    assert.doesNotMatch(code, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/, label);
  }
});

// ===================================================================================
// 26 — Rules/schema/migration unchanged
// ===================================================================================

test("GATE 4C-D2: firestore.rules.production-candidate byte-identical to production baseline", () => {
  const rules = readFileSync(path.join(repoRoot, "firestore.rules.production-candidate"), "utf8").replace(/\r\n/g, "\n");
  const baselineRules = execFileSync("git", ["show", `${BASELINE}:firestore.rules.production-candidate`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");
  assert.equal(rules, baselineRules);
});

// ===================================================================================
// 27 — Group Discussion / Classroom Presentation / Timer areas untouched
// ===================================================================================

test("GATE 4C-D2: Group Discussion / Classroom Presentation / Timer production files byte-identical to baseline", () => {
  for (const name of ["group-classroom-presentation.css", "group-classroom-presentation.mjs", "group-classroom-timer.mjs", "rich-text-editor-serializer.mjs", "group-membership.mjs", "group-file-link-safety.mjs"]) {
    const current = readFileSync(path.join(repoRoot, name), "utf8").replace(/\r\n/g, "\n");
    const baseline = execFileSync("git", ["show", `${BASELINE}:${name}`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");
    assert.equal(current, baseline, name);
  }
});

// ===================================================================================
// Dynamic re-verification: knowledgeParticipantsMarkup() still behaves correctly when executed
// (redundant with byte-identity above, but proves the actual runtime behavior, not just text)
// ===================================================================================

function buildMarkupFn() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${normalizeSearchSrc}\n${searchableTextSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;`, sandbox);
  return sandbox.__markup;
}

test("GATE 4C-D2: STATUS AND CLASS semantics still function correctly (dynamic execution)", () => {
  const markup = buildMarkupFn();
  const session = { minimumPerParticipant: 2, participantFields: { fullName: { enabled: true }, className: { enabled: true } }, classOptions: ["K1", "K2"] };
  const participants = [{ id: "p1", fullName: "A", className: "K1" }, { id: "p2", fullName: "B", className: "K2" }];
  const counts = new Map([["p1", 3], ["p2", 0]]);
  const html = markup(participants, counts, session, "complete", "K1");
  assert.match(html, />A</);
  assert.doesNotMatch(html, />B</);
});
