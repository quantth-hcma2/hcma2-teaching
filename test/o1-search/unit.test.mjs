// O1 - pure/unit tests for the Add-Teacher exception search (no Firebase, no DOM).
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEARCH_MIN_CHARS, SEARCH_DISPLAY_COUNT, SEARCH_QUERY_LIMIT, SEARCH_MAX_INPUT, EXCEPTION_SEARCH_PROVENANCE,
  normalizeEmailTerm, createTeacherEmailSearchQuery, classifySearchResult, renderEmailSearchShellHtml, renderEmailSearchResultsHtml,
  createSequenceGuard, addTeacherFromSearch
} from "../../organization-membership-view.mjs";
import { createOrganizationWriteContract } from "../../organization-write-contract.mjs";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SENTINEL = { sentinel: true };
const contract = createOrganizationWriteContract({ serverTimestamp: () => SENTINEL });
const activeOrg = { id: "orgX", name: "Khoa <Quản trị>", code: "khoa-qt", status: "active" };
const archivedOrg = { ...activeOrg, status: "archived" };
const user = (id, extra = {}) => ({ id, role: "teacher", status: "active", displayName: "GV " + id, email: id + "@example.test", ...extra });
const membership = (uid, status = "active", orgRole = "member") => ({ id: "orgX_" + uid, organizationId: "orgX", uid, orgRole, status });

test("constants: minimum 3 characters; 20 is only a per-search display cap and the query asks for 21 only to detect more", () => {
  assert.deepEqual([SEARCH_MIN_CHARS, SEARCH_DISPLAY_COUNT, SEARCH_QUERY_LIMIT, SEARCH_MAX_INPUT, EXCEPTION_SEARCH_PROVENANCE], [3, 20, 21, 100, "exception-search"]);
});

test("normalizeEmailTerm: trim + lowercase, bounded length, tolerant of null", () => {
  assert.equal(normalizeEmailTerm("  GV01@Example.TEST \n"), "gv01@example.test");
  assert.equal(normalizeEmailTerm(null), ""); assert.equal(normalizeEmailTerm(undefined), "");
  assert.equal(normalizeEmailTerm("a".repeat(500)).length, 100);
});

function searchFactory(docsCount, log = []) {
  const make = (n) => createTeacherEmailSearchQuery({
    collection: (db, name) => ({ name }),
    query: (source, ...constraints) => { log.push({ source: source.name, constraints }); return { n }; },
    where: (f, op, v) => ["where", f, op, v], orderBy: (f, d) => ["orderBy", f, d], limit: (x) => ["limit", x],
    getDocs: async (q) => ({ docs: Array.from({ length: q.n }, (_, i) => ({ id: "u" + String(i).padStart(2, "0"), data: () => ({ role: "teacher", status: "active", displayName: "N" + i, email: "bulk" + i + "@example.test", secret: "x" }) })) })
  });
  return make(docsCount);
}

test("search query: exactly email >= term, email <= term + U+F8FF, orderBy email, limit 21; no role/status filter, no cursor", async () => {
  const log = [];
  const found = await searchFactory(3, log).searchByEmailPrefix({}, "  BULK  ");
  assert.equal(log.length, 1);
  assert.equal(log[0].source, "users");
  assert.deepEqual(log[0].constraints, [["where", "email", ">=", "bulk"], ["where", "email", "<=", "bulk" + String.fromCharCode(0xf8ff)], ["orderBy", "email", undefined], ["limit", 21]]);
  assert.equal(found.term, "bulk");
  assert.deepEqual(Object.keys(found.users[0]).sort(), ["displayName", "email", "id", "role", "status"], "only the fields needed are exposed");
});

test("search query: shorter than 3 normalized characters is rejected BEFORE Firestore is touched", async () => {
  const log = [];
  const factory = searchFactory(1, log);
  for (const bad of ["", " ", "ab", "  AB  ", null, undefined]) await assert.rejects(() => factory.searchByEmailPrefix({}, bad), RangeError);
  assert.equal(log.length, 0, "no query was built for a short term");
});

test("search query: shows at most 20; 21 documents mean 'more'; exactly 20 does not", async () => {
  const none = await searchFactory(0).searchByEmailPrefix({}, "abc"); assert.deepEqual([none.users.length, none.more], [0, false]);
  const twenty = await searchFactory(20).searchByEmailPrefix({}, "abc"); assert.deepEqual([twenty.users.length, twenty.more], [20, false]);
  const more = await searchFactory(21).searchByEmailPrefix({}, "abc"); assert.deepEqual([more.users.length, more.more], [20, true]);
});

test("classification: a membership document (any status) always wins and is never addable; otherwise active teachers are eligible; other accounts are not addable with a reason", () => {
  assert.equal(classifySearchResult({ user: user("a"), membership: null }).kind, "eligible");
  assert.equal(classifySearchResult({ user: user("a"), membership: membership("a", "active") }).kind, "member-active");
  assert.equal(classifySearchResult({ user: user("a"), membership: membership("a", "suspended") }).kind, "member-suspended");
  assert.equal(classifySearchResult({ user: user("a"), membership: membership("a", "removed") }).kind, "member-removed");
  assert.equal(classifySearchResult({ user: user("a"), membership: membership("a", "active", "org_admin") }).kind, "member-org-admin");
  assert.equal(classifySearchResult({ user: user("a"), membership: membership("a", "removed", "org_admin") }).kind, "member-org-admin");
  const na = (u) => classifySearchResult({ user: u, membership: null });
  assert.deepEqual([na(user("a", { status: "pending" })).kind, na(user("a", { status: "pending" })).reason], ["not-active-teacher", "pending"]);
  assert.equal(na(user("a", { status: "suspended" })).reason, "suspended");
  assert.equal(na(user("a", { role: "admin" })).reason, "admin");
  assert.equal(na(user("a", { role: "weird" })).reason, "other");
  assert.equal(na(null).kind, "not-active-teacher");
  // a suspended platform account that still has a membership shows the membership state
  assert.equal(classifySearchResult({ user: user("a", { status: "suspended" }), membership: membership("a") }).kind, "member-active");
});

test("markup: the shell is a plain search box + TÌM; no population, checkbox, paging or global claim", () => {
  const shell = renderEmailSearchShellHtml({ organization: activeOrg, esc });
  assert.ok(shell.includes("<h3>Thêm giảng viên</h3>") && shell.includes('id="orgSearchInput"') && shell.includes('placeholder="Nhập email giảng viên…"') && shell.includes(">TÌM</button>") && shell.includes('id="orgSearchClose"'));
  assert.ok(shell.includes("Khoa &lt;Quản trị&gt;") && !shell.includes("Khoa <Quản trị>"), "escaped");
  assert.ok(!shell.includes("checkbox") && !shell.includes("TẢI THÊM") && !shell.includes("data-search-row"));
  assert.ok(shell.includes('type="submit"') && shell.includes('id="orgSearchForm"'), "Enter and TÌM both submit the form");
  assert.ok(!/oninput|onkeyup|onkeydown/.test(shell), "no auto-search wiring in the markup");
});

test("markup: every state and Vietnamese string; scope-accurate; no global sentence; one add button only for eligible rows", () => {
  const r = (state, org = activeOrg) => renderEmailSearchResultsHtml({ state, organization: org, esc });
  assert.ok(r({ status: "idle" }).includes("Nhập từ 3 ký tự đầu của email giảng viên"));
  assert.ok(r({ status: "tooShort" }).includes("Nhập thêm ký tự (tối thiểu 3)."));
  assert.ok(r({ status: "searching" }).includes("spinner"));
  assert.ok(r({ status: "error", error: "Mất kết nối" }).includes("Mất kết nối") && r({ status: "error", error: "x" }).includes("Bấm TÌM để thử lại"));
  assert.ok(r({ status: "results", term: "a<b", rows: [], more: false }).includes("Không tìm thấy tài khoản nào có email bắt đầu bằng “a&lt;b”."));
  const rows = ["eligible", "added", "member-active", "member-suspended", "member-removed", "member-org-admin", "archived"].map((kind, i) => ({ user: user("u" + i, { displayName: "Tên <" + i + ">" }), kind }))
    .concat([{ user: user("p1"), kind: "not-active-teacher", reason: "pending" }, { user: user("p2"), kind: "not-active-teacher", reason: "suspended" }, { user: user("p3", { role: "admin" }), kind: "not-active-teacher", reason: "admin" }, { user: user("e"), kind: "eligible", error: "Không có quyền" }]);
  const html = r({ status: "results", term: "gv", rows, more: true });
  for (const needle of ["THÊM VÀO ĐƠN VỊ", "✅ Đã thêm Tên &lt;1&gt; vào Khoa &lt;Quản trị&gt;.", "Đã là thành viên.", "Đang tạm ngưng trong đơn vị. Quản lý tại <b>Đơn vị → Thành viên</b>.", "Đã gỡ khỏi đơn vị. Khôi phục tại <b>Đơn vị → Thành viên → Khôi phục thành viên</b>.", "Là quản trị đơn vị; không thêm lại tại đây.", "Đơn vị đã được lưu trữ, không thể thêm thành viên.", "Tài khoản đang chờ duyệt — chưa thể thêm.", "Tài khoản đã bị khóa — chưa thể thêm.", "Tài khoản quản trị, không phải giảng viên — không thể thêm.", "Có thêm kết quả. Hãy nhập thêm ký tự để thu hẹp tìm kiếm.", "Không có quyền Có thể thử lại."]) {
    assert.ok(html.includes(needle) || html.replace(/\s+/g, " ").includes(needle), needle);
  }
  assert.equal((html.match(/data-search-add=/g) || []).length, 2, "an add button only for the eligible rows");
  assert.ok(!html.includes("<0>") && html.includes("Tên &lt;0&gt;"));
  assert.ok(!html.includes("checkbox") && !html.includes("Hiện không có giảng viên nào chưa được thêm vào đơn vị"));
  assert.ok(r({ status: "results", term: "gv", rows: [], more: false }, archivedOrg).includes("Đơn vị đã được lưu trữ, không thể thêm thành viên."), "archived Organization: no search UI");
  const busy = r({ status: "results", term: "gv", rows: [{ user: user("e"), kind: "eligible", busy: true }], more: false });
  assert.ok(busy.includes("ĐANG THÊM…") && /data-search-add="e" disabled/.test(busy));
});

test("sequence guard: only the latest search is current; invalidate() ends everything (stale-result protection, dialog close)", () => {
  const g = createSequenceGuard();
  const a = g.next(), b = g.next();
  assert.deepEqual([g.isCurrent(a), g.isCurrent(b)], [false, true]);
  g.invalidate();
  assert.equal(g.isCurrent(b), false);
  const c = g.next(); assert.equal(g.isCurrent(c), true);
});

function writeDeps({ userDoc = user("t1"), orgs = { orgX: activeOrg }, memberships = {}, failWrite = false, audit = [], writes = [] } = {}) {
  return {
    readUser: async () => userDoc,
    queries: { organizationById: async (db, id) => orgs[id] || null, membershipOf: async (db, id, uid) => memberships[id + "_" + uid] || null },
    contract,
    writer: { createMany: async (db, items) => { if (failWrite) throw new Error("boom"); for (const item of items) { writes.push(item); memberships[item.id] = { ...item.data, id: item.id }; } return items.length; } },
    logAudit: async (...args) => { audit.push(args); }
  };
}

test("write core: one ordinary active member through the S4 contract, snapshot, audit with via 'exception-search'", async () => {
  const writes = [], audit = [];
  const out = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps: writeDeps({ writes, audit }) });
  assert.equal(out.outcome, "created");
  assert.equal(writes.length, 1);
  const { id, data } = writes[0];
  assert.equal(id, "orgX_t1");
  assert.deepEqual(Object.keys(data).sort(), ["addedBy", "createdAt", "displayName", "email", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
  assert.deepEqual([data.orgRole, data.status, data.addedBy, data.organizationId, data.uid, data.displayName, data.email], ["member", "active", "admin1", "orgX", "t1", "GV t1", "t1@example.test"]);
  assert.deepEqual(audit, [["organization.members.add", "organization", "orgX", { count: 1, uids: ["t1"], skipped: 0, via: "exception-search" }]]);
});

test("write core: fresh re-checks - never recreates active/suspended/removed/org_admin; teacher no longer active; Organization archived or gone; nothing written", async () => {
  for (const [status, orgRole] of [["active", "member"], ["suspended", "member"], ["removed", "member"], ["active", "org_admin"]]) {
    const writes = [], audit = [];
    const out = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps: writeDeps({ memberships: { orgX_t1: membership("t1", status, orgRole) }, writes, audit }) });
    assert.equal(out.outcome, "already-associated"); assert.equal(out.membership.status, status);
    assert.deepEqual([writes.length, audit.length], [0, 0]);
  }
  for (const userDoc of [null, user("t1", { status: "suspended" }), user("t1", { status: "pending" }), user("t1", { role: "admin" })]) {
    const writes = [], audit = [];
    const out = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps: writeDeps({ userDoc, writes, audit }) });
    assert.equal(out.outcome, "not-active-teacher"); assert.deepEqual([writes.length, audit.length], [0, 0]);
  }
  for (const orgs of [{ orgX: archivedOrg }, {}]) {
    const writes = [];
    const out = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps: writeDeps({ orgs, writes }) });
    assert.equal(out.outcome, "organization-archived"); assert.equal(writes.length, 0);
  }
});

test("write core: second attempt cannot duplicate; a failed write is reported and retryable; audit failure never fails the membership; never throws", async () => {
  const writes = [], memberships = {};
  const deps = writeDeps({ writes, memberships });
  const first = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps });
  const second = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps });
  assert.deepEqual([first.outcome, second.outcome], ["created", "already-associated"]);
  assert.equal(writes.length, 1);
  const failing = await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t2", deps: writeDeps({ userDoc: user("t2"), failWrite: true }) });
  assert.equal(failing.outcome, "failed"); assert.equal(failing.error.message, "boom");
  const auditDown = writeDeps({ userDoc: user("t3") }); auditDown.logAudit = async () => { throw new Error("audit down"); };
  assert.equal((await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t3", deps: auditDown })).outcome, "created");
  const readFails = writeDeps(); readFails.readUser = async () => { throw new Error("offline"); };
  assert.equal((await addTeacherFromSearch({ db: {}, actorUid: "admin1", organization: activeOrg, uid: "t1", deps: readFails })).outcome, "failed");
});
