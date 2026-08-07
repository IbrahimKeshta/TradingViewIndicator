# Touched-Level Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap how many touched Gann levels are drawn and tabulated per direction, keeping only the N nearest the current price, so the levels table and the chart stay readable on long histories.

**Architecture:** A per-direction cutoff *distance* is computed once per redraw — the Nth smallest `abs(price - close)` among touched levels that already pass the angle filter — and stored in two `var float`s. A predicate then admits a level when it is untouched, when no cutoff applies, or when it is inside the cutoff. The renderer and the table both consult the same stored cutoff, which is what keeps the table's row count and its row writes in lockstep.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Spec:** `docs/superpowers/specs/2026-08-06-touched-level-cap-design.md`

**Starting point:** `src/gann-angles.pine` at commit `9ea2336` on `master`. This plan modifies that file in place. All line numbers below refer to that revision.

## Global Constraints

- One new input: `maxTouchedLevels = input.int(5, "Max Touched Levels", minval = 0, maxval = 100, group = "Display", ...)`. Exact default `5`, exact bounds `0`–`100`.
- **The cap is per direction, not global.** With both sides visible you may see up to 5 touched bullish levels and 5 touched bearish. This matches how `Bullish Angles` / `Bearish Angles` already work.
- **The cutoff is computed only over levels that already pass that side's angle filter.** If it were computed over all touched levels, setting `Bullish Angles` to `Primary only` could let the angle filter remove several of the N nearest and leave fewer than N visible. This is the single most important correctness requirement in this plan.
- **`Pending` (untouched) levels are never filtered.** The cap applies exclusively to touched levels.
- Cutoff return contract: `na` means no filtering needed; `-1.0` means exclude every touched level (distances are always `>= 0`, so nothing can satisfy `<= -1.0`); any other value is a distance threshold, inclusive.
- **Ties are accepted, not resolved.** Two levels at exactly equal distance from the close both pass, so the visible count can occasionally be N+1. Fixing it properly needs index-carrying through the sort, which Pine makes clumsy, and exact ties are vanishingly rare with real prices. Do not add tie-breaking logic.
- **`countRows` and the two table row-writing loops must apply identical filtering.** `countRows` sizes `table.new`; if its filtering diverges from the loops' by even one level the table is mis-sized — silently dropped rows or a blank trailing row. Both must receive the same cutoff value.
- **`touchedCutoff` and `passesTouchFilter` cannot go in the `HELPERS` section.** They take `array<GannLevel>` / `GannLevel`, and the `GannLevel` type is declared at line 211, *after* `HELPERS` at line 178. Pine requires declaration before use. They belong in a new section placed after `TOUCH TRACKING` (ends line 295) and before `RENDERER` (starts line 297).
- The cutoff assignment must be guarded by `if barstate.islast`. Without the guard the sort runs on every historical bar of the chart.
- **The filter only ever removes lines, labels and rows.** Worst case is unchanged — "nothing touched yet", where the filter does nothing — so `max_lines_count = 200`, `max_labels_count = 200`, `max_boxes_count = 10`, `max_bars_back = 500` and the `math.min(neededRows, 100)` table cap all stay exactly as they are. **Do not recalculate or alter any of them.**
- Start lines, anchor markers, the Gann Square box and grid, and the entire time table are unaffected. Do not touch `drawStartLine`, `drawTimeCycles`, or the `TIME TABLE` section.
- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error.
- Pine v6 UDT instances and arrays are reference types, so `for lvl in levels` yields the stored object and a `GannLevel` may be passed to a function by reference.
- **Loop-direction footgun:** `for i = X to Y` runs descending when `Y < X` at runtime rather than skipping. Both new loops are `for ... in`, which needs no guard — prefer it.
- No automated tests exist for Pine Script. Every task's verification step is manual Pine v6 syntax/logic self-review. No live TradingView compile-check is available in this environment — **do not claim one was performed.**

---

### Task 1: Input and the touched-level filter

**Files:**
- Modify: `src/gann-angles.pine` — insert one input into the `Display` group, and insert a new `TOUCHED LEVEL FILTER` section between `TOUCH TRACKING` and `RENDERER`.

**Interfaces:**
- Consumes: `GannLevel` (type, line 211, fields `price` float / `label` string / `isPrimary` bool / `touched` bool); `bullLevels`, `bearLevels` (`array<GannLevel>`, lines 214–215); `passesFilter(bool isPrimary, string filterMode) => bool` (line 189); inputs `bullishAngles`, `bearishAngles`.
- Produces: input `maxTouchedLevels` (int); functions `touchedCutoff(array<GannLevel> levels, int maxTouched, string filterMode) => float` and `passesTouchFilter(GannLevel lvl, float cutoff) => bool`; series `bullTouchCutoff`, `bearTouchCutoff` (`var float`).

**Nothing calls the new code in this task.** Task 2 wires it in. Unused functions and unused `var`s are valid Pine — this is expected, not a defect.

- [ ] **Step 1: Add the input**

Find line 81, the last line of the `// ---------------- Display ----------------` block:

```pinescript
tablePosInput = input.string("Top Right", "Table Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Display")
```

Immediately after it, insert:

```pinescript
maxTouchedLevels = input.int(5, "Max Touched Levels", minval = 0, maxval = 100, group = "Display", tooltip = "Caps how many Touched levels are shown per direction, keeping the ones nearest current price. Pending levels are never hidden. Set to 0 to hide every Touched level, or to 100 to show them all — that is more than any ring count can produce.")
```

- [ ] **Step 2: Insert the TOUCHED LEVEL FILTER section**

Find the end of the `TOUCH TRACKING` section — line 295, the second `lvl.touched := true`, which is the last line before the `// ====` banner opening `RENDERER` at line 297. Insert after it a blank line, then:

```pinescript
// ============================================================
// TOUCHED LEVEL FILTER
// ============================================================
// Distance from the close of the Nth-nearest touched level that also passes the
// angle filter. Returns na when no filtering is needed and -1.0 to exclude every
// touched level. Distances are collected only from levels the angle filter already
// admits, so the two filters cannot eat into each other's quota.
touchedCutoff(array<GannLevel> levels, int maxTouched, string filterMode) =>
    dists = array.new<float>()
    for lvl in levels
        if lvl.touched and passesFilter(lvl.isPrimary, filterMode)
            array.push(dists, math.abs(lvl.price - close))
    cutoff = float(na)
    if maxTouched <= 0
        cutoff := -1.0
    else if array.size(dists) > maxTouched
        array.sort(dists, order.ascending)
        cutoff := array.get(dists, maxTouched - 1)
    cutoff

// Untouched levels always pass. Touched ones pass only within the cutoff distance.
passesTouchFilter(GannLevel lvl, float cutoff) =>
    not lvl.touched or na(cutoff) or math.abs(lvl.price - close) <= cutoff

var float bullTouchCutoff = na
var float bearTouchCutoff = na
if barstate.islast
    bullTouchCutoff := touchedCutoff(bullLevels, maxTouchedLevels, bullishAngles)
    bearTouchCutoff := touchedCutoff(bearLevels, maxTouchedLevels, bearishAngles)
```

- [ ] **Step 3: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. The new section sits **after** the `GannLevel` type declaration and after both `bullLevels`/`bearLevels` are declared, and **before** the `RENDERER` banner. State the line numbers of the type declaration and of the new section to show the ordering holds. If it were placed in `HELPERS` the file would not compile.
2. `touchedCutoff` ends with the bare expression `cutoff`, and `passesTouchFilter` ends with its boolean expression. Neither ends on an `if` or `for`.
3. Distances are pushed only when **both** `lvl.touched` and `passesFilter(lvl.isPrimary, filterMode)` hold. Quote the condition. Dropping the `passesFilter` half is the defect this plan most wants to avoid — it would silently return fewer than N levels whenever an angle filter is active.
4. Trace all three return paths and state what each yields: `maxTouched <= 0`; `array.size(dists) > maxTouched`; and the fall-through. Confirm the fall-through leaves `cutoff` as `na`.
5. `array.get(dists, maxTouched - 1)` can never be called with a negative index. State why — which guard makes `maxTouched >= 1` on that branch.
6. `array.get(dists, maxTouched - 1)` can never be called out of bounds. State why — which guard makes `array.size(dists) > maxTouched`.
7. `passesTouchFilter` returns `true` for every untouched level regardless of cutoff, including when the cutoff is `-1.0`. Trace the boolean short-circuit.
8. A cutoff of `-1.0` excludes every touched level. State why no `math.abs(...)` result can satisfy `<= -1.0`.
9. The cutoff assignment is wrapped in `if barstate.islast`, and both cutoffs are declared `var float`. Without `var` they would not survive to be read by the `TABLE` section further down the file.
10. Both loops are `for ... in` form — no descending-loop hazard.
11. Nothing else changed. Run `git diff --stat` and confirm only `src/gann-angles.pine` is touched, with insertions only and zero deletions.

- [ ] **Step 4: Commit**

```bash
git add src/gann-angles.pine && git commit -m "feat: add touched-level cutoff filter and Max Touched Levels input"
```

---

### Task 2: Wire the filter into the renderer and the table

> **Note:** the line numbers quoted below were computed against the file before Task 1's insertions
> and are ~30 lines stale by the time Task 2 runs. Locate each edit by matching the quoted
> before-text, not by trusting the line number.

**Files:**
- Modify: `src/gann-angles.pine` — `drawSet` and its two call sites; `countRows` and its two call sites; the two table row-writing loop guards.

**Interfaces:**
- Consumes: everything Task 1 produces — `maxTouchedLevels`, `touchedCutoff`, `passesTouchFilter`, `bullTouchCutoff`, `bearTouchCutoff`.
- Produces: `drawSet(array<GannLevel> levels, int anchorBar, bool visible, string filterMode, float touchCutoff, color priColor, string priStyle, int priWidth, color secColor, string secStyle, int secWidth) => int` and `countRows(array<GannLevel> levels, bool visible, string filterMode, float touchCutoff) => int`. In both, `touchCutoff` is inserted **immediately after `filterMode`**, not appended at the end.

- [ ] **Step 1: Change the `drawSet` signature and its filter condition**

Replace lines 311–314 — the `drawSet` declaration through its `passesFilter` guard:

```pinescript
drawSet(array<GannLevel> levels, int anchorBar, bool visible, string filterMode, color priColor, string priStyle, int priWidth, color secColor, string secStyle, int secWidth) =>
    if visible and not na(anchorBar)
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
```

with:

```pinescript
drawSet(array<GannLevel> levels, int anchorBar, bool visible, string filterMode, float touchCutoff, color priColor, string priStyle, int priWidth, color secColor, string secStyle, int secWidth) =>
    if visible and not na(anchorBar)
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode) and passesTouchFilter(lvl, touchCutoff)
```

Leave the rest of the function body (lines 315–321) untouched.

- [ ] **Step 2: Update both `drawSet` call sites**

Replace line 364:

```pinescript
    drawSet(bullLevels, bullLevelBar, showBullish and bullAnchorReady, bullishAngles, bullPrimaryColor, bullPrimaryStyle, bullPrimaryWidth, bullSecondaryColor, bullSecondaryStyle, bullSecondaryWidth)
```

with:

```pinescript
    drawSet(bullLevels, bullLevelBar, showBullish and bullAnchorReady, bullishAngles, bullTouchCutoff, bullPrimaryColor, bullPrimaryStyle, bullPrimaryWidth, bullSecondaryColor, bullSecondaryStyle, bullSecondaryWidth)
```

Replace line 366:

```pinescript
    drawSet(bearLevels, bearAnchorBar, showBearish and bearAnchorReady, bearishAngles, bearPrimaryColor, bearPrimaryStyle, bearPrimaryWidth, bearSecondaryColor, bearSecondaryStyle, bearSecondaryWidth)
```

with:

```pinescript
    drawSet(bearLevels, bearAnchorBar, showBearish and bearAnchorReady, bearishAngles, bearTouchCutoff, bearPrimaryColor, bearPrimaryStyle, bearPrimaryWidth, bearSecondaryColor, bearSecondaryStyle, bearSecondaryWidth)
```

- [ ] **Step 3: Change the `countRows` signature and its filter condition**

Replace lines 382–388 — the whole `countRows` function:

```pinescript
countRows(array<GannLevel> levels, bool visible, string filterMode) =>
    total = 0
    if visible
        total := 1
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode)
                total += 1
    total
```

with:

```pinescript
countRows(array<GannLevel> levels, bool visible, string filterMode, float touchCutoff) =>
    total = 0
    if visible
        total := 1
        for lvl in levels
            if passesFilter(lvl.isPrimary, filterMode) and passesTouchFilter(lvl, touchCutoff)
                total += 1
    total
```

- [ ] **Step 4: Update both `countRows` call sites**

Replace lines 401–402:

```pinescript
        bullRowCount = countRows(bullLevels, bullTableVisible, bullishAngles)
        bearRowCount = countRows(bearLevels, bearTableVisible, bearishAngles)
```

with:

```pinescript
        bullRowCount = countRows(bullLevels, bullTableVisible, bullishAngles, bullTouchCutoff)
        bearRowCount = countRows(bearLevels, bearTableVisible, bearishAngles, bearTouchCutoff)
```

- [ ] **Step 5: Update both table row-writing loop guards**

Replace line 422:

```pinescript
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bullishAngles)
```

with:

```pinescript
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bullishAngles) and passesTouchFilter(lvl, bullTouchCutoff)
```

Replace line 434:

```pinescript
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bearishAngles)
```

with:

```pinescript
                if nextRow < rowCount and passesFilter(lvl.isPrimary, bearishAngles) and passesTouchFilter(lvl, bearTouchCutoff)
```

- [ ] **Step 6: Verify by self-review**

Read the file back and confirm each, reporting the actual result:

1. `drawSet` and `countRows` each take `float touchCutoff` **immediately after `filterMode`**, and every call site passes its arguments in that same order. Quote all four call sites and check each argument against its parameter position by name. A cutoff landing in a `color` slot is the most likely failure here.
2. The bullish sites pass `bullTouchCutoff` and the bearish sites pass `bearTouchCutoff` — all four. No crossed sides.
3. **The row-count/row-write invariant.** `countRows(bullLevels, bullTableVisible, bullishAngles, bullTouchCutoff)` and the bullish row loop's guard must apply identical filtering. Quote both and compare term by term; then do the same for the bearish pair. If they diverge the table is mis-sized.
4. Both `drawSet` and `countRows` still end on an expression (`array.size(drawnLines)` and `total`).
5. `drawStartLine` and `drawTimeCycles` were **not** given a cutoff parameter and their call sites are unchanged. Start lines and time cycles are not levels and are not touch-tracked.
6. Grep for `passesFilter(` and confirm every remaining call site that iterates levels is now paired with a `passesTouchFilter` call. List each hit and say whether it is paired, and if not, why that is correct.
7. `math.min(neededRows, 100)` and every `nextRow < rowCount` guard are unchanged, and no `max_lines_count` / `max_labels_count` / `max_boxes_count` / `max_bars_back` value was touched. The filter only removes, so none of them needed changing.
8. Work through the table arithmetic for `maxTouchedLevels = 0`, Square of 9, bullish only, every level touched: state what `countRows` returns, what `neededRows` and `rowCount` become, and how many rows are actually written. Confirm the highest index written is strictly less than `rowCount` and that the bullish start row still appears.
9. Work through the same for `maxTouchedLevels = 100` with 32 levels all touched, and confirm the result is identical to the pre-change behaviour — every level shown.

- [ ] **Step 7: Full-file cross-check against the spec**

Re-read `docs/superpowers/specs/2026-08-06-touched-level-cap-design.md` alongside the finished file and confirm, reporting each result:

1. The cutoff respects the angle filter — quote the condition inside `touchedCutoff` proving distances come only from angle-filter-admitted levels.
2. Pending levels are never filtered — quote the first clause of `passesTouchFilter`.
3. The cap is per direction — confirm two independent cutoffs exist and neither side reads the other's.
4. The time table is untouched — grep the `TIME TABLE` section for `passesTouchFilter` and `TouchCutoff` and confirm zero hits.
5. Run `git diff 9ea2336 -- src/gann-angles.pine` and confirm every hunk is either the new section, the new input, or one of the ten edited lines named in Tasks 1 and 2 (2 signature lines + 2 in-function filter conditions + 4 call sites + 2 table row-loop guards). Report any hunk that is not.

- [ ] **Step 8: Commit**

```bash
git add src/gann-angles.pine && git commit -m "feat: apply touched-level cap to level lines, labels and table rows"
```

---

## Deferred human verification (TradingView)

Not executable in this environment — there is no Pine compiler here. Hand these to the user after Task 2:

- On the SKPC monthly chart, confirm the levels table drops from ~35 rows to about 7, and that the surviving touched levels are the ones bracketing current price.
- Confirm each filtered level loses its line, its price label and its table row together — no line on screen without a row, no row without a line.
- Set `Max Touched Levels` to `0` and confirm only `Pending` levels and the start line remain.
- Set it to `100` and confirm every level returns, matching the previous behaviour exactly.
- Set `Bullish Angles` to `Primary only` with the cap at 5 and confirm 5 touched **primary** levels survive — not 5 picked from all angles and then thinned to 2 by the angle filter.
- Confirm the table is correctly sized in every case above: no blank trailing row, no truncated last level.
- Switch to Gann Square mode and confirm the empty `bearLevels` array causes no error.
- Confirm a side whose touched levels are all filtered out still shows its start row.
- Confirm the time table is unchanged throughout.
