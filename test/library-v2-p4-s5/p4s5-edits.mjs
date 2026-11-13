import { reverseMiniGameIndexEdits } from "../minigame-r1/minigame-edits.mjs";
// P4-S5-B edits to index.html (the only earlier-pinned file this slice edits): the exact edits plus a reversal that restores the P4-S4 state (commit c6c66ed, the production web release) so every older
// byte-pin keeps its meaning and any OTHER change is still detected. p4s4-edits.mjs applies this reversal FIRST (S5 -> S4 -> S3 ...). The reversal is IDEMPOTENT (a source holding none of the edits is returned
// unchanged). Imports nothing. test/library-v2-p4-s5/source-guard.test.mjs pins these pairs and the resulting hashes.
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
export const INDEX_EDITS_P4S5 = [
  ['import { createImportCenter } from "./import-center-view.mjs?v=20261014-p5b";', 'import { createImportCenter } from "./import-center-view.mjs?v=20261009-p4s4";'],
  ['loadEngine:()=>import("./import-center-engine.mjs?v=20261014-p5b"),', 'loadEngine:()=>import("./import-center-engine.mjs?v=20261009-p4s4"),'],
  ['acquireLock:acquireImportLock },\n      auditTools:{ firestore:{doc,setDoc,getDocFromServer,serverTimestamp}, actor:()=>({uid:STATE.user?.uid||null,email:STATE.profile?.email||STATE.user?.email||"",name:STATE.profile?.displayName||"",role:STATE.profile?.role||""}) }', 'acquireLock:acquireImportLock }']
];
// MINI GAME TAB R1: its own index.html reversal is applied FIRST (Mini Game -> P4-S5 -> P4-S4 ...).
export const reverseP4S5IndexEdits = (src) => transform(reverseMiniGameIndexEdits(src), INDEX_EDITS_P4S5, "P4-S5-B index.html");
