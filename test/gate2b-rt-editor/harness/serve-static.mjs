// GATE 2B-RT-EDITOR — minimal, dependency-free static file server for the LOCAL editor test
// harness only. Serves the repo root read-only (so the harness HTML's relative
// "../../../rich-text-editor.mjs" import resolves, and so rich-text-contract.mjs /
// rich-text-renderer.mjs are reachable too) on 127.0.0.1 only. Never touches Firestore, never
// deploys anything, and is not referenced by index.html or any production path.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const port = Number(process.env.GATE2B_RT_EDITOR_HARNESS_PORT || 8199);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/test/gate2b-rt-editor/harness/index.html";
  const resolved = path.normalize(path.join(repoRoot, urlPath));
  if (!resolved.startsWith(repoRoot)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    res.writeHead(404);
    res.end("not found: " + urlPath);
    return;
  }
  const ext = path.extname(resolved);
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
  createReadStream(resolved).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[gate2b-rt-editor-harness] serving ${repoRoot} at http://127.0.0.1:${port}/`);
});
