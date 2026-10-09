// Library V2 P4-S3 - Template Center + Import Center (UI / PREVIEW ONLY) for one Organization. Vietnamese. READ-ONLY for curriculum data.
// This module imports NOTHING: every dependency is injected by index.html (like the P3 views). It never names a Firestore collection and never writes: the only
// thing it may read is the fresh Organization (organizationQueries.organizationById). The engine (P4-S2 reader host, validator, plan, template writer) is loaded LAZILY
// through deps.loadEngine() when the screen opens, and SheetJS 0.20.3 only inside the parsing Worker / on the first template download.
//
// Boundaries (P4-S3 authorization): no importBatches, frameworks or nodes are created; the source file never leaves the browser (no upload, no Storage, no persistence);
// the Organization is fixed for the whole flow (no switcher); the future "Xác nhận nhập" action is rendered DISABLED with a Vietnamese explanation and has no handler.
//
//   createImportViewHelpers()                 pure helpers + markup (no DOM access, no I/O)
//   createImportCenter(deps).mount(host, { organization, onBack })
// deps: { actorUid, isPlatformAdmin, esc, toast, mapError?, organizationQueries?, db?, loadEngine, downloadFile, makeReader?, commitTools? }
// P4-S4: with deps.commitTools = { firestore, acquireLock? } the screen also executes the import (confirm -> commit -> full read-back -> completed), offers recovery of an interrupted
// import and rollback; the execution logic lives in the lazy engine (import-commit-controller.mjs / import-run-helpers.mjs). Without commitTools the screen stays read-only (P4-S3).
const freeze = Object.freeze;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;       // mirrors IMPORT_LIMITS.maxFileBytes (pinned equal by the P4-S3 tests)
export const DIAGNOSTIC_PAGE = 100;                      // mirrors IMPORT_LIMITS.diagnostics.maxDisplayed
export const LESSON_PAGE = 100;
export const TREE_COLLAPSE_ABOVE = 60;                   // same constant as the P3-S4 editor

// ================================================================ 0. access (the approved P2/P3 authorization contract - NOT a new permission model)
// This is the client mirror of the deployed Rules helpers that guard curriculum: mayReadCurriculum = orgGoverns || hasOrgCap(org, 'curriculum.manage') and
// mayWriteCurriculum = orgActive && hasOrgCap(...) (P3-S1), where hasOrgCap = Platform Admin || (active account + active membership + active organization + (org_admin || the
// capability granted and not denied)). The Rules stay the authority; this only decides what the UI offers. Parity with the Rules is proven by test/library-v2-p4-s3/access.rules.test.mjs.
//   allowed    = may open the Import Center for this organization (== mayReadCurriculum)
//   canPrepare = may check a file and see a preview (== mayWriteCurriculum: the organization must be ACTIVE; an archived organization never prepares an import)
export const IMPORT_ACCESS_CAPABILITY = "curriculum.manage";
export function resolveImportAccess({ isPlatformAdmin = false, accountActive = true, actorUid, organization, membership, capability } = {}) {
  const deny = (reason) => freeze({ allowed: false, canPrepare: false, role: null, reason });
  if (!organization || typeof organization.id !== "string" || !organization.id) return deny("NO_ORGANIZATION");
  if (accountActive !== true) return deny("ACCOUNT_INACTIVE");
  const orgActive = organization.status === "active";
  if (isPlatformAdmin === true) return freeze({ allowed: true, canPrepare: orgActive, role: "platform_admin", reason: orgActive ? null : "ORGANIZATION_ARCHIVED" });
  if (!membership || membership.organizationId !== organization.id || typeof actorUid !== "string" || !actorUid || membership.uid !== actorUid) return deny("NOT_MEMBER");
  if (membership.status !== "active") return deny("MEMBERSHIP_INACTIVE");
  if (membership.orgRole === "org_admin") return freeze({ allowed: true, canPrepare: orgActive, role: "org_admin", reason: orgActive ? null : "ORGANIZATION_ARCHIVED" });   // governance survives archiving (read-only)
  if (membership.orgRole !== "member") return deny("NOT_MEMBER");
  if (!orgActive) return deny("ORGANIZATION_ARCHIVED");                                                                     // a capability holder has no access in an archived organization
  const caps = capability && capability.organizationId === organization.id && capability.uid === actorUid && Array.isArray(capability.caps) ? capability.caps : [];
  const denied = capability && Array.isArray(capability.denied) ? capability.denied : [];
  if (caps.includes(IMPORT_ACCESS_CAPABILITY) && !denied.includes(IMPORT_ACCESS_CAPABILITY)) return freeze({ allowed: true, canPrepare: true, role: "capability_holder", reason: null });
  return deny("NO_CAPABILITY");
}
const isMissing = (error) => !!error && (error.code === "permission-denied" || error.code === "not-found");   // for a non-admin the Rules answer a missing own document with permission-denied
// Reads exactly what the decision needs through the EXISTING organization queries (the organization, the user's OWN membership and, for an ordinary member, the user's OWN capability).
// Fail closed: a transient failure throws Error("ACCESS_CHECK_FAILED") (the caller shows a retry, never access).
export async function loadImportAccess({ db, organizationQueries, actorUid, organizationId, isPlatformAdmin = false } = {}) {
  if (!organizationQueries || typeof organizationQueries.organizationById !== "function" || !db) throw new Error("ACCESS_CHECK_FAILED");
  const read = async (fn, ...args) => { try { return (await fn(db, ...args)) || null; } catch (error) { if (isMissing(error)) return null; throw new Error("ACCESS_CHECK_FAILED"); } };
  const organization = await read(organizationQueries.organizationById, organizationId);
  if (!organization || isPlatformAdmin === true) return { organization, membership: null, capability: null };
  if (typeof organizationQueries.membershipOf !== "function") throw new Error("ACCESS_CHECK_FAILED");
  const membership = await read(organizationQueries.membershipOf, organizationId, actorUid);
  let capability = null;
  if (membership && membership.status === "active" && membership.orgRole === "member") {
    if (typeof organizationQueries.capabilityOf !== "function") throw new Error("ACCESS_CHECK_FAILED");
    capability = await read(organizationQueries.capabilityOf, organizationId, actorUid);
  }
  return { organization, membership, capability };
}

// ================================================================ 1. pure helpers
export function createImportViewHelpers() {
  const attr = (esc, v) => esc(String(v == null ? "" : v));

  const DENIED_REASONS = freeze({
    NO_ORGANIZATION: "Không xác định được đơn vị để nhập chương trình.",
    ACCOUNT_INACTIVE: "Tài khoản của bạn hiện không hoạt động nên không thể dùng chức năng nhập chương trình.",
    NOT_MEMBER: "Bạn không có quyền dùng chức năng nhập chương trình của đơn vị này.",
    MEMBERSHIP_INACTIVE: "Tư cách thành viên của bạn trong đơn vị này không còn hiệu lực.",
    NO_CAPABILITY: "Bạn cần được cấp quyền quản lý chương trình (curriculum.manage) trong đơn vị này để nhập chương trình.",
    ORGANIZATION_ARCHIVED: "Đơn vị đã lưu trữ: không thể chuẩn bị nhập chương trình."
  });
  const MESSAGES = freeze({
    denied: "Bạn không có quyền dùng chức năng nhập chương trình của đơn vị này.",
    checkingAccess: "Đang kiểm tra quyền truy cập…",
    accessCheckFailed: "Không kiểm tra được quyền truy cập lúc này. Hãy thử lại.",
    archived: "Đơn vị đã lưu trữ: không thể kiểm tra hoặc nhập tệp mới. Hãy khôi phục đơn vị trước. Bạn vẫn có thể tải tệp mẫu.",
    engineFailed: "Không tải được bộ đọc tệp Excel. Hãy kiểm tra kết nối mạng rồi thử lại.",
    readFailed: "Không thể đọc tệp này. Hãy thử lại hoặc dùng tệp mẫu của hệ thống.",
    templateFailed: "Không tạo được tệp mẫu. Hãy thử lại.",
    templateDone: "Đã tạo tệp mẫu. Tệp được tạo ngay trên máy của bạn.",
    local: "Tệp được đọc ngay trong trình duyệt của bạn. Không có dữ liệu nào được tải lên máy chủ hoặc lưu vào hệ thống ở bước này.",
    futureAction: "Chức năng nhập dữ liệu chưa được bật. Việc ghi vào hệ thống sẽ có trong bản phát hành sau; hiện bạn chỉ có thể kiểm tra tệp và xem trước.",
    notWritten: "Chưa có dữ liệu nào được ghi. Đây chỉ là bản xem trước.",
    notWrittenYet: "Chưa có dữ liệu nào được ghi: dữ liệu chỉ được ghi sau khi bạn xác nhận ở bước cuối.",
    tooLarge: "Tệp lớn hơn 5 MiB nên không thể đọc."
  });

  const CAPABILITY_LABELS = freeze({
    worker: "Tiến trình nền (Web Worker)",
    "module-worker": "Tiến trình nền dạng module",
    "decompression-stream": "Giải nén an toàn (DecompressionStream)",
    "readable-stream": "Luồng dữ liệu (ReadableStream)",
    "text-decoder": "Giải mã văn bản (TextDecoder)"
  });
  // BROWSER_UNSUPPORTED / missingCapabilities -> a Vietnamese explanation. Unknown ids are shown as-is (never dropped); the order of `missing` is preserved.
  function describeUnsupported(missing, minimum) {
    const items = (Array.isArray(missing) ? missing : []).map((id) => freeze({ id: String(id), label: CAPABILITY_LABELS[id] || String(id) }));
    const min = minimum && typeof minimum === "object" ? minimum : { chrome: 80, edge: 80, firefox: 114, safari: "16.4" };
    return freeze({
      title: "Trình duyệt này chưa hỗ trợ đọc tệp Excel một cách an toàn",
      lead: "Để bảo vệ dữ liệu, hệ thống chỉ đọc tệp trong một tiến trình nền tách biệt với các tính năng giải nén hiện đại. Trình duyệt hiện tại còn thiếu:",
      items: freeze(items),
      advice: "Hãy dùng Chrome " + min.chrome + "+, Edge " + min.edge + "+, Firefox " + min.firefox + "+ hoặc Safari " + min.safari + "+ (bản mới nhất). Hệ thống không đọc tệp bằng cách kém an toàn hơn."
    });
  }

  // ---- sizes / labels
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return bytes + " byte";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(".", ",") + " KiB";
    return (bytes / (1024 * 1024)).toFixed(2).replace(".", ",") + " MiB";
  }
  const SEVERITY_VIEW = freeze({ error: freeze({ label: "Lỗi", icon: "⛔", badge: "badge-red" }), warning: freeze({ label: "Cảnh báo", icon: "⚠️", badge: "badge-yellow" }) });
  const severityView = (severity) => SEVERITY_VIEW[severity] || SEVERITY_VIEW.error;
  const NOTE_LABELS = freeze({ trim: "đã cắt khoảng trắng", numeric: "mã đọc từ ô số", "order-text": "thứ tự đọc từ ô văn bản" });
  // node.notes look like "name:trim", "code:trim", "code:numeric", "order:order-text", "ref:trim" -> unique Vietnamese chips
  function noteChips(notes) {
    const out = [];
    for (const note of Array.isArray(notes) ? notes : []) {
      const [field, kind] = String(note).split(":");
      const label = NOTE_LABELS[kind];
      if (!label) continue;
      const chip = (field === "name" ? "tên: " : field === "code" ? "mã: " : field === "order" ? "" : field === "ref" ? "mã môn: " : "") + label;
      if (!out.includes(chip)) out.push(chip);
    }
    return out;
  }

  // ---- diagnostics: counts, filtering, paging, location
  function countDiagnostics(diagnostics) {
    const list = Array.isArray(diagnostics) ? diagnostics : [];
    return freeze({ errors: list.filter((d) => d.severity === "error").length, warnings: list.filter((d) => d.severity === "warning").length, total: list.length });
  }
  const FILE_LEVEL = "__file__";
  function sheetOptions(diagnostics) {
    const seen = new Map();
    for (const d of Array.isArray(diagnostics) ? diagnostics : []) { const key = d.sheet || FILE_LEVEL; seen.set(key, (seen.get(key) || 0) + 1); }
    return [...seen.entries()].map(([key, count]) => freeze({ key, count, label: key === FILE_LEVEL ? "Tệp và mẫu" : "Sheet " + key })).sort((a, b) => (a.key === FILE_LEVEL ? -1 : b.key === FILE_LEVEL ? 1 : a.key < b.key ? -1 : 1));
  }
  // returns [{ index (position in the FULL list), diagnostic }] so a filtered view still addresses the original diagnostics
  function filterDiagnostics(diagnostics, { severity = "all", sheet = "all" } = {}) {
    const out = [];
    (Array.isArray(diagnostics) ? diagnostics : []).forEach((diagnostic, index) => {
      if (severity !== "all" && diagnostic.severity !== severity) return;
      if (sheet !== "all" && (diagnostic.sheet || FILE_LEVEL) !== sheet) return;
      out.push({ index, diagnostic });
    });
    return out;
  }
  function locationText(d) {
    const parts = [];
    if (d.sheet) parts.push("Sheet “" + d.sheet + "”");
    if (d.row) parts.push("dòng " + d.row);
    if (d.column) parts.push("cột “" + d.column + "”");
    return parts.length ? parts.join(" · ") : "Toàn bộ tệp";
  }
  // body of a message without the leading "Sheet “X”, dòng N: " location (the UI shows the location as separate labelled fields)
  function messageBody(d) {
    const message = String(d.message || "");
    if (d.sheet) { const at = message.indexOf(": "); if (at > 0 && message.startsWith("Sheet “")) return message.slice(at + 2); }
    return message;
  }

  // ---- row inspector: the raw cells of one row of one sheet, with the sheet's own header names
  function rowCells(raw, sheetName, row) {
    const sheet = raw && Array.isArray(raw.sheets) ? raw.sheets.find((s) => s.name === sheetName && !s.notRead) : null;
    if (!sheet || !Number.isInteger(row) || row < 1) return null;
    const letter = (index) => { let t = "", v = index; do { t = String.fromCharCode(65 + (v % 26)) + t; v = Math.floor(v / 26) - 1; } while (v >= 0); return t; };
    const headers = new Map(sheet.cells.filter((c) => c.r === 1).map((c) => [c.c, String(c.v)]));
    return sheet.cells.filter((c) => c.r === row).sort((a, b) => a.c - b.c).map((c) => freeze({
      column: letter(c.c), header: headers.get(c.c) || "", type: c.f ? "công thức" : { s: "văn bản", n: "số", b: "logic", d: "ngày", e: "lỗi" }[c.t] || String(c.t),
      value: c.t === "n" ? String(c.w != null ? c.w : c.v) : c.t === "e" ? String(c.w || "lỗi") : String(c.v == null ? "" : c.v).slice(0, 200), formula: !!c.f
    }));
  }

  // ---- preview model: subjects in their effective order, each with its lessons
  const byOrder = (a, b) => (a.order - b.order) || (a.sourceRef.row - b.sourceRef.row);
  function buildPreview(model) {
    const nodes = Array.isArray(model && model.nodes) ? model.nodes : [];
    const subjects = nodes.filter((n) => n.kind === "subject").sort(byOrder);
    const lessonsOf = new Map(subjects.map((s) => [s.key, []]));
    for (const n of nodes) if (n.kind === "lesson" && lessonsOf.has(n.parentKey)) lessonsOf.get(n.parentKey).push(n);
    const groups = subjects.map((subject, position) => freeze({ subject, position: position + 1, lessons: lessonsOf.get(subject.key).sort(byOrder) }));
    return freeze({
      groups: freeze(groups), total: nodes.length, subjectCount: subjects.length, lessonCount: nodes.length - subjects.length,
      withCode: nodes.filter((n) => typeof n.code === "string").length, withoutCode: nodes.filter((n) => typeof n.code !== "string").length,
      collapseByDefault: nodes.length > TREE_COLLAPSE_ABOVE
    });
  }
  // plan (from prepareCommit) -> numbers only; the plan object itself is not kept
  function planSummary(plan) {
    const nodeCount = plan.nodes.length;
    return freeze({ nodeCount, totalDocuments: nodeCount + 2, chunkCount: plan.chunks.length, chunkSizes: freeze(plan.chunks.map((c) => c.count)), maxChunkWrites: plan.verification.maxChunkWrites, subjectCount: plan.verification.subjectCount, lessonCount: plan.verification.lessonCount });
  }

  // ---- markup
  function renderOrganizationHeaderHtml({ organization, esc }) {
    const archived = organization.status !== "active";
    return `<div class="card mt-14" id="impOrg" data-org-id="${attr(esc, organization.id)}" style="border-color:${archived ? "#94a3b8" : "var(--border)"}">
      <div class="small mut">🔒 Đơn vị đã chọn (cố định trong suốt quá trình nhập)</div>
      <div class="grid grid-3 mt-8"><div><div class="small mut">Tên đơn vị</div><b id="impOrgName" style="overflow-wrap:anywhere">${esc(organization.name || "—")}</b></div><div><div class="small mut">Mã đơn vị</div><code id="impOrgCode">${esc(organization.code || "—")}</code></div><div><div class="small mut">Mã nội bộ</div><code id="impOrgId" style="overflow-wrap:anywhere">${esc(organization.id)}</code></div></div>
      ${archived ? `<div class="mt-8" id="impOrgArchived" role="note"><b>📦 Đơn vị đã lưu trữ.</b> ${esc(MESSAGES.archived)}</div>` : ""}</div>`;
  }
  function renderTemplateCardHtml({ esc, busy = false, status = "", templateId, schemaVersion }) {
    return `<section class="card mt-14" id="impTemplateCard" aria-labelledby="impTemplateTitle">
      <h3 id="impTemplateTitle" style="margin:0">📄 Bước 1 · Tệp mẫu Excel</h3>
      <p class="mut mt-8">Tải tệp mẫu, điền Khung → Môn → Bài rồi chọn lại tệp ở Bước 2. Mẫu <code>${esc(templateId)}</code>, phiên bản ${esc(schemaVersion)}. Tệp mẫu được tạo ngay trên máy của bạn.</p>
      <div class="flex gap-8" style="flex-wrap:wrap"><button class="btn" type="button" id="impTemplateBlank" data-imp-action="template-blank"${busy ? " disabled" : ""}>⬇ TẢI FILE MẪU</button><button class="btn btn-outline" type="button" id="impTemplateExample" data-imp-action="template-example"${busy ? " disabled" : ""}>⬇ TẢI FILE MẪU CÓ VÍ DỤ</button></div>
      <div class="hint mt-8">“Tải file mẫu” là tệp trống đúng mẫu. “Có ví dụ” có sẵn dữ liệu minh họa: hãy xóa hoặc thay trước khi nhập thật.</div>
      <div class="small mt-8" id="impTemplateStatus" role="status" aria-live="polite">${esc(status)}</div>
      <details class="mt-8"><summary class="small">Quy tắc điền tệp</summary><ul class="small" style="margin:8px 0 0 18px">
        <li>Giữ nguyên 5 sheet: HƯỚNG DẪN, KHUNG, MÔN, BÀI và _meta (sheet ẩn). Không thêm sheet khác; không sửa dòng tiêu đề.</li>
        <li>KHUNG: đúng một dòng dữ liệu (tên khung 3–120 ký tự). MÔN: Mã môn, Tên môn, Thứ tự. BÀI: Mã môn, Mã bài (không bắt buộc), Tên bài, Thứ tự.</li>
        <li>Mã không được trùng trong cùng khung (chữ hoa/thường và dấu cách thừa vẫn tính là trùng). Định dạng cột mã là Văn bản để giữ số 0 ở đầu.</li>
        <li>Không dùng công thức, macro, liên kết ngoài, ngày hoặc ô logic. Tối đa 5000 mục và 5 MiB.</li></ul></details></section>`;
  }
  function renderFileCardHtml({ esc, disabled = false, reason = "", file = null, busy = false }) {
    const info = file ? `<div class="small mt-8" id="impFileInfo">Tệp đã chọn: <b style="overflow-wrap:anywhere">${esc(file.name)}</b> · ${esc(formatBytes(file.size))}${file.sha256 ? ` · SHA-256 <code>${esc(file.sha256.slice(0, 12))}…</code>` : ""}</div>` : "";
    return `<section class="card mt-14" id="impFileCard" aria-labelledby="impFileTitle">
      <h3 id="impFileTitle" style="margin:0">📥 Bước 2 · Chọn tệp Excel</h3>
      <p class="mut mt-8">Chỉ nhận tệp <b>.xlsx</b>, tối đa <b>5 MiB</b>. ${esc(MESSAGES.local)}</p>
      <div id="impDrop" class="mt-8" style="border:2px dashed var(--border);border-radius:12px;padding:18px;text-align:center${disabled ? ";opacity:.6" : ""}">
        <button class="btn" type="button" id="impPick" data-imp-action="pick"${disabled || busy ? " disabled" : ""}${disabled ? ' aria-describedby="impPickHint"' : ""}>CHỌN TỆP .XLSX</button>
        <div class="small mut mt-8">hoặc kéo thả tệp vào đây</div>
        <input type="file" id="impFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only" tabindex="-1" aria-label="Chọn tệp Excel .xlsx"${disabled || busy ? " disabled" : ""}>
      </div>
      ${disabled && reason ? `<div class="hint mt-8" id="impPickHint">${esc(reason)}</div>` : ""}${info}</section>`;
  }
  function renderUnsupportedHtml({ info, esc }) {
    return `<section class="card mt-14" id="impUnsupported" role="alert" style="border-color:#f59e0b" data-missing="${attr(esc, info.items.map((i) => i.id).join(","))}">
      <h3 style="margin:0">⚠️ ${esc(info.title)}</h3><p class="mt-8">${esc(info.lead)}</p>
      <ul style="margin:8px 0 0 18px">${info.items.map((i) => `<li data-capability="${attr(esc, i.id)}">${esc(i.label)}</li>`).join("")}</ul>
      <p class="mt-8"><b>${esc(info.advice)}</b></p></section>`;
  }
  function renderStatusHtml({ phase, esc, fileName = "", failure = "", retry = false }) {
    if (phase === "reading") return `<div class="card mt-14" id="impReading" aria-busy="true"><div class="flex gap-8" style="align-items:center"><span class="spinner" role="status" aria-label="Đang kiểm tra tệp"></span><div><b>Đang đọc và kiểm tra tệp…</b><div class="small mut">${esc(fileName)} — việc đọc chạy trong tiến trình nền, tối đa 20 giây.</div></div></div></div>`;
    if (phase === "failed") return `<div class="card mt-14" id="impFailed" role="alert" style="border-color:#ef4444" tabindex="-1"><b>⛔ ${esc(failure)}</b>${retry ? ` <button class="btn btn-outline" type="button" data-imp-action="retry-engine" style="margin-left:8px">THỬ LẠI</button>` : ""}</div>`;
    return "";
  }

  function renderDiagnosticItemHtml({ entry, esc, inspectRows = null, hasNode = false, active = false }) {
    const d = entry.diagnostic, view = severityView(d.severity);
    const fieldText = d.field ? ` · trường <code>${esc(d.field)}</code>` : "";
    const hint = d.hint ? `<div class="small mt-8" data-diag-hint="1">💡 <b>Gợi ý:</b> ${esc(d.hint)}</div>` : "";
    const rowBtn = d.sheet && d.row ? `<button class="btn btn-outline" type="button" data-imp-action="inspect" data-diag="${entry.index}" aria-expanded="${inspectRows ? "true" : "false"}">${inspectRows ? "ẨN DÒNG" : "XEM DÒNG " + d.row}</button>` : "";
    const treeBtn = hasNode ? `<button class="btn btn-outline" type="button" data-imp-action="goto-tree" data-diag="${entry.index}">XEM TRONG BẢN XEM TRƯỚC</button>` : "";
    let inspector = "";
    if (inspectRows) {
      inspector = inspectRows.length
        ? `<div class="mt-8" data-diag-rows="1" style="overflow-x:auto"><table style="border-collapse:collapse;min-width:360px"><caption class="small mut" style="text-align:left">Các ô của dòng ${d.row} trong sheet “${esc(d.sheet)}” (dữ liệu đọc từ tệp)</caption><thead><tr><th scope="col" class="small">Cột</th><th scope="col" class="small">Tiêu đề</th><th scope="col" class="small">Loại</th><th scope="col" class="small">Giá trị</th></tr></thead><tbody>${inspectRows.map((c) => `<tr><td class="small">${esc(c.column)}</td><td class="small">${esc(c.header)}</td><td class="small">${esc(c.type)}</td><td class="small" style="overflow-wrap:anywhere">${esc(c.value)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="small mut mt-8" data-diag-rows="1">Dòng này trống hoặc không đọc được trong tệp.</div>`;
    }
    return `<li id="impDiag${entry.index}" tabindex="-1" data-diag-item="${entry.index}" data-severity="${d.severity}" data-code="${attr(esc, d.code)}" style="border:1px solid ${d.severity === "error" ? "#fecaca" : "#fde68a"};border-radius:12px;padding:12px;margin-top:8px${active ? ";outline:2px solid var(--primary, #2563eb)" : ""}">
      <div class="flex gap-8" style="flex-wrap:wrap;align-items:center"><span class="badge ${view.badge}"><span aria-hidden="true">${view.icon}</span> ${esc(view.label)}</span><span class="small" data-diag-where="1">${esc(locationText(d))}${fieldText}</span></div>
      <div class="mt-8" style="overflow-wrap:anywhere" data-diag-message="1">${esc(messageBody(d))}</div>${hint}
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap;align-items:center"><span class="small mut">Mã: ${esc(d.code)}</span>${rowBtn}${treeBtn}</div>${inspector}</li>`;
  }
  function renderResultsHtml({ result, esc, filters, limit, inspect, activeIndex, hasNodeFor, rowsFor, file }) {
    const counts = countDiagnostics(result.diagnostics);
    const sheets = sheetOptions(result.diagnostics);
    const filtered = filterDiagnostics(result.diagnostics, filters);
    const shown = filtered.slice(0, limit);
    const ok = result.ok;
    const headline = ok ? (counts.warnings ? `Tệp hợp lệ, có ${counts.warnings} cảnh báo.` : "Tệp hợp lệ, không có lỗi hay cảnh báo.") : `Tệp có ${counts.errors} lỗi cần sửa trong Excel rồi chọn lại tệp.`;
    const controls = counts.total ? `<div class="flex gap-8 mt-8" style="flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label for="impFilterSeverity" class="small">Hiển thị</label><select id="impFilterSeverity" data-imp-filter="severity"><option value="all"${filters.severity === "all" ? " selected" : ""}>Tất cả (${counts.total})</option><option value="error"${filters.severity === "error" ? " selected" : ""}>Chỉ lỗi (${counts.errors})</option><option value="warning"${filters.severity === "warning" ? " selected" : ""}>Chỉ cảnh báo (${counts.warnings})</option></select></div>
        <div class="field" style="margin:0"><label for="impFilterSheet" class="small">Sheet</label><select id="impFilterSheet" data-imp-filter="sheet"><option value="all"${filters.sheet === "all" ? " selected" : ""}>Tất cả sheet</option>${sheets.map((s) => `<option value="${attr(esc, s.key)}"${filters.sheet === s.key ? " selected" : ""}>${esc(s.label)} (${s.count})</option>`).join("")}</select></div>
        <div class="flex gap-8"><button class="btn btn-outline" type="button" data-imp-action="prev-diag"${filtered.length ? "" : " disabled"}>◀ MỤC TRƯỚC</button><button class="btn btn-outline" type="button" data-imp-action="next-diag"${filtered.length ? "" : " disabled"}>MỤC SAU ▶</button></div></div>` : "";
    const list = shown.length
      ? `<ol id="impDiagList" aria-label="Danh sách lỗi và cảnh báo" style="list-style:none;padding:0;margin:0">${shown.map((entry) => renderDiagnosticItemHtml({ entry, esc, inspectRows: inspect === entry.index ? rowsFor(entry.diagnostic) : null, hasNode: hasNodeFor(entry.diagnostic), active: activeIndex === entry.index })).join("")}</ol>`
      : counts.total ? `<p class="mut mt-8" id="impDiagNone">Không có mục nào khớp bộ lọc.</p>` : "";
    const more = filtered.length > shown.length ? `<div class="mt-8"><span class="small mut" id="impDiagCount">Đang hiển thị ${shown.length}/${filtered.length} mục.</span> <button class="btn btn-outline" type="button" data-imp-action="more-diag">HIỂN THỊ THÊM ${Math.min(DIAGNOSTIC_PAGE, filtered.length - shown.length)}</button></div>` : (counts.total ? `<div class="small mut mt-8" id="impDiagCount">Hiển thị ${shown.length}/${filtered.length} mục.</div>` : "");
    return `<section class="card mt-14" id="impResults" aria-labelledby="impResultTitle">
      <h3 id="impResultTitle" tabindex="-1" style="margin:0;outline:none">${ok ? "✅" : "⛔"} Bước 3 · Kết quả kiểm tra</h3>
      <div class="small mt-8" id="impFileLine">Tệp <b style="overflow-wrap:anywhere">${esc(file.name)}</b> · ${esc(formatBytes(file.size))}${file.sha256 ? ` · SHA-256 <code>${esc(file.sha256.slice(0, 12))}…</code>` : ""}</div>
      <p class="mt-8" id="impVerdict" role="status" style="font-weight:650">${esc(headline)}</p>
      <div class="flex gap-8" style="flex-wrap:wrap"><span class="badge ${counts.errors ? "badge-red" : "badge-green"}" id="impErrorCount">⛔ Lỗi: ${counts.errors}</span><span class="badge ${counts.warnings ? "badge-yellow" : "badge-green"}" id="impWarningCount">⚠️ Cảnh báo: ${counts.warnings}</span></div>
      ${controls}${list}${more}</section>`;
  }

  function renderPreviewHtml({ organization, preview, model, esc, open, shown, warningCount, highlightKey = null, commit = false }) {
    const orderText = (node) => (node.orderSource === "explicit" ? "theo cột Thứ tự" : "theo vị trí dòng");
    const chips = (node) => noteChips(node.notes).map((c) => `<span class="chip" data-chip="1">${esc(c)}</span>`).join(" ");
    const groupHtml = preview.groups.map((g) => {
      const isOpen = open.has(g.subject.key);
      const limit = shown.get(g.subject.key) || LESSON_PAGE;
      const lessons = isOpen ? g.lessons.slice(0, limit) : [];
      const rows = lessons.map((l, i) => `<tr data-node-key="${attr(esc, l.key)}" data-kind="lesson"${highlightKey === l.key ? ' style="background:#fef9c3"' : ""} tabindex="-1"><td class="small">${i + 1}</td><td class="small">${esc(l.order)}</td><td class="small">${l.code ? `<code>${esc(l.code)}</code>` : '<span class="mut">—</span>'}</td><td class="small" style="overflow-wrap:anywhere">${esc(l.name)} ${chips(l)}</td><td class="small mut">dòng ${l.sourceRef.row}</td></tr>`).join("");
      const moreBtn = isOpen && g.lessons.length > lessons.length ? `<button class="btn btn-outline mt-8" type="button" data-imp-action="more-lessons" data-subject="${attr(esc, g.subject.key)}">HIỂN THỊ THÊM ${Math.min(LESSON_PAGE, g.lessons.length - lessons.length)} BÀI (còn ${g.lessons.length - lessons.length})</button>` : "";
      const body = isOpen ? (g.lessons.length ? `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th scope="col" class="small">STT</th><th scope="col" class="small">Thứ tự</th><th scope="col" class="small">Mã bài</th><th scope="col" class="small">Tên bài</th><th scope="col" class="small">Nguồn</th></tr></thead><tbody>${rows}</tbody></table></div>${moreBtn}` : `<p class="small mut">Môn này chưa có bài nào.</p>`) : "";
      return `<li data-subject-key="${attr(esc, g.subject.key)}" data-node-key="${attr(esc, g.subject.key)}" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:8px${highlightKey === g.subject.key ? ";background:#fef9c3" : ""}" tabindex="-1">
        <div class="flex-between" style="flex-wrap:wrap;gap:8px;align-items:flex-start"><div style="min-width:0;flex:1 1 260px"><div style="font-weight:650;overflow-wrap:anywhere">Môn ${g.position} · ${g.subject.code ? `<code>${esc(g.subject.code)}</code> · ` : ""}${esc(g.subject.name)} ${chips(g.subject)}</div><div class="small mut mt-8">Thứ tự ${esc(g.subject.order)} (${esc(orderText(g.subject))}) · ${g.lessons.length} bài · dòng ${g.subject.sourceRef.row}</div></div>
        <button class="btn btn-outline" type="button" data-imp-action="toggle-subject" data-subject="${attr(esc, g.subject.key)}" aria-expanded="${isOpen ? "true" : "false"}">${isOpen ? "THU GỌN" : "MỞ DANH SÁCH BÀI"}</button></div>${body}</li>`;
    }).join("");
    const frameworkName = model.framework.name;
    const orig = model.framework.original ? `<div class="small mut">Giá trị gốc trong tệp: “${esc(model.framework.original)}” (đã cắt khoảng trắng)</div>` : "";
    return `<section class="card mt-14" id="impPreview" aria-labelledby="impPreviewTitle">
      <h3 id="impPreviewTitle" tabindex="-1" style="margin:0;outline:none">👁 Bước 4 · Xem trước khung chương trình mới</h3>
      <p class="mut mt-8">Khung mới sẽ được tạo ở trạng thái <b>Bản nháp</b> trong đơn vị <b>${esc(organization.name || "—")}</b>. ${esc(commit ? MESSAGES.notWrittenYet : MESSAGES.notWritten)}</p>
      <div class="grid grid-3 mt-8" id="impPreviewSummary">
        <div><div class="small mut">Đơn vị</div><b data-prev="org">${esc(organization.name || "—")}</b><div class="small mut"><code>${esc(organization.code || "—")}</code> · <code>${esc(organization.id)}</code></div></div>
        <div><div class="small mut">Tên khung</div><b data-prev="framework" style="overflow-wrap:anywhere">${esc(frameworkName)}</b>${orig}<div class="small mut">Mã khung: không áp dụng (khung chương trình chỉ có tên; mã nghiệp vụ nằm ở từng môn và bài)</div></div>
        <div><div class="small mut">Quy mô</div><b data-prev="counts">${preview.subjectCount} môn · ${preview.lessonCount} bài · ${preview.total} mục</b><div class="small mut">${preview.withCode} mục có mã · ${preview.withoutCode} mục không mã · ${warningCount} cảnh báo</div></div></div>
      <div class="flex-between mt-14" style="flex-wrap:wrap;gap:8px"><h4 style="margin:0">Cây Môn → Bài</h4><div class="flex gap-8"><button class="btn btn-outline" type="button" data-imp-action="open-all">MỞ TẤT CẢ</button><button class="btn btn-outline" type="button" data-imp-action="close-all">THU GỌN TẤT CẢ</button></div></div>
      ${preview.collapseByDefault ? `<p class="small mut mt-8">Khung lớn (${preview.total} mục): các môn được thu gọn; mỗi lần mở hiển thị tối đa ${LESSON_PAGE} bài.</p>` : ""}
      <ol id="impTree" aria-label="Cây chương trình xem trước" style="list-style:none;padding:0;margin:0">${groupHtml}</ol></section>`;
  }
  function renderPlanHtml({ summary, planFailure = "", esc, commit = false }) {
    if (planFailure) return `<section class="card mt-14" id="impPlan" role="alert" style="border-color:#f59e0b"><h3 style="margin:0">📋 Bước 5 · Kế hoạch nhập (chỉ đọc)</h3><p class="mt-8">${esc(planFailure)}</p></section>`;
    const sizes = summary.chunkSizes;
    return `<section class="card mt-14" id="impPlan" aria-labelledby="impPlanTitle">
      <h3 id="impPlanTitle" style="margin:0">📋 Bước 5 · Kế hoạch nhập (chỉ đọc)</h3>
      <p class="mut mt-8">${commit ? "Đây là kế hoạch sẽ được thực hiện khi bạn xác nhận. " : "Đây là kế hoạch dự kiến khi nhập thật ở bản phát hành sau. "}${esc(commit ? MESSAGES.notWrittenYet : MESSAGES.notWritten)}</p>
      <div class="grid grid-3 mt-8"><div><div class="small mut">Tài liệu sẽ tạo</div><b data-plan="documents">${summary.totalDocuments}</b><div class="small mut">1 lô nhập + 1 khung + ${summary.nodeCount} mục (${summary.subjectCount} môn, ${summary.lessonCount} bài)</div></div>
        <div><div class="small mut">Đợt ghi dự kiến</div><b data-plan="chunks">${summary.chunkCount} đợt</b><div class="small mut">tối đa ${summary.maxChunkWrites} mục mỗi đợt${sizes.length > 1 ? "; đợt cuối " + sizes[sizes.length - 1] + " mục" : ""}</div></div>
        <div><div class="small mut">Trạng thái khung</div><b>Bản nháp</b><div class="small mut">chưa kích hoạt; kiểm tra lại từng mục sau khi ghi</div></div></div></section>`;
  }
  function renderFutureActionHtml({ esc }) {
    return `<section class="card mt-14" id="impFuture"><button class="btn btn-ok" type="button" id="impConfirmDisabled" disabled aria-disabled="true" aria-describedby="impConfirmHint">XÁC NHẬN NHẬP</button><div class="hint mt-8" id="impConfirmHint">${esc(MESSAGES.futureAction)}</div></section>`;
  }
  function renderShellHtml({ organization, esc, commit = false }) {
    return `<button class="btn btn-ghost" type="button" id="impBack" data-imp-action="back">← Quay lại đơn vị</button>
      <div class="section-title mt-14"><div><h2 id="impTitle" tabindex="-1" style="outline:none">⬆ Nhập chương trình từ Excel</h2><p class="mut">Tạo một khung chương trình <b>nháp mới</b> (Môn → Bài) từ tệp Excel theo mẫu. ${commit ? "Bạn kiểm tra và xem trước, rồi xác nhận để nhập; hệ thống đọc lại và kiểm tra toàn bộ dữ liệu trước khi báo thành công." : "Hiện tại chỉ kiểm tra và xem trước, chưa ghi dữ liệu."}</p></div></div>
      <div id="impOrgHost">${renderOrganizationHeaderHtml({ organization, esc })}</div>
      <div id="impLive" class="sr-only" role="status" aria-live="polite"></div>
      <div id="impRecoveryHost"></div><div id="impUnsupportedHost"></div><div id="impTemplateHost"></div><div id="impFileHost"></div><div id="impStatusHost"></div><div id="impResultsHost"></div><div id="impPreviewHost"></div><div id="impPlanHost"></div><div id="impFutureHost"></div><div id="impRunHost"></div>`;
  }
  function renderDeniedHtml({ esc, reason = "NOT_MEMBER" }) {
    const message = DENIED_REASONS[reason] || MESSAGES.denied;
    return `<div class="card"><div class="empty-state" id="impDenied" data-reason="${attr(esc, reason)}"><div class="ic">🔒</div><p>${esc(message)}</p></div></div>`;
  }
  function renderAccessStateHtml({ esc, failed = false }) {
    return failed
      ? `<div class="card"><div class="empty-state" id="impAccessFailed" role="alert"><div class="ic">⚠️</div><p>${esc(MESSAGES.accessCheckFailed)}</p><button class="btn btn-outline" type="button" id="impAccessRetry" data-imp-action="retry-access">THỬ LẠI</button></div></div>`
      : `<div class="card"><div class="empty-state" id="impAccessChecking" role="status" aria-busy="true"><div class="ic">⏳</div><p>${esc(MESSAGES.checkingAccess)}</p></div></div>`;
  }
  return freeze({
    MESSAGES, DENIED_REASONS, CAPABILITY_LABELS, describeUnsupported, formatBytes, severityView, noteChips, countDiagnostics, sheetOptions, filterDiagnostics, locationText, messageBody, rowCells, buildPreview, planSummary,
    renderShellHtml, renderOrganizationHeaderHtml, renderTemplateCardHtml, renderFileCardHtml, renderUnsupportedHtml, renderStatusHtml, renderResultsHtml, renderDiagnosticItemHtml, renderPreviewHtml, renderPlanHtml, renderFutureActionHtml, renderDeniedHtml, renderAccessStateHtml, FILE_LEVEL
  });
}

// ================================================================ 2. controller
// One Import Center per mount. The Organization is copied and frozen at mount: nothing in the flow can change it (a second mount() on the same host
// invalidates the first, so a stale async result can never paint into a different organization).
export function createImportCenter(deps) {
  const { actorUid, isPlatformAdmin, esc, toast, organizationQueries, db, loadEngine, downloadFile, makeReader } = deps;
  const commitTools = deps.commitTools && deps.commitTools.firestore ? deps.commitTools : null;   // P4-S4: execution is available only when the page injects it
  const accountActive = deps.accountActive !== false;   // the signed-in account is active (the application only lets active accounts in; the Rules re-check it on every read)
  const H = createImportViewHelpers();
  const warn = (label, error) => { try { console.warn("[import-center] " + label, error && error.name ? error.name : ""); } catch { /* ignore */ } };   // never the stack to the user

  async function mount(host, { organization, onBack } = {}) {
    if (!host) return;
    if (host.__importCenterTeardown) { try { host.__importCenterTeardown(); } catch { /* ignore */ } }
    if (!organization || typeof organization.id !== "string" || !organization.id) { host.innerHTML = H.renderDeniedHtml({ esc, reason: "NO_ORGANIZATION" }); return; }
    // ---- access: the approved P2/P3 contract (resolveImportAccess mirrors the Rules). Nothing else is loaded or read until it allows.
    let source = organization, access;
    if (isPlatformAdmin === true) access = resolveImportAccess({ isPlatformAdmin: true, accountActive, actorUid, organization });
    else {
      let pending = true;
      const again = (event) => { const retry = event.target.closest && event.target.closest("[data-imp-action='retry-access']"); if (retry && host.contains(retry)) { host.removeEventListener("click", again); delete host.__importCenterTeardown; void mount(host, { organization, onBack }); } };
      host.__importCenterTeardown = () => { pending = false; host.removeEventListener("click", again); delete host.__importCenterTeardown; };
      host.innerHTML = H.renderAccessStateHtml({ esc });
      let loaded = null;
      try { loaded = await loadImportAccess({ db, organizationQueries, actorUid, organizationId: organization.id }); }
      catch (error) { if (!pending) return; warn("access", error); host.innerHTML = H.renderAccessStateHtml({ esc, failed: true }); host.addEventListener("click", again); return; }
      if (!pending) return;
      host.removeEventListener("click", again); delete host.__importCenterTeardown;
      source = loaded.organization;
      access = loaded.organization ? resolveImportAccess({ accountActive, actorUid, organization: loaded.organization, membership: loaded.membership, capability: loaded.capability }) : { allowed: false, reason: "NOT_MEMBER" };   // an outsider cannot even read the organization
    }
    if (!access.allowed) { host.innerHTML = H.renderDeniedHtml({ esc, reason: access.reason }); return; }
    let org = Object.freeze({ id: organization.id, name: source.name || "", code: source.code || "", status: source.status });
    let alive = true, generation = 0, busy = false, engine = null, reader = null, templateWriter = null;
    const state = { unsupported: null, file: null, phase: "idle", failure: "", reading: null, result: null, summary: null, planFailure: "", filters: { severity: "all", sheet: "all" }, limit: DIAGNOSTIC_PAGE, inspect: null, active: null, cursor: -1,
      preview: null, open: new Set(), shown: new Map(), highlight: null, templateStatus: "",
      run: null, recovery: [], recoveryFailed: false, resume: null, resumeMismatch: false, ack: false, rollbackTarget: null, rollbackAck: false };
    const commitEnabled = () => !!commitTools;
    host.innerHTML = H.renderShellHtml({ organization: org, esc, commit: commitEnabled() });
    const $ = (selector) => host.querySelector(selector);
    const region = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
    const live = (message) => { const el = $("#impLive"); if (el) el.textContent = message; };
    const archived = () => org.status !== "active";

    // ---------------------------------------------------------- painting
    const paintTemplate = () => region("#impTemplateHost", H.renderTemplateCardHtml({ esc, busy, status: state.templateStatus, templateId: (engine && engine.TEMPLATE_ID) || "hcma2.curriculum.xlsx", schemaVersion: (engine && engine.TEMPLATE_SCHEMA_VERSION) || 1 }));
    const paintFile = () => {
      const disabled = archived() || !!state.unsupported || !engine;
      const reason = archived() ? H.MESSAGES.archived : state.unsupported ? "Trình duyệt chưa hỗ trợ đọc tệp an toàn (xem thông báo phía trên)." : !engine ? "Đang chuẩn bị bộ đọc tệp…" : "";
      region("#impFileHost", H.renderFileCardHtml({ esc, disabled, reason, file: state.file, busy }));
      bindFileInput();
    };
    const paintUnsupported = () => region("#impUnsupportedHost", state.unsupported ? H.renderUnsupportedHtml({ info: state.unsupported, esc }) : "");
    const paintStatus = () => region("#impStatusHost", H.renderStatusHtml({ phase: state.phase, esc, fileName: state.file ? state.file.name : "", failure: state.failure, retry: !engine }));
    const hasNodeFor = (d) => !!(state.result && state.result.model && d.sheet && d.row && state.result.model.nodes.some((n) => n.sourceRef.sheet === d.sheet && n.sourceRef.row === d.row));
    const rowsFor = (d) => (state.reading && state.reading.raw ? H.rowCells(state.reading.raw, d.sheet, d.row) || [] : []);
    function paintResults() {
      if (!state.result) { region("#impResultsHost", ""); return; }
      region("#impResultsHost", H.renderResultsHtml({ result: state.result, esc, filters: state.filters, limit: state.limit, inspect: state.inspect, activeIndex: state.active, hasNodeFor, rowsFor, file: state.file }));
    }
    function paintPreview() {
      const r = state.result;
      if (!r || !r.ok || !r.model || archived()) { region("#impPreviewHost", ""); region("#impPlanHost", ""); if (!commitEnabled()) region("#impFutureHost", ""); else paintConfirm(); return; }
      region("#impPreviewHost", H.renderPreviewHtml({ organization: org, preview: state.preview, model: r.model, esc, open: state.open, shown: state.shown, warningCount: r.warnings.length, highlightKey: state.highlight, commit: commitEnabled() }));
      region("#impPlanHost", state.summary || state.planFailure ? H.renderPlanHtml({ summary: state.summary, planFailure: state.planFailure, esc, commit: commitEnabled() }) : "");
      if (commitEnabled()) paintConfirm(); else region("#impFutureHost", H.renderFutureActionHtml({ esc }));
    }
    const paintAll = () => { paintUnsupported(); paintTemplate(); paintFile(); paintStatus(); paintResults(); paintPreview(); if (commitEnabled()) { paintRecovery(); paintRun(); } };

    // ---------------------------------------------------------- P4-S4: execution (confirm -> commit -> verify -> completed), recovery and rollback. Only with deps.commitTools.
    // The commit itself lives in the lazy engine (createImportCommitController); this view only drives it. The organization is the frozen `org`; the plan is the frozen plan built at the
    // moment of confirmation (the controller re-verifies its digest before the first write), so a later file or organization change cannot alter what is committed.
    let controller = null, runHelpers = null, releaseLock = null;
    const unloadGuard = (event) => { event.preventDefault(); event.returnValue = ""; return ""; };
    const setUnloadGuard = (on) => { if (typeof window === "undefined" || !window.addEventListener) return; try { if (on) window.addEventListener("beforeunload", unloadGuard); else window.removeEventListener("beforeunload", unloadGuard); } catch { /* ignore */ } };
    const running = () => !!(state.run && state.run.active);
    function getController() {
      if (!controller) controller = engine.createImportCommitController({ db, firestore: commitTools.firestore });
      return controller;
    }
    function getRunHelpers() { if (!runHelpers) runHelpers = engine.createImportRunHelpers({ esc }); return runHelpers; }
    // fresh authorization before every write phase (the controller calls it): the SAME contract as at mount, re-read from Firestore; leaving the screen also stops the run
    async function authorizeNow() {
      if (!alive) return { allowed: false, reason: "LEFT_SCREEN" };
      const loaded = await loadImportAccess({ db, organizationQueries, actorUid, organizationId: org.id, isPlatformAdmin: isPlatformAdmin === true });
      if (!loaded.organization || loaded.organization.id !== org.id) return { allowed: false, reason: "NOT_MEMBER" };
      const verdict = resolveImportAccess({ isPlatformAdmin: isPlatformAdmin === true, accountActive, actorUid, organization: loaded.organization, membership: loaded.membership, capability: loaded.capability });
      return verdict.canPrepare ? { allowed: true } : { allowed: false, reason: verdict.reason || "DENIED" };
    }
    async function takeLock() {
      if (!commitTools || typeof commitTools.acquireLock !== "function") return () => {};
      try { return await commitTools.acquireLock(org.id); } catch { return () => {}; }
    }
    const canAct = () => !archived() && commitEnabled();
    function paintRecovery() {
      if (!commitEnabled() || !engine) { region("#impRecoveryHost", ""); return; }
      const rh = getRunHelpers();
      let html = rh.renderRecoveryHtml({ batches: state.recovery, canAct: canAct() && !running(), archived: archived(), resumeId: state.resume ? state.resume.id : null });
      if (state.recoveryFailed) html = `<section class="card mt-14" id="impRecoveryFailed" role="alert"><p>${esc(rh.RUN_MESSAGES.recoveryLoadFailed)}</p></section>`;
      if (state.rollbackTarget) { const batch = state.recovery.find((b) => b.id === state.rollbackTarget) || (state.run && state.run.batch) || { id: state.rollbackTarget, sourceFile: {} }; html += rh.renderRollbackConfirmHtml({ batch, acknowledged: state.rollbackAck }); }
      region("#impRecoveryHost", html);
    }
    function paintRun() {
      if (!commitEnabled() || !engine) { region("#impRunHost", ""); return; }
      region("#impRunHost", getRunHelpers().renderRunHtml({ run: state.run, organization: org }));
    }
    function paintConfirm() {
      const r = state.result;
      const ready = commitEnabled() && engine && r && r.ok && r.model && !archived() && state.summary && !state.resumeMismatch && !(state.run && (state.run.done || state.run.rollbackDone));
      if (!ready) { region("#impFutureHost", commitEnabled() && state.resumeMismatch && engine ? `<section class="card mt-14" id="impResumeMismatch" role="alert" style="border-color:#dc2626"><p>${esc(getRunHelpers().RUN_MESSAGES.resumeMismatch)}</p></section>` : ""); return; }
      const rh = getRunHelpers();
      const blocked = !state.resume && state.recovery.length ? rh.RUN_MESSAGES.blockedIncomplete : "";
      region("#impFutureHost", rh.renderConfirmHtml({ organization: org, summary: state.summary, file: state.file, acknowledged: state.ack, blockedReason: blocked, resume: state.resume, canAct: !running() }));
    }
    async function loadRecovery() {
      if (!commitEnabled() || !engine) return;
      state.recoveryFailed = false;
      try { state.recovery = await getController().findIncomplete(org.id); }
      catch (error) { warn("recovery", error); state.recovery = []; state.recoveryFailed = true; }
      if (alive) { paintRecovery(); paintConfirm(); }
    }
    function progressInto(run, event) {
      run.phase = event.phase;
      if (event.nodesWritten !== undefined) run.nodesWritten = event.nodesWritten;
      if (event.nodesDeleted !== undefined) run.nodesDeleted = event.nodesDeleted;
      if (event.verified !== undefined) run.verified = event.verified;
      if (event.chunk !== undefined) run.chunk = event.chunk;
    }
    async function runCommit({ plan, resume }) {
      if (running() || !commitEnabled() || !engine) return;
      const release = await takeLock();
      if (release === null) { state.run = { stop: { tone: "warn", resume: false, rollback: false, text: getRunHelpers().RUN_MESSAGES.lockBusy }, kind: "commit", batchId: plan.batch.id }; paintRun(); return; }
      releaseLock = release;
      const run = { kind: "commit", active: true, batchId: plan.batch.id, plan, phase: "authorize", nodesTotal: plan.nodes.length, chunksTotal: plan.chunks.length, nodesWritten: 0, verified: 0, chunk: 0 };
      state.run = run; busy = true; setUnloadGuard(true); paintAll(); live("Bắt đầu nhập");
      let result;
      try {
        result = await getController().commit({ plan, organizationId: org.id, actorUid, authorize: authorizeNow, resume, onProgress: (event) => { if (!alive || state.run !== run) return; progressInto(run, event); paintRun(); } });
      } catch (error) { warn("commit", error); result = { ok: false, state: "error", nodesWritten: run.nodesWritten }; }
      finally { setUnloadGuard(false); if (releaseLock) { try { releaseLock(); } catch { /* ignore */ } releaseLock = null; } busy = false; }
      if (!alive) return;
      if (result.ok) {
        const nodes = plan.verification.expectedNodeCount;
        state.run = { done: { nodes, subjects: plan.verification.subjectCount, lessons: plan.verification.lessonCount, frameworkName: plan.framework.name, eligible: result.eligibility.eligible, eligibilityErrors: result.eligibility.errors }, kind: "commit", batchId: plan.batch.id };
        state.resume = null; state.ack = false; resetResult(); state.file = null; state.phase = "idle";
        live("Đã nhập xong và kiểm tra đầy đủ");
      } else {
        state.run = { stop: getRunHelpers().describeStop(result), kind: "commit", batchId: plan.batch.id, plan };
        live(state.run.stop.text);
      }
      await loadRecovery(); paintAll();
      const title = $("#impRunTitle"); if (title) title.focus();
    }
    async function runRollback(batchId) {
      if (running() || !commitEnabled() || !engine) return;
      const release = await takeLock();
      if (release === null) { state.run = { stop: { tone: "warn", resume: false, rollback: false, text: getRunHelpers().RUN_MESSAGES.lockBusy }, kind: "rollback", batchId }; paintRun(); return; }
      releaseLock = release;
      const run = { kind: "rollback", active: true, batchId, phase: "rollback-nodes", nodesDeleted: 0 };
      state.run = run; state.rollbackTarget = null; state.rollbackAck = false; busy = true; setUnloadGuard(true); paintAll(); live("Bắt đầu hoàn tác");
      let result;
      try { result = await getController().rollback({ batchId, organizationId: org.id, authorize: authorizeNow, onProgress: (event) => { if (!alive || state.run !== run) return; progressInto(run, event); paintRun(); } }); }
      catch (error) { warn("rollback", error); result = { ok: false, state: "error" }; }
      finally { setUnloadGuard(false); if (releaseLock) { try { releaseLock(); } catch { /* ignore */ } releaseLock = null; } busy = false; }
      if (!alive) return;
      if (result.ok) { state.run = { rollbackDone: { nodesDeleted: result.nodesDeleted || 0 }, kind: "rollback", batchId }; if (state.resume && state.resume.id === batchId) state.resume = null; live("Đã hoàn tác lần nhập"); }
      else { state.run = { stop: { ...getRunHelpers().describeStop(result), resume: false }, kind: "rollback", batchId }; live(state.run.stop.text); }
      await loadRecovery(); paintAll();
      const title = $("#impRunTitle"); if (title) title.focus();
    }
    // New import: a fresh Firestore auto id for BOTH documents, the plan rebuilt with it (validation stage 10) and frozen. Resume: the plan rebuilt with the stored batch id.
    async function confirmAndRun() {
      if (running() || !engine || !state.result || !state.result.ok || !state.ack) return;
      const verdict = await authorizeNow().catch(() => ({ allowed: false, reason: "ACCESS_CHECK_FAILED" }));
      if (!verdict.allowed) { state.run = { stop: getRunHelpers().describeStop({ state: "denied" }), kind: "commit", batchId: "" }; paintAll(); return; }
      const batchId = state.resume ? state.resume.id : getController().newBatchId();
      const prepared = engine.prepareCommit(state.result.model, { organization: { id: org.id, status: "active" }, batchId, actorUid });
      if (!prepared.ok) { state.run = { stop: { tone: "err", resume: false, rollback: false, text: "Không lập được kế hoạch nhập: " + (prepared.diagnostics[0] ? prepared.diagnostics[0].message : "dữ liệu không hợp lệ") }, kind: "commit", batchId }; paintAll(); return; }
      if (state.resume && !engine.batchMatchesPlan(state.resume, prepared.plan, org.id)) { state.resumeMismatch = true; paintAll(); return; }
      await runCommit({ plan: prepared.plan, resume: !!state.resume });
    }

    // ---------------------------------------------------------- engine + capability check (lazy)
    async function ensureEngine() {
      if (engine) return engine;
      try { engine = await loadEngine(); } catch (error) { warn("engine", error); engine = null; throw new Error("engine"); }
      templateWriter = engine.createTemplateWriter();
      reader = typeof makeReader === "function" ? makeReader(engine) : engine.createXlsxReader();
      return engine;
    }
    async function start() {
      paintAll();
      const mine = generation;
      try { await ensureEngine(); } catch { if (alive && mine === generation) { state.phase = "failed"; state.failure = H.MESSAGES.engineFailed; paintStatus(); live(H.MESSAGES.engineFailed); } return; }
      if (!alive || mine !== generation) return;
      const caps = engine.detectReaderCapabilities();
      if (!caps.supported) state.unsupported = H.describeUnsupported(caps.missing);
      paintAll();
      // one fresh read of the Organization (read-only; the identity never changes, only its status can)
      if (organizationQueries && db) {
        try {
          const fresh = await organizationQueries.organizationById(db, org.id);
          if (alive && mine === generation && fresh && fresh.id === org.id) { org = Object.freeze({ id: org.id, name: fresh.name || org.name, code: fresh.code || org.code, status: fresh.status }); region("#impOrgHost", H.renderOrganizationHeaderHtml({ organization: org, esc })); paintAll(); }
        } catch (error) { warn("organization", error); }
      }
      if (commitEnabled() && alive && mine === generation) await loadRecovery();
      const title = $("#impTitle"); if (title && alive) title.focus();
    }

    // ---------------------------------------------------------- template download (local; nothing is uploaded)
    async function downloadTemplate(withExample) {
      if (busy) return;
      busy = true; paintTemplate();
      try {
        await ensureEngine();
        const built = await templateWriter.build({ withExample });
        downloadFile(built.bytes, built.fileName, built.mime);
        state.templateStatus = H.MESSAGES.templateDone + " (" + built.fileName + ")";
        toast(H.MESSAGES.templateDone, "ok");
      } catch (error) { warn("template", error); state.templateStatus = H.MESSAGES.templateFailed; toast(H.MESSAGES.templateFailed, "err"); }
      finally { busy = false; if (alive) { paintTemplate(); live(state.templateStatus); } }
    }

    // ---------------------------------------------------------- file -> parse -> validate -> preview
    function resetResult() {
      state.reading = null; state.result = null; state.summary = null; state.planFailure = ""; state.preview = null; state.filters = { severity: "all", sheet: "all" }; state.limit = DIAGNOSTIC_PAGE;
      state.inspect = null; state.active = null; state.cursor = -1; state.open = new Set(); state.shown = new Map(); state.highlight = null; state.failure = "";
    }
    async function handleFile(file) {
      if (!file || busy || running() || archived() || state.unsupported || !engine) return;
      const mine = ++generation;
      busy = true; resetResult(); state.resumeMismatch = false; state.ack = false; if (state.run && (state.run.done || state.run.rollbackDone)) state.run = null; state.phase = "reading"; state.file = { name: file.name, size: file.size, sha256: null };
      paintTemplate(); paintFile(); paintStatus(); paintResults(); paintPreview(); live("Đang đọc và kiểm tra tệp");
      try {
        const reading = await reader.readXlsx(file, { fileName: file.name });
        if (!alive || mine !== generation) return;
        state.file = { name: file.name, size: file.size, sha256: reading.file && reading.file.sha256 ? reading.file.sha256 : null };
        const result = engine.validateImport(reading);
        state.reading = reading; state.result = result; state.phase = "result";
        if (result.unsupportedBrowser) { const found = result.diagnostics.find((d) => d.code === "BROWSER_UNSUPPORTED"); state.unsupported = H.describeUnsupported(result.missingCapabilities, found && found.data ? found.data.minimum : null); }
        if (result.ok && result.model) {
          state.preview = H.buildPreview(result.model);
          if (!state.preview.collapseByDefault) state.preview.groups.forEach((g) => state.open.add(g.subject.key));
          // the plan is built ONLY to run validation stage 10 and to show numbers; it is never executable here and is dropped immediately (synthetic preview id)
          const previewId = state.resume ? state.resume.id : "preview" + String(state.file.sha256 || "0000000000000").slice(0, 14);
          const prepared = engine.prepareCommit(result.model, { organization: { id: org.id, status: org.status }, batchId: previewId, actorUid });
          if (state.resume && prepared.ok && !engine.batchMatchesPlan(state.resume, prepared.plan, org.id)) { state.resumeMismatch = true; state.summary = null; state.planFailure = ""; }
          if (prepared.ok && !state.resumeMismatch) state.summary = H.planSummary(prepared.plan); else if (!prepared.ok) state.planFailure = "Không lập được kế hoạch nhập: " + (prepared.diagnostics[0] ? prepared.diagnostics[0].message : "dữ liệu không hợp lệ") ;
        }
      } catch (error) {
        warn("read", error);
        if (!alive || mine !== generation) return;
        state.phase = "failed"; state.failure = H.MESSAGES.readFailed; state.result = null;
      } finally {
        if (alive && mine === generation) { busy = false; }
      }
      if (!alive || mine !== generation) return;
      paintAll();
      const counts = state.result ? H.countDiagnostics(state.result.diagnostics) : null;
      live(state.result ? (state.result.ok ? "Kiểm tra xong: tệp hợp lệ" : "Kiểm tra xong: " + counts.errors + " lỗi") : state.failure);
      const target = state.result ? $("#impResultTitle") : $("#impFailed");
      if (target) target.focus();
    }
    function bindFileInput() {
      const input = $("#impFile"), pick = $("#impPick"), drop = $("#impDrop");
      if (pick) pick.onclick = () => { if (input && !input.disabled) input.click(); };
      if (input) input.onchange = () => { const file = input.files && input.files[0]; input.value = ""; if (file) handleFile(file); };
      if (drop) {
        drop.ondragover = (event) => { event.preventDefault(); };
        drop.ondrop = (event) => { event.preventDefault(); const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]; if (file) handleFile(file); };
      }
    }

    // ---------------------------------------------------------- results interactions
    function visibleEntries() { return state.result ? H.filterDiagnostics(state.result.diagnostics, state.filters).slice(0, state.limit) : []; }
    function focusDiag(index) {
      state.active = index; paintResults();
      const el = $("#impDiag" + index); if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: "center" }); }
    }
    function moveCursor(step) {
      const entries = visibleEntries(); if (!entries.length) return;
      const at = entries.findIndex((e) => e.index === state.active);
      const next = at < 0 ? (step > 0 ? 0 : entries.length - 1) : (at + step + entries.length) % entries.length;
      focusDiag(entries[next].index);
    }
    function gotoTree(d) {
      const node = state.result && state.result.model && state.result.model.nodes.find((n) => n.sourceRef.sheet === d.sheet && n.sourceRef.row === d.row);
      if (!node) return;
      const subjectKey = node.kind === "subject" ? node.key : node.parentKey;
      state.open.add(subjectKey);
      if (node.kind === "lesson") { const group = state.preview.groups.find((g) => g.subject.key === subjectKey); const pos = group ? group.lessons.findIndex((l) => l.key === node.key) : -1; if (pos >= (state.shown.get(subjectKey) || LESSON_PAGE)) state.shown.set(subjectKey, pos + 1); }
      state.highlight = node.key; paintPreview();
      const el = $(`[data-node-key="${node.key}"]`); if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: "center" }); }
    }

    // ---------------------------------------------------------- events (delegated; removed on teardown)
    const onClick = (event) => {
      const button = event.target.closest && event.target.closest("[data-imp-action]");
      if (!button || !host.contains(button) || button.disabled) return;
      const action = button.dataset.impAction;
      if (action === "back") { if (running()) { live(getRunHelpers().RUN_MESSAGES.backBlocked); return; } if (typeof onBack === "function") onBack(); return; }
      if (action === "confirm") return void confirmAndRun();
      if (action === "run-resume") { const run = state.run; if (run && run.plan) { state.run = null; return void runCommit({ plan: run.plan, resume: false }); } return; }
      if (action === "run-dismiss") { state.run = null; paintAll(); return; }
      if (action === "run-finish") { state.run = null; if (typeof onBack === "function") onBack(); return; }
      if (action === "resume-pick") { const batch = state.recovery.find((b) => b.id === button.dataset.batch); if (batch && batch.status === "committing") { state.resume = batch; state.resumeMismatch = false; state.ack = false; state.run = null; resetResult(); state.file = null; state.phase = "idle"; paintAll(); live(getRunHelpers().RUN_MESSAGES.resumeHint); const pick = $("#impPick"); if (pick) pick.focus(); } return; }
      if (action === "rollback-open") { state.rollbackTarget = button.dataset.batch; state.rollbackAck = false; if (state.run && state.run.stop) state.run = { ...state.run, batch: state.recovery.find((b) => b.id === state.rollbackTarget) }; paintRecovery(); const box = $("#impRbTitle"); if (box) box.focus(); return; }
      if (action === "rollback-cancel") { state.rollbackTarget = null; state.rollbackAck = false; paintRecovery(); return; }
      if (action === "rollback-confirm") { if (state.rollbackAck) void runRollback(button.dataset.batch); return; }
      if (action === "retry-engine") { state.phase = "idle"; state.failure = ""; paintStatus(); return void start(); }
      if (action === "template-blank") return void downloadTemplate(false);
      if (action === "template-example") return void downloadTemplate(true);
      if (action === "more-diag") { state.limit += DIAGNOSTIC_PAGE; paintResults(); return; }
      if (action === "prev-diag") return moveCursor(-1);
      if (action === "next-diag") return moveCursor(1);
      if (action === "inspect") { const index = Number(button.dataset.diag); state.inspect = state.inspect === index ? null : index; state.active = index; paintResults(); const el = $("#impDiag" + index + " [data-imp-action='inspect']"); if (el) el.focus(); return; }
      if (action === "goto-tree") { const d = state.result.diagnostics[Number(button.dataset.diag)]; if (d) gotoTree(d); return; }
      if (action === "toggle-subject") { const key = button.dataset.subject; if (state.open.has(key)) state.open.delete(key); else state.open.add(key); paintPreview(); const again = $(`[data-imp-action="toggle-subject"][data-subject="${key}"]`); if (again) again.focus(); return; }
      if (action === "more-lessons") { const key = button.dataset.subject; state.shown.set(key, (state.shown.get(key) || LESSON_PAGE) + LESSON_PAGE); paintPreview(); const again = $(`[data-imp-action="more-lessons"][data-subject="${key}"]`) || $(`[data-imp-action="toggle-subject"][data-subject="${key}"]`); if (again) again.focus(); return; }
      if (action === "open-all") { state.preview.groups.forEach((g) => state.open.add(g.subject.key)); paintPreview(); return; }
      if (action === "close-all") { state.open.clear(); paintPreview(); return; }
    };
    const onChange = (event) => {
      const ack = event.target.closest && event.target.closest("[data-imp-ack]");
      if (ack) { state.ack = !!ack.checked; paintConfirm(); const again = $("#impConfirmAck"); if (again) again.focus(); return; }
      const rb = event.target.closest && event.target.closest("[data-imp-rback]");
      if (rb) { state.rollbackAck = !!rb.checked; paintRecovery(); const again = $("#impRbAck"); if (again) again.focus(); return; }
      const select = event.target.closest && event.target.closest("[data-imp-filter]");
      if (!select) return;
      state.filters = { ...state.filters, [select.dataset.impFilter]: select.value }; state.limit = DIAGNOSTIC_PAGE; state.active = null; state.inspect = null; paintResults();
      const again = $(`[data-imp-filter="${select.dataset.impFilter}"]`); if (again) again.focus();
    };
    host.addEventListener("click", onClick);
    host.addEventListener("change", onChange);
    host.__importCenterTeardown = () => { alive = false; generation++; setUnloadGuard(false); if (releaseLock) { try { releaseLock(); } catch { /* ignore */ } releaseLock = null; } host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); delete host.__importCenterTeardown; };
    await start();
  }
  return freeze({ mount, helpers: H });
}
