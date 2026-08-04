# Gann Square of 9 Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `src/gann-angles.pine` as a pure Square of 9 level indicator: two independent price inputs (bullish/bearish) each producing full-chart-width horizontal levels, styled by angle (primary vs secondary) rather than by ring, with a starting-point line, on-chart labels and a status table — and no bar anchor of any kind.

**Architecture:** Level prices depend only on inputs, so they are computed once into `var` arrays on the first bar. A per-bar loop maintains a sticky touched flag per level. All drawing happens in a single `barstate.islast` block that deletes every previous line/label and recreates them, so any input change redraws cleanly with no stale objects and no redraw-trigger bookkeeping.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review, plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-05-square-of-9-levels-design.md`

## Global Constraints

- Full rewrite of the existing `src/gann-angles.pine` — same path, file contents fully replaced. Declaration: `indicator("Gann Square of 9 Levels", shorttitle = "GannSq9", overlay = true, max_lines_count = 200, max_labels_count = 200)`.
- **Deleted entirely** (do not carry any of it forward): `Mode` dropdown, Gann Fan renderer, Gann Square (Box) renderer + `boxGridDivisions` + box/grid lines, Gann Time Levels + `gannTimeCycles` + `GannTimeLevel` type, `ta.pivothigh`/`ta.pivotlow` swing detection, `anchorModeInput`, `pivotLookback`, `manualAnchorTime`, `manualAnchorPrice`, `manualAnchorTypeInput`, the `anchorMarker` label, `anchorBarIndex`/`anchorPrice`/`anchorType`/`opposingPrice`/`opposingBarIndex`, `atrLength`/`priceUnit`, `forwardProjection`, `gannRatioLabels`, `gannRatioMultipliers`, `previousMode`, `previousShowTimeLevels`.
- Every level line uses `extend = extend.both`. This is the fix for the reported bug where lines had to be extended by dragging the anchor backwards. No line may be drawn with `extend.right` or a bounded right endpoint.
- Square of 9 formula, per set with starting price `P`, scale factor `k`, direction `d` (`+1.0` bullish, `-1.0` bearish), for ring `r = 1..Rings` and step `s = 1..16`: `n = (r - 1) * 16 + s`, `offset = math.sqrt(P * k) + d * n * 0.125`, and if `offset > 0` then `price = math.pow(offset, 2) / k`, `angle = s * 22.5`, `label = "R" + r + "-" + angle + "°"`. An `offset <= 0` level is skipped entirely (no line, no label, no table row). A set with `P <= 0` produces zero levels.
- **Primary/secondary classification is by angle only, never by ring:** `isPrimary = s % 2 == 0`. Primary angles are 45°, 90°, 135°, 180°, 225°, 270°, 315°, 360°; secondary are 22.5°, 67.5°, 112.5°, 157.5°, 202.5°, 247.5°, 292.5°, 337.5°. `R1-45°` and `R2-45°` must render identically.
- Default styling — bullish: primary `color.red`/Solid/2, secondary `color.orange`/Dashed/1, start `color.blue`/Solid/2. Bearish: primary `color.teal`/Solid/2, secondary `color.aqua`/Dotted/1, start `color.purple`/Solid/2.
- `Rings` is `input.int(2, minval = 1, maxval = 3)`. The cap of 3 exists so the table can never exceed Pine's 100-row limit: worst case is `1 + (1 + 48) + (1 + 48) = 99` rows.
- The starting-point line is not a Square of 9 level: it is exempt from the angle filter, has no touched tracking, and shows `—` in the table's Status column.
- Touched status is sticky and never resets: `if not lvl.touched and low <= lvl.price and high >= lvl.price` → `lvl.touched := true`. It means "price has traded through this level somewhere in loaded chart history".
- `Show Labels` and `Show Table` are fully independent booleans — either, both, or neither.
- **Loop-direction footgun (carried over from this project's earlier `mitigateBoxes` bug):** any `for i = X to Y` loop where `Y` can be less than `X` at runtime MUST be wrapped in a size guard. `for i = 0 to -1` does NOT skip — Pine infers direction at runtime and runs it descending as a 2-iteration loop. The `for x in someArray` form has no such problem and needs no guard; prefer it throughout this plan.
- Pine v6 user-defined type instances are reference types: a `for x in array<UDT>` loop variable refers to the same object stored in the array, so `x.field := value` mutates it in place. The touched-flag logic depends on this. Arrays are likewise references, so a function may `array.push` into a global array.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Inputs, level engine, touch tracking

**Files:**
- Modify: `src/gann-angles.pine` (replace entire file contents)

**Interfaces:**
- Produces: inputs `showBullish`, `bullishPrice`, `bullishAngles`, `showBearish`, `bearishPrice`, `bearishAngles`, `ringCount`, `scaleFactor`, `bullPrimaryColor`, `bullPrimaryStyle`, `bullPrimaryWidth`, `bullSecondaryColor`, `bullSecondaryStyle`, `bullSecondaryWidth`, `bullStartColor`, `bullStartStyle`, `bullStartWidth`, `bearPrimaryColor`, `bearPrimaryStyle`, `bearPrimaryWidth`, `bearSecondaryColor`, `bearSecondaryStyle`, `bearSecondaryWidth`, `bearStartColor`, `bearStartStyle`, `bearStartWidth`, `showLabels`, `labelOffset`, `showTable`, `tablePosInput`; the type `Sq9Level` (fields `price` float, `label` string, `isPrimary` bool, `touched` bool); functions `styleFromString(string) => int` and `passesFilter(bool, string) => bool`; arrays `bullLevels` and `bearLevels` (`array<Sq9Level>`).

- [ ] **Step 1: Replace the whole file with the scaffolding**

Overwrite `src/gann-angles.pine` entirely with:

```pinescript
//@version=6
indicator("Gann Square of 9 Levels", shorttitle = "GannSq9", overlay = true, max_lines_count = 200, max_labels_count = 200)

// ============================================================
// INPUTS
// ============================================================

// ---------------- Bullish ----------------
showBullish   = input.bool(true, "Show Bullish Levels", group = "Bullish")
bullishPrice  = input.float(0.0, "Bullish Price", minval = 0.0, group = "Bullish", tooltip = "Starting price for the upward level set. Levels project above this price.")
bullishAngles = input.string("All", "Bullish Angles", options = ["All", "Primary only", "Secondary only"], group = "Bullish")

// ---------------- Bearish ----------------
showBearish   = input.bool(false, "Show Bearish Levels", group = "Bearish")
bearishPrice  = input.float(0.0, "Bearish Price", minval = 0.0, group = "Bearish", tooltip = "Starting price for the downward level set. Levels project below this price.")
bearishAngles = input.string("All", "Bearish Angles", options = ["All", "Primary only", "Secondary only"], group = "Bearish")

// ---------------- Calculation ----------------
ringCount   = input.int(2, "Rings", minval = 1, maxval = 3, group = "Calculation", tooltip = "Each ring is 16 levels at 22.5-degree increments. Capped at 3 so the table stays within Pine's 100-row limit.")
scaleFactor = input.float(1.0, "Scale Factor", minval = 0.001, group = "Calculation")

// ---------------- Bullish Style ----------------
bullPrimaryColor   = input.color(color.red, "Primary", group = "Bullish Style", inline = "bullPri")
bullPrimaryStyle   = input.string("Solid", "", options = ["Solid", "Dashed", "Dotted"], group = "Bullish Style", inline = "bullPri")
bullPrimaryWidth   = input.int(2, "", minval = 1, maxval = 4, group = "Bullish Style", inline = "bullPri")
bullSecondaryColor = input.color(color.orange, "Secondary", group = "Bullish Style", inline = "bullSec")
bullSecondaryStyle = input.string("Dashed", "", options = ["Solid", "Dashed", "Dotted"], group = "Bullish Style", inline = "bullSec")
bullSecondaryWidth = input.int(1, "", minval = 1, maxval = 4, group = "Bullish Style", inline = "bullSec")
bullStartColor     = input.color(color.blue, "Start Line", group = "Bullish Style", inline = "bullStart")
bullStartStyle     = input.string("Solid", "", options = ["Solid", "Dashed", "Dotted"], group = "Bullish Style", inline = "bullStart")
bullStartWidth     = input.int(2, "", minval = 1, maxval = 4, group = "Bullish Style", inline = "bullStart")

// ---------------- Bearish Style ----------------
bearPrimaryColor   = input.color(color.teal, "Primary", group = "Bearish Style", inline = "bearPri")
bearPrimaryStyle   = input.string("Solid", "", options = ["Solid", "Dashed", "Dotted"], group = "Bearish Style", inline = "bearPri")
bearPrimaryWidth   = input.int(2, "", minval = 1, maxval = 4, group = "Bearish Style", inline = "bearPri")
bearSecondaryColor = input.color(color.aqua, "Secondary", group = "Bearish Style", inline = "bearSec")
bearSecondaryStyle = input.string("Dotted", "", options = ["Solid", "Dashed", "Dotted"], group = "Bearish Style", inline = "bearSec")
bearSecondaryWidth = input.int(1, "", minval = 1, maxval = 4, group = "Bearish Style", inline = "bearSec")
bearStartColor     = input.color(color.purple, "Start Line", group = "Bearish Style", inline = "bearStart")
bearStartStyle     = input.string("Solid", "", options = ["Solid", "Dashed", "Dotted"], group = "Bearish Style", inline = "bearStart")
bearStartWidth     = input.int(2, "", minval = 1, maxval = 4, group = "Bearish Style", inline = "bearStart")

// ---------------- Display ----------------
showLabels    = input.bool(true, "Show Labels", group = "Display")
labelOffset   = input.int(5, "Label Offset (bars)", minval = 0, maxval = 100, group = "Display")
showTable     = input.bool(true, "Show Table", group = "Display")
tablePosInput = input.string("Top Right", "Table Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Display")

// ============================================================
// HELPERS
// ============================================================
styleFromString(string s) =>
    switch s
        "Dashed" => line.style_dashed
        "Dotted" => line.style_dotted
        => line.style_solid

passesFilter(bool isPrimary, string filterMode) =>
    filterMode == "All" or (filterMode == "Primary only" and isPrimary) or (filterMode == "Secondary only" and not isPrimary)

// ============================================================
// LEVEL ENGINE
// ============================================================
type Sq9Level
    float  price
    string label
    bool   isPrimary
    bool   touched

var Sq9Level[] bullLevels = array.new<Sq9Level>()
var Sq9Level[] bearLevels = array.new<Sq9Level>()

buildLevels(Sq9Level[] target, float startPrice, int rings, float scale, float direction) =>
    if startPrice > 0
        root = math.sqrt(startPrice * scale)
        for r = 1 to rings
            for s = 1 to 16
                n      = (r - 1) * 16 + s
                offset = root + direction * n * 0.125
                if offset > 0
                    lvlPrice  = math.pow(offset, 2) / scale
                    angle     = s * 22.5
                    lvlLabel  = "R" + str.tostring(r) + "-" + str.tostring(angle, "#.#") + "°"
                    isPrimary = s % 2 == 0
                    array.push(target, Sq9Level.new(lvlPrice, lvlLabel, isPrimary, false))
    array.size(target)

if barstate.isfirst
    buildLevels(bullLevels, bullishPrice, ringCount, scaleFactor, 1.0)
    buildLevels(bearLevels, bearishPrice, ringCount, scaleFactor, -1.0)

// ============================================================
// TOUCH TRACKING
// ============================================================
for lvl in bullLevels
    if not lvl.touched and low <= lvl.price and high >= lvl.price
        lvl.touched := true

for lvl in bearLevels
    if not lvl.touched and low <= lvl.price and high >= lvl.price
        lvl.touched := true
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each of these, one by one:

1. The file contains **no** occurrence of `pivot`, `anchor`, `Anchor`, `atr`, `box.`, `forwardProjection`, `modeInput`, or `TimeLevel`. Search for each term.
2. `buildLevels` ends with `array.size(target)` — a Pine function's last statement must be an expression that yields a value; a bare `if` block as the final statement is a compile error.
3. Both `for r = 1 to rings` and `for s = 1 to 16` have compile-time-safe bounds (`rings` is `minval = 1`, so `1 to rings` never inverts). No size guard is needed for either, and the two touch-tracking loops use the `for ... in` form, which needs none.
4. `isPrimary = s % 2 == 0` is present, and no colour or style anywhere depends on `r`.
5. Every `input.color`, `input.string` and `input.int` sharing an `inline` value is in the same `group`.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: rewrite Gann indicator as Square of 9 levels - inputs and level engine"
```

---

### Task 2: Renderer — full-width lines, starting-point lines, labels

**Files:**
- Modify: `src/gann-angles.pine` (append)

**Interfaces:**
- Consumes: everything Task 1 produces — `Sq9Level`, `bullLevels`, `bearLevels`, `styleFromString`, `passesFilter`, all style/display inputs.
- Produces: arrays `drawnLines` (`array<line>`) and `drawnLabels` (`array<label>`); functions `drawSet(...)` and `drawStartLine(...)`.

- [ ] **Step 1: Append the renderer**

Append to the end of `src/gann-angles.pine`:

```pinescript
// ============================================================
// RENDERER
// ============================================================
var line[]  drawnLines  = array.new<line>()
var label[] drawnLabels = array.new<label>()

drawStartLine(float startPrice, bool visible, color lineColor, string lineStyle, int lineWidth, string lineLabel) =>
    if visible and startPrice > 0
        array.push(drawnLines, line.new(bar_index, startPrice, bar_index + 1, startPrice, extend = extend.both, color = lineColor, style = styleFromString(lineStyle), width = lineWidth))
        if showLabels
            array.push(drawnLabels, label.new(bar_index + labelOffset, startPrice, lineLabel + ": " + str.tostring(startPrice, format.mintick), style = label.style_label_left, color = lineColor, textcolor = color.white, size = size.small))
    array.size(drawnLines)

drawSet(Sq9Level[] levels, bool visible, string filterMode, color priColor, string priStyle, int priWidth, color secColor, string secStyle, int secWidth) =>
    if visible
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
                lvlColor = lvl.isPrimary ? priColor : secColor
                lvlStyle = styleFromString(lvl.isPrimary ? priStyle : secStyle)
                lvlWidth = lvl.isPrimary ? priWidth : secWidth
                array.push(drawnLines, line.new(bar_index, lvl.price, bar_index + 1, lvl.price, extend = extend.both, color = lvlColor, style = lvlStyle, width = lvlWidth))
                if showLabels
                    array.push(drawnLabels, label.new(bar_index + labelOffset, lvl.price, lvl.label + ": " + str.tostring(lvl.price, format.mintick), style = label.style_label_left, color = lvlColor, textcolor = color.white, size = size.small))
    array.size(drawnLines)

if barstate.islast
    for ln in drawnLines
        line.delete(ln)
    array.clear(drawnLines)
    for lb in drawnLabels
        label.delete(lb)
    array.clear(drawnLabels)

    drawStartLine(bullishPrice, showBullish, bullStartColor, bullStartStyle, bullStartWidth, "Bull Start")
    drawSet(bullLevels, showBullish, bullishAngles, bullPrimaryColor, bullPrimaryStyle, bullPrimaryWidth, bullSecondaryColor, bullSecondaryStyle, bullSecondaryWidth)
    drawStartLine(bearishPrice, showBearish, bearStartColor, bearStartStyle, bearStartWidth, "Bear Start")
    drawSet(bearLevels, showBearish, bearishAngles, bearPrimaryColor, bearPrimaryStyle, bearPrimaryWidth, bearSecondaryColor, bearSecondaryStyle, bearSecondaryWidth)
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm:

1. **Every** `line.new` call in the file passes `extend = extend.both`. Search for `line.new` and check each hit — this is the whole point of the rewrite. Zero occurrences of `extend.right` or `extend.left` should exist.
2. Both `drawStartLine` and `drawSet` end with `array.size(drawnLines)` (the expression-as-last-statement rule from Task 1).
3. The delete-then-redraw block clears `drawnLines` **and** `drawnLabels` before any `drawStartLine`/`drawSet` call, so no stale object can survive an input change.
4. Labels use `label.style_label_left` at `bar_index + labelOffset`, and every `label.new` is guarded by `if showLabels`.
5. Worst-case object count: `3 rings × 16 × 2 sets = 96` levels + 2 start lines = 98 lines and 98 labels, both under the declared `max_lines_count = 200` / `max_labels_count = 200`.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: draw Square of 9 levels as full-width lines with primary/secondary styling"
```

---

### Task 3: Status table

**Files:**
- Modify: `src/gann-angles.pine` (append)

**Interfaces:**
- Consumes: everything Tasks 1–2 produce.
- Produces: `sq9Table` (`var table`); function `countRows(Sq9Level[], bool, string, float) => int`.

- [ ] **Step 1: Append the table**

Append to the end of `src/gann-angles.pine`:

```pinescript
// ============================================================
// TABLE
// ============================================================
var table sq9Table = na

countRows(Sq9Level[] levels, bool visible, string filterMode, float startPrice) =>
    total = 0
    if visible and startPrice > 0
        total := 1
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
                total += 1
    total

if barstate.islast
    table.delete(sq9Table)
    if showTable
        tablePos = switch tablePosInput
            "Top Right"    => position.top_right
            "Top Left"     => position.top_left
            "Bottom Right" => position.bottom_right
            => position.bottom_left
        neededRows = 1 + countRows(bullLevels, showBullish, bullishAngles, bullishPrice) + countRows(bearLevels, showBearish, bearishAngles, bearishPrice)
        rowCount   = math.min(neededRows, 100)
        sq9Table := table.new(tablePos, 3, rowCount, bgcolor = color.new(color.black, 80), border_width = 1)
        table.cell(sq9Table, 0, 0, "Label", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(sq9Table, 1, 0, "Price", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(sq9Table, 2, 0, "Status", text_color = color.white, bgcolor = color.new(color.gray, 50))

        nextRow = 1
        if showBullish and bullishPrice > 0 and nextRow < rowCount
            table.cell(sq9Table, 0, nextRow, "Bull Start", text_color = bullStartColor)
            table.cell(sq9Table, 1, nextRow, str.tostring(bullishPrice, format.mintick), text_color = color.white)
            table.cell(sq9Table, 2, nextRow, "—", text_color = color.gray)
            nextRow += 1
            for lvl in bullLevels
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bullishAngles)
                    table.cell(sq9Table, 0, nextRow, lvl.label, text_color = lvl.isPrimary ? bullPrimaryColor : bullSecondaryColor)
                    table.cell(sq9Table, 1, nextRow, str.tostring(lvl.price, format.mintick), text_color = color.white)
                    table.cell(sq9Table, 2, nextRow, lvl.touched ? "Touched" : "Pending", text_color = lvl.touched ? color.lime : color.gray)
                    nextRow += 1

        if showBearish and bearishPrice > 0 and nextRow < rowCount
            table.cell(sq9Table, 0, nextRow, "Bear Start", text_color = bearStartColor)
            table.cell(sq9Table, 1, nextRow, str.tostring(bearishPrice, format.mintick), text_color = color.white)
            table.cell(sq9Table, 2, nextRow, "—", text_color = color.gray)
            nextRow += 1
            for lvl in bearLevels
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bearishAngles)
                    table.cell(sq9Table, 0, nextRow, lvl.label, text_color = lvl.isPrimary ? bearPrimaryColor : bearSecondaryColor)
                    table.cell(sq9Table, 1, nextRow, str.tostring(lvl.price, format.mintick), text_color = color.white)
                    table.cell(sq9Table, 2, nextRow, lvl.touched ? "Touched" : "Pending", text_color = lvl.touched ? color.lime : color.gray)
                    nextRow += 1
```

- [ ] **Step 2: Verify by self-review**

Read the whole file top to bottom and confirm:

1. `countRows` ends with `total` — an expression, not an `if` block.
2. Every `table.cell` write is guarded by `nextRow < rowCount`, so a row index can never exceed the table's declared height.
3. `rowCount` is `math.min(neededRows, 100)`; both arguments are `int`, so the result is `int` as `table.new` requires.
4. Worst case row arithmetic: 3 rings, both sets visible, both filters `All` → `1 + (1 + 48) + (1 + 48) = 99 ≤ 100`.
5. Starting-point rows show `"—"` in the Status column and are excluded from `passesFilter`.
6. The table has exactly 3 columns (Label / Price / Status) and no section sub-headers — `Label` cells are coloured per set instead.

- [ ] **Step 3: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-05-square-of-9-levels-design.md` alongside the finished file and confirm each of the four reported problems is addressed:

1. Lines extend across the full chart — every `line.new` uses `extend.both`, and no input controls line origin or length.
2. Primary vs secondary is visually distinct and keyed off `s % 2 == 0`, not off `r`.
3. A starting-point line exists per visible set, with its own colour/style/width inputs.
4. No anchor of any kind remains — grep the file for `anchor`, `pivot`, `swing` and confirm zero hits.

Also confirm no leftover input is orphaned: every `input.*` variable declared in Task 1 is actually read somewhere in Tasks 2–3. List them and check each.

- [ ] **Step 4: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add Label/Price/Status table for Square of 9 levels"
```

---

### Task 4: Update the README-level documentation trail

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-gann-angles-design.md` (add superseded banner)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Mark the old spec superseded**

Insert immediately after the `**Status:**` line in `docs/superpowers/specs/2026-08-04-gann-angles-design.md`:

```markdown
> **Superseded on 2026-08-05** by `2026-08-05-square-of-9-levels-design.md`. The Gann Fan, Gann Square (Box), Gann Time Levels and the whole anchor engine described below were removed; `src/gann-angles.pine` is now a pure Square of 9 level indicator. This document is kept for history only.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-gann-angles-design.md
git commit -m "docs: mark original Gann Angles spec superseded"
```

---

## Deferred human verification (TradingView)

Not executable in this environment. Hand these to the user after Task 4:

- Set `Bullish Price` to a real swing low and confirm 32 levels draw across the **entire** chart width — left edge to right edge — with nothing to drag.
- Confirm primaries (45° multiples) render red/solid/2 and secondaries orange/dashed/1 in **both** rings; `R1-45°` and `R2-45°` must look identical.
- Confirm the blue starting-point line sits exactly at `Bullish Price`.
- Enable the bearish set with a higher price; confirm levels descend in the bearish colours and none draw at or below zero.
- Set each angle filter to `Primary only` then `Secondary only`; confirm lines, labels and table rows filter together.
- Toggle `Show Labels` and `Show Table` independently; confirm each hides on its own.
- Change every style input and confirm each maps to the intended group.
- Set `Rings` to 3 with both sets visible; confirm 98 lines draw and the table renders 99 rows without error.
- Confirm `Status` reads `Touched` for levels price has traded through and `Pending` otherwise.
