// Compiles the baseline (deployed) and the candidate Rules in the Firestore emulator and reports compiler issues (errors/warnings).
// Run inside `firebase emulators:exec` (port 8451). Fails on any ERROR; prints a diff of the WARNING multiset (baseline vs candidate).
import assert from "node:assert/strict";
import { baselineRules, candidateRules, HOST, PORT } from "./helpers.mjs";
async function compile(label, content) {
  const r = await fetch("http://" + HOST + ":" + PORT + "/emulator/v1/projects/demo-compile:securityRules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }) });
  const body = JSON.parse(await r.text());
  return { label, status: r.status, issues: body.issues || [] };
}
const tally = (issues) => { const m = new Map(); for (const i of issues) { const k = i.severity + " | " + i.description; m.set(k, (m.get(k) || 0) + 1); } return m; };
const base = await compile("deployed-baseline", baselineRules());
const cand = await compile("p3s1-candidate", candidateRules());
for (const c of [base, cand]) {
  const errors = c.issues.filter((i) => i.severity === "ERROR").length, warnings = c.issues.filter((i) => i.severity === "WARNING").length;
  console.log("COMPILE " + c.label + " " + JSON.stringify({ status: c.status, errors, warnings }));
  assert.equal(c.status, 200); assert.equal(errors, 0);
}
const a = tally(base.issues), b = tally(cand.issues);
const keys = new Set([...a.keys(), ...b.keys()]);
const diffs = [];
for (const k of keys) if ((a.get(k) || 0) !== (b.get(k) || 0)) diffs.push({ issue: k, baseline: a.get(k) || 0, candidate: b.get(k) || 0 });
console.log("COMPILE-DIFF " + JSON.stringify(diffs));
console.log("COMPILE-NEW-IN-P3-REGION " + JSON.stringify(cand.issues.filter((i) => i.sourcePosition.line >= candidateRules().split("\n").findIndex((l) => l.includes("P3-S1 (CURRICULUM) - BEGIN")) + 1 && i.sourcePosition.line <= candidateRules().split("\n").findIndex((l) => l.includes("P3-S1 (CURRICULUM) - END")) + 1).map((i) => i.severity + " L" + i.sourcePosition.line + " " + i.description)));
