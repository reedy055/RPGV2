// /core/db.js
// Local persistence + migration.

import { todayKey } from './time.js';

const STORAGE_KEY = 'nebula.v2.state';

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function migrateState(s) {
  const today = todayKey();

  const base = {
    profile: { coins: 0, bestStreak: 0 },
    settings: {
      dailyGoal: 60,
      pointsPerCoin: 100,
      dailyChallengesCount: 3,
      challengeMultiplier: 1.5,
      bossTasksPerWeek: 5,
      bossTimesMin: 2,
      bossTimesMax: 5
    },
    today: { day: today, pointsRuntime: 0, coinsUnminted: 0, powerHourEndsAt: null, habitsStatus: {} },

    ledger: [],
    progress: {},
    streak: { current: 0 },

    taskRules: [],
    taskInstances: [],
    habits: [],
    library: [],

    dailyAssignments: {},
    weeklyBoss: null,

    coinsTotal: 0
  };

  if (!s || typeof s !== 'object') return base;

  // Merge shallowly with defaults
  const out = { ...base, ...s };
  out.profile = { ...base.profile, ...(s.profile || {}) };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  out.today = { ...base.today, ...(s.today || {}) };
  out.ledger = Array.isArray(s.ledger) ? s.ledger.slice() : [];
  out.progress = s.progress && typeof s.progress === 'object' ? { ...s.progress } : {};
  out.streak = { ...base.streak, ...(s.streak || {}) };

  out.taskRules = Array.isArray(s.taskRules) ? s.taskRules.slice() : [];
  out.taskInstances = Array.isArray(s.taskInstances) ? s.taskInstances.slice() : [];
  out.habits = Array.isArray(s.habits) ? s.habits.slice() : [];
  out.library = Array.isArray(s.library) ? s.library.slice() : [];

  out.dailyAssignments = s.dailyAssignments && typeof s.dailyAssignments === 'object' ? { ...s.dailyAssignments } : {};
  out.weeklyBoss = s.weeklyBoss || null;

  if (!out.today.day) out.today.day = today;

  // Ensure numbers
  if (typeof out.settings.pointsPerCoin !== 'number' || out.settings.pointsPerCoin < 1) out.settings.pointsPerCoin = 100;

  return out;
}
