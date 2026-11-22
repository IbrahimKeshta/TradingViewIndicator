// Scanner core shared by the scan-egx.mjs CLI and the dashboard (tools/dashboard). Pure functions over bars already in
// memory: running the EGX Daily preset over the universe, updating the append-only forward log, and rendering latest.md.
//
// The closed-session guard lives here too. A bar dated today (Cairo) is still forming until the session is over; it
// counts as finished only from 15:00 Cairo (EGX closes at 14:30, plus time for the feed to settle). Anything that writes
// the forward log must drop an unfinished last bar first, or a trade seen on a bar that has not closed gets logged.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS, EGX30_LIST, EGX70_LIST } from './ict-engine.mjs';

export const PRESET = 'egx-daily';
export const FINISHED_MINUTES = 15 * 60;
// The trailing-stop entry model runs in its own slot and never changes the pullback trades, so including it only adds
// rows (labelled TR).
export const EGX_CFG = (trail = true) => ({ ...PRESETS[PRESET], useTrailModel: trail });
export const UNIVERSE = [...new Set([...EGX30_LIST.split(','), ...EGX70_LIST.split(',')].filter(Boolean))].sort();

const cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function cairoParts(now) {
  const p = Object.fromEntries(cairoFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, weekday: WD[p.weekday] };
}

export function isBarFinished(barDate, now) {
  const c = cairoParts(now);
  return barDate < c.date || (barDate === c.date && c.minutes >= FINISHED_MINUTES);
}

export function dropUnfinished(bars, now) {
  if (!bars.length || isBarFinished(bars[bars.length - 1].date, now)) return bars;
  return bars.slice(0, -1);
}

// barsBySym: { SYM: bars[] } (loadCsv shape). Returns every closed trade (full history) and every open trade, plus the
// last bar date and close per stock.
export function runUniverse(barsBySym, meta, indexBars, cfg) {
  const lastDate = {}, lastClose = {};
  const closedAll = [], openAll = [];
  for (const [s, bars] of Object.entries(barsBySym)) {
    if (!bars.length) continue;
    lastDate[s] = bars[bars.length - 1].date;
    lastClose[s] = bars[bars.length - 1].close;
    const res = runEngine(bars, cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
    for (const t of res.trades) closedAll.push(t);
    for (const t of res.openTrades) {
      const risk = Math.abs(t.entry - t.initialStop);
      openAll.push({
        symbol: s, side: t.side, model: t.chandelier ? 'TR' : 'PB', openDate: bars[t.openBar].date, bars: bars.length - 1 - t.openBar,
        entry: t.entry, stop: t.initialStop, curStop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3, tpHit: t.tpHit,
        close: lastClose[s], openR: risk > 0 ? (t.side === 'long' ? lastClose[s] - t.entry : t.entry - lastClose[s]) / risk : 0,
        grade: t.grade, zone: t.zoneTier,
      });
    }
  }
  return { closedAll, openAll, lastDate, lastClose };
}

export const tradeKey = (sym, openDate, model) => `${sym}|${openDate}|${model}`;
// A closed trade's result in % of the entry price: R (blended over the TP1/TP2/TP3 scale-outs, net of costs) times the
// initial risk as a % of entry. null when R is not a number.
export const resultPct = (t) => (Number.isFinite(t.r) && t.entry > 0 ? 100 * t.r * Math.abs(t.entry - t.stop) / t.entry : null);
// An open trade's price move from entry to the last close, in %, signed so that a gain is positive for either side.
export const openPct = (t) => (t.entry > 0 ? 100 * (t.side === 'short' ? -1 : 1) * (t.close - t.entry) / t.entry : null);
export const riskPct = (entry, stop) => Math.abs(entry - stop) / entry;

export function newLog(session, start = '2026-11-21') {
  return { preset: PRESET, data: 'TradingView daily, dividend-adjusted', start, created: session, trades: {} };
}

// Append-only update of the forward log (see scan-egx.mjs). Mutates and returns log.
export function updateLog(log, closedAll, openAll, session) {
  const start = log.start;
  const seen = new Set();
  const upsert = (sym, t, closed) => {
    const k = tradeKey(sym, t.openDate, t.model);
    seen.add(k);
    let e = log.trades[k];
    if (!e) {
      e = log.trades[k] = {
        symbol: sym, side: t.side, model: t.model, openDate: t.openDate, firstSeen: session,
        entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3, status: 'open',
      };
    } else if (Math.abs(riskPct(e.entry, e.stop) - riskPct(t.entry, t.stop)) > 0.01 && !e.revised) {
      e.revised = { on: session, entry: t.entry, stop: t.stop };
    }
    if (closed && e.status === 'open') {
      Object.assign(e, { status: 'closed', closeDate: t.closeDate, closedSeen: session, reason: t.reason, exit: t.exit, tpHit: t.tpHit, r: +t.r.toFixed(4) });
    } else if (!closed && e.status === 'open') {
      e.lastSeen = session; e.tpHit = t.tpHit; e.curStop = t.curStop; e.openR = +t.openR.toFixed(3);
    }
  };
  for (const t of closedAll) if (t.openDate >= start) upsert(t.symbol, t, true);
  for (const t of openAll) if (t.openDate >= start) upsert(t.symbol, t, false);
  for (const [k, e] of Object.entries(log.trades)) if (!seen.has(k) && e.status === 'open' && !e.vanished) e.vanished = session;
  log.updated = session;
  log.lastRun = new Date().toISOString();
  return log;
}

export const REF = { PB: '+0.51R per trade, 43.6% wins (2,299 trades)', TR: '+0.35R per trade, 46.2% wins (1,926 trades)' };

// Forward record per model, from the log.
export function forwardRecord(log) {
  const fw = Object.values(log.trades);
  const out = {};
  for (const m of ['PB', 'TR']) {
    const mine = fw.filter((e) => e.model === m);
    const fc = mine.filter((e) => e.status === 'closed');
    const total = fc.reduce((a, e) => a + e.r, 0);
    out[m] = { closed: fc.length, wins: fc.filter((e) => e.r > 0).length, totalR: total, avgR: fc.length ? total / fc.length : null, open: mine.filter((e) => e.status === 'open').length, any: mine.length, ref: REF[m] };
  }
  out.flagged = fw.filter((e) => e.revised || e.vanished).map((e) => ({ symbol: e.symbol, model: e.model, openDate: e.openDate, flag: e.vanished ? 'vanished' : 'revised' }));
  return out;
}

export const byModel = (a, b) => (a.model === b.model ? 0 : a.model === 'PB' ? -1 : 1);

export function renderLatest({ session, symbols, stale, missing, lastDate, closedAll, openAll, log, trail }) {
  const start = log.start;
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
  const sgn = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '-');
  const L = [];
  L.push(`# EGX Daily scan: session ${session}`);
  L.push('');
  L.push(`Preset \`${PRESET}\` (Stop on Close Only, Runner, Trailing Tier Major, Trail From Entry, Long Trades Only, costs on, Min Risk 10 ticks, Score: Killzone on) over ${symbols.length} stocks, dividend-adjusted daily bars.`);
  L.push(trail
    ? 'Models: **PB** = pullback model (the tested preset). **TR** = trailing-stop model (Enable Trailing Stop Model on the chart); it has its own slot and never changes the PB trades. Run with `--no-trail` for PB only.'
    : 'Model: PB (pullback) only; the trailing-stop model is excluded (`--no-trail`).');
  if (stale.length) L.push(`Stale (last bar before ${session}): ${stale.map((s) => `${s} ${lastDate[s]}`).join(', ')}.`);
  if (missing.length) L.push(`No data: ${missing.join(', ')}.`);
  L.push('');
  L.push('Entries happen at the close of the signal bar, so a "new entry" below is a trade the indicator opened at this session\'s close. R is net of costs.');
  L.push('Result % is R times the risk % at entry (net of costs, partial exits included). Open % is the price move from entry to the last close.');
  L.push('With Stop on Close Only, "Stop now" is hit only by a daily CLOSE at or below it, not by an intraday wick. A PB trade also exits at the close on an internal CHoCH against it ("Invalidated").');
  L.push('');

  const newOpen = openAll.filter((t) => t.openDate === session).sort(byModel);
  L.push(`## New entries this session (${newOpen.length})`);
  L.push('');
  if (newOpen.length) {
    L.push('| Stock | Model | Entry | Stop | Risk % | TP1 | TP2 | TP3 | Grade |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const t of newOpen) L.push(`| ${t.symbol} | ${t.model} | ${f(t.entry, 3)} | ${f(t.stop, 3)} | ${f(100 * riskPct(t.entry, t.stop), 1)} | ${f(t.tp1, 3)} | ${f(t.tp2, 3)} | ${f(t.tp3, 3)} | ${t.grade} |`);
  } else L.push('None.');
  L.push('');

  const closedNow = closedAll.filter((t) => t.closeDate === session).sort(byModel);
  L.push(`## Closed this session (${closedNow.length})`);
  L.push('');
  if (closedNow.length) {
    L.push('| Stock | Model | Opened | Reason | Exit | Targets hit | R | Result % |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const t of closedNow) L.push(`| ${t.symbol} | ${t.model} | ${t.openDate} | ${t.reason} | ${f(t.exit, 3)} | ${t.tpHit} | ${sgn(t.r)} | ${sgn(resultPct(t), 1)} |`);
  } else L.push('None.');
  L.push('');

  L.push(`## Open trades (${openAll.length})`);
  L.push('');
  if (openAll.length) {
    L.push('| Stock | Model | Opened | Bars | Entry | Stop now | Next target | Targets hit | Last close | Open R | Open % |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const t of [...openAll].sort((a, b) => byModel(a, b) || (a.openDate < b.openDate ? 1 : -1)))
      L.push(`| ${t.symbol} | ${t.model} | ${t.openDate} | ${t.bars} | ${f(t.entry, 3)} | ${f(t.curStop, 3)} | ${t.tpHit >= 3 ? 'runner' : f(nextTarget(t), 3)} | ${t.tpHit} | ${f(t.close, 3)} | ${sgn(t.openR)} | ${sgn(openPct(t), 1)} |`);
  }
  L.push('');

  const rec = forwardRecord(log);
  L.push(`## Forward record since ${start}`);
  L.push('');
  L.push(`The out-of-sample test. Trades opened on or after ${start}, as logged on the day they were seen. Each model is judged on its own.`);
  L.push('');
  for (const m of ['PB', 'TR']) {
    const x = rec[m];
    if (m === 'TR' && !trail && !x.any) continue;
    L.push(`- **${m}**: closed ${x.closed}, wins (R > 0) ${x.wins}, total ${sgn(x.totalR)}R, average ${x.closed ? sgn(x.avgR, 3) + 'R' : '-'} per trade; still open ${x.open}. In-sample reference: ${x.ref}.`);
  }
  if (rec.flagged.length) L.push(`- Flagged (data revised after logging): ${rec.flagged.map((e) => `${e.symbol} ${e.model} ${e.openDate} ${e.flag}`).join(', ')}`);
  L.push('- In-sample references are full history on these 100 stocks, dividend-adjusted. Expect a few dozen closed trades per model before a forward average means much.');
  L.push('');
  return L.join('\n');
}

export const nextTarget = (t) => (t.tpHit < 1 ? t.tp1 : t.tpHit < 2 ? t.tp2 : t.tpHit < 3 ? t.tp3 : NaN);

// After a full download during the session the CSVs end in today's forming bar. Trim it so nothing on disk is
// provisional (a later --no-fetch run on another day would otherwise take a partial bar as final). Returns the number
// of files trimmed. The date is the last CSV column (fetch-egx.mjs format).
export function trimUnfinishedCsvs(dir, now) {
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
    const file = path.join(dir, f);
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
    if (lines.length < 2) continue;
    const date = lines[lines.length - 1].split(',').pop();
    if (isBarFinished(date, now)) continue;
    fs.writeFileSync(file, lines.slice(0, -1).join('\n') + '\n');
    n++;
  }
  return n;
}
