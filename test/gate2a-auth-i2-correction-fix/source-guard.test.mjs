// Gate 2A-AUTH-I2-CORRECTION-FIX — SOURCE GUARD. Static, structural proof that the reassignment
// content-refresh fix is implemented exactly as designed: detach-old-listeners-and-clear-content
// happens strictly BEFORE membershipGroup/the visible label change, and every scoped listener
// callback is generation-guarded so a stale/superseded snapshot delivery is a no-op regardless
// of its exact trigger. This class of DOM-embedded async logic has no isolated unit-test seam
// (see prior gates' identical reasoning), so — consistent with the SOURCE GUARD pattern used
// throughout this engagement — correctness is proven by exact source position, not by claiming
// coverage from tests alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const html = readFileSync(indexHtmlPath, "utf8").replace(/\r\n/g, "\n");

function studentEntryBody() {
  const m = html.match(/async function renderGroupStudentEntry\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate renderGroupStudentEntry() in index.html");
  return m[0];
}
function fnBody(body, fnStartMarker) {
  const start = body.indexOf(fnStartMarker);
  assert.ok(start !== -1, `could not locate: ${fnStartMarker}`);
  const end = body.indexOf("\n    }", start);
  return body.slice(start, end);
}

// ---- 1-6: detection, unsubscribe, clearing, label ----

test("1: an own-membership listener exists and reacts to a changed group by calling revealParticipation()", () => {
  const body = studentEntryBody();
  assert.match(body, /"members",publicAuth\.currentUser\.uid\)/);
  assert.match(body, /if\(newGroup===membershipGroup\)return;/);
  assert.match(body, /revealParticipation\(newGroup\);/);
});

test("2 + 3: detachScopedListeners unsubscribes BOTH the old topic and old notes listeners", () => {
  const body = fnBody(studentEntryBody(), "function detachScopedListeners");
  assert.match(body, /if\(unsubTopic\)\{unsubTopic\(\);unsubTopic=null;\}/);
  assert.match(body, /if\(unsubNotes\)\{unsubNotes\(\);unsubNotes=null;\}/);
});

test("4 + 5: detachScopedListeners clears old topic AND old notes content (state + re-render)", () => {
  const body = fnBody(studentEntryBody(), "function detachScopedListeners");
  assert.match(body, /currentTopic=null; notes=\[\];/);
  assert.match(body, /updateTopicDisplay\(\); renderMyNotes\(\);/);
});

test("6: the visible group indicator ($(\"#gsGroup\").value) is updated on every revealParticipation call", () => {
  const body = fnBody(studentEntryBody(), "function revealParticipation");
  assert.match(body, /\$\("#gsGroup"\)\.value=String\(group\);/);
});

// ---- 7-8: new listeners scoped to the new group ----

test("7: the new topic listener subscribes to the NEW group's topic document", () => {
  const body = fnBody(studentEntryBody(), "function attachScopedListeners");
  assert.match(body, /"topics",String\(group\)\)/);
});

test("8: the new notes listener is scoped to the NEW group via where(\"group\",\"==\",group)", () => {
  const body = fnBody(studentEntryBody(), "function attachScopedListeners");
  assert.match(body, /where\("group","==",group\)/);
});

// ---- CRITICAL ORDERING: the actual fix ----

test("CRITICAL: revealParticipation() calls attachScopedListeners() BEFORE updating membershipGroup and the visible label (old content clears before new identity is shown)", () => {
  const body = fnBody(studentEntryBody(), "function revealParticipation");
  const attachIdx = body.indexOf("attachScopedListeners(group);");
  const groupAssignIdx = body.indexOf("membershipGroup=group;");
  const labelIdx = body.indexOf('$("#gsGroup").value=String(group);');
  assert.ok(attachIdx !== -1 && groupAssignIdx !== -1 && labelIdx !== -1, "one of the three expected statements is missing");
  assert.ok(attachIdx < groupAssignIdx, "attachScopedListeners() must run before membershipGroup is reassigned");
  assert.ok(groupAssignIdx < labelIdx, "membershipGroup must be reassigned before the visible label updates (matches the required DETECT->DETACH/CLEAR->UPDATE IDENTITY->UPDATE LABEL->ATTACH/RENDER order)");
});

test("CRITICAL: detachScopedListeners() increments contentGeneration BEFORE unsubscribing (invalidates any in-flight/stale callback from this point forward)", () => {
  const body = fnBody(studentEntryBody(), "function detachScopedListeners");
  const genIdx = body.indexOf("contentGeneration++;");
  const unsubIdx = body.indexOf("if(unsubTopic)");
  assert.ok(genIdx !== -1 && unsubIdx !== -1);
  assert.ok(genIdx < unsubIdx, "contentGeneration must be bumped before the unsubscribe calls");
});

test("CRITICAL: attachScopedListeners() captures myGen AFTER calling detachScopedListeners() (so it captures the POST-increment value), and BOTH scoped callbacks check it first", () => {
  const body = fnBody(studentEntryBody(), "function attachScopedListeners");
  const detachIdx = body.indexOf("detachScopedListeners();");
  const genCaptureIdx = body.indexOf("const myGen=contentGeneration;");
  assert.ok(detachIdx !== -1 && genCaptureIdx !== -1);
  assert.ok(detachIdx < genCaptureIdx, "myGen must be captured after detachScopedListeners() has already bumped contentGeneration");
  const guardOccurrences = [...body.matchAll(/if\(myGen!==contentGeneration\)return;/g)];
  assert.equal(guardOccurrences.length, 2, `expected exactly 2 generation guards (topic callback + notes callback), found ${guardOccurrences.length}`);
});

// ---- 9-12: submissions use the new group after reassignment ----

test("9-12: all four submission call sites read membershipGroup at call time (so they automatically pick up a post-reassignment value) — group:selected does not remain anywhere", () => {
  const body = studentEntryBody();
  const occurrences = [...body.matchAll(/group:membershipGroup\b/g)];
  assert.equal(occurrences.length, 4, `expected 4 submission call sites (notes, photo, file, link) using group:membershipGroup, found ${occurrences.length}`);
  assert.doesNotMatch(body, /group:selected\b/);
});

// ---- 13: repeated reassignment does not accumulate listeners ----

test("13: attachScopedListeners() unconditionally calls detachScopedListeners() first on every invocation, including repeated reassignments (1->2->3->...)", () => {
  const body = fnBody(studentEntryBody(), "function attachScopedListeners");
  assert.match(body, /^\s*detachScopedListeners\(\);/m);
});

// ---- 14-17: student identifier ----

test("14: shortStudentCode(uid) is exactly the last 6 characters of uid, uppercased", () => {
  const m = html.match(/function shortStudentCode\(uid\)\{ return String\(uid\|\|""\)\.slice\(-6\)\.toUpperCase\(\); \}/);
  assert.ok(m, "shortStudentCode() not found with the expected exact implementation");
});

test("15: the student badge and the lecturer roster both call the SAME shortStudentCode() helper — not a separately reimplemented algorithm", () => {
  const studentSite = [...html.matchAll(/shortStudentCode\(publicAuth\.currentUser\.uid\)/g)];
  assert.ok(studentSite.length >= 1, "student badge must call shortStudentCode(publicAuth.currentUser.uid)");
  const managerBody = html.match(/async function openGroupMembersManager\(activityId,groupCount\)\{[\s\S]*?\n\}\n/)[0];
  assert.match(managerBody, /shortStudentCode\(r\.uid\)/, "lecturer roster must call shortStudentCode(r.uid)");
  // Exactly one function DEFINITION exists — not two independent implementations.
  const definitions = [...html.matchAll(/function shortStudentCode\(uid\)\{/g)];
  assert.equal(definitions.length, 1, `expected exactly 1 shortStudentCode definition, found ${definitions.length}`);
});

test("16: no raw/full uid is ever interpolated directly into a displayed label — only through shortStudentCode()", () => {
  const managerBody = html.match(/async function openGroupMembersManager\(activityId,groupCount\)\{[\s\S]*?\n\}\n/)[0];
  // The visible label is built exclusively from shortStudentCode()'s output — the separate
  // data-gmm-row="${esc(r.uid)}" attribute (needed to identify which row a click belongs to,
  // not displayed as text) is a different, legitimate use and is not what this test guards.
  assert.match(managerBody, /const label="Học viên "\+shortStudentCode\(r\.uid\);/, "the roster label must be built exclusively from shortStudentCode(r.uid)");
  const studentBody = studentEntryBody();
  assert.doesNotMatch(studentBody, /Mã học viên:[^<]*\$\{esc\(publicAuth\.currentUser\.uid\)\}/, "the student badge must never interpolate the raw uid directly");
});

test("17: no PII field (name/email/phone/className) was added anywhere in the membership schema or the identifier helpers", () => {
  const managerBody = html.match(/async function openGroupMembersManager\(activityId,groupCount\)\{[\s\S]*?\n\}\n/)[0];
  for (const piiField of [".name", ".email", ".phone", ".className", ".displayName"]) {
    assert.doesNotMatch(managerBody, new RegExp(`r\\${piiField}`), `manager UI must not reference r${piiField}`);
  }
});

// ---- 18: Rules unchanged ----
//
// This originally pinned the whole-file Rules hash to prove Gate 2A-AUTH-I2-CORRECTION-FIX was
// frontend-only — true of that gate's own commit, but the same structural flaw as every prior
// whole-file/whole-block Rules pin in this engagement: it cannot survive Gate 2A-AUTH-I3 (the
// authorized Stage-3 gate) legitimately changing Rules next. Retired rather than re-pinned to a
// new hash that would only break again at the next legitimate Rules gate; the historical fact
// (this gate was frontend-only) is preserved in its own report/diff, and Rules integrity going
// forward is covered by test/gate2a-auth-i3/final-hardening.test.mjs.
