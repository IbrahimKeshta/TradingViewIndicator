// Render plan for the Session Order Flow overlay: runs the engine (tools/backtest/sof-engine.mjs, render mode) on the
// chart's bars and the intrabars, then maps every live Pine drawing (the engine's registry, already capped like Pine)
// to a painter item. Colours, transparencies, texts and styles follow src/session-orderflow.pine; line numbers point
// at it. No DOM here.
import { runSof, buildChart } from '../backtest/sof-engine.mjs';
import { sofEngineCfg } from './sof-inputs.mjs';
import { PINE_COLORS, withTransp } from './colors.mjs';
import { fmtNum, fmtPrice } from './format.mjs';
import { sofPanel, poolText, htfLabel } from './sof-panel.mjs';
import { priceRange } from './chart-port.mjs';

const C = PINE_COLORS;
const CLEAR = 'rgba(0, 0, 0, 0)';
const RESOLUTION_SECS = { D: 86400, '1D': 86400, W: 604800, '1W': 604800, M: 2592000, '1M': 2592000 };
const tfSecsOf = (res) => RESOLUTION_SECS[String(res).toUpperCase()] ?? Number(res) * 60;

// Symbol facts the engine needs, from the datafeed's symbol info (session '1;1000-1430:12345': opens 10:00, trades
// Sunday = day 1 to Thursday) or EGX defaults when the datafeed is unavailable.
export function symbolMeta(si) {
  const m = si && /(\d{2})(\d{2})-\d{4}:(\d+)/.exec(String(si.session || ''));
  return {
    symType: (si && si.type) || 'stock',
    exTz: (si && si.timezone) || 'Africa/Cairo',
    sessionStartMin: m ? +m[1] * 60 + +m[2] : 600,
    weekStart: m ? (m[3].includes('1') ? 0 : 1) : 0,
  };
}

// Pine label colours for one drawing kind; `bar` gives the bar a yloc.abovebar / belowbar label sits on.
function toItems(drawings, bars, values, info, mintick) {
  const v = values, px = (x) => fmtPrice(x, mintick);
  const label = htfLabel(info.htfSecs, info.htfTf);
  const compact = v.labelStyle === 'Compact' || (v.labelStyle === 'Auto' && !info.is24hMode);
  const plan = { boxes: [], lines: [], labels: [] };

  for (const o of drawings.box) {
    const key = `b${o.seq}`;
    if (o.kind === 'sess') { // Pine 148-165: dashed border, text top-left
      const c = o.dir > 0 ? v.colBull : o.dir < 0 ? v.colBear : v.colAccum;
      const status = compact ? (o.dir > 0 ? ' ▲' : o.dir < 0 ? ' ▼' : '') : (o.dir > 0 ? ' BULL BREAKOUT' : o.dir < 0 ? ' BEAR BREAKOUT' : ' ACCUMULATION');
      plan.boxes.push({ key, order: o.seq, t1: o.t1, t2: o.t2, top: o.top, bottom: o.bottom, border: c, bg: withTransp(c, v.boxFillTransp), dashed: true, text: o.name + status, textColor: c, textSize: 'small', hAlign: 'left', vAlign: 'top' });
    } else { // pools, Pine 349-356 and 455-461
      const c = o.isHigh ? v.colBsl : v.colSsl;
      const text = poolText(o.isHigh, o.htf, label);
      plan.boxes.push(o.taken
        ? { key, order: o.seq, t1: o.t1, t2: o.t2, top: o.top, bottom: o.bottom, border: withTransp(c, 100), bg: withTransp(C.gray, 82), text: text + ' ' + o.outcome, textColor: withTransp(C.gray, 30), textSize: 'tiny', hAlign: 'right', vAlign: 'middle' }
        : { key, order: o.seq, t1: o.t1, t2: o.t2, top: o.top, bottom: o.bottom, border: withTransp(c, 100), bg: withTransp(c, o.htf ? 35 : 60), text, textColor: withTransp(C.white, 15), textSize: 'tiny', hAlign: 'right', vAlign: 'middle' });
    }
  }

  const LINE = {
    ref: () => ({ color: v.colRef, style: 'dotted', width: 1 }),                                          // 301-302
    prev: (o) => (o.which === 'poc' ? { color: withTransp(v.colPoc, 45), style: 'solid', width: 1 } : { color: withTransp(v.colPoc, 55), style: 'dotted', width: 1 }), // 632-634
    dev: (o) => (o.which === 'poc' ? { color: v.colPoc, style: 'solid', width: 2 } : { color: withTransp(v.colPoc, 20), style: 'dashed', width: 1 }),                  // 648-650
    trade: (o) => ({ entry: { color: C.gray, style: 'dotted', width: 1 }, stop: { color: v.colBear, style: 'solid', width: 2 }, tp1: { color: v.colBull, style: 'solid', width: 1 }, tp2: { color: v.colBull, style: 'solid', width: 2 } })[o.part], // 891-894
    run: (o) => (o.part === 'entry' ? { color: C.gray, style: 'dotted', width: 1 } : { color: v.colBear, style: 'solid', width: 2 }),                                      // 978-979
  };
  for (const o of drawings.line) {
    if (o.t1 === undefined || Number.isNaN(o.y)) continue;
    plan.lines.push({ key: `l${o.seq}`, order: o.seq, t1: o.t1, p1: o.y, t2: o.t2, p2: o.y, extendRight: false, ...LINE[o.kind](o) });
  }

  for (const o of drawings.label) {
    const key = `t${o.seq}`;
    if (o.kind === 'tag') { // vpTag, Pine 660-661: label_left, no background, tiny
      let text = o.which, color = o.prior ? withTransp(v.colPoc, 35) : v.colPoc;
      if (o.trade) {
        color = o.which === 'SL' ? v.colBear : v.colBull;
        text = o.which === 'SL' ? (o.be ? 'SL (entry) ' : 'SL ') + px(o.y) : o.which === 'TP1' && o.hit ? 'TP1 ✓' : o.which + ' ' + px(o.y); // 828, 852, 895-897
      }
      plan.labels.push({ key, order: o.seq, time: o.t, price: o.y, text, style: 'left', color: CLEAR, textColor: color, size: 'tiny' });
    } else if (o.kind === 'entry') { // BUY below the bar, SELL above it (898, 980)
      const b = bars[o.bar];
      plan.labels.push({ key, order: o.seq, time: o.t, price: o.dir > 0 ? b.low : b.high, text: o.dir > 0 ? 'BUY' : 'SELL', style: o.dir > 0 ? 'up' : 'down', color: o.dir > 0 ? v.colBull : v.colBear, textColor: C.white, size: 'small' });
    } else { // closed-trade result above the bar, no background (860, 954)
      const r = o.r, text = (r > 0 ? '+' : '') + fmtNum(r, o.model === 'run' ? '0.00' : '#.##') + 'R';
      plan.labels.push({ key, order: o.seq, time: o.t, price: bars[o.bar].high, text, style: 'none', color: CLEAR, textColor: r > 0 ? v.colBull : r < 0 ? v.colBear : C.gray, size: 'small' });
    }
  }
  return plan;
}

// ctx: chartInfo (symbol, mintick, resolution) + lastBarOpen, historyNote, volumeMissing, extra (from sof-main's
// prepare: { meta, ltfRows, note }).
export function buildSofPlan(bars, values, ctx) {
  const extra = ctx.extra || {};
  const meta = extra.meta || symbolMeta(null);
  const warnings = [];
  if (ctx.historyNote) warnings.push(ctx.historyNote);
  if (extra.note) warnings.push(extra.note);
  if (ctx.volumeMissing) warnings.push('No volume on this chart: add the Volume study');
  const plan = {
    meta: { symbol: ctx.symbol, resolution: ctx.resolution, bars: bars.length, firstTime: bars.length ? bars[0].time : null, lastTime: bars.length ? bars[bars.length - 1].time : null, ...priceRange(bars), warnings },
    boxes: [], lines: [], labels: [], series: [], fills: [], markers: [], bands: [], panel: null,
  };
  if (!bars.length) return plan;
  const chart = buildChart({
    symbol: ctx.symbol, mintick: ctx.mintick, tfSecs: tfSecsOf(ctx.resolution), symType: meta.symType, exTz: meta.exTz,
    weekStart: meta.weekStart, sessionStartMin: meta.sessionStartMin,
    bars: bars.map((b) => [b.time, b.open, b.high, b.low, b.close, ctx.volumeMissing ? 0 : b.volume]),
    ltfBars: extra.ltfRows || null,
  });
  const res = runSof(chart, { ...sofEngineCfg(values), lastBarOpen: !!ctx.lastBarOpen });
  Object.assign(plan, toItems(res.drawings, bars, values, res.info, ctx.mintick));
  plan.panel = sofPanel(res, values, { mintick: ctx.mintick, symType: meta.symType, warnings });
  plan.res = res;
  return plan;
}
