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
export const TIMER_AUDIO_ASSETS = Object.freeze({
  countdown: new URL('./assets/audio/countdown-10s.mp3', import.meta.url).href,
  alarm: new URL('./assets/audio/timer-expired-alarm.mp3', import.meta.url).href
});
export function createExpirySound(makeAudio = url => new globalThis.Audio(url)) {
  let enabled = false, disposed = false, generation = 0;
  const media = {}, attempted = new Set();
  function stop(kind) { try { media[kind]?.pause(); } catch {} }
  function halt() { stop('countdown'); stop('alarm'); }
  function play(kind, offset = 0) {
    if (!enabled || disposed) return;
    try {
      const audio = media[kind];
      if (!audio) return;
      audio.currentTime = Math.max(0, offset);
      Promise.resolve(audio.play()).catch(() => {});
    } catch { /* blocked playback or seek cannot interrupt the timer */ }
  }
  return {
    async enable(value) {
      const token = ++generation;
      enabled = false; halt(); attempted.clear();
      if (!value || disposed) return;
      // Unlock both elements in the checkbox's user gesture, silently.
      await Promise.all(Object.entries(TIMER_AUDIO_ASSETS).map(async ([kind, url]) => {
        try {
          const audio = media[kind] ||= makeAudio(url);
          audio.preload = 'auto'; audio.loop = false; audio.muted = true;
          await audio.play();
        } catch {} finally {
          if (token === generation) { stop(kind); if (media[kind]) media[kind].muted = false; }
        }
      }));
      if (token !== generation || disposed) return;
      enabled = true;
    },
    countdown(offset) {
      if (!enabled || disposed) return;
      const audio = media.countdown;
      if (!attempted.has('countdown')) { attempted.add('countdown'); play('countdown', offset); }
      else if (audio && !audio.paused && Math.abs(audio.currentTime - offset) > 0.75) {
        try { audio.currentTime = offset; } catch {}
      }
    },
    pause() { stop('countdown'); attempted.delete('countdown'); },
    alarm() { this.pause(); if (!attempted.has('alarm')) { attempted.add('alarm'); play('alarm'); } },
    reset() { halt(); attempted.clear(); },
    dispose() {
      disposed = true; enabled = false; generation++; halt();
      for (const audio of Object.values(media)) { try { audio.removeAttribute('src'); audio.load(); } catch {} }
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
    if (changed && remaining > 0) { expired = false; sound.reset(); }
    const fresh = previous && now >= previous.now && now - previous.now <= 1500;
    if (!running || !visible || remaining > 10 || remaining <= 0 || expired) sound.pause();
    else {
      // Use the same rounding boundary as the visual clock: 10 appears at 10.5s.
      const exact = (run + activity.durationSec * 1000 - now) / 1000;
      sound.countdown(Math.min(9.999, Math.max(0, 10.5 - exact)));
    }
    if (remaining <= 0) {
      if (!expired && previous?.running && previous.remaining > 0 && running &&
          visible && fresh && !changed) sound.alarm();
      expired = true;
    }
    previous = {run, duration: activity.durationSec, remaining, running, now};
  };
}
