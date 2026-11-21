// node --test tools/backtest/scan-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cairoParts, isBarFinished, dropUnfinished } from './scan-core.mjs';

// Cairo is UTC+2 in November (no DST).
const cairo = (d, hhmm) => new Date(`${d}T${hhmm}:00+02:00`);

test('cairoParts reads the Cairo date, minutes and weekday', () => {
  const p = cairoParts(new Date('2026-11-21T23:30:00Z')); // 01:30 Sunday in Cairo
  assert.deepEqual(p, { date: '2026-11-22', minutes: 90, weekday: 0 });
});

test('a bar dated today is unfinished before 15:00 Cairo', () => {
  assert.equal(isBarFinished('2026-11-22', cairo('2026-11-22', '14:59')), false);
  assert.equal(isBarFinished('2026-11-22', cairo('2026-11-22', '10:00')), false);
});

test('a bar dated today is finished from 15:00 Cairo', () => {
  assert.equal(isBarFinished('2026-11-22', cairo('2026-11-22', '15:00')), true);
});

test('an older bar is always finished', () => {
  assert.equal(isBarFinished('2026-11-19', cairo('2026-11-22', '10:00')), true);
});

test('dropUnfinished drops only an unfinished last bar', () => {
  const bars = [{ date: '2026-11-19' }, { date: '2026-11-22' }];
  assert.deepEqual(dropUnfinished(bars, cairo('2026-11-22', '12:00')), [{ date: '2026-11-19' }]);
  assert.equal(dropUnfinished(bars, cairo('2026-11-22', '15:30')).length, 2);
  const old = [{ date: '2026-11-18' }, { date: '2026-11-19' }];
  assert.equal(dropUnfinished(old, cairo('2026-11-22', '12:00')).length, 2);
  assert.deepEqual(dropUnfinished([], cairo('2026-11-22', '12:00')), []);
});
