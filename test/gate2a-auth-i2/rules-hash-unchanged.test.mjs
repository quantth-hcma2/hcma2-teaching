// Gate 2A-AUTH-I2 — Task M source guard. This gate is frontend-only: firestore.rules.production-
// candidate must remain byte-identical to the AUTH-I1 candidate that is already live in
// production. No git dependency at runtime — hashes the file directly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(here, "..", "..", "firestore.rules.production-candidate");
const AUTH_I1_PRODUCTION_HASH = "0ea69c7666df709ea8c8fdc25134810fbcd5ddadb4b84050513ac14d6c450837";

test("RULES FROZEN: firestore.rules.production-candidate is byte-identical (LF-normalized) to the hash already deployed to production in Gate 2A-AUTH-I1-PROD", () => {
  const content = readFileSync(rulesPath, "utf8").replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(content).digest("hex");
  assert.equal(hash, AUTH_I1_PRODUCTION_HASH, "this gate must not modify Rules at all — if this fails, Rules changed and Stage 3 was started prematurely");
});
