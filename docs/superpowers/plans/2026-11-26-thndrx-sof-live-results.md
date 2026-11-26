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

## Code review (Fable model) and what changed

Verdict: merge with fixes. No critical issue; the reviewer compared the engine's render mode, `sof-plan.mjs` and
`sof-panel.mjs` with the Pine line by line and found no mismatch in texts, colours, caps or creation order.

Fixed:

| Finding | Change | Evidence |
|---|---|---|
| Important: each 2 s panel refresh rebuilt ~300k intrabar columns (~290 ms) | intrabars built once per load / top-up (`buildLtf`, prebuilt `ltf` for `buildChart`); no copy when the base resolution is the wanted one; the live panel runs the engine without the drawing registry (`buildPanel`) | 20,000 15m bars + 300,000 1m intrabars: panel refresh ~100 ms (was ~290); full plan on a bar close ~300 ms; regression snapshot still identical |
| Important: IndexedDB rewrote the whole series every minute and read every entry to trim | persist on full loads and bar closes only; trim through a small meta store (`ltf-meta`, IndexedDB version 2) | unit test; live: second page load drew from the cache in 5.2 s |
| A failing tail read discarded a good cache | cached series used, `Data` row says `Intrabars from the cache: the newest could not be loaded yet`, next poll tries again | unit test |
| An unreadable session string was treated as EGX | no session alignment and Monday weeks; the EGX guess without symbol info is named in the `Data` row | unit test |
| `htfInput` accepted `2D` / `12M`, which the engine cannot read | validation narrowed to minutes and D / W / M (1D / 1W / 1M) | — |
| A slow feed held the live panel up to ~26 s | the panel refreshes first; the top-up runs outside the poll and marks the panel dirty only when it brought new bars | — |

Left as they are (noted):

- Box and line right edges on daily / weekly charts end at the next bar's open, where Pine uses the session close: up to
  one bar wider. Visual only.
- Labels are drawn as text shapes (the ICT overlay's painter): BUY / SELL and result labels sit on the bar's low / high
  instead of Pine's pointer labels offset above / below the bar.
- Changing `Lower Timeframe` while a history load is running is applied at the next load.
- Two spellings of a month in seconds (2628003 / 2592000); both only ever compared with 240 minutes.

## Follow-up: ICT stuck on Loading… with both overlays (user report, 2026-11-26)

Reproduced by starting both userscripts at the same moment on page load (as Tampermonkey does). With the ICT script
from master (0.1.0, no shared lock) the two history loads overlap; TradingView's `setVisibleRange` then throws
`Value is null` (or rejects `Rejected by timeout`), the error escaped `loadAllBars`, and the overlay that hit it stayed
on `Loading…` for good: the second script to start, 3/3 runs in each order. With both scripts from this branch the lock
keeps the loads apart (both paint in 5-7 s, either order).

Fixed in 0.2.0: a failed zoom request costs a round of the history load (and that round never counts as settled); a
load that still fails shows `History load failed: retrying in N s` and is retried after 5 s, 10 s, ... up to a minute.
After the fix: new SOF + old ICT started ICT-first both paint at 5 s; started SOF-first, the 0.1.0 ICT still sticks
(its own code), so both scripts must be installed from the same build. Tests: `chart-port.test.mjs` (rejecting and
throwing `setVisibleRange`), `main.test.mjs` (a failed load is retried).

## Second code review (Fable model, PR #15) and what changed

Verdict: merge with fixes; no critical issue; the two earlier fix commits were judged sound.

| Finding | Change |
|---|---|
| Important: the drawings (closed bars) counted the forming bar's intrabars into the last closed bar, so during market hours the drawn POC / VA (and sweep-model drawings) used volume Pine puts in the next bar | `buildChart({ ltfEnd })` bounds the last bar's intrabars; the loop passes the forming bar's open for the closed-bar run (tests at engine and loop level; regression snapshot still identical) |
| Important: the IndexedDB open had no `blocked` handler, so another tab on the old database version could leave the overlay on `Loading…` | blocked or slow (5 s) opens reject and the loader runs without persistence; a failed open is tried again later; our connection closes on `versionchange` (test with a blocked fake) |
| A timed-out history load was not retried | same backoff as a failed load (`History load timed out: retrying in N s`) |
| A failed intrabar load was retried only on a bar close (once a day on daily charts) | retried at most every 5 minutes from the live poll too, without the loading progress over the dashboard |
| The bar-close paint ran the full engine twice | the forming-bar panel uses the panel-only build |
| Two quick saves of `Lower Timeframe` could keep the older intrabars | only the load for the setting still in force is kept |
| The retry backoff carried over a symbol change | reset on symbol / interval change |
| A session string without `:days` lost its alignment | days optional (all seven by default); Sunday weeks only when Sunday trades and Friday does not |

Left: the memory cache holds base rows as arrays (about 40-60 MB for 5 years of 1-minute bars, at most four series);
storing them flat is a follow-up.

Live re-check after the fixes: both scripts started together (SOF first), both drawn at 7 s, no errors, no writes;
3 of the user's own saved COMI drawings were on the chart and untouched.
