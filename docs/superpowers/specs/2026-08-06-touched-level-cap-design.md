# Touched-Level Cap — Design

**Date:** 2026-08-06
**Status:** Approved for planning — not yet implemented
**Extends:** `2026-08-05-gann-modes-and-anchors-design.md`
**File:** `src/gann-angles.pine`

## Purpose

Cap how many **touched** Gann levels are shown, keeping only the ones nearest the current price.

On a long chart nearly every level reads `Touched`. A live example: SKPC monthly, Square of 9, two
rings, bullish only — 33 of 35 rows read `Touched`, and the two `Pending` levels that actually
matter are buried among them. The same clutter exists on the chart itself as ~35 horizontal lines.

A touched level is still live support/resistance when price is near it, and pure history when it is
far away. Ranking by distance from the close is what separates the two.

## Scope

**In scope:** one input capping touched levels per direction; the cap applied to table rows, lines
and price labels together.

**Out of scope:** capping `Pending` levels (they are the ones being waited on), any cap on the time
table's `Reached` cycles (19 rows maximum — not the crowded readout, and "nearest current price" has
no meaning for a time cycle), and recency-based selection (it would need a touch-bar field on every
level, adding per-bar state to a script that currently has almost none).

## Relationship to the existing angle filter

The cap is a **second, independent filter** stacked on the existing `Bullish Angles` /
`Bearish Angles` filter. A level draws when it passes **both**.

Like the angle filter, it governs the table row, the horizontal line and the price label as one
unit — there is never a line on screen with no row explaining it.

## Input

### Group: Display
| Input | Type | Default |
|---|---|---|
| `Max Touched Levels` | int, `minval = 0`, `maxval = 100` | `5` |

Applied **per direction**: with both sides visible you see at most 5 touched bullish levels and 5
touched bearish. This matches how the angle filter already works — per side, not global.

- `0` hides every touched level, leaving only `Pending` levels and the start line.
- `100` exceeds the worst-case count of 48 levels per side (3 rings × 16), so it means "show all"
  and is the escape hatch. The tooltip must say so explicitly — it is otherwise not discoverable.

**On the default of 5:** this changes what an existing chart displays the moment it is applied — the
SKPC example above drops from 35 rows to about 7. That is the intent; the unreadable table is why
this exists. Defaulting to `100` to preserve current behaviour was considered and rejected as
shipping the feature switched off.

**The cap applies in all three modes**, not only Square of 9. The default of 5 is motivated above by
the 35-row Square of 9 case, but Gann Fan and Gann Square each produce only 9 levels per side. In
Gann Square mode in particular, most of those 9 will typically read `Touched`, so a default of 5 can
trim up to 4 of 9 rows from a table that was not crowded to begin with. Raise `Max Touched Levels`
(or set it to `100`) on those modes if the default feels overeager.

## Selection

Rank the side's touched levels by `math.abs(lvl.price - close)` and keep the nearest N.

`close` is the live, intrabar close on the current bar, not a confirmed value — so on the last bar
the cutoff recomputes on every tick and the set of surviving touched levels can change mid-bar as
price crosses a boundary. This is the correct behaviour of "nearest current price," not a bug.

Implemented as a **cutoff distance** rather than sort-and-slice: Pine can sort a `float` array but
cannot carry the original indices through the sort, so sorting distances and reading back which
levels they belonged to is not directly expressible.

```
touchedCutoff(levels, maxTouched, filterMode):
    dists = []
    for lvl in levels:
        if lvl.touched and passesFilter(lvl.isPrimary, filterMode):
            dists.push(abs(lvl.price - close))
    if maxTouched <= 0:            return -1.0      # nothing passes; distances are always >= 0
    if size(dists) <= maxTouched:  return na        # no filtering needed
    sort(dists, ascending)
    return dists[maxTouched - 1]                    # the Nth smallest distance
```

A level then passes when:

```
not lvl.touched or na(cutoff) or math.abs(lvl.price - close) <= cutoff
```

`na` means "no filtering" and `-1.0` means "exclude all touched" — both fall out of the same
comparison without a separate flag.

### The cutoff respects the angle filter

Distances are collected only from levels that **already pass the angle filter**. If they were not,
setting `Bullish Angles` to `Primary only` could let the angle filter remove several of the N
nearest, and fewer than N touched levels would survive — the user would ask for 5 and get 2.

### Ties

Two levels at exactly equal distance from the close both pass, so the visible count can occasionally
be N+1. Resolving it properly requires index-carrying through the sort, which Pine makes clumsy.
With real prices an exact tie is vanishingly rare. **Documented, not fixed.**

## Where it runs

Two `var float` cutoffs — `bullTouchCutoff`, `bearTouchCutoff` — assigned in a small block placed
between `TOUCH TRACKING` and `RENDERER`, guarded by `barstate.islast`:

```pinescript
var float bullTouchCutoff = na
var float bearTouchCutoff = na
if barstate.islast
    bullTouchCutoff := touchedCutoff(bullLevels, maxTouchedLevels, bullishAngles)
    bearTouchCutoff := touchedCutoff(bearLevels, maxTouchedLevels, bearishAngles)
```

The `barstate.islast` guard matters: without it the sort would run on every historical bar of the
chart. `var` is what lets the `TABLE` section further down the file read the same values the
`RENDERER` section used.

## Signature changes

Both gain a `float touchCutoff` parameter:

- `drawSet(...)` — adds the predicate alongside its existing `passesFilter` check.
- `countRows(...)` — same.

`countRows` is the one that must not drift: it computes `neededRows` for `table.new`, so if its
filtering diverged from the row-writing loops' filtering by a single level, the table would be
mis-sized and rows would be silently dropped or a blank row left at the bottom. Passing the
identical cutoff to both is what holds them in lockstep — the same invariant the existing
`visible` / `filterMode` arguments already maintain.

## What is unaffected

- **Start lines and anchor markers** are not levels and are not touch-tracked. They always draw, and
  a side whose levels are all filtered out still shows its start row.
- **The time table** is untouched.
- **Object budgets.** The filter only ever removes lines, labels and rows. Worst case is unchanged —
  it is "nothing touched yet", where the filter does nothing — so `max_lines_count = 200`,
  `max_labels_count = 200` and the 100-row table cap all remain valid without recalculation.
- **Gann Square mode**, where the nine levels live in `bullLevels` and `bearLevels` stays empty, needs
  no special handling: the bearish cutoff is computed over an empty array and returns `na`.

## Testing / Verification

No test framework and no Pine compiler in this environment; verification is static Pine v6 review
plus a deferred human pass in TradingView covering:

- On the SKPC monthly chart from the report above, confirm the table drops from 35 rows to about 7
  and that the surviving touched levels are the ones bracketing current price.
- Confirm the filtered levels lose their line, their label and their table row together — no
  orphaned line with no row, and no row with no line.
- Set `Max Touched Levels` to `0` and confirm only `Pending` levels and the start line remain.
- Set it to `100` and confirm every level returns, matching today's behaviour exactly.
- Set `Bullish Angles` to `Primary only` with the cap at 5 and confirm 5 touched *primary* levels
  survive — not 5 chosen from all angles and then thinned to 2 by the angle filter.
- Confirm the table is correctly sized in each case: no blank trailing row, no truncated last level.
- Switch to Gann Square mode and confirm the empty `bearLevels` array causes no error.
- Confirm a side whose touched levels are all filtered out still shows its start row.
- Watch a live bar on a fast timeframe and confirm the cutoff's intrabar churn — lines, labels and
  rows appearing or disappearing together as `close` crosses a level's distance boundary — reads as
  acceptable behaviour rather than as a glitch.
