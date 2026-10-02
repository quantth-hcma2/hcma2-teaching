# Candidate 5B — Unified Trash V1 — focused gate (reconciled onto production 87ff3bd)

**Baseline:** production `87ff3bd9d9086bdfdeafaf1667a5d0a6c7ebd6e2` (`origin/main` verified before work; RichText V3 and Group PDF V1 are live in it). Frozen 5A contract: `48e3185aae8d45b44503552f2e33da6fb931bcf3`. No production mutation, push or deploy.

## Provenance of this candidate
- The product delta is the **exact, unmodified** frozen Candidate 5B commit `d1bc4515cc8fea03e19a90f3127c4bfb11a84f0d` (built on the older baseline `66ca3816a3dce4ef7eda0a5900ca37f3465627d9`), replayed as a patch onto `87ff3bd` with `git apply` — not a cherry-pick and not a rewrite. The patch SHA-256 was identical to a regenerated `git diff d1bc451^ d1bc451` (`0852249A…75409A`).
- Replay check: the committed blobs of `trash-query-contract.mjs` (`A4639903…21EFC7EA`) and `firestore.indexes.json` (`A27B5A20…354D51`) equal the old 5B commit's blobs, and the `index.html` added/removed lines hash identically to the old 5B delta. `index.html` applied with line offsets only (hunks at 562, 4770, 4791); production's changes since the old base (RichText R3 CSS, Group PDF V1 wiring) lie in disjoint regions.
- The old record listed different "raw SHA-256 before commit" values because it hashed a CRLF working-tree copy; the committed blobs are the authority.
- Only `trash-query-contract.mjs`, `index.html`, `firestore.indexes.json` and `test/candidate-5b/**` differ from `87ff3bd` (pinned by `scope-pin.test.mjs`).

## How the evidence was produced (synthetic/local only)
- Query/permission/restore suite: `firebase emulators:exec --only firestore --project demo-candidate-5b --config test/candidate-5b/firebase.json "node --test test/candidate-5b/query.test.mjs test/candidate-5b/scope-pin.test.mjs"` (needs Java 21+ on PATH; the Rules file under test is the repo's `firestore.rules.production-candidate`).
- Browser flow: `node test/candidate-5b/browser.e2e.mjs` — the REAL `index.html` in headless Edge on loopback with `?emulator=1`, local Auth + Firestore emulators on ports 9099/8080, synthetic accounts and data created by the script. The app itself refuses emulator mode on the production host. Needs Playwright (`PLAYWRIGHT_PACKAGE` or `playwright`) and free ports 8080/9099.

## Results (this run, baseline 87ff3bd)
- Emulator/pure `query.test.mjs`: **3 PASS / 0 FAIL** (the two Rules-emulator `evaluation error … false` lines are the expected DENYs of foreign-owner restores, as before).
- `scope-pin.test.mjs`: **8 PASS / 0 FAIL**.
- Browser flow: **10 PASS / 0 FAIL** (login; merged order and first page; pagination; filters; Group restore; Interaction restore; `THÙNG RÁC PHIÊN`; Group module lists; RichText V3 toolbar in the Group form; real Group PDF V1 export download).
- Focused A/B over the 32 existing suites that read `index.html` (non-emulator): baseline `87ff3bd` and this candidate are identical — 477 tests, 268 pass, the same 205 pre-existing failures, **0 new**, 0 fixed. (For example the `test/gate4c-e3` "GATE 5F.D2.F3" Firestore call-site comparison compares against an old production SHA and was already red at baseline; the dynamic-`import()` guard in the same file stays green because 5B adds none.)

## Targeted matrix
| # | Scenario | Evidence in this run |
| --- | --- | --- |
| 1 | Empty Trash | Pure view model and emulator (empty before seeding). Browser empty state not exercised in this run. |
| 2 | Interaction only | Emulator; browser filter. |
| 3 | Group only | Emulator; browser filter incl. previous-status labels (Bản nháp / Đang mở / Đã đóng). |
| 4 | Mixed | Browser (31 merged items); emulator merge. |
| 5 | Cross-module deleted-time order | Browser: exact expected order of all 31 items, first page of 20, then the rest. |
| 6 | Three filters | Browser (`aria-pressed`, counts); pure view model. |
| 7 | Older than former 300 boundary | Emulator: 305 newer active sessions, old deleted session still discoverable via server query + cursor. |
| 8 | Active excluded | Emulator; browser (exact list equality excludes active sessions and the active Group). |
| 9 | Ownership isolation | Emulator foreign-owner query/restore denial; browser shows no other teacher's items. |
| 10 | Anonymous/student blocked | Emulator query denial for both modules. |
| 11 | Interaction restore | Emulator; browser — `deletedAt` cleared, item returns to Interaction history. |
| 12 | Group restore to previous status | Emulator; browser — prior status restored. |
| 13 | Group descendants intact | Emulator and browser (topic child unchanged). |
| 14 | Group join code intact | Emulator and browser (`J00028` retained). |
| 15 | Restore removes item from Unified Trash | Browser, both modules. |
| 16 | One adapter failure leaves other results | Pure presentation-state layer only; no browser network-fault injection. |
| 17 | Module-local Trash remains | Browser: `THÙNG RÁC PHIÊN` shows restore **and** permanent-delete controls, back works; Group `ĐÃ XÓA` tab works. |
| 18 | Knowledge excluded | Browser/pure: adapters and filters support only Interaction and Group. |
| 19 | RichText V3 unaffected | Pins (byte-identical modules, R3 CSS present); browser: full V3 toolbar in the Group create form. |
| 20 | Group PDF V1 unaffected | Pins (modules, `vendor/pdf` SHA-256, wiring strings); browser: `TẢI PDF` ×3 in the live view and a real export downloads `Thảo luận nhóm đang hoạt động - K77.B02 - Nhóm 1.pdf`. |

## Known pre-existing issue (not part of 5B)
`teacherOverview` (index.html, untouched by 5B) can throw `Cannot set properties of null (setting 'innerHTML')` when the teacher navigates away before the overview's async stats finish. It reproduces on the untouched `87ff3bd` baseline with the same navigation; the browser script tolerates exactly that error and fails on any other.

## Product boundaries
- Unified screen exposes restore only; it never calls permanent-delete paths. Module-local screens (`THÙNG RÁC PHIÊN`, Group `ĐÃ XÓA`) remain for parity.
- Interaction uses the frozen 5A owner/`deletedAt` server query with a document cursor — no 300-item client-side filter. Group uses the released 4A status/`deletedAt` query and `restoreGroupActivity` — no copy/move of descendants, join code or assets.
- Per-module pages are fetched to at least the number of globally visible items; the merged list renders only the newest global prefix, so later pages never insert items ahead of an earlier displayed page.
- No Knowledge, Firestore Rules, Storage/CORS, migration, central collection, retention or production change. The repo `firestore.indexes.json` now declares `sessions (ownerId ASC, deletedAt DESC)`, which already exists live; **no index deployment is authorized or needed**.

## Raw SHA-256 of product files (committed blobs)
- `index.html`: `6351B1606B7C784C01B4E56BC3DC52B8355CE3B7B7F7434C0179DAB0E7B1012B` (baseline `87ff3bd`: `FE4056691EECE429B42E96B8ED227BD8ADE2D6718C73C55BB7A1BF38375B6A9E`)
- `trash-query-contract.mjs`: `A4639903403D88BB4CC1BB0D197E6C16A0B967242554975F2C47B33121EFC7EA`
- `firestore.indexes.json`: `A27B5A20C63E1B446F63221A6C1FA93B31AC95A6556C6009E44A45F4CA354D51`
