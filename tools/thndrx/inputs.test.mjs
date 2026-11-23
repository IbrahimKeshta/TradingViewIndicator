import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULTS, PRESETS } from '../backtest/ict-engine.mjs';
import { INPUTS, defaultValues, resolveConfig, loadValues, saveValues } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { fmtPrice, fmtNum } from './format.mjs';

const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('schema matches every input declared in the Pine', () => {
  const src = fs.readFileSync(new URL('../../src/ict-rsi-ma-indicator.pine', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/^(\w+)\s*=\s*input\./gm)].map((m) => m[1]);
  assert.equal(ids.length, 125);
  assert.deepEqual(INPUTS.map((i) => i.id), ids);
});

test('the four Index Filter inputs are flagged unavailable', () => {
  const idx = INPUTS.filter((i) => i.group === 'Index Filter');
  assert.deepEqual(idx.map((i) => i.id), ['requireIndexTrend', 'indexMode', 'idxRegimeLen', 'idxSlopeLen']);
  for (const i of idx) assert.equal(i.unavailable, 'Not available on ThndrX: the index needs a second data feed.');
  assert.ok(INPUTS.filter((i) => i.group !== 'Index Filter').every((i) => i.unavailable === undefined));
});

test('defaults resolve to engine DEFAULTS', () => {
  const { engineCfg } = resolveConfig(defaultValues());
  let checked = 0;
  for (const [k, v] of Object.entries(engineCfg)) if (k in DEFAULTS && k !== 'killzoneAlwaysEarned') { assert.deepEqual(v, DEFAULTS[k], k); checked++; }
  assert.ok(checked > 80, `only ${checked} engine keys compared`);
  assert.equal(engineCfg.killzoneAlwaysEarned, false);
  assert.equal(engineCfg.testStart, DEFAULTS.testStart); // ms in the form, seconds in the engine
});

test('EGX Daily resolves to the egx-daily preset', () => {
  const { engineCfg, presetTag } = resolveConfig({ ...defaultValues(), presetInput: 'EGX Daily' });
  for (const [k, v] of Object.entries(PRESETS['egx-daily'])) assert.deepEqual(engineCfg[k], v, k);
  assert.equal(engineCfg.trailTier, 'Major');
  assert.equal(engineCfg.minRiskTicks, 10);
  assert.equal(presetTag, ' · EGX DAILY');
  assert.equal(resolveConfig(defaultValues()).presetTag, '');
});

test('Custom preset passes the raw inputs through to the engine keys', () => {
  const { engineCfg } = resolveConfig({ ...defaultValues(), stopOnCloseOnlyIn: true, trailTierInput: 'Major', minRiskTicksIn: 7, maTypeInput: 'SMA' });
  assert.equal(engineCfg.stopOnCloseOnly, true);
  assert.equal(engineCfg.trailTier, 'Major');
  assert.equal(engineCfg.minRiskTicks, 7);
  assert.equal(engineCfg.maType, 'SMA');
  assert.equal(engineCfg.runnerMode, false);
});

test('index filter is forced off', () => {
  assert.equal(resolveConfig({ ...defaultValues(), requireIndexTrend: true }).engineCfg.requireIndexTrend, false);
});

test('display carries show flags, colours and panel settings under their Pine names', () => {
  const { display } = resolveConfig(defaultValues());
  assert.equal(display.showFVG, true);
  assert.equal(display.panelPosInput, 'Bottom Right');
  assert.equal(display.panelPos, 'Bottom Right');
  assert.equal(display.panelBg, 'rgba(54, 58, 69, 0.2)');
  assert.equal(display.panelBgColor, display.panelBg);
  assert.equal(display.majorTagColor, PINE_COLORS.orange);
  assert.equal(display.rsiOverbought, 70);
  assert.equal(display.rsiOversold, 30);
  assert.equal(display.htfSwingLen, 5);
  assert.equal(display.htfBiasTf, '1D');
  assert.equal(display.kumoBullColor, 'rgba(76, 175, 80, 0.15)');
  for (const raw of ['stopOnCloseOnlyIn', 'runnerModeIn', 'trailTierInput', 'minRiskTicksIn', 'testStart']) assert.ok(!(raw in display), raw);
});

test('every colour default is a concrete colour value', () => {
  for (const i of INPUTS.filter((x) => x.type === 'color')) assert.match(i.def, /^(#[0-9A-F]{6}|rgba\(.+\))$/, i.id);
});

test('loadValues repairs storage', () => {
  const s = fakeStorage({ 'thndrx-ict:inputs:v1': JSON.stringify({ minScore: 'x', bogus: 1, rsiLength: 21, presetInput: 'Nope', showFVG: false }) });
  const v = loadValues(s);
  assert.equal(v.minScore, 5);
  assert.ok(!('bogus' in v));
  assert.equal(v.rsiLength, 21);
  assert.equal(v.presetInput, 'Custom');
  assert.equal(v.showFVG, false);
  assert.deepEqual(Object.keys(v), INPUTS.map((i) => i.id));
});

test('loadValues survives missing or corrupt storage', () => {
  assert.deepEqual(loadValues(fakeStorage()), defaultValues());
  assert.deepEqual(loadValues(fakeStorage({ 'thndrx-ict:inputs:v1': '{not json' })), defaultValues());
  assert.deepEqual(loadValues(fakeStorage({ 'thndrx-ict:inputs:v1': '[1]' })), defaultValues());
});

test('saveValues round-trips through loadValues', () => {
  const s = fakeStorage();
  const v = { ...defaultValues(), majorLookback: 30, presetInput: 'EGX Daily', majorTagColor: '#112233' };
  saveValues(s, v);
  assert.deepEqual(loadValues(s), v);
});

test('format', () => {
  assert.equal(fmtPrice(12.3, 0.01), '12.30');
  assert.equal(fmtPrice(12.3, 1), '12');
  assert.equal(fmtPrice(12.3, 0.25), '12.30');
  assert.equal(fmtPrice(1.23456, 0.00001), '1.23456');
  assert.equal(fmtNum(54.1, '#.##'), '54.1');
  assert.equal(fmtNum(54, '#.##'), '54');
  assert.equal(fmtNum(54.126, '#.##'), '54.13');
  assert.equal(fmtNum(-0.04, '0.0'), '-0.0');
  assert.equal(fmtNum(2.5, '0.00'), '2.50');
  assert.equal(fmtNum(7.4, '0'), '7');
  assert.equal(colorNew('#FF9800', 80), 'rgba(255, 152, 0, 0.2)');
  assert.equal(colorNew('#fff', 0), 'rgba(255, 255, 255, 1)');
  assert.equal(colorNew(PINE_COLORS.red, 85), 'rgba(242, 54, 69, 0.15)');
});
