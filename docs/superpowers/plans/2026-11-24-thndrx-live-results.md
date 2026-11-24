# ThndrX overlay — live verification (Task 12)

Date: 2026-11-24 (Cairo), Playwright on the user's logged-in ThndrX session, `workspaces/default/trade`, COMI.
Bundle: `tools/thndrx/dist/thndrx-ict.user.js` v0.1.0 (commit 29d471f), injected with `page.addScriptTag`.
Nothing in Thndr's trading UI was touched.

## Drawing

| Check | 1D | 60m |
|---|---|---|
| Overlay draws | 203 shapes: 40 rectangles, 31 trend lines, 106 text, 15 ↑ / 10 ↓ markers, 1 path (MA) | 886 shapes: 354 rectangles (zones + newest 300 killzone bands), 121 trend lines, 301 text, 62 ↑ / 47 ↓, 1 path |
| Script errors in console | none (only Thndr's own PostHog rate-limit and AG Grid noise) | none |
| Visible range after history load | restored to a normal recent window, not 1990 | restored (~6 weeks) |
| Switch 1D → 60 → 1D | — | back on 1D exactly 203 shapes again: no stale drawings |
| Panel | rows match the Pine layout; `Data` row shows `History: 5 years (Thndr limit)` | same |

Screenshots: `.playwright-mcp/thndrx-overlay-1.png` (1D), `.playwright-mcp/thndrx-overlay-60.png` (60m) — local only.

Defect found: ThndrX runs right-to-left (Arabic), and the panel inherited `dir=rtl` — its two columns are swapped and
signed numbers render as `0.67R+`. Fixed by forcing `dir="ltr"` on everything the script injects (follow-up commit).

## Nothing saved

- After drawing, reloading the page **without** the script: `chart.getAllShapes()` → `[]`. Our drawings never reach
  Thndr's layout or drawing storage.
- **Side effect found and measured (with every write to `/tvcharts/drawings|layouts` blocked in the page during the
  test, so nothing reached the server):** Thndr's app re-syncs the chart's saved drawings whenever any drawing is
  removed, including our unsaved ones. The sync sends the **full** current set of the user's own saved drawings
  (`POST /users-service/tvcharts/drawings/<asset>` with only the user's line in the payload, none of ours), or `DELETE`
  when the stock has no saved drawings. The user's drawings are therefore re-saved unchanged, never lost. Thndr's own
  code skips the sync while a symbol is still loading (`fetchedSymbols` / `isLoadingSources` / a 500 ms suppression
  window), so a symbol switch cannot save an empty set over the new stock's drawings. Recorded as ruling R21.

## Thndr vs TradingView data (COMI, 1D)

`exportData` from ThndrX (1212 bars, 2021-11-24 → 2026-11-23) against `fetch-egx.mjs` TradingView bars
(`ADJ=dividends`):

- Dates: 1212 / 1212 matched, none missing on either side inside the window.
- **Timestamps: identical on every bar** (old bars 07:00Z, recent 00:00Z on both feeds). No conversion needed.
- Volume: within 1% on all but 5 bars.
- **Prices: Thndr is split-adjusted but not dividend-adjusted.** The Thndr / TradingView-dividend-adjusted close ratio
  is constant between April dividend dates and steps at each one: 1.1346 (2021) → 1.1027 (2022-04-05) → 1.0914
  (2023-04-04) → 1.0840 (2024-04-22) → 1.0493 (2025-04-08) → 1.0000 (2026-04-07). Three isolated one-bar ratio blips
  (2022-01-02, 2022-11-21..23) are bad prints on one of the feeds.
- Consequence: ThndrX matches a TradingView chart with **ADJ off** (TradingView's default), not the
  dividend-adjusted data the engine backtests were run on. Signals are scale-free inside each dividend period, so they
  differ only where a lookback window spans a dividend date. The overlay's numbers should be compared with TradingView
  at ADJ off.

## After the final fix wave (bundle at 6d6a495)

Same session, every write to `/tvcharts/drawings|layouts` blocked and counted:

| Step | Thndr drawing syncs |
|---|---|
| Inject overlay on COMI 1D, full load (203 shapes) | 0 |
| One idle minute (market closed) | 0 |
| Switch 1D → 60 (clear + repaint, 886 shapes) | 1 (one debounced burst) |
| One idle minute on 60m | 0 |
| Switch 60 → 1D (back to 203 shapes) | 1 |

No layout writes at all, including during the history zoom-out (the review's open question M5). The panel now renders
left-to-right on ThndrX's Arabic UI (`+0.67R`, labels in the left column). During market hours expect one sync per
repaint, i.e. one per closed bar at most once a minute; not yet observed live with the market open.
