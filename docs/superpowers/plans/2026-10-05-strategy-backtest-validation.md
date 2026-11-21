# Strategy Tester Backtest — Live Pass Results

**Date:** 2026-10-05
**Script under test:** `src/ict-rsi-ma-strategy.pine`, generated from `src/ict-rsi-ma-indicator.pine` + `src/strategy-layer.pine`
**Spec:** `docs/superpowers/specs/2026-10-05-strategy-tester-backtest-design.md`
**Plan:** `docs/superpowers/plans/2026-10-05-strategy-tester-backtest.md` (Task 4)
**Method:** driven on the user's TradingView account with Playwright; Autosave off for each
session, layout restored by discard-reload afterwards, Autosave back on. Every figure below was
read from Pine Logs exported by a throwaway copy of the strategy with `Log Closed Trades` on and
one extra block that dumps `strategy.closedtrades.*` per leg, joined to the engine's own `TRADE`
lines by entry time. `Tester R` is `strategy.netprofit` ÷ 1000 (the fixed cash risk); per-trade
figures come from the joined legs.

**This document was corrected after an independent review.** Its first version understated the
worst per-trade differences: the analysis script compared a signed difference as a string, so
every positive difference was dropped from the "worst trade" columns. That hid one 0.64R mismatch
which is a different effect from tick size. The figures below are the reviewed ones.

## The pass rule, as declared before any number was read

> On each of ELEC 1D, ABUK 4H, MASR 1D and XRP 1H, at default settings, with the selected model
> flat, `Entries sent` equals `Engine n` exactly, and `Tester R` is within the larger of 2% or
> 0.5R of `Engine Total R`. All four must pass individually.

## Verdict

**As declared: 1 of 4 passed.** XRP 1H passed. MASR 1D, ELEC 1D and ABUK 4H failed.

**On tick-aligned data the order layer mirrors the engine closely.** XRP 1H: 77 trades, every one
within 0.01R, 0.10R apart in total, and equally close in all four exit-mode combinations.

**On split- and dividend-adjusted EGX history it does not, for two separate reasons**, neither of
which is fixable from inside the script:

1. **Price granularity.** The engine measures in R and is scale-free; the Tester fills in whole
   ticks. Old EGX prices are tiny against the 0.01 tick (MASR 0.09 in 2003, ELEC 0.015 in 2001),
   and a trade whose whole entry-to-stop distance is under a tick cannot be represented at all.
   This is most of the gap.
2. **Rounded-bar triggers.** Adjusted bars are off-tick, and the emulator rounds each bar to the
   nearest tick before testing an order. It can therefore fill a target or trigger a stop that
   the engine's raw comparison did not count, or miss one it did. This is rare, but when it
   happens the error is a whole third of the position, and it does not shrink as the tick floor
   rises.

The design was amended (spec, "Amendments from the live pass") and the charts re-run against a
like-for-like rule: Tester R against the engine's R over the trades actually sent. **That rule was
written after the first failure was seen.** On it, XRP 1H and ABUK 4H pass; ELEC 1D passes on only
10 trades, which validates little; **MASR 1D passes numerically only because two errors cancel**
(below). MASR should be read as not passing.

## First run — MASR 1D, original design

`Entries sent` 126 = `Engine n` 126. `Tester R` **−0.76R** against `Engine Total R` **+6.03R** —
a gap of 6.79R. Fail.

Traced trade by trade (126 engine trades, 342 Tester legs), bucketed by risk in ticks:

| Risk (ticks) | Trades | Engine R | Tester R | Difference | Worst single trade |
|---|---|---|---|---|---|
| under 2 | 20 | +8.80 | +3.23 | −5.57 | 3.99R |
| 2–5 | 25 | +5.58 | +4.65 | −0.93 | 0.46R |
| 5–10 | 17 | −0.85 | −0.68 | +0.17 | 0.69R |
| 10–20 | 47 | +2.57 | +1.61 | −0.96 | 0.41R |
| 20–50 | 14 | −7.55 | −7.07 | +0.48 | 0.64R |
| 50+ | 3 | −2.52 | −2.53 | −0.01 | 0.01R |

5.57R of the 6.79R gap sits in 20 trades with under 2 ticks of risk. The worst: opened 2003-06-01
at an adjusted 0.0881 with the stop at 0.0821. The engine ran it to its third target for +2.30R;
the Tester entered at 0.09, stopped at 0.08, −1.69R.

Two smaller effects showed in the wider buckets, both from rounded-bar triggers:

- **A target the engine counted and the Tester missed** (2022-01-03, 11 ticks, 0.41R). The
  target catch-up was added for this.
- **A target the Tester filled and the engine never counted** (2023-12-07, 26 ticks, 0.64R). The
  engine's first target was 3.8864; the bar's high fell just short and the engine stopped the
  trade out for −1.00R. The Tester's limit at 3.89 filled, and it finished −0.36R. This one was
  missed in the first version of this document and found by the review. It cannot be repaired
  after the fill; it is now counted.

## Changes made in response

In `src/strategy-layer.pine` (reasoning in the spec's amendments section):

1. `Minimum Risk (ticks)`, default 10 — trades under it send no order and are counted as skipped.
2. An `Engine R, sent trades` row — the engine's blended R over exactly the trades sent.
3. Target catch-up — closes a third the engine has counted and the Tester has not filled.
4. A `Diverged trades` counter — trades where the Tester filled something the engine had not.

Items 1–3 were made after the first run; item 4 after the review. The script was recompiled and
re-run on all four charts after each.

## Cross-check after the changes, default settings (final run)

| Chart | Engine n | Sent | Skipped | Engine R, sent | Tester R | Difference | Worst trade | Diverged |
|---|---|---|---|---|---|---|---|---|
| MASR 1D | 126 | 64 | 62 | −7.51 | −7.78 | −0.27 | 0.64R | 2 |
| ELEC 1D | 128 (+1 open) | 10 | 118 | −1.60 | −1.69 | −0.09 | 0.06R | 0 |
| ABUK 4H | 141 | 136 | 5 | +9.56 | +9.21 | −0.35 | 0.11R | 1 |
| XRP 1H | 77 | 77 | 0 | +9.71 | +9.61 | −0.10 | 0.01R | 0 |

Entries sent + skipped = engine n (plus the open trade on ELEC) on all four. XRP 1H was flat for
this run; in the earlier runs it had one trade open, which has since closed for −1.00R.

**MASR 1D, taken apart.** The −0.27R difference is +0.64R from the one diverged trade above plus
−0.92R of steady drift across the other 63 (−0.75R of it in the 47 trades with 10–20 ticks of
risk, about −0.016R each). Without the trade that is itself an error, −0.92R is outside the 0.5R
tolerance. The drift is a bias, not noise: order prices are rounded to the far side of each level,
so every stop fills up to a tick worse than the engine's raw level, and at 10–20 ticks of risk a
tick is 5–10% of R. It grows with the number of trades. The same lean shows on ABUK 4H (−0.35R
over 136 trades), inside the tolerance there but not far inside.

MASR's second diverged trade (2022-06-12) had its stop triggered a bar before the engine's. It
cost nothing in R because the engine stopped out the next day anyway; had price recovered it
would have cost a full loss against whatever the engine went on to make.

ABUK 4H's worst trade (2025-10-15, 0.11R, 52 ticks) is the documented gap-through-a-target case:
all three targets were reached on a bar that opened beyond them, and the Tester filled at the open.
ABUK's one diverged trade was not individually traced.

`Engine Total R` over all trades, for reference: MASR +6.03, ELEC +19.47, ABUK −1.98, XRP +9.71.

**On the default of 10 ticks.** It is a compromise between coverage and accuracy, not a measured
optimum — the data here does not bracket anything between 2 and 20. At 10, MASR sends 64 trades
and carries the drift above. At 20 it would send 17. The README and the input's tooltip say so.

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

None produced a compile or runtime error. (Run before the divergence counter was added, with one
trade open and nothing banked on it.)

| Runner | Stop on Close Only | Trades | Engine R, sent | Tester R | Worst trade |
|---|---|---|---|---|---|
| off | off | 76 | +10.71 | +10.62 | 0.01R |
| on | off | 73 | +2.96 | +2.85 | 0.01R |
| off | on | 75 | −0.08 | −0.07 | 0.00R |
| on | on | 71 | −7.34 | −7.34 | 0.01R |

The spec predicted `Stop on Close Only` would make the Tester read systematically better than the
engine. On XRP 1H it did not show. The prediction is not withdrawn — it needs a bar that wicks to
a target and closes through the stop, and this sample evidently has few — but it is not confirmed.

## What the live pass confirmed from the final review's list

| # | Item | Result |
|---|---|---|
| 1 | Compiles and loads; Runner, Stop on Close Only, both | Confirmed, no errors on any paste |
| 2 | Entry fills at the entry bar's close, no exit on that bar | Confirmed after the tick floor. Before it, four trades with under half a tick of risk entered and exited on one bar |
| 3 | Wick stop fills at the stop, or the open on a gap, on the engine's bar | Usually (e.g. MASR 2026-02-17: engine 5.1326, Tester 5.13, same bar). **Not always on adjusted data:** MASR 2022-06-12 stopped in the Tester a bar before the engine |
| 4 | Where a stop already through the market fills | Found: XRP 2026-01-30 short. The Tester's remaining legs fill at that bar's close, 1.7731; the engine exits on the next bar's open, 1.7731. One bar early, same price, 0.00R |
| 5 | After TP1, two legs remain and no second "TP1" appears | Confirmed — no trade has more than three legs |
| 6 | Quantities sum, no sliver | Confirmed — e.g. 1051 + 1051 + 1053 |
| 7 | Flat after every engine close; next-bar entry taken | Confirmed — position 0 at the end of every flat run |
| 8 | Invalidated exit at the close, with the reason as comment | Confirmed (MASR 2026-06-11: engine 6.62, Tester 6.62, comment `Invalidated`) |
| 9 | XRP 1H shorts symmetric; order limit not reached | Confirmed — shorts present throughout, 216 closed legs |
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

Caveats that matter:

- The EGX daily figures cover only the recent part of each chart's history, because the earlier
  trades are the ones skipped. ELEC's 7 trades are too few to read anything into.
- **XRP 1H was run with no position cap and is leveraged**: at the end it held about 95,000 XRP on
  roughly 110,000 of equity, and with a tighter stop it would have held more. `margin_long` and
  `margin_short` are 0, so the Tester never refuses a size. Set `Max Position` to match what the
  account can actually carry before trusting this row.
- XRP 1H spans roughly January–October 2026 only (the 1H history this plan loads).
- These runs predate the divergence counter. MASR's includes the 2023-12-07 trade.

## Realistic run with the user's costs (added 2026-10-06)

The user gave: commission 2 EGP, slippage 0.1%. Same settings as the table above, plus costs.

How they were modelled, and where that is approximate:

- **Commission:** 2 EGP **per order** (`strategy.commission.cash_per_order`), so a trade that
  scales out in thirds pays 8 EGP — one entry and three exits. Applied to the three EGX charts
  only; a fee in EGP has no meaning on XRPUSDT, which ran with slippage alone.
- **Slippage:** TradingView takes it in whole ticks, not percent, and applies it to market and
  stop fills, not to limit fills at targets. 0.1% was converted at each chart's current price:
  MASR 7.7 → 1 tick (0.13%), ABUK 87 → 9 ticks (0.10%), XRP 1.52 → 15 ticks (0.10%). **ELEC at
  1.9 needs 0.19 of a tick; the smallest setting is 1 tick, which is 0.5% — five times what was
  asked.** ELEC's row overstates slippage and should not be read as the answer for ELEC.
- A fixed tick count is a larger percentage on older, lower prices. The trades that remain after
  the tick floor are mostly recent, so the distortion is limited, but it is not zero.

| Chart | Trades | Net profit, no costs | Net profit, with costs | Max drawdown | Profit factor |
|---|---|---|---|---|---|
| ABUK 4H | 79 | +30,006 (+30.0%) | +4,782 (+4.8%) | 12,831 | 1.09 |
| MASR 1D | 40 | −281 (−0.3%) | −5,024 (−5.0%) | 9,039 | 0.79 |
| ELEC 1D | 7 | −623 (−0.6%) | −1,396 (−1.4%) | 3,555 | 0.70 |
| XRP 1H | 78 | (see note) | −5,437 (−5.4%) | 10,719 | 0.90 |

XRP's no-cost figure from the earlier table (+10,298 on 76 trades) is not the right comparison:
two more trades have closed since, both losses, taking the engine's total from +10.71R to +8.71R.
At 1% risk that is roughly 2,000 of the difference; the rest, about 13,700, is slippage.

**Slippage is the whole story; the 2 EGP commission is negligible** (79 trades × 8 EGP = 632 EGP on
ABUK, against a 25,000 swing). The reason 0.1% bites this hard is the stop distance. Position
size is set so that the stop costs 1% of equity, and the stops here are often 0.5–1.5% away from
entry, so a position is commonly worth about as much as the whole account. 0.1% of that, paid on
the entry and again on a stopped exit, is 0.1–0.2% of equity per trade — a tenth to a fifth of
the 1% at risk. A system whose average trade is a few hundredths of an R does not survive that.

What this does and does not show:

- It shows the results are highly sensitive to execution cost, and that at 0.1% per side only
  ABUK 4H stays positive, barely.
- It does not show the strategy loses money in practice. 0.1% on every market and stop fill may
  be pessimistic for a liquid name and optimistic for a thin one, and the engine enters at the
  bar's close, where a real order could be a limit instead of a market order.
- The run is still long-only on EGX, zero-cost on the financing side, and on the trades the tick
  floor lets through.

## Not done, and why

- **The Trail model.** Every run used `Backtest Model` = Pullback with the trail model off, as
  the defaults are. The Trail path through the layer compiled but was not exercised.
- **Target catch-up is lightly tested.** It fired on two trades in all the logs, both long, both
  non-runner, both in wick mode. It helped one (−0.41R → −0.09R) and slightly hurt the other
  (+0.07R → −0.04R); the price it exits at is that bar's close, which can be anywhere in the bar.
- **What was compiled.** Every run used a debug copy: the generated strategy with
  `Log Closed Trades` defaulted on and a logging block appended. The committed
  `src/ict-rsi-ma-strategy.pine` is line-for-line that text without those two changes (checked by
  diff), but that exact file was not itself pasted for the final version.
- **The Tester's own List of Trades export** was not used: on this plan the Strategy report is
  partly locked ("Upgrade to get full access"). Pine Logs served instead and gave per-leg data.
- **Compile errors met:** none, on any of the variants pasted.
