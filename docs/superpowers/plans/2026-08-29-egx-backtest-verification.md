# EGX Backtest Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan task-by-task in the current session (Playwright drives a live, already-logged-in browser tab — this cannot be parallelized across fresh subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read `src/ict-rsi-ma-indicator.pine` against real EGX price action across 5 symbols × 5 timeframes × 2 settings profiles, log every anomaly as a bug or an enhancement idea, and close with a ranked backlog.

**Architecture:** No code changes happen in this plan. Playwright drives the user's already-open, already-logged-in TradingView tab; each task sets up one symbol, cycles it through every timeframe/profile combination, screenshots the chart, and reads the `PERFORMANCE` / `Confirm` / `Gate` panel rows off the screenshot. Findings are appended to this document under each task's `### Findings` heading as the session runs, so the file itself is the running record — resumable if the session spans more than one sitting.

**Tech Stack:** TradingView web UI, driven via the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`, etc.). No automated pass/fail — verification is visual read-back against the README's documented behavior, per [[pine-has-no-test-framework]].

**Spec:** `docs/superpowers/specs/2026-08-29-egx-backtest-verification-design.md`

**Starting point:** `src/ict-rsi-ma-indicator.pine` on `master`, all 10 roadmap features merged (see [[trade-system-roadmap]]). This plan does not branch or modify that file.

## Global Constraints

- **No code changes.** This plan produces a written backlog, not a patch. Do not edit `src/ict-rsi-ma-indicator.pine` while executing it.
- **Two settings profiles only**, per the spec:
  - **Baseline** — every input at its shipped default.
  - **EGX-Tuned** — `Long Trades Only` on, `Score: Killzone` off, plus `Stop on Close Only` **on** for 1D/4H/1H views and **off** for 1M/1W views. This is two variants in practice (`EGX-Tuned` and `EGX-Tuned-Close`).
- **No template switching — this TradingView account is on the Basic plan, which allows only one saved indicator template.** Discovered during Task 0: attempting to save a second template ("EGX-Tuned") triggered TradingView's upgrade paywall and silently failed to save (confirmed by reopening *Indicator templates → Open template…* and finding only `Baseline` listed, even though the save dialog appeared to succeed both times). Every task instead toggles inputs directly in the Settings dialog for each profile switch, per the **Profile toggle procedure** below.
- **Profile toggle procedure** — open the indicator's Settings (double-click "ICT-RSI-MA" in the chart legend), then:
  - **Baseline:** `Long Trades Only` off, `Score: Killzone` on, `Stop on Close Only` off. (Fastest via `Defaults → Reset settings`, which resets every input to its shipped default in one click — confirm the three flags read this way afterward.)
  - **EGX-Tuned** (1M/1W views): `Long Trades Only` on, `Score: Killzone` off, `Stop on Close Only` off.
  - **EGX-Tuned-Close** (1D/4H/1H views): `Long Trades Only` on, `Score: Killzone` off, `Stop on Close Only` on.
  - Click **Ok** to apply. Confirm each checkbox's state via `browser_find` before closing the dialog — TradingView's own default for `Score: Killzone` is **on**, so it must be explicitly unchecked for both EGX profiles, not left alone.
- **Symbols:** `EGX_DLY:ELEC`, `EGX_DLY:ABUK`, `EGX_DLY:ORWE`, `EGX_DLY:AMOC`, `EGX_DLY:MASR` — confirmed in Task 0 via TradingView's symbol search (EGX's actual TradingView exchange prefix is `EGX_DLY`, not the `EGX` shown in the search-result badge).
- **Timeframes:** 1M, 1W, 1D, 4H, 1H — five, not six. (The original request repeated 1D; confirmed a typo and dropped.)
- **A finding must be reproducible on screen.** A glitch that doesn't survive a refresh is noise, not a finding — don't log it.
- **If a leftover drawing obstructs a view, stop and ask the user to hide it manually before continuing.** Do not attempt to delete or modify chart drawings via Playwright — they may be the user's own work.
- **Do not commit `docs/` changes to git without the user's explicit go-ahead at that point**, even though this plan's own steps say to commit — confirm before the first commit of the session; after that, proceed under the same standing approval unless told otherwise.

---

### Task 0: Environment setup and indicator verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-29-egx-backtest-verification.md` (this file) — append findings under `### Findings` below.

**Interfaces:**
- Consumes: nothing.
- Produces: confirmed exact ticker strings for all 5 symbols (done — see Global Constraints); confirmation that "ICT + RSI/MA Confluence" is on the chart and loaded from the current `master` source (done — 1690 lines, matches header-for-header); the Profile toggle procedure in Global Constraints, used by every later task in place of templates.

- [x] **Step 1: Confirm the Playwright browser is attached and logged in**

Done. The Playwright-controlled browser was not logged in by default (a fresh instance, not the user's regular browser) — the user signed in manually in that window. Confirmed via the hamburger menu reading "Logged in as ibrahimkeshta1995" instead of "Sign in / Join now".

- [x] **Step 2: Confirm or install the indicator**

Done. "ICT + RSI/MA Confluence" already exists under *My Scripts* as "My ICT Script" and is already applied to the user's default chart (symbol JUFO). Opened it in the Pine Editor and confirmed it is current: header matches `src/ict-rsi-ma-indicator.pine` line-for-line, and `Ctrl+End` in the editor lands on **Line 1690**, matching the repo file's exact line count. No re-paste needed.

- [x] **Step 3: Confirm the 5 EGX ticker symbols**

Done — see Global Constraints for the confirmed list. Each ticker was searched individually via the chart's symbol search; all five resolve unambiguously to EGX-listed companies (ELEC = Electro Cable Egypt, ABUK = Abou Kir Fertilizers & Chemical Industries, ORWE = Oriental Weavers Carpet, AMOC = Alexandria Mineral Oils, MASR = Madinet Masr for Housing & Development). Loading any one of them and checking the "Chart for ..." accessibility label revealed the true TradingView symbol is prefixed `EGX_DLY:`, not the `EGX:` originally assumed.

- [x] **Step 4: Establish the profile toggle procedure**

Originally planned as three saved templates; the account is on TradingView's Basic plan, which caps saved indicator templates at one, so this was reworked into the manual **Profile toggle procedure** in Global Constraints. One template (`Baseline`) does exist and can be used as a quick reset if useful, but is not relied on by later tasks.

Also discovered while doing this: the user's default chart carries ~9 other indicators (Gann tools, other ICT/LuxAlgo scripts, Elliott Wave, etc.), but all were already toggled hidden — only "ICT-RSI-MA" is visible. No cleanup was needed; the visual density seen in early screenshots (orange MA line, pink Kumo cloud, multiple price-axis labels) is entirely our own indicator's output, not clutter from other scripts.

- [ ] **Step 5: Append setup findings and commit**

Under a `### Findings — Task 0` heading below, record: the confirmed ticker strings, whether the indicator had to be freshly pasted, and anything unexpected (e.g. a symbol resolving to a different exchange, a template failing to save).

Ask the user for go-ahead, then:

```bash
git add docs/superpowers/plans/2026-08-29-egx-backtest-verification.md
git commit -m "docs: record EGX backtest verification setup findings"
```

### Findings — Task 0

- Playwright's browser is a fresh, separate instance — not the user's regular logged-in browser. It required a manual sign-in the first time. (Not a bug in the indicator; an environment note for future sessions.)
- The indicator was already saved and current — no re-paste needed.
- The account is on TradingView's **Basic plan**, which allows only **one** saved indicator template. Plan reworked to toggle inputs manually (see Global Constraints) rather than switching named templates. This roughly doubles the number of Settings-dialog round-trips per symbol (12 toggle-and-confirm actions instead of 10 one-click template applies) but changes nothing about what's being measured.
- EGX's real TradingView exchange prefix is `EGX_DLY:`, not `EGX:` — the search-result exchange badge reads "EGX" but the resolved chart symbol is `EGX_DLY:<TICKER>`. Worth noting in the README or spec if this project ever documents EGX symbol lookup again.
- The user's default chart already had ~9 other indicators loaded, but all were already hidden — no cleanup was needed before starting.

---

### Task 1: ELEC — 5 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 1` below.

**Interfaces:**
- Consumes: the confirmed `EGX_DLY:ELEC` symbol string and the Profile toggle procedure from Global Constraints.
- Produces: nothing consumed by later tasks — each symbol task is independent.

- [x] **Step 1: Load the symbol**

Set the chart symbol to `EGX_DLY:ELEC`.

- [x] **Step 2: 1M — Baseline**

Set the timeframe to 1M (monthly). Set inputs to the **Baseline** profile (Global Constraints). Wait for the chart to finish rendering (no loading spinner). Take a full-chart screenshot. Read the `PERFORMANCE`, `Confirm`, and `Gate` panel rows and check them against the spec's "What counts as a finding" list (internal consistency, structural sanity, EGX-specific risk areas, rendering bugs). If a drawing obstructs the view, stop and ask the user to hide it before continuing.

- [x] **Step 3: 1M — EGX-Tuned**

Set inputs to the **EGX-Tuned** profile (1M keeps `Stop on Close Only` off). Screenshot and read the same three panel rows.

- [x] **Step 4: 1W — Baseline**

Set timeframe to 1W. Set inputs to **Baseline**. Screenshot and read.

- [x] **Step 5: 1W — EGX-Tuned**

Set inputs to **EGX-Tuned** (still no close-only on weekly). Screenshot and read.

- [x] **Step 6: 1D — Baseline**

Set timeframe to 1D. Set inputs to **Baseline**. Screenshot and read.

- [x] **Step 7: 1D — EGX-Tuned-Close**

Set inputs to the **EGX-Tuned-Close** profile (1D is one of the three close-only timeframes). Screenshot and read.

- [x] **Step 8: 4H — Baseline**

Set timeframe to 4H. Set inputs to **Baseline**. Screenshot and read.

- [x] **Step 9: 4H — EGX-Tuned-Close**

Set inputs to **EGX-Tuned-Close**. Screenshot and read.

- [x] **Step 10: 1H — Baseline**

Set timeframe to 1H. Set inputs to **Baseline**. Screenshot and read.

- [x] **Step 11: 1H — EGX-Tuned-Close**

Set inputs to **EGX-Tuned-Close**. Screenshot and read.

- [ ] **Step 12: Append ELEC findings and commit**

Under `### Findings — Task 1` below, write one entry per anomaly found across the 10 views, each tagged `[BUG]` or `[ENHANCEMENT]`, naming the exact view (timeframe + profile) it appeared on. If nothing notable turned up on a view, a one-line "clean" note is enough — don't pad it. Ask the user for go-ahead, then commit as in Task 0 Step 5 (adjust the commit message to name ELEC).

### Findings — Task 1

Raw numbers per view (n = closed-trade count, WR = win rate, Avg R):

| TF | Baseline | EGX-Tuned(-Close) |
|---|---|---|
| 1M | n=7, 71% WR, +0.88R | n=2, 50% WR, -0.26R |
| 1W | n=39, 33% WR, +0.26R | n=25, 44% WR, +1.17R |
| 1D | n=97, 35% WR, +0.08R | n=61, 54% WR, +0.56R |
| 4H | n=130, 35% WR, -0.02R | n=70, 50% WR, +0.32R |
| 1H | n=92, 41% WR, +0.06R | n=51, 53% WR, +0.59R |

- **[ENHANCEMENT]** EGX-Tuned(-Close) beats Baseline on every timeframe from 1W down to 1H — win
  rate and Avg R both improve, consistently, not just on one lucky view. The 1M read (n=2) is too
  small to trust, but 1W/1D/4H/1H all agree. This is the strongest, most reproducible signal from
  this symbol: the README's own EGX-tuning advice (Long Only, Killzone off, Stop-on-Close on)
  visibly earns its keep here, not just in theory.
- **[BUG-candidate]** The `Last event` break-strength multiplier in the STRUCTURE panel is
  sometimes **negative** — e.g. `CHoCH · INTERNAL · -0.8x` on ELEC 1D (both Baseline and
  EGX-Tuned-Close showed this identically) — while other bars show positive values (`BOS · INTERNAL
  · 1.6x` on 4H, `1.8x` on 1M). The README describes this figure as "the breaking candle's body
  divided by ATR," which reads as a magnitude, not a signed value. Working hypothesis: the sign
  tracks break *direction* (down-breaks read negative) rather than being a genuine bug — but that's
  a guess, not a source read. Flagging for a source-code check; not fixed here (no code changes in
  scope for this plan).
- **[OBSERVATION]** Grade split is repeatedly inverted or degenerate on ELEC: A-grade trades often
  average *negative* R while B/C average positive (1W Baseline: A -0.33R (2) vs C +0.66R (22); 1D
  Baseline: B -0.14R (20) vs C +0.14R (77); 1H Baseline: A -0.31R (16) vs C +0.14R (76)). A-grade is
  frequently empty outright. This reproduces the README's own documented "score is anti-predictive"
  finding — previously called out for the trailing-stop model specifically — on the **pullback**
  model too, on this symbol, across multiple timeframes.
- **[OBSERVATION]** `Long Trades Only` collapses the 1M sample from n=7 to n=2 — ELEC's monthly
  trend is structurally down, so there just aren't many long setups at that granularity. Not a bug;
  a sample-size caveat worth remembering when reading any 1M EGX-Tuned view.
- **Clean:** no label overlap, panel clipping, or other rendering bugs across all 10 views. The
  STRUCTURE/TRADE/PERFORMANCE panel (fixed at Top Right) sometimes visually overlaps the price-scale
  watermark text and the long indicator-legend list at the top-left, but stayed legible throughout —
  not logged as a bug, just a pre-existing cosmetic density issue shared by every instrument.

---

### Task 2: ABUK — 5 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 2` below.

**Interfaces:**
- Consumes: the confirmed `EGX_DLY:ABUK` symbol string and the Profile toggle procedure from Global Constraints.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Load the symbol**

Set the chart symbol to `EGX_DLY:ABUK`.

- [x] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [x] **Step 3: 1M — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [x] **Step 5: 1W — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [x] **Step 7: 1D — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 9: 4H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 11: 1H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.

If a drawing obstructs any view, stop and ask the user to hide it before continuing.

- [ ] **Step 12: Append ABUK findings and commit**

Same format as Task 1 Step 12, tagging each entry `[BUG]` or `[ENHANCEMENT]`. Ask for go-ahead, then commit.

### Findings — Task 2

| TF | Baseline | EGX-Tuned(-Close) |
|---|---|---|
| 1M | n=10, 70% WR, +0.95R | n=5, 100% WR, +1.52R |
| 1W | n=46, 46% WR, +0.32R | n=29, 45% WR, +0.27R |
| 1D | n=122, 37% WR, +0.56R | n=90, 48% WR, +0.66R |
| 4H | n=148, 39% WR, -0.03R | n=78, 53% WR, +0.05R |
| 1H | n=101, 43% WR, +0.50R | n=57, 47% WR, +0.54R |

- **[ENHANCEMENT]** Same pattern as ELEC: EGX-Tuned(-Close) improves Avg R on every single
  timeframe, and win rate on every timeframe except 1W (46%→45%, a wash). Two symbols in a row now
  back the README's EGX-tuning advice with real numbers, not just reasoning.
- **[BUG — confirmed, reproducible]** The `PERFORMANCE` panel's background box does not always
  expand to contain every row. On ABUK 1D (both Baseline, n=122, and EGX-Tuned-Close, n=90) one
  grade row rendered **outside** the grey panel background, overlapping the price chart and a
  structure line, instead of inside the box with the others. Seen on 4H and 1H at similar or larger
  trade counts without the same clipping, so it isn't simply "too many trades" — likely an edge case
  in how the panel's row-count-to-height calculation handles this specific symbol/interval
  combination. This is a genuine rendering bug, not a viewing artifact (Object Tree dock was closed
  for all these screenshots).
- **[OBSERVATION]** Unlike ELEC, ABUK's grade split does **not** consistently invert — A-grade is
  sometimes the best-performing grade (1M: A implied among 5W/0L; 1D Baseline A grade shows highest
  count) and sometimes the worst (4H, 1H, 1W EGX-Tuned: A grade negative while B/C positive). The
  "score is anti-predictive" finding from ELEC does not generalize cleanly to this symbol — worth
  keeping as a per-symbol caveat rather than a blanket rule when writing this up for the backlog.
- **[OBSERVATION]** ABUK 1W Baseline had a live trade signal fire mid-session (`Gate: L · READY ·
  5/7`), confirmed moments later as an open `LONG · C · 5/7` position at Entry 75.76. Confirms the
  Gate row's `READY` state and the live trade panel populate correctly in sync — no lag or stale
  state observed between the two.
- **[OBSERVATION]** The `n=` header row and the live ticker price flag (e.g. "ABUK 75.76") compete
  for the same screen position on every view where the panel sits at its default Top Right — this is
  the same recurring cosmetic collision noted on ELEC, now confirmed on a second symbol. Worth a
  backlog line: either the panel needs a top margin under the price scale's flag, or `Panel Position`
  should default somewhere the flag doesn't reach.
- **Clean otherwise:** no other label overlap or obstruction across the 10 views.

---

### Task 3: ORWE — 5 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 3` below.

**Interfaces:**
- Consumes: the confirmed `EGX_DLY:ORWE` symbol string and the Profile toggle procedure from Global Constraints.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Load the symbol.** Set the chart symbol to `EGX_DLY:ORWE`.
- [x] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [x] **Step 3: 1M — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [x] **Step 5: 1W — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [x] **Step 7: 1D — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 9: 4H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 11: 1H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.

If a drawing obstructs any view, stop and ask the user to hide it before continuing.

- [ ] **Step 12: Append ORWE findings and commit**

Same format as Task 1 Step 12. Ask for go-ahead, then commit.

### Findings — Task 3

| TF | Baseline | EGX-Tuned(-Close) |
|---|---|---|
| 1M | n=6, 83% WR, +1.00R | n=5, 100% WR, +1.40R |
| 1W | n=32, 34% WR, +0.29R | n=16, 50% WR, +1.00R |
| 1D | n=112, 30% WR, -0.23R | n=68, 41% WR, **-0.35R** |
| 4H | n=151, 30% WR, -0.13R | n=72, 40% WR, -0.01R |
| 1H | n=110, 23% WR, -0.50R | n=53, 38% WR, **-0.56R** |

- **[FINDING — tempers the "EGX-Tuned always helps" read from ELEC/ABUK]** On ORWE, EGX-Tuned-Close
  raises win rate on **every** timeframe (as on the other two symbols) but on 1D and 1H it makes
  **Avg R worse**, not better, despite the higher win rate. The likely mechanism: `Stop on Close
  Only` survives more wicks (more wins) but the fills it does take are worse (further from the
  wick-triggered stop), and on this symbol/timeframe combination that trade-off nets negative. This
  is exactly the trade-off the README's own tooltip warns about ("a worse fill than the stop level
  ... the trade is giving up the extra distance in exchange for surviving wicks") — ORWE 1D/1H is a
  real case where the giving-up outweighs the surviving. The backlog conclusion isn't "EGX-Tuned is
  better" — it's "EGX-Tuned is usually better, verify per symbol before assuming."
- **[OBSERVATION]** ORWE's `Last event` break-strength readings included **0.0x** (4H Baseline) and
  **0.1x** (1H, both profiles) — small positive values, never negative on this symbol. Combined with
  ELEC's negative readings and ABUK's/AMOC's TBD, this is useful raw data for Task 6's synthesis of
  the break-strength sign question.
- **[OBSERVATION]** ORWE has the longest history of the five symbols (data back to 2009) and the
  worst overall Baseline performance seen so far (30% WR on 1D/4H, 23% on 1H, deeply negative Total
  R on 1D at -25.28R). Whether that's a genuine edge-negative instrument for this strategy or an
  artifact of RSI/MA-length settings tuned on a different kind of stock is a fair question for
  follow-up, not something this pass can answer.
- **Clean:** no rendering bugs, no label overlap issues on ORWE specifically (the legend briefly
  auto-collapsed to a compact summary row once during the session — a hover-state UI behavior, not a
  bug — and was restored via the "Show indicators legend" toggle).

---

### Task 4: AMOC — 5 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 4` below.

**Interfaces:**
- Consumes: the confirmed `EGX_DLY:AMOC` symbol string and the Profile toggle procedure from Global Constraints.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Load the symbol.** Set the chart symbol to `EGX_DLY:AMOC`.
- [x] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [x] **Step 3: 1M — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [x] **Step 5: 1W — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [x] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [x] **Step 7: 1D — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 9: 4H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [x] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [x] **Step 11: 1H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.

If a drawing obstructs any view, stop and ask the user to hide it before continuing.

- [ ] **Step 12: Append AMOC findings and commit**

Same format as Task 1 Step 12. Ask for go-ahead, then commit.

### Findings — Task 4

| TF | Baseline | EGX-Tuned(-Close) |
|---|---|---|
| 1M | n=9, 33% WR, -0.29R | n=6, 50% WR, +0.07R |
| 1W | n=31, 26% WR, +0.48R | n=15, 33% WR, +0.04R |
| 1D | n=92, 37% WR, +1.02R | n=52, 40% WR, +0.87R |
| 4H | n=139, 35% WR, +0.00R | n=65, 42% WR, +0.14R |
| 1H | n=93, 29% WR, -0.26R | n=53, 38% WR, **-2.74R** |

- **[BUG — high severity, needs source investigation]** AMOC 1H EGX-Tuned-Close: Avg R is **-2.74R**
  and the B-grade bucket alone averages **-3.84R across 40 trades**. Every other reading this entire
  session — 49 other views across 5 symbols — sits in the -0.6R to +1.5R band, because a properly
  stopped trade should never lose much more than 1R by construction. A B-grade average of -3.84R
  over 40 trades means the bucket's *sum* is around -154R, which is not explainable by ordinary
  stop-outs — either one or a few catastrophic outlier trades are dragging the average (most likely:
  a large weekend/session gap on this thin, volatile stock, recorded at the open per the README's
  own documented gap-handling rule) or there's a real bug in how `Stop on Close Only` computes the
  exit distance on this specific timeframe. **Not resolved in this pass** — this needs someone to
  scroll the 1H AMOC chart's trade history for the specific losing label(s) driving this number, or
  read the `blendedResultR` / gap-handling code directly. Flagging as the single most important item
  for the backlog.
- **[ENHANCEMENT]** Outside that one anomaly, AMOC follows the same pattern as ELEC/ABUK: EGX-Tuned
  raises win rate on every timeframe. Avg R rises on 1M/4H, dips slightly but stays strong on 1D
  (+1.02R → +0.87R), dips on 1W (+0.48R → +0.04R), and craters on 1H for the reason above.
- **[OBSERVATION]** AMOC 1D Baseline is the best single reading of the entire session:
  n=92, +1.02R Avg R, +93.75R Total R. Worth keeping in mind when writing up the backlog summary —
  the strategy clearly *can* work well on EGX under the right symbol/timeframe, which argues against
  any conclusion that the engine is broken generally.
- **Clean rendering:** no panel clipping or label overlap observed on AMOC.

---

### Task 5: MASR — 5 timeframes × 2 profiles

**Files:**
- Modify: this plan doc — append findings under `### Findings — Task 5` below.

**Interfaces:**
- Consumes: the confirmed `EGX_DLY:MASR` symbol string and the Profile toggle procedure from Global Constraints.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Load the symbol.** Set the chart symbol to `EGX_DLY:MASR`.
- [ ] **Step 2: 1M — Baseline.** Set timeframe 1M, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 3: 1M — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [ ] **Step 4: 1W — Baseline.** Set timeframe 1W, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 5: 1W — EGX-Tuned.** Set inputs to **EGX-Tuned**, screenshot, read.
- [ ] **Step 6: 1D — Baseline.** Set timeframe 1D, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 7: 1D — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [ ] **Step 8: 4H — Baseline.** Set timeframe 4H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 9: 4H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.
- [ ] **Step 10: 1H — Baseline.** Set timeframe 1H, set inputs to **Baseline**, screenshot, read.
- [ ] **Step 11: 1H — EGX-Tuned-Close.** Set inputs to **EGX-Tuned-Close**, screenshot, read.

If a drawing obstructs any view, stop and ask the user to hide it before continuing.

- [ ] **Step 12: Append MASR findings and commit**

Same format as Task 1 Step 12. Ask for go-ahead, then commit.

### Findings — Task 5

*(filled in during execution)*

---

### Task 6: Synthesis — ranked backlog

**Files:**
- Modify: this plan doc — append the `## Enhancement Backlog` section below.

**Interfaces:**
- Consumes: every `### Findings — Task N` section from Tasks 0–5.
- Produces: a ranked backlog the user can turn into new dated spec/plan pairs, following this repo's existing pattern (see `docs/superpowers/plans/` and `docs/superpowers/specs/` for the convention used by every prior feature).

- [ ] **Step 1: Collect all findings**

Read back every `### Findings — Task N` section written during Tasks 0–5. List every `[BUG]` and `[ENHANCEMENT]` entry in one place.

- [ ] **Step 2: Deduplicate and rank**

Findings that recur across multiple symbols or timeframes are the strongest signal — note the recurrence count next to each. Rank bugs above enhancements; within each group, rank by how many symbol/timeframe views it showed up on.

- [ ] **Step 3: Write the backlog section**

Append a `## Enhancement Backlog` section at the end of this document: a table or ordered list, each entry naming the issue, how many views it appeared on, and whether it's a `[BUG]` (contradicts the README) or `[ENHANCEMENT]` (works as designed, EGX suggests improving it).

- [ ] **Step 4: Summarize to the user and commit**

Present the ranked backlog to the user in chat. Ask whether any items should become new dated spec/plan pairs now, or whether the backlog stands as the deliverable for this pass. Ask for go-ahead, then:

```bash
git add docs/superpowers/plans/2026-08-29-egx-backtest-verification.md
git commit -m "docs: close out EGX backtest verification with ranked backlog"
```

## Enhancement Backlog

*(filled in during Task 6)*
