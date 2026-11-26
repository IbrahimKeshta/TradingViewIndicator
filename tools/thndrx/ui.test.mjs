// node --test tools/thndrx/ui.test.mjs
// The DOM side runs inside ThndrX's chart iframe; these tests cover the pure conversions it relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, formatColor, parseOpacity, cairoDate, cairoMidnight, parseField, panelPlacement } from './ui.mjs';
import { renderPanel, mountButton, openSettings } from './ict-ui.mjs';
import { INPUTS, defaultValues } from './inputs.mjs';
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

// ---- direction: ThndrX is right-to-left, our injected roots must not inherit it ----

// Just enough DOM for the three injected roots; no layout.
class FakeEl {
  constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.parentNode = null; this.id = ''; this.dir = ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) if (typeof c !== 'string') this.appendChild(c); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  addEventListener() {}
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300 }; }
  scrollIntoView() {}
}
function fakeDoc() {
  const body = new FakeEl('body');
  const find = (el, id) => (el.id === id ? el : el.children.map((c) => find(c, id)).find(Boolean) || null);
  return { body, createElement: (t) => new FakeEl(t), getElementById: (id) => find(body, id), querySelector: () => null };
}

test('the panel, the settings button and the settings dialog are forced left-to-right', () => {
  const doc = fakeDoc();
  const panel = { position: 'top_right', bg: '#000000', rows: [{ cells: [{ text: 'Net R', color: '#fff' }, { text: '+0.67R', color: '#fff' }] }] };
  renderPanel(doc, panel);
  mountButton(doc, () => {});
  openSettings(doc, defaultValues(), () => {});
  for (const id of ['thndrx-ict-panel', 'thndrx-ict-button', 'thndrx-ict-settings']) {
    const el = doc.getElementById(id);
    assert.ok(el, id);
    assert.equal(el.dir, 'ltr', `${id} dir`);
    assert.equal(el.style.direction, 'ltr', `${id} direction`);
    assert.equal(el.style.unicodeBidi, 'isolate', `${id} unicode-bidi`);
  }
  renderPanel(doc, panel); // a re-render keeps the same root
  assert.equal(doc.getElementById('thndrx-ict-panel').dir, 'ltr');
});

test('parseOpacity: an empty or unreadable opacity field is opaque, never invisible (M2)', () => {
  assert.equal(parseOpacity(''), 1);
  assert.equal(parseOpacity('   '), 1);
  assert.equal(parseOpacity('abc'), 1);
  assert.equal(parseOpacity('50'), 0.5);
  assert.equal(parseOpacity(' 20 '), 0.2);
  assert.equal(parseOpacity('0'), 0);
  assert.equal(parseOpacity('150'), 1);
  assert.equal(parseOpacity('-5'), 0);
  assert.equal(formatColor('#ff9800', parseOpacity('')), '#FF9800');
});

// ---- two overlays on one chart (ICT slot 0, Session Order Flow slot 1) ----

test('two overlays: the buttons sit side by side and panels in one corner stack instead of overlapping', async () => {
  const { createUi, buttonPlacement } = await import('./ui.mjs');
  const { ictUi } = await import('./ict-ui.mjs');
  const body = new FakeEl('body');
  const all = (el) => [el, ...el.children.flatMap(all)];
  const doc = {
    body, createElement: (t) => new FakeEl(t), getElementById: (id) => all(body).find((e) => e.id === id) || null,
    querySelector: () => null, querySelectorAll: (sel) => all(body).filter((e) => sel === '.' + e.className),
  };
  const sofUi = createUi({ prefix: 'thndrx-sof', buttonText: 'SOF', buttonTitle: 't', title: 't', inputs: [], defaults: () => ({}), isValid: () => true, slot: 1 });
  const panel = { position: 'top_right', bg: '#000000', rows: [{ cells: [{ text: 'x', color: '#fff' }] }] };
  ictUi.renderPanel(doc, panel);
  const ictEl = doc.getElementById('thndrx-ict-panel');
  ictEl.offsetHeight = 120;
  sofUi.renderPanel(doc, panel);
  const sofEl = doc.getElementById('thndrx-sof-panel');
  assert.equal(ictEl.style.top, '4px');
  assert.equal(sofEl.style.top, `${4 + 120 + 4}px`);
  sofUi.renderPanel(doc, { ...panel, position: 'bottom_left' });
  assert.equal(sofEl.style.bottom, '32px', 'alone in its corner: no offset');
  const area = { left: 0, top: 0, right: 400, bottom: 300 };
  assert.ok(buttonPlacement(area, null, 1).left > buttonPlacement(area, null, 0).left);
  assert.notEqual(sofUi.ids.button, ictUi.ids.button);
});

test('history loads are serialised through a lock on the chart frame', async () => {
  const { withHistoryLock } = await import('./chart-port.mjs');
  const frame = {}, order = [];
  const job = (name, ms, fail = false) => () => new Promise((resolve, reject) => setTimeout(() => { order.push(name); fail ? reject(new Error(name)) : resolve(name); }, ms));
  const a = withHistoryLock(frame, job('a', 30, true));
  const b = withHistoryLock(frame, job('b', 1));
  const c = withHistoryLock(frame, job('c', 1));
  await assert.rejects(a, /a/);
  assert.equal(await b, 'b');
  assert.equal(await c, 'c');
  assert.deepEqual(order, ['a', 'b', 'c'], 'b waits for a even though a fails');
});
