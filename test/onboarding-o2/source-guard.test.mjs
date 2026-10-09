// Onboarding O2 - source guards: the change set is exactly the post-approval Organization continuation. V1 approval semantics are pinned.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const shaOf = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
import { reverseO2Edits, IMPORT_ADDED, BLOCK_ADDED, APPROVE_O2 } from "./o2-edits.mjs";
import { reverseO1Edits } from "../o1-search/o1-edits.mjs";
import { reverseS3IndexEdits, reverseS3AdminViewEdits } from "../library-v2-p3-s3/s3-edits.mjs";   // P3-S3 aligned: older byte-pins keep their meaning by reversing the P3-S3 edits first
const html = text("index.html");
const mod = text("teacher-organization-enrollment.mjs");
const code = (src) => src.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);

test("index.html delta versus the released baseline is EXACTLY the three O2 edits (reverse them and the baseline hash returns)", () => {
  // O1 (Add-Teacher exception search) adds its own delta after O2: reverse it first, then the O2 edits must restore the released S4 index.html
  assert.equal(shaOf(reverseO2Edits(reverseO1Edits(reverseS3IndexEdits(html)))), "eb043d94d150babd1312e97378dc903a153bba7624ae2d0318e8487cd3cff079");
});

test("V1 approval semantics: the write, toast, callback position and error path are byte-identical; the continuation is additive, after the try/catch, not awaited, never throws", () => {
  const i = html.indexOf("async function approveTeacher");
  const body = html.slice(i, html.indexOf("async function suspendTeacher", i)).split(CRLF).join(NL).trimEnd();
  assert.equal(body, APPROVE_O2, "approveTeacher is exactly the approved text");
  for (const original of [
    `await updateDoc(doc(db,"users",uid), { status:"active", approvedAt: serverTimestamp(), approvedBy: STATE.user.uid, updatedAt: serverTimestamp() });`,
    `toast("Đã duyệt tài khoản giảng viên.","ok");`, `cb && cb();`, `}catch(e){ toast(mapError(e),"err"); }`
  ]) assert.ok(body.includes(original), original);
  // order: write -> approved flag -> toast -> cb ; continuation after the catch, only if approved
  const order = ["await updateDoc(", "approved = true;", 'toast("Đã duyệt', "cb && cb();", "}catch(e)", "if(approved) organizationEnrollmentAfterApproval(uid);"].map((s) => body.indexOf(s));
  assert.ok(order.every((x, k) => x > -1 && (k === 0 || x > order[k - 1])), "statement order");
  assert.ok(!body.includes("await organizationEnrollment") && !/await\s+organizationEnrollment/.test(html), "the continuation is never awaited");
  assert.equal((body.match(/updateDoc\(/g) || []).length, 1, "exactly one write in approveTeacher");
  const hook = html.slice(html.indexOf("function organizationEnrollmentAfterApproval"), html.indexOf("function organizationEnrollmentAfterApproval") + 900);
  assert.ok(hook.includes("offerAfterApproval(uid).catch(()=>{});") && hook.includes("}catch(e){ console.warn("), "wrapped: never throws into the approval");
});

test("neighbouring V1 handlers and entry points are untouched: suspend, reactivate, both approval call sites, Admin and teacher menus", () => {
  const fn = (name, next) => { const i = html.indexOf("async function " + name); return html.slice(i, html.indexOf(next, i)); };
  assert.equal(shaOf(fn("suspendTeacher", "async function reactivateTeacher")), "14f0de8c08b0d149f2869c58ce31bc3cd443657d18979c31c061feaa0f5c8f14");
  assert.equal(shaOf(fn("reactivateTeacher", "async function sendResetLink")), "210fcc919cce5b3f970dfb13a90019b7e8c2c199c6a768c91dff7694fdb618fe");
  assert.ok(html.includes('$$("[data-approve]").forEach(b=>b.onclick=()=>approveTeacher(b.dataset.approve, ()=>adminOverview(c)));'), "overview entry point");
  assert.ok(html.includes('if(act==="approve") approveTeacher(id);'), "teachers-screen entry point");
  assert.equal((html.match(/approveTeacher\(/g) || []).length, 3, "definition + exactly the two existing call sites");
  const menu = html.slice(html.indexOf("const ADMIN_MENU = ["), html.indexOf("];", html.indexOf("const ADMIN_MENU = [")));
  assert.equal(shaOf(menu), "b6d282dc85f835c37c8311a2b9a57385b31e93d26f35014d6ce1a66ab057ea8e");
  const teacher = html.slice(html.indexOf("const TEACHER_MENU = ["), html.indexOf("];", html.indexOf("const TEACHER_MENU = [")));
  assert.equal(shaOf(teacher), "3bff38d3c4cdadc2c370985252e7909c256905d0973356e7d605892a2e9f46d8");
});

test("module: relative imports only (S4 view + S2 contract through it); no Firebase import; no write of any kind except through the injected writer; no `users` write path", () => {
  const src = code(mod);
  const imports = [...src.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((x) => x[1]);
  assert.deepEqual(imports, ["./organization-membership-view.mjs"]);
  for (const token of ["firebase", "setDoc", "updateDoc", "addDoc", "deleteDoc", "writeBatch", "runTransaction", "deleteField", "increment(", "fetch(", "localStorage", "import(", "serverTimestamp", "schemaVersion", "createdAt:", "updatedAt:", "addedBy:", "orgRole", "userCapabilities", "capabilities", "org_admin"]) {
    assert.ok(!src.includes(token), "module must not contain " + token);
  }
  assert.ok(!/["']users["']/.test(src), "the module never names the users collection (the fresh read is injected as readUser)");
  assert.equal((src.match(/readUser\(/g) || []).length, 2, "exactly two fresh-user reads: the load and the per-write re-check");
  assert.ok(!/contract\.build/.test(src), "payloads come only from planMembershipAdditions (S4 contract path)");
  assert.ok(src.includes("planMembershipAdditions(") && src.includes("writer.createMany(db, plan.toCreate)"));
  const audits = [...src.matchAll(/logAudit\(([^;]*)\);/g)].map((m) => m[1]);
  assert.equal(audits.length, 1);
  assert.ok(audits[0].startsWith('"organization.members.add", "organization", organizationId, { count: 1, uids: [uid], skipped: 0, via: AUDIT_PROVENANCE }'));
});

test("no Organization literal anywhere in generic code: neither the HCMA2 code nor the production Organization id appears in the module or the O2 index.html additions", () => {
  const added = [IMPORT_ADDED, BLOCK_ADDED, APPROVE_O2].join(NL);
  for (const forbidden of [/hcma2/i, /msioOvaoupq48xK1uB8J/, /Học viện Chính trị/i]) {
    assert.ok(!forbidden.test(mod), "module must not contain " + forbidden);
    assert.ok(!forbidden.test(added), "O2 index.html additions must not contain " + forbidden);
  }
  // the module and tests may only know generic organization concepts
  assert.ok(!/hcma2/i.test(readdirSync(new URL("./", root)).filter((f) => f.startsWith("teacher-organization")).join(",")));
});

test("the 20/21 numbers are a defensive query bound, not a contract: named constants with an explicit 'not a business limit' note, absent from Rules, indexes and schema modules", () => {
  assert.ok(mod.includes("NOT a business limit, schema constraint or architecture rule"));
  assert.ok(mod.includes("export const ACTIVE_ORGANIZATION_QUERY_LIMIT = ACTIVE_ORGANIZATION_DISPLAY_COUNT + 1;"));
  for (const f of ["organization-write-contract.mjs", "firestore.rules.production-candidate"]) assert.ok(!/ACTIVE_ORGANIZATION/.test(text(f)), f);
});

test("static imports only, no new collection names, and the single new query is one equality filter without orderBy (no index)", () => {
  assert.equal(html.split("import(").length - 1, 1, "dynamic import count unchanged");
  const names = new Set();
  for (const m of html.matchAll(/(?:collection|doc|collectionGroup)\((?:db|publicDb)\s*,\s*"([A-Za-z]+)"/g)) names.add(m[1]);
  for (const m of html.matchAll(/(?:collection|doc)\((?:db|publicDb)\s*,\s*(GROUP_COLLECTION|GROUP_JOIN_COLLECTION)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), ["GROUP_COLLECTION", "GROUP_JOIN_COLLECTION", "auditLogs", "classes", "joinCodes", "knowledgeJoinCodes", "knowledgeSessions", "library", "questionSets", "questions", "responses", "sessionTokens", "sessions", "users"]);
  const q = code(mod);
  assert.equal((q.match(/where\(/g) || []).length, 1);
  assert.ok(q.includes('where("status", "==", "active"), limit(ACTIVE_ORGANIZATION_QUERY_LIMIT)') && !q.includes("orderBy"));
});

test("Rules, indexes, Storage, package, vendor and every released organization module are byte-pinned (no Rules/index/Storage change)", () => {
  const pinned = {
    "firestore.rules.production-candidate": "f6b9de012c7f7d3d0fce6efc19d760b3b2e0bca9c9979811786ede93c9b17d4a", // P3-S1 candidate Rules (deployed 7EA5D7A5... + the P3 region)
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "organization-admin-view.mjs": "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "group-clone.mjs": "a357fc2d06a4c47c24a8cd0167539299976edc2444cf2fceac7aa14ab7bbf496",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99",
    "vendor/pdf/SHA256SUMS.txt": "90c84e1b2eb22f0544e161d5a8fa34421051a34b486a725086484edeab812c88"
  };
  for (const [file, hash] of Object.entries(pinned)) assert.equal(file === "organization-admin-view.mjs" ? shaOf(reverseS3AdminViewEdits(text(file))) : sha(file), hash, file);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
});
