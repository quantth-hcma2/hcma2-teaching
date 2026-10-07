// Library V2 P3-S5 - curriculum framework CLONE and DELETE-NEVER-ACTIVATED-DRAFT: pure planning/markup helpers + Firestore transport.
// This module imports NOTHING (index.html injects the P3-S2 model); the controller that drives it is part of the P3-S3 framework section (curriculum-admin-view.mjs).
// All payloads still come from the P3-S2 write contract (buildFrameworkCreate with cloneSource, buildNodeCreate, buildNodeRetire); nothing here builds a Firestore payload
// by hand and nothing decides authorization: the deployed P3-S1 Rules decide.
//
// CLONE (client-only, NOT atomic, no backend): framework document first (Rules: a framework and its first nodes cannot share a commit) -> nodes in bounded chunks
// (<= NODE_WRITE_CHUNK per atomic batch) -> retire pass -> the LAST node in its own final commit -> verification read. Because the Rules force node creation as `active`, a source node
// that is retired is created active and retired in a separate pass; every retired node is created and retired BEFORE the final commit, so the destination's node count reaches
// cloneSource.nodeCount only when the clone is finished and correct (see model.cloneCompleteness: a monotone lower bound, never a live checksum). On any failure the controller rolls
// back (nodes, then the never-activated draft framework); if the rollback itself cannot finish, the leftover draft is detectably incomplete (activation is blocked) and deletable.
//
// DELETE-DRAFT: only a never-activated draft (Rules + model.frameworkAvailability.canDelete). Children are deleted FIRST in bounded atomic chunks, the framework LAST, so a
// failure at any point leaves a (smaller) draft that can be deleted again - never orphan nodes.
const freeze = Object.freeze;

// ================================================================ 1. pure helpers (no DOM access, no Firestore)
export function createCloneDeleteHelpers({ model } = {}) {
  for (const name of ["buildTree", "validateTree", "frameworkAvailability", "NODE_WRITE_CHUNK", "FRAMEWORK_NAME_MAX", "CURRICULUM_MAX_NODES"]) {
    if (!model || model[name] === undefined) throw new TypeError("createCloneDeleteHelpers requires the curriculum-model module as { model } (missing " + name + ")");
  }
  const { buildTree, validateTree, frameworkAvailability, NODE_WRITE_CHUNK, FRAMEWORK_NAME_MAX, CURRICULUM_MAX_NODES } = model;

  const MESSAGES = freeze({
    invalidSource: "Khung nguồn có lỗi cấu trúc (thiếu nút cha, trùng mã, quá sâu…) nên không thể nhân bản. Hãy mở khung nguồn để xem và sửa trước.",
    noActiveNodes: "Khung nguồn không có Môn/Bài nào đang sử dụng nên không nhân bản được.",
    tooLarge: "Khung quá lớn (hơn " + CURRICULUM_MAX_NODES + " nút) nên không thể thực hiện thao tác này tại đây.",
    cloneRolledBack: "Nhân bản không thành công. Mọi thứ đã được hoàn tác, không có khung mới nào được tạo.",
    cloneLeftover: "Nhân bản dừng giữa chừng và chưa dọn dẹp được. Khung mới (bản nháp) chưa hoàn chỉnh nên không thể kích hoạt: hãy dùng XÓA BẢN NHÁP rồi nhân bản lại.",
    cloneVerify: "Không xác minh được kết quả nhân bản.",
    deletePartial: "Việc xóa dừng giữa chừng. Khung vẫn còn (một phần nội dung có thể đã bị xóa): hãy thử XÓA BẢN NHÁP lại.",
    deleteNotDraft: "Chỉ bản nháp chưa từng kích hoạt mới xóa được."
  });

  // Default destination name: "<source> (bản sao)", cut so it never exceeds the framework name limit.
  const SUFFIX = " (bản sao)";
  function defaultCloneName(name) {
    const base = String(name == null ? "" : name).trim();
    const room = FRAMEWORK_NAME_MAX - SUFFIX.length;
    const cut = base.length > room ? base.slice(0, room).trim() : base;
    return (cut + SUFFIX).trim();
  }

  // What the UI may offer (mirrors the Rules through model.frameworkAvailability; the Rules still decide).
  // clone: any framework of an ACTIVE organization (a read-only source is fine); deleteDraft: ONLY a never-activated draft.
  function lifecycleControls(framework, organization) {
    const a = frameworkAvailability(framework, organization);
    return freeze({ clone: a.organizationWritable, deleteDraft: a.canDelete });
  }

  const chunk = (list, size = NODE_WRITE_CHUNK) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

  // Clone plan from the LOADED source tree. newId() is called once per node, in plan order. Refuses (never throws) a source the clone cannot reproduce faithfully.
  // Order values are kept when distinct inside a sibling group, renumbered by rank when they collide (relative order is always preserved).
  // Phases: createChunks (all nodes except the final one, parents first) -> retireChunks (new ids to retire) -> finalItems (exactly one ACTIVE node).
  function planClone({ nodes, organizationId, newId }) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (typeof newId !== "function") throw new TypeError("planClone requires newId()");
    if (list.length > CURRICULUM_MAX_NODES) return freeze({ ok: false, reason: "TOO_LARGE", message: MESSAGES.tooLarge });
    const issues = validateTree(list, { organizationId }).issues.filter((issue) => issue.code !== "DUPLICATE_ORDER");
    if (issues.length) return freeze({ ok: false, reason: "INVALID_SOURCE", message: MESSAGES.invalidSource, issues: freeze(issues.map((i) => i.code)) });
    if (list.length === 0) return freeze({ ok: true, total: 0, retiredCount: 0, items: freeze([]), createChunks: freeze([]), retireChunks: freeze([]), finalItems: freeze([]) });
    if (!list.some((node) => node.status === "active")) return freeze({ ok: false, reason: "NO_ACTIVE_NODES", message: MESSAGES.noActiveNodes });
    const tree = buildTree(list);
    const items = [];
    const walk = (entries, parentSourceId) => {
      const orders = entries.map((entry) => entry.node.order), distinct = new Set(orders).size === orders.length;
      entries.forEach((entry, rank) => {
        const node = entry.node;
        items.push({ sourceId: node.id, newId: newId(), parentSourceId, kind: node.kind, name: node.name, code: node.code === undefined ? null : node.code, order: distinct ? node.order : rank, retired: node.status === "retired" });
        walk(entry.children, node.id);
      });
    };
    walk(tree.roots, null);
    const finalIndex = items.map((item) => item.retired).lastIndexOf(false);   // the LAST active node in parent-first order is always a leaf
    const finalItem = items[finalIndex], rest = items.filter((_, i) => i !== finalIndex);
    return freeze({
      ok: true, total: items.length, retiredCount: items.filter((i) => i.retired).length,
      items: freeze(items.map((i) => freeze(i))),
      createChunks: freeze(chunk(rest).map((c) => freeze(c))),
      retireChunks: freeze(chunk(rest.filter((i) => i.retired).map((i) => i.newId)).map((c) => freeze(c))),
      finalItems: freeze([finalItem])
    });
  }

  // Payloads for the whole plan, built BEFORE the first write through the P3-S2 contract (structure, depth, canonical duplicate-code and node-count checks all run here).
  // destination = { id, organizationId, status: "draft" }. Returns { creates: Map(newId -> data), retires: Map(newId -> data) }.
  function buildClonePayloads({ contract, organization, destination, plan }) {
    const synthetic = [], byId = new Map(), creates = new Map(), retires = new Map();
    const ctxOf = () => ({ organization, framework: destination, nodes: synthetic });
    for (const item of plan.items) {
      const parent = item.parentSourceId === null ? null : byId.get(item.parentSourceId);
      const data = contract.buildNodeCreate({ id: item.newId, parent, kind: item.kind, name: item.name, code: item.code, order: item.order }, ctxOf());
      creates.set(item.newId, data);
      const loaded = { id: item.newId, organizationId: organization.id, kind: item.kind, parentId: data.parentId, ancestors: data.ancestors, order: data.order, code: data.code, name: data.name, status: "active" };
      synthetic.push(loaded); byId.set(item.sourceId, loaded);
    }
    for (const item of plan.items) if (item.retired) retires.set(item.newId, contract.buildNodeRetire(synthetic.find((n) => n.id === item.newId), ctxOf()));
    return freeze({ creates, retires });
  }

  // Delete-draft plan: ids of the CURRENT nodes in bounded chunks (children before the framework; order inside the chunks is irrelevant to the Rules).
  function planDeleteDraft(nodes) {
    const ids = (Array.isArray(nodes) ? nodes : []).map((node) => node.id);
    return freeze({ total: ids.length, chunks: freeze(chunk(ids).map((c) => freeze(c))) });
  }

  // Verification of a finished clone against the plan: every planned id exists, statuses match, nothing else was written.
  function verifyClone(plan, destinationNodes) {
    const found = new Map((destinationNodes || []).map((node) => [node.id, node]));
    if (found.size !== plan.total) return false;
    return plan.items.every((item) => found.has(item.newId) && found.get(item.newId).status === (item.retired ? "retired" : "active"));
  }

  // ---- markup (every dynamic string goes through the injected escaper). Ids match the S3 dialogs (#orgFwForm, #orgFwName, #orgFwCancel, #orgFwConfirm, #orgFwErr).
  const attr = (esc, v) => esc(String(v == null ? "" : v));
  const head = (title) => `<div role="dialog" aria-modal="true" aria-labelledby="orgFwDialogTitle"><h3 id="orgFwDialogTitle">${title}</h3>`;
  function renderCloneFormHtml({ framework, defaultName, esc }) {
    return `${head("Nhân bản khung chương trình")}
      <p class="mut">Tạo một <b>bản nháp mới, độc lập</b> trong cùng đơn vị từ <b>${esc(framework.name || "—")}</b>: sao chép toàn bộ Môn/Bài (kể cả nút đã ngừng sử dụng) với mã nội bộ mới. Khung nguồn không bị thay đổi.</p>
      <form id="orgFwForm" novalidate>
        <div class="field"><label for="orgFwName">Tên khung mới *</label><input type="text" id="orgFwName" maxlength="${FRAMEWORK_NAME_MAX}" autocomplete="off" value="${attr(esc, defaultName)}" aria-describedby="orgFwNameErr"><div id="orgFwNameErr" class="error-text hidden" role="alert"></div></div>
        <div id="orgFwProgress" class="small mut hidden" role="status" aria-live="polite"></div>
        <div id="orgFwErr" class="error-text hidden" role="alert"></div>
        <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button><button type="submit" class="btn" id="orgFwSubmit">NHÂN BẢN</button></div>
      </form></div>`;
  }
  function renderDeleteDraftHtml({ framework, esc }) {
    return `${head("Xóa bản nháp?")}
      <p><b>${esc(framework.name || "—")}</b></p>
      <div class="card" role="note" style="border-color:#dc2626"><b>Xóa vĩnh viễn, không thể khôi phục.</b> Khung nháp này và <b>toàn bộ Môn/Bài bên trong</b> sẽ bị xóa hẳn.</div>
      <p class="small mut mt-8">Khác với <b>LƯU TRỮ</b> (có thể khôi phục): chỉ bản nháp chưa từng được kích hoạt mới xóa được. Khung đã kích hoạt chỉ có thể lưu trữ.</p>
      <div id="orgFwProgress" class="small mut hidden" role="status" aria-live="polite"></div>
      <div id="orgFwErr" class="error-text hidden" role="alert"></div>
      <div class="flex-between mt-14"><button type="button" class="btn btn-ghost" id="orgFwCancel">Hủy</button><button type="button" class="btn btn-danger" id="orgFwConfirm">XÓA BẢN NHÁP</button></div></div>`;
  }

  return freeze({ MESSAGES, defaultCloneName, lifecycleControls, planClone, buildClonePayloads, planDeleteDraft, verifyClone, chunk, renderCloneFormHtml, renderDeleteDraftHtml });
}

// ================================================================ 2. Firestore transport for payloads/ids produced above (no payload is constructed here)
export function createCurriculumCloneWriter({ collection, doc, setDoc, writeBatch, deleteDoc, maxBatch = 400 }) {
  const nodesOf = (db, frameworkId) => collection(db, "curriculumFrameworks", frameworkId, "nodes");
  const nodeRef = (db, frameworkId, id) => doc(db, "curriculumFrameworks", frameworkId, "nodes", id);
  const bounded = (items, label) => { if (!Array.isArray(items) || items.length === 0 || items.length > maxBatch) throw new TypeError(label + " needs 1.." + maxBatch + " items"); };
  return freeze({
    newFrameworkId: (db) => doc(collection(db, "curriculumFrameworks")).id,
    newNodeId: (db, frameworkId) => doc(nodesOf(db, frameworkId)).id,
    createFramework: (db, id, data) => setDoc(doc(db, "curriculumFrameworks", id), data),
    // ONE atomic batch per call: items = [{ id, data }]
    async createNodes(db, frameworkId, items) { bounded(items, "createNodes"); const batch = writeBatch(db); for (const item of items) batch.set(nodeRef(db, frameworkId, item.id), item.data); await batch.commit(); },
    async updateNodes(db, frameworkId, items) { bounded(items, "updateNodes"); const batch = writeBatch(db); for (const item of items) batch.update(nodeRef(db, frameworkId, item.id), item.data); await batch.commit(); },
    async deleteNodes(db, frameworkId, ids) { bounded(ids, "deleteNodes"); const batch = writeBatch(db); for (const id of ids) batch.delete(nodeRef(db, frameworkId, id)); await batch.commit(); },
    deleteFramework: (db, id) => deleteDoc(doc(db, "curriculumFrameworks", id))
  });
}
