// node --test tools/thndrx/panel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, summarize } from '../backtest/ict-engine.mjs';
import { loadSymbol } from '../backtest/data.mjs';
import { defaultValues, resolveConfig } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { makeBars } from './test-bars.mjs';
import { buildRenderPlan } from './render-plan.mjs';
import { buildPanel } from './panel.mjs';

const wave = (n) => Array.from({ length: n }, (_, i) => +(100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + 0.02 * i).toFixed(4));
const bars = makeBars(wave(500));
const ctx = { symbol: 'TEST', mintick: 0.01, resolution: '1D', lastBarOpen: false };
const LOOSE = { minScore: 3, minRiskAtr: 0.5 }; // opens a live pullback trade on the last bar of `bars`
const labels = (p) => p.rows.map((r) => r.cells[0].text);
const textOf = (p, label) => p.rows.find((r) => r.cells[0].text === label).cells[1];

// A hand-built engine result: no engine run, so each test controls exactly what the panel reads.
const state = (o = {}) => ({ trend: null, lastType: null, lastStrength: NaN, lastBar: -1, ...o });
const fakeRes = ({ trades = [], final = {} } = {}) => ({
  trades,
  series: { trailDir: Int8Array.from([-1, 1]), structAtr: Float64Array.from([2, 2]) },
  final: {
    majorSt: state(), intSt: state(), inRange: false, pbTrade: null, trTrade: null,
    gate: { long: true, score: 4, of: 5, reason: 'READY', marks: { mom: '✓', part: '✗', ichi: '–' } },
    ...final,
  },
});
const trade = (model, r, grade = 'A', pts = {}) => ({ model, r, grade, kz: 0, mom: 0, ma: 0, maj: 0, brk: 0, part: 0, ichi: 0, ...pts });
const liveTrade = (o = {}) => ({
  side: 'long', grade: 'B', score: 4, scoreOf: 5, entry: 100, stop: 98, initialStop: 98, tp1: 102, tp2: 104, tp3: 108, tpHit: 0, runner: false, ...o,
});
const panelOf = (res, values = {}, c = ctx, extra) => buildPanel(res, resolveConfig({ ...defaultValues(), ...values }), c, extra);

test('row budget with defaults and no trades', () => {
  const p = buildRenderPlan(bars, defaultValues(), ctx).panel;
  assert.deepEqual(labels(p), ['STRUCTURE', 'Major trend', 'Range', 'Last event', 'Internal', 'Confirm', 'Gate', 'PERFORMANCE', 'No closed trades']);
  assert.ok(p.rows.every((r) => r.cells.length === 2));
  assert.equal(textOf(p, 'PERFORMANCE').text, 'n = 0');
  assert.deepEqual(textOf(p, 'No closed trades'), { text: '—', color: PINE_COLORS.gray });
});

test('EGX Daily tags the header', () => {
  const p = buildRenderPlan(bars, { ...defaultValues(), presetInput: 'EGX Daily' }, ctx).panel;
  assert.equal(labels(p)[7], 'PERFORMANCE · EGX DAILY');
  const t = panelOf(fakeRes(), { presetInput: 'EGX Daily', useTrailModel: true });
  assert.deepEqual(labels(t).filter((l) => l.startsWith('PERFORMANCE')), ['PERFORMANCE · PULLBACK · EGX DAILY', 'PERFORMANCE · TRAIL · EGX DAILY']);
});

test('the panel is null when it is switched off', () => {
  assert.equal(buildRenderPlan(bars, { ...defaultValues(), showStructurePanel: false }, ctx).panel, null);
});

test('position, background and header colours', () => {
  const rgba = colorNew(PINE_COLORS.black, 80);
  const p = panelOf(fakeRes(), { panelBgColor: rgba });
  assert.equal(p.position, 'bottom_right');
  assert.equal(p.bg, rgba);
  assert.deepEqual(p.rows[0].cells.map((c) => c.bg), [colorNew(PINE_COLORS.gray, 50), colorNew(PINE_COLORS.gray, 50)]);
  assert.equal(p.rows[0].cells[0].color, PINE_COLORS.white);
  assert.equal(p.rows[1].cells[0].color, PINE_COLORS.silver);
  assert.ok(!('bg' in p.rows[1].cells[0]));
  const pos = (panelPosInput) => panelOf(fakeRes(), { panelPosInput }).position;
  assert.deepEqual(['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'].map(pos), ['top_right', 'top_left', 'bottom_right', 'bottom_left']);
});

test('structure rows read the major and internal state', () => {
  const up = panelOf(fakeRes({ final: { majorSt: state({ trend: 'up', lastType: 'BOS', lastStrength: 1.234, lastBar: 10 }), intSt: state({ trend: 'down', lastType: 'CHoCH', lastStrength: 0.5, lastBar: 8 }), inRange: true } }));
  assert.deepEqual(textOf(up, 'Major trend'), { text: 'UP', color: PINE_COLORS.lime });
  assert.deepEqual(textOf(up, 'Range'), { text: 'YES', color: PINE_COLORS.orange });
  assert.deepEqual(textOf(up, 'Last event'), { text: 'BOS · MAJOR · 1.2x', color: PINE_COLORS.white });
  assert.deepEqual(textOf(up, 'Internal'), { text: 'pullback', color: PINE_COLORS.aqua });
  // the internal tier wins once it broke after the major one
  const int = panelOf(fakeRes({ final: { majorSt: state({ trend: 'down', lastType: 'BOS', lastStrength: 1, lastBar: 10 }), intSt: state({ trend: 'down', lastType: 'CHoCH', lastStrength: 2.06, lastBar: 12 }) } }));
  assert.deepEqual(textOf(int, 'Major trend'), { text: 'DOWN', color: PINE_COLORS.red });
  assert.equal(textOf(int, 'Last event').text, 'CHoCH · INTERNAL · 2.1x');
  assert.equal(textOf(int, 'Internal').text, 'aligned');
  assert.equal(textOf(int, 'Range').text, 'no');
  assert.equal(textOf(int, 'Range').color, PINE_COLORS.gray);
  // nothing has broken yet
  const none = panelOf(fakeRes());
  assert.deepEqual([textOf(none, 'Major trend'), textOf(none, 'Last event'), textOf(none, 'Internal')].map((c) => c.text), ['—', '—', '—']);
  assert.equal(textOf(none, 'Major trend').color, PINE_COLORS.gray);
});

test('the confirm and gate rows follow their switches and the gate state', () => {
  const p = panelOf(fakeRes());
  assert.deepEqual(textOf(p, 'Confirm'), { text: 'Mom ✓ · Part ✗ · Ichi –', color: PINE_COLORS.white });
  assert.deepEqual(textOf(p, 'Gate'), { text: 'L · READY · 4/5', color: PINE_COLORS.lime });
  const off = panelOf(fakeRes(), { showConfirmPanel: false, showGatePanel: false });
  assert.deepEqual(labels(off).slice(0, 6), ['STRUCTURE', 'Major trend', 'Range', 'Last event', 'Internal', 'PERFORMANCE']);
  const short = panelOf(fakeRes({ final: { gate: { long: false, score: 2, of: 5, reason: 'score short', marks: { mom: '✗', part: '✗', ichi: '✗' } } } }));
  assert.deepEqual(textOf(short, 'Gate'), { text: 'S · score short · 2/5', color: PINE_COLORS.orange });
  const noZone = panelOf(fakeRes({ final: { gate: { long: true, score: 0, of: 5, reason: 'no zone touch', marks: { mom: '–', part: '–', ichi: '–' } } } }));
  assert.equal(textOf(noZone, 'Gate').color, PINE_COLORS.gray);
});

test('bar not closed replaces READY on a forming bar', () => {
  const closed = panelOf(fakeRes());
  assert.equal(textOf(closed, 'Gate').text, 'L · READY · 4/5');
  const open = panelOf(fakeRes(), {}, { ...ctx, lastBarOpen: true });
  assert.deepEqual(textOf(open, 'Gate'), { text: 'L · bar not closed · 4/5', color: PINE_COLORS.gray });
  // only READY is replaced: a blocking reason is more useful than the open bar
  const blocked = panelOf(fakeRes({ final: { gate: { long: true, score: 1, of: 5, reason: 'score short', marks: { mom: '–', part: '–', ichi: '–' } } } }), {}, { ...ctx, lastBarOpen: true });
  assert.equal(textOf(blocked, 'Gate').text, 'L · score short · 1/5');
});

test('the trail model adds its side to the gate row and its own blocks', () => {
  const on = panelOf(fakeRes(), { useTrailModel: true });
  assert.equal(textOf(on, 'Gate').text, 'L · READY · 4/5 · T:L');
  const flipped = fakeRes();
  flipped.series.trailDir = Int8Array.from([1, -1]);
  assert.equal(textOf(panelOf(flipped, { useTrailModel: true }), 'Gate').text, 'L · READY · 4/5 · T:S');
  assert.deepEqual(labels(on).slice(7), ['PERFORMANCE · PULLBACK', 'No closed trades', 'PERFORMANCE · TRAIL', 'No closed trades']);
  assert.equal(textOf(panelOf(fakeRes()), 'Gate').text, 'L · READY · 4/5');
});

test('stats from trades', () => {
  const p = panelOf(fakeRes({ trades: [trade('PB', 1, 'A'), trade('PB', -1, 'B'), trade('PB', 0, 'A'), trade('TR', 5, 'C')] }));
  assert.deepEqual(labels(p).slice(7), ['PERFORMANCE', 'Win rate', 'Avg R', 'Total R', 'A grade', 'B grade', 'C grade']);
  assert.equal(textOf(p, 'PERFORMANCE').text, 'n = 3');
  assert.deepEqual(textOf(p, 'Win rate'), { text: '33%  (1W / 1L)', color: PINE_COLORS.white });
  assert.deepEqual(textOf(p, 'Avg R'), { text: '+0.00R', color: PINE_COLORS.lime });
  assert.deepEqual(textOf(p, 'Total R'), { text: '+0.00R', color: PINE_COLORS.lime });
  assert.deepEqual(textOf(p, 'A grade'), { text: '+0.50R  (2)', color: PINE_COLORS.lime });
  assert.deepEqual(textOf(p, 'B grade'), { text: '-1.00R  (1)', color: PINE_COLORS.red });
  assert.deepEqual(textOf(p, 'C grade'), { text: '—  (0)', color: PINE_COLORS.gray });
});

test('negative averages turn red, and the trail model keeps its own record', () => {
  const p = panelOf(fakeRes({ trades: [trade('PB', -1.5), trade('PB', 0.25), trade('TR', 2, 'C'), trade('TR', 1, 'C')] }), { useTrailModel: true });
  const at = (title) => labels(p).indexOf(title);
  assert.equal(p.rows[at('PERFORMANCE · PULLBACK')].cells[1].text, 'n = 2');
  assert.equal(p.rows[at('PERFORMANCE · TRAIL')].cells[1].text, 'n = 2');
  const pbRows = p.rows.slice(at('PERFORMANCE · PULLBACK'), at('PERFORMANCE · TRAIL'));
  assert.deepEqual(pbRows.slice(1, 4).map((r) => r.cells[1]), [
    { text: '50%  (1W / 1L)', color: PINE_COLORS.white }, { text: '-0.63R', color: PINE_COLORS.red }, { text: '-1.25R', color: PINE_COLORS.red },
  ]);
  const trRows = p.rows.slice(at('PERFORMANCE · TRAIL'));
  assert.deepEqual(trRows.slice(1, 4).map((r) => r.cells[1].text), ['100%  (2W / 0L)', '+1.50R', '+3.00R']);
  assert.equal(trRows[6].cells[1].text, '+1.50R  (2)');
});

test('stats rows follow their switch', () => {
  const p = panelOf(fakeRes({ trades: [trade('PB', 1)] }), { showStatsPanel: false });
  assert.deepEqual(labels(p), ['STRUCTURE', 'Major trend', 'Range', 'Last event', 'Internal', 'Confirm', 'Gate']);
});

test('point stats: true / false averages per model, only once a model has trades', () => {
  const trades = [
    trade('PB', 2, 'A', { kz: 1, ichi: 1 }), trade('PB', -1, 'A', { kz: 1 }), trade('PB', 0.5, 'B', { mom: 1 }), trade('TR', 3, 'C', { part: 1 }),
  ];
  const p = panelOf(fakeRes({ trades }), { showPointStats: true });
  const i = labels(p).indexOf('POINTS');
  assert.deepEqual(labels(p).slice(i), ['POINTS', 'Killzone', 'Momentum', 'MA', 'Major Agree', 'Break Strength', 'Participation', 'Ichimoku']);
  assert.deepEqual(p.rows[i].cells.map((c) => c.text), ['POINTS', 'true / false']);
  const pt = (name) => textOf(p, name);
  assert.deepEqual(pt('Killzone'), { text: '+0.50R (2) / +0.50R (1)', color: PINE_COLORS.white });
  assert.equal(pt('Momentum').text, '+0.50R (1) / +0.50R (2)');
  assert.equal(pt('MA').text, '— (0) / +0.50R (3)');
  assert.equal(pt('Ichimoku').text, '+2.00R (1) / -0.25R (2)');
  // the trail block needs the model enabled and a closed trailing trade
  const both = panelOf(fakeRes({ trades }), { showPointStats: true, useTrailModel: true });
  assert.deepEqual(labels(both).filter((l) => l.startsWith('POINTS')), ['POINTS · PULLBACK', 'POINTS · TRAIL']);
  const trRows = both.rows.slice(labels(both).indexOf('POINTS · TRAIL'));
  assert.equal(trRows.length, 8);
  assert.equal(trRows[6].cells[1].text, '+3.00R (1) / — (0)');
  // no closed trade, no block; switched off, no block
  assert.ok(!labels(panelOf(fakeRes(), { showPointStats: true })).includes('POINTS'));
  assert.ok(!labels(panelOf(fakeRes({ trades }))).includes('POINTS'));
});

test('a live pullback trade writes the six TRADE rows from the engine trade', () => {
  const values = { ...defaultValues(), ...LOOSE };
  const p = buildRenderPlan(bars, values, ctx).panel;
  const t = runEngine(bars, resolveConfig(values).engineCfg, { symbol: 'TEST', mintick: 0.01 }).final.pbTrade;
  assert.ok(t, 'the series must leave a live pullback trade');
  const i = labels(p).indexOf('TRADE');
  assert.equal(i, 7);
  assert.deepEqual(labels(p).slice(i, i + 7), ['TRADE', 'Entry', 'Stop', 'TP1 / TP2', 'TP3', 'Open R', 'PERFORMANCE']);
  const rT = Math.abs(t.entry - t.initialStop), last = bars.at(-1).close;
  const openR = ((t.side === 'long' ? last - t.entry : t.entry - last) / rT).toFixed(2);
  assert.equal(p.rows[i].cells[1].text, `${t.side === 'long' ? 'LONG' : 'SHORT'}${t.runner ? ' · RUN' : ''} · ${t.grade} · ${t.score}/${t.scoreOf}`);
  assert.equal(p.rows[i].cells[1].color, t.side === 'long' ? defaultValues().tradeLongColor : defaultValues().tradeShortColor);
  assert.match(p.rows[i + 1].cells[1].text, new RegExp(`^${t.entry.toFixed(2)}  ·  \\d+\\.\\dx ATR$`));
  assert.equal(textOf(p, 'Open R').text, `${openR}R`);
  assert.equal(textOf(p, 'Open R').color, Number(openR) >= 0 ? PINE_COLORS.lime : PINE_COLORS.red);
  assert.equal(textOf(p, 'Stop').color, defaultValues().tradeStopColor);
  assert.equal(textOf(p, 'TP3').color, defaultValues().tradeTargetColor);
});

test('trade block texts: breakeven, runner, ticks and R multiples', () => {
  const t = liveTrade({ runner: true, tpHit: 2, stop: 100 });
  const p = panelOf(fakeRes({ final: { pbTrade: t } }), {}, ctx, { lastClose: 103 });
  const i = labels(p).indexOf('TRADE');
  assert.equal(p.rows[i].cells[0].text, 'TRADE');
  assert.equal(p.rows[i].cells[1].text, 'LONG · RUN · B · 4/5');
  assert.equal(p.rows[i + 1].cells[1].text, '100.00  ·  1.0x ATR');
  assert.equal(p.rows[i + 2].cells[1].text, '100.00 · BE+ · 0.0R');
  assert.equal(p.rows[i + 3].cells[1].text, '102.00 ✓ (1.0R)  104.00 ✓ (2.0R)');
  assert.equal(p.rows[i + 4].cells[1].text, '108.00 (4.0R)');
  assert.deepEqual(p.rows[i + 5].cells[1], { text: '1.50R', color: PINE_COLORS.lime });
  // a short below its entry
  const s = panelOf(fakeRes({ final: { pbTrade: liveTrade({ side: 'short', entry: 100, stop: 102, initialStop: 102, tp1: 98, tp2: 96, tp3: 92 }) } }), {}, ctx, { lastClose: 103 });
  assert.equal(textOf(s, 'Open R').text, '-1.50R');
  assert.equal(textOf(s, 'Open R').color, PINE_COLORS.red);
  assert.equal(textOf(s, 'Stop').text, '102.00 · 1.0R');
  assert.equal(s.rows[labels(s).indexOf('TRADE')].cells[1].text, 'SHORT · B · 4/5');
  // a zero-risk trade shows a dash for Open R
  const z = panelOf(fakeRes({ final: { pbTrade: liveTrade({ initialStop: 100, stop: 100 }) } }), {}, ctx, { lastClose: 103 });
  assert.equal(textOf(z, 'Open R').text, '—');
  // the trade rows follow their switch
  assert.ok(!labels(panelOf(fakeRes({ final: { pbTrade: t } }), { showTradePanel: false })).includes('TRADE'));
});

test('both live slots render pullback first, the trailing one tagged', () => {
  const p = panelOf(fakeRes({ final: { pbTrade: liveTrade(), trTrade: liveTrade({ side: 'short', stop: 102, initialStop: 102 }) } }), { useTrailModel: true }, ctx, { lastClose: 101 });
  assert.deepEqual(labels(p).filter((l) => l.endsWith('TRADE')), ['TRADE', 'TRAIL TRADE']);
  assert.equal(labels(p).indexOf('TRAIL TRADE') - labels(p).indexOf('TRADE'), 6);
  assert.deepEqual(labels(p).slice(-4, -2), ['PERFORMANCE · PULLBACK', 'No closed trades']);
});

test('the Data row lists the warnings in one row, only when there are some', () => {
  assert.ok(!labels(buildRenderPlan(bars, defaultValues(), ctx).panel).includes('Data'));
  const p = panelOf(fakeRes(), {}, ctx, { warnings: ['History: 5 years (Thndr limit)', 'No volume on this chart: participation and VWAP are off'] });
  assert.equal(labels(p).at(-1), 'Data');
  assert.deepEqual(p.rows.at(-1).cells.map((c) => c.text), ['Data', 'History: 5 years (Thndr limit) · No volume on this chart: participation and VWAP are off']);
});

test('buildRenderPlan gathers the chart warnings into meta and the panel', () => {
  const full = { ...ctx, historyNote: 'History: 5 years (Thndr limit)', volumeMissing: true };
  const p = buildRenderPlan(bars, { ...defaultValues(), requireIndexTrend: true, requireHtfBias: true }, { ...full, resolution: '1S' });
  assert.equal(p.meta.warnings.length, 4);
  assert.deepEqual(p.meta.warnings.slice(0, 3), ['History: 5 years (Thndr limit)', 'No volume on this chart: participation and VWAP are off', 'Index filter not available on ThndrX']);
  assert.match(p.meta.warnings[3], /HTF bias/);
  assert.equal(textOf(p.panel, 'Data').text, p.meta.warnings.join(' · '));
  // nothing set: no warnings, no row; the index warning follows the raw user value
  assert.deepEqual(buildRenderPlan(bars, defaultValues(), { ...ctx, historyNote: null, volumeMissing: false }).meta.warnings, []);
  assert.deepEqual(buildRenderPlan(bars, { ...defaultValues(), requireIndexTrend: true }, ctx).meta.warnings, ['Index filter not available on ThndrX']);
});

const dataDir = process.env.ICT_DATA;
test('VLMRA EGX Daily panel numbers', { skip: !dataDir }, () => {
  const real = loadSymbol('VLMRA', dataDir);
  const rctx = { symbol: 'VLMRA', mintick: 0.01, resolution: '1D', lastBarOpen: false };
  for (const values of [{ ...defaultValues(), presetInput: 'EGX Daily' }, { ...defaultValues(), presetInput: 'EGX Daily', useTrailModel: true, showPointStats: true }]) {
    const { engineCfg } = resolveConfig(values);
    const res = runEngine(real, engineCfg, { symbol: 'VLMRA', mintick: 0.01 });
    const p = buildRenderPlan(real, values, rctx).panel;
    const pb = summarize(res.trades, (t) => t.model === 'PB');
    assert.ok(pb.n > 0, 'VLMRA must have closed pullback trades');
    const head = labels(p).find((l) => l.startsWith('PERFORMANCE'));
    assert.equal(head, values.useTrailModel ? 'PERFORMANCE · PULLBACK · EGX DAILY' : 'PERFORMANCE · EGX DAILY');
    const block = p.rows.slice(labels(p).indexOf(head));
    assert.equal(block[0].cells[1].text, `n = ${pb.n}`);
    const rTxt = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
    assert.equal(block[3].cells[1].text, rTxt(pb.r));
    assert.equal(block[2].cells[1].text, rTxt(pb.r / pb.n));
    assert.equal(block[1].cells[1].text.split('%')[0], (100 * pb.wins / pb.n).toFixed(0));
    if (values.useTrailModel) {
      const tr = summarize(res.trades, (t) => t.model === 'TR');
      const trBlock = p.rows.slice(labels(p).indexOf('PERFORMANCE · TRAIL · EGX DAILY'));
      assert.equal(trBlock[0].cells[1].text, `n = ${tr.n}`);
      if (tr.n > 0) assert.equal(trBlock[3].cells[1].text, rTxt(tr.r));
    }
  }
});
