// node --test tools/thndrx/sof-inputs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SOF_INPUTS, sofDefaults, sofIsValid, loadSofValues, saveSofValues, sofEngineCfg, SOF_STORAGE_KEY } from './sof-inputs.mjs';
import { SOF_DEFAULTS } from '../backtest/sof-engine.mjs';

const PINE = fs.readFileSync(new URL('../../src/session-orderflow.pine', import.meta.url), 'utf8');
const pineInputs = [...PINE.matchAll(/^(\w+)\s*=\s*input\.(\w+)\(("[^"]*"|[^,]+),\s*"([^"]*)"/gm)].map((m) => ({ id: m[1], type: m[2], def: m[3], label: m[4] }));

test('every Pine input is here, in order, with its type, label and default', () => {
  assert.equal(pineInputs.length, 60);
  assert.deepEqual(SOF_INPUTS.map((i) => i.id), pineInputs.map((p) => p.id));
  for (const p of pineInputs) {
    const i = SOF_INPUTS.find((x) => x.id === p.id);
    assert.equal(i.type, p.type, p.id);
    if (p.label) assert.equal(i.label, p.label, p.id); else assert.ok(i.label.endsWith('Hours'), p.id);
    const def = p.def.startsWith('"') ? JSON.parse(p.def) : p.def === 'true' ? true : p.def === 'false' ? false : /^#/.test(p.def) ? p.def.toUpperCase() : Number(p.def);
    assert.deepEqual(i.def, def, p.id);
  }
});

test('Pine defaults: trade module off, liquidity run, dashboard top right', () => {
  const d = sofDefaults();
  assert.equal(d.showTrades, false);
  assert.equal(d.entryModel, 'Liquidity run (trend)');
  assert.equal(d.dashPosition, 'Top right');
  assert.equal(d.htfInput, '60');
  assert.ok(SOF_INPUTS.find((i) => i.id === 'logTrades').unavailable);
});

test('every engine option the inputs set is a known engine option', () => {
  const cfg = sofEngineCfg(sofDefaults());
  for (const k of Object.keys(cfg)) assert.ok(k in SOF_DEFAULTS, `unknown engine key ${k}`);
  assert.equal(cfg.sessionTz, 'America/New_York');
  assert.equal(cfg.render, true);
  assert.equal(cfg.showTrades, false);
});

test('stored values: invalid, unknown and out-of-range ones fall back to defaults', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set(SOF_STORAGE_KEY, JSON.stringify({ pivotLen: 999, vpRows: 60, colBsl: 'red', asiaSession: '2500-0000', sessionTimezone: 'Mars/Base', htfInput: '240', bogus: 1, entryModel: 'Sweep reversal' }));
  const v = loadSofValues(storage);
  assert.equal(v.pivotLen, 10);
  assert.equal(v.vpRows, 60);
  assert.equal(v.colBsl, '#9C27B0');
  assert.equal(v.asiaSession, '1800-0000');
  assert.equal(v.sessionTimezone, 'America/New_York');
  assert.equal(v.htfInput, '240');
  assert.equal(v.entryModel, 'Sweep reversal');
  assert.equal('bogus' in v, false);
  saveSofValues(storage, { ...v, pivotLen: 1.5 });
  assert.equal(JSON.parse(store.get(SOF_STORAGE_KEY)).pivotLen, 10);
  assert.equal(loadSofValues({ getItem: () => '{not json' }).pivotLen, 10);
  assert.equal(sofIsValid(SOF_INPUTS.find((i) => i.id === 'colPoc'), 'rgba(255, 235, 59, 0.5)'), true);
});
