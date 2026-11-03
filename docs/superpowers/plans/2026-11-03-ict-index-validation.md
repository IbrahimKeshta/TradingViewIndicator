# ICT Script — Index Gate, Honest R, Out-of-Sample Validation

**Script:** `src/ict-rsi-ma-indicator.pine` at `5b2c950` (index gate, optional costs and tick floor, Tuning/Test split; 12 debug plots dropped for Pine's 64-plot limit). The test instance was added alongside the user's own instance, with Autosave off.
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (rows with round `ict`).
**Settings for every run:** daily, Long Trades Only on, Apply Costs on (0.1%/side + 2 EGP/order, position 100,000), Min Risk (ticks) 10, otherwise defaults. The trailing-stop model is off by default, so only the **pullback model** traded. Win = net R > 0.

## Tuning (15 charts, Tuning column = trades entered before 2024-01-01)

| Config | n | Win % | Avg R / trade | Lift vs baseline | Total R | Charts R>0 (n≥5) |
|---|---|---|---|---|---|---|
| Baseline | 513 | 42.3 | +0.123 | — | +63.23 | 10/14 |
| Require Index Trend | 472 | 42.8 | +0.152 | +0.029 | +71.65 | 10/14 |
| Require Confirmation | 479 | 52.4 | +0.382 | +0.259 | +183.00 | 14/14 |
| Both | 441 | 52.4 | +0.388 | +0.265 | +171.06 | 14/14 |

ELEC took no trades in any config: its split-adjusted prices (< 1 EGP, tick 0.01) put every stop inside the 10-tick floor.

**Keep rule (pre-declared): a filter stays if it lifts Tuning avg R by ≥ 0.03 with ≥ 150 trades.**
- Require Confirmation: +0.259, kept.
- Require Index Trend: +0.029, **not kept** (just under the bar). On top of confirmation it adds only +0.006.

**Pick: Require Confirmation on, Require Index Trend off.** Committed before any batch-D read.

Deciding test (pre-declared): batch D (MCQE, EGAL, GBCO, BTFH, RMDA, ISMQ, ENGC, OIH, SCEM, ZMID), full history. Pass if the pick's avg R > 0 after costs, **and** it beats the baseline on the same batch, **and** ≥ 60% of charts (n ≥ 5) have R > 0.
