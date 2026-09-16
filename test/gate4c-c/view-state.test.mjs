// GATE 4C-C — shared participant-panel UI state foundation. PURE test, no emulator. Extracts
// real shipped source out of index.html and, for everything the gate requires unchanged,
// diffs against the exact 4C-B checkpoint commit (829e919a91b9f0f76f5b8030dd6ac1aea4440532)
// via git — never a hand-copied frozen string.
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
const CHECKPOINT_4CB = "829e919a91b9f0f76f5b8030dd6ac1aea4440532";

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const checkpointSource = execFileSync("git", ["show", `${CHECKPOINT_4CB}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

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
const dashboardSrc = sliceBetween(source, "async function knowledgeDashboard(", "\nfunction knowledgeProfileIsValid(", "knowledgeDashboard() body");
const cssBlock = sliceBetween(source, ":root{", "\n/* Badges */", "root CSS block");

// ===================================================================================
// 1/2 — knPfViewState exists inside knowledgeDashboard(), with the exact frozen initial shape
// ===================================================================================

test("GATE 4C-C: knPfViewState declared inside knowledgeDashboard(), with initial state (shape superseded by GATE 4C-C.2)", () => {
  // GATE 4C-C.2 explicitly authorized splitting the single `filter` field into statusFilter +
  // classFilter (see test/gate4c-c2/filter-contract.test.mjs for the up-to-date exact-shape
  // assertion) — check only that the state object still exists with mode/fullscreen/search
  // frozen as 4C-C originally shipped them, not the exact whole-object literal.
  assert.match(dashboardSrc, /let knPfViewState=\{mode:'compact',fullscreen:false,/);
  assert.match(dashboardSrc, /search:''\};/);
});

// ===================================================================================
// 3/4/5/6 — Compact remains the only presentation; no Expanded/Fullscreen/Search yet
// ===================================================================================

test("GATE 4C-C: no Expanded, Fullscreen, or Search UI/implementation exists yet", () => {
  assert.doesNotMatch(source, /MỞ RỘNG/);
  assert.doesNotMatch(source, /TOÀN MÀN HÌNH/);
  assert.doesNotMatch(source, /is-fullscreen/);
  assert.doesNotMatch(source, /knPfSearch/);
  assert.doesNotMatch(source, /openModal\([^)]*[Pp]articipant/);
});

// ===================================================================================
// 7/8/9 — filter wiring: onchange updates state, render reads state, display stays in sync
// ===================================================================================

test("GATE 4C-C: status filter dropdown onchange updates knPfViewState (field renamed to statusFilter by GATE 4C-C.2)", () => {
  // Same invariant as originally shipped ("onchange updates persisted state, then re-renders"),
  // now pointed at the field's current name — see test/gate4c-c2/filter-contract.test.mjs.
  assert.match(compactFnSrc, /\$\("#knPfFilter"\)\.onchange=\(e\)=>\{knPfViewState\.statusFilter=e\.target\.value;knowledgeRenderParticipantsCompact\(\);\};/);
});

test("GATE 4C-C: Compact render reads its filter from knPfViewState, not the DOM (field renamed to statusFilter by GATE 4C-C.2)", () => {
  assert.match(compactFnSrc, /knowledgeParticipantsMarkup\(participants,participantCounts,session,knPfViewState\.statusFilter,knPfViewState\.classFilter\)/);
  assert.match(compactFnSrc, /\$\("#knPfFilter"\)\.value=knPfViewState\.statusFilter;/);
  // the old DOM-read pattern must be gone
  assert.doesNotMatch(compactFnSrc, /\$\("#knPfFilter"\)\?\.value/);
});

// ===================================================================================
// 10/11/15/16 — everything else must remain byte-identical to the 4C-B checkpoint
// ===================================================================================

// NOTE: the "knowledgeParticipantsMarkup() unchanged since 4C-B" byte-identity test that
// originally stood here is retired as of GATE 4C-C.2, which explicitly and correctly changed
// knowledgeParticipantsMarkup()'s signature and filtering body (added classFilter as a second,
// AND-combined dimension) — 4C-C's own diff never touched this function, so there is no
// narrower true statement left to make here. See test/gate4c-c2/filter-contract.test.mjs for
// the up-to-date, in-depth coverage of this function's actual current behavior.

test("GATE 4C-C: loadParticipants() and knowledgeExportParticipants() unchanged since 4C-B (Refresh/CSV semantics frozen)", () => {
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", "\n  }", "loadParticipants()") + "\n  }";
  const checkpointLoad = sliceBetween(checkpointSource, "async function loadParticipants(){", "\n  }", "checkpoint loadParticipants()") + "\n  }";
  assert.equal(loadSrc, checkpointLoad);
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }", "knowledgeExportParticipants()") + "\n  }";
  const checkpointExport = sliceBetween(checkpointSource, "async function knowledgeExportParticipants(){", "\n  }", "checkpoint knowledgeExportParticipants()") + "\n  }";
  assert.equal(exportSrc, checkpointExport);
});

// ===================================================================================
// 12/13/14 — 0/1/multiple participant rendering, progress/status, active fields: re-verified
// dynamically since knowledgeParticipantsMarkup() has no DOM dependency and can run standalone
// ===================================================================================

function buildMarkupFn() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;`, sandbox);
  return sandbox.__markup;
}

test("GATE 4C-C: 0/1/multiple participant rendering and progress/status still correct (statusFilter/classFilter signature per GATE 4C-C.2)", () => {
  const markup = buildMarkupFn();
  const session = { minimumPerParticipant: 2, participantFields: { fullName: { enabled: true } } };
  const empty = markup([], new Map(), session, "all", "all");
  assert.match(empty, /Không có người tham gia phù hợp\./);
  const one = markup([{ id: "p1", fullName: "A" }], new Map([["p1", 2]]), session, "all", "all");
  assert.match(one, /Hoàn thành/);
  const multi = markup(
    [{ id: "p1", fullName: "A" }, { id: "p2", fullName: "B" }],
    new Map([["p1", 0], ["p2", 5]]),
    session, "incomplete", "all"
  );
  assert.match(multi, />A</);
  assert.doesNotMatch(multi, />B</);
});

// ===================================================================================
// 17 — state changes themselves cause no Firestore read
// ===================================================================================

test("GATE 4C-C: filter-state wiring introduces no Firestore calls", () => {
  const stateDecl = sliceBetween(dashboardSrc, "let knPfViewState=", ";", "state decl") + ";";
  assert.doesNotMatch(stateDecl, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/);
  assert.doesNotMatch(compactFnSrc, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/);
});

// ===================================================================================
// 18 — 4C-B Compact CSS (scroll cap + sticky header) remains intact, byte-identical
// ===================================================================================

test("GATE 4C-C: 4C-B Compact CSS (scroll cap + sticky header) preserved unchanged", () => {
  assert.equal(cssBlock, sliceBetween(checkpointSource, ":root{", "\n/* Badges */", "checkpoint css block"));
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap\{max-height:320px; overflow-y:auto;\}/);
  assert.match(cssBlock, /\.kn-pf-compact \.table-wrap thead th\{position:sticky; top:0;/);
});
