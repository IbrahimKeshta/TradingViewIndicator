# ICT engine backtest (Node port)

Offline, bar-by-bar port of the trade engine in `src/ict-rsi-ma-indicator.pine` for **daily** bars, so it can be run over
the whole EGX100 without TradingView. Node 20, no dependencies, ES modules.

```
export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"     # node is not on PATH
node tools/backtest/run.mjs --symbols COMI,TMGH --preset tv-base
node tools/backtest/run.mjs --all --preset tv-r4 --data data/egx-div --cut 2026-11-04 --out out/r4
node tools/backtest/run.mjs --symbols VLMRA --config '{"useTrailModel":true,"longOnly":false}'
node tools/backtest/validate.mjs --data data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3
node tools/backtest/compare-log.mjs --data data/egx-div --symbol VLMRA --log <Pine-logs-export.csv> --cfg '{...}'
node tools/backtest/debug-bar.mjs VLMRA 2022-04-17 --data data/egx-div     # engine state on a date
node --experimental-websocket tools/backtest/scan-egx.mjs                   # EGX Daily scan + forward log (see forward/README.md)
ADJ=dividends node --experimental-websocket tools/backtest/fetch-egx.mjs data/egx-div   # all EGX30/EGX70, dividend-adjusted
ADJ=dividends TF=1W node --experimental-websocket tools/backtest/fetch-egx.mjs data/wk-div   # the same, weekly bars
```

## Files

| File | What |
|---|---|
| `ict-engine.mjs` | `runEngine(bars, config, {symbol, mintick, indexBars})` returns every closed trade. `DEFAULTS` equals the Pine input defaults; `kzAlwaysEarned` mirrors the Pine preset's killzone point (needed on weekly bars, whose times fall outside the killzones; no effect on daily). `PRESETS` has `tv-base` (daily, Long Only, costs on, Min Risk 10 ticks) and `tv-r4` (+ Runner, Trailing Tier Major, Trail From Entry), and `egx-daily` (tv-r4 + Stop on Close Only, the Pine `Preset: EGX Daily`). Off-by-default exit keys `hardStopR` and `timeStopBars` exist for the 2026-11-21 test only; both failed and are not in Pine. |
| `run.mjs` | CLI: config over a symbol list, per-symbol n / wins (net R > 0) / total R, optional `--out` CSV + JSON (one row per trade). `--cut DATE` and `--max-bars N` truncate history. |
| `scan-egx.mjs` | Daily scanner and forward log for the EGX Daily preset: refreshes dividend-adjusted bars for every EGX30/EGX70 stock, lists new entries, closes and open trades (with the current stop and next target), writes `forward/latest.md` and appends to `forward/egx-daily-log.json`. See `forward/README.md`. A thin CLI over `scan-core.mjs`. |
| `scan-core.mjs` | The scanner's logic, shared with the dashboard (`tools/dashboard`): `runUniverse`, `updateLog`, `renderLatest`, `forwardRecord`, and the closed-session guard (`isBarFinished`, `dropUnfinished`, `trimUnfinishedCsvs`: a bar dated today counts as finished only from 15:00 Cairo). Tests: `node --test tools/backtest/scan-core.test.mjs`. |
| `weekly-tests.mjs` | The 2026-11-23 weekly search (`--stage 1` exits, `--stage 2 --base JSON` swing lookbacks, `--final JSON`) on `data/wk-div`, by the protocol in `docs/superpowers/plans/2026-11-23-egx-weekly-preset.md`. Result: no weekly preset; EGX Daily is the best tested on weekly. |
| `exit-tests.mjs` | Backup-stop and time-stop grids against `egx-daily`, with the pass rules of `docs/superpowers/plans/2026-11-21-egx-daily-exit-tests.md`. |
| `validate.mjs` | Acceptance test against `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv`. |
| `compare-log.mjs` | Trade-by-trade diff against a Pine `Log Closed Trades` export. |
| `data.mjs`, `debug-bar.mjs` | CSV loading, state dump. |
| `fetch-egx.mjs` | Data download (separate tool; see the adjustment note below). |

## What is ported

Everything that decides a trade, in the Pine global-scope order: RSI/MA/ATR/MACD/Stochastic/volume/Ichimoku series with
Pine's seeding and na rules, two-tier swings (`ta.pivothigh/low`, EQH/EQL, max swings), the BOS/CHoCH state machine, the
range test, FVG and OB creation/mitigation/caps (FVG wins a touch tie over OB), Require Confirmation (pending touch), the
killzone point (session test at the bar open, in `America/New_York`), the 7-point score, grade and gate, Min Risk (ATR and
ticks), `selectTargets` (liquidity tie-break, R fill), the pullback entry, the structural trailing stop (Internal/Major),
Trail From Entry, Stop on Close Only, Runner, CHoCH invalidation, the trailing-stop (chandelier) entry model (off by
default), Long Trades Only, Require Index Trend (EGX30 / EGX70 with the EGX30 fallback), Require Anchored VWAP, Require
Displacement, Apply Costs, and `recordResult` (scale-out in thirds, `blendedResultR - costR`, Tuning/Test/Straddle by entry
time against Test Start). Every record has the `logTrade()` fields plus `openIdx` / `closeIdx` (bar indices), `grossR`
and `costR`.

Not ported: Require HTF Bias on a timeframe above the chart (on 1D with the default Bias Timeframe 1D the Pine filter
turns itself off, which is what the port does; any other Bias Timeframe throws), all drawing, panels and alerts, and the
watch-zone ATR (display only). Only closed trades are returned, as the Pine panel counts them; `result.openTrades` holds a
still-open one.

## Two things the validation taught

1. **`ta.pivothigh/low` ties.** TradingView treats a bar as a pivot when no bar to its *left* is strictly beyond it and
   every bar to its *right* is strictly below it (of two equal highs the later one is the pivot). This is the config
   `pivotTies: 'strictRight'` (the default). The other three tie rules each fail the VLMRA trade log; this one
   reproduces all 36 logged trades field for field.
2. **The data must be dividend-adjusted.** The TradingView charts the reference numbers came from show prices adjusted for
   splits **and dividends** (VLMRA 2021-12-23 close is 12.5087 in the Pine log, 17.9434 in the splits-only feed). The Min
   Risk (ticks) floor and the commission-in-R term depend on the price level, so on splits-only history the port takes
   many more early trades (EAST 54 vs TradingView's 30 before 2024). `data/egx/` as downloaded is splits-only; the
   validation used `data/egx-div/`, fetched with the same websocket request but `adjustment: "dividends"`. FWRY (listed
   2019, no meaningful dividend adjustment) matches on either feed.

## Validation against TradingView (acceptance test)

Reference: per-chart n / wins / net R that the Pine script itself reported on TradingView (daily, Long Trades Only, Apply
Costs, Min Risk 10 ticks; `r4` = Runner + Trailing Tier Major + Trail From Entry). `tune` rows count only trades entered
and closed before 2024-01-01 (the Pine "Tuning" column); batch rows are Tuning + Test (Straddle trades are in neither).
Dividend-adjusted data, history cut at 2026-11-04, full history (no bar limit).

| Chart | Set | Base TV n/w/R | Base port n/w/R | r4 TV n/w/R | r4 port n/w/R |
|---|---|---|---|---|---|
| COMI | tune | 59 / 26 / 12.60 | 59 / 26 / 12.60 | 44 / 18 / 20.99 | 44 / 18 / 20.99 |
| ETEL | tune | 47 / 22 / 11.13 | 47 / 22 / 11.13 | 34 / 17 / 10.36 | 34 / 17 / 10.36 |
| EAST | tune | 30 / 10 / -7.22 | 30 / 10 / -7.22 | 16 / 3 / 0.56 | 16 / 3 / 0.57 |
| FWRY | tune | 14 / 8 / 9.99 | 14 / 8 / 9.99 | 9 / 4 / 16.26 | 9 / 4 / 16.26 |
| HRHO | tune | 48 / 20 / 5.07 | 48 / 20 / 5.07 | 38 / 13 / 8.78 | 38 / 13 / 8.78 |
| ORWE | tune | 32 / 12 / -3.64 | 32 / 12 / -3.64 | 25 / 4 / -0.86 | 25 / 4 / -0.86 |
| MASR | tune | 28 / 13 / -1.93 | 28 / 13 / -1.93 | 21 / 8 / -3.50 | 21 / 8 / -3.50 |
| ELEC | tune | 0 / 0 / 0.00 | 0 / 0 / 0.00 | 0 / 0 / 0.00 | 0 / 0 / 0.00 |
| EGCH | tune | 47 / 21 / 4.37 | 47 / 21 / 4.37 | 40 / 15 / 5.57 | 40 / 15 / 5.57 |
| MCQE | D | 82 / 33 / -4.13 | 82 / 33 / -4.12 | - | - |
| GBCO | D | 46 / 18 / 6.14 | 46 / 18 / 6.14 | - | - |
| DAPH | E | 72 / 25 / -1.25 | 72 / 25 / -1.25 | 52 / 18 / 17.76 | 52 / 18 / 17.76 |
| CNFN | F | 18 / 2 / -13.77 | 18 / 2 / -13.76 | 16 / 2 / -9.08 | 16 / 2 / -9.08 |
| ELSH | F | 42 / 20 / 13.27 | 42 / 20 / 13.27 | 30 / 13 / 27.48 | 30 / 13 / 27.48 |

Pooled (TradingView vs port): `ict base` 11 charts 433 / 183 / +32.38 vs 433 / 183 / +32.37; `runner base` 12 charts
437 / 179 / +28.62 vs 437 / 179 / +28.62; `runner r4` 12 charts 325 / 115 / +94.32 vs 325 / 115 / +94.32.

The same 14 charts also carry TSV reads for Require Confirmation, Require Index Trend, both, and runner configs r1, r2,
r3. All **91 chart-config reads match exactly on n and wins and to within 0.01R**. The Require Index Trend rows include
EGX70 names (ORWE), which exercises the EGX30 fallback.

Trade-level check: the user's VLMRA 1D Pine log (Score: Killzone off, Stop on Close Only, Require Confirmation, trailing
model on, shorts on; 36 trades, both models) is reproduced field for field: dates, grade, score, zone, entry, stop, TP1-3,
TP hit, reason, exit, R, MFE, MAE, bars, risk in ATR, the 7 flags and the period column.

History length: truncating to the last 5000 bars changes the early trades and breaks the match on most charts; the
full-history run and a 10000-bar cap (which is also full history) match identically. So the TradingView chart these
numbers came from held the whole history. Cutting at 2026-11-03, 2026-11-04 or not at all gives the same numbers on these
charts (no trade closed between 2026-11-04 and 2026-11-19 on any of them).

Not re-run: the other 41 TSV charts (the remaining tune charts and batches D, E, F). They need `data/egx-div/` for those
symbols. `fetch-egx.mjs` only requests `adjustment: "splits"`; making the adjustment a parameter (`'dividends'`) and
running it into `data/egx-div` is all that is missing, then
`node tools/backtest/validate.mjs --data data/egx-div --combos base,r4,conf,idx,both,r1,r2,r3`.

## EGX100 failure-analysis options (all off by default)

Added for `docs/superpowers/plans/2026-11-20-egx100-failure-analysis.md`. With the defaults the engine output is unchanged
(`validate.mjs --data data/egx-div`: 91/91 chart-config reads still match; trade-by-trade identical to the engine without these hooks
over 82 symbols x 4 configs). The engine decides on the **close of the signal bar** (`openDate`/`openIdx` = that bar, entry = its close); every
option below uses data through that bar only.

| Option | Meaning |
|---|---|
| `stopExtraAtr` (S1) | initial stop widened by k x ATR(14) |
| `stopSwingTier` (S2) | `'Internal'`/`'Major'`: stop = min(zone stop, newest confirmed swing low - buffer x ATR); never tighter |
| `stopOnCloseOnly` (S3) | the existing Pine input |
| `phantomGuard` (S4) | on a bar with open within 1 tick of prev close and low (high for shorts) within 1 tick of the open, the stop is tested against the close |
| `minRiskPct` | sensitivity: risk >= x% of entry price (in addition to `minRiskTicks`; set that to 0 to replace it) |
| `reentryBars` (R1) | after an initial-stop exit with no target, re-enter at the close of the first bar within N bars (after the stop bar) that closes back above the old stop; stop = lowest low since the stop bar - buffer x ATR; one attempt per stop-out; re-entries are not re-armed; zone label `RE`, `reentry: true` |
| `filtRsiMin/Max`, `filtAdxMin`, `filtAboveSma200`, `filtIdxAboveSma50`, `filtRs60Min`, `filtVolRatioMin`, `filtDist20MaxAtr`, `filtWeekly30`, `filtCmfMin`, `filtMfiMin/Max` | long-side entry filters (a failed filter frees the trade slot); the index ones need `indexBars.EGX30` |

Trade records also carry `entryAtr`, `zoneBars` (signal bar - zone creation bar), `swIntRecent`/`swMajRecent` (newest confirmed swing low at entry),
`swIntNearBeyondStop`/`swMajNearBeyondStop`, `reentry`, and the entry-bar features `fRsi, fAdx, fSma200Dist, fIdxAbove50, fRs60, fVolRatio,
fDist20Atr, fWeekly30Dist, fCmf, fMfi`.

New scripts: `egx100-common.mjs` (explicit holdout list, discovery split, stats), `analyze-failures.mjs` (base run + taxonomy),
`candidates.mjs` (every candidate run through the engine + the pick rule). All take `--data <dir>`.

## Six-stock deep dive (CHoCH "Invalidated" exit)

Added for `docs/superpowers/plans/2026-11-20-six-stock-deep-dive.md`.

| Item | Meaning |
|---|---|
| `invalidation` (engine option, default `'on'` = Pine behaviour) | what closes a trade on an internal CHoCH against it: `'on'` any internal CHoCH (booked at the close, "Invalidated"); `'off'` never; `'major'` only a Major-tier CHoCH; `'belowEntry'` an internal CHoCH only if the bar also closes beyond the entry (long: close < entry). Port-only; no Pine input. |
| `finalStop` (trade record field) | the stop at exit, so a trailed stop can be told from the initial stop. Record-only. |
| `fetch-egx.mjs ... --adjust dividends` (or `ADJ=dividends`) | price adjustment requested from TradingView; default `splits` (what `data/egx` holds), `dividends` is what the charts show with ADJ on (`data/egx-div`). The flag goes last; `_meta.json` is merged when a symbol list is given and records the adjustment. |
| `six-stock.mjs` | per-trade analysis after Stop / Invalidated exits (max high in R, bars to the next target, lowest low, hold-with-original-stop test) against a base-rate control from every bar of the same stock. `--symbols all --lists no --tag pooled-100 --data data/egx` pools it over a universe. Output goes to `data/six-stock-out/` (git-ignored). |
| `variants.mjs` | runs V1-V6 (invalidation variants on base and rec) over the six stocks, the other dividend-adjusted names and all of `data/egx`: trades, win %, avg / total R, PF, pre-2023 vs 2023+, breadth. |

With the default `invalidation: 'on'` the engine output is unchanged (`validate.mjs --data data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3` still matches every chart-config read).
