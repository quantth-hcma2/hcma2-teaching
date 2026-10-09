# P4-S3 - Template Center & Import Center (UI / PREVIEW) - RESULTS

Baseline: `61ce3061c8b2cf6a52eb7c9517640632cc60e463` (P4-S2 closed). Branch `candidate/library-v2-p4-s3-import-center-ui`. **Read-only slice: no Firestore/Storage write, no Rules/index/Storage change, no deployment, no push.**
Includes the Architect's FINAL REVIEW CORRECTION (A authorization, B two templates, C framework code, D integration stability) on top of candidate `962ca65`.

## Suites (focused; broad historical suites not rerun)
| Suite | Result | Run |
|---|---|---|
| `source-guard.test.mjs` (scope, pins, edit pairs, template definition, read-only, confirm disabled, wiring, access vocabulary) | 8/8 | `node --test test/library-v2-p4-s3/source-guard.test.mjs` |
| `view.unit.test.mjs` | 10/10 | `node --test test/library-v2-p4-s3/view.unit.test.mjs` |
| `access.unit.test.mjs` (authorization matrix, own-document reads, mount behaviour, fail-closed) | 3/3 | `node --test test/library-v2-p4-s3/access.unit.test.mjs` |
| `access.rules.test.mjs` (PARITY with the production Rules on the emulator: 19 principals x 3 organizations = 57 pairs, allowed == mayReadCurriculum, canPrepare == mayWriteCurriculum) | 2/2 | `firebase emulators:exec --only firestore --project demo-p4s3-access --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s3/access.rules.test.mjs"` (Java 21) |
| `template.test.mjs` (generate -> re-import through the P4-S2 validator) | 7/7 | `node --test test/library-v2-p4-s3/template.test.mjs` |
| `contract.test.mjs` (two templates share the frozen schema identical to 61ce306; framework code unsupported by the P3 schema; preview wording) | 4/4 | `node --test test/library-v2-p4-s3/contract.test.mjs` |
| `controller.e2e.mjs` (real Edge, real engine + module Worker + SheetJS 0.20.3; includes the browser ACCESS MATRIX and access-check retry) | 20/20 | `node test/library-v2-p4-s3/controller.e2e.mjs` |
| `integration.e2e.mjs` (real index.html, Auth+Firestore emulators, production Rules candidate) | 9/9, **6 consecutive runs** | `node test/library-v2-p4-s3/integration.e2e.mjs` (Java 21 on PATH) |

## Directly affected older guards (pure)
P2-S2/S3/S4, P3-S3/S4/S5 and P4-S2 source guards: pass together with the P4-S3 pure suites (83/83 in one run). index.html, curriculum-admin-view.mjs and organization-admin-view.mjs are unchanged by the final correction, so `p4s3-edits.mjs` is unchanged.

## Earlier focused regression (candidate 962ca65; code paths untouched since)
P4-S2 emulator plan test 9/9; P3-S1/S2 and P4-S1 Rules suites 38/38; P3-S3/S4/S5 controller e2e 24/24, 29/29, 16/16.

## Integration flake - root cause and fix (final correction D)
Cause: after login the Admin lands on `adminOverview`, which finishes asynchronously. The test navigated to the Organization screen first; the overview's late write then threw (`#ovGrid` gone) and its `catch` replaced the container with an error block, wiping the Organization screen (`#orgCreateBtn` never appeared). Fix in the TEST only: `login()` now waits for a deterministic readiness condition (`#ovGrid .stat` present and `#ovPending` no longer "Đang tải…") before the first navigation. No sleep, no production UI change. Result: 6/6 consecutive full passes (before the fix: 2 failures in 4 runs).

## Alignment of historical guards
Files edited by this slice that older slices byte-pinned (index.html, curriculum-admin-view.mjs, organization-admin-view.mjs) are covered by `p4s3-edits.mjs` (exact edit pairs generated from `git diff -U0`; reversal restores the 61ce306 bytes), the same mechanism used by P3-S4/S5. Older guards reverse the P4-S3 edits before their original assertions. `p4-s2/source-guard` became a frozen-bytes guard vs 61ce306.
