# EGX Trust Indicator v2 — Validation Results

**Spec:** `docs/superpowers/specs/2026-11-02-egx-trust-v2-design.md` · **Script commit:** `9c53400`
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (rows with round `v2`)
**Win** = net R > 0 after costs. All runs on TradingView, daily charts, RSI Oversold Below = 15. Every other input is at its default unless listed.

## Step 1 — filter selection (Tuning column, 15 charts, T1 1.0R, Trail 2.5 ATR)

| Run | n | Win % | Avg R / trade | Lift vs baseline | Charts R>0 |
|---|---|---|---|---|---|
| Baseline (no filters) | 741 | 53.4 | +0.124 | — | 12/15 |
| Require Index Up | 583 | 53.9 | +0.123 | −0.001 | 11/15 |
| Weekly Trend Filter | 710 | 53.9 | +0.132 | +0.008 | 12/15 |
| ADX Filter (≥ 20) | 602 | 53.3 | +0.122 | −0.002 | 12/15 |

The keep rule is a lift ≥ 0.03R with n ≥ 300. **No filter qualifies.** The baseline reproduces v1's trade selection exactly (same n and R per chart as v1 combo c9); only the win counts differ, which confirms the filters-off path is unchanged.

## Step 2 — exit grid (no filters)

| T1 (R) | Trail (ATR) | n | Win % | Avg R / trade | Total R | Charts R>0 |
|---|---|---|---|---|---|---|
| 1.0 | 2.5 | 741 | 53.4 | +0.124 | +91.59 | 12/15 |
| 1.0 | 3.5 | 697 | 53.5 | **+0.170** | +118.23 | 12/15 |
| 1.5 | 2.5 | 720 | 46.0 | +0.190 | +136.61 | 12/15 |
| 1.5 | 3.5 | 673 | 45.6 | +0.242 | +163.11 | 11/15 |

**Pick (pre-declared rule: highest Tuning avg R among combos with win ≥ 50% and n ≥ 300): T1 = 1.0R, Trail = 3.5 ATR, no filters.** Committed before any test read.
