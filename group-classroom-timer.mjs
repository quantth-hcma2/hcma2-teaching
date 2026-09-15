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

// Audio is unlocked only by an explicit user gesture. All failures are contained.
export function createExpirySound(makeContext = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio() : null;
}) {
  let context, enabled = false, disposed = false;
  return {
    async enable(value) {
      enabled = value;
      if (!value || disposed) return;
      try { context ||= makeContext(); await context?.resume(); } catch { /* visual timer remains usable */ }
    },
    play(kind = 'bell') {
      if (!enabled || disposed || context?.state !== 'running') return;
      try {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination);
        const duration = kind === 'beep' ? 0.12 : 1.4;
        oscillator.frequency.value = kind === 'beep' ? 880 : 660;
        oscillator.type = kind === 'beep' ? 'sine' : 'triangle';
        gain.gain.setValueAtTime(0.12, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
        oscillator.start(); oscillator.stop(context.currentTime + duration + 0.01);
      } catch { /* unsupported/blocked audio must never break timer */ }
    },
    dispose() { disposed = true; try { context?.close()?.catch?.(() => {}); } catch {} }
  };
}

// One observer belongs to the classroom controller, never to individual clocks.
// Observe only the current threshold: missed seconds are never queued or replayed.
export function createTimerAudioObserver(sound) {
  let previous, lowest = Infinity, bell = false;
  return (activity, remaining, now, visible = true) => {
    const running = !!activity.startedAt;
    const run = activity.startedAt?.toMillis ? activity.startedAt.toMillis()
      : running ? new Date(activity.startedAt).getTime() : null;
    const changed = previous && (run !== previous.run || activity.durationSec !== previous.duration);
    // A positive timer following expiry/reset is a new sequence. Pause/resume
    // and +/- adjustments during an active sequence retain consumed thresholds.
    if (previous && previous.remaining <= 0 && remaining > 0 && changed) { lowest = Infinity; bell = false; }
    const fresh = previous && now >= previous.now && now - previous.now <= 1500;
    const descending = previous && remaining < previous.remaining;
    if (running && visible && fresh && !changed && previous.running && descending) {
      if (remaining > 0 && remaining <= 10 && remaining < lowest) {
        lowest = remaining; sound.play('beep');
      } else if (remaining === 0 && !bell) { bell = true; sound.play('bell'); }
    }
    // Consume skipped/hidden thresholds as well, preventing replay after adjustments.
    if (running && remaining > 0 && remaining <= 10) lowest = Math.min(lowest, remaining);
    if (remaining === 0) bell = true;
    previous = { run, duration: activity.durationSec, remaining, running, now };
  };
}
