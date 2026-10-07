# Library V2 - P3-S4 (MON -> BAI node editor) - candidate test results

Candidate branch `candidate/library-v2-p3-s3-framework-ui` on top of the held P3-S3 candidate `c95595a` (lineage ec67a9c -> c2ed5e1 -> c95595a -> a662b72 (S4.0) -> f621fbb (S4.1/S4.2) -> aabb5bb (integration e2e) -> this results commit). Source baseline `origin/main` = `ec67a9cb692f942c0eb0a26f00e056f94e706334` (unchanged; production Rules ruleset 5945fbe7, SHA-256 A0B206FC...921D, Storage af1b9c8c, 13/13 indexes).
**S3 and S4 are ONE future web release. This candidate must not be pushed to `main` or deployed.** No Rules, index, Storage, data or package change; `curriculum-queries.mjs` and `curriculum-write-contract.mjs` are byte-identical; `curriculum-model.mjs` gained only the approved additive `codeConflictOf` (`codeInUse` delegates).

Production-relevant files: new `curriculum-editor-view.mjs`; additive `codeConflictOf` in `curriculum-model.mjs`; seam edits in `curriculum-admin-view.mjs` (mount options) and `organization-admin-view.mjs` (`frameworkEditor`, `showFrameworkEditor`, focus return); `index.html` (editor wiring, `p3s4` cache tokens). Test-only: `test/library-v2-p3-s4/*` and alignment of older guards through `s3-edits.mjs` (which now reverses the S4 edits first).

Run (Edge + Playwright; Java 21 on PATH for the emulator suite):
- pure: `node --test test/library-v2-p3-s4/code-conflict.test.mjs test/library-v2-p3-s4/editor.unit.test.mjs test/library-v2-p3-s4/source-guard.test.mjs`
- controller (real browser, fake Firestore with batch + failure injection): `node test/library-v2-p3-s4/controller.e2e.mjs`
- integration (real `index.html` + Auth/Firestore emulators + deployed Rules): `node test/library-v2-p3-s4/integration.e2e.mjs` (optional `P3S4_SHOTS=<dir>`)

New tests: code-conflict 8, editor unit 12, source guard 11 (3 S4.0 + 8 editor/wiring/zero-index) = 31 pure; controller e2e 29; integration e2e 13.
- `code-conflict.test.mjs`: case, whitespace, NFC/NFD, full-width, self-exclusion, retired nodes count, first-in-order, malformed entries, consistency with `codeInUse` and `validateTree`.
- `editor.unit.test.mjs`: labels, mode, controls matrix, tree presentation (retired toggle never hides a live node), depth 3/4, stale comparators, error mapping, markup/ARIA/escaping, readiness panel, dialogs, node writer (transport only, atomic batch).
- `source-guard.test.mjs`: seam/model edits exactly as approved (reversal restores the c95595a / P3-S2 bytes), editor imports nothing and touches Firestore only through the writer, no duplicated domain logic or payload keys, exact P3-S2 API consumption, every mutation exclusive + fresh read, wiring, zero-index and byte identity.
- `controller.e2e.mjs` 29: S3->editor seam and return focus, loading/empty, create Mon/Bai, add-and-continue (success, failure keeps values, pending id), canonical duplicate codes, edit/self-exclusion, retired codes reserved, per-node retire (no cascade) + restore, readiness, retired toggle, collapse, reorder (batch, boundaries, renumber, stale, atomic failure), depth 3/4, archived framework/Organization read-only, stale Organization/framework/node/parent, permission-denied diagnosis, read failures, orphans + >5000 nodes, busy guard, dialog focus (Escape/Cancel/backdrop, keyboard-only), responsive 375/768/1280, zero console errors.
- `integration.e2e.mjs` 13: MO on every row, build from scratch through the deployed Rules (exact stored fields, orders, ancestors, audit), duplicate codes, edit/retire/restore, reorder, back-navigation focus + activation through the S3 dialog, archived framework and archived Organization read-only, seeded depth-4 tree + foreign-organization node never shown, stale Organization against real data, S3 list + members regression, phone width, final collection/audit invariants.

Screenshots: `09_DOCUMENTATION/library-v2/evidence/p3-s4-screenshots/` (desktop + 375px; harness and real-index). **Developer-inspected only - NOT the Owner visual QA, which remains a separate required gate.**

Honest notes: S4.1 and S4.2 share one commit because the editor module was written as one unit; each mutation re-reads the whole bounded tree (zero indexes, <= 5001 docs); duplicate prevention is client-side only (the Rules do not enforce uniqueness). Retire action/badge copy uses "Ngừng sử dụng" (Owner D1 wording) instead of the spec's "Tạm ngưng".

Regression results of this tree: see the section below (filled from the recorded run).

## Regression results on this tree (recorded run, Java 21)
- Pure: P3-S2 (model/queries/write-contract/guard) + P3-S3 (view/guard) + P3-S4 = 109/109; older pure suites + source guards (P2-S2/S3/S4, O1, O2) = 76/76.
- Emulator/Rules suites on the unchanged deployed Rules: P3-S2 contract 10/10, P3-S1 28/28, P2-S1 24/24, P2-S2 11/11, P2-S4 12/12, O1 6/6, O2 7/7 (= 98).
- Browser: P3-S3 controller 24/24; P3-S4 controller 29/29; P3-S3 integration 14/14 (after aligning the S3-only assertions "no MO control" to the combined tree: MO is now present on every row by design; all lifecycle assertions unchanged); P3-S4 integration 13/13; released Organization flows P2-S3 16/16, P2-S4 23/23, O2 13/13, O1 16/16.
- Note: in the first batch run the P3-S3 integration e2e failed once with a 60s login timeout straight after the P3-S1/S2 emulator suites (shared ports); the standalone re-run exposed the real, intended difference above and then passed 14/14.
- A/B of ALL 105 pre-existing `*.test.mjs` files run individually, baseline `ec67a9c` tree vs this tree: **0 differences** (1455 tests, 885 pass, 566 pre-existing environment/emulator-dependent failures on both sides).
- Invariants verified by diff against `ec67a9c`: Rules files, `firestore.indexes.json`, package files, `curriculum-queries.mjs`, `curriculum-write-contract.mjs` unchanged; `curriculum-model.mjs` only the additive `codeConflictOf`; changed production files = `curriculum-admin-view.mjs` (new in S3), `curriculum-editor-view.mjs` (new), `curriculum-model.mjs`, `index.html`, `organization-admin-view.mjs`. `origin/main` still `ec67a9c`.
