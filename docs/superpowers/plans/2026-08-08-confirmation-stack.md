# Confirmation Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add momentum (RSI/MACD/Stochastic), participation (volume/climax) and Ichimoku to the trade gate as three grouped scored points, and rescale the grade arithmetic so a bigger denominator cannot silently loosen the gate.

**Architecture:** Five indicators become **three** scored points, because correlated inputs must not vote separately. Each grouped point is earned when at least half its *enabled* members agree, and a group with every member disabled removes itself from the denominator. Grades move from absolute shortfall to a fraction of enabled points, which reproduces today's behaviour exactly at five points. All new series are computed in one new section placed after the watch-zone block and before the trade gate.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-08-confirmation-stack-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` at commit `67a0473` on branch `feat/confirmation-stack`, 1004 lines. This plan modifies that file in place. **All line numbers refer to that revision** and shift as tasks land — always locate code by its text, not by line number.

## Global Constraints

- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error.
- **`class` is a reserved word in Pine v6.** Do not introduce identifiers another language would reserve.
- **Do not write `cond and array.get(arr, i).field` where `i` may be `-1`.** Pine does not guarantee short-circuit evaluation; guard every array access with a separate enclosing `if`.
- **Loop-direction footgun:** `for i = X to Y` runs *descending* when `Y < X` rather than skipping. Every loop in this plan is guarded by an input `minval` that makes the ascending case the only one reachable.
- **Do not rely on `/` between two ints returning an int.** Every "half, rounded up" calculation in this plan uses `math.ceil(n / 2.0)`, which takes a float and returns an int.
- **Tuple destructuring is used only at global scope**, never inside an `if` block or a function body. Group votes are therefore computed as flat global scalars, not as tuple-returning helpers.
- **The score is computed over enabled points only.** `minScore` is checked against the count of enabled points, and both numbers are displayed. A disabled point must never sit in the denominator.
- **A group point whose members are all disabled removes itself from the denominator**, regardless of the group's own toggle. This generalises the existing killzone safety net.
- **"At least half, rounded up"** — 2 of 3, 1 of 2, 1 of 1. Never a strict majority: that would need 2 of 2 but only 2 of 3, so disabling a member would make the point *easier* to earn.
- **Climax is read as exhaustion, against the trade's direction.** A long's climax bar is a heavy **down** bar closing on its low. This is deliberate and is not a sign error.
- **Ichimoku reads the cloud at `[ichiDisp]`.** The cloud drawn at the current bar was computed `ichiDisp` bars ago. Comparing `close` to the undelayed span compares price to a cloud not drawn for another 26 bars.
- **Chikou is never computed, plotted or scored.**
- Exact new input defaults: `Score: Momentum` on, `Momentum: RSI` on, `Momentum: MACD` on, `Momentum: Stochastic` on, MACD 12/26/9, Stochastic 14/3/3, `Score: Participation` on, `Participation: Volume Surge` on, `Participation: Climax Candle` on, `Volume Average Length` 20, `Volume Surge (x average)` 1.5, `Climax Range (x ATR)` 2.0, `Climax Volume (x average)` 2.0, `Climax Lookback (bars)` 3, `Score: Ichimoku` on, Ichimoku 9/26/52/26, `Show Kumo Cloud` **off**, `Show Confirmation Panel Row` on.
- **`Minimum Score` default changes from 4 to 5.** Its `maxval` stays 15.
- Do not touch: the four hard requirements, `scanArray`, `selectTargets`, the `Trade` type, exit detection, the trailing stop, target/entry/stop rendering, result labels, or any existing `alertcondition`.
- `max_boxes_count`, `max_labels_count` and `max_lines_count` are all already 500. **Do not change them.**
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Inputs and the RSI rename

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — change the `Minimum Score` default; rename `scoreRsi`; add the `Confirmations` input group after the `Trade Engine` group; update the single `scoreRsi` reference in `scoreTally`.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: globals `momRsi`, `scoreMomentum`, `momMacd`, `momStoch`, `macdFast`, `macdSlow`, `macdSignalLen`, `stochLength`, `stochSmoothK`, `stochDLength`, `scoreParticipation`, `partVolume`, `partClimax`, `volLen`, `volMult`, `climaxRangeMult`, `climaxVolMult`, `climaxBars`, `scoreIchimoku`, `tenkanLen`, `kijunLen`, `senkouBLen`, `ichiDisp`, `showKumo`, `showConfirmPanel`, `kumoBullColor`, `kumoBearColor` — all `input.*` results.

**Why this task exists.** Everything downstream reads these inputs, so they land first. The rename is done here together with its one call site so the file still compiles and still behaves exactly as it does today — RSI remains a standalone point until Task 3 restructures the gate.

- [ ] **Step 1: Raise the `Minimum Score` default and explain the migration in its tooltip**

Find this line in the `// ---------------- Trade Engine ----------------` group:

```pinescript
minScore           = input.int(4, "Minimum Score", minval = 1, maxval = 15, group = "Trade Engine", tooltip = "How many scored points a setup needs, out of however many are switched on below. The panel shows both numbers — a disabled point is never counted in the denominator, so turning one off does not silently loosen or break the threshold.")
```

Replace it with:

```pinescript
minScore           = input.int(5, "Minimum Score", minval = 1, maxval = 15, group = "Trade Engine", tooltip = "How many scored points a setup needs, out of however many are switched on below. The panel shows both numbers — a disabled point is never counted in the denominator, so turning one off does not silently loosen or break the threshold.\n\nRaised from 4 to 5 when the confirmation points were added: at seven points, 4 would be a LOOSER gate than the old 4-of-5. TradingView keeps the value saved on an existing chart, so if this still reads 4, it was carried over and should be raised by hand.")
```

- [ ] **Step 2: Rename the RSI score toggle and move it out of the Trade Engine group**

Delete this line entirely:

```pinescript
scoreRsi           = input.bool(true, "Score: RSI", group = "Trade Engine")
```

The `Trade Engine` group now runs `scoreKillzone` → `scoreMa` with no RSI line between them. The replacement is added in Step 3.

- [ ] **Step 3: Add the Confirmations input group**

Insert immediately after the `tradeTargetColor` line (the last line of the `Trade Engine` group) and before the blank line preceding `// ============` / `// RSI + MA`:

```pinescript

// ---------------- Confirmations ----------------
// Five indicators, three points. RSI, MACD and Stochastic all read momentum off the same price
// series — counted separately they would cast three votes for one opinion, and a setup could
// clear minScore on momentum agreeing with itself. Correlated members share a point instead.
scoreMomentum      = input.bool(true, "Score: Momentum", group = "Confirmations", tooltip = "One point, earned when at least half the enabled members below agree with the trade's direction (2 of 3, 1 of 2, 1 of 1). If every member is switched off, this point removes itself from the denominator whatever this is set to.")
momRsi             = input.bool(true, "Momentum: RSI", group = "Confirmations", tooltip = "RSI above 50 for a long, below 50 for a short. This was 'Score: RSI' and was a point of its own; it is now a member of the Momentum vote.")
momMacd            = input.bool(true, "Momentum: MACD", group = "Confirmations", tooltip = "MACD line above its signal line for a long, below for a short.")
momStoch           = input.bool(true, "Momentum: Stochastic", group = "Confirmations", tooltip = "%K above %D for a long, below for a short. Read as a cross rather than an overbought/oversold level: in a trend the oscillator pins to its extreme and a level test would veto exactly the continuation setups this engine takes.")
macdFast           = input.int(12, "MACD Fast", minval = 1, group = "Confirmations")
macdSlow           = input.int(26, "MACD Slow", minval = 2, group = "Confirmations")
macdSignalLen      = input.int(9, "MACD Signal", minval = 1, group = "Confirmations")
stochLength        = input.int(14, "Stochastic %K Length", minval = 1, group = "Confirmations")
stochSmoothK       = input.int(3, "Stochastic %K Smoothing", minval = 1, group = "Confirmations")
stochDLength       = input.int(3, "Stochastic %D Length", minval = 1, group = "Confirmations")
scoreParticipation = input.bool(true, "Score: Participation", group = "Confirmations", tooltip = "One point for evidence that someone is actually trading at this level. On a symbol that reports no volume at all — many forex feeds — both members disable themselves and this point leaves the denominator.")
partVolume         = input.bool(true, "Participation: Volume Surge", group = "Confirmations", tooltip = "Volume on the bar that touched the zone, against its own recent average.")
partClimax         = input.bool(true, "Participation: Climax Candle", group = "Confirmations", tooltip = "An exhaustion bar AGAINST the trade in the last few bars — for a long, a heavy down bar closing on its low into support. That is the pullback spending itself, which is where the reversal starts. A heavy up bar before you buy a pullback means you are late, and does not earn this.")
volLen             = input.int(20, "Volume Average Length", minval = 1, group = "Confirmations")
volMult            = input.float(1.5, "Volume Surge (x average)", minval = 0.1, step = 0.1, group = "Confirmations")
climaxRangeMult    = input.float(2.0, "Climax Range (x ATR)", minval = 0.1, step = 0.1, group = "Confirmations", tooltip = "Uses the Structure ATR, so climax detection and the stop buffer are scaled by the same measure.")
climaxVolMult      = input.float(2.0, "Climax Volume (x average)", minval = 0.1, step = 0.1, group = "Confirmations")
climaxBars         = input.int(3, "Climax Lookback (bars)", minval = 1, maxval = 20, group = "Confirmations", tooltip = "Window ending at the current bar, inclusive. At 3 it covers this bar and the two before it.")
scoreIchimoku      = input.bool(true, "Score: Ichimoku", group = "Confirmations", tooltip = "One point when price sits clear of the cloud on the trade's side. Inside the cloud earns nothing — that is the region where the regime is undecided. Chikou is deliberately not used: it is displaced 26 bars backwards and would report confirmation that did not exist at the time.")
tenkanLen          = input.int(9, "Tenkan Length", minval = 1, group = "Confirmations")
kijunLen           = input.int(26, "Kijun Length", minval = 1, group = "Confirmations")
senkouBLen         = input.int(52, "Senkou B Length", minval = 1, group = "Confirmations")
ichiDisp           = input.int(26, "Ichimoku Displacement", minval = 1, maxval = 100, group = "Confirmations", tooltip = "How far forward the cloud is drawn — and how far back the score has to look to read the cloud you actually see at this bar.")
showKumo           = input.bool(false, "Show Kumo Cloud", group = "Confirmations", tooltip = "Off by default. The chart already carries swing tags, rays, break lines, order blocks, fair value gaps and a full trade box; the cloud is the only part of this block that can be drawn on a price overlay at all.")
showConfirmPanel   = input.bool(true, "Show Confirmation Panel Row", group = "Confirmations")
kumoBullColor      = input.color(color.new(color.green, 85), "Kumo Bullish", group = "Confirmations")
kumoBearColor      = input.color(color.new(color.red, 85), "Kumo Bearish", group = "Confirmations")
```

- [ ] **Step 4: Repoint the one `scoreRsi` reference**

In `scoreTally`, find:

```pinescript
    if scoreRsi
        ofPts += 1
        if isLong ? rsiBullishConfirm : rsiBearishConfirm
            got += 1
```

Replace with:

```pinescript
    if momRsi
        ofPts += 1
        if isLong ? rsiBullishConfirm : rsiBearishConfirm
            got += 1
```

This is temporary — Task 3 replaces this branch with the Momentum group. It exists so the file compiles and behaves identically at the end of this task.

- [ ] **Step 5: Read-back self-review**

Confirm by reading the file:
1. `scoreRsi` appears **nowhere** in the file (search for it).
2. Every new input name in the Interfaces block above is declared exactly once.
3. No new input's `group` string is misspelled — all read exactly `"Confirmations"`.
4. `minScore`'s default is `5` and its `minval`/`maxval` are unchanged at 1/15.
5. Every `input.float` has a `step`, and every numeric input has a `minval` that makes zero and negative values unreachable.
6. `climaxBars` has `minval = 1`, so `for i = 0 to climaxBars - 1` can never run descending.

- [ ] **Step 6: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add the Confirmations input group and rename the RSI point"
```

---

### Task 2: Compute the confirmation series

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — insert a new `CONFIRMATIONS` section between the watch-zone block and the trade gate.

**Interfaces:**
- Consumes: `rsiBullishConfirm`, `rsiBearishConfirm` (bools, defined just after the RSI/MA plots); `structAtr` (float, defined in the structure engine); every input from Task 1.
- Produces: globals `macdBullConfirm`, `macdBearConfirm`, `stochBullConfirm`, `stochBearConfirm`, `volumeSeen` (bool), `volAvg` (float), **`volReady` (bool — Task 3 gates both participation members on it)**, `volSurge` (bool), `climaxLong`, `climaxShort` (bools), `ichiSpanA`, `ichiSpanB` (floats, **undisplaced**), `ichiCloudTop`, `ichiCloudBottom` (floats, displaced), `ichiReady`, `ichiBullConfirm`, `ichiBearConfirm` (bools), and the function `climaxFound(bool isLong) => bool`.

**Why this section goes here.** It must sit after `structAtr` (the climax range test scales by it) and after `rsiBullishConfirm`, and before `scoreTally`. The gap between the watch-zone block and the trade gate is the only place all three hold.

- [ ] **Step 1: Insert the section**

Find these two lines:

```pinescript
bearishWatchZone = intState.trend == "down" and killzoneActive and not inBearishZone and not na(closestBearishDist) and closestBearishDist <= atrValue * watchZoneAtrMult

// ============================================================
// TRADE GATE
// ============================================================
```

Insert the whole block below **between** the `bearishWatchZone` line and the `// ====` / `TRADE GATE` comment:

```pinescript

// ============================================================
// CONFIRMATIONS
// ============================================================
// Placed here because the climax test scales by structAtr and the momentum test reuses the
// RSI confirms — both defined above — and everything here is read by scoreTally below.

// ---- momentum ----
[macdLine, macdSignalLine, _macdHist] = ta.macd(close, macdFast, macdSlow, macdSignalLen)
macdBullConfirm = macdLine > macdSignalLine
macdBearConfirm = macdLine < macdSignalLine

// %K/%D cross, not an overbought/oversold level: in a trend the oscillator pins to its
// extreme and a level test would veto the continuation setups this engine is built to take.
stochK = ta.sma(ta.stoch(close, high, low, stochLength), stochSmoothK)
stochD = ta.sma(stochK, stochDLength)
stochBullConfirm = stochK > stochD
stochBearConfirm = stochK < stochD

// ---- participation ----
// A latch, not a per-bar na test. A single legitimately-zero bar in a thin session must not
// disable the point for that bar alone: the denominator would flicker between /6 and /7 and
// change the grade for a reason that has nothing to do with the setup.
var bool volumeSeen = false
if not na(volume) and volume > 0
    volumeSeen := true

volAvg   = ta.sma(volume, volLen)
volReady = volumeSeen and not na(volAvg) and volAvg > 0
volSurge = volReady and volume >= volMult * volAvg

// Exhaustion, not displacement. For a long this looks for a heavy DOWN bar closing on its
// low — the pullback spending itself into support, which is where the reversal starts.
// The window ends at the current bar and includes it.
climaxFound(bool isLong) =>
    found = false
    for i = 0 to climaxBars - 1
        rng = high[i] - low[i]
        if rng > 0 and volReady and not na(structAtr)
            against  = isLong ? close[i] < open[i] : close[i] > open[i]
            farThird = isLong ? close[i] <= low[i] + rng / 3 : close[i] >= high[i] - rng / 3
            bigRange = rng >= climaxRangeMult * structAtr
            bigVol   = volume[i] >= climaxVolMult * volAvg
            if against and farThird and bigRange and bigVol
                found := true
    found

climaxLong  = climaxFound(true)
climaxShort = climaxFound(false)

// ---- ichimoku ----
ichiTenkan = math.avg(ta.highest(high, tenkanLen), ta.lowest(low, tenkanLen))
ichiKijun  = math.avg(ta.highest(high, kijunLen), ta.lowest(low, kijunLen))
ichiSpanA  = math.avg(ichiTenkan, ichiKijun)
ichiSpanB  = math.avg(ta.highest(high, senkouBLen), ta.lowest(low, senkouBLen))

// The cloud drawn AT this bar was computed ichiDisp bars ago, so the score reads the delayed
// series. Comparing close to the undisplaced span would compare price against a cloud that
// will not be drawn for another 26 bars. Chikou is not computed at all: displaced backwards,
// it reports confirmation that did not exist at the time.
ichiCloudTop    = math.max(ichiSpanA[ichiDisp], ichiSpanB[ichiDisp])
ichiCloudBottom = math.min(ichiSpanA[ichiDisp], ichiSpanB[ichiDisp])
ichiReady       = not na(ichiCloudTop) and not na(ichiCloudBottom)
ichiBullConfirm = ichiReady and close > ichiCloudTop
ichiBearConfirm = ichiReady and close < ichiCloudBottom

// Data Window readouts — the verification surface for this block.
plot(macdBullConfirm ? 1 : macdBearConfirm ? -1 : 0, "DBG MACD (1/-1/0)", display = display.data_window)
plot(stochBullConfirm ? 1 : stochBearConfirm ? -1 : 0, "DBG Stoch (1/-1/0)", display = display.data_window)
plot(volumeSeen ? 1 : 0, "DBG Volume Available (1/0)", display = display.data_window)
plot(volSurge ? 1 : 0, "DBG Volume Surge (1/0)", display = display.data_window)
plot(climaxLong ? 1 : 0, "DBG Climax Long (1/0)", display = display.data_window)
plot(climaxShort ? 1 : 0, "DBG Climax Short (1/0)", display = display.data_window)
plot(ichiBullConfirm ? 1 : ichiBearConfirm ? -1 : 0, "DBG Ichimoku (1/-1/0)", display = display.data_window)
```

- [ ] **Step 2: Read-back self-review**

Confirm by reading the file:
1. `climaxFound`'s last statement is the bare expression `found` — not the `for` loop, which would be a compile error.
2. The `for` loop's bound is `climaxBars - 1` with `climaxBars` at `minval = 1`, so the range is never descending.
3. No array access appears anywhere in this block, so the non-short-circuit `and` rule cannot bite.
4. `volAvg`, `structAtr` and the cloud values are all `na`-guarded before being compared.
5. `ichiSpanA` and `ichiSpanB` are stored **undisplaced**; only `ichiCloudTop`/`ichiCloudBottom` apply `[ichiDisp]`. Task 4 needs the undisplaced series for `plot(..., offset = ichiDisp)`.
6. The tuple `[macdLine, macdSignalLine, _macdHist]` is destructured at **global scope**, not inside a block.
7. `climaxLong` uses `climaxFound(true)` and `climaxShort` uses `climaxFound(false)`.
8. Read the climax sign logic once more against the spec: for a long, `close[i] < open[i]` (a down bar) and `close[i] <= low[i] + rng / 3` (closing near its low). If that reads backwards to you, it is correct and the spec explains why.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: compute MACD, Stochastic, volume, climax and Ichimoku series"
```

---

### Task 3: Three grouped points and fractional grades

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add group-vote globals to the end of the `CONFIRMATIONS` section; add three branches to `scoreTally`; replace `gradeFor`.

**Interfaces:**
- Consumes: everything Task 2 produced; `scoreMomentum`, `scoreParticipation`, `scoreIchimoku`, `momRsi`, `momMacd`, `momStoch`, `partVolume`, `partClimax` from Task 1.
- Produces: globals `momOn`, `momLongOk`, `momShortOk`, `partOn`, `partLongOk`, `partShortOk`, `ichiOn` (all bools). `momEnabledCount`, `momNeed`, `momLongHits`, `momShortHits`, `partVolOn`, `partClimaxOn`, `partEnabledCount`, `partNeed`, `partLongHits`, `partShortHits` are intermediates of this task and are not read anywhere else. `gradeFor(int score, int ofPoints) => string` keeps its signature.

**Why the votes are flat globals.** The natural shape is a tuple-returning `groupVote()` helper called inside `scoreTally`. Do not write that: this plan does not rely on tuple destructuring inside a function body or an `if` block. Flat scalars computed at global scope are unambiguous and match the existing file's style.

This task must land as one commit. Adding the points without rescaling the grades would ship a gate where `minScore` 5 of 7 grades as `C` under the old "two short" rule while the old 5-point defaults graded it `A` — a real intermediate wrong state.

- [ ] **Step 1: Append the group votes to the CONFIRMATIONS section**

Insert immediately after the `DBG Ichimoku` plot line added in Task 2:

```pinescript

// ---- group votes ----
// At least half the enabled members, rounded up: 2 of 3, 1 of 2, 1 of 1. Never a strict
// majority — that needs 2 of 2 but only 2 of 3, so switching a member OFF would make the
// point EASIER to earn, which is the same class of bug the proportional denominator exists
// to prevent. math.ceil takes a float and returns an int; int/int division is not relied on.
momEnabledCount = (momRsi ? 1 : 0) + (momMacd ? 1 : 0) + (momStoch ? 1 : 0)
momNeed         = math.ceil(momEnabledCount / 2.0)
momLongHits     = (momRsi and rsiBullishConfirm ? 1 : 0) + (momMacd and macdBullConfirm ? 1 : 0) + (momStoch and stochBullConfirm ? 1 : 0)
momShortHits    = (momRsi and rsiBearishConfirm ? 1 : 0) + (momMacd and macdBearConfirm ? 1 : 0) + (momStoch and stochBearConfirm ? 1 : 0)
momOn           = scoreMomentum and momEnabledCount > 0
momLongOk       = momLongHits >= momNeed
momShortOk      = momShortHits >= momNeed

// Both participation members need real volume data, so both disable themselves on a symbol
// that has never reported any — and the point then leaves the denominator entirely.
partVolOn        = partVolume and volReady
partClimaxOn     = partClimax and volReady
partEnabledCount = (partVolOn ? 1 : 0) + (partClimaxOn ? 1 : 0)
partNeed         = math.ceil(partEnabledCount / 2.0)
partLongHits     = (partVolOn and volSurge ? 1 : 0) + (partClimaxOn and climaxLong ? 1 : 0)
partShortHits    = (partVolOn and volSurge ? 1 : 0) + (partClimaxOn and climaxShort ? 1 : 0)
partOn           = scoreParticipation and partEnabledCount > 0
partLongOk       = partLongHits >= partNeed
partShortOk      = partShortHits >= partNeed

// Excluded until the cloud exists at all — senkouB needs senkouBLen + ichiDisp bars of
// history, and a permanently-dark point in the denominator would grade early setups
// harshly for a reason that says nothing about them.
ichiOn = scoreIchimoku and ichiReady

plot(momOn ? 1 : 0, "DBG Momentum Point Enabled (1/0)", display = display.data_window)
plot(partOn ? 1 : 0, "DBG Participation Point Enabled (1/0)", display = display.data_window)
plot(ichiOn ? 1 : 0, "DBG Ichimoku Point Enabled (1/0)", display = display.data_window)
```

- [ ] **Step 2: Replace the RSI branch in `scoreTally` with the Momentum group**

Find the branch Task 1 left behind:

```pinescript
    if momRsi
        ofPts += 1
        if isLong ? rsiBullishConfirm : rsiBearishConfirm
            got += 1
```

Replace it with:

```pinescript
    if momOn
        ofPts += 1
        if isLong ? momLongOk : momShortOk
            got += 1
```

- [ ] **Step 3: Add the Participation and Ichimoku branches**

In the same function, find the final branch and its return:

```pinescript
    if scoreBreakStrength
        ofPts += 1
        if not na(intState.lastStrength) and intState.lastStrength >= strongBreakMult
            got += 1
    [ofPts, got]
```

Replace with:

```pinescript
    if scoreBreakStrength
        ofPts += 1
        if not na(intState.lastStrength) and intState.lastStrength >= strongBreakMult
            got += 1
    if partOn
        ofPts += 1
        if isLong ? partLongOk : partShortOk
            got += 1
    if ichiOn
        ofPts += 1
        if isLong ? ichiBullConfirm : ichiBearConfirm
            got += 1
    [ofPts, got]
```

- [ ] **Step 4: Update the comment above `scoreTally`**

Find:

```pinescript
// One pass counts the enabled points and the achieved points together. Declaring a point in
// only one of two parallel lists was the failure this prevents — and the confirmation block
// still to come adds five more points to this function.
```

Replace with:

```pinescript
// One pass counts the enabled points and the achieved points together. Declaring a point in
// only one of two parallel lists was the failure this prevents. Seven points now: the
// confirmation block added three, not five, because RSI/MACD/Stochastic share one vote.
```

- [ ] **Step 5: Replace `gradeFor` with the fractional version**

Find:

```pinescript
// All enabled points = A, one short = B, two short = C. Which grades can actually appear
// depends on minScore: at the defaults (5 enabled, minScore 4) a C scores 3 and is rejected,
// so only A and B ever show. Lowering minScore to 3 is what opens C up.
gradeFor(int score, int ofPoints) =>
    score >= ofPoints ? "A" : score >= ofPoints - 1 ? "B" : "C"
```

Replace with:

```pinescript
// Grades are a fraction of the enabled points: A at 90%, B at 75%, C otherwise. Absolute
// shortfall did not scale — "two short" is 3/5 on one chart and 8/10 on another, and both
// graded C. Integer arithmetic, so no float rounding sits between a setup and its grade.
//
// At five enabled points this reproduces the old rule exactly (5=A, 4=B, 3=C), which is what
// makes the change safe; the two only diverge once the denominator moves. C is the fallback
// branch rather than a threshold — minScore is what stops a weak setup reaching the chart at
// all. At seven points with minScore 5, the lowest grade that can appear is 5/7.
gradeFor(int score, int ofPoints) =>
    score * 100 >= 90 * ofPoints ? "A" : score * 100 >= 75 * ofPoints ? "B" : "C"
```

- [ ] **Step 6: Read-back self-review**

Confirm by reading the file:
1. `scoreTally` now has **seven** `ofPts += 1` sites: killzone, momentum, MA, major agreement, break strength, participation, Ichimoku.
2. Every one of the seven increments `ofPts` **unconditionally inside its own `if`**, and increments `got` only inside a nested `if`. No branch can add to `got` without having added to `ofPts`.
3. `scoreTally`'s last statement is still the tuple expression `[ofPts, got]`.
4. No tuple is destructured inside a function body or an `if` block anywhere in the new code.
5. Hand-check the grade table. With `ofPoints = 5`: score 5 → `500 >= 450` A; score 4 → `400 >= 450` false, `400 >= 375` B; score 3 → `300 >= 375` false, C. Matches the old rule exactly.
6. With `ofPoints = 7`: score 7 → `700 >= 630` A; score 6 → `600 >= 630` false, `600 >= 525` B; score 5 → `500 >= 525` false, C.
7. `momNeed` and `partNeed` divide by `2.0`, not `2`.
8. `partLongHits` and `partShortHits` both use the direction-independent `volSurge`, and differ only in `climaxLong` versus `climaxShort`.

- [ ] **Step 7: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: score momentum, participation and Ichimoku; grade by fraction"
```

---

### Task 4: The Kumo cloud

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add two plots and a fill in the rendering area.

**Interfaces:**
- Consumes: `ichiSpanA`, `ichiSpanB` (undisplaced, from Task 2); `showKumo`, `ichiDisp`, `kumoBullColor`, `kumoBearColor` (Task 1).
- Produces: nothing consumed by later tasks.

**Why the plots are unconditional.** `plot()` must be called at global scope on every bar — it cannot be wrapped in `if showKumo`. The toggle works by plotting `na`, which draws nothing and leaves the fill with nothing to fill between.

- [ ] **Step 1: Add the cloud**

Insert at the **end of the `CONFIRMATIONS` section**, after the three `DBG ... Point Enabled` plots from Task 3:

```pinescript

// ---- the cloud ----
// plot() cannot live inside an `if`, so the toggle plots na instead: nothing is drawn and the
// fill has nothing to fill between. `offset` draws the spans forward, which is what makes the
// cloud visible at this bar the one computed ichiDisp bars ago — the same series the score
// reads back through [ichiDisp].
kumoPlotA = plot(showKumo ? ichiSpanA : na, "Senkou A", color = color.new(color.green, 60), offset = ichiDisp)
kumoPlotB = plot(showKumo ? ichiSpanB : na, "Senkou B", color = color.new(color.red, 60), offset = ichiDisp)
fill(kumoPlotA, kumoPlotB, color = ichiSpanA > ichiSpanB ? kumoBullColor : kumoBearColor, title = "Kumo")
```

- [ ] **Step 2: Read-back self-review**

Confirm by reading the file:
1. Both `plot()` calls and the `fill()` are at column 0 — global scope, not nested in any block.
2. Both plots use the **undisplaced** `ichiSpanA`/`ichiSpanB` with `offset = ichiDisp`. Passing the already-delayed `ichiCloudTop` here would displace the cloud twice.
3. `offset` is given `ichiDisp`, an `input.int` — acceptable where `plot` wants a simple int. It is not a series value.
4. The `fill` references the two plot IDs returned by the calls immediately above it.
5. Nothing else in the file draws when `showKumo` is off.

- [ ] **Step 3: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: draw the Ichimoku cloud behind price, off by default"
```

---

### Task 5: The panel row, and re-indexing the trade rows

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — the `structPanel` construction block.

**Interfaces:**
- Consumes: `momOn`, `momLongOk`, `momShortOk`, `partOn`, `partLongOk`, `partShortOk`, `ichiOn` (Task 3); `ichiBullConfirm`, `ichiBearConfirm` (Task **2**); `showConfirmPanel` (Task 1); `intState` (existing).
- Produces: nothing consumed by later tasks.

**Why the trade rows have to move.** The panel is built as `table.new(panelPos, 2, 5 + tradeRows)` and the trade block writes to **hardcoded** row indices 5 through 10. Inserting a row above them silently overwrites the `TRADE` header. The trade rows must take their numbers from a base offset.

The row reports the **current bar's** state, not a stored setup's. `setupGradeVal` and friends reset every bar and are only populated on a bar where a setup actually fires, so a row driven by them would be blank almost always. Live state is what is useful on the last bar.

- [ ] **Step 1: Build the confirmation text and re-index the trade rows**

Find this block (it begins after `internalText` is computed):

```pinescript
        tradeRows = 0
        if showTradePanel and tradeIsLive()
            tradeRows := 6
        structPanel := table.new(panelPos, 2, 5 + tradeRows, bgcolor = color.new(color.black, 80), border_width = 1)
```

Replace with:

```pinescript
        // Reads the current bar for the internal trend's direction — the same tier the gate
        // reads. Undefined trend falls back to the long side so the row is never blank.
        confirmLong = intState.trend != "down"
        momMark     = not momOn ? "–" : (confirmLong ? momLongOk : momShortOk) ? "✓" : "✗"
        partMark    = not partOn ? "–" : (confirmLong ? partLongOk : partShortOk) ? "✓" : "✗"
        ichiMark    = not ichiOn ? "–" : (confirmLong ? ichiBullConfirm : ichiBearConfirm) ? "✓" : "✗"
        confirmText = "Mom " + momMark + " · Part " + partMark + " · Ichi " + ichiMark
        confirmRows = showConfirmPanel ? 1 : 0
        tradeRows = 0
        if showTradePanel and tradeIsLive()
            tradeRows := 6
        structPanel := table.new(panelPos, 2, 5 + confirmRows + tradeRows, bgcolor = color.new(color.black, 80), border_width = 1)
```

- [ ] **Step 2: Write the confirmation row and set the trade base**

Find the line that ends the five structure rows and the `if` that opens the trade block:

```pinescript
        table.cell(structPanel, 0, 4, "Internal", text_color = color.silver)
        table.cell(structPanel, 1, 4, internalText, text_color = color.aqua)
        if tradeRows > 0
```

Replace with:

```pinescript
        table.cell(structPanel, 0, 4, "Internal", text_color = color.silver)
        table.cell(structPanel, 1, 4, internalText, text_color = color.aqua)
        if confirmRows > 0
            table.cell(structPanel, 0, 5, "Confirm", text_color = color.silver)
            table.cell(structPanel, 1, 5, confirmText, text_color = color.white)
        tradeBase = 5 + confirmRows
        if tradeRows > 0
```

- [ ] **Step 3: Renumber the six trade rows**

Inside that `if tradeRows > 0` block, the six row pairs are written at literal indices 5, 6, 7, 8, 9 and 10. Change **only the row-index argument** of all twelve `table.cell` calls, leaving every other argument exactly as it is:

| Was | Becomes |
|---|---|
| `, 5,` (the `TRADE` header pair) | `, tradeBase,` |
| `, 6,` (`Entry`) | `, tradeBase + 1,` |
| `, 7,` (`Stop`) | `, tradeBase + 2,` |
| `, 8,` (`TP1 / TP2`) | `, tradeBase + 3,` |
| `, 9,` (`TP3`) | `, tradeBase + 4,` |
| `, 10,` (`Open R`) | `, tradeBase + 5,` |

Each index appears twice — once with column `0` and once with column `1`. Twelve edits in total.

- [ ] **Step 4: Read-back self-review**

Confirm by reading the file:
1. No literal row index above `4` remains anywhere in the trade block — search for `, 5,` through `, 10,` inside it and confirm all twelve are gone.
2. The table's declared height is `5 + confirmRows + tradeRows`, and the highest row index actually written is `tradeBase + 5` = `5 + confirmRows + 5`, which is exactly one less than the height when `tradeRows` is 6. No off-by-one.
3. With `showConfirmPanel` off, `confirmRows` is 0 and `tradeBase` is 5 — byte-for-byte the old layout.
4. `confirmText` is built before `table.new`, and every variable it reads is in scope at that point.
5. `confirmLong` uses `intState.trend != "down"`, so an undefined trend takes the long side rather than producing a blank.
6. The three marks use `–` (en dash) for disabled, distinct from `✗` for enabled-but-unmet.

- [ ] **Step 5: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine
git commit -m "feat: add the confirmation panel row and re-index the trade rows"
```

---

### Task 6: README

**Files:**
- Modify: `README.md` — the intro line, the qualification diagram, the score explanation, and the settings tables.

**Interfaces:**
- Consumes: the finished behaviour of Tasks 1–5.
- Produces: nothing.

**Why this is its own task.** The standing rule in this repo is that the README ships with the code that changes it. It is last because it documents behaviour that has to exist first, and it is separate because a reviewer can reasonably reject the prose while accepting the code.

- [ ] **Step 1: Fix the "five conditions" line**

Find:

```markdown
It never tells you to buy. It marks a bar where five separate conditions happened to agree, and
leaves the decision to you.
```

Replace with:

```markdown
It never tells you to buy. It marks a bar where several independent conditions happened to agree,
grades how many, and leaves the decision to you.
```

- [ ] **Step 2: Update the qualification diagram**

In *The trade engine → How a setup qualifies*, find the `SCORED — one point each` subgraph:

```
    subgraph S["SCORED — one point each"]
        S1["Killzone active"]
        S2["RSI on side"]
        S3["Price on side of MA"]
        S4["Major trend agrees"]
        S5["Break was strong"]
    end
```

Replace with:

```
    subgraph S["SCORED — one point each"]
        S1["Killzone active"]
        S2["<b>Momentum</b><br/>RSI · MACD · Stochastic<br/><i>majority of those enabled</i>"]
        S3["Price on side of MA"]
        S4["Major trend agrees"]
        S5["Break was strong"]
        S6["<b>Participation</b><br/>volume surge · climax<br/><i>either</i>"]
        S7["<b>Ichimoku</b><br/>price clear of the cloud"]
    end
```

- [ ] **Step 3: Rewrite the score paragraph**

Find the paragraph beginning `**The score is out of however many points you switch on, not a fixed five.**` and replace the whole paragraph, up to and including the `Set Minimum Score equal to...` line, with:

```markdown
**The score is out of however many points you switch on, not a fixed seven.** That is deliberate.
Killzones mean nothing on a single-session market like EGX, so if killzone were a mandatory veto the
indicator would go permanently silent there. Switch the killzone point off and the panel reads `5/6`
instead of `5/7` — the threshold adjusts rather than quietly loosening. The same happens
automatically for points that cannot apply: turn off both killzone sessions and the killzone point
removes itself, and on a symbol that reports no volume at all the participation point removes itself.

**Three of the five confirmations share votes, on purpose.** RSI, MACD and Stochastic all measure
momentum from the same price series — counted separately they would cast three of nine votes for
what is really one opinion, and a setup could clear the threshold on momentum agreeing with itself.
They share the Momentum point, earned when at least half the enabled ones agree. Volume and the
climax candle share Participation the same way.

**Grades are a fraction of the enabled points** — A at 90%, B at 75%, C below that. So a grade means
the same thing whether you run four points or seven.

Set `Minimum Score` equal to the number of enabled points to get the strictest possible behaviour.

> **Upgrading from an earlier version?** `Minimum Score` now defaults to 5, because 4 out of seven
> points is a *looser* gate than the 4 out of five it used to mean. TradingView keeps the value saved
> on your chart, so if yours still reads 4, raise it by hand.
```

- [ ] **Step 4: Update the Trade Engine settings table**

In the **Trade Engine** settings table, change the `Minimum Score` row's default from `4` to `5`, and delete the `Score: RSI / Moving Average` row, replacing it with:

```markdown
| Score: Moving Average | on | Whether price is on the trade's side of the MA |
```

- [ ] **Step 5: Add the Confirmations settings table**

Immediately after the Trade Engine settings table, insert:

```markdown
**Confirmations** — three more scored points, five indicators.

| Setting | Default | What it does |
|---|---|---|
| Score: Momentum | on | One point for RSI, MACD and Stochastic together — earned when at least half the enabled ones agree (2 of 3, 1 of 2) |
| Momentum: RSI / MACD / Stochastic | on | Which indicators are members of that vote. Turn all three off and the point leaves the denominator |
| MACD Fast / Slow / Signal | 12 / 26 / 9 | Standard settings |
| Stochastic %K / Smoothing / %D | 14 / 3 / 3 | Read as a %K/%D cross, not an overbought level — in a trend the oscillator pins to its extreme and a level test would veto every continuation |
| Score: Participation | on | One point for evidence someone is actually trading here |
| Participation: Volume Surge | on | Volume on the bar that touched the zone, against its own average |
| Participation: Climax Candle | on | An exhaustion bar **against** the trade — for a long, a heavy down bar closing on its low into support. That is the pullback spending itself |
| Volume Surge (× average) | 1.5 | How far above average counts as a surge |
| Climax Range (× ATR) / Volume (× average) / Lookback | 2.0 / 2.0 / 3 | How big an exhaustion bar has to be, and how recently it can have printed |
| Score: Ichimoku | on | One point when price is clear of the cloud on the trade's side. Inside the cloud earns nothing |
| Tenkan / Kijun / Senkou B / Displacement | 9 / 26 / 52 / 26 | Standard settings |
| Show Kumo Cloud | **off** | The only thing this section draws |
| Show Confirmation Panel Row | on | Adds `Mom ✓ · Part — · Ichi ✓` to the panel, so you can see which points carried a setup |

Chikou is deliberately absent: it is the close displaced 26 bars *backwards*, so scoring on it would
report confirmation that was not available at the time. MACD and Stochastic are never plotted —
this script draws on the price chart, and an oscillator has no pane to live in here.
```

- [ ] **Step 6: Update the panel-reading section**

In *Reading the trade panel*, find the sentence beginning `The structure panel grows extra rows while a trade is live` and insert this paragraph directly before it:

```markdown
The panel carries a `Confirm` row showing the three confirmation points for the current bar —
`Mom ✓ · Part — · Ichi ✓`. A dash means the point is switched off or cannot apply; a cross means it
applies and is not met. `5/7` tells you a setup was adequate, but the row tells you *which* points
carried it, which is the part you can act on.
```

- [ ] **Step 7: Read-back self-review**

Confirm by reading the file:
1. No occurrence of "five separate conditions", "fixed five", or "four conditions" survives anywhere in the README.
2. Every default quoted in the new tables matches the Global Constraints list at the top of this plan, value for value.
3. The mermaid subgraph still parses — quotes balanced, `<br/>` tags closed, no stray `|`.
4. The hard-four block in the same diagram is unchanged.
5. The claim that Ichimoku is drawn appears only alongside "off by default".

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: document the confirmation stack"
```

---

## Deferred human verification (TradingView)

None of the above can be compiled in this environment. Paste `src/ict-rsi-ma-indicator.pine` into the
Pine Editor and work through this list, reading state from the Data Window rather than eyeballing the
chart. The `DBG` series added in Tasks 2 and 3 exist for exactly this.

- [ ] It compiles.
- [ ] At defaults the panel denominator reads `/7`, and the fraction matches the ticks in the `Confirm` row.
- [ ] Turn off all three momentum members: `DBG Momentum Point Enabled` drops to 0 and the denominator reads `/6`, with `Score: Momentum` still on.
- [ ] Leave one momentum member on: the point needs that one alone (1 of 1).
- [ ] With all three on, find a bar where exactly two agree and confirm the point is earned; find one where exactly one agrees and confirm it is not.
- [ ] Load a forex or index symbol with no volume: `DBG Volume Available` reads 0, the denominator reads `/6`, and no error appears.
- [ ] Find a heavy down bar closing on its low, into a bullish zone: `DBG Climax Long` reads 1. Confirm a heavy **up** bar in the same place leaves it at 0.
- [ ] Switch `Show Kumo Cloud` on. Confirm `DBG Ichimoku` reads 0 on every bar where price sits inside the drawn cloud, and ±1 only when price is clear of it.
- [ ] Pick a bar and check the displacement by hand: the cloud values the score used are the ones drawn at that bar, not the ones 26 bars to the right.
- [ ] Disable all three confirmation points. Confirm the denominator returns to `/5` and grades match the old behaviour exactly — 5=A, 4=B, 3=C.
- [ ] With seven points, confirm `minScore` 5 rejects a 4/7 setup, and that raising it to 7 admits only A grades.
- [ ] Open a trade and confirm the panel renders correctly with both the `Confirm` row and all six trade rows — no overwritten header, no blank row.
- [ ] Turn `Show Confirmation Panel Row` off while a trade is live and confirm the trade rows still render.
- [ ] With `Show Kumo Cloud` off, confirm nothing new is drawn anywhere.
- [ ] Scroll back over a long history and confirm no new "too many objects" error.
