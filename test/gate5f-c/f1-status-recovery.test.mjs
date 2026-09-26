// GATE 5F.D2.F1 — deterministic tests for the server-derived active-projection recovery in
// classroom-projection-launch.mjs. No browser, no real Firebase, no live Classroom service: every
// external effect (window.open, fetch, getIdToken, timers) is an injected fake. Every fixture is
// synthetic; the protected production Knowledge session is never referenced.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CLASSROOM_ORIGIN,
  STATUS_TIMEOUT_MS,
  buildStatusRequestBody,
  parseStatusResponse,
  canLaunchClassroomProjection,
  createClassroomLaunchController,
} from "../../classroom-projection-launch.mjs";

const SESSION_A = { id: "synthetic-session-A-001", ownerId: "owner-uid-001", status: "open" };
const SESSION_B = { id: "synthetic-session-B-002", ownerId: "owner-uid-001", status: "open" };
const START_OK = { bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=synthetic-token`, projectionSessionId: "synthetic-proj-001" };
const ACTIVE = { active: true, startedAtMs: 1_000_000, expiresAtMs: 1_000_000 + 4 * 3600 * 1000 };
const INACTIVE = { active: false, startedAtMs: null, expiresAtMs: null };

const jsonRes = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));

// A router-style fake backend so each test states only what differs.
function harness({ status = () => jsonRes(INACTIVE), start = () => jsonRes(START_OK), close = () => jsonRes({ closed: true }), popup = true, controllerOptions = {} } = {}) {
  const log = { events: [], fetches: [], windowOpens: 0, tokens: 0, closedWindows: 0 };
  const fakeWindow = () => ({ location: { href: null }, close() { log.closedWindows++; } });
  const fetchImpl = async (url, init) => {
    const path = url.slice(CLASSROOM_ORIGIN.length);
    log.fetches.push({ url, path, init });
    log.events.push(`fetch:${path}`);
    if (path === "/projections/status") return status(init);
    if (path === "/projections/start") return start(init);
    if (path === "/projections/close") return close(init);
    throw new Error("unexpected path " + path);
  };
  const controller = createClassroomLaunchController({
    windowOpenImpl: () => { log.windowOpens++; log.events.push("windowOpen"); return popup ? fakeWindow() : null; },
    fetchImpl,
    getIdToken: async () => { log.tokens++; log.events.push("getIdToken"); return "synthetic-teacher-id-token"; },
    requireKnownStatus: true,
    ...controllerOptions,
  });
  const count = (path) => log.fetches.filter((f) => f.path === path).length;
  return { controller, log, count };
}

// ---------------------------------------------------------------- 1. request shape
test("F1-1: status request goes to the exact Classroom origin with the teacher token and ONLY {knowledgeSessionId}", async () => {
  const { controller, log } = harness();
  await controller.checkStatus(SESSION_A);
  assert.equal(log.fetches.length, 1);
  const { url, init } = log.fetches[0];
  assert.equal(url, "https://classroom.quantth.vn/projections/status");
  assert.equal(CLASSROOM_ORIGIN, "https://classroom.quantth.vn");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer synthetic-teacher-id-token");
  assert.equal(init.headers["Content-Type"], "application/json");
  const body = JSON.parse(init.body);
  assert.deepEqual(body, { knowledgeSessionId: SESSION_A.id });
  assert.deepEqual(Object.keys(body), ["knowledgeSessionId"]);
  assert.deepEqual(buildStatusRequestBody({ knowledgeSessionId: "x" }), { knowledgeSessionId: "x" });
  assert.equal(log.tokens, 1, "the injected teacher ID-token source is used");
});

test("F1-1b: status never carries a Cookie/credentials override and is never a mutating verb", async () => {
  const { controller, log } = harness();
  await controller.checkStatus(SESSION_A);
  const init = log.fetches[0].init;
  assert.equal(init.credentials, undefined);
  assert.ok(!Object.keys(init.headers).some((h) => /cookie/i.test(h)));
  assert.equal(log.fetches.filter((f) => f.path !== "/projections/status").length, 0, "checking status must never call Start or Close");
});

// ---------------------------------------------------------------- 3/4. recovery + inactive
test("F1-3: a FRESH controller (no retained state) recovers active:true and offers Close", async () => {
  const first = harness({ status: () => jsonRes(ACTIVE) });
  await first.controller.checkStatus(SESSION_A);
  // Simulates a Teaching refresh: everything from the previous page is gone.
  const fresh = harness({ status: () => jsonRes(ACTIVE) });
  assert.equal(fresh.controller.getProjectionSessionId(), null);
  assert.equal(fresh.controller.getView(), "unknown", "before any check, a known-status-required controller is UNKNOWN");
  const pending = fresh.controller.checkStatus(SESSION_A);
  assert.equal(fresh.controller.getView(), "loading", "flips to loading synchronously");
  const result = await pending;
  assert.deepEqual(result, { ok: true, active: true });
  assert.equal(fresh.controller.getView(), "active");
  assert.equal(fresh.controller.getStatusKnowledge(), "active");
  assert.equal(fresh.controller.getState(), "active");
  assert.equal(fresh.controller.getProjectionSessionId(), null, "no projection id is (or needs to be) known after recovery");
});

test("F1-4: active:false shows the normal Start state, with no confirmation needed", async () => {
  const { controller } = harness({ status: () => jsonRes(INACTIVE) });
  await controller.checkStatus(SESSION_A);
  assert.equal(controller.getView(), "inactive");
  assert.equal(controller.getStartGuard(), "none");
  assert.equal(controller.getState(), "idle");
});

// ---------------------------------------------------------------- 5. unknown is never inactive
test("F1-5: while status is loading the state is UNKNOWN (not inactive) and Start needs confirmation", async () => {
  const gate = deferred();
  const { controller, log } = harness({ status: () => gate.promise });
  const pending = controller.checkStatus(SESSION_A);
  assert.equal(controller.getView(), "loading");
  assert.equal(controller.getStatusKnowledge(), "checking");
  assert.equal(controller.getStartGuard(), "status-unknown");
  const attempt = await controller.start(SESSION_A); // unconfirmed
  assert.deepEqual(attempt, { ok: false, needsConfirmation: true, reason: "STATUS_UNKNOWN" });
  assert.equal(log.windowOpens, 0, "no popup while the outcome is unknown and unconfirmed");
  assert.equal(log.fetches.filter((f) => f.path === "/projections/start").length, 0);
  gate.resolve(jsonRes(INACTIVE));
  await pending;
});

test("F1-5b: a controller built to require known status treats 'never checked' as UNKNOWN", async () => {
  const { controller, log } = harness();
  assert.equal(controller.getView(), "unknown");
  assert.equal(controller.getStartGuard(), "status-unknown");
  const attempt = await controller.start(SESSION_A);
  assert.equal(attempt.needsConfirmation, true);
  assert.equal(log.windowOpens, 0);
});

// ---------------------------------------------------------------- 6. failures keep Close + warn
const FAILURES = {
  "network failure": () => { throw new Error("fetch failed"); },
  "HTTP 500 INTERNAL": () => jsonRes({ error: { code: "INTERNAL", message: "x" } }, false, 500),
  "HTTP 401 UNAUTHENTICATED": () => jsonRes({ error: { code: "UNAUTHENTICATED", message: "x" } }, false, 401),
  "HTTP 403 FORBIDDEN": () => jsonRes({ error: { code: "FORBIDDEN", message: "x" } }, false, 403),
  "HTTP 502 with a non-JSON body": () => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } }),
  "200 with a non-object body": () => jsonRes("nope"),
  "200 with null body": () => jsonRes(null),
  "200 with missing active": () => jsonRes({ startedAtMs: 1, expiresAtMs: 2 }),
  "200 with active as a string": () => jsonRes({ active: "true", startedAtMs: 1, expiresAtMs: 2 }),
  "200 active:true without timestamps": () => jsonRes({ active: true, startedAtMs: null, expiresAtMs: null }),
  "200 active:true with inverted timestamps": () => jsonRes({ active: true, startedAtMs: 5, expiresAtMs: 3 }),
  "200 active:false with non-null timestamps": () => jsonRes({ active: false, startedAtMs: 1, expiresAtMs: 2 }),
};
for (const [label, status] of Object.entries(FAILURES)) {
  test(`F1-6: status failure (${label}) is UNKNOWN — never shown as inactive; Close stays available; Start needs a replacement warning`, async () => {
    const { controller, log } = harness({ status });
    const result = await controller.checkStatus(SESSION_A);
    assert.equal(result.ok, false);
    assert.equal(controller.getView(), "unknown");
    assert.equal(controller.getStatusKnowledge(), "unavailable");
    assert.notEqual(controller.getView(), "inactive");
    assert.equal(controller.getStartGuard(), "status-unknown");
    const attempt = await controller.start(SESSION_A);
    assert.equal(attempt.needsConfirmation, true, "the replacement warning cannot be bypassed");
    assert.equal(attempt.reason, "STATUS_UNKNOWN");
    assert.equal(log.windowOpens, 0);
    // Close is still usable as a persistent revoke control and is not affected by the status failure.
    const closeRes = await controller.close(SESSION_A);
    assert.equal(closeRes.ok, true);
    assert.equal(log.fetches.filter((f) => f.path === "/projections/close").length, 1);
  });
}

test("F1-6b: a status request that never answers times out into UNKNOWN (timer injected, no real wait)", async () => {
  const timers = [];
  const cleared = [];
  const never = new Promise(() => {});
  const { controller } = harness({
    status: () => never,
    controllerOptions: {
      statusTimeoutMs: 1234,
      setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeoutImpl: (h) => cleared.push(h),
    },
  });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1234);
  assert.equal(controller.getView(), "loading");
  timers[0].fn(); // the timeout fires
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, "TIMEOUT");
  assert.equal(controller.getView(), "unknown");
  assert.equal(controller.getStartGuard(), "status-unknown");
  assert.equal(STATUS_TIMEOUT_MS, 8000, "the production default is a bounded 8 s");
});

test("F1-6c: a hanging ID-token retrieval also times out instead of leaving the UI loading forever", async () => {
  const timers = [];
  const controller = createClassroomLaunchController({
    windowOpenImpl: () => ({ location: {}, close() {} }),
    fetchImpl: async () => jsonRes(INACTIVE),
    getIdToken: () => new Promise(() => {}),
    requireKnownStatus: true,
    setTimeoutImpl: (fn) => { timers.push(fn); return 1; },
    clearTimeoutImpl: () => {},
  });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  timers[0]();
  assert.equal((await pending).code, "TIMEOUT");
  assert.equal(controller.getView(), "unknown");
});

test("F1-6d: a retry after a failed check can recover to a known state", async () => {
  let n = 0;
  const { controller } = harness({ status: () => (++n === 1 ? jsonRes({}, false, 500) : jsonRes(ACTIVE)) });
  await controller.checkStatus(SESSION_A);
  assert.equal(controller.getView(), "unknown");
  await controller.checkStatus(SESSION_A);
  assert.equal(controller.getView(), "active");
});

test("F1-6e: parseStatusResponse is strict: only the accepted shapes are understood", () => {
  assert.deepEqual(parseStatusResponse(ACTIVE), { active: true });
  assert.deepEqual(parseStatusResponse(INACTIVE), { active: false });
  for (const bad of [undefined, null, 0, "x", [], {}, { active: 1 }, { active: true }, { active: false, startedAtMs: 0, expiresAtMs: null }, { active: true, startedAtMs: Infinity, expiresAtMs: 1 }]) {
    assert.equal(parseStatusResponse(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// ---------------------------------------------------------------- 7. confirmation after refresh
test("F1-7: after a Teaching refresh, an active server-side projection still requires explicit confirmation before replacement", async () => {
  const { controller, log } = harness({ status: () => jsonRes(ACTIVE) });
  await controller.checkStatus(SESSION_A);
  assert.equal(controller.getStartGuard(), "replace-active");
  const unconfirmed = await controller.start(SESSION_A);
  assert.deepEqual(unconfirmed, { ok: false, needsConfirmation: true });
  assert.equal(log.windowOpens, 0);
  assert.equal(log.fetches.filter((f) => f.path === "/projections/start").length, 0);
  const confirmed = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(log.fetches.filter((f) => f.path === "/projections/start").length, 1);
});

// ---------------------------------------------------------------- 8. popup synchronous
test("F1-8: window.open runs synchronously inside start(), before ANY await — after a status check too", async () => {
  for (const status of [() => jsonRes(INACTIVE), () => jsonRes(ACTIVE), () => jsonRes({}, false, 500)]) {
    const { controller, log } = harness({ status });
    await controller.checkStatus(SESSION_A);
    log.events.length = 0;
    const pending = controller.start(SESSION_A, { confirmed: true }); // no await yet
    // doStart() is an async function: its first statement (the getIdToken() CALL) legitimately runs
    // synchronously after window.open, before its first await suspends. What must hold is that the
    // popup is the very first effect and that no network request has been sent yet.
    assert.equal(log.events[0], "windowOpen", "the popup must be the first effect of start()");
    assert.equal(log.events.filter((e) => e.startsWith("fetch:")).length, 0, "no request may be sent before the first await");
    await pending;
    assert.ok(log.events.indexOf("windowOpen") < log.events.indexOf("getIdToken"));
    assert.ok(log.events.indexOf("windowOpen") < log.events.indexOf("fetch:/projections/start"));
  }
});

// ---------------------------------------------------------------- 9. blocked popup
test("F1-9: a blocked popup makes NO Start request, requests no token, and leaves an existing projection untouched", async () => {
  const { controller, log } = harness({ status: () => jsonRes(ACTIVE), popup: false });
  await controller.checkStatus(SESSION_A);
  const tokensBefore = log.tokens;
  const fetchesBefore = log.fetches.length;
  const result = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "POPUP_BLOCKED");
  assert.equal(result.popupBlocked, true);
  assert.equal(log.tokens, tokensBefore, "no ID token requested after a blocked popup");
  assert.equal(log.fetches.length, fetchesBefore, "no request at all after a blocked popup");
  assert.equal(controller.getView(), "active", "the existing grant is still shown as active");
  assert.equal(controller.getState(), "active");
});

test("F1-9b: a blocked popup in the UNKNOWN state also sends nothing and stays UNKNOWN", async () => {
  const { controller, log } = harness({ status: () => jsonRes({}, false, 500), popup: false });
  await controller.checkStatus(SESSION_A);
  const before = log.fetches.length;
  const result = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(result.code, "POPUP_BLOCKED");
  assert.equal(log.fetches.length, before);
  assert.equal(controller.getView(), "unknown");
});

// ---------------------------------------------------------------- 10. close after refresh
test("F1-10: Close after a refresh needs no projectionSessionId/bootstrap token and sends exactly {knowledgeSessionId}", async () => {
  const { controller, log } = harness({ status: () => jsonRes(ACTIVE) });
  await controller.checkStatus(SESSION_A);
  assert.equal(controller.getProjectionSessionId(), null);
  const result = await controller.close(SESSION_A);
  assert.deepEqual(result, { ok: true, closed: true });
  const closeReq = log.fetches.find((f) => f.path === "/projections/close");
  assert.equal(closeReq.url, `${CLASSROOM_ORIGIN}/projections/close`);
  assert.deepEqual(JSON.parse(closeReq.init.body), { knowledgeSessionId: SESSION_A.id });
  assert.deepEqual(Object.keys(JSON.parse(closeReq.init.body)), ["knowledgeSessionId"]);
  assert.equal(closeReq.init.headers.Authorization, "Bearer synthetic-teacher-id-token");
  assert.equal(controller.getView(), "inactive", "the confirmed Close result defines the state");
  assert.equal(controller.getStartGuard(), "none");
});

test("F1-10b: a failed Close keeps the previous (active) knowledge so Close can be retried", async () => {
  let n = 0;
  const { controller } = harness({ status: () => jsonRes(ACTIVE), close: () => (++n === 1 ? jsonRes({ error: { code: "FORBIDDEN", message: "x" } }, false, 403) : jsonRes({ closed: true })) });
  await controller.checkStatus(SESSION_A);
  assert.equal((await controller.close(SESSION_A)).ok, false);
  assert.equal(controller.getView(), "active");
  assert.equal((await controller.close(SESSION_A)).ok, true);
  assert.equal(controller.getView(), "inactive");
});

// ---------------------------------------------------------------- 11. stale responses
test("F1-11a: a status response that arrives AFTER a successful Close cannot overwrite it", async () => {
  const gate = deferred();
  let first = true;
  const { controller } = harness({ status: () => { if (first) { first = false; return gate.promise; } return jsonRes(INACTIVE); } });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  const closed = await controller.close(SESSION_A);
  assert.equal(closed.ok, true);
  assert.equal(controller.getView(), "inactive");
  gate.resolve(jsonRes(ACTIVE)); // the older, now-wrong answer
  const late = await pending;
  assert.deepEqual(late, { ok: true, stale: true });
  assert.equal(controller.getView(), "inactive", "stale active:true must not resurrect a closed projection");
});

test("F1-11b: a status response that arrives AFTER a successful Start cannot overwrite it", async () => {
  const gate = deferred();
  const { controller } = harness({ status: () => gate.promise });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  const started = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(started.ok, true);
  assert.equal(controller.getView(), "active");
  gate.resolve(jsonRes(INACTIVE)); // older answer says nothing is active
  assert.equal((await pending).stale, true);
  assert.equal(controller.getView(), "active", "stale active:false must not hide the newly started projection");
  assert.equal(controller.getProjectionSessionId(), "synthetic-proj-001");
});

test("F1-11c: of two overlapping status checks only the newest is applied", async () => {
  const g1 = deferred();
  const g2 = deferred();
  const gates = [g1, g2];
  const { controller } = harness({ status: () => gates.shift().promise });
  const p1 = controller.checkStatus(SESSION_A);
  await tick();
  const p2 = controller.checkStatus(SESSION_A);
  await tick();
  g2.resolve(jsonRes(ACTIVE));
  assert.deepEqual(await p2, { ok: true, active: true });
  g1.resolve(jsonRes(INACTIVE)); // older, resolves last
  assert.equal((await p1).stale, true);
  assert.equal(controller.getView(), "active");
});

test("F1-11d: a disposed controller (dashboard left/replaced) ignores late status responses", async () => {
  const gate = deferred();
  const { controller } = harness({ status: () => gate.promise });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  controller.dispose();
  gate.resolve(jsonRes(ACTIVE));
  assert.equal((await pending).stale, true);
  assert.notEqual(controller.getView(), "active");
  const attempt = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, "DISPOSED");
});

test("F1-11e: a controller bound to session A refuses session B — no request, no popup, no state change", async () => {
  const { controller, log } = harness({ status: () => jsonRes(ACTIVE) });
  await controller.checkStatus(SESSION_A);
  const before = log.fetches.length;
  for (const op of [() => controller.checkStatus(SESSION_B), () => controller.start(SESSION_B, { confirmed: true }), () => controller.close(SESSION_B)]) {
    const r = await op();
    assert.equal(r.ok, false);
    assert.equal(r.code, "SESSION_MISMATCH");
  }
  assert.equal(log.fetches.length, before);
  assert.equal(log.windowOpens, 0);
  assert.equal(controller.getView(), "active");
});

test("F1-11f: two independent controllers (two dashboards) never share status", async () => {
  const a = harness({ status: () => jsonRes(ACTIVE) });
  const b = harness({ status: () => jsonRes(INACTIVE) });
  await Promise.all([a.controller.checkStatus(SESSION_A), b.controller.checkStatus(SESSION_B)]);
  assert.equal(a.controller.getView(), "active");
  assert.equal(b.controller.getView(), "inactive");
});

test("F1-11g: a status check that was made obsolete by a Start which then FAILS cannot leave the controller stuck in 'checking'", async () => {
  const gate = deferred();
  const { controller } = harness({ status: () => gate.promise, start: () => jsonRes({ error: { code: "FORBIDDEN", message: "x" } }, false, 403) });
  const pending = controller.checkStatus(SESSION_A);
  await tick();
  const result = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(result.code, "FORBIDDEN");
  assert.equal(controller.getView(), "unknown", "obsolete check + failed Start => UNKNOWN (Close/retry available), not a permanent spinner");
  gate.resolve(jsonRes(INACTIVE));
  await pending;
  assert.equal(controller.getView(), "unknown", "the obsolete answer must still be ignored");
});

test("F1-11h: checkStatus during an in-flight Start/Close is skipped; the operation's own result wins", async () => {
  const gate = deferred();
  const { controller, count } = harness({ start: () => gate.promise });
  const starting = controller.start(SESSION_A, { confirmed: true });
  const skipped = await controller.checkStatus(SESSION_A);
  assert.deepEqual(skipped, { ok: true, skipped: true });
  assert.equal(count("/projections/status"), 0);
  gate.resolve(jsonRes(START_OK));
  assert.equal((await starting).ok, true);
  assert.equal(controller.getView(), "active");
});

// ---------------------------------------------------------------- start/close outcome tracking
test("F1-12a: a confirmed successful Start defines the state (active) without needing another status call", async () => {
  const { controller, count } = harness({ status: () => jsonRes(INACTIVE) });
  await controller.checkStatus(SESSION_A);
  const r = await controller.start(SESSION_A);
  assert.equal(r.ok, true);
  assert.equal(controller.getView(), "active");
  assert.equal(count("/projections/status"), 1);
});

test("F1-12b: an AMBIGUOUS Start failure (network) flags a status re-check and is UNKNOWN, not inactive", async () => {
  const { controller } = harness({ status: () => jsonRes(INACTIVE), start: () => { throw new Error("connection reset"); } });
  await controller.checkStatus(SESSION_A);
  const r = await controller.start(SESSION_A);
  assert.equal(r.code, "NETWORK");
  assert.equal(r.recheckStatus, true);
  assert.equal(controller.getView(), "unknown", "the request may have reached the server");
  assert.equal(controller.getState(), "idle");
});

test("F1-12c: a DEFINITIVE Start rejection restores the previous knowledge (an old active grant stays active)", async () => {
  const { controller } = harness({ status: () => jsonRes(ACTIVE), start: () => jsonRes({ error: { code: "FORBIDDEN", message: "x" } }, false, 403) });
  await controller.checkStatus(SESSION_A);
  const r = await controller.start(SESSION_A, { confirmed: true });
  assert.equal(r.code, "FORBIDDEN");
  assert.equal(r.recheckStatus, undefined);
  assert.equal(controller.getView(), "active");
  assert.equal(controller.getState(), "active");
});

test("F1-12d: an invalid bootstrapUrl (server accepted the Start) flags a re-check instead of claiming inactive", async () => {
  const { controller, log } = harness({ status: () => jsonRes(INACTIVE), start: () => jsonRes({ bootstrapUrl: "https://evil.example/classroom/bootstrap?b=x", projectionSessionId: "p" }) });
  await controller.checkStatus(SESSION_A);
  const r = await controller.start(SESSION_A);
  assert.equal(r.code, "INVALID_BOOTSTRAP_URL");
  assert.equal(r.recheckStatus, true);
  assert.equal(controller.getView(), "unknown");
  assert.equal(log.closedWindows, 1);
});

// ---------------------------------------------------------------- 12. visibility (unchanged)
test("F1-13: owner/admin, non-owner, deleted-session and OPEN/CLOSED visibility rules are unchanged", () => {
  const open = { ...SESSION_A, status: "open" };
  const closed = { ...SESSION_A, status: "closed" };
  assert.equal(canLaunchClassroomProjection({ session: open, isAdminView: false, actorUid: "owner-uid-001" }), true);
  assert.equal(canLaunchClassroomProjection({ session: closed, isAdminView: false, actorUid: "owner-uid-001" }), true);
  assert.equal(canLaunchClassroomProjection({ session: open, isAdminView: true, actorUid: "some-admin" }), true);
  assert.equal(canLaunchClassroomProjection({ session: closed, isAdminView: true, actorUid: "some-admin" }), true);
  assert.equal(canLaunchClassroomProjection({ session: open, isAdminView: false, actorUid: "another-teacher" }), false);
  assert.equal(canLaunchClassroomProjection({ session: closed, isAdminView: false, actorUid: "another-teacher" }), false);
  for (const flag of ["teacherDeletedAt", "adminDeletedAt", "adminDeleting", "deletingAt"]) {
    assert.equal(canLaunchClassroomProjection({ session: { ...open, [flag]: true }, isAdminView: true, actorUid: "a" }), false, flag);
    assert.equal(canLaunchClassroomProjection({ session: { ...open, [flag]: true }, isAdminView: false, actorUid: "owner-uid-001" }), false, flag);
  }
  assert.equal(canLaunchClassroomProjection({ session: null, isAdminView: true, actorUid: "a" }), false);
});

// ---------------------------------------------------------------- 13. no browser storage / secrets kept
test("F1-14: no browser storage is touched at runtime and no token/cookie/projection id is retained or exposed", async () => {
  const touched = [];
  const trap = (name) => new Proxy({}, { get(_, prop) { touched.push(`${name}.${String(prop)}`); return () => {}; }, set() { touched.push(`${name}=`); return true; } });
  const saved = {};
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "document"]) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: trap(name), configurable: true, writable: true });
  }
  try {
    const { controller } = harness({ status: () => jsonRes(ACTIVE) });
    await controller.checkStatus(SESSION_A);
    const started = await controller.start(SESSION_A, { confirmed: true });
    await controller.checkStatus(SESSION_A);
    await controller.close(SESSION_A);
    assert.equal(started.bootstrapUrl, undefined, "the bootstrap URL/token is never returned to the caller");
    const exposed = JSON.stringify({ s: controller.getState(), k: controller.getStatusKnowledge(), v: controller.getView(), g: controller.getStartGuard(), p: controller.getProjectionSessionId(), started });
    assert.ok(!exposed.includes("synthetic-token"), "the bootstrap token is never retained");
    assert.ok(!exposed.includes("synthetic-teacher-id-token"), "the ID token is never retained");
  } finally {
    for (const [name, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name];
    }
  }
  assert.deepEqual(touched, [], `browser storage / document must never be touched, saw: ${touched.join(", ")}`);
});

test("F1-14b: SOURCE — the module has no reference to any browser storage or cookie API", () => {
  const src = fs.readFileSync(new URL("../../classroom-projection-launch.mjs", import.meta.url), "utf8");
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "caches."]) {
    assert.ok(!src.includes(forbidden), `module must not reference ${forbidden}`);
  }
});

test("F1-14c: SOURCE — Start/Close/bootstrap contracts are untouched (exact request bodies, exact bootstrap validation)", async () => {
  const mod = await import("../../classroom-projection-launch.mjs");
  assert.deepEqual(mod.buildStartRequestBody({ knowledgeSessionId: "a", idempotencyKey: "b" }), { knowledgeSessionId: "a", idempotencyKey: "b" });
  assert.deepEqual(mod.buildCloseRequestBody({ knowledgeSessionId: "a" }), { knowledgeSessionId: "a" });
  assert.equal(mod.validateBootstrapUrl("https://classroom.quantth.vn/classroom/bootstrap?b=t"), true);
  assert.equal(mod.validateBootstrapUrl("https://classroom.quantth.vn.evil.example/classroom/bootstrap?b=t"), false);
});
