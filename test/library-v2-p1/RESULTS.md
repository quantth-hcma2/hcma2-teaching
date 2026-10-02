# Library V2 — P1 (Hub navigation) — candidate test results

Candidate branch `candidate/library-v2-p1-hub-navigation`, based on production `origin/main` `5c4effc7cd5be73ddd1c472393d325c1f0d4660a`. Navigation-first: no Firestore data model, Rules, indexes, Storage Rules, vendor or dependency change.

## Focused suites (new)
- `registry.test.mjs` — 8/8 (pure registry: children/status, scopes, location resolution, canonical target mapping, hub/child markup, extensibility with an extra registered child, escaping).
- `source-guard.test.mjs` — 8/8 (V1 Library/question-set/wizard-picker/finalize/admin functions byte-identical to production; Rules/indexes/package/vendor/RichText/PDF modules byte-pinned; no new collection names; exactly the one baseline dynamic `import()`; registry is a pure static import with no Firestore/network/DOM access; hub shell contains no Firestore calls; all entry points resolve through the registry; wizard picker stays contextual).
- `browser.e2e.mjs` — 15/15 (real `index.html`, headless Edge, local Auth + Firestore emulators with the production-candidate Rules, synthetic data). Covers hub, disabled Thảo luận nhóm card with zero writes, V1 CÂU HỎI / BỘ CÂU HỎI, disabled shared pill, Back behavior, Overview shortcuts, whole-database snapshot equality after pure navigation, 375 px layout, create/edit/duplicate/delete, DÙNG TRONG TƯƠNG TÁC, wizard picker, wizard Hủy bỏ, and a final check that no new collection exists.

## Regression A/B (40 files: the 32 `index.html`-reading suites plus 8 scope/RichText/PDF pure suites)
Baseline `5c4effc` and candidate produce identical results: 712 tests, 213 failures (all pre-existing: emulator-dependent suites run without their emulator, stale `gate4c-e3` F3 baseline), **0 differing results** when measured on the working tree. After the candidate is committed, one historical test differs by construction: `test/candidate-5b/scope-pin.test.mjs` "relative to production 87ff3bd only the intended Unified Trash files differ" diffs HEAD against `87ff3bd`, so it fails for ANY commit on top of the released 5B (it is a release-scope pin of that workstream, not a P1 regression); its other 7 tests (Rules/indexes/RichText/PDF/vendor pins) still pass.

Owner QA polish (presentation only): hub subtitle, "MỞ THƯ VIỆN →" directly under the description, "Chưa dùng được…" line removed from the Thảo luận nhóm card (badge kept), content-height top-aligned two-column cards (no min-height, no bottom anchoring), explicit card line-height so both cards align. Navigation logic, registry behavior and V1 code are unchanged.

Run: `node --test test/library-v2-p1/registry.test.mjs test/library-v2-p1/source-guard.test.mjs`; browser flow: `node test/library-v2-p1/browser.e2e.mjs` (Java 21 on PATH, `PLAYWRIGHT_PACKAGE`, ports 8080/9099 free; optional `P1_SHOTS=<dir>` saves screenshots).
