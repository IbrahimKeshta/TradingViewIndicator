// Higher-time-frame bias for the ThndrX overlay, built from the chart's own bars (ThndrX offers no request.security).
// Port of the Pine htfBiasCalc + `htfBiasCalc(htfSwingLen)[1]` with lookahead_on: every chart bar reads the value
// of the last CLOSED higher-time-frame bar. Grouping is done in Africa/Cairo time, weeks start on Sunday (EGX).

import { taPivots } from '../backtest/ict-engine.mjs';

const cairo = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

const SESSION_OPEN_MIN = 10 * 60; // EGX opens 10:00 Africa/Cairo

export function tfSeconds(tf) {
  const s = String(tf).toUpperCase();
  if (s === 'D' || s === '1D') return 86400;
  if (s === 'W' || s === '1W') return 604800;
  if (s === 'M' || s === '1M') return 2592000;
  const m = Number(s);
  if (Number.isInteger(m) && m > 0) return m * 60;
  throw new Error(`unsupported timeframe: ${tf}`);
}

// Cairo calendar parts of a unix-seconds time: { y, mo, d, minutes (since Cairo midnight), days (whole days since epoch of the Cairo date) }.
function cairoParts(timeSec) {
  const p = {};
  for (const { type, value } of cairo.formatToParts(new Date(timeSec * 1000))) p[type] = +value;
  return { y: p.year, mo: p.month, d: p.day, minutes: p.hour * 60 + p.minute, days: Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000) };
}

// Group key of one bar for the HTF; bars of the same HTF period share the key.
function periodKey(timeSec, htfTf) {
  const secs = tfSeconds(htfTf);
  const c = cairoParts(timeSec);
  if (secs >= 2592000) return `${c.y}-${c.mo}`;
  if (secs >= 604800) return Math.floor((c.days + 4) / 7); // epoch day 0 is a Thursday, so +4 puts Sunday at the start of a week
  if (secs >= 86400) return c.days;
  // Intraday buckets are anchored to the session open (EGX 10:00 Cairo), as TradingView does; bars before the open share one bucket.
  const sinceOpen = c.minutes - SESSION_OPEN_MIN;
  return `${c.days}|${sinceOpen < 0 ? -1 : Math.floor(sinceOpen / (secs / 60))}`;
}

export function resampleBars(bars, htfTf) {
  const htfBars = [], map = new Int32Array(bars.length);
  let key = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], k = periodKey(b.time, htfTf);
    if (htfBars.length === 0 || k !== key) {
      key = k;
      htfBars.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
    } else {
      const h = htfBars[htfBars.length - 1];
      if (b.high > h.high) h.high = b.high;
      if (b.low < h.low) h.low = b.low;
      h.close = b.close;
      h.volume += b.volume ?? 0;
    }
    map[i] = htfBars.length - 1;
  }
  return { htfBars, map };
}

// Pine htfBiasCalc(len) over a bar series: 1 after a close through the latest confirmed swing high, -1 after a close
// through the latest swing low, 0 before either; a broken level is consumed.
function htfBiasCalc(htfBars, len) {
  const n = htfBars.length;
  const ph = taPivots(htfBars.map((b) => b.high), len, true, 'strictRight');
  const pl = taPivots(htfBars.map((b) => b.low), len, false, 'strictRight');
  const out = new Int8Array(n);
  let lvlHigh = NaN, lvlLow = NaN, bias = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(ph[i])) lvlHigh = ph[i];
    if (!Number.isNaN(pl[i])) lvlLow = pl[i];
    const close = htfBars[i].close;
    if (!Number.isNaN(lvlHigh) && close > lvlHigh) { bias = 1; lvlHigh = NaN; }
    if (!Number.isNaN(lvlLow) && close < lvlLow) { bias = -1; lvlLow = NaN; }
    out[i] = bias;
  }
  return out;
}

export function htfBiasSeries(bars, { htfBiasTf, htfSwingLen }, chartTf) {
  const active = tfSeconds(htfBiasTf) > tfSeconds(chartTf);
  const bias = new Int8Array(bars.length);
  if (!active || bars.length === 0) return { bias, active };
  const { htfBars, map } = resampleBars(bars, htfBiasTf);
  const calc = htfBiasCalc(htfBars, htfSwingLen);
  for (let i = 0; i < bars.length; i++) bias[i] = map[i] < 1 ? 0 : calc[map[i] - 1];
  return { bias, active };
}
