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
const OPTIONAL = `<p class="mt-14"><b>Bước tiếp theo (tùy chọn)</b></p><p class="mut">Tài khoản đã được duyệt. Anh/chị có thể thêm giảng viên vào đơn vị ngay hoặc thực hiện sau. Bỏ qua hoặc đóng hộp thoại không hủy việc duyệt.</p>`;

export function renderEnrollmentHtml({ token, teacher, view, outcomes = new Map(), busy = false, loadError = null, doneInfo = null, esc }) {
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
  if (doneInfo) {
    const names = doneInfo.organizationNames.map((n) => esc(n)).join(", ");
    return root(`${BANNER(teacher, esc)}<div class="card mt-14" id="orgEnrollDone" style="border-color:#16a34a"><b>✅ Đã thêm ${esc(doneInfo.teacherName)} vào ${names}.</b><div class="small mut mt-8">Giảng viên đã là thành viên. Xem tại Đơn vị → Thành viên.</div></div><div class="mt-14"><button type="button" class="btn" id="orgEnrollClose">ĐÓNG</button></div>`);
  }
  const memberLabel = (membership) => describeAssociation(membership).label;
  const createdNames = view.rows.filter((row) => { const o = outcomes.get(row.organization.id); return o && o.outcome === "created"; }).map((row) => row.organization.name || "—");
  const partialLine = createdNames.length ? `<div class="mt-14" id="orgEnrollPartial" style="color:#15803d"><b>✅ Đã thêm ${esc(teacher ? teacher.displayName || teacher.email || "giảng viên" : "giảng viên")} vào ${createdNames.map((n) => esc(n)).join(", ")}.</b></div>` : "";
  const rows = view.rows.map((row) => {
    const id = row.organization.id;
    const out = outcomes.get(id);
    const head = `<b>${esc(row.organization.name || "—")}</b>${row.organization.code ? `<div class="small mut">Mã đơn vị: ${esc(row.organization.code)}</div>` : ""}`;
    const rowStyle = 'padding:8px 0;border-bottom:1px solid #e2e8f0';
    const info = (icon, note) => `<div class="flex gap-8" data-enroll-row="${esc(id)}" data-enroll-info style="align-items:flex-start;${rowStyle}"><span aria-hidden="true">${icon}</span><span>${head}<div class="small" data-enroll-note="${esc(id)}">${note}</div></span></div>`;
    const manage = (label) => `${esc(label)}. Không thêm lại tại đây — quản lý hoặc khôi phục tại <b>Đơn vị → Thành viên</b>.`;
    if (out && out.outcome === "created") return info("✅", "Đã thêm vào đơn vị.");
    if (out && out.outcome === "already-associated") return info("ℹ️", manage(memberLabel(out.membership || { status: out.membershipStatus })));
    if (out && (out.outcome === "organization-archived" || out.outcome === "organization-missing" || out.outcome === "blocked" || out.outcome === "skipped")) return info("⚠️", esc(out.message || "Đã bỏ qua."));
    if (row.association) return info("ℹ️", row.association.status === "suspended" || row.association.status === "removed" ? manage(row.association.label) : `${esc(row.association.label)}. Giảng viên đã là thành viên; không cần thêm lại.`);
    const failed = out && out.outcome === "failed" ? `<div class="error-text small" data-enroll-note="${esc(id)}">❌ ${esc(out.message || "Không thêm được.")} Có thể thử lại.</div>` : "";
    const checked = out ? !!out.retrySelected : row.preselected;
    return `<label class="flex gap-8" data-enroll-row="${esc(id)}" style="align-items:flex-start;${rowStyle}"><input type="checkbox" data-enroll-org="${esc(id)}"${busy ? " disabled" : ""}${checked ? " checked" : ""}><span>${head}${failed}</span></label>`;
  }).join("");
  const truncatedNote = view.truncated ? `<p class="small mut mt-8">Hiển thị ${view.rows.length} đơn vị đầu tiên; thêm vào các đơn vị khác từ màn hình Đơn vị.</p>` : "";
  const anyFailed = [...outcomes.values()].some((o) => o.outcome === "failed");
  const canSubmit = view.kind === "choose" || anyFailed;
  const addLabel = busy ? "ĐANG THÊM…" : anyFailed ? "THỬ LẠI" : "THÊM VÀO ĐƠN VỊ";
  const intro = view.kind === "already"
    ? `<p class="mut mt-14">Không có đơn vị nào để thêm: giảng viên đã có hồ sơ thành viên ở đơn vị bên dưới.</p>`
    : view.mode === "single" ? `<p class="mt-14"><b>Đơn vị:</b></p>` : `<p class="mt-14"><b>Chọn đơn vị</b> (có thể chọn nhiều đơn vị):</p>`;
  const buttons = view.kind === "already"
    ? `<div class="mt-14"><button type="button" class="btn" id="orgEnrollClose">ĐÓNG</button></div>`
    : `<div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgEnrollLater"${busy ? " disabled" : ""}>ĐỂ SAU</button><button type="button" class="btn" id="orgEnrollAdd"${busy || !canSubmit ? " disabled" : ""}>${addLabel}</button></div>`;
  return root(`${BANNER(teacher, esc)}${view.kind === "already" ? "" : OPTIONAL}${partialLine}${intro}<div id="orgEnrollList">${rows}</div>${truncatedNote}<div id="orgEnrollErr" class="error-text hidden mt-8"></div>${buttons}`);
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
      if (existing) { results.push({ organizationId, outcome: "already-associated", membershipStatus: existing.status, membership: existing, message: "Đã có trong đơn vị." }); continue; }
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
      let teacher = null, view = null, outcomes = new Map(), busy = false, doneInfo = null;
      const onKey = (event) => {
        if (!live(token)) { document.removeEventListener("keydown", onKey); return; }
        if (event.key === "Escape") { document.removeEventListener("keydown", onKey); closeModal(); }
      };
      document.addEventListener("keydown", onKey);
      openModal(renderEnrollmentHtml({ token, teacher: null, view: "loading", esc }));

      const render = () => paintInto(renderEnrollmentHtml({ token, teacher, view, outcomes, busy, doneInfo, esc }));
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
        outcomes = new Map(); view = null; teacher = null; doneInfo = null;
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
        const nameOf = (id) => { const row = view && view.rows ? view.rows.find((x) => x.organization.id === id) : null; return row ? row.organization.name || "—" : "đơn vị"; };
        const who = (teacher && (teacher.displayName || teacher.email)) || "giảng viên";
        if (created.length) toast(created.length === 1 ? `Đã thêm ${who} vào ${nameOf(created[0].organizationId)}.` : `Đã thêm ${who} vào ${created.length} đơn vị.`, "ok");
        if (!problems.length) { doneInfo = { teacherName: who, organizationNames: created.map((x) => nameOf(x.organizationId)) }; render(); return; }
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
