// Per-symbol feature arrays for the model search (docs/superpowers/plans/2026-11-21-profitable-model-search.md).
// Computed once per (set, symbol) and cached as binary in data/sof/feat/<set>/<sym>.bin.
//
// Sets: c15 c60 c240 c1440 (crypto, Binance 1m archive) and eD e60 (EGX). Final-exam sets get an 'F' suffix
// (c60F, eDF, ...) and read data/sof/binance-final / data/sof/egx-final; nothing else reads those folders.
import fs from 'node:fs';
import path from 'node:path';
import { runSof } from '../sof-engine.mjs';
import { loadCryptoChart, loadEgxChart, buildChart, SOF_DATA } from '../sof-data.mjs';
import { readBarsCsv } from '../tv-feed.mjs';

export const COLS = ['time', 'open', 'high', 'low', 'close', 'volume', 'atr', 'atr100', 'ema5', 'ema20', 'ema50', 'ema200', 'hh20', 'll20', 'hh55', 'll55', 'rsi2', 'rsi14',
  'verdict', 'bias', 'poc', 'vah', 'val', 'prevPoc', 'ev', 'rangeUsed', 'cumDelta', 'bbw'];

const isFinal = (set) => set.endsWith('F');
export const setInfo = (set) => {
  const base = isFinal(set) ? set.slice(0, -1) : set;
  if (base.startsWith('c')) return { market: 'crypto', tfMin: Number(base.slice(1)), final: isFinal(set) };
  return { market: 'egx', res: base === 'eD' ? '1D' : '60', final: isFinal(set) };
};

function ema(src, len) { const out = new Float64Array(src.length); const a = 2 / (len + 1); let p = NaN; for (let i = 0; i < src.length; i++) { p = p !== p ? src[i] : a * src[i] + (1 - a) * p; out[i] = p; } return out; }
function rma(src, len) { const n = src.length, out = new Float64Array(n).fill(NaN); let s = 0; for (let i = 0; i < n; i++) { if (i < len) { s += src[i]; if (i === len - 1) out[i] = s / len; } else out[i] = (out[i - 1] * (len - 1) + src[i]) / len; } return out; }
function rsi(c, len) { const n = c.length, up = new Float64Array(n), dn = new Float64Array(n); for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); } const u = rma(up, len), d = rma(dn, len); return Float64Array.from(u, (x, i) => (d[i] === 0 ? 100 : 100 - 100 / (1 + x / d[i]))); }
// highest high of the N bars BEFORE bar i (so a close above it is a fresh breakout)
function priorHighest(h, N) { const n = h.length, out = new Float64Array(n).fill(NaN); const dq = []; for (let i = 0; i < n; i++) { if (i >= N) out[i] = h[dq[0]]; while (dq.length && h[dq[dq.length - 1]] <= h[i]) dq.pop(); dq.push(i); if (dq[0] <= i - N) dq.shift(); } return out; }
function priorLowest(l, N) { const neg = Float64Array.from(l, (x) => -x); return Float64Array.from(priorHighest(neg, N), (x) => -x); }

function loadChart(set, sym) {
  const s = setInfo(set);
  if (s.market === 'crypto') {
    if (!s.final) return loadCryptoChart(sym, s.tfMin);
    // final-exam coins: same loader, other folder
    const buf = fs.readFileSync(path.join(SOF_DATA, 'binance-final', `${sym}_1m.bin`));
    const a = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    const tfSecs = s.tfMin * 60, m1 = [], bars = []; let cur = null;
    for (let k = 0; k < a.length; k += 6) { const r = [a[k], a[k + 1], a[k + 2], a[k + 3], a[k + 4], a[k + 5]]; m1.push(r); const bt = Math.floor(r[0] / tfSecs) * tfSecs; if (!cur || cur[0] !== bt) { cur = [bt, r[1], r[2], r[3], r[4], r[5]]; bars.push(cur); } else { cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.min(cur[3], r[3]); cur[4] = r[4]; cur[5] += r[5]; } }
    const mt = Math.pow(10, -Math.max(2, Math.min(6, 4 - Math.floor(Math.log10(bars[bars.length - 1][4])))));
    return buildChart({ symbol: sym, bars, ltfBars: m1, tfSecs, symType: 'crypto', exTz: 'Etc/UTC', weekStart: 1, mintick: mt });
  }
  if (!s.final) return loadEgxChart(sym, s.res);
  const dir = path.join(SOF_DATA, 'egx-final');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'))[sym] || {};
  const bars = readBarsCsv(path.join(dir, `${sym}_${s.res}.csv`));
  const ltfFile = path.join(dir, `${sym}_${s.res === '1D' ? '30' : '1'}.csv`);
  const ltfBars = fs.existsSync(ltfFile) ? readBarsCsv(ltfFile) : null;
  return buildChart({ symbol: sym, bars, ltfBars, tfSecs: s.res === '1D' ? 86400 : 3600, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: meta.mintick || 0.01 });
}

export function computeFeatures(set, sym) {
  return featuresFromChart(loadChart(set, sym), sym);
}

export function featuresFromChart(chart, sym = chart.symbol) {
  const r = runSof(chart, { keepSeries: true, tradeGate: 'No filter' });
  const { time, open, high, low, close, volume } = chart;
  const n = time.length;
  const tr = new Float64Array(n);
  for (let i = 0; i < n; i++) tr[i] = i ? Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])) : high[i] - low[i];
  const sd20 = new Float64Array(n).fill(NaN), ma20 = new Float64Array(n).fill(NaN);
  for (let i = 19; i < n; i++) { let m = 0; for (let k = i - 19; k <= i; k++) m += close[k]; m /= 20; let v = 0; for (let k = i - 19; k <= i; k++) v += (close[k] - m) ** 2; ma20[i] = m; sd20[i] = Math.sqrt(v / 20); }
  const f = {
    time, open, high, low, close, volume,
    atr: rma(tr, 14), atr100: rma(tr, 100), ema5: ema(close, 5), ema20: ema(close, 20), ema50: ema(close, 50), ema200: ema(close, 200),
    hh20: priorHighest(high, 20), ll20: priorLowest(low, 20), hh55: priorHighest(high, 55), ll55: priorLowest(low, 55),
    rsi2: rsi(close, 2), rsi14: rsi(close, 14),
    verdict: Float64Array.from(r.series.verdict), bias: Float64Array.from(r.series.bias), poc: r.series.devPoc, vah: r.series.devVah, val: r.series.devVal, prevPoc: r.series.prevPoc,
    ev: Float64Array.from(r.series.ev), rangeUsed: r.series.rangeUsedPct, cumDelta: r.series.cumDelta,
    bbw: Float64Array.from(sd20, (x, i) => (4 * x) / ma20[i]),
  };
  f.n = n; f.sym = sym; f.mintick = chart.mintick;
  return f;
}

export function loadFeatures(set, sym) {
  const dir = path.join(SOF_DATA, 'feat', set), file = path.join(dir, sym + '.bin');
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    const hlen = buf.readUInt32LE(0), head = JSON.parse(buf.subarray(4, 4 + hlen).toString());
    const off = 4 + hlen + ((8 - ((4 + hlen) % 8)) % 8);
    const all = new Float64Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + head.n * COLS.length * 8));
    const f = { n: head.n, sym, mintick: head.mintick };
    COLS.forEach((c, k) => { f[c] = all.subarray(k * head.n, (k + 1) * head.n); });
    return f;
  }
  const f = computeFeatures(set, sym);
  fs.mkdirSync(dir, { recursive: true });
  const head = Buffer.from(JSON.stringify({ n: f.n, mintick: f.mintick }));
  const pad = (8 - ((4 + head.length) % 8)) % 8;
  const all = new Float64Array(f.n * COLS.length);
  COLS.forEach((c, k) => all.set(f[c], k * f.n));
  const h4 = Buffer.alloc(4); h4.writeUInt32LE(head.length);
  fs.writeFileSync(file, Buffer.concat([h4, head, Buffer.alloc(pad), Buffer.from(all.buffer)]));
  return f;
}
