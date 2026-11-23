// Trade-by-trade comparison against a TradingView Pine Logs export (logTrades CSV, "Date,Message").
//   node compare-log.mjs --log path/to/log.csv --symbol VLMRA --cfg '{...}' [--cut date] [--ties mode]
// Keys on the open DATE (daily bars); tools/thndrx/parity.mjs keys on the full open time for intraday.
import fs from 'node:fs';
import { runEngine, PRESETS } from './ict-engine.mjs';
import path from 'node:path';
import { loadSymbol, loadMeta, cutBars, DATA_DIR } from './data.mjs';
import { parseTradeLog, portTrade, diffTrades } from './pine-log.mjs';
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
const sym = args.symbol;
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const cfg = { ...(args.preset ? PRESETS[args.preset] : {}), ...(args.cfg ? JSON.parse(args.cfg) : {}) };
if (args.ties) cfg.pivotTies = args.ties;
const tv = parseTradeLog(fs.readFileSync(args.log, 'utf8'), { dateOnly: true });
const bars = cutBars(loadSymbol(sym, dir), { endDate: args.cut });
const res = runEngine(bars, cfg, { symbol: sym, mintick: loadMeta(dir)[sym]?.mintick ?? 0.01 });
const mine = res.trades.map((t) => portTrade(t, t.openDate, t.closeDate));
diffTrades(tv, mine);
