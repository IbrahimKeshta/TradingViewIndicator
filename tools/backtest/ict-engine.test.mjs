// node --test tools/backtest/ict-engine.test.mjs
// Covers the render-state additions to runEngine (zone left edge, events, opens, series, final, gate, HTF bias input,
// preset killzone point). Trade results themselves are pinned by validate.mjs, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, DEFAULTS, PRESETS } from './ict-engine.mjs';
import { makeBars } from '../thndrx/test-bars.mjs';

const GATE_REASONS = ['no trend', 'in range', 'htf bias', 'index trend', 'anchored vwap', 'awaiting confirmation', 'no zone touch', 'score short', 'READY'];
const MARKS = ['✓', '✗', '–'];

// Deterministic swings (two sines plus a drift): enough structure for zones, breaks and trades, no randomness.
const wave = (n) => Array.from({ length: n }, (_, i) => +(100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + 0.02 * i).toFixed(4));
const bars = makeBars(wave(500));
// Loose gate so the synthetic series opens trades on both sides; the tests below care about the plumbing, not the edge.
const LOOSE = { minScore: 3, minRiskAtr: 0.5 };
const res = runEngine(bars, LOOSE, {});

test('zones carry their left edge (FVG: i - 2)', () => {
  // flat, then a two-bar gap up: bar 10's low (108.9) clears bar 8's high (101), a bullish FVG created at bar 10.
  const closes = [...Array(9).fill(100), 110, 111, ...Array(10).fill(111)];
  const r = runEngine(makeBars(closes), {}, {});
  assert.equal(r.final.bullFvg.length, 1);
  assert.equal(r.final.bullFvg.at(-1).bar, 10);
  assert.equal(r.final.bullFvg.at(-1).left, 8);
});

test('zones carry their left edge (OB: the opposite candle, i - off)', () => {
  const obs = [...res.final.bullOb, ...res.final.bearOb];
  assert.ok(obs.length > 0, 'the series must leave at least one live order block');
  for (const z of obs) {
    assert.ok(z.left < z.bar);
    assert.equal(bars[z.left].high, z.top);
    assert.equal(bars[z.left].low, z.bottom);
  }
});

test('events record BOS/CHoCH per tier', () => {
  assert.ok(res.events.length > 0);
  for (const e of res.events) {
    assert.ok(['BOS', 'CHoCH'].includes(e.type));
    assert.ok(['major', 'internal'].includes(e.tier));
    assert.ok(['bull', 'bear'].includes(e.side));
    assert.ok(Number.isFinite(e.level));
    assert.ok(e.levelBar >= 0 && e.levelBar < e.bar && e.bar < bars.length);
    // a bull break closes above the level it breaks, a bear break below it
    assert.ok(e.side === 'bull' ? bars[e.bar].close > e.level : bars[e.bar].close < e.level);
  }
  for (const tier of ['major', 'internal']) {
    const ev = res.events.filter((e) => e.tier === tier);
    assert.ok(ev.length > 0);
    assert.equal(ev[0].type, 'BOS', 'the first break of a tier has no trend to flip, so it is a BOS');
    assert.ok(ev.some((e) => e.type === 'CHoCH'));
    assert.deepEqual(ev.map((e) => e.bar), [...ev.map((e) => e.bar)].sort((a, b) => a - b));
  }
});

test('opens lists every trade that was opened', () => {
  assert.equal(res.opens.length, res.trades.length + res.openTrades.length);
  assert.ok(res.opens.some((o) => o.side === 'long') && res.opens.some((o) => o.side === 'short'));
  for (const o of res.opens) { assert.equal(o.model, 'PB'); assert.ok(o.bar >= 0 && o.bar < bars.length); }
  assert.deepEqual(
    res.opens.map((o) => o.bar).sort((a, b) => a - b),
    res.trades.map((t) => t.openIdx).concat(res.openTrades.map((t) => t.openBar)).sort((a, b) => a - b));
});

test('the trailing-stop model opens are tagged TR', () => {
  const r = runEngine(bars, { ...LOOSE, useTrailModel: true, trailRequireTrend: false, trailMinRiskAtr: 0 }, {});
  assert.ok(r.opens.some((o) => o.model === 'TR'));
  assert.equal(r.opens.length, r.trades.length + r.openTrades.length);
});

test('trades carry the liquidity flags of their targets', () => {
  assert.ok(res.trades.length > 0);
  for (const t of res.openTrades) for (const k of ['liq1', 'liq2', 'liq3']) assert.equal(typeof t[k], 'boolean', k);
  assert.ok(res.openTrades.length > 0);
});

test('series lengths equal bar count', () => {
  const keys = ['ma', 'rsi', 'structAtr', 'spanA', 'spanB', 'killzoneActive', 'trailLong', 'trailShort', 'trailDir', 'avwapLow', 'avwapHigh', 'longSetup', 'shortSetup'];
  assert.deepEqual(Object.keys(res.series).sort(), [...keys].sort());
  for (const k of keys) assert.equal(res.series[k].length, bars.length, k);
  assert.ok(res.series.trailDir instanceof Int8Array);
  assert.ok(res.series.longSetup instanceof Uint8Array && res.series.shortSetup instanceof Uint8Array);
  assert.ok(res.series.ma instanceof Float64Array);
  // the per-bar values are the ones the loop used: every pullback open sits on a bar whose setup flag is set
  for (const o of res.opens) assert.equal(res.series[o.side === 'long' ? 'longSetup' : 'shortSetup'][o.bar], 1);
  assert.ok(res.series.trailDir.every((d) => d === 1 || d === -1));
  assert.ok(Number.isFinite(res.series.trailLong.at(-1)) && Number.isFinite(res.series.avwapLow.at(-1)));
});

test('final carries the last-bar state, live trades only', () => {
  const f = res.final;
  for (const k of ['majorSt', 'intSt', 'majorHighs', 'majorLows', 'intHighs', 'intLows', 'bullFvg', 'bearFvg', 'bullOb', 'bearOb']) assert.ok(f[k] && typeof f[k] === 'object', k);
  assert.equal(typeof f.inRange, 'boolean');
  assert.ok(f.intSt.trend === 'up' || f.intSt.trend === 'down');
  assert.equal(res.openTrades.length, 1);
  assert.equal(f.pbTrade, res.openTrades[0]);
  assert.equal(f.trTrade, null);
  // cut right after a trade closed: the dead trade object is not reported as live
  const lastClose = res.trades.at(-1).closeIdx;
  const closed = runEngine(bars.slice(0, lastClose + 1), LOOSE, {});
  assert.equal(closed.final.pbTrade, null);
  assert.equal(closed.openTrades.length, 0);
});

test('final.gate names the first unmet condition', () => {
  const g = res.final.gate;
  assert.ok(GATE_REASONS.includes(g.reason));
  assert.equal(typeof g.long, 'boolean');
  assert.ok(Number.isInteger(g.score) && Number.isInteger(g.of) && g.score <= g.of);
  for (const k of ['mom', 'part', 'ichi']) assert.ok(MARKS.includes(g.marks[k]), k);
  // too short for any structure: nothing to test yet, and the side falls back to long
  const flat = runEngine(makeBars(Array(15).fill(100)), {}, {});
  assert.equal(flat.final.gate.reason, 'no trend');
  assert.equal(flat.final.gate.long, true);
});

test('gate is READY on the bar a setup fires, and names the HTF veto when bias disagrees', () => {
  const open = res.opens.find((o) => o.side === 'long');
  const cut = bars.slice(0, open.bar + 1);
  const ready = runEngine(cut, LOOSE, {});
  assert.equal(ready.final.gate.reason, 'READY');
  assert.equal(ready.final.gate.long, true);
  assert.ok(ready.final.gate.score >= LOOSE.minScore);
  assert.ok(ready.final.pbTrade && ready.final.pbTrade.closeReason === null);
  const vetoed = runEngine(cut, { ...LOOSE, requireHtfBias: true }, { htfActive: true, htfBias: new Int8Array(cut.length).fill(-1) });
  assert.equal(vetoed.final.gate.reason, 'htf bias');
  assert.equal(vetoed.final.pbTrade, null);
  const agreed = runEngine(cut, { ...LOOSE, requireHtfBias: true }, { htfActive: true, htfBias: new Int8Array(cut.length).fill(1) });
  assert.equal(agreed.final.gate.reason, 'READY');
});

test('gate reasons seen over the series cover the touch and score steps', () => {
  const seen = new Set();
  for (let n = 40; n <= bars.length; n++) seen.add(runEngine(bars.slice(0, n), LOOSE, {}).final.gate.reason);
  for (const r of ['no zone touch', 'score short', 'READY']) assert.ok(seen.has(r), 'reason seen on some bar: ' + r);
  for (const r of seen) assert.ok(GATE_REASONS.includes(r), r);
});

test('htf bias blocks longs when active and bias is -1', () => {
  const all = runEngine(bars, LOOSE, {});
  const blocked = runEngine(bars, { ...LOOSE, requireHtfBias: true }, { htfActive: true, htfBias: new Int8Array(bars.length).fill(-1) });
  assert.ok(all.opens.some((o) => o.side === 'long'));
  assert.ok(!blocked.opens.some((o) => o.side === 'long'));
  assert.ok(blocked.opens.some((o) => o.side === 'short'), 'bias -1 lets shorts through');
  const bull = runEngine(bars, { ...LOOSE, requireHtfBias: true }, { htfActive: true, htfBias: new Int8Array(bars.length).fill(1) });
  assert.ok(bull.opens.some((o) => o.side === 'long') && !bull.opens.some((o) => o.side === 'short'));
});

test('htf bias filter is inactive without the input, and no longer throws', () => {
  const base = runEngine(bars, LOOSE, {});
  for (const cfg of [{ requireHtfBias: true }, { requireHtfBias: true, htfBiasTf: '1W' }]) {
    const r = runEngine(bars, { ...LOOSE, ...cfg }, {});
    assert.deepEqual(r.trades, base.trades);
  }
  // htfActive false (bias timeframe not above the chart) leaves the filter off even with a bias array
  const off = runEngine(bars, { ...LOOSE, requireHtfBias: true }, { htfActive: false, htfBias: new Int8Array(bars.length).fill(-1) });
  assert.deepEqual(off.trades, base.trades);
});

test('killzoneAlwaysEarned scores the point on every bar', () => {
  const hourly = makeBars(wave(300), { stepSec: 3600 });
  const a = runEngine(hourly, { scoreKillzone: false }, {});
  const b = runEngine(hourly, { scoreKillzone: false, killzoneAlwaysEarned: true }, {});
  assert.equal(b.final.gate.of, a.final.gate.of + 1);
  assert.equal(b.final.gate.score, a.final.gate.score + 1);
  // the killzone series itself still reports the real session, not the preset override
  assert.deepEqual(b.series.killzoneActive, a.series.killzoneActive);
  assert.ok(b.series.killzoneActive.some((v) => v === 0) && b.series.killzoneActive.some((v) => v === 1));
});

test('killzoneAlwaysEarned: default off, on in the EGX Daily preset', () => {
  assert.equal(DEFAULTS.killzoneAlwaysEarned, false);
  assert.equal(PRESETS['egx-daily'].killzoneAlwaysEarned, true);
  assert.equal(PRESETS['tv-r4'].killzoneAlwaysEarned, undefined);
});
