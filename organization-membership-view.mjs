// Library V2 P2-S4 / HCMA2 O1 - Platform Admin ORDINARY membership management inside Organization Detail.
// Scope: paged member list; add ONE existing active teacher at a time, found by an explicit bounded email search (O1 exception tool), as an
// ordinary `member` membership; suspend, restore and soft-remove (status `removed`) ordinary members; reinstate a removed member (the
// deployed Rules allow it for the Platform Admin).
// NOT in this module: appoint/revoke/change Organization Admin, capabilities, current-organization wiring, switcher, bootstrap.
// Every Firestore read goes through the S2 query contract (`queries`) or the dedicated email-search query below, and every payload comes from
// the S2 write contract (`contract`); this module never builds a membership payload by hand and never names a membership field of its own.
// Display name / email stored on a membership are SNAPSHOTS for display only - never identity, account status or authorization.

import { chunkMembershipWrites, MEMBERSHIP_WRITE_CHUNK_DEFAULT } from "./organization-write-contract.mjs";

export const MEMBER_PAGE_SIZE = 25;
// O1 exception search. 20 is a per-search UX/result cap only (NOT a business limit or architecture contract); the query asks for one
// more document (21) purely to detect that further matches exist.
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DISPLAY_COUNT = 20;
export const SEARCH_QUERY_LIMIT = SEARCH_DISPLAY_COUNT + 1;
export const SEARCH_MAX_INPUT = 100;
export const EXCEPTION_SEARCH_PROVENANCE = "exception-search";

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
  const rows = members.map((member) => {
    const view = membershipStatusView(member.status);
    const actions = availableMemberActions(member, organization);
    const labels = { suspend: ["TẠM NGƯNG", "btn-outline"], restore: ["KHÔI PHỤC", "btn-ok"], remove: ["GỠ KHỎI ĐƠN VỊ", "btn-danger"], reinstate: ["KHÔI PHỤC THÀNH VIÊN", "btn-ok"] };
    const buttons = actions.map((action) => `<button class="btn btn-sm ${labels[action][1]}" type="button" data-member-action="${action}" data-member-id="${esc(member.id)}">${labels[action][0]}</button>`).join(" ");
    return `<tr data-member-row="${esc(member.id)}"><td><b>${esc(member.displayName || "—")}</b><div class="small mut">${esc(member.email || "—")}</div></td><td>${esc(membershipRoleLabel(member.orgRole))}</td><td><span class="badge ${view.badge}">${view.icon} ${esc(view.label)}</span></td><td>${esc(fmtDate ? fmtDate(member.createdAt) : "—")}</td><td style="text-align:right">${buttons}</td></tr>`;
  }).join("");
  const body = members.length
    ? `<div class="table-wrap mt-8"><table id="orgMembersTable"><thead><tr><th>Giảng viên</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày thêm</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty-state" id="orgMembersEmpty"><div class="ic">👥</div><h3>Chưa có thành viên</h3><p>Bấm “Thêm giảng viên” để thêm giảng viên đang hoạt động vào đơn vị này.</p></div>`;
  const more = hasMore ? `<div class="mt-8"><button class="btn btn-outline" type="button" id="orgMembersMore">TẢI THÊM</button></div>` : "";
  const summary = members.length ? `<div class="small" id="orgMembersSummary" style="font-weight:650">${esc(summarizeMembers(members, hasMore).text)}</div>` : "";
  return `<div class="card" id="orgMembersCard"><div><h3 style="margin:0">👥 Thành viên</h3>${summary}<div class="small mut">Tên và email chỉ là bản chụp để hiển thị, không phải dữ liệu tài khoản.</div></div>${banner}${body}${more}<div id="orgMembersErr" class="error-text hidden mt-8"></div></div>`;
}

// The primary "add teacher" action lives in the upper Organization Detail action area (a placeholder rendered by the detail view),
// not in the member card. Disabled for an archived organization.
export function renderAddTeacherActionHtml({ organization }) {
  const archived = organization.status !== "active";
  return `<button class="btn" type="button" id="orgMemberAddBtn"${archived ? ' disabled title="Đơn vị đã lưu trữ. Khôi phục đơn vị để thêm giảng viên."' : ""}>+ Thêm giảng viên</button>`;
}

// Counts by membership state computed ONLY from the memberships already loaded by the screen (no extra query, no aggregation).
// The member list is paged: while more pages exist the counts are explicitly labelled as covering the loaded members only, so the
// summary is never a misleading global total. Zero-count states are omitted.
export function summarizeMembers(members, hasMore) {
  const count = { total: members.length, active: 0, suspended: 0, removed: 0 };
  for (const member of members) if (member && count[member.status] !== undefined && member.status !== "total") count[member.status] += 1;
  const parts = [[count.active, "hoạt động"], [count.suspended, "tạm ngưng"], [count.removed, "đã gỡ"]].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  const lead = hasMore ? `Đã tải ${count.total} thành viên` : `${count.total} thành viên`;
  const text = [lead, ...parts].join(" · ") + (hasMore ? " — còn thêm, bấm “Tải thêm” để xem đầy đủ" : "");
  return { ...count, partial: !!hasMore, text };
}

// ---------------------------------------------------------------- O1 exception search (pure helpers + markup)
// Normalization of the typed term: trim + lowercase (production emails are all lowercase; Firebase Auth stores the normalized address).
export function normalizeEmailTerm(raw) {
  return String(raw == null ? "" : raw).trim().toLowerCase().slice(0, SEARCH_MAX_INPUT);
}

// Row kind for one account returned by the bounded email search. A membership document (any status) always wins: it is never recreated.
export function classifySearchResult({ user, membership }) {
  const platformOk = !!user && user.role === "teacher" && user.status === "active";
  if (membership) {
    if (membership.orgRole === "org_admin") return { kind: "member-org-admin", status: membership.status, platformOk };
    if (membership.status === "suspended") return { kind: "member-suspended", platformOk };
    if (membership.status === "removed") return { kind: "member-removed", platformOk };
    return { kind: "member-active", platformOk };
  }
  if (platformOk) return { kind: "eligible", platformOk };
  const reason = user && user.role === "admin" ? "admin" : user && user.role === "teacher" && user.status === "pending" ? "pending" : user && user.role === "teacher" && user.status === "suspended" ? "suspended" : "other";
  return { kind: "not-active-teacher", reason, platformOk };
}

const NOT_ADDABLE = { pending: "Tài khoản đang chờ duyệt — chưa thể thêm.", suspended: "Tài khoản đã bị khóa — chưa thể thêm.", admin: "Tài khoản quản trị, không phải giảng viên — không thể thêm.", other: "Không phải giảng viên đang hoạt động — không thể thêm." };
const ARCHIVED_NOTE = "Đơn vị đã được lưu trữ, không thể thêm thành viên.";
function rowNote(row, organization, esc) {
  switch (row.kind) {
    case "eligible": return "Giảng viên đang hoạt động, chưa có trong đơn vị.";
    case "added": return `✅ Đã thêm ${esc(row.user.displayName || row.user.email || "giảng viên")} vào ${esc(organization.name || "đơn vị")}.`;
    case "member-active": return "Đã là thành viên.";
    case "member-suspended": return "Đang tạm ngưng trong đơn vị. Quản lý tại <b>Đơn vị → Thành viên</b>.";
    case "member-removed": return "Đã gỡ khỏi đơn vị. Khôi phục tại <b>Đơn vị → Thành viên → Khôi phục thành viên</b>.";
    case "member-org-admin": return "Là quản trị đơn vị; không thêm lại tại đây.";
    case "archived": return ARCHIVED_NOTE;
    default: return esc(NOT_ADDABLE[row.reason] || NOT_ADDABLE.other);
  }
}

export function renderEmailSearchShellHtml({ organization, term = "", esc }) {
  return `<div id="orgSearchRoot"><h3>Thêm giảng viên</h3>
    <p class="mut small">Đơn vị: <b>${esc(organization.name || "—")}</b>. Dành cho trường hợp ngoại lệ: giảng viên mới được duyệt thường đã được thêm ngay sau khi duyệt.</p>
    <form id="orgSearchForm" novalidate><div class="flex gap-8"><input type="text" id="orgSearchInput" maxlength="${SEARCH_MAX_INPUT}" placeholder="Nhập email giảng viên…" autocomplete="off" value="${esc(term)}" style="flex:1"><button type="submit" class="btn" id="orgSearchBtn">TÌM</button></div></form>
    <div id="orgSearchResults" class="mt-14" style="max-height:340px;overflow:auto"></div>
    <div class="mt-14"><button type="button" class="btn btn-ghost" id="orgSearchClose">ĐÓNG</button></div></div>`;
}

// state: { status: "idle" | "tooShort" | "searching" | "results" | "error", term, rows: [{ user, kind, reason?, busy?, error? }], more, error }
export function renderEmailSearchResultsHtml({ state, organization, esc }) {
  if (organization.status !== "active") return `<div class="empty-state" id="orgSearchArchived">${ARCHIVED_NOTE}</div>`;
  switch (state.status) {
    case "idle": return `<p class="mut small" id="orgSearchHint">Nhập từ ${SEARCH_MIN_CHARS} ký tự đầu của email giảng viên rồi bấm <b>TÌM</b> hoặc nhấn Enter.</p>`;
    case "tooShort": return `<p class="mut small" id="orgSearchHint">Nhập thêm ký tự (tối thiểu ${SEARCH_MIN_CHARS}).</p>`;
    case "searching": return `<div class="center-screen" style="min-height:70px"><span class="spinner"></span></div>`;
    case "error": return `<div class="error-text" id="orgSearchError">${esc(state.error || "Không tìm được.")} Bấm TÌM để thử lại.</div>`;
    default: break;
  }
  const head = `<div class="small mut" id="orgSearchTerm">Kết quả cho “${esc(state.term)}”</div>`;
  if (!state.rows.length) return `${head}<div class="empty-state" id="orgSearchEmpty">Không tìm thấy tài khoản nào có email bắt đầu bằng “${esc(state.term)}”.</div>`;
  const rows = state.rows.map((row) => {
    const id = esc(row.user.id);
    const action = row.kind === "eligible"
      ? `<button type="button" class="btn btn-sm" data-search-add="${id}"${row.busy ? " disabled" : ""}>${row.busy ? "ĐANG THÊM…" : "THÊM VÀO ĐƠN VỊ"}</button>`
      : "";
    const error = row.error ? `<div class="error-text small" data-search-error="${id}">${esc(row.error)} Có thể thử lại.</div>` : "";
    return `<div class="flex-between" data-search-row="${id}" data-search-kind="${esc(row.kind)}" style="gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #e2e8f0"><div><b>${esc(row.user.displayName || "—")}</b><div class="small mut">${esc(row.user.email || "—")}</div><div class="small" data-search-note="${id}">${rowNote(row, organization, esc)}</div>${error}</div><div>${action}</div></div>`;
  }).join("");
  const more = state.more ? `<p class="small mut mt-8" id="orgSearchMore">Có thêm kết quả. Hãy nhập thêm ký tự để thu hẹp tìm kiếm.</p>` : "";
  return `${head}${rows}${more}`;
}

export function renderMemberConfirmHtml({ action, member, organization, esc }) {
  const copy = {
    suspend: ["Tạm ngưng thành viên?", "Thành viên bị tạm ngưng sẽ không còn quyền trong đơn vị này cho đến khi được khôi phục. Tài khoản HCMA2 của giảng viên không bị ảnh hưởng.", "TẠM NGƯNG", "btn-danger"],
    restore: ["Khôi phục thành viên?", "Thành viên sẽ hoạt động trở lại trong đơn vị này.", "KHÔI PHỤC", "btn-ok"],
    remove: ["Gỡ khỏi đơn vị?", "Thành viên sẽ được đánh dấu là đã gỡ và không còn quyền trong đơn vị này. Hồ sơ thành viên được giữ lại, và tài khoản HCMA2 của giảng viên không bị ảnh hưởng.", "GỠ KHỎI ĐƠN VỊ", "btn-danger"],
    reinstate: ["Khôi phục thành viên đã gỡ?", "Thành viên đã gỡ sẽ hoạt động trở lại trong đơn vị này.", "KHÔI PHỤC THÀNH VIÊN", "btn-ok"]
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

// EMAIL SEARCH QUERY - used only by the "Thêm giảng viên" exception dialog, only on an explicit Admin search (Enter / TÌM).
// Bounded: ONE query, email range + orderBy email on Firestore's automatic single-field index (no composite index), limit 21 (the
// 21st document only signals "more exist"). role/status are NOT queried server-side; they are classified over this bounded result.
// It never enumerates the population, never pages and never loops. A term shorter than SEARCH_MIN_CHARS never reaches Firestore.
export function createTeacherEmailSearchQuery({ collection, query, where, orderBy, limit, getDocs }) {
  return Object.freeze({
    async searchByEmailPrefix(db, rawTerm) {
      const term = normalizeEmailTerm(rawTerm);
      if (term.length < SEARCH_MIN_CHARS) throw new RangeError("the search term needs at least " + SEARCH_MIN_CHARS + " characters");
      const snapshot = await getDocs(query(collection(db, "users"), where("email", ">=", term), where("email", "<=", term + String.fromCharCode(0xf8ff)), orderBy("email"), limit(SEARCH_QUERY_LIMIT)));
      const documents = snapshot.docs.slice(0, SEARCH_DISPLAY_COUNT);
      return {
        term,
        users: documents.map((d) => { const u = d.data(); return { id: d.id, role: u.role, status: u.status, displayName: u.displayName || "", email: u.email || "" }; }),
        more: snapshot.docs.length > SEARCH_DISPLAY_COUNT
      };
    }
  });
}

// Stale-result protection for repeated manual searches and dialog close: only the latest token is current; invalidate() ends all of them.
export function createSequenceGuard() {
  let current = 0;
  return Object.freeze({ next: () => ++current, isCurrent: (token) => token === current, invalidate: () => { current += 1; } });
}

// O1 write core (DOM-free, never throws). One teacher, one Organization. Fresh re-checks immediately before the write:
// user still teacher/active, Organization still active, exact membership still absent. Uses the unchanged S4 contract path.
// deps: { readUser(db, uid), queries: { organizationById, membershipOf }, contract, writer: { createMany }, logAudit }
export async function addTeacherFromSearch({ db, actorUid, organization, uid, deps }) {
  const { readUser, queries, contract, writer, logAudit } = deps;
  try {
    const fresh = await readUser(db, uid);
    if (!fresh || fresh.role !== "teacher" || fresh.status !== "active") return { outcome: "not-active-teacher", user: fresh || null };
    const current = await queries.organizationById(db, organization.id);
    if (!current || current.status !== "active") return { outcome: "organization-archived" };
    const existing = await queries.membershipOf(db, organization.id, uid);
    if (existing) return { outcome: "already-associated", membership: existing, user: fresh };
    const plan = planMembershipAdditions({ organization: current, candidates: [{ id: uid, role: fresh.role, status: fresh.status, displayName: fresh.displayName || "", email: fresh.email || "" }], existingByUid: new Map([[uid, null]]), actorUid, contract });
    if (!plan.toCreate.length) return { outcome: "not-eligible", user: fresh };
    await writer.createMany(db, plan.toCreate);
    try { await logAudit("organization.members.add", "organization", organization.id, { count: 1, uids: [uid], skipped: 0, via: EXCEPTION_SEARCH_PROVENANCE }); } catch { /* best-effort, like the rest of the audit trail */ }
    return { outcome: "created", user: fresh };
  } catch (error) {
    return { outcome: "failed", error };
  }
}

// ---------------------------------------------------------------- controller
// deps: { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
//         queries: { membersOfOrganization, membershipOf, organizationById }, teacherSearch: { searchByEmailPrefix }, readUser(db, uid),
//         contract, writer: { createMany, update } }
export function createOrganizationMembershipSection(deps) {
  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, queries, teacherSearch, readUser, contract, writer } = deps;
  const modalRoot = () => document.getElementById("globalModal");
  const modal$ = (selector) => modalRoot().querySelector(selector);
  const show = (el, message) => { if (el) { el.textContent = message; el.classList.remove("hidden"); } };
  const hide = (el) => { if (el) { el.textContent = ""; el.classList.add("hidden"); } };

  async function mount(host, organization) {
    if (!host) return;
    if (!isPlatformAdmin) { host.innerHTML = ""; return; }
    // Primary action in the upper Organization Detail action area (single instance; not repeated in the member card).
    const actionHost = host.ownerDocument.querySelector("#orgPrimaryActions");
    if (actionHost) {
      actionHost.innerHTML = renderAddTeacherActionHtml({ organization });
      const add = actionHost.querySelector("#orgMemberAddBtn");
      if (add && !add.disabled) add.onclick = openPicker;
    }
    let members = [], cursor = null, hasMore = false;
    const section = () => host.querySelector("#orgMembersCard");

    async function loadPage(reset) {
      const page = await queries.membersOfOrganization(db, organization.id, { pageSize: MEMBER_PAGE_SIZE, cursor: reset ? undefined : cursor || undefined });
      members = reset ? page.items : members.concat(page.items);
      cursor = page.cursor; hasMore = page.hasMore;
    }
    function paint() {
      host.innerHTML = renderMembersSectionHtml({ organization, members, hasMore, esc, fmtDate });
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

    // O1: explicit, bounded email search (Enter / TÌM only; no auto-search, no population listing); one teacher per click.
    let dialogCounter = 0;
    async function openPicker() {
      if (organization.status !== "active") return;
      const dialog = ++dialogCounter;
      const guard = createSequenceGuard();
      let state = { status: "idle", term: "", rows: [], more: false };
      const alive = () => dialog === dialogCounter && !!document.querySelector(`#globalModal #orgSearchRoot`) && modalRoot().dataset.orgSearchDialog === String(dialog);
      const onKey = (event) => {
        if (!alive()) { document.removeEventListener("keydown", onKey); return; }
        if (event.key === "Escape") { document.removeEventListener("keydown", onKey); guard.invalidate(); closeModal(); }
      };
      openModal(renderEmailSearchShellHtml({ organization, esc }), true);
      modalRoot().dataset.orgSearchDialog = String(dialog);
      document.addEventListener("keydown", onKey);
      const paint = () => { if (!alive()) return; const box = modal$("#orgSearchResults"); box.innerHTML = renderEmailSearchResultsHtml({ state, organization, esc }); box.querySelectorAll("[data-search-add]").forEach((button) => { button.onclick = () => addTeacher(button.dataset.searchAdd); }); };
      const close = () => { guard.invalidate(); document.removeEventListener("keydown", onKey); closeModal(); };
      modal$("#orgSearchClose").onclick = close;
      const input = modal$("#orgSearchInput");
      input.focus();
      paint();

      async function search() {
        const term = normalizeEmailTerm(input.value);
        const mySeq = guard.next();                                  // any newer search, a close or Esc invalidates this one
        if (term.length < SEARCH_MIN_CHARS) { state = { status: "tooShort", term, rows: [], more: false }; paint(); return; }   // no Firestore query
        state = { status: "searching", term, rows: [], more: false }; paint();
        try {
          const found = await teacherSearch.searchByEmailPrefix(db, term);
          const memberships = await Promise.all(found.users.map((user) => queries.membershipOf(db, organization.id, user.id)));
          if (!alive() || !guard.isCurrent(mySeq)) return;          // stale result: dropped silently
          state = { status: "results", term, more: found.more, rows: found.users.map((user, i) => ({ user, ...classifySearchResult({ user, membership: memberships[i] }) })) };
        } catch (error) {
          if (!alive() || !guard.isCurrent(mySeq)) return;
          state = { status: "error", term, rows: [], more: false, error: mapError(error) };
        }
        paint();
      }
      modal$("#orgSearchForm").onsubmit = (event) => { event.preventDefault(); search(); };

      async function addTeacher(uid) {
        const row = state.rows.find((r) => r.user.id === uid);
        if (!row || row.kind !== "eligible" || row.busy) return;   // double-click / stale button protection
        row.busy = true; row.error = null; paint();
        const out = await addTeacherFromSearch({ db, actorUid, organization, uid, deps: { readUser, queries, contract, writer, logAudit } });
        if (out.outcome === "created") {
          row.kind = "added"; row.user = { ...row.user, displayName: out.user.displayName || row.user.displayName, email: out.user.email || row.user.email };
          toast(`Đã thêm ${row.user.displayName || row.user.email || "giảng viên"} vào ${organization.name || "đơn vị"}.`, "ok");
          reload();                                                 // member list behind the dialog: newest-first, the teacher is at the top
        } else if (out.outcome === "not-active-teacher") {
          Object.assign(row, { user: { ...row.user, ...(out.user || {}) } }, classifySearchResult({ user: out.user, membership: null }));
        } else if (out.outcome === "organization-archived") {
          row.kind = "archived";
        } else if (out.outcome === "already-associated") {
          Object.assign(row, classifySearchResult({ user: out.user, membership: out.membership }));
        } else {
          row.error = out.outcome === "failed" ? mapError(out.error) : "Không đủ điều kiện để thêm.";
        }
        row.busy = false; paint();
      }
    }

    await reload();
  }
  return Object.freeze({ mount });
}
