import { reverseSsoIndexEdits } from "../minigame-sso-r1/sso-edits.mjs";
// MINI GAME TAB R1 edits to index.html: the exact five additive edits plus a reversal that restores the production web release
// ce89869 bytes, so every older byte-pin keeps its meaning and any OTHER change is still detected. The P4-S5 reversal
// (test/library-v2-p4-s5/p4s5-edits.mjs) applies THIS reversal FIRST (Mini Game -> P4-S5 -> P4-S4 ...). Both directions are
// IDEMPOTENT (a source holding none / all of the edits is returned unchanged). Imports nothing.
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
export const withNl = (s, crlf) => (crlf ? s.split(NL).join(CRLF) : s);
const count = (s, part) => s.split(part).length - 1;
function transform(source, edits, label, forward) {
  const present = edits.filter(([added]) => [false, true].some((crlf) => count(source, withNl(added, crlf)) === 1)).length;
  if (forward ? present === edits.length : present === 0) return source;
  if (present !== (forward ? 0 : edits.length)) throw new Error(label + ": only " + present + " of " + edits.length + " edits present");
  let result = source;
  for (const [added, original] of edits) {
    const [from, to] = forward ? [original, added] : [added, original];
    let done = false;
    for (const crlf of [false, true]) {
      const a = withNl(from, crlf);
      if (count(result, a) !== 1) continue;
      // The production file mixes CRLF and LF lines: inserted lines take the line ending found right after the anchor.
      const at = result.indexOf(a) + a.length;
      const eolCrlf = from.includes(NL) ? crlf : result.slice(at, at + 2) === CRLF;
      result = result.replace(a, () => withNl(to, eolCrlf));
      done = true;
      break;
    }
    if (!done) throw new Error(label + " anchor not present exactly once: " + from.slice(0, 70));
  }
  return result;
}
const LIB_IMPORT = 'import { libraryLocationForTarget, resolveLibraryLocation, renderLibraryHubHtml, renderLibraryChildHtml } from "./library-hub-registry.mjs?v=20261002-library-p1";';
export const MINIGAME_IMPORT = 'import { mountMiniGameHub } from "./mini-game-registry.mjs?v=20261113-minigame-r1";';
export const MINIGAME_MENU_ENTRY = '{key:"minigames", label:"Mini Game", icon:"🎮"},';
export const INDEX_EDITS_MINIGAME = [
  [LIB_IMPORT + "\n" + MINIGAME_IMPORT, LIB_IMPORT],
  ['  {key:"qrlinks", label:"QR vĩnh viễn", icon:"🔗"},\n  {key:"groups", label:"Thảo luận nhóm", icon:"👥"},\n  ' + MINIGAME_MENU_ENTRY, '  {key:"qrlinks", label:"QR vĩnh viễn", icon:"🔗"},\n  {key:"groups", label:"Thảo luận nhóm", icon:"👥"},'],
  ['  {key:"create", label:"Tạo tương tác", icon:"➕"},\n  {key:"groups", label:"Thảo luận nhóm", icon:"👥"},\n  ' + MINIGAME_MENU_ENTRY, '  {key:"create", label:"Tạo tương tác", icon:"➕"},\n  {key:"groups", label:"Thảo luận nhóm", icon:"👥"},'],
  ['  if(key==="groups") return groupModule(c, true);\n  if(key==="minigames") return mountMiniGameHub(c, esc);', '  if(key==="groups") return groupModule(c, true);'],
  ['  if(key==="groups") return groupModule(c, false);\n  if(key==="minigames") return mountMiniGameHub(c, esc);', '  if(key==="groups") return groupModule(c, false);']
];
// MINI GAME SSO R1: its own index.html reversal is applied FIRST (SSO -> Mini Game R1 -> P4-S5 ...).
export const reverseMiniGameIndexEdits = (src) => transform(reverseSsoIndexEdits(src), INDEX_EDITS_MINIGAME, "MINIGAME-R1 index.html", false);
export const applyMiniGameIndexEdits = (src) => transform(src, INDEX_EDITS_MINIGAME, "MINIGAME-R1 index.html", true);
