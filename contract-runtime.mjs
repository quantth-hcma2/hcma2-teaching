// HCMA2 Teaching — Gate 1B.3-D2 Contract Interaction runtime bridge logic.
//
// Single-source resolvers for the RUNTIME consumers of a sessions/Interaction Contract config
// (teacher live control, clone-to-wizard, reports/exports) plus the mandatory reopen integrity
// guard. Pure orchestration + Firestore reads only — no DOM. Reuses the completed Gate 1B.3-C2
// writer/reader contract and Gate 1B.3-D1's contract-editor.mjs; never redesigns either, never
// touches Rules.
//
// STUDENT (anonymous) rendering deliberately does NOT go through this module: Rules restrict
// `configVersions` reads to isOwnerOrAdmin only, so an anonymous participant can never safely
// resolve a Contract config directly (same constraint Gate 1B.2C already documented for
// Presentation). The student flow in index.html instead reads the active `questions/{id}`
// document directly (already Rules-permitted while it is that session's activeQuestionId) and
// uses the two small pure helpers exported here (isEmbeddedOptionsQuestion,
// isQuestionCurrentForSession) to interpret it correctly — no new Firestore access is needed or
// granted for that path.

import { isContractSession, resolveInteractionConfig } from "./session-reader.mjs";
import { stableEqual } from "./contract-writer.mjs";
import { loadLiveLegacyQuestionsWithOptions } from "./contract-editor.mjs";

export class ContractRuntimeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ContractRuntimeError";
    this.code = code;
    this.details = details || null;
  }
}

/** True iff this question document carries embedded Contract options (configId-bearing) — the
 * caller must read `question.options` directly rather than querying the (Contract-questions-
 * never-have-one) options subcollection. */
export function isEmbeddedOptionsQuestion(question) {
  return !!(question && question.configId);
}

/**
 * GATE 1B.3-D2 item 5: true iff `question` is safe to render as the CURRENT active question for
 * `sessionData` — a legacy (configId-less) question is always current by definition (no
 * revision concept applies to it); a Contract-versioned question is current only if its
 * configId matches the session's currentConfigId right now. A stale activeQuestionId pointing
 * at a retired revision's question (or at a foreign session's leftover document) must fail
 * closed here rather than render historical semantics as if they were current.
 */
export function isQuestionCurrentForSession(question, sessionData) {
  if (!question) return false;
  if (!question.configId) return true;
  return question.configId === (sessionData && sessionData.currentConfigId);
}

/**
 * GATE 1B.3-D2 item 2: the single shared resolver for "what are this session's CURRENT ordered
 * questions, with embedded options" — used by teacher live control and clone-to-wizard alike,
 * for every state (legacy / rev0 baseline / rev>=1), so Contract branching is written once
 * rather than duplicated per consumer. Never returns a prior revision's questions: for rev>=1 it
 * reads solely from the immutable current configVersions document (never the live legacy
 * questions collection, which may still hold leftover documents that must never resurface as
 * current — see Gate 1B.3-C2R item C, reused here via resolveInteractionConfig()).
 */
export async function resolveRuntimeQuestions(dbFacade, sessionPath, sessionData, sessionId) {
  if (!isContractSession(sessionData)) {
    const qs = await loadLiveLegacyQuestionsWithOptions(dbFacade, sessionId, sessionData.ownerId);
    return { source: "legacy", questions: qs.map((q) => ({ ...q, id: q.questionId })) };
  }
  const cfg = await resolveInteractionConfig(dbFacade, sessionPath, sessionData);
  if (cfg.source === "contract-baseline") {
    const qs = await loadLiveLegacyQuestionsWithOptions(dbFacade, sessionId, sessionData.ownerId);
    return { source: "contract-baseline", questions: qs.map((q) => ({ ...q, id: q.questionId })) };
  }
  return {
    source: "contract-revision",
    configId: cfg.configId,
    revision: cfg.revision,
    questions: cfg.questions.map((q) => ({ ...q, id: q.questionId, configId: cfg.configId, revision: cfg.revision }))
  };
}

/**
 * GATE 1B.3-D2 items 2/4/9: the single shared resolver for session-level semantic settings
 * (title, description, allowMultipleResponses, anonymous, showResponderCount) — for rev>=1 these
 * live SOLELY in the current immutable configVersions document (root is frozen-at-activation and
 * never mirrored, per the frozen Gate 1B.3-C2 root-apply contract); for legacy and rev0 baseline,
 * root remains authoritative because no apply_config has touched these fields yet.
 */
export async function resolveRuntimeSettings(dbFacade, sessionPath, sessionData) {
  const cfg = await resolveInteractionConfig(dbFacade, sessionPath, sessionData);
  if (cfg.source === "contract-revision") {
    return {
      title: cfg.title, description: cfg.description,
      allowMultipleResponses: !!cfg.allowMultipleResponses, anonymous: !!cfg.anonymous, showResponderCount: !!cfg.showResponderCount
    };
  }
  return {
    title: cfg.title, description: cfg.description,
    allowMultipleResponses: !!sessionData.allowMultipleResponses,
    anonymous: sessionData.anonymous !== false,
    showResponderCount: sessionData.showResponderCount !== false
  };
}

/**
 * GATE 1B.3-D2 item 3: the MANDATORY reopen integrity guard. Must be called — and must resolve
 * successfully — before any Contract revision >=1 session transitions from CLOSED back to OPEN.
 * Legacy and rev0 sessions have no immutable manifest to verify and always pass trivially
 * (`skipped: true`). For rev>=1, re-reads the authoritative root and its current configVersions
 * document fresh (never trusting whatever the caller already had in memory), then re-proves,
 * for every declared question in that manifest: existence, sessionId, configId, revision, order,
 * every semantic field, and embedded options equality — exactly the same completeness proof
 * contract-writer.mjs's own verifyRevisionIntegrity() performs right after a commit, re-run here
 * on demand before a reopen. Also re-proves the config document's own structural integrity
 * (revision matches root's configRevision, roundId matches its own configId). Throws
 * ContractRuntimeError (never returns a partial/ambiguous failure) on any mismatch — the caller
 * MUST NOT proceed with the reopen write when this throws. Never attempts repair.
 */
export async function verifyReopenIntegrity({ db, firestore, sessionId }) {
  const { doc, getDoc } = firestore;
  const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
  if (!sessionSnap.exists()) {
    throw new ContractRuntimeError("SESSION_NOT_FOUND", "Phiên không còn tồn tại.");
  }
  const sessionData = sessionSnap.data();
  if (!isContractSession(sessionData) || Number(sessionData.configRevision || 0) < 1) {
    return { ok: true, skipped: true };
  }

  const configId = sessionData.currentConfigId;
  const configSnap = await getDoc(doc(db, "sessions", sessionId, "configVersions", configId));
  if (!configSnap.exists()) {
    throw new ContractRuntimeError(
      "REOPEN_INTEGRITY_FAILED",
      "Không tìm thấy cấu hình hiện hành của phiên bản hợp đồng. KHÔNG thể mở lại phiên cho đến khi vấn đề này được xác minh và xử lý. Phiên vẫn ở trạng thái ĐÃ ĐÓNG.",
      { reason: "CONFIG_MISSING", configId }
    );
  }
  const configData = configSnap.data();
  if (configData.revision !== sessionData.configRevision) {
    throw new ContractRuntimeError(
      "REOPEN_INTEGRITY_FAILED",
      "Cấu hình hiện hành của phiên không khớp phiên bản đã ghi nhận. KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.",
      { reason: "CONFIG_REVISION_MISMATCH", expected: sessionData.configRevision, actual: configData.revision }
    );
  }
  if (configData.roundId !== configId) {
    throw new ContractRuntimeError(
      "REOPEN_INTEGRITY_FAILED",
      "Cấu hình hiện hành của phiên có dữ liệu không nhất quán (roundId). KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.",
      { reason: "CONFIG_ROUND_MISMATCH", configId, roundId: configData.roundId }
    );
  }
  const expectedQuestions = Array.isArray(configData.questions) ? configData.questions : [];
  if (Number.isInteger(sessionData.questionCount) && expectedQuestions.length !== sessionData.questionCount) {
    throw new ContractRuntimeError(
      "REOPEN_INTEGRITY_FAILED",
      "Số câu hỏi trong cấu hình hiện hành không khớp với phiên. KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.",
      { reason: "QUESTION_COUNT_MISMATCH", expected: sessionData.questionCount, actual: expectedQuestions.length }
    );
  }

  for (const entry of expectedQuestions) {
    let snap;
    try {
      snap = await getDoc(doc(db, "questions", entry.questionId));
    } catch {
      throw new ContractRuntimeError(
        "REOPEN_INTEGRITY_FAILED",
        `Không tìm thấy câu hỏi "${entry.questionId}" của phiên bản hiện hành. KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.`,
        { reason: "MISSING", questionId: entry.questionId }
      );
    }
    if (!snap.exists()) {
      throw new ContractRuntimeError(
        "REOPEN_INTEGRITY_FAILED",
        `Không tìm thấy câu hỏi "${entry.questionId}" của phiên bản hiện hành. KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.`,
        { reason: "MISSING", questionId: entry.questionId }
      );
    }
    const d = snap.data();
    const matches = d.sessionId === sessionId && d.configId === configId && d.revision === configData.revision &&
      d.order === entry.order && d.type === entry.type && d.question === entry.question &&
      d.description === entry.description && d.required === entry.required && d.chartType === entry.chartType &&
      d.timeLimit === entry.timeLimit && d.allowChangeAnswer === entry.allowChangeAnswer &&
      d.scaleMin === entry.scaleMin && d.scaleMax === entry.scaleMax && stableEqual(d.options, entry.options);
    if (!matches) {
      throw new ContractRuntimeError(
        "REOPEN_INTEGRITY_FAILED",
        `Câu hỏi "${entry.questionId}" không khớp với cấu hình hiện hành. KHÔNG thể mở lại phiên. Phiên vẫn ở trạng thái ĐÃ ĐÓNG — vui lòng liên hệ hỗ trợ kỹ thuật.`,
        { reason: "MISMATCH", questionId: entry.questionId }
      );
    }
  }

  return { ok: true, skipped: false, verifiedCount: expectedQuestions.length };
}

/**
 * GATE 1B.3-D2R item A: the exact question-block resolution teacherReportView() uses, factored
 * out so it is directly testable against the real emulator/Rules rather than only reasoned
 * about. Deliberately includes EVERY question ever created for this session — legacy AND every
 * Contract revision's own question documents, which persist forever with a fresh, never-reused
 * ID per revision (Gate 1B.3-C1) — so each historical response stays grouped under the EXACT
 * document it was actually submitted against, never relabeled under a later revision's
 * semantics. `allResponses` is passed in (already fetched by the caller) rather than re-queried
 * here, so this function does no response-collection I/O of its own.
 */
export async function resolveReportQuestionBlocks(dbFacade, sessionId, ownerId, allResponses) {
  const qDocs = await dbFacade.listDocs("questions", { where: [["ownerId", "==", ownerId], ["sessionId", "==", sessionId]] });
  const questions = qDocs.map((d) => ({ id: d.id, ...d.data })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return Promise.all(questions.map(async (q, i) => {
    let options = [];
    if (isEmbeddedOptionsQuestion(q)) {
      options = q.options || [];
    } else {
      const optDocs = await dbFacade.listDocs(`questions/${q.id}/options`);
      options = optDocs.map((o) => ({ id: o.id, ...o.data })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    const docs = (allResponses || []).filter((r) => r.questionId === q.id);
    return { q, options, docs, idx: i };
  }));
}

/**
 * GATE 1B.3-D2R item B: the exact two-write live-aggregate publish teacherLiveControl's
 * watchResponses() performs on every response snapshot — factored out so the real write path
 * (through real Rules, not a rules-disabled shortcut) is directly testable. `showResponderCount`
 * must be the value resolveRuntimeSettings() resolved for the CURRENT revision — carrying it
 * here is what lets an anonymous student see the correct current value without ever needing to
 * read configVersions (see the module header). `liveAggregates/{questionId}` is a durable,
 * per-question record (not currently read back by any consumer — session.liveAggregate on the
 * root is the one surface student/Presentation code actually consumes); both are still written
 * together here to keep them from ever silently diverging if a future consumer starts reading
 * the subcollection.
 */
export async function writeLiveAggregate({ db, firestore, sessionId, ownerId, question, chartType, agg, respondedCount, openAnswers, showResponderCount, totalResponseCount }) {
  const { doc, setDoc, updateDoc, serverTimestamp, Timestamp } = firestore;
  const aggregatePayload = {
    questionId: question.id, sessionId, ownerId, chartType, agg, respondedCount,
    openAnswers: openAnswers ?? null, showResponderCount, updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "sessions", sessionId, "liveAggregates", question.id), aggregatePayload, { merge: true });
  await updateDoc(doc(db, "sessions", sessionId), {
    responseCount: totalResponseCount,
    updatedAt: serverTimestamp(),
    liveAggregate: {
      questionId: question.id, chartType, agg, respondedCount,
      openAnswers: openAnswers ?? null, showResponderCount, updatedAt: Timestamp.now()
    }
  });
}
