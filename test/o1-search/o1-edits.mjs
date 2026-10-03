// Shared by the O1 and the older O2/S3 source guards: the exact O1 edits to index.html and a reversal that restores the released O2 baseline.
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);
export const IMPORT_NEW = `import { createOrganizationMembershipSection, createMembershipWriter, createTeacherEmailSearchQuery } from "./organization-membership-view.mjs?v=20261006-o1";`;
export const IMPORT_OLD = `import { createOrganizationMembershipSection, createMembershipWriter, createActiveTeacherPickerQuery } from "./organization-membership-view.mjs?v=20261004-p2s4";`;
export const CONST_NEW = `// O1: explicit bounded email-prefix search for the Add-Teacher exception dialog (replaces the old paged teacher picker).
const ORGANIZATION_TEACHER_SEARCH=createTeacherEmailSearchQuery({collection,query,where,orderBy,limit,getDocs});
const readUserForMembership=async(database,userId)=>{const snap=await getDoc(doc(database,"users",userId));return snap.exists()?{id:snap.id,...snap.data()}:null;};`;
export const CONST_OLD = `const ORGANIZATION_TEACHER_PICKER=createActiveTeacherPickerQuery({collection,query,where,orderBy,limit,startAfter,getDocs});`;
export const DEP_NEW = `queries:ORGANIZATION_QUERIES, teacherSearch:ORGANIZATION_TEACHER_SEARCH, readUser:readUserForMembership, contract:ORGANIZATION_CONTRACT,`;
export const DEP_OLD = `queries:ORGANIZATION_QUERIES, picker:ORGANIZATION_TEACHER_PICKER, contract:ORGANIZATION_CONTRACT,`;
export const EDITS = [[IMPORT_NEW, IMPORT_OLD], [CONST_NEW, CONST_OLD], [DEP_NEW, DEP_OLD]];

// Returns index.html with the three O1 edits reversed (the released O2 baseline); throws if any edit is not present exactly once.
export function reverseO1Edits(source) {
  let restored = source;
  for (const [added, original] of EDITS) {
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(added, crlf), o = withNl(original, crlf);
      if (restored.split(a).length - 1 === 1) { restored = restored.replace(a, () => o); done = true; break; }
    }
    if (!done) throw new Error("O1 edit not present exactly once: " + added.slice(0, 60));
  }
  return restored;
}
