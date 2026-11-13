// MINI GAME SAME-TAB R1: the registry lines (as they were at adcfe7f) that this slice replaces. Earlier slices' guards that diff
// mini-game-registry.mjs against their own base ignore exactly these lines (aligned guards). index.html is NOT changed by this slice.
export const SAMETAB_REGISTRY_REMOVED = Object.freeze([
  "// every game is an INDEPENDENT application opened in a NEW TAB through a plain link (never an iframe). Nothing about the",
  "// signed-in HCMA2 Teaching user (uid, email, token, role) is ever passed to a game.",
  "action: \"MỞ TRÒ CHƠI ↗\",",
  "\"Mở trong tab mới, là ứng dụng riêng của HCMA2 (không nằm trong trang này).\",",
  "return `<a class=\"library-hub-card\" style=\"text-decoration:none\" href=\"${esc(game.url)}\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\" data-minigame-open=\"${esc(game.id)}\" aria-label=\"${esc(game.title)} — mở trong tab mới\">",
  "return `<div class=\"section-title\"><div><h2>MINI GAME</h2><p class=\"mut\">Trò chơi tương tác dùng trong giờ học. Mỗi trò chơi mở trong tab mới.</p></div></div>"
]);
export const isSameTabRegistryLine = (diffLine) => SAMETAB_REGISTRY_REMOVED.includes(diffLine.replace(/^[-+]/, "").trim());
