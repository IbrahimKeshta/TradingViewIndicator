// node --test tools/thndrx/render-plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from '../backtest/ict-engine.mjs';
import { loadSymbol } from '../backtest/data.mjs';
import { defaultValues, resolveConfig } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { makeBars } from './test-bars.mjs';
import { buildRenderPlan, applyPineCaps, anchorBar, withTransp } from './render-plan.mjs';

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
  assert.equal(q.lines.length, 0);
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
  assert.equal(p.panel, null);
  const e = buildRenderPlan([], defaultValues(), ctx);
  assert.equal(e.meta.bars, 0);
  assert.deepEqual([e.boxes, e.lines, e.labels, e.markers], [[], [], [], []]);
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
