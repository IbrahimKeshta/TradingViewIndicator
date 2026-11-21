# EGX Daily preset, and two exit tests: backup stop and time stop (2026-11-21)

Written and committed **before any result for the two new options was read**. Nothing below is changed after the run.
Results are appended at the end, under "Results".

## Why

The EGX100 work (2026-11-20) found that the best settings already exist in Pine but are off by default:
Stop on Close Only + Runner + Trailing Tier Major + Trail From Entry (sweep row 13, "rec"). This branch:

1. Adds a **Preset** input to the indicator. `EGX Daily` forces the rec settings (plus Long Trades Only, Apply Costs and a
   10-tick Min Risk floor, the settings every EGX number was measured with). `Custom` (the default) leaves every chart as
   it is today.
2. Tests two exits aimed at the two weak spots the record names:
   - **B, backup stop.** Stop on Close Only gives up the protection of an intrabar stop. Its known cost is fatter single
     losses (p10 of initial stops −1.67R vs −1.19R) and the risk of a locked limit-down day. A backup stop caps that.
   - **T, time stop.** 53% of trades end at the initial stop without a target, drifting against the trade for 2–8
     bars first. A time stop cuts trades that have not started working.

## Honest limit: this is in-sample

Every EGX symbol has been used in earlier tests (batches A–F, the 18 held-back names on 2026-11-20). There is no unseen
EGX data left. A pass here is therefore a **screening pass only**. It means "worth forward-testing", not "validated".

Consequence, decided now: an option that passes gets added to the Pine script as an input that is **off by default and
NOT folded into the EGX Daily preset**. It goes into the preset only after forward data (trades opened after 2026-11-21)
agrees. An option that fails is not added to Pine at all.

## Definitions

- **Base** = the EGX Daily preset in the Node port: `tv-base` (daily, Long Trades Only, Apply Costs 0.1%/side + 2 EGP per
  order, position 100,000, Min Risk 10 ticks) + `stopOnCloseOnly`, `runnerMode`, `trailTier: 'Major'`, `trailFromEntry`.
  Regression check: it must reproduce sweep row 13 (n 2478, avg R 0.480) on `data/egx` before anything else is read.
- **Data** = `data/egx`, all 100 symbols, full history, splits-adjusted (the verdict set). `data/egx-div` (20 symbols,
  dividend-adjusted, what TradingView shows) is reported as a side check and does not vote.
- **Periods** = by trade open date: pre-2023 (`< 2023-01-01`) and 2023+.
- R is net of costs. "Stocks better/worse" counts symbols with at least 5 base trades, comparing total R.
- **Drawdown in R** = the largest peak-to-trough fall of the running sum of trade R, trades ordered by exit date. This is
  the drawdown at a fixed 1% risk per trade, in % of the account.

### B, backup stop (`hardStopR = k`)

Only meaningful with Stop on Close Only, which the base has on. A long trade also exits **intrabar** when the low reaches
`entry − k × initial risk` (shorts mirrored), filled at that level, or at the open if the bar opens beyond it. The level
is fixed at entry and never moves. It is tested before the close-based stop on each bar. Exit reason: `Hard Stop`.

Grid: k ∈ {1.5, 2.0, 3.0}.

A grid point **passes** if all four hold:

1. Fewer trades lose more than 1.5R: the share of trades with R < −1.5 is lower than base.
2. Drawdown in R is no larger than base.
3. Avg R falls by no more than 0.02 overall, and by no more than 0.02 in each period.
4. Total R ≥ 95% of base total R.

B is insurance. It is allowed to cost a little average R (rule 3) but must actually reduce the tail (rules 1–2).

### T, time stop (`timeStopBars = N`)

Before TP1, once a trade has been open N bars or more, it exits at the close of the first bar that closes against the
entry (long: close < entry; shorts mirrored). Bars open = bar index − entry bar index. After TP1 it never fires. Exit
reason: `Time`.

Grid: N ∈ {5, 10, 20}.

A grid point **passes** if all five hold:

1. Avg R lift ≥ +0.03 overall.
2. Total R ≥ base total R in **both** periods (more money, not just a better average from fewer trades).
3. Avg R lift ≥ 0 in each period.
4. Stocks better ≥ stocks worse.
5. Avg R lift ≥ 0 after removing the one stock with the largest total-R gain.

If more than one point of a family passes, the one with the largest total-R gain is the pick. Every grid point is
reported, passing or not.

## What does not change

`validate.mjs --data data/egx-div --cut 2026-11-04` must stay at 91/91 with both new options at their off defaults (0).

## Results

(appended after the run)
