// MINI GAME hub (Mini Game tab R1).
// Pure registry + rendering for the teacher/admin "MINI GAME" tab. No Firestore, no Auth, no network, no storage, no imports:
// every game is an INDEPENDENT application opened through a plain link (never an iframe). SAME-TAB R1: the link replaces the current
// tab (no new tab); the game offers "Quay về HCMA2 Teaching". Nothing about the signed-in HCMA2 Teaching user (uid, email, token,
// role) is ever put in a URL (SSO: mini-game-sso.mjs sends a fresh ID token only in an Authorization header).
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
    action: "MỞ TRÒ CHƠI →",
    // MINI GAME IN-TEACHING P1: mo ngay trong Teaching, CUNG ORIGIN (GitHub Pages /minigame/), dang nhap = tai khoan Teaching.
    // Ban Cloudflare (workers.dev) giu nguyen nhung khong con hien o day; van nam trong MINI_GAME_ALLOWED_ORIGINS (dang xuat SSO cu).
    url: "/minigame/",
    notes: freeze([
      "Mở ngay trong HCMA2 Teaching (cùng trang); bấm “Quay về HCMA2 Teaching” để trở lại.",
      "Dùng chính tài khoản giảng viên HCMA2 Teaching, không cần đăng nhập lần hai.",
      "Học viên không cần tài khoản: tham gia bằng mã PIN hoặc quét mã QR trên màn chiếu."
    ])
  })
]);

/** Duong dan CUNG ORIGIN duoc phep (Mini Game tich hop trong Teaching). */
export const MINI_GAME_SAME_ORIGIN_PATHS = freeze(["/minigame/"]);

export function isAllowedMiniGameUrl(url, origins = MINI_GAME_ALLOWED_ORIGINS) {
  if (typeof url !== "string" || !url) return false;
  if (MINI_GAME_SAME_ORIGIN_PATHS.includes(url)) return true;
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
  return `<a class="library-hub-card" style="text-decoration:none" href="${esc(game.url)}" rel="noreferrer" referrerpolicy="no-referrer" data-minigame-open="${esc(game.id)}" aria-label="${esc(game.title)} — mở Mini Game trong tab này">
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
  return `<div class="section-title"><div><h2>MINI GAME</h2><p class="mut">Trò chơi tương tác dùng trong giờ học. Trò chơi mở ngay trong tab này.</p></div></div>
      <div class="library-hub-grid" aria-label="Các Mini Game" data-minigame-hub="1">
        ${cards || `<p class="mut">Chưa có Mini Game nào.</p>`}
      </div>`;
}

export function mountMiniGameHub(container, esc, games = MINI_GAMES) {
  if (!container) return;
  container.innerHTML = renderMiniGameHubHtml(esc, games);
  // Ban thu cuc bo (Emulator): giu ?emulator=1 khi sang /minigame/ (production khong bao gio co tham so nay)
  try {
    const loop = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (loop && new URLSearchParams(location.search).get("emulator") === "1")
      for (const a of container.querySelectorAll("a[data-minigame-open]")) {
        const h = a.getAttribute("href") || "";
        if (h.startsWith("/")) a.setAttribute("href", h + "?emulator=1");
      }
  } catch {
    /* bo qua */
  }
}
