# P4-S2 - XLSX reader qualification, normalization, validation and import plan - RESULTS

Baseline: `a736469ad3666ac8be245a21b0428f73414589fa` (P4-S1 closed; production Rules ruleset `0b6910c3`, SHA-256 `7F7C790E...0485`). Slice is additive and inert: nothing is wired into `index.html`, no Firestore write, no Rules/index/Storage change.

## Suites (all pass)
| Suite | Tests | Run |
|---|---|---|
| `reader-qualification.test.mjs` | 20 | `node --test test/library-v2-p4-s2/reader-qualification.test.mjs` |
| `pipeline.test.mjs` | 23 | `node --test test/library-v2-p4-s2/pipeline.test.mjs` |
| `plan.test.mjs` | 11 | `node --test test/library-v2-p4-s2/plan.test.mjs` |
| `source-guard.test.mjs` | 4 | `node --test test/library-v2-p4-s2/source-guard.test.mjs` |
| `plan.rules.test.mjs` (emulator, production Rules) | 9 | `firebase emulators:exec --only firestore --project demo-p4s2 --config test/library-v2-p3-s2/firebase.json "node --test test/library-v2-p4-s2/plan.rules.test.mjs"` (Java 21) |

## Reader qualification (SheetJS CE 0.20.3, vendored separately; V1 0.18.5 untouched)
Provenance/hash pins, no CDN or network API anywhere, exactly one importer (the Worker); valid workbooks through the REAL Worker equal the in-process result; envelope (empty, >5 MiB, extension, text, OLE legacy/encrypted, truncated); strict ZIP structure (traversal/absolute/backslash/non-ASCII names, duplicates, encryption, ZIP64, odd methods, multi-disk, local<->central mismatch, zero local sizes, trailing/prefix data, overlapping entries, 101 entries, fake end-record in the comment); part policy (macros by part and content type, external links, connections, embeddings, ActiveX, binary parts, non-XLSX packages); zip bombs from declared sizes WITHOUT inflating; a lying header is cancelled after the declared size (bounded allocation); DTD/ENTITY, shared-string flood, row/cell/column floods; malformed XML and bad shared-string index never yield a model; ReDoS-style number formats and prototype-named sheets/codes; Worker timeout terminates a busy-looping worker; the real Worker times out cleanly; crash/creation failure -> one friendly error; concurrent reads isolated; fail-closed when the gate cannot run; heaviest allowed workbook (19 MiB sheet) read in ~1.6 s, +8 MiB RSS.
Real browser (Chromium in the app Browser pane, real module Worker over HTTP, 10 fixtures incl. 5000-node workbook): valid pass; hostile/malformed rejected with specific codes; 5000-node workbook read+validated+planned in ~0.9 s; recovery after a timeout.

## Validation / normalization / plan
Template contract, 10-stage pipeline (all stages reported), structured Vietnamese diagnostics (sheet, row, column, field, code, severity, stage, bounded excerpt), numeric codes and leading zeros, formulas/booleans/dates/error cells, control/bidi/invisible characters, NFC/trim with preserved originals, order consistency, canonical code uniqueness (O(n) key map proven equal to P3 `codeConflictOf` on adversarial data), P3 bounds, orphan lessons, hidden/merged warnings, 1000-error bound, determinism (cell order, NFC/NFD, repeated runs, hand-built RawWorkbook), forged models refused; plan: ids, write order, chunks (<= 400, 5000 nodes = 13), final witness, verification metadata, digest tamper detection, deep freeze, stage 10 (`prepareCommit`), payload equality with the P3 write-contract builders, and execution under the PRODUCTION Rules (batch -> framework -> chunks -> completed -> activation for pa/oaA/capA, 5000-node maximum, guard denials).

## Regression guards run (relevant only)
192/192: P3-S2 model/write-contract/queries/source-guard, P3-S3/S4/S5 source guards, P3-S4 code-conflict, P3-S5 clone/delete units, P2-S2/S3/S4 source guards, O1/O2/P1 source guards, P4-S1 text regression (Rules bytes, indexes, package.json), group-pdf-v1 builder/vendor-integrity/wiring. One historical guard was aligned (`test/library-v2-p2-s2/source-guard.test.mjs`: the ten new inert root modules appended to its "only these root modules" list; asserted by `source-guard.test.mjs`). `test/group-pdf-v1/source-guard.test.mjs` test 7 (scope lock against the old baseline 5c3c5b8) fails identically on the P4-S1 baseline `a736469` - pre-existing, not touched.
