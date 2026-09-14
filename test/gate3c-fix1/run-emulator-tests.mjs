// GATE 3C-FIX-CANDIDATE — starts a local Firestore emulator scoped to test/gate3c-fix1 (own
// firebase.json/.firebaserc, demo project id, dedicated port 8211) and runs the Knowledge
// legacy-shape regression suite against it. Only ever calls `firebase emulators:start`, never
// `firebase deploy` in any form. The rules used are the CANDIDATE file (with the GATE 3C fix
// applied) copied verbatim.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const port = 8211;

function copyCandidateRules() {
  const src = path.join(repoRoot, "firestore.rules.production-candidate");
  const dest = path.join(here, "firestore.rules");
  writeFileSync(dest, readFileSync(src));
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
  console.log(`[gate3c-fix1] starting Firestore emulator (emulators:start, NOT deploy) in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate3c-fix1] emulator ready, running Knowledge legacy-shape tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "knowledge-legacy-shape.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE3C_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate3c-fix1] emulator startup failed:", e.message);
  } finally {
    console.log("[gate3c-fix1] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    await killByCommandLineMatch("demo-hcma2-gate3c");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
