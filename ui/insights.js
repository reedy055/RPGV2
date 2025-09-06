// /ui/insights.js
// Insights dashboard: KPIs, weekly vs ghost, 30-day timeline, habit matrices, focus heat, badges.

import { getState, subscribe } from '../core/store.js';
import { todayKey, addDays, weekdayIndex, weekStartOf } from '../core/time.js';
import { el, clear, mount, card } from './components.js';
import { weeklyBars, timeline30, habitMatrix, focusBars } from './charts.js';

const root = document.getElementById('tab-insights');

render();
subscribe((s, action) => {
  if (!root.classList.contains('is-active') && action?.type !== 'SET_STATE') return;
  render();
});

function render() {
  const s = getState();
  if (!s) return;

  clear(root);

  // ===== KPIs =====
  const kpiWrap = el('div', { class: 'section' });
  const kpiGrid = el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;' });

  const wThis = weekPoints(s, 0);
  const wPrev = weekPoints(s, -1);
  const kConsistency = daysMeetingGoal(s, 30);
  const kAvg = Math.round(sumPoints(s, 30) / Math.max(1, Math.min(30, Object.keys(s.progress||{}).length)));
  const kStreak = s.streak?.current || 0;
  const kBest = s.profile?.bestStreak || 0;
  const kCoins = s.profile?.coins || 0;

  kpiGrid.appendChild(kpiTile('This week', `${wThis} pts`, `Last week ${wPrev} pts`));
  kpiGrid.appendChild(kpiTile('Avg/day (30)', `${kAvg} pts`, `${kConsistency}/30 days ≥ goal`));
  kpiGrid.appendChild(kpiTile('Streak', `${kStreak} days`, `Best ${kBest}`));
  kpiGrid.appendChild(kpiTile('Coins', `${kCoins}`, `Minted all-time`));

  kpiWrap.appendChild(kpiGrid);
  mount(root, kpiWrap);

  // ===== Weekly Bars (ghost) =====
  const wkWrap = el('div', { class: 'section' });
  wkWrap.appendChild(el('h3', { class: 'section-title' }, 'This Week vs Last Week'));
  const wkCard = card({ children: [] });
  const wkCanvas = el('canvas', { class: 'chart' });
  wkCard.appendChild(wkCanvas);
  wkWrap.appendChild(wkCard);
  mount(root, wkWrap);

  const [thisWeekArr, lastWeekArr] = weekSeries(s);
  weeklyBars(wkCanvas, thisWeekArr, lastWeekArr, { height: 180 });

  // ===== 30-Day Timeline =====
  const tlWrap = el('div', { class: 'section' });
  tlWrap.appendChild(el('h3', { class: 'section-title' }, 'Last 30 Days'));
  const tlCard = card({});
  const tlCanvas = el('canvas', { class: 'chart' });
  tlCard.appendChild(tlCanvas);
  tlWrap.appendChild(tlCard);
  mount(root, tlWrap);

  const last30 = lastNDaysPoints(s, 30);
  timeline30(tlCanvas, last30, { height: 220 });

  // ===== Habit Matrices (top 3 active habits) =====
  const habWrap = el('div', { class: 'section' });
  habWrap.appendChild(el('h3', { class: 'section-title' }, 'Habit Consistency (30 days)'));
  const grid = el('div', { style:'display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:12px;' });
  const habits = s.habits.filter(h => h.active).slice(0,3);
  if (habits.length === 0) {
    grid.appendChild(card({ classes:'graytint', children: 'No active habits.' }));
  } else {
    for (const h of habits) {
      const c = card({});
      c.appendChild(el('div', { class:'row between' }, [
        el('div', { class: 'title' }, h.title),
        el('div', { class: 'meta' }, habitStreakText(s, h))
      ]));
      const cv = el('canvas', { class: 'chart' });
      c.appendChild(cv);
      const cells = habitCells30(s, h);
      habitMatrix(cv, cells, { height: 130 });
      grid.appendChild(c);
    }
  }
  habWrap.appendChild(grid);
  mount(root, habWrap);

  // ===== Focus Heat (24h) =====
  const fhWrap = el('div', { class: 'section' });
  fhWrap.appendChild(el('h3', { class: 'section-title' }, 'Focus Heat (last 30 days)'));
  const fhCard = card({});
  const fhCanvas = el('canvas', { class: 'chart' });
  fhCard.appendChild(fhCanvas);
  fhWrap.appendChild(fhCard);
  mount(root, fhWrap);

  const bins = focusBins24(s, 30);
  focusBars(fhCanvas, bins, { height: 180 });

  // ===== Milestones =====
  const msWrap = el('div', { class: 'section' });
  msWrap.appendChild(el('h3', { class: 'section-title' }, 'Milestones'));
  const msList = el('div', { class:'list' });
  const milestones = pickMilestones({ wThis, kStreak, kBest, kCoins, total30: sumPoints(s,30) });
  if (milestones.length === 0) {
    msList.appendChild(card({ classes:'graytint', children:'Keep pushing — milestones will show up here!' }));
  } else {
    for (const m of milestones) {
      const c = card({});
      c.appendChild(el('div', { class:'title' }, m.title));
      c.appendChild(el('div', { class:'meta' }, m.subtitle));
      msList.appendChild(c);
    }
  }
  msWrap.appendChild(msList);
  mount(root, msWrap);
}

/* ====== KPI bits ====== */
function kpiTile(title, big, sub='') {
  const c = card({});
  const t = el('div', { class: 'title' }, title);
  const b = el('div', { class: 'header-big' }, big);
  const s = el('div', { class: 'meta' }, sub);
  c.appendChild(t); c.appendChild(b); c.appendChild(s);
  return c;
}

/* ====== Data shaping ====== */
function lastNDaysPoints(state, n) {
  const out = [];
  const end = todayKey();
  const start = addDays(end, -(n-1));
  let cursor = start;
  for (let i=0;i<n;i++){
    out.push((state.progress?.[cursor]?.points) || 0);
    cursor = addDays(cursor, 1);
  }
  return out;
}
function sumPoints(state, n=30) {
  return lastNDaysPoints(state, n).reduce((a,b)=>a+(b||0),0);
}
function daysMeetingGoal(state, n=30) {
  const goal = state.settings.dailyGoal || 60;
  const arr = lastNDaysPoints(state, n);
  return arr.reduce((c, v) => c + (v >= goal ? 1 : 0), 0);
}
function weekPoints(state, offsetWeeks = 0) {
  // offset 0 = this week; -1 = last week
  const today = new Date();
  const monday = parseKey(weekStartOf(today));
  monday.setDate(monday.getDate() + 7*offsetWeeks);
  let total = 0;
  for (let i=0;i<7;i++){
    const k = keyOf(addDays(todayKey(monday), i));
    total += (state.progress?.[k]?.points) || 0;
  }
  return total|0;
}
function weekSeries(state) {
  const today = new Date();
  const thisMon = parseKey(weekStartOf(today));
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);

  const arrThis = [], arrLast = [];
  for (let i=0;i<7;i++){
    const kThis = keyOf(addDays(todayKey(thisMon), i));
    const kLast = keyOf(addDays(todayKey(lastMon), i));
    arrThis.push((state.progress?.[kThis]?.points) || 0);
    arrLast.push((state.progress?.[kLast]?.points) || 0);
  }
  return [arrThis, arrLast];
}
function habitCells30(state, habit) {
  // 5 rows × 7 cols = 35; we'll show last 35 but title says 30 (close enough)
  const days = 35;
  const end = todayKey();
  const start = addDays(end, -(days-1));
  const out = [];
  let cursor = start;
  for (let i=0;i<days;i++){
    out.push(wasHabitDoneOnDay(state, habit.id, cursor) ? 1 : 0);
    cursor = addDays(cursor, 1);
  }
  return out;
}
function wasHabitDoneOnDay(state, habitId, dayKey) {
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== dayKey) continue;
    if (e.type !== 'habit' || e.subjectId !== habitId) continue;
    if ((e.pointsDelta || 0) > 0) return true;
    if ((e.pointsDelta || 0) < 0) return false;
  }
  return false;
}
function focusBins24(state, nDays=30) {
  const end = todayKey();
  const start = addDays(end, -(nDays-1));
  const startTs = (new Date(start+'T00:00:00')).getTime();
  const endTs = (new Date(addDays(end,1)+'T00:00:00')).getTime();

  const bins = new Array(24).fill(0);
  for (const e of state.ledger) {
    if ((e.pointsDelta||0) <= 0) continue; // only positive awards
    if (!e.ts) continue;
    if (e.ts < startTs || e.ts >= endTs) continue;
    const d = new Date(e.ts);
    bins[d.getHours()] += e.pointsDelta || 0; // weight by points
  }
  return bins;
}
function habitStreakText(state, habit) {
  // naive: count trailing days up to yesterday where habit had positive entry
  const today = todayKey();
  let cur = 0; let cursor = addDays(today, -1);
  while (true) {
    if (wasHabitDoneOnDay(state, habit.id, cursor)) cur++;
    else break;
    cursor = addDays(cursor, -1);
    if (cursor < '1970-01-01') break;
  }
  return `${cur}-day streak`;
}

/* ====== Milestones ====== */
function pickMilestones({ wThis, kStreak, kBest, kCoins, total30 }) {
  const out = [];
  if (wThis >= 300) out.push({ title:'Weekly 300 Club', subtitle:'Cracked 300 points this week.' });
  if (wThis >= 500) out.push({ title:'Weekly 500 Club', subtitle:'Monster week — 500+ points.' });
  if (kStreak >= 7) out.push({ title:'Streak 7', subtitle:'One full week crushed.' });
  if (kStreak >= 30) out.push({ title:'Streak 30', subtitle:'A month of consistency.' });
  if (kBest >= 50) out.push({ title:'All-time streak 50', subtitle:'Legend tier consistency.' });
  if (kCoins >= 50) out.push({ title:'Coin Collector', subtitle:'50 lifetime coins minted.' });
  if (total30 >= 1000) out.push({ title:'1k in 30 days', subtitle:'Four digits in a month.' });
  return out.slice(0,6);
}

/* ====== small date helpers ====== */
function parseKey(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
function keyOf(k){ return typeof k === 'string' ? k : todayKey(k); }
