// P3-S5 edits to files that earlier slices pinned: the exact edits plus reversals that restore the previously verified (P3-S4 candidate de9057d) bytes, so every older
// byte-pin keeps its meaning and any OTHER change is still detected. Per-file helpers: model (cloneCompleteness D1 resolution), the P3-S3 curriculum section view
// (clone / delete-draft controls + flows, enabled only when cloneTools is injected) and index.html (wiring + cache tokens). Imports nothing (s4-edits composes these).
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);

function transform(source, edits, label, direction) {
  let result = source;
  for (const [added, original] of edits) {
    const from = direction === "reverse" ? added : original, to = direction === "reverse" ? original : added;
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(from, crlf), b = withNl(to, crlf);
      if (result.split(a).length - 1 === 1) { result = result.replace(a, () => b); done = true; break; }
    }
    if (!done) throw new Error(label + " edit not present exactly once (" + direction + "): " + from.slice(0, 70));
  }
  return result;
}

// ---------------------------------------------------------------- curriculum-model.mjs: D1 resolved - cloneSource.nodeCount is a fixed provenance/lower bound, not a live checksum
const M_OLD_COMMENT = `// Per P3 Design R1 section 10: a draft whose cloneSource.nodeCount differs from its loaded ACTIVE node count is an incomplete clone.
// DEFERRED TO P3-S5 (Owner decision, P3-S2 final policy refinement D1): these semantics are kept as designed for now and MUST be revisited in P3-S5 BEFORE
// clone becomes user-facing - cloneSource.nodeCount must not accidentally become a permanent live checksum that makes a legitimately edited clone
// (nodes added, deleted or retired after the clone finished) look incomplete. Not a blocker for P3-S3/S4: no clone exists until P3-S5.
export function cloneCompleteness(framework, nodes) {
  const marker = framework && framework.cloneSource;
  if (!marker || typeof marker !== "object") return freeze({ isClone: false, complete: true, expected: null, actual: null });
  const actual = (nodes || []).filter((node) => node && node.status === "active").length;
  return freeze({ isClone: true, complete: actual === marker.nodeCount, expected: marker.nodeCount, actual });
}`;
const M_NEW_COMMENT = `// P3-S5 (D1 RESOLVED): cloneSource.nodeCount is the TOTAL number of source nodes (every status) that the clone operation committed to copy. The Rules make cloneSource
// immutable and force the framework to exist before its nodes, so it is fixed at creation and can only be PROVENANCE plus a completion LOWER BOUND, never a live checksum:
// a clone is complete when the destination holds AT LEAST that many nodes. The clone flow creates its last node in a final commit after every retire pass, so the count
// reaches nodeCount only when the clone is finished; later legitimate edits (rename, reorder, retire, restore, more nodes) can never push the count below it.
// (Individual node deletion is not offered for frameworks; the only delete is the whole never-activated draft.)
export function cloneCompleteness(framework, nodes) {
  const marker = framework && framework.cloneSource;
  if (!marker || typeof marker !== "object") return freeze({ isClone: false, complete: true, expected: null, actual: null });
  const actual = (nodes || []).filter((node) => node && typeof node === "object").length;
  return freeze({ isClone: true, complete: actual >= marker.nodeCount, expected: marker.nodeCount, actual });
}`;
const M_OLD_MSG = `add("INCOMPLETE_CLONE", "the clone is incomplete (expected " + clone.expected + " active nodes, found " + clone.actual + ")");`;
const M_NEW_MSG = `add("INCOMPLETE_CLONE", "the clone is incomplete (expected at least " + clone.expected + " nodes, found " + clone.actual + ")");`;
export const MODEL_EDITS_S5 = [[M_NEW_COMMENT, M_OLD_COMMENT], [M_NEW_MSG, M_OLD_MSG]];
export const reverseS5ModelEdits = (src) => transform(src, MODEL_EDITS_S5, "P3-S5 model", "reverse");
export const applyS5ModelEdits = (src) => transform(src, MODEL_EDITS_S5, "P3-S5 model", "forward");

// ---------------------------------------------------------------- curriculum-admin-view.mjs (P3-S3 section): NHÂN BẢN / XÓA BẢN NHÁP
const V_DESTR_OLD = `contract, writer, onOpenFramework } = deps;`;
const V_DESTR_NEW = `contract, writer, onOpenFramework, cloneTools } = deps;`;
const V_CONTROLS_OLD = `  function controlsFor(framework, organization, { canOpen = false } = {}) {
    const a = frameworkAvailability(framework, organization);
    return freeze({ open: !!canOpen, openReadOnly: a.readOnly, rename: a.canRename, activate: a.canActivate, archive: a.canArchive, restore: a.canRestore });`;
const V_CONTROLS_NEW = `  // P3-S5: lifecycleTools (clone / delete-draft) is true only when the clone tools are injected; clone needs an ACTIVE organization, delete-draft a never-activated draft.
  function controlsFor(framework, organization, { canOpen = false, lifecycleTools = false } = {}) {
    const a = frameworkAvailability(framework, organization);
    return freeze({ open: !!canOpen, openReadOnly: a.readOnly, rename: a.canRename, activate: a.canActivate, archive: a.canArchive, restore: a.canRestore, clone: !!lifecycleTools && a.organizationWritable, deleteDraft: !!lifecycleTools && a.canDelete });`;
const V_RENAME_BTN_OLD = `      controls.rename ? button("rename", "", "ĐỔI TÊN") : "",
`;
const V_RENAME_BTN_NEW = `      controls.rename ? button("rename", "", "ĐỔI TÊN") : "",
      controls.clone ? button("clone", "", "NHÂN BẢN") : "",
`;
const V_ARCHIVE_BTN_OLD = `      controls.archive ? button("archive", "", "LƯU TRỮ") : "",
`;
const V_ARCHIVE_BTN_NEW = `      controls.archive ? button("archive", "", "LƯU TRỮ") : "",
      controls.deleteDraft ? \`<button class="btn btn-outline" type="button" style="color:var(--danger);border-color:var(--danger)" data-fw-action="delete-draft" data-fw-id="\${id}" aria-label="XÓA BẢN NHÁP — \${name}">XÓA BẢN NHÁP</button>\` : "",
`;
const V_SIG_OLD = `errorMessage = "", canOpen = false, esc, fmtDate, flashId = null }) {`;
const V_SIG_NEW = `errorMessage = "", canOpen = false, lifecycleTools = false, esc, fmtDate, flashId = null }) {`;
const V_ROWCALL_OLD = `controls: controlsFor(framework, organization, { canOpen }),`;
const V_ROWCALL_NEW = `controls: controlsFor(framework, organization, { canOpen, lifecycleTools }),`;
const V_PAINT_OLD = `items, truncated, canOpen, esc, fmtDate, flashId, ...extra });`;
const V_PAINT_NEW = `items, truncated, canOpen, lifecycleTools: !!cloneTools, esc, fmtDate, flashId, ...extra });`;
const V_ROWACTION_OLD = `      if (action === "archive" || action === "restore") return openConfirm(action, framework);
    }`;
const V_ROWACTION_NEW = `      if (action === "archive" || action === "restore") return openConfirm(action, framework);
      if (action === "clone") return openClone(framework);
      if (action === "delete-draft") return openDeleteDraft(framework);
    }`;
const V_FLOWS_ANCHOR = `    await load();
  }
  return freeze({ mount });`;
const V_FLOWS_BLOCK = `    // ---------------------------------------------------------- P3-S5: clone / delete never-activated draft (only when cloneTools is injected; see curriculum-clone-delete.mjs)
    const X = cloneTools && cloneTools.helpers, CW = cloneTools && cloneTools.writer;
    class CloneVerifyError extends Error {}
    const progress = (message) => { const el = modal$("#orgFwProgress"); if (el) { el.textContent = message; el.classList.remove("hidden"); } };
    const dialogIsOpen = () => !!(modalRoot() && modal$('[role="dialog"]'));
    // Rollback of a failed clone: delete the nodes, then the never-activated draft framework (children first, never orphans). false = could not finish (the leftover is a
    // detectably incomplete draft: activation is blocked and it can be deleted with XÓA BẢN NHÁP).
    async function rollbackClone(destId) {
      try {
        const existing = await queries.frameworkById(db, destId, { organizationId: org.id });
        if (!existing) return true;   // the framework create never reached the server: nothing to undo
        const result = await queries.nodesOfFramework(db, destId, org.id);
        for (const ids of X.planDeleteDraft(result.items).chunks) await CW.deleteNodes(db, destId, ids);
        await CW.deleteFramework(db, destId);
        return true;
      } catch { return false; }
    }
    function openClone(framework) {
      if (!X || busy || org.status !== "active") return;
      dialogOpen(X.renderCloneFormHtml({ framework, defaultName: X.defaultCloneName(framework.name), esc }), "#orgFwName");
      const form = modal$("#orgFwForm"), input = modal$("#orgFwName");
      form.onsubmit = (event) => {
        event.preventDefault();
        exclusive(async () => {
          hide(modal$("#orgFwNameErr")); hide(modal$("#orgFwErr")); hide(modal$("#orgFwProgress"));
          let name;
          try { name = H.validateName(input.value); } catch { show(modal$("#orgFwNameErr"), H.MESSAGES.name); input.focus(); return; }
          const submit = modal$("#orgFwSubmit"), label = submit && submit.textContent; if (submit) submit.textContent = "ĐANG NHÂN BẢN…";
          let destId = null, started = false, plan = null;
          try {
            const fresh = await readFresh(framework.id, { withNodes: true });
            if (H.frameworkChangedSince(framework, fresh.framework, { compareUpdatedAt: true }).changed) throw new FlowAbort("stale");
            destId = CW.newFrameworkId(db);
            plan = X.planClone({ nodes: fresh.nodes, organizationId: org.id, newId: () => CW.newNodeId(db, destId) });
            if (!plan.ok) { show(modal$("#orgFwErr"), plan.message); return; }
            // everything is validated and built BEFORE the first write (structure, depth, canonical duplicate codes, node cap)
            const frameworkData = contract.buildFrameworkCreate({ organization: fresh.organization, name, cloneSource: { framework: fresh.framework, nodeCount: plan.total } }, actorUid);
            const payloads = X.buildClonePayloads({ contract, organization: fresh.organization, destination: { id: destId, organizationId: org.id, status: "draft" }, plan });
            const itemOf = (item) => ({ id: item.newId, data: payloads.creates.get(item.newId) });
            started = true;
            progress("Đang tạo khung…");
            await CW.createFramework(db, destId, frameworkData);
            let done = 0;
            for (const items of plan.createChunks) { await CW.createNodes(db, destId, items.map(itemOf)); done += items.length; progress("Đã sao chép " + done + "/" + plan.total + " nút…"); }
            for (const ids of plan.retireChunks) await CW.updateNodes(db, destId, ids.map((id) => ({ id, data: payloads.retires.get(id) })));
            if (plan.finalItems.length) await CW.createNodes(db, destId, plan.finalItems.map(itemOf));   // the LAST node: the count reaches nodeCount only now
            progress("Đang xác minh…");
            const check = await queries.nodesOfFramework(db, destId, org.id);
            if (check.tooLarge || !X.verifyClone(plan, check.items)) throw new CloneVerifyError("verify");
            await audit("curriculum.framework.clone", destId, { name, sourceFrameworkId: framework.id, nodeCount: plan.total });
            return succeed("Đã nhân bản khung chương trình.", destId);
          } catch (error) {
            if (error instanceof FlowAbort && error.kind === "tooLarge") { show(modal$("#orgFwErr"), X.MESSAGES.tooLarge); return; }
            if (!started) return onFailure(error, { frameworkId: framework.id, expectStatus: framework.status });   // nothing was written
            // a lost response does not mean a failed clone: if the destination is complete and verified, finish normally (never roll back a good clone)
            let good = false;
            try { const check = await queries.nodesOfFramework(db, destId, org.id); good = !check.tooLarge && X.verifyClone(plan, check.items); } catch { /* unknown: fall through to the rollback */ }
            if (good) { await audit("curriculum.framework.clone", destId, { name, sourceFrameworkId: framework.id, nodeCount: plan.total }); return succeed("Đã nhân bản khung chương trình.", destId); }
            const cleaned = await rollbackClone(destId);
            const contractInfo = H.describeContractError(error);
            const kind = H.classifyFirebaseError(error, { online: typeof navigator === "undefined" ? true : navigator.onLine });
            const reason = error instanceof CloneVerifyError ? X.MESSAGES.cloneVerify : contractInfo ? contractInfo.message : kind === "permission-denied" ? H.MESSAGES.permissionWrite : mapError(error);
            const text = reason + " " + (cleaned ? X.MESSAGES.cloneRolledBack : X.MESSAGES.cloneLeftover);
            if (dialogIsOpen() && modal$("#orgFwErr")) show(modal$("#orgFwErr"), text); else { toast(text, "err"); live(text); }
            await load();   // show the TRUE state of the list
          } finally { if (submit && document.contains(submit) && label) submit.textContent = label; }
        });
      };
    }
    function openDeleteDraft(framework) {
      if (!X || busy || org.status !== "active") return;
      dialogOpen(X.renderDeleteDraftHtml({ framework, esc }), "#orgFwCancel");
      const ok = modal$("#orgFwConfirm");
      ok.onclick = () => exclusive(async () => {
        hide(modal$("#orgFwErr")); hide(modal$("#orgFwProgress"));
        const label = ok.textContent; ok.textContent = "ĐANG XÓA…";
        let started = false;
        try {
          const fresh = await readFresh(framework.id, { withNodes: true });
          if (H.frameworkChangedSince(framework, fresh.framework).changed || !model.frameworkAvailability(fresh.framework, fresh.organization).canDelete) throw new FlowAbort("stale");
          const plan = X.planDeleteDraft(fresh.nodes);
          started = true;
          let done = 0;
          for (const ids of plan.chunks) { await CW.deleteNodes(db, framework.id, ids); done += ids.length; progress("Đã xóa " + done + "/" + plan.total + " nút…"); }
          await CW.deleteFramework(db, framework.id);   // the framework goes LAST: a failure before this leaves a smaller draft, never orphan nodes
          await audit("curriculum.framework.deleteDraft", framework.id, { name: framework.name, nodeCount: plan.total });
          return succeed("Đã xóa bản nháp.", null);
        } catch (error) {
          if (error instanceof FlowAbort && error.kind === "tooLarge") { show(modal$("#orgFwErr"), X.MESSAGES.tooLarge); return; }
          await onFailure(error, { frameworkId: framework.id, expectStatus: "draft" });
          const line = modal$("#orgFwErr");
          if (started && line && !line.classList.contains("hidden")) line.textContent += " " + X.MESSAGES.deletePartial;
        } finally { if (document.contains(ok) && label) ok.textContent = label; }
      });
    }

`;
export const SECTION_VIEW_EDITS_S5 = [
  [V_DESTR_NEW, V_DESTR_OLD],
  [V_CONTROLS_NEW, V_CONTROLS_OLD],
  [V_RENAME_BTN_NEW, V_RENAME_BTN_OLD],
  [V_ARCHIVE_BTN_NEW, V_ARCHIVE_BTN_OLD],
  [V_SIG_NEW, V_SIG_OLD],
  [V_ROWCALL_NEW, V_ROWCALL_OLD],
  [V_PAINT_NEW, V_PAINT_OLD],
  [V_ROWACTION_NEW, V_ROWACTION_OLD],
  [V_FLOWS_BLOCK + V_FLOWS_ANCHOR, V_FLOWS_ANCHOR]
];
export const reverseS5SectionViewEdits = (src) => transform(src, SECTION_VIEW_EDITS_S5, "P3-S5 section view", "reverse");
export const applyS5SectionViewEdits = (src) => transform(src, SECTION_VIEW_EDITS_S5, "P3-S5 section view", "forward");

// ---------------------------------------------------------------- index.html: clone tools wiring + cache tokens (model / section view changed after the S4 candidate)
const I_MODEL_OLD = `import * as CURRICULUM_MODEL from "./curriculum-model.mjs?v=20261007-p3s4";`;
const I_MODEL_NEW = `import * as CURRICULUM_MODEL from "./curriculum-model.mjs?v=20261007-p3s5";`;
const I_VIEW_OLD = `import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from "./curriculum-admin-view.mjs?v=20261007-p3s4";`;
const I_VIEW_NEW = `import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from "./curriculum-admin-view.mjs?v=20261007-p3s5";
import { createCloneDeleteHelpers, createCurriculumCloneWriter } from "./curriculum-clone-delete.mjs?v=20261007-p3s5";`;
const I_DEP_OLD = `      writer:createCurriculumWriter({collection,doc,setDoc,updateDoc})
    }),
    // P3-S4: the MÔN -> BÀI node editor`;
const I_DEP_NEW = `      writer:createCurriculumWriter({collection,doc,setDoc,updateDoc}),
      // P3-S5: NHÂN BẢN (clone, same organization) and XÓA BẢN NHÁP (never-activated draft only); without cloneTools neither control exists.
      cloneTools:{ helpers:createCloneDeleteHelpers({model:CURRICULUM_MODEL}), writer:createCurriculumCloneWriter({collection,doc,setDoc,writeBatch,deleteDoc}) }
    }),
    // P3-S4: the MÔN -> BÀI node editor`;
export const INDEX_EDITS_S5 = [[I_MODEL_NEW, I_MODEL_OLD], [I_VIEW_NEW, I_VIEW_OLD], [I_DEP_NEW, I_DEP_OLD]];
export const INDEX_ADDED_S5 = { I_VIEW_NEW, I_DEP_NEW };
export const reverseS5IndexEdits = (src) => transform(src, INDEX_EDITS_S5, "P3-S5 index.html", "reverse");
export const applyS5IndexEdits = (src) => transform(src, INDEX_EDITS_S5, "P3-S5 index.html", "forward");
