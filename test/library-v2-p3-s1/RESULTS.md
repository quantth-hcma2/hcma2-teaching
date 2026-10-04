# Library V2 - P3-S1 (curriculum Firestore Rules foundation) - candidate test results

Candidate branch `candidate/library-v2-p3-s1-curriculum-rules`, based on production `main` `bb1a0aeb09955fef452584409a51496e748d9b6d`. Rules-only slice: one additive region (139 lines, 0 deletions) in `firestore.rules.production-candidate`. No UI, pure module, index, Storage, data-model, vendor or dependency change. Nothing is deployed.

Run (Java 21 on PATH; port 8451):
`firebase emulators:exec --only firestore --project demo-p3s1 --config test/library-v2-p3-s1/firebase.json "node --test test/library-v2-p3-s1/rules.test.mjs test/library-v2-p3-s1/budget.test.mjs test/library-v2-p3-s1/regression.test.mjs"`
Compile check: same command with `"node test/library-v2-p3-s1/compile-check.mjs"`.

- `rules.test.mjs` 17/17 - authorization matrix, framework create/update/lifecycle/delete, node create/update/delete, node-shape facts, capability semantics, independent platform suspension, default deny.
- `budget.test.mjs` 5/5 - 400-write batches (create/update/delete), atomic rejection, full-tree load, headroom (Platform Admin node write 4 of 10; worst case capability holder 6).
- `regression.test.mjs` 6/6 - candidate minus the P3 region == deployed SHA 7EA5D7A5...; P2-S1 region byte-identical; hygiene; byte pins; differential 65 V1 + 39 P2 operations identical on baseline and candidate; default-deny.
- `compile-check.mjs` - baseline 0 errors / 10 warnings, candidate 0 errors / 5 warnings, 0 warnings inside the P3 region.

Total new: 28 tests PASS + compile check.

Existing suites, A/B (base tree `bb1a0ae` vs candidate tree):
- 20 legacy `run-emulator-tests.mjs` suites: 444 tests; base 425 pass / 19 fail, candidate 425 pass / 19 fail; exit codes, per-suite counts and failing test names identical (pre-existing failures).
- P2-S1 `rules` 14/14 and `budget` 6/6 pass on the candidate (incl. the existing archived-organization Platform Admin governance assertions). P2-S1 `regression`: 2 assertions fail by construction (production-hash text proof; default-deny list containing curriculumFrameworks) - successors are in this directory.
- S2 `contract.rules`, S4 `membership.rules`, O1 `search.rules`, O2 `enrollment.rules` (36 tests): 36/36 on the base tree; on the candidate they stop at their whole-file artifact-hash pin by design; with only that line neutralized in a scratch copy: 36/36.
No existing test file was modified.
