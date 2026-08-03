# ICT + RSI/MA Confluence Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Pine Script v6 TradingView indicator combining RSI, MA, ICT market structure (BOS/CHoCH), Fair Value Gaps, order blocks, and London/New York killzones into confluence-based bullish/bearish signals with alerts.

**Architecture:** One self-contained `indicator()` script, built incrementally in a single file (`src/ict-rsi-ma-indicator.pine`). Each task appends a working section to the same file — inputs, then RSI/MA, then market structure, then FVG, then order blocks, then killzones, then the confluence engine, then alerts — so the script is always in a compilable, addable-to-chart state at the end of every task.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual via TradingView's Pine Editor (compile check) and chart inspection, per the spec.

## Global Constraints

- Pine version: `//@version=6`, single `indicator()` declaration, `overlay = true` (spec: single self-contained script, no library split for v1).
- RSI defaults: length 14, overbought 70, oversold 30.
- MA default: 50-period EMA, type configurable (EMA/SMA).
- Pivot lookback default: 5.
- Killzones: London (02:00–05:00) + New York (07:00–10:00), timezone input default `"Africa/Cairo"`, configurable.
- Max tracked unmitigated FVGs / order blocks: 20 each (configurable input), oldest dropped beyond the cap.
- RSI has no oscillator sub-pane (Pine Script indicators render to one pane only) — shown as an on-chart readout label instead; still fully used in confluence logic.
- FVG/order-block "mitigation" = first touch into the box's price range (simplification locked in for v1; documented in Task 4).
- Confluence signal direction-matching simplification: a bullish/bearish FVG or order block counts toward confluence whenever it's unmitigated and matches the *current* structure bias — it does not have to be from the exact same impulsive leg that caused the most recent break (documented in Task 7).
- No automated tests exist for Pine Script. Every task's verification step is: paste the current full file into TradingView's Pine Editor, click "Add to chart," confirm 0 errors in the console, then do the specific visual/behavioral check listed. If the console shows errors, fix them using the error message and re-check before moving on.

---

### Task 1: Script scaffold + inputs

**Files:**
- Create: `src/ict-rsi-ma-indicator.pine`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (consumed by all later tasks): input variables `rsiLength`, `rsiOverbought`, `rsiOversold`, `maTypeInput`, `maLength`, `pivotLookback`, `showFVG`, `fvgMaxCount`, `showOB`, `obMaxCount`, `obSearchBars`, `sessionTimezone`, `showLondonKZ`, `londonSession`, `showNewYorkKZ`, `newYorkSession`, `showSignalMarkers`, `showRsiReadout`, `watchZoneAtrLength`, `watchZoneAtrMult`.

- [ ] **Step 1: Write the script scaffold with all inputs**

```pinescript
//@version=6
indicator("ICT + RSI/MA Confluence", shorttitle = "ICT-RSI-MA", overlay = true, max_boxes_count = 200, max_labels_count = 200, max_lines_count = 200)

// ============================================================
// INPUTS
// ============================================================

// ---------------- RSI ----------------
rsiLength     = input.int(14, "RSI Length", minval = 1, group = "RSI")
rsiOverbought = input.int(70, "RSI Overbought Level", minval = 1, maxval = 100, group = "RSI")
rsiOversold   = input.int(30, "RSI Oversold Level", minval = 0, maxval = 99, group = "RSI")

// ---------------- Moving Average ----------------
maTypeInput = input.string("EMA", "MA Type", options = ["EMA", "SMA"], group = "Moving Average")
maLength    = input.int(50, "MA Length", minval = 1, group = "Moving Average")

// ---------------- Market Structure ----------------
pivotLookback = input.int(5, "Swing Pivot Lookback", minval = 2, group = "Market Structure")

// ---------------- Fair Value Gaps ----------------
showFVG     = input.bool(true, "Show Fair Value Gaps", group = "Fair Value Gaps")
fvgMaxCount = input.int(20, "Max Tracked FVGs (per side)", minval = 1, maxval = 50, group = "Fair Value Gaps")

// ---------------- Order Blocks ----------------
showOB       = input.bool(true, "Show Order Blocks", group = "Order Blocks")
obMaxCount   = input.int(20, "Max Tracked Order Blocks (per side)", minval = 1, maxval = 50, group = "Order Blocks")
obSearchBars = input.int(50, "Order Block Backward Search (bars)", minval = 5, maxval = 200, group = "Order Blocks")

// ---------------- Killzones ----------------
sessionTimezone = input.string("Africa/Cairo", "Session Timezone", group = "Killzones")
showLondonKZ    = input.bool(true, "Show London Killzone", group = "Killzones")
londonSession   = input.session("0200-0500", "London Killzone Time", group = "Killzones")
showNewYorkKZ   = input.bool(true, "Show New York Killzone", group = "Killzones")
newYorkSession  = input.session("0700-1000", "New York Killzone Time", group = "Killzones")

// ---------------- Alerts / Display ----------------
showSignalMarkers  = input.bool(true, "Show Signal Markers", group = "Alerts / Display")
showRsiReadout     = input.bool(true, "Show RSI Readout Label", group = "Alerts / Display")
watchZoneAtrLength = input.int(14, "Watch-Zone ATR Length", minval = 1, group = "Alerts / Display")
watchZoneAtrMult   = input.float(1.0, "Watch-Zone Proximity (x ATR)", minval = 0.1, step = 0.1, group = "Alerts / Display")
```

- [ ] **Step 2: Verify it compiles and inputs render correctly**

Open TradingView → Pine Editor → paste the full file contents → "Add to chart."
Expected: 0 errors/warnings in the console. Opening the indicator's Settings (gear icon) shows six grouped tabs — RSI, Moving Average, Market Structure, Fair Value Gaps, Order Blocks, Killzones, Alerts / Display — each with the fields listed above.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: scaffold ICT+RSI/MA indicator with input groups"
```

---

### Task 2: RSI + MA calculation and on-chart readout

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the INPUTS section)

**Interfaces:**
- Consumes: `rsiLength`, `rsiOverbought`, `rsiOversold`, `maTypeInput`, `maLength`, `showRsiReadout` (Task 1).
- Produces (consumed by Task 7): `rsiValue` (float), `maValue` (float), `rsiBullishConfirm` (bool), `rsiBearishConfirm` (bool), `maBullishConfirm` (bool), `maBearishConfirm` (bool).

- [ ] **Step 1: Add RSI/MA calculation, MA plot, and RSI readout label**

```pinescript
// ============================================================
// RSI + MA
// ============================================================
rsiValue = ta.rsi(close, rsiLength)
maValue  = maTypeInput == "EMA" ? ta.ema(close, maLength) : ta.sma(close, maLength)

plot(maValue, "MA", color = color.new(color.orange, 0), linewidth = 2)

rsiBullishConfirm = rsiValue <= rsiOversold
rsiBearishConfirm = rsiValue >= rsiOverbought
maBullishConfirm  = close > maValue
maBearishConfirm  = close < maValue

var label rsiReadoutLabel = na

if showRsiReadout and barstate.islast
    label.delete(rsiReadoutLabel)
    rsiReadoutLabel := label.new(x = bar_index, y = high, text = "RSI " + str.tostring(rsiValue, "#.##"), color = color.new(color.blue, 80), style = label.style_label_down, textcolor = color.white, size = size.small)
```

- [ ] **Step 2: Verify visually**

Add to chart on any symbol/timeframe. Expected: an orange MA line follows price; a small blue "RSI xx.xx" label sits near the last bar and updates as new bars form; toggling "Show RSI Readout Label" off in settings removes it; switching "MA Type" to SMA changes the line's calculation (compare against TradingView's built-in SMA for a sanity check).

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add RSI/MA calculation, MA plot, RSI readout label"
```

---

### Task 3: Market structure — swing pivots, BOS, CHoCH

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the RSI + MA section)

**Interfaces:**
- Consumes: `pivotLookback` (Task 1).
- Produces (consumed by Tasks 5 and 7): `structureBias` (`var string`, `"bullish"` / `"bearish"` / `na`), `bosBullish` (bool, true only on the confirming bar), `bosBearish` (bool), `chochBullish` (bool), `chochBearish` (bool).

- [ ] **Step 1: Add swing pivot tracking and break detection**

```pinescript
// ============================================================
// MARKET STRUCTURE (swings, BOS, CHoCH)
// ============================================================
// Simplification for v1: tracks a single active swing high and a single
// active swing low (the most recent confirmed pivot on each side), not a
// full multi-level swing history.
swingHigh = ta.pivothigh(high, pivotLookback, pivotLookback)
swingLow  = ta.pivotlow(low, pivotLookback, pivotLookback)

var float lastSwingHigh = na
var float lastSwingLow  = na
var string structureBias = na

if not na(swingHigh)
    lastSwingHigh := swingHigh
if not na(swingLow)
    lastSwingLow := swingLow

bosBullish   = false
bosBearish   = false
chochBullish = false
chochBearish = false

if not na(lastSwingHigh) and close > lastSwingHigh and close[1] <= lastSwingHigh
    if structureBias == "bearish"
        chochBullish := true
    else
        bosBullish := true
    structureBias := "bullish"
    lastSwingHigh := na

if not na(lastSwingLow) and close < lastSwingLow and close[1] >= lastSwingLow
    if structureBias == "bullish"
        chochBearish := true
    else
        bosBearish := true
    structureBias := "bearish"
    lastSwingLow := na

if bosBullish
    label.new(bar_index, low, "BOS", color = color.new(color.lime, 0), style = label.style_label_up, textcolor = color.black, size = size.tiny)
if chochBullish
    label.new(bar_index, low, "CHoCH", color = color.new(color.green, 0), style = label.style_label_up, textcolor = color.white, size = size.tiny)
if bosBearish
    label.new(bar_index, high, "BOS", color = color.new(color.red, 0), style = label.style_label_down, textcolor = color.white, size = size.tiny)
if chochBearish
    label.new(bar_index, high, "CHoCH", color = color.new(color.maroon, 0), style = label.style_label_down, textcolor = color.white, size = size.tiny)
```

- [ ] **Step 2: Verify visually**

Add to chart on a trending symbol at a 15m or 1H timeframe. Expected: green "BOS"/"CHoCH" labels appear below bars where price breaks above the last swing high; red labels appear above bars where price breaks below the last swing low; the first label after a bias flip reads "CHoCH", subsequent same-direction breaks read "BOS." Use Bar Replay to confirm a label never appears on a bar, then disappears or moves on a later bar (non-repainting).

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add market structure swing detection and BOS/CHoCH labels"
```

---

### Task 4: Fair Value Gap detection and lifecycle

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the Market Structure section)

**Interfaces:**
- Consumes: `showFVG`, `fvgMaxCount` (Task 1).
- Produces (consumed by Tasks 5 and 7): `bullishFvgBoxes` (`var array<box>`), `bearishFvgBoxes` (`var array<box>`), reusable function `mitigateBoxes(boxArray, isBullish)`, reusable function `priceInsideAnyBox(boxArray)` (bool).

- [ ] **Step 1: Add FVG detection, drawing, and mitigation**

```pinescript
// ============================================================
// FAIR VALUE GAPS
// ============================================================
// Mitigation rule for v1: a box is removed the first time price touches
// any part of its range (not full fill) — simplest, most testable
// interpretation of "auto-remove when mitigated."
var box[] bullishFvgBoxes = array.new<box>()
var box[] bearishFvgBoxes = array.new<box>()

mitigateBoxes(boxArray, isBullish) =>
    for i = array.size(boxArray) - 1 to 0
        b = array.get(boxArray, i)
        top = box.get_top(b)
        bottom = box.get_bottom(b)
        touched = isBullish ? low <= top : high >= bottom
        if touched
            box.delete(b)
            array.remove(boxArray, i)
        else
            box.set_right(b, bar_index)
    array.size(boxArray)

priceInsideAnyBox(boxArray) =>
    result = false
    if array.size(boxArray) > 0
        for i = 0 to array.size(boxArray) - 1
            b = array.get(boxArray, i)
            if close <= box.get_top(b) and close >= box.get_bottom(b)
                result := true
    result

bullishFvgDetected = showFVG and low > high[2]
bearishFvgDetected = showFVG and high < low[2]

if bullishFvgDetected
    newBullishFvg = box.new(bar_index[2], low, bar_index, high[2], border_color = color.new(color.teal, 40), bgcolor = color.new(color.teal, 85))
    array.push(bullishFvgBoxes, newBullishFvg)
    if array.size(bullishFvgBoxes) > fvgMaxCount
        box.delete(array.shift(bullishFvgBoxes))

if bearishFvgDetected
    newBearishFvg = box.new(bar_index[2], low[2], bar_index, high, border_color = color.new(color.red, 40), bgcolor = color.new(color.red, 85))
    array.push(bearishFvgBoxes, newBearishFvg)
    if array.size(bearishFvgBoxes) > fvgMaxCount
        box.delete(array.shift(bearishFvgBoxes))

mitigateBoxes(bullishFvgBoxes, true)
mitigateBoxes(bearishFvgBoxes, false)
```

- [ ] **Step 2: Verify visually**

Add to chart on a volatile symbol at a low timeframe (1m–5m) where gaps are common. Expected: teal boxes appear at bullish 3-candle imbalances, red boxes at bearish ones; a box disappears the first time price trades back into its range; the count of boxes on screen never exceeds `fvgMaxCount` per side even after scrolling through a long history; toggling "Show Fair Value Gaps" off stops new boxes from being drawn (existing ones can remain until mitigated — acceptable for v1).

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add FVG detection, drawing, and mitigation lifecycle"
```

---

### Task 5: Order block detection and lifecycle

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the Fair Value Gaps section)

**Interfaces:**
- Consumes: `showOB`, `obMaxCount`, `obSearchBars` (Task 1); `bosBullish`, `bosBearish`, `chochBullish`, `chochBearish` (Task 3); `mitigateBoxes(boxArray, isBullish)` (Task 4).
- Produces (consumed by Task 7): `bullishObBoxes` (`var array<box>`), `bearishObBoxes` (`var array<box>`).

- [ ] **Step 1: Add order block detection, drawing, and mitigation**

```pinescript
// ============================================================
// ORDER BLOCKS
// ============================================================
var box[] bullishObBoxes = array.new<box>()
var box[] bearishObBoxes = array.new<box>()

findOppositeCandle(isBullishBreak) =>
    idx = -1
    for i = 1 to obSearchBars
        isDownCandle = close[i] < open[i]
        isUpCandle   = close[i] > open[i]
        if isBullishBreak and isDownCandle
            idx := i
            break
        if not isBullishBreak and isUpCandle
            idx := i
            break
    idx

if showOB and (bosBullish or chochBullish)
    obOffset = findOppositeCandle(true)
    if obOffset >= 0
        newBullishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.blue, 40), bgcolor = color.new(color.blue, 85))
        array.push(bullishObBoxes, newBullishOb)
        if array.size(bullishObBoxes) > obMaxCount
            box.delete(array.shift(bullishObBoxes))

if showOB and (bosBearish or chochBearish)
    obOffset = findOppositeCandle(false)
    if obOffset >= 0
        newBearishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.purple, 40), bgcolor = color.new(color.purple, 85))
        array.push(bearishObBoxes, newBearishOb)
        if array.size(bearishObBoxes) > obMaxCount
            box.delete(array.shift(bearishObBoxes))

mitigateBoxes(bullishObBoxes, true)
mitigateBoxes(bearishObBoxes, false)
```

- [ ] **Step 2: Verify visually**

Add to chart where BOS/CHoCH labels from Task 3 are visible. Expected: a blue box appears at the last down-candle before each bullish BOS/CHoCH, a purple box at the last up-candle before each bearish BOS/CHoCH; boxes disappear on first mitigation touch, same as FVGs; toggling "Show Order Blocks" off stops new boxes from being drawn.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add order block detection, drawing, and mitigation"
```

---

### Task 6: Killzone session shading

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the Order Blocks section)

**Interfaces:**
- Consumes: `showLondonKZ`, `londonSession`, `showNewYorkKZ`, `newYorkSession`, `sessionTimezone` (Task 1).
- Produces (consumed by Task 7 and Task 8): `killzoneActive` (bool).

- [ ] **Step 1: Add session detection and background shading**

```pinescript
// ============================================================
// KILLZONE SESSIONS
// ============================================================
londonActive  = showLondonKZ and not na(time(timeframe.period, londonSession, sessionTimezone))
newYorkActive = showNewYorkKZ and not na(time(timeframe.period, newYorkSession, sessionTimezone))
killzoneActive = londonActive or newYorkActive

bgcolor(londonActive ? color.new(color.blue, 90) : na, title = "London Killzone")
bgcolor(newYorkActive ? color.new(color.orange, 90) : na, title = "New York Killzone")
```

- [ ] **Step 2: Verify visually**

Add to chart at a 15m or 1H timeframe. Expected: a light blue background appears during 02:00–05:00 and a light orange background during 07:00–10:00, both evaluated in Egypt time by default; changing "Session Timezone" to `"America/New_York"` shifts the shading to align with US Eastern time instead; disabling either killzone toggle removes its shading.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add London/New York killzone session shading"
```

---

### Task 7: Confluence engine and signal markers

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the Killzone Sessions section)

**Interfaces:**
- Consumes: `structureBias`, `bosBullish`, `bosBearish`, `chochBullish`, `chochBearish` (Task 3); `priceInsideAnyBox(boxArray)`, `bullishFvgBoxes`, `bearishFvgBoxes` (Task 4); `bullishObBoxes`, `bearishObBoxes` (Task 5); `killzoneActive` (Task 6); `rsiBullishConfirm`, `rsiBearishConfirm`, `maBullishConfirm`, `maBearishConfirm` (Task 2); `showSignalMarkers` (Task 1).
- Produces (consumed by Task 8): `bullishSignal` (bool, true only on the bar the confluence completes), `bearishSignal` (bool), `inBullishZone` (bool), `inBearishZone` (bool).
- Documented simplification: a box counts toward confluence whenever it matches the *current* `structureBias` and is unmitigated — it doesn't have to be from the exact leg that produced the most recent break.

- [ ] **Step 1: Add confluence logic and plotshape markers**

```pinescript
// ============================================================
// CONFLUENCE SIGNALS
// ============================================================
var bool bullishSignalFired = false
var bool bearishSignalFired = false

if chochBullish or bosBullish
    bullishSignalFired := false
if chochBearish or bosBearish
    bearishSignalFired := false

inBullishZone = priceInsideAnyBox(bullishFvgBoxes) or priceInsideAnyBox(bullishObBoxes)
inBearishZone = priceInsideAnyBox(bearishFvgBoxes) or priceInsideAnyBox(bearishObBoxes)

bullishSignal = structureBias == "bullish" and inBullishZone and killzoneActive and rsiBullishConfirm and maBullishConfirm and not bullishSignalFired
bearishSignal = structureBias == "bearish" and inBearishZone and killzoneActive and rsiBearishConfirm and maBearishConfirm and not bearishSignalFired

if bullishSignal
    bullishSignalFired := true
if bearishSignal
    bearishSignalFired := true

plotshape(showSignalMarkers and bullishSignal, title = "Bullish Signal", style = shape.triangleup, location = location.belowbar, color = color.new(color.lime, 0), size = size.small)
plotshape(showSignalMarkers and bearishSignal, title = "Bearish Signal", style = shape.triangledown, location = location.abovebar, color = color.new(color.red, 0), size = size.small)
```

- [ ] **Step 2: Verify visually**

Add to chart and scan history for a bar where a green up-triangle or red down-triangle appears below/above a bar. For each marker found, manually confirm on that bar: `structureBias` matches the marker direction (check the most recent BOS/CHoCH label before it), price was inside a same-direction FVG/OB box, the background was shaded (killzone active), and RSI/MA readout supports the direction. Confirm no two markers of the same direction appear back-to-back without an intervening opposite-direction BOS/CHoCH between them (the "fires once per setup" rule).

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add confluence engine and signal markers"
```

---

### Task 8: Watch-zone heads-up and alerts

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (append after the Confluence Signals section)

**Interfaces:**
- Consumes: `watchZoneAtrLength`, `watchZoneAtrMult` (Task 1); `structureBias` (Task 3); `bullishFvgBoxes`, `bearishFvgBoxes` (Task 4); `bullishObBoxes`, `bearishObBoxes` (Task 5); `killzoneActive` (Task 6); `bullishSignal`, `bearishSignal`, `inBullishZone`, `inBearishZone` (Task 7).
- Produces: nothing further consumed in-script — this is the final task; `alertcondition()` calls surface in TradingView's "Create Alert" dialog.

- [ ] **Step 1: Add watch-zone proximity check and alert conditions**

```pinescript
// ============================================================
// WATCH-ZONE HEADS-UP
// ============================================================
atrValue = ta.atr(watchZoneAtrLength)

nearestBoxDistance(boxArray) =>
    minDist = float(na)
    if array.size(boxArray) > 0
        for i = 0 to array.size(boxArray) - 1
            b = array.get(boxArray, i)
            top = box.get_top(b)
            bottom = box.get_bottom(b)
            dist = close > top ? close - top : (close < bottom ? bottom - close : 0.0)
            if na(minDist) or dist < minDist
                minDist := dist
    minDist

bullishFvgDist = nearestBoxDistance(bullishFvgBoxes)
bullishObDist  = nearestBoxDistance(bullishObBoxes)
bearishFvgDist = nearestBoxDistance(bearishFvgBoxes)
bearishObDist  = nearestBoxDistance(bearishObBoxes)

closestBullishDist = na(bullishFvgDist) ? bullishObDist : (na(bullishObDist) ? bullishFvgDist : math.min(bullishFvgDist, bullishObDist))
closestBearishDist = na(bearishFvgDist) ? bearishObDist : (na(bearishObDist) ? bearishFvgDist : math.min(bearishFvgDist, bearishObDist))

bullishWatchZone = structureBias == "bullish" and killzoneActive and not inBullishZone and not na(closestBullishDist) and closestBullishDist <= atrValue * watchZoneAtrMult
bearishWatchZone = structureBias == "bearish" and killzoneActive and not inBearishZone and not na(closestBearishDist) and closestBearishDist <= atrValue * watchZoneAtrMult

// ============================================================
// ALERTS
// ============================================================
alertcondition(bullishSignal, title = "Bullish Confluence Signal", message = "Bullish confluence signal on {{ticker}} {{interval}}: structure + FVG/OB + killzone + RSI/MA aligned bullish.")
alertcondition(bearishSignal, title = "Bearish Confluence Signal", message = "Bearish confluence signal on {{ticker}} {{interval}}: structure + FVG/OB + killzone + RSI/MA aligned bearish.")
alertcondition(bullishWatchZone, title = "Bullish Watch-Zone", message = "Watch: price approaching an unmitigated bullish FVG/OB during a killzone on {{ticker}} {{interval}}.")
alertcondition(bearishWatchZone, title = "Bearish Watch-Zone", message = "Watch: price approaching an unmitigated bearish FVG/OB during a killzone on {{ticker}} {{interval}}.")
```

- [ ] **Step 2: Verify alert conditions are creatable**

Add to chart, open TradingView's "Create Alert" dialog for this indicator. Expected: the "Condition" dropdown lists four entries — "Bullish Confluence Signal," "Bearish Confluence Signal," "Bullish Watch-Zone," "Bearish Watch-Zone." Create a test alert on each to confirm no errors when saving.

- [ ] **Step 3: Full-script verification pass (per spec's Testing section)**

- Apply the finished script to at least three symbols across different asset classes (e.g. EURUSD, BTCUSD, a stock) at 5m, 15m, and 1H, confirming RSI readout, MA, structure labels, FVG/OB boxes, killzone shading, and signal markers all render without console errors on each.
- Use Bar Replay on at least one symbol/timeframe to step through history and confirm a `bullishSignal`/`bearishSignal` marker, once shown at a given bar, does not move or disappear as later bars form (non-repainting).
- Confirm changing "Session Timezone" between `"Africa/Cairo"` and another IANA timezone string shifts the killzone shading and watch-zone/signal timing accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add watch-zone heads-up alert and confluence alertconditions"
```

---

## Self-Review Notes

- **Spec coverage:** RSI/MA (Task 2), market structure BOS/CHoCH (Task 3), FVG lifecycle (Task 4), order block lifecycle (Task 5), killzone sessions with configurable timezone (Task 6), confluence engine + markers (Task 7), watch-zone + all three alert types (Task 8), manual verification per the spec's Testing section (Task 8 Step 3), repainting-safety check (Task 3 Step 2, Task 8 Step 3), box/line caps (Tasks 4 and 5 enforce `fvgMaxCount`/`obMaxCount`). All spec sections are covered.
- **Placeholder scan:** no TBD/TODO markers; every step has real code or a concrete manual-verification procedure.
- **Type consistency:** `boxArray` parameters, `bullishFvgBoxes`/`bearishFvgBoxes`/`bullishObBoxes`/`bearishObBoxes` arrays, and `structureBias`/`bosBullish`/`bosBearish`/`chochBullish`/`chochBearish` names are used identically across every task that consumes them.
