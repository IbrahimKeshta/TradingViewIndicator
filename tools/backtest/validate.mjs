// Fidelity validation: reproduce the per-chart results TradingView's own Pine script reported
// (docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv) and compare n / wins / R.
//
//   node validate.mjs [--cut 2026-11-04] [--max-bars 5000] [--ties nonstrict] [--cfg '{...}'] [--quiet] [--rounds ict,runner]
//
// ict    base          -> preset tv-base       (set tune = Tuning column only; testD = Tuning+Test)
// runner base / r4     -> tv-base / tv-r4      (set tune = Tuning column; batchE/batchF = Tuning+Test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngine, PRESETS, summarize } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars, cutBars } from './data.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const nx = process.argv[i + 1]; if (nx === undefined || nx.startsWith('--')) args[k] = true; else { args[k] = nx; i++; } }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const tsv = path.resolve(here, '..', '..', 'docs', 'superpowers', 'plans', '2026-11-02-egx-trust-raw-results.tsv');
const rows = fs.readFileSync(tsv, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const c = l.split('\t');
  return { round: c[0], combo: c[1], symbol: c[4], set: c[5], n: +c[6], wins: +c[7], R: +c[8] };
}).filter((r) => r.round === 'ict' || r.round === 'runner');
const combos = (args.combos || 'base,r4').split(',');

const rounds = (args.rounds || 'ict,runner').split(',');
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir);
const extra = args.cfg ? JSON.parse(args.cfg) : {};
const cutOpts = { endDate: args.cut, maxBars: args['max-bars'] ? +args['max-bars'] : undefined };
const includeStraddle = !!args.straddle;
if (args.ties) extra.pivotTies = args.ties;

// Config of each recorded combo, on top of the tv-base preset (daily, Long Only, costs, 10-tick floor).
const COMBO_CFG = {
  'ict base': {}, 'ict conf': { requireConfirmation: true }, 'ict idx': { requireIndexTrend: true }, 'ict both': { requireConfirmation: true, requireIndexTrend: true },
  'runner base': {}, 'runner r1': { runnerMode: true }, 'runner r2': { trailTier: 'Major' }, 'runner r3': { runnerMode: true, trailTier: 'Major' },
  'runner r4': { runnerMode: true, trailTier: 'Major', trailFromEntry: true },
};
const indexBars = (() => { try { const r = loadIndexBars(dir); const o = {}; for (const k of Object.keys(r)) o[k] = cutBars(r[k], { endDate: args.cut }); return o; } catch { return {}; } })();
const cache = new Map();
function trades(sym, combo) {
  const key = sym + '|' + combo;
  if (!cache.has(key)) {
    const bars = cutBars(loadSymbol(sym, dir), cutOpts);
    cache.set(key, runEngine(bars, { ...PRESETS['tv-base'], ...COMBO_CFG[combo], ...extra }, { symbol: sym, mintick: meta[sym]?.mintick ?? 0.01, indexBars }).trades);
  }
  return cache.get(key);
}

const out = [];
for (const r of rows) {
  if (!rounds.includes(r.round) || !combos.includes(r.combo)) continue;
  // 'runner base' rows are the same config as 'ict base'; compare each once per round anyway.
  let t;
  try { t = trades(r.symbol, r.round + ' ' + r.combo); } catch (e) { if (!/ENOENT/.test(e.message)) console.error(r.symbol, e.message); continue; }
  const filter = r.set === 'tune' ? (x) => x.period === 'Tuning' : (x) => includeStraddle || x.period !== 'Straddle';
  const p = summarize(t, filter);
  out.push({ ...r, pn: p.n, pw: p.wins, pr: p.r, exact: p.n === r.n && p.wins === r.wins && Math.abs(p.r - r.R) <= 0.05 });
}

if (!args.quiet) {
  console.log('round   combo set     sym   |   TV n/w/R          |  port n/w/R         | dn dw   dR   exact');
  for (const o of out) {
    console.log(`${o.round.padEnd(7)} ${o.combo.padEnd(4)} ${o.set.padEnd(7)} ${o.symbol.padEnd(5)} | ${String(o.n).padStart(3)} ${String(o.wins).padStart(3)} ${o.R.toFixed(2).padStart(7)} | ${String(o.pn).padStart(3)} ${String(o.pw).padStart(3)} ${o.pr.toFixed(2).padStart(7)} | ${String(o.pn - o.n).padStart(3)} ${String(o.pw - o.wins).padStart(3)} ${(o.pr - o.R).toFixed(2).padStart(7)}  ${o.exact ? 'OK' : '--'}`);
  }
}
const groups = {};
for (const o of out) { const k = `${o.round} ${o.combo}`; (groups[k] ||= []).push(o); }
console.log('\ngroup                charts exactN exactNW exactAll   TV n/w/R             port n/w/R');
for (const [k, g] of Object.entries(groups)) {
  const s = (f) => g.reduce((a, o) => a + f(o), 0);
  console.log(`${k.padEnd(20)} ${String(g.length).padStart(5)} ${String(g.filter((o) => o.pn === o.n).length).padStart(6)} ${String(g.filter((o) => o.pn === o.n && o.pw === o.wins).length).padStart(7)} ${String(g.filter((o) => o.exact).length).padStart(8)}   ${s((o) => o.n)}/${s((o) => o.wins)}/${s((o) => o.R).toFixed(2)}   ${s((o) => o.pn)}/${s((o) => o.pw)}/${s((o) => o.pr).toFixed(2)}`);
}
