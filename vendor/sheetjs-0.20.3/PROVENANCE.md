# SheetJS CE 0.20.3 - vendored reader artifact (P4-S2)

Purpose: the XLSX **reader** of the curriculum Import Center (P4). Loaded ONLY by `import-xlsx-worker.mjs` (a dedicated module Web Worker). It is a SEPARATE file from the
V1 roster-export library `vendor/xlsx.full.min.js` (SheetJS CE **0.18.5**, unchanged and still used only to WRITE the group roster). There is no CDN at runtime.

| Item | Value |
|---|---|
| Library / version | SheetJS Community Edition `xlsx` **0.20.3** (the `version` constant inside `xlsx.mjs` reads `0.20.3`) |
| Official distribution | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (SheetJS' own CDN; the npm registry copy of `xlsx` is frozen at 0.18.5 and has no 0.20.3 - checked 2026-10-08) |
| Retrieved | 2026-10-08, HTTP 200, 2,409,319 bytes, ETag `a696f7017234bbe1d44b328d99a22ee2`; downloaded twice, byte-identical |
| Package SHA-256 | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` (`xlsx-0.20.3.tgz`) |
| Vendored file 1 | `vendor/sheetjs-0.20.3/xlsx.mjs` - the package's unminified ES module build, 1,008,308 bytes, SHA-256 `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |
| Vendored file 2 | `vendor/sheetjs-0.20.3/LICENSE` - Apache License 2.0, 11,355 bytes, SHA-256 `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` (byte-identical to the existing `vendor/XLSX-LICENSE.txt`) |
| License | Apache-2.0 (package.json `license`, LICENSE file) |
| Dependencies | none: `xlsx.mjs` contains no `import` statement; its only `require` is inside a type-annotation comment. No `npm install`, no install script and no other file of the package was executed or vendored (extracted into an isolated scratch directory, files inspected, two copied) |
| Why this build | unminified and reviewable; ES module, so it runs in a module Worker without a bundler; `read` is the only entry point P4 uses |
| Security status | CVE-2023-30533 (prototype pollution when reading crafted files) fixed in 0.19.3; CVE-2024-22363 (ReDoS) fixed in 0.20.2; 0.20.3 contains both fixes. The package is no longer maintained upstream - future vulnerabilities are contained by the container gate (`import-xlsx-container.mjs`), the Worker, the hard timeout and the resource limits, not assumed absent |
| Static facts checked in the source | no `eval`, no `new Function`, no `fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts`; `document` is referenced only by its file-download writer, which P4 never calls |
| Runtime reference | exactly one: `import * as XLSX from "./vendor/sheetjs-0.20.3/xlsx.mjs"` in `import-xlsx-worker.mjs` (tests pin the hashes above) |

Update procedure: any change of this artifact is a new vendoring decision (new directory, new hashes, re-run `test/library-v2-p4-s2/reader-qualification.test.mjs`).
