# P4-S5-B — Audit events, duplicate-file warning and emulator Owner QA — RESULTS

Baseline: production web `c6c66edda294d30fca9db6fb19ea8afecbef782b` (P4-S4 closed); production Rules ruleset `02ca5a30-1d1c-4b2f-9666-5487ca7f8783`, SHA-256 `F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A` (byte-identical to `firestore.rules.production-candidate`, pinned). **Local / emulator only: no Rules, index, Storage or dependency change; no production write; no push, deploy or real import.** Branch `candidate/library-v2-p4-s5b-audit-duplicate`.

## What changed (production files)
| File | Change |
|---|---|
| `import-audit.mjs` (new) | pure module: `buildImportAuditEvent` (refuses unless the CONFIRMED batch justifies the event), `createImportAudit().record()` (setDoc on the deterministic id `import_{batchId}_{completed|rolledBack|partial}`, server-ack + read-back verification, never throws), states `recorded / already / unverified / failed` |
| `import-commit-controller.mjs` | `findCompletedBySourceHash` (3 equality filters, limit 11, `ok:false` = unknown); verification failure returns the server-CONFIRMED partial `batch`; `LOOKUP_TIMEOUT_MS`, `DUPLICATE_*` constants |
| `import-center-view.mjs` | injected `auditTools`; `checkDuplicate`, `recordAudit`, `auditConfirmed`; confirmation gated on an unknown/pending duplicate check; retry actions (`dup-retry`, `audit-retry`) |
| `import-run-helpers.mjs` | duplicate card (found / checking / none / unavailable + second acknowledgement), audit status line + GHI LẠI NHẬT KÝ |
| `import-center-engine.mjs` | re-exports the audit module; cache tokens `?v=20261014-p5b` on the changed lazy modules |
| `index.html` | 3 pinned edits: view token, engine token, one injected `auditTools` (doc, setDoc, getDocFromServer, serverTimestamp). `logAudit` untouched |

## Suites (all on the candidate tree)
| Suite | Result |
|---|---|
| `import-audit.unit.test.mjs` (builder, no-false-audit matrix, record states, idempotency, concurrent, denial, lost acknowledgement, hang, mismatch, never-throws) | 13/13 |
| `audit.rules.test.mjs` (live Rules bytes; real controller + real audit: persistence/fields for Platform Admin / Organization Admin / capability holder, idempotent retry, immutability, 3 concurrent clients, forged actor + anonymous denied, interruption before the audit write, audit failure after a successful import, rollback barrier ≠ partial, partial from a confirmed verification failure, non-confirmed outcomes) | 12/12 |
| `duplicate.rules.test.mjs` (live Rules: only `completed` counts, 70 mixed-status batches + limit, 15 completed > limit, organization isolation, authorization matrix, unknown ≠ none, query shape) | 7/7 |
| `ui.e2e.mjs` (real Edge, real view/engine/audit module, fake controller): duplicate found / pending / unavailable / throwing / stale / resume, audit completed / failure / failed / already / rolledBack / partial / silent cases, no-audit-tools, 375 px, no network writes | 15/15 |
| `integration.e2e.mjs` (REAL index.html + REAL controller + REAL audit on Auth/Firestore emulators with the live Rules): audit entry fields, duplicate warning after a real completed import, re-import creates a NEW batch with its own entry, rollback of an interrupted import (one `rolledBack`, no `partial`), rolled_back does not warn/block, altered node → resume → durable `partial` (one entry) → rollback (one entry), Nhật ký hoạt động screen | 6/6 |
| `source-guard.test.mjs` (S5 scope: only the approved files, Rules/indexes/package/V1/P2–P4 modules byte-pinned, 3 index edit pairs, audit module purity, 3 confirmed emission points, duplicate query shape, launcher safety) | 7/7 |
| `qa-env.mjs --self-test` + full launcher drive with a real browser (login, import, audit, duplicate card, helper endpoints) | PASS |

## Existing P4-S4 behaviour (regression)
controller.rules 23/23, freeze 4/4, concurrency 7/7, compat 2/2, P3 differential 714 operations identical (S4 `source-guard` 11/11 after alignment); S4 `ui.e2e` 16/16 and S4 `integration.e2e` 9/9 on the S5 page; P4-S3 `controller.e2e` 20/20; library-v2 lineage source guards + units: 182/185 — the 3 failures (`library-v2-p1` dynamic-import count, two `o1-search` pins) are identical on the production baseline (pre-existing). The S4 UI fixtures (`harness.html`, `ui.e2e.mjs`) gained the duplicate lookup in the fake controller / a wait for it to settle.

## Rules / index compatibility
No Rules change (SHA pinned to the live artifact). Audit: the existing `auditLogs` rule (`actorId == auth.uid`, `createdAt == request.time`, update/delete false) admits the deterministic-id create and refuses any rewrite — proven by the live-bytes emulator suites and the S5-A probe 11/11. Duplicate lookup: equality filters only; list rule satisfied for Platform Admin / Organization Admin / `curriculum.manage` holder, denied otherwise. **No index**: production read-only `runQuery` of the exact shape (`organizationId` + `sourceFile.sha256` + `status == completed`, limit 11) executes without an index error (`evidence/prod-index-probe-s5b.txt`); `firestore.indexes.json` untouched.

## Remaining limitations
- A crash between the durable business transition and the audit write loses the audit event (best-effort, same class as all existing audit entries); the page reports unconfirmed / failed audits and offers a retry while it stays open.
- A non-admin account cannot read `auditLogs`: its success means "server-acknowledged" (`verifiedBy server-ack`) and a refused duplicate write is `unverified`. The Import Center is Platform-Admin-only today.
- The duplicate list shows at most 5 completed imports (`more` when ≥ 11). The recent-batches history panel is NOT part of this slice.
- Combined emulator runs under heavy machine load showed one non-reproducible `paused` result in the PARTIAL audit test (passed 3/3 alone and in the final idle run).
- Only Chromium (Edge) tested.
