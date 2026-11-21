// Shared helpers for the EGX100 failure-analysis scripts (discovery phase).
//
// HOLDOUT symbols are never loaded: they are excluded here, by an explicit list, before any file is read.
// Discovery = non-holdout symbols, trades whose OPEN (signal) date is < DISC_END.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars } from './data.mjs';

export const HOLDOUT = Object.freeze(['GDWA', 'GOUR', 'GPIM', 'IEEC', 'ICFC', 'IDRE', 'ISMA', 'MPCO', 'MEPA', 'MPCI', 'MBSC', 'OFH', 'PRDC', 'SIPC', 'SDTI', 'MOED', 'VALU', 'UNIP']);
export const DISC_END = '2023-01-01'; // trades opened strictly before this date are discovery

export function parseArgs(argv = process.argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) args[k] = true; else { args[k] = nx; i++; } }
  }
  return args;
}

export function discoverySymbols(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4))
    .filter((s) => !HOLDOUT.includes(s)).sort();
}

// Loads bars for every non-holdout symbol once. Returns { dir, symbols, bars: {sym: bars}, meta, indexBars }.
export function loadUniverse(dirArg) {
  const dir = dirArg ? path.resolve(dirArg) : DATA_DIR;
  const symbols = discoverySymbols(dir);
  for (const s of symbols) if (HOLDOUT.includes(s)) throw new Error('holdout symbol leaked: ' + s);
  const bars = {};
  for (const s of symbols) bars[s] = loadSymbol(s, dir);
  return { dir, symbols, bars, meta: loadMeta(dir), indexBars: loadIndexBars(dir) };
}

// Runs the engine for every symbol with preset tv-base + overrides. Returns ALL closed trades (full history);
// callers must restrict to discovery with isDisc() before computing any statistic.
export function runAll(U, overrides = {}) {
  const cfg = { ...PRESETS['tv-base'], ...overrides };
  const out = [];
  for (const s of U.symbols) {
    const res = runEngine(U.bars[s], cfg, { symbol: s, mintick: U.meta[s]?.mintick ?? 0.01, indexBars: U.indexBars });
    for (const t of res.trades) out.push(t);
  }
  return out;
}
export const isDisc = (t) => t.openDate < DISC_END;

export function stats(trades) {
  let n = 0, w = 0, r = 0;
  const per = new Map();
  for (const t of trades) { n++; if (t.r > 0) w++; r += t.r; per.set(t.symbol, (per.get(t.symbol) || 0) + t.r); }
  const cnt = new Map();
  for (const t of trades) cnt.set(t.symbol, (cnt.get(t.symbol) || 0) + 1);
  let charts = 0, pos = 0;
  for (const [s, c] of cnt) if (c >= 5) { charts++; if (per.get(s) > 0) pos++; }
  return { n, wins: w, win: n ? w / n : NaN, avg: n ? r / n : NaN, total: r, charts, chartsPos: pos, per };
}

export function quantile(arr, q) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}
export const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'NA');
export const pct = (x, d = 0) => (Number.isFinite(x) ? (100 * x).toFixed(d) + '%' : 'NA');
