// Library V2 — P1 (hub navigation only).
// Pure registry + rendering helpers for the teacher "THƯ VIỆN" hub. No DOM, no Firestore, no network, no
// storage: this module only describes WHICH child libraries exist and renders their navigation markup.
// Adding a future child library = adding one registry entry (status "active" with views, or "upcoming").
// Child libraries that are not registered are never rendered, so the hub never shows speculative cards.

const freeze = Object.freeze;

// Personal / shared information architecture (frozen in Library V2 Master Architecture v1.0).
// P1 only PREPARES the concept visually: the shared store is not functional before P7, so it is shown as
// an honest disabled "Sắp có" pill and has no behavior.
export const LIBRARY_SCOPES = freeze([
  freeze({ id: "personal", label: "CỦA TÔI", available: true }),
  freeze({ id: "shared", label: "DÙNG CHUNG ĐƠN VỊ", available: false, badge: "Sắp có", hint: "Kho dùng chung của đơn vị sẽ sớm có." })
]);

export const LIBRARY_CHILDREN = freeze([
  freeze({
    id: "interaction",
    status: "active",
    icon: "📚",
    title: "TẠO TƯƠNG TÁC",
    description: "Câu hỏi và bộ câu hỏi lưu sẵn để dùng lại khi tạo tương tác.",
    action: "MỞ THƯ VIỆN →",
    defaultView: "questions",
    views: freeze([
      freeze({ id: "questions", label: "CÂU HỎI", tabId: "libraryQuestionsTab" }),
      freeze({ id: "questionSets", label: "BỘ CÂU HỎI", tabId: "libraryQuestionSetsTab" })
    ]),
    scopes: freeze(["personal", "shared"])
  }),
  freeze({
    id: "group",
    status: "upcoming",
    icon: "👥",
    title: "THẢO LUẬN NHÓM",
    description: "Kho tình huống và nhiệm vụ để dùng lại khi tạo hoạt động thảo luận nhóm.",
    badge: "ĐANG CHUẨN BỊ",
    upcomingItems: freeze(["Tình huống / Nội dung thảo luận", "Nhiệm vụ nhóm"])
  })
]);

export const LIBRARY_HUB_SCREEN = "hub";

export function getLibraryChild(id, children = LIBRARY_CHILDREN) {
  return children.find((child) => child.id === id) || null;
}

export function activeLibraryChildren(children = LIBRARY_CHILDREN) {
  return children.filter((child) => child.status === "active");
}

const HUB = freeze({ screen: LIBRARY_HUB_SCREEN, child: null, view: null });

// Normalizes the persisted navigation state ({screen, view}) into a safe location. Unknown screens, upcoming
// (not yet usable) children and unknown views never produce a dead end: they fall back to the hub / the
// child's default view.
export function resolveLibraryLocation(screen, view, children = LIBRARY_CHILDREN) {
  const child = activeLibraryChildren(children).find((item) => item.id === screen);
  if (!child) return HUB;
  const validView = child.views.some((item) => item.id === view) ? view : child.defaultView;
  return { screen: child.id, child, view: validView };
}

// Single entry for every caller that wants to open the Library: the sidebar item (null target → hub), the
// Overview shortcuts, legacy string aliases ("questions" / "questionSets") and explicit {child, view}.
export function libraryLocationForTarget(target, children = LIBRARY_CHILDREN) {
  if (target == null || target === "") return HUB;
  if (typeof target === "string") {
    const owner = activeLibraryChildren(children).find((child) => child.views.some((item) => item.id === target));
    return owner ? resolveLibraryLocation(owner.id, target, children) : HUB;
  }
  if (typeof target === "object") return resolveLibraryLocation(target.child, target.view, children);
  return HUB;
}

const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);

export function libraryOpenButtonId(childId) {
  return `open${cap(childId)}Library`;
}

function renderActiveCard(child, esc) {
  return `<button class="library-hub-card" id="${esc(libraryOpenButtonId(child.id))}" type="button" data-library-open="${esc(child.id)}">
          <span class="library-card-icon" aria-hidden="true">${esc(child.icon)}</span>
          <span class="library-card-title">${esc(child.title)}</span>
          <span class="library-card-copy">${esc(child.description)}</span>
          <span class="library-card-action">${esc(child.action)}</span>
        </button>`;
}

function renderUpcomingCard(child, esc) {
  const titleId = `libraryCardTitle-${child.id}`;
  const items = (child.upcomingItems || []).map((item) => `<li>${esc(item)}</li>`).join("");
  return `<article class="library-hub-card is-upcoming" aria-disabled="true" aria-labelledby="${esc(titleId)}" data-library-upcoming="${esc(child.id)}">
          <span class="library-card-icon" aria-hidden="true">${esc(child.icon)}</span>
          <span class="library-card-title" id="${esc(titleId)}">${esc(child.title)}</span>
          <span class="library-card-badge">${esc(child.badge || "Sắp có")}</span>
          <span class="library-card-copy">${esc(child.description)}</span>
          ${items ? `<ul class="library-card-list">${items}</ul>` : ""}
          ${child.note ? `<span class="library-card-note">${esc(child.note)}</span>` : ""}
        </article>`;
}

export function renderLibraryHubHtml(esc, children = LIBRARY_CHILDREN) {
  const cards = children.map((child) => (child.status === "active" ? renderActiveCard(child, esc) : renderUpcomingCard(child, esc))).join("\n        ");
  return `<div class="section-title"><div><h2>THƯ VIỆN</h2><p class="mut">Lưu trữ và sử dụng lại các tài nguyên phục vụ giảng dạy.</p></div></div>
      <div class="library-hub-grid" aria-label="Các thư viện">
        ${cards}
      </div>`;
}

function renderScopePills(child, esc, scopes) {
  const pills = scopes
    .filter((scope) => child.scopes.includes(scope.id))
    .map((scope) => (scope.available
      ? `<span class="library-scope-pill is-current" aria-current="true">${esc(scope.label)}</span>`
      : `<button class="library-scope-pill is-soon" type="button" disabled aria-disabled="true" title="${esc(scope.hint || "Sắp có")}">${esc(scope.label)} <span class="chip">${esc(scope.badge || "Sắp có")}</span></button>`))
    .join("");
  return pills ? `<div class="library-scope" role="group" aria-label="Kho thư viện">${pills}</div>` : "";
}

// Child library shell: back button to the hub, scope pills (personal available / shared "Sắp có") and the
// view tabs. The tab panel (#teacherLibraryView) is filled by the caller with the existing V1 renderers.
export function renderLibraryChildHtml(location, esc, scopes = LIBRARY_SCOPES) {
  const child = location.child;
  const tabs = child.views.map((view) => {
    const selected = view.id === location.view;
    return `<button class="btn ${selected ? "" : "btn-outline"}" id="${esc(view.tabId)}" type="button" role="tab" data-library-view="${esc(view.id)}" aria-selected="${selected}" aria-controls="teacherLibraryView">${esc(view.label)}</button>`;
  }).join("\n        ");
  return `<button class="btn btn-ghost" id="backToLibraryHub" type="button">← THƯ VIỆN</button>
    <section class="card mt-14" aria-labelledby="${esc(child.id)}LibraryTitle">
      <h3 id="${esc(child.id)}LibraryTitle" style="margin-top:0">THƯ VIỆN ${esc(child.title)}</h3>
      ${renderScopePills(child, esc, scopes)}
      <div class="flex gap-8 mt-8" role="tablist" aria-label="Thư viện ${esc(child.title.toLowerCase())}">
        ${tabs}
      </div>
      <div id="teacherLibraryView" role="tabpanel" class="mt-20"></div>
    </section>`;
}
