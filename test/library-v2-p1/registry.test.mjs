// Library V2 — P1 focused tests: the pure hub registry (navigation only).
import test from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_CHILDREN, LIBRARY_SCOPES, LIBRARY_HUB_SCREEN, getLibraryChild, activeLibraryChildren,
  resolveLibraryLocation, libraryLocationForTarget, libraryOpenButtonId, renderLibraryHubHtml, renderLibraryChildHtml
} from "../../library-hub-registry.mjs";

const esc = (value) => String(value).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");

test("registry: exactly the approved children — Tạo tương tác active, Thảo luận nhóm upcoming; no speculative cards", () => {
  assert.deepEqual(LIBRARY_CHILDREN.map((c) => [c.id, c.status]), [["interaction", "active"], ["group", "upcoming"]]);
  assert.deepEqual(activeLibraryChildren().map((c) => c.id), ["interaction"]);
  const interaction = getLibraryChild("interaction");
  assert.deepEqual(interaction.views.map((v) => [v.id, v.label, v.tabId]), [["questions", "CÂU HỎI", "libraryQuestionsTab"], ["questionSets", "BỘ CÂU HỎI", "libraryQuestionSetsTab"]]);
  assert.equal(interaction.defaultView, "questions");
  const group = getLibraryChild("group");
  assert.deepEqual(group.upcomingItems, ["Tình huống / Nội dung thảo luận", "Nhiệm vụ nhóm"]);
  assert.equal(group.views, undefined, "an upcoming child has no views and no behavior");
  assert.equal(getLibraryChild("nope"), null);
  assert.ok(Object.isFrozen(LIBRARY_CHILDREN) && Object.isFrozen(interaction) && Object.isFrozen(LIBRARY_SCOPES));
});

test("scopes: personal available, shared honestly not available before P7", () => {
  assert.deepEqual(LIBRARY_SCOPES.map((s) => [s.id, s.label, s.available]), [["personal", "CỦA TÔI", true], ["shared", "DÙNG CHUNG ĐƠN VỊ", false]]);
  assert.equal(LIBRARY_SCOPES[1].badge, "Sắp có");
});

test("resolveLibraryLocation: hub fallbacks never produce a dead end", () => {
  const hub = { screen: LIBRARY_HUB_SCREEN, child: null, view: null };
  for (const screen of [null, undefined, "", "hub", "group", "unknown", 7]) assert.deepEqual(resolveLibraryLocation(screen, "questions"), hub, String(screen));
  const l = resolveLibraryLocation("interaction", "questionSets");
  assert.equal(l.screen, "interaction"); assert.equal(l.view, "questionSets"); assert.equal(l.child.id, "interaction");
  assert.equal(resolveLibraryLocation("interaction", "garbage").view, "questions");
  assert.equal(resolveLibraryLocation("interaction", undefined).view, "questions");
});

test("libraryLocationForTarget: one canonical mapping for sidebar, Overview shortcuts and legacy aliases", () => {
  assert.equal(libraryLocationForTarget(null).screen, "hub");
  assert.equal(libraryLocationForTarget(undefined).screen, "hub");
  assert.equal(libraryLocationForTarget("").screen, "hub");
  assert.deepEqual([libraryLocationForTarget("questions").screen, libraryLocationForTarget("questions").view], ["interaction", "questions"]);
  assert.deepEqual([libraryLocationForTarget("questionSets").screen, libraryLocationForTarget("questionSets").view], ["interaction", "questionSets"]);
  assert.deepEqual([libraryLocationForTarget({ child: "interaction", view: "questions" }).view, libraryLocationForTarget({ child: "interaction", view: "questionSets" }).view], ["questions", "questionSets"]);
  assert.equal(libraryLocationForTarget({ child: "interaction" }).view, "questions");
  assert.equal(libraryLocationForTarget({ child: "group" }).screen, "hub", "an upcoming child cannot be opened");
  assert.equal(libraryLocationForTarget("nonsense").screen, "hub");
  assert.equal(libraryLocationForTarget(42).screen, "hub");
});

test("hub markup: active card is a real button; upcoming card is non-interactive, labelled, lists future content", () => {
  const html = renderLibraryHubHtml(esc);
  assert.ok(html.includes("<h2>THƯ VIỆN</h2>"));
  assert.equal((html.match(/data-library-open="/g) || []).length, 1);
  assert.ok(html.includes('id="openInteractionLibrary"') && html.includes('data-library-open="interaction"'));
  assert.ok(html.includes("TẠO TƯƠNG TÁC") && html.includes("MỞ THƯ VIỆN →"));
  const group = html.slice(html.indexOf("<article"));
  assert.ok(group.includes('aria-disabled="true"') && group.includes("THẢO LUẬN NHÓM") && group.includes("ĐANG CHUẨN BỊ"));
  assert.ok(group.includes("<li>Tình huống / Nội dung thảo luận</li>") && group.includes("<li>Nhiệm vụ nhóm</li>"));
  assert.ok(!group.includes("Chưa dùng được") && !group.includes("library-card-note"), "owner QA polish: the badge alone communicates the state");
  assert.ok(html.includes("<p class=\"mut\">Lưu trữ và sử dụng lại các tài nguyên phục vụ giảng dạy.</p>"));
  assert.ok(!/<button|href=|onclick|data-library-open/.test(group), "the upcoming card has no control");
  assert.ok(!html.includes("SẮP PHÁT TRIỂN"));
});

test("child markup: back to hub, scope pills (personal current, shared disabled 'Sắp có'), view tabs with stable ids", () => {
  const html = renderLibraryChildHtml(resolveLibraryLocation("interaction", "questionSets"), esc);
  assert.ok(html.includes('id="backToLibraryHub"') && html.includes("← THƯ VIỆN"));
  assert.ok(html.includes("THƯ VIỆN TẠO TƯƠNG TÁC") && html.includes('aria-labelledby="interactionLibraryTitle"') && html.includes('id="interactionLibraryTitle"'));
  assert.ok(html.includes('role="tablist"') && html.includes('aria-label="Thư viện tạo tương tác"'));
  assert.ok(html.includes('id="libraryQuestionsTab"') && html.includes('id="libraryQuestionSetsTab"'));
  assert.ok(html.includes('id="libraryQuestionSetsTab" type="button" role="tab" data-library-view="questionSets" aria-selected="true"'));
  assert.ok(html.includes('id="libraryQuestionsTab" type="button" role="tab" data-library-view="questions" aria-selected="false"'));
  assert.ok(html.includes('id="teacherLibraryView" role="tabpanel"'));
  assert.ok(html.includes('<span class="library-scope-pill is-current" aria-current="true">CỦA TÔI</span>'));
  const shared = html.slice(html.indexOf("DÙNG CHUNG ĐƠN VỊ") - 120, html.indexOf("DÙNG CHUNG ĐƠN VỊ") + 160);
  assert.ok(shared.includes("disabled") && shared.includes('aria-disabled="true"') && shared.includes("Sắp có"));
  assert.equal((html.match(/class="library-scope-pill /g) || []).length, 2, "exactly two pills: personal + shared");
  assert.equal(html.includes('data-library-open'), false);
});

test("extensibility: registering one more child adds a card/shell without touching the renderer", () => {
  const extra = Object.freeze({
    id: "knowledge", status: "active", icon: "🧠", title: "TRI THỨC", description: "Mô tả & thử <nghiệm>", action: "MỞ →", defaultView: "all",
    views: Object.freeze([Object.freeze({ id: "all", label: "TẤT CẢ", tabId: "libraryAllTab" })]), scopes: Object.freeze(["personal"])
  });
  const children = Object.freeze([...LIBRARY_CHILDREN, extra]);
  const html = renderLibraryHubHtml(esc, children);
  assert.equal((html.match(/data-library-open="/g) || []).length, 2);
  assert.ok(html.includes('id="openKnowledgeLibrary"') && html.includes("Mô tả &amp; thử &lt;nghiệm&gt;"));
  assert.equal(libraryOpenButtonId("knowledge"), "openKnowledgeLibrary");
  const loc = libraryLocationForTarget({ child: "knowledge" }, children);
  assert.deepEqual([loc.screen, loc.view], ["knowledge", "all"]);
  assert.equal(libraryLocationForTarget("all", children).screen, "knowledge");
  const child = renderLibraryChildHtml(loc, esc);
  assert.ok(child.includes('id="libraryAllTab"') && child.includes("THƯ VIỆN TRI THỨC"));
  assert.ok(!child.includes("DÙNG CHUNG"), "scope pills only for scopes the child declares");
});

test("markup is HTML-escaped by the injected escaper", () => {
  const evil = Object.freeze({ id: "x", status: "upcoming", icon: "!", title: '<img src=x onerror="a">', description: "<b>", badge: "<i>", upcomingItems: Object.freeze(["<s>"]), note: "<u>" });
  const html = renderLibraryHubHtml(esc, Object.freeze([evil]));
  assert.ok(!html.includes("<img") && !html.includes("<b>") && !html.includes("<s>") && !html.includes("<u>") && !html.includes("<i>"));
});
