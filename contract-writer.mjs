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

import { validateManifestShape, LIMITS } from "./session-reader.mjs";

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

function stableEqual(a, b) {
  return JSON.stringify(a, Object.keys(a || {}).sort()) === JSON.stringify(b, Object.keys(b || {}).sort());
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
 * Generic config-revision "apply" foundation (no semantic editor UI calls this yet). Only
 * valid on an already-activated, CLOSED session. Bumps configRevision by exactly 1, creating a
 * new immutable configVersions doc whose parentConfigId is the previous currentConfigId.
 */
export async function applyConfigRevision({ db, firestore, family, sessionId, actorUid, operationId, expectedRevision, changes }) {
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

export { FAMILY_CONFIG, LIMITS };
