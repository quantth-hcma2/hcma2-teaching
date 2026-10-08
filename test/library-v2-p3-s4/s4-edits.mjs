// P3-S4 edits to files that earlier slices pinned: the exact edits plus reversals that restore the previously verified (P3-S3 candidate c95595a / P3-S2) bytes, so every older
// byte-pin keeps its meaning and any OTHER change is still detected. Per-file helpers: model (additive codeConflictOf), the P3-S3 curriculum section view (seam options),
// organization-admin-view (editor host) and index.html (editor wiring + token bumps).
import { reverseP4S3OrgViewEdits } from "../library-v2-p4-s3/p4s3-edits.mjs";   // P4-S3 aligned: the organization-admin-view chain starts with the P4-S3 edits
import { reverseS5ModelEdits, reverseS5SectionViewEdits, reverseS5IndexEdits } from "../library-v2-p3-s5/s5-edits.mjs";   // P3-S5 aligned: the reversal chain is S5 first, then S4 (then S3)
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

// ---------------------------------------------------------------- curriculum-model.mjs: approved additive codeConflictOf (Owner decision D2)
const CODE_IN_USE_OLD = `// True when another node (not exceptId) already uses a code that is canonically equal to \`code\` (see canonicalizeNodeCode). Blank codes never conflict.
export function codeInUse(nodes, code, exceptId) {
  const key = typeof code === "string" ? canonicalizeNodeCode(code) : null;
  if (key === null) return false;
  return (nodes || []).some((node) => node.id !== exceptId && typeof node.code === "string" && canonicalizeNodeCode(node.code) === key);
}`;
const CODE_IN_USE_NEW = `// The FIRST node (array order, which is what validateTree reports as the original) other than exceptId whose code is canonically equal to \`code\` (see
// canonicalizeNodeCode), or null. Blank codes never conflict. Retired nodes count: their codes stay reserved until edited. P3-S4 uses it for an actionable duplicate-code
// message; P4 (imports) must reuse this same policy/API. codeInUse is the boolean form.
export function codeConflictOf(nodes, code, exceptId) {
  const key = typeof code === "string" ? canonicalizeNodeCode(code) : null;
  if (key === null) return null;
  for (const node of nodes || []) {
    if (!node || node.id === exceptId || typeof node.code !== "string") continue;
    if (canonicalizeNodeCode(node.code) === key) return node;
  }
  return null;
}
// True when another node (not exceptId) already uses a code that is canonically equal to \`code\`. Blank codes never conflict.
export function codeInUse(nodes, code, exceptId) {
  return codeConflictOf(nodes, code, exceptId) !== null;
}`;
export const MODEL_EDITS = [[CODE_IN_USE_NEW, CODE_IN_USE_OLD]];
export const reverseS4ModelEdits = (src) => transform(reverseS5ModelEdits(src), MODEL_EDITS, "P3-S4 model", "reverse");
export const applyS4ModelEdits = (src) => transform(src, MODEL_EDITS, "P3-S4 model", "forward");

// ---------------------------------------------------------------- curriculum-admin-view.mjs (P3-S3 section): mount options = the seam used by the editor
const S_CAN_OPEN_OLD = `  const canOpen = typeof onOpenFramework === "function";
  const modalRoot = () => document.getElementById("globalModal");`;
const S_CAN_OPEN_NEW = `  const modalRoot = () => document.getElementById("globalModal");`;
const S_MOUNT_OLD = `  async function mount(host, organization) {
    if (!host) return;
    if (!isPlatformAdmin) { host.innerHTML = ""; return; }
    let org = organization, items = [],`;
const S_MOUNT_NEW = `  // mount(host, organization, options?): options.onOpenFramework overrides the construction-time hook (P3-S4: the Organization screen supplies it); options.focusFrameworkId
  // focuses that row's MỞ button after the list loads (returning from the editor). Without options the approved P3-S3 behavior is unchanged.
  async function mount(host, organization, options = {}) {
    if (!host) return;
    if (!isPlatformAdmin) { host.innerHTML = ""; return; }
    const openHook = typeof options.onOpenFramework === "function" ? options.onOpenFramework : onOpenFramework;
    const canOpen = typeof openHook === "function";
    let pendingFocusId = options.focusFrameworkId || null;
    let org = organization, items = [],`;
const S_READY_OLD = `        items = page.items; truncated = !!page.truncated;
        paint("ready");`;
const S_READY_NEW = `        items = page.items; truncated = !!page.truncated;
        paint("ready");
        if (pendingFocusId) {
          const target = host.querySelector(\`[data-fw-id="\${pendingFocusId}"][data-fw-action="open"]\`) || host.querySelector("#orgCurriculumTitle");
          pendingFocusId = null; if (target) target.focus();
        }`;
const S_OPEN_OLD = `      if (action === "open") { if (canOpen) onOpenFramework(framework, org); return; }`;
const S_OPEN_NEW = `      if (action === "open") { if (canOpen) openHook(framework, org); return; }`;
export const SECTION_VIEW_EDITS = [
  [S_CAN_OPEN_NEW, S_CAN_OPEN_OLD],
  [S_MOUNT_NEW, S_MOUNT_OLD],
  [S_READY_NEW, S_READY_OLD],
  [S_OPEN_NEW, S_OPEN_OLD]
];
export const reverseS4SectionViewEdits = (src) => transform(reverseS5SectionViewEdits(src), SECTION_VIEW_EDITS, "P3-S4 section view", "reverse");
export const applyS4SectionViewEdits = (src) => transform(src, SECTION_VIEW_EDITS, "P3-S4 section view", "forward");

// ---------------------------------------------------------------- organization-admin-view.mjs: editor host (frameworkEditor dependency + showFrameworkEditor)
const A_DOC_OLD = `//         curriculumSection?: { mount(host, organization) } (P3-S3: curriculum frameworks, rendered above the members section)`;
const A_DOC_NEW = A_DOC_OLD + NL + `//         frameworkEditor?: { mount(container, { organization, framework, onBack }) } (P3-S4: the node editor, opened from the curriculum section through onOpenFramework)`;
const A_DESTR_OLD = `contract, writer, membershipSection, curriculumSection } = deps;`;
const A_DESTR_NEW = `contract, writer, membershipSection, curriculumSection, frameworkEditor } = deps;`;
const A_SHOW_OLD = `    async function showDetail(id) {`;
const A_SHOW_NEW = `    async function showDetail(id, { focusFrameworkId } = {}) {`;
const A_MOUNT_OLD = `      if (curriculumSection) mounts.push(curriculumSection.mount(container.querySelector("#orgCurriculumSection"), organization));`;
const A_MOUNT_NEW = `      if (curriculumSection) mounts.push(curriculumSection.mount(container.querySelector("#orgCurriculumSection"), organization, { focusFrameworkId, ...(frameworkEditor ? { onOpenFramework: (framework, org) => showFrameworkEditor(framework, org || organization) } : {}) }));`;
const A_FN_ANCHOR = `    function confirmLifecycle(kind, organization, actionErr) {`;
const A_FN_BLOCK = `    // P3-S4: the node editor replaces the Organization Detail in the same slot (like showList/showDetail); "Quay lại đơn vị" rebuilds the detail from fresh reads.
    function showFrameworkEditor(framework, organization) {
      container.innerHTML = "";
      frameworkEditor.mount(container, { organization, framework, onBack: () => showDetail(organization.id, { focusFrameworkId: framework.id }) });
    }

`;
export const ADMIN_VIEW_EDITS_S4 = [
  [A_DOC_NEW, A_DOC_OLD],
  [A_DESTR_NEW, A_DESTR_OLD],
  [A_SHOW_NEW, A_SHOW_OLD],
  [A_MOUNT_NEW, A_MOUNT_OLD],
  [A_FN_BLOCK + A_FN_ANCHOR, A_FN_ANCHOR]
];
export const reverseS4AdminViewEdits = (src) => transform(reverseP4S3OrgViewEdits(src), ADMIN_VIEW_EDITS_S4, "P3-S4 organization-admin-view", "reverse");
export const applyS4AdminViewEdits = (src) => transform(src, ADMIN_VIEW_EDITS_S4, "P3-S4 organization-admin-view", "forward");

// ---------------------------------------------------------------- index.html: editor wiring (+ cache tokens bumped for the files that changed after the S3 candidate)
const I_IMPORT_OLD = `// Library V2 P3-S3: curriculum frameworks (Platform Admin). The model is imported WITHOUT a token on purpose: curriculum-queries/write-contract import it by bare URL,
// so this keeps ONE model instance per page; the view receives every P3-S2 module by injection.
import * as CURRICULUM_MODEL from "./curriculum-model.mjs";
import { createCurriculumQueries } from "./curriculum-queries.mjs?v=20261007-p3s2";
import { createCurriculumWriteContract } from "./curriculum-write-contract.mjs?v=20261007-p3s2";
import { createCurriculumSection, createCurriculumWriter } from "./curriculum-admin-view.mjs?v=20261007-p3s3";`;
const I_IMPORT_NEW = `// Library V2 P3-S3/S4: curriculum frameworks and the node editor (Platform Admin). The model gained codeConflictOf in S4, so the page imports it WITH the S4 cache token
// (curriculum-queries/write-contract still import it by bare URL: pure functions, errors are matched by name + code, never instanceof); every P3-S2 module is injected into the views.
import * as CURRICULUM_MODEL from "./curriculum-model.mjs?v=20261007-p3s4";
import { createCurriculumQueries } from "./curriculum-queries.mjs?v=20261007-p3s2";
import { createCurriculumWriteContract } from "./curriculum-write-contract.mjs?v=20261007-p3s2";
import { createCurriculumSection, createCurriculumWriter, createCurriculumViewHelpers } from "./curriculum-admin-view.mjs?v=20261007-p3s4";
import { createCurriculumEditor, createCurriculumNodeWriter } from "./curriculum-editor-view.mjs?v=20261007-p3s4";`;
const I_DEP_OLD = `    // P3-S3: curriculum framework list + lifecycle above the members section (Platform Admin only). No onOpenFramework hook yet: the node editor is P3-S4.
    curriculumSection:createCurriculumSection({
      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
      model:CURRICULUM_MODEL, queries:CURRICULUM_QUERIES, organizationQueries:ORGANIZATION_QUERIES, contract:CURRICULUM_CONTRACT,
      writer:createCurriculumWriter({collection,doc,setDoc,updateDoc})
    }),`;
const I_DEP_NEW = `    // P3-S3: curriculum framework list + lifecycle above the members section (Platform Admin only). The screen hands the section its MỞ hook when frameworkEditor exists (P3-S4).
    curriculumSection:createCurriculumSection({
      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
      model:CURRICULUM_MODEL, queries:CURRICULUM_QUERIES, organizationQueries:ORGANIZATION_QUERIES, contract:CURRICULUM_CONTRACT,
      writer:createCurriculumWriter({collection,doc,setDoc,updateDoc})
    }),
    // P3-S4: the MÔN -> BÀI node editor (replaces Organization Detail; Platform Admin only). Activation stays in the S3 list.
    frameworkEditor:createCurriculumEditor({
      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
      model:CURRICULUM_MODEL, viewHelpers:createCurriculumViewHelpers({model:CURRICULUM_MODEL}), queries:CURRICULUM_QUERIES, organizationQueries:ORGANIZATION_QUERIES, contract:CURRICULUM_CONTRACT,
      writer:createCurriculumNodeWriter({collection,doc,setDoc,updateDoc,writeBatch})
    }),`;
export const INDEX_EDITS_S4 = [[I_IMPORT_NEW, I_IMPORT_OLD], [I_DEP_NEW, I_DEP_OLD]];
export const INDEX_ADDED_S4 = { I_IMPORT_NEW, I_DEP_NEW };
export const reverseS4IndexEdits = (src) => transform(reverseS5IndexEdits(src), INDEX_EDITS_S4, "P3-S4 index.html", "reverse");
export const applyS4IndexEdits = (src) => transform(src, INDEX_EDITS_S4, "P3-S4 index.html", "forward");
