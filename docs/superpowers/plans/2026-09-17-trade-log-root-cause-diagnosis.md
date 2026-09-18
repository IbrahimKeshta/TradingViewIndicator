# Trade Log Root-Cause Diagnosis

**Date:** 2026-09-17
**Question:** Why do trades lose — is it entries, exits, or stop placement?
**Method:** the `Log Closed Trades` feature (commit `742cd03`, fixed in `b96c33c`), read back with no
theory chosen in advance.

## Data

Two symbols, both on their existing baseline settings (both new filters off), pulled via TradingView's
Pine Logs "Download logs" export — the full closed-trade history, not a sample:

- **ABUK 1D→4H** (chart was left on 4H from earlier testing): n=141, matches the panel's own
  Avg R −0.01, Total R −1.98 exactly.
- **ELEC 1D**: n=128, matches the panel's own Avg R +0.15, Total R +19.47 exactly.

Matching the panel's own aggregate on both confirms the log is trustworthy, not just plausible-looking.

Each trade was bucketed by **MFE** (the best it ever moved in the trade's favor, in R) into:
- **never_moved** — MFE < 0.3R. The trade barely breathed before failing.
- **stalled_under_1R** — MFE 0.3–1.0R. Some movement, but never reached the first target.
- **reached_1R_won** — got past 1R and closed positive.
- **reached_1R_then_lost** — got past 1R and still closed at or below zero (gave it back).

## Finding: entries, not exits, are where the money is lost

| Category | n (pooled) | Avg R | Total R | Avg bars held | Avg MAE |
|---|---|---|---|---|---|
| never_moved | 69 | −0.99 | −68.1 (split −50/−34) | 4.7 | 1.27R |
| stalled_under_1R | 68 | −1.01 | −63.4 | 8.4 | 1.29R |
| reached_1R_won | 102 | +1.86 | +181.6 | 27.1 | 0.40R |
| reached_1R_then_lost | 18 | −0.77 | −16.6 | 19.9 | 1.05R |

**52–53% of all trades, on both symbols independently, never reach even 1R in their favor before
failing.** That bucket accounts for far more total R than any other failure mode — more than gap
losses, more than grade, more than zone type, and **six times more than "reached 1R then gave it
back"** (18 trades, −16.6R vs. 137 trades, −131.5R). The intuitive worry — that the trailing stop
lets winners turn into losers — is a real but minor pattern. The dominant one is trades that simply
never had a chance.

**These aren't instant failures.** Only 13% of `never_moved` trades close within 1 bar; the rest
take 2–8+ bars, drifting adversely the whole time (MAE ends at 1.27R on average — a full R past
where a properly-sized stop sits, consistent with the entries being taken while the adverse move is
still in progress, not after it has actually reversed). Winners, by contrast, average 0.40R of
adverse excursion and take 6x longer to resolve (27 bars vs. 4–8) — they work cleanly with little
drawdown. This is the signature of an **entry-timing problem**: the FVG/order-block touch fires
before the reversal is confirmed, not after.

## Secondary findings (both confirmed, neither new)

- **Gap-through-stop is real but not the main story.** 10 of 141 (ABUK) zero-target stop-outs
  exceeded 1.05R magnitude, for −19.59R combined — a meaningful drag, but a fifth the size of the
  never_moved bucket. Worth a price floor/cap on recorded loss size eventually, not the priority.
- **Grade still doesn't discriminate consistently.** ABUK: A worst (−0.014), B best (+0.116).
  ELEC: A best (+0.475), C middle, B worst-ish. Same "inconsistent, not simply inverted" shape the
  EGX/crypto backtest passes already found — now confirmed at the individual-trade level, not just
  in aggregate panel numbers.
- **FVG dominates entries 81–95% of the time** over order blocks on both symbols. `mitigateZones()`
  processes FVG arrays before OB arrays and the first zone type touched wins for the bar — plausible
  structural reason OB entries are rare, not confirmed as a bug, just noted.

## What this rules out

The two filters tested and rejected on 2026-09-17 (`Require HTF Bias`, `Require Displacement`) were
guesses that didn't touch this mechanism. Displacement filtered for *zone strength at formation* —
this finding is about *what price does after the touch*, a different moment entirely. HTF bias
filtered for *directional agreement* — most `never_moved` trades already pass that hard gate (trend
direction is a prerequisite for entry), so directional alignment isn't what's missing here.

## Recommended next hypothesis (not yet built or approved)

**Require confirmation after the touch, not just a touch.** For example: don't enter on the bar
price first touches the zone — wait for a bar to close back out of the zone in the trade's
direction (or for a small internal-tier structure break back in that direction) before entering.
This directly targets "the reversal hadn't started yet," which is what the bar-count and MAE data
point at. This should be tested with the same rigor as the last two filters: off by default, a pass
rule fixed before looking, multiple symbols, and judged on whether it shrinks the never_moved/
stalled_under_1R buckets without gutting the reached_1R_won bucket's trade count.

## Caveats

- Two symbols, one asset class each (EGX equity, both 4H/1D). Not yet checked against crypto.
- The MFE/MAE bucketing thresholds (0.3R, 1.0R) were picked as reasonable round numbers, not tuned
  against this data — but nobody has checked whether a different split changes the picture.
- `never_moved` and `stalled_under_1R` were kept separate above but behave almost identically
  (−0.99 vs −1.01 avg R) — they may be one phenomenon at different noise levels rather than two.
