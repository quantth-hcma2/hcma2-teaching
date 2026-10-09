# P4-S4 - Import Commit, Recovery & Import Freeze - RESULTS

Baseline: `6a05411f278c4ff925e30910ae92ce03df9500c7` (P4-S3 closed). Design gate: `d195a5c`. **Local / emulator only: no production import, no deployment, no Rules / index / Storage deployment, no Firestore production write, no Git push.**

## Rules candidate
`firestore.rules.production-candidate`: **SHA-256 `F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A`** (+23 / -5 lines against the deployed ruleset `0b6910c3`, SHA-256 `7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485`). Exactly five approved mutation guards (framework update, framework delete, node create, node update, node delete) through five helpers `importNodeCreateOk / importNodeUpdateOk / importNodeDeleteOk / importFrameworkUpdateOk / importFrameworkDeleteOk`. No new status, field, schema or batch-rule change; reversing the edits (`deployedRules()` in `import-freeze-rules.mjs`) reproduces the deployed bytes.

## Protocol (controller, no fallback)
batch + draft framework -> deterministic node chunks (400 writes each, separate progress writes) -> **seal** (`chunksDone := chunksTotal`, only when every planned node is present) -> full server read-back verification -> plain `completed` update -> server read of the final state before success. Rollback = barrier (`committing -> partial`, `ROLLBACK_STARTED`) -> paged node deletes (<= 400) -> framework delete -> `rolled_back` (`ROLLED_BACK`); the batch is never deleted. No completion transaction, no `completionMode`, no `completed-drift`.

## P3 UI protection
`import-batch-status.mjs` (read-only, two equality queries on `importBatches`, no index) feeds the curriculum list: `committing` -> "Đang nhập dữ liệu", `partial` -> "Nhập chưa hoàn tất"; every row action disabled with a Vietnamese explanation. Ordinary rows render byte-identically.

## Suites (all on the final tree)
| Suite | Result |
|---|---|
| `controller.rules.test.mjs` (REAL controller vs freeze candidate; 5,000-node commit, resume, takeover, rollback, interrupted before and after seal) | 23/23 |
| `freeze.rules.test.mjs` (security matrix, P3 not weakened, recovery ownership, interrupted before / after seal) | 4/4 |
| `concurrency.rules.test.mjs` (resume vs rollback two-client; deployed-Rules control shows the orphan; randomized offsets; 14 post-seal mutations refused) | 7/7 |
| `incomplete-import.rules.test.mjs` (CONTROL on the deployed text: the gap) | 1/1 |
| `compat.rules.test.mjs` (controller on deployed text and on candidate) | 2/2 |
| `p3-differential.rules.test.mjs` (714 P3 operations, 17 principals, deployed vs candidate) | identical outcomes (43 allow / 671 deny) |
| `progress-atomic.probe.test.mjs` (399 nodes + 1 progress write; 400-write chunk) | 4/4 |
| `budget.rules.test.mjs` (document-access headroom) | pass (table below) |
| `rules-qualification.cjs` (Google `projects.test` evaluator, in-memory, no ruleset created) | matrix 120/120; control shows the gap on the deployed source |
| `source-guard.test.mjs` | 11/11 |
| `p3-ui.unit.test.mjs` (frozen markup, status reader) | 7/7 |
| `run-helpers.unit.test.mjs` + `verify.unit.test.mjs` | pass |
| `ui.e2e.mjs` (real Edge, scriptable controller) | 16/16 |
| `integration.e2e.mjs` (real index.html + REAL controller + Auth/Firestore emulators + candidate Rules; incl. P3 row marking committing / partial, 5,000-node refresh recovery, offline at read-back, rollback) | 9/9 |

### Expression headroom (Google evaluator; extra minimal predicates still evaluating, worst-case principal)
| Rule | deployed | candidate |
|---|---|---|
| node create (hex id, importing) | 26 | 22 |
| node update | 24 | 23 |
| node delete | 36 | 34 |
| framework update | 26 | 25 |
| framework delete | 38 | 36 |
| importBatches update (completed) - UNTOUCHED, thin | 3 | 3 |

### Document-access headroom (emulator; distinct extra probes still passing, limit 10 per request)
Ordinary framework create 4 -> 3, create 400 4 -> 3, delete 400 3 -> 2; importing node create 1 / 400: 2; partial delete 400: 1; Platform Admin create 6 -> 5 (import 4). Thinnest path (partial delete 400) keeps 1 probe of headroom: **thin, documented**; any future Rules addition on node delete needs a retest.

### 5,000-node controller run (emulator, idle)
capA 38.3 s (node writing 33.4 s, verification read 3.3 s, 13 commits, 35 reads); Platform Admin 27.5 s. Design-gate transaction variant was 40-50 s extra.

## Focused regression
- Rules suites on the candidate: P2-S2 / P2-S4 / O1 / O2 (36/36), P3-S2 contract / P3-S5 clone-delete / P4-S1 budget / P4-S2 plan / P4-S3 access (57/57 incl. P4-S1 suites). The two P4-S1 Rules suites and `regression.test.mjs` document the DEPLOYED ruleset and now run on the candidate with the freeze edits reversed (`deployedRulesText()`); the freeze itself is covered by the P4-S4 suites.
- Source guards of the Library V2 lineage + O1/O2 and unit suites: 176/179. The 3 failures (`library-v2-p1` dynamic-import count, two `o1-search` pins) fail identically on the P4-S3 baseline `6a05411` (pre-existing, not caused by this slice).
- Browser: P3-S3 / P3-S4 / P3-S5 / P4-S3 controller e2e 24/24, 29/29, 16/16, 20/20; integration e2e P4-S3 9/9, P3-S5 9/9, P3-S3 14/14, P3-S4 13/13. P3-S3 and P3-S4 integration each hit the known adminOverview first-load race once (the older tests lack the readiness wait) and passed on retry.

## Remaining limitations
- A sealed batch that is missing a node cannot be repaired (by design): durable `partial` / `VERIFY_FAILED`, rollback only.
- Rules cannot count nodes: completion integrity is the controller read-back (accepted trust boundary, unchanged).
- Document-access headroom of the thinnest freeze path is 1; importBatches update expression headroom stays 3 (unchanged).
- P3 UI refusal of edits on incomplete imports is enforced by Rules; the list marking is advisory UX and degrades to unmarked rows if the status lookup fails.
- Only Chromium (Edge) tested; unsupported browsers fail closed. Organization Admin / `curriculum.manage` entry point for the Import Center is still outstanding (entry stays Platform-Admin-only).
