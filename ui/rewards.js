// /ui/rewards.js
// Coins drawer: shows balance, buy Power Hour (1 coin), and coin history.

import { getState, dispatch, subscribe } from '../core/store.js';
import { newEntry, rebuildFromLedger } from '../core/ledger.js';
import { startPowerHour } from '../engines/engine-coins.js';
import { closeSheet, toast } from './modals.js';

const drawer = document.getElementById('drawer-rewards');

// Ensure a body container exists
let body = drawer.querySelector('.drawer-body');
if (!body) {
  body = document.createElement('div');
  body.className = 'drawer-body';
  drawer.appendChild(body);
}

// Render on open + on state changes if drawer is open
render();
subscribe(() => {
  if (drawer.classList.contains('open') && !drawer.hidden) render();
});

// Also re-render every second for Power Hour countdown while open
setInterval(() => {
  if (drawer.classList.contains('open') && !drawer.hidden) render();
}, 1000);

function render() {
  const s = getState();
  if (!s) return;

  body.innerHTML = '';

  const coins = getCoins(s);
  const unminted = s.today?.coinsUnminted || 0;

  // Header stats
  body.appendChild(kv('Coins', String(coins)));
  body.appendChild(kv('Unminted points bucket', `${unminted|0} / ${s.settings.pointsPerCoin || 100}`));

  // Power Hour card
  body.appendChild(powerHourCard(s, coins));

  // History
  body.appendChild(historySection(s));
}

/* ====== UI parts ====== */
function kv(label, value) {
  const card = document.createElement('div');
  card.className = 'card';
  const row = document.createElement('div');
  row.className = 'row between';
  const l = document.createElement('div'); l.className = 'title'; l.textContent = label;
  const r = document.createElement('div'); r.className = 'header-big'; r.textContent = value;
  row.append(l, r);
  card.appendChild(row);
  return card;
}

function powerHourCard(s, coinsAvail) {
  const c = document.createElement('div');
  c.className = 'card';
  const title = document.createElement('div'); title.className = 'title'; title.textContent = 'Power Hour';
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = '1 coin — 60 min of 1.5× points';
  c.append(title, meta);

  const row = document.createElement('div'); row.className = 'row between'; c.appendChild(row);

  const left = document.createElement('div');

  const active = isPowerHourActive(s);
  const status = document.createElement('div'); status.className = 'pill';
  status.textContent = active ? `Active · ${countdown(s.today.powerHourEndsAt)}` : 'Inactive';
  if (active) status.classList.add('success');

  left.appendChild(status);

  const right = document.createElement('div');
  const buy = document.createElement('button');
  buy.className = 'btn primary';
  buy.innerHTML = `<svg class="icon"><use href="#i-coin"/></svg><span>Start (1 coin)</span>`;

  if (active) {
    buy.classList.remove('primary');
    buy.classList.add('ghost');
    buy.disabled = true;
    buy.textContent = 'Already active';
  } else if (coinsAvail < 1) {
    buy.classList.remove('primary');
    buy.classList.add('ghost');
    buy.disabled = true;
    buy.textContent = 'Not enough coins';
  } else {
    buy.addEventListener('click', async () => {
      const ok = await spendCoins(1, 'Power Hour (60m)');
      if (!ok) return;
      await startPowerHour(60);
      toast('Power Hour started (×1.5)', 'success');
      render();
    });
  }

  right.appendChild(buy);
  row.append(left, right);

  return c;
}

function historySection(s) {
  const wrap = document.createElement('div');
  wrap.className = 'section';
  const h = document.createElement('h3'); h.className = 'section-title'; h.textContent = 'Coin History';
  wrap.appendChild(h);

  const list = document.createElement('div'); list.className = 'list';
  wrap.appendChild(list);

  let shown = 0;
  for (let i = s.ledger.length - 1; i >= 0 && shown < 50; i--) {
    const e = s.ledger[i];
    if (!('coinsDelta' in e)) continue;
    const row = document.createElement('div'); row.className = 'card';
    const top = document.createElement('div'); top.className = 'row between';

    const left = document.createElement('div');
    const t = document.createElement('div'); t.className = 'title';
    t.textContent = e.subjectLabel || (e.type === 'mint' ? 'Coin mint' : e.type === 'purchase' ? 'Purchase' : 'Coins');
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = `${e.day || ''}`;
    left.append(t,m);

    const right = document.createElement('div'); right.className = 'header-big';
    const sign = (e.coinsDelta || 0) > 0 ? '+' : '';
    right.textContent = `${sign}${e.coinsDelta || 0}`;

    top.append(left, right);
    row.appendChild(top);
    list.appendChild(row);

    shown++;
  }

  if (shown === 0) {
    list.appendChild(simpleCard('No coin activity yet.'));
  }

  return wrap;
}

function simpleCard(text) {
  const c = document.createElement('div');
  c.className = 'card graytint';
  c.textContent = text;
  return c;
}

/* ====== Actions ====== */
async function spendCoins(amount, label) {
  const s = getState();
  const have = getCoins(s);
  if (have < amount) {
    toast('Not enough coins.', 'warn');
    return false;
  }
  const entry = newEntry({
    type: 'purchase',
    subjectId: 'coins',
    subjectLabel: label,
    pointsDelta: 0,
    coinsDelta: -Math.abs(amount),
    day: s.today.day
  });
  await dispatch({ type: 'LEDGER_APPEND', entry });

  // Rebuild summaries to reflect new coin balance
  const rebuilt = rebuildFromLedger(getState());
  await dispatch({ type: 'PROGRESS_REBUILD', progress: rebuilt.progress, coinsTotal: rebuilt.coinsTotal, streak: rebuilt.streak, bestStreak: rebuilt.bestStreak });

  return true;
}

/* ====== Helpers ====== */
function getCoins(s) {
  if (s.profile?.coins != null) return s.profile.coins|0;
  if (s.coinsTotal != null) return s.coinsTotal|0;
  // fallback: compute from ledger
  let coins = 0;
  for (const e of s.ledger) coins += e.coinsDelta || 0;
  return coins|0;
}
function isPowerHourActive(s) {
  const ends = s.today?.powerHourEndsAt;
  return !!(ends && Date.now() < ends);
}
function countdown(endsAt) {
  const ms = Math.max(0, endsAt - Date.now());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
