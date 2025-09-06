// /core/store.js
// Single-source-of-truth store with reducer + persistence.
// Bootstraps state from IndexedDB and exposes a ready() promise.

import { loadState, saveState, wipeAll, migrateState } from './db.js';
import { todayKey, weekStartOf, nowTs } from './time.js';
import { mulberry32, hashString } from './seeds.js';

let _state = null;
const _subs = new Set();
const _seenActionIds = new Set();
let _bootResolve;
export const ready = new Promise(res => (_bootResolve = res));

/** ---- Public API ---- **/
export function getState() { return _state; }

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export async function dispatch(action) {
  if (!action || typeof action !== 'object') return;
  if (!action.type) throw new Error('Action missing type');

  // de-dup (idempotent UI taps)
  const aid = action.actionId || `${action.type}:${action.id || ''}:${action.ts || ''}`;
  if (_seenActionIds.has(aid)) return;
  _seenActionIds.add(aid);

  const prev = _state;
  const next = reducer(prev, action);

  // Persist + publish
  _state = next;
  await saveState(_state);
  for (const fn of _subs) try { fn(_state, action, prev); } catch (e) { console.error(e); }
}

/** Reset (nuclear) */
export async function resetAll() {
  await wipeAll();
  await bootstrap(true);
}

/** ---- Boot ---- **/
export async function bootstrap(forceFresh = false) {
  let state = forceFresh ? null : await loadState();

  if (!state) {
    state = seedInitialState();
  }

  const migrated = migrateState(state); // may bump schema
  _state = migrated;
  await saveState(_state);
  _bootResolve?.(_state);
  return _state;
}

/** ---- Reducer ---- **/
function reducer(state, action) {
  // Always work with a shallow clone at root (we keep nested updates explicit)
  let s = structuredClone(state);

  switch (action.type) {
    case 'SET_STATE':
      return structuredClone(action.value);

    case 'SETTINGS_UPDATE': {
      s.settings = { ...s.settings, ...action.patch };
      return s;
    }

    case 'PROFILE_PATCH': {
      s.profile = { ...s.profile, ...action.patch };
      return s;
    }

    case 'APP_TICK': {
      // runtime tick (e.g., timer, countdowns). Keep cheap here.
      s.now = nowTs();
      return s;
    }

    // ===== CRUD: HABITS =====
    case 'HABIT_ADD': {
      s.habits.push(withId({ ...action.item, active: true }));
      return s;
    }
    case 'HABIT_EDIT': {
      const i = s.habits.findIndex(h => h.id === action.id);
      if (i >= 0) s.habits[i] = { ...s.habits[i], ...action.patch };
      return s;
    }
    case 'HABIT_TOGGLE_ACTIVE': {
      const i = s.habits.findIndex(h => h.id === action.id);
      if (i >= 0) s.habits[i].active = !s.habits[i].active;
      return s;
    }
    case 'HABIT_DELETE': {
      s.habits = s.habits.filter(h => h.id !== action.id);
      return s;
    }

    // ===== CRUD: TASK RULES & INSTANCES =====
    case 'TASK_RULE_ADD': {
      s.taskRules.push(withId({ ...action.rule, active: true }));
      return s;
    }
    case 'TASK_RULE_EDIT': {
      const i = s.taskRules.findIndex(r => r.id === action.id);
      if (i >= 0) s.taskRules[i] = { ...s.taskRules[i], ...action.patch };
      return s;
    }
    case 'TASK_RULE_TOGGLE_ACTIVE': {
      const i = s.taskRules.findIndex(r => r.id === action.id);
      if (i >= 0) s.taskRules[i].active = !s.taskRules[i].active;
      return s;
    }
    case 'TASK_RULE_DELETE': {
      s.taskRules = s.taskRules.filter(r => r.id !== action.id);
      return s;
    }

    case 'TASK_INSTANCE_ADD': {
      // Manual one-off or generated instance for a date
      s.taskInstances.push(withId({ ...action.instance, done: !!action.instance?.done }));
      return s;
    }
    case 'TASK_INSTANCE_EDIT': {
      const i = s.taskInstances.findIndex(t => t.id === action.id);
      if (i >= 0) s.taskInstances[i] = { ...s.taskInstances[i], ...action.patch };
      return s;
    }
    case 'TASK_INSTANCE_DELETE': {
      s.taskInstances = s.taskInstances.filter(t => t.id !== action.id);
      return s;
    }

    // ===== LIBRARY (Quick Actions) =====
    case 'LIB_ITEM_ADD': {
      s.library.push(withId({ ...action.item, active: true }));
      return s;
    }
    case 'LIB_ITEM_EDIT': {
      const i = s.library.findIndex(x => x.id === action.id);
      if (i >= 0) s.library[i] = { ...s.library[i], ...action.patch };
      return s;
    }
    case 'LIB_ITEM_TOGGLE_ACTIVE': {
      const i = s.library.findIndex(x => x.id === action.id);
      if (i >= 0) s.library[i].active = !s.library[i].active;
      return s;
    }
    case 'LIB_ITEM_DELETE': {
      s.library = s.library.filter(x => x.id !== action.id);
      return s;
    }

    // ===== CHALLENGE / BOSS ASSIGNMENTS =====
    case 'ASSIGN_DAILY_CHALLENGES': {
      const { day, ids, snapshot } = action.payload;
      if (!s.dailyAssignments) s.dailyAssignments = {};
      s.dailyAssignments[day] = { challengeIds: ids, snapshot };
      return s;
    }
    case 'INIT_WEEKLY_BOSS': {
      s.weeklyBoss = { ...action.payload, completed: false, rerolls: 0 };
      return s;
    }
    case 'BOSS_REROLL': {
      if (!s.weeklyBoss) return s;
      s.weeklyBoss = { ...action.payload };
      return s;
    }

    // ===== LEDGER & PROGRESS =====
    case 'LEDGER_APPEND': {
      // Expect action.entry already normalized (pointsDelta/coinsDelta ints)
      s.ledger.push(withId({ ...action.entry }));
      return s;
    }
    case 'LEDGER_REPLACE_ALL': {
      s.ledger = structuredClone(action.entries || []);
      return s;
    }
    case 'PROGRESS_REBUILD': {
      s.progress = structuredClone(action.progress || {});
      s.profile = { ...s.profile, coins: action.coinsTotal ?? s.profile.coins };
      s.streak = { ...s.streak, current: action.streak?.current ?? s.streak.current };
      if (typeof action.bestStreak === 'number') s.profile.bestStreak = action.bestStreak;
      return s;
    }

    // ===== TODAY RUNTIME PATCH =====
    case 'TODAY_PATCH': {
      s.today = { ...s.today, ...action.patch };
      return s;
    }

    default:
      return s;
  }
}

/** ---- Helpers ---- */
function withId(obj) {
  if (!obj.id) obj.id = crypto?.randomUUID?.() || (`id_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  if (!obj.ts) obj.ts = nowTs();
  return obj;
}

/** ---- First-run seed ---- */
function seedInitialState() {
  const day = todayKey();
  const weekStartDay = weekStartOf(new Date());

  return {
    schema: 2,
    now: nowTs(),
    settings: {
      dailyGoal: 60,
      pointsPerCoin: 100,
      dailyChallengesCount: 3,
      challengeMultiplier: 1.5, // 1.0 – 2.0
      bossTasksPerWeek: 5,
      bossTimesMin: 2,
      bossTimesMax: 5
    },
    profile: { coins: 0, bestStreak: 0 },
    streak: { current: 0 },
    today: { day, pointsRuntime: 0, coinsUnminted: 0, habitsStatus: {} },

    habits: [
      { id: 'h-wake', title: 'Wake 6am', kind: 'binary', pointsOnComplete: 15, byWeekday: [1,2,3,4,5], active: true },
      { id: 'h-water', title: 'Water', kind: 'counter', targetPerDay: 3, pointsOnComplete: 10, byWeekday: [0,1,2,3,4,5,6], active: true }
    ],
    taskRules: [
      { id: 'r-mealprep', title: 'Meal prep', points: 20, byWeekday: [0], active: true } // Sundays
    ],
    taskInstances: [],
    library: [
      { id:'l-tidy', title:'10-min tidy', points:10, cooldownHours:1, includeInChallenges:true, includeInBoss:true, active:true, pinned:true },
      { id:'l-classq', title:'Ask a Q in class', points:15, allowedWeekdays:[1,2,3,4,5], includeInChallenges:true, includeInBoss:true, active:true },
      { id:'l-walk', title:'Walk 15 min', points:12, cooldownHours:2, includeInChallenges:true, includeInBoss:true, active:true },
      { id:'l-read', title:'Read 10 pages', points:12, maxPerDay:1, includeInChallenges:true, includeInBoss:true, active:true }
    ],
    challenges: [],

    dailyAssignments: { }, // day -> {challengeIds, snapshot}
    weeklyBoss: {
      weekStartDay,
      goals: [], // filled by engine-boss
      rerolls: 0,
      completed: false
    },

    ledger: [],
    progress: {}
  };
}

// auto-boot if imported by app.js
bootstrap();
