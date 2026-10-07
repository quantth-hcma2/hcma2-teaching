// O1 - source guards: the change set is exactly the Add-Teacher exception search. The S4 membership authority is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { reverseO1Edits, IMPORT_NEW, CONST_NEW, DEP_NEW } from "./o1-edits.mjs";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, root))).digest("hex");
const shaOf = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const NL = String.fromCharCode(10);
const html = text("index.html");
const view = text("organization-membership-view.mjs");
const code = (src) => src.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
const src = code(view);

test("index.html delta versus the released O2 baseline is EXACTLY the three O1 edits (reverse them and the released hash d5aa6c45... returns)", () => {
  assert.equal(shaOf(reverseO1Edits(html)), "d5aa6c454793a523e8827cbd62bf80f3393b611d1f27db5ca3211f3f1cefec3a");
});

test("old paged / multi-select picker is completely removed from the module and from index.html", () => {
  for (const token of ["TEACHER_PICKER_PAGE_SIZE", "renderTeacherPickerHtml", "createActiveTeacherPickerQuery", "pageActiveTeachersForMembershipPicker", "orgPickerMore", "orgPickerSubmit", "orgPickerList", "orgPickerSearch", "data-picker", "teacherCursor", "ORGANIZATION_TEACHER_PICKER", "picker:", "selected.add", "startAfter(cursor"]) {
    assert.ok(!view.includes(token), "module must not contain " + token);
  }
  for (const token of ["TEACHER_PICKER_PAGE_SIZE", "createActiveTeacherPickerQuery", "pageActiveTeachersForMembershipPicker", "ORGANIZATION_TEACHER_PICKER", "picker:ORGANIZATION", "orgPicker", "data-picker"]) assert.ok(!html.includes(token), "index.html must not contain " + token);
  assert.ok(!/where\("role"/.test(view) && !/where\("status"/.test(view), "no population query by role/status");
});

test("exact search query: email >= term, email <= term + U+F8FF, orderBy email, limit(21) - the only users read, no cursor, no loop, no unbounded read", () => {
  assert.ok(src.includes('query(collection(db, "users"), where("email", ">=", term), where("email", "<=", term + String.fromCharCode(0xf8ff)), orderBy("email"), limit(SEARCH_QUERY_LIMIT))'));
  assert.equal((src.match(/"users"/g) || []).length, 1, "users is named in exactly one place");
  assert.equal((src.match(/where\(/g) || []).length, 2);
  assert.equal((src.match(/orderBy\(/g) || []).length, 1);
  assert.ok(!/startAfter|startAt|endBefore|getCountFromServer|collectionGroup|onSnapshot/.test(src));
  assert.ok(!src.includes("getDocs(collection"), "no unbounded collection read");
  assert.equal((src.match(/getDocs\(/g) || []).length, 1, "a single bounded getDocs call in the module");
  assert.ok(src.includes("export const SEARCH_MIN_CHARS = 3;") && src.includes("export const SEARCH_DISPLAY_COUNT = 20;") && src.includes("export const SEARCH_QUERY_LIMIT = SEARCH_DISPLAY_COUNT + 1;"));
  assert.ok(src.includes("if (term.length < SEARCH_MIN_CHARS) throw new RangeError"), "a short term never reaches Firestore");
  assert.ok(view.includes("NOT a business limit or architecture contract"), "20 is documented as a per-search UX cap only");
  for (const f of ["firestore.rules.production-candidate", "firestore.indexes.json", "organization-write-contract.mjs", "organization-queries.mjs"]) assert.ok(!/SEARCH_DISPLAY_COUNT|SEARCH_QUERY_LIMIT/.test(text(f)), "20/21 appears in no Rules, index or schema file: " + f);
});

test("search runs ONLY on Enter / TÌM (form submit): no debounce, no input listener, no timers; stale-result protection and close/Esc invalidation are wired", () => {
  assert.ok(!/setTimeout|setInterval|debounce|requestAnimationFrame/.test(src), "no timers or debounce in the module");
  assert.ok(!/\.oninput|addEventListener\("input"|addEventListener\("keyup"|onkeyup|onkeydown|\.onchange/.test(src), "no input-driven searching");
  assert.ok(src.includes('modal$("#orgSearchForm").onsubmit = (event) => { event.preventDefault(); search(); };'));
  assert.ok(src.includes("const mySeq = guard.next();") && (src.match(/guard\.isCurrent\(mySeq\)/g) || []).length === 2 && (src.match(/guard\.invalidate\(\)/g) || []).length === 2);
  assert.ok(src.includes("if (term.length < SEARCH_MIN_CHARS) { state = { status: \"tooShort\""), "the controller shows a message instead of querying below 3 characters");
});

test("membership authority unchanged: payloads only via planMembershipAdditions/buildNewMembership; fresh user+Organization+exact-membership re-checks before the write; one teacher per click; no bulk path", () => {
  const core = src.slice(src.indexOf("export async function addTeacherFromSearch"), src.indexOf("// controller") > 0 ? undefined : undefined);
  const body = src.slice(src.indexOf("export async function addTeacherFromSearch"), src.indexOf("export function createOrganizationMembershipSection"));
  const order = ["readUser(db, uid)", "queries.organizationById(db, organization.id)", "queries.membershipOf(db, organization.id, uid)", "planMembershipAdditions(", "writer.createMany(db, plan.toCreate)", "logAudit(\"organization.members.add\""].map((s) => body.indexOf(s));
  assert.ok(order.every((x, i) => x > -1 && (i === 0 || x > order[i - 1])), "re-check order then write then audit");
  assert.ok(body.includes("count: 1, uids: [uid], skipped: 0, via: EXCEPTION_SEARCH_PROVENANCE"));
  assert.ok(src.includes('export const EXCEPTION_SEARCH_PROVENANCE = "exception-search";'));
  assert.deepEqual([...new Set([...src.matchAll(/contract\.build[A-Za-z]+/g)].map((m) => m[0]))].sort(), ["contract.buildMembershipStatusChange", "contract.buildNewMembership"], "only the two S4 builders exist in the module (new membership inside planMembershipAdditions, status change in the lifecycle actions)");
  assert.ok(!/contract\.build/.test(body), "the O1 write core reaches the contract only through planMembershipAdditions");
  assert.ok(!/createMany\([^)]*\[\.\.\./.test(src) && !/selectedIds|selectAll|data-search-all|multi/i.test(src), "no bulk / multi-select / select-all");
  assert.equal((src.match(/data-search-add=/g) || []).length, 1, "exactly one add-button markup (one teacher per click)");
  assert.ok(src.includes('if (!row || row.kind !== "eligible" || row.busy) return;'), "double-click protection");
  const audits = [...src.matchAll(/logAudit\(([^;]*?)\);/g)].map((m) => m[1].split(",")[0].trim());
  assert.deepEqual(audits.sort(), ['"organization.member." + action', '"organization.members.add"'].sort(), "only the two existing audit actions");
});

test("O1 does not touch O2, approveTeacher, the member list/ordering/lifecycle, Rules, indexes, Storage, package, vendor or the S2/S3 modules (byte-pinned)", () => {
  const pinned = {
    "teacher-organization-enrollment.mjs": "75d6c6afaf657f118408c9182faecd560d259ac5d97eb796695bd9b88023653e",
    "organization-queries.mjs": "a0c64c8f4105d9b83dd5672df4b6c9a7e809b75e1b9517820fbca2571e50c0f2",
    "organization-write-contract.mjs": "b26cc200d1e918998a780d81221810e85249ca57f80b080623cfeeb016d58713",
    "organization-context.mjs": "406490f2338dd6fd645b0a1329bb1e5d8b00c02cfb0e36b8f075e0fa79f6ed30",
    "organization-admin-view.mjs": "7f7f535041db3ec2f31411cca8afdbabe985552174620105b5132bff5df4255f",
    "admin-feature-registry.mjs": "4e97434f69907931bdabb5eaf46fe4a765b62e122ba1f938a28adaeb04316413",
    "library-hub-registry.mjs": "37ef4f919d4604b4233b46cd197e2481b5fdf79c8c7f5229f81eb656a33688a0",
    "trash-query-contract.mjs": "a4639903403d88bb4cc1bb0d197e6c16a0b967242554975f2c47b33121efc7ea",
    "rich-text-contract.mjs": "d306f20778d5f01137ea549dff4b3b97ed0972d19065f15cb955a74df3e97c57",
    "group-pdf-runtime.mjs": "0dabe62465cc913188e5f34c35d811ffe0f0d626642e7d04aa8933fc6c0f06e3",
    "firestore.rules.production-candidate": "a0b206fcdda3843db2e08eeeeb00a9704b5a1415b97b9e488477d8f21aa4921d", // P3-S1 candidate Rules (deployed 7EA5D7A5... + the P3 region)
    "firestore.rules": "a033e20c0d6c7eeb23cc1e76d98e5a4d246bead5becfcc14574c4f98b9fed538",
    "firestore.indexes.json": "a27b5a20c63e1b446f63221a6c1fa93b31ac95a6556c6009e44a45f4ca354d51",
    "package.json": "446bef0b4c5941557b8a5fe4d2c7b20f73665086012e8cdc3f39ca8c7d6c8ba1",
    "package-lock.json": "507fee2f7652fa8ac0b1e73ce34622b49f5ac8959895ad0aa7d69d4c34e6f9ac",
    "vendor/xlsx.full.min.js": "c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99"
  };
  for (const [file, hash] of Object.entries(pinned)) assert.equal(sha(file), hash, file);
  for (const f of ["storage.rules", "firebase.json", "cors.json"]) assert.ok(!existsSync(new URL(f, root)), f + " must not exist at the repository root");
  // the member list, newest-first query, lifecycle actions and archived handling are still present, unchanged in behaviour (S4 guards/e2e re-prove them)
  for (const token of ["export function renderMembersSectionHtml", "export function availableMemberActions", "export function summarizeMembers", "export function renderAddTeacherActionHtml", "function confirmAction(", "async function reload()", "queries.membersOfOrganization("]) assert.ok(view.includes(token), token);
  assert.equal(html.split("import(").length - 1, 1, "no new dynamic import()");
  assert.ok(html.includes(IMPORT_NEW) && html.includes(CONST_NEW) && html.includes(DEP_NEW));
});
