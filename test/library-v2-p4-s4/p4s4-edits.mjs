// P4-S4 edits to files that EARLIER slices pinned (index.html, curriculum-admin-view.mjs): the exact edits plus reversals that restore the previously verified bytes (P4-S3 closure state, commit
// 6a05411), so every older byte-pin keeps its meaning and any OTHER change is still detected. GENERATED from git diff -U0 against 6a05411 (test/library-v2-p4-s4/source-guard.test.mjs pins these pairs
// and the resulting hashes). The reversal is IDEMPOTENT (a source that holds none of the edits is returned unchanged). Imports nothing.
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);
function transform(source, edits, label) {
  const present = edits.filter(([added]) => [false, true].some((crlf) => source.split(withNl(added, crlf)).length - 1 === 1)).length;
  if (present === 0) return source;
  if (present !== edits.length) throw new Error(label + ": only " + present + " of " + edits.length + " edits present");
  let result = source;
  for (const [added, original] of edits) {
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(added, crlf), b = withNl(original, crlf);
      if (result.split(a).length - 1 === 1) { result = result.replace(a, () => b); done = true; break; }
    }
    if (!done) throw new Error(label + " edit not present exactly once (reverse): " + added.slice(0, 70));
  }
  return result;
}
export const INDEX_EDITS_P4S4 = [
 [
  "  getCountFromServer, collectionGroup, runTransaction, connectFirestoreEmulator, getDocFromServer, getDocsFromServer\n",
  "  getCountFromServer, collectionGroup, runTransaction, connectFirestoreEmulator\n"
 ],
 [
  "import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from \"./curriculum-admin-view.mjs?v=20261009-p4s4\";\n",
  "import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from \"./curriculum-admin-view.mjs?v=20261008-p4s3\";\n"
 ],
 [
  "import { createImportCenter } from \"./import-center-view.mjs?v=20261009-p4s4\";\nimport { createImportStatusReader } from \"./import-batch-status.mjs?v=20261009-p4s4\";\n",
  "import { createImportCenter } from \"./import-center-view.mjs?v=20261008-p4s3\";\n"
 ],
 [
  "// P4-S4: one import per organization across browser tabs (Web Locks). Resolves to a release function, or null while another tab of this browser holds the lock.\nfunction acquireImportLock(organizationId){\n  if(!navigator.locks||!navigator.locks.request) return Promise.resolve(()=>{});\n  return new Promise((resolve)=>{ navigator.locks.request(\"hcma2-import-\"+organizationId,{ifAvailable:true},(lock)=>{ if(!lock){ resolve(null); return undefined; } return new Promise((release)=>{ resolve(()=>release()); }); }).catch(()=>resolve(()=>{})); });\n}\n",
  ""
 ],
 [
  "      cloneTools:{ helpers:createCloneDeleteHelpers({model:CURRICULUM_MODEL}), writer:createCurriculumCloneWriter({collection,doc,setDoc,writeBatch,deleteDoc}) },\n      // P4-S4: imported frameworks whose batch is committing / partial are marked (Đang nhập dữ liệu / Nhập chưa hoàn tất) and their actions disabled (read-only lookup, two equality queries)\n      importStatus:createImportStatusReader({collection,query,where,limit,getDocs})\n",
  "      cloneTools:{ helpers:createCloneDeleteHelpers({model:CURRICULUM_MODEL}), writer:createCurriculumCloneWriter({collection,doc,setDoc,writeBatch,deleteDoc}) }\n"
 ],
 [
  "    // P4-S3/S4: NHẬP TỪ EXCEL (Template Center + Import Center). P4-S4: commitTools lets it execute the import (batch -> framework -> node chunks -> full read-back -> completed), recover and roll back;\n    // every read of the controller goes to the SERVER (getDocFromServer / getDocsFromServer). The source file is never uploaded.\n",
  "    // P4-S3: NHẬP TỪ EXCEL (Template Center + Import Center preview). Read-only for curriculum data: it creates no import batch, framework or node documents and uploads nothing.\n"
 ],
 [
  "      loadEngine:()=>import(\"./import-center-engine.mjs?v=20261009-p4s4\"),\n      downloadFile:downloadImportFile,\n      commitTools:{ firestore:{collection,doc,getDocFromServer,getDocsFromServer,query,where,limit,orderBy,startAfter,documentId,writeBatch,setDoc,updateDoc,deleteDoc,serverTimestamp}, acquireLock:acquireImportLock }\n",
  "      loadEngine:()=>import(\"./import-center-engine.mjs?v=20261008-p4s3\"),\n      downloadFile:downloadImportFile\n"
 ]
];
export const SECTION_VIEW_EDITS_P4S4 = [
 [
  "  function renderRowHtml({ framework, organization, controls, esc, fmtDate, flash, importState = null, describeImport = null }) {\n    // P4-S4: an imported framework whose paired batch is committing / partial is frozen by the Rules: marked, explained, every action disabled\n    const frozen = importState && typeof describeImport === \"function\" ? describeImport(importState) : null;\n    const view = frozen ? { badge: \"badge-yellow\", icon: frozen.icon, label: frozen.label } : frameworkStatusView(framework.status);\n",
  "  function renderRowHtml({ framework, organization, controls, esc, fmtDate, flash }) {\n    const view = frameworkStatusView(framework.status);\n"
 ],
 [
  "    const shownButtons = frozen ? buttons.split(\"<button \").join(\"<button disabled aria-disabled=\\\"true\\\" title=\\\"\" + attr(esc, frozen.title) + \"\\\" \") : buttons;\n    const frozenNote = frozen ? `<div class=\"hint mt-8\" data-fw-import-note=\"${attr(esc, importState)}\">${esc(frozen.note)}</div>` : \"\";\n",
  ""
 ],
 [
  "        <div style=\"min-width:0;flex:1 1 240px\"><div style=\"font-weight:650;overflow-wrap:anywhere\">${name}</div><div class=\"small mut mt-8\">${created}${activated}${clone}</div>${frozenNote}</div>\n        <div class=\"flex gap-8\" style=\"flex-wrap:wrap;align-items:center\"><span class=\"badge ${view.badge}\" data-fw-badge=\"1\"><span aria-hidden=\"true\">${view.icon}</span> ${esc(view.label)}</span>${shownButtons}</div>\n",
  "        <div style=\"min-width:0;flex:1 1 240px\"><div style=\"font-weight:650;overflow-wrap:anywhere\">${name}</div><div class=\"small mut mt-8\">${created}${activated}${clone}</div></div>\n        <div class=\"flex gap-8\" style=\"flex-wrap:wrap;align-items:center\"><span class=\"badge ${view.badge}\" data-fw-badge=\"1\"><span aria-hidden=\"true\">${view.icon}</span> ${esc(view.label)}</span>${buttons}</div>\n"
 ],
 [
  "  function renderSectionHtml({ phase, organization, items = [], truncated = false, errorMessage = \"\", canOpen = false, lifecycleTools = false, canImport = false, esc, fmtDate, flashId = null, importStates = null, describeImport = null }) {\n",
  "  function renderSectionHtml({ phase, organization, items = [], truncated = false, errorMessage = \"\", canOpen = false, lifecycleTools = false, canImport = false, esc, fmtDate, flashId = null }) {\n"
 ],
 [
  "        <ul style=\"list-style:none;padding:0;margin:0\">${group.items.map((framework) => renderRowHtml({ framework, organization, controls: controlsFor(framework, organization, { canOpen, lifecycleTools }), esc, fmtDate, flash: framework.id === flashId, importState: importStates ? importStates.get(framework.id) || null : null, describeImport })).join(\"\")}</ul>`).join(\"\");\n",
  "        <ul style=\"list-style:none;padding:0;margin:0\">${group.items.map((framework) => renderRowHtml({ framework, organization, controls: controlsFor(framework, organization, { canOpen, lifecycleTools }), esc, fmtDate, flash: framework.id === flashId })).join(\"\")}</ul>`).join(\"\");\n"
 ],
 [
  "  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, model, queries, organizationQueries, contract, writer, onOpenFramework, cloneTools, importStatus } = deps;\n",
  "  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, model, queries, organizationQueries, contract, writer, onOpenFramework, cloneTools } = deps;\n"
 ],
 [
  "    let org = organization, items = [], truncated = false, generation = 0, busy = false, flashId = null, trigger = null, importStates = null;\n",
  "    let org = organization, items = [], truncated = false, generation = 0, busy = false, flashId = null, trigger = null;\n"
 ],
 [
  "      host.innerHTML = H.renderSectionHtml({ phase, organization: org, items, truncated, canOpen, lifecycleTools: !!cloneTools, canImport: !!openImport, esc, fmtDate, flashId, importStates, describeImport: importStatus ? importStatus.describe : null, ...extra });\n",
  "      host.innerHTML = H.renderSectionHtml({ phase, organization: org, items, truncated, canOpen, lifecycleTools: !!cloneTools, canImport: !!openImport, esc, fmtDate, flashId, ...extra });\n"
 ],
 [
  "        importStates = null;\n        if (importStatus) { try { importStates = await importStatus.incompleteOf(db, org.id); } catch { importStates = null; } if (mine !== generation) return; }   // P4-S4: incomplete imports are marked and frozen; a failed lookup only means no marking (the Rules still refuse the writes)\n",
  ""
 ],
 [
  "      if (importStates && importStates.has(framework.id)) return;                       // P4-S4: frozen by the import-freeze Rules (the buttons are disabled; this is defense in depth)\n",
  ""
 ]
];
export const reverseP4S4IndexEdits = (src) => transform(src, INDEX_EDITS_P4S4, "P4-S4 index.html");
export const reverseP4S4SectionViewEdits = (src) => transform(src, SECTION_VIEW_EDITS_P4S4, "P4-S4 curriculum-admin-view");
