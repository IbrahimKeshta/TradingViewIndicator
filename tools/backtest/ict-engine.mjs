// Bar-by-bar Node.js port of the trade engine in src/ict-rsi-ma-indicator.pine (daily bars).
//
// Faithfulness rules followed here:
//  * Every ta.* series is precomputed over the whole history with Pine's own seeding/na rules
//    (ta.rma seeds with an SMA, ta.ema seeds with the first source value, ta.sma/highest/lowest are
//    na until the window is full, NaN stands for na and compares false).
//  * State machines (swings, zones, pending confirmation, trade slots, chandelier trail) run in the
//    same order as the Pine global scope: structure -> FVG mitigate/create -> OB mitigate ->
//    confirmation -> OB create -> gate -> exits -> record -> free slot -> open pullback -> open trail.
//  * Every bar is treated as confirmed (historical bars), which is what a backtest reads.
//
// Not ported: the HTF bias computation itself (the per-bar bias arrives through opts.htfBias / opts.htfActive; without
// it the filter is off, which is what Pine does on a 1D chart with the default Bias Timeframe), all drawing, panels and
// alerts. For the ThndrX overlay the engine also returns the state a renderer needs (series, events, opens, final).

export const NA = NaN;
const isNa = (x) => x !== x || x === null || x === undefined;

// ----------------------------------------------------------------------------------------------
// Defaults = the Pine input defaults. Validation presets live at the bottom of the file.
// ----------------------------------------------------------------------------------------------
export const DEFAULTS = Object.freeze({
  // RSI / MA
  rsiLength: 14,
  maType: 'EMA',
  maLength: 50,
  // Market structure
  majorLookback: 20,
  internalLookback: 5,
  maxSwings: 10,
  structAtrLength: 14,
  eqTolMult: 0.15,
  rangeAtrMult: 2.5,
  rangeLookbackBars: 100,
  // Zones
  showFVG: true,
  fvgMaxCount: 20,
  showOB: true,
  obMaxCount: 20,
  obSearchBars: 50,
  showInternalOb: true,
  // Killzones
  sessionTimezone: 'America/New_York',
  showLondonKZ: true,
  londonSession: '0200-0500',
  showNewYorkKZ: true,
  newYorkSession: '0700-1000',
  showAsiaKZ: false,
  asiaSession: '2000-0000',
  // Pine `egxPreset` (lines 846 and 850): the killzone point is on and earned on every bar, whatever the session inputs say.
  killzoneAlwaysEarned: false,
  // Trade engine
  minScore: 5,
  scoreKillzone: true,
  scoreMa: true,
  scoreMajorAgree: true,
  scoreBreakStrength: true,
  strongBreakMult: 1.0,
  stopBufferMult: 0.25,
  minRiskAtr: 1.0,
  minTargetR: 1.0,
  trailTier: 'Internal', // "Internal" | "Major"
  stopOnCloseOnly: false,
  runnerMode: false,
  trailFromEntry: false,
  longOnly: false,
  // Trade filters
  requireHtfBias: false, // needs opts.htfActive + opts.htfBias (per chart bar 1 / -1 / 0); inactive without them (see header)
  htfBiasTf: '1D',
  requireDisplacement: false,
  dispMult: 1.0,
  fvgMinAtr: 0.3,
  requireConfirmation: false,
  confirmMaxWait: 3,
  requireAvwap: false,
  // Index filter
  requireIndexTrend: false,
  indexMode: 'Auto', // "Auto" | "EGX30" | "EGX70"
  idxRegimeLen: 50,
  idxSlopeLen: 10,
  // Costs
  applyCosts: false,
  slippagePct: 0.1,
  commissionPer: 2.0,
  positionSize: 100000,
  minRiskTicks: 0,
  // Validation split (input.time default "01 Jan 2024 00:00 +0200")
  testStart: Date.parse('2024-01-01T00:00:00+02:00') / 1000,
  // Trailing stop model
  useTrailModel: false,
  trailAtrLength: 14,
  trailAtrMult: 2.0,
  trailLookback: 22,
  trailMinTargetR: 1.0,
  trailRequireTrend: true,
  trailUseScore: false,
  trailMinRiskAtr: 1.0,
  trailUsesOwnStop: true,
  // Confirmations
  scoreMomentum: true,
  momRsi: true,
  momMacd: true,
  momStoch: true,
  macdFast: 12,
  macdSlow: 26,
  macdSignalLen: 9,
  stochLength: 14,
  stochSmoothK: 3,
  stochDLength: 3,
  scoreParticipation: true,
  partVolume: true,
  partClimax: true,
  volLen: 20,
  volMult: 1.5,
  climaxRangeMult: 2.0,
  climaxVolMult: 2.0,
  climaxBars: 3,
  scoreIchimoku: true,
  tenkanLen: 9,
  kijunLen: 26,
  senkouBLen: 52,
  ichiDisp: 26,
  // ---- Discovery-phase candidates (EGX100 failure analysis). ALL OFF by default; defaults leave behaviour unchanged. ----
  // S1: widen the initial stop by k x ATR(structAtrLength) below the zone stop (shorts: above).
  stopExtraAtr: 0,
  // S2: 'Internal' | 'Major' | null. Stop = min(zone stop, newest CONFIRMED swing low of that tier - stopBufferMult x ATR) (shorts mirrored).
  //     Never tighter than the zone stop.
  stopSwingTier: null,
  // (S3 is the existing stopOnCloseOnly.)
  // R1: after an initial-stop exit with no target hit, watch the N bars AFTER the stop bar; re-enter at the close of the first bar that
  //     closes back beyond the old stop; stop = sweep extreme (lowest low since the stop bar) - stopBufferMult x ATR. 0 = off.
  reentryBars: 0,
  // S4 phantom-wick guard: on a bar whose open is within one tick of the previous close AND whose extreme toward the stop (low for longs,
  //     high for shorts) is within one tick of the open (a synthetic-open bar), the stop is tested against the close instead of the extreme.
  phantomGuard: false,
  // Six-stock deep dive (docs/superpowers/plans/2026-11-20-six-stock-deep-dive.md): what closes a trade when an internal CHoCH goes against it.
  //   'on'         : the Pine behaviour - any internal CHoCH against the trade closes it at the bar close ("Invalidated"). Default.
  //   'off'        : no CHoCH exit at all (initial stop / trailing stop / targets only)
  //   'major'      : only a CHoCH on the MAJOR tier (majorLookback pivots) against the trade closes it
  //   'belowEntry' : an internal CHoCH against the trade closes it only if that bar also closes beyond the entry (long: close < entry)
  invalidation: 'on',
  // Sensitivity (not a candidate): scale-free Min Risk floor, risk >= x% of the entry price (applied in addition to minRiskTicks; 0 = off).
  minRiskPct: 0,
  // 2026-11-21 exit tests (docs/superpowers/plans/2026-11-21-egx-daily-exit-tests.md). Both 0 = off.
  // B backup stop: with Stop on Close Only, also exit INTRABAR when price reaches entry -/+ k x initial risk (fixed at entry),
  //   filled at that level or at the open if the bar opens beyond it. Tested before the close-based stop. Reason 'Hard Stop'.
  hardStopR: 0,
  // T time stop: before TP1, once the trade has been open >= N bars, exit at the close of the first bar closing against the
  //   entry (long: close < entry). Reason 'Time'.
  timeStopBars: 0,
  // Entry filters, evaluated at the signal bar (data through that bar's close only). null / 0 / false = off. NaN features fail the filter.
  filtRsiMin: null, filtRsiMax: null,        // RSI(rsiLength) in [min, max]
  filtAdxMin: 0,                             // ADX(14) >= x
  filtAboveSma200: false,                    // close > SMA(200)
  filtIdxAboveSma50: false,                  // EGX30 close > SMA50(EGX30)   (needs indexBars)
  filtRs60Min: null,                         // (close/close[60]-1) - (EGX30/EGX30[60]-1) > x   (needs indexBars)
  filtVolRatioMin: 0,                        // volume / SMA20(volume) >= x
  filtDist20MaxAtr: null,                    // (close - SMA20)/ATR(14) <= x
  filtWeekly30: false,                       // weekly close (partial week = today's close) > SMA(30) of weekly closes
  filtCmfMin: null,                          // CMF(20) > x
  filtMfiMin: null, filtMfiMax: null,        // MFI(14) in [min, max]
  // Port-only: how ta.pivothigh/ta.pivotlow treat ties inside the window.
  //   'strictRight': (TradingView, verified against 36 logged VLMRA trades) ties allowed on the LEFT, the centre must be strictly beyond the right bars
  //   'nonstrict'  : a bar is a pivot unless some bar in the window is STRICTLY beyond it
  //   'strict'     : the centre must be strictly beyond every other bar
  //   'strictLeft' : strictly beyond the left bars, ties allowed on the right
  //   'strictRight': strictly beyond the right bars, ties allowed on the left
  pivotTies: 'strictRight',
});

// Index constituents baked into the Pine script (LIST_DATE 2026-11-01).
export const EGX30_LIST = ',ABUK,ADIB,ALCN,AMOC,BTFH,CLHO,COMI,EAST,EFID,HRHO,EFIH,EGAL,EMFD,FWRY,GBCO,HELI,ISPH,JUFO,MCQE,MFPC,ORAS,ORHD,PHDC,CCAP,RAYA,SKPC,TMGH,ETEL,RMDA,VLMR,VLMRA,';
export const EGX70_LIST = ',ACTF,ATLC,AMER,ARAB,AMIA,AIDC,AIH,ARCC,ASCM,ASPI,AIFI,BONY,COSG,POUL,CSAG,PRCL,CNFN,CIEB,DAPH,DSCW,EGCH,EGTS,PHAR,MPRC,ETRS,EHDR,ELKA,KABO,OBRI,ELSH,ELEC,NIPH,UEGC,SWDY,ENGC,EXPA,ZEOT,GDWA,GOUR,GPIM,HDBK,IEEC,ICFC,ISMQ,IDRE,ISMA,LCSW,MCRO,MASR,MPCO,MEPA,MPCI,MBSC,ATQA,MTIE,NCCW,OFH,OIH,ORWE,PRDC,SIPC,SDTI,SCEM,OCDI,SVCE,TAQA,MOED,VALU,UNIP,ZMID,';

// The two configs the acceptance test uses (daily, Long Only, costs on, 10-tick floor).
export const PRESETS = Object.freeze({
  'tv-base': { longOnly: true, applyCosts: true, minRiskTicks: 10 },
  'tv-r4': { longOnly: true, applyCosts: true, minRiskTicks: 10, runnerMode: true, trailTier: 'Major', trailFromEntry: true },
  // The Pine "Preset: EGX Daily" input: tv-r4 + Stop on Close Only (sweep row 13).
  'egx-daily': { longOnly: true, applyCosts: true, minRiskTicks: 10, runnerMode: true, trailTier: 'Major', trailFromEntry: true, stopOnCloseOnly: true, killzoneAlwaysEarned: true },
  'pine-default': {},
});

// ----------------------------------------------------------------------------------------------
// ta.* helpers over Float64Array (NaN = na)
// ----------------------------------------------------------------------------------------------
function mkNa(n) { return new Float64Array(n).fill(NaN); }

function taSma(src, len) {
  const n = src.length, out = mkNa(n);
  for (let i = len - 1; i < n; i++) {
    let s = 0, bad = false;
    for (let j = i - len + 1; j <= i; j++) { const v = src[j]; if (v !== v) { bad = true; break; } s += v; }
    if (!bad) out[i] = s / len;
  }
  return out;
}
// ta.rma: SMA seed while the previous value is na, then Wilder smoothing.
function taRma(src, len) {
  const n = src.length, out = mkNa(n), seed = taSma(src, len), a = 1 / len;
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? out[i - 1] : NaN;
    out[i] = prev !== prev ? seed[i] : a * src[i] + (1 - a) * prev;
  }
  return out;
}
// ta.ema: seeds with the first source value (na until the source exists).
function taEma(src, len) {
  const n = src.length, out = mkNa(n), a = 2 / (len + 1);
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? out[i - 1] : NaN;
    out[i] = prev !== prev ? src[i] : a * src[i] + (1 - a) * prev;
  }
  return out;
}
function taRsi(src, len) {
  const n = src.length, up = mkNa(n), dn = mkNa(n);
  for (let i = 1; i < n; i++) { const ch = src[i] - src[i - 1]; up[i] = Math.max(ch, 0); dn[i] = -Math.min(ch, 0); }
  const u = taRma(up, len), d = taRma(dn, len), out = mkNa(n);
  for (let i = 0; i < n; i++) out[i] = d[i] === 0 ? 100 : u[i] === 0 ? 0 : 100 - 100 / (1 + u[i] / d[i]);
  return out;
}
function taAtr(high, low, close, len) {
  const n = high.length, tr = mkNa(n);
  for (let i = 0; i < n; i++) {
    tr[i] = i === 0 ? high[i] - low[i]
      : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  return taRma(tr, len);
}
function taHighest(src, len) {
  const n = src.length, out = mkNa(n);
  for (let i = len - 1; i < n; i++) { let m = -Infinity; for (let j = i - len + 1; j <= i; j++) m = Math.max(m, src[j]); out[i] = m; }
  return out;
}
function taLowest(src, len) {
  const n = src.length, out = mkNa(n);
  for (let i = len - 1; i < n; i++) { let m = Infinity; for (let j = i - len + 1; j <= i; j++) m = Math.min(m, src[j]); out[i] = m; }
  return out;
}
// Wilder ADX (ta.dmi(len, len)).
function taAdx(high, low, close, len) {
  const n = high.length, tr = mkNa(n), pdm = mkNa(n), mdm = mkNa(n);
  for (let i = 0; i < n; i++) {
    tr[i] = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i > 0) {
      const up = high[i] - high[i - 1], dn = -(low[i] - low[i - 1]);
      pdm[i] = up > dn && up > 0 ? up : 0; mdm[i] = dn > up && dn > 0 ? dn : 0;
    }
  }
  const trR = taRma(tr, len), pR = taRma(pdm, len), mR = taRma(mdm, len), dx = mkNa(n);
  for (let i = 0; i < n; i++) {
    const p = 100 * pR[i] / trR[i], m = 100 * mR[i] / trR[i], sum = p + m;
    dx[i] = Math.abs(p - m) / (sum === 0 ? 1 : sum);
  }
  const a = taRma(dx, len);
  return Float64Array.from(a, (v) => 100 * v);
}
function taCmf(high, low, close, vol, len) {
  const n = high.length, mfv = mkNa(n), out = mkNa(n);
  for (let i = 0; i < n; i++) {
    const rng = high[i] - low[i];
    mfv[i] = vol[i] !== vol[i] ? NaN : rng > 0 ? ((close[i] - low[i]) - (high[i] - close[i])) / rng * vol[i] : 0;
  }
  for (let i = len - 1; i < n; i++) {
    let a = 0, b = 0, bad = false;
    for (let j = i - len + 1; j <= i; j++) { if (mfv[j] !== mfv[j]) { bad = true; break; } a += mfv[j]; b += vol[j]; }
    if (!bad && b > 0) out[i] = a / b;
  }
  return out;
}
function taMfi(hlc3, vol, len) {
  const n = hlc3.length, out = mkNa(n);
  for (let i = len; i < n; i++) {
    let pos = 0, neg = 0, bad = false;
    for (let j = i - len + 1; j <= i; j++) {
      if (vol[j] !== vol[j]) { bad = true; break; }
      const ch = hlc3[j] - hlc3[j - 1], flow = hlc3[j] * vol[j];
      if (ch > 0) pos += flow; else if (ch < 0) neg += flow;
    }
    if (!bad) out[i] = neg === 0 ? (pos === 0 ? NaN : 100) : 100 - 100 / (1 + pos / neg);
  }
  return out;
}
// Weekly (Sunday-start weeks) SMA(len) of weekly closes as known at each daily bar: the current partial week counts with today's close.
function weeklySma(bars, len) {
  const n = bars.length, out = mkNa(n), wk = [];
  let curId = null;
  for (let i = 0; i < n; i++) {
    const days = Math.floor(Date.parse(bars[i].date + 'T00:00:00Z') / 86400000), id = Math.floor((days + 4) / 7);
    if (id !== curId) { wk.push(bars[i].close); curId = id; } else wk[wk.length - 1] = bars[i].close;
    if (wk.length >= len) { let s = 0; for (let k = wk.length - len; k < wk.length; k++) s += wk[k]; out[i] = s / len; }
  }
  return out;
}
export function taPivots(src, L, isHigh, ties) {
  const n = src.length, out = mkNa(n);
  const strictLeft = ties === 'strict' || ties === 'strictLeft';
  const strictRight = ties === 'strict' || ties === 'strictRight';
  for (let i = 2 * L; i < n; i++) {
    const c = i - L, v = src[c];
    if (v !== v) continue;
    let ok = true;
    for (let j = i - 2 * L; j <= i && ok; j++) {
      if (j === c) continue;
      const w = src[j];
      if (w !== w) { ok = false; break; }
      const strict = j < c ? strictLeft : strictRight;
      const beyond = isHigh ? (strict ? w >= v : w > v) : (strict ? w <= v : w < v);
      if (beyond) ok = false;
    }
    if (ok) out[i] = v;
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// Session matching: time(timeframe.period, session, tz) on a daily bar, evaluated at the bar's
// open time in the session timezone. (On EGX this is always inside the London window, which the
// VLMRA trade log confirms: kz = 1 on every logged trade.)
// ----------------------------------------------------------------------------------------------
const tzCache = new Map();
function minutesOfDay(timeSec, tz) {
  const key = tz + '|' + timeSec;
  let v = tzCache.get(key);
  if (v === undefined) {
    let fmt = tzCache.get('fmt|' + tz);
    if (!fmt) { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); tzCache.set('fmt|' + tz, fmt); }
    const parts = fmt.formatToParts(new Date(timeSec * 1000));
    const h = +parts.find((p) => p.type === 'hour').value, m = +parts.find((p) => p.type === 'minute').value;
    v = h * 60 + m;
    tzCache.set(key, v);
  }
  return v;
}
function inSession(timeSec, session, tz) {
  const m = /^(\d\d)(\d\d)-(\d\d)(\d\d)$/.exec(session);
  if (!m) return false;
  const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4], t = minutesOfDay(timeSec, tz);
  return s <= e ? (t >= s && t < e) : (t >= s || t < e);
}

// ----------------------------------------------------------------------------------------------
// Index regime (request.security of the index, same timeframe, lookahead off)
// ----------------------------------------------------------------------------------------------
function indexSeries(idxBars, len, slope) {
  const close = Float64Array.from(idxBars, (b) => b.close);
  const ma = taSma(close, len);
  const past = mkNa(close.length);
  for (let i = slope; i < close.length; i++) past[i] = ma[i - slope];
  return { dates: idxBars.map((b) => b.date), close, ma, past };
}
// Value of an index series at each chart bar: the last index bar dated on or before the chart bar.
function mergeIndex(bars, s) {
  const n = bars.length, c = mkNa(n), m = mkNa(n), p = mkNa(n);
  let j = -1;
  for (let i = 0; i < n; i++) {
    while (j + 1 < s.dates.length && s.dates[j + 1] <= bars[i].date) j++;
    if (j >= 0) { c[i] = s.close[j]; m[i] = s.ma[j]; p[i] = s.past[j]; }
  }
  return { c, m, p };
}

// ----------------------------------------------------------------------------------------------
// The engine
// ----------------------------------------------------------------------------------------------
// bars:   [{time (unix s), date 'YYYY-MM-DD', open, high, low, close, volume}] ascending
// opts:   { symbol, mintick, indexBars: {EGX30: bars, EGX70: bars},
//           htfBias?: Int8Array (per chart bar: 1 bullish / -1 bearish / 0), htfActive?: boolean (bias timeframe above the chart) }
// Returns { trades, openTrades, cfg, series, events, opens, final }. trades are closed trades only (what the Pine panel counts);
// the rest is render state: per-bar series, BOS/CHoCH events, every trade opened, and the engine state after the last bar.
export function runEngine(bars, userCfg = {}, opts = {}) {
  const cfg = { ...DEFAULTS, ...userCfg };
  const symbol = opts.symbol || '';
  const mintick = opts.mintick ?? 0.01;
  const n = bars.length;
  const O = Float64Array.from(bars, (b) => b.open), H = Float64Array.from(bars, (b) => b.high);
  const L = Float64Array.from(bars, (b) => b.low), C = Float64Array.from(bars, (b) => b.close);
  const V = Float64Array.from(bars, (b) => (b.volume === null || b.volume === undefined ? NaN : b.volume));

  // ---- series ----
  const rsi = taRsi(C, cfg.rsiLength);
  const ma = cfg.maType === 'EMA' ? taEma(C, cfg.maLength) : taSma(C, cfg.maLength);
  const structAtr = taAtr(H, L, C, cfg.structAtrLength);
  const trailAtr = taAtr(H, L, C, cfg.trailAtrLength);
  const emaF = taEma(C, cfg.macdFast), emaS = taEma(C, cfg.macdSlow);
  const macdLine = Float64Array.from(emaF, (v, i) => v - emaS[i]);
  const macdSig = taEma(macdLine, cfg.macdSignalLen);
  const hhS = taHighest(H, cfg.stochLength), llS = taLowest(L, cfg.stochLength);
  const stochRaw = Float64Array.from(C, (v, i) => 100 * (v - llS[i]) / (hhS[i] - llS[i]));
  const stochK = taSma(stochRaw, cfg.stochSmoothK), stochD = taSma(stochK, cfg.stochDLength);
  const volNz = Float64Array.from(V, (v) => (v !== v ? 0 : v));
  const volAvg = taSma(volNz, cfg.volLen);
  const volumeSeen = new Uint8Array(n);
  { let seen = false; for (let i = 0; i < n; i++) { if (V[i] === V[i] && V[i] > 0) seen = true; volumeSeen[i] = seen ? 1 : 0; } }
  const tenH = taHighest(H, cfg.tenkanLen), tenL = taLowest(L, cfg.tenkanLen);
  const kijH = taHighest(H, cfg.kijunLen), kijL = taLowest(L, cfg.kijunLen);
  const sbH = taHighest(H, cfg.senkouBLen), sbL = taLowest(L, cfg.senkouBLen);
  const spanA = Float64Array.from(C, (_, i) => ((tenH[i] + tenL[i]) / 2 + (kijH[i] + kijL[i]) / 2) / 2);
  const spanB = Float64Array.from(C, (_, i) => (sbH[i] + sbL[i]) / 2);
  const majorHighRaw = taPivots(H, cfg.majorLookback, true, cfg.pivotTies);
  const majorLowRaw = taPivots(L, cfg.majorLookback, false, cfg.pivotTies);
  const intHighRaw = taPivots(H, cfg.internalLookback, true, cfg.pivotTies);
  const intLowRaw = taPivots(L, cfg.internalLookback, false, cfg.pivotTies);
  const trailHi = taHighest(C, cfg.trailLookback), trailLo = taLowest(C, cfg.trailLookback);
  const hlc3 = Float64Array.from(C, (v, i) => (H[i] + L[i] + v) / 3);

  // ---- entry-filter / descriptive feature series (all use data through bar i only) ----
  const adx14 = taAdx(H, L, C, 14), sma200 = taSma(C, 200), sma20 = taSma(C, 20);
  const cmf20 = taCmf(H, L, C, V, 20), mfi14 = taMfi(hlc3, V, 14), wsma30 = weeklySma(bars, 30);
  let ixC = null, ixMa50 = null;
  if (opts.indexBars && opts.indexBars.EGX30) { const m = mergeIndex(bars, indexSeries(opts.indexBars.EGX30, 50, 10)); ixC = m.c; ixMa50 = m.m; }
  const featAt = (i) => {
    const rs60 = ixC && i >= 60 ? (C[i] / C[i - 60] - 1) - (ixC[i] / ixC[i - 60] - 1) : NaN;
    return {
      fRsi: rsi[i], fAdx: adx14[i], fSma200Dist: C[i] / sma200[i] - 1,
      fIdxAbove50: ixC ? (ixC[i] > ixMa50[i] ? 1 : ixC[i] <= ixMa50[i] ? 0 : NaN) : NaN,
      fRs60: rs60, fVolRatio: volAvg[i] > 0 && volumeSeen[i] === 1 ? V[i] / volAvg[i] : NaN,
      fDist20Atr: (C[i] - sma20[i]) / structAtr[i], fWeekly30Dist: C[i] / wsma30[i] - 1, fCmf: cmf20[i], fMfi: mfi14[i],
    };
  };
  const filtOn = cfg.filtRsiMin != null || cfg.filtRsiMax != null || cfg.filtAdxMin > 0 || cfg.filtAboveSma200 || cfg.filtIdxAboveSma50
    || cfg.filtRs60Min != null || cfg.filtVolRatioMin > 0 || cfg.filtDist20MaxAtr != null || cfg.filtWeekly30 || cfg.filtCmfMin != null
    || cfg.filtMfiMin != null || cfg.filtMfiMax != null;
  if ((cfg.filtIdxAboveSma50 || cfg.filtRs60Min != null) && !ixC) throw new Error('index filters need indexBars.EGX30');
  // Long-side entry filter (shorts are not filtered; every candidate run is Long Trades Only).
  const filtLongOk = (i) => {
    if (!filtOn) return true;
    const f = featAt(i);
    if (cfg.filtRsiMin != null && !(f.fRsi >= cfg.filtRsiMin)) return false;
    if (cfg.filtRsiMax != null && !(f.fRsi <= cfg.filtRsiMax)) return false;
    if (cfg.filtAdxMin > 0 && !(f.fAdx >= cfg.filtAdxMin)) return false;
    if (cfg.filtAboveSma200 && !(C[i] > sma200[i])) return false;
    if (cfg.filtIdxAboveSma50 && f.fIdxAbove50 !== 1) return false;
    if (cfg.filtRs60Min != null && !(f.fRs60 > cfg.filtRs60Min)) return false;
    if (cfg.filtVolRatioMin > 0 && !(f.fVolRatio >= cfg.filtVolRatioMin)) return false;
    if (cfg.filtDist20MaxAtr != null && !(f.fDist20Atr <= cfg.filtDist20MaxAtr)) return false;
    if (cfg.filtWeekly30 && !(C[i] > wsma30[i])) return false;
    if (cfg.filtCmfMin != null && !(f.fCmf > cfg.filtCmfMin)) return false;
    if (cfg.filtMfiMin != null && !(f.fMfi >= cfg.filtMfiMin)) return false;
    if (cfg.filtMfiMax != null && !(f.fMfi <= cfg.filtMfiMax)) return false;
    return true;
  };

  // ---- killzone (per bar, only if the session is displayed) ----
  const killzoneActive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = bars[i].time;
    const a = (cfg.showLondonKZ && inSession(t, cfg.londonSession, cfg.sessionTimezone))
      || (cfg.showNewYorkKZ && inSession(t, cfg.newYorkSession, cfg.sessionTimezone))
      || (cfg.showAsiaKZ && inSession(t, cfg.asiaSession, cfg.sessionTimezone));
    killzoneActive[i] = a ? 1 : 0;
  }
  const killzonePointOn = cfg.killzoneAlwaysEarned || (cfg.scoreKillzone && (cfg.showLondonKZ || cfg.showNewYorkKZ || cfg.showAsiaKZ));

  // ---- index regime ----
  const indexName = cfg.indexMode !== 'Auto' ? cfg.indexMode
    : (EGX70_LIST.includes(',' + symbol + ',') && !EGX30_LIST.includes(',' + symbol + ',')) ? 'EGX70' : 'EGX30';
  let idxRegime = null; // Int8Array, 2 = na
  if (cfg.requireIndexTrend) {
    const ib = opts.indexBars || {};
    if (!ib.EGX30 || (indexName === 'EGX70' && !ib.EGX70)) throw new Error('requireIndexTrend needs indexBars for ' + indexName + ' (and EGX30 proxy)');
    const m30 = mergeIndex(bars, indexSeries(ib.EGX30, cfg.idxRegimeLen, cfg.idxSlopeLen));
    const mOwn = indexName === 'EGX70' ? mergeIndex(bars, indexSeries(ib.EGX70, cfg.idxRegimeLen, cfg.idxSlopeLen)) : m30;
    idxRegime = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const ownReady = !isNa(mOwn.c[i]) && !isNa(mOwn.m[i]) && !isNa(mOwn.p[i]);
      const useProxy = indexName === 'EGX70' && !ownReady;
      const s = useProxy ? m30 : mOwn;
      const c = s.c[i], m = s.m[i], p = s.p[i];
      idxRegime[i] = (isNa(m) || isNa(p) || isNa(c)) ? 2 : (c > m && m > p) ? 1 : (c < m && m < p) ? -1 : 0;
    }
  }
  const idxLongOkAt = (i) => !cfg.requireIndexTrend || (idxRegime[i] !== 2 && idxRegime[i] !== -1);
  const idxShortOkAt = (i) => !cfg.requireIndexTrend || (idxRegime[i] !== 2 && idxRegime[i] !== 1);

  // ---- HTF bias (Pine htfLongOk / htfShortOk; the bias series itself is computed by the caller) ----
  const htfOn = cfg.requireHtfBias && !!opts.htfActive && !!opts.htfBias;
  const htfLongOk = (i) => !htfOn || opts.htfBias[i] === 1;
  const htfShortOk = (i) => !htfOn || opts.htfBias[i] === -1;

  // ---- state ----
  const mkSt = () => ({ trend: null, lastType: null, lastSide: null, lastStrength: NaN, lastPenetration: NaN, lastLevel: NaN, lastLevelBar: -1, lastBar: -1, bullBreak: false, bearBreak: false });
  const majorHighs = [], majorLows = [], intHighs = [], intLows = [];
  const majorSt = mkSt(), intSt = mkSt();
  const bullFvg = [], bearFvg = [], bullOb = [], bearOb = [];
  const bullTouch = { hit: false, top: NaN, bottom: NaN, tier: null, bar: NaN };
  const bearTouch = { hit: false, top: NaN, bottom: NaN, tier: null, bar: NaN };
  const pend = {
    bull: { active: false, top: NaN, bot: NaN, tier: null, bars: 0, bar: NaN },
    bear: { active: false, top: NaN, bot: NaN, tier: null, bars: 0, bar: NaN },
  };
  let avLoPV = NaN, avLoV = NaN, avHiPV = NaN, avHiV = NaN;
  let trailLongStop = NaN, trailShortStop = NaN, trailDir = 1;
  let pbTrade = null, trTrade = null;
  const trades = [];
  // ---- render outputs (observation only: nothing below reads these back) ----
  const events = [], opens = [];
  const serTrailLong = mkNa(n), serTrailShort = mkNa(n), serTrailDir = new Int8Array(n);
  const serAvwapLow = mkNa(n), serAvwapHigh = mkNa(n), serLongSetup = new Uint8Array(n), serShortSetup = new Uint8Array(n);
  let gate = null;
  const noteOpen = (model, t, i) => opens.push({ bar: i, model, side: t.side });
  const noteBreaks = (st, tier, i) => {
    if (st.bullBreak || st.bearBreak) events.push({ bar: i, tier, type: st.lastType, side: st.lastSide, level: st.lastLevel, levelBar: st.lastLevelBar });
  };

  // ---- structure helpers ----
  const pushPivot = (points, price, bar, atrAtPivot, isHigh) => {
    let cls = null;
    if (points.length > 0) {
      const prev = points[points.length - 1];
      const diff = price - prev.price;
      if (Math.abs(diff) <= cfg.eqTolMult * atrAtPivot) cls = isHigh ? 'EQH' : 'EQL';
      else if (diff > 0) cls = isHigh ? 'HH' : 'HL';
      else cls = isHigh ? 'LH' : 'LL';
    }
    const isLiq = cls === 'EQH' || cls === 'EQL';
    points.push({ price, bar, kind: cls, broken: false, brokenBar: -1, liquidity: isLiq });
    if (points.length > cfg.maxSwings) points.shift();
  };
  const lastUnbrokenIndex = (points) => { for (let k = points.length - 1; k >= 0; k--) if (!points[k].broken) return k; return -1; };
  const markBroken = (points, isHigh, i) => {
    for (const p of points) if (!p.broken && (isHigh ? C[i] > p.price : C[i] < p.price)) { p.broken = true; p.brokenBar = i; }
  };
  const processTier = (st, highs, lows, i) => {
    const hIdx = lastUnbrokenIndex(highs), lIdx = lastUnbrokenIndex(lows);
    let bullBroke = false, bearBroke = false, lvlPrice = NaN, lvlBar = -1;
    if (hIdx >= 0) { const hp = highs[hIdx]; if (C[i] > hp.price) { bullBroke = true; lvlPrice = hp.price; lvlBar = hp.bar; } }
    if (!bullBroke && lIdx >= 0) { const lp = lows[lIdx]; if (C[i] < lp.price) { bearBroke = true; lvlPrice = lp.price; lvlBar = lp.bar; } }
    markBroken(highs, true, i);
    markBroken(lows, false, i);
    if (bullBroke || bearBroke) {
      const newTrend = bullBroke ? 'up' : 'down';
      st.lastType = (st.trend === null || st.trend === newTrend) ? 'BOS' : 'CHoCH';
      st.trend = newTrend;
      st.lastSide = bullBroke ? 'bull' : 'bear';
      st.lastStrength = structAtr[i] > 0 ? Math.abs(C[i] - O[i]) / structAtr[i] : 0.0;
      st.lastPenetration = structAtr[i] > 0 ? Math.abs(C[i] - lvlPrice) / structAtr[i] : 0.0;
      st.lastLevel = lvlPrice; st.lastLevelBar = lvlBar; st.lastBar = i;
      st.bullBreak = bullBroke; st.bearBreak = bearBroke;
    }
  };
  const inRangeNow = (i) => {
    if (majorHighs.length >= 2 && majorLows.length >= 2) {
      const h1 = majorHighs[majorHighs.length - 1], h2 = majorHighs[majorHighs.length - 2];
      const l1 = majorLows[majorLows.length - 1], l2 = majorLows[majorLows.length - 2];
      const top = Math.max(h1.price, h2.price), bottom = Math.min(l1.price, l2.price);
      const oldest = Math.min(h1.bar, h2.bar, l1.bar, l2.bar);
      return (top - bottom) <= cfg.rangeAtrMult * structAtr[i] && (i - oldest) <= cfg.rangeLookbackBars;
    }
    return false;
  };

  // ---- zones ----
  // Newest-to-oldest; the FIRST touched zone fills `t` (if still unset); every touched zone is removed.
  const mitigateZones = (zones, isBullish, t, i) => {
    let any = false;
    for (let k = zones.length - 1; k >= 0; k--) {
      const z = zones[k];
      const touched = isBullish ? L[i] <= z.top : H[i] >= z.bottom;
      if (touched) {
        if (!t.hit) { t.hit = true; t.top = z.top; t.bottom = z.bottom; t.tier = z.tier; t.bar = z.bar; }
        zones.splice(k, 1);
        any = true;
      }
    }
    return any;
  };
  const pruneTier = (zones, tier, maxCount) => {
    let count = 0;
    for (const z of zones) if (z.tier === tier) count++;
    if (count > maxCount && zones.length > 0) {
      for (let k = 0; k < zones.length; k++) if (zones[k].tier === tier) { zones.splice(k, 1); break; }
    }
  };
  const findOppositeCandle = (isBullishBreak, i) => {
    for (let k = 1; k <= cfg.obSearchBars; k++) {
      const j = i - k;
      if (j < 0) continue; // close[k] is na -> both comparisons false
      const down = C[j] < O[j], up = C[j] > O[j];
      if (isBullishBreak && down) return k;
      if (!isBullishBreak && up) return k;
    }
    return -1;
  };

  // ---- scoring ----
  const momEnabledCount = (cfg.momRsi ? 1 : 0) + (cfg.momMacd ? 1 : 0) + (cfg.momStoch ? 1 : 0);
  const momNeed = Math.ceil(momEnabledCount / 2);
  const momOn = cfg.scoreMomentum && momEnabledCount > 0;
  const climaxFound = (isLong, i, volReady) => {
    let found = false;
    for (let k = 0; k <= cfg.climaxBars - 1; k++) {
      const j = i - k;
      const rng = j >= 0 ? H[j] - L[j] : NaN;
      if (rng > 0 && volReady && j >= 0 && !isNa(structAtr[j])) {
        const against = isLong ? C[j] < O[j] : C[j] > O[j];
        const farThird = isLong ? C[j] <= L[j] + rng / 3 : C[j] >= H[j] - rng / 3;
        const bigRange = rng >= cfg.climaxRangeMult * structAtr[j];
        const bigVol = V[j] >= cfg.climaxVolMult * volAvg[j];
        if (against && farThird && bigRange && bigVol) found = true;
      }
    }
    return found;
  };
  // All per-bar confirmation booleans for one side.
  const confirmState = (isLong, i) => {
    const rsiOk = isLong ? rsi[i] > 50 : rsi[i] < 50;
    const macdOk = isLong ? macdLine[i] > macdSig[i] : macdLine[i] < macdSig[i];
    const stochOk = isLong ? stochK[i] > stochD[i] : stochK[i] < stochD[i];
    const maOk = isLong ? C[i] > ma[i] : C[i] < ma[i];
    const momHits = (cfg.momRsi && rsiOk ? 1 : 0) + (cfg.momMacd && macdOk ? 1 : 0) + (cfg.momStoch && stochOk ? 1 : 0);
    const momOk = momHits >= momNeed;
    const volReady = volumeSeen[i] === 1 && !isNa(volAvg[i]) && volAvg[i] > 0;
    const volSurge = volReady && V[i] >= cfg.volMult * volAvg[i];
    const climax = climaxFound(isLong, i, volReady);
    const partVolOn = cfg.partVolume && volReady, partClimaxOn = cfg.partClimax && volReady;
    const partEnabled = (partVolOn ? 1 : 0) + (partClimaxOn ? 1 : 0);
    const partNeed = Math.ceil(partEnabled / 2);
    const partHits = (partVolOn && volSurge ? 1 : 0) + (partClimaxOn && climax ? 1 : 0);
    const partOn = cfg.scoreParticipation && partEnabled > 0;
    const partOk = partHits >= partNeed;
    const cTop = Math.max(i - cfg.ichiDisp >= 0 ? spanA[i - cfg.ichiDisp] : NaN, i - cfg.ichiDisp >= 0 ? spanB[i - cfg.ichiDisp] : NaN);
    const cBot = Math.min(i - cfg.ichiDisp >= 0 ? spanA[i - cfg.ichiDisp] : NaN, i - cfg.ichiDisp >= 0 ? spanB[i - cfg.ichiDisp] : NaN);
    const ichiReady = !isNa(cTop) && !isNa(cBot);
    const ichiOk = ichiReady && (isLong ? C[i] > cTop : C[i] < cBot);
    const ichiOn = cfg.scoreIchimoku && ichiReady;
    const kz = cfg.killzoneAlwaysEarned || killzoneActive[i] === 1;
    const maj = majorSt.trend === intSt.trend && majorSt.trend !== null;
    const brk = !isNa(intSt.lastStrength) && intSt.lastStrength >= cfg.strongBreakMult;
    return { momOk, maOk, partOn, partOk, ichiOn, ichiOk, kz, maj, brk };
  };
  // scoreTally(): [ofPts, got]
  const scoreTally = (cs) => {
    let ofPts = 0, got = 0;
    if (killzonePointOn) { ofPts++; if (cs.kz) got++; }
    if (momOn) { ofPts++; if (cs.momOk) got++; }
    if (cfg.scoreMa) { ofPts++; if (cs.maOk) got++; }
    if (cfg.scoreMajorAgree) { ofPts++; if (cs.maj) got++; }
    if (cfg.scoreBreakStrength) { ofPts++; if (cs.brk) got++; }
    if (cs.partOn) { ofPts++; if (cs.partOk) got++; }
    if (cs.ichiOn) { ofPts++; if (cs.ichiOk) got++; }
    return [ofPts, got];
  };
  const gradeFor = (score, of) => (score * 100 >= 90 * of ? 'A' : score * 100 >= 75 * of ? 'B' : 'C');

  // ---- targets ----
  const scanArray = (pts, isLong, floorPrice, curBest, curLiq, atr) => {
    let bestPrice = curBest, bestLiq = curLiq;
    for (const p of pts) {
      if (p.broken) continue;
      const beyond = isLong ? p.price > floorPrice : p.price < floorPrice;
      if (!beyond) continue;
      const withinTol = !isNa(bestPrice) && Math.abs(p.price - bestPrice) <= cfg.eqTolMult * atr;
      const nearer = isNa(bestPrice) || (isLong ? p.price < bestPrice : p.price > bestPrice);
      const promote = withinTol && p.liquidity && !bestLiq;
      const keepLiq = withinTol && bestLiq && !p.liquidity;
      if ((nearer && !keepLiq) || promote) { bestPrice = p.price; bestLiq = p.liquidity; }
    }
    return [bestPrice, bestLiq];
  };
  const bestBeyond = (isLong, floorPrice, atr) => {
    let bp = NaN, bl = false;
    if (isLong) {
      [bp, bl] = scanArray(majorHighs, true, floorPrice, bp, bl, atr);
      [bp, bl] = scanArray(intHighs, true, floorPrice, bp, bl, atr);
    } else {
      [bp, bl] = scanArray(majorLows, false, floorPrice, bp, bl, atr);
      [bp, bl] = scanArray(intLows, false, floorPrice, bp, bl, atr);
    }
    return [bp, bl];
  };
  const selectTargets = (isLong, entry, risk, floorR, atr) => {
    const prices = [], liqs = [];
    let floorP = isLong ? entry + floorR * risk : entry - floorR * risk;
    for (let k = 1; k <= 3; k++) {
      const [bp, bl] = bestBeyond(isLong, floorP, atr);
      if (!isNa(bp)) {
        prices.push(bp); liqs.push(bl);
        floorP = isLong ? bp + cfg.eqTolMult * atr : bp - cfg.eqTolMult * atr;
      }
    }
    let lastP = prices.length > 0 ? prices[prices.length - 1] : (isLong ? entry + (floorR - 1) * risk : entry - (floorR - 1) * risk);
    for (let k = 1; k <= 3; k++) {
      if (prices.length < 3) { lastP = isLong ? lastP + risk : lastP - risk; prices.push(lastP); liqs.push(false); }
    }
    return { p1: prices[0], p2: prices[1], p3: prices[2], liq1: liqs[0], liq2: liqs[1], liq3: liqs[2] };
  };

  // ---- trade accounting ----
  const legR = (price, entry, rr, isLong) => (rr > 0 ? (isLong ? price - entry : entry - price) / rr : 0.0);
  const legsAt = (t) => (t.runner && t.tpHit > 2 ? 2 : t.tpHit);
  const blendedResultR = (t) => {
    const rr = Math.abs(t.entry - t.initialStop), isLong = t.side === 'long', legs = legsAt(t);
    let total = (3 - legs) * legR(t.closePrice, t.entry, rr, isLong);
    if (legs >= 1) total += legR(t.tp1, t.entry, rr, isLong);
    if (legs >= 2) total += legR(t.tp2, t.entry, rr, isLong);
    if (legs >= 3) total += legR(t.tp3, t.entry, rr, isLong);
    return total / 3.0;
  };
  const costR = (t) => {
    const rr = Math.abs(t.entry - t.initialStop), legs = legsAt(t);
    let cost = 0.0;
    if (cfg.applyCosts && rr > 0) {
      let exitSum = (3 - legs) * t.closePrice;
      if (legs >= 1) exitSum += t.tp1;
      if (legs >= 2) exitSum += t.tp2;
      if (legs >= 3) exitSum += t.tp3;
      const avgExit = exitSum / 3.0;
      const slipR = cfg.slippagePct / 100.0 * (t.entry + avgExit) / rr;
      const orders = 1 + legs + (3 - legs > 0 ? 1 : 0);
      const commR = orders * cfg.commissionPer / ((cfg.positionSize / t.entry) * rr);
      cost = slipR + commR;
    }
    return cost;
  };

  const newestUnbroken = (pts) => { for (let k = pts.length - 1; k >= 0; k--) if (!pts[k].broken) return pts[k].price; return NaN; };
  const trailAnchor = (isLong) => {
    const major = cfg.trailTier === 'Major';
    return isLong ? newestUnbroken(major ? majorLows : intLows) : newestUnbroken(major ? majorHighs : intHighs);
  };

  // One bar of exit processing; returns closed.
  const advanceTrade = (t, i) => {
    if (!t || t.closeReason !== null) return false;
    const isLong = t.side === 'long';
    t.mfe = Math.max(t.mfe, isLong ? H[i] - t.entry : t.entry - L[i]);
    t.mae = Math.max(t.mae, isLong ? t.entry - L[i] : H[i] - t.entry);
    const phantom = cfg.phantomGuard && i > 0 && Math.abs(O[i] - C[i - 1]) <= mintick + 1e-9 && Math.abs((isLong ? L[i] : H[i]) - O[i]) <= mintick + 1e-9;
    const closeTest = cfg.stopOnCloseOnly || phantom;
    if (cfg.hardStopR > 0 && cfg.stopOnCloseOnly) {
      const r0 = Math.abs(t.entry - t.initialStop);
      const lvl = isLong ? t.entry - cfg.hardStopR * r0 : t.entry + cfg.hardStopR * r0;
      if (isLong ? L[i] <= lvl : H[i] >= lvl) {
        t.closePrice = isLong ? Math.min(lvl, O[i]) : Math.max(lvl, O[i]);
        t.closeReason = 'Hard Stop';
        return true;
      }
    }
    const stopHit = closeTest ? (isLong ? C[i] <= t.stop : C[i] >= t.stop) : (isLong ? L[i] <= t.stop : H[i] >= t.stop);
    if (stopHit) {
      t.closePrice = closeTest ? C[i] : (isLong ? Math.min(t.stop, O[i]) : Math.max(t.stop, O[i]));
      t.closeReason = 'Stopped';
      return true;
    }
    if (t.tpHit < 1 && (isLong ? H[i] >= t.tp1 : L[i] <= t.tp1)) {
      t.tpHit = 1;
      if (!cfg.trailFromEntry) t.stop = t.entry;
    }
    if (t.tpHit < 2 && (isLong ? H[i] >= t.tp2 : L[i] <= t.tp2)) t.tpHit = 2;
    if (t.tpHit < 3 && (isLong ? H[i] >= t.tp3 : L[i] <= t.tp3)) t.tpHit = 3;
    if (t.tpHit >= 3 && !t.runner) {
      t.closePrice = t.tp3; t.closeReason = 'Target';
      return true;
    }
    let chochAgainst = isLong ? (intSt.bearBreak && intSt.lastType === 'CHoCH') : (intSt.bullBreak && intSt.lastType === 'CHoCH');
    if (cfg.invalidation !== 'on') {
      if (cfg.invalidation === 'off') chochAgainst = false;
      else if (cfg.invalidation === 'major') chochAgainst = isLong ? (majorSt.bearBreak && majorSt.lastType === 'CHoCH') : (majorSt.bullBreak && majorSt.lastType === 'CHoCH');
      else if (cfg.invalidation === 'belowEntry') chochAgainst = chochAgainst && (isLong ? C[i] < t.entry : C[i] > t.entry);
      else throw new Error('bad invalidation ' + cfg.invalidation);
    }
    if (chochAgainst) {
      t.closePrice = C[i]; t.closeReason = 'Invalidated';
      return true;
    }
    if (cfg.timeStopBars > 0 && t.tpHit < 1 && i - t.openBar >= cfg.timeStopBars && (isLong ? C[i] < t.entry : C[i] > t.entry)) {
      t.closePrice = C[i]; t.closeReason = 'Time';
      return true;
    }
    if (t.chandelier || cfg.trailFromEntry || t.tpHit >= 1) {
      let candidate = NaN;
      if (t.chandelier) candidate = isLong ? trailLongStop : trailShortStop;
      else {
        const anchor = trailAnchor(isLong);
        if (!isNa(anchor)) candidate = isLong ? anchor - cfg.stopBufferMult * structAtr[i] : anchor + cfg.stopBufferMult * structAtr[i];
      }
      if (!isNa(candidate) && (isLong ? candidate > t.stop : candidate < t.stop)) t.stop = candidate;
    }
    return false;
  };

  const recordResult = (t, model, i) => {
    const costs = costR(t);
    const gross = blendedResultR(t);
    const r = gross - costs;
    const rr = Math.abs(t.entry - t.initialStop);
    const period = t.openTime >= cfg.testStart ? 'Test' : bars[i].time >= cfg.testStart ? 'Straddle' : 'Tuning';
    const zone = t.zoneTier === 'NONE' ? '-' : t.zoneTier === 'RE' ? 'RE' : t.zoneTier === '' ? 'FVG' : 'OB-' + t.zoneTier;
    trades.push({
      model, symbol,
      openDate: bars[t.openBar].date, closeDate: bars[i].date,
      openTime: t.openTime, closeTime: bars[i].time,
      openIdx: t.openBar, closeIdx: i,
      side: t.side, grade: t.grade, score: t.score, of: t.scoreOf, zone,
      entry: t.entry, stop: t.initialStop, finalStop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3,
      tpHit: t.tpHit, reason: t.closeReason, exit: t.closePrice,
      r, grossR: gross, costR: costs,
      mfeR: rr > 0 ? t.mfe / rr : 0, maeR: rr > 0 ? t.mae / rr : 0,
      bars: i - t.openBar, riskAtr: structAtr[i] > 0 ? rr / structAtr[i] : 0,
      kz: +t.ptKillzone, mom: +t.ptMomentum, ma: +t.ptMa, maj: +t.ptMajorAgree, brk: +t.ptBreakStrength, part: +t.ptParticipation, ichi: +t.ptIchimoku,
      period, runner: t.runner,
      reentry: t.isReentry, entryAtr: t.entryAtr, zoneBars: t.zoneBars,
      swIntRecent: t.swIntRecent, swMajRecent: t.swMajRecent, swIntNearBeyondStop: t.swIntNearBeyondStop, swMajNearBeyondStop: t.swMajNearBeyondStop,
      ...t.feat,
    });
    return r;
  };

  const pbRiskOk = (risk, i) => {
    let ok = false;
    if (risk > 0 && !isNa(structAtr[i])) ok = risk >= cfg.minRiskAtr * structAtr[i];
    if (ok && cfg.minRiskTicks > 0) ok = risk >= cfg.minRiskTicks * mintick;
    if (ok && cfg.minRiskPct > 0) ok = risk >= cfg.minRiskPct / 100 * C[i];
    return ok;
  };
  const trRiskOk = (risk, i) => {
    let ok = false;
    if (risk > 0 && !isNa(trailAtr[i])) ok = risk >= cfg.trailMinRiskAtr * trailAtr[i];
    if (ok && cfg.minRiskTicks > 0) ok = risk >= cfg.minRiskTicks * mintick;
    return ok;
  };
  const lastPrice = (pts) => (pts.length ? pts[pts.length - 1].price : NaN);
  const nearestBelow = (pts, p) => { let b = NaN; for (const q of pts) if (q.price < p && (isNa(b) || q.price > b)) b = q.price; return b; };
  const nearestAbove = (pts, p) => { let b = NaN; for (const q of pts) if (q.price > p && (isNa(b) || q.price < b)) b = q.price; return b; };
  const mkTrade = (side, grade, score, of, entry, stop, zTop, zBot, tg, i, runner, chandelier, pts, zoneTier, zoneBar = NaN) => ({
    side, grade, score, scoreOf: of, entry, stop, initialStop: stop, zoneTop: zTop, zoneBottom: zBot,
    tp1: tg.p1, tp2: tg.p2, tp3: tg.p3, liq1: tg.liq1, liq2: tg.liq2, liq3: tg.liq3, openBar: i, tpHit: 0, closeReason: null, closePrice: NaN,
    runner, chandelier,
    ptKillzone: pts.kz, ptMomentum: pts.momOk, ptMa: pts.maOk, ptMajorAgree: pts.maj, ptBreakStrength: pts.brk, ptParticipation: pts.partOk, ptIchimoku: pts.ichiOk,
    zoneTier, openTime: bars[i].time, mfe: 0, mae: 0,
    // record-only extras (no effect on trading)
    entryAtr: structAtr[i], zoneBars: i - zoneBar, isReentry: false,
    swIntRecent: side === 'long' ? lastPrice(intLows) : lastPrice(intHighs), swMajRecent: side === 'long' ? lastPrice(majorLows) : lastPrice(majorHighs),
    swIntNearBeyondStop: side === 'long' ? nearestBelow(intLows, stop) : nearestAbove(intHighs, stop),
    swMajNearBeyondStop: side === 'long' ? nearestBelow(majorLows, stop) : nearestAbove(majorHighs, stop),
    feat: featAt(i),
  });

  // S1 / S2 stop widening (both off by default -> returns the zone stop untouched).
  const widenStop = (isLong, st0, i) => {
    let st = st0;
    if (cfg.stopExtraAtr > 0) st = isLong ? st - cfg.stopExtraAtr * structAtr[i] : st + cfg.stopExtraAtr * structAtr[i];
    if (cfg.stopSwingTier) {
      const pts = cfg.stopSwingTier === 'Major' ? (isLong ? majorLows : majorHighs) : (isLong ? intLows : intHighs);
      if (pts.length) {
        const sw = pts[pts.length - 1].price; // newest confirmed pivot of that tier (pivots are pushed only once confirmed)
        const cand = isLong ? sw - cfg.stopBufferMult * structAtr[i] : sw + cfg.stopBufferMult * structAtr[i];
        if (isLong ? cand < st : cand > st) st = cand;
      }
    }
    return st;
  };
  let reWatch = null; // R1 watch after an initial-stop exit

  // ============================ bar loop ============================
  for (let i = 0; i < n; i++) {
    // --- structure ---
    majorSt.bullBreak = false; majorSt.bearBreak = false; intSt.bullBreak = false; intSt.bearBreak = false;
    const atrAt = (lb) => (i - lb >= 0 ? structAtr[i - lb] : NaN);
    if (!isNa(majorHighRaw[i])) pushPivot(majorHighs, majorHighRaw[i], i - cfg.majorLookback, atrAt(cfg.majorLookback), true);
    if (!isNa(majorLowRaw[i])) pushPivot(majorLows, majorLowRaw[i], i - cfg.majorLookback, atrAt(cfg.majorLookback), false);
    if (!isNa(intHighRaw[i])) pushPivot(intHighs, intHighRaw[i], i - cfg.internalLookback, atrAt(cfg.internalLookback), true);
    if (!isNa(intLowRaw[i])) pushPivot(intLows, intLowRaw[i], i - cfg.internalLookback, atrAt(cfg.internalLookback), false);
    processTier(majorSt, majorHighs, majorLows, i);
    processTier(intSt, intHighs, intLows, i);
    noteBreaks(majorSt, 'major', i); noteBreaks(intSt, 'internal', i);
    const inRange = inRangeNow(i);

    // --- zones: mitigation before creation ---
    bullTouch.hit = false; bullTouch.top = NaN; bullTouch.bottom = NaN; bullTouch.tier = null; bullTouch.bar = NaN;
    bearTouch.hit = false; bearTouch.top = NaN; bearTouch.bottom = NaN; bearTouch.tier = null; bearTouch.bar = NaN;
    mitigateZones(bullFvg, true, bullTouch, i);
    mitigateZones(bearFvg, false, bearTouch, i);

    const hi2 = i >= 2 ? H[i - 2] : NaN, lo2 = i >= 2 ? L[i - 2] : NaN;
    const bullFvgDispOk = !cfg.requireDisplacement || (structAtr[i] > 0 && L[i] - hi2 >= cfg.fvgMinAtr * structAtr[i] && C[i - 1] - O[i - 1] >= cfg.dispMult * structAtr[i]);
    const bearFvgDispOk = !cfg.requireDisplacement || (structAtr[i] > 0 && lo2 - H[i] >= cfg.fvgMinAtr * structAtr[i] && O[i - 1] - C[i - 1] >= cfg.dispMult * structAtr[i]);
    if (cfg.showFVG && L[i] > hi2 && bullFvgDispOk) {
      bullFvg.push({ top: L[i], bottom: hi2, tier: '', bar: i, left: i - 2 });
      if (bullFvg.length > cfg.fvgMaxCount) bullFvg.shift();
    }
    if (cfg.showFVG && H[i] < lo2 && bearFvgDispOk) {
      bearFvg.push({ top: lo2, bottom: H[i], tier: '', bar: i, left: i - 2 });
      if (bearFvg.length > cfg.fvgMaxCount) bearFvg.shift();
    }

    mitigateZones(bullOb, true, bullTouch, i);
    mitigateZones(bearOb, false, bearTouch, i);

    // --- touch confirmation ---
    let bullConfirmedNow = false, bearConfirmedNow = false;
    if (cfg.requireConfirmation) {
      const pb = pend.bull;
      if (!pb.active && bullTouch.hit) { pb.active = true; pb.top = bullTouch.top; pb.bot = bullTouch.bottom; pb.tier = bullTouch.tier; pb.bar = bullTouch.bar; pb.bars = 0; }
      else if (pb.active) {
        pb.bars += 1;
        const bullishCandle = C[i] > O[i];
        const invalidated = C[i] < pb.bot - cfg.stopBufferMult * structAtr[i];
        if (invalidated || pb.bars > cfg.confirmMaxWait) pb.active = false;
        else if (bullishCandle) { bullConfirmedNow = true; pb.active = false; }
      }
      const pr = pend.bear;
      if (!pr.active && bearTouch.hit) { pr.active = true; pr.top = bearTouch.top; pr.bot = bearTouch.bottom; pr.tier = bearTouch.tier; pr.bar = bearTouch.bar; pr.bars = 0; }
      else if (pr.active) {
        pr.bars += 1;
        const bearishCandle = C[i] < O[i];
        const invalidated = C[i] > pr.top + cfg.stopBufferMult * structAtr[i];
        if (invalidated || pr.bars > cfg.confirmMaxWait) pr.active = false;
        else if (bearishCandle) { bearConfirmedNow = true; pr.active = false; }
      }
    }
    const effBullHit = cfg.requireConfirmation ? bullConfirmedNow : bullTouch.hit;
    const effBullTop = cfg.requireConfirmation ? pend.bull.top : bullTouch.top;
    const effBullBot = cfg.requireConfirmation ? pend.bull.bot : bullTouch.bottom;
    const effBullTier = cfg.requireConfirmation ? pend.bull.tier : bullTouch.tier;
    const effBullBar = cfg.requireConfirmation ? pend.bull.bar : bullTouch.bar;
    const effBearHit = cfg.requireConfirmation ? bearConfirmedNow : bearTouch.hit;
    const effBearTop = cfg.requireConfirmation ? pend.bear.top : bearTouch.top;
    const effBearBot = cfg.requireConfirmation ? pend.bear.bot : bearTouch.bottom;
    const effBearTier = cfg.requireConfirmation ? pend.bear.tier : bearTouch.tier;
    const effBearBar = cfg.requireConfirmation ? pend.bear.bar : bearTouch.bar;

    // --- order block creation ---
    const obDispOk = !cfg.requireDisplacement || (structAtr[i] > 0 && Math.abs(C[i] - O[i]) >= cfg.dispMult * structAtr[i]);
    if (cfg.showOB && obDispOk && (majorSt.bullBreak || (cfg.showInternalOb && intSt.bullBreak))) {
      const tier = majorSt.bullBreak ? 'MAJOR' : 'INTERNAL';
      const off = findOppositeCandle(true, i);
      if (off >= 0) {
        bullOb.push({ top: H[i - off], bottom: L[i - off], tier, bar: i, left: i - off });
        pruneTier(bullOb, tier, cfg.obMaxCount);
      }
    }
    if (cfg.showOB && obDispOk && (majorSt.bearBreak || (cfg.showInternalOb && intSt.bearBreak))) {
      const tier = majorSt.bearBreak ? 'MAJOR' : 'INTERNAL';
      const off = findOppositeCandle(false, i);
      if (off >= 0) {
        bearOb.push({ top: H[i - off], bottom: L[i - off], tier, bar: i, left: i - off });
        pruneTier(bearOb, tier, cfg.obMaxCount);
      }
    }

    // --- trailing stop model (chandelier) ---
    const trailLongRaw = trailHi[i] - cfg.trailAtrMult * trailAtr[i];
    const trailShortRaw = trailLo[i] + cfg.trailAtrMult * trailAtr[i];
    const trailLongPrev = isNa(trailLongStop) ? trailLongRaw : trailLongStop;
    const trailShortPrev = isNa(trailShortStop) ? trailShortRaw : trailShortStop;
    const cPrev = i > 0 ? C[i - 1] : NaN;
    trailLongStop = cPrev > trailLongPrev ? Math.max(trailLongRaw, trailLongPrev) : trailLongRaw;
    trailShortStop = cPrev < trailShortPrev ? Math.min(trailShortRaw, trailShortPrev) : trailShortRaw;
    const trailDirPrev = trailDir;
    trailDir = (trailDirPrev === -1 && C[i] > trailShortPrev) ? 1 : (trailDirPrev === 1 && C[i] < trailLongPrev) ? -1 : trailDirPrev;
    const trailFlipLong = trailDir === 1 && trailDirPrev === -1;
    const trailFlipShort = trailDir === -1 && trailDirPrev === 1;
    serTrailLong[i] = trailLongStop; serTrailShort[i] = trailShortStop; serTrailDir[i] = trailDir;

    // --- anchored VWAP ---
    const avBarPV = hlc3[i] * volNz[i];
    if (!isNa(majorLowRaw[i])) {
      let s = 0, v = 0;
      for (let k = 0; k <= cfg.majorLookback; k++) { const j = i - k; if (j < 0) { s = NaN; v = NaN; break; } s += hlc3[j] * volNz[j]; v += volNz[j]; }
      avLoPV = s; avLoV = v;
    } else if (!isNa(avLoPV)) { avLoPV += avBarPV; avLoV += volNz[i]; }
    if (!isNa(majorHighRaw[i])) {
      let s = 0, v = 0;
      for (let k = 0; k <= cfg.majorLookback; k++) { const j = i - k; if (j < 0) { s = NaN; v = NaN; break; } s += hlc3[j] * volNz[j]; v += volNz[j]; }
      avHiPV = s; avHiV = v;
    } else if (!isNa(avHiPV)) { avHiPV += avBarPV; avHiV += volNz[i]; }
    const avwapLow = !isNa(avLoV) && avLoV > 0 ? avLoPV / avLoV : NaN;
    const avwapHigh = !isNa(avHiV) && avHiV > 0 ? avHiPV / avHiV : NaN;
    serAvwapLow[i] = avwapLow; serAvwapHigh[i] = avwapHigh;
    const avwapLongOk = !cfg.requireAvwap || (!isNa(avwapLow) && C[i] > avwapLow);
    const avwapShortOk = !cfg.requireAvwap || (!isNa(avwapHigh) && C[i] < avwapHigh);

    // --- gate ---
    const csL = confirmState(true, i), csS = confirmState(false, i);
    const [ofLong, scoreLong] = scoreTally(csL);
    const [ofShort, scoreShort] = scoreTally(csS);
    const bullHardOk = intSt.trend === 'up' && effBullHit && !inRange && htfLongOk(i) && idxLongOkAt(i) && avwapLongOk;
    const bearHardOk = intSt.trend === 'down' && effBearHit && !inRange && htfShortOk(i) && idxShortOkAt(i) && avwapShortOk;
    const longSetup = bullHardOk && scoreLong >= cfg.minScore && filtLongOk(i);
    const shortSetup = bearHardOk && scoreShort >= cfg.minScore;
    serLongSetup[i] = longSetup ? 1 : 0; serShortSetup[i] = shortSetup ? 1 : 0;
    if (i === n - 1) {
      // Pine lines 1075-1089 (gate row) and 2021-2023 (marks): the side follows the internal trend (na falls back to long),
      // and the reason is the FIRST unmet condition in the order the gate applies them. 'bar not closed' is the panel's.
      const gl = intSt.trend !== 'down', cs = gl ? csL : csS;
      const gScore = gl ? scoreLong : scoreShort, gOf = gl ? ofLong : ofShort;
      const reason = intSt.trend === null ? 'no trend' : inRange ? 'in range'
        : !(gl ? htfLongOk(i) : htfShortOk(i)) ? 'htf bias'
        : !(gl ? idxLongOkAt(i) : idxShortOkAt(i)) ? 'index trend'
        : !(gl ? avwapLongOk : avwapShortOk) ? 'anchored vwap'
        : (cfg.requireConfirmation && (gl ? pend.bull.active : pend.bear.active)) ? 'awaiting confirmation'
        : !(gl ? effBullHit : effBearHit) ? 'no zone touch'
        : gScore < cfg.minScore ? 'score short' : 'READY';
      const mark = (on, ok) => (!on ? '–' : ok ? '✓' : '✗');
      gate = { long: gl, score: gScore, of: gOf, reason, marks: { mom: mark(momOn, cs.momOk), part: mark(cs.partOn, cs.partOk), ichi: mark(cs.ichiOn, cs.ichiOk) } };
    }
    let setupScore = 0, setupOf = 0, setupGrade = null;
    if (longSetup) { setupScore = scoreLong; setupOf = ofLong; setupGrade = gradeFor(scoreLong, ofLong); }
    if (shortSetup) { setupScore = scoreShort; setupOf = ofShort; setupGrade = gradeFor(scoreShort, ofShort); }

    // --- exits ---
    const pbClosed = advanceTrade(pbTrade, i);
    const trClosed = advanceTrade(trTrade, i);
    if (pbClosed && cfg.reentryBars > 0 && !pbTrade.isReentry && pbTrade.closeReason === 'Stopped' && pbTrade.tpHit === 0 && pbTrade.stop === pbTrade.initialStop) {
      reWatch = { isLong: pbTrade.side === 'long', oldStop: pbTrade.initialStop, sweep: pbTrade.side === 'long' ? L[i] : H[i], startBar: i, expire: i + cfg.reentryBars };
    }
    if (pbClosed) recordResult(pbTrade, 'PB', i);
    if (trClosed) recordResult(trTrade, 'TR', i);
    // free a slot on the bar AFTER it closed
    if (pbTrade && pbTrade.closeReason !== null && !pbClosed) pbTrade = null;
    if (trTrade && trTrade.closeReason !== null && !trClosed) trTrade = null;

    // --- open: pullback model ---
    if (!pbTrade && longSetup) {
      const zTop = effBullTop, zBot = effBullBot, st = widenStop(true, zBot - cfg.stopBufferMult * structAtr[i], i);
      if (C[i] > st) {
        const risk = C[i] - st;
        if (pbRiskOk(risk, i)) {
          const tg = selectTargets(true, C[i], risk, cfg.minTargetR, structAtr[i]);
          pbTrade = mkTrade('long', setupGrade, setupScore, setupOf, C[i], st, zTop, zBot, tg, i, cfg.runnerMode, false, csL, effBullTier, effBullBar);
          noteOpen('PB', pbTrade, i);
        }
      }
    }
    if (!pbTrade && shortSetup && !cfg.longOnly) {
      const zTop = effBearTop, zBot = effBearBot, st = widenStop(false, zTop + cfg.stopBufferMult * structAtr[i], i);
      if (C[i] < st) {
        const risk = st - C[i];
        if (pbRiskOk(risk, i)) {
          const tg = selectTargets(false, C[i], risk, cfg.minTargetR, structAtr[i]);
          pbTrade = mkTrade('short', setupGrade, setupScore, setupOf, C[i], st, zTop, zBot, tg, i, cfg.runnerMode, false, csS, effBearTier, effBearBar);
          noteOpen('PB', pbTrade, i);
        }
      }
    }

    // --- R1: liquidity-sweep re-entry (only when the regular pullback model did not open a trade on this bar) ---
    if (reWatch) {
      if (pbTrade && pbTrade.openBar === i) reWatch = null; // a regular setup took the slot
      else if (i > reWatch.startBar) {
        const w = reWatch;
        w.sweep = w.isLong ? Math.min(w.sweep, L[i]) : Math.max(w.sweep, H[i]);
        if (i > w.expire) reWatch = null;
        else if (!pbTrade && (w.isLong ? C[i] > w.oldStop : C[i] < w.oldStop) && !(!w.isLong && cfg.longOnly)) {
          const st = w.isLong ? w.sweep - cfg.stopBufferMult * structAtr[i] : w.sweep + cfg.stopBufferMult * structAtr[i];
          const risk = w.isLong ? C[i] - st : st - C[i];
          if (w.isLong ? C[i] > st : C[i] < st) {
            if (pbRiskOk(risk, i)) {
              const tg = selectTargets(w.isLong, C[i], risk, cfg.minTargetR, structAtr[i]);
              const cs = w.isLong ? csL : csS, [of, sc] = scoreTally(cs);
              pbTrade = mkTrade(w.isLong ? 'long' : 'short', gradeFor(sc, of), sc, of, C[i], st, NaN, NaN, tg, i, cfg.runnerMode, false, cs, 'RE');
              pbTrade.isReentry = true;
              noteOpen('PB', pbTrade, i);
            }
          }
          reWatch = null; // one attempt per stop-out
        }
      }
    }

    if (opts.onBar) opts.onBar(i, { inRange, intTrend: intSt.trend, majorTrend: majorSt.trend, trailDir, trailFlipLong, trailFlipShort, trailLongStop, trailShortStop, trailAtr: trailAtr[i], structAtr: structAtr[i], bullTouch, bearTouch, effBullHit, effBearHit, scoreLong, scoreShort, ofLong, ofShort, csL, csS, longSetup, shortSetup, pbTrade, trTrade, majorHighs, majorLows, intHighs, intLows, bullFvg, bullOb, bearFvg, bearOb });
    // --- open: trailing stop model ---
    if (cfg.useTrailModel) {
      const structOk = (isLong) => !cfg.trailRequireTrend || (!inRange && intSt.trend === (isLong ? 'up' : 'down'));
      const trailLongEntry = trailFlipLong && structOk(true) && (!cfg.trailUseScore || scoreLong >= cfg.minScore) && idxLongOkAt(i) && avwapLongOk;
      const trailShortEntry = trailFlipShort && structOk(false) && (!cfg.trailUseScore || scoreShort >= cfg.minScore) && !cfg.longOnly && idxShortOkAt(i) && avwapShortOk;
      if (!trTrade && trailLongEntry) {
        const st = trailLongStop, risk = C[i] - st;
        if (trRiskOk(risk, i)) {
          const tg = selectTargets(true, C[i], risk, cfg.trailMinTargetR, structAtr[i]);
          trTrade = mkTrade('long', gradeFor(scoreLong, ofLong), scoreLong, ofLong, C[i], st, C[i], st, tg, i, cfg.runnerMode, cfg.trailUsesOwnStop, csL, 'NONE');
          noteOpen('TR', trTrade, i);
        }
      }
      if (!trTrade && trailShortEntry) {
        const st = trailShortStop, risk = st - C[i];
        if (trRiskOk(risk, i)) {
          const tg = selectTargets(false, C[i], risk, cfg.trailMinTargetR, structAtr[i]);
          trTrade = mkTrade('short', gradeFor(scoreShort, ofShort), scoreShort, ofShort, C[i], st, st, C[i], tg, i, cfg.runnerMode, cfg.trailUsesOwnStop, csS, 'NONE');
          noteOpen('TR', trTrade, i);
        }
      }
    }
  }

  const openTrades = [pbTrade, trTrade].filter((t) => t && t.closeReason === null);
  const live = (t) => (t && t.closeReason === null ? t : null);
  return {
    trades, openTrades, cfg,
    series: {
      ma, rsi, structAtr, spanA, spanB, killzoneActive: Float64Array.from(killzoneActive),
      trailLong: serTrailLong, trailShort: serTrailShort, trailDir: serTrailDir, avwapLow: serAvwapLow, avwapHigh: serAvwapHigh,
      longSetup: serLongSetup, shortSetup: serShortSetup,
    },
    events, opens,
    final: {
      majorSt, intSt, inRange: n > 0 && inRangeNow(n - 1), majorHighs, majorLows, intHighs, intLows,
      bullFvg, bearFvg, bullOb, bearOb, pbTrade: live(pbTrade), trTrade: live(trTrade), gate,
    },
  };
}

// Summary helper shared by run.mjs and the validation script.
export function summarize(trades, filter = () => true) {
  let n = 0, wins = 0, r = 0;
  for (const t of trades) if (filter(t)) { n++; if (t.r > 0) wins++; r += t.r; }
  return { n, wins, r };
}
