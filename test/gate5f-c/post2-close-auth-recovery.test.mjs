// GATE 5F.D2.POST-2 — deterministic tests for the shared token-provider guard
// (createGetClassroomIdToken) and the Close-only forced-refresh retry policy. No browser, no real
// Firebase, no live Classroom service. Never touches the protected production session
// (9dv8xHfIDmORIOszpylH / 3ZQ7YU) — every fixture below is synthetic.
//
// Root cause (Gate 5F.D2.POST-1/POST-1A): a real production Close request reached the Classroom
// backend with an empty Authorization value ("Bearer " with nothing after) and was correctly
// rejected 401 UNAUTHENTICATED. External Firebase JS SDK source confirms getIdToken() can
// legitimately resolve to an empty string; the SDK does not itself guard against it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSROOM_ORIGIN,
  createClassroomLaunchController,
  createGetClassroomIdToken,
} from "../../classroom-projection-launch.mjs";

const SYNTHETIC_SESSION = { id: "post2-session-001", ownerId: "owner-uid-001", status: "open" };

// -----------------------------------------------------------------------------------
// createGetClassroomIdToken — the shared token-provider contract in isolation
// -----------------------------------------------------------------------------------

test("createGetClassroomIdToken: currentUser null -> controlled UNAUTHENTICATED, no fetch attempted", async () => {
  const getIdToken = createGetClassroomIdToken(() => null);
  await assert.rejects(() => getIdToken(), (err) => err.classroomCode === "UNAUTHENTICATED");
});

test("createGetClassroomIdToken: user.getIdToken() throws/rejects -> controlled UNAUTHENTICATED", async () => {
  const user = { getIdToken: async () => { throw new Error("boom"); } };
  const getIdToken = createGetClassroomIdToken(() => user);
  await assert.rejects(() => getIdToken(), (err) => err.classroomCode === "UNAUTHENTICATED");
});

test("createGetClassroomIdToken: resolved token is not a string -> controlled UNAUTHENTICATED", async () => {
  const user = { getIdToken: async () => undefined };
  const getIdToken = createGetClassroomIdToken(() => user);
  await assert.rejects(() => getIdToken(), (err) => err.classroomCode === "UNAUTHENTICATED");
});

test("createGetClassroomIdToken: empty string token -> controlled UNAUTHENTICATED (the exact production incident)", async () => {
  const user = { getIdToken: async () => "" };
  const getIdToken = createGetClassroomIdToken(() => user);
  await assert.rejects(() => getIdToken(), (err) => err.classroomCode === "UNAUTHENTICATED");
});

test("createGetClassroomIdToken: whitespace-only token -> controlled UNAUTHENTICATED (trim-empty)", async () => {
  const user = { getIdToken: async () => "   " };
  const getIdToken = createGetClassroomIdToken(() => user);
  await assert.rejects(() => getIdToken(), (err) => err.classroomCode === "UNAUTHENTICATED");
});

test("createGetClassroomIdToken: valid non-empty token -> resolves with it, forceRefresh passed through verbatim", async () => {
  const seen = [];
  const user = { getIdToken: async (forceRefresh) => { seen.push(forceRefresh); return "real-jwt-token"; } };
  const getIdToken = createGetClassroomIdToken(() => user);
  assert.equal(await getIdToken(), "real-jwt-token");
  assert.deepEqual(seen, [false], "default call must pass forceRefresh:false");
  assert.equal(await getIdToken({ forceRefresh: true }), "real-jwt-token");
  assert.deepEqual(seen, [false, true], "explicit forceRefresh:true must reach user.getIdToken() verbatim");
});

// -----------------------------------------------------------------------------------
// Controller harness — mirrors classroom-launch.test.mjs's own fakeController pattern, but with a
// stateful getIdToken/fetchImpl so the exact token-attempt vs HTTP-request counts can be asserted.
// -----------------------------------------------------------------------------------
function makeController({ tokenScript, closeResponses, statusResponse } = {}) {
  const tokenCalls = [];
  const closeHttpCalls = [];
  const statusHttpCalls = [];
  let tokenIdx = 0;
  let closeIdx = 0;

  const getIdToken = async ({ forceRefresh = false } = {}) => {
    tokenCalls.push(forceRefresh);
    const step = tokenScript[tokenIdx++];
    if (step === undefined) throw new Error("test bug: tokenScript exhausted");
    if (step.throws) throw Object.assign(new Error("token failure"), { classroomCode: "UNAUTHENTICATED" });
    return step.token;
  };

  const fetchImpl = async (url, init) => {
    if (url.endsWith("/projections/start")) {
      return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=x`, projectionSessionId: "proj-1" }) };
    }
    if (url.endsWith("/projections/status")) {
      statusHttpCalls.push(init.headers.Authorization);
      const r = statusResponse || { active: false, startedAtMs: null, expiresAtMs: null };
      return { ok: true, json: async () => r };
    }
    if (url.endsWith("/projections/close")) {
      closeHttpCalls.push(init.headers.Authorization);
      const resp = closeResponses[closeIdx++];
      if (resp === undefined) throw new Error("test bug: closeResponses exhausted");
      return resp;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const windowOpenImpl = () => ({ location: {}, close() {} });
  const controller = createClassroomLaunchController({ windowOpenImpl, fetchImpl, getIdToken });
  return { controller, tokenCalls, closeHttpCalls, statusHttpCalls };
}

async function primeActive(controller) {
  const r = await controller.start(SYNTHETIC_SESSION);
  assert.equal(r.ok, true, "precondition: Start must succeed to reach the active state Close operates from");
  assert.equal(controller.getView(), "active");
}

// -----------------------------------------------------------------------------------
// §3 — exact network-call assertion matrix
// -----------------------------------------------------------------------------------

test("network matrix 1: valid initial token -> 1 token attempt, 1 Close HTTP request", async () => {
  const { controller, tokenCalls, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "close-token" }],
    closeResponses: [{ ok: true, json: async () => ({ closed: true }) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(controller.getView(), "inactive");
  assert.deepEqual(tokenCalls, [false, false], "start token attempt + one close token attempt, both non-forced");
  assert.equal(closeHttpCalls.length, 1);
  assert.equal(closeHttpCalls[0], "Bearer close-token");
});

test("network matrix 2: initial token empty (client-side guard) -> first Close HTTP request count = 0 for that attempt", async () => {
  const { controller, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { throws: true }, { token: "refreshed-token" }],
    closeResponses: [{ ok: true, json: async () => ({ closed: true }) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  // Only ONE real HTTP request total: the empty-token attempt never reached fetch at all.
  assert.equal(closeHttpCalls.length, 1);
  assert.equal(closeHttpCalls[0], "Bearer refreshed-token");
});

test("network matrix 3: initial token empty + forced refresh valid -> 2 token attempts (for Close), 1 Close HTTP request total", async () => {
  const { controller, tokenCalls, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { throws: true }, { token: "refreshed-token" }],
    closeResponses: [{ ok: true, json: async () => ({ closed: true }) }],
  });
  await primeActive(controller);
  await controller.close(SYNTHETIC_SESSION);
  assert.deepEqual(tokenCalls, [false, false, true], "start(false) + close-attempt1(false, throws) + close-retry(true)");
  assert.equal(closeHttpCalls.length, 1, "only the successful forced-refresh attempt reaches the network");
});

test("network matrix 4: initial token empty + forced refresh also empty/fails -> 0 Close HTTP requests, controlled failure, Active preserved", async () => {
  const { controller, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { throws: true }, { throws: true }],
    closeResponses: [],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAUTHENTICATED");
  assert.equal(closeHttpCalls.length, 0, "neither token attempt ever reached fetch");
  assert.equal(controller.getView(), "active", "must stay Active, never silently inactive");
  assert.ok(!result.recheckStatus, "no recheck when the FINAL failure is itself an auth failure");
});

test("network matrix 5: initial token valid + backend Close returns 401 -> forced refresh valid -> 2 HTTP requests total", async () => {
  const { controller, tokenCalls, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "looks-valid-but-rejected" }, { token: "refreshed-token" }],
    closeResponses: [
      { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Missing Firebase ID token." } }) },
      { ok: true, json: async () => ({ closed: true }) },
    ],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(closeHttpCalls.length, 2, "both attempts reached the network: first rejected 401, retry succeeded");
  assert.deepEqual(tokenCalls, [false, false, true]);
  assert.equal(controller.getView(), "inactive");
});

test("network matrix 6a: backend 403 -> exactly 1 HTTP request, no auth retry", async () => {
  const { controller, closeHttpCalls, tokenCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "valid-token" }],
    closeResponses: [{ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN", message: "You do not own this session." } }) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORBIDDEN");
  assert.equal(closeHttpCalls.length, 1, "no retry for a non-auth code");
  assert.deepEqual(tokenCalls, [false, false], "no second (forced-refresh) token attempt");
  assert.equal(controller.getView(), "active");
  assert.ok(result.recheckStatus, "non-auth final failure should trigger a recheck");
});

test("network matrix 6b: backend 409 -> exactly 1 HTTP request, no auth retry", async () => {
  const { controller, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "valid-token" }],
    closeResponses: [{ ok: false, status: 409, json: async () => ({ error: { code: "SESSION_DELETED", message: "Session is deleted or in trash." } }) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_DELETED");
  assert.equal(closeHttpCalls.length, 1);
});

test("network matrix 6c: backend 5xx -> exactly 1 HTTP request, no auth retry", async () => {
  const { controller, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "valid-token" }],
    closeResponses: [{ ok: false, status: 500, json: async () => ({}) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(closeHttpCalls.length, 1);
});

test("network matrix 6d: network failure (fetchImpl throws) -> no auth retry, treated as NETWORK", async () => {
  const getIdToken = async () => "some-token";
  let closeCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/projections/start")) return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=x`, projectionSessionId: "p1" }) };
    if (url.endsWith("/projections/close")) { closeCalls++; throw new Error("offline"); }
    throw new Error("unexpected");
  };
  const controller = createClassroomLaunchController({ windowOpenImpl: () => ({ location: {}, close() {} }), fetchImpl, getIdToken });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NETWORK");
  assert.equal(closeCalls, 1, "no retry for NETWORK");
  assert.equal(controller.getView(), "active");
});

// -----------------------------------------------------------------------------------
// §2/§6 — state preservation, no retry loops
// -----------------------------------------------------------------------------------

test("failed Close (after exhausting the one retry) always leaves the controller Active, never optimistic-inactive", async () => {
  const { controller } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "t1" }, { token: "t2" }],
    closeResponses: [
      { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Missing Firebase ID token." } }) },
      { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Missing Firebase ID token." } }) },
    ],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(controller.getView(), "active");
  assert.equal(controller.getStatusKnowledge(), "active");
});

test("successful recovered Close (after exactly one retry) transitions the controller to inactive", async () => {
  const { controller } = makeController({
    tokenScript: [{ token: "start-token" }, { throws: true }, { token: "refreshed" }],
    closeResponses: [{ ok: true, json: async () => ({ closed: true }) }],
  });
  await primeActive(controller);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(controller.getView(), "inactive");
  assert.equal(controller.getStatusKnowledge(), "inactive");
});

test("exactly one retry is attempted even if the retry ALSO returns 401 — no unbounded retry loop", async () => {
  const { controller, closeHttpCalls, tokenCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { token: "t1" }, { token: "t2" }],
    closeResponses: [
      { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHENTICATED", message: "x" } }) },
      { ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHENTICATED", message: "x" } }) },
    ],
  });
  await primeActive(controller);
  await controller.close(SYNTHETIC_SESSION);
  assert.equal(closeHttpCalls.length, 2, "exactly two HTTP attempts, never a third");
  assert.equal(tokenCalls.length, 3, "start token + exactly two close token attempts (normal + one forced refresh)");
});

test("Authorization header is never sent as bare 'Bearer ' with nothing after — the client-side guard always intercepts an empty token first", async () => {
  // This directly reproduces what POST-1 proved happened in production, and proves it can no
  // longer happen: an empty-resolving token is caught by createGetClassroomIdToken before
  // postJson ever builds a request, so "Bearer " (trailing space, empty) can never be observed.
  const { controller, closeHttpCalls } = makeController({
    tokenScript: [{ token: "start-token" }, { throws: true }, { throws: true }],
    closeResponses: [],
  });
  await primeActive(controller);
  await controller.close(SYNTHETIC_SESSION);
  assert.equal(closeHttpCalls.length, 0);
  assert.ok(!closeHttpCalls.includes("Bearer "), "the exact production failure string must never be sent");
});

// -----------------------------------------------------------------------------------
// §4/§5 — Start and Status regression: shared guard applies, but no retry-on-401 policy added
// -----------------------------------------------------------------------------------

test("Start: empty token now fails client-side (shared guard applies) but Start is NEVER retried — single attempt, popup/idempotency untouched", async () => {
  const idempotencyKeys = [];
  let startFetchCalls = 0;
  // Wired through the REAL shared guard (not a raw mock) — this is what actually catches the
  // empty-token case before any request; simulates a user whose getIdToken() resolves to "".
  const getIdToken = createGetClassroomIdToken(() => ({ getIdToken: async () => "" }));
  const fetchImpl = async (url, init) => {
    startFetchCalls++;
    idempotencyKeys.push(JSON.parse(init.body).idempotencyKey);
    return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=x`, projectionSessionId: "p1" }) };
  };
  let windowOpened = 0;
  const controller = createClassroomLaunchController({
    windowOpenImpl: () => { windowOpened++; return { location: {}, close() {} }; },
    fetchImpl,
    getIdToken,
  });
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAUTHENTICATED");
  assert.equal(windowOpened, 1, "window.open() still happens exactly once — popup sequencing unchanged");
  assert.equal(startFetchCalls, 0, "the empty token is caught client-side; postJson is never reached; NO forced-refresh retry is attempted for Start");
  assert.equal(controller.getView(), "inactive", "matches the existing non-ambiguous-failure state restoration, unchanged (requireKnownStatus not set here, so an idle/unchecked controller's view is 'inactive')");
});

test("Status: shared guard applies (empty token -> controlled failure) but no forced-refresh retry for Status either", async () => {
  let statusFetchCalls = 0;
  const getIdToken = createGetClassroomIdToken(() => ({ getIdToken: async () => "" }));
  const fetchImpl = async (url) => {
    if (url.endsWith("/projections/status")) { statusFetchCalls++; return { ok: true, json: async () => ({ active: false, startedAtMs: null, expiresAtMs: null }) }; }
    throw new Error("unexpected");
  };
  const controller = createClassroomLaunchController({ windowOpenImpl: () => ({ location: {}, close() {} }), fetchImpl, getIdToken });
  const result = await controller.checkStatus(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(statusFetchCalls, 0, "empty token caught client-side; no retry attempted for Status");
  assert.equal(controller.getStatusKnowledge(), "unavailable");
});

test("Status with a valid token behaves exactly as before (one attempt, no forceRefresh)", async () => {
  const seenForceRefresh = [];
  const getIdToken = async ({ forceRefresh = false } = {}) => { seenForceRefresh.push(forceRefresh); return "valid-token"; };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ active: true, startedAtMs: 1000, expiresAtMs: 2000 }) });
  const controller = createClassroomLaunchController({ windowOpenImpl: () => ({ location: {}, close() {} }), fetchImpl, getIdToken });
  const result = await controller.checkStatus(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.deepEqual(seenForceRefresh, [false]);
});
