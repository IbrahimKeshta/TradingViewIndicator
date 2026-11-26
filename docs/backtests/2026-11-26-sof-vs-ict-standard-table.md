# Session Order Flow vs ICT (EGX Daily) — standard backtest table (2026-11-26)

> **Test**: both indicators on the same bars: 101 EGX30/EGX70 stocks, TradingView daily, dividend-adjusted, 2001-05-15 to 2026-11-25. ICT = offline port `tools/backtest/ict-engine.mjs`, Preset EGX Daily, pullback + trailing-stop models (what the scanner trades). Session Order Flow = offline port `sof-engine.mjs` (matched TradingView 340/340 trades with Lower Timeframe = chart, which is how it runs here) and the liquidity-run simulator from the 2026-11-21 model search (pool run with close beyond, EMA 200 trend, 8 ATR stop and trail from the best close, no target). Hold-out = entries from 2025-11-16.

> Each trade in % of entry (full position), minus 0.15% commission per side, summed, not compounded. Losing Streak and Max Drawdown: all stocks in entry order. 🟢 better / 🔴 worse than ICT.

> **Data clean-up**: the feed leaves some share restructurings unadjusted (e.g. ASPI x75 on 2021-10-11, CNFN x46 on 2018-10-14; 67 one-day moves beyond x1.45 / x0.6 in 44 stocks). TradingView shows the same bars, but any trade held across one is not real, so those trades are removed from every model below (listed at the end).

## 🏆 ICT `current` → Session Order Flow

| Model (ICT current → model) | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `sof_run` (Session Order Flow, Liquidity run (trend), the current default: longs and shorts) | 4,258 → **2,544** | 44.5% → **42.2%** 🔴 | 1.78 → **2.43** 🟢 | +2.97% → **+14.02%** 🟢 | +28,972% → **+60,682%** 🟢 | -16,317% → **-25,009%** 🔴 | +12,655% → **+35,673%** 🟢 (+23,018) | 33 → **26** 🟢 | -616% → **-1,371%** 🔴 |
| `sof_run_long` (Liquidity run, long trades only (what EGX allows)) | 4,258 → **1,507** | 44.5% → **49.2%** 🟢 | 1.78 → **5.06** 🟢 | +2.97% → **+29.48%** 🟢 | +28,972% → **+55,378%** 🟢 | -16,317% → **-10,951%** 🟢 | +12,655% → **+44,427%** 🟢 (+31,772) | 33 → **18** 🟢 | -616% → **-829%** 🔴 |
| `sof_sweep` (Sweep reversal (the original model): longs and shorts) | 4,258 → **11,142** | 44.5% → **44.8%** 🟢 | 1.78 → **0.50** 🔴 | +2.97% → **-0.91%** 🔴 | +28,972% → **+10,248%** 🔴 | -16,317% → **-20,351%** 🔴 | +12,655% → **-10,103%** 🔴 (-22,759) | 33 → **28** 🟢 | -616% → **-10,122%** 🔴 |
| `sof_sweep_long` (Sweep reversal, long trades only) | 4,258 → **9,864** | 44.5% → **44.7%** 🟢 | 1.78 → **0.49** 🔴 | +2.97% → **-0.91%** 🔴 | +28,972% → **+8,730%** 🔴 | -16,317% → **-17,712%** 🔴 | +12,655% → **-8,983%** 🔴 (-21,638) | 33 → **39** 🔴 | -616% → **-9,013%** 🔴 |

## ICT current (EGX Daily)

| Market | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| EGX30 | 1,584 | 44.1% | 1.82 | +2.64% | +9,271% | -5,091% | +4,180% | 20 | -245% |
| EGX70 | 2,674 | 44.8% | 1.76 | +3.17% | +19,701% | -11,225% | +8,475% | 37 | -563% |
| **🌐 ALL** | **4,258** | **44.5%** | **1.78** | **+2.97%** | **+28,972%** | **-16,317%** | **+12,655%** | **33** | **-616%** |

## sof_run

| Market | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| EGX30 | 776 | 44.7% | 2.95 | +15.85% | +18,600% | -6,303% | +12,297% | 14 | -598% |
| EGX70 | 1,768 | 41.1% | 2.25 | +13.22% | +42,082% | -18,707% | +23,376% | 20 | -1,231% |
| **🌐 ALL** | **2,544** | **42.2%** | **2.43** | **+14.02%** | **+60,682%** | **-25,009%** | **+35,673%** | **26** | **-1,371%** |

## sof_run_long

| Market | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| EGX30 | 483 | 49.7% | 5.40 | +27.88% | +16,532% | -3,063% | +13,468% | 12 | -269% |
| EGX70 | 1,024 | 48.9% | 4.93 | +30.23% | +38,847% | -7,887% | +30,959% | 17 | -667% |
| **🌐 ALL** | **1,507** | **49.2%** | **5.06** | **+29.48%** | **+55,378%** | **-10,951%** | **+44,427%** | **18** | **-829%** |

## sof_sweep

| Market | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| EGX30 | 3,493 | 46.0% | 0.51 | -0.76% | +2,755% | -5,413% | -2,658% | 20 | -2,668% |
| EGX70 | 7,649 | 44.3% | 0.50 | -0.97% | +7,493% | -14,939% | -7,445% | 21 | -7,503% |
| **🌐 ALL** | **11,142** | **44.8%** | **0.50** | **-0.91%** | **+10,248%** | **-20,351%** | **-10,103%** | **28** | **-10,122%** |

## sof_sweep_long

| Market | 🔢 Total Trades | 🎯 Win Rate | 📈 Profit Factor | 💡 Avg Return | 🟢 Total Win | 🔴 Total Loss | 💰 Net Profit | 🔗 Losing Streak | 📉 Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| EGX30 | 3,156 | 45.6% | 0.50 | -0.75% | +2,398% | -4,778% | -2,381% | 23 | -2,387% |
| EGX70 | 6,708 | 44.3% | 0.49 | -0.98% | +6,332% | -12,934% | -6,602% | 21 | -6,706% |
| **🌐 ALL** | **9,864** | **44.7%** | **0.49** | **-0.91%** | **+8,730%** | **-17,712%** | **-8,983%** | **39** | **-9,013%** |

## Summary, with the risk view

| Model | Trades | shorts | WR % | PF | Net % | Avg % | avg stop (% of entry) | avg bars held | avg gross R | Since 2016 n | Since 2016 net % | Since 2016 PF | Hold-out n | Hold-out net % | Hold-out PF | Boot better than ICT % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ICT current | 4,258 | 0 | 44.5 | 1.78 | +12,655 | 2.97 | 7.3 | 29 | 0.475 | 2983 | +8,940 | 1.82 | 437 | +1,657 | 2.37 |  |
| sof_run | 2,544 | 1099 | 42.2 | 2.43 | +35,673 | 14.02 | 33.8 | 105 | 0.553 | 1461 | +19,235 | 2.33 | 101 | +383 | 1.44 | 100 |
| sof_run_long | 1,507 | 0 | 49.2 | 5.06 | +44,427 | 29.48 | 29.6 | 118 | 1.085 | 894 | +25,661 | 5.01 | 72 | +848 | 3.08 | 100 |
| sof_sweep | 11,142 | 1446 | 44.8 | 0.50 | -10,103 | -0.91 | 3.0 | 3 | -0.213 | 6061 | -5,422 | 0.50 | 376 | -58 | 0.88 | 0 |
| sof_sweep_long | 9,864 | 0 | 44.7 | 0.49 | -8,983 | -0.91 | 2.9 | 3 | -0.218 | 5402 | -4,892 | 0.48 | 311 | -44 | 0.88 | 0 |

## By entry year (net %)

| Year | ICT n | ICT net | sof_run n | sof_run net | sof_run_long n | sof_run_long net | sof_sweep n | sof_sweep net | sof_sweep_long n | sof_sweep_long net |
|---|---|---|---|---|---|---|---|---|---|---|
| 2001 | 12 | +11 | 29 | -84 | 19 | +10 | 123 | -97 | 94 | -68 |
| 2002 | 15 | -23 | 57 | +249 | 34 | +420 | 164 | -75 | 123 | -50 |
| 2003 | 25 | +15 | 53 | +1,164 | 36 | +1,527 | 190 | -83 | 148 | -45 |
| 2004 | 26 | +228 | 49 | +2,539 | 37 | +2,945 | 193 | -128 | 158 | -78 |
| 2005 | 65 | +744 | 56 | +3,345 | 46 | +3,604 | 164 | -85 | 138 | -53 |
| 2006 | 86 | +836 | 71 | +4,241 | 39 | +5,423 | 232 | -100 | 203 | -95 |
| 2007 | 116 | +757 | 68 | +2,056 | 56 | +2,261 | 370 | -411 | 336 | -349 |
| 2008 | 119 | -134 | 68 | +802 | 20 | -121 | 423 | -655 | 399 | -669 |
| 2009 | 129 | +1,070 | 80 | -267 | 49 | +458 | 400 | -317 | 366 | -268 |
| 2010 | 134 | +80 | 80 | -245 | 52 | -122 | 458 | -400 | 418 | -364 |
| 2011 | 48 | -217 | 93 | +8 | 20 | -312 | 402 | -428 | 369 | -400 |
| 2012 | 119 | +232 | 87 | -21 | 57 | +303 | 428 | -531 | 371 | -419 |
| 2013 | 134 | +496 | 114 | +1,920 | 65 | +2,526 | 420 | -304 | 345 | -255 |
| 2014 | 154 | +8 | 96 | +258 | 55 | -90 | 468 | -333 | 422 | -335 |
| 2015 | 93 | -389 | 82 | +475 | 28 | -64 | 646 | -735 | 572 | -643 |
| 2016 | 152 | +718 | 128 | +3,298 | 84 | +3,784 | 631 | -567 | 554 | -477 |
| 2017 | 212 | +1,520 | 102 | +1,478 | 80 | +1,906 | 599 | -529 | 545 | -409 |
| 2018 | 190 | -205 | 109 | -218 | 43 | -225 | 699 | -818 | 652 | -866 |
| 2019 | 173 | -199 | 131 | +407 | 55 | -12 | 696 | -974 | 632 | -907 |
| 2020 | 211 | +763 | 137 | +3,537 | 80 | +4,023 | 580 | -500 | 532 | -383 |
| 2021 | 274 | +506 | 129 | +164 | 68 | +253 | 630 | -855 | 591 | -790 |
| 2022 | 251 | +653 | 172 | +2,161 | 105 | +3,952 | 514 | -374 | 447 | -368 |
| 2023 | 361 | +1,913 | 144 | +3,934 | 98 | +4,436 | 481 | -130 | 401 | -173 |
| 2024 | 379 | +601 | 167 | +2,429 | 100 | +3,941 | 463 | -477 | 399 | -396 |
| 2025 | 422 | +1,273 | 156 | +1,911 | 121 | +3,038 | 457 | -166 | 391 | -109 |
| 2026 | 358 | +1,398 | 86 | +134 | 60 | +565 | 311 | -31 | 258 | -14 |

Largest sof_run_long trades: UEGC 2006-06-12 +2,055%, OCDI 2005-07-12 +1,474%, HRHO 2004-11-16 +1,195%, GPIM 2020-06-29 +1,083%, EGAL 2016-11-20 +907% (top 5 = 12.1% of its total win).

Largest ICT trades: EGAL 2017-02-12 +241%, OCDI 2005-09-19 +208%, AIH 2013-09-24 +148%, IDRE 2020-04-16 +133%, SDTI 2006-01-17 +127% (top 5 = 3.0% of its total win).

## Trades removed (held across a data jump)

| Model | removed | their net % | largest |
|---|---|---|---|
| ICT current | 6 | +118 | ISMA 2007-08-28 +91% |
| sof_run | 26 | +7,492 | ASPI 2021-08-04 +4,913% |
| sof_run_long | 16 | +8,310 | ASPI 2021-08-04 +4,913% |
| sof_sweep | 0 | +0 | - |
| sof_sweep_long | 0 | +0 | - |
