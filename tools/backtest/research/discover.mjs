// Discovery run: every family config on every discovery set, discovery window only (see the plan doc).
//   node --max-old-space-size=12000 tools/backtest/research/discover.mjs [--sets c15,c60,c240,c1440,eD,e60] [--only F1] [--stage discovery|validation]
// Writes out/research/<stage>.json and prints a table per set plus a cross-set summary.
import fs from 'node:fs';
import { loadFeatures } from './features.mjs';
import { simulate, stats } from './sim.mjs';
import { families } from './families.mjs';
import { egxMeta_ } from '../sof-data.mjs';
import { EGX30_LIST, EGX70_LIST } from '../ict-engine.mjs';
import { CRYPTO_TUNE, CRYPTO_HELD } from '../sof/symbols.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SETS = arg('sets', 'c15,c60,c240,c1440,eD,e60').split(',');
const only = arg('only');
const stage = arg('stage', 'discovery');
const names = arg('names') ? arg('names').split('|') : null;
const CRYPTO_SPLIT = Date.UTC(2025, 10, 1) / 1000, EGX_SPLIT = Date.UTC(2024, 11, 31, 22) / 1000;
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

let fams = families();
if (only) fams = fams.filter((x) => x.name.startsWith(only) || x.fam.startsWith(only));
if (names) fams = fams.filter((x) => names.includes(x.name));
const results = {};
for (const set of SETS) {
  const crypto = set.startsWith('c');
  const syms = crypto ? [...CRYPTO_TUNE, ...CRYPTO_HELD] : [...list(EGX30_LIST), ...list(EGX70_LIST)].filter((s) => { const m = egxMeta_()[s]; return m && m[set === 'eD' ? '1D' : '60'] && !m[set === 'eD' ? '1D' : '60'].error; });
  const split = crypto ? CRYPTO_SPLIT : EGX_SPLIT;
  const win = stage === 'discovery' ? { to: split } : { from: split };
  const costs = crypto ? { pct: 0.1 } : { pct: 0.1, commission: 2, positionSize: 100000 };
  const feats = syms.map((s) => loadFeatures(set, s));
  const t0 = Date.now();
  results[set] = {};
  for (const fam of fams) {
    let all = [];
    for (const f of feats) { if (fam.prep) fam.prep(f); all = all.concat(simulate(f, fam, costs, win)); }
    results[set][fam.name] = { ...stats(all), fam: fam.fam };
  }
  console.log(`\n== ${set} (${stage}, ${syms.length} symbols, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  const rows = Object.entries(results[set]).sort((a, b) => b[1].avg - a[1].avg);
  for (const [name, s] of rows.slice(0, Number(arg('top', '12')))) console.log(`${name.padEnd(34)} n=${String(s.n).padStart(6)} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(3)} gross ${s.gross >= 0 ? '+' : ''}${s.gross.toFixed(3)} win ${(s.win * 100).toFixed(0)}% pf ${s.pf.toFixed(2)} sym+ ${(s.symPos * 100).toFixed(0)}%/${s.symN} L ${s.longAvg.toFixed(3)} (${s.nL}) S ${s.shortAvg.toFixed(3)} (${s.nS})`);
}
fs.mkdirSync('out/research', { recursive: true });
fs.writeFileSync(`out/research/${stage}${only ? '-' + only.replace(/\s/g, '') : ''}.json`, JSON.stringify(results));
// cross-set summary: configs by mean of per-set avg R, and how many sets positive
const allNames = Object.keys(results[SETS[0]]);
const summ = allNames.map((nm) => { const v = SETS.map((s) => results[s][nm]); return { nm, pos: v.filter((x) => x.avg > 0).length, mean: v.reduce((a, x) => a + (x.avg || 0), 0) / v.length, v }; }).sort((a, b) => b.pos - a.pos || b.mean - a.mean);
console.log(`\n== cross-set (${SETS.join(' ')}): avg R per set`);
for (const r of summ.slice(0, Number(arg('top', '15')))) console.log(`${r.nm.padEnd(34)} pos ${r.pos}/${SETS.length}  ${r.v.map((x) => (x.avg >= 0 ? '+' : '') + x.avg.toFixed(3)).join('  ')}`);
