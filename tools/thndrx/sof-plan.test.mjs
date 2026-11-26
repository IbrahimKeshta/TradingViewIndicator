// node --test tools/thndrx/sof-plan.test.mjs
// The Session Order Flow dashboard texts per verdict branch, the plan items built from the engine's drawings, and key
// stability across a new bar (so a repaint touches only what changed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sofPanel, sofMessagePanel, htfLabel } from './sof-panel.mjs';
import { buildSofPlan, symbolMeta } from './sof-plan.mjs';
import { sofDefaults } from './sof-inputs.mjs';
import { makeBars } from './test-bars.mjs';

const V = { ...sofDefaults() };
const ctx = { mintick: 0.01, symType: 'stock', warnings: [] };
const baseFinal = {
  close: 100, atrValue: 2, verdict: 1, bias: 0, extended: false, flowAgainst: false, lowVolume: false, valuePos: 0,
  rangeUsedPct: 40, rangeExhausted: false, devPoc: 99.5, devVah: 101, devVal: 98, prevPoc: 97, refHi: 104, refLo: 95,
  sawVolume: true, nearBsl: 105, nearSsl: 94, buyPct: 57.4, cumDelta: 1847582, volRecent: 50, volNormal: 100,
  hiStatus: 'Intact', loStatus: 'Swept', flow: 'buyDom', lastLiq: { isHigh: false, htf: true, accepted: false, level: 95 }, lastLiqBarsAgo: 3,
  is24hMode: false, sessionsOn: false, openRangeOn: false, anchorName: 'week', refName: 'Prior week', htfSecs: 604800, htfTf: 'W', trade: null, run: null,
};
const res = (f, extra = {}) => ({ final: { ...baseFinal, ...f }, trades: [], runTrades: [], ...extra });
const texts = (p) => p.rows.map((r) => r.cells.map((c) => c.text));
const rowOf = (p, k) => p.rows.find((r) => r.cells[0].text === k);

test('AVOID: range used, reset when the period opens', () => {
  const p = sofPanel(res({ verdict: 0, rangeUsedPct: 92.6, rangeExhausted: true, bias: 1 }), V, ctx);
  assert.deepEqual(texts(p).slice(0, 3), [['Conditions', 'AVOID'], ['Why', '93% of the average week range is already used'], ['Look for', 'Avoid chasing. This resets when a new week opens.']]);
  assert.equal(rowOf(p, 'Conditions').cells[1].color, V.colBear);
  assert.equal(rowOf(p, 'Range used').cells[1].text, '93% of avg week  [EXHAUSTED]');
});

test('FAVOURABLE long: the next pool and where the bias fails', () => {
  const p = sofPanel(res({ verdict: 2, bias: 1 }), V, ctx);
  assert.equal(rowOf(p, 'Conditions').cells[1].text, 'FAVOURABLE — long side');
  assert.equal(rowOf(p, 'Look for').cells[1].text, 'Longs favoured. Next pool 105.00. Bias fails below POC 99.50.');
  const none = sofPanel(res({ verdict: 2, bias: -1, nearSsl: NaN }), V, ctx);
  assert.equal(rowOf(none, 'Look for').cells[1].text, 'Shorts favoured. No liquidity pool ahead. Bias fails above POC 99.50.');
  assert.equal(rowOf(none, 'Conditions').cells[1].color, V.colBear);
});

test('WAIT: each reason in Pine order', () => {
  assert.equal(rowOf(sofPanel(res({ bias: 0 }), V, ctx), 'Why').cells[1].text, "Price is between today's POC and the prior POC");
  assert.equal(rowOf(sofPanel(res({ bias: 0, devPoc: NaN }), V, ctx), 'Look for').cells[1].text, 'This symbol reports no volume.');
  assert.equal(rowOf(sofPanel(res({ bias: 1, extended: true, valuePos: -1 }), V, ctx), 'Look for').cells[1].text, 'Wait for price to get back inside value (98.00 – 101.00).');
  assert.equal(rowOf(sofPanel(res({ bias: -1, extended: true, valuePos: -1 }), V, ctx), 'Look for').cells[1].text, 'Wait for a pullback toward VAL 98.00 or POC 99.50.');
  assert.equal(rowOf(sofPanel(res({ bias: 1, flowAgainst: true, flow: 'sellDom' }), V, ctx), 'Why').cells[1].text, 'Order flow disagrees with the bias (Selling dominance)');
  assert.equal(rowOf(sofPanel(res({ bias: 1, lowVolume: true }), V, ctx), 'Why').cells[1].text, 'Volume is thin (50% of normal)');
});

test('Full rows: reference range, value area, liquidity, last taken, flow and mode', () => {
  const p = sofPanel(res({ bias: 1 }), V, ctx);
  assert.equal(rowOf(p, 'Bias').cells[1].text, 'Bullish  (POC 99.50, prior POC 97.00)');
  assert.equal(rowOf(p, 'Prior week range').cells[1].text, 'High Intact @ 104.00  ·  Low Swept @ 95.00');
  assert.equal(rowOf(p, 'Prior week range').cells[1].color, V.colAccum);
  assert.equal(rowOf(p, 'Value area').cells[1].text, 'Inside value  (98.00 – 101.00)');
  assert.equal(rowOf(p, 'Liquidity').cells[1].text, 'BSL 105.00 (2.5 ATR)  ·  SSL 94.00 (3 ATR)');
  assert.equal(rowOf(p, 'Last taken').cells[1].text, 'HTF SSL [W] swept @ 95.00  (3 bars ago)');
  assert.equal(rowOf(p, 'Flow (est.)').cells[1].text, 'Buying dominance  ·  57% buy  ·  net Δ +1.85M');
  assert.equal(rowOf(p, 'Mode').cells[1].text, 'Single session, no opening-range box on this timeframe');
  assert.equal(p.position, 'top_right');
  assert.equal(p.pre, true);
});

test('Compact detail keeps only the first four rows; Show Dashboard off hides the panel', () => {
  assert.equal(sofPanel(res({}), { ...V, dashDetail: 'Compact' }, ctx).rows.length, 4);
  assert.equal(sofPanel(res({}), { ...V, showDashboard: false }, ctx), null);
  assert.equal(sofMessagePanel({ ...V, showDashboard: false }, 'Loading…'), null);
  assert.equal(sofMessagePanel({ ...V, dashPosition: 'Bottom left' }, 'Loading…').position, 'bottom_left');
});

test('trade rows: liquidity run (open trade and record) and the sweep model', () => {
  const run = sofPanel(res({ run: { dir: 1, entry: 100, stop: 84, risk: 16 }, close: 104 }, { runTrades: [{ r: 2.5 }, { r: -0.5 }] }), { ...V, showTrades: true }, ctx);
  assert.equal(rowOf(run, 'Trade (run)').cells[1].text, 'LONG  entry 100.00  ·  trailing stop 84.00  ·  open +0.25R');
  assert.equal(rowOf(run, 'Record (run)').cells[1].text, '2 trades  ·  avg +1.00R  ·  total +2.0R\nwin 50%  ·  best 2.5R  ·  worst -0.5R\nbefore costs, 8 ATR trail, EMA 200');
  const sweep = sofPanel(res({ trade: { dir: -1, entry: 100, stop: 102, tp1: 98, tp2: 95, tp1Hit: true } }, { trades: [{ grossR: -1, outcome: 'stopped' }, { grossR: 1.5, outcome: 'tp2' }] }), { ...V, showTrades: true, entryModel: 'Sweep reversal' }, ctx);
  assert.equal(rowOf(sweep, 'Trade (exp.)').cells[1].text, 'SHORT  entry 100.00  ·  SL 102.00  ·  TP1 98.00 ✓  ·  TP2 95.00');
  assert.equal(rowOf(sweep, 'Record (exp.)').cells[1].text, '2 trades  ·  avg +0.25R  ·  total +0.5R\nstopped 50%  ·  TP1 only 0%  ·  TP2 50%\nbefore costs, Not against bias');
  assert.equal(rowOf(sofPanel(res({}), V, ctx), 'Trade (run)'), undefined, 'module off: no trade rows');
});

test('htfLabel and symbolMeta', () => {
  assert.deepEqual([htfLabel(900, '15'), htfLabel(3600, '60'), htfLabel(14400, '240'), htfLabel(86400, 'D')], ['15m', '1h', '4h', 'D']);
  assert.deepEqual(symbolMeta({ type: 'stock', timezone: 'Africa/Cairo', session: '1;1000-1430:12345' }), { symType: 'stock', exTz: 'Africa/Cairo', sessionStartMin: 600, weekStart: 0 });
  assert.deepEqual(symbolMeta({ type: 'stock', timezone: 'America/New_York', session: '0930-1600:23456' }), { symType: 'stock', exTz: 'America/New_York', sessionStartMin: 570, weekStart: 1 });
  assert.equal(symbolMeta(null).exTz, 'Africa/Cairo');
});

// ---- the plan on synthetic bars ----
const closes = (n) => Array.from({ length: n }, (_, i) => 100 + 15 * Math.sin(i / 9) + 6 * Math.sin(i / 3.3) + i * 0.03);
const planCtx = (extra = {}) => ({ symbol: 'SYN', mintick: 0.01, resolution: '1D', lastBarOpen: false, ...extra });

test('plan: boxes, lines and labels from the engine drawings, with Pine styles and texts', () => {
  const bars = makeBars(closes(700));
  const plan = buildSofPlan(bars, { ...V, showTrades: true, runTrendLen: 50 }, planCtx());
  assert.ok(plan.boxes.length > 0 && plan.lines.length > 0 && plan.labels.length > 0);
  const pool = plan.boxes.find((b) => /^(HTF )?[BS]SL/.test(b.text));
  assert.ok(pool && pool.hAlign === 'right');
  assert.ok(plan.lines.some((l) => l.width === 2 && l.color === V.colPoc), 'developing POC line');
  assert.ok(plan.labels.some((l) => l.text === 'POC'), 'POC tag');
  assert.ok(plan.labels.some((l) => l.text === 'BUY' || l.text === 'SELL'), 'trade entries');
  assert.ok(plan.labels.some((l) => /^[+-]?\d+\.\d\dR$/.test(l.text)), 'run results');
  assert.ok(plan.boxes.length <= 200 && plan.lines.length <= 500 && plan.labels.length <= 500);
  assert.equal(plan.panel.rows[0].cells[0].text, 'Conditions');
});

test('plan: a new closed bar keeps the keys of everything created before it', () => {
  const all = makeBars(closes(701));
  const a = buildSofPlan(all.slice(0, 700), V, planCtx()), b = buildSofPlan(all, V, planCtx());
  const keysA = new Set([...a.boxes, ...a.lines, ...a.labels].map((x) => x.key));
  const keysB = new Set([...b.boxes, ...b.lines, ...b.labels].map((x) => x.key));
  const kept = [...keysA].filter((k) => keysB.has(k)).length;
  assert.ok(kept >= keysA.size - 12, `kept ${kept} of ${keysA.size}`);
});

test('plan: the 24h-mode session boxes carry name and state', () => {
  const bars = makeBars(closes(2000), { stepSec: 900, start: Date.UTC(2025, 2, 3) / 1000 });
  const plan = buildSofPlan(bars, { ...V, marketMode: '24h sessions' }, { ...planCtx({ resolution: '15' }), extra: { meta: { symType: 'crypto', exTz: 'Etc/UTC', sessionStartMin: 0, weekStart: 1 } } });
  const sess = plan.boxes.filter((b) => b.dashed);
  assert.ok(sess.some((b) => /^(ASIA|LONDON|NEW YORK) (ACCUMULATION|BULL BREAKOUT|BEAR BREAKOUT)$/.test(b.text)), sess.map((b) => b.text).slice(0, 5).join(','));
  assert.equal(plan.panel.rows.find((r) => r.cells[0].text === 'Mode').cells[1].text, '24h sessions');
});

test('plan: no bars, no volume and the intrabar note reach the Data row', () => {
  assert.equal(buildSofPlan([], V, planCtx()).panel, null);
  const p = buildSofPlan(makeBars(closes(300)), V, planCtx({ volumeMissing: true, historyNote: 'History: 5 years (Thndr limit)', extra: { note: 'Intrabars unavailable on this ThndrX build: chart bars used' } }));
  const data = p.panel.rows.find((r) => r.cells[0].text === 'Data').cells[1].text;
  assert.match(data, /5 years/);
  assert.match(data, /Intrabars unavailable/);
  assert.match(data, /No volume/);
  assert.equal(p.panel.rows.find((r) => r.cells[0].text === 'Flow (est.)').cells[1].text, 'n/a (no volume on this symbol)');
});
