// node --test tools/backtest/pine-log.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTradeLog, portTrade, diffTrades, formatCairoTime, tradeKey } from './pine-log.mjs';

const HEAD = 'Date,Message';
// Same column order as logTrade in src/ict-rsi-ma-indicator.pine.
const line = (open, close) => `${close},"TRADE,PB,COMI,${open.tf},${open.t},${close},long,A,6,7,FVG,100.5,98.5,102.5,104.5,106.5,2,TP2,104.5,1.00,1.52,-0.30,12,1.25,1,0,1,1,0,1,0,Test"`;

test('parses a daily TRADE line', () => {
  const [t] = parseTradeLog([HEAD, line({ tf: 'D', t: '2024-03-05 02:00' }, '2024-03-19 02:00')].join('\n'));
  assert.deepEqual(
    { model: t.model, open: t.open, close: t.close, side: t.side, grade: t.grade, score: t.score, of: t.of, zone: t.zone },
    { model: 'PB', open: '2024-03-05 02:00', close: '2024-03-19 02:00', side: 'long', grade: 'A', score: 6, of: 7, zone: 'FVG' });
  assert.deepEqual([t.entry, t.stop, t.tp1, t.tp2, t.tp3, t.tpHit, t.reason, t.exit], [100.5, 98.5, 102.5, 104.5, 106.5, 2, 'TP2', 104.5]);
  assert.deepEqual([t.r, t.mfe, t.mae, t.bars, t.riskAtr, t.flags, t.period], [1, 1.52, -0.3, 12, 1.25, '1011010', 'Test']);
});

test('dateOnly keeps the day, the default keeps the time of day', () => {
  const text = [HEAD, line({ tf: 'D', t: '2024-03-05 02:00' }, '2024-03-19 02:00')].join('\r\n');
  assert.equal(parseTradeLog(text, { dateOnly: true })[0].open, '2024-03-05');
  assert.equal(parseTradeLog(text)[0].open, '2024-03-05 02:00');
});

test('parses an intraday TRADE line and keeps two same-day trades apart', () => {
  const text = [HEAD, line({ tf: '60', t: '2024-03-05 11:00' }, '2024-03-05 13:00'), line({ tf: '60', t: '2024-03-05 12:00' }, '2024-03-06 10:00')].join('\n');
  const [a, b] = parseTradeLog(text);
  assert.equal(a.open, '2024-03-05 11:00');
  assert.equal(a.close, '2024-03-05 13:00');
  assert.equal(b.close, '2024-03-06 10:00');
  assert.notEqual(tradeKey(a), tradeKey(b));
  assert.equal(tradeKey(a), 'PB|2024-03-05 11:00|long');
});

test('ignores non-TRADE log lines', () => {
  assert.equal(parseTradeLog([HEAD, '2024-03-05 02:00,"something else"'].join('\n')).length, 0);
});

test('formatCairoTime writes Pine yyyy-MM-dd HH:mm in Africa/Cairo (winter UTC+2)', () => {
  assert.equal(formatCairoTime(Date.UTC(2024, 0, 2, 8, 0) / 1000), '2024-01-02 10:00');
  assert.equal(formatCairoTime(Date.UTC(2024, 0, 1, 22, 30) / 1000), '2024-01-02 00:30'); // midnight stays 00, not 24
});

test('diffTrades matches an identical trade and reports a field difference', () => {
  const tv = parseTradeLog([HEAD, line({ tf: '60', t: '2024-03-05 11:00' }, '2024-03-05 13:00')].join('\n'));
  const mineOf = (patch) => [{ ...tv[0], ...patch }];
  const quiet = [];
  const log = (...a) => quiet.push(a.join(' '));
  assert.deepEqual(diffTrades(tv, mineOf({}), log), { matched: 1, fieldDiff: 0, missing: 0, extra: 0 });
  const r = diffTrades(tv, mineOf({ stop: 98 }), log);
  assert.equal(r.fieldDiff, 1);
  assert.ok(quiet.some((l) => l.startsWith('DIFF PB 2024-03-05 11:00 long') && l.includes('stop:98.5/98')));
  assert.deepEqual(diffTrades(tv, mineOf({ open: '2024-03-05 12:00' }), log), { matched: 0, fieldDiff: 0, missing: 1, extra: 1 });
});

test('portTrade maps an engine trade onto the log shape', () => {
  const p = portTrade({ model: 'TR', side: 'long', grade: 'B', score: 5, of: 7, zone: 'OB-A', entry: 1, stop: 0.5, tp1: 2, tp2: 3, tp3: 4, tpHit: 1, reason: 'STOP', exit: 0.5, r: -1, mfeR: 0.2, maeR: -1, bars: 3, riskAtr: 1.1, kz: 1, mom: 0, ma: 1, maj: 0, brk: 0, part: 1, ichi: 0, period: 'Tuning' }, 'o', 'c');
  assert.deepEqual([p.open, p.close, p.mfe, p.mae, p.flags], ['o', 
 'c', 0.2, -1, '1010010']);
});
