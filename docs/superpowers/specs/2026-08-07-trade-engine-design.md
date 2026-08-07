# Trade Engine — Design

**Date:** 2026-08-07
**Status:** Implemented on `feat/trade-engine` (`abbced2`..`3909ecc`) — TradingView verification pending
**File:** `src/ict-rsi-ma-indicator.pine`
**Block:** D+E of the roadmap, merged (see *Why D and E are one block*)
**Depends on:** `2026-08-07-structure-core-design.md` (block A, implemented)

## Purpose

Turn a signal marker into a trade: an entry zone, a stop, three targets, a stop that trails, and a
recorded result.

Today the indicator prints a triangle and stops there. Everything past that point — where to get in,
where the risk sits, where to take profit, when the idea is dead — is left to the reader. This block
computes all of it from structure the script already tracks.

## Why D and E are one block

The roadmap in the block A spec listed five blocks, with a signal engine (D) and a trade lifecycle (E)
as separate pieces. That split was wrong, and two other roadmap entries need correcting with it:

- **D and E are one state machine.** A trade has an entry, a stop, targets, and a stop that moves as it
  runs. Splitting creation from management means defining the same object in two specs and specifying a
  handoff that exists only because of the split.
- **Block B is not a block.** "Nearest support/resistance" is a query over block A's swing arrays, not a
  feature. As a standalone deliverable it would only draw more lines. It lives here as a function.
- **Block C stays separate and stays optional.** Volume, climax candles, MACD, Stochastic and Ichimoku
  are additive scored points. They can be added to a working trade engine later, and are better judged
  once trades are visible on the chart.

Revised roadmap: **A** (done) → **D+E, this spec** → **C** (optional confirmations).

## Scope

**In scope:** the qualification gate; the trade object and its state machine; entry zone and entry
price; stop placement; target selection from structure; the trailing stop; exit detection including
gaps; on-chart rendering; trade result history; panel rows; alerts.

**Out of scope:** position sizing and account risk (the script has no account); block C's confirmation
indicators (additive later); backtest statistics beyond the per-trade result label; multiple concurrent
trades; daily price-limit awareness (see *Deliberately not built*).

## Market context

The user runs this on EGX (Egyptian Exchange) equities, other stocks, forex and crypto. Nothing may be
hardcoded for one market. Two consequences shape the design:

- **Killzones are meaningless on a single-session market** like EGX, so the killzone condition cannot be
  a mandatory veto. This is the reason the gate is proportional rather than fixed — see below.
- **Auction opens and weekend gaps are routine**, so a stop can be jumped rather than touched. Exits are
  gap-aware.

## The gate

A setup qualifies on **hard requirements plus a proportional score**. Strict AND-gating of every
condition was rejected: each future block would make it stricter, ending in an indicator that fires
twice a year. A pure score was also rejected: without a direction and a zone there is nothing from
which to compute a stop or targets.

### Hard requirements — all four, or no trade

| Requirement | Why it is absolute |
|---|---|
| `intState.trend` is `"up"` or `"down"` | No direction, no side |
| Price touched an unmitigated FVG or order block this bar | No zone, no entry price and no stop |
| `inRange` is false | The range veto block A built and deliberately left disconnected |
| `barstate.isconfirmed` | No repainting |

The direction comes from the **internal** tier, matching the block A migration. Major-tier agreement is
scored, not required — a pullback entry against the major trend is a real setup, just a weaker one.

### Scored points — `minScore` out of however many are enabled

| Point | Enable default | Condition |
|---|---|---|
| Killzone | on | `killzoneActive` |
| RSI | on | `rsiValue > 50` for a long, `< 50` for a short |
| MA | on | `close > maValue` for a long, `< maValue` for a short |
| Major agreement | on | `majorState.trend == intState.trend` |
| Break strength | on | `intState.lastStrength >= strongBreakMult` (default 1.0) |

**The score is computed over enabled points only.** `minScore` (default 4) is checked against the count
of enabled points, and the panel displays both — `4/5`, or `3/4` on a chart with killzone off.

This proportionality is the single most important property of the gate. A disabled condition that still
counted toward a fixed denominator would either make `minScore` unreachable or silently loosen the gate
while appearing to tighten it. It is also what lets block C add points later without turning them into
vetoes.

**Killzone safety net:** if neither `showLondonKZ` nor `showNewYorkKZ` is enabled, the killzone point
excludes itself from the denominator regardless of its own toggle. Without this, a user who switched off
killzone *display* on an EGX chart would leave a permanently-false point in the denominator and wonder
why the engine went silent.

**Grades** are assigned from the achieved fraction: all enabled points = `A`, one short = `B`, two short
= `C`. Below `minScore`, no trade.

Which grades are reachable therefore depends on `minScore`. At the defaults — 5 points enabled,
`minScore` 4 — only `A` and `B` can ever appear, because a `C` scores 3 and is rejected. That is
intended, not an oversight: lowering `minScore` to 3 is what opens `C` up. The grade describes the
setup; `minScore` decides which grades are worth showing.

**This changes existing behaviour.** Killzone is currently a hard veto (line 402). As a scored point
with `minScore` at 4, a setup can qualify outside London and New York when everything else agrees. Set
`minScore` to the enabled count to restore strict behaviour.

## The trade object

```pinescript
type Trade
    string side          // "long" | "short"
    string grade         // "A" | "B" | "C"
    int    score         // achieved points
    int    scoreOf       // enabled points — both shown, never just the numerator
    float  entry
    float  stop          // moves; see trailing
    float  initialStop   // never moves — the R denominator
    float  zoneTop
    float  zoneBottom
    float  tp1
    float  tp2
    float  tp3
    bool   tp1IsLiq      // whether each target is a liquidity pool, for its label
    bool   tp2IsLiq
    bool   tp3IsLiq
    int    openBar
    int    tpHit         // 0-3
    string closeReason   // "Target" | "Stopped" | "Invalidated"
    float  closePrice
```

One trade at a time, held in a single `var Trade`. While it is open, further signals are ignored.

## State machine

```
FLAT ──gate passes──> OPEN ──stop | TP3 | CHoCH──> CLOSED ──next bar──> FLAT
```

`ARMED` and `RUNNING` were considered and rejected as states. `ARMED` is what the existing watch-zone
alert already means; building a second thing that says "get ready" would be two names for one idea.
`RUNNING` is "TP1 has been hit" — that is the `tpHit` counter, not a state.

## Entry and risk

- **Entry zone** = the touched FVG or order block's box. This is the "buy zone" — the range within which
  the setup is valid.
- **Entry price** = the signal bar's `close`. Not the zone midpoint and not the zone edge: the close is
  what a market order at that moment would actually have got. Anything else records a fill that was
  never available.
- **Stop** = `zoneBottom − stopBuffer × ATR` for a long, `zoneTop + stopBuffer × ATR` for a short.
  `stopBuffer` default 0.25, so an ordinary wick into the zone does not clip it.
- **1R** = `math.abs(entry − initialStop)`. Every R figure quoted anywhere uses `initialStop`, never the
  trailed stop — otherwise the denominator would shrink as the trade progressed and every result would
  be overstated.

`Long Trades Only` (input, default off) suppresses short *trades* on cash-equity charts where shorting
is not available. The bearish setup still marks and alerts; it just does not open a trade object.

## Targets

Candidates are every **unbroken** `SwingPoint` beyond the entry in the trade's direction, drawn from
**both tiers**, plus every point flagged `liquidity` (EQH for longs, EQL for shorts). Equal highs are
resting stop-losses and price is actively drawn to them, which is why block A records them.

Selection, in order:

1. **Deduplicate.** Two candidates within `eqTol × ATR` of each other are the same level. Keep the
   `liquidity` one.

   An earlier draft also said "failing that, the major-tier one." That is not implementable as
   written: `SwingPoint` carries no tier field — tier is expressed by *which array* holds the point —
   so the scan would need a third argument threaded through purely to break ties between two equally
   ordinary levels a fraction of an ATR apart. The liquidity preference is the one that matters,
   because it is the one that changes where price is actually headed. Requirement dropped rather than
   left as a silent gap.
2. **Filter by distance.** Discard anything closer to entry than `minR × risk` (default 1.0). A target
   0.3R away is a winner on paper and not worth the spread.
3. **Take the three nearest.**

**No sorting is used.** Pine can sort a `float` array but cannot carry the original index through the
sort, so a sorted price gives no way back to the `SwingPoint` it came from — the same wall
`gann-angles.pine` hit and solved with a cutoff distance. This uses **repeated-minimum selection**
instead: scan for the nearest qualifying level, then the nearest beyond that, three times. Each pass
keeps the `SwingPoint` itself, which is what lets a label read `TP2 · EQH` rather than a bare number,
and what populates `tpNIsLiq`.

**Fallback.** If fewer than three candidates survive, the remaining targets fill at `1R`, `2R`, `3R`
from entry, skipping any multiple that lands at or below a target already assigned. A trade always has
somewhere to go.

## Trailing stop

1. **TP1 hit** → stop moves to `entry`. The trade can no longer lose.
2. **After that**, each newly confirmed swing low (long) or high (short) from `trailTier` moves the stop
   to that level ∓ `stopBuffer × ATR` — the same buffer the initial stop uses, so the two are consistent.
3. **The stop never moves backwards.** A long's stop only ever rises.

`trailTier` (input, default `Internal`) picks which of block A's tiers supplies the swings. Internal
trails tightly; Major gives the trade room to breathe.

Targets do not move the stop beyond the breakeven step — structure leads from there. Moving the stop to
TP1 when TP2 is hit was considered and rejected: it ignores where price is actually finding support and
routinely exits mid-trend.

## Exit detection

Evaluated on each confirmed bar while `OPEN`, **in this order**. Each step runs only if the trade is
still open — a step that closes the trade ends the sequence for that bar:

1. **Stop.** Long: `low <= stop`. Short: `high >= stop`. Closes as `Stopped`.
2. **Targets.** Long: `high >= tpN`. Increment `tpHit`. TP1 moves the stop to entry.
3. **`tpHit == 3`** → closes as `Target`.
4. **Structural invalidation.** A CHoCH against the trade's side on the internal tier closes it as
   `Invalidated`, even if the stop was never touched — being wrong about structure should not require
   price to travel all the way to the stop.
5. **Trail**, per above.

**Stop is checked before targets deliberately.** When a single bar's range spans both, a bar-by-bar
script cannot know which came first, and the honest assumption is the unfavourable one. The alternative
would report profits that may never have existed.

**Gap-aware close price.** If a bar *opens* beyond the stop rather than trading down to it, the trade
closes at the `open`, not at the stop price:

```
long:   closePrice = math.min(stop, open)
short:  closePrice = math.max(stop, open)
```

On EGX auction opens and crypto weekends this is not an edge case, and without it every gapped exit
would be recorded as a clean stop-out and flatter the result history.

**Close price for the other two reasons.** A `Target` close records `closePrice = tp3` even when the bar
gapped past it — the mirror of the stop rule, conservative in both directions rather than favourable in
one. An `Invalidated` close records the bar's `close`, since a CHoCH has no price level of its own; the
exit is "at market on this bar" and the recorded R should say so.

## Rendering

| Element | Lifetime | Default |
|---|---|---|
| Entry zone box, tinted by side, labelled `LONG · A` | redrawn while open | on |
| Entry line | redrawn while open | on |
| Stop line, labelled with the current stop | redrawn while open | on |
| Three target lines, labelled with price, R multiple, and `EQH`/`EQL` where applicable | redrawn while open | on |
| Hit targets restyled (dotted) and ticked | redrawn while open | on |
| Entry triangle | **persistent** | on |
| Result label at the close bar — `+2.7R` / `−1.0R` | **persistent** | `Show Trade History`, on |

Same principle as block A: **events persist, state redraws.** The live trade's levels are a claim about
the present and are rebuilt on every `barstate.islast` pass; the entry marker and the result label are
things that happened at a bar.

The result label is the cheapest possible track record — one label per closed trade, so scrolling back
shows how the system actually performed rather than how it looks on the setup currently on screen.

**The panel extends rather than multiplies.** Trade rows are appended to block A's existing structure
panel: a `TRADE` separator, then `Setup` (`LONG · A · 4/5`), `Entry`, `Stop` with its R distance, `TP1`
through `TP3` with prices, R multiples and hit marks, and `Open R`. A second table would need its own
position input, and Pine draws only one table per screen corner — `gann-angles.pine` already carries a
tooltip warning about that exact collision. One table, no collision possible.

## Inputs

Group **Trade Engine**:

| Input | Type | Default |
|---|---|---|
| `Minimum Score` | int, 1–10 | 4 |
| `Score: Killzone` | bool | on |
| `Score: RSI` | bool | on |
| `Score: Moving Average` | bool | on |
| `Score: Major Trend Agreement` | bool | on |
| `Score: Break Strength` | bool | on |
| `Strong Break (x ATR)` | float, minval 0.1, step 0.1 | 1.0 |
| `Stop Buffer (x ATR)` | float, minval 0.0, step 0.05 | 0.25 |
| `Minimum Target Distance (R)` | float, minval 0.1, step 0.1 | 1.0 |
| `Trailing Tier` | "Internal" / "Major" | Internal |
| `Long Trades Only` | bool | off |
| `Show Trade Levels` | bool | on |
| `Show Trade History` | bool | on |
| `Show Trade Panel Rows` | bool | on |

Plus colours for the long side, the short side, stop and targets.

## Integration

1. **The triangles change meaning.** `bullishSignal` / `bearishSignal` currently mean "five conditions
   agreed" (lines 402–403); they now mean "a trade opened". Strictly fewer of them, and every one has
   levels attached.
2. **`bullishSignalFired` / `bearishSignalFired` are deleted.** The trade state machine already
   suppresses re-entry — `FLAT` is the only state that can open a trade — so the latch is redundant.
3. **`inRange` is consumed** for the first time, as a hard requirement.
4. **Three new `alertcondition`s:** Trade Opened (side and grade), Target Hit (which target, and R),
   Trade Closed (reason and R). The six existing alerts are untouched.

## Object budgets

Roughly one box, five lines and six labels redrawn per last-bar pass, plus one persistent label per
closed trade. `max_boxes_count`, `max_labels_count` and `max_lines_count` are all already at 500 and
need no change. The persistent result labels accumulate over a chart's history and are pruned by Pine's
own cap, the same as block A's break-event drawings.

## Deliberately not built

**Daily price-limit awareness.** EGX applies ±10% daily bands (wider on some listings), which does make
a distant target unreachable *within a session*. But targets here are structural levels that a multi-day
swing reaches over multiple sessions, so the band does not invalidate them — it only delays them.
Adding limit arithmetic would constrain targets for a reason that applies solely to intraday trading.
Recorded as a candidate for a later block rather than built on speculation.

**Position sizing.** The script has no account balance and no risk-percentage input, and inventing one
would produce share counts that look authoritative and are not.

## Testing / Verification

No Pine compiler or test runner in this environment; verification is static Pine v6 review plus a human
pass in TradingView.

Hidden `display = display.data_window` plots expose the machine as numbers: trade state (0 flat, 1 open),
side (1 long, −1 short), `score`, `scoreOf`, `tpHit`, current stop, and open R. Every check below that
concerns state is read from the Data Window rather than eyeballed.

- Confirm no trade opens while `inRange` reads 1, however good the setup looks.
- Disable the killzone point and confirm the panel denominator drops to `/4` and the engine still fires.
- Disable killzone *display* for both sessions while leaving its score toggle on, and confirm the
  denominator still drops to `/4` — the safety net.
- Raise `Minimum Score` to the enabled count and confirm only A-grade setups open trades.
- Confirm the stop sits `stopBuffer × ATR` beyond the zone edge, on both sides.
- Confirm every target is at least `minR` away, and that a target coinciding with an EQH is labelled as
  liquidity.
- Force a case with fewer than three structural targets and confirm the R-multiple fallback fills them
  without duplicating a level.
- Confirm TP1 moves the stop to exactly the entry price, and that the stop never moves backwards
  thereafter on either side.
- Find a bar whose range spans both the stop and a target, and confirm the trade closes as `Stopped`.
- Find a gap through the stop and confirm `closePrice` is the bar's open, not the stop.
- Confirm a CHoCH against an open trade closes it as `Invalidated` with the stop untouched.
- Confirm no second trade opens while one is running, and that the suppressed setup still shows in the
  structure panel.
- Set `Long Trades Only` and confirm bearish setups mark and alert but open no trade.
- Confirm every R figure in the panel and in the result labels uses `initialStop`, by opening a trade,
  letting it trail, and checking the quoted R against a hand calculation from the original stop.
- Scroll back over a long history and confirm result labels persist, with no "too many labels" error.
