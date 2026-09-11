// HCMA2 Teaching — Gate 1B.1 reader adapter.
// Pure read only. No Firestore writes anywhere in this file. No side effects, no AI calls.
// See docs/READER-CONTRACT.md for the schema this module implements.
//
// This module talks to Firestore through a small injected "db facade" so it can be exercised
// with synthetic fixtures (no emulator) as well as with a real Firestore instance. See
// makeFirestoreDbFacade() at the bottom for the real-Firestore wiring used by index.html.

export const CONTRACT_VERSION = 1;

export const LIMITS = Object.freeze({
  manifestBytes: 65536,
  maxAncestry: 100,
  maxQuestionsPerRound: 100,
  maxOptionsPerQuestion: 20,
  minActiveGroups: 2,
  maxActiveGroups: 12,
  maxTaskEntries: 200,
  maxClassNames: 200,
  maxClassNameLength: 40,
  minPerParticipant: 1,
  maxPerParticipant: 20
});

export const PII_FIELDS = Object.freeze(["fullName", "className", "email", "phone"]);

export class ReaderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReaderError";
    this.code = code;
    this.details = details || null;
  }
}

/** True iff the session document carries any part of the Gate 1B contract marker. */
export function isContractSession(sessionData) {
  return !!sessionData && sessionData.editContractVersion !== undefined && sessionData.editContractVersion !== null;
}

/**
 * Gate 1A's legacy editor (`openSessionInfoEditor` / `checkSessionInfoAccess` in index.html)
 * only ever knows how to blind-write the narrow SESSION_INFO_FIELDS allowlist onto the
 * session root. That is correct for legacy sessions and unsafe for a contract session (it
 * would diverge from the active manifest without going through editHistory). Existing
 * writers must call this and let it throw before doing anything.
 */
export function assertLegacyWritable(sessionData) {
  if (isContractSession(sessionData)) {
    throw new ReaderError(
      "CONTRACT_SESSION_NOT_WRITABLE",
      "Phiên này đã dùng cấu hình phiên bản mới; trình sửa hiện tại chưa hỗ trợ. Vui lòng chờ Gate tiếp theo."
    );
  }
}

/** Normalizes the many legacy trash/status flags into one state string. Read-only, no writes. */
export function effectiveLifecycleState(sessionData) {
  if (!sessionData) return "unknown";
  if (sessionData.adminDeletedAt || sessionData.adminDeleting) return "admin_trashed";
  if (sessionData.teacherDeletedAt) return "teacher_trashed";
  if (sessionData.deletedAt) return "trashed";
  return sessionData.status || "unknown";
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function isNonEmptyString(v, maxLen) {
  return typeof v === "string" && v.trim().length > 0 && (maxLen == null || v.length <= maxLen);
}

/**
 * Structural + limit validation for one manifest (configVersions doc). Does not touch
 * ancestry. Returns { ok:true } or { ok:false, reason, detail }.
 */
export function validateManifestShape(manifest, kind) {
  if (!manifest || typeof manifest !== "object") return { ok: false, reason: "MANIFEST_MISSING" };
  // GATE 1B.2B: an activation-baseline manifest carries kind:"activation_baseline" (locked by
  // the Gate 1B.2B contract-writer design, see contract-writer.mjs) — this is orthogonal to,
  // not a family-shape mismatch against, the interaction/group/knowledge `kind` parameter this
  // function otherwise checks. Only a manifest that claims to BE one of the three known family
  // shapes but doesn't match the requested one is a real KIND_MISMATCH.
  if (manifest.kind && kind && manifest.kind !== kind && manifest.kind !== "activation_baseline") {
    return { ok: false, reason: "KIND_MISMATCH", detail: { expected: kind, actual: manifest.kind } };
  }
  const size = utf8ByteLength(manifest);
  if (size > LIMITS.manifestBytes) return { ok: false, reason: "MANIFEST_TOO_LARGE", detail: { bytes: size, limit: LIMITS.manifestBytes } };

  if (kind === "interaction") {
    const questions = Array.isArray(manifest.questions) ? manifest.questions : [];
    if (questions.length > LIMITS.maxQuestionsPerRound) return { ok: false, reason: "TOO_MANY_QUESTIONS", detail: { count: questions.length } };
    for (const q of questions) {
      if (!isNonEmptyString(q.questionId)) return { ok: false, reason: "QUESTION_ID_MISSING" };
      if (q.roundId !== manifest.roundId) return { ok: false, reason: "ROUND_ID_MISMATCH", detail: { questionId: q.questionId } };
      const options = Array.isArray(q.options) ? q.options : [];
      if (options.length > LIMITS.maxOptionsPerQuestion) return { ok: false, reason: "TOO_MANY_OPTIONS", detail: { questionId: q.questionId, count: options.length } };
    }
  } else if (kind === "group") {
    const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
    if (tasks.length > LIMITS.maxTaskEntries) return { ok: false, reason: "TOO_MANY_TASKS", detail: { count: tasks.length } };
    if (Number.isInteger(manifest.groupCount)) {
      if (manifest.groupCount < LIMITS.minActiveGroups || manifest.groupCount > LIMITS.maxActiveGroups)
        return { ok: false, reason: "GROUP_COUNT_OUT_OF_RANGE", detail: { groupCount: manifest.groupCount } };
      for (const t of tasks) {
        if (!Number.isInteger(t.group) || t.group < 1 || t.group > manifest.groupCount)
          return { ok: false, reason: "TASK_GROUP_OUT_OF_RANGE", detail: { group: t.group } };
      }
    }
  } else if (kind === "knowledge") {
    const classOptions = Array.isArray(manifest.classOptions) ? manifest.classOptions : [];
    if (classOptions.length > LIMITS.maxClassNames) return { ok: false, reason: "TOO_MANY_CLASSES", detail: { count: classOptions.length } };
    for (const name of classOptions) {
      if (!isNonEmptyString(name, LIMITS.maxClassNameLength)) return { ok: false, reason: "CLASS_NAME_INVALID", detail: { name } };
    }
    if (manifest.minimumPerParticipant != null) {
      if (!Number.isInteger(manifest.minimumPerParticipant) ||
          manifest.minimumPerParticipant < LIMITS.minPerParticipant ||
          manifest.minimumPerParticipant > LIMITS.maxPerParticipant)
        return { ok: false, reason: "MINIMUM_PER_PARTICIPANT_OUT_OF_RANGE", detail: { value: manifest.minimumPerParticipant } };
    }
  }
  return { ok: true };
}

/**
 * Walks parentConfigId from currentConfigId up to the implicit "legacy-v0" root.
 * Detects cycles and depth overflow. Never trusts a manifest that is not `active` boolean-
 * present-and-truthy for the *current* node only (ancestors do not need active:true — they are
 * historical by definition); a manifest missing entirely, or not belonging to this session's
 * kind, breaks the chain (BROKEN_ANCESTRY).
 */
export async function loadConfigAncestry(dbFacade, sessionPath, currentConfigId, kind) {
  const chain = [];
  const visited = new Set();
  let cursor = currentConfigId;
  while (cursor) {
    if (visited.has(cursor)) throw new ReaderError("ANCESTRY_CYCLE", "Chuỗi cấu hình bị lặp vòng.", { at: cursor });
    if (chain.length >= LIMITS.maxAncestry) throw new ReaderError("ANCESTRY_TOO_DEEP", "Chuỗi cấu hình vượt quá giới hạn.", { limit: LIMITS.maxAncestry });
    visited.add(cursor);
    const snap = await dbFacade.getDoc(`${sessionPath}/configVersions/${cursor}`);
    if (!snap.exists) throw new ReaderError("BROKEN_ANCESTRY", "Không tìm thấy cấu hình trong chuỗi.", { missing: cursor });
    const data = snap.data;
    const shape = validateManifestShape(data, kind);
    if (!shape.ok) throw new ReaderError("MANIFEST_INVALID", "Cấu hình không hợp lệ.", { configId: cursor, ...shape });
    chain.push({ configId: cursor, ...data });
    cursor = data.parentConfigId || null;
  }
  // Root-most ancestor descends from the implicit legacy-v0 baseline.
  chain.push({ configId: "legacy-v0", implicit: true });
  return chain;
}

/**
 * Resolves the effective configuration for a session: for legacy sessions this is a synthetic
 * legacy-v0 node built from the session doc itself (no Firestore read beyond what the caller
 * already has); for contract sessions this loads+validates `currentConfigId` and confirms it
 * is the doc actually marked `active`.
 *
 * Throws ReaderError (fail closed) rather than ever silently falling back to legacy rendering
 * for a session that *has* a contract marker.
 */
export async function resolveEffectiveConfig(dbFacade, sessionPath, sessionData, kind) {
  if (!isContractSession(sessionData)) {
    return { legacy: true, configId: "legacy-v0", ancestry: [{ configId: "legacy-v0", implicit: true }] };
  }
  if (sessionData.editContractVersion !== CONTRACT_VERSION) {
    throw new ReaderError("UNSUPPORTED_CONTRACT", "Phiên bản hợp đồng chưa được hỗ trợ.", { editContractVersion: sessionData.editContractVersion });
  }
  const configId = sessionData.currentConfigId;
  if (!isNonEmptyString(configId)) {
    throw new ReaderError("UNSUPPORTED_CONTRACT", "Thiếu currentConfigId trên phiên đã kích hoạt hợp đồng.");
  }
  const snap = await dbFacade.getDoc(`${sessionPath}/configVersions/${configId}`);
  if (!snap.exists) throw new ReaderError("MANIFEST_INVALID", "Không tìm thấy cấu hình hiện hành.", { configId });
  const data = snap.data;
  if (data.active !== true) throw new ReaderError("MANIFEST_INVALID", "Cấu hình hiện hành chưa được đánh dấu active.", { configId });
  const shape = validateManifestShape(data, kind);
  if (!shape.ok) throw new ReaderError("MANIFEST_INVALID", "Cấu hình hiện hành không hợp lệ.", { configId, ...shape });
  const ancestry = await loadConfigAncestry(dbFacade, sessionPath, configId, kind);
  return { legacy: false, configId, config: data, ancestry };
}

/**
 * Gate 1B.2C: resolves the teacher-facing display semantics (title, description) a UI screen
 * or export should show — the session's own legacy fields for a non-contract session, or the
 * ACTIVE versioned manifest for a contract session. Root `title`/`description` are frozen at
 * whatever they were at (or before) activation and are never rewritten by `applyConfigRevision`
 * — reading them directly is only correct at revision 0 and silently goes stale from revision 1
 * onward. Callers that display or export semantic session fields must go through this instead
 * of reading `sessionData.title`/`sessionData.description` directly for a contract session.
 * Fails closed: any resolution error (broken ancestry, invalid manifest, unsupported contract
 * version) propagates to the caller rather than silently falling back to root fields.
 */
export async function resolveSessionSemantics(dbFacade, sessionPath, sessionData, kind) {
  if (!isContractSession(sessionData)) {
    return { source: "legacy", title: sessionData.title ?? "", description: sessionData.description ?? "" };
  }
  const effective = await resolveEffectiveConfig(dbFacade, sessionPath, sessionData, kind);
  if (effective.legacy) {
    // isContractSession() was true above, so resolveEffectiveConfig() must not report legacy —
    // fail closed rather than trust root fields if this invariant is ever violated.
    throw new ReaderError("CONTRACT_RESOLUTION_INCONSISTENT", "Không thể xác định cấu hình hiệu lực cho phiên đã kích hoạt hợp đồng.");
  }
  return { source: "contract", configId: effective.configId, title: effective.config.title ?? "", description: effective.config.description ?? "" };
}

/**
 * GATE 1B.3-C2: resolves the full effective Interaction (sessions) semantic config a real
 * editor/player screen needs — behavioral settings, ordered questions, embedded options,
 * revision, configId, roundId — not just title/description (see resolveSessionSemantics above
 * for that narrower, pre-existing use). Honest about revision 0: the activation_baseline
 * manifest never snapshotted any questions (contract-writer.mjs's activateContract() only ever
 * captures title/description), so `questions` is returned as null there — NEVER fabricated —
 * and the caller is expected to fall back to reading the live, still-mutable legacy `questions`
 * collection directly (exactly as it would for a session with no contract at all), per the
 * frozen Gate 1B.3-B3.1 "pre-rev1 legacy compatibility" contract. Only a real revision >=1
 * manifest (kind=="interaction") ever returns an embedded questions[] array, and that array is
 * the immutable, versioned one — never mutable legacy data relabeled as versioned history.
 */
export async function resolveInteractionConfig(dbFacade, sessionPath, sessionData) {
  if (!isContractSession(sessionData)) {
    return {
      source: "legacy", configId: "legacy-v0", revision: null, roundId: null,
      title: sessionData.title ?? "", description: sessionData.description ?? "", questions: null
    };
  }
  const effective = await resolveEffectiveConfig(dbFacade, sessionPath, sessionData, "interaction");
  if (effective.legacy) {
    // isContractSession() was true above, so this must not happen — fail closed rather than
    // silently treat an inconsistent contract session as plain legacy.
    throw new ReaderError("CONTRACT_RESOLUTION_INCONSISTENT", "Không thể xác định cấu hình hiệu lực cho phiên đã kích hoạt hợp đồng.");
  }
  const cfg = effective.config;
  if (cfg.kind === "activation_baseline") {
    return {
      source: "contract-baseline", configId: effective.configId, revision: 0, roundId: null,
      title: cfg.title ?? "", description: cfg.description ?? "", questions: null
    };
  }
  return {
    source: "contract-revision", configId: effective.configId, revision: cfg.revision, roundId: cfg.roundId,
    title: cfg.title ?? "", description: cfg.description ?? "",
    allowMultipleResponses: !!cfg.allowMultipleResponses, anonymous: !!cfg.anonymous, showResponderCount: !!cfg.showResponderCount,
    questions: Array.isArray(cfg.questions) ? cfg.questions : []
  };
}

/**
 * Builds an interaction report grouped by round, without ever mixing question/option IDs
 * across rounds. For a legacy session (no contract marker) this is a straight pass-through of
 * the current single-round `questions`/`options` shape, wrapped in one synthetic round so
 * callers have one shape to deal with — legacy behavior/meaning is unchanged.
 */
export async function readInteractionReport(dbFacade, sessionPath, sessionData) {
  const effective = await resolveEffectiveConfig(dbFacade, sessionPath, sessionData, "interaction");
  if (effective.legacy) {
    const questions = await dbFacade.listDocs("questions", { where: [["sessionId", "==", sessionData.__sessionId], ["ownerId", "==", sessionData.ownerId]] });
    return {
      legacy: true,
      rounds: [{ roundId: "legacy-v0", sealed: null, questions: questions.map(q => ({ questionId: q.id, ...q.data })) }]
    };
  }
  const rounds = new Map();
  const questionIdToRound = new Map();
  for (const node of effective.ancestry) {
    if (node.implicit) continue;
    const roundId = node.roundId || node.configId;
    if (!rounds.has(roundId)) rounds.set(roundId, { roundId, sealed: !!node.sealed, questions: Array.isArray(node.questions) ? node.questions : [] });
    for (const q of (Array.isArray(node.questions) ? node.questions : [])) {
      const owner = questionIdToRound.get(q.questionId);
      if (owner && owner !== roundId) {
        throw new ReaderError("REUSED_QUESTION_ID", "questionId bị dùng lại giữa hai vòng khác nhau.", { questionId: q.questionId, rounds: [owner, roundId] });
      }
      questionIdToRound.set(q.questionId, roundId);
    }
  }
  return { legacy: false, currentConfigId: effective.configId, rounds: Array.from(rounds.values()) };
}

/**
 * Historical group data: retired groups (group number beyond the *current* groupCount) must
 * still be returned, never dropped. Any topic/note/photo/file record whose `group` cannot be
 * resolved against a known manifest is returned with resolved:false ("unresolved"), it is
 * never filtered out.
 */
export async function readGroupHistoricalData(dbFacade, sessionPath, sessionData) {
  const effective = await resolveEffectiveConfig(dbFacade, sessionPath, sessionData, "group");
  const [topics, notes, photos, files] = await Promise.all([
    dbFacade.listDocs(`${sessionPath}/topics`),
    dbFacade.listDocs(`${sessionPath}/notes`),
    dbFacade.listDocs(`${sessionPath}/photos`),
    dbFacade.listDocs(`${sessionPath}/files`)
  ]);
  const knownGroups = new Set();
  if (effective.legacy) {
    const count = Number(sessionData.groupCount) || 0;
    for (let i = 1; i <= count; i++) knownGroups.add(i);
  } else {
    for (const node of effective.ancestry) {
      if (node.implicit) continue;
      if (Number.isInteger(node.groupCount)) for (let i = 1; i <= node.groupCount; i++) knownGroups.add(i);
    }
  }
  const annotate = (docs) => docs.map(d => {
    const group = d.data.group;
    return { id: d.id, ...d.data, resolved: Number.isInteger(group) ? knownGroups.has(group) : false };
  });
  return {
    legacy: effective.legacy,
    knownGroupNumbers: Array.from(knownGroups).sort((a, b) => a - b),
    topics: annotate(topics),
    notes: annotate(notes),
    photos: annotate(photos),
    files: annotate(files)
  };
}

/**
 * Resolves a Knowledge participant's *pinned* profile-collection policy, i.e. whichever
 * config was active when they enrolled — not the session's current policy. Missing enrollment
 * record ⇒ "unknown", never a silent guess.
 */
export async function resolveParticipantPolicy(dbFacade, sessionPath, sessionData, uid) {
  if (!isContractSession(sessionData)) {
    return {
      status: "resolved",
      legacy: true,
      collectParticipantProfile: sessionData.collectParticipantProfile === true,
      participantFields: sessionData.participantFields || null,
      classOptions: Array.isArray(sessionData.classOptions) ? sessionData.classOptions : [],
      minimumPerParticipant: sessionData.minimumPerParticipant
    };
  }
  const enrollmentSnap = await dbFacade.getDoc(`${sessionPath}/enrollments/${uid}`);
  if (!enrollmentSnap.exists) return { status: "unknown" };
  const configId = enrollmentSnap.data.configId;
  if (!isNonEmptyString(configId)) return { status: "unknown" };
  const configSnap = await dbFacade.getDoc(`${sessionPath}/configVersions/${configId}`);
  if (!configSnap.exists) return { status: "unknown" };
  const shape = validateManifestShape(configSnap.data, "knowledge");
  if (!shape.ok) throw new ReaderError("MANIFEST_INVALID", "Cấu hình gắn với hồ sơ tham gia không hợp lệ.", { configId, ...shape });
  return {
    status: "resolved",
    legacy: false,
    configId,
    collectParticipantProfile: true,
    participantFields: configSnap.data.participantFields || null,
    classOptions: Array.isArray(configSnap.data.classOptions) ? configSnap.data.classOptions : [],
    minimumPerParticipant: configSnap.data.minimumPerParticipant
  };
}

/** Removes every PII field. Used for any public/version/aggregate/downstream projection. */
export function stripPii(record) {
  if (!record || typeof record !== "object") return record;
  const out = {};
  for (const key of Object.keys(record)) {
    if (PII_FIELDS.includes(key)) continue;
    out[key] = record[key];
  }
  return out;
}

/**
 * Thin Firestore-backed implementation of the db facade this module expects, for real usage
 * inside index.html. `firestore` is the object of modular-SDK functions already imported
 * there (doc, getDoc, collection, getDocs, query, where) plus the live `db` instance.
 */
export function makeFirestoreDbFacade(db, firestore) {
  const { doc, getDoc, collection, getDocs, query, where } = firestore;
  function splitPath(path) {
    return path.split("/").filter(Boolean);
  }
  return {
    async getDoc(path) {
      const ref = doc(db, ...splitPath(path));
      const snap = await getDoc(ref);
      return { exists: snap.exists(), data: snap.exists() ? snap.data() : null, id: snap.id };
    },
    async listDocs(path, opts) {
      const segments = splitPath(path);
      let q = collection(db, ...segments);
      if (opts && Array.isArray(opts.where)) {
        for (const [field, op, value] of opts.where.map(w => (w.length === 3 ? w : [w[0], "==", w[1]]))) {
          q = query(q, where(field, op, value));
        }
      }
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }
  };
}
