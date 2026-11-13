// MINI GAME SSO R1 (phia HCMA2 Teaching = "trang cap quyen").
// Mini Game (/sso/begin) chuyen tab sang Teaching voi ?mg_sso_state=..&mg_sso_challenge=..&mg_sso_return=<origin Mini Game>.
// Teaching (nguoi dung DA dang nhap, tai khoan dang hoat dong) HOI XAC NHAN, lay ID token Firebase MOI va gui no - CHI qua header
// Authorization, KHONG qua URL - toi /api/sso/issue cua DUNG origin Mini Game nam trong danh sach cho phep (khong bao gio gui toi origin la).
// Mini Game tu xac minh token + tu doc ho so Firestore; Teaching chi chuyen tab sang /sso/callback?code=..&state=.. (ma mot lan, 60 giay).
// Khong mat khau nao duoc chia se; khong ghi gi vao Firestore; khong doi xac thuc cua Teaching.
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
  const req = readMiniGameSsoRequest(location.search);
  if (!req) return { status: "none" };
  try { history.replaceState(null, "", cleanedUrl(location)); } catch { /* bo qua */ }
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
  const el = overlay(doc, esc, `<h3 style="margin-top:0">🎮 Mở Mini Game</h3>
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
    go.onclick = async () => {
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
        go.disabled = false; cancel.disabled = false;
      }
    };
  });
}
