// GATE P3S-I — source-guard tests for the admin-only staging Teaching UI affordance in
// index.html. index.html is not otherwise unit-tested (a monolithic bundle, no DOM harness in this
// repo) — this mirrors the established source-guard convention already used elsewhere in this
// codebase (test/gate2a-auth-i2/source-guard.test.mjs and siblings) rather than inventing a new one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, "..", "..", "index.html"), "utf8");

function extractBlock(src, startMarker, approxLength = 900) {
  const idx = src.indexOf(startMarker);
  assert.ok(idx > -1, `expected to find ${JSON.stringify(startMarker)} in index.html`);
  return src.slice(idx, idx + approxLength);
}

test("the staging control markup is gated behind isAdminView — never rendered for a normal lecturer", () => {
  const idx = indexHtml.indexOf("knSecondBrainStaging");
  assert.ok(idx > -1, "expected the staging control's id to exist in index.html");
  const before = indexHtml.slice(Math.max(0, idx - 120), idx);
  assert.match(before, /isAdminView\?`/, "the staging block must be inside an isAdminView?`...`:\"\" ternary, not unconditionally rendered");
});

test("the staging control is clearly labeled as staging/test, distinct from the normal TRÌNH CHIẾU SECOND BRAIN button", () => {
  const block = extractBlock(indexHtml, "knSecondBrainStaging");
  assert.match(block, /STAGING/i);
  assert.ok(!block.includes(">TRÌNH CHIẾU SECOND BRAIN<"), "the staging control must not reuse the normal Start button's own label");
  assert.match(block, /knClassroomStagingStart/, "expected a distinct button id, never the normal knClassroomStart id");
});

test("the staging control has its own button id, entirely separate from the normal Start/Close button ids", () => {
  assert.ok(indexHtml.includes("knClassroomStagingStart"));
  assert.ok(indexHtml.includes("knClassroomStagingStatus"));
});

test("onClassroomStagingStartClick uses the existing authenticated getClassroomIdToken — never a separate/duplicated auth path", () => {
  const idx = indexHtml.indexOf("async function onClassroomStagingStartClick");
  assert.ok(idx > -1);
  const block = indexHtml.slice(idx, idx + 900);
  assert.match(block, /getIdToken:getClassroomIdToken/, "must reuse the same injected getClassroomIdToken every other Classroom call uses");
  assert.match(block, /knowledgeSessionId:session\.id/, "must use the current dashboard's own session, never a hardcoded/different one");
});

test("SOURCE GUARD: the staging click handler never logs, alerts, or otherwise surfaces the bootstrap token or Firebase ID token", () => {
  const idx = indexHtml.indexOf("async function onClassroomStagingStartClick");
  assert.ok(idx > -1);
  const block = indexHtml.slice(idx, indexHtml.indexOf("\n  }", idx) + 4);
  assert.ok(!/console\.(log|error|warn|info|debug)/.test(block), "the staging click handler must never console-log anything");
  assert.ok(!block.includes("bootstrapUrl"), "the handler only ever reads result.ok/result.message/result.code — never the raw bootstrapUrl itself");
  assert.ok(!/\.getIdToken\(/.test(block), "the handler never CALLS getIdToken itself and never touches a resolved token value — it only passes getClassroomIdToken through by reference for startStagingProjection to call");
});

test("SOURCE GUARD: startStagingProjection() itself (classroom-projection-launch.mjs) never logs the token, mirroring doStart()'s own discipline", () => {
  const src = readFileSync(path.join(here, "..", "..", "classroom-projection-launch.mjs"), "utf8");
  const idx = src.indexOf("async function doStagingStart");
  assert.ok(idx > -1);
  const block = src.slice(idx, src.indexOf("\n}", idx) + 2);
  assert.ok(!/console\.(log|error|warn|info|debug)/.test(block), "doStagingStart must never console-log anything, including on error");
});

test("the normal (non-staging) Second Brain Start button markup and its click wiring are unchanged by this gate — still exactly knClassroomStart / onClassroomStartClick", () => {
  assert.ok(indexHtml.includes('id="knClassroomStart"'));
  assert.ok(indexHtml.includes("onClassroomStartClick"));
  assert.ok(indexHtml.includes("classroomController.start(session"), "the normal Start flow must still go through classroomController's own state machine, never the staging path");
});
