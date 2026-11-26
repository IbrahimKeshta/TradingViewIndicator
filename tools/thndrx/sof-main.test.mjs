// node --test tools/thndrx/sof-main.test.mjs
// The Session Order Flow app in the shared overlay loop, against a fake ThndrX window: a chart shaped like the live
// recon plus Thndr's datafeed on the chart frame (ChartApiInstance._studyEngine._externalDatafeed). Timers run SCALE
// times faster than the real 2 s polls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSof } from './sof-main.mjs';
import { start as startIct } from './main.mjs';
import { createLtfCache } from './sof-ltf.mjs';
import { makeBars } from './test-bars.mjs';

const sec = (iso) => Date.parse(iso) / 1000;
const USER_VIEW = Object.freeze({ from: sec('2026-06-01T00:00:00Z'), to: sec('2026-11-24T00:00:00Z') });
const START = sec('2023-01-01T00:00:00Z');

class El {
  constructor(tag) { Object.assign(this, { tag, children: [], style: {}, dataset: {}, parentNode: null, textContent: '', className: '' }); }
  appendChild(c) { if (typeof c !== 'string') { if (c.parentNode) c.remove(); c.parentNode = this; } this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; } }
  addEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300 }; }
  all() { return [this, ...this.children.filter((c) => typeof c !== 'string').flatMap((c) => c.all())]; }
}
class Doc {
  constructor() { this.body = new El('body'); this.area = this.body.appendChild(new El('div')); }
  createElement(tag) { return new El(tag); }
  getElementById(id) { return this.body.all().find((e) => e.id === id) || null; }
  querySelector(sel) { return sel === '.layout__area--center' ? this.area : null; }
  querySelectorAll(sel) { return this.body.all().filter((e) => '.' + e.className === sel); }
}

const closes = (base, n) => Array.from({ length: n }, (_, i) => base + 10 * Math.sin(i / 11) + 4 * Math.sin(i / 3.7) + i * 0.02);

// 10-minute base bars for each daily bar (10:00-14:30 Cairo, 27 a day), consistent with the daily OHLC.
function intrabars(daily) {
  const rows = [];
  for (const b of daily) {
    const day0 = b.time - (b.time % 86400) + 8 * 3600; // 10:00 Cairo in winter
    for (let k = 0; k < 27; k++) {
      const f = k / 26, px = b.open + (b.close - b.open) * f;
      rows.push([day0 + k * 600, px, Math.min(b.high, px * 1.004), Math.max(b.low, px * 0.996), px + (k % 2 ? 0.01 : -0.01), b.volume / 27]);
    }
  }
  return rows;
}

function fakeChart(symbols, first) {
  const listeners = new Set(), live = new Map(), calls = [];
  let n = 0;
  const full = new Set();
  const chart = {
    sym: first, range: { ...USER_VIEW }, live, calls, restores: 0,
    symbol: () => 'UUID-' + chart.sym,
    symbolExt: () => ({ name: chart.sym, pricescale: 100, minmov: 1 }),
    resolution: () => '1D',
    getVisibleRange: () => ({ ...chart.range }),
    setVisibleRange: async (r) => { chart.range = { from: r.from, to: r.to }; if (r.from === USER_VIEW.from && r.to === USER_VIEW.to) chart.restores++; else full.add(chart.sym); },
    exportData: ({ from } = {}) => {
      const all = symbols[chart.sym].bars, held = full.has(chart.sym) ? all : all.slice(-300);
      return Promise.resolve({
        schema: [{ type: 'time' }, ...['open', 'high', 'low', 'close'].map((plotTitle) => ({ type: 'value', sourceType: 'series', plotTitle })), { type: 'value', sourceType: 'study', plotTitle: 'Volume', plotId: 'vol' }],
        data: held.filter((b) => from === undefined || b.time >= from).map((b) => Float64Array.from([b.time, b.open, b.high, b.low, b.close, b.volume])),
      });
    },
    onSymbolChanged: () => ({ subscribe: (o, cb) => listeners.add(cb), unsubscribe: (o, cb) => listeners.delete(cb) }),
    onIntervalChanged: () => ({ subscribe() {}, unsubscribe() {} }),
    setSymbol(name) { chart.sym = name; for (const cb of listeners) cb(); },
    createShape: async (point, options) => { const id = 'e' + ++n; live.set(id, { sym: chart.sym, options }); calls.push(options); return id; },
    createMultipointShape: async (points, options) => { const id = 'e' + ++n; live.set(id, { sym: chart.sym, options }); calls.push(options); return id; },
    removeEntity: (id) => { live.delete(id); },
  };
  return chart;
}

// Thndr's datafeed: ignores `from` beyond a pad, returns at most 2000 bars ending before `to`; `delayMs` per request.
function fakeDatafeed(symbols, { delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    resolveSymbol: (name, ok) => ok({ name: name.replace('UUID-', ''), ticker: name, type: 'stock', timezone: 'Africa/Cairo', session: '1;1000-1430:12345' }),
    getBars(si, res, { from, to, countBack }, onResult) {
      calls.push({ sym: si.name, res });
      setTimeout(() => {
        if (!countBack) return onResult([], { noData: true });
        const rows = symbols[si.name].ltf.filter((r) => r[0] < to && r[0] >= from - 10 * 86400).slice(-2000);
        onResult(rows.map((r) => ({ time: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })), { noData: rows.length === 0 });
      }, delayMs);
    },
  };
}

function fakeWin(chart, df, scale) {
  const doc = new Doc();
  const frame = { tradingViewApi: { activeChart: () => chart } };
  if (df) frame.ChartApiInstance = { _studyEngine: { _externalDatafeed: df } };
  const iframe = { id: 'tradingview_x', isConnected: true, contentWindow: frame, contentDocument: doc };
  const handles = new Set(), errors = [];
  return {
    document: { querySelector: (sel) => (sel === 'iframe[id^="tradingview_"]' ? iframe : null) },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (fn, ms) => { const h = setTimeout(fn, ms / scale); handles.add(h); return h; },
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => { const h = setInterval(fn, ms / scale); handles.add(h); return h; },
    clearInterval: (h) => clearInterval(h),
    console: { error: (...a) => errors.push(a), warn: () => {}, log: () => {} },
    errors, doc,
    dispose() { for (const h of handles) { clearTimeout(h); clearInterval(h); } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(5); }
}
const rowsOf = (win, id) => { const el = win.doc.getElementById(id); return el ? el.children[0].children.map((tr) => tr.children.map((td) => td.textContent)) : null; };
const symbolSet = (base, n) => { const bars = makeBars(closes(base, n), { start: START }); return { bars, ltf: intrabars(bars) }; };
const NOW = () => (START + 900 * 86400) * 1000; // a fixed clock after the last bar: every bar is closed

test('loads 10m intrabars from the datafeed, builds the 30m profile and paints with them', async () => {
  const symbols = { COMI: symbolSet(100, 600) };
  const chart = fakeChart(symbols, 'COMI'), df = fakeDatafeed(symbols);
  const win = fakeWin(chart, df, 50);
  const stop = startSof(win, { now: NOW, cache: createLtfCache() });
  try {
    await until(() => chart.live.size > 0, 8000, 'the paint');
    assert.ok(df.calls.length > 1 && df.calls.every((c) => c.res === '10'), 'daily chart: 10m base bars for 30m intrabars');
    const rows = rowsOf(win, 'thndrx-sof-panel');
    assert.equal(rows[0][0], 'Conditions');
    assert.ok(!rows.some((r) => r[0] === 'Data' && /Intrabars unavailable/.test(r[1])));
    assert.deepEqual(chart.range, USER_VIEW, 'the view is put back');
    assert.ok(chart.calls.some((o) => o.shape === 'rectangle' && o.text), 'boxes with text');
    assert.ok(chart.calls.every((o) => o.disableSave === true));
    assert.deepEqual(win.errors, []);
  } finally { stop(); win.dispose(); }
});

test('symbol change during intrabar load paints only the new symbol', async () => {
  const symbols = { COMI: symbolSet(100, 600), SWDY: symbolSet(40, 600) };
  const chart = fakeChart(symbols, 'COMI'), df = fakeDatafeed(symbols, { delayMs: 20 });
  const win = fakeWin(chart, df, 50);
  const stop = startSof(win, { now: NOW, cache: createLtfCache() });
  try {
    await until(() => df.calls.some((c) => c.sym === 'COMI'), 5000, 'the COMI intrabar load');
    chart.setSymbol('SWDY');
    await until(() => chart.live.size > 0, 10000, 'a paint');
    await sleep(300);
    assert.deepEqual(new Set([...chart.live.values()].map((x) => x.sym)), new Set(['SWDY']));
    assert.ok(df.calls.some((c) => c.sym === 'SWDY'));
    assert.deepEqual(win.errors, []);
  } finally { stop(); win.dispose(); }
});

test('without the datafeed: chart bars only, and the Data row says so', async () => {
  const symbols = { COMI: symbolSet(100, 600) };
  const chart = fakeChart(symbols, 'COMI');
  const win = fakeWin(chart, null, 50);
  const stop = startSof(win, { now: NOW, cache: createLtfCache() });
  try {
    await until(() => chart.live.size > 0, 8000, 'the paint');
    const data = rowsOf(win, 'thndrx-sof-panel').find((r) => r[0] === 'Data');
    assert.ok(data && /Intrabars unavailable on this ThndrX build/.test(data[1]), JSON.stringify(data));
    assert.deepEqual(win.errors, []);
  } finally { stop(); win.dispose(); }
});

test('ICT and Session Order Flow on one chart: both paint, both panels show, the view comes back', async () => {
  const symbols = { COMI: symbolSet(100, 600) };
  const chart = fakeChart(symbols, 'COMI'), df = fakeDatafeed(symbols);
  const win = fakeWin(chart, df, 50);
  const stops = [startIct(win, { now: NOW }), startSof(win, { now: NOW, cache: createLtfCache() })];
  try {
    await until(() => rowsOf(win, 'thndrx-ict-panel') && rowsOf(win, 'thndrx-sof-panel') && rowsOf(win, 'thndrx-sof-panel')[0][0] === 'Conditions' && rowsOf(win, 'thndrx-ict-panel')[0][0] === 'STRUCTURE', 10000, 'both panels');
    await sleep(200);
    assert.deepEqual(chart.range, USER_VIEW);
    assert.ok(win.doc.getElementById('thndrx-ict-button') && win.doc.getElementById('thndrx-sof-button'));
    assert.deepEqual(win.errors, []);
  } finally { stops.forEach((s) => s()); win.dispose(); }
});
