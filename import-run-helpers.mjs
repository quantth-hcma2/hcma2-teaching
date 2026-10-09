// Library V2 P4-S4 - Import Center EXECUTION UI helpers (pure: markup + Vietnamese messages, no DOM access, no I/O, no imports). Used by import-center-view.mjs through the lazy engine.
// Everything here only formats data it is given; the commit itself is import-commit-controller.mjs. No success state is ever rendered before the controller reports a
// COMPLETED batch confirmed by a server read-back.
const freeze = Object.freeze;

export const RUN_PHASE_LABELS = freeze({
  authorize: "Đang kiểm tra quyền",
  batch: "Đang tạo bản ghi lần nhập",
  framework: "Đang tạo khung chương trình nháp",
  scan: "Đang kiểm tra dữ liệu đã có để tiếp tục an toàn",
  nodes: "Đang ghi môn và bài",
  verify: "Đang đọc lại và kiểm tra toàn bộ dữ liệu",
  complete: "Đang hoàn tất lần nhập",
  done: "Hoàn tất",
  "rollback-nodes": "Đang xóa các mục đã ghi",
  "rollback-framework": "Đang xóa khung nháp",
  "rollback-batch": "Đang đánh dấu lần nhập đã hoàn tác"
});
const STATUS_LABELS = freeze({ committing: "Đang nhập dở", partial: "Đã dừng (một phần)", completed: "Hoàn tất", rolled_back: "Đã hoàn tác" });
export const RUN_MESSAGES = freeze({
  keepOpen: "Sau khi bấm, hãy giữ nguyên trang này cho đến khi hoàn tất. Nếu bị gián đoạn, bạn có thể tiếp tục hoặc hoàn tác khi quay lại màn hình này.",
  backBlocked: "Đang nhập dữ liệu: chưa thể rời màn hình này. Hãy đợi hoàn tất hoặc hoàn tác khi có thông báo dừng.",
  lockBusy: "Một lần nhập khác của đơn vị này đang chạy ở thẻ trình duyệt khác. Hãy đợi lần đó kết thúc.",
  blockedIncomplete: "Đơn vị đang có một lần nhập chưa hoàn tất. Hãy TIẾP TỤC hoặc HOÀN TÁC lần nhập đó trước khi nhập tệp mới.",
  resumeMismatch: "Tệp vừa chọn KHÔNG khớp với lần nhập đang dở (tên khung, số mục hoặc mã SHA-256 khác). Hãy chọn đúng tệp đã dùng cho lần nhập đó, hoặc HOÀN TÁC lần nhập.",
  resumeHint: "Đang tiếp tục một lần nhập dở. Hãy chọn LẠI đúng tệp Excel đã dùng cho lần nhập đó; hệ thống chỉ ghi các mục còn thiếu rồi đọc lại và kiểm tra toàn bộ.",
  archivedActions: "Đơn vị đã lưu trữ: không thể tiếp tục hoặc hoàn tác. Hãy khôi phục đơn vị trước.",
  recoveryLoadFailed: "Không kiểm tra được các lần nhập đang dở. Hãy tải lại màn hình này.",
  rollbackWarn: "Hoàn tác sẽ xóa các mục đã ghi và khung nháp của lần nhập này; bản ghi lần nhập được giữ lại với trạng thái “Đã hoàn tác”. Dữ liệu khác của đơn vị không bị ảnh hưởng.",
  notActivated: "Khung nháp chưa được kích hoạt. Việc kích hoạt là một bước riêng trong màn hình Chương trình (MỞ → KÍCH HOẠT)."
});

const attr = (esc, v) => esc(String(v == null ? "" : v));
const num = (n) => (Number.isFinite(n) ? n : 0);
export const formatWhen = (value) => {
  const ms = value && typeof value.toMillis === "function" ? value.toMillis() : value instanceof Date ? value.getTime() : null;
  if (ms === null) return "—";
  const d = new Date(ms); const p = (n) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + " " + p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
};

// stop result of the controller -> what the user is told and which controls are offered (no raw error text, ever)
export function describeStop(result) {
  const written = num(result && result.nodesWritten);
  const kind = result && result.kind;
  switch (result && result.state) {
    case "paused": return { tone: "warn", resume: true, rollback: true, text: "Kết nối bị gián đoạn. Dữ liệu đã ghi được giữ nguyên (" + written + " mục). Hãy kiểm tra mạng rồi bấm TIẾP TỤC, hoặc HOÀN TÁC NHẬP." };
    case "incomplete": return { tone: "warn", resume: true, rollback: true, text: "Khi đọc lại phát hiện còn thiếu " + num(result.verification && result.verification.counts.missing) + " mục. Chưa hoàn tất. Bấm TIẾP TỤC để ghi bù các mục còn thiếu, hoặc HOÀN TÁC NHẬP." };
    case "verification-failed": { const c = (result.verification && result.verification.counts) || {}; return { tone: "err", resume: false, rollback: true, text: "Kết quả đọc lại KHÔNG khớp kế hoạch (thiếu " + num(c.missing) + ", thừa " + num(c.extra) + ", sai khác " + num(c.altered) + "). Lần nhập được đánh dấu “dừng (một phần)”, không thể hoàn tất và không thể kích hoạt. Hãy HOÀN TÁC NHẬP." }; }
    case "denied": return { tone: "err", resume: false, rollback: false, text: "Bạn không còn quyền thực hiện thao tác này, hoặc đơn vị đã bị lưu trữ. Không có thêm dữ liệu nào được ghi. Dữ liệu đã ghi (nếu có) được giữ nguyên; hãy liên hệ quản trị viên hệ thống." };
    case "blocked": return { tone: "warn", resume: false, rollback: false, text: RUN_MESSAGES.blockedIncomplete };
    case "identity-mismatch": return { tone: "err", resume: false, rollback: true, text: RUN_MESSAGES.resumeMismatch };
    case "not-committing": return { tone: "err", resume: false, rollback: true, text: "Lần nhập này đã ở trạng thái “" + (STATUS_LABELS[result.status] || "khác") + "” nên không thể tiếp tục. " + (result.status === "partial" ? "Chỉ có thể HOÀN TÁC NHẬP." : "") };
    case "unconfirmed": return { tone: "warn", resume: true, rollback: true, text: "Chưa xác nhận được trạng thái cuối cùng từ máy chủ. Bấm TIẾP TỤC để kiểm tra lại; hệ thống sẽ không báo thành công khi chưa đọc lại được." };
    case "nodes-remain": case "framework-remains": return { tone: "warn", resume: false, rollback: true, text: "Hoàn tác chưa xóa hết dữ liệu. Bấm HOÀN TÁC NHẬP để thử lại." };
    case "framework-not-deletable": return { tone: "err", resume: false, rollback: false, text: "Khung của lần nhập này không còn là bản nháp chưa kích hoạt nên không thể hoàn tác tự động." };
    case "not-rollbackable": return { tone: "err", resume: false, rollback: false, text: "Lần nhập này đã hoàn tất nên không thể hoàn tác tại đây. Nếu cần bỏ khung, hãy dùng XÓA BẢN NHÁP trong màn hình Chương trình." };
    case "organization-mismatch": return { tone: "err", resume: false, rollback: false, text: "Lần nhập này không thuộc đơn vị đang mở. Không có dữ liệu nào bị thay đổi." };
    default: return { tone: kind === "transient" ? "warn" : "err", resume: true, rollback: true, text: "Không thể hoàn tất do lỗi không xác định. Dữ liệu đã ghi được giữ nguyên. Bạn có thể TIẾP TỤC hoặc HOÀN TÁC NHẬP." };
  }
}

export function createImportRunHelpers({ esc }) {
  const a = (v) => attr(esc, v);

  function renderConfirmHtml({ organization, summary, file, acknowledged = false, blockedReason = "", resume = null, canAct = true }) {
    const disabled = !acknowledged || !!blockedReason || !canAct;
    const title = resume ? "Bước 6 · Xác nhận TIẾP TỤC lần nhập dở" : "Bước 6 · Xác nhận nhập";
    const lead = resume
      ? `Hệ thống sẽ <b>tiếp tục</b> lần nhập dở trong đơn vị <b>${esc(organization.name || "—")}</b>: chỉ ghi các mục còn thiếu, sau đó đọc lại và kiểm tra toàn bộ ${summary.nodeCount} mục.`
      : `Bạn sắp tạo <b>một khung chương trình nháp mới</b> trong đơn vị <b>${esc(organization.name || "—")}</b>.`;
    return `<section class="card mt-14" id="impConfirm" aria-labelledby="impConfirmTitle">
      <h3 id="impConfirmTitle" tabindex="-1" style="margin:0;outline:none">✅ ${esc(title)}</h3>
      <p class="mt-8">${lead}</p>
      <dl class="mt-8" id="impConfirmSummary" style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0">
        <dt class="small mut">Đơn vị</dt><dd style="margin:0" data-confirm="org"><b>${esc(organization.name || "—")}</b> · <code>${esc(organization.code || "—")}</code></dd>
        <dt class="small mut">Tệp</dt><dd style="margin:0;overflow-wrap:anywhere">${esc(file.name)}</dd>
        <dt class="small mut">Quy mô</dt><dd style="margin:0" data-confirm="counts"><b>${summary.subjectCount} môn · ${summary.lessonCount} bài · ${summary.nodeCount} mục</b></dd>
        <dt class="small mut">Sẽ tạo</dt><dd style="margin:0" data-confirm="documents">${summary.totalDocuments} tài liệu (1 lô nhập + 1 khung + ${summary.nodeCount} mục) trong ${summary.chunkCount} đợt ghi</dd>
        <dt class="small mut">Trạng thái khung</dt><dd style="margin:0">Bản nháp, chưa kích hoạt</dd>
      </dl>
      <label class="mt-14" style="display:flex;gap:10px;align-items:center;min-height:44px;cursor:pointer"><input type="checkbox" id="impConfirmAck" data-imp-ack="1"${acknowledged ? " checked" : ""}${canAct ? "" : " disabled"} style="margin-top:4px;min-width:22px;min-height:22px"><span>Tôi xác nhận ${resume ? "tiếp tục nhập" : "nhập"} <b>${summary.nodeCount} mục</b> (${summary.subjectCount} môn, ${summary.lessonCount} bài) vào đơn vị <b>“${esc(organization.name || "—")}”</b> (<code>${esc(organization.code || "—")}</code>). Khung được tạo ở trạng thái Bản nháp.</span></label>
      <div class="mt-14"><button class="btn btn-ok" type="button" id="impConfirmBtn" data-imp-action="confirm"${disabled ? ' disabled aria-disabled="true"' : ""} aria-describedby="impConfirmHint">${resume ? "TIẾP TỤC NHẬP" : "XÁC NHẬN NHẬP"}</button></div>
      <div class="hint mt-8" id="impConfirmHint">${blockedReason ? esc(blockedReason) : esc(RUN_MESSAGES.keepOpen)}</div></section>`;
  }

  // run: { kind: "commit"|"rollback", phase, nodesWritten, nodesTotal, chunk, chunksTotal, verified, nodesDeleted, stop?: describeStop(...), done?: {...}, rollbackDone?: {...} }
  function renderRunHtml({ run, organization }) {
    if (!run) return "";
    if (run.done) {
      const d = run.done;
      return `<section class="card mt-14" id="impRun" role="status" aria-labelledby="impRunTitle" style="border-color:#16a34a">
        <h3 id="impRunTitle" tabindex="-1" style="margin:0;outline:none">✅ Đã nhập xong và kiểm tra đầy đủ</h3>
        <p class="mt-8" data-run="result">Đã đọc lại <b>${d.nodes} mục</b> (${d.subjects} môn, ${d.lessons} bài) từ máy chủ và đối chiếu từng mục với kế hoạch: <b>khớp 100%</b> (không thiếu, không thừa, đúng quan hệ cha–con, thứ tự và mã).</p>
        <p class="mt-8" data-run="eligibility">${d.eligible ? "Khung nháp <b>" + esc(d.frameworkName) + "</b> đã sẵn sàng để kích hoạt theo quy trình hiện có." : "Khung nháp chưa đủ điều kiện kích hoạt (" + esc(d.eligibilityErrors.join(", ") || "không rõ") + ")."} ${esc(RUN_MESSAGES.notActivated)}</p>
        <div class="mt-8"><button class="btn btn-ok" type="button" id="impRunBack" data-imp-action="run-finish">VỀ DANH SÁCH CHƯƠNG TRÌNH</button></div></section>`;
    }
    if (run.rollbackDone) {
      return `<section class="card mt-14" id="impRun" role="status" aria-labelledby="impRunTitle"><h3 id="impRunTitle" tabindex="-1" style="margin:0;outline:none">↩ Đã hoàn tác lần nhập</h3>
        <p class="mt-8" data-run="result">Đã xóa ${run.rollbackDone.nodesDeleted} mục và khung nháp. Bản ghi lần nhập được giữ lại với trạng thái “Đã hoàn tác”. Dữ liệu khác của đơn vị không bị ảnh hưởng.</p>
        <div class="mt-8"><button class="btn btn-outline" type="button" data-imp-action="run-dismiss">ĐÓNG</button></div></section>`;
    }
    if (run.stop) {
      const s = run.stop;
      return `<section class="card mt-14" id="impRun" role="alert" aria-labelledby="impRunTitle" style="border-color:${s.tone === "err" ? "#dc2626" : "#f59e0b"}">
        <h3 id="impRunTitle" tabindex="-1" style="margin:0;outline:none">${s.tone === "err" ? "⛔" : "⚠️"} ${run.kind === "rollback" ? "Hoàn tác chưa xong" : "Lần nhập chưa hoàn tất"}</h3>
        <p class="mt-8" data-run="stop">${esc(s.text)}</p>
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap">${s.resume ? `<button class="btn btn-ok" type="button" id="impRunResume" data-imp-action="run-resume">TIẾP TỤC</button>` : ""}${s.rollback ? `<button class="btn btn-outline" type="button" id="impRunRollback" data-imp-action="rollback-open" data-batch="${a(run.batchId)}">HOÀN TÁC NHẬP</button>` : ""}<button class="btn btn-ghost" type="button" data-imp-action="run-dismiss">ĐÓNG</button></div></section>`;
    }
    const total = num(run.nodesTotal);
    const label = RUN_PHASE_LABELS[run.phase] || "Đang xử lý";
    let detail = "", value = 0, max = 1;
    if (run.kind === "rollback") { detail = run.nodesDeleted ? "Đã xóa " + run.nodesDeleted + " mục" : ""; max = 0; }
    else if (run.phase === "nodes") { detail = num(run.nodesWritten) + "/" + total + " mục" + (run.chunksTotal ? " · đợt " + num(run.chunk) + "/" + run.chunksTotal : ""); value = num(run.nodesWritten); max = Math.max(1, total); }
    else if (run.phase === "verify") { detail = "đã đối chiếu " + num(run.verified) + "/" + total + " mục"; value = num(run.verified); max = Math.max(1, total); }
    else if (run.phase === "complete" || run.phase === "done") { value = 1; max = 1; }
    const bar = max > 0 ? `<progress id="impRunBar" value="${value}" max="${max}" style="width:100%;height:18px" aria-label="Tiến độ">${value}/${max}</progress>` : `<progress id="impRunBar" style="width:100%;height:18px" aria-label="Tiến độ"></progress>`;
    return `<section class="card mt-14" id="impRun" aria-busy="true" aria-labelledby="impRunTitle">
      <h3 id="impRunTitle" tabindex="-1" style="margin:0;outline:none">⏳ ${run.kind === "rollback" ? "Đang hoàn tác lần nhập" : "Đang nhập chương trình"}</h3>
      <p class="mt-8" id="impRunPhase" data-phase="${a(run.phase)}"><b>${esc(label)}</b>${detail ? " · " + esc(detail) : ""}</p>${bar}
      <p class="small mut mt-8">Đừng đóng hoặc tải lại trang cho đến khi hoàn tất. Nếu bị gián đoạn, dữ liệu đã ghi được giữ nguyên và bạn có thể tiếp tục hoặc hoàn tác.</p></section>`;
  }

  // batches: incomplete batches of THIS organization (committing | partial). canAct: org active + authorized.
  function renderRecoveryHtml({ batches, canAct, archived = false, resumeId = null }) {
    if (!batches || !batches.length) return "";
    const items = batches.map((b) => {
      const resumable = b.status === "committing";
      const picked = resumeId === b.id;
      return `<li data-batch="${a(b.id)}" data-status="${a(b.status)}" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:8px">
        <div style="font-weight:650;overflow-wrap:anywhere">${esc((b.sourceFile && b.sourceFile.name) || "Tệp không rõ")}</div>
        <div class="small mut">${esc(STATUS_LABELS[b.status] || b.status)} · bắt đầu ${esc(formatWhen(b.createdAt))} · ${num(b.counts && b.counts.accepted)} mục · <code>${esc(String((b.sourceFile && b.sourceFile.sha256) || "").slice(0, 12))}…</code></div>
        <div class="small mut">Số đợt đã ghi theo bản ghi: ${num(b.chunksDone)}/${num(b.chunksTotal)} (chỉ để tham khảo; hệ thống luôn đối chiếu dữ liệu thật).</div>
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap">${resumable ? `<button class="btn ${picked ? "btn-outline" : "btn-ok"}" type="button" data-imp-action="resume-pick" data-batch="${a(b.id)}"${canAct ? "" : " disabled"}>${picked ? "ĐÃ CHỌN — hãy chọn lại đúng tệp" : "TIẾP TỤC (chọn lại đúng tệp)"}</button>` : ""}<button class="btn btn-outline" type="button" data-imp-action="rollback-open" data-batch="${a(b.id)}"${canAct ? "" : " disabled"}>HOÀN TÁC NHẬP</button></div></li>`;
    }).join("");
    return `<section class="card mt-14" id="impRecovery" role="region" aria-labelledby="impRecoveryTitle" style="border-color:#f59e0b">
      <h3 id="impRecoveryTitle" style="margin:0">⚠️ Có lần nhập chưa hoàn tất trong đơn vị này</h3>
      <p class="mut mt-8">Lần nhập trước bị gián đoạn hoặc dừng giữa chừng. Hãy tiếp tục (chọn lại đúng tệp) hoặc hoàn tác trước khi nhập tệp mới.${archived ? " " + esc(RUN_MESSAGES.archivedActions) : ""}</p>
      <ul id="impRecoveryList" style="list-style:none;padding:0;margin:0">${items}</ul></section>`;
  }

  function renderRollbackConfirmHtml({ batch, acknowledged = false }) {
    return `<section class="card mt-14" id="impRollbackConfirm" role="alertdialog" aria-labelledby="impRbTitle" style="border-color:#dc2626">
      <h3 id="impRbTitle" tabindex="-1" style="margin:0;outline:none">↩ Xác nhận hoàn tác lần nhập</h3>
      <p class="mt-8">${esc(RUN_MESSAGES.rollbackWarn)}</p><div class="small mut">Tệp: ${esc((batch.sourceFile && batch.sourceFile.name) || "—")}</div>
      <label class="mt-8" style="display:flex;gap:10px;align-items:center;min-height:44px;cursor:pointer"><input type="checkbox" id="impRbAck" data-imp-rback="1"${acknowledged ? " checked" : ""} style="margin-top:4px;min-width:22px;min-height:22px"><span>Tôi hiểu và muốn hoàn tác lần nhập này.</span></label>
      <div class="flex gap-8 mt-8"><button class="btn btn-ok" type="button" id="impRbConfirm" data-imp-action="rollback-confirm" data-batch="${a(batch.id)}"${acknowledged ? "" : ' disabled aria-disabled="true"'}>HOÀN TÁC NHẬP</button><button class="btn btn-ghost" type="button" data-imp-action="rollback-cancel">HỦY</button></div></section>`;
  }

  return freeze({ renderConfirmHtml, renderRunHtml, renderRecoveryHtml, renderRollbackConfirmHtml, describeStop, RUN_MESSAGES, RUN_PHASE_LABELS, formatWhen });
}
