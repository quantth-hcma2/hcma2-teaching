// Test shim: gives a worker_threads worker the Web Worker global API (addEventListener/postMessage) and then loads the REAL worker module unchanged.
import { parentPort, workerData } from "node:worker_threads";
globalThis.addEventListener = (type, handler) => { if (type === "message") parentPort.on("message", (data) => handler({ data })); };
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
await import(workerData.entry);
