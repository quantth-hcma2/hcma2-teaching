// TEST-ONLY evidence for the Architect (NEVER shipped, never deployed): the PROPOSED minimal Rules amendment applied to an in-memory COPY of the production Rules artifact.
// It is used only by the emulator probes in this folder to show what the amendment would close and whether the call budget still holds. The repository Rules file is not touched.
//
// PROPOSAL "import freeze": a framework that has a paired importBatches/{fwId} can be mutated (framework update/delete, node create/update/delete) only when
//   - the batch is 'completed'                                  (the import is finished: ordinary P3 draft editing), or
//   - the batch is 'committing' AND the writer is the importer  (only the importing user mutates while the import runs), or
//   - the batch is 'partial' AND the operation is a delete      (clean-up / rollback by any authorized writer).
// A framework without a batch (every P3 framework) is unaffected. committing -> partial (abandon) stays open to any authorized writer, so another administrator can still recover.
export const AMENDMENT_ANCHORS = [
  // [anchor, replacement] - each anchor occurs exactly once in the production artifact
  ["    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }\n",
   "    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }\n" +
   "    function importMutationOk(fwId, kind) {\n" +
   "      return !exists(importPath(fwId)) ||\n" +
   "        get(importPath(fwId)).data.status == 'completed' ||\n" +
   "        (get(importPath(fwId)).data.status == 'committing' && get(importPath(fwId)).data.importer == request.auth.uid) ||\n" +
   "        (get(importPath(fwId)).data.status == 'partial' && kind == 'delete');\n" +
   "    }\n"],
  ["importAllowsActivation(fwId, resource.data.organizationId));", "importAllowsActivation(fwId, resource.data.organizationId)) &&\n        importMutationOk(fwId, 'update');"],
  ["        !('activatedAt' in resource.data) &&\n        mayWriteCurriculum(resource.data.organizationId);", "        !('activatedAt' in resource.data) &&\n        mayWriteCurriculum(resource.data.organizationId) &&\n        importMutationOk(fwId, 'delete');"],
  ["          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId);", "          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId) &&\n          importMutationOk(fwId, 'create');"],
  ["          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(resource.data.organizationId);", "          nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(resource.data.organizationId) &&\n          importMutationOk(fwId, 'update');"],
  ["            (nodeParent().status == 'draft' && !('activatedAt' in nodeParent())));", "            (nodeParent().status == 'draft' && !('activatedAt' in nodeParent()))) &&\n          importMutationOk(fwId, 'delete');"]
];
export function amendedRules(rules) {
  let out = rules;
  for (const [anchor, replacement] of AMENDMENT_ANCHORS) {
    if (out.split(anchor).length !== 2) throw new Error("amendment anchor must occur exactly once: " + anchor.slice(0, 70));
    out = out.replace(anchor, () => replacement);
  }
  return out;
}
