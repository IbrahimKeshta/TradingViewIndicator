# Gann Angles Indicator — Design

**Date:** 2026-08-04
**Status:** Approved for planning

## Purpose

A new, standalone TradingView Pine Script v6 indicator that auto-calculates and draws Gann angle tools from an auto-detected (or manually overridden) swing anchor:

- **Gann Fan** — the 9 standard angle ratios fanning from a single anchor point.
- **Gann Square (Box)** — a gridded rectangle between the anchor and its opposite swing, with the same angle ratios drawn as bounded diagonals.
- **Square of 9** — cardinal support/resistance price levels derived from the anchor price via the sqrt-based Gann formula, shown as horizontal rays (since Pine can't render an actual spiral).
- **Gann Time Levels** — vertical lines at standard Gann cycle counts forward from the anchor bar, independent of which price mode is active.

A price/time-target table lists the active mode's levels and whether each has been touched (price) or reached (time).

## Scope (v1)

In scope: all four tools above (Fan, Square/Box, Square of 9, Time Levels), auto or manual anchor, ATR-based angle scaling, and the target table.

Explicitly out of scope for v1: user-editable angle-ratio sets or time-cycle-number sets (both use fixed standard lists), alerts on angle/level touch (the existing ICT script already owns alerting patterns; this script is visual/reference only for v1), multiple simultaneous anchors, and any true Square-of-9 spiral graphic (Pine has no primitive for it — horizontal rays from the derived cardinal prices are the standard adaptation).

## Relationship to the existing ICT script

This is a **new, separate file** (`src/gann-angles.pine`), not an addition to `src/ict-rsi-ma-indicator.pine`. Gann analysis is conceptually unrelated to ICT/RSI/MA, and the existing script is already sized close to its drawing-object pool limits (200 boxes, 500 labels, 200 lines) from FVG/OB/structure tracking. Keeping this separate avoids competing for that budget and keeps each script focused on one method. There is no shared code file between the two scripts — Pine has no lightweight cross-script import without publishing a library, and the one function worth reusing (swing-pivot detection) is small enough that duplicating it here is simpler than standing up a library for it.

## Architecture

Single self-contained Pine Script v6 `indicator()`, overlay on the price chart. One shared **anchor engine** (swing-pivot detection, same style as the ICT script's structure logic) feeds all four drawing tools. Only one of Fan / Square (Box) / Square of 9 draws at a time, selected by a mode switch; Time Levels is an independent toggle that can be shown alongside whichever price mode is active.

### Input groups

- **Mode** — `Gann Fan` / `Gann Square` / `Square of 9` (dropdown, default `Gann Fan`)
- **Anchor** — `Anchor Mode` (`Auto (Swing)` / `Manual`, default `Auto (Swing)`), `Swing Pivot Lookback` (default 5), and for Manual mode: `Manual Anchor Time`, `Manual Anchor Price`, `Manual Anchor Type` (`Low (up-angles)` / `High (down-angles)`)
- **Scaling** — `ATR Length` (default 14) — defines the price-per-bar unit for the 1x1 (45°) slope
- **Gann Square** — `Box Grid Divisions` (default 8)
- **Square of 9** — `Number of Rings` (default 2)
- **Time Levels** — `Show Gann Time Levels` (default false)
- **Display** — `Show Price/Time Target Table` (default true), `Table Position` (default top-right), `Forward Projection (bars)` (default 100 — how far right of the current bar lines/rays extend)

### Modules

1. **Anchor engine** — tracks the most recently confirmed swing (high or low, whichever is newer) as the primary anchor, mirroring the ICT script's `ta.pivothigh`/`ta.pivotlow` + bar-index-capture pattern. Separately tracks the most recent *opposing*-type swing (the nearest swing of the other kind) for the Gann Square's second corner. In Manual mode, the primary anchor is instead the user's `Manual Anchor Time`/`Manual Anchor Price`/`Manual Anchor Type`, and the opposing-swing lookup is skipped — if Gann Square mode is selected while in Manual anchor mode, the opposite corner falls back to the most recent auto-detected opposing swing (manual override only pins the primary anchor).
2. **Scaling engine** — `ta.atr(atrLength)` defines the price-per-bar unit; the 1x1 ratio's slope equals this unit, other ratios scale it per the standard ratio table below. Recomputed every bar, independent of anchor changes.
3. **Gann Fan renderer** — draws the 9 standard ratio lines from the anchor as `line.new`, extended to `bar_index + Forward Projection`. Direction: up-angles (rising) if the anchor is a swing low, down-angles (falling) if a swing high. Ratios and colors:

   | Ratio | Slope (× ATR unit) | Color |
   |-------|---------------------|-------|
   | 1x8   | ÷8  | orange (secondary) |
   | 1x4   | ÷4  | orange (secondary) |
   | 1x3   | ÷3  | orange (secondary) |
   | 1x2   | ÷2  | orange (secondary) |
   | 1x1   | ×1  | **blue (major)** |
   | 2x1   | ×2  | orange (secondary) |
   | 3x1   | ×3  | orange (secondary) |
   | 4x1   | ×4  | orange (secondary) |
   | 8x1   | ×8  | orange (secondary) |

4. **Gann Square (Box) renderer** — `box.new` outer rectangle between the primary anchor and its opposite-swing corner, subdivided into an N×N grid (`Box Grid Divisions`, default 8) with thin neutral-gray grid lines. The same 9 ratio diagonals from module 3 are drawn from the anchor corner, bounded within the box's time/price extent (not extended past the box), same blue/orange convention as the Fan.
5. **Square of 9 renderer** — center = primary anchor price. Direction follows the same anchor-type convention as the Fan: a low anchor projects levels upward (resistance targets), a high anchor projects levels downward (support targets) — never both, keeping the level count fixed regardless of anchor type. For ring `r` (1-indexed, `r = 1..Number of Rings`), the ring's 4 levels are `(sqrt(anchorPrice) ± k×0.5)²` for `k = 4r-3, 4r-2, 4r-1, 4r` — the four 90° steps of that ring's rotation — using `+` for an up-projecting (low) anchor and `−` for a down-projecting (high) anchor. Drawn as horizontal `line.new` rays from the anchor bar, extended to `bar_index + Forward Projection`. Ring 1 (nearest) in blue (major), rings 2+ in orange (secondary).
6. **Gann Time Levels renderer** — independent of the mode switch. When enabled, draws a vertical dotted `line.new` at `anchor_bar + N` for each of the standard Gann cycle numbers: 30, 45, 60, 90, 120, 144, 180, 270, 360. Major cycles (90, 180, 270, 360 — the "square" numbers) in blue, the rest (30, 45, 60, 120, 144) in orange.
7. **Price/Time-target table** — `table.new`, positioned per `Table Position`. Two sections:
   - **Price section** (rows = the active mode's angles/levels only — 9 for Fan, 9 for Square diagonals, `rings × 4` for Square of 9): columns Label, Price, Status (`Touched` / `Pending`).
   - **Time section** (only rendered if `Show Gann Time Levels` is on; rows = the 9 cycle numbers): columns Label (e.g. `T+90`), Target Bar, Reached (`Yes` / `No`).

## Data flow (per bar)

1. Update swing-pivot state (primary anchor + opposing swing for the Box), same confirmation-lag pattern as the ICT script (`pivotLookback` bars late — expected, non-repainting).
2. When a new anchor is detected (a new swing confirms, replacing the previous one — or the user edits Manual Anchor inputs), delete all existing drawings for every tool (Fan/Box/Square-of-9/Time-Levels lines, box, grid) and reset every level's sticky-touched flag. This is a full re-anchor: old drawings never persist alongside new ones.
3. Recompute the ATR-based price-per-bar unit every bar (does not require a re-anchor).
4. Update each active line's forward endpoint to `bar_index + Forward Projection` every bar.
5. Update each price-mode level's sticky touched-flag: once true (bar's `high`/`low` has crossed the level/line), stays true until the next re-anchor.
6. Update each time-level's `Reached` flag: true once `bar_index >= anchor_bar + N` (monotonic, no reset needed within a given anchor).
7. Redraw the table on `barstate.islast` from current state.

## Defaults

- ATR Length: 14
- Swing Pivot Lookback: 5
- Box Grid Divisions: 8
- Square of 9 Rings: 2
- Forward Projection: 100 bars
- Time Levels: off by default
- Mode: Gann Fan

## Error Handling & Limits

Because every tool deletes and fully redraws its own lines/box on each re-anchor rather than accumulating history, object counts stay small and bounded regardless of chart length:

- Gann Fan: 9 lines
- Gann Square: 9 diagonals + up to 16 grid lines (8 divisions × 2 directions) + 1 box ≈ 26 objects
- Square of 9: `rings × 4` lines (8 at the default 2 rings)
- Time Levels: 9 additional lines when enabled

All well under Pine's 500-line / 500-box pool caps. Manual-anchor inputs are validated only by Pine's own input constraints (no additional runtime validation needed — a manual price/time simply defines where drawing starts).

## Testing / Verification

Same constraint as the existing project: no automated test framework, no live TradingView compile-check available in this environment. Verification is manual Pine v6 syntax/logic self-review during implementation, plus a deferred human pass in TradingView covering:

- Switch between all three price modes (Fan / Square / Square of 9) and confirm each renders the expected geometry from the same anchor.
- Confirm 1x1 (Fan/Square) and the nearest Square-of-9 ring render in blue; all other ratios/rings in orange.
- Confirm the price-target table's Status column flips to `Touched` when price crosses a line/level, and stays `Touched` until the anchor changes.
- Enable Time Levels and confirm vertical lines appear at the correct bar offsets, with the table's Time section `Reached` column flipping at the right bar.
- Switch Anchor Mode to Manual, set a time/price/type, and confirm all tools re-anchor to that point instead of the auto-detected swing.
- Confirm a new swing (re-anchor event) clears all previous drawings rather than layering new ones on top.
