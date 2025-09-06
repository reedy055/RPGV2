// /ui/home.js
// Home screen: header, Today's Tasks, Habits, Daily Challenges, Weekly Boss, Completed Today feed.

import { getState, dispatch, subscribe } from '../core/store.js';
import { todayKey, weekdayIndex } from '../core/time.js';
import { rebuildFromLedger } from '../core/ledger.js';
import { ensureTodayGenerated, ensureWeekBoss } from '../engines/engine-day.js';
import {
  awardTask, awardHabit, awardChallenge, awardBossTick, undoLastFor
} from '../engines/engine-coins.js';

import {
  el, clear, mount,
  headerCard, section,
  taskCard, habitCard, challengeCard, bossGoalCard,
  pct, fmtPts
} from './components.js';
import { openSheet, toast, confirmDialog } from './modals.js';

// Mount point
const root = document.getElementById('tab-home');

// Render on boot + every state change
render();
subscribe((s, action) => {
  if (!root.classList.contains('is-active') && action?.type !== 'SET_STATE') return;
  render();
});

async function render() {
  const s = getState();
  if (!s) return;

  clear(root);

  // ===== Header (points, goal, streak, coins) =====
  const prog = s.progress?.[s.today.day] || { points: 0 };
  const ptsToday = prog.points | 0;
  const goal = s.settings.dailyGoal | 0;
  const percent = goal > 0 ? Math.min(100, Math.round((ptsToday / goal) * 100)) : 0;
  const goalMet = goal > 0 && ptsToday >= goal;

  const header = headerCard({
    title: 'Today',
    bigNumber: fmtPts(ptsToday),
    percent,
    goalMet,
    streakText: `${s.streak.current|0}`,
    onCoins: () => openSheet('drawer-rewards')
  });
  mount(root, header.root);

  // ===== Sections =====
  renderTasks(s);
  renderHabits(s);
  renderChallenges(s);
  renderBoss(s);
  renderFeed(s);
}

/* ---------------------------
   Today’s Tasks (instances)
----------------------------*/
function renderTasks(state) {
  const day = state.today.day;
  const items = state.taskInstances.filter(t => t.day === day);
  const { wrap } = section('Today’s Tasks', null);
  mount(root, wrap);

  const list = el('div', { class: 'list cards' });
  wrap.appendChild(list);

  if (items.length === 0) {
    list.appendChild(el('div', { class: 'card graytint' }, 'No tasks yet. Add from + or Calendar.'));
    return;
  }

  for (const t of items) {
    const card = taskCard({
      title: t.title,
      points: t.points || 0,
      done: !!t.done,
      overdue: false,
      onComplete: async () => {
        await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { done: true } });
        await awardTask(t);
        toast(`Completed — +${t.points} pts`, 'success');
      },
      onUndo: async () => {
        const res = await undoLastFor('task', t.id);
        if (!res.ok) { toast(res.reason, 'warn'); return; }
        await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { done: false } });
        toast('Task undone', '');
      },
      onEdit: async () => {
        const title = prompt('Edit title', t.title);
        if (title == null) return;
        const pts = Number(prompt('Edit points', String(t.points || 0)));
        if (!pts || isNaN(pts) || pts < 1) return toast('Points must be ≥1', 'warn');
        await dispatch({ type: 'TASK_INSTANCE_EDIT', id: t.id, patch: { title: title.trim(), points: Math.round(pts) } });
      },
      onDelete: async () => {
        const ok = await confirmDialog({ title: 'Delete task?', message: `Delete “${t.title}” for today?` });
        if (!ok) return;
        await dispatch({ type: 'TASK_INSTANCE_DELETE', id: t.id });
      }
    });
    list.appendChild(card);
  }
}

/* ---------------------------
   Habits (binary & counter)
----------------------------*/
function renderHabits(state) {
  const { wrap } = section('Habits', null);
  mount(root, wrap);
  const list = el('div', { class: 'list cards' });
  wrap.appendChild(list);

  const w = weekdayIndex(state.today.day);
  const todayHabits = state.habits.filter(h => h.active && (!h.byWeekday || h.byWeekday.includes(w)));

  if (todayHabits.length === 0) {
    list.appendChild(el('div', { class: 'card graytint' }, 'No habits scheduled today.'));
    return;
  }

  const hs = { ...(state.today.habitsStatus || {}) };

  for (const h of todayHabits) {
    const status = hs[h.id] || { tally: 0, done: false };
    // Defensive clamp for counter
    if (h.kind === 'counter') {
      const tgt = h.targetPerDay || 1;
      if (status.tally > tgt) status.tally = tgt;
      if (status.tally < 0) status.tally = 0;
      status.done = status.tally >= tgt;
    }

    const card = habitCard({
      title: h.title,
      kind: h.kind,
      targetPerDay: h.targetPerDay || 1,
      tally: status.tally || 0,
      points: h.pointsOnComplete || 0,
      done: !!status.done,
      onToggleBinary: async (next) => {
        if (h.kind !== 'binary') return;
        if (next) {
          // complete
          await awardHabit(h);
          hs[h.id] = { tally: 1, done: true };
        } else {
          // undo
          const res = await undoLastFor('habit', h.id);
          if (!res.ok) { toast(res.reason, 'warn'); return; }
          hs[h.id] = { tally: 0, done: false };
        }
        await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });
      },
      onPlus: async () => {
        if (h.kind !== 'counter') return;
        const tgt = h.targetPerDay || 1;
        const cur = Math.min(tgt, (hs[h.id]?.tally || 0) + 1);
        let done = hs[h.id]?.done || false;
        const wasDone = done;

        if (!done && cur >= tgt) {
          // awarding points at completion threshold
          await awardHabit(h, { isCounterComplete: true });
          done = true;
        }
        hs[h.id] = { tally: cur, done };
        await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });

        if (!wasDone && done) toast(`Completed ${h.title} (+${h.pointsOnComplete||0} pts)`, 'success');
      },
      onMinus: async () => {
        if (h.kind !== 'counter') return;
        const tgt = h.targetPerDay || 1;
        const cur = Math.max(0, (hs[h.id]?.tally || 0) - 1);
        let done = hs[h.id]?.done || false;
        const wasDone = done;

        if (wasDone && cur < tgt) {
          // drop below threshold -> undo the award
          const res = await undoLastFor('habit', h.id);
          if (!res.ok) { toast(res.reason, 'warn'); return; }
          done = false;
        }
        hs[h.id] = { tally: cur, done };
        await dispatch({ type: 'TODAY_PATCH', patch: { habitsStatus: hs } });
      }
    });

    list.appendChild(card);
  }
}

/* ---------------------------
   Daily Challenges
----------------------------*/
function renderChallenges(state) {
  const day = state.today.day;
  const assign = state.dailyAssignments?.[day];
  const ids = assign?.challengeIds || [];
  const snapshot = assign?.snapshot || {};

  const metaRight = ids.length ? el('span', { class: 'meta' }, `${countDoneChallengesToday(state, ids)}/${ids.length}`) : null;
  const { wrap, head } = section('Daily Quests', metaRight);
  mount(root, wrap);

  const list = el('div', { class: 'list cards' });
  wrap.appendChild(list);

  if (ids.length === 0) {
    list.appendChild(el('div', { class: 'card graytint' }, 'No quests today.'));
    return;
  }

  for (const id of ids) {
    const snap = snapshot[id];
    const done = isChallengeDoneToday(state, id);

    const card = challengeCard({
      title: snap?.title || 'Quest',
      points: snap?.points || 0,
      done,
      onComplete: async () => {
        await awardChallenge(id);
        toast(`Quest complete — +${snap.points} pts`, 'success');
      },
      onUndo: async () => {
        const res = await undoLastFor('challenge', id);
        if (!res.ok) { toast(res.reason, 'warn'); return; }
        toast('Quest undone', '');
      }
    });

    list.appendChild(card);
  }
}

function isChallengeDoneToday(state, cid) {
  const day = state.today.day;
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== day) break;
    if (e.type !== 'challenge' || e.subjectId !== cid) continue;
    if ((e.pointsDelta || 0) > 0) return true;
    if ((e.pointsDelta || 0) < 0) return false; // last op was undo
  }
  return false;
}
function countDoneChallengesToday(state, ids) {
  let c = 0; for (const id of ids) if (isChallengeDoneToday(state, id)) c++; return c;
}

/* ---------------------------
   Weekly Boss
----------------------------*/
function renderBoss(state) {
  const boss = state.weeklyBoss;
  const goals = boss?.goals || [];
  const completed = goals.reduce((acc, g) => acc + (getBossTally(state, g.id) >= g.target ? 1 : 0), 0);

  const right = el('div', { class: 'row gap' }, [
    el('span', { class: 'meta' }, `${completed}/${goals.length}`)
  ]);
  const { wrap } = section('Weekly Boss', right);
  mount(root, wrap);

  const list = el('div', { class: 'list cards' });
  wrap.appendChild(list);

  if (!goals.length) {
    list.appendChild(el('div', { class: 'card graytint' }, 'Boss will appear on Monday. Manage → Boss settings to adjust.'));
    return;
  }

  for (const g of goals) {
    const tally = getBossTally(state, g.id);
    const card = bossGoalCard({
      label: g.label,
      tally,
      target: g.target,
      pointsPerTick: g.pointsPerTick || 0,
      rerolls: boss.rerolls || 0,
      onPlus: async () => {
        if (tally >= g.target) return;
        await awardBossTick(g.id);
      },
      onMinus: async () => {
        if (tally <= 0) return;
        const res = await undoLastFor('boss', g.id);
        if (!res.ok) { toast(res.reason, 'warn'); return; }
      }
    });
    list.appendChild(card);
  }
}

function getBossTally(state, goalId) {
  // Count positive ticks minus negative for this goal in the current week
  let pos = 0, neg = 0;
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.type !== 'boss' || e.subjectId !== goalId) continue;
    if ((e.pointsDelta || 0) > 0) pos++;
    else if ((e.pointsDelta || 0) < 0) neg++;
  }
  return Math.max(0, pos - neg);
}

/* ---------------------------
   Completed Today Feed
----------------------------*/
function renderFeed(state) {
  const { wrap } = section('Completed Today', null);
  mount(root, wrap);
  const list = el('div', { class: 'list' });
  wrap.appendChild(list);

  const day = state.today.day;
  const rows = [];
  for (let i = state.ledger.length - 1; i >= 0 && rows.length < 20; i--) {
    const e = state.ledger[i];
    if (e.day !== day) break;
    if (e.type === 'mint') continue; // skip coin mints
    const row = renderFeedRow(e, state);
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    list.appendChild(el('div', { class: 'card graytint' }, 'Nothing completed yet.'));
  } else {
    rows.reverse().forEach(r => list.appendChild(r));
  }
}

function renderFeedRow(e, state) {
  const c = el('div', { class: 'card' });
  const left = el('div');
  const title = el('div', { class: 'title' }, feedTitle(e));
  const meta = el('div', { class: 'meta' }, feedMeta(e));
  left.append(title, meta);

  const right = el('div', { class: 'row gap' });
  // Only allow undo for positive awards today and not purchases
  if ((e.pointsDelta || 0) > 0 && e.type !== 'purchase') {
    const b = el('button', { class: 'btn small ghost' }, 'Undo');
    b.addEventListener('click', async () => {
      const res = await undoLastFor(e.type, e.subjectId);
      if (!res.ok) { toast(res.reason, 'warn'); return; }
      toast('Undone.', '');
    });
    right.appendChild(b);
  }

  const row = el('div', { class: 'row between' }, [left, right]);
  c.appendChild(row);
  return c;
}

function feedTitle(e) {
  const verb = (e.pointsDelta || 0) >= 0 ? 'Completed' : 'Undid';
  switch (e.type) {
    case 'task': return `${verb} task — ${e.subjectLabel}`;
    case 'habit': return `${verb} habit — ${e.subjectLabel}`;
    case 'challenge': return `${verb} quest — ${e.subjectLabel}`;
    case 'boss': return `${verb} boss tick — ${e.subjectLabel}`;
    case 'library': return `${verb} action — ${e.subjectLabel}`;
    case 'purchase': return `Purchased — ${e.subjectLabel}`;
    default: return `${verb} — ${e.subjectLabel}`;
  }
}
function feedMeta(e) {
  const pts = (e.pointsDelta || 0);
  const coins = (e.coinsDelta || 0);
  const parts = [];
  if (pts) parts.push(`${pts > 0 ? '+' : ''}${pts} pts`);
  if (coins) parts.push(`${coins > 0 ? '+' : ''}${coins} coins`);
  return parts.join(' · ') || '—';
}

// Ensure engines run at least once and data exists
(async function initHome() {
  await ensureTodayGenerated(getState());
  await ensureWeekBoss(getState());
})();
