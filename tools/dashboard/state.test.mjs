// node --test tools/dashboard/state.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { provisional, openRows, dayByDay, evaluate } from './state.mjs';

const T = '2026-11-22';
const ct = (o) => ({ symbol: 'AAA', model: 'PB', side: 'long', openDate: '2026-11-01', closeDate: '2026-11-10', entry: 10, stop: 9, tp1: 11, tp2: 12, tp3: 13, tpHit: 0, reason: 'Stopped', exit: 9, r: -1, ...o });
const ot = (o) => ({ symbol: 'AAA', model: 'PB', side: 'long', openDate: '2026-11-01', entry: 10, stop: 9, curStop: 9, tp1: 11, tp2: 12, tp3: 13, tpHit: 0, close: 10, openR: 0, ...o });

test('provisional finds an exit, an entry and a TP1→TP2 target', () => {
  const without = { closedAll: [], openAll: [ot({ symbol: 'AAA' }), ot({ symbol: 'BBB', tpHit: 1 })], lastDate: { AAA: '2026-11-19', BBB: '2026-11-19' } };
  const withRun = {
    closedAll: [ct({ symbol: 'AAA', closeDate: T, r: -1.1 })],
    openAll: [ot({ symbol: 'BBB', tpHit: 2 }), ot({ symbol: 'CCC', openDate: T })],
    lastDate: { AAA: T, BBB: T, CCC: T },
  };
  const p = provisional(withRun, without, T);
  assert.deepEqual(p.exits.map((x) => x.symbol), ['AAA']);
  assert.deepEqual(p.entries.map((x) => x.symbol), ['CCC']);
  assert.deepEqual(p.targets, [{ symbol: 'BBB', model: 'PB', openDate: '2026-11-01', from: 1, to: 2, level: 12 }]);
});

test('provisional is empty when no stock has a bar dated today', () => {
  const run = { closedAll: [ct({ closeDate: T })], openAll: [ot({ openDate: T })], lastDate: { AAA: '2026-11-19' } };
  assert.deepEqual(provisional(run, run, T), { exits: [], entries: [], targets: [] });
});

test('openRows: distance to the stop in % of price and in R', () => {
  const [r] = openRows([ot({ entry: 10, stop: 9, curStop: 9, close: 9.5 })]);
  assert.equal(r.toStopR, 0.5);
  assert.ok(Math.abs(r.toStopPct - 100 * 0.5 / 9.5) < 1e-9);
  assert.equal(r.next, 11);
  const [s] = openRows([ot({ side: 'short', entry: 10, stop: 11, curStop: 11, close: 10.5 })]);
  assert.equal(s.toStopR, 0.5);
});

test('dayByDay keeps only active dates, newest first, within the last N sessions', () => {
  const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
  const d = dayByDay([ct({ openDate: '2026-11-16', closeDate: '2026-11-18' })], [ot({ symbol: 'BBB', openDate: '2026-11-19' })], dates, 3);
  assert.deepEqual(d.map((x) => x.date), ['2026-11-19', '2026-11-18']);
  assert.deepEqual(d[0].entries.map((x) => x.symbol), ['BBB']);
  assert.deepEqual(d[1].exits.map((x) => x.symbol), ['AAA']);
});

test('evaluate: per-stock stats, 12-month window, empty stats', () => {
  const closed = [
    ct({ r: 2, closeDate: '2026-06-01' }), ct({ r: -1, closeDate: '2026-07-01' }), ct({ r: 1, closeDate: '2024-01-01' }),
    ct({ model: 'TR', r: 0.5, closeDate: '2026-08-01' }),
  ];
  const e = evaluate(closed, [ot({ symbol: 'AAA', model: 'TR' })], T, ['AAA', 'ZZZ']);
  const a = e.rows.find((x) => x.symbol === 'AAA');
  assert.deepEqual(a.PB, { n: 3, wins: 2, winPct: 200 / 3, totalR: 2, avgR: 2 / 3 });
  assert.deepEqual(a.PB12, { n: 2, wins: 1, winPct: 50, totalR: 1, avgR: 0.5 });
  assert.equal(a.TR.n, 1);
  assert.equal(a.open.length, 1);
  const z = e.rows.find((x) => x.symbol === 'ZZZ');
  assert.deepEqual(z.PB, { n: 0, wins: 0, winPct: null, totalR: 0, avgR: null });
  assert.equal(e.totals.PB.n, 3);
  assert.equal(e.totals.TR12.n, 1);
});

test('openRows: open % is the price move from entry, signed by side', () => {
  const [l] = openRows([ot({ entry: 10, stop: 9, curStop: 9, close: 9.5 })]);
  assert.equal(l.openPct, -5);
  const [s] = openRows([ot({ side: 'short', entry: 10, stop: 11, curStop: 11, close: 9.5 })]);
  assert.equal(s.openPct, 5);
});
