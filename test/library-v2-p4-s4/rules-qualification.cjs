// P4-S4 RULES DESIGN GATE - Google Rules evaluator (firebaserules projects.test: evaluates in memory, creates NO ruleset and NO release, touches no data; every request / resource / get() / exists()
// answer is a synthetic mock) qualification of the IMPLEMENTED import freeze: the repository Rules candidate (firestore.rules.production-candidate, with the freeze) versus the deployed ruleset text (the same file with the five freeze edits reversed).
//   1. security matrix: 5 touched rules x 5 import states x 4 principals must ALLOW/DENY exactly as designed
//   2. expression HEADROOM of the five touched rules: how many extra minimal predicates (importIntIn(1,0,5)) still evaluate, baseline (production) versus amended, for the worst-case principal
//   3. the untouched rules (importBatches update: the thin-headroom rule) are re-measured to show the amendment did not change them
// Run: node test/library-v2-p4-s4/rules-qualification.cjs   (needs `firebase login`; writes rules-qualification.json next to this file)
const path = require("path"), fs = require("fs"), { pathToFileURL } = require("url");
const GV = path.join(__dirname, "..", "library-v2-p4-s1", "google-validation");
const L = require(path.join(GV, "lib.cjs")), W = require(path.join(GV, "world.cjs"));
const { T, OLD, FINAL, batchDoc, fwDoc, nodeDoc, tc } = W;
const id = "imp1", fwPath = "curriculumFrameworks/" + id, nodeId = "a".repeat(32), nodePath = fwPath + "/nodes/" + nodeId, bPath = "importBatches/" + id;
const STATES = {
  none: { missing: [bPath] },
  importing: { world: { [bPath]: batchDoc(id, { chunksDone: 0, chunksTotal: 2 }) } },
  sealed: { world: { [bPath]: batchDoc(id, { chunksDone: 2, chunksTotal: 2 }) } },
  partial: { world: { [bPath]: batchDoc(id, { status: "partial", finishedAt: OLD, resultCode: "ABANDONED" }) } },
  completed: { world: { [bPath]: batchDoc(id, { status: "completed", finishedAt: OLD, chunksDone: 1 }) } }
};
const EXPECT = {   // [rule][state] -> allowed for authorized writers (design matrix)
  nodeCreateHex: { none: 1, importing: 1, sealed: 0, partial: 0, completed: 1 },
  nodeCreateAuto: { none: 1, importing: 0, sealed: 0, partial: 0, completed: 1 },
  nodeUpdate: { none: 1, importing: 0, sealed: 0, partial: 0, completed: 1 },
  nodeDelete: { none: 1, importing: 0, sealed: 0, partial: 1, completed: 1 },
  fwUpdate: { none: 1, importing: 0, sealed: 0, partial: 0, completed: 1 },
  fwDelete: { none: 1, importing: 0, sealed: 0, partial: 1, completed: 1 }
};
const ACTORS = { pa: true, oaA: true, capA: true, mA: false };
const world = (state) => ({ [fwPath]: fwDoc("draft"), [nodePath]: nodeDoc(), ...(STATES[state].world || {}) });
const autoId = "AutoId0123456789abcde", autoPath = fwPath + "/nodes/" + autoId;
function caseFor(rule, state, actor) {
  const allowed = ACTORS[actor] && !!EXPECT[rule][state];
  const base = { world: world(state), missing: STATES[state].missing, allow: allowed };
  const name = rule + "/" + state + "/" + actor;
  switch (rule) {
    case "nodeCreateHex": return tc(name, actor, "create", nodePath, { ...base, missing: [...(base.missing || []), nodePath], next: nodeDoc({ createdAt: T, updatedAt: T, status: "active" }) });
    case "nodeCreateAuto": return tc(name, actor, "create", autoPath, { ...base, missing: [...(base.missing || []), autoPath], next: nodeDoc({ createdAt: T, updatedAt: T, status: "active" }) });
    case "nodeUpdate": return tc(name, actor, "update", nodePath, { ...base, resource: nodeDoc(), next: nodeDoc({ name: "Mon doi ten", updatedAt: T }) });
    case "nodeDelete": return tc(name, actor, "delete", nodePath, { ...base, resource: nodeDoc() });
    case "fwUpdate": return tc(name, actor, "update", fwPath, { ...base, resource: fwDoc("draft"), next: fwDoc("draft", { name: "Khung doi ten", updatedAt: T }) });
    case "fwDelete": return tc(name, actor, "delete", fwPath, { ...base, resource: fwDoc("draft") });
  }
}
// where to inject n minimal predicates for the headroom measurement (the chain start of each touched rule), identical text in baseline and amended
const INJECT = {
  nodeCreateHex: ["nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(request.resource.data.organizationId)"],
  nodeUpdate: ["nodeParent().status in ['draft', 'active'] &&\n          mayWriteCurriculum(resource.data.organizationId)"],
  nodeDelete: ["allow delete: if mayWriteCurriculum(resource.data.organizationId) &&\n          (!exists(fwPath(fwId)) ||"],
  fwUpdate: ["allow update: if fwShapeOk(request.resource.data) &&\n        fwImmutableOk(resource.data, request.resource.data) &&"],
  fwDelete: ["allow delete: if resource.data.status == 'draft' &&\n        !('activatedAt' in resource.data) &&"]
};
const pad = (n) => Array(n).fill("importIntIn(1, 0, 5) &&").join(" ");
function withPredicates(src, rule, n) {
  if (n === 0) return src;
  const [anchor] = INJECT[rule];
  if (src.split(anchor).length !== 2) throw new Error("inject anchor must occur once: " + rule);
  const head = anchor.startsWith("allow ") ? anchor.replace(/^(allow \w+: if )/, (m) => m + pad(n) + " ") : pad(n) + " " + anchor;
  return src.replace(anchor, () => head);
}
(async () => {
  await L.init();
  const amended = L.content();                                              // the implemented candidate
  const { deployedRules } = await import(pathToFileURL(path.join(__dirname, "import-freeze-rules.mjs")).href);
  const baseline = deployedRules(amended);                                  // the deployed ruleset text (0b6910c3)
  if (L.sha(amended) !== "F6B9DE012C7F7D3D0FCE6EFC19D760B3B2E0BCA9C9979811786EDE93C9B17D4A" || L.sha(baseline) !== "7F7C790E403762800DC27879FF851CB875064D8A02076B2A4F7F3C7163510485") throw new Error("unexpected Rules SHA-256");
  const out = { baselineSha256: L.sha(baseline), amendedSha256: L.sha(amended), matrix: {}, headroom: {} };
  // 1. security matrix on the amended source
  const rules = Object.keys(EXPECT), states = Object.keys(STATES), actors = Object.keys(ACTORS);
  let pass = 0, fail = 0; const failures = [];
  for (const rule of rules) for (const state of states) {
    const cases = actors.map((a) => caseFor(rule, state, a));
    const r = await L.run(cases, amended);
    if (r.status !== 200) { failures.push({ rule, state, http: r.status, body: JSON.stringify(r.body).slice(0, 300) }); fail += cases.length; continue; }
    r.body.testResults.forEach((t, i) => { if (t.state === "SUCCESS") pass++; else { fail++; failures.push({ case: rule + "/" + state + "/" + actors[i], state: t.state, msg: (t.debugMessages || []).join(";").slice(0, 200) }); } });
  }
  out.matrix = { total: pass + fail, pass, fail, failures };
  console.log("SECURITY MATRIX on the amended source (Google evaluator): total " + (pass + fail) + " pass " + pass + " fail " + fail);
  for (const f of failures) console.log("  FAIL", JSON.stringify(f));
  // 1b. the same matrix on the PRODUCTION source must show the gap (control): committing/partial states allow the node/framework mutations
  const control = {};
  for (const rule of ["nodeUpdate", "nodeDelete", "fwUpdate", "fwDelete", "nodeCreateAuto"]) {
    const cases = ["importing", "sealed", "partial"].map((s) => { const c = caseFor(rule, s, "capA"); c.expectation = "ALLOW"; return c; });
    const r = await L.run(cases, baseline);
    control[rule] = r.status === 200 ? r.body.testResults.map((t) => t.state) : "HTTP " + r.status;
  }
  out.productionControl = control; console.log("CONTROL (production source, capA, importing/sealed/partial expected ALLOW = the gap):", JSON.stringify(control));
  // 2. headroom (worst-case principal capA; the most expensive ALLOW path of each rule): exact maximum by binary search (0..64 extra minimal predicates)
  const worst = { nodeCreateHex: "importing", nodeUpdate: "completed", nodeDelete: "completed", fwUpdate: "completed", fwDelete: "completed" };
  async function maxPassing(makeCase, source, inject) {
    const passes = async (n) => { const r = await L.run([makeCase()], inject(source, n)); return r.status === 200 && r.body.testResults[0].state === "SUCCESS"; };
    if (!(await passes(0))) return -1;
    let lo = 0, hi = 65;                                        // invariant: lo passes, hi fails (65 = beyond the range)
    if (await passes(64)) return 64;
    hi = 64;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await passes(mid)) lo = mid; else hi = mid; }
    return lo;
  }
  for (const rule of Object.keys(worst)) {
    out.headroom[rule] = {};
    for (const [label, source] of [["production", baseline], ["amended", amended]]) {
      const state = label === "production" ? "none" : worst[rule];                   // production has no batch notion: its worst path is the plain one
      const make = () => { const c = caseFor(rule, state, "capA"); c.expectation = "ALLOW"; return c; };
      out.headroom[rule][label] = await maxPassing(make, source, (src, n) => withPredicates(src, rule, n));
    }
    console.log("HEADROOM (extra minimal predicates still evaluating) " + rule.padEnd(14), JSON.stringify(out.headroom[rule]));
  }
  // 3. the thin-headroom rule (importBatches update, capability holder, completed) is NOT touched by the amendment: same measurement on both sources
  {
    const marker = "allow update: if batchShapeOk(request.resource.data) &&";
    const nodeFinal = fwPath + "/nodes/" + FINAL;
    const make = () => tc("c", "capA", "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: T, updatedAt: T }), world: { [fwPath]: fwDoc("draft"), [nodeFinal]: nodeDoc() }, allow: true });
    out.headroom.importBatchesUpdateCompleted = {};
    for (const [label, source] of [["production", baseline], ["amended", amended]]) {
      out.headroom.importBatchesUpdateCompleted[label] = await maxPassing(make, source, (src, n) => { if (n === 0) return src; if (src.split(marker).length !== 2) throw new Error("batch marker"); return src.replace(marker, () => marker + " " + pad(n)); });
    }
    console.log("HEADROOM importBatches update (completed, capA) - UNCHANGED thin rule:", JSON.stringify(out.headroom.importBatchesUpdateCompleted));
  }
  fs.writeFileSync(path.join(__dirname, "rules-qualification.json"), JSON.stringify(out, null, 2));
  console.log("written rules-qualification.json");
  if (fail > 0) process.exit(2);
})().catch((e) => { console.error("ERR", e && e.message || e); process.exit(1); });
