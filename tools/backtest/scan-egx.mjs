// EGX Daily scanner + forward log.
//
// Runs the ICT engine with the EGX Daily preset (the Pine "Preset: EGX Daily") over every EGX stock and reports, for the
// latest session: new entries, trades closed, and every trade still open with its current stop and targets. It also keeps
// an append-only forward log of every trade opened on or after the forward start (2026-11-21), which is the only clean
// out-of-sample test of the preset left: all earlier EGX history was used to choose it.
//
//   export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"
//   node --experimental-websocket tools/backtest/scan-egx.mjs                 # refresh data, scan, update the log
//   node tools/backtest/scan-egx.mjs --no-fetch                               # scan the data already on disk
//
// Options: --data DIR (default data/egx-div, dividend-adjusted = what TradingView charts show and what the port matches)
//          --log FILE (default forward/egx-daily-log.json)   --out FILE (default forward/latest.md)
//          --start YYYY-MM-DD (forward start, default 2026-11-21; only used when the log is created)
//
// The log is append-only on purpose. A trade is written the first time it is seen and never rewritten; a close is added
// once. The engine recomputes from full history on every run, and dividend adjustment rescales old prices, so prices in
// the log are as seen on that day. If a recomputed trade no longer matches what was logged (risk differs by more than 1%
// of entry, or the trade vanished), the entry is flagged, not edited.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runEngine, PRESETS, EGX30_LIST, EGX70_LIST } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { parseArgs } from './egx100-common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = parseArgs();
const dataDir = path.resolve(root, args.data || 'data/egx-div');
const logFile = path.resolve(root, args.log || 'forward/egx-daily-log.json');
const outFile = path.resolve(root, args.out || 'forward/latest.md');
const PRESET = 'egx-daily';

// ---- 1. refresh data ----
if (!args['no-fetch']) {
  console.error(`fetching dividend-adjusted daily bars into ${path.relative(root, dataDir)} ...`);
  execFileSync(process.execPath, ['--experimental-websocket', path.join(here, 'fetch-egx.mjs'), dataDir], {
    env: { ...process.env, ADJ: 'dividends' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
}

// ---- 2. run the engine ----
const meta = loadMeta(dataDir);
const indexBars = loadIndexBars(dataDir);
const universe = [...new Set([...EGX30_LIST.split(','), ...EGX70_LIST.split(',')].filter(Boolean))].sort();
const symbols = universe.filter((s) => fs.existsSync(path.join(dataDir, s + '.csv')) && !meta[s]?.error);
const missing = universe.filter((s) => !symbols.includes(s));

const lastDate = {}, lastClose = {};
const closedAll = [], openAll = [];
for (const s of symbols) {
  const bars = loadSymbol(s, dataDir);
  if (!bars.length) continue;
  lastDate[s] = bars[bars.length - 1].date;
  lastClose[s] = bars[bars.length - 1].close;
  const res = runEngine(bars, PRESETS[PRESET], { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
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
const session = Object.values(lastDate).sort().pop();
const stale = symbols.filter((s) => lastDate[s] < session);

// ---- 3. forward log ----
const key = (sym, openDate) => `${sym}|${openDate}`;
const riskPct = (entry, stop) => Math.abs(entry - stop) / entry;
let log;
if (fs.existsSync(logFile)) log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
else log = { preset: PRESET, data: 'TradingView daily, dividend-adjusted', start: args.start || '2026-11-21', created: session, trades: {} };
const start = log.start;

const seen = new Set();
const upsert = (sym, t, closed) => {
  const k = key(sym, t.openDate);
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
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, JSON.stringify(log, null, 1) + '\n');

// ---- 4. report ----
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const sgn = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '-');
const L = [];
L.push(`# EGX Daily scan: session ${session}`);
L.push('');
L.push(`Preset \`${PRESET}\` (Stop on Close Only, Runner, Trailing Tier Major, Trail From Entry, Long Trades Only, costs on, Min Risk 10 ticks) over ${symbols.length} stocks, dividend-adjusted daily bars.`);
if (stale.length) L.push(`Stale (last bar before ${session}): ${stale.map((s) => `${s} ${lastDate[s]}`).join(', ')}.`);
if (missing.length) L.push(`No data: ${missing.join(', ')}.`);
L.push('');
L.push('Entries happen at the close of the signal bar, so a "new entry" below is a trade the indicator opened at this session\'s close. R is net of costs.');
L.push('With Stop on Close Only, "Stop now" is hit only by a daily CLOSE at or below it, not by an intraday wick. The trade also exits at the close on an internal CHoCH against it ("Invalidated").');
L.push('');

const newOpen = openAll.filter((t) => t.openDate === session);
L.push(`## New entries this session (${newOpen.length})`);
L.push('');
if (newOpen.length) {
  L.push('| Stock | Entry | Stop | Risk % | TP1 | TP2 | TP3 | Grade |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const t of newOpen) L.push(`| ${t.symbol} | ${f(t.entry, 3)} | ${f(t.stop, 3)} | ${f(100 * riskPct(t.entry, t.stop), 1)} | ${f(t.tp1, 3)} | ${f(t.tp2, 3)} | ${f(t.tp3, 3)} | ${t.grade} |`);
} else L.push('None.');
L.push('');

const closedNow = closedAll.filter((t) => t.closeDate === session);
L.push(`## Closed this session (${closedNow.length})`);
L.push('');
if (closedNow.length) {
  L.push('| Stock | Opened | Reason | Exit | Targets hit | R |');
  L.push('|---|---|---|---|---|---|');
  for (const t of closedNow) L.push(`| ${t.symbol} | ${t.openDate} | ${t.reason} | ${f(t.exit, 3)} | ${t.tpHit} | ${sgn(t.r)} |`);
} else L.push('None.');
L.push('');

L.push(`## Open trades (${openAll.length})`);
L.push('');
if (openAll.length) {
  L.push('| Stock | Opened | Bars | Entry | Stop now | Next target | Targets hit | Last close | Open R |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  const next = (t) => (t.tpHit < 1 ? t.tp1 : t.tpHit < 2 ? t.tp2 : t.tpHit < 3 ? t.tp3 : NaN);
  for (const t of [...openAll].sort((a, b) => (a.openDate < b.openDate ? 1 : -1)))
    L.push(`| ${t.symbol} | ${t.openDate} | ${t.bars} | ${f(t.entry, 3)} | ${f(t.curStop, 3)} | ${t.tpHit >= 3 ? 'runner' : f(next(t), 3)} | ${t.tpHit} | ${f(t.close, 3)} | ${sgn(t.openR)} |`);
}
L.push('');

const fw = Object.values(log.trades);
const fc = fw.filter((e) => e.status === 'closed');
const fr = fc.reduce((a, e) => a + e.r, 0);
L.push(`## Forward record since ${start}`);
L.push('');
L.push(`The out-of-sample test of the preset. Trades opened on or after ${start}, as logged on the day they were seen.`);
L.push('');
L.push(`- Closed: ${fc.length}, wins (R > 0): ${fc.filter((e) => e.r > 0).length}, total ${sgn(fr)}R, average ${fc.length ? sgn(fr / fc.length, 3) : '-'}R per trade`);
L.push(`- Still open: ${fw.filter((e) => e.status === 'open').length}`);
const flagged = fw.filter((e) => e.revised || e.vanished);
if (flagged.length) L.push(`- Flagged (data revised after logging): ${flagged.map((e) => `${e.symbol} ${e.openDate}${e.vanished ? ' vanished' : ' revised'}`).join(', ')}`);
L.push('- For reference, the in-sample average on 100 stocks over full history was +0.48R per trade (42.5% wins). Expect a few dozen closed trades before the forward average means much.');
L.push('');

const text = L.join('\n');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, text + '\n');
console.log(text);
