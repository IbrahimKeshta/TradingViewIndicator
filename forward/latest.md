# EGX Daily scan: session 2026-11-19

Preset `egx-daily` (Stop on Close Only, Runner, Trailing Tier Major, Trail From Entry, Long Trades Only, costs on, Min Risk 10 ticks, Score: Killzone on) over 100 stocks, dividend-adjusted daily bars.
Models: **PB** = pullback model (the tested preset). **TR** = trailing-stop model (Enable Trailing Stop Model on the chart); it has its own slot and never changes the PB trades. Run with `--no-trail` for PB only.
No data: AIHC.

Entries happen at the close of the signal bar, so a "new entry" below is a trade the indicator opened at this session's close. R is net of costs.
With Stop on Close Only, "Stop now" is hit only by a daily CLOSE at or below it, not by an intraday wick. A PB trade also exits at the close on an internal CHoCH against it ("Invalidated").

## New entries this session (0)

None.

## Closed this session (0)

None.

## Open trades (13)

| Stock | Model | Opened | Bars | Entry | Stop now | Next target | Targets hit | Last close | Open R |
|---|---|---|---|---|---|---|---|---|---|
| SCEM | PB | 2026-11-18 | 1 | 98.000 | 90.986 | 105.960 | 0 | 97.520 | -0.07 |
| ARAB | PB | 2026-11-17 | 2 | 0.255 | 0.237 | 0.285 | 0 | 0.254 | -0.06 |
| HDBK | PB | 2026-11-16 | 3 | 108.610 | 103.806 | 121.400 | 0 | 108.500 | -0.02 |
| EFIH | PB | 2026-11-15 | 4 | 24.710 | 23.388 | 27.354 | 1 | 25.530 | +0.62 |
| AIFI | PB | 2026-11-12 | 5 | 2.420 | 2.245 | 2.900 | 0 | 2.540 | +0.69 |
| LCSW | PB | 2026-11-01 | 14 | 35.670 | 33.010 | 43.650 | 2 | 39.790 | +1.55 |
| AMOC | PB | 2026-08-25 | 60 | 10.900 | 10.197 | runner | 3 | 13.140 | +3.19 |
| GOUR | PB | 2026-07-14 | 89 | 13.786 | 13.075 | runner | 3 | 14.560 | +1.09 |
| SDTI | PB | 2025-11-09 | 251 | 22.220 | 20.963 | runner | 3 | 83.000 | +48.34 |
| HDBK | TR | 2026-11-12 | 5 | 108.990 | 101.752 | 121.400 | 0 | 108.500 | -0.05 |
| EMFD | TR | 2026-11-10 | 7 | 12.600 | 11.984 | 13.700 | 0 | 12.800 | +0.26 |
| SWDY | TR | 2026-11-05 | 10 | 116.110 | 113.238 | 124.380 | 0 | 117.500 | +0.18 |
| LCSW | TR | 2026-10-28 | 16 | 35.730 | 38.109 | 43.857 | 1 | 39.790 | +1.00 |

## Forward record since 2026-11-21

The out-of-sample test. Trades opened on or after 2026-11-21, as logged on the day they were seen. Each model is judged on its own.

- **PB**: closed 0, wins (R > 0) 0, total +0.00R, average - per trade; still open 0. In-sample reference: +0.51R per trade, 43.6% wins (2,299 trades).
- **TR**: closed 0, wins (R > 0) 0, total +0.00R, average - per trade; still open 0. In-sample reference: +0.35R per trade, 46.2% wins (1,926 trades).
- In-sample references are full history on these 100 stocks, dividend-adjusted. Expect a few dozen closed trades per model before a forward average means much.

