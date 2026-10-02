# Library V2 - P2-S2 (Organization pure modules + contract tests) - candidate test results

Candidate branch `candidate/library-v2-p2-s2-org-modules`, based on production/source baseline `origin/main` `88546d322f13007638f4b58de95c75718dd189ad`. Four new pure, **inert** modules and tests. No UI, no `index.html` change, no wiring, no Rules/index/Storage change, no data. Not released.

## Suites
- `unit.test.mjs` 15/15 (pure): context resolver (deterministic ordering, preference, archived/governed, input shapes), query contract with recording stubs (one organizationId only, bounded pages, snapshot cursor, no all-organizations function in the ordinary factory, separate Platform-Admin factory), write contract (exact payload keys, client validation mirrors the Rules, ids, chunk defaults, no Organization-Admin add/discovery path), registry.
- `source-guard.test.mjs` 7/7 (pure): exactly four new modules, purity (no Firebase/network/storage/DOM/dynamic import), inertness (nothing references the modules; `index.html` byte-identical), query guards (no `in`/array-contains-any/or/collectionGroup/users, exactly two equality filters, organizations listing only in the Platform-Admin factory, every list bounded), pinned public APIs, byte pins for the deployed Rules artifact, indexes, UI, package, vendor and existing modules.
- `contract.rules.test.mjs` 11/11 (Firestore emulator, Rules = deployed artifact SHA-256 `7EA5D7A5...CC1DDD`): builder-generated payloads accepted for every Platform Admin / Organization Admin action; every mutation (unknown field, each required field dropped, wrong values/types/actors/ids/timestamps) rejected; builder-invalid inputs also rejected by the Rules when sent raw; Organization Admin cannot add/appoint/change roles/reinstate removed members; capability writes by builder incl. the default chunk of 10; real query functions against the Rules (paging 134+ members complete and single-organization; denied for the wrong principal; Platform-Admin-only organization list; raw `in` query and `users` listing denied); the context resolver fed with real query results.

## Run
- Pure: `node --test test/library-v2-p2-s2/unit.test.mjs test/library-v2-p2-s2/source-guard.test.mjs`
- Emulator (Java 21): `firebase emulators:exec --only firestore --project demo-p2s2 --config test/library-v2-p2-s2/firebase.json "node --test test/library-v2-p2-s2/contract.rules.test.mjs"`; the P2-S1 suites run unchanged on this tree with the same command (35/35 together).

## Existing Rules regression vs the frozen fingerprint
20 existing emulator Rules suites on this tree: **444 tests, 421 pass, 23 fail - identical to the frozen inherited-failure fingerprint (all 23 failing test names identical)**.
