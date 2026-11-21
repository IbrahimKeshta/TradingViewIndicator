// Per-stock win rate and profit, baseline vs the recommended settings (Stop on Close + r4).
//   node tools/backtest/per-stock.mjs [--data data/egx] [--out file.md]
// Same metric definitions as sweep.mjs: net return % = net R x |entry - initial stop| / entry x 100,
// win = net return > 0, closed trades only, full history, all symbols in the data dir.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars } from './data.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir);
const indexBars = loadIndexBars(dir);
const symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();
const CONFIGS = {
  base: { ...PRESETS['tv-base'] },
  rec: { ...PRESETS['tv-base'], stopOnCloseOnly: true, runnerMode: true, trailTier: 'Major', trailFromEntry: true },
};
const retPct = (t) => t.r * (Math.abs(t.entry - t.stop) / t.entry) * 100;
function stats(trades) {
  let n = 0, w = 0, gp = 0, gl = 0, rs = 0;
  for (const t of trades) { const p = retPct(t); n++; rs += t.r; if (p > 0) { w++; gp += p; } else gl += p; }
  return { n, w, l: n - w, win: n ? (100 * w) / n : NaN, net: gp + gl, pf: gl < 0 ? gp / -gl : (gp > 0 ? Infinity : NaN), avgR: n ? rs / n : NaN };
}
const rows = [];
for (const s of symbols) {
  const bars = loadSymbol(s, dir);
  const r = {};
  for (const [k, cfg] of Object.entries(CONFIGS)) r[k] = stats(runEngine(bars, cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars }).trades);
  rows.push({ s, list: meta[s]?.list ?? '', first: (meta[s]?.first ?? '').slice(0, 4), ...r });
}
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : '–');
rows.sort((a, b) => (b.rec.n >= 5) - (a.rec.n >= 5) || (b.rec.win - a.rec.win) || (b.rec.net - a.rec.net));
const L = ['| # | Stock | Index | Data from | Base trades | Base win % | Base net % | Rec trades | Rec W / L | **Rec win %** | Rec net % | Rec PF | Rec avg R |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
rows.forEach((x, i) => L.push(`| ${i + 1} | ${x.s} | ${x.list} | ${x.first} | ${x.base.n} | ${f(x.base.win)} | ${f(x.base.net, 0)} | ${x.rec.n} | ${x.rec.w} / ${x.rec.l} | **${f(x.rec.win)}** | ${f(x.rec.net, 0)} | ${f(x.rec.pf, 2)} | ${f(x.rec.avgR, 2)} |`));
const out = L.join('\n');
if (args.out) fs.writeFileSync(args.out, out + '\n'); else console.log(out);
const all = (k) => stats([]) && rows.reduce((a, x) => a + x[k].n, 0);
console.error('symbols', rows.length, 'base trades', all('base'), 'rec trades', all('rec'));
