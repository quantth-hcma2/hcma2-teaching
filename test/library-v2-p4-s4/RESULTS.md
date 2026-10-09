# P4-S4 - Import Commit, Recovery & Activation Eligibility - RESULTS

Baseline: `6a05411f278c4ff925e30910ae92ce03df9500c7` (P4-S3 closed). Branch `candidate/library-v2-p4-s4-import-commit`. **Local / emulator only: no production import, no deployment, no Rules / index / Storage change, no push.** The deployed production Rules (ruleset `0b6910c3`, SHA-256 `7F7C790E...0485`) are used unmodified.

## Suites (focused)
| Suite | Result | Run |
|---|---|---|
| `verify.unit.test.mjs` (full read-back verification: exact / missing / extra / altered fields / structure / identity / plan integrity / error classes) | 9/9 | `node --test test/library-v2-p4-s4/verify.unit.test.mjs` |
| `run-helpers.unit.test.mjs` (Vietnamese confirm / progress / success / stop / recovery / rollback markup) | 7/7 | `node --test test/library-v2-p4-s4/run-helpers.unit.test.mjs` |
| `source-guard.test.mjs` (scope, pins, index edit pairs, collections, no-cheating, chunk caps, UI gating) | 7/7 | `node --test test/library-v2-p4-s4/source-guard.test.mjs` |
| `controller.rules.test.mjs` (REAL controller vs PRODUCTION Rules, emulator) | 23/23 | `firebase emulators:exec --only firestore --project demo-p4s4 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s4/controller.rules.test.mjs"` (Java 21) |
| `progress-atomic.probe.test.mjs` (399 nodes + 1 progress write in one atomic commit vs the Rules) | 4/4 | same emulator command |
| `ui.e2e.mjs` (real Edge, real engine + Worker, scriptable fake controller; 15 UI scenarios) | 15/15 | `node test/library-v2-p4-s4/ui.e2e.mjs` |
| `integration.e2e.mjs` (REAL index.html + REAL controller + Auth/Firestore emulators + production Rules; 8 scenarios incl. 5000-node refresh recovery, offline at read-back, rollback) | 8/8 | `node test/library-v2-p4-s4/integration.e2e.mjs` (Java 21 on PATH) |

## controller.rules.test.mjs coverage (all against the production Rules)
Commit by Platform Admin / Organization Admin / `curriculum.manage` holder (63 nodes, completed, activation then allowed through the P3 lifecycle); unauthorized principals (plain member, other capability, no membership, suspended/removed member, suspended account) write nothing - refused by the pre-write check AND by the Rules when the check is bypassed; archived organization (admin, org admin, capability holder); cross-organization (plan/org mismatch, other org admin cannot commit / roll back / abandon); transient failure retried; AMBIGUOUS commit (reached the server, client saw an error) found by the chunk probe; persistent network failure -> `paused` with the batch still `committing`, new controller resumes (browser refresh); hung write (offline queue) times out and is retried; partial, non-chunk-aligned data reconciled (only missing nodes written); interrupted import found by `findIncomplete`, only the SAME file matches; duplicate execution (two concurrent commits end with one exact dataset; a new import is blocked while one is incomplete); VERIFICATION failures: missing node (repairable by resume), extra node (-> `partial`), altered name / order / duplicate canonical code (-> `partial`); proof that the Rules alone accept `completed` with a missing middle node and that the controller refuses to get there; activation denied while `committing`/`partial`, allowed once `completed`; clone laundering denied for committing / partial / rolled_back sources, allowed for completed; rollback from committing / partial / batch-only (nodes -> framework -> `rolled_back`, batch kept, unrelated framework untouched, repeat is a no-op); completed batches are not rolled back; interrupted rollback resumes; **5,000-node maximum: 13 chunks (peak 400 writes per atomic commit), full read-back of every node, completed, activation eligible (45 s on the emulator); same-size rollback (22 s).**

## Regression (focused, directly affected only)
- P4-S3: pure suites (view unit 10, access unit 3, template 7, contract 4, source guard 8) pass; controller e2e 20/20; **integration e2e 9/9 on the S4 wiring** (read-only flow: Firestore snapshot unchanged); access parity on the emulator 2/2.
- P4-S2: pure suites pass; plan.rules.test 9/9 on the emulator.
- P3 UI on the S4 wiring: P3-S4 integration 13/13, P3-S5 integration 9/9.
- Older source guards aligned with the P4-S4 index.html edits (p2-s2/s3/s4, p3-s2..s5, p4-s2, p4-s3): pass. Three older guards (`library-v2-p1` dynamic-import count, two `o1-search` pins) were ALREADY failing at the baseline `6a05411`; unchanged by this slice.

## Alignment of historical guards
`index.html` is the only pinned file edited. The five edits are pinned as pairs in `p4s4-edits.mjs` (generated from `git diff -U0`; reversal restores the 6a05411 bytes and is idempotent); the P4-S3 chain (`p4s3-edits.mjs`) now starts with the P4-S4 reversal and the guards that read index.html directly read it through the reversal. One S3 integration assertion (disabled placeholder) was updated to the S4 confirm card; the S3 flow never acknowledges or clicks it.
