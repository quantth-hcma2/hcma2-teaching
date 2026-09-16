// GATE 4C-C.2 — final participant filter state contract (statusFilter + classFilter).
// PURE test, no emulator. Extracts real shipped source out of index.html and, for everything
// this gate requires unchanged, diffs against the exact 4C-C checkpoint commit
// (fd35390ec014eed73f7940d9afaba13d0f4f91b7) via git — never a hand-copied frozen string.
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
const CHECKPOINT_4CC = "fd35390ec014eed73f7940d9afaba13d0f4f91b7";

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const checkpointSource = execFileSync("git", ["show", `${CHECKPOINT_4CC}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

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
// comment, so this never silently over-captures if a nearby comment is reworded.
const markupSrc = sliceBetween(source, "function knowledgeParticipantsMarkup(", "</tbody></table></div>`;\n  }", "knowledgeParticipantsMarkup()") + "</tbody></table></div>`;\n  }";
const wireSrc = sliceBetween(source, "function wireParticipantControls(", "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }", "wireParticipantControls()") + "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }";
const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "knowledgeRenderParticipantsCompact()") + "\n  }";
const dashboardSrc = sliceBetween(source, "async function knowledgeDashboard(", "\nfunction knowledgeProfileIsValid(", "knowledgeDashboard() body");
const cssBlock = sliceBetween(source, ":root{", "\n/* Badges */", "root CSS block");
const stateDecl = sliceBetween(dashboardSrc, "let knPfViewState=", ";", "state decl") + ";";

// ===================================================================================
// 1/2 — final state shape, old `filter` field gone
// ===================================================================================

test("GATE 4C-C.2: knPfViewState is exactly {mode, fullscreen, statusFilter, classFilter, search}", () => {
  assert.match(stateDecl, /let knPfViewState=\{mode:'compact',fullscreen:false,statusFilter:'all',classFilter:'all',search:''\};/);
});

test("GATE 4C-C.2: old generic `filter` state field is gone", () => {
  assert.doesNotMatch(stateDecl, /[^a-zA-Z]filter:/);
});

// ===================================================================================
// 3/4/5 — #knPfFilter stays the status dropdown, new distinct #knPfClassFilter control,
// class options sourced from sessionArg.classOptions (already-loaded)
// ===================================================================================

test("GATE 4C-C.2: #knPfFilter remains the completion-status dropdown (Tất cả/Đã hoàn thành/Chưa hoàn thành)", () => {
  assert.match(markupSrc, /<select id="knPfFilter"><option value="all">Tất cả<\/option><option value="complete">Đã hoàn thành<\/option><option value="incomplete">Chưa hoàn thành<\/option><\/select>/);
});

test("GATE 4C-C.2: new #knPfClassFilter is a distinct control, not a reuse of #knPfFilter", () => {
  assert.match(markupSrc, /<select id="knPfClassFilter">/);
  const idOccurrences = (markupSrc.match(/id="knPfFilter"/g) || []).length;
  assert.equal(idOccurrences, 1, "#knPfFilter must appear exactly once — never repurposed or duplicated");
});

test("GATE 4C-C.2: class filter options derive from sessionArg.classOptions (already-loaded), no new read", () => {
  assert.match(markupSrc, /Array\.isArray\(sessionArg\.classOptions\)/);
  assert.doesNotMatch(markupSrc, /getDoc|getDocs|onSnapshot|query\(/);
});

// ===================================================================================
// 6 — no new Firestore read/query anywhere in the touched functions or the state decl
// ===================================================================================

test("GATE 4C-C.2: no new Firestore calls introduced in markup/compact/state code", () => {
  for (const [label, code] of [["markup", markupSrc], ["compact", compactFnSrc], ["state decl", stateDecl]]) {
    assert.doesNotMatch(code, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/, label);
  }
});

// ===================================================================================
// 7-12 — status x class combinations, executed against the real extracted function
// ===================================================================================

function buildMarkupFn() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;`, sandbox);
  return sandbox.__markup;
}

function fixtureSession(overrides = {}) {
  return {
    minimumPerParticipant: 2,
    participantFields: { fullName: { enabled: true }, className: { enabled: true } },
    classOptions: ["K77.A01", "K77.A02", "K77.A03"],
    ...overrides
  };
}
function fixtureParticipants() {
  return [
    { id: "p1", fullName: "A1", className: "K77.A01" },
    { id: "p2", fullName: "A2", className: "K77.A01" },
    { id: "p3", fullName: "B1", className: "K77.A02" },
    { id: "p4", fullName: "B2", className: "K77.A02" },
    { id: "p5", fullName: "C1", className: "K77.A03" },
    { id: "p6", fullName: "NoClass", className: "" }
  ];
}
function fixtureCounts() {
  return new Map([["p1", 0], ["p2", 2], ["p3", 0], ["p4", 3], ["p5", 1], ["p6", 2]]); // minPer=2: p2,p4,p6 complete
}

function namesIn(html) {
  // capture only the FIRST <td> of each data row (the fullName column, since activeFields
  // starts with fullName) — not the progress/status columns that follow it in the same row.
  return Array.from(html.matchAll(/<tr><td>([^<]*)<\/td>/g)).map(m => m[1]);
}

test("GATE 4C-C.2: status=all + class=all -> all 6 participants", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "all", "all");
  const names = namesIn(html);
  assert.deepEqual(names, ["A1", "A2", "B1", "B2", "C1", "NoClass"]);
});

test("GATE 4C-C.2: status=complete + class=all -> A2, B2, NoClass", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "complete", "all");
  assert.deepEqual(namesIn(html), ["A2", "B2", "NoClass"]);
});

test("GATE 4C-C.2: status=incomplete + class=all -> A1, B1, C1", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "incomplete", "all");
  assert.deepEqual(namesIn(html), ["A1", "B1", "C1"]);
});

test("GATE 4C-C.2: status=all + class=K77.A02 -> B1, B2", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "all", "K77.A02");
  assert.deepEqual(namesIn(html), ["B1", "B2"]);
});

test("GATE 4C-C.2: status=complete + class=K77.A02 -> B2 only", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "complete", "K77.A02");
  assert.deepEqual(namesIn(html), ["B2"]);
});

test("GATE 4C-C.2: status=incomplete + class=K77.A02 -> B1 only", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "incomplete", "K77.A02");
  assert.deepEqual(namesIn(html), ["B1"]);
});

// ===================================================================================
// 13/14 — each dropdown's onchange only ever writes its own state field
// ===================================================================================

test("GATE 4C-C.2: status onchange writes only statusFilter (class selection untouched by wiring) — now via the shared wireParticipantControls() helper introduced by GATE 4C-D.2", () => {
  assert.match(wireSrc, /statusSel\.onchange=\(e\)=>\{knPfViewState\.statusFilter=e\.target\.value;rerender\(\);\};/);
});

test("GATE 4C-C.2: class onchange writes only classFilter (status selection untouched by wiring), guarded for absence — now via the shared wireParticipantControls() helper introduced by GATE 4C-D.2", () => {
  assert.match(wireSrc, /const classSel=host\.querySelector\('#knPfClassFilter'\);/);
  assert.match(wireSrc, /classSel\.onchange=\(e\)=>\{knPfViewState\.classFilter=e\.target\.value;rerender\(\);\};/);
});

// ===================================================================================
// 17/18/19/20 — legacy/edge-case safety
// ===================================================================================

test("GATE 4C-C.2: participant with missing className stays visible under class=all, excluded from a specific class", () => {
  const markup = buildMarkupFn();
  const all = markup(fixtureParticipants(), fixtureCounts(), fixtureSession(), "all", "all");
  assert.match(all, />NoClass</);
  const specific = markup(fixtureParticipants(), fixtureCounts(), fixtureSession(), "all", "K77.A01");
  assert.doesNotMatch(specific, />NoClass</);
});

test("GATE 4C-C.2: absent/empty session.classOptions hides the class filter safely (no crash, no empty dropdown)", () => {
  const markup = buildMarkupFn();
  const absent = markup(fixtureParticipants(), fixtureCounts(), fixtureSession({ classOptions: undefined }), "all", "all");
  assert.doesNotMatch(absent, /knPfClassFilter/);
  assert.match(absent, /<strong>6<\/strong>/);
  const empty = markup(fixtureParticipants(), fixtureCounts(), fixtureSession({ classOptions: [] }), "all", "all");
  assert.doesNotMatch(empty, /knPfClassFilter/);
});

test("GATE 4C-C.2: className field disabled for this session hides the class filter safely", () => {
  const markup = buildMarkupFn();
  const html = markup(fixtureParticipants(), fixtureCounts(), fixtureSession({ participantFields: { fullName: { enabled: true }, className: { enabled: false } } }), "all", "all");
  assert.doesNotMatch(html, /knPfClassFilter/);
  assert.match(html, /<strong>6<\/strong>/);
});

test("GATE 4C-C.2: empty-result state (status+class combo matching nothing) still correct", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "complete", "K77.A03");
  assert.match(html, /Không có người tham gia phù hợp\./);
});

// ===================================================================================
// 21/22 — progress/status and active-field logic unchanged (dynamic re-verification)
// ===================================================================================

test("GATE 4C-C.2: progress/status (count/minPer, Hoàn thành label) unchanged", () => {
  const html = buildMarkupFn()(fixtureParticipants(), fixtureCounts(), fixtureSession(), "all", "all");
  assert.match(html, /3\/2/); // p4 count=3, minPer=2
  assert.match(html, /Hoàn thành/);
});

// ===================================================================================
// 23/24 — CSV export and loadParticipants() untouched since 4C-C
// ===================================================================================

test("GATE 4C-C.2: knowledgeExportParticipants() unchanged since 4C-C; loadParticipants()'s fetch logic unchanged (only its final dispatch line legitimately changed, by GATE 4C-D.2)", () => {
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "loadParticipants()") + commonTail;
  const checkpointLoad = sliceBetween(checkpointSource, "async function loadParticipants(){", commonTail, "checkpoint loadParticipants()") + commonTail;
  assert.equal(loadSrc, checkpointLoad);
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }", "knowledgeExportParticipants()") + "\n  }";
  const checkpointExport = sliceBetween(checkpointSource, "async function knowledgeExportParticipants(){", "\n  }", "checkpoint knowledgeExportParticipants()") + "\n  }";
  assert.equal(exportSrc, checkpointExport);
});

// ===================================================================================
// 25 — 4C-B Compact CSS (scroll cap + sticky header) still intact
// ===================================================================================

test("GATE 4C-C.2: 4C-B Compact CSS (scroll cap + sticky header) preserved byte-identical — narrowed by the GATE 4C-D.2 SMOKE FIX to the .kn-pf-compact sub-block specifically, since the wider :root{}...Badges CSS block now also legitimately contains a separately-scoped .kn-pf-expanded rule (see test/gate4c-b/compact-mode.test.mjs for the up-to-date guard that no BARE/unscoped rule exists in that wider block)", () => {
  const compactCssStart = ".kn-pf-compact .table-wrap{max-height:320px; overflow-y:auto;}";
  const compactCssEnd = ".kn-pf-compact .table-wrap thead th{position:sticky; top:0; background:var(--card); z-index:1;}";
  const compactCssSrc = sliceBetween(cssBlock, compactCssStart, compactCssEnd, "compact css sub-block") + compactCssEnd;
  const checkpointCssBlock = sliceBetween(checkpointSource, ":root{", "\n/* Badges */", "checkpoint css block");
  const checkpointCompactCssSrc = sliceBetween(checkpointCssBlock, compactCssStart, compactCssEnd, "checkpoint compact css sub-block") + compactCssEnd;
  assert.equal(compactCssSrc, checkpointCompactCssSrc);
});

// ===================================================================================
// 26/27/28/29 — no future Item 4 controls exist yet
// ===================================================================================

test("GATE 4C-C.2: no Fullscreen, Search, or chunk/pagination/virtualization exist yet", () => {
  // MỞ RỘNG/Expanded were explicitly out of scope for 4C-C.2 itself (still true), but GATE
  // 4C-D.2 later added Expanded as its own authorized gate — see
  // test/gate4c-d2/expanded-mode.test.mjs for the up-to-date guard on what's still not built.
  assert.doesNotMatch(source, /TOÀN MÀN HÌNH/);
  assert.doesNotMatch(source, /is-fullscreen/);
  assert.doesNotMatch(source, /knPfSearch/);
  assert.doesNotMatch(markupSrc, /requestAnimationFrame|IntersectionObserver|chunk|virtualiz|pagina/i);
});
