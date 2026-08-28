# EGX Backtest Verification — Design

**Date:** 2026-08-29
**Status:** Design approved, execution not yet started
**File under test:** `src/ict-rsi-ma-indicator.pine`
**Depends on:** [[trade-system-roadmap]] (all 10 roadmap features merged), [[pine-has-no-test-framework]]

## Purpose

The indicator has never been read against real EGX price action. Every design decision so far —
score weighting, the killzone veto, the trailing-stop-model risk floor — was reasoned about or
tested on whatever TradingView loaded incidentally. This is the first deliberate pass: drive
TradingView with Playwright across a fixed set of EGX symbols and timeframes, read what the script
actually shows, and turn what's wrong or missing into a prioritized backlog.

There is no ground-truth backtest to diff against. "Verification" here means checking the chart and
panel against the behavior the README documents — internal consistency, structural sanity, and the
EGX-specific risk areas the README already names — not a pass/fail suite.

## Scope

**In scope:**
- 5 EGX symbols × 5 timeframes × 2 settings profiles = 50 chart views, each screenshotted and read.
- Logging anomalies as either **bugs** (contradicts documented behavior) or **enhancement ideas**
  (works as designed, but EGX evidence suggests a better default or a new toggle).
- A written backlog, ranked, at the end.

**Out of scope:**
- Any code change to the `.pine` file itself — this pass produces a backlog, not a patch. Fixes are
  separate work items after this plan closes.
- Symbols or markets outside the five named tickers.
- Building an external/automated backtest harness — the panel's own `PERFORMANCE` block is the
  measurement tool, per [[pine-has-no-test-framework]].

## Symbols and timeframes

| | Value |
|---|---|
| Symbols | `EGX_DLY:ELEC`, `EGX_DLY:ABUK`, `EGX_DLY:ORWE`, `EGX_DLY:AMOC`, `EGX_DLY:MASR` (confirmed via TradingView symbol search; the resolved exchange prefix is `EGX_DLY`, not the `EGX` shown in the search-result badge) |
| Timeframes | 1M, 1W, 1D, 4H, 1H |

Five timeframes, not six — the original list repeated 1D; confirmed as a typo and dropped.

## Settings profiles

Two passes per symbol/timeframe, chosen to test the indicator both as shipped and as the README
itself recommends configuring it for this exact market:

1. **Baseline** — script defaults, untouched.
2. **EGX-tuned** — `Long Trades Only` on (cash equity, no shorting), `Score: Killzone` off
   (single-session market, killzone is meaningless), and `Stop on Close Only` on for the 1D/4H/1H
   views only. 1M/1W stay close-only-off since that flag targets thin intrabar wicks, not
   weekly/monthly bars where a whole bar is the unit anyway.

Both profiles read from the same saved chart layout so switching between them is a settings-dialog
change, not a re-paste of the script.

## What counts as a finding

For every view, check and note:

- **Internal consistency** — does the `PERFORMANCE` panel's n / win rate / avg R / total R agree
  with the visible trade-history exit labels on screen; does a live trade's entry/stop/targets math
  match what's drawn.
- **Structural sanity** — spot-check 2-3 BOS/CHoCH labels against visible swing points; do they
  land where the README's state machine says they should.
- **EGX-specific risk areas** — does the Participation point have real volume data or silently drop
  out of the denominator; label crowding on the 500-label budget (same-bar exit collisions were
  already fixed once — confirm it holds here too); is Range vetoing sensibly on a thin market.
- **Rendering bugs** — panel overflow, clipped labels, misplaced drawings, anything visually broken.

A finding is only worth logging if it's reproducible on screen — a one-off render glitch that
doesn't survive a refresh isn't a bug, it's noise.

## Session mechanics

- Playwright attaches to the user's already-open, already-logged-in TradingView browser tab — no
  credentials handled by the agent.
- **Step 0:** confirm logged-in state and whether the indicator already exists under *My Scripts*.
  If not, paste `src/ict-rsi-ma-indicator.pine` into the Pine Editor once, save it, and add it to
  the chart.
- **Per combo:** set symbol → set timeframe → apply settings profile → screenshot → read
  `PERFORMANCE`, `Confirm`, and `Gate` panel rows → note findings inline in the plan doc.
- If a leftover drawing obstructs a view, the session pauses and the user hides it manually before
  continuing (per the user's own instruction — this is a collaborative, not fully autonomous,
  session).
- 50 views is a long session; it may run across more than one sitting. The companion plan doc is
  the resumable record of what's been covered.

## Deliverable

- This design doc.
- A companion plan doc (`docs/superpowers/plans/2026-08-29-egx-backtest-verification.md`) with the
  concrete step-by-step session, written via the writing-plans skill.
- Findings and the enhancement backlog appended to the plan doc as the session runs, then
  summarized back to the user at the end and, if the user wants, turned into new roadmap items
  following the existing plan/spec pattern.
