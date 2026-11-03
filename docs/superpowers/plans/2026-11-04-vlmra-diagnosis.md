# VLMRA 1D — why most trades failed

**Setup:** a test copy of the ICT script with the user's exact settings. It reproduced the user's panel exactly: pullback 17 trades / −0.40R, trail 19 trades / +1.43R. The user's non-default settings are Score: Killzone off, Stop on Close Only on, Require HTF Bias on, Require Confirmation on, Enable Trailing Stop Model on, Log Closed Trades on. Long Trades Only is off. Costs are off. Per-trade log: `.playwright-mcp/data/vlmra-user.csv` (git-ignored).

## What the 36 trades show

| Finding | Numbers |
|---|---|
| **Shorts lose, longs win** | Longs: 23 trades, **+4.52R**. Shorts: 13 trades, **−3.50R** (PB −2.19, TR −1.31). Shorting isn't available on most EGX stocks anyway. |
| **Losers never got going** | 20 of 21 losers never reached +1R in their favour; 9 never reached +0.5R. Entry timing, not exit management, is the problem; the September 2026-09 root-cause pass found the same thing. |
| **Three trades carry everything** | The 3 trades that hit TP3 made +12.09R. The other 33 lost −11.07R. Only 13 of 36 reached TP1. |
| **Profit came from one year** | 2023 +10.92R (both TP3 trades). 2022 −4.91, 2024 +0.05, 2025 −2.62, 2026 −1.48. |
| **Stop on Close Only costs some R per loss but saves trades** | 10 losses closed beyond −1R, giving away an extra 2.71R. Turning it off still made things worse: the trail model went from +4.74 to −3.14R (long only). |
| **The score doesn't help** | Pullback A-grade trades: 5, −2.34R. B-grade: 12, +1.92R. |
| **Require HTF Bias does nothing here** | Bias Timeframe is 1D on a daily chart, so the filter switches itself off. |
| **Invalidated exits** | 7 trades left on zone invalidation: −3.08R, some held 47–64 bars with stops 3.7–4.3 ATR wide. |

## What-ifs on VLMRA (single stock, so a description, not validation)

| Settings (on top of the user's) | Pullback | Trail | Both |
|---|---|---|---|
| User's settings as-is | 17 / −0.40R | 19 / +1.43R | **+1.02R** |
| + Long Trades Only | 12 / +1.79R | 12 / +4.74R | **+6.53R** |
| + Long only, Stop on Close Only off | 13 / +2.22R | 12 / −3.14R | −0.92R |
| + Long only, costs on | 12 / +1.40R | 12 / +4.14R | +5.54R |
| + Long only, costs on, Require Confirmation off | 14 / +1.88R | 12 / +4.14R | +6.02R |
| + the above + runner exits (r4) | 12 / −0.78R | 12 / +3.98R | +3.20R |

The runner exits hurt here, which matches the batch F finding: they help on stocks with long trends and cost on choppy ones. VLMRA since 2024 has been choppy.
