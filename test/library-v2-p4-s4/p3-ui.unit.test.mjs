// LIBRARY V2 P4-S4 IMPORT FREEZE - P3 UI protection (pure, no DOM, no Firestore): the curriculum list marks a framework whose paired import batch is `committing` ("Đang nhập dữ liệu") or `partial`
// ("Nhập chưa hoàn tất"), disables every row action and explains the restriction in Vietnamese; ordinary frameworks render EXACTLY as before; the status lookup is read-only, bounded and org-scoped.
// Run: node --test test/library-v2-p4-s4/p3-ui.unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../../curriculum-model.mjs";
import { createCurriculumViewHelpers } from "../../curriculum-admin-view.mjs";
import { createImportStatusReader, describeImportStatus, IMPORT_STATUS_LIMIT, INCOMPLETE_STATUSES } from "../../import-batch-status.mjs";

const H = createCurriculumViewHelpers({ model });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ts) => (ts && ts.seconds ? "d" + ts.seconds : "—");
const org = { id: "orgA", name: "Khoa", status: "active" };
const ts = (s) => ({ seconds: s, nanoseconds: 0 });
const fw = (id, status = "draft") => ({ id, organizationId: "orgA", name: "Khung " + id, status, createdAt: ts(10), updatedAt: ts(10), ...(status === "draft" ? {} : { activatedAt: ts(20) }) });
const base = { phase: "ready", organization: org, truncated: false, canOpen: true, lifecycleTools: true, esc, fmtDate };
const ID = "Ab12Cd34Ef56Gh78Ij90";

test("an ordinary section render is byte-identical with and without the import states (no regression for frameworks without an incomplete batch)", () => {
  const items = [fw("a1"), fw("a2", "active"), fw("a3", "archived")];
  const plain = H.renderSectionHtml({ ...base, items });
  assert.equal(H.renderSectionHtml({ ...base, items, importStates: new Map(), describeImport: describeImportStatus }), plain);
  assert.equal(H.renderSectionHtml({ ...base, items, importStates: null, describeImport: describeImportStatus }), plain);
  assert.equal(H.renderSectionHtml({ ...base, items, importStates: new Map([["unrelated", "committing"]]), describeImport: describeImportStatus }), plain);
  assert.ok(!/data-fw-import-note|Đang nhập dữ liệu|Nhập chưa hoàn tất/.test(plain));
});
for (const [status, label] of [["committing", "Đang nhập dữ liệu"], ["partial", "Nhập chưa hoàn tất"]]) {
  test("a draft framework with a " + status + " import batch is marked \"" + label + "\", explained in Vietnamese, and EVERY button is disabled", () => {
    const html = H.renderSectionHtml({ ...base, items: [fw(ID), fw("ordinary")], importStates: new Map([[ID, status]]), describeImport: describeImportStatus });
    const rows = html.split("<li ").slice(1);
    const frozen = rows.find((r) => r.includes('data-fw-row="' + ID + '"')), normal = rows.find((r) => r.includes('data-fw-row="ordinary"'));
    assert.ok(frozen.includes(label) && frozen.includes('data-fw-import-note="' + status + '"'));
    assert.ok(/Chưa thể mở, đổi tên, kích hoạt, nhân bản hoặc xóa/.test(frozen), "the restriction is explained");
    const buttons = frozen.match(/<button [^>]*>/g) || [];
    assert.ok(buttons.length >= 3, "the draft row has its action buttons: " + buttons.length);
    for (const b of buttons) assert.ok(/ disabled /.test(b) && /aria-disabled="true"/.test(b) && /title="/.test(b), "disabled with a reason: " + b.slice(0, 80));
    assert.ok(!/ disabled/.test((normal.match(/<button [^>]*>/g) || []).join("")), "the ordinary row keeps its enabled buttons");
    assert.ok(!normal.includes("data-fw-import-note"));
  });
}
test("describeImportStatus covers exactly the two incomplete states; completed, rolled_back and unknown values are not marked", () => {
  assert.equal(describeImportStatus("committing").label, "Đang nhập dữ liệu"); assert.equal(describeImportStatus("partial").label, "Nhập chưa hoàn tất");
  for (const s of ["completed", "rolled_back", "", null, undefined, "constructor", "__proto__", "toString"]) assert.equal(describeImportStatus(s), null, String(s));
  assert.deepEqual([...INCOMPLETE_STATUSES], ["committing", "partial"]);
  assert.throws(() => { "use strict"; describeImportStatus("partial").label = "x"; }, TypeError, "frozen strings");
});
test("a hostile status or name is escaped (no markup injection through the batch state or the framework name)", () => {
  const html = H.renderSectionHtml({ ...base, items: [{ ...fw(ID), name: '<img src=x onerror=1>' }], importStates: new Map([[ID, "partial"]]), describeImport: describeImportStatus });
  assert.ok(!/<img /.test(html));
});

function fakeFs(docsByStatus, calls = []) {
  return {
    collection: (db, name) => ({ db, name }),
    where: (field, op, value) => ({ field, op, value }),
    limit: (n) => ({ limit: n }),
    query: (col, ...constraints) => ({ col, constraints }),
    getDocs: async (q) => {
      calls.push(q);
      const status = q.constraints.find((c) => c.field === "status").value, orgId = q.constraints.find((c) => c.field === "organizationId").value;
      return { docs: (docsByStatus[status] || []).filter((d) => d.organizationId === orgId || d.leak).map((d) => ({ id: d.id, data: () => d })) };
    }
  };
}
test("the status lookup: two equality queries (organizationId + status), bounded, no orderBy / in / composite index; organization-scoped; returns the framework id -> state map", async () => {
  const calls = [];
  const reader = createImportStatusReader(fakeFs({ committing: [{ id: "f1", organizationId: "orgA" }], partial: [{ id: "f2", organizationId: "orgA" }, { id: "fx", organizationId: "orgB", leak: true }] }, calls));
  const states = await reader.incompleteOf({}, "orgA");
  assert.deepEqual([...states.entries()].sort(), [["f1", "committing"], ["f2", "partial"]], "a document of another organization is ignored even if a query leaked it");
  assert.equal(calls.length, 2);
  for (const q of calls) {
    assert.equal(q.col.name, "importBatches");
    assert.deepEqual(q.constraints.map((c) => c.field || (c.limit && "limit")).sort(), ["limit", "organizationId", "status"]);
    assert.ok(q.constraints.filter((c) => c.field).every((c) => c.op === "=="), "equality only");
    assert.equal(q.constraints.find((c) => c.limit).limit, IMPORT_STATUS_LIMIT);
  }
  assert.deepEqual(calls.map((q) => q.constraints.find((c) => c.field === "status").value), ["committing", "partial"]);
});
test("the status lookup validates its injected functions and the organization id, and a failed read propagates (the P3 view then renders unmarked rather than blocking the list)", async () => {
  assert.throws(() => createImportStatusReader({}), TypeError);
  assert.throws(() => createImportStatusReader({ ...fakeFs({}), getDocs: null }), TypeError);
  const reader = createImportStatusReader(fakeFs({}));
  for (const bad of ["", null, undefined, 5, "a/b", "x".repeat(129)]) await assert.rejects(() => reader.incompleteOf({}, bad), TypeError, String(bad));
  const failing = createImportStatusReader({ ...fakeFs({}), getDocs: async () => { throw new Error("offline"); } });
  await assert.rejects(() => failing.incompleteOf({}, "orgA"), /offline/);
  assert.equal((await reader.incompleteOf({}, "orgA")).size, 0);
});
