// GATE 2A-AUTH-I3-UI-FIX-RUNTIME — generates the runtime-test copy of the candidate frontend.
// Rather than hand-maintaining a copy of index.html (which could silently drift from the real,
// committed candidate), this script takes the ACTUAL current index.html and the ACTUAL current
// .mjs modules it imports, byte-for-byte, and applies exactly three documented, asserted string
// substitutions — nothing else — so the runtime harness always tests the real candidate logic,
// never a stale or hand-edited copy. If the real index.html changes in a way that makes any of
// these substitutions no longer match, this script fails loudly instead of silently testing the
// wrong thing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");
const publicDir = path.join(here, "public");
mkdirSync(publicDir, { recursive: true });

const MODULES = [
  "session-reader.mjs", "session-view.mjs", "contract-editor.mjs", "contract-runtime.mjs",
  "contract-activation.mjs", "contract-writer.mjs", "group-file-link-safety.mjs", "group-membership.mjs"
];

function replaceOnce(source, oldStr, newStr, label) {
  const idx = source.indexOf(oldStr);
  if (idx === -1) throw new Error(`prepare-fixture: expected substring not found (${label}) — real index.html has changed in a way this generator no longer understands. Update prepare-fixture.mjs, do not hand-edit the generated file.`);
  if (source.indexOf(oldStr, idx + 1) !== -1) throw new Error(`prepare-fixture: substring for ${label} is not unique — refusing to guess which occurrence to replace.`);
  return source.slice(0, idx) + newStr + source.slice(idx + oldStr.length);
}

let html = readFileSync(path.join(repoRoot, "index.html"), "utf8").replace(/\r\n/g, "\n");

html = replaceOnce(html,
  '  browserLocalPersistence\n} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";',
  '  browserLocalPersistence, connectAuthEmulator\n} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";',
  "auth import: add connectAuthEmulator"
);
html = replaceOnce(html,
  '  getCountFromServer, collectionGroup, runTransaction\n} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";',
  '  getCountFromServer, collectionGroup, runTransaction, connectFirestoreEmulator\n} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";',
  "firestore import: add connectFirestoreEmulator"
);
html = replaceOnce(html,
  '  projectId: "bo-phieu-hcma2",',
  '  projectId: "demo-hcma2-gate2a-auth-i3-ui-fix-runtime",',
  "firebaseConfig.projectId override"
);
html = replaceOnce(html,
  'const auth = getAuth(fbApp);\nconst db = getFirestore(fbApp);\nconst storage = getStorage(fbApp);',
  'const auth = getAuth(fbApp);\nconst db = getFirestore(fbApp);\nconst storage = getStorage(fbApp);\nconnectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });\nconnectFirestoreEmulator(db, "127.0.0.1", 8196);',
  "main app: connect emulators"
);
html = replaceOnce(html,
  'const publicAuth = getAuth(publicApp);\nconst publicDb = getFirestore(publicApp);\nconst publicStorage = getStorage(publicApp);\nsetPersistence(publicAuth, browserLocalPersistence).catch(()=>{});',
  'const publicAuth = getAuth(publicApp);\nconst publicDb = getFirestore(publicApp);\nconst publicStorage = getStorage(publicApp);\nconnectAuthEmulator(publicAuth, "http://127.0.0.1:9199", { disableWarnings: true });\nconnectFirestoreEmulator(publicDb, "127.0.0.1", 8196);\nsetPersistence(publicAuth, browserLocalPersistence).catch(()=>{});',
  "public app: connect emulators"
);

writeFileSync(path.join(publicDir, "index.html"), html);
for (const m of MODULES) {
  writeFileSync(path.join(publicDir, m), readFileSync(path.join(repoRoot, m)));
}
console.log(`[gate2a-auth-i3-ui-fix-runtime] generated public/index.html + ${MODULES.length} modules from the current candidate.`);
