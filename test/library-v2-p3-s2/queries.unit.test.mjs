// LIBRARY V2 P3-S2 - curriculum-queries.mjs (read adapters) against a recording fake Firestore. The real-Firestore proof against the deployed Rules
// is in contract.rules.test.mjs. Index discipline: every recorded query must be ONE organizationId equality + limit only (automatic single-field index).
import test from "node:test";
import assert from "node:assert/strict";
import { createCurriculumQueries, CURRICULUM_COLLECTION, CURRICULUM_NODES_SUBCOLLECTION } from "../../curriculum-queries.mjs";
import { CurriculumContractError, FRAMEWORK_LIST_LIMIT, CURRICULUM_MAX_NODES } from "../../curriculum-model.mjs";

function fake(fixtures = {}) {
  const log = [];
  const snap = (id, data) => ({ id, data: () => data, exists: () => true });
  const api = {
    collection: (db, ...path) => ({ kind: "collection", path }),
    doc: (db, ...path) => ({ kind: "doc", path }),
    where: (field, op, value) => ({ type: "where", field, op, value }),
    limit: (n) => ({ type: "limit", n }),
    query: (source, ...constraints) => ({ source, constraints }),
    getDocs: async (q) => { log.push({ kind: "getDocs", path: q.source.path.join("/"), constraints: q.constraints }); const rows = (fixtures[q.source.path.join("/")] || []); const lim = q.constraints.find((c) => c.type === "limit").n; return { docs: rows.slice(0, lim).map((r) => snap(r.id, r.data)) }; },
    getDoc: async (ref) => { log.push({ kind: "getDoc", path: ref.path.join("/") }); const row = (fixtures[ref.path.slice(0, -1).join("/")] || []).find((r) => r.id === ref.path.at(-1)); return row ? snap(row.id, row.data) : { id: ref.path.at(-1), exists: () => false, data: () => undefined }; }
  };
  return { api, log, db: { fake: true } };
}
const fwRow = (id, org = "orgA", status = "draft", sec = 1) => ({ id, data: { organizationId: org, status, name: "K " + id, createdAt: { seconds: sec, nanoseconds: 0 } } });
const nodeRow = (id, org = "orgA") => ({ id, data: { organizationId: org, kind: "subject", parentId: null, ancestors: [], order: 0, code: null, name: "N", status: "active" } });
const rows = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const only = (constraints) => constraints.map((c) => c.type + (c.field ? ":" + c.field + c.op + c.value : c.n !== undefined ? ":" + c.n : ""));

test("construction requires every injected Firestore function; orderBy/startAfter/documentId are NOT needed (no ordering, no cursor, no composite index)", () => {
  const { api } = fake();
  assert.ok(createCurriculumQueries(api)); assert.ok(Object.isFrozen(createCurriculumQueries(api)));
  for (const name of ["collection", "doc", "query", "where", "limit", "getDocs", "getDoc"]) assert.throws(() => createCurriculumQueries({ ...api, [name]: undefined }), (e) => e instanceof TypeError && e.message.includes(name));
  assert.deepEqual(Object.keys(createCurriculumQueries(api)).sort(), ["frameworkById", "frameworksOfOrganization", "nodesOfFramework"]);   // no cross-organization / collection-group / listing-all function exists
  assert.equal(CURRICULUM_COLLECTION, "curriculumFrameworks"); assert.equal(CURRICULUM_NODES_SUBCOLLECTION, "nodes");
});

test("Q1 frameworksOfOrganization: ONE equality on organizationId + limit(101), nothing else; sorted client-side; honest truncation flag", async () => {
  const { api, log, db } = fake({ curriculumFrameworks: [fwRow("d1", "orgA", "draft", 5), fwRow("a1", "orgA", "active", 1), fwRow("z", "orgA", "archived", 9), fwRow("a2", "orgA", "active", 7)] });
  const q = createCurriculumQueries(api);
  const r = await q.frameworksOfOrganization(db, "orgA");
  assert.deepEqual(only(log[0].constraints), ["where:organizationId==orgA", "limit:101"]); assert.equal(log[0].path, "curriculumFrameworks");
  assert.deepEqual(r.items.map((x) => x.id), ["a2", "a1", "d1", "z"]); assert.equal(r.truncated, false); assert.equal(r.limit, 100);
  assert.deepEqual(r.items[0], { id: "a2", organizationId: "orgA", status: "active", name: "K a2", createdAt: { seconds: 7, nanoseconds: 0 } });
  const exactly = createCurriculumQueries(fake({ curriculumFrameworks: rows(100, (i) => fwRow("f" + i)) }).api);
  assert.equal((await exactly.frameworksOfOrganization({}, "orgA")).truncated, false);
  const over = fake({ curriculumFrameworks: rows(150, (i) => fwRow("f" + i)) });
  const t = await createCurriculumQueries(over.api).frameworksOfOrganization(over.db, "orgA");
  assert.equal(t.items.length, FRAMEWORK_LIST_LIMIT); assert.equal(t.truncated, true);      // 101 fetched, 100 shown, flagged
  assert.equal(over.log[0].constraints.find((c) => c.type === "limit").n, 101);
  const empty = await createCurriculumQueries(fake().api).frameworksOfOrganization({}, "orgA");
  assert.deepEqual([empty.items, empty.truncated], [[], false]);
});
test("Q1 refuses data of another organization even if the backend returned it (Platform Admin safety, I2/I6)", async () => {
  const { api, db } = fake({ curriculumFrameworks: [fwRow("a", "orgA"), fwRow("b", "orgB")] });
  await assert.rejects(createCurriculumQueries(api).frameworksOfOrganization(db, "orgA"), (e) => e instanceof CurriculumContractError && e.code === "ORGANIZATION_MISMATCH");
});
test("organization ids must be exactly ONE valid id string (no arrays, objects, empty, path separators, multi-organization)", async () => {
  const { api, db } = fake(); const q = createCurriculumQueries(api);
  for (const bad of [undefined, null, "", "a/b", ["orgA"], ["orgA", "orgB"], { id: "orgA" }, 5, "x".repeat(129)]) {
    await assert.rejects(q.frameworksOfOrganization(db, bad), TypeError); await assert.rejects(q.nodesOfFramework(db, "fw", bad), TypeError);
    if (bad !== undefined) await assert.rejects(q.frameworkById(db, "fw", { organizationId: bad }), TypeError);   // undefined = no consistency check requested
  }
  for (const bad of [undefined, "", "a/b", ["fw"], {}, 5]) { await assert.rejects(q.nodesOfFramework(db, bad, "orgA"), TypeError); await assert.rejects(q.frameworkById(db, bad), TypeError); }
});

test("Q2 frameworkById: getDoc of the framework path; null when missing; refuses another organization's framework when an organization is given", async () => {
  const { api, log, db } = fake({ curriculumFrameworks: [fwRow("f1", "orgA"), fwRow("f2", "orgB")] });
  const q = createCurriculumQueries(api);
  assert.equal((await q.frameworkById(db, "f1")).id, "f1"); assert.deepEqual(log[0], { kind: "getDoc", path: "curriculumFrameworks/f1" });
  assert.equal((await q.frameworkById(db, "f1", { organizationId: "orgA" })).organizationId, "orgA");
  assert.equal(await q.frameworkById(db, "missing"), null);
  await assert.rejects(q.frameworkById(db, "f2", { organizationId: "orgA" }), (e) => e.code === "ORGANIZATION_MISMATCH");
  assert.equal((await q.frameworkById(db, "f2")).organizationId, "orgB");                     // without an organization the caller did not ask for the check
});

test("Q3 nodesOfFramework: subcollection path, ONE equality on organizationId + limit(5001), no orderBy; tree-size flag; foreign nodes refused", async () => {
  const { api, log, db } = fake({ "curriculumFrameworks/fw1/nodes": [nodeRow("n1"), nodeRow("n2")] });
  const q = createCurriculumQueries(api);
  const r = await q.nodesOfFramework(db, "fw1", "orgA");
  assert.equal(log[0].path, "curriculumFrameworks/fw1/nodes"); assert.deepEqual(only(log[0].constraints), ["where:organizationId==orgA", "limit:5001"]);
  assert.deepEqual(r.items.map((x) => x.id), ["n1", "n2"]); assert.equal(r.tooLarge, false); assert.equal(r.limit, 5000);
  const exact = fake({ "curriculumFrameworks/fw1/nodes": rows(5000, (i) => nodeRow("n" + i)) });
  const e = await createCurriculumQueries(exact.api).nodesOfFramework(exact.db, "fw1", "orgA");
  assert.equal(e.items.length, 5000); assert.equal(e.tooLarge, false);
  const big = fake({ "curriculumFrameworks/fw1/nodes": rows(5600, (i) => nodeRow("n" + i)) });
  const b = await createCurriculumQueries(big.api).nodesOfFramework(big.db, "fw1", "orgA");
  assert.equal(b.items.length, CURRICULUM_MAX_NODES); assert.equal(b.tooLarge, true);
  const mixed = fake({ "curriculumFrameworks/fw1/nodes": [nodeRow("n1"), nodeRow("x", "orgB")] });
  await assert.rejects(createCurriculumQueries(mixed.api).nodesOfFramework(mixed.db, "fw1", "orgA"), (err) => err.code === "ORGANIZATION_MISMATCH");
});

test("INDEX DISCIPLINE: across every adapter call, every recorded query is exactly [where organizationId ==, limit] - an equality on one field without ordering is served by the automatic single-field index (zero composite indexes)", async () => {
  const f = fake({ curriculumFrameworks: [fwRow("f1")], "curriculumFrameworks/f1/nodes": [nodeRow("n1")] });
  const q = createCurriculumQueries(f.api);
  await q.frameworksOfOrganization(f.db, "orgA"); await q.nodesOfFramework(f.db, "f1", "orgA"); await q.frameworkById(f.db, "f1", { organizationId: "orgA" });
  const queries = f.log.filter((x) => x.kind === "getDocs");
  assert.equal(queries.length, 2);
  for (const x of queries) {
    assert.equal(x.constraints.length, 2);
    assert.deepEqual(x.constraints.map((c) => c.type), ["where", "limit"]);
    assert.deepEqual([x.constraints[0].field, x.constraints[0].op], ["organizationId", "=="]);
  }
  assert.equal(f.log.filter((x) => x.kind === "getDoc").length, 1);
});
