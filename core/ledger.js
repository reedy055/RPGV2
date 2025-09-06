// /core/ledger.js
// Immutable event log helpers + summary rebuild.

import { todayKey, weekdayIndex, addDays } from './time.js';

export function newEntry({ type, subjectId, subjectLabel, pointsDelta = 0, coinsDelta = 0, day }) {
  const ts = Date.now();
  const id = crypto?.randomUUID?.() || (`e_${Math.random().toString(36).slice(2)}_${ts}`);
  return { id, ts, day: day || todayKey(), type, subjectId, subjectLabel, pointsDelta: Math.trunc(pointsDelta), coinsDelta: Math.trunc(coinsDelta) };
}

/** Build progress summaries, coins, and streaks strictly from ledger */
export function rebuildFromLedger(state) {
  const prog = {};
  let coinsTotal = 0;

  // day -> set of {habitDoneIds}, counts for done types, points sum
  for (const e of state.ledger) {
    const d = e.day;
    if (!prog[d]) prog[d] = { points: 0, coinsEarned: 0, tasksDone:0, habitsDone:0, challengesDone:0, bossTicks:0, missedTodos: prog[d]?.missedTodos || 0 };
    prog[d].points += (e.pointsDelta || 0);
    coinsTotal += (e.coinsDelta || 0);
    if (e.coinsDelta > 0) prog[d].coinsEarned += e.coinsDelta;

    switch (e.type) {
      case 'task': prog[d].tasksDone++; break;
      case 'habit': prog[d].habitsDone++; break;
      case 'challenge': prog[d].challengesDone++; break;
      case 'boss': prog[d].bossTicks++; break;
      default: break;
    }
  }

  // Streak compute: consecutive days ending yesterday where all scheduled habits are complete
  // Determine per-day “scheduled habits count” from state.habits + weekdays
  const days = Object.keys(prog).sort(); // ascending
  const today = todayKey();
  const yday = addDays(today, -1);
  let streakCur = 0;
  for (let i = 0; i < days.length; i++) {
    // We’ll walk from the end backward to count consecutive chain up to yesterday
  }
  // Simple approach: iterate backward from yday while day is present & counts meet rule
  let cursor = yday;
  while (true) {
    const w = weekdayIndex(cursor);
    const scheduled = state.habits.filter(h => h.active && (!h.byWeekday || h.byWeekday.includes(w)));
    const need = scheduled.length;
    const doneCount = (prog[cursor]?.habitsDone) || 0;
    if (need === 0) {
      // No habits scheduled: treat as neutral (doesn't break streak, doesn't advance)
      // Move back one day but do not increment
      cursor = addDays(cursor, -1);
      if (days.length === 0 || cursor < days[0]) break;
      continue;
    }
    if (doneCount >= need) {
      streakCur++;
      cursor = addDays(cursor, -1);
      if (days.length === 0 || cursor < days[0]) break;
      continue;
    }
    break; // chain broken
  }

  // Best streak stored in profile.bestStreak; we won't compute historic best here.
  const bestStreak = Math.max(state.profile?.bestStreak || 0, streakCur);

  return { progress: prog, coinsTotal, streak: { current: streakCur }, bestStreak };
}

/** Mark a day’s missed todos (called by engine-day at rollover) */
export function progressSetMissed(prog, day, count) {
  prog[day] = prog[day] || { points:0, coinsEarned:0, tasksDone:0, habitsDone:0, challengesDone:0, bossTicks:0, missedTodos:0 };
  prog[day].missedTodos = count;
  return prog;
}
