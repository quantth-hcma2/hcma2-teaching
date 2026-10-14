// P4-S5-B - duplicate-file lookup (controller.findCompletedBySourceHash) against the LIVE Rules bytes on the emulator: only COMPLETED imports count; mixed statuses and result limits can never hide a
// completed import; organization isolation; authorization; an unknown answer is never "none". Synthetic data only. The Rules are NOT modified; no index is involved (equality filters only).
// Run: firebase emulators:exec --only firestore --project demo-p5b-dup --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s5/duplicate.rules.test.mjs"   (Java 21)
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, seedWorld, doc, setDoc } from "../library-v2-p3-s1/helpers.mjs";
import { createImportCommitController, DUPLICATE_LOOKUP_LIMIT, DUPLICATE_SHOWN } from "../../import-commit-controller.mjs";
import { toBatchCreatePayload } from "../../import-plan.mjs";
import { BASE_FS, big, planFor, noSleep, freezeCandidateRules } from "../library-v2-p4-s4/helpers.mjs";

const env = await makeEnv("demo-p5b-dup", freezeCandidateRules());      // asserts SHA-256 F6B9DE01... == the live ruleset
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });
const SHA = "a".repeat(64), OTHER = "b".repeat(64);
const plan = planFor(big(2, 3), { batchId: "seedPlanBatch0000001", actorUid: "pa" });
const pad = (n, w = 6) => String(n).padStart(w, "0");
const finished = (day) => new Date(Date.UTC(2026, 9, day, 3, 0, 0));
async function seed(rows) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const { id, org = "orgA", status, sha = SHA, day = 9, accepted = 10 } of rows) {
      const base = toBatchCreatePayload({ ...plan, batch: { ...plan.batch, id, organizationId: org, destination: { ...plan.batch.destination, frameworkId: id } } }, { actorUid: "pa", serverTimestamp: () => new Date() });
      await setDoc(doc(db, "importBatches/" + id), { ...base, status, organizationId: org, sourceFile: { ...plan.batch.sourceFile, sha256: sha }, counts: { ...base.counts, accepted }, ...(status === "committing" ? {} : { finishedAt: finished(day) }) });
    }
  });
}
const ctl = (uid, fs = BASE_FS) => createImportCommitController({ db: as(uid), firestore: fs, retryDelays: [0, 0], sleep: noSleep, lookupTimeoutMs: 3000 });
const many = (prefix, count, status, extra = {}) => Array.from({ length: count }, (_, i) => ({ id: prefix + pad(i), status, ...extra }));

test("ONLY COMPLETED COUNT: rolled_back, partial and committing batches of the same file never make a duplicate", async () => {
  await seed([{ id: "rb00000000000000001", status: "rolled_back" }, { id: "pt00000000000000001", status: "partial" }, { id: "cm00000000000000001", status: "committing" }]);
  const r = await ctl("pa").findCompletedBySourceHash("orgA", SHA); assert.equal(r.ok, true); assert.equal(r.found, false); assert.equal(r.count, 0); assert.deepEqual([...r.items], []);
  await seed([{ id: "ok00000000000000001", status: "completed" }]);
  const s = await ctl("pa").findCompletedBySourceHash("orgA", SHA); assert.equal(s.found, true); assert.equal(s.count, 1); assert.equal(s.items[0].id, "ok00000000000000001"); assert.equal(s.items[0].nodes, 10); assert.equal(s.more, false);
});
test("MIXED STATUSES + RESULT LIMIT: one completed import hidden among 70 rolled_back / partial / committing batches of the same file (ids sorting before AND after it) is still found", async () => {
  await seed([...many("aa", 30, "rolled_back"), ...many("zz", 25, "partial"), ...many("mm", 15, "committing"), { id: "mid00000000000000001", status: "completed", accepted: 77 }]);
  for (const uid of ["pa", "oaA", "capA"]) { const r = await ctl(uid).findCompletedBySourceHash("orgA", SHA); assert.equal(r.ok, true, uid); assert.equal(r.found, true, uid); assert.equal(r.count, 1); assert.equal(r.items[0].id, "mid00000000000000001"); assert.equal(r.items[0].nodes, 77); }
});
test("PAGINATION / MANY COMPLETED: with more completed imports than the lookup limit the answer is still `found`, flags `more`, shows at most 5, newest first", async () => {
  await seed(Array.from({ length: 15 }, (_, i) => ({ id: "dd" + pad(i, 18), status: "completed", day: 1 + i })));
  const r = await ctl("pa").findCompletedBySourceHash("orgA", SHA);
  assert.equal(r.ok, true); assert.equal(r.found, true); assert.equal(r.count, DUPLICATE_LOOKUP_LIMIT); assert.equal(r.more, true); assert.equal(r.items.length, DUPLICATE_SHOWN);
  const millis = r.items.map((i) => i.finishedAt.toMillis()); assert.deepEqual(millis, [...millis].sort((a, b) => b - a), "newest first");
});
test("ORGANIZATION ISOLATION: a completed import of ANOTHER organization or of ANOTHER file is never reported; querying another organization is denied (UNKNOWN, not 'none')", async () => {
  await seed([{ id: "ob00000000000000001", org: "orgB", status: "completed" }, { id: "ot00000000000000001", status: "completed", sha: OTHER }]);
  const own = await ctl("pa").findCompletedBySourceHash("orgA", SHA); assert.equal(own.ok, true); assert.equal(own.found, false);
  const cross = await ctl("oaA").findCompletedBySourceHash("orgB", SHA); assert.equal(cross.ok, false); assert.equal(cross.kind, "permission");
  const b = await ctl("pa").findCompletedBySourceHash("orgB", SHA); assert.equal(b.found, true); assert.equal(b.items[0].id, "ob00000000000000001");
});
test("AUTHORIZATION: Platform Admin, Organization Admin and curriculum.manage holder can look up; a plain member, a non-member, another organization's admin and an unfiltered query are denied - and a denial is UNKNOWN (ok:false), never 'no duplicate'", async () => {
  await seed([{ id: "ok00000000000000001", status: "completed" }]);
  for (const uid of ["pa", "oaA", "capA"]) assert.equal((await ctl(uid).findCompletedBySourceHash("orgA", SHA)).found, true, uid);
  for (const uid of ["mA", "noMember", "oaB"]) { const r = await ctl(uid).findCompletedBySourceHash("orgA", SHA); assert.equal(r.ok, false, uid); assert.equal(r.kind, "permission", uid); assert.equal(r.found, undefined); }
});
test("UNKNOWN IS NEVER 'NONE': an unreachable server (transient failure), invalid input and a hung read all return ok:false", async () => {
  const offline = { ...BASE_FS, getDocsFromServer: async () => { throw Object.assign(new Error("unavailable"), { code: "unavailable" }); } };
  const t = await ctl("pa", offline).findCompletedBySourceHash("orgA", SHA); assert.equal(t.ok, false); assert.equal(t.kind, "transient");
  const hung = { ...BASE_FS, getDocsFromServer: () => new Promise(() => {}) };
  const h = await ctl("pa", hung).findCompletedBySourceHash("orgA", SHA); assert.equal(h.ok, false); assert.equal(h.kind, "transient");
  for (const [org, sha] of [["", SHA], ["orgA", "short"], ["orgA", "A".repeat(64)], ["orgA", null], ["a/b", SHA]]) { const r = await ctl("pa").findCompletedBySourceHash(org, sha); assert.equal(r.ok, false); assert.equal(r.kind, "invalid"); }
});
test("QUERY SHAPE (no index): exactly three equality filters (organizationId, sourceFile.sha256, status == completed) and a limit; no orderBy, no range, no `in`", async () => {
  const seen = [];
  const spy = { ...BASE_FS, where: (field, op, value) => { seen.push(["where", field, op, value]); return BASE_FS.where(field, op, value); }, orderBy: (...a) => { seen.push(["orderBy"]); return BASE_FS.orderBy(...a); }, limit: (n) => { seen.push(["limit", n]); return BASE_FS.limit(n); } };
  await seed([{ id: "ok00000000000000001", status: "completed" }]);
  await ctl("pa", spy).findCompletedBySourceHash("orgA", SHA);
  assert.deepEqual(seen, [["where", "organizationId", "==", "orgA"], ["where", "sourceFile.sha256", "==", SHA], ["where", "status", "==", "completed"], ["limit", DUPLICATE_LOOKUP_LIMIT]]);
});
