// HCMA2 Teaching — Gate E2 Contract activation UX logic.
//
// A narrow, explicit, human-confirmed action that opts a CLOSED legacy sessions/Interaction
// session into Contract mode. Reuses the completed, already-production-proven
// contract-writer.mjs's activateContract() unchanged — this module owns only the UI-facing
// visibility/authorization/fresh-recheck orchestration around that one call, never activation
// semantics themselves. No DOM here — index.html calls these functions and renders the result,
// same pattern as contract-editor.mjs / contract-runtime.mjs.

import { isContractSession, isProtectedFixture } from "./session-reader.mjs";
import { activateContract, ContractWriterError } from "./contract-writer.mjs";

export class ContractActivationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ContractActivationError";
    this.code = code;
    this.details = details || null;
  }
}

function isOwnerOrAdmin(sessionData, actorUid, actorProfile) {
  const isOwner = !!actorProfile && actorProfile.role === "teacher" && actorProfile.status === "active" && sessionData.ownerId === actorUid;
  const isAdmin = !!actorProfile && actorProfile.role === "admin" && actorProfile.status === "active";
  return isOwner || isAdmin;
}

/**
 * GATE E2 item 2: pure visibility predicate for the "KÍCH HOẠT CHẾ ĐỘ CHỈNH SỬA NÂNG CAO"
 * action. All five conditions must hold; any single one failing hides/disables the action.
 * Deliberately conservative — `sessionData`/`actorProfile` missing or malformed hides the
 * action rather than guessing.
 */
export function canShowActivationAction({ sessionId, sessionData, actorUid, actorProfile }) {
  if (isProtectedFixture(sessionId)) return false;
  if (!sessionData) return false;
  if (isContractSession(sessionData)) return false;
  if (sessionData.status !== "closed") return false;
  if (!isOwnerOrAdmin(sessionData, actorUid, actorProfile)) return false;
  return true;
}

/**
 * GATE E2 items 4/5/6: the full explicit-activation orchestration.
 *  1. Refuses outright for the protected production audit fixture — checked first, before any
 *     read, so it can never even reach a state check.
 *  2. Re-reads the authoritative session root fresh (never trusting whatever the caller's UI
 *     state already had) and fails closed with a typed, Vietnamese-facing error if the session
 *     is no longer CLOSED, is already Contract, or the caller is no longer owner/admin against
 *     the FRESH data — covering the "state changed between render and click" race explicitly.
 *  3. Only then calls the existing, unmodified activateContract() — this module never
 *     reimplements activation semantics, never generates configRevision/configId/audit docs
 *     itself, and never redesigns the writer's own idempotency/one-way contract.
 */
export async function activateSessionExplicit({ db, firestore, sessionId, actorUid, actorProfile, operationId }) {
  if (isProtectedFixture(sessionId)) {
    throw new ContractActivationError("PROTECTED_FIXTURE", "Phiên kiểm thử hợp đồng hệ thống — chỉ đọc, không chỉnh sửa.");
  }
  const { doc, getDoc } = firestore;
  const freshSnap = await getDoc(doc(db, "sessions", sessionId));
  if (!freshSnap.exists()) {
    throw new ContractActivationError("SESSION_NOT_FOUND", "Phiên không còn tồn tại.");
  }
  const freshData = freshSnap.data();
  if (isContractSession(freshData)) {
    throw new ContractActivationError("ALREADY_CONTRACT", "Phiên đã được kích hoạt chế độ chỉnh sửa nâng cao (có thể ở nơi khác). Vui lòng tải lại trang.");
  }
  if (freshData.status !== "closed") {
    throw new ContractActivationError("SESSION_NOT_CLOSED", "Phiên phải ở trạng thái ĐÃ ĐÓNG mới được kích hoạt chế độ chỉnh sửa nâng cao. Vui lòng đóng phiên rồi thử lại.");
  }
  if (!isOwnerOrAdmin(freshData, actorUid, actorProfile)) {
    throw new ContractActivationError("NOT_AUTHORIZED", "Bạn không có quyền kích hoạt phiên này.");
  }
  try {
    return await activateContract({ db, firestore, family: "sessions", sessionId, actorUid, operationId });
  } catch (e) {
    if (e instanceof ContractActivationError) throw e;
    if (e instanceof ContractWriterError) throw new ContractActivationError(e.code, e.message, e.details);
    throw new ContractActivationError("UNKNOWN_ERROR", "Đã xảy ra lỗi không xác định khi kích hoạt. Vui lòng thử lại.", { originalMessage: e && e.message });
  }
}
