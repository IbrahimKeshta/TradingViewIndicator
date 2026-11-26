// node --test tools/thndrx/sof-ltf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { tfSeconds, ltfFor, baseFor, aggregate, findDatafeed, pageBars, createLtfCache, loadBase, mergeRows, overlapAgrees, refreshTail } from './sof-ltf.mjs';

const T = (iso) => Date.parse(iso) / 1000;
const noSleep = async () => {};

// EGX-like base bars: every `stepMin` minutes 10:00-14:30 Cairo (UTC+2 in winter), Sunday to Thursday.
function egxBars(fromIso, days, stepMin, { skipDays = [] } = {}) {
  const rows = [];
  let d = T(fromIso);
  for (let k = 0; k < days; k++, d += 86400) {
    const dow = new Date(d * 1000).getUTCDay();
    if (dow === 5 || dow === 6 || skipDays.includes(k)) continue;
    for (let m = 600; m < 870; m += stepMin) {
      const t = d + (m - 120) * 60, px = 100 + Math.sin(t / 7200);
      rows.push([t, px, px + 0.5, px - 0.5, px + 0.1, 10]);
    }
  }
  return rows;
}

// A datafeed shaped like Thndr's: ignores most of `from`, returns at most `cap` bars ending before `to`, ms times.
function fakeDatafeed(rows, { cap = 3000, failAt = -1, failFrom = Infinity, inclusiveTo = false } = {}) {
  const calls = [];
  return {
    calls,
    resolveSymbol: (name, ok) => ok({ name, ticker: name }),
    getBars(si, res, { from, to, countBack }, onResult, onError) {
      calls.push({ res, from, to });
      if (calls.length === failAt || calls.length >= failFrom) return onError('boom');
      if (!countBack) return onResult([], { noData: true });
      const within = rows.filter((r) => (inclusiveTo ? r[0] <= to : r[0] < to) && r[0] >= from - 5 * 86400);
      const out = within.slice(-cap).map((r) => ({ time: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
      onResult(out, { noData: out.length === 0 });
    },
  };
}

test('ltfFor follows Pine: Auto is 1 / 30 / 240, and nothing when not below the chart', () => {
  assert.equal(ltfFor('60', 'Auto'), 1);
  assert.equal(ltfFor('1D', 'Auto'), 30);
  assert.equal(ltfFor('1W', 'Auto'), 240);
  assert.equal(ltfFor('1M', 'Auto'), 240);
  assert.equal(ltfFor('1', 'Auto'), null);
  assert.equal(ltfFor('15', '15'), null);
  assert.equal(ltfFor('15', '5'), 5);
  assert.equal(ltfFor('1D', '240'), 240);
  assert.equal(tfSeconds('1D'), 86400);
});

test('baseFor picks the largest Thndr base resolution that divides the wanted minutes', () => {
  assert.deepEqual([1, 3, 5, 15, 30, 60, 240].map(baseFor), [1, 1, 5, 5, 10, 60, 60]);
});

test('aggregate: 10m -> 30m buckets start on the session open, OHLCV folded', () => {
  const rows = egxBars('2026-01-04T00:00:00Z', 1, 10); // a Sunday
  const out = aggregate(rows, 30, { tz: 'Africa/Cairo', sessionStartMin: 600 });
  assert.equal(out.length, 9);
  assert.equal(out[0][0], T('2026-01-04T08:00:00Z')); // 10:00 Cairo
  assert.equal(out[1][0], T('2026-01-04T08:30:00Z'));
  assert.equal(out[0][1], rows[0][1]);
  assert.equal(out[0][4], rows[2][4]);
  assert.equal(out[0][5], 30);
  assert.equal(out[0][2], Math.max(rows[0][2], rows[1][2], rows[2][2]));
});

test('aggregate: 60m -> 240m on EGX gives 10:00-14:00 and 14:00-14:30, not the UTC grid', () => {
  const rows = egxBars('2026-01-04T00:00:00Z', 1, 60);
  const out = aggregate(rows, 240, { tz: 'Africa/Cairo', sessionStartMin: 600 });
  assert.deepEqual(out.map((r) => r[0]), [T('2026-01-04T08:00:00Z'), T('2026-01-04T12:00:00Z')]);
  assert.equal(out[0][5], 40);
  const utc = aggregate(rows, 240);
  assert.deepEqual(utc.map((r) => r[0]), [T('2026-01-04T08:00:00Z'), T('2026-01-04T12:00:00Z')]);
  const summer = aggregate(egxBars('2026-07-05T00:00:00Z', 1, 60).map((r) => [r[0] - 3600, ...r.slice(1)]), 240, { tz: 'Africa/Cairo', sessionStartMin: 600 });
  assert.equal(summer[0][0], T('2026-07-05T07:00:00Z')); // 10:00 Cairo summer time (UTC+3)
});

test('findDatafeed reads the frame path and returns null when it is missing or broken', () => {
  const df = { getBars() {}, resolveSymbol() {} };
  assert.equal(findDatafeed({ ChartApiInstance: { _studyEngine: { _externalDatafeed: df } } }), df);
  assert.equal(findDatafeed({}), null);
  assert.equal(findDatafeed({ ChartApiInstance: { _studyEngine: { _externalDatafeed: { getBars: 1 } } } }), null);
  assert.equal(findDatafeed({ get ChartApiInstance() { throw new Error('gone'); } }), null);
});

test('pageBars reads backwards to fromSec in chunks and returns ascending rows with no duplicates', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 200, 10);
  const df = fakeDatafeed(rows, { cap: 1000 });
  const from = T('2025-02-01T00:00:00Z');
  const got = await pageBars(df, {}, 10, { fromSec: from, toSec: T('2026-01-01T00:00:00Z'), sleep: noSleep });
  const want = rows.filter((r) => r[0] >= from);
  assert.equal(got.length, want.length);
  assert.deepEqual(got[0], want[0]);
  assert.deepEqual(got[got.length - 1], want[want.length - 1]);
  assert.ok(df.calls.length > 3);
  assert.ok(df.calls.every((c) => c.res === '10'));
});

test('paging steps over an empty chunk (a long holiday) and keeps going', async () => {
  const skip = Array.from({ length: 40 }, (_, k) => 60 + k); // 40 days without trading
  const rows = egxBars('2025-01-05T00:00:00Z', 160, 60, { skipDays: skip });
  const df = fakeDatafeed(rows, { cap: 50 });
  const got = await pageBars(df, {}, 60, { fromSec: rows[0][0], toSec: T('2026-01-01T00:00:00Z'), sleep: noSleep });
  assert.equal(got.length, rows.length);
});

test('pageBars stops when cancelled, retries a failed request, and rejects when the feed keeps failing', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 100, 10);
  const to = T('2026-01-01T00:00:00Z');
  let n = 0;
  assert.equal(await pageBars(fakeDatafeed(rows, { cap: 200 }), {}, 10, { fromSec: rows[0][0], toSec: to, sleep: noSleep, cancelled: () => ++n > 2 }), null);
  const pauses = [];
  const once = await pageBars(fakeDatafeed(rows, { failAt: 2, cap: 200 }), {}, 10, { fromSec: rows[0][0], toSec: to, sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(once.length, rows.length, 'one failed request is retried');
  assert.ok(pauses.includes(1500));
  await assert.rejects(pageBars(fakeDatafeed(rows, { failFrom: 2, cap: 200 }), {}, 10, { fromSec: rows[0][0], toSec: to, sleep: noSleep }), /boom/);
});

test('an inclusive to that returns only the cursor bar ends the series (the first bar of the feed)', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 60, 10);
  const df = fakeDatafeed(rows, { cap: 500, inclusiveTo: true });
  const got = await pageBars(df, {}, 10, { fromSec: rows[0][0] - 30 * 86400, toSec: T('2026-01-01T00:00:00Z'), sleep: noSleep });
  assert.equal(got.length, rows.length);
  assert.deepEqual(got.map((r) => r[0]), rows.map((r) => r[0]));
  assert.ok(df.calls.length <= Math.ceil(rows.length / 499) + 2, `${df.calls.length} requests`);
});

test('loadBase: first load reads everything, the second only the tail; a rescaled history forces a full read', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 120, 10);
  const cache = createLtfCache();
  const fromSec = rows[0][0], nowSec = rows[rows.length - 1][0] + 600;
  const df1 = fakeDatafeed(rows, { cap: 1000 });
  const a = await loadBase({ df: df1, si: {}, base: 10, key: 'X|10', fromSec, nowSec, cache, sleep: noSleep });
  assert.equal(a.rows.length, rows.length);
  assert.equal(a.stale, false);
  const df2 = fakeDatafeed(rows, { cap: 1000 });
  const b = await loadBase({ df: df2, si: {}, base: 10, key: 'X|10', fromSec, nowSec, cache, sleep: noSleep });
  assert.deepEqual(b, a);
  assert.equal(df2.calls.length, 1, 'one request for the tail');
  const split = rows.map((r) => [r[0], r[1] / 2, r[2] / 2, r[3] / 2, r[4] / 2, r[5] * 2]);
  const df3 = fakeDatafeed(split, { cap: 1000 });
  const c = await loadBase({ df: df3, si: {}, base: 10, key: 'X|10', fromSec, nowSec, cache, sleep: noSleep });
  assert.deepEqual(c.rows, split);
  assert.ok(df3.calls.length > 2, 'full read after the split');
});

test('loadBase: a failing tail read keeps the cached series, flagged stale', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 60, 10);
  const cache = createLtfCache();
  const fromSec = rows[0][0], nowSec = rows[rows.length - 1][0] + 600;
  await loadBase({ df: fakeDatafeed(rows, { cap: 5000 }), si: {}, base: 10, key: 'S|10', fromSec, nowSec, cache, sleep: noSleep });
  const got = await loadBase({ df: fakeDatafeed(rows, { failFrom: 1 }), si: {}, base: 10, key: 'S|10', fromSec, nowSec, cache, sleep: noSleep });
  assert.equal(got.stale, true);
  assert.equal(got.rows.length, rows.length);
});

test('the cache writes to IndexedDB on full loads and bar closes only, never on the panel top-up', async () => {
  const puts = [];
  const cache = createLtfCache();
  const realPut = cache.put;
  cache.put = (key, entry, opts) => { puts.push(opts ? opts.persist : true); return realPut(key, entry, opts); };
  const rows = egxBars('2025-01-05T00:00:00Z', 10, 10);
  await cache.put('P', { from: rows[0][0], rows: rows.slice(0, -5) });
  const grown = { df: fakeDatafeed(rows), si: {}, base: 10, key: 'P', rows: rows.slice(0, -5), nowSec: rows[rows.length - 1][0] + 60, cache, sleep: noSleep };
  await refreshTail({ ...grown, persist: false });
  await refreshTail(grown);
  assert.deepEqual(puts, [true, false, true]);
});

test('mergeRows and refreshTail: the newest read of a bar wins', async () => {
  assert.deepEqual(mergeRows([[1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2]], [[2, 9, 9, 9, 9, 9], [3, 3, 3, 3, 3, 3]]).map((r) => r[1]), [1, 9, 3]);
  assert.equal(overlapAgrees([[1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2]], [[1, 1, 1, 1, 1, 5], [2, 7, 7, 7, 7, 7]]), true);
  assert.equal(overlapAgrees([[1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2]], [[1, 2, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2]]), false);
  const rows = egxBars('2025-01-05T00:00:00Z', 10, 10);
  const grown = rows.concat([[rows[rows.length - 1][0] + 86400 * 3, 5, 6, 4, 5, 1]]);
  const out = await refreshTail({ df: fakeDatafeed(grown), si: {}, base: 10, key: 'Y', rows, nowSec: grown[grown.length - 1][0] + 60, cache: createLtfCache(), sleep: noSleep });
  assert.equal(out.length, grown.length);
});

test('requests carry whole-second timestamps even when the clock has a fraction', async () => {
  const rows = egxBars('2025-01-05T00:00:00Z', 30, 10);
  const df = fakeDatafeed(rows, { cap: 5000 });
  await pageBars(df, {}, 10, { fromSec: rows[0][0] + 0.25, toSec: rows[rows.length - 1][0] + 60.656, sleep: noSleep });
  assert.ok(df.calls.every((c) => Number.isInteger(c.from) && Number.isInteger(c.to)), JSON.stringify(df.calls[0]));
});

test('a blocked IndexedDB (another tab on the old version) never hangs the load: it runs without persistence', async () => {
  const blockedIdb = { open: () => { const req = {}; setTimeout(() => req.onblocked && req.onblocked(), 5); return req; } };
  const cache = createLtfCache({ idb: blockedIdb });
  const rows = egxBars('2025-01-05T00:00:00Z', 20, 10);
  const got = await loadBase({ df: fakeDatafeed(rows), si: {}, base: 10, key: 'B|10', fromSec: rows[0][0], nowSec: rows[rows.length - 1][0] + 60, cache, sleep: noSleep });
  assert.equal(got.rows.length, rows.length);
  const again = await loadBase({ df: fakeDatafeed(rows), si: {}, base: 10, key: 'B|10', fromSec: rows[0][0], nowSec: rows[rows.length - 1][0] + 60, cache, sleep: noSleep });
  assert.equal(again.rows.length, rows.length, 'the memory cache still serves it');
});
