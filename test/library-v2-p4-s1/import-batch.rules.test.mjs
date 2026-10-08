// LIBRARY V2 P4-S1 - import-batch Rules foundation (Firestore emulator, synthetic data only). Rules under test = firestore.rules.production-candidate (the P4-S1 candidate).
// Run: firebase emulators:exec --only firestore --project demo-p4s1 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s1/import-batch.rules.test.mjs"
// Proves: paired-ID contract, batch schema/immutability/transitions, authoritative activation protection (imported vs manual), completion/rolled_back witnesses, D14 clone laundering,
// organization boundary, archived organization, no delete, and P3 lifecycle compatibility. Rules-vs-controller boundary: nothing here claims node counts / code uniqueness / hierarchy.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, assertSucceeds, assertFails, nodeDoc, fwDoc, newFwPayload, newNodePayload, lessonPayload, nodeEdit, fwRename, fwTransition, D,
  doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, writeBatch, serverTimestamp, fwRef, nodeRef
} from "../library-v2-p3-s1/helpers.mjs";

const rules = candidateRules();
const env = await makeEnv("demo-p4s1-import", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const WRITERS = ["pa", "oaA", "capA"];
const NON_WRITERS = ["mA", "revA", "oaB", "capB", "mB", "tSusp", "capSuspMem", "capRemoved", "ghost", "noMember"];
const FINAL = "f".repeat(32);
const batchRef = (db, id) => doc(db, "importBatches", id);

const batchBody = (org, uid, id, extra = {}) => ({
  schemaVersion: 1, kind: "curriculum", organizationId: org, destination: { type: "curriculumFramework", frameworkId: id }, templateId: "hcma2.curriculum.xlsx", templateVersion: 1,
  sourceFile: { name: "khung.xlsx", size: 2048, sha256: "a".repeat(64) }, importer: uid, status: "committing",
  counts: { parsed: 6, accepted: 6, skipped: 0, failed: 0 }, chunksDone: 0, chunksTotal: 1, warningsSummary: {}, finalNodeId: FINAL, ...extra
});
const newBatch = (org, uid, id, extra = {}) => ({ ...batchBody(org, uid, id, extra), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
// seeded (rules disabled) documents
async function seed(fn) { await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); await fn(db, (p, d) => setDoc(doc(db, p), d)); }); }
const seedBatch = (id, org = "orgA", status = "committing", extra = {}) => seed((db, put) => put("importBatches/" + id, {
  ...batchBody(org, "pa", id, { chunksDone: status === "completed" ? 1 : 0, status, ...(status === "committing" ? {} : { finishedAt: D(8) }), ...extra }), createdAt: D(7), updatedAt: D(7)
}));
const seedFw = (id, org = "orgA", status = "draft", extra = {}) => seed((db, put) => put("curriculumFrameworks/" + id, fwDoc(org, status, extra)));
const seedNode = (fw, id, org = "orgA", extra = {}) => seed((db, put) => put("curriculumFrameworks/" + fw + "/nodes/" + id, nodeDoc(org, extra)));
const progress = (fields = {}) => ({ chunksDone: 1, updatedAt: serverTimestamp(), ...fields });
const finish = (status, fields = {}) => ({ status, finishedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...fields });

test("batch create: accepted for Platform Admin, Organization Admin and capability holder with the exact approved shape; denied for every non-writer, anonymous and unauthenticated principal", async () => {
  for (const u of WRITERS) await ok(setDoc(batchRef(as(u), "b_" + u), newBatch("orgA", u, "b_" + u)));
  for (const u of NON_WRITERS) await no(setDoc(batchRef(as(u), "b_" + u), newBatch("orgA", u, "b_" + u)));
  await no(setDoc(batchRef(as(null), "b_anon"), newBatch("orgA", "pa", "b_anon")));
  await no(setDoc(batchRef(as("anon1", "anonymous"), "b_anon2"), newBatch("orgA", "anon1", "b_anon2")));
  await no(setDoc(batchRef(as("pa"), "b_forged"), newBatch("orgA", "oaA", "b_forged")));   // importer must be the caller
});
test("PAIRED ID: a batch cannot be created when a framework document with the same id already exists (draft, active or archived); it can for a fresh id; the framework can then be created at the same id", async () => {
  for (const id of ["fwA_draft", "fwA_active", "fwA_archived", "fwA_draftAct"]) await no(setDoc(batchRef(as("pa"), id), newBatch("orgA", "pa", id)));
  await no(setDoc(batchRef(as("pa"), "fwB_draft"), newBatch("orgB", "pa", "fwB_draft")));   // another organization's existing framework id
  await ok(setDoc(batchRef(as("pa"), "imp1"), newBatch("orgA", "pa", "imp1")));
  await ok(setDoc(fwRef(as("pa"), "imp1"), newFwPayload("orgA", "pa", { name: "Khung nhap" })));   // the imported framework: same id, created AFTER its batch
  await no(setDoc(batchRef(as("pa"), "imp1"), newBatch("orgA", "pa", "imp1")));                      // and the batch can never be recreated
});
test("batch schema: every deviation is rejected (extra keys, missing keys, wrong kind/template/version, pairing mismatch, bad hash/size/name, bad counts/chunks, forged status/finishedAt/resultCode, wrong types)", async () => {
  const pa = as("pa");
  const attempts = [
    ["extra top-level key", { note: "x" }], ["wrong kind", { kind: "question" }], ["wrong template", { templateId: "hcma2.other.xlsx" }], ["template version 0", { templateVersion: 0 }],
    ["schemaVersion 2", { schemaVersion: 2 }], ["status completed at create", { status: "completed", finishedAt: serverTimestamp() }], ["status partial at create", { status: "partial", finishedAt: serverTimestamp() }],
    ["chunksDone 1 at create", { chunksDone: 1 }], ["finishedAt at create", { finishedAt: serverTimestamp() }], ["resultCode at create", { resultCode: "X" }],
    ["unknown status", { status: "failed" }], ["sha256 uppercase", { sourceFile: { name: "a.xlsx", size: 1, sha256: "A".repeat(64) } }], ["sha256 short", { sourceFile: { name: "a.xlsx", size: 1, sha256: "a".repeat(63) } }],
    ["size over 5 MiB", { sourceFile: { name: "a.xlsx", size: 5242881, sha256: "a".repeat(64) } }], ["negative size", { sourceFile: { name: "a.xlsx", size: -1, sha256: "a".repeat(64) } }],
    ["empty file name", { sourceFile: { name: "", size: 1, sha256: "a".repeat(64) } }], ["file name 201", { sourceFile: { name: "n".repeat(201), size: 1, sha256: "a".repeat(64) } }], ["sourceFile extra key", { sourceFile: { name: "a", size: 1, sha256: "a".repeat(64), path: "x" } }],
    ["counts missing key", { counts: { parsed: 1, accepted: 1, skipped: 0 } }], ["counts extra key", { counts: { parsed: 1, accepted: 1, skipped: 0, failed: 0, extra: 1 } }], ["counts negative", { counts: { parsed: 1, accepted: 1, skipped: -1, failed: 0 } }],
    ["counts 5001", { counts: { parsed: 5001, accepted: 1, skipped: 0, failed: 0 } }], ["accepted > parsed", { counts: { parsed: 1, accepted: 2, skipped: 0, failed: 0 } }], ["counts string", { counts: { parsed: "1", accepted: 1, skipped: 0, failed: 0 } }],
    ["chunksTotal 14", { chunksTotal: 14 }], ["chunksDone > chunksTotal", { chunksDone: 0, chunksTotal: -1 }], ["warningsSummary not a map", { warningsSummary: "x" }],
    ["warningsSummary 21 keys", { warningsSummary: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["w" + i, 1])) }],
    ["finalNodeId short", { finalNodeId: "f".repeat(31) }], ["finalNodeId uppercase", { finalNodeId: "F".repeat(32) }], ["finalNodeId with slash", { finalNodeId: "a/b" + "f".repeat(29) }], ["finalNodeId number", { finalNodeId: 5 }],
    ["destination wrong type", { destination: { type: "organization", frameworkId: "x" } }], ["destination extra key", { destination: { type: "curriculumFramework", frameworkId: "x", extra: 1 } }],
    ["importer not a string", { importer: 5 }], ["organizationId not a string", { organizationId: 7 }]
  ];
  // first prove the baseline shape (with a MATCHING destination id) is accepted, then every deviation with a matching id is rejected
  await ok(setDoc(batchRef(pa, "shape_ok"), newBatch("orgA", "pa", "shape_ok")));
  for (const [label, extra] of attempts) {
    const id = "shape_" + label.replace(/[^a-z0-9]/gi, "_").slice(0, 30);
    const body = newBatch("orgA", "pa", id, { destination: { type: "curriculumFramework", frameworkId: id }, ...extra });
    await no(setDoc(batchRef(pa, id), body));   // ${label}
  }
  await no(setDoc(batchRef(pa, "pair_mismatch"), newBatch("orgA", "pa", "other_id")));   // destination.frameworkId must equal the batch id
  const missing = newBatch("orgA", "pa", "missing_key"); delete missing.finalNodeId; await no(setDoc(batchRef(pa, "missing_key"), missing));
  const noTs = newBatch("orgA", "pa", "no_ts"); noTs.createdAt = new Date(); await no(setDoc(batchRef(pa, "no_ts"), noTs));
});
test("organization boundary + archived organization: a writer of organization A cannot create for B; nobody (incl. the Platform Admin) creates or updates in an ARCHIVED organization; governance READ survives archiving", async () => {
  await no(setDoc(batchRef(as("oaA"), "x_b"), newBatch("orgB", "oaA", "x_b")));
  await no(setDoc(batchRef(as("capA"), "x_b2"), newBatch("orgB", "capA", "x_b2")));
  await ok(setDoc(batchRef(as("pa"), "x_pa_b"), newBatch("orgB", "pa", "x_pa_b")));   // the Platform Admin governs every ACTIVE organization (same as P3)
  for (const u of ["pa", "oaC", "capC"]) await no(setDoc(batchRef(as(u), "x_c_" + u), newBatch("orgC", u, "x_c_" + u)));
  await seedBatch("c_batch", "orgC");
  for (const u of ["pa", "oaC"]) await ok(getDoc(batchRef(as(u), "c_batch")));          // governance read in an archived organization
  await no(getDoc(batchRef(as("capC"), "c_batch")));                                      // capability holder reads only while the organization is active
  for (const u of ["pa", "oaC"]) await no(updateDoc(batchRef(as(u), "c_batch"), progress()));
});
test("read/list: Platform Admin, Organization Admin and capability holder read their organization's batches; non-writers, other organizations and anonymous cannot; organization-filtered lists work, unfiltered lists are denied to non-admins", async () => {
  await seedBatch("r1", "orgA"); await seedBatch("r2", "orgB");
  for (const u of WRITERS) await ok(getDoc(batchRef(as(u), "r1")));
  for (const u of ["mA", "revA", "oaB", "capB", "tSusp", "noMember"]) await no(getDoc(batchRef(as(u), "r1")));
  await ok(getDoc(batchRef(as("oaB"), "r2"))); await ok(getDoc(batchRef(as("pa"), "r2")));
  await no(getDoc(batchRef(as(null), "r1")));
  const inOrg = (db, org) => getDocs(query(collection(db, "importBatches"), where("organizationId", "==", org), limit(51)));
  assert.equal((await ok(inOrg(as("oaA"), "orgA"))).size, 1); assert.equal((await ok(inOrg(as("pa"), "orgB"))).size, 1);
  await no(inOrg(as("oaA"), "orgB")); await no(inOrg(as("mA"), "orgA"));
  await no(getDocs(query(collection(as("oaA"), "importBatches"), limit(10))));
  await ok(getDocs(query(collection(as("pa"), "importBatches"), where("organizationId", "==", "orgA"), where("destination.frameworkId", "==", "r1"), limit(1))));
});
test("immutability: organizationId, kind, destination, templateId/Version, sourceFile, importer, createdAt, schemaVersion, finalNodeId, counts and chunksTotal can never change; only progress/warnings move while committing", async () => {
  await seedBatch("im1", "orgA");
  const pa = as("pa");
  const tries = [
    ["organizationId", { organizationId: "orgB" }], ["kind", { kind: "question" }], ["destination", { destination: { type: "curriculumFramework", frameworkId: "other" } }], ["templateId", { templateId: "hcma2.questions.xlsx" }],
    ["templateVersion", { templateVersion: 2 }], ["sourceFile", { sourceFile: { name: "z.xlsx", size: 1, sha256: "b".repeat(64) } }], ["importer", { importer: "oaA" }], ["finalNodeId", { finalNodeId: "e".repeat(32) }],
    ["counts", { counts: { parsed: 7, accepted: 7, skipped: 0, failed: 0 } }], ["chunksTotal", { chunksTotal: 2 }], ["schemaVersion", { schemaVersion: 2 }], ["createdAt", { createdAt: new Date() }], ["extra key", { note: 1 }],
    ["stale updatedAt", { chunksDone: 1, updatedAt: new Date() }]
  ];
  for (const [label, fields] of tries) await no(updateDoc(batchRef(pa, "im1"), { ...(label === "stale updatedAt" ? {} : { updatedAt: serverTimestamp() }), ...fields }));
  await ok(updateDoc(batchRef(pa, "im1"), progress()));                                                     // progress: chunksDone 0 -> 1
  await ok(updateDoc(batchRef(as("oaA"), "im1"), { updatedAt: serverTimestamp(), warningsSummary: { W_NUMERIC_CODE: 2 } }));   // another authorized actor may update warnings
  await no(updateDoc(batchRef(pa, "im1"), { chunksDone: 0, updatedAt: serverTimestamp() }));                // chunksDone never decreases
  await no(updateDoc(batchRef(pa, "im1"), { chunksDone: 2, updatedAt: serverTimestamp() }));                // never above chunksTotal
  for (const u of NON_WRITERS) await no(updateDoc(batchRef(as(u), "im1"), progress({ chunksDone: 1 })));
});
test("delete: batches are NEVER deletable by anyone, in any status, including the Platform Admin", async () => {
  for (const status of ["committing", "completed", "partial", "rolled_back"]) {
    const id = "del_" + status; await seedBatch(id, "orgA", status);
    for (const u of [...WRITERS, ...NON_WRITERS]) await no(deleteDoc(batchRef(as(u), id)));
  }
  await seedBatch("del_c", "orgC"); await no(deleteDoc(batchRef(as("pa"), "del_c")));
});
test("status transitions: only committing->(committing|completed|partial|rolled_back) and partial->rolled_back are legal; completed and rolled_back are terminal; partial never goes back", async () => {
  const pa = as("pa");
  // partial / terminal moves that need no witness
  await seedBatch("t1", "orgA", "committing"); await ok(updateDoc(batchRef(pa, "t1"), finish("partial", { resultCode: "ROLLBACK_FAILED" })));
  await no(updateDoc(batchRef(pa, "t1"), progress({ chunksDone: 1 })));                                        // partial cannot return to progress
  await no(updateDoc(batchRef(pa, "t1"), finish("committing")));
  await no(updateDoc(batchRef(pa, "t1"), finish("completed", { chunksDone: 1 })));                            // partial can never become completed
  await seedBatch("t2", "orgA", "completed"); for (const to of ["committing", "partial", "rolled_back", "completed"]) await no(updateDoc(batchRef(pa, "t2"), finish(to)));
  await seedBatch("t3", "orgA", "rolled_back"); for (const to of ["committing", "partial", "completed", "rolled_back"]) await no(updateDoc(batchRef(pa, "t3"), finish(to)));
  await seedBatch("t4", "orgA", "committing"); await no(updateDoc(batchRef(pa, "t4"), { status: "partial", updatedAt: serverTimestamp() }));        // finishedAt required when leaving committing
  await no(updateDoc(batchRef(pa, "t4"), { status: "partial", finishedAt: new Date(), updatedAt: serverTimestamp() }));                           // and it must be the server time
  await no(updateDoc(batchRef(pa, "t4"), { status: "unknown", finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await no(updateDoc(batchRef(pa, "t4"), { ...progress(), resultCode: "X" }));                                                                    // no resultCode while committing
  await no(updateDoc(batchRef(pa, "t4"), { ...progress(), finishedAt: serverTimestamp() }));                                                      // no finishedAt while committing
  await ok(updateDoc(batchRef(as("oaA"), "t4"), finish("partial")));                                                                                // any authorized actor may record recovery states
  await ok(updateDoc(batchRef(as("capA"), "t4"), finish("rolled_back", { resultCode: "MANUAL_RECOVERY" })));                                      // partial -> rolled_back: framework and witness absent
});
test("COMPLETED witness: allowed only when the paired framework exists as a never-activated draft of the SAME organization, the declared witness node exists in it, and chunksDone == chunksTotal; every other combination is denied (the witness is NOT proof of a complete import)", async () => {
  const complete = (db, id, extra = {}) => updateDoc(batchRef(db, id), finish("completed", { chunksDone: 1, ...extra }));
  // framework missing
  await seedBatch("c0"); await no(complete(as("pa"), "c0"));
  // framework exists but the witness node is missing
  await seedBatch("c1"); await seedFw("c1"); await no(complete(as("pa"), "c1"));
  // witness node exists but chunksDone != chunksTotal
  await seedBatch("c2"); await seedFw("c2"); await seedNode("c2", FINAL); await no(updateDoc(batchRef(as("pa"), "c2"), finish("completed", { chunksDone: 0 })));
  // witness in a different organization
  await seedBatch("c3"); await seedFw("c3"); await seedNode("c3", FINAL, "orgB"); await no(complete(as("pa"), "c3"));
  // framework of a different organization
  await seedBatch("c4"); await seedFw("c4", "orgB"); await seedNode("c4", FINAL, "orgB"); await no(complete(as("pa"), "c4"));
  // framework already active / archived / carrying activatedAt
  for (const [id, status, extra] of [["c5", "active", {}], ["c6", "archived", {}], ["c7", "draft", { activatedAt: D(5) }]]) { await seedBatch(id); await seedFw(id, "orgA", status, extra); await seedNode(id, FINAL); await no(complete(as("pa"), id)); }
  // the witness node id is the DECLARED one: another node does not count
  await seedBatch("c8"); await seedFw("c8"); await seedNode("c8", "e".repeat(32)); await no(complete(as("pa"), "c8"));
  // the legitimate case, for each authorized writer; the witness alone satisfies Rules (other nodes are controller-verified, NOT claimed here)
  for (const u of WRITERS) { const id = "ok_" + u; await seedBatch(id); await seedFw(id); await seedNode(id, FINAL); await ok(complete(as(u), id)); const snap = await getDoc(batchRef(as("pa"), id)); assert.equal(snap.data().status, "completed"); }
  for (const u of NON_WRITERS) { const id = "nw_" + u; await seedBatch(id); await seedFw(id); await seedNode(id, FINAL); await no(complete(as(u), id)); }
  // archived organization: even a perfect completion is denied
  await seedBatch("c9", "orgC"); await seedFw("c9", "orgC"); await seedNode("c9", FINAL, "orgC"); await no(complete(as("pa"), "c9"));
  // terminal afterwards
  await no(updateDoc(batchRef(as("pa"), "ok_pa"), finish("rolled_back")));
});
test("ROLLED_BACK witness: allowed only when the paired framework AND the witness node no longer exist (from committing or partial); denied while either remains; terminal afterwards", async () => {
  const back = (db, id) => updateDoc(batchRef(db, id), finish("rolled_back", { resultCode: "COMMIT_FAILED" }));
  await seedBatch("r0"); await seedFw("r0"); await no(back(as("pa"), "r0"));                         // framework remains
  await seedBatch("r1"); await seedFw("r1"); await seedNode("r1", FINAL); await no(back(as("pa"), "r1"));
  await seedBatch("r2"); await seedNode("r2", FINAL); await no(back(as("pa"), "r2"));                 // framework gone but the witness node remains (orphan)
  await seedBatch("r3", "orgA", "partial"); await seedFw("r3"); await no(back(as("pa"), "r3"));
  for (const u of WRITERS) { const id = "ok_" + u; await seedBatch(id); await ok(back(as(u), id)); }  // nothing exists: truthful
  await seedBatch("r4", "orgA", "partial"); await ok(back(as("oaA"), "r4"));
  for (const u of NON_WRITERS) { const id = "nw_" + u; await seedBatch(id); await no(back(as(u), id)); }
  await seedBatch("r5", "orgC"); await no(back(as("pa"), "r5"));                                       // archived organization
  await no(updateDoc(batchRef(as("pa"), "ok_pa"), finish("partial")));                                  // terminal
});
test("AUTHORITATIVE ACTIVATION PROTECTION: a manual framework (no paired batch) activates exactly as in P3; an import-governed draft activates ONLY after its batch is completed (same organization, kind curriculum); incomplete states of every kind are denied", async () => {
  const act = (u, id) => updateDoc(fwRef(as(u), id), fwTransition(u, "active", { activatedAt: serverTimestamp() }));
  // manual frameworks: unaffected for every writer
  for (const u of WRITERS) { await seedFw("m_" + u, "orgA", "draft"); await ok(act(u, "m_" + u)); }
  await seedFw("m_bad", "orgA", "draft"); await no(act("mA", "m_bad"));
  // import-governed: committing / partial / rolled_back batches deny activation, for every writer
  for (const status of ["committing", "partial", "rolled_back"]) for (const u of WRITERS) { const id = "imp_" + status + "_" + u; await seedBatch(id, "orgA", status); await seedFw(id); await no(act(u, id)); }
  // completed batch: allowed for every writer
  for (const u of WRITERS) { const id = "imp_done_" + u; await seedBatch(id, "orgA", "completed"); await seedFw(id); await ok(act(u, id)); assert.equal((await getDoc(fwRef(as("pa"), id))).data().status, "active"); }
  // organization mismatch: the batch belongs to another organization than the framework
  await seedBatch("imp_org", "orgB", "completed"); await seedFw("imp_org", "orgA"); await no(act("pa", "imp_org"));
  // wrong import kind / type
  await seedBatch("imp_kind", "orgA", "completed", { kind: "question" }); await seedFw("imp_kind"); await no(act("pa", "imp_kind"));
  // other lifecycle transitions of an import-governed framework stay governed by P3 (rename/archive/restore not blocked by a completed batch; not required to re-check the batch)
  await ok(updateDoc(fwRef(as("pa"), "imp_done_pa"), fwRename("Khung nhap da kich hoat")));
  const arch = (id) => updateDoc(fwRef(as("pa"), id), fwTransition("pa", "archived"));
  await ok(arch("imp_done_pa"));
  await ok(updateDoc(fwRef(as("pa"), "imp_done_pa"), fwTransition("pa", "active")));
  // a non-completed import framework: rename and node edits stay allowed (P3), activation does not
  await ok(updateDoc(fwRef(as("pa"), "imp_partial_pa"), fwRename("Dang do")));
  await ok(setDoc(nodeRef(as("pa"), "imp_partial_pa", "n1"), newNodePayload("orgA")));
  await no(act("pa", "imp_partial_pa"));
});
test("D14 CLONE LAUNDERING: cloning an import-governed framework is allowed only from a COMPLETED batch; ordinary (unpaired) frameworks clone as before; cross-organization and missing sources stay denied", async () => {
  const cloneOf = (u, src, org = "orgA", extra = {}) => setDoc(doc(collection(as(u), "curriculumFrameworks")), newFwPayload(org, u, { name: "Ban sao", cloneSource: { frameworkId: src, nodeCount: 3 }, ...extra }));
  for (const u of WRITERS) await ok(cloneOf(u, "fwA_active"));                                     // ordinary, active source
  await ok(cloneOf("pa", "fwA_draft")); await ok(cloneOf("pa", "fwA_archived"));
  for (const status of ["committing", "partial", "rolled_back"]) { const id = "src_" + status; await seedBatch(id, "orgA", status); await seedFw(id); for (const u of WRITERS) await no(cloneOf(u, id)); }
  await seedBatch("src_done", "orgA", "completed"); await seedFw("src_done");
  for (const u of WRITERS) await ok(cloneOf(u, "src_done"));
  await seedBatch("src_done_active", "orgA", "completed"); await seedFw("src_done_active", "orgA", "active"); await ok(cloneOf("pa", "src_done_active"));
  // laundering through a batch of another organization / wrong kind
  await seedBatch("src_org", "orgB", "completed"); await seedFw("src_org", "orgA"); await no(cloneOf("pa", "src_org"));
  await seedBatch("src_kind", "orgA", "completed", { kind: "question" }); await seedFw("src_kind"); await no(cloneOf("pa", "src_kind"));
  // unchanged P3 protections
  await no(cloneOf("pa", "fwB_draft")); await no(cloneOf("pa", "no_such_framework")); await no(cloneOf("mA", "fwA_active")); await no(cloneOf("pa", "fwC_active", "orgC"));
  // the clone itself is an UNPAIRED ordinary framework (no batch with its new id): normal activation lifecycle applies
  const ref = doc(collection(as("pa"), "curriculumFrameworks")); await ok(setDoc(ref, newFwPayload("orgA", "pa", { name: "Ban sao tu khung da hoan tat", cloneSource: { frameworkId: "src_done", nodeCount: 1 } })));
  await ok(updateDoc(ref, fwTransition("pa", "active", { activatedAt: serverTimestamp() })));
});
test("never-activated imported drafts stay deletable under the unchanged P3 rules (nodes first, then the framework) in EVERY batch state, and the batch survives; an activated import framework is never deletable", async () => {
  for (const status of ["committing", "partial", "rolled_back", "completed"]) {
    const id = "del_imp_" + status; await seedBatch(id, "orgA", status); await seedFw(id); await seedNode(id, FINAL); await seedNode(id, "n2");
    const db = as("pa"), b = writeBatch(db); b.delete(nodeRef(db, id, FINAL)); b.delete(nodeRef(db, id, "n2")); await ok(b.commit());
    await ok(deleteDoc(fwRef(db, id)));
    assert.equal((await getDoc(batchRef(db, id))).exists(), true, "the batch is kept");
  }
  await seedBatch("act", "orgA", "completed"); await seedFw("act", "orgA", "active"); await seedNode("act", FINAL);
  await no(deleteDoc(fwRef(as("pa"), "act"))); await no(deleteDoc(nodeRef(as("pa"), "act", FINAL)));
  // after a rolled_back batch the paired id is spent: a new framework at that id stays non-activatable (fail-closed), a completed batch's id never blesses anything else
  await seedBatch("spent", "orgA", "rolled_back"); await ok(setDoc(fwRef(as("pa"), "spent"), newFwPayload("orgA", "pa", { name: "Tai su dung id" })));
  await no(updateDoc(fwRef(as("pa"), "spent"), fwTransition("pa", "active", { activatedAt: serverTimestamp() })));
});
test("P3 compatibility on manual frameworks (no paired batch anywhere): create / rename / activate / archive / restore / node writes / delete behave exactly as before for the three writers; non-writers and archived organizations stay denied (no H2)", async () => {
  for (const u of WRITERS) {
    const ref = doc(collection(as(u), "curriculumFrameworks"));
    await ok(setDoc(ref, newFwPayload("orgA", u, { name: "Thu cong " + u })));
    await ok(setDoc(nodeRef(as(u), ref.id, "s1"), newNodePayload("orgA", { name: "Mon 1" })));
    await ok(setDoc(nodeRef(as(u), ref.id, "l1"), lessonPayload("orgA", "s1")));
    await ok(updateDoc(ref, fwRename("Doi ten " + u)));
    await ok(updateDoc(ref, fwTransition(u, "active", { activatedAt: serverTimestamp() })));
    await ok(updateDoc(nodeRef(as(u), ref.id, "l1"), nodeEdit({ order: 2 })));
    await ok(updateDoc(ref, fwTransition(u, "archived")));
    await no(updateDoc(nodeRef(as(u), ref.id, "l1"), nodeEdit({ order: 3 })));
    await ok(updateDoc(ref, fwTransition(u, "active")));
    await no(deleteDoc(ref));
  }
  for (const u of NON_WRITERS) await no(setDoc(doc(collection(as(u), "curriculumFrameworks")), newFwPayload("orgA", u)));
  for (const u of ["pa", "oaC"]) await no(setDoc(doc(collection(as(u), "curriculumFrameworks")), newFwPayload("orgC", u)));
  await ok(deleteDoc(fwRef(as("pa"), "fwA_draft")));          // a never-activated draft is deletable exactly as in P3
  assert.equal((await getDoc(fwRef(as("pa"), "fwA_draftAct"))).exists(), true);
  await no(deleteDoc(fwRef(as("pa"), "fwA_draftAct")));    // a draft that carries activatedAt was activated once: never deletable
});
test("the seeded PRE-EXISTING P3 documents (the same shapes as production-style data created before P4) activate/clone/delete exactly as before: no document-level change is required for any existing framework", async () => {
  // fwA_draft/fwA_active/fwA_archived/fwA_draftAct existed before any batch collection; none of them has a paired batch
  const batchSnap = await getDocs(query(collection(as("pa"), "importBatches"), where("organizationId", "==", "orgA"), limit(5))); assert.equal(batchSnap.size, 0);
  await ok(updateDoc(fwRef(as("pa"), "fwA_draft"), fwTransition("pa", "active", { activatedAt: serverTimestamp() })));
  await ok(updateDoc(fwRef(as("oaA"), "fwA_archived"), fwTransition("oaA", "active")));
  await ok(setDoc(doc(collection(as("capA"), "curriculumFrameworks")), newFwPayload("orgA", "capA", { name: "Ban sao", cloneSource: { frameworkId: "fwA_active", nodeCount: 2 } })));
  await no(setDoc(doc(collection(as("pa"), "curriculumFrameworks")), newFwPayload("orgA", "pa", { name: "Ban sao", cloneSource: { frameworkId: "fwB_draft", nodeCount: 2 } })));   // cross-organization clone source
});
