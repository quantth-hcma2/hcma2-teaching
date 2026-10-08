// Test-only worker module (loaded through node-worker-shim.mjs) that throws while handling a message.
globalThis.addEventListener("message", () => { throw new Error("boom"); });
