// Library V2 P2-S4 - pure unit tests for the ordinary-membership view module (no Firebase, no DOM).
import test from "node:test";
import assert from "node:assert/strict";
import {
  membershipStatusView, membershipRoleLabel, renderAddTeacherActionHtml, summarizeMembers, availableMemberActions, nextStatusForAction, describeAssociation, planMembershipAdditions,
  renderMembersSectionHtml, renderTeacherPickerHtml, renderMemberConfirmHtml, createMembershipWriter, createActiveTeacherPickerQuery,
  MEMBER_PAGE_SIZE, TEACHER_PICKER_PAGE_SIZE
} from "../../organization-membership-view.mjs";
import { createOrganizationWriteContract, MEMBERSHIP_WRITE_CHUNK_DEFAULT } from "../../organization-write-contract.mjs";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SENTINEL = { sentinel: "serverTimestamp" };
const contract = createOrganizationWriteContract({ serverTimestamp: () => SENTINEL });
const activeOrg = { id: "orgX", name: "Khoa <Quản trị>", code: "khoa-qt", status: "active" };
const archivedOrg = { ...activeOrg, status: "archived" };
const member = (uid, status = "active", orgRole = "member") => ({ id: "orgX_" + uid, organizationId: "orgX", uid, orgRole, status, displayName: "GV " + uid, email: uid + "@example.test", createdAt: null });

test("status views and role labels cover every state and degrade safely", () => {
  assert.deepEqual(["active", "suspended", "removed"].map((s) => membershipStatusView(s).label), ["Đang hoạt động", "Tạm ngưng", "Đã gỡ"]);
  assert.equal(membershipStatusView("weird").label, "Không xác định");
  assert.equal(membershipRoleLabel("member"), "Thành viên");
  assert.equal(membershipRoleLabel("org_admin"), "Quản trị đơn vị");
});

test("lifecycle action matrix: only ordinary members of an ACTIVE organization; org_admin rows and archived organizations offer nothing", () => {
  assert.deepEqual(availableMemberActions(member("a"), activeOrg), ["suspend", "remove"]);
  assert.deepEqual(availableMemberActions(member("a", "suspended"), activeOrg), ["restore", "remove"]);
  assert.deepEqual(availableMemberActions(member("a", "removed"), activeOrg), ["reinstate"]);
  assert.deepEqual(availableMemberActions(member("a", "active", "org_admin"), activeOrg), []);
  assert.deepEqual(availableMemberActions(member("a", "suspended", "org_admin"), activeOrg), []);
  for (const status of ["active", "suspended", "removed"]) assert.deepEqual(availableMemberActions(member("a", status), archivedOrg), []);
  assert.deepEqual(availableMemberActions(null, activeOrg), []);
  assert.deepEqual(availableMemberActions(member("a", "weird"), activeOrg), []);
  assert.deepEqual(["suspend", "restore", "remove", "reinstate", "appoint"].map(nextStatusForAction), ["suspended", "active", "removed", "active", null]);
});

test("association description distinguishes existing memberships (any role/status) from addable teachers", () => {
  assert.equal(describeAssociation(null), null);
  assert.match(describeAssociation(member("a")).label, /Thành viên · Đang hoạt động/);
  assert.match(describeAssociation(member("a", "removed")).label, /Đã gỡ/);
  assert.match(describeAssociation(member("a", "active", "org_admin")).label, /Quản trị đơn vị/);
});

test("planMembershipAdditions: builds contract payloads for ordinary members only, never duplicates, skips associated and ineligible users", () => {
  const teachers = [
    { id: "t1", role: "teacher", status: "active", displayName: "Một", email: "1@example.test" },
    { id: "t2", role: "teacher", status: "active", displayName: "", email: "" },
    { id: "t1", role: "teacher", status: "active", displayName: "Một", email: "1@example.test" },
    { id: "t3", role: "teacher", status: "active", displayName: "Ba", email: "3@example.test" },
    { id: "t4", role: "teacher", status: "suspended", displayName: "Bốn", email: "4@example.test" },
    { id: "t5", role: "admin", status: "active", displayName: "Năm", email: "5@example.test" }
  ];
  const existing = new Map(teachers.map((t) => [t.id, t.id === "t3" ? member("t3", "removed") : null]));
  const plan = planMembershipAdditions({ organization: activeOrg, candidates: teachers, existingByUid: existing, actorUid: "pa", contract });
  assert.deepEqual(plan.toCreate.map((x) => x.id), ["orgX_t1", "orgX_t2"]);
  assert.deepEqual(plan.skipped, [{ uid: "t1", reason: "duplicate-selection" }, { uid: "t3", reason: "already-associated" }, { uid: "t4", reason: "not-active-teacher" }, { uid: "t5", reason: "not-active-teacher" }]);
  const [first, second] = plan.toCreate;
  assert.deepEqual(Object.keys(first.data).sort(), ["addedBy", "createdAt", "displayName", "email", "orgRole", "organizationId", "schemaVersion", "status", "uid", "updatedAt"]);
  assert.equal(first.data.orgRole, "member");
  assert.equal(first.data.status, "active");
  assert.equal(first.data.addedBy, "pa");
  assert.equal(first.data.displayName, "Một");
  assert.equal(first.data.createdAt, SENTINEL);
  assert.ok(!("displayName" in second.data) && !("email" in second.data), "empty snapshot fields are omitted, not stored as empty strings");
  assert.throws(() => planMembershipAdditions({ organization: archivedOrg, candidates: teachers, existingByUid: existing, actorUid: "pa", contract }), /organization-archived/);
});

test("members section markup: empty state, escaping, status badges, per-row actions, org_admin read-only, archived banner and disabled add, load-more", () => {
  const fmt = () => "02/10/2026";
  const empty = renderMembersSectionHtml({ organization: activeOrg, members: [], hasMore: false, esc, fmtDate: fmt });
  assert.ok(empty.includes('id="orgMembersEmpty"') && empty.includes("Chưa có thành viên") && !empty.includes("orgMembersTable") && !empty.includes('id="orgMembersMore"'));
  assert.ok(!empty.includes("orgMemberAddBtn") && !empty.includes("orgMembersSummary"), "the add action is NOT in the member card; an empty list shows no summary");
  const rows = renderMembersSectionHtml({
    organization: activeOrg, hasMore: true, esc, fmtDate: fmt,
    members: [{ ...member("a"), displayName: "<img onerror=x>" }, member("b", "suspended"), member("c", "removed"), member("d", "active", "org_admin")]
  });
  assert.ok(!rows.includes("<img onerror"), "display snapshot is escaped");
  assert.ok(rows.includes("&lt;img onerror=x&gt;"));
  assert.ok(rows.includes('data-member-action="suspend" data-member-id="orgX_a"') && rows.includes('data-member-action="remove" data-member-id="orgX_a"'));
  assert.ok(rows.includes('data-member-action="restore" data-member-id="orgX_b"'));
  assert.ok(rows.includes('data-member-action="reinstate" data-member-id="orgX_c"'));
  assert.ok(!rows.includes('data-member-id="orgX_d"'), "org_admin rows have no actions in S4");
  for (const label of ["Tạm ngưng", "Đã gỡ", "Quản trị đơn vị"]) assert.ok(rows.includes(label), label);
  assert.ok(rows.includes('id="orgMembersMore"') && !rows.includes("orgMemberAddBtn"));
  assert.ok(rows.includes("KHÔI PHỤC THÀNH VIÊN") && !rows.includes("ĐƯA TRỞ LẠI") && rows.includes("GỠ KHỎI ĐƠN VỊ"), "reinstate label");
  assert.ok(rows.includes('id="orgMembersSummary"') && rows.includes("Đã tải 4 thành viên"), "partial summary is labelled as loaded-only");
  assert.ok(rows.includes("không phải dữ liệu tài khoản"), "snapshot caveat is stated");
  const archived = renderMembersSectionHtml({ organization: archivedOrg, members: [member("a")], hasMore: false, esc, fmtDate: fmt });
  assert.ok(archived.includes('id="orgMembersArchivedNote"') && !archived.includes("orgMemberAddBtn") && !archived.includes("data-member-action"));
  assert.ok(!/appoint|org_admin|Bổ nhiệm|quản trị đơn vị<\/button>/i.test(empty), "no appoint-admin control exists");
});

test("primary add action: one button for the upper detail action area; disabled with an explanation for an archived organization", () => {
  const active = renderAddTeacherActionHtml({ organization: activeOrg });
  assert.ok(active.includes('id="orgMemberAddBtn"') && active.includes("+ Thêm giảng viên") && !active.includes("disabled"));
  const archived = renderAddTeacherActionHtml({ organization: archivedOrg });
  assert.ok(/id="orgMemberAddBtn" disabled/.test(archived) && archived.includes("Đơn vị đã lưu trữ"));
});

test("member summary: exact when every member is loaded, explicitly partial while more pages exist, never a misleading total; zero states omitted", () => {
  const list = [member("a"), member("b"), member("c", "suspended"), member("d", "removed"), member("e", "active", "org_admin")];
  const full = summarizeMembers(list, false);
  assert.deepEqual([full.total, full.active, full.suspended, full.removed, full.partial], [5, 3, 1, 1, false]);
  assert.equal(full.text, "5 thành viên · 3 hoạt động · 1 tạm ngưng · 1 đã gỡ");
  assert.equal(summarizeMembers([member("a"), member("b")], false).text, "2 thành viên · 2 hoạt động");
  const partial = summarizeMembers(list, true);
  assert.equal(partial.partial, true);
  assert.ok(partial.text.startsWith("Đã tải 5 thành viên · 3 hoạt động") && partial.text.includes("còn thêm"), partial.text);
  assert.ok(!/^5 thành viên/.test(partial.text), "a partial list must not read like a global total");
  assert.equal(summarizeMembers([], false).total, 0);
  assert.equal(summarizeMembers([{ id: "x", status: "weird" }], false).text, "1 thành viên");
});

test("teacher picker markup: associated teachers are disabled and labelled, selection preserved, submit disabled until selection", () => {
  const teachers = [
    { id: "t1", displayName: "Một", email: "1@example.test" },
    { id: "t2", displayName: "Hai", email: "2@example.test" }
  ];
  const associations = new Map([["t1", describeAssociation(member("t1", "suspended"))], ["t2", null]]);
  const html = renderTeacherPickerHtml({ organization: activeOrg, teachers, associations, selected: new Set(["t1", "t2"]), esc, hasMore: true });
  assert.ok(/data-picker-check="t1" disabled/.test(html) && !/data-picker-check="t1" disabled checked/.test(html), "associated teacher disabled and never pre-checked");
  assert.ok(/data-picker-check="t2" checked/.test(html));
  assert.ok(html.includes('data-picker-assoc="t1"') && html.includes("Đã có trong đơn vị"));
  assert.ok(html.includes('id="orgPickerMore"') && /id="orgPickerSubmit" disabled/.test(html));
  assert.ok(html.includes("Khoa &lt;Quản trị&gt;"));
  assert.ok(renderTeacherPickerHtml({ organization: activeOrg, teachers: [], associations: new Map(), selected: new Set(), esc, hasMore: false }).includes('id="orgPickerEmpty"'));
});

test("confirmation copy per action: removal is explicit that the membership record is kept and the platform account is unaffected", () => {
  for (const action of ["suspend", "restore", "remove", "reinstate"]) {
    const html = renderMemberConfirmHtml({ action, member: member("a"), organization: activeOrg, esc });
    assert.ok(html.includes('id="orgMemberConfirmOk"') && html.includes('id="orgMemberConfirmCancel"'), action);
  }
  assert.match(renderMemberConfirmHtml({ action: "remove", member: member("a"), organization: activeOrg, esc }), /giữ lại.*tài khoản HCMA2 của giảng viên không bị ảnh hưởng/);
});

test("membership writer: one batch per chunk, deterministic ids, the default chunk is an implementation safety value, not a domain limit", async () => {
  const log = [];
  const writer = createMembershipWriter({
    collection: (db, name) => ({ db, name }),
    doc: (parent, ...ids) => ({ path: (parent.name ? [parent.name, ...ids] : ids).join("/") }),
    writeBatch: () => { const ops = []; return { set: (ref, data) => ops.push([ref.path, data]), commit: async () => { log.push(ops.slice()); } }; },
    updateDoc: async (ref, data) => { log.push(["update", ref.path, data]); }
  });
  const items = Array.from({ length: 5 }, (_, i) => ({ id: "orgX_u" + i, data: { uid: "u" + i } }));
  assert.equal(await writer.createMany({}, items, 2), 5);
  assert.deepEqual(log.map((batch) => batch.length), [2, 2, 1]);
  assert.equal(log[0][0][0], "organizationMembers/orgX_u0");
  assert.equal(MEMBERSHIP_WRITE_CHUNK_DEFAULT, 400);
  log.length = 0;
  assert.equal(await writer.createMany({}, Array.from({ length: 401 }, (_, i) => ({ id: "orgX_v" + i, data: {} }))), 401);
  assert.deepEqual(log.map((batch) => batch.length), [400, 1]);
  await writer.update({}, "orgX_u0", { status: "suspended" });
  assert.deepEqual(log.at(-1), ["update", "organizationMembers/orgX_u0", { status: "suspended" }]);
  assert.equal(await writer.createMany({}, []), 0);
});

test("active-teacher picker query: exactly role==teacher, status==active, createdAt desc, bounded, cursor-paged, never unbounded", async () => {
  const constraints = [];
  const q = createActiveTeacherPickerQuery({
    collection: (db, name) => ({ name }),
    query: (source, ...rest) => { constraints.push({ source: source.name, rest }); return { constraints: rest }; },
    where: (field, op, value) => ["where", field, op, value],
    orderBy: (field, dir) => ["orderBy", field, dir],
    limit: (n) => ["limit", n],
    startAfter: (c) => ["startAfter", c],
    getDocs: async () => ({ docs: Array.from({ length: 4 }, (_, i) => ({ id: "t" + i, data: () => ({ role: "teacher", status: "active", displayName: "N" + i, email: "e" + i, secret: "x" }) })) })
  });
  const page = await q.pageActiveTeachersForMembershipPicker({}, { pageSize: 3 });
  assert.equal(constraints[0].source, "users");
  assert.deepEqual(constraints[0].rest, [["where", "role", "==", "teacher"], ["where", "status", "==", "active"], ["orderBy", "createdAt", "desc"], ["limit", 4]]);
  assert.equal(page.teachers.length, 3);
  assert.equal(page.hasMore, true);
  assert.deepEqual(Object.keys(page.teachers[0]).sort(), ["displayName", "email", "id", "role", "status"], "only the fields needed for the picker are exposed");
  await q.pageActiveTeachersForMembershipPicker({}, { pageSize: 3, cursor: "CUR" });
  assert.deepEqual(constraints[1].rest.at(-2), ["startAfter", "CUR"]);
  await assert.rejects(() => q.pageActiveTeachersForMembershipPicker({}, { pageSize: 101 }), RangeError);
  await assert.rejects(() => q.pageActiveTeachersForMembershipPicker({}, { pageSize: 0 }), RangeError);
  assert.ok(MEMBER_PAGE_SIZE <= 100 && TEACHER_PICKER_PAGE_SIZE <= 100);
});
