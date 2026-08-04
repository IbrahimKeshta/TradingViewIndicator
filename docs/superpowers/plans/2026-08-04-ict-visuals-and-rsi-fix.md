# ICT Indicator — Visual Enhancements & RSI Confirm Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bullish/bearish confluence signals never firing, and add FVG/order-block box type labels plus dotted BOS/CHoCH break lines to `src/ict-rsi-ma-indicator.pine`.

**Architecture:** Three sequential edits to the existing single-file indicator — no new files, no new sections. Each task is self-contained within the existing MARKET STRUCTURE / RSI + MA / FAIR VALUE GAPS / ORDER BLOCKS sections.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual via TradingView's Pine Editor (compile check) and chart inspection, same as the base project.

## Global Constraints

- RSI confluence confirm becomes a midline check: `rsiBullishConfirm = rsiValue > 50`, `rsiBearishConfirm = rsiValue < 50`. The RSI readout label's OB/OS suffix must NOT use these — it gets its own booleans (`rsiOverboughtState = rsiValue >= rsiOverbought`, `rsiOversoldState = rsiValue <= rsiOversold`) driven by the unchanged `rsiOverbought`/`rsiOversold` inputs.
- BOS/CHoCH dotted lines: horizontal, `style = line.style_dotted`, from the broken swing's bar to the breaking bar, at the swing's price. Colors match the existing labels exactly: bullish BOS = lime, bullish CHoCH = green, bearish BOS = red, bearish CHoCH = maroon.
- FVG/OB box labels: text `"FVG"` or `"OB"`, color matches the box's existing border color, positioned at `x = box's left bar index`, `y = box top`, `style = label.style_label_down`, `size = size.tiny`.
- Box labels must be deleted in lockstep with their box (both on mitigation and on cap-eviction) — `mitigateBoxes` gains a `labelArray` parameter used at both its existing removal points.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review (no live TradingView compile-check is available in this environment — do not claim one was performed).
- The file being modified already exists at `src/ict-rsi-ma-indicator.pine` on `master` (commit `212f651`). Each task below shows the exact current text to find and its replacement — locate by the shown surrounding code / section comment, since exact line numbers may drift slightly between tasks.

---

### Task 1: Fix RSI confirmation logic (bug fix)

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (RSI + MA section, roughly lines 50-61 as of commit `212f651`)

**Interfaces:**
- Consumes: `rsiValue`, `rsiOverbought`, `rsiOversold` (existing inputs/calc, unchanged).
- Produces (consumed by CONFLUENCE SIGNALS and WATCH-ZONE sections, unchanged downstream): `rsiBullishConfirm`, `rsiBearishConfirm` — same names, NEW meaning (midline check instead of extreme check). Also produces two new booleans, `rsiOverboughtState`, `rsiOversoldState`, consumed only by the RSI readout label in this same section.

- [ ] **Step 1: Locate and replace the RSI confirm block**

Find this exact block in the RSI + MA section:

```pinescript
rsiBullishConfirm = rsiValue <= rsiOversold
rsiBearishConfirm = rsiValue >= rsiOverbought
maBullishConfirm  = close > maValue
maBearishConfirm  = close < maValue

var label rsiReadoutLabel = na

rsiStateSuffix = rsiBearishConfirm ? " OB" : rsiBullishConfirm ? " OS" : ""
```

Replace it with:

```pinescript
rsiBullishConfirm = rsiValue > 50
rsiBearishConfirm = rsiValue < 50
maBullishConfirm  = close > maValue
maBearishConfirm  = close < maValue

rsiOverboughtState = rsiValue >= rsiOverbought
rsiOversoldState   = rsiValue <= rsiOversold

var label rsiReadoutLabel = na

rsiStateSuffix = rsiOverboughtState ? " OB" : rsiOversoldState ? " OS" : ""
```

Do not change anything else in the RSI + MA section (the `if showRsiReadout and barstate.islast` block below stays exactly as-is — it already references `rsiStateSuffix` by name, which still works).

- [ ] **Step 2: Self-review**

No live TradingView compile-check is available. Instead, manually verify:
- `rsiBullishConfirm`/`rsiBearishConfirm` are used unchanged (by name) in the CONFLUENCE SIGNALS section (`bullishSignal`/`bearishSignal` expressions) and nowhere else needs updating — grep the file for `rsiBullishConfirm` and `rsiBearishConfirm` to confirm every usage still makes sense with the new midline meaning.
- `rsiOverboughtState`/`rsiOversoldState` are new names not used anywhere else in the file yet (no collision).
- The ternary syntax `rsiOverboughtState ? " OB" : rsiOversoldState ? " OS" : ""` is valid Pine v6 (chained ternary, right-associative).

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "fix: use RSI midline instead of oversold/overbought extreme for confluence confirm"
```

---

### Task 2: BOS/CHoCH dotted break lines

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (MARKET STRUCTURE section, roughly lines 63-109 as of commit `212f651`)

**Interfaces:**
- Consumes: `pivotLookback` (existing input), `structureBias`, `bosBullish`, `bosBearish`, `chochBullish`, `chochBearish` (existing, unchanged names/meaning).
- Produces: two new persistent variables `lastSwingHighBarIndex` (`var int`), `lastSwingLowBarIndex` (`var int`) — internal to this section only, not consumed elsewhere.

- [ ] **Step 1: Add bar-index tracking for swing pivots**

Find:

```pinescript
var float lastSwingHigh = na
var float lastSwingLow  = na
var string structureBias = na

if not na(swingHigh)
    lastSwingHigh := swingHigh
if not na(swingLow)
    lastSwingLow := swingLow
```

Replace with:

```pinescript
var float lastSwingHigh = na
var float lastSwingLow  = na
var int lastSwingHighBarIndex = na
var int lastSwingLowBarIndex  = na
var string structureBias = na

if not na(swingHigh)
    lastSwingHigh := swingHigh
    lastSwingHighBarIndex := bar_index - pivotLookback
if not na(swingLow)
    lastSwingLow := swingLow
    lastSwingLowBarIndex := bar_index - pivotLookback
```

(`ta.pivothigh`/`ta.pivotlow` confirm `pivotLookback` bars after the actual pivot bar, so the pivot's real bar index at confirmation time is `bar_index - pivotLookback`.)

- [ ] **Step 2: Draw the dotted line at each break, before the swing state resets**

Find:

```pinescript
if barstate.isconfirmed and not na(lastSwingHigh) and close > lastSwingHigh and close[1] <= lastSwingHigh
    if structureBias == "bearish"
        chochBullish := true
    else
        bosBullish := true
    structureBias := "bullish"
    lastSwingHigh := na

if barstate.isconfirmed and not na(lastSwingLow) and close < lastSwingLow and close[1] >= lastSwingLow
    if structureBias == "bullish"
        chochBearish := true
    else
        bosBearish := true
    structureBias := "bearish"
    lastSwingLow := na
```

Replace with:

```pinescript
if barstate.isconfirmed and not na(lastSwingHigh) and close > lastSwingHigh and close[1] <= lastSwingHigh
    if structureBias == "bearish"
        chochBullish := true
        line.new(lastSwingHighBarIndex, lastSwingHigh, bar_index, lastSwingHigh, color = color.new(color.green, 0), style = line.style_dotted)
    else
        bosBullish := true
        line.new(lastSwingHighBarIndex, lastSwingHigh, bar_index, lastSwingHigh, color = color.new(color.lime, 0), style = line.style_dotted)
    structureBias := "bullish"
    lastSwingHigh := na

if barstate.isconfirmed and not na(lastSwingLow) and close < lastSwingLow and close[1] >= lastSwingLow
    if structureBias == "bullish"
        chochBearish := true
        line.new(lastSwingLowBarIndex, lastSwingLow, bar_index, lastSwingLow, color = color.new(color.maroon, 0), style = line.style_dotted)
    else
        bosBearish := true
        line.new(lastSwingLowBarIndex, lastSwingLow, bar_index, lastSwingLow, color = color.new(color.red, 0), style = line.style_dotted)
    structureBias := "bearish"
    lastSwingLow := na
```

Do not change the four `label.new(...)` calls further down in this section (the existing "BOS"/"CHoCH" text labels) — they stay exactly as-is; the line is a separate visual drawn in addition to them.

- [ ] **Step 3: Self-review**

Manually verify (no live compile-check available):
- `line.new(x1, y1, x2, y2, color=, style=)` positional/named argument usage is valid Pine v6 syntax.
- `lastSwingHighBarIndex`/`lastSwingLowBarIndex` are read (in the line call) BEFORE `lastSwingHigh`/`lastSwingLow` are reset to `na` on the following line — confirm the line-drawing statement is positioned before the `:= na` reset in each block (it is, in the replacement above — the line call happens inside the `if structureBias == ... / else` branch, which executes before the trailing `lastSwingHigh := na`).
- The color assignments match the constraint exactly: bullish BOS=lime, bullish CHoCH=green, bearish BOS=red, bearish CHoCH=maroon.

- [ ] **Step 4: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: draw dotted line from broken swing to breaking candle on BOS/CHoCH"
```

---

### Task 3: FVG/Order Block box type labels

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` (FAIR VALUE GAPS section, roughly lines 111-160, and ORDER BLOCKS section, roughly lines 162-199, as of commit `212f651`)

**Interfaces:**
- Consumes: `showFVG`, `fvgMaxCount`, `showOB`, `obMaxCount`, `obSearchBars` (existing inputs, unchanged); `bosBullish`, `bosBearish`, `chochBullish`, `chochBearish` (existing, unchanged).
- Produces: `mitigateBoxes(boxArray, labelArray, isBullish)` — SIGNATURE CHANGE from the existing `mitigateBoxes(boxArray, isBullish)` (gains a `labelArray` parameter in the middle). Every existing call site updates in this same task. Also produces four new persistent arrays: `bullishFvgLabels`, `bearishFvgLabels` (`var array<label>`), `bullishObLabels`, `bearishObLabels` (`var array<label>`) — paired index-for-index with the existing `bullishFvgBoxes`/`bearishFvgBoxes`/`bullishObBoxes`/`bearishObBoxes`.
- `priceInsideAnyBox(boxArray)` is NOT changed — it only reads boxes, never deletes, so it doesn't need the label array.

- [ ] **Step 1: Update `mitigateBoxes` to delete the paired label, and add the FVG label arrays**

Find (FAIR VALUE GAPS section):

```pinescript
var box[] bullishFvgBoxes = array.new<box>()
var box[] bearishFvgBoxes = array.new<box>()

mitigateBoxes(boxArray, isBullish) =>
    if array.size(boxArray) > 0
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
```

Replace with:

```pinescript
var box[] bullishFvgBoxes = array.new<box>()
var box[] bearishFvgBoxes = array.new<box>()
var label[] bullishFvgLabels = array.new<label>()
var label[] bearishFvgLabels = array.new<label>()

mitigateBoxes(boxArray, labelArray, isBullish) =>
    if array.size(boxArray) > 0
        for i = array.size(boxArray) - 1 to 0
            b = array.get(boxArray, i)
            top = box.get_top(b)
            bottom = box.get_bottom(b)
            touched = isBullish ? low <= top : high >= bottom
            if touched
                box.delete(b)
                array.remove(boxArray, i)
                label.delete(array.get(labelArray, i))
                array.remove(labelArray, i)
            else
                box.set_right(b, bar_index)
    array.size(boxArray)
```

- [ ] **Step 2: Update the FVG mitigation calls and creation blocks**

Find:

```pinescript
// must run before creation — a box must not be tested against its own creation bar
mitigateBoxes(bullishFvgBoxes, true)
mitigateBoxes(bearishFvgBoxes, false)

bullishFvgDetected = barstate.isconfirmed and showFVG and low > high[2]
bearishFvgDetected = barstate.isconfirmed and showFVG and high < low[2]

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
```

Replace with:

```pinescript
// must run before creation — a box must not be tested against its own creation bar
mitigateBoxes(bullishFvgBoxes, bullishFvgLabels, true)
mitigateBoxes(bearishFvgBoxes, bearishFvgLabels, false)

bullishFvgDetected = barstate.isconfirmed and showFVG and low > high[2]
bearishFvgDetected = barstate.isconfirmed and showFVG and high < low[2]

if bullishFvgDetected
    newBullishFvg = box.new(bar_index[2], low, bar_index, high[2], border_color = color.new(color.teal, 40), bgcolor = color.new(color.teal, 85))
    newBullishFvgLabel = label.new(x = bar_index[2], y = low, text = "FVG", color = color.new(color.teal, 40), style = label.style_label_down, textcolor = color.white, size = size.tiny)
    array.push(bullishFvgBoxes, newBullishFvg)
    array.push(bullishFvgLabels, newBullishFvgLabel)
    if array.size(bullishFvgBoxes) > fvgMaxCount
        box.delete(array.shift(bullishFvgBoxes))
        label.delete(array.shift(bullishFvgLabels))

if bearishFvgDetected
    newBearishFvg = box.new(bar_index[2], low[2], bar_index, high, border_color = color.new(color.red, 40), bgcolor = color.new(color.red, 85))
    newBearishFvgLabel = label.new(x = bar_index[2], y = low[2], text = "FVG", color = color.new(color.red, 40), style = label.style_label_down, textcolor = color.white, size = size.tiny)
    array.push(bearishFvgBoxes, newBearishFvg)
    array.push(bearishFvgLabels, newBearishFvgLabel)
    if array.size(bearishFvgBoxes) > fvgMaxCount
        box.delete(array.shift(bearishFvgBoxes))
        label.delete(array.shift(bearishFvgLabels))
```

Note the label `y` matches each box's `top` argument exactly (bullish box top = `low`, bearish box top = `low[2]`) — this is intentional, per the plan's constraint that the label sits at the box's top edge.

- [ ] **Step 3: Update the Order Block arrays, mitigation calls, and creation blocks**

Find (ORDER BLOCKS section):

```pinescript
var box[] bullishObBoxes = array.new<box>()
var box[] bearishObBoxes = array.new<box>()

findOppositeCandle(isBullishBreak) =>
```

Replace with:

```pinescript
var box[] bullishObBoxes = array.new<box>()
var box[] bearishObBoxes = array.new<box>()
var label[] bullishObLabels = array.new<label>()
var label[] bearishObLabels = array.new<label>()

findOppositeCandle(isBullishBreak) =>
```

(Leave the body of `findOppositeCandle` untouched — only the array declarations above it change.)

Then find:

```pinescript
// must run before creation — a box must not be tested against its own creation bar
mitigateBoxes(bullishObBoxes, true)
mitigateBoxes(bearishObBoxes, false)

if barstate.isconfirmed and showOB and (bosBullish or chochBullish)
    obOffset = findOppositeCandle(true)
    if obOffset >= 0
        newBullishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.blue, 40), bgcolor = color.new(color.blue, 85))
        array.push(bullishObBoxes, newBullishOb)
        if array.size(bullishObBoxes) > obMaxCount
            box.delete(array.shift(bullishObBoxes))

if barstate.isconfirmed and showOB and (bosBearish or chochBearish)
    obOffset = findOppositeCandle(false)
    if obOffset >= 0
        newBearishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.purple, 40), bgcolor = color.new(color.purple, 85))
        array.push(bearishObBoxes, newBearishOb)
        if array.size(bearishObBoxes) > obMaxCount
            box.delete(array.shift(bearishObBoxes))
```

Replace with:

```pinescript
// must run before creation — a box must not be tested against its own creation bar
mitigateBoxes(bullishObBoxes, bullishObLabels, true)
mitigateBoxes(bearishObBoxes, bearishObLabels, false)

if barstate.isconfirmed and showOB and (bosBullish or chochBullish)
    obOffset = findOppositeCandle(true)
    if obOffset >= 0
        newBullishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.blue, 40), bgcolor = color.new(color.blue, 85))
        newBullishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = "OB", color = color.new(color.blue, 40), style = label.style_label_down, textcolor = color.white, size = size.tiny)
        array.push(bullishObBoxes, newBullishOb)
        array.push(bullishObLabels, newBullishObLabel)
        if array.size(bullishObBoxes) > obMaxCount
            box.delete(array.shift(bullishObBoxes))
            label.delete(array.shift(bullishObLabels))

if barstate.isconfirmed and showOB and (bosBearish or chochBearish)
    obOffset = findOppositeCandle(false)
    if obOffset >= 0
        newBearishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.purple, 40), bgcolor = color.new(color.purple, 85))
        newBearishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = "OB", color = color.new(color.purple, 40), style = label.style_label_down, textcolor = color.white, size = size.tiny)
        array.push(bearishObBoxes, newBearishOb)
        array.push(bearishObLabels, newBearishObLabel)
        if array.size(bearishObBoxes) > obMaxCount
            box.delete(array.shift(bearishObBoxes))
            label.delete(array.shift(bearishObLabels))
```

Both bullish and bearish OB labels use `y = high[obOffset]` (matching each box's `top` argument, which is `high[obOffset]` for both directions in the existing OB code) — this is correct, not a copy-paste mistake.

- [ ] **Step 4: Self-review**

No live TradingView compile-check is available. Manually verify:
- Every remaining call to `mitigateBoxes(...)` in the file now passes 3 arguments (box array, label array, isBullish) — grep for `mitigateBoxes(` and confirm all 4 call sites (2 in FVG, 2 in OB) match the new 3-arg signature. There should be no 2-arg calls left.
- Every array pair (`bullishFvgBoxes`/`bullishFvgLabels`, `bearishFvgBoxes`/`bearishFvgLabels`, `bullishObBoxes`/`bullishObLabels`, `bearishObBoxes`/`bearishObLabels`) is pushed together, shifted together, and removed together at every site that mutates them — no site pushes/shifts/removes a box without doing the same to its paired label array at the same index, and vice versa. A mismatch here would desync the two arrays' indices and corrupt later mitigation/eviction.
- `label.new(x=, y=, text=, color=, style=, textcolor=, size=)` named-argument usage is valid Pine v6 syntax, consistent with the existing `rsiReadoutLabel`/BOS/CHoCH label calls elsewhere in the file.
- `priceInsideAnyBox` was NOT modified (it doesn't touch labels) — confirm its definition is unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add FVG/OB type labels, paired lifecycle with their boxes"
```

---

## Self-Review Notes

- **Spec coverage:** RSI confirm fix + decoupled OB/OS readout (Task 1), BOS/CHoCH dotted lines with correct bar-index tracking and color scheme (Task 2), FVG/OB box labels with paired lifecycle management via the extended `mitigateBoxes` signature (Task 3). All three spec sections have a corresponding task.
- **Placeholder scan:** no TBD/TODO markers; every step shows the exact before/after code.
- **Type consistency:** `mitigateBoxes(boxArray, labelArray, isBullish)`'s new signature is used identically at all 4 call sites across Task 3's two steps; `lastSwingHighBarIndex`/`lastSwingLowBarIndex` names are used consistently between their declaration (Step 1) and use (Step 2) within Task 2; `rsiOverboughtState`/`rsiOversoldState` names match between their definition and the `rsiStateSuffix` line in Task 1.
