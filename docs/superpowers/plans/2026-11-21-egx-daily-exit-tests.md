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


Run 2026-11-21 by `tools/backtest/exit-tests.mjs` (engine unchanged apart from the two off-by-default keys). Before any
new result was read, two checks: `validate.mjs --data data/egx-div --cut 2026-11-04` still matches TradingView on every
row (102/102 chart-config reads, zero mismatches), and the base reproduces sweep row 13 exactly (n 2478, avg R 0.480,
total 1189.1R).

Reproduce:

```
export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"
node tools/backtest/exit-tests.mjs --data data/egx        # verdict
node tools/backtest/exit-tests.mjs --data data/egx-div    # side check
```

### Verdict: both fail, at every grid point

Neither option goes into the Pine script. Only the preset ships.

### Verdict set: `data/egx`, 100 symbols

| config | n | win % | avg R | pre-2023 avg R | 2023+ avg R | total R | pre-2023 total | 2023+ total | share R < -1.5 | p5 R | worst R | drawdown (R) | avg bars held | stocks better / worse | lift ex top stock (stock) | exits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base (EGX Daily) | 2478 | 42.5 | 0.480 | 0.438 | 0.568 | 1189.1 | 738.3 | 450.8 | 6.6% | -1.58 | -5.20 | 62.6 | 37.1 | - | - | Invalidated 1314, Stopped 1164 |
| B: hardStopR 1.5 | 2528 | 41.1 | 0.388 | 0.343 | 0.485 | 981.6 | 589.9 | 391.7 | 19.2% | -1.55 | -4.28 | 85.3 | 35.6 | 12 / 75 | -0.093 (VLMR) | Invalidated 1271, Stopped 660, Hard Stop 597 |
| B: hardStopR 2 | 2500 | 41.7 | 0.414 | 0.378 | 0.492 | 1035.8 | 641.7 | 394.0 | 9.2% | -2.03 | -4.28 | 74.4 | 36.4 | 9 / 59 | -0.067 (ENGC) | Invalidated 1293, Stopped 992, Hard Stop 215 |
| B: hardStopR 3 | 2482 | 42.3 | 0.461 | 0.421 | 0.547 | 1144.7 | 710.1 | 434.6 | 7.1% | -1.62 | -4.28 | 63.1 | 37.0 | 4 / 23 | -0.020 (AMOC) | Invalidated 1312, Stopped 1127, Hard Stop 43 |
| T: timeStopBars 5 | 3180 | 27.2 | 0.278 | 0.247 | 0.347 | 884.0 | 540.7 | 343.3 | 3.7% | -1.40 | -4.44 | 64.1 | 21.0 | 36 / 55 | -0.207 (SCEM) | Time 1638, Invalidated 858, Stopped 684 |
| T: timeStopBars 10 | 2858 | 33.2 | 0.359 | 0.323 | 0.438 | 1026.4 | 632.7 | 393.7 | 5.1% | -1.51 | -5.20 | 76.0 | 26.9 | 41 / 50 | -0.125 (SKPC) | Time 971, Invalidated 969, Stopped 918 |
| T: timeStopBars 20 | 2628 | 38.3 | 0.420 | 0.387 | 0.490 | 1102.7 | 693.0 | 409.7 | 6.1% | -1.57 | -5.20 | 72.3 | 32.6 | 42 / 43 | -0.063 (PHAR) | Invalidated 1122, Stopped 1109, Time 397 |

### Pass grid (rules as declared)

| config | rule 1 | rule 2 | rule 3 | rule 4 | rule 5 | verdict |
|---|---|---|---|---|---|---|
| B: hardStopR 1.5 | **FAIL** R<-1.5 19.2% vs 6.6% | **FAIL** DD 85.3 vs 62.6 | **FAIL** dAvg -0.092 / pre -0.095 / 2023+ -0.083 | **FAIL** total 981.6 vs 95% 1129.7 | - | FAIL |
| B: hardStopR 2 | **FAIL** R<-1.5 9.2% vs 6.6% | **FAIL** DD 74.4 vs 62.6 | **FAIL** dAvg -0.066 / pre -0.060 / 2023+ -0.077 | **FAIL** total 1035.8 vs 95% 1129.7 | - | FAIL |
| B: hardStopR 3 | **FAIL** R<-1.5 7.1% vs 6.6% | **FAIL** DD 63.1 vs 62.6 | **FAIL** dAvg -0.019 / pre -0.017 / 2023+ -0.021 | pass total 1144.7 vs 95% 1129.7 | - | FAIL |
| T: timeStopBars 5 | **FAIL** lift -0.202 | **FAIL** pre 540.7 vs 738.3; 2023+ 343.3 vs 450.8 | **FAIL** pre -0.191 / 2023+ -0.221 | **FAIL** 36 better / 55 worse | **FAIL** -0.207 ex SCEM | FAIL |
| T: timeStopBars 10 | **FAIL** lift -0.121 | **FAIL** pre 632.7 vs 738.3; 2023+ 393.7 vs 450.8 | **FAIL** pre -0.115 / 2023+ -0.131 | **FAIL** 41 better / 50 worse | **FAIL** -0.125 ex SKPC | FAIL |
| T: timeStopBars 20 | **FAIL** lift -0.060 | **FAIL** pre 693.0 vs 738.3; 2023+ 409.7 vs 450.8 | **FAIL** pre -0.051 / 2023+ -0.078 | **FAIL** 42 better / 43 worse | **FAIL** -0.063 ex PHAR | FAIL |

### Side check: `data/egx-div`, 20 symbols, dividend-adjusted (does not vote)

| config | n | win % | avg R | pre-2023 avg R | 2023+ avg R | total R | pre-2023 total | 2023+ total | share R < -1.5 | p5 R | worst R | drawdown (R) | avg bars held | stocks better / worse | lift ex top stock (stock) | exits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base (EGX Daily) | 576 | 39.1 | 0.409 | 0.404 | 0.421 | 235.8 | 159.3 | 76.5 | 6.3% | -1.57 | -3.32 | 31.0 | 36.4 | - | - | Invalidated 290, Stopped 286 |
| B: hardStopR 1.5 | 584 | 38.0 | 0.335 | 0.318 | 0.374 | 195.8 | 127.0 | 68.8 | 18.5% | -1.56 | -3.53 | 40.3 | 34.8 | 3 / 16 | -0.078 (VLMRA) | Invalidated 281, Stopped 158, Hard Stop 145 |
| B: hardStopR 2 | 580 | 38.3 | 0.350 | 0.340 | 0.371 | 202.9 | 135.0 | 67.9 | 8.8% | -2.04 | -3.53 | 37.1 | 35.8 | 0 / 14 | -0.061 (CNFN) | Invalidated 287, Stopped 237, Hard Stop 56 |
| B: hardStopR 3 | 576 | 38.7 | 0.394 | 0.385 | 0.413 | 226.8 | 151.6 | 75.2 | 6.9% | -1.59 | -3.53 | 31.0 | 36.4 | 0 / 7 | -0.016 (BTFH) | Invalidated 290, Stopped 272, Hard Stop 14 |
| T: timeStopBars 5 | 728 | 26.5 | 0.263 | 0.236 | 0.327 | 191.8 | 119.8 | 72.0 | 2.7% | -1.35 | -3.32 | 34.9 | 21.8 | 9 / 11 | -0.161 (HRHO) | Time 374, Invalidated 193, Stopped 161 |
| T: timeStopBars 10 | 655 | 31.9 | 0.360 | 0.325 | 0.442 | 236.0 | 148.9 | 87.1 | 4.4% | -1.46 | -3.32 | 28.5 | 27.3 | 12 / 8 | -0.060 (HRHO) | Time 224, Stopped 218, Invalidated 213 |
| T: timeStopBars 20 | 610 | 36.1 | 0.348 | 0.325 | 0.401 | 212.5 | 137.2 | 75.3 | 6.2% | -1.56 | -3.32 | 32.5 | 32.2 | 10 / 8 | -0.073 (EMFD) | Stopped 275, Invalidated 249, Time 86 |

### Pass grid (rules as declared)

| config | rule 1 | rule 2 | rule 3 | rule 4 | rule 5 | verdict |
|---|---|---|---|---|---|---|
| B: hardStopR 1.5 | **FAIL** R<-1.5 18.5% vs 6.3% | **FAIL** DD 40.3 vs 31.0 | **FAIL** dAvg -0.074 / pre -0.087 / 2023+ -0.047 | **FAIL** total 195.8 vs 95% 224.0 | - | FAIL |
| B: hardStopR 2 | **FAIL** R<-1.5 8.8% vs 6.3% | **FAIL** DD 37.1 vs 31.0 | **FAIL** dAvg -0.060 / pre -0.064 / 2023+ -0.050 | **FAIL** total 202.9 vs 95% 224.0 | - | FAIL |
| B: hardStopR 3 | **FAIL** R<-1.5 6.9% vs 6.3% | pass DD 31.0 vs 31.0 | pass dAvg -0.016 / pre -0.019 / 2023+ -0.008 | pass total 226.8 vs 95% 224.0 | - | FAIL |
| T: timeStopBars 5 | **FAIL** lift -0.146 | **FAIL** pre 119.8 vs 159.3; 2023+ 72.0 vs 76.5 | **FAIL** pre -0.168 / 2023+ -0.093 | **FAIL** 9 better / 11 worse | **FAIL** -0.161 ex HRHO | FAIL |
| T: timeStopBars 10 | **FAIL** lift -0.049 | **FAIL** pre 148.9 vs 159.3; 2023+ 87.1 vs 76.5 | **FAIL** pre -0.079 / 2023+ 0.021 | pass 12 better / 8 worse | **FAIL** -0.060 ex HRHO | FAIL |
| T: timeStopBars 20 | **FAIL** lift -0.061 | **FAIL** pre 137.2 vs 159.3; 2023+ 75.3 vs 76.5 | **FAIL** pre -0.079 / 2023+ -0.020 | pass 10 better / 8 worse | **FAIL** -0.073 ex EMFD | FAIL |

### Reading

- **The backup stop removes what Stop on Close is for.** At 1.5R it fires on 597 trades. Matched to the same trade in the
  base (578 of them, by symbol and entry date), those trades averaged **−0.93R** there and 14% of them won; with the
  backup stop they average **−1.31R**. Most were losers either way. The cost is that the backup stop books them at the
  bar's intrabar low, while in the base the same bar closed back up and the exit came at that better close. That is the
  wick effect Stop on Close was adopted for. So the share of trades below −1.5R *rises* (6.6% → 19.2%), average R falls by
  0.09 and the drawdown grows from 62.6R to 85.3R. At 2R: 215 trades, −0.94R in base vs −1.72R; at 3R: 43 trades, −1.40R
  vs −2.52R, still costing 0.02R per trade overall. Its one real benefit is the worst single trade (−5.20R → −4.28R).
  (Matched-trade figures from a one-off check after the run, not part of the declared rules.)
- **A flaw in rule 1, stated plainly.** Rule 1 counts the backup stop's own exits, which land just below −kR after costs,
  as tail losses. For k = 1.5 that biases the rule against it. It does not change any verdict: k = 1.5 and 2 fail rules
  2–4 as well, and k = 3 fails rules 2 and 3.
- **The time stop cuts winners.** Every N lowers average R (−0.20, −0.12, −0.06 at 5, 10, 20 bars) and total R in both
  periods. Under the preset, the trail runs from entry and there is no breakeven jump, so many trades that later run
  spend their first weeks below entry. This agrees with the six-stock finding that exits are, if anything, well timed.
- **The preset's tail is smaller than it looks.** Only 6.6% of base trades lose more than 1.5R, and the p5 trade is
  −1.58R. The fat-loss cost of Stop on Close is real but modest; the backup stop is more expensive than the risk it
  covers.

### What is left

The binding constraint is unchanged: no unseen EGX data. Options for a real test of the preset: forward-log its trades
from 2026-11-21, or fetch a different market as a fresh out-of-sample set.
