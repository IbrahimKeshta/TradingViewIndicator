// EGX Weekly preset search, by the protocol in docs/superpowers/plans/2026-11-23-egx-weekly-preset.md.
//
//   node tools/backtest/weekly-tests.mjs --stage 1                       # 16 exit combos, DISCOVERY only
//   node tools/backtest/weekly-tests.mjs --stage 2 --base '{"..."}'      # swing lookbacks around the stage 1 winner, DISCOVERY only
//   node tools/backtest/weekly-tests.mjs --final '{"..."}'               # finalist + references, discovery AND test
//
// Data: data/wk-div (weekly, dividend-adjusted; fetch with fetch-egx.mjs --tf 1W). Discovery = PB trades opened before
// 2020-01-01, test = on or after. Closed trades only; open trades are reported separately, marked to the last close.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { parseArgs } from './egx100-common.mjs';

const args = parseArgs();
const dir = path.resolve(args.data || 'data/wk-div');
const SPLIT = '2020-01-01';
const MIN_DISC_N = 150;
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();
const bars = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)]));
const BASE = PRESETS['egx-daily'];

function run(over, trail = false) {
  const cfg = { ...BASE, ...over, useTrailModel: trail };
  const closed = [], open = [];
  for (const s of symbols) {
    const b = bars[s];
    const r = runEngine(b, cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
    closed.push(...r.trades);
    for (const t of r.openTrades) {
      const risk = Math.abs(t.entry - t.initialStop), c = b[b.length - 1].close;
      open.push({ symbol: s, model: t.chandelier ? 'TR' : 'PB', openDate: b[t.openBar].date, tpHit: t.tpHit, openR: risk > 0 ? (c - t.entry) / risk : 0 });
    }
  }
  return { closed, open };
}

function stats(trades) {
  const n = trades.length, w = trades.filter((t) => t.r > 0);
  const gw = w.reduce((a, t) => a + t.r, 0), gl = -trades.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0);
  const tot = trades.reduce((a, t) => a + t.r, 0);
  const per = {};
  for (const t of trades) per[t.symbol] = (per[t.symbol] || 0) + t.r;
  const stocks = Object.values(per);
  return { n, avg: n ? tot / n : NaN, tot, win: n ? 100 * w.length / n : NaN, pf: gl > 0 ? gw / gl : NaN, prof: stocks.length ? 100 * stocks.filter((x) => x > 0).length / stocks.length : NaN };
}
const fmt = (s) => `n ${String(s.n).padStart(4)}  avg ${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(3)}R  total ${s.tot.toFixed(1).padStart(7)}R  win ${s.win.toFixed(1)}%  PF ${s.pf.toFixed(2)}  stocks+ ${s.prof.toFixed(0)}%`;
const label = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') || '(EGX Daily)';
const pb = (r) => r.closed.filter((t) => t.model === 'PB');
const disc = (ts) => ts.filter((t) => t.openDate < SPLIT), test = (ts) => ts.filter((t) => t.openDate >= SPLIT);

function rank(cands) {
  const rows = cands.map((o) => ({ o, s: stats(disc(pb(run(o)))) }));
  rows.sort((a, b) => b.s.avg - a.s.avg);
  for (const r of rows) console.log(`${r.s.n >= MIN_DISC_N ? ' ' : '*'} ${fmt(r.s)}  | ${label(r.o)}`);
  console.log(`(* = fewer than ${MIN_DISC_N} discovery trades, not eligible)`);
}

if (args.stage === '1' || args.stage === 1) {
  const cands = [];
  for (const trailTier of ['Major', 'Internal']) for (const trailFromEntry of [true, false]) for (const stopOnCloseOnly of [true, false]) for (const runnerMode of [true, false])
    cands.push({ trailTier, trailFromEntry, stopOnCloseOnly, runnerMode });
  console.log(`STAGE 1 - exits - DISCOVERY (PB trades opened before ${SPLIT}), ${symbols.length} stocks`);
  rank(cands);
} else if (args.stage === '2' || args.stage === 2) {
  const base = JSON.parse(args.base);
  const cands = [];
  for (const majorLookback of [20, 10]) for (const internalLookback of [5, 3]) cands.push({ ...base, majorLookback, internalLookback });
  console.log(`STAGE 2 - swing lookbacks - DISCOVERY (PB trades opened before ${SPLIT})`);
  rank(cands);
} else if (args.final) {
  const fin = JSON.parse(args.final);
  const refs = [['finalist', fin], ['EGX Daily', {}], ['defaults (tv-base)', { runnerMode: false, trailTier: 'Internal', trailFromEntry: false, stopOnCloseOnly: false }]];
  console.log(`FINAL - discovery (< ${SPLIT}) and TEST (>= ${SPLIT}); PB model`);
  for (const [name, o] of refs) {
    const r = run(o, true);
    const p = pb(r), t = r.closed.filter((x) => x.model === 'TR');
    console.log(`\n${name}: ${label(o)}`);
    console.log(`  PB discovery ${fmt(stats(disc(p)))}`);
    console.log(`  PB test      ${fmt(stats(test(p)))}`);
    console.log(`  TR discovery ${fmt(stats(disc(t)))}`);
    console.log(`  TR test      ${fmt(stats(test(t)))}`);
    const op = r.open.filter((x) => x.model === 'PB');
    console.log(`  PB open now: ${op.length}, marked to last close ${op.reduce((a, x) => a + x.openR, 0).toFixed(1)}R (price move only, before costs)`);
  }
} else {
  console.error('use --stage 1, --stage 2 --base JSON, or --final JSON');
  process.exit(1);
}
