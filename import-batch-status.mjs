// Library V2 P4-S4 - READ-ONLY lookup of the INCOMPLETE import batches of ONE organization, for the P3 curriculum list (pure factory, imports nothing: the Firestore functions are injected).
// The P3 list uses it to mark an imported framework whose paired batch is `committing` ("Đang nhập dữ liệu") or `partial` ("Nhập chưa hoàn tất") and to disable the actions the import-freeze Rules
// refuse for it. Two equality-only queries (organizationId + status, no `in`, no orderBy, no composite index), bounded; this module never writes and never names a write API.
const freeze = Object.freeze;
export const IMPORT_STATUS_LIMIT = 21;
export const INCOMPLETE_STATUSES = freeze(["committing", "partial"]);

const INFO = freeze({
  committing: freeze({
    label: "Đang nhập dữ liệu", icon: "⏳",
    title: "Khung đang được nhập từ tệp Excel: tạm khóa chỉnh sửa.",
    note: "Khung này đang được nhập từ tệp Excel. Chưa thể mở, đổi tên, kích hoạt, nhân bản hoặc xóa cho đến khi lần nhập hoàn tất. Hãy mở NHẬP TỪ EXCEL để tiếp tục hoặc hoàn tác lần nhập."
  }),
  partial: freeze({
    label: "Nhập chưa hoàn tất", icon: "⚠️",
    title: "Lần nhập khung này đã dừng giữa chừng: tạm khóa chỉnh sửa.",
    note: "Lần nhập khung này đã dừng giữa chừng nên khung chưa dùng được. Chưa thể mở, đổi tên, kích hoạt, nhân bản hoặc xóa. Hãy mở NHẬP TỪ EXCEL và chọn HOÀN TÁC NHẬP để dọn dữ liệu đã ghi."
  })
});
// -> { label, icon, title, note } for an incomplete status, null for anything else (completed, rolled_back, unknown)
export const describeImportStatus = (status) => (Object.prototype.hasOwnProperty.call(INFO, status) ? INFO[status] : null);

export function createImportStatusReader({ collection, query, where, limit, getDocs } = {}) {
  for (const [name, fn] of Object.entries({ collection, query, where, limit, getDocs })) if (typeof fn !== "function") throw new TypeError("createImportStatusReader requires the Firestore function: " + name);
  return freeze({
    describe: describeImportStatus,
    // -> Map(frameworkId -> "committing" | "partial") for this organization (the batch id IS the framework id: paired identity)
    async incompleteOf(db, organizationId) {
      if (typeof organizationId !== "string" || organizationId.length < 1 || organizationId.length > 128 || organizationId.includes("/")) throw new TypeError("organizationId must be exactly one id string");
      const states = new Map();
      for (const status of INCOMPLETE_STATUSES) {
        const snapshot = await getDocs(query(collection(db, "importBatches"), where("organizationId", "==", organizationId), where("status", "==", status), limit(IMPORT_STATUS_LIMIT)));
        for (const d of snapshot.docs) { const data = d.data(); if (data && data.organizationId === organizationId) states.set(d.id, status); }
      }
      return states;
    }
  });
}
