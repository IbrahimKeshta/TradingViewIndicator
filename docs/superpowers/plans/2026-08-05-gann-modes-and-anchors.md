# Gann Modes and Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Gann Fan and Gann Square alongside the existing Square of 9, driven by two independent per-direction anchors that each auto-seat to a wide swing pivot or can be pinned by hand, and gate Touched status on each side's anchor bar.

**Architecture:** An anchor engine resolves a price, bar and frozen ATR unit per direction, independently — the bullish side tracks swing lows, the bearish side tracks swing highs, and neither can overwrite the other. A mode switch selects which builder fills the two `GannLevel` arrays; the arrays rebuild whenever their side's anchor re-seats. Rendering and the table stay a single `barstate.islast` delete-and-recreate block.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-05-gann-modes-and-anchors-design.md`

**Starting point:** `src/gann-angles.pine` at commit `e2aa141` — the completed Square of 9 rewrite. This plan modifies that file in place. The style inputs, `styleFromString`, `passesFilter`, the label/table rendering shape and the empty-state hint row all survive; the level engine, renderer and anchor handling change.

## Global Constraints

- Declaration becomes: `indicator("Gann Angles", shorttitle = "GannAngles", overlay = true, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 10)`
- **Two independent anchors. Neither side ever reads the other's pivot.** The bullish anchor tracks `ta.pivotlow` only; the bearish anchor tracks `ta.pivothigh` only. The original engine's "whichever pivot is more recent wins" logic must not reappear in any form — it is the defect this work exists to remove.
- Auto anchor bar is `bar_index - pivotLookback` (the pivot's own bar), never the confirmation bar.
- A side is in **manual** mode when its price input is `> 0`: price = the typed value, bar = the last bar with `time <= <side> Start Date`, and that side stops consulting pivots. The other side is unaffected.
- **Frozen ATR.** Each anchor samples `ta.atr(atrLength)` once at its own anchor bar and holds it: `atrValue[pivotLookback]` in auto mode, `atrValue` at the matching bar in manual mode. Live per-bar ATR must never reach a slope calculation — that drift is a defect being fixed.
- **All three modes draw horizontal lines**, each beginning at its side's anchor bar with `extend = extend.right`. No diagonals. No `extend.both`.
- Ratio table, fixed order and classification: `1x8` (m=1/8, secondary), `1x4` (1/4, **primary**), `1x3` (1/3, secondary), `1x2` (1/2, **primary**), `1x1` (1, **primary**), `2x1` (2, **primary**), `3x1` (3, secondary), `4x1` (4, **primary**), `8x1` (8, secondary).
- Square of 9 classification is unchanged: `isPrimary = s % 2 == 0` (45° multiples). Formula unchanged: `n = (r-1)*16 + s`, `offset = math.sqrt(P*k) + d*n*0.125`, skip if `offset <= 0`, `price = math.pow(offset,2)/k`, label `"R" + r + "-" + angle + "°"`.
- Fan level price: `anchorPrice + d * m * unit * fanProjection`. Skip any level computing to `<= 0`.
- Gann Square: `boxWidthBars = math.max(1, math.min(2000, int(math.round(priceRange / leftUnit))))` where `priceRange = bearAnchorPrice - bullAnchorPrice` and `leftUnit` is the frozen ATR of whichever anchor is further left. Box requires both anchors ready **and** `bearAnchorPrice > bullAnchorPrice`; otherwise skip the box and show the guard row.
- Square mode produces **one** set of nine levels, held in `bullLevels`, styled with the bullish inputs. `bearLevels` stays empty in Square mode. Both starting-point lines still draw.
- Touched is sticky and gated: `if <side>AnchorReady and bar_index >= <side>AnchorBar` wraps the tracking loop. A side's array is cleared and its flags reset whenever that side's anchor re-seats.
- `Rings` stays `input.int(2, minval = 1, maxval = 3)`. Table row cap logic (`math.min(neededRows, 100)` plus a `nextRow < rowCount` guard on every `table.cell`) is preserved exactly.
- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` block as the final statement is a compile error. Every builder and helper must end on an expression.
- **Loop-direction footgun:** `for i = X to Y` where `Y` can be less than `X` at runtime does NOT skip — Pine infers direction at runtime and runs it descending. Guard any such loop with a size check. `for x in someArray` needs no guard; prefer it.
- Pine v6 UDT instances and arrays are reference types: `for lvl in bullLevels` yields the stored object, so `lvl.touched := true` mutates in place, and a function may `array.push` into a global array.
- Time input defaults use a literal millisecond timestamp, not `timestamp()` — see commit `ae145cf`, which fixed exactly this. `2024-01-01 00:00 UTC` is `1704067200000`.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Inputs, ratio tables, anchor engine

**Files:**
- Modify: `src/gann-angles.pine` — replace the declaration and the INPUTS section, and insert the ratio tables and anchor engine before the existing `HELPERS` section.

**Interfaces:**
- Produces: inputs `modeInput`, `pivotLookback`, `bullishPrice`, `bullishStartDate`, `bearishPrice`, `bearishStartDate`, `showAnchorMarkers`, `showBullish`, `bullishAngles`, `showBearish`, `bearishAngles`, `atrLength`, `fanProjection`, `boxGridDivisions`, `ringCount`, `scaleFactor`, all eighteen style inputs (unchanged names), `showLabels`, `labelOffset`, `showTable`, `tablePosInput`; arrays `ratioLabels`, `ratioMultipliers`, `ratioIsPrimary`; and the resolved anchor series `bullAnchorPrice`, `bullAnchorBar`, `bullAnchorUnit`, `bullAnchorReady`, `bullAnchorChanged` plus the four bearish equivalents; and `squareReady`, `squareBlocked`.

- [ ] **Step 1: Replace the declaration and INPUTS section**

Replace lines 1–48 of `src/gann-angles.pine` (from `//@version=6` through the `tablePosInput` line inclusive) with:

```pinescript
//@version=6
indicator("Gann Angles", shorttitle = "GannAngles", overlay = true, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 10)

// ============================================================
// INPUTS
// ============================================================

// ---------------- Mode ----------------
modeInput = input.string("Square of 9", "Mode", options = ["Gann Fan", "Gann Square", "Square of 9"], group = "Mode")

// ---------------- Anchor ----------------
pivotLookback     = input.int(50, "Swing Pivot Lookback", minval = 2, group = "Anchor", tooltip = "How many bars either side a bar must dominate to count as a swing. Wider values find only major turning points and hold still for longer, but confirm this many bars late.")
bullishPrice      = input.float(0.0, "Bullish Price", minval = 0.0, group = "Anchor", tooltip = "Leave at 0 to auto-anchor to the most recent confirmed swing low. Type a price to pin this side permanently.")
bullishStartDate  = input.time(1704067200000, "Bullish Start Date", group = "Anchor", tooltip = "Used only when Bullish Price is set. In auto mode the pivot's own bar is the start.")
bearishPrice      = input.float(0.0, "Bearish Price", minval = 0.0, group = "Anchor", tooltip = "Leave at 0 to auto-anchor to the most recent confirmed swing high. Type a price to pin this side permanently.")
bearishStartDate  = input.time(1704067200000, "Bearish Start Date", group = "Anchor", tooltip = "Used only when Bearish Price is set.")
showAnchorMarkers = input.bool(true, "Show Anchor Markers", group = "Anchor")

// ---------------- Bullish ----------------
showBullish   = input.bool(true, "Show Bullish Levels", group = "Bullish")
bullishAngles = input.string("All", "Bullish Angles", options = ["All", "Primary only", "Secondary only"], group = "Bullish")

// ---------------- Bearish ----------------
showBearish   = input.bool(false, "Show Bearish Levels", group = "Bearish")
bearishAngles = input.string("All", "Bearish Angles", options = ["All", "Primary only", "Secondary only"], group = "Bearish")

// ---------------- Scaling ----------------
atrLength = input.int(14, "ATR Length", minval = 1, group = "Scaling", tooltip = "Sets the price-per-bar unit for Fan slopes and the Square's width. Sampled once at each anchor bar and held, so geometry does not drift as volatility changes.")

// ---------------- Gann Fan ----------------
fanProjection = input.int(100, "Fan Projection (bars)", minval = 1, maxval = 500, group = "Gann Fan", tooltip = "How far along each angle the price is read to place its horizontal level.")

// ---------------- Gann Square ----------------
boxGridDivisions = input.int(8, "Box Grid Divisions", minval = 1, maxval = 20, group = "Gann Square")

// ---------------- Square of 9 ----------------
ringCount   = input.int(2, "Rings", minval = 1, maxval = 3, group = "Square of 9", tooltip = "Each ring is 16 levels at 22.5-degree increments. Capped at 3 so the table stays within Pine's 100-row limit.")
scaleFactor = input.float(1.0, "Scale Factor", minval = 0.001, group = "Square of 9", tooltip = "Controls level spacing. Higher values tighten the levels together, lower values spread them apart. Raise this on high-priced instruments where the default packs all levels into a narrow band.")

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
// RATIO TABLE
// ============================================================
var string[] ratioLabels      = array.from("1x8", "1x4", "1x3", "1x2", "1x1", "2x1", "3x1", "4x1", "8x1")
var float[]  ratioMultipliers = array.from(1.0/8, 1.0/4, 1.0/3, 1.0/2, 1.0, 2.0, 3.0, 4.0, 8.0)
var bool[]   ratioIsPrimary   = array.from(false, true, false, true, true, true, false, true, false)

// ============================================================
// ANCHOR ENGINE
// ============================================================
atrValue = ta.atr(atrLength)

swingLowRaw  = ta.pivotlow(low, pivotLookback, pivotLookback)
swingHighRaw = ta.pivothigh(high, pivotLookback, pivotLookback)

var float autoBullPrice = na
var int   autoBullBar   = na
var float autoBullUnit  = na
if not na(swingLowRaw)
    autoBullPrice := swingLowRaw
    autoBullBar   := bar_index - pivotLookback
    autoBullUnit  := atrValue[pivotLookback]

var float autoBearPrice = na
var int   autoBearBar   = na
var float autoBearUnit  = na
if not na(swingHighRaw)
    autoBearPrice := swingHighRaw
    autoBearBar   := bar_index - pivotLookback
    autoBearUnit  := atrValue[pivotLookback]

var int   manualBullBar  = na
var float manualBullUnit = na
if time <= bullishStartDate
    manualBullBar  := bar_index
    manualBullUnit := atrValue

var int   manualBearBar  = na
var float manualBearUnit = na
if time <= bearishStartDate
    manualBearBar  := bar_index
    manualBearUnit := atrValue

bullManual = bullishPrice > 0
bearManual = bearishPrice > 0

bullAnchorPrice = bullManual ? bullishPrice   : autoBullPrice
bullAnchorBar   = bullManual ? manualBullBar  : autoBullBar
bullAnchorUnit  = bullManual ? manualBullUnit : autoBullUnit

bearAnchorPrice = bearManual ? bearishPrice   : autoBearPrice
bearAnchorBar   = bearManual ? manualBearBar  : autoBearBar
bearAnchorUnit  = bearManual ? manualBearUnit : autoBearUnit

bullAnchorReady = not na(bullAnchorPrice) and not na(bullAnchorBar) and not na(bullAnchorUnit) and bullAnchorPrice > 0 and bullAnchorUnit > 0
bearAnchorReady = not na(bearAnchorPrice) and not na(bearAnchorBar) and not na(bearAnchorUnit) and bearAnchorPrice > 0 and bearAnchorUnit > 0

var float prevBullPrice = na
var int   prevBullBar   = na
var float prevBearPrice = na
var int   prevBearBar   = na

bullAnchorChanged = bullAnchorReady and (na(prevBullPrice) or bullAnchorPrice != prevBullPrice or bullAnchorBar != prevBullBar)
bearAnchorChanged = bearAnchorReady and (na(prevBearPrice) or bearAnchorPrice != prevBearPrice or bearAnchorBar != prevBearBar)

if bullAnchorChanged
    prevBullPrice := bullAnchorPrice
    prevBullBar   := bullAnchorBar
if bearAnchorChanged
    prevBearPrice := bearAnchorPrice
    prevBearBar   := bearAnchorBar

squareReady   = modeInput == "Gann Square" and bullAnchorReady and bearAnchorReady and bearAnchorPrice > bullAnchorPrice
squareBlocked = modeInput == "Gann Square" and not squareReady
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. The bullish branch references `ta.pivotlow`/`autoBull*`/`manualBull*` only, and the bearish branch references `ta.pivothigh`/`autoBear*`/`manualBear*` only. Search for every occurrence of `autoBull` and `autoBear` and confirm none appears in the other side's assignment. There must be no expression anywhere comparing a bullish bar index against a bearish one to pick a winner.
2. `autoBullUnit`/`autoBearUnit` are assigned `atrValue[pivotLookback]`, not bare `atrValue`. The frozen-ATR requirement fails silently if this is wrong.
3. Auto anchor bar is `bar_index - pivotLookback`, not `bar_index`.
4. `ratioIsPrimary` has exactly 9 elements and reads `false, true, false, true, true, true, false, true, false`, matching `1x8` secondary through `8x1` secondary in the Global Constraints table position by position.
5. Both `input.time` defaults are the literal `1704067200000`, not a `timestamp()` call.
6. The old `bullishPrice`/`bearishPrice` inputs no longer carry `Show Bullish Levels`-style titles that duplicate the new `showBullish`/`showBearish` inputs, and every input title within a group is unique.
7. The file below this section still contains the untouched `HELPERS` section (`styleFromString`, `passesFilter`) from the previous build.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add mode switch and two independent per-direction anchors"
```

---

### Task 2: Level engine and gated touch tracking

**Files:**
- Modify: `src/gann-angles.pine` — replace the existing `LEVEL ENGINE` and `TOUCH TRACKING` sections.

**Interfaces:**
- Consumes: everything Task 1 produces, plus `passesFilter` and `styleFromString` from the surviving HELPERS section.
- Produces: type `GannLevel` (fields `price` float, `label` string, `isPrimary` bool, `touched` bool); arrays `bullLevels`, `bearLevels` (`array<GannLevel>`); functions `buildSquare9`, `buildFan`, `buildSquareLevels`.

- [ ] **Step 1: Replace the LEVEL ENGINE and TOUCH TRACKING sections**

Replace everything from the `// LEVEL ENGINE` banner through the end of the touch-tracking loops (the block ending with the second `lvl.touched := true`) with:

```pinescript
// ============================================================
// LEVEL ENGINE
// ============================================================
type GannLevel
    float  price
    string label
    bool   isPrimary
    bool   touched

var GannLevel[] bullLevels = array.new<GannLevel>()
var GannLevel[] bearLevels = array.new<GannLevel>()

buildSquare9(GannLevel[] target, float startPrice, int rings, float scale, float direction) =>
    root = math.sqrt(startPrice * scale)
    for r = 1 to rings
        for s = 1 to 16
            n      = (r - 1) * 16 + s
            offset = root + direction * n * 0.125
            if offset > 0
                lvlPrice = math.pow(offset, 2) / scale
                angle    = s * 22.5
                lvlLabel = "R" + str.tostring(r) + "-" + str.tostring(angle, "#.#") + "°"
                array.push(target, GannLevel.new(lvlPrice, lvlLabel, s % 2 == 0, false))
    array.size(target)

buildFan(GannLevel[] target, float startPrice, float unit, int projection, float direction) =>
    for i = 0 to 8
        lvlPrice = startPrice + direction * array.get(ratioMultipliers, i) * unit * projection
        if lvlPrice > 0
            array.push(target, GannLevel.new(lvlPrice, array.get(ratioLabels, i), array.get(ratioIsPrimary, i), false))
    array.size(target)

buildSquareLevels(GannLevel[] target, float boxBottom, float priceRange) =>
    for i = 0 to 8
        m        = array.get(ratioMultipliers, i)
        lvlPrice = boxBottom + priceRange * m / (1.0 + m)
        if lvlPrice > 0
            array.push(target, GannLevel.new(lvlPrice, array.get(ratioLabels, i), array.get(ratioIsPrimary, i), false))
    array.size(target)

if modeInput == "Gann Square"
    if bullAnchorChanged or bearAnchorChanged
        array.clear(bullLevels)
        array.clear(bearLevels)
        if squareReady
            buildSquareLevels(bullLevels, bullAnchorPrice, bearAnchorPrice - bullAnchorPrice)
else
    if bullAnchorChanged
        array.clear(bullLevels)
        if modeInput == "Square of 9"
            buildSquare9(bullLevels, bullAnchorPrice, ringCount, scaleFactor, 1.0)
        else
            buildFan(bullLevels, bullAnchorPrice, bullAnchorUnit, fanProjection, 1.0)
    if bearAnchorChanged
        array.clear(bearLevels)
        if modeInput == "Square of 9"
            buildSquare9(bearLevels, bearAnchorPrice, ringCount, scaleFactor, -1.0)
        else
            buildFan(bearLevels, bearAnchorPrice, bearAnchorUnit, fanProjection, -1.0)

// ============================================================
// TOUCH TRACKING
// ============================================================
if bullAnchorReady and bar_index >= bullAnchorBar
    for lvl in bullLevels
        if not lvl.touched and low <= lvl.price and high >= lvl.price
            lvl.touched := true

if bearAnchorReady and bar_index >= bearAnchorBar
    for lvl in bearLevels
        if not lvl.touched and low <= lvl.price and high >= lvl.price
            lvl.touched := true
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. All three builders end with `array.size(target)` — an expression, not a bare `if` or `for`.
2. Every rebuild path calls `array.clear` on its target array *before* building, so a re-seat cannot append to stale levels. Trace all four `array.clear` calls.
3. Touch tracking is wrapped in `if <side>AnchorReady and bar_index >= <side>AnchorBar`. Without this gate the original bug returns — a level price crossed before the anchor would read `Touched`.
4. `buildSquare9` is called with `1.0` for bullish and `-1.0` for bearish; `buildFan` likewise. No crossed signs.
5. `buildSquareLevels` is called once, into `bullLevels` only, and `bearLevels` is cleared but never filled in Square mode.
6. `for r = 1 to rings` is safe (`ringCount` has `minval = 1`); `for i = 0 to 8` is a fixed bound; touch loops use `for ... in`. No descending-loop hazard.
7. `buildSquare9` no longer guards on `startPrice > 0` internally — confirm the callers are only reached when `<side>AnchorChanged` is true, which requires `<side>AnchorReady`, which already requires `price > 0`. State whether this holds.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: mode-aware level builders with anchor-gated touch tracking"
```

---

### Task 3: Renderer — anchored lines, box and grid, anchor markers

**Files:**
- Modify: `src/gann-angles.pine` — replace the existing `RENDERER` section.

**Interfaces:**
- Consumes: everything Tasks 1–2 produce.
- Produces: `drawnLines` (`array<line>`), `drawnLabels` (`array<label>`), `gannBox` (`var box`); functions `drawStartLine`, `drawSet`.

- [ ] **Step 1: Replace the RENDERER section**

Replace everything from the `// RENDERER` banner through the end of its `if barstate.islast` block (the last `drawSet(...)` call) with:

```pinescript
// ============================================================
// RENDERER
// ============================================================
var line[]  drawnLines  = array.new<line>()
var label[] drawnLabels = array.new<label>()
var box     gannBox     = na

drawStartLine(int anchorBar, float startPrice, bool visible, color lineColor, string lineStyle, int lineWidth, string lineLabel) =>
    if visible and not na(anchorBar) and startPrice > 0
        array.push(drawnLines, line.new(anchorBar, startPrice, anchorBar + 1, startPrice, extend = extend.right, color = lineColor, style = styleFromString(lineStyle), width = lineWidth))
        if showLabels
            array.push(drawnLabels, label.new(bar_index + labelOffset, startPrice, lineLabel + ": " + str.tostring(startPrice, format.mintick), style = label.style_label_left, color = lineColor, textcolor = color.white, size = size.small))
    array.size(drawnLines)

drawSet(GannLevel[] levels, int anchorBar, bool visible, string filterMode, color priColor, string priStyle, int priWidth, color secColor, string secStyle, int secWidth) =>
    if visible and not na(anchorBar)
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
                lvlColor = lvl.isPrimary ? priColor : secColor
                lvlStyle = styleFromString(lvl.isPrimary ? priStyle : secStyle)
                lvlWidth = lvl.isPrimary ? priWidth : secWidth
                array.push(drawnLines, line.new(anchorBar, lvl.price, anchorBar + 1, lvl.price, extend = extend.right, color = lvlColor, style = lvlStyle, width = lvlWidth))
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
    box.delete(gannBox)

    if squareReady
        boxLeft   = math.min(bullAnchorBar, bearAnchorBar)
        leftUnit  = bullAnchorBar <= bearAnchorBar ? bullAnchorUnit : bearAnchorUnit
        widthBars = math.max(1, math.min(2000, int(math.round((bearAnchorPrice - bullAnchorPrice) / leftUnit))))
        boxRight  = boxLeft + widthBars
        gannBox := box.new(boxLeft, bearAnchorPrice, boxRight, bullAnchorPrice, border_color = color.new(color.gray, 50), bgcolor = color.new(color.gray, 95))
        priceStep = (bearAnchorPrice - bullAnchorPrice) / boxGridDivisions
        barStep   = widthBars / float(boxGridDivisions)
        if boxGridDivisions > 1
            for i = 1 to boxGridDivisions - 1
                gridPrice = bullAnchorPrice + priceStep * i
                array.push(drawnLines, line.new(boxLeft, gridPrice, boxRight, gridPrice, color = color.new(color.gray, 70), style = line.style_dotted))
                gridBar = boxLeft + int(math.round(barStep * i))
                array.push(drawnLines, line.new(gridBar, bullAnchorPrice, gridBar, bearAnchorPrice, color = color.new(color.gray, 70), style = line.style_dotted))

    drawStartLine(bullAnchorBar, bullAnchorPrice, showBullish and bullAnchorReady, bullStartColor, bullStartStyle, bullStartWidth, "Bull Start")
    drawSet(bullLevels, bullAnchorBar, showBullish and bullAnchorReady, bullishAngles, bullPrimaryColor, bullPrimaryStyle, bullPrimaryWidth, bullSecondaryColor, bullSecondaryStyle, bullSecondaryWidth)
    drawStartLine(bearAnchorBar, bearAnchorPrice, showBearish and bearAnchorReady, bearStartColor, bearStartStyle, bearStartWidth, "Bear Start")
    drawSet(bearLevels, bearAnchorBar, showBearish and bearAnchorReady, bearishAngles, bearPrimaryColor, bearPrimaryStyle, bearPrimaryWidth, bearSecondaryColor, bearSecondaryStyle, bearSecondaryWidth)

    if showAnchorMarkers
        if bullAnchorReady
            array.push(drawnLabels, label.new(bullAnchorBar, bullAnchorPrice, "Bull Anchor", style = label.style_label_up, color = color.new(color.gray, 20), textcolor = color.white, size = size.tiny))
        if bearAnchorReady
            array.push(drawnLabels, label.new(bearAnchorBar, bearAnchorPrice, "Bear Anchor", style = label.style_label_down, color = color.new(color.gray, 20), textcolor = color.white, size = size.tiny))
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. Every `line.new` that draws a *level* or *start line* passes `extend = extend.right` and starts at `anchorBar`. Search for `line.new` and list every hit with its extend argument. The two grid-line calls are bounded on purpose and must NOT extend — confirm they pass no `extend` argument.
2. Zero occurrences of `extend.both` or `extend.left` remain in the file.
3. Both `drawStartLine` and `drawSet` end with `array.size(drawnLines)`.
4. The `barstate.islast` block clears `drawnLines` and `drawnLabels` and deletes `gannBox` before anything is drawn. Grid lines are pushed into `drawnLines`, so they are cleaned up on the next redraw — confirm this, since a leak here accumulates 38 lines per redraw.
5. `for i = 1 to boxGridDivisions - 1` is guarded by `if boxGridDivisions > 1`. Without that guard, `boxGridDivisions = 1` gives `for i = 1 to 0`, which Pine runs descending as two iterations rather than skipping.
6. Anchor markers are pushed into `drawnLabels` so they are deleted on redraw, and are drawn only when `showAnchorMarkers` is true.
7. Argument order for all four `drawStartLine`/`drawSet` calls matches the function signatures position by position — no bearish colour passed to a bullish set.
8. Worst-case counts: Square of 9 = 98 lines / 100 labels; Square = 49 lines / 13 labels / 1 box. All under the declared 200 / 200 / 10.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: render anchored horizontal levels, squared box and anchor markers"
```

---

### Task 4: Mode-aware table

**Files:**
- Modify: `src/gann-angles.pine` — replace the existing `TABLE` section.

**Interfaces:**
- Consumes: everything Tasks 1–3 produce.
- Produces: `gannTable` (`var table`); function `countRows(GannLevel[], bool, string) => int`.

- [ ] **Step 1: Replace the TABLE section**

Replace everything from the `// TABLE` banner to the end of the file with:

```pinescript
// ============================================================
// TABLE
// ============================================================
var table gannTable = na

countRows(GannLevel[] levels, bool visible, string filterMode) =>
    total = 0
    if visible
        total := 1
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
                total += 1
    total

if barstate.islast
    table.delete(gannTable)
    if showTable
        tablePos = switch tablePosInput
            "Top Right"    => position.top_right
            "Top Left"     => position.top_left
            "Bottom Right" => position.bottom_right
            => position.bottom_left
        bullRowCount = countRows(bullLevels, showBullish and bullAnchorReady, bullishAngles)
        bearRowCount = countRows(bearLevels, showBearish and bearAnchorReady, bearishAngles)
        noRows       = bullRowCount == 0 and bearRowCount == 0
        neededRows   = noRows ? 2 : 1 + bullRowCount + bearRowCount
        rowCount     = math.min(neededRows, 100)
        gannTable := table.new(tablePos, 3, rowCount, bgcolor = color.new(color.black, 80), border_width = 1)
        table.cell(gannTable, 0, 0, "Label", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(gannTable, 1, 0, "Price", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(gannTable, 2, 0, "Status", text_color = color.white, bgcolor = color.new(color.gray, 50))

        nextRow = 1
        if noRows and nextRow < rowCount
            hintText = squareBlocked ? "Square needs bearish price above bullish" : "Set a price or wait for a swing pivot"
            table.cell(gannTable, 0, nextRow, hintText, text_color = color.silver)
            nextRow += 1
        if showBullish and bullAnchorReady and nextRow < rowCount
            table.cell(gannTable, 0, nextRow, "Bull Start", text_color = bullStartColor)
            table.cell(gannTable, 1, nextRow, str.tostring(bullAnchorPrice, format.mintick), text_color = color.white)
            table.cell(gannTable, 2, nextRow, "—", text_color = color.gray)
            nextRow += 1
            for lvl in bullLevels
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bullishAngles)
                    table.cell(gannTable, 0, nextRow, lvl.label, text_color = lvl.isPrimary ? bullPrimaryColor : bullSecondaryColor)
                    table.cell(gannTable, 1, nextRow, str.tostring(lvl.price, format.mintick), text_color = color.white)
                    table.cell(gannTable, 2, nextRow, lvl.touched ? "Touched" : "Pending", text_color = lvl.touched ? color.lime : color.gray)
                    nextRow += 1

        if showBearish and bearAnchorReady and nextRow < rowCount
            table.cell(gannTable, 0, nextRow, "Bear Start", text_color = bearStartColor)
            table.cell(gannTable, 1, nextRow, str.tostring(bearAnchorPrice, format.mintick), text_color = color.white)
            table.cell(gannTable, 2, nextRow, "—", text_color = color.gray)
            nextRow += 1
            for lvl in bearLevels
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bearishAngles)
                    table.cell(gannTable, 0, nextRow, lvl.label, text_color = lvl.isPrimary ? bearPrimaryColor : bearSecondaryColor)
                    table.cell(gannTable, 1, nextRow, str.tostring(lvl.price, format.mintick), text_color = color.white)
                    table.cell(gannTable, 2, nextRow, lvl.touched ? "Touched" : "Pending", text_color = lvl.touched ? color.lime : color.gray)
                    nextRow += 1
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `countRows` ends with `total`.
2. Every `table.cell` write using `nextRow` is guarded by `nextRow < rowCount`.
3. `countRows`'s `visible` argument and the corresponding row block's guard use the *same* condition (`show<Side> and <side>AnchorReady`) — if they diverge, `neededRows` and the actual writes disagree and rows are silently dropped or the table is oversized. Compare each pair explicitly.
4. Re-derive the row arithmetic by hand and state the numbers for: (a) neither anchor ready; (b) Square of 9, both sets, 3 rings, filter `All`; (c) Gann Fan, both sets, filter `All`; (d) Gann Square, bullish visible only. Confirm the highest row index written is strictly less than `rowCount` in each.
5. The hint row's text switches on `squareBlocked`, and reads `Square needs bearish price above bullish` in Square mode with an invalid anchor pair.

- [ ] **Step 3: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-05-gann-modes-and-anchors-design.md` alongside the finished file and confirm:

1. The bullish anchor never reads a swing high and the bearish anchor never reads a swing low — grep every use of `swingLowRaw` and `swingHighRaw`.
2. No live ATR reaches a slope or width calculation — grep `atrValue` and confirm every use is either the two frozen samples or `atrValue[pivotLookback]`.
3. Touch tracking is anchor-gated.
4. Every level and start line uses `extend.right` from its anchor bar.
5. Every `input.*` variable declared in Task 1 is read somewhere. Enumerate them and check each; report any orphan rather than silently fixing it.

- [ ] **Step 4: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: mode-aware table with anchor-gated status and guard row"
```

---

### Task 5: Supersede the intermediate Square of 9 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-square-of-9-levels-design.md`
- Modify: `docs/superpowers/plans/2026-08-05-square-of-9-levels.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Add the banner to both documents**

Insert immediately after the `**Status:**` line of `docs/superpowers/specs/2026-08-05-square-of-9-levels-design.md`, and immediately after the `**Goal:**` line of `docs/superpowers/plans/2026-08-05-square-of-9-levels.md`, this exact line followed by a blank line:

```markdown
> **Extended on 2026-08-05** by `2026-08-05-gann-modes-and-anchors-design.md`. The Square of 9 work below still stands, but Gann Fan and Gann Square modes were restored, per-direction swing anchors replaced the typed-only inputs, and level lines changed from `extend.both` to `extend.right` from their anchor bar. Read that document for current behaviour.
```

Change no other line of either file.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-square-of-9-levels-design.md docs/superpowers/plans/2026-08-05-square-of-9-levels.md
git commit -m "docs: mark Square of 9 spec and plan as extended"
```

---

## Deferred human verification (TradingView)

Not executable in this environment. Hand these to the user after Task 5:

- With both prices at `0`, confirm each side seats to a wide pivot and the anchor markers land on plausible major turning points.
- Confirm a new swing high never moves the bullish anchor, and vice versa.
- Type a `Bullish Price` and confirm only that side pins while the bearish side keeps auto-seating.
- Confirm Touched reads `Pending` for levels price crossed before the anchor bar — the specific bug that prompted this work.
- Switch through all three modes and confirm each renders from the same anchors.
- Confirm Fan levels hold still as volatility changes while the anchor does not move.
- Confirm the Gann Square's width visibly tracks its price range, and that inverted anchors produce the guard row rather than an upside-down box.
- Confirm primary ratios (1x1, 1x2, 2x1, 1x4, 4x1) and 45° multiples render in the primary style in their respective modes.
- Set `Box Grid Divisions` to 1 and confirm the grid is simply absent rather than misdrawn.
