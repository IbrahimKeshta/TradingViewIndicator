# EGX Trust Indicator — Design

**Date:** 2026-11-02
**Status:** Design approved in conversation; written spec awaiting user review
**New file:** `src/egx-trust-indicator.pine` (standalone; `src/ict-rsi-ma-indicator.pine` is untouched)
**Depends on:** [[pine-has-no-test-framework]], [[validate-against-external-reference]],
[[strategy-tester-twin]] (EGX tick-granularity lessons), [[trade-system-roadmap]] (score and filter lessons)

## Purpose

A new indicator for Egyptian Exchange stocks that:

1. identifies which index a stock belongs to (EGX30 or EGX70) and reads that index's trend,
2. issues **long entries only**, each carrying a **trust score**, plus **exit warnings**,
3. is backtested in TradingView until it meets a pre-declared accuracy bar on data it was not tuned on.

## Success criterion (the user's definition of "80% accuracy")

Measured on the **held-out test set only** (see Validation protocol), pooled:

- **Win rate ≥ 80%**, where a win means Target 1 was reached before the stop, the time stop, or an
  exit warning; and
- **Total R > 0 after costs**; and
- **n ≥ 30** test trades; and
- **Total R > 0 on at least 60% of test charts that have ≥ 5 trades** (no single chart may carry the result).

A high win rate is trivially reachable with a tiny target and a wide stop, which is why positive R
after costs is part of the bar, not an afterthought.

## Scope

**In scope:** daily first; the script must run on any timeframe up to monthly (all lengths are in
bars). Long only. Built-in EGX30/EGX70 constituent lists with manual override. In-script trade
engine, results panel, optional Pine Logs trade log. README.md and README.ar.md updated in the same
change ([[keep-readme-updated]]).

**Out of scope (YAGNI, revisit after measurement):** shorts; a breakout/momentum model; a
`strategy()` twin for the Strategy Tester; alerts beyond basic `alertcondition`s; any change to the
ICT script.

## Architecture

One `indicator(overlay = true)` script, Pine v6, built from seven parts in dependency order.

### 1. Index map

- Two `array<string>` constituent lists, EGX30 and EGX70, fetched from the EGX website at
  implementation time and stamped with a `LIST_DATE` constant. EGX rebalances semi-annually; the
  lists go stale and must be refreshed by hand.
- Matching is on `syminfo.ticker` (exchange prefix ignored).
- Input `Index`: `Auto / EGX30 / EGX70`. `Auto` uses the lists; a stock in neither list falls back
  to EGX30 as the market proxy and is labelled **Unlisted**.
- The TradingView index symbols (e.g. `EGX_DLY:EGX30` and the EGX70 equivalent) are confirmed in
  the browser before implementation; note that EGX stocks resolve under `EGX_DLY`, not `EGX`.

### 2. Index regime

`request.security(indexSym, timeframe.period, …, lookahead = barmerge.lookahead_off)`.

- **Up:** index close > SMA(50) and SMA(50) > SMA(50)[10].
- **Down:** index close < SMA(50) and SMA(50) < SMA(50)[10].
- **Neutral:** otherwise.

### 3. Stock trend and relative strength

- Trend: close vs SMA(50) and SMA(200).
- Relative strength: ratio = stock close / index close; RS is "above" when ratio > SMA(ratio, 50)
  and "rising" when SMA(ratio, 50) > its value 10 bars earlier.

### 4. Setup detector

All hard gates open and RSI(2) < 10. Gates:

- Index regime ≠ Down.
- Stock close > SMA(200). If fewer than 200 bars exist, the gate is skipped and STATUS flags it.
- Liquidity: SMA(close × volume, 20) ≥ `Min Avg Value Traded (EGP)` input.

A setup expires after 5 bars, or when price closes more than 0.5 ATR(14) below the setup bar's low.

### 5. Confirmation

Entry at the close of the first bar within 3 bars of the setup that is any of:

- close > previous high;
- bullish engulfing;
- hammer: lower wick ≥ 2 × body and close in the top third of the range.

### 6. Trade engine

One trade at a time per chart.

- **Stop:** lowest low from setup to entry − 0.25 ATR. Risk floor = max(0.5 ATR, 10 ticks). Skip
  the setup if risk > 3 ATR.
- **Target 1:** entry + `T1 (R)` × risk, default 0.75R. Half the position exits at T1; the stop on
  the remainder moves to breakeven.
- **Remainder:** trails on a 2.5 × ATR(14) chandelier, or exits on an exit warning.
- **Time stop:** 20 bars without T1 → exit at close.
- **Exit warnings** (plotted as `EXIT`; they close whatever is still open, so the whole trade if T1
  has not been hit, which then counts as a non-win): index regime turns Down, or the stock closes
  below SMA(50).
- **Same-bar ambiguity:** a bar touching both stop and T1 counts the stop first (loss).
- **Costs:** 0.1% slippage per side plus 2 EGP per order, converted to R per trade and deducted.
  Each result is blended across the two halves.

### 7. Trust score and results

**Part 1, setup quality (0–100).** Six independent factor groups, equal weight, full = 1, half = 0.5:

| Factor | Full | Half |
|---|---|---|
| Index regime | Up and SMA rising | Neutral |
| Stock trend | close > SMA50 > SMA200 | above SMA200 only |
| Relative strength | above and rising | above only |
| Support location | ≥ 2 supports within 1 ATR | 1 support |
| Participation | pullback volume < SMA(vol, 20) and confirmation volume > it | either one |
| Confirmation strength | engulfing, or close in top 25% of the range | any other valid confirmation |

Supports considered: last confirmed swing low, SMA(20), SMA(50), and the 38.2–61.8% retracement of
the last swing up. Momentum oscillators (RSI/MACD/Stochastic) share one price series and would get
at most one vote between them. Weights are **never fitted**: a factor that proves anti-predictive on
the tuning set is dropped, not re-weighted.

Bands: **Low** < 50, **Mid** 50–74, **High** ≥ 75.

**Part 2, track record.** Running count of closed trades and wins per band, using only trades closed
before the signal bar. Label: `BUY · Trust 83 · High 41/50 (82%)`; with fewer than 10 prior trades in
the band, `High — building history`.

**Panels.**

- **STATUS:** index, how it was chosen (Auto / Override / Unlisted), `LIST_DATE`, regime, each gate's state.
- **RESULTS:** columns **Tuning** (bars before the `Test Start` input, default 2024-01-01) and
  **Test** (from then on). Rows: n, win %, Avg R, Total R, max consecutive losses; the same rows per
  trust band.
- **Trade log:** input `Log Trades` (off by default) writes one `log.info()` line per closed trade:
  entry/exit time and price, R, MFE/MAE in R, trust score, factor flags, close reason.

## Validation protocol (fixed before any test run)

- **Tuning set:** 10 liquid EGX30 + 5 EGX70 stocks, daily, bars before 2024-01-01. The symbol
  list is written into the plan before any run.
- **Test set:** the same 15 symbols from 2024-01-01 onward, plus 10 never-viewed symbols (5 EGX30,
  5 EGX70) over their full history.
- **Rounds:** at most 3. Each round changes only what the tuning-set evidence supports and is judged
  once. Rounds 2 and 3 add a fresh batch of 10 never-viewed symbols, and that batch decides the
  round, since the 2024+ bars will have been seen.
- **If round 3 still fails:** report the best honest numbers, the trade-offs, and any trust band that
  meets ≥ 80% out-of-sample on n ≥ 30. The user decides what happens next.

## Correctness checks (against an external reference, not the script's own formula)

1. Bar Replay: 5 trades on each of 2 symbols, checked by hand against the written rules (gates,
   setup, confirmation, stop, T1, close reason).
2. Recompute the RESULTS totals from the downloaded Pine Logs CSV in PowerShell and confirm they
   match the panel exactly (coerce numbers before comparing).
3. Built-in lists checked against the EGX website; regime readings checked against the index chart
   itself.

## Platform constraints

- Basic plan: 2 non-built-in indicators per chart. **The user frees a slot before live testing.**
  An over-cap chart can accept an "Update on chart" yet run inert, so a chart that draws nothing is a
  cap problem until proven otherwise.
- Bar Replay works only on 1D and above, which suits a daily-first validation.
- Protect the user's only saved layout: Autosave off before testing; discard-reload afterwards.
- Pine cannot be compiled outside TradingView; static read-back is never reported as a compile.

## Deliverables

1. This spec.
2. An implementation plan via writing-plans (`docs/superpowers/plans/2026-11-02-egx-trust-indicator.md`).
3. `src/egx-trust-indicator.pine` and README sections (EN + AR).
4. A validation results document with the raw per-chart numbers and the pass/fail verdict per round.
