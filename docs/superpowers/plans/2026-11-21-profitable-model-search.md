# Search for a profitable model on EGX and crypto (started 2026-11-21)

After the Session Order Flow trade module failed everywhere, the user asked for a model that is profitable on
**both** EGX and crypto: "backtest until you find a way, try different methods". This file was written
**before any discovery result**, so the protocol cannot be bent to fit a result afterwards.

## Protocol

Searching many ideas on the same data always finds something that looks good. So the data is split three
ways, and the final verdict comes only from data no idea was ever tuned on.

| Stage | Crypto | EGX | Use |
|---|---|---|---|
| Discovery | the 14 coins of the SOF test, entries before 2025-11-01 | EGX100, entries before 2025-01-01 (Cairo) | try anything, any number of ideas and settings |
| Validation | the same 14 coins, entries from 2025-11-01 | EGX100, entries from 2025-01-01 | each finalist run **once**; at most **3** finalists |
| Final exam | 10 coins never used: NEAR, APT, ARB, OP, FIL, UNI, AAVE, ETC, XLM, HBAR (2023-11 → 2026-10) | 60 most liquid EGX stocks outside EGX100 (`data/sof/final-egx-list.txt`), full history | run **once**, after validation, for the one model chosen |

Final-exam data lives in `data/sof/binance-final/` and `data/sof/egx-final/` and is not read by any
discovery or validation script.

## Pass rule (unchanged from the SOF test, the user's)

On the final exam, separately for crypto and for EGX:

1. average net R per trade ≥ **+0.10** after costs,
2. net R > 0 on ≥ **60%** of symbols (with at least 5 trades),

and the same model (one rule set; parameters may differ by timeframe, chosen in discovery) must pass on
both markets. A finalist must also be positive on validation to go to the final exam.

## Costs and fills

* Crypto: 0.1% of price per side. EGX: 0.1% per side plus EGP 2 per order on an EGP 100,000 position.
* Entry at the signal bar's close. A stop that the next bar opens beyond fills at that open (gaps are
  modelled from here on). A bar that reaches both stop and target counts as the stop.
* Both sides on both markets (the user's choice), long and short reported separately.

## Timeframes

Crypto: 15m, 1H, 4H, 1D. EGX: 1D, 1H. On 15m crypto the round-trip cost is about 0.66R for a 0.5 ATR stop,
so any intraday model has to use wider stops or longer holds than the SOF module did.

## Discovery log

Tools: `tools/backtest/research/` (`features.mjs` cached per-bar features incl. every Session Order Flow
state from the verified port; `sim.mjs`; `families.mjs`; `discover.mjs`). 120 configurations in total.

**Round 1 (64 configs, 6 families: breakout, pullback, FAVOURABLE onset, liquidity run, squeeze, RSI(2)
mean reversion).** Trend-following leads everywhere: breakouts and "liquidity runs" (a Session Order Flow
pool taken with a close beyond it, the opposite of the failed sweep) with an ATR trailing stop. Best avg
net R: EGX 1D +0.41, EGX 1H +0.16, crypto 1D +0.29, 4H +0.12, 1H +0.05, 15m −0.06 (gross +0.06: costs).
Pullback, FAVOURABLE onset and mean reversion trail them; short trades are about flat on every set.

**Round 2 (48 configs: the leaders plus one filter each — SOF bias, not-AVOID, stop ≥ 1% of price; trail
4/5 ATR).** Leader: liquidity run + 200-EMA trend + 5-ATR trail: EGX 1D +0.57, EGX 1H +0.21, crypto 1D +0.33,
4H +0.14, 1H +0.04, 15m −0.03. The bias filter adds a little on EGX only; the 1% stop floor rarely binds.

**Round 3 (8 configs, aimed at crypto 1H / 15m: slower trend filter, 8-ATR trail).** Crypto 1H reaches
+0.076 (79% of coins positive) with an 8-ATR trail; 15m stays at −0.00 to −0.04. The search on 15m stops
here: positive before costs, never after.

### Declared before validation (2026-11-21)

Finalists (each run once on validation, all six sets):

| | Rule |
|---|---|
| A | Liquidity run (pool taken, close beyond) in the 200-EMA trend direction, initial stop and trail 5 ATR from the best close |
| B | the same with an 8-ATR stop and trail |
| C | 55-bar close breakout in the 200-EMA trend direction, 5-ATR stop and trail (price only, no Session Order Flow input) |

**Judged timeframes:** EGX 1D and crypto 4H are primary (the model must pass both). EGX 1H, crypto 1D and
crypto 1H are reported as secondary. Crypto 15m is dropped: discovery shows costs exceed the gross edge of
every idea tried. The finalist that goes to the final exam is the one with the best validation result on the
two primary sets, provided it is positive on both.

## Validation (each finalist once, 2026-11-21)

| Finalist | EGX 1D | Crypto 4H | EGX 1H | Crypto 1D | Crypto 1H |
|---|---|---|---|---|---|
| **B** liquidity run, 8-ATR trail | **+0.515** (281) | **+0.105** (202, 79% coins +) | +0.226 | +0.100 (25) | −0.012 |
| A liquidity run, 5-ATR trail | +0.504 | +0.045 | +0.195 | −0.099 | −0.038 |
| C 55-bar breakout, 5-ATR trail | +0.440 | +0.042 | +0.169 | −0.015 | −0.024 |

B is best on both primary sets and positive on both, so B goes to the final exam (the rule declared above).

## Final exam (B, run once, 2026-11-21) — PASSES

| Set | Trades | Avg net R | Symbols positive | Pass rule |
|---|---|---|---|---|
| EGX 1D, 60 stocks outside EGX100 | 1,566 | +0.999 | 95% of 55 | PASS |
| Crypto 4H, 10 unseen coins | 425 | +0.165 | 70% of 10 | PASS |
| EGX 1H (secondary) | 2,202 | +0.192 | 74% of 58 | PASS |
| Crypto 1D (secondary) | 74 | +0.024 | 50% | fail |
| Crypto 1H (secondary) | 1,788 | +0.026 | 60% | fail |

### Robustness of the final exam (checks, not used to choose anything)

| Set | As run | Each trade capped at +10R | Without the 2 best symbols | Long only | Median trade |
|---|---|---|---|---|---|
| EGX 1D | +0.999 | +0.456 | +0.611 (IFAP, EFIC out) | +1.790 (98% +) | −0.19R |
| EGX 1H | +0.192 | +0.153 | +0.162 | +0.532 (96% +) | −0.31R |
| Crypto 4H | +0.165 | +0.108 | **+0.082** (HBAR, XLM out) | +0.345 (60% +) | −0.22R |

* IFAP's +565R is one real trade (2005-05 → 2008-08, the Egyptian bull market, adjusted price ×95). Capping
  every trade at +10R still leaves EGX 1D at +0.46.
* EGX 1D by entry year: strong in trending years (2005, 2016, 2022, 2024), about flat to −0.2 in 2010–2015
  and 2018–2019. EGX 1H is positive in every year since 2022.
* Crypto 4H passes the pre-declared rule but is the weakest link: it depends on a few trending coins and was
  strong in 2024 (+0.35), weak in 2025 (+0.04).
* Shorts lose on EGX (−0.21 / −0.31) and are flat on crypto in discovery, validation and final alike; the
  edge is on the long side. Long-only was not the declared rule, so it is reported, not claimed.
* Median trade is negative everywhere: the model loses small often (win rate 34–42%) and makes its money on
  a minority of long trends, which a trader has to be able to sit through.

## Built into the indicator (2026-11-21)

`src/session-orderflow.pine`: the trade module's new `Entry Model` input, default `Liquidity run (trend)`
(stop and trail 8 ATR, trend EMA 200), with the sweep model kept as an option. Checked on TradingView with
`Log Closed Trades` against `research/compare-run.mjs`: COMI 1D 33/33 and BTC 4H 46/46 trades identical
(entry bar, exit bar, R). It compiles with no errors. The user's on-chart instance runs this version.

## What this does not claim

* The model was chosen by a search; the final exam is the honest number, and it was run once.
* Stops fill at the stop or the gap open; slippage beyond the 0.1% per side is not modelled.
* Crypto 4H passes but is thin (+0.08 without its two best coins); EGX is the stronger result.
* Long-only looks better on every stage but was not the declared rule; it is a candidate for a future
  test on fresh data, not a claim.
