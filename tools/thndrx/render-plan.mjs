// Render plan for the ThndrX overlay: runs the engine and turns its state into plain drawing items (boxes, lines,
// labels, series, fills, markers, bands) that a painter can put on the chart. No DOM, no ThndrX API: pure data.
// The Pine indicator (src/ict-rsi-ma-indicator.pine) is the source of truth for every colour, transparency, text,
// label style and anchoring rule; the line numbers below point at it.
//
// How later tasks extend this file: every item is created through `rb.add(kind, item, bar, phase)`, where `bar` is the
// chart bar Pine creates the object on and `phase` is the Pine source line that creates it. `finalize` sorts the items
// by (bar, phase, insertion) and hands out `order`, so the numbering is Pine's object-creation order. applyPineCaps
// then keeps the newest 500 boxes / lines / labels, as Pine deletes the oldest.
import { runEngine, inSession } from '../backtest/ict-engine.mjs';
import { htfBiasSeries } from './htf.mjs';
import { resolveConfig } from './inputs.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';
import { fmtNum, fmtPrice } from './format.mjs';

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
  TRADE_PB: 1875,   // drawTradeLevels(activeTrade) on the last bar; one phase per slot, insertion order gives 1856-1862
  TRADE_TR: 1877,   // drawTradeLevels(trailTrade)
  RESULT_PB: 1899,
  RESULT_TR: 1907,
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

// ---- plotted series, Kumo and killzone shading (Pine 203, 637-639, 785-787, 824-825, 1031-1032) ----

const cairoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const EGX_OPEN_MIN = 10 * 60, EGX_CLOSE_MIN = 14 * 60 + 30; // EGX session 10:00-14:30 Africa/Cairo, Sunday to Thursday

function cairoParts(timeSec) {
  const p = {};
  for (const { type, value } of cairoClock.formatToParts(new Date(timeSec * 1000))) p[type] = +value;
  return { y: p.year, mo: p.month, d: p.day, minutes: p.hour * 60 + p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
const isWeekend = (dow) => dow === 5 || dow === 6; // Friday and Saturday

// Unix seconds of a Cairo wall-clock moment; two corrections settle the UTC+2/+3 daylight-saving offset.
function cairoEpoch(y, mo, d, minutes) {
  const wanted = Date.UTC(y, mo - 1, d) / 60000 + minutes;
  let t = wanted * 60 - 2 * 3600;
  for (let k = 0; k < 2; k++) {
    const c = cairoParts(t);
    t += (wanted - (Date.UTC(c.y, c.mo - 1, c.d) / 60000 + c.minutes)) * 60;
  }
  return t;
}

// The next EGX session open: today's when `timeSec` is a trading day before the open, else the next trading day's.
function nextSessionOpen(timeSec) {
  const c = cairoParts(timeSec);
  let day = Date.UTC(c.y, c.mo - 1, c.d);
  if (isWeekend(c.dow) || c.minutes >= EGX_OPEN_MIN) day += 86400000;
  while (isWeekend(new Date(day).getUTCDay())) day += 86400000;
  const d = new Date(day);
  return cairoEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), EGX_OPEN_MIN);
}

// Time of the k-th bar after the last one, for the part of the Kumo that is drawn beyond the chart (Pine plot offset).
// Intraday bars that would open outside the session roll to the next session open; daily skips Friday and Saturday.
export function futureTime(bars, k, resolution) {
  let t = bars[bars.length - 1].time;
  const r = String(resolution).toUpperCase();
  if (r === 'W' || r === '1W') return t + k * 604800;
  if (r === 'D' || r === '1D') {
    for (let s = 0; s < k; s++) { t += 86400; while (isWeekend(cairoParts(t).dow)) t += 86400; }
    return t;
  }
  if (/^\d+$/.test(r) && Number(r) > 0) {
    for (let s = 0; s < k; s++) {
      t += Number(r) * 60;
      const c = cairoParts(t);
      if (isWeekend(c.dow) || c.minutes < EGX_OPEN_MIN || c.minutes >= EGX_CLOSE_MIN) t = nextSessionOpen(t);
    }
    return t;
  }
  throw new Error(`unsupported resolution: ${resolution}`);
}

// Pine plot(): na breaks the line. Contiguous finite stretches of `valueAt` become runs of {time, price}.
function runsOf(n, valueAt, timeAt) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const v = valueAt(i);
    if (Number.isFinite(v)) (cur ??= []).push({ time: timeAt(i), price: v });
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}
function pushRuns(rb, prefix, runs, color, width) {
  runs.forEach((points, k) => rb.plan.series.push({ key: `${prefix}:${k}`, points, color, width }));
}

function addSeries(rb) {
  const { bars, res, display } = rb;
  const n = bars.length, time = (i) => bars[i].time;
  const ma = runsOf(n, (i) => res.series.ma[i], time).flat();
  if (ma.length) rb.plan.series.push({ key: 'ma', points: ma, color: colorNew(PINE_COLORS.orange, 0), width: 2 });
  if (display.showTrailStop) {
    const { trailDir, trailLong, trailShort } = res.series;
    pushRuns(rb, 'trail:long', runsOf(n, (i) => (trailDir[i] === 1 ? trailLong[i] : NaN), time), colorNew(PINE_COLORS.green, 0), 1);
    pushRuns(rb, 'trail:short', runsOf(n, (i) => (trailDir[i] === -1 ? trailShort[i] : NaN), time), colorNew(PINE_COLORS.red, 0), 1);
  }
  if (display.showAvwap) {
    pushRuns(rb, 'avwap:low', runsOf(n, (i) => res.series.avwapLow[i], time), colorNew(PINE_COLORS.aqua, 0), 2);
    pushRuns(rb, 'avwap:high', runsOf(n, (i) => res.series.avwapHigh[i], time), colorNew(PINE_COLORS.fuchsia, 0), 2);
  }
}

// Kumo: both spans are drawn ichiDisp bars to the right of the bar that computed them. The fill is cut at every
// crossing of the spans (Pine colours it by ichiSpanA > ichiSpanB), each polygon being the A edge then the B edge back.
function addKumo(rb) {
  const { bars, res, display, engineCfg, ctx } = rb;
  if (!display.showKumo) return;
  const n = bars.length, disp = engineCfg.ichiDisp;
  const shifted = [];
  try {
    for (let i = 0; i < n; i++) shifted.push(i + disp < n ? bars[i + disp].time : futureTime(bars, i + disp - (n - 1), ctx.resolution));
  } catch (err) {
    rb.plan.meta.warnings.push(`Kumo cloud not drawn: ${err.message}`);
    return;
  }
  const { spanA, spanB } = res.series;
  pushRuns(rb, 'kumoA', runsOf(n, (i) => spanA[i], (i) => shifted[i]), colorNew(PINE_COLORS.green, 60), 1);
  pushRuns(rb, 'kumoB', runsOf(n, (i) => spanB[i], (i) => shifted[i]), colorNew(PINE_COLORS.red, 60), 1);

  let cols = [], bull = false, prev = null, run = 0;
  const flush = () => {
    if (cols.length >= 2 && cols[0].time < cols[cols.length - 1].time) {
      rb.plan.fills.push({
        key: `kumo:${run++}`, color: bull ? display.kumoBullColor : display.kumoBearColor,
        points: [...cols.map((c) => ({ time: c.time, price: c.a })), ...cols.map((c) => ({ time: c.time, price: c.b })).reverse()],
      });
    }
    cols = [];
  };
  for (let i = 0; i < n; i++) {
    const a = spanA[i], b = spanB[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { flush(); prev = null; continue; }
    const col = { time: shifted[i], a, b, d: a - b, bull: a > b };
    if (prev && prev.bull !== col.bull) {
      const f = prev.d / (prev.d - col.d); // the spans meet between the two columns; the > test makes the signs differ, so f is in (0, 1]
      const price = prev.a + f * (a - prev.a);
      const cross = { time: prev.time + f * (col.time - prev.time), a: price, b: price };
      cols.push(cross);
      flush();
      cols = [cross];
      if (cross.time === col.time) { prev = col; bull = col.bull; continue; } // the crossing is this very column
    }
    bull = col.bull;
    cols.push(col);
    prev = col;
  }
  flush();
}

// Killzone background (Pine 637-639): one band per contiguous run of bars inside a session. The engine's own
// killzoneActive series merges the sessions, so each session is matched again here with the same helper. On
// daily and weekly charts the Pine time(timeframe.period, session) is never true for EGX, so nothing is shaded.
function addKillzones(rb) {
  const { bars, engineCfg, ctx } = rb;
  if (!/^\d+$/.test(String(ctx.resolution))) return;
  const barSec = Number(ctx.resolution) * 60, n = bars.length;
  const sessions = [
    { name: 'london', show: engineCfg.showLondonKZ, session: engineCfg.londonSession, color: colorNew(PINE_COLORS.blue, 90) },
    { name: 'newyork', show: engineCfg.showNewYorkKZ, session: engineCfg.newYorkSession, color: colorNew(PINE_COLORS.orange, 90) },
    { name: 'asia', show: engineCfg.showAsiaKZ, session: engineCfg.asiaSession, color: colorNew(PINE_COLORS.purple, 90) },
  ];
  for (const s of sessions) {
    if (!s.show) continue;
    const inside = (i) => inSession(bars[i].time, s.session, engineCfg.sessionTimezone);
    let run = 0;
    for (let i = 0; i < n;) {
      if (!inside(i)) { i++; continue; }
      let j = i;
      while (j + 1 < n && inside(j + 1)) j++;
      const end = bars[j].time + barSec; // the last bar's own end, never past the next bar's open
      rb.plan.bands.push({ key: `kz:${s.name}:${run++}`, t1: bars[i].time, t2: j + 1 < n ? Math.min(end, bars[j + 1].time) : end, color: s.color });
      i = j + 1;
    }
  }
}

// ---- live trades and trade history (Pine 1831-1907) ----

// Pine targetLabelText (1838-1842): price, R multiple, a liquidity note on an EQH/EQL level, a tick once reached.
// `r` is the trade's initial risk distance, `entry` its entry price.
export function targetLabelText(n, price, isLiq, isLong, entry, r, tpHit, mintick) {
  const rTxt = r > 0 ? fmtNum(Math.abs(price - entry) / r, '0.0') : '0.0';
  const liqTxt = isLiq ? (isLong ? ' · EQH' : ' · EQL') : '';
  const hitTxt = tpHit >= n ? ' ✓' : '';
  return `TP${n} ${fmtPrice(price, mintick)} · ${rTxt}R${liqTxt}${hitTxt}`;
}

// A live trade is redrawn on the last bar (1850-1877): zone box, header label and five levels with a left label each.
// A trailing-model trade has no zone, the engine stores its entry and stop as the box edges.
function addLiveTrade(rb, model, t, tag, phase) {
  const { bars, display, ctx } = rb;
  const last = bars.length - 1, lastTime = bars[last].time;
  const isLong = t.side === 'long';
  const sideCol = isLong ? display.tradeLongColor : display.tradeShortColor;
  const r = Math.abs(t.entry - t.initialStop);
  const boxBar = anchorBar(t.openBar, last), startTime = bars[boxBar].time;
  const base = `trade:${model}:${t.openBar}`;
  rb.add('boxes', { key: `${base}:box`, t1: startTime, t2: lastTime, top: t.zoneTop, bottom: t.zoneBottom, border: sideCol, bg: withTransp(sideCol, 88) }, last, phase);
  rb.add('labels', {
    key: `${base}:head`, time: startTime, price: t.zoneTop, text: (isLong ? 'LONG · ' : 'SHORT · ') + tag + t.grade + ' · ' + t.score + '/' + t.scoreOf,
    style: 'down', color: sideCol, textColor: PINE_COLORS.white, size: 'tiny',
  }, last, phase);
  const level = (part, price, color, text, dotted) => {
    rb.add('lines', { key: `${base}:${part}`, t1: startTime, p1: price, t2: lastTime, p2: price, extendRight: true, color, style: dotted ? 'dotted' : 'solid', width: 1 }, last, phase);
    rb.add('labels', { key: `${base}:${part}:label`, time: lastTime, price, text, style: 'left', color, textColor: PINE_COLORS.white, size: 'tiny' }, last, phase);
  };
  level('entry', t.entry, sideCol, 'Entry ' + fmtPrice(t.entry, ctx.mintick), false);
  level('sl', t.stop, display.tradeStopColor, 'SL ' + fmtPrice(t.stop, ctx.mintick), false);
  [[1, t.tp1, t.liq1], [2, t.tp2, t.liq2], [3, t.tp3, t.liq3]].forEach(([n, price, liq]) => {
    level(`tp${n}`, price, display.tradeTargetColor, targetLabelText(n, price, liq, isLong, t.entry, r, t.tpHit, ctx.mintick), t.tpHit >= n);
  });
}

function addLiveTrades(rb) {
  if (!rb.display.showTradeLevels) return;
  const { pbTrade, trTrade } = rb.res.final;
  if (pbTrade) addLiveTrade(rb, 'PB', pbTrade, '', PHASE.TRADE_PB);
  if (trTrade) addLiveTrade(rb, 'TR', trTrade, 'TRAIL · ', PHASE.TRADE_TR);
}

// One result label per closed trade, created on its close bar and never redrawn (1897-1907). It sits at the exit price;
// a trailing-model label that shares its bar with a pullback close moves 1.5 x structure ATR further from the price,
// along the way its body already extends, so the two never stack.
const LABEL_CLEAR_MULT = 1.5;
function addTradeHistory(rb) {
  const { res, display, bars } = rb;
  if (!display.showTradeHistory) return;
  const pbClosedAt = new Set(res.trades.filter((t) => t.model === 'PB').map((t) => t.closeIdx));
  for (const t of res.trades) {
    const isTr = t.model === 'TR';
    const clearBy = isTr && pbClosedAt.has(t.closeIdx) ? LABEL_CLEAR_MULT * res.series.structAtr[t.closeIdx] : 0;
    rb.add('labels', {
      key: `res:${t.model}:${t.closeIdx}`, time: bars[t.closeIdx].time, price: t.exit + (t.side === 'long' ? -clearBy : clearBy),
      text: (t.r >= 0 ? '+' : '') + fmtNum(t.r, '0.0') + 'R · ' + (isTr ? 'T · ' : '') + t.reason,
      style: t.side === 'long' ? 'up' : 'down', color: colorNew(t.r >= 0 ? PINE_COLORS.green : PINE_COLORS.red, 20), textColor: PINE_COLORS.white, size: 'tiny',
    }, t.closeIdx, isTr ? PHASE.RESULT_TR : PHASE.RESULT_PB);
  }
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
  addSeries(rb);
  addKumo(rb);
  addKillzones(rb);
  addLiveTrades(rb);
  addTradeHistory(rb);
  rb.finalize();
  return plan;
}

// Pine keeps at most 500 live boxes / lines / labels and deletes the oldest created first.
export function applyPineCaps(plan) {
  const cap = (items) => (items.length <= PINE_CAP ? items : [...items].sort((a, b) => a.order - b.order).slice(-PINE_CAP));
  return { ...plan, boxes: cap(plan.boxes), lines: cap(plan.lines), labels: cap(plan.labels) };
}
