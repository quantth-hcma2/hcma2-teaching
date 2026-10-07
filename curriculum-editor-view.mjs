// Library V2 P3-S4 - Platform Admin curriculum NODE EDITOR (MÔN → BÀI) for one framework, opened from the P3-S3 framework list.
// UI only. This module imports NOTHING: every dependency is injected by index.html (one instance of each P3-S2 module per page). All domain logic stays in P3-S2:
//   model    = curriculum-model.mjs          (buildTree, frameworkAvailability, activationReadiness, uiKindForParent, canAddChild, planSiblingMove, codeConflictOf, validators, constants)
//   queries  = curriculum-queries.mjs        (frameworkById, nodesOfFramework)
//   contract = curriculum-write-contract.mjs (buildNodeCreate / buildNodeUpdate / buildNodeRetire / buildNodeRestore / buildNodeReorder)
// plus the P3-S3 helper instance (viewHelpers: framework status view, readiness text, error classification) shared by injection, never copied.
// This file only (1) turns state into markup and user-facing messages (pure helpers, section 1), (2) is the thin Firestore transport for payloads built by the
// contract (section 2) and (3) runs the editor state machine (section 3). It never builds a Firestore payload, never orders a query, never decides authorization:
// the deployed P3-S1 Rules decide; what is hidden or disabled here is convenience. Owner decisions (S4): retire is PER NODE (no cascade); duplicate codes use the
// model's canonical policy (codeConflictOf), never a copy; mistakes are recovered by retire + recreate only (no hard-delete, no re-parent/move here).
// NOT here: framework activation (stays in the S3 list), clone, import, hard-delete, drag-and-drop, teacher/member UI, Organization switcher.

const freeze = Object.freeze;
const ERROR_NAME = "CurriculumContractError";
const isContractError = (error) => !!error && error.name === ERROR_NAME;
const DEFAULT_COLLAPSE_ABOVE = 60;   // frameworks with more nodes than this open collapsed (the node just edited stays visible)

// ================================================================ 1. pure helpers (no DOM access, no Firestore)
export function createCurriculumEditorHelpers({ model, viewHelpers } = {}) {
  if (!model || typeof model.buildTree !== "function" || typeof model.codeConflictOf !== "function") throw new TypeError("createCurriculumEditorHelpers requires the curriculum-model module (with codeConflictOf) as { model }");
  if (!viewHelpers || typeof viewHelpers.describeReadiness !== "function" || typeof viewHelpers.frameworkStatusView !== "function") throw new TypeError("createCurriculumEditorHelpers requires the P3-S3 helper instance as { viewHelpers }");
  const { NODE_NAME_MIN, NODE_NAME_MAX, NODE_CODE_MAX, CURRICULUM_MAX_NODES, NODE_WRITE_CHUNK, buildTree, frameworkAvailability, uiKindForParent, canAddChild, millisOf, sortedSiblings } = model;

  const KIND_LABEL = freeze({ subject: "Môn", unit: "Mục", lesson: "Bài" });
  const kindLabel = (kind) => KIND_LABEL[kind] || "Nút";
  const CREATE_SUBMIT = freeze({ subject: "THÊM MÔN", unit: "THÊM MỤC", lesson: "THÊM BÀI" });
  const NODE_STATUS_VIEW = freeze({
    active: freeze({ label: "Đang sử dụng", badge: "badge-green", icon: "✅" }),
    retired: freeze({ label: "Ngừng sử dụng", badge: "badge-gray", icon: "⏸️" })
  });
  const nodeStatusView = (status) => NODE_STATUS_VIEW[status] || freeze({ label: "Không xác định", badge: "badge-gray", icon: "❔" });

  const MESSAGES = freeze({
    ...viewHelpers.MESSAGES,
    missing: "Không tìm thấy khung (có thể đã bị xóa ở nơi khác). Hãy quay lại đơn vị.",
    stale: "Khung đã được thay đổi ở nơi khác. Đã tải lại.",
    duplicateCodeGeneric: "Mã này đã được dùng bởi một nút khác trong khung. Hãy chọn mã khác.",
    nodeName: "Tên cần từ " + NODE_NAME_MIN + " đến " + NODE_NAME_MAX + " ký tự.",
    nodeCode: "Mã tối đa " + NODE_CODE_MAX + " ký tự.",
    noChange: "Chưa có thay đổi nào để lưu.",
    nodeStale: "Nút đã được thay đổi ở nơi khác. Đã tải lại.",
    nodeMissing: "Không tìm thấy nút (có thể đã bị thay đổi ở nơi khác). Đã tải lại.",
    siblingsChanged: "Thứ tự các nút đã thay đổi ở nơi khác. Đã tải lại, chưa có thay đổi nào được ghi.",
    parentGone: "Nút cha không còn tồn tại. Đã tải lại.",
    parentRetired: "Nút cha đã ngừng sử dụng. Hãy khôi phục nút cha trước khi thêm nút con. Đã tải lại.",
    depth: "Không thể thêm nút ở cấp này.",
    nodeLimit: "Khung đã đạt số nút tối đa (" + CURRICULUM_MAX_NODES + ").",
    tooManySiblings: "Có quá nhiều nút cùng cấp để sắp xếp một lần. Hãy liên hệ quản trị hệ thống.",
    tooLargeEditor: "Khung có hơn " + CURRICULUM_MAX_NODES + " nút nên không thể hiển thị hoặc chỉnh sửa tại đây.",
    codeRaceNote: "Chỉ ngăn trùng mã ở phía ứng dụng; hệ thống không bảo đảm tuyệt đối khi hai người cùng sửa một lúc.",
    hiddenSiblings: "Đang ẩn một số nút cùng cấp. Hãy hiện các nút đã ngừng sử dụng để sắp xếp lại."
  });

  // The friendly duplicate-code message names the conflicting node (the model's canonical policy found it: case, whitespace and Unicode-equivalent codes collide).
  function duplicateCodeMessage(code, conflict) {
    if (!conflict) return MESSAGES.duplicateCodeGeneric;
    const state = conflict.status === "retired" ? " (đã ngừng sử dụng)" : "";
    return "Mã “" + code + "” đã được dùng bởi “" + (conflict.name || "—") + "”" + state + ". Hãy chọn mã khác hoặc sửa mã của nút đó.";
  }

  // ---- mode: what the editor allows (mirrors the Rules through model.frameworkAvailability; never an enabled control the Rules would reject)
  function editorMode(framework, organization) {
    if (organization && organization.status !== "active") return freeze({ editable: false, readOnly: true, reason: "organizationArchived" });
    const available = frameworkAvailability(framework, organization);
    if (available.canEditNodes) return freeze({ editable: true, readOnly: false, reason: null });
    return freeze({ editable: false, readOnly: true, reason: framework && framework.status === "archived" ? "frameworkArchived" : "frameworkUnavailable" });
  }
  const MODE_BANNER = freeze({
    organizationArchived: "📦 Đơn vị đã lưu trữ. Bạn chỉ có thể xem chương trình; khôi phục đơn vị để chỉnh sửa.",
    frameworkArchived: "📦 Khung đã lưu trữ. Bạn chỉ có thể xem; khôi phục khung trong danh sách để chỉnh sửa.",
    frameworkUnavailable: "Khung không ở trạng thái chỉnh sửa được. Bạn chỉ có thể xem."
  });
  const addSubjectDisabledReason = (mode) => (mode.editable ? null : (MODE_BANNER[mode.reason] || MODE_BANNER.frameworkUnavailable).replace(/^[^A-Za-zÀ-ỹ]+/, ""));

  // ---- what the UI offers for one node (the action matrix). ctx = { editable, siblingIndex, siblingCount, siblingsHidden }
  function safeCanAddChild(node) { try { return canAddChild(node); } catch { return false; } }
  function nodeControls(node, { editable = false, siblingIndex = 0, siblingCount = 1, siblingsHidden = false } = {}) {
    if (!editable || !node) return freeze({ edit: false, retire: false, restore: false, addChild: false, addChildKind: null, addChildBlocked: null, reorder: false, upDisabled: true, downDisabled: true, reorderHint: null });
    const retired = node.status === "retired";
    const childKind = safeCanAddChild(node) ? uiKindForParent(node) : null;
    return freeze({
      edit: true,
      retire: !retired,
      restore: retired,
      addChild: !retired && !!childKind,
      addChildKind: childKind,
      addChildBlocked: retired && childKind ? "Khôi phục " + kindLabel(node.kind) + " này trước khi thêm " + kindLabel(childKind) + "." : null,
      reorder: true,
      upDisabled: siblingsHidden || siblingIndex <= 0,
      downDisabled: siblingsHidden || siblingIndex >= siblingCount - 1,
      reorderHint: siblingsHidden ? MESSAGES.hiddenSiblings : null
    });
  }

  // ---- tree presentation (no DOM): nested rows in sibling order with counts, retired/child-of-retired notes; orphans reported separately, never dropped
  function summarizeNodes(nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const live = list.filter((node) => node && node.status !== "retired");
    const count = (kind) => live.filter((node) => node.kind === kind).length;
    return freeze({ total: list.length, subjects: count("subject"), units: count("unit"), lessons: count("lesson"), retired: list.length - live.length });
  }
  function summaryText(stats) {
    const parts = [stats.subjects + " Môn"];
    if (stats.units) parts.push(stats.units + " Mục");
    parts.push(stats.lessons + " Bài");
    if (stats.retired) parts.push(stats.retired + " ngừng sử dụng");
    return parts.join(" · ");
  }
  function presentTree(nodes, { showRetired = true } = {}) {
    const tree = buildTree(nodes);
    const hasLiveBelow = new Map();   // a retired node that still has non-retired descendants stays visible even when retired nodes are hidden (no live node is ever hidden)
    const markLive = (entry) => {
      let live = false;
      for (const child of entry.children) { const childLive = markLive(child); live = live || childLive || child.node.status !== "retired"; }
      hasLiveBelow.set(entry.node.id, live);
      return live;
    };
    for (const root of tree.roots) markLive(root);
    let hiddenCount = 0;
    const visible = (entry) => showRetired || entry.node.status !== "retired" || hasLiveBelow.get(entry.node.id);
    const build = (entry, parentRetired, siblings) => {
      const kids = entry.children;
      const shownKids = kids.filter(visible);
      const row = {
        node: entry.node, depth: entry.depth, parentRetired,
        children: shownKids.map((child) => build(child, parentRetired || entry.node.status === "retired", kids)),
        childCount: kids.length, retiredChildCount: kids.filter((child) => child.node.status === "retired").length,
        siblingIndex: siblings.indexOf(entry), siblingCount: siblings.length, siblingsHidden: siblings.some((sibling) => !visible(sibling))
      };
      return row;
    };
    const roots = tree.roots;
    const rows = roots.filter(visible).map((root) => build(root, false, roots));
    const countAll = (entry) => 1 + entry.children.reduce((sum, child) => sum + countAll(child), 0);
    const countHidden = (entry) => { if (!visible(entry)) hiddenCount += countAll(entry); else entry.children.forEach(countHidden); };   // a hidden node has no live descendant, so its whole subtree is hidden
    roots.forEach(countHidden);
    return freeze({ rows, orphans: tree.orphans, stats: summarizeNodes(nodes), hiddenCount, expandable: nodes.filter((node) => (tree.index.get(node.id) || { children: [] }).children.length > 0).map((node) => node.id) });
  }
  const defaultCollapsed = (nodes, ids) => (Array.isArray(nodes) && nodes.length > DEFAULT_COLLAPSE_ABOVE ? new Set(ids) : new Set());

  // ---- stale detection between what is on screen and a fresh read
  function nodeChangedSince(loaded, fresh) {
    if (!fresh) return freeze({ changed: true, reason: "missing" });
    if (!loaded) return freeze({ changed: false, reason: null });
    if (loaded.status !== fresh.status) return freeze({ changed: true, reason: "status" });
    if (millisOf(loaded.updatedAt) !== millisOf(fresh.updatedAt)) return freeze({ changed: true, reason: "updatedAt" });
    return freeze({ changed: false, reason: null });
  }
  const siblingSignature = (nodes, parentId) => sortedSiblings(nodes, parentId === undefined ? null : parentId).map((node) => node.id + ":" + node.order).join("|");
  const siblingsChangedSince = (loadedNodes, freshNodes, parentId) => siblingSignature(loadedNodes, parentId) !== siblingSignature(freshNodes, parentId);

  // ---- error classification (match CurriculumContractError by name + code, never instanceof). kind: validation | abort | message
  function describeNodeError(error) {
    if (!isContractError(error)) return null;
    switch (error.code) {
      case "NAME": return { kind: "validation", field: "name", message: MESSAGES.nodeName };
      case "CODE": return { kind: "validation", field: "code", message: MESSAGES.nodeCode };
      case "DUPLICATE_CODE": return { kind: "validation", field: "code", message: MESSAGES.duplicateCodeGeneric };
      case "ORGANIZATION_ARCHIVED": return { kind: "abort", abort: "orgArchived", message: MESSAGES.orgArchived };
      case "FRAMEWORK_READ_ONLY": case "ORGANIZATION_MISMATCH": return { kind: "abort", abort: "stale", message: MESSAGES.stale };
      case "TRANSITION": return { kind: "abort", abort: "nodeStale", message: MESSAGES.nodeStale };
      case "PARENT_NOT_FOUND": return { kind: "abort", abort: "parentGone", message: MESSAGES.parentGone };
      case "NODE_NOT_FOUND": return { kind: "abort", abort: "nodeMissing", message: MESSAGES.nodeMissing };
      case "DUPLICATE_ORDER": return { kind: "abort", abort: "siblingsChanged", message: MESSAGES.siblingsChanged };
      case "DEPTH_EXCEEDED": return { kind: "message", message: MESSAGES.depth };
      case "NODE_COUNT_EXCEEDED": return { kind: "message", message: MESSAGES.nodeLimit };
      default: return { kind: "message", message: "Dữ liệu không hợp lệ (" + String(error.code) + ")." };
    }
  }

  // ---- markup (every dynamic string goes through the injected escaper)
  const attr = (esc, value) => esc(String(value == null ? "" : value));
  function renderReadinessHtml({ framework, readiness, mode, nodeStats, esc }) {
    if (framework.status === "active" && mode.editable) return `<div class="card mt-8" id="edReadiness" data-readiness="active" style="border-color:#16a34a"><b>🟢 Khung đang áp dụng.</b> Thay đổi có hiệu lực ngay.</div>`;
    if (framework.status !== "draft" || !mode.editable || !readiness) return "";
    if (readiness.ready) return `<div class="card mt-8" id="edReadiness" data-readiness="ready" style="border-color:#16a34a"><b>✅ Sẵn sàng kích hoạt</b> <span class="mut">(${esc(nodeStats.subjects + " Môn đang sử dụng · " + readiness.stats.nodeCount + " nút")})</span><div class="small mut mt-8">Quay lại danh sách khung của đơn vị để kích hoạt.</div></div>`;
    const reasons = viewHelpers.describeReadiness(readiness);
    return `<div class="card mt-8" id="edReadiness" data-readiness="blocked" style="border-color:#f59e0b"><b>⚠️ Chưa sẵn sàng kích hoạt</b><ul style="margin:8px 0 0 18px">${reasons.map((r) => `<li data-reason="${attr(esc, r.code)}">${esc(r.text)}${r.count > 1 ? ` <span class="mut">(×${r.count})</span>` : ""}</li>`).join("")}</ul><div class="small mut mt-8">Hệ thống không tự sửa dữ liệu. Hoàn thiện khung rồi quay lại danh sách để kích hoạt.</div></div>`;
  }

  function renderNodeHtml(row, { editable, collapsed, flashId, esc }) {
    const { node } = row;
    const id = attr(esc, node.id), name = esc(node.name || "—");
    const status = nodeStatusView(node.status);
    const controls = nodeControls(node, { editable, siblingIndex: row.siblingIndex, siblingCount: row.siblingCount, siblingsHidden: row.siblingsHidden });
    const isCollapsed = collapsed.has(node.id) && row.children.length > 0;
    const button = (action, label, aria, cls = "") => `<button class="btn btn-outline${cls}" type="button" data-ed-action="${action}" data-node-id="${id}" aria-label="${attr(esc, aria)}">${label}</button>`;
    const kind = kindLabel(node.kind);
    const toggle = row.childCount > 0
      ? `<button class="btn btn-ghost" type="button" data-ed-action="toggle" data-node-id="${id}" aria-expanded="${isCollapsed ? "false" : "true"}" aria-controls="edKids-${id}" aria-label="${isCollapsed ? "Mở rộng" : "Thu gọn"}: ${name}">${isCollapsed ? "▸" : "▾"}</button>`
      : "";
    const childSummary = row.childCount > 0 ? ` · ${row.childCount} nút con${row.retiredChildCount ? ", " + row.retiredChildCount + " ngừng sử dụng" : ""}` : "";
    const actions = [
      controls.edit ? button("edit", "SỬA", "Sửa: " + (node.name || "")) : "",
      controls.addChild ? button("add-child", "+ Thêm " + kindLabel(controls.addChildKind), "Thêm " + kindLabel(controls.addChildKind) + " vào: " + (node.name || "")) : "",
      controls.addChildBlocked ? `<span class="small mut" data-hint="add-child-blocked">${esc(controls.addChildBlocked)}</span>` : "",
      controls.reorder ? `<button class="btn btn-outline" type="button" data-ed-action="up" data-node-id="${id}" aria-label="Chuyển lên: ${name}"${controls.upDisabled ? ` disabled${controls.reorderHint ? ` title="${attr(esc, controls.reorderHint)}"` : ""}` : ""}>▲</button><button class="btn btn-outline" type="button" data-ed-action="down" data-node-id="${id}" aria-label="Chuyển xuống: ${name}"${controls.downDisabled ? ` disabled${controls.reorderHint ? ` title="${attr(esc, controls.reorderHint)}"` : ""}` : ""}>▼</button>` : "",
      controls.retire ? button("retire", "NGỪNG SỬ DỤNG", "Ngừng sử dụng: " + (node.name || "")) : "",
      controls.restore ? `<button class="btn btn-ok" type="button" data-ed-action="restore" data-node-id="${id}" aria-label="Khôi phục: ${name}">KHÔI PHỤC</button>` : ""
    ].join(" ");
    const kids = row.children.length ? `<ul id="edKids-${id}" class="${isCollapsed ? "hidden" : ""}" style="list-style:none;padding:0;margin:8px 0 0 ${row.depth <= 3 ? 16 : 0}px">${row.children.map((child) => renderNodeHtml(child, { editable, collapsed, flashId, esc })).join("")}</ul>` : "";
    const note = row.parentRetired && node.status !== "retired" ? `<div class="small mut" data-note="parent-retired">thuộc nút đã ngừng sử dụng</div>` : "";
    return `<li data-node-row="${id}" data-node-kind="${attr(esc, node.kind)}" data-node-status="${attr(esc, node.status)}" data-node-depth="${row.depth}" style="margin-top:8px"><div style="border:1px solid var(--border);border-radius:12px;padding:10px;${node.status === "retired" ? "opacity:.75;background:#f8fafc;" : ""}${node.id === flashId ? "background:#f0fdf4;" : ""}">
      <div class="flex-between" style="flex-wrap:wrap;gap:8px;align-items:flex-start">
        <div style="min-width:0;flex:1 1 220px;display:flex;gap:6px;align-items:flex-start">${toggle}<div style="min-width:0"><div data-node-name="1" tabindex="-1" style="font-weight:650;overflow-wrap:anywhere;outline:none">${name}</div><div class="small mut" style="overflow-wrap:anywhere">${esc(kind)}${node.code ? ` · <span class="chip" data-node-code="1">${esc(node.code)}</span>` : ""}${esc(childSummary)}</div>${note}</div></div>
        <div class="flex gap-8" style="flex-wrap:wrap;align-items:center"><span class="badge ${status.badge}" data-node-badge="1"><span aria-hidden="true">${status.icon}</span> ${esc(status.label)}</span></div>
      </div>
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap;align-items:center">${actions}</div></div>${kids}</li>`;
  }

  // phase: loading | error | notFound | tooLarge | ready
  function renderEditorHtml({ phase, organization, framework, mode, presentation = null, readiness = null, showRetired = true, collapsed = new Set(), flashId = null, errorMessage = "", esc, fmtDate }) {
    const fwView = viewHelpers.frameworkStatusView(framework && framework.status);
    const created = framework ? "Tạo " + esc(fmtDate ? fmtDate(framework.createdAt) : "—") : "";
    const activated = framework && Object.prototype.hasOwnProperty.call(framework, "activatedAt") && framework.activatedAt ? " · Kích hoạt " + esc(fmtDate ? fmtDate(framework.activatedAt) : "—") : "";
    const back = `<button class="btn btn-ghost" type="button" data-ed-action="back" id="edBack">← Quay lại đơn vị</button>`;
    const header = `<div class="card" id="edHeader">
      <div class="flex-between" style="flex-wrap:wrap;gap:10px;align-items:flex-start"><div style="min-width:0;flex:1 1 260px"><h2 id="edTitle" tabindex="-1" style="margin:0;outline:none;overflow-wrap:anywhere">${esc((framework && framework.name) || "Khung chương trình")}</h2><div class="small mut mt-8">${esc((organization && organization.name) || "—")} · ${created}${activated}</div></div>
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap"><span class="badge ${fwView.badge}" id="edFwBadge"><span aria-hidden="true">${fwView.icon}</span> ${esc(fwView.label)}</span></div></div>
      ${mode.readOnly ? `<div class="card mt-8" id="edModeBanner" role="note" style="border-color:#94a3b8">${esc(MODE_BANNER[mode.reason] || MODE_BANNER.frameworkUnavailable)}</div>` : ""}</div>`;
    const live = `<div id="edLive" class="sr-only" role="status" aria-live="polite"></div>`;
    const wrap = (inner, busy) => `<section id="edRoot" aria-labelledby="edTitle"><div class="mt-8">${back}</div>${header}${live}<div id="edBody" class="mt-8" aria-busy="${busy ? "true" : "false"}">${inner}</div></section>`;
    if (phase === "loading") return wrap(`<div class="center-screen" style="min-height:100px" id="edLoading"><span class="spinner" role="status" aria-label="Đang tải chương trình"></span></div>`, true);
    if (phase === "error") return wrap(`<div class="empty-state" id="edError" role="alert"><div class="ic">⚠️</div><p>${esc(errorMessage)}</p><button class="btn btn-outline" type="button" id="edRetry" data-ed-action="retry">THỬ LẠI</button></div>`, false);
    if (phase === "notFound") return wrap(`<div class="empty-state" id="edNotFound" role="alert"><div class="ic">🔎</div><p>${esc(errorMessage)}</p></div>`, false);
    if (phase === "tooLarge") return wrap(`<div class="card" id="edTooLarge" role="alert" style="border-color:#f59e0b"><b>Khung quá lớn.</b> ${esc(MESSAGES.tooLargeEditor)}</div>`, false);
    const addReason = addSubjectDisabledReason(mode);
    const stats = presentation.stats;
    const toolbar = `<div class="card" id="edToolbar"><div class="flex-between" style="flex-wrap:wrap;gap:10px;align-items:center">
      <div><div class="small" id="edSummary" style="font-weight:650">${esc(summaryText(stats))}</div>${presentation.hiddenCount ? `<div class="small mut" id="edHiddenNote">Đang ẩn ${presentation.hiddenCount} nút ngừng sử dụng.</div>` : ""}</div>
      <div class="flex gap-8" style="flex-wrap:wrap;align-items:center">
        <button class="btn" type="button" id="edAddSubject" data-ed-action="add-subject"${mode.editable ? "" : ` disabled aria-describedby="edAddSubjectHint"`}>+ Thêm Môn</button>
        <button class="btn btn-outline" type="button" id="edToggleRetired" data-ed-action="toggle-retired" aria-pressed="${showRetired ? "true" : "false"}">${showRetired ? "Ẩn nút ngừng sử dụng" : "Hiện nút ngừng sử dụng"}</button>
        ${presentation.expandable.length ? `<button class="btn btn-outline" type="button" id="edToggleAll" data-ed-action="toggle-all">${presentation.expandable.every((nodeId) => collapsed.has(nodeId)) ? "Mở rộng tất cả" : "Thu gọn tất cả"}</button>` : ""}
      </div></div>${mode.editable ? "" : `<div class="hint" id="edAddSubjectHint">${esc(addReason)}</div>`}</div>`;
    let tree;
    if (!presentation.rows.length && !presentation.orphans.length) {
      tree = stats.total
        ? `<div class="empty-state" id="edAllHidden"><div class="ic">👁️</div><p>Mọi nút đang bị ẩn vì đã ngừng sử dụng. Hãy bấm “Hiện nút ngừng sử dụng”.</p></div>`
        : `<div class="empty-state" id="edEmpty"><div class="ic">🌱</div><h3>Khung chưa có Môn nào</h3><p>${mode.editable ? "Thêm Môn đầu tiên, sau đó thêm Bài vào từng Môn." : "Khung này chưa có nội dung."}</p>${mode.editable ? `<button class="btn" type="button" data-ed-action="add-subject" id="edEmptyAdd">+ Thêm Môn</button>` : ""}</div>`;
    } else {
      tree = `<ul id="edTree" style="list-style:none;padding:0;margin:0">${presentation.rows.map((row) => renderNodeHtml(row, { editable: mode.editable, collapsed, flashId, esc })).join("")}</ul>`;
    }
    const orphans = presentation.orphans.length
      ? `<div class="card mt-14" id="edOrphans" role="alert" style="border-color:#f59e0b"><b>Nút lỗi cấu trúc (${presentation.orphans.length})</b><p class="small mut">Các nút dưới đây không nối được vào cây (thiếu nút cha hoặc có vòng lặp). Chúng không thể sửa tại đây và chặn việc kích hoạt khung.</p><ul style="margin:8px 0 0 18px">${presentation.orphans.map((node) => `<li data-orphan="${attr(esc, node.id)}">${esc(node.name || "—")} <span class="mut">(${esc(kindLabel(node.kind))})</span></li>`).join("")}</ul></div>`
      : "";
    return wrap(`${renderReadinessHtml({ framework, readiness, mode, nodeStats: stats, esc })}${toolbar}<div class="mt-8">${tree}</div>${orphans}`, false);
  }

  const dialogHead = (id, title) => `<div role="dialog" aria-modal="true" aria-labelledby="${id}"><h3 id="${id}">${title}</h3>`;
  // mode "create": parent = node | null; mode "edit": node
  function renderNodeFormHtml({ mode, parent = null, node = null, kind, esc }) {
    const label = kindLabel(mode === "create" ? kind : node.kind);
    const title = mode === "create" ? (parent ? "Thêm " + label + " vào " + esc(parent.name || "—") : "Thêm " + label) : "Sửa " + label;
    const more = mode === "create" ? `<button type="button" class="btn btn-outline" id="edSubmitMore">THÊM VÀ NHẬP TIẾP</button>` : "";
    return `${dialogHead("edDialogTitle", title)}
      <form id="edForm" novalidate>
        <div class="field"><label for="edName">Tên ${esc(label)} *</label><input type="text" id="edName" maxlength="${NODE_NAME_MAX}" autocomplete="off" value="${mode === "edit" ? attr(esc, node.name || "") : ""}" aria-describedby="edNameErr"><div id="edNameErr" class="error-text hidden" role="alert"></div></div>
        <div class="field"><label for="edCode">Mã (tùy chọn)</label><input type="text" id="edCode" maxlength="${NODE_CODE_MAX + 20}" autocomplete="off" value="${mode === "edit" ? attr(esc, node.code || "") : ""}" aria-describedby="edCodeHint edCodeErr"><div class="hint" id="edCodeHint">Mã không phân biệt hoa/thường và khoảng trắng thừa; tối đa ${NODE_CODE_MAX} ký tự. Chỉ ngăn trùng mã ở phía ứng dụng.</div><div id="edCodeErr" class="error-text hidden" role="alert"></div></div>
        <div id="edInfo" class="small mut hidden" role="status" aria-live="polite"></div>
        <div id="edErr" class="error-text hidden" role="alert"></div>
        <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="edCancel">Hủy</button><div class="flex gap-8" style="flex-wrap:wrap">${more}<button type="submit" class="btn" id="edSubmit">${mode === "create" ? CREATE_SUBMIT[mode === "create" ? kind : node.kind] || "THÊM" : "LƯU"}</button></div></div>
      </form></div>`;
  }
  function renderRetireConfirmHtml({ node, framework, esc }) {
    const label = kindLabel(node.kind);
    const live = framework && framework.status === "active" ? `<p class="mut">Khung đang áp dụng: thay đổi có hiệu lực ngay.</p>` : "";
    return `${dialogHead("edDialogTitle", "Ngừng sử dụng " + esc(label) + "?")}
      <p><b>${esc(node.name || "—")}</b></p>
      <p class="mut">Ngừng sử dụng <b>không phải là xóa</b>: ${esc(label)} vẫn được lưu, mã của nó vẫn được giữ chỗ và bạn có thể khôi phục bất cứ lúc nào. Các nút con giữ nguyên trạng thái riêng của chúng.</p>${live}
      <div id="edErr" class="error-text hidden" role="alert"></div>
      <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="edCancel">Hủy</button><button type="button" class="btn btn-danger" id="edConfirm">NGỪNG SỬ DỤNG</button></div></div>`;
  }

  return freeze({
    MESSAGES, kindLabel, nodeStatusView, duplicateCodeMessage, editorMode, nodeControls, summarizeNodes, summaryText, presentTree, defaultCollapsed,
    nodeChangedSince, siblingsChangedSince, describeNodeError, NODE_WRITE_CHUNK,
    renderEditorHtml, renderNodeFormHtml, renderRetireConfirmHtml
  });
}

// ================================================================ 2. Firestore transport for payloads already built by the P3-S2 write contract
export function createCurriculumNodeWriter({ collection, doc, setDoc, updateDoc, writeBatch, maxBatch = 400 }) {
  const nodes = (db, frameworkId) => collection(db, "curriculumFrameworks", frameworkId, "nodes");
  const ref = (db, frameworkId, id) => doc(db, "curriculumFrameworks", frameworkId, "nodes", id);
  return freeze({
    newId: (db, frameworkId) => doc(nodes(db, frameworkId)).id,
    create: (db, frameworkId, id, data) => setDoc(ref(db, frameworkId, id), data),
    update: (db, frameworkId, id, data) => updateDoc(ref(db, frameworkId, id), data),
    // ONE atomic batch (all or nothing): items = [{ id, data }] exactly as returned by contract.buildNodeReorder
    async updateMany(db, frameworkId, items) {
      if (!Array.isArray(items) || items.length === 0 || items.length > maxBatch) throw new TypeError("updateMany needs 1.." + maxBatch + " items");
      const batch = writeBatch(db);
      for (const item of items) batch.update(ref(db, frameworkId, item.id), item.data);
      await batch.commit();
    }
  });
}

// ================================================================ 3. editor controller
// deps: { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
//         model, viewHelpers (createCurriculumViewHelpers instance), queries, organizationQueries ({ organizationById(db, id) }), contract, writer (createCurriculumNodeWriter) }
// mount(container, { organization, framework, onBack }) replaces the container content with the editor; it never throws. Every mutation starts from a FRESH read of
// the Organization, the framework and the whole (bounded) tree; there is no optimistic UI and no unsaved state.
class FlowAbort extends Error { constructor(kind) { super(kind); this.kind = kind; } }

export function createCurriculumEditor(deps) {
  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, model, viewHelpers, queries, organizationQueries, contract, writer } = deps;
  const E = createCurriculumEditorHelpers({ model, viewHelpers });
  const modalRoot = () => document.getElementById("globalModal");
  const modal$ = (selector) => { const root = modalRoot(); return root ? root.querySelector(selector) : null; };
  const show = (el, message) => { if (el) { el.textContent = message; el.classList.remove("hidden"); } };
  const hide = (el) => { if (el) { el.textContent = ""; el.classList.add("hidden"); } };

  function mount(container, { organization, framework, onBack } = {}) {
    if (!container) return;
    if (!isPlatformAdmin) { container.innerHTML = ""; return; }
    let org = organization, fw = framework, nodes = [], phase = "loading", errorMessage = "", readiness = null;
    let generation = 0, busy = false, showRetired = true, collapsed = new Set(), flashId = null, trigger = null, pendingFocus = null, firstLoad = true;
    const host = document.createElement("div");   // own element: its delegated click handler disappears with it when the container is repainted (Quay lại / admin navigation)
    host.id = "curriculumEditorHost";
    container.innerHTML = ""; container.appendChild(host);
    const live = (message) => { const el = host.querySelector("#edLive"); if (el) el.textContent = message; };
    const modeNow = () => E.editorMode(fw, org);

    // ---------------------------------------------------------- painting / loading
    function paint() {
      const mode = modeNow();
      host.innerHTML = E.renderEditorHtml({
        phase, organization: org, framework: fw, mode, errorMessage, readiness, showRetired, collapsed, flashId, esc, fmtDate,
        presentation: phase === "ready" ? E.presentTree(nodes, { showRetired }) : null
      });
      if (phase === "ready" && flashId) { const id = flashId; flashId = null; setTimeout(() => { const row = host.querySelector(`[data-node-row="${id}"] > div`); if (row) row.style.background = ""; }, 2500); }
    }
    const focusSelector = (selector) => { const el = selector && host.querySelector(selector); if (el) { el.focus(); return true; } return false; };
    const nodeSel = (action, id) => `[data-ed-action="${action}"][data-node-id="${id}"]`;
    function applyPendingFocus() {
      const wanted = pendingFocus; pendingFocus = null;
      if (!wanted) return;
      for (const selector of wanted) if (focusSelector(selector)) return;
      focusSelector("#edTitle");
    }
    function expandPathTo(nodeId) {   // make sure a node that just changed is visible
      const byId = new Map(nodes.map((node) => [node.id, node]));
      for (let node = byId.get(nodeId), guard = 0; node && guard < 10; guard++) { collapsed.delete(node.id); node = node.parentId ? byId.get(node.parentId) : null; }
    }
    async function load({ quiet = false } = {}) {
      const mine = ++generation;
      if (quiet && phase === "ready") { const body = host.querySelector("#edBody"); if (body) body.setAttribute("aria-busy", "true"); }
      else { phase = "loading"; paint(); }
      try {
        const freshOrg = await organizationQueries.organizationById(db, org.id);
        if (mine !== generation) return;
        if (!freshOrg) { phase = "notFound"; errorMessage = E.MESSAGES.orgMissing; paint(); return; }
        org = freshOrg;
        let freshFramework = null;
        try { freshFramework = await queries.frameworkById(db, fw.id, { organizationId: org.id }); } catch (error) { if (!isContractError(error)) throw error; }
        if (mine !== generation) return;
        if (!freshFramework) { phase = "notFound"; errorMessage = E.MESSAGES.missing; paint(); return; }
        fw = freshFramework;
        const result = await queries.nodesOfFramework(db, fw.id, org.id);
        if (mine !== generation) return;
        if (result.tooLarge) { nodes = []; readiness = null; phase = "tooLarge"; paint(); return; }
        nodes = result.items;
        readiness = fw.status === "draft" && modeNow().editable ? model.activationReadiness(fw, nodes, { organization: org }) : null;
        if (firstLoad) { firstLoad = false; collapsed = E.defaultCollapsed(nodes, E.presentTree(nodes).expandable); }
        phase = "ready";
        paint(); applyPendingFocus();
      } catch (error) {
        if (mine !== generation) return;
        const kind = viewHelpers.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
        phase = "error"; errorMessage = kind === "permission-denied" ? E.MESSAGES.permissionRead : mapError(error);
        paint();
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
      const body = host.querySelector("#edBody"); if (body) body.setAttribute("aria-busy", on ? "true" : "false");
    }
    async function exclusive(fn) {
      if (busy) return;
      setBusy(true);
      try { return await fn(); } finally { setBusy(false); }
    }

    // ---------------------------------------------------------- dialog helpers (focus, Escape, return focus)
    // ONE focus-restoration contract for every dismissal path (Cancel, Escape, backdrop click): back to the control that opened the dialog (found again by its selector,
    // because the tree may have been repainted since), or to the editor heading when that control no longer exists.
    function restoreFocus() {
      const opener = trigger && host.querySelector(trigger);
      if (opener && !opener.disabled) opener.focus(); else focusSelector("#edTitle");
    }
    function dialogClose() { closeModal(); restoreFocus(); }
    const dialogIsOpen = () => !!(modalRoot() && modal$('[role="dialog"]'));
    function dialogOpen(html, focusSel) {
      openModal(html);
      const shell = modal$(".modal");
      if (shell) { shell.setAttribute("tabindex", "-1"); shell.style.outline = "none"; shell.addEventListener("keydown", (event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); dialogClose(); } }); }
      const backdrop = modalRoot() && modalRoot().querySelector("#modalBackdrop");
      if (backdrop) backdrop.addEventListener("click", (event) => { if (event.target === backdrop) restoreFocus(); });   // the shared openModal already closed it
      const cancel = modal$("#edCancel"); if (cancel) cancel.onclick = () => { if (!busy) dialogClose(); };
      const target = focusSel && modal$(focusSel); if (target) target.focus();
    }

    // ---------------------------------------------------------- fresh reads and aborts
    // Re-reads Organization -> framework -> (tree). Aborts when the Organization is archived/missing, the framework is gone, no longer editable or changed status.
    async function readFresh({ withNodes = false } = {}) {
      const freshOrg = await organizationQueries.organizationById(db, org.id);
      if (!freshOrg) throw new FlowAbort("orgMissing");
      org = freshOrg;
      if (freshOrg.status !== "active") throw new FlowAbort("orgArchived");
      let freshFramework = null;
      try { freshFramework = await queries.frameworkById(db, fw.id, { organizationId: org.id }); } catch (error) { if (isContractError(error)) throw new FlowAbort("missing"); throw error; }
      if (!freshFramework) throw new FlowAbort("missing");
      if (freshFramework.status !== fw.status || !model.frameworkAvailability(freshFramework, freshOrg).canEditNodes) throw new FlowAbort("stale");
      let freshNodes = null;
      if (withNodes) {
        const result = await queries.nodesOfFramework(db, fw.id, org.id);
        if (result.tooLarge) throw new FlowAbort("tooLarge");
        freshNodes = result.items;
      }
      return { organization: freshOrg, framework: freshFramework, nodes: freshNodes };
    }
    const ABORT_MESSAGE = {
      orgArchived: E.MESSAGES.orgArchived, orgMissing: E.MESSAGES.orgMissing, missing: E.MESSAGES.missing, stale: E.MESSAGES.stale, tooLarge: E.MESSAGES.tooLargeEditor,
      nodeStale: E.MESSAGES.nodeStale, nodeMissing: E.MESSAGES.nodeMissing, siblingsChanged: E.MESSAGES.siblingsChanged, parentGone: E.MESSAGES.parentGone, parentRetired: E.MESSAGES.parentRetired,
      depth: E.MESSAGES.depth, tooManySiblings: E.MESSAGES.tooManySiblings
    };
    // An abort that invalidates what is on screen: close the dialog, tell the user, reload (the editor repaints read-only when the Organization is archived).
    async function finishAbort(abort) {
      if (dialogIsOpen()) closeModal();
      const message = ABORT_MESSAGE[abort.kind] || E.MESSAGES.stale;
      toast(message, abort.kind === "orgArchived" ? "warn" : "err");
      pendingFocus = ["#edTitle"];
      await load({ quiet: true });
      live(message);
    }
    // After a failed write: decide WHY by re-reading (never guess). Returns { abort } for state changes or { message } to show inline.
    async function diagnose(error, { nodeId } = {}) {
      const info = E.describeNodeError(error);
      if (info) return info.kind === "abort" ? { abort: new FlowAbort(info.abort) } : { message: info.message };
      const kind = viewHelpers.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
      if (kind === "permission-denied" || kind === "not-found") {
        try {
          const fresh = await readFresh({ withNodes: !!nodeId });
          if (nodeId && !fresh.nodes.some((node) => node.id === nodeId)) return { abort: new FlowAbort("nodeMissing") };
          return kind === "not-found" ? { abort: new FlowAbort("nodeMissing") } : { message: E.MESSAGES.permissionWrite };
        } catch (probe) {
          if (probe instanceof FlowAbort) return { abort: probe };
          return { message: E.MESSAGES.permissionWrite };
        }
      }
      return { message: mapError(error) + (kind === "unknown-outcome" ? " " + E.MESSAGES.uncertain : "") };
    }
    // inlineTarget: where a non-abort message goes (the dialog error line, or the toast + live region when no dialog is open)
    async function onFailure(error, ctx = {}) {
      if (error instanceof FlowAbort) return finishAbort(error);
      const result = await diagnose(error, ctx);
      if (result.abort) return finishAbort(result.abort);
      const line = dialogIsOpen() && modal$("#edErr");
      if (line) show(line, result.message);
      else { toast(result.message, "err"); await load({ quiet: true }); live(result.message); }   // no dialog (restore / reorder): show the TRUE state, the outcome may be uncertain
    }
    const audit = async (action, nodeId, detail) => { try { await logAudit(action, "curriculumFramework", fw.id, { organizationId: org.id, nodeId, ...detail }); } catch { /* best effort: never blocks or rolls back */ } };
    async function afterSuccess({ message, flash = null, focus = null, expandTo = null, keepDialog = false }) {
      if (!keepDialog && dialogIsOpen()) closeModal();
      toast(message, "ok");
      flashId = flash;
      if (expandTo) expandPathTo(expandTo);
      pendingFocus = focus;
      await load({ quiet: true });
      live(message);
    }
    const ctxOf = (fresh) => ({ organization: fresh.organization, framework: fresh.framework, nodes: fresh.nodes });

    // ---------------------------------------------------------- create Môn / Bài (no confirmation; ONE pending document id per submit; add-and-continue)
    function openCreate(parentId, openerSelector) {
      if (busy || !modeNow().editable) return;
      const parent = parentId ? nodes.find((node) => node.id === parentId) : null;
      if (parentId && !parent) return;
      const kind = model.uiKindForParent(parent);
      if (!kind || (parent && parent.status !== "active")) return;
      trigger = openerSelector;
      let pendingId = writer.newId(db, fw.id), attempted = false;
      dialogOpen(E.renderNodeFormHtml({ mode: "create", parent, kind, esc }), "#edName");
      const input = modal$("#edName"), codeInput = modal$("#edCode");
      const submit = (more) => exclusive(async () => {
        hide(modal$("#edNameErr")); hide(modal$("#edCodeErr")); hide(modal$("#edErr")); hide(modal$("#edInfo"));
        let name, code;
        try { name = model.validateNodeName(input.value); } catch { show(modal$("#edNameErr"), E.MESSAGES.nodeName); input.focus(); return; }
        try { code = model.normalizeNodeCode(codeInput.value); } catch { show(modal$("#edCodeErr"), E.MESSAGES.nodeCode); codeInput.focus(); return; }
        const button = more ? modal$("#edSubmitMore") : modal$("#edSubmit"), label = button && button.textContent; if (button) button.textContent = "ĐANG XỬ LÝ…";
        try {
          const fresh = await readFresh({ withNodes: true });
          const freshParent = parent ? fresh.nodes.find((node) => node.id === parent.id) : null;
          if (parent && !freshParent) throw new FlowAbort("parentGone");
          if (freshParent && freshParent.status !== "active") throw new FlowAbort("parentRetired");
          const freshKind = model.uiKindForParent(freshParent);
          if (!freshKind) throw new FlowAbort("depth");
          let created = fresh.nodes.find((node) => node.id === pendingId);   // an earlier attempt with an unknown outcome: if that document exists, it WAS written - never create a second one
          if (!(attempted && created)) {
            const conflict = model.codeConflictOf(fresh.nodes, code);
            if (conflict) { show(modal$("#edCodeErr"), E.duplicateCodeMessage(code, conflict)); codeInput.focus(); return; }
            const data = contract.buildNodeCreate({ id: pendingId, parent: freshParent, kind: freshKind, name, code }, ctxOf(fresh));
            attempted = true;
            await writer.create(db, fw.id, pendingId, data);
            created = { id: pendingId };
          }
          const doneId = pendingId;
          await audit("curriculum.node.add", doneId, { kind: freshKind, name, code });
          const text = "Đã thêm " + E.kindLabel(freshKind) + ": " + name + ".";
          if (more) {
            pendingId = writer.newId(db, fw.id); attempted = false;   // each node is individually validated and committed; the next one gets a new id
            input.value = ""; codeInput.value = "";
            await afterSuccess({ message: text, flash: doneId, expandTo: freshParent ? freshParent.id : null, keepDialog: true });
            const info = modal$("#edInfo"); if (info) show(info, text + " Nhập tiếp.");
            if (input && document.contains(input)) input.focus();
            return;
          }
          await afterSuccess({ message: text, flash: doneId, expandTo: freshParent ? freshParent.id : null, focus: [`[data-node-row="${doneId}"] [data-node-name]`, freshParent ? nodeSel("add-child", freshParent.id) : "#edAddSubject"] });
        } catch (error) { await onFailure(error, {}); }
        finally { if (button && document.contains(button) && label) button.textContent = label; }
      });
      modal$("#edForm").onsubmit = (event) => { event.preventDefault(); submit(false); };
      modal$("#edSubmitMore").onclick = () => submit(true);
    }

    // ---------------------------------------------------------- edit name / code (only the changed fields are sent)
    function openEdit(nodeId, openerSelector) {
      const node = nodes.find((item) => item.id === nodeId);
      if (busy || !node || !modeNow().editable) return;
      trigger = openerSelector;
      dialogOpen(E.renderNodeFormHtml({ mode: "edit", node, esc }), "#edName");
      const input = modal$("#edName"), codeInput = modal$("#edCode");
      modal$("#edForm").onsubmit = (event) => {
        event.preventDefault();
        exclusive(async () => {
          hide(modal$("#edNameErr")); hide(modal$("#edCodeErr")); hide(modal$("#edErr"));
          let name, code;
          try { name = model.validateNodeName(input.value); } catch { show(modal$("#edNameErr"), E.MESSAGES.nodeName); input.focus(); return; }
          try { code = model.normalizeNodeCode(codeInput.value); } catch { show(modal$("#edCodeErr"), E.MESSAGES.nodeCode); codeInput.focus(); return; }
          const changes = {};
          if (name !== (node.name || "")) changes.name = name;
          if (code !== (node.code === undefined ? null : node.code)) changes.code = code;
          if (!Object.keys(changes).length) { show(modal$("#edErr"), E.MESSAGES.noChange); return; }
          const submit = modal$("#edSubmit"), label = submit && submit.textContent; if (submit) submit.textContent = "ĐANG XỬ LÝ…";
          try {
            const fresh = await readFresh({ withNodes: true });
            const freshNode = fresh.nodes.find((item) => item.id === node.id);
            const changed = E.nodeChangedSince(node, freshNode);
            if (changed.changed) throw new FlowAbort(changed.reason === "missing" ? "nodeMissing" : "nodeStale");
            if (Object.prototype.hasOwnProperty.call(changes, "code")) {
              const conflict = model.codeConflictOf(fresh.nodes, changes.code, node.id);   // self-excluded: re-saving the node's own code never conflicts
              if (conflict) { show(modal$("#edCodeErr"), E.duplicateCodeMessage(changes.code, conflict)); codeInput.focus(); return; }
            }
            const data = contract.buildNodeUpdate(freshNode, changes, ctxOf(fresh));
            await writer.update(db, fw.id, node.id, data);
            await audit("curriculum.node.update", node.id, { kind: node.kind, from: { name: node.name, code: node.code === undefined ? null : node.code }, to: { name: changes.name !== undefined ? changes.name : node.name, code: changes.code !== undefined ? changes.code : (node.code === undefined ? null : node.code) } });
            return afterSuccess({ message: "Đã lưu " + E.kindLabel(node.kind) + ".", flash: node.id, expandTo: node.parentId || null, focus: [`[data-node-row="${node.id}"] [data-node-name]`] });
          } catch (error) { await onFailure(error, { nodeId: node.id }); }
          finally { if (submit && document.contains(submit) && label) submit.textContent = label; }
        });
      };
    }

    // ---------------------------------------------------------- retire (confirmation; PER NODE, no cascade) / restore (no confirmation)
    function openRetire(nodeId, openerSelector) {
      const node = nodes.find((item) => item.id === nodeId);
      if (busy || !node || node.status !== "active" || !modeNow().editable) return;
      trigger = openerSelector;
      dialogOpen(E.renderRetireConfirmHtml({ node, framework: fw, esc }), "#edCancel");
      const ok = modal$("#edConfirm");
      ok.onclick = () => exclusive(async () => {
        hide(modal$("#edErr"));
        const label = ok.textContent; ok.textContent = "ĐANG XỬ LÝ…";
        try { await changeStatus(node, "retire"); }
        catch (error) { await onFailure(error, { nodeId: node.id }); }
        finally { if (document.contains(ok)) ok.textContent = label; }
      });
    }
    async function changeStatus(node, action) {
      const fresh = await readFresh({ withNodes: true });
      const freshNode = fresh.nodes.find((item) => item.id === node.id);
      const changed = E.nodeChangedSince(node, freshNode);
      if (changed.changed) throw new FlowAbort(changed.reason === "missing" ? "nodeMissing" : "nodeStale");
      const data = action === "retire" ? contract.buildNodeRetire(freshNode, ctxOf(fresh)) : contract.buildNodeRestore(freshNode, ctxOf(fresh));
      await writer.update(db, fw.id, node.id, data);
      await audit("curriculum.node." + action, node.id, { kind: node.kind, name: node.name });
      return afterSuccess({
        message: action === "retire" ? "Đã ngừng sử dụng “" + node.name + "”." : "Đã khôi phục “" + node.name + "”.",
        flash: node.id, expandTo: node.parentId || null,
        focus: [nodeSel(action === "retire" ? "restore" : "retire", node.id), `[data-node-row="${node.id}"] [data-node-name]`]
      });
    }
    function restoreNode(nodeId, openerSelector) {
      const node = nodes.find((item) => item.id === nodeId);
      if (busy || !node || node.status !== "retired" || !modeNow().editable) return;
      trigger = openerSelector;
      return exclusive(async () => {
        try { await changeStatus(node, "restore"); } catch (error) { await onFailure(error, { nodeId: node.id }); }
      });
    }

    // ---------------------------------------------------------- reorder among siblings (Up / Down; ONE atomic batch from the approved plan/contract; no re-parenting)
    function moveNode(nodeId, direction) {
      const node = nodes.find((item) => item.id === nodeId);
      if (busy || !node || !modeNow().editable) return;
      const parentId = node.parentId === undefined ? null : node.parentId;
      return exclusive(async () => {
        try {
          const fresh = await readFresh({ withNodes: true });
          if (!fresh.nodes.some((item) => item.id === node.id)) throw new FlowAbort("nodeMissing");
          if (E.siblingsChangedSince(nodes, fresh.nodes, parentId)) throw new FlowAbort("siblingsChanged");
          const plan = model.planSiblingMove(fresh.nodes, node.id, direction);
          const siblings = model.sortedSiblings(fresh.nodes, parentId), index = siblings.findIndex((item) => item.id === node.id);
          if (plan.noop) { live(direction === "up" ? "Đã ở đầu danh sách." : "Đã ở cuối danh sách."); return; }
          const changes = contract.buildNodeReorder(plan, ctxOf(fresh));
          if (changes.length > E.NODE_WRITE_CHUNK) throw new FlowAbort("tooManySiblings");
          await writer.updateMany(db, fw.id, changes);
          const position = direction === "up" ? index : index + 2;   // 1-based new position
          await audit("curriculum.node.reorder", node.id, { kind: node.kind, direction, count: changes.length });
          const stillMovable = direction === "up" ? position > 1 : position < siblings.length;
          return afterSuccess({
            message: "Đã chuyển “" + node.name + "” " + (direction === "up" ? "lên" : "xuống") + " vị trí " + position + "/" + siblings.length + ".",
            flash: node.id, expandTo: parentId,
            focus: [nodeSel(stillMovable ? direction : (direction === "up" ? "down" : "up"), node.id), `[data-node-row="${node.id}"] [data-node-name]`]
          });
        } catch (error) { await onFailure(error, { nodeId: node.id }); }
      });
    }

    // ---------------------------------------------------------- events (one delegated click handler; buttons that are disabled never fire)
    host.onclick = (event) => {
      const button = event.target && event.target.closest ? event.target.closest("[data-ed-action]") : null;
      if (!button || !host.contains(button) || button.disabled) return;
      const action = button.dataset.edAction, id = button.dataset.nodeId;
      const selector = id ? nodeSel(action, id) : (button.id ? "#" + button.id : null);
      if (action === "back") { if (!busy && typeof onBack === "function") onBack(); return; }
      if (action === "retry") { load(); return; }
      if (busy) return;
      if (action === "toggle-retired") { showRetired = !showRetired; paint(); focusSelector("#edToggleRetired"); return; }
      if (action === "toggle-all") {
        const expandable = E.presentTree(nodes).expandable;
        collapsed = expandable.every((nodeId) => collapsed.has(nodeId)) ? new Set() : new Set(expandable);
        paint(); focusSelector("#edToggleAll"); return;
      }
      if (action === "toggle") { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); paint(); focusSelector(nodeSel("toggle", id)); return; }
      if (action === "add-subject") return openCreate(null, selector || "#edAddSubject");
      if (action === "add-child") return openCreate(id, selector);
      if (action === "edit") return openEdit(id, selector);
      if (action === "retire") return openRetire(id, selector);
      if (action === "restore") return restoreNode(id, selector);
      if (action === "up" || action === "down") return moveNode(id, action);
    };

    load().then(() => { if (phase !== "loading") focusSelector("#edTitle"); });
  }
  return freeze({ mount });
}
