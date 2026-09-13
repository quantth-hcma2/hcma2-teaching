// GATE 2B-RT-PREPROD — starts a local Firestore emulator scoped to test/gate2b-rt-preprod (own
// firebase.json/.firebaserc, demo project id, dedicated port 8201) and runs the rollback-compat
// tests against it. Only ever calls `firebase emulators:start`, never `firebase deploy` in any
// form. Each test file dynamically loads whichever Rules content (old-production.rules vs
// candidate.rules) it needs via @firebase/rules-unit-testing's initializeTestEnvironment — the
// static firestore.rules copied here is only a placeholder so the CLI has something to start with.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8201;

function copyPlaceholderRules() {
  const src = path.join(here, "candidate.rules");
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
  copyPlaceholderRules();
  console.log(`[gate2b-rt-preprod] starting Firestore emulator (emulators:start, NOT deploy) in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate2b-rt-preprod] emulator ready, running rollback-compat tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "rollback-compat.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE2B_RT_PREPROD_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate2b-rt-preprod] emulator startup failed:", e.message);
  } finally {
    console.log("[gate2b-rt-preprod] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    await killByCommandLineMatch("demo-hcma2-gate2b-rt-preprod");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
