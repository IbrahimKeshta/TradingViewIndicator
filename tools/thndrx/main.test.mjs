// node --test tools/thndrx/main.test.mjs
// main.start against a fake ThndrX window: a fake chart iframe, a chart API shaped like the live recon, and the few
// DOM calls the UI makes. Timers run SCALE times faster than the real 2 s polls; tests that need the wall clock pass
// their own (`now`), so "a bar closes" and "60 s later" are set by the test, not by real time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, INCOMPLETE_NOTE } from './main.mjs';
import { makeBars } from './test-bars.mjs';

const sec = (iso) => Date.parse(iso) / 1000;
const USER_VIEW = Object.freeze({ from: sec('2026-06-01T00:00:00Z'), to: sec('2026-11-24T00:00:00Z') });
const isUserView = (r) => r.from === USER_VIEW.from && r.to === USER_VIEW.to;

class El {
  constructor(tag, doc) { Object.assign(this, { tag, doc, children: [], style: {}, dataset: {}, parentNode: null, textContent: '' }); }
  appendChild(c) { if (typeof c !== 'string') { if (c.parentNode) c.remove(); c.parentNode = this; } this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; } }
  addEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300 }; }
  all() { return [this, ...this.children.filter((c) => typeof c !== 'string').flatMap((c) => c.all())]; }
}
class Doc {
  constructor() { this.body = new El('body', this); this.area = this.body.appendChild(new El('div', this)); }
  createElement(tag) { return new El(tag, this); }
  getElementById(id) { return this.body.all().find((e) => e.id === id) || null; }
  querySelector(sel) { return sel === '.layout__area--center' ? this.area : null; }
}

// A chart with several symbols; 300 bars until history is requested, then all of them (like the 5-year feed).
// `hang` makes every read after the first one never answer; `grow` makes the history arrive 10 bars per read, so the
// first bar never settles. `calls` records every drawing call.
function fakeChart(symbols, first, { resolution = '1D' } = {}) {
  const listeners = { symbol: new Set(), interval: new Set() };
  const ev = (name) => ({ subscribe: (o, cb) => listeners[name].add(cb), unsubscribe: (o, cb) => listeners[name].delete(cb) });
  const full = new Set(), live = new Map(), calls = [];
  let n = 0, reads = 0;
  const chart = {
    sym: first, range: { ...USER_VIEW }, live, calls, empty: false, hang: false, grow: false, restores: 0, failReads: 0,
    symbol: () => 'UUID-' + chart.sym,
    symbolExt: () => ({ name: chart.sym, pricescale: 100, minmov: 1 }),
    resolution: () => resolution,
    getVisibleRange: () => ({ ...chart.range }),
    setVisibleRange: async (r) => {
      chart.range = { from: r.from, to: r.to };
      if (isUserView(r)) chart.restores++; else full.add(chart.sym);
    },
    exportData: ({ from } = {}) => {
      if (chart.failReads > 0) { chart.failReads--; return Promise.reject(new Error('export failed')); }
      if (chart.hang && ++reads > 1) return new Promise(() => {});
      const all = chart.empty ? [] : symbols[chart.sym];
      const held = !full.has(chart.sym) ? all.slice(-300) : chart.grow ? all.slice(-Math.min(all.length, 300 + 10 * ++reads)) : all;
      const rows = held.filter((b) => from === undefined || b.time >= from);
      return Promise.resolve({
        schema: [{ type: 'time' }, ...['open', 'high', 'low', 'close'].map((plotTitle) => ({ type: 'value', sourceType: 'series', plotTitle })),
          { type: 'value', sourceType: 'study', plotTitle: 'Volume', plotId: 'vol' }],
        data: rows.map((b) => Float64Array.from([b.time, b.open, b.high, b.low, b.close, b.volume])),
      });
    },
    onSymbolChanged: () => ev('symbol'),
    onIntervalChanged: () => ev('interval'),
    setSymbol(name) { chart.sym = name; for (const cb of listeners.symbol) cb(); },
    createShape: async (point, options) => { const id = 'e' + ++n; live.set(id, chart.sym); calls.push({ op: 'create', id, points: [point], options }); return id; },
    createMultipointShape: async (points, options) => { const id = 'e' + ++n; live.set(id, chart.sym); calls.push({ op: 'create', id, points, options }); return id; },
    removeEntity: (id) => { live.delete(id); calls.push({ op: 'remove', id }); },
  };
  return chart;
}

function fakeWin(chart, scale) {
  const doc = new Doc();
  const iframe = { id: 'tradingview_x', isConnected: true, contentWindow: { tradingViewApi: { activeChart: () => chart } }, contentDocument: doc };
  const handles = new Set();
  const errors = [];
  const win = {
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
  return win;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
const symbolsOf = (chart) => new Set(chart.live.values());
const closes = (base, n = 1300) => Array.from({ length: n }, (_, i) => base + 10 * Math.sin(i / 15) + i * 0.02);
const start0 = sec('2021-11-24T00:00:00Z');
const panelEl = (win) => win.doc.getElementById('thndrx-ict-panel');
const panelRows = (win) => panelEl(win).children[0].children.map((tr) => tr.children.map((td) => td.textContent));

test('two symbol changes 1 s apart: the user view comes back and only the newest symbol is drawn', async () => {
  const symbols = { COMI: makeBars(closes(100), { start: start0 }), SWDY: makeBars(closes(40), { start: start0 }), TMGH: makeBars(closes(60), { start: start0 }) };
  const chart = fakeChart(symbols, 'COMI');
  const win = fakeWin(chart, 20); // 2 s polls -> 100 ms, the 500 ms debounce -> 25 ms
  const stop = start(win);
  try {
    await until(() => chart.live.size > 0 && chart.restores >= 1, 5000, 'the first paint');
    chart.range = { ...USER_VIEW }; // the user zooms after the first load
    chart.setSymbol('SWDY');
    await sleep(50);                // 1 s at this scale: the SWDY history load is under way
    chart.setSymbol('TMGH');
    await until(() => chart.live.size > 0 && [...symbolsOf(chart)].every((s) => s === 'TMGH'), 8000, 'the TMGH paint');
    await sleep(400);               // let anything still running finish (4 rounds at this scale)
    assert.deepEqual(chart.range, USER_VIEW);
    assert.deepEqual(symbolsOf(chart), new Set(['TMGH']));
    assert.ok(panelEl(win), 'panel shown');
    assert.deepEqual(win.errors, []);
  } finally {
    stop();
    win.dispose();
  }
});

test('a chart that loads with no bars keeps polling and paints once bars arrive', async () => {
  const chart = fakeChart({ COMI: makeBars(closes(100), { start: start0 }) }, 'COMI');
  chart.empty = true;
  const win = fakeWin(chart, 100); // 30 settle rounds of 2 s -> 600 ms, well inside the 90 s timeout (900 ms)
  const stop = start(win);
  try {
    await until(() => chart.restores >= 1, 5000, 'the empty load to end');
    await sleep(60);                // several tick polls on the empty session
    assert.equal(chart.live.size, 0);
    chart.empty = false;
    await until(() => chart.live.size > 0, 5000, 'a paint after the bars arrived');
    assert.deepEqual(win.errors, []);
  } finally {
    stop();
    win.dispose();
  }
});

// R25 on a 1-minute chart: Sunday 2026-11-22, 11:00:30 Cairo (09:00:30 UTC), the 11:00 bar forming.
test('ticks update only the panel; a closed bar repaints once; a second one inside 60 s waits for the throttle', async () => {
  const lastOpen = sec('2026-11-22T09:00:00Z');
  const bars = makeBars(closes(100), { start: lastOpen - 1299 * 60, stepSec: 60 });
  const chart = fakeChart({ COMI: bars }, 'COMI', { resolution: '1' });
  const win = fakeWin(chart, 100); // 2 s polls -> 20 ms
  let clock = (lastOpen + 30) * 1000;
  const paints = [];
  const stop = start(win, { now: () => clock, onPaint: (r) => paints.push({ ...r, at: clock, calls: chart.calls.length }) });
  const maPath = (k) => chart.calls.slice(k).find((c) => c.op === 'create' && c.options.shape === 'path' && c.options.overrides.lineWidth === 2);
  const setLast = (close) => { const b = bars.at(-1); bars[bars.length - 1] = { ...b, close, high: Math.max(b.high, close), low: Math.min(b.low, close) }; };
  const addBar = (close) => { const b = bars.at(-1); bars.push({ time: b.time + 60, date: b.date, open: b.close, high: Math.max(b.close, close) * 1.01, low: Math.min(b.close, close) * 0.99, close, volume: 1000 }); };
  try {
    await until(() => paints.length === 1, 5000, 'the load paint');
    assert.equal(maPath(0).points.at(-1).time, lastOpen - 60, 'drawings stop at the last closed bar, not the forming one');
    const afterLoad = chart.calls.length;

    // N ticks that only move the forming bar: the panel is recomputed, the drawings are never touched
    const tables = new Set([panelEl(win).children[0]]);
    for (let k = 0; k < 6; k++) {
      setLast(bars.at(-1).close + (k % 2 ? 0.7 : -0.9));
      clock += 3000;
      await sleep(60); // three polls
      tables.add(panelEl(win).children[0]);
    }
    assert.equal(chart.calls.length, afterLoad, 'no create or remove call');
    assert.equal(paints.length, 1);
    assert.ok(tables.size >= 4, `panel re-rendered on the ticks (${tables.size} tables)`);

    // the 11:00 bar closes (the 11:01 bar opens): exactly one paint, touching only what changed
    clock = (lastOpen + 118) * 1000;
    addBar(bars.at(-1).close + 0.3);
    await until(() => paints.length === 2, 5000, 'the closed-bar paint');
    await sleep(100);
    assert.equal(paints.length, 2);
    const p2 = paints[1];
    assert.ok(p2.created > 0 && p2.kept > 0, `created ${p2.created}, kept ${p2.kept}`);
    assert.ok(p2.created + p2.removed < p2.kept, 'most drawings untouched');
    assert.equal(p2.created + p2.kept, chart.live.size);
    assert.equal(maPath(afterLoad).points.at(-1).time, lastOpen, 'the MA path now ends on the bar that closed');

    // 10 s later the 11:01 bar is reported closed too: no repaint until 60 s after the last one
    clock += 10000;
    addBar(bars.at(-1).close - 0.2);
    await sleep(150);
    clock += 20000;
    await sleep(150);
    assert.equal(paints.length, 2, 'throttled');
    clock = p2.at + 60000;
    await until(() => paints.length === 3, 5000, 'the throttled paint');
    assert.ok(paints[2].at - p2.at >= 60000);
    await sleep(150);
    assert.equal(paints.length, 3, 'one paint for the waiting bar, not one per poll');
    assert.deepEqual(win.errors, []);
  } finally {
    stop();
    win.dispose();
  }
});

test('a hung history load shows Loading…, ends after the timeout with the view restored, and later reloads still run', async () => {
  const symbols = { COMI: makeBars(closes(100), { start: start0 }), SWDY: makeBars(closes(40), { start: start0 }) };
  const chart = fakeChart(symbols, 'COMI');
  chart.hang = true;
  const win = fakeWin(chart, 1000); // the 90 s timeout -> 90 ms
  const stop = start(win);
  try {
    await until(() => panelEl(win), 2000, 'a panel');
    assert.deepEqual(panelRows(win), [['Loading…']]);
    await until(() => panelRows(win)[0][0].startsWith('History load timed out: retrying in'), 5000, 'the timeout message');
    assert.deepEqual(chart.range, USER_VIEW, 'view restored');
    assert.equal(chart.live.size, 0);
    chart.hang = false;
    chart.setSymbol('SWDY');
    await until(() => chart.live.size > 0, 5000, 'the SWDY paint');
    assert.equal(panelRows(win)[0][0], 'STRUCTURE');
    assert.deepEqual(chart.range, USER_VIEW);
    assert.deepEqual(win.errors, []);
  } finally {
    stop();
    win.dispose();
  }
});

test('history that never settles is flagged in the panel Data row', async () => {
  const chart = fakeChart({ COMI: makeBars(closes(100), { start: start0 }) }, 'COMI');
  chart.grow = true;
  const win = fakeWin(chart, 100); // 30 rounds that never settle -> 600 ms, inside the timeout (900 ms)
  const stop = start(win);
  try {
    await until(() => chart.live.size > 0, 5000, 'the paint');
    const data = panelRows(win).find((r) => r[0] === 'Data');
    assert.ok(data && data[1].includes(INCOMPLETE_NOTE), JSON.stringify(data));
    assert.equal(INCOMPLETE_NOTE, 'History incomplete: the chart stopped loading');
  } finally {
    stop();
    win.dispose();
  }
});

test('a history load that fails is retried, not left on Loading… forever', async () => {
  const chart = fakeChart({ COMI: makeBars(closes(100), { start: start0 }) }, 'COMI');
  chart.failReads = 1; // the first exportData of the load rejects
  const win = fakeWin(chart, 100);
  const stop = start(win);
  try {
    await until(() => chart.live.size > 0, 8000, 'a paint after the failed load');
    assert.equal(panelRows(win)[0][0], 'STRUCTURE');
    assert.equal(win.errors.length, 1, 'the failure is logged once');
  } finally {
    stop();
    win.dispose();
  }
});
