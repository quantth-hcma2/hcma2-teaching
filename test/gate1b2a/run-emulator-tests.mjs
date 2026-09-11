// Starts a local Firestore emulator scoped to test/gate1b2a (its own firebase.json/.firebaserc,
// demo project id, dedicated port 8178 — distinct from gate1b1's 8177), runs
// rules-hardening.test.mjs against it, then shuts down ONLY the exact emulator process(es) it
// started — never a broad process kill.
//
// GATE 1B.2A SAFETY NOTE: this script only ever calls `firebase emulators:start`, which starts
// a local, non-networked emulator process. It NEVER calls `firebase deploy` in any form —
// per the explicit instruction after the earlier near-miss, `firebase deploy` (including any
// --dry-run guess) is not used anywhere in this gate for validation.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8178;

function copyCandidateRules() {
  // firebase emulators:start refuses a rules path outside its own project directory, so we
  // copy the actual candidate file being reviewed in this gate byte for byte and print its
  // hash so it's plain in the log which exact content was loaded.
  const src = path.join(here, "..", "..", "firestore.rules.production-candidate");
  const dest = path.join(here, "firestore.rules");
  const content = readFileSync(src);
  writeFileSync(dest, content);
  const hash = createHash("sha256").update(content).digest("hex");
  console.log(`[gate1b2a] copied firestore.rules.production-candidate (CANDIDATE, with 1B.2A hardening) -> test/gate1b2a/firestore.rules (sha256 ${hash})`);
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
  console.log(`[gate1b2a] starting Firestore emulator (emulators:start, NOT deploy) in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate1b2a] emulator ready, running Rules hardening tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "rules-hardening.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE1B2A_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate1b2a] emulator startup failed:", e.message);
  } finally {
    console.log("[gate1b2a] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    await killByCommandLineMatch("demo-hcma2-gate1b2a");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
