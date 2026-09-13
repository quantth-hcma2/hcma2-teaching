// GATE 2B-RT-FIX1 — pure unit tests around the ACTUAL optimistic-concurrency decision
// (findConflictKey), not just the valuesEqualDeep helper in isolation. Imported directly from the
// real production module (session-info-compare.mjs) — the exact function saveSessionInfo calls.
//
// findConflictKey(patch, latest, original) mirrors saveSessionInfo's per-row transaction check:
//   patch    — the fields this save is about to write
//   latest   — the row's current server data, read inside the transaction (tx.get())
//   original — the row's data as it was when the edit modal was opened (a plain getDoc())
// Returns the first conflicting key, or null when there is no conflict.
import test from "node:test";
import assert from "node:assert/strict";
import { findConflictKey } from "../../session-info-compare.mjs";

const TOPIC_A = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "G1 Alpha", italic: true, font: "arial" }] }] };
// Same document as TOPIC_A, key order permuted at top/block/run level — the exact shape production
// observed a transaction's tx.get() return for a plain getDoc()-loaded value.
const TOPIC_A_REORDERED = { blocks: [{ runs: [{ font: "arial", italic: true, text: "G1 Alpha" }], type: "paragraph" }], version: 1 };
const TOPIC_A_EDITED = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "G1 Alpha EDITED", italic: true, font: "arial" }] }] };
const TOPIC_EXTERNAL_CHANGE = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Someone else changed this", bold: true }] }] };

const INSTR_A = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Common task", bold: true, font: "arial", size: 20, color: "red" }] }] };
const INSTR_A_REORDERED = { blocks: [{ runs: [{ color: "red", size: 20, font: "arial", bold: true, text: "Common task" }], type: "paragraph" }], version: 1 };
const INSTR_A_EDITED = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Common task EDITED", bold: true, font: "arial", size: 20, color: "red" }] }] };

// ===================================================================================
// TOPIC path (Group N topic)
// ===================================================================================

test("topicRich — FIRST SAVE: no prior value anywhere (brand new field) — no conflict", () => {
  const patch = { topicRich: TOPIC_A, topic: "G1 Alpha" };
  const conflict = findConflictKey(patch, /* latest */ {}, /* original */ {});
  assert.equal(conflict, null);
});

test("topicRich — SECOND EDIT/SAVE: latest (transaction read) has the SAME value as original (modal read) but in different Firestore key order — must be NO CONFLICT (the exact production bug)", () => {
  const original = { topicRich: TOPIC_A, topic: "G1 Alpha" };
  const latest = { topicRich: TOPIC_A_REORDERED, topic: "G1 Alpha" };
  const patch = { topicRich: TOPIC_A_EDITED, topic: "G1 Alpha EDITED" };
  const conflict = findConflictKey(patch, latest, original);
  assert.equal(conflict, null, "reordered-but-unchanged latest must never be mistaken for a concurrent edit");
});

test("topicRich — THIRD case: latest (transaction read) genuinely differs from BOTH original and the patch we're about to write — MUST BE BLOCKED", () => {
  const original = { topicRich: TOPIC_A, topic: "G1 Alpha" };
  const latest = { topicRich: TOPIC_EXTERNAL_CHANGE, topic: "Someone else changed this" };
  const patch = { topicRich: TOPIC_A_EDITED, topic: "G1 Alpha EDITED" };
  const conflict = findConflictKey(patch, latest, original);
  assert.equal(conflict, "topicRich", "a genuine external concurrent change must be detected and block the save");
});

test("topicRich — escape hatch: latest already equals the patch we're about to write (another tab already saved the identical value) — no conflict", () => {
  const original = { topicRich: TOPIC_A, topic: "G1 Alpha" };
  const latest = { topicRich: TOPIC_A_EDITED, topic: "G1 Alpha EDITED" }; // someone else already wrote exactly this
  const patch = { topicRich: TOPIC_A_EDITED, topic: "G1 Alpha EDITED" };
  const conflict = findConflictKey(patch, latest, original);
  assert.equal(conflict, null);
});

// ===================================================================================
// COMMON (instructionsRich) path — the fix must not be a topic-only fix
// ===================================================================================

test("instructionsRich — FIRST SAVE: no prior value — no conflict", () => {
  const patch = { instructionsRich: INSTR_A, instructions: "Common task" };
  const conflict = findConflictKey(patch, {}, {});
  assert.equal(conflict, null);
});

test("instructionsRich — SECOND EDIT/SAVE: reordered Firestore representation of the unchanged value — no conflict", () => {
  const original = { instructionsRich: INSTR_A, instructions: "Common task" };
  const latest = { instructionsRich: INSTR_A_REORDERED, instructions: "Common task" };
  const patch = { instructionsRich: INSTR_A_EDITED, instructions: "Common task EDITED" };
  const conflict = findConflictKey(patch, latest, original);
  assert.equal(conflict, null);
});

test("instructionsRich — THIRD case: genuine external concurrent change — BLOCKED", () => {
  const original = { instructionsRich: INSTR_A, instructions: "Common task" };
  const latest = { instructionsRich: TOPIC_EXTERNAL_CHANGE, instructions: "Someone else changed this" };
  const patch = { instructionsRich: INSTR_A_EDITED, instructions: "Common task EDITED" };
  const conflict = findConflictKey(patch, latest, original);
  assert.equal(conflict, "instructionsRich");
});

// ===================================================================================
// Repeated-save simulation (save #1 -> reopen -> save #2 -> reopen -> save #3), pure/no I/O:
// each "reopen" makes latest-from-previous-save the new original, with a fresh key ordering, and
// each save's patch is checked against it — none may falsely conflict.
// ===================================================================================

test("topicRich — three sequential saves, each reopened with a differently key-ordered representation of the prior save's own result — no false conflict on any of them", () => {
  const save1Value = TOPIC_A;
  const save1ReorderedOnReopen = TOPIC_A_REORDERED; // what a fresh getDoc() would hand back before save #2
  let conflict = findConflictKey({ topicRich: save1Value, topic: "G1 Alpha" }, {}, {});
  assert.equal(conflict, null, "save #1");

  const save2Value = TOPIC_A_EDITED;
  // latest (transaction read) = the reordered representation of save #1's own result — same value,
  // different key order, exactly like the real bug.
  conflict = findConflictKey(
    { topicRich: save2Value, topic: "G1 Alpha EDITED" },
    { topicRich: save1ReorderedOnReopen, topic: "G1 Alpha" },
    { topicRich: save1ReorderedOnReopen, topic: "G1 Alpha" }
  );
  assert.equal(conflict, null, "save #2");

  const save3Value = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "G1 Alpha EDITED AGAIN", italic: true, font: "arial" }] }] };
  const save2ReorderedOnReopen = { blocks: [{ runs: [{ font: "arial", italic: true, text: "G1 Alpha EDITED" }], type: "paragraph" }], version: 1 };
  conflict = findConflictKey(
    { topicRich: save3Value, topic: "G1 Alpha EDITED AGAIN" },
    { topicRich: save2ReorderedOnReopen, topic: "G1 Alpha EDITED" },
    { topicRich: save2ReorderedOnReopen, topic: "G1 Alpha EDITED" }
  );
  assert.equal(conflict, null, "save #3");
});

// ===================================================================================
// ITEM 1 / legacy regression — findConflictKey must still work correctly (and still PROTECT, not
// weaken protection) for ordinary non-RichText scalar fields shared with Item 1 / other
// session-editing kinds (sessions: title/description; knowledgeSessions: title/targetSubmissions).
// ===================================================================================

test("legacy scalar fields — strings: no conflict when latest === original (unedited elsewhere)", () => {
  const patch = { title: "New title" };
  const original = { title: "Old title" };
  const latest = { title: "Old title" };
  assert.equal(findConflictKey(patch, latest, original), null);
});

test("legacy scalar fields — strings: a genuine concurrent edit to a legacy field IS detected and blocks the save", () => {
  const patch = { title: "New title (mine)" };
  const original = { title: "Old title" };
  const latest = { title: "Someone else's title" };
  assert.equal(findConflictKey(patch, latest, original), "title");
});

test("legacy scalar fields — numbers (targetSubmissions): unedited elsewhere — no conflict", () => {
  const patch = { targetSubmissions: 500 };
  const original = { targetSubmissions: 300 };
  const latest = { targetSubmissions: 300 };
  assert.equal(findConflictKey(patch, latest, original), null);
});

test("legacy scalar fields — numbers: genuine concurrent edit IS detected", () => {
  const patch = { targetSubmissions: 500 };
  const original = { targetSubmissions: 300 };
  const latest = { targetSubmissions: 999 };
  assert.equal(findConflictKey(patch, latest, original), "targetSubmissions");
});

test("legacy scalar fields — booleans and arrays (ordinary config objects) still detect genuine concurrent changes", () => {
  assert.equal(findConflictKey({ allowPhoto: true }, { allowPhoto: false }, { allowPhoto: true }), "allowPhoto");
  assert.equal(findConflictKey({ tags: ["a", "b"] }, { tags: ["b", "a"] }, { tags: ["a", "b"] }), "tags", "array order is significant for legacy config arrays too");
  assert.equal(findConflictKey({ tags: ["a", "b"] }, { tags: ["a", "b"] }, { tags: ["a", "b"] }), null);
});

test("legacy scalar fields — multiple patch keys: the FIRST conflicting key is reported when several are checked", () => {
  const patch = { title: "New title", description: "New description" };
  const original = { title: "Old title", description: "Old description" };
  const latest = { title: "Concurrently changed title", description: "Old description" };
  assert.equal(findConflictKey(patch, latest, original), "title");
});

test("multiple patch keys — a Rich field and its own plain mirror in the SAME patch: only the field that actually diverged is reported (plain mirror unaffected by key-order noise)", () => {
  const original = { topicRich: TOPIC_A, topic: "G1 Alpha" };
  const latest = { topicRich: TOPIC_A_REORDERED, topic: "G1 Alpha" };
  const patch = { topicRich: TOPIC_A_EDITED, topic: "G1 Alpha EDITED" };
  assert.equal(findConflictKey(patch, latest, original), null);
});
