# Gann Angles — Modes and Anchors (design)

**Date:** 2026-08-05
**Status:** Approved for planning
**Extends:** `2026-08-05-square-of-9-levels-design.md` (the Square of 9 rewrite, already built)
**File:** `src/gann-angles.pine`

## Purpose

Restore Gann Fan and Gann Square alongside the rebuilt Square of 9, and replace the deleted
anchor engine with **two independent, per-direction anchors** that can each auto-seat to a wide
swing pivot or be pinned by hand.

This exists because the Square of 9 rewrite dropped too much: the Fan and Square modes, and — more
seriously — any notion of a start point, which made Touched status scan all loaded history and
mark essentially every level as touched.

## Problems this fixes

1. **Touched status was meaningless.** With no start bar, a level price crossed years ago read
   `Touched`. Now each side tracks touches only from its own anchor bar forward.
2. **Gann Fan and Gann Square were removed.** Both return, driven by the new anchor layer.
3. **The original anchor engine flip-flopped.** It took *whichever* swing was more recent — high or
   low — as a single anchor, so a new opposite-type pivot would move the anchor, reverse the
   projection direction, delete every line and reset every flag. Replaced by two independent
   anchors that cannot overwrite each other.
4. **Fan geometry drifted silently.** Slope came from live `ta.atr()`, recomputed every bar, so the
   fan steepened and flattened with volatility even though the anchor never moved. ATR is now
   sampled once at the anchor bar and held.
5. **The Gann Square was not square.** Its width came from wherever the opposing pivot happened to
   land, making the 1×1 diagonal meaningless. Width is now derived from the price range.

## Carried over unchanged from the Square of 9 rewrite

Primary/secondary styling driven by the angle, the nine style inputs per direction, starting-point
lines, per-direction angle filters, `Rings`, `Scale Factor`, on-chart labels, the Label/Price/Status
table, table position, and the empty-state hint row.

## Anchors

Two anchors, one per direction, resolved independently every bar. Neither reads the other.

### Inputs (group: Anchor)

| Input | Type | Default |
|---|---|---|
| `Swing Pivot Lookback` | int, `minval = 2` | `50` |
| `Bullish Price` | float, `minval = 0.0` | `0.0` |
| `Bullish Start Date` | time | `2024-01-01 00:00 UTC` |
| `Bearish Price` | float, `minval = 0.0` | `0.0` |
| `Bearish Start Date` | time | `2024-01-01 00:00 UTC` |
| `Show Anchor Markers` | bool | `true` |

### Resolution

**Auto (the default, when the side's price input is `0`):**
- Bullish anchor = the most recent confirmed `ta.pivotlow(low, lookback, lookback)`.
- Bearish anchor = the most recent confirmed `ta.pivothigh(high, lookback, lookback)`.
- The anchor bar is `bar_index - lookback` — the pivot's own bar, not the confirmation bar.
- Each side keeps its own pivot type. A new swing high can never move the bullish anchor.

**Manual (when the side's price input is `> 0`):**
- Anchor price = the typed price.
- Anchor bar = the last bar whose `time <= <side> Start Date`.
- That side stops tracking pivots entirely. The other side is unaffected — one side may be pinned
  while the other auto-seats.

A side with no resolvable anchor (auto mode before its first pivot confirms) draws nothing for that
direction and contributes no table rows.

### Frozen ATR

`ta.atr(atrLength)` is computed every bar as a series, but each anchor **samples it once, at its own
anchor bar, and holds it**. In auto mode that is `atrValue[lookback]` at the confirmation bar; in
manual mode it is the value at the bar matching the start date. This frozen value is the
price-per-bar unit for that side's Fan slopes and for the Square's width. It is re-sampled only when
that side's anchor re-seats.

### Anchor markers

When `Show Anchor Markers` is on, one small non-interactive `label` is drawn at each resolved
anchor bar/price, reading `Bull Anchor` / `Bear Anchor`. They are display-only — nothing is
draggable, and no marker feeds back into any calculation.

## Modes

`Mode` — `Gann Fan` / `Gann Square` / `Square of 9`, default `Square of 9`. Mutually exclusive.

**All three modes draw horizontal lines.** This matches the reference indicator the user is working
from and matches commit `b1cfc38`, which deliberately converted Fan and Square from diagonals to
horizontal levels. Every line begins at its side's anchor bar and uses `extend = extend.right`.

### Gann Fan

Nine ratio levels per direction. For ratio multiplier `m` and that side's frozen ATR unit `u`, over
a projection of `p` bars (`Fan Projection (bars)`, group Gann Fan, default `100`, `minval = 1`,
`maxval = 500`):

```
levelPrice = anchorPrice + d * m * u * p        (d = +1 bullish, -1 bearish)
```

| Ratio | `m` | Group |
|---|---|---|
| 1x8 | 1/8 | secondary |
| 1x4 | 1/4 | **primary** |
| 1x3 | 1/3 | secondary |
| 1x2 | 1/2 | **primary** |
| 1x1 | 1 | **primary** |
| 2x1 | 2 | **primary** |
| 3x1 | 3 | secondary |
| 4x1 | 4 | **primary** |
| 8x1 | 8 | secondary |

A bearish level computing to `<= 0` is skipped entirely.

### Gann Square

One box plus its grid plus nine ratio levels per direction. Requires both anchors resolved and
`bearishAnchorPrice > bullishAnchorPrice`; otherwise the box and grid are skipped and a single table
row reads `Square needs bearish price above bullish`.

```
priceRange   = bearAnchorPrice - bullAnchorPrice
unit         = frozen ATR of the earlier (left-edge) anchor
boxWidthBars = math.max(1, math.min(2000, int(math.round(priceRange / unit))))
boxLeft      = math.min(bullAnchorBar, bearAnchorBar)
boxRight     = boxLeft + boxWidthBars
boxBottom    = bullAnchorPrice
boxTop       = bearAnchorPrice
```

Deriving the width from the price range is what makes the box square in Gann terms, so its 1×1
diagonal carries meaning. `Box Grid Divisions` (group Gann Square, default `8`, `minval = 1`,
`maxval = 20`) subdivides it with thin neutral grid lines in both directions.

The nine ratio levels per direction are horizontal, at `boxBottom + priceRange * m / (1 + m)`,
using the same primary/secondary split as the Fan.

### Square of 9

Exactly as already built — `rings × 16` levels per direction at 22.5° increments, primary =
multiples of 45° (`s % 2 == 0`) — with one change: each direction's levels now begin at that
direction's anchor bar and use `extend.right`, instead of spanning the chart with `extend.both`.

The starting-point line per direction is unchanged and applies in all three modes.

## Touched status

Per level, sticky, and gated on its own side's anchor:

```
if bar_index >= <side>AnchorBar and not lvl.touched and low <= lvl.price and high >= lvl.price
    lvl.touched := true
```

When a side's anchor re-seats, that side's level array is rebuilt and every flag on it resets to
`false` — correct, because the measurement origin changed.

**Known limitation, inherent to pivot confirmation:** an auto anchor is only known `lookback` bars
after its own bar, so the bars between the pivot and its confirmation are never evaluated for
touches. At the default lookback of 50 that is a 50-bar blind spot immediately after each
re-seat. Avoiding it entirely requires pinning the price by hand. This is documented, not fixed.

## Rendering

Level arrays can no longer be built once on `barstate.isfirst`, because an anchor can re-seat
mid-chart. Instead, per side, per bar: if that side's resolved anchor price or bar differs from the
previous bar's, clear and rebuild that side's array. Touch tracking then runs every bar over the
current arrays.

Drawing remains a single `barstate.islast` block that deletes every line, label and box, clears the
arrays, and recreates them from current state — so any input change redraws cleanly.

### Object counts (worst case)

| Mode | Lines | Labels | Boxes |
|---|---|---|---|
| Gann Fan | 18 + 2 start = 20 | 20 + 2 markers | 0 |
| Gann Square | 18 + 2 start + 38 grid = 58 | 20 + 2 markers | 1 |
| Square of 9 | 96 + 2 start = 98 | 98 + 2 markers | 0 |

Declaration: `max_lines_count = 200`, `max_labels_count = 200`, `max_boxes_count = 10`.

## Table

Unchanged in shape — Label / Price / Status, three columns, coloured per set, `—` status on
starting-point rows. Row counts by mode: Fan and Square `1 + (1+9) + (1+9) = 21`; Square of 9
worst case `99`. Both within Pine's 100-row cap, so `Rings` stays capped at 3.

The existing empty-state hint row still fires when neither side resolves an anchor, with its text
generalised to `Set a price or wait for a swing pivot`.

## Defaults summary

Mode `Square of 9`, both anchors auto with `Swing Pivot Lookback = 50`, ATR length 14, anchor
markers on, Fan projection 100, box grid divisions 8, rings 2, scale factor 1.0, labels on, table on
top-right. Out of the box the user adds the indicator and both sides seat themselves to the most
recent major swing low and swing high.

## Testing / Verification

No test framework and no Pine compiler in this environment; verification is static Pine v6 review
plus a deferred human pass in TradingView covering:

- With both prices at `0`, confirm each side seats to a wide pivot and the anchor markers land on
  plausible major turning points.
- Confirm a new swing high never moves the bullish anchor, and vice versa.
- Type a `Bullish Price` and confirm only that side pins while the bearish side keeps auto-seating.
- Confirm Touched reads `Pending` for levels price crossed before the anchor bar — the specific bug
  that prompted this work.
- Switch through all three modes and confirm each renders from the same anchors.
- Confirm Fan levels do not move when volatility changes but the anchor does not (frozen ATR).
- Confirm the Gann Square's width visibly tracks its price range, and that reversed anchors produce
  the guard row rather than an inverted box.
- Confirm primary ratios (1x1, 1x2, 2x1, 1x4, 4x1) and 45° multiples render in the primary style in
  their respective modes.
