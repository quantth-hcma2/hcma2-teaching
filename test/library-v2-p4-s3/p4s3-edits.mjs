// P4-S3 edits to files that EARLIER slices pinned (index.html, curriculum-admin-view.mjs, organization-admin-view.mjs): the exact edits plus reversals that restore the previously
// verified bytes (P3-S5 closure state, commit 61ce306 = P4-S2 closure), so every older byte-pin keeps its meaning and any OTHER change is still detected.
// GENERATED from git diff -U0 against 61ce306 (see test/library-v2-p4-s3/source-guard.test.mjs, which pins these pairs and the resulting hashes). Imports only the P4-S4 reversal (newest edits first).
import { reverseP4S4IndexEdits, reverseP4S4SectionViewEdits } from "../library-v2-p4-s4/p4s4-edits.mjs";   // P4-S4 aligned
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);
function transform(source, edits, label, direction) {
  let result = source;
  for (const [added, original] of edits) {
    const from = direction === "reverse" ? added : original, to = direction === "reverse" ? original : added;
    if (direction === "forward" && from === "") throw new Error(label + ": forward insertion needs an anchor");
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(from, crlf), b = withNl(to, crlf);
      if (result.split(a).length - 1 === 1) { result = result.replace(a, () => b); done = true; break; }
    }
    if (!done) throw new Error(label + " edit not present exactly once (" + direction + "): " + from.slice(0, 70));
  }
  return result;
}
export const INDEX_EDITS_P4S3 = [
 [
  "import { createOrganizationAdminScreen, createOrganizationWriter } from \"./organization-admin-view.mjs?v=20261008-p4s3\";\n",
  "import { createOrganizationAdminScreen, createOrganizationWriter } from \"./organization-admin-view.mjs?v=20261004-p2s4\";\n"
 ],
 [
  "import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from \"./curriculum-admin-view.mjs?v=20261008-p4s3\";\n",
  "import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from \"./curriculum-admin-view.mjs?v=20261007-p3s5\";\n"
 ],
 [
  "// Library V2 P4-S3: Template Center + Import Center (UI / PREVIEW ONLY, Platform Admin). The view is small and imported here; the engine (P4-S2 reader host, validator, plan,\n// template writer) is loaded LAZILY (a dynamic import) when the Import Center screen opens, and SheetJS 0.20.3 only inside the parsing Worker / on the first template download.\n// The V1 roster-export library (vendor/xlsx.full.min.js 0.18.5) is untouched. No Firestore import write exists in this release.\nimport { createImportCenter } from \"./import-center-view.mjs?v=20261008-p4s3\";\n",
  ""
 ],
 [
  "// P4-S3: saves a generated .xlsx (Template Center) on the user's machine. Local only; separate from the V1 downloadBlob/export helpers.\nfunction downloadImportFile(bytes,fileName,mime){\n  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));\n  const a=document.createElement(\"a\"); a.href=url; a.download=fileName; a.style.display=\"none\"; document.body.appendChild(a); a.click(); a.remove();\n  setTimeout(()=>URL.revokeObjectURL(url),4000);\n}\n",
  ""
 ],
 [
  "    // P4-S3: NHẬP TỪ EXCEL (Template Center + Import Center preview). Read-only for curriculum data: it creates no import batch, framework or node documents and uploads nothing.\n    importCenter:createImportCenter({\n      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role===\"admin\",\n      esc, toast, mapError, organizationQueries:ORGANIZATION_QUERIES,\n      loadEngine:()=>import(\"./import-center-engine.mjs?v=20261008-p4s3\"),\n      downloadFile:downloadImportFile\n    }),\n",
  ""
 ]
];
export const SECTION_VIEW_EDITS_P4S3 = [
 [
  "  function renderSectionHtml({ phase, organization, items = [], truncated = false, errorMessage = \"\", canOpen = false, lifecycleTools = false, canImport = false, esc, fmtDate, flashId = null }) {\n",
  "  function renderSectionHtml({ phase, organization, items = [], truncated = false, errorMessage = \"\", canOpen = false, lifecycleTools = false, esc, fmtDate, flashId = null }) {\n"
 ],
 [
  "    // P4-S3: NHẬP TỪ EXCEL opens the Import Center (preview only). Absent unless the screen supplies the hook; disabled with a reason in an archived organization.\n    const importReason = \"Đơn vị đã lưu trữ: không thể nhập tệp mới. Hãy khôi phục đơn vị trước.\";\n    const importButton = canImport ? ` <button class=\"btn btn-outline\" type=\"button\" id=\"orgImportBtn\" style=\"margin-left:8px\"${archived ? ` disabled aria-describedby=\"orgImportHint\" title=\"${attr(esc, importReason)}\"` : \"\"}>⬆ NHẬP TỪ EXCEL</button>${archived ? `<div class=\"hint\" id=\"orgImportHint\">${esc(importReason)}</div>` : \"\"}` : \"\";\n",
  ""
 ],
 [
  "      <div class=\"flex-between\" style=\"flex-wrap:wrap;gap:10px;align-items:flex-start\"><div><h3 id=\"orgCurriculumTitle\" tabindex=\"-1\" style=\"margin:0;outline:none\">📚 Chương trình</h3><div class=\"small mut\">Các khung chương trình (Môn → Bài) của đơn vị này.</div>${summary}</div><div>${createButton}${importButton}</div></div>\n",
  "      <div class=\"flex-between\" style=\"flex-wrap:wrap;gap:10px;align-items:flex-start\"><div><h3 id=\"orgCurriculumTitle\" tabindex=\"-1\" style=\"margin:0;outline:none\">📚 Chương trình</h3><div class=\"small mut\">Các khung chương trình (Môn → Bài) của đơn vị này.</div>${summary}</div><div>${createButton}</div></div>\n"
 ],
 [
  "    const openImport = typeof options.onOpenImport === \"function\" ? options.onOpenImport : null;   // P4-S3: Import Center entry (supplied by the Organization screen)\n    let pendingFocusImport = !!options.focusImport;\n",
  ""
 ],
 [
  "      host.innerHTML = H.renderSectionHtml({ phase, organization: org, items, truncated, canOpen, lifecycleTools: !!cloneTools, canImport: !!openImport, esc, fmtDate, flashId, ...extra });\n      const importBtn = host.querySelector(\"#orgImportBtn\");\n      if (importBtn && !importBtn.disabled) importBtn.onclick = () => { if (!busy) openImport(org); };\n",
  "      host.innerHTML = H.renderSectionHtml({ phase, organization: org, items, truncated, canOpen, lifecycleTools: !!cloneTools, esc, fmtDate, flashId, ...extra });\n"
 ],
 [
  "        if (pendingFocusImport) { pendingFocusImport = false; const importBtn = host.querySelector(\"#orgImportBtn\"); if (importBtn && !importBtn.disabled) { importBtn.focus(); pendingFocusId = null; } }\n",
  ""
 ]
];
export const ORG_VIEW_EDITS_P4S3 = [
 [
  "//         importCenter?: { mount(container, { organization, onBack }) } (P4-S3: Template Center + Import Center preview, opened from the curriculum section through onOpenImport; replaces the detail like the editor)\n",
  ""
 ],
 [
  "  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, queries, platformQueries, contract, writer, membershipSection, curriculumSection, frameworkEditor, importCenter } = deps;\n",
  "  const { db, actorUid, isPlatformAdmin, esc, fmtDate, toast, mapError, openModal, closeModal, logAudit, queries, platformQueries, contract, writer, membershipSection, curriculumSection, frameworkEditor } = deps;\n"
 ],
 [
  "    async function showDetail(id, { focusFrameworkId, focusImport } = {}) {\n",
  "    async function showDetail(id, { focusFrameworkId } = {}) {\n"
 ],
 [
  "      if (curriculumSection) mounts.push(curriculumSection.mount(container.querySelector(\"#orgCurriculumSection\"), organization, { focusFrameworkId, focusImport, ...(frameworkEditor ? { onOpenFramework: (framework, org) => showFrameworkEditor(framework, org || organization) } : {}), ...(importCenter ? { onOpenImport: (org) => showImportCenter(org || organization) } : {}) }));\n",
  "      if (curriculumSection) mounts.push(curriculumSection.mount(container.querySelector(\"#orgCurriculumSection\"), organization, { focusFrameworkId, ...(frameworkEditor ? { onOpenFramework: (framework, org) => showFrameworkEditor(framework, org || organization) } : {}) }));\n"
 ],
 [
  "    // P4-S3: the Import Center (preview only) replaces the Organization Detail in the same slot; the organization is fixed for the whole flow.\n    function showImportCenter(organization) {\n      container.innerHTML = \"\";\n      importCenter.mount(container, { organization, onBack: () => showDetail(organization.id, { focusImport: true }) });\n    }\n\n",
  ""
 ]
];
export const reverseP4S3IndexEdits = (src) => transform(reverseP4S4IndexEdits(src), INDEX_EDITS_P4S3, "P4-S3 index.html", "reverse");   // P4-S4 aligned: the chain starts with the (newer) P4-S4 edits
export const reverseP4S3SectionViewEdits = (src) => transform(reverseP4S4SectionViewEdits(src), SECTION_VIEW_EDITS_P4S3, "P4-S3 curriculum-admin-view", "reverse");   // P4-S4 aligned: newest edits first
export const reverseP4S3OrgViewEdits = (src) => transform(src, ORG_VIEW_EDITS_P4S3, "P4-S3 organization-admin-view", "reverse");
