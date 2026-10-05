# Strategy Tester Backtest — Design

**Date:** 2026-10-05
**Status:** Implemented and run on TradingView 2026-10-05. The cross-check as originally declared
failed on the three EGX charts and passed on XRP 1H; the cause was price granularity, not the order
layer, and the design was amended (see "Amendments from the live pass"). Results:
`docs/superpowers/plans/2026-10-05-strategy-backtest-validation.md`
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
**generated** strategy file over converting in place (which would kill the 11 `alertcondition()`
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

It prepends a "GENERATED FILE -- do not edit" header as the first lines of the file, above the
`//@version` line (comments may precede the version annotation, as TradingView's own licence
header does).

Failure behaviour: the script stops with an error and writes nothing if it does not find exactly
one `indicator(` line, or finds no `alertcondition(` lines (either means the indicator changed
shape under it). Files are read and written as UTF-8 without a BOM — the source contains
non-ASCII characters and PowerShell 5.1's defaults would corrupt them.

A `-Check` switch builds in memory and exits non-zero if the committed strategy file differs.
That is the drift guard: run it before trusting any Tester number. The comparison ignores line
endings, since git may check the file out as LF or CRLF.

The script is the one part of this work that can be tested off TradingView, so it is:
`tools/test-build-strategy.ps1` runs it against fixture files in a temp folder (the three paths
are parameters with the real files as defaults) and asserts the transform, each failure mode, the
encoding round trip and `-Check`.

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
fit and a counter of capped trades is incremented, because a capped trade no longer risks 1R and
would otherwise be an untraceable cross-check mismatch.

The quantity is rounded down to whole multiples of `syminfo.mincontract`. The position is split
into three legs: two of `qty / 3` (rounded down the same way) and a third holding the remainder,
so the legs always sum to the position. A position under three minimum contracts leaves in one
piece. A trade that rounds to zero sends no order and is counted as skipped.

Order prices are rounded to the tick on the far side of each level — a long's targets up and its
stop down, a short's the reverse — so the emulator triggers on exactly the bars where the engine's
raw-float comparison does.

### The BACKTEST table

The layer draws its own small table (position selectable, default Bottom Left; `Show Backtest
Panel` turns it off) rather than adding Data Window plots: the indicator already sits at Pine's
64-plot cap, and a 65th is a runtime error that only appears on the chart. Rows: the selected
model, entries sent, the engine's closed n for that model, Tester R (`strategy.netprofit ÷ Risk
per Trade`, Fixed Cash Risk mode only), the engine's Total R, capped trades, skipped trades, and whether the two sides are currently comparable. It puts the two
sides of the cross-check next to each other so nobody has to do the division by hand.

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
   the intrabar path from the bar's shape and may fill a target before the stop. Under Stop on
   Close Only this is systematic rather than occasional: a bar that wicks to a target and closes
   through the stop is a full stop to the engine and a banked third to the Tester.
2. **Gap through a target.** The engine books the target price; a limit order fills at the better
   open.
3. **Quantity rounding.** The position is rounded down to whole minimum contracts, so it risks
   slightly less than Risk per Trade and Tester R reads slightly small — negligible at hundreds
   of units, material at a handful.
4. **Trade count.** The Tester lists each partial exit as its own trade, so its count runs up to
   three times the panel's n. The BACKTEST table's count of entries sent is the number to
   compare with n.
5. **A trade still open.** Entries sent counts it and n does not, and thirds it has already
   banked are in the Tester's net profit but not yet in Total R. The comparison is exact only
   when the selected model is flat.
6. **Capped trades**, when the cap is on, and **skipped trades**, when a position rounds to zero.
7. **Costs**, when commission or slippage are set.
8. **A stop moved to a price the market is already through.** After TP1 the stop jumps to entry;
   if that bar closes back beyond entry the engine waits for the next bar to trade down to the
   stop, while the emulator treats the order as already triggered. The trade ends either way, but
   the bar and price can differ. No resting order can reproduce the engine's rule here.

## Using it

**Cross-check run:** defaults. Net Profit ÷ Risk per Trade should equal the selected model's
Total R; entries sent should equal its n.

**Realistic run:** Sizing = % of Equity Risk, Max Position = 100 on cash equities, and commission
and slippage set in the Properties tab to the broker's real figures. `Long Trades Only` on where
shorting is unavailable.

## Amendments from the live pass

Three things changed after the strategy first ran on a chart. They are recorded here rather than
folded silently into the sections above, because the original pass rule was written before them.

1. **Minimum Risk (ticks), default 10.** The engine works in R and is scale-free; the broker
   emulator fills in whole ticks. On split- and dividend-adjusted history an old price can be a
   few ticks in total (MASR at 0.09, ELEC at 0.015, both with a 0.01 tick), so a one-tick rounding
   is a large part of 1R — on MASR 1D one trade the engine booked at +2.30R came out at −1.69R.
   A trade whose entry-to-stop distance is under the floor sends no order and is counted as
   skipped. Measured before the floor existed: under 2 ticks, up to 4R apart on one trade; 20
   ticks or more, at most 0.05R.
2. **"Engine R, sent trades" row.** With trades skipped, `Engine Total R` is no longer the right
   comparison. The layer accumulates the engine's own blended R over exactly the trades it sent,
   and the table shows that figure and its count beside `Tester R`. The identity to check is
   entries sent + skipped = engine n (plus one while a trade is open).
3. **Target catch-up.** Bars on adjusted history are not tick-aligned either, so a high can pass
   the engine's raw target without reaching the limit rounded up to the next tick. The engine
   then counts the target and the layer stops re-issuing that leg, which would leave a third of
   the position with no order. When the position is larger than the engine's `tpHit` implies,
   the stale order is cancelled and the excess is closed at that bar's close.

The pass rule as originally written — entries sent equals n, Tester R against Engine Total R — is
therefore only meaningful where nothing is skipped. The rule the results are judged on is the
like-for-like one: Tester R within the larger of 2% or 0.5R of `Engine R, sent trades`, per chart.
That rule was written after seeing the first failure, and the validation document says so.

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
