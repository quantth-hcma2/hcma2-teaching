// HCMA2 Teaching — Gate 1B.3-D1 Contract Interaction semantic editor logic.
//
// Orchestration only: resolves what the editor should load, detects whether the edited state is
// actually semantically different from what's currently effective, and drives the COMPLETED
// Gate 1B.3-C2 writer/reader contract to save a new revision. No DOM, no rendering — index.html
// calls these functions and renders the result, exactly like session-reader.mjs /
// session-view.mjs already do for the rest of the app. This is what makes the editor's
// load/change-detection/save/error-handling behavior directly testable without a browser/DOM
// harness.
//
// Never redesigns the writer/reader contract and never touches Rules: every "fail closed"
// guarantee this module states (CLOSED-FIRST, fresh identifiers every revision, no root
// semantic mirroring, honest rev0 vs rev>=1 loading) is the SAME guarantee contract-writer.mjs
// and firestore.rules.production-candidate already enforce authoritatively — this module's own
// pre-checks are fail-fast UX, not the security boundary, matching the philosophy
// contract-writer.mjs documents for itself.

import { isContractSession, resolveInteractionConfig, isProtectedFixture } from "./session-reader.mjs";
import {
  applyInteractionRevision, ContractWriterError, semanticManifestForCompare,
  buildInteractionManifest, stableEqual
} from "./contract-writer.mjs";

export class ContractEditorError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ContractEditorError";
    this.code = code;
    this.details = details || null;
  }
}

// Strips every writer-generated identity field (questionId/roundId/order on the question, id/
// order on each option) down to plain author-supplied semantic content — GATE 1B.3-D1 item 6:
// the editor's own in-memory state must never carry forward a prior revision's identifiers, so
// there is nothing here FOR the UI to (mis)reuse even by accident. `order` becomes purely
// implicit array position from here on, exactly matching how the writer itself derives it.
function toAuthoredQuestion(entry) {
  return {
    type: entry.type, question: entry.question || "", description: entry.description || "",
    required: entry.required !== false, chartType: entry.chartType || null,
    timeLimit: Number.isInteger(entry.timeLimit) ? entry.timeLimit : 0,
    allowChangeAnswer: !!entry.allowChangeAnswer,
    scaleMin: entry.scaleMin ?? null, scaleMax: entry.scaleMax ?? null,
    options: (Array.isArray(entry.options) ? entry.options : []).map((o) => ({
      label: o.label ?? "", text: o.text ?? "", value: o.value ?? null, isCorrect: o.isCorrect ?? null
    }))
  };
}

// The editor-confirmed legacy snapshot payload the writer requires for the first transition
// (GATE 1B.3-C2 §5 / this gate's item 5): built from exactly what was loaded and shown to the
// teacher in THIS editor session — never a fresh, silent re-read at save time, and never a
// claim of commit-time freshness. Unlike toAuthoredQuestion(), the legacy identifiers here are
// preserved (questionId/roundId/option id/order) because this is a historical compatibility
// record, not a new semantic revision — the writer's own frozen legacyTransitionSnapshot schema
// expects the real legacy IDs, not fresh ones.
function toLegacySnapshotEntry(entry, index) {
  return {
    questionId: entry.questionId, roundId: entry.roundId || "legacy-v0",
    order: Number.isInteger(entry.order) ? entry.order : index,
    type: entry.type, question: entry.question || "", description: entry.description || "",
    required: entry.required !== false, chartType: entry.chartType || null,
    timeLimit: Number.isInteger(entry.timeLimit) ? entry.timeLimit : 0,
    allowChangeAnswer: !!entry.allowChangeAnswer, scaleMin: entry.scaleMin ?? null, scaleMax: entry.scaleMax ?? null,
    options: (Array.isArray(entry.options) ? entry.options : []).map((o, i) => ({
      id: o.id, label: o.label ?? "", text: o.text ?? "",
      order: Number.isInteger(o.order) ? o.order : i, value: o.value ?? null, isCorrect: o.isCorrect ?? null
    }))
  };
}

/**
 * Reads the CURRENT, LIVE (still-mutable) legacy questions + their option subdocuments for a
 * session — only ever called for a session that has NOT yet produced a real revision >=1 (rev0
 * baseline or plain legacy), where no Contract-versioned question document can exist yet, so
 * every question found here is unambiguously legacy. Never called for a revision >=1 session.
 */
export async function loadLiveLegacyQuestionsWithOptions(dbFacade, sessionId, ownerId) {
  const qDocs = await dbFacade.listDocs("questions", { where: [["sessionId", "==", sessionId], ["ownerId", "==", ownerId]] });
  const withOptions = await Promise.all(qDocs.map(async (q) => {
    const optDocs = await dbFacade.listDocs(`questions/${q.id}/options`);
    const options = optDocs.map((o) => ({ id: o.id, ...o.data })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return { questionId: q.id, roundId: "legacy-v0", ...q.data, options };
  }));
  return withOptions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * GATE 1B.3-D1 item 1: resolves what the Contract semantic editor should load, honestly
 * distinguishing legacy / rev0 / rev>=1 (reusing resolveInteractionConfig()'s already-proven
 * three-state honesty from Gate 1B.3-C2R — never re-derived here):
 *  - "legacy": not activated. The Contract editor must never open for this state — index.html's
 *    existing Gate 1A title/description editor remains the sole writer here, unchanged.
 *  - "rev0": activation baseline. `editorSeed` is built from the CURRENT LIVE legacy
 *    questions/options (a real read performed here, not fabricated) plus the baseline's own
 *    title/description. `legacyQuestionsForSnapshot` carries the untouched loaded records
 *    forward for the eventual first-transition snapshot payload.
 *  - "revN" (N>=1): `editorSeed` is built SOLELY from the immutable current configVersions
 *    document — never from root fields, never from the live legacy questions collection.
 */
export async function resolveEditorEntryState(dbFacade, sessionPath, sessionData, sessionId) {
  if (!isContractSession(sessionData)) {
    return { mode: "legacy" };
  }
  const cfg = await resolveInteractionConfig(dbFacade, sessionPath, sessionData);
  if (cfg.source === "contract-baseline") {
    const legacyQuestionsForSnapshot = await loadLiveLegacyQuestionsWithOptions(dbFacade, sessionId, sessionData.ownerId);
    return {
      mode: "rev0",
      expectedRevision: 0,
      editorSeed: {
        title: cfg.title, description: cfg.description,
        allowMultipleResponses: false, anonymous: true, showResponderCount: true,
        questions: legacyQuestionsForSnapshot.map(toAuthoredQuestion)
      },
      legacyQuestionsForSnapshot
    };
  }
  if (cfg.source === "contract-revision") {
    return {
      mode: "revN",
      expectedRevision: cfg.revision,
      editorSeed: {
        title: cfg.title, description: cfg.description,
        allowMultipleResponses: cfg.allowMultipleResponses, anonymous: cfg.anonymous, showResponderCount: cfg.showResponderCount,
        questions: cfg.questions.map(toAuthoredQuestion)
      }
    };
  }
  throw new ContractEditorError("UNSUPPORTED_ENTRY_STATE", "Không thể xác định trạng thái hợp đồng của phiên này.");
}

/**
 * GATE 1B.3-D1 item 4: true iff `candidateChanges` (the editor's current in-memory state) would
 * produce a manifest semantically different from `editorSeed` (the effective state the editor
 * loaded) — built through the SAME buildInteractionManifest()/semanticManifestForCompare() the
 * writer itself uses for its own idempotency comparison, so "the UI thinks this changed" and
 * "the writer would treat this as a new revision" can never silently disagree. Both sides are
 * expected to be COMPLETE (every field + `questions` explicitly present, as the editor always
 * submits the full edited state), so the currentConfigData placeholder below is never actually
 * consulted for a "carry forward omitted field" merge.
 */
export function hasSemanticChange(editorSeed, candidateChanges) {
  const inertCurrentConfigData = { kind: "interaction" };
  const seedManifest = buildInteractionManifest({ configId: "__compare__", actorUid: "__compare__", currentConfigData: inertCurrentConfigData, changes: editorSeed });
  const candidateManifest = buildInteractionManifest({ configId: "__compare__", actorUid: "__compare__", currentConfigData: inertCurrentConfigData, changes: candidateChanges });
  return !stableEqual(semanticManifestForCompare(seedManifest), semanticManifestForCompare(candidateManifest));
}

const ERROR_MESSAGES_VI = Object.freeze({
  NOT_FOUND: "Phiên không còn tồn tại.",
  NOT_ACTIVATED: "Phiên chưa kích hoạt hợp đồng phiên bản.",
  LIFECYCLE_NOT_SAFE: "Phiên phải ở trạng thái ĐÃ ĐÓNG mới được lưu nội dung phiên bản mới.",
  STALE_REVISION: "Cấu hình phiên đã thay đổi ở nơi khác trong lúc bạn đang sửa. Vui lòng tải lại trang và thử lại.",
  MANIFEST_INVALID: "Nội dung phiên bản không hợp lệ hoặc vượt quá giới hạn cho phép.",
  TOO_MANY_QUESTIONS: "Vượt quá số câu hỏi tối đa cho phép trong một phiên bản (100 câu).",
  TOO_MANY_OPTIONS: "Một câu hỏi có quá nhiều phương án (tối đa 20).",
  INVALID_QUESTION_TYPE: "Loại câu hỏi không hợp lệ.",
  QUESTION_INVALID: "Một câu hỏi thiếu nội dung bắt buộc hoặc thiếu phương án cần có.",
  INVALID_SCALE_BOUNDS: "Khoảng thang điểm không hợp lệ (giá trị nhỏ nhất phải nhỏ hơn giá trị lớn nhất).",
  LEGACY_SNAPSHOT_REQUIRED: "Thiếu dữ liệu câu hỏi cũ cần xác nhận cho lần chuyển đổi đầu tiên.",
  LEGACY_TOO_MANY_QUESTIONS: "Số câu hỏi cũ vượt quá giới hạn cho phép.",
  LEGACY_TOO_MANY_OPTIONS: "Một câu hỏi cũ có quá nhiều phương án.",
  SNAPSHOT_TOO_LARGE: "Dữ liệu ảnh chụp câu hỏi cũ vượt quá giới hạn kích thước.",
  OPERATION_ID_PAYLOAD_MISMATCH: "Yêu cầu lưu trước đó với cùng mã thao tác đã ghi nội dung khác. Vui lòng tải lại trang và thử lưu lại.",
  REVISION_INTEGRITY_VERIFICATION_FAILED: "Đã ghi phiên bản mới nhưng KHÔNG xác minh được đầy đủ các câu hỏi sau khi lưu. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng KHÔNG mở lại phiên này và liên hệ hỗ trợ kỹ thuật trước khi tiếp tục."
});

/**
 * GATE 1B.3-D1 item 8: maps a typed ContractWriterError (or an unexpected error) to a
 * ContractEditorError carrying a clear Vietnamese message, WITHOUT ever claiming a rollback
 * happened — REVISION_INTEGRITY_VERIFICATION_FAILED explicitly tells the teacher the write
 * occurred, the session remains CLOSED, and reopening must wait until the issue is resolved. No
 * automatic repair is attempted anywhere in this module.
 */
export function classifyWriterError(e) {
  if (e instanceof ContractEditorError) return e;
  if (e instanceof ContractWriterError) {
    const message = ERROR_MESSAGES_VI[e.code] || `Không thể lưu: ${e.message}`;
    return new ContractEditorError(e.code, message, e.details);
  }
  return new ContractEditorError("UNKNOWN_ERROR", "Đã xảy ra lỗi không xác định khi lưu. Vui lòng thử lại.", { originalMessage: e && e.message });
}

/**
 * GATE 1B.3-D1 items 3+4+5+8: the editor's full save orchestration.
 *  1. Re-reads the authoritative session root immediately before invoking the writer — CLOSED-
 *     FIRST is checked fresh here, not against whatever was loaded when the editor opened, and
 *     fails closed with a clear Vietnamese message without ever calling the writer if the
 *     session is not CLOSED (the writer/Rules re-check this too — the real security boundary —
 *     but this UI-level check exists so a stale-but-still-open editor window never even
 *     attempts a doomed write).
 *  2. If the candidate state is not semantically different from what was loaded, returns
 *     { noChange: true } WITHOUT calling applyInteractionRevision() at all.
 *  3. Otherwise calls the real Gate 1B.3-C2 writer, attaching legacyQuestionsForSnapshot only
 *     on the first transition (mode "rev0") — never on a later revision, matching the writer's
 *     own frozen "ignored on non-first-transition" contract.
 *  4. Any writer error is classified into a Vietnamese-facing ContractEditorError before it
 *     reaches the caller.
 */
export async function saveInteractionRevision({ db, firestore, sessionId, actorUid, operationId, mode, expectedRevision, editorSeed, candidateChanges, legacyQuestionsForSnapshot }) {
  // GATE E2 item 6: the one known real-production Contract audit fixture is blocked here,
  // before any read or write is attempted, regardless of which UI entry point reached this
  // function — this is the single authoritative choke point for "no semantic revision may ever
  // be written for this session through the normal UI."
  if (isProtectedFixture(sessionId)) {
    throw new ContractEditorError("PROTECTED_FIXTURE", "Phiên kiểm thử hợp đồng hệ thống — chỉ đọc, không chỉnh sửa.");
  }
  const { doc, getDoc } = firestore;
  const freshSnap = await getDoc(doc(db, "sessions", sessionId));
  if (!freshSnap.exists()) throw new ContractEditorError("SESSION_NOT_FOUND", "Phiên không còn tồn tại.");
  const freshData = freshSnap.data();
  if (freshData.status !== "closed") {
    throw new ContractEditorError("SESSION_NOT_CLOSED", "Phiên phải ở trạng thái ĐÃ ĐÓNG mới được lưu nội dung phiên bản mới. Vui lòng đóng phiên rồi thử lại.");
  }
  // Deliberately no local configRevision pre-check here: the writer's OWN STALE_REVISION check
  // (inside its transaction, via classifyWriterError below) is the authoritative one AND is
  // replay-aware — an idempotent retry of an operationId that already committed sees
  // freshData.configRevision have moved past `expectedRevision` too, but that is a legitimate
  // replay, not staleness. A local pre-check here cannot distinguish the two without duplicating
  // the writer's own historySnap lookup, so genuine staleness is left entirely to the writer,
  // which already reports it as a typed STALE_REVISION error.

  try {
    // hasSemanticChange() reuses the writer's own buildInteractionManifest(), which validates
    // shape (question type, scale bounds, question/option counts) as a side effect of building
    // — a malformed candidate can therefore throw here, before the writer is ever called. That
    // throw must be classified exactly the same way a failure from the real write would be, so
    // it is inside this same try/catch rather than a separate, unclassified escape path.
    if (!hasSemanticChange(editorSeed, candidateChanges)) {
      return { noChange: true };
    }

    const changes = { ...candidateChanges };
    if (mode === "rev0") {
      changes.legacyQuestions = (legacyQuestionsForSnapshot || []).map(toLegacySnapshotEntry);
    }

    const result = await applyInteractionRevision({ db, firestore, sessionId, actorUid, operationId, expectedRevision, changes });
    return { noChange: false, result };
  } catch (e) {
    throw classifyWriterError(e);
  }
}

/**
 * GATE 1B.3-D1 item 7: once a session has a real Contract revision (>=1), the legacy
 * "ĐỔI THỜI GIAN" bulk-mutation path (index.html's editSessionTime()) must no longer be
 * reachable for it — timeLimit is now versioned semantic config, changed only by creating a new
 * revision through this editor. Legacy sessions and rev0 (still backed by live, mutable legacy
 * question documents) are completely unaffected.
 *
 * GATE E2 item 6: also disabled for the one protected production audit fixture regardless of
 * its revision — `sessionId` is optional (existing callers that only have `sessionData` keep
 * working exactly as before; the fixture check simply never fires without it).
 */
export function shouldDisableLegacyTimeEdit(sessionData, sessionId) {
  return (isContractSession(sessionData) && Number(sessionData.configRevision || 0) >= 1) || isProtectedFixture(sessionId);
}
