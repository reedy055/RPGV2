// /core/time.js
// Local time helpers (day keys, week starts, stamps). Monday-week.

export function todayKey(d = new Date()) {
  // Use local time; format YYYY-MM-DD
  const y = d.getFullYear();
  const m = `${d.getMonth()+1}`.padStart(2,'0');
  const day = `${d.getDate()}`.padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export function weekStartOf(d = new Date()) {
  // Monday = 1
  const dd = new Date(d);
  const day = dd.getDay(); // 0..6 (Sun..Sat)
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  dd.setDate(dd.getDate() + diff);
  return todayKey(dd);
}

export function isBeforeToday(dayKeyStr) {
  const t = todayKey();
  return dayKeyStr < t;
}

export function isSameDay(a, b) {
  return a === b;
}

export function nowTs() {
  return Date.now();
}

export function addDays(dayKeyStr, n) {
  const [y,m,d] = dayKeyStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + n);
  return todayKey(dt);
}

export function weekdayIndex(dayKeyStr) {
  const [y,m,d] = dayKeyStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return dt.getDay(); // 0..6
}

export function daysBetween(aKey, bKey) {
  const [ay,am,ad] = aKey.split('-').map(Number);
  const [by,bm,bd] = bKey.split('-').map(Number);
  const a = new Date(ay, am-1, ad);
  const b = new Date(by, bm-1, bd);
  return Math.round((b - a) / 86400000);
}
