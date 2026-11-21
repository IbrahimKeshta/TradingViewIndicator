# EGX Trust Indicator v2 — Profit-First Design

**Date:** 2026-11-02
**Status:** Design approved by the user in conversation
**Builds on:** `2026-11-02-egx-trust-indicator-design.md` (v1). Everything there stands unless changed here.
**Why:** v1 validated live at 55.2% win rate and +0.02R per trade out of sample (`docs/superpowers/plans/2026-11-02-egx-trust-validation.md`). The 80% goal is unreachable for this entry family. The user moved the goal to profit first.

## Success criterion (the user's choice)

On the deciding out-of-sample set, pooled:

- **Average R ≥ +0.15 per trade after costs**, and
- **Win rate ≥ 50%**, where **a win = a trade whose net R after costs is > 0** (changed from v1's "Target 1 reached"), and
- **n ≥ 30**, and
- **Total R > 0 on ≥ 60% of the charts with ≥ 5 trades.**

## Changes from v1

### 1. Win definition
Everywhere a win is counted (panel Win %, band rows, `DBG … Wins`, the track record on labels, the closed-trade label colour, the `Log Trades` win field), a win is `R > 0` after costs. Target 1 still triggers the half exit and moves the stop to breakeven.

### 2. Exits
The mechanics are unchanged: half at Target 1, stop to breakeven, chandelier trail on the rest, and no time stop after Target 1. **The tuned range moves:** Target 1 ∈ {1.0, 1.5} R, Trail ∈ {2.5, 3.5} × ATR.

### 3. Hard filters (new inputs, group "Filters", all off by default until tuning decides)
Each filter must pass on the setup bar, as part of `gatesOpen`:

- **Require Index Up:** regime must be Up (1), not merely "not Down". Evidence from v1 tuning: Neutral-regime trades won 52.5% vs 57.3% for Up (n = 198 vs 564).
- **Weekly Trend Filter:** the last *completed* weekly close is above its N-week SMA, default N = 30. Requested with `request.security(syminfo.tickerid, "W", [close[1], ta.sma(close, N)[1]], lookahead = barmerge.lookahead_on)`, the standard non-repainting form. The filter is ignored (passes) on charts whose timeframe is weekly or longer.
- **ADX Filter:** `ta.dmi(14, 14)` ADX ≥ threshold, default 20.

STATUS shows each enabled filter's state on the last bar.

### 4. Unchanged
Index mapping and the EGX30 proxy, the dip setup and confirmation, the stop, costs, the Tuning/Test split and straddle handling, and the trust score. The README keeps stating that the trust score showed no predictive power in v1.

## Validation protocol (fixed before any run)

- **Tuning:** the same 15 charts as v1, bars before 2024-01-01, Tuning column only. Base settings: RSI < 15 (v1 pick). Defaults otherwise.
  1. **Filter selection.** Using T1 = 1.0, Trail = 2.5 as the reference, run the baseline (no filters) and each filter alone. Keep a filter if it raises pooled Tuning average R by ≥ 0.03 and leaves pooled Tuning n ≥ 300. Kept filters are then combined. If the combination drops n below 300, keep only the single best filter.
  2. **Exit grid.** With the kept filters, run T1 {1.0, 1.5} × Trail {2.5, 3.5}. Pick the highest pooled Tuning average R among combos with Tuning win rate ≥ 50% and n ≥ 300. If no combo has a win rate ≥ 50%, pick the highest win rate. Commit the pick before any test read.
- **Deciding test:** batch C, 10 never-viewed stocks over their full history (Tuning + Test columns summed): EFID, HELI, ORHD, ISPH, CLHO (EGX30); ATQA, KABO, EHDR, PHAR, TAQA (EGX70).
- **Reported, not deciding:** the 15 tuning charts from 2024 onward (already seen once under v1).
- **Round 2,** only if round 1 fails and the Tuning log justifies one change: decided on batch D (MCQE, EGAL, GBCO, BTFH, RMDA, ISMQ, ENGC, OIH, SCEM, ZMID). Maximum 2 rounds.
- **Cross-check:** the Pine Logs Tuning sums must match the panel on the tuning charts.
