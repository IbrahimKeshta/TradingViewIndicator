# ICT Script — Longer Runners (exit settings), Out-of-Sample Validation

**Script:** `src/ict-rsi-ma-indicator.pine` at `c799b9b`. No code change: every config uses exit inputs the script already has.
**Raw data:** `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (rows with round `runner`, configs `base` and `r1`–`r4`).

## Protocol (declared before any read)

**Settings for every run:** daily, Long Trades Only on, Apply Costs on (0.1%/side + 2 EGP/order, position 100,000), Min Risk (ticks) 10, Require Anchored VWAP off, otherwise defaults. Only the pullback model trades. Win = net R > 0. Results are scale-out in thirds, as always.

**Configs (fixed in advance, nothing else is tried):**

| Config | Runner (no exit at TP3) | Trailing Tier | Trail From Entry |
|---|---|---|---|
| base | off | Internal | off |
| r1 | **on** | Internal | off |
| r2 | off | **Major** | off |
| r3 | **on** | **Major** | off |
| r4 | **on** | **Major** | **on** |

**Step 1 — Tuning** (the same 15 charts, trades entered before 2024-01-01; baseline already read: n 513, +0.123R per trade).
- **Pick:** the config with the highest Tuning avg R, but only if it lifts it by ≥ +0.03 over the baseline with ≥ 150 trades. If none does, stop: nothing goes to step 2.
- The pick is written here before any batch E chart is opened.

**Step 2 — Deciding test on batch E** (never opened: ACTF, AIHC, BONY, DAPH, ELKA, EXPA, HDBK, MCRO, NCCW, SVCE; full history, Tuning + Test summed). If a symbol has no TradingView data, the next unused EGX70 name in `EGX70_LIST` order replaces it.
- **Pass if all three hold:** the pick's avg R > 0 after costs; it beats the baseline on the same batch by ≥ +0.03R per trade; ≥ 60% of charts (n ≥ 5) have R > 0.
- The win rate is reported but not judged: runners trade win rate for size, and the ICT baseline already sits near 42%.

## Results

### Step 1 — Tuning (15 charts, trades entered before 2024-01-01)

| Config | n | Win % | Avg R / trade | Lift vs base | Total R | Charts R>0 (n≥5) |
|---|---|---|---|---|---|---|
| base | 513 | 42.3 | +0.123 | — | +63.23 | 10/14 |
| r1 runner | 417 | 40.5 | +0.192 | +0.069 | +80.15 | 11/14 |
| r2 major tier | 509 | 42.2 | +0.128 | +0.005 | +65.25 | 10/14 |
| r3 runner + major | 398 | 40.2 | +0.228 | +0.105 | +90.81 | 12/14 |
| r4 runner + major + trail from entry | 366 | 35.5 | +0.309 | +0.186 | +113.25 | 12/14 |

Per-chart rows are in the raw TSV (round `runner`). The runner configs take fewer trades because a trade held longer blocks the next setup (one trade slot per model).

**Pick: r4** (Runner on, Trailing Tier Major, Trail From Entry on). Highest Tuning avg R, lift +0.186 ≥ 0.03, n 366 ≥ 150. Committed before any batch E chart was opened.

### Step 2 — Deciding test, batch E (10 never-opened stocks, full history, Tuning + Test summed)

AIHC does not exist on TradingView ("This symbol doesn't exist"), so per the replacement rule ARCC (the next unused EGX70 name in list order) took its place.

| Chart | Baseline n / wins / R | r4 n / wins / R |
|---|---|---|
| ACTF | 5 / 0 / −4.81 | 5 / 0 / −4.81 |
| BONY | 2 / 0 / −2.06 | 2 / 0 / −2.06 |
| DAPH | 72 / 25 / −1.25 | 52 / 18 / **+17.76** |
| ELKA | 11 / 2 / −6.92 | 9 / 1 / −5.68 |
| ARCC | 32 / 14 / +2.11 | 31 / 12 / −5.30 |
| EXPA | 35 / 13 / +4.00 | 29 / 9 / −2.77 |
| HDBK | 37 / 21 / +20.82 | 21 / 8 / +15.35 |
| MCRO | 4 / 3 / +2.07 | 3 / 2 / +1.82 |
| NCCW | 22 / 8 / −1.99 | 15 / 5 / +0.95 |
| SVCE | 56 / 27 / +13.56 | 38 / 13 / +12.55 |
| **Pooled** | **276 / 40.9% / +0.092R per trade (+25.53R)**, 4/8 charts R>0 | **205 / 33.2% / +0.136R per trade (+27.81R)**, 4/8 charts R>0 |

| Pass rule | Result | Met |
|---|---|---|
| Pick avg R > 0 after costs | +0.136 | ✓ |
| Beats baseline by ≥ +0.03R per trade | +0.044 | ✓ |
| ≥ 60% of charts (n ≥ 5) with R > 0 | 4/8 = 50% | ✗ |

**Verdict: FAIL** (breadth). The average lift is real on paper but rests on one stock. DAPH alone swings by +19.0R (−1.25 → +17.76). Without DAPH, r4 averages +0.066R per trade (153 trades) against the baseline's +0.131R (204 trades), so on the other nine stocks the runner settings were *worse*. They beat the baseline on 3 of the 8 charts with n ≥ 5 (DAPH, ELKA, NCCW) and lost on 4. Total R barely moved (+27.81 vs +25.53) while trades fell 26% and the win rate fell to 33%.

**Reading:** the runner settings do what they are built for, which is to let one big trend pay for many small losses. Whether a batch contains such a trend is luck of the draw. Tuning had several (COMI, FWRY, MFPC); batch E had one. That is a real trade-off, not an edge that shows up on most stocks, and the protocol's breadth rule exists to catch exactly this.
