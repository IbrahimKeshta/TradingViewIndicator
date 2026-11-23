# ThndrX live recon (Task 1)

Date: 2026-11-24 (Cairo), logged-in session driven with Playwright. Nothing in the trading UI was touched.
Library: TradingView Trading Platform v31.1.0 inside ThndrX.

## Go / no-go: PASS

A `rectangle` created with `{ disableSave: true, disableUndo: true, lock: true, disableSelection: true }` triggered **no**
request to `users-service/tvcharts/drawings/*` or `.../layouts` in 20 s (only the initial GETs), and after a page reload
`chart.getAllShapes()` was `[]`. Drawings made this way never reach Thndr's servers.

## Where the chart is

- Desktop chart route: **`https://x.thndr.app/workspaces/default/trade`** (the "trade" workspace; home and market
  workspaces have no chart). Workspaces are user-configurable widget grids, so the chart iframe can appear, disappear
  or be re-created at any time: the script must keep watching for it (poll or MutationObserver), not look once.
- Iframe: `iframe[id^="tradingview_"]` (id like `tradingview_d2f48`, random per load), same origin.
- API: `iframe.contentWindow.tradingViewApi` → `.activeChart()`. `tradingViewApi.createButton` does **not** exist (it
  lives on Thndr's private wrapper), so the settings button is an element we inject into the iframe document.

## Symbol, tick, time frame

- `chart.symbol()` is an asset UUID (`1923D036-…`), useless for display. Use `chart.symbolExt()`:
  `name: 'COMI'`, `exchange: 'EGX'`, `timezone: 'Africa/Cairo'`, `session: '1;1000-1430:12345'` (Sun–Thu),
  `pricescale: 100`, `minmov: 1` → `mintick = minmov / pricescale`.
- `chart.resolution()` → `'1D'`, `'60'`, … Supported: `1, 5, 10, 15, 30, 60, 240, 1D, 1W, 1M`.

## Bars

- `await chart.exportData({ includeTime: true, includeSeries: true, includedStudies: 'all' })` → `{ schema, data }`;
  schema columns `time, open, high, low, close`, plus `Volume` because ThndrX adds a Volume study to the chart by
  default (`getAllStudies()` → `[{ name: 'Volume' }]`). With `includedStudies: []` there is no volume column. If the
  user removes the Volume study, volume is missing: treat it as NaN (the engine already handles that) and warn.
- `exportData` times are public unix seconds. Use them. The internal model (`chart.chartModel().mainSeries().bars()`,
  `.valueAt(k)` → `[time, o, h, l, c, vol, …]`) stores times differently on intraday (a 60m bar read 04:00Z), so do not
  take times from it.
- Prices are **dividend/split-adjusted** (COMI 2021-11-23 close 31.54). Matches the dividend-adjusted data the engine
  was validated on.
- Daily bar times are not uniform (old bars at 07:00Z, recent at 00:00Z); both map to the right Cairo date. Always
  derive `date` from the time in Africa/Cairo.

## History depth (the important limit)

- Initial load: 300 bars.
- Loading more: `await chart.setVisibleRange({ from: <old>, to: <now> })` pulls history in one go
  (daily: 300 → 1213 bars in under 2 s). `mainSeries().requestMoreData(n)` adds nothing beyond that.
- **Thndr's feed stops at exactly 5 years back** (feed request `…/feed/advanced-charts/v2/<asset>/trades?resolution=1D
  &start_timestamp=<now − 5 y>`). Daily: 1213 bars from 2021-11-23. 60m: 5954 bars from 2021-11-24.
  `getSeries().endOfData()` stays `false`, so "complete" cannot be detected from that flag: treat "first bar time did not
  move after one more `setVisibleRange` / 2 s wait" as the end.
- Consequence: the engine runs on 5 years, not the full series. The panel must say so (`History: 5 years (Thndr
  limit)`). PERFORMANCE totals will be smaller than TradingView's full-history numbers; live state (structure, zones,
  open trade) should agree once the 5-year window has warmed up.
- After loading, restore the user's view: save `chart.getVisibleRange()` first and set it back afterwards.

## Events

`chart.onDataLoaded()`, `onSymbolChanged()`, `onIntervalChanged()`, `onVisibleRangeChanged()`, `dataReady()` and
`whenChartReady()` exist (each returns a subscription with `.subscribe(null, cb)`). There is no realtime tick event on
the chart API: poll the last bar (`exportData` with `from` = last bar time, or every 2 s) for live updates.

## Shape table (all created with the go/no-go option set; all verified on screen)

| Plan item | Call | Shape | Overrides that worked |
|---|---|---|---|
| box | `createMultipointShape([p1, p2])` | `rectangle` | `color` (border), `backgroundColor`, `fillBackground: true`, `linewidth` |
| line, not extended | `createMultipointShape([p1, p2])` | `trend_line` | `linecolor`, `linewidth`, `linestyle` (0 solid, 1 dotted, 2 dashed), `extendRight: false` |
| line, extend right | same | `trend_line` | as above with `extendRight: true` (`horizontal_ray` also works for flat rays: `linecolor`, `linewidth`, `linestyle`, `showPrice`) |
| label (all styles) | `createShape(p)` | `text` | `color` (text), `backgroundColor`, `fillBackground: true`, `borderColor`, `drawBorder`, `fontsize`, `bold`; text via `text` option. No pointer bubble: emulate up/down/left by the anchor price (below / above / right of the point) |
| label alt. | `createShape(p)` | `balloon` | `color`, `backgroundColor`, `borderColor`, `fontsize`, `transparency`; draws a speech bubble, looks closest to Pine's `label_up/down` |
| series (open path) | `createMultipointShape(points)` | **`path`** | `lineColor`, `lineWidth`, `lineStyle`, `leftEnd: 0`, `rightEnd: 0` (default right end is an arrow). 300 points in 7 ms. **Do not use `polyline` for series: it closes itself.** |
| fill polygon | `createMultipointShape(points)` | `polyline` | `linecolor`, `linewidth`, `backgroundColor`, `transparency`, `fillBackground: true`, `filled: true`; closes automatically |
| marker up / down | `createShape(p)` | `arrow_up` / `arrow_down` | `arrowColor`, `color`; anchor at bar low (up) / high (down) |
| background band | `createMultipointShape([p1, p2])` | `rectangle` spanning the band's time range, prices from (min low × 0.5) to (max high × 2) | as box, no border (`linewidth: 0` or border colour = fill) |

Creation cost ~90 ms per awaited call on first use, ~3–10 ms after; batch creations without awaiting each one
(collect promises) to keep a full repaint fast. `removeEntity(id, { disableUndo: true })` removes cleanly.

## Settings button

Inject a fixed-position element into the iframe document (`iframe.contentDocument.body`), top-left of the chart area,
above the canvas (`z-index` high). The chart in the default workspace is small (479 × 394 px), so the panel must be
compact (font 10–11 px) and collapsible.
