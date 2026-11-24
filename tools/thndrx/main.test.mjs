// node --test tools/thndrx/main.test.mjs
// main.start against a fake ThndrX window: a fake chart iframe, a chart API shaped like the live recon, and the few
// DOM calls the UI makes. Timers run SCALE times faster than the real 2 s polls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './main.mjs';
import { makeBars } from './test-bars.mjs';

const sec = (iso) => Date.parse(iso) / 1000;
const HISTORY_FROM = sec('1990-01-01T00:00:00Z');
const USER_VIEW = Object.freeze({ from: sec('2026-06-01T00:00:00Z'), to: sec('2026-11-24T00:00:00Z') });

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

// A chart with several symbols; 300 bars until history is requested from 1990, then 1300 (like the 5-year feed).
function fakeChart(symbols, first) {
  const listeners = { symbol: new Set(), interval: new Set() };
  const ev = (name) => ({ subscribe: (o, cb) => listeners[name].add(cb), unsubscribe: (o, cb) => listeners[name].delete(cb) });
  const full = new Set(), live = new Map();
  let n = 0;
  const chart = {
    sym: first, range: { ...USER_VIEW }, live, empty: false, restores: 0,
    symbol: () => 'UUID-' + chart.sym,
    symbolExt: () => ({ name: chart.sym, pricescale: 100, minmov: 1 }),
    resolution: () => '1D',
    getVisibleRange: () => ({ ...chart.range }),
    setVisibleRange: async (r) => {
      chart.range = { from: r.from, to: r.to };
      if (r.from === HISTORY_FROM) full.add(chart.sym); else chart.restores++;
    },
    exportData: async ({ from } = {}) => {
      const all = chart.empty ? [] : symbols[chart.sym];
      const rows = (full.has(chart.sym) ? all : all.slice(-300)).filter((b) => from === undefined || b.time >= from);
      return {
        schema: [{ type: 'time' }, ...['open', 'high', 'low', 'close'].map((plotTitle) => ({ type: 'value', sourceType: 'series', plotTitle })),
          { type: 'value', sourceType: 'study', plotTitle: 'Volume', plotId: 'vol' }],
        data: rows.map((b) => Float64Array.from([b.time, b.open, b.high, b.low, b.close, b.volume])),
      };
    },
    onSymbolChanged: () => ev('symbol'),
    onIntervalChanged: () => ev('interval'),
    setSymbol(name) { chart.sym = name; for (const cb of listeners.symbol) cb(); },
    createShape: async () => { const id = 'e' + ++n; live.set(id, chart.sym); return id; },
    createMultipointShape: async () => { const id = 'e' + ++n; live.set(id, chart.sym); return id; },
    removeEntity: (id) => { live.delete(id); },
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
const closes = (base) => Array.from({ length: 1300 }, (_, i) => base + 10 * Math.sin(i / 15) + i * 0.02);
const start0 = sec('2021-11-24T00:00:00Z');

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
    assert.ok(win.doc.getElementById('thndrx-ict-panel'), 'panel shown');
    assert.deepEqual(win.errors, []);
  } finally {
    stop();
    win.dispose();
  }
});

test('a chart that loads with no bars keeps polling and paints once bars arrive', async () => {
  const chart = fakeChart({ COMI: makeBars(closes(100), { start: start0 }) }, 'COMI');
  chart.empty = true;
  const win = fakeWin(chart, 200); // 30 settle rounds of 2 s -> 300 ms
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
