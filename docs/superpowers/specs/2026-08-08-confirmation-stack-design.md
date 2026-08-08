# Confirmation Stack — Design

**Date:** 2026-08-08
**Status:** Implemented on `feat/confirmation-stack` (`19f7c54`..`3c06d31`) — TradingView verification pending
**File:** `src/ict-rsi-ma-indicator.pine`
**Block:** C of the roadmap — the last one
**Depends on:** `2026-08-07-trade-engine-design.md` (D+E, implemented and running in TradingView)

## Purpose

Add volume, climax candles, MACD, Stochastic and Ichimoku to the trade gate as **scored points, never
vetoes**, and fix the grade arithmetic so that a bigger denominator does not silently loosen the gate.

The trade engine was built with this block in mind. `scoreTally()` carries the comment *"the confirmation
block still to come adds five more points to this function"*, and the score's denominator was made
proportional precisely so points could be added later without turning them into requirements. This spec
collects on that.

## Scope

**In scope:** three new scored points and their member indicators; the grade rule; the `minScore`
default; the Kumo cloud as an optional drawing; one panel row; the inputs; the data-window debug series;
the README.

**Out of scope:** anything that changes the hard requirements; MACD and Stochastic plots; divergence
detection; Chikou; a Tenkan/Kijun cross point; alert changes.

## Why three points and not five

The obvious reading of the roadmap is five new points — volume, climax, MACD, Stochastic, Ichimoku — one
each. That was rejected.

A confluence score only means something if its points are **independent**. RSI is already a point, and
MACD and Stochastic are both momentum measured from the same price series. Counted separately, momentum
would cast three of ten votes while structure cast one, and a setup could clear `minScore` on momentum
agreeing with itself three times. That is not confluence, it is one opinion repeated.

So correlated indicators collapse into a single vote:

| Point | Members | Measures |
|---|---|---|
| **Momentum** | RSI, MACD, Stochastic | is price accelerating on the trade's side |
| **Participation** | volume surge, climax candle | is anyone actually trading here |
| **Ichimoku** | the Kumo | is the longer-term regime on the trade's side |

Five points become three, and the seven-point gate keeps the property that every point answers a
different question.

## The gate after this block

Hard requirements are **unchanged** — internal trend has a direction, price touched an unmitigated
FVG or order block, `inRange` is false, `barstate.isconfirmed`.

| # | Point | Earned when | Status |
|---|---|---|---|
| 1 | Killzone | `killzoneActive` | existing |
| 2 | Momentum | majority of enabled members agree | **RSI folds into this** |
| 3 | Moving average | price on the trade's side of the MA | existing |
| 4 | Major agreement | `majorState.trend == intState.trend` | existing |
| 5 | Break strength | `intState.lastStrength >= strongBreakMult` | existing |
| 6 | Participation | majority of enabled members fire | **new** |
| 7 | Ichimoku | price on the trade's side of the Kumo | **new** |

### The majority rule

A grouped point is earned when **at least half its enabled members, rounded up**, agree:
`int(math.ceil(n / 2.0))` — 2 of 3, 1 of 2, 1 of 1.

Rounding up rather than requiring a strict majority keeps the rule monotonic. A strict majority would
need 2 of 2 but only 2 of 3, so switching an indicator *off* would make the point *easier* to earn —
the same class of bug the proportional denominator exists to prevent.

**When every member of a group is disabled, the whole point removes itself from the denominator.** This
is the killzone safety net at line 502 generalised: a permanently-false point left in the denominator
would either make `minScore` unreachable or, worse, look like a tightening while actually loosening the
gate.

## What each new member tests

### Momentum

| Member | Long | Short | Defaults |
|---|---|---|---|
| RSI | `rsiValue > 50` | `rsiValue < 50` | existing `rsiLength` |
| MACD | MACD line > signal | MACD line < signal | 12 / 26 / 9 |
| Stochastic | %K > %D | %K < %D | 14 / 3 / 3 |

RSI reuses the existing `rsiBullishConfirm` / `rsiBearishConfirm` values rather than recomputing.

Stochastic is deliberately read as `%K` versus `%D` rather than as an overbought/oversold level. In a
trending market the oscillator pins to its extreme and stays there, so a level test would veto exactly
the continuation setups this engine is built to take.

### Participation

| Member | Test |
|---|---|
| Volume surge | volume **on the zone-touch bar** ≥ `volMult × ta.sma(volume, volLen)` |
| Climax | within a window of `climaxBars` bars ending at the current bar, a bar **against** the trade direction with range ≥ `climaxRangeMult × ATR`, volume ≥ `climaxVolMult × ta.sma(volume, volLen)`, and its close in the far third of its own range |

Defaults: `volMult` 1.5, `volLen` 20, `climaxRangeMult` 2.0, `climaxVolMult` 2.0, `climaxBars` 3.

The **zone-touch bar is the current bar** — the gate only evaluates at all when `bullTouch.hit` or
`bearTouch.hit` is true, and those are current-bar conditions. The volume member is therefore a plain
test on `volume`, with no stored bar index. It is described as the touch bar rather than "this bar"
because that is *why* the bar matters.

The climax window is **inclusive of the current bar** — at the default of 3 it covers the current bar
and the two before it. Scanning `for i = 0 to climaxBars - 1`.

"Against the trade direction" means a down bar for a long and an up bar for a short. "Far third" means
`close <= low + (high - low) / 3` for a long's down bar, and `close >= high - (high - low) / 3` for a
short's up bar.

**Climax is read as exhaustion, not displacement.** This engine buys a pullback into a level. A heavy
down bar closing on its low *into* support is the pullback spending itself — the classic selling
climax, and the bar the reversal starts from. A heavy up bar just before you buy a pullback means you
are late. The sense of this test is therefore inverted relative to the trade's side, and that is
intentional.

**Why two members that look nested.** A climax bar is by definition also a volume surge, so if both
tested the same bar the climax member would contribute nothing. They are scoped to different bars on
purpose: the volume member asks *"is there participation at this level, on the bar that touched it"*,
and the climax member asks *"did the pullback exhaust itself in the last few bars"*. Different
questions, different bars, so both earn their place — but the overlap is real and is why they share one
point rather than holding two.

**Symbols without volume.** A `var bool` latch records whether a positive, non-`na` volume has ever
printed on the chart. Until it has, **both members are treated as disabled** and the Participation point
leaves the denominator. Without this, every forex chart would carry a permanently-dark point. The latch
is used rather than a per-bar `na(volume)` test because a single legitimately-zero bar in a thin session
must not disable the point for that bar only, which would make the denominator flicker between `/6` and
`/7` and change the grade for reasons that have nothing to do with the setup.

### Ichimoku

Standard periods: Tenkan 9, Kijun 26, Senkou B 52, displacement 26.

```
tenkan   = (highest(9)  + lowest(9))  / 2
kijun    = (highest(26) + lowest(26)) / 2
senkouA  = (tenkan + kijun) / 2        plotted 26 bars forward
senkouB  = (highest(52) + lowest(52)) / 2   plotted 26 bars forward
```

The point is earned when `close` is beyond **both** spans — above both for a long, below both for a
short. Inside the cloud earns nothing, which is correct: the cloud is the region where the regime is
undecided.

**The comparison uses `senkouA[displacement]` and `senkouB[displacement]`.** The cloud visible at the
current bar was computed 26 bars ago and drawn forward, so the current bar's cloud values are the
26-bar-old series values. Comparing `close` against the undelayed `senkouA` would compare price to a
cloud that will not be drawn for another 26 bars.

**Chikou is not computed and not scored.** It is the close displaced 26 bars *backwards*, so any test
involving it asks whether price today is above price 26 bars ago and reports the answer as though it
were known 26 bars ago. Every other confirmation in this codebase is evaluated on closed bars for
exactly this reason.

## Grade arithmetic

Grades move from absolute shortfall to the **achieved fraction of enabled points**:

```pinescript
gradeFor(int score, int ofPoints) =>
    score * 100 >= 90 * ofPoints ? "A" : score * 100 >= 75 * ofPoints ? "B" : "C"
```

Integer arithmetic, not floats, so no rounding sits between a setup and its grade.

The old rule — all enabled = A, one short = B, two short = C — did not scale. "Two short" is 3/5 on one
chart and 8/10 on another, and both graded C.

**This reproduces current behaviour exactly at five points**, which is what makes it safe to change:

| Enabled | A | B | C |
|---|---|---|---|
| 5 (today) | 5 | 4 | 3 or below |
| 7 (this block) | 7 | 6 | 5 or below |
| 4 | 4 | 3 | 2 or below |

At five points that table is identical to the current rule. The rules only diverge once the denominator
moves, which is the entire purpose.

Below four enabled points, B is unreachable: at 3, `A` and `B` both round up to a score of 3 (2.7 and
2.25 each ceil to 3), so only `A` and `C` can appear. B needs a denominator of at least 4 to exist.

C is the fallback branch, not a threshold — `minScore` is what stops a weak setup appearing at all. At
seven points with `minScore` 5, the lowest grade that can reach the chart is 5/7.

### `minScore` default

Raised from **4 to 5**. At seven points, leaving it at 4 would mean 4/7 — a materially *looser* gate
than today's 4/5, arriving as a side effect of adding confirmations. That is the exact failure the
proportional denominator was built to prevent, and the default has to move with the point count.

**TradingView stores settings per saved chart, and Pine cannot migrate them.** Anyone already running
this indicator keeps `minScore` 4 after the upgrade and gets the looser gate until they change it by
hand. This is unavoidable; it is handled with a changed default, a note in the input's tooltip, and a
line in the README rather than pretended away.

## Rendering

| Element | Default | Notes |
|---|---|---|
| Kumo cloud (Senkou A/B fill) | **off** | The only new drawing |
| Panel row `Confirm` | on, own toggle | `Mom ✓ · Part — · Ichi ✓` |

Nothing else is drawn. MACD and Stochastic are oscillators and this is an `overlay = true` script — they
have no pane to live in, and forcing them onto the price scale would be meaningless. That constraint
sets the pattern for the whole block: **the confirmation stack is read in the panel, not on the chart.**

The panel row shows which points carried the setup, not just the fraction. `4/7` tells you a setup was
adequate; `Mom ✓ · Part — · Ichi ✓` tells you it was adequate *without participation*, which is the part
you can act on.

**The trade rows must be re-indexed.** The panel is `table.new(panelPos, 2, 5 + tradeRows)` and the trade
rows are written at hardcoded indices 5 through 10. Inserting a confirmation row before them breaks
those constants, so the trade block must take its row numbers from a base offset rather than literals.
This is the only structural change to existing code in this block.

## Inputs

New group **Confirmations**:

| Input | Type | Default |
|---|---|---|
| `Score: Momentum` | bool | on |
| `Momentum: RSI` | bool | on |
| `Momentum: MACD` | bool | on |
| `Momentum: Stochastic` | bool | on |
| `MACD Fast / Slow / Signal` | int | 12 / 26 / 9 |
| `Stochastic %K / Smooth / %D` | int | 14 / 3 / 3 |
| `Score: Participation` | bool | on |
| `Participation: Volume Surge` | bool | on |
| `Participation: Climax Candle` | bool | on |
| `Volume Average Length` | int | 20 |
| `Volume Surge (x average)` | float | 1.5 |
| `Climax Range (x ATR)` | float | 2.0 |
| `Climax Volume (x average)` | float | 2.0 |
| `Climax Lookback (bars)` | int | 3 |
| `Score: Ichimoku` | bool | on |
| `Tenkan / Kijun / Senkou B / Displacement` | int | 9 / 26 / 52 / 26 |
| `Show Kumo Cloud` | bool | **off** |
| `Show Confirmation Panel Row` | bool | on |

Plus two colours for the bullish and bearish cloud fill.

`Score: RSI` is **renamed** to `Momentum: RSI` and moves into this group. It keeps its behaviour as a
test; what changes is that it now contributes to a group vote rather than being a point of its own.

Renaming an input changes the key TradingView stores it under, so a saved chart loses its value for
this one and falls back to the default. The default is `on` and the old default was `on`, so the reset
is harmless here — but it is the reason the rename is safe, and the reason `Minimum Score` cannot be
fixed the same way. Renaming *that* to force a reset would silently discard a threshold the user
deliberately tuned, which is worse than the looser gate it would correct.

## Integration

1. **Confirmations are computed before `scoreTally()`**, which sits at line 507. A new section goes
   after the RSI/MA block and before the trade engine gate.
2. **`scoreTally()` gains three branches**, following the existing one-pass shape that counts enabled
   and achieved points together. The comment at line 504 warns against splitting these into parallel
   lists; that stays true with seven points.
3. **`gradeFor()` is replaced** by the fractional version.
4. **The panel's trade rows are re-indexed** off a base offset.
5. **Nothing else changes.** Hard requirements, target selection, the trailing stop, exits, alerts and
   every existing drawing are untouched.

## Deliberately not built

**Divergence detection** on RSI, MACD or Stochastic. It needs its own pivot tracking on the oscillator
series, which is a block-A-sized piece of work hiding inside a scored point.

**A Tenkan/Kijun cross point.** It is a moving-average cross, and the MA point already occupies that
slot. Adding it would reintroduce the correlation problem this block was shaped to avoid.

**Volume profile or delta.** Pine has no order-flow data on a standard chart; anything labelled "delta"
here would be inferred from candle shape and dressed up as something it is not.

**Per-point weighting.** Considered and rejected: it turns an integer score anyone can check by eye into
a float, and makes "why is this 6.2 out of 8.5" a question with no good on-chart answer.

## Testing / Verification

No Pine compiler or test runner in this environment; verification is static Pine v6 review plus a human
pass in TradingView. Hidden `display = display.data_window` plots expose each new point and each member
as 1/0 series, so every check below is read as a number rather than eyeballed.

- Confirm the denominator reads `/7` at defaults, and that the panel fraction matches the count of
  ticked points in the `Confirm` row.
- Disable all three momentum members and confirm the denominator drops to `/6` while the Momentum
  toggle is still on — the group safety net.
- Disable two of three momentum members and confirm the point needs the remaining one (1 of 1).
- With all three enabled, confirm exactly two agreeing earns the point and exactly one does not.
- On a forex or index symbol with no volume, confirm the denominator drops to `/6` and no error appears.
- Confirm a heavy down bar closing on its low, into the zone, earns Participation on a **long** — and
  that a heavy up bar in the same place does not.
- Confirm the Ichimoku point agrees with the drawn cloud: switch `Show Kumo Cloud` on and check that
  the point is dark whenever price sits inside the cloud.
- Verify the displacement by hand: at some bar, confirm the cloud values used by the score match the
  cloud drawn at that bar, not the one 26 bars later.
- Set five points enabled and confirm grades match the pre-block-C behaviour exactly (5=A, 4=B, 3=C).
- Confirm `minScore` 5 rejects a 4/7 setup, and that raising it to 7 admits only A grades.
- Confirm the trade rows still render correctly with the confirmation row present, both while a trade
  is live and while flat.
- Confirm no drawing appears anywhere on the chart with `Show Kumo Cloud` off. Check specifically that
  the two `offset = 26` plots do not reserve 26 bars of empty space to the right of the last bar — they
  plot `na`, so they should not, but offset reservation is worth eyeballing rather than assuming.
- Print a bar with `na` volume if the symbol ever produces one, and confirm the denominator stays at
  `/7` rather than dropping for the next 20 bars. This was a real bug found in review: `ta.sma` over
  raw `volume` propagates `na` across its whole window, and the fix averages `nz(volume)` instead.
