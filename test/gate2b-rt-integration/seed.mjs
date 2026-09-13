// GATE 2B-RT-INTEGRATION — seed/inspect helper for the browser-driven runtime harness. Creates
// REAL Auth-emulator accounts (via the emulator's own REST API — @firebase/rules-unit-testing's
// authenticatedContext only fakes auth for Node-side SDK calls, it cannot produce a session a real
// browser can sign in as) so the actual browser can log in through index.html's real login form,
// plus a few raw-Firestore seed/read commands for fixtures the legitimate UI cannot produce itself
// (malformed stored RichText, over-limit legacy text) and for verifying what the browser wrote.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, setDoc, getDoc, getDocs, collection } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "demo-hcma2-gate2b-rt-integration";
const FIRESTORE_PORT = 8200;
const AUTH_PORT = 9200;
const rulesSource = readFileSync(path.join(here, "firestore.rules"), "utf8");

async function withEnv(fn) {
  const testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesSource, host: "127.0.0.1", port: FIRESTORE_PORT } });
  try { await fn(testEnv); } finally { await testEnv.cleanup(); }
}
async function seedRaw(testEnv, fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

async function createAuthUser(email, password) {
  const res = await fetch(`http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error("createAuthUser failed: " + JSON.stringify(body));
  return body.localId;
}

const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

if (cmd === "resetAuth") {
  const res = await fetch(`http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  console.log(JSON.stringify({ ok: res.ok }));
} else if (cmd === "createTeacher") {
  const email = arg1 || "teacher-a@example.test", password = arg2 || "Password123!";
  const uid = await createAuthUser(email, password);
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", uid), { role: "teacher", status: "active", email });
    });
  });
  console.log(JSON.stringify({ ok: true, uid, email, password }));
} else if (cmd === "createStudent") {
  // Students in this app join anonymously via publicAuth (signInAnonymously) — no seeded account
  // needed; this command exists only in case a specific uid needs a users/ doc for some test.
  console.log(JSON.stringify({ ok: true, note: "students authenticate anonymously; nothing to seed" }));
} else if (cmd === "seedMalformedActivity") {
  // A group activity whose instructions/topic have a VALID legacy plain mirror alongside a
  // MALFORMED instructionsRich/topicRich (structurally boundary-valid-looking but failing the
  // deep validator) — exercises the fail-closed renderer + editor's legacy-fallback load path.
  const activityId = arg1 || "malformed-act1";
  const ownerUid = arg2;
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "groupActivities", activityId), {
        ownerId: ownerUid, classId: null, className: "", title: "Malformed Fixture",
        instructions: "LEGACY MIRROR TEXT (must be what renders)",
        instructionsRich: { version: 1, blocks: "NOT_AN_ARRAY" },
        groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "MALFORM1", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupJoinCodes", "MALFORM1"), { activityId, ownerId: ownerUid, createdAt: new Date() });
      await setDoc(doc(raw, "groupActivities", activityId, "topics", "1"), {
        group: 1, topic: "LEGACY TOPIC MIRROR", topicRich: { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "x", bold: "not-a-boolean" }] }] }, updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupActivities", activityId, "topics", "2"), { group: 2, topic: "", updatedAt: new Date() });
    });
  });
  console.log(JSON.stringify({ ok: true, activityId, joinCode: "MALFORM1" }));
} else if (cmd === "seedOverLimitLegacyActivity") {
  // Legacy instructions text whose length alone exceeds MAX_TOTAL_TEXT_LENGTH (10000) — no
  // instructionsRich at all, proving the "legacy content over V1 limits" save-blocked path.
  const activityId = arg1 || "overlimit-act1";
  const ownerUid = arg2;
  const longText = "x".repeat(10050);
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "groupActivities", activityId), {
        ownerId: ownerUid, classId: null, className: "", title: "Over-limit Legacy Fixture",
        instructions: longText, groupCount: 2, durationSec: 900,
        allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "OVERLIM1", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupJoinCodes", "OVERLIM1"), { activityId, ownerId: ownerUid, createdAt: new Date() });
      await setDoc(doc(raw, "groupActivities", activityId, "topics", "1"), { group: 1, topic: "", updatedAt: new Date() });
      await setDoc(doc(raw, "groupActivities", activityId, "topics", "2"), { group: 2, topic: "", updatedAt: new Date() });
    });
  });
  console.log(JSON.stringify({ ok: true, activityId, joinCode: "OVERLIM1", textLength: longText.length }));
} else if (cmd === "readActivity") {
  const activityId = arg1;
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      const snap = await getDoc(doc(raw, "groupActivities", activityId));
      console.log(JSON.stringify({ exists: snap.exists(), data: snap.exists() ? snap.data() : null }, null, 2));
    });
  });
} else if (cmd === "readTopics") {
  const activityId = arg1;
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      const snap = await getDocs(collection(raw, "groupActivities", activityId, "topics"));
      const out = {};
      snap.forEach(d => { out[d.id] = d.data(); });
      console.log(JSON.stringify(out, null, 2));
    });
  });
} else if (cmd === "findActivityByJoinCode") {
  const code = arg1;
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      const snap = await getDoc(doc(raw, "groupJoinCodes", code));
      console.log(JSON.stringify({ exists: snap.exists(), data: snap.exists() ? snap.data() : null }));
    });
  });
} else if (cmd === "clearFirestore") {
  await withEnv(async (testEnv) => { await testEnv.clearFirestore(); });
  console.log(JSON.stringify({ ok: true, cleared: true }));
} else {
  console.error("Unknown command:", cmd);
  process.exitCode = 1;
}
void arg3;
