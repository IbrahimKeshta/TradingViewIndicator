// node --test tools/thndrx/render-plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from '../backtest/ict-engine.mjs';
import { loadSymbol } from '../backtest/data.mjs';
import { defaultValues, resolveConfig } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { makeBars } from './test-bars.mjs';
import { buildRenderPlan, applyPineCaps, anchorBar, withTransp, futureTime, targetLabelText } from './render-plan.mjs';

const wave = (n) => Array.from({ length: n }, (_, i) => +(100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + 0.02 * i).toFixed(4));
const bars = makeBars(wave(500));
const ctx = { symbol: 'TEST', mintick: 0.01, resolution: '1D', lastBarOpen: false };
const LOOSE = { minScore: 3, minRiskAtr: 0.5 }; // loose gate so the synthetic series opens trades on both sides
const looseValues = (extra = {}) => ({ ...defaultValues(), ...LOOSE, ...extra });
const engineOf = (b, values) => runEngine(b, resolveConfig(values).engineCfg, { symbol: ctx.symbol, mintick: ctx.mintick });

test('only live zones are drawn, from their left edge to the last bar', () => {
  const values = looseValues();
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  const fvg = p.boxes.filter((b) => b.key.startsWith('fvg:'));
  const ob = p.boxes.filter((b) => b.key.startsWith('ob:'));
  assert.equal(fvg.length, res.final.bullFvg.length + res.final.bearFvg.length);
  assert.equal(ob.length, res.final.bullOb.length + res.final.bearOb.length);
  assert.ok(fvg.length > 0 && ob.length > 0, 'the series must leave live FVGs and OBs');
  for (const b of [...fvg, ...ob]) assert.equal(b.t2, bars.at(-1).time);
  const z = res.final.bullFvg[0] ?? res.final.bearFvg[0];
  const side = res.final.bullFvg.includes(z) ? 'bull' : 'bear';
  const box = p.boxes.find((b) => b.key === `fvg:${side}:${z.bar}`);
  assert.equal(box.t1, bars[z.left].time);
  assert.equal(box.top, z.top);
  assert.equal(box.bottom, z.bottom);
  assert.equal(box.border, colorNew(side === 'bull' ? PINE_COLORS.teal : PINE_COLORS.red, 40));
  assert.equal(box.bg, colorNew(side === 'bull' ? PINE_COLORS.teal : PINE_COLORS.red, 85));
  const lbl = p.labels.find((l) => l.key === `fvg:${side}:${z.bar}:label`);
  assert.deepEqual([lbl.text, lbl.style, lbl.size, lbl.time, lbl.price], ['FVG', 'up', 'tiny', bars[z.left].time, z.top]);
});

test('order blocks follow the tier colours, transparencies and text', () => {
  const obBars = makeBars(wave(300)); // leaves one MAJOR and one INTERNAL order block alive
  const p = buildRenderPlan(obBars, looseValues(), ctx);
  const res = engineOf(obBars, looseValues());
  const zs = [...res.final.bullOb.map((z) => [z, 'bull']), ...res.final.bearOb.map((z) => [z, 'bear'])];
  const tiers = new Set(zs.map(([z]) => z.tier));
  assert.ok(tiers.has('MAJOR') && tiers.has('INTERNAL'), 'the series must leave both OB tiers');
  for (const [z, side] of zs) {
    const major = z.tier === 'MAJOR', c = side === 'bull' ? PINE_COLORS.blue : PINE_COLORS.purple;
    const box = p.boxes.find((b) => b.key === `ob:${side}:${z.tier.toLowerCase()}:${z.bar}`);
    assert.equal(box.border, colorNew(c, major ? 40 : 70));
    assert.equal(box.bg, colorNew(c, major ? 85 : 92));
    const lbl = p.labels.find((l) => l.key === `${box.key}:label`);
    assert.equal(lbl.text, major ? 'OB' : 'ob');
    assert.equal(lbl.price, z.top);
  }
});

test('break events persist, rays only for unbroken swings', () => {
  const values = looseValues({ showInternalBreaks: true, showInternalRays: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  assert.ok(res.events.length > 0);
  const brk = p.lines.filter((l) => l.key.startsWith('brk:'));
  assert.equal(brk.length, res.events.length);
  assert.equal(p.labels.filter((l) => l.key.startsWith('brk:')).length, res.events.length);
  for (const e of res.events) {
    const l = p.lines.find((x) => x.key === `brk:${e.tier}:${e.bar}`);
    assert.deepEqual([l.t1, l.p1, l.t2, l.p2, l.style, l.extendRight], [bars[e.levelBar].time, e.level, bars[e.bar].time, e.level, 'dotted', false]);
    assert.equal(l.width, e.tier === 'major' ? 2 : 1);
    const lbl = p.labels.find((x) => x.key === `brk:${e.tier}:${e.bar}:label`);
    assert.deepEqual([lbl.text, lbl.style, lbl.price], [e.type, e.side === 'bull' ? 'up' : 'down', e.level]);
    const base = e.type === 'CHoCH' ? PINE_COLORS.fuchsia : PINE_COLORS.lime;
    assert.equal(l.color, e.tier === 'major' ? base : colorNew(base, 50));
  }
  const f = res.final;
  const swings = { major: [f.majorHighs, f.majorLows], internal: [f.intHighs, f.intLows] };
  let rays = 0;
  for (const tier of ['major', 'internal']) {
    ['high', 'low'].forEach((hl, k) => {
      for (const s of swings[tier][k]) {
        const ray = p.lines.find((l) => l.key === `ray:${tier}:${hl}:${s.bar}`);
        assert.equal(ray !== undefined, s.broken === false, `${tier} ${hl} swing at ${s.bar}`);
        if (ray) {
          rays++;
          assert.equal(ray.p1, s.price);
          assert.equal(ray.t2, bars.at(-1).time);
          assert.equal(ray.extendRight, true);
          assert.equal(ray.style, tier === 'major' ? 'solid' : 'dotted');
        }
      }
    });
  }
  assert.equal(p.lines.filter((l) => l.key.startsWith('ray:')).length, rays);
  assert.ok(rays > 0 && swings.major.flat().some((s) => s.broken), 'need both live and broken swings');
});

test('tags outside the anchor range are skipped', () => {
  const n = 6000;
  const long = makeBars(Array.from({ length: n }, (_, i) => +(100 + 20 * Math.sin(i / 60) + 0.002 * i).toFixed(4)));
  const values = { ...defaultValues(), maxSwings: 30 };
  const res = engineOf(long, values);
  const f = res.final;
  const cutoff = n - 1 - 4999;
  const all = [...f.majorHighs, ...f.majorLows];
  assert.ok(all.some((s) => s.kind && s.bar < cutoff), 'precondition: a classified major swing older than the anchor range');
  const p = buildRenderPlan(long, values, ctx);
  const tags = p.labels.filter((l) => l.key.startsWith('tag:'));
  assert.equal(tags.length, all.filter((s) => s.kind && s.bar >= cutoff).length);
  assert.ok(tags.length > 0);
  for (const t of tags) assert.ok(t.time >= long[cutoff].time, 'tag older than bars[n-5000]');
  // rays are clamped, not skipped
  const rays = p.lines.filter((l) => l.key.startsWith('ray:major:'));
  assert.equal(rays.length, all.filter((s) => !s.broken).length);
  for (const r of rays) assert.ok(r.t1 >= long[cutoff].time);
});

test('swing tags carry kind, side style and the liquidity colour', () => {
  const p = buildRenderPlan(bars, looseValues(), ctx);
  const res = engineOf(bars, looseValues());
  const tags = p.labels.filter((l) => l.key.startsWith('tag:major:'));
  assert.ok(tags.length > 0);
  for (const s of res.final.majorHighs.filter((x) => x.kind)) {
    const t = tags.find((l) => l.key === `tag:major:high:${s.bar}`);
    assert.deepEqual([t.text, t.style, t.price, t.textColor], [s.kind, 'down', s.price, PINE_COLORS.white]);
    assert.equal(t.color, s.liquidity ? PINE_COLORS.yellow : PINE_COLORS.orange);
  }
  for (const s of res.final.majorLows.filter((x) => x.kind)) assert.equal(tags.find((l) => l.key === `tag:major:low:${s.bar}`).style, 'up');
});

test('anchorBar clamps to the last 5000 bars', () => {
  assert.equal(anchorBar(10, 9000), 9000 - 4999);
  assert.equal(anchorBar(8000, 9000), 8000);
});

test('caps keep the newest 500 per type', () => {
  const empty = { meta: null, boxes: [], lines: [], labels: [], series: [], fills: [], markers: [], bands: [], panel: null };
  const mk = (n) => Array.from({ length: n }, (_, k) => ({ key: 'l' + k, order: k }));
  const p = applyPineCaps({ ...empty, labels: mk(600), lines: mk(500), boxes: mk(501) });
  assert.equal(p.labels.length, 500);
  assert.equal(p.labels[0].key, 'l100');
  assert.equal(p.labels.at(-1).key, 'l599');
  assert.equal(p.lines.length, 500);
  assert.equal(p.boxes.length, 500);
  assert.equal(p.boxes[0].key, 'l1');
});

test('orders follow Pine creation order: by bar, then by source line', () => {
  const p = buildRenderPlan(bars, looseValues({ showInternalBreaks: true }), ctx);
  const orders = p.labels.map((l) => l.order);
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'labels arrive in creation order');
  const rsi = p.labels.find((l) => l.key === 'rsi');
  const lastBarLabels = p.labels.filter((l) => l.key !== 'rsi' && l.time === bars.at(-1).time && l.key.startsWith('tag:'));
  for (const t of lastBarLabels) assert.ok(t.order > rsi.order, 'the RSI readout (line 213) precedes the last-bar tags');
  const zoneLbl = p.labels.find((l) => l.key.startsWith('fvg:'));
  const brkLbl = p.labels.find((l) => l.key.startsWith('brk:'));
  assert.ok(zoneLbl && brkLbl && p.boxes.every((b, k) => k === 0 || b.order > p.boxes[k - 1].order));
});

test('signal markers follow the opens, with the first opener deciding the side', () => {
  const values = looseValues();
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  assert.ok(res.opens.some((o) => o.side === 'long') && res.opens.some((o) => o.side === 'short'));
  const first = new Map();
  for (const o of res.opens) if (!first.has(o.bar)) first.set(o.bar, o.side);
  const up = p.markers.filter((m) => m.shape === 'triangleup').map((m) => m.time);
  const down = p.markers.filter((m) => m.shape === 'triangledown').map((m) => m.time);
  assert.deepEqual(up, [...first].filter(([, s]) => s === 'long').map(([b]) => bars[b].time));
  assert.deepEqual(down, [...first].filter(([, s]) => s === 'short').map(([b]) => bars[b].time));
  for (const m of p.markers) {
    assert.equal(m.location, m.shape === 'triangleup' ? 'belowbar' : 'abovebar');
    assert.equal(m.color, m.shape === 'triangleup' ? PINE_COLORS.lime : PINE_COLORS.red);
    assert.match(m.key, /^sig:\d+$/);
  }
});

test('Long Trades Only still marks the suppressed short setup', () => {
  const values = looseValues({ longOnlyIn: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  assert.ok(res.opens.every((o) => o.side === 'long'));
  const setups = [...res.series.shortSetup].flatMap((v, i) => (v ? [bars[i].time] : []));
  assert.ok(setups.length > 0);
  assert.deepEqual(p.markers.filter((m) => m.shape === 'triangledown').map((m) => m.time), setups);
  assert.deepEqual(p.markers.filter((m) => m.shape === 'triangleup').map((m) => m.time), res.opens.map((o) => bars[o.bar].time));
});

test('RSI readout sits on the last bar high with the overbought/oversold suffix', () => {
  const last = bars.length - 1;
  const rsiOf = (values) => buildRenderPlan(bars, values, ctx).labels.find((l) => l.key === 'rsi');
  const r = engineOf(bars, defaultValues()).series.rsi[last];
  const l = rsiOf(defaultValues());
  assert.deepEqual([l.time, l.price, l.style, l.size, l.textColor], [bars[last].time, bars[last].high, 'down', 'small', PINE_COLORS.white]);
  assert.equal(l.color, colorNew(PINE_COLORS.blue, 80));
  const num = String(Number(r.toFixed(2)));
  assert.equal(l.text, 'RSI ' + num + (r >= 70 ? ' OB' : r <= 30 ? ' OS' : ''));
  assert.equal(rsiOf({ ...defaultValues(), rsiOverbought: 1 }).text, 'RSI ' + num + ' OB');
  assert.equal(rsiOf({ ...defaultValues(), rsiOverbought: 100, rsiOversold: 99 }).text, 'RSI ' + num + ' OS');
  assert.ok(!buildRenderPlan(bars, { ...defaultValues(), showRsiReadout: false }, ctx).labels.some((x) => x.key === 'rsi'));
});

test('display flags hide their items', () => {
  const p = buildRenderPlan(bars, { ...looseValues(), showFVG: false, showMajorTags: false }, ctx);
  assert.ok(!p.boxes.some((b) => b.key.startsWith('fvg:')));
  assert.ok(!p.labels.some((l) => l.key.startsWith('tag:')));
  const q = buildRenderPlan(bars, { ...looseValues(), showOB: false, showMajorRays: false, showBreakLines: false, showSignalMarkers: false }, ctx);
  assert.ok(!q.boxes.some((b) => b.key.startsWith('ob:')));
  assert.equal(q.lines.filter((l) => !l.key.startsWith('trade:')).length, 0, 'only live trade levels remain');
  assert.equal(q.markers.length, 0);
  assert.ok(p.boxes.some((b) => b.key.startsWith('ob:')) && p.lines.some((l) => l.key.startsWith('ray:')) && p.markers.length > 0);
});

test('user colours reach the plan, rgba included', () => {
  const p = buildRenderPlan(bars, looseValues({ rayColor: 'rgba(10, 20, 30, 0.9)', majorTagColor: '#112233', showInternalRays: true }), ctx);
  const major = p.lines.find((l) => l.key.startsWith('ray:major:'));
  const internal = p.lines.find((l) => l.key.startsWith('ray:internal:'));
  assert.equal(major.color, 'rgba(10, 20, 30, 0.9)');
  assert.equal(internal.color, 'rgba(10, 20, 30, 0.4)');
  assert.ok(p.labels.filter((l) => l.key.startsWith('tag:') && l.color === '#112233').length > 0);
});

test('withTransp replaces the transparency of any colour form', () => {
  assert.equal(withTransp('#FF0000', 60), 'rgba(255, 0, 0, 0.4)');
  assert.equal(withTransp('#f00', 50), 'rgba(255, 0, 0, 0.5)');
  assert.equal(withTransp('#FF000080', 60), 'rgba(255, 0, 0, 0.4)');
  assert.equal(withTransp('rgba(1, 2, 3, 0.2)', 60), 'rgba(1, 2, 3, 0.4)');
  assert.equal(withTransp('rgb(1,2,3)', 0), 'rgba(1, 2, 3, 1)');
  assert.throws(() => withTransp('red', 10));
});

test('an unsupported chart timeframe turns the HTF filter off with a warning', () => {
  const p = buildRenderPlan(bars, looseValues({ requireHtfBias: true }), { ...ctx, resolution: '1S' });
  assert.equal(p.meta.warnings.length, 1);
  assert.match(p.meta.warnings[0], /HTF bias/);
  assert.ok(p.boxes.length > 0);
  assert.equal(buildRenderPlan(bars, looseValues({ requireHtfBias: true, htfBiasTf: '1W' }), ctx).meta.warnings.length, 0);
});

test('meta and the empty plan', () => {
  const p = buildRenderPlan(bars, defaultValues(), ctx);
  assert.deepEqual(p.meta, { symbol: 'TEST', resolution: '1D', bars: 500, firstTime: bars[0].time, lastTime: bars.at(-1).time, warnings: [] });
  assert.equal(p.panel.position, 'bottom_right'); // the panel itself is covered by panel.test.mjs
  const e = buildRenderPlan([], defaultValues(), ctx);
  assert.equal(e.meta.bars, 0);
  assert.deepEqual([e.boxes, e.lines, e.labels, e.markers], [[], [], [], []]);
});


// ---- Task 6: plotted series, Kumo, killzone shading ----

// Walks every numeric field of every plan item, so a NaN or Infinity anywhere fails the test.
function assertNoNaN(plan) {
  const walk = (v, path) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite number at ${path}`);
    else if (Array.isArray(v)) v.forEach((x, k) => walk(x, `${path}[${k}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(plan, 'plan');
}
const barIndex = (time) => bars.findIndex((b) => b.time === time);
const seriesOf = (p, prefix) => p.series.filter((s) => s.key.startsWith(prefix));
const cairoDow = (t) => new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(t * 1000)) + 'T00:00:00Z').getUTCDay();

test('the MA is one orange width-2 series of every finite value', () => {
  const values = { ...defaultValues(), maTypeInput: 'SMA' }; // an SMA is NaN until its window fills
  const p = buildRenderPlan(bars, values, ctx);
  const ma = p.series.filter((s) => s.key === 'ma');
  assert.equal(ma.length, 1);
  assert.equal(ma[0].color, colorNew(PINE_COLORS.orange, 0));
  assert.equal(ma[0].width, 2);
  const res = engineOf(bars, values);
  const finite = [...res.series.ma].flatMap((v, i) => (Number.isFinite(v) ? [[bars[i].time, v]] : []));
  assert.ok(finite.length > 0 && finite.length < bars.length, 'the MA has a warm-up of NaN bars');
  assert.deepEqual(ma[0].points.map((q) => [q.time, q.price]), finite);
});

test('NaN splits a series into runs', () => {
  const values = looseValues({ showTrailStop: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  for (const [side, dir, color] of [['long', 1, PINE_COLORS.green], ['short', -1, PINE_COLORS.red]]) {
    const runs = seriesOf(p, `trail:${side}:`);
    const expected = [];
    let cur = null;
    for (let i = 0; i < bars.length; i++) {
      const v = res.series[side === 'long' ? 'trailLong' : 'trailShort'][i];
      if (res.series.trailDir[i] === dir && Number.isFinite(v)) (cur ??= []).push([bars[i].time, v]);
      else if (cur) { expected.push(cur); cur = null; }
    }
    if (cur) expected.push(cur);
    assert.ok(expected.length > 1, `the series must flip the trail direction more than once (${side})`);
    assert.deepEqual(runs.map((r) => r.key), expected.map((_, k) => `trail:${side}:${k}`));
    assert.deepEqual(runs.map((r) => r.points.map((q) => [q.time, q.price])), expected);
    for (const r of runs) {
      assert.equal(r.color, colorNew(color, 0));
      assert.equal(r.width, 1);
      for (const q of r.points) assert.equal(res.series.trailDir[barIndex(q.time)], dir);
    }
  }
  assertNoNaN(p);
  assert.equal(seriesOf(buildRenderPlan(bars, looseValues(), ctx), 'trail:').length, 0, 'trail lines are off by default');
});

test('anchored VWAP draws two width-2 series only when shown', () => {
  const values = looseValues({ showAvwap: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  for (const [name, arr, color] of [['low', res.series.avwapLow, PINE_COLORS.aqua], ['high', res.series.avwapHigh, PINE_COLORS.fuchsia]]) {
    const runs = seriesOf(p, `avwap:${name}:`);
    assert.ok(runs.length > 0);
    const got = runs.flatMap((r) => r.points.map((q) => [q.time, q.price]));
    assert.deepEqual(got, [...arr].flatMap((v, i) => (Number.isFinite(v) ? [[bars[i].time, v]] : [])));
    for (const r of runs) { assert.equal(r.color, colorNew(color, 0)); assert.equal(r.width, 2); }
  }
  assert.equal(seriesOf(buildRenderPlan(bars, looseValues(), ctx), 'avwap:').length, 0);
});

test('kumo shifts forward by ichiDisp bars', () => {
  const values = looseValues({ showKumo: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  const disp = 26, n = bars.length;
  for (const [id, arr, color] of [['kumoA', res.series.spanA, PINE_COLORS.green], ['kumoB', res.series.spanB, PINE_COLORS.red]]) {
    const runs = seriesOf(p, `${id}:`);
    assert.equal(runs.length, 1, 'the spans have a single NaN warm-up and no gaps');
    assert.equal(runs[0].key, `${id}:0`);
    assert.equal(runs[0].color, colorNew(color, 60));
    const first = [...arr].findIndex((v) => Number.isFinite(v));
    const pts = runs[0].points;
    assert.equal(pts.length, n - first);
    assert.equal(pts[0].time, bars[first + disp].time);
    assert.equal(pts[0].price, arr[first]);
    assert.equal(pts.at(-1).price, arr[n - 1]);
    assert.ok(pts.at(-1).time > bars.at(-1).time);
    const future = pts.slice(-disp).map((q) => q.time);
    assert.deepEqual(future, Array.from({ length: disp }, (_, k) => futureTime(bars, k + 1, '1D')));
    assert.ok(future.every((t, k) => t > (k ? future[k - 1] : bars.at(-1).time)), 'future times ascend past the last bar');
  }
  assertNoNaN(p);
  assert.equal(seriesOf(buildRenderPlan(bars, looseValues(), ctx), 'kumo').length, 0);
  assert.equal(buildRenderPlan(bars, looseValues(), ctx).fills.length, 0);
});

test('kumo fills split at every crossing and take the bull/bear colour', () => {
  const values = looseValues({ showKumo: true });
  const p = buildRenderPlan(bars, values, ctx);
  const res = engineOf(bars, values);
  const { spanA, spanB } = res.series;
  const idx = [...spanA].flatMap((a, i) => (Number.isFinite(a) && Number.isFinite(spanB[i]) ? [i] : []));
  let changes = 0;
  for (let k = 1; k < idx.length; k++) if ((spanA[idx[k]] > spanB[idx[k]]) !== (spanA[idx[k - 1]] > spanB[idx[k - 1]])) changes++;
  assert.ok(changes >= 2, 'the series must cross the cloud spans more than once');
  assert.equal(p.fills.length, changes + 1);
  assert.deepEqual(p.fills.map((f) => f.key), p.fills.map((_, k) => `kumo:${k}`));
  const bull = defaultValues().kumoBullColor, bear = defaultValues().kumoBearColor;
  p.fills.forEach((f, k) => {
    assert.equal(f.points.length % 2, 0);
    const cols = f.points.length / 2;
    assert.ok(cols >= 2);
    const isBull = f.color === bull;
    assert.ok(isBull || f.color === bear);
    for (let j = 0; j < cols; j++) {
      const top = f.points[j], bottom = f.points[2 * cols - 1 - j];
      assert.equal(top.time, bottom.time, 'the polygon edges share their columns');
      assert.ok(isBull ? top.price >= bottom.price - 1e-9 : top.price <= bottom.price + 1e-9, `polygon ${k} stays on one side`);
    }
    if (k > 0) { // consecutive polygons touch at the crossing, with opposite colours
      const prev = p.fills[k - 1];
      assert.notEqual(prev.color, f.color);
      assert.equal(prev.points[prev.points.length / 2 - 1].time, f.points[0].time);
      assert.ok(Math.abs(f.points[0].price - f.points[2 * cols - 1].price) < 1e-9, 'the crossing column is a single point');
    }
  });
  const custom = buildRenderPlan(bars, looseValues({ showKumo: true, kumoBullColor: '#00ff00', kumoBearColor: '#ff0000' }), ctx);
  assert.ok(custom.fills.every((f) => f.color === '#00ff00' || f.color === '#ff0000'));
});

const hourly = makeBars(wave(400), { stepSec: 3600 });
const nyHour = (t) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t * 1000));

test('killzone bands only intraday', () => {
  const daily = makeBars(wave(120));
  assert.equal(buildRenderPlan(daily, defaultValues(), { ...ctx, resolution: '1D' }).bands.length, 0);
  assert.equal(buildRenderPlan(daily, defaultValues(), { ...ctx, resolution: '1W' }).bands.length, 0);
  const p = buildRenderPlan(hourly, defaultValues(), { ...ctx, resolution: '60' });
  assert.ok(p.bands.length > 0);
  const london = p.bands.filter((b) => b.key.startsWith('kz:london:'));
  const ny = p.bands.filter((b) => b.key.startsWith('kz:newyork:'));
  assert.equal(p.bands.length, london.length + ny.length, 'Asia is off by default');
  // London 02:00-05:00 New York: three consecutive hourly bars a day, one band per day
  assert.ok(london.length >= 16);
  for (const b of london.slice(1, -1)) {
    assert.equal(nyHour(b.t1), 2);
    assert.equal(b.t2 - b.t1, 3 * 3600);
  }
  for (const b of london) assert.equal(b.color, colorNew(PINE_COLORS.blue, 90));
  for (const b of ny.slice(1, -1)) {
    assert.equal(nyHour(b.t1), 7);
    assert.equal(b.t2 - b.t1, 3 * 3600);
  }
  for (const b of ny) assert.equal(b.color, colorNew(PINE_COLORS.orange, 90));
  assert.deepEqual(london.map((b) => b.key), london.map((_, k) => `kz:london:${k}`));
  // the bands cover exactly the bars of the engine's merged killzone series
  const res = engineOf(hourly, defaultValues());
  const covered = hourly.map((b) => (p.bands.some((x) => b.time >= x.t1 && b.time < x.t2) ? 1 : 0));
  assert.deepEqual(covered, [...res.series.killzoneActive]);
  assertNoNaN(p);
});

test('killzone bands follow their session switches and colours', () => {
  const hctx = { ...ctx, resolution: '60' };
  const asia = buildRenderPlan(hourly, { ...defaultValues(), showAsiaKZ: true, showLondonKZ: false, showNewYorkKZ: false }, hctx);
  assert.ok(asia.bands.length > 0 && asia.bands.every((b) => b.key.startsWith('kz:asia:')));
  assert.ok(asia.bands.every((b) => b.color === colorNew(PINE_COLORS.purple, 90)));
  // 20:00-00:00 New York: four bars, except where the data starts or ends inside a window
  assert.ok(asia.bands.slice(1, -1).every((b) => b.t2 - b.t1 === 4 * 3600 && nyHour(b.t1) === 20));
  const none = buildRenderPlan(hourly, { ...defaultValues(), showLondonKZ: false, showNewYorkKZ: false }, hctx);
  assert.equal(none.bands.length, 0);
  const onlyLondon = buildRenderPlan(hourly, { ...defaultValues(), showNewYorkKZ: false, londonSession: '0300-0500' }, hctx);
  assert.ok(onlyLondon.bands.length > 0);
  assert.ok(onlyLondon.bands.slice(1, -1).every((b) => b.key.startsWith('kz:london:') && nyHour(b.t1) === 3 && b.t2 - b.t1 === 2 * 3600));
});

test('short history renders without NaN', () => {
  const closes30 = wave(30);
  const all = { ...defaultValues(), showKumo: true, showAvwap: true, showTrailStop: true };
  const p = buildRenderPlan(makeBars(closes30), all, ctx);
  assertNoNaN(p);
  assert.ok(p.series.some((s) => s.key === 'ma'));
  assertNoNaN(buildRenderPlan(makeBars(closes30, { stepSec: 3600 }), all, { ...ctx, resolution: '60' }));
  assertNoNaN(buildRenderPlan(makeBars(wave(3)), all, ctx));
});

test('zero volume has no NaN text', () => {
  const zeroVolBars = makeBars(wave(200), { volume: 0 });
  const p = buildRenderPlan(zeroVolBars, { ...defaultValues(), showAvwap: true }, ctx);
  assertNoNaN(p);
  assert.ok(!p.labels.some((l) => /NaN/.test(l.text)));
  assert.equal(seriesOf(p, 'avwap:').length, 0, 'a zero-volume anchor leaves the VWAP undefined, so nothing is drawn');
});

test('an unsupported resolution drops the Kumo with a warning, never throws', () => {
  const p = buildRenderPlan(bars, looseValues({ showKumo: true }), { ...ctx, resolution: '1M' });
  assert.equal(seriesOf(p, 'kumo').length + p.fills.length, 0);
  assert.equal(p.meta.warnings.length, 1);
  assert.match(p.meta.warnings[0], /Kumo/);
});

test('futureTime skips the EGX weekend', () => {
  const thu = Date.parse('2024-01-04T08:00:00Z') / 1000; // Thursday 10:00 Cairo
  const b = (t) => [{ time: t }];
  assert.equal(cairoDow(thu), 4);
  assert.equal(futureTime(b(thu), 1, '1D'), thu + 3 * 86400);
  assert.equal(cairoDow(futureTime(b(thu), 1, '1D')), 0);
  assert.equal(futureTime(b(thu), 2, '1D'), thu + 4 * 86400);
  assert.equal(futureTime(b(thu), 6, '1D'), thu + 10 * 86400);
  assert.equal(futureTime(b(thu - 86400), 2, '1D'), thu + 3 * 86400, 'Wednesday + 2 trading days is Sunday');
  assert.equal(futureTime(b(thu), 3, '1W'), thu + 21 * 86400);
  assert.equal(futureTime(b(thu), 0, '1D'), thu);
});

test('futureTime walks the EGX session on intraday resolutions', () => {
  const sun10 = Date.parse('2024-01-07T08:00:00Z') / 1000; // Sunday 10:00 Cairo (UTC+2)
  const b = (t) => [{ time: t }];
  assert.equal(futureTime(b(sun10), 1, '60'), sun10 + 3600);
  assert.equal(futureTime(b(sun10), 4, '60'), sun10 + 4 * 3600); // 14:00, before the 14:30 close
  assert.equal(futureTime(b(sun10), 5, '60'), sun10 + 86400); // 15:00 is after the close: Monday 10:00
  assert.equal(futureTime(b(sun10), 17, '15'), sun10 + 17 * 900); // 14:15
  assert.equal(futureTime(b(sun10), 18, '15'), sun10 + 86400); // 14:30 is the close: next session open
  assert.equal(futureTime(b(sun10), 19, '15'), sun10 + 86400 + 900);
  const thu14 = Date.parse('2024-01-04T12:00:00Z') / 1000; // Thursday 14:00 Cairo
  assert.equal(futureTime(b(thu14), 1, '60'), sun10, 'Thursday after the close rolls over the weekend to Sunday 10:00');
  const thuSummer = Date.parse('2024-07-04T11:00:00Z') / 1000; // Thursday 14:00 Cairo (UTC+3)
  assert.equal(futureTime(b(thuSummer), 1, '60'), Date.parse('2024-07-07T07:00:00Z') / 1000, 'the next open is 10:00 Cairo local time in summer too');
  assert.equal(futureTime(b(sun10 - 2 * 3600), 1, '60'), sun10, 'before the open: snap to 10:00');
});

// ---- Task 7: live trades and trade history ----

// The loose synthetic series with the trailing model on: both slots are live at the last bar (a PB short and a TR short
// that has hit TP1), and bar 222 closes a PB short and a TR long together.
const TRADE_VALUES = looseValues({ useTrailModel: true, trailRequireTrend: false, trailMinRiskAtr: 0 });
const tradePlan = buildRenderPlan(bars, TRADE_VALUES, ctx);
const tradeRes = engineOf(bars, TRADE_VALUES);
const keysOf = (p) => [...p.boxes, ...p.lines, ...p.labels].map((x) => x.key);
const liveKey = (model, t, part) => `trade:${model}:${t.openBar}:${part}`;

test('live PB trade draws box, header and five levels', () => {
  const t = tradeRes.final.pbTrade;
  assert.ok(t && t.side === 'short', 'precondition: a live PB trade');
  const last = bars.length - 1, lastTime = bars[last].time, r = Math.abs(t.entry - t.initialStop);
  const box = tradePlan.boxes.find((b) => b.key === liveKey('PB', t, 'box'));
  assert.deepEqual([box.t1, box.t2, box.top, box.bottom], [bars[t.openBar].time, lastTime, t.zoneTop, t.zoneBottom]);
  assert.equal(box.border, PINE_COLORS.maroon);
  assert.equal(box.bg, colorNew(PINE_COLORS.maroon, 88));
  const head = tradePlan.labels.find((l) => l.key === liveKey('PB', t, 'head'));
  assert.deepEqual([head.time, head.price, head.style, head.size, head.textColor, head.color], [bars[t.openBar].time, t.zoneTop, 'down', 'tiny', PINE_COLORS.white, PINE_COLORS.maroon]);
  assert.equal(head.text, `SHORT · ${t.grade} · ${t.score}/${t.scoreOf}`);
  const expected = [
    ['entry', t.entry, PINE_COLORS.maroon, false, 'Entry ' + t.entry.toFixed(2)],
    ['sl', t.stop, PINE_COLORS.red, false, 'SL ' + t.stop.toFixed(2)],
    ['tp1', t.tp1, PINE_COLORS.green, t.tpHit >= 1, targetLabelText(1, t.tp1, t.liq1, false, t.entry, r, t.tpHit, 0.01)],
    ['tp2', t.tp2, PINE_COLORS.green, t.tpHit >= 2, targetLabelText(2, t.tp2, t.liq2, false, t.entry, r, t.tpHit, 0.01)],
    ['tp3', t.tp3, PINE_COLORS.green, t.tpHit >= 3, targetLabelText(3, t.tp3, t.liq3, false, t.entry, r, t.tpHit, 0.01)],
  ];
  for (const [part, price, color, dotted, text] of expected) {
    const line = tradePlan.lines.find((l) => l.key === liveKey('PB', t, part));
    assert.deepEqual([line.t1, line.p1, line.t2, line.p2, line.extendRight, line.color, line.style, line.width],
      [bars[t.openBar].time, price, lastTime, price, true, color, dotted ? 'dotted' : 'solid', 1], part);
    const lbl = tradePlan.labels.find((l) => l.key === liveKey('PB', t, part) + ':label');
    assert.deepEqual([lbl.time, lbl.price, lbl.text, lbl.style, lbl.color, lbl.textColor, lbl.size], [lastTime, price, text, 'left', color, PINE_COLORS.white, 'tiny'], part);
  }
  assert.match(expected[0][4], /^Entry \d+\.\d{2}$/);
  assert.match(expected[2][4], /^TP1 \d+\.\d{2} · \d+\.\dR/);
});

test('live trailing trade carries the TRAIL tag, its own box and its hit targets', () => {
  const t = tradeRes.final.trTrade;
  assert.ok(t && t.tpHit === 1, 'precondition: a live TR trade past TP1');
  const head = tradePlan.labels.find((l) => l.key === liveKey('TR', t, 'head'));
  assert.equal(head.text, `${t.side === 'long' ? 'LONG' : 'SHORT'} · TRAIL · ${t.grade} · ${t.score}/${t.scoreOf}`);
  const box = tradePlan.boxes.find((b) => b.key === liveKey('TR', t, 'box'));
  assert.deepEqual([box.top, box.bottom], [t.zoneTop, t.zoneBottom]);
  assert.equal(tradePlan.lines.find((l) => l.key === liveKey('TR', t, 'tp1')).style, 'dotted');
  assert.equal(tradePlan.lines.find((l) => l.key === liveKey('TR', t, 'tp2')).style, 'solid');
  assert.match(tradePlan.labels.find((l) => l.key === liveKey('TR', t, 'tp1') + ':label').text, / ✓$/);
  assert.doesNotMatch(tradePlan.labels.find((l) => l.key === liveKey('TR', t, 'tp2') + ':label').text, /✓/);
  assert.equal(tradePlan.lines.find((l) => l.key === liveKey('TR', t, 'sl')).p1, t.stop);
});

test('no live trade, no trade levels; the flag hides them', () => {
  const flat = bars.slice(0, 430);
  const res = engineOf(flat, TRADE_VALUES);
  assert.ok(res.final.pbTrade === null && res.final.trTrade === null, 'precondition: both slots empty at bar 429');
  assert.ok(!keysOf(buildRenderPlan(flat, TRADE_VALUES, ctx)).some((k) => k.startsWith('trade:')));
  const off = buildRenderPlan(bars, { ...TRADE_VALUES, showTradeLevels: false }, ctx);
  assert.ok(!keysOf(off).some((k) => k.startsWith('trade:')));
  assert.ok(off.labels.some((l) => l.key.startsWith('res:')), 'the history labels are a separate switch');
});

test('target label text', () => {
  assert.equal(targetLabelText(1, 12.5, true, true, 10, 1, 1, 0.01), 'TP1 12.50 · 2.5R · EQH ✓');
  assert.equal(targetLabelText(2, 7.25, true, false, 10, 1, 0, 0.01), 'TP2 7.25 · 2.8R · EQL');
  assert.equal(targetLabelText(3, 15, false, true, 10, 2, 2, 0.01), 'TP3 15.00 · 2.5R', 'tpHit below n: no tick');
  assert.equal(targetLabelText(3, 15, false, true, 10, 2, 3, 0.01), 'TP3 15.00 · 2.5R ✓');
  assert.equal(targetLabelText(1, 15, false, true, 10, 0, 0, 1), 'TP1 15 · 0.0R', 'zero risk prints 0.0R; a whole-number mintick prints no decimals');
});

test('history label per closed trade with R and reason', () => {
  const res = tradeRes;
  const labels = tradePlan.labels.filter((l) => l.key.startsWith('res:'));
  assert.equal(labels.length, res.trades.length);
  assert.ok(res.trades.some((t) => t.model === 'TR') && res.trades.some((t) => t.model === 'PB'));
  assert.ok(res.trades.some((t) => t.r >= 0) && res.trades.some((t) => t.r < 0));
  for (const t of res.trades) {
    const l = labels.find((x) => x.key === `res:${t.model}:${t.closeIdx}`);
    const r1 = (t.r >= 0 ? '+' : '') + t.r.toFixed(1) + 'R';
    assert.equal(l.text, `${r1} · ${t.model === 'TR' ? 'T · ' : ''}${t.reason}`);
    assert.equal(l.time, bars[t.closeIdx].time);
    assert.equal(l.style, t.side === 'long' ? 'up' : 'down');
    assert.equal(l.color, colorNew(t.r >= 0 ? PINE_COLORS.green : PINE_COLORS.red, 20));
    assert.deepEqual([l.textColor, l.size], [PINE_COLORS.white, 'tiny']);
    if (t.model === 'PB') assert.equal(l.price, t.exit);
  }
  assert.ok(labels.some((l) => /^[+-]\d\.\dR · Stopped$/.test(l.text)), 'a pullback stop-out reads like "-1.1R · Stopped"');
  assert.ok(labels.some((l) => /^[+-]\d\.\dR · T · \w+/.test(l.text)), 'a trailing result reads like "+0.4R · T · Stopped"');
  const off = buildRenderPlan(bars, { ...TRADE_VALUES, showTradeHistory: false }, ctx);
  assert.ok(!off.labels.some((l) => l.key.startsWith('res:')));
});

test('same-bar TR label moves clear of the PB label', () => {
  const sameBar = (res) => {
    const pb = res.trades.find((t) => t.model === 'PB' && res.trades.some((u) => u.model === 'TR' && u.closeIdx === t.closeIdx));
    return pb && { pb, tr: res.trades.find((t) => t.model === 'TR' && t.closeIdx === pb.closeIdx) };
  };
  const { pb, tr } = sameBar(tradeRes);
  assert.deepEqual([pb.closeIdx, pb.side, tr.side], [222, 'short', 'long'], 'precondition: both slots close on bar 222');
  const clear = 1.5 * tradeRes.series.structAtr[222];
  assert.ok(clear > 0);
  assert.equal(tradePlan.labels.find((l) => l.key === 'res:PB:222').price, pb.exit, 'the pullback label keeps its exit price');
  assert.equal(tradePlan.labels.find((l) => l.key === 'res:TR:222').price, tr.exit - clear, 'a long label moves down, away from its up-style body');
  // a short TR label moves up: the same rule, mirrored
  const values = looseValues({ useTrailModel: true, trailRequireTrend: false, trailMinRiskAtr: 0, trailAtrMult: 1 });
  const res = engineOf(bars, values);
  const s = sameBar(res);
  assert.equal(s.tr.side, 'short', 'precondition: a same-bar short TR close');
  assert.equal(buildRenderPlan(bars, values, ctx).labels.find((l) => l.key === `res:TR:${s.tr.closeIdx}`).price, s.tr.exit + 1.5 * res.series.structAtr[s.tr.closeIdx]);
  // a TR trade that closes alone stays at its exit price
  const alone = tradeRes.trades.find((t) => t.model === 'TR' && !tradeRes.trades.some((u) => u.model === 'PB' && u.closeIdx === t.closeIdx));
  assert.equal(tradePlan.labels.find((l) => l.key === `res:TR:${alone.closeIdx}`).price, alone.exit);
});

test('trade items follow Pine creation order on the last bar', () => {
  const t = tradeRes.final.pbTrade, u = tradeRes.final.trTrade;
  const order = (items, key) => items.find((x) => x.key === key).order;
  assert.ok(order(tradePlan.boxes, liveKey('PB', t, 'box')) < order(tradePlan.boxes, liveKey('TR', u, 'box')));
  const seq = [liveKey('PB', t, 'head'), liveKey('PB', t, 'entry') + ':label', liveKey('PB', t, 'tp3') + ':label', liveKey('TR', u, 'head'), liveKey('TR', u, 'tp3') + ':label'];
  const o = seq.map((k) => order(tradePlan.labels, k));
  assert.deepEqual(o, [...o].sort((a, b) => a - b));
  assert.ok(order(tradePlan.labels, 'rsi') < o[0], 'the RSI readout precedes the trade labels');
});

const dataDir = process.env.ICT_DATA;
test('VLMRA daily matches engine trades', { skip: !dataDir }, () => {
  const real = loadSymbol('VLMRA', dataDir);
  const rctx = { symbol: 'VLMRA', mintick: 0.01, resolution: '1D', lastBarOpen: false };
  for (const values of [defaultValues(), { ...defaultValues(), presetInput: 'EGX Daily' }]) {
    const { engineCfg } = resolveConfig(values);
    const res = runEngine(real, engineCfg, { symbol: 'VLMRA', mintick: 0.01 });
    const plan = buildRenderPlan(real, values, rctx);
    const openBars = new Set(res.opens.map((o) => o.bar));
    assert.ok(openBars.size > 0);
    const longBars = [...new Set(res.opens.filter((o) => o.side === 'long').map((o) => o.bar))];
    const up = plan.markers.filter((m) => m.shape === 'triangleup').map((m) => m.time);
    assert.equal(up.length, longBars.length);
    assert.deepEqual(up, longBars.map((b) => real[b].time));
    const down = plan.markers.filter((m) => m.shape === 'triangledown').map((m) => m.time);
    if (!engineCfg.longOnly) {
      // every open bar carries exactly one marker, and nothing else is marked
      assert.deepEqual([...up, ...down].sort(), [...openBars].map((b) => real[b].time).sort());
    } else {
      assert.deepEqual(down, [...res.series.shortSetup].flatMap((v, i) => (v ? [real[i].time] : [])));
    }
    assert.ok(plan.boxes.length > 0 && plan.lines.length > 0 && plan.labels.length > 0);
  }
});
