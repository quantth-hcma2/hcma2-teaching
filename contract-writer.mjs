// HCMA2 Teaching — Gate 1B.2B atomic contract writer.
// Foundation only: contract activation + a generic config-revision "apply" operation, for
// sessions / groupActivities / knowledgeSessions. No semantic editor UI is built on top of this
// in this gate (see docs/GATE-1B2-AUDIT-PLAN.md §16). Not wired into index.html's production
// UI — this module exists to be called from the emulator test harness (test/gate1b2b/) and, in
// a later, separately-approved gate, from a real editor.
//
// Every invariant this module relies on (revision monotonicity, sibling-document atomicity,
// stale-client lockout, append-only history, immutable versions) is ALSO enforced server-side
// by firestore.rules.production-candidate — this module's own checks are fail-fast client UX,
// not the security boundary.

import { validateManifestShape, utf8ByteLength, LIMITS } from "./session-reader.mjs";

export class ContractWriterError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ContractWriterError";
    this.code = code;
    this.details = details || null;
  }
}

const FAMILY_CONFIG = Object.freeze({
  sessions: {
    manifestFields: ["title", "description"],
    readerKind: "interaction",
    isSafeToActivate(data) {
      return data.status === "closed" && !data.deletedAt;
    }
  },
  groupActivities: {
    manifestFields: ["title", "instructions"],
    readerKind: "group",
    isSafeToActivate(data) {
      return data.status === "closed";
    }
  },
  knowledgeSessions: {
    manifestFields: ["title", "targetSubmissions", "minimumPerParticipant", "classOptions", "participantFields"],
    readerKind: "knowledge",
    isSafeToActivate(data) {
      return data.status === "closed" && !data.teacherDeletedAt && !data.adminDeletedAt;
    }
  }
});

function familyConfig(family) {
  const cfg = FAMILY_CONFIG[family];
  if (!cfg) throw new ContractWriterError("UNKNOWN_FAMILY", `Unknown session family: ${family}`);
  return cfg;
}

function pickManifest(data, fields) {
  const manifest = {};
  for (const f of fields) if (f in data) manifest[f] = data[f];
  return manifest;
}

// GATE 1B.3-C2R item B fix: the original single-level `JSON.stringify(x, Object.keys(x).sort())`
// trick only sorts TOP-level keys — for nested structures (an interaction manifest's questions
// array of objects, each with its own key set) JSON.stringify reapplies that SAME top-level key
// allowlist at every nested level too, silently dropping any nested key absent from the
// top-level object (which, in practice, is nearly all of them) before the two sides are ever
// compared. Confirmed empirically: two `legacyQuestions` arrays with genuinely different content
// serialized identically as `[{}]`. This canonicalizes recursively (sorted keys at every level,
// arrays compared element-by-element) so equality is real structural equality, not an artifact
// of which key names happen to coincide between a container and its own nested children.
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}
export function stableEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/**
 * Activates the versioned contract on a session that is currently legacy (no
 * editContractVersion field). Snapshots the family's Class-B ("Configuration") fields into a
 * new, immutable configVersions/{configId} doc (kind: activation_baseline, source:
 * legacy_snapshot, revision: 0, activatedFromLegacy: true — never the literal string
 * "legacy-v0", which stays reserved for session-reader.mjs's implicit, document-less node),
 * appends one editHistory/{operationId} entry, and sets the five root contract-metadata fields
 * — all inside one Firestore transaction. Idempotent: retrying with the same operationId
 * replays the prior result instead of re-mutating; retrying with the same operationId but a
 * payload that would produce a different snapshot throws OPERATION_ID_PAYLOAD_MISMATCH.
 */
export async function activateContract({ db, firestore, family, sessionId, actorUid, operationId }) {
  const cfg = familyConfig(family);
  const { doc, collection, runTransaction, serverTimestamp } = firestore;
  const sessionRef = doc(db, family, sessionId);
  const configRef = doc(collection(db, family, sessionId, "configVersions"));
  const historyRef = doc(db, family, sessionId, "editHistory", operationId);

  return runTransaction(db, async (tx) => {
    const historySnap = await tx.get(historyRef);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new ContractWriterError("NOT_FOUND", "Phiên không còn tồn tại.");
    const data = sessionSnap.data();
    const intendedManifest = pickManifest(data, cfg.manifestFields);

    if (historySnap.exists()) {
      const prior = historySnap.data();
      if (prior.operationType !== "activate_contract") {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "operationId đã dùng cho một loại thao tác khác.");
      }
      const priorConfigSnap = await tx.get(doc(db, family, sessionId, "configVersions", prior.resultingConfigId));
      const priorManifest = priorConfigSnap.exists() ? pickManifest(priorConfigSnap.data(), cfg.manifestFields) : null;
      if (!stableEqual(priorManifest, intendedManifest)) {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "Dữ liệu phiên đã đổi khác so với lần thử trước với cùng operationId.");
      }
      return { replay: true, resultingRevision: prior.resultingRevision, resultingConfigId: prior.resultingConfigId };
    }

    if ("configRevision" in data) throw new ContractWriterError("ALREADY_ACTIVATED", "Phiên đã kích hoạt hợp đồng từ trước.");
    if (!cfg.isSafeToActivate(data)) throw new ContractWriterError("LIFECYCLE_NOT_SAFE", "Phiên phải ở trạng thái CLOSED (và chưa vào thùng rác) mới được kích hoạt.");

    const now = serverTimestamp();
    tx.set(configRef, {
      revision: 0, parentConfigId: null, kind: "activation_baseline", source: "legacy_snapshot",
      createdAt: now, createdBy: actorUid, activatedFromLegacy: true, active: true, ...intendedManifest
    });
    tx.set(historyRef, {
      operationId, actorUid, operationType: "activate_contract",
      baseRevision: null, resultingRevision: 0, previousConfigId: null, resultingConfigId: configRef.id,
      changedFields: Object.keys(intendedManifest), createdAt: now,
      lifecycleBefore: data.status, lifecycleAfter: data.status
    });
    tx.update(sessionRef, {
      editContractVersion: 1, configRevision: 0, currentConfigId: configRef.id,
      lastOperationId: operationId, contractActivatedAt: now, updatedAt: now
    });
    return { replay: false, resultingRevision: 0, resultingConfigId: configRef.id };
  });
}

/**
 * Generic config-revision "apply" foundation — groupActivities / knowledgeSessions only (no
 * semantic editor UI calls this yet). Only valid on an already-activated, CLOSED session. Bumps
 * configRevision by exactly 1, creating a new immutable configVersions doc whose parentConfigId
 * is the previous currentConfigId. GATE 1B.3-C2: sessions/Interaction no longer uses this path
 * at all — see applyInteractionRevision() below — because the frozen Gate 1B.3-C1R/C1X Rules
 * now require every real sessions apply_config to carry the complete Interaction manifest
 * shape (kind, roundId, questions[], etc.); this generic title/description-only shape can no
 * longer satisfy that family's Rules and would always be denied.
 */
async function applyGenericConfigRevision({ db, firestore, family, sessionId, actorUid, operationId, expectedRevision, changes }) {
  const cfg = familyConfig(family);
  const { doc, collection, runTransaction, serverTimestamp } = firestore;
  const sessionRef = doc(db, family, sessionId);
  const newConfigRef = doc(collection(db, family, sessionId, "configVersions"));
  const historyRef = doc(db, family, sessionId, "editHistory", operationId);

  const invalidField = Object.keys(changes || {}).find((k) => !cfg.manifestFields.includes(k));
  if (invalidField) throw new ContractWriterError("FIELD_NOT_ALLOWED", `Field không thuộc manifest: ${invalidField}`);

  return runTransaction(db, async (tx) => {
    const historySnap = await tx.get(historyRef);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new ContractWriterError("NOT_FOUND", "Phiên không còn tồn tại.");
    const data = sessionSnap.data();
    if (!("configRevision" in data)) throw new ContractWriterError("NOT_ACTIVATED", "Phiên chưa kích hoạt hợp đồng.");

    const currentConfigSnap = await tx.get(doc(db, family, sessionId, "configVersions", data.currentConfigId));
    if (!currentConfigSnap.exists()) throw new ContractWriterError("MANIFEST_INVALID", "Không tìm thấy cấu hình hiện hành.");
    const currentManifest = pickManifest(currentConfigSnap.data(), cfg.manifestFields);
    const intendedManifest = { ...currentManifest, ...changes };

    if (historySnap.exists()) {
      const prior = historySnap.data();
      if (prior.operationType !== "apply_config") {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "operationId đã dùng cho một loại thao tác khác.");
      }
      const priorConfigSnap = await tx.get(doc(db, family, sessionId, "configVersions", prior.resultingConfigId));
      const priorManifest = priorConfigSnap.exists() ? pickManifest(priorConfigSnap.data(), cfg.manifestFields) : null;
      if (!stableEqual(priorManifest, intendedManifest)) {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "Nội dung thay đổi khác với lần thử trước cùng operationId.");
      }
      return { replay: true, resultingRevision: prior.resultingRevision, resultingConfigId: prior.resultingConfigId };
    }

    if (data.status !== "closed") throw new ContractWriterError("LIFECYCLE_NOT_SAFE", "Phiên phải CLOSED mới được Apply cấu hình.");
    if (data.configRevision !== expectedRevision) throw new ContractWriterError("STALE_REVISION", "Cấu hình đã bị thay đổi ở nơi khác. Hãy tải lại.");

    const shape = validateManifestShape({ kind: cfg.readerKind, ...intendedManifest }, cfg.readerKind);
    if (!shape.ok) throw new ContractWriterError("MANIFEST_INVALID", "Cấu hình mới không hợp lệ.", shape);

    const now = serverTimestamp();
    const nextRevision = expectedRevision + 1;
    tx.set(newConfigRef, {
      revision: nextRevision, parentConfigId: data.currentConfigId, kind: cfg.readerKind, source: "apply_config",
      createdAt: now, createdBy: actorUid, active: true, ...intendedManifest
    });
    tx.set(historyRef, {
      operationId, actorUid, operationType: "apply_config",
      baseRevision: expectedRevision, resultingRevision: nextRevision,
      previousConfigId: data.currentConfigId, resultingConfigId: newConfigRef.id,
      changedFields: Object.keys(changes || {}), createdAt: now,
      lifecycleBefore: data.status, lifecycleAfter: data.status
    });
    tx.update(sessionRef, {
      configRevision: nextRevision, currentConfigId: newConfigRef.id, lastOperationId: operationId, updatedAt: now
    });
    return { replay: false, resultingRevision: nextRevision, resultingConfigId: newConfigRef.id };
  });
}

// =====================================================================================
// GATE 1B.3-C2 — full Interaction (sessions) revision writer
// =====================================================================================

// Frozen to match index.html's own QUESTION_TYPES keys exactly (single, multiple, truefalse,
// likert, scale, ranking, open) — not redefined or renamed here, just referenced as the
// writer's own allowlist so a malformed/unknown type fails closed with a typed error instead
// of silently being written into an immutable manifest.
const INTERACTION_QUESTION_TYPES = Object.freeze(["single", "multiple", "truefalse", "likert", "scale", "ranking", "open"]);
const NEEDS_OPTIONS_TYPES = Object.freeze(["single", "multiple", "truefalse", "likert", "ranking"]);

function buildOption(raw, order) {
  return {
    id: `o${order}`,
    label: raw && raw.label != null ? String(raw.label) : "",
    text: raw && raw.text != null ? String(raw.text) : "",
    order,
    value: raw && raw.value !== undefined ? raw.value : null,
    isCorrect: raw && raw.isCorrect !== undefined ? raw.isCorrect : null
  };
}

// Builds one manifest question entry (and its embedded options) from author-supplied semantic
// content only. `configId`/`order` (the array position) are the writer's own trusted inputs —
// any `questionId`/`roundId`/`id`/`order` field the caller may have placed on `raw` (whether
// carried over from a prior revision's stored entry, or injected by a stale/malicious client)
// is never read here, so it is structurally impossible for a caller to make this function
// reuse or forge an identifier: the deterministic {configId}_q{order} / o{order} shape is the
// ONLY identity this function ever produces.
function buildQuestionManifestEntry(configId, order, raw) {
  if (!raw || typeof raw !== "object") {
    throw new ContractWriterError("QUESTION_INVALID", `Câu hỏi ở vị trí ${order} không hợp lệ.`, { order });
  }
  if (!INTERACTION_QUESTION_TYPES.includes(raw.type)) {
    throw new ContractWriterError("INVALID_QUESTION_TYPE", `Loại câu hỏi không hợp lệ ở vị trí ${order}.`, { order, type: raw.type });
  }
  if (typeof raw.question !== "string" || raw.question.trim().length === 0) {
    throw new ContractWriterError("QUESTION_INVALID", `Câu hỏi ở vị trí ${order} thiếu nội dung.`, { order });
  }
  if (typeof raw.chartType !== "string" || raw.chartType.trim().length === 0) {
    throw new ContractWriterError("QUESTION_INVALID", `Câu hỏi ở vị trí ${order} thiếu chartType.`, { order });
  }
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  if (rawOptions.length > LIMITS.maxOptionsPerQuestion) {
    throw new ContractWriterError("TOO_MANY_OPTIONS", `Câu hỏi ở vị trí ${order} vượt quá ${LIMITS.maxOptionsPerQuestion} phương án.`, { order, count: rawOptions.length });
  }
  if (NEEDS_OPTIONS_TYPES.includes(raw.type) && rawOptions.length < 1) {
    throw new ContractWriterError("QUESTION_INVALID", `Câu hỏi loại "${raw.type}" ở vị trí ${order} cần ít nhất một phương án.`, { order, type: raw.type });
  }
  let scaleMin = null, scaleMax = null;
  if (raw.type === "scale") {
    scaleMin = Number(raw.scaleMin);
    scaleMax = Number(raw.scaleMax);
    if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax) || scaleMin >= scaleMax) {
      throw new ContractWriterError("INVALID_SCALE_BOUNDS", `Khoảng thang điểm không hợp lệ ở vị trí ${order}.`, { order, scaleMin: raw.scaleMin, scaleMax: raw.scaleMax });
    }
  }
  return {
    questionId: `${configId}_q${order}`, roundId: configId, order,
    type: raw.type, question: String(raw.question),
    description: raw.description != null ? String(raw.description) : "",
    required: raw.required !== false,
    chartType: raw.chartType,
    timeLimit: Number.isInteger(raw.timeLimit) ? raw.timeLimit : 0,
    allowChangeAnswer: !!raw.allowChangeAnswer,
    scaleMin, scaleMax,
    options: rawOptions.map((o, i) => buildOption(o, i))
  };
}

// Resolves the intended full Interaction manifest body for this revision: any field the caller
// omits from `changes` is carried forward from the CURRENT manifest (title/description/
// behavioral settings) — including `questions`, which, when omitted, is rebuilt from the
// current revision's own semantic content (never its questionId/roundId — buildQuestionManifestEntry
// ignores those) so a "title-only" or "timeLimit-only" revision still produces an entirely
// fresh set of question identities, per the frozen Gate 1B.3-C1 reorder/immutability contract:
// every revision's questions are new documents, never a reuse of the prior revision's IDs, even
// when the semantic content is byte-identical. A revision-0 (activation_baseline) parent has no
// prior questions at all — never fabricated, carried forward as an empty array.
export function buildInteractionManifest({ configId, actorUid, currentConfigData, changes }) {
  const isBaseline = currentConfigData.kind === "activation_baseline";
  const prevQuestions = isBaseline ? [] : (Array.isArray(currentConfigData.questions) ? currentConfigData.questions : []);
  const rawQuestions = "questions" in changes ? changes.questions : prevQuestions;
  if (!Array.isArray(rawQuestions)) throw new ContractWriterError("QUESTION_INVALID", "questions phải là một mảng.");
  if (rawQuestions.length > LIMITS.maxQuestionsPerRound) {
    throw new ContractWriterError("TOO_MANY_QUESTIONS", `Vượt quá ${LIMITS.maxQuestionsPerRound} câu hỏi.`, { count: rawQuestions.length });
  }
  const questions = rawQuestions.map((q, i) => buildQuestionManifestEntry(configId, i, q));
  return {
    roundId: configId, kind: "interaction", source: "apply_config", createdBy: actorUid, active: true,
    title: "title" in changes ? (changes.title != null ? String(changes.title) : "") : (currentConfigData.title ?? ""),
    description: "description" in changes ? (changes.description != null ? String(changes.description) : "") : (currentConfigData.description ?? ""),
    allowMultipleResponses: "allowMultipleResponses" in changes ? !!changes.allowMultipleResponses : !!currentConfigData.allowMultipleResponses,
    anonymous: "anonymous" in changes ? !!changes.anonymous : !!currentConfigData.anonymous,
    showResponderCount: "showResponderCount" in changes ? !!changes.showResponderCount : !!currentConfigData.showResponderCount,
    questions
  };
}

// Strips the writer-generated identity fields (configId/questionId/roundId and the write-time
// bookkeeping fields parentConfigId/createdAt/createdBy/active/source/kind) before comparing
// two manifests for idempotent-retry equality — a genuine caller-level retry regenerates a
// fresh configId (and therefore fresh questionId/roundId) on every call attempt by design, so
// comparing those would make every retry look like a mismatch even when the semantic authoring
// content is byte-identical.
export function semanticManifestForCompare(manifest) {
  const { questions, roundId, parentConfigId, createdAt, createdBy, active, source, kind, revision, ...rest } = manifest || {};
  return {
    ...rest,
    questions: (Array.isArray(questions) ? questions : []).map((q) => {
      const { questionId, roundId: qRoundId, ...keep } = q || {};
      return keep;
    })
  };
}

function buildLegacySnapshotPayload({ parentConfigId, operationId, legacyQuestions }) {
  const list = Array.isArray(legacyQuestions) ? legacyQuestions : null;
  if (!list) {
    throw new ContractWriterError("LEGACY_SNAPSHOT_REQUIRED", "Cần cung cấp danh sách câu hỏi cũ đã xác nhận (legacyQuestions) cho lần chuyển đổi đầu tiên.");
  }
  if (list.length > LIMITS.maxQuestionsPerRound) {
    throw new ContractWriterError("LEGACY_TOO_MANY_QUESTIONS", `Số câu hỏi cũ vượt quá ${LIMITS.maxQuestionsPerRound}.`, { count: list.length });
  }
  for (const q of list) {
    const optCount = Array.isArray(q && q.options) ? q.options.length : 0;
    if (optCount > LIMITS.maxOptionsPerQuestion) {
      throw new ContractWriterError("LEGACY_TOO_MANY_OPTIONS", `Câu hỏi cũ "${q && q.questionId}" có quá nhiều phương án.`, { questionId: q && q.questionId, count: optCount });
    }
  }
  const snapshot = {
    kind: "legacy_transition_snapshot", basis: "editor_confirmed",
    capturedDuringOperationId: operationId, parentConfigId, legacyQuestions: list
  };
  const size = utf8ByteLength(snapshot);
  if (size > LIMITS.manifestBytes) {
    throw new ContractWriterError("SNAPSHOT_TOO_LARGE", "Ảnh chụp cấu hình cũ vượt quá giới hạn kích thước.", { bytes: size, limit: LIMITS.manifestBytes });
  }
  return snapshot;
}

/**
 * Extends applyConfigRevision() for the sessions/Interaction family (GATE 1B.3-C2): writes the
 * frozen full revision >=1 manifest, generating every trusted version identifier itself
 * (configId, revision, roundId, deterministic {configId}_q{order} question IDs, deterministic
 * o{order} embedded option IDs) — a caller can supply semantic authoring data in `changes`
 * (title, description, allowMultipleResponses, anonymous, showResponderCount, questions[],
 * and, on the first transition only, legacyQuestions[]) but can never inject any authoritative
 * identifier; any questionId/configId/roundId/id present on caller input is simply never read.
 * On the very first semantic revision (when the session's current config is still the
 * activation_baseline), also atomically creates the one-time legacyTransitionSnapshot/snapshot
 * compatibility bridge from the caller-supplied, editor-confirmed legacyQuestions payload —
 * never a fresh, commit-time re-read of live legacy data (no freshness claim beyond what the
 * editor actually confirmed). All of this — configVersions create, editHistory create, the
 * legacyTransitionSnapshot create (first transition only), the session-root reset update, and
 * one questions/{questionId} create per manifest question — happens in ONE Firestore
 * transaction, exactly the shape firestore.rules.production-candidate proves atomically.
 */
export async function applyInteractionRevision({ db, firestore, sessionId, actorUid, operationId, expectedRevision, changes }) {
  const cfg = familyConfig("sessions");
  const { doc, collection, runTransaction, serverTimestamp, getDoc } = firestore;
  const family = "sessions";
  const sessionRef = doc(db, family, sessionId);
  const newConfigRef = doc(collection(db, family, sessionId, "configVersions"));
  const historyRef = doc(db, family, sessionId, "editHistory", operationId);
  const snapshotRef = doc(db, family, sessionId, "legacyTransitionSnapshot", "snapshot");
  const configId = newConfigRef.id;
  const intendedChanges = changes || {};

  const result = await runTransaction(db, async (tx) => {
    const historySnap = await tx.get(historyRef);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new ContractWriterError("NOT_FOUND", "Phiên không còn tồn tại.");
    const data = sessionSnap.data();
    if (!("configRevision" in data)) throw new ContractWriterError("NOT_ACTIVATED", "Phiên chưa kích hoạt hợp đồng.");

    const currentConfigSnap = await tx.get(doc(db, family, sessionId, "configVersions", data.currentConfigId));
    if (!currentConfigSnap.exists()) throw new ContractWriterError("MANIFEST_INVALID", "Không tìm thấy cấu hình hiện hành.");
    const currentConfigData = currentConfigSnap.data();
    const isFirstTransition = currentConfigData.kind === "activation_baseline";

    // Deferred until AFTER the replay/lifecycle/stale-revision gates below (mirroring
    // applyGenericConfigRevision()'s ordering exactly): building+validating the full manifest
    // (and, on a first transition, the legacy snapshot) can throw on malformed caller input, and
    // must not preempt LIFECYCLE_NOT_SAFE / STALE_REVISION for a request that was always going
    // to be rejected on those grounds regardless of payload shape.
    //
    // `treatAsFirstTransition` is an explicit parameter, NOT always the outer `isFirstTransition`
    // closure value — GATE 1B.3-C2R item B fix: on a REPLAY, the session's CURRENT config has
    // already moved past activation_baseline (the original commit did that), so recomputing
    // "was this a first transition" from currentConfigData at retry time would always say NO,
    // silently skipping the legacy-snapshot-payload comparison below even when the retry
    // resupplies different legacyQuestions. Whether a given operationId's own result WAS a first
    // transition is a fact about that operationId (prior.baseRevision === 0), not about the
    // session's present-day state — the replay branch passes that fact in explicitly instead.
    function buildForThisAttempt(treatAsFirstTransition) {
      const manifestBody = buildInteractionManifest({ configId, actorUid, currentConfigData, changes: intendedChanges });
      const shape = validateManifestShape({ kind: "interaction", ...manifestBody }, "interaction");
      if (!shape.ok) throw new ContractWriterError("MANIFEST_INVALID", "Cấu hình mới không hợp lệ.", shape);
      let snapshotBody = null;
      if (treatAsFirstTransition) {
        snapshotBody = buildLegacySnapshotPayload({
          parentConfigId: data.currentConfigId, operationId, legacyQuestions: intendedChanges.legacyQuestions
        });
      }
      return { manifestBody, snapshotBody };
    }

    if (historySnap.exists()) {
      const prior = historySnap.data();
      if (prior.operationType !== "apply_config") {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "operationId đã dùng cho một loại thao tác khác.");
      }
      const priorWasFirstTransition = prior.baseRevision === 0;
      const { manifestBody, snapshotBody } = buildForThisAttempt(priorWasFirstTransition);
      const priorConfigSnap = await tx.get(doc(db, family, sessionId, "configVersions", prior.resultingConfigId));
      const priorConfigData = priorConfigSnap.exists() ? priorConfigSnap.data() : null;
      let configMatches = !!priorConfigData &&
        stableEqual(semanticManifestForCompare(priorConfigData), semanticManifestForCompare(manifestBody));
      if (configMatches && priorWasFirstTransition) {
        const priorSnapSnap = await tx.get(snapshotRef);
        const priorLegacyQuestions = priorSnapSnap.exists() ? priorSnapSnap.data().legacyQuestions : null;
        configMatches = !!snapshotBody && stableEqual(priorLegacyQuestions, snapshotBody.legacyQuestions);
      }
      if (!configMatches) {
        throw new ContractWriterError("OPERATION_ID_PAYLOAD_MISMATCH", "Nội dung thay đổi khác với lần thử trước cùng operationId.");
      }
      // GATE 1B.3-C2R item A: `manifestBody.questions` was built against THIS call's own
      // freshly-generated (never persisted) configId — using it here would ask the post-commit
      // verification pass below to look for questions at the wrong path. The ACTUAL committed
      // question identities live in priorConfigData.questions (the real, already-written
      // manifest this operationId produced) — that is what must be re-verified on a replay.
      return { replay: true, resultingRevision: prior.resultingRevision, resultingConfigId: prior.resultingConfigId, resultingQuestions: priorConfigData.questions, isFirstTransition: priorWasFirstTransition };
    }

    if (data.status !== "closed") throw new ContractWriterError("LIFECYCLE_NOT_SAFE", "Phiên phải CLOSED mới được Apply cấu hình.");
    if (data.configRevision !== expectedRevision) throw new ContractWriterError("STALE_REVISION", "Cấu hình đã bị thay đổi ở nơi khác. Hãy tải lại.");

    const { manifestBody, snapshotBody } = buildForThisAttempt(isFirstTransition);
    const now = serverTimestamp();
    const nextRevision = expectedRevision + 1;
    tx.set(newConfigRef, { ...manifestBody, revision: nextRevision, parentConfigId: data.currentConfigId, createdAt: now });
    tx.set(historyRef, {
      operationId, actorUid, operationType: "apply_config",
      baseRevision: expectedRevision, resultingRevision: nextRevision,
      previousConfigId: data.currentConfigId, resultingConfigId: configId,
      changedFields: Object.keys(intendedChanges), createdAt: now,
      lifecycleBefore: data.status, lifecycleAfter: data.status
    });
    if (isFirstTransition) {
      tx.set(snapshotRef, { ...snapshotBody, appliedAt: now });
    }
    tx.update(sessionRef, {
      configRevision: nextRevision, currentConfigId: configId, lastOperationId: operationId, updatedAt: now,
      questionCount: manifestBody.questions.length, activeQuestionId: null, activeQuestionStartedAt: null,
      responseCount: 0, liveAggregate: null
    });
    for (const entry of manifestBody.questions) {
      tx.set(doc(db, "questions", entry.questionId), {
        sessionId, ownerId: data.ownerId, configId, revision: nextRevision, order: entry.order,
        type: entry.type, question: entry.question, description: entry.description,
        required: entry.required, chartType: entry.chartType, timeLimit: entry.timeLimit,
        allowChangeAnswer: entry.allowChangeAnswer, scaleMin: entry.scaleMin, scaleMax: entry.scaleMax,
        options: entry.options, createdAt: now, createdBy: actorUid
      });
    }
    return { replay: false, resultingRevision: nextRevision, resultingConfigId: configId, resultingQuestions: manifestBody.questions, isFirstTransition };
  });

  // GATE 1B.3-C2 item 8 / GATE 1B.3-C2R item A: post-commit completeness verification lives in
  // the writer, not duplicated in a future UI — and it must run on EVERY successful return,
  // replay included. A prior revision's operational question documents are ordinary mutable-
  // by-nobody-but-Rules Firestore documents; nothing prevents out-of-band tampering (or a
  // reused emulator/test fixture) between the original commit and a later idempotent retry, so
  // "already verified once, when it was first written" is not a standing guarantee a caller can
  // rely on at replay time. A replay must re-earn the same completeness proof a fresh write
  // does before it is allowed to report success.
  await verifyRevisionIntegrity({
    db, firestore, sessionId, configId: result.resultingConfigId, revision: result.resultingRevision,
    expectedQuestions: result.resultingQuestions
  });
  return result;
}

/**
 * GATE 1B.3-C2 item 8: authoritatively re-reads every operational questions/{questionId}
 * document a just-committed (or previously-committed) revision was supposed to produce, by its
 * deterministic ID, and proves existence + exact field/option equality against the manifest
 * entry that was supposed to produce it. Exported standalone (not just called internally by
 * applyInteractionRevision) so it can also be invoked directly — e.g. against a session whose
 * committed state was tampered with out-of-band — without needing to perform a whole new
 * transaction just to re-check integrity. Never attempts any repair: on failure it only ever
 * throws REVISION_INTEGRITY_VERIFICATION_FAILED; the session and its documents are left exactly
 * as found.
 */
export async function verifyRevisionIntegrity({ db, firestore, sessionId, configId, revision, expectedQuestions }) {
  const { doc, getDoc } = firestore;
  for (const entry of (expectedQuestions || [])) {
    // A Contract question's own read rule is conditioned on resource.data (owner match), which
    // Firestore Rules cannot evaluate at all against a document that doesn't exist — a getDoc()
    // for a genuinely-missing document therefore surfaces as a raw permission-denied error, not
    // a clean "not found" snapshot. From this authoritative verification's point of view, a
    // question that is missing and one that is inaccessible are the same failure, so both are
    // treated as MISSING here rather than letting the raw Firebase error escape uninterpreted.
    let snap;
    try {
      snap = await getDoc(doc(db, "questions", entry.questionId));
    } catch {
      throw new ContractWriterError("REVISION_INTEGRITY_VERIFICATION_FAILED", `Không tìm thấy câu hỏi ${entry.questionId} sau khi ghi.`, { questionId: entry.questionId, reason: "MISSING" });
    }
    if (!snap.exists()) {
      throw new ContractWriterError("REVISION_INTEGRITY_VERIFICATION_FAILED", `Không tìm thấy câu hỏi ${entry.questionId} sau khi ghi.`, { questionId: entry.questionId, reason: "MISSING" });
    }
    const d = snap.data();
    const matches = d.sessionId === sessionId && d.configId === configId && d.revision === revision && d.order === entry.order &&
      d.type === entry.type && d.question === entry.question && d.description === entry.description &&
      d.required === entry.required && d.chartType === entry.chartType && d.timeLimit === entry.timeLimit &&
      d.allowChangeAnswer === entry.allowChangeAnswer && d.scaleMin === entry.scaleMin && d.scaleMax === entry.scaleMax &&
      stableEqual(d.options, entry.options);
    if (!matches) {
      throw new ContractWriterError("REVISION_INTEGRITY_VERIFICATION_FAILED", `Câu hỏi ${entry.questionId} không khớp với manifest sau khi ghi.`, { questionId: entry.questionId, reason: "MISMATCH" });
    }
  }
}

export async function applyConfigRevision(params) {
  if (params.family === "sessions") return applyInteractionRevision(params);
  return applyGenericConfigRevision(params);
}

export { FAMILY_CONFIG, LIMITS };
