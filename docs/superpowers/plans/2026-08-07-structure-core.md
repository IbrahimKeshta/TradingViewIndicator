# Structure Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-swing market-structure section with a two-tier swing engine that keeps swing history, classifies every pivot, distinguishes BOS from CHoCH on a real trend state machine, reports an explicit range state, and renders it as tags, rays, break lines and a status panel.

**Architecture:** Two pivot lookbacks (major 20, internal 5) run the same pipeline in parallel over four `array<SwingPoint>` stores. A `TierState` UDT holds each tier's trend and last-event record; because Pine UDT instances are reference types, one `processTier()` function mutates either tier's state in place instead of the pipeline being written twice. Broken swings are flagged, never removed — that retained history is what later blocks read for support/resistance and flip levels. Order blocks and fair value gaps move to a shared `Zone` UDT so an order block can carry which tier produced it.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-07-structure-core-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` at commit `bacc3b5`, 292 lines. This plan modifies that file in place. All line numbers below refer to that revision. **Work on a new branch `feat/structure-core`** — the current branch `feat/touched-level-cap` holds unrelated `gann-angles.pine` work that should be reviewed and merged on its own.

## Global Constraints

- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error. Several functions below therefore end on a throwaway expression such as `array.size(...)` or `st.trend` — this is deliberate, do not "clean it up".
- **Do not write `cond and array.get(arr, i).field` where `i` may be `-1`.** Pine does not guarantee short-circuit evaluation the way C-family languages do, so a guard fused into an `and` can still evaluate the indexing operand and throw an out-of-bounds runtime error. Every array access in this plan is guarded by a **separate enclosing `if`**. Keep it that way.
- **Loop-direction footgun:** `for i = X to Y` runs *descending* when `Y < X` at runtime rather than skipping. `for i = array.size(a) - 1 to 0` on an empty array becomes `for i = -1 to 0` and will index out of bounds — every such loop in this plan sits inside an `if array.size(a) > 0` guard. Prefer `for ... in` where order does not matter.
- **Pine v6 UDT instances and arrays are reference types.** `for p in points` yields the stored object, so `p.broken := true` mutates the array element. `processTier(majorState, ...)` mutates the caller's `TierState`. This is what the design depends on — it is not a copy.
- **Pivot detection must be called unconditionally at global scope.** `ta.pivothigh` / `ta.pivotlow` maintain internal state and must be evaluated on every bar. Assign them to variables at global scope, then consume those variables inside `if` blocks. Never call `ta.*` inside a conditional branch.
- **`structAtr[lookback]` uses an input as a historical offset.** This is valid Pine (`input.int` yields a simple int) and there is precedent at `src/gann-angles.pine:116`. `Major Swing Lookback` is capped at `maxval = 100` and `Internal Swing Lookback` at `maxval = 50` specifically so the deepest historical reference stays inside Pine's default history buffer; `findOppositeCandle` already reaches back 200 bars without a `max_bars_back` declaration. **Do not raise those maxvals and do not add a `max_bars_back` declaration.**
- **Per-bar break flags must be reset at global scope, outside the `barstate.isconfirmed` guard.** `processTier` only runs on confirmed bars, so if `bullBreak`/`bearBreak` were reset inside it they would stay `true` for the whole of the following developing bar and fire duplicate drawings and alerts.
- **The event bar is the bar the break was *detected*, not always the bar price actually crossed the level.** A pivot confirms `lookback` bars late, so a level can be already-broken the moment it is first stored. This is inherent to confirmed pivots and is accepted, not fixed.
- **`markBroken` runs on every confirmed bar, not only on event bars.** Otherwise a level price drifted past — while a more recent unbroken level sat above it — would keep its ray forever.
- Exact input defaults, copied verbatim: `Major Swing Lookback` 20, `Internal Swing Lookback` 5, `Max Swings Kept` 10, `Structure ATR Length` 14, `Equal-Level Tolerance (x ATR)` 0.15, `Range Band (x ATR)` 2.5, `Range Lookback (bars)` 100. Display: `Show Major Tags` true, `Show Break Lines` true, `Show Major Rays` true, `Show Internal Rays` **false**, `Show Internal Break Lines` **false**, `Show Structure Panel` true, `Panel Position` "Top Right", `Include Internal-Tier Order Blocks` **true**.
- **`Include Internal-Tier Order Blocks` defaults to `true` to preserve today's behaviour.** Today's order blocks are produced by a lookback of 5, which is the internal tier. Defaulting it off would silently delete order blocks users currently see.
- **The four `structureBias` consumers migrate to `intState.trend`, NOT `majorState.trend`.** Today's bias comes from a lookback of 5 = the internal tier. Pointing them at the major tier would move every signal to a lookback of 20 as an invisible side effect. Block D changes signal gating deliberately; this plan does not.
- **`inRange` is computed and displayed but wired into nothing.** Do not add it to the signal conditions. That is block D's decision.
- **Nothing is filtered out of the structure record.** Every break is recorded with its `strength`; weak breaks are still breaks. Do not add a displacement threshold to break detection.
- Do not touch: the RSI/MA section (lines 42–64), killzone sessions (lines 223–231), `findOppositeCandle` (lines 184–195), the FVG detection conditions (lines 155–156), or the four existing `alertcondition` calls (lines 289–292).
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Move fair value gaps and order blocks onto a `Zone` UDT

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — the FVG and OB storage arrays, `mitigateBoxes`, both creation blocks, and `nearestBoxDistance`.

**Interfaces:**
- Consumes: nothing new.
- Produces: `type Zone` (fields `box b`, `label lbl`, `string tier`, `string side`); `bullishFvgZones`, `bearishFvgZones`, `bullishObZones`, `bearishObZones` (all `array<Zone>`); `mitigateZones(array<Zone> zones, bool isBullish) => bool`; `nearestZoneDistance(array<Zone> zones) => float`.

**This is a pure refactor with zero behaviour change.** Eight parallel arrays become four `array<Zone>`. The reason is Task 3: order blocks need to carry which tier produced them, and adding a ninth parallel `string[]` kept in sync by hand is exactly how the existing lockstep indexing in `mitigateBoxes` (lines 143–145) breaks silently.

- [ ] **Step 1: Declare `Zone` and replace the FVG arrays**

Find lines 128–131:

```pinescript
var box[] bullishFvgBoxes = array.new<box>()
var box[] bearishFvgBoxes = array.new<box>()
var label[] bullishFvgLabels = array.new<label>()
var label[] bearishFvgLabels = array.new<label>()
```

Replace with:

```pinescript
// One record per drawn zone. `tier` is "MAJOR" or "INTERNAL" for order blocks and ""
// for fair value gaps, which have no tier. Keeping the box and its label in one object
// is what removes the parallel-array indexing this file used to do.
type Zone
    box    b
    label  lbl
    string tier
    string side

var array<Zone> bullishFvgZones = array.new<Zone>()
var array<Zone> bearishFvgZones = array.new<Zone>()
```

- [ ] **Step 2: Replace `mitigateBoxes` with `mitigateZones`**

Find lines 133–149 (the whole `mitigateBoxes` function):

```pinescript
mitigateBoxes(boxArray, labelArray, isBullish) =>
    touchedAny = false
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
                touchedAny := true
            else
                box.set_right(b, bar_index)
    touchedAny
```

Replace with:

```pinescript
mitigateZones(array<Zone> zones, bool isBullish) =>
    touchedAny = false
    if array.size(zones) > 0
        for i = array.size(zones) - 1 to 0
            z = array.get(zones, i)
            top = box.get_top(z.b)
            bottom = box.get_bottom(z.b)
            touched = isBullish ? low <= top : high >= bottom
            if touched
                box.delete(z.b)
                label.delete(z.lbl)
                array.remove(zones, i)
                touchedAny := true
            else
                box.set_right(z.b, bar_index)
    touchedAny
```

- [ ] **Step 3: Update the two FVG mitigation calls**

Find lines 152–153:

```pinescript
bullishFvgTouched = mitigateBoxes(bullishFvgBoxes, bullishFvgLabels, true)
bearishFvgTouched = mitigateBoxes(bearishFvgBoxes, bearishFvgLabels, false)
```

Replace with:

```pinescript
bullishFvgTouched = mitigateZones(bullishFvgZones, true)
bearishFvgTouched = mitigateZones(bearishFvgZones, false)
```

- [ ] **Step 4: Update both FVG creation blocks**

Find lines 158–174 (both `if bullishFvgDetected` and `if bearishFvgDetected` blocks) and replace with:

```pinescript
if bullishFvgDetected
    newBullishFvg = box.new(bar_index[2], low, bar_index, high[2], border_color = color.new(color.teal, 40), bgcolor = color.new(color.teal, 85))
    newBullishFvgLabel = label.new(x = bar_index[2], y = low, text = "FVG", color = color.new(color.teal, 40), style = label.style_label_up, textcolor = color.white, size = size.tiny)
    array.push(bullishFvgZones, Zone.new(newBullishFvg, newBullishFvgLabel, "", "bull"))
    if array.size(bullishFvgZones) > fvgMaxCount
        dropped = array.shift(bullishFvgZones)
        box.delete(dropped.b)
        label.delete(dropped.lbl)

if bearishFvgDetected
    newBearishFvg = box.new(bar_index[2], low[2], bar_index, high, border_color = color.new(color.red, 40), bgcolor = color.new(color.red, 85))
    newBearishFvgLabel = label.new(x = bar_index[2], y = low[2], text = "FVG", color = color.new(color.red, 40), style = label.style_label_up, textcolor = color.white, size = size.tiny)
    array.push(bearishFvgZones, Zone.new(newBearishFvg, newBearishFvgLabel, "", "bear"))
    if array.size(bearishFvgZones) > fvgMaxCount
        dropped = array.shift(bearishFvgZones)
        box.delete(dropped.b)
        label.delete(dropped.lbl)
```

- [ ] **Step 5: Replace the OB arrays**

Find lines 179–182:

```pinescript
var box[] bullishObBoxes = array.new<box>()
var box[] bearishObBoxes = array.new<box>()
var label[] bullishObLabels = array.new<label>()
var label[] bearishObLabels = array.new<label>()
```

Replace with:

```pinescript
var array<Zone> bullishObZones = array.new<Zone>()
var array<Zone> bearishObZones = array.new<Zone>()
```

- [ ] **Step 6: Update the two OB mitigation calls**

Find lines 198–199:

```pinescript
bullishObTouched = mitigateBoxes(bullishObBoxes, bullishObLabels, true)
bearishObTouched = mitigateBoxes(bearishObBoxes, bearishObLabels, false)
```

Replace with:

```pinescript
bullishObTouched = mitigateZones(bullishObZones, true)
bearishObTouched = mitigateZones(bearishObZones, false)
```

- [ ] **Step 7: Update both OB creation blocks**

Find lines 201–221 (both `if barstate.isconfirmed and showOB and (...)` blocks) and replace with:

```pinescript
if barstate.isconfirmed and showOB and (bosBullish or chochBullish)
    obOffset = findOppositeCandle(true)
    if obOffset >= 0
        newBullishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.blue, 40), bgcolor = color.new(color.blue, 85))
        newBullishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = "OB", color = color.new(color.blue, 40), style = label.style_label_up, textcolor = color.white, size = size.tiny)
        array.push(bullishObZones, Zone.new(newBullishOb, newBullishObLabel, "INTERNAL", "bull"))
        if array.size(bullishObZones) > obMaxCount
            dropped = array.shift(bullishObZones)
            box.delete(dropped.b)
            label.delete(dropped.lbl)

if barstate.isconfirmed and showOB and (bosBearish or chochBearish)
    obOffset = findOppositeCandle(false)
    if obOffset >= 0
        newBearishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.purple, 40), bgcolor = color.new(color.purple, 85))
        newBearishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = "OB", color = color.new(color.purple, 40), style = label.style_label_up, textcolor = color.white, size = size.tiny)
        array.push(bearishObZones, Zone.new(newBearishOb, newBearishObLabel, "INTERNAL", "bear"))
        if array.size(bearishObZones) > obMaxCount
            dropped = array.shift(bearishObZones)
            box.delete(dropped.b)
            label.delete(dropped.lbl)
```

`"INTERNAL"` is factually correct at this point: these order blocks come from the existing structure section's lookback of 5, which is the internal tier. Task 3 adds the major-tier case.

- [ ] **Step 8: Replace `nearestBoxDistance` and its four call sites**

Find lines 263–278 (`nearestBoxDistance` plus the four distance assignments) and replace with:

```pinescript
nearestZoneDistance(array<Zone> zones) =>
    minDist = float(na)
    for z in zones
        top = box.get_top(z.b)
        bottom = box.get_bottom(z.b)
        dist = close > top ? close - top : (close < bottom ? bottom - close : 0.0)
        if na(minDist) or dist < minDist
            minDist := dist
    minDist

bullishFvgDist = nearestZoneDistance(bullishFvgZones)
bullishObDist  = nearestZoneDistance(bullishObZones)
bearishFvgDist = nearestZoneDistance(bearishFvgZones)
bearishObDist  = nearestZoneDistance(bearishObZones)
```

The `for ... in` form replaces the old index loop and needs no size guard.

- [ ] **Step 9: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `grep -n "bullishFvgBoxes\|bearishFvgBoxes\|bullishFvgLabels\|bearishFvgLabels\|bullishObBoxes\|bearishObBoxes\|bullishObLabels\|bearishObLabels\|mitigateBoxes\|nearestBoxDistance"` returns **zero** hits. Any survivor is a missed call site.
2. `type Zone` is declared before its first use. State the line number of the declaration and of the first `Zone.new(` call.
3. `mitigateZones` deletes the box **and** the label and removes exactly one array element per mitigation — quote the three lines. The old code's separate `array.remove` on a second array is gone.
4. `mitigateZones` and `nearestZoneDistance` each end on an expression (`touchedAny`, `minDist`), not on an `if` or `for`.
5. The descending loop in `mitigateZones` is still wrapped in `if array.size(zones) > 0`. Without it an empty array runs `for i = -1 to 0`.
6. All four `Zone.new(...)` calls pass arguments in declared field order — `b`, `lbl`, `tier`, `side`. Quote each and check positionally; a `box` landing in the `label` slot is the likely failure.
7. FVG zones carry `tier = ""` and OB zones carry `tier = "INTERNAL"`; sides are `"bull"` / `"bear"` and none are crossed.
8. `fvgMaxCount` and `obMaxCount` caps still evict via `array.shift` and still delete both the box and the label of the dropped zone — a leaked box would survive forever with no reference.
9. **Behaviour is unchanged.** Confirm no detection condition, no colour, no transparency, no box geometry and no label text differs from the original. Run `git diff` and state, hunk by hunk, that each is storage-shape only.
10. `max_boxes_count`, `max_labels_count` and `max_lines_count` on line 2 are untouched — object counts are identical to before.

- [ ] **Step 10: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "refactor: store FVGs and order blocks as Zone records"
```

---

### Task 2: Add the two-tier structure engine

> **Note:** Task 1 changed line counts below line 128 only. Lines 1–127 are unaffected, so the insertion point below is still accurate. Locate edits by matching quoted text, not by trusting line numbers.

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add inputs to the `Market Structure` group, and insert a new `STRUCTURE ENGINE` section between the existing `MARKET STRUCTURE` section (ends line 120) and the `FAIR VALUE GAPS` banner (line 122).

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: inputs `majorLookback`, `internalLookback`, `maxSwings`, `structAtrLength`, `eqTolMult`, `rangeAtrMult`, `rangeLookbackBars`; `type SwingPoint` (`price` float, `bar` int, `class` string, `broken` bool, `brokenBar` int, `liquidity` bool); `type TierState` (`trend`, `lastType`, `lastSide` strings, `lastStrength`, `lastPenetration`, `lastLevel` floats, `lastLevelBar`, `lastBar` ints, `bullBreak`, `bearBreak` bools); arrays `majorHighs`, `majorLows`, `intHighs`, `intLows` (`array<SwingPoint>`); `majorState`, `intState` (`TierState`); `structAtr` (float); `inRange` (bool); functions `pushPivot`, `lastUnbrokenIndex`, `markBroken`, `processTier`, `inRangeNow`.

**Nothing consumes the engine in this task.** The existing structure section still drives everything; Task 3 switches over. Unused functions and unused `var`s are valid Pine — expected, not a defect.

**On the event record's `tier`:** the spec lists `tier` among an event's fields, but `TierState` has no such field and must not gain one. Tier is carried by *which instance you are holding* — `majorState` is the major tier by construction. A stored `tier` string would be a second source of truth that could disagree with the instance holding it. Consumers that need the label derive it at the point of use (Task 4's panel does exactly this).

- [ ] **Step 1: Add the Market Structure inputs**

Find line 18, the only line in the `// ---------------- Market Structure ----------------` block:

```pinescript
pivotLookback = input.int(5, "Swing Pivot Lookback", minval = 2, group = "Market Structure")
```

Leave it in place (Task 3 removes it) and insert immediately **after** it:

```pinescript
majorLookback     = input.int(20, "Major Swing Lookback", minval = 2, maxval = 100, group = "Market Structure", tooltip = "Bars either side a bar must dominate to count as a major swing. Major swings define the headline trend and the range test. Capped at 100 to stay inside Pine's default history buffer.")
internalLookback  = input.int(5, "Internal Swing Lookback", minval = 2, maxval = 50, group = "Market Structure", tooltip = "The fine-grained tier: pullback state, internal order blocks, and entry-level detail. Signals and watch-zone alerts read this tier's trend.")
maxSwings         = input.int(10, "Max Swings Kept (per side, per tier)", minval = 2, maxval = 30, group = "Market Structure", tooltip = "Broken swings are kept, not deleted — only this cap removes them, oldest first.")
structAtrLength   = input.int(14, "Structure ATR Length", minval = 1, group = "Market Structure", tooltip = "Scales the equal-level tolerance, the range band and break strength. Separate from the Watch-Zone ATR on purpose, so tuning proximity cannot reclassify structure.")
eqTolMult         = input.float(0.15, "Equal-Level Tolerance (x ATR)", minval = 0.0, step = 0.05, group = "Market Structure", tooltip = "Two consecutive swings within this distance are equal highs/lows (EQH/EQL) — resting liquidity, not a directional swing. They never change the trend.")
rangeAtrMult      = input.float(2.5, "Range Band (x ATR)", minval = 0.1, step = 0.1, group = "Market Structure", tooltip = "When the last two major highs and last two major lows all fit inside this band, structure is compressing and Range reads YES.")
rangeLookbackBars = input.int(100, "Range Lookback (bars)", minval = 10, group = "Market Structure", tooltip = "Staleness guard for the range test. Without it, four pivots spread over hundreds of bars could sit in a narrow band and read as consolidation.")
```

- [ ] **Step 2: Insert the STRUCTURE ENGINE section**

Find line 120, the last line of the existing structure section:

```pinescript
    label.new(bar_index, high, "CHoCH", color = color.new(color.maroon, 0), style = label.style_label_down, textcolor = color.white, size = size.tiny)
```

Insert after it a blank line, then this complete section:

```pinescript
// ============================================================
// STRUCTURE ENGINE (two-tier swings, BOS/CHoCH, range)
// ============================================================
type SwingPoint
    float  price
    int    bar
    string class      // "HH" | "HL" | "LH" | "LL" | "EQH" | "EQL"; na for the first point on a side
    bool   broken
    int    brokenBar
    bool   liquidity  // true when class is EQH or EQL — resting stops, a target for later blocks

type TierState
    string trend           // "up" | "down" | na until the first break
    string lastType        // "BOS" | "CHoCH"
    string lastSide        // "bull" (a high broke) | "bear" (a low broke)
    float  lastStrength    // breaking bar's body / ATR — displacement, for the signal engine to filter on
    float  lastPenetration // |close - level| / ATR
    float  lastLevel       // price of the level that broke
    int    lastLevelBar    // bar the broken level formed on
    int    lastBar         // bar the event fired on
    bool   bullBreak       // reset every bar; true only on the bar a high broke
    bool   bearBreak

var array<SwingPoint> majorHighs = array.new<SwingPoint>()
var array<SwingPoint> majorLows  = array.new<SwingPoint>()
var array<SwingPoint> intHighs   = array.new<SwingPoint>()
var array<SwingPoint> intLows    = array.new<SwingPoint>()

var TierState majorState = TierState.new(na, na, na, na, na, na, na, na, false, false)
var TierState intState   = TierState.new(na, na, na, na, na, na, na, na, false, false)

structAtr = ta.atr(structAtrLength)

// Classify against the previous point on the same side, then store. Only the cap removes
// points — a broken swing is still a price level and later blocks need it.
pushPivot(array<SwingPoint> points, float price, int bar, float atrAtPivot, bool isHigh) =>
    cls = string(na)
    if array.size(points) > 0
        prev = array.get(points, array.size(points) - 1)
        diff = price - prev.price
        if math.abs(diff) <= eqTolMult * atrAtPivot
            cls := isHigh ? "EQH" : "EQL"
        else if diff > 0
            cls := isHigh ? "HH" : "HL"
        else
            cls := isHigh ? "LH" : "LL"
    isLiq = not na(cls) and (cls == "EQH" or cls == "EQL")
    array.push(points, SwingPoint.new(price, bar, cls, false, na, isLiq))
    if array.size(points) > maxSwings
        array.shift(points)
    array.size(points)

// Index of the most recent point price has not yet closed through, or -1.
lastUnbrokenIndex(array<SwingPoint> points) =>
    idx = -1
    if array.size(points) > 0
        for i = array.size(points) - 1 to 0
            if not array.get(points, i).broken
                idx := i
                break
    idx

// Marks every unbroken point the close has passed. Runs on every confirmed bar, not just
// event bars, so a level price drifted past never keeps its ray.
markBroken(array<SwingPoint> points, bool isHigh) =>
    n = 0
    for p in points
        if not p.broken and (isHigh ? close > p.price : close < p.price)
            p.broken    := true
            p.brokenBar := bar_index
            n += 1
    n

// The trend state machine. A break in the trend's direction is a BOS; a break against it
// is a CHoCH and flips the trend. Both sides can never fire on one bar: that would need an
// unbroken high below an unbroken low, which price could not have produced.
// Nothing is filtered — strength is recorded so the signal engine can filter later.
processTier(TierState st, array<SwingPoint> highs, array<SwingPoint> lows) =>
    hIdx = lastUnbrokenIndex(highs)
    lIdx = lastUnbrokenIndex(lows)
    bullBroke = false
    bearBroke = false
    lvlPrice  = float(na)
    lvlBar    = int(na)
    if hIdx >= 0
        hp = array.get(highs, hIdx)
        if close > hp.price
            bullBroke := true
            lvlPrice  := hp.price
            lvlBar    := hp.bar
    if not bullBroke and lIdx >= 0
        lp = array.get(lows, lIdx)
        if close < lp.price
            bearBroke := true
            lvlPrice  := lp.price
            lvlBar    := lp.bar
    markBroken(highs, true)
    markBroken(lows, false)
    if bullBroke or bearBroke
        newTrend = bullBroke ? "up" : "down"
        st.lastType        := na(st.trend) or st.trend == newTrend ? "BOS" : "CHoCH"
        st.trend           := newTrend
        st.lastSide        := bullBroke ? "bull" : "bear"
        st.lastStrength    := structAtr > 0 ? math.abs(close - open) / structAtr : 0.0
        st.lastPenetration := structAtr > 0 ? math.abs(close - lvlPrice) / structAtr : 0.0
        st.lastLevel       := lvlPrice
        st.lastLevelBar    := lvlBar
        st.lastBar         := bar_index
        st.bullBreak       := bullBroke
        st.bearBreak       := bearBroke
    st.trend

// Compression test over the last two major highs and last two major lows. The bar-age
// condition is a staleness guard — four pivots strewn across hundreds of bars can sit in a
// narrow band without the market having consolidated at all.
inRangeNow(array<SwingPoint> highs, array<SwingPoint> lows) =>
    result = false
    if array.size(highs) >= 2 and array.size(lows) >= 2
        h1 = array.get(highs, array.size(highs) - 1)
        h2 = array.get(highs, array.size(highs) - 2)
        l1 = array.get(lows, array.size(lows) - 1)
        l2 = array.get(lows, array.size(lows) - 2)
        top    = math.max(h1.price, h2.price)
        bottom = math.min(l1.price, l2.price)
        oldest = math.min(math.min(h1.bar, h2.bar), math.min(l1.bar, l2.bar))
        result := (top - bottom) <= rangeAtrMult * structAtr and (bar_index - oldest) <= rangeLookbackBars
    result

// ta.* must be evaluated every bar, so these are assigned at global scope and consumed below.
majorHighRaw = ta.pivothigh(high, majorLookback, majorLookback)
majorLowRaw  = ta.pivotlow(low, majorLookback, majorLookback)
intHighRaw   = ta.pivothigh(high, internalLookback, internalLookback)
intLowRaw    = ta.pivotlow(low, internalLookback, internalLookback)

// Reset outside the confirmed guard — inside it, the flags would stay true through the
// whole of the next developing bar and fire duplicate drawings and alerts.
majorState.bullBreak := false
majorState.bearBreak := false
intState.bullBreak   := false
intState.bearBreak   := false

if barstate.isconfirmed
    if not na(majorHighRaw)
        pushPivot(majorHighs, majorHighRaw, bar_index - majorLookback, structAtr[majorLookback], true)
    if not na(majorLowRaw)
        pushPivot(majorLows, majorLowRaw, bar_index - majorLookback, structAtr[majorLookback], false)
    if not na(intHighRaw)
        pushPivot(intHighs, intHighRaw, bar_index - internalLookback, structAtr[internalLookback], true)
    if not na(intLowRaw)
        pushPivot(intLows, intLowRaw, bar_index - internalLookback, structAtr[internalLookback], false)
    processTier(majorState, majorHighs, majorLows)
    processTier(intState, intHighs, intLows)

inRange = inRangeNow(majorHighs, majorLows)

// Data Window readouts. These are the verification surface — engine state as numbers,
// bar by bar, instead of eyeballing labels.
majorTrendCode = majorState.trend == "up" ? 1 : majorState.trend == "down" ? -1 : 0
intTrendCode   = intState.trend == "up" ? 1 : intState.trend == "down" ? -1 : 0
lastEventCode  = majorState.lastType == "BOS" ? 1 : majorState.lastType == "CHoCH" ? 2 : 0

plot(majorTrendCode, "DBG Major Trend (1/-1/0)", display = display.data_window)
plot(intTrendCode, "DBG Internal Trend (1/-1/0)", display = display.data_window)
plot(inRange ? 1 : 0, "DBG In Range (1/0)", display = display.data_window)
plot(lastEventCode, "DBG Last Major Event (1=BOS 2=CHoCH)", display = display.data_window)
plot(array.size(majorHighs), "DBG Major Highs Kept", display = display.data_window)
plot(array.size(majorLows), "DBG Major Lows Kept", display = display.data_window)
plot(majorState.lastStrength, "DBG Last Major Strength (xATR)", display = display.data_window)
```

- [ ] **Step 3: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `SwingPoint` and `TierState` are declared before first use, and both `TierState.new(...)` calls pass **ten** arguments in declared field order: 3 strings, 3 floats, 2 ints, 2 bools. Count them and quote the call.
2. `SwingPoint.new(price, bar, cls, false, na, isLiq)` matches the declared field order `price, bar, class, broken, brokenBar, liquidity` — six arguments.
3. Every function ends on an expression: `pushPivot` → `array.size(points)`, `lastUnbrokenIndex` → `idx`, `markBroken` → `n`, `processTier` → `st.trend`, `inRangeNow` → `result`. Quote each closing line.
4. **No array access sits inside an `and`.** Confirm `processTier` guards `array.get(highs, hIdx)` with a separate enclosing `if hIdx >= 0`, and the low side likewise. Quote both. A fused `hIdx >= 0 and array.get(...)` can throw out-of-bounds.
5. The descending loop in `lastUnbrokenIndex` is inside `if array.size(points) > 0`.
6. `inRangeNow` accesses indices `size-1` and `size-2` only under `array.size(...) >= 2` for **both** arrays.
7. Trace the BOS/CHoCH expression `na(st.trend) or st.trend == newTrend ? "BOS" : "CHoCH"` against all five rows of the spec's state-machine table and state the result for each. It must yield BOS for trend-direction breaks and for the first-ever break, CHoCH otherwise.
8. `st.lastType` is assigned **before** `st.trend` is overwritten. If the order were reversed every event would classify as BOS. Quote the two adjacent lines.
9. The four `ta.pivot*` calls are at global scope, not inside any `if`.
10. The four `bullBreak`/`bearBreak` resets are at global scope, **outside** `if barstate.isconfirmed`. Quote the surrounding lines to show the indentation level.
11. `markBroken` is called unconditionally in `processTier`, before the `if bullBroke or bearBroke` block — not inside it.
12. `pushPivot` stores `bar_index - lookback` as the pivot's bar, using the same lookback that produced it: `majorLookback` for major pivots, `internalLookback` for internal. Check all four calls; a crossed lookback puts tags on the wrong bars.
13. `structAtr[majorLookback]` / `structAtr[internalLookback]` sample ATR at the pivot's own bar. Confirm neither uses bare `structAtr`, which would classify a historical pivot using volatility that arrived after it.
14. `eqTolMult`, `maxSwings`, `rangeAtrMult`, `rangeLookbackBars` and `structAtr` are read as globals inside the functions and were not added as parameters.
15. The engine section sits **after** the existing structure section and **before** the `FAIR VALUE GAPS` banner. State the three line numbers.
16. Nothing outside the insertion point and the new inputs changed. `git diff --stat` shows only `src/ict-rsi-ma-indicator.pine`, insertions only, zero deletions.

- [ ] **Step 4: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: add two-tier swing engine with BOS/CHoCH state machine and range detection"
```

---

### Task 3: Retire the old structure section and migrate every consumer

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — delete the `Swing Pivot Lookback` input and the whole `MARKET STRUCTURE` section; add `Include Internal-Tier Order Blocks`; add `pruneTier`; rewrite both OB creation blocks; repoint the signal and watch-zone conditions.

**Interfaces:**
- Consumes: `Zone`, `bullishObZones`, `bearishObZones` (Task 1); `majorState`, `intState` and their `bullBreak`/`bearBreak` flags (Task 2).
- Produces: input `showInternalOb` (bool); `pruneTier(array<Zone> zones, string tier, int maxCount) => int`.

**This is the switchover.** After it, `structureBias`, `bosBullish`, `bosBearish`, `chochBullish`, `chochBearish`, `lastSwingHigh`, `lastSwingLow` and `pivotLookback` no longer exist. Everything reads the new engine.

- [ ] **Step 1: Delete the old input**

Delete line 18 entirely:

```pinescript
pivotLookback = input.int(5, "Swing Pivot Lookback", minval = 2, group = "Market Structure")
```

Its only other references are inside the section deleted in Step 2.

- [ ] **Step 2: Add the internal order-block toggle**

Find the last line of the `// ---------------- Order Blocks ----------------` block:

```pinescript
obSearchBars = input.int(50, "Order Block Backward Search (bars)", minval = 5, maxval = 200, group = "Order Blocks")
```

Insert immediately after it:

```pinescript
showInternalOb = input.bool(true, "Include Internal-Tier Order Blocks", group = "Order Blocks", tooltip = "Internal-tier breaks are what produced every order block before the two-tier structure engine existed, so this defaults on. Turn it off to keep only order blocks born from major structural breaks.")
```

- [ ] **Step 3: Delete the whole old MARKET STRUCTURE section**

Delete everything from the banner:

```pinescript
// ============================================================
// MARKET STRUCTURE (swings, BOS, CHoCH)
// ============================================================
```

down to and including the last line of that section:

```pinescript
    label.new(bar_index, high, "CHoCH", color = color.new(color.maroon, 0), style = label.style_label_down, textcolor = color.white, size = size.tiny)
```

That is the original lines 66–120 — the comment block, `swingHigh`/`swingLow`, the four `var` swing trackers, `structureBias`, the four break booleans, the two `if barstate.isconfirmed` blocks, and the four label-drawing `if` blocks. The `STRUCTURE ENGINE` banner added in Task 2 becomes the next thing after the RSI/MA section.

- [ ] **Step 4: Add `pruneTier`**

Find the closing line of `mitigateZones`:

```pinescript
    touchedAny
```

Insert after it a blank line, then:

```pinescript
// Evicts the oldest zone of one tier when that tier exceeds its cap. Tier caps are separate
// because internal breaks are far more frequent than major ones — under a shared cap they
// would evict every major order block.
pruneTier(array<Zone> zones, string tier, int maxCount) =>
    count = 0
    for z in zones
        if z.tier == tier
            count += 1
    if count > maxCount
        for i = 0 to array.size(zones) - 1
            if array.get(zones, i).tier == tier
                dropped = array.remove(zones, i)
                box.delete(dropped.b)
                label.delete(dropped.lbl)
                break
    count
```

The ascending loop is only reachable when `count > maxCount >= 1`, so the array holds at least one element and `array.size(zones) - 1` is never negative.

- [ ] **Step 5: Rewrite both order-block creation blocks**

Replace both `if barstate.isconfirmed and showOB and (...)` blocks written in Task 1 Step 7 with:

```pinescript
if barstate.isconfirmed and showOB and (majorState.bullBreak or (showInternalOb and intState.bullBreak))
    obTier = majorState.bullBreak ? "MAJOR" : "INTERNAL"
    obTrans = obTier == "MAJOR" ? 40 : 70
    obFill = obTier == "MAJOR" ? 85 : 92
    obOffset = findOppositeCandle(true)
    if obOffset >= 0
        newBullishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.blue, obTrans), bgcolor = color.new(color.blue, obFill))
        newBullishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = obTier == "MAJOR" ? "OB" : "ob", color = color.new(color.blue, obTrans), style = label.style_label_up, textcolor = color.white, size = size.tiny)
        array.push(bullishObZones, Zone.new(newBullishOb, newBullishObLabel, obTier, "bull"))
        pruneTier(bullishObZones, obTier, obMaxCount)

if barstate.isconfirmed and showOB and (majorState.bearBreak or (showInternalOb and intState.bearBreak))
    obTier = majorState.bearBreak ? "MAJOR" : "INTERNAL"
    obTrans = obTier == "MAJOR" ? 40 : 70
    obFill = obTier == "MAJOR" ? 85 : 92
    obOffset = findOppositeCandle(false)
    if obOffset >= 0
        newBearishOb = box.new(bar_index[obOffset], high[obOffset], bar_index, low[obOffset], border_color = color.new(color.purple, obTrans), bgcolor = color.new(color.purple, obFill))
        newBearishObLabel = label.new(x = bar_index[obOffset], y = high[obOffset], text = obTier == "MAJOR" ? "OB" : "ob", color = color.new(color.purple, obTrans), style = label.style_label_up, textcolor = color.white, size = size.tiny)
        array.push(bearishObZones, Zone.new(newBearishOb, newBearishObLabel, obTier, "bear"))
        pruneTier(bearishObZones, obTier, obMaxCount)
```

When both tiers break on the same bar, `obTier` resolves to `"MAJOR"` and one order block is created, not two. That is intentional — the same price action produced both breaks.

- [ ] **Step 6: Repoint the signal-fired resets**

Find these four lines in the `CONFLUENCE SIGNALS` section:

```pinescript
if chochBullish or bosBullish
    bullishSignalFired := false
if chochBearish or bosBearish
    bearishSignalFired := false
```

Replace with:

```pinescript
if intState.bullBreak
    bullishSignalFired := false
if intState.bearBreak
    bearishSignalFired := false
```

- [ ] **Step 7: Repoint the two signal conditions**

Replace these two lines:

```pinescript
bullishSignal = structureBias == "bullish" and inBullishZone and killzoneActive and rsiBullishConfirm and maBullishConfirm and not bullishSignalFired and barstate.isconfirmed
bearishSignal = structureBias == "bearish" and inBearishZone and killzoneActive and rsiBearishConfirm and maBearishConfirm and not bearishSignalFired and barstate.isconfirmed
```

with:

```pinescript
bullishSignal = intState.trend == "up" and inBullishZone and killzoneActive and rsiBullishConfirm and maBullishConfirm and not bullishSignalFired and barstate.isconfirmed
bearishSignal = intState.trend == "down" and inBearishZone and killzoneActive and rsiBearishConfirm and maBearishConfirm and not bearishSignalFired and barstate.isconfirmed
```

**`intState`, not `majorState`.** The old `structureBias` came from a lookback of 5 — the internal tier. Using `majorState` here would silently move every signal to a lookback of 20.

- [ ] **Step 8: Repoint the two watch-zone conditions**

Replace these two lines:

```pinescript
bullishWatchZone = structureBias == "bullish" and killzoneActive and not inBullishZone and not na(closestBullishDist) and closestBullishDist <= atrValue * watchZoneAtrMult
bearishWatchZone = structureBias == "bearish" and killzoneActive and not inBearishZone and not na(closestBearishDist) and closestBearishDist <= atrValue * watchZoneAtrMult
```

with:

```pinescript
bullishWatchZone = intState.trend == "up" and killzoneActive and not inBullishZone and not na(closestBullishDist) and closestBullishDist <= atrValue * watchZoneAtrMult
bearishWatchZone = intState.trend == "down" and killzoneActive and not inBearishZone and not na(closestBearishDist) and closestBearishDist <= atrValue * watchZoneAtrMult
```

- [ ] **Step 9: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `grep -n "structureBias\|bosBullish\|bosBearish\|chochBullish\|chochBearish\|lastSwingHigh\|lastSwingLow\|lastSwingHighBarIndex\|lastSwingLowBarIndex\|pivotLookback\|swingHigh\|swingLow"` returns **zero** hits. Any survivor is a dangling reference and a compile error.
2. All four migrated sites read `intState.trend`, none read `majorState.trend`. Quote all four. Getting this wrong changes when every signal fires while looking like a no-op.
3. The mapping is right way round: `"bullish" → "up"` and `"bearish" → "down"` at all four sites. A crossed pair inverts the indicator.
4. The signal-fired resets read `intState.bullBreak` / `intState.bearBreak` — same tier as the conditions they guard. Reading the major tier here would leave a signal latched until a major break.
5. `pruneTier` ends on the expression `count`.
6. `pruneTier`'s ascending loop cannot run on an empty array — state which condition guarantees `array.size(zones) >= 1` at that point.
7. Both OB blocks compute `obTier` from the **major** flag first, so a simultaneous two-tier break yields `"MAJOR"` and exactly one box.
8. `showInternalOb` gates only the internal half of each condition — with it off, major-tier order blocks still create normally. Quote both conditions.
9. Both OB blocks call `pruneTier(..., obTier, obMaxCount)` with the tier they just pushed, not a hardcoded string.
10. The FVG creation blocks still use `array.shift` with `fvgMaxCount` and were **not** switched to `pruneTier` — FVGs have no tier.
11. `mitigateZones` calls, `findOppositeCandle`, `fvgMaxCount`, `obMaxCount`, `obSearchBars`, the killzone section and the four original `alertcondition`s are unchanged.
12. The file now has exactly one structure section. Confirm the `STRUCTURE ENGINE` banner is preceded by the RSI/MA section and no `MARKET STRUCTURE` banner remains.

- [ ] **Step 10: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: retire single-swing structure and migrate consumers to the tier engine"
```

---

### Task 4: Render structure — tags, rays, break lines, panel, alerts

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — line 2 header; add a `Structure Display` input group; add a `STRUCTURE RENDERING` section before the `ALERTS` banner; add two `alertcondition`s.

**Interfaces:**
- Consumes: `majorHighs`, `majorLows`, `intHighs`, `intLows`, `majorState`, `intState`, `inRange` (Task 2).
- Produces: no interface for later blocks — this task is presentation only.

- [ ] **Step 1: Raise the line budget**

Replace line 2:

```pinescript
indicator("ICT + RSI/MA Confluence", shorttitle = "ICT-RSI-MA", overlay = true, max_boxes_count = 200, max_labels_count = 500, max_lines_count = 200)
```

with:

```pinescript
indicator("ICT + RSI/MA Confluence", shorttitle = "ICT-RSI-MA", overlay = true, max_boxes_count = 200, max_labels_count = 500, max_lines_count = 500)
```

Break-event lines persist over a chart's history and 200 is reachable. Leave `max_boxes_count` and `max_labels_count` alone.

- [ ] **Step 2: Add the Structure Display inputs**

Find the last line of the `// ---------------- Alerts / Display ----------------` block:

```pinescript
watchZoneAtrMult   = input.float(1.0, "Watch-Zone Proximity (x ATR)", minval = 0.1, step = 0.1, group = "Alerts / Display")
```

Insert after it a blank line, then:

```pinescript
// ---------------- Structure Display ----------------
showMajorTags      = input.bool(true, "Show Major Tags", group = "Structure Display", tooltip = "HH / HL / LH / LL / EQH / EQL on each retained major swing.")
showMajorRays      = input.bool(true, "Show Major Rays", group = "Structure Display", tooltip = "Extends every unbroken major swing to the right as live support or resistance. Broken levels stop drawing.")
showBreakLines     = input.bool(true, "Show Break Lines", group = "Structure Display", tooltip = "Marks each major BOS and CHoCH where it happened. These stay on the chart as history rather than being redrawn.")
showInternalRays   = input.bool(false, "Show Internal Rays", group = "Structure Display", tooltip = "Entry-level detail. Off by default because on a fast timeframe these are near-continuous.")
showInternalBreaks = input.bool(false, "Show Internal Break Lines", group = "Structure Display")
showStructurePanel = input.bool(true, "Show Structure Panel", group = "Structure Display")
panelPosInput      = input.string("Top Right", "Panel Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Structure Display")
majorTagColor      = input.color(color.orange, "Major Tag", group = "Structure Display")
liquidityTagColor  = input.color(color.yellow, "Liquidity Tag (EQH/EQL)", group = "Structure Display")
bosColor           = input.color(color.lime, "BOS", group = "Structure Display")
chochColor         = input.color(color.fuchsia, "CHoCH", group = "Structure Display")
rayColor           = input.color(color.gray, "Rays", group = "Structure Display")
```

- [ ] **Step 3: Insert the STRUCTURE RENDERING section**

Find the `ALERTS` banner near the end of the file:

```pinescript
// ============================================================
// ALERTS
// ============================================================
```

Insert **before** it this complete section, followed by a blank line:

```pinescript
// ============================================================
// STRUCTURE RENDERING
// ============================================================
// Events persist, state redraws. A BOS happened at a bar and is worth keeping when you
// scroll back; a ray is a claim about the present and must never be stale.
var line[]  structLines  = array.new<line>()
var label[] structLabels = array.new<label>()

drawSwingTags(array<SwingPoint> points, bool isHigh) =>
    for p in points
        if not na(p.class)
            tagCol = p.liquidity ? liquidityTagColor : majorTagColor
            array.push(structLabels, label.new(p.bar, p.price, p.class, style = isHigh ? label.style_label_down : label.style_label_up, color = tagCol, textcolor = color.white, size = size.tiny))
    array.size(structLabels)

drawSwingRays(array<SwingPoint> points, bool dotted) =>
    for p in points
        if not p.broken
            array.push(structLines, line.new(p.bar, p.price, bar_index, p.price, extend = extend.right, color = rayColor, style = dotted ? line.style_dotted : line.style_solid, width = 1))
    array.size(structLines)

// Persistent — deliberately not tracked in structLines/structLabels, so the redraw below
// never deletes them.
drawBreakEvent(TierState st, bool enabled, int lineWidth) =>
    if enabled and (st.bullBreak or st.bearBreak)
        evtColor = st.lastType == "CHoCH" ? chochColor : bosColor
        line.new(st.lastLevelBar, st.lastLevel, bar_index, st.lastLevel, color = evtColor, style = line.style_dotted, width = lineWidth)
        label.new(bar_index, st.lastLevel, st.lastType, style = st.lastSide == "bull" ? label.style_label_up : label.style_label_down, color = evtColor, textcolor = color.white, size = size.tiny)
    st.lastBar

drawBreakEvent(majorState, showBreakLines, 2)
drawBreakEvent(intState, showInternalBreaks, 1)

if barstate.islast
    for ln in structLines
        line.delete(ln)
    array.clear(structLines)
    for lb in structLabels
        label.delete(lb)
    array.clear(structLabels)
    if showMajorTags
        drawSwingTags(majorHighs, true)
        drawSwingTags(majorLows, false)
    if showMajorRays
        drawSwingRays(majorHighs, false)
        drawSwingRays(majorLows, false)
    if showInternalRays
        drawSwingRays(intHighs, true)
        drawSwingRays(intLows, true)

var table structPanel = na

if barstate.islast
    table.delete(structPanel)
    if showStructurePanel
        panelPos = switch panelPosInput
            "Top Right"    => position.top_right
            "Top Left"     => position.top_left
            "Bottom Right" => position.bottom_right
            => position.bottom_left
        useInt       = not na(intState.lastBar) and (na(majorState.lastBar) or intState.lastBar > majorState.lastBar)
        evtTier      = useInt ? "INTERNAL" : "MAJOR"
        evtType      = useInt ? intState.lastType : majorState.lastType
        evtStrength  = useInt ? intState.lastStrength : majorState.lastStrength
        evtText      = na(evtType) ? "—" : evtType + " · " + evtTier + " · " + str.tostring(evtStrength, "#.0") + "x"
        trendText    = na(majorState.trend) ? "—" : str.upper(majorState.trend)
        trendCol     = majorState.trend == "up" ? color.lime : majorState.trend == "down" ? color.red : color.gray
        internalText = na(majorState.trend) or na(intState.trend) ? "—" : intState.trend == majorState.trend ? "aligned" : "pullback"
        structPanel := table.new(panelPos, 2, 5, bgcolor = color.new(color.black, 80), border_width = 1)
        table.cell(structPanel, 0, 0, "STRUCTURE", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(structPanel, 1, 0, "", bgcolor = color.new(color.gray, 50))
        table.cell(structPanel, 0, 1, "Major trend", text_color = color.silver)
        table.cell(structPanel, 1, 1, trendText, text_color = trendCol)
        table.cell(structPanel, 0, 2, "Range", text_color = color.silver)
        table.cell(structPanel, 1, 2, inRange ? "YES" : "no", text_color = inRange ? color.orange : color.gray)
        table.cell(structPanel, 0, 3, "Last event", text_color = color.silver)
        table.cell(structPanel, 1, 3, evtText, text_color = color.white)
        table.cell(structPanel, 0, 4, "Internal", text_color = color.silver)
        table.cell(structPanel, 1, 4, internalText, text_color = color.aqua)
```

- [ ] **Step 4: Add the two structure alerts**

Find the last existing `alertcondition` call:

```pinescript
alertcondition(bearishWatchZone, title = "Bearish Watch-Zone", message = "Watch: price approaching an unmitigated bearish FVG/OB during a killzone on {{ticker}} {{interval}}.")
```

Insert after it a blank line, then:

```pinescript
majorEventFired = majorState.bullBreak or majorState.bearBreak
alertcondition(majorEventFired and majorState.lastType == "CHoCH", title = "Major CHoCH (trend reversal)", message = "Major CHoCH on {{ticker}} {{interval}}: structure trend reversed.")
alertcondition(majorEventFired and majorState.lastType == "BOS", title = "Major BOS (trend continuation)", message = "Major BOS on {{ticker}} {{interval}}: structure trend continued.")
```

- [ ] **Step 5: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `drawSwingTags`, `drawSwingRays` and `drawBreakEvent` each end on an expression (`array.size(structLabels)`, `array.size(structLines)`, `st.lastBar`).
2. `drawBreakEvent`'s two calls are at global scope and run on **every** bar, not inside the `barstate.islast` block. Events must be drawn on the bar they fire.
3. The objects `drawBreakEvent` creates are **not** pushed into `structLines`/`structLabels`. If they were, the next redraw would delete all chart history. Confirm neither `array.push` appears in that function.
4. The redraw block deletes and clears both arrays **before** drawing anything. Quote the order.
5. `drawSwingRays` draws only points where `not p.broken`; `drawSwingTags` skips points where `na(p.class)` — the first pivot on each side has no predecessor and no class.
6. Tags for highs use `label.style_label_down` and for lows `label.style_label_up`, so a tag never covers the candle it belongs to. Check both call pairs pass `isHigh` correctly: `majorHighs` with `true`, `majorLows` with `false`.
7. Internal rays are drawn dotted (`dotted = true`) and major rays solid (`false`).
8. `table.delete(structPanel)` sits **outside** `if showStructurePanel` but inside `if barstate.islast`, so turning the panel off actually removes it rather than freezing the last drawn copy.
9. The panel's `useInt` test handles all four na-combinations of `intState.lastBar` and `majorState.lastBar` without indexing anything. Trace each case and state the resulting `evtTier`.
10. `evtText`, `trendText` and `internalText` each yield `"—"` rather than the string `"na"` when state is missing. Trace all three.
11. `table.new(panelPos, 2, 5, ...)` declares 2 columns and 5 rows, and the highest indices written are column 1, row 4. Count the `table.cell` calls — there must be 10.
12. Line 2 now reads `max_lines_count = 500` and `max_boxes_count` / `max_labels_count` are unchanged.
13. The `STRUCTURE RENDERING` section sits after the watch-zone section and before `ALERTS`. State the line numbers.
14. The two new `alertcondition`s are at global scope, not inside any `if`, and the four original ones are unmodified.

- [ ] **Step 6: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-07-structure-core-design.md` alongside the finished file and confirm, reporting each result:

1. **Data model** — `SwingPoint` has all six spec fields with the spec's types; broken points are marked, never removed. Grep for `array.remove` and `array.shift` on the four swing arrays and confirm the only removal is the `maxSwings` cap in `pushPivot`.
2. **Classification** — EQH/EQL use `eqTolMult × ATR at the pivot's own bar`; EQH/EQL set `liquidity` and never change trend. Confirm `pushPivot` contains no assignment to any `TierState`.
3. **Break detection** — close-based, `barstate.isconfirmed` only, fires against the most recent unbroken point, older crossed points marked without firing extra events.
4. **Trend state machine** — matches all five rows of the spec table.
5. **Range** — both conditions present (band **and** staleness), computed from major pivots only, and `inRange` appears in no signal condition. Grep `inRange` and list every use: it must appear only in its own assignment, the debug plot and the panel.
6. **Rendering** — the spec's lifetime table matches the implementation row for row, including the two internal toggles defaulting to `false`.
7. **Boundary with block B** — no ray is drawn for a broken swing. Quote the guard.
8. **Migration** — all four former `structureBias` sites read `intState.trend`; `majorState.trend` is read only by the panel, the debug plot and the alerts.
9. **Inputs** — every input in the spec's two tables exists with the spec's exact default. List them side by side.
10. Run `git diff bacc3b5 -- src/ict-rsi-ma-indicator.pine --stat` and confirm the change is confined to that one file.

- [ ] **Step 7: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: draw structure tags, rays, break events and the status panel"
```

---

## Deferred human verification (TradingView)

Not executable in this environment — there is no Pine compiler here. Hand these to the user after Task 4. The `DBG` plots are in the Data Window (right-hand panel); most checks below are read from there rather than eyeballed.

- Paste the script into the Pine Editor and confirm it compiles with no errors and no warnings.
- On a trending chart, confirm major tags read as a coherent HH/HL (or LH/LL) sequence and that no tag sits on a bar that is not a pivot.
- Step through with bar replay and confirm a tag never appears earlier than `Major Swing Lookback` bars after its pivot bar. This is the no-repaint check.
- Watch `DBG Major Trend` across a CHoCH and a BOS: it must change **only** on CHoCH, while BOS leaves it unchanged and still draws its line.
- Find a near-equal double top, confirm it tags `EQH`, that `DBG Major Trend` does not change across it, and that the tag uses the liquidity colour.
- Confirm `DBG Major Highs Kept` / `DBG Major Lows Kept` never fall on a break — only when the 10-swing cap shifts one off.
- Confirm a broken swing's ray disappears while its tag remains.
- On a known consolidation confirm `DBG In Range` reads 1; on a clean trend leg, 0. Then scroll to a point where price revisits a long-dead band and confirm the staleness guard keeps it at 0.
- Confirm the panel's `Internal` row reads `pullback` when `DBG Internal Trend` and `DBG Major Trend` disagree, `aligned` when they match.
- Toggle each of the six Structure Display switches off in turn and confirm only its own elements vanish — in particular that turning the panel off removes it rather than leaving a stale copy.
- Turn `Include Internal-Tier Order Blocks` off and confirm faint lowercase `ob` boxes stop appearing while bold `OB` boxes continue.
- With `Internal Swing Lookback` at 5, compare against the pre-change script on the same chart and settings: signals and watch-zone alerts should fire in substantially the same places. Small differences are expected — the old code discarded the opposing swing on every break — but a signal appearing or vanishing on a strongly trending leg is a defect worth reporting.
- Load a chart with several thousand bars and confirm no "too many lines/labels/boxes" error and no visible loss of recent structure.
- Leave it running on a live fast timeframe for several bars and confirm break lines and alerts fire once per event, not repeatedly through the following bar.
