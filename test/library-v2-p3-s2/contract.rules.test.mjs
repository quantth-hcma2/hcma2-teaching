// LIBRARY V2 P3-S2 - the pure curriculum modules proven against the DEPLOYED P3-S1 Firestore Rules (EXACT artifact, Firestore emulator, synthetic data only).
// Run: firebase emulators:exec --only firestore --project demo-p3s2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p3-s2/contract.rules.test.mjs"
// Direction 1: builder output is ACCEPTED by the Rules for the intended principals/states.  Direction 2: client validation is NOT the security
// boundary - tampered/forged payloads and out-of-state writes that the builders refuse are ALSO denied by the Rules when sent raw.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { collection, doc, query, where, limit, getDocs, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { makeEnv, actors, candidateRules, seedWorld, sha, assertSucceeds, assertFails } from "../library-v2-p3-s1/helpers.mjs";
import { createCurriculumWriteContract } from "../../curriculum-write-contract.mjs";
import { createCurriculumQueries } from "../../curriculum-queries.mjs";
import { validateTree, planSiblingMove, activationReadiness } from "../../curriculum-model.mjs";

const rules = candidateRules();
assert.equal(sha(rules).toUpperCase(), "A0B206FCDDA3843DB2E08EEEEB00A9704B5A1415B97B9E488477D8F21AA4921D", "contract is proven against the deployed P3-S1 Rules artifact");
const env = await makeEnv("demo-p3s2-contract", rules);
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const C = createCurriculumWriteContract({ serverTimestamp });
const Q = createCurriculumQueries({ collection, doc, query, where, limit, getDocs, getDoc });
const ok = (p) => assertSucceeds(p), no = (p) => assertFails(p);
const orgA = { id: "orgA", status: "active" };
const fwRef = (db, id) => doc(db, "curriculumFrameworks", id);
const nodeRef = (db, fw, id) => doc(db, "curriculumFrameworks", fw, "nodes", id);
const nodeNew = (db, fw) => doc(collection(db, "curriculumFrameworks", fw, "nodes"));
const WRITERS = ["pa", "oaA", "capA"];                      // Platform Admin, Organization Admin, capability holder (inert today, admitted by the same guard)

async function createFramework(db, actor, name = "Khung thu nghiem", extra = {}) {
  const ref = doc(collection(db, "curriculumFrameworks"));
  await ok(setDoc(ref, C.buildFrameworkCreate({ organization: orgA, name, ...extra }, actor)));
  return ref.id;
}
const load = async (db, fwId) => ({ framework: await Q.frameworkById(db, fwId, { organizationId: "orgA" }), nodes: (await Q.nodesOfFramework(db, fwId, "orgA")).items });
const ctxOf = async (db, fwId) => ({ organization: orgA, ...(await load(db, fwId)) });

test("framework create: builder output accepted for Platform Admin, Organization Admin and capability holder; denied for ordinary member, other organization, anonymous, suspended", async () => {
  for (const u of WRITERS) await createFramework(as(u), u, "Khung " + u);
  for (const u of ["mA", "revA", "mB", "capB", "oaB", "tSusp", "capSuspMem", "ghost", "noMember"]) await no(setDoc(doc(collection(as(u), "curriculumFrameworks")), C.buildFrameworkCreate({ organization: orgA, name: "Khung" }, u)));
  await no(setDoc(doc(collection(as(null), "curriculumFrameworks")), C.buildFrameworkCreate({ organization: orgA, name: "Khung" }, "pa")));
});
test("framework create: the Rules still deny what the builder refuses (archived organization, forged fields) when sent raw", async () => {
  const pa = as("pa");
  const forged = C.buildFrameworkCreate({ organization: { id: "orgC", status: "active" }, name: "Khung C" }, "pa");   // lie about the organization state to bypass the client check
  await no(setDoc(doc(collection(pa, "curriculumFrameworks")), forged));                                             // orgC is archived: denied even for the Platform Admin
  const base = () => C.buildFrameworkCreate({ organization: orgA, name: "Khung hop le" }, "pa");
  const tampered = [
    { ...base(), scope: "platform" }, { ...base(), status: "active" }, { ...base(), createdBy: "someoneElse" }, { ...base(), createdAt: new Date() }, { ...base(), description: "x" },
    { ...base(), activatedAt: serverTimestamp() }, { ...base(), name: "ab" }, { ...base(), schemaVersion: 2 }
  ];
  for (const payload of tampered) await no(setDoc(doc(collection(pa, "curriculumFrameworks")), payload));
  // a non-admin cannot create in ANOTHER organization even with an otherwise perfect payload (the Platform Admin legitimately can: it governs every active organization)
  await no(setDoc(doc(collection(as("oaA"), "curriculumFrameworks")), { ...C.buildFrameworkCreate({ organization: orgA, name: "Khung" }, "oaA"), organizationId: "orgB" }));
  const missing = base(); delete missing.scope; await no(setDoc(doc(collection(pa, "curriculumFrameworks")), missing));
  await ok(setDoc(doc(collection(pa, "curriculumFrameworks")), base()));
});
test("cloneSource: builder output (same-organization source) accepted; a hand-forged cross-organization or missing source is denied by the Rules", async () => {
  const pa = as("pa");
  const src = await Q.frameworkById(pa, "fwA_active", { organizationId: "orgA" });
  const id = await createFramework(pa, "pa", "Ban sao", { cloneSource: { framework: src, nodeCount: 2 } });
  assert.deepEqual((await Q.frameworkById(pa, id, { organizationId: "orgA" })).cloneSource, { frameworkId: "fwA_active", nodeCount: 2 });
  const ok1 = C.buildFrameworkCreate({ organization: orgA, name: "Ban sao khac", cloneSource: { framework: src, nodeCount: 2 } }, "pa");
  await no(setDoc(doc(collection(pa, "curriculumFrameworks")), { ...ok1, cloneSource: { frameworkId: "fwB_draft", nodeCount: 2 } }));
  await no(setDoc(doc(collection(pa, "curriculumFrameworks")), { ...ok1, cloneSource: { frameworkId: "nope", nodeCount: 2 } }));
  await no(setDoc(doc(collection(pa, "curriculumFrameworks")), { ...ok1, cloneSource: { frameworkId: "fwA_active", nodeCount: 5001 } }));
});

test("full lifecycle through the modules as the Platform Admin: create -> add subject/lessons (builders + real reads) -> reorder -> retire/restore -> validate -> activate -> rename -> archive -> restore", async () => {
  const db = as("pa");
  const fwId = await createFramework(db, "pa", "Chuong trinh Ly luan chinh tri");
  let ctx = await ctxOf(db, fwId);
  assert.equal(ctx.framework.status, "draft"); assert.equal(ctx.framework.scope, "organization"); assert.ok(!("activatedAt" in ctx.framework));
  // nodes: 2 subjects, lessons under the first
  const s1 = nodeNew(db, fwId); await ok(setDoc(s1, C.buildNodeCreate({ kind: "subject", name: "Mon 1", code: "M1" }, ctx)));
  ctx = await ctxOf(db, fwId);
  const s2 = nodeNew(db, fwId); await ok(setDoc(s2, C.buildNodeCreate({ kind: "subject", name: "Mon 2" }, ctx)));
  for (let i = 1; i <= 3; i++) { ctx = await ctxOf(db, fwId); const parent = ctx.nodes.find((x) => x.id === s1.id); await ok(setDoc(nodeNew(db, fwId), C.buildNodeCreate({ parent, kind: "lesson", name: "Bai " + i, code: "B" + i }, ctx))); }
  ctx = await ctxOf(db, fwId);
  assert.equal(ctx.nodes.length, 5); assert.equal(validateTree(ctx.nodes, { organizationId: "orgA" }).valid, true);
  // reorder (one batch of 2 writes)
  const lessons = ctx.nodes.filter((x) => x.parentId === s1.id).sort((a, b) => a.order - b.order);
  const batch = writeBatch(db);
  for (const w of C.buildNodeReorder(planSiblingMove(ctx.nodes, lessons[2].id, "up"), ctx)) batch.update(nodeRef(db, fwId, w.id), w.data);
  await ok(batch.commit());
  ctx = await ctxOf(db, fwId); assert.deepEqual(ctx.nodes.filter((x) => x.parentId === s1.id).sort((a, b) => a.order - b.order).map((x) => x.name), ["Bai 1", "Bai 3", "Bai 2"]);
  assert.equal(validateTree(ctx.nodes, { organizationId: "orgA" }).valid, true);
  // rename / retire / restore / code change
  const l1 = ctx.nodes.find((x) => x.name === "Bai 1");
  await ok(updateDoc(nodeRef(db, fwId, l1.id), C.buildNodeRename(l1, "Bai mot", ctx)));
  ctx = await ctxOf(db, fwId); await ok(updateDoc(nodeRef(db, fwId, l1.id), C.buildNodeRetire(ctx.nodes.find((x) => x.id === l1.id), ctx)));
  ctx = await ctxOf(db, fwId); await ok(updateDoc(nodeRef(db, fwId, l1.id), C.buildNodeRestore(ctx.nodes.find((x) => x.id === l1.id), ctx)));
  ctx = await ctxOf(db, fwId); await ok(updateDoc(nodeRef(db, fwId, l1.id), C.buildNodeCodeChange(ctx.nodes.find((x) => x.id === l1.id), "BX", ctx)));
  // activation precondition then activate
  ctx = await ctxOf(db, fwId);
  assert.equal(activationReadiness(ctx.framework, ctx.nodes, { organization: orgA }).ready, true);
  await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkActivate(ctx.framework, "pa", { organization: orgA, nodes: ctx.nodes })));
  ctx = await ctxOf(db, fwId); assert.equal(ctx.framework.status, "active"); assert.ok("activatedAt" in ctx.framework); const firstActivation = ctx.framework.activatedAt.toMillis();
  // an ACTIVE framework still accepts new nodes and renames
  await ok(setDoc(nodeNew(db, fwId), C.buildNodeCreate({ kind: "subject", name: "Mon 3" }, ctx)));
  ctx = await ctxOf(db, fwId); await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkRename(ctx.framework, "Chuong trinh LLCT 2026", { organization: orgA })));
  // archive -> read-only -> restore (activatedAt unchanged)
  ctx = await ctxOf(db, fwId); await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkArchive(ctx.framework, "pa", { organization: orgA })));
  ctx = await ctxOf(db, fwId); assert.equal(ctx.framework.status, "archived");
  assert.throws(() => C.buildNodeCreate({ kind: "subject", name: "X" }, ctx), (e) => e.code === "FRAMEWORK_READ_ONLY");              // client refuses
  await no(setDoc(nodeNew(db, fwId), { ...C.buildNodeCreate({ kind: "subject", name: "X" }, { ...ctx, framework: { ...ctx.framework, status: "active" } }) }));   // forged raw write: Rules deny
  await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkRestore(ctx.framework, "pa", { organization: orgA })));
  ctx = await ctxOf(db, fwId); assert.equal(ctx.framework.status, "active"); assert.equal(ctx.framework.activatedAt.toMillis(), firstActivation);
  // an activated framework can never be deleted
  await no(deleteDoc(fwRef(db, fwId)));
});
test("lifecycle writes: capability holder and Organization Admin may run the same builder output; ordinary members and other organizations may not", async () => {
  for (const u of ["oaA", "capA"]) {
    const db = as(u); const fwId = await createFramework(db, u, "Khung " + u);
    let ctx = await ctxOf(db, fwId); await ok(setDoc(nodeNew(db, fwId), C.buildNodeCreate({ kind: "subject", name: "Mon" }, ctx)));
    ctx = await ctxOf(db, fwId); await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkActivate(ctx.framework, u, { organization: orgA, nodes: ctx.nodes })));
  }
  const pa = as("pa"); const fwId = await createFramework(pa, "pa", "Khung rieng"); const ctx = await ctxOf(pa, fwId);
  for (const u of ["mA", "revA", "mB", "oaB", "capB", "tSusp", "noMember"]) {
    const db = as(u);
    await no(setDoc(nodeNew(db, fwId), C.buildNodeCreate({ kind: "subject", name: "Mon" }, ctx)));
    await no(updateDoc(fwRef(db, fwId), C.buildFrameworkRename(ctx.framework, "Doi ten", { organization: orgA })));
    await no(updateDoc(fwRef(db, fwId), { ...C.buildFrameworkRename(ctx.framework, "Doi ten", { organization: orgA }) }));
  }
});

test("node depth and structure: depth-4 builder output accepted; a hand-forged 5th level, self-in-ancestors and parent mismatch are denied by the Rules", async () => {
  const db = as("pa"); const fwId = await createFramework(db, "pa");
  let parent = null;
  const ids = [];
  for (let level = 1; level <= 4; level++) {
    const ctx = await ctxOf(db, fwId);
    const ref = nodeNew(db, fwId);
    await ok(setDoc(ref, C.buildNodeCreate({ id: ref.id, parent: parent && ctx.nodes.find((x) => x.id === parent), kind: level === 1 ? "subject" : level === 4 ? "lesson" : "unit", name: "Cap " + level }, ctx)));
    parent = ref.id; ids.push(ref.id);
  }
  const ctx = await ctxOf(db, fwId);
  assert.equal(validateTree(ctx.nodes, { organizationId: "orgA" }).valid, true); assert.equal(ctx.nodes.find((x) => x.id === ids[3]).ancestors.length, 3);
  assert.throws(() => C.buildNodeCreate({ parent: ctx.nodes.find((x) => x.id === ids[3]), kind: "lesson", name: "Cap 5" }, ctx), (e) => e.code === "DEPTH_EXCEEDED");
  const d4 = ctx.nodes.find((x) => x.id === ids[3]);
  const forged = { ...C.buildNodeCreate({ kind: "subject", name: "Cap 5" }, ctx), parentId: ids[3], ancestors: [...d4.ancestors, ids[3]], kind: "lesson", order: 5 };
  await no(setDoc(nodeNew(db, fwId), forged));
  const ref = nodeNew(db, fwId); const base = C.buildNodeCreate({ kind: "subject", name: "Gia mao", order: 6 }, ctx);
  await no(setDoc(ref, { ...base, parentId: ref.id, ancestors: [ref.id] }));                       // own id as parent
  await no(setDoc(ref, { ...base, parentId: ids[0], ancestors: [ref.id, ids[0]] }));               // own id in ancestors
  await no(setDoc(nodeNew(db, fwId), { ...base, parentId: ids[0], ancestors: [] }));               // parent without ancestors
  await no(setDoc(nodeNew(db, fwId), { ...base, parentId: ids[1], ancestors: [ids[0]] }));         // parent is not the last ancestor
  await no(setDoc(nodeNew(db, fwId), { ...base, organizationId: "orgB" }));                         // organization differs from the framework
  await no(setDoc(nodeNew(db, fwId), { ...base, kind: "chapter" })); await no(setDoc(nodeNew(db, fwId), { ...base, status: "retired" }));
  await no(setDoc(nodeNew(db, fwId), { ...base, frameworkId: fwId })); await no(setDoc(nodeNew(db, fwId), { ...base, createdAt: new Date() }));
  await no(setDoc(nodeNew(db, fwId), { ...base, order: -1 })); await no(setDoc(nodeNew(db, fwId), { ...base, code: "" }));
  await ok(setDoc(nodeNew(db, fwId), base));                                                        // the untampered builder output is fine
});
test("node updates: builder output accepted; every immutable field named by the contract is also denied by the Rules when sent raw", async () => {
  const db = as("pa"); const fwId = await createFramework(db, "pa");
  let ctx = await ctxOf(db, fwId);
  const ref = nodeNew(db, fwId); await ok(setDoc(ref, C.buildNodeCreate({ kind: "subject", name: "Mon 1", code: "M1" }, ctx)));
  ctx = await ctxOf(db, fwId); const node = ctx.nodes[0];
  await ok(updateDoc(ref, C.buildNodeUpdate(node, { name: "Mon 1 moi", code: "M2", order: 4, status: "retired" }, ctx)));
  for (const [field, value] of [["organizationId", "orgB"], ["kind", "unit"], ["parentId", "x"], ["ancestors", ["x"]], ["createdAt", new Date()], ["schemaVersion", 2], ["frameworkId", fwId], ["childCount", 1]]) {
    assert.throws(() => C.buildNodeUpdate(node, { [field]: value }, ctx), (e) => ["IMMUTABLE_FIELD", "UNKNOWN_FIELD"].includes(e.code));   // the contract names the field...
    await no(updateDoc(ref, { [field]: value, updatedAt: serverTimestamp() }));                                                           // ...and the Rules deny it anyway
  }
  await no(updateDoc(ref, { name: "Gio client", updatedAt: new Date() }));
});
test("framework transitions: only the three lifecycle transitions are accepted (builder output), every other raw transition is denied; activatedAt is stamped once and immutable", async () => {
  const db = as("pa"); const fwId = await createFramework(db, "pa"); let ctx = await ctxOf(db, fwId);
  await ok(setDoc(nodeNew(db, fwId), C.buildNodeCreate({ kind: "subject", name: "Mon" }, ctx))); ctx = await ctxOf(db, fwId);
  const meta = (status) => ({ status, statusChangedAt: serverTimestamp(), statusChangedBy: "pa", updatedAt: serverTimestamp() });
  await no(updateDoc(fwRef(db, fwId), meta("archived")));                                           // draft -> archived
  await no(updateDoc(fwRef(db, fwId), meta("active")));                                             // activation without activatedAt
  await no(updateDoc(fwRef(db, fwId), { ...C.buildFrameworkActivate(ctx.framework, "pa", { organization: orgA, nodes: ctx.nodes }), name: "Doi ten cung luc" }));
  await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkActivate(ctx.framework, "pa", { organization: orgA, nodes: ctx.nodes })));
  ctx = await ctxOf(db, fwId);
  await no(updateDoc(fwRef(db, fwId), meta("draft")));                                              // active -> draft
  await no(updateDoc(fwRef(db, fwId), { ...C.buildFrameworkArchive(ctx.framework, "pa", { organization: orgA }), activatedAt: serverTimestamp() }));   // re-stamp activatedAt
  await no(updateDoc(fwRef(db, fwId), { name: "Ten moi", activatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  for (const field of ["organizationId", "scope", "createdBy", "createdAt", "cloneSource"]) await no(updateDoc(fwRef(db, fwId), { [field]: field === "createdAt" ? new Date() : field === "cloneSource" ? { frameworkId: "fwA_active", nodeCount: 1 } : "x", updatedAt: serverTimestamp() }));
  await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkArchive(ctx.framework, "pa", { organization: orgA })));
  ctx = await ctxOf(db, fwId);
  await no(updateDoc(fwRef(db, fwId), { ...meta("draft") })); await no(updateDoc(fwRef(db, fwId), { name: "Ten khi luu tru", updatedAt: serverTimestamp() }));
  await ok(updateDoc(fwRef(db, fwId), C.buildFrameworkRestore(ctx.framework, "pa", { organization: orgA })));
});

test("HONEST LIMIT: the Rules do NOT enforce code uniqueness - the client policy (canonical comparison) is the only guard; a raw write with a canonically duplicate code is accepted and then detected by validateTree", async () => {
  const db = as("pa"); const fwId = await createFramework(db, "pa"); let ctx = await ctxOf(db, fwId);
  const first = nodeNew(db, fwId); await ok(setDoc(first, C.buildNodeCreate({ kind: "subject", name: "Mon 1", code: "B01" }, ctx)));
  ctx = await ctxOf(db, fwId);
  assert.throws(() => C.buildNodeCreate({ kind: "subject", name: "Mon 2", code: " b01 " }, ctx), (e) => e.code === "DUPLICATE_CODE");        // the builder refuses
  const forged = { ...C.buildNodeCreate({ kind: "subject", name: "Mon 2", code: "B02" }, ctx), code: " b01 " };                               // raw payload, same Rules-valid shape
  await ok(setDoc(nodeNew(db, fwId), { ...forged, code: "b01" }));                                                                             // two concurrent clients could do exactly this: Rules accept it
  ctx = await ctxOf(db, fwId);
  const tree = validateTree(ctx.nodes, { organizationId: "orgA" });
  assert.deepEqual(tree.issues.map((i) => i.code), ["DUPLICATE_CODE"]);                                                                       // ...and the client domain check flags it
  assert.equal(activationReadiness(ctx.framework, ctx.nodes, { organization: orgA }).ready, false);
  assert.throws(() => C.buildFrameworkActivate(ctx.framework, "pa", { organization: orgA, nodes: ctx.nodes }), (e) => e.code === "NOT_READY");
});
test("real read adapters under the Rules: frameworks and nodes load for the Platform Admin, Organization Admin and capability holder; every other principal is denied; results validate", async () => {
  const pa = as("pa"); const fwId = await createFramework(pa, "pa"); let ctx = await ctxOf(pa, fwId);
  await ok(setDoc(nodeNew(pa, fwId), C.buildNodeCreate({ kind: "subject", name: "Mon" }, ctx)));
  for (const u of WRITERS) {
    const db = as(u);
    const list = await Q.frameworksOfOrganization(db, "orgA"); assert.ok(list.items.length >= 5); assert.equal(list.truncated, false); assert.ok(list.items.every((f) => f.organizationId === "orgA"));
    const nodes = await Q.nodesOfFramework(db, fwId, "orgA"); assert.equal(nodes.items.length, 1); assert.equal(validateTree(nodes.items, { organizationId: "orgA" }).valid, true);
    assert.equal((await Q.frameworkById(db, fwId, { organizationId: "orgA" })).id, fwId);
  }
  // a MISSING framework: the Platform Admin gets null; a non-admin reading a non-existent document is denied by the Rules (resource is null) - the UI treats both as not found
  assert.equal(await Q.frameworkById(pa, "does-not-exist"), null); await assert.rejects(Q.frameworkById(as("oaA"), "does-not-exist"), (e) => e.code === "permission-denied");
  for (const u of ["mA", "revA", "mB", "capB", "oaB", "tSusp", "capSuspMem", "ghost", "noMember"]) {
    await assert.rejects(Q.frameworksOfOrganization(as(u), "orgA")); await assert.rejects(Q.nodesOfFramework(as(u), fwId, "orgA")); await assert.rejects(Q.frameworkById(as(u), fwId));
  }
  await assert.rejects(Q.frameworksOfOrganization(as(null), "orgA"));
  // cross-organization: org B administrator reads org B, never org A; asking for org A's id with org B's credentials is denied
  assert.equal((await Q.frameworksOfOrganization(as("oaB"), "orgB")).items.length, 1);
  await assert.rejects(Q.frameworksOfOrganization(as("oaB"), "orgA")); await assert.rejects(Q.nodesOfFramework(as("oaB"), "fwB_draft", "orgA"));
  // Platform Admin asking for the wrong organization still gets refused by the adapter's consistency check
  await assert.rejects(Q.frameworkById(pa, "fwB_draft", { organizationId: "orgA" }), (e) => e.code === "ORGANIZATION_MISMATCH");
  // archived organization: governance read for the Organization Admin, none for the capability holder; writes denied for all (even forged)
  assert.equal((await Q.frameworksOfOrganization(as("oaC"), "orgC")).items.length, 2); await assert.rejects(Q.frameworksOfOrganization(as("capC"), "orgC"));
  const forged = C.buildFrameworkCreate({ organization: { id: "orgC", status: "active" }, name: "Khung C" }, "oaC");
  await no(setDoc(doc(collection(as("oaC"), "curriculumFrameworks")), forged)); await no(setDoc(doc(collection(as("pa"), "curriculumFrameworks")), { ...forged, createdBy: "pa" }));
});
