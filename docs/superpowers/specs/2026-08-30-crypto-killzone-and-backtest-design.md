# Crypto Killzone Fix and Backtest Verification — Design

**Date:** 2026-08-30
**Status:** Design approved, execution not yet started
**File under test:** `src/ict-rsi-ma-indicator.pine`
**Depends on:** [[trade-system-roadmap]], [[pine-has-no-test-framework]]
**Related:** `docs/superpowers/specs/2026-08-29-egx-backtest-verification-design.md` (same method, EGX instead of crypto)

## Purpose

Two things prompted this, in order:

1. The user wants the indicator read against crypto price action (ETH, XRP, ADA, SOL) the same
   way the EGX pass read it against Egyptian equities — a deliberate, screenshot-driven audit, not
   a reasoned guess.
2. Before that sweep can mean anything, the killzone feature itself needs auditing. Crypto trades
   24/7, so `Score: Killzone` — off by design on single-session EGX — is expected to matter here,
   which makes it worth confirming the killzone windows are actually correct before trusting any
   finding that touches them.

## Part 0: Killzone timezone audit (blocks everything else)

**Finding, high confidence:** `sessionTimezone` (`src/ict-rsi-ma-indicator.pine:42`) defaults to
`"Africa/Cairo"`, and `londonSession` / `newYorkSession` (lines 44, 46) are `"0200-0500"` and
`"0700-1000"` — the hour ranges commonly published for the ICT London and New York killzones *in
New York time*. Pine's `time(timeframe, session, timezone)` reads the session string against the
civil clock of whatever timezone is passed in. Passing `Africa/Cairo` with New York's hour numbers
does not shift a New York-time window into Cairo-time for display — it evaluates an entirely
different real-world window: 02:00–05:00 and 07:00–10:00 on Cairo's own clock, which does not
track London or New York session opens at all, since Cairo's UTC offset moves independently of
UK/US daylight saving.

This has been true since the first scaffold commit (`5534508`, 2026-08-04) — it predates every
later commit that touches killzones, so it is not a regression, and nothing in the README or
commit history documents a deliberate recalculation. The two on-chart labels ("London Killzone",
"New York Killzone") are a reasonable trader-facing name for *a* pair of fixed daily windows; they
are just very unlikely to be the real London/New York sessions today.

**Fix:** change `sessionTimezone`'s default to `"America/New_York"`. ICT killzones are
conventionally quoted in New York time by convention (that's why 0200-0500 and 0700-1000 look
"standard" in the first place); evaluating them against `America/New_York` makes Pine's own
DST-aware session matching do the right thing automatically, for London and New York alike, on
every future date without hand-recalculated offsets. This is a one-line default change plus a
tooltip note — the input stays user-editable for anyone who genuinely wants a different reference
clock.

**Verification plan (no compiler, per [[pine-has-no-test-framework]]):** confirm on a live
TradingView chart that the shaded London window lines up with a known London-session marker (e.g.
compare against the exchange's own session-highlight feature or a second, independently-sourced
killzone script) before trusting any Score: Killzone finding in the crypto sweep. This is a Part 0
task, not folded into the symbol sweep, because every later profile that has `Score: Killzone` on
depends on it.

## Part 1: Asia killzone

**Decision: add it, gated off by default.** The existing tooltip on `Score: Killzone`
(`src/ict-rsi-ma-indicator.pine:70`) already says "turn off on single-session markets such as
EGX" — the two-session (London/NY) design assumes a market where only Western trading hours carry
volume. Crypto has no closed session; Asian-hours volume (Tokyo/Hong Kong/Singapore, plus the
Asian retail/whale activity that drives a large share of ETH/XRP/ADA/SOL flow) is not a rounding
error the way it is on EGX. Leaving Asia out understates when "someone is actually trading" for
exactly the symbols this plan is about to test.

Gated off by default (`showAsiaKZ = input.bool(false, ...)`) because turning it on changes what
`killzoneActive` means for every existing chart that has this indicator saved, including EGX ones
where a third always-on session would just make the killzone point easier to earn without adding
signal. Existing users' saved settings are unaffected; the crypto profile in Part 2 turns it on
explicitly.

**Session window:** `"2000-0000"` in `America/New_York` time (the commonly cited Asian killzone,
Tokyo open through the pre-London lull). `input.session` cannot cross midnight and land on the
right calendar day the way `"2000-0000"` does in Pine — confirm this string is valid Pine syntax
(it is the documented way to express an overnight session) during implementation, not assumed here.

**Implementation shape** (for the fix task, not executed in this design doc):
- Add `showAsiaKZ` / `asiaSession` inputs next to the existing two (`src/ict-rsi-ma-indicator.pine:41-46`).
- Add `asiaActive = showAsiaKZ and not na(time(timeframe.period, asiaSession, sessionTimezone))` near line 503.
- Fold into `killzoneActive := londonActive or newYorkActive or asiaActive` (line 505).
- Add a third `bgcolor(...)` call alongside lines 507-508 with its own color so the three sessions
  are visually distinguishable.
- `killzonePointOn` (line 726) already generalizes (`showLondonKZ or showNewYorkKZ`) — extend it to
  include `showAsiaKZ`.
- README: add the Asia row next to the existing Killzone description (line 58) and note the
  default-off rationale in the settings table (near line 443).

## Part 2: Crypto backtest sweep

Same method as the EGX pass: drive TradingView, screenshot, read the panel, log findings, close
with a ranked backlog. No ground-truth backtest to diff against — "verification" means checking
internal consistency and README-documented behavior, per
`docs/superpowers/specs/2026-08-29-egx-backtest-verification-design.md`.

**In scope:**
- 4 symbols × 6 timeframes × 2 profiles = 48 chart views.
- Logging anomalies as **bugs** or **enhancement ideas**, same taxonomy as the EGX pass.
- A ranked backlog at the end.

**Out of scope:**
- Any further code change beyond the Part 0/1 fix — the sweep itself produces a backlog, not a
  patch.
- Symbols outside the four named coins.
- An external/automated backtest harness — the panel's own `PERFORMANCE` block is still the
  measurement tool.

**Symbols:** `BINANCE:ETHUSDT`, `BINANCE:XRPUSDT`, `BINANCE:ADAUSDT`, `BINANCE:SOLUSDT` — to be
confirmed via TradingView symbol search at execution time, the same way the EGX plan confirmed its
`EGX_DLY:` prefix rather than assuming it. Binance is the default choice for liquidity and history
depth; swap per-symbol if search turns up a better-covered exchange for any one of the four.

**Timeframes:** 1M, 1W, 1D, 4H, 1H, 15M — the same five as the EGX pass plus 15M, added at the
user's request to read entry-level detail on a market that never closes and so never lacks bars at
that granularity the way EGX would overnight.

**Settings profiles:**

1. **Baseline** — script defaults, untouched (after the Part 0 timezone fix and Part 1 Asia
   addition land — Baseline now includes a correct London/NY window and Asia off).
2. **Crypto-Tuned** — `Score: Killzone` on with all three sessions shown (`Show Asia Killzone` on),
   since unlike EGX this is not a single-session market. `Long Trades Only` stays off (default) —
   crypto is shortable, there is no cash-equity constraint to encode. `Stop on Close Only` on for
   1D/4H/1H/15M (crypto wicks are frequently more extreme than EGX equities, making this worth
   testing here too), off for 1M/1W for the same reason it's off there in the EGX profile — that
   flag targets thin intrabar wicks, not bars where the whole bar is the unit.

This mirrors the EGX pass's two-profile structure (shipped-as-is vs. README-recommended-for-this-
market) rather than inventing a new one.

**What counts as a finding:** identical checklist to the EGX design doc — internal consistency
(panel numbers vs. visible trade history), structural sanity (BOS/CHoCH labels vs. visible swings),
market-specific risk areas (here: does Participation's volume data look real on a Binance feed,
does the killzone shading now visibly track real London/NY/Asia hours, does 24/7 trading produce
any bar-count or session-boundary edge case the EGX pass never could), and rendering bugs.

## Session mechanics

Same as the EGX pass: Playwright drives the user's already-open, already-logged-in TradingView tab;
per-combo the agent sets symbol → timeframe → profile → screenshots → reads `PERFORMANCE`,
`Confirm`, and `Gate` panel rows → logs findings inline in the plan doc; a leftover drawing pauses
the session for the user to clear.

## Deliverable

- This design doc.
- A companion plan doc (`docs/superpowers/plans/2026-08-30-crypto-killzone-and-backtest.md`),
  written via the writing-plans skill, sequencing Part 0 (timezone fix) → Part 1 (Asia killzone) →
  Part 2 (40-view sweep) → ranked backlog.
- Findings and backlog appended to the plan doc as the session runs, summarized back to the user
  at the end.
