// /core/time.js
// Day keys, weekday indices, week start, safe addDays.

export function todayKey(d = new Date()) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dayOrKey, n) {
  const dt = typeof dayOrKey === 'string' ? parseKey(dayOrKey) : new Date(dayOrKey);
  dt.setDate(dt.getDate() + n);
  return todayKey(dt);
}

export function weekdayIndex(dayOrKey = new Date()) {
  const dt = typeof dayOrKey === 'string' ? parseKey(dayOrKey) : new Date(dayOrKey);
  // 0=Sun..6=Sat (matches UI chips)
  return dt.getDay();
}

export function weekStartOf(d = new Date()) {
  const dt = new Date(d);
  // Start week on Monday
  const day = (dt.getDay() + 6) % 7; // 0=Mon..6=Sun
  dt.setDate(dt.getDate() - day);
  return todayKey(dt);
}

export function nowTs() { return Date.now(); }

function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
