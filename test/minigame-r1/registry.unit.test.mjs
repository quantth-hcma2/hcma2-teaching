// MINI GAME TAB R1 - pure unit tests for mini-game-registry.mjs (no DOM, no network).
// Run: node --test test/minigame-r1/registry.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { MINI_GAMES, MINI_GAME_ROUTE_KEY, MINI_GAME_ALLOWED_ORIGINS, isAllowedMiniGameUrl, activeMiniGames, renderMiniGameHubHtml, mountMiniGameHub } from "../../mini-game-registry.mjs";

// same escaping as index.html esc()
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const QUIZ = "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/";

test("registry: exactly one active game (Trắc nghiệm tương tác) on the approved origin; route key is 'minigames'; data is frozen", () => {
  assert.equal(MINI_GAME_ROUTE_KEY, "minigames");
  assert.deepEqual(MINI_GAME_ALLOWED_ORIGINS, ["https://hcma2-interactive.hcma2-interactive-v1.workers.dev"]);
  assert.equal(MINI_GAMES.length, 1);
  const [quiz] = MINI_GAMES;
  assert.equal(quiz.id, "quiz");
  assert.equal(quiz.status, "active");
  assert.equal(quiz.title, "TRẮC NGHIỆM TƯƠNG TÁC");
  assert.equal(quiz.url, QUIZ);
  assert.ok(Object.isFrozen(MINI_GAMES) && Object.isFrozen(quiz) && Object.isFrozen(MINI_GAME_ALLOWED_ORIGINS));
  assert.deepEqual(activeMiniGames().map((g) => g.id), ["quiz"]);
});

test("url allow-list: https on an approved origin only; no credentials, other hosts, look-alikes or schemes", () => {
  assert.equal(isAllowedMiniGameUrl(QUIZ), true);
  assert.equal(isAllowedMiniGameUrl(QUIZ + "play/?pin=123456"), true, "paths on the approved origin are allowed");
  for (const bad of [
    "http://hcma2-interactive.hcma2-interactive-v1.workers.dev/",
    "https://evil.workers.dev/",
    "https://hcma2-interactive.hcma2-interactive-v1.workers.dev.evil.example/",
    "https://user:pw@hcma2-interactive.hcma2-interactive-v1.workers.dev/",
    "javascript:alert(1)",
    "data:text/html,x",
    "//hcma2-interactive.hcma2-interactive-v1.workers.dev/",
    "",
    null,
    42
  ]) assert.equal(isAllowedMiniGameUrl(bad), false, String(bad));
});

test("render: the active game is a plain <a> link opening a NEW tab with noopener noreferrer and no-referrer; no iframe, no script, no handler", () => {
  const html = renderMiniGameHubHtml(esc);
  assert.match(html, /<h2>MINI GAME<\/h2>/);
  const links = html.match(/<a [^>]*>/g) || [];
  assert.equal(links.length, 1);
  const a = links[0];
  assert.ok(a.includes(`href="${QUIZ}"`));
  assert.ok(a.includes('target="_blank"'));
  assert.ok(a.includes('rel="noopener noreferrer"'));
  assert.ok(a.includes('referrerpolicy="no-referrer"'));
  assert.ok(a.includes('data-minigame-open="quiz"'));
  assert.ok(!/<iframe|<script|\son[a-z]+=|javascript:/i.test(html));
  assert.ok(html.includes("TRẮC NGHIỆM TƯƠNG TÁC") && html.includes("MỞ TRÒ CHƠI"));
  assert.ok(/tab mới/.test(html) && /tài khoản Mini Game riêng/.test(html) && /PIN/.test(html), "explains new tab, separate account, PIN/QR");
});

test("extensible: a second active game renders a second card; an upcoming game renders a disabled card without a link; unknown status and disallowed urls render nothing", () => {
  const games = [
    ...MINI_GAMES,
    { id: "second", status: "active", icon: "🧩", title: "TRÒ CHƠI 2", description: "d", action: "MỞ", url: "https://hcma2-interactive.hcma2-interactive-v1.workers.dev/game2/" },
    { id: "soon", status: "upcoming", icon: "⏳", title: "SẮP CÓ", description: "d" },
    { id: "evil", status: "active", icon: "x", title: "EVIL", description: "d", action: "x", url: "https://evil.example/" },
    { id: "weird", status: "draft", icon: "x", title: "WEIRD", description: "d" }
  ];
  const html = renderMiniGameHubHtml(esc, games);
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.ok(html.includes('data-minigame-open="second"'));
  assert.ok(html.includes('data-minigame-upcoming="soon"') && html.includes('aria-disabled="true"'));
  assert.ok(!html.includes("EVIL") && !html.includes("evil.example") && !html.includes("WEIRD"));
  assert.deepEqual(activeMiniGames(games).map((g) => g.id), ["quiz", "second"]);
});

test("escaping: registry text is HTML-escaped; an empty registry shows an honest empty state", () => {
  const html = renderMiniGameHubHtml(esc, [{ id: "x", status: "upcoming", icon: "<b>", title: "<img src=x onerror=alert(1)>", description: "\"'&" }]);
  assert.ok(!html.includes("<img") && html.includes("&lt;img") && html.includes("&quot;&#39;&amp;"));
  assert.match(renderMiniGameHubHtml(esc, []), /Chưa có Mini Game nào/);
});

test("mount: writes the hub into the given container only; no container = no-op", () => {
  const c = { innerHTML: "" };
  mountMiniGameHub(c, esc);
  assert.match(c.innerHTML, /data-minigame-hub="1"/);
  assert.doesNotThrow(() => mountMiniGameHub(null, esc));
});
