# Strategy Tester Backtest — Design

**Date:** 2026-10-05
**Status:** Design approved 2026-10-05, implementation not yet started
**Implementation:** by subagent on Sonnet 5.5, at the user's request
**Source of truth:** `src/ict-rsi-ma-indicator.pine` (not modified by this work)
**New files:** `src/strategy-layer.pine`, `tools/build-strategy.ps1`, `src/ict-rsi-ma-strategy.pine` (generated)
**Depends on:** [[trade-system-roadmap]], [[pine-has-no-test-framework]], [[tradingview-plan-blocks-footprint]]

## Purpose

The user wants the ICT script to run in TradingView's Strategy Tester, for two reasons they chose
together:

1. **Realistic money results** — equity curve, max drawdown, commission and slippage. The
   PERFORMANCE panel reports only R and has none of these.
2. **A cross-check of the panel** — an independent accounting of the same trades. Every number
   the project has tuned against so far comes from the engine grading its own work.

Success means: the Tester trades exactly the trades the engine takes, its result converts back to
the panel's Total R within a stated tolerance, and every remaining difference is one of a short,
named list.

## What is not in scope

- No change to the indicator's behaviour, inputs, drawings, panel or alerts. `git diff` on
  `src/ict-rsi-ma-indicator.pine` must be empty when this work is done.
- No new entry or exit logic. The order layer reports the engine's decisions; it makes none.
- No alerts from the strategy. Alerts stay the indicator's job.
- No parameter optimisation workflow, no Deep Backtesting, no Bar Magnifier.

## Architecture

The Strategy Tester only runs `strategy()` scripts, and a script cannot be both. The user chose a
**generated** strategy file over converting in place (which would kill the 13 `alertcondition()`
alerts) or a hand-maintained copy (which would drift and silently invalidate the cross-check).

Three pieces, each with one job:

| Piece | Job |
|---|---|
| `src/strategy-layer.pine` | The order layer: inputs, sizing, `strategy.*` calls. A fragment — it reads the engine's globals and does not compile alone. |
| `tools/build-strategy.ps1` | Produces the strategy file from the indicator plus the layer. |
| `src/ict-rsi-ma-strategy.pine` | Generated output, committed so it can be pasted into TradingView straight from the repo. Never edited by hand. |

### The build script

PowerShell 5.1, because that is what this machine has on PATH (Node is not). It does exactly
three things to a copy of the indicator:

1. **Swap the declaration.** The single line starting `indicator(` becomes a `strategy(` call with
   the same title stem (suffixed "Strategy"), the same `overlay` and `max_*` arguments, plus:
   `process_orders_on_close = true`, `pyramiding = 0`, `initial_capital = 100000`,
   `margin_long = 0`, `margin_short = 0`, and zero commission and slippage.
2. **Remove every `alertcondition(` line.**
3. **Append** `src/strategy-layer.pine`.

It prepends a "GENERATED — do not edit, run tools/build-strategy.ps1" header after the
`//@version` line.

Failure behaviour: the script stops with an error and writes nothing if it does not find exactly
one `indicator(` line, or finds no `alertcondition(` lines (either means the indicator changed
shape under it). Files are read and written as UTF-8 without a BOM — the source contains
non-ASCII characters and PowerShell 5.1's defaults would corrupt them.

A `-Check` switch builds in memory and exits non-zero if the committed strategy file differs.
That is the drift guard: run it before trusting any Tester number.

Why the declaration defaults are what they are: zero costs and unlimited margin make the
out-of-the-box run the cross-check run. All of them are editable in the Tester's Properties tab,
which is where the realistic run sets them.

## The order layer

### Inputs (group "Strategy Tester")

| Input | Default | Meaning |
|---|---|---|
| Backtest Model | Pullback | Which slot sends orders: Pullback (`activeTrade`) or Trail (`trailTrade`). |
| Sizing | Fixed Cash Risk | Fixed Cash Risk, or % of Equity Risk. |
| Risk per Trade (cash) | 1000 | Used in Fixed Cash Risk mode. |
| Risk per Trade (% of equity) | 1.0 | Used in % of Equity Risk mode. |
| Max Position (% of equity) | 0 (off) | Caps position value. For cash equities, 100. |

One model per run because a strategy holds one net position per symbol, while the engine's two
slots can be open at once and in opposite directions. The unselected model still draws and still
reports in the panel; it sends no orders. Selecting Trail does not switch the trail model on —
`Enable Trailing Stop Model` still does that.

### Sizing

`qty = riskCash / |entry − initialStop|`, where `riskCash` is the fixed amount or the percentage
of `strategy.equity` at entry. If the cap is on and `qty × entry` exceeds it, `qty` is reduced to
fit and a counter of capped trades is incremented (shown as a Data Window plot), because a capped
trade no longer risks 1R and would otherwise be an untraceable cross-check mismatch.

The position is split into three legs: two of `qty / 3` and a third holding the remainder.

### Orders, bar by bar

Let `bt` be the selected slot. All orders are issued at bar close.

- **Bar the trade opens** (`bt.openBar == bar_index`): a market `strategy.entry`, filled at this
  bar's close — the engine's own entry price. In the same pass, one `strategy.exit` per leg:
  limit at `tp1` / `tp2` / `tp3`, stop at `bt.stop`.
- **Every later bar the trade is live:** the exits for legs whose target is not yet reached are
  re-issued with the current `bt.stop`. The engine moves its stop at bar N's close and tests it on
  bar N+1; a stop order placed at N's close and evaluated over N+1 is the same thing. Legs
  already filled are not re-issued, since that would open a fresh exit order.
- **Bar the engine closes the trade** (the slot's own `pbClosed` / `trClosed`, never the shared
  `tradeClosed`): cancel all resting orders and `strategy.close` whatever remains, at this bar's
  close. For a wick-mode stop or a TP3 exit the resting order has already filled and this is a
  no-op. For Invalidated exits it is the exit itself, at the price the engine books.

Two engine modes change the shape of the exits:

- **Stop on Close Only:** the legs carry no resting stop. A resting stop would fill on a wick,
  which is exactly what this mode exists to ignore. The close-of-bar exit above does the work.
- **Runner:** the third leg has no limit at TP3. It leaves by the stop or the close, as in the
  engine. Read from the trade's own `runner` snapshot, not the input.

The wick-mode stop needs no gap handling: a stop order that opens beyond its price fills at the
open, which is the engine's `min(stop, open)` rule.

## Known differences from the panel

These are expected and will be documented in the README. Anything outside this list is a bug.

1. **Stop and target inside one bar.** The engine books the stop first, always. The Tester infers
   the intrabar path from the bar's shape and may fill a target before the stop.
2. **Gap through a target.** The engine books the target price; a limit order fills at the better
   open.
3. **Quantity rounding.** Three legs of a rounded position are not exact thirds.
4. **Trade count.** The Tester lists each partial exit as its own trade, so its count runs up to
   three times the panel's n. The layer plots its own count of entries sent in the Data Window;
   that is the number to compare with n.
5. **Capped trades**, when the cap is on.
6. **Costs**, when commission or slippage are set.

## Using it

**Cross-check run:** defaults. Net Profit ÷ Risk per Trade should equal the selected model's
Total R; entries sent should equal its n.

**Realistic run:** Sizing = % of Equity Risk, Max Position = 100 on cash equities, and commission
and slippage set in the Properties tab to the broker's real figures. `Long Trades Only` on where
shorting is unavailable.

## Verification

Per [[pine-has-no-test-framework]], nothing here is claimed to compile until TradingView has
compiled it.

1. **Build check.** `git diff` on the indicator is empty. A diff of indicator against generated
   strategy shows only the declaration line, the header, the removed `alertcondition` lines and
   the appended layer. `-Check` passes.
2. **Read-back review** of the layer against [[pine-v6-gotchas]].
3. **Live pass**, on a chart with a free indicator slot (the user's call to free one — see
   [[tradingview-plan-blocks-footprint]]). The strategy's own panel must show the same n and
   Total R as the indicator on the same chart and settings; that proves the engine survived the
   build untouched.
4. **Cross-check**, pass rule fixed now, on four charts: ELEC 1D and ABUK 4H (the two symbols
   whose trade logs were already reconciled with the panel), plus MASR 1D and XRP 1H (added by
   the user; XRP 1H is the only crypto intraday chart and the only one where shorts and
   killzones are live). Default settings, entries sent equals n exactly, and Net Profit ÷ Risk
   per Trade is within the larger of 2% or 0.5R of Total R. The rule applies per chart — all
   four must pass, not an average. A miss is traced trade by trade — `Log Closed Trades` CSV
   against the Tester's exported list — and each difference must land on the list above.
5. **Realistic run** recorded for the same four charts, as a first reading, not a pass/fail.

## Documentation

`README.md` and `README.ar.md` ship with the code: a "Backtesting in the Strategy Tester"
section (the two runs, the known differences, the one-model-per-run rule), the new inputs under
Settings, the build step, and the three new files under Repository layout.
