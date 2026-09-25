export class GroupSubmissionUploadError extends Error {
  constructor(cause, leftoverPath = null) {
    super(cause?.message || "Không thể lưu bài gửi.", { cause });
    this.name = "GroupSubmissionUploadError";
    this.code = cause?.code;
    this.submissionAssetLeftover = leftoverPath;
  }
}

function safeDiagnosticText(value) {
  return String(value ?? "")
    .replace(/([?&](?:token|alt|signature|x-goog-[^=]*)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[a-z0-9._~-]+/gi, "$1[redacted]");
}

function diagnosticStatus(error) {
  const candidates = [
    error?.status,
    error?.httpStatus,
    error?.statusCode,
    error?.customData?.status,
    error?.customData?.httpStatus,
    error?.customData?.statusCode
  ];
  return candidates.find(value => typeof value === "number" || (typeof value === "string" && value.trim())) ?? null;
}

export function groupSubmissionImageContext(storagePath, role) {
  const parts = typeof storagePath === "string" ? storagePath.split("/") : [];
  const valid = parts.length === 8 && parts[0] === "groupActivitySubmissions" && parts[3] === "groups";
  return {
    activityId: valid ? parts[2] : null,
    groupId: valid ? parts[4] : null,
    submissionId: valid ? parts[6] : null,
    role: role === "student" ? "student" : "teacher",
    storagePath: typeof storagePath === "string" ? safeDiagnosticText(storagePath) : ""
  };
}

export function reportGroupSubmissionImageLoadError({ image, error, role, storagePath, logger = console.error }) {
  if (image) image.alt = "Không tải được ảnh";
  const diagnostic = {
    event: "group-submission-image-load-failed",
    code: typeof error?.code === "string" ? error.code : null,
    message: safeDiagnosticText(error?.message || "Unknown Storage error"),
    serverStatus: diagnosticStatus(error),
    ...groupSubmissionImageContext(storagePath, role)
  };
  logger("[HCMA2][group-image-load]", diagnostic);
  return diagnostic;
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
