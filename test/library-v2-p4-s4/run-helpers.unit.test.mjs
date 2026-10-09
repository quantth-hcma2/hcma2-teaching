// P4-S4 - execution UI helpers (pure markup + Vietnamese messages). Run: node --test test/library-v2-p4-s4/run-helpers.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createImportRunHelpers, describeStop, RUN_PHASE_LABELS, RUN_MESSAGES, formatWhen } from "../../import-run-helpers.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const R = createImportRunHelpers({ esc });
const ORG = { id: "orgA", name: "Khoa <b>Quản trị</b>", code: "khoa" };
const SUMMARY = { nodeCount: 63, subjectCount: 3, lessonCount: 60, totalDocuments: 65, chunkCount: 1 };
const FILE = { name: "<img src=x onerror=alert(1)>.xlsx", size: 1000, sha256: "a".repeat(64) };
const VI = /[ạảãàáâấầẩẫậắằẳẵặẹẻẽèéêếềểễệỉịọỏõòóôốồổỗộớờởỡợụủũùúưứừửữựỳỵỷỹý]/i;

test("CONFIRM: names the organization and the planned counts, requires an explicit acknowledgement, is disabled until then or when blocked, escapes everything", () => {
  const off = R.renderConfirmHtml({ organization: ORG, summary: SUMMARY, file: FILE });
  assert.match(off, /id="impConfirmBtn"[^>]* disabled aria-disabled="true"/); assert.match(off, /data-confirm="counts"[^>]*><b>3 môn · 60 bài · 63 mục</); assert.match(off, /data-confirm="documents">65 tài liệu \(1 lô nhập \+ 1 khung \+ 63 mục\) trong 1 đợt ghi/);
  assert.match(off, /Khoa &lt;b&gt;Quản trị&lt;\/b&gt;/); assert.doesNotMatch(off, /<img src=x/); assert.match(off, /Bản nháp, chưa kích hoạt/); assert.match(off, /giữ nguyên trang này/);
  assert.match(off, /Tôi xác nhận nhập <b>63 mục<\/b> \(3 môn, 60 bài\) vào đơn vị/);
  const on = R.renderConfirmHtml({ organization: ORG, summary: SUMMARY, file: FILE, acknowledged: true });
  assert.doesNotMatch(on, /id="impConfirmBtn"[^>]* disabled/); assert.match(on, /id="impConfirmAck"[^>]* checked/);
  const blocked = R.renderConfirmHtml({ organization: ORG, summary: SUMMARY, file: FILE, acknowledged: true, blockedReason: RUN_MESSAGES.blockedIncomplete });
  assert.match(blocked, /id="impConfirmBtn"[^>]* disabled/); assert.match(blocked, /chưa hoàn tất/);
  assert.match(R.renderConfirmHtml({ organization: ORG, summary: SUMMARY, file: FILE, acknowledged: true, canAct: false }), /id="impConfirmBtn"[^>]* disabled/);
  const resume = R.renderConfirmHtml({ organization: ORG, summary: SUMMARY, file: FILE, acknowledged: true, resume: { id: "x" } });
  assert.match(resume, />TIẾP TỤC NHẬP</); assert.match(resume, /chỉ ghi các mục còn thiếu/);
});
test("PROGRESS: current phase, written node counts and chunk, verification counter, a progress bar - and NO success wording while running", () => {
  const nodes = R.renderRunHtml({ run: { kind: "commit", active: true, phase: "nodes", nodesTotal: 903, nodesWritten: 400, chunk: 1, chunksTotal: 3 } });
  assert.match(nodes, /data-phase="nodes"[^>]*><b>Đang ghi môn và bài<\/b> · 400\/903 mục · đợt 1\/3/); assert.match(nodes, /<progress[^>]*value="400" max="903"/); assert.match(nodes, /aria-busy="true"/);
  const verify = R.renderRunHtml({ run: { kind: "commit", active: true, phase: "verify", nodesTotal: 903, nodesWritten: 903, verified: 500 } });
  assert.match(verify, /đã đối chiếu 500\/903 mục/);
  for (const phase of ["authorize", "batch", "framework", "scan", "nodes", "verify", "complete", "rollback-nodes", "rollback-framework", "rollback-batch"]) {
    const html = R.renderRunHtml({ run: { kind: phase.startsWith("rollback") ? "rollback" : "commit", active: true, phase, nodesTotal: 5, nodesDeleted: 2 } });
    assert.match(html, /id="impRunPhase"/); assert.doesNotMatch(html, /Đã nhập xong|thành công|khớp 100%/); assert.ok(VI.test(RUN_PHASE_LABELS[phase]), phase);
  }
  assert.match(R.renderRunHtml({ run: { kind: "rollback", active: true, phase: "rollback-nodes", nodesDeleted: 400 } }), /Đã xóa 400 mục/);
  assert.equal(R.renderRunHtml({ run: null }), "");
});
test("SUCCESS appears ONLY for a completed result and states the read-back verification and activation eligibility", () => {
  const html = R.renderRunHtml({ run: { done: { nodes: 63, subjects: 3, lessons: 60, frameworkName: "Khung <i>x</i>", eligible: true, eligibilityErrors: [] }, kind: "commit", batchId: "b" } });
  assert.match(html, /Đã nhập xong và kiểm tra đầy đủ/); assert.match(html, /Đã đọc lại <b>63 mục<\/b> \(3 môn, 60 bài\) từ máy chủ/); assert.match(html, /khớp 100%/); assert.match(html, /sẵn sàng để kích hoạt/); assert.match(html, /Khung &lt;i&gt;x&lt;\/i&gt;/);
  assert.match(html, /chưa được kích hoạt/); assert.match(html, /data-imp-action="run-finish"/);
  const notEligible = R.renderRunHtml({ run: { done: { nodes: 1, subjects: 1, lessons: 0, frameworkName: "K", eligible: false, eligibilityErrors: ["NO_ACTIVE_SUBJECT"] }, kind: "commit" } });
  assert.match(notEligible, /chưa đủ điều kiện kích hoạt \(NO_ACTIVE_SUBJECT\)/);
  const rolled = R.renderRunHtml({ run: { rollbackDone: { nodesDeleted: 400 }, kind: "rollback" } });
  assert.match(rolled, /Đã hoàn tác lần nhập/); assert.match(rolled, /Đã xóa 400 mục và khung nháp/); assert.match(rolled, /được giữ lại/);
});
test("STOP states: every controller outcome has a Vietnamese, actionable, raw-error-free message and offers only the controls that make sense", () => {
  const cases = {
    paused: { resume: true, rollback: true, match: /Kết nối bị gián đoạn[\s\S]*giữ nguyên \(400 mục\)/, input: { state: "paused", nodesWritten: 400 } },
    incomplete: { resume: true, rollback: true, match: /còn thiếu 3 mục/, input: { state: "incomplete", verification: { counts: { missing: 3 } } } },
    "verification-failed": { resume: false, rollback: true, match: /KHÔNG khớp kế hoạch \(thiếu 1, thừa 2, sai khác 3\)[\s\S]*không thể kích hoạt/, input: { state: "verification-failed", verification: { counts: { missing: 1, extra: 2, altered: 3 } } } },
    denied: { resume: false, rollback: false, match: /không còn quyền[\s\S]*lưu trữ/, input: { state: "denied" } },
    blocked: { resume: false, rollback: false, match: /chưa hoàn tất/, input: { state: "blocked" } },
    "identity-mismatch": { resume: false, rollback: true, match: /KHÔNG khớp với lần nhập đang dở/, input: { state: "identity-mismatch" } },
    "not-committing": { resume: false, rollback: true, match: /Chỉ có thể HOÀN TÁC NHẬP/, input: { state: "not-committing", status: "partial" } },
    unconfirmed: { resume: true, rollback: true, match: /không báo thành công khi chưa đọc lại được/, input: { state: "unconfirmed" } },
    "nodes-remain": { resume: false, rollback: true, match: /chưa xóa hết/, input: { state: "nodes-remain" } },
    "not-rollbackable": { resume: false, rollback: false, match: /XÓA BẢN NHÁP/, input: { state: "not-rollbackable" } },
    "organization-mismatch": { resume: false, rollback: false, match: /không thuộc đơn vị đang mở/, input: { state: "organization-mismatch" } },
    error: { resume: true, rollback: true, match: /lỗi không xác định/, input: { state: "error", kind: "unknown", error: new Error("INTERNAL ASSERTION FAILED at stack") } }
  };
  for (const [name, c] of Object.entries(cases)) {
    const d = describeStop(c.input);
    assert.match(d.text, c.match, name); assert.equal(d.resume, c.resume, name + " resume"); assert.equal(d.rollback, c.rollback, name + " rollback"); assert.ok(VI.test(d.text), name);
    assert.doesNotMatch(d.text, /stack|INTERNAL|TypeError|permission-denied|firestore/i, name);
    const html = R.renderRunHtml({ run: { stop: d, kind: "commit", batchId: "B1" } });
    assert.match(html, /role="alert"/); assert.equal(/data-imp-action="run-resume"/.test(html), c.resume, name); assert.equal(/data-imp-action="rollback-open"/.test(html), c.rollback, name);
  }
  assert.match(R.renderRunHtml({ run: { stop: describeStop({ state: "paused" }), kind: "rollback", batchId: "b" } }), /Hoàn tác chưa xong/);
});
test("RECOVERY card lists only the given (this organization's) incomplete batches; partial batches can only be rolled back; archived/unauthorized disables the actions with the reason", () => {
  const batches = [
    { id: "b1", status: "committing", createdAt: new Date("2026-10-09T03:04:00"), counts: { accepted: 900 }, chunksDone: 1, chunksTotal: 3, sourceFile: { name: "A <x>.xlsx", sha256: "b".repeat(64) } },
    { id: "b2", status: "partial", counts: { accepted: 5 }, chunksDone: 0, chunksTotal: 1, sourceFile: { name: "B.xlsx", sha256: "c".repeat(64) } }
  ];
  const html = R.renderRecoveryHtml({ batches, canAct: true });
  assert.match(html, /Có lần nhập chưa hoàn tất trong đơn vị này/); assert.match(html, /data-batch="b1" data-status="committing"/); assert.match(html, /A &lt;x&gt;\.xlsx/); assert.match(html, /03:04 09\/10\/2026/);
  assert.match(html, /data-imp-action="resume-pick" data-batch="b1"/); assert.doesNotMatch(html, /data-imp-action="resume-pick" data-batch="b2"/); assert.match(html, /data-imp-action="rollback-open" data-batch="b2"/);
  assert.match(html, /chỉ để tham khảo/); assert.match(html, /Đang nhập dở/); assert.match(html, /Đã dừng \(một phần\)/);
  const off = R.renderRecoveryHtml({ batches, canAct: false, archived: true });
  assert.match(off, /data-imp-action="resume-pick"[^>]* disabled/); assert.match(off, /data-imp-action="rollback-open"[^>]* disabled/); assert.match(off, /Đơn vị đã lưu trữ: không thể tiếp tục hoặc hoàn tác/);
  assert.match(R.renderRecoveryHtml({ batches, canAct: true, resumeId: "b1" }), /ĐÃ CHỌN/);
  assert.equal(R.renderRecoveryHtml({ batches: [], canAct: true }), ""); assert.equal(R.renderRecoveryHtml({ batches: null, canAct: true }), "");
});
test("ROLLBACK confirmation needs an explicit acknowledgement and explains what is deleted and that the batch record is kept", () => {
  const off = R.renderRollbackConfirmHtml({ batch: { id: "b1", sourceFile: { name: "A.xlsx" } } });
  assert.match(off, /role="alertdialog"/); assert.match(off, /id="impRbConfirm"[^>]* disabled/); assert.match(off, /bản ghi lần nhập được giữ lại/); assert.match(off, /Dữ liệu khác của đơn vị không bị ảnh hưởng/);
  assert.doesNotMatch(R.renderRollbackConfirmHtml({ batch: { id: "b1", sourceFile: {} }, acknowledged: true }), /id="impRbConfirm"[^>]* disabled/);
});
test("formatWhen formats Firestore timestamps and dates, and tolerates missing values", () => {
  assert.equal(formatWhen(null), "—"); assert.equal(formatWhen({ toMillis: () => new Date("2026-01-02T03:04:00").getTime() }), "03:04 02/01/2026"); assert.equal(formatWhen("x"), "—");
});
