// GATE 2B-RT-INTEGRATION — SOURCE GUARD. Static, structural proof for the RichText V1 integration
// into index.html's Group Discussion common-instructions and per-group-topic authoring/rendering,
// following the same SOURCE GUARD pattern used throughout this engagement for DOM-embedded logic
// with no isolated unit-test seam (test/gate-e6, test/gate2as, test/gate2a-auth-i2-correction-fix,
// test/gate2a-auth-i3-ui-fix). Live behavioral proof (real browser + real Firestore emulator) is
// documented in the GATE 2B-RT-INTEGRATION report; this file proves the exact code shape survives
// unintentional future edits.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const html = readFileSync(indexHtmlPath, "utf8").replace(/\r\n/g, "\n");

function fnBody(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start !== -1, `could not locate: ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, `could not locate end marker (${endMarker}) after ${startMarker}`);
  return html.slice(start, end);
}

// ===================================================================================
// Imports: reuses the approved modules, never a parallel implementation
// ===================================================================================

test("1: index.html imports validateRichTextV1/richTextToPlainText from rich-text-contract.mjs, renderRichText from rich-text-renderer.mjs, and RichTextEditor from rich-text-editor.mjs", () => {
  assert.match(html, /import\s*\{\s*validateRichTextV1,\s*richTextToPlainText\s*\}\s*from\s*"\.\/rich-text-contract\.mjs";/);
  assert.match(html, /import\s*\{\s*renderRichText\s*\}\s*from\s*"\.\/rich-text-renderer\.mjs";/);
  assert.match(html, /import\s*\{\s*RichTextEditor\s*\}\s*from\s*"\.\/rich-text-editor\.mjs";/);
});

test("2: no second RichTextEditor-like class or parallel validator is defined in index.html", () => {
  assert.doesNotMatch(html, /class\s+RichTextEditor/);
  assert.doesNotMatch(html, /function\s+validateRichTextV1/);
  assert.doesNotMatch(html, /function\s+renderRichText/);
});

// ===================================================================================
// Rendering: every common-instructions / topic display goes through renderRichText,
// never innerHTML/textContent with stored rich content directly
// ===================================================================================

test("3: exactly 7 renderRichText call sites exist — lecturer common (initial+live), lecturer topics (list/panel/popup), student common (initial+live), student topic", () => {
  const matches = html.match(/renderRichText\(/g) || [];
  assert.equal(matches.length, 7, `expected 7 renderRichText(...) call sites, found ${matches.length}`);
});

test("4: lecturer common-instructions card is rendered via renderRichText on both initial paint and live update, never via innerHTML/textContent with instructions data directly", () => {
  assert.match(html, /function renderCommonInstructions\(\)\{\s*renderRichText\(\$\("#gLiveInstructions"\), current\.instructionsRich, current\.instructions\|\|""\);\s*\}/);
  assert.match(html, /renderCommonInstructions\(\);renderTopics\(\);renderPanels\(\);updateTimer\(\);/);
  assert.match(html, /\$\("#gLiveTitle"\)\.textContent=current\.title\|\|"";renderCommonInstructions\(\);/);
  assert.doesNotMatch(html, /\$\("#gLiveInstructions"\)\.textContent=/, "must never set gLiveInstructions via textContent directly — must go through renderRichText");
  assert.doesNotMatch(html, /\$\("#gLiveInstructions"\)\.innerHTML=/, "must never set gLiveInstructions via innerHTML");
});

test("5: student common-instructions is rendered via renderRichText on both initial paint and live update", () => {
  const occurrences = (html.match(/renderRichText\(\$\("#gsLiveInstructions"\), a\.instructionsRich, a\.instructions\|\|""\);/g) || []).length;
  assert.equal(occurrences, 2, "expected exactly 2 renderRichText calls for #gsLiveInstructions (initial + live)");
  assert.doesNotMatch(html, /\$\("#gsLiveInstructions"\)\.textContent=/, "must never set gsLiveInstructions via textContent directly");
});

test("6: student topic display (updateTopicDisplay) renders the topic body via renderRichText, with the '📌 Chủ đề nhóm N:' prefix kept as a separate plain-text label", () => {
  const body = fnBody("function updateTopicDisplay(){", "\n    function renderMyNotes");
  assert.match(body, /\$\("#gsTopicLabel"\)\.textContent=`📌 Chủ đề nhóm \$\{membershipGroup\}: `;/);
  assert.match(body, /renderRichText\(\$\("#gsTopicContent"\), currentTopic\?\.topicRich, t\);/);
});

test("7: lecturer's per-group topic list (renderTopics) and live panels (renderPanels) render topic content via renderRichText, not by interpolating topic text into an innerHTML template string", () => {
  const topicsBody = fnBody("function renderTopics(){", "\n  }");
  assert.match(topicsBody, /data-topic-mount="\$\{i\}"/);
  assert.match(topicsBody, /renderRichText\(\$\(`\[data-topic-mount="\$\{i\}"\]`\), topics\[String\(i\)\]\?\.topicRich, topics\[String\(i\)\]\.topic\);/);
  assert.doesNotMatch(topicsBody, /\$\{esc\(topics\[String\(i\)\]\?\.topic/, "must not interpolate raw topic text into the innerHTML template");
});

// ===================================================================================
// Editor integration: RichTextEditor mounted for instructions/topic, legacy-vs-rich load policy
// ===================================================================================

test("8: openSessionInfoEditor mounts a RichTextEditor for every Rich-capable field (RICH_ROW_KEY), loading instructionsRich/topicRich only when present AND validateRichTextV1 passes, else the legacy plain string", () => {
  assert.match(html, /const RICH_ROW_KEY=\{instructions:"instructionsRich",topic:"topicRich"\};/);
  const body = fnBody("async function openSessionInfoEditor(kind,id,onSaved){", "\nasync function ");
  assert.match(body, /new RichTextEditor\(\{container:mount, ariaLabel:esc\(labels\[key\]\)\}\)/);
  assert.match(body, /if\(stored!==undefined && stored!==null && validateRichTextV1\(stored\)\) editor\.setRichText\(stored\);/);
  assert.match(body, /else editor\.setPlainText\(row\.original\?\.\[key\] \?\? ""\);/);
});

test("9: the editor's DOM mount for Rich fields never uses innerHTML/insertAdjacentHTML/DOMParser with stored rich data — RichTextEditor itself is the only thing writing into the mount", () => {
  const body = fnBody("async function openSessionInfoEditor(kind,id,onSaved){", "\nasync function ");
  assert.doesNotMatch(body, /\.innerHTML\s*=.*stored/i);
  assert.doesNotMatch(body, /insertAdjacentHTML/);
  assert.doesNotMatch(body, /new DOMParser/);
});

// ===================================================================================
// Save path: fail-closed export check BEFORE any Firestore write, whole-save abort on any failure
// ===================================================================================

test("10: save.onclick computes every Rich editor's getRichText() and aborts the ENTIRE save (returns before calling saveSessionInfo) if any one fails — the check runs before any Firestore access", () => {
  const body = fnBody("save.onclick=async()=>{", "  };\n}");
  const richResultsIdx = body.indexOf("const richResults=richEntries.map(en=>({en,result:en.editor.getRichText()}));");
  const failedCheckIdx = body.indexOf("const failed=richResults.find(r=>!r.result.ok);");
  const saveCallIdx = body.indexOf("await saveSessionInfo(model,values,richPatches);");
  assert.ok(richResultsIdx !== -1 && failedCheckIdx !== -1 && saveCallIdx !== -1, "expected all three markers present");
  assert.ok(richResultsIdx < failedCheckIdx && failedCheckIdx < saveCallIdx, "export-check must run before the Firestore save call");
  assert.match(body, /if\(failed\)\{[\s\S]*?return;\s*\}/, "must return (abort) before reaching saveSessionInfo when any editor's export fails");
});

test("11: the over-limit block message identifies the specific field/group by name and never silently truncates or clears the editor", () => {
  const body = fnBody("save.onclick=async()=>{", "  };\n}");
  assert.match(body, /vượt quá giới hạn định dạng cho phép/);
  assert.doesNotMatch(body, /richEntries\.forEach\(en=>en\.editor\.setPlainText/, "must not reset/clear editor content on a failed export");
});

test("12: getRichText() failure sets NEITHER the rich field nor its plain mirror in richPatches — a change is only queued when the editor's export actually differs from its load-time baseline", () => {
  const body = fnBody("save.onclick=async()=>{", "  };\n}");
  assert.match(body, /const changed=JSON\.stringify\(richValue\)!==JSON\.stringify\(en\.baselineRich\) \|\| plainMirror!==en\.baselinePlain;/);
  assert.match(body, /if\(changed\) richPatches\[en\.rowIndex\]=\{richKey:en\.richKey, richValue, plainKey:en\.key, plainValue:plainMirror\};/);
});

test("13: instructions/topic plain-mirror values are read from the RichTextEditor's own trusted getRichText()+richTextToPlainText() output, never independently re-scraped from a textarea for Rich-managed fields", () => {
  const body = fnBody("save.onclick=async()=>{", "  };\n}");
  assert.match(body, /const richValue=result\.value, plainMirror=richTextToPlainText\(richValue\);/);
  assert.match(body, /\.filter\(key=>!\(isGroupRich && RICH_ROW_KEY\[key\]\)\)/, "the generic DOM-value-collection loop must skip Rich-managed keys");
});

// ===================================================================================
// Atomicity: saveSessionInfo writes title + instructions/instructionsRich + every group's
// topic/topicRich together in ONE runTransaction; a deep-equality helper replaces the scalar `!==`
// comparisons so object-valued Rich fields participate in the same conflict-detection logic
// ===================================================================================

test("14: saveSessionInfo merges richPatches into the SAME edits/patch structure used for scalar fields, then commits everything in a single runTransaction — no separate write path for Rich fields", () => {
  const body = fnBody("async function saveSessionInfo(model,values,richPatches){", "\nasync function openSessionInfoEditor");
  assert.match(body, /richPatches\?\.forEach\(\(rp,i\)=>\{ if\(rp\)\{ edits\[i\]\[rp\.richKey\]=rp\.richValue; edits\[i\]\[rp\.plainKey\]=rp\.plainValue; \} \}\);/);
  const transactionIdx = body.indexOf("await runTransaction(db,async tx=>{");
  assert.ok(transactionIdx !== -1);
  const editsIdx = body.indexOf("const edits=");
  const richMergeIdx = body.indexOf("richPatches?.forEach");
  assert.ok(editsIdx < richMergeIdx && richMergeIdx < transactionIdx, "richPatches must merge into edits BEFORE the single transaction runs");
  const transactionCount = (body.match(/runTransaction\(/g) || []).length;
  assert.equal(transactionCount, 1, "exactly one runTransaction — no separate write path for Rich fields");
});

test("15: valuesEqualDeep/findConflictKey (imported from session-info-compare.mjs, GATE 2B-RT-FIX1) replace the two strict-equality comparison sites (edits filter, conflict check) so object-valued Rich fields are compared correctly, while scalar fields behave identically to before", () => {
  // GATE 2B-RT-FIX1: the comparator moved into its own module — see
  // test/gate2b-rt-fix1/comparator.test.mjs and conflict-guard.test.mjs for its behavioral proof,
  // including the regression guard against the JSON.stringify key-order bug this gate fixed. This
  // source guard only proves index.html imports and wires the real module, never a parallel copy.
  assert.match(html, /import\s*\{\s*valuesEqualDeep,\s*findConflictKey\s*\}\s*from\s*"\.\/session-info-compare\.mjs";/);
  assert.doesNotMatch(html, /function\s+valuesEqualDeep/, "must not define a parallel valuesEqualDeep in index.html");
  assert.doesNotMatch(html, /function\s+findConflictKey/, "must not define a parallel findConflictKey in index.html");
  const body = fnBody("async function saveSessionInfo(model,values,richPatches){", "\nasync function openSessionInfoEditor");
  assert.match(body, /\.filter\(k=>!valuesEqualDeep\(values\[i\]\[k\], row\.original\?\.\[k\] \?\? ""\)\)/);
  assert.match(body, /if\(findConflictKey\(patch,latest,row\.original\)\)/);
});

// ===================================================================================
// Lifecycle: modal-close cleanup destroys every mounted RichTextEditor exactly once, on any
// close path (Cancel, backdrop click, or a fresh openModal overwriting a still-open one)
// ===================================================================================

test("16: openModal() and closeModal() both flush any pending modalCloseCleanup before proceeding, so editor instances can never leak across repeated open/close cycles", () => {
  assert.match(html, /function runModalCloseCleanup\(\)\{ if\(modalCloseCleanup\)\{ try\{modalCloseCleanup\(\);\}catch\(e\)\{\} modalCloseCleanup=null; \} \}/);
  const openModalBody = fnBody("function openModal(html, large){", "\nfunction closeModal");
  assert.match(openModalBody, /runModalCloseCleanup\(\);/);
  const closeModalBody = fnBody("function closeModal(){", "\n\n");
  assert.match(closeModalBody, /runModalCloseCleanup\(\);/);
});

test("17: openSessionInfoEditor registers a modalCloseCleanup that destroys every mounted RichTextEditor instance", () => {
  const body = fnBody("async function openSessionInfoEditor(kind,id,onSaved){", "\nasync function ");
  assert.match(body, /modalCloseCleanup=\(\)=>\{ richEntries\.forEach\(en=>\{ try\{en\.editor\.destroy\(\);\}catch\(e\)\{\} \}\); \};/);
});

// ===================================================================================
// Frozen boundaries: I3 authorization / Gate 2A-S / Item 1 code untouched by this gate
// ===================================================================================

test("18: the student own-group topic listener (attachScopedListeners) still uses a single-doc onSnapshot keyed by the caller's own group — no query/collection-scan was introduced for RichText", () => {
  const body = fnBody("function attachScopedListeners(group){", "\n  }\n  ");
  assert.match(body, /unsubTopic=onSnapshot\(doc\(publicDb,GROUP_COLLECTION,id,"topics",String\(group\)\),s=>\{/);
  assert.doesNotMatch(body, /query\(collection\(publicDb,GROUP_COLLECTION,id,"topics"/, "must not have become a collection query — student topic access must stay single-doc, own-group only");
});

test("19: Gate 1B.3-D1 (Contract Interaction semantic editor, lines ~861-1094 originally) and Gate 2A-S's safeGroupFileLinkUrl import are untouched — this gate's edits are confined to the group-activity/session-info code paths", () => {
  assert.match(html, /GATE 1B\.3-D1: Contract Interaction semantic editor/);
  assert.match(html, /import \{ safeGroupFileLinkUrl \} from "\.\/group-file-link-safety\.mjs";/);
});
