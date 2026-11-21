// node --test tools/dashboard/server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDashboard } from './server.mjs';

const head = 'time,open,high,low,close,volume,date\n';
const DAY = 86400;
const T0 = Date.parse('2025-01-01T00:00:00Z') / 1000;
const dateOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const cairo = (d, hhmm) => new Date(`${d}T${hhmm}:00+02:00`);

// A deterministic zig-zag trend, enough bars for the engine to open and close trades.
function synth(n, seed, endDate) {
  const end = Date.parse(endDate + 'T00:00:00Z') / 1000;
  const bars = [];
  let p = 10, s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const r = s / 2147483647 - 0.47;
    const o = p; p = Math.max(1, p * (1 + 0.03 * r + 0.01 * Math.sin(i / 9)));
    const time = end - (n - 1 - i) * DAY;
    bars.push({ time, date: dateOf(time), open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p, volume: 1000 });
  }
  return bars;
}
const toCsv = (bars) => head + bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume, b.date].join(',')).join('\n') + '\n';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const bars = { AAA: synth(700, 7, '2026-11-19'), BBB: synth(700, 11, '2026-11-19') };
  for (const [s, b] of Object.entries(bars)) fs.writeFileSync(path.join(data, s + '.csv'), toCsv(b));
  fs.writeFileSync(path.join(data, '_meta.json'), JSON.stringify({ AAA: { mintick: 0.01 }, BBB: { mintick: 0.01 } }));
  return { dir, data, bars, logFile: path.join(dir, 'log.json'), outFile: path.join(dir, 'latest.md') };
}

// Tail = last 30 disk bars plus a forming bar dated 2026-11-22.
const tailOf = (bars) => {
  const last = bars[bars.length - 1];
  const t = Date.parse('2026-11-22T00:00:00Z') / 1000;
  return [...bars.slice(-30), { ...last, time: t, date: '2026-11-22', open: last.close, close: last.close * 0.97, low: last.close * 0.96 }];
};

test('two refreshes at once share one run; one tail fetch per stock', async () => {
  const fx = fixture();
  const calls = [];
  const dash = createDashboard({
    dataDir: fx.data, logFile: fx.logFile, outFile: fx.outFile, universe: ['AAA', 'BBB'], now: () => cairo('2026-11-22', '12:00'),
    fetchTail: async (sym) => { calls.push(sym); await new Promise((r) => setTimeout(r, 20)); return tailOf(fx.bars[sym.split(':')[1]]); },
    fullFetch: async () => { throw new Error('not expected'); },
  });
  const a = dash.refresh(), b = dash.refresh();
  assert.equal(a, b);
  await a;
  assert.deepEqual(calls.sort(), ['EGX:AAA', 'EGX:BBB']);
  const s = dash.state();
  assert.equal(s.mode, 'live');
  assert.equal(s.liveSession, '2026-11-22');
  assert.equal(s.session, '2026-11-19');
  assert.equal(s.feedNote, 'TradingView public feed, may be delayed');
  assert.equal(s.evaluation.rows.length, 2);
  assert.equal(fs.existsSync(fx.logFile), false, 'refresh never writes the forward log');
  assert.equal(fs.readFileSync(path.join(fx.data, 'AAA.csv'), 'utf8'), toCsv(fx.bars.AAA), 'refresh never writes the CSVs');
});

test('a stock whose fetch fails is listed as stale and keeps its disk bars', async () => {
  const fx = fixture();
  const dash = createDashboard({
    dataDir: fx.data, logFile: fx.logFile, outFile: fx.outFile, universe: ['AAA', 'BBB'], now: () => cairo('2026-11-22', '12:00'),
    fetchTail: async (sym) => { if (sym.endsWith('BBB')) throw new Error('timeout'); return tailOf(fx.bars.AAA); },
    fullFetch: async () => {},
  });
  await dash.refresh();
  const s = dash.state();
  assert.deepEqual(s.stale.map((x) => x.symbol), ['BBB']);
  assert.equal(s.stale[0].error, 'timeout');
  assert.equal(s.evaluation.rows.length, 2);
});

test('endOfDay runs the full download and writes the log and latest.md; mode becomes final', async () => {
  const fx = fixture();
  let full = 0;
  const dash = createDashboard({
    dataDir: fx.data, logFile: fx.logFile, outFile: fx.outFile, universe: ['AAA', 'BBB'], now: () => cairo('2026-11-22', '16:00'),
    fetchTail: async (sym) => fx.bars[sym.split(':')[1]].slice(-30),
    fullFetch: async () => { full++; },
  });
  await dash.refresh();
  assert.equal(dash.needsEndOfDay(), true);
  await dash.endOfDay();
  assert.equal(full, 1);
  const log = JSON.parse(fs.readFileSync(fx.logFile, 'utf8'));
  assert.equal(log.updated, '2026-11-19');
  assert.match(fs.readFileSync(fx.outFile, 'utf8'), /^# EGX Daily scan: session 2026-11-19/);
  assert.equal(dash.needsEndOfDay(), false);
  assert.equal(dash.state().mode, 'final');
});

test('a re-adjusted history triggers a full download of that stock only', async () => {
  const fx = fixture();
  const refetched = [];
  const dash = createDashboard({
    dataDir: fx.data, logFile: fx.logFile, outFile: fx.outFile, universe: ['AAA', 'BBB'], now: () => cairo('2026-11-22', '12:00'),
    fetchTail: async (sym) => { const s = sym.split(':')[1]; const t = tailOf(fx.bars[s]); return s === 'BBB' ? t.map((b) => ({ ...b, close: b.close * 0.98 })) : t; },
    fullFetch: async (syms) => { refetched.push(...syms); },
  });
  await dash.refresh();
  assert.deepEqual(refetched, ['BBB']);
});
