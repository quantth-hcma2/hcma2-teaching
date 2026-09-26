// GATE 5F.C — Teaching's launch/revoke plumbing for the Classroom Second Brain (V2) projection.
// Talks ONLY to the accepted, frozen Gate 5C HTTP contract (POST /projections/start,
// POST /projections/close) — never redesigns it, never guesses its shape (verified directly
// against the accepted Classroom source, candidate 80dcb924faf916fbd9f51a8600658dcefbd687c4).
// Every external effect (window.open, fetch, getIdToken, now()) is injected, mirroring this
// repo's own established pattern (contract-activation.mjs, ai-gateway-adapter.mjs) — so the
// state machine, popup-safety ordering, and error mapping below are fully unit-testable without a
// browser, without real Firebase, and without a live Classroom service.
//
// GATE 5F.D2.F1 — server-derived recovery: the controller can ask the accepted Classroom status
// endpoint (POST /projections/status, body {knowledgeSessionId} only) whether a server-side
// projection grant is active for this Knowledge session, so a refreshed Teaching page no longer
// forgets an active grant. Start/Close/bootstrap contracts are unchanged.
//
// GATE 5F.D2.G13B — re-verified against the frozen, deployed Classroom candidate
// 383f5bfe8aef1ec4b9979d74b99f1c57436e2388 (live on revision 00004-dac): the AppError inventory is
// unchanged except for the new INVALID_EPOCH (409, thrown by startProjection's in-transaction
// grantEpoch reread, before any write — never ambiguous, same handling as any other definitive
// rejection) — mapped below. GRANT_REVOKED is thrown only inside exchangeBootstrap (the
// server-side bootstrap-redirect flow) and never reaches this module's error path.
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

// GATE 5F.D2.F1 — exact accepted status contract (Classroom candidate 3f2c94c, live since revision
// 00002-wir): body is {knowledgeSessionId} only.
export function buildStatusRequestBody({ knowledgeSessionId }) {
  return { knowledgeSessionId };
}

export const STATUS_TIMEOUT_MS = 8000;

/**
 * GATE 5F.D2.F1 — strict parse of the accepted status response
 * { active: boolean, startedAtMs: number|null, expiresAtMs: number|null }.
 * Returns { active } for a well-formed body and null for ANYTHING else — a malformed body means
 * "unknown", and must never be coerced into active:false.
 */
export function parseStatusResponse(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (json.active === true) {
    if (!Number.isFinite(json.startedAtMs) || !Number.isFinite(json.expiresAtMs) || json.expiresAtMs <= json.startedAtMs) return null;
    return { active: true };
  }
  if (json.active === false) {
    if (json.startedAtMs !== null || json.expiresAtMs !== null) return null;
    return { active: false };
  }
  return null;
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
  // GATE 5F.D2.G13B — new Gate 5F.D2.G12B backend code: startProjection() rejects when the
  // Knowledge session's grantEpoch is missing/invalid at the moment of the in-transaction reread.
  // Thrown entirely within the transaction's read phase, before any write is staged — never
  // ambiguous, the server-side state is unchanged. Message stays generic on purpose: no mention of
  // "epoch"/internal state, just a refresh-and-retry instruction.
  INVALID_EPOCH: "Trạng thái phiên đã thay đổi. Vui lòng tải lại trang và thử lại.",
  NETWORK: "Không thể kết nối tới máy chủ Trình chiếu. Vui lòng kiểm tra Internet và thử lại.",
  INVALID_BOOTSTRAP_URL: "Máy chủ trả về liên kết trình chiếu không hợp lệ. Vui lòng thử lại hoặc liên hệ quản trị viên.",
  STATUS_UNAVAILABLE: "Không kiểm tra được trạng thái trình chiếu. Có thể đang có một phiên chiếu hoạt động.",
  POPUP_BLOCKED: "Trình duyệt đã chặn cửa sổ mới. Vui lòng cho phép cửa sổ bật lên (popup) cho trang này rồi nhấn lại \"Trình chiếu Second Brain\".",
};
const DEFAULT_ERROR_MESSAGE = "Không thể thực hiện thao tác. Vui lòng thử lại.";

export function classroomErrorMessage(code) {
  return ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGE;
}

/**
 * GATE 5F.D2.POST-2 — shared token-provider contract used by Start/Status/Close alike (through
 * this module's existing `getIdToken` injection seam — see createClassroomLaunchController below).
 * Root cause this closes: production evidence (Gate 5F.D2.POST-1) proved a real Close request
 * reached the Classroom backend with an EMPTY Authorization value ("Bearer " with nothing after),
 * rejected 401 UNAUTHENTICATED — and external Firebase JS SDK source (POST-1A) confirms
 * getIdToken() can legitimately resolve to an empty string if the STS backend's response is ever
 * malformed; the SDK does not itself guard against this. postJson() must never receive that value.
 * `getCurrentUser()` is injected (not `firebase/auth` imported directly) so this stays fully
 * unit-testable without a browser or real Firebase, matching this module's existing design
 * principle (see the file header comment).
 */
export function createGetClassroomIdToken(getCurrentUser) {
  return async function getClassroomIdToken({ forceRefresh = false } = {}) {
    const user = getCurrentUser();
    if (!user) {
      throw Object.assign(new Error("no current user"), { classroomCode: "UNAUTHENTICATED" });
    }
    let token;
    try {
      token = await user.getIdToken(forceRefresh);
    } catch {
      throw Object.assign(new Error("getIdToken failed"), { classroomCode: "UNAUTHENTICATED" });
    }
    if (typeof token !== "string" || token.trim() === "") {
      throw Object.assign(new Error("empty id token"), { classroomCode: "UNAUTHENTICATED" });
    }
    return token;
  };
}

/**
 * GATE 5F.C — the launch/close state machine. Every side effect is injected:
 *   - windowOpenImpl(url, target): like window.open — MUST be called synchronously as the first
 *     statement of a start() invoked directly from a trusted click handler (see start() below).
 *   - fetchImpl(url, init): like fetch.
 *   - getIdToken({forceRefresh}={}): () => Promise<string> — the current Firebase ID token; see
 *     createGetClassroomIdToken above for the shared, tested implementation this should be built
 *     from. Never resolves to an empty/non-string value — throws classroomCode:"UNAUTHENTICATED"
 *     instead (Gate 5F.D2.POST-2).
 *   - now(): () => number — for tests only; unused in real operation beyond being injectable.
 * projectionSessionId lives ONLY in this closure (module-level per controller instance) — never
 * written to browser storage of any kind, never a new backend lookup endpoint (Gate 5F.C Part J).
 *
 * GATE 5F.D2.F1 — two independent dimensions are tracked:
 *   - `state` (idle | starting | active | closing): the accepted Gate 5F.C machine, unchanged.
 *   - `knowledge` (unchecked | checking | active | inactive | unavailable): what this controller
 *     knows about the SERVER-SIDE grant, learned from POST /projections/status or from a confirmed
 *     Start/Close result. "checking" and "unavailable" are both UNKNOWN — never treated as inactive.
 * With requireKnownStatus:true (the dashboard's setting) a never-checked controller is also
 * UNKNOWN. A Teaching refresh recovers the grant via checkStatus(), not from browser storage.
 *
 * Stale-response protection: every operation that could change the truth (a new status check,
 * Start, Close, dispose) bumps `epoch`; an asynchronous status response is applied only if the
 * epoch it started under is still current and the controller is not disposed. A controller is also
 * bound to the first Knowledge session it is used with and refuses any other session id.
 */
export function createClassroomLaunchController({
  windowOpenImpl,
  fetchImpl,
  getIdToken,
  origin = CLASSROOM_ORIGIN,
  randomUUID,
  requireKnownStatus = false,
  statusTimeoutMs = STATUS_TIMEOUT_MS,
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (handle) => clearTimeout(handle),
}) {
  let state = "idle"; // idle | starting | active | closing
  let knowledge = "unchecked"; // unchecked | checking | active | inactive | unavailable
  let projectionSessionId = null;
  let inFlightStartPromise = null;
  let startBaseline = { state: "idle", knowledge: "unchecked" }; // state/knowledge captured just before the in-flight Start
  let boundSessionId = null;
  let epoch = 0;
  let disposed = false;

  function bind(session) {
    if (!session || typeof session.id !== "string" || !session.id) return false;
    if (boundSessionId === null) boundSessionId = session.id;
    return boundSessionId === session.id;
  }

  function sessionMismatch() {
    return { ok: false, code: "SESSION_MISMATCH", message: classroomErrorMessage("SESSION_MISMATCH") };
  }

  async function postJson(path, idToken, body, signal) {
    let res;
    try {
      const init = {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
      if (signal) init.signal = signal;
      res = await fetchImpl(`${origin}${path}`, init);
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

  // GATE 5F.D2.F1 — one status round trip (token + request) bounded by a timeout; on timeout the
  // request is aborted where the platform supports it. Never a mutating call.
  async function requestStatus(knowledgeSessionId) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeoutImpl(() => {
        try { controller?.abort(); } catch { /* best effort */ }
        reject(Object.assign(new Error("status timeout"), { classroomCode: "TIMEOUT" }));
      }, statusTimeoutMs);
    });
    try {
      const work = (async () => {
        const idToken = await getIdToken();
        return postJson("/projections/status", idToken, buildStatusRequestBody({ knowledgeSessionId }), controller?.signal);
      })();
      work.catch(() => {}); // a late rejection after the timeout won must not surface as unhandled
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeoutImpl(timer);
    }
  }

  // Which confirmation (if any) a Start needs right now. Pure/synchronous so the click handler can
  // decide BEFORE window.open is called, without any await.
  function startGuard() {
    if (state === "starting" || state === "closing") return "busy";
    if (knowledge === "active") return "replace-active";
    if (knowledge === "inactive") return "none";
    if (knowledge === "unchecked" && !requireKnownStatus) return state === "active" ? "replace-active" : "none";
    return "status-unknown"; // checking | unavailable | (unchecked while a known status is required)
  }

  function view() {
    if (state === "starting") return "starting";
    if (state === "closing") return "closing";
    switch (knowledge) {
      case "checking": return "loading";
      case "active": return "active";
      case "inactive": return "inactive";
      case "unavailable": return "unknown";
      default: return requireKnownStatus ? "unknown" : state === "active" ? "active" : "inactive";
    }
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
        // The server accepted the Start, so a new grant may now exist that this page holds no way
        // to open — the server-side truth is unknown until re-queried.
        state = "idle";
        knowledge = "unavailable";
        return { ok: false, code: "INVALID_BOOTSTRAP_URL", message: classroomErrorMessage("INVALID_BOOTSTRAP_URL"), recheckStatus: true };
      }

      projectionSessionId = newProjectionSessionId;
      state = "active";
      knowledge = "active";
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
      const code = err.classroomCode || "NETWORK";
      // GATE 5F.D2.F1 — a NETWORK failure is ambiguous (the request may have reached the server
      // and succeeded); any other code is a definitive rejection that left the server untouched.
      // GATE 5F.D2.G13B: this includes INVALID_EPOCH — thrown inside the transaction's read phase,
      // before any tx.set/tx.update is staged (verified against projections.mjs), so it is exactly
      // as definitive as SESSION_DELETED/FORBIDDEN/etc. and needs no special-case here.
      const ambiguous = code === "NETWORK";
      const prev = startBaseline;
      state = prev.state === "active" ? "active" : "idle";
      knowledge = ambiguous || prev.knowledge === "checking" ? "unavailable" : prev.knowledge;
      const result = { ok: false, code, message: classroomErrorMessage(code) };
      if (ambiguous) result.recheckStatus = true;
      return result;
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
    /** What this controller knows about the server-side grant: unchecked | checking | active |
     * inactive | unavailable. "checking" and "unavailable" mean UNKNOWN, never inactive. */
    getStatusKnowledge: () => knowledge,
    /** UI view model: starting | closing | loading | active | inactive | unknown. */
    getView: () => view(),
    /** Confirmation a Start needs right now: none | replace-active | status-unknown | busy. */
    getStartGuard: () => startGuard(),

    /**
     * GATE 5F.D2.F1 — read-only recovery of the server-side grant state via POST
     * /projections/status. Never mutates server state. Resolves { ok:true, active } when the
     * response was applied, { ok:true, stale:true } when a newer operation (or dispose) made it
     * obsolete and it was discarded, { ok:true, skipped:true } while a Start/Close is in flight
     * (that operation's own confirmed result defines the state), or { ok:false, code, message }
     * when the status could not be determined — in which case knowledge becomes "unavailable"
     * (UNKNOWN), never inactive.
     */
    async checkStatus(session) {
      if (disposed) return { ok: false, stale: true };
      if (!bind(session)) return sessionMismatch();
      if (state === "starting" || state === "closing") return { ok: true, skipped: true };
      const myEpoch = ++epoch;
      knowledge = "checking";
      let parsed = null;
      let code = "STATUS_UNAVAILABLE";
      try {
        parsed = parseStatusResponse(await requestStatus(session.id));
        if (!parsed) code = "STATUS_UNEXPECTED";
      } catch (err) {
        code = err.classroomCode || "STATUS_UNAVAILABLE";
      }
      if (disposed || myEpoch !== epoch) return { ok: true, stale: true };
      if (!parsed) {
        knowledge = "unavailable";
        return { ok: false, code, message: classroomErrorMessage("STATUS_UNAVAILABLE") };
      }
      if (parsed.active) {
        knowledge = "active";
        state = "active";
      } else {
        knowledge = "inactive";
        state = "idle";
        projectionSessionId = null;
      }
      return { ok: true, active: parsed.active };
    },

    /** Marks this controller finished (dashboard left/replaced): every in-flight status response
     * is discarded from now on. */
    dispose() {
      disposed = true;
      epoch++;
    },

    /**
     * GATE 5F.C Part G/I/L. `confirmed` must be explicitly true to restart an already-active
     * projection (Part L) — the caller owns showing that confirmation (e.g. native confirm()),
     * matching this codebase's existing convention; this function never prompts itself.
     * GATE 5F.D2.F1: the same confirmation is required whenever the server-side state is UNKNOWN
     * (checking / status failed) and this controller was built with requireKnownStatus.
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
      if (disposed) return Promise.resolve({ ok: false, code: "DISPOSED", message: classroomErrorMessage("DISPOSED") });
      if (!bind(session)) return Promise.resolve(sessionMismatch());
      const guard = startGuard();
      if (guard === "busy") return Promise.resolve({ ok: false, code: "BUSY", message: classroomErrorMessage("BUSY") });
      if (guard === "replace-active" && !confirmed) {
        return Promise.resolve({ ok: false, needsConfirmation: true });
      }
      if (guard === "status-unknown" && !confirmed) {
        return Promise.resolve({ ok: false, needsConfirmation: true, reason: "STATUS_UNKNOWN" });
      }
      // GATE 5F.C Part G step 2/9 — window.open() is the FIRST thing this function does, with NO
      // preceding await, so it runs synchronously within the caller's trusted click-event call
      // stack regardless of state becoming an async function here.
      const win = windowOpenImpl("about:blank", "_blank");
      if (!win) {
        return Promise.resolve({ ok: false, code: "POPUP_BLOCKED", message: classroomErrorMessage("POPUP_BLOCKED"), popupBlocked: true });
      }
      startBaseline = { state, knowledge };
      epoch++; // any status response still in flight is now obsolete
      state = "starting";
      const idempotencyKey = generateIdempotencyKey(randomUUID);
      inFlightStartPromise = doStart(session, win, idempotencyKey);
      return inFlightStartPromise;
    },

    async close(session) {
      if (state === "closing") return { ok: false, code: "NETWORK", message: classroomErrorMessage("NETWORK") };
      if (disposed) return { ok: false, code: "DISPOSED", message: classroomErrorMessage("DISPOSED") };
      if (!bind(session)) return sessionMismatch();
      if (state === "starting") return { ok: false, code: "BUSY", message: classroomErrorMessage("BUSY") };
      const prev = { state, knowledge };
      epoch++; // any status response still in flight is now obsolete
      state = "closing";
      const body = buildCloseRequestBody({ knowledgeSessionId: session.id });
      const attemptClose = (forceRefresh) => getIdToken({ forceRefresh }).then((idToken) => postJson("/projections/close", idToken, body));

      // GATE 5F.D2.POST-2 — exactly one forced-refresh retry, and only for UNAUTHENTICATED (a
      // locally-detected empty/missing token, or the backend's own 401 — postJson already surfaces
      // the backend's error.code as classroomCode, so both converge on the same branch here). Close
      // is idempotent (a successful response, closed true OR false, means no active grant remains)
      // and this failure mode is provably pre-write (the backend's authenticate() throws before
      // closeProjection()'s own logic ever runs — Gate 5F.D2.POST-1A), so retrying is always safe.
      // Never retried for 403/409/5xx/NETWORK/etc. — this is not a blanket retry-on-any-error policy.
      let result;
      let finalErr = null;
      try {
        result = await attemptClose(false);
      } catch (err) {
        if (err.classroomCode === "UNAUTHENTICATED") {
          try {
            result = await attemptClose(true);
          } catch (err2) {
            finalErr = err2;
          }
        } else {
          finalErr = err;
        }
      }

      if (!finalErr) {
        // Close is idempotent: a successful response (closed true OR false) means no active grant
        // remains for this session — that confirmed result defines the state.
        projectionSessionId = null;
        state = "idle";
        knowledge = "inactive";
        return { ok: true, closed: !!result.closed };
      }

      // Close failing (even after the one allowed retry) does not silently pretend the projection
      // ended — the state before the attempt is restored, so the lecturer can see Close is still
      // needed and retry.
      state = prev.state === "active" ? "active" : "idle";
      knowledge = prev.knowledge === "checking" ? "unavailable" : prev.knowledge;
      const code = finalErr.classroomCode || "NETWORK";
      const closeResult = { ok: false, code, message: classroomErrorMessage(code) };
      // GATE 5F.D2.POST-2 — recheck Status only when the FINAL failure isn't itself an auth
      // failure: re-checking with auth we've already proven broken (after the one allowed retry)
      // would just fail the same way again, for no benefit.
      if (code !== "UNAUTHENTICATED") closeResult.recheckStatus = true;
      return closeResult;
    },
  };
}
