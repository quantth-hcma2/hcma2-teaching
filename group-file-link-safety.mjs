// GATE 2A-S: single source of truth for judging whether a Group Discussion
// groupActivities/{id}/files/{fileId}.link value is safe to render as a clickable anchor.
// http/https only; anything else (including a malformed value, or any other scheme such as
// javascript:/data:/vbscript:/file:/blob:, or a protocol-relative //host value) is unsafe and
// must never become an href. This is the client-side render-time barrier — it is required even
// for a historical document that may have bypassed the Firestore Rules scheme check (Rules only
// started enforcing this at Gate 2A-S; a pre-existing bad value must still fail closed here).
// Group Discussion only — no other feature reads this module.
export function safeGroupFileLinkUrl(link) {
  if (typeof link !== "string" || link.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}
