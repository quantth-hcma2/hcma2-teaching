// GATE 2A-AUTH-I3-UI-FIX-RUNTIME driver — the "legitimate lecturer/emulator path" that mutates
// the activity document (and membership/topics/notes) the SAME way a real lecturer action would,
// using an authenticated teacher context against the real candidate Rules on the SAME running
// Firestore emulator the browser-driven student page is connected to. Never touches the browser
// page's own JS directly — only ever writes to Firestore, exactly as a real lecturer UI would.
// The actual student membership is always created by the REAL browser page going through its own
// real join flow (never pre-seeded under a guessed uid, since anonymous auth assigns its own uid)
// — commands here that need to target "the" membership look it up dynamically instead.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, addDoc, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "demo-hcma2-gate2a-auth-i3-ui-fix-runtime";
const PORT = 8196;
const ACTIVITY_ID = "runtime-act1";
const rulesSource = readFileSync(path.join(here, "firestore.rules"), "utf8");

async function withEnv(fn) {
  const testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: PORT } });
  try {
    await fn(testEnv);
  } finally {
    await testEnv.cleanup();
  }
}

function teacherCtx(testEnv, uid = "runtime-teacher-a") {
  return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } });
}
async function seedRaw(testEnv, fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
async function firstMemberDoc(t) {
  const snap = await getDocs(collection(t, "groupActivities", ACTIVITY_ID, "members"));
  if (snap.empty) return null;
  return snap.docs[0];
}

const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

await withEnv(async (testEnv) => {
  const t = teacherCtx(testEnv).firestore();

  if (cmd === "reset") {
    // Clears everything so a fresh scenario starts clean.
    await testEnv.clearFirestore();
    console.log(JSON.stringify({ ok: true, cleared: true }));
  } else if (cmd === "seedA") {
    // RUNTIME TEST A/B/C/D/E fixture: open activity, 2 groups, distinct topics, one seeded note
    // in each group (group-2's note is pre-existing so we can prove it's visible once the real
    // student joins group 2 — group-1's is seeded so we can prove it's NEVER visible). No
    // membership is pre-seeded: the real browser page creates it via its own real join flow.
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "runtime-teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID), {
        ownerId: "runtime-teacher-a", classId: "c1", className: "K1", title: "Runtime Fixture",
        instructions: "runtime", groupCount: 2, durationSec: 900,
        allowText: true, allowPhoto: true, allowFile: true,
        status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupJoinCodes", "RUNTJOIN"), { activityId: ACTIVITY_ID, ownerId: "runtime-teacher-a", createdAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "topics", "1"), { group: 1, topic: "RUNTIME-TOPIC-GROUP-1", updatedAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "topics", "2"), { group: 2, topic: "RUNTIME-TOPIC-GROUP-2", updatedAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "notes", "n1"), { group: 1, text: "RUNTIME-NOTE-GROUP-1", participantId: "seed-participant", createdAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "notes", "n2"), { group: 2, text: "RUNTIME-NOTE-GROUP-2", participantId: "seed-participant", createdAt: new Date() });
    });
    console.log(JSON.stringify({ ok: true, activityId: ACTIVITY_ID, joinCode: "RUNTJOIN" }));
  } else if (cmd === "seedF") {
    // RUNTIME TEST F fixture: open activity, distinct topics only — the real browser joins as
    // Group 1 itself, then this driver reassigns whichever membership doc it finds to Group 2.
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "runtime-teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID), {
        ownerId: "runtime-teacher-a", classId: "c1", className: "K1", title: "Runtime Fixture F",
        instructions: "runtime", groupCount: 2, durationSec: 900,
        allowText: true, allowPhoto: true, allowFile: true,
        status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupJoinCodes", "RUNTJOIN"), { activityId: ACTIVITY_ID, ownerId: "runtime-teacher-a", createdAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "topics", "1"), { group: 1, topic: "RUNTIME-TOPIC-GROUP-1", updatedAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACTIVITY_ID, "topics", "2"), { group: 2, topic: "RUNTIME-TOPIC-GROUP-2", updatedAt: new Date() });
    });
    console.log(JSON.stringify({ ok: true, activityId: ACTIVITY_ID, joinCode: "RUNTJOIN" }));
  } else if (cmd === "close") {
    await updateDoc(doc(t, "groupActivities", ACTIVITY_ID), { status: "closed", updatedAt: serverTimestamp() });
    console.log(JSON.stringify({ ok: true, status: "closed" }));
  } else if (cmd === "open") {
    await updateDoc(doc(t, "groupActivities", ACTIVITY_ID), { status: "open", updatedAt: serverTimestamp() });
    console.log(JSON.stringify({ ok: true, status: "open" }));
  } else if (cmd === "reassignFirstMember") {
    const newGroup = Number(arg1);
    const m = await firstMemberDoc(t);
    if (!m) { console.log(JSON.stringify({ ok: false, error: "no membership doc found" })); process.exitCode = 1; }
    else {
      await updateDoc(doc(t, "groupActivities", ACTIVITY_ID, "members", m.id), { group: newGroup });
      console.log(JSON.stringify({ ok: true, uid: m.id, reassignedTo: newGroup }));
    }
  } else if (cmd === "removeFirstMembership") {
    const m = await firstMemberDoc(t);
    if (!m) { console.log(JSON.stringify({ ok: false, error: "no membership doc found" })); process.exitCode = 1; }
    else {
      await deleteDoc(doc(t, "groupActivities", ACTIVITY_ID, "members", m.id));
      console.log(JSON.stringify({ ok: true, removedUid: m.id }));
    }
  } else if (cmd === "addNote") {
    // Rules correctly deny the owner/teacher submitting a note directly (create requires the
    // caller's OWN membership to match the submitted group) — this simulates a note arriving
    // from some other already-legitimate participant, seeded with rules disabled, exactly like a
    // second real student's submission would land.
    const group = Number(arg1);
    const text = arg2;
    let noteId;
    await seedRaw(testEnv, async (raw) => {
      const ref = await addDoc(collection(raw, "groupActivities", ACTIVITY_ID, "notes"), { group, text, participantId: "runtime-other-participant", createdAt: new Date() });
      noteId = ref.id;
    });
    console.log(JSON.stringify({ ok: true, noteId, group, text }));
  } else if (cmd === "listMembers") {
    const snap = await getDocs(collection(t, "groupActivities", ACTIVITY_ID, "members"));
    console.log(JSON.stringify({ ok: true, members: snap.docs.map((d) => ({ uid: d.id, ...d.data() })) }));
  } else {
    console.error("unknown command:", cmd);
    process.exitCode = 1;
  }
});
