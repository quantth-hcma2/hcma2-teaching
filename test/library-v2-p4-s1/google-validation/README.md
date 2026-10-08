# P4-S1 - Google Rules evaluator validation (evidence tooling)

Read-only validation of `firestore.rules.production-candidate` on Google's production Rules evaluator through `firebaserules` `projects/<project>:test`.
The endpoint evaluates in memory: it creates no ruleset and no release, touches no data, and every request/resource/`get()`/`exists()` answer is a synthetic mock.

- `lib.cjs` - harness (firebase-tools authenticated client; candidate read from this repository).
- `world.cjs` - synthetic world and case builders.
- `run.cjs` - the 92-case scenario matrix (transitions, activation, clone, batch create x principals). Expected: `TOTAL 92 pass 92 fail 0`. Writes `results.json` to the current directory.
- `headroom.cjs` - expression-headroom measurement with in-memory test-only source variants (never deployed). Writes `headroom.json`.
- `results.json`, `headroom.json` - the recorded results for the approved candidate (SHA-256 `7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485`, run 2026-10-08).

Run (needs `firebase login` and access to the project): `cd test/library-v2-p4-s1/google-validation && node run.cjs`.

MANDATORY RETEST: any change to the importBatches region, `mayWriteCurriculum`/`mayReadCurriculum` and helpers, `importAllowsActivation`, or the framework create/update rules must re-run `headroom.cjs` (and test 8 of `../atomic.rules.test.mjs`); the capability-holder `completed` headroom (currently 3 minimal predicates) must not shrink without Architect approval.
Limits: `projects.test` is single-request - atomic multi-write ordering is proven only by `../atomic.rules.test.mjs` on the emulator.
