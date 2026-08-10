# Performance Stats Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the trade engine a memory of its own results — win rate, average R, total R and a per-grade breakdown over every closed trade in loaded history — so the script's tuned numbers can be judged against evidence.

**Architecture:** Each closed trade is scored under a **scale-out-in-thirds** convention: one third leaves at each target reached, the remainder at `closePrice`. Every input to that figure is already carried on the `Trade` object, so **no part of the trade state machine changes**. The result is accumulated into plain `var` counters, unconditionally, and rendered as a third `PERFORMANCE` section on the existing panel following the `STRUCTURE` / `TRADE` convention.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-10-performance-stats-panel-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` at commit `95060ab` on branch `master`, 1195 lines. Create branch `feat/performance-stats` before Task 1. This plan modifies that file in place plus `README.md`. **All line numbers refer to that revision** and shift as tasks land — always locate code by its text, not by line number.

## Global Constraints

- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error. Both new functions in this plan end in an expression.
- **Pine has no nested function definitions.** `legR` is a separate top-level function, not a helper inside `blendedResultR`.
- **Do not write `cond and someUdt.field`.** Pine does not guarantee short-circuit evaluation and reading a field of a `na` object is a runtime error. `not na(x)` is safe in a condition because it does not dereference; every field access must sit inside the guarded block.
- **Loop-direction footgun:** `for i = X to Y` runs *descending* when `Y < X` rather than skipping. The only new loop is `for gi = 0 to 2` with literal bounds.
- **Do not rely on `/` between two ints returning an int.** Every average in this plan divides a float by an int (`statSumR / statTrades`) or multiplies by a float first (`100.0 * statWins / statTrades`).
- **`rr` is always `|entry − initialStop|`, never the trailed `stop`.** A trailed stop shrinks the denominator and overstates every result. This rule already exists at the `tradeOpenR` calculation; it matters more here because results accumulate.
- **Accumulation is never gated by a display input.** The counters must sit in an `if tradeClosed` block that no `show*` flag can reach. Gating them would mean switching a display off silently zeroes the track record.
- **Nothing in the trade state machine changes.** Do not touch: exit detection, the stop-first ordering, the gapped-exit `math.min`/`math.max` on `closePrice`, TP flag setting, the trailing stop, the slot-free block, the open block, `selectTargets`, `scanArray`, the `Trade` type's fields, trade level/target rendering, or any existing `alertcondition`.
- **Grade index is A=0, B=1, C=2**, and `gradeIndex` returns 2 for anything unrecognised so an unexpected grade string can never index out of bounds.
- **A win is `blendedR > 0`; a loss is `blendedR < 0`.** Exactly `0.0` is neither, so `statWins + statLosses` may be one short of `statTrades`. This is intended.
- **Panel colour uses `>= 0` for green**, matching the existing result label, even though the win test uses `> 0`. This mismatch is deliberate and documented in the spec — do not "fix" it.
- **Every `statsBase + n` and the row count passed to `table.new` must derive from the same expression.** `statsBase` shifts by 6 rows depending on whether a trade is live. A hardcoded offset produces silently misplaced or blank cells — this is the exact hazard block C hit when it inserted the confirmation row.
- **Do not add an expectancy row.** With results already denominated in R, per-trade expectancy *is* average R. Two rows carrying the same number read as a bug.
- Exact new input default: `Show Performance Rows` **on**.
- `max_boxes_count`, `max_labels_count` and `max_lines_count` are all already 500. **Do not change them.**
- `README.md` ships in the same commits as the code that changes it, never afterwards.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Blended R and unconditional accumulation

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add `closedR` to the per-bar flags near `tradeClosed`; add `legR`, `blendedResultR` and `gradeIndex` functions and the accumulator state after the `trailAnchor` function; add the accumulation block between the exit block and the slot-free block; add two `DBG` plots; repoint the result label at `closedR`.

**Interfaces:**
- Consumes: nothing from earlier tasks. Reads existing globals `activeTrade`, `tradeClosed`, `showTradeHistory` and the `Trade` type's `side`, `grade`, `entry`, `initialStop`, `tp1`, `tp2`, `tp3`, `tpHit`, `closePrice` fields.
- Produces: `legR(float price, float entry, float rr, bool isLong) => float`; `blendedResultR(Trade t) => float`; `gradeIndex(string g) => int`; globals `closedR` (float, per-bar), `statTrades` (var int), `statWins` (var int), `statLosses` (var int), `statSumR` (var float), `statGradeCount` (var array<int>, size 3), `statGradeSumR` (var array<float>, size 3).

**Why this task exists.** The measurement and the memory are one reviewable unit: the question "does this arithmetic describe the trade, and can it double-count" is separable from "does the panel render in the right rows". Nothing here is visible except the changed result label, which is deliberate — if the numbers are wrong, they are wrong before any table exists.

- [ ] **Step 1: Add the per-bar result variable**

Find these three lines (they sit just below `var Trade activeTrade = na`):

```pinescript
tradeOpened   = false
tradeClosed   = false
targetJustHit = false
```

Replace them with:

```pinescript
tradeOpened   = false
tradeClosed   = false
targetJustHit = false
closedR       = 0.0   // blended R of the trade that closed on this bar; 0.0 on every other bar
```

- [ ] **Step 2: Add the measurement functions and the accumulator state**

Find the end of the `trailAnchor` function — the block ending:

```pinescript
    else
        result := useMajor ? newestUnbroken(majorHighs) : newestUnbroken(intHighs)
    result
```

Insert this immediately after it, before the `// ---- exits, on confirmed bars only, stop first ----` comment:

```pinescript
// Signed R of one price. `rr` is the initial risk; a zero or negative rr yields 0.0 rather than
// dividing, which keeps the guard in one place instead of at every call site.
legR(float price, float entry, float rr, bool isLong) =>
    rr > 0 ? (isLong ? price - entry : entry - price) / rr : 0.0

// Blended R under the scale-out convention: one third of the position leaves at each target
// reached, and the remaining thirds leave at closePrice.
//
// This is a MEASUREMENT CONVENTION, not a change in behaviour. The engine still manages one
// unit with one exit and draws no partial-exit markers — see the spec. It exists because under
// single-unit accounting a trade that reaches TP2 and trails back to breakeven records 0R,
// which makes the three targets nearly decorative and understates the engine badly enough to
// mislead any tuning done against these numbers.
//
// `rr` uses initialStop, never the trailed stop, for the same reason tradeOpenR does: a trailed
// stop shrinks the denominator and would flatter every result.
//
// Targets are NOT evenly spaced in R — selectTargets() picks liquidity levels, so TP1 is
// wherever the nearest qualifying level sits, not 1R by definition. Each leg is therefore
// priced from its own target, never assumed.
blendedResultR(Trade t) =>
    rr     = math.abs(t.entry - t.initialStop)
    isLong = t.side == "long"
    total  = (3 - t.tpHit) * legR(t.closePrice, t.entry, rr, isLong)
    if t.tpHit >= 1
        total += legR(t.tp1, t.entry, rr, isLong)
    if t.tpHit >= 2
        total += legR(t.tp2, t.entry, rr, isLong)
    if t.tpHit >= 3
        total += legR(t.tp3, t.entry, rr, isLong)
    total / 3.0

// A=0, B=1, C=2. Anything unrecognised lands in C rather than erroring — an out-of-range index
// on a 3-slot array would be a runtime failure on a chart, which is a bad trade for strictness.
gradeIndex(string g) =>
    g == "A" ? 0 : g == "B" ? 1 : 2

// Result memory. Nothing is stored per trade, so there is no cap and no memory growth — only
// running totals. `var` commits at bar close, which is what makes live-tick recalculation safe.
var int   statTrades = 0
var int   statWins   = 0
var int   statLosses = 0
var float statSumR   = 0.0
var array<int>   statGradeCount = array.new<int>(3, 0)
var array<float> statGradeSumR  = array.new<float>(3, 0.0)
```

- [ ] **Step 3: Add the accumulation block**

Find the end of the exit block and the start of the slot-free block:

```pinescript
                    if isLong ? candidate > activeTrade.stop : candidate < activeTrade.stop
                        activeTrade.stop := candidate

// ---- free the slot, never on the closing bar itself ----
```

Insert the new block between them, so the region reads:

```pinescript
                    if isLong ? candidate > activeTrade.stop : candidate < activeTrade.stop
                        activeTrade.stop := candidate

// ---- record the result, never gated by a display input ----
// Placement is deliberate: on the closing bar tradeClosed is true and activeTrade is still
// valid, and on the next bar tradeClosed is false and the block below frees the slot. So this
// runs exactly once per trade. tradeClosed is a plain per-bar variable, not a var, so it cannot
// leak into a later bar.
//
// No show* flag guards this. If it did, switching the history labels off would silently zero
// the track record, and the panel would disagree with the chart for reasons nobody could see.
if tradeClosed and not na(activeTrade)
    closedR := blendedResultR(activeTrade)
    gi      = gradeIndex(activeTrade.grade)
    statTrades += 1
    statSumR   += closedR
    if closedR > 0
        statWins += 1
    else if closedR < 0
        statLosses += 1
    array.set(statGradeCount, gi, array.get(statGradeCount, gi) + 1)
    array.set(statGradeSumR,  gi, array.get(statGradeSumR,  gi) + closedR)

// ---- free the slot, never on the closing bar itself ----
```

- [ ] **Step 4: Add the verification plots**

Find the slot-free block that now follows the accumulation block:

```pinescript
if not na(activeTrade)
    if not na(activeTrade.closeReason)
        if not tradeClosed
            activeTrade := na
```

Insert directly after it:

```pinescript
// Verification surface for the deferred TradingView pass — engine state as numbers, bar by bar.
plot(closedR, "DBG Closed Trade R", display = display.data_window)
plot(statTrades, "DBG Closed Trades", display = display.data_window)
plot(statTrades > 0 ? statSumR / statTrades : 0.0, "DBG Avg R", display = display.data_window)
```

- [ ] **Step 5: Repoint the result label at the blended figure**

Find this block near the end of the trade rendering section:

```pinescript
// Persistent — deliberately not tracked in tradeLines/tradeLabels, so the redraw above never
// deletes it. One label per closed trade is the whole track record.
if tradeClosed and showTradeHistory and not na(activeTrade)
    rr = math.abs(activeTrade.entry - activeTrade.initialStop)
    realisedR = rr > 0 ? (activeTrade.side == "long" ? activeTrade.closePrice - activeTrade.entry : activeTrade.entry - activeTrade.closePrice) / rr : 0.0
    resCol = realisedR >= 0 ? color.new(color.green, 20) : color.new(color.red, 20)
    label.new(bar_index, activeTrade.closePrice, (realisedR >= 0 ? "+" : "") + str.tostring(realisedR, "0.0") + "R · " + activeTrade.closeReason, style = activeTrade.side == "long" ? label.style_label_up : label.style_label_down, color = resCol, textcolor = color.white, size = size.tiny)
```

Replace it with:

```pinescript
// Persistent — deliberately not tracked in tradeLines/tradeLabels, so the redraw above never
// deletes it. These labels are the per-trade record; the panel's PERFORMANCE rows are the
// aggregate, and both now read the same blended R so they can never disagree.
if tradeClosed and showTradeHistory and not na(activeTrade)
    resCol = closedR >= 0 ? color.new(color.green, 20) : color.new(color.red, 20)
    label.new(bar_index, activeTrade.closePrice, (closedR >= 0 ? "+" : "") + str.tostring(closedR, "0.0") + "R · " + activeTrade.closeReason, style = activeTrade.side == "long" ? label.style_label_up : label.style_label_down, color = resCol, textcolor = color.white, size = size.tiny)
```

- [ ] **Step 6: Read-back self-review**

Confirm by reading the file:

1. `blendedResultR` ends in the expression `total / 3.0`, and `legR` and `gradeIndex` each end in a ternary expression — no function ends in a bare `if`.
2. `legR` is defined at top level, before `blendedResultR` uses it, and `blendedResultR` is defined before the accumulation block calls it.
3. No condition anywhere dereferences a field of a possibly-`na` object: `if tradeClosed and not na(activeTrade)` contains no `.field` access.
4. The accumulation block sits **after** the trailing-stop assignment and **before** `// ---- free the slot`.
5. `rr` inside `blendedResultR` is built from `initialStop`, not `stop`.
6. `(3 - t.tpHit)` can only be 0..3 — `tpHit` is set to exactly 1, 2 or 3 in the exit block and initialised to 0 in both `Trade.new` calls. Confirm both `Trade.new` calls still pass `0` in the `tpHit` position.
7. `statSumR / statTrades` in the DBG plot is guarded by `statTrades > 0`.
8. No `show*` input appears anywhere in the accumulation block.
9. The word `realisedR` no longer appears anywhere in the file.
10. Nothing in the exit block, the slot-free block or the open block was altered.

- [ ] **Step 7: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: measure closed trades in blended R and accumulate them"
```

---

### Task 2: The PERFORMANCE panel section

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine` — add the `showStatsPanel` input to the Trade Engine group; add the `rText` formatter; add `statsRows` / `statsBase` to the panel builder and extend `table.new`'s row count; write the section's cells.

**Interfaces:**
- Consumes: from Task 1 — `statTrades`, `statWins`, `statLosses`, `statSumR`, `statGradeCount`, `statGradeSumR`. Reads existing `confirmRows`, `tradeRows`, `structPanel`, `panelPos`.
- Produces: `rText(float v) => string`; global `showStatsPanel` (input.bool).

**Why this task exists.** Row indexing is the failure mode here, and it is independently rejectable: the arithmetic from Task 1 can be correct while the section renders on top of the trade rows. `statsBase` shifts by 6 depending on whether a trade is live, which is exactly the bug class block C hit when it inserted the confirmation row ahead of the trade rows.

- [ ] **Step 1: Add the input**

Find this line in the `// ---------------- Trade Engine ----------------` group:

```pinescript
showTradePanel     = input.bool(true, "Show Trade Panel Rows", group = "Trade Engine")
```

Replace it with:

```pinescript
showTradePanel     = input.bool(true, "Show Trade Panel Rows", group = "Trade Engine")
showStatsPanel     = input.bool(true, "Show Performance Rows", group = "Trade Engine", tooltip = "Win rate, average R, total R and a per-grade breakdown over every trade in the loaded history.\n\nResults assume one third of the position leaves at each target reached — the engine itself manages one unit, so this is an accounting convention. The live trade's Open R row is single-unit and will not match.\n\nThe counters run whether or not this is on; hiding the rows never resets them. The sample is whatever history TradingView loaded, so read n before trusting a percentage.")
```

- [ ] **Step 2: Add the R formatter**

Find this line, which begins the panel section:

```pinescript
var table structPanel = na
```

Insert directly above it:

```pinescript
// "+0.34R" / "-1.20R". Two decimals, where the per-trade result labels use one — an average over
// a small sample moves in the second decimal and rounding it away hides the movement.
rText(float v) =>
    (v >= 0 ? "+" : "") + str.tostring(v, "0.00") + "R"
```

- [ ] **Step 3: Size the section and extend the table**

Find these lines in the panel builder:

```pinescript
        tradeRows = 0
        if showTradePanel and tradeIsLive()
            tradeRows := 6
        structPanel := table.new(panelPos, 2, 5 + confirmRows + tradeRows, bgcolor = color.new(color.black, 80), border_width = 1)
```

Replace them with:

```pinescript
        tradeRows = 0
        if showTradePanel and tradeIsLive()
            tradeRows := 6
        // 7 rows once there is anything to report — header, three overall rows, three grades.
        // 2 before the first trade closes: a header with an empty-state row under it, rather
        // than six rows of 0% and +0.00R that read like a result.
        statsRows = 0
        if showStatsPanel
            statsRows := statTrades > 0 ? 7 : 2
        structPanel := table.new(panelPos, 2, 5 + confirmRows + tradeRows + statsRows, bgcolor = color.new(color.black, 80), border_width = 1)
```

- [ ] **Step 4: Write the section's cells**

Find the last two lines of the panel builder — the `Open R` row that currently ends it:

```pinescript
            table.cell(structPanel, 0, tradeBase + 5, "Open R", text_color = color.silver)
            table.cell(structPanel, 1, tradeBase + 5, rTxt, text_color = tradeOpenR >= 0 ? color.lime : color.red)
```

Insert directly after them, at the same indentation as `tradeBase`'s own assignment (8 spaces — inside `if showStructurePanel`, not inside `if tradeRows > 0`):

```pinescript
        // Derived from the same expression as the row count above. Never hardcode this: it
        // shifts by 6 whenever a trade opens or closes.
        statsBase = 5 + confirmRows + tradeRows
        if statsRows > 0
            table.cell(structPanel, 0, statsBase, "PERFORMANCE", text_color = color.white, bgcolor = color.new(color.gray, 50))
            table.cell(structPanel, 1, statsBase, "n = " + str.tostring(statTrades), text_color = color.silver, bgcolor = color.new(color.gray, 50))
            if statTrades == 0
                table.cell(structPanel, 0, statsBase + 1, "No closed trades", text_color = color.silver)
                table.cell(structPanel, 1, statsBase + 1, "—", text_color = color.gray)
            else
                avgR   = statSumR / statTrades
                winPct = 100.0 * statWins / statTrades
                table.cell(structPanel, 0, statsBase + 1, "Win rate", text_color = color.silver)
                table.cell(structPanel, 1, statsBase + 1, str.tostring(winPct, "0") + "%  (" + str.tostring(statWins) + "W / " + str.tostring(statLosses) + "L)", text_color = color.white)
                table.cell(structPanel, 0, statsBase + 2, "Avg R", text_color = color.silver)
                table.cell(structPanel, 1, statsBase + 2, rText(avgR), text_color = avgR >= 0 ? color.lime : color.red)
                table.cell(structPanel, 0, statsBase + 3, "Total R", text_color = color.silver)
                table.cell(structPanel, 1, statsBase + 3, rText(statSumR), text_color = statSumR >= 0 ? color.lime : color.red)
                for gi = 0 to 2
                    gCount = array.get(statGradeCount, gi)
                    gSum   = array.get(statGradeSumR, gi)
                    gName  = gi == 0 ? "A" : gi == 1 ? "B" : "C"
                    gAvg   = gCount > 0 ? gSum / gCount : 0.0
                    gTxt   = gCount > 0 ? rText(gAvg) + "  (" + str.tostring(gCount) + ")" : "—  (0)"
                    gCol   = gCount == 0 ? color.gray : gAvg >= 0 ? color.lime : color.red
                    table.cell(structPanel, 0, statsBase + 4 + gi, gName + " grade", text_color = color.silver)
                    table.cell(structPanel, 1, statsBase + 4 + gi, gTxt, text_color = gCol)
```

- [ ] **Step 5: Read-back self-review**

Confirm by reading the file:

1. The expression `5 + confirmRows + tradeRows + statsRows` in `table.new` and `5 + confirmRows + tradeRows` in `statsBase` are consistent — `statsBase` is the row index immediately after the last trade row, and the highest cell written is `statsBase + 6` when `statsRows` is 7.
2. Count it by hand for the largest case: `confirmRows` 1, `tradeRows` 6, `statsRows` 7 → table height 19, highest index written `5 + 1 + 6 + 6 = 18`. Rows are zero-indexed, so 18 is the last valid row of a 19-row table. ✓
3. Count the empty case: `confirmRows` 0, `tradeRows` 0, `statsRows` 2 → height 7, highest index `5 + 0 + 0 + 1 = 6`. ✓
4. `statsBase` is assigned at the `if showStructurePanel` indentation level, **not** inside `if tradeRows > 0` — otherwise the whole section disappears whenever no trade is live.
5. `for gi = 0 to 2` has literal ascending bounds, so the descending-loop footgun cannot apply.
6. No integer division: `statSumR / statTrades` is float/int, `100.0 * statWins / statTrades` multiplies by a float first, `gSum / gCount` is float/int.
7. `avgR` and `winPct` are computed inside the `else` branch, so they are never evaluated when `statTrades` is 0.
8. `gAvg` is guarded by `gCount > 0`.
9. The three colour tests use `>= 0`, matching the existing result label, not the `> 0` win test.
10. Nothing above `statsBase` was renumbered — the `STRUCTURE`, `Confirm` and six `TRADE` rows are untouched.

- [ ] **Step 6: Commit**

```bash
git add src/ict-rsi-ma-indicator.pine && git commit -m "feat: add the PERFORMANCE panel section"
```

---

### Task 3: README

**Files:**
- Modify: `README.md` — add `Show Performance Rows` to the Trade Engine settings table; add the performance rows and the scale-out convention to *Reading the trade panel*.

**Interfaces:**
- Consumes: the input name and defaults from Task 2, the row layout from Task 2.
- Produces: nothing code-facing.

**Why this task exists.** The scale-out convention is the one thing about this feature a reader cannot infer from the chart. `Open R` on a live trade is single-unit and the blended R on the same trade after it closes is not, and without a sentence explaining that, the script looks like it contradicts itself.

- [ ] **Step 1: Add the setting to the Trade Engine table**

In *Settings*, find the last row of the **Trade Engine** table:

```markdown
| Long Trades Only | off | For markets where you can't short |
```

Replace it with:

```markdown
| Long Trades Only | off | For markets where you can't short |
| Show Performance Rows | on | Win rate, average R and a per-grade split over the loaded history. The counters run whether or not this is on |
```

- [ ] **Step 2: Document the rows and the accounting convention**

In *Reading the trade panel*, find this paragraph:

```markdown
When a trade closes it leaves a single label at the exit bar — `+2.5R · Target`, `−1.0R · Stopped`.
Scroll back and those labels are your track record.
```

Replace it with:

```markdown
When a trade closes it leaves a single label at the exit bar — `+2.5R · Target`, `−1.0R · Stopped`.
Scroll back and those labels are your per-trade record; the `PERFORMANCE` rows are the same
results added up.

```
PERFORMANCE    n = 24
Win rate       58%  (14W / 10L)
Avg R          +0.34R
Total R        +8.2R
A grade        +0.81R  (6)
B grade        +0.30R  (11)
C grade        −0.22R  (7)
```

The grade split is the row worth staring at. If C-grade setups lose money and A-grade ones don't,
`Minimum Score` is set too low — that is the feedback loop the score never had.

**Results assume you scale out in thirds**: one third of the position leaves at each target
reached, and whatever is left exits at the stop or the final target. The indicator itself manages
one unit and draws no partial exits, so this is an accounting convention, not something you can see
on the chart. It is there because under single-unit accounting a trade that reaches TP2 and then
trails back to breakeven scores 0R — which makes TP1 and TP2 nearly decorative and understates the
engine badly enough to mislead any tuning you do against these numbers. One consequence: the live
trade's `Open R` row is single-unit and **will not** match the blended figure the same trade reports
once it closes.

Read `n` before you trust a percentage. The sample is whatever history TradingView loaded, capped at
5000 bars — on a 15-minute chart that is under two months, and a 58% win rate over twelve trades is
noise. These are also the results of the indicator *as configured*, not of the underlying pattern:
only one trade runs at a time, so every setup that appeared while a trade was open is missing from
the count. Change any setting and the whole history recomputes, which is the point — it makes the
panel a way to compare settings, not a fixed track record.
```

- [ ] **Step 3: Read-back self-review**

Confirm by reading the file:

1. The `Show Performance Rows` default in the table reads `on`, matching the Global Constraints list.
2. The sample panel block's seven rows match the cells written in Task 2, label for label.
3. The scale-out explanation states explicitly that `Open R` will not match — a reader hitting that mismatch must find it documented, not discover it.
4. No claim appears anywhere that the indicator executes partial exits or draws them.
5. The nested code fence inside the replacement renders — the outer block is markdown prose, and the inner ``` fence around the panel sample is balanced.
6. The existing `Long Trades Only` note further down the section is unchanged.

- [ ] **Step 4: Commit**

```bash
git add README.md && git commit -m "docs: document the performance rows and the scale-out convention"
```

---

## Deferred human verification (TradingView)

None of the above can be compiled in this environment. Paste `src/ict-rsi-ma-indicator.pine` into the
Pine Editor and work through this list, reading state from the Data Window rather than eyeballing the
chart. The `DBG` series added in Task 1 exist for exactly this.

- [ ] It compiles.
- [ ] On a chart with closed trades, `n` matches the number of result labels visible with `Show Trade History` on.
- [ ] `DBG Closed Trades` steps by exactly 1 at each result label and never moves between them.
- [ ] Scrub across a closing bar tick by tick on a live chart: `DBG Closed Trades` increments once, not once per tick.
- [ ] Find a trade that visibly reached TP2 and then trailed back to breakeven. Its label reports a **positive** R, not `0.0R`. Check the value by hand: it should be roughly (R at TP1 + R at TP2 + 0) ÷ 3.
- [ ] Find a trade stopped out before any target. Its label reports close to `−1.0R` — three thirds at the initial stop.
- [ ] Find a trade that reached TP3. Its label matches the TP3 R shown on the target line only if all three targets are evenly spaced; otherwise it is the average of the three, which is the intended behaviour.
- [ ] The three grade counts sum to `n`.
- [ ] The three grade sub-totals sum to `Total R`, within display rounding.
- [ ] `Win rate`'s W and L counts sum to `n`, or fall short only by trades whose label reads exactly `+0.0R`.
- [ ] `DBG Avg R` matches the panel's `Avg R` row.
- [ ] With a trade live, the `PERFORMANCE` header sits directly below the `Open R` row — no overwritten cell, no blank row.
- [ ] Wait for that trade to close and confirm the section moves up 6 rows cleanly with nothing left behind.
- [ ] Turn `Show Confirmation Panel Row` off with a trade live and confirm the performance rows still land correctly — that is the 6-row and 1-row shifts combined.
- [ ] Turn `Show Trade History` off and reload. The stats are unchanged — this is the display-gating trap.
- [ ] Turn `Show Performance Rows` off. Exactly those rows disappear and the structure, confirmation and trade rows above them do not move.
- [ ] Load a symbol the engine has never traded. The header renders with `n = 0`, the empty-state row reads `—`, and no cell shows `NaN`.
- [ ] Change `Minimum Score` from 5 to 6 and confirm every number recomputes rather than accumulating on top of the old ones.
- [ ] Scroll back over a long history and confirm no new "too many objects" error.
