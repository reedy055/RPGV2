// /ui/app.js
// App boot, navigation, global sheets, FAB (Quick Actions + New Task), heartbeat, toasts.

import { ready, getState, subscribe, dispatch } from '../core/store.js';
import { todayKey, weekdayIndex, nowTs } from '../core/time.js';
import { dayHeartbeat, ensureTodayGenerated, ensureWeekBoss } from '../engines/engine-day.js';
import { awardLibraryTap, undoLastFor, startPowerHour, clearPowerHourIfExpired } from '../engines/engine-coins.js';

// ---- DOM refs ----
const tabs = {
  home: document.getElementById('tab-home'),
  calendar: document.getElementById('tab-calendar'),
  insights: document.getElementById('tab-insights'),
  manage: document.getElementById('tab-manage'),
};
const tabButtons = [...document.querySelectorAll('.tabbtn')];

const backdrop = document.getElementById('backdrop');
const sheetFab = document.getElementById('sheet-fab');
const drawerDay = document.getElementById('drawer-day');
const drawerRewards = document.getElementById('drawer-rewards');
const confirmModal = document.getElementById('confirm-modal');
const toasts = document.getElementById('toasts');

const fabBtn = document.getElementById('fab');

// FAB sheet tab controls
const fabTabButtons = [...document.querySelectorAll('[data-fabtab]')];
const fabTabQuick = document.getElementById('fabtab-quick');
const fabQuickList = document.getElementById('fab-quick-list');
const fabTabTask = document.getElementById('fabtab-task');
// FAB task form elements
const formTask = document.getElementById('fab-task-form');
const formTitle = document.getElementById('fab-task-title');
const formPoints = document.getElementById('fab-task-points');
const formDate = document.getElementById('fab-task-date');
const formRepeatToggle = document.getElementById('fab-task-repeat-toggle');
const formWeekdaysRow = document.getElementById('fab-task-weekdays');

// Close buttons (global)
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeSheet(btn.getAttribute('data-close')));
});

// ---- Navigation ----
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.getAttribute('data-tab');
    setActiveTab(name);
  });
});

function setActiveTab(name) {
  Object.entries(tabs).forEach(([k, el]) => {
    el.classList.toggle('is-active', k === name);
  });
  tabButtons.forEach(b => {
    const is = b.getAttribute('data-tab') === name;
    b.classList.toggle('is-active', is);
    b.setAttribute('aria-current', is ? 'page' : 'false');
  });
  // Persist last tab (so reopening keeps it)
  try { localStorage.setItem('lastTab', name); } catch {}
}

// ---- Sheets / Drawers ----
function openSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  backdrop.hidden = false;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
}
function closeSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => { el.hidden = true; maybeHideBackdrop(); }, 220);
}
function maybeHideBackdrop() {
  const anyOpen = [...document.querySelectorAll('.sheet')].some(s => !s.hidden && s.classList.contains('open'));
  if (!anyOpen) backdrop.hidden = true;
}
backdrop.addEventListener('click', () => {
  // Close the top-most open sheet
  const openSheets = [...document.querySelectorAll('.sheet.open')];
  if (openSheets.length) {
    const last = openSheets[openSheets.length - 1];
    closeSheet(last.id);
  }
});

// ---- Toasts ----
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

// ---- Confirm modal ----
function confirmDialog({ title = 'Confirm', message = 'Are you sure?' } = {}) {
  return new Promise(resolve => {
    const t = document.getElementById('confirm-title');
    const m = document.getElementById('confirm-message');
    t.textContent = title;
    m.textContent = message;
    confirmModal.returnValue = 'cancel';
    confirmModal.showModal();
    confirmModal.addEventListener('close', function onClose() {
      confirmModal.removeEventListener('close', onClose);
      resolve(confirmModal.returnValue === 'ok');
    });
  });
}

// ======================================================
// FAB: open, tab switching, Quick Actions, New Task form
// ======================================================

fabBtn.addEventListener('click', () => {
  // Default to Quick Actions tab
  setFabTab('quick');
  // Default date to today for New Task form
  formDate.value = todayKey(new Date());
  // Reset form
  formTitle.value = '';
  formPoints.value = 10;
  formRepeatToggle.checked = false;
  toggleWeekdayRow(false);
  // Render Quick list
  renderFabQuickList();
  openSheet('sheet-fab');
});

// toggle FAB tabs
fabTabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-fabtab');
    setFabTab(target);
  });
});
function setFabTab(name) {
  fabTabButtons.forEach(b => {
    const is = b.getAttribute('data-fabtab') === name;
    b.classList.toggle('is-active', is);
    b.setAttribute('aria-selected', is ? 'true' : 'false');
  });
  fabTabQuick.classList.toggle('is-active', name === 'quick');
  fabTabTask.classList.toggle('is-active', name === 'task');
}

// Weekdays chips (Sun..Sat)
const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function buildWeekdayChips() {
  formWeekdaysRow.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = weekdayNames[i];
    chip.dataset.w = String(i);
    chip.addEventListener('click', () => {
      chip.classList.toggle('is-active');
    });
    formWeekdaysRow.appendChild(chip);
  }
}
buildWeekdayChips();

formRepeatToggle.addEventListener('change', (e) => {
  toggleWeekdayRow(e.target.checked);
});
function toggleWeekdayRow(show) {
  formWeekdaysRow.setAttribute('aria-hidden', show ? 'false' : 'true');
  formWeekdaysRow.style.display = show ? 'flex' : 'none';
}

// New Task submit
formTask.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = formTitle.value.trim();
  const points = Math.max(1, Math.round(Number(formPoints.value || 0)));
  const day = formDate.value || todayKey(new Date());
  if (!title || !points) return;

  const repeat = formRepeatToggle.checked;
  if (repeat) {
    const selected = [...formWeekdaysRow.querySelectorAll('.chip.is-active')].map(x => Number(x.dataset.w));
    if (selected.length === 0) {
      toast('Choose at least one weekday for repeat.', 'warn');
      return;
    }
    // Add the rule
    await dispatch({ type: 'TASK_RULE_ADD', rule: { title, points, byWeekday: selected, active: true } });
    // If the chosen date's weekday is within selection, also create instance for that day
    const w = weekdayIndex(day);
    if (selected.includes(w)) {
      await dispatch({ type: 'TASK_INSTANCE_ADD', instance: { title, points, day, done: false } });
    }
    toast('Recurring task added.', '');
  } else {
    // One-off instance for the chosen day
    await dispatch({ type: 'TASK_INSTANCE_ADD', instance: { title, points, day, done: false } });
    toast('Task added for the day.', '');
  }

  // Ensure today's items/challenges are generated if needed
  await ensureTodayGenerated(getState());

  // Close
  closeSheet('sheet-fab');
});

// Render Quick Actions list from Library with cooldown & max/day
function renderFabQuickList() {
  const s = getState();
  if (!s) return;
  const items = [...s.library].filter(x => x.active);

  // Sort: pinned first, then recently used (lastDoneAt desc), then A-Z
  items.sort((a,b) => {
    const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a.lastDoneAt ? Number(a.lastDoneAt) : 0;
    const bt = b.lastDoneAt ? Number(b.lastDoneAt) : 0;
    if (at !== bt) return bt - at;
    return a.title.localeCompare(b.title);
  });

  fabQuickList.innerHTML = '';

  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'card';

    const row = document.createElement('div');
    row.className = 'row between';
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `+${it.points || 0} pts`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn small primary';
    btn.innerHTML = `<svg class="icon"><use href="#i-plus"/></svg>Use`;

    // throttle checks
    const throttle = checkLibraryThrottle(it, s);
    if (throttle.blocked) {
      btn.classList.remove('primary');
      btn.classList.add('ghost');
      btn.disabled = true;
      btn.textContent = throttle.reason; // "Cooling 23m" or "Max 3/3"
      meta.textContent = throttle.metaLabel; // show points too: "+12 pts · cooling"
    }

    btn.addEventListener('click', async () => {
      const s0 = getState();
      const th = checkLibraryThrottle(it, s0);
      if (th.blocked) return;

      btn.disabled = true;
      try {
        await awardLibraryTap(it);
        // update lastDoneAt
        await dispatch({ type: 'LIB_ITEM_EDIT', id: it.id, patch: { lastDoneAt: nowTs() } });
        toast(`+${it.points} pts — ${it.title}`, 'success');
      } catch (e) {
        console.error(e);
        toast('Failed to award. Try again.', 'warn');
      } finally {
        btn.disabled = false;
        renderFabQuickList();
      }
    });

    right.appendChild(btn);
    row.appendChild(left);
    row.appendChild(right);

    card.appendChild(row);
    fabQuickList.appendChild(card);
  }
}

function checkLibraryThrottle(item, state) {
  const now = Date.now();

  // Cooldown
  if (item.cooldownHours && item.lastDoneAt) {
    const readyAt = Number(item.lastDoneAt) + item.cooldownHours * 3600000;
    if (now < readyAt) {
      const rem = readyAt - now;
      const minutes = Math.ceil(rem / 60000);
      return {
        blocked: true,
        reason: `Cooling ${minutes}m`,
        metaLabel: `+${item.points} pts · cooling`
      };
    }
  }
  // Max per day
  if (item.maxPerDay && item.maxPerDay > 0) {
    const day = getState().today.day;
    const count = countTodayLibraryUses(state, item.id, day);
    if (count >= item.maxPerDay) {
      return {
        blocked: true,
        reason: `Max ${item.maxPerDay}/${item.maxPerDay}`,
        metaLabel: `+${item.points} pts · maxed`
      };
    }
  }
  return { blocked: false, reason: '', metaLabel: `+${item.points} pts` };
}

function countTodayLibraryUses(state, id, day) {
  let c = 0;
  for (let i = state.ledger.length - 1; i >= 0; i--) {
    const e = state.ledger[i];
    if (e.day !== day) break; // stop once we move beyond today (ledger is chronological)
    if (e.type === 'library' && e.subjectId === id && (e.pointsDelta || 0) > 0) c++;
  }
  return c;
}

// Keep FAB quick list updated on state changes
subscribe((s, action) => {
  // Update active tab button when we render different sections later (placeholder)
  if (sheetFab && !sheetFab.hidden && action && action.type) {
    // refresh quick list on any state change while sheet open
    renderFabQuickList();
  }
});

// ======================================================
// Boot & heartbeat
// ======================================================

(async function boot() {
  await ready; // wait for store/bootstrap
  // Initial tab (persisted)
  const last = (localStorage.getItem('lastTab') || 'home');
  setActiveTab(last);

  // Prepare today's generation & boss
  await dayHeartbeat();
  await ensureTodayGenerated(getState());
  await ensureWeekBoss(getState());
  await clearPowerHourIfExpired();

  // Initialize default date in FAB task form
  formDate.value = todayKey(new Date());

  // Heartbeat every 60s
  setInterval(async () => {
    await dayHeartbeat();
    await clearPowerHourIfExpired();
    await dispatch({ type: 'APP_TICK' });
  }, 60000);

  // Minor 1s tick for countdown labels to feel alive (optional)
  setInterval(() => {
    if (!sheetFab.hidden && sheetFab.classList.contains('open')) {
      // Re-render countdown labels (cooldowns)
      renderFabQuickList();
    }
  }, 1000);

  // SW register (best-effort; file lands later)
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: './' });
    } catch (e) {
      // ignore during early dev
    }
  }

  // Expose tiny debug helpers
  window.App = {
    openRewards: () => openSheet('drawer-rewards'),
    toast, confirmDialog
  };
})();

// ======================================================
// Placeholder renderers (until we add /ui/home.js, /ui/calendar.js, etc.)
// They avoid crashes and show a simple skeleton.
// ======================================================
function ensurePlaceholderContent() {
  if (tabs.home && tabs.home.childElementCount === 0) {
    tabs.home.innerHTML = `
      <div class="header-card" style="margin-top:12px;">
        <div class="header-title">Today</div>
        <div class="header-big">0 pts</div>
        <div class="goalbar"><div class="fill" style="width:0%"></div></div>
        <div class="row gap" style="margin-top:10px;">
          <span class="pill"><svg class="icon"><use href="#i-streak"/></svg>&nbsp;<span>Streak 0</span></span>
          <button class="pill" onclick="App.openRewards()"><svg class="icon"><use href="#i-coin"/></svg>&nbsp;<span>Coins</span></button>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">Getting started</h3>
        <div class="card">
          Use the <b>+</b> button to add a task or fire a Quick Action. Manage habits, library, and settings under <b>Manage</b>.
        </div>
      </div>`;
  }
  if (tabs.calendar && tabs.calendar.childElementCount === 0) {
    tabs.calendar.innerHTML = `
      <div class="section"><h3 class="section-title">Calendar</h3>
        <div class="card">Calendar UI will appear here in the next files.</div>
      </div>`;
  }
  if (tabs.insights && tabs.insights.childElementCount === 0) {
    tabs.insights.innerHTML = `
      <div class="section"><h3 class="section-title">Insights</h3>
        <div class="card">Charts and milestones will appear here.</div>
      </div>`;
  }
  if (tabs.manage && tabs.manage.childElementCount === 0) {
    tabs.manage.innerHTML = `
      <div class="section"><h3 class="section-title">Manage</h3>
        <div class="card">Rules, Library, Settings, and Data live here. Coming up next.</div>
      </div>`;
  }
}
ensurePlaceholderContent();

// Keep placeholders from flickering away on hot reload
subscribe(() => ensurePlaceholderContent());
