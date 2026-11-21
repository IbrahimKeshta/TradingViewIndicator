# ICT Script — Anchored VWAP Filter, Out-of-Sample Validation

**Script:** `src/ict-rsi-ma-indicator.pine` with `Require Anchored VWAP` (off by default). Longs need the close above the VWAP anchored at the latest confirmed major swing low; shorts mirror it with the latest major swing high. Applies to both entry models.
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (rows with round `avwap`).

## Protocol (declared before any read)

**Settings for every run:** daily, Long Trades Only on, Apply Costs on (0.1%/side + 2 EGP/order, position 100,000), Min Risk (ticks) 10, otherwise defaults. The same settings as the ICT index validation. Only the pullback model trades. Win = net R > 0.

**One config, no parameter tuning:** the anchor is fixed at the major swing (Major Swing Lookback 20). No anchor or tier variants are tried, so there is nothing to pick between on the tuning charts.

**Step 1 — Tuning** (the same 15 charts as the index validation, trades entered before 2024-01-01): COMI, TMGH, ETEL, EAST, FWRY, ABUK, HRHO, ORAS, AMOC, MFPC, SWDY, ORWE, MASR, ELEC, EGCH.
- Baseline re-read first. It must match the earlier ICT baseline (n 513, +63.23R) to show the new code changes nothing while off.
- **Keep rule:** the filter goes to step 2 only if it lifts Tuning avg R by ≥ +0.03 with ≥ 150 trades.

**Step 2 — Deciding test on batch E** (10 never-used EGX70 stocks, full history, Tuning + Test summed). Picked mechanically: list every EGX70 name never used in any test, in `EGX70_LIST` order, drop COSG (on the user's own chart), and take every 5th name starting with the first:
ACTF, AIHC, BONY, DAPH, ELKA, EXPA, HDBK, MCRO, NCCW, SVCE (positions 1, 6, 11 … 46 of the 49 unused names).
If a symbol has no TradingView data, the next name in that list replaces it.
- **Pass if all three hold:** avg R with the filter > 0 after costs; it beats the baseline on the same batch by ≥ +0.03R per trade; ≥ 60% of charts (n ≥ 5) have R > 0.

## Results

**Script at `52c8d5d`.** The first load hit RE10140 (too many plots), because the two anchored VWAP lines pushed the script over 64. Three confirmation debug plots (MACD, Stoch, Ichimoku readouts) were dropped to fix it.

### Step 1 — Tuning (15 charts, trades entered before 2024-01-01)

| Chart | Baseline n / wins / R | Anchored VWAP n / wins / R |
|---|---|---|
| COMI | 59 / 26 / +12.60 | 56 / 25 / +12.55 |
| TMGH | 42 / 15 / +6.29 | 42 / 15 / +6.29 |
| ETEL | 47 / 22 / +11.13 | 47 / 22 / +11.13 |
| EAST | 30 / 10 / −7.22 | 30 / 10 / −7.22 |
| FWRY | 14 / 8 / +9.99 | 14 / 8 / +9.99 |
| ABUK | 52 / 17 / −7.45 | 49 / 16 / −5.70 |
| HRHO | 48 / 20 / +5.07 | 48 / 20 / +5.07 |
| ORAS | 20 / 9 / +18.59 | 20 / 9 / +18.59 |
| AMOC | 23 / 10 / +2.87 | 22 / 10 / +3.15 |
| MFPC | 29 / 15 / +11.41 | 29 / 15 / +11.41 |
| SWDY | 42 / 19 / +1.15 | 42 / 19 / +1.15 |
| ORWE | 32 / 12 / −3.64 | 32 / 12 / −3.64 |
| MASR | 28 / 13 / −1.93 | 28 / 13 / −1.93 |
| ELEC | 0 / 0 / 0 | 0 / 0 / 0 |
| EGCH | 47 / 21 / +4.37 | 43 / 19 / +3.11 |
| **Pooled** | **513 / 42.3% / +0.123R per trade (+63.23R)** | **502 / 42.4% / +0.127R per trade (+63.95R)** |

The baseline matches the earlier ICT baseline chart for chart, so the new code changes nothing while it's off.

**Lift +0.004R per trade, below the +0.03 keep bar. Not kept; step 2 not run.** Batch E (ACTF, AIHC, BONY, DAPH, ELKA, EXPA, HDBK, MCRO, NCCW, SVCE) was never opened and is still unused.

**Why it does almost nothing:** it removed 11 of 513 trades (2%) and changed nothing on 11 of 15 charts. A pullback long already needs the internal trend to be up, and in an internal uptrend the close is nearly always above the VWAP from the last confirmed major low. That anchor is at least 20 bars old, so the filter mostly agrees with the trend condition the engine already applies, rather than adding new information.
