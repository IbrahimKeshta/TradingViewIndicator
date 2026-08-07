# Structure Core — Design

**Date:** 2026-08-07
**Status:** Approved for planning — not yet implemented
**File:** `src/ict-rsi-ma-indicator.pine`
**Block:** A of a five-block roadmap (see *Roadmap context*)

## Purpose

Replace the single-swing market-structure section with a two-tier swing engine that keeps history,
classifies every pivot, distinguishes BOS from CHoCH on a real state machine, and reports an explicit
range state.

The current section tracks exactly one active swing high and one active swing low, and nulls each on
break (`lastSwingHigh := na`, line 101). That destroys the data every downstream feature needs: with
no swing history there is no nearest support/resistance, no HH/HL sequence to read a trend from, and
no record that a level was ever broken — so "old resistance is now support" is not expressible at
all. `structureBias` also flips on the first break in either direction, which conflates "trend
continued" with "trend reversed".

## Roadmap context

This is the foundation block of a larger trade system being built inside this one indicator, because
Pine cannot share state across scripts. Blocks and their dependencies:

| Block | Content | Consumes | Produces |
|---|---|---|---|
| **A** | Structure core *(this spec)* | pivots | `trend`, `inRange`, swing arrays, break events |
| B | Nearest support/resistance | A's swing arrays | `nearestSup`, `nearestRes` |
| C | Confirmation stack — volume, climax, MACD, Stochastic, Ichimoku | — | confirmation flags |
| D | Signal engine — breakout signal, buy/sell zone, targets | A + B + C | active trade: entry, SL, TP |
| E | Trade lifecycle — trailing stop, target hits, invalidation | D | live SL, trade status |

A is deliberately **unopinionated**: it records every break with its strength and filters nothing.
Judgements about what is strong enough to trade belong to D. This is the reason displacement is not a
condition of recording a break — if it were, a real break on a small candle would never enter the
record and no downstream block could recover it.

## Scope

**In scope:** two-tier pivot detection; swing history with classification and broken-flags; EQH/EQL
liquidity marking; BOS/CHoCH via trend state machine, per tier; range detection; on-chart rendering
(tags, rays, event lines, status panel); tier-tagged order blocks; migration of the existing
`structureBias` consumers.

**Out of scope:** nearest-S/R selection and flip-level rendering (block B — A stores broken levels but
does not draw them); liquidity sweep / stop-run detection; premium-discount equilibrium zones;
multi-timeframe structure; any change to how signals are gated (block D owns that, deliberately, not
as a side effect of this refactor).

## Tier model

Two pivot lookbacks run in parallel over the same bars.

| Tier | Default lookback | Role |
|---|---|---|
| Major | 20 | Defines the headline `trend`, the range test, and structural breaks |
| Internal | 5 | Entry-level detail: pullback state, internal order blocks, block B's fine levels |

One lookback cannot serve both. Tuned low it finds every wiggle and the trend read is noise; tuned
high the trend is clean but every level worth entering at is invisible. Both tiers run the *complete*
pipeline — classification, break detection and the trend state machine — so `intTrend` exists
alongside `trend` and the two can be compared.

## Data model

```pinescript
type SwingPoint
    float  price
    int    bar
    string class       // "HH" | "HL" | "LH" | "LL" | "EQH" | "EQL" | na for the first on a side
    bool   broken
    int    brokenBar
    bool   liquidity   // true when class is EQH or EQL
```

Four arrays: `majorHighs`, `majorLows`, `intHighs`, `intLows`. Each capped at `maxSwings` (default
10) with the oldest shifted off the front.

**Broken points are marked, never removed.** This is the single most important difference from the
current code. A broken swing is still a price level with meaning — it is the flip level block B needs
— and deleting it is what makes the present implementation a dead end.

## Classification

A pivot confirms `lookback` bars after the fact (`ta.pivothigh` / `ta.pivotlow`). On confirmation,
compare it to the last point already in the same array, before pushing:

```
diff = newPrice - prevPrice
if abs(diff) <= eqTol * atrAtPivot   →  "EQH" (highs) / "EQL" (lows),  liquidity = true
else if diff > 0                     →  "HH"  (highs) / "HL"  (lows)
else                                 →  "LH"  (highs) / "LL"  (lows)
```

An empty array means no predecessor: the point is stored with `class = na`.

`atrAtPivot` is `structAtr[lookback]` — the ATR at the pivot's own bar, not the confirmation bar.
Sampling it at confirmation would classify the same pivot differently depending on volatility that
arrived after it, which makes historical structure a function of the future.

**EQH/EQL do not change trend and do not count as a directional pivot.** Two equal highs are resting
stop-loss liquidity, and price tends to run to them — which is why `liquidity` is recorded: block D
uses these levels as natural take-profit targets.

## Break detection

Runs per tier, on confirmed bars only (`barstate.isconfirmed`).

The structural event fires when price **closes** through the *most recent unbroken* point on a side —
found by scanning the array backwards for the last entry with `broken == false`:

```
highs:  close > point.price
lows:   close < point.price
```

Any older unbroken points crossed by the same move are also marked `broken` with `brokenBar =
bar_index`, but they do **not** fire additional events. One bar, one event per tier per side.

Close-based on a confirmed bar is what makes this non-repainting: a wick through the level is not a
break, and no event can appear and then vanish intrabar.

Each event records:

| Field | Meaning |
|---|---|
| `type` | `"BOS"` or `"CHoCH"` |
| `tier` | `"MAJOR"` or `"INTERNAL"` |
| `side` | `"bull"` (a high broke) or `"bear"` (a low broke) |
| `strength` | `math.abs(close − open)` of the breaking bar ÷ `structAtr` — displacement, for D to filter on |
| `penetration` | `\|close − level\| ÷ structAtr` — unsigned; the sign is recoverable from `side` |
| `bar` | `bar_index` of the breaking bar |

## Trend state machine

Per tier. `trend` is `na` until the first break.

| Current trend | Break side | Event | New trend |
|---|---|---|---|
| `up` | high | BOS | `up` |
| `up` | low | **CHoCH** | `down` |
| `down` | low | BOS | `down` |
| `down` | high | **CHoCH** | `up` |
| `na` | either | BOS | that direction |

This is what the current code cannot do: it labels an event CHoCH or BOS by comparing against
`structureBias`, but nulls the opposing swing on every break, so the two sides drift out of sync.

Per-bar output booleans, consumed by order-block creation and alerts:

```
bullBreakMajor   bearBreakMajor   bullBreakInt   bearBreakInt
```

Each is true when a break of that side fired on that tier this bar, regardless of BOS/CHoCH. Also
held as `var` for D: `lastEventType`, `lastEventTier`, `lastEventSide`, `lastEventStrength`,
`lastEventBar`.

## Range detection

`inRange` is an overlay on trend, not a third trend value — `trend` keeps its last value throughout a
range. The meaning is "do not act on the trend right now", and block D reads it as a veto.

```
need the last 2 major highs and last 2 major lows; fewer than 2 on either side → inRange = false

band      = max(the two highs) − min(the two lows)
oldestBar = min(bar of the four points)

inRange = band <= rangeAtrMult * structAtr
          and (bar_index − oldestBar) <= rangeLookback
```

The second condition is a staleness guard. Without it, four pivots spread across 400 bars could
happen to sit inside a narrow band and read as compression when the market has simply returned to an
old price. Four *recent* pivots inside `rangeAtrMult × ATR` is the thing that actually means
consolidation.

`structAtr` is a dedicated `ta.atr(structAtrLength)`, default length 14, **not** the existing
`watchZoneAtrLength` from line 39. That input belongs to the watch-zone feature; reusing it would mean
tuning watch-zone proximity silently reclassifies historical structure.

## Rendering

Decided by review of three mockups; the chosen shape is major-tier tags and event lines, plus rays and
a status panel.

| Element | Lifetime | Default |
|---|---|---|
| Major pivot tags — HH/HL/LH/LL/EQH/EQL | redrawn on `barstate.islast` from the arrays | on |
| Major rays — unbroken swings, `extend.right` | redrawn on `barstate.islast` | on |
| BOS/CHoCH line + label | **persistent**, drawn at event time | on |
| Internal rays | redrawn, dotted and faded | **off** |
| Internal break lines | persistent, thin and faded | **off** |
| Status panel | redrawn on `barstate.islast` | on |

**Events persist, state redraws.** A BOS happened at a bar and is worth keeping when scrolling back; a
ray is a claim about the present and must never be stale. Redrawing tags from the arrays also bounds
them at exactly `maxSwings` per side per tier, so labels cannot grow without limit. Redrawn objects
are tracked in `line[]` / `label[]` arrays and deleted at the top of the `barstate.islast` block, the
same pattern `src/gann-angles.pine` uses.

**Boundary with block B:** rays draw only for *unbroken* swings, on whichever tiers are enabled for
display. Broken levels stay in the arrays but A never draws them — flip-level presentation belongs to
B, so the two blocks never compete for the same ink.

**Status panel** — a 2-column table, position configurable:

| Row | Value |
|---|---|
| Major trend | `UP` / `DOWN` / `—`, coloured |
| Range | `YES` / `no` |
| Last event | e.g. `BOS · MAJOR · 1.4x` |
| Internal | `aligned` when `intTrend == trend`, `pullback` when they differ, `—` when either is `na` |

Internal swings are tracked but not tagged on the chart; the `pullback` row is how their state is
surfaced by default.

**EQH/EQL tags** use their own colour to mark them as liquidity rather than directional structure.

## Inputs

The single `pivotLookback` (line 18) is replaced. Group **Market Structure**:

| Input | Type | Default |
|---|---|---|
| `Major Swing Lookback` | int, minval 2 | 20 |
| `Internal Swing Lookback` | int, minval 2 | 5 |
| `Max Swings Kept (per side, per tier)` | int, minval 2, maxval 30 | 10 |
| `Structure ATR Length` | int, minval 1 | 14 |
| `Equal-Level Tolerance (x ATR)` | float, minval 0, step 0.05 | 0.15 |
| `Range Band (x ATR)` | float, minval 0.1, step 0.1 | 2.5 |
| `Range Lookback (bars)` | int, minval 10 | 100 |

Group **Structure Display**: `Show Major Tags` (on), `Show Break Lines` (on), `Show Major Rays` (on),
`Show Internal Rays` (**off**), `Show Internal Break Lines` (**off**), `Show Structure Panel` (on),
`Panel Position` (Top Right), and colours for major tags, liquidity tags, BOS, CHoCH and rays.

Internal rays default to off deliberately: the chosen rendering is the clean major-tier chart, with
internal detail available on demand rather than present by default.

## Integration and migration

**1. Lines 66–120 are deleted** and replaced by the new engine. That removes `lastSwingHigh`,
`lastSwingLow`, `lastSwingHighBarIndex`, `lastSwingLowBarIndex`, `structureBias`, the inline
`line.new`/`label.new` calls, and the `bosBullish` / `bosBearish` / `chochBullish` / `chochBearish`
locals in their current form.

**2. `structureBias` consumers migrate to `intTrend`** at lines 247, 248, 283 and 284, mapping
`"bullish" → "up"` and `"bearish" → "down"`.

They migrate to the **internal** tier, not the major one, and this is deliberate. Today's
`structureBias` is produced by a lookback of 5 — which in the new model *is* the internal tier.
Pointing these four sites at the major trend would move every signal and watch-zone alert to a
lookback of 20 as an invisible side effect of a structural refactor. Signals should almost certainly
end up gated on the major trend, but that is block D's decision, made deliberately and reviewed on its
own merits.

Bar-for-bar equality with the old code is still not guaranteed even on the same tier: the old
implementation discarded the opposing swing on every break, so its bias could differ from a
history-keeping engine in edge cases. Same tier, same lookback, substantially the same firing points —
large divergences are worth investigating, small ones are expected.

`inRange` is **not** wired into the signal gate here. Also block D's call.

**3. Order blocks become tier-tagged.** Creation (lines 201–221) fires on `bullBreakMajor or
bullBreakInt` / `bearBreakMajor or bearBreakInt`, stamping which tier produced it. Major OBs draw
solid and bold; internal OBs draw faint behind their own toggle. Block D can then require a
major-tier OB for a high-conviction setup while using internal OBs for entry refinement.

Two consequences:

- **Storage refactor.** Carrying `tier` in a parallel `string[]` would mean three arrays per side kept
  in sync by hand — `mitigateBoxes` already indexes two in lockstep (lines 143–145) and a third is
  how that silently breaks. Instead introduce a `Zone` UDT (`box`, `label`, `tier`, `side`) used by
  **both** order blocks and fair value gaps, replacing the four box/label array pairs. `tier` is
  unused for FVGs. Larger diff, less total code, and one mitigation routine over one array.
- **`obMaxCount` becomes per side *per tier*.** Internal breaks are far more frequent than major ones;
  under a shared per-side cap they would evict every major OB. Worst case becomes 4 × 20 OB boxes +
  2 × 20 FVG boxes = 120, inside the declared `max_boxes_count = 200`.

**4. Alerts.** Two `alertcondition`s are added — major CHoCH (trend reversal) and major BOS (trend
continuation). The four existing alerts are unchanged. *Decided, not requested — remove if unwanted.*

## Object budgets

`max_lines_count` goes **200 → 500** on line 2. Persistent event lines accumulate over a chart's
history and 200 is reachable; beyond the declared cap Pine silently drops the oldest.

- Redrawn per last bar: ≤ 20 major tags + ≤ 20 major rays, doubled if internal display is enabled.
- Persistent: one line + one label per break event, unbounded over history, pruned by Pine's caps.
- `max_labels_count` stays at 500, shared with FVG labels, OB labels and the RSI readout.
- `max_boxes_count` stays at 200; see the OB worst case above.

## Testing / Verification

There is no Pine compiler or test runner in this environment, and TradingView cannot be driven from
here. Verification is static Pine v6 review plus a human pass in TradingView against this checklist.

To make state inspectable rather than eyeballed, the implementation adds hidden plots
(`display = display.data_window`): `trend` as 1/−1/0, `intTrend` as 1/−1/0, `inRange` as 1/0, and
last-event type as a small integer code. Every check below that concerns state is read from the Data
Window, bar by bar.

- On a trending chart, confirm major tags read as a coherent HH/HL (or LH/LL) sequence, and that no
  tag sits on a bar that is not a pivot.
- Confirm a tag never appears earlier than `lookback` bars after its pivot bar — step through with bar
  replay. This is the no-repaint check.
- Confirm `trend` flips **only** on a CHoCH, and that a break in the trend direction leaves it
  unchanged while still emitting a BOS.
- Force a near-equal double top and confirm it classifies `EQH`, that `trend` does not change, and
  that the level is flagged as liquidity.
- Confirm that when a swing breaks its ray disappears while the point itself is retained — the Data
  Window count of stored swings must not drop on a break, only when the cap shifts one off.
- On a known consolidation, confirm `inRange` reads 1; on a clean trend leg, 0. Then move the chart
  back to an old price that revisits a long-dead band and confirm `rangeLookback` keeps `inRange` at 0.
- Confirm the status panel's `Internal` row reads `pullback` when `intTrend` and `trend` differ and
  `aligned` when they match, matching the two hidden plots.
- Toggle each display input off and confirm only its own elements disappear.
- Confirm order blocks now appear from both tiers, that major and internal render distinguishably, and
  that turning off internal OBs leaves major ones untouched.
- Confirm existing behaviour is preserved where it was meant to be: with `Internal Swing Lookback` at
  5, signals and watch-zone alerts fire in substantially the same places as the pre-change script on
  the same chart and settings. Small differences are expected — the old code discarded the opposing
  swing on every break — but a signal appearing or vanishing on a strongly trending leg is a defect.
- Load a chart with several thousand bars and confirm no "too many lines/labels/boxes" error and no
  visible loss of recent structure.
