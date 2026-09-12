// Gate 2A-AUTH-I2-CORRECTION — SOURCE GUARD. Static proof for everything the emulator can't
// exercise directly (client-side DOM wiring, listener lifecycle) and for Task J's 9 required
// checks. Mirrors the SOURCE GUARD pattern established across every prior gate in this
// engagement (test/gate-e6, test/gate2as, test/gate2a-auth-i2).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(here, "..", "..", "index.html");
const html = readFileSync(indexHtmlPath, "utf8").replace(/\r\n/g, "\n");

function studentEntryBody() {
  const m = html.match(/async function renderGroupStudentEntry\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate renderGroupStudentEntry() in index.html");
  return m[0];
}
function managerBody() {
  const m = html.match(/async function openGroupMembersManager\(activityId,groupCount\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate openGroupMembersManager() in index.html");
  return m[0];
}

// ---- Task J (1-9) ----

test("J1: student still cannot invoke a membership UPDATE path anywhere in the student flow", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /updateDoc\(doc\(publicDb,GROUP_COLLECTION,id,"members"/, "no updateDoc call against members may exist in the student-facing flow");
});

test("J2: the student has no group-change UI control — the only place the selector is ever re-enabled is the pre-membership join-failure retry path", () => {
  const body = studentEntryBody();
  assert.match(body, /\$\("#gsGroup"\)\.disabled=true/);
  const reenableSites = [...body.matchAll(/\$\("#gsGroup"\)\.disabled=false/g)];
  assert.equal(reenableSites.length, 1, `expected exactly 1 site re-enabling the selector (the join-failure catch block), found ${reenableSites.length}`);
  const idx = reenableSites[0].index;
  const surrounding = body.slice(Math.max(0, idx - 200), idx);
  assert.match(surrounding, /catch\(e\)\{/, "the sole re-enable site must be inside the join-attempt's catch block, not reachable once membership exists");
});

test("J3: the lecturer correction path (openGroupMembersManager) is only wired from groupLive(), never from the student flow", () => {
  assert.doesNotMatch(studentEntryBody(), /openGroupMembersManager/, "the student flow must never reference the lecturer correction UI");
  const m = html.match(/async function groupLive\(c,id,isAdminView\)\{[\s\S]*?\n\}\n/);
  assert.ok(m);
  assert.match(m[0], /\$\("#gManageMembers"\)\.onclick=\(\)=>openGroupMembersManager\(/);
});

test("J4: no broad student members query exists (student flow only ever gets its own doc, never a collection/list)", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /collection\(publicDb,GROUP_COLLECTION,id,"members"\)/, "the student flow must never query the members collection, only getDoc/onSnapshot a single known doc");
  assert.doesNotMatch(body, /getDocs\(.*"members"/);
});

test("J5: no broad student notes/topics query returns — the scoped where()/single-doc pattern from I2 remains intact", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /onSnapshot\(collection\(publicDb,GROUP_COLLECTION,id,"notes"\)/);
  assert.doesNotMatch(body, /onSnapshot\(collection\(publicDb,GROUP_COLLECTION,id,"topics"\)/);
  assert.match(body, /where\("group","==",group\)/);
  assert.match(body, /"topics",String\(group\)\)/);
});

test("J6: all four student submission call sites still use the authoritative membershipGroup variable", () => {
  const body = studentEntryBody();
  const occurrences = [...body.matchAll(/group:membershipGroup\b/g)];
  assert.equal(occurrences.length, 4, `expected 4 submission call sites using group:membershipGroup, found ${occurrences.length}`);
});

test("J7: old group listeners are unsubscribed before new ones attach on reassignment (detach-then-attach, not additive)", () => {
  const body = studentEntryBody();
  const fnStart = body.indexOf("function attachScopedListeners");
  const fnEnd = body.indexOf("\n    }", fnStart);
  const fnBody = body.slice(fnStart, fnEnd);
  assert.match(fnBody, /^\s*detachScopedListeners\(\);/m, "attachScopedListeners must call detachScopedListeners() as its first statement");
  const detachStart = body.indexOf("function detachScopedListeners");
  const detachEnd = body.indexOf("\n    }", detachStart);
  const detachBody = body.slice(detachStart, detachEnd);
  assert.match(detachBody, /unsubTopic\(\)/);
  assert.match(detachBody, /unsubNotes\(\)/);
});

test("J8: no PII field was added to the membership create/update allowlists in Rules", () => {
  const rules = readFileSync(path.join(here, "..", "..", "firestore.rules.production-candidate"), "utf8").replace(/\r\n/g, "\n");
  const startIdx = rules.indexOf("match /members/{uid} {");
  const endIdx = rules.indexOf("// Mã tham gia phòng nhóm");
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, "could not locate the members{} block bounds in Rules");
  const block = rules.slice(startIdx, endIdx);
  assert.match(block, /hasOnly\(\['group', 'joinedAt', 'joinCode'\]\)/, "the create allowlist must remain exactly group/joinedAt/joinCode — no PII field added");
  assert.match(block, /hasOnly\(\['group'\]\)/, "the update allowlist must remain exactly group only");
});

test("J9: topics/notes/photos/files Rules were NOT Stage-3-tightened in this gate — only the members{} block changed", () => {
  const repoRoot = path.join(here, "..", "..");
  const BASELINE_COMMIT = "289183dee639e8a847d0dc010945687fb958af81"; // AUTH-I2 production HEAD
  const baseline = execSync(`git show ${BASELINE_COMMIT}:firestore.rules.production-candidate`, { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");
  const candidate = readFileSync(path.join(here, "..", "..", "firestore.rules.production-candidate"), "utf8").replace(/\r\n/g, "\n");
  for (const collectionName of ["topics", "notes", "photos", "files"]) {
    const pattern = new RegExp(`match /${collectionName}/\\{[a-zA-Z]+\\} \\{[\\s\\S]*?\\n {6}\\}`);
    const baselineBlock = baseline.match(pattern);
    const candidateBlock = candidate.match(pattern);
    assert.ok(baselineBlock && candidateBlock, `could not locate ${collectionName}{} block in one of the two files`);
    assert.equal(candidateBlock[0], baselineBlock[0], `${collectionName}{} Rules block must be byte-identical to the AUTH-I2 production baseline — this gate must not touch Stage-3 read/write policy`);
  }
});

// ---- Task E/F structural proofs (student live reassignment) ----

test("Student membership listener exists, is guarded to attach exactly once, and reacts by calling revealParticipation()", () => {
  const body = studentEntryBody();
  assert.match(body, /membershipListenerAttached/);
  assert.match(body, /if\(!membershipListenerAttached\)\{/);
  const listenerBlock = body.slice(body.indexOf("if(!membershipListenerAttached)"), body.indexOf("if(!membershipListenerAttached)") + 700);
  assert.match(listenerBlock, /"members",publicAuth\.currentUser\.uid/);
  assert.match(listenerBlock, /validStoredGroup\(s\.data\(\),a\.groupCount\)/);
  assert.match(listenerBlock, /revealParticipation\(newGroup\)/);
});

test("Manager UI writes with updateDoc (narrow field-only update), never setDoc/full rewrite", () => {
  const body = managerBody();
  assert.match(body, /updateDoc\(doc\(db,GROUP_COLLECTION,activityId,"members",uid\),\{group:newGroup\}\)/);
  assert.doesNotMatch(body, /setDoc\(doc\(db,GROUP_COLLECTION,activityId,"members"/, "the correction UI must never setDoc/rewrite the whole membership document");
});

test("Manager UI confirms before writing and shows Vietnamese success/error feedback", () => {
  const body = managerBody();
  assert.match(body, /confirm\(`Chuyển học viên từ Nhóm \$\{rec\.group\} sang Nhóm \$\{newGroup\}\?`\)/);
  assert.match(body, /toast\("Đã chuyển nhóm học viên\."/);
});

test("Manager UI displays no PII — label is derived only from the opaque uid, no name/email/profile field referenced", () => {
  const body = managerBody();
  // GATE 2A-AUTH-I2-CORRECTION-FIX realigned this: the label now uses the shared
  // shortStudentCode() helper (last 6 uid chars, uppercase) instead of a locally-inlined
  // 4-char slice, so the SAME identifier appears on both the student screen and this roster
  // (see test/gate2a-auth-i2-correction-fix/source-guard.test.mjs for the full proof). Still
  // derived only from the opaque uid — no PII, no change to that underlying guarantee.
  assert.match(body, /"Học viên "\+shortStudentCode\(r\.uid\)/);
  for (const piiField of [".name", ".email", ".phone", ".className", ".displayName"]) {
    assert.doesNotMatch(body, new RegExp(`r\\${piiField}`), `manager UI must not reference r${piiField}`);
  }
});
