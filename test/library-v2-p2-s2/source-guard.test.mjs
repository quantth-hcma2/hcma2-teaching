// Library V2 P2-S2 - source guards: the four modules are pure and INERT, and nothing existing changed (byte pins).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const bytes = (p) => readFileSync(new URL(p, root));
const text = (p) => bytes(p).toString("utf8");
const sha = (p) => createHash("sha256").update(bytes(p)).digest("hex");
const NL = String.fromCharCode(10);
const MODULES = ["organization-context.mjs", "organization-queries.mjs", "organization-write-contract.mjs", "admin-feature-registry.mjs"];
const code = (p) => text(p).split(NL).filter((line) => !line.trim().startsWith("//")).join(NL);          // ignore comment lines

test("S2 modules plus the S3 view and S4 membership view modules are the only organization modules (no others)", () => {
  const rootMjs = readdirSync(new URL("./", root)).filter((f) => f.endsWith(".mjs")).sort();
  const baselineMjs = ["app-environment.mjs", "classroom-projection-launch.mjs", "contract-activation.mjs", "contract-editor.mjs", "contract-runtime.mjs", "contract-writer.mjs", "group-classroom-presentation.mjs", "group-classroom-timer.mjs", "group-clone.mjs", "group-file-link-safety.mjs", "group-membership.mjs", "group-pdf-export.mjs", "group-pdf-font-coverage.mjs", "group-pdf-runtime.mjs", "group-roster.mjs", "group-submission-upload.mjs", "library-hub-registry.mjs", "rich-text-contract.mjs", "rich-text-editor-serializer.mjs", "rich-text-editor.mjs", "rich-text-renderer.mjs", "session-info-compare.mjs", "session-reader-ui.mjs", "session-reader.mjs", "session-view.mjs", "trash-query-contract.mjs"];
  // P3-S2 aligned: the three pure curriculum modules are the only new root modules (guarded by test/library-v2-p3-s2/source-guard.test.mjs).
  assert.deepEqual(rootMjs, [...baselineMjs, ...MODULES, "organization-admin-view.mjs", "organization-membership-view.mjs", "teacher-organization-enrollment.mjs", "curriculum-model.mjs", "curriculum-queries.mjs", "curriculum-write-contract.mjs", "curriculum-admin-view.mjs", "curriculum-editor-view.mjs", "curriculum-clone-delete.mjs", "import-diagnostics.mjs", "import-normalize.mjs", "import-plan.mjs", "import-sha256.mjs", "import-template.mjs", "import-validate.mjs", "import-xlsx-container.mjs", "import-xlsx-extract.mjs", "import-xlsx-reader.mjs", "import-xlsx-worker.mjs", "import-capabilities.mjs", "import-xml-wellformed.mjs"].sort());   // P4-S2 aligned: the twelve additive inert import modules (guarded by test/library-v2-p4-s2/source-guard.test.mjs);   // P3-S4 aligned: the node editor view (guarded by test/library-v2-p3-s4)
});

test("modules are pure: only relative imports among themselves, no Firebase/network/storage/DOM access, no dynamic import", () => {
  for (const m of MODULES) {
    const src = code(m);
    const imports = [...src.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((x) => x[1]);
    for (const spec of imports) assert.ok(/^\.\/(organization-write-contract)\.mjs$/.test(spec), m + " imports " + spec);
    for (const token of ["firebase", "firestore", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "document.", "window.", "navigator.", "process.", "require(", "import(", "setTimeout", "Date.now", "Math.random"]) {
      assert.ok(!src.includes(token), m + " must not contain " + token);
    }
  }
  assert.deepEqual([...code("organization-queries.mjs").matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((x) => x[1]), ["./organization-write-contract.mjs"]);
});

test("references: only index.html (S3/S4 wiring) and the S3/S4 view modules import the S2 modules; the S2 modules themselves never reference index.html or the view", () => {
  const names = MODULES.map((m) => m.replace(".mjs", ""));
  const allowed = new Set([...MODULES, "index.html", "organization-admin-view.mjs", "organization-membership-view.mjs"]);
  const candidates = readdirSync(new URL("./", root)).filter((f) => f.endsWith(".mjs") || f.endsWith(".html") || f.endsWith(".css") || f.endsWith(".js"));
  for (const f of candidates) {
    if (allowed.has(f)) continue;
    const src = text(f);
    for (const n of names) assert.ok(!src.includes(n), f + " must not reference " + n);
  }
  for (const m of MODULES) assert.ok(!text(m).includes("organization-admin-view") && !text(m).includes("index.html"), m);
});

test("queries: no `in` / array-contains-any / or(), no query on `users`, only equality filters on organizationId or uid; organizations listing only in the Platform-Admin factory", () => {
  const src = code("organization-queries.mjs");
  for (const token of ['"in"', "'in'", "array-contains", "array-contains-any", "not-in", " or(", "collectionGroup", "'users'", '"users"']) assert.ok(!src.includes(token), "queries must not contain " + token);
  assert.equal(src.split("where(").length - 1, 2, "exactly two where() filters exist");
  assert.ok(src.includes("where(\"organizationId\", \"==\", singleOrganizationId(organizationId))"));
  assert.ok(src.includes("where(\"uid\", \"==\", singleUid(uid))"));
  // the organizations COLLECTION is queried (listed) only inside createPlatformAdminOrganizationQueries
  const platformStart = src.indexOf("export function createPlatformAdminOrganizationQueries");
  assert.ok(platformStart > 0);
  const ordinary = src.slice(0, platformStart), platform = src.slice(platformStart);
  assert.ok(!/collection\(db,\s*"organizations"\)/.test(ordinary), "ordinary factory must not list organizations");
  assert.ok(/collection\(db,\s*"organizations"\)/.test(platform) && platform.includes("listAllOrganizationsAsPlatformAdminOnly"));
  // every list is bounded
  assert.equal([...src.matchAll(/getDocs\(/g)].length, [...src.matchAll(/limit\(|where\("uid"/g)].length);
});

test("write contract: no user discovery, no Organization-Admin add path, serverTimestamp is injected (never imported)", () => {
  const src = code("organization-write-contract.mjs");
  assert.ok(!/\busers\b/.test(src.replace(/\bplatform `users`\b/g, "")), "write contract must not touch users");
  assert.ok(src.includes("createOrganizationWriteContract({ serverTimestamp } = {})"));
  for (const token of ["listUsers", "searchUsers", "discover", "invite"]) assert.ok(!src.includes(token), token);
  const exported = [...src.matchAll(/^export (?:const|function|class) ([A-Za-z0-9_]+)/gm)].map((x) => x[1]).sort();
  assert.deepEqual(exported, ["CAPABILITIES", "CAPABILITY_WRITE_CHUNK_DEFAULT", "DENIABLE_CAPABILITIES", "DISPLAY_NAME_MAX", "EMAIL_MAX", "MEMBERSHIP_ROLES", "MEMBERSHIP_STATUSES", "MEMBERSHIP_WRITE_CHUNK_DEFAULT", "NAME_MAX", "NAME_MIN", "ORGANIZATION_CODE_PATTERN", "ORGANIZATION_SCHEMA_VERSION", "ORGANIZATION_STATUSES", "OrganizationContractError", "capabilityDocId", "chunkCapabilityWrites", "chunkMembershipWrites", "chunkWrites", "createOrganizationWriteContract", "membershipDocId", "validateCapabilities", "validateDeniedCapabilities", "validateMembershipRole", "validateMembershipStatus", "validateOrganizationCode", "validateOrganizationName"]);
});

test("public API of each module is pinned", () => {
  const api = (p) => [...code(p).matchAll(/^export (?:const|function|class) ([A-Za-z0-9_]+)/gm)].map((x) => x[1]).sort();
  assert.deepEqual(api("organization-context.mjs"), ["ORGANIZATION_PREFERENCE_KEY_PREFIX", "organizationPreferenceKey", "resolveOrganizationContext"]);
  assert.deepEqual(api("organization-queries.mjs"), ["ORGANIZATION_PAGE_SIZE_DEFAULT", "ORGANIZATION_PAGE_SIZE_MAX", "createOrganizationQueries", "createPlatformAdminOrganizationQueries"]);
  assert.deepEqual(api("admin-feature-registry.mjs"), ["ADMIN_FEATURES", "ADMIN_FEATURE_AUDIENCES", "adminFeaturesForAudience", "getAdminFeature", "visibleAdminFeatures"]);
});

test("nothing existing changed: Rules (deployed artifact), indexes, UI, package, vendor and existing modules are byte-pinned; no Storage or root firebase.json", () => {
  const pinned = {
    "firestore.rules.production-candidate": "7f7c790e403762800dc27879ff851cb875064d8a02076b2a4f7f3c7163510485", // P3-S1 candidate Rules (deployed 7EA5D7A5... + the P3 region)
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88"
  };
  for (const [file, hash] of Object.entries(pinned)) assert.equal(sha(file), hash, file);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
});
