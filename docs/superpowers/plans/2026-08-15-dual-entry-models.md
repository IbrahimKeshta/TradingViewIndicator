# Dual Entry Models with Separated Records — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the engine run a second, independent entry model alongside the ICT pullback model, each holding its own trade slot and its own performance record, so the two can be judged separately rather than averaged into one indistinguishable number.

**Motivating case:** ORWE 1D, August 2026. Price ran ~21% with no retrace into any FVG or order block, so the pullback model took nothing. The zone that would have supplied the entry (OB 22.6–23.0) was *created by* the break that started the move — zones are drawn behind an impulsive leg and, per `mitigateZones` running before zone creation, are first testable one bar later, by which time price had closed ~2.3 EGP above. That zone was never touchable. No relaxation of the touch rule reaches this trade; only a model that does not depend on ICT zones does.

**Why a trailing-stop flip and not a breakout:** a consolidation-breakout entry triggers on the break of the July base high (~23.4), which on this move means entering at the ~25.30 close of a 4.1× ATR candle with the stop at ~22.28 — 3.0 of risk for a move that has since delivered 0.81. The reference indicator on the same chart entered 23.02 with a 22.20 break-and-close stop (~1.6× ATR), *mid-consolidation, before any breakout*, and is open at ~3.8R. That signature — flip entry, ATR-distance stop, open-ended trend target — is an ATR trailing-stop system. That is the model this plan builds. **This is inference from a chart screenshot, not from the reference indicator's source.**

**Architecture:** Two fixed slots in an `array<Trade>` — index 0 pullback, index 1 trailing-stop. The existing exit/lifecycle logic is lifted verbatim into a function that mutates a `Trade` passed by reference and reports whether it closed; that function is then called once per slot. Performance counters become model-indexed arrays. Entry conditions, drawing and panel rows loop over slots. **The pullback model's entry logic, scoring, targets and exit rules are not modified at all** — only relocated.

**Tech Stack:** Pine Script v6 (TradingView). No package manager, no automated test framework — verification is manual Pine v6 syntax/logic self-review plus a deferred human pass in TradingView's Pine Editor.

**Starting point:** `src/ict-rsi-ma-indicator.pine` at commit `c15ca22` on branch `claude/trade-calculation-issue-5uow27`, 1379 lines. This plan modifies that file in place plus `README.md`. **All line numbers shift as tasks land — always locate code by its text, not by line number.**

## Acceptance Test (run this first, record the numbers)

With `Entry: Trailing Stop Model` **off**, the panel must read **exactly** what it reads today on ORWE 1D:

| | Baseline |
|---|---|
| `n` | 112 |
| Total R | −25.28R |
| A grade | −0.79R (17) |
| B grade | −0.12R (95) |
| C grade | — (0) |

Any movement in these numbers with the new model off means shared state was touched, and is a bug regardless of how good the new model looks. This is the single most important check in the plan.

**These numbers are only a baseline against the settings that produced them.** They were read with `Score: Killzone` off and the three exit modes on. Every other input changes them too, so re-test with the same configuration or the check proves nothing.

## Validation record

Both load-bearing Pine assumptions were checked against this file rather than assumed:

| Assumption | Evidence |
|---|---|
| A UDT passed to a function can have its fields mutated, and the caller sees it | `mitigateZones(…, Touch t)` sets `t.hit` / `t.top` / `t.bottom`; the trade gate reads `bullTouch.hit` afterwards |
| The same function can be called several times per bar with different UDT objects | `mitigateZones` is called 4× per bar across the FVG and OB arrays |
| Multi-value returns work | `[ofPts, got]` in `scoreTally`, `[bp, bl]` in `scanArray` |
| `advanceTrade` holds no series state that would break across two call sites | Its body reads `close`/`high`/`low`/`open`, `intState`, the precomputed `structAtr` series and `trailAnchor()` (an array scan). No `ta.*` call, no `var`, inside it |

Unproven constructs were designed out rather than risked: no UDT array with an `na` initial value, and the Chandelier direction latch lives at global scope so no `var` sits inside a multi-call-site function.

## Global Constraints

Carried forward from previous plans — all still apply:

- **Pine v6: a user-defined function's last statement must be an expression yielding a value.** A bare `if` or `for` as the final statement is a compile error.
- **Pine has no nested function definitions.**
- **Do not write `cond and someUdt.field`.** Pine does not guarantee short-circuit evaluation and reading a field of a `na` object is a runtime error. `not na(x)` is safe because it does not dereference; every field access sits inside the guarded block.
- **Loop-direction footgun:** `for i = X to Y` runs *descending* when `Y < X` rather than skipping.
- **Do not rely on `/` between two ints returning an int.**
- **`rr` is always `|entry − initialStop|`, never the trailed `stop`.**
- **Accumulation is never gated by a display input.**
- **Do not change `max_boxes_count` / `max_labels_count` / `max_lines_count`** — all already 500.
- **`README.md` ships in the same commits as the code that changes it.**
- **No live TradingView compile-check is available in this environment — do not claim one was performed.**

New constraints specific to this plan:

- **Every panel row base must derive from the same expression as the row count passed to `table.new`, and must include *every* optional block above it.** This is not theoretical: `statsBase` was left as `5 + confirmRows + tradeRows` when the gate row was added, so `PERFORMANCE` overwrote the gate row and it silently vanished — `table.cell` overwrites without error. With per-slot trade rows the bases now shift by a *variable* number of rows, so derive them, never count them by hand.
- **Pine UDTs are reference types: a function CAN mutate the fields of a `Trade` passed to it, and the caller sees it.** This is what makes one lifecycle function serve two slots.
- **A function CANNOT rebind the caller's variable.** Assigning to the parameter only rebinds locally. Setting a slot to `na`, and creating a new `Trade`, must happen at the call site via `array.set`.
- **Call the lifecycle function unconditionally, once per slot, and gate inside it.** Calling it inside a ternary or an `if` is conditional execution and risks inconsistent history.
- **The two slots must never share a `Trade` object.** `array.set(slots, 1, array.get(slots, 0))` would alias them and both would mutate together.
- **A model that is switched off must not accumulate, draw, or occupy its slot** — it must be inert, not merely hidden.
- **Do not change `selectTargets` or `minTargetR` globally.** The trailing-stop model needs its own target floor; the pullback model's target selection must produce byte-identical results. Pass the floor in as a parameter rather than reading the input inside.
- **`stopBufferMult` is shared and stays shared** — it is a noise-tolerance measure, not a per-model risk setting.

---

### Task 1: Lift the lifecycle into a per-slot function

**Files:** Modify `src/ict-rsi-ma-indicator.pine`

- [ ] Add `advanceTrade(Trade t)` immediately after `blendedResultR`, containing the *verbatim* body of the existing `if barstate.isconfirmed and tradeIsLive()` exit block with `activeTrade` renamed to `t`. Returns `bool` — whether the trade closed on this bar.
- [ ] Guard inside the function, not at the call site: `if not na(t)` then `if na(t.closeReason)` then the existing logic. Nested, never `and`-chained.
- [ ] Keep `targetJustHit` assignment out of the function (it is a global per-bar alert flag). Return it as the second element of a tuple: `[closed, hitTarget]`.
- [ ] Do not change any exit rule, the stop-first ordering, the gapped-exit `math.min`/`math.max`, TP flag setting, the CHoCH check, or the trailing stop.

**Verification:** The function body diffs against the old block only in the identifier `activeTrade` → `t` and the added guards.

### Task 2: Two slots

**Files:** Modify `src/ict-rsi-ma-indicator.pine`

**Revised after validation — two explicit vars, not an array.** The original plan called for `array.new<Trade>(2, na)`. Rejected: nothing in this file constructs a UDT array with an `na` initial value, so it would be the one unproven construct in the change, and array storage is also what makes the aliasing risk possible in the first place. Two named vars make aliasing structurally impossible and use only constructs already proven here.

- [ ] Keep `var Trade activeTrade = na` **under its existing name** for the pullback model — every DBG plot, drawing block and panel reference to it then stays untouched, which shrinks the diff and protects the acceptance test.
- [ ] Add `var Trade trailTrade = na` for the second model.
- [ ] Add `tradeLiveOf(Trade t)` — the existing `tradeIsLive()` nesting, parameterised. Keep `tradeIsLive()` as a wrapper so existing call sites do not change.
- [ ] Call `advanceTrade` once per slot, unconditionally, at the same point in the script the old exit block occupied.
- [ ] Duplicate the result-recording and slot-free blocks per slot rather than looping — two call sites of shared helper functions, no `for` over UDT storage.
- [ ] `tradeOpenR` stays scalar and keeps meaning the pullback slot, so existing DBG plots are unchanged; add `trailOpenR` alongside.

**Verification:** With the new model off, `trailTrade` is never assigned, so every new block short-circuits on `na` and the pullback path is byte-identical.

### Task 3: Model-indexed performance counters

**Files:** Modify `src/ict-rsi-ma-indicator.pine`

- [ ] Convert `statTrades` / `statWins` / `statLosses` / `statSumR` to `array.new<int|float>(2, …)`.
- [ ] Convert `statGradeCount` / `statGradeSumR` to 6 slots indexed `model * 3 + gradeIndex`.
- [ ] Accumulate under the closing trade's own model index.
- [ ] Panel renders one `PERFORMANCE` block per **enabled** model. With the trailing model off, exactly one block renders with the header text `PERFORMANCE` — unchanged from today. With both on, headers read `PERFORMANCE · PULLBACK` and `PERFORMANCE · TRAIL`.

**Verification:** the acceptance test above. Model 1 counters stay at zero when the model is off, so block 1 is not rendered and the row count is unchanged.

### Task 4: The trailing-stop entry model

**Files:** Modify `src/ict-rsi-ma-indicator.pine`

- [ ] New input group `Trailing Stop Model`, all defaults inert: `useTrailModel` (**off**), `trailAtrLength` (14), `trailAtrMult` (2.0), `trailMinTargetR` (1.0), `trailRequiresTrend` (on), `trailScored` (off).
- [ ] Compute a Chandelier-style stop line: long stop = `highest(high, len) − mult × ATR`, short stop = `lowest(low, len) + mult × ATR`, ratcheting in the trade's favour only and flipping side when price closes through it. Direction is a `var int` so the flip persists.
- [ ] Entry fires on the **flip bar** only — a discrete event, like `bullBreak`, so entries never become a continuous state.
- [ ] Stop is the trail line at entry. Risk is therefore ~`trailAtrMult × ATR`, not zone height.
- [ ] Targets via `selectTargets` with `trailMinTargetR` passed as a parameter — `selectTargets` gains a `floorR` argument and the pullback call site passes `minTargetR`, preserving its behaviour exactly.
- [ ] `trailRequiresTrend` gates the flip on `intState.trend` agreeing. `trailScored` optionally applies the same `minScore` gate; **off by default**, because the score is currently anti-predictive (A −0.79R vs B −0.12R over 112 trades) and gating a new model on it would import that problem.
- [ ] `longOnly` applies to this model too.

**Verification:** Hand-trace against ORWE July 2026 — a flip long near 23.0 with a stop near 22.2 is the expected signature. If the trace produces an entry at the 25.30 breakout close instead, the model is wrong and Task 4 restarts.

### Task 5: Drawing and panel for two live trades

**Files:** Modify `src/ict-rsi-ma-indicator.pine`

- [ ] `tradeBox` becomes one box per slot.
- [ ] Trade level lines/labels loop over live slots; existing `tradeLines`/`tradeLabels` arrays already clear and redraw each bar and can hold both sets.
- [ ] A trailing-model trade has no zone: populate `zoneTop`/`zoneBottom` with entry and stop so the box still draws, and tag the panel row `TRAIL` so it is never mistaken for a zone entry.
- [ ] `tradeRows` counts live slots × 6. Every downstream base derives from it.
- [ ] Gate row reports the pullback model as today; when the trailing model is on, append its state.

**Verification:** row-count arithmetic written out explicitly in a comment, per the new constraint.

### Task 6: Alerts and README

**Files:** Modify `src/ict-rsi-ma-indicator.pine`, `README.md`

- [ ] `tradeOpened` stays "any slot opened" so existing alerts keep firing as before; add per-model `alertcondition`s alongside rather than replacing.
- [ ] README: new section for the second model, its settings table, the separated-records explanation, and an explicit statement that the two models hold independent slots and therefore never block each other.

---

## Risks

| Risk | Mitigation |
|---|---|
| The lifecycle lift changes pullback behaviour by accident | Acceptance test — `n = 112`, `−25.28R` with the model off |
| Row-base arithmetic silently eats a panel row again | Derive every base; write the arithmetic out in a comment |
| Slot aliasing makes two trades mutate together | Never assign one slot's object to another; always construct fresh |
| The new model performs worse and muddies the record | Separate slots and separate counters are exactly what makes this readable rather than a confound |
| Inferred reference logic is wrong | Stated as inference; the model is judged on its own record, not on matching a screenshot |
| Panel becomes unusably tall — two live trades plus two performance blocks is 5 + 1 + 1 + 12 + 14 = 33 rows | Second performance block renders only when its model is enabled; `Show Trade Panel Rows` and `Show Performance Rows` already gate the bulk of it. Revisit only if it is actually a problem in use |
