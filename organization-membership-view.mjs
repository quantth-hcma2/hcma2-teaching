// Library V2 P2-S4 - Platform Admin ORDINARY membership management inside Organization Detail.
// Scope: paged member list; add existing active teachers as ordinary `member` memberships (one or many); suspend, restore and
// soft-remove (status `removed`) ordinary members; reinstate a removed member (the deployed Rules allow it for the Platform Admin).
// NOT in this module: appoint/revoke/change Organization Admin, capabilities, current-organization wiring, switcher, bootstrap.
// Every Firestore read goes through the S2 query contract (`queries`) or the dedicated picker query below, and every payload comes from
// the S2 write contract (`contract`); this module never builds a membership payload by hand and never names a membership field of its own.
// Display name / email stored on a membership are SNAPSHOTS for display only - never identity, account status or authorization.

import { chunkMembershipWrites, MEMBERSHIP_WRITE_CHUNK_DEFAULT } from "./organization-write-contract.mjs";

export const MEMBER_PAGE_SIZE = 25;
export const TEACHER_PICKER_PAGE_SIZE = 50;

const STATUS_VIEW = {
  active: { label: "Đang hoạt động", badge: "badge-green", icon: "🟢" },
  suspended: { label: "Tạm ngưng", badge: "badge-yellow", icon: "⏸️" },
  removed: { label: "Đã gỡ", badge: "badge-gray", icon: "🚫" }
};
export function membershipStatusView(status) {
  return STATUS_VIEW[status] || { label: "Không xác định", badge: "badge-gray", icon: "❔" };
}
export const membershipRoleLabel = (role) => (role === "org_admin" ? "Quản trị đơn vị" : role === "member" ? "Thành viên" : "Không xác định");

// Which lifecycle action may the UI offer for this membership? Archived organizations offer none; org_admin rows are read-only here.
const ACTION_NEXT_STATUS = Object.freeze({ suspend: "suspended", restore: "active", remove: "removed", reinstate: "active" });
export function availableMemberActions(member, organization) {
  if (!member || !organization || organization.status !== "active") return [];
  if (member.orgRole !== "member") return [];
  if (member.status === "active") return ["suspend", "remove"];
  if (member.status === "suspended") return ["restore", "remove"];
  if (member.status === "removed") return ["reinstate"];
  return [];
}
export const nextStatusForAction = (action) => ACTION_NEXT_STATUS[action] || null;

// Classify one candidate teacher against the membership documents that already exist (exact lookups by deterministic id).
// Returns null when the teacher can be added, otherwise { status, orgRole, label } describing the existing association.
export function describeAssociation(existingMembership) {
  if (!existingMembership) return null;
  const view = membershipStatusView(existingMembership.status);
  const role = existingMembership.orgRole === "org_admin" ? "Quản trị đơn vị" : "Thành viên";
  return { status: existingMembership.status, orgRole: existingMembership.orgRole, label: `Đã có trong đơn vị · ${role} · ${view.label}` };
}

// Plan an add operation. `existingByUid` maps uid -> existing membership (or null) and MUST come from a fresh exact lookup.
// Returns { toCreate:[{id,data}], skipped:[{uid,reason}] }. No duplicate document is ever produced.
export function planMembershipAdditions({ organization, candidates, existingByUid, actorUid, contract }) {
  if (!organization || organization.status !== "active") throw new Error("organization-archived");
  const toCreate = [], skipped = [], seen = new Set();
  for (const candidate of candidates) {
    const uid = candidate.id;
    if (seen.has(uid)) { skipped.push({ uid, reason: "duplicate-selection" }); continue; }
    seen.add(uid);
    if (candidate.role !== "teacher" || candidate.status !== "active") { skipped.push({ uid, reason: "not-active-teacher" }); continue; }
    if (existingByUid.get(uid)) { skipped.push({ uid, reason: "already-associated" }); continue; }
    toCreate.push(contract.buildNewMembership({ organizationId: organization.id, uid, orgRole: "member", displayName: candidate.displayName || undefined, email: candidate.email || undefined }, actorUid));
  }
  return { toCreate, skipped };
}

// ---------------------------------------------------------------- markup
export function renderMembersSectionHtml({ organization, members, hasMore, esc, fmtDate }) {
  const archived = organization.status !== "active";
  const banner = archived
    ? `<div class="card mt-8" id="orgMembersArchivedNote" style="border-color:#94a3b8"><b>📦 Đơn vị đã lưu trữ.</b> Không thể thêm hoặc thay đổi thành viên. Khôi phục đơn vị để quản lý thành viên.</div>`
    : "";
  const addButton = `<button class="btn" type="button" id="orgMemberAddBtn"${archived ? " disabled" : ""}>+ Thêm giảng viên</button>`;
  const rows = members.map((member) => {
    const view = membershipStatusView(member.status);
    const actions = availableMemberActions(member, organization);
    const labels = { suspend: ["TẠM NGƯNG", "btn-outline"], restore: ["KHÔI PHỤC", "btn-ok"], remove: ["GỠ KHỎI ĐƠN VỊ", "btn-danger"], reinstate: ["ĐƯA TRỞ LẠI", "btn-ok"] };
    const buttons = actions.map((action) => `<button class="btn btn-sm ${labels[action][1]}" type="button" data-member-action="${action}" data-member-id="${esc(member.id)}">${labels[action][0]}</button>`).join(" ");
    return `<tr data-member-row="${esc(member.id)}"><td><b>${esc(member.displayName || "—")}</b><div class="small mut">${esc(member.email || "—")}</div></td><td>${esc(membershipRoleLabel(member.orgRole))}</td><td><span class="badge ${view.badge}">${view.icon} ${esc(view.label)}</span></td><td>${esc(fmtDate ? fmtDate(member.createdAt) : "—")}</td><td style="text-align:right">${buttons}</td></tr>`;
  }).join("");
  const body = members.length
    ? `<div class="table-wrap mt-8"><table id="orgMembersTable"><thead><tr><th>Giảng viên</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày thêm</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty-state" id="orgMembersEmpty"><div class="ic">👥</div><h3>Chưa có thành viên</h3><p>Bấm “Thêm giảng viên” để thêm giảng viên đang hoạt động vào đơn vị này.</p></div>`;
  const more = hasMore ? `<div class="mt-8"><button class="btn btn-outline" type="button" id="orgMembersMore">TẢI THÊM</button></div>` : "";
  return `<div class="card" id="orgMembersCard"><div class="flex-between" style="flex-wrap:wrap;gap:10px"><div><h3 style="margin:0">👥 Thành viên</h3><div class="small mut">Tên và email chỉ là bản chụp để hiển thị, không phải dữ liệu tài khoản.</div></div>${addButton}</div>${banner}${body}${more}<div id="orgMembersErr" class="error-text hidden mt-8"></div></div>`;
}

export function renderTeacherPickerHtml({ organization, teachers, associations, selected, esc, hasMore }) {
  const rows = teachers.map((teacher) => {
    const assoc = associations.get(teacher.id) || null;
    const disabled = !!assoc;
    return `<label class="flex gap-8" data-picker-row="${esc(teacher.id)}" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid #e2e8f0"><input type="checkbox" data-picker-check="${esc(teacher.id)}"${disabled ? " disabled" : ""}${selected.has(teacher.id) && !disabled ? " checked" : ""}><span><b>${esc(teacher.displayName || "—")}</b><div class="small mut">${esc(teacher.email || "—")}</div>${assoc ? `<div class="small" data-picker-assoc="${esc(teacher.id)}">${esc(assoc.label)}</div>` : ""}</span></label>`;
  }).join("");
  return `<h3>Thêm giảng viên vào “${esc(organization.name || "—")}”</h3>
    <p class="mut small">Chỉ hiển thị giảng viên đang hoạt động. Thành viên được thêm với vai trò <b>Thành viên</b>; không thêm tự động.</p>
    <input type="text" id="orgPickerSearch" placeholder="Tìm theo tên hoặc email trong danh sách đã tải…" autocomplete="off">
    <div id="orgPickerList" style="max-height:320px;overflow:auto" class="mt-8">${rows || `<div class="empty-state" id="orgPickerEmpty">Không có giảng viên đang hoạt động phù hợp.</div>`}</div>
    ${hasMore ? `<div class="mt-8"><button class="btn btn-outline btn-sm" type="button" id="orgPickerMore">TẢI THÊM</button></div>` : ""}
    <div id="orgPickerErr" class="error-text hidden mt-8"></div>
    <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgPickerCancel">Hủy</button><button type="button" class="btn" id="orgPickerSubmit" disabled>THÊM <span id="orgPickerCount">0</span> GIẢNG VIÊN</button></div>`;
}

export function renderMemberConfirmHtml({ action, member, organization, esc }) {
  const copy = {
    suspend: ["Tạm ngưng thành viên?", "Thành viên bị tạm ngưng sẽ không còn quyền trong đơn vị này cho đến khi được khôi phục. Tài khoản HCMA2 của giảng viên không bị ảnh hưởng.", "TẠM NGƯNG", "btn-danger"],
    restore: ["Khôi phục thành viên?", "Thành viên sẽ hoạt động trở lại trong đơn vị này.", "KHÔI PHỤC", "btn-ok"],
    remove: ["Gỡ khỏi đơn vị?", "Thành viên sẽ được đánh dấu là đã gỡ và không còn quyền trong đơn vị này. Hồ sơ thành viên được giữ lại, và tài khoản HCMA2 của giảng viên không bị ảnh hưởng.", "GỠ KHỎI ĐƠN VỊ", "btn-danger"],
    reinstate: ["Đưa thành viên trở lại?", "Thành viên đã gỡ sẽ hoạt động trở lại trong đơn vị này.", "ĐƯA TRỞ LẠI", "btn-ok"]
  }[action];
  return `<h3>${copy[0]}</h3><p><b>${esc(member.displayName || "—")}</b><div class="small mut">${esc(member.email || "—")} · ${esc(organization.name || "—")}</div></p><p class="mut">${copy[1]}</p>
    <div id="orgMemberConfirmErr" class="error-text hidden"></div>
    <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgMemberConfirmCancel">Hủy</button><button type="button" class="btn ${copy[3]}" id="orgMemberConfirmOk">${copy[2]}</button></div>`;
}

// ---------------------------------------------------------------- thin transports (payloads arrive already built by the S2 contract)
export function createMembershipWriter({ collection, doc, writeBatch, updateDoc }) {
  return Object.freeze({
    // Creates each membership with its deterministic id. One batch per chunk (chunk size is an implementation safety default only).
    async createMany(db, items, chunkSize = MEMBERSHIP_WRITE_CHUNK_DEFAULT) {
      let created = 0;
      for (const chunk of chunkMembershipWrites(items, chunkSize)) {
        const batch = writeBatch(db);
        for (const item of chunk) batch.set(doc(collection(db, "organizationMembers"), item.id), item.data);
        await batch.commit();
        created += chunk.length;
      }
      return created;
    },
    update: (db, id, data) => updateDoc(doc(db, "organizationMembers", id), data)
  });
}

// PICKER QUERY - used only by the "Thêm giảng viên" dialog for the explicit purpose of creating memberships. It is a paged,
// bounded read of the existing active-teacher population using the existing live index (users: role, status, createdAt desc).
// It is not a general user directory and is not reachable from anywhere else.
export function createActiveTeacherPickerQuery({ collection, query, where, orderBy, limit, startAfter, getDocs }) {
  return Object.freeze({
    async pageActiveTeachersForMembershipPicker(db, { pageSize = TEACHER_PICKER_PAGE_SIZE, cursor } = {}) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError("pageSize must be an integer from 1 to 100");
      const constraints = [where("role", "==", "teacher"), where("status", "==", "active"), orderBy("createdAt", "desc")];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(pageSize + 1));
      const snapshot = await getDocs(query(collection(db, "users"), ...constraints));
      const documents = snapshot.docs.slice(0, pageSize);
      return {
        teachers: documents.map((d) => { const u = d.data(); return { id: d.id, role: u.role, status: u.status, displayName: u.displayName || "", email: u.email || "" }; }),
        cursor: documents.at(-1) || null,
        hasMore: snapshot.docs.length > pageSize
      };
    }
  });
}

// ---------------------------------------------------------------- controller
// deps: { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
//         queries: { membersOfOrganization, membershipOf }, picker: { pageActiveTeachersForMembershipPicker },
//         contract, writer: { createMany, update } }
export function createOrganizationMembershipSection(deps) {
  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, queries, picker, contract, writer } = deps;
  const modalRoot = () => document.getElementById("globalModal");
  const modal$ = (selector) => modalRoot().querySelector(selector);
  const show = (el, message) => { if (el) { el.textContent = message; el.classList.remove("hidden"); } };
  const hide = (el) => { if (el) { el.textContent = ""; el.classList.add("hidden"); } };

  async function mount(host, organization) {
    if (!host) return;
    if (!isPlatformAdmin) { host.innerHTML = ""; return; }
    let members = [], cursor = null, hasMore = false;
    const section = () => host.querySelector("#orgMembersCard");

    async function loadPage(reset) {
      const page = await queries.membersOfOrganization(db, organization.id, { pageSize: MEMBER_PAGE_SIZE, cursor: reset ? undefined : cursor || undefined });
      members = reset ? page.items : members.concat(page.items);
      cursor = page.cursor; hasMore = page.hasMore;
    }
    function paint() {
      host.innerHTML = renderMembersSectionHtml({ organization, members, hasMore, esc, fmtDate });
      const add = host.querySelector("#orgMemberAddBtn");
      if (add && !add.disabled) add.onclick = openPicker;
      const more = host.querySelector("#orgMembersMore");
      if (more) more.onclick = async () => {
        more.disabled = true;
        try { await loadPage(false); paint(); } catch (error) { show(host.querySelector("#orgMembersErr"), mapError(error)); more.disabled = false; }
      };
      host.querySelectorAll("[data-member-action]").forEach((button) => {
        button.onclick = () => confirmAction(button.dataset.memberAction, members.find((m) => m.id === button.dataset.memberId));
      });
    }
    async function reload() {
      host.innerHTML = `<div class="card"><div class="center-screen" style="min-height:80px"><span class="spinner"></span></div></div>`;
      try { await loadPage(true); paint(); } catch (error) {
        host.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">⚠️</div><p>${esc(mapError(error))}</p><button class="btn btn-outline" type="button" id="orgMembersRetry">THỬ LẠI</button></div></div>`;
        host.querySelector("#orgMembersRetry").onclick = reload;
      }
    }

    function confirmAction(action, member) {
      if (!member || !availableMemberActions(member, organization).includes(action)) return;
      openModal(renderMemberConfirmHtml({ action, member, organization, esc }));
      modal$("#orgMemberConfirmCancel").onclick = closeModal;
      const ok = modal$("#orgMemberConfirmOk");
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          // Fresh read first: never overwrite a state change made elsewhere, and re-check the lifecycle rule against it.
          const fresh = await queries.membershipOf(db, organization.id, member.uid);
          if (!fresh || !availableMemberActions(fresh, organization).includes(action)) { show(modal$("#orgMemberConfirmErr"), "Trạng thái thành viên đã thay đổi. Hãy tải lại danh sách."); return; }
          await writer.update(db, member.id, contract.buildMembershipStatusChange(nextStatusForAction(action), actorUid));
          await logAudit("organization.member." + action, "organizationMember", member.id, { organizationId: organization.id, uid: member.uid, from: fresh.status, to: nextStatusForAction(action) });
          closeModal();
          toast("Đã cập nhật thành viên.", "ok");
          await reload();
        } catch (error) {
          show(modal$("#orgMemberConfirmErr"), mapError(error));
        } finally {
          if (modalRoot() && modal$("#orgMemberConfirmOk")) modal$("#orgMemberConfirmOk").disabled = false;
        }
      };
    }

    async function openPicker() {
      if (organization.status !== "active") return;
      const selected = new Set(), teachers = [], associations = new Map();
      let teacherCursor = null, teacherHasMore = false, filter = "";
      const visible = () => teachers.filter((t) => !filter || `${t.displayName} ${t.email}`.toLowerCase().includes(filter));
      async function fetchTeachers() {
        const page = await picker.pageActiveTeachersForMembershipPicker(db, { pageSize: TEACHER_PICKER_PAGE_SIZE, cursor: teacherCursor || undefined });
        // Exact association lookup (deterministic id) for exactly the teachers just loaded - never a guess from a partial list.
        const found = await Promise.all(page.teachers.map((t) => queries.membershipOf(db, organization.id, t.id)));
        page.teachers.forEach((t, i) => { teachers.push(t); associations.set(t.id, describeAssociation(found[i])); });
        teacherCursor = page.cursor; teacherHasMore = page.hasMore;
      }
      function paintPicker() {
        const keepFilter = filter;
        openModal(renderTeacherPickerHtml({ organization, teachers: visible(), associations, selected, esc, hasMore: teacherHasMore }), true);
        const search = modal$("#orgPickerSearch"); search.value = keepFilter;
        search.oninput = () => { filter = search.value.trim().toLowerCase(); paintPicker(); const s = modal$("#orgPickerSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
        modalRoot().querySelectorAll("[data-picker-check]").forEach((box) => { box.onchange = () => { box.checked ? selected.add(box.dataset.pickerCheck) : selected.delete(box.dataset.pickerCheck); refreshCount(); }; });
        modal$("#orgPickerCancel").onclick = closeModal;
        const more = modal$("#orgPickerMore");
        if (more) more.onclick = async () => { more.disabled = true; try { await fetchTeachers(); paintPicker(); } catch (error) { show(modal$("#orgPickerErr"), mapError(error)); more.disabled = false; } };
        modal$("#orgPickerSubmit").onclick = submit;
        refreshCount();
      }
      function refreshCount() {
        modal$("#orgPickerCount").textContent = String(selected.size);
        modal$("#orgPickerSubmit").disabled = selected.size === 0;
      }
      async function submit() {
        const button = modal$("#orgPickerSubmit");
        button.disabled = true;
        hide(modal$("#orgPickerErr"));
        try {
          const chosen = teachers.filter((t) => selected.has(t.id));
          // Fresh exact lookup immediately before writing; already-associated users are skipped, never overwritten.
          const found = await Promise.all(chosen.map((t) => queries.membershipOf(db, organization.id, t.id)));
          const existingByUid = new Map(chosen.map((t, i) => [t.id, found[i]]));
          const plan = planMembershipAdditions({ organization, candidates: chosen, existingByUid, actorUid, contract });
          if (plan.toCreate.length) {
            await writer.createMany(db, plan.toCreate);
            await logAudit("organization.members.add", "organization", organization.id, { count: plan.toCreate.length, uids: plan.toCreate.slice(0, 50).map((item) => item.data.uid), skipped: plan.skipped.length });
          }
          closeModal();
          toast(plan.skipped.length ? `Đã thêm ${plan.toCreate.length} giảng viên; bỏ qua ${plan.skipped.length} người đã có trong đơn vị.` : `Đã thêm ${plan.toCreate.length} giảng viên.`, "ok");
          await reload();
        } catch (error) {
          show(modal$("#orgPickerErr"), mapError(error));
          refreshCount();
        }
      }
      try { await fetchTeachers(); } catch (error) { toast(mapError(error), "err"); return; }
      paintPicker();
    }

    await reload();
  }
  return Object.freeze({ mount });
}
