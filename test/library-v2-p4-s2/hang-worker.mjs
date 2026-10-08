// Test-only worker that never answers: it receives the file and then spins forever (a pathological parse). The host must terminate it.
import { parentPort } from "node:worker_threads";
parentPort.on("message", () => { for (;;) { /* busy loop */ } });
