// GATE 4C-F.2 — Search V1 for the Knowledge participant panel. PURE test, no emulator. Extracts
// real shipped source out of index.html and, for everything this gate requires unchanged, diffs
// against the exact production baseline commit (affb0edb) via git — never a hand-copied frozen
// string.
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
const BASELINE = "affb0edb7ab2c5787113ad82519a4207e758cd83";

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
const labelsSrc = sliceBetween(source, "const KN_PARTICIPANT_FIELD_LABELS=", ";", "labels") + ";";
const normalizeSrc = sliceBetween(source, "function knPfNormalizeSearch(s){", "\n}", "normalize") + "\n}";
const searchableTextSrc = sliceBetween(source, "function knPfSearchableText(r){", "\n}", "searchableText") + "\n}";
const markupSrc = sliceBetween(source, "function knowledgeParticipantsMarkup(", "</tbody></table></div>`;\n  }", "markup") + "</tbody></table></div>`;\n  }";
const wireSrc = sliceBetween(source, "function wireParticipantControls(", "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }", "wire") + "if(exportBtn)exportBtn.onclick=knowledgeExportParticipants;\n  }";
const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "compactFn") + "\n  }";
const expandedFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsExpanded(", "\n  }", "expandedFn") + "\n  }";
const dashboardSrc = sliceBetween(source, "async function knowledgeDashboard(", "\nfunction knowledgeProfileIsValid(", "dashboard");
const stateDecl = sliceBetween(dashboardSrc, "let knPfViewState=", ";") + ";";

// ===================================================================================
// 1/2 — existing search state reused, no second Search state
// ===================================================================================

test("GATE 4C-F.2: knPfViewState reused unchanged (mode/fullscreen/statusFilter/classFilter/search); no second Search state introduced", () => {
  assert.match(stateDecl, /let knPfViewState=\{mode:'compact',fullscreen:false,statusFilter:'all',classFilter:'all',search:''\};/);
  const searchStateDecls = (source.match(/let\s+\w*[Ss]earch\w*\s*=\s*\{/g) || []).filter(m => !m.includes("knPfViewState"));
  assert.equal(searchStateDecls.length, 0, "no second search-related state object introduced");
});

// ===================================================================================
// 3 — one shared Search input, appears via the shared markup/wiring architecture
// ===================================================================================

test("GATE 4C-F.2: exactly one Search input exists, inside the shared knowledgeParticipantsMarkup() output", () => {
  const occurrences = (source.match(/id="knPfSearch"/g) || []).length;
  assert.equal(occurrences, 1);
  assert.match(markupSrc, /<input type="text" id="knPfSearch" placeholder="Tìm theo họ tên hoặc lớp\.\.\."/);
});

test("GATE 4C-F.2: Compact and Expanded/Fullscreen both call the same knowledgeParticipantsMarkup(), so Search appears identically in all three presentations", () => {
  assert.match(compactFnSrc, /knowledgeParticipantsMarkup\(participants,participantCounts,session,knPfViewState\.statusFilter,knPfViewState\.classFilter,knPfViewState\.search\)/);
  assert.match(expandedFnSrc, /knowledgeParticipantsMarkup\(participants,participantCounts,session,knPfViewState\.statusFilter,knPfViewState\.classFilter,knPfViewState\.search\)/);
});

// ===================================================================================
// dynamic execution harness for markup + normalization behavior
// ===================================================================================

function buildSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${normalizeSrc}\n${searchableTextSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;\nglobalThis.__normalize = knPfNormalizeSearch;`, sandbox);
  return sandbox;
}

const baseSession = { minimumPerParticipant: 2, participantFields: { fullName: { enabled: true }, className: { enabled: true } }, classOptions: ["K77.A01", "K77.A02"] };

// ===================================================================================
// 4/5 — Search fullName / className
// ===================================================================================

test("GATE 4C-F.2: Search matches fullName", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "Nguyễn Văn An", className: "K77.A01" }, { id: "p2", fullName: "Trần Thị Bình", className: "K77.A02" }];
  const counts = new Map([["p1", 0], ["p2", 0]]);
  const html = markup(participants, counts, baseSession, "all", "all", "Nguyen");
  assert.match(html, />Nguyễn Văn An</);
  assert.doesNotMatch(html, />Trần Thị Bình</);
});

test("GATE 4C-F.2: Search matches className", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "A", className: "K77.A01" }, { id: "p2", fullName: "B", className: "K77.A02" }];
  const counts = new Map([["p1", 0], ["p2", 0]]);
  const html = markup(participants, counts, baseSession, "all", "all", "K77.A02");
  assert.match(html, />B</);
  assert.doesNotMatch(html, />A</);
});

// ===================================================================================
// 6/7/8 — case-insensitive, accent-insensitive, Đ/đ normalization
// ===================================================================================

test("GATE 4C-F.2: case-insensitive matching", () => {
  const { __normalize: normalize } = buildSandbox();
  assert.equal(normalize("NGUYEN"), normalize("nguyen"));
});

test("GATE 4C-F.2: accent-insensitive matching (required examples)", () => {
  const { __normalize: normalize } = buildSandbox();
  assert.equal(normalize("Nguyen"), normalize("Nguyễn"));
  assert.equal(normalize("NGUYEN"), normalize("nguyễn"));
  assert.equal(normalize("Dang"), normalize("Đặng"));
});

test("GATE 4C-F.2: Đ/đ normalization specifically (not covered by NFD decomposition alone)", () => {
  const { __normalize: normalize } = buildSandbox();
  assert.equal(normalize("đ"), "d");
  assert.equal(normalize("Đ"), "d");
});

test("GATE 4C-F.2: end-to-end accent-insensitive markup match", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "Đặng Nguyễn An", className: "K1" }];
  const counts = new Map([["p1", 0]]);
  const html = markup(participants, counts, baseSession, "all", "all", "dang nguyen");
  assert.match(html, />Đặng Nguyễn An</);
});

// ===================================================================================
// 9 — whitespace-only query = no Search filtering
// ===================================================================================

test("GATE 4C-F.2: empty and whitespace-only query apply no Search filtering", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "A", className: "K1" }, { id: "p2", fullName: "B", className: "K2" }];
  const counts = new Map([["p1", 0], ["p2", 0]]);
  for (const q of ["", "   ", "\t\n"]) {
    const html = markup(participants, counts, baseSession, "all", "all", q);
    assert.match(html, />A</, `query ${JSON.stringify(q)} should not filter`);
    assert.match(html, />B</, `query ${JSON.stringify(q)} should not filter`);
  }
});

// ===================================================================================
// 10/11 — normalized substring semantics; explicitly NOT tokenized/reordered (frozen contract)
// ===================================================================================

test("GATE 4C-F.2: substring semantics — 'nguyen van' matches 'Nguyễn Văn An' (query is a substring of the searchable text)", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "Nguyễn Văn An", className: "K1" }];
  const counts = new Map([["p1", 0]]);
  const html = markup(participants, counts, baseSession, "all", "all", "nguyen van");
  assert.match(html, />Nguyễn Văn An</);
});

test("GATE 4C-F.2 FROZEN CONTRACT: reordered query 'van nguyen' is NOT required to match 'Nguyễn Văn An' (V1 is plain substring, not tokenized-AND)", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "Nguyễn Văn An", className: "K1" }];
  const counts = new Map([["p1", 0]]);
  const html = markup(participants, counts, baseSession, "all", "all", "van nguyen");
  assert.match(html, /Không có người tham gia phù hợp\./);
  assert.doesNotMatch(html, />Nguyễn Văn An</);
});

test("GATE 4C-F.2: markup source contains no tokenization/splitting of the search query", () => {
  assert.doesNotMatch(markupSrc, /searchQuery\.split|normalizedQuery\.split/);
  assert.match(markupSrc, /knPfSearchableText\(r\)\.includes\(normalizedQuery\)/);
});

// ===================================================================================
// 12/13 — missing/null fullName/className safe
// ===================================================================================

test("GATE 4C-F.2: missing/null fullName and className are handled safely", () => {
  const { __markup: markup, __normalize: normalize } = buildSandbox();
  assert.equal(normalize(null), "");
  assert.equal(normalize(undefined), "");
  const participants = [{ id: "p1", className: "K1" }, { id: "p2", fullName: "B" }];
  const counts = new Map([["p1", 0], ["p2", 0]]);
  assert.doesNotThrow(() => markup(participants, counts, baseSession, "all", "all", "anything"));
  const html = markup(participants, counts, baseSession, "all", "all", "k1");
  assert.match(html, /Không có người tham gia phù hợp\.|<td>—<\/td>/);
});

// ===================================================================================
// 14/15/16 — Search AND status AND class; changing one preserves the others
// ===================================================================================

test("GATE 4C-F.2: Search AND status AND class — only rows satisfying all three remain", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [
    { id: "p1", fullName: "Nguyễn Văn An", className: "K77.A01" },
    { id: "p2", fullName: "Nguyễn Thị Bình", className: "K77.A02" },
    { id: "p3", fullName: "Trần Văn Cường", className: "K77.A02" },
  ];
  const counts = new Map([["p1", 2], ["p2", 0], ["p3", 0]]);
  const html = markup(participants, counts, baseSession, "complete", "K77.A01", "nguyen");
  assert.match(html, />Nguyễn Văn An</);
  assert.doesNotMatch(html, />Nguyễn Thị Bình</);
  assert.doesNotMatch(html, />Trần Văn Cường</);
});

test("GATE 4C-F.2: filter predicate is the frozen searchOk&&statusOk&&classOk order", () => {
  assert.match(markupSrc, /return searchOk&&statusOk&&classOk;/);
});

test("GATE 4C-F.2: wiring — Search oninput never touches statusFilter/classFilter; status/class onchange never touch search", () => {
  const searchBlock = sliceBetween(wireSrc, "const searchInput=", "    }\n    const statusSel=", "search block");
  assert.doesNotMatch(searchBlock, /knPfViewState\.statusFilter=|knPfViewState\.classFilter=/);
  const statusBlock = sliceBetween(wireSrc, "const statusSel=host.querySelector('#knPfFilter');", "const classSel=", "status block");
  const classBlock = sliceBetween(wireSrc, "const classSel=host.querySelector('#knPfClassFilter');", "const refreshBtn=", "class block");
  assert.doesNotMatch(statusBlock, /knPfViewState\.search=/);
  assert.doesNotMatch(classBlock, /knPfViewState\.search=/);
});

// ===================================================================================
// 17-23 — mode persistence: structural proof via unchanged dispatch + no reset anywhere
// ===================================================================================

test("GATE 4C-F.2: modalCloseCleanup never resets knPfViewState.search (persists across genuine Close, exactly like statusFilter/classFilter already do)", () => {
  const cleanupSrc = sliceBetween(expandedFnSrc, "modalCloseCleanup=()=>{", "    };", "cleanup") + "    };";
  assert.doesNotMatch(cleanupSrc, /knPfViewState\.search=/);
  assert.match(cleanupSrc, /knPfViewState\.fullscreen=false;/);
});

test("GATE 4C-F.2: no code path anywhere resets knPfViewState.search except the Search input's own oninput handler", () => {
  const searchWrites = [...source.matchAll(/knPfViewState\.search\s*=/g)];
  assert.equal(searchWrites.length, 1, "expected exactly one write site: the Search input's oninput handler");
});

// ===================================================================================
// 24/25 — Refresh and submissions rerender preserve Search (structural: dispatch unchanged)
// ===================================================================================

test("GATE 4C-F.2: loadParticipants()'s dispatch and knowledgeRenderParticipantsCurrentMode() are byte-identical to baseline (Search persists across Refresh/submissions rerenders structurally, no special-casing)", () => {
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "load") + commonTail;
  const baselineLoad = sliceBetween(baselineSource, "async function loadParticipants(){", commonTail, "baseline load") + commonTail;
  assert.equal(loadSrc, baselineLoad);
  const currentModeFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCurrentMode(", "\n  }") + "\n  }";
  const baselineCurrentModeFnSrc = sliceBetween(baselineSource, "function knowledgeRenderParticipantsCurrentMode(", "\n  }") + "\n  }";
  assert.equal(currentModeFnSrc, baselineCurrentModeFnSrc);
});

test("GATE 4C-F.2: Refresh button cancels any pending Search debounce before starting the fetch (no post-Refresh render race)", () => {
  assert.match(wireSrc, /refreshBtn\.onclick=\(\)=>\{if\(!participantsLoading\)\{if\(knPfSearchDebounceTimer\)\{clearTimeout\(knPfSearchDebounceTimer\);knPfSearchDebounceTimer=null;\}loadParticipants\(\);\}\};/);
});

// ===================================================================================
// 26/27/28 — no Firestore persistence of Search query, no new reads/listeners
// ===================================================================================

test("GATE 4C-F.2: Search query is never written to Firestore (no setDoc/updateDoc/addDoc call anywhere near knPfViewState.search)", () => {
  assert.doesNotMatch(wireSrc, /setDoc|updateDoc|addDoc|writeBatch|runTransaction/);
});

test("GATE 4C-F.2: no new Firestore read/listener tokens introduced in the touched functions", () => {
  for (const [label, code] of [["wireParticipantControls", wireSrc], ["knowledgeRenderParticipantsExpanded", expandedFnSrc], ["knowledgeParticipantsMarkup", markupSrc]]) {
    assert.doesNotMatch(code, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/, label);
  }
});

// ===================================================================================
// 29/30/31 — safe rendering: no HTML interpolation of query, no RegExp construction, no XSS
// ===================================================================================

test("GATE 4C-F.2: Search input's HTML carries no value attribute — the query never passes through HTML-string interpolation", () => {
  assert.match(markupSrc, /<input type="text" id="knPfSearch" placeholder="[^"]*"\s+style="[^"]*">/);
  const inputTag = sliceBetween(markupSrc, '<input type="text" id="knPfSearch"', '>', "search input tag") + ">";
  assert.doesNotMatch(inputTag, /value=/);
});

test("GATE 4C-F.2: Search value is set only via DOM property assignment (searchInput.value=), never innerHTML/outerHTML with the query", () => {
  assert.match(wireSrc, /searchInput\.value=knPfViewState\.search;/);
  assert.doesNotMatch(wireSrc, /innerHTML[^;]*knPfViewState\.search|outerHTML[^;]*knPfViewState\.search/);
});

test("GATE 4C-F.2: no RegExp is ever constructed from the search query (deterministic string comparison only)", () => {
  assert.doesNotMatch(markupSrc, /new RegExp/);
  assert.doesNotMatch(wireSrc, /new RegExp/);
});

test("GATE 4C-F.2: special characters are safe by construction (dynamic execution proof)", () => {
  const { __markup: markup } = buildSandbox();
  const participants = [{ id: "p1", fullName: "A", className: "K1" }];
  const counts = new Map([["p1", 0]]);
  for (const q of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' OR '1'='1", "[a-z]+", "(.*)", "a\\b", "a*b?c+"]) {
    let html;
    assert.doesNotThrow(() => { html = markup(participants, counts, baseSession, "all", "all", q); }, `query ${JSON.stringify(q)} must not throw`);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /onerror=alert/);
  }
});

// ===================================================================================
// 32/33 — CSV full dataset despite Search and despite all three filters
// ===================================================================================

test("GATE 4C-F.2: knowledgeExportParticipants() byte-identical to production baseline (CSV remains full dataset, ignores Search/status/class)", () => {
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }") + "\n  }";
  const baselineExport = sliceBetween(baselineSource, "async function knowledgeExportParticipants(){", "\n  }") + "\n  }";
  assert.equal(exportSrc, baselineExport);
  assert.match(exportSrc, /participants\.forEach\(/);
  assert.doesNotMatch(exportSrc, /knPfViewState|filtered/);
});

// ===================================================================================
// 34 — debounce exists, single tracked timer, 150ms
// ===================================================================================

test("GATE 4C-F.2: a single tracked Search debounce timer exists, at 150ms", () => {
  assert.match(source, /let knPfSearchDebounceTimer=null;/);
  assert.match(wireSrc, /knPfSearchDebounceTimer=setTimeout\(\(\)=>\{/);
  assert.match(wireSrc, /\},150\);/);
});

test("GATE 4C-F.2: knPfViewState.search is updated synchronously on input, independent of the debounced rerender", () => {
  const oninputSrc = sliceBetween(wireSrc, "searchInput.oninput=(e)=>{", "      };", "oninput") + "      };";
  const beforeTimer = oninputSrc.slice(0, oninputSrc.indexOf("setTimeout"));
  assert.match(beforeTimer, /knPfViewState\.search=e\.target\.value;/);
});

// ===================================================================================
// 35/36 — stale-timer ownership: cancelled at top of every rerender
// ===================================================================================

test("GATE 4C-F.2: pending Search debounce is unconditionally cancelled at the very top of wireParticipantControls() (runs on every participant rerender from any trigger)", () => {
  const topOfFn = wireSrc.slice(0, wireSrc.indexOf("const searchInput="));
  assert.match(topOfFn, /if\(knPfSearchDebounceTimer\)\{clearTimeout\(knPfSearchDebounceTimer\);knPfSearchDebounceTimer=null;\}/);
});

test("GATE 4C-F.2: debounced callback re-locates the live host via knPfViewState.mode dispatch — Compact reuses its still-valid closure-captured host (never replaced across rerenders), Expanded re-queries fresh since openModal() replaces its whole subtree; no unscoped document-global $(\"#knPf...\") lookup", () => {
  const callbackSrc = sliceBetween(wireSrc, "knPfSearchDebounceTimer=setTimeout(()=>{", "        },150);", "callback") + "        },150);";
  assert.match(callbackSrc, /const liveHost=knPfViewState\.mode==='expanded'\?document\.querySelector\('#globalModal \.modal'\):host;/);
  assert.match(callbackSrc, /const freshInput=liveHost\?liveHost\.querySelector\('#knPfSearch'\):null;/);
  assert.doesNotMatch(callbackSrc, /\$\("#knPf/);
});

// ===================================================================================
// 37/38 — focus/caret restoration
// ===================================================================================

test("GATE 4C-F.2: focus is restored on the fresh input after the debounced rerender", () => {
  const callbackSrc = sliceBetween(wireSrc, "knPfSearchDebounceTimer=setTimeout(()=>{", "        },150);", "callback") + "        },150);";
  assert.match(callbackSrc, /freshInput\.focus\(\);/);
});

test("GATE 4C-F.2: caret/selection is captured before scheduling and restored after, safely tolerating null selectionStart/End without throwing", () => {
  const oninputSrc = sliceBetween(wireSrc, "searchInput.oninput=(e)=>{", "      };", "oninput") + "      };";
  assert.match(oninputSrc, /const selStart=e\.target\.selectionStart,selEnd=e\.target\.selectionEnd;/);
  assert.match(oninputSrc, /if\(selStart!=null&&selEnd!=null\)\{try\{freshInput\.setSelectionRange\(selStart,selEnd\);\}catch\(err\)\{\}\}/);
});

// ===================================================================================
// 39 — repeated cycles: no handler/timer accumulation (structural — single tracked ref pattern)
// ===================================================================================

test("GATE 4C-F.2: exactly one live debounce timer can ever exist (single tracked reference, cleared before every reassignment)", () => {
  const setTimeoutCount = (wireSrc.match(/knPfSearchDebounceTimer=setTimeout\(/g) || []).length;
  assert.equal(setTimeoutCount, 1, "exactly one setTimeout call site");
  const clearCount = (wireSrc.match(/clearTimeout\(knPfSearchDebounceTimer\)/g) || []).length;
  assert.equal(clearCount, 3, "expected 3 clearTimeout call sites: top-of-render guard, re-schedule guard inside oninput, Refresh button guard");
});

// ===================================================================================
// 40 — Fullscreen contract preserved (structural: Fullscreen-specific lines untouched)
// ===================================================================================

test("GATE 4C-F.2: Fullscreen contract fully preserved — wantFullscreen snapshot, is-fullscreen ownership, ESC ownership guards, margin:-16px CSS all still present unchanged", () => {
  assert.match(expandedFnSrc, /const wantFullscreen=knPfViewState\.fullscreen;/);
  assert.match(expandedFnSrc, /if\(wantFullscreen\)modalEl\.classList\.add\('is-fullscreen'\);/);
  assert.match(expandedFnSrc, /if\(knPfViewState\.mode!=='expanded'\|\|knPfViewState\.fullscreen!==true\)return;/);
  assert.match(expandedFnSrc, /if\(!liveModal\|\|!liveModal\.classList\.contains\('is-fullscreen'\)\)return;/);
  assert.match(expandedFnSrc, /if\(!liveModal\.querySelector\('\.kn-pf-expanded'\)\)return;/);
  assert.equal((source.match(/margin:-16px/g) || []).length, 1);
});
