// EGX100 settings sweep: baseline vs ONE change at a time (plus four "stop on close + X" combos), all 99 stocks, full history.
//
//   node tools/backtest/sweep.mjs --data data/egx --out docs/superpowers/plans/2026-11-20-egx100-settings-sweep.md [--json file.json]
//
// Base = preset tv-base (daily, long only, Apply Costs 0.1%/side + 2 per order, position 100,000, Min Risk 10 ticks, rest defaults).
// Per closed trade: net return % = net R x |entry - initial stop| / entry x 100 (same formula as validate-picks.mjs; net of costs,
// blends the thirds). Win = net return > 0. Money figures are percent of position, one trade = full notional.
// Max drawdown = peak-to-trough of the cumulative SUM of trade returns (%), trades ordered by exit date (not compounded, trades overlap).
// Trades still open at the end of the data are not counted. Choosing the best row is in-sample.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { DISC_END, parseArgs, fmt } from './egx100-common.mjs';

const args = parseArgs();
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();
const bars = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)]));

// [id, label, override, change description, Pine input name, in Pine today?]
const CONFIGS = [
  [1, 'Baseline', {}],
  [2, 'Stop on Close Only', { stopOnCloseOnly: true }],
  [3, 'Stop under newest internal swing low', { stopSwingTier: 'Internal' }],
  [4, 'Stop +0.5 ATR', { stopExtraAtr: 0.5 }],
  [5, 'Stop +1 ATR', { stopExtraAtr: 1 }],
  [6, 'Runner set "r4"', { runnerMode: true, trailTier: 'Major', trailFromEntry: true }],
  [7, 'Require Confirmation', { requireConfirmation: true }],
  [8, 'Require Index Trend', { requireIndexTrend: true }],
  [9, 'Minimum Score 4', { minScore: 4 }],
  [10, 'Minimum Score 6', { minScore: 6 }],
  [11, 'Trail entry model on (pullback + trail)', { useTrailModel: true }],
  [12, 'Volume ratio >= 0.8', { filtVolRatioMin: 0.8 }],
  [13, 'Stop on Close + r4', { stopOnCloseOnly: true, runnerMode: true, trailTier: 'Major', trailFromEntry: true }],
  [14, 'Stop on Close + Require Index Trend', { stopOnCloseOnly: true, requireIndexTrend: true }],
  [15, 'Stop on Close + Require Confirmation', { stopOnCloseOnly: true, requireConfirmation: true }],
  [16, 'Stop on Close + swing-low stop', { stopOnCloseOnly: true, stopSwingTier: 'Internal' }],
];

const retPct = (t) => (t.entry > 0 ? t.r * (Math.abs(t.entry - t.stop) / t.entry) * 100 : NaN);

function stats(trades) {
  let n = 0, wins = 0, gp = 0, gl = 0, rsum = 0, rk = 0;
  const per = new Map(), cnt = new Map();
  for (const t of trades) {
    const x = t.ret;
    if (!Number.isFinite(x)) continue;
    n++; rsum += t.r; rk += (Math.abs(t.entry - t.stop) / t.entry) * 100;
    if (x > 0) { wins++; gp += x; } else gl += x;
    per.set(t.symbol, (per.get(t.symbol) || 0) + x); cnt.set(t.symbol, (cnt.get(t.symbol) || 0) + 1);
  }
  const net = gp + gl;
  let charts = 0, pos = 0;
  for (const [s, c] of cnt) if (c >= 5) { charts++; if (per.get(s) > 0) pos++; }
  const sorted = trades.filter((t) => Number.isFinite(t.ret)).sort((a, b) => (a.closeDate < b.closeDate ? -1 : a.closeDate > b.closeDate ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.closeIdx - b.closeIdx));
  let cum = 0, peak = 0, dd = 0;
  for (const t of sorted) { cum += t.ret; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  return {
    n, wins, losses: n - wins, win: n ? (100 * wins) / n : NaN, gp, gl, net, avg: n ? net / n : NaN,
    avgWin: wins ? gp / wins : NaN, avgLoss: n - wins ? gl / (n - wins) : NaN, pf: gl < 0 ? gp / -gl : NaN, dd, avgR: n ? rsum / n : NaN, avgRisk: n ? rk / n : NaN,
    charts, chartsPos: pos, chartsPosPct: charts ? (100 * pos) / charts : NaN,
  };
}

const results = [];
for (const [id, label, o] of CONFIGS) {
  const cfg = { ...PRESETS['tv-base'], ...o };
  const trades = [];
  let open = 0;
  for (const s of symbols) {
    const res = runEngine(bars[s], cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
    for (const t of res.trades) { t.ret = retPct(t); trades.push(t); }
    open += res.openTrades.length;
  }
  const pre = trades.filter((t) => t.openDate < DISC_END), post = trades.filter((t) => t.openDate >= DISC_END);
  results.push({ id, label, cfg: o, open, trades, all: stats(trades), pre: stats(pre), post: stats(post) });
  console.error(`config ${id} ${label}: ${trades.length} trades`);
}
const base = results[0];

const f = (x, d = 2) => fmt(x, d);
const sg = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : 'NA');
const L = [];
const out = (x = '') => L.push(x);

out('# EGX100 settings sweep: baseline vs one change at a time');
out();
out(`Generated by \`tools/backtest/sweep.mjs --data ${path.relative(process.cwd(), dir) || dir}\` on ${new Date().toISOString().slice(0, 10)}. Universe: all ${symbols.length} stocks in \`data/egx\` (split-adjusted only, full history, no holdout). Trades still open at the end of the data are not counted (${results.map((r) => r.open).reduce((a, b) => Math.max(a, b), 0)} at most per config).`);
out();
out('**Base** = preset `tv-base`: daily, Long Trades Only, Apply Costs on (0.1% slippage per side + 2 EGP per order, position 100,000), Min Risk (ticks) 10, everything else at the Pine default. Each row changes only what its name says.');
out();
out('**How the numbers are made.** Per closed trade: net return % = net R x |entry - initial stop| / entry x 100 (same formula as `validate-picks.mjs`; it is net of costs and blends the three scale-out thirds). Win = net return > 0. All money figures are percent of position, one trade = full notional (position size is irrelevant). Max drawdown is peak-to-trough of the cumulative **sum** of trade returns (in % points), trades ordered by exit date, starting from 0. Avg R is shown for reference only.');
out();
out('## What each change does');
out();
out('"Pine today" = the switch exists as an input in `src/ict-rsi-ma-indicator.pine`. "Port-only" = exists only in the Node engine and would have to be added to the Pine script to be used.');
out();
out('| # | Change | Plain language | Pine input name | In Pine today? |');
out('|---|---|---|---|---|');
const DESC = [
  ['Baseline', 'Plain model, costs on.', '(none)', 'yes'],
  ['Stop on Close Only', 'A stop only counts when a daily bar CLOSES beyond it, not when a wick touches it; the exit is booked at that close (a worse fill than the stop level).', 'Stop on Close Only (`stopOnCloseOnly`)', 'yes'],
  ['Stop under newest internal swing low', 'Initial stop = the lower of the zone stop and (newest confirmed internal swing low - Stop Buffer x ATR). Never tighter than the zone stop.', 'none (engine key `stopSwingTier: "Internal"`)', 'port-only'],
  ['Stop +0.5 ATR', 'Initial stop pushed 0.5 x ATR(14) further below the zone stop (wider stop, smaller size per R, more room).', 'none (engine key `stopExtraAtr: 0.5`)', 'port-only'],
  ['Stop +1 ATR', 'Same, 1 x ATR(14) further.', 'none (engine key `stopExtraAtr: 1`)', 'port-only'],
  ['Runner set "r4"', 'No exit at TP3: the last third keeps running behind a trailing stop built from Major swings, trailing from the moment of entry (no breakeven jump at TP1).', 'Runner (no exit at TP3) + Trailing Tier = Major + Trail From Entry', 'yes'],
  ['Require Confirmation', 'A zone touch is only traded if a later bar (within 3 bars) closes in the trade direction first.', 'Require Confirmation (+ Confirmation Max Wait, default 3)', 'yes'],
  ['Require Index Trend', 'Longs are skipped while the stock\'s index (EGX30 or EGX70 EWI) is trending down (close under its 50 MA with the MA falling over 10 bars).', 'Require Index Trend (Index = Auto, MA 50, slope 10)', 'yes'],
  ['Minimum Score 4', 'Looser gate: a setup needs 4 of the 7 confirmation points (default is 5).', 'Minimum Score', 'yes'],
  ['Minimum Score 6', 'Stricter gate: 6 of 7 points.', 'Minimum Score', 'yes'],
  ['Trail entry model on (pullback + trail)', 'Turns on the second, chandelier-trail entry model alongside the pullback model; trades from both are pooled here. The trail model enters on a trend flip with a ~2 ATR stop.', 'Enable Trailing Stop Model', 'yes'],
  ['Volume ratio >= 0.8', 'Skip an entry when the signal bar\'s volume is under 0.8 x its 20-bar average volume (the threshold named in the discovery run).', 'none (engine key `filtVolRatioMin: 0.8`)', 'port-only'],
  ['Stop on Close + r4', 'Combination of rows 2 and 6.', 'Stop on Close Only + the r4 inputs', 'yes'],
  ['Stop on Close + Require Index Trend', 'Combination of rows 2 and 8.', 'Stop on Close Only + Require Index Trend', 'yes'],
  ['Stop on Close + Require Confirmation', 'Combination of rows 2 and 7.', 'Stop on Close Only + Require Confirmation', 'yes'],
  ['Stop on Close + swing-low stop', 'Combination of rows 2 and 3.', 'Stop on Close Only + (port-only swing-low stop)', 'port-only (swing-low part)'],
];
CONFIGS.forEach((c, i) => out(`| ${c[0]} | ${c[1]} | ${DESC[i][1]} | ${DESC[i][2]} | ${DESC[i][3]} |`));
out();
out('All 16 configs exist as engine keys and ran; none was skipped.');
out();

out('## Main table (full history, all trades)');
out();
out('Returns in % of position per trade. Net profit = sum of all trade returns (not compounded).');
out();
out('| # | Config | Trades | Wins | Losses | Win rate % | Gross profit % | Gross loss % | Net profit % | Avg return / trade % | Avg win % | Avg loss % | Profit factor | Max DD % (sum curve) | Avg R | Avg initial risk % of entry |');
out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const s = r.all;
  out(`| ${r.id} | ${r.label} | ${s.n} | ${s.wins} | ${s.losses} | ${f(s.win, 1)} | ${f(s.gp, 1)} | ${f(s.gl, 1)} | ${f(s.net, 1)} | ${f(s.avg, 3)} | ${f(s.avgWin, 2)} | ${f(s.avgLoss, 2)} | ${f(s.pf, 3)} | ${f(s.dd, 1)} | ${f(s.avgR, 3)} | ${f(s.avgRisk, 2)} |`);
}
out();

out('## Robustness: before vs on/after 2023-01-01 (by trade open date)');
out();
out('"Beats baseline in both periods" = Avg return % is higher than the baseline row\'s in the pre-2023 split AND in the 2023+ split. "Charts > 0" = share of stocks with n >= 5 trades (full history, that config) whose summed return is positive.');
out();
out('| # | Config | Pre-2023 n | Pre Avg ret % | Pre Win % | Pre PF | 2023+ n | Post Avg ret % | Post Win % | Post PF | Beats baseline on Avg return in both periods? | Charts with net profit > 0 (n>=5) % |');
out('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const a = r.pre, b = r.post;
  const beats = r.id === 1 ? '(baseline)' : a.avg > base.pre.avg && b.avg > base.post.avg ? 'Y' : 'N';
  out(`| ${r.id} | ${r.label} | ${a.n} | ${f(a.avg, 3)} | ${f(a.win, 1)} | ${f(a.pf, 3)} | ${b.n} | ${f(b.avg, 3)} | ${f(b.win, 1)} | ${f(b.pf, 3)} | ${beats} | ${f(r.all.chartsPosPct, 0)}% (${r.all.chartsPos}/${r.all.charts}) |`);
}
out();

out('## Delta vs baseline (full history)');
out();
out('| # | Config | Win rate pts | Net profit % | Profit factor | Avg return / trade % | Trades | Max DD % |');
out('|---|---|---|---|---|---|---|---|');
for (const r of results.slice(1)) {
  const s = r.all, b = base.all;
  out(`| ${r.id} | ${r.label} | ${sg(s.win - b.win, 1)} | ${sg(s.net - b.net, 1)} | ${sg(s.pf - b.pf, 3)} | ${sg(s.avg - b.avg, 3)} | ${sg(s.n - b.n, 0)} | ${sg(s.dd - b.dd, 1)} |`);
}
out();

const r11 = results.find((r) => r.id === 11);
const byModel = (m) => stats(r11.trades.filter((t) => t.model === m));
const models = [...new Set(r11.trades.map((t) => t.model))];
out('### Row 11 split by entry model (information only)');
out();
out('| model | Trades | Win rate % | Net profit % | Avg return % | Profit factor | Avg R |');
out('|---|---|---|---|---|---|---|');
for (const m of models) { const s = byModel(m); out(`| ${m} | ${s.n} | ${f(s.win, 1)} | ${f(s.net, 1)} | ${f(s.avg, 3)} | ${f(s.pf, 3)} | ${f(s.avgR, 3)} |`); }
out();

out('## Caveats');
out();
out('- **In-sample.** Every row uses all the data, 2023+ and pre-2023 alike, and the 18 stocks that used to be held back are included. Picking the best row of this table is picking on the same data it was measured on; it is a description, not a validation. The earlier out-of-sample verdicts (Require Confirmation failed, runners passed the final re-test, the three stop picks went through the pick rule) stand on their own records. Rows that win only in one period, or only because of a handful of charts, should be read as noise until a fresh sample says otherwise.');
out('- **Split-adjusted data only.** `data/egx` is adjusted for splits but not dividends, while the TradingView charts the Pine script is judged on are dividend-adjusted. Price level drives the Min Risk (ticks) floor and the commission term, so early trades differ from what TradingView would show (see `tools/backtest/README.md`). Results here are the port on this feed, not a TradingView replay.');
out('- **% at full notional is not risk-normalised.** A return in % of position equals net R x the stop distance in % of entry, so a setup with a wider stop produces bigger % wins, bigger % losses and a bigger % drawdown for the same R behaviour (see the Avg initial risk column). Rows with wider stops (3, 4, 5, 16) are flattered on Net profit % and Avg return % relative to Avg R, and penalised on Max DD %; compare Avg R and Profit factor for the quality of the edge, and the % columns for what a fixed-notional position would have returned.');
out('- **Survivorship.** The universe is the stocks listed today; delisted or suspended names are absent, which flatters every row roughly equally.');
out('- **Sum-of-% is not an equity curve.** Net profit and drawdown add percent-of-position returns trade after trade as if every trade used the same full notional and nothing compounded; Max DD is the drawdown of that running sum. A real account sizes by risk and cannot hold 99 stocks at full notional at once.');
out('- **Trades overlap across stocks.** Dozens of trades are open on the same days, and EGX stocks move together with the index, so trades are not independent: the effective sample is smaller than the trade count and the drawdown figure understates the pain of a bad market month.');
out('- Costs: 0.1% per side + 2 EGP per order are included in every return. Wins/losses are on the net return (a "win" after costs).');
out();
const md = L.join('\n');
if (args.out) { fs.writeFileSync(args.out, md + '\n'); console.error('wrote', args.out); }
else console.log(md);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results.map((r) => ({ id: r.id, label: r.label, open: r.open, all: r.all, pre: r.pre, post: r.post })), null, 1));
