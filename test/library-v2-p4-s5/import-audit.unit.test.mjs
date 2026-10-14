// LIBRARY V2 P4-S5-B - import audit events (pure unit tests, fake Firestore that behaves like the deployed auditLogs Rules: create allowed, ANY second write of the same id refused).
// Run: node --test test/library-v2-p4-s5/import-audit.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createImportAudit, buildImportAuditEvent, importAuditId, IMPORT_AUDIT_EVENTS } from "../../import-audit.mjs";

const ORG = "orgAAAAAAAAAAAAAAAA1", BATCH = "Ab12Cd34Ef56Gh78Ij90";
const batch = (over = {}) => ({ id: BATCH, organizationId: ORG, kind: "curriculum", status: "completed", importer: "uidImporter", destination: { type: "curriculumFramework", frameworkId: BATCH }, templateId: "hcma2.curriculum.xlsx", templateVersion: 1, counts: { parsed: 10, accepted: 10, skipped: 0, failed: 0 }, warningsSummary: { W1: 2 }, ...over });
const denied = () => Object.assign(new Error("denied"), { code: "permission-denied" });
const unavailable = () => Object.assign(new Error("unavailable"), { code: "unavailable" });

function fakeStore({ readable = true, failures = [], hang = false, storeThenFail = 0 } = {}) {
  const store = new Map(); const touched = []; const calls = { set: 0, get: 0 }; const queue = [...failures];
  const fs = {
    doc: (db, col, id) => { touched.push(col + "/" + id); return { col, id }; },
    serverTimestamp: () => "SERVER_TIMESTAMP",
    async setDoc(ref, data) {
      calls.set++;
      if (hang) return new Promise(() => {});
      if (storeThenFail > 0 && !store.has(ref.id)) { storeThenFail--; store.set(ref.id, JSON.parse(JSON.stringify(data))); throw unavailable(); }   // the write landed but its acknowledgement was lost
      const next = queue.shift(); if (next) throw next();
      if (store.has(ref.id)) throw denied();                    // auditLogs: update / delete are always false
      store.set(ref.id, JSON.parse(JSON.stringify(data)));
    },
    async getDocFromServer(ref) {
      calls.get++;
      if (!readable) throw denied();                              // only the Platform Admin may read auditLogs
      const has = store.has(ref.id);
      return { exists: () => has, data: () => (has ? JSON.parse(JSON.stringify(store.get(ref.id))) : undefined), metadata: { hasPendingWrites: false } };
    }
  };
  return { fs, store, touched, calls };
}
const actorOf = (uid = "uidActor") => () => ({ uid, email: uid + "@example.test", name: "Người " + uid, role: "admin" });
const audit = (env, opts = {}) => createImportAudit({ db: {}, firestore: env.fs, actor: opts.actor || actorOf(), sleep: async () => {}, settleMs: opts.settleMs || 200, retryDelays: opts.retryDelays || [0, 0] });
const completedEvent = () => buildImportAuditEvent({ kind: "completed", organizationId: ORG, batch: batch(), resumed: false }).event;

test("EVENT BUILDER: ids are deterministic per (batch, event); the detail carries organization, batch, framework, importer and a minimal outcome", () => {
  const c = buildImportAuditEvent({ kind: "completed", organizationId: ORG, batch: batch(), resumed: true });
  assert.ok(c.ok); assert.equal(c.event.id, "import_" + BATCH + "_completed"); assert.equal(c.event.action, "curriculum.import.completed"); assert.equal(c.event.entityType, "importBatch"); assert.equal(c.event.entityId, BATCH);
  assert.deepEqual({ ...c.event.detail, counts: undefined, warningsSummary: undefined }, { organizationId: ORG, batchId: BATCH, frameworkId: BATCH, importerId: "uidImporter", outcome: "completed", templateId: "hcma2.curriculum.xlsx", templateVersion: 1, counts: undefined, warningsSummary: undefined, resumed: true });
  assert.deepEqual(c.event.detail.counts, { parsed: 10, accepted: 10, skipped: 0, failed: 0 });
  const r = buildImportAuditEvent({ kind: "rolledBack", organizationId: ORG, batch: batch({ status: "rolled_back", resultCode: "ROLLED_BACK" }), nodesDeleted: 12 });
  assert.ok(r.ok); assert.equal(r.event.id, importAuditId(BATCH, "rolledBack")); assert.equal(r.event.action, IMPORT_AUDIT_EVENTS.rolledBack); assert.equal(r.event.detail.nodesDeleted, 12); assert.equal(r.event.detail.trigger, "operator"); assert.equal(r.event.detail.resultCode, "ROLLED_BACK");
  const p = buildImportAuditEvent({ kind: "partial", organizationId: ORG, batch: batch({ status: "partial", resultCode: "VERIFY_FAILED" }), phase: "verify" });
  assert.ok(p.ok); assert.equal(p.event.id, importAuditId(BATCH, "partial")); assert.equal(p.event.detail.resultCode, "VERIFY_FAILED"); assert.equal(p.event.detail.phase, "verify");
  assert.ok(Object.isFrozen(c.event));
});
test("NO FALSE AUDIT: an event is refused unless the CONFIRMED batch state justifies it (status, organization, destination, id); the rollback barrier never yields `partial`", () => {
  const no = (input, reason) => { const r = buildImportAuditEvent({ organizationId: ORG, ...input }); assert.equal(r.ok, false); assert.equal(r.reason, reason, JSON.stringify(input).slice(0, 80)); };
  no({ kind: "completed", batch: batch({ status: "committing" }) }, "NOT_COMPLETED");
  no({ kind: "completed", batch: batch({ status: "partial" }) }, "NOT_COMPLETED");
  no({ kind: "completed", batch: batch({ status: "rolled_back" }) }, "NOT_COMPLETED");
  no({ kind: "rolledBack", batch: batch({ status: "partial" }) }, "NOT_ROLLED_BACK");
  no({ kind: "rolledBack", batch: batch({ status: "completed" }) }, "NOT_ROLLED_BACK");
  no({ kind: "partial", batch: batch({ status: "committing" }) }, "NOT_PARTIAL");
  no({ kind: "partial", batch: batch({ status: "completed" }) }, "NOT_PARTIAL");
  no({ kind: "partial", batch: batch({ status: "partial", resultCode: "ROLLBACK_STARTED" }) }, "ROLLBACK_BARRIER");
  no({ kind: "completed", batch: batch({ organizationId: "other" }) }, "ORGANIZATION_MISMATCH");
  no({ kind: "completed", batch: batch({ destination: { type: "curriculumFramework", frameworkId: "different0000000001" } }) }, "DESTINATION_MISMATCH");
  no({ kind: "completed", batch: batch({ id: "x/../y" }) }, "BAD_BATCH_ID");
  no({ kind: "completed", batch: null }, "NO_BATCH");
  no({ kind: "bogus", batch: batch() }, "UNKNOWN_KIND");
});
test("RECORD (account may read auditLogs): the server acknowledged write is verified by a read-back -> recorded; the stored entry has actor, server timestamp and the event", async () => {
  const env = fakeStore(); const r = await audit(env).record(completedEvent());
  assert.equal(r.state, "recorded"); assert.equal(r.verifiedBy, "read-back"); assert.equal(env.store.size, 1);
  const e = env.store.get(importAuditId(BATCH, "completed"));
  assert.equal(e.actorId, "uidActor"); assert.equal(e.actorRole, "admin"); assert.equal(e.action, "curriculum.import.completed"); assert.equal(e.entityId, BATCH); assert.equal(e.createdAt, "SERVER_TIMESTAMP"); assert.equal(e.detail.organizationId, ORG);
  assert.ok(env.touched.every((p) => p.startsWith("auditLogs/")), "only auditLogs documents are ever addressed: " + env.touched.join(","));
});
test("RECORD (account cannot read auditLogs): recorded only on the server acknowledgement, and it says so (verifiedBy server-ack)", async () => {
  const env = fakeStore({ readable: false }); const r = await audit(env).record(completedEvent());
  assert.equal(r.state, "recorded"); assert.equal(r.verifiedBy, "server-ack"); assert.equal(env.store.size, 1);
});
test("IDEMPOTENT: recording the same event again (retry button, double click, refresh + resume) leaves exactly ONE unchanged entry and reports `already`", async () => {
  const env = fakeStore(); const a = audit(env); const event = completedEvent();
  assert.equal((await a.record(event)).state, "recorded"); const before = JSON.stringify([...env.store]);
  for (let i = 0; i < 3; i++) { const r = await a.record(event); assert.equal(r.state, "already"); assert.equal(r.ownedByActor, true); }
  assert.equal(env.store.size, 1); assert.equal(JSON.stringify([...env.store]), before, "the entry was never modified");
});
test("CONCURRENT clients (two actors, same event, same time): exactly one entry; one `recorded`, the other `already` (proved by read-back)", async () => {
  const env = fakeStore(); const event = completedEvent();
  const [x, y] = await Promise.all([audit(env, { actor: actorOf("uidA") }).record(event), audit(env, { actor: actorOf("uidB") }).record(event)]);
  assert.deepEqual([x.state, y.state].sort(), ["already", "recorded"]); assert.equal(env.store.size, 1);
  const stored = env.store.get(event.id).actorId; assert.ok(["uidA", "uidB"].includes(stored));
  const loser = x.state === "already" ? x : y; assert.equal(loser.ownedByActor, false);
});
test("PERMISSION DENIED: unreadable account -> `unverified` (cannot tell denial from an existing entry); readable account with no entry -> `failed` DENIED; never `recorded`", async () => {
  const blind = fakeStore({ readable: false, failures: [denied] }); const u = await audit(blind).record(completedEvent());
  assert.equal(u.state, "unverified"); assert.equal(u.reason, "WRITE_REFUSED_UNREADABLE"); assert.equal(blind.store.size, 0);
  const admin = fakeStore({ failures: [denied] }); const f = await audit(admin).record(completedEvent());
  assert.equal(f.state, "failed"); assert.equal(f.reason, "DENIED"); assert.equal(admin.store.size, 0);
});
test("TRANSIENT failures are retried with the SAME id: two failures then success -> one entry, recorded", async () => {
  const env = fakeStore({ failures: [unavailable, unavailable] }); const r = await audit(env).record(completedEvent());
  assert.equal(r.state, "recorded"); assert.equal(env.calls.set, 3); assert.equal(env.store.size, 1);
});
test("INTERRUPTION / LOST ACKNOWLEDGEMENT: the write landed but the response was lost -> the retry is refused (already exists) and the read-back proves our own entry: `already`, never a second entry", async () => {
  const env = fakeStore({ storeThenFail: 1 }); const r = await audit(env).record(completedEvent());
  assert.equal(r.state, "already"); assert.equal(r.ownedByActor, true); assert.equal(env.store.size, 1);
});
test("OFFLINE / HANG: a write that never settles times out; with nothing persisted the result is `failed` (UNAVAILABLE), never `recorded`", async () => {
  const env = fakeStore({ hang: true }); const r = await audit(env, { settleMs: 20 }).record(completedEvent());
  assert.equal(r.state, "failed"); assert.equal(r.reason, "UNAVAILABLE"); assert.equal(env.store.size, 0);
});
test("DISAGREEING ENTRY: an existing entry with the same id but different content is never reported as success", async () => {
  const env = fakeStore(); env.store.set(importAuditId(BATCH, "completed"), { actorId: "x", action: "curriculum.import.rolledBack", entityType: "importBatch", entityId: BATCH, detail: { organizationId: ORG, batchId: BATCH } });
  const r = await audit(env).record(completedEvent()); assert.equal(r.state, "failed"); assert.equal(r.reason, "EXISTING_ENTRY_DIFFERS");
});
test("READ-BACK is part of success: an acknowledged write whose read-back is absent or cannot run is NOT reported as recorded", async () => {
  const env = fakeStore(); const realGet = env.fs.getDocFromServer;
  env.fs.getDocFromServer = async () => ({ exists: () => false, data: () => undefined, metadata: { hasPendingWrites: false } });
  assert.equal((await audit(env).record(completedEvent())).state, "failed");
  env.store.clear(); env.fs.getDocFromServer = async () => { throw unavailable(); };
  const r = await audit(env).record(completedEvent()); assert.equal(r.state, "unverified"); assert.equal(r.reason, "READ_BACK_UNAVAILABLE");
  env.fs.getDocFromServer = realGet;
});
test("record() NEVER throws (bad event, no actor, throwing Firestore) and never touches anything but auditLogs", async () => {
  const env = fakeStore();
  assert.equal((await audit(env).record(null)).state, "failed");
  assert.equal((await audit(env, { actor: () => ({}) }).record(completedEvent())).reason, "NO_ACTOR");
  assert.equal((await audit(env, { actor: () => { throw new Error("boom"); } }).record(completedEvent())).reason, "NO_ACTOR");
  const weird = fakeStore(); weird.fs.setDoc = async () => { throw new TypeError("weird"); }; weird.fs.getDocFromServer = async () => { throw new TypeError("weird"); };
  const r = await audit(weird).record(completedEvent()); assert.equal(r.state, "failed");
  assert.throws(() => createImportAudit({ db: {}, firestore: {}, actor: actorOf() }), TypeError); assert.throws(() => createImportAudit({ db: {}, firestore: env.fs }), TypeError);
});
