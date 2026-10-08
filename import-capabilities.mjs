// Library V2 P4-S2 - browser CAPABILITY detection for the secure XLSX reader (pure; the scope is injectable, nothing is created or loaded).
// The reader FAILS CLOSED: without these capabilities a file is never parsed (no "lite" or main-thread fallback). The machine-readable result is the
// diagnostic BROWSER_UNSUPPORTED with data.missing = [capability ids]; the UI (P4-S3) maps the code/ids to its own Vietnamese text.
//   worker               the Worker constructor exists (page side)
//   module-worker        the browser honours { type: "module" } (detected when the real Worker is created, see import-xlsx-reader.mjs)
//   decompression-stream DecompressionStream for the bounded inflation gate (Worker side)
//   readable-stream      ReadableStream / TransformStream used by that gate (Worker side)
//   text-decoder         TextDecoder (Worker side)
import { diag } from "./import-diagnostics.mjs";

export const CAPABILITY_IDS = Object.freeze(["worker", "module-worker", "decompression-stream", "readable-stream", "text-decoder"]);
// Minimum browser versions known to provide them (informational, for the UI text): Chrome/Edge 80+, Firefox 114+, Safari 16.4+.
export const MINIMUM_BROWSERS = Object.freeze({ chrome: 80, edge: 80, firefox: 114, safari: "16.4" });

// Capabilities the parsing Worker itself needs (they are checked INSIDE the Worker scope).
export function detectWorkerSideCapabilities(scope = globalThis) {
  const missing = [];
  if (typeof scope.DecompressionStream !== "function") missing.push("decompression-stream");
  if (typeof scope.ReadableStream !== "function") missing.push("readable-stream");
  if (typeof scope.TextDecoder !== "function") missing.push("text-decoder");
  return Object.freeze({ supported: missing.length === 0, missing: Object.freeze(missing) });
}
// Synchronous page-side pre-check for the UI: everything that can be known without creating a Worker. `module-worker` can only be confirmed when the
// Worker is created; the reader still reports it as BROWSER_UNSUPPORTED at that point.
export function detectReaderCapabilities(scope = globalThis) {
  const missing = [];
  if (typeof scope.Worker !== "function") missing.push("worker");
  missing.push(...detectWorkerSideCapabilities(scope).missing);
  return Object.freeze({ supported: missing.length === 0, missing: Object.freeze(missing) });
}
export const unsupportedBrowserDiagnostic = (missing) => diag("BROWSER_UNSUPPORTED", { data: { missing: [...missing], minimum: { ...MINIMUM_BROWSERS } } });
