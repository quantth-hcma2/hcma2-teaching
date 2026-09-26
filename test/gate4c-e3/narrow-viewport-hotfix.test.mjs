// GATE 4C-E.3 — narrow-viewport (~390x700) Fullscreen hotfix for the Knowledge participant
// Expanded/Fullscreen view. PURE test, no emulator, no browser. Extracts real shipped source out
// of index.html and diffs against the exact pre-hotfix baseline commit via git — never a
// hand-copied frozen string. This is a NEW test area; no historical test file is modified.
//
// The geometry claims this hotfix is built on (table-wrap ~34.4px pre-fix vs. ~327.4px post-fix
// at 390x700, zero horizontal/document overflow, sticky header intact) were established by real
// Playwright browser measurement during the read-only audit and the implementation-candidate
// verification pass for this gate; they are not re-derivable from static source alone and are not
// re-asserted numerically here. What IS statically provable — and is what this file proves — is
// that the CSS added to reach that measured result is exactly as narrow, additive, and
// non-destructive as the audit specified.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const indexPath = path.join(repoRoot, "index.html");
const BASELINE = "affb0edb7ab2c5787113ad82519a4207e758cd83"; // pre-hotfix HEAD of this worktree

const source = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const baselineSource = execFileSync("git", ["show", `${BASELINE}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n");

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return src.slice(start, end);
}

const cssBlock = sliceBetween(source, "<style>", "</style>", "css");
const baselineCssBlock = sliceBetween(baselineSource, "<style>", "</style>", "baseline css");
const scriptSrc = sliceBetween(source, '<script type="module">', "</script>", "script");
const baselineScriptSrc = sliceBetween(baselineSource, '<script type="module">', "</script>", "baseline script");

// GATE 5F.D2.G13B.1 — reconciliation, test-harness only. The whole-module BASELINE above
// (affb0edb, pre-Gate-4C-E.3-hotfix) still correctly backs every CSS-scoping test below: this
// hotfix's own CSS has not drifted, and BASELINE is what makes those isolation proofs meaningful
// (a newer baseline that already contains the hotfix's CSS would make them tautological). The
// SCRIPT side is different: 9 separately-accepted, separately-tested production commits
// (XLSX assets, teacher-candidate release, submission-image diagnostics, Group Discussion
// fullscreen, sidebar v1, interaction-module unification, nav fix, teacher library hub v1, the
// Gate 5F.D2.G10A retirement candidate) landed between affb0edb and current production without
// ever being reconciled into this file's script-freeze test — a pre-existing staleness, proven
// below and unrelated to Gate 5F.D2.G13B. Reproducing all 9 as reversible chunks is neither
// "smallest possible change" nor safe (no first-hand context on any of them). Instead, the
// canonical CURRENT production SHA (same value as PRODUCTION_BASELINE, used further down for the
// Firestore call-site-surface tests) stands in as the script baseline for the ONE test that needs
// it: it is itself the accepted, live, canonical production state, so any further authorized
// script delta on top of it (this gate's own Classroom-launch delta) is exactly what remains to be
// proven narrow — nothing about the 9 already-accepted commits needs to be re-litigated here.
const CANONICAL_PRODUCTION_SHA = "df397955206199aa1fd132e37239a2f86fac0659";
const canonicalProductionScriptSrc = sliceBetween(
  execFileSync("git", ["show", `${CANONICAL_PRODUCTION_SHA}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n"),
  '<script type="module">',
  "</script>",
  "canonical production script",
);

const HOTFIX_START_MARKER = "/* GATE 4C-E.3:";
const HOTFIX_END_MARKER = ".modal.is-fullscreen .kn-pf-expanded > .flex.gap-8.mt-8 > select,\n.modal.is-fullscreen .kn-pf-expanded > .flex.gap-8.mt-8 > input[type=text]{width:auto; flex:1 1 150px; min-width:120px;}";
const hotfixCss = sliceBetween(cssBlock, HOTFIX_START_MARKER, HOTFIX_END_MARKER, "hotfix css") + HOTFIX_END_MARKER;
// the hotfix's own explanatory comment prose mentions "width:100%" and ".table-wrap" as prior-art
// context, so rule-body checks below must operate on the rules alone, comment stripped.
const hotfixCssRulesOnly = hotfixCss.replace(/\/\*[\s\S]*?\*\//, "").trim();

// ===================================================================================
// Item 1/6/7/8 — the hotfix CSS is scoped exclusively to Knowledge-participant Fullscreen:
// every rule requires the compound `.modal.is-fullscreen .kn-pf-expanded` ancestor chain, which
// is structurally impossible to match Compact (no .modal ancestor), normal non-Fullscreen
// Expanded (.modal-lg without .is-fullscreen), or any other .modal/.modal-lg consumer (none use
// .kn-pf-expanded).
// ===================================================================================

test("GATE 4C-E.3: every hotfix CSS rule requires the compound .modal.is-fullscreen .kn-pf-expanded ancestor chain", () => {
  const ruleSelectors = hotfixCss
    .replace(/\/\*[\s\S]*?\*\//, "") // strip the leading comment
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => line.slice(0, line.indexOf("{")).trim());
  assert.ok(ruleSelectors.length >= 4, "expected at least 4 hotfix rules");
  for (const sel of ruleSelectors) {
    for (const part of sel.split(",")) {
      assert.match(part.trim(), /^\.modal\.is-fullscreen \.kn-pf-expanded\b/, `rule "${part.trim()}" is not scoped to .modal.is-fullscreen .kn-pf-expanded`);
    }
  }
});

test("GATE 4C-E.3: kn-pf-expanded never appears in any other feature's JS (confining the hotfix's reach to the Knowledge dashboard closure)", () => {
  const styleEnd = source.indexOf("</style>");
  const knowledgeSectionStart = source.indexOf("async function knowledgeDashboard(");
  assert.notEqual(styleEnd, -1);
  assert.notEqual(knowledgeSectionStart, -1);
  const idxs = [];
  let idx = source.indexOf("kn-pf-expanded");
  while (idx !== -1) { idxs.push(idx); idx = source.indexOf("kn-pf-expanded", idx + 1); }
  assert.ok(idxs.length > 0);
  const inOtherFeatureCode = idxs.some((i) => i >= styleEnd && i < knowledgeSectionStart);
  assert.equal(inOtherFeatureCode, false);
});

test("GATE 4C-E.3: is-fullscreen remains applied only conditionally (wantFullscreen guard), so normal Expanded can never carry it", () => {
  const expandedFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsExpanded(", "\n  }", "expandedFn") + "\n  }";
  assert.match(expandedFnSrc, /if\(wantFullscreen\)modalEl\.classList\.add\('is-fullscreen'\);/);
});

test("GATE 4C-E.3: Compact's own render path never opens a .modal and never carries kn-pf-expanded", () => {
  const compactFnSrc = sliceBetween(source, "function knowledgeRenderParticipantsCompact(", "\n  }", "compactFn") + "\n  }";
  assert.doesNotMatch(compactFnSrc, /openModal\(/);
  assert.doesNotMatch(compactFnSrc, /kn-pf-expanded/);
});

// ===================================================================================
// Item 2/3 — the pre-existing GLOBAL .grid-3 rule and the global select/input width:100% rule
// are untouched; the hotfix works entirely by adding new, more-specific overrides, never by
// editing the general-purpose rules shared by every other feature.
// ===================================================================================

test("GATE 4C-E.3: global .grid-3 rule and its <600px stacking media query are byte-identical to baseline (no shared rule edited)", () => {
  const globalGrid3 = sliceBetween(cssBlock, ".grid-3{", "}", "global grid-3") + "}";
  const baselineGlobalGrid3 = sliceBetween(baselineCssBlock, ".grid-3{", "}", "baseline global grid-3") + "}";
  assert.equal(globalGrid3, baselineGlobalGrid3);
  const mediaQuery = "@media(max-width:600px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr;}}";
  assert.match(cssBlock, new RegExp(mediaQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("GATE 4C-E.3: global input/select width:100% rule is byte-identical to baseline (no shared rule edited)", () => {
  const globalControlStart = "input[type=text], input[type=email], input[type=password], input[type=number], input[type=date],\nselect, textarea{";
  const globalControlRule = sliceBetween(cssBlock, globalControlStart, "\n}", "global control rule") + "\n}";
  const baselineGlobalControlRule = sliceBetween(baselineCssBlock, globalControlStart, "\n}", "baseline global control rule") + "\n}";
  assert.equal(globalControlRule, baselineGlobalControlRule);
});

// ===================================================================================
// Item 4/17/18/19 — no JS production change whatsoever: the entire module script is
// byte-identical to the pre-hotfix baseline, which by construction also preserves the ESC
// contract, the Close contract, Refresh, CSV export, and introduces zero new Firestore
// reads/listeners (all of it is JS, none of it touched).
// ===================================================================================

// ===================================================================================
// GATE 5F.D2.G13B — the Classroom Second Brain (V2) launch/close delta, rebuilt on current
// Teaching production (df397955...) rather than the old, abandoned Gate 5F.C/5F.D2.F1 candidate
// chain. Each entry pairs the added text with the canonical-production text it replaced (pure
// additions replace only their anchor line). The reversal below is strict: every chunk must match
// verbatim, must occur exactly `expectedOccurrences` times, and after ALL reversals the module
// script must be byte-identical to CANONICAL_PRODUCTION_SHA's own script (see
// canonicalProductionScriptSrc above) — proven independently, not assumed (Gate 5F.D2.G13B.1).
// No regex, no range deletion. Any further production JS edit — including to these chunks — makes
// this test fail until a new, explicitly authorized reconciliation updates the frozen chunks.
// ===================================================================================
const knownClassroomLaunchAdditions = [
  {
    name: "Gate 5F.C module import",
    expectedOccurrences: 1,
    // GATE 5F.D2.G13B — this candidate is rebuilt on current Teaching production, which (per Gate
    // 5F.D2.G13A's reconciliation) has one intervening B1.2 import (group-submission-upload.mjs)
    // between session-info-compare.mjs and this gate's own import that did not exist on the old,
    // abandoned candidate's checkpoint — the anchor below reflects that real, current position.
    // GATE 5F.D2.POST-2 — extends this same chunk with the shared token-provider import/const
    // (createGetClassroomIdToken / getClassroomIdToken) added directly below the original import.
    withClassroomLaunch:
      "import { uploadThenCreateGroupSubmission, reportGroupSubmissionImageLoadError } from \"./group-submission-upload.mjs\";\n" +
      "// GATE 5F.C: Knowledge Co-creation dashboard launch/close control for the Classroom Second Brain\n" +
      "// (V2) projection. Talks only to the accepted, frozen Gate 5C HTTP contract — never touches\n" +
      "// Firestore Rules/indexes, the Public Second Brain V1 service, or any Classroom backend file.\n" +
      "import { canLaunchClassroomProjection, createClassroomLaunchController, createGetClassroomIdToken } from \"./classroom-projection-launch.mjs\";\n" +
      "// GATE 5F.D2.POST-2: one shared token provider for the Classroom controller's Start/Status/Close\n" +
      "// (see createGetClassroomIdToken in classroom-projection-launch.mjs). auth.currentUser is read\n" +
      "// fresh on every call (matches the original closure's behavior), never captured/cached here.\n" +
      "const getClassroomIdToken=createGetClassroomIdToken(()=>auth.currentUser);\n" +
      "\n",
    withoutClassroomLaunch:
      "import { uploadThenCreateGroupSubmission, reportGroupSubmissionImageLoadError } from \"./group-submission-upload.mjs\";\n" +
      "\n",
  },
  {
    name: "Gate 5F.D2.F1 dashboard-generation counter",
    expectedOccurrences: 1,
    withClassroomLaunch:
      "}\n" +
      "// GATE 5F.D2.F1: bumped on every Knowledge dashboard mount; async Classroom status/Start/Close\n" +
      "// continuations compare against it before touching the DOM (see renderSecondBrainAction).\n" +
      "let CLASSROOM_DASHBOARD_GEN=0;\n" +
      "async function knowledgeDashboard(c,sessionId,isAdminView){\n",
    withoutClassroomLaunch:
      "}\n" +
      "async function knowledgeDashboard(c,sessionId,isAdminView){\n",
  },
  {
    name: "Gate 5F.C/F1 controller creation + dispose registration",
    expectedOccurrences: 1,
    // GATE 5F.D2.G13B.1 — anchors on knPfSearchDebounceTimer (current production's own local
    // variable name at this spot since Search V1 landed), not the old candidate's
    // knPfFullscreenEscHandler (a pre-Search-V1 name — the old candidate was built before Search
    // V1 existed). Confirmed by direct read of this candidate's actual index.html.
    // GATE 5F.D2.POST-2 — getIdToken now wires to the shared getClassroomIdToken provider instead
    // of the old inline closure.
    withClassroomLaunch:
      "  let knPfSearchDebounceTimer=null;\n" +
      "  // GATE 5F.C: one Classroom launch/close controller per dashboard mount — its projectionSessionId\n" +
      "  // lives only in this closure for the lifetime of this dashboard view (a Teaching refresh forgets\n" +
      "  // it; accepted for this candidate, see classroom-projection-launch.mjs).\n" +
      "  // GATE 5F.D2.F1: the controller now also recovers the server-side grant state (POST\n" +
      "  // /projections/status) on entry. requireKnownStatus makes \"not yet checked / check failed\" count\n" +
      "  // as UNKNOWN, never as \"no projection\". The generation counter + dispose-on-leave stop a late\n" +
      "  // status response from an earlier dashboard mount from touching a newer dashboard's controls.\n" +
      "  const classroomDashGen=++CLASSROOM_DASHBOARD_GEN;\n" +
      "  let classroomStatusRequested=false;\n" +
      "  const classroomController=createClassroomLaunchController({\n" +
      "    windowOpenImpl:(url,target)=>window.open(url,target),\n" +
      "    fetchImpl:(url,init)=>fetch(url,init),\n" +
      "    getIdToken:getClassroomIdToken,\n" +
      "    requireKnownStatus:true,\n" +
      "  });\n" +
      "  track(()=>classroomController.dispose());\n" +
      "  const openerUid=STATE.user.uid;\n",
    withoutClassroomLaunch:
      "  let knPfSearchDebounceTimer=null;\n" +
      "  const openerUid=STATE.user.uid;\n",
  },
  {
    name: "Gate 5F.C/F1 Second Brain card template (replaces the V1 link card)",
    expectedOccurrences: 1,
    withClassroomLaunch:
      "      <div class=\"card\"><h3>🤖 AI Analysis — Phase 2</h3><p class=\"mut\">AI đọc bản sao theo lô; dữ liệu gốc không bị sửa hoặc ghi đè.</p><div class=\"flex gap-8\" style=\"flex-wrap:wrap\"><button class=\"btn\" id=\"knAiRun\">PHÂN TÍCH BẰNG AI</button><button class=\"btn btn-outline\" id=\"knAiRetry\" style=\"display:none\">TIẾP TỤC / THỬ LẠI</button><button class=\"btn btn-outline\" id=\"knAiJson\" disabled>XUẤT AI JSON</button><button class=\"btn btn-outline\" id=\"knAiCsv\" disabled>XUẤT AI CSV</button></div><button class=\"btn btn-outline mt-8\" id=\"knCsv\">XUẤT CSV DỮ LIỆU GỐC</button><div id=\"knAiStatus\" class=\"mt-14\"><span class=\"mut small\">Chưa có bản phân tích.</span></div></div></div>\n" +
      "      ${canLaunchClassroomProjection({session,isAdminView,actorUid:STATE.user.uid})?`<div class=\"card second-brain-card mt-14\" id=\"knSecondBrainCard\"><div class=\"second-brain-head\"><span class=\"second-brain-icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M9 4.5a3 3 0 0 0-3 3v.3A3.2 3.2 0 0 0 4.5 10.8a3.2 3.2 0 0 0 1 5.4A3 3 0 0 0 8.5 20a2.7 2.7 0 0 0 2.5-1.6\"/><path d=\"M15 4.5a3 3 0 0 1 3 3v.3a3.2 3.2 0 0 1 1.5 3 3.2 3.2 0 0 1-1 5.4A3 3 0 0 1 15.5 20a2.7 2.7 0 0 1-2.5-1.6\"/><path d=\"M12 4.5v14\"/><circle cx=\"7.2\" cy=\"9\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"16.8\" cy=\"9\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"8\" cy=\"14.5\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"16\" cy=\"14.5\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/></svg></span><div><h3>SECOND BRAIN LIVE</h3><p>Trình chiếu không gian tri thức được hình thành theo thời gian thực</p></div></div><div id=\"knSecondBrainAction\"></div></div>`:\"\"}\n" +
      "      <div id=\"knAiDashboard\" class=\"mt-14\"></div>\n",
    withoutClassroomLaunch:
      "      <div class=\"card\"><h3>🤖 AI Analysis — Phase 2</h3><p class=\"mut\">AI đọc bản sao theo lô; dữ liệu gốc không bị sửa hoặc ghi đè.</p><div class=\"flex gap-8\" style=\"flex-wrap:wrap\"><button class=\"btn\" id=\"knAiRun\">PHÂN TÍCH BẰNG AI</button><button class=\"btn btn-outline\" id=\"knAiRetry\" style=\"display:none\">TIẾP TỤC / THỬ LẠI</button><button class=\"btn btn-outline\" id=\"knAiJson\" disabled>XUẤT AI JSON</button><button class=\"btn btn-outline\" id=\"knAiCsv\" disabled>XUẤT AI CSV</button></div><button class=\"btn btn-outline mt-8\" id=\"knCsv\">XUẤT CSV DỮ LIỆU GỐC</button><div id=\"knAiStatus\" class=\"mt-14\"><span class=\"mut small\">Chưa có bản phân tích.</span></div></div></div>\n" +
      "      <div class=\"card second-brain-card mt-14\"><div class=\"second-brain-head\"><span class=\"second-brain-icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M9 4.5a3 3 0 0 0-3 3v.3A3.2 3.2 0 0 0 4.5 10.8a3.2 3.2 0 0 0 1 5.4A3 3 0 0 0 8.5 20a2.7 2.7 0 0 0 2.5-1.6\"/><path d=\"M15 4.5a3 3 0 0 1 3 3v.3a3.2 3.2 0 0 1 1.5 3 3.2 3.2 0 0 1-1 5.4A3 3 0 0 1 15.5 20a2.7 2.7 0 0 1-2.5-1.6\"/><path d=\"M12 4.5v14\"/><circle cx=\"7.2\" cy=\"9\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"16.8\" cy=\"9\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"8\" cy=\"14.5\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"16\" cy=\"14.5\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/></svg></span><div><h3>SECOND BRAIN LIVE</h3><p>Trình chiếu không gian tri thức được hình thành theo thời gian thực</p></div></div><a class=\"btn btn-lg\" href=\"https://brain.quantth.vn/knowledge-wall.html\" target=\"_blank\" rel=\"noopener noreferrer\">MỞ SECOND BRAIN LIVE<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/></svg><span class=\"sr-only\"> (mở trong tab mới)</span></a></div>\n" +
      "      <div id=\"knAiDashboard\" class=\"mt-14\"></div>\n",
  },
  {
    name: "Gate 5F.C/F1 status trigger + card render hook",
    expectedOccurrences: 1,
    withClassroomLaunch:
      "    $(\"#knToggle\").onclick=async()=>{try{await updateDoc(sRef,{status:session.status===\"open\"?\"closed\":\"open\",updatedAt:serverTimestamp()});toast(\"Đã cập nhật trạng thái phiên.\",\"ok\");}catch(e){toast(mapError(e),\"err\");}};\n" +
      "    // GATE 5F.C: re-render only the Second Brain action area (Start/Active+Close) — the card\n" +
      "    // itself was already re-rendered above from scratch on every session-doc snapshot, and this\n" +
      "    // keeps the controller's own state (starting/active/closing) reflected without needing a\n" +
      "    // separate listener or touching any other part of the dashboard.\n" +
      "    // GATE 5F.D2.F1: the server-side grant status is queried exactly once per dashboard mount, the\n" +
      "    // first time the launch card exists (never for trashed sessions, which render no card);\n" +
      "    // later session snapshots only re-render from the controller's own state.\n" +
      "    if(!classroomStatusRequested&&$(\"#knSecondBrainCard\")){classroomStatusRequested=true;refreshClassroomStatus();}\n" +
      "    else renderSecondBrainAction();\n" +
      "    // GATE 4C-D.2: Expanded's own action button — lives in the static card header (outside\n",
    withoutClassroomLaunch:
      "    $(\"#knToggle\").onclick=async()=>{try{await updateDoc(sRef,{status:session.status===\"open\"?\"closed\":\"open\",updatedAt:serverTimestamp()});toast(\"Đã cập nhật trạng thái phiên.\",\"ok\");}catch(e){toast(mapError(e),\"err\");}};\n" +
      "    // GATE 4C-D.2: Expanded's own action button — lives in the static card header (outside\n",
  },
  {
    name: "Gate 5F.C/F1 card render/handler functions",
    expectedOccurrences: 1,
    withClassroomLaunch:
      "  }\n" +
      "  // ===================================================================================\n" +
      "  // GATE 5F.C — Classroom Second Brain (V2) launch/close. Session-bound projection of the\n" +
      "  // accepted Gate 5C/5D/5E Classroom service; replaces the old static, unauthenticated V1\n" +
      "  // \"MỞ SECOND BRAIN LIVE\" link (the Public Second Brain V1 knowledge-wall page) as the PRIMARY\n" +
      "  // action on this card. V1 itself is untouched — it is simply no longer presented here as the\n" +
      "  // session-bound action; deliberately not adding a second button alongside it in this gate (see\n" +
      "  // the Gate 5F.C report for the reasoning).\n" +
      "  // ===================================================================================\n" +
      "  // GATE 5F.D2.F1: every async continuation (status / Start / Close) re-checks this before it\n" +
      "  // touches the DOM — the launch card's element ids are shared by every dashboard mount, so an\n" +
      "  // obsolete continuation from an earlier mount (or another account) must never render into a newer one.\n" +
      "  function classroomDashCurrent(){\n" +
      "    return classroomDashGen===CLASSROOM_DASHBOARD_GEN&&STATE.user&&STATE.user.uid===openerUid;\n" +
      "  }\n" +
      "  function renderSecondBrainAction(){\n" +
      "    if(!classroomDashCurrent())return;\n" +
      "    const host=$(\"#knSecondBrainAction\");\n" +
      "    if(!host)return; // card isn't rendered at all when canLaunchClassroomProjection() is false\n" +
      "    const view=classroomController.getView();\n" +
      "    const icon=`<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/></svg><span class=\"sr-only\"> (mở trong tab mới)</span>`;\n" +
      "    const closeBtn=`<button class=\"btn btn-lg btn-outline\" id=\"knClassroomClose\" style=\"background:transparent;color:#fff;border-color:#fff\">ĐÓNG TRÌNH CHIẾU</button>`;\n" +
      "    // Wording is deliberately about the server-side GRANT — this page cannot know whether a\n" +
      "    // projector or browser tab is actually still open.\n" +
      "    if(view===\"loading\"){\n" +
      "      host.innerHTML=`<div class=\"flex gap-8\" style=\"align-items:center;flex-wrap:wrap\" id=\"knClassroomStatus\"><span class=\"spinner\"></span><span>Đang kiểm tra trạng thái trình chiếu…</span><button class=\"btn btn-lg\" id=\"knClassroomStart\" disabled>TRÌNH CHIẾU SECOND BRAIN</button></div>`;\n" +
      "      return;\n" +
      "    }\n" +
      "    if(view===\"active\"){\n" +
      "      host.innerHTML=`<div class=\"flex gap-8\" style=\"align-items:center;flex-wrap:wrap\" id=\"knClassroomStatus\"><span class=\"badge\" style=\"background:#fff;color:var(--brand-dark)\">● Phiên chiếu đang hoạt động</span>${closeBtn}<button class=\"btn btn-lg\" id=\"knClassroomStart\">CHIẾU LẠI (THAY THẾ PHIÊN ĐANG CHIẾU)${icon}</button></div>`;\n" +
      "      $(\"#knClassroomClose\").onclick=onClassroomCloseClick;\n" +
      "      $(\"#knClassroomStart\").onclick=onClassroomStartClick;\n" +
      "      return;\n" +
      "    }\n" +
      "    if(view===\"unknown\"){\n" +
      "      host.innerHTML=`<div id=\"knClassroomStatus\"><p style=\"margin:0 0 10px\">⚠️ Không xác định được trạng thái trình chiếu. Có thể đang có một phiên chiếu hoạt động — chiếu mới sẽ thay thế phiên đó.</p><div class=\"flex gap-8\" style=\"align-items:center;flex-wrap:wrap\"><button class=\"btn btn-lg\" id=\"knClassroomStart\">TRÌNH CHIẾU SECOND BRAIN${icon}</button>${closeBtn}<button class=\"btn btn-lg btn-outline\" id=\"knClassroomRetry\" style=\"background:transparent;color:#fff;border-color:#fff\">KIỂM TRA LẠI</button></div></div>`;\n" +
      "      $(\"#knClassroomStart\").onclick=onClassroomStartClick;\n" +
      "      $(\"#knClassroomClose\").onclick=onClassroomCloseClick;\n" +
      "      $(\"#knClassroomRetry\").onclick=refreshClassroomStatus;\n" +
      "      return;\n" +
      "    }\n" +
      "    const busy=view===\"starting\"||view===\"closing\";\n" +
      "    host.innerHTML=`<button class=\"btn btn-lg\" id=\"knClassroomStart\"${busy?\" disabled\":\"\"}>${view===\"closing\"?\"ĐANG ĐÓNG…\":busy?\"ĐANG MỞ…\":\"TRÌNH CHIẾU SECOND BRAIN\"}${icon}</button>`;\n" +
      "    if(!busy)$(\"#knClassroomStart\").onclick=onClassroomStartClick;\n" +
      "  }\n" +
      "  // GATE 5F.D2.F1 — read-only status recovery (never Close as a probe). The controller flips to\n" +
      "  // \"checking\" synchronously, so the very first paint already shows the loading state; a response\n" +
      "  // that a newer Start/Close/check made obsolete comes back { stale } and is dropped.\n" +
      "  async function refreshClassroomStatus(){\n" +
      "    if(!session)return;\n" +
      "    const pending=classroomController.checkStatus(session);\n" +
      "    renderSecondBrainAction();\n" +
      "    const result=await pending;\n" +
      "    if(result.stale||result.skipped)return;\n" +
      "    renderSecondBrainAction();\n" +
      "  }\n" +
      "  // GATE 5F.C Part G/L — deliberately synchronous up to classroomController.start()'s own\n" +
      "  // window.open() call: this handler itself performs no await before that point (confirm() is\n" +
      "  // native/blocking, not async), so window.open() always runs within the same trusted-click call\n" +
      "  // stack the browser's popup blocker requires. This function must stay non-async.\n" +
      "  // GATE 5F.D2.F1: the confirmation is now driven by the controller's server-derived guard, so it\n" +
      "  // also applies after a Teaching refresh and whenever the status could not be determined.\n" +
      "  function onClassroomStartClick(){\n" +
      "    const guard=classroomController.getStartGuard();\n" +
      "    if(guard===\"busy\")return;\n" +
      "    if(guard===\"replace-active\"){\n" +
      "      if(!confirm(\"Chiếu phiên mới sẽ kết thúc phiên chiếu đang hoạt động. Tiếp tục?\"))return;\n" +
      "      runClassroomStart(true);\n" +
      "      return;\n" +
      "    }\n" +
      "    if(guard===\"status-unknown\"){\n" +
      "      if(!confirm(\"Không xác định được trạng thái trình chiếu. Có thể đang có một phiên chiếu hoạt động, và chiếu mới sẽ kết thúc phiên đó. Tiếp tục?\"))return;\n" +
      "      runClassroomStart(true);\n" +
      "      return;\n" +
      "    }\n" +
      "    runClassroomStart(false);\n" +
      "  }\n" +
      "  // GATE 5F.C FIX1 — classroomController.start() now checks window.open() BEFORE any network\n" +
      "  // call (see classroom-projection-launch.mjs), so a blocked popup is just another `!result.ok`\n" +
      "  // failure (code POPUP_BLOCKED) with its own mapped Vietnamese message — no separate modal/\n" +
      "  // retry-with-the-same-token flow is needed or possible any more (no token was ever requested).\n" +
      "  // The lecturer simply allows popups and clicks \"Trình chiếu Second Brain\" again.\n" +
      "  // GATE 5F.D2.F1: start() is invoked BEFORE the first await (and before any re-render), so its\n" +
      "  // window.open() call stays inside the click's synchronous call stack.\n" +
      "  async function runClassroomStart(confirmed){\n" +
      "    const pending=classroomController.start(session,{confirmed});\n" +
      "    renderSecondBrainAction(); // reflect \"starting\" immediately (button disabled) while the request is in flight\n" +
      "    const result=await pending;\n" +
      "    if(result.needsConfirmation){ renderSecondBrainAction(); return; } // guarded above; defensive only\n" +
      "    if(!result.ok){\n" +
      "      toast(result.message,\"err\");\n" +
      "      renderSecondBrainAction();\n" +
      "      // An ambiguous failure (e.g. the response was lost) may have left a grant on the server.\n" +
      "      if(result.recheckStatus&&classroomDashCurrent())refreshClassroomStatus();\n" +
      "      return;\n" +
      "    }\n" +
      "    toast(\"Đã mở Trình chiếu Second Brain.\",\"ok\");\n" +
      "    renderSecondBrainAction();\n" +
      "  }\n" +
      "  async function onClassroomCloseClick(){\n" +
      "    const btn=$(\"#knClassroomClose\"); if(btn)btn.disabled=true;\n" +
      "    const pending=classroomController.close(session);\n" +
      "    renderSecondBrainAction();\n" +
      "    const result=await pending;\n" +
      "    if(result.ok){ toast(\"Đã đóng trình chiếu.\",\"ok\"); } else { toast(result.message,\"err\"); }\n" +
      "    renderSecondBrainAction();\n" +
      "    // GATE 5F.D2.POST-2: after a Close failure that wasn't itself an auth failure (e.g. the one\n" +
      "    // allowed forced-refresh retry succeeded getting a token but the request still failed some\n" +
      "    // other way), reconfirm the server-side state instead of trusting only the optimistic UI.\n" +
      "    if(!result.ok&&result.recheckStatus&&classroomDashCurrent())refreshClassroomStatus();\n" +
      "  }\n" +
      "  async function aiGateway(path,body){\n",
    withoutClassroomLaunch:
      "  }\n" +
      "  async function aiGateway(path,body){\n",
  },
];

test("GATE 5F.D2.G13B.1 RECONCILED (was: byte-identical to the affb0edb+Search-V1 baseline; category F): the JS module script equals CANONICAL_PRODUCTION_SHA's own script once EXACTLY the frozen, authorized Gate 5F.D2.G13B Classroom-launch delta is reversed back out — proving no OTHER (unauthorized) JS change exists beyond this gate's own independently-tested feature", () => {
  // GATE 5F.D2.G13B.1 — the old two-step reversal (Search V1, then Classroom-launch, down to the
  // ancient affb0edb baseline) stopped being valid once 9 OTHER separately-accepted production
  // commits landed on top of affb0edb+SearchV1 without ever being reconciled into this test (see
  // the comment above canonicalProductionScriptSrc's declaration for the full list and reasoning).
  // Reversing only this gate's own delta against CANONICAL_PRODUCTION_SHA is the correct, minimal
  // proof going forward: CANONICAL_PRODUCTION_SHA IS the accepted baseline now.
  let stripped = scriptSrc;
  for (const chunk of knownClassroomLaunchAdditions) {
    const occurrences = stripped.split(chunk.withClassroomLaunch).length - 1;
    assert.equal(occurrences, chunk.expectedOccurrences, `authorized Classroom-launch chunk "${chunk.name}" must occur exactly ${chunk.expectedOccurrences}x verbatim (found ${occurrences})`);
    stripped = stripped.split(chunk.withClassroomLaunch).join(chunk.withoutClassroomLaunch);
  }
  assert.equal(stripped, canonicalProductionScriptSrc, "after reversing exactly the known Gate 5F.D2.G13B Classroom-launch delta, the JS must be byte-identical to CANONICAL_PRODUCTION_SHA's own script (no other JS change)");
});

// ===================================================================================
// Item 5 — no Search implementation anywhere (this hotfix is fully independent of, and must
// never absorb, the separate uncommitted Search V1 candidate)
// ===================================================================================

test("GATE 4C-F.4 RECONCILED (was: no Search implementation exists in this worktree; category E): knPfSearch is now the authorized GATE 4C-F.2 Search V1 implementation (frozen contract + full coverage in test/gate4c-f2/search.test.mjs) — its presence here is expected, not a hotfix-scope violation", () => {
  assert.match(source, /knPfSearch/);
  assert.match(source, /knPfNormalizeSearch/);
  assert.match(source, /knPfSearchableText/);
});

// ===================================================================================
// Item 9/10 — the two concrete overrides the audit specified are present verbatim: 3-column
// summary grid preserved at narrow width, and controls compacted onto a flex-wrap row instead of
// each forcing width:100%.
// ===================================================================================

test("GATE 4C-E.3: Fullscreen summary grid override keeps repeat(3,1fr) (undoes the global <600px single-column stacking, Fullscreen-participant-scoped only)", () => {
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3\{grid-template-columns:repeat\(3,1fr\); gap:8px;\}/);
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3 \.card\.knowledge-stat\{padding:10px;\}/);
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded \.grid\.grid-3 \.card\.knowledge-stat strong\{font-size:20px;\}/);
});

test("GATE 4C-E.3: Fullscreen control-row override compacts status/class selects onto a flex-wrap row (undoes the global width:100% forcing, Fullscreen-participant-scoped only)", () => {
  assert.match(hotfixCss, /\.modal\.is-fullscreen \.kn-pf-expanded > \.flex\.gap-8\.mt-8 > select,\n\.modal\.is-fullscreen \.kn-pf-expanded > \.flex\.gap-8\.mt-8 > input\[type=text\]\{width:auto; flex:1 1 150px; min-width:120px;\}/);
});

// ===================================================================================
// Item 11 — table-wrap receives usable height purely as a consequence of shrinking its siblings;
// the hotfix must contain no rule that targets .table-wrap directly (the pre-existing table-wrap
// flex/min-height CSS from GATE 4C-E was already correct and is left untouched).
// ===================================================================================

test("GATE 4C-E.3: the hotfix contains no rule targeting .table-wrap directly (height gain comes from shrinking siblings, not from touching table-wrap's own already-correct flex CSS)", () => {
  assert.doesNotMatch(hotfixCssRulesOnly, /\.table-wrap/);
  const tableWrapRule = ".modal.is-fullscreen .kn-pf-expanded .table-wrap{flex:1 1 auto; min-height:0; max-height:none; overflow-y:auto;}";
  assert.match(cssBlock, new RegExp(tableWrapRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(baselineCssBlock, new RegExp(tableWrapRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ===================================================================================
// Item 12 — sticky header rule (pre-existing, shared by Compact and Expanded) is untouched
// ===================================================================================

test("GATE 4C-E.3: .kn-pf-expanded sticky thead rule is byte-identical to baseline", () => {
  const stickyRule = ".kn-pf-expanded .table-wrap thead th{position:sticky; top:0; background:var(--card); z-index:1;}";
  assert.match(cssBlock, new RegExp(stickyRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(baselineCssBlock, new RegExp(stickyRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ===================================================================================
// Item 13/14 — no fixed oversized pixel widths and no document/body-level overflow/height
// properties introduced (the structural preconditions for "no horizontal overflow" / "no
// document overflow"; the numeric zero-overflow result itself was proven by real browser
// measurement during verification, not re-derived here).
// ===================================================================================

test("GATE 4C-E.3: the hotfix uses only relative/flex sizing (no fixed pixel widths that could force horizontal overflow) and touches no document/body/html rule", () => {
  const declaredWidths = hotfixCssRulesOnly.match(/(?<![\w-])width:\s*[^;]+;/g) || [];
  assert.ok(declaredWidths.length > 0, "expected at least one width declaration to check");
  for (const w of declaredWidths) {
    assert.match(w, /^width:\s*(auto)\s*;$/, `unexpected fixed-width declaration in hotfix CSS: "${w}"`);
  }
  assert.doesNotMatch(hotfixCssRulesOnly, /\bhtml\b|\bbody\b/);
});

// ===================================================================================
// Item 20 — protected infrastructure (Rules, indexes, Auth-adjacent modules, package files)
// remains byte-identical to baseline
// ===================================================================================

test("GATE 4C-E.3: protected infrastructure files are byte-identical to baseline (Rules/schema/Auth/package files untouched)", () => {
  const protectedFiles = [
    "firestore.rules",
    "firestore.rules.production-candidate",
    "firestore.indexes.json",
    "package.json",
    "package-lock.json",
  ];
  const diff = execFileSync("git", ["diff", BASELINE, "--", ...protectedFiles], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(diff.trim(), "", `expected empty diff against baseline for protected files, got:\n${diff}`);
});

// ===================================================================================
// GATE 5F.D2.F3 — MODULE-WIDE FIRESTORE PROTECTION (separate from, and independent of, the
// byte-freeze above).
//
// The byte-freeze above is what used to prove "zero new Firestore reads/writes/listeners" for the
// WHOLE module script as a side effect of "no other JS change". Reconciling it for the authorized
// Gate 5F.C/F1 delta must not lose that protection, so it is asserted here explicitly and directly,
// against the accepted PRODUCTION baseline (not the historical Gate 4C-E baseline), over the ENTIRE
// index.html module script — not merely inside selected functions.
//
// Method: a small lexer (below) strips comments, string literals and template TEXT (keeping `${…}`
// expressions, which are real code), then works on identifier TOKENS, so:
//   - a Firestore call inside a comment / string / HTML template text is NOT counted;
//   - formatting changes (whitespace, line breaks, `getDocs (`) do not change the result;
//   - aliasing (`const f=getDocs;`) and passing an entry point as a value still count (any
//     identifier reference, not only `name(`);
//   - a "net zero" swap (remove one call, add another, or change WHICH collection a call reads) is
//     detected, because each call site is fingerprinted by its neighbouring tokens (including the
//     string literals, i.e. the collection/document path), not merely counted.
//
// LIMITATIONS (deliberately documented, not hidden):
//   - No scope analysis: an unrelated variable that happens to be named like an entry point (e.g.
//     `commit`) is counted too. That can only cause a false alarm, never a miss.
//   - Firestore reached only through computed/obfuscated access (`window["get"+"Docs"]`, `eval`,
//     `new Function`, dynamic `import()`, a raw REST call to firestore.googleapis.com) is not
//     tokenised as an entry point; the escape-hatch check below asserts none of those hatches was
//     added, but a determined adversary editing this very test file is out of scope.
//   - Regex-literal detection is the usual previous-token heuristic; a mis-tokenised region would be
//     caught by the bracket-balance assertion on the real script, but is not otherwise provable.
//   - It guards Firestore only. Other network use (e.g. the Classroom `fetch`) is intentionally out
//     of scope here and is covered by the Gate 5F.C/F1 tests.
//   - Fingerprint windows (4 tokens before / 12 after) mean a legitimate future edit made
//     immediately next to an existing Firestore call will need this test updated — by design.
// ===================================================================================

// GATE 5F.D2.G13B — rebuilt on the exact current Teaching production SHA (Gate 5F.D2.G13A.1),
// not the old, abandoned Gate 5F.C candidate's checkpoint. AUTHORIZED_FIRESTORE_DELTA staying
// empty below proves this candidate introduces zero new/changed Firestore call sites relative to
// current production, exactly as it did relative to the old checkpoint.
const PRODUCTION_BASELINE = "df397955206199aa1fd132e37239a2f86fac0659"; // exact current Teaching production SHA
const productionScriptSrc = sliceBetween(
  execFileSync("git", ["show", `${PRODUCTION_BASELINE}:index.html`], { cwd: repoRoot, encoding: "utf8" }).replace(/\r\n/g, "\n"),
  '<script type="module">',
  "</script>",
  "production baseline script",
);

// Firestore read / write / transaction / listener entry points (modular Web SDK) plus the reference
// constructors that decide WHICH data is touched, plus the SDK bootstrap/network switches.
const FIRESTORE_ENTRY_POINTS = new Set([
  "getDoc", "getDocs", "getDocFromServer", "getDocsFromServer", "getDocFromCache", "getDocsFromCache",
  "onSnapshot", "onSnapshotsInSync",
  "addDoc", "setDoc", "updateDoc", "deleteDoc",
  "writeBatch", "runTransaction", "commit",
  "getCountFromServer", "getAggregateFromServer",
  "loadBundle", "namedQuery",
  "collection", "collectionGroup", "doc", "query",
  "getFirestore", "initializeFirestore", "connectFirestoreEmulator",
  "enableNetwork", "disableNetwork", "waitForPendingWrites", "terminate",
  "enableIndexedDbPersistence", "clearIndexedDbPersistence",
]);
const ESCAPE_HATCH_IDENTIFIERS = new Set(["eval", "Function", "importScripts"]);
const FINGERPRINT_BEFORE = 4;
const FINGERPRINT_AFTER = 12;

const REGEX_MAY_FOLLOW_KEYWORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** Minimal JavaScript lexer: comments dropped; strings kept as one token; template TEXT collapsed to
 * one "tpl" token while `${…}` expressions are tokenised as ordinary code; regex literals recognised
 * by the previous-significant-token heuristic. Returns { tokens, balanced }. */
function tokenizeJs(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  const push = (t, v) => tokens.push({ t, v });
  const isIdStart = (c) => /[A-Za-z_$]/.test(c) || c > "\u007f";
  const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c) || c > "\u007f";
  const isDigit = (c) => c >= "0" && c <= "9";
  const regexAllowed = () => {
    const p = tokens[tokens.length - 1];
    if (!p) return true;
    if (p.t === "num" || p.t === "str" || p.t === "tpl" || p.t === "regex") return false;
    if (p.t === "id") return REGEX_MAY_FOLLOW_KEYWORD.has(p.v);
    return !(p.v === ")" || p.v === "]" || p.v === "}");
  };
  function scanTemplate() {
    let text = "";
    while (i < n) {
      const c = src[i];
      if (c === "\\") { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { i++; push("tpl", text); return; }
      if (c === "$" && src[i + 1] === "{") {
        push("tpl", text); text = "";
        i += 2; push("punct", "{");
        scanCode(true);
        push("punct", "}");
        continue;
      }
      text += c; i++;
    }
  }
  function scanCode(inTemplateExpr) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === " " || c === "\n" || c === "\t" || c === "\r" || /\s/.test(c)) { i++; continue; }
      if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e < 0 ? n : e + 1; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1; let text = "";
        while (j < n && src[j] !== c) { if (src[j] === "\\") { text += src.slice(j, j + 2); j += 2; } else { text += src[j]; j++; } }
        i = j + 1; push("str", text); continue;
      }
      if (c === "`") { i++; scanTemplate(); continue; }
      if (c === "/" && regexAllowed()) {
        let j = i + 1; let inClass = false; let ok = false;
        while (j < n && src[j] !== "\n") {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) { ok = true; break; }
          j++;
        }
        if (ok) { const body = src.slice(i + 1, j); j++; while (j < n && /[a-z]/.test(src[j])) j++; i = j; push("regex", body); continue; }
      }
      if (isIdStart(c)) { let j = i + 1; while (j < n && isIdPart(src[j])) j++; push("id", src.slice(i, j)); i = j; continue; }
      if (isDigit(c) || (c === "." && isDigit(src[i + 1] || ""))) { let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++; push("num", src.slice(i, j)); i = j; continue; }
      if (c === "{") depth++;
      if (c === "}") { if (inTemplateExpr && depth === 0) { i++; return; } depth--; }
      push("punct", c); i++;
    }
  }
  scanCode(false);
  // bracket balance across real code tokens (template `${` / `}` were pushed as `{` / `}`)
  const stack = []; let balanced = true;
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (const t of tokens) {
    if (t.t !== "punct") continue;
    if ("([{".includes(t.v)) stack.push(t.v);
    else if (")]}".includes(t.v)) { if (stack.pop() !== pairs[t.v]) { balanced = false; break; } }
  }
  if (stack.length) balanced = false;
  return { tokens, balanced };
}

const tokenText = (tok) => (tok.t === "tpl" ? "tpl:" : tok.t + ":" + tok.v); // template TEXT never enters a fingerprint

/** Per-entry-point identifier counts and a multiset of call-site fingerprints for one script. */
function firestoreSurface(src) {
  const { tokens, balanced } = tokenizeJs(src);
  const counts = new Map();
  const fingerprints = new Map();
  const escapes = { identifiers: new Map(), dynamicImports: 0, restUrlStrings: 0 };
  tokens.forEach((tok, idx) => {
    if (tok.t === "id" && FIRESTORE_ENTRY_POINTS.has(tok.v)) {
      counts.set(tok.v, (counts.get(tok.v) || 0) + 1);
      const fp = tokens.slice(Math.max(0, idx - FINGERPRINT_BEFORE), idx + FINGERPRINT_AFTER + 1).map(tokenText).join("\u0001");
      fingerprints.set(fp, (fingerprints.get(fp) || 0) + 1);
    }
    if (tok.t === "id" && ESCAPE_HATCH_IDENTIFIERS.has(tok.v)) escapes.identifiers.set(tok.v, (escapes.identifiers.get(tok.v) || 0) + 1);
    if (tok.t === "id" && tok.v === "import" && tokens[idx + 1] && tokens[idx + 1].v === "(") escapes.dynamicImports++;
    if (tok.t === "str" && /firestore\.googleapis/i.test(tok.v)) escapes.restUrlStrings++;
  });
  return { counts, fingerprints, escapes, balanced, tokenCount: tokens.length };
}

const previewFingerprint = (fp) => fp.split("\u0001").slice(FINGERPRINT_BEFORE, FINGERPRINT_BEFORE + 14).map((s) => s.replace(/^[a-z]+:/, "")).join(" ").slice(0, 220);
const mapToObject = (m) => Object.fromEntries([...m.entries()].sort());

// The accepted Gate 5F.C/F1 delta adds NO Firestore entry point, so the authorized Firestore delta is
// empty. That emptiness is not merely asserted here: the first test below proves it from the frozen
// authorized chunks themselves.
const AUTHORIZED_FIRESTORE_DELTA = { addedFingerprints: [], removedFingerprints: [] };

test("GATE 5F.D2.F3 lexer self-test: comments, strings and template text are ignored; template expressions, aliases and formatting variants are handled", () => {
  const count = (src) => [...firestoreSurface(src).counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(count("// getDocs(q)\n/* onSnapshot(q) */ const a = 1;"), 0, "comments are ignored");
  assert.equal(count('const s = "getDocs(q) onSnapshot(q)"; const t = \'setDoc(x)\';'), 0, "string literals are ignored");
  assert.equal(count("const h = `<p>getDocs(q) and onSnapshot(q)</p>`;"), 0, "template TEXT is ignored");
  assert.equal(count("const h = `<p>${await getDocs(q)}</p>`;"), 1, "a call inside a template expression is real code and IS counted");
  assert.equal(count("const h = `a${ `b${ getDoc(x) }` }c`;"), 1, "nested templates");
  assert.equal(count("await getDocs (\n  q\n);"), 1, "formatting variants are counted the same");
  assert.equal(count("const f = getDocs; f(q);"), 1, "aliasing an entry point is still a reference");
  assert.equal(count("x.commit();"), 1, "member calls (batch.commit) are counted");
  assert.equal(count('const r = /["\']getDocs/.test(s); getDocs(q);'), 1, "a regex literal containing quotes/call text neither opens a string nor counts, and code after it is still lexed");
  assert.equal(count("const r = a / b; getDocs(q); const z = c / d;"), 1, "division is not mistaken for a regex");
  assert.equal(firestoreSurface("function f(){ if(a){ return [1,(2)]; } }").balanced, true);
  assert.equal(firestoreSurface("function f(){ if(a){ return [1,(2)]; }").balanced, false, "unbalanced input is reported");
});

test("GATE 5F.D2.F3 lexer self-test: fingerprints ignore formatting/comments but detect a changed path, a swapped call, or a new call", () => {
  const fp = (src) => JSON.stringify([...firestoreSurface(src).fingerprints.entries()].sort());
  const base = 'const snap = await getDocs(query(collection(db,"knowledgeSessions",id,"submissions"),limit(50)));';
  assert.equal(fp(base), fp('const   snap =\n  await getDocs (\n query( /* c */ collection(db , "knowledgeSessions" , id , "submissions") , limit( 50 ) ) ) ; // note'), "formatting and comments do not change the fingerprint");
  assert.notEqual(fp(base), fp(base.replace('"submissions"', '"participants"')), "reading a different collection is detected");
  assert.notEqual(fp(base), fp(base.replace("getDocs", "onSnapshot")), "swapping a read for a listener is detected");
  assert.notEqual(fp(base), fp(base + " await getDoc(ref);"), "a new call is detected");
  assert.notEqual(fp(base + " await getDoc(ref);"), fp(base + " await getDoc(ref2);"), "the arguments of an added call are part of the fingerprint");
});

test("GATE 5F.D2.F3: the real module scripts lex cleanly (balanced brackets, substantial token stream, non-vacuous baseline)", () => {
  const current = firestoreSurface(scriptSrc);
  const production = firestoreSurface(productionScriptSrc);
  assert.equal(production.balanced, true, "production baseline script must lex with balanced brackets");
  assert.equal(current.balanced, true, "current script must lex with balanced brackets");
  assert.ok(production.tokenCount > 50000, `implausibly small token stream (${production.tokenCount}) — lexer likely lost its place`);
  for (const name of ["onSnapshot", "getDocs", "getDoc", "addDoc", "setDoc", "updateDoc", "deleteDoc", "writeBatch", "runTransaction"]) {
    assert.ok((production.counts.get(name) || 0) > 0, `baseline must contain ${name} (otherwise this protection would be vacuous)`);
  }
});

test("GATE 5F.D2.F3: the frozen, authorized Gate 5F.C/F1 chunks contain NO Firestore entry point and no escape hatch (so the authorized Firestore delta really is empty)", () => {
  for (const chunk of knownClassroomLaunchAdditions) {
    const withSurface = firestoreSurface(chunk.withClassroomLaunch);
    const withoutSurface = firestoreSurface(chunk.withoutClassroomLaunch);
    // Compare the chunk with what it replaces: nothing Firestore-related may be added or removed.
    assert.deepEqual(mapToObject(withSurface.counts), mapToObject(withoutSurface.counts), `authorized chunk "${chunk.name}" changes Firestore entry-point usage`);
    assert.equal(withSurface.escapes.identifiers.size, 0, `authorized chunk "${chunk.name}" introduces an escape hatch (eval/Function/importScripts)`);
    assert.equal(withSurface.escapes.dynamicImports, 0, `authorized chunk "${chunk.name}" introduces a dynamic import()`);
    assert.equal(withSurface.escapes.restUrlStrings, 0, `authorized chunk "${chunk.name}" references the Firestore REST host`);
  }
  assert.deepEqual(AUTHORIZED_FIRESTORE_DELTA, { addedFingerprints: [], removedFingerprints: [] });
});

test("GATE 5F.D2.F3: NO new or changed Firestore read/write/transaction/listener call ANYWHERE in the module script vs the accepted production baseline", () => {
  const current = firestoreSurface(scriptSrc);
  const production = firestoreSurface(productionScriptSrc);
  // 1) per-entry-point identifier counts (readable diagnostics)
  assert.deepEqual(mapToObject(current.counts), mapToObject(production.counts), "a Firestore entry-point identifier count differs from production (only the empty authorized delta is allowed)");
  // 2) call-site fingerprints: catches a swapped call, a changed collection/document path, or a moved-in duplicate
  const extra = []; const missing = [];
  for (const [fp, c] of current.fingerprints) { const p = production.fingerprints.get(fp) || 0; if (c > p) extra.push(`${c - p}× ${previewFingerprint(fp)}`); }
  for (const [fp, p] of production.fingerprints) { const c = current.fingerprints.get(fp) || 0; if (p > c) missing.push(`${p - c}× ${previewFingerprint(fp)}`); }
  assert.deepEqual({ extra, missing }, { extra: AUTHORIZED_FIRESTORE_DELTA.addedFingerprints, missing: AUTHORIZED_FIRESTORE_DELTA.removedFingerprints }, "Firestore call sites differ from the accepted production baseline");
});

test("GATE 5F.D2.F3: no escape hatch (eval / Function / importScripts / dynamic import() / Firestore REST host) was added anywhere in the module script", () => {
  const current = firestoreSurface(scriptSrc).escapes;
  const production = firestoreSurface(productionScriptSrc).escapes;
  assert.deepEqual(mapToObject(current.identifiers), mapToObject(production.identifiers));
  assert.equal(current.dynamicImports, production.dynamicImports);
  assert.equal(current.restUrlStrings, production.restUrlStrings);
});
