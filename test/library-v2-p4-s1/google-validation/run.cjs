const L = require("./lib.cjs"), W = require("./world.cjs");
const { T, OLD, FINAL, batchDoc, fwDoc, nodeDoc, tc } = W;
const id = "imp1", cases = [], labels = [];
const add = (label, actor, method, path, o) => { labels.push(label); cases.push(tc(label, actor, method, path, o)); };
const ACT = Object.entries(W.ACTORS);
const fwPath = "curriculumFrameworks/" + id, nodePath = fwPath + "/nodes/" + FINAL, bPath = "importBatches/" + id;
// ---------- batch transitions
for (const [a, { allow }] of ACT) {
  add("T1 progress committing->committing / " + a, a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { chunksDone: 1, updatedAt: T }), allow });
  const done = batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: T, updatedAt: T });
  add("T2 committing->completed (witness present) / " + a, a, "update", bPath, { resource: batchDoc(id), next: done, world: { [fwPath]: fwDoc("draft"), [nodePath]: nodeDoc() }, allow });
  add("T3 committing->partial / " + a, a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: T, updatedAt: T }), allow });
  add("T4 partial->rolled_back (framework+witness absent) / " + a, a, "update", bPath, { resource: batchDoc(id, { status: "partial", finishedAt: OLD }), next: batchDoc(id, { status: "rolled_back", finishedAt: T, updatedAt: T, resultCode: "COMMIT_FAILED" }), missing: [fwPath, nodePath], allow });
  add("T5 committing->rolled_back (framework+witness absent) / " + a, a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "rolled_back", finishedAt: T, updatedAt: T }), missing: [fwPath, nodePath], allow });
}
const doneNext = batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: T, updatedAt: T });
const D = (label, o) => add("N " + label + " / pa", "pa", "update", bPath, { allow: false, ...o });
D("completed but witness node missing", { resource: batchDoc(id), next: doneNext, world: { [fwPath]: fwDoc("draft") }, missing: [nodePath] });
D("completed but framework missing", { resource: batchDoc(id), next: doneNext, missing: [fwPath, nodePath] });
D("completed but framework already active", { resource: batchDoc(id), next: doneNext, world: { [fwPath]: fwDoc("active"), [nodePath]: nodeDoc() } });
D("completed but framework of another organization", { resource: batchDoc(id), next: doneNext, world: { [fwPath]: fwDoc("draft", { organizationId: "orgB" }), [nodePath]: nodeDoc() } });
D("completed but chunksDone != chunksTotal", { resource: batchDoc(id, { chunksTotal: 2 }), next: batchDoc(id, { chunksTotal: 2, status: "completed", chunksDone: 1, finishedAt: T, updatedAt: T }), world: { [fwPath]: fwDoc("draft"), [nodePath]: nodeDoc() } });
D("rolled_back but framework still exists", { resource: batchDoc(id), next: batchDoc(id, { status: "rolled_back", finishedAt: T, updatedAt: T }), world: { [fwPath]: fwDoc("draft") }, missing: [nodePath] });
D("rolled_back but witness node still exists", { resource: batchDoc(id), next: batchDoc(id, { status: "rolled_back", finishedAt: T, updatedAt: T }), world: { [nodePath]: nodeDoc() }, missing: [fwPath] });
D("completed is terminal (completed->rolled_back)", { resource: batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: OLD }), next: batchDoc(id, { status: "rolled_back", chunksDone: 1, finishedAt: T, updatedAt: T }), missing: [fwPath, nodePath] });
D("immutable identity (organizationId rewritten)", { resource: batchDoc(id), next: batchDoc(id, { organizationId: "orgB", chunksDone: 1, updatedAt: T }) });
D("finishedAt not equal to request.time", { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: OLD, updatedAt: T }) });
add("N delete batch / pa", "pa", "delete", bPath, { resource: batchDoc(id), allow: false });
// ---------- batch create
const create = (label, actor, o) => add(label, actor, "create", "importBatches/new1", { next: batchDoc("new1", { importer: actor, createdAt: T, updatedAt: T }), missing: ["curriculumFrameworks/new1"], allow: false, ...o });
for (const [a, { allow }] of ACT) create("C1 batch create (no framework with that id) / " + a, a, { allow });
create("C2 batch create DENIED when the framework id already exists / pa", "pa", { world: { "curriculumFrameworks/new1": fwDoc("draft") }, missing: [] });
create("C3 batch create DENIED with forged importer / pa", "pa", { next: batchDoc("new1", { importer: "oaA", createdAt: T, updatedAt: T }) });
create("C4 batch create DENIED with status completed / pa", "pa", { next: batchDoc("new1", { status: "completed", finishedAt: T, chunksDone: 1, createdAt: T, updatedAt: T }) });
// ---------- activation
const act = (actor) => fwDoc("active", { statusChangedAt: T, statusChangedBy: actor, activatedAt: T, updatedAt: T });
const actCase = (label, a, allow, world, missing) => add(label + " / " + a, a, "update", fwPath, { resource: fwDoc("draft"), next: act(a), world, missing, allow });
for (const [a, { allow }] of ACT) actCase("A1 draft->active, import COMPLETED", a, allow, { [bPath]: batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: OLD }) });
for (const st of ["committing", "partial", "rolled_back"]) actCase("A2 draft->active, import " + st.toUpperCase() + " (must be denied)", "pa", false, { [bPath]: batchDoc(id, { status: st, ...(st === "committing" ? {} : { finishedAt: OLD }) }) });
actCase("A3 draft->active, import completed but batch of ANOTHER organization (denied)", "pa", false, { [bPath]: batchDoc(id, { status: "completed", organizationId: "orgB", chunksDone: 1, finishedAt: OLD }) });
for (const [a, { allow }] of ACT) actCase("A4 draft->active, MANUAL framework (no batch)", a, allow, {}, [bPath]);
// ---------- clone
const cloneNext = (a) => ({ schemaVersion: 1, organizationId: "orgA", scope: "organization", name: "Ban sao", status: "draft", createdAt: T, createdBy: a, updatedAt: T, cloneSource: { frameworkId: "src1", nodeCount: 3 } });
const srcPath = "curriculumFrameworks/src1", srcB = "importBatches/src1";
const cl = (label, a, allow, world, missing) => add(label + " / " + a, a, "create", "curriculumFrameworks/clone1", { next: cloneNext(a), world: { [srcPath]: fwDoc("active"), ...world }, missing, allow });
for (const [a, { allow }] of ACT) cl("K1 clone of a COMPLETED import", a, allow, { [srcB]: batchDoc("src1", { status: "completed", chunksDone: 1, finishedAt: OLD }) });
for (const st of ["committing", "partial", "rolled_back"]) cl("K2 clone of an import in state " + st.toUpperCase() + " (must be denied)", "pa", false, { [srcB]: batchDoc("src1", { status: st, ...(st === "committing" ? {} : { finishedAt: OLD }) }) });
for (const [a, { allow }] of ACT) cl("K3 clone of a MANUAL framework (no batch)", a, allow, {}, [srcB]);
cl("K4 clone of a completed import of ANOTHER organization (denied)", "pa", false, { [srcB]: batchDoc("src1", { status: "completed", organizationId: "orgB", chunksDone: 1, finishedAt: OLD }) });
// ---------- run
(async () => {
  await L.init();
  console.log("candidate SHA-256", L.sha(L.content()), "| cases", cases.length);
  const r = await L.run(cases);
  if (r.status !== 200) { console.log("HTTP", r.status, JSON.stringify(r.body).slice(0, 2000)); process.exit(1); }
  const issues = r.body.issues || [];
  console.log("issues (compile/lint, whole file):", issues.length, issues.map((i) => i.severity + " L" + i.sourcePosition.line + " " + i.description).join(" | "));
  let pass = 0, fail = 0; const rows = [];
  r.body.testResults.forEach((t, i) => {
    const calls = (t.functionCalls || []); const distinct = new Set(calls.map((c) => c.function + " " + c.args.join(","))).size;
    const ok = t.state === "SUCCESS"; ok ? pass++ : fail++;
    rows.push({ i, label: labels[i], expect: cases[i].expectation, state: t.state, distinctCalls: distinct, debug: (t.debugMessages || []).join(" ; ").slice(0, 260) });
  });
  require("fs").writeFileSync("results.json", JSON.stringify({ sha: L.sha(L.content()), issues, rows }, null, 1));
  for (const x of rows) console.log((x.state === "SUCCESS" ? "ok  " : "FAIL") + " " + x.expect.padEnd(5) + " calls=" + String(x.distinctCalls).padStart(2) + " " + x.label + (x.debug ? "   [" + x.debug + "]" : ""));
  console.log("TOTAL", cases.length, "pass", pass, "fail", fail);
})().catch((e) => { console.error("ERR", e.message || e); process.exit(1); });
