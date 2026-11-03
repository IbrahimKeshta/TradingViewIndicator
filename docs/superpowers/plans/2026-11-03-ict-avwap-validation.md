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

(filled in after the runs)
