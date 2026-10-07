// LIBRARY V2 P3-S4 / S4.0 - codeConflictOf (additive P3-S2 model API, Owner decision D2): the single canonical duplicate-code policy the node editor (and P4 imports) must reuse.
// Run: node --test test/library-v2-p3-s4/code-conflict.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../curriculum-model.mjs";

const node = (id, code, extra = {}) => ({ id, kind: "subject", parentId: null, ancestors: [], order: 0, name: "N " + id, code, status: "active", ...extra });

test("returns the conflicting node; blank/null/undefined/non-string candidates never conflict; no conflict -> null", () => {
  const nodes = [node("a", "TOAN"), node("b", null), node("c", "VAN")];
  assert.equal(M.codeConflictOf(nodes, "TOAN").id, "a");
  assert.equal(M.codeConflictOf(nodes, "ANH"), null);
  for (const blank of [null, undefined, "", "   ", 42, {}]) assert.equal(M.codeConflictOf(nodes, blank), null, String(blank));
  assert.equal(M.codeConflictOf([], "TOAN"), null); assert.equal(M.codeConflictOf(null, "TOAN"), null); assert.equal(M.codeConflictOf(undefined, "TOAN"), null);
});
test("canonical equality: case, surrounding whitespace, Unicode normalization (NFC/NFD) and full-width forms all conflict", () => {
  const nfd = "Toán", nfc = "Toán";
  assert.notEqual(nfd, nfc);
  const nodes = [node("a", "toan-1"), node("b", nfc), node("c", "ABC")];
  assert.equal(M.codeConflictOf(nodes, "  TOAN-1\t").id, "a");
  assert.equal(M.codeConflictOf(nodes, "ToAn-1").id, "a");
  assert.equal(M.codeConflictOf(nodes, nfd).id, "b");                                   // NFD candidate vs NFC stored
  assert.equal(M.codeConflictOf([node("x", nfd)], nfc).id, "x");                       // and the other way round
  assert.equal(M.codeConflictOf(nodes, "ＡＢＣ").id, "c");                  // full-width ABC
  assert.equal(M.codeConflictOf(nodes, "ｔｏａｎ－１").id, "a"); // full-width "toan-1"
  assert.equal(M.codeConflictOf(nodes, "TOAN-2"), null);
  assert.equal(M.codeConflictOf(nodes, "TOAN 1"), null, "an inner space is a different code");
});
test("self-exclusion on edit: the node being edited never conflicts with itself, but another node still does", () => {
  const nodes = [node("a", "TOAN"), node("b", "VAN")];
  assert.equal(M.codeConflictOf(nodes, "toan", "a"), null);        // re-saving the same code in another case
  assert.equal(M.codeConflictOf(nodes, "TOAN", "b").id, "a");
  assert.equal(M.codeConflictOf(nodes, "VAN", "a").id, "b");
  assert.equal(M.codeConflictOf(nodes, "TOAN", "does-not-exist").id, "a", "an unknown exceptId excludes nothing");
});
test("retired nodes still reserve their codes (D3: reserved until edited)", () => {
  const nodes = [node("a", "TOAN", { status: "retired" }), node("b", "VAN")];
  assert.equal(M.codeConflictOf(nodes, "toan").id, "a");
  assert.equal(M.codeConflictOf(nodes, "toan", "a"), null);
});
test("conflicts are found across kinds, parents and depth (the policy is framework-wide); the FIRST node in array order is reported", () => {
  const nodes = [node("s", "S1"), node("u", "U1", { kind: "unit", parentId: "s", ancestors: ["s"], order: 0 }), node("l", "L1", { kind: "lesson", parentId: "u", ancestors: ["s", "u"] }), node("l2", "l1", { kind: "lesson", parentId: "u", ancestors: ["s", "u"], order: 1 })];
  assert.equal(M.codeConflictOf(nodes, "l1").id, "l", "first in array order (validateTree reports the second as the duplicate)");
  assert.equal(M.codeConflictOf(nodes, "U1").id, "u"); assert.equal(M.codeConflictOf(nodes, "s1").id, "s");
});
test("tolerates malformed entries and non-string stored codes without throwing", () => {
  const nodes = [null, undefined, { id: "x" }, node("y", 7), node("z", "OK")];
  assert.equal(M.codeConflictOf(nodes, "ok").id, "z");
  assert.equal(M.codeConflictOf(nodes, "7"), null);
});
test("codeInUse is exactly the boolean form of codeConflictOf (same answers on a corpus incl. exceptId), and is consistent with validateTree DUPLICATE_CODE", () => {
  const corpus = ["a", "A", " a ", "ａ", "Á", "Á", "b", "", null, "a b", "TOAN", "toan"];
  const nodes = [node("1", "a"), node("2", "b", { order: 1 }), node("3", "Á", { order: 2, status: "retired" }), node("4", null, { order: 3 })];
  for (const code of corpus) for (const except of [undefined, "1", "2", "3", "4", "zz"]) {
    assert.equal(M.codeInUse(nodes, code, except), M.codeConflictOf(nodes, code, except) !== null, JSON.stringify([code, except]));
  }
  // anything codeConflictOf calls a conflict, validateTree must also flag when it is saved; anything it allows must not be flagged
  for (const code of corpus) {
    const conflict = M.codeConflictOf(nodes, code);
    const candidate = node("new", code, { order: 9 });
    const dup = M.validateTree([...nodes, candidate]).issues.filter((i) => i.code === "DUPLICATE_CODE");
    assert.equal(dup.length > 0, conflict !== null, "code " + JSON.stringify(code));
    if (conflict) assert.ok(dup[0].message.includes(conflict.id), "validateTree names the same original node");
  }
});
test("no other change to the P3-S2 model surface: the export list is the frozen one plus codeConflictOf", () => {
  const exported = Object.keys(M).sort();
  assert.ok(exported.includes("codeConflictOf") && exported.includes("codeInUse") && exported.includes("canonicalizeNodeCode"));
  assert.equal(typeof M.codeConflictOf, "function"); assert.equal(M.codeConflictOf.length, 3);
});
