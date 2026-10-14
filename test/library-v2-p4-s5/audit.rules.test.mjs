// P4-S5-B - import AUDIT events against the LIVE Rules bytes (ruleset 02ca5a30, SHA F6B9DE01...7D4A) on the emulator, with the REAL commit controller and the REAL audit module.
// Covers: persistence and fields, idempotency under retry, concurrent writers, permission denial, interruption between the business transition and the audit write, audit failure after a
// successful business completion, no `partial` event for the rollback barrier, no change to existing audit entries. Synthetic data only. The Rules are NOT modified.
// Run: firebase emulators:exec --only firestore --project demo-p5b-audit --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s5/audit.rules.test.mjs"   (Java 21)
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, seedWorld, assertSucceeds, assertFails, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, serverTimestamp } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController, RESULT_CODES } from "../../import-commit-controller.mjs";
import { createImportAudit, buildImportAuditEvent, importAuditId } from "../../import-audit.mjs";
import { toNodePayload } from "../../import-plan.mjs";
import { BASE_FS, BATCH, big, planFor, allowAlways, faulty, noSleep, freezeCandidateRules } from "../library-v2-p4-s4/helpers.mjs";

const env = await makeEnv("demo-p5b-audit", freezeCandidateRules());      // asserts SHA-256 F6B9DE01... == the live ruleset
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const adm = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (path) => adm(async (db) => { const s = await getDoc(doc(db, path)); return s.exists() ? { id: s.id, ...s.data() } : null; });
const auditDocs = () => adm(async (db) => (await getDocs(collection(db, "auditLogs"))).docs.map((d) => ({ id: d.id, ...d.data() })));
const nodeCount = (id = BATCH) => adm(async (db) => (await getDocs(collection(db, "curriculumFrameworks", id, "nodes"))).size);
const ctl = (uid, fs = BASE_FS) => createImportCommitController({ db: as(uid), firestore: fs, retryDelays: [0, 0], stepTimeoutMs: 30000, sleep: noSleep });
const AUDIT_FS = { doc: BASE_FS.doc, setDoc: BASE_FS.setDoc, getDocFromServer: BASE_FS.getDocFromServer, serverTimestamp: BASE_FS.serverTimestamp };
const fresh = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } }).firestore();   // a SEPARATE client (own cache, own write queue), like a second browser tab
const writer = (uid, { actorUid = uid, fs = AUDIT_FS, settleMs = 5000, separate = false } = {}) => createImportAudit({ db: separate ? fresh(uid) : as(uid), firestore: fs, actor: () => ({ uid: actorUid, email: actorUid + "@example.test", name: "Người " + actorUid, role: uid === "pa" ? "admin" : "teacher" }), sleep: noSleep, settleMs, retryDelays: [0, 0] });
const commit = (uid, plan, extra = {}) => ctl(uid, extra.fs).commit({ plan, organizationId: "orgA", actorUid: uid, authorize: allowAlways(uid), resume: !!extra.resume });
const completedEvent = (result) => buildImportAuditEvent({ kind: "completed", organizationId: "orgA", batch: result.batch }).event;

test("PERSISTENCE: a real completed import produces exactly one `curriculum.import.completed` entry with actor, organization, batch, framework, importer, server timestamp and minimal outcome (Platform Admin: verified by read-back)", async () => {
  const r = await commit("pa", planFor(big(3, 10))); assert.equal(r.state, "completed");
  const out = await writer("pa").record(completedEvent(r));
  assert.equal(out.state, "recorded"); assert.equal(out.verifiedBy, "read-back");
  const entries = await auditDocs(); assert.equal(entries.length, 1);
  const e = entries[0]; assert.equal(e.id, importAuditId(BATCH, "completed"));
  assert.equal(e.action, "curriculum.import.completed"); assert.equal(e.entityType, "importBatch"); assert.equal(e.entityId, BATCH); assert.equal(e.actorId, "pa"); assert.equal(e.actorRole, "admin");
  assert.deepEqual({ o: e.detail.organizationId, b: e.detail.batchId, f: e.detail.frameworkId, i: e.detail.importerId, outcome: e.detail.outcome, resumed: e.detail.resumed }, { o: "orgA", b: BATCH, f: BATCH, i: "pa", outcome: "completed", resumed: false });
  assert.ok(e.createdAt && typeof e.createdAt.toMillis === "function", "server timestamp");
  assert.deepEqual(e.detail.counts, r.batch.counts);
});
for (const uid of ["oaA", "capA"]) {
  test("PERSISTENCE (" + uid + "): an account that cannot read auditLogs gets `recorded` only from the server acknowledgement, and the entry really exists with that actor", async () => {
    const r = await commit(uid, planFor(big(2, 5), { actorUid: uid })); assert.equal(r.state, "completed");
    const out = await writer(uid).record(completedEvent(r)); assert.equal(out.state, "recorded"); assert.equal(out.verifiedBy, "server-ack");
    const entries = await auditDocs(); assert.equal(entries.length, 1); assert.equal(entries[0].actorId, uid); assert.equal(entries[0].detail.importerId, uid);
  });
}
test("IDEMPOTENCY under retries (real Rules): same event again -> `already` for a reading account (one unchanged entry); for a non-reading account the refused rewrite is `unverified`, never a second entry", async () => {
  const r = await commit("pa", planFor(big(2, 5))); const event = completedEvent(r);
  assert.equal((await writer("pa").record(event)).state, "recorded"); const before = JSON.stringify(await auditDocs());
  for (let i = 0; i < 3; i++) assert.equal((await writer("pa").record(event)).state, "already");
  assert.equal(JSON.stringify(await auditDocs()), before, "the stored entry was never modified");
  const blind = await writer("oaA").record(event); assert.equal(blind.state, "unverified"); assert.equal((await auditDocs()).length, 1);
});
test("EXISTING ENTRIES ARE IMMUTABLE: the Rules refuse update and delete of an audit entry, for every writer", async () => {
  const r = await commit("pa", planFor(big(2, 5))); await writer("pa").record(completedEvent(r));
  const ref = (uid) => doc(as(uid), "auditLogs/" + importAuditId(BATCH, "completed"));
  for (const uid of ["pa", "oaA", "capA"]) { await assertFails(updateDoc(ref(uid), { action: "x" })); await assertFails(deleteDoc(ref(uid))); }
});
test("CONCURRENT attempts (Platform Admin client + Organization Admin client + a second Platform Admin client at the same time): exactly one entry exists, nobody gets a false success, no entry is duplicated", async () => {
  const r = await commit("pa", planFor(big(2, 5))); const event = completedEvent(r);
  const results = await Promise.all([writer("pa", { separate: true }).record(event), writer("oaA", { separate: true }).record(event), writer("pa", { separate: true }).record(event)]);
  const entries = await auditDocs(); assert.equal(entries.length, 1, "one entry: " + JSON.stringify(results.map((x) => x.state)));
  assert.ok(results.some((x) => x.state === "recorded"), "the winner records: " + JSON.stringify(results));
  assert.ok(results.filter((x) => x.state === "recorded").length === 1 || results.every((x) => ["recorded", "already", "unverified"].includes(x.state)));
  assert.ok(results.every((x) => x.state !== "failed"), JSON.stringify(results));
});
test("PERMISSION DENIAL: a forged actor id is refused by the Rules (nothing is written, never `recorded`); an anonymous client cannot write either", async () => {
  const r = await commit("pa", planFor(big(2, 5))); const event = completedEvent(r);
  const forgedByAdmin = await writer("pa", { actorUid: "oaA" }).record(event); assert.equal(forgedByAdmin.state, "failed"); assert.equal(forgedByAdmin.reason, "DENIED");
  const forgedByBlind = await writer("oaA", { actorUid: "pa" }).record(event); assert.equal(forgedByBlind.state, "unverified");
  assert.equal((await auditDocs()).length, 0);
  const anon = createImportAudit({ db: as(null), firestore: AUDIT_FS, actor: () => ({ uid: "ghost" }), sleep: noSleep, settleMs: 5000, retryDelays: [0, 0] });
  assert.notEqual((await anon.record(event)).state, "recorded"); assert.equal((await auditDocs()).length, 0);
});
test("INTERRUPTION between the business transition and the audit write: the import stays completed with all its data, no audit entry exists (no false claim); a later retry from the confirmed batch records exactly one entry", async () => {
  const plan = planFor(big(3, 10)); const r = await commit("pa", plan); assert.equal(r.state, "completed");
  // (the page "crashes" here: the audit was never attempted)
  assert.equal((await auditDocs()).length, 0); assert.equal((await read("importBatches/" + BATCH)).status, "completed"); assert.equal(await nodeCount(), plan.nodes.length);
  const confirmed = await ctl("pa").readBatch(BATCH); const ev = buildImportAuditEvent({ kind: "completed", organizationId: "orgA", batch: confirmed });
  assert.ok(ev.ok); assert.equal((await writer("pa").record(ev.event)).state, "recorded"); assert.equal((await auditDocs()).length, 1);
});
test("AUDIT FAILURE after a SUCCESSFUL business completion: the audit result is `failed`, and the completed import is NOT rolled back or altered (batch, framework and every node intact)", async () => {
  const plan = planFor(big(3, 10)); const r = await commit("pa", plan); assert.equal(r.state, "completed");
  const batchBefore = JSON.stringify(await read("importBatches/" + BATCH)), fwBefore = JSON.stringify(await read("curriculumFrameworks/" + BATCH));
  const broken = { ...AUDIT_FS, setDoc: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); } };
  const out = await writer("pa", { fs: broken }).record(completedEvent(r)); assert.equal(out.state, "failed");
  assert.equal(JSON.stringify(await read("importBatches/" + BATCH)), batchBefore); assert.equal(JSON.stringify(await read("curriculumFrameworks/" + BATCH)), fwBefore); assert.equal(await nodeCount(), plan.nodes.length);
  assert.equal((await auditDocs()).length, 0);
  const again = await writer("pa").record(completedEvent(r)); assert.equal(again.state, "recorded");   // a later retry (the GHI LẠI NHẬT KÝ button) succeeds
});
test("ROLLBACK audit: rolledBack is built from the confirmed rolled_back batch; recorded once; the rollback BARRIER state (partial / ROLLBACK_STARTED) NEVER produces a `partial` event", async () => {
  const plan = planFor(big(3, 300));                                   // 903 nodes = 3 chunks: the first chunk is written, the second fails
  const interrupted = await commit("pa", plan, { fs: faulty(BASE_FS, { commit: async (ctx) => { if (ctx.commitIndex >= 2) throw Object.assign(new Error("network"), { code: "unavailable" }); return ctx.perform(); } }) });
  assert.notEqual(interrupted.state, "completed");
  // rollback that stops right after the barrier (node deletes fail): the batch is partial / ROLLBACK_STARTED
  const stopped = await ctl("pa", faulty(BASE_FS, { commit: async () => { throw Object.assign(new Error("network"), { code: "unavailable" }); } })).rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") });
  assert.equal(stopped.ok, false);
  const mid = await read("importBatches/" + BATCH); assert.equal(mid.status, "partial"); assert.equal(mid.resultCode, RESULT_CODES.rollbackStarted);
  assert.equal(buildImportAuditEvent({ kind: "partial", organizationId: "orgA", batch: mid }).reason, "ROLLBACK_BARRIER");
  assert.equal((await auditDocs()).length, 0, "nothing was audited for the barrier");
  const done = await ctl("pa").rollback({ batchId: BATCH, organizationId: "orgA", authorize: allowAlways("pa") }); assert.equal(done.state, "rolled_back");
  const ev = buildImportAuditEvent({ kind: "rolledBack", organizationId: "orgA", batch: done.batch, nodesDeleted: done.nodesDeleted }); assert.ok(ev.ok);
  assert.equal((await writer("pa").record(ev.event)).state, "recorded"); assert.equal((await writer("pa").record(ev.event)).state, "already");
  const entries = await auditDocs(); assert.equal(entries.length, 1); assert.equal(entries[0].action, "curriculum.import.rolledBack"); assert.equal(entries[0].detail.resultCode, "ROLLED_BACK");
});
test("PARTIAL audit: a verification failure leaves a durable partial batch, the controller returns the CONFIRMED batch, and exactly one `curriculum.import.partial` entry is recorded (never completed)", async () => {
  const plan = planFor(big(3, 20));
  const fs = faulty(BASE_FS, { commit: async (ctx) => { await ctx.perform(); await adm((db) => setDoc(doc(db, "curriculumFrameworks/" + BATCH + "/nodes/" + "e".repeat(32)), { ...toNodePayload(plan.nodes[5], { serverTimestamp: () => new Date() }), name: "Nút thừa", code: "EXTRA" })); } });
  const r = await commit("pa", plan, { fs });
  assert.equal(r.state, "verification-failed"); assert.equal(r.markedPartial, true); assert.ok(r.batch && r.batch.status === "partial" && r.batch.resultCode === RESULT_CODES.verifyFailed, "the result carries the server-confirmed partial batch");
  const ev = buildImportAuditEvent({ kind: "partial", organizationId: "orgA", batch: r.batch, phase: r.phase }); assert.ok(ev.ok);
  assert.equal((await writer("pa").record(ev.event)).state, "recorded"); assert.equal((await writer("pa").record(ev.event)).state, "already");
  const entries = await auditDocs(); assert.equal(entries.length, 1); assert.equal(entries[0].action, "curriculum.import.partial"); assert.equal(entries[0].detail.resultCode, "VERIFY_FAILED");
  assert.equal(buildImportAuditEvent({ kind: "completed", organizationId: "orgA", batch: r.batch }).ok, false, "a partial batch can never yield a completion event");
});
test("NO AUDIT FROM NON-CONFIRMED OUTCOMES: paused / denied / not-committing / unconfirmed results carry no confirmed completed batch, so no event can be built", async () => {
  const plan = planFor(big(3, 20));
  let n = 0; const flipping = Object.assign(async () => (++n <= 3 ? { allowed: true } : { allowed: false }), { actorUid: "pa" });
  const r = await ctl("pa").commit({ plan, organizationId: "orgA", actorUid: "pa", authorize: flipping }); assert.equal(r.ok, false);
  assert.equal(r.batch, undefined); assert.equal((await auditDocs()).length, 0);
  const pending = await read("importBatches/" + BATCH); assert.equal(buildImportAuditEvent({ kind: "completed", organizationId: "orgA", batch: pending }).ok, false);
});
