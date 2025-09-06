// /engines/engine-coins.js
// Points awards/undos + coin mint/reclaim + multipliers (Power Hour, Challenges, Boss).

import { getState, dispatch } from '../core/store.js';
import { newEntry, rebuildFromLedger } from '../core/ledger.js';
import { todayKey, nowTs } from '../core/time.js';

/** ---- Power Hour helpers (we store endsAt on today) ---- */
export function isPowerHourActive(state = getState()) {
  const ends = state.today?.powerHourEndsAt;
  if (!ends) return false;
  return Date.now() < ends;
}
export async function startPowerHour(durationMin = 60) {
  const endsAt = Date.now() + durationMin * 60000;
  await dispatch({ type: 'TODAY_PATCH', patch: { powerHourEndsAt: endsAt }});
}
export async function clearPowerHourIfExpired() {
  const s = getState();
  if (s.today?.powerHourEndsAt && Date.now() >= s.today.powerHourEndsAt) {
    await dispatch({ type: 'TODAY_PATCH', patch: { powerHourEndsAt: null }});
  }
}

/** ---- Award helpers ----
 * All award functions:
 * - compute final points (apply multipliers)
 * - append a positive ledger entry
 * - handle coin minting against pointsPerCoin
 * - patch today.pointsRuntime
 */
export async function awardTask(taskInstance) {
  const s = getState();
  const base = taskInstance.points || 0;
  const pts = applyBoost(base, s);
  await appendWithMint('task', taskInstance.id, taskInstance.title, pts);
}

export async function awardHabit(habit, opts = { isCounterComplete: false }) {
  const s = getState();
  const base = habit.pointsOnComplete || 0;
  const pts = applyBoost(base, s);
  await appendWithMint('habit', habit.id, habit.title, pts);
}

export async function awardLibraryTap(item) {
  const s = getState();
  const base = item.points || 0;
  const pts = applyBoost(base, s);
  await appendWithMint('library', item.id, item.title, pts);
}

export async function awardChallenge(challengeId) {
  const s = getState();
  const day = s.today.day;
  const snap = s.dailyAssignments?.[day]?.snapshot?.[challengeId];
  if (!snap) return;
  const base = snap.points || 0; // already multiplied by challengeMultiplier at midnight
  const pts = applyBoost(base, s);
  await appendWithMint('challenge', challengeId, snap.title, pts);
}

export async function awardBossTick(goalId) {
  const s = getState();
  const boss = s.weeklyBoss;
  if (!boss) return;
  const goal = boss.goals.find(g => g.id === goalId);
  if (!goal) return;

  const rerolls = boss.rerolls || 0;
  const mult = Math.max(0.7, 1 - 0.1 * rerolls);
  const base = goal.pointsPerTick || 0;
  const boostedBase = Math.max(1, Math.round(base * mult));
  const pts = applyBoost(boostedBase, s);
  await appendWithMint('boss', goal.id, goal.label, pts);
}

/** Undo helpers: we mirror the last positive award for a subject (today only). */
export async function undoLastFor(type, subjectId) {
  const s = getState();
  const day = s.today.day;
  const last = findLastPositiveFor(s, type, subjectId, day);
  if (!last) return { ok: false, reason: 'No prior award found to undo.' };

  // Attempt to reclaim coins if bucket goes negative; enforce policy
  const okCoins = await appendWithReclaim(type, subjectId, last.subjectLabel, -Math.abs(last.pointsDelta));
  if (!okCoins.ok) return okCoins;

  return { ok: true };
}

/** ---- Internal core award/reclaim functions ---- */

/** Append positive points and mint coins as needed */
async function appendWithMint(type, subjectId, label, points) {
  const s = getState();
  const day = s.today.day;
  const entry = newEntry({ type, subjectId, subjectLabel: label, pointsDelta: points, day });
  await dispatch({ type: 'LEDGER_APPEND', entry });

  // Mint coins according to pointsPerCoin, using a running bucket today.coinsUnminted
  const rate = s.settings.pointsPerCoin || 100;
  const bucketPrev = s.today?.coinsUnminted || 0;
  let bucket = bucketPrev + points;
  let minted = 0;
  while (bucket >= rate) {
    minted++;
    bucket -= rate;
  }
  if (minted > 0) {
    const mintEntry = newEntry({ type: 'mint', subjectId: 'coins', subjectLabel: 'Coin mint', pointsDelta: 0, coinsDelta: minted, day });
    await dispatch({ type: 'LEDGER_APPEND', entry: mintEntry });
  }
  await dispatch({ type: 'TODAY_PATCH', patch: {
    coinsUnminted: bucket,
    pointsRuntime: (s.today.pointsRuntime || 0) + points
  }});

  // Optional: refresh summaries quickly
  const rebuilt = rebuildFromLedger(getState());
  await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });
}

/** Append negative points and reclaim coins if required; block if not enough coins */
async function appendWithReclaim(type, subjectId, label, pointsNegative) {
  const s = getState();
  const day = s.today.day;
  const rate = s.settings.pointsPerCoin || 100;

  // Simulate bucket after this negative
  const bucketPrev = s.today?.coinsUnminted || 0;
  let bucket = bucketPrev + pointsNegative; // pointsNegative is negative
  let needReclaim = 0;
  while (bucket < 0) {
    needReclaim++;
    bucket += rate;
  }

  // If we need to reclaim coins, ensure we have enough available
  if (needReclaim > 0) {
    const available = s.profile.coins || 0;
    if (available < needReclaim) {
      return { ok: false, reason: `Undo needs to reclaim ${needReclaim} coin(s) already spent. Earn coins or undo purchases first.` };
    }
  }

  // Append the negative points entry
  const entry = newEntry({ type, subjectId, subjectLabel: label, pointsDelta: pointsNegative, day });
  await dispatch({ type: 'LEDGER_APPEND', entry });

  // If reclaiming, append mint negatives
  if (needReclaim > 0) {
    const mintBack = newEntry({ type: 'mint', subjectId: 'coins', subjectLabel: 'Coin reclaim', pointsDelta: 0, coinsDelta: -needReclaim, day });
    await dispatch({ type: 'LEDGER_APPEND', entry: mintBack });
  }

  await dispatch({ type: 'TODAY_PATCH', patch: {
    coinsUnminted: bucket,
    pointsRuntime: Math.max(0, (s.today.pointsRuntime || 0) + pointsNegative)
  }});

  const rebuilt = rebuildFromLedger(getState());
  await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });

  return { ok: true };
}

/** Locate last positive award for a subject today (for undo) */
function findLastPositiveFor(state, type, subjectId, day) {
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== day) continue;
    if (e.type !== type) continue;
    if (e.subjectId !== subjectId) continue;
    if ((e.pointsDelta || 0) > 0) return e;
  }
  return null;
}

/** After all other multipliers, apply Power Hour (1.5×) and clamp/round */
function applyBoost(base, state) {
  let x = base;
  if (isPowerHourActive(state)) x = x * 1.5;
  x = Math.round(x);
  if (x < 1) x = 1;
  return x;
}
