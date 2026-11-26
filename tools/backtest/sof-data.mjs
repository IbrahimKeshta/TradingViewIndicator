// Chart builders for the Session Order Flow port (sof-engine.mjs).
//   buildChart(...)        generic: chart bars + optional intrabars -> engine input
//   loadEgxChart(sym, res) EGX: '1D' (intrabars 30m) or '60' (intrabars 1m where fetched)
//   loadCryptoChart(sym, tfMin) Binance 1m archive -> 15m / 60m chart, the 1m bars as intrabars
import fs from 'node:fs';
import path from 'node:path';
import { readBarsCsv } from './tv-feed.mjs';
import { buildChart } from './sof-engine.mjs';

export { buildChart };

export const SOF_DATA = path.resolve('data/sof');

// ---------------------------------------------------------------- EGX
let egxMeta = null;
export function egxMeta_() {
  if (!egxMeta) { const f = path.join(SOF_DATA, 'egx', '_meta.json'); egxMeta = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
  return egxMeta;
}
export function loadEgxChart(sym, res, { maxBars = null, cutTime = null, ltf = true } = {}) {
  const dir = path.join(SOF_DATA, 'egx');
  const file = (r) => path.join(dir, `${sym}_${r}.csv`);
  let bars = readBarsCsv(file(res));
  if (cutTime != null) bars = bars.filter((r) => r[0] <= cutTime);
  if (maxBars && bars.length > maxBars) bars = bars.slice(bars.length - maxBars);
  const ltfRes = res === '1D' ? '30' : '1';
  let ltfBars = null;
  if (ltf && fs.existsSync(file(ltfRes))) {
    ltfBars = readBarsCsv(file(ltfRes));
    if (cutTime != null) ltfBars = ltfBars.filter((r) => r[0] < cutTime + (res === '1D' ? 86400 : 3600));
  }
  const m = egxMeta_()[sym] || {};
  return buildChart({ symbol: sym, bars, ltfBars, tfSecs: res === '1D' ? 86400 : Number(res) * 60, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: m.mintick || 0.01 });
}

// ---------------------------------------------------------------- crypto (Binance 1m archive)
export function readBinance1m(sym) {
  const buf = fs.readFileSync(path.join(SOF_DATA, 'binance', `${sym}_1m.bin`));
  return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
}
export const CRYPTO_MINTICK = { BTCUSDT: 0.01, ETHUSDT: 0.01, SOLUSDT: 0.01, XRPUSDT: 0.0001, BNBUSDT: 0.01, DOGEUSDT: 0.00001, ADAUSDT: 0.0001, AVAXUSDT: 0.01, LINKUSDT: 0.01, LTCUSDT: 0.01, DOTUSDT: 0.001, TRXUSDT: 0.00001, BCHUSDT: 0.1, ATOMUSDT: 0.001 };

export function loadCryptoChart(sym, tfMin, { from = null, to = null } = {}) {
  const a = readBinance1m(sym);
  const n1 = a.length / 6, tfSecs = tfMin * 60;
  const m1 = [];
  for (let k = 0; k < n1; k++) {
    const t = a[k * 6];
    if (from != null && t < from) continue;
    if (to != null && t >= to) continue;
    m1.push([t, a[k * 6 + 1], a[k * 6 + 2], a[k * 6 + 3], a[k * 6 + 4], a[k * 6 + 5]]);
  }
  const bars = [];
  let cur = null;
  for (const r of m1) {
    const bt = Math.floor(r[0] / tfSecs) * tfSecs;
    if (!cur || cur[0] !== bt) { cur = [bt, r[1], r[2], r[3], r[4], r[5]]; bars.push(cur); }
    else { cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.min(cur[3], r[3]); cur[4] = r[4]; cur[5] += r[5]; }
  }
  return buildChart({ symbol: sym, bars, ltfBars: m1, tfSecs, symType: 'crypto', exTz: 'Etc/UTC', weekStart: 1, mintick: CRYPTO_MINTICK[sym] || 0.0001 });
}
