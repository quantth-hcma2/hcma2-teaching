// Starts a local Firestore emulator scoped to test/gate2a-auth-i3-ui-fix (own firebase.json/
// .firebaserc, demo project id, dedicated port 8195 — distinct from every prior gate's port),
// runs the Gate 2A-AUTH-I3-UI-FIX delete-members tests against it, then shuts down ONLY the exact
// emulator process(es) it started. Only ever calls `firebase emulators:start`, never
// `firebase deploy` in any form. Rules are unchanged by this gate — this copies the exact same
// candidate content prior gates verified, purely so BUG B's deletion behavior can be proven
// against real Firestore Rules rather than assumed.
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8195;

function copyCandidateRules() {
  const src = path.join(here, "..", "..", "firestore.rules.production-candidate");
  const dest = path.join(here, "firestore.rules");
  const content = readFileSync(src);
  writeFileSync(dest, content);
  const hash = createHash("sha256").update(content).digest("hex");
  console.log(`[gate2a-auth-i3-ui-fix] copied firestore.rules.production-candidate -> test/gate2a-auth-i3-ui-fix/firestore.rules (sha256 ${hash})`);
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
  console.log(`[gate2a-auth-i3-ui-fix] starting Firestore emulator (emulators:start, NOT deploy) in ${here} on port ${port}...`);
  const emulator = spawn("firebase", ["emulators:start", "--only", "firestore"], {
    cwd: here,
    shell: true,
    stdio: "inherit"
  });

  let exitCode = 1;
  try {
    await waitForPort("127.0.0.1", port, 60000);
    console.log("[gate2a-auth-i3-ui-fix] emulator ready, running delete-members tests...");
    exitCode = await new Promise((resolve) => {
      const t = spawn(process.execPath, ["--test", path.join(here, "delete-members.test.mjs")], {
        stdio: "inherit",
        env: { ...process.env, GATE2A_AUTH_I3_UI_FIX_EMULATOR_PORT: String(port) }
      });
      t.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (e) {
    console.error("[gate2a-auth-i3-ui-fix] emulator startup failed:", e.message);
  } finally {
    console.log("[gate2a-auth-i3-ui-fix] shutting down emulator (targeted kill only)...");
    try { emulator.kill(); } catch { /* ignore */ }
    await killByCommandLineMatch("demo-hcma2-gate2a-auth-i3-ui-fix");
    await killByCommandLineMatch(here.replace(/\\/g, "\\\\"));
  }
  process.exit(exitCode);
}

main();
