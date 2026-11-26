// The "standard table" report: our ICT engine in the 10-column layout of the Smart Confluence backtest standard
// (github.com/AhmedElmasry700/smart-indicator, docs/BACKTEST_STANDARD.md + tests/backtest_standard.py), so the two
// indicators can be read side by side.
//
//   node tools/backtest/standard-report.mjs --data <dir with dividend-adjusted EGX csvs> [--out report.md] [--only a,b]
//
// Per trade the result is a % of the entry price, the way that standard measures it: the gross move (blended over the
// TP1/TP2/TP3 scale-out in thirds, i.e. grossR x initial risk / entry) minus 0.15% commission per side (0.30% per trade).
// Our own cost model (slippage + EGP commission in R) is NOT used here, so the numbers line up with theirs.
// Columns, exactly as there: Win = pnl > 0; PF = total win / -total loss; Net = win + loss; Losing Streak = most losing
// trades in a row, all stocks together in entry order (entry time, then symbol); Max Drawdown = deepest fall of the summed
// trade % from its running peak in the same order. Hold-out = entries in the last 365 days before the newest entry;
// bootstrap = share of 400 whole-symbol resamples where the variant's net beats current. Trades held across an unadjusted
// share restructuring in the data (see jumpDays) are left out of every row.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { EGX_CFG, UNIVERSE } from './scan-core.mjs';
import { parseArgs } from './egx100-common.mjs';
import { EGX30_LIST } from './ict-engine.mjs';

const COMMISSION_PCT = 0.15; // per side
const HOLDOUT_DAYS = 365;

// current = what the scanner and dashboard trade: Preset EGX Daily, pullback (PB) + trailing-stop (TR) models.
// Variants = settings tested before (docs/superpowers/plans/), applied on top of current.
export const VARIANTS = [
  ['pb_only', 'pullback model only (trailing-stop model off)', { useTrailModel: false }],
  ['no_stop_on_close', 'Stop on Close Only off (= tv-r4)', { stopOnCloseOnly: false }],
  ['no_runner', 'Runner, Major trail, Trail From Entry off', { runnerMode: false, trailTier: 'Internal', trailFromEntry: false }],
  ['old_defaults', 'tv-base: no Stop on Close, no runner', { stopOnCloseOnly: false, runnerMode: false, trailTier: 'Internal', trailFromEntry: false }],
  ['confirm3', 'Require Confirmation (3 bars)', { requireConfirmation: true }],
  ['index_trend', 'Require Index Trend (EGX30/EGX70)', { requireIndexTrend: true }],
  ['avwap', 'Require Anchored VWAP', { requireAvwap: true }],
  ['displacement', 'Require Displacement', { requireDisplacement: true }],
  ['min_score_4', 'Minimum Score 4', { minScore: 4 }],
  ['min_score_6', 'Minimum Score 6 (what Score: Killzone off did before the preset forced the point)', { minScore: 6 }],
  ['choch_off', 'no CHoCH exit', { invalidation: 'off' }],
  ['choch_major', 'CHoCH exit on the Major tier only', { invalidation: 'major' }],
  ['choch_below_entry', 'CHoCH exit only if the close is below entry', { invalidation: 'belowEntry' }],
  ['hard_stop_2r', 'backup intraday stop at -2R', { hardStopR: 2 }],
  ['time_stop_10', 'time stop 10 bars before TP1', { timeStopBars: 10 }],
  ['stop_plus_1atr', 'initial stop 1 ATR wider', { stopExtraAtr: 1 }],
  ['swing_stop_int', 'stop under the internal swing low', { stopSwingTier: 'Internal' }],
  ['sma200', 'close above SMA 200', { filtAboveSma200: true }],
  ['adx20', 'ADX(14) >= 20', { filtAdxMin: 20 }],
  ['rsi_40_70', 'RSI 40-70', { filtRsiMin: 40, filtRsiMax: 70 }],
  ['vol_1x', 'volume >= SMA20 volume', { filtVolRatioMin: 1 }],
  ['weekly30', 'weekly close above weekly SMA 30', { filtWeekly30: true }],
  ['egx30_above_50', 'EGX30 above its SMA 50', { filtIdxAboveSma50: true }],
];

const EGX30 = new Set(EGX30_LIST.split(',').filter(Boolean));

// ---- per-trade % ------------------------------------------------------------------------------------------------------
export function tradePct(t) {
  const risk = Math.abs(t.entry - t.stop);
  const gross = t.entry > 0 ? 100 * t.grossR * risk / t.entry : 0;
  return gross - 2 * COMMISSION_PCT;
}

// ---- stats (tests/backtest_standard.py) ---------------------------------------------------------------------------------
const byEntry = (rows) => [...rows].sort((a, b) => a.t - b.t || (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0));
export function metrics(rows, withStreak = true) {
  const n = rows.length;
  let win = 0, loss = 0, wins = 0;
  for (const r of rows) { if (r.pnl > 0) { win += r.pnl; wins++; } else loss += r.pnl; }
  let streak = 0, cur = 0, eq = 0, peak = 0, dd = 0;
  for (const r of byEntry(rows)) {
    cur = r.pnl <= 0 ? cur + 1 : 0; streak = Math.max(streak, cur);
    eq += r.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak);
  }
  return {
    n, wr: n ? 100 * wins / n : 0, pf: loss ? win / -loss : (n ? 99 : 0), avg: n ? (win + loss) / n : 0,
    win, loss, net: win + loss, streak: withStreak ? streak : null, dd,
  };
}

export const fmtInt = (x) => Math.round(x).toLocaleString('en-US');
export const sgnInt = (x) => (Math.round(x) >= 0 ? '+' : '-') + fmtInt(Math.abs(x));
// [text, comparable value, direction] per column; direction +1 higher is better, -1 lower is better, 0 no mark.
export function columns(m) {
  return [
    [fmtInt(m.n), m.n, 0],
    [m.wr.toFixed(1) + '%', +m.wr.toFixed(1), 1],
    [m.pf.toFixed(2), +m.pf.toFixed(2), 1],
    [(m.avg >= 0 ? '+' : '') + m.avg.toFixed(2) + '%', +m.avg.toFixed(2), 1],
    [sgnInt(m.win) + '%', Math.round(m.win), 1],
    [sgnInt(m.loss) + '%', Math.round(m.loss), 1],
    [sgnInt(m.net) + '%', Math.round(m.net), 1],
    [m.streak === null ? '—' : String(m.streak), m.streak, -1],
    [sgnInt(m.dd) + '%', Math.round(m.dd), 1],
  ];
}
export const HEADER_COLS = '🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |';
export const ALIGN = (first) => `| ${first} |` + ' :---: |'.repeat(9);
const mark = (o, n, dir) => (dir === 0 || o === null || n === null || o === n ? '' : (n - o) * dir > 0 ? ' 🟢' : ' 🔴');

export function compareCells(o, n) {
  return columns(o).map(([ot, ov, dir], k) => {
    const [nt, nv] = columns(n)[k];
    let cell = `${ot} → **${nt}**${mark(ov, nv, dir)}`;
    if (k === 6 && Math.round(n.net) !== Math.round(o.net)) cell += ` (${sgnInt(n.net - o.net)})`;
    return cell;
  });
}

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function bootstrapBetter(rows, base, draws = 400) {
  const a = {}, b = {};
  for (const r of rows) a[r.sym] = (a[r.sym] || 0) + r.pnl;
  for (const r of base) b[r.sym] = (b[r.sym] || 0) + r.pnl;
  const syms = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const rnd = seeded(7);
  let better = 0;
  for (let d = 0; d < draws; d++) {
    let sa = 0, sb = 0;
    for (let k = 0; k < syms.length; k++) { const s = syms[Math.floor(rnd() * syms.length)]; sa += a[s] || 0; sb += b[s] || 0; }
    if (sa > sb) better++;
  }
  return 100 * better / draws;
}

// ---- data jumps -----------------------------------------------------------------------------------------------------------
// The feed leaves some share restructurings / bonus issues unadjusted (ASPI x75 on 2021-10-11, CNFN x46 on 2018-10-14, ...).
// TradingView shows the same bars, so the ports still match it, but a trade held across such a bar is not real.
// A jump = a one-day close move beyond x1.45 / x0.6 (EGX's daily price limit is far tighter). Returns { SYM: [date, ...] }.
export function jumpDays(U) {
  const out = {};
  for (const s of U.symbols) {
    const b = U.bars[s]; out[s] = [];
    for (let i = 1; i < b.length; i++) { const r = b[i].close / b[i - 1].close; if (r > 1.45 || r < 0.6) out[s].push(b[i].date); }
  }
  return out;
}
// row: { sym, open, close } with ISO dates. True when the trade was open across a jump bar.
export const spansJump = (jumps, r) => (jumps[r.sym] || []).some((d) => d > r.open && d <= r.close);
export const jumpNote = (jumps) => `${Object.values(jumps).flat().length} one-day moves beyond x1.45 / x0.6 in ${Object.values(jumps).filter((a) => a.length).length} stocks`;

// ---- run ------------------------------------------------------------------------------------------------------------------
export function rowsOf(U, cfg) {
  const rows = [];
  for (const s of U.symbols) {
    const res = runEngine(U.bars[s], cfg, { symbol: s, mintick: U.meta[s]?.mintick ?? 0.01, indexBars: U.indexBars });
    for (const t of res.trades) {
      rows.push({ sym: s, idx: EGX30.has(s) ? 'EGX30' : 'EGX70', t: t.openTime, open: t.openDate, close: t.closeDate, pnl: tradePct(t),
        model: t.model, reason: t.reason, tpHit: t.tpHit, bars: t.bars });
    }
  }
  return rows;
}

function main() {
  const args = parseArgs();
  if (!args.data) throw new Error('--data <dir> is required (dividend-adjusted EGX csvs, e.g. data/egx-div)');
  const dir = path.resolve(args.data);
  const symbols = UNIVERSE.filter((s) => fs.existsSync(path.join(dir, s + '.csv')));
  const U = { symbols, bars: Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)])), meta: loadMeta(dir), indexBars: loadIndexBars(dir) };
  const only = args.only ? new Set(String(args.only).split(',')) : null;
  const variants = VARIANTS.filter(([k]) => !only || only.has(k));

  const jumps = jumpDays(U);
  const removed = {};
  const clean = (k, rows) => { removed[k] = rows.filter((r) => spansJump(jumps, r)); return rows.filter((r) => !spansJump(jumps, r)); };
  const cur = clean('current', rowsOf(U, EGX_CFG(true)));
  const res = variants.map(([k, label, over]) => ({ k, label, rows: clean(k, rowsOf(U, { ...EGX_CFG(true), ...over })) }));
  const newest = Math.max(...cur.map((r) => r.t));
  const holdFrom = newest - HOLDOUT_DAYS * 86400;
  const firstBar = Math.min(...symbols.map((s) => U.bars[s][0].time)), lastDate = symbols.map((s) => U.bars[s].at(-1).date).sort().at(-1);
  const d = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const mC = metrics(cur);

  const out = [];
  out.push(`# ICT engine, EGX Daily — standard backtest table (${new Date().toLocaleDateString("en-CA")})`, '');
  out.push(`> **Test**: offline port \`tools/backtest/ict-engine.mjs\` (matches TradingView trade-for-trade on dividend-adjusted bars), `
    + `current = Preset EGX Daily, pullback + trailing-stop models (what the scanner and dashboard trade). ${symbols.length} EGX30/EGX70 stocks, `
    + `TradingView daily, dividend-adjusted, ${d(firstBar)} to ${lastDate}. Hold-out = entries from ${d(holdFrom)}.`, '');
  out.push('> Each trade in % of entry: the gross move blended over the TP1/TP2/TP3 thirds, minus 0.15% commission per side (no slippage), '
    + 'as in the Smart Confluence standard. Total Win / Total Loss = sum of winning / losing trades (%), Net = their sum, PF = win ÷ loss. '
    + 'Losing Streak and Max Drawdown: all stocks together in entry order, summed trade % (not compounded). '
    + 'Before → after: 🟢 better / 🔴 worse (smaller loss, shorter streak, shallower drawdown are better; Total Trades has no mark).', '');
  out.push(`> **Data clean-up**: the feed leaves some share restructurings unadjusted (${jumpNote(jumps)}). TradingView shows the same bars, `
    + `but a trade held across one is not real, so those trades are left out of every row (current: ${removed.current.length} trades, `
    + `${sgnInt(removed.current.reduce((x, r) => x + r.pnl, 0))}% net).`, '');

  // 1. All variants vs current, sorted by Net change (the screenshot layout)
  const sorted = [...res].sort((a, b) => metrics(b.rows).net - metrics(a.rows).net);
  out.push('## 🏆 Variants vs `current` (sorted by Net Profit)', '');
  out.push('| Variant (current → variant) | ' + HEADER_COLS, ALIGN(':---'));
  for (const v of sorted) out.push(`| \`${v.k}\` (${v.label}) | ` + compareCells(mC, metrics(v.rows)).join(' | ') + ' |');
  out.push('');

  // 2. current, standard table with EGX30 / EGX70 / ALL
  out.push('## 🏆 current', '', '| Market | ' + HEADER_COLS, ALIGN(':---'));
  for (const g of ['EGX30', 'EGX70']) out.push(`| ${g} | ` + columns(metrics(cur.filter((r) => r.idx === g))).map((c) => c[0]).join(' | ') + ' |');
  out.push('| **🌐 ALL** | ' + columns(mC).map((c) => `**${c[0]}**`).join(' | ') + ' |', '');

  // 3. variants summary with hold-out and bootstrap
  const fmtNet = (x) => sgnInt(x);
  out.push('## Variants summary', '', '| Variant | Trades | WR % | PF | Net % | Avg % | Hold-out n | Hold-out net % | Hold-out PF | Boot better % |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const v of [{ k: 'current', rows: cur }, ...sorted]) {
    const m = metrics(v.rows), h = metrics(v.rows.filter((r) => r.t >= holdFrom));
    out.push(`| ${v.k} | ${fmtInt(m.n)} | ${m.wr.toFixed(1)} | ${m.pf.toFixed(2)} | ${fmtNet(m.net)} | ${m.avg.toFixed(2)} | ${h.n} | ${fmtNet(h.net)} | ${h.pf.toFixed(2)} | ${v.k === 'current' ? '' : bootstrapBetter(v.rows, cur).toFixed(0)} |`);
  }
  out.push('');

  // 4. current by model / exit reason / entry year
  const breakdown = (title, key, order) => {
    const g = {};
    for (const r of cur) (g[key(r)] ||= []).push(r);
    const keys = order ? Object.keys(g).sort() : Object.keys(g).sort((a, b) => g[b].length - g[a].length);
    out.push(`## current by ${title}`, '', `| ${title} | ` + HEADER_COLS, ALIGN(':---'));
    for (const k of keys) out.push(`| ${k} | ` + columns(metrics(g[k])).map((c) => c[0]).join(' | ') + ' |');
    out.push('');
  };
  breakdown('model', (r) => r.model);
  breakdown('exit reason', (r) => r.reason);
  breakdown('entry year', (r) => r.open.slice(0, 4), true);

  const text = out.join('\n');
  if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, text); }
  process.stdout.write(text + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
