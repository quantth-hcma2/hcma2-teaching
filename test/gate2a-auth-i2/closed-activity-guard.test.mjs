// Gate 2A-AUTH-I2-FIX — SOURCE GUARD. Static, structural proof that a non-open activity's
// student flow can never reach membership bootstrap, never attach a notes/topics listener, and
// never reveal submission UI — regardless of whether the caller already has a membership
// record. This is proven by POSITION (the status gate's `return` must appear before every one
// of those call sites in the function source), not merely by their presence, per the gate's own
// "do not claim proof based only on tests" discipline (mirrors test/gate2a-auth-i2/source-
// guard.test.mjs and test/gate-e6/activation-facade.test.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const html = readFileSync(indexHtmlPath, "utf8").replace(/\r\n/g, "\n");

function studentEntryBody() {
  const m = html.match(/async function renderGroupStudentEntry\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate renderGroupStudentEntry() in index.html");
  return m[0];
}

function closedBranch(body) {
  const m = body.match(/if\(a\.status!==["']open["']\)\{[\s\S]*?\n\s*return;\n\s*\}/);
  assert.ok(m, "could not locate the status!=='open' guard branch");
  return m[0];
}

test("ORDERING: the status gate's return precedes membership getDoc, ensureGroupMembership, and both scoped listener attach points", () => {
  const body = studentEntryBody();
  const gateIdx = body.indexOf('if(a.status!=="open"){');
  assert.ok(gateIdx !== -1, "status gate not found");
  const membershipGetIdx = body.indexOf('getDoc(doc(publicDb,GROUP_COLLECTION,id,"members"');
  const ensureCallIdx = body.indexOf("ensureGroupMembership(");
  const attachFnIdx = body.indexOf("function attachScopedListeners");
  for (const [label, idx] of [["membership getDoc", membershipGetIdx], ["ensureGroupMembership call", ensureCallIdx], ["attachScopedListeners definition", attachFnIdx]]) {
    assert.ok(idx !== -1, `${label} not found`);
    assert.ok(gateIdx < idx, `status gate (index ${gateIdx}) must precede ${label} (index ${idx})`);
  }
});

test("CLOSED (2/9): ensureGroupMembership is unreachable for a non-open activity (gate returns before any call site)", () => {
  const body = studentEntryBody();
  const gateEnd = body.indexOf("return;", body.indexOf('if(a.status!=="open"){')) + "return;".length;
  const afterGate = body.slice(gateEnd);
  // The only ensureGroupMembership call site must be textually after the gate's return —
  // confirmed here by checking the call does NOT appear in the slice BEFORE the gate.
  assert.equal(body.slice(0, gateEnd).includes("ensureGroupMembership("), false);
  assert.ok(afterGate.includes("ensureGroupMembership("), "the call site should still exist, just after the gate");
});

test("CLOSED (3/9 + 4/9): neither the notes query listener nor the topics document listener can attach for a non-open activity", () => {
  const body = studentEntryBody();
  const branch = closedBranch(body);
  assert.doesNotMatch(branch, /onSnapshot/, "the closed/not-open branch itself must never call onSnapshot");
  const gateEnd = body.indexOf("return;", body.indexOf('if(a.status!=="open"){')) + "return;".length;
  assert.equal(body.slice(0, gateEnd).includes('where("group","=="'), false, "the scoped notes query must not appear before the gate");
  assert.equal(body.slice(0, gateEnd).includes('"topics",String(group)'), false, "the scoped topics doc listener must not appear before the gate");
});

test("CLOSED (5/9): no submission UI (gsSubmitCard/gsGroup/gsText/gsSendText etc.) is ever rendered in the closed/not-open branch", () => {
  const body = studentEntryBody();
  const branch = closedBranch(body);
  for (const id of ["gsSubmitCard", "gsGroup", "gsText", "gsSendText", "gsSendPhoto", "gsSendFile", "gsSendLink", "gsMyNotes"]) {
    assert.doesNotMatch(branch, new RegExp(id), `${id} must not appear in the closed/not-open render branch`);
  }
});

test("CLOSED (6/9): the Vietnamese closed/not-open message is shown, reusing the app's own existing wording", () => {
  const body = studentEntryBody();
  const branch = closedBranch(body);
  assert.match(branch, /Phòng đã đóng\./);
  assert.match(branch, /Phòng chưa mở\./);
});

test("CLOSED (7/9): an existing membership record cannot bypass the status gate — the membership check is strictly unreachable code when the gate returns", () => {
  const body = studentEntryBody();
  const gateIdx = body.indexOf('if(a.status!=="open"){');
  const existingMemberCheckIdx = body.indexOf("existingMemberSnap");
  assert.ok(gateIdx < existingMemberCheckIdx, "the existing-membership read must come after the status gate, so a returning student with valid membership still cannot pass a non-open activity");
});

test("OPEN (1/9): when status IS open, the gate does not return early and the normal membership/listener flow is reachable", () => {
  const body = studentEntryBody();
  // Structural check: the gate is a single `if` with no `else` reaching past it — meaning
  // control falls through to the membership/listener code whenever the condition is false
  // (status === "open"), unconditionally. Confirmed by the ordering test above (item 4/9) that
  // the fall-through code exists and follows immediately.
  const gateBlock = body.match(/if\(a\.status!==["']open["']\)\{[\s\S]*?\n\s*return;\n\s*\}\n\n([\s\S]{0,600})/);
  assert.ok(gateBlock, "could not confirm fall-through code immediately follows the gate");
  assert.match(gateBlock[1], /existingMemberSnap/, "the membership flow must be the very next statement after the gate for the open case");
});

test("TEACHER (8/9): groupLive() all-group listeners remain unchanged by this fix", () => {
  const m = html.match(/async function groupLive\(c,id,isAdminView\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate groupLive() in index.html");
  const body = m[0];
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"topics"\)/);
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"notes"\)/);
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"photos"\)/);
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"files"\)/);
});
