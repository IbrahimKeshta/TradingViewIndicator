# HTF Bias and Displacement Filter Validation

**Date:** 2026-09-17
**Question:** Do the two new pullback-model filters — `Require HTF Bias` and `Require Displacement` —
improve trade quality?
**Answer: no, not at their default settings.** Each one raised Avg R on only 4 of the 10 charts,
short of the 6 the rule below needed. Pooled across all ten, every filtered setting did worse than
the baseline.

## Method

Both filters were added off by default (`49d3b24`). With both off, ELEC 1D read exactly what `master`
did (n=128, 40%, +0.15R, +19.47R, A +0.48R (10), B +0.10R (43), C +0.14R (75)), so the filters do
not disturb the existing engine. The pass also hit Pine's 64-plot cap, fixed in `9e94403`.

Every setting below was fixed **before** reading any result, and not tuned afterwards:

- Script defaults for everything except the two filter toggles and the bias timeframe.
- `Bias Timeframe` 1W on the EGX 1D charts, 1D on the crypto 4H and 1H charts. HTF swing lookback 5.
  Displacement 1.0 × ATR, min FVG 0.3 × ATR.
- Four settings per chart: **base** (both off), **htf**, **disp**, **both**.
- **Pass rule:** a filter works if Avg R improves on at least 6 of the 10 charts. Total R alone
  doesn't count, because removing trades can raise it just by removing losers. A reading under ~15
  trades would be marked too small to judge (none were; the smallest was n=25).

Charts: `EGX_DLY:` ELEC, ABUK, MASR, BTFH on 1D; `BINANCE:` ETHUSDT, SOLUSDT, XRPUSDT on 4H and 1H.
TradingView Basic plan, history as loaded on 2026-09-17.

## Results

Avg R per chart. Arrows compare against that chart's own baseline.

| Chart | base | htf | disp | both |
|---|---|---|---|---|
| ELEC 1D | +0.15 (128) | +0.03 ↓ (97) | −0.06 ↓ (70) | −0.02 ↓ (45) |
| ABUK 1D | +0.03 (150) | +0.17 ↑ (127) | +0.03 = (88) | +0.04 ↑ (79) |
| MASR 1D | +0.06 (125) | −0.04 ↓ (101) | −0.03 ↓ (65) | −0.15 ↓ (50) |
| BTFH 1D | −0.01 (72) | +0.17 ↑ (55) | +0.08 ↑ (40) | +0.25 ↑ (29) |
| ETH 4H | +0.14 (94) | +0.14 = (76) | +0.16 ↑ (74) | +0.24 ↑ (57) |
| ETH 1H | −0.14 (92) | −0.13 ↑ (58) | −0.09 ↑ (77) | −0.18 ↓ (44) |
| SOL 1H | +0.15 (75) | +0.28 ↑ (32) | +0.13 ↓ (64) | +0.30 ↑ (26) |
| XRP 1H | +0.18 (71) | −0.05 ↓ (39) | +0.35 ↑ (52) | +0.17 ↓ (25) |
| XRP 4H | +0.24 (83) | +0.02 ↓ (57) | +0.17 ↓ (68) | +0.03 ↓ (48) |
| SOL 4H | +0.01 (82) | −0.02 ↓ (53) | −0.10 ↓ (72) | −0.10 ↓ (46) |
| **Improved on** | — | **4 / 10** | **4 / 10** | **4 / 10** |
| **Pooled Avg R** | **+0.077** (972) | +0.059 (695) | +0.053 (670) | +0.036 (449) |

Pooled Avg R = sum of Total R ÷ sum of n. ETH 1H htf's "improvement" is 0.01R, well within noise,
so HTF's honest count is closer to 3 of 10.

Full readings (win/loss counts, Total R, per-grade split):

| Chart | cfg | n | W | L | Win % | Avg R | Total R | A | B | C |
|---|---|---|---|---|---|---|---|---|---|---|
| ELEC 1D | base | 128 | 51 | 77 | 40 | +0.15 | +19.47 | +0.48 (10) | +0.10 (43) | +0.14 (75) |
| ELEC 1D | htf | 97 | 36 | 61 | 37 | +0.03 | +3.16 | +0.46 (14) | −0.11 (31) | +0.00 (52) |
| ELEC 1D | disp | 70 | 24 | 46 | 34 | −0.06 | −3.86 | +0.36 (14) | −0.42 (23) | +0.02 (33) |
| ELEC 1D | both | 45 | 16 | 29 | 36 | −0.02 | −0.84 | +0.26 (14) | −0.37 (13) | +0.02 (18) |
| ABUK 1D | base | 150 | 57 | 93 | 38 | +0.03 | +3.76 | −0.33 (13) | +0.22 (52) | −0.04 (85) |
| ABUK 1D | htf | 127 | 52 | 75 | 41 | +0.17 | +21.91 | −0.33 (13) | +0.28 (48) | +0.19 (66) |
| ABUK 1D | disp | 88 | 30 | 58 | 34 | +0.03 | +2.73 | +0.10 (11) | +0.50 (42) | −0.55 (35) |
| ABUK 1D | both | 79 | 28 | 51 | 35 | +0.04 | +2.79 | +0.10 (11) | +0.26 (42) | −0.35 (26) |
| MASR 1D | base | 125 | 49 | 76 | 39 | +0.06 | +7.03 | −0.06 (8) | −0.13 (44) | +0.18 (73) |
| MASR 1D | htf | 101 | 36 | 65 | 36 | −0.04 | −3.57 | −0.28 (7) | −0.29 (42) | +0.21 (52) |
| MASR 1D | disp | 65 | 24 | 41 | 37 | −0.03 | −2.03 | −0.27 (8) | +0.02 (26) | −0.01 (31) |
| MASR 1D | both | 50 | 15 | 35 | 30 | −0.15 | −7.62 | −0.52 (7) | −0.16 (23) | −0.02 (20) |
| BTFH 1D | base | 72 | 25 | 46 | 35 | −0.01 | −0.90 | −0.02 (6) | +0.06 (30) | −0.07 (36) |
| BTFH 1D | htf | 55 | 22 | 32 | 40 | +0.17 | +9.28 | +0.17 (5) | +0.16 (24) | +0.17 (26) |
| BTFH 1D | disp | 40 | 16 | 24 | 40 | +0.08 | +3.36 | +0.43 (4) | +0.16 (18) | −0.07 (18) |
| BTFH 1D | both | 29 | 13 | 16 | 45 | +0.25 | +7.29 | +0.43 (4) | +0.42 (12) | +0.04 (13) |
| ETH 4H | base | 94 | 44 | 50 | 47 | +0.14 | +13.28 | −0.02 (13) | −0.14 (29) | +0.34 (52) |
| ETH 4H | htf | 76 | 36 | 40 | 47 | +0.14 | +10.87 | −0.07 (11) | +0.23 (24) | +0.15 (41) |
| ETH 4H | disp | 74 | 32 | 42 | 43 | +0.16 | +11.84 | +0.00 (10) | −0.11 (22) | +0.34 (42) |
| ETH 4H | both | 57 | 27 | 30 | 47 | +0.24 | +13.75 | +0.10 (8) | +0.47 (19) | +0.13 (30) |
| ETH 1H | base | 92 | 34 | 58 | 37 | −0.14 | −13.11 | −0.18 (7) | +0.01 (24) | −0.20 (61) |
| ETH 1H | htf | 58 | 23 | 35 | 40 | −0.13 | −7.37 | −0.73 (5) | +0.15 (13) | −0.14 (40) |
| ETH 1H | disp | 77 | 30 | 47 | 39 | −0.09 | −6.81 | +0.10 (4) | −0.06 (18) | −0.11 (55) |
| ETH 1H | both | 44 | 17 | 27 | 39 | −0.18 | −7.76 | −1.00 (2) | −0.05 (8) | −0.16 (34) |
| SOL 1H | base | 75 | 39 | 36 | 52 | +0.15 | +11.48 | +0.37 (2) | +0.16 (18) | +0.14 (55) |
| SOL 1H | htf | 32 | 20 | 12 | 63 | +0.28 | +8.92 | +0.37 (2) | +0.37 (7) | +0.24 (23) |
| SOL 1H | disp | 64 | 31 | 33 | 48 | +0.13 | +8.03 | +0.37 (2) | +0.00 (14) | +0.15 (48) |
| SOL 1H | both | 26 | 16 | 10 | 62 | +0.30 | +7.69 | +0.37 (2) | +0.37 (7) | +0.26 (17) |
| XRP 1H | base | 71 | 33 | 38 | 46 | +0.18 | +12.58 | +0.33 (1) | +0.19 (17) | +0.17 (53) |
| XRP 1H | htf | 39 | 17 | 22 | 44 | −0.05 | −2.13 | +0.33 (1) | +0.09 (9) | −0.11 (29) |
| XRP 1H | disp | 52 | 27 | 25 | 52 | +0.35 | +18.19 | — (0) | +0.51 (14) | +0.29 (38) |
| XRP 1H | both | 25 | 13 | 12 | 52 | +0.17 | +4.16 | — (0) | −0.01 (6) | +0.22 (19) |
| XRP 4H | base | 83 | 35 | 48 | 42 | +0.24 | +20.02 | +0.48 (9) | −0.11 (29) | +0.42 (45) |
| XRP 4H | htf | 57 | 22 | 35 | 39 | +0.02 | +1.23 | −0.41 (6) | −0.04 (17) | +0.13 (34) |
| XRP 4H | disp | 68 | 28 | 40 | 41 | +0.17 | +11.66 | +0.88 (11) | −0.14 (24) | +0.17 (33) |
| XRP 4H | both | 48 | 19 | 29 | 40 | +0.03 | +1.32 | +0.38 (8) | −0.24 (15) | +0.08 (25) |
| SOL 4H | base | 82 | 34 | 48 | 41 | +0.01 | +0.90 | +0.54 (10) | −0.11 (31) | −0.03 (41) |
| SOL 4H | htf | 53 | 21 | 32 | 40 | −0.02 | −1.29 | +0.43 (7) | +0.18 (20) | −0.30 (26) |
| SOL 4H | disp | 72 | 29 | 43 | 40 | −0.10 | −7.32 | +0.07 (10) | −0.02 (27) | −0.21 (35) |
| SOL 4H | both | 46 | 19 | 27 | 41 | −0.10 | −4.66 | −0.34 (8) | +0.50 (15) | −0.41 (23) |

The W column comes from the panel's `W / L` text. A few were partly hidden behind TradingView's
price flag (BTFH), and those were taken from the win rate × n. A trade closing at exactly 0.0R is
neither a win nor a loss.

## Findings

1. **Neither filter meets the bar, alone or combined.** Each improved 4 of 10 charts and made 5–6
   worse. The pooled figure falls with every filter added: +0.077R → +0.059R (HTF) → +0.053R
   (displacement) → +0.036R (both).
2. **Improvements appear only where the baseline was weak.** HTF helped ABUK, BTFH and SOL 1H.
   Both filters together helped BTFH, ETH 4H and SOL 1H. The same filters did clear damage to the
   strongest baselines (ELEC 1D +0.15 → +0.03, XRP 4H +0.24 → +0.02). This is the same
   per-symbol inconsistency both earlier backtest passes found for the confirmation score.
3. **Win rate barely moves.** Across the 30 filtered readings it stays inside a few points of
   baseline, except on SOL 1H (52% → 63%), where n drops to 32 and 26. The filters change *which*
   trades are taken, not how often they win.
4. **Displacement costs trades without a quality gain.** It removed 30–45% of trades on EGX and
   11–31% on crypto, and the removed trades were no worse than the kept ones on average.

## Caveats

- One default setting per filter, tested on the same history that produced the baseline. A
  different bias timeframe, swing lookback or displacement multiple might test differently. Tuning
  them against these same charts until one passes would be curve-fitting, not validation.
- The engine holds one trade at a time, so a filter that blocks a trade can free the slot for a
  different one. Filtered n is therefore not a strict subset of the baseline trades (for example,
  ELEC's A-grade count rose from 10 to 14 under HTF).
- Sample sizes of 25–150 per reading leave individual chart differences of ±0.1R within noise; the
  count across 10 charts and the pooled figure are the meaningful signals.

## Recommendation

Leave both filters **off**. Either keep them as documented, opt-in experiments or remove them
before the next publish. They are not an accuracy improvement at these defaults, and their inputs
add surface to a published indicator.
