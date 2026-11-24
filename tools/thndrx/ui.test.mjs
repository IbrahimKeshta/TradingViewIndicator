// node --test tools/thndrx/ui.test.mjs
// The DOM side runs inside ThndrX's chart iframe; these tests cover the pure conversions it relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, formatColor, cairoDate, cairoMidnight, parseField, panelPlacement } from './ui.mjs';
import { INPUTS } from './inputs.mjs';
import { withTransp } from './render-plan.mjs';

const input = (id) => INPUTS.find((i) => i.id === id);

test('parseColor reads both stored colour forms', () => {
  assert.deepEqual(parseColor('#FF9800'), { hex: '#ff9800', alpha: 1 });
  assert.deepEqual(parseColor('rgba(54, 58, 69, 0.2)'), { hex: '#363a45', alpha: 0.2 });
  assert.deepEqual(parseColor('rgba(0,0,0,1)'), { hex: '#000000', alpha: 1 });
  assert.deepEqual(parseColor('nonsense'), { hex: '#000000', alpha: 1 });
});

test('formatColor writes only #RRGGBB or rgba(r, g, b, a), which render-plan accepts', () => {
  assert.equal(formatColor('#ff9800', 1), '#FF9800');
  assert.equal(formatColor('#363a45', 0.2), 'rgba(54, 58, 69, 0.2)');
  assert.equal(formatColor('#363a45', 0), 'rgba(54, 58, 69, 0)');
  assert.equal(formatColor('#363a45', 0.123456), 'rgba(54, 58, 69, 0.12)');
  assert.equal(formatColor('#363a45', 7), '#363A45'); // clamped
  for (const c of ['#FF9800', 'rgba(54, 58, 69, 0.2)', 'rgba(54, 58, 69, 0)']) {
    const back = parseColor(c);
    assert.equal(formatColor(back.hex, back.alpha), c);
    assert.doesNotThrow(() => withTransp(c, 50));
  }
});

test('the time input edits a Cairo calendar date', () => {
  const def = input('testStart').def; // 2024-01-01 00:00 Cairo
  assert.equal(cairoDate(def), '2024-01-01');
  assert.equal(cairoMidnight('2024-01-01'), def);
  assert.equal(cairoMidnight('2024-07-01'), Date.parse('2024-07-01T00:00:00+03:00')); // Egypt's summer time
  assert.equal(cairoDate(cairoMidnight('2025-10-31')), '2025-10-31');
  assert.ok(Number.isNaN(cairoMidnight('')));
});

test('parseField turns raw form values into typed input values', () => {
  assert.equal(parseField(input('rsiLength'), '21'), 21);
  assert.ok(Number.isNaN(parseField(input('rsiLength'), '')));
  assert.equal(parseField(input('showFVG'), false), false);
  assert.equal(parseField(input('maTypeInput'), 'SMA'), 'SMA');
  assert.equal(parseField(input('londonSession'), ' 0300-0600 '), '0300-0600');
  assert.equal(parseField(input('testStart'), '2024-01-01'), input('testStart').def);
  const float = INPUTS.find((i) => i.type === 'float');
  assert.equal(parseField(float, '1.25'), 1.25);
});

test('panelPlacement keeps the panel inside the price pane, clear of the axes and the settings button', () => {
  const area = { left: 56, top: 42, right: 479, bottom: 394 };  // .layout__area--center on the live chart
  const pane = { left: 56, top: 42, right: 423, bottom: 327 };  // the price pane inside it
  assert.deepEqual(panelPlacement('top_right', area, pane), { top: 4, right: 60 });
  assert.deepEqual(panelPlacement('bottom_right', area, pane), { bottom: 71, right: 60 });
  assert.deepEqual(panelPlacement('bottom_left', area, pane), { bottom: 71, left: 4 });
  assert.deepEqual(panelPlacement('top_left', area, pane), { top: 28, left: 4 });
  assert.deepEqual(panelPlacement('bottom_right', area, null), { bottom: 32, right: 60 });
});
