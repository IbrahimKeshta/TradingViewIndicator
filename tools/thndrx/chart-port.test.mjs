// node --test tools/thndrx/chart-port.test.mjs
// The real chart lives in ThndrX; these tests drive the port's pure parts and fake charts shaped like the live recon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toBars, mergeTail, isLastBarOpen, historyNote, chartInfo, loadAllBars, findChart, subscribe, makePort, HISTORY_NOTE,
  planWindow, MAX_PLAN_BARS, CAP_NOTE,
} from './chart-port.mjs';

const sec = (iso) => Date.parse(iso) / 1000;

// exportData as the live ThndrX chart returns it (schema copied from the live chart, Arabic study title included).
const SERIES = 'البنك التجاري الدولي, EGX';
const SCHEMA = [
  { type: 'time' },
  ...['open', 'high', 'low', 'close'].map((plotTitle) => ({ type: 'value', sourceType: 'series', plotTitle, sourceTitle: SERIES })),
  { type: 'value', sourceType: 'study', sourceId: 'iQWoz6', sourceTitle: 'حجم التداول', plotTitle: 'Volume', plotId: 'vol' },
];
const exported = (rows, schema = SCHEMA) => ({ schema, data: rows.map((r) => Float64Array.from(r)) });

test('toBars maps the exportData columns into engine bars with the Cairo date', () => {
  const { bars, volumeMissing } = toBars(exported([
    [sec('2023-11-09T07:00:00Z'), 63.7, 66.5, 62.5, 66.3, 5218173],
    [sec('2023-11-11T22:30:00Z'), 66, 67, 65, 66.5, 1000], // 00:30 Cairo on the 12th
    [sec('2023-11-13T00:00:00Z'), 66.5, 68, 66, NaN, NaN],  // a row without a close is not a bar
  ]));
  assert.equal(volumeMissing, false);
  assert.deepEqual(bars, [
    { time: sec('2023-11-09T07:00:00Z'), date: '2023-11-09', open: 63.7, high: 66.5, low: 62.5, close: 66.3, volume: 5218173 },
    { time: sec('2023-11-11T22:30:00Z'), date: '2023-11-12', open: 66, high: 67, low: 65, close: 66.5, volume: 1000 },
  ]);
});

test('toBars flags a chart without the Volume study and leaves volume NaN', () => {
  const { bars, volumeMissing } = toBars(exported([[sec('2024-01-02T00:00:00Z'), 1, 2, 0.5, 1.5]], SCHEMA.slice(0, 5)));
  assert.equal(volumeMissing, true);
  assert.equal(bars.length, 1);
  assert.ok(Number.isNaN(bars[0].volume));
  assert.equal(bars[0].close, 1.5);
});

test('toBars sorts by time and keeps one bar per time', () => {
  const t = sec('2024-01-02T00:00:00Z');
  const { bars } = toBars(exported([[t + 86400, 2, 2, 2, 2, 1], [t, 1, 1, 1, 1, 1], [t + 86400, 3, 3, 3, 3, 1]]));
  assert.deepEqual(bars.map((b) => [b.time, b.close]), [[t, 1], [t + 86400, 3]]);
});

test('toBars refuses an export without the price columns', () => {
  assert.throws(() => toBars(exported([], [{ type: 'time' }])), /open/);
});

test('mergeTail updates the last bar, appends new bars and reports a change only when something moved', () => {
  const t = sec('2024-01-02T00:00:00Z');
  const b = (time, close, volume = 10) => ({ time, date: 'x', open: 1, high: 5, low: 0.5, close, volume });
  const bars = [b(t - 86400, 1), b(t, 2)];
  assert.deepEqual(mergeTail(bars, [b(t, 2)]), { bars, changed: false });
  const upd = mergeTail(bars, [b(t, 2.5)]);
  assert.equal(upd.changed, true);
  assert.deepEqual(upd.bars.map((x) => x.close), [1, 2.5]);
  assert.equal(bars[1].close, 2, 'input not mutated');
  const vol = mergeTail(bars, [b(t, 2, 11)]);
  assert.equal(vol.changed, true);
  const nanVol = mergeTail([b(t, 2, NaN)], [b(t, 2, NaN)]);
  assert.equal(nanVol.changed, false, 'NaN volume equals NaN volume');
  const add = mergeTail(bars, [b(t, 2), b(t + 86400, 3)]);
  assert.equal(add.changed, true);
  assert.deepEqual(add.bars.map((x) => x.time), [t - 86400, t, t + 86400]);
  assert.deepEqual(mergeTail(bars, []), { bars, changed: false });
});

test('isLastBarOpen: daily bar of today is open until the 14:30 Cairo close', () => {
  const bars = [{ time: sec('2026-11-24T00:00:00Z') }]; // Tuesday, Cairo is UTC+2 in November
  assert.equal(isLastBarOpen(bars, '1D', sec('2026-11-24T11:30:00Z')), true);  // 13:30 Cairo
  assert.equal(isLastBarOpen(bars, '1D', sec('2026-11-24T12:31:00Z')), false); // 14:31 Cairo
  assert.equal(isLastBarOpen(bars, 'D', sec('2026-11-25T09:00:00Z')), false);  // next day
  assert.equal(isLastBarOpen([{ time: sec('2026-11-24T07:00:00Z') }], '1D', sec('2026-11-24T08:00:00Z')), true);
});

test('isLastBarOpen: intraday bars end at their length or the session close, whichever comes first', () => {
  const h13 = [{ time: sec('2026-11-24T11:00:00Z') }]; // 13:00 Cairo
  assert.equal(isLastBarOpen(h13, '60', sec('2026-11-24T11:30:00Z')), true);
  assert.equal(isLastBarOpen(h13, '60', sec('2026-11-24T12:00:00Z')), false); // 14:00: bar end reached
  const h14 = [{ time: sec('2026-11-24T12:00:00Z') }]; // 14:00 Cairo, cut by the 14:30 close
  assert.equal(isLastBarOpen(h14, '60', sec('2026-11-24T12:20:00Z')), true);
  assert.equal(isLastBarOpen(h14, '60', sec('2026-11-24T12:35:00Z')), false);
  assert.equal(isLastBarOpen([{ time: sec('2026-11-24T10:55:00Z') }], '5', sec('2026-11-24T10:58:00Z')), true);
});

test('isLastBarOpen: weekly runs to Thursday 14:30, monthly to the last trading day of the month', () => {
  const week = [{ time: sec('2026-11-22T00:00:00Z') }]; // Sunday
  assert.equal(isLastBarOpen(week, '1W', sec('2026-11-24T11:00:00Z')), true);
  assert.equal(isLastBarOpen(week, '1W', sec('2026-11-26T11:00:00Z')), true);  // Thursday 13:00
  assert.equal(isLastBarOpen(week, '1W', sec('2026-11-26T13:00:00Z')), false); // Thursday 15:00
  assert.equal(isLastBarOpen(week, '1W', sec('2026-11-29T09:00:00Z')), false); // next Sunday
  const month = [{ time: sec('2026-11-01T00:00:00Z') }];
  assert.equal(isLastBarOpen(month, '1M', sec('2026-11-24T11:00:00Z')), true);
  assert.equal(isLastBarOpen(month, '1M', sec('2026-11-30T13:00:00Z')), false); // Monday 30th 15:00, the last trading day
  assert.equal(isLastBarOpen(month, '1M', sec('2026-12-01T09:00:00Z')), false);
  assert.equal(isLastBarOpen([], '1D', sec('2026-11-24T11:00:00Z')), false);
});

test('historyNote: only when the first bar sits on the 5-year feed limit', () => {
  const now = sec('2026-11-24T12:00:00Z');
  assert.equal(HISTORY_NOTE, 'History: 5 years (Thndr limit)');
  assert.equal(historyNote(sec('2021-11-24T00:00:00Z'), now), HISTORY_NOTE);
  assert.equal(historyNote(sec('2021-12-20T00:00:00Z'), now), HISTORY_NOTE); // within 30 days
  assert.equal(historyNote(sec('2021-10-28T00:00:00Z'), now), HISTORY_NOTE);
  assert.equal(historyNote(sec('2021-10-20T00:00:00Z'), now), null); // 35 days before the limit: more than Thndr serves
  assert.equal(historyNote(sec('2022-01-02T00:00:00Z'), now), null); // a younger listing: the full series is there
  assert.equal(historyNote(sec('2010-01-03T00:00:00Z'), now), null);
  assert.equal(historyNote(undefined, now), null);
});

const fakeChart = ({ ext, resolution = '1D' } = {}) => ({
  symbol: () => '1923D036-UUID', symbolExt: () => ext, resolution: () => resolution,
});

test('chartInfo reads the display name and tick from symbolExt', () => {
  assert.deepEqual(chartInfo(fakeChart({ ext: { name: 'COMI', exchange: 'EGX', pricescale: 100, minmov: 1 } })), { symbol: 'COMI', mintick: 0.01, resolution: '1D' });
  assert.deepEqual(chartInfo(fakeChart({ ext: { name: 'X', pricescale: 1000, minmov: 5 }, resolution: '60' })), { symbol: 'X', mintick: 0.005, resolution: '60' });
  assert.deepEqual(chartInfo(fakeChart({ ext: null })), { symbol: '1923D036-UUID', mintick: 0.01, resolution: '1D' });
});

// A chart whose history grows in steps after setVisibleRange, like the live feed: 300 bars, then the full window.
function historyChart(steps, { volume = true } = {}) {
  const t0 = sec('2026-11-24T00:00:00Z');
  const rows = (n) => Array.from({ length: n }, (_, k) => {
    const r = [t0 - (n - 1 - k) * 86400, 1, 2, 0.5, 1.5];
    return volume ? [...r, 100] : r;
  });
  let loaded = 0, ranges = [];
  return {
    ranges,
    getVisibleRange: () => ({ from: 111, to: 222 }),
    setVisibleRange: async (r) => { ranges.push(r); if (r.from === sec('1990-01-01T00:00:00Z')) loaded = Math.min(loaded + 1, steps.length - 1); },
    exportData: async () => exported(rows(steps[loaded]), volume ? SCHEMA : SCHEMA.slice(0, 5)),
  };
}

test('loadAllBars pulls history until the first bar stops moving, then restores the view', async () => {
  const chart = historyChart([300, 900, 1213]);
  const sleeps = [];
  const { bars, complete, volumeMissing } = await loadAllBars(chart, { sleep: async (ms) => { sleeps.push(ms); }, now: () => sec('2026-11-24T12:00:00Z') });
  assert.equal(bars.length, 1213);
  assert.equal(complete, true);
  assert.equal(volumeMissing, false);
  assert.ok(sleeps.every((ms) => ms === 2000) && sleeps.length >= 2);
  assert.equal(chart.ranges[0].from, sec('1990-01-01T00:00:00Z'));
  assert.equal(chart.ranges[0].to, sec('2026-11-24T12:00:00Z'));
  assert.deepEqual(chart.ranges[chart.ranges.length - 1], { from: 111, to: 222 }, 'user view restored');
});

test('loadAllBars gives up after maxRounds with complete = false and still restores the view', async () => {
  const chart = historyChart(Array.from({ length: 50 }, (_, k) => 300 + k * 10));
  const { bars, complete } = await loadAllBars(chart, { sleep: async () => {}, maxRounds: 4 });
  assert.equal(complete, false);
  assert.ok(bars.length > 300);
  assert.deepEqual(chart.ranges[chart.ranges.length - 1], { from: 111, to: 222 });
});

test('loadAllBars does not call an empty chart complete', async () => {
  const chart = historyChart([0, 0, 0]);
  const { bars, complete, volumeMissing } = await loadAllBars(chart, { sleep: async () => {}, maxRounds: 3 });
  assert.deepEqual(bars, []);
  assert.equal(complete, false);
  assert.equal(volumeMissing, false);
});

test('loadAllBars reports a missing Volume column', async () => {
  const { volumeMissing } = await loadAllBars(historyChart([300, 300], { volume: false }), { sleep: async () => {} });
  assert.equal(volumeMissing, true);
});

function fakeWin(iframeAfter) {
  let polls = 0;
  const chart = { id: 'chart' };
  const api = { activeChart: () => chart };
  const iframe = { id: 'tradingview_d2f48', contentWindow: { tradingViewApi: api } };
  return {
    chart, api, iframe,
    document: {
      querySelector: (sel) => {
        assert.equal(sel, 'iframe[id^="tradingview_"]');
        return ++polls > iframeAfter ? iframe : null;
      },
    },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout,
  };
}

test('findChart polls until the chart iframe and its API appear', async () => {
  const win = fakeWin(2);
  const found = await findChart(win, 60000);
  assert.equal(found.chart, win.chart);
  assert.equal(found.api, win.api);
  assert.equal(found.iframe, win.iframe);
});

test('findChart rejects after the timeout', async () => {
  await assert.rejects(findChart(fakeWin(Infinity), 20), /no ThndrX chart/);
});

test('subscribe wires symbol and interval changes, polls ticks every 2 s and unsubscribes', () => {
  const events = {};
  const ev = (name) => ({
    subscribe: (obj, cb) => { (events[name] ??= new Set()).add(cb); },
    unsubscribe: (obj, cb) => { events[name].delete(cb); },
  });
  const chart = { onSymbolChanged: () => ev('symbol'), onIntervalChanged: () => ev('interval') };
  const intervals = [];
  const timers = { setInterval: (fn, ms) => { intervals.push({ fn, ms, live: true }); return intervals.length - 1; }, clearInterval: (h) => { intervals[h].live = false; } };
  let reloads = 0, ticks = 0;
  const off = subscribe(chart, { onReload: () => reloads++, onTick: () => ticks++ }, timers);
  for (const cb of events.symbol) cb();
  for (const cb of events.interval) cb();
  assert.equal(reloads, 2);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 2000);
  intervals[0].fn();
  assert.equal(ticks, 1);
  off();
  assert.equal(events.symbol.size, 0);
  assert.equal(events.interval.size, 0);
  assert.equal(intervals[0].live, false);
});

test('makePort forwards to the chart drawing API', async () => {
  const calls = [];
  const chart = {
    createShape: (p, o) => { calls.push(['one', p, o]); return Promise.resolve('a'); },
    createMultipointShape: (ps, o) => { calls.push(['multi', ps, o]); return Promise.resolve('b'); },
    removeEntity: (id, o) => { calls.push(['remove', id, o]); },
  };
  const port = makePort(chart);
  assert.equal(await port.createShape({ time: 1, price: 2 }, { shape: 'text' }), 'a');
  assert.equal(await port.createMultipointShape([{ time: 1, price: 2 }], { shape: 'path' }), 'b');
  port.removeEntity('a', { disableUndo: true });
  assert.deepEqual(calls, [
    ['one', { time: 1, price: 2 }, { shape: 'text' }],
    ['multi', [{ time: 1, price: 2 }], { shape: 'path' }],
    ['remove', 'a', { disableUndo: true }],
  ]);
});

test('loadAllBars stops asking once cancelled and still restores the view', async () => {
  const chart = historyChart(Array.from({ length: 50 }, (_, k) => 300 + k * 10));
  let rounds = 0;
  const res = await loadAllBars(chart, { sleep: async () => { rounds++; }, cancelled: () => rounds >= 2 });
  assert.equal(res.cancelled, true);
  assert.equal(res.complete, false);
  const asks = chart.ranges.filter((r) => r.from === sec('1990-01-01T00:00:00Z')).length;
  assert.equal(asks, 2, 'no history request after the cancel');
  assert.deepEqual(chart.ranges[chart.ranges.length - 1], { from: 111, to: 222 });

  const before = historyChart([300, 1213]);
  const early = await loadAllBars(before, { sleep: async () => {}, cancelled: () => true });
  assert.equal(early.cancelled, true);
  assert.deepEqual(before.ranges, [{ from: 111, to: 222 }], 'cancelled before the first request: only the restore');
});

test('planWindow caps the plan at the newest 20000 bars and joins the notes', () => {
  const now = sec('2026-11-24T12:00:00Z');
  const mk = (n, first) => Array.from({ length: n }, (_, k) => ({ time: first + k * 60 }));
  assert.equal(MAX_PLAN_BARS, 20000);
  assert.equal(CAP_NOTE, 'Computed on the last 20000 bars');

  const small = mk(1213, sec('2021-11-24T00:00:00Z'));
  assert.deepEqual(planWindow(small, now), { bars: small, note: HISTORY_NOTE });

  const young = mk(500, sec('2024-01-01T00:00:00Z'));
  assert.deepEqual(planWindow(young, now), { bars: young, note: null });

  const big = mk(300000, sec('2021-11-24T00:00:00Z'));
  const w = planWindow(big, now);
  assert.equal(w.bars.length, 20000);
  assert.equal(w.bars[0], big[280000]);
  assert.equal(w.bars[19999], big[299999]);
  assert.equal(w.note, `${HISTORY_NOTE} · ${CAP_NOTE}`);

  const bigYoung = mk(20001, sec('2026-01-01T00:00:00Z'));
  assert.equal(planWindow(bigYoung, now).note, CAP_NOTE);
  assert.deepEqual(planWindow([], now), { bars: [], note: null });
});
