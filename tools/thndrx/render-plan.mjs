// Render plan for the ThndrX overlay: runs the engine and turns its state into plain drawing items (boxes, lines,
// labels, series, fills, markers, bands) that a painter can put on the chart. No DOM, no ThndrX API: pure data.
// The Pine indicator (src/ict-rsi-ma-indicator.pine) is the source of truth for every colour, transparency, text,
// label style and anchoring rule; the line numbers below point at it.
//
// How later tasks extend this file: every item is created through `rb.add(kind, item, bar, phase)`, where `bar` is the
// chart bar Pine creates the object on and `phase` is the Pine source line that creates it. `finalize` sorts the items
// by (bar, phase, insertion) and hands out `order`, so the numbering is Pine's object-creation order. applyPineCaps
// then keeps the newest 500 boxes / lines / labels, as Pine deletes the oldest.
import { runEngine } from '../backtest/ict-engine.mjs';
import { htfBiasSeries } from './htf.mjs';
import { resolveConfig } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { fmtNum } from './format.mjs';

export const HIST_LIMIT = 5000;           // Pine line 1765
export const ANCHOR_LIMIT = HIST_LIMIT - 1;
export const PINE_CAP = 500;              // max_boxes_count / max_lines_count / max_labels_count (Pine line 7)

// Pine anchorBar(b) = max(b, bar_index - ANCHOR_LIMIT); `atBar` is the bar_index the Pine call runs on.
export const anchorBar = (b, atBar) => Math.max(b, atBar - ANCHOR_LIMIT);
export const anchorInRange = (b, atBar) => atBar - b <= ANCHOR_LIMIT;

// Pine source lines that create objects; ties on the same bar are broken by these (execution order within a bar).
export const PHASE = Object.freeze({
  RSI_LABEL: 213,
  FVG: 488,
  OB: 613,
  BREAK_MAJOR: 1798,
  BREAK_INTERNAL: 1799,
  TAGS: 1809,
  RAYS: 1812,
});

// Pine color.new(c, transp) for any colour string a user can hold: '#RGB', '#RRGGBB', '#RRGGBBAA' or 'rgb(a)(...)'.
// color.new replaces the transparency, it does not compose with an existing one.
export function withTransp(c, transp) {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return colorNew(c, transp);
  const hex8 = /^#([0-9a-f]{6})[0-9a-f]{2}$/i.exec(c);
  if (hex8) return colorNew('#' + hex8[1], transp);
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(c);
  if (rgb) return colorNew('#' + [1, 2, 3].map((k) => Number(rgb[k]).toString(16).padStart(2, '0')).join(''), transp);
  throw new Error(`unsupported colour ${c}`);
}

const emptyPlan = () => ({ meta: null, boxes: [], lines: [], labels: [], series: [], fills: [], markers: [], bands: [], panel: null });

function createBuilder(plan, parts) {
  const pending = [];
  return {
    ...parts,
    plan,
    add(kind, item, bar, phase) { pending.push({ kind, item, bar, phase, seq: pending.length }); },
    finalize() {
      pending.sort((a, b) => a.bar - b.bar || a.phase - b.phase || a.seq - b.seq);
      pending.forEach(({ kind, item }, order) => {
        if (kind === 'boxes' || kind === 'lines' || kind === 'labels') item.order = order;
        plan[kind].push(item);
      });
    },
  };
}

// FVG/OB zones alive at the last bar (Pine 488-498, 613-625): the box runs from the left edge to the last bar because
// mitigateZones calls box.set_right(bar_index) on every bar until the zone is touched, and touched zones are deleted.
function addZones(rb) {
  const { bars, res, display } = rb;
  const lastTime = bars[bars.length - 1].time;
  const zone = (z, side, kind, color, border, fill, text, phase, tierKey) => {
    const keyBase = kind === 'fvg' ? `fvg:${side}:${z.bar}` : `ob:${side}:${tierKey}:${z.bar}`;
    rb.add('boxes', { key: keyBase, t1: bars[z.left].time, t2: lastTime, top: z.top, bottom: z.bottom, border: colorNew(color, border), bg: colorNew(color, fill) }, z.bar, phase);
    rb.add('labels', { key: `${keyBase}:label`, time: bars[z.left].time, price: z.top, text, style: 'up', color: colorNew(color, border), textColor: PINE_COLORS.white, size: 'tiny' }, z.bar, phase);
  };
  if (display.showFVG) {
    for (const z of res.final.bullFvg) zone(z, 'bull', 'fvg', PINE_COLORS.teal, 40, 85, 'FVG', PHASE.FVG);
    for (const z of res.final.bearFvg) zone(z, 'bear', 'fvg', PINE_COLORS.red, 40, 85, 'FVG', PHASE.FVG);
  }
  if (display.showOB) {
    const ob = (z, side, color) => {
      const major = z.tier === 'MAJOR';
      zone(z, side, 'ob', color, major ? 40 : 70, major ? 85 : 92, major ? 'OB' : 'ob', PHASE.OB, z.tier.toLowerCase());
    };
    for (const z of res.final.bullOb) ob(z, 'bull', PINE_COLORS.blue);
    for (const z of res.final.bearOb) ob(z, 'bear', PINE_COLORS.purple);
  }
}

// Structure rendering (Pine 1765-1817): break events persist; tags and rays are redrawn on the last bar only.
function addStructure(rb) {
  const { bars, res, display } = rb;
  const last = bars.length - 1;

  // Break events: drawBreakEvent runs on the event bar, so anchorBar clamps against that bar, not the last one.
  const tiers = [
    { tier: 'major', enabled: display.showBreakLines, width: 2, transp: 0, phase: PHASE.BREAK_MAJOR },
    { tier: 'internal', enabled: display.showInternalBreaks, width: 1, transp: 50, phase: PHASE.BREAK_INTERNAL },
  ];
  for (const e of res.events) {
    const t = tiers.find((x) => x.tier === e.tier);
    if (!t || !t.enabled) continue;
    const base = e.type === 'CHoCH' ? display.chochColor : display.bosColor;
    const color = t.transp ? withTransp(base, t.transp) : base;
    const key = `brk:${e.tier}:${e.bar}`;
    rb.add('lines', { key, t1: bars[anchorBar(e.levelBar, e.bar)].time, p1: e.level, t2: bars[e.bar].time, p2: e.level, extendRight: false, color, style: 'dotted', width: t.width }, e.bar, t.phase);
    rb.add('labels', { key: `${key}:label`, time: bars[e.bar].time, price: e.level, text: e.type, style: e.side === 'bull' ? 'up' : 'down', color, textColor: PINE_COLORS.white, size: 'tiny' }, e.bar, t.phase);
  }

  // Swing tags: skipped, never clamped, when older than the anchor range (1770-1777).
  const tags = (points, tier, isHigh) => {
    for (const p of points) {
      if (!p.kind || !anchorInRange(p.bar, last)) continue;
      rb.add('labels', {
        key: `tag:${tier}:${isHigh ? 'high' : 'low'}:${p.bar}`, time: bars[p.bar].time, price: p.price, text: p.kind,
        style: isHigh ? 'down' : 'up', color: p.liquidity ? display.liquidityTagColor : display.majorTagColor, textColor: PINE_COLORS.white, size: 'tiny',
      }, last, PHASE.TAGS);
    }
  };
  if (display.showMajorTags) { tags(res.final.majorHighs, 'major', true); tags(res.final.majorLows, 'major', false); }

  // Rays of unbroken swings: clamped, extended right (1781-1786). Internal rays are dotted and faded.
  const rays = (points, tier, isHigh, internal) => {
    const color = internal ? withTransp(display.rayColor, 60) : display.rayColor;
    for (const p of points) {
      if (p.broken) continue;
      rb.add('lines', {
        key: `ray:${tier}:${isHigh ? 'high' : 'low'}:${p.bar}`, t1: bars[anchorBar(p.bar, last)].time, p1: p.price, t2: bars[last].time, p2: p.price,
        extendRight: true, color, style: internal ? 'dotted' : 'solid', width: 1,
      }, last, PHASE.RAYS);
    }
  };
  if (display.showMajorRays) { rays(res.final.majorHighs, 'major', true, false); rays(res.final.majorLows, 'major', false, false); }
  if (display.showInternalRays) { rays(res.final.intHighs, 'internal', true, true); rays(res.final.intLows, 'internal', false, true); }
}

// Signal markers (Pine 1744-1750). A bar's first open decides the side (openedSide); with Long Trades Only the
// suppressed short setup still marks. Both markers can sit on one bar, then the keys carry the direction.
function addSignals(rb) {
  const { bars, res, display, engineCfg } = rb;
  if (!display.showSignalMarkers) return;
  const firstSide = new Map();
  for (const o of res.opens) if (!firstSide.has(o.bar)) firstSide.set(o.bar, o.side);
  for (let i = 0; i < bars.length; i++) {
    const bull = firstSide.get(i) === 'long';
    const bear = firstSide.get(i) === 'short' || (engineCfg.longOnly && res.series.shortSetup[i] === 1);
    if (bull) rb.plan.markers.push({ key: bear ? `sig:${i}:up` : `sig:${i}`, time: bars[i].time, shape: 'triangleup', location: 'belowbar', color: PINE_COLORS.lime });
    if (bear) rb.plan.markers.push({ key: bull ? `sig:${i}:down` : `sig:${i}`, time: bars[i].time, shape: 'triangledown', location: 'abovebar', color: PINE_COLORS.red });
  }
}

// RSI readout (Pine 213-219): one label on the last bar at its high.
function addRsiReadout(rb) {
  const { bars, res, display } = rb;
  if (!display.showRsiReadout) return;
  const last = bars.length - 1, rsi = res.series.rsi[last];
  const suffix = rsi >= display.rsiOverbought ? ' OB' : rsi <= display.rsiOversold ? ' OS' : '';
  rb.add('labels', {
    key: 'rsi', time: bars[last].time, price: bars[last].high, text: 'RSI ' + fmtNum(rsi, '#.##') + suffix,
    style: 'down', color: colorNew(PINE_COLORS.blue, 80), textColor: PINE_COLORS.white, size: 'small',
  }, last, PHASE.RSI_LABEL);
}

// ctx: { symbol, mintick, resolution, lastBarOpen }
export function buildRenderPlan(bars, values, ctx) {
  const { engineCfg, display } = resolveConfig(values);
  const plan = emptyPlan();
  const warnings = [];
  plan.meta = {
    symbol: ctx.symbol, resolution: ctx.resolution, bars: bars.length,
    firstTime: bars.length ? bars[0].time : null, lastTime: bars.length ? bars[bars.length - 1].time : null, warnings,
  };
  if (bars.length === 0) return plan;

  let htfBias, htfActive = false;
  if (engineCfg.requireHtfBias) {
    try {
      ({ bias: htfBias, active: htfActive } = htfBiasSeries(bars, { htfBiasTf: display.htfBiasTf, htfSwingLen: display.htfSwingLen }, ctx.resolution));
    } catch (err) {
      warnings.push(`HTF bias filter inactive: ${err.message}`);
      htfBias = undefined; htfActive = false;
    }
  }
  const res = runEngine(bars, engineCfg, { symbol: ctx.symbol, mintick: ctx.mintick, htfBias, htfActive });

  const rb = createBuilder(plan, { bars, res, display, engineCfg, ctx });
  addZones(rb);
  addStructure(rb);
  addSignals(rb);
  addRsiReadout(rb);
  rb.finalize();
  return plan;
}

// Pine keeps at most 500 live boxes / lines / labels and deletes the oldest created first.
export function applyPineCaps(plan) {
  const cap = (items) => (items.length <= PINE_CAP ? items : [...items].sort((a, b) => a.order - b.order).slice(-PINE_CAP));
  return { ...plan, boxes: cap(plan.boxes), lines: cap(plan.lines), labels: cap(plan.labels) };
}
