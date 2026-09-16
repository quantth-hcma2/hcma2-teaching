// Legacy Group Discussion timer. No lifecycle, membership or content writes.
export const MAX_TIMER_SECONDS = 86400;
export function timerSeconds(a, now = Date.now()) {
  if (!a.startedAt) return Math.max(0, a.pausedRemainingSec ?? a.durationSec ?? 0);
  const start = a.startedAt.toMillis ? a.startedAt.toMillis() : new Date(a.startedAt).getTime();
  return Math.max(0, Math.round((start + (a.durationSec || 0) * 1000 - now) / 1000));
}
export function minutesToSeconds(value) {
  const minutes = Number(value);
  if (!String(value).trim() || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440)
    throw new Error('Nhập số phút lớn hơn 0 và không quá 1.440.');
  const seconds = Math.round(minutes * 60);
  if (seconds < 1) throw new Error('Thời gian tối thiểu là 1 giây.');
  return seconds;
}
export function timerPatch(a, action, seconds, now, stamp) {
  if ('configRevision' in a) throw new Error('Phiên này chưa hỗ trợ điều chỉnh đồng hồ.');
  const remain = timerSeconds(a, now);
  let duration = a.durationSec || 0, startedAt = a.startedAt || null;
  let paused = a.pausedRemainingSec ?? null;
  if (action === 'start' || action === 'reset') {
    duration = seconds; startedAt = action === 'start' ? stamp : null;
    paused = action === 'reset' ? duration : null;
  } else if (action === 'pause') {
    if (!a.startedAt) return null;
    startedAt = null; paused = remain;
  } else if (action === 'resume') {
    if (a.startedAt || remain <= 0) return null;
    duration = remain; startedAt = stamp; paused = null;
  } else if (action === 'add' || action === 'subtract') {
    duration = Math.min(MAX_TIMER_SECONDS, Math.max(0, remain + (action === 'add' ? 60 : -60)));
    startedAt = a.startedAt ? stamp : null;
    paused = startedAt ? null : duration;
  } else throw new Error('Lệnh đồng hồ không hợp lệ.');
  if (!Number.isInteger(duration) || duration < 0 || duration > MAX_TIMER_SECONDS)
    throw new Error('Thời gian phải trong khoảng 0–1.440 phút.');
  return { durationSec: duration, startedAt, pausedRemainingSec: paused, updatedAt: stamp };
}
export async function writeTimer({ db, ref, runTransaction, serverTimestamp }, action, seconds) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Hoạt động không còn tồn tại.');
    const patch = timerPatch(snap.data(), action, seconds, Date.now(), serverTimestamp());
    if (patch) tx.update(ref, patch);
  });
}

// Exact user assets; this controller is owned by the classroom, never a clock.
// One combined asset carries both the countdown and the alarm as a single continuous
// clip; the alarm is the tail already baked into the file, never a second playback.
export const TIMER_AUDIO_ASSET_URL = new URL('./assets/audio/timer-expiry-combined.mp3', import.meta.url).href;
export function createExpirySound(makeAudio = url => new globalThis.Audio(url)) {
  let enabled = false, disposed = false, generation = 0, media = null, started = false;
  function stop() { try { media?.pause(); } catch {} }
  function play(offset = 0) {
    if (!enabled || disposed || !media) return;
    try {
      media.currentTime = Math.max(0, offset);
      Promise.resolve(media.play()).catch(() => {});
    } catch { /* blocked playback or seek cannot interrupt the timer */ }
  }
  return {
    async enable(value) {
      const token = ++generation;
      enabled = false; stop(); started = false;
      if (!value || disposed) return;
      // Unlock the element in the checkbox's user gesture, silently.
      try {
        media ||= makeAudio(TIMER_AUDIO_ASSET_URL);
        media.preload = 'auto'; media.loop = false; media.muted = true;
        await media.play();
      } catch {} finally {
        if (token === generation) { stop(); if (media) media.muted = false; }
      }
      if (token !== generation || disposed) return;
      enabled = true;
    },
    start(offset) {
      if (!enabled || disposed) return;
      if (!started) { started = true; play(offset); }
      else if (media && !media.paused && Math.abs(media.currentTime - offset) > 0.75) {
        try { media.currentTime = offset; } catch {}
      }
    },
    pause() { stop(); started = false; },
    reset() {
      stop(); started = false;
      try { if (media) media.currentTime = 0; } catch {}
    },
    dispose() {
      disposed = true; enabled = false; generation++; stop();
      try { media?.removeAttribute('src'); media?.load(); } catch {}
    }
  };
}

export function createTimerAudioObserver(sound) {
  let previous, expired = false;
  return (activity, remaining, now, visible = true) => {
    const running = !!activity.startedAt;
    const run = activity.startedAt?.toMillis ? activity.startedAt.toMillis()
      : running ? new Date(activity.startedAt).getTime() : null;
    const changed = previous && (run !== previous.run || activity.durationSec !== previous.duration);
    if (changed) { expired = false; sound.reset(); }
    // Once the timer reaches zero the media element owns its own completion: only an
    // explicit Pause (running -> false) or a genuinely new cycle (changed) may touch it
    // again — never the remaining-seconds value crossing zero. `expired` only guards
    // against a stale/rolled-back clock re-entering the window within the same cycle.
    if (!running) sound.pause();
    else if (remaining > 0 && (!visible || remaining > 10 || expired)) sound.pause();
    else if (remaining > 0 && remaining <= 10 && !expired) {
      // Use the same rounding boundary as the visual clock: 10 appears at 10.5s.
      const exact = (run + activity.durationSec * 1000 - now) / 1000;
      sound.start(Math.min(9.999, Math.max(0, 10.5 - exact)));
    }
    if (remaining <= 0) expired = true;
    previous = {run, duration: activity.durationSec, remaining, running, now};
  };
}
