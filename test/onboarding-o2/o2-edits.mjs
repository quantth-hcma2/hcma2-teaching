// Shared by the O2 and the older S3/S4 source guards: the exact O2 additions to index.html and a reversal that restores the released baseline.
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
// The O2 delta of index.html versus the released baseline (P2-S4 `768ae05`, index.html SHA eb043d94...). Reversing the edits must restore it.
export const IMPORT_ADDED = `import { createActiveOrganizationLookup, createTeacherEnrollmentFlow } from "./teacher-organization-enrollment.mjs?v=20261005-o2";`;
const PICKER_LINE = `const ORGANIZATION_TEACHER_PICKER=createActiveTeacherPickerQuery({collection,query,where,orderBy,limit,startAfter,getDocs});`;
const MEMBERSHIP_IMPORT = `import { createOrganizationMembershipSection, createMembershipWriter, createActiveTeacherPickerQuery } from "./organization-membership-view.mjs?v=20261004-p2s4";`;
export const BLOCK_ADDED = `
// Onboarding O2: optional Organization-membership step AFTER a successful teacher approval. Separate from the approval write; never throws.
const ORGANIZATION_ACTIVE_LOOKUP=createActiveOrganizationLookup({collection,query,where,limit,getDocs});
let __organizationEnrollmentFlow=null;
function organizationEnrollmentAfterApproval(uid){
  try{
    if(!__organizationEnrollmentFlow) __organizationEnrollmentFlow=createTeacherEnrollmentFlow({
      db, getActorUid:()=>STATE.user.uid, isPlatformAdmin:()=>STATE.profile?.role==="admin",
      esc, toast, mapError, openModal, closeModal, logAudit,
      readUser:async(database,userId)=>{const snap=await getDoc(doc(database,"users",userId));return snap.exists()?{id:snap.id,...snap.data()}:null;},
      orgLookup:ORGANIZATION_ACTIVE_LOOKUP, queries:ORGANIZATION_QUERIES, contract:ORGANIZATION_CONTRACT,
      writer:createMembershipWriter({collection,doc,writeBatch,updateDoc})
    });
    __organizationEnrollmentFlow.offerAfterApproval(uid).catch(()=>{});
  }catch(e){ console.warn("organization enrollment",e); }
}`;
export const APPROVE_V1 = `async function approveTeacher(uid, cb){
  try{
    await updateDoc(doc(db,"users",uid), { status:"active", approvedAt: serverTimestamp(), approvedBy: STATE.user.uid, updatedAt: serverTimestamp() });
    toast("Đã duyệt tài khoản giảng viên.","ok");
    cb && cb();
  }catch(e){ toast(mapError(e),"err"); }
}`;
export const APPROVE_O2 = `async function approveTeacher(uid, cb){
  let approved = false;
  try{
    await updateDoc(doc(db,"users",uid), { status:"active", approvedAt: serverTimestamp(), approvedBy: STATE.user.uid, updatedAt: serverTimestamp() });
    approved = true;
    toast("Đã duyệt tài khoản giảng viên.","ok");
    cb && cb();
  }catch(e){ toast(mapError(e),"err"); }
  if(approved) organizationEnrollmentAfterApproval(uid);
}`;
export const EDITS = [[IMPORT_ADDED, ""], [PICKER_LINE + BLOCK_ADDED, PICKER_LINE], [APPROVE_O2, APPROVE_V1]];
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);


// Returns the index.html text with the three O2 edits reversed (the released P2-S4 baseline); throws if any edit is not present exactly once.
export function reverseO2Edits(source) {
  let restored = source, removed = false;
  for (const crlf of [false, true]) { const a = withNl(NL + IMPORT_ADDED, crlf); if (restored.split(a).length - 1 === 1) { restored = restored.replace(a, () => ""); removed = true; break; } }
  if (!removed) throw new Error("O2 import line not present exactly once");
  for (const [added, original] of EDITS.slice(1)) {
    let done = false;
    for (const crlf of [false, true]) { const a = withNl(added, crlf), o = withNl(original, crlf); if (restored.split(a).length - 1 === 1) { restored = restored.replace(a, () => o); done = true; break; } }
    if (!done) throw new Error("O2 edit not present exactly once: " + added.slice(0, 50));
  }
  return restored;
}
