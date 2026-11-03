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

(filled in after the runs)
