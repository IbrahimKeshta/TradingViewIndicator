# Gann Time Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw vertical Gann time-cycle lines forward from each of the two anchors, and add a separate Cycle/Date/Status table listing every cycle's projected date and whether it has arrived.

**Architecture:** Time cycles are a **render-only** feature. A target bar is `anchorBar + N` for nine fixed cycle numbers, and a cycle's status is `bar_index >= targetBar` — both pure functions of state that already exists. There is no new `var` state, no rebuild-on-re-anchor step and no touch tracking. Lines and labels are created inside the existing `barstate.islast` block and pushed into the existing `drawnLines` / `drawnLabels` arrays, so the current delete-and-clear cleanup removes them with no changes. The time table is a second, independent `table` so it never competes with the price table's row budget.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-06-gann-time-lines-design.md`

**Starting point:** `src/gann-angles.pine` at commit `1cfa597`. This plan modifies that file in place and is purely additive: no existing input, function, level, line, label or table row changes behaviour. If a step finds itself altering existing level/anchor/table logic, that is a mistake — stop and re-read.

## Global Constraints

- Declaration becomes: `indicator("Gann Angles", shorttitle = "GannAngles", overlay = true, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 10, max_bars_back = 500)` — only `max_bars_back` is added; the three count limits are unchanged.
- **`max_bars_back = 500` is load-bearing, not cosmetic.** Both new helpers index history with a *dynamic* offset (`time[safeOffset]`, `time[barSpanN]`). Pine cannot always infer a buffer for those and raises a runtime error rather than returning `na`. Every dynamic offset in this plan is additionally clamped to `≤ 500` so it can never exceed the declared buffer.
- Fixed cycle list, in this order: `30, 45, 60, 90, 120, 144, 180, 270, 360`. Majors are the squares of 90 — `90, 180, 270, 360`; the other five are minors. Both sides use the same nine numbers.
- **Time lines are independent of `Mode`.** They must not be gated on `squareReady`, `squareBlocked`, or `modeInput` in any form. A side draws its cycles whenever that side's anchor is ready, in all three modes.
- **Time lines are independent of the level toggles.** They must not be gated on `showBullish` / `showBearish`. `showBearish` defaults to `false`, so coupling them would hide half the feature out of the box. They are gated on `showTimeLines and show<Side>TimeLines and <side>AnchorReady`.
- A side's time-table rows and its time lines use the **same** visibility condition, so the table can never list a cycle with no line or omit one that has a line.
- Vertical lines are drawn `line.new(targetBar, high, targetBar, low, extend = extend.both)` — `x1 == x2` plus `extend.both` is what produces a full-height vertical. The `high`/`low` y-arguments are placeholders; only x matters.
- **No clamping of `targetBar` is needed or wanted.** An anchor bar is never in the future, so the furthest target is `bar_index + 360`, inside Pine's 500-bar forward drawing limit. Do not copy the Gann Square's width clamp here.
- Date column: exact `time[offset]` when `0 <= offset <= 500`; otherwise an extrapolation from *measured* bar spacing, prefixed `~`. Spacing must come from `(time - time[barSpanN]) / barSpanN`, **never** from `timeframe.in_seconds()` alone except as the `bar_index < 20` fallback — the timeframe-derived figure treats a daily bar as 24h and misplaces T+360 by roughly five months.
- This change is purely additive. No existing behaviour changes.
- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` block as the final statement is a compile error. Every new function must end on an expression.
- **Loop-direction footgun:** `for i = X to Y` where `Y` can be less than `X` at runtime does NOT skip — Pine runs it descending. All new loops are the fixed `for i = 0 to 8` over the nine-element cycle arrays, matching how `buildFan` and `buildSquareLevels` already iterate the nine-element ratio arrays.
- Pine renders only **one table per screen position**. `Time Table Position` defaults to `Bottom Right` against the price table's `Top Right` for that reason; the collision is documented in a tooltip, not prevented in code.
- Object budget after this change, worst case (Square of 9, 3 rings, both sides, all time lines): 98 + 18 = **116 lines**, 100 + 18 = **118 labels**, 1 box, 2 tables. Under the declared 200 / 200 / 10.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Inputs, cycle tables, and date helpers

**Files:**
- Modify: `src/gann-angles.pine` — the `indicator()` declaration (line 2), the INPUTS section (two insertions), the area after the RATIO TABLE section, and the HELPERS section.

**Interfaces:**
- Consumes: nothing new. `time`, `bar_index`, `timeframe.in_seconds()`, `syminfo.timezone` are Pine built-ins.
- Produces: inputs `showTimeLines`, `showBullTimeLines`, `showBearTimeLines`, `showTimeTable`, `timeTablePosInput`, `bullTimeColor`, `bearTimeColor`, `timeMajorStyle`, `timeMajorWidth`, `timeMinorStyle`, `timeMinorWidth`; arrays `timeCycles` (`int[]`, 9 elements) and `timeCycleIsMajor` (`bool[]`, 9 elements); series `avgBarMs` (`float`); functions `cycleTimeMs(int targetBar, float spacingMs) => int` and `cycleDateText(int targetBar, float spacingMs) => string`.

- [ ] **Step 1: Add `max_bars_back` to the declaration**

Replace line 2 of `src/gann-angles.pine` — the whole `indicator(...)` line — with:

```pinescript
indicator("Gann Angles", shorttitle = "GannAngles", overlay = true, max_lines_count = 200, max_labels_count = 200, max_boxes_count = 10, max_bars_back = 500)
```

- [ ] **Step 2: Insert the Gann Time input group**

Find the `// ---------------- Square of 9 ----------------` block and the `scaleFactor = input.float(...)` line that ends it. Immediately after that line, insert a blank line then:

```pinescript
// ---------------- Gann Time ----------------
showTimeLines     = input.bool(true, "Show Time Lines", group = "Gann Time", tooltip = "Master switch for the vertical cycle lines at 30/45/60/90/120/144/180/270/360 bars forward from each anchor bar. Independent of Mode — cycles draw in all three.")
showBullTimeLines = input.bool(true, "Bullish Time Lines", group = "Gann Time", tooltip = "Independent of Show Bullish Levels.")
showBearTimeLines = input.bool(true, "Bearish Time Lines", group = "Gann Time", tooltip = "Independent of Show Bearish Levels.")
showTimeTable     = input.bool(true, "Show Time Table", group = "Gann Time")
timeTablePosInput = input.string("Bottom Right", "Time Table Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Gann Time", tooltip = "Pine draws only one table per screen position. Keep this different from Table Position or one table will hide the other.")
```

The `// ---------------- Bullish Style ----------------` block must still follow immediately after.

- [ ] **Step 3: Insert the Time Style input group**

Find the `bearStartWidth = input.int(...)` line that ends the `// ---------------- Bearish Style ----------------` block. Immediately after that line, insert a blank line then:

```pinescript
// ---------------- Time Style ----------------
bullTimeColor  = input.color(color.blue, "Bull Time Color", group = "Time Style")
bearTimeColor  = input.color(color.purple, "Bear Time Color", group = "Time Style")
timeMajorStyle = input.string("Solid", "Major Style", options = ["Solid", "Dashed", "Dotted"], group = "Time Style", inline = "timeMaj")
timeMajorWidth = input.int(1, "", minval = 1, maxval = 4, group = "Time Style", inline = "timeMaj")
timeMinorStyle = input.string("Dotted", "Minor Style", options = ["Solid", "Dashed", "Dotted"], group = "Time Style", inline = "timeMin")
timeMinorWidth = input.int(1, "", minval = 1, maxval = 4, group = "Time Style", inline = "timeMin")
```

The `// ---------------- Display ----------------` block must still follow immediately after.

The two width inputs carry an empty title because they share an `inline` row with their style dropdown — the same convention the existing `Bullish Style` and `Bearish Style` groups use. The spec's input table names them `Major Width` / `Minor Width`; those are the fields, not on-screen labels.

- [ ] **Step 4: Insert the TIME CYCLES section**

Find the `RATIO TABLE` section and the `ratioIsPrimary` line that ends it. Immediately after that line, insert a blank line then:

```pinescript
// ============================================================
// TIME CYCLES
// ============================================================
var int[]  timeCycles       = array.from(30, 45, 60, 90, 120, 144, 180, 270, 360)
var bool[] timeCycleIsMajor = array.from(false, false, false, true, false, false, true, true, true)

// Measured bar spacing, in ms. Computed globally on every bar so its history is
// always consistent, then passed into the date helpers by value.
barSpanN = math.min(bar_index, 200)
avgBarMs = barSpanN >= 20 ? float(time - time[barSpanN]) / barSpanN : float(timeframe.in_seconds() * 1000)
```

- [ ] **Step 5: Add the date helpers to the HELPERS section**

Find the `passesFilter(...)` function in the `HELPERS` section and its single-expression body line. Immediately after that line, insert a blank line then:

```pinescript
// Timestamp of a cycle's target bar. Exact when the bar exists and is inside the
// declared 500-bar buffer; otherwise extrapolated from measured spacing. The offset
// is clamped before it indexes history so it can never exceed the buffer, and can
// never exceed bar_index because targetBar is never negative.
cycleTimeMs(int targetBar, float spacingMs) =>
    offset     = bar_index - targetBar
    safeOffset = math.max(0, math.min(offset, 500))
    exactTime  = time[safeOffset]
    estTime    = time + int(math.round((targetBar - bar_index) * spacingMs))
    offset >= 0 and offset <= 500 ? exactTime : estTime

// Date cell text. A "~" prefix marks an extrapolated date, never an exact one.
cycleDateText(int targetBar, float spacingMs) =>
    offset  = bar_index - targetBar
    isExact = offset >= 0 and offset <= 500
    (isExact ? "" : "~") + str.format_time(cycleTimeMs(targetBar, spacingMs), "yyyy-MM-dd", syminfo.timezone)
```

- [ ] **Step 6: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. The declaration carries `max_bars_back = 500` **and** still carries `max_lines_count = 200`, `max_labels_count = 200`, `max_boxes_count = 10`. Adding one must not drop another.
2. `timeCycles` has exactly 9 elements reading `30, 45, 60, 90, 120, 144, 180, 270, 360`, and `timeCycleIsMajor` has exactly 9 reading `false, false, false, true, false, false, true, true, true`. Check them position by position: the `true` entries must line up with 90, 180, 270 and 360 and nothing else.
3. `avgBarMs` is declared at **global scope**, not inside any `if` block. A conditionally-evaluated series has an inconsistent history buffer, which would silently corrupt the spacing figure.
4. `avgBarMs` cannot divide by zero: state why `barSpanN >= 20` guarantees `barSpanN > 0` on the division branch.
5. In `cycleTimeMs`, `time[...]` is indexed with `safeOffset` and never with the raw `offset`. Trace it: a ternary is not a guarantee that the untaken branch goes unevaluated, which is exactly why the clamp exists rather than a bare `offset <= 500 ? time[offset] : ...`.
6. Both `cycleTimeMs` and `cycleDateText` end on an expression, not on an `if` or `for`.
7. `avgBarMs` is not referenced inside either helper — both take spacing as the `spacingMs` parameter. Confirm by searching the two function bodies for `avgBarMs`.
8. Every new input name is unique across the whole file, and every title within the `Gann Time` and `Time Style` groups is unique. List the eleven new input variables and confirm no existing name is shadowed — in particular `showTimeTable` vs the existing `showTable`, and `timeTablePosInput` vs the existing `tablePosInput`.
9. Nothing outside the four insertion points and line 2 changed. Run `git diff --stat` and confirm only `src/gann-angles.pine` is touched, with no deletions beyond the single replaced declaration line.

- [ ] **Step 7: Commit**

```bash
git add src/gann-angles.pine && git commit -m "feat: add Gann time inputs, cycle tables and date helpers"
```

---

### Task 2: Render vertical cycle lines and labels

**Files:**
- Modify: `src/gann-angles.pine` — the `RENDERER` section: one new function after `drawSet`, and two calls at the end of the existing `if barstate.islast` block.

**Interfaces:**
- Consumes: everything Task 1 produces, plus the existing `drawnLines`, `drawnLabels`, `styleFromString`, `showLabels`, `bullAnchorBar`, `bullAnchorReady`, `bearAnchorBar`, `bearAnchorReady`.
- Produces: function `drawTimeCycles(int anchorBar, bool visible, color cycleColor, string sideLabel) => int`.

- [ ] **Step 1: Add the `drawTimeCycles` function**

Find the `drawSet(...)` function in the `RENDERER` section and its final `array.size(drawnLines)` line. Immediately after that line, insert a blank line then:

```pinescript
drawTimeCycles(int anchorBar, bool visible, color cycleColor, string sideLabel) =>
    if visible and not na(anchorBar)
        for i = 0 to 8
            cycle     = array.get(timeCycles, i)
            isMajor   = array.get(timeCycleIsMajor, i)
            targetBar = anchorBar + cycle
            lineColor = color.new(cycleColor, isMajor ? 0 : 50)
            array.push(drawnLines, line.new(targetBar, high, targetBar, low, extend = extend.both, color = lineColor, style = styleFromString(isMajor ? timeMajorStyle : timeMinorStyle), width = isMajor ? timeMajorWidth : timeMinorWidth))
            if showLabels
                array.push(drawnLabels, label.new(targetBar, high, sideLabel + " T+" + str.tostring(cycle), style = label.style_label_down, color = lineColor, textcolor = color.white, size = size.tiny))
    array.size(drawnLines)
```

- [ ] **Step 2: Add the two calls**

Find the end of the existing `if barstate.islast` block in the `RENDERER` section — the `showAnchorMarkers` block, whose last line draws the `"Bear Anchor"` label. Immediately after that line, at the same indentation as `if showAnchorMarkers` (one level inside `if barstate.islast`), insert a blank line then:

```pinescript
    drawTimeCycles(bullAnchorBar, showTimeLines and showBullTimeLines and bullAnchorReady, bullTimeColor, "Bull")
    drawTimeCycles(bearAnchorBar, showTimeLines and showBearTimeLines and bearAnchorReady, bearTimeColor, "Bear")
```

- [ ] **Step 3: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `drawTimeCycles` ends with `array.size(drawnLines)` — an expression, not the `if` block.
2. Both `line.new` and `label.new` push into `drawnLines` / `drawnLabels`. A vertical line that is not pushed is never deleted, so 18 lines leak on every single redraw. Confirm both `array.push` calls are present.
3. The two calls sit **inside** `if barstate.islast` at one indentation level, after the `showAnchorMarkers` block — not at global scope, and not inside the `if showAnchorMarkers` block. State the indentation you actually see.
4. Neither call's `visible` argument mentions `showBullish`, `showBearish`, `modeInput`, `squareReady` or `squareBlocked`. Quote both arguments verbatim and check each against that list — this is the constraint most likely to be violated by pattern-matching the neighbouring `drawSet` calls.
5. The bullish call passes `bullAnchorBar` / `bullTimeColor` / `"Bull"` and the bearish call `bearAnchorBar` / `bearTimeColor` / `"Bear"`. No crossed arguments.
6. The line is vertical: `line.new`'s first and third arguments are both `targetBar`, and it passes `extend = extend.both`. This is the one place in the file where `extend.both` is correct — confirm the level and start-line draws still use `extend.right` and were not touched.
7. `targetBar` is not clamped, and no `math.min` against `bar_index` was added. State the maximum possible `targetBar` relative to `bar_index` and why it is inside Pine's 500-bar forward limit.
8. Transparency is `0` for majors and `50` for minors, and style/width read from `timeMajorStyle`/`timeMajorWidth` for majors and `timeMinorStyle`/`timeMinorWidth` for minors. No swapped pairs.
9. Count the worst case: 98 existing lines + 18 = 116, and 100 existing labels + 18 = 118. Confirm both against the declared 200/200.

- [ ] **Step 4: Commit**

```bash
git add src/gann-angles.pine && git commit -m "feat: draw vertical Gann time cycle lines from both anchors"
```

---

### Task 3: Time table

**Files:**
- Modify: `src/gann-angles.pine` — append a new `TIME TABLE` section at the end of the file.

**Interfaces:**
- Consumes: everything Tasks 1–2 produce.
- Produces: `timeTable` (`var table`).

- [ ] **Step 1: Append the TIME TABLE section**

Append to the very end of `src/gann-angles.pine`, after the last line of the existing `TABLE` section, a blank line then:

```pinescript
// ============================================================
// TIME TABLE
// ============================================================
var table timeTable = na

if barstate.islast
    table.delete(timeTable)
    bullTimeVisible = showTimeLines and showBullTimeLines and bullAnchorReady
    bearTimeVisible = showTimeLines and showBearTimeLines and bearAnchorReady
    if showTimeLines and showTimeTable
        timeTablePos = switch timeTablePosInput
            "Top Right"    => position.top_right
            "Top Left"     => position.top_left
            "Bottom Right" => position.bottom_right
            => position.bottom_left
        timeRowsNeeded = (bullTimeVisible ? 9 : 0) + (bearTimeVisible ? 9 : 0)
        timeRowCount   = timeRowsNeeded == 0 ? 2 : 1 + timeRowsNeeded
        timeTable := table.new(timeTablePos, 3, timeRowCount, bgcolor = color.new(color.black, 80), border_width = 1)
        table.cell(timeTable, 0, 0, "Cycle", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(timeTable, 1, 0, "Date", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(timeTable, 2, 0, "Status", text_color = color.white, bgcolor = color.new(color.gray, 50))

        timeRow = 1
        if timeRowsNeeded == 0
            table.cell(timeTable, 0, timeRow, "Waiting for a swing pivot", text_color = color.silver)
        if bullTimeVisible
            for i = 0 to 8
                cycle     = array.get(timeCycles, i)
                targetBar = bullAnchorBar + cycle
                reached   = bar_index >= targetBar
                table.cell(timeTable, 0, timeRow, "Bull T+" + str.tostring(cycle), text_color = bullTimeColor)
                table.cell(timeTable, 1, timeRow, cycleDateText(targetBar, avgBarMs), text_color = color.white)
                table.cell(timeTable, 2, timeRow, reached ? "Reached" : "Pending", text_color = reached ? color.lime : color.gray)
                timeRow += 1
        if bearTimeVisible
            for i = 0 to 8
                cycle     = array.get(timeCycles, i)
                targetBar = bearAnchorBar + cycle
                reached   = bar_index >= targetBar
                table.cell(timeTable, 0, timeRow, "Bear T+" + str.tostring(cycle), text_color = bearTimeColor)
                table.cell(timeTable, 1, timeRow, cycleDateText(targetBar, avgBarMs), text_color = color.white)
                table.cell(timeTable, 2, timeRow, reached ? "Reached" : "Pending", text_color = reached ? color.lime : color.gray)
                timeRow += 1
```

- [ ] **Step 2: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `table.delete(timeTable)` runs **before** the `if showTimeLines and showTimeTable` guard, so turning either toggle off removes the table instead of freezing the last render on screen. Confirm the nesting.
2. `bullTimeVisible` / `bearTimeVisible` are character-for-character the same conditions as the two `drawTimeCycles` `visible` arguments in Task 2. Quote all four and compare. If they diverge, the table lists cycles that have no line or vice versa.
3. Re-derive the row arithmetic by hand and state the numbers for: (a) neither side visible — expect `timeRowCount = 2`, highest index written `1`; (b) bullish only — expect `10`, highest `9`; (c) both sides — expect `19`, highest `18`. Confirm the highest index written is strictly less than `timeRowCount` in each.
4. The hint row and the two side blocks are mutually exclusive by construction: `timeRowsNeeded == 0` is true exactly when both `bullTimeVisible` and `bearTimeVisible` are false. State whether this holds, so `timeRow` cannot be advanced past `timeRowCount`.
5. Both loops are `for i = 0 to 8` — fixed bounds, no descending-loop hazard.
6. Every `cycleDateText` call passes `avgBarMs` as the second argument, and `targetBar` is built from that block's own side's anchor bar. No crossed anchors between the two blocks.
7. `reached` is `bar_index >= targetBar` in both blocks — not `>`, and not compared against the anchor bar.
8. `timeTable` is a distinct `var table` from `gannTable`, and the existing `TABLE` section is untouched. Confirm `gannTable` appears nowhere in the new section.
9. This is a second `table.new` in the script. Confirm the two default positions differ (`Top Right` for `tablePosInput`, `Bottom Right` for `timeTablePosInput`) — Pine shows only one table per position.

- [ ] **Step 3: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-06-gann-time-lines-design.md` alongside the finished file and confirm, reporting each result:

1. **Nothing pre-existing changed.** Run `git diff 1cfa597 -- src/gann-angles.pine` and confirm every hunk is an addition except the single `indicator()` line, which differs only by the added `max_bars_back = 500`.
2. **Mode independence.** Grep the file for `modeInput`, `squareReady` and `squareBlocked` and confirm none of them appears in any expression that gates a time line, a time label, or a time-table row.
3. **Level-toggle independence.** Grep for `showBullish` and `showBearish` and confirm neither appears in `drawTimeCycles`' call arguments, in `bullTimeVisible`/`bearTimeVisible`, or anywhere in the `TIME TABLE` section.
4. **Buffer safety.** Enumerate every history reference with a non-constant offset in the file (expect exactly two: `time[barSpanN]` and `time[safeOffset]`) and confirm each is provably `<= 500` and `<= bar_index`.
5. **No orphan inputs.** Enumerate the eleven inputs added in Task 1 and confirm each is read somewhere. Report any orphan rather than silently deleting it.
6. **Cleanup completeness.** Confirm the time lines and time labels are removed on redraw via the existing `drawnLines` / `drawnLabels` clear loops, and that the time table is removed via its own `table.delete`. Name the exact line that deletes each of the three.

- [ ] **Step 4: Commit**

```bash
git add src/gann-angles.pine && git commit -m "feat: add Gann time cycle table with projected dates"
```

---

## Deferred human verification (TradingView)

Not executable in this environment — there is no Pine compiler here. Hand these to the user after Task 3:

- Confirm nine verticals rise from each anchor bar, and that counting bars from an anchor marker to a major line gives exactly 90 / 180 / 270 / 360.
- Confirm the four majors render solid and full-strength and the five minors dotted and faded, in each side's hue (bull blue, bear purple).
- Confirm a cycle landing on the same bar from both anchors reads as two overlapping lines, not one.
- Switch through all three modes and confirm the time lines are identical in each.
- In Gann Square mode with inverted anchors (bearish below bullish), confirm the price table shows its guard row but the time lines still draw.
- Turn off `Show Bearish Levels` and confirm bearish time lines still draw.
- Turn off `Show Time Lines` and confirm lines, labels and the time table all disappear together; turn off only `Show Time Table` and confirm the lines remain.
- Confirm past cycles read `Reached` with an unprefixed date matching the bar the line sits on.
- Confirm future cycles read `Pending` with a `~`-prefixed date, and that on a daily equity chart T+360 estimates roughly 17 months out, not 12.
- Set `Time Table Position` to `Top Right` and confirm the documented collision with the price table.
- Load the indicator on a chart with under 20 bars and confirm no divide-by-zero and no runtime error.
- Pin a manual `Bullish Price` with a start date thousands of bars back and confirm the far-past cycles show `~`-prefixed estimated dates rather than a history-buffer runtime error.
- Judgement call for the user: with `Show Labels` on, 18 cycle labels sit at the same height and will overlap where cycles cluster. Confirm whether that is acceptable or whether the labels should be dropped in a follow-up.
