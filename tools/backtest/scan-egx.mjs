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
//
// The scanning, log and report logic lives in scan-core.mjs, shared with the dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { parseArgs } from './egx100-common.mjs';
import { EGX_CFG, UNIVERSE, dropUnfinished, runUniverse, newLog, updateLog, renderLatest } from './scan-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = parseArgs();
const dataDir = path.resolve(root, args.data || 'data/egx-div');
const logFile = path.resolve(root, args.log || 'forward/egx-daily-log.json');
const outFile = path.resolve(root, args.out || 'forward/latest.md');
// --no-trail scans the pullback model alone (see EGX_CFG).
const TRAIL = !args['no-trail'];
const CFG = EGX_CFG(TRAIL);

// ---- 1. refresh data ----
if (!args['no-fetch']) {
  console.error(`fetching dividend-adjusted daily bars into ${path.relative(root, dataDir)} ...`);
  execFileSync(process.execPath, ['--experimental-websocket', path.join(here, 'fetch-egx.mjs'), dataDir], {
    env: { ...process.env, ADJ: 'dividends' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
}

// ---- 2. run the engine ----
// A bar dated today is dropped until the session is over (15:00 Cairo), so a run during the session never logs a trade
// from a bar that has not closed. The dashboard (tools/dashboard) is the place for the "if it closed now" view.
const now = new Date();
const meta = loadMeta(dataDir);
const indexBars = loadIndexBars(dataDir);
for (const k of Object.keys(indexBars)) indexBars[k] = dropUnfinished(indexBars[k], now);
const symbols = UNIVERSE.filter((s) => fs.existsSync(path.join(dataDir, s + '.csv')) && !meta[s]?.error);
const missing = UNIVERSE.filter((s) => !symbols.includes(s));
const barsBySym = {};
for (const s of symbols) barsBySym[s] = dropUnfinished(loadSymbol(s, dataDir), now);
const { closedAll, openAll, lastDate } = runUniverse(barsBySym, meta, indexBars, CFG);
const session = Object.values(lastDate).sort().pop();
const stale = symbols.filter((s) => lastDate[s] < session);

// ---- 3. forward log ----
const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : newLog(session, args.start || '2026-11-21');
updateLog(log, closedAll, openAll, session);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, JSON.stringify(log, null, 1) + '\n');

// ---- 4. report ----
const text = renderLatest({ session, symbols, stale, missing, lastDate, closedAll, openAll, log, trail: TRAIL });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, text + '\n');
console.log(text);
