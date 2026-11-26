# ThndrX Session Order Flow overlay — live results

Date: 2026-11-26 (EGX closed, Thursday 05:30 Cairo). Logged-in Playwright session on `x.thndr.app/workspaces/default/trade`,
COMI. The bundle was injected with `page.addScriptTag`; every write to `/tvcharts/drawings|layouts` was blocked in the
page for the whole session.

## Offline evidence (before the live pass)

| Check | Result |
|---|---|
| Engine regression: 97 cases (30 EGX 1D × 3 configs, 3 EGX 60m, BTC/ETH 15m/60m), trades + every per-bar series hashed before and after the change | identical |
| Liquidity-run port vs TradingView `Log Closed Trades` exports (`data/sof/tvlogs`) | COMI 1D 33/33, BTC 4H 46/46 (open, close, side, reason, R) |
| Render mode vs plain run (synthetic charts) | trades, run trades and every series identical |
| Unit tests `node --test tools/thndrx/` + `tools/backtest/sof-engine.test.mjs` | 180 + 6 pass |

## Live

| Step | Result |
|---|---|
| Daily, first load (30m intrabars from Thndr 10m bars, 5 years) | panel `Loading 30m intrabars… 20%…80%`, drawings at 8.3 s, 42 shapes |
| 60m, first load (1m intrabars, 5 years, about 60 requests) | intrabars in ~14 s, drawings at 21 s, 62 shapes |
| 1W / 60m (cached) / 15m / 1D (cached) | 3 s / 6 s / 6 s / 6 s; 27 / 62 / 216 / 42 shapes |
| 15m vs 60m POC on the same day | identical (126.02): the day's profile comes from the same 1m bars, as Pine intends |
| Intrabars vs chart-bar fallback on COMI 1D | POC 126.67 vs 126.07, VA 125.85–127.20 vs 125.85–127.65, net Δ −1.67M vs −3.24M |
| ICT + SOF together | both paint; buttons side by side (`ICT`, `SOF`); panels in their own corners; no errors |
| Settings dialog | 10 groups; `Log Closed Trades` disabled with its note; enabling the trade module and Save repaints with the trade rows |
| Trade module cross-check | open long `entry 131.00 · trailing stop 112.79` on Thndr data equals the offline run on TradingView's COMI data |
| After a reload without the script | 0 shapes on the chart; chart still COMI 1D |
| Writes Thndr attempted (all blocked) | 10 × `DELETE /tvcharts/drawings/<COMI>`: the drawing-sync side effect documented for the ICT overlay (any removal of a drawing re-saves the user's own set; a delete when the stock has none). No layout writes. |

## Bugs found live and fixed

1. **Fractional timestamps.** The loop's clock is milliseconds / 1000; Thndr answers a request whose `end_timestamp` has
   a fraction with `CHART_REQUEST_FAILED`. The datafeed calls now send whole seconds (test added). The fallback worked
   while the bug was there: drawings from chart bars, and the Data row said `Intrabars unavailable (…): chart bars used`.
2. **Inclusive `to`.** Asked for bars up to the feed's first bar, Thndr returns that bar. The pager now ends the series
   there instead of stepping back past the 5-year limit (test added). Before the limit Thndr answers an empty chunk with
   a `nextTime` hint and no `noData` flag; two empty spans in a row end the series.
3. Failed requests are retried twice (1.5 s, 4 s), and a failed intrabar load is retried on a bar close at most every
   5 minutes.

## Not verified

- **TradingView side by side.** The TradingView tab was not logged in, and TradingView blocks sub-daily EGX data for the
  user, so no live Pine comparison of the intrabar path was possible. Evidence for it is the port's earlier 37/37 Data
  Window match (2026-11-21) plus the unchanged regression snapshot.
- **`format.volume`.** The `net Δ` text uses K/M/B with at most two decimals, trailing zeros dropped ("1.85M",
  "500K"). Pine's exact output was not checked.
- Live market hours: no bar closed during the test (market closed), so the closed-bar repaint and the intrabar tail
  refresh ran only in the unit tests.

## Side effect seen in the console

Thndr's page calls its analytics library for chart drawing events; when the overlay creates or removes many drawings at
once, the library's own client-side rate limit drops those calls and logs `[PostHog.js] This capture call is ignored
due to client rate limiting`. No analytics request left the page during the test.
