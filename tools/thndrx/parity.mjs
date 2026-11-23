// Parity check of the ThndrX render plan against the Pine indicator on TradingView.
//   node tools/thndrx/parity.mjs --data <dir> --symbol <SYM> --tf <tf> [--resolution <tf>] [--preset 'EGX Daily']
//                                [--values '<json>'] [--log <pine-log.csv>]
// Prints the info-panel rows (`cell0 | cell1`) and the number of drawing items per kind. With --log it diffs the
// engine's closed trades against a Pine "Log Closed Trades" export, keyed on model|open time|side (full time of day,
// formatted as Pine does in Africa/Cairo, so intraday trades on the same day stay distinct).
// --tf names the data (informational and the default resolution); --resolution is what the plan treats the chart as.
import fs from 'node:fs';
import path from 'node:path';
import { loadCsv, loadMeta } from '../backtest/data.mjs';
import { parseTradeLog, portTrade, diffTrades, formatCairoTime } from '../backtest/pine-log.mjs';
import { defaultValues } from './inputs.mjs';
import { buildRenderPlan, runPlanEngine } from './render-plan.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
for (const k of ['data', 'symbol', 'tf']) if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }

const dir = path.resolve(args.data);
const sym = args.symbol;
const resolution = args.resolution || args.tf;
const bars = loadCsv(path.join(dir, sym + '.csv'));
const mintick = loadMeta(dir)[sym]?.mintick ?? 0.01;
const values = { ...defaultValues(), ...(args.preset ? { presetInput: args.preset } : {}), ...(args.values ? JSON.parse(args.values) : {}) };
const ctx = { symbol: sym, mintick, resolution, lastBarOpen: false };

const plan = buildRenderPlan(bars, values, ctx);
console.log(`${sym} ${args.tf} (resolution ${resolution}) bars=${bars.length} ${bars[0]?.date}..${bars[bars.length - 1]?.date} preset=${values.presetInput}`);
// The engine run the plan itself uses (HTF filter included), so the trades below are the plan's trades.
const run = runPlanEngine(bars, values, ctx);
for (const w of run.warnings) console.log('WARNING', w);
console.log('--- panel ---');
for (const row of plan.panel.rows) console.log(row.cells.map((c) => c.text).join(' | '));
console.log('--- items ---');
console.log(['boxes', 'lines', 'labels', 'series', 'fills', 'markers', 'bands'].map((k) => `${k}=${plan[k].length}`).join(' '));

if (args.log) {
  const tv = parseTradeLog(fs.readFileSync(args.log, 'utf8'));
  const mine = run.res.trades.map((t) => portTrade(t, formatCairoTime(t.openTime), formatCairoTime(t.closeTime)));
  console.log('--- trades ---');
  diffTrades(tv, mine);
}
