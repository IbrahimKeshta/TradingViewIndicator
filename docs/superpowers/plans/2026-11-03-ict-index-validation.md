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

## Deciding test — batch D (10 never-viewed stocks, full history, Tuning + Test summed)

| Chart | Baseline n / wins / R | Confirmation n / wins / R |
|---|---|---|
| MCQE | 82 / 33 / −4.13 | 84 / 31 / −6.91 |
| EGAL | 67 / 35 / +18.52 | 70 / 33 / +7.40 |
| GBCO | 46 / 18 / +6.14 | 46 / 23 / +16.14 |
| BTFH | 28 / 10 / +1.23 | 21 / 7 / +3.24 |
| RMDA | 17 / 7 / +0.53 | 17 / 7 / +0.04 |
| ISMQ | 13 / 9 / +10.68 | 19 / 10 / +8.21 |
| ENGC | 56 / 20 / −3.63 | 50 / 23 / −3.33 |
| OIH | 2 / 1 / −0.71 | 2 / 1 / +0.96 |
| SCEM | 64 / 25 / +5.90 | 60 / 20 / +0.81 |
| ZMID | 22 / 9 / −1.06 | 29 / 13 / +2.73 |
| **Pooled** | **397 / 42.1% / +0.084R per trade (+33.47R)**, 6/9 charts R>0 | **398 / 42.2% / +0.074R per trade (+29.30R)**, 7/9 charts R>0 |

| Pass rule | Result | Met |
|---|---|---|
| Pick avg R > 0 after costs | +0.074 | ✓ |
| Pick beats baseline on batch D | +0.074 vs +0.084 | ✗ |
| ≥ 60% of charts (n ≥ 5) with R > 0 | 7/9 = 78% | ✓ |

**Verdict: FAIL.** Require Confirmation's large Tuning lift (+0.259R per trade, 14/14 charts positive) **did not replicate on unseen stocks** (−0.010R vs baseline). Its earlier "validated on EGX daily" result came from charts that are also in this tuning set, so it was in-sample too. The index gate was below the keep bar on Tuning (+0.029) and so was not tested on batch D.

**What did hold up:** with honest costs and the 10-tick floor, the **baseline ICT pullback model is mildly profitable out of sample** (+0.084R per trade on 397 unseen-stock trades, 42% win rate), much like the dip-buying v2 (+0.055R).

**Reading mechanics note:** the first batch-D pass got stuck on one symbol, so five rows repeated ISMQ's values. The reader now waits until the Data Window shows the requested symbol. Every batch-D number above comes from the fixed reader, and the first five charts were re-read and matched exactly.

**Not done:** the review's request to load the script once on a non-EGX intraday chart (to confirm the EGX index lookups never break it). The `ignore_invalid_symbol` fix is in the code but has not been seen running off EGX.

All 10 batches (A–D) have now been used; any further design needs new unseen stocks, e.g. the rest of EGX70.
