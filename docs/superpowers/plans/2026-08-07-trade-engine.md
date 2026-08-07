# Trade Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the indicator's signal marker into a trade — an entry zone, a stop, three structural targets, a stop that trails behind structure, and a recorded result in R.

**Architecture:** A qualification gate splits conditions into four hard requirements and a proportional score over *enabled* points only. When it passes, one `Trade` object opens, holding its levels and its own state; while it is open further setups are ignored. Targets come from block A's swing arrays by repeated-minimum selection rather than sorting, because Pine cannot carry an index through `array.sort`. Exits are checked stop-first and are gap-aware.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-07-trade-engine-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` at commit `94bfa0b` on branch `feat/trade-engine`, 538 lines. This plan modifies that file in place. All line numbers refer to that revision.

## Global Constraints

- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error.
- **`class` is a reserved word in Pine v6** and cannot name a variable or UDT field (error `CE10150`) — this was hit for real on block A's first paste. Do not introduce identifiers that another language would reserve.
- **Do not write `cond and array.get(arr, i).field` where `i` may be `-1`.** Pine does not guarantee short-circuit evaluation; guard every array access with a separate enclosing `if`.
- **Loop-direction footgun:** `for i = X to Y` runs *descending* when `Y < X` rather than skipping. Guard descending loops with `if array.size(a) > 0`; prefer `for ... in` where order does not matter.
- **Pine v6 UDT instances and arrays are reference types.** Passing a UDT to a function lets that function mutate the caller's object — this plan relies on it in Task 1 and Task 4.
- **Pine supports tuple returns** (`[a, b] = f()`), used in Task 3. It does **not** support conditionally selecting between two arrays with a ternary in a way this plan should rely on — Task 3 uses an accumulator helper called twice instead.
- **Every R figure uses `initialStop`, never the trailed `stop`.** `1R = math.abs(entry − initialStop)`. Using the moving stop would shrink the denominator as a trade progressed and overstate every result.
- **The score is computed over enabled points only.** `minScore` is checked against the count of enabled points, and both numbers are displayed. A disabled point must never sit in the denominator.
- **Killzone safety net:** if neither `showLondonKZ` nor `showNewYorkKZ` is enabled, the killzone point excludes itself from the denominator regardless of its own toggle.
- **Exit checks run stop-first and short-circuit.** A step that closes the trade ends the sequence for that bar. When one bar's range spans both the stop and a target, the trade is `Stopped` — the unfavourable assumption is the honest one.
- **Close prices:** `Stopped` → `math.min(stop, open)` for a long, `math.max(stop, open)` for a short. `Target` → `tp3` exactly, even if the bar gapped past it. `Invalidated` → the bar's `close`.
- **One trade at a time.** A setup that qualifies while a trade is open is ignored. A closed trade frees the slot from the **next** bar, never the same bar.
- Exact input defaults: `Minimum Score` 4, all five `Score:` toggles on, `Strong Break (x ATR)` 1.0, `Stop Buffer (x ATR)` 0.25, `Minimum Target Distance (R)` 1.0, `Trailing Tier` "Internal", `Long Trades Only` off, `Show Trade Levels` on, `Show Trade History` on, `Show Trade Panel Rows` on.
- Do not touch: the RSI/MA section, the `STRUCTURE ENGINE` section, the `ZONE TYPE` section, FVG detection and creation, order-block creation, killzone sessions, `findOppositeCandle`, the `STRUCTURE RENDERING` section's swing tags/rays/break events, or the six existing `alertcondition` calls.
- `max_boxes_count`, `max_labels_count` and `max_lines_count` are all already 500. **Do not change them.**
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Capture which zone was touched

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add a `Touch` UDT beside `Zone`; extend `mitigateZones`; update its four call sites.

**Interfaces:**
- Consumes: `Zone` (fields `b` box, `lbl` label, `tier` string, `side` string); `mitigateZones(array<Zone> zones, bool isBullish) => bool`; `bullishFvgZones`, `bearishFvgZones`, `bullishObZones`, `bearishObZones`.
- Produces: `type Touch` (fields `hit` bool, `top` float, `bottom` float, `tier` string); `mitigateZones(array<Zone> zones, bool isBullish, Touch t) => bool`; globals `bullTouch`, `bearTouch` (`Touch`), reset every bar.

**Why this task exists.** The gate needs the touched zone's top and bottom to place the stop — but `mitigateZones` **deletes** the zone the moment it is touched, and returns only a bare `bool`. By the time anything downstream asks "which zone?", the box is gone. This captures the bounds on the way past.

- [ ] **Step 1: Add the `Touch` type**

Find the `ZONE TYPE` section's `Zone` declaration and insert immediately after its `string side` line, before the blank line preceding `var array<Zone> bullishFvgZones`:

```pinescript

// What a mitigation pass found, filled in by mitigateZones before the zone is deleted.
// Reset every bar — a stale hit would place a stop against a zone price left long ago.
type Touch
    bool   hit
    float  top
    float  bottom
    string tier
```

- [ ] **Step 2: Give `mitigateZones` the out-parameter**

Replace the whole `mitigateZones` function:

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

with:

```pinescript
// Records the FIRST touched zone into `t`. The loop runs newest-to-oldest, so that is the
// most recently formed zone — the one price is reacting to now, not a stale one below it.
mitigateZones(array<Zone> zones, bool isBullish, Touch t) =>
    touchedAny = false
    if array.size(zones) > 0
        for i = array.size(zones) - 1 to 0
            z = array.get(zones, i)
            top = box.get_top(z.b)
            bottom = box.get_bottom(z.b)
            touched = isBullish ? low <= top : high >= bottom
            if touched
                if not t.hit
                    t.hit    := true
                    t.top    := top
                    t.bottom := bottom
                    t.tier   := z.tier
                box.delete(z.b)
                label.delete(z.lbl)
                array.remove(zones, i)
                touchedAny := true
            else
                box.set_right(z.b, bar_index)
    touchedAny
```

- [ ] **Step 3: Declare the two `Touch` globals and reset them each bar**

Find the two FVG mitigation call sites:

```pinescript
bullishFvgTouched = mitigateZones(bullishFvgZones, true)
bearishFvgTouched = mitigateZones(bearishFvgZones, false)
```

Replace with:

```pinescript
var Touch bullTouch = Touch.new(false, na, na, na)
var Touch bearTouch = Touch.new(false, na, na, na)

bullTouch.hit    := false
bullTouch.top    := na
bullTouch.bottom := na
bullTouch.tier   := na
bearTouch.hit    := false
bearTouch.top    := na
bearTouch.bottom := na
bearTouch.tier   := na

bullishFvgTouched = mitigateZones(bullishFvgZones, true, bullTouch)
bearishFvgTouched = mitigateZones(bearishFvgZones, false, bearTouch)
```

The resets are at global scope and run on **every** bar, including unconfirmed ones. A `Touch` that survived into the next bar would hand the gate a zone price had already left.

- [ ] **Step 4: Update the two order-block mitigation call sites**

Find:

```pinescript
bullishObTouched = mitigateZones(bullishObZones, true)
bearishObTouched = mitigateZones(bearishObZones, false)
```

Replace with:

```pinescript
// Order blocks pass the same Touch objects as the FVGs above. Because mitigateZones only
// writes when `hit` is still false, an FVG touched earlier this bar keeps its bounds and
// the order block does not overwrite it.
bullishObTouched = mitigateZones(bullishObZones, true, bullTouch)
bearishObTouched = mitigateZones(bearishObZones, false, bearTouch)
```

- [ ] **Step 5: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `type Touch` is declared before its first use. State the line number of the declaration and of the first `Touch.new(`.
2. `mitigateZones` still ends on the expression `touchedAny`.
3. The descending loop is still wrapped in `if array.size(zones) > 0`.
4. The `if not t.hit` guard sits **inside** `if touched` and **before** the three `box.delete`/`label.delete`/`array.remove` calls. Quote the block. Reading `box.get_top` after deletion would read a reclaimed handle.
5. All four `mitigateZones` call sites pass a `Touch`, and the bullish sites pass `bullTouch` while the bearish sites pass `bearTouch` — no crossed sides.
6. The eight reset assignments are at global scope, **not** inside any `if`. Quote the surrounding lines to show indentation.
7. The resets appear **before** the first `mitigateZones` call in file order. Resetting after would erase the very hit just recorded.
8. `Touch.new(false, na, na, na)` matches the declared field order `hit, top, bottom, tier` — four arguments.
9. **Behaviour is otherwise unchanged.** `bullishFvgTouched`, `bearishFvgTouched`, `bullishObTouched`, `bearishObTouched` still hold the same values as before, and the signal conditions that read them are untouched. Run `git diff` and state, hunk by hunk, that nothing but the touch capture was added.

- [ ] **Step 6: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: capture the touched zone's bounds during mitigation"
```

---

### Task 2: Trade Engine inputs and the qualification gate

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add a `Trade Engine` input group after `Structure Display`; add a `TRADE GATE` section after the `WATCH-ZONE HEADS-UP` section.

**Interfaces:**
- Consumes: `intState`, `majorState` (`TierState`, fields `.trend`, `.lastStrength`); `inRange` (bool); `bullTouch`, `bearTouch` (`Touch`, Task 1); `killzoneActive`, `rsiValue`, `maValue`, `showLondonKZ`, `showNewYorkKZ`.
- Produces: inputs `minScore`, `scoreKillzone`, `scoreRsi`, `scoreMa`, `scoreMajorAgree`, `scoreBreakStrength`, `strongBreakMult`, `stopBufferMult`, `minTargetR`, `trailTierInput`, `longOnly`, `showTradeLevels`, `showTradeHistory`, `showTradePanel`, and colours `tradeLongColor`, `tradeShortColor`, `tradeStopColor`, `tradeTargetColor`; functions `setupScore(bool isLong) => int` and `enabledPoints() => int`; globals `longSetup`, `shortSetup` (bool), `setupScoreVal`, `setupOfVal` (int), `setupGradeVal` (string).

**Nothing consumes the gate in this task.** Task 4 opens trades from it. Unused `var`s are valid Pine — expected, not a defect.

- [ ] **Step 1: Add the Trade Engine inputs**

Find the last line of the `// ---------------- Structure Display ----------------` block:

```pinescript
rayColor           = input.color(color.gray, "Rays", group = "Structure Display")
```

Insert after it a blank line, then:

```pinescript
// ---------------- Trade Engine ----------------
minScore           = input.int(4, "Minimum Score", minval = 1, maxval = 10, group = "Trade Engine", tooltip = "How many scored points a setup needs, out of however many are switched on below. The panel shows both numbers — a disabled point is never counted in the denominator, so turning one off does not silently loosen or break the threshold.")
scoreKillzone      = input.bool(true, "Score: Killzone", group = "Trade Engine", tooltip = "Turn off on single-session markets such as EGX, where a killzone means nothing. If both killzone sessions are disabled for display, this point excludes itself automatically whatever this is set to.")
scoreRsi           = input.bool(true, "Score: RSI", group = "Trade Engine")
scoreMa            = input.bool(true, "Score: Moving Average", group = "Trade Engine")
scoreMajorAgree    = input.bool(true, "Score: Major Trend Agreement", group = "Trade Engine", tooltip = "Whether the major tier agrees with the internal tier. A pullback entry against the major trend is a real setup — just a weaker one — so this scores rather than vetoes.")
scoreBreakStrength = input.bool(true, "Score: Break Strength", group = "Trade Engine")
strongBreakMult    = input.float(1.0, "Strong Break (x ATR)", minval = 0.1, step = 0.1, group = "Trade Engine", tooltip = "The breaking candle's body must exceed this multiple of ATR to earn the break-strength point.")
stopBufferMult     = input.float(0.25, "Stop Buffer (x ATR)", minval = 0.0, step = 0.05, group = "Trade Engine", tooltip = "How far beyond the entry zone's far edge the stop sits, so an ordinary wick into the zone does not clip it. Also used by the trailing stop.")
minTargetR         = input.float(1.0, "Minimum Target Distance (R)", minval = 0.1, step = 0.1, group = "Trade Engine", tooltip = "Structural levels closer than this are skipped. A target 0.3R away is a winner on paper and not worth the spread.")
trailTierInput     = input.string("Internal", "Trailing Tier", options = ["Internal", "Major"], group = "Trade Engine", tooltip = "Which tier's swings the stop trails behind once TP1 is hit. Internal trails tightly; Major gives the trade room.")
longOnly           = input.bool(false, "Long Trades Only", group = "Trade Engine", tooltip = "For cash-equity charts where shorting is unavailable. Bearish setups still mark and alert, but open no trade.")
showTradeLevels    = input.bool(true, "Show Trade Levels", group = "Trade Engine")
showTradeHistory   = input.bool(true, "Show Trade History", group = "Trade Engine", tooltip = "Leaves a result label in R at each closed trade's exit bar — the cheapest possible track record.")
showTradePanel     = input.bool(true, "Show Trade Panel Rows", group = "Trade Engine")
tradeLongColor     = input.color(color.teal, "Long", group = "Trade Engine")
tradeShortColor    = input.color(color.maroon, "Short", group = "Trade Engine")
tradeStopColor     = input.color(color.red, "Stop", group = "Trade Engine")
tradeTargetColor   = input.color(color.green, "Targets", group = "Trade Engine")
```

- [ ] **Step 2: Insert the TRADE GATE section**

Find the last two lines of the `WATCH-ZONE HEADS-UP` section:

```pinescript
bullishWatchZone = intState.trend == "up" and killzoneActive and not inBullishZone and not na(closestBullishDist) and closestBullishDist <= atrValue * watchZoneAtrMult
bearishWatchZone = intState.trend == "down" and killzoneActive and not inBearishZone and not na(closestBearishDist) and closestBearishDist <= atrValue * watchZoneAtrMult
```

Insert after them a blank line, then:

```pinescript
// ============================================================
// TRADE GATE
// ============================================================
// Hard requirements are absolute: without a direction and a zone there is no side, no stop
// and no targets to compute. Everything else is evidence worth a point.
//
// The score is proportional — minScore is checked against the number of points actually
// enabled, never a fixed five. A disabled point left in the denominator would either make
// minScore unreachable or quietly loosen the gate while appearing to tighten it, and it is
// what lets later confirmation work add points instead of adding vetoes.

// The killzone point disables itself when neither session is drawn: on a single-session
// market a permanently-false point would make minScore unreachable.
killzonePointOn = scoreKillzone and (showLondonKZ or showNewYorkKZ)

enabledPoints() =>
    (killzonePointOn ? 1 : 0) + (scoreRsi ? 1 : 0) + (scoreMa ? 1 : 0) + (scoreMajorAgree ? 1 : 0) + (scoreBreakStrength ? 1 : 0)

setupScore(bool isLong) =>
    total = 0
    if killzonePointOn and killzoneActive
        total += 1
    if scoreRsi and (isLong ? rsiValue > 50 : rsiValue < 50)
        total += 1
    if scoreMa and (isLong ? close > maValue : close < maValue)
        total += 1
    if scoreMajorAgree and majorState.trend == intState.trend
        total += 1
    if scoreBreakStrength and not na(intState.lastStrength) and intState.lastStrength >= strongBreakMult
        total += 1
    total

// All enabled points = A, one short = B, two short = C. Which grades can actually appear
// depends on minScore: at the defaults (5 enabled, minScore 4) a C scores 3 and is rejected,
// so only A and B ever show. Lowering minScore to 3 is what opens C up.
gradeFor(int score, int ofPoints) =>
    score >= ofPoints ? "A" : score >= ofPoints - 1 ? "B" : "C"

bullHardOk = intState.trend == "up" and bullTouch.hit and not inRange and barstate.isconfirmed
bearHardOk = intState.trend == "down" and bearTouch.hit and not inRange and barstate.isconfirmed

var int    setupScoreVal = 0
var int    setupOfVal    = 0
var string setupGradeVal = na

ofPoints  = enabledPoints()
bullScore = bullHardOk ? setupScore(true) : 0
bearScore = bearHardOk ? setupScore(false) : 0

longSetup  = bullHardOk and bullScore >= minScore
shortSetup = bearHardOk and bearScore >= minScore

if longSetup
    setupScoreVal := bullScore
    setupOfVal    := ofPoints
    setupGradeVal := gradeFor(bullScore, ofPoints)
if shortSetup
    setupScoreVal := bearScore
    setupOfVal    := ofPoints
    setupGradeVal := gradeFor(bearScore, ofPoints)
```

- [ ] **Step 3: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. Every input's default matches the Global Constraints list exactly. List them side by side.
2. `enabledPoints`, `setupScore` and `gradeFor` each end on an expression (`total`, the ternary chain). Quote the closing line of each.
3. `killzonePointOn` requires **both** `scoreKillzone` and at least one killzone session enabled. Quote it, and state what happens to `enabledPoints()` when a user disables both sessions with `scoreKillzone` still on — the denominator must drop.
4. `setupScore` adds a point only when that point is **enabled**. Check all five `if` conditions include their toggle. A point that scored while disabled would exceed `enabledPoints()`.
5. The four hard requirements appear in both `bullHardOk` and `bearHardOk`: tier direction, `Touch.hit`, `not inRange`, `barstate.isconfirmed`. Quote both lines.
6. `bullHardOk` reads `intState.trend`, **not** `majorState.trend`. Major agreement is a scored point, not a requirement.
7. `bullHardOk` reads `bullTouch` and `bearHardOk` reads `bearTouch` — not crossed.
8. Trace `gradeFor` for `ofPoints = 5` at scores 5, 4 and 3, and for `ofPoints = 4` at scores 4, 3 and 2. State each result.
9. `setupScore` guards `intState.lastStrength` with `not na(...)` before comparing. Before the first break it is `na`, and a bare comparison would be `na`, not `false`.
10. Nothing outside the new input block and the new section changed. `git diff --stat` shows one file, insertions only, zero deletions.

- [ ] **Step 4: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: add the trade engine gate with proportional scoring"
```

---

### Task 3: Target selection from structure

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add a `TRADE TARGETS` section immediately after the `TRADE GATE` section.

**Interfaces:**
- Consumes: `SwingPoint` (fields `price` float, `bar` int, `kind` string, `broken` bool, `brokenBar` int, `liquidity` bool); arrays `majorHighs`, `majorLows`, `intHighs`, `intLows`; `structAtr`, `eqTolMult`, `minTargetR`.
- Produces: `type Targets` (fields `p1`, `p2`, `p3` float, `liq1`, `liq2`, `liq3` bool); functions `scanArray(array<SwingPoint> pts, bool isLong, float floorPrice, float curBest, bool curLiq) => [float, bool]`, `bestBeyond(bool isLong, float floorPrice) => [float, bool]`, `selectTargets(bool isLong, float entryPrice, float risk) => Targets`.

**Nothing consumes this in this task.** Task 4 calls `selectTargets` when a trade opens.

**Two Pine limits shape this code.** First, `array.sort` cannot carry the original index through the sort, so a sorted price gives no way back to the `SwingPoint` it came from — hence repeated-minimum selection instead of sorting. Second, selecting between two arrays with a ternary is not something to rely on, so `scanArray` takes the running best as arguments and is called once per array.

- [ ] **Step 1: Insert the TRADE TARGETS section**

Find the last line of the `TRADE GATE` section:

```pinescript
    setupGradeVal := gradeFor(bearScore, ofPoints)
```

Insert after it a blank line, then:

```pinescript
// ============================================================
// TRADE TARGETS
// ============================================================
type Targets
    float p1
    float p2
    float p3
    bool  liq1
    bool  liq2
    bool  liq3

// Accumulator scan: returns the nearer of `curBest` and the best qualifying point in `pts`.
// Called once per array because selecting between two arrays with a ternary is not something
// to depend on in Pine. Only unbroken points qualify — a broken level is one price has already
// closed through, so it is no longer the barrier a target is meant to represent.
//
// The liquidity tie-break is what implements the spec's deduplication rule: when two levels
// sit within eqTol of each other, the EQH/EQL wins, because resting stops are what price is
// actually travelling toward.
scanArray(array<SwingPoint> pts, bool isLong, float floorPrice, float curBest, bool curLiq) =>
    bestPrice = curBest
    bestLiq   = curLiq
    for p in pts
        if not p.broken
            beyond = isLong ? p.price > floorPrice : p.price < floorPrice
            if beyond
                withinTol = not na(bestPrice) and math.abs(p.price - bestPrice) <= eqTolMult * structAtr
                nearer    = na(bestPrice) or (isLong ? p.price < bestPrice : p.price > bestPrice)
                // The tie-break must work in BOTH directions, because bestBeyond always scans
                // the major array before the internal one: `promote` takes a liquidity level
                // that arrives second, and `keepLiq` stops a nearer plain level that arrives
                // second from displacing one. With only the first, a major-tier EQH would be
                // silently overwritten by any nearer internal-tier swing inside the tolerance.
                promote = withinTol and p.liquidity and not bestLiq
                keepLiq = withinTol and bestLiq and not p.liquidity
                if (nearer and not keepLiq) or promote
                    bestPrice := p.price
                    bestLiq   := p.liquidity
    [bestPrice, bestLiq]

bestBeyond(bool isLong, float floorPrice) =>
    bp = float(na)
    bl = false
    if isLong
        [p1, q1] = scanArray(majorHighs, true, floorPrice, bp, bl)
        bp := p1
        bl := q1
        [p2, q2] = scanArray(intHighs, true, floorPrice, bp, bl)
        bp := p2
        bl := q2
    else
        [p3, q3] = scanArray(majorLows, false, floorPrice, bp, bl)
        bp := p3
        bl := q3
        [p4, q4] = scanArray(intLows, false, floorPrice, bp, bl)
        bp := p4
        bl := q4
    [bp, bl]

// Three structural targets, nearest first. Each search starts one tolerance beyond the level
// just taken, which is what stops two levels within eqTol both being selected. Anything closer
// to entry than minTargetR is skipped by the initial floor.
//
// Any target the structure cannot supply is filled at one further R beyond the last one, so a
// trade always has three places to go and they are always in ascending order.
selectTargets(bool isLong, float entryPrice, float risk) =>
    prices = array.new<float>()
    liqs   = array.new<bool>()
    floorP = isLong ? entryPrice + minTargetR * risk : entryPrice - minTargetR * risk
    for n = 1 to 3
        [bp, bl] = bestBeyond(isLong, floorP)
        if not na(bp)
            array.push(prices, bp)
            array.push(liqs, bl)
            floorP := isLong ? bp + eqTolMult * structAtr : bp - eqTolMult * structAtr
    lastP = array.size(prices) > 0 ? array.get(prices, array.size(prices) - 1) : (isLong ? entryPrice + minTargetR * risk : entryPrice - minTargetR * risk)
    for n = 1 to 3
        if array.size(prices) < 3
            lastP := isLong ? lastP + risk : lastP - risk
            array.push(prices, lastP)
            array.push(liqs, false)
    Targets.new(array.get(prices, 0), array.get(prices, 1), array.get(prices, 2), array.get(liqs, 0), array.get(liqs, 1), array.get(liqs, 2))
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `type Targets` is declared before `Targets.new(` is called. State both line numbers.
2. `scanArray`, `bestBeyond` and `selectTargets` each end on an expression — `[bestPrice, bestLiq]`, `[bp, bl]`, and the `Targets.new(...)` call. Quote each closing line.
3. `scanArray` uses `for p in pts`, so no descending-loop guard is needed. Confirm there is no indexed loop anywhere in this section.
4. **`selectTargets` always produces exactly three targets.** Trace three cases and state the resulting `p1`, `p2`, `p3`: (a) three structural levels found; (b) exactly one found, at 5R; (c) none found. In (b) confirm the two fill targets are beyond the 5R level, not 2R and 3R from entry.
5. `array.get(prices, 0/1/2)` can never be out of bounds. State which loop guarantees `array.size(prices) == 3` by that line.
6. The fill loop's `lastP` starts at the last structural target when one exists, and at the `minTargetR` floor when none does. Quote the initialisation and explain why starting at `entryPrice` instead would place TP1 closer than `minTargetR`.
7. The dedup mechanism is the `floorP` advance, not a separate pass. Quote the line that advances it and confirm it moves by `eqTolMult * structAtr` in the trade's direction.
8. `scanArray` skips points where `p.broken` is true. Quote the guard.
9. The `withinTol` term cannot dereference a `na` best: quote it and show which clause makes `bestPrice` non-`na` before `math.abs` is evaluated.
9b. **The liquidity tie-break works in both scan orders.** Trace two cases with tolerance 2 and floor 110: (i) `majorHighs` holds 113 flagged liquidity and `intHighs` holds a plain 112; (ii) the reverse. Both must yield 113 with `liq = true`. `bestBeyond` always scans major before internal, so an asymmetric tie-break would silently discard the liquidity level in case (i) — which is the whole point of tracking EQH/EQL.
10. For a short, every comparison is inverted: `p.price < floorPrice`, `p.price > bestPrice`, `floorP` decreasing, `lastP` decreasing. Check all four and quote them.
11. Nothing outside the new section changed. `git diff --stat` shows one file, insertions only, zero deletions.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: select structural take-profit targets by repeated-minimum search"
```

---

### Task 4: The trade object, state machine and exits

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add a `TRADE LIFECYCLE` section after `TRADE TARGETS`; rewrite the `CONFLUENCE SIGNALS` section's latch and signal lines.

**Interfaces:**
- Consumes: everything from Tasks 1–3 — `bullTouch`/`bearTouch`, `longSetup`/`shortSetup`, `setupScoreVal`/`setupOfVal`/`setupGradeVal`, `selectTargets`, `Targets`; plus `intState`, `majorHighs`/`majorLows`/`intHighs`/`intLows`, `structAtr`, `stopBufferMult`, `trailTierInput`, `longOnly`.
- Produces: `type Trade`; `var Trade activeTrade`; globals `tradeOpened`, `tradeClosed`, `targetJustHit` (bool), `tradeOpenR` (float); rewritten `bullishSignal` / `bearishSignal`.

- [ ] **Step 1: Insert the TRADE LIFECYCLE section**

Find the last line of the `TRADE TARGETS` section — the `Targets.new(...)` line closing `selectTargets`. Insert after it a blank line, then:

```pinescript
// ============================================================
// TRADE LIFECYCLE
// ============================================================
type Trade
    string side
    string grade
    int    score
    int    scoreOf
    float  entry
    float  stop
    float  initialStop
    float  zoneTop
    float  zoneBottom
    float  tp1
    float  tp2
    float  tp3
    bool   liq1
    bool   liq2
    bool   liq3
    int    openBar
    int    tpHit
    string closeReason
    float  closePrice

var Trade activeTrade = na

tradeOpened   = false
tradeClosed   = false
targetJustHit = false

var string openedSide = na
openedSide := na

// Whether there is a trade that has not closed. Written as nested `if`s, never as
// `not na(activeTrade) and na(activeTrade.closeReason)`: Pine does not guarantee short-circuit
// evaluation, and reading a field of a `na` object is a runtime error.
tradeIsLive() =>
    live = false
    if not na(activeTrade)
        if na(activeTrade.closeReason)
            live := true
    live

// Newest unbroken swing price in one array, or na.
newestUnbroken(array<SwingPoint> pts) =>
    result = float(na)
    if array.size(pts) > 0
        for i = array.size(pts) - 1 to 0
            p = array.get(pts, i)
            if not p.broken
                result := p.price
                break
    result

// The trailing stop follows structure, so it can only move when a pivot confirms — which is
// lookback bars after the fact. That lag is inherent to non-repainting pivots, not a defect.
// The tier is chosen by picking between two float RESULTS, never between two arrays.
trailAnchor(bool isLong) =>
    useMajor = trailTierInput == "Major"
    result = float(na)
    if isLong
        result := useMajor ? newestUnbroken(majorLows) : newestUnbroken(intLows)
    else
        result := useMajor ? newestUnbroken(majorHighs) : newestUnbroken(intHighs)
    result

// ---- exits, on confirmed bars only, stop first ----
if barstate.isconfirmed and tradeIsLive()
    isLong = activeTrade.side == "long"
    stopHit = isLong ? low <= activeTrade.stop : high >= activeTrade.stop
    if stopHit
        // A bar that OPENS beyond the stop was never fillable at the stop. Recording the
        // stop price would flatter every gapped exit — routine on auction opens and weekends.
        activeTrade.closePrice  := isLong ? math.min(activeTrade.stop, open) : math.max(activeTrade.stop, open)
        activeTrade.closeReason := "Stopped"
        tradeClosed := true
    else
        if activeTrade.tpHit < 1 and (isLong ? high >= activeTrade.tp1 : low <= activeTrade.tp1)
            activeTrade.tpHit := 1
            activeTrade.stop  := activeTrade.entry
            targetJustHit := true
        if activeTrade.tpHit < 2 and (isLong ? high >= activeTrade.tp2 : low <= activeTrade.tp2)
            activeTrade.tpHit := 2
            targetJustHit := true
        if activeTrade.tpHit < 3 and (isLong ? high >= activeTrade.tp3 : low <= activeTrade.tp3)
            activeTrade.tpHit := 3
            targetJustHit := true
        if activeTrade.tpHit >= 3
            activeTrade.closePrice  := activeTrade.tp3
            activeTrade.closeReason := "Target"
            tradeClosed := true
        else
            chochAgainst = isLong ? (intState.bearBreak and intState.lastType == "CHoCH") : (intState.bullBreak and intState.lastType == "CHoCH")
            if chochAgainst
                activeTrade.closePrice  := close
                activeTrade.closeReason := "Invalidated"
                tradeClosed := true
            else if activeTrade.tpHit >= 1
                anchor = trailAnchor(isLong)
                if not na(anchor)
                    candidate = isLong ? anchor - stopBufferMult * structAtr : anchor + stopBufferMult * structAtr
                    if isLong ? candidate > activeTrade.stop : candidate < activeTrade.stop
                        activeTrade.stop := candidate

// ---- free the slot, never on the closing bar itself ----
// Nested rather than `and`-chained, for the same reason tradeIsLive() is.
if not na(activeTrade)
    if not na(activeTrade.closeReason)
        if not tradeClosed
            activeTrade := na

// ---- open ----
canOpen = na(activeTrade)
if canOpen and longSetup
    zTop = bullTouch.top
    zBot = bullTouch.bottom
    st   = zBot - stopBufferMult * structAtr
    if close > st
        risk = close - st
        tg   = selectTargets(true, close, risk)
        activeTrade := Trade.new("long", setupGradeVal, setupScoreVal, setupOfVal, close, st, st, zTop, zBot, tg.p1, tg.p2, tg.p3, tg.liq1, tg.liq2, tg.liq3, bar_index, 0, na, na)
        tradeOpened := true
        openedSide  := "long"
if canOpen and shortSetup and not longOnly
    zTop = bearTouch.top
    zBot = bearTouch.bottom
    st   = zTop + stopBufferMult * structAtr
    if close < st
        risk = st - close
        tg   = selectTargets(false, close, risk)
        activeTrade := Trade.new("short", setupGradeVal, setupScoreVal, setupOfVal, close, st, st, zTop, zBot, tg.p1, tg.p2, tg.p3, tg.liq1, tg.liq2, tg.liq3, bar_index, 0, na, na)
        tradeOpened := true
        openedSide  := "short"

// Open R, using initialStop always — the trailed stop would shrink the denominator and
// overstate every result.
tradeOpenR = float(na)
if not na(activeTrade)
    r = math.abs(activeTrade.entry - activeTrade.initialStop)
    if r > 0
        tradeOpenR := (activeTrade.side == "long" ? close - activeTrade.entry : activeTrade.entry - close) / r
```

- [ ] **Step 2: Rewrite the CONFLUENCE SIGNALS section**

Replace lines 398–418 — from `var bool bullishSignalFired = false` through the second `plotshape` — with:

```pinescript
inBullishZone = bullishFvgTouched or bullishObTouched
inBearishZone = bearishFvgTouched or bearishObTouched

// The triangles now mark a trade opening, not "five conditions agreed". The old fired-latch
// is gone: the trade state machine already suppresses re-entry, because only a FLAT slot can
// open a trade.
//
// These read `openedSide`, not `activeTrade.side`, so no UDT field is dereferenced inside an
// `and` — Pine does not guarantee short-circuit evaluation and a `na` object would error.
bullishSignal = tradeOpened and openedSide == "long"
bearishSignal = tradeOpened and openedSide == "short"

plotshape(showSignalMarkers and bullishSignal, title = "Bullish Signal", style = shape.triangleup, location = location.belowbar, color = color.new(color.lime, 0), size = size.small)
plotshape(showSignalMarkers and bearishSignal, title = "Bearish Signal", style = shape.triangledown, location = location.abovebar, color = color.new(color.red, 0), size = size.small)
```

**Section order matters here, and the file is not laid out the way you might assume.** `CONFLUENCE SIGNALS` sits at roughly line 446, *before* `WATCH-ZONE HEADS-UP` — and every trade section was appended after the watch zone (`TRADE GATE` ~483, `TRADE TARGETS` ~545, `TRADE LIFECYCLE` ~627). So `bullishSignal` cannot stay where it is: it would read `tradeOpened` and `openedSide` about 180 lines before they are assigned, and Pine has no forward references.

Split the section instead:

- **`inBullishZone` / `inBearishZone` stay put.** The untouched watch-zone code immediately below depends on them.
- **`bullishSignal`, `bearishSignal` and both `plotshape` calls move down**, to just after the `TRADE LIFECYCLE` section you added in Step 1 and before the `alertcondition` block that reads them.

Confirm the finished file has no forward reference: every name must be assigned above its first read.

- [ ] **Step 3: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `grep -n "bullishSignalFired\|bearishSignalFired"` returns **zero** hits.
2. `Trade.new(...)` passes **nineteen** arguments in declared field order. Count them against the type declaration for both the long and the short call, and check `entry`, `stop` and `initialStop` receive `close`, `st`, `st` respectively.
3. **No UDT field is dereferenced inside an `and`/`or` chain anywhere in this task.** Grep the section for `activeTrade.` and confirm every occurrence sits inside a body already guarded by a separate enclosing `if`, or inside `tradeIsLive()`. This is the single highest-consequence check here: Pine does not guarantee short-circuit evaluation, and reading a field of a `na` object is a runtime error that only appears once a chart has a closed trade.
4. `trailAnchor` selects between two **float results**, never between two arrays — quote the two ternaries and confirm each branch is a `newestUnbroken(...)` call, not an array.
5. Exit order is stop → targets → TP3 close → invalidation → trail, and the target/invalidation/trail branch sits in the `else` of the stop check. Quote the structure. A trade stopped out must not also register a target on the same bar.
6. The gap-aware close uses `math.min` for a long and `math.max` for a short. Quote both and state what each yields when the bar opens *beyond* the stop and when it opens normally.
7. `Target` closes record `tp3`, and `Invalidated` closes record `close`. Quote both.
8. The slot-freeing block runs only when `tradeClosed` is false — that is what stops a trade being cleared on the same bar it closed, so the closing bar can still render and alert. Quote it and trace the two-bar sequence.
9. `canOpen` is computed **before** any open attempt and both open blocks test it, so a long and a short cannot both open on one bar. Quote the three lines.
10. The `if close > st` (long) and `if close < st` (short) guards prevent a non-positive risk. State what would happen without them when price closes below its own stop level.
11. `longOnly` gates **only** the short open. Quote the two conditions and confirm the long path does not read it.
12. `newestUnbroken`'s descending loop is guarded by `array.size(pts) > 0`, and it, `trailAnchor` and `tradeIsLive` each end on an expression (`result`, `result`, `live`).
13. The trail runs only when `tpHit >= 1`, and only moves the stop in the favourable direction. Quote the comparison for both sides.
14. `tradeOpenR` divides by `initialStop` distance, guarded by `r > 0`, and never by `stop`. Quote it.
15. `openedSide` is reset to `na` at global scope every bar and set only inside the two open blocks. Quote the reset and both assignments — a stale value would make a triangle print on a bar where nothing opened.
16. The `TRADE LIFECYCLE` section appears **before** the `CONFLUENCE SIGNALS` section in the file. State both line numbers.
17. `bullishWatchZone` / `bearishWatchZone` and the six existing `alertcondition` calls are unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: open, manage and close a single trade with a trailing stop"
```

---

### Task 5: Trade rendering, panel rows and alerts

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add a `TRADE RENDERING` section after `STRUCTURE RENDERING`; extend the structure panel; add three `alertcondition` calls.

**Interfaces:**
- Consumes: `activeTrade`, `tradeOpened`, `tradeClosed`, `targetJustHit`, `tradeOpenR` (Task 4); `showTradeLevels`, `showTradeHistory`, `showTradePanel`, and the four trade colours (Task 2).
- Produces: no interface for later work — presentation only.

- [ ] **Step 1: Insert the TRADE RENDERING section**

Find the end of the `STRUCTURE RENDERING` section — the redraw block's last line, `drawSwingRays(intLows, true, true)`. Insert after it a blank line, then:

```pinescript
// ============================================================
// TRADE RENDERING
// ============================================================
// Same rule as the structure section: state redraws, events persist. The live trade's levels
// are a claim about now and are rebuilt every last-bar pass; the result label is a thing that
// happened at a bar and stays.
var line[]  tradeLines  = array.new<line>()
var label[] tradeLabels = array.new<label>()
var box     tradeBox    = na

tradeLevelLine(float price, color col, string txt, bool dotted) =>
    array.push(tradeLines, line.new(activeTrade.openBar, price, bar_index, price, extend = extend.right, color = col, style = dotted ? line.style_dotted : line.style_solid, width = 1))
    array.push(tradeLabels, label.new(bar_index, price, txt, style = label.style_label_left, color = col, textcolor = color.white, size = size.tiny))
    array.size(tradeLines)

// One builder for all three target labels — price, R multiple, a liquidity note when the
// level is an EQH/EQL, and a tick once reached.
targetLabelText(int n, float price, bool isLiq, bool isLong, float entryPrice, float r, int tpHit) =>
    rTxt   = r > 0 ? str.tostring(math.abs(price - entryPrice) / r, "0.0") : "0.0"
    liqTxt = isLiq ? (isLong ? " · EQH" : " · EQL") : ""
    hitTxt = tpHit >= n ? " ✓" : ""
    "TP" + str.tostring(n) + " " + str.tostring(price, format.mintick) + " · " + rTxt + "R" + liqTxt + hitTxt

if barstate.islast
    for ln in tradeLines
        line.delete(ln)
    array.clear(tradeLines)
    for lb in tradeLabels
        label.delete(lb)
    array.clear(tradeLabels)
    box.delete(tradeBox)
    if showTradeLevels and tradeIsLive()
        isLong  = activeTrade.side == "long"
        sideCol = isLong ? tradeLongColor : tradeShortColor
        r       = math.abs(activeTrade.entry - activeTrade.initialStop)
        tradeBox := box.new(activeTrade.openBar, activeTrade.zoneTop, bar_index, activeTrade.zoneBottom, border_color = sideCol, bgcolor = color.new(sideCol, 88))
        array.push(tradeLabels, label.new(activeTrade.openBar, activeTrade.zoneTop, (isLong ? "LONG · " : "SHORT · ") + activeTrade.grade + " · " + str.tostring(activeTrade.score) + "/" + str.tostring(activeTrade.scoreOf), style = label.style_label_down, color = sideCol, textcolor = color.white, size = size.tiny))
        tradeLevelLine(activeTrade.entry, sideCol, "Entry " + str.tostring(activeTrade.entry, format.mintick), false)
        tradeLevelLine(activeTrade.stop, tradeStopColor, "SL " + str.tostring(activeTrade.stop, format.mintick), false)
        tradeLevelLine(activeTrade.tp1, tradeTargetColor, targetLabelText(1, activeTrade.tp1, activeTrade.liq1, isLong, activeTrade.entry, r, activeTrade.tpHit), activeTrade.tpHit >= 1)
        tradeLevelLine(activeTrade.tp2, tradeTargetColor, targetLabelText(2, activeTrade.tp2, activeTrade.liq2, isLong, activeTrade.entry, r, activeTrade.tpHit), activeTrade.tpHit >= 2)
        tradeLevelLine(activeTrade.tp3, tradeTargetColor, targetLabelText(3, activeTrade.tp3, activeTrade.liq3, isLong, activeTrade.entry, r, activeTrade.tpHit), activeTrade.tpHit >= 3)

// Persistent — deliberately not tracked in tradeLines/tradeLabels, so the redraw above never
// deletes it. One label per closed trade is the whole track record.
if tradeClosed and showTradeHistory and not na(activeTrade)
    rr = math.abs(activeTrade.entry - activeTrade.initialStop)
    realisedR = rr > 0 ? (activeTrade.side == "long" ? activeTrade.closePrice - activeTrade.entry : activeTrade.entry - activeTrade.closePrice) / rr : 0.0
    resCol = realisedR >= 0 ? color.new(color.green, 20) : color.new(color.red, 20)
    label.new(bar_index, activeTrade.closePrice, (realisedR >= 0 ? "+" : "") + str.tostring(realisedR, "0.0") + "R · " + activeTrade.closeReason, style = activeTrade.side == "long" ? label.style_label_up : label.style_label_down, color = resCol, textcolor = color.white, size = size.tiny)
```

- [ ] **Step 2: Extend the structure panel with trade rows**

Find the panel's `table.new` line and the ten `table.cell` calls that follow it:

```pinescript
        structPanel := table.new(panelPos, 2, 5, bgcolor = color.new(color.black, 80), border_width = 1)
```

Replace that single line with:

```pinescript
        tradeRows = 0
        if showTradePanel and tradeIsLive()
            tradeRows := 6
        structPanel := table.new(panelPos, 2, 5 + tradeRows, bgcolor = color.new(color.black, 80), border_width = 1)
```

Then, after the last existing `table.cell(structPanel, 1, 4, internalText, ...)` line, insert:

```pinescript
        if tradeRows > 0
            isLongT = activeTrade.side == "long"
            rT      = math.abs(activeTrade.entry - activeTrade.initialStop)
            rTxt    = rT > 0 ? str.tostring(tradeOpenR, "0.00") + "R" : "—"
            table.cell(structPanel, 0, 5, "TRADE", text_color = color.white, bgcolor = color.new(color.gray, 50))
            table.cell(structPanel, 1, 5, (isLongT ? "LONG" : "SHORT") + " · " + activeTrade.grade + " · " + str.tostring(activeTrade.score) + "/" + str.tostring(activeTrade.scoreOf), text_color = isLongT ? tradeLongColor : tradeShortColor, bgcolor = color.new(color.gray, 50))
            table.cell(structPanel, 0, 6, "Entry", text_color = color.silver)
            table.cell(structPanel, 1, 6, str.tostring(activeTrade.entry, format.mintick), text_color = color.white)
            table.cell(structPanel, 0, 7, "Stop", text_color = color.silver)
            table.cell(structPanel, 1, 7, str.tostring(activeTrade.stop, format.mintick) + (activeTrade.tpHit >= 1 ? " · BE+" : ""), text_color = tradeStopColor)
            table.cell(structPanel, 0, 8, "TP1 / TP2", text_color = color.silver)
            table.cell(structPanel, 1, 8, str.tostring(activeTrade.tp1, format.mintick) + (activeTrade.tpHit >= 1 ? " ✓" : "") + "  " + str.tostring(activeTrade.tp2, format.mintick) + (activeTrade.tpHit >= 2 ? " ✓" : ""), text_color = tradeTargetColor)
            table.cell(structPanel, 0, 9, "TP3", text_color = color.silver)
            table.cell(structPanel, 1, 9, str.tostring(activeTrade.tp3, format.mintick) + (activeTrade.tpHit >= 3 ? " ✓" : ""), text_color = tradeTargetColor)
            table.cell(structPanel, 0, 10, "Open R", text_color = color.silver)
            table.cell(structPanel, 1, 10, rTxt, text_color = tradeOpenR >= 0 ? color.lime : color.red)
```

- [ ] **Step 3: Add the three trade alerts**

Find the last existing `alertcondition` call:

```pinescript
alertcondition(majorEventFired and majorState.lastType == "BOS", title = "Major BOS (trend continuation)", message = "Major BOS on {{ticker}} {{interval}}: structure trend continued.")
```

Insert after it a blank line, then:

```pinescript
alertcondition(tradeOpened, title = "Trade Opened", message = "Trade opened on {{ticker}} {{interval}} — check the panel for side, grade, stop and targets.")
alertcondition(targetJustHit, title = "Target Hit", message = "Take-profit target reached on {{ticker}} {{interval}}.")
alertcondition(tradeClosed, title = "Trade Closed", message = "Trade closed on {{ticker}} {{interval}} — see the result label on the chart for R and reason.")
```

**`alertcondition` messages cannot interpolate script variables** — only TradingView's own `{{...}}` placeholders. The messages therefore point at the chart rather than claiming to carry the side, grade or R.

- [ ] **Step 3b: Correct the two now-stale confluence alert messages**

`bullishSignal` and `bearishSignal` changed meaning in Task 4 — from "five conditions agreed" to "a trade opened" — but the two oldest `alertcondition` messages still describe the old semantics and now mislead. Replace:

```pinescript
alertcondition(bullishSignal, title = "Bullish Confluence Signal", message = "Bullish confluence signal on {{ticker}} {{interval}}: structure + FVG/OB + killzone + RSI/MA aligned bullish.")
alertcondition(bearishSignal, title = "Bearish Confluence Signal", message = "Bearish confluence signal on {{ticker}} {{interval}}: structure + FVG/OB + killzone + RSI/MA aligned bearish.")
```

with:

```pinescript
alertcondition(bullishSignal, title = "Bullish Trade Entry", message = "Long trade opened on {{ticker}} {{interval}} — see the chart for entry zone, stop and targets.")
alertcondition(bearishSignal, title = "Bearish Trade Entry", message = "Short trade opened on {{ticker}} {{interval}} — see the chart for entry zone, stop and targets.")
```

The other four existing alerts — the two watch-zone and the two major-structure ones — are unchanged and still accurate.

- [ ] **Step 4: Add the Data Window debug plots**

The spec requires the machine to be readable as numbers rather than eyeballed. Insert immediately after the three new `alertcondition` calls, following a blank line:

```pinescript
// Data Window readouts — the verification surface. Values are gathered inside an `if` rather
// than with ternaries on activeTrade, because reading a field of a `na` object is a runtime
// error and Pine does not guarantee short-circuit evaluation.
dbgTradeState = 0
dbgTradeSide  = 0
dbgTpHit      = 0
dbgTradeStop  = float(na)
if tradeIsLive()
    dbgTradeState := 1
    dbgTradeSide  := activeTrade.side == "long" ? 1 : -1
    dbgTpHit      := activeTrade.tpHit
    dbgTradeStop  := activeTrade.stop

plot(dbgTradeState, "DBG Trade State (1=open)", display = display.data_window)
plot(dbgTradeSide, "DBG Trade Side (1=long -1=short)", display = display.data_window)
plot(dbgTpHit, "DBG TP Hit (0-3)", display = display.data_window)
plot(dbgTradeStop, "DBG Trade Stop", display = display.data_window)
plot(tradeOpenR, "DBG Open R", display = display.data_window)
plot(setupScoreVal, "DBG Setup Score", display = display.data_window)
plot(setupOfVal, "DBG Setup Of", display = display.data_window)
plot(enabledPoints(), "DBG Enabled Points", display = display.data_window)
```

- [ ] **Step 5: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `tradeLevelLine` ends on an expression (`array.size(tradeLines)`), and `targetLabelText` ends on its concatenated string. The three target labels are built by **one** shared function, not three copied expressions.
2. The redraw block deletes and clears `tradeLines`, `tradeLabels` **and** `tradeBox` before drawing anything. Quote the order.
3. The result label is **not** pushed into `tradeLines` or `tradeLabels`. Confirm `label.new` there is a bare call with no `array.push`. Tracking it would erase the entire history on the next redraw.
4. The result-label block is at global scope, not inside `if barstate.islast` — it must run on the bar the trade closes.
5. The panel's row count is `5 + tradeRows`, and the highest row index written when `tradeRows` is 6 is **10**. Count the `table.cell` calls and confirm the maximum index is `rowCount - 1`.
6. When `tradeRows` is 0 the panel is exactly as block A left it — five rows, ten cells, no trade rows written.
7. Both `realisedR` and the panel's R figures divide by `initialStop` distance, never by `stop`. Quote each division.
8. Every division by `r` / `rr` / `rT` is guarded against zero. Quote each guard.
9. Trade levels draw only while `na(activeTrade.closeReason)` — a closed trade leaves the result label, not a live level set. Quote the condition.
10. The three new `alertcondition` calls are at global scope, and the six existing ones are unmodified.
11. `max_boxes_count`, `max_labels_count` and `max_lines_count` on line 2 are unchanged.
12. **No UDT field is dereferenced inside an `and`/`or` chain or a ternary condition in this task.** Grep for `activeTrade.` and confirm every occurrence sits inside a body guarded by `tradeIsLive()` or `not na(activeTrade)`. The panel row count and the debug plots both gather their values inside an `if` for exactly this reason.
13. The eight `DBG` plots are at global scope and use `display = display.data_window`, so none of them draws on the price chart.

- [ ] **Step 6: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-07-trade-engine-design.md` alongside the finished file and confirm, reporting each result:

1. **The gate** — four hard requirements present; score proportional over enabled points; killzone safety net present. Grep `minScore` and confirm it is compared against `enabledPoints()`, never a literal 5.
2. **Entry price is the signal bar's `close`**, not a zone edge or midpoint. Quote both open blocks.
3. **Stop** is the zone's far edge ∓ `stopBufferMult × structAtr`, on both sides.
4. **Targets** come from both tiers, prefer liquidity on ties, respect `minTargetR`, and always number three.
5. **Trailing** moves to breakeven at TP1, then follows `trailTierInput`'s swings, never backwards.
6. **Exits** are stop-first, gap-aware, and record the three close prices the spec specifies.
7. **One trade at a time**, and the slot frees on the bar *after* the close.
8. **`Long Trades Only`** suppresses the short trade but not the bearish structure marks.
9. **Rendering** matches the spec's lifetime table row for row.
10. **`initialStop` is the R denominator everywhere.** Grep every `R` computation and confirm none uses `.stop`.
11. **The Data Window surface exists**: trade state, side, `tpHit`, stop, open R, setup score, enabled points. The spec names these as the verification surface, so their absence would make most of the deferred checklist un-runnable.
12. Run `git diff 94bfa0b -- src/ict-rsi-ma-indicator.pine --stat` and confirm the change is confined to that one file.

- [ ] **Step 7: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: draw trade levels, panel rows, result history and alerts"
```

---

## Deferred human verification (TradingView)

Not executable in this environment — there is no Pine compiler here. Hand these to the user after Task 5.

- Paste into the Pine Editor and confirm it compiles with no errors and no warnings.
- Confirm no trade opens while the panel's `Range` row reads `YES`, however good the setup looks.
- Turn `Score: Killzone` off and confirm the panel's setup fraction changes to `/4` and trades still open.
- Turn **both** killzone sessions off in the Killzones group while leaving `Score: Killzone` on, and confirm the fraction still drops to `/4` — the safety net. This is the EGX configuration.
- Raise `Minimum Score` to the enabled count and confirm only A-grade setups open trades.
- Confirm the stop sits `Stop Buffer × ATR` beyond the entry zone box, on both a long and a short.
- Confirm each target is at least `Minimum Target Distance (R)` from entry, and that a target landing on an EQH shows `· EQH` on its label.
- Find a setup with fewer than three structural levels ahead and confirm the fill targets appear, ascending, beyond the last real one.
- Confirm TP1 being hit moves the stop to exactly the entry price and the panel's Stop row shows `· BE+`.
- Confirm the stop then trails behind new swings and never moves backwards; switch `Trailing Tier` to `Major` and confirm it trails more loosely.
- Find a bar whose range spans both the stop and a target, and confirm the trade closes as `Stopped`.
- Find a gap through the stop and confirm the result label's R reflects the open, not the stop.
- Confirm a CHoCH against an open trade closes it as `Invalidated` with the stop untouched.
- Confirm no second trade opens while one runs, and that a new one can open on the bar **after** a close, not the same bar.
- Set `Long Trades Only` and confirm bearish setups still show structure and alerts but open no trade.
- Scroll back over a long history and confirm result labels persist with no "too many labels" error.
- Leave it on a live fast timeframe for several bars and confirm Trade Opened, Target Hit and Trade Closed each fire once per event, not repeatedly.
