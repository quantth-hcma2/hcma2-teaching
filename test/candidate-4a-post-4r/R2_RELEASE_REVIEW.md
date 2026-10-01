# Candidate 4A-R2 — local freeze / owner release-review checkpoint

Date: 2026-10-01. **Not deployed or pushed.**

- Baseline: rollback `9e866fc475104cc6d6b32143ad79694d4fa2891f`, tracked product content equivalent to pre-R1 `9d57aa285dae0c4a2de4df571c2155d18eb59325`.
- Historical failed frozen R1: `d05d3257de4ea3477908162785a227f62f7f51ab`; kept immutable.
- R2 is one new local commit on the rollback baseline; obtain its SHA with `git rev-parse HEAD` after freeze. The commit cannot contain its own stable SHA.
- Four required Firestore Group indexes were already READY in production; this candidate neither creates nor deploys indexes.

## Only product difference from R1

`firestore.rules.production-candidate`, `/groupJoinCodes/{code}` `allow get`: a signed-in `get` of an absent mapping now short-circuits on `resource == null` before reading `resource.data.activityId`. Existing mappings still require the mapped activity to exist and be not deleted. The create, delete, restore, and mapping reservation rules are otherwise unchanged. `index.html` and `firestore.indexes.json` are identical to R1.

## Focused A/B evidence

`group-create-preflight.test.mjs` uses the same active teacher auth shape and production-shaped four-document Group-create batch for all three Rules versions:

| Rules | `getDoc` unused code | Batch create | Deleted mapping / restore |
| --- | --- | --- | --- |
| Baseline | ALLOW, `exists=false` | ALLOW | not exercised |
| R1 | DENY, `permission-denied`, `Null value error` | ALLOW directly | not exercised |
| R2 | ALLOW, `exists=false`, no Null | ALLOW | existing mapping DENY while deleted; same mapping readable after restore |

R2's deleted-state DENY is the previously classified emulator false-expression diagnostic, not a Null/undefined or limit failure. The original production failure occurred during the unused-code preflight, before the batch.

## Minimum 4A gate

The existing local gate was run once against R2: **14 PASS / 0 FAIL / 4 SKIP**. Denial ledger remained `E2=2`, `R2=4`, `C3=15`; new/unclassified diagnostics `0`. Genuine Null/undefined `0`, expression-limit `0`, access-call-limit `0`. Owner/anonymous/foreign authorization, soft-delete/restore, preserved Group descendants, lifecycle, and Group/RichText V1/V2 compatibility passed. Existing D01–D15 evidence remains reusable; not reopened.

## LF-normalized SHA-256 product hashes

- `index.html`: `2D2589EC623982C5BBE1224992A3883E05FD648DC79A0B25A2FE5DCBCD146338`
- `firestore.rules.production-candidate`: `218BFF3BDB4D82CA82E2161583E23CCB95589F288F8B8573B5863E65B6C3880F`
- `firestore.indexes.json`: `FE4BFDCE6CBA8D9C693126C617AEA592643F74E90AE82AB2B0C45E18DE96A594`

## Release policy

Local PASS permits owner-controlled release review only. No R2 production authorization has been given. Current production remains the rollback baseline: web/source `9e866fc...` (baseline content), live Firestore Rules ruleset `9450ef14-fdfc-4ead-979b-9b14df5b344d` / SHA `3DE0358DBD224583DE3393D8B7F765B13AC9FB2EB6424EAAC602D690C51B9DCE`; four indexes READY. Before any future release, independently recheck live state and obtain owner authorization.
