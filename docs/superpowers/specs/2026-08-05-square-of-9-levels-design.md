# Gann Square of 9 Levels — Design (rewrite)

**Date:** 2026-08-05
**Status:** Approved for planning
**Supersedes:** `2026-08-04-gann-angles-design.md`
**File:** `src/gann-angles.pine` (full rewrite, same path)

## Purpose

Rewrite the Gann Angles indicator as a **pure Square of 9 level tool**. Levels are horizontal
lines derived from a user-entered starting price via the sqrt-based Gann formula, spanning the
full chart width. Two independent sets: a **bullish** set projecting up from one price and a
**bearish** set projecting down from another.

The design mirrors a reference indicator ("GAL") the user supplied screenshots of: levels
labelled `1-22.5°` … `1-360°`, primary angles drawn red/solid and secondary angles
orange/dashed, plus a distinct line marking the starting price itself.

## Problems in the current version this fixes

1. **Lines did not extend.** Levels were drawn from `anchorBarIndex` to `bar_index + forwardProjection`,
   so the user had to drag the anchor backwards to make a line cover the chart. Fixed by removing
   the bar anchor entirely — levels are horizontal and use `extend = extend.both`.
2. **No visual distinction between primary and secondary angles.** Colour was keyed off *ring
   number* (ring 1 blue, rings 2+ orange), which conveys nothing about the angle. Fixed by keying
   style off the angle: multiples of 45° are primary, the 22.5° offsets are secondary.
3. **No starting-point line.** The anchor price had only a floating `Anchor` text label. Fixed with
   a dedicated, separately styled line at the input price.
4. **Movable anchor was unwanted complexity.** Swing-pivot detection, manual anchor time/price/type,
   and the anchor marker are all removed.

## Scope

**In scope:** two-directional Square of 9 levels from two price inputs, primary/secondary styling,
starting-point lines, per-set angle filter, on-chart labels, status table, full styling controls.

**Removed from the previous version:** Gann Fan mode, Gann Square (Box) mode + grid, Gann Time
Levels, the mode dropdown, the whole anchor engine (`ta.pivothigh`/`ta.pivotlow`, `Anchor Mode`,
`Manual Anchor Time`, `Manual Anchor Price`, `Manual Anchor Type`, the `Anchor` label),
`ATR Length`, and `Forward Projection`.

**Out of scope:** alerts, user-editable angle sets, more than one starting price per direction,
plotting an EMA (the reference shows one; it is unrelated to Square of 9 and belongs in a separate
script).

## Architecture

Single self-contained Pine Script v6 `indicator()`, `overlay = true`,
`max_lines_count = 200`, `max_labels_count = 200`.

There is **no per-bar geometry state**. Level prices depend only on inputs, so they are constant
for the life of the script run. Three phases:

1. **Level computation** — once, on the first bar, into `var` arrays.
2. **Touch tracking** — every bar, updating a sticky boolean per level.
3. **Rendering** — once, on `barstate.islast`: delete all drawings, recreate lines, labels and table.

### Modules

1. **Level engine** — builds a `Sq9Level` array per direction.
2. **Touch tracker** — per bar, flips a level's sticky `touched` flag when the bar's range covers it.
3. **Renderer** — lines + labels for both sets plus the two starting-point lines.
4. **Table** — Label / Price / Status readout.

## Inputs

### Group: Bullish
| Input | Type | Default |
|---|---|---|
| `Show Bullish Levels` | bool | `true` |
| `Bullish Price` | float, `minval = 0.0` | `0.0` |
| `Bullish Angles` | string: `All` / `Primary only` / `Secondary only` | `All` |

### Group: Bearish
| Input | Type | Default |
|---|---|---|
| `Show Bearish Levels` | bool | `false` |
| `Bearish Price` | float, `minval = 0.0` | `0.0` |
| `Bearish Angles` | string: `All` / `Primary only` / `Secondary only` | `All` |

### Group: Calculation
| Input | Type | Default |
|---|---|---|
| `Rings` | int, `minval = 1`, `maxval = 3` | `2` |
| `Scale Factor` | float, `minval = 0.001` | `1.0` |

`Rings` is capped at 3 so the table can never exceed Pine's 100-row limit (see *Table* below).

### Group: Bullish Style
| Input | Type | Default |
|---|---|---|
| `Bullish Primary Color` | color | `color.red` |
| `Bullish Primary Style` | `Solid` / `Dashed` / `Dotted` | `Solid` |
| `Bullish Primary Width` | int 1–4 | `2` |
| `Bullish Secondary Color` | color | `color.orange` |
| `Bullish Secondary Style` | `Solid` / `Dashed` / `Dotted` | `Dashed` |
| `Bullish Secondary Width` | int 1–4 | `1` |
| `Bullish Start Color` | color | `color.blue` |
| `Bullish Start Style` | `Solid` / `Dashed` / `Dotted` | `Solid` |
| `Bullish Start Width` | int 1–4 | `2` |

### Group: Bearish Style
Same nine inputs, defaults: primary `color.teal` / Solid / 2, secondary `color.aqua` / Dotted / 1,
start `color.purple` / Solid / 2. Distinct hues so the two sets never read as one.

### Group: Display
| Input | Type | Default |
|---|---|---|
| `Show Labels` | bool | `true` |
| `Label Offset (bars)` | int, `minval = 0`, `maxval = 100` | `5` |
| `Show Table` | bool | `true` |
| `Table Position` | `Top Right` / `Top Left` / `Bottom Right` / `Bottom Left` | `Top Right` |

`Show Labels` and `Show Table` are independent — either, both, or neither.

## Level computation

For a set with starting price `P`, scale factor `k`, and direction `d` (`+1` bullish, `−1` bearish):

```
root = sqrt(P × k)
for r = 1 to Rings:
    for s = 1 to 16:
        n      = (r − 1) × 16 + s
        offset = root + d × n × 0.125
        if offset > 0:
            price = offset² / k
            angle = s × 22.5
            label = "R" + r + "-" + angle + "°"
```

A level whose `offset` is `≤ 0` (a bearish set reaching below zero) is skipped entirely — no line,
no label, no table row. The whole set is skipped when `P ≤ 0` or its `Show` toggle is off.

### Primary vs secondary

Classification is **by angle only**, never by ring. `isPrimary = (s % 2 == 0)`, i.e. `s` even →
angle is a multiple of 45°.

| Angles | Group |
|---|---|
| 45°, 90°, 135°, 180°, 225°, 270°, 315°, 360° | **Primary** |
| 22.5°, 67.5°, 112.5°, 157.5°, 202.5°, 247.5°, 292.5°, 337.5° | **Secondary** |

`R1-45°` and `R2-45°` therefore render identically. The `Bullish Angles` / `Bearish Angles` filter
drops the other group from lines, labels and table together.

### Starting-point line

Each visible set draws one extra line at exactly its input price, using that set's Start
colour/style/width, labelled `Bull Start: <price>` / `Bear Start: <price>`. It is not a Square of 9
level — it is excluded from the angle filter and from touch tracking, and it appears as its own
table row.

## Touch tracking

Each level carries a sticky `touched` bool, `false` at first bar. On every bar, for every level:

```
if not touched and low <= price and high >= price:
    touched := true
```

Once true it stays true for the rest of the chart — it answers "has price traded through this level
anywhere in loaded history", which is well-defined without an anchor bar. Table `Status` renders
`Touched` (lime) or `Pending` (gray).

## Rendering

All drawing occurs inside a single `if barstate.islast` block:

1. Delete every line in the persistent line array and every label in the persistent label array; clear both.
2. For each visible set, for each level passing the angle filter:
   - `line.new(bar_index, price, bar_index + 1, price, extend = extend.both, color = …, style = …, width = …)`
   - if `Show Labels`: `label.new(bar_index + labelOffset, price, "<label>: <price>", style = label.style_label_left, color = <line colour>, textcolor = color.white, size = size.small)`
3. Draw each visible set's starting-point line and label the same way.

`extend.both` is what makes lines cover the entire chart and every future bar with no anchor to drag.
Because rendering only runs on the last bar and clears first, changing any input redraws immediately
and leaves no stale objects.

### Object counts

Worst case (3 rings, both sets, `All`): `3 × 16 × 2 = 96` levels + 2 starting lines = **98 lines,
98 labels** — well under the declared 200/200.

## Table

`table.new` at `Table Position`, 3 columns: **Label**, **Price**, **Status**.

Row layout, in order, with no section sub-headers:

1. Header row (`Label` / `Price` / `Status`).
2. Bullish start row, then bullish level rows, if the bullish set is visible.
3. Bearish start row, then bearish level rows, if the bearish set is visible.

The `Label` cell is coloured to match its line, which is what separates the two sets visually and
removes the need for sub-headers.

Worst case: `1 + (1 + 48) + (1 + 48) = 99` rows — inside Pine's 100-row cap, which is why `Rings`
maxes at 3. Row count is still computed as `math.min(needed, 100)` and the render loop bounded by it,
so a future change to the ring cap degrades by truncating rather than erroring.

Starting-point rows show `—` in the Status column (they are not levels and are not tracked).

## Defaults summary

Bullish on, bearish off, 2 rings, scale factor 1.0, labels on, table on top-right, label offset 5.
Out of the box the user sets one number — `Bullish Price` — and gets 32 levels plus a starting line
matching the reference's look.

## Testing / Verification

No automated test framework and no TradingView compile check in this environment; verification is
Pine v6 syntax/logic self-review during implementation plus a deferred human pass covering:

- Set `Bullish Price` and confirm 32 levels draw across the **entire** chart width, left edge to
  right edge, with nothing to drag.
- Confirm primaries (45° multiples) are red/solid/2 and secondaries orange/dashed/1 in **both** rings —
  `R1-45°` and `R2-45°` identical.
- Confirm the blue starting-point line sits exactly at `Bullish Price`.
- Enable the bearish set with a higher price and confirm levels descend, in the bearish colours, and
  that none are drawn at or below zero.
- Set each angle filter to `Primary only` and `Secondary only` and confirm lines, labels and table
  rows all filter together.
- Toggle `Show Labels` and `Show Table` independently and confirm each hides on its own.
- Change every style input and confirm each maps to the right group.
- Set `Rings` to 3 with both sets on and confirm 98 lines draw and the table renders 99 rows.
- Confirm `Status` flips to `Touched` for levels price has traded through.
