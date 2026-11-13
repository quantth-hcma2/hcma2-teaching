// MINI GAME hub (Mini Game tab R1).
// Pure registry + rendering for the teacher/admin "MINI GAME" tab. No Firestore, no Auth, no network, no storage, no imports:
// every game is an INDEPENDENT application opened in a NEW TAB through a plain link (never an iframe). Nothing about the
// signed-in HCMA2 Teaching user (uid, email, token, role) is ever passed to a game.
// Adding a future game = adding ONE registry entry (status "active" with an https url on the allow-list, or "upcoming").
// Games that are not registered are never rendered, so the hub never shows speculative cards.

const freeze = Object.freeze;

export const MINI_GAME_ROUTE_KEY = "minigames";

// Exact origins a Mini Game card may open. A game url must be https, on one of these origins, without credentials.
export const MINI_GAME_ALLOWED_ORIGINS = freeze(["https://hcma2-interactive.hcma2-interactive-v1.workers.dev"]);

export const MINI_GAMES = freeze([
  freeze({
    id: "quiz",
    status: "active",
    icon: "🎯",
    title: "TRẮC NGHIỆM TƯƠNG TÁC",
    description: "Trò chơi trắc nghiệm theo thời gian thực: trình chiếu câu hỏi, học viên trả lời trên điện thoại, chấm điểm tự động, bảng xếp hạng và báo cáo.",
    action: "MỞ TRÒ CHƠI ↗",
    // SSO R1: mo qua /sso/begin -> Mini Game xin xac nhan tai Teaching (mini-game-sso.mjs), khong can nhap mat khau lan hai
    url: "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/sso/begin",
    notes: freeze([
      "Mở trong tab mới, là ứng dụng riêng của HCMA2 (không nằm trong trang này).",
      "Đăng nhập bằng chính tài khoản HCMA2 Teaching (xác nhận một lần, không nhập lại mật khẩu).",
      "Học viên không cần tài khoản: tham gia bằng mã PIN hoặc quét mã QR trên màn chiếu."
    ])
  })
]);

export function isAllowedMiniGameUrl(url, origins = MINI_GAME_ALLOWED_ORIGINS) {
  if (typeof url !== "string" || !url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && origins.includes(u.origin);
}

export function activeMiniGames(games = MINI_GAMES) {
  return games.filter((g) => g.status === "active" && isAllowedMiniGameUrl(g.url));
}

function renderActiveCard(game, esc) {
  const notes = (game.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  return `<a class="library-hub-card" style="text-decoration:none" href="${esc(game.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" data-minigame-open="${esc(game.id)}" aria-label="${esc(game.title)} — mở trong tab mới">
          <span class="library-card-icon" aria-hidden="true">${esc(game.icon)}</span>
          <span class="library-card-title">${esc(game.title)}</span>
          <span class="library-card-copy">${esc(game.description)}</span>
          ${notes ? `<ul class="library-card-list" style="margin-bottom:14px">${notes}</ul>` : ""}
          <span class="library-card-action">${esc(game.action)}</span>
        </a>`;
}

function renderUpcomingCard(game, esc) {
  const titleId = `minigame-${game.id}-title`;
  return `<article class="library-hub-card is-upcoming" aria-disabled="true" aria-labelledby="${esc(titleId)}" data-minigame-upcoming="${esc(game.id)}">
          <span class="library-card-icon" aria-hidden="true">${esc(game.icon)}</span>
          <span class="library-card-title" id="${esc(titleId)}">${esc(game.title)}</span>
          <span class="library-card-badge">${esc(game.badge || "Sắp có")}</span>
          <span class="library-card-copy">${esc(game.description)}</span>
        </article>`;
}

export function renderMiniGameHubHtml(esc, games = MINI_GAMES) {
  const cards = games
    .map((g) => (g.status === "active" ? (isAllowedMiniGameUrl(g.url) ? renderActiveCard(g, esc) : "") : g.status === "upcoming" ? renderUpcomingCard(g, esc) : ""))
    .filter(Boolean)
    .join("");
  return `<div class="section-title"><div><h2>MINI GAME</h2><p class="mut">Trò chơi tương tác dùng trong giờ học. Mỗi trò chơi mở trong tab mới.</p></div></div>
      <div class="library-hub-grid" aria-label="Các Mini Game" data-minigame-hub="1">
        ${cards || `<p class="mut">Chưa có Mini Game nào.</p>`}
      </div>`;
}

export function mountMiniGameHub(container, esc, games = MINI_GAMES) {
  if (!container) return;
  container.innerHTML = renderMiniGameHubHtml(esc, games);
}
