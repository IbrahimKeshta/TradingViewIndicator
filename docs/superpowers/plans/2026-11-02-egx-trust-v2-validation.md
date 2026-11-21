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

## Deciding test — batch C (10 never-viewed stocks, full history, picked settings)

| Chart | n | Win % | Total R |
|---|---|---|---|
| EFID | 34 | 55.9 | +0.85 |
| HELI | 65 | 52.3 | +2.60 |
| ORHD | 71 | 49.3 | +4.20 |
| ISPH | 41 | 46.3 | +5.69 |
| CLHO | 43 | 41.9 | −6.67 |
| ATQA | 35 | 62.9 | +7.74 |
| KABO | 55 | 56.4 | +9.00 |
| EHDR | 40 | 52.5 | +8.03 |
| PHAR | 42 | 50.0 | −5.02 |
| TAQA | 16 | 50.0 | −1.92 |

**Pooled: n = 442, win rate 51.6%, average +0.055R per trade (total +24.50R), charts with R > 0: 7/10 (70%).**

| Pass rule | Result | Met |
|---|---|---|
| Avg R ≥ +0.15 per trade | +0.055 | ✗ |
| Win rate (net R > 0) ≥ 50% | 51.6% | ✓ |
| n ≥ 30 | 442 | ✓ |
| ≥ 60% of charts with R > 0 | 70% | ✓ |

**Round 1: FAIL**, on the profit bar only. The edge measured on Tuning (+0.170R) shrank to +0.055R on unseen stocks.

**Reported, not deciding:** the 15 tuning charts from 2024-01-01 with the same settings: n = 245, win rate 56.7%, average +0.254R (+0.154R excluding one +26R ETEL trade), positive on 12/15. That period was a strong EGX bull run, and these charts had already been seen under v1.

**What v2 established, compared with v1:**
- **Wider exits are the only lever that helped.** Trail 3.5 ATR beat 2.5 at both targets. T1 1.5R raised Tuning R further (+0.242), but its win rate fell below 50% (45.6%).
- **More indicators (index-Up, weekly trend, ADX) added nothing measurable**, adding the same 0–1 points v1's factors did.
- On genuinely unseen stocks the system stays positive (+0.055R, 70% of charts profitable), but that's a thin edge after costs.

**Round 2 not started. Ruling:** no pattern in the Tuning data justifies a rule change. The only better-R setting in the grid (T1 1.5 / Trail 3.5) is excluded by the user's own ≥ 50% win floor. Relaxing that floor is the user's call, not a tuning decision. Batch D (MCQE, EGAL, GBCO, BTFH, RMDA, ISMQ, ENGC, OIH, SCEM, ZMID) remains unviewed.

**Defaults set to the pick:** RSI Oversold Below 15, Target 1 1.0R, Trail 3.5 ATR, filters off.
