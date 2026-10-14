// Library V2 P4-S5-B - IMPORT AUDIT EVENTS (best-effort, idempotent). Pure module: no DOM, no module imports; the Firestore functions and the actor are injected.
// Three events (R1 section 16): curriculum.import.completed / curriculum.import.rolledBack / curriculum.import.partial.
//   * Each event has a DETERMINISTIC document id `import_{batchId}_{completed|rolledBack|partial}` in the existing `auditLogs` collection and is written with setDoc. The deployed Rules deny
//     `update` and `delete` on auditLogs, so a second write of the same id is refused: at most ONE entry per (batch, event) whatever the retries, double clicks, refreshes or concurrent clients.
//   * An event is built only from a batch whose DURABLE status was confirmed by a server read (completed -> completed, rolled_back -> rolledBack, partial/VERIFY_FAILED -> partial). The rollback
//     barrier (partial/ROLLBACK_STARTED) never produces a `partial` event.
//   * The business operation never depends on the audit: record() never throws, never touches the batch/framework/nodes, and reports exactly what is known about the persisted entry:
//       recorded   - the server acknowledged OUR write (and, where the account may read auditLogs, a server read-back matched the entry)
//       already    - an entry with this id already exists and matches (written by an earlier attempt or another client); a read-back proved it
//       unverified - the write was refused / not acknowledged and the entry could not be read back (a non-admin account cannot read auditLogs)
//       failed     - the entry is not persisted (denied, offline, timeout, or the existing entry does not match)
const freeze = Object.freeze;
export const IMPORT_AUDIT_EVENTS = freeze({ completed: "curriculum.import.completed", rolledBack: "curriculum.import.rolledBack", partial: "curriculum.import.partial" });
export const IMPORT_AUDIT_STATES = freeze({ recorded: "recorded", already: "already", unverified: "unverified", failed: "failed" });
export const AUDIT_COLLECTION = "auditLogs";
export const AUDIT_SETTLE_MS = 15000;
export const AUDIT_RETRY_DELAYS_MS = freeze([400, 1200]);
const KINDS = freeze(["completed", "rolledBack", "partial"]);
const ID_PATTERN = /^[A-Za-z0-9]{10,64}$/;
const TRANSIENT = new Set(["unavailable", "deadline-exceeded", "aborted", "resource-exhausted", "internal", "cancelled", "unknown"]);

export const importAuditId = (batchId, kind) => "import_" + batchId + "_" + kind;
const codeOf = (error) => (error && typeof error.code === "string" ? error.code.replace(/^firestore\//, "") : "");
const isPermission = (error) => { const c = codeOf(error); return c === "permission-denied" || c === "unauthenticated"; };
const isTransient = (error) => { const c = codeOf(error); return TRANSIENT.has(c) || (!c && /network|offline|fetch|timeout|did not settle/i.test(String(error && error.message || ""))); };
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const num = (n) => (Number.isFinite(n) ? n : 0);

// Builds the event from a CONFIRMED batch. Returns { ok: true, event } or { ok: false, reason } - a batch whose confirmed state does not justify the event yields no event (no false audit).
export function buildImportAuditEvent({ kind, organizationId, batch, nodesDeleted, phase, resumed } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, reason: "UNKNOWN_KIND" };
  if (!batch || typeof batch !== "object") return { ok: false, reason: "NO_BATCH" };
  if (typeof batch.id !== "string" || !ID_PATTERN.test(batch.id)) return { ok: false, reason: "BAD_BATCH_ID" };
  if (typeof organizationId !== "string" || !organizationId || batch.organizationId !== organizationId) return { ok: false, reason: "ORGANIZATION_MISMATCH" };
  const frameworkId = batch.destination && batch.destination.frameworkId;
  if (frameworkId !== batch.id) return { ok: false, reason: "DESTINATION_MISMATCH" };
  const importerId = typeof batch.importer === "string" ? batch.importer : null;
  const common = { organizationId, batchId: batch.id, frameworkId, importerId };
  if (kind === "completed") {
    if (batch.status !== "completed") return { ok: false, reason: "NOT_COMPLETED" };
    return { ok: true, event: freeze({ kind, id: importAuditId(batch.id, kind), action: IMPORT_AUDIT_EVENTS.completed, entityType: "importBatch", entityId: batch.id,
      detail: plain({ ...common, outcome: "completed", templateId: batch.templateId || null, templateVersion: num(batch.templateVersion), counts: batch.counts || null, warningsSummary: batch.warningsSummary || {}, resumed: resumed === true }) }) };
  }
  if (kind === "rolledBack") {
    if (batch.status !== "rolled_back") return { ok: false, reason: "NOT_ROLLED_BACK" };
    return { ok: true, event: freeze({ kind, id: importAuditId(batch.id, kind), action: IMPORT_AUDIT_EVENTS.rolledBack, entityType: "importBatch", entityId: batch.id,
      detail: plain({ ...common, outcome: "rolled_back", resultCode: batch.resultCode || null, nodesDeleted: num(nodesDeleted), trigger: "operator" }) }) };
  }
  if (batch.status !== "partial") return { ok: false, reason: "NOT_PARTIAL" };
  if (batch.resultCode === "ROLLBACK_STARTED") return { ok: false, reason: "ROLLBACK_BARRIER" };   // the barrier is part of a rollback, not a failure
  return { ok: true, event: freeze({ kind, id: importAuditId(batch.id, kind), action: IMPORT_AUDIT_EVENTS.partial, entityType: "importBatch", entityId: batch.id,
    detail: plain({ ...common, outcome: "partial", resultCode: batch.resultCode || null, phase: typeof phase === "string" ? phase : null }) }) };
}

// firestore: { doc, setDoc, getDocFromServer, serverTimestamp }; actor: () => { uid, email, name, role }. Never throws.
export function createImportAudit({ db, firestore, actor, sleep, settleMs = AUDIT_SETTLE_MS, retryDelays = AUDIT_RETRY_DELAYS_MS } = {}) {
  const fs = firestore || {};
  for (const name of ["doc", "setDoc", "getDocFromServer", "serverTimestamp"]) if (typeof fs[name] !== "function") throw new TypeError("createImportAudit requires the Firestore function: " + name);
  if (typeof actor !== "function") throw new TypeError("createImportAudit requires an actor() function");
  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = (promise) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("audit step did not settle"), { code: "deadline-exceeded" })), settleMs);
    Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
  const matches = (data, event, organizationId) => !!data && data.action === event.action && data.entityType === "importBatch" && data.entityId === event.entityId &&
    !!data.detail && data.detail.batchId === event.detail.batchId && data.detail.organizationId === organizationId;
  async function readBack(ref, event) {
    try {
      const snapshot = await settle(fs.getDocFromServer(ref));
      if (snapshot && snapshot.metadata && snapshot.metadata.hasPendingWrites) return { kind: "unsettled" };
      if (!snapshot.exists()) return { kind: "absent" };
      return { kind: matches(snapshot.data(), event, event.detail.organizationId) ? "match" : "mismatch", data: snapshot.data() };
    } catch (error) { return { kind: isPermission(error) ? "unreadable" : "error", error }; }
  }
  async function record(event) {
    if (!event || typeof event.id !== "string" || !event.action || !event.detail) return { state: IMPORT_AUDIT_STATES.failed, reason: "INVALID_EVENT", id: event && event.id || null };
    let who;
    try { who = actor() || {}; } catch { who = {}; }
    if (typeof who.uid !== "string" || !who.uid) return { state: IMPORT_AUDIT_STATES.failed, reason: "NO_ACTOR", id: event.id };
    const ref = fs.doc(db, AUDIT_COLLECTION, event.id);
    const payload = { actorId: who.uid, actorEmail: who.email || "", actorName: who.name || "", actorRole: who.role || "", action: event.action, entityType: event.entityType, entityId: event.entityId, detail: event.detail, createdAt: fs.serverTimestamp() };
    let writeError = null, acknowledged = false;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try { await settle(fs.setDoc(ref, payload)); acknowledged = true; writeError = null; break; }
      catch (error) { writeError = error; if (!isTransient(error) || attempt === retryDelays.length) break; await wait(retryDelays[attempt]); }
    }
    const back = await readBack(ref, event);
    if (acknowledged) {
      if (back.kind === "match") return { state: IMPORT_AUDIT_STATES.recorded, id: event.id, verifiedBy: "read-back" };
      if (back.kind === "unreadable") return { state: IMPORT_AUDIT_STATES.recorded, id: event.id, verifiedBy: "server-ack" };   // the account may not read auditLogs: the server acknowledged the write
      if (back.kind === "error" || back.kind === "unsettled") return { state: IMPORT_AUDIT_STATES.unverified, id: event.id, reason: "READ_BACK_UNAVAILABLE" };   // acknowledged, but the check itself could not run: not reported as success
      return { state: IMPORT_AUDIT_STATES.failed, id: event.id, reason: back.kind === "mismatch" ? "READ_BACK_MISMATCH" : "READ_BACK_" + String(back.kind).toUpperCase() };
    }
    // not acknowledged: an entry with this id may already exist (earlier attempt, another client, or our own write whose acknowledgement was lost)
    if (back.kind === "match") return { state: IMPORT_AUDIT_STATES.already, id: event.id, ownedByActor: !!back.data && back.data.actorId === who.uid };
    if (back.kind === "mismatch") return { state: IMPORT_AUDIT_STATES.failed, id: event.id, reason: "EXISTING_ENTRY_DIFFERS" };
    if (back.kind === "unreadable") return { state: IMPORT_AUDIT_STATES.unverified, id: event.id, reason: isPermission(writeError) ? "WRITE_REFUSED_UNREADABLE" : "WRITE_NOT_ACKNOWLEDGED" };
    return { state: IMPORT_AUDIT_STATES.failed, id: event.id, reason: isPermission(writeError) ? "DENIED" : isTransient(writeError) ? "UNAVAILABLE" : "ERROR" };
  }
  return freeze({ record });
}
