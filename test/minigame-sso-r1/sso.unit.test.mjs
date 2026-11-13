// MINI GAME SSO R1 - pure unit tests for mini-game-sso.mjs (no DOM, no network).
// Run: node --test test/minigame-sso-r1/sso.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readMiniGameSsoRequest, cleanedUrl, eligible, startMiniGameSsoIfRequested } from "../../mini-game-sso.mjs";

const OK_ORIGIN = "https://hcma2-interactive.hcma2-interactive-v1.workers.dev";
const S = "A".repeat(43), C = "b".repeat(43);
const q = (o) => "?" + new URLSearchParams(o).toString();

test("request: valid only with 43-char base64url state + challenge and an ALLOW-LISTED return origin", () => {
  assert.equal(readMiniGameSsoRequest(""), null);
  assert.equal(readMiniGameSsoRequest("?foo=1"), null);
  assert.deepEqual(readMiniGameSsoRequest(q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN })), { state: S, challenge: C, returnOrigin: OK_ORIGIN });
  for (const bad of [
    { mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: "https://evil.example" },
    { mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN + "/" },
    { mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: "http://hcma2-interactive.hcma2-interactive-v1.workers.dev" },
    { mg_sso_state: S, mg_sso_challenge: C },
    { mg_sso_state: "short", mg_sso_challenge: C, mg_sso_return: OK_ORIGIN },
    { mg_sso_state: S, mg_sso_challenge: C + "x", mg_sso_return: OK_ORIGIN },
    { mg_sso_state: S.slice(0, 42) + "/", mg_sso_challenge: C, mg_sso_return: OK_ORIGIN }
  ]) assert.deepEqual(readMiniGameSsoRequest(q(bad)), { invalid: true }, JSON.stringify(bad));
});

test("cleanedUrl removes ONLY the SSO parameters and keeps path, other query and hash", () => {
  assert.equal(cleanedUrl({ pathname: "/", search: q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN }), hash: "" }), "/");
  assert.equal(cleanedUrl({ pathname: "/index.html", search: "?emulator=1&mg_sso_state=" + S, hash: "#/live/x" }), "/index.html?emulator=1#/live/x");
});

test("eligible: only ACTIVE teacher or admin (the Mini Game server re-checks Firestore anyway)", () => {
  assert.equal(eligible({ role: "teacher", status: "active" }), true);
  assert.equal(eligible({ role: "admin", status: "active" }), true);
  for (const p of [null, {}, { role: "teacher", status: "pending" }, { role: "teacher", status: "suspended" }, { role: "student", status: "active" }]) assert.equal(eligible(p), false);
});

test("no SSO request -> nothing happens (no DOM, no token, no network)", async () => {
  let touched = false;
  const r = await startMiniGameSsoIfRequested({
    location: { search: "", pathname: "/", hash: "" },
    history: { replaceState: () => (touched = true) },
    getIdToken: () => { touched = true; return Promise.resolve("x"); },
    fetchImpl: () => { touched = true; return Promise.resolve(); },
    document: {},
    profile: { role: "teacher", status: "active" },
    esc: String
  });
  assert.deepEqual(r, { status: "none" });
  assert.equal(touched, false);
});

// minimal fake document for the dialog paths
function fakeDoc() {
  const nodes = [];
  return {
    nodes,
    getElementById: () => null,
    createElement: () => {
      const el = { style: {}, attrs: {}, innerHTML: "", setAttribute(k, v) { this.attrs[k] = v; }, remove() { el.removed = true; }, querySelector(sel) {
        el._q = el._q || {};
        return (el._q[sel] = el._q[sel] || { disabled: false, textContent: "", onclick: null });
      } };
      return el;
    },
    body: { appendChild: (el) => nodes.push(el) }
  };
}

test("invalid / foreign return origin: URL cleaned, error dialog, and the ID token is NEVER requested or sent", async () => {
  const doc = fakeDoc();
  let replaced = null, tokenAsked = false, fetched = false;
  const r = await startMiniGameSsoIfRequested({
    location: { search: q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: "https://evil.example" }), pathname: "/", hash: "" },
    history: { replaceState: (_a, _b, u) => (replaced = u) },
    getIdToken: () => { tokenAsked = true; return Promise.resolve("t"); },
    fetchImpl: () => { fetched = true; return Promise.resolve(); },
    document: doc,
    profile: { role: "teacher", status: "active" },
    esc: String
  });
  assert.equal(r.status, "invalid");
  assert.equal(replaced, "/");
  assert.equal(tokenAsked || fetched, false);
  assert.match(doc.nodes[0].innerHTML, /không hợp lệ/);
});

test("ineligible profile: dialog explains, no token, no request", async () => {
  const doc = fakeDoc();
  let tokenAsked = false;
  const r = await startMiniGameSsoIfRequested({
    location: { search: q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN }), pathname: "/", hash: "" },
    history: { replaceState() {} },
    getIdToken: () => { tokenAsked = true; return Promise.resolve("t"); },
    fetchImpl: () => Promise.reject(new Error("must not be called")),
    document: doc,
    profile: { role: "teacher", status: "pending" },
    esc: String
  });
  assert.equal(r.status, "ineligible");
  assert.equal(tokenAsked, false);
});

test("confirm: token ONLY in the Authorization header to <allow-listed origin>/api/sso/issue (no cookies, no referrer); then navigates to /sso/callback with the one-time code; cancel does nothing", async () => {
  const doc = fakeDoc();
  const calls = [];
  let navigated = null;
  const location = { search: q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN }), pathname: "/", hash: "", replace: (u) => (navigated = u) };
  const p = startMiniGameSsoIfRequested({
    location,
    history: { replaceState() {} },
    getIdToken: () => Promise.resolve("ID.TOKEN.SIG"),
    fetchImpl: (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ code: "c".repeat(43) }) }); },
    document: doc,
    profile: { role: "teacher", status: "active", displayName: "Giảng viên <b>X</b>" },
    esc: (s) => String(s).replace(/</g, "&lt;")
  });
  const dlg = doc.nodes[0];
  assert.match(dlg.innerHTML, /Giảng viên &lt;b>X/);
  await dlg.querySelector('[data-mg-sso="go"]').onclick();
  const r = await p;
  assert.equal(r.status, "redirected");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OK_ORIGIN + "/api/sso/issue");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ID.TOKEN.SIG");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(calls[0].init.body), { state: S, challenge: C });
  assert.ok(!calls[0].url.includes("TOKEN"));
  const u = new URL(navigated);
  assert.equal(u.origin + u.pathname, OK_ORIGIN + "/sso/callback");
  assert.equal(u.searchParams.get("code"), "c".repeat(43));
  assert.equal(u.searchParams.get("state"), S);
  assert.ok(!navigated.includes("TOKEN"), "the ID token never appears in a URL");

  const doc2 = fakeDoc();
  let fetched = false;
  const p2 = startMiniGameSsoIfRequested({ location: { ...location, replace: () => assert.fail("must not navigate") }, history: { replaceState() {} }, getIdToken: () => Promise.resolve("t"), fetchImpl: () => { fetched = true; }, document: doc2, profile: { role: "admin", status: "active" }, esc: String });
  doc2.nodes[0].querySelector('[data-mg-sso="cancel"]').onclick();
  assert.deepEqual(await p2, { status: "cancelled" });
  assert.equal(fetched, false);
});

test("server refusal (e.g. pending in Firestore): message shown, no navigation, buttons re-enabled", async () => {
  const doc = fakeDoc();
  let navigated = false;
  startMiniGameSsoIfRequested({
    location: { search: q({ mg_sso_state: S, mg_sso_challenge: C, mg_sso_return: OK_ORIGIN }), pathname: "/", hash: "", replace: () => (navigated = true) },
    history: { replaceState() {} },
    getIdToken: () => Promise.resolve("t"),
    fetchImpl: () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "Tài khoản HCMA2 Teaching đang chờ duyệt" }) }),
    document: doc,
    profile: { role: "teacher", status: "active" },
    esc: String
  });
  const go = doc.nodes[0].querySelector('[data-mg-sso="go"]');
  await go.onclick();
  assert.equal(navigated, false);
  assert.match(doc.nodes[0].querySelector("#mgSsoMsg").textContent, /chờ duyệt/);
  assert.equal(go.disabled, false);
});
