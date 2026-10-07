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

Existing suites after the test-pin alignment (second commit; Rules file byte-identical to the first commit, SHA-256 a0b206fc...921d):
- Aligned pins (no neutralizing, exact hash): 6 pure source guards (library-v2-p1, p2-s2, p2-s3, p2-s4, o1-search, onboarding-o2) now pin the P3-S1 Rules SHA; the 4 Rules suites (p2-s2 contract, p2-s4 membership, o1 search, o2 enrollment) pin the exact candidate SHA. library-v2-p2-s1 regression: the pre-P2 baseline now also strips the P3 region (same 218BFF3B... proof unchanged) and the "later-phase collections stay denied" list no longer blanket-denies curriculumFrameworks - replaced by preserved denial coverage (pre-P2 baseline; anonymous, ordinary teacher and malformed Platform Admin writes under the candidate). Every other historical assertion is unchanged.
- P2-S1 rules 14, budget 6, regression 4 + S2 contract 11 + S4 membership 11 + O1 search + O2 enrollment (14 together) = 60/60 on the candidate Rules, including the existing archived-organization Platform Admin governance assertions.
- Pure suites P1/S2/S3/S4/O1/O2 (registry, unit, source guard): all pass (12 files); on the pre-alignment candidate exactly six source-guard tests failed, all on the Rules hash entry.
- New P3-S1 suites: 28/28.
- 20 legacy run-emulator-tests suites (established Rules regression set), re-run on the final candidate tree vs the base tree bb1a0ae: 444 tests, 425 pass / 19 fail on both; per-suite counts and the 17 unique failing test names identical (pre-existing failures); no changed outcome.
- Browser flow suites against the candidate Rules (real index.html, Edge, Auth+Firestore emulators): S3 16/16, S4 23/23, O2 13/13, O1 16/16 = 68/68.
- Production-service compile (Rules-only dry run, nothing deployed): 0 errors, 5 warnings, all in the pre-existing P2 region; none in the P3 region.
