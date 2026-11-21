# Forward test of the EGX Daily preset

The EGX Daily preset of the ICT script was chosen on all available EGX history, so no unseen EGX data was left to test
it on. This folder is that test: every trade the preset opens **from 2026-11-21 on**, logged on the day it is seen.

Two models are scanned and recorded separately, each tagged in every table and in the log:

- **PB**, the pullback model: the tested preset.
- **TR**, the trailing-stop model, which charts show when `Enable Trailing Stop Model` is on. It has its own trade
  slot and never changes the PB trades. Under the preset's settings it averaged +0.35R per trade in-sample, against
  +0.51R for PB. `--no-trail` scans PB alone.

To make a chart show exactly what the scanner lists, use `Preset: EGX Daily`. The preset counts the killzone point
as earned, so turning `Score: Killzone` off on the chart no longer changes the trades. Turn `Enable Trailing Stop
Model` on to see the TR rows too.

## Files

| File | What |
|---|---|
| `latest.md` | The latest scan: new entries, trades closed, every open trade with its current stop and next target, and the forward record so far. Overwritten on every run. |
| `egx-daily-log.json` | The forward log. Append-only: a trade is written the first time it is seen and never rewritten, and its close is added once. |

## Running it

```
export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"     # node is not on PATH on this machine
node --experimental-websocket tools/backtest/scan-egx.mjs
```

This downloads fresh dividend-adjusted daily bars for every EGX30/EGX70 stock from TradingView's public feed (no login,
a few minutes), runs the engine with the EGX Daily preset, and writes both files. Run it after the EGX close
(14:30 Cairo time) on trading days. `--no-fetch` scans the data already on disk. A bar dated today counts as finished
only from 15:00 Cairo: run earlier, the scan stops at the last finished bar and nothing from the forming bar is logged.

The dashboard (`tools/dashboard`, see its README) does the same end-of-day scan by itself after 15:00. It also shows
what the close would do while the session is open.

The engine is the Node port in `tools/backtest/`, which matches the Pine script trade for trade on dividend-adjusted
data, so `latest.md` shows what the indicator shows on each chart with `Preset: EGX Daily`.

## Reading the forward record

- **Closed trades only** count toward the record. R is net of costs (0.1% slippage per side and 2 EGP per order).
- **Flagged entries.** The engine recomputes from full history on every run, and dividend adjustment rescales older
  prices after each ex-dividend date. That is harmless for R but can, rarely, move a level enough to change a trade.
  If a recomputed trade no longer matches the log (risk differs by more than 1% of entry), it is marked `revised`; if
  it disappears, `vanished`. The original record stays.
- **When it means something.** The in-sample average was +0.48R per trade at 42.5% wins over 2,478 trades. A forward
  average needs a few dozen closed trades before it says much. Across the 100 stocks the preset opened 183–229 trades
  a year in 2023–2025 (about 4 a week), and trades last about 37 bars on average, so a meaningful sample takes a few
  months.
- **Commit the log** now and then, so its history is timestamped and cannot be quietly edited.
- **Fidelity caveat.** The engine matches TradingView exactly on the 20 stocks whose dividend-adjusted data existed when
  the acceptance test was built, and live with the preset on COMI and ETEL (2026-11-21). The full download on
  2026-11-21 let `validate.mjs` check 113 more rows against older TradingView readings for the first time. 100 match
  exactly; 13 rows on 7 stocks (EGAL, ISMQ, ARAB, AMIA, POUL, OBRI, UEGC) differ by one or two trades, usually one extra
  trade of about −1R.
  The cause is not confirmed. The likeliest one is a dividend paid after those readings, which rescales old prices and
  moves which small-stop trades clear the 10-tick floor. Before acting on a signal for one of those stocks, check it on
  its chart.
