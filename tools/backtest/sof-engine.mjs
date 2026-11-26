// Offline, bar-by-bar port of src/session-orderflow.pine (Session Order Flow): sessions (Asia / London /
// New York in 24h mode, the opening range in single-session mode), range used, reference range and its
// sweep events, liquidity pools (chart and higher timeframe), the developing volume profile from
// lower-timeframe bars, the estimated delta, the conditions verdict, both trade-module entry models
// (sweep reversal, liquidity run) and, with `render: true`, every Pine drawing and the dashboard's
// last-bar values (the ThndrX overlay). Only alerts are not ported. No imports: the browser bundle uses it.
//
// Statement order follows the Pine global scope, because several blocks read state that an earlier
// block on the same bar has just changed (e.g. the reference reset happens before the sweep test).
//
//   import { runSof, SOF_DEFAULTS } from './sof-engine.mjs';
//   const res = runSof(chart, cfg);   // chart: see buildChart() below
//   res.trades -> closed sweep trades, res.open -> a still-open one or null, res.runTrades / res.runOpen ->
//   the liquidity-run model's, res.series -> per-bar debug values, res.drawings / res.final -> render mode
//
// Pine semantics reproduced here (each one matters for matching TradingView):
//   ta.pivothigh/low   ties allowed on the left, strict on the right (validated in the ICT port)
//   ta.atr             RMA seeded by the SMA of the first `len` true ranges, tr[0] = high - low
//   math.sum / ta.sma  na until `len` bars exist
//   timeframe.change   computed from the exchange-timezone calendar (day / Sunday- or Monday-start week)
//   security_lower_tf  intrabars of each chart bar; the signed-volume `var` runs across ALL intrabars

export const SOF_DEFAULTS = Object.freeze({
  marketMode: 'Auto',            // 'Auto' | '24h sessions' | 'Single session'
  sessionTz: 'America/New_York',
  asiaSession: '1800-0000',
  openRangeMins: 30,
  avgRangeLen: 14,
  exhaustedPct: 85.0,
  pivotLen: 10,
  showHtfPools: true,
  htfInput: '60',                // minutes, or 'D' / 'W' / 'M'; '' = chart
  htfPivotLen: 3,
  maxPools: 5,
  vpRows: 40,
  vaPct: 70.0,
  deltaTf: 'Auto',
  pressureLen: 20,
  domPct: 55.0,
  tradeGate: 'Not against bias', // 'Favourable only' | 'Not against bias' | 'Any except Avoid' | 'No filter'
  trigPools: true,
  trigRef: true,
  stopBufAtr: 0.1,
  minRiskAtr: 0.5,
  maxRiskAtr: 3.0,
  tp1R: 1.0,
  tp2MinR: 1.5,
  tp2MaxR: 4.0,
  tp2FallbackR: 2.0,
  beAfterTp1: true,
  maxTradeBars: 0,
  lowVolRatio: 0.7,
  // Corrections made 2026-11-21. Set to the old values to reproduce the pre-fix script.
  deltaTieRule: 'tick',          // 'tick' (TradingView CVD rule) | 'zero' (old: unchanged bars count 0)
  beSameBar: true,               // TP1 + return to entry on one bar = breakeven stop (old: false)
  // Trade module. The Pine default model is 'Liquidity run (trend)' with the module off; the backtests keep the
  // sweep model on, so these defaults reproduce them. The overlay passes the Pine values explicitly.
  showTrades: true,
  entryModel: 'Sweep reversal',  // 'Liquidity run (trend)' | 'Sweep reversal'
  runStopAtr: 8.0,
  runTrendLen: 200,
  // Live-chart and drawing options (the ThndrX overlay). lastBarOpen: the last bar is still forming, so it is not
  // barstate.isconfirmed (no pool resolution, sweep events, breakouts or entries on it).
  lastBarOpen: false,
  render: false,                 // record every Pine drawing (result.drawings) and the dashboard values (result.final)
  showAsia: true, showLondon: true, showNewYork: true,
  londonSession: '0200-0500', newYorkSession: '0700-1000',
  showOpenRange: true,
  showPools: true,
  keepTaken: 3,
  poolThickMult: 0.1,
  showProfile: true, showPrevProfile: true, prevKeep: 2,
  showRefLines: true,
  // Backtest-only additions (not in the Pine script)
  longOnly: false,
  shortOnly: false,
  costPctPerSide: 0.0,           // slippage + fee, % of price, charged on entry and on the blended exit
  commissionPer: 0.0,            // fixed currency per order (EGX: 2 EGP)
  positionSize: 100000,          // currency, for the commission-in-R term
});

const NA = NaN;
const isNa = (v) => v !== v;
const nz = (v, d = 0) => (v !== v ? d : v);

function tfSecondsOf(tf, chartSecs) {
  if (tf === '' || tf == null) return chartSecs;
  if (tf === 'D' || tf === '1D') return 86400;
  if (tf === 'W' || tf === '1W') return 604800;
  if (tf === 'M' || tf === '1M') return 2592000;
  if (tf === '12M') return 31536000;
  return Number(tf) * 60;
}

// ---------------------------------------------------------------- calendar helpers
// Timezone offsets only change on whole hours, so the calendar parts are cached per (tz, UTC hour)
// and the minute is added back.
const fmtCache = new Map();
const hourCache = new Map();
function partsIn(timeSec, tz) {
  const hourIdx = Math.floor(timeSec / 3600), key = tz + '|' + hourIdx;
  let o = hourCache.get(key);
  if (!o) {
    let f = fmtCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      fmtCache.set(tz, f);
    }
    o = {};
    for (const p of f.formatToParts(new Date(hourIdx * 3600 * 1000))) o[p.type] = p.value;
    if (hourCache.size > 2e6) hourCache.clear();
    hourCache.set(key, o);
  }
  const extra = Math.floor((timeSec - Math.floor(timeSec / 3600) * 3600) / 60);
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: String(+o.minute + extra) };
}
// Day number (days since epoch) of the bar's calendar date in tz.
function dayNum(timeSec, tz) {
  const p = partsIn(timeSec, tz);
  return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000);
}
function minutesOfDay(timeSec, tz) {
  const p = partsIn(timeSec, tz);
  return (+p.hour) * 60 + (+p.minute);
}
function inSession(timeSec, session, tz) {
  const m = /^(\d\d)(\d\d)-(\d\d)(\d\d)$/.exec(session);
  const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4], t = minutesOfDay(timeSec, tz);
  return s <= e ? (t >= s && t < e) : (t >= s || t < e);
}

// Period id of a bar for timeframe.change(tf): equal ids = same higher-timeframe bar.
// weekStart: 0 = Sunday (EGX), 1 = Monday (crypto / most markets).
// sessionStartMin (optional, minutes after local midnight): intraday periods start at the session open, as
// TradingView's session-aligned bars do (EGX 4h bars run 10:00-14:00 and 14:00-14:30 Cairo, not on the UTC grid).
function periodIds(times, tf, exTz, weekStart, sessionStartMin = null) {
  const n = times.length, out = new Float64Array(n);
  const secs = tfSecondsOf(tf, 0);
  for (let i = 0; i < n; i++) {
    const t = times[i];
    if (secs < 86400 && sessionStartMin != null) out[i] = dayNum(t, exTz) * 10000 + Math.floor((minutesOfDay(t, exTz) - sessionStartMin) / (secs / 60));
    else if (secs < 86400) out[i] = Math.floor(t / secs);                  // whole-hour offsets: UTC grid = exchange grid
    else if (secs === 86400) out[i] = dayNum(t, exTz);
    else if (secs === 604800) { const d = dayNum(t, exTz); out[i] = Math.floor((d + 4 - weekStart) / 7); } // 1970-01-01 was a Thursday
    else if (secs === 2592000) { const p = partsIn(t, exTz); out[i] = (+p.year) * 12 + (+p.month); }
    else { const p = partsIn(t, exTz); out[i] = +p.year; }
  }
  return out;
}
const changeFlags = (ids) => Uint8Array.from(ids, (v, i) => (i > 0 && v !== ids[i - 1] ? 1 : 0));

// ---------------------------------------------------------------- TA helpers
function taAtr(high, low, close, len) {
  const n = high.length, out = new Float64Array(n).fill(NA), tr = new Float64Array(n);
  for (let i = 0; i < n; i++) tr[i] = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i < len) { s += tr[i]; if (i === len - 1) out[i] = s / len; continue; }
    out[i] = (out[i - 1] * (len - 1) + tr[i]) / len;
  }
  return out;
}
// ta.pivothigh/low(src, L, L): value reported on bar i for the pivot at i - L.
function taPivots(src, L, isHigh) {
  const n = src.length, out = new Float64Array(n).fill(NA);
  for (let i = 2 * L; i < n; i++) {
    const c = i - L, v = src[c];
    let ok = true;
    for (let j = i - 2 * L; j <= i && ok; j++) {
      if (j === c) continue;
      const w = src[j];
      // left of the pivot: an equal bar is allowed; right of it: must be strictly beyond
      if (j < c ? (isHigh ? w > v : w < v) : (isHigh ? w >= v : w <= v)) ok = false;
    }
    if (ok) out[i] = v;
  }
  return out;
}
function slidingSum(src, len) {
  const n = src.length, out = new Float64Array(n).fill(NA);
  let s = 0;
  for (let i = 0; i < n; i++) { s += src[i]; if (i >= len) s -= src[i - len]; if (i >= len - 1) out[i] = s; }
  return out;
}

// Signed volume of a series under the TradingView CVD rule (state runs over the whole series).
export function signedVolumeSeries(open, close, vol, rule = 'tick') {
  const n = open.length, out = new Float64Array(n);
  let isBuy = true;
  for (let i = 0; i < n; i++) {
    const c = close[i], o = open[i], v = nz(vol[i]);
    if (rule === 'zero') { out[i] = c > o ? v : c < o ? -v : 0; continue; }
    const pc = i > 0 ? close[i - 1] : c;
    if (c > o) isBuy = true;
    else if (c < o) isBuy = false;
    else if (c > pc) isBuy = true;
    else if (c < pc) isBuy = false;
    out[i] = isBuy ? v : -v;
  }
  return out;
}

const roundToMintick = (x, mt) => Math.round(x / mt) * mt;

// Pine ta.ema: seeded with the first value (pine_ema in the Pine reference), not with an SMA.
function pineEma(src, len) {
  const n = src.length, out = new Float64Array(n), a = 2 / (len + 1);
  let p = NA;
  for (let i = 0; i < n; i++) { p = isNa(p) ? src[i] : a * src[i] + (1 - a) * p; out[i] = p; }
  return out;
}

// Intrabar rows [time, open, high, low, close, volume] -> column arrays plus both signed-volume series. Building this
// is the costly part of buildChart (hundreds of thousands of rows), so a caller that reuses the same intrabars for many
// runs (the ThndrX overlay's live panel) builds it once and passes it as `ltf`.
export function buildLtf(ltfBars) {
  const L = ltfBars, n = L.length;
  const ltf = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), vol: new Float64Array(n) };
  for (let k = 0; k < n; k++) { const r = L[k]; ltf.time[k] = r[0]; ltf.open[k] = r[1]; ltf.high[k] = r[2]; ltf.low[k] = r[3]; ltf.close[k] = r[4]; ltf.vol[k] = r[5]; }
  ltf.signedFor = { tick: signedVolumeSeries(ltf.open, ltf.close, ltf.vol, 'tick'), zero: signedVolumeSeries(ltf.open, ltf.close, ltf.vol, 'zero') };
  return ltf;
}

// Chart bars + optional intrabars -> the engine's chart object. Bars are [time, open, high, low, close, volume]
// rows (seconds); an intrabar belongs to the chart bar whose [time, next time) holds it, as request.security_lower_tf.
// Intrabars come as rows (ltfBars) or prebuilt by buildLtf (ltf); only the per-bar [start, end) index is made here.
// sessionStartMin (optional): minutes after local midnight the exchange session opens; intraday higher timeframes
// (timeframe.change("240") etc.) are then aligned to it like TradingView's session-aligned bars.
export function buildChart({ symbol, bars, ltfBars = null, ltf: prebuilt = null, tfSecs, symType, exTz, weekStart, mintick, from = null, to = null, sessionStartMin = null }) {
  let b = bars;
  if (from != null) b = b.filter((r) => r[0] >= from);
  if (to != null) b = b.filter((r) => r[0] < to);
  const col = (rows, k) => Float64Array.from(rows, (r) => r[k]);
  const chart = {
    symbol, mintick, symType, exTz, weekStart, tfSecs, sessionStartMin,
    isIntraday: tfSecs < 86400, isDaily: tfSecs === 86400, isWeekly: tfSecs === 604800,
    time: col(b, 0), open: col(b, 1), high: col(b, 2), low: col(b, 3), close: col(b, 4), volume: col(b, 5),
    ltf: null,
  };
  const base = prebuilt || (ltfBars && ltfBars.length ? buildLtf(ltfBars) : null);
  if (base && base.time.length) {
    const L = base.time.length, n = chart.time.length, start = new Int32Array(n), end = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t0 = chart.time[i], t1 = i + 1 < n ? chart.time[i + 1] : Infinity;
      while (k < L && base.time[k] < t0) k++;
      start[i] = k;
      let e = k;
      while (e < L && base.time[e] < t1) e++;
      end[i] = e; k = e;
    }
    chart.ltf = { ...base, start, end }; // the shared columns are never written to
  }
  return chart;
}

// Pine drawing registry: box / line / label objects in creation order with Pine's per-type caps. Creating one past
// the cap deletes the oldest live object of that type at once (as Pine does); set() on a deleted object is a no-op,
// delete() on null or a deleted object too. Objects are plain records the render plan reads at the end.
export const PINE_DRAW_CAPS = Object.freeze({ box: 200, line: 500, label: 500 }); // session-orderflow.pine line 25
export function makeRegistry(caps = PINE_DRAW_CAPS) {
  let seq = 0;
  const live = { box: [], line: [], label: [] };
  return {
    live,
    make(type, props) {
      const o = { type, seq: seq++, deleted: false, ...props };
      const a = live[type];
      a.push(o);
      if (a.length > caps[type]) a.shift().deleted = true;
      return o;
    },
    set(o, props) { if (o && !o.deleted) Object.assign(o, props); },
    del(o) {
      if (!o || o.deleted) return;
      o.deleted = true;
      const a = live[o.type], k = a.lastIndexOf(o);
      if (k >= 0) a.splice(k, 1);
    },
  };
}

// ================================================================================================
// chart = {
//   symbol, mintick, symType ('crypto'|'stock'|...), exTz, weekStart (0|1),
//   tfSecs, isIntraday, isDaily, isWeekly,
//   time, open, high, low, close, volume  (Float64Array, chart bars, ascending)
//   ltf: null | { start: Int32Array, end: Int32Array, high, low, vol, signed }  // intrabars [start,end) per chart bar
// }
// ================================================================================================
export function runSof(chart, userCfg = {}) {
  const cfg = { ...SOF_DEFAULTS, ...userCfg };
  const { time, open, high, low, close, volume, mintick } = chart;
  const n = time.length;
  const tfSeconds = chart.tfSecs;
  const R = cfg.render ? makeRegistry() : null; // the Pine drawings, only when asked for (the overlay)
  // time_close: an intraday bar closes tfSecs after it opens; a daily / weekly bar at the next bar's open (the last
  // one a period later). Drawings anchored there end at the bar's right edge, as Pine's xloc.bar_time boxes do.
  const timeClose = (i) => (chart.isIntraday || i + 1 >= n ? time[i] + tfSeconds : time[i + 1]);

  const autoIs24h = ['crypto', 'forex', 'cfd', 'futures', 'spot'].includes(chart.symType);
  const is24hMode = cfg.marketMode === '24h sessions' || (cfg.marketMode === 'Auto' && autoIs24h);
  const sessionsOn = is24hMode && chart.isIntraday && tfSeconds <= 3600;
  const openRangeOn = !is24hMode && chart.isIntraday && tfSeconds <= cfg.openRangeMins * 60;
  const anchorTf = chart.isIntraday ? 'D' : chart.isDaily ? 'W' : chart.isWeekly ? 'M' : '12M';
  const anchorName = chart.isIntraday ? 'day' : chart.isDaily ? 'week' : chart.isWeekly ? 'month' : 'year';

  const ids = (tf) => periodIds(time, tf, chart.exTz, chart.weekStart, chart.sessionStartMin);
  const newAnchor = changeFlags(ids(anchorTf));
  const newDay = chart.isIntraday ? changeFlags(ids('D')) : null;

  const htfBumped = chart.isIntraday ? 'D' : chart.isDaily ? 'W' : 'M';
  const htfTf = tfSecondsOf(cfg.htfInput, tfSeconds) > tfSeconds ? cfg.htfInput : htfBumped;
  const htfSecs = tfSecondsOf(htfTf, tfSeconds);
  const htfOn = cfg.showHtfPools && htfSecs > tfSeconds;
  const htfNew = changeFlags(ids(htfTf));

  const atr = taAtr(high, low, close, 14);
  const pivHiS = taPivots(high, cfg.pivotLen, true);
  const pivLoS = taPivots(low, cfg.pivotLen, false);
  const runOn = cfg.showTrades && cfg.entryModel === 'Liquidity run (trend)';
  const sweepOn = cfg.showTrades && !runOn;
  const emaTrend = runOn ? pineEma(close, cfg.runTrendLen) : null;

  // ---- delta inputs
  const barVolArr = Float64Array.from(volume, (v) => nz(v));
  const chartSigned = signedVolumeSeries(open, close, volume, cfg.deltaTieRule);
  const ltf = chart.ltf;
  const ltfSigned = ltf ? (ltf.signedFor && ltf.signedFor[cfg.deltaTieRule]) || signedVolumeSeries(ltf.open, ltf.close, ltf.vol, cfg.deltaTieRule) : null;
  const barDelta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let has = false, s = 0;
    if (ltf && ltf.end[i] > ltf.start[i]) { has = true; for (let k = ltf.start[i]; k < ltf.end[i]; k++) s += ltfSigned[k]; }
    barDelta[i] = has ? s : chartSigned[i];
  }
  const buyVol = Float64Array.from(barDelta, (d, i) => (barVolArr[i] + d) / 2);
  const sumVolN = slidingSum(barVolArr, cfg.pressureLen);
  const sumBuyN = slidingSum(buyVol, cfg.pressureLen);
  const volRecentS = (() => { const s = slidingSum(barVolArr, cfg.pressureLen); return Float64Array.from(s, (v) => v / cfg.pressureLen); })();
  const volNormalS = (() => { const L = cfg.pressureLen * 5, s = slidingSum(barVolArr, L); return Float64Array.from(s, (v) => v / L); })();

  // ---- state
  // Sessions (Pine type Sess). Asia feeds the reference range; London / New York and the opening range only draw.
  const mkSess = (name, extend = false) => ({ name, extend, active: false, state: 'idle', hi: NA, lo: NA, bx: null, ended: false, brokeUp: false, brokeDn: false });
  const asia = mkSess('ASIA'), london = mkSess('LONDON'), newYork = mkSess('NEW YORK'), openRng = mkSess('OR', true);
  let dayOpenTime = NA;
  let curHi = NA, curLo = NA, prevHi = NA, prevLo = NA, periods = 0;
  const pastRanges = [];
  let refHi = NA, refLo = NA, hiTouched = false, loTouched = false, refHiLine = null, refLoLine = null;
  const pools = []; // {level, isHigh, htf, bx}
  let aggHi = NA, aggLo = NA, aggT = NA;
  const hHi = [], hLo = [], hT = [];
  const htfWindow = 2 * cfg.htfPivotLen + 1;
  const takenBoxes = [];
  let lastLiq = null, lastLiqBar = NA; // { isHigh, htf, accepted, level }
  // profile
  let prof = [], profBase = NA, profStep = NA, profTotal = 0, pocRow = NA, pocVol = 0;
  let devPoc = NA, devVah = NA, devVal = NA, prevPoc = NA, prevVah = NA, prevVal = NA, sawVolume = false;
  let lPoc = null, lVah = null, lVal = null, lpPoc = null, lpVah = null, lpVal = null, periodStartT = NA;
  const prevLines = [];
  let cumDelta = 0;
  // trades
  let trade = null;
  const trades = [];
  let rDir = 0, rEntry = NA, rStop = NA, rRisk = NA, rBest = NA, rOpenIdx = -1, rLnEntry = null, rLnStop = null;
  const runTrades = [];
  let final = null;
  const series = cfg.keepSeries ? { devPoc: new Float64Array(n), devVah: new Float64Array(n), devVal: new Float64Array(n), prevPoc: new Float64Array(n), barDelta, cumDelta: new Float64Array(n), verdict: new Int8Array(n), bias: new Int8Array(n), refHi: new Float64Array(n), refLo: new Float64Array(n), rangeUsedPct: new Float64Array(n), npools: new Int16Array(n), ev: new Uint8Array(n) } : null;

  // Pine Sess.update (lines 157-189) with its box drawing; `confirmed` is barstate.isconfirmed.
  const sessUpdate = (s, inSess, show, i, confirmed) => {
    const h = high[i], l = low[i], c = close[i];
    s.ended = false; s.brokeUp = false; s.brokeDn = false;
    if (inSess && !s.active) {
      s.hi = h; s.lo = l; s.state = 'forming';
      s.bx = R && show ? R.make('box', { kind: 'sess', name: s.name, dir: 0, t1: time[i], t2: timeClose(i), top: h, bottom: l }) : null;
    } else if (inSess) {
      s.hi = Math.max(s.hi, h); s.lo = Math.min(s.lo, l);
      if (R) R.set(s.bx, { top: s.hi, bottom: s.lo, t2: timeClose(i) });
    }
    if (R && !inSess && s.extend && s.state !== 'idle') R.set(s.bx, { t2: timeClose(i) });
    if (!inSess && s.active) { s.state = 'watch'; s.ended = true; }
    if (!inSess && s.state === 'watch' && confirmed) {
      if (c > s.hi) { s.state = 'bull'; s.brokeUp = true; if (R) R.set(s.bx, { dir: 1 }); }
      else if (c < s.lo) { s.state = 'bear'; s.brokeDn = true; if (R) R.set(s.bx, { dir: -1 }); }
    }
    s.active = inSess;
  };

  // Pine poolBox / addPool (lines 349-386). `i` is the bar the call runs on (for the thickness and the right edge).
  const poolBox = (level, t0, isHigh, htf, i, atrValue) => {
    if (!R || !(htf ? cfg.showHtfPools : cfg.showPools)) return null;
    const th = Math.max(atrValue * cfg.poolThickMult, mintick) * (htf ? 2 : 1);
    return R.make('box', { kind: 'pool', isHigh, htf, taken: false, outcome: null, t1: t0, t2: timeClose(i), top: isHigh ? level : level + th, bottom: isHigh ? level - th : level });
  };
  const addPool = (level, t0, isHigh, htf, i, atrValue) => {
    let same = -1;
    for (let k = 0; k < pools.length; k++) { const q = pools[k]; if (q.isHigh === isHigh && Math.abs(q.level - level) <= mintick) same = k; }
    if (same >= 0) {
      const q = pools[same];
      if (htf && !q.htf) {
        if (R) R.del(q.bx);
        q.htf = true;
        q.bx = poolBox(level, t0, isHigh, true, i, atrValue);
      }
    } else {
      pools.push({ level, isHigh, htf, bx: poolBox(level, t0, isHigh, htf, i, atrValue) });
      let count = 0, oldest = -1;
      for (let k = 0; k < pools.length; k++) { const q = pools[k]; if (q.isHigh === isHigh && q.htf === htf) { count++; if (oldest < 0) oldest = k; } }
      if (count > cfg.maxPools) { const gone = pools.splice(oldest, 1)[0]; if (R) R.del(gone.bx); }
    }
  };
  const tag = (i, y, which, extra = {}) => R.make('label', { kind: 'tag', which, t: timeClose(i), y, ...extra });

  for (let i = 0; i < n; i++) {
    const h = high[i], l = low[i], c = close[i], t = time[i];
    const barVol = barVolArr[i];
    const confirmed = !(cfg.lastBarOpen && i === n - 1); // barstate.isconfirmed
    const isLast = i === n - 1;

    // ================= SESSIONS =================
    if (newDay && (newDay[i] || isNa(dayOpenTime))) dayOpenTime = t;
    const inAsia = sessionsOn && inSession(t, cfg.asiaSession, cfg.sessionTz);
    sessUpdate(asia, inAsia, cfg.showAsia, i, confirmed);
    if (R) {
      sessUpdate(london, sessionsOn && cfg.showLondon && inSession(t, cfg.londonSession, cfg.sessionTz), true, i, confirmed);
      sessUpdate(newYork, sessionsOn && cfg.showNewYork && inSession(t, cfg.newYorkSession, cfg.sessionTz), true, i, confirmed);
      sessUpdate(openRng, openRangeOn && cfg.showOpenRange && t - dayOpenTime < cfg.openRangeMins * 60, true, i, confirmed);
    }

    // ================= RANGE USED =================
    if (isNa(curHi)) { curHi = h; curLo = l; }
    else if (newAnchor[i]) {
      if (periods > 0) {
        pastRanges.push(curHi - curLo);
        if (pastRanges.length > cfg.avgRangeLen) pastRanges.shift();
        prevHi = curHi; prevLo = curLo;
      }
      periods += 1;
      curHi = h; curLo = l;
    } else { curHi = Math.max(curHi, h); curLo = Math.min(curLo, l); }
    const avgRangeReady = pastRanges.length >= Math.min(cfg.avgRangeLen, 5);
    const avgRange = avgRangeReady ? pastRanges.reduce((a, b) => a + b, 0) / pastRanges.length : NA;
    const rangeUsedPct = avgRange > 0 ? (curHi - curLo) / avgRange * 100 : NA;
    const rangeExhausted = !isNa(rangeUsedPct) && rangeUsedPct >= cfg.exhaustedPct;

    // ================= REFERENCE RANGE =================
    let refReset = false, newRefHi = NA, newRefLo = NA;
    if (sessionsOn) {
      if (asia.active) { refHi = NA; refLo = NA; if (R) { R.del(refHiLine); R.del(refLoLine); } }
      else if (asia.ended) { refReset = true; newRefHi = asia.hi; newRefLo = asia.lo; }
    } else if (newAnchor[i] && !isNa(prevHi)) { refReset = true; newRefHi = prevHi; newRefLo = prevLo; }
    if (refReset) {
      refHi = newRefHi; refLo = newRefLo; hiTouched = false; loTouched = false;
      if (R) {
        R.del(refHiLine); R.del(refLoLine); refHiLine = null; refLoLine = null;
        if (cfg.showRefLines) {
          refHiLine = R.make('line', { kind: 'ref', t1: t, t2: timeClose(i), y: refHi });
          refLoLine = R.make('line', { kind: 'ref', t1: t, t2: timeClose(i), y: refLo });
        }
      }
    } else if (R && !isNa(refHi) && refHiLine) { R.set(refHiLine, { t2: timeClose(i) }); R.set(refLoLine, { t2: timeClose(i) }); }
    const hiTouchedNow = !isNa(refHi) && h > refHi;
    const loTouchedNow = !isNa(refLo) && l < refLo;
    const hiSweepEvent = confirmed && hiTouchedNow && !hiTouched && c <= refHi;
    const loSweepEvent = confirmed && loTouchedNow && !loTouched && c >= refLo;
    const hiRunEvent = confirmed && hiTouchedNow && !hiTouched && c > refHi;
    const loRunEvent = confirmed && loTouchedNow && !loTouched && c < refLo;
    if (hiTouchedNow) hiTouched = true;
    if (loTouchedNow) loTouched = true;

    // ================= POOLS =================
    const atrValue = nz(atr[i], h - l);
    if (!isNa(pivHiS[i])) addPool(pivHiS[i], time[i - cfg.pivotLen], true, false, i, atrValue);
    if (!isNa(pivLoS[i])) addPool(pivLoS[i], time[i - cfg.pivotLen], false, false, i, atrValue);
    if (htfOn) {
      if (htfNew[i] && !isNa(aggHi)) {
        hHi.push(aggHi); hLo.push(aggLo); hT.push(aggT);
        if (hHi.length > htfWindow) { hHi.shift(); hLo.shift(); hT.shift(); }
        if (hHi.length === htfWindow) {
          const k = cfg.htfPivotLen, midHi = hHi[k], midLo = hLo[k];
          if (midHi === Math.max(...hHi) && hHi.indexOf(midHi) === k && hHi.lastIndexOf(midHi) === k) addPool(midHi, hT[k], true, true, i, atrValue);
          if (midLo === Math.min(...hLo) && hLo.indexOf(midLo) === k && hLo.lastIndexOf(midLo) === k) addPool(midLo, hT[k], false, true, i, atrValue);
        }
      }
      if (htfNew[i] || isNa(aggHi)) { aggHi = h; aggLo = l; aggT = t; }
      else { aggHi = Math.max(aggHi, h); aggLo = Math.min(aggLo, l); }
    }
    let bslSwept = false, sslSwept = false, bslRun = false, sslRun = false;
    for (let k = pools.length - 1; k >= 0; k--) {
      const p = pools[k];
      const hit = p.isHigh ? h > p.level : l < p.level;
      if (hit && confirmed) {
        const accepted = p.isHigh ? c > p.level : c < p.level;
        if (p.isHigh) { bslSwept = bslSwept || !accepted; bslRun = bslRun || accepted; } else { sslSwept = sslSwept || !accepted; sslRun = sslRun || accepted; }
        lastLiq = { isHigh: p.isHigh, htf: p.htf, accepted, level: p.level };
        lastLiqBar = i;
        if (R) { R.set(p.bx, { t2: timeClose(i), taken: true, outcome: accepted ? 'run' : 'swept' }); takenBoxes.push(p.bx); }
        pools.splice(k, 1);
      } else if (R) R.set(p.bx, { t2: timeClose(i) });
    }
    if (R) while (takenBoxes.length > cfg.keepTaken) R.del(takenBoxes.shift());

    // ================= VOLUME PROFILE =================
    if (newAnchor[i] || isNa(profStep)) {
      if (newAnchor[i] && periods > 1 && !isNa(devPoc)) { prevPoc = devPoc; prevVah = devVah; prevVal = devVal; }
      prof = []; profBase = NA; profTotal = 0; pocRow = NA; pocVol = 0; devPoc = NA; devVah = NA; devVal = NA;
      const basis = !isNa(avgRange) ? avgRange : i > 20 ? atrValue * 8 : NA;
      profStep = isNa(basis) || basis <= 0 ? NA : Math.max(roundToMintick(basis / cfg.vpRows, mintick), mintick);
    }
    const hasLtf = ltf && ltf.end[i] > ltf.start[i];
    let ltfVolSum = 0;
    if (hasLtf) for (let k = ltf.start[i]; k < ltf.end[i]; k++) ltfVolSum += nz(ltf.vol[k]);
    const useLtf = hasLtf && ltfVolSum > 0;
    if (barVol > 0 && !isNa(profStep)) {
      sawVolume = true;
      const k0 = useLtf ? ltf.start[i] : 0, k1 = useLtf ? ltf.end[i] : 1;
      for (let k = k0; k < k1; k++) {
        const pHi = useLtf ? ltf.high[k] : h, pLo = useLtf ? ltf.low[k] : l, pV = useLtf ? nz(ltf.vol[k]) : barVol;
        if (pV > 0 && !isNa(pHi) && !isNa(pLo)) {
          let loRow = Math.floor(pLo / profStep), hiRow = Math.floor(pHi / profStep);
          if (hiRow - loRow > 2000) { loRow = Math.floor(c / profStep); hiRow = loRow; }
          if (isNa(profBase)) profBase = loRow;
          loRow = Math.max(loRow, profBase + prof.length - 5000);
          hiRow = Math.min(hiRow, profBase + 4999);
          if (hiRow < loRow) hiRow = loRow;
          while (loRow < profBase) { prof.unshift(0); profBase -= 1; }
          while (hiRow > profBase + prof.length - 1) prof.push(0);
          const share = pV / (hiRow - loRow + 1);
          for (let r = loRow; r <= hiRow; r++) {
            const nv = prof[r - profBase] + share;
            prof[r - profBase] = nv;
            if (nv > pocVol) { pocVol = nv; pocRow = r; }
          }
          profTotal += pV;
        }
      }
      if (!isNa(pocRow)) {
        const m = prof.length;
        let vLo = pocRow - profBase, vHi = vLo, acc = prof[vLo];
        const target = profTotal * cfg.vaPct / 100;
        while (acc < target && (vLo > 0 || vHi < m - 1)) {
          const up = vHi < m - 1 ? prof[vHi + 1] : -1.0;
          const dn = vLo > 0 ? prof[vLo - 1] : -1.0;
          if (up >= dn) { vHi += 1; acc += up; } else { vLo -= 1; acc += dn; }
        }
        devPoc = (pocRow + 0.5) * profStep;
        devVah = (profBase + vHi + 1) * profStep;
        devVal = (profBase + vLo) * profStep;
      }
    }
    // Profile lines (Pine 611-656) and the right-hand tags on the last bar (663-674).
    if (R) {
      if (newAnchor[i] || isNa(periodStartT)) {
        periodStartT = t;
        R.del(lPoc); R.del(lVah); R.del(lVal);
        lPoc = lVah = lVal = lpPoc = lpVah = lpVal = null;
        if (cfg.showPrevProfile && !isNa(prevPoc)) {
          lpPoc = R.make('line', { kind: 'prev', which: 'poc', t1: t, t2: timeClose(i), y: prevPoc });
          lpVah = R.make('line', { kind: 'prev', which: 'vah', t1: t, t2: timeClose(i), y: prevVah });
          lpVal = R.make('line', { kind: 'prev', which: 'val', t1: t, t2: timeClose(i), y: prevVal });
          prevLines.push(lpPoc, lpVah, lpVal);
          while (prevLines.length > cfg.prevKeep * 3) R.del(prevLines.shift());
        }
      } else if (lpPoc) { for (const ln of [lpPoc, lpVah, lpVal]) R.set(ln, { t2: timeClose(i) }); }
      if (cfg.showProfile && !isNa(devPoc)) {
        if (!lPoc) {
          lPoc = R.make('line', { kind: 'dev', which: 'poc' });
          lVah = R.make('line', { kind: 'dev', which: 'vah' });
          lVal = R.make('line', { kind: 'dev', which: 'val' });
        }
        R.set(lPoc, { t1: periodStartT, t2: timeClose(i), y: devPoc });
        R.set(lVah, { t1: periodStartT, t2: timeClose(i), y: devVah });
        R.set(lVal, { t1: periodStartT, t2: timeClose(i), y: devVal });
      }
      if (isLast) {
        if (cfg.showProfile && !isNa(devPoc)) { tag(i, devPoc, 'POC'); tag(i, devVah, 'VAH'); tag(i, devVal, 'VAL'); }
        if (cfg.showPrevProfile && lpPoc) { tag(i, prevPoc, 'prior POC', { prior: true }); tag(i, prevVah, 'prior VAH', { prior: true }); tag(i, prevVal, 'prior VAL', { prior: true }); }
      }
    }
    const valuePos = isNa(devPoc) ? 0 : c > devVah ? 1 : c < devVal ? -1 : 0;

    // ================= DELTA =================
    if (newAnchor[i]) cumDelta = 0;
    cumDelta += barDelta[i];
    const buyPct = sumVolN[i] > 0 ? sumBuyN[i] / sumVolN[i] * 100 : NA;
    const priceChgN = i >= cfg.pressureLen ? c - close[i - cfg.pressureLen] : NA;
    const buyDom = buyPct >= cfg.domPct;
    const sellDom = buyPct <= 100 - cfg.domPct;
    const buyAbsorbed = buyDom && priceChgN <= 0;
    const sellAbsorbed = sellDom && priceChgN >= 0;

    // ================= CONDITIONS =================
    const bias = isNa(devPoc) ? 0 : isNa(prevPoc) ? (c > devPoc ? 1 : c < devPoc ? -1 : 0) : (c > devPoc && c > prevPoc ? 1 : c < devPoc && c < prevPoc ? -1 : 0);
    const flowAgainst = (bias > 0 && ((sellDom && !sellAbsorbed) || buyAbsorbed)) || (bias < 0 && ((buyDom && !buyAbsorbed) || sellAbsorbed));
    const volRecent = volRecentS[i], volNormal = volNormalS[i];
    const lowVolume = volNormal > 0 && volRecent < volNormal * cfg.lowVolRatio;
    const extended = (bias > 0 && valuePos > 0) || (bias < 0 && valuePos < 0) || (bias !== 0 && valuePos === -bias);
    const verdict = rangeExhausted ? 0 : (bias === 0 || extended || flowAgainst || lowVolume) ? 1 : 2;

    if (series) {
      series.devPoc[i] = devPoc; series.devVah[i] = devVah; series.devVal[i] = devVal; series.prevPoc[i] = prevPoc;
      series.cumDelta[i] = cumDelta; series.verdict[i] = verdict; series.bias[i] = bias; series.refHi[i] = refHi; series.refLo[i] = refLo;
      series.rangeUsedPct[i] = rangeUsedPct; series.npools[i] = pools.length;
      // event bits: 1 BSL swept, 2 SSL swept, 4 BSL run, 8 SSL run, 16 ref high swept, 32 ref low swept, 64 ref high run, 128 ref low run
      series.ev[i] = (bslSwept ? 1 : 0) | (sslSwept ? 2 : 0) | (bslRun ? 4 : 0) | (sslRun ? 8 : 0) | (hiSweepEvent ? 16 : 0) | (loSweepEvent ? 32 : 0) | (hiRunEvent ? 64 : 0) | (loRunEvent ? 128 : 0);
    }

    // ================= TRADE MANAGEMENT (sweep model) =================
    if (trade && i > trade.openIdx) {
      const tr = trade, isLong = tr.dir > 0;
      const hitStop = isLong ? l <= tr.stop : h >= tr.stop;
      const hitTp1 = isLong ? h >= tr.tp1 : l <= tr.tp1;
      const hitTp2 = isLong ? h >= tr.tp2 : l <= tr.tp2;
      const tp2R = Math.abs(tr.tp2 - tr.entry) / tr.risk;
      let resultR = NA, outcome = null, exitPx = NA;
      if (!tr.tp1Hit) {
        if (hitStop) { resultR = -1.0; outcome = 'stopped'; exitPx = tr.stop; }
        else if (hitTp1) {
          tr.tp1Hit = true; tr.tp1Idx = i;
          const cameBack = isLong ? l <= tr.entry : h >= tr.entry;
          if (hitTp2 && !cameBack) { resultR = 0.5 * cfg.tp1R + 0.5 * tp2R; outcome = 'tp2'; exitPx = tr.tp2; }
          else if (cfg.beAfterTp1 && cfg.beSameBar && cameBack) { resultR = 0.5 * cfg.tp1R; outcome = 'tp1only'; exitPx = tr.entry; }
          else if (cfg.beAfterTp1) {
            tr.stop = tr.entry;
            if (R && tr.d) { R.set(tr.d.lnStop, { y: tr.stop }); R.set(tr.d.lbStop, { y: tr.stop, be: true }); }
          }
        }
      } else {
        if (hitStop) { const stopR = (tr.stop - tr.entry) * tr.dir / tr.risk; resultR = 0.5 * cfg.tp1R + 0.5 * stopR; outcome = 'tp1only'; exitPx = tr.stop; }
        else if (hitTp2) { resultR = 0.5 * cfg.tp1R + 0.5 * tp2R; outcome = 'tp2'; exitPx = tr.tp2; }
      }
      if (isNa(resultR) && cfg.maxTradeBars > 0 && i - tr.openIdx >= cfg.maxTradeBars) {
        const mtmR = (c - tr.entry) * tr.dir / tr.risk;
        resultR = tr.tp1Hit ? 0.5 * cfg.tp1R + 0.5 * mtmR : mtmR; outcome = 'timeout'; exitPx = c;
      }
      if (R && tr.d) {
        for (const ln of [tr.d.lnEntry, tr.d.lnStop, tr.d.lnTp1, tr.d.lnTp2]) R.set(ln, { t2: timeClose(i) });
        for (const lb of [tr.d.lbStop, tr.d.lbTp1, tr.d.lbTp2]) R.set(lb, { t: timeClose(i) });
        if (tr.tp1Hit) R.set(tr.d.lbTp1, { hit: true });
      }
      if (!isNa(resultR)) {
        tr.closeIdx = i; tr.closeTime = t; tr.outcome = outcome; tr.grossR = resultR; tr.exitPx = exitPx;
        // costs (backtest only): slippage/fees on entry and on the blended exit; commission per order
        const blendedExit = tr.tp1Hit ? 0.5 * tr.tp1 + 0.5 * exitPx : exitPx;
        const slipR = cfg.costPctPerSide / 100 * (tr.entry + blendedExit) / tr.risk;
        const orders = 1 + (tr.tp1Hit ? 2 : 1);
        const commR = cfg.commissionPer > 0 ? orders * cfg.commissionPer / ((cfg.positionSize / tr.entry) * tr.risk) : 0;
        tr.costR = slipR + commR;
        tr.r = resultR - tr.costR;
        if (R) R.make('label', { kind: 'result', model: 'sweep', t, bar: i, y: h, r: resultR });
        delete tr.d;
        trades.push(tr);
        trade = null;
      }
    }

    // ================= OPEN A NEW TRADE (sweep model) =================
    if (sweepOn && trade === null && confirmed) {
      const lowSwept = (cfg.trigPools && sslSwept) || (cfg.trigRef && loSweepEvent);
      const highSwept = (cfg.trigPools && bslSwept) || (cfg.trigRef && hiSweepEvent);
      let dir = lowSwept && !highSwept ? 1 : highSwept && !lowSwept ? -1 : 0;
      if (cfg.longOnly && dir < 0) dir = 0;
      if (cfg.shortOnly && dir > 0) dir = 0;
      const g = cfg.tradeGate;
      const gateOk = dir !== 0 && (g === 'No filter' || (verdict !== 0 && (g === 'Any except Avoid' || (g === 'Not against bias' && bias !== -dir) || (g === 'Favourable only' && verdict === 2 && bias === dir))));
      if (gateOk) {
        const wickStop = dir > 0 ? l - atrValue * cfg.stopBufAtr : h + atrValue * cfg.stopBufAtr;
        const risk = Math.max(Math.abs(c - wickStop), atrValue * cfg.minRiskAtr);
        if (risk > 0 && risk <= atrValue * cfg.maxRiskAtr) {
          const entry = c, stop = entry - dir * risk, tp1 = entry + dir * risk * cfg.tp1R, minT = entry + dir * risk * cfg.tp2MinR;
          let best = NA;
          const nearer = (b, lv) => {
            const ok = !isNa(lv) && (dir > 0 ? lv >= minT : lv <= minT);
            return ok && (isNa(b) || (dir > 0 ? lv < b : lv > b)) ? lv : b;
          };
          for (const q of pools) if (q.isHigh === (dir > 0)) best = nearer(best, q.level);
          best = nearer(best, dir > 0 ? refHi : refLo);
          best = nearer(best, devPoc);
          best = nearer(best, prevPoc);
          const tp2 = isNa(best) || Math.abs(best - entry) > risk * cfg.tp2MaxR ? entry + dir * risk * cfg.tp2FallbackR : best;
          const trig = (dir > 0 ? (cfg.trigPools && sslSwept ? 'pool' : '') + (cfg.trigRef && loSweepEvent ? 'ref' : '') : (cfg.trigPools && bslSwept ? 'pool' : '') + (cfg.trigRef && hiSweepEvent ? 'ref' : ''));
          trade = { dir, entry, stop, risk, tp1, tp2, tp1Hit: false, openIdx: i, openTime: t, riskAtr: risk / atrValue, riskPct: risk / entry * 100, trig, verdict, bias, valuePos, flowAgainst, lowVolume, rangeUsedPct };
          if (R) {
            const ln = (part, y) => R.make('line', { kind: 'trade', part, t1: t, t2: timeClose(i), y });
            const d = { lnEntry: ln('entry', entry), lnStop: ln('stop', stop), lnTp1: ln('tp1', tp1), lnTp2: ln('tp2', tp2) };
            d.lbStop = tag(i, stop, 'SL', { trade: true }); d.lbTp1 = tag(i, tp1, 'TP1', { trade: true }); d.lbTp2 = tag(i, tp2, 'TP2', { trade: true });
            R.make('label', { kind: 'entry', dir, t, bar: i, y: c });
            Object.defineProperty(trade, 'd', { value: d, enumerable: false, configurable: true, writable: true });
          }
        }
      }
    }

    // ================= LIQUIDITY RUN MODEL (Pine 917-982) =================
    if (runOn && rDir !== 0 && i > rOpenIdx) {
      let exitPx = NA, why = '';
      if (rDir > 0 ? open[i] <= rStop : open[i] >= rStop) { exitPx = open[i]; why = 'gap'; }
      else if (rDir > 0 ? l <= rStop : h >= rStop) { exitPx = rStop; why = rStop === rEntry - rDir * rRisk ? 'stop' : 'trail'; }
      if (!isNa(exitPx)) {
        const rr = (exitPx - rEntry) * rDir / rRisk;
        runTrades.push({ dir: rDir, entry: rEntry, initStop: rEntry - rDir * rRisk, risk: rRisk, openIdx: rOpenIdx, openTime: time[rOpenIdx], closeIdx: i, closeTime: t, exitPx, why, r: rr });
        if (R) {
          R.set(rLnEntry, { t2: t }); R.set(rLnStop, { t2: t });
          R.make('label', { kind: 'result', model: 'run', t, bar: i, y: h, r: rr });
        }
        rDir = 0;
      } else {
        rBest = rDir > 0 ? Math.max(rBest, c) : Math.min(rBest, c);
        const ts = rBest - rDir * cfg.runStopAtr * atr[i];
        if (rDir > 0 ? ts > rStop : ts < rStop) rStop = ts;
        if (R) { R.set(rLnEntry, { t2: timeClose(i) }); R.set(rLnStop, { y: rStop, t2: timeClose(i) }); }
      }
    }
    if (runOn && rDir === 0 && confirmed && !isNa(atr[i]) && atr[i] > c * 1e-4) {
      const d = bslRun && !sslRun ? 1 : sslRun && !bslRun ? -1 : 0;
      if (d !== 0 && (d > 0 ? c > emaTrend[i] : c < emaTrend[i])) {
        rDir = d; rEntry = c; rRisk = cfg.runStopAtr * atr[i]; rStop = c - d * rRisk; rBest = c; rOpenIdx = i;
        if (R) {
          rLnEntry = R.make('line', { kind: 'run', part: 'entry', t1: t, t2: timeClose(i), y: c });
          rLnStop = R.make('line', { kind: 'run', part: 'stop', t1: t, t2: timeClose(i), y: rStop });
          R.make('label', { kind: 'entry', dir: d, t, bar: i, y: c });
        }
      }
    }

    // ================= DASHBOARD VALUES (Pine barstate.islast) =================
    if (isLast) {
      let nearBsl = NA, nearSsl = NA;
      for (const p of pools) {
        if (p.isHigh && p.level > c && (isNa(nearBsl) || p.level < nearBsl)) nearBsl = p.level;
        if (!p.isHigh && p.level < c && (isNa(nearSsl) || p.level > nearSsl)) nearSsl = p.level;
      }
      const sideStatus = (level, touched, beyond) => (isNa(level) ? 'Forming' : !touched ? 'Intact' : beyond ? 'Broken' : 'Swept');
      final = {
        close: c, atrValue, verdict, bias, extended, flowAgainst, lowVolume, valuePos, rangeUsedPct, rangeExhausted,
        devPoc, devVah, devVal, prevPoc, refHi, refLo, sawVolume, nearBsl, nearSsl, buyPct, cumDelta, volRecent, volNormal,
        hiStatus: sideStatus(refHi, hiTouched, c > refHi), loStatus: sideStatus(refLo, loTouched, c < refLo),
        flow: isNa(buyPct) ? 'na' : buyAbsorbed ? 'buyAbsorbed' : sellAbsorbed ? 'sellAbsorbed' : buyDom ? 'buyDom' : sellDom ? 'sellDom' : 'balanced',
        lastLiq, lastLiqBarsAgo: isNa(lastLiqBar) ? NA : i - lastLiqBar,
        is24hMode, sessionsOn, openRangeOn, anchorName, refName: sessionsOn ? 'Asia' : 'Prior ' + anchorName, htfSecs, htfTf,
        trade: trade ? { dir: trade.dir, entry: trade.entry, stop: trade.stop, tp1: trade.tp1, tp2: trade.tp2, tp1Hit: trade.tp1Hit } : null,
        run: rDir !== 0 ? { dir: rDir, entry: rEntry, stop: rStop, risk: rRisk } : null,
      };
    }
  }
  return {
    trades, open: trade, runTrades, runOpen: rDir !== 0 ? { dir: rDir, entry: rEntry, stop: rStop, risk: rRisk, openIdx: rOpenIdx } : null,
    series, final, drawings: R ? R.live : null,
    info: { is24hMode, sessionsOn, openRangeOn, anchorTf, anchorName, htfTf, htfSecs, htfOn, n },
  };
}

export function summarize(trades) {
  const n = trades.length;
  if (!n) return { n: 0, avgR: 0, totalR: 0, grossTotal: 0, win: 0, stoppedPct: 0, tp1onlyPct: 0, tp2Pct: 0 };
  let tot = 0, gross = 0, wins = 0, st = 0, t1 = 0, t2 = 0, to = 0;
  for (const t of trades) { tot += t.r; gross += t.grossR; if (t.r > 0) wins++; if (t.outcome === 'stopped') st++; else if (t.outcome === 'tp1only') t1++; else if (t.outcome === 'tp2') t2++; else to++; }
  return { n, avgR: tot / n, totalR: tot, grossAvg: gross / n, grossTotal: gross, win: wins / n, stoppedPct: st / n * 100, tp1onlyPct: t1 / n * 100, tp2Pct: t2 / n * 100, timeoutPct: to / n * 100 };
}
