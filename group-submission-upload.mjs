export class GroupSubmissionUploadError extends Error {
  constructor(cause, leftoverPath = null) {
    super(cause?.message || "Không thể lưu bài gửi.", { cause });
    this.name = "GroupSubmissionUploadError";
    this.code = cause?.code;
    this.submissionAssetLeftover = leftoverPath;
  }
}

// Storage and Firestore cannot share one atomic transaction. This helper makes the one permitted
// compensation explicit and exact-path only: it never accepts a prefix or enumerates objects.
export async function uploadThenCreateGroupSubmission({ path, upload, create, remove }) {
  await upload(path);
  try {
    await create(path);
  } catch (cause) {
    let leftoverPath = null;
    try { await remove(path); }
    catch { leftoverPath = path; }
    throw new GroupSubmissionUploadError(cause, leftoverPath);
  }
}
