# ICT Indicator — Visual Enhancements & RSI Confirm Fix — Design

**Date:** 2026-08-04
**Status:** Approved for planning
**Builds on:** [2026-08-04-ict-rsi-ma-indicator-design.md](2026-08-04-ict-rsi-ma-indicator-design.md)

## Purpose

Three changes to the existing `src/ict-rsi-ma-indicator.pine`:

1. **Bug fix:** the bullish/bearish confluence signals never fire in practice.
2. **Enhancement:** label each FVG/order-block box with its type.
3. **Enhancement:** draw a dotted line from the broken swing to the breaking candle on BOS/CHoCH.

No new architecture — all three land in the existing single-script structure, in the existing sections.

## 1. RSI Confirmation Fix (bug)

**Root cause:** `rsiBullishConfirm`/`rsiBearishConfirm` currently require RSI to be at an oversold/overbought extreme (`rsiValue <= rsiOversold` / `rsiValue >= rsiOverbought`, default ≤30 / ≥70). The confluence signal ANDs this together with a fresh same-direction structure break and price already above/below the MA. An RSI extreme rarely coincides with those other conditions at the same bar — a fresh bullish break with price already trending above the MA is a momentum state, not an oversold state. The compound AND of independently rare conditions makes the signal effectively never fire.

**Fix:** redefine RSI confirmation as a midline check, matching momentum direction instead of an extreme:
- `rsiBullishConfirm = rsiValue > 50`
- `rsiBearishConfirm = rsiValue < 50`

**Side effect to handle:** the RSI on-chart readout label's " OB"/" OS" suffix (added in a previous fix pass) currently reads these same two booleans to decide whether to show "OB" (overbought) or "OS" (oversold). Redefining them to a midline check would silently break that label's meaning. Decouple: introduce two new booleans dedicated to the readout, using the original threshold inputs:
- `rsiOverboughtState = rsiValue >= rsiOverbought`
- `rsiOversoldState = rsiValue <= rsiOversold`

The label's suffix logic switches from `rsiBearishConfirm`/`rsiBullishConfirm` to `rsiOverboughtState`/`rsiOversoldState`. `rsiOverbought`/`rsiOversold` inputs remain unchanged and still drive the readout label; they no longer drive the confluence signal.

## 2. FVG / Order Block Box Labels

Each box (bullish FVG, bearish FVG, bullish OB, bearish OB) gets a small text label at creation:
- FVG boxes: text `"FVG"`
- OB boxes: text `"OB"`
- Label color matches its box's existing color (teal/red for FVG, blue/purple for OB); positioned at `x = box's left bar index`, `y = box top` (the box's top edge, for both bullish and bearish boxes — simplest consistent anchor, avoids needing direction-specific placement), small size, `style = label.style_label_down` so the text hangs just below that top edge, inside the box.

**Lifecycle:** labels must be deleted in lockstep with their box — on mitigation (first-touch removal) and on capacity eviction (oldest dropped past `fvgMaxCount`/`obMaxCount`). Since boxes live in typed `array<box>`, labels need a parallel `array<label>` per side, kept in sync by index: every `array.push` of a box is paired with an `array.push` of its label; every `array.shift`/`array.remove` of a box is paired with the same operation, at the same index, on the label array, plus `label.delete()`.

`mitigateBoxes(boxArray, isBullish)` gains a second parameter, `labelArray`, and deletes/removes the paired label alongside the box at both removal points (mitigation touch, and the existing cap-eviction shift at each creation site). This is a signature change to an existing shared function — both call sites (FVG section, Order Block section) and both callers (bullish/bearish, ×2 each = 4 call sites) update to pass the new parameter.

## 3. BOS/CHoCH Dotted Lines

On a confirmed break (BOS or CHoCH, either direction), draw a horizontal dotted `line.new()` from the broken swing's bar to the breaking bar, at the swing's price level:
- Bullish BOS: lime, bullish CHoCH: green (matches existing label colors)
- Bearish BOS: red, bearish CHoCH: maroon
- `style = line.style_dotted`

**New state needed:** the swing tracking currently only stores the swing's *price* (`lastSwingHigh`/`lastSwingLow`), not which bar it occurred on. Since `ta.pivothigh`/`ta.pivotlow` confirm `pivotLookback` bars after the actual pivot, the pivot's real bar index at confirmation time is `bar_index - pivotLookback`. Add `var int lastSwingHighBarIndex = na` / `var int lastSwingLowBarIndex = na`, set alongside the existing price capture (`lastSwingHighBarIndex := bar_index - pivotLookback` when a new `swingHigh` confirms, mirrored for lows).

The line is drawn inside the existing break-detection `if` blocks (Market Structure section), using the captured price and bar index *before* they're reset to `na` for the next swing search — same place the existing BOS/CHoCH labels are drawn, so the line and label appear together.

## Testing / Verification

Same constraint as the base project: no automated test framework, no live TradingView compile-check available in this environment. Verification is manual Pine v6 syntax/logic self-review during implementation, plus a deferred human pass in TradingView covering:

- Confirm bullish/bearish signal triangles now appear during normal market conditions (the actual bug being fixed) — this is the highest-priority check.
- Confirm each FVG/OB box shows its type label, and the label disappears exactly when its box does (mitigation and cap eviction).
- Confirm a dotted line appears at each BOS/CHoCH, spanning from the correct swing bar to the breaking bar, at the correct price level.
- Confirm the RSI readout label's OB/OS suffix still reflects the original 70/30 thresholds (unchanged behavior), independent of the new midline confluence logic.
