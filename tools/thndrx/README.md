# ThndrX overlay

The ICT + RSI/MA Confluence indicator, drawn on the chart inside the ThndrX web app (`x.thndr.app`). ThndrX embeds
TradingView's charting library, which cannot run Pine scripts, so this is a userscript that runs the same trade engine
in the browser and draws the result with the library's drawing API: swing tags, break lines, order blocks, fair value
gaps, killzone bands, the trade boxes and targets, the moving average, and the same information panel as the Pine
indicator.

The engine is `tools/backtest/ict-engine.mjs`, the Node port of `src/ict-rsi-ma-indicator.pine`; the userscript bundles
it unchanged. The Pine file stays the source of truth.

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension in desktop Chrome or Edge.
2. Open `tools/thndrx/dist/thndrx-ict.user.js` (the raw file, or drag it onto the browser) and let Tampermonkey install it.
3. Open the ThndrX trade workspace (`https://x.thndr.app/workspaces/default/trade`) and wait for the chart. The overlay
   attaches by itself; if the workspace drops and re-creates the chart widget, it re-attaches.

`dist/thndrx-ict.user.js` is generated. After changing anything under `tools/thndrx/` or the engine, rebuild it
(see [Build and test](#build-and-test)) and reinstall the script.

## Where it runs and what it shows

- Only the chart on the `trade` workspace of `x.thndr.app`. Desktop Chrome or Edge; there is no mobile support.
- Daily and intraday charts (1, 5, 10, 15, 30, 60, 240 minutes, 1D, 1W, 1M, whatever ThndrX offers). Symbol and
  time-frame changes redraw from scratch and leave no stale drawings. **Drawings update when a bar closes; the panel
  updates live** (it is computed with the forming bar, as the Pine panel is).
- The information panel sits in a corner of the price pane (position follows the **Panel Position** setting). Click its
  first row to collapse it to that row.
- The `ICT` button in the top-left corner of the price pane opens the settings dialog.

## Settings

The dialog mirrors the Pine inputs: the same groups, names, defaults and tooltips, including `Preset: EGX Daily`.
Save validates every field; Reset to defaults only refills the form. Settings are stored in this browser's
`localStorage` (key `thndrx-ict:inputs:v1`), so they survive a reload but do not follow you to another browser or
profile, and clearing site data resets them.

**Not available: `Require Index Trend`.** ThndrX offers no way to read the EGX30 / EGX70 index series from the chart, so
the input is forced off and shown disabled with a note, and the panel's `Data` row says so if the setting or a preset
turns it on.
`Require HTF Bias` works: the higher-time-frame bias is built from the chart's own bars (`htf.mjs`).

## Limits

- **History is 5 years.** Thndr's feed stops exactly five years back (about 1,213 daily bars, about 5,950 60-minute
  bars). The engine runs on what the chart holds, so PERFORMANCE totals are smaller than TradingView's full-history
  numbers, and the panel's `Data` row says `History: 5 years (Thndr limit)`. Live state (structure, zones, the open
  trade) should agree with TradingView once the 5-year window has warmed up.
- **The newest 20,000 bars only.** On 1 to 15 minute charts the 5-year feed holds more than that; the plan is computed
  on the newest 20,000 bars and the panel adds `Computed on the last 20000 bars`. On 1 to 10 minute charts the overlay
  asks Thndr only for about the history those bars need, not for 5 years. The window's first bar is fixed when the
  chart loads, so new bars lengthen it until the next symbol or time-frame change.
- **Drawings follow closed bars.** The drawings are computed without the forming bar and repainted when a bar closes,
  at most once a minute (see [What it changes in Thndr](#what-it-changes-in-thndr)); between closes, zones, rays, the
  MA and the trade lines stop at the last closed bar, where Pine extends them to the forming bar.
- **Loading.** While the history loads the panel shows `Loading…`. A load that has not finished after 90 seconds is
  given up (`History load timed out`; switch symbol or time frame to retry), and history that never settles is flagged
  in the `Data` row as `History incomplete: the chart stopped loading`.
- **Killzone shading is limited to the newest 300 bands.** On intraday charts a killzone band is drawn for every session
  day, thousands of them. Only the newest 300 are drawn; the zones, lines and labels are not limited this way.
- Drawings keep Pine's caps: anchors at most 5,000 bars back, and 500 boxes, 500 lines, 500 labels per type.
- **No volume study, no volume.** The chart's Volume study supplies volume; if you remove it, participation and VWAP
  switch themselves off and the panel says so.

## Data: how it compares with TradingView

Thndr's prices are **split-adjusted but not dividend-adjusted**. A TradingView chart with the `ADJ` (adjust for
dividends) option off matches ThndrX; the engine backtests in this repository were run on dividend-adjusted data, so
compare the overlay's numbers with TradingView at **ADJ off**. Bar timestamps are identical on both feeds, and volume
is within 1% on almost every bar. Inside each dividend period the signals are scale-free, so they differ only where an
indicator's lookback spans a dividend date. The measurements (COMI daily, 1,212 bars) are in
`docs/superpowers/plans/2026-11-24-thndrx-live-results.md`.

## What it changes in Thndr

Nothing is saved to Thndr. Every drawing is created with `disableSave` and `disableUndo`, the script removes only the
drawings it created, and it never reads or places an order or clicks anything in the trading UI. After drawing, a
reload without the script shows none of our drawings.

One side effect was measured. Creating a drawing triggers nothing, but **any change to an existing drawing** (ours or
yours: changing it, moving it, hiding or showing it, removing it) makes Thndr re-save your saved drawings for that
stock: it sends the full current set of **your own** drawings (or deletes when the stock has none); none of our
drawings are in it, and a burst of changes is folded into one save (about 750 ms). Thndr's code skips the save while a
symbol is still loading, so a symbol switch cannot save an empty set over the new stock's drawings. The overlay limits
these saves to its repaints on closed bars: about once per bar, at most once a minute, plus one on each symbol or
time-frame change and on each settings save.

The saved set is this tab's current set. If you edited the same stock's drawings meanwhile in another tab or in the
phone app, a save from this tab can overwrite them with the older set; that is the same thing Thndr's own app does
when you edit a drawing in this tab. This was observed with every write to the drawings and layouts endpoints blocked
in the page, so nothing reached the server during the test.

## Modules

| File | What |
|---|---|
| `main.mjs` | Entry point: watches for the chart iframe, loads the bars, builds the render plan, paints it, shows the panel; reloads on symbol or time-frame change; repaints the drawings when a bar closes (at most once a minute) and on save; refreshes the panel on live bars. |
| `chart-port.mjs` | Finds the chart in the page, loads the history (restoring your view afterwards; 90 s timeout), reads bars with `exportData`, watches symbol, interval and the last bar, applies the 20,000-bar window pinned at load. |
| `render-plan.mjs` | Engine result to a drawing plan (boxes, lines, labels, bands, the MA path, the panel) with Pine's caps and colours. |
| `painter.mjs` | Plan to TradingView drawing calls, diffing against what is already on the chart; removes only its own ids; 300-band cap. |
| `panel.mjs`, `format.mjs`, `colors.mjs` | The information panel rows, number and time formatting, Pine colours and transparency. |
| `inputs.mjs` | The Pine inputs: groups, defaults, validation, preset handling, `localStorage` persistence. |
| `htf.mjs` | Higher-time-frame bias built from the chart's own bars (Pine `htfBiasCalc` with `lookahead_on` and `[1]`). |
| `ui.mjs` | Panel table, `ICT` button and settings dialog, injected into the chart iframe (forced left-to-right: ThndrX itself is right-to-left). |
| `parity.mjs` | Offline check of the render plan against TradingView: panel rows and trade diff from CSV bars and a Pine trade log. |
| `build.mjs`, `VERSION` | Bundles the modules and the engine into `dist/thndrx-ict.user.js`; the version goes in the userscript header. |

No npm dependencies; the bundle is plain JavaScript with `@grant none`.

## Build and test

Node is not on `PATH` on the development machine: prefix it first
(`export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"`).

```bash
node tools/thndrx/build.mjs          # writes tools/thndrx/dist/thndrx-ict.user.js
node --test tools/thndrx/            # unit tests for every module
node --test tools/backtest/          # the engine the bundle embeds
```

Some tests read real bars and skip when the `ICT_DATA` environment variable (a folder of bars such as `data/egx-div`, gitignored) is
missing. Parity against a TradingView chart:

```bash
node tools/thndrx/parity.mjs --data data/egx-div --symbol COMI --tf 1D --preset 'EGX Daily' --log <pine-log.csv>
```

The design and the live findings behind it: `docs/superpowers/specs/2026-11-24-thndrx-ict-overlay-design.md`,
`docs/superpowers/plans/2026-11-24-thndrx-recon.md`, `docs/superpowers/plans/2026-11-24-thndrx-live-results.md`.
