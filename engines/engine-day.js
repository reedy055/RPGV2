// /engines/engine-day.js
// Day/Week engine: rollover, overdue, streak, generate today's instances, challenges, boss.

import { getState, dispatch } from '../core/store.js';
import { todayKey, addDays, weekdayIndex, weekStartOf, nowTs } from '../core/time.js';
import { rebuildFromLedger } from '../core/ledger.js';
import { generateDailyChallenges } from './engine-chal.js';
import { generateWeeklyBoss, rerollWeeklyBoss } from './engine-boss.js';

/** Call this on boot and on a 60s heartbeat. */
export async function dayHeartbeat() {
  const s = getState();
  if (!s) return;
  const nowDay = todayKey(new Date());
  const curDay = s.today?.day;

  // 1) Day rollover?
  if (curDay && curDay !== nowDay) {
    await finalizeYesterdayAndFlipDay(s, curDay);
  }

  // 2) Ensure today's instances and challenges exist
  await ensureTodayGenerated(getState());

  // 3) Ensure weekly boss for current week
  await ensureWeekBoss(getState());
}

/** Finalize yesterday, then flip to new day key */
async function finalizeYesterdayAndFlipDay(state, yesterdayKey) {
  // Overdue: count yesterday's unfinished task instances
  const overdueCount = state.taskInstances.filter(t => t.day === yesterdayKey && !t.done).length;

  // Rebuild summaries (points/coins/streak) from ledger, then set missedTodos for yesterday.
  const rebuilt = rebuildFromLedger(state);
  // set missed todos for yesterday
  if (!rebuilt.progress[yesterdayKey]) {
    rebuilt.progress[yesterdayKey] = { points: 0, coinsEarned: 0, tasksDone:0, habitsDone:0, challengesDone:0, bossTicks:0, missedTodos: 0 };
  }
  rebuilt.progress[yesterdayKey].missedTodos = overdueCount;

  await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });

  // Flip today's key (do NOT reset coinsUnminted; it carries over)
  const newDay = todayKey(new Date());
  await dispatch({ type: 'TODAY_PATCH', patch: { day: newDay } });
}

/** Generate today's task instances from active rules + daily challenges if not present */
export async function ensureTodayGenerated(state) {
  const s = state || getState();
  if (!s) return;
  const day = s.today.day || todayKey(new Date());
  const w = weekdayIndex(day);

  // 1) Generate TaskInstances for active rules scheduled today (if not already present)
  for (const rule of s.taskRules) {
    if (!rule.active) continue;
    const allow = !rule.byWeekday || rule.byWeekday.includes(w);
    if (!allow) continue;

    const exists = s.taskInstances.some(t => t.day === day && t.ruleId === rule.id);
    if (!exists) {
      await dispatch({
        type: 'TASK_INSTANCE_ADD',
        instance: { title: rule.title, points: rule.points, day, ruleId: rule.id, done: false }
      });
    }
  }

  // 2) Daily Challenges: assign if missing for today
  const existing = s.dailyAssignments?.[day];
  if (!existing) {
    const assignment = generateDailyChallenges(s, day);
    await dispatch({ type: 'ASSIGN_DAILY_CHALLENGES', payload: assignment });
  }

  // 3) After generation, rebuild summaries to initialize caches for today from ledger (optional, cheap)
  const rebuilt = rebuildFromLedger(getState());
  await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });
}

/** Ensure weekly boss exists for current Monday */
export async function ensureWeekBoss(state) {
  const s = state || getState();
  if (!s) return;
  const wantWeek = weekStartOf(new Date());
  const haveWeek = s.weeklyBoss?.weekStartDay;

  if (haveWeek !== wantWeek) {
    const boss = generateWeeklyBoss(s, wantWeek);
    await dispatch({ type: 'INIT_WEEKLY_BOSS', payload: boss });
  }
}
