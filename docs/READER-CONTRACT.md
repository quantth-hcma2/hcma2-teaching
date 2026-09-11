# HCMA2 Teaching — Reader Contract (Gate 1B.1)

Status: **Contract + Reader First**. No writer for this contract exists yet. No production
document in this shape has been created. This document describes what a reader must be able
to understand if/when such documents start to exist.

This is a **read contract**, not an activation. A session with none of the fields below is a
**legacy session** and must keep behaving exactly as it does today (Gate 1A included).

## 1. Design principles this contract must uphold

1. Never change the meaning of data already collected.
2. A published question must be immutable; a new round gets new question IDs, it never
   rewrites the source of an old one.
3. Shrinking the number of groups is a **RETIRE**, never a delete. Historical group data must
   stay reachable.
4. A Knowledge session's participant-profile policy is **pinned per participant at enrollment
   time**. Changing the policy later does not retroactively apply to participants who already
   enrolled under the old policy.
5. Editing session info (Gate 1A) is not the same operation as Reopen, Restart, or Apply of a
   new config version. Gate 1A's `openSessionInfoEditor` only ever touches the narrow
   `SESSION_INFO_FIELDS` allowlist and must refuse to run at all on a contract session (see
   §6).
6. Readers ship before writers. This gate adds no write path for the schema below.
7. Once real production data exists in this shape, blindly rolling the frontend back to a
   pre-contract legacy build becomes unsafe (the legacy build cannot represent versioned
   data). Gate 1B.1 explicitly stops **before** that point: no contract document is ever
   created in production by this gate, so the existing rollback plan (`b0061a1`) stays valid.
8. Participant PII (`fullName`, `className`, `email`, `phone`) must never reach any
   public/version projection, AI input, or Second Brain input. A reader that produces such a
   projection must actively strip these fields, not merely "happen" not to include them.

## 2. Root marker fields (session document)

Absence of `editContractVersion` on a `sessions` / `groupActivities` / `knowledgeSessions`
document means **legacy**. The reader must treat every field below as optional and must not
write a default value back if missing.

| Field | Type | Meaning |
|---|---|---|
| `editContractVersion` | integer | Contract schema version the session was created/migrated under. Currently only version `1` is understood by this reader. Any other value (including future ones) must fail closed. |
| `configRevision` | integer | Monotonic counter, bumped every time `currentConfigId` changes. Used only for stale-state detection in the UI layer, not for authorization. |
| `currentConfigId` | string | Document ID inside `configVersions` that is presently active/effective for the session. |
| `contractActivatedAt` | Firestore Timestamp | When the contract was first activated for this session. Never used to gate reads; informational only. |

## 3. `configVersions/{configId}` (subcollection of the session document)

A `configVersions` document is a **manifest**: an immutable, appended snapshot of session
configuration at some point in time.

```
configVersions/{configId}
  parentConfigId: string | null      // null only for the very first manifest of a session
  kind: "interaction" | "group" | "knowledge"
  createdAt: Timestamp
  active: boolean                    // true only for the doc referenced by currentConfigId
  roundId: string                    // interaction only
  questions: [...]                   // interaction only, see §3.1
  tasks: [...]                       // group only, see §3.2
  classOptions: string[]             // knowledge only
  minimumPerParticipant: integer     // knowledge only, 1–20
  participantFields: {...}           // knowledge only, same shape as today's field
```

There is one reserved, **implicit** manifest that never has a Firestore document: the logical
baseline `legacy-v0`. Every ancestry chain the reader walks conceptually terminates at
`legacy-v0` (root-most ancestor with `parentConfigId === null` is treated as descending from
`legacy-v0`). `legacy-v0` is never backfilled with `sealed`/`roundId` — those fields simply do
not apply to it.

A manifest that exists in Firestore but is not the value of `currentConfigId` is a **prepared,
not-yet-active** config. The reader must never treat a prepared config as historical/official:
it is not part of the ancestry chain reported to callers, and it must not be surfaced in
reports/exports.

### 3.1 Interaction (`sessions` future contract) — questions

```
questions[i]:
  questionId: string   // new for every published version/round, never reused across rounds
  roundId: string       // must equal the manifest's own roundId
  sealed: boolean        // true once the round has been published; sealed rounds are immutable
  type: "single" | "multi" | "scale" | "ranking"
  text: string
  options: [{ optionId: string, text: string }]  // option IDs are independent per version
```

Reusing a `questionId` across two different `roundId` values is a contract violation
(`REUSED_QUESTION_ID`) and must fail closed.

### 3.2 Group (`groupActivities` future contract) — tasks

Task text is snapshotted directly on the manifest (`configVersions.tasks`), one entry per
active group at the time that manifest became active:

```
tasks[i]:
  group: integer     // 1-based group number, must be <= the manifest's own groupCount
  topic: string
```

`taskVersions` (a separate per-task history collection) is **not** created by Gate 1B.1. If a
later gate needs per-task edit history independent of the group's manifest, that is new scope.

### 3.3 Knowledge (`knowledgeSessions` future contract)

Uses the same shape already live today for `classOptions` / `minimumPerParticipant` /
`participantFields`, just carried on the manifest instead of the session root.

## 4. `editHistory/{operationId}` (subcollection of the session document)

Append-only audit trail. One entry per write against the contract (not created by Gate 1B.1;
documented here because the reader must tolerate it being present, absent, or partially
readable without changing its own behavior).

```
editHistory/{operationId}
  actorUid: string
  at: Timestamp
  kind: string            // e.g. "config_published", "config_retired"
  fromConfigId: string | null
  toConfigId: string
```

## 5. `knowledgeSessions/{sid}/enrollments/{uid}`

Records which `configId` was active for a Knowledge participant **at the moment they
enrolled** (i.e. at profile-submission time). This is what makes participant-profile policy
non-retroactive: the reader must resolve a participant's *effective* policy from their own
enrollment record, not from the session's current `currentConfigId`.

```
enrollments/{uid}
  configId: string
  enrolledAt: Timestamp
```

If an enrollment record is missing for a participant that otherwise exists (submissions/
participant doc present), the reader must report that participant's policy as
`"unknown"` — never guess, never silently apply the current policy.

## 6. Fail-closed / compatibility rules for existing writers

- `editContractVersion` present but not `1` (or `currentConfigId` present without a resolvable,
  active `configVersions` doc) ⇒ the reader throws `UNSUPPORTED_CONTRACT` and the caller must
  show a "chưa hỗ trợ" message. It must never silently fall back to rendering the session as
  legacy.
- Gate 1A's `openSessionInfoEditor` (`checkSessionInfoAccess`) now refuses (throws
  `sessionInfoError`) if the loaded document carries `editContractVersion`. Gate 1A's writer
  was built for the legacy shape only; it must not blind-write `title`/`description`/
  `instructions`/`targetSubmissions`/`topic` onto a contract session, since doing so would
  silently diverge from the active manifest without going through `editHistory`.

## 7. Manifest limits (baseline, carried over from prior review; not yet re-validated against
this codebase — see the implementation report for anything found inconsistent)

| Limit | Value |
|---|---|
| Manifest size | 64 KiB JSON (UTF-8 byte length) |
| Ancestry depth | ≤ 100 manifests |
| Questions per round | ≤ 100 |
| Options per question | ≤ 20 |
| Active groups | 2–12 |
| Task entries per manifest | ≤ 200 |
| Class names per Knowledge manifest | ≤ 200 |
| Class name length | ≤ 40 characters |
| `minimumPerParticipant` | 1–20 |

A manifest that violates any limit above, has a cyclic/broken `parentConfigId` chain, or
reuses a `questionId` across rounds, fails validation (`MANIFEST_INVALID`, with a `reason`
field naming which check failed) rather than being partially trusted.

## 8. What this gate does NOT do

- No writer for any field/collection in this document.
- No production document in this shape is created by this gate.
- No AI Gateway / Second Brain change.
- No Firestore Rules change (this reader can be blocked by the current Rules for the
  `configVersions`/`editHistory`/`enrollments` paths on a real contract session — that is
  expected and correct; the reader fails closed on `permission-denied` exactly like any other
  read error, it does not treat that as "legacy").
