# Gann Angles Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new standalone Pine Script v6 indicator (`src/gann-angles.pine`) that auto-calculates Gann Fan, Gann Square (Box), Square of 9, and Gann Time Levels from an auto-detected (or manual) swing anchor, with a price/time-target table tracking touched/reached status.

> **Superseded on 2026-08-05** by `2026-08-05-square-of-9-levels.md`. The Gann Fan, Gann Square (Box), Gann Time Levels and the whole anchor engine described below were removed; `src/gann-angles.pine` is now a pure Square of 9 level indicator. This document is kept for history only.

**Architecture:** One shared anchor engine (swing-pivot detection, auto or manual) feeds three mutually-exclusive price-mode renderers (Fan / Square / Square of 9) selected by a mode switch, plus an independent Time Levels toggle. All price-mode renderers populate a common `GannLevel` array so a single generic table task can render touched-status for whichever mode is active without mode-specific logic.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual via TradingView's Pine Editor (compile check) and chart inspection, same convention as the existing ICT script.

## Global Constraints

- New standalone file `src/gann-angles.pine`, `overlay = true`, `max_lines_count = 200` (box-grid divisions are user-configurable up to 20, which alone can produce up to 38 grid lines + 9 diagonals; 200 gives comfortable headroom across every mode combination).
- 1x1 ratio / nearest ring / 90°+180°+270°+360° time cycles are **major** (blue, `color.blue`). All other ratios/rings/cycles are **secondary** (orange, `color.orange`).
- Angle scaling unit: `priceUnit = ta.atr(atrLength)` (default `atrLength = 14`). Ratio slopes: 1x8=`unit÷8`, 1x4=`unit÷4`, 1x3=`unit÷3`, 1x2=`unit÷2`, 1x1=`unit×1`, 2x1=`unit×2`, 3x1=`unit×3`, 4x1=`unit×4`, 8x1=`unit×8`.
- Anchor direction: a swing-low anchor projects angles/levels **upward**; a swing-high anchor projects **downward**. This applies identically to the Fan, the Square's diagonals, and Square of 9's cardinal levels.
- Square of 9 cardinal levels: for ring `r` (1-indexed), levels use `k = 4r-3, 4r-2, 4r-1, 4r` in `(sqrt(anchorPrice) ± k×0.5)²`, sign matching anchor direction.
- Gann Time Levels cycle numbers (fixed list): 30, 45, 60, 90, 120, 144, 180, 270, 360 bars from the anchor bar. Major: 90, 180, 270, 360. Secondary: 30, 45, 60, 120, 144.
- Touched status (price modes) is **sticky**: once true, stays true until the anchor changes (re-anchor resets it). Reached status (time levels) is **live-recomputed** every bar (`bar_index >= targetBar`), no reset needed since `bar_index` only increases.
- Mode switch (`Gann Fan` / `Gann Square` / `Square of 9`) is mutually exclusive — only one price mode draws at a time. `Show Gann Time Levels` is an independent toggle that works with any price mode.
- Every mode/toggle fully deletes and redraws its own objects on a re-anchor or a mode/toggle change — no accumulation of stale drawings across anchor changes.
- **Loop-direction footgun (carried over from the ICT script's `mitigateBoxes` bug):** any `for i = X to Y` loop where `Y` can be less than `X` at runtime (e.g. `array.size(arr) - 1` when `arr` can be empty) MUST be wrapped in a size guard (`if array.size(arr) > 0`). Pine infers loop direction by comparing `X` and `Y` at runtime — `for i = 0 to -1` does NOT skip; it runs descending as a 2-iteration loop (`i = 0`, then `i = -1`), which is exactly what caused the earlier bug. `for x in someArray` (for-in form) does not have this problem and needs no guard — it correctly executes zero times on an empty array.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review (no live TradingView compile-check is available in this environment — do not claim one was performed).
- Pine v6 user-defined type (UDT) instances are reference types: a variable holding a UDT instance, and a `for x in array<UDT>` loop variable, both refer to the same underlying object stored in the array. Mutating a field through either (`x.field := value`) mutates the object in place — this is required for the touched/reached-flag update logic in Task 7 to work, and is standard, verified Pine v6 behavior (not a workaround).

---

### Task 1: Scaffolding — inputs, shared state, ATR scaling

**Files:**
- Create: `src/gann-angles.pine`

**Interfaces:**
- Produces: all input variables listed below; `gannRatioLabels` (`array<string>`, 9 elements), `gannRatioMultipliers` (`array<float>`, 9 elements, same order), `gannTimeCycles` (`array<int>`, 9 elements); the `GannLevel` type (`lineRef`, `label`, `slope`, `touched`, `col`) and `GannTimeLevel` type (`lineRef`, `label`, `targetBar`, `reached`); `activeLevels` (`array<GannLevel>`), `activeTimeLevels` (`array<GannTimeLevel>`); `previousMode` (`var string`), `previousShowTimeLevels` (`var bool`), `modeChanged` (`bool`), `timeLevelsToggleChanged` (`bool`); `priceUnit` (`float`).

- [ ] **Step 1: Create the file**

```pinescript
//@version=6
indicator("Gann Angles", shorttitle = "Gann-Angles", overlay = true, max_lines_count = 200)

// ============================================================
// INPUTS
// ============================================================

// ---------------- Mode ----------------
modeInput = input.string("Gann Fan", "Mode", options = ["Gann Fan", "Gann Square", "Square of 9"], group = "Mode")

// ---------------- Anchor ----------------
anchorModeInput       = input.string("Auto (Swing)", "Anchor Mode", options = ["Auto (Swing)", "Manual"], group = "Anchor")
pivotLookback         = input.int(5, "Swing Pivot Lookback", minval = 2, group = "Anchor")
manualAnchorTime      = input.time(timestamp(2026, 1, 1, 0, 0), "Manual Anchor Time", group = "Anchor")
manualAnchorPrice     = input.float(0.0, "Manual Anchor Price", minval = 0.0, group = "Anchor")
manualAnchorTypeInput = input.string("Low (up-angles)", "Manual Anchor Type", options = ["Low (up-angles)", "High (down-angles)"], group = "Anchor")

// ---------------- Scaling ----------------
atrLength = input.int(14, "ATR Length", minval = 1, group = "Scaling")

// ---------------- Gann Square ----------------
boxGridDivisions = input.int(8, "Box Grid Divisions", minval = 1, maxval = 20, group = "Gann Square")

// ---------------- Square of 9 ----------------
square9Rings = input.int(2, "Number of Rings", minval = 1, maxval = 10, group = "Square of 9")

// ---------------- Time Levels ----------------
showTimeLevels = input.bool(false, "Show Gann Time Levels", group = "Time Levels")

// ---------------- Display ----------------
showTable          = input.bool(true, "Show Price/Time Target Table", group = "Display")
tablePositionInput = input.string("Top Right", "Table Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Display")
forwardProjection  = input.int(100, "Forward Projection (bars)", minval = 1, maxval = 500, group = "Display")

// ============================================================
// SHARED STATE
// ============================================================
var string[] gannRatioLabels      = array.from("1x8", "1x4", "1x3", "1x2", "1x1", "2x1", "3x1", "4x1", "8x1")
var float[]  gannRatioMultipliers = array.from(1.0/8, 1.0/4, 1.0/3, 1.0/2, 1.0, 2.0, 3.0, 4.0, 8.0)
var int[]    gannTimeCycles       = array.from(30, 45, 60, 90, 120, 144, 180, 270, 360)

type GannLevel
    line   lineRef
    string label
    float  slope
    bool   touched
    color  col

type GannTimeLevel
    line   lineRef
    string label
    int    targetBar
    bool   reached

var GannLevel[]     activeLevels     = array.new<GannLevel>()
var GannTimeLevel[] activeTimeLevels = array.new<GannTimeLevel>()

var string previousMode           = na
var bool   previousShowTimeLevels = false

modeChanged             = modeInput != previousMode
timeLevelsToggleChanged = showTimeLevels != previousShowTimeLevels

// ============================================================
// SCALING
// ============================================================
priceUnit = ta.atr(atrLength)
```

- [ ] **Step 2: Self-review**

No live TradingView compile-check is available. Manually verify:
- `gannRatioLabels` and `gannRatioMultipliers` have exactly 9 elements each, in matching order (1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1 ↔ ÷8, ÷4, ÷3, ÷2, ×1, ×2, ×3, ×4, ×8).
- `array.from(1.0/8, 1.0/4, ...)` infers `array<float>` (all elements are float-typed via `1.0/N` division or explicit `.0` literals) — no mixed int/float that would break type inference.
- `type GannLevel` / `type GannTimeLevel` field order matches what later tasks will use in `GannLevel.new(...)`/`GannTimeLevel.new(...)` positional constructors (`lineRef, label, slope, touched, col` and `lineRef, label, targetBar, reached` respectively) — this ordering is the contract every later task's constructor calls must follow.
- `modeChanged`/`timeLevelsToggleChanged` are plain (non-`var`) so they recompute fresh every bar from the current `var previousMode`/`previousShowTimeLevels`, which stay unchanged until Task 7 updates them at the end of the script.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: scaffold Gann Angles indicator inputs, shared state, and ATR scaling"
```

---

### Task 2: Anchor engine (auto swing + manual override)

**Files:**
- Modify: `src/gann-angles.pine` (append after the `SCALING` section from Task 1)

**Interfaces:**
- Consumes: `pivotLookback`, `anchorModeInput`, `manualAnchorTime`, `manualAnchorPrice`, `manualAnchorTypeInput` (Task 1 inputs).
- Produces: `anchorPrice` (`var float`), `anchorBarIndex` (`var int`), `anchorType` (`var string`, `"low"` or `"high"`), `opposingPrice` (`var float`), `opposingBarIndex` (`var int`), `anchorChanged` (`bool`, true only on the bar a new anchor is established). These six names are consumed by every renderer task (3–6) and the table task (7).

- [ ] **Step 1: Append the anchor engine**

Find the end of the file (the `priceUnit = ta.atr(atrLength)` line added in Task 1) and append immediately after it:

```pinescript

// ============================================================
// ANCHOR ENGINE
// ============================================================
swingHigh = ta.pivothigh(high, pivotLookback, pivotLookback)
swingLow  = ta.pivotlow(low, pivotLookback, pivotLookback)

var float lastSwingHighPrice    = na
var int   lastSwingHighBarIndex = na
var float lastSwingLowPrice     = na
var int   lastSwingLowBarIndex  = na

if not na(swingHigh)
    lastSwingHighPrice := swingHigh
    lastSwingHighBarIndex := bar_index - pivotLookback
if not na(swingLow)
    lastSwingLowPrice := swingLow
    lastSwingLowBarIndex := bar_index - pivotLookback

var int manualAnchorBarIndex = na
if time <= manualAnchorTime
    manualAnchorBarIndex := bar_index

var float  anchorPrice      = na
var int    anchorBarIndex   = na
var string anchorType       = na
var float  opposingPrice    = na
var int    opposingBarIndex = na

anchorChanged = false

if anchorModeInput == "Auto (Swing)"
    if not na(lastSwingHighBarIndex) or not na(lastSwingLowBarIndex)
        newAnchorIsHigh   = na(lastSwingLowBarIndex) or (not na(lastSwingHighBarIndex) and lastSwingHighBarIndex >= lastSwingLowBarIndex)
        candidatePrice    = newAnchorIsHigh ? lastSwingHighPrice    : lastSwingLowPrice
        candidateBarIndex = newAnchorIsHigh ? lastSwingHighBarIndex : lastSwingLowBarIndex
        candidateType     = newAnchorIsHigh ? "high" : "low"
        if candidateBarIndex != anchorBarIndex or candidateType != anchorType
            anchorPrice      := candidatePrice
            anchorBarIndex   := candidateBarIndex
            anchorType       := candidateType
            opposingPrice    := newAnchorIsHigh ? lastSwingLowPrice    : lastSwingHighPrice
            opposingBarIndex := newAnchorIsHigh ? lastSwingLowBarIndex : lastSwingHighBarIndex
            anchorChanged    := true
else
    candidateType = manualAnchorTypeInput == "Low (up-angles)" ? "low" : "high"
    if not na(manualAnchorBarIndex) and (manualAnchorBarIndex != anchorBarIndex or candidateType != anchorType or manualAnchorPrice != anchorPrice)
        anchorPrice      := manualAnchorPrice
        anchorBarIndex   := manualAnchorBarIndex
        anchorType       := candidateType
        opposingPrice    := candidateType == "high" ? lastSwingLowPrice    : lastSwingHighPrice
        opposingBarIndex := candidateType == "high" ? lastSwingLowBarIndex : lastSwingHighBarIndex
        anchorChanged    := true
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- `lastSwingHighBarIndex`/`lastSwingLowBarIndex` are captured as `bar_index - pivotLookback` (the pivot's real bar, since `ta.pivothigh`/`ta.pivotlow` confirm `pivotLookback` bars late) — same pattern as the existing ICT script's `lastSwingHighBarIndex` tracking.
- `manualAnchorBarIndex` capture (`if time <= manualAnchorTime: manualAnchorBarIndex := bar_index`) runs unconditionally every bar and keeps overwriting until `time` exceeds `manualAnchorTime`, landing on the last bar at or before that time — confirm this is a plain reassignment every qualifying bar, not gated behind any one-time flag.
- In Auto mode, `anchorChanged` fires exactly once per new swing (guarded by the `candidateBarIndex != anchorBarIndex or candidateType != anchorType` check) — re-evaluating the same swing on later bars must NOT re-trigger `anchorChanged`.
- In Manual mode, once `anchorPrice`/`anchorBarIndex`/`anchorType` are set to the manual values, the same guard condition becomes permanently false (nothing about `manualAnchorBarIndex`, `manualAnchorPrice`, or `candidateType` changes afterward), so `anchorChanged` fires exactly once total, on the bar the manual time is first reached — not once per bar afterward.
- `newAnchorIsHigh`'s tie-break (`lastSwingHighBarIndex >= lastSwingLowBarIndex`) picks the high when both swings share the same bar index, and correctly falls back to whichever swing is non-`na` when the other is still `na` (early in chart history, before both sides have confirmed at least once).

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add auto/manual swing anchor engine"
```

---

### Task 3: Gann Fan renderer

**Files:**
- Modify: `src/gann-angles.pine` (append after the `ANCHOR ENGINE` section from Task 2)

**Interfaces:**
- Consumes: `modeInput`, `anchorChanged`, `modeChanged`, `anchorPrice`, `anchorBarIndex`, `anchorType`, `priceUnit`, `gannRatioLabels`, `gannRatioMultipliers`, `activeLevels`, `forwardProjection` (Tasks 1–2).
- Produces: no new named globals — populates the shared `activeLevels` array (consumed by Task 7) whenever Fan mode is active.

- [ ] **Step 1: Append the Gann Fan renderer**

Find the end of the file (the last line of the `ANCHOR ENGINE` section added in Task 2, the `anchorChanged := true` line inside the `else` branch) and append immediately after it:

```pinescript

// ============================================================
// GANN FAN
// ============================================================
fanRedraw = (modeInput == "Gann Fan") and (anchorChanged or modeChanged) and not na(anchorPrice)

if fanRedraw
    for lvl in activeLevels
        line.delete(lvl.lineRef)
    array.clear(activeLevels)
    fanDirection = anchorType == "low" ? 1.0 : -1.0
    for i = 0 to array.size(gannRatioLabels) - 1
        ratioLabel = array.get(gannRatioLabels, i)
        slope      = fanDirection * array.get(gannRatioMultipliers, i) * priceUnit
        lineColor  = ratioLabel == "1x1" ? color.new(color.blue, 0) : color.new(color.orange, 0)
        lineWidth  = ratioLabel == "1x1" ? 2 : 1
        endBar     = bar_index + forwardProjection
        endPrice   = anchorPrice + slope * (endBar - anchorBarIndex)
        newLine    = line.new(anchorBarIndex, anchorPrice, endBar, endPrice, color = lineColor, width = lineWidth)
        array.push(activeLevels, GannLevel.new(newLine, ratioLabel, slope, false, lineColor))

if modeInput == "Gann Fan" and not na(anchorPrice) and array.size(activeLevels) > 0
    for lvl in activeLevels
        endBar   = bar_index + forwardProjection
        endPrice = anchorPrice + lvl.slope * (endBar - anchorBarIndex)
        line.set_xy2(lvl.lineRef, endBar, endPrice)
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- `fanRedraw` only fires when `modeInput == "Gann Fan"` AND (`anchorChanged` OR `modeChanged`) AND an anchor exists — switching away from Fan mode must NOT trigger this block (so it doesn't redraw Fan lines while another mode is selected).
- The redraw block always clears `activeLevels` (deleting every line it currently holds) before repopulating — this is what allows a later mode's renderer (Task 4/5) to safely delete Fan's leftover lines on a mode switch, since `activeLevels` is shared across all three price modes and only one mode's lines occupy it at a time.
- The extension block (`line.set_xy2`, second `if`) runs every bar (not gated by `anchorChanged`/`modeChanged`) so the line's forward endpoint keeps pace with `bar_index + forwardProjection` as new bars form — confirm it's gated only by `modeInput == "Gann Fan"`, not accidentally also requiring `fanRedraw`.
- `for i = 0 to array.size(gannRatioLabels) - 1` needs no size guard here — `gannRatioLabels` is a fixed 9-element array from Task 1, never empty, so this loop's bounds can never invert.
- `GannLevel.new(newLine, ratioLabel, slope, false, lineColor)` argument order matches the `type GannLevel` field order from Task 1 (`lineRef, label, slope, touched, col`).

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add Gann Fan renderer"
```

---

### Task 4: Gann Square (Box) renderer

**Files:**
- Modify: `src/gann-angles.pine` (append after the `GANN FAN` section from Task 3)

**Interfaces:**
- Consumes: `modeInput`, `anchorChanged`, `modeChanged`, `anchorPrice`, `anchorBarIndex`, `anchorType`, `opposingPrice`, `opposingBarIndex`, `priceUnit`, `gannRatioLabels`, `gannRatioMultipliers`, `activeLevels`, `boxGridDivisions` (Tasks 1–3).
- Produces: `gannBox` (`var box`), `boxGridLines` (`var array<line>`) — new globals, not consumed by other tasks (Task 7's table only reads `activeLevels`/`activeTimeLevels`, never the box/grid directly). Populates the shared `activeLevels` array whenever Square mode is active, same contract as Task 3.

- [ ] **Step 1: Append the Gann Square (Box) renderer**

Find the end of the file (the last line of the `GANN FAN` section added in Task 3, the `line.set_xy2(lvl.lineRef, endBar, endPrice)` line) and append immediately after it:

```pinescript

// ============================================================
// GANN SQUARE (BOX)
// ============================================================
var box       gannBox      = na
var line[]    boxGridLines = array.new<line>()

squareRedraw = (modeInput == "Gann Square") and (anchorChanged or modeChanged) and not na(anchorPrice) and not na(opposingPrice)

if squareRedraw
    for lvl in activeLevels
        line.delete(lvl.lineRef)
    array.clear(activeLevels)
    box.delete(gannBox)
    for gridLine in boxGridLines
        line.delete(gridLine)
    array.clear(boxGridLines)

    boxLeft   = math.min(anchorBarIndex, opposingBarIndex)
    boxRight  = math.max(anchorBarIndex, opposingBarIndex)
    boxTop    = math.max(anchorPrice, opposingPrice)
    boxBottom = math.min(anchorPrice, opposingPrice)

    gannBox := box.new(boxLeft, boxTop, boxRight, boxBottom, border_color = color.new(color.gray, 50), bgcolor = color.new(color.gray, 95))

    priceStep = (boxTop - boxBottom) / boxGridDivisions
    barStep   = (boxRight - boxLeft) / boxGridDivisions
    if boxGridDivisions > 1
        for i = 1 to boxGridDivisions - 1
            array.push(boxGridLines, line.new(boxLeft, boxBottom + priceStep * i, boxRight, boxBottom + priceStep * i, color = color.new(color.gray, 70), style = line.style_dotted))
            array.push(boxGridLines, line.new(boxLeft + math.round(barStep * i), boxBottom, boxLeft + math.round(barStep * i), boxTop, color = color.new(color.gray, 70), style = line.style_dotted))

    squareDirection = anchorType == "low" ? 1.0 : -1.0
    boxSpanBars     = math.abs(opposingBarIndex - anchorBarIndex)
    for i = 0 to array.size(gannRatioLabels) - 1
        ratioLabel = array.get(gannRatioLabels, i)
        slope      = squareDirection * array.get(gannRatioMultipliers, i) * priceUnit
        lineColor  = ratioLabel == "1x1" ? color.new(color.blue, 0) : color.new(color.orange, 0)
        lineWidth  = ratioLabel == "1x1" ? 2 : 1
        endBar     = anchorBarIndex + boxSpanBars
        endPrice   = anchorPrice + slope * boxSpanBars
        newLine    = line.new(anchorBarIndex, anchorPrice, endBar, endPrice, color = lineColor, width = lineWidth)
        array.push(activeLevels, GannLevel.new(newLine, ratioLabel, slope, false, lineColor))
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- `squareRedraw` requires `not na(opposingPrice)` in addition to `not na(anchorPrice)` — the Square mode cannot draw until both a primary anchor AND an opposing swing exist, unlike Fan/Square of 9 which only need the primary anchor.
- The `if boxGridDivisions > 1` guard around `for i = 1 to boxGridDivisions - 1` is present — without it, `boxGridDivisions = 1` (the input's `minval`) produces `for i = 1 to 0`, which Pine runs as a descending 2-iteration loop (`i=1`, then `i=0`), not zero iterations. This is the exact loop-direction footgun called out in Global Constraints.
- Square's diagonals are bounded to `anchorBarIndex + boxSpanBars` (the box's own width), NOT `bar_index + forwardProjection` like the Fan — confirm there is no per-bar extension block for Square lines (unlike Task 3's second `if` block), since the box's two corners are both fixed historical swings and the box does not grow forward.
- `gannBox`/`boxGridLines` are deleted and recreated together with `activeLevels` inside the single `squareRedraw` block — confirm all three (box, grid lines, diagonal lines in `activeLevels`) are cleared before any new ones are created, so a mode switch away from Square and back doesn't leak old grid lines.
- `GannLevel.new(...)` argument order matches Task 1's `type GannLevel` field order, same as Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add Gann Square (Box) renderer"
```

---

### Task 5: Square of 9 renderer

**Files:**
- Modify: `src/gann-angles.pine` (append after the `GANN SQUARE (BOX)` section from Task 4)

**Interfaces:**
- Consumes: `modeInput`, `anchorChanged`, `modeChanged`, `anchorPrice`, `anchorBarIndex`, `anchorType`, `activeLevels`, `square9Rings`, `forwardProjection` (Tasks 1–2, 4).
- Produces: no new named globals — populates the shared `activeLevels` array whenever Square of 9 mode is active, same contract as Tasks 3–4.

- [ ] **Step 1: Append the Square of 9 renderer**

Find the end of the file (the last line of the `GANN SQUARE (BOX)` section added in Task 4, the `array.push(activeLevels, GannLevel.new(...))` line inside the ratio loop) and append immediately after it:

```pinescript

// ============================================================
// SQUARE OF 9
// ============================================================
square9Redraw = (modeInput == "Square of 9") and (anchorChanged or modeChanged) and not na(anchorPrice)

if square9Redraw
    for lvl in activeLevels
        line.delete(lvl.lineRef)
    array.clear(activeLevels)
    square9Direction = anchorType == "low" ? 1.0 : -1.0
    sqrtAnchor        = math.sqrt(anchorPrice)
    for r = 1 to square9Rings
        for step = 1 to 4
            k          = (r - 1) * 4 + step
            levelPrice = math.pow(sqrtAnchor + square9Direction * k * 0.5, 2)
            levelLabel = "R" + str.tostring(r) + "-" + str.tostring(step * 90) + "deg"
            lineColor  = r == 1 ? color.new(color.blue, 0) : color.new(color.orange, 0)
            lineWidth  = r == 1 ? 2 : 1
            newLine    = line.new(anchorBarIndex, levelPrice, bar_index + forwardProjection, levelPrice, color = lineColor, style = line.style_dashed, width = lineWidth)
            array.push(activeLevels, GannLevel.new(newLine, levelLabel, 0.0, false, lineColor))

if modeInput == "Square of 9" and not na(anchorPrice) and array.size(activeLevels) > 0
    for lvl in activeLevels
        line.set_x2(lvl.lineRef, bar_index + forwardProjection)
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- `k = (r - 1) * 4 + step` produces `1,2,3,4` for ring 1, `5,6,7,8` for ring 2, etc. — matches the Global Constraints formula (`k = 4r-3, 4r-2, 4r-1, 4r`) exactly (`(r-1)*4+1 = 4r-3`, ..., `(r-1)*4+4 = 4r`).
- `square9Direction` uses `+` for a low anchor (levels project upward) and `-` for a high anchor (levels project downward) — confirm the sign is applied to `k * 0.5` before adding to `sqrtAnchor`, not applied after squaring (squaring would erase the sign and always produce upward-only levels).
- Each `GannLevel` created here uses `slope = 0.0` (horizontal ray) — this is intentional: Task 7's generic touched-check formula (`anchorPrice + lvl.slope * (bar_index - anchorBarIndex)`) reduces to a constant `levelPrice` when `slope` is `0.0`, so Square of 9's horizontal levels are tracked correctly by the same generic code Fan/Square use for diagonal lines, with no special-casing needed in Task 7.
- `for r = 1 to square9Rings` and `for step = 1 to 4` both use fixed/minval-guaranteed-positive bounds (`square9Rings` has `minval = 1`) — neither can invert, no size guard needed.
- The extension block (`line.set_x2`, second `if`) only updates `x2` (not `y1`/`y2`, since these lines are horizontal and their price never changes) — confirm it does not call `line.set_xy2` or otherwise touch the price coordinates.

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add Square of 9 renderer"
```

---

### Task 6: Gann Time Levels renderer

**Files:**
- Modify: `src/gann-angles.pine` (append after the `SQUARE OF 9` section from Task 5)

**Interfaces:**
- Consumes: `showTimeLevels`, `anchorChanged`, `timeLevelsToggleChanged`, `anchorBarIndex`, `gannTimeCycles`, `activeTimeLevels` (Tasks 1–2).
- Produces: no new named globals — populates the shared `activeTimeLevels` array (consumed by Task 7).

- [ ] **Step 1: Append the Gann Time Levels renderer**

Find the end of the file (the last line of the `SQUARE OF 9` section added in Task 5, the `line.set_x2(lvl.lineRef, bar_index + forwardProjection)` line) and append immediately after it:

```pinescript

// ============================================================
// GANN TIME LEVELS
// ============================================================
timeLevelsRedraw = showTimeLevels and (anchorChanged or timeLevelsToggleChanged) and not na(anchorBarIndex)

if timeLevelsRedraw
    for tl in activeTimeLevels
        line.delete(tl.lineRef)
    array.clear(activeTimeLevels)
    for i = 0 to array.size(gannTimeCycles) - 1
        cycle     = array.get(gannTimeCycles, i)
        targetBar = anchorBarIndex + cycle
        isMajor   = cycle == 90 or cycle == 180 or cycle == 270 or cycle == 360
        lineColor = isMajor ? color.new(color.blue, 0) : color.new(color.orange, 0)
        lineWidth = isMajor ? 2 : 1
        newLine   = line.new(targetBar, high, targetBar, low, color = lineColor, style = line.style_dotted, width = lineWidth, extend = extend.both)
        array.push(activeTimeLevels, GannTimeLevel.new(newLine, "T+" + str.tostring(cycle), targetBar, false))

if not showTimeLevels and array.size(activeTimeLevels) > 0
    for tl in activeTimeLevels
        line.delete(tl.lineRef)
    array.clear(activeTimeLevels)
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- `for i = 0 to array.size(gannTimeCycles) - 1` needs no size guard — `gannTimeCycles` is a fixed 9-element array from Task 1, never empty.
- `isMajor` matches the Global Constraints major-cycle list exactly (90, 180, 270, 360), with everything else (30, 45, 60, 120, 144) falling through to secondary/orange.
- `line.new(..., extend = extend.both)` with `x1 == x2` (`targetBar` used for both) draws a vertical line extended indefinitely in price — confirm `y1`/`y2` values (`high`/`low` of the current bar) are placeholders only, since `extend.both` on a vertical line makes the actual `y1`/`y2` values irrelevant to what's rendered.
- The second `if` block (deleting time-level lines when `showTimeLevels` is turned off) is independent of `modeInput`/price-mode state entirely — it fires purely off the toggle, not tied to `anchorChanged` or any price-mode redraw.
- `GannTimeLevel.new(newLine, "T+" + str.tostring(cycle), targetBar, false)` argument order matches Task 1's `type GannTimeLevel` field order (`lineRef, label, targetBar, reached`).

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add Gann Time Levels renderer"
```

---

### Task 7: Price/Time target table

**Files:**
- Modify: `src/gann-angles.pine` (append after the `GANN TIME LEVELS` section from Task 6 — this is the final section of the file)

**Interfaces:**
- Consumes: `activeLevels`, `activeTimeLevels`, `anchorPrice`, `anchorBarIndex`, `showTable`, `showTimeLevels`, `tablePositionInput`, `modeInput`, `previousMode`, `previousShowTimeLevels` (Tasks 1–6).
- Produces: mutates `touched`/`reached` fields on the objects already stored in `activeLevels`/`activeTimeLevels` (no new array, per the Global Constraints note on Pine UDT reference semantics); `gannTable` (`var table`); finalizes `previousMode`/`previousShowTimeLevels` for the next bar — this must be the LAST code in the file, since every earlier task's `modeChanged`/`timeLevelsToggleChanged` computation (Task 1) depends on these still holding the *previous* bar's values when Tasks 3–6 run.

- [ ] **Step 1: Append touched/reached tracking and the table**

Find the end of the file (the last line of the `GANN TIME LEVELS` section added in Task 6, the `array.clear(activeTimeLevels)` line inside the second `if` block) and append immediately after it:

```pinescript

// ============================================================
// PRICE / TIME TARGET TABLE
// ============================================================
if not na(anchorBarIndex)
    for lvl in activeLevels
        currentPrice = anchorPrice + lvl.slope * (bar_index - anchorBarIndex)
        if not lvl.touched and low <= currentPrice and high >= currentPrice
            lvl.touched := true

    for tl in activeTimeLevels
        tl.reached := bar_index >= tl.targetBar

var table gannTable = na

if showTable and barstate.islast
    table.delete(gannTable)
    tablePos = switch tablePositionInput
        "Top Right"    => position.top_right
        "Top Left"     => position.top_left
        "Bottom Right" => position.bottom_right
        => position.bottom_left
    rowCount = 1 + array.size(activeLevels) + (showTimeLevels ? 1 + array.size(activeTimeLevels) : 0)
    gannTable := table.new(tablePos, 3, rowCount, bgcolor = color.new(color.black, 80), border_width = 1)
    table.cell(gannTable, 0, 0, "Label", text_color = color.white, bgcolor = color.new(color.gray, 50))
    table.cell(gannTable, 1, 0, "Price", text_color = color.white, bgcolor = color.new(color.gray, 50))
    table.cell(gannTable, 2, 0, "Status", text_color = color.white, bgcolor = color.new(color.gray, 50))

    if array.size(activeLevels) > 0
        for i = 0 to array.size(activeLevels) - 1
            lvl      = array.get(activeLevels, i)
            rowPrice = anchorPrice + lvl.slope * (bar_index - anchorBarIndex)
            table.cell(gannTable, 0, i + 1, lvl.label, text_color = lvl.col)
            table.cell(gannTable, 1, i + 1, str.tostring(rowPrice, format.mintick), text_color = color.white)
            table.cell(gannTable, 2, i + 1, lvl.touched ? "Touched" : "Pending", text_color = lvl.touched ? color.lime : color.gray)

    if showTimeLevels and array.size(activeTimeLevels) > 0
        timeHeaderRow = 1 + array.size(activeLevels)
        table.cell(gannTable, 0, timeHeaderRow, "Time Level", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(gannTable, 1, timeHeaderRow, "Target Bar", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(gannTable, 2, timeHeaderRow, "Reached", text_color = color.white, bgcolor = color.new(color.gray, 50))
        for i = 0 to array.size(activeTimeLevels) - 1
            tl = array.get(activeTimeLevels, i)
            table.cell(gannTable, 0, timeHeaderRow + i + 1, tl.label, text_color = color.white)
            table.cell(gannTable, 1, timeHeaderRow + i + 1, str.tostring(tl.targetBar), text_color = color.white)
            table.cell(gannTable, 2, timeHeaderRow + i + 1, tl.reached ? "Yes" : "No", text_color = tl.reached ? color.lime : color.gray)

previousMode           := modeInput
previousShowTimeLevels := showTimeLevels
```

- [ ] **Step 2: Self-review**

No live compile-check available. Manually verify:
- Both `for i = 0 to array.size(activeLevels) - 1` and `for i = 0 to array.size(activeTimeLevels) - 1` are wrapped in `if array.size(...) > 0` guards — without them, an empty array (e.g. before any anchor has formed) would invert the loop bounds to `0 to -1`, triggering the same descending-loop bug called out in Global Constraints. Confirm the guards are present and correctly placed (wrapping the `for`, not just adjacent to it).
- The touched/reached update loops (`for lvl in activeLevels` / `for tl in activeTimeLevels`, near the top of this task) use the for-in form and correctly need no size guard, unlike the two numeric-range loops inside the table-building block below them.
- `lvl.touched := true` and `tl.reached := ...` mutate the SAME objects stored in `activeLevels`/`activeTimeLevels` (Pine UDT reference semantics, per Global Constraints) — confirm no task anywhere copies a `GannLevel`/`GannTimeLevel` into a new instance instead of mutating in place, which would silently desync the table's displayed status from the tracked state.
- `rowCount` accounts for exactly 1 (header) + `size(activeLevels)` (price rows) + optionally `1 + size(activeTimeLevels)` (time header + time rows) — cross-check this arithmetic against the row indices actually used (`i + 1` for price rows, `timeHeaderRow = 1 + size(activeLevels)` for the time header, `timeHeaderRow + i + 1` for time rows) to confirm no row index ever reaches or exceeds `rowCount`.
- `previousMode := modeInput` and `previousShowTimeLevels := showTimeLevels` are the LAST two statements in the entire file — confirm no code was accidentally appended after them in this task, since anything after would still see the OLD `previousMode`/`previousShowTimeLevels` values this bar (which is fine) but would be easy to lose track of in future edits.
- `switch tablePositionInput` uses a trailing bodyless `=>` arm as the default case (`position.bottom_left`) — confirm this is valid Pine v6 `switch`-as-expression syntax (all four `"Top Right"`/`"Top Left"`/`"Bottom Right"` cases covered explicitly, `"Bottom Left"` falls through to the default arm, which is equivalent).

- [ ] **Step 3: Commit**

```bash
git add src/gann-angles.pine
git commit -m "feat: add price/time target table with touched/reached tracking"
```

---

## Self-Review Notes

- **Spec coverage:** Mode switch + Fan (Task 3), Square/Box (Task 4), Square of 9 (Task 5) all covered; auto/manual anchor engine (Task 2) covers both the design's "Auto (Swing)" and "Manual" anchor modes; Gann Time Levels as an independent toggle (Task 6) matches the design's explicit decision that it works alongside any price mode, not as a 4th mutually-exclusive mode; the dual-section price/time table with sticky-touched and live-reached semantics (Task 7) matches the design's table spec exactly, including the major/secondary blue/orange convention applied consistently across all four tools (Tasks 3–6).
- **Placeholder scan:** no TBD/TODO markers; every step shows exact code to add, anchored to the exact preceding line from the prior task.
- **Type consistency:** `GannLevel`/`GannTimeLevel` field order (Task 1) matches every `GannLevel.new(...)`/`GannTimeLevel.new(...)` call across Tasks 3–6; `anchorPrice`/`anchorBarIndex`/`anchorType`/`opposingPrice`/`opposingBarIndex`/`anchorChanged` (Task 2) are consumed with identical names and meanings in Tasks 3–7; `activeLevels`/`activeTimeLevels` (Task 1) are populated identically (push pattern) by Tasks 3–6 and consumed generically (via the `slope`-based `currentPrice` formula, which works for both diagonal and horizontal lines) by Task 7 with no mode-specific branching required.
