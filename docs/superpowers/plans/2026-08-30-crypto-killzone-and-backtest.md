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

- [x] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:ADAUSDT`.
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
- [x] **Step 14: Append ADA findings and commit.** Same procedure as Task 4 Step 14, naming ADA.

### Findings — Task 6

| View | n | WR | Avg R | Total R | A | B | C |
|---|---|---|---|---|---|---|---|
| 1M Baseline | 0 | — | — | — | — | — | — |
| 1M Crypto-Tuned | 1 | 0% | -1.00R | -1.00R | — | — | -1.00R(1) |
| 1W Baseline | 6 | 17% | -0.69R | -4.12R | —(0) | -1.00R(2) | -0.53R(4) |
| 1W Crypto-Tuned | 8 | 13% | -0.76R | -6.12R | —(0) | -0.90R(5) | -0.53R(3) |
| 1D Baseline | 35 | 43% | +0.15R | +5.20R | —(0) | +0.15R(14) | +0.14R(21) |
| 1D Crypto-Tuned-Close | 51 | 45% | +0.02R | +1.20R | -0.19R(5) | +0.65R(13) | -0.19R(33) |
| 4H Baseline | 87 | 38% | +0.11R | +9.76R | +0.22R(14) | +0.23R(34) | -0.03R(39) |
| 4H Crypto-Tuned-Close | 84 | 42% | +0.13R | +11.12R | +0.37R(13) | +0.31R(36) | -0.14R(35) |
| 1H Baseline | 72 | 43% | +0.25R | +18.31R | +0.45R(3) | +0.49R(27) | +0.09R(42) |
| 1H Crypto-Tuned-Close | 76 | 47% | +0.36R | +26.99R | +0.41R(5) | +0.31R(31) | +0.39R(40) |
| 15M Baseline | 81 | 40% | -0.19R | -15.25R | +0.11R(4) | -0.38R(24) | -0.12R(53) |
| 15M Crypto-Tuned-Close | 83 | 41% | -0.14R | -11.76R | -0.21R(5) | -0.18R(30) | -0.11R(48) |

- **[BUG, high severity]** On **1W Baseline**, the live open SHORT trade's `TP3` reads
  `-0.0555 (3.9R)` — a negative price target on an asset that cannot trade below zero. Entry ≈0.2031,
  stop 0.3001 (risk 0.097/share). 3.9R below entry is `0.2031 − 3.9 × 0.097 ≈ −0.178`, consistent
  with the displayed negative value. The trade engine's target math has no floor at zero (or some
  small positive price), so a wide-stop short on a low-priced asset can produce a structurally
  meaningless target. Not seen on ETH/XRP because their prices (thousands / ~1.4) keep even large R
  multiples comfortably positive — this is specific to sub-$1 assets like ADA, which is exactly the
  price range a lot of altcoins live in.
- **[OBSERVATION, now 3/3 on Baseline]** A-grade is again the best grade on **15M Baseline**
  (+0.11R(4)), matching ETH and XRP — three symbols in a row. On **15M Crypto-Tuned-Close** it
  flips to the *worst* grade (-0.21R(5)), same as XRP's Crypto-Tuned-Close (ETH is the one exception
  that keeps A best on 15M-Close too). So: A-best-on-15M is a real, reproducible Baseline pattern;
  the Crypto-Tuned-Close profile disrupts it on 2 of 3 symbols.
- **[OBSERVATION] Crypto-Tuned-Close's effect on ADA is genuinely mixed within the symbol itself** —
  worse on 1D (+5.20R → +1.20R) and 1W (-4.12R → -6.12R), better on 4H (+9.76R → +11.12R), 1H
  (+18.31R → +26.99R), and 15M (-15.25R → -11.76R). Combined with ETH (worse only on 15M) and XRP
  (better everywhere), all three symbols now show a *different* shape of response to the same
  profile change. There is no per-symbol rule visible yet, let alone a cross-symbol one — this
  keeps building the case against Crypto-Tuned-Close as any kind of default.
- **Clean otherwise:** all `Last event` strength readings positive across all 12 views (no negative
  values — third symbol confirming the source-level finding). No rendering bugs; one quirky but
  correct `Gate` message seen for the first time (`S · score short · 4/7` on 1M Baseline, `S · bar
  not closed · 5/7` on 1M Crypto-Tuned) — different rejection reasons than the `no zone touch`
  seen everywhere else, expected variety in the gate's reason string, not a bug.

---

---

### Task 7: SOL — 6 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 7` below.

**Interfaces:**
- Consumes: the confirmed `BINANCE:SOLUSDT` symbol string and the Profile toggle procedure from
  Global Constraints.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Load the symbol.** Set the chart symbol to `BINANCE:SOLUSDT`.
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
- [x] **Step 14: Append SOL findings and commit.** Same procedure as Task 4 Step 14, naming SOL.

### Findings — Task 7

| View | n | WR | Avg R | Total R | A | B | C |
|---|---|---|---|---|---|---|---|
| 1M Baseline | 0 | — | — | — | — | — | — |
| 1M Crypto-Tuned | 0 | — | — | — | — | — | — |
| 1W Baseline | 1 | 0% | -0.49R | -0.49R | — | — | -0.49R(1) |
| 1W Crypto-Tuned | 1 | 0% | -0.49R | -0.49R | — | -0.49R(1) | — |
| 1D Baseline | 31 | 52% | +0.62R | +19.22R | —(0) | -0.11R(3) | +0.70R(28) |
| 1D Crypto-Tuned-Close | 43 | 44% | +0.29R | +12.39R | —(0) | +0.27R(17) | +0.30R(26) |
| 4H Baseline | 81 | 42% | +0.02R | +1.90R | +0.54R(10) | -0.08R(30) | -0.03R(41) |
| 4H Crypto-Tuned-Close | 87 | 48% | +0.09R | +7.66R | +0.63R(11) | -0.12R(37) | +0.14R(39) |
| 1H Baseline | 72 | 54% | +0.20R | +14.48R | +0.37R(2) | +0.16R(18) | +0.21R(52) |
| 1H Crypto-Tuned-Close | 76 | 53% | +0.24R | +18.17R | +0.98R(2) | +0.04R(26) | +0.31R(48) |
| 15M Baseline | 94 | 31% | -0.21R | -19.63R | -0.36R(7) | -0.41R(22) | -0.13R(65) |
| 15M Crypto-Tuned-Close | 96 | 33% | -0.29R | -27.84R | -0.59R(13) | -0.38R(20) | -0.20R(63) |

- **[OBSERVATION] SOL breaks the "A-grade best on 15M Baseline" pattern — fully on Crypto-Tuned-Close,
  partially on Baseline.** ETH, XRP, and ADA all showed A as the best (or least-bad) grade on 15M
  Baseline; SOL's 15M Baseline has C as least-bad (-0.13R(65)) with A in the *middle* (-0.36R(7))
  and B actually worst (-0.41R(22)) — so A isn't best, but it isn't the extreme-worst case either
  (corrected after a closer re-check: an earlier pass here mis-stated A as the worst grade on this
  view). On 15M Crypto-Tuned-Close, SOL is unambiguous: A is worst (-0.59R(13)), C best (-0.20R(63)).
  Downgraded from "reproducible pattern" to "true on 3 of 4 symbols" — still notable, but not
  universal, and not something a trader could safely rely on without knowing which symbol they're
  looking at.
- **[OBSERVATION] Crypto-Tuned-Close's effect on SOL is yet another distinct shape**: worse on 1D
  (+19.22R → +12.39R) and 15M (-19.63R → -27.84R), better on 4H (+1.90R → +7.66R) and 1H (+14.48R →
  +18.17R). Combined with ETH (worse only on 15M), XRP (better everywhere), and ADA (worse on 1D/1W,
  better on 4H/1H/15M), all four symbols now show *different* response shapes to the same profile
  change — the strongest evidence yet against Crypto-Tuned-Close as any kind of default, blanket or
  otherwise.
- **[Confirms Part 0 self-exclusion logic]** On **1M** (both profiles), `Confirm` showed `Ichi -`
  and the `Gate` denominator read `1/6` and `2/6` instead of the usual `X/7` — the Ichimoku point
  correctly excludes itself from the denominator when `ichiReady` is false (insufficient monthly
  history for the cloud calculation), exactly as the source comment describes. First time this
  exclusion was directly observed rather than just read from source.
- **Clean otherwise:** no negative-price targets on any SOL view (price stays ≥ ~$100, same as ETH
  — reinforces that the ADA TP3 bug is specific to low-priced assets), all `Last event` strength
  readings positive, no rendering bugs across all 12 views. **This closes all 48 planned views.**

---

---

### Task 8: Synthesis — ranked backlog

**Files:**
- Modify: this plan doc — append the `## Enhancement Backlog` section below.

**Interfaces:**
- Consumes: `### Findings` sections from Tasks 3-7.
- Produces: a ranked backlog the user can turn into new dated spec/plan pairs, following this
  repo's existing pattern.

- [x] **Step 1: Re-read every Findings section.** Tasks 3 through 7, in order.
- [x] **Step 2: Group repeated findings.** An issue seen on more than one view is one backlog entry
  noting every view it appeared on, not one entry per view.
- [x] **Step 3: Write the backlog section.** Append `## Enhancement Backlog` at the end of this
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

Ranked highest-impact first. Views = how many of the 48 symbol/timeframe/profile combinations
(plus the Task 3 setup checks) the finding appeared on.

### 1. [BUG] Trade target math has no price floor — negative TP3 on low-priced assets (1 view, high severity)

On ADA 1W Baseline, the live open SHORT trade's `TP3` read `-0.0555 (3.9R)` — a negative price
target on a spot asset that cannot trade below zero. Entry ≈0.2031, stop 0.3001 (risk
0.097/share); `0.2031 − 3.9 × 0.097 ≈ −0.178`, matching the displayed value. Not seen on
ETH/XRP/SOL (prices high enough that even large R multiples stay positive) — this is specific to
sub-$1 assets, which is a large fraction of the altcoin market. The engine's target calculation
needs a floor (zero, or some small positive price) for short-side targets.

### 2. [FINDING] Grade is inconsistent by symbol and timeframe, not simply anti-predictive (~40 views, all 4 symbols)

The EGX pass found grade *consistently* inverted — A-grade lost the most. The crypto sweep found
something messier: C beats A and B on ETH 4H (both profiles); A beats B and C on ETH 15M, XRP
15M-Baseline, ADA 15M-Baseline, ETH/XRP/ADA 1D-Close; A is the *worst* grade on ETH 1H and SOL
15M (both profiles). No single direction holds across symbols or timeframes — a trader reading
"A-grade, safer trade" would be right on some views and badly wrong on others, with no visible way
to tell which regime they're in. This is a stronger and more actionable finding than a flat
"anti-predictive" label: the grade isn't quietly failing in one consistent direction, it has no
reliable direction at all in this dataset.

### 2a. [CHECKED] Is the inconsistency in #2 just small-sample noise on the rare A-grade bucket?

No — checked at the user's request. Across all 27 A-grade view-results with n > 0, split by
sample size: for n < 6 (11 views), A landed as a clear extreme (best or worst of the three grades,
not the middle) in 8/11 (73%); for n ≥ 6, up to n = 14 (16 views), A was extreme in 12/16 (75%).
If the flipping were sample-size noise, the larger-n bucket should converge toward A sitting in
the middle far more often — it doesn't. The inconsistency looks structural (something about which
confirmation points dominate differs by symbol/timeframe regime), not an artifact of small counts.
This makes #2 a *stronger* finding, not a weaker one, and points toward the costlier real
diagnostic — instrumenting which of the 7 confirmation points fire on winners vs. losers per
trade — as the next step if this is worth pursuing further.

### 2b. [OBSERVATION] The 15M-Baseline "A is best" shape held on 3 of 4 symbols, but isn't universal

ETH, XRP, and ADA all showed A as the best (or least-bad) grade specifically on 15M Baseline; SOL's
15M Baseline puts C least-bad with A in the *middle* (B is actually worst there) — not a clean
inversion, just not "A best" either. On 15M Crypto-Tuned-Close specifically, SOL does invert
cleanly (A worst, C best). Worth remembering as a "usually, but not always" pattern — not a rule to
gate anything on.

### 3. [FINDING] Crypto-Tuned-Close cannot be a blanket default — four symbols, four different response shapes (32 views)

Turning on Asia + Stop-on-Close-Only changed Total R in a different direction on every symbol:
ETH — helps 1D/4H/1H, hurts 15M. XRP — helps everywhere tested. ADA — hurts 1D/1W, helps
4H/1H/15M. SOL — hurts 1D/15M, helps 4H/1H. This mirrors the EGX pass's own finding #3
(EGX-Tuned-Close isn't safe as a blanket default either) — the pattern generalizes past EGX
equities to crypto: **any settings profile needs to be verified per symbol**, not applied
wholesale.

### 4. [ANSWERED] Does `Score: Killzone` discriminate crypto setups the way it does on EGX?

Inconclusive by design — `Score: Killzone` was **on** in every view run (Baseline and both
Crypto-Tuned variants), so this sweep never isolated killzone-on vs. killzone-off. What it did
test is narrower: does *adding the Asia session* to an already-active killzone score change
results? Answer: yes, but with no consistent direction (see #3) — sometimes more trades and worse
grades (XRP 1W: n=8, C-grade split changes but Total R unchanged), sometimes materially different
performance (ETH 1M: Gate moved from 1/7 to 2/7 the instant Asia was toggled, on the same bar).
The honest conclusion is that this plan answers "does adding Asia help" (no consistent answer) but
not "does the killzone score matter at all" (would need a killzone-off profile run separately).

### 5. [CONFIRMED CLEAN] The Task 1/2 killzone fix works correctly on all four symbols

`Session Timezone` reads `America/New_York` and `Asia Killzone Time` (`2000-0000`, default off)
is present on every fresh instance across all 4 symbols — no stale-default sightings once the
fresh-instance pattern from Task 3 was used throughout. Toggling `Show Asia Killzone` visibly
changed the chart background tint and moved the `Gate` fraction in the same render pass (first
seen on ETH 1M Crypto-Tuned) — the fix is not just present in settings, it's actually being
evaluated and scored. This closes the deferred live check from Task 1/2.

### 6. [CONFIRMED CLEAN, closes EGX backlog #5] Break-strength (`Last event ... X.Xx`) never read negative

Across all 48 crypto views, every `Last event` strength reading was positive (0.2x–3.0x). This
matches the source-level read from Task 1 (`math.abs(close - open) / structAtr` cannot go
negative) and confirms the EGX backlog's bug-candidate #5 was never actually reproducible — safe
to close that item as "investigated, not a bug" rather than leave it open.

### 7. [CONFIRMED CLEAN] Ichimoku's self-exclusion from the score denominator works on live data

On SOL 1M (both profiles — the shortest-history monthly views), `Confirm` showed `Ichi -` and the
`Gate` fraction read `X/6` instead of the usual `X/7`, matching the source's `ichiOn = scoreIchimoku
and ichiReady` guard for insufficient monthly history (`senkouBLen + ichiDisp` bars). First time
this exclusion was observed directly rather than just read from source — no code change needed,
just confirmation.

### 8. [ENVIRONMENT NOTE] Panel legibility needs a ~1600×1000 browser window with the legend collapsed

Not a code bug — a session note for next time. The STRUCTURE/PERFORMANCE panel got clipped at
default and even oversized (2200px-tall) browser windows in early Task 4 testing; the fix was a
1600×1000 window plus collapsing the indicator legend list (`Hide indicators legend`), which then
worked reliably for the remaining 46 views. Worth setting up front in any future TradingView
Playwright session.

*(filled in during Task 8)*
