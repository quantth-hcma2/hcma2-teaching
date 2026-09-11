// HCMA2 Teaching — Gate 1B.2C-T view-model helpers.
// Pure functions only: no Firestore reads, no DOM writes, no side effects. Each function takes
// already-resolved data (title/description resolved by session-reader.mjs's
// resolveSessionSemantics() elsewhere, never here) and returns the plain value or object the
// corresponding index.html render/export function should use. This is what makes the
// *consumption* of resolveSessionSemantics()'s output directly testable without a browser/DOM
// harness — the render/export functions in index.html call these and interpolate/serialize the
// result, with no further semantic-field logic of their own.

import { isContractSession } from "./session-reader.mjs";

/**
 * What the QR modal (showQrModal in index.html) should display. `displayTitle` must already be
 * resolved by the caller (teacherLiveControl already resolves it once via
 * resolveSessionSemantics() before this is ever reachable) — this function never reads
 * session.title itself, so it cannot regress to the stale root value.
 */
export function qrModalViewModel(session, displayTitle) {
  return { title: displayTitle ?? "", shortCode: session.shortCode || "" };
}

/**
 * What the Presentation view (watchPresentation in index.html) should render for the current
 * session snapshot.
 *
 * A contract session ALWAYS resolves to "contract-unsupported", unconditionally, before any
 * status/activeQuestionId check runs. Presentation runs under the anonymous `publicAuth`
 * identity (see ensureAnonAuth() in index.html — deliberately never the teacher's own auth, to
 * avoid participant-ID collision), and the deployed Rules restrict
 * sessions/{id}/configVersions/{configId} `get` to isOwnerOrAdmin only. An anonymous viewer can
 * therefore never legitimately read the active manifest — there is no Rules-compliant way to
 * resolve the effective title here without a Rules change, which is explicitly out of scope for
 * this gate. Failing closed to one explicit "not yet supported" state — rather than attempting a
 * doomed-to-fail resolution, or reading the mutable root title — is the only safe behavior, and
 * it applies regardless of the session's status or active question.
 *
 * For a legacy (non-contract) session this preserves the exact branching order
 * watchPresentation always used: draft/ready -> waiting; closed/archived -> ended; open with no
 * active question -> waiting; otherwise -> question.
 */
export function presentationRenderState(session) {
  if (isContractSession(session)) return { mode: "contract-unsupported" };
  if (session.status === "draft" || session.status === "ready") {
    return { mode: "waiting", title: session.title ?? "", className: session.className || "", shortCode: session.shortCode || "" };
  }
  if (session.status === "closed" || session.status === "archived") {
    return { mode: "ended", title: session.title ?? "" };
  }
  if (!session.activeQuestionId) {
    return { mode: "waiting", title: session.title ?? "", className: session.className || "", shortCode: session.shortCode || "" };
  }
  return { mode: "question", title: session.title ?? "", className: session.className || "", shortCode: session.shortCode || "" };
}

/**
 * Pure JSON export payload builder for exportSessionJSON in index.html. `semanticTitle` must
 * already be resolved by the caller (teacherReportView) — this function never reads
 * session.title itself. No Blob/download side effects here; index.html still owns that part.
 */
export function buildInteractionJsonExport(session, className, questionBlocks, semanticTitle) {
  return {
    hoatDong: semanticTitle,
    lop: className,
    ngayTao: session.createdAt && session.createdAt.toDate ? session.createdAt.toDate().toISOString() : null,
    cauHoi: questionBlocks.map(b => ({
      cauHoi: b.q.question,
      loai: b.q.type,
      phuongAn: b.options.map(o => o.text),
      cauTraLoi: b.docs.map(d => ({
        participantId: d.participantId,
        answer: d.answer,
        selectedOptions: d.selectedOptions,
        submittedAt: d.submittedAt && d.submittedAt.toDate ? d.submittedAt.toDate().toISOString() : null
      }))
    }))
  };
}
