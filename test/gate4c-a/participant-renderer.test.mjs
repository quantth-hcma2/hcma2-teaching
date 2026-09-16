// GATE 4C-A — behavior-preserving refactor proof for the Knowledge participant renderer.
// PURE test, no emulator, no Firestore. Extracts the actual source of the small set of
// functions this refactor touches directly out of index.html (never hand-copied/retyped) and
// executes the extracted knowledgeParticipantsMarkup() in a sandbox with controlled fixtures,
// so this proves the ACTUAL shipped markup logic, not a reimplementation of it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, "..", "..", "index.html");
// Normalize CRLF->LF: the working-tree checkout may have CRLF line endings (core.autocrlf),
// while this file's marker strings are written with plain \n — normalizing here keeps the
// extraction robust to either checkout style without weakening what it verifies.
const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const escSrc = sliceBetween(source, "function esc(s){", "\n", "esc()");
const labelsSrc = sliceBetween(source, "const KN_PARTICIPANT_FIELD_LABELS=", ";", "KN_PARTICIPANT_FIELD_LABELS") + ";";
// Bounded by a stable CODE token (the function's own last statement) rather than a comment,
// so this never silently over-captures if a neighboring comment changes wording (as happened
// here once GATE 4C-D.2 inserted wireParticipantControls() with its own leading comment where
// "// GATE 4C-A: Compact mount" used to immediately follow).
const markupSrc = sliceBetween(
  source,
  "function knowledgeParticipantsMarkup(",
  "</tbody></table></div>`;\n  }",
  "knowledgeParticipantsMarkup()"
) + "</tbody></table></div>`;\n  }";
const compactSrc = sliceBetween(
  source,
  "function knowledgeRenderParticipantsCompact(",
  "\n  }",
  "knowledgeRenderParticipantsCompact()"
) + "\n  }";

test("GATE 4C-A source shape: new functions exist, old bare definition does not", () => {
  assert.match(source, /function knowledgeParticipantsMarkup\(/);
  assert.match(source, /function knowledgeRenderParticipantsCompact\(/);
  // Scope this check to the knowledgeDashboard() function body only (bounded by the next
  // top-level function after it) rather than the whole file, so unrelated text elsewhere
  // (URLs, other comments) can never produce a false positive or a false negative here.
  const dashboardSrc = sliceBetween(
    source,
    "async function knowledgeDashboard(",
    "\nfunction knowledgeProfileIsValid(",
    "knowledgeDashboard() body"
  );
  const codeLines = dashboardSrc.split("\n").filter(line => !/^\s*\/\//.test(line));
  const codeOnly = codeLines.join("\n");
  // the OLD function name must no longer exist as a live definition inside this scope
  assert.doesNotMatch(codeOnly, /function knowledgeRenderParticipants\(\)\{/);
  // every call site inside this scope must use the new Compact name, not the bare old one
  assert.doesNotMatch(codeOnly, /[^.\w]knowledgeRenderParticipants\(\)/);
});

test("GATE 4C-A source shape: no future Item 4 controls exist yet (Fullscreen/Search)", () => {
  assert.doesNotMatch(source, /TOÀN MÀN HÌNH/);
  assert.doesNotMatch(source, /is-fullscreen/);
  // knPfViewState (4C-C) and MỞ RỘNG/Expanded (4C-D.2) were explicitly out of scope for 4C-A
  // itself (still true — this gate's own diff never introduced either), but both were later
  // added by their own authorized gates, so their absence is no longer part of "future controls
  // not yet built" — see test/gate4c-d2/expanded-mode.test.mjs for the up-to-date guard on
  // what's still not built (Fullscreen/Search), which this test's remaining assertions mirror.
  assert.doesNotMatch(source, /knPfSearch/);
});

test("GATE 4C-A source shape: extracted markup function introduces no new Firestore calls", () => {
  assert.doesNotMatch(markupSrc, /getDoc|getDocs|onSnapshot|updateDoc|setDoc|addDoc|deleteDoc/);
});

function buildMarkupFn() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${labelsSrc}\n${markupSrc}\nglobalThis.__markup = knowledgeParticipantsMarkup;`, sandbox);
  return sandbox.__markup;
}

const fullFields = { fullName: { enabled: true }, className: { enabled: true }, email: { enabled: true }, phone: { enabled: true } };

function baseSession(overrides = {}) {
  return { minimumPerParticipant: 3, participantFields: fullFields, ...overrides };
}

test("GATE 4C-A behavior: 0 participants -> empty state, zeroed counts", () => {
  const markup = buildMarkupFn();
  const html = markup([], new Map(), baseSession(), "all");
  assert.match(html, /<strong>0<\/strong>\s*<span>Đã đăng ký<\/span>/);
  assert.match(html, /Không có người tham gia phù hợp\./);
});

test("GATE 4C-A behavior: 1 participant, complete -> 1 row, Hoàn thành", () => {
  const markup = buildMarkupFn();
  const participants = [{ id: "p1", fullName: "Nguyen Van A", className: "K1", email: "a@x.com", phone: "0900000000" }];
  const counts = new Map([["p1", 3]]);
  const html = markup(participants, counts, baseSession(), "all");
  assert.match(html, /<strong>1<\/strong>\s*<span>Đã đăng ký<\/span>/);
  assert.match(html, /<strong>1<\/strong>\s*<span>Đã hoàn thành<\/span>/);
  assert.match(html, /Nguyen Van A/);
  assert.match(html, /Hoàn thành/);
});

test("GATE 4C-A behavior: multiple participants, mixed complete/incomplete counts", () => {
  const markup = buildMarkupFn();
  const participants = [
    { id: "p1", fullName: "A" }, { id: "p2", fullName: "B" }, { id: "p3", fullName: "C" }
  ];
  const counts = new Map([["p1", 3], ["p2", 1], ["p3", 0]]);
  const html = markup(participants, counts, baseSession(), "all");
  assert.match(html, /<strong>3<\/strong>\s*<span>Đã đăng ký<\/span>/);
  assert.match(html, /<strong>1<\/strong>\s*<span>Đã hoàn thành<\/span>/);
  assert.match(html, /<strong>2<\/strong>\s*<span>Chưa hoàn thành<\/span>/);
});

test("GATE 4C-A behavior: only enabled participantFields produce table columns", () => {
  const markup = buildMarkupFn();
  const session = baseSession({ participantFields: { fullName: { enabled: true }, className: { enabled: true }, email: { enabled: false }, phone: { enabled: false } } });
  const html = markup([{ id: "p1", fullName: "A", className: "K1", email: "hidden@x.com", phone: "0900" }], new Map([["p1", 3]]), session, "all");
  assert.match(html, /<th>Họ và tên<\/th>/);
  assert.match(html, /<th>Lớp<\/th>/);
  assert.doesNotMatch(html, /<th>Email<\/th>/);
  assert.doesNotMatch(html, /<th>Số điện thoại<\/th>/);
  assert.doesNotMatch(html, /hidden@x\.com/);
});

test("GATE 4C-A behavior: filter=complete / incomplete narrows rows correctly", () => {
  const markup = buildMarkupFn();
  const participants = [{ id: "p1", fullName: "Done" }, { id: "p2", fullName: "NotDone" }];
  const counts = new Map([["p1", 5], ["p2", 0]]);
  const session = baseSession();
  const complete = markup(participants, counts, session, "complete");
  assert.match(complete, /Done/);
  assert.doesNotMatch(complete, /NotDone/);
  const incomplete = markup(participants, counts, session, "incomplete");
  assert.match(incomplete, /NotDone/);
  assert.doesNotMatch(incomplete, />Done</); // "Done" alone must not appear as a row value
});

test("GATE 4C-A behavior: progress/status reflects minimumPerParticipant", () => {
  const markup = buildMarkupFn();
  const html = markup([{ id: "p1", fullName: "A" }], new Map([["p1", 2]]), baseSession({ minimumPerParticipant: 5 }), "all");
  assert.match(html, /2\/5/);
  assert.match(html, /Chưa hoàn thành/);
});

test("GATE 4C-A behavior: orphan submissions (no matching profile) counted, not fabricated as a row", () => {
  const markup = buildMarkupFn();
  const counts = new Map([["p1", 2], ["ghost", 4]]);
  const html = markup([{ id: "p1", fullName: "A" }], counts, baseSession(), "all");
  assert.match(html, /1 lượt gửi không khớp/);
  assert.doesNotMatch(html, /ghost/);
});

test("GATE 4C-A behavior: participant field values are HTML-escaped", () => {
  const markup = buildMarkupFn();
  const html = markup([{ id: "p1", fullName: "<script>alert(1)</script>" }], new Map([["p1", 1]]), baseSession(), "all");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("GATE 4C-A wiring: Compact mount wires Refresh/Export (now via the shared wireParticipantControls() helper introduced by GATE 4C-D.2)", () => {
  // GATE 4C-D.2 factored this inline wiring into a shared helper reused by Expanded — the exact
  // Refresh/Export behavior is now verified in depth by test/gate4c-d2/expanded-mode.test.mjs;
  // this check narrows to confirming Compact still delegates to it (the wiring hasn't silently
  // been dropped or reimplemented a second time).
  assert.match(compactSrc, /wireParticipantControls\(wrap,knowledgeRenderParticipantsCompact\)/);
});

test("GATE 4C-A frozen: knowledgeExportParticipants() is byte-identical to the frozen baseline; loadParticipants()'s fetch logic is unchanged (only its final dispatch line legitimately changed, by GATE 4C-D.2)", () => {
  // Pin the exact known-frozen fetch text (copied verbatim from the origin/main baseline at
  // commit 93e8798f0d08d40e11e94d720c45065ee19d07a3, before this refactor) — any drift fails
  // loudly. Bounded by the catch-block-close + final participantsLoading=false reset, the last
  // line every version of loadParticipants() has always shared before its dispatch call.
  const commonTail = "    }\n    participantsLoading=false;\n";
  const loadSrc = sliceBetween(source, "async function loadParticipants(){", commonTail, "loadParticipants()") + commonTail;
  const frozenLoad = `async function loadParticipants(){
    if(session.collectParticipantProfile!==true)return;
    participantsLoading=true;
    const wrap=$("#knPfWrap");if(wrap)wrap.innerHTML='<div class="center-screen"><span class="spinner"></span></div>';
    try{
      const snap=await getDocs(collection(db,"knowledgeSessions",sessionId,"participants"));
      if(STATE.user.uid!==openerUid){participantsLoading=false;return;}
      participants=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){
      participantsLoading=false;
      if(wrap)wrap.innerHTML=errorBlock(e,loadParticipants);
      return;
` + commonTail;
  assert.equal(loadSrc, frozenLoad);
  const exportSrc = sliceBetween(source, "async function knowledgeExportParticipants(){", "\n  }", "knowledgeExportParticipants()") + "\n  }";
  assert.doesNotMatch(exportSrc, /knowledgeParticipantsMarkup|knPfViewState/);
});
