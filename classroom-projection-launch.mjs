// GATE 5F.C — Teaching's launch/revoke plumbing for the Classroom Second Brain (V2) projection.
// Talks ONLY to the accepted, frozen Gate 5C HTTP contract (POST /projections/start,
// POST /projections/close) — never redesigns it, never guesses its shape (verified directly
// against the accepted Classroom source, candidate 80dcb924faf916fbd9f51a8600658dcefbd687c4).
// Every external effect (window.open, fetch, getIdToken, now()) is injected, mirroring this
// repo's own established pattern (contract-activation.mjs, ai-gateway-adapter.mjs) — so the
// state machine, popup-safety ordering, and error mapping below are fully unit-testable without a
// browser, without real Firebase, and without a live Classroom service (none exists yet).
//
// Scope: Knowledge Co-creation dashboard launch/close only. Does not touch Item 1/2/3/4, AI
// Analyze, Firestore Rules/indexes, the Public Second Brain V1 service, or any Gate 5C/5D/5E
// backend file.

// GATE 5F.B architecture decision #1 (frozen) — the one place this hostname is defined. Every
// caller in this module builds URLs from this constant; nothing else in this file hardcodes it.
export const CLASSROOM_ORIGIN = "https://classroom.quantth.vn";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/; // exact Gate 5C contract (projections.mjs)

export function isValidIdempotencyKey(key) {
  return typeof key === "string" && IDEMPOTENCY_KEY_PATTERN.test(key);
}

/** Defaults to crypto.randomUUID() (36 chars, [0-9a-f-] — already satisfies the pattern above);
 * accepts an injectable generator only so tests can assert exact behavior without relying on the
 * real CSPRNG's specific output. */
export function generateIdempotencyKey(randomUUID = () => crypto.randomUUID()) {
  const key = randomUUID();
  if (!isValidIdempotencyKey(key)) {
    // Defensive: would only fire if a caller injected a non-conforming generator — never silently
    // send a key the accepted Classroom backend would reject with BAD_IDEMPOTENCY_KEY.
    throw new Error(`generateIdempotencyKey: generated value does not satisfy the Gate 5C idempotencyKey pattern: ${JSON.stringify(key)}`);
  }
  return key;
}

// GATE 5F.A §3 / Gate 5C's authorizeOwnerOrAdmin (projections.mjs) — mirrored, not reinvented.
// Frontend visibility only; the backend re-checks this authoritatively on every request and is
// never weakened or bypassed by this function returning true.
export function canLaunchClassroomProjection({ session, isAdminView, actorUid }) {
  if (!session) return false;
  if (session.teacherDeletedAt || session.adminDeletedAt || session.adminDeleting || session.deletingAt) return false;
  if (isAdminView) return true;
  return session.ownerId === actorUid;
}

export function buildStartRequestBody({ knowledgeSessionId, idempotencyKey }) {
  return { knowledgeSessionId, idempotencyKey };
}

// Exact Gate 5C /projections/close contract (server.mjs): body is {knowledgeSessionId} only — no
// idempotencyKey, no projectionSessionId. Verified against source, not guessed.
export function buildCloseRequestBody({ knowledgeSessionId }) {
  return { knowledgeSessionId };
}

/**
 * GATE 5F.C Part G step 8 — "do not blindly navigate to an arbitrary URL returned by HTTP."
 * Exact-origin, exact-path, https-only. Never trusts anything about the URL beyond this shape.
 */
export function validateBootstrapUrl(bootstrapUrl, expectedOrigin = CLASSROOM_ORIGIN) {
  let parsed;
  try {
    parsed = new URL(bootstrapUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.origin !== expectedOrigin) return false;
  if (parsed.pathname !== "/classroom/bootstrap") return false;
  if (!parsed.searchParams.get("b")) return false;
  return true;
}

// GATE 5F.C Part M — Vietnamese, lecturer-facing, never a raw stack trace/token/server body.
// Codes are the exact Gate 5C AppError codes (projections.mjs) — verified, not guessed.
const ERROR_MESSAGES = {
  UNAUTHENTICATED: "Phiên đăng nhập đã hết hạn. Vui lòng tải lại trang và đăng nhập lại.",
  FORBIDDEN: "Bạn không có quyền chiếu phiên này.",
  BAD_SESSION: "Mã phiên Knowledge không hợp lệ.",
  SESSION_NOT_FOUND: "Không tìm thấy phiên Knowledge này.",
  SESSION_DELETED: "Phiên đã bị xóa hoặc đưa vào thùng rác — không thể chiếu.",
  BAD_IDEMPOTENCY_KEY: "Lỗi kỹ thuật khi khởi tạo yêu cầu. Vui lòng thử lại.",
  NETWORK: "Không thể kết nối tới máy chủ Trình chiếu. Vui lòng kiểm tra Internet và thử lại.",
  INVALID_BOOTSTRAP_URL: "Máy chủ trả về liên kết trình chiếu không hợp lệ. Vui lòng thử lại hoặc liên hệ quản trị viên.",
  POPUP_BLOCKED: "Trình duyệt đã chặn cửa sổ mới. Vui lòng cho phép cửa sổ bật lên (popup) cho trang này rồi nhấn lại \"Trình chiếu Second Brain\".",
};
const DEFAULT_ERROR_MESSAGE = "Không thể thực hiện thao tác. Vui lòng thử lại.";

export function classroomErrorMessage(code) {
  return ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGE;
}

/**
 * GATE 5F.C — the launch/close state machine. Every side effect is injected:
 *   - windowOpenImpl(url, target): like window.open — MUST be called synchronously as the first
 *     statement of a start() invoked directly from a trusted click handler (see start() below).
 *   - fetchImpl(url, init): like fetch.
 *   - getIdToken(): () => Promise<string> — the current Firebase ID token.
 *   - now(): () => number — for tests only; unused in real operation beyond being injectable.
 * projectionSessionId lives ONLY in this closure (module-level per controller instance) — never
 * written to browser storage of any kind, never a new backend lookup endpoint (Gate 5F.C Part J).
 * A Teaching page refresh loses it; that is explicitly accepted for this candidate.
 */
export function createClassroomLaunchController({ windowOpenImpl, fetchImpl, getIdToken, origin = CLASSROOM_ORIGIN, randomUUID }) {
  let state = "idle"; // idle | starting | active | closing
  let projectionSessionId = null;
  let inFlightStartPromise = null;

  async function postJson(path, idToken, body) {
    let res;
    try {
      res = await fetchImpl(`${origin}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error("network failure"), { classroomCode: "NETWORK" });
    }
    let json;
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (!res.ok) {
      throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { classroomCode: json?.error?.code || "NETWORK" });
    }
    return json;
  }

  // GATE 5F.C FIX1 — by the time this runs, `win` is ALWAYS a real, already-open window (start()
  // below only ever calls this after windowOpenImpl succeeded) — never null. There is therefore no
  // "popup blocked after a successful Start" case to handle here any more: popup-blocked is
  // detected and handled entirely BEFORE any network call, in start() itself.
  async function doStart(session, win, idempotencyKey) {
    try {
      const idToken = await getIdToken();
      const body = buildStartRequestBody({ knowledgeSessionId: session.id, idempotencyKey });
      const { bootstrapUrl, projectionSessionId: newProjectionSessionId } = await postJson("/projections/start", idToken, body);

      if (!validateBootstrapUrl(bootstrapUrl, origin)) {
        closeQuietly(win);
        state = "idle";
        return { ok: false, code: "INVALID_BOOTSTRAP_URL", message: classroomErrorMessage("INVALID_BOOTSTRAP_URL") };
      }

      projectionSessionId = newProjectionSessionId;
      state = "active";
      // Already-open window from the trusted click — navigating it now needs no fresh gesture.
      win.location.href = bootstrapUrl;
      return { ok: true, projectionSessionId };
    } catch (err) {
      // GATE 5F.C FIX1 — the blank window was already opened before this failed (token
      // acquisition, network/CORS, or a backend rejection) — never leave it as an orphan empty
      // tab. Does NOT touch any existing projection: a failed startProjection() call never
      // revokes the previous grant server-side (Gate 5C's transaction only revokes as part of a
      // SUCCESSFUL new Start), so there is nothing to undo here beyond closing this tab.
      closeQuietly(win);
      state = "idle";
      const code = err.classroomCode || "NETWORK";
      return { ok: false, code, message: classroomErrorMessage(code) };
    } finally {
      inFlightStartPromise = null;
    }
  }

  function closeQuietly(win) {
    try {
      win.close();
    } catch {
      // Best-effort — some browsers restrict script-closing in edge cases; never let cleanup
      // itself throw and mask the real error being reported to the caller.
    }
  }

  return {
    getState: () => state,
    getProjectionSessionId: () => projectionSessionId,

    /**
     * GATE 5F.C Part G/I/L. `confirmed` must be explicitly true to restart an already-active
     * projection (Part L) — the caller owns showing that confirmation (e.g. native confirm()),
     * matching this codebase's existing convention; this function never prompts itself.
     *
     * GATE 5F.C FIX1 — window.open() is checked BEFORE any state mutation, before generating an
     * idempotencyKey, and before any network call. If it is blocked (returns a falsy value), this
     * returns immediately: no getIdToken(), no fetch, no POST /projections/start, no
     * idempotencyKey generated, `state` and any existing active projection are left completely
     * untouched (a confirmed restart whose popup is blocked therefore never revokes the old
     * projection — the revoke only ever happens as a side effect of a SUCCESSFUL new
     * startProjection() transaction on the Classroom backend, which this path never reaches).
     */
    start(session, { confirmed = false } = {}) {
      if (state === "starting") return inFlightStartPromise; // double-click dedupe: same in-flight request, same idempotencyKey
      if (state === "active" && !confirmed) {
        return Promise.resolve({ ok: false, needsConfirmation: true });
      }
      // GATE 5F.C Part G step 2/9 — window.open() is the FIRST thing this function does, with NO
      // preceding await, so it runs synchronously within the caller's trusted click-event call
      // stack regardless of state becoming an async function here.
      const win = windowOpenImpl("about:blank", "_blank");
      if (!win) {
        return Promise.resolve({ ok: false, code: "POPUP_BLOCKED", message: classroomErrorMessage("POPUP_BLOCKED"), popupBlocked: true });
      }
      state = "starting";
      const idempotencyKey = generateIdempotencyKey(randomUUID);
      inFlightStartPromise = doStart(session, win, idempotencyKey);
      return inFlightStartPromise;
    },

    async close(session) {
      if (state === "closing") return { ok: false, code: "NETWORK", message: classroomErrorMessage("NETWORK") };
      state = "closing";
      try {
        const idToken = await getIdToken();
        const body = buildCloseRequestBody({ knowledgeSessionId: session.id });
        const result = await postJson("/projections/close", idToken, body);
        projectionSessionId = null;
        state = "idle";
        return { ok: true, closed: !!result.closed };
      } catch (err) {
        // Close failing does not silently pretend the projection ended — state returns to
        // "active" so the lecturer can see Close is still needed and retry.
        state = "active";
        const code = err.classroomCode || "NETWORK";
        return { ok: false, code, message: classroomErrorMessage(code) };
      }
    },
  };
}
