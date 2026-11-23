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
