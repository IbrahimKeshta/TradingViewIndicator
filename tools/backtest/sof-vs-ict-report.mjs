// Session Order Flow vs the current ICT setup (EGX Daily) in the standard 10-column % table, both on the same bars.
//
//   node tools/backtest/sof-vs-ict-report.mjs --data data/egx-div [--out docs/backtests/<date>-sof-vs-ict-standard-table.md]
//
// ICT = ict-engine.mjs with Preset EGX Daily, pullback + trailing-stop models (what the scanner trades).
// Session Order Flow, run on the same dividend-adjusted daily bars without intrabars (the "Lower Timeframe = chart" setting
// the port was matched to TradingView with):
//   liquidity run  = research/sim.mjs + family "F8 F4 pool ema200 trail8" (the Pine default Entry Model), both sides / long only
//   sweep reversal = sof-engine.mjs trade module (the original model), both sides / long only
// Per trade: gross % of entry (grossR x initial risk / entry) minus 0.15% commission per side, as in standard-report.mjs.
// Trades held across an unadjusted share restructuring (standard-report.mjs jumpDays) are left out of every model.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, EGX30_LIST } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { EGX_CFG, UNIVERSE } from './scan-core.mjs';
import { parseArgs } from './egx100-common.mjs';
import * as SR from './standard-report.mjs';
import { runSof } from './sof-engine.mjs';
import { buildChart } from './sof-data.mjs';
import { readBarsCsv } from './tv-feed.mjs';
import { featuresFromChart } from './research/features.mjs';
import { simulate } from './research/sim.mjs';
import { families } from './research/families.mjs';

const COMM = 0.15;
const EGX30 = new Set(EGX30_LIST.split(',').filter(Boolean));
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const LABELS = {
  run_both: ['sof_run', 'Session Order Flow, Liquidity run (trend), the current default: longs and shorts'],
  run_long: ['sof_run_long', 'Liquidity run, long trades only (what EGX allows)'],
  sweep_both: ['sof_sweep', 'Sweep reversal (the original model): longs and shorts'],
  sweep_long: ['sof_sweep_long', 'Sweep reversal, long trades only'],
};

const args = parseArgs();
if (!args.data) throw new Error('--data <dir> is required (dividend-adjusted EGX csvs, e.g. data/egx-div)');
const dir = path.resolve(args.data);
const symbols = UNIVERSE.filter((s) => fs.existsSync(path.join(dir, s + '.csv')));
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const U = { symbols, bars: Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)])), meta, indexBars };
const jumps = SR.jumpDays(U);
const removed = {};
const clean = (k, rows) => { removed[k] = rows.filter((r) => SR.spansJump(jumps, r)); return rows.filter((r) => !SR.spansJump(jumps, r)); };

// ICT, with the fields for the risk view
const ictAll = [];
for (const s of symbols) for (const t of runEngine(U.bars[s], EGX_CFG(true), { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars }).trades) {
  ictAll.push({ sym: s, idx: EGX30.has(s) ? 'EGX30' : 'EGX70', t: t.openTime, open: t.openDate, close: t.closeDate, pnl: SR.tradePct(t),
    dir: 1, gR: t.grossR, riskPct: 100 * Math.abs(t.entry - t.stop) / t.entry, bars: t.bars });
}
const ict = clean('ict', ictAll);

// Session Order Flow
const fam = families().find((x) => x.name === 'F8 F4 pool ema200 trail8');
const raw = { run_both: [], run_long: [], sweep_both: [], sweep_long: [] };
const push = (k, s, openTime, closeTime, grossR, riskPct, bars, d) => raw[k].push({ sym: s, idx: EGX30.has(s) ? 'EGX30' : 'EGX70', t: openTime,
  open: day(openTime), close: day(closeTime), pnl: grossR * riskPct - 2 * COMM, dir: d, gR: grossR, riskPct, bars });
for (const s of symbols) {
  const chart = buildChart({ symbol: s, bars: readBarsCsv(path.join(dir, s + '.csv')), ltfBars: null, tfSecs: 86400, symType: 'stock',
    exTz: 'Africa/Cairo', weekStart: 0, mintick: meta[s]?.mintick ?? 0.01 });
  const f = featuresFromChart(chart, s);
  for (const [k, longOnly] of [['run_both', false], ['run_long', true]])
    for (const t of simulate(f, fam, { pct: 0, commission: 0, positionSize: 100000 }, { longOnly })) push(k, s, t.openTime, t.closeTime, t.grossR, t.riskPct, t.bars, t.dir);
  for (const [k, longOnly] of [['sweep_both', false], ['sweep_long', true]])
    for (const t of runSof(chart, { longOnly }).trades) push(k, s, chart.time[t.openIdx], t.closeTime, t.grossR, 100 * t.risk / t.entry, t.closeIdx - t.openIdx, t.dir);
}
const sof = Object.fromEntries(Object.entries(raw).map(([k, rows]) => [k, clean(k, rows)]));
const keys = Object.keys(sof);
const avg = (rows, f) => rows.reduce((x, r) => x + f(r), 0) / (rows.length || 1);

const mI = SR.metrics(ict);
const holdFrom = Math.max(...ict.map((r) => r.t)) - 365 * 86400;
const firstBar = Math.min(...symbols.map((s) => U.bars[s][0].time)), lastDate = symbols.map((s) => U.bars[s].at(-1).date).sort().at(-1);
const sumPnl = (rows) => rows.reduce((x, r) => x + r.pnl, 0);

const out = [];
out.push(`# Session Order Flow vs ICT (EGX Daily) — standard backtest table (${new Date().toLocaleDateString('en-CA')})`, '');
out.push(`> **Test**: both indicators on the same bars: ${symbols.length} EGX30/EGX70 stocks, TradingView daily, dividend-adjusted, ${day(firstBar)} to ${lastDate}. `
  + 'ICT = offline port `tools/backtest/ict-engine.mjs`, Preset EGX Daily, pullback + trailing-stop models (what the scanner trades). '
  + 'Session Order Flow = offline port `sof-engine.mjs` (matched TradingView 340/340 trades with Lower Timeframe = chart, which is how it runs here) and the '
  + 'liquidity-run simulator from the 2026-11-21 model search (pool run with close beyond, EMA 200 trend, 8 ATR stop and trail from the best close, no target). '
  + `Hold-out = entries from ${day(holdFrom)}.`, '');
out.push('> Each trade in % of entry (full position), minus 0.15% commission per side, summed, not compounded. Losing Streak and Max Drawdown: all stocks in entry order. '
  + '🟢 better / 🔴 worse than ICT.', '');
out.push(`> **Data clean-up**: the feed leaves some share restructurings unadjusted (e.g. ASPI x75 on 2021-10-11, CNFN x46 on 2018-10-14; ${SR.jumpNote(jumps)}). `
  + 'TradingView shows the same bars, but any trade held across one is not real, so those trades are removed from every model below (listed at the end).', '');

out.push('## 🏆 ICT `current` → Session Order Flow', '', '| Model (ICT current → model) | ' + SR.HEADER_COLS, SR.ALIGN(':---'));
for (const k of keys) out.push(`| \`${LABELS[k][0]}\` (${LABELS[k][1]}) | ` + SR.compareCells(mI, SR.metrics(sof[k])).join(' | ') + ' |');
out.push('');

const std = (title, rows) => {
  out.push(`## ${title}`, '', '| Market | ' + SR.HEADER_COLS, SR.ALIGN(':---'));
  for (const g of ['EGX30', 'EGX70']) out.push(`| ${g} | ` + SR.columns(SR.metrics(rows.filter((r) => r.idx === g))).map((c) => c[0]).join(' | ') + ' |');
  out.push('| **🌐 ALL** | ' + SR.columns(SR.metrics(rows)).map((c) => `**${c[0]}**`).join(' | ') + ' |', '');
};
std('ICT current (EGX Daily)', ict);
for (const k of keys) std(LABELS[k][0], sof[k]);

out.push('## Summary, with the risk view', '',
  '| Model | Trades | shorts | WR % | PF | Net % | Avg % | avg stop (% of entry) | avg bars held | avg gross R | Since 2016 n | Since 2016 net % | Since 2016 PF | Hold-out n | Hold-out net % | Hold-out PF | Boot better than ICT % |',
  '|' + '---|'.repeat(17));
for (const [name, rows] of [['ICT current', ict], ...keys.map((k) => [LABELS[k][0], sof[k]])]) {
  const m = SR.metrics(rows), h = SR.metrics(rows.filter((r) => r.t >= holdFrom)), s16 = SR.metrics(rows.filter((r) => r.open >= '2016'));
  out.push(`| ${name} | ${SR.fmtInt(m.n)} | ${rows.filter((r) => r.dir < 0).length} | ${m.wr.toFixed(1)} | ${m.pf.toFixed(2)} | ${SR.sgnInt(m.net)} | ${m.avg.toFixed(2)} | `
    + `${avg(rows, (r) => r.riskPct).toFixed(1)} | ${avg(rows, (r) => r.bars).toFixed(0)} | ${avg(rows, (r) => r.gR).toFixed(3)} | ${s16.n} | ${SR.sgnInt(s16.net)} | ${s16.pf.toFixed(2)} | `
    + `${h.n} | ${SR.sgnInt(h.net)} | ${h.pf.toFixed(2)} | ${rows === ict ? '' : SR.bootstrapBetter(rows, ict).toFixed(0)} |`);
}
out.push('');

out.push('## By entry year (net %)', '', '| Year | ICT n | ICT net | ' + keys.map((k) => `${LABELS[k][0]} n | ${LABELS[k][0]} net`).join(' | ') + ' |', '|' + '---|'.repeat(3 + 2 * keys.length));
const years = [...new Set([...ict, ...keys.flatMap((k) => sof[k])].map((r) => r.open.slice(0, 4)))].sort();
for (const y of years) {
  const cell = (rows) => { const a = rows.filter((r) => r.open.startsWith(y)); return `${a.length} | ${SR.sgnInt(sumPnl(a))}`; };
  out.push(`| ${y} | ${cell(ict)} | ` + keys.map((k) => cell(sof[k])).join(' | ') + ' |');
}
out.push('');
for (const [name, rows] of [[LABELS.run_long[0], sof.run_long], ['ICT', ict]]) {
  const top = [...rows].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  out.push(`Largest ${name} trades: ` + top.map((r) => `${r.sym} ${r.open} ${SR.sgnInt(r.pnl)}%`).join(', ')
    + ` (top 5 = ${(100 * sumPnl(top) / SR.metrics(rows).win).toFixed(1)}% of its total win).`, '');
}

out.push('## Trades removed (held across a data jump)', '', '| Model | removed | their net % | largest |', '|---|---|---|---|');
for (const k of ['ict', ...keys]) {
  const a = removed[k], top = [...a].sort((x, y) => y.pnl - x.pnl)[0];
  out.push(`| ${k === 'ict' ? 'ICT current' : LABELS[k][0]} | ${a.length} | ${SR.sgnInt(sumPnl(a))} | ${top ? `${top.sym} ${top.open} ${SR.sgnInt(top.pnl)}%` : '-'} |`);
}
out.push('');

const text = out.join('\n');
if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, text); }
process.stdout.write(text + '\n');
