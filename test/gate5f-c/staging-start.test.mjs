// GATE P3S-I — deterministic tests for the staging-only Start affordance in
// classroom-projection-launch.mjs. No browser, no real Firebase, no live Classroom service. Every
// external effect (window.open, fetch, getIdToken) is a plain injected fake, mirroring
// classroom-launch.test.mjs's own conventions. Never touches the protected production session
// (9dv8xHfIDmORIOszpylH / 3ZQ7YU) — every fixture below is synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSROOM_ORIGIN,
  STAGING_API_ORIGIN,
  buildStagingStartRequestBody,
  validateStagingBootstrapUrl,
  startStagingProjection,
  createClassroomLaunchController,
  classroomErrorMessage,
} from "../../classroom-projection-launch.mjs";

const STAGING_ORIGIN = "https://staging---example-as.a.run.app";
const SYNTHETIC_SESSION = { id: "synthetic-session-001", ownerId: "owner-uid-001", status: "open" };

// -----------------------------------------------------------------------------------
// GATE P3S-FIX1 — routing fix regression
// -----------------------------------------------------------------------------------
test("STAGING_API_ORIGIN is the fixed staging Cloud Run tag origin, distinct from CLASSROOM_ORIGIN", () => {
  assert.equal(STAGING_API_ORIGIN, "https://staging---hcma2-classroom-projection-vtap4scxpq-as.a.run.app");
  assert.notEqual(STAGING_API_ORIGIN, CLASSROOM_ORIGIN);
});

test("staging Start body is exactly {knowledgeSessionId, idempotencyKey} — same shape as normal Start", () => {
  const body = buildStagingStartRequestBody({ knowledgeSessionId: "abc123", idempotencyKey: "0123456789abcdef" });
  assert.deepEqual(body, { knowledgeSessionId: "abc123", idempotencyKey: "0123456789abcdef" });
  assert.deepEqual(Object.keys(body).sort(), ["idempotencyKey", "knowledgeSessionId"]);
});

// -----------------------------------------------------------------------------------
// validateStagingBootstrapUrl — shape-only, deliberately no origin pin
// -----------------------------------------------------------------------------------
test("validateStagingBootstrapUrl accepts any https origin with the exact bootstrap path and a present token", () => {
  assert.ok(validateStagingBootstrapUrl(`${STAGING_ORIGIN}/classroom/bootstrap?b=synthetic-token`));
  assert.ok(validateStagingBootstrapUrl(`${CLASSROOM_ORIGIN}/classroom/bootstrap?b=synthetic-token`), "the real production origin must also pass this shape check");
  assert.ok(validateStagingBootstrapUrl("https://some-other---revision-tag-as.a.run.app/classroom/bootstrap?b=x"), "a DIFFERENT tagged revision's origin must also pass — this is intentionally not pinned to one hardcoded value");
});

test("validateStagingBootstrapUrl rejects non-https, wrong path, or a missing token — same discipline as validateBootstrapUrl", () => {
  assert.equal(validateStagingBootstrapUrl(`http://${STAGING_ORIGIN.slice(8)}/classroom/bootstrap?b=t`), false, "http (not https) must be rejected");
  assert.equal(validateStagingBootstrapUrl(`${STAGING_ORIGIN}/some/other/path?b=t`), false, "wrong path must be rejected");
  assert.equal(validateStagingBootstrapUrl(`${STAGING_ORIGIN}/classroom/bootstrap`), false, "missing token must be rejected");
  assert.equal(validateStagingBootstrapUrl(`${STAGING_ORIGIN}/classroom/bootstrap?b=`), false, "empty token must be rejected");
  assert.equal(validateStagingBootstrapUrl("not-a-url"), false);
  assert.equal(validateStagingBootstrapUrl(""), false);
  assert.equal(validateStagingBootstrapUrl(null), false);
});

// -----------------------------------------------------------------------------------
// startStagingProjection — popup-safe ordering, network path, error mapping
// -----------------------------------------------------------------------------------
function fakeStagingCall(overrides = {}) {
  const calls = [];
  const fakeWindow = { location: { href: null }, closed: false, close() { this.closed = true; } };
  const windowOpenImpl = overrides.windowOpenImpl || (() => { calls.push("windowOpen"); return { ...fakeWindow }; });
  const fetchImpl =
    overrides.fetchImpl ||
    (async (url) => {
      calls.push(`fetch:${url}`);
      return { ok: true, json: async () => ({ bootstrapUrl: `${STAGING_ORIGIN}/classroom/bootstrap?b=synthetic-staging-token`, projectionSessionId: "synthetic-staging-proj-001" }) };
    });
  const getIdToken = overrides.getIdToken || (async () => { calls.push("getIdToken"); return "synthetic-id-token"; });
  return { calls, windowOpenImpl, fetchImpl, getIdToken };
}

test("startStagingProjection: popup window is opened before any async token/fetch call, same popup-safe ordering as normal Start", async () => {
  const { calls, windowOpenImpl, fetchImpl, getIdToken } = fakeStagingCall();
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken, knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, true);
  assert.equal(result.projectionSessionId, "synthetic-staging-proj-001");
  assert.deepEqual(calls.slice(0, 1), ["windowOpen"]);
  assert.ok(calls.indexOf("windowOpen") < calls.indexOf("getIdToken"), "window.open must happen strictly before getIdToken/fetch");
});

test("GATE P3S-FIX1 — startStagingProjection: by default (no origin override), posts to /projections/start-staging on the FIXED STAGING origin, never CLASSROOM_ORIGIN", async () => {
  const { calls, windowOpenImpl, fetchImpl, getIdToken } = fakeStagingCall();
  await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken, knowledgeSessionId: "sess-1" });
  const fetchCall = calls.find((c) => c.startsWith("fetch:"));
  assert.equal(fetchCall, `fetch:${STAGING_API_ORIGIN}/projections/start-staging`, "root cause of the P3 incident: this previously defaulted to CLASSROOM_ORIGIN, which routes to production 00006-kag — a revision that never has this route, so its CORS preflight 404s and the browser blocks the real POST before it's ever sent");
  assert.notEqual(fetchCall, `fetch:${CLASSROOM_ORIGIN}/projections/start-staging`);
});

test("GATE P3S-FIX1 — normal Start (createClassroomLaunchController) is completely unaffected: still targets CLASSROOM_ORIGIN, never STAGING_API_ORIGIN", async () => {
  const calls = [];
  const controller = createClassroomLaunchController({
    windowOpenImpl: () => ({ location: { href: null }, close() {} }),
    fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=t`, projectionSessionId: "p1" }) }; },
    getIdToken: async () => "t",
  });
  await controller.start(SYNTHETIC_SESSION);
  assert.equal(calls[0], `${CLASSROOM_ORIGIN}/projections/start`);
  assert.ok(!calls[0].includes("staging"), "normal Start must never target the staging origin");
});

test("GATE P3S-FIX1 — the staging destination is not client-controlled: it is a fixed literal constant, never derived from a returned bootstrapUrl, DOM value, or prior response", async () => {
  // The server's own response (including any bootstrapUrl it returns) is read AFTER the
  // /projections/start-staging request has already been sent — it is structurally impossible for
  // server-returned data to have influenced which origin that request itself was sent to. This
  // test proves the request origin is fixed regardless of what the eventual response contains.
  const { calls, windowOpenImpl, getIdToken } = fakeStagingCall();
  const attackerControlledFetch = async (url) => {
    calls.push(`fetch:${url}`);
    return { ok: true, json: async () => ({ bootstrapUrl: "https://attacker.example.com/classroom/bootstrap?b=x", projectionSessionId: "p1" }) };
  };
  await startStagingProjection({ windowOpenImpl, fetchImpl: attackerControlledFetch, getIdToken, knowledgeSessionId: "sess-1" });
  const fetchCall = calls.find((c) => c.startsWith("fetch:"));
  assert.equal(fetchCall, `fetch:${STAGING_API_ORIGIN}/projections/start-staging`, "the REQUEST origin must be the fixed constant regardless of anything in the eventual response");
});

test("startStagingProjection: navigates the opened window to the returned staging bootstrapUrl", async () => {
  let win;
  const windowOpenImpl = () => { win = { location: { href: null }, close() {} }; return win; };
  const { fetchImpl, getIdToken } = fakeStagingCall();
  const result = await startStagingProjection({ fetchImpl, getIdToken, windowOpenImpl, knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, true);
  assert.equal(win.location.href, `${STAGING_ORIGIN}/classroom/bootstrap?b=synthetic-staging-token`);
});

test("startStagingProjection: a blocked popup is detected before any network call — no getIdToken, no fetch", async () => {
  let getIdTokenCalled = false;
  let fetchCalled = false;
  const result = await startStagingProjection({
    windowOpenImpl: () => null,
    fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; },
    getIdToken: async () => { getIdTokenCalled = true; return "t"; },
    knowledgeSessionId: "sess-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "POPUP_BLOCKED");
  assert.equal(result.popupBlocked, true);
  assert.equal(getIdTokenCalled, false);
  assert.equal(fetchCalled, false);
});

test("startStagingProjection: a 403 FORBIDDEN from the server (not admin, or session not allowlisted) is surfaced with the existing mapped Vietnamese message, and closes the opened window", async () => {
  let closedCalled = false;
  const windowOpenImpl = () => ({ location: { href: null }, close() { closedCalled = true; } });
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN", message: "Staging Start requires an admin account." } }) });
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken: async () => "t", knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORBIDDEN");
  assert.equal(result.message, classroomErrorMessage("FORBIDDEN"));
  assert.ok(closedCalled, "the opened popup must be closed on a definitive rejection");
});

test("startStagingProjection: a 404 (feature disabled) is surfaced as a generic failure, not a crash", async () => {
  const windowOpenImpl = () => ({ location: { href: null }, close() {} });
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken: async () => "t", knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, false);
  assert.ok(result.message);
});

test("startStagingProjection: network failure is mapped to NETWORK, and closes the opened window", async () => {
  let closedCalled = false;
  const windowOpenImpl = () => ({ location: { href: null }, close() { closedCalled = true; } });
  const fetchImpl = async () => { throw new Error("fetch failed"); };
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken: async () => "t", knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NETWORK");
  assert.ok(closedCalled);
});

test("startStagingProjection: a malformed/unexpected bootstrapUrl from the server is rejected client-side too (defense in depth) and closes the opened window", async () => {
  let closedCalled = false;
  const windowOpenImpl = () => ({ location: { href: null }, close() { closedCalled = true; } });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ bootstrapUrl: "https://evil.example.com/not-bootstrap", projectionSessionId: "p1" }) });
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken: async () => "t", knowledgeSessionId: "sess-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_BOOTSTRAP_URL");
  assert.ok(closedCalled);
});

test("startStagingProjection: never returns or otherwise surfaces the raw bootstrap token or the Firebase ID token in its result", async () => {
  const { windowOpenImpl, fetchImpl, getIdToken } = fakeStagingCall();
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken, knowledgeSessionId: "sess-1" });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("synthetic-staging-token"), "the raw bootstrap token must never appear in the result");
  assert.ok(!serialized.includes("synthetic-id-token"), "the raw Firebase ID token must never appear in the result");
  assert.deepEqual(Object.keys(result).sort(), ["ok", "projectionSessionId"], "success result must be exactly {ok, projectionSessionId} — nothing else, nothing sensitive");
});

test("startStagingProjection: is entirely independent of createClassroomLaunchController — takes no controller/state argument and returns a plain, self-contained result", async () => {
  const { windowOpenImpl, fetchImpl, getIdToken } = fakeStagingCall();
  const result = await startStagingProjection({ windowOpenImpl, fetchImpl, getIdToken, knowledgeSessionId: "sess-1" });
  assert.equal(typeof result, "object");
  assert.equal(result.ok, true);
});
