// Onboarding O2 - pure/unit tests for the post-approval Organization continuation (no Firebase, no DOM).
import test from "node:test";
import assert from "node:assert/strict";
import {
  createActiveOrganizationLookup, decideEnrollmentView, renderEnrollmentHtml, enrollTeacherInOrganizations,
  ACTIVE_ORGANIZATION_DISPLAY_COUNT, ACTIVE_ORGANIZATION_QUERY_LIMIT, AUDIT_PROVENANCE
} from "../../teacher-organization-enrollment.mjs";
import { createOrganizationWriteContract } from "../../organization-write-contract.mjs";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SENTINEL = { sentinel: true };
const contract = createOrganizationWriteContract({ serverTimestamp: () => SENTINEL });
const org = (id, name = "Đơn vị " + id, status = "active") => ({ id, name, code: "ma-" + id, status });
const teacher = { id: "t1", role: "teacher", status: "active", displayName: "Nguyễn <Văn> An", email: "an@example.test" };
const member = (organizationId, status = "active", orgRole = "member") => ({ id: organizationId + "_t1", organizationId, uid: "t1", orgRole, status });

test("the bounded query limit is a defensive detector, not a business limit: 21 vs 20 displayed", () => {
  assert.equal(ACTIVE_ORGANIZATION_DISPLAY_COUNT, 20);
  assert.equal(ACTIVE_ORGANIZATION_QUERY_LIMIT, 21);
  assert.equal(AUDIT_PROVENANCE, "teacher-approval");
});

test("active-Organization lookup: one equality filter on status, limit 21, no orderBy, sorted display of at most 20, truncated flag", async () => {
  const seen = [];
  const fakeDocs = (n) => ({ docs: Array.from({ length: n }, (_, i) => ({ id: "o" + String(i).padStart(2, "0"), data: () => ({ name: "Đơn vị " + String(n - i).padStart(2, "0"), status: "active" }) })) });
  const make = (n) => createActiveOrganizationLookup({
    collection: (db, name) => ({ name }),
    query: (source, ...constraints) => { seen.push({ source: source.name, constraints }); return { n }; },
    where: (f, op, v) => ["where", f, op, v], limit: (x) => ["limit", x],
    getDocs: async (q) => fakeDocs(q.n)
  });
  const one = await make(1).listActiveOrganizations({});
  assert.deepEqual(seen[0], { source: "organizations", constraints: [["where", "status", "==", "active"], ["limit", 21]] });
  assert.equal(one.organizations.length, 1); assert.equal(one.truncated, false);
  const full = await make(20).listActiveOrganizations({});
  assert.equal(full.organizations.length, 20); assert.equal(full.truncated, false);
  const more = await make(21).listActiveOrganizations({});
  assert.equal(more.organizations.length, 20); assert.equal(more.truncated, true);
  assert.deepEqual(more.organizations.map((o) => o.name), [...more.organizations.map((o) => o.name)].sort((a, b) => a.localeCompare(b, "vi")));
  const none = await make(0).listActiveOrganizations({});
  assert.deepEqual(none, { organizations: [], truncated: false });
});

test("decision: blocked / none / single preselected / multi nothing preselected / truncated nothing preselected / already", () => {
  assert.equal(decideEnrollmentView({ teacher: null, organizations: [org("a")] }).kind, "blocked");
  for (const bad of [{ ...teacher, status: "suspended" }, { ...teacher, status: "pending" }, { ...teacher, role: "admin" }]) assert.equal(decideEnrollmentView({ teacher: bad, organizations: [org("a")] }).kind, "blocked");
  assert.equal(decideEnrollmentView({ teacher, organizations: [] }).kind, "none");
  const single = decideEnrollmentView({ teacher, organizations: [org("a")] });
  assert.deepEqual([single.kind, single.mode, single.rows[0].preselected, single.rows[0].selectable], ["choose", "single", true, true]);
  const multi = decideEnrollmentView({ teacher, organizations: [org("a"), org("b")] });
  assert.deepEqual([multi.kind, multi.mode, multi.rows.map((r) => r.preselected)], ["choose", "multi", [false, false]]);
  const truncated = decideEnrollmentView({ teacher, organizations: [org("a")], truncated: true });
  assert.equal(truncated.rows[0].preselected, false, "an incomplete list is never preselected");
  for (const status of ["active", "suspended", "removed"]) {
    const assoc = decideEnrollmentView({ teacher, organizations: [org("a"), org("b")], associations: new Map([["a", member("a", status)]]) });
    assert.equal(assoc.kind, "choose");
    assert.deepEqual(assoc.rows.map((r) => r.selectable), [false, true]);
    assert.ok(assoc.rows[0].association.label.includes("Đã có trong đơn vị"));
  }
  const all = decideEnrollmentView({ teacher, organizations: [org("a")], associations: new Map([["a", member("a", "removed")]]) });
  assert.equal(all.kind, "already");
  assert.equal(decideEnrollmentView({ teacher, organizations: [org("a"), org("b")], associations: new Map([["a", member("a")], ["b", member("b", "suspended")]]) }).kind, "already");
  assert.equal(decideEnrollmentView({ teacher, organizations: [org("a", "x", "active")], associations: new Map([["a", member("a", "active", "org_admin")]]) }).kind, "already", "an Organization Admin membership also counts as associated");
});

test("markup: concise 'next step (optional)' wording; approval already succeeded; skipping/closing does not undo it; one org preselected, many none; escaping; states", () => {
  const single = renderEnrollmentHtml({ token: 3, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a", "Học viện <X>")] }), esc });
  assert.ok(single.includes("Đã duyệt tài khoản giảng viên") && single.includes("Bước tiếp theo (tùy chọn)"));
  assert.ok(single.includes("Tài khoản đã được duyệt. Anh/chị có thể thêm giảng viên vào đơn vị ngay hoặc thực hiện sau.") && single.includes("không hủy việc duyệt"));
  assert.ok(!single.includes("Esc") && !single.includes("bấm ra ngoài"), "the explanation stays concise");
  assert.ok(single.includes('data-enroll-token="3"') && single.includes("THÊM VÀO ĐƠN VỊ") && single.includes("ĐỂ SAU"));
  assert.ok(/data-enroll-org="a" checked/.test(single), "single organization preselected");
  assert.ok(single.includes('<b>Học viện &lt;X&gt;</b><div class="small mut">Mã đơn vị: ma-a</div>'), "the Organization name is the primary label; the code is a separate, subtle secondary line");
  assert.ok(!single.includes("<code>") && !/<b>[^<]*<\/b>\s*<code>/.test(single), "the code is never concatenated to the name");
  assert.ok(!single.includes("<Văn>") && !single.includes("Học viện <X>"), "escaped");
  const multi = renderEnrollmentHtml({ token: 4, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a"), org("b")] }), esc });
  assert.ok(!/data-enroll-org="[ab]" checked/.test(multi) && multi.includes("có thể chọn nhiều đơn vị"));
  const none = renderEnrollmentHtml({ token: 5, teacher, view: decideEnrollmentView({ teacher, organizations: [] }), esc });
  assert.ok(none.includes("Chưa có đơn vị nào đang hoạt động") && none.includes('id="orgEnrollClose"') && !none.includes('id="orgEnrollAdd"'));
  const blocked = renderEnrollmentHtml({ token: 6, teacher, view: decideEnrollmentView({ teacher: { ...teacher, status: "suspended" }, organizations: [org("a")] }), esc });
  assert.ok(blocked.includes("không còn là giảng viên đang hoạt động") && blocked.includes("Việc duyệt trước đó không bị ảnh hưởng") && !blocked.includes('id="orgEnrollAdd"'));
  assert.ok(renderEnrollmentHtml({ token: 9, teacher: null, view: "loading", esc }).includes("spinner"));
  const err = renderEnrollmentHtml({ token: 10, teacher: null, view: null, loadError: "Mất kết nối", esc });
  assert.ok(err.includes("Mất kết nối") && err.includes("THỬ LẠI") && err.includes("ĐỂ SAU"));
  const truncated = renderEnrollmentHtml({ token: 11, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a"), org("b")], truncated: true }), esc });
  assert.ok(truncated.includes("thêm vào các đơn vị khác từ màn hình Đơn vị"));
});

test("suspended / removed / active memberships are NON-selectable information rows (no checkbox) that point to Đơn vị → Thành viên; they are never selectable", () => {
  for (const status of ["suspended", "removed"]) {
    const html = renderEnrollmentHtml({ token: 8, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a", "Khoa A"), org("b", "Khoa B")], associations: new Map([["a", member("a", status)]]) }), esc });
    assert.ok(!/data-enroll-org="a"/.test(html), status + ": no checkbox for the associated Organization");
    assert.ok(/data-enroll-org="b"/.test(html) && !/data-enroll-org="b" disabled/.test(html), "the other Organization stays selectable");
    assert.ok(/data-enroll-row="a" data-enroll-info/.test(html), "rendered as an information row");
    const note = html.slice(html.indexOf('data-enroll-note="a"'), html.indexOf('data-enroll-note="a"') + 400);
    assert.ok(note.includes(status === "removed" ? "Đã gỡ" : "Tạm ngưng") && note.includes("Đơn vị → Thành viên") && note.includes("Không thêm lại tại đây"), note);
  }
  const active = renderEnrollmentHtml({ token: 8, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a", "Khoa A"), org("b", "Khoa B")], associations: new Map([["a", member("a", "active")]]) }), esc });
  assert.ok(!/data-enroll-org="a"/.test(active) && active.includes("không cần thêm lại"));
  const all = renderEnrollmentHtml({ token: 7, teacher, view: decideEnrollmentView({ teacher, organizations: [org("a")], associations: new Map([["a", member("a", "removed")]]) }), esc });
  assert.ok(all.includes("Đã gỡ") && all.includes("Đơn vị → Thành viên") && !all.includes('id="orgEnrollAdd"') && !all.includes("data-enroll-org=") && all.includes('id="orgEnrollClose"'));
  assert.ok(!all.includes("Bước tiếp theo (tùy chọn)"), "nothing to choose: no optional-step prompt");
});

test("success feedback: an explicit confirmation names the teacher and the Organization(s) and stays until ĐÓNG; partial results show the created part and keep failures retryable", () => {
  const view = decideEnrollmentView({ teacher, organizations: [org("a", "Khoa Quản trị (mẫu)"), org("b", "Trung tâm <B>")] });
  const done = renderEnrollmentHtml({ token: 20, teacher, view, doneInfo: { teacherName: "Nguyễn <Văn> An", organizationNames: ["Khoa Quản trị (mẫu)"] }, esc });
  assert.ok(done.includes('id="orgEnrollDone"') && done.includes("✅ Đã thêm Nguyễn &lt;Văn&gt; An vào Khoa Quản trị (mẫu).") && done.includes("Đơn vị → Thành viên"));
  assert.ok(done.includes('id="orgEnrollClose"') && !done.includes('id="orgEnrollAdd"') && !done.includes("Bước tiếp theo (tùy chọn)"));
  const two = renderEnrollmentHtml({ token: 21, teacher, view, doneInfo: { teacherName: "An", organizationNames: ["Khoa A", "Trung tâm <B>"] }, esc });
  assert.ok(two.includes("Đã thêm An vào Khoa A, Trung tâm &lt;B&gt;."));
  const partial = renderEnrollmentHtml({
    token: 22, teacher, view, esc,
    outcomes: new Map([["a", { outcome: "created" }], ["b", { outcome: "failed", message: "Không thêm được vào đơn vị.", retrySelected: true }]])
  });
  assert.ok(partial.includes('id="orgEnrollPartial"') && partial.includes("Đã thêm Nguyễn &lt;Văn&gt; An vào Khoa Quản trị (mẫu)."), "created part is confirmed");
  assert.ok(!/data-enroll-org="a"/.test(partial) && /data-enroll-row="a" data-enroll-info/.test(partial) && partial.includes("Đã thêm vào đơn vị."));
  assert.ok(/data-enroll-org="b" checked/.test(partial) && partial.includes("THỬ LẠI") && partial.includes("Có thể thử lại"));
  const race = renderEnrollmentHtml({ token: 23, teacher, view, esc, outcomes: new Map([["a", { outcome: "already-associated", membershipStatus: "removed", membership: member("a", "removed") }]]) });
  assert.ok(!/data-enroll-org="a"/.test(race) && race.includes("Đơn vị → Thành viên"));
});

function fakeDeps({ user = teacher, orgs = {}, memberships = {}, failWrite = new Set(), audit = [], writes = [] } = {}) {
  return {
    readUser: async () => user,
    queries: { organizationById: async (db, id) => orgs[id] || null, membershipOf: async (db, id, uid) => memberships[id + "_" + uid] || null },
    contract,
    writer: { createMany: async (db, items) => { if (failWrite.has(items[0].data.organizationId)) throw new Error("boom"); for (const item of items) { writes.push(item); memberships[item.id] = { ...item.data, id: item.id }; } return items.length; } },
    logAudit: async (...args) => { audit.push(args); }
  };
}

test("core: creates exactly one ordinary active member per Organization through the S4 contract, with the display snapshot and audit provenance", async () => {
  const writes = [], audit = [];
  const deps = fakeDeps({ orgs: { a: org("a"), b: org("b") }, writes, audit });
  const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "b"], deps });
  assert.deepEqual(out.results.map((r) => [r.organizationId, r.outcome]), [["a", "created"], ["b", "created"]]);
  assert.equal(writes.length, 2);
  const [first] = writes;
  assert.equal(first.id, "a_t1");
  assert.deepEqual(Object.keys(first.data).sort(), ["addedBy", "createdAt", "displayName", "email", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
  assert.deepEqual([first.data.orgRole, first.data.status, first.data.addedBy, first.data.organizationId, first.data.uid], ["member", "active", "admin1", "a", "t1"]);
  assert.equal(first.data.displayName, "Nguyễn <Văn> An"); assert.equal(first.data.email, "an@example.test");
  assert.deepEqual(audit.map((a) => a.slice(0, 3)), [["organization.members.add", "organization", "a"], ["organization.members.add", "organization", "b"]]);
  assert.deepEqual(audit[0][3], { count: 1, uids: ["t1"], skipped: 0, via: "teacher-approval" });
});

test("core: never recreates active, suspended or removed memberships; archived/missing Organizations are skipped; nothing is written for them", async () => {
  for (const status of ["active", "suspended", "removed"]) {
    const writes = [], audit = [];
    const deps = fakeDeps({ orgs: { a: org("a") }, memberships: { a_t1: member("a", status) }, writes, audit });
    const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a"], deps });
    assert.deepEqual([out.results[0].outcome, out.results[0].membershipStatus], ["already-associated", status]);
    assert.equal(out.results[0].membership.status, status, "the existing membership is reported for display only");
    assert.equal(writes.length, 0); assert.equal(audit.length, 0);
  }
  const writes = [], audit = [];
  const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["arch", "gone", "ok"], deps: fakeDeps({ orgs: { arch: org("arch", "Cũ", "archived"), ok: org("ok") }, writes, audit }) });
  assert.deepEqual(out.results.map((r) => r.outcome), ["organization-archived", "organization-missing", "created"]);
  assert.deepEqual(writes.map((w) => w.id), ["ok_t1"]); assert.equal(audit.length, 1);
});

test("core: teacher no longer an active teacher -> blocked, no write, no audit, remaining Organizations also blocked", async () => {
  for (const user of [null, { ...teacher, status: "suspended" }, { ...teacher, status: "pending" }, { ...teacher, role: "admin" }]) {
    const writes = [], audit = [];
    const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "b"], deps: fakeDeps({ user, orgs: { a: org("a"), b: org("b") }, writes, audit }) });
    assert.equal(out.blocked, "not-active-teacher");
    assert.deepEqual(out.results.map((r) => r.outcome), ["blocked", "blocked"]);
    assert.equal(writes.length, 0); assert.equal(audit.length, 0);
  }
});

test("core: the teacher status is re-read for EVERY write (a suspension between two Organizations stops the rest)", async () => {
  let reads = 0;
  const writes = [];
  const deps = fakeDeps({ orgs: { a: org("a"), b: org("b"), c: org("c") }, writes });
  deps.readUser = async () => { reads++; return reads >= 2 ? { ...teacher, status: "suspended" } : teacher; };
  const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "b", "c"], deps });
  assert.deepEqual(out.results.map((r) => r.outcome), ["created", "blocked", "blocked"]);
  assert.equal(reads, 2); assert.deepEqual(writes.map((w) => w.id), ["a_t1"]);
});

test("core: partial multi-Organization failure keeps the successful membership; retry only creates the failed one and never duplicates", async () => {
  const writes = [], audit = [], memberships = {}, failWrite = new Set(["b"]);
  const deps = fakeDeps({ orgs: { a: org("a"), b: org("b") }, memberships, writes, audit, failWrite });
  const first = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "b"], deps });
  assert.deepEqual(first.results.map((r) => r.outcome), ["created", "failed"]);
  assert.equal(audit.length, 1, "no audit for the failed Organization");
  failWrite.clear();
  const retry = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "b"], deps });
  assert.deepEqual(retry.results.map((r) => r.outcome), ["already-associated", "created"]);
  assert.deepEqual(writes.map((w) => w.id), ["a_t1", "b_t1"]);
  assert.equal(audit.length, 2);
});

test("core: never throws (read failure, query failure, audit failure) and de-duplicates selected ids", async () => {
  const deps = fakeDeps({ orgs: { a: org("a") } });
  deps.readUser = async () => { throw new Error("offline"); };
  const out = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "a"], deps });
  assert.deepEqual(out.results.map((r) => r.outcome), ["failed"]);
  const writes = [];
  const deps2 = fakeDeps({ orgs: { a: org("a") }, writes });
  deps2.logAudit = async () => { throw new Error("audit down"); };
  const ok = await enrollTeacherInOrganizations({ db: {}, actorUid: "admin1", uid: "t1", organizationIds: ["a", "a"], deps: deps2 });
  assert.deepEqual(ok.results.map((r) => r.outcome), ["created"], "audit failure never fails the membership; duplicate ids collapse");
  assert.equal(writes.length, 1);
});
