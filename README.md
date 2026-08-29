# TradingView Indicators

Two Pine Script v6 indicators for TradingView, written to be read as much as used. Both are single
self-contained files — no libraries, no external data, nothing to install beyond pasting the script
into TradingView.

| Script | What it does | Pane |
|---|---|---|
| [`src/ict-rsi-ma-indicator.pine`](src/ict-rsi-ma-indicator.pine) | Market structure, order blocks, fair value gaps and session killzones, scored into graded trade setups with an entry zone, a stop, targets and a trailing stop | On the price chart |
| [`src/gann-angles.pine`](src/gann-angles.pine) | Gann price levels (three modes) projected from an automatic or manual anchor, plus Gann time cycles | On the price chart |

They are independent. Run either on its own, or both together.

---

## Installing

1. Open a chart on [tradingview.com](https://www.tradingview.com).
2. Open the **Pine Editor** (bottom panel).
3. Open the `.pine` file from this repo, copy all of it, and paste it into the editor, replacing
   whatever is there.
4. Click **Add to chart**.
5. To keep it: **Save**, give it a name, and it appears under *Indicators → My scripts*.

Settings are reached with the gear icon next to the indicator's name on the chart.

---

# ICT + RSI/MA Confluence

## The idea

Price tends to reverse at levels it left in a hurry, and those reversals are worth taking **only when
several independent things agree at once**. This indicator finds those levels, tracks which direction
the market is structurally moving, and marks the bars where everything lines up.

It never tells you to buy. It marks a bar where several independent conditions happened to agree,
grades how many, and leaves the decision to you.

## Reading the chart

![Annotated chart showing swing tags, break lines, rays, order blocks, fair value gaps, a killzone, a signal marker and the structure panel](docs/img/chart-anatomy.svg)

### The vocabulary

Most of this comes from "Smart Money Concepts" trading. The terms sound like jargon but each one
names something simple:

| Term | What it actually means |
|---|---|
| **Swing high / low** | A bar that is higher (or lower) than a set number of bars on both sides of it |
| **HH / HL / LH / LL** | Higher High, Higher Low, Lower High, Lower Low — how one swing compares to the previous one on the same side |
| **EQH / EQL** | Equal High / Equal Low. Two swings at nearly the same price. Stop-loss orders pile up just past them, so price is often drawn there |
| **BOS** | Break of Structure. Price closed past a swing **in the direction the trend was already going** — continuation |
| **CHoCH** | Change of Character. Price closed past a swing **against** the trend — this is what flips the trend |
| **Order block** | The last opposite-coloured candle before a structural break. Often revisited before price continues |
| **FVG** | Fair Value Gap: a three-bar pattern where the middle bar moved so fast it left a price gap. Price frequently returns to fill it |
| **Killzone** | A time window when a major session is active (London, New York, and optionally Asia). Volume concentrates here |

## How the structure engine works

Swings are detected at **two sizes at once**, because one setting cannot do both jobs. A small
lookback finds every wiggle — useful for timing an entry, useless for reading a trend. A large one
reads the trend cleanly but hides every level you'd actually trade off.

```mermaid
flowchart TB
    P["Price bars"] --> M["<b>Major</b> pivots<br/>lookback 20"]
    P --> I["<b>Internal</b> pivots<br/>lookback 5"]
    M --> MT["Major trend + range state<br/><i>shown in the panel</i>"]
    M --> MR["Tags, rays, break lines<br/><i>what you see by default</i>"]
    M --> MO["Major order blocks<br/><i>bold</i>"]
    I --> IT["Internal trend"]
    I --> IO["Internal order blocks<br/><i>faint</i>"]
    IT --> PB["Pullback detection<br/><i>internal disagrees with major</i>"]
    IT --> SIG["Signals + watch-zone alerts"]
```

Both tiers run the same pipeline independently. The panel shows the major tier; the signal engine
currently reads the internal tier.

### BOS vs CHoCH — the trend state machine

The trend only ever changes on a **CHoCH**. A BOS confirms the trend you already had.

```mermaid
stateDiagram-v2
    [*] --> Undefined
    Undefined --> Up: first break of a high (BOS)
    Undefined --> Down: first break of a low (BOS)
    Up --> Up: high broken — BOS, trend holds
    Up --> Down: low broken — CHoCH, trend flips
    Down --> Down: low broken — BOS, trend holds
    Down --> Up: high broken — CHoCH, trend flips
```

A break is only recorded when a **closed** bar closes past the level. A wick through it is not a
break, so nothing appears and then disappears on you.

Every break also records how hard it broke — the breaking candle's body divided by ATR — so a
convincing break and a barely-there one are distinguishable rather than one being silently discarded.

### The range state

Trend is not the whole story: a market can be technically "up" while going nowhere, and that is where
trend-following signals do the most damage. So a separate **Range** flag is raised when the last two
major highs and last two major lows all fit inside a narrow band (default 2.5 × ATR) **and** those
four swings are recent (default within 100 bars).

The second condition matters — without it, four swings scattered across hundreds of bars could
coincidentally sit in a narrow band and read as consolidation when nothing of the sort happened.

> **Range is a hard veto.** No trade opens while it reads `YES`, however good the setup looks — that is
> the point of tracking it. It is also shown in the panel so you can apply your own judgement to
> everything else on the chart.

### The structure panel

| Row | Meaning |
|---|---|
| **Major trend** | `UP`, `DOWN`, or `—` before the first break |
| **Range** | `YES` when structure is compressing — treat trend signals with suspicion |
| **Last event** | The most recent break: type, which tier, and its strength in ATR (e.g. `BOS · MAJOR · 1.4x`) |
| **Internal** | `aligned` when both tiers agree; `pullback` when the small tier is moving against the big one — often the setup you want |

## The trade engine

A triangle no longer just means "conditions agreed" — it means **a trade opened**, with an entry
zone, a stop, three targets and a stop that trails. One trade runs at a time; while it is open,
further setups are ignored.

![Annotated chart showing a long trade with its entry zone, stop, three targets, the trailing stop stepping up, and the result label at the close](docs/img/trade-anatomy.svg)

### How a setup qualifies

Two different kinds of condition, and the difference matters:

```mermaid
flowchart LR
    subgraph H["HARD — all four, or no trade"]
        H1["Internal trend<br/>has a direction"]
        H2["Price touched an unmitigated<br/>FVG or order block"]
        H3["Not in a range"]
        H4["Bar is closed"]
    end
    subgraph S["SCORED — one point each"]
        S1["Killzone active"]
        S2["<b>Momentum</b><br/>RSI · MACD · Stochastic<br/><i>majority of those enabled</i>"]
        S3["Price on side of MA"]
        S4["Major trend agrees"]
        S5["Break was strong"]
        S6["<b>Participation</b><br/>volume surge · climax<br/><i>at least half of those enabled</i>"]
        S7["<b>Ichimoku</b><br/>price clear of the cloud"]
    end
    H --> G{"hard all met<br/>AND score &ge; minimum?"}
    S --> G
    G -->|yes| T["Trade opens<br/>graded A / B / C"]
    G -->|no| N["Nothing"]
```

The hard four are absolute because without them there is nothing to compute — no direction means no
side, and no zone means no entry price and no stop.

**The score is out of however many points you switch on, not a fixed seven.** That is deliberate.
Killzones mean nothing on a single-session market like EGX, so if killzone were a mandatory veto the
indicator would go permanently silent there. Switch the killzone point off and the panel reads `5/6`
instead of `5/7` — the threshold adjusts rather than quietly loosening. The same happens
automatically for points that cannot apply: turn off both killzone sessions and the killzone point
removes itself, and on a symbol that reports no volume at all the participation point removes itself.

**Three of the five confirmations share votes, on purpose.** RSI, MACD and Stochastic all measure
momentum from the same price series — counted separately they would cast three of ten votes for
what is really one opinion, and a setup could clear the threshold on momentum agreeing with itself.
They share the Momentum point, earned when at least half the enabled ones agree. Volume and the
climax candle share Participation the same way.

**Grades are a fraction of the enabled points** — A at 90%, B at 75%, C below that. So a grade means
the same thing whether you run four points or seven.

Set `Minimum Score` equal to the number of enabled points to get the strictest possible behaviour.

> **Upgrading from an earlier version?** `Minimum Score` now defaults to 5, because 4 out of seven
> points is a *looser* gate than the 4 out of five it used to mean. TradingView keeps the value saved
> on your chart, so if yours still reads 4, raise it by hand.

### Entry, stop and targets

| | Where it comes from |
|---|---|
| **Entry zone** | The FVG or order block price just touched — the range in which the setup is valid |
| **Entry price** | The signal bar's close. Not the zone midpoint: the close is what a market order would actually have got |
| **Stop** | The zone's far edge, plus an ATR buffer so an ordinary wick doesn't clip it |
| **1R** | Entry minus stop. Every R figure on the chart uses the *initial* stop, never the trailed one |
| **Targets** | The three nearest unbroken structure levels ahead, plus any EQH/EQL liquidity pool, each at least 1R away. If structure can't supply three, the rest fill at 1R/2R/3R |

A zone can sit close enough to price that the buffered stop lands a fraction of an ATR away. An
ordinary bar then takes that stop out for many multiples of R, because the denominator was tiny, not
because the setup was bad — the same failure mode the trailing model's own risk floor exists to
prevent (see below). `Minimum Risk (× ATR)` rejects a zone touch below that floor before it opens a
trade; set it to 0 to take every touch, which is what produced the earlier record.

### How the stop moves

1. **TP1 hit** → stop moves to entry. The trade can no longer lose.
2. **After that** → it follows each newly confirmed swing low (for a long), from whichever tier you
   pick in `Trailing Tier`. Internal trails tightly; Major gives the trade room.
3. **It never moves backwards.**

A trade closes when the stop is hit, when TP3 is reached, or when a **CHoCH** prints against it — you
can be wrong structurally without price having to travel all the way to your stop.

Two details that stop the results flattering themselves: if a bar's range spans both your stop and a
target, the trade is recorded as **stopped** (a bar-by-bar script cannot know which came first, so it
assumes the unfavourable one); and if a bar *gaps* through the stop, the exit is recorded at the open,
not at the stop price.

### Three exit modes worth testing

All three are off by default, so nothing above changes until you turn one on. They exist because the
default exit profile — wick-triggered stop, breakeven at TP1, hard close at TP3 — is tuned for clean
instruments, and gives back most of a trend on a thin one.

| | What it changes | When it helps |
|---|---|---|
| **Stop on Close Only** | The stop asks whether price *held* beyond it at the close, not whether a wick *reached* it. The exit is then recorded at that bar's close | Thin or wicky instruments — EGX dailies especially — where an intrabar touch hands back trades the close never confirmed |
| **Runner (no exit at TP3)** | TP3 becomes a waypoint. The last third keeps running behind the trailing stop until the stop or a CHoCH takes it out | Trending instruments, where one trade needs to pay for several stopped ones. A trade that runs to TP3 and closes there is a capped winner by construction |
| **Trail From Entry** | The structural trail runs from the open, and the jump to breakeven at TP1 is skipped | Strong continuations, where breakeven-at-TP1 hands the trade back at 0R on the first ordinary pullback |

Read the trade-offs before switching them on. **Stop on Close Only** takes a worse fill by design —
you are paying the distance between the stop and the close in exchange for surviving wicks. **Trail
From Entry** means a trade can still lose a full R *after* reaching TP1, which the default cannot;
the `BE+` mark on the panel tests the stop against entry rather than assuming, so it tells you
whether the trade is actually protected. **Runner** holds the single trade slot open longer, and
every setup that appears while it runs is skipped.

Runner changes the scale-out accounting to match: a third leaves at TP1 and a third at TP2, and the
final third is priced at wherever the trade actually closed rather than at TP3. Without that, a
runner would book a gain at TP3 it never took and stay capped at TP3's R — the exact understatement
the mode exists to remove.

## The second entry model

The pullback engine above has a structural blind spot, and it is not a tuning problem. Order blocks
are created **by** a break and anchored behind it, and a zone is never tested against its own
creation bar — so on an impulsive one-way move the zone is born below price and is never touched.
The engine cannot participate in a trend that does not retrace, however the touch rule is relaxed.

The `Trailing Stop Model` is a second entry model that references no zone at all. A Chandelier-style
trail hangs a fixed ATR multiple below the running high (above the running low when short),
ratcheting only in the trade's favour, and the side flips when price closes through it. **Entry is
the flip bar** — a discrete event, so entries never become a continuous "we are in a trend" state
that re-enters every bar.

The point of the flip entry is *where* it lands. A break-of-structure entry buys the close of the
breakout candle with the stop back at the base, which is the worst of both: maximum entry price and
maximum risk. A trail flip fires inside the base, before the move, so risk is roughly
`Trail ATR Multiple × ATR` rather than the full distance back down to the range low.

| Setting | Default | What it does |
|---|---|---|
| Enable Trailing Stop Model | **off** | Nothing about the pullback model changes while this is off |
| Trail ATR Length | 14 | ATR used for the trail distance |
| Trail ATR Multiple | 2.0 | How far the trail sits from the running extreme — **this is the model's risk per trade** |
| Trail Extreme Lookback | 22 | Bars in the running high/low the trail hangs from |
| Trail Minimum Target Distance (R) | 1.0 | This model's own target floor, separate from the pullback model's |
| Trail Minimum Risk (× ATR) | 1.0 | Rejects a flip whose entry sits closer to its own trail than this — see below |
| Require Trend Agreement | on | Only take flips agreeing with internal structure, and stand down in a range. Off makes this a standalone trend system |
| Apply Minimum Score | **off** | See below |
| Trade Follows the Trail Line | **on** | The open trade's stop ratchets along this model's own Chandelier line, from entry |
| Show Trail Line | off | Draws the trail on the price chart |

`Apply Minimum Score` is off by default on purpose. On the record so far the score is
**anti-predictive** — the highest-graded setups lose the most — so gating a new model on it would
import that problem into the one thing built to test it independently. The grade is still *recorded*
for every trail trade, so its grade split is readable; it just does not filter entries unless you
turn this on.

### Why the minimum risk floor exists

A flip can fire with the close sitting almost exactly on its own trail line, and nothing else in
the model bounds that distance — it is simply wherever the flip bar closed relative to the line.
That produces a stop **inside a single bar's range**, which an ordinary bar takes out for a
near-full R regardless of whether the read was right.

This was invisible while the trade's stop stayed frozen at its entry value: a tiny R just inflated
the R multiple on every winner and made the model look far better than it was. Once the stop
started tracking the line, the same trades began dying at close to a full stop each, and the
model's record inverted. Both readings were measuring the missing floor, not the model.

Set it against reality rather than guessing: `DBG Trail Flip Risk (ATR)` in the Data Window reports
the entry-to-trail distance at every flip, in ATR. Read it across a handful of flips and the right
floor is obvious. Setting it to 0 disables the floor and takes every flip.

The live trade's `Entry` row now also carries its risk in ATR terms — `22.98 · 0.7x ATR`. Anything
much under 1.0 is a stop the instrument's own noise will reach, on either model.

### The trade follows the line that opened it

`Trade Follows the Trail Line` is on by default, and the reason is worth stating because the
alternative looked reasonable and was not. The two models share one exit engine, and that engine
trails on **structural swing lows** — correct for the pullback model, wrong here. With it, a trail
trade took its entry stop from the Chandelier and then ignored that line for the rest of its life,
so the stop sat near entry, moving only when a swing low happened to confirm. A trade could be
several R in profit with its own signal already flipped against it and nothing protecting the gain.

With this on, the stop ratchets along the Chandelier line itself, from the moment the trade opens.
Because a flip fires when price closes through that same line, the trade now exits at or before the
flip rather than outliving it. The stop still only moves one way — the line resets lower once price
closes through it, and a stop that has already ratcheted up must never follow it back down.

Turning it **off** restores the old behaviour. That exists to reproduce an earlier record for
comparison, not as a sensible way to run the model.

### The two models never compete

Each model holds **its own trade slot** and **its own performance record**. A trail trade cannot
block a pullback trade or vice versa, and neither model's `n`, win rate, average R or grade split
includes the other's trades. That separation is the entire reason for the design: averaged together,
a model that works and one that does not read as a single mediocre number and neither can be judged.

With the trail model enabled the panel grows a second `PERFORMANCE · TRAIL` block beside
`PERFORMANCE · PULLBACK`, and a live trail trade gets its own `TRAIL TRADE` rows. Its exit labels
carry a `· T ·` marker so the two models' records stay legible when you scroll back. When both
models close on the same bar, the trail label is pushed clear of the pullback one rather than
stacking on top of it — two labels at the same point hide one completely, which reads as a trade
that never happened. With it
disabled the panel is row-for-row what it was.

**Before enabling it, write down the pullback model's current `n` and `Total R`.** With the model
off those two numbers must not move. If they do, something shared was touched and it is a bug —
that check is worth more than any reading you take with the model on.

### Reading the trade panel

The panel carries a `Confirm` row showing the three confirmation points for the current bar —
`Mom ✓ · Part — · Ichi ✓`. A dash means the point is switched off or cannot apply; a cross means it
applies and is not met. `5/7` tells you a setup was adequate, but the row tells you *which* points
carried it, which is the part you can act on.

Under it, the `Gate` row says what is stopping a trade **right now**:

```
Gate    L · no zone touch · 5/6
```

Side, the first unmet requirement, and the live score over the points currently enabled. The reason
is the one thing to act on, in the order the gate applies its checks:

| | Meaning |
|---|---|
| `no trend` | The internal tier has no direction yet |
| `in range` | Price is inside a major range — the engine stands down |
| `no zone touch` | **The common one.** Price has not traded back into an FVG or order block. This is a hard requirement, not a scored point: no amount of score tuning produces a trade while it reads this |
| `score short` | Everything structural is met and the score is below `Minimum Score` |
| `bar not closed` | Everything is met and the bar is still live. On a daily chart this is what you see while waiting for the close |
| `READY` | A trade fires on this bar |

The score fraction is the reason this row exists. Everywhere else the score only renders inside a
live trade's rows, so on a bar where nothing fires there is no surface that reflects a scoring input
you just changed — switch `Score: Killzone` off and the panel would look identical, with the change
real but invisible. The same numbers publish to the Data Window every bar as `DBG Live Score`,
`DBG Live Points Enabled`, and one plot per hard-gate condition.

The structure panel grows extra rows while a trade is live: the setup and its grade with the score
fraction, entry, the current stop with its R distance, all three targets with R multiples and tick
marks as they are reached, and the trade's open R. A runner is tagged `RUN` on the first of those
rows, because a trade with no exit at TP3 is a different trade from one that closes there.

When a trade closes it leaves a single label at the exit bar — `+2.5R · Target`, `−1.0R · Stopped`.
Scroll back and those labels are your per-trade record; the `PERFORMANCE` rows are the same
results added up.

```
PERFORMANCE    n = 24
Win rate       58%  (14W / 10L)
Avg R          +0.34R
Total R        +8.17R
A grade        +0.70R  (6)
B grade        +0.45R  (11)
C grade        −0.14R  (7)
```

The grade split is the row worth staring at. If C-grade setups lose money and A-grade ones don't,
`Minimum Score` is set too low — that is the feedback loop the score never had.

**Results assume you scale out in thirds**: one third of the position leaves at each target
reached, and whatever is left exits at the stop, the final target, or the bar close on a CHoCH
invalidation. The indicator itself manages one unit and draws no partial exits, so this is an
accounting convention, not something you can see on the chart. It is there because under
single-unit accounting a trade that reaches TP2 and then trails back to breakeven scores 0R — which
makes TP1 and TP2 nearly decorative and understates the engine badly enough to mislead any tuning
you do against these numbers. One consequence: the live trade's `Open R` row is single-unit and
**will not** match the blended figure the same trade reports once it closes — and the same applies
to the exit labels, so a trade that runs to TP3 labels the average of the three targets' R, not
TP3's.

Read `n` before you trust a percentage. The sample is whatever history TradingView loaded, capped at
5000 bars — on a 15-minute chart that is under two months, and a 58% win rate over twelve trades is
noise. These are also the results of the indicator *as configured*, not of the underlying pattern:
only one trade runs at a time, so every setup that appeared while a trade was open is missing from
the count. Change any setting and the whole history recomputes, which is the point — it makes the
panel a way to compare settings, not a fixed track record.

> **On cash-equity markets where you can't short**, set `Long Trades Only`. Bearish setups still mark
> and still alert, so you keep the information — they just don't open a trade.

## Alerts

Set these up with the alarm-clock icon → *Condition: ICT + RSI/MA Confluence*.

| Alert | Fires when |
|---|---|
| Bullish / Bearish Trade Entry | A trade opened — or, for the bearish one, a short setup qualified but was suppressed by `Long Trades Only` |
| Trade Opened | Any trade opened; check the panel for side, grade, stop and targets |
| Target Hit | A take-profit level was reached |
| Trade Closed | The trade ended — the result label on the chart carries the R and the reason |
| Bullish / Bearish Watch-Zone | Price is approaching an unmitigated zone during a killzone — a heads-up, not a signal |
| Major CHoCH | The major trend reversed |
| Major BOS | The major trend continued |

TradingView alert messages can't carry script values, so they point you at the chart rather than
claiming to quote a price or an R figure.

## Settings

**Market Structure** — the engine.

| Setting | Default | What it does |
|---|---|---|
| Major Swing Lookback | 20 | Bars either side a bar must dominate to count as a major swing. Bigger = fewer, more meaningful swings |
| Internal Swing Lookback | 5 | The fine tier. Also what signals read |
| Max Swings Kept | 10 | Per side, per tier. Broken swings are kept (not deleted) until this cap pushes them out |
| Structure ATR Length | 14 | Scales the three settings below |
| Equal-Level Tolerance (× ATR) | 0.15 | How close two swings must be to count as EQH/EQL |
| Range Band (× ATR) | 2.5 | How tight the four swings must be to call it a range. Lower = stricter |
| Range Lookback (bars) | 100 | How recent those swings must be |

**Trade Engine** — the gate and the trade.

| Setting | Default | What it does |
|---|---|---|
| Minimum Score | 5 | Points needed, out of however many are enabled below |
| Score: Killzone | on | **Turn off on single-session markets like EGX** |
| Show Asia Killzone | off | On for 24-hour markets like crypto — off by default so it doesn't change existing saved charts |
| Score: Moving Average | on | Whether price is on the trade's side of the MA |
| Score: Major Trend Agreement | on | Whether the major tier agrees with the internal one |
| Score: Break Strength | on | Whether the break that set up the trade was a big candle |
| Strong Break (× ATR) | 1.0 | How big that candle's body must be to earn the point |
| Stop Buffer (× ATR) | 0.25 | How far beyond the zone edge the stop sits |
| Minimum Risk (× ATR) | 1.0 | Rejects a zone touch whose stop lands closer than this — same floor and reason as Trail Minimum Risk |
| Minimum Target Distance (R) | 1.0 | Structural levels closer than this are skipped |
| Trailing Tier | Internal | Which tier's swings the stop trails behind |
| Stop on Close Only | off | Exit only when a bar **closes** beyond the stop, instead of the moment its wick touches |
| Runner (no exit at TP3) | off | Treat TP3 as a waypoint; the last third rides the trailing stop instead |
| Trail From Entry | off | Trail structurally from the open, and skip the jump to breakeven at TP1 |
| Long Trades Only | off | For markets where you can't short |
| Show Gate Panel Row | on | One row naming what is currently stopping a trade, with the live score |
| Show Performance Rows | on | Win rate, average R and a per-grade split over the loaded history. The counters run whether or not this is on |

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
| Volume Average Length | 20 | Bars in the volume average that surge and climax both measure against |
| Volume Surge (× average) | 1.5 | How far above average counts as a surge |
| Climax Range (× ATR) / Volume (× average) / Lookback | 2.0 / 2.0 / 3 | How big an exhaustion bar has to be, and how recently it can have printed |
| Score: Ichimoku | on | One point when price is clear of the cloud on the trade's side. Inside the cloud earns nothing |
| Tenkan / Kijun / Senkou B / Displacement | 9 / 26 / 52 / 26 | Standard settings |
| Show Kumo Cloud | **off** | The only thing this section draws |
| Show Confirmation Panel Row | on | Adds `Mom ✓ · Part — · Ichi ✓` to the panel, so you can see which points carried a setup |

Chikou is deliberately absent: it is the close displaced 26 bars *backwards*, so scoring on it would
report confirmation that was not available at the time. MACD and Stochastic are never plotted —
this script draws on the price chart, and an oscillator has no pane to live in here.

**Structure Display** — what gets drawn. Internal rays and internal break lines are **off** by
default; on a fast timeframe they are near-continuous. Leave internal break lines off if you want a
long trade history to survive — their labels share the chart's 500-label budget with your result
labels. `Panel Position` defaults to **Bottom Right**, not Top Right: TradingView's own expanded
indicator-legend bar (the input list shown when the legend is hovered or pinned open) sits near the
top of the chart and renders on top of the panel there, cutting through rows instead of sitting
behind them.

**Fair Value Gaps / Order Blocks** — `Max Tracked` caps how many are kept per side (order blocks: per
side *and* per tier). `Include Internal-Tier Order Blocks` is on by default; turning it off leaves
only order blocks born from major structural breaks — far fewer, each more significant.

**Killzones** — session windows and their timezone, which defaults to `America/New_York` (the
convention the London/New York hour ranges are quoted in — changing the timezone re-interprets the
same hours against a different clock rather than shifting the sessions). **RSI / Moving Average** — the periods behind the
RSI readout and the MA plot; RSI is also a member of the Momentum vote in **Confirmations**, above.
**Alerts / Display** — signal markers, the RSI readout, and how close price must get to a zone to
count as a watch-zone.

---

# Gann Angles

## The idea

W.D. Gann's methods project support and resistance from a single significant turning point, in
**price** and in **time**. This script picks that turning point for you (or takes one you type in),
draws the levels, and tells you which have already been reached.

## Reading the chart

![Annotated chart showing a Gann anchor, projected levels, vertical time cycle lines and the levels table](docs/img/gann-anatomy.svg)

## Three modes

| Mode | What it draws | Anchors needed |
|---|---|---|
| **Square of 9** *(default)* | Levels at 22.5° increments around Gann's spiral, in rings of 16 | One per direction |
| **Gann Fan** | Nine angled rays (1×8 through 8×1) read at a chosen bar distance, drawn as horizontal levels | One per direction |
| **Gann Square** | A box between a bullish and a bearish anchor, divided into a grid | **Both**, with the bearish price above the bullish one |

## Anchors

By default each side anchors to the **most recent confirmed swing** — a low for the bullish side, a
high for the bearish. "Confirmed" means the script waits `Swing Pivot Lookback` bars to be certain,
so a fresh anchor always appears that many bars after the actual turn.

To pin an anchor yourself, type a price into `Bullish Price` or `Bearish Price` (leave `0` for
automatic) and set the matching start date.

## Time cycles

Independently of the price levels, vertical lines mark 30, 45, 60, 90, 120, 144, 180, 270 and 360
bars forward from each anchor — dates Gann considered likely for a turn. The time table lists each
with its projected calendar date and whether it has been reached.

A `~` before a date means it was extrapolated from average bar spacing rather than read from a real
bar — which is what happens for cycles that lie in the future.

## The levels table

Each row is one level: its label, its price, and whether price has already **Touched** it or is still
**Pending**.

On a long chart nearly everything reads *Touched*, which buries the levels that still matter. So
`Max Touched Levels` (default 5) keeps only the touched levels **nearest current price** and hides the
rest — per direction, and applied to the lines and labels as well as the table, so you never see a
line with no row explaining it. Set it to `0` to hide touched levels entirely, or `100` to show
everything.

## Settings worth knowing

| Setting | Default | What it does |
|---|---|---|
| Mode | Square of 9 | Which geometry to draw |
| Swing Pivot Lookback | 50 | How major a turn must be to anchor to. Higher = fewer, bigger anchors, confirmed later |
| Rings *(Square of 9)* | 2 | Each ring is 16 levels. Max 3 |
| Scale Factor *(Square of 9)* | 1.0 | Raise this on high-priced instruments where all the levels bunch into a narrow band |
| ATR Length | 14 | Sets the price-per-bar unit for Fan slopes and Square width. Sampled once at the anchor and held, so the geometry does not drift |
| Max Touched Levels | 5 | Per direction. See above |

The two tables must sit in **different screen corners** — TradingView draws only one table per
position, so if `Table Position` and `Time Table Position` match, one hides the other.

---

## Things worth knowing before you trade either of these

**Nothing repaints, but confirmation is late by design.** A swing is only recognised `lookback` bars
after it forms, and breaks are only recorded on closed bars. Nothing that appears will later vanish —
the trade-off is that everything arrives a little after the fact. That is the honest cost of not
repainting.

**Signals form on the closing bar.** A signal that appears mid-bar can still disappear if the bar
closes differently. Wait for the close.

**Tune the lookbacks to your timeframe.** The defaults suit intraday charts. On a daily or weekly
chart a major lookback of 20 finds very few swings; on a 1-minute chart it finds too many. If the
chart looks wrong, this is almost always why.

**Drawings only reach so far back.** Pine anchors a drawing by counting bars back from the current
one, and that count is capped by the script's declared history buffer — 5000 bars for the confluence
indicator, 500 for Gann Angles. Beyond that limit the confluence indicator drops a swing tag rather
than move it to a bar that never made the high, and starts a ray, break line or trade box at the edge
of the buffer instead of at its true origin. The price levels themselves are unaffected. You will
only meet this on a very long intraday chart.

**These are decision-support tools, not a strategy.** Neither script backtests, sizes a position, or
places an order. The trade engine computes levels and records what would have happened; it does not
size a position and it has no idea what your account can absorb. No indicator knows the future, and
confluence between several lagging measurements is still lagging. Nothing here is financial advice.

---

## Repository layout

```
src/                    the two Pine scripts
docs/img/               diagrams used by this README
docs/superpowers/
  specs/                design documents — what each feature does and why
  plans/                implementation plans
```

The `specs/` folder is the interesting one if you want to understand *why* something works the way it
does. Each feature has a design document recording the decisions and the alternatives that were
rejected.
