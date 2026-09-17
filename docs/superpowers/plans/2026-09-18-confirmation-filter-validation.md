# Require Confirmation Filter Validation

**Date:** 2026-09-18
**Question:** Does requiring a same-direction candle after a zone touch — rather than trading the
touch bar — fix the entry-timing problem the trade-log diagnosis found?
**Answer: yes on EGX daily equities, no on crypto 4H/1H.** Not a blanket win, but a real one where
it works, and the two markets split cleanly enough that a per-market recommendation is honest.

## Method

Same 10 charts as the 2026-09-17 HTF/Displacement validation, so results are directly comparable:
EGX 1D (ELEC, ABUK, MASR, BTFH) and crypto 4H/1H (ETH, SOL, XRP). Two settings per chart —
**baseline** (all filters off, the same numbers already on record) and **Require Confirmation on**
at its default `Confirmation Max Wait = 3` bars, HTF Bias and Displacement left off throughout so
only this one filter's effect is measured.

**Pass rule, fixed before running any chart:** the filter counts as working if it raises Avg R on at
least 6 of 10 charts — the same bar the HTF/Displacement test was held to. Nothing about the
threshold or the settings was adjusted after seeing a result.

## Results

| Chart | Baseline Avg R (n) | Confirmation Avg R (n) | Direction |
|---|---|---|---|
| ELEC 1D | +0.15 (128) | **+0.44** (103) | up |
| ABUK 1D | +0.03 (150) | **+0.48** (122) | up |
| MASR 1D | +0.06 (125) | **+0.18** (113) | up |
| BTFH 1D | −0.01 (72) | **+0.30** (53) | up |
| ETH 4H | +0.14 (94) | +0.07 (80) | down |
| ETH 1H | −0.14 (92) | −0.10 (101) | up (still negative) |
| SOL 1H | +0.15 (75) | −0.04 (74) | down |
| SOL 4H | +0.01 (82) | +0.06 (86) | up |
| XRP 1H | +0.18 (71) | +0.02 (85) | down |
| XRP 4H | +0.24 (83) | +0.05 (86) | down |

**6 / 10 improved** — passes the threshold. **Pooled Avg R across all 10: +0.078 → +0.159**, roughly
doubled. But the aggregate hides the real shape of the result:

- **All 4 EGX daily charts improved, and by a lot** — Avg R roughly tripled on ELEC and MASR,
  doubled on ABUK, and BTFH flipped from a small loss to solidly positive. Every EGX A/B/C grade
  breakdown came back with **B and C both positive** (a first — no prior filter or the score itself
  had ever done that consistently).
- **Crypto is mixed to negative** — 2 of 6 improved, both marginally (ETH 1H stayed negative, SOL
  4H barely moved). The other 4 gave back a real amount: XRP 4H's Avg R fell by more than
  four-fifths, XRP 1H by nearly nine-tenths, SOL 1H flipped from solidly positive to negative.

This matches the diagnosis's own root cause. A daily EGX bar is a full day of decision-making —
waiting one more bar for a confirming candle costs a day but filters real noise. A crypto 4H/1H bar
is a much smaller, noisier slice of a 24/7 market; the same one-bar wait mostly just gives back the
move before the trade gets taken, without filtering much.

## Trade count cost

n fell on every EGX chart (−15% to −26%) and rose or held roughly flat on crypto. The filter is
doing exactly what it says — abandoning touches that don't confirm within 3 bars — and EGX apparently
has more touches that fail to confirm than crypto does at this timeframe, consistent with EGX being
the market where confirmation was worth waiting for.

## Recommendation

**Turn `Require Confirmation` on for EGX daily equities. Leave it off for crypto 4H/1H**, or test it
per-symbol there rather than assuming it helps. This is not a new "no filter helps everywhere"
result — it's the opposite: a filter that helps hard and consistently on one market and doesn't on
another, which is itself informative. Default stays off (same reasoning as HTF Bias and
Displacement: a published indicator shouldn't change behavior under people who haven't read this).

## Caveats

- `Confirmation Max Wait` was left at its untested default (3). A shorter or longer wait might
  behave differently on crypto specifically — not tried, and tuning it against these same 10 charts
  would be curve-fitting rather than validation.
- Only EGX daily and crypto 4H/1H were tested. Whether this generalizes to EGX 4H/1H or crypto daily
  is unknown.
- Sample sizes shrank along with the improvement (53–122 trades per EGX chart, still comfortably
  above the ~15-trade noise floor used in prior passes).
