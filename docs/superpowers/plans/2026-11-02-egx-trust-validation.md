# EGX Trust Indicator — Validation Results

**Spec:** `docs/superpowers/specs/2026-11-02-egx-trust-indicator-design.md`
**Plan:** `docs/superpowers/plans/2026-11-02-egx-trust-indicator.md` (Task 5)
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv`
**Run on:** TradingView, user account (Basic), daily charts, prefix `EGX_DLY:`. Script commit `cb6cd0d`, added to the user's layout with Autosave off; every reading comes from the script's own `DBG` Data Window totals on the last bar.

## Pre-flight (step 0)

- The script compiled on TradingView ("Compiled. Updated on chart.").
- `EGX_DLY:EGX30` history reaches back to about 2006–2008. **`EGX_DLY:EGX70EWI` only starts in mid-2020.** Without a fix, every EGX70 stock read regime "No data" before about Sep 2020 (ELEC 1D: 3 Tuning trades). Ruling, in commit `cb6cd0d`: an EGX70 stock uses EGX30 as its market trend until EGX70EWI can give a full regime reading. STATUS flags this.
- Index values populate on both an EGX30 stock (COMI) and an EGX70 stock (ORWE).
- **Disclosure:** the first pre-flight read, at default settings (RSI 10, T1 0.75), also returned the Test-A columns for COMI (8/19 wins, −1.76R) and ORWE (9/19, −0.48R) before the reader was changed to strip Test fields. No tuning decision used them.

## Round 1 — tuning grid (Tuning column only, bars before 2024-01-01)

All other inputs at their defaults. Pooled over the 15 tuning charts (COMI, TMGH, ETEL, EAST, FWRY, ABUK, HRHO, ORAS, AMOC, MFPC, SWDY, ORWE, MASR, ELEC, EGCH):

| Combo | RSI below | T1 (R) | n | Win % | Total R | Charts R>0 | High band n | High win % | High R |
|---|---|---|---|---|---|---|---|---|---|
| c1 | 5 | 0.5 | 327 | 63.3 | −4.71 | 6/15 | 153 | 66.0 | +2.85 |
| c2 | 5 | 0.75 | 320 | 54.7 | +16.47 | 7/15 | 152 | 57.2 | +13.04 |
| c3 | 5 | 1.0 | 317 | 44.8 | +28.39 | 9/15 | 149 | 47.0 | +16.16 |
| c4 | 10 | 0.5 | 590 | 63.4 | −34.89 | 4/15 | 327 | 63.6 | −25.68 |
| c5 | 10 | 0.75 | 574 | 55.6 | +14.61 | 7/15 | 321 | 56.1 | −2.71 |
| c6 | 10 | 1.0 | 567 | 46.7 | +49.21 | 8/15 | 315 | 47.6 | +19.49 |
| c7 | 15 | 0.5 | 798 | 65.2 | −38.90 | 3/15 | 466 | 66.1 | −23.08 |
| c8 | 15 | 0.75 | 762 | 56.0 | +31.10 | 9/15 | 443 | 56.9 | +9.31 |
| c9 | 15 | 1.0 | 741 | 48.6 | +91.59 | 12/15 | 425 | 50.1 | +54.07 |

**Pick (by the pre-declared rule: highest pooled Tuning win rate among combos with Total R > 0 and n ≥ 50): c8, RSI Oversold Below = 15, Target 1 (R) = 0.75.** Written and committed before any Test reading under these settings.

What the Tuning data already says:
- **No combo reaches 80% on Tuning data**, the data the settings were chosen on. The ceiling is about 65% (c7), and it comes with negative R. Out-of-sample results are normally worse than in-sample.
- Win rate and R trade off almost mechanically through T1: a closer target raises the win rate and lowers R.
- **The trust score barely separates trades.** The High band runs within about 1–3 points of the average in every combo.
- **Factor-drop step, skipped this round. Ruling:** dropping a factor changes only the score, not which trades are taken, so it cannot move the pooled win rate. With High-band separation of about 1–3 points, no factor drop can lift a band from about 57% to 80%. The per-factor log analysis moves to round 2 as the evidence for a rule change.

## Round 1 — out-of-sample verdict (settings c8: RSI 15, T1 0.75)

Test-A = the 15 tuning charts, bars from 2024-01-01. Test-B = 10 never-viewed charts (PHDC, CCAP, ADIB, SKPC, JUFO, OCDI, AMER, CIEB, MTIE, LCSW) over their full history (Tuning + Test columns summed; straddle trades are counted in neither column, at most 1 per chart).

| Set | Chart | n | Wins | Win % | Total R |
|---|---|---|---|---|---|
| A | COMI | 22 | 11 | 50.0 | +2.78 |
| A | TMGH | 16 | 7 | 43.8 | −3.24 |
| A | ETEL | 19 | 12 | 63.2 | +2.70 |
| A | EAST | 13 | 7 | 53.8 | +1.89 |
| A | FWRY | 32 | 21 | 65.6 | +5.66 |
| A | ABUK | 15 | 11 | 73.3 | +2.91 |
| A | HRHO | 15 | 11 | 73.3 | +5.28 |
| A | ORAS | 21 | 14 | 66.7 | +6.99 |
| A | AMOC | 14 | 9 | 64.3 | +0.24 |
| A | MFPC | 14 | 9 | 64.3 | −0.72 |
| A | SWDY | 22 | 11 | 50.0 | −1.46 |
| A | ORWE | 26 | 12 | 46.2 | −3.05 |
| A | MASR | 23 | 14 | 60.9 | −0.26 |
| A | ELEC | 12 | 7 | 58.3 | −2.43 |
| A | EGCH | 15 | 6 | 40.0 | −6.93 |
| B | PHDC | 94 | 47 | 50.0 | −0.48 |
| B | CCAP | 61 | 32 | 52.5 | +3.61 |
| B | ADIB | 87 | 49 | 56.3 | +4.45 |
| B | SKPC | 75 | 44 | 58.7 | +7.61 |
| B | JUFO | 67 | 37 | 55.2 | −6.40 |
| B | OCDI | 105 | 57 | 54.3 | +2.60 |
| B | AMER | 46 | 25 | 54.3 | +15.92 |
| B | CIEB | 51 | 22 | 43.1 | −11.85 |
| B | MTIE | 69 | 44 | 63.8 | −0.17 |
| B | LCSW | 39 | 18 | 46.2 | −7.23 |

**Pooled: n = 973, wins = 537, win rate 55.2%, Total R +18.43 (+0.019R per trade), charts with R > 0: 13/25 (52%). High trust band: n = 529, win rate 56.9%, R +5.71.**

| Pass rule | Result | Met |
|---|---|---|
| Win rate ≥ 80% | 55.2% | ✗ |
| Total R > 0 after costs | +18.43R | ✓ |
| n ≥ 30 | 973 | ✓ |
| ≥ 60% of charts (n ≥ 5) with R > 0 | 52% | ✗ |
| Fallback: a trust band ≥ 80% on n ≥ 30 | High 56.9% | ✗ |

**Round 1: FAIL.** The out-of-sample win rate (55.2%) matches the Tuning one (56.0%), so the settings did not overfit. The system is simply a ~55% system, with an edge per trade close to zero after costs.
