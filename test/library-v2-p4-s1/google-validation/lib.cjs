// Google firebaserules projects.test harness (VALIDATION ONLY: the :test endpoint evaluates, it never creates a ruleset/release). Synthetic data only.
const FT = process.env.FIREBASE_TOOLS_LIB || (process.env.APPDATA + "/npm/node_modules/firebase-tools/lib").split("\\").join("/");
const crypto = require("crypto"), fs = require("fs");
const RULES = require("path").join(__dirname, "..", "..", "..", "firestore.rules.production-candidate");   // the candidate in this repository
const project = "bo-phieu-hcma2";
let client;
async function init() {
  const { requireAuth } = require(FT + "/requireAuth.js");
  await requireAuth({ project, nonInteractive: true });
  const { Client } = require(FT + "/apiv2");
  const { rulesOrigin } = require(FT + "/api");
  client = new Client({ urlPrefix: rulesOrigin(), apiVersion: "v1" });
}
const content = () => fs.readFileSync(RULES, "utf8");
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex").toUpperCase();
async function run(testCases, src) {
  const text = src ?? content();
  const res = await client.post("/projects/" + project + ":test", { source: { files: [{ name: "firestore.rules", content: text }] }, testSuite: { testCases } }, { skipLog: { body: true }, resolveOnHTTPError: true });
  return res;
}
module.exports = { init, run, content, sha, RULES, project };
