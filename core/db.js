// /core/db.js
// Minimal IndexedDB KV wrapper + state migrations.

const DB_NAME = 'life-rpg';
const DB_VERSION = 2; // bump if changing stores

let _db;

/** Open DB (singleton) */
async function openDb() {
  if (_db) return _db;

  _db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // simple KV store: key -> any
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  _db.onversionchange = () => {
    _db.close();
    // Let the app reload to new version on next interaction
  };
  return _db;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const res = fn(store);
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

/** KV helpers */
export async function kvGet(key) {
  return await tx('kv', 'readonly', (store) => new Promise((res, rej) => {
    const r = store.get(key);
    r.onsuccess = () => res(r.result?.value ?? null);
    r.onerror = () => rej(r.error);
  }));
}
export async function kvSet(key, value) {
  return await tx('kv', 'readwrite', (store) => store.put({ key, value }));
}
export async function kvDel(key) {
  return await tx('kv', 'readwrite', (store) => store.delete(key));
}
export async function kvClearAll() {
  return await tx('kv', 'readwrite', (store) => store.clear());
}

/** State helpers */
const STATE_KEY = 'state-v2';

export async function loadState() {
  const raw = await kvGet(STATE_KEY);
  return raw ? reviveDates(raw) : null;
}
export async function saveState(state) {
  // Strip functions and DOM references; keep plain JSON
  await kvSet(STATE_KEY, state);
}
export async function wipeAll() {
  await kvClearAll();
}

/** Migrations (schema integer in state) */
export function migrateState(state) {
  if (!state.schema) state.schema = 1;

  // v1 -> v2 (example shim). In this fresh build we mostly ensure fields exist.
  if (state.schema < 2) {
    // Ensure required branches
    state.settings = state.settings || {};
    if (state.settings.challengeMultiplier == null) state.settings.challengeMultiplier = 1.5;
    if (!Array.isArray(state.ledger)) state.ledger = [];
    if (!state.progress) state.progress = {};
    if (!state.profile) state.profile = { coins: 0, bestStreak: 0 };
    if (!state.streak) state.streak = { current: 0 };
    if (!state.today) state.today = { day: (new Date()).toISOString().slice(0,10), pointsRuntime: 0, coinsUnminted: 0, habitsStatus: {} };
    if (!state.weeklyBoss) state.weeklyBoss = { weekStartDay: (new Date()).toISOString().slice(0,10), goals: [], rerolls: 0, completed: false };

    state.schema = 2;
  }
  return state;
}

/** Convert ISO date strings back to strings (we keep them as-is for deterministic local-only) */
function reviveDates(obj) { return obj; }
