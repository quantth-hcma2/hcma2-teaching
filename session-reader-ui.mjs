// HCMA2 Teaching — Gate 1B.1 UI/repository reader layer.
// Wraps session-reader.mjs with: permission checks, stale-state re-verification, fail-closed
// error surfacing, and a hard PII boundary for anything public-facing. GET/LIST only — no
// writes, no AI calls, no Second Brain calls anywhere in this file.

import {
  isContractSession,
  effectiveLifecycleState,
  resolveEffectiveConfig,
  readInteractionReport,
  readGroupHistoricalData,
  resolveParticipantPolicy,
  stripPii,
  ReaderError
} from "./session-reader.mjs";

export class ReaderUiError extends Error {
  constructor(code, userMessage, cause) {
    super(userMessage);
    this.name = "ReaderUiError";
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause || null;
  }
}

const KIND_BY_COLLECTION = { sessions: "interaction", groupActivities: "group", knowledgeSessions: "knowledge" };

function assertPermission(ctx, sessionData) {
  const uid = ctx && ctx.uid;
  const isOwner = !!uid && sessionData.ownerId === uid;
  const isActiveAdmin = ctx && ctx.role === "admin" && ctx.status === "active";
  const isActiveTeacherOwner = ctx && ctx.role === "teacher" && ctx.status === "active" && isOwner;
  if (!isActiveAdmin && !isActiveTeacherOwner) {
    throw new ReaderUiError("FORBIDDEN", "Bạn không có quyền xem phiên này.");
  }
}

function toReaderUiError(e) {
  if (e instanceof ReaderUiError) return e;
  if (e instanceof ReaderError) {
    const messages = {
      UNSUPPORTED_CONTRACT: "Phiên này dùng phiên bản hợp đồng chưa được hỗ trợ.",
      MANIFEST_INVALID: "Cấu hình phiên không hợp lệ.",
      BROKEN_ANCESTRY: "Chuỗi cấu hình phiên bị đứt gãy.",
      ANCESTRY_CYCLE: "Chuỗi cấu hình phiên bị lặp vòng.",
      ANCESTRY_TOO_DEEP: "Chuỗi cấu hình phiên vượt quá giới hạn cho phép."
    };
    return new ReaderUiError(e.code, messages[e.code] || "Không thể tải cấu hình phiên. Chưa hỗ trợ.", e);
  }
  if (e && e.code === "permission-denied") {
    return new ReaderUiError("PERMISSION_DENIED", "Không có quyền đọc dữ liệu này.", e);
  }
  return new ReaderUiError("UNKNOWN", (e && e.message) || "Đã có lỗi khi tải phiên.", e);
}

/**
 * Loads one session document (sessions | groupActivities | knowledgeSessions) for a
 * teacher/admin caller and re-verifies it hasn't gone stale (deleted, ownership changed, or
 * configRevision bumped underneath us) once the rest of the graph has finished loading.
 * Fails closed: any invalid/unsupported contract state surfaces as a thrown ReaderUiError,
 * it is never silently rendered as legacy.
 */
export async function loadSessionRootForTeacher(dbFacade, collectionName, sessionId, ctx) {
  const kind = KIND_BY_COLLECTION[collectionName];
  if (!kind) throw new ReaderUiError("BAD_KIND", "Loại phiên không hợp lệ.");
  const path = `${collectionName}/${sessionId}`;
  let snap;
  try {
    snap = await dbFacade.getDoc(path);
  } catch (e) {
    throw toReaderUiError(e);
  }
  if (!snap.exists) throw new ReaderUiError("NOT_FOUND", "Phiên không còn tồn tại.");
  const sessionData = { ...snap.data, __sessionId: sessionId };
  assertPermission(ctx, sessionData);

  const revisionAtLoad = sessionData.configRevision ?? null;
  let effective;
  try {
    effective = await resolveEffectiveConfig(dbFacade, path, sessionData, kind);
  } catch (e) {
    throw toReaderUiError(e);
  }

  // Stale-state re-check: re-read root after the (possibly multi-step) load.
  let recheck;
  try {
    recheck = await dbFacade.getDoc(path);
  } catch (e) {
    throw toReaderUiError(e);
  }
  if (!recheck.exists) throw new ReaderUiError("STALE_DELETED", "Phiên vừa bị xóa trong lúc tải.");
  if (recheck.data.ownerId !== sessionData.ownerId) throw new ReaderUiError("STALE_OWNER", "Chủ phiên đã thay đổi trong lúc tải. Hãy tải lại.");
  const revisionNow = recheck.data.configRevision ?? null;
  if (revisionAtLoad !== revisionNow) throw new ReaderUiError("STALE_CONFIG_REVISION", "Cấu hình phiên vừa được cập nhật trong lúc tải. Hãy tải lại.");

  return {
    kind,
    sessionId,
    sessionData,
    lifecycleState: effectiveLifecycleState(sessionData),
    isContract: isContractSession(sessionData),
    effective
  };
}

/** Interaction report for a teacher/admin. Owner-facing: PII is not applicable to this shape. */
export async function loadInteractionReportForTeacher(dbFacade, sessionId, ctx) {
  const root = await loadSessionRootForTeacher(dbFacade, "sessions", sessionId, ctx);
  try {
    const report = await readInteractionReport(dbFacade, `sessions/${sessionId}`, root.sessionData);
    return { ...root, report };
  } catch (e) {
    throw toReaderUiError(e);
  }
}

/** Historical group data for a teacher/admin, including retired/unresolved records. */
export async function loadGroupHistoricalDataForTeacher(dbFacade, sessionId, ctx) {
  const root = await loadSessionRootForTeacher(dbFacade, "groupActivities", sessionId, ctx);
  try {
    const history = await readGroupHistoricalData(dbFacade, `groupActivities/${sessionId}`, root.sessionData);
    return { ...root, history };
  } catch (e) {
    throw toReaderUiError(e);
  }
}

/**
 * The participant-facing / public projection of a Knowledge session's profile policy. This
 * never reads or returns fullName/className/email/phone of any *other* participant — it only
 * resolves the caller's own pinned policy (which fields to ask for), and the policy object
 * itself never carries PII values (it is a schema, not participant data). Defense in depth:
 * the result is still run through stripPii() before being handed back.
 */
export async function loadOwnParticipantPolicyPublic(dbFacade, sessionId, sessionData, uid) {
  if (!uid) throw new ReaderUiError("FORBIDDEN", "Cần đăng nhập ẩn danh trước khi đọc chính sách hồ sơ.");
  try {
    const policy = await resolveParticipantPolicy(dbFacade, `knowledgeSessions/${sessionId}`, sessionData, uid);
    return stripPii(policy);
  } catch (e) {
    throw toReaderUiError(e);
  }
}

export { stripPii };
