# EGX100 discovery results (2026-11-20)

Protocol: `2026-11-20-egx100-failure-analysis.md` (not edited). Engine: `tools/backtest/ict-engine.mjs` (Node port, validated exact against
TradingView). Scripts: `tools/backtest/analyze-failures.mjs`, `tools/backtest/candidates.mjs`. Data: `data/egx` (**split-adjusted only**, 82
non-holdout symbols; the 18 holdout symbols are excluded by an explicit list in `egx100-common.mjs` and are never loaded). Discovery = trades
opened (signal bar) before 2023-01-01. No post-2023 trade result was printed or looked at. Config = preset `tv-base` (daily, Long Only, costs
on, Min Risk 10 ticks).

## Grids declared before the candidate runs (every point is reported below)

| Candidate | Grid |
|---|---|
| S1 stop - k x ATR(14) | k in {0.25, 0.5, 1.0} |
| S2 stop below newest confirmed swing low (never tighter than the zone stop) | tier in {Internal, Major} |
| S3 stop on close only (existing Pine input) | on |
| S4 phantom-wick guard (Amendment 1): stop tested on the close when the bar open is within 1 tick of the prev close and the low is within 1 tick of the open | on |
| R1 sweep re-entry | within 5 bars after the stop bar |
| RSI(14) band | [40,65], [45,70], [50,70], [50,80], [55,75] |
| ADX(14) >= | 15, 20, 25, 30 |
| close > SMA200 | on |
| EGX30 > SMA50(EGX30) | on |
| 60-bar RS vs EGX30 > | -0.05, 0, 0.05, 0.10 |
| volume / SMA20(volume) >= | 0.8, 1.0, 1.2, 1.5 |
| (close - SMA20) / ATR <= | 0.5, 1, 2, 3 |
| weekly close > 30-week SMA (partial week counts with today's close) | on |
| CMF(20) > | -0.05, 0, 0.05, 0.10 |
| MFI(14) band | [30,70], [40,70], [40,80], [50,80], [50,100] |

Pick rule used (mechanical): a grid point **qualifies** when avg-R lift >= +0.03 and total R >= 90% of base. Per family the single threshold kept
is the qualifying point with the largest total-R lift (candidate total - base total); the (at most) three families with the largest total-R lift
are the picks. 41 grid points were run (a multiple-comparisons surface; see the notes at the end).

**Amendment 1 and order of events (honest disclosure).** The coordinator's Amendment 1 arrived after my first candidate table (S1-S3, R1,
filters) and taxonomy tables had been produced, so S4, the phantom-touch taxonomy and the sensitivity runs were added after I had seen those
results; the main grids and the pick rule were not changed by it. The logged `riskAtr` (exit-bar ATR) is not used anywhere: all risk-in-ATR
figures use `entryAtr` (ATR(14) at the signal bar). Outcome fields (bars held, MFE/MAE, tpHit, reason) appear only as descriptions of
outcomes, never as features or filters.

## A. Base run on discovery

Symbols run: 82 (holdout excluded: 18); data: `data/egx`. Discovery trades = opened before 2023-01-01.

| n | win % | avg R | total R | charts with n>=5 | charts R>0 | % R>0 | opened <2023, closed >=2023 |
|---|---|---|---|---|---|---|---|
| 2225 | 39.3% | 0.029 | 64.11 | 68 | 37 | 54% | 29 |

## B. Failure taxonomy (discovery)

Winners (net R > 0): 875. Losers (net R <= 0): 1350.

| loser exit type | n | % of losers | sum R | avg R |
|---|---|---|---|---|
| Invalidated | 151 | 11.2% | -83.07 | -0.550 |
| Initial stop, no target | 1190 | 88.1% | -1314.68 | -1.105 |
| Stopped after TP1 (BE / trail), net <= 0 | 9 | 0.7% | -1.59 | -0.176 |

### B1. Recovery after the initial stop (1190 initial-stop losers; windows counted from the bar AFTER the stop bar)

| window (bars after stop bar) | high reached TP1 | high reached entry + 1R | high got back to entry |
|---|---|---|---|
| 5 | 6.0% (71) | 10.7% | 37.5% |
| 10 | 11.7% (139) | 20.1% | 49.1% |
| 20 | 20.7% (246) | 33.6% | 63.4% |
| 40 | 34.3% (408) | 47.6% | 72.4% |

Same-bar note: 6 initial-stop losers had a stop-bar high already at/above TP1 (stop assumed first, as the engine does). Windows truncated by end of data: 0.

Stopped-then-recovered (TP1 within 20 bars): **246** = 20.7% of initial-stop losers, 18.2% of all losers, 11.1% of all trades. Late recovery (21-40 bars): 162. Never worked (no TP1 within 40 bars): **782** = 65.7% of initial-stop losers, 57.9% of all losers.

### B2. Undershoot: lowest low from the stop bar to the recovery bar, in R below the stop (recovered trades only)

| recovery target | n | p25 | p50 | p75 | p90 | share with undershoot <= 0.25R / 0.5R / 1R / 2R |
|---|---|---|---|---|---|---|
| TP1 within 20 bars | 246 | 0.21 | 0.42 | 1.04 | 1.83 | 28% / 54% / 73% / 91% |
| entry+1R within 20 bars | 400 | 0.20 | 0.44 | 1.05 | 1.70 | 28% / 53% / 74% / 94% |

Same undershoot in ATR(14) at entry (TP1 within 20 bars): p25 = 0.31, p50 = 0.66, p75 = 1.52, p90 = 2.39.

Share of ALL initial-stop losers that recovered to TP1 within 20 bars with undershoot <= x R (the trades a stop x R wider could in principle have kept, ignoring path effects):

| x (R below the stop) | 0.25 | 0.5 | 1.0 | 2.0 |
|---|---|---|---|---|
| share of initial-stop losers | 5.7% | 11.2% | 15.1% | 18.9% |

### B3. Winners vs stopped-and-recovered vs stopped-and-never-worked

| metric | Winners (n=875) | Stopped, recovered <=20 bars (n=246) | Stopped, recovered 21-40 bars (n=162) | Stopped, never worked (no TP1 in 40) (n=782) |
|---|---|---|---|---|
| avg R | 1.673 | -1.133 | -1.115 | -1.094 |
| MFE before exit, R (p25 / p50 / p75) | 1.87 / 3.04 / 3.93 | 0.00 / 0.25 / 0.64 | 0.02 / 0.35 / 0.63 | 0.00 / 0.33 / 0.76 |
| share that never reached +0.5R / +1R before exit | 0% / 1% | 67% / 91% | 65% / 91% | 61% / 85% |
| bars held (p25 / p50 / p75) | 9 / 19 / 36 | 2 / 3 / 6 | 3 / 5 / 11 | 3 / 6 / 12 |
| risk in entry ATR (p25 / p50 / p75) | 1.32 / 1.71 / 2.28 | 1.16 / 1.40 / 1.76 | 1.22 / 1.56 / 2.15 | 1.24 / 1.54 / 2.00 |
| risk as % of entry (p25 / p50 / p75) | 5.0 / 7.0 / 10.4 | 3.9 / 5.4 / 7.1 | 4.1 / 5.7 / 8.2 | 4.6 / 6.2 / 8.8 |
| stop vs most recent confirmed INTERNAL swing low at entry: (stop - swing)/ATR, p50; share stop is ABOVE the swing low | 2.24; 97% | 2.44; 99% | 2.46; 98% | 2.11; 97% |
| same vs most recent confirmed MAJOR swing low | 4.89; 99% | 6.06; 100% | 5.59; 99% | 4.71; 99% |
| next INTERNAL swing low below the stop: distance in R below the stop (p25 / p50 / p75) | 0.29 / 0.73 / 1.52 | 0.49 / 1.08 / 2.36 | 0.32 / 0.76 / 1.69 | 0.33 / 0.76 / 1.45 |
| gap through stop (exit price < stop) | n/a | 19% | 19% | 13% |
| stop within 0.15 ATR of a round level (share; share expected if uniform) | 11%; 11% | 8%; 10% | 8%; 10% | 10%; 10% |
| stop bar range, % of prev close (p50); share with low >= 9.5% below prev close (limit-down region) | n/a | 5.8%; 14% | 5.7%; 15% | 5.8%; 18% |
| EGX30 close above its SMA50 at entry | 81% | 79% | 79% | 78% |
| bars from zone creation to entry (p25 / p50 / p75) | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 3 |
| zone type FVG / OB-MAJOR / OB-INTERNAL | 86% / 6% / 8% | 89% / 3% / 8% | 88% / 6% / 7% | 83% / 6% / 12% |
| grade A / B / C | 11% / 42% / 47% | 9% / 44% / 47% | 8% / 41% / 51% | 10% / 42% / 48% |
| score (mean of 7) | 5.63 | 5.61 | 5.57 | 5.61 |

Entry-bar indicator medians (descriptive only; no thresholds are taken from this table):

| feature (p50) | Winners | Stopped, recovered <=20 bars | Stopped, recovered 21-40 bars | Stopped, never worked (no TP1 in 40) |
|---|---|---|---|---|
| RSI(14) | 67.324 | 66.625 | 67.188 | 66.393 |
| ADX(14) | 30.116 | 30.343 | 29.563 | 29.515 |
| close / SMA200 - 1 | 0.211 | 0.226 | 0.189 | 0.175 |
| 60-bar RS vs EGX30 | 0.107 | 0.105 | 0.111 | 0.107 |
| volume / SMA20(vol) | 1.194 | 1.130 | 1.232 | 1.169 |
| (close-SMA20)/ATR | 2.024 | 1.771 | 1.898 | 1.819 |
| close / weekly SMA30 - 1 | 0.179 | 0.171 | 0.165 | 0.151 |
| CMF(20) | 0.101 | 0.094 | 0.099 | 0.096 |
| MFI(14) | 74.774 | 74.588 | 71.391 | 74.609 |

### B5. Phantom-touch stop bars (Amendment 1)

Phantom touch = initial-stop exit whose stop bar has |open - prev close| <= 1 tick AND |low - open| <= 1 tick AND close > stop. "Synthetic open" = |open - prev close| <= 1 tick only; "low at open" = |low - open| <= 1 tick only. Era = year of the stop bar. Recovery = high reached TP1 within 20 bars after the stop bar. (Risk-in-ATR in this document is always computed at the entry bar, never from the logged riskAtr, which is measured on the exit bar.)

| era of stop bar | initial-stop exits | synthetic open | low at open | phantom touch | recovery<=20 bars: phantom | recovery<=20 bars: real (non-phantom) |
|---|---|---|---|---|---|---|
| pre-2012 | 405 | 10% | 23% | 0.0% (0) | n/a | 21.0% (85/405) |
| 2012-2017 | 387 | 48% | 11% | 0.0% (0) | n/a | 23.8% (92/387) |
| 2018+ | 398 | 96% | 0% | 0.0% (0) | n/a | 17.3% (69/398) |
| all | 1190 | 51% | 12% | 0.0% (0) | n/a | 20.7% (246/1190) |

Recovery to TP1 within 20 bars by whether the stop bar had a synthetic open:

| era | synthetic-open stop bars | real-open stop bars |
|---|---|---|
| pre-2012 | 14.6% (6/41) | 21.7% (79/364) |
| 2012-2017 | 23.2% (43/185) | 24.3% (49/202) |
| 2018+ | 17.0% (65/383) | 26.7% (4/15) |

Bar-level prevalence in this data set (all non-holdout bars through 2022; note data/egx is the splits-only download):

| era | bars | open within 1 tick of prev close | up days with low within 1 tick of prev close |
|---|---|---|---|
| pre-2012 | 99658 | 37% | 40% |
| 2012-2017 | 90407 | 65% | 51% |
| 2018+ | 89890 | 95% | 57% |

### B4. By year of entry (discovery)

| year | n | win % | avg R | initial-stop share of trades | recovered<=20 share of trades |
|---|---|---|---|---|---|
| 2001 | 11 | 55% | 0.502 | 36% | 0% |
| 2002 | 23 | 52% | -0.019 | 43% | 4% |
| 2003 | 36 | 44% | 0.059 | 53% | 8% |
| 2004 | 40 | 43% | 0.246 | 50% | 18% |
| 2005 | 83 | 55% | 0.439 | 43% | 11% |
| 2006 | 115 | 42% | 0.097 | 55% | 10% |
| 2007 | 126 | 54% | 0.284 | 43% | 15% |
| 2008 | 92 | 33% | -0.213 | 58% | 16% |
| 2009 | 115 | 38% | 0.123 | 57% | 9% |
| 2010 | 106 | 30% | -0.270 | 62% | 8% |
| 2011 | 27 | 37% | -0.169 | 56% | 4% |
| 2012 | 85 | 38% | 0.207 | 55% | 8% |
| 2013 | 103 | 35% | -0.098 | 54% | 15% |
| 2014 | 158 | 37% | -0.130 | 55% | 13% |
| 2015 | 63 | 22% | -0.718 | 67% | 13% |
| 2016 | 123 | 38% | 0.090 | 54% | 10% |
| 2017 | 198 | 48% | 0.356 | 45% | 15% |
| 2018 | 122 | 26% | -0.298 | 69% | 15% |
| 2019 | 105 | 26% | -0.314 | 63% | 6% |
| 2020 | 137 | 31% | -0.113 | 61% | 9% |
| 2021 | 188 | 41% | 0.082 | 47% | 8% |
| 2022 | 169 | 49% | 0.285 | 44% | 11% |


## C. Candidates run through the engine (discovery: 82 symbols, trades opened before 2023-01-01)

Base: n 2225, win 39.3%, avg R 0.029, total R 64.11, charts R>0 37/68 (54%). 90% of base total R = 57.69. Base avg-R standard error about 0.035.

Every grid point is shown. "lift" = candidate avg R - base avg R (per trade). "dTotal" = candidate total R - base total R. "keeps 90%" = total R >= 90% of base. "qual" = lift >= +0.03 AND keeps 90%. "lift ex top chart" = avg-R lift after removing the one chart with the largest candidate - base total-R gap (informational; it is pass-rule 5 on the later sets).

| family | point | n | win % | avg R | total R | lift | dTotal | charts R>0 (n>=5) | keeps 90% | qual | se(avg R) | lift ex top chart (chart) | avg gross R | avg cost R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BASE | tv-base | 2225 | 39.3% | 0.029 | 64.11 | 0 | 0 | 37/68 | yes | - | - | - | 0.064 | 0.036 |
| S1 stop - k*ATR | k=0.25 | 2562 | 39.8% | 0.051 | 131.42 | +0.022 | +67.32 | 37/69 (54%) | yes | no | 0.032 | +0.016 (OCDI) | 0.085 | 0.034 |
| S1 stop - k*ATR | k=0.5 | 2751 | 41.4% | 0.112 | 306.77 | +0.083 | +242.67 | 46/69 (67%) | yes | YES | 0.031 | +0.074 (OCDI) | 0.143 | 0.032 |
| S1 stop - k*ATR | k=1 | 2811 | 42.2% | 0.124 | 347.50 | +0.095 | +283.40 | 49/71 (69%) | yes | YES | 0.028 | +0.086 (ADIB) | 0.150 | 0.026 |
| S2 stop below newest confirmed swing low | tier=Internal | 2288 | 42.9% | 0.183 | 419.05 | +0.154 | +354.94 | 58/72 (81%) | yes | YES | 0.024 | +0.144 (PHAR) | 0.198 | 0.015 |
| S2 stop below newest confirmed swing low | tier=Major | 2205 | 41.9% | 0.188 | 414.48 | +0.159 | +350.37 | 59/73 (81%) | yes | YES | 0.020 | +0.148 (MCQE) | 0.198 | 0.010 |
| S3 stop on close only | on | 2022 | 46.1% | 0.204 | 411.70 | +0.175 | +347.60 | 55/68 (81%) | yes | YES | 0.041 | +0.166 (EAST) | 0.239 | 0.035 |
| S4 phantom-wick guard | on | 2224 | 39.3% | 0.031 | 68.13 | +0.002 | +4.02 | 37/68 (54%) | yes | no | 0.035 | +0.001 (JUFO) | 0.066 | 0.036 |
| R1 sweep re-entry | within 5 bars | 2563 (541 re-entries) | 39.4% | 0.042 | 108.57 | +0.014 | +44.47 | 42/69 (61%) | yes | no | 0.032 | +0.008 (MCQE) | 0.077 | 0.035 |
| F RSI(14) band | [40,65] | 1165 | 36.5% | 0.025 | 29.45 | -0.004 | -34.66 | 32/59 (54%) | no | no | 0.050 | -0.015 (AMOC) | 0.065 | 0.039 |
| F RSI(14) band | [45,70] | 1592 | 37.7% | 0.012 | 19.55 | -0.017 | -44.56 | 34/63 (54%) | no | no | 0.041 | -0.025 (NIPH) | 0.050 | 0.038 |
| F RSI(14) band | [50,70] | 1552 | 38.1% | 0.023 | 35.61 | -0.006 | -28.50 | 35/63 (56%) | no | no | 0.042 | -0.014 (NIPH) | 0.061 | 0.038 |
| F RSI(14) band | [50,80] | 2022 | 39.0% | 0.035 | 69.91 | +0.006 | +5.80 | 38/67 (57%) | yes | no | 0.038 | +0.003 (NIPH) | 0.071 | 0.037 |
| F RSI(14) band | [55,75] | 1723 | 38.7% | 0.018 | 30.88 | -0.011 | -33.23 | 35/65 (54%) | no | no | 0.040 | -0.017 (MCQE) | 0.055 | 0.037 |
| F ADX(14) >= | >=15 | 2164 | 39.1% | 0.020 | 44.32 | -0.008 | -19.79 | 34/68 (50%) | no | no | 0.035 | -0.010 (COMI) | 0.056 | 0.035 |
| F ADX(14) >= | >=20 | 1986 | 39.5% | 0.039 | 77.66 | +0.010 | +13.55 | 38/68 (56%) | yes | no | 0.037 | +0.006 (SCEM) | 0.074 | 0.035 |
| F ADX(14) >= | >=25 | 1675 | 39.1% | 0.019 | 31.91 | -0.010 | -32.20 | 38/66 (58%) | no | no | 0.040 | -0.017 (COMI) | 0.054 | 0.035 |
| F ADX(14) >= | >=30 | 1308 | 39.4% | 0.002 | 2.42 | -0.027 | -61.69 | 32/63 (51%) | no | no | 0.045 | -0.034 (EAST) | 0.036 | 0.034 |
| F close > SMA200 | on | 1932 | 38.9% | 0.012 | 23.57 | -0.017 | -40.54 | 34/67 (51%) | no | no | 0.037 | -0.020 (MCQE) | 0.048 | 0.036 |
| F EGX30 > SMA50 | on | 1855 | 40.5% | 0.048 | 88.67 | +0.019 | +24.57 | 39/66 (59%) | yes | no | 0.039 | +0.011 (PHAR) | 0.084 | 0.036 |
| F 60-bar RS vs EGX30 > | >-0.05 | 1889 | 38.9% | 0.004 | 8.05 | -0.025 | -56.06 | 36/65 (55%) | no | no | 0.038 | -0.031 (EGAL) | 0.039 | 0.035 |
| F 60-bar RS vs EGX30 > | >0 | 1743 | 38.5% | -0.012 | -21.04 | -0.041 | -85.15 | 30/65 (46%) | no | no | 0.039 | -0.048 (EGAL) | 0.022 | 0.034 |
| F 60-bar RS vs EGX30 > | >0.05 | 1529 | 38.2% | -0.017 | -26.61 | -0.046 | -90.71 | 33/65 (51%) | no | no | 0.041 | -0.050 (EMFD) | 0.016 | 0.033 |
| F 60-bar RS vs EGX30 > | >0.1 | 1291 | 38.5% | -0.018 | -22.72 | -0.046 | -86.83 | 35/64 (55%) | no | no | 0.045 | -0.058 (EGAL) | 0.013 | 0.031 |
| F volume / SMA20(vol) >= | >=0.8 | 1627 | 40.4% | 0.076 | 122.92 | +0.047 | +58.81 | 41/63 (65%) | yes | YES | 0.042 | +0.038 (MCQE) | 0.109 | 0.034 |
| F volume / SMA20(vol) >= | >=1 | 1456 | 40.3% | 0.069 | 100.42 | +0.040 | +36.31 | 43/63 (68%) | yes | YES | 0.044 | +0.030 (MCQE) | 0.102 | 0.033 |
| F volume / SMA20(vol) >= | >=1.2 | 1265 | 39.4% | 0.050 | 63.44 | +0.021 | -0.67 | 35/60 (58%) | yes | no | 0.048 | +0.011 (EAST) | 0.083 | 0.033 |
| F volume / SMA20(vol) >= | >=1.5 | 1023 | 39.7% | 0.064 | 65.04 | +0.035 | +0.94 | 35/59 (59%) | yes | YES | 0.053 | +0.024 (EAST) | 0.096 | 0.032 |
| F (close-SMA20)/ATR <= | <=0.5 | 390 | 32.3% | -0.114 | -44.43 | -0.143 | -108.54 | 14/36 (39%) | no | no | 0.078 | -0.143 (ADIB) | -0.075 | 0.039 |
| F (close-SMA20)/ATR <= | <=1 | 733 | 34.2% | -0.083 | -60.70 | -0.112 | -124.81 | 23/58 (40%) | no | no | 0.059 | -0.120 (ADIB) | -0.041 | 0.041 |
| F (close-SMA20)/ATR <= | <=2 | 1462 | 36.3% | -0.043 | -62.45 | -0.072 | -126.56 | 26/62 (42%) | no | no | 0.042 | -0.081 (AMOC) | -0.004 | 0.039 |
| F (close-SMA20)/ATR <= | <=3 | 1886 | 38.4% | 0.012 | 22.34 | -0.017 | -41.76 | 33/65 (51%) | no | no | 0.038 | -0.022 (JUFO) | 0.049 | 0.038 |
| F weekly close > SMA30w | on | 2078 | 39.2% | 0.012 | 25.54 | -0.017 | -38.57 | 32/67 (48%) | no | no | 0.036 | -0.020 (MCQE) | 0.048 | 0.036 |
| F CMF(20) > | >-0.05 | 1967 | 39.5% | 0.044 | 85.67 | +0.015 | +21.57 | 36/67 (54%) | yes | no | 0.038 | +0.010 (PHAR) | 0.079 | 0.035 |
| F CMF(20) > | >0 | 1822 | 39.6% | 0.040 | 73.17 | +0.011 | +9.07 | 36/66 (55%) | yes | no | 0.039 | +0.007 (PHAR) | 0.075 | 0.035 |
| F CMF(20) > | >0.05 | 1549 | 39.8% | 0.025 | 39.31 | -0.003 | -24.80 | 32/65 (49%) | no | no | 0.041 | -0.007 (PHAR) | 0.060 | 0.035 |
| F CMF(20) > | >0.1 | 1215 | 41.3% | 0.039 | 47.74 | +0.010 | -16.37 | 33/64 (52%) | no | no | 0.045 | +0.004 (ABUK) | 0.074 | 0.035 |
| F MFI(14) band | [30,70] | 1058 | 37.1% | -0.032 | -33.44 | -0.060 | -97.55 | 30/58 (52%) | no | no | 0.047 | -0.074 (ABUK) | 0.006 | 0.038 |
| F MFI(14) band | [40,70] | 1007 | 37.7% | -0.010 | -9.66 | -0.038 | -73.77 | 30/58 (52%) | no | no | 0.049 | -0.052 (ABUK) | 0.028 | 0.038 |
| F MFI(14) band | [40,80] | 1588 | 39.6% | 0.035 | 55.66 | +0.006 | -8.44 | 33/63 (52%) | no | no | 0.041 | -0.003 (ABUK) | 0.072 | 0.037 |
| F MFI(14) band | [50,80] | 1491 | 39.6% | 0.030 | 45.12 | +0.001 | -18.98 | 32/63 (51%) | no | no | 0.042 | -0.006 (MCQE) | 0.066 | 0.036 |
| F MFI(14) band | [50,100] | 2067 | 40.0% | 0.035 | 71.35 | +0.006 | +7.24 | 40/67 (60%) | yes | no | 0.036 | +0.002 (PHAR) | 0.070 | 0.035 |

## D. Pick rule applied mechanically

- S1 stop - k*ATR: qualifying points k=1, k=0.5; kept k=1 (dTotal +283.40, lift +0.095)
- S2 stop below newest confirmed swing low: qualifying points tier=Internal, tier=Major; kept tier=Internal (dTotal +354.94, lift +0.154)
- S3 stop on close only: qualifying points on; kept on (dTotal +347.60, lift +0.175)
- S4 phantom-wick guard: no qualifying point (best avg-R lift: on +0.002, total 68.13 = 106% of base)
- R1 sweep re-entry: no qualifying point (best avg-R lift: within 5 bars +0.014, total 108.57 = 169% of base)
- F RSI(14) band: no qualifying point (best avg-R lift: [50,80] +0.006, total 69.91 = 109% of base)
- F ADX(14) >=: no qualifying point (best avg-R lift: >=20 +0.010, total 77.66 = 121% of base)
- F close > SMA200: no qualifying point (best avg-R lift: on -0.017, total 23.57 = 37% of base)
- F EGX30 > SMA50: no qualifying point (best avg-R lift: on +0.019, total 88.67 = 138% of base)
- F 60-bar RS vs EGX30 >: no qualifying point (best avg-R lift: >-0.05 -0.025, total 8.05 = 13% of base)
- F volume / SMA20(vol) >=: qualifying points >=0.8, >=1, >=1.5; kept >=0.8 (dTotal +58.81, lift +0.047)
- F (close-SMA20)/ATR <=: no qualifying point (best avg-R lift: <=3 -0.017, total 22.34 = 35% of base)
- F weekly close > SMA30w: no qualifying point (best avg-R lift: on -0.017, total 25.54 = 40% of base)
- F CMF(20) >: no qualifying point (best avg-R lift: >-0.05 +0.015, total 85.67 = 134% of base)
- F MFI(14) band: no qualifying point (best avg-R lift: [40,80] +0.006, total 55.66 = 87% of base)

**Picks (at most three, ranked by total-R lift):**

1. S2 stop below newest confirmed swing low, tier=Internal: engine config `{"preset":"tv-base","stopSwingTier":"Internal"}`; discovery n 2288, avg R 0.183 (lift +0.154), total R 419.05 (+354.94 vs base), charts R>0 58/72.
2. S3 stop on close only, on: engine config `{"preset":"tv-base","stopOnCloseOnly":true}`; discovery n 2022, avg R 0.204 (lift +0.175), total R 411.70 (+347.60 vs base), charts R>0 55/68.
3. S1 stop - k*ATR, k=1: engine config `{"preset":"tv-base","stopExtraAtr":1}`; discovery n 2811, avg R 0.124 (lift +0.095), total R 347.50 (+283.40 vs base), charts R>0 49/71.

Qualifying but outside the top three: F volume / SMA20(vol) >= >=0.8.

## E. Sensitivity runs (discovery; not candidates)

Each scenario re-runs the base, S4 and the picks with the changed assumption; lift is vs the base of the SAME scenario. "floor 0.5%" = Min Risk 10 ticks replaced by risk >= 0.5% of entry price. "cost 0.3%" = slippage 0.3%/side instead of 0.1% (commission unchanged).

| scenario | candidate | n | win % | avg R | total R | lift vs scenario base | charts R>0 (n>=5) |
|---|---|---|---|---|---|---|---|
| as run (10 ticks, 0.1%/side) | BASE | 2225 | 39.3% | 0.029 | 64.11 | 0 | 37/68 (54%) |
| as run (10 ticks, 0.1%/side) | S4 phantom guard | 2224 | 39.3% | 0.031 | 68.13 | +0.002 | 37/68 (54%) |
| as run (10 ticks, 0.1%/side) | S2 stop below newest confirmed swing low tier=Internal | 2288 | 42.9% | 0.183 | 419.05 | +0.154 | 58/72 (81%) |
| as run (10 ticks, 0.1%/side) | S3 stop on close only on | 2022 | 46.1% | 0.204 | 411.70 | +0.175 | 55/68 (81%) |
| as run (10 ticks, 0.1%/side) | S1 stop - k*ATR k=1 | 2811 | 42.2% | 0.124 | 347.50 | +0.095 | 49/71 (69%) |
| floor 0.5% of price | BASE | 3353 | 40.2% | 0.096 | 321.77 | 0 | 45/75 (60%) |
| floor 0.5% of price | S4 phantom guard | 3329 | 40.7% | 0.110 | 367.46 | +0.014 | 47/75 (63%) |
| floor 0.5% of price | S2 stop below newest confirmed swing low tier=Internal | 2696 | 44.0% | 0.212 | 571.16 | +0.116 | 61/74 (82%) |
| floor 0.5% of price | S3 stop on close only on | 3040 | 46.6% | 0.279 | 849.18 | +0.183 | 56/75 (75%) |
| floor 0.5% of price | S1 stop - k*ATR k=1 | 3694 | 43.2% | 0.186 | 685.61 | +0.090 | 58/74 (78%) |
| cost 0.3%/side | BASE | 2225 | 38.8% | -0.041 | -90.61 | 0 | 31/68 (46%) |
| cost 0.3%/side | S4 phantom guard | 2224 | 38.8% | -0.039 | -86.43 | +0.002 | 31/68 (46%) |
| cost 0.3%/side | S2 stop below newest confirmed swing low tier=Internal | 2288 | 42.3% | 0.155 | 354.11 | +0.195 | 55/72 (76%) |
| cost 0.3%/side | S3 stop on close only on | 2022 | 44.7% | 0.135 | 273.17 | +0.176 | 49/68 (72%) |
| cost 0.3%/side | S1 stop - k*ATR k=1 | 2811 | 41.9% | 0.072 | 202.43 | +0.113 | 43/71 (61%) |
| floor 0.5% + cost 0.3% | BASE | 3353 | 39.6% | 0.022 | 74.04 | 0 | 35/75 (47%) |
| floor 0.5% + cost 0.3% | S4 phantom guard | 3329 | 40.1% | 0.037 | 121.70 | +0.014 | 37/75 (49%) |
| floor 0.5% + cost 0.3% | S2 stop below newest confirmed swing low tier=Internal | 2696 | 43.4% | 0.181 | 488.75 | +0.159 | 58/74 (78%) |
| floor 0.5% + cost 0.3% | S3 stop on close only on | 3040 | 45.2% | 0.207 | 627.92 | +0.184 | 53/75 (71%) |
| floor 0.5% + cost 0.3% | S1 stop - k*ATR k=1 | 3694 | 42.9% | 0.132 | 485.78 | +0.109 | 52/74 (70%) |


## Notes, caveats and doubts

**Look-ahead.** The engine decides on the close of bar *t* and fills at that close (`openIdx` = *t*); the Pine indicator does the same. Every
filter feature uses bars up to and including *t*: RSI/ADX/CMF/MFI/SMA series are causal; EGX30 values are the last index bar dated on or before
the stock bar (same-day index close, known at the same close); volume/SMA20 includes today's volume (same convention as the engine's own
volume-surge test); the weekly SMA30 counts the current partial week with today's close. S2 uses only pivots already pushed (confirmed
`lookback` bars later). R1 watches bars after the stop bar only and fills at the close of the qualifying bar; its stop uses the lowest low
through that bar. The post-stop recovery/undershoot measurements in B use bars after the exit by design; they are descriptive and never feed a
rule. 29 of the 2225 discovery trades were opened before 2023 and closed on/after it; they are included.

**Engine changes.** Only config options and record-only fields were added; defaults are off. Evidence that defaults are unchanged:
`validate.mjs --data data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3` prints the same output as before the edit (all 91
chart-config reads still exact), e.g. `ict base  11 charts 11 11 11  TV 433/183/32.38  port 433/183/32.37`. Additionally, trade-by-trade
fields were compared on the 82 non-holdout symbols x 4 configs (base, r4, idx+conf, shorts+trail model) against a copy of the engine with the new
hooks removed: all identical. (The unedited engine file itself was not backed up before I started, so that copy was reconstructed by reversing
my own behaviour hooks; the TradingView validation is the independent evidence.) Interaction notes: S1/S2 change the stop and therefore the
R-based targets (`selectTargets` floors at entry + 1R x risk) and the Min Risk test; S3 is the existing `stopOnCloseOnly` and exits at the
breaching close (so a loss can exceed 1R); R1 trades are labelled zone `RE`.

**Base differs from earlier work.** This base (+0.029R per trade, 2225 trades, 2001-2022) is on split-adjusted data. The Min Risk (ticks) floor
and the commission term depend on price level, and the README already notes that dividend-adjusted data (what TradingView charts show, and
what produced the earlier +0.08R / +0.161R figures) takes fewer small-risk trades. The final numbers should be re-run on `data/egx-div` once
more symbols are fetched; every script takes `--data`.

**Why the stop candidates win (attribution).** Average costs per trade fall only 0.036R -> 0.010-0.035R, while gross R rises from 0.064R to
0.143-0.239R, so the lift is not a cost-per-R artefact. The three picks are the same mechanism (survive the first days after entry) and are
highly correlated; they are three views of one idea, not three independent findings. Differences between the stop families are small relative
to standard errors (about 0.02-0.04R per trade); the stop-vs-base gap (+0.08 to +0.175R) is 3-5 standard errors. Volume ratio >= 0.8/1.0/1.5
is qualifying only by a 0.04-0.047R lift (about one standard error), its charts-R>0 share is 58-68%, and it is non-monotonic in the
threshold (1.2 does not qualify) -- consistent with noise from running 41 grid points.

**Taxonomy summary.** See B1-B3. In short: 53% of all trades (88% of losers) die at the initial stop with no target, after a median of 3-6 bars,
with a median MFE of 0.25-0.33R; only 21% of those get back to TP1 within 20 bars (34% within 40), 66% never reach TP1 within 40 bars, so
"stopped then rallies" is the minority; typical undershoot among the recovered is 0.4R (p50), 1.0R (p75), 1.8R (p90). Winners and losers do not
differ on any entry-bar indicator or on EGX30 trend, grade, score, zone type or round-number stops; losers do have tighter risk (median 1.4-1.5
ATR vs 1.7 for winners), gap through the stop in 13-19% of stop-outs, and stop bars in the limit-down region (low >= 9.5% below the prior
close) in 14-18%. Zones are formed one bar before entry (median 1) and the stop sits a median 2.2 ATR above the newest confirmed internal swing
low (97% of trades), i.e. the stop is placed from the just-formed FVG, far above structure.

**Amendment 1 findings.**
- *Phantom touches.* With the review's definition (open within 1 tick of prev close, low within 1 tick of the open, close above the stop) the
  count of initial-stop exits is **0 of 1190** in every era. That is structural: a stop sits at least 10 ticks below the entry close, so a bar
  whose low is within a tick of the previous close cannot reach it unless the stop is within a tick or two of that close. S4 therefore changes 1
  trade (n 2225 -> 2224, avg R +0.002, no qualification). The synthetic-open pattern is real in this data (open within 1 tick of the previous close on
  37% / 65% / 95% of bars pre-2012 / 2012-17 / 2018+; 96% of 2018+ stop bars), but a stop bar with a synthetic open is *less* likely, not more, to recover
  (2018+: 17.0% vs 26.7% on a tiny real-open sample, n=15; pre-2012 14.6% vs 21.7%), so the data do not support "stops are hit by prices that never
  traded, then the stock goes up". (`data/egx` is the splits-only download; if TradingView's chart feed differs, the S4 conclusion should be re-checked
  on `data/egx-div`.)
- *Era.* Recovery to TP1 within 20 bars by stop-bar era is 21.0% / 23.8% / 17.3%, no era-specific rescue story.
- *Sensitivity (section E).* Scale-free floor 0.5%: base improves to +0.096R (3353 trades; the 10-tick floor was removing many trades), picks still
  lift +0.09 to +0.18R. Costs 0.3%/side: base goes to -0.041R and the stop picks still give +0.07 to +0.155R absolute (+0.11 to +0.195 lift). So the
  stop-placement result does not depend on either assumption, but the *base* is fragile to both (a floor choice moves it by +0.07R; costs of 0.3%/side
  take it negative).
- *Engine changes for Amendment 1:* `phantomGuard` (S4) and `minRiskPct` (sensitivity), both off by default. Re-run after adding them:
  `validate.mjs --data data/egx-div ... --quiet` output identical to the pre-edit output (91/91 reads OK; `ict base 11 charts 433/183/32.38 TV vs 433/183/32.37 port`),
  and trade-level equality against the hook-free engine on 82 symbols x 4 configs again 0 differences.

## Review corrections (Opus 5.5, 2026-11-20)

The Opus review found no code bug but corrects three statements above. Detail is in the
conclusion of `2026-11-20-egx100-failure-analysis.md`.
1. **Phantom touches.** The reason synthetic data can't cause a stop-out is the previous-close
   argument, not "a stop sits ≥ 10 ticks below the entry close". S4 is a structural no-op on
   initial stops.
2. **S2** has a median risk of 4.4 ATR / ~17% of price, and ~50% of its trades exit on CHoCH
   invalidation. It is a different exit system, not a wider stop.
3. **Pick order:** the pick rule ranks S2 (+354.9R) above S3 (+347.6R); the protocol lists S3
   first. This is harmless, because each pick is judged separately.
