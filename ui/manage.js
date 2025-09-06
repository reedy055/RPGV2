// /ui/manage.js
// Manage: Habits, Recurring Task Rules, Library, Challenges/Boss settings, Core settings, Data tools.

import { getState, dispatch, subscribe, resetAll } from '../core/store.js';
import { migrateState } from '../core/db.js';
import { weekStartOf } from '../core/time.js';
import { rebuildFromLedger } from '../core/ledger.js';
import { rerollWeeklyBoss } from '../engines/engine-boss.js';
import { ensureTodayGenerated, ensureWeekBoss } from '../engines/engine-day.js';

import {
  el, clear, mount, card, btn, iconbtn, pill
} from './components.js';
import { toast, confirmDialog } from './modals.js';

const root = document.getElementById('tab-manage');

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Render on boot + state changes (when tab visible)
render();
subscribe((s, action) => {
  if (!root.classList.contains('is-active') && action?.type !== 'SET_STATE') return;
  render();
});

/* =================== RENDER =================== */
function render() {
  const s = getState();
  if (!s) return;
  clear(root);

  renderHabits(s);
  renderRules(s);
  renderLibrary(s);
  renderChallengeBossSettings(s);
  renderCoreSettings(s);
  renderDataTools(s);
}

/* =================== HABITS =================== */
function renderHabits(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Habits'));

  // Add form
  const form = habitForm();
  section.appendChild(card({ children: [form] }));

  // List
  const list = el('div', { class: 'list cards' });
  const habits = [...state.habits];
  if (habits.length === 0) {
    list.appendChild(card({ classes: 'graytint', children: 'No habits yet.' }));
  } else {
    for (const h of habits) list.appendChild(habitRow(h));
  }

  section.appendChild(list);
  mount(root, section);
}

function habitForm() {
  const wrap = el('div', { class: 'vform' });

  const fTitle = inputField('Title', 'e.g., Wake 6am');
  const fKind = selectField('Type', [
    { v: 'binary', label: 'Binary (Done/Not)' },
    { v: 'counter', label: 'Counter (X per day)' }
  ]);
  const fTarget = numberField('Target per day', 1);
  const fPoints = numberField('Points on complete', 10);
  const fDays = weekdayChips();

  // Show target only for counter
  fKind.input.addEventListener('change', () => {
    fTarget.container.style.display = fKind.input.value === 'counter' ? 'block' : 'none';
  });
  fTarget.container.style.display = 'none';

  const addBtn = btn('primary', 'Add Habit', { icon: 'plus' });
  addBtn.addEventListener('click', async () => {
    const title = fTitle.input.value.trim();
    const kind = fKind.input.value;
    const target = Math.max(1, Number(fTarget.input.value || 1));
    const pts = Math.max(1, Math.round(Number(fPoints.input.value || 1)));
    const byWeekday = fDays.getSelected();

    if (!title) return toast('Title required.', 'warn');

    const item = { title, kind, pointsOnComplete: pts, byWeekday, active: true };
    if (kind === 'counter') item.targetPerDay = target;

    await dispatch({ type: 'HABIT_ADD', item });
    toast('Habit added.', 'success');
    // Reset
    fTitle.input.value = '';
    fTarget.input.value = 1;
    fPoints.input.value = 10;
    fDays.clear();
  });

  wrap.append(fTitle.container, fKind.container, fTarget.container, fPoints.container, fDays.container, addBtn);
  return wrap;
}

function habitRow(h) {
  const c = card({});
  const left = el('div');
  left.appendChild(el('div', { class: 'title' }, h.title));
  const metaParts = [
    h.kind === 'counter' ? `Counter ${h.targetPerDay||1}/day` : 'Binary',
    `+${h.pointsOnComplete||0} pts`,
    `Days: ${formatDays(h.byWeekday)}`
  ];
  left.appendChild(el('div', { class: 'meta' }, metaParts.join(' · ')));

  const right = el('div', { class: 'row gap' });
  const tgl = btn(h.active ? 'ghost' : 'primary', h.active ? 'Disable' : 'Enable', { small: true });
  tgl.addEventListener('click', async () => {
    await dispatch({ type: 'HABIT_TOGGLE_ACTIVE', id: h.id });
  });
  const editB = iconbtn('edit', { onClick: () => quickEditHabit(h) });
  const delB  = iconbtn('trash', { onClick: async () => {
    const ok = await confirmDialog({ title: 'Delete habit?', message: `Delete “${h.title}”?` });
    if (!ok) return;
    await dispatch({ type: 'HABIT_DELETE', id: h.id });
  } });

  right.append(tgl, editB, delB);
  const row = el('div', { class: 'row between' }, [left, right]);
  c.appendChild(row);
  return c;
}

async function quickEditHabit(h) {
  const title = prompt('Title', h.title);
  if (title == null) return;
  const kind = prompt('Type (binary/counter)', h.kind);
  if (kind == null || !['binary','counter'].includes(kind)) return toast('Type must be "binary" or "counter".', 'warn');
  let target = h.targetPerDay || 1;
  if (kind === 'counter') {
    const t = prompt('Target per day (number)', String(target));
    if (t == null) return;
    target = Math.max(1, Number(t));
  }
  const pts = prompt('Points on complete', String(h.pointsOnComplete || 0));
  if (pts == null) return;
  const daysStr = prompt('Allowed weekdays (comma: 0=Sun..6=Sat)', (h.byWeekday||[]).join(','));
  if (daysStr == null) return;
  const byWeekday = daysStr.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n) && n>=0 && n<=6);

  const patch = { title: title.trim(), kind, pointsOnComplete: Math.max(1, Math.round(Number(pts))) , byWeekday };
  if (kind === 'counter') patch.targetPerDay = target; else delete patch.targetPerDay;

  await dispatch({ type: 'HABIT_EDIT', id: h.id, patch });
  toast('Habit updated.', 'success');
}

/* =================== RECURRING TASK RULES =================== */
function renderRules(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Recurring Task Rules'));

  const form = ruleForm();
  section.appendChild(card({ children: [form] }));

  const list = el('div', { class: 'list cards' });
  const rules = [...state.taskRules];
  if (rules.length === 0) {
    list.appendChild(card({ classes: 'graytint', children: 'No rules yet.' }));
  } else {
    for (const r of rules) list.appendChild(ruleRow(r));
  }

  section.appendChild(list);
  mount(root, section);
}

function ruleForm() {
  const wrap = el('div', { class: 'vform' });
  const fTitle = inputField('Title', 'e.g., Meal prep');
  const fPoints = numberField('Points', 10);
  const fDays = weekdayChips();

  const addBtn = btn('primary', 'Add Rule', { icon: 'plus' });
  addBtn.addEventListener('click', async () => {
    const title = fTitle.input.value.trim();
    const pts = Math.max(1, Math.round(Number(fPoints.input.value || 1)));
    const byWeekday = fDays.getSelected();
    if (!title) return toast('Title required.', 'warn');
    if (byWeekday.length === 0) return toast('Select at least one weekday.', 'warn');

    await dispatch({ type: 'TASK_RULE_ADD', rule: { title, points: pts, byWeekday, active: true } });
    toast('Rule added.', 'success');
    fTitle.input.value = ''; fPoints.input.value = 10; fDays.clear();
    await ensureTodayGenerated(getState());
  });

  wrap.append(fTitle.container, fPoints.container, fDays.container, addBtn);
  return wrap;
}

function ruleRow(r) {
  const c = card({});
  const left = el('div');
  left.appendChild(el('div', { class: 'title' }, r.title));
  left.appendChild(el('div', { class: 'meta' }, `+${r.points||0} pts · Days: ${formatDays(r.byWeekday)}`));

  const right = el('div', { class: 'row gap' });
  const tgl = btn(r.active ? 'ghost' : 'primary', r.active ? 'Disable' : 'Enable', { small: true });
  tgl.addEventListener('click', async () => {
    await dispatch({ type: 'TASK_RULE_TOGGLE_ACTIVE', id: r.id });
    await ensureTodayGenerated(getState());
  });
  const editB = iconbtn('edit', { onClick: () => quickEditRule(r) });
  const delB  = iconbtn('trash', { onClick: async () => {
    const ok = await confirmDialog({ title: 'Delete rule?', message: `Delete “${r.title}”?` });
    if (!ok) return;
    await dispatch({ type: 'TASK_RULE_DELETE', id: r.id });
  }});
  right.append(tgl, editB, delB);

  c.appendChild(el('div', { class: 'row between' }, [left, right]));
  return c;
}

async function quickEditRule(r) {
  const title = prompt('Title', r.title);
  if (title == null) return;
  const pts = prompt('Points', String(r.points || 0));
  if (pts == null) return;
  const daysStr = prompt('Weekdays (comma: 0=Sun..6=Sat)', (r.byWeekday||[]).join(','));
  if (daysStr == null) return;
  const byWeekday = daysStr.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n) && n>=0 && n<=6);

  await dispatch({ type: 'TASK_RULE_EDIT', id: r.id, patch: { title: title.trim(), points: Math.max(1, Math.round(Number(pts))), byWeekday } });
  toast('Rule updated.', 'success');
  await ensureTodayGenerated(getState());
}

/* =================== LIBRARY (Quick Actions) =================== */
function renderLibrary(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Library (Quick Actions)'));

  const form = libraryForm();
  section.appendChild(card({ children: [form] }));

  const list = el('div', { class: 'list cards' });
  const items = [...state.library];
  if (items.length === 0) {
    list.appendChild(card({ classes: 'graytint', children: 'No library actions yet.' }));
  } else {
    for (const it of items) list.appendChild(libraryRow(it));
  }

  section.appendChild(list);
  mount(root, section);
}

function libraryForm() {
  const wrap = el('div', { class: 'vform' });
  const fTitle = inputField('Title', 'e.g., 10-min tidy');
  const fPoints = numberField('Points', 10);
  const fCooldown = numberField('Cooldown (hours)', 0);
  const fMaxDay = numberField('Max per day', 0);
  const fDays = weekdayChips({ label: 'Allowed weekdays' });
  const fFlags = el('div', { class: 'row gap' }, [
    checkbox('Include in Daily Challenges', true),
    checkbox('Include in Weekly Boss', true),
    checkbox('Pinned', false)
  ]);
  const addBtn = btn('primary', 'Add Library Item', { icon: 'plus' });

  addBtn.addEventListener('click', async () => {
    const title = fTitle.input.value.trim();
    if (!title) return toast('Title required.', 'warn');
    const pts = Math.max(1, Math.round(Number(fPoints.input.value || 1)));
    const cooldownHours = Math.max(0, Number(fCooldown.input.value || 0));
    const maxPerDay = Math.max(0, Number(fMaxDay.input.value || 0));
    const allowedWeekdays = fDays.getSelected();
    const [incChal, incBoss, pinned] = [...fFlags.querySelectorAll('input')].map(x => x.checked);

    const item = {
      title, points: pts,
      cooldownHours: cooldownHours || undefined,
      maxPerDay: maxPerDay || undefined,
      allowedWeekdays: allowedWeekdays.length ? allowedWeekdays : undefined,
      includeInChallenges: incChal,
      includeInBoss: incBoss,
      pinned,
      active: true
    };

    await dispatch({ type: 'LIB_ITEM_ADD', item });
    toast('Library item added.', 'success');
    // Reset
    fTitle.input.value = '';
    fPoints.input.value = 10;
    fCooldown.input.value = 0;
    fMaxDay.input.value = 0;
    fDays.clear();
    fFlags.querySelectorAll('input').forEach((x,i) => x.checked = i!==2); // default: [true,true,false]
  });

  wrap.append(fTitle.container, fPoints.container, fCooldown.container, fMaxDay.container, fDays.container, fFlags, addBtn);
  return wrap;
}

function libraryRow(it) {
  const c = card({});
  const left = el('div');
  left.appendChild(el('div', { class: 'title' }, it.title));
  const mpd = it.maxPerDay ? ` · Max/day ${it.maxPerDay}` : '';
  const cd = it.cooldownHours ? ` · CD ${it.cooldownHours}h` : '';
  const days = it.allowedWeekdays?.length ? ` · Days: ${formatDays(it.allowedWeekdays)}` : '';
  const flags = [
    it.includeInChallenges !== false ? 'Chal' : null,
    it.includeInBoss !== false ? 'Boss' : null,
    it.pinned ? 'Pinned' : null
  ].filter(Boolean).join(' · ');
  left.appendChild(el('div', { class: 'meta' }, `+${it.points||0} pts${mpd}${cd}${days} ${flags ? ' · ' + flags : ''}`));

  const right = el('div', { class: 'row gap' });
  const tgl = btn(it.active ? 'ghost' : 'primary', it.active ? 'Disable' : 'Enable', { small: true });
  tgl.addEventListener('click', async () => {
    await dispatch({ type: 'LIB_ITEM_TOGGLE_ACTIVE', id: it.id });
  });
  const editB = iconbtn('edit', { onClick: () => quickEditLibrary(it) });
  const delB  = iconbtn('trash', { onClick: async () => {
    const ok = await confirmDialog({ title: 'Delete library item?', message: `Delete “${it.title}”?` });
    if (!ok) return;
    await dispatch({ type: 'LIB_ITEM_DELETE', id: it.id });
  } });
  right.append(tgl, editB, delB);

  c.appendChild(el('div', { class: 'row between' }, [left, right]));
  return c;
}

async function quickEditLibrary(it) {
  const title = prompt('Title', it.title);
  if (title == null) return;
  const pts = prompt('Points', String(it.points || 0));
  if (pts == null) return;
  const cd = prompt('Cooldown hours (0 = none)', String(it.cooldownHours || 0));
  if (cd == null) return;
  const mpd = prompt('Max per day (0 = none)', String(it.maxPerDay || 0));
  if (mpd == null) return;
  const daysStr = prompt('Allowed weekdays (comma: 0=Sun..6=Sat or empty)', (it.allowedWeekdays||[]).join(','));
  if (daysStr == null) return;

  const allowedWeekdays = (daysStr.trim().length === 0)
    ? undefined
    : daysStr.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n) && n>=0 && n<=6);

  const includeInChallenges = confirm('Include in Daily Challenges? (OK = yes / Cancel = no)') ? true : false;
  const includeInBoss = confirm('Include in Weekly Boss? (OK = yes / Cancel = no)') ? true : false;
  const pinned = confirm('Pinned? (OK = yes / Cancel = no)') ? true : false;

  const patch = {
    title: title.trim(),
    points: Math.max(1, Math.round(Number(pts))),
    cooldownHours: Math.max(0, Number(cd)) || undefined,
    maxPerDay: Math.max(0, Number(mpd)) || undefined,
    allowedWeekdays,
    includeInChallenges,
    includeInBoss,
    pinned
  };
  await dispatch({ type: 'LIB_ITEM_EDIT', id: it.id, patch });
  toast('Library updated.', 'success');
}

/* =================== CHALLENGES & BOSS SETTINGS =================== */
function renderChallengeBossSettings(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Challenges & Weekly Boss'));

  const cardWrap = card({});
  const grid = el('div', { style: 'display:grid; gap:12px;' });

  // Daily challenges
  const fCount = numberField('Daily challenges (N)', state.settings.dailyChallengesCount || 3);
  const fMult  = rangeField('Challenge points multiplier', state.settings.challengeMultiplier || 1.5, 1.0, 2.0, 0.1, v => `${v.toFixed(1)}×`);
  const saveChal = btn('primary', 'Save Daily Challenges', { icon: 'check' });
  saveChal.addEventListener('click', async () => {
    const count = Math.max(0, Math.min(10, Number(fCount.input.value || 0)));
    const mult  = clamp(Number(fMult.input.value || 1.5), 1.0, 2.0);
    await dispatch({ type: 'SETTINGS_UPDATE', patch: { dailyChallengesCount: count, challengeMultiplier: mult } });
    toast('Daily challenges settings saved.', 'success');
    await ensureTodayGenerated(getState());
  });

  // Weekly Boss
  const fTasks = numberField('Boss goals per week', state.settings.bossTasksPerWeek || 5);
  const fMin   = numberField('Min times per goal', state.settings.bossTimesMin || 2);
  const fMax   = numberField('Max times per goal', state.settings.bossTimesMax || 5);
  const saveBoss = btn('primary', 'Save Boss Settings', { icon: 'check' });
  saveBoss.addEventListener('click', async () => {
    const bossTasksPerWeek = clampInt(fTasks.input.value, 1, 10);
    const bossTimesMin = clampInt(fMin.input.value, 1, 14);
    const bossTimesMax = clampInt(fMax.input.value, bossTimesMin, 14);
    await dispatch({ type: 'SETTINGS_UPDATE', patch: { bossTasksPerWeek, bossTimesMin, bossTimesMax } });
    toast('Weekly Boss settings saved. Takes effect next week (or reroll).', 'success');
  });

  const rerollBtn = btn('ghost', 'Reroll this week', { icon: 'dice', small: false });
  const penalty = bossPenaltyText(state);
  const penaltyPill = pill(penalty, { classes: 'muted' });
  rerollBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reroll Weekly Boss?',
      message: 'Reroll picks new goals and increases the point penalty for this week.'
    });
    if (!ok) return;
    const next = rerollWeeklyBoss(getState());
    if (!next) return toast('No boss to reroll.', 'warn');
    await dispatch({ type: 'BOSS_REROLL', payload: next });
    toast('Boss rerolled. Penalty increased.', 'success');
  });

  grid.append(
    fCount.container, fMult.container, saveChal,
    el('div', { class: 'meta' }, '—'),
    fTasks.container, el('div', { class: 'row gap' }, [fMin.container, fMax.container]),
    el('div', { class: 'row gap between' }, [saveBoss, el('div', { class:'row gap' }, [penaltyPill, rerollBtn])])
  );

  cardWrap.appendChild(grid);
  section.appendChild(cardWrap);
  mount(root, section);
}

function bossPenaltyText(state) {
  const rr = state.weeklyBoss?.rerolls || 0;
  const mult = Math.max(0.7, 1 - 0.1 * rr);
  return `Penalty: ×${mult.toFixed(2)} (rerolls ${rr})`;
}

/* =================== CORE SETTINGS =================== */
function renderCoreSettings(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Core Settings'));

  const cardWrap = card({});
  const grid = el('div', { class: 'vform' });

  const fGoal = numberField('Daily goal (points)', state.settings.dailyGoal || 60);
  const fRate = numberField('Points per coin', state.settings.pointsPerCoin || 100);

  const save = btn('primary', 'Save Settings', { icon: 'check' });
  save.addEventListener('click', async () => {
    const dailyGoal = Math.max(0, Number(fGoal.input.value || 0));
    const pointsPerCoin = Math.max(1, Number(fRate.input.value || 100));
    await dispatch({ type: 'SETTINGS_UPDATE', patch: { dailyGoal, pointsPerCoin } });
    toast('Settings saved.', 'success');
  });

  grid.append(fGoal.container, fRate.container, save);
  cardWrap.appendChild(grid);
  section.appendChild(cardWrap);
  mount(root, section);
}

/* =================== DATA TOOLS =================== */
function renderDataTools(state) {
  const section = el('div', { class: 'section' });
  section.appendChild(el('h3', { class: 'section-title' }, 'Data'));

  const wrap = card({});
  const row1 = el('div', { class: 'row gap' }, [
    btn('primary', 'Export JSON', { icon: 'download', onclick: exportJson }),
    fileImportButton()
  ]);

  const row2 = el('div', { class: 'row gap' }, [
    btn('ghost', 'Rebuild summaries', { icon: 'refresh', onclick: async () => {
      const s = getState();
      const rebuilt = rebuildFromLedger(s);
      await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });
      toast('Summaries rebuilt from ledger.', 'success');
    }}),
    btn('danger', 'Wipe all data', { icon: 'trash', onclick: async () => {
      const ok = await confirmDialog({ title: 'Wipe ALL data?', message: 'This resets the app to first run. You will lose everything.' });
      if (!ok) return;
      await resetAll();
      await ensureTodayGenerated(getState());
      await ensureWeekBoss(getState());
      toast('All data wiped.', 'success');
    }})
  ]);

  wrap.append(row1, el('div', { class: 'meta' }, 'Import replaces your full state (we migrate automatically).'), row2);
  section.appendChild(wrap);
  mount(root, section);
}

function exportJson() {
  try {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `life-rpg-state-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    toast('Export failed.', 'warn');
  }
}

function fileImportButton() {
  const importBtn = btn('ghost', 'Import JSON', { icon: 'upload' });
  const input = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
  importBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const migrated = migrateState(parsed);
      await dispatch({ type: 'SET_STATE', value: migrated });
      await ensureTodayGenerated(getState());
      await ensureWeekBoss(getState());
      toast('Import successful.', 'success');
    } catch (e) {
      console.error(e);
      toast('Import failed. Invalid JSON.', 'warn');
    } finally {
      input.value = '';
    }
  });
  const wrap = el('div', { class: 'row gap' }, [importBtn]);
  wrap.appendChild(input);
  return wrap;
}

/* =================== UI FIELD HELPERS =================== */

function inputField(label, placeholder='') {
  const container = el('div', { class: 'field' });
  const lab = el('span', {}, label);
  const input = el('input', { type: 'text', placeholder });
  container.append(lab, input);
  return { container, input };
}
function numberField(label, value=0) {
  const container = el('div', { class: 'field' });
  const lab = el('span', {}, label);
  const input = el('input', { type: 'number', value: String(value) });
  container.append(lab, input);
  return { container, input };
}
function selectField(label, options=[]) {
  const container = el('div', { class: 'field' });
  const lab = el('span', {}, label);
  const sel = el('select', {});
  for (const { v, label: lbl } of options) {
    sel.appendChild(el('option', { value: v }, lbl));
  }
  container.append(lab, sel);
  return { container, input: sel };
}
function rangeField(label, value=1.5, min=1.0, max=2.0, step=0.1, fmt=(v)=>String(v)) {
  const container = el('div', { class: 'field' });
  const lab = el('span', {}, label);
  const row = el('div', { class: 'row between' });
  const out = el('span', { class: 'pill muted' }, fmt(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => out.textContent = fmt(Number(input.value)));
  row.append(input, out);
  container.append(lab, row);
  return { container, input, out };
}
function checkbox(label, checked=false) {
  const id = `chk_${Math.random().toString(36).slice(2,7)}`;
  const wrap = el('label', { class: 'check', for: id });
  const input = el('input', { id, type: 'checkbox' });
  input.checked = checked;
  const span = el('span', {}, label);
  wrap.append(input, span);
  // return wrap with inner input
  wrap.input = input;
  return wrap;
}

function weekdayChips({ label = 'Weekdays' } = {}) {
  const container = el('div', { class: 'field' });
  const lab = el('span', {}, label);
  const row = el('div', { class: 'weekday-chiprow' });
  for (let i=0;i<7;i++) {
    const chip = el('button', { type:'button', class: 'chip', 'data-w': String(i) }, WEEKDAYS[i]);
    chip.addEventListener('click', () => chip.classList.toggle('is-active'));
    row.appendChild(chip);
  }
  container.append(lab, row);

  function getSelected() {
    return [...row.querySelectorAll('.chip.is-active')].map(c => Number(c.getAttribute('data-w')));
  }
  function clear() {
    row.querySelectorAll('.chip.is-active').forEach(c => c.classList.remove('is-active'));
  }
  function setSelected(arr = []) {
    clear();
    arr.forEach(i => {
      const chip = row.querySelector(`.chip[data-w="${i}"]`);
      if (chip) chip.classList.add('is-active');
    });
  }
  return { container, row, getSelected, clear, setSelected };
}

function formatDays(byWeekday = []) {
  if (!byWeekday || byWeekday.length === 0) return '—';
  return byWeekday.map(i => WEEKDAYS[i]).join(',');
}

/* =================== small utils =================== */
function clamp(v,min,max){ return Math.max(min, Math.min(max, Number(v))); }
function clampInt(v,min,max){ return Math.max(min, Math.min(max, Math.round(Number(v||0)))); }
