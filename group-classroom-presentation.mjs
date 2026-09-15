import { renderRichText } from './rich-text-renderer.mjs';
import { timerSeconds, minutesToSeconds, createExpirySound } from './group-classroom-timer.mjs';

export function mountClassroomPresentation({ root, initial, write, onError, now = Date.now, sound = createExpirySound() }) {
  const doc = root.ownerDocument;
  let current = initial, busy = false, disposed = false, previousRun, previousRemaining;
  const host = doc.createElement('section');
  host.className = 'classroom-tools card mt-14';
  host.innerHTML = `<label>Thời gian (phút) <input data-minutes type="number" min="0.02" max="1440" step="any" aria-label="Thời gian (phút)"></label>
    <div class="classroom-actions"><button class="btn btn-ok" data-action="start">Bắt đầu</button><button class="btn btn-outline" data-action="pause">Tạm dừng</button><button class="btn btn-outline" data-action="resume">Tiếp tục</button><button class="btn btn-outline" data-action="reset">Đặt lại</button><button class="btn btn-outline" data-action="add">+1 phút</button><button class="btn btn-outline" data-action="subtract">−1 phút</button></div>
    <label><input data-sound type="checkbox"> Âm báo hết giờ</label><span data-status role="status"></span>
    <p class="small mut">Bắt đầu / Đặt lại dùng số phút đang nhập. Tiếp tục dùng thời gian còn lại. Hết giờ vẫn có thể gửi bài.</p>`;
  root.querySelector('#gInstructionsCard').after(host);
  const input = host.querySelector('[data-minutes]');
  input.value = String(Math.max(1, initial.durationSec || 0) / 60);
  const open = doc.createElement('button');
  open.className = 'btn btn-sm btn-outline'; open.textContent = 'Phóng to'; open.type = 'button';
  open.id = 'gCommonExpand';
  root.querySelector('#gInstructionsCard').prepend(open);
  const dialog = doc.createElement('dialog');
  dialog.className = 'classroom-presentation';
  dialog.setAttribute('aria-labelledby', 'classroom-title');
  dialog.innerHTML = `<header><h2 id="classroom-title">Nhiệm vụ chung</h2><button class="btn btn-outline" data-close autofocus>Đóng ✕</button></header><div data-clock class="classroom-clock" role="timer" aria-label="Thời gian còn lại"></div><div data-expiry role="status"></div><div data-content class="classroom-content"></div>`;
  root.append(dialog);
  const content = dialog.querySelector('[data-content]');
  function renderContent() { renderRichText(content, current.instructionsRich, current.instructions || ''); }
  open.onclick = () => { renderContent(); tick(); dialog.showModal(); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => open.focus());
  host.querySelector('[data-sound]').onchange = e => { void sound.enable(e.target.checked); };
  for (const button of host.querySelectorAll('[data-action]')) button.onclick = async () => {
    if (busy || disposed) return;
    try {
      const action = button.dataset.action;
      const seconds = ['start', 'reset'].includes(action) ? minutesToSeconds(input.value) : undefined;
      busy = true; tick();
      await write(action, seconds);
    } catch (error) { if (!disposed) onError(error); }
    finally { busy = false; if (!disposed) tick(); }
  };
  function tick() {
    const remaining = timerSeconds(current, now());
    const done = remaining <= 0;
    const text = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    dialog.querySelector('[data-clock]').textContent = text;
    dialog.classList.toggle('expired', done);
    dialog.querySelector('[data-expiry]').textContent = done ? 'HẾT GIỜ' : current.startedAt ? 'Đang chạy' : 'Sẵn sàng / Tạm dừng';
    host.querySelector('[data-status]').textContent = busy ? 'Đang lưu…' : done ? 'HẾT GIỜ — có thể đặt thời gian mới' : current.startedAt ? 'Đang chạy' : 'Sẵn sàng / Tạm dừng';
    const run = current.startedAt?.toMillis ? current.startedAt.toMillis() : current.startedAt ? new Date(current.startedAt).getTime() : null;
    if (run != null && run === previousRun && previousRemaining > 0 && done) sound.play();
    previousRun = run; previousRemaining = remaining;
    for (const button of host.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.disabled = busy || (action === 'pause' && (!current.startedAt || done)) || (action === 'resume' && (!!current.startedAt || done));
    }
  }
  const interval = setInterval(tick, 250); tick(); renderContent();
  return {
    update(activity) { current = activity; renderContent(); tick(); },
    dispose() { disposed = true; clearInterval(interval); sound.dispose(); dialog.remove(); host.remove(); open.remove(); }
  };
}
