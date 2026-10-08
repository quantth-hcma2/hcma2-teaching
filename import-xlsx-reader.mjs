// Library V2 P4-S2 - page-side XLSX reader HOST: runs the parse in a dedicated Web Worker with a hard timeout and always terminates the Worker.
// Pure of the DOM except through the injected factory: `createWorker()` returns a Worker-like object { postMessage, terminate, addEventListener,
// removeEventListener } (the browser default is `new Worker(new URL("./import-xlsx-worker.mjs", import.meta.url), { type: "module" })`; the tests inject a
// worker_threads adapter, which runs the SAME worker module). Nothing here is wired into index.html (P4-S3 will consume it).
//
// readXlsx(input, { fileName }) -> { ok, diagnostics, raw, file: { name, size, sha256 }, timedOut }
//   input: File | Blob | ArrayBuffer | Uint8Array. Cheap checks (extension, size, magic number) happen BEFORE the Worker is created; a file above 5 MiB is
//   rejected from its declared size without being read. The Worker is terminated on success, failure and timeout; at most one parse runs per call.
import { IMPORT_LIMITS } from "./import-template.mjs";
import { diag } from "./import-diagnostics.mjs";
import { checkFileEnvelope } from "./import-xlsx-container.mjs";
import { sha256Hex } from "./import-sha256.mjs";

const LIM = IMPORT_LIMITS;

async function bytesOf(input) {
  if (input instanceof Uint8Array) return input.slice();                       // a private copy: the buffer is transferred to the Worker
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (input && typeof input.arrayBuffer === "function") return new Uint8Array(await input.arrayBuffer());
  throw new TypeError("readXlsx expects a File, Blob, ArrayBuffer or Uint8Array");
}
async function digest(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) { try { return Array.from(new Uint8Array(await subtle.digest("SHA-256", bytes)), (b) => (b < 16 ? "0" : "") + b.toString(16)).join(""); } catch (error) { /* fall through to the pure implementation */ } }
  return sha256Hex(bytes);
}
export function browserWorkerFactory() {
  if (typeof Worker === "undefined") throw new Error("Web Worker is not available in this environment");
  return new Worker(new URL("./import-xlsx-worker.mjs", import.meta.url), { type: "module" });
}

export function createXlsxReader({ createWorker = browserWorkerFactory, timeoutMs = LIM.parseTimeoutMs, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  let counter = 0;
  async function readXlsx(input, { fileName } = {}) {
    const name = typeof fileName === "string" ? fileName : (input && typeof input.name === "string" ? input.name : "");
    const declared = input && typeof input.size === "number" ? input.size : (input && typeof input.byteLength === "number" ? input.byteLength : undefined);
    const file = { name, size: declared ?? 0, sha256: null };
    if (declared !== undefined && declared > LIM.maxFileBytes) return { ok: false, diagnostics: [...checkFileEnvelope(new Uint8Array(1), { fileName: name }), diag("FILE_TOO_LARGE", { size: declared, max: LIM.maxFileBytes })], raw: null, file, timedOut: false };
    const bytes = await bytesOf(input);
    file.size = bytes.length;
    const early = checkFileEnvelope(bytes, { fileName: name, size: bytes.length });
    if (early.length) return { ok: false, diagnostics: early, raw: null, file, timedOut: false };
    file.sha256 = await digest(bytes);
    const id = ++counter;
    let worker;
    try { worker = createWorker(); } catch (error) { return { ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null, file, timedOut: false }; }
    return await new Promise((resolve) => {
      let finished = false, timer = null;
      const finish = (body) => {
        if (finished) return;
        finished = true;
        if (timer !== null) clearTimer(timer);
        try { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); worker.removeEventListener("messageerror", onError); } catch (error) { /* ignore */ }
        try { worker.terminate(); } catch (error) { /* ignore */ }
        resolve({ file, timedOut: false, ...body });
      };
      const onMessage = (event) => {
        const message = event && event.data;
        if (!message || message.type !== "result" || message.id !== id) return;
        if (message.ok && message.raw && typeof message.raw === "object") finish({ ok: true, diagnostics: Array.isArray(message.diagnostics) ? message.diagnostics : [], raw: message.raw });
        else finish({ ok: false, diagnostics: Array.isArray(message.diagnostics) && message.diagnostics.length ? message.diagnostics : [diag("PARSE_EXCEPTION")], raw: null });
      };
      const onError = () => finish({ ok: false, diagnostics: [diag("PARSE_EXCEPTION")], raw: null });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
      timer = setTimer(() => finish({ ok: false, diagnostics: [diag("PARSE_TIMEOUT", { seconds: Math.round(timeoutMs / 1000) })], raw: null, timedOut: true }), timeoutMs);
      try { worker.postMessage({ type: "parse", id, buffer: bytes.buffer, fileName: name, size: bytes.length }, [bytes.buffer]); } catch (error) { onError(); }
    });
  }
  return { readXlsx };
}
