// LIBRARY V2 P3-S1 - curriculum Rules authorization matrix (Firestore emulator, EXACT candidate Rules, synthetic data only).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, actors, candidateRules, seedWorld, newFwPayload, fwRename, fwTransition, newNodePayload, lessonPayload, nodeEdit,
  fwRef, nodeRef, nodesCol, fwDoc, nodeDoc, capSeed, D,
  assertFails, assertSucceeds, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, limit, orderBy, serverTimestamp, doc, Timestamp
} from "./helpers.mjs";

const env = await makeEnv("demo-p3s1-rules", candidateRules());
const as = actors(env);
test.after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await seedWorld(env); });

const ok = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);

// principals that may read/write curriculum of organization A (when the organization is active): Platform Admin, Organization Admin, capability holder
const ALLOWED_A = ["pa", "oaA", "capA"];
// principals that must NOT touch curriculum of organization A
const DENIED_A = [
  ["mA", "ordinary active member without capability"], ["revA", "member with another capability only (library.review)"],
  ["mB", "member of another organization"], ["capB", "capability holder of ANOTHER organization"], ["oaB", "Organization Admin of ANOTHER organization"],
  ["tSusp", "globally suspended account with active membership and capability (I3)"], ["capSuspMem", "suspended membership with capability"],
  ["capRemoved", "removed membership with capability"], ["ghost", "capability document without membership"], ["noMember", "active teacher without membership"],
  ["tPend", "pending teacher"], ["paSusp", "suspended Platform Admin"]
];

test("framework read: allowed principals read; every other principal (incl. suspended, other organization, unauthenticated, anonymous provider) is denied", async () => {
  for (const u of ALLOWED_A) await ok(getDoc(fwRef(as(u), "fwA_active")));
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(getDoc(fwRef(as(u), "fwA_active"))), u + ": " + why);
  await no(getDoc(fwRef(as(null), "fwA_active")));
  await no(getDoc(fwRef(as("pa", "anonymous"), "fwA_active")));
  // Platform Admin reads every organization and a non-existent document does not error
  await ok(getDoc(fwRef(as("pa"), "fwB_draft"))); await ok(getDoc(fwRef(as("pa"), "fwC_active"))); await ok(getDoc(fwRef(as("pa"), "does-not-exist")));
  // cross-organization: a capability holder / Organization Admin of B cannot read A, and vice versa
  await no(getDoc(fwRef(as("capA"), "fwB_draft"))); await no(getDoc(fwRef(as("oaA"), "fwB_draft")));
  await ok(getDoc(fwRef(as("oaB"), "fwB_draft"))); await ok(getDoc(fwRef(as("capB"), "fwB_draft")));
});

test("framework list: organization-filtered queries work for governance principals; unfiltered / other-organization queries are denied (I6); Platform Admin may list platform-wide by Rules", async () => {
  const fl = (db, org) => getDocs(query(collection(db, "curriculumFrameworks"), where("organizationId", "==", org), limit(101)));
  for (const u of ALLOWED_A) { const s = await ok(fl(as(u), "orgA")); assert.equal(s.size, 4, u); }
  await no(fl(as("mA"), "orgA")); await no(fl(as("mB"), "orgA")); await no(fl(as("capB"), "orgA")); await no(fl(as("oaB"), "orgA")); await no(fl(as("tSusp"), "orgA"));
  await no(fl(as(null), "orgA")); await no(fl(as("revA"), "orgA"));
  for (const u of ["oaA", "capA", "mA"]) await no(getDocs(collection(as(u), "curriculumFrameworks")));         // unfiltered
  await no(getDocs(query(collection(as("oaA"), "curriculumFrameworks"), where("organizationId", "==", "orgB"), limit(101)))); // another organization's id
  await no(getDocs(query(collection(as("oaA"), "curriculumFrameworks"), where("status", "==", "active"))));       // filter on something else
  await ok(fl(as("pa"), "orgB")); await ok(getDocs(collection(as("pa"), "curriculumFrameworks")));
  // equality-only multi-field query (no composite index needed in production; here: Rules compatibility)
  await ok(getDocs(query(collection(as("oaA"), "curriculumFrameworks"), where("organizationId", "==", "orgA"), where("status", "==", "active"))));
});

test("archived organization (I4): Platform Admin and Organization Admin keep governance READ; a capability holder, ordinary members and outsiders do not", async () => {
  for (const u of ["pa", "oaC"]) { await ok(getDoc(fwRef(as(u), "fwC_active"))); await ok(getDoc(nodeRef(as(u), "fwC_active", "s1"))); }
  const fl = (db) => getDocs(query(collection(db, "curriculumFrameworks"), where("organizationId", "==", "orgC"), limit(101)));
  const nl = (db) => getDocs(query(nodesCol(db, "fwC_active"), where("organizationId", "==", "orgC"), limit(5001)));
  for (const u of ["pa", "oaC"]) { await ok(fl(as(u))); await ok(nl(as(u))); }
  for (const u of ["capC", "mC", "oaA", "capA"]) { await no(getDoc(fwRef(as(u), "fwC_active"))); await no(getDoc(nodeRef(as(u), "fwC_active", "s1"))); await no(fl(as(u))); await no(nl(as(u))); }
});

test("framework create: allowed principals create a never-activated draft in an ACTIVE organization; everyone else is denied", async () => {
  let n = 0;
  for (const u of ALLOWED_A) await ok(setDoc(fwRef(as(u), "new_" + u + "_" + n++), newFwPayload("orgA", u)));
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(setDoc(fwRef(as(u), "x_" + u), newFwPayload("orgA", u))), u + ": " + why);
  await no(setDoc(fwRef(as(null), "x_anon"), newFwPayload("orgA", "pa")));
  await no(setDoc(fwRef(as("pa", "anonymous"), "x_anon2"), newFwPayload("orgA", "pa")));
  // cross-organization creation
  await no(setDoc(fwRef(as("oaB"), "x1"), newFwPayload("orgA", "oaB"))); await no(setDoc(fwRef(as("capB"), "x2"), newFwPayload("orgA", "capB")));
  await no(setDoc(fwRef(as("oaA"), "x3"), newFwPayload("orgB", "oaA"))); await ok(setDoc(fwRef(as("pa"), "x4"), newFwPayload("orgB", "pa")));
  // archived organization: EVERY writer is denied, including the Platform Admin (curriculum has no governance-write exception)
  for (const u of ["pa", "oaC", "capC"]) await no(setDoc(fwRef(as(u), "xc_" + u), newFwPayload("orgC", u)));
  // missing organization = evaluation error = denial
  await no(setDoc(fwRef(as("pa"), "xm"), newFwPayload("orgMissing", "pa")));
});

test("framework create: schema allowlist, lifecycle seed state and server-stamped fields are enforced", async () => {
  const pa = as("pa"); let n = 0; const id = () => "s_" + n++;
  await ok(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa")));
  const bad = [
    ["status active", { status: "active" }], ["status archived", { status: "archived" }], ["status unknown", { status: "retired" }],
    ["scope platform", { scope: "platform" }], ["scope missing value", { scope: "" }], ["schemaVersion 2", { schemaVersion: 2 }],
    ["name too short", { name: "ab" }], ["name too long", { name: "x".repeat(121) }], ["name not a string", { name: 123 }],
    ["createdBy forged", { createdBy: "someoneElse" }], ["createdAt client date", { createdAt: D(9) }], ["updatedAt client date", { updatedAt: D(9) }],
    ["extra key", { description: "x" }], ["activatedAt present", { activatedAt: serverTimestamp() }],
    ["statusChangedAt present", { statusChangedAt: serverTimestamp() }], ["statusChangedBy present", { statusChangedBy: "pa" }],
    ["organizationId not a string", { organizationId: 5 }]
  ];
  for (const [label, over] of bad) await assert.doesNotReject(no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", over))), label);
  for (const key of ["schemaVersion", "organizationId", "scope", "name", "status", "createdAt", "createdBy", "updatedAt"]) {
    const p = newFwPayload("orgA", "pa"); delete p[key];
    await assert.doesNotReject(no(setDoc(fwRef(pa, id()), p)), "missing " + key);
  }
  // cloneSource: same-organization source ok; other organization, missing source, extra keys, bad counts denied
  await ok(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: 2 } })));
  await ok(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_archived", nodeCount: 0 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwB_draft", nodeCount: 2 } })));   // cross-organization clone marker
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "nope", nodeCount: 2 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: 2, extra: 1 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active" } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: -1 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: 5001 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: 1.5 } })));
  await no(setDoc(fwRef(pa, id()), newFwPayload("orgA", "pa", { cloneSource: "fwA_active" })));
});

test("framework update: rename in draft/active by allowed principals; archived is read-only; other principals denied", async () => {
  for (const u of ALLOWED_A) { await ok(updateDoc(fwRef(as(u), "fwA_draft"), fwRename("Ten moi " + u))); await ok(updateDoc(fwRef(as(u), "fwA_active"), fwRename("Ten moi " + u))); }
  for (const u of ALLOWED_A) await no(updateDoc(fwRef(as(u), "fwA_archived"), fwRename("Khong duoc doi ten")));
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(updateDoc(fwRef(as(u), "fwA_draft"), fwRename("Bi chan"))), u + ": " + why);
  await no(updateDoc(fwRef(as(null), "fwA_draft"), fwRename("Bi chan")));
  await no(updateDoc(fwRef(as("oaB"), "fwA_draft"), fwRename("Bi chan"))); await no(updateDoc(fwRef(as("oaA"), "fwB_draft"), fwRename("Bi chan")));
  await no(updateDoc(fwRef(as("pa"), "fwA_draft"), fwRename("ab")));                    // name bounds
  await no(updateDoc(fwRef(as("pa"), "fwA_draft"), { name: "Ten khac", updatedAt: D(9) })); // updatedAt must be request.time
  // archived organization: no one, including the Platform Admin, edits curriculum
  for (const u of ["pa", "oaC", "capC"]) { await no(updateDoc(fwRef(as(u), "fwC_draft"), fwRename("Bi chan C"))); await no(updateDoc(fwRef(as(u), "fwC_active"), fwRename("Bi chan C"))); }
});

test("framework update: immutable fields cannot change; unknown keys rejected; activatedAt/status metadata cannot be forged in a same-status write", async () => {
  const pa = as("pa");
  const bad = [
    ["organizationId", { organizationId: "orgB" }], ["scope", { scope: "platform" }], ["createdBy", { createdBy: "x" }], ["createdAt", { createdAt: D(9) }],
    ["schemaVersion", { schemaVersion: 2 }], ["new cloneSource", { cloneSource: { frameworkId: "fwA_active", nodeCount: 1 } }], ["unknown key", { description: "x" }],
    ["activatedAt injected on draft", { activatedAt: serverTimestamp() }], ["statusChangedAt injected", { statusChangedAt: serverTimestamp() }],
    ["statusChangedBy injected", { statusChangedBy: "pa" }]
  ];
  for (const [label, over] of bad) await assert.doesNotReject(no(updateDoc(fwRef(pa, "fwA_draft"), { ...fwRename("Ten hop le"), ...over })), "draft: " + label);
  await no(updateDoc(fwRef(pa, "fwA_active"), { ...fwRename("Ten hop le"), activatedAt: serverTimestamp() }));     // re-stamp activatedAt
  await no(updateDoc(fwRef(pa, "fwA_active"), { ...fwRename("Ten hop le"), statusChangedBy: "forged" }));
  // a framework created WITH cloneSource keeps it immutable
  await ok(setDoc(fwRef(pa, "cl1"), newFwPayload("orgA", "pa", { cloneSource: { frameworkId: "fwA_active", nodeCount: 2 } })));
  await ok(updateDoc(fwRef(pa, "cl1"), fwRename("Ban sao doi ten")));
  await no(updateDoc(fwRef(pa, "cl1"), { ...fwRename("Ban sao"), cloneSource: { frameworkId: "fwA_active", nodeCount: 3 } }));
  await no(updateDoc(fwRef(pa, "cl1"), { ...fwRename("Ban sao"), cloneSource: null }));
});

test("framework lifecycle: only draft->active (stamps activatedAt), active->archived and archived->active are accepted, with writer-stamped metadata", async () => {
  const pa = as("pa");
  const all = ["draft", "active", "archived"];
  const seedFor = { draft: "fwA_draft", active: "fwA_active", archived: "fwA_archived" };
  const allowed = new Set(["draft>active", "active>archived", "archived>active"]);
  for (const from of all) for (const to of all) {
    if (from === to) continue;
    const extra = from === "draft" && to === "active" ? { activatedAt: serverTimestamp() } : {};
    const p = updateDoc(fwRef(pa, seedFor[from]), fwTransition("pa", to, extra));
    if (allowed.has(from + ">" + to)) await ok(p); else await no(p);
    await env.clearFirestore(); await seedWorld(env);
  }
  // metadata discipline
  await no(updateDoc(fwRef(pa, "fwA_draft"), { status: "active", activatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));                         // no statusChanged*
  await no(updateDoc(fwRef(pa, "fwA_draft"), fwTransition("someoneElse", "active", { activatedAt: serverTimestamp() })));                                  // wrong statusChangedBy
  await no(updateDoc(fwRef(pa, "fwA_draft"), { status: "active", statusChangedAt: D(9), statusChangedBy: "pa", activatedAt: serverTimestamp(), updatedAt: serverTimestamp() })); // client time
  await no(updateDoc(fwRef(pa, "fwA_draft"), fwTransition("pa", "active")));                                                                              // first activation must stamp activatedAt
  await no(updateDoc(fwRef(pa, "fwA_draft"), fwTransition("pa", "active", { activatedAt: D(9) })));                                                        // activatedAt must be request.time
  await no(updateDoc(fwRef(pa, "fwA_active"), fwTransition("pa", "archived", { activatedAt: serverTimestamp() })));                                        // activatedAt immutable afterwards
  await no(updateDoc(fwRef(pa, "fwA_archived"), fwTransition("pa", "active", { activatedAt: serverTimestamp() })));
  await no(updateDoc(fwRef(pa, "fwA_draft"), fwTransition("pa", "active", { activatedAt: serverTimestamp(), name: "Doi ten cung luc" })));                // no rename inside a transition
  await no(updateDoc(fwRef(pa, "fwA_draft"), fwTransition("pa", "bogus")));
  // who may run lifecycle transitions
  for (const u of ["oaA", "capA"]) { await env.clearFirestore(); await seedWorld(env); await ok(updateDoc(fwRef(as(u), "fwA_draft"), fwTransition(u, "active", { activatedAt: serverTimestamp() }))); }
  for (const [u, why] of DENIED_A) {
    await env.clearFirestore(); await seedWorld(env);
    await assert.doesNotReject(no(updateDoc(fwRef(as(u), "fwA_active"), fwTransition(u, "archived"))), u + ": " + why);
  }
  // archived organization: no transitions for anyone
  await env.clearFirestore(); await seedWorld(env);
  for (const u of ["pa", "oaC", "capC"]) { await no(updateDoc(fwRef(as(u), "fwC_active"), fwTransition(u, "archived"))); await no(updateDoc(fwRef(as(u), "fwC_draft"), fwTransition(u, "active", { activatedAt: serverTimestamp() }))); }
});

test("framework delete: only a never-activated draft in an ACTIVE organization, by an allowed principal", async () => {
  await no(deleteDoc(fwRef(as("pa"), "fwA_active"))); await no(deleteDoc(fwRef(as("pa"), "fwA_archived")));
  await no(deleteDoc(fwRef(as("pa"), "fwA_draftAct")));                                    // draft that carries activatedAt
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(deleteDoc(fwRef(as(u), "fwA_draft"))), u + ": " + why);
  await no(deleteDoc(fwRef(as(null), "fwA_draft"))); await no(deleteDoc(fwRef(as("oaB"), "fwA_draft")));
  for (const u of ["pa", "oaC", "capC"]) await no(deleteDoc(fwRef(as(u), "fwC_draft")));  // archived organization
  await ok(deleteDoc(fwRef(as("capA"), "fwA_draft")));
  await ok(deleteDoc(fwRef(as("oaB"), "fwB_draft")));
  await env.clearFirestore(); await seedWorld(env);
  await ok(deleteDoc(fwRef(as("pa"), "fwA_draft")));
});

test("node read/list: governance principals read; unfiltered or other-organization node queries and every other principal are denied", async () => {
  const nl = (db, fw, org) => getDocs(query(nodesCol(db, fw), where("organizationId", "==", org), limit(5001)));
  for (const u of ALLOWED_A) { await ok(getDoc(nodeRef(as(u), "fwA_active", "s1"))); const s = await ok(nl(as(u), "fwA_active", "orgA")); assert.equal(s.size, 2, u); }
  for (const [u, why] of DENIED_A) { await assert.doesNotReject(no(getDoc(nodeRef(as(u), "fwA_active", "s1"))), u + ": " + why); await assert.doesNotReject(no(nl(as(u), "fwA_active", "orgA")), u + " list: " + why); }
  await no(getDoc(nodeRef(as(null), "fwA_active", "s1"))); await no(nl(as(null), "fwA_active", "orgA"));
  for (const u of ["oaA", "capA"]) {
    await no(getDocs(nodesCol(as(u), "fwA_active")));                                           // unfiltered
    await no(nl(as(u), "fwA_active", "orgB"));                                                  // another organization's id
    await no(getDocs(query(nodesCol(as(u), "fwA_active"), orderBy("order"))));                   // ordering without the organization filter
  }
  await ok(getDocs(nodesCol(as("pa"), "fwA_active"))); await ok(nl(as("pa"), "fwB_draft", "orgB"));
  await ok(getDoc(nodeRef(as("pa"), "fwA_active", "missing")));
});

test("node create: allowed principals create in a draft or active framework of the SAME organization; archived/missing/foreign parents and every other principal are denied", async () => {
  for (const u of ALLOWED_A) { await ok(setDoc(nodeRef(as(u), "fwA_draft", "n_" + u), newNodePayload("orgA"))); await ok(setDoc(nodeRef(as(u), "fwA_active", "n_" + u), lessonPayload("orgA", "s1"))); }
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(setDoc(nodeRef(as(u), "fwA_draft", "x_" + u), newNodePayload("orgA"))), u + ": " + why);
  await no(setDoc(nodeRef(as(null), "fwA_draft", "x_anon"), newNodePayload("orgA")));
  await no(setDoc(nodeRef(as("pa"), "fwA_archived", "x1"), newNodePayload("orgA")));              // archived framework
  await no(setDoc(nodeRef(as("pa"), "fwMissing", "x2"), newNodePayload("orgA")));                  // parent does not exist
  await no(setDoc(nodeRef(as("pa"), "fwA_draft", "x3"), newNodePayload("orgB")));                  // organizationId differs from the parent framework's
  await no(setDoc(nodeRef(as("oaB"), "fwA_draft", "x4"), newNodePayload("orgB")));                 // forged organization + foreign admin
  await no(setDoc(nodeRef(as("oaB"), "fwA_draft", "x5"), newNodePayload("orgA")));
  await no(setDoc(nodeRef(as("oaA"), "fwB_draft", "x6"), newNodePayload("orgB")));                 // org A admin writing into org B framework
  await no(setDoc(nodeRef(as("oaA"), "fwB_draft", "x7"), newNodePayload("orgA")));
  for (const u of ["pa", "oaC", "capC"]) { await no(setDoc(nodeRef(as(u), "fwC_draft", "xc_" + u), newNodePayload("orgC"))); await no(setDoc(nodeRef(as(u), "fwC_active", "xc_" + u), newNodePayload("orgC"))); }
});

test("node create: schema allowlist and the node-shape facts Rules CAN prove", async () => {
  const pa = as("pa"); let n = 0; const id = () => "n" + n++;
  const c = (extra, nid) => setDoc(nodeRef(pa, "fwA_draft", nid || id()), newNodePayload("orgA", extra));
  await ok(c({}));
  await ok(c({ kind: "unit", order: 0 })); await ok(c({ kind: "lesson", parentId: "s1", ancestors: ["s1"], code: "B01" }));
  await ok(c({ code: "A".repeat(40) })); await ok(c({ order: 100000 })); await ok(c({ name: "x".repeat(200) }));
  await ok(c({ kind: "lesson", parentId: "c", ancestors: ["a", "b", "c"] }));             // depth 4 (3 ancestors)
  const bad = [
    ["kind unknown", { kind: "chapter" }], ["status retired on create", { status: "retired" }], ["status unknown", { status: "draft" }],
    ["order negative", { order: -1 }], ["order above max", { order: 100001 }], ["order float", { order: 1.5 }], ["order string", { order: "1" }],
    ["name empty", { name: "" }], ["name too long", { name: "x".repeat(201) }], ["name not a string", { name: 5 }],
    ["code empty", { code: "" }], ["code too long", { code: "A".repeat(41) }], ["code number", { code: 7 }],
    ["schemaVersion 2", { schemaVersion: 2 }], ["createdAt client date", { createdAt: D(9) }], ["updatedAt client date", { updatedAt: D(9) }],
    ["extra key frameworkId", { frameworkId: "fwA_draft" }], ["extra key counters", { childCount: 0 }],
    ["depth 5 (4 ancestors)", { parentId: "d", ancestors: ["a", "b", "c", "d"] }],
    ["parentId null with ancestors", { parentId: null, ancestors: ["a"] }], ["parentId set with empty ancestors", { parentId: "a", ancestors: [] }],
    ["parentId is not the last ancestor", { parentId: "a", ancestors: ["a", "b"] }], ["parentId equals own id", { parentId: "selfNode", ancestors: ["selfNode"] }],
    ["own id inside ancestors", { parentId: "p", ancestors: ["selfNode", "p"] }], ["duplicate ancestors", { parentId: "a", ancestors: ["a", "a"] }],
    ["ancestors not a list", { parentId: "a", ancestors: "a" }], ["ancestor element not a string", { parentId: "b", ancestors: [1, "b"] }],
    ["parentId number", { parentId: 3, ancestors: [3] }], ["organizationId not a string", { organizationId: 5 }]
  ];
  for (const [label, over] of bad) await assert.doesNotReject(no(c(over, "selfNode")), label);
  for (const key of ["schemaVersion", "organizationId", "kind", "parentId", "ancestors", "order", "code", "name", "status", "createdAt", "updatedAt"]) {
    const p = newNodePayload("orgA"); delete p[key];
    await assert.doesNotReject(no(setDoc(nodeRef(pa, "fwA_draft", id()), p)), "missing " + key);
  }
});

test("node update: label/code/order/status only; structure immutable; parent must stay editable; other principals denied", async () => {
  const targets = ["fwA_draft", "fwA_active"];
  for (const fw of targets) for (const u of ALLOWED_A) {
    await ok(updateDoc(nodeRef(as(u), fw, "s1"), nodeEdit({ name: "Doi ten " + u })));
    await ok(updateDoc(nodeRef(as(u), fw, "l1"), nodeEdit({ code: "B" + u, order: 5 })));
    await ok(updateDoc(nodeRef(as(u), fw, "l1"), nodeEdit({ status: "retired" }))); await ok(updateDoc(nodeRef(as(u), fw, "l1"), nodeEdit({ status: "active" })));
    await ok(updateDoc(nodeRef(as(u), fw, "l1"), nodeEdit({ code: null })));
  }
  for (const u of ALLOWED_A) await no(updateDoc(nodeRef(as(u), "fwA_archived", "s1"), nodeEdit({ name: "Bi chan" })));   // archived framework
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(updateDoc(nodeRef(as(u), "fwA_draft", "s1"), nodeEdit({ name: "Bi chan" }))), u + ": " + why);
  await no(updateDoc(nodeRef(as(null), "fwA_draft", "s1"), nodeEdit({ name: "Bi chan" })));
  await no(updateDoc(nodeRef(as("oaB"), "fwA_draft", "s1"), nodeEdit({ name: "Bi chan" }))); await no(updateDoc(nodeRef(as("oaA"), "fwB_draft", "s1"), nodeEdit({ name: "Bi chan" })));
  const pa = as("pa");
  const immut = [
    ["organizationId", { organizationId: "orgB" }], ["kind", { kind: "unit" }], ["parentId", { parentId: "other", ancestors: ["other"] }], ["ancestors", { ancestors: ["x", "s1"] }],
    ["createdAt", { createdAt: D(9) }], ["schemaVersion", { schemaVersion: 2 }], ["extra key", { frameworkId: "fwA_draft" }]
  ];
  for (const [label, over] of immut) await assert.doesNotReject(no(updateDoc(nodeRef(pa, "fwA_draft", "l1"), nodeEdit({ name: "Hop le", ...over }))), label);
  await no(updateDoc(nodeRef(pa, "fwA_draft", "s1"), nodeEdit({ parentId: "l1", ancestors: ["l1"] })));                 // re-parent denied (root -> child)
  await no(updateDoc(nodeRef(pa, "fwA_draft", "l1"), nodeEdit({ parentId: null, ancestors: [] })));                       // child -> root denied
  const badValues = [{ name: "" }, { name: "x".repeat(201) }, { code: "" }, { code: "A".repeat(41) }, { order: -1 }, { order: 100001 }, { order: 1.5 }, { status: "draft" }];
  for (const v of badValues) await no(updateDoc(nodeRef(pa, "fwA_draft", "l1"), nodeEdit(v)));
  await no(updateDoc(nodeRef(pa, "fwA_draft", "s1"), { name: "Gio client", updatedAt: D(9) }));
  await no(updateDoc(nodeRef(pa, "fwGone", "orphan1"), nodeEdit({ name: "Mo coi doi ten" })));                          // parent missing -> immutable
  for (const u of ["pa", "oaC", "capC"]) await no(updateDoc(nodeRef(as(u), "fwC_draft", "s1"), nodeEdit({ name: "Bi chan C" })));  // archived organization
});

test("node delete: only while the parent is a never-activated draft (or the parent no longer exists); active/archived frameworks and archived organizations keep their nodes", async () => {
  await no(deleteDoc(nodeRef(as("pa"), "fwA_active", "l1"))); await no(deleteDoc(nodeRef(as("pa"), "fwA_archived", "l1")));
  await no(deleteDoc(nodeRef(as("pa"), "fwA_draftAct", "l1")));                       // draft that carries activatedAt
  for (const [u, why] of DENIED_A) await assert.doesNotReject(no(deleteDoc(nodeRef(as(u), "fwA_draft", "l1"))), u + ": " + why);
  await no(deleteDoc(nodeRef(as(null), "fwA_draft", "l1"))); await no(deleteDoc(nodeRef(as("oaB"), "fwA_draft", "l1")));
  for (const u of ["pa", "oaC", "capC"]) { await no(deleteDoc(nodeRef(as(u), "fwC_draft", "s1"))); await no(deleteDoc(nodeRef(as(u), "fwGoneC", "orphanC"))); }   // archived organization, incl. orphan cleanup
  await no(deleteDoc(nodeRef(as("oaB"), "fwGone", "orphan1")));                       // foreign admin cannot clean another organization's orphan
  await no(deleteDoc(nodeRef(as("mA"), "fwGone", "orphan1")));
  await ok(deleteDoc(nodeRef(as("capA"), "fwA_draft", "l1"))); await ok(deleteDoc(nodeRef(as("oaA"), "fwA_draft", "s1")));
  await ok(deleteDoc(nodeRef(as("pa"), "fwGone", "orphan1")));                        // orphan cleanup by an authorized principal in an active organization
});

test("capability semantics: curriculum.manage is required for non-Platform-Admin; org_admin implies it; denied/other caps do not; it cannot be self-granted", async () => {
  await ok(getDoc(fwRef(as("capA"), "fwA_active"))); await no(getDoc(fwRef(as("revA"), "fwA_active")));
  await ok(getDoc(fwRef(as("oaA"), "fwA_active")));
  // self-grant attempt through the existing capability collection stays denied, and the ordinary member stays locked out
  await no(setDoc(doc(as("mA"), "userCapabilities", "orgA_mA"), { schemaVersion: 1, organizationId: "orgA", uid: "mA", caps: ["curriculum.manage"], denied: [], updatedBy: "mA", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await no(getDoc(fwRef(as("mA"), "fwA_active")));
  // a capability granted later by the Platform Admin (existing P2 write path) immediately works; revoking it removes access
  await ok(setDoc(doc(as("pa"), "userCapabilities", "orgA_mA"), { schemaVersion: 1, organizationId: "orgA", uid: "mA", caps: ["curriculum.manage"], denied: [], updatedBy: "pa", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await ok(getDoc(fwRef(as("mA"), "fwA_active"))); await ok(setDoc(fwRef(as("mA"), "viaCap"), newFwPayload("orgA", "mA")));
  await ok(updateDoc(doc(as("pa"), "userCapabilities", "orgA_mA"), { caps: [], denied: [], updatedBy: "pa", updatedAt: serverTimestamp() }));
  await no(getDoc(fwRef(as("mA"), "fwA_active"))); await no(setDoc(fwRef(as("mA"), "viaCap2"), newFwPayload("orgA", "mA")));
  // suspending the membership revokes access although the capability document remains
  await ok(updateDoc(doc(as("pa"), "organizationMembers", "orgA_capA"), { status: "suspended", statusChangedAt: serverTimestamp(), statusChangedBy: "pa", updatedAt: serverTimestamp() }));
  await no(getDoc(fwRef(as("capA"), "fwA_active")));
});

test("independent platform suspension (I3): suspending the account's users document revokes curriculum access at once, without touching membership/capability documents", async () => {
  await ok(getDoc(fwRef(as("capA"), "fwA_active"))); await ok(setDoc(fwRef(as("capA"), "beforeSusp"), newFwPayload("orgA", "capA")));
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "users", "capA"), { status: "suspended" }); });
  await no(getDoc(fwRef(as("capA"), "fwA_active"))); await no(setDoc(fwRef(as("capA"), "afterSusp"), newFwPayload("orgA", "capA")));
  await no(updateDoc(nodeRef(as("capA"), "fwA_draft", "s1"), nodeEdit({ name: "Bi chan" })));
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "users", "pa"), { status: "suspended" }); });
  await no(getDoc(fwRef(as("pa"), "fwA_active"))); await no(setDoc(fwRef(as("pa"), "paSuspended"), newFwPayload("orgA", "pa")));
});

test("Rules do not read or write the platform users collection for curriculum, and the P3 block exposes no collection other than the two curriculum paths", async () => {
  // behavior: an Organization Admin / capability holder still cannot read users documents of others (unchanged V1 behavior)
  await no(getDoc(doc(as("oaA"), "users", "mA"))); await no(getDoc(doc(as("capA"), "users", "mB")));
  // new collections of later phases stay denied by the default-deny block
  for (const p of ["curriculumMappings/x", "importBatches/x", "libraryResources/x", "libraryUsageEvents/x"]) await no(getDoc(doc(as("pa"), p)));
  await no(getDoc(doc(as("pa"), "curriculumFrameworks/fwA_active/mappingSuggestions/x")));
  await no(getDoc(doc(as("pa"), "curriculumFrameworks/fwA_active/nodes/s1/children/x")));
});
