# ICT Script — EGX100 Full-History Backtest: Why Stops Get Hit Before the Move

**Asked (2026-11-20):** backtest the ICT indicator on the full history of every EGX100 stock, find
out why most losing trades are stopped out and then the stock goes up, and find which extra
indicators (if any) fix it. Backtests run by Sonnet 5.5 agents, reviewed by Opus 5.5.

**Method change from earlier rounds:** earlier validations read results live from TradingView one
chart at a time. That cannot reach 100 stocks or look at price *after* an exit. This round uses an
offline Node port of the engine (`tools/backtest/`), which is only trusted after it reproduces the
per-chart TradingView results already on file (`2026-11-02-egx-trust-raw-results.tsv`, rounds
`ict`/`runner`, configs `base`/`r4`). Fidelity table: `tools/backtest/README.md`.

## Protocol (declared before any backtest result was read)

**Base config:** daily, Long Trades Only on, Apply Costs on (0.1%/side + 2 EGP/order, position
100,000), Min Risk (ticks) 10, everything else default — the same "plain model" as batches D/E/F.
Win = net R > 0. Scale-out in thirds, as always.

**Data split.**
- **Holdout H (symbols):** the 18 EGX70 names never opened in any earlier test — GDWA, GOUR, GPIM,
  IEEC, ICFC, IDRE, ISMA, MPCO, MEPA, MPCI, MBSC, OFH, PRDC, SIPC, SDTI, MOED, VALU, UNIP. Their
  trades are not looked at until the final check.
- **Discovery:** all other EGX100 names, trades entered **before 2023-01-01**. All diagnosis and
  all candidate selection happen here only.
- **Validation T (time):** the same non-holdout names, trades entered **on or after 2023-01-01**.

**Failure taxonomy (descriptive, discovery only).** For every losing trade:
- *Stopped then recovered:* closed at the initial stop with no target hit, and within 20 bars
  after the stop bar the high reached the trade's TP1. Also report "reached entry + 1R" and the
  recovery rate at 5 / 10 / 20 / 40 bars.
- *Undershoot:* lowest low between the stop bar and the recovery, measured in R below the stop:
  how much wider the stop would have had to be to survive.
- *Never worked:* no recovery to TP1 within 40 bars.
- Stop context: risk in ATR, stop distance below the nearest prior swing low, gap-through-stop
  (open below stop), stop at a round number, the EGX daily price-limit move on the stop bar, index
  (EGX30) trend at entry, bars from zone creation to entry.

**Candidates (fixed list; nothing outside it is tested on discovery).**
- Stop placement: (S1) stop − k×ATR(14) for k ∈ {0.25, 0.5, 1.0}; (S2) stop below the most recent
  confirmed swing low; (S3) stop only on a daily close below the stop.
- Re-entry: (R1) after a stop-out, re-enter if a bar closes back above the old stop within 5
  bars (liquidity-sweep re-entry), stop under the sweep low.
- Entry filters, measured at the entry bar: RSI(14) band, ADX(14) ≥ 20, close > SMA200,
  EGX30 > its SMA50, 60-bar relative strength vs EGX30 > 0, volume / SMA20(volume),
  distance from SMA20 in ATRs (overextension), weekly close > 30-week SMA, CMF(20) > 0, MFI(14) band.
  Any rule is a single threshold chosen on discovery.

**Pick rule (discovery).** At most **three** candidates go forward: those lifting discovery avg R
by ≥ +0.03R per trade **and** keeping total R ≥ 90% of the base's, ranked by total R lift.
Every candidate is run through the engine (stops and re-entries change the trade path; filters
free the trade slot), never just by deleting rows from the base trade list.

**Pass rule (each picked candidate, judged separately on T and on H; must pass both).**
1. Avg R > 0 after costs.
2. Beats the base on the same set by ≥ +0.03R per trade.
3. Total R ≥ 90% of the base's on the same set.
4. ≥ 60% of charts (n ≥ 5) have R > 0.
5. The lift stays ≥ 0 after removing the one chart with the largest candidate − base Total R gap.

## Amendment 1 (2026-11-20, after the Opus port review, before any discovery result was read)

The Opus review of the port found no engine bug, but found two data facts that bear directly on
"stopped out, then it went up":
- **Synthetic opens since 2018.** On TradingView EGX data, open = previous close on 80–100% of bars
  from 2018 on, and on 39% of up days the low equals the previous close exactly. So a bar's low can
  be a price that never traded, and a stop just under the previous close is "hit" by a phantom wick.
- **The 10-tick floor is an adjustment artefact** on old, heavily adjusted prices (ELEC never
  trades; EAST loses most of its pre-2024 trades).

Added before any result was read:
- **Taxonomy:** the share of initial-stop exits whose stop bar is a *phantom touch* (open within one
  tick of the previous close, low within one tick of the open, close above the stop), by era
  (pre-2012 / 2012–17 / 2018+), and their recovery rate vs real stop-outs.
- **Candidate S4 (phantom-wick guard):** on a bar whose low equals its synthetic open (both
  conditions above), the stop is tested against the close instead of the low.
- **Sensitivity (not a candidate):** the base re-run with a scale-free floor (risk ≥ 0.5% of price
  instead of 10 ticks), and with 0.3%/side costs instead of 0.1%.
- **Look-ahead guard:** the logged `riskAtr` is measured on the exit bar (faithful to Pine's
  `logTrade`), so as an entry feature it must be recomputed at the entry bar.

## Picks (recorded 2026-11-20 from discovery, before any T or H trade was read)

Discovery detail: `2026-11-20-egx100-discovery-results.md`. Base on discovery (82 names, pre-2023,
splits-only data): 2,225 trades, 39.3% win, +0.029R/trade.

1. **S3 — stop on close:** `{"preset":"tv-base","stopOnCloseOnly":true}` (the existing Pine input).
2. **S2 — stop under the newest internal swing low:** `{"preset":"tv-base","stopSwingTier":"Internal"}`.
3. **S1 — stop 1 ATR wider:** `{"preset":"tv-base","stopExtraAtr":1}`.

All three are one mechanism (letting the trade survive its first days), not three findings. Volume
ratio ≥ 0.8 qualified but ranked fourth; no other indicator filter qualified. Each pick is judged
separately on T and on H by the five pass rules above. Added check (sizing-independent, reported
but not judged): avg net return per trade in % of price, because a wider stop makes 1R a larger
money amount under fixed-notional sizing.

## Results

Run `2026-11-20` by `tools/backtest/validate-picks.mjs` (engine `ict-engine.mjs` unmodified; picks, thresholds and the five rules exactly as written above; nothing re-tuned). Main data: `data/egx` (split-adjusted only, 100 symbols: 82 non-holdout + 18 holdout), preset `tv-base` plus the one override per pick.

Reproduce: `node tools/backtest/validate-picks.mjs --data data/egx --sens --full` (main + 0.3%/side sensitivity); `--data data/egx-div --full --sens` (dividend-adjusted side check, 15 symbols); `--data data/egx --like data/egx-div --full` (the same 15 symbols on the main feed).

**Definitions used by the script.** T = the 82 non-holdout names, closed trades whose signal bar is on/after 2023-01-01 (trades opened before 2023 are discovery even if they closed later). H = the 18 holdout names, every closed trade over full history. Win = net R > 0. "Charts R>0" = charts with n >= 5 trades whose total R > 0, each pick judged on its own charts. **Net return per trade (% of entry price) = R x risk%, where risk% = |entry - initial stop| / entry** (R is already net of costs, so the product is net of costs and sums the thirds/legs as the engine accounts for them); this is the money-per-trade figure under a fixed notional position, independent of what "1R" is. "Still open" = trades still open at the end of the data (they are not in any figure; the engine reports closed trades only). Rule 3 is applied literally (total R >= 0.9 x base total R). Rule 5 recomputes avg-R lift (pick avg - base avg, per trade) after deleting the one chart with the largest (pick - base) total-R gap from both.

### Headline verdict (mechanical)

| pick | T (82 names, opened >= 2023) | H (18 holdout names) | overall (must pass both) |
|---|---|---|---|
| S3 stop on close (`stopOnCloseOnly`) | PASS (5/5) | PASS (5/5) | **PASS** |
| S2 stop under newest internal swing low (`stopSwingTier: Internal`) | PASS (5/5) | PASS (5/5) | **PASS** |
| S1 stop 1 ATR wider (`stopExtraAtr: 1`) | FAIL, rule 2 (lift +0.014 vs required +0.030) | PASS (5/5) | **FAIL** |

Pass grid, by rule (pass/FAIL, value):

| set | pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart |
|---|---|---|---|---|---|---|
| T | S3 | pass 0.303 | pass +0.087 | pass 290.0 vs 196.8 | pass 55/76 (72%) | pass +0.066 (ex NCCW) |
| T | S2 | pass 0.310 | pass +0.094 | pass 299.8 vs 196.8 | pass 70/80 (88%) | pass +0.080 (ex EHDR) |
| T | S1 | pass 0.231 | **FAIL +0.014** | pass 302.8 vs 196.8 | pass 62/81 (77%) | pass +0.001 (ex EHDR) |
| H | S3 | pass 0.372 | pass +0.195 | pass 160.5 vs 74.5 | pass 11/15 (73%) | pass +0.152 (ex MBSC) |
| H | S2 | pass 0.298 | pass +0.121 | pass 133.8 vs 74.5 | pass 15/16 (94%) | pass +0.105 (ex UNIP) |
| H | S1 | pass 0.303 | pass +0.125 | pass 176.4 vs 74.5 | pass 15/16 (94%) | pass +0.102 (ex ISMA) |

What the numbers say, and do not say:
- S3 and S2 pass both sets on all five rules. S1 fails T on rule 2 only: on T the base is already strong (+0.217R), so a +1 ATR stop adds many extra trades (1313 vs 1010) and total R (+84) but only +0.014R per trade.
- The base itself is much better on T (+0.217R) and H (+0.178R) than on discovery (+0.029R, 2001-2022). T is 2023-26, a period of strong nominal EGX gains and currency devaluation; H is full history of 18 names. So the base's own edge differs a lot by period/sample, and the lift of the stop variants over the base is smaller on T (+0.09R) than on discovery (+0.15 to +0.175R) and on H (+0.12R to +0.195R) -- same sign everywhere, different size. Standard error of an avg R here is about 0.03-0.04R (discovery); the T lift of S1 (+0.014) is inside one standard error of zero.
- The three picks are one mechanism (surviving the first days), not three findings. S2 does it with much wider stops: its average initial risk is 18.3% of entry price on T and 23.3% on H (base 7.5% and 9.2%), and its net return per trade (5.0% on T, 6.6% on H) is about 3 to 4 times the base's (1.6% on both) -- but with R measured against a much larger stop, so that figure only holds under fixed-notional sizing; under fixed risk-per-trade sizing the S2 position is correspondingly smaller. See the per-config "avg initial risk" column in the pooled tables.
- Rules 3, 4 and 5 never bind in the main data: every pick has total R far above 90% of base, the lift survives removal of its largest-gap chart (S3 by 0.07 to 0.15R, S2 by 0.08 to 0.11R), and rule 4 is weak because the base itself already has 72% (T) and 73% (H) of charts positive.


## Pooled results and per-chart tables (main verdict data)

### Data: `data\egx`

Symbols loaded: 100 (82 non-holdout, 18 holdout). 

#### T: 82 non-holdout names, trades opened on/after 2023-01-01 (0.1%/side costs)

Symbols in set: 82. Base closed trades: 1010.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 1010 | 46.8% | 0.217 | 218.69 | 55/76 (72%) | 1.59% | 7.52% | 6 |
| S3 stop on close | 957 | 49.6% | 0.303 | 290.03 | 55/76 (72%) | 2.15% | 7.52% | 6 |
| S2 swing-low (Internal) | 966 | 48.2% | 0.310 | 299.84 | 70/80 (88%) | 5.03% | 18.32% | 11 |
| S1 stop +1 ATR | 1313 | 46.9% | 0.231 | 302.80 | 62/81 (77%) | 2.01% | 9.54% | 9 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.303) | pass (+0.087) | pass (290.03 vs 196.82) | pass (55/76 = 72%) | pass (+0.066 without NCCW, gap +19.97R) | **PASS** |
| S2 swing-low (Internal) | pass (0.310) | pass (+0.094) | pass (299.84 vs 196.82) | pass (70/80 = 88%) | pass (+0.080 without EHDR, gap +14.27R) | **PASS** |
| S1 stop +1 ATR | pass (0.231) | FAIL (+0.014) | pass (302.80 vs 196.82) | pass (62/81 = 77%) | pass (+0.001 without EHDR, gap +14.06R) | **FAIL** |

<details><summary>Per-chart n / wins / total R, T: 82 non-holdout names, trades opened on/after 2023-01-01 (0.1%/side costs)</summary>

| symbol | base | S3 stop on close | S2 swing-low (Internal) | S1 stop +1 ATR |
|---|---|---|---|---|
| ABUK | 14/6/6.56 | 14/5/3.66 | 12/6/1.30 | 17/8/8.27 |
| ACTF | 5/0/-4.81 | 5/0/-5.93 | 5/0/-2.57 | 5/0/-3.38 |
| ADIB | 21/13/11.41 | 20/13/15.10 | 13/10/8.16 | 20/14/7.86 |
| AIDC | 2/2/2.46 | 2/2/4.07 | 3/2/2.25 | 5/5/7.77 |
| AIFI | 7/5/7.01 | 7/5/6.56 | 8/5/6.54 | 9/6/9.58 |
| ALCN | 18/7/0.42 | 16/6/1.11 | 13/5/-0.45 | 22/5/-8.71 |
| AMER | 11/7/8.36 | 11/7/7.23 | 11/7/9.55 | 12/10/12.34 |
| AMIA | 17/12/19.62 | 17/12/18.92 | 13/7/7.11 | 20/13/9.83 |
| AMOC | 10/5/-1.67 | 8/5/6.47 | 10/3/-0.43 | 16/5/-4.72 |
| ARAB | 10/6/1.96 | 10/6/0.22 | 12/8/4.18 | 13/8/2.25 |
| ARCC | 13/7/7.47 | 12/6/4.44 | 18/8/5.03 | 25/11/3.67 |
| ASCM | 8/5/6.14 | 8/5/6.09 | 11/5/3.96 | 14/8/7.77 |
| ASPI | 11/4/4.54 | 11/4/3.50 | 12/5/4.49 | 17/7/4.88 |
| ATLC | 13/4/0.03 | 13/5/3.06 | 14/4/0.07 | 16/6/1.72 |
| ATQA | 14/6/1.71 | 14/6/-2.05 | 13/8/7.54 | 19/9/4.37 |
| BONY | 2/0/-2.06 | 2/0/-2.56 | 1/1/1.27 | 3/1/-0.10 |
| BTFH | 10/1/-5.21 | 10/1/-8.16 | 12/6/2.81 | 15/5/2.06 |
| CCAP | 11/6/1.43 | 11/6/-0.34 | 13/6/1.13 | 17/7/1.75 |
| CIEB | 12/3/-8.74 | 12/3/-9.44 | 12/2/-3.16 | 16/4/-4.38 |
| CLHO | 18/8/-2.65 | 17/7/-4.36 | 15/7/2.19 | 18/9/2.11 |
| CNFN | 13/2/-9.83 | 11/2/-6.05 | 11/3/-2.04 | 13/3/-4.95 |
| COMI | 12/7/9.83 | 12/7/8.79 | 15/6/1.14 | 20/10/6.75 |
| COSG | 7/2/-2.71 | 7/2/-2.87 | 10/5/2.03 | 9/4/0.95 |
| CSAG | 12/3/-4.61 | 12/4/-1.64 | 15/6/0.47 | 18/6/-3.78 |
| DAPH | 13/3/-0.65 | 13/3/-2.48 | 10/5/5.75 | 15/7/5.59 |
| DSCW | 4/2/0.64 | 4/2/0.64 | 7/4/2.32 | 8/5/2.86 |
| EAST | 12/6/1.69 | 11/7/4.78 | 10/7/5.45 | 18/13/12.28 |
| EFID | 16/8/-0.18 | 13/8/8.66 | 13/6/-0.35 | 19/10/-2.60 |
| EFIH | 15/6/1.75 | 14/6/1.12 | 12/6/2.50 | 17/8/5.28 |
| EGAL | 16/10/6.21 | 15/10/6.00 | 13/7/1.95 | 22/11/5.74 |
| EGCH | 14/5/-1.68 | 14/5/-1.97 | 14/6/4.42 | 17/7/6.38 |
| EGTS | 12/8/6.72 | 12/7/4.10 | 13/6/3.82 | 20/9/1.44 |
| EHDR | 10/0/-9.97 | 10/0/-11.53 | 9/4/4.30 | 12/6/4.08 |
| ELEC | 7/2/-0.73 | 7/2/-1.29 | 12/4/0.59 | 13/3/-4.04 |
| ELKA | 5/1/-2.54 | 5/1/-3.21 | 9/5/2.70 | 10/2/-4.48 |
| ELSH | 11/6/8.08 | 11/6/7.38 | 10/5/1.24 | 15/6/3.40 |
| EMFD | 14/7/4.35 | 13/8/6.13 | 13/7/1.02 | 20/9/4.47 |
| ENGC | 16/7/9.09 | 15/7/11.99 | 14/9/9.85 | 16/10/10.00 |
| ETEL | 20/12/11.92 | 19/12/13.14 | 13/8/7.50 | 21/13/13.67 |
| ETRS | 12/5/-0.34 | 11/5/2.11 | 12/5/0.66 | 15/7/1.18 |
| EXPA | 14/7/7.27 | 14/7/5.73 | 11/6/5.95 | 17/10/5.70 |
| FWRY | 13/5/-4.77 | 12/6/-0.77 | 11/4/1.68 | 15/7/1.67 |
| GBCO | 15/7/0.50 | 15/6/-0.51 | 12/9/7.16 | 24/14/2.66 |
| HDBK | 17/11/17.41 | 16/11/17.45 | 13/6/5.76 | 16/10/15.20 |
| HELI | 8/5/3.11 | 8/6/6.34 | 12/6/0.52 | 14/4/-4.19 |
| HRHO | 16/5/-6.45 | 13/6/1.96 | 14/6/-1.37 | 16/7/-2.80 |
| ISMQ | 13/7/5.50 | 12/8/10.18 | 15/7/7.99 | 19/9/9.18 |
| ISPH | 15/7/5.72 | 15/6/3.26 | 12/7/6.87 | 17/9/9.47 |
| JUFO | 13/7/4.14 | 12/8/7.83 | 11/5/6.07 | 18/10/9.72 |
| KABO | 20/11/2.95 | 19/10/1.37 | 13/8/9.87 | 18/9/6.79 |
| LCSW | 12/5/-0.65 | 11/5/-2.10 | 12/5/-0.60 | 20/7/-3.58 |
| MASR | 14/6/3.33 | 14/7/6.69 | 15/7/0.44 | 20/7/-1.18 |
| MCQE | 20/12/7.67 | 17/13/12.69 | 12/5/4.67 | 19/11/5.40 |
| MCRO | 3/3/2.74 | 3/3/2.44 | 7/2/0.43 | 6/2/-1.42 |
| MFPC | 12/4/1.09 | 12/5/2.54 | 11/4/2.27 | 16/6/0.41 |
| MPRC | 13/7/10.94 | 12/7/10.99 | 14/6/5.38 | 19/7/8.13 |
| MTIE | 11/6/1.77 | 11/5/0.12 | 12/7/0.55 | 18/8/0.08 |
| NCCW | 10/3/-2.31 | 8/5/17.66 | 14/7/8.40 | 15/6/9.40 |
| NIPH | 19/7/0.51 | 18/7/-0.38 | 13/5/1.66 | 20/7/-3.45 |
| OBRI | 8/6/10.78 | 8/6/10.50 | 11/7/9.81 | 11/9/17.38 |
| OCDI | 16/8/6.08 | 15/7/6.01 | 15/7/2.26 | 20/8/2.82 |
| OIH | 2/1/-0.71 | 2/1/-0.99 | 7/4/3.58 | 5/4/2.60 |
| ORAS | 16/10/8.13 | 16/11/12.46 | 15/12/10.18 | 25/17/19.25 |
| ORHD | 12/8/9.50 | 12/9/10.09 | 13/6/3.95 | 20/11/5.49 |
| ORWE | 16/4/-7.92 | 12/3/-4.82 | 14/3/-4.38 | 20/3/-11.28 |
| PHAR | 15/9/9.46 | 13/10/13.67 | 14/8/10.65 | 23/14/11.74 |
| PHDC | 19/9/2.58 | 19/9/3.94 | 14/8/5.51 | 20/9/1.10 |
| POUL | 12/7/1.99 | 11/5/2.58 | 16/10/10.64 | 19/10/11.75 |
| PRCL | 13/7/3.73 | 9/7/14.89 | 10/6/8.27 | 13/8/9.10 |
| RAYA | 11/8/10.34 | 9/7/10.90 | 11/7/5.55 | 16/9/2.42 |
| RMDA | 12/6/3.97 | 12/6/3.25 | 13/7/10.75 | 14/7/7.86 |
| SCEM | 10/5/2.63 | 10/5/0.75 | 10/6/5.36 | 15/7/1.64 |
| SKPC | 14/8/5.32 | 13/7/5.44 | 8/3/0.84 | 15/6/-1.38 |
| SVCE | 11/6/4.00 | 11/6/2.83 | 14/7/2.37 | 17/8/1.73 |
| SWDY | 17/8/0.57 | 17/8/1.05 | 14/7/6.63 | 21/10/9.93 |
| TAQA | 9/3/0.74 | 8/4/0.86 | 10/4/3.72 | 12/4/2.95 |
| TMGH | 15/6/3.48 | 15/6/1.67 | 11/3/2.71 | 16/7/6.11 |
| UEGC | 6/2/-0.28 | 6/2/-0.58 | 9/4/1.55 | 9/4/-0.16 |
| VLMR | 4/0/-4.12 | 4/0/-5.68 | 6/0/-3.54 | 7/0/-6.30 |
| VLMRA | 17/5/1.46 | 15/4/-0.15 | 11/3/4.14 | 13/4/0.08 |
| ZEOT | 14/6/3.33 | 14/6/2.84 | 15/7/6.50 | 20/8/7.23 |
| ZMID | 15/7/2.13 | 15/7/3.69 | 15/6/2.78 | 18/9/4.39 |

</details>

#### H: 18 holdout names, full history (0.1%/side costs)

Symbols in set: 18. Base closed trades: 466.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 466 | 44.0% | 0.178 | 82.74 | 11/15 (73%) | 1.57% | 9.15% | 0 |
| S3 stop on close | 431 | 48.7% | 0.372 | 160.53 | 11/15 (73%) | 3.02% | 9.34% | 0 |
| S2 swing-low (Internal) | 449 | 47.2% | 0.298 | 133.83 | 15/16 (94%) | 6.55% | 23.27% | 2 |
| S1 stop +1 ATR | 582 | 47.8% | 0.303 | 176.37 | 15/16 (94%) | 3.08% | 12.05% | 2 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.372) | pass (+0.195) | pass (160.53 vs 74.47) | pass (11/15 = 73%) | pass (+0.152 without MBSC, gap +28.29R) | **PASS** |
| S2 swing-low (Internal) | pass (0.298) | pass (+0.121) | pass (133.83 vs 74.47) | pass (15/16 = 94%) | pass (+0.105 without UNIP, gap +11.88R) | **PASS** |
| S1 stop +1 ATR | pass (0.303) | pass (+0.125) | pass (176.37 vs 74.47) | pass (15/16 = 94%) | pass (+0.102 without ISMA, gap +23.04R) | **PASS** |

<details><summary>Per-chart n / wins / total R, H: 18 holdout names, full history (0.1%/side costs)</summary>

| symbol | base | S3 stop on close | S2 swing-low (Internal) | S1 stop +1 ATR |
|---|---|---|---|---|
| GDWA | 15/6/-1.99 | 14/6/-0.82 | 14/7/3.15 | 17/8/6.10 |
| GOUR | 3/2/1.77 | 3/2/2.36 | 2/1/0.49 | 3/2/1.76 |
| GPIM | 3/2/2.72 | 3/2/2.55 | 6/4/4.86 | 5/3/3.82 |
| ICFC | 22/12/6.08 | 19/10/8.85 | 24/10/8.02 | 24/10/5.42 |
| IDRE | 42/18/12.23 | 34/20/32.16 | 36/15/6.10 | 47/23/12.95 |
| IEEC | 15/10/7.43 | 15/10/6.57 | 15/10/4.34 | 22/12/8.13 |
| ISMA | 39/16/5.81 | 37/14/2.97 | 47/21/12.01 | 59/32/28.86 |
| MBSC | 90/45/30.88 | 81/48/59.17 | 63/38/35.52 | 92/49/50.50 |
| MEPA | 9/3/0.14 | 8/3/2.66 | 13/6/6.91 | 11/5/3.92 |
| MOED | 32/10/4.23 | 30/12/12.42 | 28/12/15.01 | 43/15/5.51 |
| MPCI | 59/28/13.53 | 56/28/21.24 | 52/22/17.04 | 70/36/26.21 |
| MPCO | 4/2/0.92 | 4/2/0.56 | 18/6/2.03 | 13/5/2.30 |
| OFH | 22/9/7.34 | 22/8/5.13 | 14/11/6.01 | 25/14/9.32 |
| PRDC | 17/5/-2.83 | 15/5/-2.66 | 18/7/-1.74 | 25/9/-1.57 |
| SDTI | 53/20/-2.47 | 50/23/7.95 | 45/20/6.84 | 61/25/4.17 |
| SIPC | 14/6/2.02 | 14/5/1.08 | 21/7/1.25 | 27/10/0.59 |
| UNIP | 22/9/-5.87 | 21/10/-1.40 | 30/14/6.01 | 34/18/6.50 |
| VALU | 5/2/0.81 | 5/2/-0.26 | 3/1/-0.00 | 4/2/1.89 |

</details>

#### Informational: 82 non-holdout names, FULL history (includes discovery period)

Symbols in set: 82. Base closed trades: 3235.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 3235 | 41.7% | 0.087 | 282.80 | 50/78 (64%) | 0.92% | 7.61% | 6 |
| S3 stop on close | 2979 | 47.2% | 0.236 | 701.73 | 64/78 (82%) | 1.89% | 7.66% | 6 |
| S2 swing-low (Internal) | 3254 | 44.5% | 0.221 | 718.89 | 75/80 (94%) | 4.17% | 19.50% | 11 |
| S1 stop +1 ATR | 4124 | 43.7% | 0.158 | 650.31 | 64/81 (79%) | 1.61% | 9.99% | 9 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.236) | pass (+0.148) | pass (701.73 vs 254.52) | pass (64/78 = 82%) | pass (+0.141 without MCQE, gap +29.67R) | **PASS** |
| S2 swing-low (Internal) | pass (0.221) | pass (+0.134) | pass (718.89 vs 254.52) | pass (75/80 = 94%) | pass (+0.126 without EAST, gap +30.62R) | **PASS** |
| S1 stop +1 ATR | pass (0.158) | pass (+0.070) | pass (650.31 vs 254.52) | pass (64/81 = 79%) | pass (+0.065 without SWDY, gap +26.95R) | **PASS** |

<details><summary>Per-chart n / wins / total R, Informational: 82 non-holdout names, FULL history (includes discovery period)</summary>

| symbol | base | S3 stop on close | S2 swing-low (Internal) | S1 stop +1 ATR |
|---|---|---|---|---|
| ABUK | 83/26/-4.64 | 72/25/0.59 | 74/32/15.40 | 95/38/4.09 |
| ACTF | 5/0/-4.81 | 5/0/-5.93 | 5/0/-2.57 | 5/0/-3.38 |
| ADIB | 72/29/-8.24 | 63/33/10.24 | 60/31/15.96 | 79/37/12.56 |
| AIDC | 2/2/2.46 | 2/2/4.07 | 3/2/2.25 | 5/5/7.77 |
| AIFI | 7/5/7.01 | 7/5/6.56 | 11/7/6.63 | 9/6/9.58 |
| ALCN | 45/19/6.40 | 42/18/3.41 | 50/26/10.73 | 55/19/-5.84 |
| AMER | 22/11/6.61 | 22/12/10.55 | 28/11/8.69 | 29/16/11.70 |
| AMIA | 26/17/22.92 | 26/17/22.00 | 35/13/5.14 | 44/22/14.27 |
| AMOC | 46/17/-3.36 | 41/20/8.84 | 47/18/6.46 | 64/22/-3.06 |
| ARAB | 13/8/2.91 | 12/8/3.01 | 22/11/1.84 | 19/10/1.52 |
| ARCC | 31/14/4.49 | 30/13/4.58 | 36/14/7.76 | 57/22/2.92 |
| ASCM | 48/21/14.96 | 46/20/12.50 | 47/18/11.84 | 57/23/21.02 |
| ASPI | 14/5/4.05 | 14/5/2.45 | 18/7/5.32 | 23/8/3.18 |
| ATLC | 27/8/-7.25 | 25/7/-6.09 | 23/8/-0.29 | 27/11/1.56 |
| ATQA | 22/11/4.82 | 21/10/2.68 | 29/14/11.13 | 36/14/4.41 |
| BONY | 2/0/-2.06 | 2/0/-2.56 | 1/1/1.27 | 3/1/-0.10 |
| BTFH | 28/10/1.23 | 26/9/-4.60 | 33/13/5.51 | 41/14/6.59 |
| CCAP | 28/13/8.70 | 25/13/6.22 | 39/12/2.50 | 47/16/-1.50 |
| CIEB | 56/20/-11.06 | 52/20/0.31 | 48/17/2.97 | 66/22/-5.86 |
| CLHO | 40/16/-3.26 | 37/17/3.92 | 30/12/5.64 | 39/17/8.14 |
| CNFN | 18/2/-14.09 | 16/2/-11.00 | 20/5/-6.37 | 23/5/-11.48 |
| COMI | 71/33/20.52 | 66/32/23.22 | 63/29/14.22 | 90/43/18.04 |
| COSG | 26/9/-3.32 | 25/10/0.38 | 41/17/7.86 | 41/23/12.66 |
| CSAG | 71/24/3.11 | 64/30/31.07 | 64/26/18.22 | 81/36/24.19 |
| DAPH | 69/25/1.73 | 67/30/9.38 | 56/25/8.57 | 80/34/14.03 |
| DSCW | 6/4/1.14 | 6/4/1.00 | 14/7/2.55 | 13/6/-1.02 |
| EAST | 63/24/-9.86 | 50/26/19.00 | 51/30/20.76 | 71/37/16.40 |
| EFID | 33/14/-0.24 | 30/14/11.22 | 27/11/2.59 | 41/17/-7.77 |
| EFIH | 20/8/3.56 | 19/8/2.37 | 14/7/3.19 | 21/11/6.80 |
| EGAL | 80/40/12.46 | 74/39/12.27 | 65/26/2.45 | 93/39/7.00 |
| EGCH | 59/23/-1.58 | 56/22/-2.94 | 61/25/12.11 | 76/28/2.30 |
| EGTS | 40/25/18.33 | 40/23/13.66 | 51/25/5.86 | 62/30/5.64 |
| EHDR | 46/14/-3.12 | 43/16/3.60 | 49/25/17.43 | 60/31/14.06 |
| ELEC | 7/2/-0.73 | 7/2/-1.29 | 17/7/5.18 | 15/5/-0.28 |
| ELKA | 12/2/-7.93 | 10/3/-3.14 | 34/14/0.58 | 27/9/-5.66 |
| ELSH | 46/21/16.06 | 43/20/18.96 | 58/30/21.27 | 75/34/21.91 |
| EMFD | 35/12/-7.83 | 32/13/-7.93 | 32/12/-2.63 | 50/17/-6.78 |
| ENGC | 62/27/5.90 | 58/31/16.65 | 54/30/14.55 | 69/36/16.53 |
| ETEL | 62/27/9.99 | 59/28/14.64 | 47/22/13.38 | 70/35/22.91 |
| ETRS | 40/16/-2.11 | 38/16/-1.92 | 49/20/2.83 | 62/32/10.29 |
| EXPA | 44/19/12.91 | 44/19/10.97 | 56/31/27.74 | 67/33/18.53 |
| FWRY | 24/13/7.93 | 22/14/14.26 | 19/9/7.27 | 27/16/15.09 |
| GBCO | 51/21/7.74 | 46/20/14.28 | 46/23/12.27 | 64/31/12.70 |
| HDBK | 59/27/9.90 | 55/30/22.74 | 60/25/10.53 | 66/33/26.44 |
| HELI | 26/15/7.99 | 26/16/8.93 | 51/22/5.00 | 57/19/-5.31 |
| HRHO | 59/26/3.55 | 54/27/14.30 | 61/29/13.59 | 71/37/16.68 |
| ISMQ | 15/8/4.91 | 14/9/9.59 | 18/7/7.31 | 22/9/8.04 |
| ISPH | 24/8/-2.50 | 24/7/-6.06 | 22/9/3.59 | 29/12/2.27 |
| JUFO | 45/20/7.85 | 38/22/19.84 | 40/19/11.78 | 57/26/16.36 |
| KABO | 41/15/-4.08 | 36/18/6.05 | 47/25/20.02 | 45/20/10.39 |
| LCSW | 53/20/1.38 | 47/22/11.49 | 43/17/3.98 | 61/24/0.48 |
| MASR | 51/23/0.63 | 46/24/17.13 | 53/24/13.74 | 71/31/8.71 |
| MCQE | 84/35/-0.61 | 66/36/29.06 | 62/26/15.02 | 89/38/6.80 |
| MCRO | 4/3/2.07 | 4/3/1.77 | 8/2/0.01 | 7/2/-2.03 |
| MFPC | 33/14/10.89 | 33/15/9.42 | 28/11/7.56 | 37/17/8.80 |
| MPRC | 68/33/22.71 | 65/33/28.15 | 67/32/19.12 | 84/36/16.42 |
| MTIE | 26/11/-4.80 | 26/10/-8.28 | 25/12/-1.88 | 35/15/-0.31 |
| NCCW | 27/8/-5.68 | 24/12/21.42 | 44/17/7.31 | 41/14/7.07 |
| NIPH | 74/28/3.87 | 68/28/8.09 | 52/21/7.26 | 76/28/0.92 |
| OBRI | 35/14/8.90 | 35/15/7.61 | 35/15/7.99 | 43/22/22.75 |
| OCDI | 57/25/8.89 | 53/27/19.84 | 54/29/20.21 | 77/37/26.49 |
| OIH | 3/1/-1.72 | 3/1/-2.13 | 10/5/4.29 | 6/4/1.76 |
| ORAS | 29/15/25.65 | 29/16/28.92 | 30/19/16.46 | 46/26/28.78 |
| ORHD | 38/20/12.91 | 36/24/21.65 | 41/20/16.41 | 49/28/20.55 |
| ORWE | 66/24/-14.22 | 57/26/13.40 | 60/23/6.26 | 84/33/6.67 |
| PHAR | 89/35/-4.77 | 75/39/17.95 | 63/34/25.05 | 98/47/13.07 |
| PHDC | 41/19/11.34 | 40/20/15.23 | 39/20/11.35 | 54/24/7.14 |
| POUL | 23/13/5.68 | 22/12/8.40 | 51/20/11.37 | 44/18/13.94 |
| PRCL | 59/24/4.55 | 52/27/24.14 | 45/23/27.31 | 59/27/26.38 |
| RAYA | 16/8/5.25 | 14/7/4.57 | 25/9/0.37 | 24/10/-4.20 |
| RMDA | 16/7/1.56 | 15/8/3.12 | 21/9/9.70 | 20/9/5.57 |
| SCEM | 65/24/5.28 | 59/26/13.92 | 58/21/4.30 | 79/26/0.72 |
| SKPC | 59/25/-0.98 | 52/24/5.88 | 50/23/7.88 | 68/28/3.28 |
| SVCE | 56/26/12.12 | 55/27/10.68 | 55/28/17.28 | 72/33/8.05 |
| SWDY | 61/24/-4.75 | 57/25/-2.47 | 56/26/18.10 | 83/39/22.20 |
| TAQA | 9/3/0.74 | 8/4/0.86 | 10/4/3.72 | 12/4/2.95 |
| TMGH | 51/18/8.31 | 46/20/18.24 | 38/16/5.38 | 58/22/12.03 |
| UEGC | 12/6/2.41 | 12/6/1.94 | 37/15/4.34 | 28/11/-4.83 |
| VLMR | 65/29/15.39 | 58/29/18.73 | 50/20/5.59 | 66/27/5.54 |
| VLMRA | 21/6/-1.31 | 19/5/-3.48 | 14/4/3.89 | 17/5/-1.01 |
| ZEOT | 36/18/13.26 | 36/18/11.17 | 55/25/6.58 | 60/28/9.92 |
| ZMID | 37/13/-2.21 | 35/13/-1.53 | 49/18/5.01 | 51/21/5.18 |

</details>


## Side checks (not the verdict)

Summary. (1) At 0.3%/side costs the main-data base falls to +0.148R (T) and +0.117R (H); S3 and S2 still pass both sets on all five rules; S1 again fails T on rule 2 (lift +0.029, just under +0.030) and passes H. (2) `data/egx-div` (dividend-adjusted, the feed TradingView charts show) holds only 15 of the 100 symbols (CNFN, COMI, DAPH, EAST, EGCH, ELEC, ELSH, ETEL, FWRY, GBCO, HRHO, MASR, MCQE, ORWE, VLMRA; none are holdout names), so only a T-style check is possible and each chart has few trades. On those 15 names the three picks all pass the five rules on T at 0.1%/side (S3 rule 4 at exactly 9/15 = 60%); on the same 15 names on the splits-only feed S3 fails rule 4 (7/15 = 47%) while S2 and S1 pass. At 0.3%/side on egx-div, S3 fails rule 4 (8/15 = 53%), S2 and S1 pass. The sign and rough size of the lift (+0.07 to +0.26R) do not depend on the adjustment, but the 15-name sets are too small to separate S3 from the 60% line.

### Side check 1: 0.3% slippage per side (commission unchanged) on T and H; the grid is printed for reference, not judged

#### T at 0.3%/side

Symbols in set: 82. Base closed trades: 1010.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 1010 | 46.6% | 0.148 | 149.64 | 49/76 (64%) | 1.19% | 7.52% | 6 |
| S3 stop on close | 957 | 48.6% | 0.235 | 224.78 | 50/76 (66%) | 1.74% | 7.52% | 6 |
| S2 swing-low (Internal) | 966 | 47.5% | 0.279 | 269.78 | 66/80 (83%) | 4.62% | 18.32% | 11 |
| S1 stop +1 ATR | 1313 | 46.8% | 0.177 | 232.56 | 59/81 (73%) | 1.61% | 9.54% | 9 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.235) | pass (+0.087) | pass (224.78 vs 134.67) | pass (50/76 = 66%) | pass (+0.066 without NCCW, gap +19.96R) | **PASS** |
| S2 swing-low (Internal) | pass (0.279) | pass (+0.131) | pass (269.78 vs 134.67) | pass (66/80 = 83%) | pass (+0.117 without EHDR, gap +14.62R) | **PASS** |
| S1 stop +1 ATR | pass (0.177) | FAIL (+0.029) | pass (232.56 vs 134.67) | pass (59/81 = 73%) | pass (+0.016 without EHDR, gap +14.09R) | **FAIL** |


#### H at 0.3%/side

Symbols in set: 18. Base closed trades: 466.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 466 | 43.1% | 0.117 | 54.74 | 10/15 (67%) | 1.16% | 9.15% | 0 |
| S3 stop on close | 431 | 47.1% | 0.314 | 135.24 | 11/15 (73%) | 2.61% | 9.34% | 0 |
| S2 swing-low (Internal) | 449 | 47.0% | 0.274 | 123.04 | 15/16 (94%) | 6.13% | 23.27% | 2 |
| S1 stop +1 ATR | 582 | 47.6% | 0.259 | 150.87 | 14/16 (88%) | 2.68% | 12.05% | 2 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.314) | pass (+0.196) | pass (135.24 vs 49.26) | pass (11/15 = 73%) | pass (+0.152 without MBSC, gap +29.51R) | **PASS** |
| S2 swing-low (Internal) | pass (0.274) | pass (+0.157) | pass (123.04 vs 49.26) | pass (15/16 = 94%) | pass (+0.142 without UNIP, gap +12.39R) | **PASS** |
| S1 stop +1 ATR | pass (0.259) | pass (+0.142) | pass (150.87 vs 49.26) | pass (14/16 = 88%) | pass (+0.119 without ISMA, gap +22.50R) | **PASS** |



### Side check 2: Data: `data\egx-div` -- dividend-adjusted data robustness (side check, not the verdict)

Symbols loaded: 15 (15 non-holdout, 0 holdout). Symbols: CNFN, COMI, DAPH, EAST, EGCH, ELEC, ELSH, ETEL, FWRY, GBCO, HRHO, MASR, MCQE, ORWE, VLMRA.

#### T: 15 non-holdout names, trades opened on/after 2023-01-01 (0.1%/side costs)

Symbols in set: 15. Base closed trades: 217.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 217 | 41.0% | 0.051 | 11.04 | 8/15 (53%) | 0.06% | 6.37% | 0 |
| S3 stop on close | 202 | 45.0% | 0.140 | 28.20 | 9/15 (60%) | 0.72% | 6.47% | 0 |
| S2 swing-low (Internal) | 180 | 47.8% | 0.262 | 47.08 | 12/15 (80%) | 3.69% | 16.45% | 0 |
| S1 stop +1 ATR | 259 | 45.6% | 0.144 | 37.37 | 9/15 (60%) | 0.81% | 8.21% | 0 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.140) | pass (+0.089) | pass (28.20 vs 9.94) | pass (9/15 = 60%) | pass (+0.052 without HRHO, gap +8.42R) | **PASS** |
| S2 swing-low (Internal) | pass (0.262) | pass (+0.211) | pass (47.08 vs 9.94) | pass (12/15 = 80%) | pass (+0.187 without ORWE, gap +8.43R) | **PASS** |
| S1 stop +1 ATR | pass (0.144) | pass (+0.093) | pass (37.37 vs 9.94) | pass (9/15 = 60%) | pass (+0.065 without EGCH, gap +8.07R) | **PASS** |


#### Informational: 15 non-holdout names, FULL history (includes discovery period)

Symbols in set: 15. Base closed trades: 678.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 678 | 41.0% | 0.058 | 39.25 | 8/15 (53%) | 0.57% | 6.79% | 0 |
| S3 stop on close | 623 | 47.2% | 0.224 | 139.69 | 11/15 (73%) | 1.40% | 6.85% | 0 |
| S2 swing-low (Internal) | 653 | 48.4% | 0.287 | 187.67 | 14/15 (93%) | 4.83% | 18.24% | 0 |
| S1 stop +1 ATR | 849 | 45.5% | 0.192 | 162.86 | 13/15 (87%) | 1.51% | 9.05% | 0 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.224) | pass (+0.166) | pass (139.69 vs 35.32) | pass (11/15 = 73%) | pass (+0.136 without MCQE, gap +27.93R) | **PASS** |
| S2 swing-low (Internal) | pass (0.287) | pass (+0.230) | pass (187.67 vs 35.32) | pass (14/15 = 93%) | pass (+0.208 without EAST, gap +23.71R) | **PASS** |
| S1 stop +1 ATR | pass (0.192) | pass (+0.134) | pass (162.86 vs 35.32) | pass (13/15 = 87%) | pass (+0.120 without HRHO, gap +20.52R) | **PASS** |


#### Side check 2 sensitivity: 0.3% slippage per side (commission unchanged), 15 symbols

#### T at 0.3%/side

Symbols in set: 15. Base closed trades: 217.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 217 | 41.0% | -0.027 | -5.89 | 8/15 (53%) | -0.34% | 6.37% | 0 |
| S3 stop on close | 202 | 44.1% | 0.063 | 12.76 | 8/15 (53%) | 0.31% | 6.47% | 0 |
| S2 swing-low (Internal) | 180 | 47.8% | 0.228 | 41.12 | 12/15 (80%) | 3.28% | 16.45% | 0 |
| S1 stop +1 ATR | 259 | 45.6% | 0.084 | 21.80 | 9/15 (60%) | 0.41% | 8.21% | 0 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.063) | pass (+0.090) | pass (12.76 vs -5.30) | FAIL (8/15 = 53%) | pass (+0.053 without HRHO, gap +8.73R) | **FAIL** |
| S2 swing-low (Internal) | pass (0.228) | pass (+0.256) | pass (41.12 vs -5.30) | pass (12/15 = 80%) | pass (+0.233 without ORWE, gap +9.30R) | **PASS** |
| S1 stop +1 ATR | pass (0.084) | pass (+0.111) | pass (21.80 vs -5.30) | pass (9/15 = 60%) | pass (+0.084 without EGCH, gap +7.92R) | **PASS** |

Note: base total R is negative (-5.89), so rule 3 ("total R >= 90% of base") is applied literally as total >= -5.30.




### Side check 2b: Data: `data\egx` -- same 15 symbols on the splits-only feed (comparison for the egx-div side check)

Symbols loaded: 15 (15 non-holdout, 0 holdout). Symbols: CNFN, COMI, DAPH, EAST, EGCH, ELEC, ELSH, ETEL, FWRY, GBCO, HRHO, MASR, MCQE, ORWE, VLMRA.

#### T: 15 non-holdout names, trades opened on/after 2023-01-01 (0.1%/side costs)

Symbols in set: 15. Base closed trades: 213.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 213 | 40.8% | 0.058 | 12.44 | 8/15 (53%) | 0.09% | 6.48% | 0 |
| S3 stop on close | 196 | 45.4% | 0.191 | 37.39 | 7/15 (47%) | 0.91% | 6.61% | 0 |
| S2 swing-low (Internal) | 184 | 44.0% | 0.198 | 36.38 | 12/15 (80%) | 3.10% | 16.50% | 0 |
| S1 stop +1 ATR | 259 | 44.4% | 0.130 | 33.64 | 10/15 (67%) | 0.58% | 8.33% | 0 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.191) | pass (+0.132) | pass (37.39 vs 11.20) | FAIL (7/15 = 47%) | pass (+0.098 without HRHO, gap +8.42R) | **FAIL** |
| S2 swing-low (Internal) | pass (0.198) | pass (+0.139) | pass (36.38 vs 11.20) | pass (12/15 = 80%) | pass (+0.111 without CNFN, gap +7.79R) | **PASS** |
| S1 stop +1 ATR | pass (0.130) | pass (+0.071) | pass (33.64 vs 11.20) | pass (10/15 = 67%) | pass (+0.035 without EAST, gap +10.59R) | **PASS** |


#### Informational: 15 non-holdout names, FULL history (includes discovery period)

Symbols in set: 15. Base closed trades: 751.

| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |
|---|---|---|---|---|---|---|---|---|
| base | 751 | 40.6% | 0.034 | 25.74 | 8/15 (53%) | 0.53% | 6.70% | 0 |
| S3 stop on close | 674 | 46.6% | 0.251 | 168.92 | 11/15 (73%) | 1.71% | 6.78% | 0 |
| S2 swing-low (Internal) | 688 | 45.2% | 0.234 | 161.17 | 14/15 (93%) | 4.15% | 18.11% | 0 |
| S1 stop +1 ATR | 923 | 44.6% | 0.162 | 149.48 | 12/15 (80%) | 1.63% | 9.01% | 0 |

| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |
|---|---|---|---|---|---|---|
| S3 stop on close | pass (0.251) | pass (+0.216) | pass (168.92 vs 23.17) | pass (11/15 = 73%) | pass (+0.191 without MCQE, gap +29.67R) | **PASS** |
| S2 swing-low (Internal) | pass (0.234) | pass (+0.200) | pass (161.17 vs 23.17) | pass (14/15 = 93%) | pass (+0.169 without EAST, gap +30.62R) | **PASS** |
| S1 stop +1 ATR | pass (0.162) | pass (+0.128) | pass (149.48 vs 23.17) | pass (12/15 = 80%) | pass (+0.104 without EAST, gap +26.27R) | **PASS** |

## Opus review and conclusion (2026-11-20)

Two independent Opus 5.5 reviews ran: one on the port, one on the discovery analysis. Neither
found a code bug. The port still matches TradingView on all 91 chart-config reads after the
candidate hooks were added, plus 9/9 on the untouched `avwap` round. What the reviews changed:

- **S2 is not "a slightly wider stop".** Its median stop is 4.4 ATR / ~17% of price, and half its
  trades end on the CHoCH invalidation exit (avg −0.26R), not on the stop. It is effectively a
  different exit system: no hard stop, leave on a structure break. Only about 1,000 of its 2,288
  discovery trades match a base trade.
- **Phantom wicks are ruled out, for a stronger reason than the discovery doc gave.** A synthetic
  open or low equals the previous close, and that close was above the stop. If it weren't, the
  previous bar would already have hit the stop. So synthetic data cannot cause a stop-out, and S4
  could never fire on an initial stop; its "fail" tells us nothing about the data. The better test
  splits initial stops into wick-only (closed back above the stop) and close-confirmed. 70–72% are
  wick-only in every era, and they recover to TP1 within 20 bars about 2× as often (21–27% vs
  8–17%). They are genuine intraday noise stops, not a data artefact.
- **The lift is not an R-accounting artefact.** It holds in net % of price per trade, per bar
  held, with tails trimmed, and on matched trades. Chart-cluster bootstrap 95% CI of the discovery
  lift: S3 +0.13…+0.22R, S2 +0.09…+0.22R, S1 +0.04…+0.16R. S3 and S2 clear a Bonferroni bar
  for the 41 grid points easily.
- **Limit-down days do not carry S3.** Filling every S3 stop exit at the next bar's open instead
  costs −13.8R of +411.7R.
- **The lift shrinks in recent years:** S3 +0.24R (2001–11) → +0.077R (2018–22). T (2023+)
  agreed, at +0.087R.

**Answer to the question asked.** "Stopped out, then the stock went up" is the minority story.
53% of trades end at the initial stop without a target. Of those, only 21% reach TP1 within 20
bars, and 66% never reach it within 40 bars. Most losers are entries that never worked, which
matches the September diagnosis. The part that *is* "stopped, then up" is concentrated in
wick-only stops: the low pierced the stop and the close came back. The fix that survives
everything is the existing input **`Stop on Close Only`**. It lifted avg R on unseen 2023+ trades
(+0.217 → +0.303R) and on the 18 never-opened stocks (+0.178 → +0.372R), with a higher win rate in
both. It keeps the same stop, so 1R means the same money. Its cost is fatter single losses: p10 of
initial stops −1.67R vs −1.19R, and a locked limit-down day can exit far below the stop.

**No extra indicator helped.** RSI, ADX, SMA200, EGX30 trend, weekly trend, relative strength,
distance from SMA20, CMF and MFI all failed on discovery. Volume ratio ≥ 0.8 scraped through, but
at about 1 SE and non-monotonic, so it was treated as noise. This is the same result as the
confluence score, the trust score and the HTF / displacement / confirmation / AVWAP filters
before it.

**Caveats.** The main data is splits-only. The dividend-adjusted feed, which is what TradingView
charts show and the only one the port matches exactly, exists for just 15 names; S3 passed there
at 0.1%/side and failed rule 4 (8/15) at 0.3%/side. The symbol lists are today's constituents run
back to 2001 (survivorship). The base itself swings by era (+0.029R discovery, +0.217R on T) and
turns negative on discovery at 0.3%/side costs.
