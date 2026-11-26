// Does the sweep entry have a directional edge at all, independent of stops and targets?
// For every sweep that would open a trade (No filter, one trade at a time as the script does), the signed
// forward close-to-close move after entry, in ATR units, at fixed horizons, against the same move from
// every bar (the drift a random entry would get). Also MFE / MAE in R over the first 10 bars.
//
//   node tools/backtest/sof/diagnose.mjs --set egxD|egx60|crypto15|crypto60
import { runSof } from '../sof-engine.mjs';
import { loadEgxChart, loadCryptoChart, egxMeta_ } from '../sof-data.mjs';
import { EGX30_LIST, EGX70_LIST } from '../ict-engine.mjs';
import { CRYPTO_TUNE, CRYPTO_HELD } from './symbols.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set');
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
let symbols, load;
if (set.startsWith('crypto')) { symbols = [...CRYPTO_TUNE, ...CRYPTO_HELD]; const tf = set === 'crypto15' ? 15 : 60; load = (s) => loadCryptoChart(s, tf); }
else { const res = set === 'egxD' ? '1D' : '60'; const meta = egxMeta_(); symbols = [...list(EGX30_LIST), ...list(EGX70_LIST)].filter((s) => meta[s] && meta[s][res] && !meta[s][res].error); load = (s) => loadEgxChart(s, res); }

const H = [1, 3, 5, 10, 20];
function atrSeries(c) {
  const n = c.time.length, out = new Float64Array(n); let a = NaN;
  for (let i = 0; i < n; i++) {
    const tr = i ? Math.max(c.high[i] - c.low[i], Math.abs(c.high[i] - c.close[i - 1]), Math.abs(c.low[i] - c.close[i - 1])) : c.high[i] - c.low[i];
    a = i < 14 ? (i ? (a * i + tr) / (i + 1) : tr) : (a * 13 + tr) / 14; out[i] = a;
  }
  return out;
}
const acc = () => ({ n: 0, s: H.map(() => 0) });
const res = { long: acc(), short: acc(), baseL: acc() };
const mfe = { long: [], short: [] };
const outcomes = { pool: { n: 0, r: 0 }, ref: { n: 0, r: 0 }, poolref: { n: 0, r: 0 } };
for (const sym of symbols) {
  const c = load(sym), n = c.time.length, atr = atrSeries(c);
  const r = runSof(c, { tradeGate: 'No filter' });
  const idx = new Map(); for (let i = 0; i < n; i++) idx.set(c.time[i], i);
  const okBar = (i) => atr[i] > c.close[i] * 1e-4;
  for (let i = 50; i < n - 20; i++) { if (!okBar(i)) continue; res.baseL.n++; H.forEach((h, k) => { res.baseL.s[k] += (c.close[i + h] - c.close[i]) / atr[i]; }); }
  for (const t of r.trades) {
    const i = idx.get(t.openTime); if (i == null || i >= n - 20 || i < 50 || !okBar(i)) continue;
    const side = t.dir > 0 ? 'long' : 'short';
    res[side].n++; H.forEach((h, k) => { res[side].s[k] += t.dir * (c.close[i + h] - c.close[i]) / atr[i]; });
    let up = 0, dn = 0;
    for (let j = i + 1; j <= i + 10; j++) { up = Math.max(up, t.dir > 0 ? c.high[j] - t.entry : t.entry - c.low[j]); dn = Math.max(dn, t.dir > 0 ? t.entry - c.low[j] : c.high[j] - t.entry); }
    mfe[side].push([up / t.risk, dn / t.risk]);
    const o = outcomes[t.trig] || (outcomes[t.trig] = { n: 0, r: 0 }); o.n++; o.r += t.grossR;
  }
}
const avg = (a) => a.s.map((v) => v / a.n);
const bl = avg(res.baseL);
const fmt = (arr) => arr.map((v) => (v >= 0 ? '+' : '') + v.toFixed(3)).join('  ');
console.log(`\n${set}: signed forward move after entry, ATR units, horizons ${H.join('/')} bars`);
console.log('random bar, long    ', fmt(bl), ` (n=${res.baseL.n})`);
console.log('sweep longs         ', fmt(avg(res.long)), ` (n=${res.long.n})   edge vs random: ${fmt(avg(res.long).map((v, k) => v - bl[k]))}`);
console.log('sweep shorts        ', fmt(avg(res.short)), ` (n=${res.short.n})   edge vs random: ${fmt(avg(res.short).map((v, k) => v + bl[k]))}`);
for (const side of ['long', 'short']) {
  const m = mfe[side]; if (!m.length) continue;
  const reach = (x) => m.filter((p) => p[0] >= x).length / m.length;
  const hitStopFirst = m.filter((p) => p[1] >= 1).length / m.length;
  console.log(`${side.padEnd(5)} first 10 bars: reach +1R ${(reach(1) * 100).toFixed(0)}%, +2R ${(reach(2) * 100).toFixed(0)}%; adverse >= 1R ${(hitStopFirst * 100).toFixed(0)}%`);
}
console.log('gross R by trigger:', Object.entries(outcomes).filter(([, o]) => o.n).map(([k, o]) => `${k} ${(o.r / o.n).toFixed(3)} (n=${o.n})`).join(', '));
