// Session Order Flow backtest: every symbol of a set, every Conditions Filter, costs on, held-out tagging
// exactly as fixed in docs/superpowers/plans/2026-11-21-session-orderflow-backtest.md.
//
//   node tools/backtest/sof/backtest.mjs --set crypto15|crypto60|egxD|egx60 [--cfg '{...}'] [--tag name] [--gates "No filter,Not against bias"]
//
// Writes out/sof/<tag>-<set>.json (all trades) and prints the summary tables.
import fs from 'node:fs';
import path from 'node:path';
import { runSof } from '../sof-engine.mjs';
import { loadEgxChart, loadCryptoChart, egxMeta_ } from '../sof-data.mjs';
import { EGX30_LIST, EGX70_LIST } from '../ict-engine.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set');
const tag = arg('tag', 'base');
const userCfg = JSON.parse(arg('cfg', '{}'));
const GATES = arg('gates') ? arg('gates').split(',') : ['No filter', 'Any except Avoid', 'Not against bias', 'Favourable only'];

import { CRYPTO_TUNE, CRYPTO_HELD } from './symbols.mjs';
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const EGX_ALL = [...list(EGX30_LIST), ...list(EGX70_LIST)];

let symbols, heldSyms, split, load, costs;
if (set === 'crypto15' || set === 'crypto60') {
  symbols = [...CRYPTO_TUNE, ...CRYPTO_HELD]; heldSyms = new Set(CRYPTO_HELD);
  split = Date.UTC(2025, 10, 1) / 1000;
  const tf = set === 'crypto15' ? 15 : 60;
  load = (s) => loadCryptoChart(s, tf);
  costs = { costPctPerSide: 0.1 };
} else if (set === 'egxD' || set === 'egx60') {
  const meta = egxMeta_();
  const res = set === 'egxD' ? '1D' : '60';
  symbols = EGX_ALL.filter((s) => meta[s] && meta[s][res] && !meta[s][res].error);
  heldSyms = new Set(EGX_ALL.filter((_, i) => i % 2 === 1));
  split = Date.UTC(2024, 11, 31, 22) / 1000; // 2025-01-01 00:00 Cairo
  load = (s) => loadEgxChart(s, res);
  costs = { costPctPerSide: 0.1, commissionPer: 2.0, positionSize: 100000 };
} else throw new Error('--set crypto15|crypto60|egxD|egx60');

const all = {};
for (const g of GATES) all[g] = [];
const t0 = Date.now();
for (const sym of symbols) {
  const chart = load(sym);
  for (const g of GATES) {
    const r = runSof(chart, { ...costs, ...userCfg, tradeGate: g });
    for (const t of r.trades) {
      all[g].push({ sym, dir: t.dir, openTime: t.openTime, closeTime: t.closeTime, entry: t.entry, risk: t.risk, riskAtr: t.riskAtr, riskPct: t.riskPct, tp2R: Math.abs(t.tp2 - t.entry) / t.risk, outcome: t.outcome, grossR: t.grossR, costR: t.costR, r: t.r, trig: t.trig, verdict: t.verdict, bias: t.bias, valuePos: t.valuePos, held: heldSyms.has(sym) || t.openTime >= split, heldSym: heldSyms.has(sym), afterSplit: t.openTime >= split });
    }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);

function stats(tr) {
  const n = tr.length;
  if (!n) return { n: 0 };
  const sum = (f) => tr.reduce((a, t) => a + f(t), 0);
  const bySym = new Map();
  for (const t of tr) { const a = bySym.get(t.sym) || []; a.push(t); bySym.set(t.sym, a); }
  const elig = [...bySym.values()].filter((a) => a.length >= 5);
  const pos = elig.filter((a) => a.reduce((s, t) => s + t.r, 0) > 0).length;
  const L = tr.filter((t) => t.dir > 0), S = tr.filter((t) => t.dir < 0);
  return {
    n, avg: sum((t) => t.r) / n, gross: sum((t) => t.grossR) / n, cost: sum((t) => t.costR) / n, tot: sum((t) => t.r),
    win: tr.filter((t) => t.r > 0).length / n, stopped: tr.filter((t) => t.outcome === 'stopped').length / n,
    symPos: elig.length ? pos / elig.length : NaN, symN: elig.length,
    longAvg: L.length ? L.reduce((a, t) => a + t.r, 0) / L.length : NaN, nL: L.length,
    shortAvg: S.length ? S.reduce((a, t) => a + t.r, 0) / S.length : NaN, nS: S.length,
  };
}
const f = (v, d = 3) => (v !== v ? '   -  ' : (v >= 0 ? '+' : '') + v.toFixed(d));
const pct = (v) => (v !== v ? '  - ' : (v * 100).toFixed(0).padStart(3) + '%');
console.log(`\n${set}  [${tag}]  ${symbols.length} symbols, ${secs}s  cfg=${JSON.stringify(userCfg)}`);
console.log('Filter              | sample   |     n |  avg R  | gross R | cost R |  win | stop | sym+ (n)   |  long R (n)       | short R (n)');
const out = { set, tag, cfg: userCfg, split, gates: {} };
const base = {};
for (const g of GATES) {
  out.gates[g] = all[g];
  for (const [name, tr] of [['full', all[g]], ['held-out', all[g].filter((t) => t.held)], ['tuning', all[g].filter((t) => !t.held)]]) {
    const s = stats(tr);
    if (name === 'held-out') base[g] = s;
    if (!s.n) { console.log(`${g.padEnd(19)} | ${name.padEnd(8)} |     0`); continue; }
    console.log(`${g.padEnd(19)} | ${name.padEnd(8)} | ${String(s.n).padStart(5)} | ${f(s.avg)} | ${f(s.gross)}  | ${f(s.cost)} | ${pct(s.win)} | ${pct(s.stopped)} | ${pct(s.symPos)} (${String(s.symN).padStart(3)}) | ${f(s.longAvg)} (${String(s.nL).padStart(5)}) | ${f(s.shortAvg)} (${String(s.nS).padStart(5)})`);
  }
}
console.log('\nPass rule on held-out trades: avg >= +0.10R, >= 60% of symbols positive, filter must beat No filter');
for (const g of GATES) {
  const s = base[g]; if (!s || !s.n) continue;
  const c1 = s.avg >= 0.10, c2 = s.symPos >= 0.60, c3 = g === 'No filter' ? null : base['No filter'] && s.avg > base['No filter'].avg;
  console.log(`${g.padEnd(19)} avg ${f(s.avg)} ${c1 ? 'PASS' : 'fail'} | sym+ ${pct(s.symPos)} ${c2 ? 'PASS' : 'fail'}${c3 === null ? '' : ' | beats No filter: ' + (c3 ? 'yes' : 'no')}  => ${c1 && c2 ? 'PASSES' : 'FAILS'}`);
}
fs.mkdirSync('out/sof', { recursive: true });
fs.writeFileSync(path.join('out/sof', `${tag}-${set}.json`), JSON.stringify(out));
