// Starts a local Firestore emulator scoped to test/gate1b2c (own firebase.json/.firebaserc,
// demo project id, dedicated port 8180 — distinct from gate1b1's 8177, gate1b2a's 8178, and
// gate1b2b's 8179), runs the Gate 1B.2C lifecycle-bridge tests against it, then shuts down ONLY
// the exact emulator process(es) it started — never a broad process kill. Only ever calls
// `firebase emulators:start`, never `firebase deploy` in any form.
//
// Gate 1B.2C does not change firestore.rules.production-candidate at all — this harness still
// loads the same (unmodified) candidate content, to prove the UI-bridge write shapes stay
// inside Rules that were already deployed and reviewed in Gate 1B.2B.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8180;

function copyCandidateRules() {
  const src = path.join(here, "..", "..", "firestore.rules.production-candidate");
  const dest = path.join(here, "firestore.rules");
  const content = readFileSync(src);
  writeFileSync(dest, content);
  const hash = createHash("sha256").update(content).digest("hex");
  console.log(`[gate1b2c] copied firestore.rules.production-candidate (UNCHANGED by 1B.2C) -> test/gate1b2c/firestore.rules (sha256 ${hash})`);
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      fetch(`http://${host}:${port}/`).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Emulator did not become ready on port ${port} within ${timeoutMs}ms`));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

async function killByCommandLineMatch(needle) {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  } catch { /* best-effort cleanup */ }
}

async function main() {
  copyCandidateRules();
  console.log(`[gate1b2c] starting Firestore emulator (emulators:start, NOT deploy) in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate1b2c] emulator ready, running lifecycle-bridge tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "lifecycle-bridge.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE1B2C_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate1b2c] emulator startup failed:", e.message);
  } finally {
    console.log("[gate1b2c] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    await killByCommandLineMatch("demo-hcma2-gate1b2c");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
