# Six-stock deep dive: stops and "Invalidated" exits on MASR, BTFH, EMFD, EFID, ORWE, EEII

Generated 2026-11-20 by `tools/backtest/six-stock.mjs` and `tools/backtest/variants.mjs`. Engine: `tools/backtest/ict-engine.mjs` (validated against TradingView, see below). Nothing here is committed.

## Verdict in six lines

1. **The user's observation is real but it is not evidence that the exits are bad.** After a pre-target Stop or "Invalidated" exit the stock does reach the next target within 40 bars about as often as it does from *any* random bar (EGX rises strongly in nominal terms: from a random bar MASR or EMFD reach +7-8% within 40 bars two times out of three). Pooled over the six, 37% of pre-target exits recovered to TP1 within 40 bars against 35% expected from any bar (z +0.3, base config). Over all 100 stocks the recovery is **below** the base rate (34% vs 36%, z -2.0 base; 27% vs 30%, z -2.9 for the recommended config). The exits are, if anything, slightly well-timed.
2. **What is actually wrong with the six is the stop, not the invalidation.** About half of all trades (93 of 188 on the six, base config) are initial stops averaging -1.04R, usually within a handful of bars of entry (median about 5 bars). Two thirds of base stops are wick-only (the bar closed back above the stop that day), but those do not recover more often than the base rate either. Pre-target "Invalidated" exits are rare in the base config (28 of 188 trades) and cost about -0.4R each.
3. **Under the recommended config ("rec") "Invalidated" is the dominant exit** (67 of 130 trades on the six, 53% of all 100-stock trades) but it is mostly a *profit* exit: it fires after TP1/TP2 on a runner and averages +0.8R to +2.6R on the six. Only the pre-target ones (25 of 67 on the six) are losses, about -0.4R.
4. **Removing or loosening the CHoCH exit does help the base config a little, in aggregate and in both periods** (all 100 stocks, split-adjusted: avg R 0.099 -> 0.152 with no CHoCH exit, 0.141 if the close must also be beyond entry; total R +172 / +146; pre-2023 and 2023+ both up). But the gain is about 0.04-0.05R per trade, it comes from a coin-flip breadth (V1: 44 stocks better, 47 worse; V3: 33 better, 27 worse, 38 unchanged), and on the 18 names held back in the earlier failure analysis V3 is slightly *worse* (-0.010R). It does not turn the six into winners (base V3 on the six: -5.8R over 185 trades, was -16.1R).
5. **On the recommended config the same change is a trade-off, not a fix.** Avg R per trade jumps 0.480 -> 0.765 (no CHoCH exit) but total R is flat (1189 -> 1201), trades fall 37%, average holding time goes from 37 to 89 bars, 2023+ total R falls from 451 to 275, R per 100 bars in a trade falls 1.29 -> 0.86, and 53 stocks get worse against 42 better. A variant only counts if it helps across the 100 AND in both periods; V4 and V5 fail that test.
6. **Bottom line:** the "stopped, then it rises" pattern is the EGX drift plus a high stop rate; no exit-rule change fixes it without giving something back. If anything is adopted it is V3 (invalidate only when the close is also beyond entry) on the *base* config as a small, mechanically sensible refinement, and rec stays as it is.

## What was run

* **Data.** Dividend-adjusted daily bars (`data/egx-div/`, what TradingView shows with ADJ on and the only data on which the port matches TradingView exactly) for the six stocks. BTFH, EMFD, EFID and EEII were fetched for this task with `fetch-egx.mjs ... --adjust dividends` (new flag; env `ADJ=dividends` works too; default stays `splits`). `EGX:EEII` resolved (3921 bars from 2003-01-19, mintick 0.01); `_meta.json` was merged, not overwritten (104 entries now). MASR and ORWE were already there. The 100-stock universe tests use `data/egx/` (split-adjusted, full history, all 100), as asked.
* **Configs.** `base` = preset `tv-base` (daily, Long Only, costs on, Min Risk 10 ticks). `rec` = tv-base + Stop on Close Only + Runner + Trailing Tier Major + Trail From Entry.
* **Trades** = closed trades over full history (nothing still open on any of the six). R = the trade's initial risk |entry - initial stop|; net R is after costs. Win = net R > 0.
* **Exit kinds.** *Stop* = the initial stop was hit. *Trail* = the stop had been trailed above the initial stop first (breakeven or locked profit, in rec also a trail from entry). *Invalidated* = the engine's internal CHoCH exit, booked at the close. *Target* = TP3 hit without Runner.
* **After the exit** (bars after the exit bar): highest high in R from the entry; whether and when the first target not yet reached at the exit (TP1 for a pre-target exit) was reached within 20 and 40 bars; the lowest low before that (or in 40 bars) in R from entry, so -1.00R is exactly the original stop; and a "hold" test, the same trade from entry with only the original stop (wick or close per config), no targets, 20 or 40 bars: R at the stop if stopped, else R at the close of bar 20/40 (gross of costs).
* **Control (the essential part).** For every trade, `X` = the rise from the exit close to the target it still needed. The control asks, over every bar of that stock (from bar 100 on), how often the high reached `close x (1 + X)` within 20 / 40 bars. Three populations: all bars, bars in an internal up-trend, and bars right after a 10-bar drop of about one median stop distance. The z score is (hits - expected) / sqrt(sum p(1-p)); overlapping windows make it optimistic, so |z| < 2 is read as "no evidence". The literal version asked for (X = median TP1 distance in % of entry, from every bar) is in the last column of the control table.
* **New engine option** (off by default): `invalidation`: `'on'` (Pine behaviour), `'off'`, `'major'` (only a Major-tier CHoCH), `'belowEntry'` (internal CHoCH counts only if that bar also closes beyond entry; long: close < entry). Trade records also carry `finalStop`. **Engine still exact**: `node tools/backtest/validate.mjs --data data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3` reproduces every chart-config read exactly on n and wins and within 0.05R per chart (pooled ict base 461/193/33.60 vs TradingView 33.61, runner r4 325/115/94.32 identical; all 9 groups 12/12 or 9/9 exact).

## 1. What actually happens: exit mix on the six (dividend-adjusted)

Counts are closed trades; "avg" is average net R of that exit kind.

| Stock | Config | Trades | Net R | Stop (initial) | Trail | Invalidated | Target |
|---|---|---|---|---|---|---|---|
| MASR | base | 40 | -0.17 | 19 (-1.03R) | 10 (+0.72R) | 5 (-0.37R) | 6 (+2.34R) |
| MASR | rec | 28 | +4.72 | 11 (-0.94R) | 1 (+1.03R) | 16 (+0.88R) | - |
| BTFH | base | 28 | +1.23 | 11 (-1.05R) | 4 (+0.83R) | 8 (-0.36R) | 5 (+2.47R) |
| BTFH | rec | 23 | +0.79 | 9 (-1.38R) | 1 (+0.17R) | 13 (+1.01R) | - |
| EMFD | base | 35 | -7.83 | 20 (-1.04R) | 6 (+0.71R) | 5 (+0.07R) | 4 (+2.08R) |
| EMFD | rec | 28 | -12.20 | 17 (-1.23R) | - | 11 (+0.80R) | - |
| EFID | base | 34 | -2.02 | 16 (-1.06R) | 11 (+0.97R) | 5 (-0.25R) | 2 (+2.74R) |
| EFID | rec | 20 | +13.11 | 10 (-1.01R) | 1 (-0.16R) | 9 (+2.59R) | - |
| ORWE | base | 43 | -9.16 | 25 (-1.04R) | 9 (+0.54R) | 4 (-0.49R) | 5 (+2.80R) |
| ORWE | rec | 25 | +10.32 | 11 (-1.26R) | - | 14 (+1.73R) | - |
| EEII | base | 8 | +1.81 | 2 (-1.01R) | 2 (+0.31R) | 2 (-0.65R) | 2 (+2.26R) |
| EEII | rec | 6 | +5.09 | 2 (0.00R) | - | 4 (+1.27R) | - |
| **Six, base** | | 188 | -16.1 | 93 (49%) | 42 | 29 | 24 |
| **Six, rec** | | 130 | +21.8 | 60 | 3 | 67 | - |

Reading it: in base, stops are about half of all trades and almost exactly -1R each (the stop-loss itself is working as designed; the six simply have a stop rate above what the winners can pay for). "Invalidated" is 5 to 8 trades per stock, of which 28 of 29 happen before any target. In rec, stop-on-close makes the average stop a bit worse than -1R (the exit is the close, not the stop level: -1.23R, -1.26R, -1.38R on three stocks) and "Invalidated" becomes the main exit because the runner trail keeps trades alive until a CHoCH ends them, usually in profit.

The base-config pre-target exits take (median over the 100 stocks) about 5 bars for a Stop and about 25 bars for an Invalidated exit. 1192 of the 1839 pre-target base stops on the 100-stock universe (65%) were wick stops: the bar closed back above the stop.

## 2. The control: is the recovery after the exit unusual?

Per stock, pre-target exits only (Stop plus Invalidated before any target was hit), recovery = reached TP1 within the window after the exit bar. "Expected" is the number of recoveries the control predicts for those same trades from random bars of that stock.

| Stock | Config | Pre-target exits (Stop + Invalidated) | reached TP1 within 20 bars | expected from any bar (control) | reached TP1 within 40 bars | expected (control) | z at 40 | Literal control: +X% (X = median TP1 distance) within 20 / 40 bars from any bar |
|---|---|---|---|---|---|---|---|---|
| MASR | base | 24 | 8/24 | 6.8 | 12/24 | 10.1 | 0.8 | 52% / 66% |
| MASR | rec | 13 | 3/13 | 3.1 | 5/13 | 4.8 | 0.2 | 50% / 64% |
| BTFH | base | 19 | 0/19 | 2.8 | 4/19 | 4.7 | -0.4 | 27% / 41% |
| BTFH | rec | 17 | 1/17 | 2.5 | 3/17 | 4.1 | -0.7 | 27% / 41% |
| EMFD | base | 25 | 2/25 | 5.9 | 6/24 | 9.2 | -1.5 | 54% / 68% |
| EMFD | rec | 19 | 1/19 | 3.2 | 4/19 | 5.8 | -1.0 | 52% / 67% |
| EFID | base | 20 | 5/20 | 5.2 | 8/20 | 7.9 | 0.0 | 40% / 56% |
| EFID | rec | 11 | 1/11 | 2.2 | 3/11 | 3.7 | -0.5 | 38% / 54% |
| ORWE | base | 29 | 5/29 | 5.9 | 14/29 | 10.0 | 1.7 | 43% / 59% |
| ORWE | rec | 14 | 2/14 | 2.5 | 3/14 | 4.3 | -0.8 | 44% / 61% |
| EEII | base | 4 | 0/4 | 0.2 | 0/4 | 0.4 | -0.7 | 33% / 50% |
| EEII | rec | 3 | 0/3 | 0.1 | 0/3 | 0.3 | -0.6 | 33% / 50% |

Reading it: only ORWE base (14 of 29 vs 10.0 expected, z +1.7) and MASR base (12 vs 10.1) sit above the base rate, and neither is significant; EMFD and BTFH sit below it. Pooled over the six (next table) the recovery rate is at the control level, and pooled over all 100 stocks (the table after) it is *below* it. The literal control shows why the pattern looks so convincing on a chart: from an arbitrary bar of MASR or EMFD the high reaches +7-8% inside 40 bars about two times in three, so almost any exit is followed by a rise.

Held test (100 stocks, pooled, hold = only the original stop, no targets, gross R; avg actual R is net of costs of roughly 0.1R): pre-target Invalidated exits averaged -0.28R actual vs +0.07R if held 40 bars (base, n=379) and -0.34R vs -0.06R (rec, n=395); 39% / 38% of those held trades were ahead after 40 bars. Pre-target Stops are unrecoverable by construction (-1.09R actual, -1.04R held). Post-TP1 Invalidated exits in rec: +1.41R actual vs +1.17R held (n=351), so the exit is *better* than holding there. This is the only place where an exit rule has anything to give, and it is about 0.3R on 10% (base) to 16% (rec) of the trades, i.e. the V1-V3 variants below.

### 2a. Pooled over the six stocks

Hits = exits after which the next unreached target was reached within N bars; expected = what the control predicts (all bars of the same stock, same price distance from the exit close); z = (hits - expected) / sqrt(sum p(1-p)). Overlapping windows make z optimistic, so |z| < 2 means no evidence.

| Config | Exit set | n | hits 20 | expected 20 (all bars / up-trend / after-drop) | z 20 | hits 40 | expected 40 (all / up / drop) | z 40 |
|---|---|---|---|---|---|---|---|---|
| base | Stop, no target reached | 93 | 18/93 (19%) | 21.7 / 21.8 / 24.9 | -1.0 | 37/92 (40%) | 33.7 / 34.1 / 36.5 | 0.8 |
| base |   of which closed back ABOVE the stop that day (wick only) | 64 | 15/64 (23%) | 15.9 / 15.9 / 18.3 | -0.3 | 30/63 (48%) | 24.4 / 24.5 / 26.3 | 1.6 |
| base |   of which closed at/below the stop | 29 | 3/29 (10%) | 5.8 / 5.9 / 6.6 | -1.4 | 7/29 (24%) | 9.4 / 9.6 / 10.2 | -1.0 |
| base | Invalidated, no target reached | 28 | 2/28 (7%) | 5.2 / 5.4 / 5.9 | -1.6 | 7/28 (25%) | 8.6 / 8.8 / 9.4 | -0.7 |
| base | All pre-target exits (Stop+Invalidated) | 121 | 20/121 (17%) | 26.8 / 27.2 / 30.8 | -1.6 | 44/120 (37%) | 42.4 / 42.9 / 45.8 | 0.3 |
| base | Stop/trail after TP1+ (next target) | 42 | 12/42 (29%) | 12.0 / 12.0 / 13.7 | 0.0 | 17/41 (41%) | 17.7 / 18.1 / 19.2 | -0.2 |
| rec | Stop, no target reached | 52 | 7/52 (13%) | 9.3 / 9.5 / 10.4 | -0.9 | 12/52 (23%) | 15.7 / 15.8 / 16.9 | -1.2 |
| rec | Invalidated, no target reached | 25 | 1/25 (4%) | 4.4 / 4.6 / 5.1 | -1.9 | 6/25 (24%) | 7.2 / 7.3 / 7.9 | -0.6 |
| rec | All pre-target exits (Stop+Invalidated) | 77 | 8/77 (10%) | 13.8 / 14.1 / 15.5 | -1.8 | 18/77 (23%) | 23.0 / 23.1 / 24.8 | -1.3 |
| rec | Invalidated after TP1+ (next target) | 17 | 3/17 (18%) | 2.4 / 2.4 / 2.8 | 0.4 | 6/16 (38%) | 4.2 / 4.2 / 4.5 | 1.1 |
| rec | Stop/trail after TP1+ (next target) | 9 | 2/9 (22%) | 1.3 / 1.3 / 1.4 | 0.7 | 2/9 (22%) | 2.5 / 2.6 / 2.7 | -0.4 |
| base | Invalidated after TP1+ (next target) | 1 | 0/1 (0%) | 0.0 / 0.0 / 0.0 | -0.1 | 1/1 (100%) | 0.1 / 0.1 / 0.1 | 3.6 |


### 2b. Pooled over all 100 symbols of data/egx (split-adjusted)

Hits = exits after which the next unreached target was reached within N bars; expected = what the control predicts (all bars of the same stock, same price distance from the exit close); z = (hits - expected) / sqrt(sum p(1-p)). Overlapping windows make z optimistic, so |z| < 2 means no evidence.

| Config | Exit set | n | hits 20 | expected 20 (all bars / up-trend / after-drop) | z 20 | hits 40 | expected 40 (all / up / drop) | z 40 |
|---|---|---|---|---|---|---|---|---|
| base | Stop, no target reached | 1839 | 410/1836 (22%) | 455.2 / 482.2 / 497.1 | -2.7 | 657/1820 (36%) | 683.8 / 714.7 / 727.6 | -1.4 |
| base |   of which closed back ABOVE the stop that day (wick only) | 1192 | 301/1190 (25%) | 327.7 / 345.6 / 358.7 | -1.9 | 460/1183 (39%) | 477.9 / 497.7 / 509.7 | -1.2 |
| base |   of which closed at/below the stop | 647 | 109/646 (17%) | 127.5 / 136.6 / 138.4 | -2.0 | 197/637 (31%) | 205.9 / 216.9 / 217.9 | -0.8 |
| base | Invalidated, no target reached | 379 | 52/379 (14%) | 65.4 / 70.6 / 71.8 | -1.9 | 95/376 (25%) | 108.8 / 114.8 / 116.4 | -1.7 |
| base | All pre-target exits (Stop+Invalidated) | 2218 | 462/2215 (21%) | 520.6 / 552.8 / 568.9 | -3.2 | 752/2196 (34%) | 792.5 / 829.5 / 844.1 | -2.0 |
| base | Stop/trail after TP1+ (next target) | 811 | 197/809 (24%) | 193.5 / 205.1 / 210.9 | 0.3 | 301/798 (38%) | 291.7 / 305.1 / 309.5 | 0.7 |
| rec | Stop, no target reached | 971 | 138/969 (14%) | 176.6 / 190.8 / 192.1 | -3.4 | 262/963 (27%) | 292.9 / 310.3 / 311.7 | -2.3 |
| rec | Invalidated, no target reached | 395 | 46/395 (12%) | 68.2 / 73.6 / 75.1 | -3.2 | 99/391 (25%) | 113.4 / 119.6 / 121.9 | -1.7 |
| rec | All pre-target exits (Stop+Invalidated) | 1366 | 184/1364 (13%) | 244.8 / 264.4 / 267.1 | -4.6 | 361/1354 (27%) | 406.3 / 429.9 / 433.6 | -2.9 |
| rec | Invalidated after TP1+ (next target) | 351 | 36/349 (10%) | 45.9 / 49.8 / 49.9 | -1.7 | 73/342 (21%) | 81.4 / 86.2 / 87.0 | -1.1 |
| rec | Stop/trail after TP1+ (next target) | 147 | 14/147 (10%) | 20.2 / 22.2 / 21.6 | -1.6 | 31/146 (21%) | 36.7 / 39.6 / 38.6 | -1.2 |
| base | Invalidated after TP1+ (next target) | 19 | 1/19 (5%) | 2.4 / 2.4 / 2.6 | -1.0 | 5/19 (26%) | 4.4 / 4.5 / 4.8 | 0.3 |


## 3. Per-symbol detail (dividend-adjusted)

Each block: exit mix, then recovery of pre-target and post-TP exits against the control (three control populations), the median bars held and the hold test; then the full trade list (collapsed). CSVs with the same columns: `data/six-stock-out/trades-<SYMBOL>-<config>.csv`. Columns of the lists: max hi = highest high within 10/20/40 bars after the exit in R of the initial risk from entry; TP bars = bars after the exit bar until that target was first touched (within 40), `-` = not within 40; low R = lowest low after the exit until TP1 (or 40 bars) in R from entry (-1.00 = the original stop); hold = R of the same trade held from entry with only the original stop for 20 / 40 bars.

#### MASR  (2001-05-15 .. 2026-11-19, 6119 bars; EGX70; median initial risk 5.6% of entry)

**MASR / base**: 40 closed trades (0 still open), net -0.17R, wins 17. Exits: Stop 19 (avg -1.03R), Trail 10 (avg 0.72R), Invalidated 5 (avg -0.37R), Target 6 (avg 2.34R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 19 (avg -1.03R) | 6/19 (32%) | 28% / 27% / 34% | 8/19 (42%) | 42% / 42% / 46% | 5 | 0.66 | 0% | 0% | -1.00 |
|   of which closed back ABOVE the stop that day (wick only) | 15 (avg -1.03R) | 6/15 (40%) | 30% / 29% / 35% | 8/15 (53%) | 43% / 43% / 48% | 4 | 0.56 | 0% | 0% | -1.00 |
|   of which closed at/below the stop | 4 (avg -1.04R) | 0/4 (0%) | 22% / 22% / 26% | 0/4 (0%) | 36% / 37% / 41% | 10 | 0.88 | 0% | 0% | -1.00 |
| Invalidated, no target reached | 5 (avg -0.37R) | 2/5 (40%) | 29% / 28% / 34% | 4/5 (80%) | 44% / 44% / 48% | 14 | 2.54 | 60% | 60% | 1.19 |
| All pre-target exits (Stop+Invalidated) | 24 (avg -0.90R) | 8/24 (33%) | 28% / 27% / 34% | 12/24 (50%) | 42% / 42% / 47% | 6 | 0.88 | 13% | 13% | -0.54 |
| Stop/trail after TP1+ (next target) | 10 (avg 0.72R) | 1/10 (10%) | 30% / 29% / 35% | 2/10 (20%) | 44% / 44% / 48% | 14.5 | 0.93 | 50% | 20% | -0.46 |

Literal control for base (X = median TP1 distance 7.8% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 52% / 66%; up-trend 51% / 65%.

<details><summary>MASR base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2006-01-23 | 2006-02-09 | 0.696 | 0.525 | 0.867 | 1.039 | 1.210 | Stop | -1.01 | -0.3 / -0.3 / -0.3 | - / - / - | -2.65 | -1.0 / -1.0 |
| 2008-03-03 | 2008-03-24 | 1.909 | 1.804 | 2.014 | 2.119 | 2.224 | Trail tp2 | 0.96 | 2.8 / 4.3 / 4.3 | 5 / 7 / 12 | -0.19 | 1.4 / 3.2 |
| 2008-04-03 | 2008-05-06 | 2.082 | 1.966 | 2.197 | 2.313 | 2.429 | Trail tp2 | 1.10 | 0.9 / 0.9 / 0.9 | - / - / - | -5.56 | 0.8 / -1.0 |
| 2009-06-03 | 2009-06-23 | 1.119 | 0.965 | 2.360 | 2.513 | 2.667 | Stop | -1.01 | -0.6 / -0.6 / -0.5 | - / - / - | -2.23 | -1.0 / -1.0 |
| 2014-03-26 | 2014-03-27 | 1.363 | 1.258 | 1.468 | 1.573 | 1.677 | Stop | -1.03 | 0.5 / 1.5 / 4.5 | 15 / 25 / 30 | -1.95 | -1.0 / -1.0 |
| 2014-06-15 | 2014-06-17 | 1.851 | 1.745 | 1.956 | 2.061 | 2.167 | Stop | -1.03 | -0.3 / 1.7 / 4.1 | 16 / 31 / 34 | -2.38 | -1.0 / -1.0 |
| 2014-09-08 | 2014-10-12 | 2.092 | 1.941 | 2.343 | 2.495 | 2.646 | Trail tp1 | 0.52 | -0.4 / -0.2 / 0.2 | - / - / - | -2.74 | 0.3 / -1.0 |
| 2015-05-06 | 2015-05-14 | 2.118 | 1.991 | 2.263 | 2.353 | 2.480 | Stop | -1.03 | 2.5 / 2.5 / 2.5 | 5 / 8 / - | -1.26 | -1.0 / -1.0 |
| 2015-05-20 | 2015-06-14 | 2.177 | 2.046 | 2.353 | 2.484 | 2.615 | Trail tp1 | 0.41 | 0.3 / 0.3 / 0.3 | - / - / - | -4.67 | -0.1 / -1.0 |
| 2015-12-27 | 2016-01-13 | 1.982 | 1.881 | 2.201 | 2.436 | 2.537 | Stop | -1.04 | -0.5 / 0.7 / 1.8 | - / - / - | -3.16 | -1.0 / -1.0 |
| 2016-04-27 | 2016-04-28 | 2.383 | 2.232 | 2.573 | 2.662 | 2.721 | Invalidated | -0.50 | -0.5 / -0.5 / -0.3 | - / - / - | -4.58 | -1.0 / -1.0 |
| 2016-11-08 | 2016-12-21 | 2.357 | 2.082 | 2.721 | 2.996 | 3.272 | Target tp3 | 2.30 | 3.5 / 3.9 / 3.9 | 1 / 1 / 1 | 2.85 | 1.7 / 3.4 |
| 2017-01-08 | 2017-01-16 | 3.271 | 3.141 | 3.401 | 3.531 | 3.662 | Trail tp1 | 0.28 | 1.3 / 1.3 / 1.5 | 1 / - / - | 0.27 | -1.0 / -1.0 |
| 2017-12-14 | 2018-02-06 | 3.289 | 3.181 | 3.449 | 3.490 | 3.772 | Trail tp2 | 1.05 | 2.6 / 2.6 / 6.3 | 1 / 8 / 37 | 0.43 | 1.5 / 0.1 |
| 2018-03-13 | 2018-03-14 | 3.573 | 3.397 | 3.772 | 3.948 | 4.124 | Stop | -1.04 | 1.0 / 5.8 / 5.8 | 11 / 13 / 18 | -1.00 | -1.0 / -1.0 |
| 2018-04-15 | 2018-04-23 | 4.178 | 3.960 | 4.397 | 4.615 | 4.834 | Stop | -1.04 | -0.6 / -0.6 / -0.6 | - / - / - | -5.71 | -1.0 / -1.0 |
| 2020-08-11 | 2020-09-01 | 1.736 | 1.598 | 2.150 | 2.194 | 2.208 | Invalidated | -0.48 | -0.2 / -0.2 / 4.3 | 27 / 27 / 27 | -1.70 | -1.0 / -1.0 |
| 2020-10-13 | 2020-10-15 | 2.095 | 1.985 | 2.480 | 2.497 | 2.529 | Stop | -1.04 | -0.4 / -0.1 / 0.4 | - / - / - | -2.88 | -1.0 / -1.0 |
| 2020-12-02 | 2020-12-21 | 1.975 | 1.869 | 2.141 | 2.334 | 2.480 | Stop | -1.04 | 0.9 / 1.2 / 1.6 | - / - / - | -1.18 | -1.0 / -1.0 |
| 2022-01-03 | 2022-01-12 | 1.772 | 1.658 | 1.913 | 1.950 | 2.073 | Trail tp1 | 0.38 | 0.1 / 0.4 / 0.4 | - / - / - | -4.31 | -1.0 / -1.0 |
| 2022-06-12 | 2022-06-14 | 1.721 | 1.601 | 1.913 | 2.073 | 2.141 | Stop | -1.03 | 0.9 / 3.2 / 3.2 | 14 / 14 / - | -0.70 | -1.0 / -1.0 |
| 2022-07-17 | 2022-08-16 | 1.882 | 1.650 | 2.141 | 2.334 | 2.566 | Invalidated | 0.02 | 3.5 / 3.5 / 3.5 | 4 / 4 / 7 | 0.00 | 0.5 / 3.0 |
| 2022-08-22 | 2022-08-31 | 2.356 | 2.024 | 2.688 | 3.019 | 3.351 | Trail tp1 | 0.32 | 0.9 / 0.9 / 0.9 | - / - / - | -1.26 | -0.2 / -1.0 |
| 2022-12-01 | 2022-12-13 | 2.443 | 2.321 | 2.663 | 2.695 | 2.817 | Target tp3 | 2.27 | 4.5 / 4.5 / 6.0 | 1 / 1 / 1 | 3.36 | 1.0 / 2.7 |
| 2023-01-04 | 2023-01-12 | 2.813 | 2.608 | 3.018 | 3.222 | 3.427 | Stop | -1.03 | 1.8 / 1.8 / 1.8 | 3 / - / - | -0.54 | -1.0 / -1.0 |
| 2023-06-05 | 2023-06-15 | 2.972 | 2.841 | 3.128 | 3.175 | 3.306 | Trail tp2 | 0.87 | 0.6 / 0.6 / 0.6 | - / - / - | -2.02 | -1.0 / -1.0 |
| 2023-11-26 | 2023-12-03 | 3.122 | 3.001 | 3.243 | 3.364 | 3.486 | Target tp3 | 1.94 | 6.4 / 6.4 / 6.4 | 1 / 1 / 1 | 3.25 | 0.9 / 3.2 |
| 2023-12-07 | 2023-12-21 | 3.625 | 3.364 | 3.886 | 4.147 | 4.409 | Stop | -1.03 | 0.1 / 0.4 / 3.3 | 30 / 33 / 39 | -2.28 | -1.0 / -1.0 |
| 2024-02-19 | 2024-02-25 | 4.448 | 4.104 | 4.792 | 5.136 | 5.480 | Stop | -1.03 | 0.2 / 0.2 / 0.2 | - / - / - | -5.00 | -1.0 / -1.0 |
| 2024-08-27 | 2024-10-08 | 3.580 | 3.438 | 3.900 | 4.817 | 4.959 | Trail tp1 | 1.35 | 1.2 / 1.4 / 2.1 | - / - / - | -1.25 | 2.8 / -1.0 |
| 2025-03-03 | 2025-04-16 | 3.598 | 3.481 | 3.873 | 4.104 | 4.122 | Target tp3 | 3.67 | 6.3 / 6.3 / 7.4 | 1 / 1 / 1 | 3.74 | 2.9 / 4.8 |
| 2025-04-23 | 2025-05-19 | 4.210 | 4.005 | 4.817 | 5.023 | 5.228 | Stop | -1.04 | 0.9 / 1.2 / 1.9 | - / - / - | -2.56 | -1.0 / -1.0 |
| 2025-05-29 | 2025-06-15 | 4.322 | 4.090 | 4.817 | 5.049 | 5.281 | Stop | -1.04 | -0.1 / 1.1 / 1.2 | - / - / - | -2.76 | -1.0 / -1.0 |
| 2025-07-23 | 2025-07-29 | 4.416 | 4.255 | 4.817 | 4.978 | 5.138 | Stop | -1.06 | -0.3 / -0.3 / -0.3 | - / - / - | -4.04 | -1.0 / -1.0 |
| 2025-10-20 | 2025-12-02 | 3.993 | 3.893 | 4.604 | 4.817 | 4.918 | Invalidated | -0.36 | 3.0 / 3.0 / 6.6 | 34 / - / - | -1.03 | 1.9 / 2.1 |
| 2026-01-13 | 2026-01-21 | 4.078 | 3.927 | 4.237 | 4.294 | 4.604 | Target tp3 | 1.93 | 5.5 / 9.5 / 10.3 | 1 / 1 / 1 | 2.86 | 7.1 / 9.8 |
| 2026-02-04 | 2026-02-12 | 4.735 | 4.556 | 4.915 | 5.094 | 5.274 | Target tp3 | 1.94 | 4.3 / 5.0 / 7.3 | 1 / 1 / 1 | 2.67 | 2.5 / 5.8 |
| 2026-02-17 | 2026-02-19 | 5.450 | 5.133 | 5.766 | 6.083 | 6.400 | Stop | -1.03 | -0.1 / 0.6 / 2.1 | 28 / 39 / - | -2.37 | -1.0 / -1.0 |
| 2026-05-18 | 2026-06-11 | 6.890 | 6.374 | 7.407 | 7.923 | 8.439 | Invalidated | -0.55 | 1.5 / 2.5 / 3.1 | 4 / 19 / 23 | -0.52 | 0.7 / 2.8 |
| 2026-09-08 | 2026-09-14 | 8.450 | 7.917 | 8.983 | 9.515 | 10.05 | Stop | -1.03 | -0.8 / -0.8 / -0.8 | - / - / - | -5.35 | -1.0 / -1.0 |

</details>

**MASR / rec**: 28 closed trades (0 still open), net 4.72R, wins 13. Exits: Stop 11 (avg -0.94R), Trail 1 (avg 1.03R), Invalidated 16 (avg 0.88R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 8 (avg -1.25R) | 2/8 (25%) | 19% / 19% / 23% | 2/8 (25%) | 30% / 30% / 34% | 8 | -0.32 | 0% | 0% | -1.22 |
| Invalidated, no target reached | 5 (avg -0.37R) | 1/5 (20%) | 33% / 32% / 38% | 3/5 (60%) | 47% / 47% / 52% | 14 | 1.08 | 60% | 60% | 0.73 |
| All pre-target exits (Stop+Invalidated) | 13 (avg -0.91R) | 3/13 (23%) | 24% / 24% / 29% | 5/13 (38%) | 37% / 37% / 40% | 13 | 0.05 | 23% | 23% | -0.47 |
| Invalidated after TP1+ (next target) | 5 (avg 0.82R) | 1/5 (20%) | 20% / 19% / 24% | 1/5 (20%) | 33% / 34% / 36% | 28 | 0.65 | 60% | 40% | -0.16 |
| Stop/trail after TP1+ (next target) | 3 (avg -0.11R) | 0/3 (0%) | 14% / 15% / 17% | 0/3 (0%) | 27% / 28% / 30% | 12 | 0.21 | 33% | 0% | -1.18 |

Literal control for rec (X = median TP1 distance 8.2% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 50% / 64%; up-trend 50% / 63%.

<details><summary>MASR rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2006-01-23 | 2006-02-16 | 0.696 | 0.525 | 0.867 | 1.039 | 1.210 | Stop | -1.24 | -0.8 / -0.8 / -0.8 | - / - / - | -2.65 | -1.2 / -1.2 |
| 2008-03-03 | 2008-05-11 | 1.909 | 1.804 | 2.014 | 2.119 | 2.224 | Invalidated tp3 | 1.52 | 1.6 / 1.6 / 1.6 | 1 / - / - | 0.39 | 1.4 / 3.2 |
| 2009-06-03 | 2009-06-25 | 1.119 | 0.965 | 2.360 | 2.513 | 2.667 | Stop | -1.40 | -0.8 / -0.7 / -0.5 | - / - / - | -2.23 | -1.4 / -1.4 |
| 2014-03-26 | 2014-03-31 | 1.363 | 1.258 | 1.468 | 1.573 | 1.677 | Stop | -1.33 | 0.5 / 1.5 / 4.5 | 13 / 23 / 28 | -1.86 | -1.3 / -1.3 |
| 2014-06-15 | 2014-06-18 | 1.851 | 1.745 | 1.956 | 2.061 | 2.167 | Stop | -1.05 | -0.3 / 1.7 / 4.7 | 15 / 30 / 33 | -2.38 | -1.0 / -1.0 |
| 2014-09-08 | 2014-10-14 | 2.092 | 1.941 | 2.343 | 2.495 | 2.646 | Stop tp1 | -0.40 | -1.1 / 0.2 / 0.2 | - / - / - | -2.74 | 0.3 / -1.4 |
| 2015-05-06 | 2015-06-23 | 2.118 | 1.991 | 2.263 | 2.353 | 2.480 | Invalidated tp2 | 0.96 | 0.6 / 0.6 / 0.6 | - / - / - | -6.01 | 1.8 / -1.1 |
| 2015-12-27 | 2016-01-13 | 1.982 | 1.881 | 2.201 | 2.436 | 2.537 | Stop | -1.51 | -0.5 / 0.7 / 1.8 | - / - / - | -3.16 | -1.5 / -1.5 |
| 2016-04-27 | 2016-04-28 | 2.383 | 2.232 | 2.573 | 2.662 | 2.721 | Invalidated | -0.50 | -0.5 / -0.5 / -0.3 | - / - / - | -4.58 | -1.1 / -1.1 |
| 2016-11-08 | 2017-01-30 | 2.357 | 2.082 | 2.721 | 2.996 | 3.272 | Invalidated tp3 | 2.02 | 2.5 / 3.3 / 4.0 | 1 / 1 / 24 | 1.64 | 1.7 / 3.4 |
| 2017-12-14 | 2018-05-22 | 3.289 | 3.181 | 3.449 | 3.490 | 3.772 | Invalidated tp3 | 1.22 | 1.8 / 1.8 / 2.2 | 4 / 21 / - | 0.20 | 1.5 / 0.1 |
| 2020-08-11 | 2020-09-01 | 1.736 | 1.598 | 2.150 | 2.194 | 2.208 | Invalidated | -0.48 | -0.2 / -0.2 / 4.3 | 27 / 27 / 27 | -1.70 | -1.1 / -1.1 |
| 2020-10-13 | 2020-10-18 | 2.095 | 1.985 | 2.480 | 2.497 | 2.529 | Stop | -1.31 | -0.4 / 0.0 / 0.4 | - / - / - | -2.88 | -1.3 / -1.3 |
| 2020-12-02 | 2021-02-15 | 1.975 | 1.869 | 2.141 | 2.334 | 2.480 | Invalidated | 0.06 | 1.1 / 1.1 / 1.1 | - / - / - | -1.57 | 0.1 / 0.8 |
| 2022-01-03 | 2022-01-13 | 1.772 | 1.658 | 1.913 | 1.950 | 2.073 | Invalidated tp1 | -0.05 | -0.4 / 0.4 / 0.4 | - / - / - | -4.31 | -1.2 / -1.2 |
| 2022-06-12 | 2022-08-16 | 1.721 | 1.601 | 1.913 | 2.073 | 2.141 | Invalidated tp2 | 1.96 | 8.1 / 8.1 / 8.1 | 1 / 2 / 4 | 1.36 | 2.5 / 2.0 |
| 2022-08-22 | 2022-09-18 | 2.356 | 2.024 | 2.688 | 3.019 | 3.351 | Invalidated tp1 | 0.10 | 0.4 / 0.4 / 0.4 | - / - / - | -1.26 | -0.2 / -1.0 |
| 2022-12-01 | 2023-03-13 | 2.443 | 2.321 | 2.663 | 2.695 | 2.817 | Trail tp3 | 1.03 | 0.5 / 2.6 / 3.9 | 16 / 16 / 25 | -3.04 | 1.0 / 2.7 |
| 2023-06-05 | 2023-06-21 | 2.972 | 2.841 | 3.128 | 3.175 | 3.306 | Stop tp2 | 0.53 | 0.6 / 0.6 / 0.6 | - / - / - | -2.02 | -1.0 / -1.0 |
| 2023-11-26 | 2024-01-31 | 3.122 | 3.001 | 3.243 | 3.364 | 3.486 | Invalidated tp3 | 0.95 | 9.9 / 14.0 / 14.0 | 1 / 2 / 2 | -0.76 | 0.9 / 3.2 |
| 2024-02-19 | 2024-02-28 | 4.448 | 4.104 | 4.792 | 5.136 | 5.480 | Stop tp1 | -0.46 | -0.3 / -0.3 / -0.3 | - / - / - | -5.32 | -1.1 / -1.1 |
| 2024-08-27 | 2024-10-08 | 3.580 | 3.438 | 3.900 | 4.817 | 4.959 | Invalidated tp1 | 1.11 | 1.2 / 1.4 / 2.1 | - / - / - | -1.25 | 2.8 / 0.6 |
| 2025-03-03 | 2025-06-17 | 3.598 | 3.481 | 3.873 | 4.104 | 4.122 | Invalidated tp3 | 3.09 | 6.5 / 8.6 / 8.6 | 1 / 5 / 5 | 2.03 | 2.9 / 4.8 |
| 2025-07-23 | 2025-08-12 | 4.416 | 4.255 | 4.817 | 4.978 | 5.138 | Stop | -1.11 | -0.9 / -0.9 / -0.9 | - / - / - | -4.04 | -1.1 / -1.1 |
| 2025-10-20 | 2025-12-02 | 3.993 | 3.893 | 4.604 | 4.817 | 4.918 | Invalidated | -0.36 | 3.0 / 3.0 / 6.6 | 34 / - / - | -1.03 | 1.9 / 2.1 |
| 2026-01-13 | 2026-03-29 | 4.078 | 3.927 | 4.237 | 4.294 | 4.604 | Invalidated tp3 | 2.96 | 13.0 / 13.5 / 21.6 | 1 / 1 / 1 | 5.47 | 7.1 / 9.8 |
| 2026-05-18 | 2026-06-11 | 6.890 | 6.374 | 7.407 | 7.923 | 8.439 | Invalidated | -0.55 | 1.5 / 2.5 / 3.1 | 4 / 19 / 23 | -0.52 | 0.7 / 2.8 |
| 2026-09-08 | 2026-09-14 | 8.450 | 7.917 | 8.983 | 9.515 | 10.05 | Stop | -1.05 | -0.8 / -0.8 / -0.8 | - / - / - | -5.35 | -1.0 / -1.0 |

</details>


#### BTFH  (2008-09-10 .. 2026-11-19, 3637 bars; EGX30; median initial risk 9.4% of entry)

**BTFH / base**: 28 closed trades (0 still open), net 1.23R, wins 10. Exits: Stop 11 (avg -1.05R), Trail 4 (avg 0.83R), Invalidated 8 (avg -0.36R), Target 5 (avg 2.47R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 11 (avg -1.05R) | 0/11 (0%) | 13% / 15% / 14% | 3/11 (27%) | 22% / 23% / 25% | 4 | 0.28 | 18% | 0% | -1.02 |
|   of which closed back ABOVE the stop that day (wick only) | 5 (avg -1.06R) | 0/5 (0%) | 12% / 14% / 13% | 3/5 (60%) | 21% / 22% / 23% | 3 | 0.47 | 20% | 0% | -1.04 |
|   of which closed at/below the stop | 6 (avg -1.04R) | 0/6 (0%) | 14% / 16% / 15% | 0/6 (0%) | 24% / 25% / 27% | 6 | -0.27 | 17% | 0% | -1.00 |
| Invalidated, no target reached | 8 (avg -0.36R) | 0/8 (0%) | 17% / 19% / 19% | 1/8 (13%) | 28% / 29% / 30% | 19.5 | 0.26 | 25% | 13% | -0.56 |
| All pre-target exits (Stop+Invalidated) | 19 (avg -0.76R) | 0/19 (0%) | 15% / 17% / 16% | 4/19 (21%) | 25% / 26% / 27% | 17 | 0.28 | 21% | 5% | -0.82 |
| Stop/trail after TP1+ (next target) | 4 (avg 0.83R) | 0/4 (0%) | 16% / 18% / 18% | 0/4 (0%) | 26% / 26% / 29% | 8 | 1.27 | 25% | 0% | -0.85 |

Literal control for base (X = median TP1 distance 17.1% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 27% / 41%; up-trend 30% / 42%.

<details><summary>BTFH base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2014-04-02 | 2014-05-29 | 0.678 | 0.529 | 0.827 | 0.976 | 1.125 | Invalidated | -0.64 | 0.7 / 0.7 / 0.7 | - / - / - | -1.01 | -0.4 / -1.0 |
| 2014-06-11 | 2014-07-09 | 0.731 | 0.583 | 0.880 | 1.028 | 1.177 | Invalidated | -0.88 | -0.6 / -0.6 / -0.6 | - / - / - | -1.37 | -0.9 / -0.8 |
| 2014-09-23 | 2014-10-01 | 0.721 | 0.608 | 0.834 | 0.947 | 1.059 | Target tp3 | 1.98 | 4.4 / 11.5 / 12.5 | 1 / 1 / 1 | 2.54 | 5.5 / 11.8 |
| 2015-01-04 | 2015-02-01 | 2.005 | 1.810 | 2.201 | 2.396 | 2.592 | Invalidated | -0.42 | 0.3 / 0.3 / 0.3 | - / - / - | -3.31 | -0.4 / -1.0 |
| 2015-12-22 | 2016-01-13 | 1.094 | 0.986 | 1.351 | 1.421 | 1.621 | Stop | -1.02 | -0.0 / 1.4 / 36.7 | 21 / 22 / 23 | -2.45 | -1.0 / -1.0 |
| 2016-02-18 | 2016-03-02 | 1.963 | 1.481 | 2.445 | 2.927 | 3.409 | Target tp3 | 1.99 | 6.4 / 6.4 / 10.3 | 1 / 1 / 1 | 3.79 | 5.1 / 7.8 |
| 2016-03-08 | 2016-03-13 | 4.812 | 3.724 | 5.900 | 6.988 | 8.075 | Stop | -1.20 | 0.1 / 0.5 / 2.0 | 22 / - / - | -0.85 | -1.2 / -1.2 |
| 2016-03-15 | 2016-04-12 | 4.330 | 3.820 | 5.036 | 5.547 | 6.058 | Target tp3 | 2.36 | 5.1 / 5.1 / 5.1 | 1 / 1 / 1 | 2.77 | 2.8 / -1.0 |
| 2016-04-13 | 2016-04-17 | 5.745 | 5.210 | 6.280 | 6.815 | 7.350 | Trail tp2 | 0.98 | 2.3 / 2.3 / 2.3 | 1 / 1 / - | 0.00 | -1.4 / -1.4 |
| 2016-10-23 | 2016-12-06 | 3.722 | 3.324 | 6.950 | 7.348 | 7.746 | Stop | -1.02 | 0.5 / 0.5 / 0.5 | - / - / - | -2.34 | 0.3 / -1.0 |
| 2017-07-09 | 2017-08-02 | 3.176 | 2.969 | 3.736 | 3.903 | 4.093 | Target tp3 | 3.51 | 6.3 / 6.3 / 6.3 | 1 / 1 / 3 | 3.14 | 4.3 / 2.0 |
| 2017-08-03 | 2017-08-15 | 3.920 | 3.726 | 4.216 | 4.575 | 6.950 | Trail tp1 | 0.46 | 0.3 / 0.3 / 1.5 | - / - / - | -3.31 | -1.0 / -1.0 |
| 2017-08-20 | 2017-08-21 | 3.696 | 3.447 | 4.472 | 4.575 | 6.950 | Stop | -1.03 | 0.0 / 1.4 / 2.1 | - / - / - | -1.69 | -1.0 / -1.0 |
| 2018-04-03 | 2018-05-03 | 3.995 | 3.746 | 4.472 | 4.575 | 6.950 | Trail tp2 | 1.54 | 2.4 / 3.0 / 3.0 | 8 / 8 / - | -0.12 | 0.8 / 0.0 |
| 2019-01-30 | 2019-03-26 | 2.236 | 2.084 | 3.161 | 3.541 | 3.906 | Invalidated | -0.47 | 0.0 / 0.0 / 0.0 | - / - / - | -5.17 | 1.1 / -0.5 |
| 2021-01-24 | 2021-02-17 | 1.068 | 0.968 | 1.249 | 1.500 | 1.667 | Invalidated | -0.24 | -0.1 / -0.1 / -0.1 | - / - / - | -4.19 | -0.4 / -1.0 |
| 2021-06-03 | 2021-06-15 | 1.308 | 1.131 | 1.500 | 1.667 | 1.796 | Trail tp1 | 0.35 | -0.1 / -0.1 / -0.1 | - / - / - | -3.27 | -1.0 / -1.0 |
| 2022-08-30 | 2022-12-06 | 0.987 | 0.846 | 1.663 | 1.804 | 1.945 | Invalidated | 0.17 | 1.2 / 1.2 / 1.2 | - / - / - | -0.58 | 2.8 / 1.3 |
| 2023-02-19 | 2023-03-08 | 1.212 | 1.060 | 1.375 | 1.412 | 1.497 | Invalidated | -0.43 | -0.2 / 0.2 / 0.7 | - / - / - | -2.39 | -1.0 / -1.0 |
| 2023-05-24 | 2023-05-28 | 1.375 | 1.264 | 1.538 | 1.663 | 1.774 | Target tp3 | 2.52 | 31.6 / 31.6 / 31.6 | 1 / 1 / 1 | 3.82 | 22.4 / 11.7 |
| 2023-10-31 | 2023-11-28 | 3.136 | 2.719 | 3.590 | 4.096 | 4.132 | Invalidated | -0.02 | 0.6 / 0.6 / 1.4 | 38 / - / - | -0.98 | 0.0 / -0.5 |
| 2024-01-28 | 2024-01-31 | 3.510 | 3.287 | 4.096 | 4.132 | 4.354 | Stop | -1.03 | -1.4 / -0.7 / -0.7 | - / - / - | -2.96 | -1.0 / -1.0 |
| 2024-07-29 | 2024-08-04 | 2.790 | 2.681 | 3.332 | 3.350 | 3.421 | Stop | -1.05 | -0.3 / 4.4 / 4.4 | - / - / - | -3.74 | -1.0 / -1.0 |
| 2024-08-25 | 2024-10-08 | 2.843 | 2.723 | 3.332 | 3.350 | 3.421 | Stop | -1.05 | -0.3 / -0.3 / -0.3 | - / - / - | -3.03 | 0.6 / -1.0 |
| 2025-06-30 | 2025-07-01 | 3.720 | 3.521 | 4.887 | 5.086 | 5.285 | Stop | -1.04 | -0.4 / -0.3 / -0.3 | - / - / - | -3.87 | -1.0 / -1.0 |
| 2025-07-17 | 2025-07-30 | 3.370 | 3.225 | 3.790 | 4.887 | 5.032 | Stop | -1.05 | 0.3 / 0.3 / 0.3 | - / - / - | -2.90 | -1.0 / -1.0 |
| 2025-10-27 | 2025-10-29 | 3.150 | 3.014 | 3.640 | 3.670 | 3.790 | Stop | -1.05 | -0.4 / -0.4 / 3.7 | 36 / - / - | -3.68 | -1.0 / -1.0 |
| 2025-12-09 | 2026-01-05 | 3.520 | 3.241 | 4.887 | 5.166 | 5.444 | Stop | -1.02 | -0.8 / -0.8 / -0.5 | - / - / - | -2.51 | -1.0 / -1.0 |

</details>

**BTFH / rec**: 23 closed trades (0 still open), net 0.79R, wins 6. Exits: Stop 9 (avg -1.38R), Trail 1 (avg 0.17R), Invalidated 13 (avg 1.01R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 9 (avg -1.30R) | 1/9 (11%) | 13% / 15% / 14% | 2/9 (22%) | 22% / 23% / 24% | 8 | -0.25 | 22% | 11% | -1.14 |
| Invalidated, no target reached | 8 (avg -0.50R) | 0/8 (0%) | 17% / 19% / 19% | 1/8 (13%) | 27% / 28% / 29% | 19.5 | 0.26 | 25% | 0% | -0.95 |
| All pre-target exits (Stop+Invalidated) | 17 (avg -0.92R) | 1/17 (6%) | 15% / 17% / 16% | 3/17 (18%) | 24% / 26% / 27% | 18 | 0.19 | 24% | 6% | -1.05 |
| Invalidated after TP1+ (next target) | 1 (avg 1.59R) | 0/1 (0%) | 4% / 6% / 4% | 0/1 (0%) | 9% / 10% / 8% | 22 | 2.97 | 100% | 0% | 0.00 |
| Stop/trail after TP1+ (next target) | 1 (avg -0.57R) | 0/1 (0%) | 5% / 7% / 5% | 0/1 (0%) | 12% / 14% / 9% | 10 | -1.23 | 0% | 0% | -1.38 |

Literal control for rec (X = median TP1 distance 17.2% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 27% / 41%; up-trend 30% / 42%.

<details><summary>BTFH rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2014-04-02 | 2014-05-29 | 0.678 | 0.529 | 0.827 | 0.976 | 1.125 | Invalidated | -0.64 | 0.7 / 0.7 / 0.7 | - / - / - | -1.01 | -0.4 / -0.9 |
| 2014-06-11 | 2014-07-09 | 0.731 | 0.583 | 0.880 | 1.028 | 1.177 | Invalidated | -0.88 | -0.6 / -0.6 / -0.6 | - / - / - | -1.37 | -0.9 / -0.8 |
| 2014-09-23 | 2014-12-09 | 0.721 | 0.608 | 0.834 | 0.947 | 1.059 | Invalidated tp3 | 4.26 | 10.9 / 12.5 / 12.6 | 1 / 1 / 1 | 9.45 | 5.5 / 11.8 |
| 2015-01-04 | 2015-02-01 | 2.005 | 1.810 | 2.201 | 2.396 | 2.592 | Invalidated | -0.42 | 0.3 / 0.3 / 0.3 | - / - / - | -3.31 | -0.4 / -1.2 |
| 2015-12-22 | 2016-01-14 | 1.094 | 0.986 | 1.351 | 1.421 | 1.621 | Stop | -1.64 | -0.0 / 2.6 / 36.7 | 20 / 21 / 22 | -2.45 | -1.6 / -1.6 |
| 2016-02-18 | 2016-05-12 | 1.963 | 1.481 | 2.445 | 2.927 | 3.409 | Invalidated tp3 | 2.20 | 4.4 / 4.4 / 4.4 | 1 / 1 / 1 | 3.61 | 5.1 / 7.8 |
| 2016-10-23 | 2016-12-06 | 3.722 | 3.324 | 6.950 | 7.348 | 7.746 | Invalidated | -0.89 | 0.5 / 0.5 / 0.5 | - / - / - | -2.34 | 0.3 / -1.3 |
| 2017-07-09 | 2017-10-17 | 3.176 | 2.969 | 3.736 | 3.903 | 4.093 | Invalidated tp3 | 2.88 | 4.6 / 4.6 / 4.6 | 1 / 2 / 5 | 2.30 | 4.3 / 2.0 |
| 2018-04-03 | 2018-05-09 | 3.995 | 3.746 | 4.472 | 4.575 | 6.950 | Invalidated tp2 | 1.59 | 3.0 / 3.0 / 3.0 | 4 / 4 / - | -0.12 | 0.8 / 0.0 |
| 2019-01-30 | 2019-03-26 | 2.236 | 2.084 | 3.161 | 3.541 | 3.906 | Invalidated | -0.47 | 0.0 / 0.0 / 0.0 | - / - / - | -5.17 | 1.1 / -0.5 |
| 2021-01-24 | 2021-02-17 | 1.068 | 0.968 | 1.249 | 1.500 | 1.667 | Invalidated | -0.24 | -0.1 / -0.1 / -0.1 | - / - / - | -4.19 | -0.4 / -1.0 |
| 2021-06-03 | 2021-06-17 | 1.308 | 1.131 | 1.500 | 1.667 | 1.796 | Stop tp1 | -0.57 | -1.2 / -1.2 / -1.2 | - / - / - | -3.27 | -1.4 / -1.4 |
| 2022-08-30 | 2022-12-06 | 0.987 | 0.846 | 1.663 | 1.804 | 1.945 | Trail | 0.17 | 1.2 / 1.2 / 1.2 | - / - / - | -0.58 | 2.8 / 1.3 |
| 2023-02-19 | 2023-03-08 | 1.212 | 1.060 | 1.375 | 1.412 | 1.497 | Invalidated | -0.43 | -0.2 / 0.2 / 0.7 | - / - / - | -2.39 | -1.3 / -1.3 |
| 2023-05-24 | 2023-07-09 | 1.375 | 1.264 | 1.538 | 1.663 | 1.774 | Invalidated tp3 | 6.12 | 24.4 / 24.4 / 24.4 | 1 / 1 / 1 | 13.27 | 22.4 / 11.7 |
| 2023-10-31 | 2023-11-28 | 3.136 | 2.719 | 3.590 | 4.096 | 4.132 | Invalidated | -0.02 | 0.6 / 0.6 / 1.4 | 38 / - / - | -0.98 | 0.0 / -0.5 |
| 2024-01-28 | 2024-01-31 | 3.510 | 3.287 | 4.096 | 4.132 | 4.354 | Stop | -2.27 | -1.4 / -0.7 / -0.7 | - / - / - | -2.96 | -2.2 / -2.2 |
| 2024-07-29 | 2024-08-04 | 2.790 | 2.681 | 3.332 | 3.350 | 3.421 | Stop | -2.08 | -0.3 / 4.4 / 4.4 | - / - / - | -3.74 | -2.0 / -2.0 |
| 2024-08-25 | 2024-10-08 | 2.843 | 2.723 | 3.332 | 3.350 | 3.421 | Stop | -1.08 | -0.3 / -0.3 / -0.3 | - / - / - | -3.03 | 0.6 / -1.0 |
| 2025-06-30 | 2025-07-01 | 3.720 | 3.521 | 4.887 | 5.086 | 5.285 | Stop | -1.29 | -0.4 / -0.3 / -0.3 | - / - / - | -3.87 | -1.3 / -1.3 |
| 2025-07-17 | 2025-07-30 | 3.370 | 3.225 | 3.790 | 4.887 | 5.032 | Stop | -1.08 | 0.3 / 0.3 / 0.3 | - / - / - | -2.90 | -1.0 / -1.0 |
| 2025-10-27 | 2025-10-30 | 3.150 | 3.014 | 3.640 | 3.670 | 3.790 | Stop | -1.30 | -0.6 / -0.4 / 3.7 | 35 / - / - | -3.68 | -1.2 / -1.2 |
| 2025-12-09 | 2026-01-05 | 3.520 | 3.241 | 4.887 | 5.166 | 5.444 | Stop | -1.14 | -0.8 / -0.8 / -0.5 | - / - / - | -2.51 | -1.1 / -1.1 |

</details>


#### EMFD  (2015-03-05 .. 2026-11-19, 2807 bars; EGX30; median initial risk 5.2% of entry)

**EMFD / base**: 35 closed trades (0 still open), net -7.83R, wins 12. Exits: Stop 20 (avg -1.04R), Trail 6 (avg 0.71R), Invalidated 5 (avg 0.07R), Target 4 (avg 2.08R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 20 (avg -1.04R) | 2/20 (10%) | 27% / 26% / 30% | 4/19 (21%) | 43% / 39% / 46% | 3 | 0.04 | 0% | 0% | -1.00 |
|   of which closed back ABOVE the stop that day (wick only) | 16 (avg -1.04R) | 2/16 (13%) | 29% / 28% / 33% | 4/15 (27%) | 46% / 42% / 50% | 3 | 0.28 | 0% | 0% | -1.00 |
|   of which closed at/below the stop | 4 (avg -1.04R) | 0/4 (0%) | 18% / 17% / 19% | 0/4 (0%) | 31% / 28% / 33% | 8.5 | -0.92 | 0% | 0% | -1.00 |
| Invalidated, no target reached | 5 (avg 0.07R) | 0/5 (0%) | 10% / 10% / 10% | 2/5 (40%) | 21% / 18% / 23% | 27 | 1.83 | 100% | 80% | 0.95 |
| All pre-target exits (Stop+Invalidated) | 25 (avg -0.82R) | 2/25 (8%) | 24% / 22% / 26% | 6/24 (25%) | 38% / 35% / 42% | 4 | 0.49 | 20% | 17% | -0.59 |
| Stop/trail after TP1+ (next target) | 6 (avg 0.71R) | 1/6 (17%) | 31% / 29% / 34% | 2/6 (33%) | 47% / 43% / 51% | 15 | 1.56 | 67% | 17% | -0.46 |

Literal control for base (X = median TP1 distance 7.0% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 54% / 68%; up-trend 51% / 64%.

<details><summary>EMFD base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2015-10-21 | 2015-11-10 | 2.950 | 2.606 | 3.560 | 4.080 | 4.424 | Stop | -1.02 | -0.7 / 0.1 / 0.1 | - / - / - | -1.57 | -1.0 / -1.0 |
| 2015-12-07 | 2016-01-06 | 2.800 | 2.579 | 3.050 | 3.560 | 4.080 | Stop | -1.02 | -1.0 / -1.0 / -1.0 | - / - / - | -4.16 | -0.7 / -1.0 |
| 2016-07-19 | 2016-07-20 | 2.550 | 2.405 | 2.780 | 2.830 | 2.850 | Stop | -1.03 | 0.3 / 1.5 / 1.5 | - / - / - | -2.14 | -1.0 / -1.0 |
| 2016-08-09 | 2016-08-24 | 2.630 | 2.488 | 2.780 | 2.830 | 2.850 | Stop | -1.04 | -1.1 / -1.1 / -1.1 | - / - / - | -4.92 | -1.0 / -1.0 |
| 2017-06-05 | 2017-06-12 | 2.710 | 2.539 | 2.910 | 3.130 | 3.190 | Trail tp1 | 0.36 | 1.5 / 1.5 / 1.5 | 1 / - / - | 0.23 | 0.2 / -1.0 |
| 2017-10-02 | 2017-11-19 | 3.340 | 3.209 | 4.080 | 4.211 | 4.342 | Invalidated | 0.94 | 4.3 / 4.3 / 4.5 | - / - / - | 0.23 | 4.6 / 3.0 |
| 2018-06-25 | 2018-06-26 | 4.410 | 4.154 | 4.800 | 5.000 | 5.130 | Stop | -1.03 | 0.2 / 1.3 / 1.4 | - / - / - | -1.76 | -1.0 / -1.0 |
| 2018-07-22 | 2018-07-29 | 4.520 | 4.286 | 4.800 | 5.000 | 5.130 | Stop | -1.04 | 1.0 / 1.0 / 1.0 | - / - / - | -5.55 | -1.0 / -1.0 |
| 2018-08-13 | 2018-08-16 | 4.530 | 4.344 | 4.740 | 4.800 | 5.000 | Stop | -1.05 | 0.5 / 0.5 / 0.5 | - / - / - | -8.78 | -1.0 / -1.0 |
| 2019-01-30 | 2019-02-28 | 3.400 | 3.181 | 4.630 | 4.740 | 4.760 | Invalidated | 0.11 | 1.8 / 1.8 / 1.8 | - / - / - | 0.00 | 0.6 / 0.4 |
| 2019-08-18 | 2019-08-21 | 3.330 | 3.224 | 3.720 | 3.750 | 3.790 | Stop | -1.06 | -0.9 / -0.9 / -0.9 | - / - / - | -5.75 | -1.0 / -1.0 |
| 2020-08-09 | 2020-09-07 | 2.500 | 2.377 | 2.740 | 2.790 | 3.080 | Stop | -1.04 | -0.2 / 0.5 / 1.5 | - / - / - | -2.77 | -1.0 / -1.0 |
| 2020-10-15 | 2020-10-20 | 2.560 | 2.456 | 2.740 | 2.790 | 3.080 | Stop | -1.05 | -0.6 / -0.6 / 2.7 | 29 / 30 / - | -3.83 | -1.0 / -1.0 |
| 2020-12-03 | 2020-12-09 | 2.680 | 2.515 | 3.080 | 3.220 | 3.450 | Stop | -1.03 | -0.8 / -0.8 / 0.7 | - / - / - | -2.60 | -1.0 / -1.0 |
| 2021-02-03 | 2021-02-08 | 2.720 | 2.619 | 2.840 | 3.080 | 3.220 | Stop | -1.05 | -0.9 / -0.9 / -0.9 | - / - / - | -5.04 | -1.0 / -1.0 |
| 2021-08-29 | 2021-09-30 | 2.500 | 2.369 | 2.790 | 2.840 | 3.080 | Stop | -1.04 | -0.5 / 0.0 / 1.5 | - / - / - | -1.83 | -0.6 / -1.0 |
| 2021-12-07 | 2022-01-19 | 2.700 | 2.564 | 2.840 | 3.080 | 3.220 | Trail tp2 | 1.77 | 2.2 / 3.0 / 3.0 | 1 / 15 / - | 1.48 | 2.4 / 2.2 |
| 2022-03-23 | 2022-03-27 | 2.960 | 2.817 | 3.103 | 3.246 | 3.388 | Stop | -1.04 | 0.1 / 0.1 / 0.1 | - / - / - | -2.52 | -1.0 / -1.0 |
| 2022-08-22 | 2022-08-23 | 2.720 | 2.610 | 2.850 | 2.970 | 3.100 | Stop | -1.05 | 1.0 / 1.6 / 1.6 | 13 / - / - | -2.00 | -1.0 / -1.0 |
| 2022-12-11 | 2022-12-19 | 3.200 | 3.032 | 3.368 | 3.536 | 3.704 | Trail tp1 | 0.29 | 0.7 / 1.3 / 1.8 | 12 / - / - | -1.67 | -1.0 / -1.0 |
| 2022-12-25 | 2023-02-05 | 2.960 | 2.807 | 3.510 | 3.663 | 3.817 | Invalidated | -0.04 | 1.8 / 1.8 / 1.8 | - / - / - | -2.28 | 1.5 / 0.7 |
| 2023-06-05 | 2023-06-26 | 3.050 | 2.926 | 3.240 | 3.500 | 3.624 | Stop | -1.05 | -0.4 / -0.4 / 1.2 | - / - / - | -2.01 | -1.0 / -1.0 |
| 2023-08-30 | 2023-09-24 | 3.110 | 3.003 | 3.240 | 3.500 | 3.607 | Trail tp1 | 0.34 | 1.5 / 1.5 / 6.9 | 1 / 21 / 22 | -0.19 | 1.0 / -1.0 |
| 2023-10-31 | 2023-11-27 | 3.430 | 3.229 | 3.631 | 3.832 | 4.033 | Target tp3 | 1.96 | 6.8 / 6.8 / 6.8 | 1 / 1 / 1 | 2.79 | 3.5 / 2.0 |
| 2023-12-06 | 2023-12-07 | 4.320 | 4.125 | 4.515 | 4.710 | 4.905 | Stop | -1.04 | 1.2 / 1.2 / 9.6 | 1 / 38 / 39 | -0.62 | -1.0 / -1.0 |
| 2024-02-08 | 2024-02-15 | 5.890 | 5.516 | 6.264 | 6.638 | 7.012 | Target tp3 | 1.97 | 7.0 / 7.0 / 7.0 | 1 / 1 / 1 | 2.33 | 1.7 / -1.0 |
| 2024-02-27 | 2024-02-29 | 7.700 | 6.811 | 8.589 | 9.478 | 10.37 | Stop | -1.02 | -0.2 / -0.2 / -0.2 | - / - / - | -3.94 | -1.0 / -1.0 |
| 2024-06-25 | 2024-08-05 | 6.400 | 5.603 | 8.490 | 9.287 | 10.08 | Invalidated | -0.28 | 0.6 / 2.2 / 2.9 | 39 / - / - | -0.26 | 0.6 / 0.8 |
| 2025-03-26 | 2025-04-06 | 8.320 | 7.775 | 9.500 | 10.04 | 10.59 | Stop | -1.03 | 0.5 / 1.4 / 3.4 | 29 / 34 / - | -1.43 | -1.0 / -1.0 |
| 2025-04-30 | 2025-06-15 | 8.920 | 8.504 | 9.500 | 9.916 | 10.33 | Trail tp2 | 1.22 | 1.6 / 1.6 / 1.6 | 8 / - / - | -1.42 | 1.8 / -1.0 |
| 2025-10-21 | 2025-11-09 | 9.040 | 8.661 | 9.600 | 10.15 | 10.53 | Target tp3 | 2.72 | 4.0 / 4.0 / 4.0 | 1 / 1 / 1 | 3.19 | 0.8 / 1.9 |
| 2026-04-28 | 2026-05-18 | 10.50 | 10.03 | 10.97 | 11.44 | 11.91 | Trail tp1 | 0.29 | 4.5 / 4.7 / 4.7 | 6 / 6 / 7 | -1.43 | -1.0 / -1.0 |
| 2026-06-03 | 2026-07-30 | 11.70 | 10.46 | 12.94 | 14.17 | 15.41 | Invalidated | -0.38 | 0.3 / 0.8 / 2.9 | 21 / 24 / - | -0.36 | 0.0 / -0.2 |
| 2026-08-11 | 2026-08-31 | 11.90 | 11.34 | 12.60 | 12.70 | 13.26 | Target tp3 | 1.66 | 6.1 / 6.1 / 6.1 | 1 / 1 / 1 | 1.89 | 4.8 / 1.4 |
| 2026-09-30 | 2026-10-18 | 13.56 | 11.66 | 15.46 | 17.35 | 19.25 | Stop | -1.01 | -0.6 / -0.4 / - | - / - / - | -1.56 | -1.0 / - |

</details>

**EMFD / rec**: 28 closed trades (0 still open), net -12.20R, wins 7. Exits: Stop 17 (avg -1.23R), Trail 0 (avg -R), Invalidated 11 (avg 0.80R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 15 (avg -1.33R) | 1/15 (7%) | 19% / 18% / 20% | 2/15 (13%) | 34% / 30% / 36% | 8 | -0.32 | 7% | 0% | -1.29 |
| Invalidated, no target reached | 4 (avg 0.10R) | 0/4 (0%) | 9% / 9% / 10% | 2/4 (50%) | 20% / 17% / 22% | 29.5 | 2.00 | 100% | 75% | 1.00 |
| All pre-target exits (Stop+Invalidated) | 19 (avg -1.03R) | 1/19 (5%) | 17% / 16% / 18% | 4/19 (21%) | 31% / 27% / 33% | 18 | 0.12 | 26% | 16% | -0.81 |
| Invalidated after TP1+ (next target) | 4 (avg 0.80R) | 1/4 (25%) | 16% / 15% / 18% | 3/4 (75%) | 30% / 26% / 32% | 33.5 | 2.01 | 100% | 75% | 1.89 |
| Stop/trail after TP1+ (next target) | 2 (avg -0.54R) | 1/2 (50%) | 17% / 16% / 18% | 1/2 (50%) | 32% / 28% / 34% | 12.5 | 2.97 | 0% | 0% | -1.25 |

Literal control for rec (X = median TP1 distance 7.2% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 52% / 67%; up-trend 50% / 63%.

<details><summary>EMFD rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2015-10-21 | 2015-11-10 | 2.950 | 2.606 | 3.560 | 4.080 | 4.424 | Stop | -1.15 | -0.7 / 0.1 / 0.1 | - / - / - | -1.57 | -1.1 / -1.1 |
| 2015-12-07 | 2016-01-06 | 2.800 | 2.579 | 3.050 | 3.560 | 4.080 | Stop | -1.07 | -1.0 / -1.0 / -1.0 | - / - / - | -4.16 | -0.7 / -1.0 |
| 2016-07-19 | 2016-08-28 | 2.550 | 2.405 | 2.780 | 2.830 | 2.850 | Stop | -1.14 | -0.6 / -0.6 / -0.6 | - / - / - | -4.27 | 0.7 / -1.1 |
| 2017-06-05 | 2017-07-31 | 2.710 | 2.539 | 2.910 | 3.130 | 3.190 | Invalidated tp1 | -0.19 | 0.0 / 0.5 / 4.6 | 21 / 33 / 38 | -1.40 | 0.2 / -0.9 |
| 2017-10-02 | 2017-11-19 | 3.340 | 3.209 | 4.080 | 4.211 | 4.342 | Invalidated | 0.94 | 4.3 / 4.3 / 4.5 | - / - / - | 0.23 | 4.6 / 3.0 |
| 2018-06-25 | 2018-07-08 | 4.410 | 4.154 | 4.800 | 5.000 | 5.130 | Stop | -1.28 | 0.8 / 1.3 / 1.4 | - / - / - | -1.76 | -1.2 / -1.2 |
| 2018-07-22 | 2018-09-10 | 4.520 | 4.286 | 4.800 | 5.000 | 5.130 | Stop | -1.32 | -1.2 / -1.2 / -1.2 | - / - / - | -7.09 | -0.6 / -1.3 |
| 2019-01-30 | 2019-02-28 | 3.400 | 3.181 | 4.630 | 4.740 | 4.760 | Invalidated | 0.11 | 1.8 / 1.8 / 1.8 | - / - / - | 0.00 | 0.6 / 0.4 |
| 2019-08-18 | 2019-08-21 | 3.330 | 3.224 | 3.720 | 3.750 | 3.790 | Stop | -1.29 | -0.9 / -0.9 / -0.9 | - / - / - | -5.75 | -1.2 / -1.2 |
| 2020-08-09 | 2020-09-08 | 2.500 | 2.377 | 2.740 | 2.790 | 3.080 | Stop | -1.67 | -0.2 / 0.7 / 1.5 | - / - / - | -2.77 | -0.9 / -1.6 |
| 2020-10-15 | 2020-10-22 | 2.560 | 2.456 | 2.740 | 2.790 | 3.080 | Stop | -1.97 | -1.5 / -0.8 / 2.7 | 27 / 28 / - | -3.83 | -1.9 / -1.9 |
| 2020-12-03 | 2020-12-10 | 2.680 | 2.515 | 3.080 | 3.220 | 3.450 | Stop | -1.30 | -0.8 / -0.8 / 0.7 | - / - / - | -2.60 | -1.3 / -1.3 |
| 2021-02-03 | 2021-02-08 | 2.720 | 2.619 | 2.840 | 3.080 | 3.220 | Stop | -1.14 | -0.9 / -0.9 / -0.9 | - / - / - | -5.04 | -1.1 / -1.1 |
| 2021-08-29 | 2021-10-06 | 2.500 | 2.369 | 2.790 | 2.840 | 3.080 | Stop | -1.11 | -0.5 / 0.8 / 1.5 | - / - / - | -1.83 | -0.6 / -1.1 |
| 2021-12-07 | 2022-01-23 | 2.700 | 2.564 | 2.840 | 3.080 | 3.220 | Invalidated tp2 | 1.68 | 2.4 / 3.0 / 4.1 | 1 / 13 / 40 | 0.89 | 2.4 / 2.2 |
| 2022-03-23 | 2022-03-28 | 2.960 | 2.817 | 3.103 | 3.246 | 3.388 | Stop | -1.51 | 0.1 / 0.1 / 0.1 | - / - / - | -3.01 | -1.5 / -1.5 |
| 2022-08-22 | 2022-08-24 | 2.720 | 2.610 | 2.850 | 2.970 | 3.100 | Stop | -1.41 | 1.0 / 1.6 / 1.6 | 12 / - / - | -1.82 | -1.4 / -1.4 |
| 2022-12-11 | 2022-12-25 | 3.200 | 3.032 | 3.368 | 3.536 | 3.704 | Stop tp1 | -0.66 | 1.3 / 1.3 / 1.8 | 8 / - / - | -1.55 | -1.4 / -1.4 |
| 2023-01-04 | 2023-01-10 | 3.340 | 3.127 | 3.553 | 3.766 | 3.980 | Stop | -1.30 | -0.1 / 0.8 / 0.8 | - / - / - | -2.44 | -1.3 / -1.3 |
| 2023-06-05 | 2023-07-06 | 3.050 | 2.926 | 3.240 | 3.500 | 3.624 | Stop | -1.26 | -1.0 / -0.3 / 1.3 | - / - / - | -2.01 | -1.2 / -1.2 |
| 2023-08-30 | 2023-10-08 | 3.110 | 3.003 | 3.240 | 3.500 | 3.607 | Invalidated tp1 | -0.03 | 1.3 / 6.0 / 10.0 | 8 / 13 / 14 | -0.93 | 1.0 / 4.4 |
| 2023-10-31 | 2024-03-31 | 3.430 | 3.229 | 3.631 | 3.832 | 4.033 | Invalidated tp3 | 3.38 | 13.2 / 13.2 / 14.8 | 1 / 1 / 1 | 7.27 | 3.5 / 2.0 |
| 2024-06-25 | 2024-08-05 | 6.400 | 5.603 | 8.490 | 9.287 | 10.08 | Invalidated | -0.28 | 0.6 / 2.2 / 2.9 | 39 / - / - | -0.26 | 0.6 / 0.8 |
| 2025-03-26 | 2025-07-30 | 8.320 | 7.775 | 9.500 | 10.04 | 10.59 | Invalidated tp2 | 1.74 | 1.1 / 1.1 / 1.2 | - / - / - | -0.73 | 0.8 / 1.9 |
| 2025-10-21 | 2025-11-26 | 9.040 | 8.661 | 9.600 | 10.15 | 10.53 | Invalidated tp3 | 1.21 | 2.7 / 2.9 / 2.9 | 8 / 11 / - | -0.63 | 0.8 / 1.9 |
| 2026-04-28 | 2026-05-20 | 10.50 | 10.03 | 10.97 | 11.44 | 11.91 | Stop tp1 | -0.42 | 4.5 / 4.7 / 4.7 | 4 / 4 / 5 | -1.07 | -1.1 / -1.1 |
| 2026-06-03 | 2026-07-30 | 11.70 | 10.46 | 12.94 | 14.17 | 15.41 | Invalidated | -0.38 | 0.3 / 0.8 / 2.9 | 21 / 24 / - | -0.36 | 0.0 / -0.2 |
| 2026-08-11 | 2026-10-22 | 11.90 | 11.34 | 12.60 | 12.70 | 13.26 | Invalidated tp3 | 0.62 | 0.8 / 1.9 / - | 13 / 13 / - | -2.33 | 4.8 / 1.4 |

</details>


#### EFID  (2015-04-02 .. 2026-11-19, 2820 bars; EGX30; median initial risk 6.8% of entry)

**EFID / base**: 34 closed trades (0 still open), net -2.02R, wins 14. Exits: Stop 16 (avg -1.06R), Trail 11 (avg 0.97R), Invalidated 5 (avg -0.25R), Target 2 (avg 2.74R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 16 (avg -1.06R) | 5/16 (31%) | 29% / 29% / 31% | 8/16 (50%) | 43% / 45% / 45% | 4 | 0.73 | 0% | 0% | -1.01 |
|   of which closed back ABOVE the stop that day (wick only) | 11 (avg -1.04R) | 4/11 (36%) | 26% / 26% / 28% | 5/11 (45%) | 39% / 42% / 41% | 3 | 0.68 | 0% | 0% | -1.00 |
|   of which closed at/below the stop | 5 (avg -1.10R) | 1/5 (20%) | 35% / 34% / 39% | 3/5 (60%) | 50% / 51% / 53% | 6 | 0.79 | 0% | 0% | -1.04 |
| Invalidated, no target reached | 4 (avg -0.53R) | 0/4 (0%) | 14% / 15% / 15% | 0/4 (0%) | 28% / 31% / 29% | 20.5 | 0.22 | 25% | 25% | -0.70 |
| All pre-target exits (Stop+Invalidated) | 20 (avg -0.95R) | 5/20 (25%) | 26% / 26% / 28% | 8/20 (40%) | 40% / 42% / 42% | 4.5 | 0.67 | 5% | 5% | -0.95 |
| Invalidated after TP1+ (next target) | 1 (avg 0.89R) | 0/1 (0%) | 2% / 2% / 3% | 1/1 (100%) | 7% / 7% / 8% | 32 | 8.39 | 100% | 100% | 0.08 |
| Stop/trail after TP1+ (next target) | 11 (avg 0.97R) | 6/11 (55%) | 34% / 34% / 36% | 8/11 (73%) | 50% / 53% / 52% | 6 | 2.47 | 64% | 64% | 0.69 |

Literal control for base (X = median TP1 distance 8.7% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 40% / 56%; up-trend 37% / 57%.

<details><summary>EFID base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2015-08-03 | 2015-08-16 | 4.434 | 4.148 | 4.720 | 5.006 | 5.292 | Stop | -1.24 | 0.0 / 0.0 / 0.0 | - / - / - | -2.88 | -1.2 / -1.2 |
| 2015-08-18 | 2015-08-23 | 4.051 | 3.762 | 4.534 | 4.824 | 5.113 | Stop | -1.03 | 1.3 / 1.3 / 1.3 | - / - / - | -0.87 | -1.0 / -1.0 |
| 2016-05-05 | 2016-06-07 | 4.719 | 4.198 | 5.240 | 5.761 | 6.282 | Invalidated | -0.89 | -0.2 / -0.2 / -0.2 | - / - / - | -2.79 | -0.3 / -1.0 |
| 2016-11-09 | 2017-03-30 | 3.341 | 2.992 | 3.828 | 4.696 | 4.760 | Trail tp2 | 2.53 | 3.7 / 4.4 / 5.3 | 1 / 17 / 19 | 2.79 | 1.9 / 0.7 |
| 2017-04-05 | 2017-07-12 | 4.532 | 4.319 | 5.100 | 5.314 | 5.527 | Trail tp1 | 1.75 | 2.3 / 2.3 / 2.3 | - / - / - | -3.87 | 2.0 / 2.3 |
| 2018-01-03 | 2018-03-04 | 4.575 | 4.105 | 5.123 | 5.175 | 5.645 | Stop | -1.02 | 0.3 / 2.3 / 2.3 | 15 / 15 / 17 | -1.05 | -0.5 / -1.0 |
| 2018-03-27 | 2018-04-16 | 5.577 | 4.844 | 6.309 | 7.042 | 7.775 | Stop | -1.01 | -0.4 / -0.0 / -0.0 | - / - / - | -1.19 | -1.0 / -1.0 |
| 2019-02-14 | 2019-03-11 | 3.848 | 3.565 | 4.770 | 4.866 | 4.962 | Target tp3 | 3.57 | 4.6 / 4.7 / 5.1 | 1 / 1 / 1 | 4.32 | 4.6 / 4.7 |
| 2019-03-14 | 2019-06-18 | 5.135 | 4.640 | 5.662 | 6.157 | 6.653 | Invalidated | -0.34 | 0.7 / 0.7 / 0.7 | - / - / - | -0.98 | 0.1 / 0.2 |
| 2020-08-31 | 2020-09-01 | 2.902 | 2.791 | 3.665 | 3.720 | 3.888 | Stop | -1.05 | -0.7 / -0.7 / -0.7 | - / - / - | -5.43 | -1.0 / -1.0 |
| 2020-09-02 | 2020-09-08 | 2.803 | 2.579 | 3.665 | 3.720 | 3.888 | Stop | -1.02 | -0.2 / -0.2 / -0.2 | - / - / - | -2.25 | -1.0 / -1.0 |
| 2021-12-30 | 2022-01-17 | 2.325 | 2.204 | 2.563 | 2.635 | 3.033 | Stop | -1.04 | -0.0 / -0.0 / -0.0 | - / - / - | -4.03 | -1.0 / -1.0 |
| 2022-08-01 | 2022-10-12 | 2.317 | 2.109 | 2.563 | 2.635 | 3.033 | Trail tp2 | 1.34 | 2.3 / 4.8 / 7.2 | 1 / 1 / 18 | 1.18 | 1.7 / 2.3 |
| 2022-10-31 | 2022-11-02 | 2.889 | 2.768 | 3.033 | 3.154 | 3.275 | Stop | -1.05 | 6.7 / 7.6 / 11.8 | 3 / 5 / 5 | -2.66 | -1.0 / -1.0 |
| 2022-11-09 | 2022-11-15 | 3.236 | 2.952 | 3.519 | 3.803 | 4.086 | Trail tp1 | 0.31 | 2.0 / 2.0 / 3.8 | 1 / 2 / 27 | 1.03 | -1.0 / -1.0 |
| 2022-12-27 | 2022-12-29 | 3.842 | 3.637 | 4.047 | 4.252 | 4.457 | Trail tp1 | 0.29 | 1.5 / 2.4 / 6.1 | 2 / 19 / 22 | 0.24 | -1.0 / -1.0 |
| 2023-01-11 | 2023-03-02 | 3.913 | 3.523 | 4.314 | 4.704 | 5.095 | Trail tp2 | 1.45 | 1.9 / 2.7 / 2.7 | 1 / 14 / - | 0.34 | 2.5 / 0.4 |
| 2023-03-05 | 2023-03-06 | 4.619 | 4.068 | 5.170 | 5.721 | 6.273 | Invalidated | -0.26 | -0.0 / 0.7 / 0.7 | - / - / - | -1.64 | -1.0 / -1.0 |
| 2023-06-05 | 2023-06-07 | 5.189 | 4.952 | 5.426 | 5.662 | 5.899 | Trail tp1 | 0.29 | 1.2 / 1.4 / 3.3 | 9 / 33 / 35 | -0.65 | 0.7 / 2.2 |
| 2023-06-26 | 2023-07-10 | 5.452 | 5.271 | 5.694 | 5.874 | 6.055 | Stop | -1.06 | 0.9 / 2.8 / 5.6 | 15 / 17 / 29 | -0.74 | -1.0 / -1.0 |
| 2023-08-17 | 2023-08-22 | 5.877 | 5.723 | 6.031 | 6.185 | 6.339 | Target tp3 | 1.92 | 3.8 / 3.8 / 11.7 | 1 / 1 / 1 | 1.15 | 2.1 / 6.9 |
| 2023-10-26 | 2023-11-12 | 7.974 | 7.289 | 8.658 | 9.343 | 10.03 | Trail tp2 | 0.97 | 1.7 / 1.7 / 4.1 | 1 / 22 / 24 | 0.86 | 1.3 / 2.4 |
| 2023-12-20 | 2023-12-21 | 10.02 | 9.470 | 10.58 | 11.13 | 11.69 | Stop | -1.04 | 0.7 / 0.7 / 2.1 | 35 / 35 / - | -4.56 | -1.0 / -1.0 |
| 2023-12-28 | 2024-01-31 | 9.529 | 8.807 | 10.76 | 11.48 | 12.20 | Stop | -1.03 | 2.3 / 7.5 / 7.5 | 9 / 17 / 17 | -1.99 | -0.2 / -1.0 |
| 2024-02-19 | 2024-02-26 | 10.76 | 9.897 | 11.62 | 12.48 | 13.34 | Trail tp2 | 0.97 | 2.5 / 2.5 / 2.5 | 1 / 1 / - | 1.15 | -1.0 / -1.0 |
| 2024-10-08 | 2024-10-13 | 9.167 | 8.785 | 9.692 | 10.24 | 10.64 | Trail tp1 | 0.41 | 4.6 / 4.6 / 4.6 | 3 / 3 / 3 | -2.13 | -1.0 / -1.0 |
| 2024-10-22 | 2024-11-17 | 9.668 | 8.661 | 12.34 | 14.98 | 15.98 | Invalidated | -0.63 | -0.4 / -0.4 / -0.4 | - / - / - | -1.49 | -0.6 / -1.0 |
| 2025-05-08 | 2025-05-19 | 8.732 | 8.587 | 9.078 | 9.236 | 9.267 | Stop | -1.12 | 0.6 / 1.1 / 13.4 | 37 / 37 / 37 | -6.69 | -1.0 / -1.0 |
| 2025-07-23 | 2025-09-09 | 10.30 | 9.767 | 10.94 | 14.98 | 15.51 | Invalidated tp1 | 0.89 | 1.2 / 8.4 / 11.4 | 11 / 22 / 30 | -0.87 | 2.5 / 0.1 |
| 2025-10-06 | 2025-10-15 | 13.84 | 12.86 | 14.98 | 15.96 | 16.94 | Trail tp1 | 0.36 | 2.6 / 2.6 / 3.0 | 3 / 9 / - | 0.40 | 1.2 / 1.3 |
| 2026-02-10 | 2026-02-11 | 19.95 | 19.23 | 20.68 | 21.40 | 22.13 | Stop | -1.06 | -0.3 / -0.3 / -0.3 | - / - / - | -5.62 | -1.0 / -1.0 |
| 2026-04-27 | 2026-04-30 | 19.72 | 18.79 | 21.02 | 21.96 | 22.89 | Stop | -1.04 | -0.4 / -0.1 / -0.1 | - / - / - | -2.91 | -1.0 / -1.0 |
| 2026-06-16 | 2026-06-23 | 18.93 | 18.42 | 19.60 | 20.04 | 21.02 | Stop | -1.08 | 0.8 / 0.8 / 8.7 | 28 / 28 / 28 | -3.82 | -1.0 / -1.0 |
| 2026-08-10 | 2026-08-11 | 21.19 | 20.49 | 21.90 | 22.60 | 23.31 | Stop | -1.06 | 3.0 / 3.0 / 3.0 | 2 / 3 / - | -0.64 | -1.0 / -1.0 |

</details>

**EFID / rec**: 20 closed trades (0 still open), net 13.11R, wins 8. Exits: Stop 10 (avg -1.01R), Trail 1 (avg -0.16R), Invalidated 9 (avg 2.59R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 9 (avg -1.10R) | 1/9 (11%) | 23% / 24% / 25% | 3/9 (33%) | 37% / 40% / 39% | 9 | -0.01 | 11% | 11% | -0.95 |
| Invalidated, no target reached | 2 (avg -0.76R) | 0/2 (0%) | 7% / 6% / 7% | 0/2 (0%) | 17% / 17% / 17% | 20.5 | -0.30 | 0% | 0% | -1.29 |
| All pre-target exits (Stop+Invalidated) | 11 (avg -1.04R) | 1/11 (9%) | 20% / 20% / 22% | 3/11 (27%) | 33% / 35% / 35% | 13 | -0.13 | 9% | 9% | -1.01 |
| Invalidated after TP1+ (next target) | 2 (avg 1.08R) | 1/2 (50%) | 9% / 10% / 8% | 2/2 (100%) | 20% / 21% / 19% | 41.5 | 6.62 | 100% | 100% | 1.18 |
| Stop/trail after TP1+ (next target) | 2 (avg -0.14R) | 1/2 (50%) | 18% / 19% / 17% | 1/2 (50%) | 33% / 38% / 34% | 8.5 | 2.56 | 0% | 0% | -1.53 |

Literal control for rec (X = median TP1 distance 9.2% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 38% / 54%; up-trend 36% / 55%.

<details><summary>EFID rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2015-08-03 | 2015-08-16 | 4.434 | 4.148 | 4.720 | 5.006 | 5.292 | Stop | -1.24 | 0.0 / 0.0 / 0.0 | - / - / - | -2.88 | -1.2 / -1.2 |
| 2015-08-18 | 2016-01-12 | 4.051 | 3.762 | 4.534 | 4.824 | 5.113 | Trail | -0.16 | -0.9 / -0.6 / -0.4 | - / - / - | -2.52 | 0.5 / 0.9 |
| 2016-05-05 | 2016-06-07 | 4.719 | 4.198 | 5.240 | 5.761 | 6.282 | Invalidated | -0.89 | -0.2 / -0.2 / -0.2 | - / - / - | -2.79 | -0.3 / -1.6 |
| 2016-11-09 | 2017-07-16 | 3.341 | 2.992 | 3.828 | 4.696 | 4.760 | Invalidated tp3 | 3.17 | 4.8 / 4.8 / 4.8 | 1 / 1 / 1 | 4.08 | 1.9 / 0.7 |
| 2018-01-03 | 2018-03-04 | 4.575 | 4.105 | 5.123 | 5.175 | 5.645 | Stop | -1.07 | 0.3 / 2.3 / 2.3 | 15 / 15 / 17 | -1.05 | -0.5 / -1.0 |
| 2018-03-27 | 2018-04-17 | 5.577 | 4.844 | 6.309 | 7.042 | 7.775 | Stop | -1.12 | -0.4 / -0.0 / -0.0 | - / - / - | -1.19 | -1.1 / -1.1 |
| 2019-02-14 | 2019-06-18 | 3.848 | 3.565 | 4.770 | 4.866 | 4.962 | Invalidated tp3 | 3.59 | 5.8 / 5.8 / 5.8 | 1 / 1 / 1 | 4.00 | 4.6 / 4.7 |
| 2020-08-31 | 2020-09-03 | 2.902 | 2.791 | 3.665 | 3.720 | 3.888 | Stop | -1.85 | -1.3 / -1.3 / -1.3 | - / - / - | -5.43 | -1.8 / -1.8 |
| 2021-12-30 | 2022-01-24 | 2.325 | 2.204 | 2.563 | 2.635 | 3.033 | Stop | -1.06 | -0.5 / -0.4 / -0.4 | - / - / - | -4.37 | -1.0 / -1.0 |
| 2022-08-01 | 2022-10-12 | 2.317 | 2.109 | 2.563 | 2.635 | 3.033 | Invalidated tp2 | 1.27 | 2.3 / 4.8 / 7.2 | 1 / 1 / 18 | 1.18 | 1.7 / 2.3 |
| 2022-10-31 | 2023-03-06 | 2.889 | 2.768 | 3.033 | 3.154 | 3.275 | Invalidated tp3 | 5.47 | 14.1 / 17.3 / 17.3 | 1 / 1 / 1 | 11.41 | 5.5 / 8.4 |
| 2023-06-05 | 2024-03-06 | 5.189 | 4.952 | 5.426 | 5.662 | 5.899 | Invalidated tp3 | 7.94 | 30.2 / 30.2 / 30.2 | 1 / 1 / 1 | 20.74 | 0.7 / 2.2 |
| 2024-10-08 | 2024-10-13 | 9.167 | 8.785 | 9.692 | 10.24 | 10.64 | Stop tp1 | -0.81 | 4.6 / 4.6 / 4.6 | 3 / 3 / 3 | -2.13 | -1.8 / -1.8 |
| 2024-10-22 | 2024-11-17 | 9.668 | 8.661 | 12.34 | 14.98 | 15.98 | Invalidated | -0.63 | -0.4 / -0.4 / -0.4 | - / - / - | -1.49 | -0.6 / -1.0 |
| 2025-05-08 | 2025-05-19 | 8.732 | 8.587 | 9.078 | 9.236 | 9.267 | Stop | -1.22 | 0.6 / 1.1 / 13.4 | 37 / 37 / 37 | -6.69 | -1.1 / -1.1 |
| 2025-07-23 | 2025-09-09 | 10.30 | 9.767 | 10.94 | 14.98 | 15.51 | Invalidated tp1 | 0.89 | 1.2 / 8.4 / 11.4 | 11 / 22 / 30 | -0.87 | 2.5 / 0.1 |
| 2025-10-06 | 2026-02-24 | 13.84 | 12.86 | 14.98 | 15.96 | 16.94 | Invalidated tp3 | 2.52 | 5.3 / 5.4 / 6.3 | 1 / 1 / 1 | 3.06 | 1.2 / 1.3 |
| 2026-04-27 | 2026-05-11 | 19.72 | 18.79 | 21.02 | 21.96 | 22.89 | Stop | -1.07 | -0.4 / -0.1 / -0.1 | - / - / - | -2.91 | -1.0 / -1.0 |
| 2026-06-16 | 2026-06-23 | 18.93 | 18.42 | 19.60 | 20.04 | 21.02 | Stop | -1.15 | 0.8 / 0.8 / 8.7 | 28 / 28 / 28 | -3.82 | -1.1 / -1.1 |
| 2026-08-10 | 2026-08-31 | 21.19 | 20.49 | 21.90 | 22.60 | 23.31 | Stop tp2 | 0.53 | 0.5 / 0.5 / 0.5 | - / - / - | -7.36 | -1.2 / -1.2 |

</details>


#### ORWE  (2001-05-15 .. 2026-11-19, 6034 bars; EGX70; median initial risk 6.7% of entry)

**ORWE / base**: 43 closed trades (0 still open), net -9.16R, wins 14. Exits: Stop 25 (avg -1.04R), Trail 9 (avg 0.54R), Invalidated 4 (avg -0.49R), Target 5 (avg 2.80R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 25 (avg -1.04R) | 5/25 (20%) | 19% / 21% / 23% | 14/25 (56%) | 33% / 35% / 35% | 5 | 0.43 | 4% | 0% | -1.01 |
|   of which closed back ABOVE the stop that day (wick only) | 16 (avg -1.04R) | 3/16 (19%) | 20% / 22% / 25% | 10/16 (63%) | 34% / 37% / 37% | 4.5 | 0.76 | 6% | 0% | -1.01 |
|   of which closed at/below the stop | 9 (avg -1.04R) | 2/9 (22%) | 17% / 18% / 21% | 4/9 (44%) | 29% / 32% / 31% | 10 | 0.10 | 0% | 0% | -1.00 |
| Invalidated, no target reached | 4 (avg -0.49R) | 0/4 (0%) | 28% / 31% / 35% | 0/4 (0%) | 46% / 49% / 49% | 24.5 | 0.20 | 25% | 0% | -0.63 |
| All pre-target exits (Stop+Invalidated) | 29 (avg -0.97R) | 5/29 (17%) | 20% / 22% / 25% | 14/29 (48%) | 34% / 37% / 37% | 8 | 0.41 | 7% | 0% | -0.96 |
| Stop/trail after TP1+ (next target) | 9 (avg 0.54R) | 3/9 (33%) | 25% / 27% / 31% | 4/8 (50%) | 40% / 42% / 43% | 24 | 2.12 | 56% | 44% | -0.01 |

Literal control for base (X = median TP1 distance 8.7% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 43% / 59%; up-trend 45% / 61%.

<details><summary>ORWE base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2005-03-22 | 2005-03-29 | 1.295 | 1.140 | 1.624 | 1.780 | 1.935 | Stop | -1.02 | 0.3 / 0.3 / 0.3 | - / - / - | -1.91 | -1.0 / -1.0 |
| 2005-04-07 | 2005-05-22 | 1.249 | 1.087 | 1.624 | 1.786 | 1.948 | Stop | -1.01 | -0.9 / -0.1 / 0.7 | - / - / - | -1.68 | -0.5 / -1.0 |
| 2005-09-11 | 2005-09-13 | 1.197 | 1.089 | 1.370 | 1.624 | 1.732 | Stop | -1.02 | 0.2 / 0.2 / 4.6 | 23 / 38 / - | -1.12 | -1.0 / -1.0 |
| 2005-10-18 | 2005-11-23 | 1.288 | 1.162 | 1.624 | 1.750 | 1.876 | Trail tp1 | 0.87 | 2.7 / 3.2 / 4.3 | 10 / 38 / - | -0.08 | 0.9 / 1.9 |
| 2005-12-13 | 2006-02-06 | 1.540 | 1.405 | 1.690 | 1.825 | 1.961 | Trail tp2 | 1.04 | 0.4 / 0.4 / 0.4 | - / - / - | -4.44 | -0.3 / -1.0 |
| 2010-08-02 | 2010-10-26 | 1.099 | 0.981 | 1.218 | 1.336 | 1.454 | Invalidated | -0.29 | 0.4 / 0.4 / 0.6 | - / - / - | -0.39 | -0.6 / -0.0 |
| 2014-01-09 | 2014-03-17 | 1.439 | 1.320 | 1.558 | 1.677 | 1.797 | Target tp3 | 1.97 | 5.2 / 5.2 / 6.4 | 1 / 1 / 1 | 3.58 | 0.7 / 1.7 |
| 2014-03-19 | 2014-06-01 | 1.906 | 1.729 | 2.083 | 2.260 | 2.437 | Trail tp1 | 0.06 | 1.3 / 1.8 / 1.8 | 5 / - / - | -0.40 | 0.4 / 1.7 |
| 2014-06-09 | 2014-08-05 | 2.101 | 1.888 | 2.315 | 2.528 | 2.742 | Invalidated | -0.11 | -0.0 / -0.0 / 0.1 | - / - / - | -1.18 | 0.2 / -0.5 |
| 2014-11-05 | 2014-12-08 | 2.195 | 2.075 | 2.315 | 2.436 | 2.556 | Target tp3 | 1.96 | 4.2 / 5.8 / 9.2 | 1 / 1 / 1 | 2.77 | 1.3 / 3.3 |
| 2014-12-14 | 2014-12-17 | 2.566 | 2.444 | 2.688 | 2.810 | 2.933 | Stop | -1.04 | 0.7 / 4.9 / 6.0 | 12 / 13 / 16 | -0.66 | -1.0 / -1.0 |
| 2016-03-17 | 2016-04-03 | 1.825 | 1.588 | 2.449 | 2.474 | 2.550 | Stop | -1.01 | -0.7 / -0.3 / -0.3 | - / - / - | -1.69 | -1.0 / -1.0 |
| 2016-09-06 | 2016-11-17 | 1.784 | 1.644 | 1.961 | 2.474 | 2.550 | Target tp3 | 3.86 | 13.0 / 16.2 / 17.9 | 1 / 1 / 2 | 4.11 | 2.4 / 4.1 |
| 2016-11-22 | 2016-12-18 | 2.613 | 2.286 | 3.299 | 3.626 | 3.952 | Target tp3 | 3.08 | 4.7 / 5.1 / 6.7 | 1 / 1 / 2 | 3.68 | 3.8 / 3.9 |
| 2017-02-09 | 2017-02-12 | 4.433 | 4.134 | 4.731 | 5.029 | 5.328 | Stop | -1.03 | -0.3 / 0.5 / 1.3 | 34 / - / - | -2.08 | -1.0 / -1.0 |
| 2017-04-05 | 2017-05-22 | 4.653 | 4.417 | 4.889 | 5.125 | 5.361 | Trail tp1 | 0.75 | 2.1 / 2.1 / 2.1 | 1 / 2 / - | 0.65 | 1.0 / 0.8 |
| 2019-01-06 | 2019-01-22 | 3.126 | 2.951 | 3.533 | 3.753 | 4.741 | Stop | -1.04 | 0.5 / 1.8 / 3.0 | 33 / - / - | -1.42 | -1.0 / -1.0 |
| 2019-03-11 | 2019-03-25 | 3.530 | 3.327 | 3.753 | 4.741 | 4.876 | Stop | -1.03 | -0.3 / 1.5 / 1.5 | 20 / - / - | -1.34 | -1.0 / -1.0 |
| 2020-02-24 | 2020-03-01 | 3.394 | 3.290 | 3.553 | 3.582 | 3.779 | Stop | -1.07 | 0.4 / 0.4 / 0.4 | - / - / - | -11.63 | -1.0 / -1.0 |
| 2020-10-28 | 2020-11-03 | 3.758 | 3.562 | 3.955 | 4.151 | 4.347 | Stop | -1.04 | 4.0 / 5.4 / 5.5 | 4 / 5 / 5 | -1.38 | -1.0 / -1.0 |
| 2021-06-28 | 2021-07-11 | 5.957 | 5.469 | 6.445 | 6.932 | 7.420 | Stop | -1.02 | -0.2 / -0.2 / 1.2 | 39 / - / - | -1.40 | -1.0 / -1.0 |
| 2021-09-06 | 2021-09-20 | 6.040 | 5.689 | 6.392 | 6.744 | 7.095 | Trail tp1 | 0.30 | 0.6 / 0.6 / 0.6 | - / - / - | -1.24 | -0.2 / -1.0 |
| 2022-03-23 | 2022-04-11 | 6.249 | 5.711 | 6.786 | 7.323 | 7.861 | Invalidated | -0.55 | 0.7 / 0.7 / 0.7 | - / - / - | -2.25 | -1.0 / -1.0 |
| 2022-12-04 | 2022-12-08 | 6.931 | 6.438 | 7.424 | 7.917 | 8.409 | Trail tp1 | 0.30 | 4.8 / 4.8 / 5.3 | 3 / 3 / 4 | 0.00 | -1.0 / -1.0 |
| 2022-12-18 | 2022-12-22 | 8.719 | 8.235 | 9.202 | 9.686 | 10.17 | Stop | -1.04 | 0.1 / 0.1 / 1.7 | 22 / - / - | -2.54 | -1.0 / -1.0 |
| 2023-01-04 | 2023-01-11 | 8.545 | 7.838 | 9.286 | 9.993 | 10.70 | Stop | -1.02 | 1.0 / 1.4 / 1.4 | 12 / - / - | -1.11 | -1.0 / -1.0 |
| 2023-02-01 | 2023-02-05 | 9.215 | 8.140 | 10.29 | 11.37 | 12.44 | Stop | -1.02 | 0.1 / 0.1 / 2.1 | 38 / 39 / - | -1.43 | -1.0 / -1.0 |
| 2023-02-21 | 2023-03-15 | 8.845 | 8.243 | 9.530 | 10.13 | 10.73 | Stop | -1.03 | 3.5 / 4.9 / 9.4 | 8 / 10 / 10 | -1.94 | -1.0 / -1.0 |
| 2023-05-03 | 2023-05-17 | 12.44 | 11.54 | 13.33 | 14.23 | 15.13 | Trail tp1 | 0.30 | 0.7 / 0.9 / 0.9 | - / - / - | -1.37 | 0.4 / -1.0 |
| 2023-08-08 | 2023-08-24 | 12.98 | 12.28 | 14.16 | 14.52 | 15.22 | Stop | -1.04 | 1.3 / 1.3 / 4.1 | 36 / 36 / 36 | -1.62 | -1.0 / -1.0 |
| 2023-09-03 | 2023-09-19 | 12.90 | 12.52 | 13.35 | 14.16 | 14.52 | Trail tp1 | 0.32 | 0.3 / 7.8 / 10.5 | 17 / 18 / 18 | -2.80 | -1.0 / -1.0 |
| 2023-10-29 | 2023-10-31 | 15.62 | 14.61 | 16.62 | 17.62 | 18.62 | Stop | -1.03 | 0.1 / 0.2 / 0.2 | - / - / - | -2.57 | -1.0 / -1.0 |
| 2024-01-17 | 2024-01-28 | 15.27 | 14.52 | 16.89 | 17.64 | 18.38 | Target tp3 | 3.13 | 12.0 / 12.0 / 12.0 | 1 / 1 / 1 | 5.47 | 5.8 / -1.0 |
| 2024-02-01 | 2024-02-25 | 20.08 | 16.76 | 23.40 | 26.72 | 30.04 | Stop | -1.01 | -0.4 / -0.4 / -0.4 | - / - / - | -1.71 | -1.0 / -1.0 |
| 2024-06-05 | 2024-06-09 | 18.35 | 17.30 | 21.55 | 24.24 | 25.29 | Stop | -1.03 | 2.8 / 2.8 / 3.3 | 25 / - / - | -1.63 | -1.0 / -1.0 |
| 2024-06-25 | 2024-08-05 | 20.60 | 19.23 | 24.24 | 25.61 | 26.99 | Stop | -1.21 | 0.8 / 1.1 / 1.7 | - / - / - | -0.41 | 0.2 / -1.2 |
| 2024-08-18 | 2024-08-22 | 21.27 | 20.43 | 24.24 | 25.08 | 25.91 | Stop | -1.05 | -0.1 / 1.9 / 11.1 | 37 / 39 / 39 | -1.89 | -1.0 / -1.0 |
| 2025-01-27 | 2025-02-11 | 22.50 | 21.33 | 23.95 | 26.38 | 30.58 | Invalidated | -1.02 | -0.3 / -0.3 / -0.3 | - / - / - | -3.76 | -1.0 / -1.0 |
| 2025-07-02 | 2025-07-28 | 22.12 | 21.33 | 23.95 | 30.58 | 31.37 | Stop | -1.06 | -0.5 / -0.2 / -0.2 | - / - / - | -3.37 | -1.0 / -1.0 |
| 2025-10-26 | 2025-11-02 | 22.47 | 21.82 | 23.95 | 30.58 | 31.24 | Stop | -1.07 | 1.5 / 1.5 / 1.5 | - / - / - | -3.02 | -1.0 / -1.0 |
| 2025-11-10 | 2025-11-16 | 23.31 | 22.27 | 30.58 | 31.62 | 32.65 | Stop | -1.04 | -0.8 / -0.8 / -0.8 | - / - / - | -2.72 | -1.0 / -1.0 |
| 2026-06-07 | 2026-06-28 | 23.80 | 22.56 | 30.58 | 31.82 | 33.06 | Stop | -1.04 | -0.5 / -0.3 / 2.9 | - / - / - | -1.49 | -1.0 / -1.0 |
| 2026-08-19 | 2026-09-28 | 25.39 | 24.00 | 27.41 | 30.58 | 31.97 | Trail tp1 | 0.87 | 1.9 / 2.2 / - | 3 / - / - | 0.66 | 1.9 / 0.5 |

</details>

**ORWE / rec**: 25 closed trades (0 still open), net 10.32R, wins 9. Exits: Stop 11 (avg -1.26R), Trail 0 (avg -R), Invalidated 14 (avg 1.73R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 11 (avg -1.26R) | 2/11 (18%) | 16% / 17% / 19% | 3/11 (27%) | 27% / 29% / 29% | 14 | -0.07 | 9% | 0% | -1.18 |
| Invalidated, no target reached | 3 (avg -0.62R) | 0/3 (0%) | 27% / 29% / 33% | 0/3 (0%) | 44% / 47% / 47% | 13 | 0.41 | 0% | 0% | -0.75 |
| All pre-target exits (Stop+Invalidated) | 14 (avg -1.12R) | 2/14 (14%) | 18% / 19% / 22% | 3/14 (21%) | 31% / 33% / 33% | 13.5 | 0.08 | 7% | 0% | -1.09 |
| Invalidated after TP1+ (next target) | 5 (avg 0.98R) | 0/5 (0%) | 11% / 12% / 14% | 0/4 (0%) | 21% / 23% / 23% | 43 | 0.92 | 80% | 60% | 0.24 |

Literal control for rec (X = median TP1 distance 8.3% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 44% / 61%; up-trend 46% / 62%.

<details><summary>ORWE rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2005-03-22 | 2005-03-30 | 1.295 | 1.140 | 1.624 | 1.780 | 1.935 | Stop | -1.52 | 0.3 / 0.3 / 0.3 | - / - / - | -1.91 | -1.5 / -1.5 |
| 2005-04-07 | 2005-05-22 | 1.249 | 1.087 | 1.624 | 1.786 | 1.948 | Stop | -1.09 | -0.9 / -0.1 / 0.7 | - / - / - | -1.68 | -0.5 / -1.1 |
| 2005-09-11 | 2005-09-20 | 1.197 | 1.089 | 1.370 | 1.624 | 1.732 | Stop | -1.07 | 0.2 / 1.8 / 4.6 | 18 / 33 / - | -0.91 | -1.1 / -1.1 |
| 2005-10-18 | 2006-02-09 | 1.288 | 1.162 | 1.624 | 1.750 | 1.876 | Invalidated tp2 | 2.52 | 1.7 / 1.7 / 1.7 | - / - / - | -2.78 | 0.9 / 1.9 |
| 2010-08-02 | 2010-10-26 | 1.099 | 0.981 | 1.218 | 1.336 | 1.454 | Invalidated | -0.29 | 0.4 / 0.4 / 0.6 | - / - / - | -0.39 | -0.6 / -0.0 |
| 2014-01-09 | 2014-08-05 | 1.439 | 1.320 | 1.558 | 1.677 | 1.797 | Invalidated tp3 | 2.77 | 5.5 / 5.5 / 5.7 | 1 / 1 / 1 | 5.08 | 0.7 / 1.7 |
| 2014-11-05 | 2015-02-26 | 2.195 | 2.075 | 2.315 | 2.436 | 2.556 | Invalidated tp3 | 1.98 | 4.4 / 4.4 / 4.4 | 1 / 1 / 1 | 2.50 | 1.3 / 3.3 |
| 2016-03-17 | 2016-04-06 | 1.825 | 1.588 | 2.449 | 2.474 | 2.550 | Stop | -1.29 | -0.3 / -0.3 / -0.3 | - / - / - | -1.69 | -1.3 / -1.3 |
| 2016-09-06 | 2017-06-19 | 1.784 | 1.644 | 1.961 | 2.474 | 2.550 | Invalidated tp3 | 9.14 | 22.1 / 22.2 / 22.4 | 1 / 1 / 1 | 21.14 | 2.4 / 4.1 |
| 2019-01-06 | 2019-04-23 | 3.126 | 2.951 | 3.533 | 3.753 | 4.741 | Invalidated tp2 | 2.02 | 0.3 / 0.4 / 2.2 | - / - / - | -1.26 | 0.1 / 0.8 |
| 2020-02-24 | 2020-03-01 | 3.394 | 3.290 | 3.553 | 3.582 | 3.779 | Stop | -1.36 | 0.4 / 0.4 / 0.4 | - / - / - | -11.63 | -1.3 / -1.3 |
| 2020-10-28 | 2020-12-17 | 3.758 | 3.562 | 3.955 | 4.151 | 4.347 | Invalidated tp3 | 1.80 | 2.8 / 3.5 / 3.7 | 1 / 1 / 17 | 1.99 | 3.8 / 1.7 |
| 2021-06-28 | 2021-07-15 | 5.957 | 5.469 | 6.445 | 6.932 | 7.420 | Stop | -1.06 | -0.2 / -0.2 / 1.2 | 35 / - / - | -1.04 | -1.0 / -1.0 |
| 2021-09-06 | 2021-10-19 | 6.040 | 5.689 | 6.392 | 6.744 | 7.095 | Invalidated tp1 | -0.14 | -0.2 / 0.1 / 0.1 | - / - / - | -1.24 | -0.2 / -1.0 |
| 2022-03-23 | 2022-04-11 | 6.249 | 5.711 | 6.786 | 7.323 | 7.861 | Invalidated | -0.55 | 0.7 / 0.7 / 0.7 | - / - / - | -2.25 | -1.0 / -1.0 |
| 2022-12-04 | 2023-03-15 | 6.931 | 6.438 | 7.424 | 7.917 | 8.409 | Invalidated tp3 | 1.61 | 8.1 / 9.9 / 15.4 | 1 / 1 / 3 | 1.52 | 2.7 / 4.6 |
| 2023-05-03 | 2023-05-17 | 12.44 | 11.54 | 13.33 | 14.23 | 15.13 | Invalidated tp1 | -0.16 | 0.7 / 0.9 / 0.9 | - / - / - | -1.37 | 0.4 / -0.9 |
| 2023-08-08 | 2023-10-08 | 12.98 | 12.28 | 14.16 | 14.52 | 15.22 | Stop | -1.49 | 4.1 / 5.6 / 5.6 | 7 / 7 / 7 | -1.45 | 1.0 / -0.9 |
| 2023-10-29 | 2023-11-07 | 15.62 | 14.61 | 16.62 | 17.62 | 18.62 | Stop | -1.11 | -0.2 / 0.2 / 0.2 | - / - / - | -2.57 | -1.1 / -1.1 |
| 2024-01-17 | 2024-10-02 | 15.27 | 14.52 | 16.89 | 17.64 | 18.38 | Invalidated tp3 | 3.90 | 12.5 / 20.5 / 20.5 | 1 / 1 / 1 | 6.52 | 5.8 / -0.2 |
| 2025-01-27 | 2025-02-11 | 22.50 | 21.33 | 23.95 | 26.38 | 30.58 | Invalidated | -1.02 | -0.3 / -0.3 / -0.3 | - / - / - | -3.76 | -1.2 / -1.2 |
| 2025-07-02 | 2025-07-28 | 22.12 | 21.33 | 23.95 | 30.58 | 31.37 | Stop | -1.18 | -0.5 / -0.2 / -0.2 | - / - / - | -3.37 | -1.1 / -1.1 |
| 2025-10-26 | 2025-11-19 | 22.47 | 21.82 | 23.95 | 30.58 | 31.24 | Stop | -1.34 | -1.0 / -0.4 / -0.2 | - / - / - | -3.66 | -1.3 / -1.3 |
| 2026-06-07 | 2026-06-28 | 23.80 | 22.56 | 30.58 | 31.82 | 33.06 | Stop | -1.37 | -0.5 / -0.3 / 2.9 | - / - / - | -1.49 | -1.3 / -1.3 |
| 2026-08-19 | 2026-10-21 | 25.39 | 24.00 | 27.41 | 30.58 | 31.97 | Invalidated tp1 | 0.62 | 0.4 / 1.0 / - | - / - / - | -2.30 | 1.9 / 0.5 |

</details>


#### EEII  (2003-01-19 .. 2026-11-19, 3921 bars; OTHER; median initial risk 13.6% of entry)

**EEII / base**: 8 closed trades (0 still open), net 1.81R, wins 4. Exits: Stop 2 (avg -1.01R), Trail 2 (avg 0.31R), Invalidated 2 (avg -0.65R), Target 2 (avg 2.26R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Stop, no target reached | 2 (avg -1.01R) | 0/2 (0%) | 3% / 3% / 5% | 0/2 (0%) | 9% / 8% / 10% | 29 | -0.25 | 50% | 0% | -1.00 |
|   of which closed back ABOVE the stop that day (wick only) | 1 (avg -1.01R) | 0/1 (0%) | 1% / 1% / 2% | 0/1 (0%) | 3% / 2% / 3% | 23 | -0.10 | 0% | 0% | -1.00 |
|   of which closed at/below the stop | 1 (avg -1.01R) | 0/1 (0%) | 6% / 5% / 7% | 0/1 (0%) | 15% / 13% / 17% | 35 | -0.39 | 100% | 0% | -1.00 |
| Invalidated, no target reached | 2 (avg -0.65R) | 0/2 (0%) | 5% / 5% / 8% | 0/2 (0%) | 13% / 13% / 16% | 16 | -0.16 | 0% | 0% | -1.00 |
| All pre-target exits (Stop+Invalidated) | 4 (avg -0.83R) | 0/4 (0%) | 4% / 4% / 6% | 0/4 (0%) | 11% / 10% / 13% | 22 | -0.25 | 25% | 0% | -1.00 |
| Stop/trail after TP1+ (next target) | 2 (avg 0.31R) | 1/2 (50%) | 24% / 24% / 32% | 1/2 (50%) | 41% / 43% / 46% | 7.5 | 1.96 | 0% | 0% | -1.00 |

Literal control for base (X = median TP1 distance 15.6% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 33% / 50%; up-trend 34% / 53%.

<details><summary>EEII base: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2021-06-14 | 2021-07-11 | 0.995 | 0.894 | 1.154 | 1.255 | 1.356 | Target tp3 | 2.54 | 14.2 / 21.7 / 24.8 | 1 / 1 / 1 | 3.89 | 5.4 / 23.2 |
| 2021-07-26 | 2021-09-13 | 2.235 | 1.810 | 2.660 | 3.085 | 3.510 | Target tp3 | 1.99 | 3.5 / 4.2 / 4.2 | 1 / 1 / 1 | 2.80 | 1.9 / 2.1 |
| 2022-08-17 | 2022-09-01 | 0.957 | 0.817 | 1.740 | 1.782 | 1.981 | Invalidated | -0.44 | 0.1 / 0.1 / 0.1 | - / - / - | -1.36 | -0.5 / -1.0 |
| 2024-02-01 | 2024-03-05 | 1.256 | 1.090 | 2.235 | 4.035 | 4.201 | Stop | -1.01 | -0.1 / -0.1 / -0.1 | - / - / - | -2.08 | -0.3 / -1.0 |
| 2025-03-23 | 2025-04-06 | 1.359 | 1.249 | 1.470 | 1.580 | 1.691 | Trail tp1 | 0.31 | 3.1 / 3.4 / 4.3 | 6 / 6 / 9 | -1.20 | -1.0 / -1.0 |
| 2025-04-16 | 2025-06-15 | 1.649 | 1.418 | 1.880 | 2.111 | 2.342 | Stop | -1.01 | -0.9 / -0.4 / -0.1 | - / - / - | -2.44 | 0.1 / -1.0 |
| 2025-12-10 | 2025-12-23 | 1.906 | 1.740 | 2.073 | 2.239 | 2.406 | Trail tp1 | 0.31 | 0.5 / 0.5 / 0.5 | - / - / - | -2.09 | -0.7 / -1.0 |
| 2026-08-12 | 2026-09-13 | 2.636 | 2.234 | 3.037 | 3.439 | 3.841 | Invalidated | -0.87 | -0.4 / -0.4 / -0.4 | - / - / - | -3.02 | -0.7 / -1.0 |

</details>

**EEII / rec**: 6 closed trades (0 still open), net 5.09R, wins 2. Exits: Stop 2 (avg -0.00R), Trail 0 (avg -R), Invalidated 4 (avg 1.27R), Target 0 (avg -R).

| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |
|---|---|---|---|---|---|---|---|---|---|---|
| Invalidated, no target reached | 3 (avg -0.62R) | 0/3 (0%) | 4% / 3% / 6% | 0/3 (0%) | 10% / 9% / 12% | 21 | -0.29 | 0% | 0% | -1.13 |
| All pre-target exits (Stop+Invalidated) | 3 (avg -0.62R) | 0/3 (0%) | 4% / 3% / 6% | 0/3 (0%) | 10% / 9% / 12% | 21 | -0.29 | 0% | 0% | -1.13 |
| Stop/trail after TP1+ (next target) | 1 (avg -0.45R) | 0/1 (0%) | 11% / 10% / 16% | 0/1 (0%) | 27% / 26% / 31% | 22 | -0.80 | 0% | 0% | -1.14 |

Literal control for rec (X = median TP1 distance 15.6% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): 33% / 50%; up-trend 34% / 53%.

<details><summary>EEII rec: trade list</summary>

| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2021-06-14 | 2021-10-19 | 0.995 | 0.894 | 1.154 | 1.255 | 1.356 | Invalidated tp3 | 6.94 | 20.0 / 20.0 / 20.0 | 1 / 1 / 1 | 11.47 | 5.4 / 23.2 |
| 2022-08-17 | 2022-09-01 | 0.957 | 0.817 | 1.740 | 1.782 | 1.981 | Invalidated | -0.44 | 0.1 / 0.1 / 0.1 | - / - / - | -1.36 | -0.5 / -1.2 |
| 2024-02-01 | 2024-03-06 | 1.256 | 1.090 | 2.235 | 4.035 | 4.201 | Invalidated | -0.54 | -0.3 / -0.3 / -0.3 | - / - / - | -2.47 | -0.3 / -1.0 |
| 2025-03-23 | 2025-06-19 | 1.359 | 1.249 | 1.470 | 1.580 | 1.691 | Stop tp3 | 0.45 | 1.8 / 2.1 / 2.4 | 8 / 19 / - | -2.48 | 3.0 / 1.8 |
| 2025-12-10 | 2026-01-13 | 1.906 | 1.740 | 2.073 | 2.239 | 2.406 | Stop tp1 | -0.45 | -0.8 / -0.8 / -0.8 | - / - / - | -3.48 | -0.7 / -1.1 |
| 2026-08-12 | 2026-09-13 | 2.636 | 2.234 | 3.037 | 3.439 | 3.841 | Invalidated | -0.87 | -0.4 / -0.4 / -0.4 | - / - / - | -3.02 | -0.7 / -1.2 |

</details>



## 4. Variants

| Variant | Config | CHoCH exit rule |
|---|---|---|
| V1 | base | none: stop / targets / trail only |
| V2 | base | only a CHoCH on the Major tier (20-bar pivots) counts |
| V3 | base | an internal CHoCH counts only if that bar also closes beyond the entry price (long: close < entry) |
| V4 | rec | V1 |
| V5 | rec | V3 |
| V6 (extra) | rec | V2 |

All three rules use only information available at the close of the exit bar; they were fixed in advance from the mechanism ("Invalidated fires on a pullback that is still above entry"), not tuned. They were nevertheless *chosen after looking at the six bad examples*, which is why the six alone prove nothing: a variant has to help the 100 and both periods. Win % = net R > 0. PF in R = sum of winning R / sum of losing R. "CHoCH exits" = trades closed by the CHoCH rule. R per 100 bars in a trade = total R / total bars spent in trades x 100 (a variant that holds longer must earn more per trade to be as efficient). "Better / worse" counts symbols whose total R is higher / lower than the same family's baseline (base for V1-V3, rec for V4-V6). Periods are by trade open date (< 2023-01-01 and >= 2023-01-01). Removing the exit also removes trades (a longer trade blocks the single trade slot), so trade counts differ between rows.

**Data caveat for the 100-stock tables:** `data/egx` is split-adjusted only, so the cost term (0.1% slippage + 2 EGP commission, Min Risk 10 ticks) distorts early trades on low-priced history; absolute levels differ from the dividend-adjusted runs. The comparisons are paired within one dataset, which is what matters. The baseline row reproduces the settings sweep exactly (3701 trades, 0.099 avg R).


#### The six stocks (dividend-adjusted, data/egx-div): MASR, BTFH, EMFD, EFID, ORWE, EEII

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 188 | 37.8 | -0.086 | -16.1 | 0.85 | 29 | 14.4 | 107 / -0.031 / -3 | 81 / -0.158 / -13 | -0.60 |  |
| V1 base, no CHoCH exit | 183 | 39.3 | -0.061 | -11.2 | 0.90 | 0 | 18.3 | 107 / 0.007 / 1 | 76 / -0.157 / -12 | -0.33 | 3 better / 3 worse / 0 same |
| V2 base, Major-tier CHoCH only | 185 | 39.5 | -0.083 | -15.3 | 0.87 | 1 | 17.6 | 107 / -0.046 / -5 | 78 / -0.133 / -10 | -0.47 | 2 better / 4 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 185 | 37.8 | -0.031 | -5.8 | 0.95 | 21 | 16.2 | 107 / 0.072 / 8 | 78 / -0.173 / -14 | -0.19 | 3 better / 1 worse / 2 same |
| rec (Stop on Close + r4) | 130 | 34.6 | 0.168 | 21.8 | 1.27 | 67 | 33.6 | 78 / 0.199 / 16 | 52 / 0.121 / 6 | 0.50 |  |
| V4 rec + V1 (no CHoCH exit) | 96 | 31.3 | 0.372 | 35.7 | 1.48 | 0 | 75.7 | 66 / 0.230 / 15 | 30 / 0.683 / 21 | 0.49 | 3 better / 3 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 100 | 31.0 | 0.365 | 36.5 | 1.54 | 21 | 70.6 | 67 / 0.306 / 21 | 33 / 0.483 / 16 | 0.52 | 4 better / 2 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 96 | 31.3 | 0.378 | 36.3 | 1.49 | 5 | 75.4 | 66 / 0.236 / 16 | 30 / 0.690 / 21 | 0.50 | 3 better / 3 worse / 0 same |

#### The other 13 dividend-adjusted names in data/egx-div (CNFN, COMI, DAPH, EAST, EGCH, ELEC, ELSH, ETEL, FWRY, GBCO, HRHO, MCQE, VLMRA) - not selected as bad examples

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 595 | 41.5 | 0.082 | 48.6 | 1.14 | 50 | 16.2 | 412 / 0.073 / 30 | 183 / 0.101 / 19 | 0.50 |  |
| V1 base, no CHoCH exit | 576 | 42.2 | 0.124 | 71.1 | 1.20 | 0 | 19.3 | 398 / 0.121 / 48 | 178 / 0.129 / 23 | 0.64 | 7 better / 6 worse / 0 same |
| V2 base, Major-tier CHoCH only | 584 | 42.3 | 0.104 | 60.9 | 1.17 | 9 | 17.9 | 402 / 0.115 / 46 | 182 / 0.080 / 15 | 0.58 | 5 better / 8 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 582 | 41.8 | 0.126 | 73.3 | 1.21 | 35 | 18.1 | 403 / 0.118 / 47 | 179 / 0.144 / 26 | 0.70 | 6 better / 1 worse / 6 same |
| rec (Stop on Close + r4) | 403 | 41.4 | 0.491 | 198.0 | 1.78 | 204 | 37.8 | 283 / 0.507 / 144 | 120 / 0.454 / 54 | 1.30 |  |
| V4 rec + V1 (no CHoCH exit) | 252 | 41.3 | 0.895 | 225.5 | 2.28 | 0 | 99.6 | 193 / 0.964 / 186 | 59 / 0.669 / 39 | 0.90 | 7 better / 6 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 277 | 39.0 | 0.813 | 225.3 | 2.29 | 52 | 85.1 | 205 / 0.872 / 179 | 72 / 0.645 / 46 | 0.96 | 7 better / 6 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 253 | 41.9 | 0.893 | 225.9 | 2.28 | 26 | 97.5 | 193 / 0.979 / 189 | 60 / 0.616 / 37 | 0.92 | 8 better / 5 worse / 0 same |

#### Single stock MASR (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 40 | 42.5 | -0.004 | -0.2 | 0.99 | 5 | 11.2 | 24 / -0.112 / -3 | 16 / 0.157 / 3 | -0.04 |  |
| V1 base, no CHoCH exit | 40 | 45.0 | 0.021 | 0.8 | 1.04 | 0 | 12.4 | 24 / -0.075 / -2 | 16 / 0.166 / 3 | 0.17 | 1 better / 0 worse / 0 same |
| V2 base, Major-tier CHoCH only | 40 | 45.0 | 0.021 | 0.8 | 1.04 | 0 | 12.4 | 24 / -0.075 / -2 | 16 / 0.166 / 3 | 0.17 | 1 better / 0 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 40 | 42.5 | 0.045 | 1.8 | 1.08 | 4 | 11.5 | 24 / -0.030 / -1 | 16 / 0.157 / 3 | 0.39 | 1 better / 0 worse / 0 same |
| rec (Stop on Close + r4) | 28 | 46.4 | 0.169 | 4.7 | 1.37 | 16 | 28.1 | 18 / -0.022 / -0 | 10 / 0.512 / 5 | 0.60 |  |
| V4 rec + V1 (no CHoCH exit) | 20 | 40.0 | 0.394 | 7.9 | 1.66 | 0 | 66.0 | 16 / -0.333 / -5 | 4 / 3.302 / 13 | 0.60 | 1 better / 0 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 20 | 40.0 | 0.474 | 9.5 | 1.91 | 3 | 65.3 | 16 / -0.233 / -4 | 4 / 3.302 / 13 | 0.72 | 1 better / 0 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 20 | 40.0 | 0.394 | 7.9 | 1.66 | 0 | 66.0 | 16 / -0.333 / -5 | 4 / 3.302 / 13 | 0.60 | 1 better / 0 worse / 0 same |

#### Single stock BTFH (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 28 | 35.7 | 0.044 | 1.2 | 1.08 | 8 | 15.6 | 18 / 0.358 / 6 | 10 / -0.521 / -5 | 0.28 |  |
| V1 base, no CHoCH exit | 25 | 40.0 | 0.148 | 3.7 | 1.24 | 0 | 25.3 | 18 / 0.534 / 10 | 7 / -0.844 / -6 | 0.59 | 1 better / 0 worse / 0 same |
| V2 base, Major-tier CHoCH only | 27 | 40.7 | -0.015 | -0.4 | 0.98 | 1 | 19.9 | 18 / 0.222 / 4 | 9 / -0.489 / -4 | -0.08 | 0 better / 1 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 25 | 40.0 | 0.246 | 6.1 | 1.47 | 5 | 23.0 | 18 / 0.670 / 12 | 7 / -0.844 / -6 | 1.07 | 1 better / 0 worse / 0 same |
| rec (Stop on Close + r4) | 23 | 26.1 | 0.034 | 0.8 | 1.05 | 13 | 25.2 | 13 / 0.412 / 5 | 10 / -0.457 / -5 | 0.14 |  |
| V4 rec + V1 (no CHoCH exit) | 17 | 29.4 | -0.101 | -1.7 | 0.88 | 0 | 69.2 | 9 / 0.276 / 2 | 8 / -0.525 / -4 | -0.15 | 0 better / 1 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 18 | 27.8 | -0.006 | -0.1 | 0.99 | 5 | 61.9 | 10 / 0.324 / 3 | 8 / -0.419 / -3 | -0.01 | 0 better / 1 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 17 | 29.4 | -0.089 | -1.5 | 0.90 | 2 | 68.6 | 9 / 0.298 / 3 | 8 / -0.525 / -4 | -0.13 | 0 better / 1 worse / 0 same |

#### Single stock EMFD (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 35 | 34.3 | -0.224 | -7.8 | 0.64 | 5 | 12.6 | 21 / -0.580 / -12 | 14 / 0.311 / 4 | -1.77 |  |
| V1 base, no CHoCH exit | 33 | 36.4 | -0.046 | -1.5 | 0.93 | 0 | 21.2 | 21 / -0.413 / -9 | 12 / 0.595 / 7 | -0.22 | 1 better / 0 worse / 0 same |
| V2 base, Major-tier CHoCH only | 33 | 36.4 | -0.046 | -1.5 | 0.93 | 0 | 21.2 | 21 / -0.413 / -9 | 12 / 0.595 / 7 | -0.22 | 1 better / 0 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 35 | 31.4 | -0.123 | -4.3 | 0.82 | 2 | 16.7 | 21 / -0.413 / -9 | 14 / 0.311 / 4 | -0.74 | 1 better / 0 worse / 0 same |
| rec (Stop on Close + r4) | 28 | 25.0 | -0.436 | -12.2 | 0.44 | 11 | 24.4 | 18 / -0.860 / -15 | 10 / 0.328 / 3 | -1.78 |  |
| V4 rec + V1 (no CHoCH exit) | 22 | 22.7 | 0.118 | 2.6 | 1.13 | 0 | 50.3 | 16 / -0.714 / -11 | 6 / 2.336 / 14 | 0.23 | 1 better / 0 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 25 | 24.0 | -0.154 | -3.8 | 0.81 | 6 | 43.2 | 16 / -0.702 / -11 | 9 / 0.821 / 7 | -0.36 | 1 better / 0 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 22 | 22.7 | 0.126 | 2.8 | 1.14 | 1 | 49.3 | 16 / -0.714 / -11 | 6 / 2.367 / 14 | 0.26 | 1 better / 0 worse / 0 same |

#### Single stock EFID (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 34 | 41.2 | -0.059 | -2.0 | 0.89 | 5 | 16.4 | 16 / 0.006 / 0 | 18 / -0.117 / -2 | -0.36 |  |
| V1 base, no CHoCH exit | 34 | 41.2 | -0.118 | -4.0 | 0.81 | 0 | 18.0 | 16 / -0.044 / -1 | 18 / -0.184 / -3 | -0.66 | 0 better / 1 worse / 0 same |
| V2 base, Major-tier CHoCH only | 34 | 41.2 | -0.118 | -4.0 | 0.81 | 0 | 18.0 | 16 / -0.044 / -1 | 18 / -0.184 / -3 | -0.66 | 0 better / 1 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 34 | 41.2 | -0.061 | -2.1 | 0.89 | 4 | 16.4 | 16 / 0.006 / 0 | 18 / -0.121 / -2 | -0.37 | 0 better / 1 worse / 0 same |
| rec (Stop on Close + r4) | 20 | 40.0 | 0.656 | 13.1 | 2.07 | 9 | 47.6 | 11 / 0.555 / 6 | 9 / 0.779 / 7 | 1.38 |  |
| V4 rec + V1 (no CHoCH exit) | 14 | 28.6 | 0.920 | 12.9 | 2.16 | 0 | 92.7 | 10 / 0.894 / 9 | 4 / 0.987 / 4 | 0.99 | 0 better / 1 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 14 | 28.6 | 0.999 | 14.0 | 2.39 | 2 | 90.8 | 10 / 0.964 / 10 | 4 / 1.085 / 4 | 1.10 | 1 better / 0 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 14 | 28.6 | 0.920 | 12.9 | 2.16 | 0 | 92.7 | 10 / 0.894 / 9 | 4 / 0.987 / 4 | 0.99 | 0 better / 1 worse / 0 same |

#### Single stock ORWE (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 43 | 32.6 | -0.213 | -9.2 | 0.67 | 4 | 15.4 | 25 / 0.035 / 1 | 18 / -0.558 / -10 | -1.38 |  |
| V1 base, no CHoCH exit | 43 | 32.6 | -0.263 | -11.3 | 0.63 | 0 | 17.3 | 25 / -0.049 / -1 | 18 / -0.559 / -10 | -1.52 | 0 better / 1 worse / 0 same |
| V2 base, Major-tier CHoCH only | 43 | 32.6 | -0.263 | -11.3 | 0.63 | 0 | 17.3 | 25 / -0.049 / -1 | 18 / -0.559 / -10 | -1.52 | 0 better / 1 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 43 | 32.6 | -0.213 | -9.2 | 0.67 | 4 | 15.4 | 25 / 0.035 / 1 | 18 / -0.558 / -10 | -1.38 | 0 better / 0 worse / 1 same |
| rec (Stop on Close + r4) | 25 | 36.0 | 0.413 | 10.3 | 1.64 | 14 | 46.3 | 16 / 0.841 / 13 | 9 / -0.348 / -3 | 0.89 |  |
| V4 rec + V1 (no CHoCH exit) | 17 | 35.3 | 0.885 | 15.0 | 2.18 | 0 | 121.1 | 13 / 1.484 / 19 | 4 / -1.061 / -4 | 0.73 | 1 better / 0 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 17 | 35.3 | 0.961 | 16.3 | 2.43 | 2 | 117.4 | 13 / 1.583 / 21 | 4 / -1.061 / -4 | 0.82 | 1 better / 0 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 17 | 35.3 | 0.896 | 15.2 | 2.20 | 2 | 121.0 | 13 / 1.498 / 19 | 4 / -1.061 / -4 | 0.74 | 1 better / 0 worse / 0 same |

#### Single stock EEII (dividend-adjusted)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 8 | 50.0 | 0.226 | 1.8 | 1.54 | 2 | 19.6 | 3 / 1.364 / 4 | 5 / -0.457 / -2 | 1.15 |  |
| V1 base, no CHoCH exit | 8 | 50.0 | 0.136 | 1.1 | 1.27 | 0 | 21.1 | 3 / 1.171 / 4 | 5 / -0.485 / -2 | 0.65 | 0 better / 1 worse / 0 same |
| V2 base, Major-tier CHoCH only | 8 | 50.0 | 0.136 | 1.1 | 1.27 | 0 | 21.1 | 3 / 1.171 / 4 | 5 / -0.485 / -2 | 0.65 | 0 better / 1 worse / 0 same |
| V3 base, CHoCH only if close beyond entry | 8 | 50.0 | 0.226 | 1.8 | 1.54 | 2 | 19.6 | 3 / 1.364 / 4 | 5 / -0.457 / -2 | 1.15 | 0 better / 0 worse / 1 same |
| rec (Stop on Close + r4) | 6 | 33.3 | 0.848 | 5.1 | 3.21 | 4 | 35.8 | 2 / 3.252 / 7 | 4 / -0.354 / -1 | 2.37 |  |
| V4 rec + V1 (no CHoCH exit) | 6 | 33.3 | -0.159 | -1.0 | 0.75 | 0 | 51.5 | 2 / 0.636 / 1 | 4 / -0.556 / -2 | -0.31 | 0 better / 1 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 6 | 33.3 | 0.103 | 0.6 | 1.27 | 3 | 48.8 | 2 / 1.017 / 2 | 4 / -0.354 / -1 | 0.21 | 0 better / 1 worse / 0 same |
| extra: rec + V2 (Major-tier CHoCH only) | 6 | 33.3 | -0.159 | -1.0 | 0.75 | 0 | 51.5 | 2 / 0.636 / 1 | 4 / -0.556 / -2 | -0.31 | 0 better / 1 worse / 0 same |

#### All 100 symbols of data/egx (split-adjusted, full history)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 3701 | 42.0 | 0.099 | 365.5 | 1.17 | 398 | 16.1 | 2497 / 0.042 / 105 | 1204 / 0.216 / 260 | 0.61 |  |
| V1 base, no CHoCH exit | 3533 | 42.7 | 0.152 | 537.3 | 1.25 | 0 | 20.5 | 2402 / 0.096 / 230 | 1131 / 0.272 / 307 | 0.74 | 44 better / 47 worse / 7 same |
| V2 base, Major-tier CHoCH only | 3591 | 42.8 | 0.126 | 451.7 | 1.21 | 50 | 19.0 | 2433 / 0.055 / 133 | 1158 / 0.275 / 318 | 0.66 | 43 better / 48 worse / 7 same |
| V3 base, CHoCH only if close beyond entry | 3619 | 40.9 | 0.141 | 511.2 | 1.24 | 293 | 18.1 | 2441 / 0.095 / 231 | 1178 / 0.238 / 280 | 0.78 | 33 better / 27 worse / 38 same |
| rec (Stop on Close + r4) | 2478 | 42.5 | 0.480 | 1189.1 | 1.77 | 1314 | 37.1 | 1685 / 0.438 / 738 | 793 / 0.568 / 451 | 1.29 |  |
| V4 rec + V1 (no CHoCH exit) | 1570 | 38.3 | 0.765 | 1201.5 | 2.06 | 0 | 89.3 | 1194 / 0.776 / 927 | 376 / 0.731 / 275 | 0.86 | 42 better / 53 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 1723 | 37.0 | 0.671 | 1156.5 | 2.00 | 368 | 76.0 | 1274 / 0.711 / 905 | 449 / 0.559 / 251 | 0.88 | 34 better / 58 worse / 3 same |
| extra: rec + V2 (Major-tier CHoCH only) | 1593 | 38.4 | 0.755 | 1202.6 | 2.05 | 176 | 86.7 | 1205 / 0.779 / 939 | 388 / 0.680 / 264 | 0.87 | 40 better / 55 worse / 0 same |

#### data/egx, the 82 non-holdout names

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 3235 | 41.7 | 0.087 | 282.8 | 1.15 | 347 | 16.0 | 2225 / 0.029 / 64 | 1010 / 0.217 / 219 | 0.55 |  |
| V1 base, no CHoCH exit | 3093 | 42.3 | 0.146 | 450.1 | 1.23 | 0 | 20.5 | 2138 / 0.084 / 180 | 955 / 0.283 / 270 | 0.71 | 38 better / 37 worse / 5 same |
| V2 base, Major-tier CHoCH only | 3145 | 42.4 | 0.116 | 363.4 | 1.19 | 44 | 19.0 | 2169 / 0.039 / 84 | 976 / 0.286 / 279 | 0.61 | 38 better / 37 worse / 5 same |
| V3 base, CHoCH only if close beyond entry | 3162 | 40.7 | 0.137 | 434.4 | 1.23 | 254 | 18.3 | 2170 / 0.085 / 185 | 992 / 0.252 / 250 | 0.75 | 31 better / 21 worse / 28 same |
| rec (Stop on Close + r4) | 2176 | 42.4 | 0.467 | 1015.5 | 1.75 | 1150 | 36.9 | 1506 / 0.418 / 630 | 670 / 0.575 / 386 | 1.27 |  |
| V4 rec + V1 (no CHoCH exit) | 1380 | 38.0 | 0.756 | 1042.7 | 2.04 | 0 | 89.9 | 1064 / 0.765 / 814 | 316 / 0.724 / 229 | 0.84 | 38 better / 42 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 1503 | 37.1 | 0.683 | 1025.8 | 2.03 | 315 | 77.3 | 1132 / 0.705 / 798 | 371 / 0.613 / 227 | 0.88 | 32 better / 46 worse / 2 same |
| extra: rec + V2 (Major-tier CHoCH only) | 1400 | 38.1 | 0.743 | 1040.3 | 2.03 | 156 | 87.3 | 1073 / 0.763 / 819 | 327 / 0.676 / 221 | 0.85 | 36 better / 44 worse / 0 same |

#### data/egx, the 18 names held back in the earlier failure analysis

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 466 | 44.0 | 0.178 | 82.7 | 1.32 | 51 | 16.4 | 272 / 0.152 / 41 | 194 / 0.214 / 41 | 1.08 |  |
| V1 base, no CHoCH exit | 440 | 45.2 | 0.198 | 87.3 | 1.34 | 0 | 20.5 | 264 / 0.191 / 50 | 176 / 0.209 / 37 | 0.97 | 6 better / 10 worse / 2 same |
| V2 base, Major-tier CHoCH only | 446 | 45.3 | 0.198 | 88.3 | 1.34 | 6 | 19.3 | 264 / 0.187 / 49 | 182 / 0.214 / 39 | 1.02 | 5 better / 11 worse / 2 same |
| V3 base, CHoCH only if close beyond entry | 457 | 42.7 | 0.168 | 76.8 | 1.30 | 39 | 16.9 | 271 / 0.171 / 46 | 186 / 0.164 / 31 | 0.99 | 2 better / 6 worse / 10 same |
| rec (Stop on Close + r4) | 302 | 43.4 | 0.575 | 173.6 | 1.94 | 164 | 39.0 | 179 / 0.605 / 108 | 123 / 0.530 / 65 | 1.47 |  |
| V4 rec + V1 (no CHoCH exit) | 190 | 40.5 | 0.836 | 158.8 | 2.20 | 0 | 84.9 | 130 / 0.866 / 113 | 60 / 0.769 / 46 | 0.98 | 4 better / 11 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 220 | 35.9 | 0.594 | 130.6 | 1.87 | 53 | 67.0 | 142 / 0.752 / 107 | 78 / 0.305 / 24 | 0.89 | 2 better / 12 worse / 1 same |
| extra: rec + V2 (Major-tier CHoCH only) | 193 | 40.9 | 0.841 | 162.3 | 2.21 | 20 | 82.2 | 132 / 0.907 / 120 | 61 / 0.699 / 43 | 1.02 | 4 better / 11 worse / 0 same |

#### data/egx without the six stocks (95 symbols)

| Variant | Trades | Win % | Avg R | Total R | PF (R) | CHoCH exits | Avg bars held | Pre-2023 n / avg R / total R | 2023+ n / avg R / total R | R per 100 bars in trade | Symbols better than its base (n>=3 either) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (tv-base) | 3488 | 42.1 | 0.111 | 386.0 | 1.19 | 371 | 16.2 | 2354 / 0.051 / 120 | 1134 / 0.234 / 266 | 0.68 |  |
| V1 base, no CHoCH exit | 3331 | 42.8 | 0.164 | 544.8 | 1.27 | 0 | 20.6 | 2265 / 0.103 / 233 | 1066 / 0.292 / 312 | 0.79 | 40 better / 46 worse / 7 same |
| V2 base, Major-tier CHoCH only | 3387 | 42.9 | 0.137 | 463.3 | 1.22 | 49 | 19.0 | 2296 / 0.062 / 142 | 1091 / 0.294 / 321 | 0.72 | 40 better / 46 worse / 7 same |
| V3 base, CHoCH only if close beyond entry | 3414 | 41.1 | 0.151 | 516.4 | 1.25 | 275 | 18.2 | 2303 / 0.100 / 230 | 1111 / 0.258 / 287 | 0.83 | 29 better / 26 worse / 38 same |
| rec (Stop on Close + r4) | 2339 | 42.8 | 0.489 | 1144.1 | 1.79 | 1241 | 37.1 | 1591 / 0.441 / 701 | 748 / 0.592 / 443 | 1.32 |  |
| V4 rec + V1 (no CHoCH exit) | 1470 | 38.9 | 0.778 | 1143.3 | 2.08 | 0 | 89.8 | 1117 / 0.800 / 894 | 353 / 0.706 / 249 | 0.87 | 39 better / 51 worse / 0 same |
| V5 rec + V3 (CHoCH only if close beyond entry) | 1618 | 37.4 | 0.679 | 1098.7 | 2.02 | 347 | 76.0 | 1195 / 0.726 / 868 | 423 / 0.546 / 231 | 0.89 | 31 better / 56 worse / 3 same |
| extra: rec + V2 (Major-tier CHoCH only) | 1492 | 38.9 | 0.768 | 1145.3 | 2.07 | 170 | 87.1 | 1128 / 0.806 / 909 | 364 / 0.650 / 237 | 0.88 | 37 better / 53 worse / 0 same |

## 5. Scorecard against "helps across the 100 and in both periods"

All 100 symbols of `data/egx`, change versus the same family's baseline.

| Variant | Avg R | Pre-2023 avg R | 2023+ avg R | Total R | 2023+ total R | Symbols better / worse / same | 18 held-back names avg R | 13 other dividend-adjusted names avg R | Counts? |
|---|---|---|---|---|---|---|---|---|---|
| V1 base, no CHoCH exit | 0.099 -> 0.152 | 0.042 -> 0.096 | 0.216 -> 0.272 | 366 -> 537 | 260 -> 307 | 44 / 47 / 7 | 0.178 -> 0.198 | 0.082 -> 0.124 | Aggregate yes, breadth no |
| V2 base, Major CHoCH only | 0.099 -> 0.126 | 0.042 -> 0.055 | 0.216 -> 0.275 | 366 -> 452 | 260 -> 318 | 43 / 48 / 7 | 0.178 -> 0.198 | 0.082 -> 0.104 | Aggregate yes, breadth no |
| V3 base, close beyond entry | 0.099 -> 0.141 | 0.042 -> 0.095 | 0.216 -> 0.238 | 366 -> 511 | 260 -> 280 | 33 / 27 / 38 | 0.178 -> 0.168 | 0.082 -> 0.126 | Best of the three, fails on held-back names |
| V4 rec, no CHoCH exit | 0.480 -> 0.765 | 0.438 -> 0.776 | 0.568 -> 0.731 | 1189 -> 1201 | 451 -> 275 | 42 / 53 / 0 | 0.575 -> 0.836 | 0.491 -> 0.895 | No (total R flat, 2023+ total down 39%, breadth negative, 2.4x time in market) |
| V5 rec, close beyond entry | 0.480 -> 0.671 | 0.438 -> 0.711 | 0.568 -> 0.559 | 1189 -> 1157 | 451 -> 251 | 34 / 58 / 3 | 0.575 -> 0.594 | 0.491 -> 0.813 | No (2023+ avg R down, total R down) |

## 6. Conclusion in plain language

**What happens.** In base, about half the trades are initial stops at -1R, usually within a week of entry, and about one in ten trades is a CHoCH exit that happens before any target. In rec, the stops are a bit worse than -1R (stop on close books the close), and CHoCH exits are the majority of trades but mostly profitable ones after a target. On a TradingView chart you therefore see many red boxes, and because EGX is volatile and drifts up in nominal terms, price very often rebounds above them within a few weeks.

**Is the rebound the exit's fault?** No. Compared with the chance that a random bar of the same stock reaches the same price within the same window, the recovery after a pre-target exit is average on the six (37% vs 35% at 40 bars) and below average on the 100 (34% vs 36% for base, 27% vs 30% for rec). The one stock with a visible excess, ORWE under base (14 of 29 vs 10.0 expected), is within noise and disappears under rec. The perception comes from the drift, not from a defect in the exit.

**Would changing the exit help?** A little in the base config, nothing reliable in the recommended one. In base, no CHoCH exit or a close-beyond-entry condition add 0.04-0.05R per trade and 146-172R over the 100 stocks, in both periods, but only about half the stocks improve and the held-back names do not (V3). In rec, the no-exit variants raise the per-trade average a lot, but only by shrinking the trade count by a third and tripling how long each trade ties up the slot; total R stays the same, falls in 2023+, and more stocks get worse than better. The six themselves stay poor in base under every variant (V3: -5.8R over 185 trades) and are good in rec only because rec is good.

**Recommendation.** Do not remove the CHoCH exit from rec. If one change is made, V3 (invalidate only when the close is also beyond entry) is the least bad candidate for the base config (best breadth, both periods positive, only about 12% longer holding), but it should be treated as a candidate that needs fresh out-of-sample data, not a fix for the user's six: it fails on the 18 held-back names (-0.010R) and moves the six by about +10R in total. The real lever on these six stocks remains the stop rate (49% of trades), which previous work (Stop on Close, wider swing-based stops, the runner trail) already addresses better than any exit tweak here.

## 7. Reproduce

```
export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"
node --experimental-websocket tools/backtest/fetch-egx.mjs data/egx-div BTFH,EMFD,EFID,EEII --adjust dividends
node tools/backtest/six-stock.mjs                                    # six stocks, data/egx-div: tables + trade CSVs in data/six-stock-out
node tools/backtest/six-stock.mjs --data data/egx --symbols all --lists no --tag pooled-100
node tools/backtest/variants.mjs                                     # V1-V6 on the six, the 13 others, and the 100
node tools/backtest/validate.mjs --data data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3
```

## Opus 5.5 review (2026-11-20)

The reviewer reproduced, digit for digit, the recovery figures, the control and the baseline/V1/V4/rec numbers. The defaults still validate exactly against TradingView.

Tighter controls make the gap wider, not narrower. Matching on volatility, matching on period within 250 bars, or both, put the expected recovery rate at 36.6–37.7% for base and 28.3–29.4% for rec. Actual recovery stays at or below every one of them.

Three corrections to the wording:
- **V4 does not lower total R.** It is flat, 1189 → 1201.5R. What V4 hurts is breadth (42 better / 53 worse), 2023+ total R (451 → 275) and R per bar held.
- **The control is a base rate, not pure drift.** It reflects drift plus volatility.
- **The base config's pre-target Invalidated exits do give something up:** −0.28R net vs +0.07R gross if held 40 bars. That is why V1/V3 help the base config. They do not help rec.
