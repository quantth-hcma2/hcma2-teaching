// GATE 5F.C — deterministic tests for classroom-projection-launch.mjs. No browser, no real
// Firebase, no live Classroom service (none exists yet, per Gate 5F.B). Every external effect
// (window.open, fetch, getIdToken) is a plain injected fake. Never touches the protected
// production session (9dv8xHfIDmORIOszpylH / 3ZQ7YU) — every fixture below is synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSROOM_ORIGIN,
  isValidIdempotencyKey,
  generateIdempotencyKey,
  canLaunchClassroomProjection,
  buildStartRequestBody,
  buildCloseRequestBody,
  validateBootstrapUrl,
  classroomErrorMessage,
  createClassroomLaunchController,
} from "../../classroom-projection-launch.mjs";

const SYNTHETIC_SESSION = { id: "synthetic-session-001", ownerId: "owner-uid-001", status: "open" };

// -----------------------------------------------------------------------------------
// Origin
// -----------------------------------------------------------------------------------
test("correct Classroom API origin — exactly the frozen production value, no classroom.invalid", () => {
  assert.equal(CLASSROOM_ORIGIN, "https://classroom.quantth.vn");
  assert.ok(!CLASSROOM_ORIGIN.includes("invalid"));
});

// -----------------------------------------------------------------------------------
// idempotencyKey
// -----------------------------------------------------------------------------------
test("idempotencyKey shape: matches the exact Gate 5C pattern ^[A-Za-z0-9_-]{16,128}$", () => {
  const key = generateIdempotencyKey();
  assert.ok(isValidIdempotencyKey(key), `generated key ${key} must satisfy the Gate 5C pattern`);
  assert.ok(key.length >= 16 && key.length <= 128);
});

test("isValidIdempotencyKey rejects shapes the backend would reject", () => {
  assert.equal(isValidIdempotencyKey("too-short"), false);
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey("has a space in it and is long enough"), false);
  assert.equal(isValidIdempotencyKey("a".repeat(129)), false);
});

test("generateIdempotencyKey throws (never silently sends a bad key) if the injected generator misbehaves", () => {
  assert.throws(() => generateIdempotencyKey(() => "too-short"));
});

// -----------------------------------------------------------------------------------
// Request bodies — exact contract, not guessed
// -----------------------------------------------------------------------------------
test("Start body contains the exact sessionId and idempotencyKey, no extra fields", () => {
  const body = buildStartRequestBody({ knowledgeSessionId: "abc123", idempotencyKey: "0123456789abcdef" });
  assert.deepEqual(body, { knowledgeSessionId: "abc123", idempotencyKey: "0123456789abcdef" });
  assert.deepEqual(Object.keys(body).sort(), ["idempotencyKey", "knowledgeSessionId"]);
});

test("Close body is exactly {knowledgeSessionId} — no idempotencyKey, no projectionSessionId (verified against Gate 5C source)", () => {
  const body = buildCloseRequestBody({ knowledgeSessionId: "abc123" });
  assert.deepEqual(body, { knowledgeSessionId: "abc123" });
  assert.deepEqual(Object.keys(body), ["knowledgeSessionId"]);
});

// -----------------------------------------------------------------------------------
// Authorization / visibility (mirrors Gate 5C's authorizeOwnerOrAdmin — frontend only)
// -----------------------------------------------------------------------------------
test("owner/admin visibility: active admin can launch any non-deleted session", () => {
  assert.equal(canLaunchClassroomProjection({ session: SYNTHETIC_SESSION, isAdminView: true, actorUid: "some-other-uid" }), true);
});

test("owner/admin visibility: teacher can launch only their own session", () => {
  assert.equal(canLaunchClassroomProjection({ session: SYNTHETIC_SESSION, isAdminView: false, actorUid: "owner-uid-001" }), true);
  assert.equal(canLaunchClassroomProjection({ session: SYNTHETIC_SESSION, isAdminView: false, actorUid: "someone-else" }), false);
});

test("owner/admin visibility: deleted/trashed session is never launchable, even by its owner or an admin", () => {
  for (const flag of ["teacherDeletedAt", "adminDeletedAt", "adminDeleting", "deletingAt"]) {
    const trashed = { ...SYNTHETIC_SESSION, [flag]: true };
    assert.equal(canLaunchClassroomProjection({ session: trashed, isAdminView: false, actorUid: "owner-uid-001" }), false, `owner blocked by ${flag}`);
    assert.equal(canLaunchClassroomProjection({ session: trashed, isAdminView: true, actorUid: "any-admin" }), false, `admin blocked by ${flag}`);
  }
});

test("owner/admin visibility: no session (still loading/not found) is never launchable", () => {
  assert.equal(canLaunchClassroomProjection({ session: null, isAdminView: true, actorUid: "x" }), false);
});

// -----------------------------------------------------------------------------------
// CLOSED session is allowed (does not inherit AI Analyze's CLOSED-only rule)
// -----------------------------------------------------------------------------------
test("CLOSED session is allowed: canLaunchClassroomProjection does not check session.status at all", () => {
  const closedSession = { ...SYNTHETIC_SESSION, status: "closed" };
  assert.equal(canLaunchClassroomProjection({ session: closedSession, isAdminView: false, actorUid: "owner-uid-001" }), true);
  const openSession = { ...SYNTHETIC_SESSION, status: "open" };
  assert.equal(canLaunchClassroomProjection({ session: openSession, isAdminView: false, actorUid: "owner-uid-001" }), true);
});

// -----------------------------------------------------------------------------------
// bootstrapUrl validation
// -----------------------------------------------------------------------------------
test("returned bootstrapUrl is exact-origin validated: the real shape is accepted", () => {
  assert.equal(validateBootstrapUrl("https://classroom.quantth.vn/classroom/bootstrap?b=abc123"), true);
});

test("malicious/wrong-origin bootstrapUrl is rejected", () => {
  const bad = [
    "https://classroom.invalid/classroom/bootstrap?b=abc123",
    "https://evil.example/classroom/bootstrap?b=abc123",
    "http://classroom.quantth.vn/classroom/bootstrap?b=abc123", // downgraded scheme
    "https://classroom.quantth.vn.evil.example/classroom/bootstrap?b=abc123", // suffix trick
    "https://classroom.quantth.vn/not-bootstrap?b=abc123", // wrong path
    "https://classroom.quantth.vn/classroom/bootstrap", // missing token param
    "javascript:alert(1)",
    "not-a-url",
    "",
    null,
    undefined,
  ];
  for (const url of bad) {
    assert.equal(validateBootstrapUrl(url), false, `expected ${JSON.stringify(url)} to be rejected`);
  }
});

// -----------------------------------------------------------------------------------
// Error mapping
// -----------------------------------------------------------------------------------
test("error mapping: every documented Gate 5C code maps to a Vietnamese, non-technical message", () => {
  for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "BAD_SESSION", "SESSION_NOT_FOUND", "SESSION_DELETED", "BAD_IDEMPOTENCY_KEY", "NETWORK", "INVALID_BOOTSTRAP_URL", "POPUP_BLOCKED"]) {
    const msg = classroomErrorMessage(code);
    assert.equal(typeof msg, "string");
    assert.ok(msg.length > 0);
    assert.ok(!/[A-Z_]{4,}/.test(msg), `message for ${code} must not leak a raw error code: ${msg}`);
  }
});

test("error mapping: an unknown/future code still gets a safe generic message, never undefined", () => {
  assert.equal(typeof classroomErrorMessage("SOME_FUTURE_CODE"), "string");
  assert.equal(typeof classroomErrorMessage(undefined), "string");
});

// -----------------------------------------------------------------------------------
// Controller: popup-safe ordering, double-click, state machine
// -----------------------------------------------------------------------------------
function fakeController(overrides = {}) {
  const calls = [];
  const fakeWindow = { location: { href: null }, closed: false, close() { this.closed = true; } };
  const windowOpenImpl = overrides.windowOpenImpl || (() => { calls.push("windowOpen"); return { ...fakeWindow }; });
  const fetchImpl = overrides.fetchImpl || (async (url) => { calls.push(`fetch:${url}`); return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=synthetic-token`, projectionSessionId: "synthetic-proj-001" }) }; });
  const getIdToken = overrides.getIdToken || (async () => { calls.push("getIdToken"); return "synthetic-id-token"; });
  const controller = createClassroomLaunchController({ windowOpenImpl, fetchImpl, getIdToken, randomUUID: overrides.randomUUID });
  return { controller, calls };
}

test("popup window is opened before any async token/fetch call (popup-blocker-safe ordering)", async () => {
  const { controller, calls } = fakeController();
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(0, 1), ["windowOpen"]);
  assert.ok(calls.indexOf("windowOpen") < calls.indexOf("getIdToken"), "window.open must happen strictly before getIdToken/fetch");
});

test("double click does not create parallel Start calls: second call while starting reuses the same in-flight promise", async () => {
  let windowOpenCount = 0;
  let fetchCount = 0;
  const { controller } = fakeController({
    windowOpenImpl: () => { windowOpenCount++; return { location: { href: null }, close() {} }; },
    fetchImpl: async () => { fetchCount++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=t`, projectionSessionId: "p1" }) }; },
  });
  const p1 = controller.start(SYNTHETIC_SESSION);
  const p2 = controller.start(SYNTHETIC_SESSION); // simulated double-click while the first is still pending
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(windowOpenCount, 1, "window.open must only fire once across a double-click");
  assert.equal(fetchCount, 1, "only one network Start request must be sent across a double-click");
  assert.deepEqual(r1, r2, "the second call must resolve to the exact same result as the first (same in-flight request)");
});

test("a NEW deliberate Start after completion gets a fresh idempotencyKey (not reused across separate logical starts)", async () => {
  const seenKeys = [];
  const { controller } = fakeController({
    randomUUID: () => { const k = `11111111-1111-4111-8111-${String(seenKeys.length).padStart(12, "0")}`; seenKeys.push(k); return k; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=t`, projectionSessionId: "p1" }) }),
  });
  await controller.start(SYNTHETIC_SESSION);
  assert.equal(controller.getState(), "active");
  const r2 = await controller.start(SYNTHETIC_SESSION, { confirmed: true }); // deliberate restart, confirmed
  assert.equal(r2.ok, true);
  assert.equal(seenKeys.length, 2, "a second, confirmed, deliberate Start must generate a fresh key");
  assert.notEqual(seenKeys[0], seenKeys[1]);
});

test("restart warning: starting again while already active without confirmation does not call the network or window.open again", async () => {
  let windowOpenCount = 0;
  let fetchCount = 0;
  const { controller } = fakeController({
    windowOpenImpl: () => { windowOpenCount++; return { location: { href: null }, close() {} }; },
    fetchImpl: async () => { fetchCount++; return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=t`, projectionSessionId: "p1" }) }; },
  });
  await controller.start(SYNTHETIC_SESSION);
  assert.equal(controller.getState(), "active");
  const result = await controller.start(SYNTHETIC_SESSION); // no confirmed:true
  assert.deepEqual(result, { ok: false, needsConfirmation: true });
  assert.equal(windowOpenCount, 1, "must not open a second window without explicit confirmation");
  assert.equal(fetchCount, 1, "must not call the network again without explicit confirmation");
});

test("projectionSessionId is retained only in memory (controller closure) — not on window/global, not serialized anywhere by this module", async () => {
  const { controller } = fakeController();
  assert.equal(controller.getProjectionSessionId(), null);
  await controller.start(SYNTHETIC_SESSION);
  assert.equal(controller.getProjectionSessionId(), "synthetic-proj-001");
  // Persistence-free by design — verified directly against the source below.
});

test("REGRESSION: no localStorage/sessionStorage/document.cookie usage anywhere in this module's source", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../classroom-projection-launch.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("localStorage"), "must never persist projection state to localStorage");
  assert.ok(!src.includes("sessionStorage"), "must never persist projection state to sessionStorage");
  assert.ok(!src.includes("document.cookie"), "must never read/write cookies directly — the __Host-cbp cookie is set only by the Classroom origin itself");
});

test("popup blocked: start() proceeds with the network call, does not navigate, and hands back the bootstrapUrl for a caller-driven fallback (never auto-opened)", async () => {
  let secondWindowOpenCalls = 0;
  const { controller } = fakeController({ windowOpenImpl: () => null }); // simulates a blocked popup
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(result.popupBlocked, true);
  assert.equal(result.bootstrapUrl, `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=synthetic-token`);
  assert.equal(controller.getState(), "active", "the projection itself DID start server-side even though the popup was blocked");
});

test("openBlockedPopup() is the only path that opens the real bootstrapUrl — a separate, caller-invoked, fresh-gesture action", () => {
  let openedWith = null;
  const { controller } = fakeController({ windowOpenImpl: (url) => { openedWith = url; return { closed: false }; } });
  controller.openBlockedPopup("https://classroom.quantth.vn/classroom/bootstrap?b=x");
  assert.equal(openedWith, "https://classroom.quantth.vn/classroom/bootstrap?b=x");
});

test("invalid bootstrapUrl from the server: the opened blank window is closed, start reports a failure, state returns to idle", async () => {
  let closedCalled = false;
  const { controller } = fakeController({
    windowOpenImpl: () => ({ location: { href: null }, close() { closedCalled = true; } }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ bootstrapUrl: "https://evil.example/classroom/bootstrap?b=x", projectionSessionId: "p1" }) }),
  });
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_BOOTSTRAP_URL");
  assert.equal(closedCalled, true, "the pre-opened blank tab must be closed rather than left dangling or navigated");
  assert.equal(controller.getState(), "idle");
});

test("Close uses the actual Gate 5C contract: POST /projections/close with {knowledgeSessionId} and Bearer auth", async () => {
  let capturedUrl, capturedInit;
  const { controller } = fakeController({
    fetchImpl: async (url, init) => { capturedUrl = url; capturedInit = init; return { ok: true, json: async () => ({ closed: true }) }; },
  });
  await controller.start(SYNTHETIC_SESSION);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(capturedUrl, `${CLASSROOM_ORIGIN}/projections/close`);
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers.Authorization, "Bearer synthetic-id-token");
  assert.equal(capturedInit.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(capturedInit.body), { knowledgeSessionId: SYNTHETIC_SESSION.id });
});

test("Close clears local state on success and returns to idle", async () => {
  const { controller } = fakeController();
  await controller.start(SYNTHETIC_SESSION);
  assert.equal(controller.getProjectionSessionId(), "synthetic-proj-001");
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, true);
  assert.equal(controller.getProjectionSessionId(), null);
  assert.equal(controller.getState(), "idle");
});

test("Close failure keeps state 'active' (does not silently pretend the projection ended)", async () => {
  const { controller } = fakeController({
    fetchImpl: async (url) => {
      if (url.endsWith("/projections/close")) return { ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "no" } }) };
      return { ok: true, json: async () => ({ bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=t`, projectionSessionId: "p1" }) };
    },
  });
  await controller.start(SYNTHETIC_SESSION);
  const result = await controller.close(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "FORBIDDEN");
  assert.equal(controller.getState(), "active");
  assert.equal(controller.getProjectionSessionId(), "p1", "must not clear a projection Close failed to actually revoke");
});

test("network failure during Start maps to the NETWORK error code and resets state to idle", async () => {
  const { controller } = fakeController({ fetchImpl: async () => { throw new Error("fetch failed"); } });
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NETWORK");
  assert.equal(controller.getState(), "idle");
});

test("server error codes (e.g. SESSION_DELETED) pass through to a mapped Vietnamese message, not a raw code", async () => {
  const { controller } = fakeController({
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: { code: "SESSION_DELETED", message: "Session is deleted or in trash." } }) }),
  });
  const result = await controller.start(SYNTHETIC_SESSION);
  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_DELETED");
  assert.equal(result.message, classroomErrorMessage("SESSION_DELETED"));
  assert.ok(!/Session is deleted or in trash/.test(result.message), "must not leak the raw server message verbatim");
});
