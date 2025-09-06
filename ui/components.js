// /ui/components.js
// Reusable DOM builders (cards, rows, pills, goal bars, task/habit/challenge/boss cards)

import { getState } from '../core/store.js';

/* ========== tiny DOM helpers ========== */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function icon(id, cls = 'icon') {
  const svg = el('svg', { class: cls });
  svg.appendChild(el('use', { href: `#i-${id}` }));
  return svg;
}

/* ========== base components ========== */
export function card({ classes = '', children = [] } = {}) {
  return el('div', { class: `card ${classes}`.trim() }, children);
}

export function pill(text, { classes = '' } = {}) {
  return el('span', { class: `pill ${classes}`.trim() }, text);
}

export function btn(kind = 'primary', label = '', opts = {}) {
  const b = el('button', { class: `btn ${kind} ${opts.small ? 'small' : ''}`.trim() }, [
    opts.icon ? icon(opts.icon, 'icon') : null,
    label ? el('span', {}, label) : null
  ]);
  if (opts.onclick) b.addEventListener('click', opts.onclick);
  return b;
}

export function iconbtn(name, { classes = '', onClick } = {}) {
  const b = el('button', { class: `iconbtn ${classes}`.trim() });
  b.appendChild(icon(name));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function section(titleText, rightNode = null) {
  const wrap = el('div', { class: 'section' });
  const h = el('h3', { class: 'section-title' }, titleText);
  const head = el('div', { class: 'row between' }, [h, rightNode]);
  wrap.appendChild(head);
  return { wrap, head, h };
}

export function goalBar(percent, success = false) {
  const bar = el('div', { class: `goalbar ${success ? 'success' : ''}` });
  const fill = el('div', { class: 'fill' });
  bar.appendChild(fill);
  setGoalBar(bar, percent, success);
  return bar;
}
export function setGoalBar(barEl, percent, success = false) {
  const f = barEl.querySelector('.fill');
  if (success) barEl.classList.add('success'); else barEl.classList.remove('success');
  f.style.width = `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
}

/* ========== header (Today) ========== */
export function headerCard({ title = 'Today', bigNumber = '0 pts', percent = 0, goalMet = false, streakText = 'Streak 0', onCoins } = {}) {
  const root = el('div', { class: 'header-card', style: 'margin-top:12px;' });
  root.appendChild(el('div', { class: 'header-title' }, title));
  root.appendChild(el('div', { class: 'header-big' }, bigNumber));
  const bar = goalBar(percent, goalMet);
  root.appendChild(bar);
  const row = el('div', { class: 'row gap', style: 'margin-top:10px;' }, [
    pill('', { classes: '' })
  ]);
  row.innerHTML = ''; // clear then add pills with icons
  const streakPill = el('span', { class: 'pill' }, [
    icon('streak', 'icon'),
    el('span', {}, ` Streak ${streakText.replace(/^Streak\s*/,'')}`)
  ]);
  const coinsBtn = el('button', { class: 'pill', type: 'button' }, [
    icon('coin', 'icon'),
    el('span', {}, ' Coins')
  ]);
  if (onCoins) coinsBtn.addEventListener('click', onCoins);
  row.appendChild(streakPill);
  row.appendChild(coinsBtn);
  root.appendChild(row);
  return { root, bar, setPercent: (p, ok) => setGoalBar(bar, p, ok) };
}

/* ========== specialized cards ========== */

export function taskCard({ title, points, done = false, overdue = false, onComplete, onUndo, onEdit, onDelete }) {
  const c = card({ classes: done ? 'is-done' : '' });
  const left = el('div');
  const t = el('div', { class: 'title' }, title);
  const m = el('div', { class: 'meta' }, `+${points} pts ${overdue ? '· overdue' : ''}`);
  left.appendChild(t); left.appendChild(m);

  const right = el('div', { class: 'row gap' });
  const completeBtn = btn(done ? 'ghost' : 'primary', done ? 'Undo' : 'Complete', { small: true, icon: done ? 'x' : 'check' });
  completeBtn.addEventListener('click', () => {
    if (done) onUndo && onUndo();
    else if (!overdue) onComplete && onComplete();
  });

  const editBtn = iconbtn('edit', { classes: 'ghost', onClick: () => onEdit && onEdit() });
  const delBtn  = iconbtn('trash', { classes: 'ghost', onClick: () => onDelete && onDelete() });

  right.append(completeBtn, editBtn, delBtn);

  if (overdue) c.classList.add('warn');
  if (done) c.classList.add('success');

  const row = el('div', { class: 'row between' }, [left, right]);
  c.appendChild(row);
  return c;
}

export function habitCard({ title, kind, targetPerDay = 1, tally = 0, points, done = false, onPlus, onMinus, onToggleBinary }) {
  const c = card({ classes: done ? 'is-done' : '' });

  const left = el('div');
  const t = el('div', { class: 'title' }, title);
  const subtitle = kind === 'counter'
    ? `${tally}/${targetPerDay} · ${done ? '+'+points+' pts' : `+${points} pts @ ${targetPerDay}`}`
    : `${done ? '+'+points+' pts' : `+${points} pts`}`;
  const m = el('div', { class: 'meta' }, subtitle);
  left.append(t, m);

  const right = el('div', { class: 'row gap' });
  if (kind === 'binary') {
    const btnMain = btn(done ? 'ghost' : 'primary', done ? 'Undo' : 'Complete', { small: true, icon: done ? 'x' : 'check' });
    btnMain.addEventListener('click', () => onToggleBinary && onToggleBinary(!done));
    right.appendChild(btnMain);
  } else {
    const minus = iconbtn('x', { onClick: () => onMinus && onMinus() });
    const counter = pill(`${tally}/${targetPerDay}`, { classes: done ? 'success' : '' });
    const plus = btn('primary', '', { small: true, icon: 'plus', onclick: () => onPlus && onPlus() });
    right.append(minus, counter, plus);
  }

  if (done) c.classList.add('success');
  return c;
}

export function challengeCard({ title, points, done = false, onComplete, onUndo }) {
  const c = card({ classes: done ? 'is-done' : '' });
  const left = el('div', {}, [
    el('div', { class: 'title' }, title),
    el('div', { class: 'meta' }, `+${points} pts`)
  ]);
  const right = el('div');
  const b = btn(done ? 'ghost' : 'primary', done ? 'Undo' : 'Complete', { small: true, icon: done ? 'x' : 'check' });
  b.addEventListener('click', () => done ? (onUndo && onUndo()) : (onComplete && onComplete()));
  right.appendChild(b);

  const row = el('div', { class: 'row between' }, [left, right]);
  if (done) c.classList.add('success');
  c.appendChild(row);
  return c;
}

export function bossGoalCard({ label, tally, target, pointsPerTick, rerolls = 0, onPlus, onMinus }) {
  const c = card({ classes: tally >= target ? 'is-done' : '' });
  const mult = Math.max(0.7, 1 - 0.1 * (rerolls || 0)); // display only

  const left = el('div', {}, [
    el('div', { class: 'title' }, label),
    el('div', { class: 'meta' }, `${tally}/${target} · +${Math.max(1, Math.round(pointsPerTick * mult))} pts/tick (${mult.toFixed(2)}×)`)
  ]);

  const right = el('div', { class: 'row gap' }, [
    iconbtn('x', { onClick: () => onMinus && onMinus() }),
    pill(`${tally}/${target}`, { classes: tally >= target ? 'success' : '' }),
    btn('primary', '', { small: true, icon: 'plus', onclick: () => onPlus && onPlus() })
  ]);

  const row = el('div', { class: 'row between' }, [left, right]);
  if (tally >= target) c.classList.add('success');
  c.appendChild(row);
  return c;
}

/* ========== helpers for lists ========== */
export function clear(elm) { while (elm.firstChild) elm.removeChild(elm.firstChild); }
export function mount(parent, node) { parent.appendChild(node); return node; }

/* ========== formatting ========== */
export function fmtPts(n) { return `${n|0} pts`; }
export function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
