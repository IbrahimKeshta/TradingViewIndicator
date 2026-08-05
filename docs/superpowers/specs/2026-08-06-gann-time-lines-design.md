# Gann Time Lines — Design

**Date:** 2026-08-06
**Status:** Approved for planning
**Extends:** `2026-08-05-gann-modes-and-anchors-design.md`
**File:** `src/gann-angles.pine`

## Purpose

Restore Gann time cycles as vertical lines counting forward from each anchor bar, plus a
dedicated time-target table. Every existing element of this indicator measures *price* from an
anchor; nothing measures *time*. This adds the missing axis.

Time cycles were specified in the original `2026-08-04-gann-angles-design.md` and built in commit
`fa7dec2`, then deleted by the Square of 9 rewrite. This is a re-design, not a revert: that version
projected from a single flip-flopping anchor, had no table of its own, and predates the two-anchor
architecture.

## Scope

**In scope:** two sets of vertical cycle lines (one per anchor), their own visibility and style
inputs, on-chart labels, and a separate Cycle/Date/Status table.

**Out of scope:** alerts on cycle arrival, user-editable cycle numbers, cycles measured in calendar
days rather than bars, and any interaction between time cycles and price levels (no "time and price
squared" confluence detection).

## Relationship to modes

Time lines are **independent of the `Mode` dropdown** and draw alongside Gann Fan, Gann Square or
Square of 9 alike.

In particular they are **not** gated on `squareReady`. Gann Square mode blocks its box when the two
anchors are missing or inverted, but a side whose anchor has resolved still has a valid bar to count
from, so its cycles draw regardless of what the box is doing.

A side with no resolved anchor draws no time lines and contributes no time-table rows, matching how
that side's price levels already behave.

## Cycles

Nine fixed cycles, bars forward from the anchor bar:

| Cycle | Group |
|---|---|
| 30 | minor |
| 45 | minor |
| 60 | minor |
| 90 | **major** |
| 120 | minor |
| 144 | minor |
| 180 | **major** |
| 270 | **major** |
| 360 | **major** |

Majors are the squares of 90. The major/minor split mirrors the primary/secondary split the price
levels already use, so the same visual vocabulary carries across both axes.

Both sides use the same nine numbers. `targetBar = anchorBar + N`, per side.

### No clamping required

The Gann Square's width is clamped because a wide price range can push its right edge past Pine's
500-bar forward drawing limit. Time lines need no equivalent guard: an anchor bar is never in the
future (auto anchors sit `lookback` bars back, manual anchors resolve to the last bar at or before
their start date), so the furthest possible target is `bar_index + 360`.

## State

**None.** Target bars are a pure function of the anchor bar, and a cycle's status is
`bar_index >= targetBar` — no history scan, no sticky flag.

This makes time lines a render-only feature. There are no `var` arrays, no rebuild-on-re-anchor
step, and no touch tracking. Everything is computed inside the existing `if barstate.islast` block
and pushed into the existing `drawnLines` / `drawnLabels` arrays, so the current delete-and-clear
cleanup handles removal with no changes.

## Inputs

### Group: Gann Time
| Input | Type | Default |
|---|---|---|
| `Show Time Lines` | bool (master) | `true` |
| `Show Bullish Time Lines` | bool | `true` |
| `Show Bearish Time Lines` | bool | `true` |
| `Show Time Table` | bool | `true` |
| `Time Table Position` | `Top Right` / `Top Left` / `Bottom Right` / `Bottom Left` | `Bottom Right` |

Time-line visibility is deliberately **not** wired to `Show Bullish Levels` / `Show Bearish Levels`.
`Show Bearish Levels` defaults to `false`, so coupling them would hide half of this feature out of
the box.

`Show Time Lines` is the master: with it off, no lines, no labels and no time table render,
whatever the per-side toggles say.

### Group: Time Style
| Input | Type | Default |
|---|---|---|
| `Bull Time Color` | color | `color.blue` |
| `Bear Time Color` | color | `color.purple` |
| `Major Style` | `Solid` / `Dashed` / `Dotted` | `Solid` |
| `Major Width` | int 1–4 | `1` |
| `Minor Style` | `Solid` / `Dashed` / `Dotted` | `Dotted` |
| `Minor Width` | int 1–4 | `1` |

Hue encodes the side; style, width and a transparency step encode major vs minor. Minor lines are
drawn as `color.new(<side colour>, 50)` against a major's `color.new(<side colour>, 0)`.

These are separate from the level style inputs on purpose, so the verticals can be faded to
near-nothing without touching the horizontals.

## Rendering

Inside the existing `barstate.islast` block, after the price levels are drawn:

For each side (bullish, then bearish), when `Show Time Lines` and that side's toggle are on and that
side's anchor is ready, for each of the nine cycles:

```
targetBar = anchorBar + N
isMajor   = N == 90 or N == 180 or N == 270 or N == 360
lineColor = color.new(sideColor, isMajor ? 0 : 50)
line.new(targetBar, high, targetBar, low,
         extend = extend.both,
         color  = lineColor,
         style  = styleFromString(isMajor ? majorStyle : minorStyle),
         width  = isMajor ? majorWidth : minorWidth)
```

`x1 == x2` with `extend.both` produces a full-height vertical line — the same construction commit
`fa7dec2` used. The `high`/`low` y-coordinates are placeholders; only the x matters.

When `Show Labels` is on, each line also gets `label.new(targetBar, high, "Bull T+" + N, style =
label.style_label_down, color = lineColor, textcolor = color.white, size = size.tiny)`, reading
`Bull T+90` / `Bear T+90`. This reuses the existing display toggle rather than adding another.

## Time table

A second `table.new`, separate from the price table, rendered in the same `barstate.islast` block
and deleted first each time like the existing one.

Three columns: **Cycle**, **Date**, **Status**.

Row layout:

1. Header row.
2. Nine bullish rows, when `Show Bullish Time Lines` is on and the bullish anchor is ready.
3. Nine bearish rows, when `Show Bearish Time Lines` is on and the bearish anchor is ready.

A side's table rows and its lines are governed by exactly the same condition, so the table can never
list a cycle that has no line, or omit one that does.

Worst case `1 + 9 + 9 = 19` rows, far inside Pine's 100-row cap, and it never competes with the
price table's budget — which matters because Square of 9 mode already renders 99 of its 100 rows.

`Cycle` reads `Bull T+90` / `Bear T+90`, coloured with that side's time colour. `Status` reads
`Reached` (lime) when `bar_index >= targetBar`, else `Pending` (gray).

If `Show Time Lines` is on but neither side has a resolved anchor, the table renders a single hint
row reading `Waiting for a swing pivot` rather than a bare header, matching the price table's
empty-state behaviour.

### Date column

For a target at or before the current bar, `Date` is the real timestamp of that bar,
`time[offset]` where `offset = bar_index - targetBar`, formatted `yyyy-MM-dd`.

This is a *dynamic* history offset, which Pine cannot always size a buffer for automatically — an
offset larger than the inferred buffer raises a runtime error rather than returning `na`. Two
measures bound it:

- The indicator declaration gains `max_bars_back = 500`, guaranteeing the buffer.
- Lookups are only attempted when `offset <= 500`. A target further back than that (reachable only
  via a manual anchor with an old start date) falls back to the extrapolated form below, counting
  backwards from the current bar.

For a future target Pine does not yet know the bar's timestamp, so it is extrapolated from the
chart's **measured** bar spacing and prefixed `~`:

```
n         = math.min(bar_index, 200)
avgBarMs  = (time - time[n]) / n
estTime   = time + (targetBar - bar_index) * avgBarMs
```

`targetBar - bar_index` is signed, so the same expression also serves the out-of-buffer past case
above by extrapolating backwards.

Deriving spacing from `timeframe.in_seconds()` instead would be badly wrong: it treats every daily
bar as 24 hours, so T+360 would estimate 360 calendar days ahead when 360 trading days is nearer
504 — a five-month error on the most-watched cycle in the set. Measuring the actual spacing bakes in
whatever this instrument really does (weekends, holidays, session breaks, half-days, 24/7 crypto).
On daily equities it converges on roughly 1.4 days per bar and lands T+360 within about a week of
the true date. The residual error is holiday-density drift, which the `~` prefix honestly signals.

When there is too little history to average (`bar_index < 20`), fall back to
`timeframe.in_seconds() * 1000` for the spacing. Also guard `n > 0` so bar zero cannot divide by
zero.

### Known constraint: one table per position

Pine renders only one table per screen position. Setting `Time Table Position` to the same corner as
`Table Position` will make one hide the other. This is not enforceable from script, so the defaults
are different corners (price table `Top Right`, time table `Bottom Right`) and the input carries a
tooltip saying so.

## Object counts

Worst case is Square of 9 mode, 3 rings, both sides visible, all time lines on:

| Object | Existing | Time lines | Total | Declared |
|---|---|---|---|---|
| Lines | 98 | 18 | **116** | 200 |
| Labels | 100 | 18 | **118** | 200 |
| Boxes | 1 | 0 | 1 | 10 |
| Tables | 1 | 1 | 2 | n/a |

The `indicator()` header's count declarations are unchanged. Its one required edit is adding
`max_bars_back = 500`, for the reason given under *Date column*.

## Defaults summary

Time lines on, both sides on, table on at bottom-right, bull cycles blue, bear cycles purple, majors
solid and minors dotted at width 1. Out of the box, adding this to an existing chart draws 18
verticals from the two anchors already seated and a 19-row time table.

## Testing / Verification

No test framework and no Pine compiler in this environment; verification is static Pine v6 review
plus a deferred human pass in TradingView covering:

- Confirm nine verticals rise from each anchor bar, and that counting bars from the anchor marker to
  a major line gives exactly 90 / 180 / 270 / 360.
- Confirm the four majors render solid and the five minors dotted and faded, in each side's hue.
- Confirm bull and bear sets are distinguishable, and that a cycle landing on the same bar from both
  anchors is visible as two overlapping lines rather than one.
- Switch through all three modes and confirm the time lines are unchanged by mode.
- In Gann Square mode with inverted anchors (bearish below bullish), confirm the box shows its guard
  row but the time lines still draw.
- Turn off `Show Bearish Levels` and confirm bearish time lines still draw — they are independently
  toggled.
- Turn off `Show Time Lines` and confirm lines, labels and the time table all disappear together.
- Confirm past cycles read `Reached` with a real date matching the bar the line sits on.
- Confirm future cycles read `Pending` with a `~`-prefixed date, and that on a daily equity chart
  T+360 estimates roughly 17 months out, not 12.
- Set `Time Table Position` to `Top Right` and confirm the expected collision with the price table,
  as documented.
- Load the indicator on a chart with under 20 bars and confirm no divide-by-zero and no error.
- Pin a manual `Bullish Price` with a start date thousands of bars back and confirm the far-past
  cycles show `~`-prefixed estimated dates rather than raising a history-buffer runtime error.
