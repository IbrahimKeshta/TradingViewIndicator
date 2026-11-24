// ThndrX overlay UI inside the chart iframe document (same origin): the info panel table, the settings button and
// the settings dialog. Plain DOM, no framework. Text always goes in through textContent, never as HTML.
// The conversions the DOM relies on are pure exports, tested in ui.test.mjs.
import { INPUTS, defaultValues, isValidValue } from './inputs.mjs';

const PANEL_ID = 'thndrx-ict-panel', BUTTON_ID = 'thndrx-ict-button', SETTINGS_ID = 'thndrx-ict-settings';
const FONT = '11px/1.3 -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
const MARGIN = 4, BUTTON_SPACE = 24;                    // the top-left panel sits below the settings button
const DEFAULT_INSET = { top: 0, left: 0, right: 56, bottom: 28 }; // price axis and time axis, measured on the live chart
const TIMEFRAMES = ['1', '5', '10', '15', '30', '60', '240', '1D', '1W', '1M']; // what the ThndrX chart offers

// ---- pure parts ----

const cairoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const cairoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// '#RRGGBB' or 'rgba(r, g, b, a)' -> { hex: '#rrggbb' (what <input type=color> holds), alpha 0..1 }.
export function parseColor(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return { hex: c.toLowerCase(), alpha: 1 };
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(c);
  if (!m) return { hex: '#000000', alpha: 1 };
  return { hex: '#' + [1, 2, 3].map((k) => Math.min(255, +m[k]).toString(16).padStart(2, '0')).join(''), alpha: Math.min(1, +m[4]) };
}

// The two stored forms only (inputs.mjs validates exactly these): opaque '#RRGGBB', else 'rgba(r, g, b, a)'.
export function formatColor(hex, alpha) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;
  if (a >= 1) return hex.toUpperCase();
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// The Test Start input is a Pine input.time (ms); the dialog edits its Cairo calendar date.
export const cairoDate = (ms) => cairoDay.format(new Date(ms));

export function cairoMidnight(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const wanted = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000; // minutes, as if Cairo were UTC
  let t = (wanted - 120) * 60000;                           // Cairo is UTC+2 or +3: two corrections settle it
  for (let k = 0; k < 2; k++) {
    const p = {};
    for (const { type, value } of cairoClock.formatToParts(new Date(t))) p[type] = +value;
    t += (wanted - (Date.UTC(p.year, p.month - 1, p.day) / 60000 + p.hour * 60 + p.minute)) * 60000;
  }
  return t;
}

// Raw form value (checkbox state or field text) -> the input's value type. Colours are read by formatColor.
export function parseField(input, raw) {
  switch (input.type) {
    case 'bool': return Boolean(raw);
    case 'int': case 'float': return String(raw).trim() === '' ? NaN : Number(raw);
    case 'time': return cairoMidnight(String(raw).trim());
    default: return String(raw).trim();
  }
}

// Offsets of the panel inside the chart area for a Pine position: inside the price pane, clear of the price and time
// axes, and below the settings button when top-left. `area` / `pane` are client rects; no pane -> measured defaults.
const paneInset = (area, pane) => (pane
  ? { top: pane.top - area.top, left: pane.left - area.left, right: area.right - pane.right, bottom: area.bottom - pane.bottom }
  : DEFAULT_INSET);

export function panelPlacement(position, area, pane) {
  const inset = paneInset(area, pane);
  const [v, h] = position.split('_');
  return {
    [v]: inset[v] + MARGIN + (position === 'top_left' ? BUTTON_SPACE : 0),
    [h]: inset[h] + MARGIN,
  };
}

// The settings button: top-left corner of the price pane.
function buttonPlacement(area, pane) {
  const inset = paneInset(area, pane);
  return { top: inset.top + MARGIN, left: inset.left + MARGIN };
}

// ---- DOM ----

// The chart area (TradingView's center layout area, absolutely positioned) hosts the panel and the button.
const chartArea = (doc) => doc.querySelector('.layout__area--center') || doc.body;
const pricePane = (doc) => doc.querySelector('.chart-markup-table.pane');

// placement: (areaRect, paneRect|null) -> { top|bottom, left|right } in px.
function place(doc, el, placement) {
  const area = chartArea(doc);
  if (el.parentNode !== area) area.appendChild(el);
  const pane = pricePane(doc);
  const at = placement(area.getBoundingClientRect(), pane ? pane.getBoundingClientRect() : null);
  for (const side of ['top', 'right', 'bottom', 'left']) el.style[side] = side in at ? at[side] + 'px' : '';
}

function css(el, styles) { Object.assign(el.style, styles); return el; }

// Keeps the panel and the button in their corners after the chart is resized (called on the watch poll).
export function placeUi(doc) {
  const panel = doc.getElementById(PANEL_ID), button = doc.getElementById(BUTTON_ID);
  if (panel) place(doc, panel, (a, p) => panelPlacement(panel.dataset.position, a, p));
  if (button) place(doc, button, buttonPlacement);
}

// One absolutely positioned table in the chart area; clicking its header row collapses it to that row.
export function renderPanel(doc, panel) {
  let el = doc.getElementById(PANEL_ID);
  if (!panel) { if (el) el.remove(); return; }
  if (!el) {
    el = css(doc.createElement('div'), {
      position: 'absolute', zIndex: '1000', font: FONT, borderRadius: '2px', overflow: 'auto', maxHeight: 'calc(100% - 8px)', pointerEvents: 'auto',
    });
    el.id = PANEL_ID;
    el.dataset.collapsed = '0';
  }
  el.dataset.position = panel.position;
  el.style.background = panel.bg;
  const table = css(doc.createElement('table'), { borderCollapse: 'collapse' });
  const collapsed = el.dataset.collapsed === '1';
  panel.rows.forEach((row, k) => {
    const tr = doc.createElement('tr');
    if (k === 0) {
      tr.style.cursor = 'pointer';
      tr.title = collapsed ? 'Show the panel' : 'Collapse the panel';
      tr.addEventListener('click', () => {
        el.dataset.collapsed = el.dataset.collapsed === '1' ? '0' : '1';
        renderPanel(doc, panel);
      });
    } else if (collapsed) {
      tr.style.display = 'none';
    }
    for (const cell of row.cells) {
      const td = css(doc.createElement('td'), { color: cell.color, padding: '1px 4px', whiteSpace: 'nowrap' });
      if (cell.bg) td.style.background = cell.bg;
      td.textContent = cell.text;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  el.replaceChildren(table);
  place(doc, el, (a, p) => panelPlacement(panel.position, a, p));
}

export function mountButton(doc, onClick) {
  const old = doc.getElementById(BUTTON_ID);
  if (old) old.remove(); // a fresh element drops the previous click handler
  const btn = css(doc.createElement('button'), {
    position: 'absolute', zIndex: '1001', font: '600 10px/1.4 sans-serif', padding: '1px 6px', border: '0', borderRadius: '3px',
    background: 'rgba(41, 98, 255, 0.85)', color: '#FFFFFF', cursor: 'pointer', pointerEvents: 'auto',
  });
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.textContent = 'ICT';
  btn.title = 'ICT + RSI/MA Confluence settings';
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  place(doc, btn, buttonPlacement);
  return btn;
}

export const hasButton = (doc) => !!doc.getElementById(BUTTON_ID);

// Removes everything this UI added to the document.
export function unmountUi(doc) {
  for (const id of [PANEL_ID, BUTTON_ID, SETTINGS_ID]) {
    const el = doc.getElementById(id);
    if (el) el.remove();
  }
}

// One form control per input; read() gives the typed value, write(v) shows a value.
function makeField(doc, input, value) {
  const inputStyle = { font: FONT, background: '#2A2E39', color: '#D1D4DC', border: '1px solid #434651', borderRadius: '2px', padding: '1px 3px' };
  const el = (tag, props = {}) => css(Object.assign(doc.createElement(tag), props), inputStyle);
  let control, read, write;
  if (input.type === 'bool') {
    control = Object.assign(doc.createElement('input'), { type: 'checkbox' });
    read = () => control.checked;
    write = (v) => { control.checked = v; };
  } else if (input.type === 'color') {
    const color = el('input', { type: 'color' }), opacity = el('input', { type: 'number', min: 0, max: 100, step: 1, title: 'Opacity %' });
    css(color, { width: '36px', height: '18px', padding: '0' });
    css(opacity, { width: '46px' });
    control = doc.createElement('span');
    control.append(color, ' ', opacity, '%');
    read = () => formatColor(color.value, Number(opacity.value) / 100);
    write = (v) => { const c = parseColor(v); color.value = c.hex; opacity.value = String(Math.round(c.alpha * 100)); };
    control.setDisabled = (d) => { color.disabled = d; opacity.disabled = d; };
  } else if (input.options || input.type === 'timeframe') {
    const options = input.options || (TIMEFRAMES.includes(value) ? TIMEFRAMES : [value, ...TIMEFRAMES]);
    control = el('select');
    for (const o of options) control.appendChild(Object.assign(doc.createElement('option'), { value: o, textContent: o }));
    read = () => parseField(input, control.value);
    write = (v) => { control.value = v; };
  } else if (input.type === 'time') {
    control = el('input', { type: 'date' });
    read = () => parseField(input, control.value);
    write = (v) => { control.value = cairoDate(v); };
  } else if (input.type === 'int' || input.type === 'float') {
    control = el('input', { type: 'number', step: input.type === 'int' ? '1' : 'any' });
    if (input.min !== undefined) control.min = String(input.min);
    if (input.max !== undefined) control.max = String(input.max);
    css(control, { width: '80px' });
    read = () => parseField(input, control.value);
    write = (v) => { control.value = String(v); };
  } else {
    control = el('input', { type: 'text', placeholder: input.type === 'session' ? 'HHMM-HHMM' : '' });
    css(control, { width: '130px' });
    read = () => parseField(input, control.value);
    write = (v) => { control.value = v; };
  }
  write(value);
  return { control, read, write };
}

// Groups and fields from INPUTS, tooltips as title, unavailable inputs disabled with their note.
// Save validates every field (inputs.mjs isValidValue), then calls onSave(values); Reset only refills the form.
export function openSettings(doc, values, onSave) {
  const old = doc.getElementById(SETTINGS_ID);
  if (old) old.remove();
  const overlay = css(doc.createElement('div'), {
    position: 'fixed', inset: '0', zIndex: '1002', background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  overlay.id = SETTINGS_ID;
  // Typing in the form must not reach TradingView's chart hotkeys.
  for (const type of ['keydown', 'keyup', 'keypress', 'wheel']) overlay.addEventListener(type, (e) => e.stopPropagation());

  const dialog = css(doc.createElement('div'), {
    background: '#1E222D', color: '#D1D4DC', font: FONT, borderRadius: '4px', boxShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
    width: 'min(440px, 96%)', maxHeight: '94%', display: 'flex', flexDirection: 'column',
  });
  const title = css(doc.createElement('div'), { padding: '6px 8px', fontWeight: '600', borderBottom: '1px solid #434651' });
  title.textContent = 'ICT + RSI/MA Confluence · Settings';
  const body = css(doc.createElement('div'), { overflow: 'auto', padding: '4px 8px', flex: '1 1 auto' });

  const fields = new Map(), groups = new Map();
  for (const input of INPUTS) {
    let group = groups.get(input.group);
    if (!group) {
      group = css(doc.createElement('details'), { margin: '2px 0' });
      const summary = css(doc.createElement('summary'), { cursor: 'pointer', fontWeight: '600', padding: '2px 0' });
      summary.textContent = input.group;
      group.appendChild(summary);
      body.appendChild(group);
      groups.set(input.group, group);
    }
    const row = css(doc.createElement('div'), { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '2px 0 2px 12px' });
    const label = doc.createElement('label');
    label.textContent = input.label;
    if (input.tooltip) { row.title = input.tooltip; label.style.borderBottom = '1px dotted #787B86'; }
    const field = makeField(doc, input, values[input.id]);
    row.append(label, field.control);
    group.appendChild(row);
    if (input.unavailable) {
      if (field.control.setDisabled) field.control.setDisabled(true); else field.control.disabled = true;
      label.style.opacity = '0.5';
      const note = css(doc.createElement('div'), { color: '#FF9800', padding: '0 0 2px 12px', fontSize: '10px' });
      note.textContent = input.unavailable;
      group.appendChild(note);
    }
    fields.set(input.id, { input, row, group, ...field });
  }

  const footer = css(doc.createElement('div'), { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderTop: '1px solid #434651' });
  const message = css(doc.createElement('span'), { color: '#F23645', flex: '1 1 auto' });
  const button = (text, primary) => {
    const b = css(doc.createElement('button'), {
      font: FONT, padding: '2px 10px', borderRadius: '3px', cursor: 'pointer', border: '1px solid #434651',
      background: primary ? '#2962FF' : '#2A2E39', color: '#FFFFFF',
    });
    b.type = 'button';
    b.textContent = text;
    return b;
  };
  const reset = button('Reset to defaults'), cancel = button('Cancel'), save = button('Save', true);
  footer.append(message, reset, cancel, save);

  const close = () => overlay.remove();
  const clearMarks = () => { message.textContent = ''; for (const f of fields.values()) f.row.style.outline = ''; };
  reset.addEventListener('click', () => {
    const defs = defaultValues();
    for (const [id, f] of fields) f.write(defs[id]);
    clearMarks();
  });
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  save.addEventListener('click', () => {
    clearMarks();
    const next = {}, bad = [];
    for (const [id, f] of fields) {
      next[id] = f.input.unavailable ? values[id] : f.read();
      if (!isValidValue(f.input, next[id])) bad.push(f);
    }
    if (bad.length) {
      for (const f of bad) { f.row.style.outline = '1px solid #F23645'; f.group.open = true; }
      message.textContent = `Check ${bad.length === 1 ? 'the highlighted field' : `the ${bad.length} highlighted fields`}`;
      bad[0].row.scrollIntoView({ block: 'nearest' });
      return;
    }
    close();
    onSave(next);
  });

  dialog.append(title, body, footer);
  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);
  return overlay;
}
