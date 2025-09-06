// /ui/calendar.js
// Calendar view: Month/Week toggle, heatmap, day drawer with breakdown & CRUD, long-press quick add.

import { getState, subscribe, dispatch } from '../core/store.js';
import { todayKey, addDays, weekdayIndex, weekStartOf } from '../core/time.js';
import { ensureTodayGenerated, ensureWeekBoss } from '../engines/engine-day.js';
import { awardTask, awardHabit, awardChallenge, awardBossTick, undoLastFor } from '../engines/engine-coins.js';
import { rebuildFromLedger } from '../core/ledger.js';

import {
  el, clear, mount,
  section, taskCard, habitCard, challengeCard, bossGoalCard
} from './components.js';
import { openSheet, closeSheet, toast, confirmDialog } from './modals.js';

// Mount point
const root = document.getElementById('tab-calendar');

// Drawer refs (from index.html)
const drawer = document.getElementById('drawer-day');
const dayTitle = document.getElementById('drawer-day-title');
const daySummary = document.getElementById('day-summary');
const dayTasks = document.getElementById('day-tasks');
const dayHabits = document.getElementById('day-habits');
const dayQuests = document.getElementById('day-quests');
const dayBoss = document.getElementById('day-boss');
const dayAddTaskBtn = document.getElementById('day-add-task');

// Local view state
let viewDate = new Date(); // focused date (month shows this month; week shows week of this)
let weekMode = (localStorage.getItem('calWeekMode') === '1') || false;

// Render boot + subscribe
render();
subscribe((s, action) => {
  if (!root.classList.contains('is-active') && action?.type !== 'SET_STATE') return;
  render();
});

// Public-ish helpers (for tests/debug)
window.Calendar = {
  next: () => changeMonth(1),
  prev: () => changeMonth(-1),
  toggleView: () => setWeekMode(!weekMode)
};

/* ================= Render ================= */

function render() {
  const s = getState();
  if (!s) return;
  clear(root);

  // Header controls
  const head = el('div', { class: 'section' });
  const bar = el('div', { class: 'calendar-head' });
  const title = el('h3', { class: 'section-title', style: 'margin:0' }, formatMonthTitle(viewDate));
  const left = el('button', { class: 'iconbtn' }, ''); left.appendChild(icon('chev-left'));
  const right = el('button', { class: 'iconbtn' }, ''); right.appendChild(icon('chev-right'));
  left.addEventListener('click', () => weekMode ? changeWeek(-1) : changeMonth(-1));
  right.addEventListener('click', () => weekMode ? changeWeek(1) : changeMonth(1));

  const seg = el('div', { class: 'segment' }, [
    segBtn('Month', !weekMode, () => setWeekMode(false)),
    segBtn('Week', weekMode, () => setWeekMode(true))
  ]);

  bar.appendChild(left); bar.appendChild(title); bar.appendChild(right);
  head.appendChild(bar);
  head.appendChild(seg);
  mount(root, head);

  // Grid
  const wrap = el('div', { class: 'calendar-wrap' });
  const grid = el('div', { class: 'calendar-grid' });
  wrap.appendChild(grid);
  mount(root, wrap);

  const days = weekMode ? getWeekDays(viewDate) : getMonthDays(viewDate);
  const heats = heatmapLevels(days, s);
  const today = todayKey();

  for (let i = 0; i < days.length; i++) {
    const dkey = days[i];
    const dt = parseKey(dkey);
    const cell = el('div', { class: 'daycell', 'data-day': dkey });
    const level = heats.get(dkey) || 0;
    if (level > 0) cell.setAttribute('data-heat', String(level));

    // date number (dim if not in current month)
    const dnum = el('div', { class: 'dnum' }, String(dt.getDate()));
    if (!weekMode && dt.getMonth() !== viewDate.getMonth()) {
      dnum.style.opacity = '0.45';
    }
    cell.appendChild(dnum);

    // streak ring
    const ring = el('div', { class: 'ring' });
    if (isHabitDayComplete(s, dkey)) ring.classList.add('done');
    cell.appendChild(ring);

    // mini points
    const pts = (s.progress?.[dkey]?.points) | 0;
    if (pts > 0) cell.appendChild(el('div', { class: 'mini-points' }, String(pts)));

    // task dots (up to 4)
    const dotsWrap = el('div', { class: 'dots' });
    const inst = s.taskInstances.filter(t => t.day === dkey);
    for (let j = 0; j < Math.min(4, inst.length); j++) {
      const dot = el('div', { class: 'dot' });
      if (inst[j].done) dot.classList.add('done');
      dotsWrap.appendChild(dot);
    }
    cell.appendChild(dotsWrap);

    // today highlight
    if (dkey === today) cell.classList.add('today');

    // Interaction: tap opens drawer, long-press opens FAB new task
    attachDayInteractions(cell, dkey);

    grid.appendChild(cell);
  }

  // Ensure engines have done their jobs
  ensureTodayGenerated(getState());
  ensureWeekBoss(getState());
}

/* ================= Interactions ================= */

function attachDayInteractions(cell, dkey) {
  // Tap
  cell.addEventListener('click', () => openDayDrawer(dkey));

  // Long-press (450ms)
  let pressTimer = null;
  const start = () => {
    pressTimer = setTimeout(() => {
      // Open FAB to New Task tab with date prefilled
      openFabForDate(dkey);
    }, 450);
  };
  const cancel = () => pressTimer && clearTimeout(pressTimer);

  cell.addEventListener('touchstart', start, { passive: true });
  cell.addEventListener('mousedown', start);
  cell.addEventListener('touchend', cancel);
  cell.addEventListener('touchmove', cancel);
  cell.addEventListener('mouseleave', cancel);
  cell.addEventListener('mouseup', cancel);
}

function openDayDrawer(dayKey) {
  const s = getState();
  const dt = parseKey(dayKey);
  dayTitle.textContent = `${dt.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' })}`;
  drawer.dataset.day = dayKey;

  renderDayDrawer(dayKey, s);
  openSheet('drawer-day');
}

dayAddTaskBtn?.addEventListener('click', () => {
  const dayKey = drawer.dataset.day || todayKey();
  openFabForDate(dayKey);
});

/* ================= Drawer rendering ================= */

function renderDayDrawer(dayKey, state) {
  clear(daySummary);
  clear(dayTasks);
  clear(dayHabits);
  clear(dayQuests);
  clear(dayBoss);

  const isToday = dayKey === state.today.day;
  const isFuture = dayKey > state.today.day;
  const isPast = dayKey < state.today.day;

  // Summary
  const prog = state.progress?.[dayKey] || { points: 0, coinsEarned: 0, tasksDone:0, habitsDone:0, challengesDone:0, bossTicks:0, missedTodos:0 };
  const sumCards = [
    statCard('Points', `${prog.points|0}`),
    statCard('Coins', `${prog.coinsEarned|0}`),
    statCard('Done', `${(prog.tasksDone|0)+(prog.habitsDone|0)+(prog.challengesDone|0)+(prog.bossTicks|0)}`)
  ];
  sumCards.forEach(c => daySummary.appendChild(c));

  // Tasks
  const tasks = state.taskInstances.filter(t => t.day === dayKey);
  if (tasks.length === 0) {
    dayTasks.appendChild(el('div', { class: 'card graytint' }, 'No tasks.'));
  } else {
    for (const t of tasks) {
      const overdue = isPast && !t.done;
      const card = taskCard({
        title: t.title,
        points: t.points || 0,
        done: !!t.done,
        overdue,
        onComplete: (isPast ? null : async () => {
          await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { done: true } });
          await awardTask(t);
          toast(`Completed — +${t.points} pts`, 'success');
          renderDayDrawer(dayKey, getState());
        }),
        onUndo: (isPast ? null : async () => {
          const res = await undoLastFor('task', t.id);
          if (!res.ok) { toast(res.reason, 'warn'); return; }
          await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { done: false } });
          renderDayDrawer(dayKey, getState());
        }),
        onEdit: (isPast ? null : async () => {
          const title = prompt('Edit title', t.title);
          if (title == null) return;
          const pts = Number(prompt('Edit points', String(t.points || 0)));
          if (!pts || isNaN(pts) || pts < 1) return toast('Points must be ≥1', 'warn');
          await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { title: title.trim(), points: Math.round(pts) } });
          renderDayDrawer(dayKey, getState());
        }),
        onDelete: (isPast ? null : async () => {
          const ok = await confirmDialog({ title: 'Delete task?', message: `Delete “${t.title}” for this day?` });
          if (!ok) return;
          await dispatch({ type: 'TASK_INSTANCE_DELETE', id: t.id });
          renderDayDrawer(dayKey, getState());
        })
      });
      if (isPast) disableCardActions(card);
      dayTasks.appendChild(card);
    }
  }

  // Habits (scheduled for that weekday)
  const w = weekdayIndex(dayKey);
  const hToday = state.habits.filter(h => h.active && (!h.byWeekday || h.byWeekday.includes(w)));
  if (hToday.length === 0) {
    dayHabits.appendChild(el('div', { class: 'card graytint' }, 'No habits scheduled.'));
  } else {
    const hs = { ...(state.today.habitsStatus || {}) }; // only today has live status
    for (const h of hToday) {
      const isDone = (isToday ? (hs[h.id]?.done || false) : (wasHabitDoneOnDay(state, h.id, dayKey)));
      const tally = (isToday && h.kind === 'counter') ? (hs[h.id]?.tally || 0) : (isDone ? (h.targetPerDay || 1) : 0);

      const card = habitCard({
        title: h.title,
        kind: h.kind,
        targetPerDay: h.targetPerDay || 1,
        tally,
        points: h.pointsOnComplete || 0,
        done: !!isDone,
        onToggleBinary: (!isToday ? null : async (next) => {
          if (h.kind !== 'binary') return;
          if (next) {
            await awardHabit(h);
            hs[h.id] = { tally: 1, done: true };
          } else {
            const res = await undoLastFor('habit', h.id);
            if (!res.ok) { toast(res.reason, 'warn'); return; }
            hs[h.id] = { tally: 0, done: false };
          }
          await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });
          renderDayDrawer(dayKey, getState());
        }),
        onPlus: (!isToday ? null : async () => {
          if (h.kind !== 'counter') return;
          const tgt = h.targetPerDay || 1;
          const cur = Math.min(tgt, (hs[h.id]?.tally || 0) + 1);
          let done = hs[h.id]?.done || false;
          const wasDone = done;

          if (!done && cur >= tgt) {
            await awardHabit(h, { isCounterComplete: true });
            done = true;
          }
          hs[h.id] = { tally: cur, done };
          await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });
          if (!wasDone && done) toast(`Completed ${h.title} (+${h.pointsOnComplete||0} pts)`, 'success');
          renderDayDrawer(dayKey, getState());
        }),
        onMinus: (!isToday ? null : async () => {
          if (h.kind !== 'counter') return;
          const tgt = h.targetPerDay || 1;
          const cur = Math.max(0, (hs[h.id]?.tally || 0) - 1);
          let done = hs[h.id]?.done || false;
          const wasDone = done;

          if (wasDone && cur < tgt) {
            const res = await undoLastFor('habit', h.id);
            if (!res.ok) { toast(res.reason, 'warn'); return; }
            done = false;
          }
          hs[h.id] = { tally: cur, done };
          await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });
          renderDayDrawer(dayKey, getState());
        })
      });
      if (!isToday) disableCardActions(card);
      dayHabits.appendChild(card);
    }
  }

  // Daily Quests
  const assign = state.dailyAssignments?.[dayKey];
  const ids = assign?.challengeIds || [];
  const snap = assign?.snapshot || {};
  if (ids.length === 0) {
    dayQuests.appendChild(el('div', { class: 'card graytint' }, 'No quests.'));
  } else {
    for (const id of ids) {
      const done = isChallengeDoneOnDay(state, id, dayKey);
      const card = challengeCard({
        title: snap[id]?.title || 'Quest',
        points: snap[id]?.points || 0,
        done,
        onComplete: (!isToday ? null : async () => {
          await awardChallenge(id);
          renderDayDrawer(dayKey, getState());
          toast(`Quest complete — +${snap[id]?.points||0} pts`, 'success');
        }),
        onUndo: (!isToday ? null : async () => {
          const res = await undoLastFor('challenge', id);
          if (!res.ok) { toast(res.reason, 'warn'); return; }
          renderDayDrawer(dayKey, getState());
        })
      });
      if (!isToday) disableCardActions(card);
      dayQuests.appendChild(card);
    }
  }

  // Weekly Boss (for the week that includes dayKey)
  const weekStart = weekStartOf(parseKey(dayKey));
  const boss = state.weeklyBoss;
  const isSameWeek = boss?.weekStartDay === weekStart;
  if (!isSameWeek || !boss?.goals?.length) {
    dayBoss.appendChild(el('div', { class: 'card graytint' }, 'No boss goals for this week.'));
  } else {
    for (const g of boss.goals) {
      const tally = getBossTallyForPeriod(state, g.id, weekStart);
      const card = bossGoalCard({
        label: g.label,
        tally,
        target: g.target,
        pointsPerTick: g.pointsPerTick || 0,
        rerolls: boss.rerolls || 0,
        onPlus: (!isToday ? null : async () => {
          if (tally >= g.target) return;
          await awardBossTick(g.id);
          renderDayDrawer(dayKey, getState());
        }),
        onMinus: (!isToday ? null : async () => {
          if (tally <= 0) return;
          const res = await undoLastFor('boss', g.id);
          if (!res.ok) { toast(res.reason, 'warn'); return; }
          renderDayDrawer(dayKey, getState());
        })
      });
      if (!isToday) disableCardActions(card);
      dayBoss.appendChild(card);
    }
  }
}

/* ================= Helpers ================= */

function segBtn(label, active, onClick) {
  const b = el('button', { class: `pilltab ${active ? 'is-active' : ''}` }, label);
  b.addEventListener('click', onClick);
  return b;
}
function icon(name, cls = 'icon') {
  const s = el('svg', { class: cls });
  s.appendChild(el('use', { href: `#i-${name}` }));
  return s;
}

// Month title like "September 2025"
function formatMonthTitle(d) {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

function setWeekMode(v) {
  weekMode = !!v;
  try { localStorage.setItem('calWeekMode', v ? '1' : '0'); } catch {}
  render();
}
function changeMonth(delta) {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  render();
}
function changeWeek(delta) {
  const d = new Date(viewDate);
  d.setDate(d.getDate() + 7 * delta);
  viewDate = d;
  render();
}

function getMonthDays(d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = new Date(first);
  // start on Sunday
  start.setDate(1 - first.getDay());
  const arr = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    arr.push(keyOf(dt));
  }
  return arr;
}
function getWeekDays(d) {
  const base = new Date(d);
  // move to Sunday
  base.setDate(base.getDate() - base.getDay());
  const arr = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    arr.push(keyOf(dt));
  }
  return arr;
}

function keyOf(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parseKey(k) { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); }

/** Heatmap: levels 1..5 based on points vs goal for the visible range */
function heatmapLevels(dayKeys, state) {
  const goal = state.settings.dailyGoal || 60;
  const levels = new Map();
  for (const k of dayKeys) {
    const p = (state.progress?.[k]?.points) || 0;
    if (p <= 0) continue;
    const ratio = p / Math.max(1, goal);
    let lvl = 1;
    if (ratio >= 0.5) lvl = 2;
    if (ratio >= 1.0) lvl = 3;
    if (ratio >= 1.5) lvl = 4;
    if (ratio >= 2.0) lvl = 5;
    levels.set(k, lvl);
  }
  return levels;
}

/** Habit done ring: scheduled habits count vs habitsDone from progress */
function isHabitDayComplete(state, dayKey) {
  const w = weekdayIndex(dayKey);
  const scheduled = state.habits.filter(h => h.active && (!h.byWeekday || h.byWeekday.includes(w)));
  const need = scheduled.length;
  const done = (state.progress?.[dayKey]?.habitsDone) || 0;
  return need > 0 && done >= need;
}
function wasHabitDoneOnDay(state, habitId, dayKey) {
  // Use ledger to determine if a habit was completed that day
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== dayKey) continue;
    if (e.type !== 'habit' || e.subjectId !== habitId) continue;
    if ((e.pointsDelta || 0) > 0) return true;
    if ((e.pointsDelta || 0) < 0) return false;
  }
  return false;
}
function isChallengeDoneOnDay(state, id, dayKey) {
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== dayKey) continue;
    if (e.type !== 'challenge' || e.subjectId !== id) continue;
    if ((e.pointsDelta || 0) > 0) return true;
    if ((e.pointsDelta || 0) < 0) return false;
  }
  return false;
}

function getBossTallyForPeriod(state, goalId /* for week */, weekStartDay) {
  // Count all ticks for that goal during this week; our ledger doesn't store weeks explicitly,
  // but boss resets weekly; we'll count all entries for this goal since last weekStartDay inclusive.
  let tally = 0;
  for (let i = 0; i < state.ledger.length; i++) {
    const e = state.ledger[i];
    if (e.type !== 'boss' || e.subjectId !== goalId) continue;
    if (e.day < weekStartDay) continue;
    if ((e.pointsDelta || 0) > 0) tally++;
    else if ((e.pointsDelta || 0) < 0) tally = Math.max(0, tally - 1);
  }
  return tally;
}

/** Disable all interactive buttons in a card (for past days) */
function disableCardActions(card) {
  card.querySelectorAll('button').forEach(b => { b.disabled = true; b.classList.add('ghost'); });
}

/** Open FAB with the date prefilled and show the Task tab */
function openFabForDate(dayKey) {
  // Prefill date field
  const dateInput = document.getElementById('fab-task-date');
  if (dateInput) dateInput.value = dayKey;

  // Open sheet directly (not via main FAB click, to keep our date)
  openSheet('sheet-fab');

  // Switch to "New Task" tab
  const tabBtn = document.querySelector('[data-fabtab="task"]');
  if (tabBtn) tabBtn.click();

  // Make the weekday row default to hidden until user toggles repeat
  const toggle = document.getElementById('fab-task-repeat-toggle');
  const wk = document.getElementById('fab-task-weekdays');
  if (toggle && wk) {
    toggle.checked = false;
    wk.style.display = 'none';
    wk.setAttribute('aria-hidden', 'true');
  }
}

/* --- Inline small icons not in index.html sprite --- */
(function injectChevronSymbols() {
  if (document.getElementById('i-chev-left')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.display = 'none';
  svg.innerHTML = `
  <symbol id="i-chev-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 18l-6-6 6-6"/>
  </symbol>
  <symbol id="i-chev-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 18l6-6-6-6"/>
  </symbol>`;
  document.body.appendChild(svg);
})();
