# ICT Script — Runner Re-test on a Larger Fresh Set (batch F)

**Why:** the runner pick r4 failed batch E on breadth (4/8 charts) and one stock (DAPH) carried its whole lift. Ten stocks is a small sample, so this re-tests the **same code and the same two configs** on 20 more never-opened stocks. **This test is final:** if r4 fails here, the runner settings are dropped for good and not re-tested again.
**Script:** `src/ict-rsi-ma-indicator.pine` at `752b9a2`, no code change.
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (round `runner`, set `batchF`).

## Protocol (declared before any read)

**Settings:** daily, Long Trades Only on, Apply Costs on (0.1%/side + 2 EGP/order, position 100,000), Min Risk (ticks) 10, otherwise defaults. Only the pullback model trades. Win = net R > 0. Full history, Tuning + Test summed.

**Configs:** `base` (Runner off, Trailing Tier Internal, Trail From Entry off) and `r4` (Runner on, Trailing Tier Major, Trail From Entry on). Nothing else.

**Batch F, picked mechanically:** the 38 EGX70 names never opened in any test, in `EGX70_LIST` order (COSG, which is on the user's chart, and AIHC, which has no TradingView data, are excluded). Take the **first 20**:
ATLC, ARAB, AMIA, AIDC, ASCM, ASPI, AIFI, POUL, CSAG, PRCL, CNFN, DSCW, EGTS, MPRC, ETRS, OBRI, ELSH, NIPH, UEGC, ZEOT.
A symbol with no TradingView data is replaced by the next name in that order.
**Held back, unopened, for a later new-entry test:** GDWA, GOUR, GPIM, IEEC, ICFC, IDRE, ISMA, MPCO, MEPA, MPCI, MBSC, OFH, PRDC, SIPC, SDTI, MOED, VALU, UNIP (minus any used as replacements).

**r4 passes only if all four hold:**
1. r4 avg R > 0 after costs.
2. r4 beats base by ≥ +0.03R per trade.
3. ≥ 60% of charts (n ≥ 5) have r4 R > 0.
4. **New, because of DAPH:** the lift stays ≥ 0 after removing the one chart with the largest r4 − base Total R difference, so no single stock can carry the result.

The baseline's own result on batch F is reported too, as a third out-of-sample read of the plain model (after D +0.084 and E +0.092).

## Results

All 20 symbols loaded; no replacements were needed, so all 18 held-back names are still unopened.

| Chart | Baseline n / wins / R | r4 n / wins / R | r4 − base |
|---|---|---|---|
| ATLC | 19 / 6 / +2.90 | 17 / 5 / +1.33 | −1.57 |
| ARAB | 13 / 8 / +1.35 | 11 / 6 / +0.14 | −1.20 |
| AMIA | 19 / 14 / +18.35 | 9 / 5 / +10.35 | −8.00 |
| AIDC | 2 / 2 / +2.46 | 2 / 2 / +2.16 | −0.30 |
| ASCM | 47 / 21 / +15.60 | 37 / 14 / +10.88 | −4.72 |
| ASPI | 14 / 5 / +4.05 | 11 / 4 / +2.67 | −1.39 |
| AIFI | 7 / 5 / +7.01 | 4 / 4 / +6.79 | −0.22 |
| POUL | 15 / 9 / +5.21 | 11 / 5 / +6.26 | +1.05 |
| CSAG | 63 / 26 / +5.64 | 52 / 17 / +10.01 | +4.37 |
| PRCL | 59 / 27 / +9.89 | 49 / 15 / +7.47 | −2.42 |
| CNFN | 18 / 2 / −13.77 | 16 / 2 / −9.08 | +4.69 |
| DSCW | 6 / 4 / +1.14 | 6 / 3 / +0.06 | −1.08 |
| EGTS | 40 / 25 / +18.33 | 27 / 19 / +23.64 | +5.31 |
| MPRC | 64 / 31 / +30.84 | 52 / 23 / +29.72 | −1.12 |
| ETRS | 25 / 10 / −3.95 | 21 / 5 / −7.50 | −3.55 |
| OBRI | 36 / 15 / +9.17 | 23 / 11 / +12.49 | +3.32 |
| ELSH | 42 / 20 / +13.27 | 30 / 13 / +27.48 | **+14.21** |
| NIPH | 71 / 26 / +3.51 | 50 / 19 / +11.89 | +8.38 |
| UEGC | 10 / 5 / +2.80 | 7 / 4 / +2.81 | +0.01 |
| ZEOT | 34 / 16 / +12.72 | 21 / 11 / +15.84 | +3.12 |
| **Pooled** | **604 / 45.9% / +0.243R per trade (+146.52R)**, 17/19 charts R>0 | **456 / 41.0% / +0.363R per trade (+165.40R)**, 16/18 charts R>0 | **+18.88R** |

| Pass rule | Result | Met |
|---|---|---|
| 1. r4 avg R > 0 after costs | +0.363 | ✓ |
| 2. Beats base by ≥ +0.03R per trade | +0.120 | ✓ |
| 3. ≥ 60% of charts (n ≥ 5) with R > 0 | 16/18 = 89% | ✓ |
| 4. Lift ≥ 0 without the biggest-difference chart (ELSH) | r4 +0.324 (426) vs base +0.237 (562): +0.087 | ✓ |

**Verdict: PASS** by the pre-declared rules.

**What the pass does and doesn't mean (read before switching it on):**
- **The per-trade lift is partly arithmetic.** r4 takes 25% fewer trades, because a runner occupies the trade slot longer. In total profit the gain is smaller: +165.4R vs +146.5R, about +13%.
- **It is not better on most stocks.** r4 beat the baseline on 9 of 20 charts and lost on 11. It wins overall because its gains are bigger than its losses (ELSH +14.2, NIPH +8.4 against AMIA −8.0, ASCM −4.7), which is how runners are meant to work.
- **The win rate drops** from 45.9% to 41.0%. Expect more losing trades in a row.
- Batch E agrees on total R (+27.8 vs +25.5) but not on breadth. Across E and F together (30 stocks): base 880 trades, +172.1R (+0.196 per trade); r4 661 trades, +193.2R (+0.292 per trade).

**The plain model, third fresh read:** +0.243R per trade on 604 trades, 17/19 charts positive. Across all three fresh batches (D, E, F; 40 stocks, 1,277 trades): **+0.161R per trade after costs**.
