// LIBRARY V2 P3-S1 - differential corpus of operations over every PRE-EXISTING (pre-V2) collection family.
// Copied verbatim from test/library-v2-p2-s1/regression.test.mjs (seed + operations) so the same corpus proves the P3 insertion changes nothing.
import { D, doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, orderBy, serverTimestamp } from "./helpers.mjs";

export async function seedV1(env) {
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

export const longList = Array.from({ length: 51 }, (_, i) => ({ question: "q" + i }));
export const v1Ops = [
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

