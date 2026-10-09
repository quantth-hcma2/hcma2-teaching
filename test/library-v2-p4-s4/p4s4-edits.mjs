// P4-S4 edits to index.html (pinned by EARLIER slices): the exact edits plus a reversal that restores the previously verified bytes (P4-S3 closure state, commit 6a05411), so every older
// byte-pin keeps its meaning and any OTHER change is still detected. GENERATED from git diff -U0 against 6a05411 (test/library-v2-p4-s4/source-guard.test.mjs pins these pairs and the resulting
// hashes). Imports nothing.
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);
function transform(source, edits, label) {
  // idempotent: a source that holds NONE of the P4-S4 edits is already reversed (guards may read index.html through the reversal AND through an older reversal chain)
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
  "import { createImportCenter } from \"./import-center-view.mjs?v=20261009-p4s4\";\n",
  "import { createImportCenter } from \"./import-center-view.mjs?v=20261008-p4s3\";\n"
 ],
 [
  "// P4-S4: one import per organization across browser tabs (Web Locks). Resolves to a release function, or null while another tab of this browser holds the lock.\nfunction acquireImportLock(organizationId){\n  if(!navigator.locks||!navigator.locks.request) return Promise.resolve(()=>{});\n  return new Promise((resolve)=>{ navigator.locks.request(\"hcma2-import-\"+organizationId,{ifAvailable:true},(lock)=>{ if(!lock){ resolve(null); return undefined; } return new Promise((release)=>{ resolve(()=>release()); }); }).catch(()=>resolve(()=>{})); });\n}\n",
  ""
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
export const reverseP4S4IndexEdits = (src) => transform(src, INDEX_EDITS_P4S4, "P4-S4 index.html");
