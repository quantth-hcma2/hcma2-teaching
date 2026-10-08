# Library V2 - P4-S1 (import-batch Rules foundation) - candidate test results

Candidate branch `candidate/library-v2-p4-s1-import-batch-rules` on top of `4a017ede0ebefe5fbc2bd37f1b6ec636f6f8708c` (the released P3 source; `origin/main` unchanged). **Rules-only slice; local candidate; NOT deployed, NOT pushed.**
Authority: P4 Design R2 (Architect-approved and frozen; decisions D1-D16 approved).

## What changed (production-relevant: exactly one file)
`firestore.rules.production-candidate`: SHA-256 **`7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485`** (LF, 2303 lines) vs the deployed P3-S1 artifact `A0B206FC...921D` (2206 lines): **+99 lines, -2 lines**, in three places only:
1. P3 framework CREATE rule (D14): when `cloneSource` is present the clone source must satisfy `importAllowsActivation(source, organization)` (one condition).
2. P3 framework UPDATE rule: a `draft -> active` transition must satisfy `importAllowsActivation(fwId, organization)` (one condition).
3. New additive region `LIBRARY V2 P4-S1 (IMPORT BATCHES)` after the P3 region: helpers `importPath`, `importAllowsActivation`, `importIntIn` and `match /importBatches/{batchId}` (shape, immutables, transitions, witnesses, no delete).
Byte proof: candidate minus the P4 region with the two clause edits reversed == the deployed P3-S1 Rules byte for byte (SHA-256 `A0B206FC...921D`, ruleset 5945fbe7). `firestore.indexes.json` (`A27B5A20...4D51`), Storage (no rules file; live ruleset af1b9c8c), package files, web modules and every other file: byte-identical to 4a017ed.

## New tests (23, all pass)
- `import-batch.rules.test.mjs` 15 (emulator, exact candidate Rules): create matrix (3 writers accepted; 10 non-writer principals, anonymous, unauthenticated, forged importer denied); PAIRED ID (batch denied when a same-id framework exists in any state/organization; framework creatable after its batch; batch never recreatable); exhaustive schema rejection (36 deviations + pairing mismatch, missing key, non-server timestamp); organization boundary and archived organization (governance read survives, writes denied for everyone incl. the Platform Admin); read/list matrix (organization-filtered lists, unfiltered denied, other organizations denied); immutability of every identity/plan field; no delete in any status for anyone; status transition matrix; COMPLETED witness matrix (framework missing/foreign/active/archived/activatedAt, witness missing/foreign/wrong id, chunksDone != chunksTotal, non-writers, archived organization, terminal afterwards); ROLLED_BACK witness matrix (framework or witness remaining, committing and partial sources, terminal); authoritative activation protection (manual frameworks unaffected for all writers; committing/partial/rolled_back imports denied; completed allowed; organization mismatch and wrong kind denied; rename/archive/restore unaffected); D14 clone laundering (ordinary and completed-import sources clone; non-completed, cross-organization-batch and wrong-kind sources denied; unchanged P3 protections; the clone is an unpaired normal framework); deletion of never-activated imported drafts in every batch state with the batch surviving, activated imports never deletable, spent-id fail-closed; P3 lifecycle compatibility on manual frameworks for the three writers; pre-existing P3 documents unaffected.
- `budget.test.mjs` 2 (emulator, probe rules): distinct get/exists calls per guard; 400-node create/update/delete batches into an import-governed draft pass for the three writers.
- `regression.test.mjs` 6 (pure): byte-level proof against the deployed artifact; P4 region is a pure insertion before default-deny; region hygiene (only `importBatches`, 9 new helpers, no collision, delete false, no users access, no `importBatchId` key); guarantee-boundary statements present and no completeness/uniqueness expression; H2 not introduced (candidate minus P3+P4 regions == deployed P2 Rules `7EA5D7A5...`); `firestore.indexes.json`/Storage/package untouched.
- Mutation sanity: removing the activation clause, the clone clause, or the `!exists(framework)` batch-create guard each makes the corresponding tests fail (3/3 detected), then restored.

## Access-call (document-read) budget, measured (limit 10 distinct get/exists per request; headroom = 10 - used)
| Guard | Platform Admin | Organization Admin | Capability holder |
|---|---|---|---|
| batch create (`exists(framework)` + write guard) | 4 | 5 | 6 |
| activation of a MANUAL framework (+1 `exists`) | 4 | 5 | 6 |
| activation of an IMPORTED framework (`exists` + `get`) | 5 | 6 | 7 |
| completion (framework `get` + witness node `get`) | 5 | 6 | 7 |
| rollback (`exists` framework + `exists` witness) | 5 | 6 | 7 |
| clone from an import-governed source (source `get` + `exists` + `get` batch) | 6 | 7 | **8** (worst case, margin 2) |
| batch read | 2 | 3 | 5 |
All within the limit with a margin of at least 2 calls (asserted by the test). Node rules do not read the batch, so the 400-write chunk budget proven in P3-S1/S5 is unchanged.

## Historical regression on the candidate (Java 21)
P3-S1 rules+budget+regression 28/28, P3-S2 contract 10/10, P3-S5 clone/delete Rules 9/9, P2-S1 24/24, P2-S2 11/11, P2-S4 12/12, O1 6/6, O2 7/7; pure source guards + unit suites 214/214; real-app integration (real `index.html`, emulators, candidate Rules): P3-S3 14/14, P3-S4 13/13, P3-S5 9/9 (activation, clone and delete-draft of manual frameworks through the UI under the new Rules). Production-service compile check (`firebase deploy --only firestore:rules --dry-run`, validation only): compiled successfully; 5 warnings, all pre-existing (lines 1953-1955, P2 `canContribute`); none in the P3/P4 regions.

## Pin alignment (necessarily changed by a Rules change; no assertion loosened)
- 16 test files pinned the exact SHA of the Rules artifact (precedent: P3-S1 re-pinned the P2 pins): re-pinned to the candidate by `repin-rules.mjs` (P1/P2-S2/S3/S4/O1/O2/P3-S2/S3/S4/S5 source guards, five Rules suites); the historical suites now run against - and therefore prove compatibility with - the candidate.
- `test/library-v2-p3-s1/helpers.mjs`: `baselineRules` also strips the P4-S1 region (+ `p4Region`, markers). P3-S1 `regression.test.mjs`: the insertion proof excludes the separate P4 region; `rules.test.mjs` and the P3-S1/P2-S1 default-deny assertions no longer list `importBatches` (intentionally opened by P4-S1, covered by this suite). P2-S1 `regression.test.mjs`: baseline strips the P4 region.

## Not claimed (Rules vs controller boundary)
Rules guarantee: pairing, batch shape/identity/transitions, active-organization writes, no delete, the activation and clone protections, completed/rolled_back witnesses. **Controller read-back verification (P4-S4), NOT Rules:** all planned nodes exist, node counts, canonical code uniqueness, hierarchy completeness, sibling order, equality with the import plan. `finalNodeId` is a finite witness, not proof of completeness.

## Addendum - Final security gate, Google validation and production release (2026-10-08)
- Atomic-write security gate (`atomic.rules.test.mjs`, 10 tests, all pass): no ordering inside one atomic batch bypasses paired-ID governance (exists()/get() read pre-commit state; the candidate uses no existsAfter()/getAfter() in the curriculum/import region). Accepted trust-boundary limitation: an authorized writer can complete a batch with only the witness node present - complete node verification is the P4-S4 controller's duty.
- Google `projects.test` validation (`google-validation/`): 92/92 as expected; no expression-limit error; capability-holder `completed` is the thinnest path (headroom 3 minimal predicates; Platform Admin 12, Org Admin 4) - emulator and Google agree. MANDATORY retest of the headroom on any future change to the relevant Rules (see `google-validation/README.md`).
- Production release: ruleset `0b6910c3-c2d0-428e-8e88-8b7b3846ac96` = SHA `7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485`, deployed 2026-10-08T03:50Z (Rules-only); Storage, indexes, web and data unchanged.
