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
