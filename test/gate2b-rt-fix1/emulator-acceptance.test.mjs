// GATE 2B-RT-FIX1 — LOCAL/EMULATOR ACCEPTANCE. Real Firestore emulator, real transactions, the
// REAL extracted findConflictKey/valuesEqualDeep (session-info-compare.mjs) and the REAL frozen
// RichText contract module (rich-text-contract.mjs) — never a parallel/mocked implementation.
//
// IMPORTANT SCOPE NOTE (per the FIX1 spec's own "PRODUCTION-BUG REPRESENTATION TEST" section): the
// local Firestore emulator does NOT reproduce the real backend's field-reordering behavior between
// a transaction's tx.get() and a plain getDoc() (this was already established empirically in GATE
// 2B-RT-PREPROD). That means this suite's own read/write cycles will not, by themselves, exercise
// the exact key-order bug — the deterministic, explicitly-constructed key-order fixtures proving
// that specific fix live in comparator.test.mjs and conflict-guard.test.mjs (pure, no emulator
// needed) and are NOT re-derived here. What THIS suite proves instead is that the real, fixed
// findConflictKey genuinely integrates end-to-end with real Firestore transactions: repeated saves
// succeed, a genuine external concurrent change is still blocked, and a stale-modal retry recovers
// correctly after reopening — using the exact save pattern saveSessionInfo uses.
import test from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { findConflictKey } from "../../session-info-compare.mjs";
import { validateRichTextV1, richTextToPlainText } from "../../rich-text-contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GATE2B_RT_FIX1_EMULATOR_PORT || 8202);
const rules = readFileSync(path.join(here, "firestore.rules"), "utf8");
const ACT = "fix1-act1";

async function withEnv(fn) {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-hcma2-gate2b-rt-fix1",
    firestore: { rules, host: "127.0.0.1", port: PORT }
  });
  try { await fn(testEnv); } finally { await testEnv.cleanup(); }
}
async function seedRaw(testEnv, fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
function teacherCtx(testEnv, uid = "teacher-a") {
  return testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } });
}

// Faithful re-implementation of ONE row of saveSessionInfo's transaction body, using the REAL
// findConflictKey — same shape: read latest inside the transaction, compare against the
// modal-open-time original, throw (never write) on conflict, otherwise tx.update()/tx.set().
async function saveRow(t, ref, patchFields, originalData) {
  await runTransaction(t, async (tx) => {
    const snap = await tx.get(ref);
    const latest = snap.exists() ? snap.data() : null;
    const conflictKey = findConflictKey(patchFields, latest, originalData);
    if (conflictKey) throw Object.assign(new Error(`CONFLICT:${conflictKey}`), { code: "conflict", conflictKey });
    if (latest) tx.update(ref, { ...patchFields, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...patchFields, updatedAt: serverTimestamp() });
  });
}

function makeRich(text, formatting = {}) {
  return { version: 1, blocks: [{ type: "paragraph", runs: [{ text, ...formatting }] }] };
}

test("GATE 2B-RT-FIX1 emulator acceptance: full repeated-save + genuine-conflict lifecycle for common instructions and Group 1 topic", async () => {
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      // 1. Create legacy Group activity (no Rich fields yet).
      await setDoc(doc(raw, "groupActivities", ACT), {
        ownerId: "teacher-a", classId: null, className: "", title: "FIX1 acceptance",
        instructions: "", groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "FIX1AC", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupActivities", ACT, "topics", "1"), { group: 1, topic: "", updatedAt: new Date() });
      await setDoc(doc(raw, "groupActivities", ACT, "topics", "2"), { group: 2, topic: "", updatedAt: new Date() });
    });

    const t = teacherCtx(testEnv).firestore();
    const actRef = doc(t, "groupActivities", ACT);
    const topic1Ref = doc(t, "groupActivities", ACT, "topics", "1");

    // ---- 2. Edit -> first RichText save (common instructions) ----
    let original = (await getDoc(actRef)).data();
    let richValue = makeRich("Common task v1", { bold: true });
    await assert.doesNotReject(saveRow(t, actRef, { instructionsRich: richValue, instructions: richTextToPlainText(richValue) }, original));

    // ---- 3. Reopen ----
    original = (await getDoc(actRef)).data();
    assert.deepEqual(original.instructionsRich, richValue, "first save must be readable back exactly");

    // ---- 4. Edit common task a SECOND time -> 5. Save successfully ----
    richValue = makeRich("Common task v2 EDITED", { bold: true, italic: true });
    await assert.doesNotReject(saveRow(t, actRef, { instructionsRich: richValue, instructions: richTextToPlainText(richValue) }, original));

    // ---- 6. Reopen ----
    original = (await getDoc(actRef)).data();

    // ---- 7. Edit Group 1 topic a SECOND time (first save + a second save) -> 8. Save successfully ----
    let topicOriginal = (await getDoc(topic1Ref)).data();
    let topicValue = makeRich("Group 1 topic v1", { italic: true, font: "arial" });
    await assert.doesNotReject(saveRow(t, topic1Ref, { topicRich: topicValue, topic: richTextToPlainText(topicValue) }, topicOriginal));
    topicOriginal = (await getDoc(topic1Ref)).data();
    topicValue = makeRich("Group 1 topic v2 EDITED", { italic: true, font: "arial" });
    await assert.doesNotReject(saveRow(t, topic1Ref, { topicRich: topicValue, topic: richTextToPlainText(topicValue) }, topicOriginal));

    // ---- 9. Confirm plain mirrors exact ----
    const actAfter = (await getDoc(actRef)).data();
    const topic1After = (await getDoc(topic1Ref)).data();
    assert.equal(actAfter.instructions, richTextToPlainText(actAfter.instructionsRich));
    assert.equal(topic1After.topic, richTextToPlainText(topic1After.topicRich));

    // ---- 10. Confirm formatting persists ----
    assert.ok(validateRichTextV1(actAfter.instructionsRich));
    assert.equal(actAfter.instructionsRich.blocks[0].runs[0].bold, true);
    assert.equal(actAfter.instructionsRich.blocks[0].runs[0].italic, true);
    assert.ok(validateRichTextV1(topic1After.topicRich));
    assert.equal(topic1After.topicRich.blocks[0].runs[0].italic, true);
    assert.equal(topic1After.topicRich.blocks[0].runs[0].font, "arial");

    // ---- 11. Simulate genuine external concurrent change ----
    // "Modal open" snapshot taken BEFORE the external change lands.
    const staleOriginal = (await getDoc(topic1Ref)).data();
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "groupActivities", ACT, "topics", "1"), {
        group: 1, topic: "Externally changed by another window",
        topicRich: makeRich("Externally changed by another window", { color: "red" }),
        updatedAt: new Date()
      });
    });

    // ---- 12. Attempt stale-modal save -> 13. Confirm conflict guard BLOCKS it ----
    const staleAttempt = makeRich("My stale edit, should be rejected", { italic: true });
    await assert.rejects(
      saveRow(t, topic1Ref, { topicRich: staleAttempt, topic: richTextToPlainText(staleAttempt) }, staleOriginal),
      /CONFLICT:topicRich/
    );
    // Must not have partially applied.
    const afterBlockedAttempt = (await getDoc(topic1Ref)).data();
    assert.equal(afterBlockedAttempt.topic, "Externally changed by another window", "the blocked stale save must not have overwritten the external change");

    // ---- 14. Refresh/reopen -> 15. Save normally ----
    const freshOriginal = (await getDoc(topic1Ref)).data();
    const recoveredValue = makeRich("Recovered after reopen", { bold: true });
    await assert.doesNotReject(saveRow(t, topic1Ref, { topicRich: recoveredValue, topic: richTextToPlainText(recoveredValue) }, freshOriginal));
    const finalTopic = (await getDoc(topic1Ref)).data();
    assert.equal(finalTopic.topic, "Recovered after reopen");
  });
});

test("GATE 2B-RT-FIX1 emulator acceptance: repeated sequential saves (#1, #2, #3) for common AND topic — no false conflict on any of them", async () => {
  await withEnv(async (testEnv) => {
    await seedRaw(testEnv, async (raw) => {
      await setDoc(doc(raw, "users", "teacher-a"), { role: "teacher", status: "active" });
      await setDoc(doc(raw, "groupActivities", ACT), {
        ownerId: "teacher-a", classId: null, className: "", title: "FIX1 repeated saves",
        instructions: "", groupCount: 2, durationSec: 900, allowText: true, allowPhoto: true, allowFile: true,
        joinCode: "FIX1RS", status: "open", startedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
      });
      await setDoc(doc(raw, "groupActivities", ACT, "topics", "1"), { group: 1, topic: "", updatedAt: new Date() });
    });
    const t = teacherCtx(testEnv).firestore();
    const actRef = doc(t, "groupActivities", ACT);
    const topic1Ref = doc(t, "groupActivities", ACT, "topics", "1");

    for (const [ref, richKey, plainKey] of [[actRef, "instructionsRich", "instructions"], [topic1Ref, "topicRich", "topic"]]) {
      let original = (await getDoc(ref)).data();
      for (let n = 1; n <= 3; n++) {
        const value = makeRich(`Save #${n}`, { bold: n % 2 === 0 });
        await assert.doesNotReject(saveRow(t, ref, { [richKey]: value, [plainKey]: richTextToPlainText(value) }, original));
        original = (await getDoc(ref)).data();
        assert.equal(original[plainKey], `Save #${n}`, `save #${n} must be readable back immediately for ${richKey}`);
      }
    }
  });
});
