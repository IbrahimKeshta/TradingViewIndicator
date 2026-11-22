// node --test tools/dashboard/live-feed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTail } from './live-feed.mjs';

const b = (time, close, date = 'd' + time) => ({ time, date, open: close, high: close, low: close, close, volume: 1 });

test('replaces bars with the same time and appends newer ones', () => {
  const disk = [b(1, 10), b(2, 11), b(3, 12)];
  const tail = [b(2, 11), b(3, 12.03), b(4, 13)];
  const r = mergeTail(disk, tail);
  assert.deepEqual(r.bars.map((x) => [x.time, x.close]), [[1, 10], [2, 11], [3, 12.03], [4, 13]]);
  assert.equal(r.readjusted, false);
  assert.equal(r.gap, false);
  assert.equal(disk.length, 3, 'disk array is not mutated');
});

test('an overlapping bar off by more than 0.5% means the history was re-adjusted', () => {
  const disk = [b(1, 10), b(2, 10), b(3, 10)];
  assert.equal(mergeTail(disk, [b(2, 10.06), b(3, 10), b(4, 10)]).readjusted, true);
  assert.equal(mergeTail(disk, [b(2, 10.04), b(3, 10), b(4, 10)]).readjusted, false);
});

test('the tail\'s last bar may differ freely (it can be the forming bar)', () => {
  const disk = [b(1, 10), b(2, 10)];
  assert.equal(mergeTail(disk, [b(1, 10), b(2, 11)]).readjusted, false);
});

test('a tail starting after the last disk bar is a gap', () => {
  const r = mergeTail([b(1, 10), b(2, 10)], [b(5, 10), b(6, 10)]);
  assert.equal(r.gap, true);
});

test('an empty tail returns the disk bars unchanged', () => {
  const disk = [b(1, 10)];
  const r = mergeTail(disk, []);
  assert.deepEqual(r.bars, disk);
  assert.equal(r.readjusted, false);
  assert.equal(r.gap, false);
});
