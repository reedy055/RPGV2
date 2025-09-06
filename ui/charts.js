// /ui/charts.js
// Minimal canvas charts using CSS variables (no external libs).

/* ===== Utilities ===== */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function dprSize(canvas, w, h) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${Math.round(w)}px`;
  canvas.style.height = `${Math.round(h)}px`;
  return dpr;
}
function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,min,max){return Math.max(min, Math.min(max, v));}

/* ===== Theming ===== */
const C = () => ({
  bg: cssVar('--bg-900', '#0B0F14'),
  grid: 'rgba(255,255,255,0.08)',
  text: cssVar('--text-300', '#A8B3C2'),
  text100: cssVar('--text-100', '#E8EEF5'),
  accent: cssVar('--accent', '#3EA7FF'),
  accent2: cssVar('--accent-2', '#7C5CFF'),
  success: cssVar('--success', '#2ED573'),
});

/* ===== Public APIs ===== */

/** Weekly bars with ghost (last week faint behind) */
export function weeklyBars(canvas, thisWeek = [], lastWeek = [], { height = 160, pad = 20 } = {}) {
  const parent = canvas.closest('.chart') || canvas.parentElement;
  const width = parent?.clientWidth || 320;
  const dpr = dprSize(canvas, width - 2*8, height); // slight inner fit
  const ctx = canvas.getContext('2d');
  const theme = C();

  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas.width, H = canvas.height;
  const left = Math.round(pad*dpr)+10, right = Math.round(pad*dpr), top = Math.round(pad*dpr), bottom = Math.round(pad*dpr)+12*dpr;

  // Scale
  const maxVal = Math.max(1, ...thisWeek, ...lastWeek);
  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const n = 7, barGap = 10*dpr;
  const bw = (innerW - (n-1)*barGap) / n;

  // Grid lines
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1*dpr;
  for (let i=0;i<=3;i++){
    const y = top + innerH * (i/3);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(W-right, y); ctx.stroke();
  }

  // Ghost bars
  ctx.globalAlpha = 0.35;
  for (let i=0;i<n;i++){
    const v = lastWeek[i] || 0;
    const h = innerH * (v / maxVal);
    const x = left + i*(bw+barGap);
    const y = top + innerH - h;
    ctx.fillStyle = theme.accent2;
    roundedRect(ctx, x, y, bw, h, 8*dpr);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Main bars
  for (let i=0;i<n;i++){
    const v = thisWeek[i] || 0;
    const h = innerH * (v / maxVal);
    const x = left + i*(bw+barGap);
    const y = top + innerH - h;
    // vertical gradient
    const g = ctx.createLinearGradient(0, y, 0, y+h);
    g.addColorStop(0, theme.accent);
    g.addColorStop(1, theme.accent2);
    ctx.fillStyle = g;
    roundedRect(ctx, x, y, bw, h, 8*dpr);
    ctx.fill();
  }

  // X labels (Mon..Sun)
  ctx.fillStyle = theme.text;
  ctx.font = `${12*dpr}px system-ui, -apple-system, sans-serif`;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for (let i=0;i<n;i++){
    const x = left + i*(bw+barGap) + bw/2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(days[i], x, H - bottom + 6*dpr);
  }
}

/** 30-day timeline bars + 7-day moving average line */
export function timeline30(canvas, days = [], { height = 200, pad = 20 } = {}) {
  const parent = canvas.closest('.chart') || canvas.parentElement;
  const width = parent?.clientWidth || 320;
  const dpr = dprSize(canvas, width - 2*8, height);
  const ctx = canvas.getContext('2d');
  const theme = C();

  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas.width, H = canvas.height;
  const left = Math.round(pad*dpr)+10, right = Math.round(pad*dpr), top = Math.round(pad*dpr), bottom = Math.round(pad*dpr)+12*dpr;

  const n = days.length;
  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const barGap = 4*dpr;
  const bw = Math.max(2*dpr, (innerW - (n-1)*barGap) / n);
  const maxVal = Math.max(1, ...days);

  // Grid
  ctx.strokeStyle = theme.grid; ctx.lineWidth = 1*dpr;
  for (let i=0;i<=4;i++){
    const y = top + innerH * (i/4);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(W-right, y); ctx.stroke();
  }

  // Bars
  for (let i=0;i<n;i++){
    const v = days[i] || 0;
    const h = innerH * (v / maxVal);
    const x = left + i*(bw+barGap);
    const y = top + innerH - h;
    const g = ctx.createLinearGradient(0, y, 0, y+h);
    g.addColorStop(0, theme.accent);
    g.addColorStop(1, theme.accent2);
    ctx.fillStyle = g;
    roundedRect(ctx, x, y, bw, h, 4*dpr);
    ctx.fill();
  }

  // 7-day moving average line
  const ma = movingAverage(days, 7);
  ctx.lineWidth = 2*dpr;
  const lineGrad = ctx.createLinearGradient(left, 0, W-right, 0);
  lineGrad.addColorStop(0, theme.accent);
  lineGrad.addColorStop(1, theme.accent2);
  ctx.strokeStyle = lineGrad;
  ctx.beginPath();
  for (let i=0;i<n;i++){
    const v = ma[i] || 0;
    const y = top + innerH - innerH * (v / maxVal);
    const x = left + i*(bw+barGap) + bw/2;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

/** Habit matrix: 7 cols (Mon..Sun) × 5 rows (~5 weeks), 1/0 cells */
export function habitMatrix(canvas, cells = [], { height = 130, pad = 12 } = {}) {
  const parent = canvas.closest('.chart') || canvas.parentElement;
  const width = parent?.clientWidth || 320;
  const dpr = dprSize(canvas, width - 2*8, height);
  const ctx = canvas.getContext('2d');
  const theme = C();

  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas.width, H = canvas.height;
  const left = Math.round(pad*dpr)+6, right = Math.round(pad*dpr), top = Math.round(pad*dpr)+10, bottom = Math.round(pad*dpr);

  const rows = 5, cols = 7;
  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const gap = 6*dpr;
  const cw = (innerW - gap*(cols-1)) / cols;
  const ch = (innerH - gap*(rows-1)) / rows;

  // Day labels
  ctx.fillStyle = theme.text; ctx.font = `${11*dpr}px system-ui, -apple-system, sans-serif`;
  const days = ['M','T','W','T','F','S','S'];
  for (let c=0;c<cols;c++){
    const x = left + c*(cw+gap) + cw/2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(days[c], x, top - 4*dpr);
  }

  // Cells (oldest at top-left -> newest at bottom-right)
  let idx = 0;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const v = cells[idx++] || 0;
      const x = left + c*(cw+gap);
      const y = top + r*(ch+gap);
      ctx.fillStyle = v ? theme.success : 'rgba(255,255,255,0.08)';
      roundedRect(ctx, x, y, cw, ch, 6*dpr);
      ctx.fill();
    }
  }
}

/** Focus bars: 24-hour histogram (points-weighted) */
export function focusBars(canvas, bins = [], { height = 160, pad = 20 } = {}) {
  const parent = canvas.closest('.chart') || canvas.parentElement;
  const width = parent?.clientWidth || 320;
  const dpr = dprSize(canvas, width - 2*8, height);
  const ctx = canvas.getContext('2d');
  const theme = C();

  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas.width, H = canvas.height;
  const left = Math.round(pad*dpr)+10, right = Math.round(pad*dpr), top = Math.round(pad*dpr), bottom = Math.round(pad*dpr)+14*dpr;

  const innerW = W - left - right;
  const innerH = H - top - bottom;
  const n = 24, gap = 2*dpr;
  const bw = (innerW - gap*(n-1)) / n;
  const maxVal = Math.max(1, ...bins);

  // Grid
  ctx.strokeStyle = theme.grid; ctx.lineWidth = 1*dpr;
  for (let i=0;i<=3;i++){
    const y = top + innerH * (i/3);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(W-right, y); ctx.stroke();
  }

  // Bars
  for (let i=0;i<n;i++){
    const v = bins[i] || 0;
    const h = innerH * (v / maxVal);
    const x = left + i*(bw+gap);
    const y = top + innerH - h;
    const g = ctx.createLinearGradient(0, y, 0, y+h);
    g.addColorStop(0, cssVar('--accent', '#3EA7FF'));
    g.addColorStop(1, cssVar('--accent-2', '#7C5CFF'));
    ctx.fillStyle = g;
    roundedRect(ctx, x, y, bw, h, 3*dpr);
    ctx.fill();
  }

  // X labels (0, 6, 12, 18, 23)
  ctx.fillStyle = theme.text;
  ctx.font = `${11*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const marks = [0,6,12,18,23];
  for (const h of marks) {
    const x = left + h*(bw+gap) + bw/2;
    ctx.fillText(String(h), x, H - bottom + 6*dpr);
  }
}

/* ===== helpers ===== */
function movingAverage(arr, win) {
  const out = [];
  let sum = 0;
  for (let i=0;i<arr.length;i++){
    sum += arr[i] || 0;
    if (i >= win) sum -= (arr[i-win] || 0);
    out[i] = i < (win - 1) ? NaN : sum / win;
  }
  // Fill leading NaNs with first valid value for smoother line
  let first = out.findIndex(v => !isNaN(v));
  if (first > 0) for (let i=0;i<first;i++) out[i] = out[first];
  return out;
}
