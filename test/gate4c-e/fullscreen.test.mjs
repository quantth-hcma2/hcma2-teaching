// GATE 4C-E — Fullscreen presentation for the Knowledge participant Expanded modal. PURE test,
// no emulator. Extracts real shipped source out of index.html and, for everything this gate
// requires unchanged, diffs against the exact production baseline commit (5002e261) via git —
// never a hand-copied frozen string.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const indexPath = path.join(repoRoot, "index.html");
const BASELINE = "5002e2613cf2cefe97c22c4fab12ad7811a310a4";

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const baselineSource = execFileSync("git", ["show", `${BASELINE}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const expandedFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsExpanded(", "\n  }") + "\n  }";
const wireSrc = sliceBetween(source, "function wireParticipantControls(", "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }", "wireParticipantControls()") + "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }";
const openModalSrc = sliceBetween(source, "function openModal(html, large){", "\n}") + "\n}";
const closeModalSrc = sliceBetween(source, "function closeModal(){", "\n");
const dashboardSrc = sliceBetween(source, "async function knowledgeDashboard(", "\nfunction knowledgeProfileIsValid(", "knowledgeDashboard() body");
const stateDecl = sliceBetween(dashboardSrc, "let knPfViewState=", ";") + ";";
const cssBlock = sliceBetween(source, ":root{", "\n/* Badges */", "root CSS block");
const baselineCssBlock = sliceBetween(baselineSource, ":root{", "\n/* Badges */", "baseline root CSS block");

// ===================================================================================
// 1 — frozen state shape preserved
// ===================================================================================

test("GATE 4C-E: knPfViewState shape unchanged (mode/fullscreen/statusFilter/classFilter/search); no mode:'fullscreen' introduced", () => {
  assert.match(stateDecl, /let knPfViewState=\{mode:'compact',fullscreen:false,statusFilter:'all',classFilter:'all',search:''\};/);
  assert.doesNotMatch(source, /mode:\s*['"]fullscreen['"]/);
});

// ===================================================================================
// 2/3/4 — Fullscreen control and class ownership scoped exclusively to the participant
// Expanded renderer; openModal() itself carries no fullscreen-awareness
// ===================================================================================

test("GATE 4C-E: exactly one Fullscreen toggle control exists, inside knowledgeRenderParticipantsExpanded()", () => {
  const occurrences = (source.match(/id="knPfFullscreenToggle"/g) || []).length;
  assert.equal(occurrences, 1);
  assert.match(expandedFnSrc, /id="knPfFullscreenToggle"/);
});

test("GATE 4C-E: is-fullscreen is applied only inside knowledgeRenderParticipantsExpanded(), never by openModal() or elsewhere", () => {
  const occurrences = (source.match(/classList\.add\(['"]is-fullscreen['"]\)/g) || []).length;
  assert.equal(occurrences, 1);
  assert.match(expandedFnSrc, /modalEl\.classList\.add\('is-fullscreen'\)/);
  assert.doesNotMatch(openModalSrc, /is-fullscreen|fullscreen/);
});

test("GATE 4C-E: openModal()/closeModal() themselves are byte-identical to the production baseline (no generic fullscreen behavior introduced)", () => {
  const baselineOpenModal = sliceBetween(baselineSource, "function openModal(html, large){", "\n}") + "\n}";
  const baselineCloseModal = sliceBetween(baselineSource, "function closeModal(){", "\n");
  assert.equal(openModalSrc, baselineOpenModal);
  assert.equal(closeModalSrc, baselineCloseModal);
});

// ===================================================================================
// 5/6/7 — CSS: base .modal/.modal-lg and Compact CSS untouched; Fullscreen CSS correctly
// additive and scoped
// ===================================================================================

test("GATE 4C-E: base .modal / .modal-lg declarations unchanged since production baseline", () => {
  const modalRule = sliceBetween(source, ".modal{background:#fff;", "\n.modal-lg{max-width:820px;}") + "\n.modal-lg{max-width:820px;}";
  const baselineModalRule = sliceBetween(baselineSource, ".modal{background:#fff;", "\n.modal-lg{max-width:820px;}") + "\n.modal-lg{max-width:820px;}";
  assert.equal(modalRule, baselineModalRule);
});

test("GATE 4C-E: .kn-pf-compact CSS (Compact's own scroll cap + sticky header) unchanged since production baseline", () => {
  const compactCssStart = ".kn-pf-compact .table-wrap{max-height:320px; overflow-y:auto;}";
  const compactCssEnd = ".kn-pf-compact .table-wrap thead th{position:sticky; top:0; background:var(--card); z-index:1;}";
  const compactCssSrc = sliceBetween(cssBlock, compactCssStart, compactCssEnd, "compact css") + compactCssEnd;
  const baselineCompactCssSrc = sliceBetween(baselineCssBlock, compactCssStart, compactCssEnd, "baseline compact css") + compactCssEnd;
  assert.equal(compactCssSrc, baselineCompactCssSrc);
});

test("GATE 4C-E: .modal.is-fullscreen CSS is correctly scoped and additive (100vh then 100dvh fallback order, negative margin compensates the shared .modal-backdrop's own padding without touching it, overrides table-wrap cap only inside .kn-pf-expanded)", () => {
  assert.match(cssBlock, /\.modal\.is-fullscreen\{width:100vw; height:100vh; height:100dvh; max-width:none; max-height:none; margin:-16px; border-radius:0; overflow:hidden; display:flex; flex-direction:column;\}/);
  assert.match(cssBlock, /\.modal\.is-fullscreen \.kn-pf-expanded\{flex:1 1 auto; min-height:0; display:flex; flex-direction:column; overflow:hidden;\}/);
  assert.match(cssBlock, /\.modal\.is-fullscreen \.kn-pf-expanded \.table-wrap\{flex:1 1 auto; min-height:0; max-height:none; overflow-y:auto;\}/);
  // .modal-backdrop itself (shared by 9 other modal features) must remain byte-untouched
  const backdropRule = sliceBetween(source, ".modal-backdrop{position:fixed;", "\n.modal{");
  const baselineBackdropRule = sliceBetween(baselineSource, ".modal-backdrop{position:fixed;", "\n.modal{");
  assert.equal(backdropRule, baselineBackdropRule);
});

// ===================================================================================
// 8/9 — out of scope: no Search, no pagination/chunking/virtualization
// ===================================================================================

test("GATE 4C-E: no Search implementation exists; Expanded region introduces no pagination/chunking/virtualization", () => {
  assert.doesNotMatch(source, /knPfSearch/);
  assert.doesNotMatch(expandedFnSrc, /requestAnimationFrame|IntersectionObserver|chunk|virtualiz|pagina/i);
});

// ===================================================================================
// 10 — no new Firestore read/listener anywhere in the touched code
// ===================================================================================

test("GATE 4C-E: no new Firestore calls anywhere in the touched functions", () => {
  assert.doesNotMatch(expandedFnSrc, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc|collection\(/);
});

// ===================================================================================
// 11/12/13/14/16 — ESC handler: ownership-scoped, fails closed, exits without closeModal(),
// and is torn down on every render / on genuine close
// ===================================================================================

test("GATE 4C-E: ESC handler proves mode+fullscreen state AND live DOM ownership (is-fullscreen class + .kn-pf-expanded marker) before acting — never state alone", () => {
  assert.match(expandedFnSrc, /if\(knPfViewState\.mode!=='expanded'\|\|knPfViewState\.fullscreen!==true\)return;/);
  assert.match(expandedFnSrc, /const liveModal=document\.querySelector\('#globalModal \.modal'\);/);
  assert.match(expandedFnSrc, /if\(!liveModal\|\|!liveModal\.classList\.contains\('is-fullscreen'\)\)return;/);
  assert.match(expandedFnSrc, /if\(!liveModal\.querySelector\('\.kn-pf-expanded'\)\)return;/);
});

test("GATE 4C-E: ESC exits Fullscreen by flipping state and rerendering only — never calls closeModal()", () => {
  const escHandlerSrc = sliceBetween(expandedFnSrc, "knPfFullscreenEscHandler=(e)=>{", "      };", "esc handler body");
  assert.match(escHandlerSrc, /knPfViewState\.fullscreen=false;/);
  assert.match(escHandlerSrc, /knowledgeRenderParticipantsExpanded\(\);/);
  assert.doesNotMatch(escHandlerSrc, /closeModal\(\)/);
});

test("GATE 4C-E: ESC listener is unconditionally removed then conditionally re-added on every render (no duplicate-handler accumulation across cycles)", () => {
  const removeCount = (expandedFnSrc.match(/document\.removeEventListener\('keydown',knPfFullscreenEscHandler\)/g) || []).length;
  const addCount = (expandedFnSrc.match(/document\.addEventListener\('keydown',knPfFullscreenEscHandler\)/g) || []).length;
  assert.equal(addCount, 1, "expected exactly one addEventListener call site");
  assert.equal(removeCount, 2, "expected exactly two removeEventListener call sites: one in the top-of-render guard, one in modalCloseCleanup");
});

test("GATE 4C-E: a genuine close resets fullscreen=false and mode='compact' (modalCloseCleanup)", () => {
  const cleanupSrc = sliceBetween(expandedFnSrc, "modalCloseCleanup=()=>{", "    };", "modalCloseCleanup body") + "    };";
  assert.match(cleanupSrc, /knPfViewState\.mode='compact';/);
  assert.match(cleanupSrc, /knPfViewState\.fullscreen=false;/);
  assert.match(cleanupSrc, /if\(knPfFullscreenEscHandler\)\{document\.removeEventListener\('keydown',knPfFullscreenEscHandler\);knPfFullscreenEscHandler=null;\}/);
  assert.match(cleanupSrc, /knowledgeRenderParticipantsCompact\(\);/);
});

// ===================================================================================
// 17 — same-modal rerender must NOT reset fullscreen: the wantFullscreen snapshot pattern
// ===================================================================================

test("GATE 4C-E: fullscreen is snapshotted BEFORE openModal() runs (which may execute a stale prior modalCloseCleanup) and reasserted after, mirroring the existing mode='expanded' reassertion", () => {
  const beforeOpenModal = expandedFnSrc.slice(0, expandedFnSrc.indexOf("const host=openModal("));
  assert.match(beforeOpenModal, /const wantFullscreen=knPfViewState\.fullscreen;/);
  const afterOpenModal = expandedFnSrc.slice(expandedFnSrc.indexOf("const host=openModal("));
  assert.match(afterOpenModal, /knPfViewState\.mode='expanded';\s*\n\s*knPfViewState\.fullscreen=wantFullscreen;/);
});

// ===================================================================================
// 18/19 — Refresh and submissions-listener rerenders preserve fullscreen automatically:
// loadParticipants()'s dispatch and the submissions listener are byte-identical to baseline,
// which is sufficient proof since knowledgeRenderParticipantsExpanded() now self-reapplies
// fullscreen on every invocation regardless of caller
// ===================================================================================

test("GATE 4C-E: loadParticipants()'s dispatch tail and the submissions-listener dispatch are byte-identical to baseline (Fullscreen persistence across Refresh/live updates is structural, not a special case)", () => {
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "loadParticipants()") + commonTail;
  const baselineLoad = sliceBetween(baselineSource, "async function loadParticipants(){", commonTail, "baseline loadParticipants()") + commonTail;
  assert.equal(loadSrc, baselineLoad);
  const currentModeFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCurrentMode(", "\n  }") + "\n  }";
  const baselineCurrentModeFnSrc = sliceBetween(baselineSource, "function knowledgeRenderParticipantsCurrentMode(", "\n  }") + "\n  }";
  assert.equal(currentModeFnSrc, baselineCurrentModeFnSrc);
  const listenerLine = "if(session&&session.collectParticipantProfile===true&&participants!==null)knowledgeRenderParticipantsCurrentMode();";
  assert.match(source, new RegExp(listenerLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(baselineSource, new RegExp(listenerLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ===================================================================================
// 20 — CSV export unchanged
// ===================================================================================

test("GATE 4C-E: knowledgeExportParticipants() byte-identical to production baseline (full-dataset CSV unchanged)", () => {
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }") + "\n  }";
  const baselineExport = sliceBetween(baselineSource, "async function knowledgeExportParticipants(){", "\n  }") + "\n  }";
  assert.equal(exportSrc, baselineExport);
});

// ===================================================================================
// wiring: the Fullscreen toggle and Close button are both re-bound on every render (assignment,
// not addEventListener) — consistent with the existing, already-proven no-duplicate-handler design
// ===================================================================================

test("GATE 4C-E: Fullscreen toggle and Close are wired via direct .onclick assignment (idempotent across repeated renders)", () => {
  assert.match(expandedFnSrc, /fsBtn\.onclick=\(\)=>\{knPfViewState\.fullscreen=!knPfViewState\.fullscreen;knowledgeRenderParticipantsExpanded\(\);\};/);
  assert.match(expandedFnSrc, /closeBtn\.onclick=closeModal;/);
});
