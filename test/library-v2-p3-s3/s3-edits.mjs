// Shared by the P3-S3 guard and the OLDER source guards (P2-S3/S4, O1, O2, P3-S1, P3-S2): the exact P3-S3 edits to index.html and
// organization-admin-view.mjs and the reversals that restore the previously released baseline (ec67a9c), so every older byte-pin keeps its
// original meaning and any OTHER change to those two files is still detected.
import { reverseS4AdminViewEdits } from "../library-v2-p3-s4/s4-edits.mjs";
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);

// ---------------------------------------------------------------- index.html
const IMPORT_ANCHOR = `import { createOrganizationMembershipSection, createMembershipWriter, createTeacherEmailSearchQuery } from "./organization-membership-view.mjs?v=20261006-o1";`;
const IMPORT_BLOCK = `// Library V2 P3-S3: curriculum frameworks (Platform Admin). The model is imported WITHOUT a token on purpose: curriculum-queries/write-contract import it by bare URL,
// so this keeps ONE model instance per page; the view receives every P3-S2 module by injection.
import * as CURRICULUM_MODEL from "./curriculum-model.mjs";
import { createCurriculumQueries } from "./curriculum-queries.mjs?v=20261007-p3s2";
import { createCurriculumWriteContract } from "./curriculum-write-contract.mjs?v=20261007-p3s2";
import { createCurriculumSection, createCurriculumWriter } from "./curriculum-admin-view.mjs?v=20261007-p3s3";`;
const CONST_ANCHOR = `const ORGANIZATION_CONTRACT=createOrganizationWriteContract({serverTimestamp});`;
const CONST_BLOCK = `// P3-S3: curriculum read adapters (organizationId equality + limit only, no orderBy, no composite index) and write contract.
const CURRICULUM_QUERIES=createCurriculumQueries({collection,doc,query,where,limit,getDocs,getDoc});
const CURRICULUM_CONTRACT=createCurriculumWriteContract({serverTimestamp});`;
const DEP_ANCHOR = `    // P2-S4: ordinary membership management inside Organization Detail (Platform Admin only; no Organization Admin / capability work).`;
const DEP_BLOCK = `    // P3-S3: curriculum framework list + lifecycle above the members section (Platform Admin only). No onOpenFramework hook yet: the node editor is P3-S4.
    curriculumSection:createCurriculumSection({
      db, actorUid:STATE.user.uid, isPlatformAdmin:STATE.profile?.role==="admin",
      esc, fmtDate, toast, mapError, openModal, closeModal, logAudit,
      model:CURRICULUM_MODEL, queries:CURRICULUM_QUERIES, organizationQueries:ORGANIZATION_QUERIES, contract:CURRICULUM_CONTRACT,
      writer:createCurriculumWriter({collection,doc,setDoc,updateDoc})
    }),`;
export const INDEX_EDITS = [
  [IMPORT_ANCHOR + NL + IMPORT_BLOCK, IMPORT_ANCHOR],
  [CONST_ANCHOR + NL + CONST_BLOCK, CONST_ANCHOR],
  [DEP_BLOCK + NL + DEP_ANCHOR, DEP_ANCHOR]
];
export const INDEX_ADDED = { IMPORT_BLOCK, CONST_BLOCK, DEP_BLOCK };

// ---------------------------------------------------------------- organization-admin-view.mjs
const DOC_ANCHOR = `//         membershipSection?: { mount(host, organization) } (P2-S4) }`;
const DOC_LINE = `//         curriculumSection?: { mount(host, organization) } (P3-S3: curriculum frameworks, rendered above the members section)`;
const DESTR_OLD = `contract, writer, membershipSection } = deps;`;
const DESTR_NEW = `contract, writer, membershipSection, curriculumSection } = deps;`;
const HOST_ANCHOR = `    <div id="orgMembersSection" class="mt-14"></div>\`;`;
const HOST_LINE = `    <div id="orgCurriculumSection" class="mt-14"></div>`;
const MOUNT_OLD = `      // P2-S4: ordinary membership management is mounted below the lifecycle controls (optional dependency; absent = S3 behavior).
      if (membershipSection) await membershipSection.mount(container.querySelector("#orgMembersSection"), organization);`;
const MOUNT_NEW = `      // P2-S4 / P3-S3: the curriculum section (above) and the ordinary membership section are optional dependencies (absent = S3 behavior). They mount
      // independently and each paints its own loading/error state, so one section failing or being slow never blocks the other.
      const mounts = [];
      if (curriculumSection) mounts.push(curriculumSection.mount(container.querySelector("#orgCurriculumSection"), organization));
      if (membershipSection) mounts.push(membershipSection.mount(container.querySelector("#orgMembersSection"), organization));
      await Promise.allSettled(mounts);`;
export const ADMIN_VIEW_EDITS = [
  [DOC_ANCHOR + NL + DOC_LINE, DOC_ANCHOR],
  [DESTR_NEW, DESTR_OLD],
  [HOST_LINE + NL + HOST_ANCHOR, HOST_ANCHOR],
  [MOUNT_NEW, MOUNT_OLD]
];

function reverse(source, edits, label) {
  let restored = source;
  for (const [added, original] of edits) {
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(added, crlf), o = withNl(original, crlf);
      if (restored.split(a).length - 1 === 1) { restored = restored.replace(a, () => o); done = true; break; }
    }
    if (!done) throw new Error(label + " edit not present exactly once: " + added.slice(0, 60));
  }
  return restored;
}
function forward(source, edits, label) {
  let result = source;
  for (const [added, original] of edits) {
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(added, crlf), o = withNl(original, crlf);
      if (result.split(o).length - 1 === 1) { result = result.replace(o, () => a); done = true; break; }
    }
    if (!done) throw new Error(label + " anchor not present exactly once: " + original.slice(0, 60));
  }
  return result;
}
// index.html / organization-admin-view.mjs with the P3-S3 edits reversed (the ec67a9c baseline); each edit must be present exactly once.
// P3-S4 aligned: the reversal chain is S4 first, then S3 (every older byte-pin therefore still describes the ec67a9c bytes in the combined S3+S4 tree).
export const reverseS3AdminViewEdits = (source) => reverse(reverseS4AdminViewEdits(source), ADMIN_VIEW_EDITS, "P3-S3 organization-admin-view");
export const reverseS3IndexEdits = (html) => reverse(html, INDEX_EDITS, "P3-S3 index.html");
// Used once to author the candidate (and by tests of the edits themselves).
export const applyS3IndexEdits = (html) => forward(html, INDEX_EDITS, "P3-S3 index.html");
export const applyS3AdminViewEdits = (source) => forward(source, ADMIN_VIEW_EDITS, "P3-S3 organization-admin-view");
