// Does the conditions verdict carry directional information on its own (no trade module)?
// For every bar, the forward close-to-close move in ATR units at 5 and 20 bars, grouped by the state the
// dashboard showed at that bar's close: FAVOURABLE long, FAVOURABLE short, WAIT (by bias), AVOID.
// "Edge" = the state's signed move minus the all-bar average (drift), signed in the state's direction.
//
//   node tools/backtest/sof/verdict-test.mjs --set egxD|egx60|crypto15|crypto60 [--heldout]
import { runSof } from '../sof-engine.mjs';
import { loadEgxChart, loadCryptoChart, egxMeta_ } from '../sof-data.mjs';
import { EGX30_LIST, EGX70_LIST } from '../ict-engine.mjs';
import { CRYPTO_TUNE, CRYPTO_HELD } from './symbols.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set'), heldOnly = process.argv.includes('--heldout');
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
let symbols, load, heldSyms, split;
if (set.startsWith('crypto')) { symbols = [...CRYPTO_TUNE, ...CRYPTO_HELD]; heldSyms = new Set(CRYPTO_HELD); split = Date.UTC(2025, 10, 1) / 1000; const tf = set === 'crypto15' ? 15 : 60; load = (s) => loadCryptoChart(s, tf); }
else { const res = set === 'egxD' ? '1D' : '60'; const meta = egxMeta_(); const all = [...list(EGX30_LIST), ...list(EGX70_LIST)]; symbols = all.filter((s) => meta[s] && meta[s][res] && !meta[s][res].error); heldSyms = new Set(all.filter((_, i) => i % 2 === 1)); split = Date.UTC(2024, 11, 31, 22) / 1000; load = (s) => loadEgxChart(s, res); }

const H = [5, 20];
const G = {};
const add = (k, v) => { const g = G[k] || (G[k] = { n: 0, s: H.map(() => 0), syms: new Map() }); g.n++; H.forEach((_, j) => { g.s[j] += v[j]; }); };
const symEdge = new Map(); // per symbol: favourable-long fwd20 minus symbol drift
for (const sym of symbols) {
  const c = load(sym), n = c.time.length;
  const r = runSof(c, { keepSeries: true, tradeGate: 'No filter' }), s = r.series;
  let a = NaN; const atr = new Float64Array(n);
  for (let i = 0; i < n; i++) { const tr = i ? Math.max(c.high[i] - c.low[i], Math.abs(c.high[i] - c.close[i - 1]), Math.abs(c.low[i] - c.close[i - 1])) : c.high[i] - c.low[i]; a = i < 14 ? (i ? (a * i + tr) / (i + 1) : tr) : (a * 13 + tr) / 14; atr[i] = a; }
  let dSum = 0, dN = 0, fSum = 0, fN = 0;
  for (let i = 150; i < n - 20; i++) {
    if (!(atr[i] > c.close[i] * 1e-4)) continue;
    if (heldOnly && !(heldSyms.has(sym) || c.time[i] >= split)) continue;
    const v = H.map((h) => (c.close[i + h] - c.close[i]) / atr[i]);
    add('all bars', v); dSum += v[1]; dN++;
    const vd = s.verdict[i], b = s.bias[i];
    const k = vd === 0 ? 'AVOID' : vd === 2 ? (b > 0 ? 'FAVOURABLE long' : 'FAVOURABLE short') : b > 0 ? 'WAIT, bias bullish' : b < 0 ? 'WAIT, bias bearish' : 'WAIT, neutral';
    add(k, v);
    if (k === 'FAVOURABLE long') { fSum += v[1]; fN++; }
  }
  if (fN >= 20 && dN) symEdge.set(sym, fSum / fN - dSum / dN);
}
const drift = G['all bars'].s.map((x) => x / G['all bars'].n);
const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
console.log(`\n${set}${heldOnly ? ' (held-out bars only)' : ''}: forward move in ATR at 5 / 20 bars by dashboard state`);
for (const k of ['all bars', 'FAVOURABLE long', 'FAVOURABLE short', 'WAIT, bias bullish', 'WAIT, bias bearish', 'WAIT, neutral', 'AVOID']) {
  const g = G[k]; if (!g) continue;
  const m = g.s.map((x) => x / g.n);
  const sign = k.includes('short') || k.includes('bearish') ? -1 : 1;
  const edge = m.map((x, j) => sign * (x - drift[j]));
  console.log(`${k.padEnd(20)} n=${String(g.n).padStart(8)} (${(g.n / G['all bars'].n * 100).toFixed(1).padStart(4)}%)  move ${m.map(f).join(' / ')}  ${k === 'all bars' ? '' : 'edge in its direction ' + edge.map(f).join(' / ')}`);
}
const e = [...symEdge.values()];
if (e.length) console.log(`FAVOURABLE long, 20-bar edge per symbol (>= 20 bars): positive on ${e.filter((x) => x > 0).length}/${e.length}`);
