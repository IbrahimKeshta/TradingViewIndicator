// node --test tools/thndrx/painter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Painter, toShapeCalls, itemHash, MAX_BANDS } from './painter.mjs';
import { buildRenderPlan } from './render-plan.mjs';
import { defaultValues } from './inputs.mjs';
import { makeBars } from './test-bars.mjs';

// Records every call and hands out ids; resolves on a later tick like the real chart does.
class FakePort {
  constructor() { this.calls = []; this.removals = []; this._live = new Map(); this.n = 0; }
  #add(method, args, options) {
    const id = `e${++this.n}`;
    this.calls.push({ method, args, options, id });
    this._live.set(id, { method, args, options });
    return new Promise((resolve) => setTimeout(() => resolve(id), 0));
  }
  createShape(point, options) { return this.#add('createShape', [point], options); }
  createMultipointShape(points, options) { return this.#add('createMultipointShape', points, options); }
  removeEntity(id, options) { this.removals.push({ id, options }); this._live.delete(id); }
  seedForeign(id) { this._live.set(id, { foreign: true }); }
  live() { return new Set(this._live.keys()); }
}

const emptyPlan = (extra = {}) => ({
  meta: { priceLow: 80, priceHigh: 120 }, boxes: [], lines: [], labels: [], series: [], fills: [], markers: [], bands: [], panel: null, ...extra,
});
const box = (key, o = {}) => ({ key, t1: 100, t2: 200, top: 110, bottom: 105, border: 'rgba(1, 2, 3, 0.3)', bg: 'rgba(1, 2, 3, 0.1)', order: 0, ...o });
const line = (key, o = {}) => ({ key, t1: 100, p1: 100, t2: 200, p2: 100, extendRight: false, color: '#00E676', style: 'dotted', width: 2, order: 1, ...o });
const label = (key, o = {}) => ({ key, time: 150, price: 111, text: 'FVG', style: 'up', color: 'rgba(8, 153, 129, 0.3)', textColor: '#FFFFFF', size: 'tiny', order: 2, ...o });
const series = (key, n = 3) => ({ key, points: Array.from({ length: n }, (_, i) => ({ time: 100 + i, price: 100 + i })), color: '#FF9800', width: 2 });
const fill = (key) => ({ key, color: 'rgba(0, 255, 0, 0.2)', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 2, price: 1 }, { time: 1, price: 0 }] });
const marker = (key, shape = 'triangleup') => ({ key, time: 300, price: shape === 'triangleup' ? 99 : 121, shape, location: shape === 'triangleup' ? 'belowbar' : 'abovebar', color: '#00E676' });
const band = (key, t1) => ({ key, t1, t2: t1 + 3600, color: 'rgba(41, 98, 255, 0.1)' });

const fullPlan = () => emptyPlan({
  boxes: [box('b1')], lines: [line('l1'), line('l2', { extendRight: true, style: 'solid' })], labels: [label('t1')],
  series: [series('ma')], fills: [fill('kumo:0')], markers: [marker('sig:1'), marker('sig:2', 'triangledown')], bands: [band('kz:A:0', 1000)],
});

test('every call disables saving, undo and selection and locks the shape', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const plan = fullPlan();
  const r = await painter.apply(plan, painter.begin());
  assert.equal(r.created, 9);
  assert.equal(port.calls.length, 9);
  for (const c of port.calls) {
    assert.equal(c.options.disableSave, true);
    assert.equal(c.options.disableUndo, true);
    assert.equal(c.options.lock, true);
    assert.equal(c.options.disableSelection, true);
  }
});

test('items map to the recon shape table', () => {
  const meta = { priceLow: 80, priceHigh: 120 };
  const b = toShapeCalls(box('b'), 'box');
  assert.equal(b.multi, true);
  assert.deepEqual(b.points, [{ time: 100, price: 110 }, { time: 200, price: 105 }]);
  assert.equal(b.options.shape, 'rectangle');
  assert.deepEqual(b.options.overrides, { color: 'rgba(1, 2, 3, 0.3)', backgroundColor: 'rgba(1, 2, 3, 0.1)', fillBackground: true, linewidth: 1 });

  const l = toShapeCalls(line('l', { extendRight: true, style: 'dotted' }), 'line');
  assert.equal(l.options.shape, 'trend_line');
  assert.deepEqual(l.points, [{ time: 100, price: 100 }, { time: 200, price: 100 }]);
  assert.deepEqual(l.options.overrides, { linecolor: '#00E676', linewidth: 2, linestyle: 1, extendRight: true });
  assert.equal(toShapeCalls(line('l', { style: 'solid' }), 'line').options.overrides.linestyle, 0);
  assert.equal(toShapeCalls(line('l', { style: 'dashed' }), 'line').options.overrides.linestyle, 2);
  assert.equal(toShapeCalls(line('l'), 'line').options.overrides.extendRight, false);

  const t = toShapeCalls(label('t'), 'label');
  assert.equal(t.multi, false);
  assert.deepEqual(t.points, [{ time: 150, price: 111 }]);
  assert.equal(t.options.shape, 'text');
  assert.equal(t.options.text, 'FVG');
  assert.deepEqual(t.options.overrides, { color: '#FFFFFF', backgroundColor: 'rgba(8, 153, 129, 0.3)', fillBackground: true, fontsize: 10 });
  assert.equal(toShapeCalls(label('t', { size: 'small' }), 'label').options.overrides.fontsize, 12);
  for (const style of ['up', 'down', 'left']) assert.equal(toShapeCalls(label('t', { style }), 'label').options.shape, 'text');

  const s = toShapeCalls(series('ma'), 'series');
  assert.equal(s.options.shape, 'path');
  assert.equal(s.points.length, 3);
  assert.deepEqual(s.options.overrides, { lineColor: '#FF9800', lineWidth: 2, lineStyle: 0, leftEnd: 0, rightEnd: 0 });

  const f = toShapeCalls(fill('k'), 'fill');
  assert.equal(f.options.shape, 'polyline');
  assert.equal(f.points.length, 4);
  assert.equal(f.options.overrides.filled, true);
  assert.equal(f.options.overrides.fillBackground, true);
  assert.equal(f.options.overrides.backgroundColor, 'rgba(0, 255, 0, 0.2)');

  const up = toShapeCalls(marker('m'), 'marker');
  assert.equal(up.options.shape, 'arrow_up');
  assert.deepEqual(up.points, [{ time: 300, price: 99 }]);
  assert.deepEqual(up.options.overrides, { arrowColor: '#00E676', color: '#00E676' });
  const down = toShapeCalls(marker('m', 'triangledown'), 'marker');
  assert.equal(down.options.shape, 'arrow_down');
  assert.deepEqual(down.points, [{ time: 300, price: 121 }]);

  const bd = toShapeCalls(band('k', 1000), 'band', meta);
  assert.equal(bd.options.shape, 'rectangle');
  assert.deepEqual(bd.points, [{ time: 1000, price: 40 }, { time: 4600, price: 240 }]);
  assert.equal(bd.options.overrides.linewidth, 0);
  assert.equal(bd.options.overrides.backgroundColor, 'rgba(41, 98, 255, 0.1)');
});

test('series with fewer than 2 points are skipped, 2 points draw', async () => {
  assert.equal(toShapeCalls(series('a', 1), 'series'), null);
  assert.equal(toShapeCalls(series('a', 0), 'series'), null);
  assert.notEqual(toShapeCalls(series('a', 2), 'series'), null);
  const port = new FakePort();
  const painter = new Painter(port);
  const r = await painter.apply(emptyPlan({ series: [series('lone', 1), series('ok', 2)] }), painter.begin());
  assert.equal(r.created, 1);
  assert.equal(port.calls[0].options.shape, 'path');
});

test('markers come from the plan with the bar price; real plans carry it', () => {
  const bars = makeBars(Array.from({ length: 500 }, (_, i) => +(100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + 0.02 * i).toFixed(4)));
  const plan = buildRenderPlan(bars, { ...defaultValues(), minScore: 3, minRiskAtr: 0.5 }, { symbol: 'T', mintick: 0.01, resolution: '1D', lastBarOpen: false });
  assert.ok(plan.markers.length > 0);
  for (const m of plan.markers) {
    const calls = toShapeCalls(m, 'marker');
    assert.ok(Number.isFinite(calls.points[0].price));
    assert.equal(calls.options.shape, m.shape === 'triangleup' ? 'arrow_up' : 'arrow_down');
  }
});

test('second identical apply creates and removes nothing', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const plan = fullPlan();
  await painter.apply(plan, painter.begin());
  const before = port.calls.length;
  const r = await painter.apply(plan, painter.begin());
  assert.deepEqual([r.created, r.removed, r.kept], [0, 0, 9]);
  assert.equal(port.calls.length, before);
  assert.equal(port.removals.length, 0);
});

test('a different object with the same content is also kept; order does not matter', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  await painter.apply(emptyPlan({ boxes: [box('b1', { order: 3 })] }), painter.begin());
  const r = await painter.apply(emptyPlan({ boxes: [{ ...box('b1', { order: 99 }) }] }), painter.begin());
  assert.deepEqual([r.created, r.removed, r.kept], [0, 0, 1]);
});

test('changed item is recreated, vanished item removed, new item created', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const first = emptyPlan({ boxes: [box('b1'), box('b2')], labels: [label('t1'), label('t2')] });
  await painter.apply(first, painter.begin());
  const oldT1 = port.calls.find((c) => c.options.shape === 'text' && c.options.text === 'FVG').id;
  const second = emptyPlan({ boxes: [box('b1')], labels: [label('t1', { price: 130 }), label('t2'), label('t3', { text: 'OB' })] });
  const r = await painter.apply(second, painter.begin());
  assert.deepEqual([r.created, r.removed, r.kept], [2, 2, 2]); // t1 moved + t3 new; b2 vanished + old t1; b1 and t2 kept
  assert.equal(port.removals.length, 2);
  assert.ok(port.removals.every((x) => x.options.disableUndo === true));
  assert.ok(port.removals.some((x) => x.id === oldT1));
  assert.equal(port.live().size, 4);
  const moved = port.calls.filter((c) => c.method === 'createShape').at(-2);
  assert.equal(moved.args[0].price, 130);
});

test('the same key under a different kind is a different drawing', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const r = await painter.apply(emptyPlan({ boxes: [box('x')], lines: [line('x')] }), painter.begin());
  assert.equal(r.created, 2);
});

test('itemHash ignores order and field order but sees every drawn field', () => {
  const a = box('b');
  assert.equal(itemHash(a), itemHash({ ...a, order: 77 }));
  assert.equal(itemHash(a), itemHash(Object.fromEntries(Object.entries(a).reverse())));
  assert.notEqual(itemHash(a), itemHash({ ...a, top: 111 }));
  assert.notEqual(itemHash(a), itemHash({ ...a, bg: 'red' }));
  assert.notEqual(itemHash(series('s', 3)), itemHash(series('s', 4)));
});

test('stale token is discarded and cleans up what it created', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const big = emptyPlan({ boxes: Array.from({ length: 600 }, (_, i) => box(`b${i}`, { order: i })) });
  const t1 = painter.begin();
  const p = painter.apply(big, t1);
  painter.begin();
  assert.equal(await p, 'stale');
  assert.equal(port.live().size, 0);
  assert.equal(port.removals.length, port.calls.length);
  // a token older than the latest begin() creates nothing at all
  const before = port.calls.length;
  assert.equal(await painter.apply(big, t1), 'stale');
  assert.equal(port.calls.length, before);
});

test('going stale between batches stops further creation', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const big = emptyPlan({ boxes: Array.from({ length: 1000 }, (_, i) => box(`b${i}`, { order: i })) });
  const p = painter.apply(big, painter.begin());
  await new Promise((r) => setTimeout(r, 0)); // first batch is in flight / resolved, later batches not issued yet
  painter.begin();
  assert.equal(await p, 'stale');
  assert.ok(port.calls.length < 1000);
  assert.equal(port.live().size, 0);
});

test('a newer apply after a stale one ends with exactly the newer plan', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const a = painter.apply(emptyPlan({ boxes: [box('old')] }), painter.begin());
  const b = painter.apply(emptyPlan({ boxes: [box('new')] }), painter.begin());
  assert.equal(await a, 'stale');
  assert.equal((await b).created, 1);
  assert.equal(port.live().size, 1);
  assert.equal(painter.live.size, 1);
});

test('foreign entities are never touched', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  port.seedForeign('user-1');
  await painter.apply(fullPlan(), painter.begin());
  await painter.apply(emptyPlan(), painter.begin()); // everything vanishes
  await painter.apply(fullPlan(), painter.begin());
  await painter.clear();
  assert.ok(port.live().has('user-1'));
  assert.equal(port.live().size, 1);
  assert.ok(port.removals.every((x) => x.id !== 'user-1'));
});

test('clear removes everything it drew and invalidates an apply in flight', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  await painter.apply(fullPlan(), painter.begin());
  await painter.clear();
  assert.equal(port.live().size, 0);
  const p = painter.apply(fullPlan(), painter.begin());
  await painter.clear();
  assert.equal(await p, 'stale');
  assert.equal(port.live().size, 0);
});

test('only the newest 300 killzone bands are drawn', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const bands = Array.from({ length: 1000 }, (_, i) => band(`kz:A:${i}`, 1000 + i * 100));
  const r = await painter.apply(emptyPlan({ bands }), painter.begin());
  assert.equal(MAX_BANDS, 300);
  assert.equal(r.created, 300);
  const times = port.calls.map((c) => c.args[0].time).sort((a, b) => a - b);
  assert.equal(times[0], 1000 + 700 * 100);
  assert.equal(times.at(-1), 1000 + 999 * 100);
  // a new newest band replaces the oldest drawn one
  const r2 = await painter.apply(emptyPlan({ bands: [...bands, band('kz:A:1000', 1000 + 1000 * 100)] }), painter.begin());
  assert.deepEqual([r2.created, r2.removed, r2.kept], [1, 1, 299]);
});

test('bands follow the price range in meta', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const bands = [band('kz:A:0', 1000)];
  await painter.apply(emptyPlan({ bands }), painter.begin());
  const r = await painter.apply(emptyPlan({ bands, meta: { priceLow: 50, priceHigh: 120 } }), painter.begin());
  assert.deepEqual([r.created, r.removed], [1, 1]);
  assert.equal(port.calls.at(-1).args[0].price, 25);
  // with no price range in meta nothing is drawn rather than a bad rectangle
  const none = await painter.apply(emptyPlan({ bands, meta: { priceLow: null, priceHigh: null } }), painter.begin());
  assert.deepEqual([none.created, none.removed], [0, 1]);
});

test('a full repaint of 1000 items issues the calls without awaiting each one', async () => {
  let inFlight = 0, peak = 0;
  const port = new FakePort();
  const create = port.createMultipointShape.bind(port);
  port.createMultipointShape = (points, options) => { inFlight++; peak = Math.max(peak, inFlight); return create(points, options).then((id) => { inFlight--; return id; }); };
  const painter = new Painter(port);
  const r = await painter.apply(emptyPlan({ boxes: Array.from({ length: 1000 }, (_, i) => box(`b${i}`, { order: i })) }), painter.begin());
  assert.equal(r.created, 1000);
  assert.ok(peak > 100, `calls overlapped (peak ${peak})`);
});

test('a failing create is reported, not fatal, and retried on the next apply', async () => {
  const port = new FakePort();
  const create = port.createMultipointShape.bind(port);
  let fail = true;
  port.createMultipointShape = (points, options) => (fail && options.overrides.linewidth === 2 ? Promise.reject(new Error('boom')) : create(points, options));
  const painter = new Painter(port);
  const plan = emptyPlan({ boxes: [box('b1')], lines: [line('l1')] });
  const r = await painter.apply(plan, painter.begin());
  assert.deepEqual([r.created, r.failed], [1, 1]);
  fail = false;
  const r2 = await painter.apply(plan, painter.begin());
  assert.deepEqual([r2.created, r2.kept], [1, 1]);
});

test('calls start back to front: bands, fills, boxes, series, lines, labels, markers, each in plan order', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  await painter.apply(emptyPlan({
    markers: [marker('m')], labels: [label('t', { order: 5 }), label('u', { order: 4, text: 'first' })], lines: [line('l')],
    series: [series('s')], boxes: [box('b')], fills: [fill('f')], bands: [band('k', 1000)],
  }), painter.begin());
  assert.deepEqual(port.calls.map((c) => c.options.shape), ['rectangle', 'polyline', 'rectangle', 'path', 'trend_line', 'text', 'text', 'arrow_up']);
  assert.equal(port.calls[5].options.text, 'first');
});

test('a synchronous throw from the port counts as failed and leaks no ids', async () => {
  const port = new FakePort();
  const create = port.createMultipointShape.bind(port);
  port.createMultipointShape = (points, options) => {
    if (options.overrides.linewidth === 2) throw new Error('sync boom');
    return create(points, options);
  };
  const painter = new Painter(port);
  const plan = emptyPlan({ boxes: Array.from({ length: 600 }, (_, i) => box(`b${i}`, { order: i })), lines: [line('l1')], labels: [label('t1')] });
  const r = await painter.apply(plan, painter.begin());
  assert.deepEqual([r.created, r.failed], [601, 1]);
  assert.equal(port.live().size, 601);
  assert.equal(painter.live.size, 601);
  assert.deepEqual(new Set([...painter.live.values()].map((e) => e.id)), port.live());
});

test('an unexpected throw mid-apply discards everything already created', async () => {
  const port = new FakePort();
  const painter = new Painter(port);
  const plan = emptyPlan({ boxes: Array.from({ length: 600 }, (_, i) => box(`b${i}`, { order: i })) });
  let batches = 0;
  const all = Promise.allSettled;
  Promise.allSettled = (...a) => (++batches === 2 ? all.apply(Promise, a).then(() => { throw new Error('boom'); }) : all.apply(Promise, a));
  try {
    await assert.rejects(painter.apply(plan, painter.begin()), /boom/);
  } finally { Promise.allSettled = all; }
  assert.equal(port.live().size, 0);
  assert.equal(painter.live.size, 0);
});
