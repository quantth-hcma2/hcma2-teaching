// GATE 2B-RT-PREPROD — STEP 16 CRITICAL ROLLBACK COMPATIBILITY TEST.
//
// Question: if the frontend is rolled back to the pre-RichText production build while documents
// already contain instructionsRich/topicRich (written by the new frontend before rollback), and
// Rules are ALSO rolled back to the pre-RichText baseline, can the old frontend still save
// legacy edits successfully? Or does the old Rules' field allowlist reject the write because the
// document now carries fields the old allowlist doesn't know about?
//
// This is tested empirically against a real Firestore emulator with the ACTUAL old-production
// Rules text (test/gate2b-rt-preprod/old-production.rules, extracted from origin/main
// 3cdbfebb5c8fb05bc81fa18e1dfb9b937ec4c377, confirmed by hash to match the stated production
// baseline) — not assumed from reading the Rules source.
import test from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GATE2B_RT_PREPROD_EMULATOR_PORT || 8201);
const oldRules = readFileSync(path.join(here, "old-production.rules"), "utf8");

async function withOldRules(fn) {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-hcma2-gate2b-rt-preprod",
    firestore: { rules: oldRules, host: "127.0.0.1", port: PORT }
  });
  try { await fn(testEnv); } finally { await testEnv.cleanup(); }
}
async function seedRaw(testEnv, fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
function teacherCtx(testEnv, uid = "teacher-a") {
  return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } });
}

const SAMPLE_RICH = { version: 1, blocks: [{ type: "paragraph", runs: [{ text: "Old instructions", bold: true }] }] };

// ===================================================================================
// A: groupActivities — old-frontend-style PARTIAL update (title+instructions only, exactly
// matching origin/main's tx.update(row.ref,{...patch,updatedAt}) write shape) against a document
// that already carries instructionsRich, under the OLD (rolled-back) Rules.
// ===================================================================================

test("ROLLBACK A: old Rules accept an old-frontend-style partial update to a groupActivities doc that already has instructionsRich — the diff-based allowlist never sees the untouched field", async () => {
  await withOldRules(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", "act1"), {
        ownerId: "teacher-a", classId: null, className: "", title: "Old title",
        instructions: "Old instructions", instructionsRich: SAMPLE_RICH,
        groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "OLDR1", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
    });
    const t = teacherCtx(testEnv).firestore();
    // Exactly the OLD frontend's own write shape: tx.update() touching only title+instructions.
    await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1"), {
      title: "New title (old-style edit)",
      instructions: "New instructions (old-style edit)",
      updatedAt: serverTimestamp()
    }));
    await seedRaw(testEnv, async (raw) => {
      const data = (await getDoc(doc(raw, "groupActivities", "act1"))).data();
      assert.equal(data.title, "New title (old-style edit)");
      assert.equal(data.instructions, "New instructions (old-style edit)");
      assert.deepEqual(data.instructionsRich, SAMPLE_RICH, "instructionsRich must survive an old-frontend-style partial update completely untouched — no data loss");
    });
  });
});

// ===================================================================================
// B: topics/{n} — old-frontend-style partial update (topic only) against a doc that already
// carries topicRich, under OLD Rules. The old topics update rule has NO field allowlist at all
// (owner/admin authorization only), so this is expected to be even less at-risk than (A).
// ===================================================================================

test("ROLLBACK B: old Rules accept an old-frontend-style partial update to a topics/{n} doc that already has topicRich — topicRich survives untouched", async () => {
  await withOldRules(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", "act1"), {
        ownerId: "teacher-a", classId: null, className: "", title: "T", instructions: "",
        groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "OLDR2", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupActivities", "act1", "topics", "1"), {
        group: 1, topic: "Old topic", topicRich: SAMPLE_RICH, updatedAt: new Date()
      });
    });
    const t = teacherCtx(testEnv).firestore();
    await assertSucceeds(updateDoc(doc(t, "groupActivities", "act1", "topics", "1"), {
      topic: "New topic (old-style edit)",
      updatedAt: serverTimestamp()
    }));
    await seedRaw(testEnv, async (raw) => {
      const data = (await getDoc(doc(raw, "groupActivities", "act1", "topics", "1"))).data();
      assert.equal(data.topic, "New topic (old-style edit)");
      assert.deepEqual(data.topicRich, SAMPLE_RICH, "topicRich must survive an old-frontend-style partial update completely untouched");
    });
  });
});

// ===================================================================================
// C (mitigation-relevant nuance, not assumed — empirically checked): the safety proven in (A)
// depends on the OLD frontend's ACTUAL write pattern being a PARTIAL update (tx.update(), which
// is what origin/main's saveSessionInfo() actually does — confirmed by reading its source). If a
// write instead did a FULL-DOCUMENT overwrite that omits instructionsRich (dropping it), the old
// Rules' diff-based check WOULD see instructionsRich disappear and correctly reject it (since
// 'instructionsRich' is not in the old allowlist) — this is old Rules correctly protecting
// against unexpected data loss, not a compatibility bug, but worth proving explicitly since it
// shows the guarantee is "old Rules never block old writes" specifically BECAUSE old writes are
// partial, not because old Rules are unconditionally permissive about the field disappearing.
// ===================================================================================

test("ROLLBACK C (nuance, correctly rejected): a hypothetical FULL-DOCUMENT overwrite that drops instructionsRich is rejected by old Rules — proving the rollback safety in (A) depends on the old frontend's real partial-update pattern, not blanket permissiveness", async () => {
  await withOldRules(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", "act2"), {
        ownerId: "teacher-a", classId: null, className: "", title: "Old title",
        instructions: "Old instructions", instructionsRich: SAMPLE_RICH,
        groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "OLDR3", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
    });
    const t = teacherCtx(testEnv).firestore();
    // A full setDoc() WITHOUT merge, reconstructing the document the way an old client (that has
    // never heard of instructionsRich) would — this necessarily omits the field entirely.
    await assertFails(setDoc(doc(t, "groupActivities", "act2"), {
      ownerId: "teacher-a", classId: null, className: "", title: "New title",
      instructions: "New instructions", groupCount: 2, durationSec: 900,
      allowText: true, allowPhoto: true, allowFile: true, joinCode: "OLDR3", status: "draft",
      startedAt: null, createdAt: new Date(), updatedAt: serverTimestamp()
    }));
    await seedRaw(testEnv, async (raw) => {
      const data = (await getDoc(doc(raw, "groupActivities", "act2"))).data();
      assert.equal(data.title, "Old title", "the rejected full-overwrite attempt must not have partially applied");
      assert.deepEqual(data.instructionsRich, SAMPLE_RICH);
    });
  });
});

// ===================================================================================
// D: legacy document with NO Rich fields at all still updates normally under old Rules (pure
// regression — proves rollback doesn't regress the ordinary, never-touched-RichText case).
// ===================================================================================

test("ROLLBACK D: a purely legacy groupActivities document (no instructionsRich ever) continues to update normally under old Rules", async () => {
  await withOldRules(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", "act3"), {
        ownerId: "teacher-a", classId: null, className: "", title: "Legacy title", instructions: "Legacy instructions",
        groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "OLDR4", status: "draft", startedAt: null, createdAt: new Date(), updatedAt: new Date()
      });
    });
    const t = teacherCtx(testEnv).firestore();
    await assertSucceeds(updateDoc(doc(t, "groupActivities", "act3"), { title: "Updated", updatedAt: serverTimestamp() }));
  });
});
