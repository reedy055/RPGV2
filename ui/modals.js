// /ui/modals.js
// Global UI helpers: sheets/drawers, confirm dialog, toasts.

const backdrop = document.getElementById('backdrop');
const confirmModal = document.getElementById('confirm-modal');
const toasts = document.getElementById('toasts');

export function openSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  backdrop.hidden = false;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
}

export function closeSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => { el.hidden = true; maybeHideBackdrop(); }, 220);
}

function maybeHideBackdrop() {
  const anyOpen = [...document.querySelectorAll('.sheet')].some(s => !s.hidden && s.classList.contains('open'));
  if (!anyOpen) backdrop.hidden = true;
}

backdrop?.addEventListener('click', () => {
  const openSheets = [...document.querySelectorAll('.sheet.open')];
  if (openSheets.length) closeSheet(openSheets[openSheets.length - 1].id);
});

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

export function confirmDialog({ title = 'Confirm', message = 'Are you sure?' } = {}) {
  return new Promise(resolve => {
    const t = document.getElementById('confirm-title');
    const m = document.getElementById('confirm-message');
    t.textContent = title;
    m.textContent = message;
    confirmModal.returnValue = 'cancel';
    confirmModal.showModal();
    const onClose = () => {
      confirmModal.removeEventListener('close', onClose);
      resolve(confirmModal.returnValue === 'ok');
    };
    confirmModal.addEventListener('close', onClose);
  });
}
