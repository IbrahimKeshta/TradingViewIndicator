// ThndrX chart port: finds the TradingView chart inside ThndrX, reads its bars and history, watches it, and exposes
// the drawing calls the painter needs. Every fact used here comes from the live recon
// (docs/superpowers/plans/2026-11-24-thndrx-recon.md). The logic that does not need the real chart is exported as
// pure functions and tested in chart-port.test.mjs.

const IFRAME_SELECTOR = 'iframe[id^="tradingview_"]';
const POLL_MS = 2000;                                     // tick poll and history settle wait (recon: no tick event)
const HISTORY_FROM = Date.UTC(1990, 0, 1) / 1000;         // before any EGX series; the feed clamps to what it has
export const HISTORY_NOTE = 'History: 5 years (Thndr limit)';
const FEED_YEARS = 5, NOTE_SLACK_SEC = 30 * 86400;
const EXPORT_OPTS = { includeTime: true, includeSeries: true, includedStudies: 'all' };
const EGX_CLOSE_MIN = 14 * 60 + 30;                       // EGX session 10:00-14:30 Africa/Cairo, Sunday to Thursday
const EGX_SESSION_MIN = 270;                              // minutes in that session
const CALENDAR_SLACK = 2, CALENDAR_PAD_DAYS = 10;         // calendar days per session (weekends are 7/5, plus holidays)
export const LOAD_TIMEOUT_MS = 90000;                     // a history load that has not finished by then is given up

const cairoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
// Cairo calendar day (whole days since the epoch of the Cairo date), minutes since Cairo midnight, and the date parts.
function cairoParts(timeSec) {
  const p = {};
  for (const { type, value } of cairoClock.formatToParts(new Date(timeSec * 1000))) p[type] = +value;
  const day = Date.UTC(p.year, p.month - 1, p.day) / 86400000;
  return { y: p.year, mo: p.month, d: p.day, day, minutes: p.hour * 60 + p.minute, dow: new Date(day * 86400000).getUTCDay() };
}
const pad = (n) => String(n).padStart(2, '0');
// Both Cairo offsets (UTC+2 / +3) are whole hours and the clocks change on the hour, so the Cairo date is constant
// within a UTC hour: one Intl call per hour, not per bar (330k one-minute rows took 2.3 s with a call per row).
let memoHour = NaN, memoDate = '';
const cairoDateOf = (timeSec) => {
  const hour = Math.floor(timeSec / 3600);
  if (hour !== memoHour) { const c = cairoParts(hour * 3600); memoHour = hour; memoDate = `${c.y}-${pad(c.mo)}-${pad(c.d)}`; }
  return memoDate;
};
const isWeekend = (dow) => dow === 5 || dow === 6; // Friday and Saturday

// ---- pure parts ----

// exportData -> engine bars. Columns are found by schema: the series' open/high/low/close and the Volume study's
// `Volume` plot (its sourceTitle is localised, the plotTitle is not). Times pass through unchanged (ruling R11);
// rows without a finite close (future rows of offset studies) are not bars.
export function toBars({ schema, data }) {
  const col = {};
  schema.forEach((s, k) => {
    if (s.type === 'time') col.time ??= k;
    else if (s.sourceType === 'series' && ['open', 'high', 'low', 'close'].includes(s.plotTitle)) col[s.plotTitle] ??= k;
    else if (s.sourceType === 'study' && (s.plotTitle === 'Volume' || s.plotId === 'vol')) col.volume ??= k;
  });
  for (const k of ['time', 'open', 'high', 'low', 'close']) if (col[k] === undefined) throw new Error(`exportData has no ${k} column`);
  const volumeMissing = col.volume === undefined;
  const out = [];
  let ascending = true; // the export is normally in time order with one row per time: then no map and no sort
  for (const row of data) {
    const time = row[col.time], close = row[col.close];
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    if (out.length && time <= out[out.length - 1].time) ascending = false;
    out.push({
      time, date: cairoDateOf(time), open: row[col.open], high: row[col.high], low: row[col.low], close,
      volume: volumeMissing ? NaN : row[col.volume],
    });
  }
  if (ascending) return { bars: out, volumeMissing };
  const byTime = new Map();
  for (const b of out) byTime.set(b.time, b); // the last row for a time wins
  return { bars: [...byTime.values()].sort((a, b) => a.time - b.time), volumeMissing };
}

const sameNum = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const sameBar = (a, b) => ['open', 'high', 'low', 'close', 'volume'].every((k) => sameNum(a[k], b[k]));

// Folds a tail read (bars from the last known bar on) into the bars: the last bar updated, newer bars appended.
export function mergeTail(bars, tail) {
  if (!bars.length) return { bars: tail, changed: tail.length > 0 };
  let out = null; // copied on the first change; the caller's array is never mutated
  for (const b of tail) {
    const cur = out ?? bars, last = cur[cur.length - 1];
    if (b.time === last.time && !sameBar(b, last)) out = [...cur.slice(0, -1), b];
    else if (b.time > last.time) (out ??= [...bars]).push(b);
  }
  return { bars: out ?? bars, changed: out !== null };
}

// Whether the last bar is still forming at `now` (unix seconds). Intraday: until its own end or the 14:30 close.
// Daily / weekly / monthly: until 14:30 Cairo of the period's last trading day (Thursday; last Sunday-Thursday of the month).
export function isLastBarOpen(bars, resolution, now) {
  if (!bars.length) return false;
  const t = bars[bars.length - 1].time;
  if (now < t) return true;
  const r = String(resolution).toUpperCase();
  const bar = cairoParts(t), cur = cairoParts(now);
  const before = (day) => cur.day < day || (cur.day === day && cur.minutes < EGX_CLOSE_MIN);
  if (/^\d+$/.test(r)) {
    if (cur.day !== bar.day) return false;
    return now < t + Number(r) * 60 && cur.minutes < EGX_CLOSE_MIN;
  }
  if (r === 'D' || r === '1D') return before(bar.day);
  if (r === 'W' || r === '1W') {
    const sunday = bar.day - bar.dow;
    return cur.day >= sunday && before(sunday + 4);
  }
  if (r === 'M' || r === '1M') {
    let last = Date.UTC(bar.y, bar.mo, 0) / 86400000; // last calendar day of the bar's month
    while (isWeekend(new Date(last * 86400000).getUTCDay())) last--;
    return cur.y === bar.y && cur.mo === bar.mo && before(last);
  }
  return false;
}

export const closedBars = (bars, resolution, now) => (isLastBarOpen(bars, resolution, now) ? bars.slice(0, -1) : bars);

// Where the history request starts. Daily and above: 1990, before any EGX series (the feed clamps to what it has).
// Intraday: only back far enough for the MAX_PLAN_BARS bars the plan uses, so a 1m chart does not pull 5 years
// (about 330k rows) to use 20000: sessions needed at ceil(270 / minutes) bars each, CALENDAR_SLACK calendar days per
// session. When that reaches past the 5-year feed anyway (15m and up), ask from 1990.
export function historyFrom(resolution, now) {
  const r = String(resolution);
  if (!/^\d+$/.test(r) || Number(r) <= 0) return HISTORY_FROM;
  const sessions = Math.ceil(MAX_PLAN_BARS / Math.ceil(EGX_SESSION_MIN / Number(r)));
  const days = sessions * CALENDAR_SLACK + CALENDAR_PAD_DAYS;
  return days > FEED_YEARS * 366 ? HISTORY_FROM : Math.floor(now - days * 86400);
}

// Ruling R12: the panel says the history is cut when the first bar sits on Thndr's 5-year feed limit (within 30 days).
export function historyNote(firstTime, now) {
  if (!Number.isFinite(firstTime)) return null;
  const d = new Date(now * 1000);
  d.setUTCFullYear(d.getUTCFullYear() - FEED_YEARS);
  return Math.abs(firstTime - d.getTime() / 1000) <= NOTE_SLACK_SEC ? HISTORY_NOTE : null;
}

// ---- the chart ----

// The chart iframe and its API right now, or null. Same-origin, but any access can throw while the iframe is torn down.
export function probeChart(win) {
  try {
    const iframe = win.document.querySelector(IFRAME_SELECTOR);
    const api = iframe && iframe.contentWindow && iframe.contentWindow.tradingViewApi;
    const chart = api && api.activeChart();
    return chart ? { api, chart, iframe } : null;
  } catch {
    return null;
  }
}

export function findChart(win, timeoutMs = 60000, pollMs = 500) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const found = probeChart(win);
      if (found) return resolve(found);
      if (Date.now() >= deadline) return reject(new Error(`no ThndrX chart after ${timeoutMs} ms`));
      win.setTimeout(poll, pollMs);
    };
    poll();
  });
}

export function chartInfo(chart) {
  const ext = chart.symbolExt();
  const mintick = ext && ext.pricescale > 0 ? (ext.minmov || 1) / ext.pricescale : 0.01;
  return { symbol: (ext && ext.name) || chart.symbol(), mintick, resolution: chart.resolution() };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readBars = async (chart, from) => toBars(await chart.exportData(from === undefined ? EXPORT_OPTS : { ...EXPORT_OPTS, from }));

// History back to the series start (recon): ask for everything since historyFrom(resolution), re-read every 2 s
// until the first bar stops moving (endOfData() is unreliable), then put the user's view back. complete = the first
// bar settled. cancelled() is checked every round: a cancelled load stops asking and leaves through the same view
// restore. Without a readable view there is nothing to restore, so the load never zooms out and uses what is loaded.
// A load still running after timeoutMs ends as cancelled with timedOut = true and the view restored (a chart that
// stops answering must not block later reloads).
export async function loadAllBars(chart, {
  sleep = wait, maxRounds = 30, now = () => Date.now() / 1000, cancelled = () => false, resolution,
  timeoutMs = LOAD_TIMEOUT_MS, timers = globalThis,
} = {}) {
  let saved = null;
  try { saved = chart.getVisibleRange(); } catch { /* no range yet */ }
  let timedOut = false, restored = false;
  const stop = () => timedOut || cancelled();
  const restore = async () => {
    if (restored || !saved) return;
    restored = true;
    await Promise.resolve().then(() => chart.setVisibleRange(saved)).catch(() => {});
  };
  const from = historyFrom(resolution, now());
  // A failed ask costs a round, not the load: with two overlays loading at once TradingView's setVisibleRange rejects
  // ("Rejected by timeout") or throws ("Value is null") (seen live 2026-11-26); the next round asks again, and a round
  // after a failed ask never counts as settled (nothing new was asked for, so an unchanged first bar proves nothing).
  const ask = () => Promise.resolve().then(() => chart.setVisibleRange({ from, to: Math.floor(now()) })).then(() => true, () => false);

  const run = async () => {
    let read = await readBars(chart), complete = false;
    const out = (wasCancelled) => ({ bars: read.bars, complete, volumeMissing: read.volumeMissing, cancelled: wasCancelled, timedOut });
    if (!saved) return out(false);
    try {
      if (stop()) return out(true);
      let asked = await ask();
      for (let round = 1; round < maxRounds; round++) {
        await sleep(POLL_MS);
        if (stop()) return out(true);
        const next = await readBars(chart);
        const settled = asked && next.bars.length > 0 && read.bars.length > 0 && next.bars[0].time === read.bars[0].time;
        read = next;
        if (settled) { complete = true; break; }
        asked = await ask(); // the feed may hand history over in chunks
      }
    } finally {
      await restore();
    }
    return out(false);
  };

  let handle;
  const deadline = new Promise((resolve) => { handle = timers.setTimeout(() => { timedOut = true; resolve(null); }, timeoutMs); });
  try {
    const res = await Promise.race([run(), deadline]);
    if (res) return res;
  } finally {
    timers.clearTimeout(handle);
  }
  await restore(); // the hung run never got to its own restore; if it resumes, stop() sends it out without asking
  return { bars: [], complete: false, volumeMissing: false, cancelled: true, timedOut: true };
}

// Ruling R20: the plan is computed on the newest MAX_PLAN_BARS bars, so a 1m/5m chart's 5-year feed cannot stall the
// page. The note joins the 5-year feed note (judged on the full history) and the cap note.
export const MAX_PLAN_BARS = 20000;
export const CAP_NOTE = `Computed on the last ${MAX_PLAN_BARS} bars`;

// The time the plan window starts at, fixed when the history loads (I1): render-plan keys carry bar indices, so a
// window that slid by one bar on every new bar would give every drawing a new key and redraw them all.
export const windowStart = (bars, max = MAX_PLAN_BARS) => (bars.length > max ? bars[bars.length - max].time : -Infinity);

// The bars from `start` on; new bars only lengthen the window until the next load pins a new start.
export function planWindow(bars, now, start = windowStart(bars)) {
  const notes = [historyNote(bars.length ? bars[0].time : undefined, now)];
  let lo = 0, hi = bars.length; // first bar at or after start (bars are sorted by time)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].time < start) lo = mid + 1; else hi = mid; }
  if (lo > 0) notes.push(CAP_NOTE);
  return { bars: lo > 0 ? bars.slice(lo) : bars, note: notes.filter(Boolean).join(' · ') || null };
}

// Min low / max high in one loop: spreading 150k+ bars into Math.min/max overflows the call stack.
export function priceRange(bars) {
  if (!bars.length) return { priceLow: null, priceHigh: null };
  let priceLow = Infinity, priceHigh = -Infinity;
  for (const b of bars) { if (b.low < priceLow) priceLow = b.low; if (b.high > priceHigh) priceHigh = b.high; }
  return { priceLow, priceHigh };
}

// Two overlays (ICT and Session Order Flow) share one chart: a history load zooms the chart out and puts the user's
// view back, so two loads at once would restore each other's zoom. Loads queue on a promise kept on the chart frame.
export function withHistoryLock(frameWin, fn) {
  const holder = frameWin || {};
  const prev = holder.__thndrxHistoryLock || Promise.resolve();
  const run = prev.then(fn, fn);
  holder.__thndrxHistoryLock = run.then(() => {}, () => {});
  return run;
}

// Bars from `fromTime` on (all bars when omitted): the cheap live read the tick poll uses.
export const readTail = (chart, fromTime) => readBars(chart, fromTime);

// Symbol and interval changes reload; there is no tick event, so the last bar is polled every 2 s.
export function subscribe(chart, { onReload, onTick }, timers = globalThis) {
  const offs = [];
  for (const name of ['onSymbolChanged', 'onIntervalChanged']) {
    try {
      const ev = chart[name]();
      ev.subscribe(null, onReload);
      offs.push(() => ev.unsubscribe(null, onReload));
    } catch { /* event missing on this build: the tick poll still notices the change */ }
  }
  const handle = timers.setInterval(onTick, POLL_MS);
  return () => {
    timers.clearInterval(handle);
    for (const off of offs) { try { off(); } catch { /* chart already gone */ } }
  };
}

export function makePort(chart) {
  return {
    createShape: (point, options) => chart.createShape(point, options),
    createMultipointShape: (points, options) => chart.createMultipointShape(points, options),
    removeEntity: (id, options) => chart.removeEntity(id, options),
  };
}
