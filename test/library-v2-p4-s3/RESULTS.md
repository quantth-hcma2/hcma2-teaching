# P4-S3 - Template Center & Import Center (UI / PREVIEW) - RESULTS

Baseline: `61ce3061c8b2cf6a52eb7c9517640632cc60e463` (P4-S2 closed). Branch `candidate/library-v2-p4-s3-import-center-ui`. **Read-only slice: no Firestore/Storage write, no Rules/index/Storage change, no deployment, no push.**

## Suites (focused; broad historical suites not rerun)
| Suite | Result | Run |
|---|---|---|
| `source-guard.test.mjs` (scope, pins, edit pairs, template definition, read-only, confirm disabled, wiring) | 7/7 | `node --test test/library-v2-p4-s3/source-guard.test.mjs` |
| `view.unit.test.mjs` | 10/10 | `node --test test/library-v2-p4-s3/view.unit.test.mjs` |
| `template.test.mjs` (generate -> re-import through the P4-S2 validator) | 7/7 | `node --test test/library-v2-p4-s3/template.test.mjs` |
| `controller.e2e.mjs` (real Edge, real engine + module Worker + SheetJS 0.20.3) | 19/19 | `node test/library-v2-p4-s3/controller.e2e.mjs` |
| `integration.e2e.mjs` (real index.html, Auth+Firestore emulators, production Rules candidate) | 9/9 | `node test/library-v2-p4-s3/integration.e2e.mjs` (Java 21 on PATH) |

## Regression (focused)
- P4-S2: pure suites all pass (run together with the P4-S3 unit suites: 100/100 non-emulator tests) + `plan.rules.test.mjs` 9/9 under the emulator (`firebase emulators:exec ... --config test/library-v2-p3-s2/firebase.json`).
- P2-S2/S3/S4, P3-S3 (source guard + unit), P3-S4, P3-S5 source guards and P3-S1/S2 pure suites: pass (126/126 pure); P3-S1 rules/budget/regression + P3-S2 contract rules: 38/38 under the emulator.
- P3 UI: P3-S3 controller e2e 24/24, P3-S4 controller e2e 29/29, P3-S5 controller e2e 16/16.

## Known environment flake (pre-existing)
`integration.e2e.mjs` (and the unmodified P3-S5 integration) can fail on the first Organization-list load: the test clicks the nav while the Admin overview's async render is still running (`adminOverview` writes `#ovGrid` after the view was replaced). Two consecutive failures were followed by two consecutive full passes with identical code. Not caused by this slice.

## Alignment of historical guards
Files edited by this slice that older slices byte-pinned (index.html, curriculum-admin-view.mjs, organization-admin-view.mjs) are covered by `p4s3-edits.mjs` (exact edit pairs generated from `git diff -U0`; reversal restores the 61ce306 bytes), the same mechanism used by P3-S4/S5. Older guards now reverse the P4-S3 edits before their original assertions. `p4-s2/source-guard` became a frozen-bytes guard vs 61ce306.
