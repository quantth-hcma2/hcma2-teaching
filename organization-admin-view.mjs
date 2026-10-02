// Library V2 P2-S3 - Platform Admin organization lifecycle screen: list, create, basic detail, rename, archive, restore.
// UI only. Every Firestore read goes through the S2 query contract and every payload through the S2 write contract (injected as
// `queries` / `contract`); this module never builds a Firestore payload and never names a collection. Membership management,
// capabilities, Organization-Admin screens and context wiring are NOT part of this slice.
// Pure helpers (slug, validation, markup) are unit-tested; `createOrganizationAdminScreen` wires them to the DOM with injected dependencies.

import { validateOrganizationCode, validateOrganizationName, NAME_MIN, NAME_MAX } from "./organization-write-contract.mjs";

export const ORGANIZATION_LIST_LIMIT = 100;
const COMBINING_MARKS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

const STATUS_VIEW = {
  active: { label: "Đang hoạt động", badge: "badge-green", icon: "🟢" },
  archived: { label: "Đã lưu trữ", badge: "badge-gray", icon: "📦" }
};
export function organizationStatusView(status) {
  return STATUS_VIEW[status] || { label: "Không xác định", badge: "badge-gray", icon: "❔" };
}

// Suggest a business code from a display name: lower-case ASCII, digits and hyphens (Vietnamese diacritics removed).
export function slugifyOrganizationCode(name) {
  const base = String(name == null ? "" : name)
    .normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d").replace(/Đ/g, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, 40).replace(/-+$/g, "");
}

export function normalizeOrganizationCode(code) {
  return String(code == null ? "" : code).trim().toLowerCase();
}

// Codes shared by more than one organization (a race between two administrators can produce this; codes cannot be edited later).
export function findDuplicateCodes(organizations) {
  const byCode = new Map();
  for (const org of organizations || []) {
    const code = normalizeOrganizationCode(org && org.code);
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(org);
  }
  return [...byCode.entries()].filter(([, list]) => list.length > 1).map(([code, list]) => ({ code, organizations: list }));
}

// Validation for the create form. `existing` is a FRESH list of all organizations (active and archived).
export function validateCreateInput({ name, code } = {}, existing = []) {
  const fieldErrors = {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanCode = normalizeOrganizationCode(code);
  try { validateOrganizationName(cleanName); } catch { fieldErrors.name = `Tên đơn vị cần từ ${NAME_MIN} đến ${NAME_MAX} ký tự.`; }
  try { validateOrganizationCode(cleanCode); } catch {
    fieldErrors.code = "Mã đơn vị gồm 3–40 ký tự: chữ thường không dấu, số và dấu gạch ngang (không bắt đầu hoặc kết thúc bằng dấu gạch ngang).";
  }
  if (!fieldErrors.code) {
    const clash = (existing || []).find((org) => normalizeOrganizationCode(org && org.code) === cleanCode);
    if (clash) fieldErrors.code = `Mã “${cleanCode}” đã được dùng bởi đơn vị “${clash.name || "—"}”${clash.status === "archived" ? " (đã lưu trữ)" : ""}. Hãy chọn mã khác.`;
  }
  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors, name: cleanName, code: cleanCode };
}

// ---------------------------------------------------------------- markup (all dynamic text goes through the injected escaper)
export function renderOrganizationListHtml({ organizations, esc, fmtDate, truncated = false, duplicates = [] }) {
  const warning = duplicates.length
    ? `<div class="card mt-14" role="alert" style="border-color:#f59e0b"><b>⚠️ Có đơn vị trùng mã.</b><div class="small mut mt-8">${duplicates.map((d) => `Mã “${esc(d.code)}”: ${d.organizations.map((o) => esc(o.name || "—")).join(", ")}`).join("<br>")}</div><div class="small mut mt-8">Mã không thể đổi. Hãy lưu trữ đơn vị tạo nhầm.</div></div>`
    : "";
  const body = organizations.length
    ? `<div class="table-wrap mt-14"><table id="orgTable"><thead><tr><th>Tên đơn vị</th><th>Mã</th><th>Trạng thái</th><th>Ngày tạo</th><th></th></tr></thead><tbody>${organizations.map((org) => {
      const v = organizationStatusView(org.status);
      return `<tr data-org-row="${esc(org.id)}"><td><b>${esc(org.name || "—")}</b></td><td><code>${esc(org.code || "—")}</code></td><td><span class="badge ${v.badge}">${v.icon} ${esc(v.label)}</span></td><td>${esc(fmtDate ? fmtDate(org.createdAt) : "—")}</td><td style="text-align:right"><button class="btn btn-sm btn-outline" type="button" data-org-open="${esc(org.id)}">CHI TIẾT</button></td></tr>`;
    }).join("")}</tbody></table></div>`
    : `<div class="card mt-14"><div class="empty-state" id="orgEmpty"><div class="ic">🏢</div><h3>Chưa có đơn vị nào</h3><p>Bấm “Tạo đơn vị” để thêm đơn vị đầu tiên.</p></div></div>`;
  const note = truncated ? `<p class="small mut mt-8">Chỉ hiển thị tối đa ${ORGANIZATION_LIST_LIMIT} đơn vị mới nhất.</p>` : "";
  return `<div class="section-title"><div><h2>🏢 Đơn vị</h2><p class="mut">Mỗi đơn vị là một tổ chức dùng HCMA2 Teaching, có dữ liệu dùng chung riêng. Màn hình này chỉ dành cho quản trị viên hệ thống.</p></div><button class="btn" type="button" id="orgCreateBtn">+ Tạo đơn vị</button></div>${warning}${body}${note}`;
}

export function renderOrganizationDetailHtml({ organization, esc, fmtDate }) {
  const v = organizationStatusView(organization.status);
  const archived = organization.status === "archived";
  const lifecycle = archived
    ? `<div class="card mt-14" id="orgArchivedBanner" style="border-color:#94a3b8"><h3 style="margin-top:0">📦 Đơn vị đã được lưu trữ</h3><p class="mut">Đơn vị này đã ngừng mọi hoạt động mới. Dữ liệu và lịch sử vẫn được giữ nguyên. Khôi phục để đơn vị hoạt động trở lại.</p><button class="btn btn-ok" type="button" id="orgRestoreBtn">KHÔI PHỤC ĐƠN VỊ</button></div>`
    : `<div class="card mt-14"><h3 style="margin-top:0">Trạng thái</h3><p class="mut">Đơn vị đang hoạt động. Lưu trữ sẽ dừng mọi hoạt động mới của đơn vị; dữ liệu và lịch sử được giữ nguyên và có thể khôi phục bất cứ lúc nào.</p><button class="btn btn-danger" type="button" id="orgArchiveBtn">LƯU TRỮ ĐƠN VỊ</button></div>`;
  const rename = archived
    ? `<div class="field"><label>Tên đơn vị</label><input type="text" id="orgRenameInput" value="${esc(organization.name || "")}" disabled><div class="hint">Khôi phục đơn vị để đổi tên.</div></div>`
    : `<form id="orgRenameForm" novalidate><div class="field"><label for="orgRenameInput">Tên đơn vị</label><input type="text" id="orgRenameInput" value="${esc(organization.name || "")}" maxlength="${NAME_MAX}"><div id="orgRenameErr" class="error-text hidden"></div></div><button class="btn btn-outline" type="submit" id="orgRenameBtn">LƯU TÊN</button></form>`;
  return `<button class="btn btn-ghost" type="button" id="orgBackBtn">← Danh sách đơn vị</button>
    <div class="card mt-14"><div class="flex-between" style="flex-wrap:wrap;gap:10px"><h2 style="margin:0" id="orgDetailTitle">${esc(organization.name || "—")}</h2><span class="badge ${v.badge}" id="orgDetailStatus">${v.icon} ${esc(v.label)}</span></div>
      <div class="grid grid-2 mt-14"><div><div class="small mut">Mã đơn vị</div><code id="orgDetailCode">${esc(organization.code || "—")}</code><div class="hint">Mã không thể đổi sau khi tạo.</div></div><div><div class="small mut">Ngày tạo</div><div>${esc(fmtDate ? fmtDate(organization.createdAt) : "—")}</div>${archived ? `<div class="small mut mt-8">Lưu trữ lúc</div><div>${esc(fmtDate ? fmtDate(organization.archivedAt) : "—")}</div>` : ""}</div></div>
      <div class="mt-14">${rename}</div>
      <details class="mt-14"><summary class="small mut">Thông tin chẩn đoán</summary><div class="small mut mt-8">Mã nội bộ: <code>${esc(organization.id)}</code></div></details></div>
    ${lifecycle}
    <div id="orgActionErr" class="error-text hidden mt-8"></div>`;
}

export function renderCreateOrganizationFormHtml({ esc }) {
  return `<h3>Tạo đơn vị mới</h3>
    <form id="orgCreateForm" novalidate>
      <div class="field"><label for="orgCreateName">Tên đơn vị *</label><input type="text" id="orgCreateName" maxlength="${NAME_MAX}" autocomplete="off" placeholder="Ví dụ: Khoa Quản trị"><div id="orgCreateNameErr" class="error-text hidden"></div></div>
      <div class="field"><label for="orgCreateCode">Mã đơn vị *</label><input type="text" id="orgCreateCode" maxlength="40" autocomplete="off" placeholder="khoa-quan-tri"><div class="hint">Chữ thường không dấu, số và dấu gạch ngang. Mã tự gợi ý theo tên và <b>không thể đổi</b> sau khi tạo.</div><div id="orgCreateCodeErr" class="error-text hidden"></div></div>
      <div id="orgCreateErr" class="error-text hidden"></div>
      <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgCreateCancel">Hủy</button><button type="submit" class="btn" id="orgCreateSubmit">TẠO ĐƠN VỊ</button></div>
    </form>`;
}

export function renderLifecycleConfirmHtml({ kind, organization, esc }) {
  const archive = kind === "archive";
  return `<h3>${archive ? "Lưu trữ đơn vị?" : "Khôi phục đơn vị?"}</h3>
    <p><b>${esc(organization.name || "—")}</b></p>
    <p class="mut">${archive
      ? "Lưu trữ sẽ dừng mọi hoạt động mới của đơn vị: không thêm thành viên, không cấp quyền, không thêm nội dung dùng chung. Dữ liệu và lịch sử được giữ nguyên. Bạn có thể khôi phục bất cứ lúc nào."
      : "Khôi phục sẽ cho phép đơn vị hoạt động trở lại."}</p>
    <div id="orgConfirmErr" class="error-text hidden"></div>
    <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgConfirmCancel">Hủy</button><button type="button" class="btn ${archive ? "btn-danger" : "btn-ok"}" id="orgConfirmOk">${archive ? "LƯU TRỮ" : "KHÔI PHỤC"}</button></div>`;
}

// Thin transport for payloads that were already built by the S2 write contract (no payload is constructed here).
export function createOrganizationWriter({ collection, doc, setDoc, updateDoc }) {
  return Object.freeze({
    newId: (db) => doc(collection(db, "organizations")).id,
    create: (db, id, data) => setDoc(doc(db, "organizations", id), data),
    update: (db, id, data) => updateDoc(doc(db, "organizations", id), data)
  });
}

// ---------------------------------------------------------------- screen controller
// deps: { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
//         queries: { organizationById(db,id) }, platformQueries: { listAllOrganizationsAsPlatformAdminOnly(db) },
//         contract: <createOrganizationWriteContract result>, writer: { newId(db), create(db,id,data), update(db,id,data) } }
export function createOrganizationAdminScreen(deps) {
  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, queries, platformQueries, contract, writer } = deps;
  const modalRoot = () => document.getElementById("globalModal");
  const modal$ = (selector) => modalRoot().querySelector(selector);
  const show = (el, message) => { el.textContent = message; el.classList.remove("hidden"); };
  const hide = (el) => { if (el) { el.textContent = ""; el.classList.add("hidden"); } };

  async function loadAll() {
    const list = await platformQueries.listAllOrganizationsAsPlatformAdminOnly(db, { pageSize: ORGANIZATION_LIST_LIMIT });
    return list;
  }

  async function mount(container) {
    if (!isPlatformAdmin) {
      container.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">🔒</div><p>Chỉ quản trị viên hệ thống mới được quản lý đơn vị.</p></div></div>`;
      return;
    }
    async function showList() {
      container.innerHTML = `<div class="center-screen" style="min-height:160px"><span class="spinner"></span></div>`;
      let organizations;
      try { organizations = await loadAll(); } catch (error) {
        container.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">⚠️</div><p>${esc(mapError(error))}</p><button class="btn btn-outline" type="button" id="orgRetryBtn">THỬ LẠI</button></div></div>`;
        container.querySelector("#orgRetryBtn").onclick = showList;
        return;
      }
      container.innerHTML = renderOrganizationListHtml({ organizations, esc, fmtDate, truncated: organizations.length >= ORGANIZATION_LIST_LIMIT, duplicates: findDuplicateCodes(organizations) });
      container.querySelector("#orgCreateBtn").onclick = () => openCreate();
      container.querySelectorAll("[data-org-open]").forEach((button) => { button.onclick = () => showDetail(button.dataset.orgOpen); });
    }

    function openCreate() {
      openModal(renderCreateOrganizationFormHtml({ esc }));
      const name = modal$("#orgCreateName"), code = modal$("#orgCreateCode"), submit = modal$("#orgCreateSubmit");
      let codeTouched = false;
      name.addEventListener("input", () => { if (!codeTouched) code.value = slugifyOrganizationCode(name.value); });
      code.addEventListener("input", () => { codeTouched = code.value !== ""; });
      modal$("#orgCreateCancel").onclick = closeModal;
      name.focus();
      modal$("#orgCreateForm").onsubmit = async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        ["#orgCreateNameErr", "#orgCreateCodeErr", "#orgCreateErr"].forEach((s) => hide(modal$(s)));
        submit.disabled = true; submit.textContent = "ĐANG TẠO…";
        try {
          // Uniqueness (best effort, see report): compare against a FRESH list of every organization, archived ones included.
          const existing = await loadAll();
          const result = validateCreateInput({ name: name.value, code: code.value }, existing);
          if (!result.ok) {
            if (result.fieldErrors.name) show(modal$("#orgCreateNameErr"), result.fieldErrors.name);
            if (result.fieldErrors.code) show(modal$("#orgCreateCodeErr"), result.fieldErrors.code);
            return;
          }
          const id = writer.newId(db);
          await writer.create(db, id, contract.buildNewOrganization({ name: result.name, code: result.code }, actorUid));
          await logAudit("organization.create", "organization", id, { name: result.name, code: result.code });
          closeModal();
          toast("Đã tạo đơn vị.", "ok");
          await showDetail(id);
        } catch (error) {
          show(modal$("#orgCreateErr"), mapError(error));
        } finally {
          const still = modalRoot() && modal$("#orgCreateSubmit");
          if (still) { still.disabled = false; still.textContent = "TẠO ĐƠN VỊ"; }
        }
      };
    }

    async function showDetail(id) {
      container.innerHTML = `<div class="center-screen" style="min-height:160px"><span class="spinner"></span></div>`;
      let organization;
      try { organization = await queries.organizationById(db, id); } catch (error) {
        container.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">⚠️</div><p>${esc(mapError(error))}</p><button class="btn btn-outline" type="button" id="orgBackBtn">← Danh sách đơn vị</button></div></div>`;
        container.querySelector("#orgBackBtn").onclick = showList;
        return;
      }
      if (!organization) {
        container.innerHTML = `<div class="card"><div class="empty-state"><div class="ic">🔎</div><p>Không tìm thấy đơn vị.</p><button class="btn btn-outline" type="button" id="orgBackBtn">← Danh sách đơn vị</button></div></div>`;
        container.querySelector("#orgBackBtn").onclick = showList;
        return;
      }
      container.innerHTML = renderOrganizationDetailHtml({ organization, esc, fmtDate });
      container.querySelector("#orgBackBtn").onclick = showList;
      const actionErr = container.querySelector("#orgActionErr");
      const rename = container.querySelector("#orgRenameForm");
      if (rename) rename.onsubmit = async (event) => {
        event.preventDefault();
        const input = container.querySelector("#orgRenameInput"), errBox = container.querySelector("#orgRenameErr"), button = container.querySelector("#orgRenameBtn");
        hide(errBox);
        const next = input.value.trim();
        if (next === (organization.name || "")) { show(errBox, "Tên chưa thay đổi."); return; }
        let payload;
        try { payload = contract.buildOrganizationRename(next); } catch { show(errBox, `Tên đơn vị cần từ ${NAME_MIN} đến ${NAME_MAX} ký tự.`); return; }
        button.disabled = true;
        try {
          await writer.update(db, id, payload);
          await logAudit("organization.rename", "organization", id, { from: organization.name, to: next });
          toast("Đã đổi tên đơn vị.", "ok");
          await showDetail(id);
        } catch (error) { show(errBox, mapError(error)); button.disabled = false; }
      };
      const lifecycleButton = container.querySelector("#orgArchiveBtn") || container.querySelector("#orgRestoreBtn");
      lifecycleButton.onclick = () => confirmLifecycle(organization.status === "archived" ? "restore" : "archive", organization, actionErr);
    }

    function confirmLifecycle(kind, organization, actionErr) {
      openModal(renderLifecycleConfirmHtml({ kind, organization, esc }));
      modal$("#orgConfirmCancel").onclick = closeModal;
      const ok = modal$("#orgConfirmOk");
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          const payload = kind === "archive" ? contract.buildOrganizationArchive(actorUid) : contract.buildOrganizationRestore();
          await writer.update(db, organization.id, payload);
          await logAudit(kind === "archive" ? "organization.archive" : "organization.restore", "organization", organization.id, { name: organization.name, code: organization.code });
          closeModal();
          toast(kind === "archive" ? "Đã lưu trữ đơn vị." : "Đã khôi phục đơn vị.", "ok");
          await showDetail(organization.id);
        } catch (error) {
          show(modal$("#orgConfirmErr"), mapError(error));
          ok.disabled = false;
        }
      };
    }

    await showList();
  }
  return Object.freeze({ mount });
}
