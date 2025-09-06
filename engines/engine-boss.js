// /engines/engine-boss.js
// Weekly Boss generator + reroll logic.

import { weekStartOf } from '../core/time.js';
import { hashString, seededShuffle, mulberry32 } from '../core/seeds.js';

/**
 * Create a new WeeklyBoss for the given week start (YYYY-MM-DD).
 * Rules:
 * - Pool = library.active && includeInBoss
 * - Exclude items with zero allowed days in the coming week
 * - Random (seeded), but we clamp target ≤ allowed-days this week
 */
export function generateWeeklyBoss(state, weekStartDay) {
  const goalsCount = clamp(state.settings.bossTasksPerWeek ?? 5, 1, 10);
  const minTimes = clamp(state.settings.bossTimesMin ?? 2, 1, 14);
  const maxTimes = clamp(state.settings.bossTimesMax ?? 5, minTimes, 14);

  // Build pool
  const poolAll = state.library.filter(it => it.active && it.includeInBoss !== false);
  const pool = poolAll.filter(it => countAllowedDaysThisWeek(it, weekStartDay) > 0);

  const seed = hashString(`BOSS:${weekStartDay}`);
  const shuffled = seededShuffle(pool, seed);
  const rng = mulberry32(seed ^ 0x9E3779B9);

  const chosen = shuffled.slice(0, goalsCount);

  const goals = chosen.map(it => {
    const allow = countAllowedDaysThisWeek(it, weekStartDay);
    const targetRaw = Math.floor(rng() * (maxTimes - minTimes + 1)) + minTimes;
    const target = Math.max(1, Math.min(targetRaw, allow)); // clamp to allowed days this week
    return {
      id: `bg_${it.id}`,
      label: it.title,
      target,
      tally: 0,
      linkedTaskId: it.id,
      pointsPerTick: it.points || 0
    };
  });

  return {
    weekStartDay,
    goals,
    rerolls: 0,
    completed: false
  };
}

/** Reroll: create a fresh set of goals for the same week, increment rerolls count */
export function rerollWeeklyBoss(state) {
  const cur = state.weeklyBoss;
  if (!cur) return null;
  const next = generateWeeklyBoss(state, cur.weekStartDay);
  next.rerolls = (cur.rerolls || 0) + 1;
  return next;
}

/** Helpers */
function countAllowedDaysThisWeek(item, weekStartDay) {
  // If no restriction, 7
  if (!item.allowedWeekdays || item.allowedWeekdays.length === 0) return 7;
  const [y,m,d] = weekStartDay.split('-').map(Number);
  const start = new Date(y, m-1, d);
  let count = 0;
  for (let i=0; i<7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const w = day.getDay(); // 0..6
    if (item.allowedWeekdays.includes(w)) count++;
  }
  return count;
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
