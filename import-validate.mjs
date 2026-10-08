// Library V2 P4-S2 - the 10-STAGE VALIDATION PIPELINE and the normalized ImportModel (pure, inert, deterministic; no writes, no DOM, no network, no clock).
//
//   stage 1  file / container           (import-xlsx-container.mjs, run inside the Worker; surfaced here)
//   stage 2  workbook + template        sheets, _meta, templateId, schemaVersion, header checksum      (import-normalize.mjs)
//   stage 3  schema                     exact headers, no stray columns, one KHUNG row                 (import-normalize.mjs)
//   stage 4  row normalization          cell types, formulas, characters, NFC/trim, numeric codes     (import-normalize.mjs)
//   stage 5  structure                  subjects present, lesson -> subject reference, order groups    (this module)
//   stage 6  P3 domain                  names/codes/framework name via the P3 validators, kind/depth   (this module)
//   stage 7  canonical codes            P3 codeConflictOf over MÔN then BÀI in sheet order             (this module)
//   stage 8  bounds                     <= 5000 nodes, bounded error list                              (this module)
//   stage 9  preview readiness          synthetic tree through P3 validateTree + activationReadiness   (this module)
//   stage 10 pre-write revalidation     import-plan.mjs `prepareCommit` (organization active, stages 5-9 again, every payload built before any write)
//
// RULE: a file with ANY error never yields a model, and only a model produced here (registered in a WeakSet) can be turned into an import plan.
// P3 semantics are reused, not re-implemented: canonicalizeNodeCode / codeConflictOf (canonical code policy), validateNodeName / normalizeNodeCode /
// validateFrameworkName (bounds), uiKindForParent / canAddChild (depth), validateTree / activationReadiness (tree).
import {
  CURRICULUM_MAX_NODES, FRAMEWORK_NAME_MIN, FRAMEWORK_NAME_MAX, NODE_NAME_MIN, NODE_NAME_MAX, NODE_CODE_MIN, NODE_CODE_MAX,
  canonicalizeNodeCode, validateFrameworkName, validateNodeName, normalizeNodeCode, uiKindForParent, canAddChild, validateTree, activationReadiness
} from "./curriculum-model.mjs";
import { SHEET_SUBJECTS, SHEET_LESSONS, SHEET_COLUMNS, PARSER_ADAPTER_ID, IMPORT_LIMITS } from "./import-template.mjs";
import { diag, createCollector, sortDiagnostics, errorsOf, warningsOf, STAGES } from "./import-diagnostics.mjs";
import { interpretWorkbook } from "./import-normalize.mjs";

const LIM = IMPORT_LIMITS;
const deepFreeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; };
const VALIDATED = new WeakSet();
export const isValidatedModel = (model) => !!model && typeof model === "object" && VALIDATED.has(model);

const sheetOf = (node) => node.sourceRef.sheet;
const columnOf = (field) => {
  const sheets = { subjectCode: SHEET_SUBJECTS, subjectName: SHEET_SUBJECTS, lessonCode: SHEET_LESSONS, lessonName: SHEET_LESSONS };
  const found = SHEET_COLUMNS[sheets[field]];
  return found ? (found.find((c) => c.key === field) || {}).header || null : null;
};

// ---------------------------------------------------------------- candidate (what stages 5-9 operate on)
export function candidateFromRows(interp, file) {
  const nodes = [];
  for (const s of interp.subjects) nodes.push({ key: "MON:" + s.row, kind: "subject", parentKey: null, subjectCodeRef: null, code: s.code, name: s.name, explicitOrder: s.explicitOrder, orderFailed: !!s.orderFailed, order: null, orderSource: null, sourceRef: { sheet: SHEET_SUBJECTS, row: s.row }, notes: s.notes, original: pickOriginal(s), failed: s.failed });
  for (const l of interp.lessons) nodes.push({ key: "BAI:" + l.row, kind: "lesson", parentKey: null, subjectCodeRef: l.subjectCodeRef, code: l.code, name: l.name, explicitOrder: l.explicitOrder, orderFailed: !!l.orderFailed, order: null, orderSource: null, sourceRef: { sheet: SHEET_LESSONS, row: l.row }, notes: l.notes, original: pickOriginal(l), failed: l.failed });
  return { template: interp.template, file, framework: interp.framework, nodes };
}
function pickOriginal(row) {
  const original = {};
  if (row.codeOriginal) original.code = row.codeOriginal;
  if (row.nameOriginal) original.name = row.nameOriginal;
  return Object.keys(original).length ? original : null;
}
export function candidateFromModel(model) {
  return {
    template: { templateId: model.templateId, schemaVersion: model.schemaVersion, generator: model.generator }, file: model.source,
    framework: { name: model.framework.name, original: model.framework.original || null, notes: model.framework.notes, sourceRef: model.framework.sourceRef },
    nodes: model.nodes.map((node) => ({ key: node.key, kind: node.kind, parentKey: null, subjectCodeRef: node.subjectCodeRef, code: node.code, name: node.name, explicitOrder: node.explicitOrder, orderFailed: false, order: null, orderSource: null, sourceRef: { ...node.sourceRef }, notes: node.notes.slice(), original: node.original || null, failed: false }))
  };
}

// ---------------------------------------------------------------- stage 5: structure, references, order consistency
export function stage5(candidate, report) {
  const subjects = candidate.nodes.filter((n) => n.kind === "subject");
  const lessons = candidate.nodes.filter((n) => n.kind === "lesson");
  if (subjects.length === 0) report(diag("NO_SUBJECT", { sheet: SHEET_SUBJECTS }));
  const bySubjectCode = new Map();
  for (const subject of subjects) {
    if (typeof subject.code !== "string") continue;
    const key = canonicalizeNodeCode(subject.code);
    if (key !== null && !bySubjectCode.has(key)) bySubjectCode.set(key, subject);
  }
  const lessonCount = new Map();
  for (const lesson of lessons) {
    lesson.parentKey = null;
    if (typeof lesson.subjectCodeRef !== "string") continue;
    const parent = bySubjectCode.get(canonicalizeNodeCode(lesson.subjectCodeRef));
    if (!parent) { report(diag("LESSON_ORPHAN", { sheet: SHEET_LESSONS, row: lesson.sourceRef.row, column: columnOf("subjectCode") || SHEET_COLUMNS[SHEET_LESSONS][0].header, field: "subjectCode", value: lesson.subjectCodeRef })); continue; }
    lesson.parentKey = parent.key;
    lessonCount.set(parent.key, (lessonCount.get(parent.key) || 0) + 1);
  }
  for (const subject of subjects) if (!subject.failed && !lessonCount.has(subject.key)) report(diag("SUBJECT_EMPTY", { sheet: SHEET_SUBJECTS, row: subject.sourceRef.row, value: subject.code }));
  // order consistency per sibling group (all MÔN rows form one group; BÀI rows form one group per subject): ALL explicit and unique, or NONE explicit
  const groups = new Map();
  for (const node of candidate.nodes) {
    if (node.kind === "lesson" && node.parentKey === null) continue;
    const key = node.kind === "subject" ? "" : node.parentKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  for (const [key, members] of groups) {
    const live = members.filter((n) => !n.orderFailed);
    const explicit = live.filter((n) => n.explicitOrder !== null);
    const label = key === "" ? "nhóm MÔN" : "các bài của cùng một môn";
    if (explicit.length > 0 && explicit.length < live.length) {
      const first = live.find((n) => n.explicitOrder === null);
      report(diag("ORDER_MIXED", { sheet: sheetOf(first), row: first.sourceRef.row, column: "Thứ tự", field: "order", group: label }));
      for (const n of members) { n.order = null; n.orderSource = null; }
      continue;
    }
    const seen = new Map();
    let duplicated = false;
    for (const n of explicit) {
      if (seen.has(n.explicitOrder)) { duplicated = true; report(diag("ORDER_DUPLICATE", { sheet: sheetOf(n), row: n.sourceRef.row, column: "Thứ tự", field: "order", value: n.explicitOrder, otherRow: seen.get(n.explicitOrder), group: label, refs: [{ sheet: sheetOf(n), row: seen.get(n.explicitOrder) }] })); }
      else seen.set(n.explicitOrder, n.sourceRef.row);
    }
    let position = 0;
    for (const n of members) {
      if (n.orderFailed) { n.order = null; n.orderSource = null; continue; }
      if (explicit.length > 0) { n.order = duplicated ? null : n.explicitOrder; n.orderSource = "explicit"; }
      else { n.order = position++; n.orderSource = "position"; }
    }
  }
}

// ---------------------------------------------------------------- stage 6: P3 domain rules
function domainDiag(error, base, lengthOf, kind) {
  if (error && error.code === "NAME") return diag(kind === "framework" ? "FRAMEWORK_NAME_LENGTH" : "NAME_LENGTH", { ...base, length: lengthOf, min: kind === "framework" ? FRAMEWORK_NAME_MIN : NODE_NAME_MIN, max: kind === "framework" ? FRAMEWORK_NAME_MAX : NODE_NAME_MAX });
  if (error && error.code === "CODE") return diag("CODE_LENGTH", { ...base, length: lengthOf, min: NODE_CODE_MIN, max: NODE_CODE_MAX });
  return diag("DOMAIN_ERROR", { ...base, detail: error && error.message ? error.message : "không hợp lệ" });
}
export function stage6(candidate, report) {
  if (candidate.framework) {
    try { validateFrameworkName(candidate.framework.name); } catch (error) { report(domainDiag(error, { sheet: candidate.framework.sourceRef.sheet, row: candidate.framework.sourceRef.row, column: "Tên khung chương trình", field: "frameworkName", value: candidate.framework.name }, candidate.framework.name.length, "framework")); }
  }
  const subjectProbe = { id: "probe", ancestors: [] };
  for (const node of candidate.nodes) {
    const sheet = sheetOf(node), row = node.sourceRef.row;
    const isSubject = node.kind === "subject";
    const nameField = isSubject ? "subjectName" : "lessonName", codeField = isSubject ? "subjectCode" : "lessonCode";
    if (typeof node.name === "string") { try { validateNodeName(node.name); } catch (error) { report(domainDiag(error, { sheet, row, column: columnOf(nameField), field: nameField, value: node.name }, node.name.length)); } }
    if (typeof node.code === "string") { try { normalizeNodeCode(node.code); } catch (error) { report(domainDiag(error, { sheet, row, column: columnOf(codeField), field: codeField, value: node.code }, node.code.length)); } }
    if (!isSubject && typeof node.subjectCodeRef === "string") { try { normalizeNodeCode(node.subjectCodeRef); } catch (error) { report(domainDiag(error, { sheet, row, column: SHEET_COLUMNS[SHEET_LESSONS][0].header, field: "subjectCode", value: node.subjectCodeRef }, node.subjectCodeRef.length)); } }
    // kind / depth: the template v1 is exactly two levels, and the P3 UI offers subject at the root and lesson below a subject
    const parent = isSubject ? null : subjectProbe;
    if (uiKindForParent(parent) !== node.kind || (parent && !canAddChild(parent))) report(diag("DOMAIN_ERROR", { sheet, row, detail: "cấp " + node.kind + " không được phép ở vị trí này" }));
  }
}

// ---------------------------------------------------------------- stage 7: canonical code uniqueness (P3 policy; MÔN then BÀI, in row order)
export function stage7(candidate, report) {
  // Same semantics as P3 codeConflictOf(accepted, code) - the FIRST accepted node whose canonicalizeNodeCode(code) equals this code's key wins - but with a
  // Map of canonical keys instead of a linear scan (5000 nodes: O(n) instead of O(n^2) canonicalizations). test/library-v2-p4-s2/pipeline.test.mjs proves the
  // equivalence against codeConflictOf itself on adversarial data.
  const firstByKey = new Map();
  const byKey = new Map(candidate.nodes.map((n) => [n.key, n]));
  const ordered = [...candidate.nodes.filter((n) => n.kind === "subject"), ...candidate.nodes.filter((n) => n.kind === "lesson")];
  for (const node of ordered) {
    if (typeof node.code !== "string") continue;
    let normalized = null;
    try { normalized = normalizeNodeCode(node.code); } catch (error) { continue; }          // length errors were reported by stage 6
    if (normalized === null) continue;
    const canonical = canonicalizeNodeCode(normalized);
    if (canonical === null) continue;
    const first = firstByKey.get(canonical);
    if (first) {
      report(diag("CODE_DUPLICATE", { sheet: sheetOf(node), row: node.sourceRef.row, column: columnOf(node.kind === "subject" ? "subjectCode" : "lessonCode"), field: node.kind === "subject" ? "subjectCode" : "lessonCode", value: node.code, otherRow: first.sourceRef.row, otherSheet: sheetOf(first), refs: [{ sheet: sheetOf(first), row: first.sourceRef.row }] }));
    } else firstByKey.set(canonical, node);
  }
}

// ---------------------------------------------------------------- stage 8: safety bounds
export function stage8(candidate, report) {
  if (candidate.nodes.length > CURRICULUM_MAX_NODES) report(diag("NODE_LIMIT", { count: candidate.nodes.length, max: CURRICULUM_MAX_NODES }));
}

// ---------------------------------------------------------------- stage 9: synthetic tree through the P3 tree validators
export function syntheticNodes(candidate, organizationId = "preview") {
  const byKey = new Map(candidate.nodes.map((n) => [n.key, n]));
  return candidate.nodes.map((n) => ({
    id: n.key, schemaVersion: 1, organizationId, kind: n.kind, parentId: n.parentKey, ancestors: n.parentKey ? [n.parentKey] : [], order: n.order, code: typeof n.code === "string" ? n.code : null, name: n.name, status: "active",
    _row: byKey.get(n.key).sourceRef.row
  }));
}
export function stage9(candidate, report) {
  const nodes = syntheticNodes(candidate).map(({ _row, ...rest }) => rest);
  const tree = validateTree(nodes, { organizationId: "preview" });
  for (const issue of tree.issues) report(diag("TREE_INVALID", { detail: issue.code + (issue.nodeId ? " [" + issue.nodeId + "]" : "") }));
  const readiness = activationReadiness({ status: "draft", organizationId: "preview" }, nodes);
  for (const error of readiness.errors) if (!error.code.startsWith("TREE_")) report(diag("NOT_READY", { detail: error.code }));
}

// Runs stages 5-9 on a candidate. Stage 9 only runs when 5-8 found no error (it is a defence-in-depth re-check of the same facts).
export function runDomainStages(candidate, collector) {
  const before = collector.errorCount;
  const report = (item) => collector.add(item);
  stage5(candidate, report); stage6(candidate, report); stage7(candidate, report); stage8(candidate, report);
  if (collector.errorCount === before) stage9(candidate, report);
}

// ---------------------------------------------------------------- orchestrator
const validFile = (file) => !!file && typeof file === "object" && typeof file.name === "string" && file.name.length >= 1 && file.name.length <= 200 && Number.isInteger(file.size) && file.size >= 0 && file.size <= LIM.maxFileBytes && typeof file.sha256 === "string" && /^[0-9a-f]{64}$/.test(file.sha256);

function buildModel(candidate, rawInfo, warnings) {
  const nodes = candidate.nodes.map((n) => ({
    key: n.key, kind: n.kind, parentKey: n.parentKey, subjectCodeRef: n.subjectCodeRef, code: typeof n.code === "string" ? normalizeNodeCode(n.code) : null, name: n.name,
    explicitOrder: n.explicitOrder, order: n.order, orderSource: n.orderSource, sourceRef: { sheet: n.sourceRef.sheet, row: n.sourceRef.row }, notes: n.notes.slice(), ...(n.original ? { original: { ...n.original } } : {})
  }));
  const subjects = nodes.filter((n) => n.kind === "subject").length;
  return {
    kind: "curriculum", parser: rawInfo.parser || PARSER_ADAPTER_ID, library: rawInfo.library || "", templateId: candidate.template.templateId, schemaVersion: candidate.template.schemaVersion, generator: candidate.template.generator,
    source: { name: candidate.file.name, size: candidate.file.size, sha256: candidate.file.sha256 },
    framework: { name: candidate.framework.name, sourceRef: { ...candidate.framework.sourceRef }, notes: candidate.framework.notes.slice(), ...(candidate.framework.original ? { original: candidate.framework.original } : {}) },
    nodes, counts: { subjects, lessons: nodes.length - subjects, total: nodes.length }, diagnostics: warnings
  };
}

// reading: the result of the Worker host { ok, diagnostics, raw, file }. Returns
// { ok, ready, model|null, diagnostics (sorted), errors, warnings, stages:[{stage,name,errors,warnings}], counts:{subjects,lessons,total}, file }.
export function validateImport(reading) {
  const collector = createCollector({ maxErrors: LIM.diagnostics.maxCollected, maxWarnings: LIM.diagnostics.maxCollected });
  const finish = (model, counts) => {
    const diagnostics = sortDiagnostics(collector.items());
    const errors = errorsOf(diagnostics), warnings = warningsOf(diagnostics);
    const stages = Object.keys(STAGES).map(Number).map((stage) => ({ stage, name: STAGES[stage], errors: errors.filter((d) => d.stage === stage).length, warnings: warnings.filter((d) => d.stage === stage).length }));
    return { ok: errors.length === 0, ready: errors.length === 0 && model !== null, model: errors.length === 0 ? model : null, diagnostics, errors, warnings, stages, counts: counts || { subjects: 0, lessons: 0, total: 0 }, file: reading ? reading.file || null : null };
  };
  if (!reading || typeof reading !== "object") { collector.add(diag("PARSE_EXCEPTION")); return finish(null); }
  collector.addAll(Array.isArray(reading.diagnostics) ? reading.diagnostics : []);               // stage 1 (container, parse) diagnostics from the Worker
  if (!reading.ok || !reading.raw) { if (collector.errorCount === 0) collector.add(diag("PARSE_EXCEPTION")); return finish(null); }
  if (!validFile(reading.file)) { collector.add(diag("FILE_INFO_INVALID")); return finish(null); }
  if (collector.errorCount > 0) return finish(null);
  const report = (item) => collector.add(item);
  const interp = interpretWorkbook(reading.raw, report);                                           // stages 2-4
  if (!interp.usable || !interp.framework) return finish(null);
  const candidate = candidateFromRows(interp, reading.file);
  const errorsBefore = collector.errorCount;
  // rows that failed in stage 4 already have a diagnostic; the domain stages still run on the rest so ONE pass reports everything actionable
  runDomainStages(candidate, collector);
  const counts = { subjects: candidate.nodes.filter((n) => n.kind === "subject").length, lessons: candidate.nodes.filter((n) => n.kind === "lesson").length, total: candidate.nodes.length };
  if (collector.errorCount > 0 || errorsBefore > 0 || candidate.nodes.some((n) => n.failed)) return finish(null, counts);
  const warnings = sortDiagnostics(collector.items().filter((d) => d.severity === "warning"));
  const model = deepFreeze(buildModel(candidate, reading.raw, warnings));
  VALIDATED.add(model);
  return finish(model, counts);
}

// Stage 10 helper (used by import-plan.mjs): re-run stages 5-9 on a validated model. Returns the error diagnostics.
export function revalidateModel(model) {
  if (!isValidatedModel(model)) return [diag("PLAN_BUILD_FAILED", { detail: "mô hình chưa được kiểm tra bởi bộ kiểm tra" })];
  const collector = createCollector();
  runDomainStages(candidateFromModel(model), collector);
  return errorsOf(collector.items());
}
