// Gate 1B.2C — pure/fixture tests for resolveSessionSemantics() (session-reader.mjs), the new
// shared helper teacherLiveControl / teacherReportView / exportSessionJSON now use instead of
// reading session.title/session.description directly. No emulator needed — synthetic fixtures
// only, via the same in-memory mock db facade Gate 1B.1's golden-legacy tests use.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockDb } from "../gate1b1/mock-db-facade.mjs";
import { resolveSessionSemantics, ReaderError } from "../../session-reader.mjs";

test("legacy session: returns root title/description untouched, never reads Firestore", async () => {
  const db = createMockDb({}); // deliberately empty — no configVersions collection exists
  const session = { ownerId: "teacher-1", status: "closed", title: "Khởi động", description: "Mô tả cũ" };
  const result = await resolveSessionSemantics(db, "sessions/s1", session, "interaction");
  assert.deepEqual(result, { source: "legacy", title: "Khởi động", description: "Mô tả cũ" });
  assert.deepEqual(db.touched, []);
});

test("legacy session: missing description defaults to empty string, not undefined", async () => {
  const db = createMockDb({});
  const session = { ownerId: "teacher-1", status: "closed", title: "Khởi động" };
  const result = await resolveSessionSemantics(db, "sessions/s1", session, "interaction");
  assert.equal(result.description, "");
});

test("contract session, revision 0: returns the activation-baseline manifest's title/description, matching root at revision 0", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg0": {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, title: "Khởi động", description: "Mô tả cũ"
    }
  });
  const session = {
    ownerId: "teacher-1", status: "closed", title: "Khởi động", description: "Mô tả cũ",
    editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0",
    lastOperationId: "op-1", contractActivatedAt: new Date()
  };
  const result = await resolveSessionSemantics(db, "sessions/s1", session, "interaction");
  assert.equal(result.source, "contract");
  assert.equal(result.configId, "cfg0");
  assert.equal(result.title, "Khởi động");
  assert.equal(result.description, "Mô tả cũ");
});

test("SYNTHETIC contract session, revision 1: root title/description are the OLD (frozen, unrewritten) values; resolveSessionSemantics must return the REVISION-1 manifest's DIFFERENT values, not the root's — proves no silent fallback to stale root fields", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg0": {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, title: "Khởi động (cũ)", description: "Mô tả cũ"
    },
    "sessions/s1/configVersions/cfg1": {
      revision: 1, kind: "interaction", source: "apply_config", parentConfigId: "cfg0",
      active: true, title: "Khởi động (đã sửa — REVISION 1)", description: "Mô tả MỚI sau apply_config"
    }
  });
  // The root's title/description are deliberately left at their PRE-revision-1 values —
  // applyConfigRevision() never rewrites the root's own title/description fields, exactly as
  // audited in Gate 1B.2C's audit report. This is the exact staleness scenario that would bite
  // any caller reading session.title directly.
  const session = {
    ownerId: "teacher-1", status: "closed", title: "Khởi động (cũ)", description: "Mô tả cũ",
    editContractVersion: 1, configRevision: 1, currentConfigId: "cfg1",
    lastOperationId: "op-2", contractActivatedAt: new Date()
  };
  const result = await resolveSessionSemantics(db, "sessions/s1", session, "interaction");
  assert.equal(result.source, "contract");
  assert.equal(result.configId, "cfg1");
  assert.equal(result.title, "Khởi động (đã sửa — REVISION 1)", "must be the revision-1 title, not the stale root title");
  assert.equal(result.description, "Mô tả MỚI sau apply_config", "must be the revision-1 description, not the stale root description");
  assert.notEqual(result.title, session.title, "sanity: root and effective title really do differ in this fixture");
});

test("fail closed: currentConfigId points at a missing configVersions doc — throws, does not fall back to root title", async () => {
  const db = createMockDb({}); // no configVersions/broken-pointer doc exists
  const session = {
    ownerId: "teacher-1", status: "closed", title: "Khởi động", description: "",
    editContractVersion: 1, configRevision: 0, currentConfigId: "broken-pointer",
    lastOperationId: "op-1", contractActivatedAt: new Date()
  };
  await assert.rejects(
    () => resolveSessionSemantics(db, "sessions/s1", session, "interaction"),
    (e) => { assert.ok(e instanceof ReaderError); assert.equal(e.code, "MANIFEST_INVALID"); return true; }
  );
});

test("fail closed: active config fails manifest shape validation — throws, does not fall back to root title", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg0": {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: true, title: "x".repeat(70000) // exceeds LIMITS.manifestBytes
    }
  });
  const session = {
    ownerId: "teacher-1", status: "closed", title: "Khởi động", description: "",
    editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0",
    lastOperationId: "op-1", contractActivatedAt: new Date()
  };
  await assert.rejects(
    () => resolveSessionSemantics(db, "sessions/s1", session, "interaction"),
    (e) => { assert.ok(e instanceof ReaderError); assert.equal(e.code, "MANIFEST_INVALID"); return true; }
  );
});

test("fail closed: active config marked active:false — throws, does not fall back to root title", async () => {
  const db = createMockDb({
    "sessions/s1/configVersions/cfg0": {
      revision: 0, kind: "activation_baseline", source: "legacy_snapshot", parentConfigId: null,
      activatedFromLegacy: true, active: false, title: "Khởi động", description: ""
    }
  });
  const session = {
    ownerId: "teacher-1", status: "closed", title: "Khởi động", description: "",
    editContractVersion: 1, configRevision: 0, currentConfigId: "cfg0",
    lastOperationId: "op-1", contractActivatedAt: new Date()
  };
  await assert.rejects(
    () => resolveSessionSemantics(db, "sessions/s1", session, "interaction"),
    (e) => { assert.ok(e instanceof ReaderError); assert.equal(e.code, "MANIFEST_INVALID"); return true; }
  );
});
