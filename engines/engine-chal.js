// /engines/engine-chal.js
// Daily Challenges generator.

import { hashString, seededShuffle } from '../core/seeds.js';
import { weekdayIndex } from '../core/time.js';

export function generateDailyChallenges(state, dayKey) {
  const N = clamp(state.settings.dailyChallengesCount ?? 3, 0, 10);
  const mult = clamp(state.settings.challengeMultiplier ?? 1.5, 1.0, 2.0);

  const w = weekdayIndex(dayKey);

  // Pool: active library items included in challenges + allowed weekday (if set)
  let pool = state.library.filter(it => it.active && it.includeInChallenges !== false);
  pool = pool.filter(it => !it.allowedWeekdays || it.allowedWeekdays.includes(w));

  // Avoid yesterday's picks if possible
  const yday = previousDay(dayKey);
  const yset = new Set(state.dailyAssignments?.[yday]?.challengeIds || []);

  // Seeded shuffle
  const seed = hashString(`CHAL:${dayKey}`);
  const shuffled = seededShuffle(pool, seed);

  // Prefer items not used yesterday
  const preferred = shuffled.sort((a,b) => {
    const ay = yset.has(a.id) ? 1 : 0;
    const by = yset.has(b.id) ? 1 : 0;
    if (ay !== by) return ay - by; // not used yesterday first
    return 0;
  });

  const chosen = preferred.slice(0, N);

  // Snapshot points = item.points × multiplier (rounded, min 1)
  const snapshot = {};
  const ids = [];
  for (const it of chosen) {
    ids.push(it.id);
    const pts = Math.max(1, Math.round((it.points || 0) * mult));
    snapshot[it.id] = { title: it.title, points: pts };
  }

  return { day: dayKey, ids, snapshot };
}

/** Helpers */
function previousDay(dayKey) {
  const [y,m,d] = dayKey.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = `${dt.getMonth()+1}`.padStart(2,'0');
  const dd = `${dt.getDate()}`.padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
