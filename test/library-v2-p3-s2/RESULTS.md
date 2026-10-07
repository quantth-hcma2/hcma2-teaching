# Library V2 - P3-S2 (pure curriculum modules) - candidate test results

Candidate branch `candidate/library-v2-p3-s2-pure-curriculum-modules`, based on production/source baseline `81f484818d712a518e00c5bd238ad18d11115a05` (origin/main; production Rules ruleset 5945fbe7-d5db-4e23-b355-a7b17793c7a8, SHA-256 A0B206FC...921D). Three new pure root modules, not wired into index.html; NO Rules, index, Storage, UI, data or package change. Nothing is deployed.

New modules: `curriculum-model.mjs` (domain), `curriculum-queries.mjs` (read adapters), `curriculum-write-contract.mjs` (payload builders).

Run (Java 21 on PATH for the emulator suite):
- pure: `node --test test/library-v2-p3-s2/model.unit.test.mjs test/library-v2-p3-s2/queries.unit.test.mjs test/library-v2-p3-s2/write-contract.unit.test.mjs test/library-v2-p3-s2/source-guard.test.mjs`
- Rules contract: `firebase emulators:exec --only firestore --project demo-p3s2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p3-s2/contract.rules.test.mjs"`

New tests (55, all pass):
- `model.unit.test.mjs` 19 - constants vs the Rules, name/code/order/kind/status validators, lifecycle table (all 6 ordered pairs), activatedAt semantics, availability (archived org/framework), clone marker and completeness, structure (depth <= 4, ancestors unique/strings, self-in-ancestors, parent == last ancestor), ordering and planSiblingMove, buildTree, validateTree (15 integrity codes), code uniqueness, activationReadiness, list sort.
- `queries.unit.test.mjs` 7 - recording fake Firestore: Q1/Q2/Q3 shapes, bounds (100+1, 5000+1), honest truncation flags, cross-organization refusal, single-id inputs, INDEX DISCIPLINE (every query = exactly one organizationId equality + limit, no orderBy).
- `write-contract.unit.test.mjs` 15 - exact Rules key sets, scope organization, draft-only create, cloneSource same-organization, rename, lifecycle builders with writer metadata and activatedAt-once, activation readiness, node create (depth 4 ok / 5 refused, ancestors, order, code, id checks, 5000 cap), node update (immutable fields named), retire/restore, reorder, no input mutation.
- `source-guard.test.mjs` 5 - module boundaries (no Firebase/DOM/clock/network), read adapters free of ordering/cursor/in/collection-group, no excluded feature tokens, key sets and constants extracted from the DEPLOYED Rules text equal the modules, byte pins (Rules, indexes, Storage absence, index.html, package, 12 existing files).
- `contract.rules.test.mjs` 9 (Firestore emulator, EXACT deployed Rules artifact SHA A0B206FC...921D) - builder output ACCEPTED by the Rules for Platform Admin / Organization Admin / capability holder and a full create -> nodes -> reorder -> retire/restore -> activate -> rename -> archive -> restore lifecycle with real reads; denied for ordinary members, other organizations, anonymous, suspended; and the Rules still deny every forged/tampered raw payload the builders refuse (client validation is not the security boundary); real read adapters under the Rules.

Existing suites on the P3-S2 tree:
- P3-S1 `rules` 17, `budget` 5, `regression` 6 = 28/28 (one assertion aligned: the "curriculum-model/queries must not exist" guard now only forbids the UI module `curriculum-admin-view.mjs`).
- P2-S1 14+6+4, S2 contract 11, S4 membership 11, O1 search, O2 enrollment (36 together) = 60/60 on the unchanged deployed Rules.
- Pure suites P1/S2/S3/S4/O1/O2 (12 files): all pass (one assertion aligned: the exhaustive root-module list in `library-v2-p2-s2/source-guard.test.mjs` now includes the three curriculum modules).
- A/B of ALL 100 existing `*.test.mjs` files run individually, baseline tree (81f4848) vs P3-S2 tree: identical counts for 99 files; the one difference is `gate2b-rt-fix1/emulator-acceptance.test.mjs` (needs a running emulator, fails on both trees) because the baseline worktree contains the generated, git-ignored `test/gate2b-rt-fix1/firestore.rules` produced by earlier legacy emulator runs - not a code or behavior difference.
- The 20 legacy emulator suites were not re-run: the Rules file is byte-identical (SHA-pinned) and no server/UI code changed.
