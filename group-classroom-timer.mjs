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
    play() {
      if (!enabled || disposed || context?.state !== 'running') return;
      try {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
        oscillator.start(); oscillator.stop(context.currentTime + 0.36);
      } catch { /* unsupported/blocked audio must never break timer */ }
    },
    dispose() { disposed = true; try { context?.close()?.catch?.(() => {}); } catch {} }
  };
}
