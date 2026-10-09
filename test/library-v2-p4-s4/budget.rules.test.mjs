// P4-S4 RULES DESIGN GATE - worst-case Rules DOCUMENT-ACCESS budget (emulator enforces the Firestore limits: 10 distinct document-access calls per single request, 20 per batch commit).
// Method: test-only in-memory copies of the Rules get K extra, distinct, harmless exists() probes appended to the node rule under test; the largest K that still succeeds is the remaining
// document-access headroom. Production artifact versus the FINAL import-freeze copy, for the worst-case writer (curriculum.manage holder: nothing short-circuits) and Platform Admin,
// for a single write and for the 400-write atomic batches the import and P3 actually use. Not a regression suite: it prints a table; assertions only guard "the amendment never exhausts the budget".
// Run: firebase emulators:exec --only firestore --project demo-p4s4b --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/budget.rules.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, actors, candidateRules, seedWorld, assertSucceeds, doc, setDoc, deleteDoc, writeBatch, lessonPayload, sha } from "../library-v2-p3-s1/helpers.mjs";
import { toBatchCreatePayload } from "../../import-plan.mjs";
import { big, planFor, BATCH } from "./helpers.mjs";
import { freezeCandidateRules, deployedRulesText } from "./helpers.mjs";

void sha; void candidateRules;
const base = deployedRulesText();                                 // production = the deployed ruleset text
const MAXK = 12;
const probeFn = () => "    function zprobe(n) { return " + Array.from({ length: MAXK }, (_, i) => "(n < " + (i + 1) + " || (exists(/databases/$(database)/documents/zprobe/p" + (i + 1) + ") || true))").join(" && ") + "; }\n";
const MARK = "    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }\n";
function withProbes(rules, K) {
  let r = rules.replace(MARK, () => MARK + probeFn());
  const createA = "nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId)";
  const deleteA = "allow delete: if mayWriteCurriculum(resource.data.organizationId) &&\n          (!exists(fwPath(fwId)) ||";
  for (const a of [createA, deleteA]) if (r.split(a).length !== 2) throw new Error("anchor");
  r = r.replace(createA, () => "zprobe(" + K + ") && " + createA);
  r = r.replace(deleteA, () => deleteA.replace("allow delete: if ", "allow delete: if zprobe(" + K + ") && "));
  return r;
}
const plan = planFor(big(2, 5), { actorUid: "pa" });
const ids = (n, p) => Array.from({ length: n }, (_, i) => (p + i.toString(16)).padStart(32, "0").slice(-32));
let envSeq = 0;
async function scenario(rules, kind, actor, K) {
  const env = await makeEnv("demo-p4s4b-" + (++envSeq), withProbes(rules, K)); const as = actors(env);
  try {
    await seedWorld(env);
    const importGoverned = kind.imp;
    if (importGoverned) await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore(); const { fwDoc } = await import("../library-v2-p3-s1/helpers.mjs");
      await setDoc(doc(db, "curriculumFrameworks/" + BATCH), fwDoc("orgA", "draft"));
      await setDoc(doc(db, "importBatches/" + BATCH), { ...toBatchCreatePayload(plan, { actorUid: "pa", serverTimestamp: () => new Date("2026-10-08T00:00:00Z") }), status: kind.partial ? "partial" : "committing", chunksDone: 0, ...(kind.partial ? { finishedAt: new Date("2026-10-08T00:00:00Z") } : {}), createdAt: new Date("2026-10-08T00:00:00Z"), updatedAt: new Date("2026-10-08T00:00:00Z") });
    });
    const fw = importGoverned ? BATCH : "fwA_draft", parent = importGoverned ? "s1" : "s1";
    const db = as(actor); const list = ids(kind.n, kind.partial ? "a" : "b");
    if (kind.op === "delete") await env.withSecurityRulesDisabled(async (ctx) => { const d = ctx.firestore(); const { nodeDoc } = await import("../library-v2-p3-s1/helpers.mjs"); for (const id of list) await setDoc(doc(d, "curriculumFrameworks/" + fw + "/nodes/" + id), { ...nodeDoc("orgA"), kind: "lesson", parentId: parent, ancestors: [parent], name: "x", order: 5 }); });
    if (kind.op === "create") { if (kind.n === 1) await assertSucceeds(setDoc(doc(db, "curriculumFrameworks/" + fw + "/nodes/" + list[0]), lessonPayload("orgA", parent, { name: "n", order: 9, code: "C0" }))); else { const b = writeBatch(db); list.forEach((id, i) => b.set(doc(db, "curriculumFrameworks/" + fw + "/nodes/" + id), lessonPayload("orgA", parent, { name: "n" + i, order: 10 + i, code: "C" + i }))); await assertSucceeds(b.commit()); } }
    else { if (kind.n === 1) await assertSucceeds(deleteDoc(doc(db, "curriculumFrameworks/" + fw + "/nodes/" + list[0]))); else { const b = writeBatch(db); for (const id of list) b.delete(doc(db, "curriculumFrameworks/" + fw + "/nodes/" + id)); await assertSucceeds(b.commit()); } }
    return true;
  } catch { return false; } finally { await env.cleanup(); }
}
async function headroom(rules, kind, actor) {
  if (!(await scenario(rules, kind, actor, 0))) return -1;
  let lo = 0, hi = MAXK + 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await scenario(rules, kind, actor, mid)) lo = mid; else hi = mid; }
  return lo;
}
test("DOCUMENT-ACCESS HEADROOM (extra distinct probes still passing): production versus the FINAL import-freeze copy", { timeout: 1800000 }, async () => {
  const freeze = freezeCandidateRules();
  const kinds = [
    ["ordinary framework: create 1", { imp: false, op: "create", n: 1 }, "prod+freeze"], ["ordinary framework: create 400 (atomic batch)", { imp: false, op: "create", n: 400 }, "prod+freeze"], ["ordinary framework: delete 400 (atomic batch)", { imp: false, op: "delete", n: 400 }, "prod+freeze"],
    ["importing import: create 1", { imp: true, op: "create", n: 1 }, "freeze"], ["importing import: create 400 (atomic batch)", { imp: true, op: "create", n: 400 }, "freeze"], ["partial import: delete 400 (atomic batch)", { imp: true, partial: true, op: "delete", n: 400 }, "freeze"]
  ];
  const rows = [];
  for (const actor of ["capA", "pa"]) for (const [label, kind, which] of kinds) {
    if (actor === "pa" && kind.n !== 1) continue;                       // Platform Admin: single writes only (it short-circuits the capability reads; the batch limit is exercised by capA)
    const row = { actor, scenario: label };
    if (which === "prod+freeze") row.production = await headroom(base, kind, actor);
    row.freeze = await headroom(freeze, kind, actor);
    rows.push(row);
  }
  console.log("\n" + JSON.stringify(rows, null, 1)); console.table(rows);
  for (const r of rows) assert.ok(r.freeze >= 0, "the amendment must not exhaust the document-access budget: " + r.actor + " " + r.scenario);
});
