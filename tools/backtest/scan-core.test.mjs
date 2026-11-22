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

test('trimUnfinishedCsvs removes a forming last bar from every CSV, and nothing else', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { trimUnfinishedCsvs } = await import('./scan-core.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-'));
  const head = 'time,open,high,low,close,volume,date\n';
  fs.writeFileSync(path.join(dir, 'AAA.csv'), head + '1,1,1,1,1,1,2026-11-19\n2,1,1,1,1,1,2026-11-22\n');
  fs.writeFileSync(path.join(dir, 'BBB.csv'), head + '1,1,1,1,1,1,2026-11-19\n');
  const n = trimUnfinishedCsvs(dir, cairo('2026-11-22', '12:00'));
  assert.equal(n, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'AAA.csv'), 'utf8'), head + '1,1,1,1,1,1,2026-11-19\n');
  assert.equal(fs.readFileSync(path.join(dir, 'BBB.csv'), 'utf8'), head + '1,1,1,1,1,1,2026-11-19\n');
  assert.equal(trimUnfinishedCsvs(dir, cairo('2026-11-22', '12:00')), 0);
});

test('resultPct is R times the risk % at entry; openPct is the signed move from entry', async () => {
  const { resultPct, openPct } = await import('./scan-core.mjs');
  assert.equal(resultPct({ r: 2, entry: 10, stop: 9 }), 20);
  assert.equal(resultPct({ r: -1.3, entry: 100, stop: 95 }), -6.5);
  assert.equal(resultPct({ r: NaN, entry: 10, stop: 9 }), null);
  assert.equal(openPct({ side: 'long', entry: 10, close: 11 }), 10);
  assert.equal(openPct({ side: 'short', entry: 10, close: 11 }), -10);
});

test('latest.md shows Result % for closed trades and Open % for open ones', async () => {
  const { renderLatest } = await import('./scan-core.mjs');
  const closed = [{ symbol: 'AAA', model: 'PB', side: 'long', openDate: '2026-11-01', closeDate: '2026-11-19', reason: 'Stopped', exit: 9, tpHit: 0, entry: 10, stop: 9, r: -1.2 }];
  const open = [{ symbol: 'BBB', model: 'TR', side: 'long', openDate: '2026-11-10', bars: 7, entry: 20, stop: 18, curStop: 18, tp1: 24, tp2: 26, tp3: 28, tpHit: 0, close: 21, openR: 0.5 }];
  const md = renderLatest({ session: '2026-11-19', symbols: ['AAA', 'BBB'], stale: [], missing: [], lastDate: {}, closedAll: closed, openAll: open, log: { start: '2026-11-21', trades: {} }, trail: true });
  assert.match(md, /\| Stock \| Model \| Opened \| Reason \| Exit \| Targets hit \| R \| Result % \|/);
  assert.match(md, /\| AAA \| PB \| 2026-11-01 \| Stopped \| 9\.000 \| 0 \| -1\.20 \| -12\.0 \|/);
  assert.match(md, /\| Open R \| Open % \|/);
  assert.match(md, /\| BBB \| TR \| .* \| \+0\.50 \| \+5\.0 \|/);
});
