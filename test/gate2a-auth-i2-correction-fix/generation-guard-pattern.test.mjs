// Gate 2A-AUTH-I2-CORRECTION-FIX — pattern-level proof of the generation-guard fix.
//
// This is deliberately NOT an extraction of index.html's actual closures (they're entangled
// with the DOM/`$()`/Firestore SDK and a much larger enclosing function — pulling them out would
// be a bigger refactor than this narrow fix warrants). Instead, this reimplements the EXACT
// generation-counter pattern used there (verified to match by test/gate2a-auth-i2-correction-
// fix/source-guard.test.mjs's positional checks) against a fully-controllable mock "onSnapshot"
// that can do what a real Firestore emulator won't reliably let us force: deliver a callback
// AFTER its own unsubscribe was already called, simulating the exact race this fix defends
// against regardless of whether that's precisely what triggered the reported production bug.

import test from "node:test";
import assert from "node:assert/strict";

// A minimal, fully-controllable fake — lets a test deliberately fire a listener's callback
// after `unsubscribe()` was called, which a real Firestore SDK is designed specifically NOT to
// allow (making this exact race hard to force reliably against a real backend).
function makeFakeCollection() {
  const listeners = new Map();
  let nextId = 1;
  return {
    onSnapshot(scopeKey, callback) {
      const id = nextId++;
      listeners.set(id, { scopeKey, callback, unsubscribed: false });
      return () => { const l = listeners.get(id); if (l) l.unsubscribed = true; };
    },
    // Test-only: force-deliver a value to a listener EVEN IF it has already been unsubscribed —
    // this is the exact scenario a real SDK's documented unsubscribe guarantee should prevent,
    // and what the generation guard defends against regardless.
    forceDeliver(scopeKey, value) {
      for (const l of listeners.values()) if (l.scopeKey === scopeKey) l.callback(value);
    }
  };
}

// Mirrors index.html's actual pattern 1:1 (see source-guard.test.mjs for the positional proof
// that the real code matches this shape): detach bumps the generation BEFORE unsubscribing;
// attach captures the generation AFTER detaching; both callbacks check the captured generation
// before applying anything.
function makeScopedContentController(fakeCollection) {
  let contentGeneration = 0;
  let unsub = null;
  let renderedValue = null;
  function detach() {
    contentGeneration++;
    if (unsub) { unsub(); unsub = null; }
    renderedValue = null;
  }
  function attach(scopeKey) {
    detach();
    const myGen = contentGeneration;
    unsub = fakeCollection.onSnapshot(scopeKey, (value) => {
      if (myGen !== contentGeneration) return; // the fix: reject anything stale
      renderedValue = value;
    });
  }
  return { attach, get renderedValue() { return renderedValue; } };
}

test("PATTERN: a callback delivered AFTER its listener was superseded by a newer attach() is ignored (the actual fix)", () => {
  const col = makeFakeCollection();
  const ctrl = makeScopedContentController(col);
  ctrl.attach("group-1");
  col.forceDeliver("group-1", "group-1-data");
  assert.equal(ctrl.renderedValue, "group-1-data");

  ctrl.attach("group-2"); // reassignment — old listener superseded, generation bumped
  // Simulate the exact race: the OLD (group-1) listener's callback still fires once more,
  // despite having already been "unsubscribed" by attach()'s internal detach() call.
  col.forceDeliver("group-1", "STALE-group-1-data");
  assert.equal(ctrl.renderedValue, null, "a stale group-1 delivery after reassignment to group-2 must NOT overwrite the cleared state");

  col.forceDeliver("group-2", "group-2-data");
  assert.equal(ctrl.renderedValue, "group-2-data", "a genuine group-2 delivery must still render normally");
});

test("PATTERN: without the generation guard, the same stale delivery WOULD incorrectly overwrite the cleared state (proves the guard is load-bearing, not redundant)", () => {
  // An intentionally unguarded version, to demonstrate the bug this fix closes actually exists
  // in the absence of the guard — not a strawman, the literal pre-fix shape.
  const col = makeFakeCollection();
  let unsub = null, renderedValue = null;
  function detachUnguarded() { if (unsub) { unsub(); unsub = null; } renderedValue = null; }
  function attachUnguarded(scopeKey) {
    detachUnguarded();
    unsub = col.onSnapshot(scopeKey, (value) => { renderedValue = value; }); // no generation check
  }
  attachUnguarded("group-1");
  col.forceDeliver("group-1", "group-1-data");
  attachUnguarded("group-2");
  col.forceDeliver("group-1", "STALE-group-1-data");
  assert.equal(renderedValue, "STALE-group-1-data", "confirms: without the guard, a stale delivery DOES leak through — this is the bug class the fix closes");
});
