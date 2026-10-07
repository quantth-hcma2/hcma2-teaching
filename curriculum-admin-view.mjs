// Library V2 P3-S3 - Platform Admin curriculum FRAMEWORK list + lifecycle section for Organization Detail.
// UI only. This module imports NOTHING: every dependency is injected by index.html, which imports the three P3-S2 modules with ONE version token each
// (a single module instance per page, no stale bare-URL copies, no instanceof across instances). All domain logic stays in P3-S2:
//   model    = curriculum-model.mjs        (frameworkAvailability, activationReadiness, validators, constants, millisOf, FRAMEWORK_LIST_STATUS_ORDER)
//   queries  = curriculum-queries.mjs      (frameworksOfOrganization, frameworkById, nodesOfFramework)
//   contract = curriculum-write-contract.mjs (buildFrameworkCreate / Rename / Activate / Archive / Restore)
// This file only (1) turns that state into markup and user-facing messages (pure helpers, section 1) and (2) runs the section state machine (section 2).
// It never builds a Firestore payload, never names a collection, never orders a query and never decides authorization: the deployed P3-S1 Rules decide;
// what is hidden or disabled here is convenience. Scope: framework list + create / rename / activate / archive / restore. NOT here: node editor (P3-S4),
// clone / delete-draft (P3-S5), import, teacher view, Organization switcher, capability/Organization-Admin UI.

const freeze = Object.freeze;
const FW_ERROR_NAME = "CurriculumContractError";

// ================================================================ 1. pure helpers (no DOM access, no Firestore)
export function createCurriculumViewHelpers({ model } = {}) {
  if (!model || typeof model.frameworkAvailability !== "function" || typeof model.activationReadiness !== "function") throw new TypeError("createCurriculumViewHelpers requires the curriculum-model module as { model }");
  const { FRAMEWORK_NAME_MIN, FRAMEWORK_NAME_MAX, FRAMEWORK_LIST_LIMIT, FRAMEWORK_LIST_STATUS_ORDER, frameworkAvailability, millisOf, validateFrameworkName } = model;

  const STATUS_VIEW = freeze({
    draft: freeze({ label: "Bản nháp", badge: "badge-yellow", icon: "📝" }),
    active: freeze({ label: "Đang áp dụng", badge: "badge-green", icon: "🟢" }),
    archived: freeze({ label: "Đã lưu trữ", badge: "badge-gray", icon: "📦" })
  });
  const UNKNOWN_VIEW = freeze({ label: "Không xác định", badge: "badge-gray", icon: "❔" });
  const frameworkStatusView = (status) => STATUS_VIEW[status] || UNKNOWN_VIEW;

  const MESSAGES = freeze({
    orgArchived: "Đơn vị đã được lưu trữ. Không thể thay đổi chương trình.",
    orgMissing: "Không tìm thấy đơn vị.",
    missing: "Không tìm thấy khung (có thể đã bị xóa ở nơi khác). Đã tải lại danh sách.",
    stale: "Khung đã được thay đổi ở nơi khác. Đã tải lại danh sách.",
    permissionRead: "Không có quyền xem chương trình của đơn vị này.",
    permissionWrite: "Không có quyền thực hiện thao tác này. Tài khoản có thể không còn là quản trị viên. Hãy tải lại trang và đăng nhập lại.",
    name: "Tên khung cần từ " + FRAMEWORK_NAME_MIN + " đến " + FRAMEWORK_NAME_MAX + " ký tự.",
    unchanged: "Tên chưa thay đổi.",
    uncertain: "Chưa xác định được kết quả. Hãy kiểm tra danh sách trước khi thử lại.",
    tooLarge: "Khung quá lớn để kiểm tra nên chưa thể kích hoạt.",
    notReadyToast: "Khung chưa đủ điều kiện kích hoạt."
  });

  // ---- grouping / summary / truncation (the list arrives ALREADY sorted by the P3-S2 query: status group, newest first)
  function groupFrameworksByStatus(items) {
    const list = Array.isArray(items) ? items : [];
    const groups = FRAMEWORK_LIST_STATUS_ORDER.map((status) => ({ status, label: frameworkStatusView(status).label, items: list.filter((x) => x.status === status) }));
    const other = list.filter((x) => !FRAMEWORK_LIST_STATUS_ORDER.includes(x.status));
    if (other.length) groups.push({ status: "unknown", label: UNKNOWN_VIEW.label, items: other });
    return groups.filter((g) => g.items.length > 0);
  }
  function summarizeFrameworks(items, truncated) {
    const list = Array.isArray(items) ? items : [];
    const count = (status) => list.filter((x) => x.status === status).length;
    const parts = [(truncated ? "Ít nhất " : "") + list.length + " khung"];
    if (count("active")) parts.push(count("active") + " đang áp dụng");
    if (count("draft")) parts.push(count("draft") + " bản nháp");
    if (count("archived")) parts.push(count("archived") + " đã lưu trữ");
    return parts.join(" · ");
  }
  // The query has NO server ordering: it returns the first LIMIT documents by id. The copy therefore must say "đầu tiên", never "mới nhất".
  // FUTURE TRIGGER (Owner decision, P3-S3): if real Organization usage approaches this bound, introduce an explicitly designed pagination/ordering strategy
  // (reviewed query + index plan); do NOT silently raise FRAMEWORK_LIST_LIMIT.
  const truncationNote = () => "Chỉ hiển thị " + FRAMEWORK_LIST_LIMIT + " khung đầu tiên; còn nhiều khung hơn chưa được hiển thị.";

  // ---- what the UI offers (mirrors the Rules through model.frameworkAvailability; never an enabled control the Rules would reject)
  // P3-S5: lifecycleTools (clone / delete-draft) is true only when the clone tools are injected; clone needs an ACTIVE organization, delete-draft a never-activated draft.
  function controlsFor(framework, organization, { canOpen = false, lifecycleTools = false } = {}) {
    const a = frameworkAvailability(framework, organization);
    return freeze({ open: !!canOpen, openReadOnly: a.readOnly, rename: a.canRename, activate: a.canActivate, archive: a.canArchive, restore: a.canRestore, clone: !!lifecycleTools && a.organizationWritable, deleteDraft: !!lifecycleTools && a.canDelete });
  }
  const createDisabledReason = (organization) => (organization && organization.status === "active" ? null : "Đơn vị đã lưu trữ: không thể tạo hoặc thay đổi khung chương trình. Hãy khôi phục đơn vị trước.");

  // ---- stale detection between a loaded framework and a fresh read
  function frameworkChangedSince(loaded, fresh, { compareUpdatedAt = false } = {}) {
    if (!fresh) return freeze({ changed: true, reason: "missing" });
    if (!loaded) return freeze({ changed: false, reason: null });
    if (loaded.status !== fresh.status) return freeze({ changed: true, reason: "status" });
    if (compareUpdatedAt && millisOf(loaded.updatedAt) !== millisOf(fresh.updatedAt)) return freeze({ changed: true, reason: "updatedAt" });
    return freeze({ changed: false, reason: null });
  }

  // ---- error classification and messages (match CurriculumContractError by name + code, never instanceof)
  function describeContractError(error) {
    if (!error || error.name !== FW_ERROR_NAME) return null;
    switch (error.code) {
      case "NAME": return { kind: "validation", message: MESSAGES.name };
      case "ORGANIZATION_ARCHIVED": return { kind: "orgArchived", message: MESSAGES.orgArchived };
      case "FRAMEWORK_READ_ONLY": case "TRANSITION": case "ORGANIZATION_MISMATCH": return { kind: "stale", message: MESSAGES.stale };
      case "NOT_READY": return { kind: "notReady", message: MESSAGES.notReadyToast };
      default: return { kind: "unknown", message: "Dữ liệu không hợp lệ (" + String(error.code) + ")." };
    }
  }
  function classifyFirebaseError(error, { online = true } = {}) {
    const code = String((error && error.code) || "").replace(/^firestore\//, "");
    if (code === "permission-denied") return "permission-denied";
    if (code === "not-found") return "not-found";
    if (!online || ["unavailable", "deadline-exceeded", "cancelled", "aborted", "network-request-failed", "internal", "unknown"].includes(code) || (error && error.name === "TypeError")) return "unknown-outcome";
    return "other";
  }
  const READINESS_TEXT = freeze({
    NOT_DRAFT: "Chỉ khung ở trạng thái Bản nháp mới kích hoạt được.",
    ORGANIZATION_READ_ONLY: MESSAGES.orgArchived,
    NO_ACTIVE_SUBJECT: "Cần ít nhất một Môn đang hoạt động.",
    INCOMPLETE_CLONE: "Bản sao chưa đầy đủ.",
    TREE_NODE_COUNT_EXCEEDED: "Khung vượt quá số nút cho phép.",
    TREE_DUPLICATE_ID: "Có nút bị trùng mã nội bộ.",
    TREE_ORGANIZATION_MISMATCH: "Có nút thuộc đơn vị khác.",
    TREE_PARENT_MISSING: "Có nút mồ côi (không tìm thấy nút cha).",
    TREE_CYCLE: "Cây chương trình có vòng lặp.",
    TREE_ANCESTORS_MISMATCH: "Thông tin cấp cha của một nút không khớp với cấu trúc thực tế.",
    TREE_PARENT_MISMATCH: "Thông tin cấp cha của một nút không nhất quán.",
    TREE_DEPTH_EXCEEDED: "Cây chương trình sâu quá 4 cấp.",
    TREE_DUPLICATE_ORDER: "Có hai nút cùng thứ tự trong một cấp.",
    TREE_DUPLICATE_CODE: "Có mã bị trùng trong khung.",
    TREE_SELF_IN_ANCESTORS: "Có nút tự nằm trong danh sách cấp cha của chính nó.",
    TREE_SELF_PARENT: "Có nút tự làm cha của chính nó."
  });
  // readiness.errors[] -> [{ code, text, count }] (deduplicated by code; never an automatic fix)
  function describeReadiness(readiness) {
    const counts = new Map();
    for (const error of (readiness && readiness.errors) || []) counts.set(error.code, (counts.get(error.code) || 0) + 1);
    return [...counts.entries()].map(([code, count]) => {
      let text = READINESS_TEXT[code];
      if (!text && code.startsWith("TREE_")) text = "Có nút có dữ liệu không hợp lệ (" + code.slice(5).toLowerCase() + ").";
      if (!text) text = "Chưa đủ điều kiện (" + code + ").";
      return freeze({ code, text, count });
    });
  }

  // ---- markup (every dynamic string goes through the injected escaper)
  const attr = (esc, v) => esc(String(v == null ? "" : v));
  function renderRowHtml({ framework, organization, controls, esc, fmtDate, flash }) {
    const view = frameworkStatusView(framework.status);
    const id = attr(esc, framework.id);
    const name = esc(framework.name || "—");
    const created = "Tạo " + esc(fmtDate ? fmtDate(framework.createdAt) : "—");
    const activated = Object.prototype.hasOwnProperty.call(framework, "activatedAt") && framework.activatedAt ? " · Kích hoạt " + esc(fmtDate ? fmtDate(framework.activatedAt) : "—") : "";
    const clone = framework.cloneSource ? ` <span class="chip" data-fw-clone="1">Bản sao</span>` : "";
    const button = (action, cls, label) => `<button class="btn btn-outline${cls}" type="button" data-fw-action="${action}" data-fw-id="${id}" aria-label="${label} — ${name}">${label}</button>`;
    const buttons = [
      controls.open ? button("open", "", controls.openReadOnly ? "MỞ (CHỈ XEM)" : "MỞ") : "",
      controls.rename ? button("rename", "", "ĐỔI TÊN") : "",
      controls.clone ? button("clone", "", "NHÂN BẢN") : "",
      controls.activate ? `<button class="btn btn-ok" type="button" data-fw-action="activate" data-fw-id="${id}" aria-label="KÍCH HOẠT — ${name}">KÍCH HOẠT</button>` : "",
      controls.archive ? button("archive", "", "LƯU TRỮ") : "",
      controls.deleteDraft ? `<button class="btn btn-outline" type="button" style="color:var(--danger);border-color:var(--danger)" data-fw-action="delete-draft" data-fw-id="${id}" aria-label="XÓA BẢN NHÁP — ${name}">XÓA BẢN NHÁP</button>` : "",
      controls.restore ? `<button class="btn btn-ok" type="button" data-fw-action="restore" data-fw-id="${id}" aria-label="KHÔI PHỤC — ${name}">KHÔI PHỤC</button>` : ""
    ].join(" ");
    return `<li data-fw-row="${id}" data-fw-status="${attr(esc, framework.status)}" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:8px${flash ? ";background:#f0fdf4" : ""}">
      <div class="flex-between" style="flex-wrap:wrap;gap:10px;align-items:flex-start">
        <div style="min-width:0;flex:1 1 240px"><div style="font-weight:650;overflow-wrap:anywhere">${name}</div><div class="small mut mt-8">${created}${activated}${clone}</div></div>
        <div class="flex gap-8" style="flex-wrap:wrap;align-items:center"><span class="badge ${view.badge}" data-fw-badge="1"><span aria-hidden="true">${view.icon}</span> ${esc(view.label)}</span>${buttons}</div>
      </div></li>`;
  }

  // phase: "loading" | "error" | "ready". All variants share the card + header so the create control is always at the same place.
  function renderSectionHtml({ phase, organization, items = [], truncated = false, errorMessage = "", canOpen = false, lifecycleTools = false, esc, fmtDate, flashId = null }) {
    const archived = !!organization && organization.status !== "active";
    const reason = createDisabledReason(organization);
    const summary = phase === "ready" && items.length ? `<div class="small" id="orgCurriculumSummary" style="font-weight:650">${esc(summarizeFrameworks(items, truncated))}</div>` : "";
    const createButton = `<button class="btn" type="button" id="orgFwCreateBtn"${archived ? ` disabled aria-describedby="orgFwCreateHint" title="${attr(esc, reason)}"` : ""}>+ Tạo khung chương trình</button>${archived ? `<div class="hint" id="orgFwCreateHint">${esc(reason)}</div>` : ""}`;
    const banner = archived ? `<div class="card mt-8" id="orgCurriculumArchivedNote" style="border-color:#94a3b8"><b>📦 Đơn vị đã lưu trữ.</b> Bạn có thể xem chương trình nhưng không thể tạo hoặc thay đổi. Khôi phục đơn vị để chỉnh sửa.</div>` : "";
    let body = "";
    if (phase === "loading") body = `<div class="center-screen" style="min-height:80px" id="orgCurriculumLoading"><span class="spinner" role="status" aria-label="Đang tải chương trình"></span></div>`;
    else if (phase === "error") body = `<div class="empty-state" id="orgCurriculumError" role="alert"><div class="ic">⚠️</div><p>${esc(errorMessage)}</p><button class="btn btn-outline" type="button" id="orgCurriculumRetry">THỬ LẠI</button></div>`;
    else if (!items.length) body = `<div class="empty-state" id="orgCurriculumEmpty"><div class="ic">📚</div><h3>Chưa có khung chương trình</h3><p>${archived ? "Đơn vị đã lưu trữ: chưa có khung chương trình nào để xem." : "Tạo khung đầu tiên để bắt đầu xây dựng Môn và Bài cho đơn vị này."}</p></div>`;
    else {
      const groups = groupFrameworksByStatus(items).map((group) => `<h4 class="mt-14" style="margin-bottom:0" data-fw-group="${attr(esc, group.status)}">${esc(group.label)} <span class="mut">(${group.items.length})</span></h4>
        <ul style="list-style:none;padding:0;margin:0">${group.items.map((framework) => renderRowHtml({ framework, organization, controls: controlsFor(framework, organization, { canOpen, lifecycleTools }), esc, fmtDate, flash: framework.id === flashId })).join("")}</ul>`).join("");
      body = groups + (truncated ? `<p class="small mut mt-8" id="orgCurriculumTruncated">${esc(truncationNote())}</p>` : "");
    }
    return `<section class="card" id="orgCurriculumCard" aria-labelledby="orgCurriculumTitle" aria-busy="${phase === "loading" ? "true" : "false"}">
      <div class="flex-between" style="flex-wrap:wrap;gap:10px;align-items:flex-start"><div><h3 id="orgCurriculumTitle" tabindex="-1" style="margin:0;outline:none">📚 Chương trình</h3><div class="small mut">Các khung chương trình (Môn → Bài) của đơn vị này.</div>${summary}</div><div>${createButton}</div></div>
      ${banner}<div id="orgFwLive" class="sr-only" role="status" aria-live="polite"></div><div id="orgFwBody">${body}</div></section>`;
  }

  const dialogHead = (id, title) => `<div role="dialog" aria-modal="true" aria-labelledby="${id}"><h3 id="${id}">${title}</h3>`;
  function renderCreateFormHtml({ esc }) {
    return `${dialogHead("orgFwDialogTitle", "Tạo khung chương trình")}
      <form id="orgFwForm" novalidate>
        <div class="field"><label for="orgFwName">Tên khung *</label><input type="text" id="orgFwName" maxlength="${FRAMEWORK_NAME_MAX}" autocomplete="off" aria-describedby="orgFwNameHint orgFwNameErr" placeholder="Ví dụ: Chương trình Trung cấp LLCT 2026"><div class="hint" id="orgFwNameHint">Khung mới là bản nháp; bạn có thể thêm Môn và Bài sau.</div><div id="orgFwNameErr" class="error-text hidden" role="alert"></div></div>
        <div id="orgFwErr" class="error-text hidden" role="alert"></div>
        <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button><button type="submit" class="btn" id="orgFwSubmit">TẠO KHUNG</button></div>
      </form></div>`;
  }
  function renderRenameFormHtml({ framework, esc }) {
    return `${dialogHead("orgFwDialogTitle", "Đổi tên khung")}
      <form id="orgFwForm" novalidate>
        <div class="field"><label for="orgFwName">Tên khung *</label><input type="text" id="orgFwName" maxlength="${FRAMEWORK_NAME_MAX}" autocomplete="off" value="${attr(esc, framework.name || "")}" aria-describedby="orgFwNameErr"><div id="orgFwNameErr" class="error-text hidden" role="alert"></div></div>
        <div id="orgFwErr" class="error-text hidden" role="alert"></div>
        <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button><button type="submit" class="btn" id="orgFwSubmit">LƯU TÊN</button></div>
      </form></div>`;
  }
  const CONFIRM = freeze({
    archive: freeze({ title: "Lưu trữ khung?", text: "Khung và các Môn/Bài sẽ chỉ còn ở chế độ xem: không sửa được, không thêm được. Dữ liệu được giữ nguyên và có thể khôi phục bất cứ lúc nào.", ok: "LƯU TRỮ", cls: "btn-danger" }),
    restore: freeze({ title: "Khôi phục khung?", text: "Khung trở lại trạng thái Đang áp dụng và sửa được trở lại.", ok: "KHÔI PHỤC", cls: "btn-ok" })
  });
  function renderConfirmHtml({ kind, framework, esc }) {
    const c = CONFIRM[kind];
    return `${dialogHead("orgFwDialogTitle", c.title)}
      <p><b>${esc(framework.name || "—")}</b></p><p class="mut">${esc(c.text)}</p>
      <div id="orgFwErr" class="error-text hidden" role="alert"></div>
      <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button><button type="button" class="btn ${c.cls}" id="orgFwConfirm">${c.ok}</button></div></div>`;
  }
  // phase: "checking" | "blocked" | "ready". blocked carries `reasons` (describeReadiness) or `message` (e.g. too large); ready carries `stats`.
  function renderActivationHtml({ phase, framework, reasons = [], message = "", stats = null, esc }) {
    const head = `${dialogHead("orgFwDialogTitle", "Kích hoạt khung?")}<p><b>${esc(framework.name || "—")}</b></p>`;
    const cancel = `<button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button>`;
    if (phase === "checking") return `${head}<div class="center-screen" style="min-height:70px" id="orgFwChecking"><span class="spinner" role="status" aria-label="Đang kiểm tra chương trình"></span></div><p class="mut" aria-live="polite">Đang kiểm tra chương trình…</p><div class="flex-between mt-14">${cancel}</div></div>`;
    if (phase === "blocked") {
      const list = reasons.length ? `<ul id="orgFwReasons" style="margin:8px 0 0 18px">${reasons.map((r) => `<li data-reason="${attr(esc, r.code)}">${esc(r.text)}${r.count > 1 ? ` <span class="mut">(×${r.count})</span>` : ""}</li>`).join("")}</ul>` : "";
      return `${head}<div class="card" id="orgFwBlocked" role="alert" style="border-color:#f59e0b"><b>Chưa thể kích hoạt.</b>${message ? `<div class="mt-8">${esc(message)}</div>` : ""}${list}</div><p class="small mut mt-8">Hệ thống không tự sửa dữ liệu chương trình. Hãy hoàn thiện khung rồi kích hoạt lại.</p><div id="orgFwErr" class="error-text hidden" role="alert"></div><div class="flex-between mt-14">${cancel}<button type="button" class="btn btn-ok" id="orgFwConfirm" disabled>KÍCH HOẠT</button></div></div>`;
    }
    const s = stats ? `<p class="small mut" id="orgFwStats">${esc("Cây chương trình: " + stats.activeCount + " nút đang hoạt động / " + stats.nodeCount + " nút")}</p>` : "";
    return `${head}${s}<p class="mut">Kích hoạt đưa khung vào sử dụng. Sau khi kích hoạt, khung không thể xóa và không thể trở lại bản nháp; bạn có thể Lưu trữ rồi Khôi phục bất cứ lúc nào. Các Môn/Bài vẫn có thể thêm và đổi tên.</p><div id="orgFwErr" class="error-text hidden" role="alert"></div><div class="flex-between mt-14">${cancel}<button type="button" class="btn btn-ok" id="orgFwConfirm">KÍCH HOẠT</button></div></div>`;
  }

  return freeze({
    MESSAGES, frameworkStatusView, groupFrameworksByStatus, summarizeFrameworks, truncationNote, controlsFor, createDisabledReason, frameworkChangedSince,
    describeContractError, classifyFirebaseError, describeReadiness, validateName: validateFrameworkName,
    renderSectionHtml, renderRowHtml, renderCreateFormHtml, renderRenameFormHtml, renderConfirmHtml, renderActivationHtml
  });
}

// Thin Firestore transport for payloads already built by the P3-S2 write contract (no payload is constructed here).
export function createCurriculumWriter({ collection, doc, setDoc, updateDoc }) {
  return freeze({
    newId: (db) => doc(collection(db, "curriculumFrameworks")).id,
    create: (db, id, data) => setDoc(doc(db, "curriculumFrameworks", id), data),
    update: (db, id, data) => updateDoc(doc(db, "curriculumFrameworks", id), data)
  });
}

// ================================================================ 2. section controller
// deps: { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
//         model, queries (curriculum queries), organizationQueries ({ organizationById(db, id) }), contract (curriculum write contract result),
//         writer ({ newId, create, update }), onOpenFramework? (future P3-S4 integration boundary) }
// mount(host, organization) paints the section; it never throws. Without onOpenFramework no "MỞ" control exists (P3-S4 supplies the editor).
class FlowAbort extends Error { constructor(kind) { super(kind); this.kind = kind; } }

export function createCurriculumSection(deps) {
  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, model, queries, organizationQueries, contract, writer, onOpenFramework, cloneTools } = deps;
  const H = createCurriculumViewHelpers({ model });
  const modalRoot = () => document.getElementById("globalModal");
  const modal$ = (selector) => { const root = modalRoot(); return root ? root.querySelector(selector) : null; };
  const show = (el, message) => { if (el) { el.textContent = message; el.classList.remove("hidden"); } };
  const hide = (el) => { if (el) { el.textContent = ""; el.classList.add("hidden"); } };

  // mount(host, organization, options?): options.onOpenFramework overrides the construction-time hook (P3-S4: the Organization screen supplies it); options.focusFrameworkId
  // focuses that row's MỞ button after the list loads (returning from the editor). Without options the approved P3-S3 behavior is unchanged.
  async function mount(host, organization, options = {}) {
    if (!host) return;
    if (!isPlatformAdmin) { host.innerHTML = ""; return; }
    const openHook = typeof options.onOpenFramework === "function" ? options.onOpenFramework : onOpenFramework;
    const canOpen = typeof openHook === "function";
    let pendingFocusId = options.focusFrameworkId || null;
    let org = organization, items = [], truncated = false, generation = 0, busy = false, flashId = null, trigger = null;
    const live = (message) => { const el = host.querySelector("#orgFwLive"); if (el) el.textContent = message; };

    // ---------------------------------------------------------- painting / loading
    function paint(phase, extra = {}) {
      host.innerHTML = H.renderSectionHtml({ phase, organization: org, items, truncated, canOpen, lifecycleTools: !!cloneTools, esc, fmtDate, flashId, ...extra });
      const create = host.querySelector("#orgFwCreateBtn");
      if (create && !create.disabled) create.onclick = () => { trigger = create; openCreate(); };
      const retry = host.querySelector("#orgCurriculumRetry");
      if (retry) retry.onclick = () => load();
      host.querySelectorAll("[data-fw-action]").forEach((button) => {
        button.onclick = () => { trigger = button; onRowAction(button.dataset.fwAction, items.find((x) => x.id === button.dataset.fwId)); };
      });
      if (phase === "ready" && flashId) { const id = flashId; flashId = null; setTimeout(() => { const row = host.querySelector(`[data-fw-row="${id}"]`); if (row) row.style.background = ""; }, 2500); }
    }
    async function load() {
      const mine = ++generation;
      paint("loading");
      try {
        const page = await queries.frameworksOfOrganization(db, org.id);
        if (mine !== generation) return;
        items = page.items; truncated = !!page.truncated;
        paint("ready");
        if (pendingFocusId) {
          const target = host.querySelector(`[data-fw-id="${pendingFocusId}"][data-fw-action="open"]`) || host.querySelector("#orgCurriculumTitle");
          pendingFocusId = null; if (target) target.focus();
        }
      } catch (error) {
        if (mine !== generation) return;
        const kind = H.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
        paint("error", { errorMessage: kind === "permission-denied" ? H.MESSAGES.permissionRead : mapError(error) });
      }
    }

    // ---------------------------------------------------------- busy handling (one write at a time, no double submit)
    function setBusy(on) {
      busy = on;
      const buttons = [...host.querySelectorAll("button"), ...(modalRoot() ? modalRoot().querySelectorAll("button") : [])];
      for (const button of buttons) {
        if (on && !button.disabled) { button.disabled = true; button.dataset.busyLock = "1"; }
        if (!on && button.dataset.busyLock) { button.disabled = false; delete button.dataset.busyLock; }
      }
      const card = host.querySelector("#orgCurriculumCard"); if (card) card.setAttribute("aria-busy", on ? "true" : "false");
    }
    async function exclusive(fn) {
      if (busy) return;
      setBusy(true);
      try { return await fn(); } finally { setBusy(false); }
    }

    // ---------------------------------------------------------- dialog helpers (focus, Escape, return focus)
    // ONE focus-restoration contract for every dismissal path (Cancel, Escape, successful close, backdrop click): back to the control that opened the dialog,
    // or to the section heading when that control no longer exists (the list was repainted).
    function restoreFocus() {
      if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) trigger.focus();
      else { const title = host.querySelector("#orgCurriculumTitle"); if (title) title.focus(); }
    }
    function dialogClose() {
      closeModal();
      restoreFocus();
    }
    function dialogOpen(html, focusSelector) {
      openModal(html);
      const shell = modal$(".modal");   // the shell persists when the activation dialog re-renders its content, so Escape keeps working
      if (shell) { shell.setAttribute("tabindex", "-1"); shell.style.outline = "none"; }   // a click on non-focusable dialog text keeps focus INSIDE the dialog, so Escape keeps working
      if (shell) shell.addEventListener("keydown", (event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); dialogClose(); } });
      // The shared openModal already closes the dialog on a backdrop click (its listener was registered first); this one only applies the focus contract.
      const backdrop = modalRoot() && modalRoot().querySelector("#modalBackdrop");
      if (backdrop) backdrop.addEventListener("click", (event) => { if (event.target === backdrop) restoreFocus(); });
      const cancel = modal$("#orgFwCancel"); if (cancel) cancel.onclick = () => { if (!busy) dialogClose(); };
      const focusTarget = focusSelector && modal$(focusSelector); if (focusTarget) focusTarget.focus();
    }

    // ---------------------------------------------------------- fresh reads and aborts
    async function readFresh(frameworkId, { withNodes = false } = {}) {
      const freshOrg = await organizationQueries.organizationById(db, org.id);
      if (!freshOrg) throw new FlowAbort("orgMissing");
      org = freshOrg;
      if (freshOrg.status !== "active") throw new FlowAbort("orgArchived");
      let framework = null, nodes = null;
      if (frameworkId) {
        try { framework = await queries.frameworkById(db, frameworkId, { organizationId: org.id }); } catch (error) {
          if (error && error.name === "CurriculumContractError") throw new FlowAbort("missing");
          throw error;
        }
        if (!framework) throw new FlowAbort("missing");
      }
      if (withNodes) {
        const result = await queries.nodesOfFramework(db, frameworkId, org.id);
        if (result.tooLarge) throw new FlowAbort("tooLarge");
        nodes = result.items;
      }
      return { organization: freshOrg, framework, nodes };
    }
    const ABORT_MESSAGE = { orgArchived: H.MESSAGES.orgArchived, orgMissing: H.MESSAGES.orgMissing, missing: H.MESSAGES.missing, stale: H.MESSAGES.stale, tooLarge: H.MESSAGES.tooLarge };
    const refocus = () => { const title = host.querySelector("#orgCurriculumTitle"); if (title) title.focus(); };   // the triggering row is gone after a reload
    // An abort that invalidates what is on screen: close the dialog, tell the user, reload the list (and repaint read-only when the organization is archived).
    async function finishAbort(abort) {
      if (modalRoot() && modal$('[role="dialog"]')) dialogClose();
      const message = ABORT_MESSAGE[abort.kind] || H.MESSAGES.stale;
      toast(message, abort.kind === "orgArchived" ? "warn" : "err");
      await load();
      refocus();
      live(message);
    }
    // After a failed write: decide WHY by re-reading (never guess). Returns { abort } for state changes or { message } to show inline.
    async function diagnose(error, { frameworkId, expectStatus }) {
      const contractInfo = H.describeContractError(error);
      if (contractInfo) {
        if (contractInfo.kind === "orgArchived") return { abort: new FlowAbort("orgArchived") };
        if (contractInfo.kind === "stale") return { abort: new FlowAbort("stale") };
        return { message: contractInfo.message };
      }
      const kind = H.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
      if (kind === "permission-denied" || kind === "not-found") {
        try {
          const fresh = await readFresh(frameworkId);
          if (fresh.framework && expectStatus && fresh.framework.status !== expectStatus) return { abort: new FlowAbort("stale") };
          return kind === "not-found" ? { abort: new FlowAbort("missing") } : { message: H.MESSAGES.permissionWrite };
        } catch (probe) {
          if (probe instanceof FlowAbort) return { abort: probe };
          return { message: H.MESSAGES.permissionWrite };
        }
      }
      return { message: mapError(error) + (kind === "unknown-outcome" ? " " + H.MESSAGES.uncertain : "") };
    }
    async function onFailure(error, ctx) {
      if (error instanceof FlowAbort) return finishAbort(error);
      const result = await diagnose(error, ctx);
      if (result.abort) return finishAbort(result.abort);
      show(modal$("#orgFwErr"), result.message);
    }
    const audit = async (action, frameworkId, detail) => { try { await logAudit(action, "curriculumFramework", frameworkId, { organizationId: org.id, ...detail }); } catch { /* best effort */ } };
    async function succeed(message, frameworkId) {
      dialogClose();
      toast(message, "ok");
      flashId = frameworkId;
      await load();
      refocus();
      live(message);
    }

    // ---------------------------------------------------------- create (no confirmation; ONE pending document id per modal session)
    function openCreate() {
      if (busy || org.status !== "active") return;
      const pendingId = writer.newId(db);
      let attempted = false;
      dialogOpen(H.renderCreateFormHtml({ esc }), "#orgFwName");
      const form = modal$("#orgFwForm"), input = modal$("#orgFwName");
      form.onsubmit = (event) => {
        event.preventDefault();
        exclusive(async () => {
          hide(modal$("#orgFwNameErr")); hide(modal$("#orgFwErr"));
          let name;
          try { name = H.validateName(input.value); } catch { show(modal$("#orgFwNameErr"), H.MESSAGES.name); input.focus(); return; }
          const submit = modal$("#orgFwSubmit"), label = submit && submit.textContent; if (submit) submit.textContent = "ĐANG XỬ LÝ…";
          try {
            const fresh = await readFresh(null);
            if (attempted) {   // an earlier attempt ended with an unknown outcome: if that document exists, it WAS written - never create a second one
              const existing = await queries.frameworkById(db, pendingId, { organizationId: org.id });
              if (existing) { await audit("curriculum.framework.create", pendingId, { name: existing.name }); return succeed("Đã tạo khung chương trình.", pendingId); }
            }
            const data = contract.buildFrameworkCreate({ organization: fresh.organization, name }, actorUid);
            attempted = true;
            await writer.create(db, pendingId, data);
            await audit("curriculum.framework.create", pendingId, { name });
            return succeed("Đã tạo khung chương trình.", pendingId);
          } catch (error) { await onFailure(error, { frameworkId: null }); }
          finally { if (submit && document.contains(submit)) submit.textContent = label; }
        });
      };
    }

    // ---------------------------------------------------------- row actions
    function onRowAction(action, framework) {
      if (busy || !framework) return;
      if (action === "open") { if (canOpen) openHook(framework, org); return; }
      if (action === "rename") return openRename(framework);
      if (action === "activate") return openActivation(framework);
      if (action === "archive" || action === "restore") return openConfirm(action, framework);
      if (action === "clone") return openClone(framework);
      if (action === "delete-draft") return openDeleteDraft(framework);
    }

    function openRename(framework) {
      dialogOpen(H.renderRenameFormHtml({ framework, esc }), "#orgFwName");
      const form = modal$("#orgFwForm"), input = modal$("#orgFwName");
      form.onsubmit = (event) => {
        event.preventDefault();
        exclusive(async () => {
          hide(modal$("#orgFwNameErr")); hide(modal$("#orgFwErr"));
          let name;
          try { name = H.validateName(input.value); } catch { show(modal$("#orgFwNameErr"), H.MESSAGES.name); input.focus(); return; }
          if (name === (framework.name || "")) { show(modal$("#orgFwNameErr"), H.MESSAGES.unchanged); input.focus(); return; }
          const submit = modal$("#orgFwSubmit"), label = submit && submit.textContent; if (submit) submit.textContent = "ĐANG XỬ LÝ…";
          try {
            const fresh = await readFresh(framework.id);
            if (H.frameworkChangedSince(framework, fresh.framework, { compareUpdatedAt: true }).changed) throw new FlowAbort("stale");
            const data = contract.buildFrameworkRename(fresh.framework, name, { organization: fresh.organization });
            await writer.update(db, framework.id, data);
            await audit("curriculum.framework.rename", framework.id, { from: framework.name, to: name });
            return succeed("Đã đổi tên khung.", framework.id);
          } catch (error) { await onFailure(error, { frameworkId: framework.id, expectStatus: framework.status }); }
          finally { if (submit && document.contains(submit)) submit.textContent = label; }
        });
      };
    }

    // archive / restore: consequence confirmation, fresh status check, one write
    function openConfirm(kind, framework) {
      const from = kind === "archive" ? "active" : "archived";
      dialogOpen(H.renderConfirmHtml({ kind, framework, esc }), kind === "archive" ? "#orgFwCancel" : "#orgFwConfirm");
      const ok = modal$("#orgFwConfirm");
      ok.onclick = () => exclusive(async () => {
        hide(modal$("#orgFwErr"));
        const label = ok.textContent; ok.textContent = "ĐANG XỬ LÝ…";
        try {
          const fresh = await readFresh(framework.id);
          if (H.frameworkChangedSince(framework, fresh.framework).changed || fresh.framework.status !== from) throw new FlowAbort("stale");
          const data = kind === "archive" ? contract.buildFrameworkArchive(fresh.framework, actorUid, { organization: fresh.organization }) : contract.buildFrameworkRestore(fresh.framework, actorUid, { organization: fresh.organization });
          await writer.update(db, framework.id, data);
          await audit("curriculum.framework." + kind, framework.id, { name: framework.name });
          return succeed(kind === "archive" ? "Đã lưu trữ khung." : "Đã khôi phục khung.", framework.id);
        } catch (error) { await onFailure(error, { frameworkId: framework.id, expectStatus: from }); }
        finally { if (document.contains(ok)) ok.textContent = label; }
      });
    }

    // activation: readiness is computed by P3-S2 (activationReadiness) on FRESH data, shown in plain language; no automatic fixes
    let activationRun = 0;
    function openActivation(framework) {
      const mine = ++activationRun;
      dialogOpen(H.renderActivationHtml({ phase: "checking", framework, esc }), "#orgFwCancel");
      const showPhase = (state) => {
        if (mine !== activationRun || !modal$('[role="dialog"]')) return;
        const root = modal$('[role="dialog"]').parentElement;
        root.innerHTML = H.renderActivationHtml({ framework, esc, ...state });
        const cancel = modal$("#orgFwCancel"); if (cancel) cancel.onclick = () => { if (!busy) dialogClose(); };
        const confirm = modal$("#orgFwConfirm"); if (confirm && !confirm.disabled) { confirm.onclick = () => doActivate(); confirm.focus(); } else if (cancel) cancel.focus();
      };
      async function evaluate() {
        const fresh = await readFresh(framework.id, { withNodes: true });
        if (H.frameworkChangedSince(framework, fresh.framework).changed) throw new FlowAbort("stale");
        const readiness = model.activationReadiness(fresh.framework, fresh.nodes, { organization: fresh.organization });
        return { fresh, readiness };
      }
      (async () => {
        try {
          const { readiness } = await evaluate();
          showPhase(readiness.ready ? { phase: "ready", stats: readiness.stats } : { phase: "blocked", reasons: H.describeReadiness(readiness) });
        } catch (error) {
          if (error instanceof FlowAbort && error.kind === "tooLarge") return showPhase({ phase: "blocked", message: H.MESSAGES.tooLarge });
          if (error instanceof FlowAbort) { if (mine === activationRun) await finishAbort(error); return; }
          const result = await diagnose(error, { frameworkId: framework.id, expectStatus: framework.status });
          if (result.abort) { if (mine === activationRun) await finishAbort(result.abort); return; }
          showPhase({ phase: "blocked", message: result.message });
        }
      })();
      function doActivate() {
        exclusive(async () => {
          hide(modal$("#orgFwErr"));
          const confirm = modal$("#orgFwConfirm"), label = confirm && confirm.textContent; if (confirm) confirm.textContent = "ĐANG XỬ LÝ…";
          try {
            const { fresh, readiness } = await evaluate();
            if (!readiness.ready) { showPhase({ phase: "blocked", reasons: H.describeReadiness(readiness) }); return; }
            const data = contract.buildFrameworkActivate(fresh.framework, actorUid, { organization: fresh.organization, nodes: fresh.nodes });   // the builder re-validates readiness
            await writer.update(db, framework.id, data);
            await audit("curriculum.framework.activate", framework.id, { name: framework.name, nodeCount: readiness.stats.nodeCount, activeCount: readiness.stats.activeCount });
            return succeed("Đã kích hoạt khung.", framework.id);
          } catch (error) {
            if (error instanceof FlowAbort && error.kind === "tooLarge") { showPhase({ phase: "blocked", message: H.MESSAGES.tooLarge }); return; }
            const info = H.describeContractError(error);
            if (info && info.kind === "notReady") { showPhase({ phase: "blocked", message: info.message }); return; }
            await onFailure(error, { frameworkId: framework.id, expectStatus: "draft" });
          } finally { const c = modal$("#orgFwConfirm"); if (c && document.contains(c) && label) c.textContent = label; }
        });
      }
    }

    // ---------------------------------------------------------- P3-S5: clone / delete never-activated draft (only when cloneTools is injected; see curriculum-clone-delete.mjs)
    const X = cloneTools && cloneTools.helpers, CW = cloneTools && cloneTools.writer;
    class CloneVerifyError extends Error {}
    const progress = (message) => { const el = modal$("#orgFwProgress"); if (el) { el.textContent = message; el.classList.remove("hidden"); } };
    const dialogIsOpen = () => !!(modalRoot() && modal$('[role="dialog"]'));
    // Rollback of a failed clone: delete the nodes, then the never-activated draft framework (children first, never orphans). false = could not finish (the leftover is a
    // detectably incomplete draft: activation is blocked and it can be deleted with XÓA BẢN NHÁP).
    async function rollbackClone(destId) {
      try {
        const existing = await queries.frameworkById(db, destId, { organizationId: org.id });
        if (!existing) return true;   // the framework create never reached the server: nothing to undo
        const result = await queries.nodesOfFramework(db, destId, org.id);
        for (const ids of X.planDeleteDraft(result.items).chunks) await CW.deleteNodes(db, destId, ids);
        await CW.deleteFramework(db, destId);
        return true;
      } catch { return false; }
    }
    function openClone(framework) {
      if (!X || busy || org.status !== "active") return;
      dialogOpen(X.renderCloneFormHtml({ framework, defaultName: X.defaultCloneName(framework.name), esc }), "#orgFwName");
      const form = modal$("#orgFwForm"), input = modal$("#orgFwName");
      form.onsubmit = (event) => {
        event.preventDefault();
        exclusive(async () => {
          hide(modal$("#orgFwNameErr")); hide(modal$("#orgFwErr")); hide(modal$("#orgFwProgress"));
          let name;
          try { name = H.validateName(input.value); } catch { show(modal$("#orgFwNameErr"), H.MESSAGES.name); input.focus(); return; }
          const submit = modal$("#orgFwSubmit"), label = submit && submit.textContent; if (submit) submit.textContent = "ĐANG NHÂN BẢN…";
          let destId = null, started = false, plan = null;
          try {
            const fresh = await readFresh(framework.id, { withNodes: true });
            if (H.frameworkChangedSince(framework, fresh.framework, { compareUpdatedAt: true }).changed) throw new FlowAbort("stale");
            destId = CW.newFrameworkId(db);
            plan = X.planClone({ nodes: fresh.nodes, organizationId: org.id, newId: () => CW.newNodeId(db, destId) });
            if (!plan.ok) { show(modal$("#orgFwErr"), plan.message); return; }
            // everything is validated and built BEFORE the first write (structure, depth, canonical duplicate codes, node cap)
            const frameworkData = contract.buildFrameworkCreate({ organization: fresh.organization, name, cloneSource: { framework: fresh.framework, nodeCount: plan.total } }, actorUid);
            const payloads = X.buildClonePayloads({ contract, organization: fresh.organization, destination: { id: destId, organizationId: org.id, status: "draft" }, plan });
            const itemOf = (item) => ({ id: item.newId, data: payloads.creates.get(item.newId) });
            started = true;
            progress("Đang tạo khung…");
            await CW.createFramework(db, destId, frameworkData);
            let done = 0;
            for (const items of plan.createChunks) { await CW.createNodes(db, destId, items.map(itemOf)); done += items.length; progress("Đã sao chép " + done + "/" + plan.total + " nút…"); }
            for (const ids of plan.retireChunks) await CW.updateNodes(db, destId, ids.map((id) => ({ id, data: payloads.retires.get(id) })));
            if (plan.finalItems.length) await CW.createNodes(db, destId, plan.finalItems.map(itemOf));   // the LAST node: the count reaches nodeCount only now
            progress("Đang xác minh…");
            const check = await queries.nodesOfFramework(db, destId, org.id);
            if (check.tooLarge || !X.verifyClone(plan, check.items)) throw new CloneVerifyError("verify");
            await audit("curriculum.framework.clone", destId, { name, sourceFrameworkId: framework.id, nodeCount: plan.total });
            return succeed("Đã nhân bản khung chương trình.", destId);
          } catch (error) {
            if (error instanceof FlowAbort && error.kind === "tooLarge") { show(modal$("#orgFwErr"), X.MESSAGES.tooLarge); return; }
            if (!started) return onFailure(error, { frameworkId: framework.id, expectStatus: framework.status });   // nothing was written
            // a lost response does not mean a failed clone: if the destination is complete and verified, finish normally (never roll back a good clone)
            let good = false;
            try { const check = await queries.nodesOfFramework(db, destId, org.id); good = !check.tooLarge && X.verifyClone(plan, check.items); } catch { /* unknown: fall through to the rollback */ }
            if (good) { await audit("curriculum.framework.clone", destId, { name, sourceFrameworkId: framework.id, nodeCount: plan.total }); return succeed("Đã nhân bản khung chương trình.", destId); }
            const cleaned = await rollbackClone(destId);
            const contractInfo = H.describeContractError(error);
            const kind = H.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
            const reason = error instanceof CloneVerifyError ? X.MESSAGES.cloneVerify : contractInfo ? contractInfo.message : kind === "permission-denied" ? H.MESSAGES.permissionWrite : mapError(error);
            const text = reason + " " + (cleaned ? X.MESSAGES.cloneRolledBack : X.MESSAGES.cloneLeftover);
            if (dialogIsOpen() && modal$("#orgFwErr")) show(modal$("#orgFwErr"), text); else { toast(text, "err"); live(text); }
            await load();   // show the TRUE state of the list
          } finally { if (submit && document.contains(submit) && label) submit.textContent = label; }
        });
      };
    }
    function openDeleteDraft(framework) {
      if (!X || busy || org.status !== "active") return;
      dialogOpen(X.renderDeleteDraftHtml({ framework, esc }), "#orgFwCancel");
      const ok = modal$("#orgFwConfirm");
      ok.onclick = () => exclusive(async () => {
        hide(modal$("#orgFwErr")); hide(modal$("#orgFwProgress"));
        const label = ok.textContent; ok.textContent = "ĐANG XÓA…";
        let started = false;
        try {
          const fresh = await readFresh(framework.id, { withNodes: true });
          if (H.frameworkChangedSince(framework, fresh.framework).changed || !model.frameworkAvailability(fresh.framework, fresh.organization).canDelete) throw new FlowAbort("stale");
          const plan = X.planDeleteDraft(fresh.nodes);
          started = true;
          let done = 0;
          for (const ids of plan.chunks) { await CW.deleteNodes(db, framework.id, ids); done += ids.length; progress("Đã xóa " + done + "/" + plan.total + " nút…"); }
          await CW.deleteFramework(db, framework.id);   // the framework goes LAST: a failure before this leaves a smaller draft, never orphan nodes
          await audit("curriculum.framework.deleteDraft", framework.id, { name: framework.name, nodeCount: plan.total });
          return succeed("Đã xóa bản nháp.", null);
        } catch (error) {
          if (error instanceof FlowAbort && error.kind === "tooLarge") { show(modal$("#orgFwErr"), X.MESSAGES.tooLarge); return; }
          await onFailure(error, { frameworkId: framework.id, expectStatus: "draft" });
          const line = modal$("#orgFwErr");
          if (started && line && !line.classList.contains("hidden")) line.textContent += " " + X.MESSAGES.deletePartial;
        } finally { if (document.contains(ok) && label) ok.textContent = label; }
      });
    }

    await load();
  }
  return freeze({ mount });
}
