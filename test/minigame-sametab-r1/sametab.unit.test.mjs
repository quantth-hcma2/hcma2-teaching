// MINI GAME SAME-TAB R1 - unit tests (pure, no browser, no network): click intent (one use, 2 minutes, allow-listed origin only),
// auto-continue only after a card click in THIS tab, confirmation otherwise, intent always erased, same-tab card markup.
import test from "node:test";
import assert from "node:assert/strict";
import { INTENT_TTL_MS, rememberMiniGameIntent, takeMiniGameIntent, armMiniGameSameTab, startMiniGameSsoIfRequested } from "../../mini-game-sso.mjs";
import { renderMiniGameHubHtml, MINI_GAME_ALLOWED_ORIGINS } from "../../mini-game-registry.mjs";

const MG = MINI_GAME_ALLOWED_ORIGINS[0];
const S = "A".repeat(43), C = "B".repeat(43), CODE = "C".repeat(43);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("intent: recorded only for an allow-listed Mini Game origin; holds ONLY origin + time (no user data)", () => {
  const st = memStorage();
  assert.equal(rememberMiniGameIntent(st, "https://evil.example/sso/begin"), false);
  assert.equal(st.m.size, 0);
  assert.equal(rememberMiniGameIntent(st, MG + "/sso/begin", undefined, 1000), true);
  assert.deepEqual(JSON.parse([...st.m.values()][0]), { origin: MG, at: 1000 });
  assert.equal(rememberMiniGameIntent(null, MG + "/sso/begin"), false);
  assert.equal(rememberMiniGameIntent(st, "not a url"), false);
});

test("intent: one use, expires after 2 minutes, must match the requesting origin, garbage is rejected and erased", () => {
  const st = memStorage();
  rememberMiniGameIntent(st, MG + "/sso/begin", undefined, 10_000);
  assert.equal(takeMiniGameIntent(st, MG, 10_000 + INTENT_TTL_MS), true);
  assert.equal(takeMiniGameIntent(st, MG, 10_001), false, "used once");
  rememberMiniGameIntent(st, MG + "/sso/begin", undefined, 0);
  assert.equal(takeMiniGameIntent(st, MG, INTENT_TTL_MS + 1), false, "expired");
  assert.equal(st.m.size, 0, "erased even when expired");
  rememberMiniGameIntent(st, MG + "/sso/begin", undefined, 0);
  assert.equal(takeMiniGameIntent(st, "https://other.example", 1), false, "other origin");
  st.setItem("hcma2.miniGameSsoIntent", "{bad json");
  assert.equal(takeMiniGameIntent(st, MG, 1), false);
  st.setItem("hcma2.miniGameSsoIntent", JSON.stringify({ origin: MG, at: 5000 }));
  assert.equal(takeMiniGameIntent(st, MG, 4000), false, "time in the future is rejected");
  assert.equal(st.m.size, 0);
});

// --- fake DOM just big enough for the module
function fakeDoc() {
  const listeners = [];
  const nodes = new Map();
  const mk = (tag) => {
    const el = { tag, id: "", attrs: {}, style: {}, children: [], hidden: false, disabled: false, textContent: "", innerHTML: "",
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
      remove() { if (this.id) nodes.delete(this.id); doc.removed.push(this.id); },
      querySelector(sel) { this._q ||= {}; return (this._q[sel] ||= mk("q")); } };
    return el;
  };
  const doc = {
    removed: [],
    body: { appendChild(el) { if (el.id) nodes.set(el.id, el); } },
    createElement: mk,
    getElementById: (id) => nodes.get(id) || null,
    addEventListener: (t, fn, cap) => listeners.push({ t, fn, cap }),
    click(target) { for (const l of listeners) if (l.t === "click") l.fn({ target }); },
  };
  return doc;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function deps(extra = {}) {
  const calls = [];
  const loc = { search: `?mg_sso_state=${S}&mg_sso_challenge=${C}&mg_sso_return=${encodeURIComponent(MG)}`, pathname: "/", hash: "", replaced: null, replace(u) { this.replaced = u; } };
  const d = {
    location: loc, history: { replaceState: () => {} }, esc, document: fakeDoc(), window: { addEventListener() {} },
    profile: { status: "active", role: "teacher", displayName: "GV", email: "gv@example.test" },
    getIdToken: async () => "header.payload.sig", storage: memStorage(),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ code: CODE }) }; },
    ...extra,
  };
  return { d, calls, loc };
}

test("card click in THIS tab = confirmation: the code is requested at once (token only in the Authorization header) and the tab is replaced", async () => {
  const { d, calls, loc } = deps();
  armMiniGameSameTab({ document: d.document, storage: d.storage, window: d.window });
  d.document.click({ closest: () => ({ getAttribute: () => MG + "/sso/begin" }) });
  const p = startMiniGameSsoIfRequested(d);
  await flush(); await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, MG + "/api/sso/issue");
  assert.equal(calls[0].init.headers.Authorization, "Bearer header.payload.sig");
  assert.equal(calls[0].init.credentials, "omit");
  assert.ok(!calls[0].url.includes("payload"));
  assert.equal(loc.replaced, `${MG}/sso/callback?code=${CODE}&state=${S}`);
  assert.deepEqual(await p, { status: "redirected" });
  assert.equal(d.storage.m.size, 0, "intent consumed");
});

test("no card click (e.g. Mini Game login button, another site): NOTHING is sent until the user confirms", async () => {
  const { d, calls } = deps();
  void startMiniGameSsoIfRequested(d);
  await flush(); await flush();
  assert.equal(calls.length, 0);
  assert.ok(d.document.getElementById("mgSsoOverlay"), "confirmation dialog shown");
});

test("intent is erased even when the request is invalid or the account is not eligible; nothing is sent", async () => {
  for (const extra of [{ profile: { status: "pending", role: "teacher" } }, { profile: { status: "suspended", role: "teacher" } }, { profile: { status: "active", role: "student" } }]) {
    const { d, calls } = deps(extra);
    rememberMiniGameIntent(d.storage, MG + "/sso/begin");
    assert.equal((await startMiniGameSsoIfRequested(d)).status, "ineligible");
    assert.equal(calls.length, 0);
    assert.equal(d.storage.m.size, 0);
  }
  const { d, calls, loc } = deps();
  loc.search = `?mg_sso_state=${S}&mg_sso_challenge=${C}&mg_sso_return=${encodeURIComponent("https://evil.example")}`;
  rememberMiniGameIntent(d.storage, MG + "/sso/begin");
  assert.equal((await startMiniGameSsoIfRequested(d)).status, "invalid");
  assert.equal(calls.length, 0);
  assert.equal(d.storage.m.size, 0);
});

test("no SSO request in the address: nothing happens, the intent stays for the coming arrival", async () => {
  const { d, calls, loc } = deps();
  loc.search = "";
  rememberMiniGameIntent(d.storage, MG + "/sso/begin");
  assert.equal((await startMiniGameSsoIfRequested(d)).status, "none");
  assert.equal(calls.length, 0);
  assert.equal(d.storage.m.size, 1);
});

test("storage unavailable (privacy mode): falls back to the confirmation dialog", async () => {
  const { d, calls } = deps({ storage: null });
  void startMiniGameSsoIfRequested(d);
  await flush(); await flush();
  assert.equal(calls.length, 0);
  assert.ok(d.document.getElementById("mgSsoOverlay"));
});

test("card markup: same tab (no target), rel=noreferrer + no-referrer policy, explains same tab and the way back", () => {
  const html = renderMiniGameHubHtml(esc);
  const a = (html.match(/<a [^>]*>/g) || [])[0];
  assert.ok(a && !a.includes("target=") && a.includes('rel="noreferrer"') && a.includes('referrerpolicy="no-referrer"'));
  assert.ok(/tab này/.test(html) && /Quay về HCMA2 Teaching/.test(html));
  assert.ok(!/tab mới|_blank/.test(html));
});
