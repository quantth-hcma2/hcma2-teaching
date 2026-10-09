// TEST-ONLY (NEVER shipped, never deployed): the FINAL PROPOSED "import freeze" Rules amendment (Architect design gate) applied to an in-memory COPY of the production Rules artifact.
// Supersedes amended-rules.mjs (first proposal: importer-only while committing - rejected because recovery must not be tied to the original importer).
//
// STATE MACHINE USED AS THE LOCK (no new status, no new field): the paired importBatches/{fwId} document
//   committing, chunksDone <  chunksTotal   "importing"  : node CREATE only, id shaped like an import node id (32 lower-case hex); no node update/delete; no framework update/delete
//   committing, chunksDone == chunksTotal   "sealed"     : every chunk is declared written - NO node create/update/delete, NO framework update/delete (nodes cannot change until the batch leaves committing)
//   partial                                 "cleanup"    : node DELETE and framework DELETE only (rollback by any authorized writer); no create/update
//   completed                               ordinary P3 draft (everything as before);   rolled_back: orphan node delete only
// A framework WITHOUT a batch is unaffected (every ordinary P3 framework). Activation and clone of incomplete imports stay denied by P4-S1; batch rules are NOT touched
// (committing -> partial is the barrier: it is already open to every authorized writer and is atomic with respect to every other write).
export const FREEZE_ANCHORS = [
  ["    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }\n",
   "    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }\n" +
   "    // P4-S4 IMPORT FREEZE (design LIBRARY_V2_P4_S4_RULES_DESIGN_GATE.md): the paired importBatches document is the lock. A framework WITHOUT a paired batch (every ordinary P3 framework) and a COMPLETED\n" +
   "    // import are unaffected. While the batch is 'committing' only import-shaped node CREATES (32 lower-case hex ids) are admitted, and only until the batch is SEALED (chunksDone == chunksTotal: every\n" +
   "    // chunk is written and the controller verifies): from the seal on nobody can create, change or delete a node or the framework until the batch leaves 'committing'. 'partial' (abandoned / rollback\n" +
   "    // started / verification failed) admits only DELETES (clean-up). WHO may recover is not restricted here: the batch rules above are untouched (any authorized writer can abandon, resume, roll back).\n" +
   "    function importNodeCreateOk(fwId, nodeId) {\n" +
   "      return !exists(importPath(fwId)) ||\n" +
   "        get(importPath(fwId)).data.status == 'completed' ||\n" +
   "        (get(importPath(fwId)).data.status == 'committing' && get(importPath(fwId)).data.chunksDone < get(importPath(fwId)).data.chunksTotal && nodeId.matches('^[0-9a-f]{32}$'));\n" +
   "    }\n" +
   "    function importNodeUpdateOk(fwId) { return !exists(importPath(fwId)) || get(importPath(fwId)).data.status == 'completed'; }\n" +
   "    function importNodeDeleteOk(fwId) { return !exists(importPath(fwId)) || get(importPath(fwId)).data.status in ['completed', 'partial', 'rolled_back']; }\n" +
   "    function importFrameworkUpdateOk(fwId) { return !exists(importPath(fwId)) || get(importPath(fwId)).data.status == 'completed'; }\n" +
   "    function importFrameworkDeleteOk(fwId) { return !exists(importPath(fwId)) || get(importPath(fwId)).data.status in ['completed', 'partial']; }\n"],
  ["importAllowsActivation(fwId, resource.data.organizationId));", "importAllowsActivation(fwId, resource.data.organizationId)) &&\n        importFrameworkUpdateOk(fwId);"],
  ["        !('activatedAt' in resource.data) &&\n        mayWriteCurriculum(resource.data.organizationId);", "        !('activatedAt' in resource.data) &&\n        mayWriteCurriculum(resource.data.organizationId) &&\n        importFrameworkDeleteOk(fwId);"],
  ["          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId);", "          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId) &&\n          importNodeCreateOk(fwId, nodeId);"],
  ["          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(resource.data.organizationId);", "          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(resource.data.organizationId) &&\n          importNodeUpdateOk(fwId);"],
  ["            (nodeParent().status == 'draft' && !('activatedAt' in nodeParent())));", "            (nodeParent().status == 'draft' && !('activatedAt' in nodeParent()))) &&\n          importNodeDeleteOk(fwId);"]
];
export const FREEZE_SIGNATURE_BEFORE = "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485";   // the deployed ruleset 0b6910c3
export function freezeRules(rules) {
  let out = rules;
  for (const [anchor, replacement] of FREEZE_ANCHORS) {
    if (out.split(anchor).length !== 2) throw new Error("freeze anchor must occur exactly once: " + anchor.slice(0, 70));
    out = out.replace(anchor, () => replacement);
  }
  return out;
}
// The DEPLOYED ruleset text = the candidate with the freeze edits reversed (proves the candidate differs from production by exactly these edits).
export function deployedRules(candidate) {
  let out = candidate;
  for (const [anchor, replacement] of FREEZE_ANCHORS) {
    if (out.split(replacement).length !== 2) throw new Error("freeze edit not present exactly once: " + replacement.slice(0, 70));
    out = out.replace(replacement, () => anchor);
  }
  return out;
}
