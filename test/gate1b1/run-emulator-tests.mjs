// Starts a local Firestore emulator scoped to test/gate1b1 (its own firebase.json/.firebaserc,
// demo project id, dedicated port), runs emulator-regression.test.mjs against it, then shuts
// down ONLY the exact emulator process(es) it started — never a broad process kill. This
// mirrors the process-management convention established earlier in this project's history.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8177;

function copyVerifiedRules() {
  // firebase emulators:start refuses a rules path outside its own project directory, so we
  // copy the real, committed, already-deployed-and-hash-verified rules file in here byte for
  // byte and print the hash so it's plain in the log that this is not a hand-edited copy.
  const src = path.join(here, "..", "..", "firestore.rules.production-candidate");
  const dest = path.join(here, "firestore.rules");
  const content = readFileSync(src);
  writeFileSync(dest, content);
  const hash = createHash("sha256").update(content).digest("hex");
  console.log(`[gate1b1] copied firestore.rules.production-candidate -> test/gate1b1/firestore.rules (sha256 ${hash})`);
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = fetch(`http://${host}:${port}/`).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Emulator did not become ready on port ${port} within ${timeoutMs}ms`));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

async function killByCommandLineMatch(needle) {
  // Windows-safe targeted kill: only processes whose command line mentions this exact
  // scratch/test path are terminated. Never a broad taskkill.
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  } catch { /* best-effort cleanup */ }
}

async function main() {
  copyVerifiedRules();
  console.log(`[gate1b1] starting Firestore emulator in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate1b1] emulator ready, running regression tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "emulator-regression.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE1B1_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate1b1] emulator startup failed:", e.message);
  } finally {
    console.log("[gate1b1] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    // The firebase CLI on Windows spawns a separate java.exe for the Firestore emulator that
    // does not reliably die with its parent; find and stop only that one, matched by this
    // exact test directory appearing in its command line (java is invoked with the emulator
    // jar path plus --project=demo-hcma2-gate1b1, both of which are unique to this run).
    await killByCommandLineMatch("demo-hcma2-gate1b1");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
