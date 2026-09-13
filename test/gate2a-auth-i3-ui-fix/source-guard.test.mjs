// Gate 2A-AUTH-I3-UI-FIX — SOURCE GUARD. Static, structural proof for both fixed bugs, following
// the same SOURCE GUARD pattern used throughout this engagement for DOM-embedded logic with no
// isolated unit-test seam (test/gate-e6, test/gate2as, test/gate2a-auth-i2-correction-fix).
//
// BUG A (live reopen): the student activity-status listener in renderGroupStudentEntry() detached
// scoped listeners on OPEN -> CLOSED but had no matching CLOSED -> OPEN branch, so a student whose
// page stayed open through a close/reopen cycle never regained live content until a full reload.
// BUG B (delete leaves members): deleteGroupActivityDeep() deleted topics/notes/photos/files but
// not groupActivities/{id}/members/{uid}, leaving orphaned membership docs after normal deletion.
//
// Firestore behavior for BUG B is proven separately, against a real emulator, in
// test/gate2a-auth-i3-ui-fix/delete-members.test.mjs. This file proves the exact code shape.

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
function fnBody(body, fnStartMarker) {
  const start = body.indexOf(fnStartMarker);
  assert.ok(start !== -1, `could not locate: ${fnStartMarker}`);
  const end = body.indexOf("\n    }", start);
  return body.slice(start, end);
}
function activityStatusListenerBody() {
  const body = studentEntryBody();
  const start = body.indexOf('const unsubA=onSnapshot(doc(publicDb,GROUP_COLLECTION,id),');
  assert.ok(start !== -1, "could not locate the activity-status onSnapshot listener");
  const end = body.indexOf("track(unsubA);");
  assert.ok(end !== -1 && end > start);
  return body.slice(start, end);
}

// ===================================================================================
// BUG A — 1: OPEN initial Group 1 (regression — unchanged initial-mount path)
// ===================================================================================

test("BUG A 1: initial mount still auto-reveals an existing membership's group unchanged", () => {
  const body = studentEntryBody();
  assert.match(body, /if\(membershipGroup\)\{\s*revealParticipation\(membershipGroup\);/);
});

// ===================================================================================
// BUG A — 2: OPEN -> CLOSED teardown (regression — unchanged)
// ===================================================================================

test("BUG A 2: OPEN -> CLOSED still detaches scoped listeners immediately, unchanged", () => {
  const listener = activityStatusListenerBody();
  assert.match(listener, /if\(wasOpen && a\.status!=="open"\)\{\s*wasOpen=false;detachScopedListeners\(\);\s*\}/);
});

// ===================================================================================
// BUG A — 3-8, 10: the new CLOSED -> OPEN branch
// ===================================================================================

test("BUG A 3: a matching CLOSED -> OPEN branch now exists in the same activity-status listener", () => {
  const listener = activityStatusListenerBody();
  assert.match(listener, /\}else if\(!wasOpen && a\.status==="open"\)\{/);
  assert.match(listener, /wasOpen=true;/);
});

test("BUG A 4 + 6 + 10: the reopen branch re-fetches the caller's OWN membership fresh (never trusts the stale in-memory value, never a hardcoded/previous group) — this is what correctly recovers whatever the CURRENT group is, including after a 1->2 reassignment made before close", () => {
  const listener = activityStatusListenerBody();
  const branchStart = listener.indexOf('}else if(!wasOpen && a.status==="open"){');
  const branch = listener.slice(branchStart);
  assert.match(branch, /const freshSnap=await getDoc\(doc\(publicDb,GROUP_COLLECTION,id,"members",publicAuth\.currentUser\.uid\)\);/);
  assert.match(branch, /validStoredGroup\(freshSnap\.data\(\),a\.groupCount\)/);
  assert.doesNotMatch(branch, /revealParticipation\(membershipGroup\)/, "must not reattach using the possibly-stale closure variable instead of the fresh read");
});

test("BUG A 5 + 7: the reopen branch reveals participation only via the existing revealParticipation()/attachScopedListeners() path (no separate/duplicate listener-attach logic introduced)", () => {
  const listener = activityStatusListenerBody();
  const branchStart = listener.indexOf('}else if(!wasOpen && a.status==="open"){');
  const branch = listener.slice(branchStart);
  assert.match(branch, /if\(freshGroup\) revealParticipation\(freshGroup\);/);
  assert.doesNotMatch(branch, /onSnapshot\(doc\(publicDb,GROUP_COLLECTION,id,"topics"/, "must not attach a topic listener directly — must go through attachScopedListeners() via revealParticipation()");
  assert.doesNotMatch(branch, /onSnapshot\(query\(collection\(publicDb,GROUP_COLLECTION,id,"notes"/, "must not attach a notes listener directly — must go through attachScopedListeners() via revealParticipation()");
});

test("BUG A: fail-closed when membership no longer exists on reopen — no authorization is invented client-side", () => {
  const listener = activityStatusListenerBody();
  const branchStart = listener.indexOf('}else if(!wasOpen && a.status==="open"){');
  const branch = listener.slice(branchStart);
  assert.match(branch, /if\(freshSnap\.exists\(\)\)\{/);
  assert.doesNotMatch(branch, /else\s*\{[^}]*revealParticipation/s, "must not reveal participation in any fallback branch when membership does not exist");
});

// ===================================================================================
// BUG A — 7 (again, unconditionally) + 11: attachScopedListeners always detaches first,
// and the membership listener is subscribed at most once — repeated OPEN<->CLOSED cycles
// cannot multiply listeners
// ===================================================================================

test("BUG A 7 + 11: attachScopedListeners() still unconditionally detaches first (unchanged) — reopen calling revealParticipation() again cannot accumulate listeners", () => {
  const body = fnBody(studentEntryBody(), "function attachScopedListeners");
  assert.match(body, /^\s*detachScopedListeners\(\);/m);
});

test("BUG A 11: the membership listener is still subscribed exactly once, guarded by membershipListenerAttached — the new reopen branch never re-tracks it", () => {
  const body = studentEntryBody();
  assert.match(body, /if\(!membershipListenerAttached\)\{/);
  const listener = activityStatusListenerBody();
  const branchStart = listener.indexOf('}else if(!wasOpen && a.status==="open"){');
  const branch = listener.slice(branchStart);
  assert.doesNotMatch(branch, /membershipListenerAttached/, "the reopen branch must not touch the membership-listener guard directly");
  assert.doesNotMatch(branch, /track\(onSnapshot\(doc\(publicDb,GROUP_COLLECTION,id,"members"/, "the reopen branch must not re-subscribe the membership listener itself");
});

// ===================================================================================
// BUG A — 8: no duplicate note rendering (regression — unchanged)
// ===================================================================================

test("BUG A 8: renderMyNotes() still fully replaces rendered notes from the notes array, never appends", () => {
  const body = fnBody(studentEntryBody(), "function renderMyNotes");
  assert.match(body, /\$\("#gsMyNotes"\)\.innerHTML=arr\.length\?/);
  assert.doesNotMatch(body, /\.innerHTML\+=/, "must never append to the rendered notes list");
});

// ===================================================================================
// BUG A — 9: reassignment 1->2 still works (regression — unchanged)
// ===================================================================================

test("BUG A 9: the lecturer-reassignment membership listener (Task E) is untouched by this gate", () => {
  const body = studentEntryBody();
  assert.match(body, /if\(newGroup===membershipGroup\)return;/);
  assert.match(body, /revealParticipation\(newGroup\);/);
});

// ===================================================================================
// BUG A — 12: generation/race protection unchanged
// ===================================================================================

test("BUG A 12: contentGeneration is still bumped on every detach, and both scoped callbacks still check it first (unchanged)", () => {
  const detachBody = fnBody(studentEntryBody(), "function detachScopedListeners");
  assert.match(detachBody, /contentGeneration\+\+;/);
  const attachBody = fnBody(studentEntryBody(), "function attachScopedListeners");
  const guardOccurrences = [...attachBody.matchAll(/if\(myGen!==contentGeneration\)return;/g)];
  assert.equal(guardOccurrences.length, 2, `expected exactly 2 generation guards (topic callback + notes callback), found ${guardOccurrences.length}`);
});

// ===================================================================================
// BUG B — deleteGroupActivityDeep() now includes "members"
// ===================================================================================

function deleteGroupActivityDeepBody() {
  const m = html.match(/async function deleteGroupActivityDeep\(id\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate deleteGroupActivityDeep() in index.html");
  return m[0];
}

test("BUG B: the deep-delete child-collection loop now includes members alongside topics/notes/photos/files", () => {
  const body = deleteGroupActivityDeepBody();
  assert.match(body, /for\(const sub of \["topics","notes","photos","files","members"\]\)\{/);
});

test("BUG B: members is deleted through the SAME existing chunked-batch helper as every other child collection — no new/parallel deletion mechanism introduced", () => {
  const body = deleteGroupActivityDeepBody();
  const loopStart = body.indexOf('for(const sub of ["topics","notes","photos","files","members"]){');
  const loopEnd = body.indexOf("}", loopStart);
  const loop = body.slice(loopStart, loopEnd);
  assert.match(loop, /getDocs\(collection\(db,GROUP_COLLECTION,id,sub\)\)/);
  assert.match(loop, /deleteRefsInChunks\(snap\.docs\.map\(d=>d\.ref\)\)/);
});

test("BUG B: owner/admin authorization check is unchanged, and the parent activity is still deleted only AFTER all child collections (including members) have been processed", () => {
  const body = deleteGroupActivityDeepBody();
  assert.match(body, /if\(!\(STATE\.profile\.role==="admin" \|\| a\.ownerId===STATE\.user\.uid\)\) throw \{code:"permission-denied"\};/);
  const loopEnd = body.lastIndexOf('for(const sub of ["topics","notes","photos","files","members"]){');
  const parentDeleteIdx = body.indexOf("await deleteDoc(aRef);");
  assert.ok(loopEnd !== -1 && parentDeleteIdx !== -1 && parentDeleteIdx > loopEnd, "parent deletion must remain the last step, after the child-collection loop");
});

test("BUG B: the join-code mapping deletion is unchanged", () => {
  const body = deleteGroupActivityDeepBody();
  assert.match(body, /if\(a\.joinCode\) await deleteDoc\(doc\(db,GROUP_JOIN_COLLECTION,a\.joinCode\)\)\.catch\(\(\)=>\{\}\);/);
});
