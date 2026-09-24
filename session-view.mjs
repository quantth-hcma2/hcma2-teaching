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
 * Gate 1B.2C-P1: decides the title teacherLiveControl's live snapshot listener should display,
 * on every session snapshot. `displaySemantics` is resolved exactly once, when the screen loads
 * (session-reader.mjs's resolveSessionSemantics) — this function does not re-resolve it and
 * takes no Firestore facade, it only picks between two already-known values:
 *
 * - Contract session: ALWAYS the already-resolved effective title (`resolvedContractTitle`),
 *   even though the snapshot's own root `session.title` keeps arriving on every update — the
 *   root value is frozen-at-activation and must never be shown, silently or otherwise.
 * - Legacy session: the FRESH `freshLegacyTitle` from this exact snapshot, so a Gate 1A edit
 *   made while the screen is open is reflected immediately, exactly as it always was before the
 *   contract-bridge work — this was the bug: a stale, load-time-only value was being shown for
 *   legacy sessions too.
 */
export function liveTitleForSnapshot(isContract, freshLegacyTitle, resolvedContractTitle) {
  return isContract ? (resolvedContractTitle ?? "") : (freshLegacyTitle ?? "");
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

/**
 * GATE 1B.3-D2R item A: pure CSV row builder for exportSessionCSV in index.html — extracted the
 * same way buildInteractionJsonExport() already was, so the CSV path is equally testable against
 * real questionBlocks (built by resolveReportQuestionBlocks in contract-runtime.mjs) rather than
 * only reasoned about. index.html still owns csvEscape()/joining/Blob-download; this only builds
 * the row data, keyed per response to its OWN question block — never relabeled under a later
 * revision's semantics, exactly like the JSON export.
 */
export function buildInteractionCsvRows(questionBlocks) {
  const rows = [["Cau hoi", "Loai cau hoi", "Ma nguoi tham gia", "Cau tra loi", "Thoi gian gui"]];
  for (const b of questionBlocks) {
    for (const d of b.docs) {
      let ans = d.answer;
      if (b.options && b.options.length && d.selectedOptions) {
        ans = d.selectedOptions.map((oid) => { const o = b.options.find((x) => x.id === oid); return o ? o.text : oid; }).join(" | ");
      }
      rows.push([b.q.question, b.q.type, (d.participantId || "").slice(0, 8), ans, d.submittedAt && d.submittedAt.toDate ? d.submittedAt.toDate().toISOString() : ""]);
    }
  }
  return rows;
}

/**
 * GATE 1B.3-D2R item B: resolves whether the student-facing result badge should show the
 * responder count, preferring the value carried on the live aggregate itself (resolved by the
 * teacher via resolveRuntimeSettings(), which correctly reads the CURRENT Contract config for a
 * rev>=1 session) over the session root's own showResponderCount field, which is frozen-at-
 * activation and therefore stale for any rev>=1 session. An aggregate written before this field
 * existed (or no aggregate at all yet) falls back to the root value, matching the exact
 * pre-existing behavior for legacy/rev0 sessions.
 */
export function resolveShowResponderCount(agg, sessionData) {
  if (agg && agg.showResponderCount !== undefined) return agg.showResponderCount !== false;
  return (sessionData && sessionData.showResponderCount) !== false;
}
