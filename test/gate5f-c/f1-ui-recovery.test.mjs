// GATE 5F.D2.F1 — UI-level tests. These execute the REAL Second Brain card code extracted verbatim
// from index.html (render function, click handlers, status refresh, once-per-mount trigger) inside
// a fake DOM, wired to the REAL controller from classroom-projection-launch.mjs. Nothing here
// re-implements the production logic; if index.html changes, these tests run the changed code.
// Fixtures are synthetic; the protected production Knowledge session is never referenced.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { CLASSROOM_ORIGIN, createClassroomLaunchController } from "../../classroom-projection-launch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8").replace(/\r\n/g, "\n");

// ---- extract the production code under test, verbatim ----
const BLOCK_START = "  function classroomDashCurrent(){";
const BLOCK_END = "  async function aiGateway(path,body){";
const a = html.indexOf(BLOCK_START);
const b = html.indexOf(BLOCK_END);
assert.ok(a > 0 && b > a, "could not locate the Classroom card block in index.html");
const block = html.slice(a, b);
const triggerMatch = html.match(/if\(!classroomStatusRequested&&\$\("#knSecondBrainCard"\)\)\{classroomStatusRequested=true;refreshClassroomStatus\(\);\}\n\s*else renderSecondBrainAction\(\);/);
assert.ok(triggerMatch, "could not locate the once-per-mount status trigger in index.html");

// A "page" = the module-level generation counter + the shared DOM ids, exactly as in the app.
function createPage({ uid = "owner-uid-001", confirmAnswer = true } = {}) {
  const dom = { cardPresent: true, host: null, elements: new Map(), html: "" };
  dom.host = {
    set innerHTML(value) {
      dom.html = value;
      dom.elements = new Map();
      for (const m of value.matchAll(/<(\w+)([^>]*)>/g)) {
        const idm = /\sid="([^"]+)"/.exec(m[2]);
        if (!idm) continue;
        dom.elements.set(idm[1], { id: idm[1], tag: m[1], disabled: /\sdisabled(\s|=|$)/.test(m[2]), onclick: null });
      }
    },
    get innerHTML() { return dom.html; },
  };
  const toasts = [];
  const confirms = [];
  const STATE = { user: { uid } };
  const $ = (sel) => {
    if (sel === "#knSecondBrainCard") return dom.cardPresent ? {} : null;
    if (sel === "#knSecondBrainAction") return dom.cardPresent ? dom.host : null;
    return dom.elements.get(sel.slice(1)) || null;
  };
  const page = { dom, toasts, confirms, STATE, confirmAnswer };
  const make = new Function(
    "$", "toast", "confirm", "STATE", "createMount",
    `let CLASSROOM_DASHBOARD_GEN=0;
     function mountDashboard(env){
       const classroomDashGen=++CLASSROOM_DASHBOARD_GEN;
       let classroomStatusRequested=false;
       const openerUid=env.openerUid;
       const classroomController=env.classroomController;
       let session=env.session;
       ${block}
       return { onSnapshotRender(){ ${triggerMatch[0]} }, renderSecondBrainAction, refreshClassroomStatus, onClassroomStartClick, onClassroomCloseClick };
     }
     return { mountDashboard };`,
  );
  const { mountDashboard } = make($, (msg, kind) => toasts.push({ msg, kind }), (msg) => { confirms.push(msg); return page.confirmAnswer; }, STATE);
  page.mountDashboard = mountDashboard;
  page.text = () => dom.html;
  page.has = (id) => dom.elements.has(id);
  page.click = (id) => {
    const el = dom.elements.get(id);
    assert.ok(el, `element #${id} is not rendered`);
    assert.ok(!el.disabled, `element #${id} is disabled`);
    assert.equal(typeof el.onclick, "function", `element #${id} has no click handler`);
    return el.onclick();
  };
  return page;
}

const jsonRes = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));
const ACTIVE = { active: true, startedAtMs: 1000, expiresAtMs: 1000 + 4 * 3600 * 1000 };
const INACTIVE = { active: false, startedAtMs: null, expiresAtMs: null };
const START_OK = { bootstrapUrl: `${CLASSROOM_ORIGIN}/classroom/bootstrap?b=synthetic-token`, projectionSessionId: "synthetic-proj-001" };
const SESSION = { id: "synthetic-session-A-001", ownerId: "owner-uid-001", status: "open" };

function backend({ status = () => jsonRes(INACTIVE), start = () => jsonRes(START_OK), close = () => jsonRes({ closed: true }), popup = true } = {}) {
  const log = { fetches: [], windowOpens: 0 };
  const controller = createClassroomLaunchController({
    windowOpenImpl: () => { log.windowOpens++; return popup ? { location: { href: null }, close() {} } : null; },
    fetchImpl: async (url, init) => {
      const p = url.slice(CLASSROOM_ORIGIN.length);
      log.fetches.push({ path: p, body: init.body });
      if (p === "/projections/status") return status();
      if (p === "/projections/start") return start();
      if (p === "/projections/close") return close();
      throw new Error("unexpected " + p);
    },
    getIdToken: async () => "synthetic-teacher-id-token",
    requireKnownStatus: true, // identical to index.html's construction (asserted in the source guard below)
  });
  const count = (p) => log.fetches.filter((f) => f.path === p).length;
  return { controller, log, count };
}

async function enter(page, be, session = SESSION) {
  const mount = page.mountDashboard({ openerUid: page.STATE.user.uid, classroomController: be.controller, session });
  mount.onSnapshotRender(); // the first session snapshot: renders the card and starts the status check
  return mount;
}

// ------------------------------------------------------------------ states / labels
test("UI: entering the dashboard shows a clear loading state (Start disabled, no Close) until status arrives", async () => {
  const gate = deferred();
  const page = createPage();
  const be = backend({ status: () => gate.promise });
  await enter(page, be);
  assert.match(page.text(), /Đang kiểm tra trạng thái trình chiếu/);
  assert.ok(page.has("knClassroomStart") && page.dom.elements.get("knClassroomStart").disabled, "Start is disabled while unknown");
  assert.ok(!page.has("knClassroomClose"), "no Close while merely loading");
  assert.doesNotMatch(page.text(), /Phiên chiếu đang hoạt động/, "must not claim anything before the answer arrives");
  gate.resolve(jsonRes(INACTIVE));
  await tick();
});

test("UI: a refreshed dashboard recovers active:true, shows 'Phiên chiếu đang hoạt động' and an authorized Close", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, be);
  await tick();
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
  assert.doesNotMatch(page.text(), /Đang có người xem/, "must not claim to know that anyone is viewing");
  assert.ok(page.has("knClassroomClose"), "Close is offered without any projectionSessionId/bootstrap token");
  assert.ok(page.has("knClassroomStart"), "a deliberate replace/restart control is offered");
  assert.match(page.dom.html, /THAY THẾ/);
});

test("UI: active:false shows the normal Start state only", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes(INACTIVE) });
  await enter(page, be);
  await tick();
  assert.match(page.text(), /TRÌNH CHIẾU SECOND BRAIN/);
  assert.ok(page.has("knClassroomStart") && !page.dom.elements.get("knClassroomStart").disabled);
  assert.ok(!page.has("knClassroomClose"));
  assert.doesNotMatch(page.text(), /Không xác định được trạng thái/);
  assert.doesNotMatch(page.text(), /đang hoạt động/);
});

for (const [label, status] of Object.entries({
  "network failure": () => { throw new Error("offline"); },
  "HTTP 500": () => jsonRes({ error: { code: "INTERNAL", message: "x" } }, false, 500),
  "malformed body": () => jsonRes({ nope: true }),
})) {
  test(`UI: status failure (${label}) shows a persistent Close, a retry, and a generic replacement warning — never the normal inactive state`, async () => {
    const page = createPage();
    const be = backend({ status });
    await enter(page, be);
    await tick();
    assert.match(page.text(), /Không xác định được trạng thái trình chiếu/);
    assert.match(page.text(), /thay thế phiên đó/);
    assert.ok(page.has("knClassroomClose"), "Close must remain available");
    assert.ok(page.has("knClassroomRetry"));
    assert.ok(page.has("knClassroomStart"));
    assert.doesNotMatch(page.text(), /Phiên chiếu đang hoạt động/, "must not falsely claim active either");
  });
}

// ------------------------------------------------------------------ Start guard + popup
test("UI: Start when INACTIVE needs no confirmation and opens the popup synchronously inside the click", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes(INACTIVE) });
  await enter(page, be);
  await tick();
  const fetchesBefore = be.log.fetches.length;
  page.click("knClassroomStart"); // NOT awaited: everything asserted next happened synchronously in the click
  assert.deepEqual(page.confirms, [], "no confirmation for a normal Start");
  assert.equal(be.log.windowOpens, 1, "window.open ran synchronously in the click handler, before any await");
  assert.equal(be.log.fetches.length, fetchesBefore, "no network request has been sent yet at that point");
  await tick(); await tick();
  assert.equal(be.count("/projections/start"), 1);
  assert.deepEqual(JSON.parse(be.log.fetches.find((f) => f.path === "/projections/start").body).knowledgeSessionId, SESSION.id);
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
});

test("UI: Start when server-ACTIVE (after refresh) asks the replacement question first; declining sends nothing and opens nothing", async () => {
  const page = createPage({ confirmAnswer: false });
  const be = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, be);
  await tick();
  const before = be.log.fetches.length;
  page.click("knClassroomStart");
  assert.equal(page.confirms.length, 1);
  assert.match(page.confirms[0], /kết thúc phiên chiếu đang hoạt động/);
  assert.equal(be.log.windowOpens, 0, "declined => no popup");
  await tick();
  assert.equal(be.log.fetches.length, before, "declined => no request");
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
});

test("UI: Start when server-ACTIVE and confirmed opens the popup synchronously after the confirmation, then Starts", async () => {
  const page = createPage({ confirmAnswer: true });
  const be = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, be);
  await tick();
  page.click("knClassroomStart");
  assert.equal(page.confirms.length, 1);
  assert.equal(be.log.windowOpens, 1, "popup opened synchronously in the same click task, before any await");
  await tick(); await tick();
  assert.equal(be.count("/projections/start"), 1);
});

test("UI: Start while status is UNKNOWN shows the generic replacement warning first; declining sends nothing", async () => {
  const page = createPage({ confirmAnswer: false });
  const be = backend({ status: () => jsonRes({}, false, 500) });
  await enter(page, be);
  await tick();
  const before = be.log.fetches.length;
  page.click("knClassroomStart");
  assert.equal(page.confirms.length, 1);
  assert.match(page.confirms[0], /Không xác định được trạng thái trình chiếu/);
  assert.match(page.confirms[0], /kết thúc phiên đó/);
  assert.equal(be.log.windowOpens, 0);
  await tick();
  assert.equal(be.log.fetches.length, before);
});

test("UI: Start while status is UNKNOWN and confirmed: popup is synchronous, warning was shown first", async () => {
  const page = createPage({ confirmAnswer: true });
  const be = backend({ status: () => jsonRes({}, false, 500) });
  await enter(page, be);
  await tick();
  page.click("knClassroomStart");
  assert.equal(page.confirms.length, 1);
  assert.equal(be.log.windowOpens, 1);
  await tick(); await tick();
  assert.equal(be.count("/projections/start"), 1);
});

test("UI: a BLOCKED popup after confirming a replacement makes no Start request and the old projection stays shown as active", async () => {
  const page = createPage({ confirmAnswer: true });
  const be = backend({ status: () => jsonRes(ACTIVE), popup: false });
  await enter(page, be);
  await tick();
  page.click("knClassroomStart");
  await tick(); await tick();
  assert.equal(be.count("/projections/start"), 0, "no Start when the popup was blocked");
  assert.ok(page.toasts.some((t) => t.kind === "err" && /chặn cửa sổ mới/.test(t.msg)), "the popup-blocked message is shown");
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
  assert.ok(page.has("knClassroomClose"));
});

// ------------------------------------------------------------------ Close
test("UI: Close from the UNKNOWN state sends exactly {knowledgeSessionId} and then shows the normal Start state", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes({}, false, 500) });
  await enter(page, be);
  await tick();
  page.click("knClassroomClose");
  await tick(); await tick();
  const req = be.log.fetches.find((f) => f.path === "/projections/close");
  assert.deepEqual(JSON.parse(req.body), { knowledgeSessionId: SESSION.id });
  assert.deepEqual(Object.keys(JSON.parse(req.body)), ["knowledgeSessionId"]);
  assert.match(page.text(), /TRÌNH CHIẾU SECOND BRAIN/);
  assert.ok(!page.has("knClassroomClose"));
  assert.ok(page.toasts.some((t) => t.kind === "ok" && /Đã đóng trình chiếu/.test(t.msg)));
});

test("UI: Close after a refresh (recovered active) uses no projection id and ends in the inactive state", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, be);
  await tick();
  page.click("knClassroomClose");
  await tick(); await tick();
  assert.deepEqual(JSON.parse(be.log.fetches.find((f) => f.path === "/projections/close").body), { knowledgeSessionId: SESSION.id });
  assert.equal(be.count("/projections/status"), 1, "the confirmed Close result defines the state; no probe is needed");
  assert.ok(!page.has("knClassroomClose"));
});

test("UI: the retry control re-queries status (read-only) and can recover to the active state", async () => {
  let n = 0;
  const page = createPage();
  const be = backend({ status: () => (++n === 1 ? jsonRes({}, false, 500) : jsonRes(ACTIVE)) });
  await enter(page, be);
  await tick();
  page.click("knClassroomRetry");
  await tick(); await tick();
  assert.equal(be.count("/projections/status"), 2);
  assert.equal(be.count("/projections/close"), 0, "Close is never used as a status probe");
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
});

test("UI: an ambiguous Start failure (lost response) re-queries status instead of claiming 'inactive'", async () => {
  let statusCalls = 0;
  const page = createPage();
  const be = backend({
    status: () => (++statusCalls === 1 ? jsonRes(INACTIVE) : jsonRes(ACTIVE)),
    start: () => { throw new Error("connection reset"); },
  });
  await enter(page, be);
  await tick();
  page.click("knClassroomStart");
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(be.count("/projections/status"), 2, "a follow-up status query was made after the ambiguous failure");
  assert.match(page.text(), /Phiên chiếu đang hoạt động/, "the server-side grant that the lost response left behind is discovered");
});

// ------------------------------------------------------------------ once per mount / lifecycle
test("UI: status is queried exactly once per dashboard mount, not once per session snapshot", async () => {
  const page = createPage();
  const be = backend({ status: () => jsonRes(INACTIVE) });
  const mount = await enter(page, be);
  await tick();
  mount.onSnapshotRender(); mount.onSnapshotRender(); mount.onSnapshotRender();
  await tick();
  assert.equal(be.count("/projections/status"), 1);
  assert.match(page.text(), /TRÌNH CHIẾU SECOND BRAIN/, "later snapshots still re-render from the controller state");
});

test("UI: a session that renders no launch card (trashed/deleted, non-owner) never queries status", async () => {
  const page = createPage();
  page.dom.cardPresent = false;
  const be = backend({ status: () => jsonRes(ACTIVE) });
  const mount = await enter(page, be);
  mount.onSnapshotRender();
  await tick();
  assert.equal(be.count("/projections/status"), 0);
  assert.equal(page.dom.html, "");
});

test("UI: dashboard RE-ENTRY creates a fresh controller and queries status again", async () => {
  const page = createPage();
  const first = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, first);
  await tick();
  first.controller.dispose(); // what clearListeners() triggers when the dashboard is left
  const second = backend({ status: () => jsonRes(ACTIVE) });
  await enter(page, second);
  await tick();
  assert.equal(first.count("/projections/status"), 1);
  assert.equal(second.count("/projections/status"), 1);
  assert.match(page.text(), /Phiên chiếu đang hoạt động/);
});

test("UI: a late status response from dashboard A cannot alter dashboard B's controls (shared DOM ids, no dispose needed)", async () => {
  const gateA = deferred();
  const page = createPage();
  const beA = backend({ status: () => gateA.promise });
  await enter(page, beA, { id: "synthetic-session-A-001", ownerId: "owner-uid-001" });
  const beB = backend({ status: () => jsonRes(INACTIVE) });
  await enter(page, beB, { id: "synthetic-session-B-002", ownerId: "owner-uid-001" });
  await tick();
  const dashboardBHtml = page.text();
  assert.match(dashboardBHtml, /TRÌNH CHIẾU SECOND BRAIN/);
  assert.ok(!page.has("knClassroomClose"));
  gateA.resolve(jsonRes(ACTIVE)); // A's answer arrives late and says "active"
  await tick(); await tick();
  assert.equal(page.text(), dashboardBHtml, "B's card must be byte-for-byte unchanged by A's late response");
  assert.ok(!page.has("knClassroomClose"));
  assert.equal(beA.controller.getView(), "active", "A's own controller did learn its answer — it just may not render into B's dashboard");
});

test("UI: after an account switch a late response renders nothing", async () => {
  const gate = deferred();
  const page = createPage();
  const be = backend({ status: () => gate.promise });
  await enter(page, be);
  const loadingHtml = page.text();
  page.STATE.user = { uid: "someone-else" };
  gate.resolve(jsonRes(ACTIVE));
  await tick(); await tick();
  assert.equal(page.text(), loadingHtml, "no render for a different signed-in account");
});

// ------------------------------------------------------------------ source guards on index.html
test("SOURCE: the controller is created exactly once per dashboard mount, requires known status, and is disposed on leave", () => {
  assert.equal((html.match(/createClassroomLaunchController\(/g) || []).length, 1);
  assert.match(html, /createClassroomLaunchController\(\{[\s\S]*?requireKnownStatus:true,[\s\S]*?\}\);\n\s*track\(\(\)=>classroomController\.dispose\(\)\);/);
  assert.equal((html.match(/\+\+CLASSROOM_DASHBOARD_GEN/g) || []).length, 1);
  assert.equal((html.match(/getIdToken:\(\)=>auth\.currentUser\.getIdToken\(\)/g) || []).length >= 1, true, "the teacher's own Firebase Auth token is used");
  assert.ok(!/publicAuth/.test(html.slice(html.indexOf("const classroomController"), html.indexOf("const classroomController") + 600)), "never the student publicAuth");
});

test("SOURCE: onClassroomStartClick stays synchronous (non-async, no await) and runClassroomStart calls start() before its first await", () => {
  assert.doesNotMatch(html, /async function onClassroomStartClick/);
  const click = html.match(/function onClassroomStartClick\(\)\{[\s\S]*?\n  \}/)[0];
  assert.ok(!/\bawait\b/.test(click), "no await anywhere in the click handler");
  const run = html.match(/async function runClassroomStart\(confirmed\)\{[\s\S]*?\n  \}/)[0];
  const startCall = run.indexOf("classroomController.start(");
  const firstAwait = run.indexOf("await ");
  assert.ok(startCall > -1 && firstAwait > -1 && startCall < firstAwait, "start() (which opens the popup) is invoked before the first await");
  assert.ok(run.indexOf("renderSecondBrainAction()") > startCall, "no re-render precedes start()");
});

test("SOURCE: wording — 'Phiên chiếu đang hoạt động' is used, 'Đang có người xem' never appears", () => {
  assert.ok(html.includes("Phiên chiếu đang hoạt động"));
  assert.ok(!html.includes("Đang có người xem"));
  assert.ok(!/đang có người xem/i.test(block));
});

test("SOURCE: the Classroom card block persists nothing in browser storage and never reads a cookie", () => {
  const region = html.slice(html.indexOf("const classroomDashGen"), html.indexOf("async function aiGateway(path,body){"));
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "bootstrapUrl", "projectionSessionId"]) {
    assert.ok(!block.includes(forbidden), `card block must not reference ${forbidden}`);
  }
  assert.ok(!region.includes("localStorage") && !region.includes("sessionStorage"));
});

test("SOURCE: the status check never uses Close/Start as a probe", () => {
  const refresh = html.match(/async function refreshClassroomStatus\(\)\{[\s\S]*?\n  \}/)[0];
  assert.match(refresh, /classroomController\.checkStatus\(session\)/);
  assert.ok(!/\.close\(|\.start\(/.test(refresh));
});

test("SCOPE LOCK (F1): the diff against the accepted Gate 5F.C candidate touches only the launch module, index.html and the F1 tests", () => {
  // GATE 5F.D2.G13B — rebuilt on the exact current Teaching production SHA (Gate 5F.D2.G13A.1),
  // not the old, abandoned Gate 5F.C candidate checkpoint.
  const CANDIDATE = "df397955206199aa1fd132e37239a2f86fac0659";
  const changed = execSync(`git diff --name-only ${CANDIDATE}`, { cwd: repoRoot, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  const untracked = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter((l) => l.startsWith("??")).map((l) => l.slice(3).trim());
  const allowed = new Set(["index.html", "classroom-projection-launch.mjs", "test/gate5f-c/f1-status-recovery.test.mjs", "test/gate5f-c/f1-ui-recovery.test.mjs", "test/gate4c-e3/narrow-viewport-hotfix.test.mjs", "test/gate5f-c/source-guard.test.mjs"]);
  for (const f of [...changed, ...untracked.filter((p) => !p.endsWith("/"))]) {
    assert.ok(allowed.has(f), `unexpected file changed outside Gate 5F.D2.F1's scope: ${f}`);
  }
  for (const forbidden of ["firestore.rules", "firestore.rules.production-candidate", "firestore.indexes.json", "package.json", "CNAME"]) {
    assert.ok(!changed.includes(forbidden), `${forbidden} must not change`);
  }
});
