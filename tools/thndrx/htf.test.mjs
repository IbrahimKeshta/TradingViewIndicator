import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBars } from './test-bars.mjs';
import { tfSeconds, resampleBars, htfBiasSeries } from './htf.mjs';

const SUN = Date.parse('2024-01-07T08:00:00Z') / 1000; // Sunday, 10:00 Cairo (UTC+2 in winter)
const DAY = 86400;

// One bar per trading day, Sun..Thu, two weeks (Fri/Sat skipped).
function twoWeeksDaily() {
  return [...makeBars([10, 11, 12, 11, 10], { start: SUN }), ...makeBars([11, 12, 13, 12, 11], { start: SUN + 7 * DAY })];
}
// `perDay` hourly bars per Cairo day, every bar of day d closing at dayCloses[d].
function hourlyDays(dayCloses, perDay) {
  return dayCloses.flatMap((c, d) => makeBars(Array(perDay).fill(c), { start: SUN + d * DAY, stepSec: 3600 }));
}

test('tfSeconds parses minutes, days, weeks and months', () => {
  assert.equal(tfSeconds('1'), 60);
  assert.equal(tfSeconds('60'), 3600);
  assert.equal(tfSeconds('240'), 14400);
  assert.equal(tfSeconds('1D'), 86400);
  assert.equal(tfSeconds('D'), 86400);
  assert.equal(tfSeconds('1W'), 604800);
  assert.equal(tfSeconds('W'), 604800);
  assert.equal(tfSeconds('1M'), 2592000);
  assert.throws(() => tfSeconds('banana'));
});

test('daily bars group into Sunday weeks', () => {
  const bars = twoWeeksDaily();
  const { htfBars, map } = resampleBars(bars, '1W');
  assert.equal(htfBars.length, 2);
  assert.deepEqual([...map], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  assert.equal(htfBars[0].open, bars[0].open);
  assert.equal(htfBars[0].close, bars[4].close);
  assert.equal(htfBars[0].high, Math.max(...bars.slice(0, 5).map((b) => b.high)));
  assert.equal(htfBars[0].low, Math.min(...bars.slice(0, 5).map((b) => b.low)));
  assert.equal(htfBars[0].volume, 5000);
  assert.equal(htfBars[1].time, bars[5].time);
});

test('a Thursday and the next Sunday fall in different weeks', () => {
  const bars = [...makeBars([10], { start: SUN + 4 * DAY }), ...makeBars([11], { start: SUN + 7 * DAY })];
  assert.deepEqual([...resampleBars(bars, '1W').map], [0, 1]);
});

test('60m bars group into Cairo days', () => {
  const bars = hourlyDays([10, 11], 5);
  assert.equal(bars.length, 10);
  assert.deepEqual([...resampleBars(bars, '1D').map], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
});

test('Cairo midnight, not UTC midnight, splits the days (summer UTC+3)', () => {
  // 20:59Z in July is 23:59 in Cairo (UTC+3), and two minutes later it is already the next Cairo day.
  const t = Date.parse('2024-07-07T20:59:00Z') / 1000;
  const bars = makeBars([10, 11], { start: t, stepSec: 120 });
  assert.deepEqual([...resampleBars(bars, '1D').map], [0, 1]);
});

test('minute timeframes floor to Cairo clock buckets', () => {
  const bars = makeBars([1, 2, 3, 4, 5, 6], { start: SUN, stepSec: 1800 }); // 10:00, 10:30, 11:00, ... Cairo
  assert.deepEqual([...resampleBars(bars, '60').map], [0, 0, 1, 1, 2, 2]);
  assert.deepEqual([...resampleBars(bars, '120').map], [0, 0, 0, 0, 1, 1]);
});

test('intraday buckets anchor to the 10:00 session open, not Cairo midnight', () => {
  const bars = makeBars(Array.from({ length: 10 }, (_, i) => 10 + i), { start: SUN, stepSec: 1800 }); // 10:00 .. 14:30
  const { htfBars, map } = resampleBars(bars, '240');
  assert.equal(htfBars.length, 2);
  assert.deepEqual([...map], [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]); // 10:00-13:30 bars, then 14:00 and 14:30
  assert.equal(htfBars[0].time, bars[0].time);
  assert.equal(htfBars[1].time, bars[8].time);
  assert.equal(htfBars[0].close, bars[7].close);
  assert.deepEqual([...resampleBars(bars, '120').map], [0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
});

test('bars before the open form their own bucket at the start of that day', () => {
  const bars = makeBars([1, 2, 3], { start: SUN - 3600, stepSec: 3600 }); // 09:00, 10:00, 11:00 Cairo
  assert.deepEqual([...resampleBars(bars, '240').map], [0, 1, 1]);
});

test('bias reads the previous closed HTF bar', () => {
  // Daily closes with a swing high of 12.12 (day 3, confirmed day 5) broken by day 8's close of 13.
  const dayCloses = [10, 11, 12, 11, 10, 9, 10, 11, 13, 14, 15, 16];
  const bars = hourlyDays(dayCloses, 2);
  const { bias, active } = htfBiasSeries(bars, { htfBiasTf: '1D', htfSwingLen: 2 }, '60');
  assert.equal(active, true);
  const perDay = (d) => [...bias.slice(2 * d, 2 * d + 2)];
  for (let d = 0; d <= 8; d++) assert.deepEqual(perDay(d), [0, 0], `day ${d}`); // day 8 itself still reads day 7
  for (let d = 9; d <= 11; d++) assert.deepEqual(perDay(d), [1, 1], `day ${d}`);
});

test('a close through a swing low turns the bias bearish, one HTF bar late', () => {
  const dayCloses = [20, 19, 18, 19, 20, 21, 20, 19, 17, 16, 15, 14];
  const { bias } = htfBiasSeries(hourlyDays(dayCloses, 2), { htfBiasTf: '1D', htfSwingLen: 2 }, '60');
  const perDay = (d) => [...bias.slice(2 * d, 2 * d + 2)];
  assert.deepEqual(perDay(0), [0, 0]);
  assert.ok(perDay(11).every((v) => v === -1), 'late days are bearish');
  const first = [...bias].findIndex((v) => v === -1);
  assert.equal(first % 2, 0, 'the flip lands on a day boundary');
  assert.ok(first >= 18, 'the flip is not visible before the day after the break');
});

test('inactive when chart tf >= htf', () => {
  const bars = twoWeeksDaily();
  for (const chartTf of ['1W', '1D']) {
    const r = htfBiasSeries(bars, { htfBiasTf: '1D', htfSwingLen: 5 }, chartTf);
    assert.equal(r.active, false);
    assert.ok(r.bias.every((v) => v === 0));
    assert.equal(r.bias.length, bars.length);
  }
});
