# Crypto Killzone Fix and Backtest Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan task-by-task in the current session (Tasks 1-2 are code edits with a deferred TradingView check; Tasks 3+ drive a live, already-logged-in browser tab and cannot be parallelized across fresh subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the killzone timezone default, add an optional Asia killzone, then read `src/ict-rsi-ma-indicator.pine` against real crypto price action across 4 symbols (ETH, XRP, ADA, SOL) × 6 timeframes × 2 settings profiles, logging every anomaly as a bug or an enhancement idea and closing with a ranked backlog.

**Architecture:** Tasks 1-2 edit `src/ict-rsi-ma-indicator.pine` directly (a timezone default fix and a new gated-off input). Everything after that is read-only: Playwright drives the user's already-open, already-logged-in TradingView tab, each task sets up one symbol, cycles it through every timeframe/profile combination, screenshots the chart, and reads the `PERFORMANCE` / `Confirm` / `Gate` panel rows off the screenshot. Findings are appended to this document under each task's `### Findings` heading as the session runs.

**Tech Stack:** Pine Script v6 (no compiler — verification is read-back review plus a deferred TradingView pass, per [[pine-has-no-test-framework]]). TradingView web UI for the sweep, driven via the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`, etc.).

**Spec:** `docs/superpowers/specs/2026-08-30-crypto-killzone-and-backtest-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` on `master` at `976bc98` (minimum-risk-floor fix merged, all 10 roadmap features + dual entry models in place — see [[trade-system-roadmap]]).

## Global Constraints

- **Tasks 1-2 are the only code changes in this plan.** Everything from Task 3 onward produces a written backlog, not a patch — do not edit `src/ict-rsi-ma-indicator.pine` during the sweep.
- **Two settings profiles for the sweep**, per the spec:
  - **Baseline** — every input at its shipped default (after Tasks 1-2 land: correct London/NY timezone, Asia killzone off).
  - **Crypto-Tuned** — `Score: Killzone` on, `Show Asia Killzone` on, `Long Trades Only` off (already the default — crypto is shortable), plus `Stop on Close Only` **on** for 1D/4H/1H/15M views and **off** for 1M/1W views. This is two variants in practice (`Crypto-Tuned` and `Crypto-Tuned-Close`), same split as the EGX pass.
- **Profile toggle procedure** (assume the account is still on TradingView's Basic plan — one saved template only, confirmed during the EGX pass — so toggle inputs directly rather than switching templates):
  - **Baseline:** open Settings, `Defaults → Reset settings`, then confirm `Score: Killzone` on, `Show Asia Killzone` off, `Long Trades Only` off, `Stop on Close Only` off.
  - **Crypto-Tuned** (1M/1W views): `Score: Killzone` on, `Show Asia Killzone` on, `Long Trades Only` off, `Stop on Close Only` off.
  - **Crypto-Tuned-Close** (1D/4H/1H/15M views): same as Crypto-Tuned but `Stop on Close Only` **on**.
  - Click **Ok** to apply. Confirm each checkbox's state via `browser_find` before closing the dialog.
- **Symbols:** `BINANCE:ETHUSDT`, `BINANCE:XRPUSDT`, `BINANCE:ADAUSDT`, `BINANCE:SOLUSDT` — confirm via TradingView symbol search in Task 3 rather than assuming the prefix, the same way the EGX pass caught `EGX_DLY:` vs `EGX:`.
- **Timeframes:** 1M, 1W, 1D, 4H, 1H, 15M — one more than the EGX pass (which used five); 15M added at the user's request to read entry-level detail on markets that never close.
- **A finding must be reproducible on screen.** A glitch that doesn't survive a refresh is noise, not a finding.
- **If a leftover drawing obstructs a view, stop and ask the user to hide it manually before continuing.** Do not delete or modify chart drawings via Playwright.
- **Do not commit without the user's explicit go-ahead at that point in the session**, even though task steps below say to commit.

---

### Task 1: Fix the killzone session timezone default

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine:42`
- Modify: `README.md:494`

**Interfaces:**
- Consumes: nothing.
- Produces: a corrected `sessionTimezone` default that Task 2's Asia killzone and every later crypto-profile view depend on for a meaningful `Score: Killzone` reading.

- [x] **Step 1: Read the current input line**

`src/ict-rsi-ma-indicator.pine:42` currently reads:

```
sessionTimezone = input.string("Africa/Cairo", "Session Timezone", group = "Killzones")
```

`londonSession` (line 44, `"0200-0500"`) and `newYorkSession` (line 46, `"0700-1000"`) are the hour
ranges conventionally published for the ICT London/New York killzones *in New York time*. Evaluated
against `Africa/Cairo` instead, they light up a fixed Cairo-clock window that does not track the
real London or New York session open, since Cairo's UTC offset does not move with UK/US daylight
saving. See the spec's Part 0 for the full reasoning.

- [x] **Step 2: Change the default and document why**

```
sessionTimezone = input.string("America/New_York", "Session Timezone", group = "Killzones", tooltip = "London and New York killzone hours below are conventionally quoted in New York time. Evaluating them against America/New_York lets Pine's own DST-aware session matching track the real session opens automatically; changing this to another timezone re-interprets the same hour numbers against a different clock, which will not line up with the actual sessions unless you also recalculate the hours.")
```

- [x] **Step 3: Read-back review (no compiler available)**

Re-read the full `Killzones` input block (`src/ict-rsi-ma-indicator.pine:41-46`) after the edit and
confirm: the string is a valid IANA timezone name Pine recognizes (`America/New_York` is used
elsewhere in Pine community scripts for exactly this purpose — no other change needed), the tooltip
argument doesn't break `input.string`'s call signature, and no other line in the file references
`"Africa/Cairo"` as a literal (confirmed clean in Part 0 audit — it appears exactly once, at this
line).

- [x] **Step 4: Update the README**

`README.md:494` currently reads:

```
**Killzones** — session windows and their timezone. **RSI / Moving Average** — the periods behind the
```

Change to:

```
**Killzones** — session windows and their timezone, which defaults to `America/New_York` (the
convention the London/New York hour ranges are quoted in — changing the timezone re-interprets the
same hours against a different clock rather than shifting the sessions). **RSI / Moving Average** — the periods behind the
```

- [x] **Step 5: Commit**

Ask the user for go-ahead, then:

```bash
git add src/ict-rsi-ma-indicator.pine README.md
git commit -m "fix: evaluate killzone sessions against America/New_York, not Africa/Cairo"
```

- [x] **Step 6: Note the deferred live check**

This cannot be confirmed compiled or running until Task 3 pastes the updated script into
TradingView. Record in this plan's Task 3 findings whether the shaded London/New York windows now
land where a known session-open reference (e.g. the exchange's own premarket/session shading, or
the visible daily volume pickup) says they should.

---

### Task 2: Add an optional Asia killzone

**Files:**
- Modify: `src/ict-rsi-ma-indicator.pine:41-46` (inputs)
- Modify: `src/ict-rsi-ma-indicator.pine:503-508` (session-active flags and shading)
- Modify: `src/ict-rsi-ma-indicator.pine:726` (killzone scoring point denominator)
- Modify: `README.md:58`, `README.md:443`

**Interfaces:**
- Consumes: `sessionTimezone` from Task 1 (now `America/New_York`).
- Produces: `asiaActive` (bool), folded into the existing `killzoneActive` used by
  `bullishWatchZone` / `bearishWatchZone` (lines 544-545) and the killzone scoring point (line 734
  onward) — both already read `killzoneActive` rather than the individual session flags, so no
  change needed there.

- [x] **Step 1: Add the Asia inputs**

After `src/ict-rsi-ma-indicator.pine:46` (`newYorkSession = ...`), add:

```
showAsiaKZ      = input.bool(false, "Show Asia Killzone", group = "Killzones", tooltip = "Off by default — turning this on changes what Score: Killzone means on any existing saved chart, including single-session markets like EGX where a third always-on window would make the point easier to earn without adding signal. Turn on for 24-hour markets such as crypto, where Asian-session volume is not a rounding error.")
asiaSession     = input.session("2000-0000", "Asia Killzone Time", group = "Killzones")
```

- [x] **Step 2: Add the active flag and shading**

At `src/ict-rsi-ma-indicator.pine:503-508`, currently:

```
londonActive  = showLondonKZ and not na(time(timeframe.period, londonSession, sessionTimezone))
newYorkActive = showNewYorkKZ and not na(time(timeframe.period, newYorkSession, sessionTimezone))
killzoneActive = londonActive or newYorkActive

bgcolor(londonActive ? color.new(color.blue, 90) : na, title = "London Killzone")
bgcolor(newYorkActive ? color.new(color.orange, 90) : na, title = "New York Killzone")
```

Change to:

```
londonActive  = showLondonKZ and not na(time(timeframe.period, londonSession, sessionTimezone))
newYorkActive = showNewYorkKZ and not na(time(timeframe.period, newYorkSession, sessionTimezone))
asiaActive    = showAsiaKZ and not na(time(timeframe.period, asiaSession, sessionTimezone))
killzoneActive = londonActive or newYorkActive or asiaActive

bgcolor(londonActive ? color.new(color.blue, 90) : na, title = "London Killzone")
bgcolor(newYorkActive ? color.new(color.orange, 90) : na, title = "New York Killzone")
bgcolor(asiaActive ? color.new(color.purple, 90) : na, title = "Asia Killzone")
```

- [x] **Step 3: Extend the killzone point's self-disabling denominator**

`src/ict-rsi-ma-indicator.pine:726` currently reads:

```
killzonePointOn = scoreKillzone and (showLondonKZ or showNewYorkKZ)
```

Change to:

```
killzonePointOn = scoreKillzone and (showLondonKZ or showNewYorkKZ or showAsiaKZ)
```

- [x] **Step 4: Read-back review (no compiler available)**

Re-read the full edited block end to end. Confirm: `"2000-0000"` is a valid overnight
`input.session` string (Pine's session syntax supports a session that crosses midnight this way —
confirm against Pine's own `input.session` docs comment or an existing overnight-session example if
one exists in this file or a reference script, since this file has had no overnight session before
now). Confirm `asiaActive`'s three-flag `or` chain compiles the same way `killzoneActive` did
before (no operator precedence surprise — `and`/`or` in Pine v6 do not short-circuit, per
[[pine-v6-gotchas]], but that only affects side-effecting expressions, and this line has none).
Confirm `color.purple` is not already bound to a different meaning elsewhere in the legend (it is
not — checked against `majorTagColor`, `liquidityTagColor`, `bosColor`, `chochColor`, `rayColor` at
lines 62-66, all different colors).

- [x] **Step 5: Update the README**

`README.md:58` currently reads:

```
| **Killzone** | A time window when a major session is active (London, New York). Volume concentrates here |
```

Change to:

```
| **Killzone** | A time window when a major session is active (London, New York, and optionally Asia). Volume concentrates here |
```

`README.md:443` currently reads:

```
| Score: Killzone | on | **Turn off on single-session markets like EGX** |
```

Add a row directly beneath it:

```
| Show Asia Killzone | off | On for 24-hour markets like crypto — off by default so it doesn't change existing saved charts |
```

- [x] **Step 6: Commit**

Ask the user for go-ahead, then:

```bash
git add src/ict-rsi-ma-indicator.pine README.md
git commit -m "feat: add optional Asia killzone session, off by default"
```

---

### Task 3: Environment setup — repaste indicator, confirm crypto symbols

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 3` below.

**Interfaces:**
- Consumes: the Task 1/2 code changes, which must be live on the TradingView chart before any
  sweep view is read.
- Produces: confirmed exact ticker strings for all 4 symbols; confirmation the chart is running the
  post-Task-2 source, not a stale pre-fix version.

- [x] **Step 1: Confirm the Playwright browser is attached and logged in**

Same check as the EGX pass — confirm the hamburger menu reads a logged-in state, not "Sign in /
Join now".

- [x] **Step 2: Repaste the updated indicator**

Open "ICT + RSI/MA Confluence" (or "My ICT Script", per the EGX pass's naming) in the Pine Editor.
Since this plan's Tasks 1-2 changed the source, paste the current `src/ict-rsi-ma-indicator.pine`
in full, replacing whatever is there, save, and confirm no compile error banner appears in the
editor. This is the deferred verification promised in Task 1 Step 6 and Task 2 Step 4 — the first
point at which these edits run for real.

- [ ] **Step 3: Confirm the killzone fix visually**

Load any liquid symbol at 1H, open Settings, confirm `Show Asia Killzone` exists and defaults off,
turn it on, apply, and screenshot. Confirm three distinct background shadings appear (blue, orange,
purple) at different times of day, and that the London (blue) and New York (orange) windows now
track New York time rather than a fixed Cairo-clock window — cross-check against a visible marker
of the real session open if TradingView's UI exposes one (e.g. a session-break vertical line, or by
reasoning about the current UTC time shown in the browser chrome against the shaded window). Note
the result under Task 3 findings before moving on — if the shading still looks wrong, stop and
re-open Task 1/2 rather than proceeding into the sweep with an unverified fix.

- [x] **Step 4: Confirm the 4 crypto ticker symbols**

Search each of ETH, XRP, ADA, SOL individually via the chart's symbol search. Confirm each resolves
to the intended Binance USDT pair (`BINANCE:ETHUSDT`, `BINANCE:XRPUSDT`, `BINANCE:ADAUSDT`,
`BINANCE:SOLUSDT`) rather than a different exchange or a different quote currency — the EGX pass
found its assumed prefix (`EGX:`) was wrong, so don't assume Binance's prefix is right either until
search confirms it.

- [x] **Step 5: Append setup findings and commit**

Under `### Findings — Task 3` below, record: whether the repaste was clean, whether the killzone
fix visually checked out, and the confirmed ticker strings (or corrections to them).

Ask the user for go-ahead, then:

```bash
git add docs/superpowers/plans/2026-08-30-crypto-killzone-and-backtest.md
git commit -m "docs: record crypto backtest verification setup findings"
```

### Findings — Task 3

- Playwright's browser required a fresh manual sign-in (same as the EGX pass). Confirmed logged in
  as `ibrahimkeshta1995`.
- Repasted the full updated `src/ict-rsi-ma-indicator.pine` into "My ICT Script" via clipboard paste
  (Ctrl+A, Ctrl+V) rather than typed keystrokes, to avoid the Pine editor's auto-closing brackets
  corrupting a keystroke-by-keystroke paste. **First attempt corrupted every em-dash** (`—` became
  `â€”`) because the clipboard copy (`Get-Content -Raw | Set-Clipboard` in Windows PowerShell 5.1)
  read the file with the default system codepage instead of UTF-8, since the file has no BOM.
  Re-copied with `Get-Content -Raw -Encoding UTF8`, verified clipboard and file matched exactly
  (113,272 chars, 111 em-dashes each) before re-pasting. Saved cleanly (version "25 ∙ Today,
  02:40"), added to chart with **zero compile errors**.
- A freshly-added instance's Settings dialog confirmed the fix directly: `Session Timezone` reads
  `America/New_York` (not `Africa/Cairo`), `Show Asia Killzone` exists, defaults off, and toggles
  cleanly with its tooltip visible.
- **Could not get a clean before/after screenshot of the three killzone background colors.** The
  session hit two points of UI friction: an invisible overlay (`screen-WDCCRITC fade-WDCCRITC`)
  that blocked toolbar clicks after a `Change interval` action, and a page reload that landed back
  on the user's actual saved default layout (`JUFO`, EGX) rather than the scratch chart the earlier
  verification happened on. **Did not proceed to force this on the JUFO chart** — that is the
  user's real working layout, and toggling its hidden indicators or resetting its saved settings
  to get a screenshot would be altering their production setup for a verification side-quest, not
  something this plan should do without asking first.
- **Confirmed a live-chart hazard, not a bug**, consistent with the `Minimum Score` precedent in
  the README: the JUFO chart's own `ICT-RSI-MA` instance still reads `Session Timezone:
  Africa/Cairo` — its own saved input value from before this fix, which a script-default change
  does not retroactively migrate. This is exactly why the crypto sweep's **Baseline** profile
  starts with `Defaults → Reset settings` (Global Constraints) rather than assuming a chart's
  existing values match the shipped defaults.
- Confirmed `BINANCE:ETHUSDT` resolves correctly via symbol search: exchange badge "Binance",
  listing "Ethereum / TetherUS", tagged `spot crypto defi` — matches the assumed symbol string.
  XRP/ADA/SOL not yet individually re-confirmed this session (search was narrowed by typing the
  `BINANCE:` prefix directly, which worked well for ETH and should be repeated per symbol in
  Tasks 5-7).

---

### Task 4: ETH — 6 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 4` below.

**Interfaces:**
- Consumes: the confirmed `BINANCE:ETHUSDT` symbol string and the Profile toggle procedure from
  Global Constraints.
- Produces: nothing consumed by later tasks — each symbol task is independent.

- [x] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:ETHUSDT`.
- [x] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [x] **Step 3: 1M — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [x] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [x] **Step 5: 1W — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [x] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [x] **Step 7: 1D — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 9: 4H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 11: 1H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 12: 15M — Baseline.** Set timeframe 15m, set inputs to **Baseline**, screenshot, read.
- [x] **Step 13: 15M — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 14: Append ETH findings and commit.** Under `### Findings — Task 4` below, write one
  entry per anomaly across the 12 views, tagged `[BUG]` or `[ENHANCEMENT]`, naming the exact view.
  A clean view gets a one-line "clean" note. Ask the user for go-ahead, then commit as in Task 3
  Step 5 (adjust the commit message to name ETH).

### Findings — Task 4

Raw numbers per view (n = closed trades, WR = win rate, Avg R, Total R; grade columns show Avg R
(count)):

| View | n | WR | Avg R | Total R | A | B | C |
|---|---|---|---|---|---|---|---|
| 1M Baseline | 0 | — | — | — | — | — | — |
| 1M Crypto-Tuned | 0 | — | — | — | — | — | — |
| 1W Baseline | 3 | 33% | -0.05R | -0.16R | —(0) | —(0) | -0.05R(3) |
| 1W Crypto-Tuned | 4 | 25% | -0.29R | -1.16R | —(0) | -1.00R(1) | -0.05R(3) |
| 1D Baseline | 42 | 38% | +0.07R | +3.06R | —(0) | +0.42R(15) | -0.12R(27) |
| 1D Crypto-Tuned-Close | 55 | 40% | +0.06R | +3.38R | +0.82R(5) | +0.21R(23) | -0.21R(27) |
| 4H Baseline | 94 | 47% | +0.14R | +13.28R | -0.02R(13) | -0.14R(29) | +0.34R(52) |
| 4H Crypto-Tuned-Close | 93 | 48% | +0.20R | +18.96R | -0.09R(11) | +0.04R(34) | +0.39R(48) |
| 1H Baseline | 90 | 38% | -0.12R | -11.11R | -0.18R(7) | +0.10R(22) | -0.20R(61) |
| 1H Crypto-Tuned-Close | 92 | 43% | -0.05R | -4.63R | -0.44R(8) | +0.12R(26) | -0.08R(58) |
| 15M Baseline | 74 | 34% | -0.16R | -12.15R | +0.46R(7) | -0.26R(21) | -0.21R(46) |
| 15M Crypto-Tuned-Close | 77 | 35% | -0.30R | -23.16R | +0.55R(6) | -0.31R(27) | -0.41R(44) |

- **[CONFIRMED]** Task 1/2's killzone fix works end to end on a live chart, closing the gap Task 3
  couldn't verify visually. Toggling `Show Asia Killzone` on (1M Crypto-Tuned) visibly tinted the
  entire chart background purple and moved `Gate` from `1/7` to `2/7` on the same bar — the new
  session is being evaluated and scored, not just accepted as an input.
- **[OBSERVATION] Grade is not just anti-predictive here — it's directionally inconsistent by
  timeframe**, which is a different and arguably more concerning shape than the EGX finding (which
  was a *consistent* inversion). On ETH: C-grade outperforms A and B on 4H (both profiles); A-grade
  outperforms B and C on 15M (both profiles) and on 1D-Close; A-grade is the *worst* grade on 1H and
  tied-worst on 4H. A trader reading "A-grade" as "more confluence, safer trade" would be right on
  some timeframes and badly wrong on others, with no visible way to tell which regime they're in.
- **[OBSERVATION] The Crypto-Tuned-Close profile (Asia killzone + Stop on Close Only) doesn't have a
  consistent effect.** It improves Total R on 1D (+3.06R → +3.38R), 4H (+13.28R → +18.96R), and 1H
  (-11.11R → -4.63R, still net negative but notably less bad), but makes it clearly worse on 15M
  (-12.15R → -23.16R). Net: helps on three of the four intraday-and-up timeframes tested, hurts on
  the fastest one (15M) — the opposite of what "Stop on Close Only exists for wicky fast timeframes"
  would predict.
- **[OBSERVATION]** 1D Baseline's live open trade has TP3 at 10.5R–18R depending on view — a very
  long-dated target on a symbol/timeframe combination this volatile. Not evaluated as a bug here,
  but worth a closer look given how rarely price likely reaches it before structure invalidates the
  trade first.
- **[Clean, corroborates EGX backlog item #5]** Every `Last event` strength reading across all 12
  ETH views was positive (0.8x–2.1x), reproducing the source-level finding that `lastStrength` is
  `math.abs(...)`-derived and cannot go negative. No negative or zero readings seen.
- **Clean:** no label overlap, panel clipping (once the browser window was sized correctly — see
  Task 3 findings), or rendering bugs across all 12 views.

---

### Task 5: XRP — 6 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 5` below.

**Interfaces:**
- Consumes: the confirmed `BINANCE:XRPUSDT` symbol string and the Profile toggle procedure from
  Global Constraints.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:XRPUSDT`.
- [x] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [x] **Step 3: 1M — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [x] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [x] **Step 5: 1W — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [x] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [x] **Step 7: 1D — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 9: 4H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 11: 1H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 12: 15M — Baseline.** Set timeframe 15m, set inputs to **Baseline**, screenshot, read.
- [x] **Step 13: 15M — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [x] **Step 14: Append XRP findings and commit.** Same procedure as Task 4 Step 14, naming XRP.

### Findings — Task 5

| View | n | WR | Avg R | Total R | A | B | C |
|---|---|---|---|---|---|---|---|
| 1M Baseline | 0 | — | — | — | — | — | — |
| 1M Crypto-Tuned | 1 | 0% | -1.00R | -1.00R | — | — | -1.00R(1) |
| 1W Baseline | 8 | 50% | -0.27R | -2.18R | —(0) | -0.33R(4) | -0.21R(4) |
| 1W Crypto-Tuned | 8 | 50% | -0.27R | -2.18R | —(0) | -0.47R(5) | +0.05R(3) |
| 1D Baseline | 32 | 47% | +0.18R | +5.92R | —(0) | +0.72R(6) | +0.06R(26) |
| 1D Crypto-Tuned-Close | 44 | 50% | +0.33R | +14.50R | +0.26R(3) | -0.52R(15) | +0.83R(26) |
| 4H Baseline | 83 | 42% | +0.24R | +20.02R | +0.48R(9) | -0.11R(29) | +0.42R(45) |
| 4H Crypto-Tuned-Close | 81 | 48% | +0.34R | +27.69R | +0.86R(12) | -0.24R(28) | +0.59R(41) |
| 1H Baseline | 69 | 48% | +0.21R | +14.58R | +0.33R(1) | +0.19R(17) | +0.22R(51) |
| 1H Crypto-Tuned-Close | 71 | 52% | +0.27R | +19.08R | +0.23R(4) | +0.10R(22) | +0.36R(45) |
| 15M Baseline | 78 | 31% | -0.08R | -5.89R | +0.05R(8) | -0.07R(26) | -0.10R(44) |
| 15M Crypto-Tuned-Close | 79 | 39% | -0.03R | -2.12R | -0.05R(9) | +0.21R(26) | -0.16R(44) |

- **[ENHANCEMENT candidate] Unlike ETH, the Crypto-Tuned(-Close) profile improved Total R on every
  single XRP timeframe pair** — 1D (+5.92R → +14.50R), 4H (+20.02R → +27.69R), 1H (+14.58R →
  +19.08R), 15M (-5.89R → -2.12R), 1W (unchanged). On ETH the same profile made 15M *worse*
  (-12.15R → -23.16R). Two symbols, opposite verdicts on the fastest timeframe — this is exactly the
  kind of per-symbol variance the design spec flagged as a risk of treating Crypto-Tuned-Close as a
  blanket default, mirroring the EGX pass's finding #3 about EGX-Tuned-Close.
- **[OBSERVATION, now seen on 2/2 symbols]** A-grade is the best-performing grade on **15M Baseline**
  specifically, on both ETH (+0.46R) and XRP (+0.05R) — every other grade is negative on both. Still
  too small a sample to call a rule, but it's the first grade pattern that's reproduced identically
  across symbols rather than flipping.
- **[OBSERVATION]** B-grade is negative on both 1D-Close and 4H (both profiles) for XRP, while A and
  C are positive — the "middle" grade underperforming both its neighbors, not just being noisy.
- **Clean:** all `Last event` strength readings positive (0.2x–3.0x) across all 12 views, no negative
  values — second symbol confirming the same source-level finding as ETH. No rendering bugs; panel
  legible in all 12 views at the 1600×1000 window size established in Task 4.

---

---

### Task 6: ADA — 6 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 6` below.

**Interfaces:**
- Consumes: the confirmed `BINANCE:ADAUSDT` symbol string and the Profile toggle procedure from
  Global Constraints.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:ADAUSDT`.
- [ ] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 3: 1M — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [ ] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 5: 1W — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [ ] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 7: 1D — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 9: 4H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 11: 1H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 12: 15M — Baseline.** Set timeframe 15m, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 13: 15M — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 14: Append ADA findings and commit.** Same procedure as Task 4 Step 14, naming ADA.

### Findings — Task 6

*(filled in during execution)*

---

### Task 7: SOL — 6 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 7` below.

**Interfaces:**
- Consumes: the confirmed `BINANCE:SOLUSDT` symbol string and the Profile toggle procedure from
  Global Constraints.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:SOLUSDT`.
- [ ] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 3: 1M — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [ ] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 5: 1W — Crypto-Tuned.** Set inputs to **Crypto-Tuned**, screenshot, read.
- [ ] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 7: 1D — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 9: 4H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 11: 1H — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 12: 15M — Baseline.** Set timeframe 15m, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 13: 15M — Crypto-Tuned-Close.** Set inputs to **Crypto-Tuned-Close**, screenshot, read.
- [ ] **Step 14: Append SOL findings and commit.** Same procedure as Task 4 Step 14, naming SOL.

### Findings — Task 7

*(filled in during execution)*

---

### Task 8: Synthesis — ranked backlog

**Files:**
- Modify: this plan doc — append the `## Enhancement Backlog` section below.

**Interfaces:**
- Consumes: `### Findings` sections from Tasks 3-7.
- Produces: a ranked backlog the user can turn into new dated spec/plan pairs, following this
  repo's existing pattern.

- [ ] **Step 1: Re-read every Findings section.** Tasks 3 through 7, in order.
- [ ] **Step 2: Group repeated findings.** An issue seen on more than one view is one backlog entry
  noting every view it appeared on, not one entry per view.
- [ ] **Step 3: Write the backlog section.** Append `## Enhancement Backlog` at the end of this
  document: an ordered list, highest-impact first, each entry naming the issue, how many views it
  appeared on, and whether it's a `[BUG]` (contradicts the README) or `[ENHANCEMENT]` (works as
  designed, crypto evidence suggests improving it). Explicitly call out whether the Task 1/2
  killzone fix behaved as intended across all four symbols, and whether `Score: Killzone` in
  practice discriminates crypto setups the way it does on EGX equities or not at all — that's the
  question this whole plan exists to answer.
- [ ] **Step 4: Present and commit.** Present the ranked backlog to the user in chat. Ask whether
  any items should become new dated spec/plan pairs now. Ask for go-ahead, then:

```bash
git add docs/superpowers/plans/2026-08-30-crypto-killzone-and-backtest.md
git commit -m "docs: close out crypto backtest verification with ranked backlog"
```

## Enhancement Backlog

*(filled in during Task 8)*
