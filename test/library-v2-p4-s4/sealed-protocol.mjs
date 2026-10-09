// TEST-ONLY PROTOTYPE of the controller changes that go with the import-freeze Rules (the product controller is NOT modified in this design gate).
// loadSealedController() derives the prototype from the real import-commit-controller.mjs by exact-anchor edits (each anchor must occur exactly once), so the delta below IS the proposed
// implementation change set:
//   P1  completionMode default "plain": no completion transaction (the Rules freeze makes it redundant)
//   P2  SEAL: after the last node is present, write progress chunksDone := chunksTotal (the Rules freeze every node/framework mutation from this write on)
//   P3  a sealed batch that is missing a planned node cannot be repaired (creates are frozen) -> durable `partial`
//   P4  post-seal verification failures are never "repairable": -> `partial` (VERIFY_FAILED)
//   P5  completion refused because another client moved the batch to `partial` is reported as such
//   P6  no post-commit full re-read (the nodes cannot change between the verification and the completion)
//   P7  ROLLBACK BARRIER: rollback first moves committing -> partial (resultCode ROLLBACK_STARTED), which atomically stops every resume/seal/completion, then deletes
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(root, "import-commit-controller.mjs");
export const SEALED_EDITS = [
  ['completionMode = "transaction" } = {}) {', 'completionMode = "plain" } = {}) {'],
  ['    progress("nodes", { nodesWritten: written, chunk: 0 });\n\n    // 4. node chunks',
   '    progress("nodes", { nodesWritten: written, chunk: 0 });\n    if ((batch.chunksDone || 0) >= plan.chunks.length && present.size < plan.nodes.length) return await failVerification({ plan, organizationId, verification: interim, batchId, phase: "scan" });   // sealed: frozen, a missing node cannot be repaired\n\n    // 4. node chunks'],
  ['    // 5. FULL read-back verification of everything that exists (never "the counter says so")',
   '    // SEAL: every chunk is written; declare it. From this write on the Rules freeze every node and framework mutation until the batch leaves committing.\n' +
   '    if (present.size !== plan.nodes.length) return stop("incomplete", { phase: "seal", nodesWritten: written });\n' +
   '    if ((batch.chunksDone || 0) < plan.chunks.length) {\n' +
   '      const sealed = await withRetry(() => fs.updateDoc(batchRef(batchId), { chunksDone: plan.chunks.length, updatedAt: fs.serverTimestamp() }), "progress");\n' +
   '      if (!sealed.ok) { const again = await readBatch(batchId).catch(() => null); if (again && again.status !== "committing") return stop("not-committing", { status: again.status, phase: "seal" }); return stop(failureState(sealed.kind), { phase: "seal", kind: sealed.kind, nodesWritten: written }); }\n' +
   '      batch = { ...batch, chunksDone: plan.chunks.length };\n' +
   '    }\n\n' +
   '    // 5. FULL read-back verification of everything that exists (never "the counter says so")'],
  ['      if (verification.repairable) return stop("incomplete", { phase: "verify", verification, nodesWritten: written });   // missing only: a resume writes them (batch stays committing)\n', ''],
  ['    if (!completed.ok) return stop(failureState(completed.kind), { phase: "complete", kind: completed.kind, verification, nodesWritten: written });',
   '    if (!completed.ok) { const again = await readBatch(batchId).catch(() => null); if (again && again.status === "partial") return stop("not-committing", { status: "partial", phase: "complete" }); return stop(failureState(completed.kind), { phase: "complete", kind: completed.kind, verification, nodesWritten: written }); }'],
  ['    if (completed.value && completed.value.ok === false) {', '    if (false && completed.value && completed.value.ok === false) {'],
  ['    const eligibility = activationEligibility({ batch: finalBatch, framework: finalFramework, nodes: confirmRead.value });', '    const eligibility = activationEligibility({ batch: finalBatch, framework: finalFramework, nodes: readBack.nodes });'],
  ['    // 1. nodes (repeat: list a page, delete it in atomic batches of <= 400, until the framework holds none)',
   '    // BARRIER: committing -> partial is atomic with respect to every resume / seal / completion write (their Rules read the batch status); after it nobody can create a node\n' +
   '    if (batch.status === "committing") {\n' +
   '      const barrier = await withRetry(() => fs.updateDoc(batchRef(batchId), { status: "partial", resultCode: "ROLLBACK_STARTED", finishedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }), "partial");\n' +
   '      if (!barrier.ok) { const again = await readBatch(batchId).catch(() => null); if (!again || again.status === "completed") return stop("not-rollbackable", { status: again ? again.status : "missing" }); if (again.status !== "partial") return stop(failureState(barrier.kind), { phase: "barrier", kind: barrier.kind }); }\n' +
   '    }\n' +
   '    // 1. nodes (repeat: list a page, delete it in atomic batches of <= 400, until the framework holds none)']
];
// removes the post-commit confirmation block (P6)
const CONFIRM_START = "    // confirmation AFTER the commit: the transaction cannot see nodes outside the plan";
const CONFIRM_END = '    if (!confirmation.ok) return stop("completed-drift", { phase: "confirm", verification: confirmation, batchCompleted: true, nodesWritten: written });\n';

export function sealedSource() {
  let src = readFileSync(SRC, "utf8");
  for (const [anchor, replacement] of SEALED_EDITS) {
    if (src.split(anchor).length !== 2) throw new Error("sealed-protocol anchor must occur exactly once: " + anchor.slice(0, 80));
    src = src.replace(anchor, () => replacement);
  }
  const a = src.indexOf(CONFIRM_START), b = src.indexOf(CONFIRM_END);
  if (a < 0 || b < 0 || b < a) throw new Error("confirm block markers");
  src = src.slice(0, a) + src.slice(b + CONFIRM_END.length);
  // relative imports -> absolute file URLs (the prototype is written outside the repository)
  src = src.replace(/from "\.\/([a-z0-9-]+\.mjs)"/g, (m, f) => 'from "' + pathToFileURL(join(root, f)).href + '"');
  return src;
}
let cached = null;
export async function loadSealedController() {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "p4s4-sealed-"));
  const file = join(dir, "import-commit-controller.sealed.mjs");
  writeFileSync(file, sealedSource());
  cached = await import(pathToFileURL(file).href);
  return cached;
}
