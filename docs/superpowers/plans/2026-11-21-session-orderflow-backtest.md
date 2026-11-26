# Session Order Flow — implementation check and backtest (2026-11-21)

The user asked for the Session Order Flow script (`src/session-orderflow.pine`, never tested before) to be
checked on TradingView first, corrected where needed, and then backtested like the ICT indicator, on EGX
and crypto.

## Decisions (the user's, 2026-11-21)

| Question | Answer |
|---|---|
| Timeframes | Crypto 15m + 1H, EGX daily + 1H |
| Directions | Both sides everywhere (long and short reported separately as well) |
| Pass rule | ≥ +0.10R per trade after costs on held-out data, positive on ≥ 60% of held-out symbols, and a Conditions filter only counts as useful if it beats the `No filter` baseline |

## Pass rule, fixed before any backtest result was seen

Judged separately for each of the four market × timeframe sets and each `Conditions Filter` setting, on
**held-out trades**: every trade on a held-out symbol, plus every trade on a tuning symbol entered on or
after the time split.

1. Average net R per held-out trade ≥ **+0.10**.
2. Net R > 0 on ≥ **60%** of held-out symbols (symbols with at least 5 held-out trades).
3. A filter other than `No filter` is only called useful if its held-out average R is above `No filter`'s.

The script's defaults were chosen without looking at any backtest, so the full-sample result is also
reported, but the verdict is the held-out one. Any variant explored later is chosen on tuning trades only
and then judged once on held-out trades.

### Splits

| Set | Tuning symbols | Held-out symbols | Time split |
|---|---|---|---|
| Crypto (Binance spot, 2023-11-01 → 2026-10-31) | BTC, ETH, SOL, XRP, BNB, DOGE | ADA, AVAX, LINK, LTC, DOT, TRX, BCH, ATOM | 2025-11-01 |
| EGX (EGX30 + EGX70 list order) | even positions | odd positions | 2025-01-01 |

### Costs

* Crypto: 0.1% of price per side (fee plus slippage), on entry and on the blended exit.
* EGX: 0.1% slippage per side plus EGP 2 commission per order on an EGP 100,000 position, the same model
  as the ICT backtests.
* Stops fill at the stop price, never worse (gaps are not modelled). Both are stated as limits of the test.

## Data

| Set | Chart bars | Intrabars (profile and delta) |
|---|---|---|
| Crypto 15m / 1H | Built from the Binance 1m archive | Binance 1m, full history |
| EGX daily | TradingView feed, full history, dividend-adjusted | 30m from 2024-01-02 (feed limit); daily-bar fallback before that, which is what the script itself does without intrabars |
| EGX 1H | TradingView feed from 2022-01 | 1m only for the last ~3 weeks; chart-bar fallback before that |

## Implementation check on TradingView (done)

* Runs without errors on BTCUSDT 15m, COMI 1D and COMI 1H (user's layout, Autosave off, discarded after).
* Session boxes start and end on the New York hours they claim (checked on the chart, UTC+2 clock).
* Estimated delta checked against TradingView's built-in Cumulative Volume Delta: within 1–4% on BTC 15m,
  but **the opposite sign on EGX 1H** (SESS-OF −150,658 vs CVD +253K on COMI 19 Nov 14:00).

### Corrections made

1. **Delta tie rule.** A lower-timeframe bar that closes where it opened counted as zero. On EGX the closing
   prints land in such bars and carried 68–70% of the last hour's volume, so the bar's delta had the wrong
   sign. Now uses TradingView's own CVD rule (side from the previous close, else the last side). After the
   fix, SESS-OF reads bar delta 253,159 and net delta 272,513; CVD reads 272.51K. Exact.
2. **TP1 and a return to entry on one bar** is now scored as TP1 then the breakeven stop (+0.5R), the same
   worse-case rule the script already applied to a bar touching stop and target.
3. Added `Log Closed Trades (Pine Logs)`, off by default, for trade-by-trade checks.

## Offline port

`tools/backtest/sof-engine.mjs` (engine), `sof-data.mjs` (chart builders), `tv-feed.mjs` (TradingView
feed, any timeframe), `fetch-binance.mjs`, `fetch-sof-egx.mjs`, `sof/check-dw.mjs`, `sof/compare-log.mjs`.

* Data Window check (`sof/check-dw.mjs`): 37/37 values identical to TradingView — developing POC, VAH, VAL,
  prior POC, bar delta and net delta on COMI 1H, COMI 1D and BTC 15m.
* Trade record check against Pine Logs exports (`sof/compare-log.mjs`), with the script's `Lower Timeframe`
  set so both sides see the same intrabars: **340/340 trades identical** (open bar, side, entry, stop,
  TP2, outcome, close bar, R).

| Chart | Mode exercised | Trades | Identical |
|---|---|---|---|
| BTCUSDT 15m | 24h, Asia reference, 1H HTF pools | 37 | 37 |
| ETHUSDT 1H | 24h, Asia reference, daily HTF pools | 71 | 71 |
| COMI 1H, 2022 → | single session, prior-day reference, daily HTF pools | 161 | 161 |
| COMI 1D, 2016-07 → | prior-week reference, weekly HTF pools, 4H intrabars | 71 | 71 |

* With the default intrabars the first 136 (COMI 1H) / 122 (COMI 1D) / 30 (BTC 15m) trades were already
  identical; the later differences all trace to TradingView having deeper intrabar history than the free
  feed (EGX 30m back to about 2013, EGX 1m back about 1.5 years, BTC 1m about 69 days).
* Binance-archive 15m bars equal TradingView's BINANCE 15m bars (5,856/5,856 OHLC identical), and the port
  run on them reproduces 30/30 TradingView trades in the overlap.

## Results (costs on, both sides)

Average net R per trade on **held-out trades** (full-sample figures are within a few hundredths):

| Set | No filter | Any except Avoid | Not against bias (default) | Favourable only | Gross R, No filter | Symbols positive |
|---|---|---|---|---|---|---|
| EGX daily (100 names) | −0.29 (22,137) | −0.30 | −0.30 | −0.22 (386) | −0.21 | 0–21% |
| EGX 1H (100 names) | −0.31 (27,656) | −0.34 | −0.41 | −0.38 (620) | −0.13 | 0–13% |
| Crypto 15m (14 coins) | −0.84 (29,508) | −0.91 | −0.85 | −0.55 (210) | −0.18 | 0–7% |
| Crypto 1H (14 coins) | −0.54 (11,896) | −0.57 | −0.49 | −0.39 (257) | −0.20 | 0% |

**Verdict: fails the pass rule on every set and every filter.** It loses before costs everywhere, so this is
not a cost problem; costs only make it worse (0.66R per trade on crypto 15m, where a 0.5 ATR stop is about
0.15% of price). Long and short lose alike.

### Why: the sweep entry has no edge

`sof/diagnose.mjs`: signed close-to-close move after each sweep entry, in ATR, against the move from every bar.

| Set | Longs vs random, 5 / 20 bars | Shorts vs random, 5 / 20 bars |
|---|---|---|
| EGX daily | −0.28 / −0.60 | −0.17 / −0.18 |
| EGX 1H | −0.18 / −0.25 | −0.11 / −0.15 |
| Crypto 15m | −0.03 / −0.03 | −0.04 / −0.13 |
| Crypto 1H | −0.05 / −0.15 | −0.05 / −0.14 |

After a level is taken and the bar closes back inside, price does slightly *worse* than from a random bar,
in both directions: the sweep tends to continue, not reverse. Price reaches +1R within 10 bars about 60–69%
of the time but also goes 1R against the trade about as often, and the stop usually comes first. No stop
or target setting can turn a negative entry edge positive, so no exit variants were tried.

### The conditions verdict on its own

`sof/verdict-test.mjs --heldout`: forward move by the state the dashboard showed, minus the all-bar drift,
signed in the state's direction (ATR, 5 / 20 bars).

| Set | FAVOURABLE long | FAVOURABLE short | Symbols where FAVOURABLE long beats drift |
|---|---|---|---|
| EGX daily | +0.08 / +0.18 | +0.08 / +0.17 | 46/73 |
| EGX 1H | +0.08 / +0.17 | +0.06 / +0.15 | 74/100 |
| Crypto 15m | +0.00 / +0.01 | +0.01 / −0.01 | 6/14 |
| Crypto 1H | −0.01 / −0.03 | +0.04 / −0.03 | 4/14 |

On crypto the verdict carries no directional information. On EGX it leans the right way by a small amount
(about half a percent over 20 days on daily), mostly through the bias (price above both POCs); on daily the
rest of the checklist adds to that (`WAIT` with a bullish bias has no edge). That is context, not a trade
signal, and it was not tested as an entry model.

## Limits

* Stops fill at the stop price; real gaps (EGX limit moves) would make results worse, not better.
* EGX 1H uses chart-bar profiles before the last three weeks (free-feed intrabar depth); EGX daily uses
  daily-bar profiles before 2024. TradingView with the user's plan would use finer intrabars there. The
  default `Not against bias` filter depends on the profile, but `No filter` does not (except TP2 via POC)
  and fails the same way.

## Open decisions (the user's)

* Keep the trade module (off by default) as is, remove it, or relabel the README with these results.
* Whether the EGX verdict lean is worth testing as an entry model of its own (a new hypothesis, needing a
  fresh held-out set).
