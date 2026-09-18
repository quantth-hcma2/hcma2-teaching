// GATE 5F.C — SOURCE GUARD. Static proof (per this repo's established pattern, e.g.
// test/gate2a-auth-i2/source-guard.test.mjs) that the Knowledge dashboard integration was wired
// correctly, the old V1 link is no longer the primary action, AI Analyze's CLOSED-only rule is
// untouched, and the diff against the accepted baseline touches only the files this gate was
// scoped to.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const indexHtmlPath = path.join(repoRoot, "index.html");
const html = readFileSync(indexHtmlPath, "utf8").replace(/\r\n/g, "\n");

const BASELINE_COMMIT = "a744b84a6831e91a9afb061c34667366a919bbf7"; // accepted Gate 5F.A/5F.B Teaching baseline

test("SOURCE GUARD: classroom-projection-launch.mjs is imported by index.html", () => {
  assert.match(html, /import\s*\{\s*canLaunchClassroomProjection,\s*createClassroomLaunchController\s*\}\s*from\s*"\.\/classroom-projection-launch\.mjs"/);
});

test("SOURCE GUARD: the old V1 static link (brain.quantth.vn/knowledge-wall.html) is no longer the primary Second Brain action", () => {
  assert.doesNotMatch(html, /brain\.quantth\.vn\/knowledge-wall\.html/, "the V1 link must no longer appear in index.html at all — it was the PRIMARY action and nothing replaced it with a second button");
});

test("SOURCE GUARD: no second, alternate Second Brain button was invented alongside the new one (single primary action only)", () => {
  const matches = html.match(/id="knClassroomStart"|id="knSecondBrain\w*"/g) || [];
  // knSecondBrainCard + knSecondBrainAction (container ids) + knClassroomStart (the button itself,
  // rendered into that container) — no additional button id in this family.
  const distinctIds = new Set(matches);
  assert.ok(distinctIds.size <= 3, `expected at most the card/action container + one Start button id, found: ${[...distinctIds].join(", ")}`);
});

test("SOURCE GUARD: the Second Brain card is gated by canLaunchClassroomProjection() at render time", () => {
  assert.match(html, /canLaunchClassroomProjection\(\{session,isAdminView,actorUid:STATE\.user\.uid\}\)/);
});

test("SOURCE GUARD: the Classroom origin is never hardcoded again in index.html (single source of truth stays in classroom-projection-launch.mjs)", () => {
  assert.doesNotMatch(html, /classroom\.quantth\.vn/, "index.html must not hardcode the Classroom origin — it must come from classroom-projection-launch.mjs's CLASSROOM_ORIGIN");
  assert.doesNotMatch(html, /classroom\.invalid/);
});

test("SOURCE GUARD: onClassroomStartClick is NOT declared async — window.open() must stay in the synchronous click call stack", () => {
  const m = html.match(/function onClassroomStartClick\(\)\{[\s\S]*?\n  \}/);
  assert.ok(m, "could not locate onClassroomStartClick() in index.html");
  assert.doesNotMatch(html, /async function onClassroomStartClick/, "onClassroomStartClick must remain a plain (non-async) function");
});

test("SOURCE GUARD: AI Analyze's CLOSED-only rule is byte-for-byte unchanged", () => {
  assert.match(html, /if\(session\.status!=="closed"\)\{toast\("Hãy đóng phiên trước khi phân tích AI\.","warn"\);b\.disabled=false;return;\}/, "knowledgeStartAi's CLOSED-only gate must not be touched by this gate");
});

test("SOURCE GUARD: the Second Brain action area itself carries no session.status check (CLOSED sessions remain launchable)", () => {
  const m = html.match(/function renderSecondBrainAction\(\)\{[\s\S]*?\n  \}/);
  assert.ok(m, "could not locate renderSecondBrainAction() in index.html");
  assert.doesNotMatch(m[0], /session\.status/, "renderSecondBrainAction must not gate on session.status — Gate 5F.C Part F explicitly allows both OPEN and CLOSED");
});

test("SOURCE GUARD: no localStorage/sessionStorage token persistence introduced by this gate's index.html changes", () => {
  const startIdx = html.indexOf("function renderSecondBrainAction(){");
  const endIdx = html.indexOf("async function aiGateway(path,body){");
  assert.ok(startIdx > -1 && endIdx > startIdx, "could not locate the Gate 5F.C-authored render/handler region of index.html");
  const region = html.slice(startIdx, endIdx);
  assert.ok(!region.includes("localStorage"));
  assert.ok(!region.includes("sessionStorage"));
});

test("SCOPE LOCK: the diff against the accepted Teaching baseline touches only the expected files", () => {
  const changed = execSync("git diff --name-only " + BASELINE_COMMIT, { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const untrackedNew = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3).trim());
  const allTouched = new Set([...changed, ...untrackedNew.filter((p) => !p.endsWith("/"))]);
  const allowedFiles = new Set(["index.html", "classroom-projection-launch.mjs"]);
  const allowedPrefixes = ["test/gate5f-c/"];
  for (const file of allTouched) {
    const allowed = allowedFiles.has(file) || allowedPrefixes.some((p) => file.startsWith(p));
    assert.ok(allowed, `unexpected file changed outside Gate 5F.C's scope: ${file}`);
  }
  assert.ok(allTouched.has("index.html"), "sanity: index.html must actually have changed");
  assert.ok(allTouched.has("classroom-projection-launch.mjs"), "sanity: the new module must actually be present");
});

test("SCOPE LOCK: Firestore Rules and indexes files are untouched by this gate", () => {
  const changed = execSync("git diff --name-only " + BASELINE_COMMIT, { cwd: repoRoot, encoding: "utf8" }).split("\n");
  for (const forbidden of ["firestore.rules", "firestore.rules.production-candidate", "firestore.indexes.json"]) {
    assert.ok(!changed.includes(forbidden), `${forbidden} must not be modified by this gate`);
  }
});
