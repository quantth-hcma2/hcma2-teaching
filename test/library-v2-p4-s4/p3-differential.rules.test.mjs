// P4-S4 RULES DESIGN GATE - P3 is NOT weakened: a DIFFERENTIAL run. The identical sequence of P3 operations (framework rename / activate / archive / restore / delete / clone, node create / update / delete)
// by 17 principals (incl. unauthorized, suspended, other-organization and anonymous) against 6 ordinary frameworks (active, draft, archived, other organization, archived organization) is executed against
//   (a) the PRODUCTION Rules artifact and (b) the FINAL import-freeze test-only copy; every single outcome must be identical (frameworks WITHOUT a paired import batch are unaffected).
// Run: firebase emulators:exec --only firestore --project demo-p4s4d --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/p3-differential.rules.test.mjs"
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, doc, setDoc, updateDoc, deleteDoc, fwRename, fwTransition, newFwPayload, lessonPayload, nodeEdit, serverTimestamp, sha
} from "../library-v2-p3-s1/helpers.mjs";
import { deployedRulesText, freezeCandidateRules } from "./helpers.mjs";

void sha; void candidateRules;
const envA = await makeEnv("demo-p4s4d-prod", deployedRulesText()), envB = await makeEnv("demo-p4s4d-freeze", freezeCandidateRules());
after(async () => { await envA.cleanup(); await envB.cleanup(); });
const FRAMEWORKS = [["fwA_draft", "orgA", "draft"], ["fwA_active", "orgA", "active"], ["fwA_archived", "orgA", "archived"], ["fwB_draft", "orgB", "draft"], ["fwC_draft", "orgC", "draft"], ["fwC_active", "orgC", "active"]];
const PRINCIPALS = ["pa", "paSusp", "oaA", "capA", "revA", "mA", "noMember", "tSusp", "capSuspMem", "capRemoved", "ghost", "oaB", "capB", "oaC", "capC", "mC", null];

async function sequence(env) {
  await env.clearFirestore(); await seedWorld(env);
  const as = actors(env); const out = []; let n = 0;
  const attempt = async (label, db, fn) => { try { await fn(db); out.push(label + "=ok"); } catch (e) { out.push(label + "=" + ((e && e.code) || "deny")); } };
  for (const [fw, org, status] of FRAMEWORKS) for (const uid of PRINCIPALS) {
    const db = as(uid), who = uid || "anon", tag = fw + "/" + who + "/";
    const f = doc(db, "curriculumFrameworks/" + fw);
    await attempt(tag + "rename", db, () => updateDoc(f, fwRename("Đổi tên " + (++n))));
    await attempt(tag + "toggle", db, () => updateDoc(f, status === "draft" ? fwTransition(uid || "x", "active", { activatedAt: serverTimestamp() }) : status === "active" ? fwTransition(uid || "x", "archived") : fwTransition(uid || "x", "active")));
    await attempt(tag + "nodeCreate", db, () => setDoc(doc(db, "curriculumFrameworks/" + fw + "/nodes/AutoId" + String(++n).padStart(15, "0")), lessonPayload(org, "s1", { name: "Bài " + n, order: 100 + n, code: "N" + n })));
    await attempt(tag + "nodeUpdate", db, () => updateDoc(doc(db, "curriculumFrameworks/" + fw + "/nodes/s1"), nodeEdit({ name: "Môn " + (++n) })));
    await attempt(tag + "nodeDelete", db, () => deleteDoc(doc(db, "curriculumFrameworks/" + fw + "/nodes/l1")));
    await attempt(tag + "clone", db, () => setDoc(doc(db, "curriculumFrameworks/clone_" + fw + "_" + who), { ...newFwPayload(org, uid || "x", { name: "Bản sao " + (++n) }), cloneSource: { frameworkId: fw, nodeCount: 2 } }));
    await attempt(tag + "delete", db, () => deleteDoc(f));
  }
  return out;
}
test("DIFFERENTIAL: production Rules and the import-freeze copy give IDENTICAL outcomes for every P3 operation on frameworks without a paired import batch (and the sequence really exercised both allows and denies)", { timeout: 1800000 }, async () => {
  const a = await sequence(envA), b = await sequence(envB);
  assert.equal(a.length, b.length); assert.ok(a.length > 600, "operations: " + a.length);
  const diff = a.map((x, i) => (x === b[i] ? null : [x, b[i]])).filter(Boolean);
  assert.deepEqual(diff, [], "differences: " + JSON.stringify(diff.slice(0, 5)));
  const ok = a.filter((x) => x.endsWith("=ok")).length;
  assert.ok(ok > 40 && ok < a.length - 40, "the sequence mixes allows and denies: ok=" + ok + " of " + a.length);
  console.log("P3 differential: " + a.length + " operations, identical outcomes, " + ok + " allowed / " + (a.length - ok) + " denied");
});
