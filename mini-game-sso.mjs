// MINI GAME SSO R1 (phia HCMA2 Teaching = "trang cap quyen").
// Mini Game (/sso/begin) chuyen tab sang Teaching voi ?mg_sso_state=..&mg_sso_challenge=..&mg_sso_return=<origin Mini Game>.
// Teaching (nguoi dung DA dang nhap, tai khoan dang hoat dong) HOI XAC NHAN, lay ID token Firebase MOI va gui no - CHI qua header
// Authorization, KHONG qua URL - toi /api/sso/issue cua DUNG origin Mini Game nam trong danh sach cho phep (khong bao gio gui toi origin la).
// Mini Game tu xac minh token + tu doc ho so Firestore; Teaching chi chuyen tab sang /sso/callback?code=..&state=.. (ma mot lan, 60 giay).
// Khong mat khau nao duoc chia se; khong ghi gi vao Firestore; khong doi xac thuc cua Teaching.
// SAME-TAB R1: the Mini Game card opens in THIS tab. Clicking it records a short-lived intent (sessionStorage of this tab only,
// 2 minutes, one use); when the same tab comes back with the SSO request for that Mini Game origin, the click IS the confirmation
// and the code is requested at once. Any other arrival (Mini Game login button, another site, a stale or reused intent) still shows
// the confirmation dialog. location.replace keeps history to [Teaching, Mini Game] (Back returns to Teaching, no loop).
import { MINI_GAME_ALLOWED_ORIGINS } from "./mini-game-registry.mjs?v=20261113-sso-r1";

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const PARAMS = ["mg_sso_state", "mg_sso_challenge", "mg_sso_return"];

/** Doc yeu cau SSO tu query. null = khong co yeu cau; {invalid:true} = co nhung sai dinh dang / origin khong duoc phep. */
export function readMiniGameSsoRequest(search, allowedOrigins = MINI_GAME_ALLOWED_ORIGINS) {
  const q = new URLSearchParams(search || "");
  if (!PARAMS.some((p) => q.has(p))) return null;
  const state = q.get("mg_sso_state") || "", challenge = q.get("mg_sso_challenge") || "", returnOrigin = q.get("mg_sso_return") || "";
  if (!B64URL_32.test(state) || !B64URL_32.test(challenge) || !allowedOrigins.includes(returnOrigin)) return { invalid: true };
  return { state, challenge, returnOrigin };
}

/** Bo cac tham so SSO khoi thanh dia chi (khong de lai trong lich su / khong kich hoat lai). */
export function cleanedUrl(loc) {
  const q = new URLSearchParams(loc.search || "");
  for (const p of PARAMS) q.delete(p);
  const s = q.toString();
  return loc.pathname + (s ? "?" + s : "") + (loc.hash || "");
}

// ---------------------------------------------------------------- OD01: dang xuat Teaching -> thu hoi phien Mini Game
// Giu san mot ID token (lam moi dinh ky) de khi bam "Dang xuat" gui NGAY (truoc khi Teaching dang xuat) toi
// <origin Mini Game duoc phep>/api/sso/signout - chi trong header Authorization, khong cookie, keepalive.
const SIGNOUT_REFRESH_MS = 10 * 60_000;
const SIGNOUT_TOKEN_MAX_AGE_S = 40 * 60; // Mini Game chap nhan token dang xuat toi 60 phut tuoi
export function tokenAgeSeconds(token, nowMs = Date.now()) {
  try {
    const p = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Math.floor(nowMs / 1000) - Number(p.iat || 0);
  } catch {
    return Infinity;
  }
}
export function armMiniGameSignout(deps) {
  const doc = deps.document || document;
  const origins = deps.allowedOrigins || MINI_GAME_ALLOWED_ORIGINS;
  const fetchImpl = deps.fetchImpl || fetch.bind(globalThis);
  if (doc.__mgSignout) {
    doc.__mgSignout.getToken = deps.getCachedToken; // lan render khung menu sau: chi cap nhat ham lay token
    return doc.__mgSignout;
  }
  const state = { token: null, getToken: deps.getCachedToken };
  state.refresh = async () => {
    try {
      let t = await state.getToken(false);
      if (tokenAgeSeconds(t) > SIGNOUT_TOKEN_MAX_AGE_S) t = await state.getToken(true);
      state.token = t;
    } catch {
      state.token = null;
    }
  };
  void state.refresh();
  state.timer = setInterval(() => void state.refresh(), SIGNOUT_REFRESH_MS);
  doc.addEventListener("click", (ev) => {
    const t = ev.target;
    const btn = t && t.closest ? t.closest("#btnLogoutTop") : null;
    if (!btn || !state.token) return;
    const token = state.token;
    state.token = null;
    for (const origin of origins)
      fetchImpl(origin + "/api/sso/signout", {
        method: "POST",
        keepalive: true,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: "{}",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      }).catch(() => {});
  }, true);
  doc.__mgSignout = state;
  return state;
}

const INTENT_KEY = "hcma2.miniGameSsoIntent";
export const INTENT_TTL_MS = 120_000;
function safeStorage(deps) {
  try { return deps.storage !== undefined ? deps.storage : globalThis.sessionStorage || null; } catch { return null; }
}
/** Ghi y dinh mo Mini Game (nguoi dung vua bam the trong CHINH tab nay). */
export function rememberMiniGameIntent(storage, href, allowedOrigins = MINI_GAME_ALLOWED_ORIGINS, nowMs = Date.now()) {
  try {
    const origin = new URL(href).origin;
    if (!storage || !allowedOrigins.includes(origin)) return false;
    storage.setItem(INTENT_KEY, JSON.stringify({ origin, at: nowMs }));
    return true;
  } catch {
    return false;
  }
}
/** Lay va XOA y dinh (dung mot lan). true chi khi con han va dung origin Mini Game dang yeu cau. */
export function takeMiniGameIntent(storage, returnOrigin, nowMs = Date.now()) {
  if (!storage) return false;
  let v = null;
  try { v = JSON.parse(storage.getItem(INTENT_KEY) || "null"); } catch { v = null; }
  try { storage.removeItem(INTENT_KEY); } catch { /* bo qua */ }
  return !!v && v.origin === returnOrigin && typeof v.at === "number" && nowMs - v.at >= 0 && nowMs - v.at <= INTENT_TTL_MS;
}
/** Bam the Mini Game -> ghi y dinh; quay lai bang Back (bfcache) -> go lop phu "dang mo" cu. Goi nhieu lan an toan. */
export function armMiniGameSameTab(deps) {
  const doc = deps.document || document;
  if (doc.__mgSameTab) return doc.__mgSameTab;
  const storage = safeStorage(deps);
  const origins = deps.allowedOrigins || MINI_GAME_ALLOWED_ORIGINS;
  if (typeof doc.addEventListener === "function") doc.addEventListener("click", (ev) => {
    const a = ev.target && ev.target.closest ? ev.target.closest("a[data-minigame-open]") : null;
    if (a) rememberMiniGameIntent(storage, a.getAttribute("href") || "", origins);
  }, true);
  const win = deps.window || (typeof window !== "undefined" ? window : null);
  if (win && win.addEventListener) win.addEventListener("pageshow", (e) => { if (e.persisted) doc.getElementById("mgSsoOverlay")?.remove(); });
  doc.__mgSameTab = { storage };
  return doc.__mgSameTab;
}

export function eligible(profile) {
  return !!profile && profile.status === "active" && (profile.role === "teacher" || profile.role === "admin");
}

function overlay(doc, esc, html) {
  doc.getElementById("mgSsoOverlay")?.remove();
  const el = doc.createElement("div");
  el.id = "mgSsoOverlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:16px";
  el.innerHTML = `<div style="background:#fff;color:#0f172a;max-width:460px;width:100%;border-radius:16px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.3);line-height:1.5">${html}</div>`;
  doc.body.appendChild(el);
  return el;
}

/**
 * Goi sau khi khung menu cua tai khoan dang hoat dong da hien. Khong co yeu cau SSO -> khong lam gi.
 * deps: { location, history, document, getIdToken: () => Promise<string>, profile, esc, fetchImpl }
 */
export async function startMiniGameSsoIfRequested(deps) {
  const { location, history, esc } = deps;
  const doc = deps.document || document;
  const fetchImpl = deps.fetchImpl || fetch.bind(globalThis);
  if (deps.getCachedToken) armMiniGameSignout({ document: doc, getCachedToken: deps.getCachedToken, fetchImpl });
  const sameTab = armMiniGameSameTab({ document: doc, storage: deps.storage, window: deps.window, allowedOrigins: deps.allowedOrigins });
  const req = readMiniGameSsoRequest(location.search);
  if (!req) return { status: "none" };
  try { history.replaceState(null, "", cleanedUrl(location)); } catch { /* bo qua */ }
  const clicked = takeMiniGameIntent(sameTab.storage, req.returnOrigin) && !req.invalid; // y dinh luon bi xoa (dung mot lan)
  if (req.invalid) {
    const el = overlay(doc, esc, `<h3 style="margin-top:0">Không mở được Mini Game</h3><p>Liên kết mở Mini Game không hợp lệ.</p><button type="button" class="btn" data-mg-sso="close">Đóng</button>`);
    el.querySelector('[data-mg-sso="close"]').onclick = () => el.remove();
    return { status: "invalid" };
  }
  if (!eligible(deps.profile)) {
    const el = overlay(doc, esc, `<h3 style="margin-top:0">Không mở được Mini Game</h3><p>Chỉ giảng viên và quản trị đang hoạt động mới dùng được Mini Game.</p><button type="button" class="btn" data-mg-sso="close">Đóng</button>`);
    el.querySelector('[data-mg-sso="close"]').onclick = () => el.remove();
    return { status: "ineligible" };
  }
  const who = deps.profile.displayName || deps.profile.email || "";
  const el = clicked
    ? overlay(doc, esc, `<h3 style="margin-top:0">🎮 Đang mở Mini Game…</h3>
    <p>Đăng nhập <b>Trắc nghiệm tương tác</b> bằng tài khoản HCMA2 Teaching <b>${esc(who)}</b>. Mật khẩu không được chia sẻ.</p>
    <p id="mgSsoMsg" style="color:#b91c1c;font-size:14px;margin:0 0 10px" role="alert"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" class="btn btn-outline" data-mg-sso="cancel" hidden>Đóng</button>
      <button type="button" class="btn" data-mg-sso="go" hidden>Thử lại</button>
    </div>`)
    : overlay(doc, esc, `<h3 style="margin-top:0">🎮 Mở Mini Game</h3>
    <p>Đăng nhập <b>Trắc nghiệm tương tác</b> bằng tài khoản HCMA2 Teaching <b>${esc(who)}</b>?</p>
    <p style="color:#475569;font-size:14px">Mini Game sẽ nhận họ tên, email và vai trò (giảng viên / quản trị) của bạn. Mật khẩu không được chia sẻ.</p>
    <p id="mgSsoMsg" style="color:#b91c1c;font-size:14px;margin:0 0 10px" role="alert"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" class="btn btn-outline" data-mg-sso="cancel">Huỷ</button>
      <button type="button" class="btn" data-mg-sso="go">Mở Mini Game</button>
    </div>`);
  const go = el.querySelector('[data-mg-sso="go"]'), cancel = el.querySelector('[data-mg-sso="cancel"]'), msg = el.querySelector("#mgSsoMsg");
  return new Promise((resolve) => {
    cancel.onclick = () => { el.remove(); resolve({ status: "cancelled" }); };
    const run = async () => {
      go.disabled = true; cancel.disabled = true; msg.textContent = "";
      try {
        const token = await deps.getIdToken();
        const r = await fetchImpl(req.returnOrigin + "/api/sso/issue", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ state: req.state, challenge: req.challenge }),
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || typeof data.code !== "string" || !B64URL_32.test(data.code)) throw new Error(data.error || "Mini Game từ chối yêu cầu (" + r.status + ")");
        const target = new URL(req.returnOrigin + "/sso/callback");
        target.searchParams.set("code", data.code);
        target.searchParams.set("state", req.state);
        location.replace(target.toString());
        resolve({ status: "redirected" });
      } catch (e) {
        msg.textContent = String((e && e.message) || e);
        go.disabled = false; cancel.disabled = false; go.hidden = false; cancel.hidden = false;
      }
    };
    go.onclick = run;
    if (clicked) void run(); // nguoi dung vua bam the trong tab nay = da xac nhan
  });
}
