# Gate 2A-AUTH-I3-UI-FIX-RUNTIME harness

Manual/interactive runtime verification for the Bug A reopen-lifecycle fix
(index.html's activity-status listener), driven against a real browser and
real local Firebase emulators — not source-guard assertions, not
`@firebase/rules-unit-testing` alone. Not part of `npm test`; there is no
automated `node --test` entry for this directory because it requires actual
browser rendering/DOM interaction, which the rest of this repo's test suites
intentionally avoid adding a browser-automation dependency for.

## Usage

1. `node prepare-fixture.mjs` — regenerates `public/index.html` and its
   `.mjs` modules from the CURRENT candidate `index.html`/modules, applying
   only the documented emulator-connection substitutions (see the script's
   own header comment). Always run this before testing so you're never
   testing a stale copy.
2. `cp ../../firestore.rules.production-candidate firestore.rules` — same
   copy-for-emulator pattern as every other gate's `run-emulator-tests.mjs`.
3. `firebase emulators:start --only firestore,auth,hosting` from this
   directory (ports: Firestore 8196, Auth 9199, Hosting 5010 — see
   `firebase.json`).
4. Use `node driver.mjs <command> [args]` to act as "the legitimate
   lecturer/emulator path" — seed fixtures, flip activity status open/closed,
   reassign or remove membership, add notes — all as a real authenticated
   teacher context against the real candidate Rules. See the command list at
   the bottom of `driver.mjs`.
5. Open `http://127.0.0.1:5010/?group=<joinCode>` in a real browser (or the
   Claude Code Browser pane) to drive the actual student page and observe its
   real `onSnapshot` lifecycle live, without reloading, as the driver mutates
   Firestore in step 4.

`public/` is generated (gitignored) — never hand-edit it; re-run
`prepare-fixture.mjs` instead.
