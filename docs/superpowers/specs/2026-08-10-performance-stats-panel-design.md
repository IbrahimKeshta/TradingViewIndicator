# Performance Stats Panel — Design

**Date:** 2026-08-10
**Status:** Implemented on `feat/performance-stats` (`403f29c`..`4e45d64`, merged at `044dd6f`) — TradingView verification pending
**File:** `src/ict-rsi-ma-indicator.pine`
**Depends on:** `2026-08-07-trade-engine-design.md` (D+E, implemented and running in TradingView)

## Purpose

Give the trade engine a memory of its own results, so the script's tuned numbers can be judged
against evidence instead of reasoning.

The engine currently discards every result it produces. `showTradeHistory` leaves a label in R at
each exit bar — its tooltip calls it "the cheapest possible track record" — and nothing aggregates
those labels. The record is also capped: labels share a 500-slot budget with internal break lines,
so it cannot grow long.

Meanwhile roughly a dozen numbers in this script are set by judgement with no feedback loop:
`minScore`, `watchZoneAtrMult`, `stopBufferMult`, both swing lookbacks, `rangeAtrMult`,
`eqTolMult`. `minScore` moved 4 → 5 in block C by reasoning about the denominator — correct
reasoning, but there is still no way to tell whether 5 beats 6 on a given instrument.

## Scope

**In scope:** blended-R measurement of every closed trade under a scale-out model; unconditional
accumulation of win rate, average R, total R and per-grade buckets; a `PERFORMANCE` section
appended to the existing panel; a display input to show or hide it.

**Out of scope:** any change to the trade state machine, its exit rules or its drawings; close-reason
buckets, long/short split, per-target hit rates and max drawdown (all deliberately deferred — see
*Deliberately not built*); persistence of results across chart reloads (Pine has no storage); any
form of parameter sweep or optimisation.

## The exit model

An `indicator()` has no position, so "what did this trade make" is a question the script has to
answer by assumption. Two assumptions are available and they disagree sharply.

**Single unit, as the code literally behaves.** One unit opens, one exit price closes it. TP1 moves
the stop to breakeven, TP2 sets a flag and nothing else, TP3 closes the whole position. Under this
reading a trade that runs to TP2 and then trails back into breakeven records **0R**.

**Scale-out in thirds — chosen.** One third closes at each target reached; whatever remains exits at
`closePrice`. The same trade records roughly +1R.

Thirds was chosen because it is how a three-target system is actually traded. Under single-unit
accounting the three targets are nearly decorative — only TP3 changes the outcome — and the stats
would understate the engine badly enough to mislead any tuning done against them.

The cost of the choice, stated plainly: **the engine does not model partial exits and this design
does not add them.** No partial-exit markers are drawn, the live `Open R` row still reports a single
unit, and the trailing stop still governs the entire position. The blended figure is a measurement
convention applied at close, not a change in behaviour. Anyone reading `Open R` on a live trade and
the blended R on the same trade after it closes is reading two different accounting models.

**No engine change is required.** Every input to the blended figure is already on the `Trade` object:
`entry`, `initialStop`, `tp1`..`tp3`, `tpHit`, `closePrice`, `side`. The state machine, the exit
conditions and the drawing code are untouched — which matters, because that engine is verified and
running in TradingView.

## The math

With `rr = |entry − initialStop|`:

```
legR(price) = (side == "long" ? price − entry : entry − price) / rr

blendedR    = [ Σ legR(tp_i) for i ≤ tpHit  +  (3 − tpHit) × legR(closePrice) ] ÷ 3
```

`rr` uses `initialStop`, never the trailed `stop`. This is the existing rule at the `tradeOpenR`
calculation and the reason is recorded there: a trailed stop shrinks the denominator and would
overstate every result. The same applies with more force here, where results accumulate.

**Targets are not evenly spaced in R.** `selectTargets()` picks liquidity levels, so TP1 is not 1R by
definition — it is wherever the nearest qualifying level sits. Each leg's R is therefore computed
from its actual price. A useful side effect: the stats reveal whether liquidity-selected targets
land at distances worth trading.

**`rr = 0` guard.** Both existing R calculations already guard `rr > 0` and fall back to `0.0`. A
trade with a zero-width risk cannot open (the open block requires `close < st` or `close > st`), but
the guard is kept for symmetry with the existing code rather than removed as unreachable.

### Win definition

A win is `blendedR > 0`. Exact breakeven — `tpHit = 0` with `closePrice` landing exactly on `entry` —
counts as neither win nor loss, so displayed wins and losses can sum to one less than `n`. This is
rare and is stated in the panel's tooltip rather than papered over by folding zero into losses.

## Accumulation

Plain `var` counters, incremented once per closed trade inside the existing `barstate.isconfirmed`
exit block. `var` commits at bar close, so live-bar recalculation cannot double-count.

| State | Type | Holds |
|---|---|---|
| `statTrades` | `var int` | closed trades |
| `statWins` | `var int` | trades with `blendedR > 0` |
| `statLosses` | `var int` | trades with `blendedR < 0` |
| `statSumR` | `var float` | Σ `blendedR` |
| `statGradeCount` | `var array<int>` (3) | trades per grade, indexed A=0, B=1, C=2 |
| `statGradeSumR` | `var array<float>` (3) | Σ `blendedR` per grade |

Average R is `statSumR / statTrades`, computed at render time. Per-grade average is the same
division per slot. Nothing is stored per trade, so there is no cap and no memory growth.

**Accumulation is never gated by a display input.** `realisedR` is currently computed *inside* the
`if tradeClosed and showTradeHistory` guard. If the counters lived there, switching history labels
off would silently zero the track record. The blended calculation moves out into an unconditional
`if tradeClosed` block; the label guard and the panel then both read the result.

**Expectancy is not a separate row.** With results already denominated in R, per-trade expectancy is
average R. Two rows carrying the same number read as a bug.

## Rendering

A third section on the existing `structPanel`, following the `STRUCTURE` / `TRADE` convention: a
header row with `bgcolor = color.new(color.gray, 50)`, then label/value pairs in the same two
columns.

```
PERFORMANCE    n = 24
Win rate       58%  (14W / 10L)
Avg R          +0.34R
Total R        +8.2R
A grade        +0.81R  (6)
B grade        +0.30R  (11)
C grade        −0.22R  (7)
```

Colour follows the existing result-label rule — green at or above zero, red below — applied to the
four R values and the three grade rows. Note this threshold is `>= 0` while the win test is `> 0`;
they are deliberately different, because matching the established label colour matters more than
agreeing with a counting rule that only affects the rare exact-breakeven trade. `n = 0` renders the
header and a single `—` row rather than seven rows of `NaN`.

### Row indexing

The panel is built as `table.new(panelPos, 2, 5 + confirmRows + tradeRows)` with `tradeBase =
5 + confirmRows`. This design adds `statsRows` (7 when shown and `statTrades > 0`, 2 when shown with
no trades yet, 0 when hidden) and `statsBase = 5 + confirmRows + tradeRows`.

**`statsBase` shifts by 6 rows depending on whether a trade is live**, because `tradeRows` is 6 or 0.
This is the same hazard block C hit when it inserted the confirmation row ahead of the trade rows:
a hardcoded offset produces silently misplaced or blank cells. The row count passed to `table.new`
and every `statsBase + n` must derive from the same expression.

## Inputs

### Group: Trade Engine

| Input | Type | Default | Notes |
|---|---|---|---|
| `showStatsPanel` | `bool` | `true` | Shows the `PERFORMANCE` section. Off hides the rows; the counters keep accumulating regardless. |

Default `true` because the section is the point of the feature. It adds up to 7 rows to a panel that
already reaches 12 with a live trade and the confirmation row on — acceptable, and the reason the
input exists.

## What the numbers cannot tell you

Recorded here so the panel is not over-trusted later.

**The sample is small and invisible.** Stats cover whatever history TradingView loaded, bounded by
`max_bars_back = 5000`. On a 15m chart that is under two months. A 58% win rate over 12 trades is
noise. `n` is displayed in the header for exactly this reason.

**It measures the engine, not the signal.** The single-trade slot skips every setup that appears
while a trade is live, so these are the results of the indicator as configured, not an estimate of
how good the underlying pattern is.

**The numbers move as you tune.** Changing any input recomputes all history. That is the intended
use, but it makes the panel a comparison tool between settings rather than a fixed track record.

**No survivorship of the live trade.** An open trade is not counted until it closes, so the panel
lags reality by one trade.

## Deliberately not built

**Close-reason buckets** (Stopped / Target / Invalidated). Genuinely diagnostic — a large
Invalidated bucket with negative average R would indict the CHoCH exit — but the grade split was
chosen as the single breakdown for this pass. The `closeReason` field already exists, so this is a
later addition of three counters and three rows.

**Long/short split**, **per-target hit rates**, **max drawdown in R**. Each is cheap on its own; all
of them together turn a 7-row section into a second panel. Deferred until the grade split proves
insufficient.

**Persistence across reloads.** Pine has no storage. Every stat is recomputed from loaded history on
every chart load, and that is not fixable within an indicator.

**A `strategy()` variant.** The Strategy Tester would answer these questions properly, with
parameter sweeps and an equity curve. It is a separate script and a separate project, and it would
have to duplicate every detection block in this file to stay in sync.

## Documentation

`README.md` ships with the code that changes it, in the same commits — not afterwards. Three places
need it: the `Settings` section gains `showStatsPanel`; `Reading the trade panel` gains the
`PERFORMANCE` rows and what each means; and the scale-out convention needs stating explicitly next
to it, because a reader who sees `Open R` on a live trade and a blended R on the closed one will
otherwise think the script contradicts itself.

## Testing / Verification

No test framework exists for Pine and no compile check is available in this environment.
Verification is Pine v6 syntax and logic self-review during implementation, plus a deferred human
pass in TradingView covering:

- `n` matches the count of result labels visible on the chart with `showTradeHistory` on
- A trade that visibly reached TP2 and then trailed to breakeven reports a positive blended R, not 0
- Grade bucket counts sum to `n`; grade sub-totals sum to `Total R` within rounding
- Wins + losses equals `n`, or falls short only by trades reporting exactly `0.0R`
- The section renders correctly both with a trade live and with none — the `statsBase` 6-row shift
- Turning `showTradeHistory` off and reloading leaves the stats unchanged
- Turning `showStatsPanel` off removes exactly the `PERFORMANCE` rows and shifts nothing above them
- On a symbol with no closed trades, the header renders with `n = 0` and no `NaN` cells
