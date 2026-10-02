// GROUP PDF V1 — behavioral test of the thin index.html wiring. The REAL source of setGroupPdfButtons and
// startGroupPdfExport is cut out of index.html and executed against stubs, so the UI logic (busy state,
// duplicate-click guard, members read, toasts, error recovery) is exercised without Firebase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const a = html.indexOf("function setGroupPdfButtons(activeGroup,label){");
const b = html.indexOf("function renderPanels(){", a);
assert.ok(a > 0 && b > a, "wiring source anchors");
const source = html.slice(a, b);

function harness({ current = { id: "act1", status: "open", collectStudentNames: false }, exportImpl, membersImpl } = {}) {
  const buttons = [1, 2, 3].map((n) => ({ dataset: { groupPdf: String(n) }, disabled: false, textContent: "TẢI PDF" }));
  const log = { toasts: [], exports: [], memberReads: 0, snapshots: [] };
  const deps = {
    $$: () => buttons, current, id: "act1", topics: { 3: { topic: "T3" } },
    notes: [{ id: "n1", group: 3 }], photos: [{ id: "p1", group: 3 }], files: [{ id: "f1", group: 3 }],
    toast: (message, type) => log.toasts.push([type, message]),
    mapError: (e) => `mapped:${e.code}`,
    groupPdfLoadMembers: async () => { log.memberReads++; if (membersImpl) return membersImpl(); return [{ uid: "u1", displayName: "A" }]; },
    groupPdfFetchImageBytes: async () => new ArrayBuffer(1),
    exportGroupPdf: async (input, opts) => {
      log.exports.push(input);
      for (const p of [{ stage: "images", done: 0, total: 2 }, { stage: "images", done: 2, total: 2 }, { stage: "render" }]) { opts.onProgress(p); log.snapshots.push(buttons.map((x) => `${x.disabled ? "D" : "e"}:${x.textContent}`)); }
      if (exportImpl) return exportImpl(input);
      return { stats: { imageFailures: 0, replacements: 0 } };
    }
  };
  const make = new Function("deps", `
    let pdfBusyGroup=null;
    const {$$,current,id,topics,notes,photos,files,toast,mapError,groupPdfLoadMembers,groupPdfFetchImageBytes,exportGroupPdf}=deps;
    ${source}
    return {start:startGroupPdfExport,busy:()=>pdfBusyGroup};
  `);
  return { ...make(deps), buttons, log };
}

test("wiring: while an export runs every button is disabled and only the active one shows progress; all restored afterwards", async () => {
  const h = harness();
  await h.start(3);
  assert.deepEqual(h.log.snapshots[0], ["D:TẢI PDF", "D:TẢI PDF", "D:Đang tạo PDF… (ảnh 0/2)"]);
  assert.deepEqual(h.log.snapshots[1], ["D:TẢI PDF", "D:TẢI PDF", "D:Đang tạo PDF… (ảnh 2/2)"]);
  assert.deepEqual(h.log.snapshots[2], ["D:TẢI PDF", "D:TẢI PDF", "D:Đang tạo PDF…"]);
  assert.deepEqual(h.buttons.map((x) => [x.disabled, x.textContent]), [[false, "TẢI PDF"], [false, "TẢI PDF"], [false, "TẢI PDF"]]);
  assert.equal(h.busy(), null);
  assert.deepEqual(h.log.toasts, [["ok", "Đã tạo PDF Nhóm 3."]]);
});

test("wiring: a second click while exporting is ignored (no duplicate export, no extra reads)", async () => {
  let release, calls = 0;
  const done = { stats: { imageFailures: 0, replacements: 0 } };
  const h = harness({ exportImpl: () => (++calls === 1 ? new Promise((resolve) => { release = () => resolve(done); }) : done) });
  const first = h.start(3);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.busy(), 3);
  await h.start(3); await h.start(1);
  assert.equal(h.log.exports.length, 1);
  release(); await first;
  assert.equal(h.busy(), null);
  await h.start(1);
  assert.equal(h.log.exports.length, 2, "a new export is allowed once the previous one finished");
});

test("wiring: soft-deleted activities never export", async () => {
  const h = harness({ current: { id: "act1", status: "deleted" } });
  await h.start(3);
  assert.equal(h.log.exports.length, 0); assert.equal(h.busy(), null); assert.deepEqual(h.log.toasts, []);
});

test("wiring: the export gets exactly the live group data; members are read only when collectStudentNames is on", async () => {
  const off = harness();
  await off.start(3);
  assert.equal(off.log.memberReads, 0);
  assert.deepEqual(Object.keys(off.log.exports[0]).sort(), ["activity", "files", "group", "members", "notes", "photos", "topic"]);
  assert.equal(off.log.exports[0].group, 3); assert.deepEqual(off.log.exports[0].topic, { topic: "T3" }); assert.deepEqual(off.log.exports[0].members, []);
  assert.equal(off.log.exports[0].activity.id, "act1");
  const on = harness({ current: { id: "act1", status: "closed", collectStudentNames: true } });
  await on.start(3);
  assert.equal(on.log.memberReads, 1);
  assert.deepEqual(on.log.exports[0].members, [{ uid: "u1", displayName: "A" }]);
  assert.equal(off.log.exports[0].topic === null, false);
  const none = harness(); await none.start(2);
  assert.equal(none.log.exports[0].topic, null, "a group without a task document exports with topic null");
});

test("wiring: image failures, replaced characters and unreadable member names are reported without failing the export", async () => {
  const h = harness({ current: { id: "act1", status: "open", collectStudentNames: true }, membersImpl: () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); }, exportImpl: () => ({ stats: { imageFailures: 2, replacements: 3 } }) });
  await h.start(3);
  assert.equal(h.log.toasts[0][0], "ok");
  assert.equal(h.log.toasts[1][0], "warn");
  const warn = h.log.toasts[1][1];
  assert.ok(warn.includes("2 ảnh không tải được") && warn.includes("3 ký tự không có trong phông PDF") && warn.includes("không đọc được tên học viên"), warn);
  assert.equal(h.log.exports.length, 1, "the PDF is still created");
  assert.equal(h.busy(), null);
});

test("wiring: a real failure shows an error and fully restores the buttons so the teacher can retry", async () => {
  const h = harness({ exportImpl: () => { throw Object.assign(new Error("x"), { code: "unavailable" }); } });
  await h.start(2);
  assert.deepEqual(h.log.toasts, [["err", "Không tạo được PDF: mapped:unavailable"]]);
  assert.equal(h.busy(), null);
  assert.ok(h.buttons.every((x) => !x.disabled && x.textContent === "TẢI PDF"));
  const plain = harness({ exportImpl: () => { throw new Error("Không tải được bộ tạo PDF. Hãy kiểm tra kết nối mạng rồi thử lại."); } });
  await plain.start(1);
  assert.equal(plain.log.toasts[0][1], "Không tạo được PDF: Không tải được bộ tạo PDF. Hãy kiểm tra kết nối mạng rồi thử lại.");
});
