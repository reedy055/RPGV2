// /core/store.js
// Central reactive store + reducer, with local persistence.

import { loadState, saveState, migrateState } from './db.js';
import { todayKey } from './time.js';

let state = migrateState(loadState() || undefined);
let listeners = [];

export const ready = Promise.resolve(); // simple ready flag for now

export function getState() { return state; }
export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(f => f !== fn); };
}
function emit(action) { for (const fn of listeners) try { fn(state, action); } catch {} }

export async function dispatch(action) {
  // reducer
  switch (action.type) {
    case 'SET_STATE': {
      state = migrateState(action.value);
      break;
    }
    case 'TODAY_PATCH': {
      state.today = { ...state.today, ...(action.patch || {}) };
      break;
    }
    case 'LEDGER_APPEND': {
      state.ledger = state.ledger.concat([action.entry]);
      break;
    }
    // ===== Tasks (instances) =====
    case 'TASK_INSTANCE_ADD': {
      const inst = { id: genId('ti'), done: false, ...(action.instance || {}) };
      state.taskInstances = state.taskInstances.concat([inst]);
      break;
    }
    case 'TASK_INSTANCE_EDIT': {
      const { id, patch } = action;
      state.taskInstances = state.taskInstances.map(t => t.id === id ? { ...t, ...patch } : t);
      break;
    }
    case 'TASK_INSTANCE_DELETE': {
      const { id } = action;
      state.taskInstances = state.taskInstances.filter(t => t.id !== id);
      break;
    }
    // ===== Task Rules =====
    case 'TASK_RULE_ADD': {
      const rule = { id: genId('tr'), active: true, ...(action.rule || {}) };
      state.taskRules = state.taskRules.concat([rule]);
      break;
    }
    case 'TASK_RULE_EDIT': {
      const { id, patch } = action;
      state.taskRules = state.taskRules.map(r => r.id === id ? { ...r, ...patch } : r);
      break;
    }
    case 'TASK_RULE_DELETE': {
      const { id } = action;
      state.taskRules = state.taskRules.filter(r => r.id !== id);
      // Optional: also remove orphan instances? We keep instances for existing days.
      break;
    }
    case 'TASK_RULE_TOGGLE_ACTIVE': {
      const { id } = action;
      state.taskRules = state.taskRules.map(r => r.id === id ? { ...r, active: !r.active } : r);
      break;
    }
    // ===== Habits =====
    case 'HABIT_ADD': {
      const item = { id: genId('hb'), active: true, ...(action.item || {}) };
      state.habits = state.habits.concat([item]);
      break;
    }
    case 'HABIT_EDIT': {
      const { id, patch } = action;
      state.habits = state.habits.map(h => h.id === id ? { ...h, ...patch } : h);
      break;
    }
    case 'HABIT_DELETE': {
      const { id } = action;
      state.habits = state.habits.filter(h => h.id !== id);
      break;
    }
    case 'HABIT_TOGGLE_ACTIVE': {
      const { id } = action;
      state.habits = state.habits.map(h => h.id === id ? { ...h, active: !h.active } : h);
      break;
    }
    // ===== Library =====
    case 'LIB_ITEM_ADD': {
      const it = { id: genId('li'), active: true, ...(action.item || {}) };
      state.library = state.library.concat([it]);
      break;
    }
    case 'LIB_ITEM_EDIT': {
      const { id, patch } = action;
      state.library = state.library.map(it => it.id === id ? { ...it, ...patch } : it);
      break;
    }
    case 'LIB_ITEM_DELETE': {
      const { id } = action;
      state.library = state.library.filter(it => it.id !== id);
      break;
    }
    case 'LIB_ITEM_TOGGLE_ACTIVE': {
      const { id } = action;
      state.library = state.library.map(it => it.id === id ? { ...it, active: !it.active } : it);
      break;
    }
    // ===== Daily Challenges =====
    case 'ASSIGN_DAILY_CHALLENGES': {
      const { day, ids, snapshot } = action.payload;
      state.dailyAssignments = { ...(state.dailyAssignments || {}) };
      state.dailyAssignments[day] = { challengeIds: ids.slice(), snapshot: { ...snapshot } };
      break;
    }
    // ===== Weekly Boss =====
    case 'INIT_WEEKLY_BOSS': {
      state.weeklyBoss = action.payload;
      break;
    }
    case 'BOSS_REROLL': {
      state.weeklyBoss = action.payload;
      break;
    }
    // ===== Recomputed summaries =====
    case 'PROGRESS_REBUILD': {
      state.progress = action.progress || {};
      state.coinsTotal = action.coinsTotal || 0;
      state.streak = action.streak || { current: 0 };
      // mirror for UI bits that read profile.*
      state.profile = state.profile || {};
      state.profile.coins = state.coinsTotal|0;
      state.profile.bestStreak = action.bestStreak || 0;
      break;
    }
    // ===== Misc =====
    case 'APP_TICK':
      // no-op heartbeat
      break;

    default:
      console.warn('Unknown action', action);
  }

  saveState(state);
  emit(action);
}

export async function resetAll() {
  state = migrateState(undefined);
  saveState(state);
  emit({ type: 'SET_STATE' });
}

/* ===== Utils ===== */
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
}
