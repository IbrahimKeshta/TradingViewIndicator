// node --test tools/backtest/sof-engine.test.mjs
// The Session Order Flow port's overlay additions: the Pine drawing registry, the forming-bar rules, render mode
// leaving every decision unchanged, and the liquidity-run model against TradingView's own trade logs.
// Tests that need real bars read SOF_DATA (a data/sof folder: COMI_1D.csv, BTC_240.csv, tvlogs/) and skip without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runSof, buildChart, makeRegistry } from './sof-engine.mjs';
import { readBarsCsv } from './tv-feed.mjs';

const DATA = process.env.SOF_DATA || path.resolve('data/sof');
const has = (f) => fs.existsSync(path.join(DATA, f));

// A daily chart: a sine wave with noise-free wicks, so pivots, pools, sweeps and runs all happen.
function synthChart(n = 600, { tfSecs = 86400, start = Date.UTC(2023, 0, 1) / 1000 } = {}) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const mid = 100 + 20 * Math.sin(i / 17) + 8 * Math.sin(i / 5) + i * 0.02;
    const o = mid - 0.6 * Math.cos(i), c = mid + 0.6 * Math.cos(i * 1.3);
    bars.push([start + i * tfSecs, o, Math.max(o, c) + 1.2, Math.min(o, c) - 1.1, c, 1000 + (i % 7) * 300]);
  }
  return buildChart({ symbol: 'SYN', bars, tfSecs, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: 0.01 });
}

test('registry: creating past the cap deletes the oldest live object, set/del on deleted objects are no-ops', () => {
  const R = makeRegistry({ box: 3, line: 2, label: 2 });
  const a = R.make('box', { k: 'a' }), b = R.make('box', { k: 'b' }), c = R.make('box', { k: 'c' });
  R.del(b);
  const d = R.make('box', { k: 'd' });
  assert.deepEqual(R.live.box.map((o) => o.k), ['a', 'c', 'd']);
  const e = R.make('box', { k: 'e' });
  assert.equal(a.deleted, true);
  assert.deepEqual(R.live.box.map((o) => o.k), ['c', 'd', 'e']);
  R.set(a, { k: 'zz' });
  assert.equal(a.k, 'a');
  R.del(null); R.del(a);
  assert.equal(R.live.box.length, 3);
  assert.ok(c.seq < d.seq && d.seq < e.seq);
});

test('render mode changes no decision: trades, run trades and series are identical', () => {
  const chart = synthChart();
  for (const cfg of [{}, { entryModel: 'Liquidity run (trend)', runTrendLen: 50 }, { tradeGate: 'No filter' }]) {
    const plain = runSof(chart, { ...cfg, keepSeries: true });
    const drawn = runSof(chart, { ...cfg, keepSeries: true, render: true });
    assert.deepEqual(drawn.trades, plain.trades);
    assert.deepEqual(drawn.runTrades, plain.runTrades);
    for (const k of Object.keys(plain.series)) assert.deepEqual(Array.from(drawn.series[k]), Array.from(plain.series[k]), k);
    assert.ok(drawn.drawings.box.length > 0 && drawn.drawings.line.length > 0);
    assert.equal(plain.drawings, null);
  }
});

// A seeded random walk on a 15m crypto chart: three session boxes a day and hundreds of trades.
function walkChart(n) {
  let s = 7, p = 100;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const bars = [], start = Date.UTC(2025, 0, 1) / 1000;
  for (let i = 0; i < n; i++) {
    const o = p; p *= 1 + (rnd() - 0.5) * 0.01;
    bars.push([start + i * 900, o, Math.max(o, p) * (1 + rnd() * 0.002), Math.min(o, p) * (1 - rnd() * 0.002), p, 100 + rnd() * 1000]);
  }
  return buildChart({ symbol: 'W', bars, tfSecs: 900, symType: 'crypto', exTz: 'Etc/UTC', weekStart: 1, mintick: 0.0001 });
}

test('render mode keeps Pine caps: at most 200 boxes, 500 lines, 500 labels, the newest kept', () => {
  const res = runSof(walkChart(20000), { render: true, entryModel: 'Liquidity run (trend)', runTrendLen: 20, runStopAtr: 1, pivotLen: 2, maxPools: 20, keepTaken: 30 });
  const made = (k) => Math.max(...res.drawings[k].map((o) => o.seq));
  assert.ok(res.drawings.box.length <= 200 && made('box') > 400, 'boxes over the cap were created and trimmed');
  assert.ok(res.drawings.line.length <= 500 && res.drawings.label.length <= 500);
  assert.ok(res.drawings.label.length === 500 || res.drawings.line.length === 500, 'a 500 cap is reached');
  assert.ok(res.runTrades.length > 250, `run trades ${res.runTrades.length}`);
  const seqs = res.drawings.box.map((o) => o.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.ok(res.drawings.box.some((o) => o.kind === 'sess' && o.name === 'NEW YORK'));
  assert.ok(res.drawings.label.every((o) => !o.deleted));
});

test('lastBarOpen leaves pools and sessions unresolved on the last bar and opens no trade there', () => {
  const chart = synthChart();
  const cfg = { keepSeries: true, render: true, entryModel: 'Liquidity run (trend)', runTrendLen: 50 };
  const base = runSof(chart, cfg);
  // the last bar where a pool was resolved: cut the chart there and mark it as forming
  let k = chart.time.length - 1;
  while (k > 0 && !(base.series.ev[k] & 15)) k--;
  const cut = buildChart({ symbol: 'SYN', bars: Array.from(chart.time.slice(0, k + 1), (t, i) => [t, chart.open[i], chart.high[i], chart.low[i], chart.close[i], chart.volume[i]]), tfSecs: 86400, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: 0.01 });
  const closed = runSof(cut, cfg), forming = runSof(cut, { ...cfg, lastBarOpen: true });
  assert.ok(closed.series.ev[k] & 15, 'the closed bar resolves a pool');
  assert.equal(forming.series.ev[k] & 255, 0, 'the forming bar resolves nothing');
  assert.ok(forming.series.npools[k] > closed.series.npools[k]);
  const opened = (r) => r.runTrades.filter((t) => t.openIdx === k).length + (r.runOpen && r.runOpen.openIdx === k ? 1 : 0);
  assert.equal(opened(forming), 0);
  assert.ok(forming.final && closed.final);
});

// Pine Logs export of `Log Closed Trades` (lines "RUN open=... close=... dir=... r=...") against the port, costs off.
function compareRunLog(barsFile, logFile, { tfSecs, symType, exTz, weekStart }) {
  const chart = buildChart({ symbol: 'X', bars: readBarsCsv(path.join(DATA, barsFile)), tfSecs, symType, exTz, weekStart, mintick: 0.01 });
  const res = runSof(chart, { entryModel: 'Liquidity run (trend)' });
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16);
  const tv = [];
  for (const line of fs.readFileSync(path.join(DATA, 'tvlogs', logFile), 'utf8').split(/\r?\n/)) {
    const m = /RUN open=(\S+) close=(\S+) dir=(-?1) entry=\S+ stop=\S+ exit=\S+ outcome=(\S+) r=(\S+)/.exec(line);
    if (m) tv.push({ open: m[1], close: m[2], dir: +m[3], why: m[4], r: +m[5] });
  }
  const port = res.runTrades.map((t) => ({ open: iso(t.openTime), close: iso(t.closeTime), dir: t.dir, why: t.why, r: t.r })).filter((t) => t.open >= tv[0].open);
  return { tv, port };
}

test('liquidity run matches TradingView trade by trade: COMI 1D', { skip: !has('tvlogs/RUN_COMI_1D.csv') }, () => {
  const { tv, port } = compareRunLog('COMI_1D.csv', 'RUN_COMI_1D.csv', { tfSecs: 86400, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0 });
  assert.equal(tv.length, 33);
  assert.equal(port.length, tv.length);
  port.forEach((p, k) => { assert.equal(p.open, tv[k].open); assert.equal(p.close, tv[k].close); assert.equal(p.dir, tv[k].dir); assert.equal(p.why, tv[k].why); assert.ok(Math.abs(p.r - tv[k].r) < 1e-3, `${p.open} ${p.r} vs ${tv[k].r}`); });
});

test('liquidity run matches TradingView trade by trade: BTC 4H', { skip: !has('tvlogs/RUN_BTC_240.csv') }, () => {
  const { tv, port } = compareRunLog('BTC_240.csv', 'RUN_BTC_240.csv', { tfSecs: 14400, symType: 'crypto', exTz: 'Etc/UTC', weekStart: 1 });
  assert.equal(tv.length, 46);
  assert.equal(port.length, tv.length);
  port.forEach((p, k) => { assert.equal(p.open, tv[k].open); assert.equal(p.close, tv[k].close); assert.equal(p.dir, tv[k].dir); assert.ok(Math.abs(p.r - tv[k].r) < 1e-3, `${p.open} ${p.r} vs ${tv[k].r}`); });
});

test('buildChart: ltfEnd keeps the forming bar\'s intrabars out of the last closed bar', () => {
  const H = 3600, t0 = Date.UTC(2026, 0, 4, 8) / 1000;
  const bars = [[t0, 1, 2, 0.5, 1.5, 100], [t0 + H, 1.5, 2, 1, 1.8, 100]];
  const m1 = Array.from({ length: 150 }, (_, k) => [t0 + k * 60, 1, 1.1, 0.9, 1, 1]); // 2.5 hours of 1m bars
  const open = buildChart({ symbol: 'X', bars, ltfBars: m1, tfSecs: H, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: 0.01 });
  assert.equal(open.ltf.end[1] - open.ltf.start[1], 90, 'without ltfEnd the last bar takes every later intrabar');
  const closed = buildChart({ symbol: 'X', bars, ltfBars: m1, ltfEnd: t0 + 2 * H, tfSecs: H, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: 0.01 });
  assert.equal(closed.ltf.end[1] - closed.ltf.start[1], 60);
  assert.equal(closed.ltf.end[0] - closed.ltf.start[0], 60);
});
