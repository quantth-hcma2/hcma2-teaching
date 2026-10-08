// Expression headroom measured on GOOGLE's evaluator (projects.test) with test-only in-memory source variants (never deployed, never stored).
const L = require("./lib.cjs"), W = require("./world.cjs");
const { T, OLD, FINAL, batchDoc, fwDoc, nodeDoc, tc } = W;
const id = "imp1", fwPath = "curriculumFrameworks/" + id, nodePath = fwPath + "/nodes/" + FINAL, bPath = "importBatches/" + id;
const marker = "allow update: if batchShapeOk(request.resource.data) &&";
const cases = (a) => ({
  progress: tc("p", a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { chunksDone: 1, updatedAt: T }), allow: true }),
  completed: tc("c", a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "completed", chunksDone: 1, finishedAt: T, updatedAt: T }), world: { [fwPath]: fwDoc("draft"), [nodePath]: nodeDoc() }, allow: true }),
  partial: tc("x", a, "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: T, updatedAt: T }), allow: true }),
  rolled_back: tc("r", a, "update", bPath, { resource: batchDoc(id, { status: "partial", finishedAt: OLD }), next: batchDoc(id, { status: "rolled_back", finishedAt: T, updatedAt: T }), missing: [fwPath, nodePath], allow: true })
});
(async () => {
  await L.init();
  const base = L.content();
  if (base.split(marker).length - 1 !== 1) throw new Error("marker");
  const ns = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
  const summary = {}, firstFail = {};
  // timestamp-typing control on the unmodified candidate
  {
    const good = tc("g", "capA", "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: T, updatedAt: T }), allow: true });
    const bad = tc("b", "capA", "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: "not-a-timestamp", updatedAt: T }), allow: false });
    const num = tc("n", "capA", "update", bPath, { resource: batchDoc(id), next: batchDoc(id, { status: "partial", finishedAt: 12345, updatedAt: T }), allow: false });
    const r = await L.run([good, bad, num]);
    r.body.testResults.forEach((t, i) => {
      const v = (t.visitedExpressions || []).filter((e) => e.sourcePosition.line === 2248).map((e) => e.value);
      console.log("TIMESTAMP-TYPING CONTROL", ["good ISO string", "garbage string", "number"][i], "state=" + t.state, "line2248 values=" + JSON.stringify(v));
    });
  }
  for (const n of ns) {
    const src = n === 0 ? base : base.replace(marker, () => marker + " " + Array(n).fill("importIntIn(1, 0, 5) &&").join(" "));
    for (const a of ["pa", "oaA", "capA"]) {
      const cs = cases(a), names = Object.keys(cs);
      const r = await L.run(names.map((k) => cs[k]), src);
      names.forEach((k, i) => {
        const key = k + "/" + a;
        let pass = false, note = "";
        if (r.status === 200) { const t = r.body.testResults[i]; pass = t.state === "SUCCESS"; note = (t.debugMessages || []).join(";").slice(0, 160); }
        else note = "HTTP " + r.status + " " + JSON.stringify(r.body).slice(0, 160);
        if (pass) summary[key] = Math.max(summary[key] ?? -1, n);
        else if (firstFail[key] === undefined) firstFail[key] = { n, note };
      });
    }
  }
  console.log("GOOGLE EVALUATOR HEADROOM (largest N of the minimal predicate that still passes; ns tried up to 48)");
  console.log(JSON.stringify(summary));
  console.log("first failing N and message:", JSON.stringify(firstFail));
  require("fs").writeFileSync("headroom.json", JSON.stringify({ summary, firstFail }, null, 1));
})().catch((e) => { console.error("ERR", e.message || e); process.exit(1); });
