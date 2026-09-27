# Candidate 4R-LIVE provenance

Status: release preparation only; not committed, pushed, or published.

## Source-of-truth synchronization

Before this release, `firestore.rules.production-candidate` in Git was stale. Its production-old content had SHA-256 `27A1B18AA4F9EE9AE8B0F31C368EB0A01388C3BD210ED35CC1A4A55BF595377F`, while the Rules actually effective in Firebase had SHA-256 `6262904EC1784D74A95E65A86FD4B01BCDC9BDEF0722D31995A069D70DC578E0`.

The live-existing Rules include non-Group changes that predate 4R-LIVE, including the Interaction dispatcher, missing/null/type guards, RichText V1/V2 support, Knowledge contracts, and Knowledge `grantEpoch`. Those changes are synchronized into the canonical Git source because they already existed in production; they must not be attributed to Candidate 4R-LIVE.

## Candidate change

Candidate 4R-LIVE was created by applying only the approved Group Rules V2 structural reconciliation to the exact live baseline. Its SHA-256 is `3DE0358DBD224583DE3393D8B7F765B13AC9FB2EB6424EAAC602D690C51B9DCE`.

The candidate change is limited to the Group Discussion region (`+89/-133` versus actual live). All bytes before the Group region and all bytes after it are unchanged. The Group refactor preserves live behavior for `collectStudentNames`, `displayName`, legacy members, RichText V1/V2, secure `storagePath`, membership, join codes, notes, photos, files, and config/history contracts.

## Retired artifact

The earlier Candidate 4R artifact with SHA prefix `05E391` was built from stale Git Rules. It is retired and must never be published.

## Rollback provenance

The only valid pre-4R-LIVE Rules rollback artifact is the exact actual-live snapshot with SHA-256 `6262904EC1784D74A95E65A86FD4B01BCDC9BDEF0722D31995A069D70DC578E0`. The stale Git Rules SHA `27A1B18...` is not a valid production rollback.
