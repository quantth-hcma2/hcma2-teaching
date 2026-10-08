// P4-S1 helper (kept as evidence): the historical suites pin the byte SHA-256 of firestore.rules.production-candidate (precedent: P3-S1 re-pinned the P2 pins when the artifact changed).
// When the Rules artifact changes, those exact-hash pins are re-pinned to the NEW artifact so every historical suite keeps running against (and therefore proving compatibility with) the candidate.
// Usage: node test/library-v2-p4-s1/repin-rules.mjs  (idempotent; replaces the deployed P3-S1 SHA and any earlier P4-S1 interim SHA with the current candidate SHA in test/**/*.mjs except test/library-v2-p4-s1)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const current = createHash("sha256").update(readFileSync(path.join(REPO, "firestore.rules.production-candidate"))).digest("hex");
const OLD = ["a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d", ...(process.env.P4S1_INTERIM_SHAS || "").split(",").filter(Boolean)].filter((s) => s !== current);
const walk = (dir, acc = []) => { for (const e of readdirSync(dir)) { const p = path.join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e === "node_modules" || p.endsWith(path.join("test", "library-v2-p4-s1"))) continue; walk(p, acc); } else if (e.endsWith(".mjs")) acc.push(p); } return acc; };
let changed = 0;
for (const file of walk(path.join(REPO, "test"))) {
  let text = readFileSync(file, "utf8"), next = text;
  for (const old of OLD) next = next.split(old).join(current).split(old.toUpperCase()).join(current.toUpperCase());
  if (next !== text) { writeFileSync(file, next); changed++; console.log("re-pinned", path.relative(REPO, file)); }
}
console.log("current candidate SHA-256", current, "files changed", changed);
