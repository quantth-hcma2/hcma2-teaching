// GATE 2A-AUTH-I2 (Stage 2 of 3): student group-membership bootstrap logic. Establishes or
// recovers a student's group membership (groupActivities/{activityId}/members/{uid}), matching
// exactly the shape the Stage-1 Rules (already deployed to production) require. Never touches
// topics/notes/photos/files — those keep their existing rules and query shape in this gate;
// index.html uses this function's return value only to scope its own reads/writes client-side,
// ahead of a future Stage-3 Rules tightening. Group Discussion only.

export class GroupMembershipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GroupMembershipError";
    this.code = code;
  }
}

// Defensive validation of a membership record's `group` field — used both for an existing
// record read back from Firestore and, implicitly, as the return contract of ensureGroupMembership
// itself. Throws rather than returning a sentinel so a malformed/out-of-range stored value (e.g.
// after an admin lowers groupCount below a student's already-recorded group) fails closed instead
// of silently producing a bad scoping value a caller might use to build a query or a write.
export function validStoredGroup(data, groupCount) {
  const g = Number(data && data.group);
  if (!Number.isInteger(g) || g < 1 || g > (groupCount || 6)) {
    throw new GroupMembershipError("group-membership-invalid", "Không thể xác định nhóm của bạn. Vui lòng liên hệ giảng viên.");
  }
  return g;
}

/**
 * Returns the caller's authoritative group number for this activity, creating the membership
 * record on first join or recovering the existing one on every subsequent call — never both.
 * An existing record always wins over `selectedGroup` (membership is immutable to the student;
 * see Gate 2A-AUTH-DESIGN Task D) and is never overwritten here.
 */
export async function ensureGroupMembership({ db, firestore, activityId, uid, joinCode, groupCount, selectedGroup }) {
  const { doc, getDoc, setDoc, serverTimestamp } = firestore;
  const memberRef = doc(db, "groupActivities", activityId, "members", uid);
  const existing = await getDoc(memberRef);
  if (existing.exists()) return validStoredGroup(existing.data(), groupCount);
  try {
    await setDoc(memberRef, { group: selectedGroup, joinedAt: serverTimestamp(), joinCode });
    return selectedGroup;
  } catch (writeErr) {
    // Race: another tab/device for the same uid may have created the membership between our
    // getDoc above and this write attempt (the write is then classified by Firestore as an
    // `update`, which student Rules always deny). Re-read once — an existing, valid record
    // wins over blindly retrying the write; any other failure propagates unchanged.
    const retry = await getDoc(memberRef);
    if (retry.exists()) return validStoredGroup(retry.data(), groupCount);
    throw writeErr;
  }
}
