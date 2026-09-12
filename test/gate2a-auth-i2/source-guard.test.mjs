// Gate 2A-AUTH-I2 — SOURCE GUARD. Static proof (Task P: "do not claim proof based only on
// tests") that every student-side Group Discussion data path in index.html actually uses the
// authoritative membershipGroup, that the old unfiltered/mutable-selector patterns are gone,
// and that teacher/admin code paths were left untouched. Mirrors the SOURCE GUARD pattern
// established in test/gate-e6/activation-facade.test.mjs and test/gate2as/source-guard.test.mjs.

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

test("SOURCE GUARD: group-membership.mjs is imported by index.html", () => {
  assert.match(html, /import\s*\{\s*validStoredGroup,\s*ensureGroupMembership\s*\}\s*from\s*"\.\/group-membership\.mjs"/);
});

test("SOURCE GUARD: index.html's real facade passed to ensureGroupMembership matches group-membership.mjs's required shape", () => {
  const m = html.match(/const groupMembershipFirestore\s*=\s*\{([^}]*)\}/);
  assert.ok(m, "could not locate the groupMembershipFirestore facade construction");
  const keys = m[1].split(",").map((s) => s.trim());
  for (const required of ["doc", "getDoc", "setDoc", "serverTimestamp"]) {
    assert.ok(keys.includes(required), `groupMembershipFirestore facade is missing '${required}'`);
  }
});

test("SOURCE GUARD: no student-side unfiltered notes collection listener remains (the old fetch-all-then-filter pattern)", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /onSnapshot\(collection\(publicDb,GROUP_COLLECTION,id,"notes"\)/, "a bare, unfiltered onSnapshot(collection(...,\"notes\")) must not remain in the student flow");
});

test("SOURCE GUARD: no student-side unfiltered topics collection listener remains", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /onSnapshot\(collection\(publicDb,GROUP_COLLECTION,id,"topics"\)/, "a bare, unfiltered onSnapshot(collection(...,\"topics\")) must not remain in the student flow");
});

test("SOURCE GUARD: the student notes listener is scoped with where(\"group\",\"==\",...)", () => {
  const body = studentEntryBody();
  assert.match(body, /collection\(publicDb,GROUP_COLLECTION,id,"notes"\),where\("group","==",group\)/);
});

test("SOURCE GUARD: the student topics read uses the deterministic single-document path, not a collection listener", () => {
  const body = studentEntryBody();
  assert.match(body, /doc\(publicDb,GROUP_COLLECTION,id,"topics",String\(group\)\)/);
});

test("SOURCE GUARD: no student submission path still uses the old mutable `selected` variable for the group field", () => {
  const body = studentEntryBody();
  assert.doesNotMatch(body, /group:selected\b/, "every student submission must use group:membershipGroup, never a raw mutable selector value");
  const groupFieldOccurrences = [...body.matchAll(/group:membershipGroup\b/g)];
  assert.equal(groupFieldOccurrences.length, 4, `expected exactly 4 submission call sites (notes, photo, file, link) to use group:membershipGroup, found ${groupFieldOccurrences.length}`);
});

test("SOURCE GUARD: the group <select> is disabled once membership is established (no student-side change-group control)", () => {
  const body = studentEntryBody();
  assert.match(body, /\$\("#gsGroup"\)\.disabled=true/);
});

test("SOURCE GUARD: listeners are attached only inside attachScopedListeners(), called only from revealParticipation() — never before membership is confirmed", () => {
  const body = studentEntryBody();
  const onSnapshotCalls = [...body.matchAll(/onSnapshot\(/g)].length;
  // gsLiveTitle/instructions activity-doc listener (1) + topics doc listener (1) + notes query
  // listener (1) = 3 total onSnapshot calls anywhere in the student flow; the latter two must
  // both live textually inside attachScopedListeners, never earlier in the function body.
  assert.equal(onSnapshotCalls, 3, `expected exactly 3 onSnapshot() calls in the student flow, found ${onSnapshotCalls}`);
  const fnStart = body.indexOf("function attachScopedListeners");
  const fnEnd = body.indexOf("\n    }", fnStart);
  const fnBody = body.slice(fnStart, fnEnd);
  assert.equal((fnBody.match(/onSnapshot\(/g) || []).length, 2, "attachScopedListeners must contain exactly the topics-doc and notes-query listeners");
});

test("SOURCE GUARD: teacher-side groupLive() all-groups subscriptions remain untouched (still broad, unfiltered, unscoped)", () => {
  const m = html.match(/async function groupLive\(c,id,isAdminView\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "could not locate groupLive() in index.html");
  const body = m[0];
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"topics"\)/, "teacher topics listener must remain unfiltered (all groups)");
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"notes"\)/, "teacher notes listener must remain unfiltered (all groups)");
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"photos"\)/, "teacher photos listener must remain unfiltered (all groups)");
  assert.match(body, /onSnapshot\(collection\(db,GROUP_COLLECTION,id,"files"\)/, "teacher files listener must remain unfiltered (all groups)");
});

test("SOURCE GUARD: Gate 2A-S render barrier (groupFileAnchorHtml / safeGroupFileLinkUrl) is untouched, no raw href regression", () => {
  assert.match(html, /import\s*\{\s*safeGroupFileLinkUrl\s*\}\s*from\s*"\.\/group-file-link-safety\.mjs"/);
  assert.match(html, /function groupFileAnchorHtml\(f\)\{/);
  assert.doesNotMatch(html, /href="\$\{esc\(f\.link\)\}"/, "the raw pre-Gate-2A-S href pattern must never reappear");
});
