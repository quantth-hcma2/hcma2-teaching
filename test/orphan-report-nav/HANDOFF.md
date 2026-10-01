# Orphan “Báo cáo” — local candidate checkpoint

“Báo cáo standalone removed from teacher navigation; Interaction report functionality preserved under Tạo tương tác.”

- Baseline and verified production source: `8283340457f3daf2126ef1810d3f80c8767e59ad` (production `index.html` SHA-256 `32CA4E22C4C8EE5725E1CF49085D83BB3F8639676B1924FED82AF4B70500751C`).
- Worktree: `C:\Users\Admin\Documents\Codex\2026-09-27\em-ti-p-t-c-k\work\orphan-report-nav`.
- Branch: `candidate/orphan-report-nav-20261001`.
- Product change: `index.html` only. Remove standalone teacher Reports menu/duplicate list; normalize legacy Reports/History state to Interaction; label existing history “Lịch sử / Kết quả”; in-app report Back navigates to Interaction. Keep `#/report/{sessionId}`, renderer, queries, chart, print, CSV, JSON and filtering.
- Test/documentation change: `test/orphan-report-nav/navigation.test.mjs` and this checkpoint.
- Focused test command: `node --test test/orphan-report-nav/navigation.test.mjs test/gate1b2c/view-model.test.mjs` — 19 PASS / 0 FAIL.
- These are source-contract and pure view-model tests, not an authenticated browser end-to-end test. Native Browser Back and report rendering are preserved by unchanged hash router/report code and source-contract checks; verify interactively in owner release review.
- `test/gate1b3d2` emulator tests were not run: this fresh worktree lacks `@firebase/rules-unit-testing`; no installation or emulator/prod mutation was attempted.
- `git diff --check` PASS. No Group Discussion, 4A, Classroom, Knowledge/Second Brain, Staging Start, Firestore Rules, indexes, data, Storage or CORS files changed.
- No push, deployment or production mutation. Candidate 5 remains paused.

Next task: owner reviews this frozen local candidate, then explicitly authorizes a controlled production release. Before any release, recheck `origin/main` and production source against the baseline, perform authenticated browser checks for the 12 requested paths (including browser Back, chart, print, CSV, JSON), and stop on drift or regression. Do not push/deploy without that approval.
