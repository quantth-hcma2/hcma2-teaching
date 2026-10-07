// LIBRARY V2 P2-S1 - proof that EXISTING HCMA2 Firestore Rules behavior is unchanged.
//  (1) text proof: the candidate Rules minus the single additive P2-S1 region are byte-identical to production Rules (SHA-256 218BFF3B...);
//  (2) behavior proof: the same operations are run against the baseline Rules (derived by stripping the region) and the candidate Rules,
//      over every pre-existing collection family, and the outcomes must be identical operation by operation;
//  (3) default-deny proof: new collections are denied by the baseline and nothing else changes; later-phase collections stay denied.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  makeEnv, actors, candidateRules, baselineRules, regionOf, sha, D, NL, BEGIN, END,
  doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp, assertSucceeds, assertFails
} from "./helpers.mjs";

const rules = candidateRules();
// P3-S1 aligned: the historical baseline is production BEFORE P2-S1. The candidate now also carries the additive P3-S1 curriculum region
// (inserted after the P2-S1 region), so the pre-P2 baseline strips both regions; "added" still measures the P2-S1 region alone.
const P3_BEGIN = "    // ===== LIBRARY V2 P3-S1 (CURRICULUM) - BEGIN =====";
const P3_END = "    // ===== LIBRARY V2 P3-S1 (CURRICULUM) - END =====";
function stripP3Region(text) {
  const a = text.indexOf(P3_BEGIN), e = text.indexOf(P3_END);
  if (a < 0 || e < a) return text;
  return text.slice(0, a) + text.slice(text.indexOf(NL, e) + 2);
}
const p2Stripped = baselineRules(rules);
const baseline = stripP3Region(p2Stripped);
const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const shaFile = (p) => sha(read(p));

test("text proof: removing the single additive region restores production Rules byte-for-byte; the region sits before the default-deny block", () => {
  assert.equal(sha(baseline), "218bff3bdb4d82ca82e2161583e23ccb95589f288f8b8573b5863e65b6c3880f");
  assert.equal(rules.split(BEGIN).length - 1, 1); assert.equal(rules.split(END).length - 1, 1);
  const region = regionOf(rules);
  assert.ok(rules.indexOf(region) < rules.lastIndexOf("match /{document=**}"), "region precedes the default-deny match");
  const added = rules.split(NL).length - p2Stripped.split(NL).length;
  assert.ok(added > 100 && added < 200, "pure insertion of the region, " + added + " lines");
});

test("region hygiene: only the three new collections are matched; every delete is denied; users and existing helpers are untouched", () => {
  const region = regionOf(rules);
  const matches = [...region.matchAll(/match \/([A-Za-z]+)\/\{/g)].map((m) => m[1]);
  assert.deepEqual(matches, ["organizations", "organizationMembers", "userCapabilities"]);
  const deletes = [...region.matchAll(/allow delete: if ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(deletes, ["false", "false", "false"]);
  assert.ok(!/match \/users\//.test(region) && !/match \/(library|questionSets|sessions|groupActivities|knowledgeSessions)\//.test(region));
  assert.ok(!/allow [a-z, ]*: if true/.test(region), "no open rule");
  const names = [...region.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]);
  const baseNames = new Set([...baseline.matchAll(/function ([A-Za-z]+)\(/g)].map((m) => m[1]));
  for (const n of names) assert.ok(!baseNames.has(n), "helper name does not collide with an existing function: " + n);
});

test("no index, Storage, UI, dependency or data-model change (byte-pinned)", () => {
  const pinned = {
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88"
  };
  for (const [f, h] of Object.entries(pinned)) assert.equal(shaFile(f), h, f);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  const html = read("index.html").toString("utf8");
  // (P2-S3 legitimately adds the Platform Admin organization screen to index.html; S1 only guards that membership/capability/Library V2 data are not referenced there)
  for (const n of ["organizationMembers", "userCapabilities", "libraryResources", "curriculumFrameworks", "importBatches"]) assert.ok(!html.includes(n), "index.html must not reference " + n);
});

// ---------- behavior proof ----------
const envCand = await makeEnv("demo-p2s1-reg-cand", rules);
const envBase = await makeEnv("demo-p2s1-reg-base", baseline);
test.after(async () => { await envCand.cleanup(); await envBase.cleanup(); });

async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    const user = (id, role, status) => put("users/" + id, { uid: id, role, status, displayName: id, email: id + "@example.test", approvedBy: null, approvedAt: null, createdAt: D(1) });
    await user("pa", "admin", "active"); await user("t1", "teacher", "active"); await user("t2", "teacher", "active");
    await user("tsusp", "teacher", "suspended"); await user("tpend", "teacher", "pending");
    await put("classes/c1", { ownerId: "t1", name: "K77", createdAt: D(2) });
    await put("library/l1", { ownerId: "t1", category: "Khoi dong", type: "open", question: "Q?", createdAt: D(2), updatedAt: D(2) });
    await put("questionSets/s1", { ownerId: "t1", name: "Bo", questions: [{ question: "a" }], questionCount: 1, createdAt: D(2), updatedAt: D(2) });
    await put("sessions/sess1", { ownerId: "t1", status: "open", title: "Phien", accessToken: "tok1", shortCode: "ABC-123", classId: "c1", createdAt: D(2), activeQuestionId: null });
    await put("sessions/sessDraft", { ownerId: "t1", status: "ready", title: "Nhap", accessToken: "tok2", shortCode: "ABC-124", createdAt: D(2) });
    await put("questions/q1", { ownerId: "t1", sessionId: "sess1", order: 0, type: "single", question: "Q", createdAt: D(2) });
    await put("joinCodes/ABC123", { sessionId: "sess1", ownerId: "t1", createdAt: D(2) });
    await put("sessionTokens/tok1", { sessionId: "sess1", ownerId: "t1", createdAt: D(2) });
    await put("groupActivities/g1", { ownerId: "t1", status: "open", title: "Nhom", groupCount: 2, joinCode: "G1", allowText: true, allowPhoto: true, allowFile: true, createdAt: D(2) });
    await put("groupActivities/gdel", { ownerId: "t1", status: "deleted", statusBeforeDelete: "open", deletedAt: D(3), deletedBy: "t1", title: "Xoa", groupCount: 2, createdAt: D(2) });
    await put("groupJoinCodes/G1", { activityId: "g1", ownerId: "t1", createdAt: D(2) });
    await put("knowledgeSessions/k1", { ownerId: "t1", status: "open", title: "Tri thuc", joinCode: "KJ1AAA", minimumPerParticipant: 3, targetSubmissions: 10, createdAt: D(2), updatedAt: D(2) });
    await put("knowledgeJoinCodes/KJ1AAA", { sessionId: "k1", ownerId: "t1", createdAt: D(2) });
    await put("auditLogs/a1", { actorId: "t1", action: "x", createdAt: D(2) });
  });
}
await seed(envCand); await seed(envBase);

const longList = Array.from({ length: 51 }, (_, i) => ({ question: "q" + i }));
const ops = [
  // users
  ["users: self get", "t1", (db) => getDoc(doc(db, "users", "t1"))],
  ["users: get other teacher", "t1", (db) => getDoc(doc(db, "users", "t2"))],
  ["users: admin get teacher", "pa", (db) => getDoc(doc(db, "users", "t2"))],
  ["users: teacher lists users", "t1", (db) => getDocs(collection(db, "users"))],
  ["users: admin lists teachers", "pa", (db) => getDocs(query(collection(db, "users"), where("role", "==", "teacher")))],
  ["users: self update displayName", "t1", (db) => updateDoc(doc(db, "users", "t1"), { displayName: "Moi" })],
  ["users: self role escalation", "t1", (db) => updateDoc(doc(db, "users", "t1"), { role: "admin" })],
  ["users: self adds arbitrary field", "t1", (db) => updateDoc(doc(db, "users", "t1"), { capabilities: ["x"] })],
  ["users: suspended self get", "tsusp", (db) => getDoc(doc(db, "users", "tsusp"))],
  ["users: pending self get", "tpend", (db) => getDoc(doc(db, "users", "tpend"))],
  ["users: admin approves teacher", "pa", (db) => updateDoc(doc(db, "users", "tpend"), { status: "active", approvedBy: "pa", approvedAt: serverTimestamp() })],
  ["users: teacher edits another user", "t2", (db) => updateDoc(doc(db, "users", "t1"), { displayName: "x" })],
  // classes
  ["classes: owner create", "t1", (db) => setDoc(doc(db, "classes", "c2"), { ownerId: "t1", name: "B", createdAt: serverTimestamp() })],
  ["classes: create for another owner", "t1", (db) => setDoc(doc(db, "classes", "c3"), { ownerId: "t2", name: "B", createdAt: serverTimestamp() })],
  ["classes: owner read", "t1", (db) => getDoc(doc(db, "classes", "c1"))],
  ["classes: other read", "t2", (db) => getDoc(doc(db, "classes", "c1"))],
  ["classes: suspended owner read", "tsusp", (db) => getDoc(doc(db, "classes", "c1"))],
  ["classes: admin read", "pa", (db) => getDoc(doc(db, "classes", "c1"))],
  ["classes: owner list", "t1", (db) => getDocs(query(collection(db, "classes"), where("ownerId", "==", "t1")))],
  ["classes: owner delete", "t1", (db) => deleteDoc(doc(db, "classes", "c2"))],
  // library / questionSets (Library V1)
  ["library: owner create", "t1", (db) => setDoc(doc(db, "library", "l2"), { ownerId: "t1", category: "A", type: "open", question: "Q", createdAt: serverTimestamp() })],
  ["library: create as another owner", "t2", (db) => setDoc(doc(db, "library", "l3"), { ownerId: "t1", question: "Q", createdAt: serverTimestamp() })],
  ["library: other read", "t2", (db) => getDoc(doc(db, "library", "l1"))],
  ["library: admin read", "pa", (db) => getDoc(doc(db, "library", "l1"))],
  ["library: owner list", "t1", (db) => getDocs(query(collection(db, "library"), where("ownerId", "==", "t1"), orderBy("createdAt", "desc")))],
  ["library: owner update", "t1", (db) => updateDoc(doc(db, "library", "l1"), { question: "Q2" })],
  ["library: suspended create", "tsusp", (db) => setDoc(doc(db, "library", "l4"), { ownerId: "tsusp", question: "Q", createdAt: serverTimestamp() })],
  ["library: owner delete", "t1", (db) => deleteDoc(doc(db, "library", "l2"))],
  ["questionSets: create 1 question", "t1", (db) => setDoc(doc(db, "questionSets", "s2"), { ownerId: "t1", name: "B", questions: [{ question: "a" }], questionCount: 1, createdAt: serverTimestamp() })],
  ["questionSets: create 0 questions", "t1", (db) => setDoc(doc(db, "questionSets", "s3"), { ownerId: "t1", name: "B", questions: [], createdAt: serverTimestamp() })],
  ["questionSets: create 51 questions", "t1", (db) => setDoc(doc(db, "questionSets", "s4"), { ownerId: "t1", name: "B", questions: longList, createdAt: serverTimestamp() })],
  ["questionSets: other read", "t2", (db) => getDoc(doc(db, "questionSets", "s1"))],
  // sessions / questions / join codes
  ["sessions: owner get", "t1", (db) => getDoc(doc(db, "sessions", "sess1"))],
  ["sessions: student get open", "stu", (db) => getDoc(doc(db, "sessions", "sess1"))],
  ["sessions: student get draft", "stu", (db) => getDoc(doc(db, "sessions", "sessDraft"))],
  ["sessions: other teacher get open", "t2", (db) => getDoc(doc(db, "sessions", "sess1"))],
  ["sessions: owner list", "t1", (db) => getDocs(query(collection(db, "sessions"), where("ownerId", "==", "t1")))],
  ["sessions: other list owner's", "t2", (db) => getDocs(query(collection(db, "sessions"), where("ownerId", "==", "t1")))],
  ["sessions: student list", "stu", (db) => getDocs(collection(db, "sessions"))],
  ["sessions: owner minimal create (allowlist)", "t1", (db) => setDoc(doc(db, "sessions", "sNew"), { ownerId: "t1", title: "x", status: "ready" })],
  ["questions: owner get", "t1", (db) => getDoc(doc(db, "questions", "q1"))],
  ["questions: student get inactive", "stu", (db) => getDoc(doc(db, "questions", "q1"))],
  ["joinCodes: student get", "stu", (db) => getDoc(doc(db, "joinCodes", "ABC123"))],
  ["joinCodes: student list", "stu", (db) => getDocs(collection(db, "joinCodes"))],
  ["sessionTokens: student get", "stu", (db) => getDoc(doc(db, "sessionTokens", "tok1"))],
  // group
  ["group: owner get", "t1", (db) => getDoc(doc(db, "groupActivities", "g1"))],
  ["group: student get open", "stu", (db) => getDoc(doc(db, "groupActivities", "g1"))],
  ["group: other teacher get", "t2", (db) => getDoc(doc(db, "groupActivities", "g1"))],
  ["group: owner list", "t1", (db) => getDocs(query(collection(db, "groupActivities"), where("ownerId", "==", "t1")))],
  ["group: deleted get by owner", "t1", (db) => getDoc(doc(db, "groupActivities", "gdel"))],
  ["group: student get deleted", "stu", (db) => getDoc(doc(db, "groupActivities", "gdel"))],
  ["groupJoinCodes: student get", "stu", (db) => getDoc(doc(db, "groupJoinCodes", "G1"))],
  // knowledge
  ["knowledge: student get open", "stu", (db) => getDoc(doc(db, "knowledgeSessions", "k1"))],
  ["knowledge: owner get", "t1", (db) => getDoc(doc(db, "knowledgeSessions", "k1"))],
  ["knowledge: other teacher get", "t2", (db) => getDoc(doc(db, "knowledgeSessions", "k1"))],
  ["knowledge: owner list", "t1", (db) => getDocs(query(collection(db, "knowledgeSessions"), where("ownerId", "==", "t1")))],
  ["knowledge: student get join code", "stu", (db) => getDoc(doc(db, "knowledgeJoinCodes", "KJ1AAA"))],
  ["knowledge: student list join codes", "stu", (db) => getDocs(collection(db, "knowledgeJoinCodes"))],
  ["knowledge: bad create", "t2", (db) => setDoc(doc(db, "knowledgeSessions", "kBad"), { ownerId: "t2", title: "x" })],
  // audit + default deny
  ["audit: own create", "t1", (db) => setDoc(doc(db, "auditLogs", "a2"), { actorId: "t1", action: "y", createdAt: serverTimestamp() })],
  ["audit: forged actor", "t1", (db) => setDoc(doc(db, "auditLogs", "a3"), { actorId: "t2", action: "y", createdAt: serverTimestamp() })],
  ["audit: teacher read", "t1", (db) => getDoc(doc(db, "auditLogs", "a1"))],
  ["audit: admin read", "pa", (db) => getDoc(doc(db, "auditLogs", "a1"))],
  ["default deny: unknown read (admin)", "pa", (db) => getDoc(doc(db, "somethingElse", "x"))],
  ["default deny: unknown write (admin)", "pa", (db) => setDoc(doc(db, "somethingElse", "x"), { a: 1 })]
];

async function run(env) {
  const as = actors(env);
  const out = [];
  for (const [label, uid, fn] of ops) {
    const db = as(uid, uid === "stu" ? "anonymous" : "password");
    let result;
    try { await fn(db); result = "ALLOW"; } catch { result = "DENY"; }
    out.push(label + " => " + result);
  }
  return out;
}

test("behavior proof: " + ops.length + " operations over every pre-existing collection family give identical outcomes on baseline and candidate Rules", async () => {
  const cand = await run(envCand);
  const base = await run(envBase);
  assert.deepEqual(cand, base);
  const allow = cand.filter((x) => x.endsWith("ALLOW")).length, deny = cand.length - allow;
  console.log("DIFFERENTIAL " + JSON.stringify({ operations: ops.length, allow, deny, identical: true }));
  assert.ok(allow >= 15 && deny >= 15, "the corpus exercises both allow and deny paths (" + allow + "/" + deny + ")");
  // spot-check pinned semantics so the corpus cannot silently become vacuous
  const m = Object.fromEntries(cand.map((x) => x.split(" => ")));
  assert.equal(m["users: self adds arbitrary field"], "ALLOW");                 // finding F1 (unchanged)
  assert.equal(m["users: self role escalation"], "DENY");
  assert.equal(m["library: owner create"], "ALLOW"); assert.equal(m["library: other read"], "DENY");
  assert.equal(m["sessions: student get open"], "ALLOW"); assert.equal(m["sessions: student get draft"], "DENY");
  assert.equal(m["questionSets: create 51 questions"], "DENY");
  assert.equal(m["group: student get deleted"], "DENY");
});

test("default-deny proof: the three new collections are denied by the baseline (even for the Platform Admin) and later-phase collections stay denied by the candidate", async () => {
  const a = actors(envBase), c = actors(envCand);
  for (const p of ["organizations/o1", "organizationMembers/o1_pa", "userCapabilities/o1_pa"]) {
    await assertFails(getDoc(doc(a("pa"), p)));
    await assertFails(setDoc(doc(a("pa"), p), { x: 1 }));
  }
  for (const col of ["libraryResources", "curriculumMappings", "importBatches", "libraryUsageEvents", "organizationInvites", "libraryAssets"]) {
    await assertFails(setDoc(doc(c("pa"), col, "x"), { x: 1 }));
    await assertFails(getDoc(doc(c("pa"), col, "x")));
  }
  // P3-S1 aligned: curriculumFrameworks is no longer a blanket-denied later-phase collection (P3 opens it to governance principals
  // of the owning organization only). The security coverage is preserved: it is still denied by the pre-P2 baseline, and under the
  // candidate it stays denied to anonymous, ordinary teachers and malformed Platform Admin writes (the complete P3 matrix lives in test/library-v2-p3-s1).
  await assertFails(getDoc(doc(a("pa"), "curriculumFrameworks", "x")));
  await assertFails(setDoc(doc(a("pa"), "curriculumFrameworks", "x"), { x: 1 }));
  await assertFails(getDoc(doc(c("pa", "anonymous"), "curriculumFrameworks", "x")));
  await assertFails(setDoc(doc(c("pa", "anonymous"), "curriculumFrameworks", "x"), { x: 1 }));
  await assertFails(getDoc(doc(c("t1"), "curriculumFrameworks", "x")));
  await assertFails(setDoc(doc(c("t1"), "curriculumFrameworks", "x"), { x: 1 }));
  await assertFails(getDoc(doc(c("t1"), "curriculumFrameworks", "x/nodes/n")));
  await assertFails(setDoc(doc(c("pa"), "curriculumFrameworks", "x"), { x: 1 }));
});
