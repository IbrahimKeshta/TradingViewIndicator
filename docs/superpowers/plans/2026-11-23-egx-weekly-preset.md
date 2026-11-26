# EGX Weekly preset: backtest protocol and results

Date: 2026-11-23. Status: **protocol fixed before any comparison was run.** The results section is appended afterwards.

## Why

The user ran the EGX Daily preset on weekly charts (MASR, EGX70EWI). Its runner stop never moved after TP3: with Trail
From Entry and Trailing Tier Major, the stop follows only the newest unbroken major swing low (20 bars each side, about
40 weeks), and in a strong weekly trend no new one forms above the initial stop. EGX Daily was measured on daily bars
only. The task is to find the settings that work better on weekly bars and ship them as `Preset: EGX Weekly`.

## Honesty note

Weekly bars are built from the same EGX price history that the daily research already used, so this test is not
independent of it. It does protect the *weekly* choice from being fitted to its own test period, because the choice is
made on the discovery period only.

## Data

- TradingView weekly bars, dividend-adjusted, for the 101 EGX30/EGX70 stocks (`data/wk-div`, fetched 2026-11-23),
  about 900 bars per stock, 2001 onward. The indices are not traded.
- Engine: `tools/backtest/ict-engine.mjs`. On weekly bars it matched the user's EGX70EWI panel exactly under
  EGX Daily: PB 2 trades, 1 win, −0.32R; TR 5 trades, 2 wins, +2.91R.
- Engine fix made before the grid: the Pine preset counts the killzone point as earned. The engine relied on daily bar
  times falling in the London killzone, which weekly bar times do not. A preset key `kzAlwaysEarned` now mirrors Pine.
  It must leave every daily result unchanged; that is checked.

## Fixed, not tuned

These are part of what "EGX" means here and stay as in EGX Daily: Long Trades Only, Apply Costs (0.1% slippage per
side and 2 EGP per order), Min Risk 10 ticks, killzone point earned, Minimum Score 5.

## Split

- **Discovery:** trades opened before 2020-01-01. All choosing happens here.
- **Test:** trades opened on or after 2020-01-01. It is looked at once, for the finalist and the references only.
- Closed trades only for the metrics. Trades still open are reported (marked to the last close) but not counted, since
  a weekly runner can stay open for years.

## Candidates

- **Stage 1, exits (16):** Trailing Tier {Major, Internal} × Trail From Entry {on, off} × Stop on Close Only {on, off} ×
  Runner {on, off}. EGX Daily is one of them (Major, on, on, on).
- **Stage 2, structure (4):** for the stage 1 winner, Major Swing Lookback {10, 20} × Internal Swing Lookback {3, 5}.
- **References:** EGX Daily as is, and the script defaults (`tv-base`: Long Only, costs, Min Risk 10 ticks, nothing
  else changed).

## Choosing and passing

- **Primary metric:** average R per closed PB trade, net of costs.
- **Discovery winner:** the highest discovery average R among candidates with at least 150 discovery trades (so a
  setting cannot win by trading rarely). Ties within 0.02R go to the setting closer to EGX Daily (fewer changes).
- **Pass rule on the test period:** the winner's test average R must be above zero AND at least EGX Daily's test
  average R, on at least 100 test trades.
  - If it passes, it becomes `Preset: EGX Weekly`.
  - If it fails, no weekly-specific settings are shipped. The README then says that EGX Daily (or the defaults, if
    better on both periods) is the best tested choice on weekly.
- **Reported alongside, not used to choose:** total R, profit factor, win rate, share of stocks profitable, open trades
  marked to market, and the TR model under the same settings.

## Results (run 2026-11-23, after the protocol above was committed)

`node tools/backtest/weekly-tests.mjs --stage 1`, then `--stage 2`, then `--final`. PB model, closed trades, R net of costs.

**Stage 1, exits, discovery.** The EGX Daily exits ranked first: +0.731R over 329 trades, PF 2.15. The same with
Trailing Tier Internal came second at +0.721R, inside the 0.02R tie band, so the tie went to EGX Daily (fewer changes).
Runner on and Stop on Close on were the two settings that mattered: the best combination without the runner made
+0.405R, and the best with intrabar stops made +0.600R. The script's exits (all four off) were last, at +0.257R.

**Stage 2, swing lookbacks, discovery.**

| Major / Internal lookback | Trades | Avg R | PF |
|---|---|---|---|
| **10 / 5** | 331 | **+0.782** | 2.25 |
| 20 / 5 (EGX Daily) | 329 | +0.731 | 2.15 |
| 10 / 3 | 385 | +0.666 | 2.16 |
| 20 / 3 | 389 | +0.662 | 2.12 |

The discovery winner was EGX Daily with Major Swing Lookback 10.

**Final, test period (trades opened 2020-01-01 on), looked at once.**

| Settings | Discovery avg R (n) | Test avg R (n) | Test PF | TR model, test avg R (n) |
|---|---|---|---|---|
| Finalist: EGX Daily + Major Swing Lookback 10 | +0.782 (331) | +0.878 (246) | 2.41 | +0.977 (282) |
| **EGX Daily as is** | +0.731 (329) | **+0.949 (249)** | 2.57 | +0.969 (295) |
| Script defaults (Long Only, costs, Min Risk 10 ticks) | +0.260 (508) | +0.559 (578) | 2.28 | +0.361 (298) |

**Verdict: the finalist FAILS** (test +0.878R is below EGX Daily's +0.949R). By the protocol, no weekly-specific
settings are shipped and there is no `Preset: EGX Weekly`. On weekly bars the best tested choice is EGX Daily as is.
The script defaults lost on average R in both periods.

**What this means for the frozen stop.** The stop that never moves on a weekly runner is part of why EGX Daily wins
there: weekly EGX trends ran for years, and every tighter or more frequent trail tested scored lower.
What ends those runners is the internal CHoCH, not the stop. Two cautions:

- 58 PB trades are still open under EGX Daily on weekly, marked at about +1,437R on price alone. None of that is in
  the averages above. A weekly runner can give a large part of it back before a weekly CHoCH closes it.
- Every setting did better in 2020–2026 than before 2020. Much of EGX's nominal rise in those years came with the
  pound's devaluations, a regime that rewards loose stops and may not last.
