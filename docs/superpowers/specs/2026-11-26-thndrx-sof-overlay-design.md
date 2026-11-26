# ThndrX Session Order Flow overlay — design

Date: 2026-11-26. Status: approved in conversation (approach and data route picked by the user; the user then handed
over the build, test and review: "build it test it review using Fable").

## Intent

The ICT overlay (`tools/thndrx/`, PR #11) puts the ICT indicator on ThndrX's TradingView chart, where Pine cannot
run. The user wants the same for **Session Order Flow** (`src/session-orderflow.pine`, SESS-OF), **fully identical to
the indicator on every time frame**: every drawing, the dashboard, and the trade module.

## What the measurement decided (2026-11-26)

SESS-OF builds its volume profile and delta from lower-timeframe bars (`request.security_lower_tf`: 1m on intraday
charts, 30m on daily, 4h above). Run on 100 EGX daily charts (5 years) with and without those intrabars: liquidity
pool runs (the trade model's entries) were identical on all 2,778 run bars, but only 39.9% of FAVOURABLE days survived
without intrabars, bias agreed 62% of the time and POC moved by a median 1% of price. So the overlay **fetches real
intrabars** (option B). Using only the chart's bars (option A) was rejected.

## Recon facts (live, 2026-11-26, logged in)

- Thndr's own datafeed object is reachable in the chart frame: `ChartApiInstance._studyEngine._externalDatafeed`
  (TradingView Datafeed API: `resolveSymbol`, `getBars`, `subscribeBars`). It authenticates its own requests, so the
  overlay never touches the login token.
- `getBars` answers `noData` when `countBack` is 0; with `countBack >= 1` it returns the most recent chunk of bars
  **ending at `to`**, ignoring `from` (1m ≈ one month per request, 10m ≈ one year). Base resolutions: 1, 5, 10, 60
  minutes (asking '30' silently returns 1m bars). Bars `{ time (ms), open, high, low, close, volume }`, split-adjusted.
- **1m bars reach back the full 5 years** (COMI to 2021-12), as do 10m and 60m.
- TradingView recently blocks sub-daily EGX data for the user (their report), so TradingView's own SESS-OF on EGX
  already runs without intrabars there. The overlay reproduces the indicator as designed; parity of the intrabar path
  is checked offline (the port matched TradingView's Data Window 37/37 when intrabars were available).

## Goals

1. A second Tampermonkey userscript, `dist/thndrx-sof.user.js`, that draws on the ThndrX trade chart everything the
   Pine draws: session boxes (24h mode) and the opening-range box (single-session mode) with their state text and
   colours, the reference high/low lines, chart- and HTF liquidity-pool bands (live and faded taken ones), developing
   POC/VAH/VAL lines with tags, prior-period POC/VA sets, and the trade module (both entry models: lines, BUY/SELL,
   result labels), plus the dashboard table with the same rows and texts.
2. All Pine inputs in a settings dialog (same groups, labels, defaults, tooltips), stored in `localStorage`.
3. Intrabars from Thndr's datafeed: lower timeframe resolved exactly as Pine (`Auto` → 1 / 30 / 240), built from
   Thndr's base resolutions (1→1, 3→1, 5→5, 15→5, 30→10, 60→60, 240→60), session-aligned.
4. Runs next to the ICT overlay without either disturbing the other.

## Non-goals

Alerts, `Log Closed Trades` (Pine Logs do not exist outside TradingView: the input is shown disabled), orders,
mobile, publishing.

## Anti-goals

Same as the ICT overlay: nothing saved to Thndr (drawings `disableSave`, removed only by id), no interference with
the user's drawings, never freeze the page, never show a guess as fact (fallbacks are named in the dashboard).

## Approaches (data route)

1. **Thndr's datafeed object (chosen, the user's pick).** Same requests the chart makes, no token handling. Risk: the
   path is a library internal; if it is missing the overlay falls back to chart-bar direction (Pine's own fallback) and
   says so in the dashboard.
2. Direct REST calls with the stored bearer token: depends on Thndr's private API and token format (15-minute
   expiry); rejected.
3. Switching the chart to 1m/10m and reading `exportData`: visible to the user and saved by Thndr; rejected.

## Design

- **Engine** (`tools/backtest/sof-engine.mjs`, single source of truth shared with the backtests): gains, behind
  options that default to today's behaviour, (a) the Liquidity-run model (`entryModel`), (b) `showTrades`,
  (c) `lastBarOpen` (the forming bar is not `barstate.isconfirmed`: no pool resolution, no sweep/breakout, no entries),
  (d) London / New York / opening-range sessions, (e) a `render` mode that records every Pine drawing through a small
  Pine drawing registry (creation order, explicit deletes, `max_boxes_count = 200`, lines/labels 500, oldest
  auto-deleted at creation like Pine), and (f) the dashboard's last-bar values. Existing backtest output must not move
  (regression snapshot of 97 cases taken before the change).
- **Render plan** (`sof-plan.mjs`): registry objects → the painter's boxes/lines/labels (boxes gain text); dashboard →
  panel rows.
- **Intrabars** (`sof-ltf.mjs`): paging loader over the datafeed (backwards from now to the chart window start),
  aggregation to the wanted lower timeframe, a per-symbol cache (memory + IndexedDB), tail refresh on bar close and at
  most once a minute for the live panel.
- **Shared shell**: `main.mjs` becomes a generic overlay loop (`overlay.mjs`) used by both apps; `ui.mjs` becomes a
  factory (ids, button text, title, inputs) so both buttons and panels coexist; history loads from the two overlays
  are serialised through a lock on the chart frame.
- **Build**: `build.mjs` writes both bundles.

## Verification

1. Regression: the 97-case snapshot of `runSof` is unchanged.
2. Run model vs TradingView logs (`RUN_COMI_1D.csv` 33 trades, `RUN_BTC_240.csv` 46 trades) and vs the research
   simulator.
3. Unit tests for the registry caps, plan, panel texts, LTF aggregation and paging, inputs, UI, build.
4. Live on ThndrX (Playwright, user logged in, writes to `/tvcharts/drawings|layouts` blocked in-page): drawings,
   panel, settings, intrabar loading time, symbol/time-frame switches, both overlays together, nothing saved.
5. Code review by a Fable-model reviewer (user's request).

## Left to the builder

Module split, cache sizes, shape overrides for box text, the dialog look; README sections (standing instruction).
