// CHoCH-invalidation variants through the engine (docs/superpowers/plans/2026-11-20-six-stock-deep-dive.md).
//   node tools/backtest/variants.mjs [--out data/six-stock-out]
// Datasets: the six stocks (dividend-adjusted data/egx-div), the other dividend-adjusted names in data/egx-div, and all 100 of data/egx
// (split-adjusted). Metrics are per closed trade, in R, net of costs. Pre-2023 / 2023+ by trade open date.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { HOLDOUT } from './egx100-common.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i]; }
const outDir = path.resolve(args.out || 'data/six-stock-out');
fs.mkdirSync(outDir, { recursive: true });
const SIX = ['MASR', 'BTFH', 'EMFD', 'EFID', 'ORWE', 'EEII'];
const base = PRESETS['tv-base'];
const recCfg = { ...base, stopOnCloseOnly: true, runnerMode: true, trailTier: 'Major', trailFromEntry: true };
const VARIANTS = [
  ['base', 'Baseline (tv-base)', { ...base }, null],
  ['V1', 'V1 base, no CHoCH exit', { ...base, invalidation: 'off' }, 'base'],
  ['V2', 'V2 base, Major-tier CHoCH only', { ...base, invalidation: 'major' }, 'base'],
  ['V3', 'V3 base, CHoCH only if close beyond entry', { ...base, invalidation: 'belowEntry' }, 'base'],
  ['rec', 'rec (Stop on Close + r4)', { ...recCfg }, null],
  ['V4', 'V4 rec + V1 (no CHoCH exit)', { ...recCfg, invalidation: 'off' }, 'rec'],
  ['V5', 'V5 rec + V3 (CHoCH only if close beyond entry)', { ...recCfg, invalidation: 'belowEntry' }, 'rec'],
  ['V6', 'extra: rec + V2 (Major-tier CHoCH only)', { ...recCfg, invalidation: 'major' }, 'rec'],
];
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const symbolsOf = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();

function runSet(dir, symbols) {
  const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
  const res = {}; // variant -> sym -> trades
  const bars = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)]));
  for (const [k, , cfg] of VARIANTS) {
    res[k] = {};
    for (const s of symbols) res[k][s] = runEngine(bars[s], cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars }).trades;
  }
  return res;
}
function stats(trades) {
  const o = { n: trades.length, w: 0, tot: 0, gp: 0, gl: 0, pre: [], post: [], inv: 0, held: 0 };
  for (const t of trades) {
    if (t.r > 0) { o.w++; o.gp += t.r; } else o.gl += -t.r;
    o.tot += t.r; (t.openDate < '2023-01-01' ? o.pre : o.post).push(t.r);
    if (t.reason === 'Invalidated') o.inv++;
    o.held += t.bars;
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return { ...o, win: o.n ? 100 * o.w / o.n : NaN, avg: o.n ? o.tot / o.n : NaN, pf: o.gl > 0 ? o.gp / o.gl : Infinity, preN: o.pre.length, preTot: o.pre.reduce((x, y) => x + y, 0), postTot: o.post.reduce((x, y) => x + y, 0), exposure: o.held, preAvg: avg(o.pre), postN: o.post.length, postAvg: avg(o.post), bars: o.n ? o.held / o.n : NaN };
}
const pool = (res, k, syms) => syms.flatMap((s) => res[k][s]);

const md = [];
const json = {};
function table(title, res, syms, note) {
  md.push(`\n#### ${title}\n`);
  if (note) md.push(note + '\n');
  md.push('| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than ' + 'its base (n>=3 either)' + ' |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  json[title] = {};
  for (const [k, label, , ref] of VARIANTS) {
    const st = stats(pool(res, k, syms));
    let better = '';
    if (ref) {
      let b = 0, w = 0, e = 0;
      for (const s of syms) {
        const a = res[k][s], c = res[ref][s];
        if (a.length < 3 && c.length < 3) continue;
        const d = a.reduce((x, t) => x + t.r, 0) - c.reduce((x, t) => x + t.r, 0);
        if (d > 1e-9) b++; else if (d < -1e-9) w++; else e++;
      }
      better = `${b} better / ${w} worse / ${e} same`;
    }
    json[title][k] = { ...st, pre: undefined, post: undefined };
    md.push(`| ${label} | ${st.n} | ${f2(st.win, 1)} | ${f2(st.avg, 3)} | ${f2(st.tot, 1)} | ${f2(st.pf, 2)} | ${st.inv} | ${f2(st.bars, 1)} | ${st.preN} / ${f2(st.preAvg, 3)} / ${f2(st.preTot, 0)} | ${st.postN} / ${f2(st.postAvg, 3)} / ${f2(st.postTot, 0)} | ${f2(100 * st.tot / st.exposure, 2)} | ${better} |`);
  }
}

// six on dividend-adjusted data
const resDiv = runSet(path.resolve('data/egx-div'), symbolsOf(path.resolve('data/egx-div')));
const divAll = Object.keys(resDiv.base);
table('The six stocks (dividend-adjusted, data/egx-div): ' + SIX.join(', '), resDiv, SIX);
const others = divAll.filter((s) => !SIX.includes(s));
table('The other ' + others.length + ' dividend-adjusted names in data/egx-div (' + others.join(', ') + ') - not selected as bad examples', resDiv, others);
for (const s of SIX) table('Single stock ' + s + ' (dividend-adjusted)', resDiv, [s]);

// 100 on split-adjusted data
const dirSplit = path.resolve('data/egx');
const symsSplit = symbolsOf(dirSplit);
const resSplit = runSet(dirSplit, symsSplit);
table('All ' + symsSplit.length + ' symbols of data/egx (split-adjusted, full history)', resSplit, symsSplit);
const hold = symsSplit.filter((s) => HOLDOUT.includes(s)), rest = symsSplit.filter((s) => !HOLDOUT.includes(s));
table('data/egx, the ' + rest.length + ' non-holdout names', resSplit, rest);
table('data/egx, the ' + hold.length + ' names held back in the earlier failure analysis', resSplit, hold);
table('data/egx without the six stocks (' + symsSplit.filter((s) => !SIX.includes(s)).length + ' symbols)', resSplit, symsSplit.filter((s) => !SIX.includes(s)));

fs.writeFileSync(path.join(outDir, 'variants-tables.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'variants-summary.json'), JSON.stringify(json, null, 1));
console.log(md.join('\n'));
