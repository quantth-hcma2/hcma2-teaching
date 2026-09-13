// GATE 2B-RT-FIX1 — pure unit tests for valuesEqualDeep, imported directly from the real production
// module (session-info-compare.mjs) so this suite can never silently test a copy that has drifted
// from what index.html actually runs.
import test from "node:test";
import assert from "node:assert/strict";
import { valuesEqualDeep } from "../../session-info-compare.mjs";

// ===================================================================================
// The exact production-bug regression fixture (GATE 2B-RT-FIX1 spec, "MOST IMPORTANT REGRESSION
// TEST"): two RichText values that are semantically identical but differ in object key order at
// every level — TOP level, BLOCK level, and RUN level — reproducing exactly what was observed in
// production (a transaction's tx.get() vs. a plain getDoc() returning the same stored document
// with different Firestore-internal field ordering).
// ===================================================================================

const RICH_A = {
  version: 1,
  blocks: [{
    type: "paragraph",
    runs: [{
      text: "G1 Alpha",
      italic: true,
      font: "arial"
    }]
  }]
};

const RICH_B_REORDERED = {
  blocks: [{
    runs: [{
      font: "arial",
      italic: true,
      text: "G1 Alpha"
    }],
    type: "paragraph"
  }],
  version: 1
};

test("1: TOP-level key order differs (version/blocks swapped) — must be equal", () => {
  assert.equal(valuesEqualDeep({ version: 1, blocks: [] }, { blocks: [], version: 1 }), true);
});

test("2: full production fixture — top+block+run key order all differ simultaneously — must be equal", () => {
  assert.equal(valuesEqualDeep(RICH_A, RICH_B_REORDERED), true);
  assert.equal(valuesEqualDeep(RICH_B_REORDERED, RICH_A), true, "must be symmetric");
});

test("3: BLOCK-level key order differs in isolation (type/runs swapped, run order/content identical) — must be equal", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X" }] }] };
  const b = { version: 1, blocks: [{ runs: [{ text: "X" }], type: "paragraph" }] };
  assert.equal(valuesEqualDeep(a, b), true);
});

test("4: RUN-level key order differs in isolation (text/italic/font permuted) — must be equal", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X", italic: true, font: "arial" }] }] };
  const b = { version: 1, blocks: [{ type: "paragraph", runs: [{ font: "arial", italic: true, text: "X" }] }] };
  assert.equal(valuesEqualDeep(a, b), true);
});

// ===================================================================================
// Genuine semantic changes — each MUST be detected as unequal (mutate ONE thing at a time from the
// production fixture, per the FIX1 spec)
// ===================================================================================

test("5: genuine change — text differs — must be unequal", () => {
  const b = structuredClone(RICH_A); b.blocks[0].runs[0].text = "G1 Beta";
  assert.equal(valuesEqualDeep(RICH_A, b), false);
});

test("6: genuine change — italic differs — must be unequal", () => {
  const b = structuredClone(RICH_A); b.blocks[0].runs[0].italic = false;
  assert.equal(valuesEqualDeep(RICH_A, b), false);
});

test("7: genuine change — font differs — must be unequal", () => {
  const b = structuredClone(RICH_A); b.blocks[0].runs[0].font = "times";
  assert.equal(valuesEqualDeep(RICH_A, b), false);
});

test("8: genuine change — size added/differs — must be unequal", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X", size: 16 }] }] };
  const b = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X", size: 20 }] }] };
  assert.equal(valuesEqualDeep(a, b), false);
});

test("9: genuine change — color differs — must be unequal", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X", color: "red" }] }] };
  const b = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X", color: "blue" }] }] };
  assert.equal(valuesEqualDeep(a, b), false);
});

test("10: genuine change — block count differs — must be unequal", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X" }] }] };
  const b = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X" }] }, { type: "paragraph", runs: [{ text: "Y" }] }] };
  assert.equal(valuesEqualDeep(a, b), false);
});

test("11: genuine change — run order swapped within a block — must be unequal (array order is significant)", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "A" }, { text: "B" }] }] };
  const b = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "B" }, { text: "A" }] }] };
  assert.equal(valuesEqualDeep(a, b), false);
});

// ===================================================================================
// Required minimum behavior — primitives, arrays, plain objects (spec's own examples verbatim)
// ===================================================================================

test("12: {a:1,b:2} equals {b:2,a:1} — key order irrelevant for plain objects", () => {
  assert.equal(valuesEqualDeep({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});

test("13: {text:'ABC'} does not equal {text:'ABD'}", () => {
  assert.equal(valuesEqualDeep({ text: "ABC" }, { text: "ABD" }), false);
});

test("14: [1,2] does not equal [2,1] — array order matters", () => {
  assert.equal(valuesEqualDeep([1, 2], [2, 1]), false);
});

test("15: [1,2] equals [1,2]", () => {
  assert.equal(valuesEqualDeep([1, 2], [1, 2]), true);
});

test("16: {bold:true} does not equal {bold:false}", () => {
  assert.equal(valuesEqualDeep({ bold: true }, { bold: false }), false);
});

test("17: {a:1} does not equal {a:'1'} — type matters, not just loose value", () => {
  assert.equal(valuesEqualDeep({ a: 1 }, { a: "1" }), false);
});

test("18: nested object key order irrelevant at arbitrary depth", () => {
  const a = { x: { y: { z: 1, w: 2 }, k: 3 } };
  const b = { x: { k: 3, y: { w: 2, z: 1 } } };
  assert.equal(valuesEqualDeep(a, b), true);
});

test("19: different own-key SETS are unequal even with overlapping values", () => {
  assert.equal(valuesEqualDeep({ a: 1, b: 2 }, { a: 1, c: 2 }), false);
  assert.equal(valuesEqualDeep({ a: 1 }, { a: 1, b: 2 }), false, "extra key on one side must be unequal");
});

test("20: array vs. plain object with the same 'shape' are unequal", () => {
  assert.equal(valuesEqualDeep([1, 2], { 0: 1, 1: 2 }), false);
});

// ===================================================================================
// Primitives / type semantics
// ===================================================================================

test("21: primitive equality — identical strings/numbers/booleans", () => {
  assert.equal(valuesEqualDeep("abc", "abc"), true);
  assert.equal(valuesEqualDeep(42, 42), true);
  assert.equal(valuesEqualDeep(true, true), true);
});

test("22: primitive inequality — different strings/numbers/booleans", () => {
  assert.equal(valuesEqualDeep("abc", "abd"), false);
  assert.equal(valuesEqualDeep(42, 43), false);
  assert.equal(valuesEqualDeep(true, false), false);
});

test("23: null handled correctly — null===null equal, null vs anything else unequal", () => {
  assert.equal(valuesEqualDeep(null, null), true);
  assert.equal(valuesEqualDeep(null, undefined), false, "null and undefined are distinct values");
  assert.equal(valuesEqualDeep(null, 0), false);
  assert.equal(valuesEqualDeep(null, {}), false);
  assert.equal(valuesEqualDeep(null, ""), false);
});

test("24: undefined handled correctly — undefined===undefined equal (this is the realistic 'field never set' case for a brand-new Rich field)", () => {
  assert.equal(valuesEqualDeep(undefined, undefined), true);
  assert.equal(valuesEqualDeep(undefined, {}), false);
});

// ===================================================================================
// Special values (GATE 2B-RT-FIX1 spec: audit-driven, explicit support only)
// ===================================================================================

test("25: NaN is treated as equal to NaN (same-value semantics), unlike ===", () => {
  assert.equal(valuesEqualDeep(NaN, NaN), true);
  assert.equal(valuesEqualDeep(NaN, 0), false);
  assert.equal(valuesEqualDeep(NaN, 5), false);
});

test("26: non-plain object instances (e.g. Date) are never given invented equality semantics — same reference only", () => {
  const d1 = new Date(2026, 0, 1);
  const d2 = new Date(2026, 0, 1); // same moment, different instance
  assert.equal(valuesEqualDeep(d1, d1), true, "identical reference is trivially equal via a===b");
  assert.equal(valuesEqualDeep(d1, d2), false, "two different Date instances must NOT be silently treated as equal");
});

test("27: a class instance is never recursively treated as a plain map, even with identical own-enumerable data", () => {
  class Box { constructor(v) { this.v = v; } }
  const a = new Box(1), b = new Box(1);
  assert.equal(valuesEqualDeep(a, b), false, "must fail closed — same reference only, not structural equality for non-plain prototypes");
  assert.equal(valuesEqualDeep(a, { v: 1 }), false, "a class instance and a plain object are never equal even with the same data");
});

test("28: Object.create(null) objects (no prototype) are still treated as plain and compared by key", () => {
  const a = Object.create(null); a.x = 1;
  const b = Object.create(null); b.x = 1;
  assert.equal(valuesEqualDeep(a, b), true);
});

// ===================================================================================
// Robustness / security
// ===================================================================================

test("29: does not mutate either input", () => {
  const a = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "X" }] }] };
  const b = structuredClone(a);
  const aBefore = JSON.stringify(a), bBefore = JSON.stringify(b);
  valuesEqualDeep(a, b);
  assert.equal(JSON.stringify(a), aBefore);
  assert.equal(JSON.stringify(b), bBefore);
});

test("30: prototype-polluting-looking keys are handled via own-property checks, not treated as inherited", () => {
  const a = { __proto__: null, toString: "not a function here", value: 1 };
  const b = { value: 1, toString: "not a function here" };
  assert.equal(valuesEqualDeep(a, b), true, "own enumerable 'toString' key compares like any other own key");
  const c = { value: 1 }; // relies on inherited Object.prototype.toString, has no OWN toString key
  assert.equal(valuesEqualDeep(a, c), false, "an own key present on one side and absent on the other must be unequal, even if the other side could resolve it via the prototype chain");
});
