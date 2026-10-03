// Library V2 teacher onboarding - slice O2: the OPTIONAL Organization-membership continuation shown AFTER a Platform Admin has
// successfully approved a teacher account (Model 3, Owner decision 2026-10-03).
//  - Account approval (`approveTeacher`, V1) is already committed when this module runs; nothing here can undo, delay or fail it.
//  - Membership stays a separate, authoritative `organizationMembers` write built ONLY by the S2/S4 contract (ordinary `member`).
//  - Nothing is ever written to `users`; the only `users` access is one fresh READ injected as `readUser`.
//  - Skipping, closing, Esc, backdrop or a failure leaves the teacher an active teacher without membership (a valid exception state).
//  - No Organization is special: with exactly one active Organization it is preselected as a UI convenience read from live data; with
//    several, nothing is preselected. No Organization code or id is written anywhere in this file.
// Firestore functions are injected (no Firebase import) so the module is unit-testable.

import { planMembershipAdditions, describeAssociation } from "./organization-membership-view.mjs";

// Bounded defensive query size for the active-Organization read: one more than the number shown, so the UI can tell that more exist.
// This is NOT a business limit, schema constraint or architecture rule.
export const ACTIVE_ORGANIZATION_DISPLAY_COUNT = 20;
export const ACTIVE_ORGANIZATION_QUERY_LIMIT = ACTIVE_ORGANIZATION_DISPLAY_COUNT + 1;
export const AUDIT_PROVENANCE = "teacher-approval";

export function createActiveOrganizationLookup({ collection, query, where, limit, getDocs }) {
  return Object.freeze({
    // One equality filter on `status` (automatic single-field index: no composite index) and a bounded limit; no orderBy.
    async listActiveOrganizations(db) {
      const snapshot = await getDocs(query(collection(db, "organizations"), where("status", "==", "active"), limit(ACTIVE_ORGANIZATION_QUERY_LIMIT)));
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const organizations = all.slice(0, ACTIVE_ORGANIZATION_DISPLAY_COUNT).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi"));
      return { organizations, truncated: all.length > ACTIVE_ORGANIZATION_DISPLAY_COUNT };
    }
  });
}

// ---------------------------------------------------------------- decision (pure)
const isActiveTeacher = (user) => !!user && user.role === "teacher" && user.status === "active";

// teacher: fresh user document ({id, role, status, displayName, email}) or null; organizations: active Organizations (<= display count);
// associations: Map organizationId -> existing membership document | null (exact lookups).
export function decideEnrollmentView({ teacher, organizations, truncated = false, associations = new Map() }) {
  if (!isActiveTeacher(teacher)) return { kind: "blocked", reason: "not-active-teacher", rows: [], truncated: false };
  if (!organizations.length) return { kind: "none", rows: [], truncated: false };
  const preselect = organizations.length === 1 && !truncated;
  const rows = organizations.map((organization) => {
    const association = describeAssociation(associations.get(organization.id) || null);
    const selectable = !association;
    return { organization, association, selectable, preselected: preselect && selectable };
  });
  if (rows.every((r) => !r.selectable)) return { kind: "already", rows, truncated };
  return { kind: "choose", mode: organizations.length === 1 ? "single" : "multi", rows, truncated };
}

// ---------------------------------------------------------------- markup (pure; every dynamic text goes through the injected escaper)
const BANNER = (teacher, esc) => `<div class="card" style="border-color:#16a34a"><b>✅ Đã duyệt tài khoản giảng viên</b>${teacher ? `<div class="mt-8"><b>${esc(teacher.displayName || "—")}</b><div class="small mut">${esc(teacher.email || "—")}</div></div>` : ""}</div>`;
const OPTIONAL = `<p class="mut mt-14"><b>Bước tiếp theo (tùy chọn):</b> thêm giảng viên vào đơn vị. Việc duyệt đã hoàn tất; chọn <b>ĐỂ SAU</b>, đóng hộp thoại, nhấn Esc hoặc bấm ra ngoài sẽ <b>không</b> hủy việc duyệt.</p>`;

export function renderEnrollmentHtml({ token, teacher, view, outcomes = new Map(), busy = false, loadError = null, esc }) {
  const root = (inner) => `<div id="orgEnrollRoot" data-enroll-token="${token}">${inner}</div>`;
  if (view === "loading") return root(`${BANNER(teacher, esc)}<div class="center-screen" style="min-height:90px"><span class="spinner"></span></div>`);
  if (loadError) {
    return root(`${BANNER(teacher, esc)}${OPTIONAL}<div id="orgEnrollErr" class="error-text">${esc(loadError)}</div><div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgEnrollClose">ĐỂ SAU</button><button type="button" class="btn" id="orgEnrollRetry">THỬ LẠI</button></div>`);
  }
  if (view.kind === "blocked") {
    return root(`${BANNER(teacher, esc)}<p class="mut mt-14">Không thể thêm vào đơn vị lúc này: tài khoản không còn là giảng viên đang hoạt động. Việc duyệt trước đó không bị ảnh hưởng.</p><div class="mt-14"><button type="button" class="btn" id="orgEnrollClose">ĐÓNG</button></div>`);
  }
  if (view.kind === "none") {
    return root(`${BANNER(teacher, esc)}<p class="mut mt-14">Chưa có đơn vị nào đang hoạt động. Giảng viên đã có thể sử dụng hệ thống; bạn có thể thêm vào đơn vị sau.</p><div class="mt-14"><button type="button" class="btn" id="orgEnrollClose">ĐÓNG</button></div>`);
  }
  const rows = view.rows.map((row) => {
    const out = outcomes.get(row.organization.id);
    let note = "";
    if (row.association) note = `<div class="small" data-enroll-note="${esc(row.organization.id)}">${esc(row.association.label)} — quản lý trong mục Thành viên của đơn vị.</div>`;
    if (out && out.outcome === "created") note = `<div class="small" data-enroll-note="${esc(row.organization.id)}">✅ Đã thêm vào đơn vị.</div>`;
    else if (out && out.outcome === "failed") note = `<div class="error-text small" data-enroll-note="${esc(row.organization.id)}">❌ ${esc(out.message || "Không thêm được.")} Có thể thử lại.</div>`;
    else if (out && out.outcome && out.outcome !== "already-associated") note = `<div class="small" data-enroll-note="${esc(row.organization.id)}">⚠️ ${esc(out.message || "Đã bỏ qua.")}</div>`;
    const done = !!(out && (out.outcome === "created" || out.outcome === "already-associated" || out.outcome === "organization-archived" || out.outcome === "organization-missing"));
    const disabled = !row.selectable || done || busy;
    const checked = !disabled && (out ? !!out.retrySelected : row.preselected);
    return `<label class="flex gap-8" data-enroll-row="${esc(row.organization.id)}" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid #e2e8f0"><input type="checkbox" data-enroll-org="${esc(row.organization.id)}"${disabled ? " disabled" : ""}${checked ? " checked" : ""}><span><b>${esc(row.organization.name || "—")}</b> <code>${esc(row.organization.code || "")}</code>${note}</span></label>`;
  }).join("");
  const truncatedNote = view.truncated ? `<p class="small mut mt-8">Hiển thị ${view.rows.length} đơn vị đầu tiên; thêm vào các đơn vị khác từ màn hình Đơn vị.</p>` : "";
  const anyFailed = [...outcomes.values()].some((o) => o.outcome === "failed");
  const canSubmit = view.kind === "choose" || anyFailed;
  const addLabel = busy ? "ĐANG THÊM…" : anyFailed ? "THỬ LẠI" : "THÊM VÀO ĐƠN VỊ";
  const intro = view.kind === "already"
    ? `<p class="mut mt-14">Giảng viên đã thuộc đơn vị. Không cần thêm lại.</p>`
    : view.mode === "single" ? `<p class="mt-14"><b>Đơn vị:</b></p>` : `<p class="mt-14"><b>Chọn đơn vị</b> (có thể chọn nhiều đơn vị):</p>`;
  const buttons = view.kind === "already"
    ? `<div class="mt-14"><button type="button" class="btn" id="orgEnrollClose">ĐÓNG</button></div>`
    : `<div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgEnrollLater"${busy ? " disabled" : ""}>ĐỂ SAU</button><button type="button" class="btn" id="orgEnrollAdd"${busy || !canSubmit ? " disabled" : ""}>${addLabel}</button></div>`;
  return root(`${BANNER(teacher, esc)}${view.kind === "already" ? "" : OPTIONAL}${intro}<div id="orgEnrollList">${rows}</div>${truncatedNote}<div id="orgEnrollErr" class="error-text hidden mt-8"></div>${buttons}`);
}

// ---------------------------------------------------------------- core write path (DOM-free; never throws)
// deps: { readUser(db, uid), queries: { organizationById, membershipOf }, contract, writer: { createMany }, logAudit }
// For EACH selected Organization, in order and independently: fresh teacher check -> fresh Organization check -> exact membership lookup
// -> write through the S4 contract (ordinary `member`) -> best-effort audit. One failure never undoes another Organization or the approval.
export async function enrollTeacherInOrganizations({ db, actorUid, uid, organizationIds, deps }) {
  const { readUser, queries, contract, writer, logAudit } = deps;
  const results = [];
  let teacher = null, blocked = null;
  for (const organizationId of [...new Set(organizationIds || [])]) {
    if (blocked) { results.push({ organizationId, outcome: "blocked", message: "Tài khoản không còn là giảng viên đang hoạt động." }); continue; }
    try {
      teacher = await readUser(db, uid);
      if (!isActiveTeacher(teacher)) { blocked = "not-active-teacher"; results.push({ organizationId, outcome: "blocked", message: "Tài khoản không còn là giảng viên đang hoạt động." }); continue; }
      const organization = await queries.organizationById(db, organizationId);
      if (!organization) { results.push({ organizationId, outcome: "organization-missing", message: "Không tìm thấy đơn vị." }); continue; }
      if (organization.status !== "active") { results.push({ organizationId, outcome: "organization-archived", message: "Đơn vị đã được lưu trữ, không thể thêm thành viên." }); continue; }
      const existing = await queries.membershipOf(db, organizationId, uid);
      if (existing) { results.push({ organizationId, outcome: "already-associated", membershipStatus: existing.status, message: "Đã có trong đơn vị." }); continue; }
      const plan = planMembershipAdditions({
        organization, actorUid, contract, existingByUid: new Map([[uid, null]]),
        candidates: [{ id: uid, role: teacher.role, status: teacher.status, displayName: teacher.displayName || "", email: teacher.email || "" }]
      });
      if (!plan.toCreate.length) { results.push({ organizationId, outcome: "skipped", message: "Không đủ điều kiện để thêm." }); continue; }
      await writer.createMany(db, plan.toCreate);
      results.push({ organizationId, outcome: "created" });
      try { await logAudit("organization.members.add", "organization", organizationId, { count: 1, uids: [uid], skipped: 0, via: AUDIT_PROVENANCE }); } catch { /* best-effort, exactly like the rest of the audit trail */ }
    } catch (error) {
      results.push({ organizationId, outcome: "failed", error, message: "Không thêm được vào đơn vị." });
    }
  }
  return { blocked, teacher, results };
}

// ---------------------------------------------------------------- controller (modal) - offerAfterApproval never rejects
// deps: { db, getActorUid, isPlatformAdmin, esc, toast, mapError, openModal, closeModal, logAudit, readUser, orgLookup, queries, contract, writer }
export function createTeacherEnrollmentFlow(deps) {
  const { db, getActorUid, isPlatformAdmin, esc, toast, mapError, openModal, closeModal, logAudit, readUser, orgLookup, queries, contract, writer } = deps;
  let sequence = 0;
  const live = (token) => token === sequence && !!document.querySelector(`#globalModal #orgEnrollRoot[data-enroll-token="${token}"]`);

  async function offerAfterApproval(uid) {
    try {
      if (!isPlatformAdmin()) return;
      const token = ++sequence;                       // a newer approval replaces this prompt: that is equivalent to ĐỂ SAU
      const host = () => document.getElementById("globalModal");
      const paintInto = (html) => { if (live(token)) { host().querySelector(".modal").innerHTML = html; wire(); } };
      let teacher = null, view = null, outcomes = new Map(), busy = false;
      const onKey = (event) => {
        if (!live(token)) { document.removeEventListener("keydown", onKey); return; }
        if (event.key === "Escape") { document.removeEventListener("keydown", onKey); closeModal(); }
      };
      document.addEventListener("keydown", onKey);
      openModal(renderEnrollmentHtml({ token, teacher: null, view: "loading", esc }));

      const render = () => paintInto(renderEnrollmentHtml({ token, teacher, view, outcomes, busy, esc }));
      const later = () => { document.removeEventListener("keydown", onKey); closeModal(); };

      function wire() {
        const root = host() && host().querySelector("#orgEnrollRoot");
        if (!root) return;
        const closeButton = root.querySelector("#orgEnrollClose") || root.querySelector("#orgEnrollLater");
        if (closeButton) closeButton.onclick = later;
        const retry = root.querySelector("#orgEnrollRetry");
        if (retry) retry.onclick = load;
        const add = root.querySelector("#orgEnrollAdd");
        const boxes = () => [...root.querySelectorAll("[data-enroll-org]")];
        const refresh = () => { if (add && !busy) add.disabled = !boxes().some((b) => b.checked && !b.disabled); };
        boxes().forEach((b) => { b.onchange = refresh; });
        refresh();
        if (add) add.onclick = submit;
      }

      async function load() {
        outcomes = new Map(); view = null; teacher = null;
        if (live(token)) host().querySelector(".modal").innerHTML = renderEnrollmentHtml({ token, teacher: null, view: "loading", esc });
        let fresh, listing, associations = new Map();
        try {
          [fresh, listing] = await Promise.all([readUser(db, uid), orgLookup.listActiveOrganizations(db)]);
          if (!live(token)) return;
          if (isActiveTeacher(fresh)) {
            const found = await Promise.all(listing.organizations.map((o) => queries.membershipOf(db, o.id, uid)));
            listing.organizations.forEach((o, i) => associations.set(o.id, found[i]));
          }
        } catch (error) {
          if (live(token)) paintInto(renderEnrollmentHtml({ token, teacher: null, view: null, loadError: "Không tải được danh sách đơn vị: " + mapError(error), esc }));
          return;
        }
        if (!live(token)) return;
        teacher = fresh;
        view = decideEnrollmentView({ teacher: fresh, organizations: listing.organizations, truncated: listing.truncated, associations });
        render();
      }

      async function submit() {
        const root = host() && host().querySelector("#orgEnrollRoot");
        if (!root || busy) return;
        const ids = [...root.querySelectorAll("[data-enroll-org]")].filter((b) => b.checked && !b.disabled).map((b) => b.dataset.enrollOrg);
        if (!ids.length) return;
        busy = true; render();
        const outcome = await enrollTeacherInOrganizations({ db, actorUid: getActorUid(), uid, organizationIds: ids, deps: { readUser, queries, contract, writer, logAudit } });
        busy = false;
        if (!live(token)) {
          // The prompt was dismissed/replaced while writing: the writes that happened are real; just report them.
          const made = outcome.results.filter((r) => r.outcome === "created").length;
          if (made) toast(`Đã thêm giảng viên vào ${made} đơn vị.`, "ok");
          return;
        }
        for (const r of outcome.results) outcomes.set(r.organizationId, { ...r, retrySelected: r.outcome === "failed" });
        const created = outcome.results.filter((r) => r.outcome === "created");
        const problems = outcome.results.filter((r) => r.outcome !== "created");
        if (created.length) toast(created.length === 1 ? "Đã thêm giảng viên vào đơn vị." : `Đã thêm giảng viên vào ${created.length} đơn vị.`, "ok");
        if (!problems.length) { document.removeEventListener("keydown", onKey); closeModal(); return; }
        if (outcome.blocked) view = decideEnrollmentView({ teacher: null, organizations: [] });
        render();
      }

      await load();
    } catch (error) {
      try { console.warn("organization enrollment continuation", error); } catch { /* never propagate */ }
    }
  }
  return Object.freeze({ offerAfterApproval });
}
