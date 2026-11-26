# ThndrX ICT overlay — design

Date: 2026-11-24. Status: draft for approval. Builder check done 2026-11-24.

## Intent

The user trades EGX stocks on Thndr. Thndr's advanced web platform, ThndrX (`https://x.thndr.app`), shows a
TradingView chart, but Pine Script cannot run there. The user wants the **full ICT + RSI/MA Confluence indicator**
(`src/ict-rsi-ma-indicator.pine`) on that chart, **drawn as it is on TradingView**, so analysis and order entry happen
on one screen.

## What ThndrX is (recon, 2026-11-23, public JS only, no login)

- Next.js app. The chart is TradingView's **Trading Platform library v31.1.0** (`library_path:
  "/trading_platform/charting_library/"`), loaded in a **same-origin iframe** (`iframe_loading_same_origin`).
- Thndr's own wrapper reaches the chart as `iframe.contentWindow.tradingViewApi` (`_innerAPI()` in chunk `7123-*.js`).
  The same object is reachable from a userscript on the parent page. The wrapper itself is not exposed on `window`.
- No `custom_indicators_getter` is configured. `studies_access` blacklists only "52 Week High/Low".
- Disabled: symbol search, compare, study and chart templates, and on mobile the legend and header. Layouts are saved
  to Thndr's server (`save_load_adapter`, `saveload_separate_drawings_storage`, `auto_save_delay: 5`).
- Time frames offered: 1, 5, 30, 60, 120 minutes, 1D, 1W.
- Routes seen: `/mobile/home`, `/mobile/market`, `/mobile/stock`, `/webview`. The desktop chart route was not
  seen without login; finding it is the first build step.

## Goals

1. A **Tampermonkey userscript** for **desktop Chrome/Edge** that, on ThndrX's desktop chart, draws everything the Pine indicator draws:
   - FVG boxes + "FVG" labels, OB/ob boxes + labels (major/internal transparency), mitigation removes them
   - structure: swing tags (HH/HL/LH/LL/EQH/EQL), swing rays, BOS/CHoCH lines + labels (events persist, state redraws)
   - the MA line, both trail-stop lines, both anchored VWAP lines, the Ichimoku Kumo (two spans + fill), displaced
     forward like the Pine `offset`
   - bullish/bearish signal triangles
   - the RSI readout label
   - killzone background shading on intraday charts
   - the trade box with its grade/score label, entry/stop/TP1–TP3 lines + labels, and the closed-trade `±R · reason`
     labels (pullback and trail models)
   - the info panel (the Pine `table`) with the same rows the Pine shows for the same inputs
2. **Both daily and intraday** time frames that ThndrX offers.
3. **All 125 Pine inputs** available in a settings dialog, with the same groups, names, defaults, and the Preset
   selector ("Custom" / "EGX Daily") resolving exactly as Pine does.
4. Recomputes on symbol change, time frame change, new bars, and live updates of the last bar.

## Non-goals

- Placing, changing or reading orders. The script never touches Thndr's trading UI.
- Alerts (`alertcondition`) and the hidden `DBG` data-window plots.
- Publishing or distributing to other users.
- Phone browsers, the `/mobile/*` routes and Thndr's native app (userscripts cannot run in the app). Desktop only
  (user's choice, 2026-11-24).
- The legend/data-window behaviour of a real indicator (approach 2, rejected below).

## Anti-goals (a failure even if it draws correctly)

- **Anything written to Thndr's servers.** Every drawing is created with `disableSave: true` (and `disableUndo: true`)
  so it never enters the user's saved layout. A drawing that shows up after reloading the page without the script is a
  bug.
- Interfering with the user's own drawings: the script only ever removes entity IDs it created itself.
- Freezing the page: the chart must stay usable while the script recomputes.
- Silently showing wrong signals. Where the overlay cannot match Pine (missing data, too little history), it says so
  in the panel instead of drawing a guess.

## Constraints

- **No Pine runtime anywhere in the browser.** All logic runs from the JavaScript port, `tools/backtest/ict-engine.mjs`
  (no imports, browser-safe). It matched TradingView 91/91 trades on dividend-adjusted daily data.
- The port covers **trade decisions only**. Not ported yet, and needed here: all drawing/rendering state (zone box
  lifetimes, structure tags and rays, BOS/CHoCH events, the trade box/lines/labels), the RSI readout, watch-zone
  heads-up, the info panel contents, `Require HTF Bias` above the chart time frame, and anything the panel shows that
  the engine does not compute (stats splits, etc.). These must be ported from the Pine source, in the Pine global-scope
  order, with the same caps (500 boxes / labels / lines; `HIST_LIMIT` 5000).
- **Data comes from the chart itself.** The script reads the bars the chart has loaded (`activeChart().exportData()`
  or equivalent). Pine runs over **every** loaded bar; `max_bars_back` / `HIST_LIMIT` 5000 only limits how far back a
  drawing can be anchored. The port's 91/91 match needed full history (truncating to 5000 bars breaks it on most EGX
  charts), so the script requests history back to the **series start**, and the engine runs on all of it. Drawings keep
  the Pine 5000-bar anchor limit. If the chart cannot supply the full series, the panel flags it. (Builder's call,
  recorded 2026-11-24 from the backtest findings.)
- **Second symbols** (the EGX30 / EGX70 index for `Require Index Trend`): there is no public data API, and adding the
  index as a study would be auto-saved into the user's Thndr layout (`auto_save_delay: 5`; studies have no
  `disableSave`), which breaks the first anti-goal. So in v1 **`Require Index Trend` is unavailable on ThndrX**: the
  setting is disabled with a note, and the panel says so if a preset asks for it. The EGX Daily preset does not use it.
  (Builder's call, 2026-11-24.)
- **Higher-time-frame bias** (`request.security(..., htfBiasTf, ...[1], lookahead_on)`) is computed by resampling the
  chart's own bars into the higher time frame on EGX session boundaries. If the chart has too little intraday history
  to build enough HTF bars, the panel says so.
- Thndr's bars may not be dividend-adjusted like the TradingView feed the port was validated on, so signals can differ
  from TradingView around dividends. This is a data difference, not a bug, and the panel shows the data source.
- Node is not on PATH (see project memory); tooling commands prefix the fnm path. No npm dependencies.
- The script must keep working when Thndr redeploys. Hooks are limited to finding the chart iframe and its
  `tradingViewApi`; no reliance on Thndr's bundled module IDs or minified names.

## Approaches considered

1. **Chart objects through the public chart API (chosen).** Boxes, lines, rays, labels and multipoint paths via
   `createShape` / `createMultipointShape` with `disableSave`, `lock`, `disableSelection`. Plot-style series (MA,
   trails, VWAP, Kumo) become path shapes. The info panel is an HTML element injected into the chart iframe.
   Trade-off: series are drawings, not indicator plots, so there are no legend values. Chosen because everything in
   the Pine can be drawn this way using only documented API.
2. **A real custom indicator registered in Thndr's menu** (`custom_indicators_getter` injected before the widget is
   created). Gives true plots and a legend, but custom indicators cannot draw boxes, labels or rays, so approach 1 is
   still needed, and injecting into Thndr's widget construction is the part most likely to break on their deploys.
3. **Our own canvas over the chart.** Full visual control, but scroll/zoom/price-scale tracking is ours to maintain
   and drifts from the bars.

The user picked approach 1 on 2026-11-24.

## Design

```
ThndrX page (parent)                       chart iframe (same origin)
userscript ──finds iframe──▶ tradingViewApi.activeChart()
   │                              ▲ exportData / onDataLoaded / onSymbolChanged / onIntervalChanged
   │                              │ createShape / createMultipointShape / removeEntity
   ├─ bars + settings ─▶ engine (ict-engine.mjs, extended) ─▶ render plan (pure data)
   └─ painter: diffs the render plan against what it drew last time, applies the changes
   └─ panel + settings dialog: HTML injected into the iframe document
```

- **Engine extension.** `runEngine` gains an option that returns a **render plan**: the full list of drawable
  objects with their Pine lifetimes (zones with creation and removal bars, structure tags/rays, BOS/CHoCH events,
  trade boxes/lines/labels, closed-trade labels), the plotted series (MA, trails, VWAP, Kumo spans with
  displacement), signal bars, killzone bars, the RSI readout and the panel rows. Pure function of bars + inputs, so
  it is testable in Node. Trade results must stay identical to today's port (existing validation keeps passing).
- **Painter.** Maps the render plan to chart API calls. Keeps a map of entity IDs it created, removes only those,
  redraws only what changed between runs (a new bar should not redraw 500 shapes). Colours, transparencies, line
  styles, label positions follow the Pine.
- **Panel and settings.** HTML injected into the chart iframe, positioned per the Pine panel-position input. Settings
  dialog mirrors the Pine input groups; values persist in `localStorage` per browser.
- **Packaging.** Source modules under `tools/thndrx/`; a dependency-free Node build script concatenates them with the
  engine into one `thndrx-ict.user.js`. The engine file stays the single source of truth shared with the backtest and
  dashboard.

## Verification

1. **Engine parity on TradingView data**, daily and intraday: render plans (zones, structure events, trades) compared
   against the Pine on TradingView for the same symbols, time frames and inputs, using Pine logs and the panel numbers,
   driven with the Playwright recipe in project memory. Daily trades must still match 91/91.
2. **Painter on ThndrX**, live via Playwright. The user logs in themselves (including OTP) in the Playwright browser;
   the automation only reads the chart, draws on it and reloads the page, and never touches orders (user agreed
   2026-11-24). Finding the desktop chart route is the first ThndrX step and uses the same session. Checks: drawings appear, follow scroll/zoom,
   survive symbol/time-frame switches, and are **gone after reloading without the script** (nothing saved).
3. **Thndr vs TradingView data:** for a few symbols, compare Thndr's bars with TradingView's and report how much the
   signals differ and why.
4. Unit tests (`node --test`) for the render plan and the painter's diff logic.

## Left to the builder

- Exact chart API calls and shape names for each Pine drawing type in v31.1.0.
- How to pull more history from the chart, and how many recomputes per second the live update can afford.
- Module split inside `tools/thndrx/`, the build script, and test layout.
- The settings dialog's look.
- README and `README.ar.md` sections for installing and using the userscript (standing instruction: docs ship with
  the code).
