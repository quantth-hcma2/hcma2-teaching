// GROUP PDF V1 — source guards for the thin index.html integration and the scope lock.
// Pure file reads; no browser, no Firebase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const sha = (f) => createHash("sha256").update(readFileSync(path.join(root, f))).digest("hex").toUpperCase();
const html = read("index.html");

function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `anchors ${start} .. ${end}`);
  return html.slice(a, b);
}
const exportAction = between("async function startGroupPdfExport(group){", "function renderPanels(){");
const fetchHelper = between("async function groupPdfFetchImageBytes(request){", "async function createGroupAssetSubmission(");

test("UI: every group panel header carries one TẢI PDF button, and the existing focus trigger is untouched", () => {
  assert.ok(html.includes('data-group-pdf="${i}"'));
  assert.ok(html.includes("TẢI PDF"));
  assert.ok(html.includes('class="group-panel-focus-trigger" data-group-focus="${i}"'));
  assert.ok(html.includes("data-group-pdf]"), "click binding exists");
  assert.equal((html.match(/startGroupPdfExport\(/g) || []).length, 2, "defined once, called once");
});

test("UI: duplicate clicks are blocked while an export runs and soft-deleted activities cannot export", () => {
  assert.match(exportAction, /if\(pdfBusyGroup!==null\|\|current\.status==="deleted"\) return;/);
  assert.match(exportAction, /finally\{\s*pdfBusyGroup=null;/);
  assert.ok(exportAction.includes("Đang tạo PDF…"));
  assert.ok(html.includes('${pdfBusyGroup!==null?" disabled":""}'), "panels re-rendered by live snapshots keep the buttons disabled");
});

test("lazy loading: only the small runtime module is imported at start; pdfmake and fonts are never referenced by index.html", () => {
  assert.match(html, /^import \{ exportGroupPdf \} from "\.\/group-pdf-runtime\.mjs\?v=[0-9a-z-]+";/m);
  assert.doesNotMatch(html, /<script[^>]+(pdfmake|vendor\/pdf)/i, "no script tag for pdfmake");
  assert.ok(!html.includes("vendor/pdf") && !html.includes("pdfmake"), "index.html never names the library or fonts; the runtime loads them on first export");
  assert.ok(!exportAction.includes("import("), "no dynamic import() in the export action (test/gate4c-e3 pins the dynamic-import count)");
});

test("read-only: the export action performs no Firestore/Storage write and never creates a download URL", () => {
  for (const forbidden of ["setDoc(", "updateDoc(", "addDoc(", "deleteDoc(", "writeBatch(", "runTransaction(", "uploadBytes(", "deleteObject(", "getDownloadURL", "participantId", "storagePath"]) {
    assert.ok(!exportAction.includes(forbidden), `export action must not contain ${forbidden}`);
    assert.ok(!fetchHelper.includes(forbidden), `image helper must not contain ${forbidden}`);
  }
  assert.ok(!html.includes("getDownloadURL"), "the app never creates tokenized Storage URLs");
});

test("images: bytes come through the two existing authenticated readers", () => {
  assert.ok(fetchHelper.includes("richImageUrl(request.path,false,request.context)"));
  assert.ok(fetchHelper.includes("groupSubmissionBlobUrl(request.path,false,MAX_IMAGE_BYTES)"));
  assert.ok(fetchHelper.includes("URL.revokeObjectURL(url)"));
});

test("modules: the builder is DOM/network free; the runtime only fetches vendored assets", () => {
  const code = (file) => read(file).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const builder = code("group-pdf-export.mjs");
  for (const forbidden of ["document.", "window.", "fetch(", "firebase", "getBytes", "localStorage", "XMLHttpRequest"]) assert.ok(!builder.includes(forbidden), `builder must not use ${forbidden}`);
  const runtime = code("group-pdf-runtime.mjs");
  for (const forbidden of ["firebase", "getBytes", "getDownloadURL", "setDoc", "updateDoc", "addDoc"]) assert.ok(!runtime.includes(forbidden), `runtime must not use ${forbidden}`);
  assert.equal(runtime.split("fetch(").length - 1, 1, "exactly one fetch: the vendored font files");
  assert.ok(runtime.includes("fonts/${file}") && runtime.includes("VENDOR_BASE"));
  assert.ok(runtime.includes("setUrlAccessPolicy(() => false)"), "pdfmake is told to fetch no remote resource");
});

test("scope lock: Firestore Rules, indexes and the RichText modules are byte-identical to the production baseline 5c3c5b8", () => {
  assert.equal(sha("firestore.rules"), "A033E20C0D6C7EEB23CC1E76D98E5A4D246BEAD5BECFCC14574C4F98B9FED538");
  assert.equal(sha("firestore.rules.production-candidate"), "218BFF3BDB4D82CA82E2161583E23CCB95589F288F8B8573B5863E65B6C3880F");
  assert.equal(sha("firestore.indexes.json"), "FE4BFDCE6CBA8D9C693126C617AEA592643F74E90AE82AB2B0C45E18DE96A594");
  const rich = {
    "rich-text-contract.mjs": "D306F20778D5F01137EA549DFF4B3B97ED0972D19065F15CB955A74DF3E97C57",
    "rich-text-renderer.mjs": "9CD8DDD64A82074614B81331556D051E70C3D464994EF6DEB310950D3136E985",
    "rich-text-editor.mjs": "5BB755871204E52F0F3BE016F167E7F8F16DDC1F2EDCE98651E07FD646EF0F8D",
    "rich-text-editor-serializer.mjs": "4638EAACF8861D532C7D969EC8C5325B7C540F6BC04C158BD1C8A6B9B5608D0D",
    "group-file-link-safety.mjs": "908D94041817EDADA69018E8E65AEA9144D32EF4129C43633857412EEA89DB3E"
  };
  for (const [file, hash] of Object.entries(rich)) assert.equal(sha(file), hash, file);
});
