// EGX Daily dashboard server. Local only (127.0.0.1:8787), no dependencies.
//
//   tools\dashboard\start.cmd                                     (Windows: sets PATH, starts, opens the browser)
//   node --experimental-websocket tools/dashboard/server.mjs      [--data DIR] [--log FILE] [--out FILE] [--port N]
//
// During the EGX session (Sun-Thu 10:00-14:35 Cairo) it refreshes every 5 minutes, and on "Refresh now": it fetches the
// last 30 daily bars of every stock, merges them IN MEMORY onto the history on disk, and runs the EGX Daily preset twice,
// with today's forming bar treated as closed and without it. The difference is the provisional view: what the close
// would do if prices held. Outside the session it refreshes every 30 minutes.
//
// Nothing provisional is written anywhere. The only disk writes are the ones the CLI already makes: full downloads
// (fetch-egx.mjs, then an unfinished last bar is trimmed off every CSV) and the end-of-day scan (forward log and
// latest.md, through scan-core.mjs exactly as scan-egx.mjs does). The end-of-day scan runs when the newest finished
// session (a bar dated today counts from 15:00 Cairo) is newer than the log's last update.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSymbol, loadMeta, loadIndexBars } from '../backtest/data.mjs';
import { parseArgs } from '../backtest/egx100-common.mjs';
import {
  EGX_CFG, UNIVERSE, cairoParts, isBarFinished, dropUnfinished, runUniverse, newLog, updateLog, renderLatest, forwardRecord, trimUnfinishedCsvs, resultPct, openPct,
} from '../backtest/scan-core.mjs';
import { fetchTail as feedTail, mergeTail } from './live-feed.mjs';
import { provisional, openRows, dayByDay, evaluate } from './state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const FEED_NOTE = 'TradingView public feed, may be delayed';
export const SESSION_START = 10 * 60, SESSION_END = 14 * 60 + 35;
const CONCURRENCY = 4, TAIL_BARS = 30;

// Full download through the existing fetcher, then trim a bar that has not closed off every CSV it wrote.
export function defaultFullFetch(dataDir, symbols, now = () => new Date()) {
  const argv = ['--experimental-websocket', path.join(root, 'tools/backtest/fetch-egx.mjs'), dataDir];
  if (symbols && symbols.length) argv.push(symbols.join(','));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, argv, { env: { ...process.env, ADJ: 'dividends' }, maxBuffer: 64 * 1024 * 1024 }, (err) => {
      if (err) { reject(err); return; }
      trimUnfinishedCsvs(dataDir, now());
      resolve();
    });
  });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

export function createDashboard({
  dataDir = path.join(root, 'data/egx-div'), logFile = path.join(root, 'forward/egx-daily-log.json'), outFile = path.join(root, 'forward/latest.md'),
  now = () => new Date(), fetchTail = feedTail, fullFetch = (syms) => defaultFullFetch(dataDir, syms, now), universe = UNIVERSE, trail = true,
} = {}) {
  const cfg = EGX_CFG(trail);
  let meta, symbols, missing, disk, diskIndex;
  const load = () => {
    meta = loadMeta(dataDir);
    // A stock whose last download failed keeps its CSV: it stays in (reported stale) so its logged trades are not
    // mistaken for vanished ones.
    symbols = universe.filter((s) => fs.existsSync(path.join(dataDir, s + '.csv')));
    missing = universe.filter((s) => !symbols.includes(s));
    disk = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dataDir)]));
    diskIndex = loadIndexBars(dataDir);
  };
  load();

  // null when there is no log yet; throws when the file cannot be parsed (never overwrite a log that cannot be read).
  const readLog = () => (fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : null);
  const tryLog = () => { try { return { ok: true, log: readLog() }; } catch (e) { return { ok: false, log: null, error: 'forward log unreadable: ' + String(e.message || e) }; } };
  let live = null;          // { bars, index, errors, withRun, withoutRun, at }
  let eodRunning = null;
  let inflight = null, phase = null, lastError = null, eodError = null;

  const tvSym = (k, fallback) => meta[k]?.tvSymbol || fallback;

  // Fetch tails and merge. Stocks whose history was re-adjusted (or has a gap) get a full download of their own.
  async function pullTails() {
    const bars = {}, errors = {}, refetch = [];
    const index = { ...diskIndex };
    phase = 'fetching prices';
    await pool(symbols, CONCURRENCY, async (s) => {
      try {
        const m = mergeTail(disk[s], await fetchTail(tvSym(s, 'EGX:' + s), TAIL_BARS));
        if (m.readjusted || m.gap) { refetch.push(s); bars[s] = disk[s]; } else bars[s] = m.bars;
      } catch (e) { errors[s] = String(e.message || e); bars[s] = disk[s]; }
    });
    for (const [k, key] of [['EGX30', '_EGX30'], ['EGX70', '_EGX70EWI']]) {
      if (!diskIndex[k] || !meta[key]?.tvSymbol) continue;
      try { const m = mergeTail(diskIndex[k], await fetchTail(meta[key].tvSymbol, TAIL_BARS)); if (!m.readjusted && !m.gap) index[k] = m.bars; }
      catch (e) { errors[key] = String(e.message || e); }
    }
    if (refetch.length) {
      phase = `re-downloading ${refetch.join(', ')} (history re-adjusted)`;
      try {
        await fullFetch(refetch);
        load();
        for (const s of refetch) {
          if (!disk[s]) continue;
          try { bars[s] = mergeTail(disk[s], await fetchTail(tvSym(s, 'EGX:' + s), TAIL_BARS)).bars; delete errors[s]; }
          catch (e) { errors[s] = String(e.message || e); bars[s] = disk[s]; }
        }
      } catch (e) { for (const s of refetch) errors[s] = 'full download failed: ' + String(e.message || e); }
    }
    return { bars, index, errors };
  }

  function compute({ bars, index, errors }) {
    const t = now();
    const finishedBars = Object.fromEntries(Object.entries(bars).map(([s, b]) => [s, dropUnfinished(b, t)]));
    const finishedIndex = Object.fromEntries(Object.entries(index).map(([k, b]) => [k, dropUnfinished(b, t)]));
    const withRun = runUniverse(bars, meta, index, cfg);
    const withoutRun = runUniverse(finishedBars, meta, finishedIndex, cfg);
    live = { bars, index, errors, withRun, withoutRun, at: t.toISOString() };
  }

  function refresh() {
    if (inflight) return inflight;
    if (eodRunning) return eodRunning;   // the end-of-day run refreshes when it ends; never fetch alongside its download
    inflight = (async () => {
      try { compute(await pullTails()); lastError = null; }
      catch (e) { lastError = String(e.message || e); }
      finally { phase = null; inflight = null; }
    })();
    return inflight;
  }

  // Newest session with a finished bar, from the merged data.
  const finishedSession = () => (live ? Object.values(live.withoutRun.lastDate).sort().pop() : Object.values(disk).map((b) => b.length && b[b.length - 1].date).filter(Boolean).sort().pop());
  const needsEndOfDay = () => { const { ok, log } = tryLog(); const fin = finishedSession(); return ok && !!fin && (!log || !log.updated || log.updated < fin); };

  function endOfDay() {
    if (eodRunning) return eodRunning;
    eodRunning = (async () => {
      try {
        phase = 'downloading full history (end of day)';
        await fullFetch(null);
        load();
        const t = now();
        const barsBySym = Object.fromEntries(symbols.map((s) => [s, dropUnfinished(disk[s], t)]));
        const index = Object.fromEntries(Object.entries(diskIndex).map(([k, b]) => [k, dropUnfinished(b, t)]));
        const { closedAll, openAll, lastDate } = runUniverse(barsBySym, meta, index, cfg);
        const session = Object.values(lastDate).sort().pop();
        if (!symbols.length || !session) throw new Error('no data to scan on disk');
        const stale = symbols.filter((s) => lastDate[s] < session);
        const log = readLog() || newLog(session);
        updateLog(log, closedAll, openAll, session);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, JSON.stringify(log, null, 1) + '\n');
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, renderLatest({ session, symbols, stale, missing, lastDate, closedAll, openAll, log, trail }) + '\n');
        eodError = null;
      } catch (e) { eodError = 'end-of-day scan failed: ' + String(e.message || e); }
      finally { phase = null; eodRunning = null; }
      await refresh();
    })();
    return eodRunning;
  }

  function state() {
    const t = now(), c = cairoParts(t);
    const { log, error: logError } = tryLog();
    const error = [eodError, lastError, logError].filter(Boolean).join(' · ') || null;
    if (!live) return { mode: 'starting', phase: phase || 'loading', today: c.date, cairoTime: c.minutes, feedNote: FEED_NOTE, refreshing: true, error };
    const { withRun, withoutRun, bars, errors } = live;
    const liveSession = Object.values(withRun.lastDate).sort().pop();
    const finSession = Object.values(withoutRun.lastDate).sort().pop();
    if (!finSession) return { mode: 'nodata', phase, today: c.date, cairoTime: c.minutes, feedNote: FEED_NOTE, missing, refreshing: !!(inflight || eodRunning), error: error || 'no data on disk yet: run tools/backtest/scan-egx.mjs once' };
    const forming = liveSession === c.date && !isBarFinished(c.date, t);
    const mode = forming ? 'live' : log && log.updated === finSession ? 'final' : 'pending';
    const prov = forming ? provisional(withRun, withoutRun, c.date) : { exits: [], entries: [], targets: [] };
    const exitKeys = new Set(prov.exits.map((x) => `${x.symbol}|${x.openDate}|${x.model}`));
    const tgtKeys = new Map(prov.targets.map((x) => [`${x.symbol}|${x.openDate}|${x.model}`, x]));
    // Open trades as of the last close, priced at the live last price.
    const open = openRows(withoutRun.openAll.map((o) => {
      const b = bars[o.symbol], close = b[b.length - 1].close, risk = Math.abs(o.entry - o.stop);
      const k = `${o.symbol}|${o.openDate}|${o.model}`;
      return { ...o, close, lastDate: b[b.length - 1].date, openR: risk > 0 ? (o.side === 'long' ? close - o.entry : o.entry - close) / risk : 0, wouldExit: exitKeys.has(k), wouldHit: tgtKeys.get(k)?.to ?? null };
    }));
    const markLogged = (x) => ({ ...x, resultPct: resultPct(x), logged: !!log?.trades?.[`${x.symbol}|${x.openDate}|${x.model}`] });
    const sessionDates = [...new Set(Object.values(bars).flatMap((b) => b.map((x) => x.date)))].filter((d) => d <= finSession);
    const staleRows = [
      ...Object.entries(errors).map(([symbol, error]) => ({ symbol, error })),
      ...symbols.filter((s) => !errors[s] && meta[s]?.error).map((s) => ({ symbol: s, error: `download failed: ${meta[s].error}` })),
      ...symbols.filter((s) => !errors[s] && !meta[s]?.error && withRun.lastDate[s] < liveSession).map((s) => ({ symbol: s, error: `last bar ${withRun.lastDate[s]}` })),
    ];
    return {
      mode, phase, today: c.date, cairoTime: c.minutes, liveSession, session: finSession, asOf: live.at, feedNote: FEED_NOTE,
      provisional: { ...prov, exits: prov.exits.map(withPct) },
      open,
      final: { session: finSession, entries: [...withoutRun.closedAll, ...withoutRun.openAll].filter((x) => x.openDate === finSession), exits: withoutRun.closedAll.filter((x) => x.closeDate === finSession).map(withPct) },
      // Trades in the forward log (the out-of-sample record) are marked logged.
      days: dayByDay(withoutRun.closedAll, withoutRun.openAll, sessionDates, 60).map((d) => ({
        ...d, entries: d.entries.map(markLogged), exits: d.exits.map(markLogged),
      })),
      evaluation: evaluate(withoutRun.closedAll, withoutRun.openAll, finSession, symbols),
      forward: log ? { start: log.start, updated: log.updated, ...forwardRecord(log) } : null,
      stale: staleRows, missing, refreshing: !!(inflight || eodRunning), error,
    };
  }

  function stock(sym) {
    if (!live || !symbols.includes(sym)) return null;
    const { withoutRun } = live;
    return {
      symbol: sym,
      closed: withoutRun.closedAll.filter((t) => t.symbol === sym).sort((a, b) => (a.openDate < b.openDate ? 1 : -1)).map(withPct),
      open: withoutRun.openAll.filter((t) => t.symbol === sym).map((t) => ({ ...t, openPct: openPct(t) })),
    };
  }

  // Scheduler step, called every minute by the server. Returns what it started (for logs and tests).
  let lastTick = 0;
  async function tick() {
    const t = now(), c = cairoParts(t);
    const inSession = c.weekday <= 4 && c.minutes >= SESSION_START && c.minutes <= SESSION_END;
    const every = (inSession ? 5 : 30) * 60000;
    if (!inflight && !eodRunning && t - lastTick >= every) { lastTick = +t; await refresh(); if (needsEndOfDay()) { await endOfDay(); return 'refresh+eod'; } return 'refresh'; }
    return null;
  }

  return { refresh, endOfDay, state, stock, tick, needsEndOfDay };
}

// A closed trade with its result in % of entry (see resultPct).
const withPct = (t) => ({ ...t, resultPct: resultPct(t) });

export function serve(dash, port) {
  const page = path.join(here, 'public', 'index.html');
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    try { route(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { error: String(e.message || e) }); else res.end(); }
  });
  const route = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(fs.readFileSync(page)); return; }
    if (req.method === 'GET' && url.pathname === '/api/state') { json(res, 200, dash.state()); return; }
    const m = url.pathname.match(/^\/api\/stock\/([A-Z0-9_]+)$/);
    if (req.method === 'GET' && m) { const s = dash.stock(m[1]); json(res, s ? 200 : 404, s || { error: 'unknown stock' }); return; }
    if (req.method === 'POST' && url.pathname === '/api/refresh') { dash.refresh().then(() => { if (dash.needsEndOfDay()) dash.endOfDay(); }); json(res, 202, { started: true }); return; }
    json(res, 404, { error: 'not found' });
  };
  server.listen(port, '127.0.0.1', () => console.log(`EGX Daily dashboard: http://127.0.0.1:${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs();
  const dash = createDashboard({
    dataDir: path.resolve(root, args.data || 'data/egx-div'),
    logFile: path.resolve(root, args.log || 'forward/egx-daily-log.json'),
    outFile: path.resolve(root, args.out || 'forward/latest.md'),
    trail: !args['no-trail'],
  });
  serve(dash, +(args.port || 8787));
  const run = () => dash.tick().then((did) => did && console.log(new Date().toISOString(), did, dash.state().error || '')).catch((e) => console.error(e));
  run();
  setInterval(run, 60000);
}
