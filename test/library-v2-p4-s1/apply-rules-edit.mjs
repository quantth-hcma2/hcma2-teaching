// P4-S1 helper (kept as evidence, run once): applies the approved P4-S1 edits to firestore.rules.production-candidate.
//  (1) two single-clause edits inside the P3 region (D14 clone laundering in the framework CREATE rule, authoritative activation protection in the framework UPDATE rule);
//  (2) a new additive P4-S1 region (import-batch helpers + importBatches block) inserted after the P3 region and before the default-deny block.
import { readFileSync, writeFileSync } from "node:fs";
const FILE = new URL("../../firestore.rules.production-candidate", import.meta.url);
let rules = readFileSync(FILE, "utf8");
const NL = String.fromCharCode(10);
const once = (hay, needle) => { const parts = hay.split(needle); if (parts.length !== 2) throw new Error("anchor not present exactly once: " + needle.slice(0, 80)); };

const CREATE_OLD = `        (!('cloneSource' in request.resource.data) ||
          get(fwPath(request.resource.data.cloneSource.frameworkId)).data.organizationId == request.resource.data.organizationId);`;
const CREATE_NEW = `        (!('cloneSource' in request.resource.data) ||
          (get(fwPath(request.resource.data.cloneSource.frameworkId)).data.organizationId == request.resource.data.organizationId &&
           importAllowsActivation(request.resource.data.cloneSource.frameworkId, request.resource.data.organizationId)));   // P4-S1 (D14): an incomplete import cannot be cloned into an unpaired framework`;
const UPDATE_OLD = `        fwTransitionOk(resource.data, request.resource.data) &&
        mayWriteCurriculum(resource.data.organizationId);
      // Only a never-activated draft may be deleted`;
const UPDATE_NEW = `        fwTransitionOk(resource.data, request.resource.data) &&
        mayWriteCurriculum(resource.data.organizationId) &&
        (resource.data.status != 'draft' || request.resource.data.status != 'active' || importAllowsActivation(fwId, resource.data.organizationId));   // P4-S1: import-governed frameworks activate only after a completed batch
      // Only a never-activated draft may be deleted`;
once(rules, CREATE_OLD); once(rules, UPDATE_OLD);
rules = rules.replace(CREATE_OLD, () => CREATE_NEW).replace(UPDATE_OLD, () => UPDATE_NEW);

const P4 = `    // ===== LIBRARY V2 P4-S1 (IMPORT BATCHES) - BEGIN =====
    // Import-batch foundation for the P4 curriculum import (authority: LIBRARY_V2_P4_DESIGN_R2.md, Architect-approved decisions D1-D16; frozen contracts v1.1 s9).
    //  PAIRED IDENTITY: importBatches/{X} and curriculumFrameworks/{X} share ONE id for an imported framework. A framework is import-governed if and only if
    //  importBatches/{its id} exists. The batch must exist FIRST (a batch cannot be created when the framework document already exists) and batches are never
    //  deleted, so governance can neither be added to nor removed from a framework afterwards. No importBatchId field exists on frameworks or nodes.
    //  WHAT THESE RULES GUARANTEE: (a) an import-governed framework can go draft -> active only when its batch is 'completed' (same organization, kind curriculum),
    //  (b) a clone of an import-governed framework is allowed only from a completed batch (no laundering of an incomplete import into an unpaired framework),
    //  (c) batch shape, immutable identity, organization isolation, active-organization writes, legal status transitions, no delete,
    //  (d) 'completed' only while the paired framework exists as a never-activated draft of the same organization, the declared witness node (finalNodeId) exists in it and
    //      chunksDone == chunksTotal; 'rolled_back' only when the paired framework and the witness node no longer exist.
    //  WHAT THEY DO NOT GUARANTEE (controller read-back verification, P4-S4): that all planned nodes exist, node counts, canonical code uniqueness, hierarchy completeness,
    //  sibling order, or equality with the import plan. finalNodeId is a finite witness, NOT proof of a complete import. Read/write follow the P3 curriculum semantics.
    function importPath(id) { return /databases/$(database)/documents/importBatches/$(id); }
    function importAllowsActivation(id, orgId) {
      return !exists(importPath(id)) ||
        (get(importPath(id)).data.status == 'completed' &&
         get(importPath(id)).data.organizationId == orgId &&
         get(importPath(id)).data.kind == 'curriculum');
    }
    function importIntIn(v, lo, hi) { return v is int && v >= lo && v <= hi; }

    match /importBatches/{batchId} {
      function batchNodePath(d) { return /databases/$(database)/documents/curriculumFrameworks/$(batchId)/nodes/$(d.finalNodeId); }
      function batchShapeOk(d) {
        return d.keys().hasAll(['schemaVersion', 'kind', 'organizationId', 'destination', 'templateId', 'templateVersion', 'sourceFile', 'importer', 'createdAt', 'updatedAt', 'status', 'counts', 'chunksDone', 'chunksTotal', 'warningsSummary', 'finalNodeId']) &&
          d.keys().hasOnly(['schemaVersion', 'kind', 'organizationId', 'destination', 'templateId', 'templateVersion', 'sourceFile', 'importer', 'createdAt', 'updatedAt', 'status', 'counts', 'chunksDone', 'chunksTotal', 'warningsSummary', 'finalNodeId', 'finishedAt', 'resultCode']) &&
          d.schemaVersion == 1 &&
          d.kind == 'curriculum' &&
          d.organizationId is string &&
          d.destination is map && d.destination.keys().hasAll(['type', 'frameworkId']) && d.destination.keys().hasOnly(['type', 'frameworkId']) &&
          d.destination.type == 'curriculumFramework' && d.destination.frameworkId == batchId &&
          d.templateId == 'hcma2.curriculum.xlsx' && importIntIn(d.templateVersion, 1, 1000) &&
          d.sourceFile is map && d.sourceFile.keys().hasAll(['name', 'size', 'sha256']) && d.sourceFile.keys().hasOnly(['name', 'size', 'sha256']) &&
          d.sourceFile.name is string && d.sourceFile.name.size() >= 1 && d.sourceFile.name.size() <= 200 &&
          importIntIn(d.sourceFile.size, 0, 5242880) &&
          d.sourceFile.sha256 is string && d.sourceFile.sha256.matches('^[0-9a-f]{64}$') &&
          d.importer is string &&
          d.status in ['committing', 'completed', 'partial', 'rolled_back'] &&
          d.counts is map && d.counts.keys().hasAll(['parsed', 'accepted', 'skipped', 'failed']) && d.counts.keys().hasOnly(['parsed', 'accepted', 'skipped', 'failed']) &&
          importIntIn(d.counts.parsed, 0, 5000) && importIntIn(d.counts.accepted, 0, 5000) && importIntIn(d.counts.skipped, 0, 5000) && importIntIn(d.counts.failed, 0, 5000) &&
          d.counts.accepted <= d.counts.parsed &&
          importIntIn(d.chunksTotal, 0, 13) && importIntIn(d.chunksDone, 0, 13) && d.chunksDone <= d.chunksTotal &&
          d.warningsSummary is map && d.warningsSummary.size() <= 20 &&
          d.finalNodeId is string && d.finalNodeId.matches('^[0-9a-f]{32}$') &&
          ((d.status == 'committing') == !('finishedAt' in d)) &&
          (!('finishedAt' in d) || d.finishedAt is timestamp) &&
          (!('resultCode' in d) || (d.resultCode is string && d.resultCode.size() >= 1 && d.resultCode.size() <= 40));
      }
      // Identity, provenance and plan facts never change; only status, progress, warnings, finishedAt, resultCode and updatedAt move.
      function batchImmutableOk(b, a) {
        return a.schemaVersion == b.schemaVersion && a.kind == b.kind && a.organizationId == b.organizationId && a.destination == b.destination &&
          a.templateId == b.templateId && a.templateVersion == b.templateVersion && a.sourceFile == b.sourceFile && a.importer == b.importer &&
          a.createdAt == b.createdAt && a.finalNodeId == b.finalNodeId && a.counts == b.counts && a.chunksTotal == b.chunksTotal;
      }
      // Finite, Rules-checkable witness only: the paired framework exists as a never-activated draft of this organization and the declared witness node exists in it.
      function completionWitnessOk(a) {
        return get(fwPath(batchId)).data.organizationId == a.organizationId &&
          get(fwPath(batchId)).data.status == 'draft' &&
          !('activatedAt' in get(fwPath(batchId)).data) &&
          get(batchNodePath(a)).data.organizationId == a.organizationId;
      }
      // 'rolled_back' is only truthful about what Rules can see: the paired framework and the witness node are gone.
      function cleanupWitnessOk(a) { return !exists(fwPath(batchId)) && !exists(batchNodePath(a)); }
      // b = stored (old), a = incoming (new). committing -> committing (progress) | completed | partial | rolled_back; partial -> rolled_back; completed and rolled_back are terminal.
      function batchTransitionOk(b, a) {
        return (b.status == 'committing' && (
                  (a.status == 'committing' && !('resultCode' in a)) ||
                  (a.status == 'completed' && a.chunksDone == a.chunksTotal && a.finishedAt == request.time && completionWitnessOk(a)) ||
                  (a.status == 'partial' && a.finishedAt == request.time) ||
                  (a.status == 'rolled_back' && a.finishedAt == request.time && cleanupWitnessOk(a)))) ||
               (b.status == 'partial' && a.status == 'rolled_back' && a.finishedAt == request.time && cleanupWitnessOk(a));
      }

      allow get, list: if isAdmin() || mayReadCurriculum(resource.data.organizationId);
      // The batch comes FIRST: it can only be created while no framework document with the same id exists. Same actor/organization guard as every curriculum write.
      allow create: if batchShapeOk(request.resource.data) &&
        request.resource.data.status == 'committing' &&
        request.resource.data.chunksDone == 0 &&
        !('resultCode' in request.resource.data) &&
        request.resource.data.importer == request.auth.uid &&
        request.resource.data.createdAt == request.time &&
        request.resource.data.updatedAt == request.time &&
        mayWriteCurriculum(request.resource.data.organizationId) &&
        !exists(fwPath(batchId));
      allow update: if batchShapeOk(request.resource.data) &&
        batchImmutableOk(resource.data, request.resource.data) &&
        request.resource.data.updatedAt == request.time &&
        request.resource.data.chunksDone >= resource.data.chunksDone &&
        mayWriteCurriculum(resource.data.organizationId) &&
        batchTransitionOk(resource.data, request.resource.data);
      // Batches are durable governance evidence and are never deleted.
      allow delete: if false;
    }
    // ===== LIBRARY V2 P4-S1 (IMPORT BATCHES) - END =====

`;
const anchor = "    // ===== LIBRARY V2 P3-S1 (CURRICULUM) - END =====" + NL + NL;
once(rules, anchor);
rules = rules.replace(anchor, () => anchor + P4);
writeFileSync(FILE, rules);
console.log("applied; lines:", rules.split(NL).length);
