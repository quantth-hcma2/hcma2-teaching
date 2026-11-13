// MINI GAME SSO R1 edits to index.html: three pinned edits (registry cache token + SSO module import, and one SSO hook after each
// shell's wireShellNav) plus a reversal that restores the Mini Game tab R1 release c2a978f bytes. The Mini Game R1 reversal
// (test/minigame-r1/minigame-edits.mjs) applies THIS reversal FIRST (SSO -> Mini Game R1 -> P4-S5 -> ...). Idempotent both ways. Imports nothing.
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
      // the production file mixes CRLF and LF lines: inserted lines take the line ending found right after the anchor
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
const R1_IMPORT = 'import { mountMiniGameHub } from "./mini-game-registry.mjs?v=20261113-minigame-r1";';
export const SSO_REGISTRY_IMPORT = 'import { mountMiniGameHub } from "./mini-game-registry.mjs?v=20261113-sso-r1";';
export const SSO_MODULE_IMPORT = 'import { startMiniGameSsoIfRequested } from "./mini-game-sso.mjs?v=20261113-sso-r1";';
export const SSO_HOOK = '  startMiniGameSsoIfRequested({ location:window.location, history:window.history, getIdToken:()=>auth.currentUser?auth.currentUser.getIdToken(true):Promise.reject(new Error("Chưa đăng nhập")), getCachedToken:(f)=>auth.currentUser?auth.currentUser.getIdToken(!!f):Promise.reject(new Error("Chưa đăng nhập")), profile:STATE.profile, esc });';
const ADMIN_NAV = '  wireShellNav(ADMIN_MENU, (key)=>{ STATE.adminNav = key; clearListeners(); adminRoute(key); });';
const TEACHER_NAV = '  wireShellNav(TEACHER_MENU, navigateTeacherTopLevel);';
export const INDEX_EDITS_SSO = [
  [SSO_REGISTRY_IMPORT + "\n" + SSO_MODULE_IMPORT, R1_IMPORT],
  [ADMIN_NAV + "\n" + SSO_HOOK, ADMIN_NAV],
  [TEACHER_NAV + "\n" + SSO_HOOK, TEACHER_NAV]
];
export const reverseSsoIndexEdits = (src) => transform(src, INDEX_EDITS_SSO, "MINIGAME-SSO-R1 index.html", false);
export const applySsoIndexEdits = (src) => transform(src, INDEX_EDITS_SSO, "MINIGAME-SSO-R1 index.html", true);
