# GATE P3 — Staged Authenticated E2E (Teaching side)

Status: PASS / CLOSED (owner-reviewed, 2026-10-01). Full technical closeout, traffic/digest state, and the Firestore Rules anomaly are recorded in the Classroom repo at `docs/GATE-P3-STAGED-AUTH-E2E-CLOSEOUT.md` (repo `hcma2-classroom-projection`) — this file records the Teaching-side facts only.

## Lineage (source SHA, both already on Teaching `main`)
- `a447b85` — GATE P3S-I: admin-only `🧪 STAGING TEST (chỉ Admin)` control + `startStagingProjection()` in `classroom-projection-launch.mjs`, deliberately isolated from `createClassroomLaunchController`'s own state machine.
- `9d57aa2` — GATE P3S-FIX1: added `STAGING_API_ORIGIN` constant; `startStagingProjection()` now defaults its request origin to it instead of `CLASSROOM_ORIGIN`. Fixes a CORS-preflight 404 that otherwise silently blocked the real POST from ever reaching the staging Cloud Run tag. `CLASSROOM_ORIGIN` and all normal Start/Status/Close call sites are untouched.

Teaching `main` is current with both commits — no outstanding branch-vs-main gap on this side (unlike Classroom, where the P3S lineage lives only on a feature branch; see the Classroom doc for that detail).

## Known UI note (not a bug, no fix needed)
After a staging Start, the `createClassroomLaunchController` dashboard does not show "ĐÓNG TRÌNH CHIẾU" until the page is reloaded — `startStagingProjection()` intentionally never touches the controller's state, and the controller only calls `refreshClassroomStatus()` once per mount. A reload reveals the real Close button because it reads the same underlying Firestore record. Confirmed working end-to-end by the owner during P3.

## Scope unchanged in P3
No application code changed on this side beyond `a447b85`/`9d57aa2` (already merged before this closeout). No Firestore Rules changes. No protected session (`9dv8xHfIDmORIOszpylH` / `3ZQ7YU`) or real student data accessed.
