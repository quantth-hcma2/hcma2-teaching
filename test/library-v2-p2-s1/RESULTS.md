# Library V2 - P2-S1 (Organization Firestore Rules Foundation) - candidate test results

Candidate branch `candidate/library-v2-p2-s1-org-rules`, based on production `origin/main` `bd69d011761fc38bff79374bc73e71ef8818c433`. Rules-only slice: one additive region in `firestore.rules.production-candidate` (three new collections + helper functions). No UI, index, Storage, data-model, vendor or dependency change. Nothing is deployed.

## New suites (Firestore emulator, `demo-` projects, synthetic data only)
Run (Java 21 on PATH):
`firebase emulators:exec --only firestore --project demo-p2s1 --config test/library-v2-p2-s1/firebase.json "node --test test/library-v2-p2-s1/rules.test.mjs test/library-v2-p2-s1/budget.test.mjs test/library-v2-p2-s1/regression.test.mjs"`

- `rules.test.mjs` 14/14 - authorization matrix (same-organization allow, cross-organization deny, independent platform suspension with an active membership, suspended/removed membership, archived organization, multiple memberships, capability contract, capability self-grant denial, Organization Admin cannot add/appoint/change/remove admins or discover platform users, organization/membership shape and immutability, query discipline, anonymous/unrelated principals, default deny, unchanged `users` self-update finding).
- `budget.test.mjs` 6/6 - document-access budget for the real helper composition (400-membership batch, 400-status-update batch, member lists, capability batch limits, headroom probes of every helper).
- `regression.test.mjs` 4/4 + differential - candidate Rules minus the single region are byte-identical to production (SHA-256 `218BFF3B...C3880F`); region hygiene; byte pins for indexes, UI, package, vendor; 65 operations over every pre-existing collection family give identical outcomes on baseline and candidate Rules (39 allow / 26 deny); new collections are denied by the baseline, later-phase collections stay denied.

Total new tests: 24/24 pass.

## Existing emulator Rules suites, A/B (baseline `bd69d01` vs candidate)
20 `run-emulator-tests.mjs` suites (gate1b1, 1b2a, 1b2b, 1b2c, 1b3c1, 1b3c2, 1b3d1, 1b3d2, gate-e2, gate-e6, gate2as, gate2a-auth-i1, i2, i2-correction, i3, i3-ui-fix, gate2b-rt-rules, rt-preprod, rt-fix1, gate3c-fix1): 444 tests; baseline 421 pass / 23 fail, candidate 421 pass / 23 fail; exit codes, counts and failing test names identical in all 20 suites (the 23 failures are pre-existing and identical).

## Budget observations (emulator, 2026-10-02)
Every distinct `get()` or `exists()` call on a path counts toward the limit (10 per request, about 20 per batched write); repeated calls to the same document/call type are cached. Helper composition (calls used of 10): `hasOrgCap` 2 (Platform Admin) / 4 (Organization Admin) / 5 (member with capability); `canContribute` 5-6; `isActiveOrgMember` 3; `orgGoverns` 2-3; `mayWriteOrg` 2-4. Bulk: 400 memberships created by Platform Admin in one batch pass; 400 status updates by Organization Admin in one batch pass; capability batches (one target-membership read per write): Organization Admin 16, Platform Admin 18 largest passing batch (use chunks of 10 or fewer); lists of 100/443 members pass.
