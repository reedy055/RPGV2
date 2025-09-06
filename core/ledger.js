// /core/ledger.js
// Ledger entries + rebuild summaries (points, coins, streaks).

import { todayKey, addDays, weekdayIndex } from './time.js';

export function newEntry({ type, subjectId, subjectLabel, pointsDelta = 0, coinsDelta = 0, day }) {
  const ts = Date.now();
  return {
    id: `lg_${ts.toString(36)}_${Math.random().toString(36).slice(2,6)}`,
    ts,
    day: day || todayKey(),
    type,
    subjectId,
    subjectLabel,
    pointsDelta: Math.round(pointsDelta) || 0,
    coinsDelta: Math.round(coinsDelta) || 0
  };
}

/**
 * Rebuild all computed summaries from ledger:
 * - progress[day] = {points, coinsEarned, tasksDone, habitsDone, challengesDone, bossTicks, missedTodos?}
 * - coinsTotal
 * - streak.current and bestStreak (rule: all scheduled habits completed for a day counts)
 */
export function rebuildFromLedger(state) {
  const progress = {};
  let coinsTotal = 0;

  for (const e of state.ledger) {
    const day = e.day || todayKey();
    if (!progress[day]) progress[day] = blankDay();
    const p = progress[day];
    const pts = e.pointsDelta || 0;
    const cds = e.coinsDelta || 0;

    if (pts) p.points = (p.points || 0) + pts;
    if (cds > 0) p.coinsEarned = (p.coinsEarned || 0) + cds;
    coinsTotal += cds;

    if (pts > 0) {
      if (e.type === 'task') p.tasksDone = (p.tasksDone || 0) + 1;
      if (e.type === 'habit') p.habitsDone = (p.habitsDone || 0) + 1;
      if (e.type === 'challenge') p.challengesDone = (p.challengesDone || 0) + 1;
      if (e.type === 'boss') p.bossTicks = (p.bossTicks || 0) + 1;
    }
  }

  const { current, best } = computeStreak(state, progress);
  return { progress, coinsTotal, streak: { current }, bestStreak: best };
}

function blankDay() {
  return { points: 0, coinsEarned: 0, tasksDone:0, habitsDone:0, challengesDone:0, bossTicks:0, missedTodos:0 };
}

/** Streak = consecutive days up to today where ALL scheduled habits for that day were completed */
function computeStreak(state, progress) {
  const today = todayKey();
  let cur = 0, best = 0, run = 0;

  // Scan back ~365 days; treat days with zero scheduled habits as neutral (do not break or advance)
  let cursor = today;
  for (let i = 0; i < 365; i++) {
    const sched = scheduledHabitsForDay(state, cursor);
    if (sched === 0) {
      // neutral; do not affect runs unless in a run already.
      cursor = addDays(cursor, -1);
      continue;
    }
    const done = (progress[cursor]?.habitsDone) || 0;
    if (done >= sched) {
      run++;
      if (cursor === today) cur = run; // measure current
    } else {
      best = Math.max(best, run);
      run = 0;
      if (cursor === today) cur = 0;
    }
    cursor = addDays(cursor, -1);
  }
  best = Math.max(best, run);
  return { current: cur, best };
}

function scheduledHabitsForDay(state, dayKey) {
  const w = weekdayIndex(dayKey);
  let count = 0;
  for (const h of state.habits) {
    if (!h.active) continue;
    if (h.byWeekday && !h.byWeekday.includes(w)) continue;
    count++;
  }
  return count;
}
