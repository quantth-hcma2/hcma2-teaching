// Gate 1B.2C-T — pure tests for session-view.mjs's view-model helpers. These are the exact
// functions showQrModal, watchPresentation, and exportSessionJSON call in index.html — testing
// them directly is testing what those consumers actually do with an already-resolved title, not
// an assumption about it. No Firestore, no DOM, no emulator needed.
import test from "node:test";
import assert from "node:assert/strict";
import { qrModalViewModel, presentationRenderState, buildInteractionJsonExport } from "../../session-view.mjs";

const OLD_TITLE = "Khởi động (cũ)";
const NEW_TITLE = "Khởi động (đã sửa — REVISION 1)";

// =====================================================================================
// QR MODAL
// =====================================================================================

test("qrModalViewModel: uses the caller-provided displayTitle verbatim, never reads session.title itself", () => {
  const session = { title: OLD_TITLE, shortCode: "ABC123" }; // deliberately a session whose OWN title is the stale/old one
  const vm = qrModalViewModel(session, NEW_TITLE);
  assert.equal(vm.title, NEW_TITLE, "must reflect the resolved title passed in, not session.title");
  assert.notEqual(vm.title, session.title, "sanity: session.title and the resolved title really do differ in this fixture");
  assert.equal(vm.shortCode, "ABC123");
});

test("qrModalViewModel: missing displayTitle does not silently substitute session.title", () => {
  const session = { title: OLD_TITLE, shortCode: "ABC123" };
  const vm = qrModalViewModel(session, undefined);
  assert.equal(vm.title, "", "must not fall back to session.title when no displayTitle is provided");
});

// =====================================================================================
// PRESENTATION
// =====================================================================================

test("presentationRenderState: contract session ALWAYS resolves to contract-unsupported, regardless of status", () => {
  const base = { editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1", title: OLD_TITLE };
  for (const status of ["draft", "ready", "open", "closed", "archived"]) {
    const result = presentationRenderState({ ...base, status });
    assert.deepEqual(result, { mode: "contract-unsupported" }, `status=${status} must still be contract-unsupported`);
  }
});

test("presentationRenderState: contract session with an active question still resolves to contract-unsupported, never 'question' mode with a stale title", () => {
  const session = { editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1", status: "open", activeQuestionId: "q1", title: OLD_TITLE };
  const result = presentationRenderState(session);
  assert.equal(result.mode, "contract-unsupported");
  assert.equal("title" in result, false, "contract-unsupported carries no title field at all — old or new");
});

test("presentationRenderState: legacy draft/ready session resolves to waiting with the root title (legacy is safe/unaffected)", () => {
  const result = presentationRenderState({ status: "ready", title: "Phiên chưa kích hoạt", className: "K77.A01", shortCode: "XYZ" });
  assert.equal(result.mode, "waiting");
  assert.equal(result.title, "Phiên chưa kích hoạt");
});

test("presentationRenderState: legacy closed/archived session resolves to ended with the root title", () => {
  const result = presentationRenderState({ status: "closed", title: "Phiên chưa kích hoạt" });
  assert.equal(result.mode, "ended");
  assert.equal(result.title, "Phiên chưa kích hoạt");
});

test("presentationRenderState: legacy open session with no active question resolves to waiting (matches watchPresentation's original branch order)", () => {
  const result = presentationRenderState({ status: "open", activeQuestionId: null, title: "Phiên chưa kích hoạt" });
  assert.equal(result.mode, "waiting");
});

test("presentationRenderState: legacy open session WITH an active question resolves to question mode with the root title", () => {
  const result = presentationRenderState({ status: "open", activeQuestionId: "q1", title: "Phiên chưa kích hoạt", className: "K77.A01" });
  assert.equal(result.mode, "question");
  assert.equal(result.title, "Phiên chưa kích hoạt");
});

// =====================================================================================
// JSON EXPORT
// =====================================================================================

test("buildInteractionJsonExport: hoatDong uses the caller-provided semanticTitle, never session.title", () => {
  const session = { title: OLD_TITLE, createdAt: null }; // session's own title is deliberately the stale/old one
  const out = buildInteractionJsonExport(session, "K77.A01", [], NEW_TITLE);
  assert.equal(out.hoatDong, NEW_TITLE);
  assert.notEqual(out.hoatDong, session.title, "sanity: session.title and the resolved title really do differ in this fixture");
});

test("buildInteractionJsonExport: question/answer structure is preserved exactly as before", () => {
  const session = { title: OLD_TITLE, createdAt: null };
  const questionBlocks = [{
    q: { question: "Câu 1?", type: "single" },
    options: [{ text: "A" }, { text: "B" }],
    docs: [{ participantId: "p1", answer: null, selectedOptions: ["A"], submittedAt: null }]
  }];
  const out = buildInteractionJsonExport(session, "K77.A01", questionBlocks, NEW_TITLE);
  assert.equal(out.lop, "K77.A01");
  assert.equal(out.cauHoi.length, 1);
  assert.equal(out.cauHoi[0].cauHoi, "Câu 1?");
  assert.deepEqual(out.cauHoi[0].phuongAn, ["A", "B"]);
  assert.equal(out.cauHoi[0].cauTraLoi[0].participantId, "p1");
});
