# Strategy Tester Backtest — Live Pass Results

**Date:** 2026-10-05
**Script under test:** `src/ict-rsi-ma-strategy.pine`, generated from `src/ict-rsi-ma-indicator.pine` + `src/strategy-layer.pine`
**Spec:** `docs/superpowers/specs/2026-10-05-strategy-tester-backtest-design.md`
**Plan:** `docs/superpowers/plans/2026-10-05-strategy-tester-backtest.md` (Task 4)
**Method:** driven on the user's TradingView account with Playwright; Autosave off for the session,
layout restored by discard-reload afterwards, Autosave back on. Every figure below was read from
Pine Logs exported by a throwaway copy of the strategy with `Log Closed Trades` on and one extra
block that dumps `strategy.closedtrades.*` per leg, joined to the engine's own `TRADE` lines by
entry time. `Tester R` is `strategy.netprofit` ÷ 1000 (the fixed cash risk); per-trade figures come
from the joined legs.

## The pass rule, as declared before any number was read

> On each of ELEC 1D, ABUK 4H, MASR 1D and XRP 1H, at default settings, with the selected model
> flat, `Entries sent` equals `Engine n` exactly, and `Tester R` is within the larger of 2% or
> 0.5R of `Engine Total R`. All four must pass individually.

## Verdict

**As declared: 1 of 4 passed.** XRP 1H passed. MASR 1D, ELEC 1D and ABUK 4H failed.

**The order layer itself is faithful.** On every trade whose risk is at least 20 ticks, on all
four charts, the Tester and the engine agree to within 0.08R per trade, and on XRP 1H — where
every trade is hundreds of ticks wide — to within 0.01R per trade and 0.09R in total over 76
trades.

**The failures have one cause, and it is not a bug in either side:** the engine measures in R and
is scale-free; the Tester fills in whole ticks. EGX history is split- and dividend-adjusted, so old
prices are tiny against the 0.01 tick (MASR 0.09 in 2003, ELEC 0.015 in 2001). A trade whose whole
entry-to-stop distance is under a tick cannot be represented by the Tester at all.

The design was amended (spec, "Amendments from the live pass") and the charts re-run. **On the
amended, like-for-like rule — Tester R against the engine's R over the trades actually sent — all
four pass.** That rule was written after the first failure was seen. It is reported as what it is:
a diagnosis-driven correction, not the pre-registered test.

## First run — MASR 1D, original design

`Entries sent` 126 = `Engine n` 126. `Tester R` **−0.76R** against `Engine Total R` **+6.03R** —
a gap of 6.79R. Fail.

Traced trade by trade (126 engine trades, 342 Tester legs), bucketed by risk in ticks:

| Risk (ticks) | Trades | Engine R | Tester R | Difference | Worst single trade |
|---|---|---|---|---|---|
| under 2 | 20 | +8.80 | +3.23 | −5.57 | 3.99R |
| 2–5 | 25 | +5.58 | +4.65 | −0.93 | 0.46R |
| 5–10 | 17 | −0.85 | −0.68 | +0.17 | 0.58R |
| 10–20 | 47 | +2.57 | +1.61 | −0.96 | 0.41R |
| 20–50 | 14 | −7.55 | −7.07 | +0.48 | 0.05R |
| 50+ | 3 | −2.52 | −2.53 | −0.01 | 0.01R |

5.57R of the 6.79R gap sits in 20 trades with under 2 ticks of risk. The worst: opened 2003-06-01
at an adjusted 0.0881 with the stop at 0.0821. The engine ran it to its third target for +2.30R;
the Tester entered at 0.09, stopped at 0.08, −1.69R.

The 10–20 bucket's 0.41R outlier was a second, smaller effect: opened 2022-01-03, the engine
counted the first target, the Tester's limit (rounded up one tick) was not reached by an
off-tick high, and that third was left with no order. That is what the target catch-up fixes.

## Changes made in response

In `src/strategy-layer.pine` (details and reasoning in the spec's amendments section):

1. `Minimum Risk (ticks)`, default 10 — trades under it send no order and are counted as skipped.
2. An `Engine R, sent trades` row — the engine's blended R over exactly the trades sent.
3. Target catch-up — closes a third the engine has counted and the Tester has not filled.

## Cross-check after the changes, default settings

| Chart | Engine n | Sent (closed) | Skipped | Engine R, sent | Tester R | Difference | Worst trade | Like-for-like rule |
|---|---|---|---|---|---|---|---|---|
| MASR 1D | 126 | 64 | 62 | −7.51 | −7.78 | −0.27 | 0.13R | pass |
| ELEC 1D | 128 (+1 open) | 10 | 118 | −1.60 | −1.69 | −0.09 | 0.06R | pass |
| ABUK 4H | 141 | 136 | 5 | +9.56 | +9.21 | −0.35 | 0.08R | pass |
| XRP 1H | 76 (+1 open) | 76 | 0 | +10.71 | +10.62 | −0.09 | 0.01R | pass |

Entries sent + skipped = engine n (plus the open trade) on all four. The Tester reads slightly
low on all four. That direction is expected: order prices are rounded to the tick on the far side
of each level, so a stop fills up to a tick worse than the engine's raw level.

`Engine Total R` over all trades, for reference: MASR +6.03, ELEC +19.47, ABUK −1.98, XRP +10.71.

**Something this surfaced that is worth the user's attention, separate from the Tester.** On the
EGX charts most of the recorded R comes from trades with a very small price distance to the stop:

- ELEC 1D: 118 of 129 trades have under 10 ticks of risk. They carry +21.07R of the +19.47R total.
- MASR 1D: 62 of 126, carrying +13.54R of +6.03R.
- ABUK 4H: only 5 of 141 — but those 5 total −11.54R, turning +9.56R into −1.98R.

This does not show those trades are wrong: adjusted prices keep their ratios, so the engine's R on
them may be perfectly sound. It does mean the Tester cannot confirm them, and that a handful of
tiny-denominator trades can dominate a chart's Total R in either direction.

## Engine unchanged by the build

The strategy's engine was compared with figures recorded from the indicator on 2026-09-17
(`docs/superpowers/plans/2026-09-17-trade-log-root-cause-diagnosis.md`):

| Chart | Indicator, 2026-09-17 | Strategy's engine, 2026-10-05 |
|---|---|---|
| ABUK 4H | n = 141, Total R −1.98 | n = 141, Total R −1.9758 |
| ELEC 1D | n = 128, Total R +19.47 | n = 128, Total R +19.4711 |

Identical. This replaces the plan's side-by-side check on one chart; the indicator was not added
a second time to the user's already crowded layout.

## Exit-mode combinations, XRP 1H

None produced a compile or runtime error.

| Runner | Stop on Close Only | Trades | Engine R, sent | Tester R | Worst trade |
|---|---|---|---|---|---|
| off | off | 76 | +10.71 | +10.62 | 0.01R |
| on | off | 73 | +2.96 | +2.85 | 0.01R |
| off | on | 75 | −0.08 | −0.07 | 0.00R |
| on | on | 71 | −7.34 | −7.34 | 0.01R |

The spec predicted `Stop on Close Only` would make the Tester read systematically better than the
engine. On XRP 1H it did not show: the two agree to within 0.01R. The prediction is not
withdrawn — it needs a bar that wicks to a target and closes through the stop, and this sample
evidently has few — but it is not confirmed either.

## What the live pass confirmed from the final review's list

| # | Item | Result |
|---|---|---|
| 1 | Compiles and loads; Runner, Stop on Close Only, both | Confirmed, first paste, no errors |
| 2 | Entry fills at the entry bar's close, no exit on that bar | Confirmed — every Tester entry time and price matches the engine's |
| 3 | Wick stop fills at the stop, or the open on a gap, on the engine's bar | Confirmed on sampled trades (e.g. MASR 2026-02-17: engine 5.1326, Tester 5.13, same bar) |
| 4 | Where a stop already through the market fills | Not isolated. No trade on these charts differed by more than 0.13R after the changes, so it is not material here, but the specific case was not found and inspected |
| 5 | After TP1, two legs remain and no second "TP1" appears | Confirmed — no trade has more than three legs |
| 6 | Quantities sum, no sliver | Confirmed — e.g. 1051 + 1051 + 1053 |
| 7 | Flat after every engine close; next-bar entry taken | Confirmed — position 0 at the end of every flat run |
| 8 | Invalidated exit at the close, with the reason as comment | Confirmed (MASR 2026-06-11: engine 6.62, Tester 6.62, comment `Invalidated`) |
| 9 | XRP 1H shorts symmetric; order limit not reached | Confirmed — shorts present throughout, 213 closed legs |
| 10 | Strategy's PERFORMANCE equals the indicator's | Confirmed against recorded figures, above |

`syminfo.mincontract` compiles and reads 1 on all four symbols.

## Realistic run — a first reading, not a pass/fail

`Sizing` = `% of Equity Risk` at 1.0%, initial capital 100,000, `Minimum Risk (ticks)` 10. On the
three EGX charts also `Long Trades Only` on and `Max Position` 100%. **Commission and slippage are
zero** — the user had not supplied their broker's figures — so every number here is before costs
and will be worse with them.

| Chart | Trades sent | Skipped | Net profit | Max drawdown | Profit factor | Capped |
|---|---|---|---|---|---|---|
| MASR 1D | 40 | 41 | −281 (−0.3%) | 6,398 | 0.99 | 0 |
| ELEC 1D | 7 | 71 | −623 (−0.6%) | 2,979 | 0.84 | 0 |
| ABUK 4H | 79 | 3 | +30,006 (+30.0%) | 11,111 | 1.70 | 0 |
| XRP 1H | 76 | 0 | +10,298 (+10.3%) | 6,818 | 1.25 | 0 |

The EGX daily figures cover only the recent part of each chart's history, because the earlier
trades are the ones skipped. ELEC's 7 trades are too few to read anything into. XRP 1H spans
roughly January–October 2026 only (the 1H history the plan loads).

## Not done, and why

- **Costs.** The realistic run needs the user's commission and slippage.
- **The Trail model.** Every run used `Backtest Model` = Pullback with the trail model off, as
  the defaults are. The Trail path through the layer compiled but was not exercised.
- **A stop already through the market** (item 4 above) was not isolated.
- **The Tester's own List of Trades export** was not used: on this plan the Strategy report is
  partly locked ("Upgrade to get full access"). Pine Logs served instead and gave per-leg data.
- **Compile errors met:** none. The strategy compiled on the first paste, and each of the seven
  later variants compiled first time.
