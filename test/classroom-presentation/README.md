# Classroom Presentation V1 local tests

Never run these fixtures against production. They use `demo-classroom-presentation` and loopback only. The browser harness imports no Firebase SDK and executes the actual `groupLive` function extracted from `index.html` with local host/Firestore substitutes. Requests outside loopback are blocked by the browser runner.

Install the repository test dependencies, then start the Firestore emulator on `127.0.0.1:8298` using a `demo-*` project. Run:

```text
node --test test/classroom-presentation/timer.test.mjs test/classroom-presentation/boundaries.test.mjs test/classroom-presentation/rules.test.mjs test/classroom-presentation/audio-countdown.test.mjs
```

`CLASSROOM_EMULATOR_PORT` overrides the default 8298 loopback port. Rules tests load the current `firestore.rules.production-candidate` directly. The boundary tests compare with production base `63c32f4c0c918ef7ecead9588afaea2de8c72ce1`, which must exist in Git history.

For browser tests, make Playwright available or set `PLAYWRIGHT_PACKAGE` to its `index.mjs` path. An installed Microsoft Edge is used in headless mode:

```text
node test/classroom-presentation/browser-tests.mjs
```

Optionally set `CLASSROOM_TEST_OUTPUT` to a local output folder for screenshots and JSON results. The runner starts/stops its own loopback static server.

## Timer semantics

- Start and Reset use the minutes input (positive, rounded to seconds, at most 1440 minutes). Reset is paused.
- Pause stores remaining seconds. Resume begins a fresh interval of that length using a server timestamp; it does not falsify/backdate the start timestamp.
- +/-1 adjusts the current remaining duration, keeping running or paused state. Subtract clamps at zero; add clamps at 86400 seconds.
- `durationSec` is the current interval length. The minutes input is a local editing choice, retained while this view is open; reopening initializes it from persisted duration. It is not a new persisted default-duration field.
- Shared activity snapshots synchronize running/pause state and the displayed countdown. The existing client-clock assumptions remain; no writes occur on ticks/expiry.

## Audio semantics — ONE combined asset (`assets/audio/timer-expiry-combined.mp3`)

This supersedes the earlier two-asset (`countdown-10s.mp3` + `timer-expired-alarm.mp3`) design. There is now exactly one `<audio>` element per view, playing a single MP3 that already contains both the countdown ticking and the alarm as its own tail.

- Audio defaults off; enabling requests browser audio access via a silent, muted unlock inside the checkbox's own user gesture.
- At the moment remaining time first enters the final 10 seconds (while running, visible, and not already latched-expired this cycle), the combined asset plays **exactly once**, seeked to the position corresponding to how far into the 10-second window the timer already is — a renderer that only starts observing late (e.g. a freshly opened popup) seeks in rather than replaying from the start.
- **Nothing stops, pauses, resets, rewinds, or replaces the asset when remaining reaches 00:00.** The controller never reacts to `remaining <= 0` at all (other than latching an internal "this cycle already crossed zero" flag used only to block a stale/rolled-back clock from re-entering the window). The same play continues on its own into the alarm tail already baked into the file, and the `HTMLAudioElement` reaching its natural `ended` state is never observed or acted on by this module — the media owns its own completion, and no MP3 duration is ever hard-coded into the timer logic.
- Paused, hidden, and stale (>1.5s observation gap — carried over from the prior model, still enforced during the pre-10s/countdown phase only) states are silent **before** the threshold; once the single play has started, only an explicit Pause (the timer leaving the running state) stops it.
- A genuinely new cycle (reset, restart, or any change to the timer's start timestamp or duration — including ±1 minute) stops and rewinds the asset and re-arms it for a fresh single play, with no replay storm from the many ticks in between.
- Multiple display clocks (the always-visible float plus the expand-to-fullscreen popup) share one observer and one media element — no duplicate playback.
- Opening an already-expired view, or opening one while audio is off and only turning it on afterwards, is silent — the trigger to play requires having observed `remaining > 0` inside the window at least once this cycle, which a late/expired-only observation can never satisfy.
- Browser/audio failures (autoplay rejection, blocked `play()`, a seek that throws) do not affect the timer.
- Activated contract sessions remain unsupported by `groupLive` and cannot change duration through the new Rules branch.

Existing regression coverage and long-content tests must also pass before a release.

Audio hotfix tests: `node --test test/classroom-presentation/audio-countdown.test.mjs`. Browser coverage uses a controlled clock installed before importing production modules.
