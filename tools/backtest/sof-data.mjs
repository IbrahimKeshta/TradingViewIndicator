// Chart builders for the Session Order Flow port (sof-engine.mjs).
//   buildChart(...)        generic: chart bars + optional intrabars -> engine input
//   loadEgxChart(sym, res) EGX: '1D' (intrabars 30m) or '60' (intrabars 1m where fetched)
//   loadCryptoChart(sym, tfMin) Binance 1m archive -> 15m / 60m chart, the 1m bars as intrabars
import fs from 'node:fs';
import path from 'node:path';
import { readBarsCsv } from './tv-feed.mjs';
import { signedVolumeSeries } from './sof-engine.mjs';

export const SOF_DATA = path.resolve('data/sof');

const col = (rows, k) => Float64Array.from(rows, (r) => r[k]);

export function buildChart({ symbol, bars, ltfBars = null, tfSecs, symType, exTz, weekStart, mintick, from = null, to = null }) {
  let b = bars;
  if (from != null) b = b.filter((r) => r[0] >= from);
  if (to != null) b = b.filter((r) => r[0] < to);
  const chart = {
    symbol, mintick, symType, exTz, weekStart, tfSecs,
    isIntraday: tfSecs < 86400, isDaily: tfSecs === 86400, isWeekly: tfSecs === 604800,
    time: col(b, 0), open: col(b, 1), high: col(b, 2), low: col(b, 3), close: col(b, 4), volume: col(b, 5),
    ltf: null,
  };
  if (ltfBars && ltfBars.length) {
    const L = ltfBars;
    const ltf = { time: col(L, 0), open: col(L, 1), high: col(L, 2), low: col(L, 3), close: col(L, 4), vol: col(L, 5) };
    const n = chart.time.length, start = new Int32Array(n), end = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t0 = chart.time[i], t1 = i + 1 < n ? chart.time[i + 1] : Infinity;
      while (k < L.length && ltf.time[k] < t0) k++;
      start[i] = k;
      let e = k;
      while (e < L.length && ltf.time[e] < t1) e++;
      end[i] = e; k = e;
    }
    ltf.start = start; ltf.end = end;
    ltf.signedFor = { tick: signedVolumeSeries(ltf.open, ltf.close, ltf.vol, 'tick'), zero: signedVolumeSeries(ltf.open, ltf.close, ltf.vol, 'zero') };
    chart.ltf = ltf;
  }
  return chart;
}

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
