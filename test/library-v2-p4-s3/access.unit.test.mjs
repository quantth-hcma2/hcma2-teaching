// LIBRARY V2 P4-S3 final correction A - Import Center AUTHORIZATION (pure decision + access reads + mount behaviour). The decision mirrors the deployed Rules
// (mayReadCurriculum / mayWriteCurriculum); parity with the REAL Rules is proven separately in access.rules.test.mjs (emulator).
// Run: node --test test/library-v2-p4-s3/access.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createImportViewHelpers, createImportCenter, resolveImportAccess, loadImportAccess } from "../../import-center-view.mjs";

const H = createImportViewHelpers();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ORG = { id: "orgA", name: "Khoa Quản trị", code: "khoa-quan-tri", status: "active" };
const ACTIVE = { id: "orgA", status: "active" }, ARCHIVED = { id: "orgA", status: "archived" };
const mem = (extra = {}) => ({ organizationId: "orgA", uid: "u1", orgRole: "member", status: "active", ...extra });
const cap = (caps, denied = [], extra = {}) => ({ organizationId: "orgA", uid: "u1", caps, denied, ...extra });
const decide = (o) => resolveImportAccess({ actorUid: "u1", organization: ACTIVE, ...o });

test("AUTHORIZATION MATRIX: Platform Admin, Organization Admin and an active member holding curriculum.manage are allowed; everyone else is denied; an archived organization never prepares an import", () => {
  const ok = (r, role, canPrepare = true) => { assert.equal(r.allowed, true); assert.equal(r.role, role); assert.equal(r.canPrepare, canPrepare); };
  ok(decide({ isPlatformAdmin: true }), "platform_admin");
  ok(decide({ isPlatformAdmin: true, organization: ARCHIVED }), "platform_admin", false);
  ok(decide({ membership: mem({ orgRole: "org_admin" }) }), "org_admin");
  ok(decide({ membership: mem({ orgRole: "org_admin" }), organization: ARCHIVED }), "org_admin", false);       // governance survives archiving, preparation does not
  ok(decide({ membership: mem(), capability: cap(["curriculum.manage"]) }), "capability_holder");
  ok(decide({ membership: mem(), capability: cap(["library.review", "curriculum.manage"], ["library.contribute"]) }), "capability_holder");
  const no = (r, reason) => { assert.equal(r.allowed, false); assert.equal(r.canPrepare, false); assert.equal(r.role, null); assert.equal(r.reason, reason); assert.ok(H.DENIED_REASONS[reason], "a Vietnamese message exists for " + reason); };
  no(decide({ membership: mem() }), "NO_CAPABILITY");                                                            // unprivileged member, no capability document
  no(decide({ membership: mem(), capability: cap([]) }), "NO_CAPABILITY");
  no(decide({ membership: mem(), capability: cap(["library.review", "library.manage"]) }), "NO_CAPABILITY");     // other capabilities do not help
  no(decide({ membership: mem(), capability: cap(["curriculum.manage"], ["curriculum.manage"]) }), "NO_CAPABILITY");   // an explicit denial wins
  no(decide({ membership: mem(), capability: cap(["curriculum.manage"]), organization: ARCHIVED }), "ORGANIZATION_ARCHIVED");   // a capability holder has nothing in an archived organization
  no(decide({ membership: mem({ status: "suspended" }), capability: cap(["curriculum.manage"]) }), "MEMBERSHIP_INACTIVE");
  no(decide({ membership: mem({ status: "removed", orgRole: "org_admin" }) }), "MEMBERSHIP_INACTIVE");
  no(decide({ membership: null, capability: cap(["curriculum.manage"]) }), "NOT_MEMBER");                       // capability document without a membership
  no(decide({}), "NOT_MEMBER");
  no(decide({ membership: mem({ organizationId: "orgB" }), capability: cap(["curriculum.manage"]) }), "NOT_MEMBER");   // another organization's membership
  no(decide({ membership: mem({ uid: "someone-else" }), capability: cap(["curriculum.manage"]) }), "NOT_MEMBER");
  no(decide({ membership: mem({ orgRole: "owner" }) }), "NOT_MEMBER");
  no(decide({ membership: mem(), capability: cap(["curriculum.manage"], [], { organizationId: "orgB" }) }), "NO_CAPABILITY");   // another organization's capability
  no(decide({ membership: mem(), capability: cap(["curriculum.manage"], [], { uid: "someone-else" }) }), "NO_CAPABILITY");
  no(decide({ isPlatformAdmin: true, accountActive: false }), "ACCOUNT_INACTIVE");
  no(decide({ membership: mem({ orgRole: "org_admin" }), accountActive: false }), "ACCOUNT_INACTIVE");
  no(decide({ organization: null, isPlatformAdmin: true }), "NO_ORGANIZATION");
  no(decide({ isPlatformAdmin: "true", membership: null }), "NOT_MEMBER");                                       // only the boolean true grants the Platform Admin path
  assert.ok(Object.isFrozen(decide({ isPlatformAdmin: true })));
});

test("ACCESS READ: only the organization, the user's OWN membership and (ordinary members only) the user's OWN capability are read; missing-document denials mean 'absent'; transient failures fail closed", async () => {
  const calls = [];
  const q = (docs, { failOn, code } = {}) => ({
    organizationById: async (db, id) => { calls.push(["org", id]); if (failOn === "org") throw Object.assign(new Error("x"), { code: code || "unavailable" }); return docs.org || null; },
    membershipOf: async (db, id, uid) => { calls.push(["membership", id, uid]); if (failOn === "membership") throw Object.assign(new Error("x"), { code: code || "permission-denied" }); return docs.membership || null; },
    capabilityOf: async (db, id, uid) => { calls.push(["capability", id, uid]); if (failOn === "capability") throw Object.assign(new Error("x"), { code: code || "unavailable" }); return docs.capability || null; }
  });
  const load = (docs, extra = {}, options) => loadImportAccess({ db: {}, organizationQueries: q(docs, options), actorUid: "u1", organizationId: "orgA", ...extra });
  calls.length = 0; await load({ org: ACTIVE }, { isPlatformAdmin: true }); assert.deepEqual(calls, [["org", "orgA"]]);
  calls.length = 0; await load({ org: ACTIVE, membership: mem({ orgRole: "org_admin" }) }); assert.deepEqual(calls, [["org", "orgA"], ["membership", "orgA", "u1"]]);
  calls.length = 0; const r = await load({ org: ACTIVE, membership: mem(), capability: cap(["curriculum.manage"]) }); assert.deepEqual(calls, [["org", "orgA"], ["membership", "orgA", "u1"], ["capability", "orgA", "u1"]]); assert.equal(r.capability.caps[0], "curriculum.manage");
  calls.length = 0; await load({ org: ACTIVE, membership: mem({ status: "suspended" }) }); assert.equal(calls.length, 2, "no capability read for an inactive member");
  calls.length = 0; assert.deepEqual(await load({ org: null }), { organization: null, membership: null, capability: null }); assert.equal(calls.length, 1, "an organization the user cannot read ends the check");
  assert.equal((await load({ org: ACTIVE }, {}, { failOn: "membership" })).membership, null);                      // permission-denied on a missing own document == absent
  assert.equal((await load({ org: ACTIVE, membership: mem() }, {}, { failOn: "capability", code: "permission-denied" })).capability, null);
  await assert.rejects(() => load({ org: ACTIVE, membership: mem() }, {}, { failOn: "capability" }), /ACCESS_CHECK_FAILED/);
  await assert.rejects(() => load({ org: ACTIVE }, {}, { failOn: "org" }), /ACCESS_CHECK_FAILED/);
  await assert.rejects(() => loadImportAccess({ db: {}, organizationQueries: null, actorUid: "u1", organizationId: "orgA" }), /ACCESS_CHECK_FAILED/);
});

test("ACCESS MOUNT: a denied principal sees only the Vietnamese denial for its reason and NOTHING is loaded; an allowed capability holder gets the Import Center with the FRESH identity; a transient failure shows a retry and never access", async () => {
  const makeHost = () => { const listeners = new Map(); return { innerHTML: "", listeners, querySelector: () => null, addEventListener(type, fn) { listeners.set(fn, type); }, removeEventListener(type, fn) { listeners.delete(fn); }, contains: () => true }; };
  let loaded = 0;
  const deps = (docs, extra = {}) => ({ db: {}, actorUid: "u1", isPlatformAdmin: false, esc, toast() {}, loadEngine: async () => { loaded++; throw new Error("stop here"); }, downloadFile() {},
    organizationQueries: { organizationById: async () => docs.org || null, membershipOf: async () => docs.membership || null, capabilityOf: async () => docs.capability || null }, ...extra });
  const cases = [
    [{ org: ACTIVE }, "NOT_MEMBER"], [{ org: null }, "NOT_MEMBER"], [{ org: ACTIVE, membership: mem() }, "NO_CAPABILITY"], [{ org: ACTIVE, membership: mem({ status: "suspended" }) }, "MEMBERSHIP_INACTIVE"],
    [{ org: ARCHIVED, membership: mem(), capability: cap(["curriculum.manage"]) }, "ORGANIZATION_ARCHIVED"]
  ];
  for (const [docs, reason] of cases) {
    const host = makeHost(); await createImportCenter(deps(docs)).mount(host, { organization: { id: "orgA", name: "Khung giả" }, onBack() {} });
    assert.match(host.innerHTML, new RegExp('id="impDenied"[^>]*data-reason="' + reason + '"')); assert.doesNotMatch(host.innerHTML, /impFile|impTemplateBlank|Khung giả/); assert.equal(host.listeners.size, 0);
  }
  assert.equal(loaded, 0, "no engine for a denied principal");
  const host = makeHost(); await createImportCenter(deps({ org: { ...ACTIVE, name: "Tên thật", code: "ma-that" }, membership: mem(), capability: cap(["curriculum.manage"]) })).mount(host, { organization: { id: "orgA", name: "Tên do người gọi", code: "x" }, onBack() {} });
  assert.match(host.innerHTML, /Tên thật/); assert.doesNotMatch(host.innerHTML, /Tên do người gọi/); assert.equal(loaded, 1, "an allowed principal loads the engine (lazily, once)");
  const flaky = makeHost(); await createImportCenter(deps({}, { organizationQueries: { organizationById: async () => { throw Object.assign(new Error("x"), { code: "unavailable" }); } } })).mount(flaky, { organization: ORG, onBack() {} });
  assert.match(flaky.innerHTML, /impAccessFailed/); assert.doesNotMatch(flaky.innerHTML, /impFile|impTemplateBlank/); assert.equal(flaky.listeners.size, 1);
});
