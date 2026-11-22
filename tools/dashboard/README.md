# EGX Daily dashboard

A local web page for the EGX Daily preset. It shows the trades the close is about to make while the session is open,
the final result after it, the trades of each day, and how every stock has done under the preset. It uses the same
engine and code as `tools/backtest/scan-egx.mjs`, so the numbers are the scanner's numbers.

## Starting it

Double-click `tools\dashboard\start.cmd`. It starts the server and opens `http://127.0.0.1:8787` in your browser.
Leave its window open while you use the page; close the window to stop it.

From a shell (node is not on PATH on this machine):

```
export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"
node --experimental-websocket tools/dashboard/server.mjs      # --port N, --data DIR, --log FILE, --out FILE, --no-trail
```

It needs `data/egx-div` (run `scan-egx.mjs` once, or `fetch-egx.mjs` with `ADJ=dividends`). If the data on disk is
behind, the server catches it up by itself. It is reachable from this PC only.

## What it shows

| Section | What |
|---|---|
| Header | The mode, the session, when prices were last fetched (Cairo time), a **Refresh now** button, and a red banner for stale stocks, missing data or errors. |
| **Decide before the close** | Only while the session is open (mode **LIVE**). The preset run on today's unfinished bar as if the session ended at the last price: trades that would **exit** (a close at or below the stop, or a CHoCH), trades that would **open**, targets that would be **hit**. |
| Open trades | Every trade open as of the last finished close, priced at the latest price: stop now, the distance to it (% and R), next target, open R and open %, and a "Would exit" or "Would hit TPn" flag. Trades closest to their stop come first. Click a row for the stock's trades. |
| Last finished session | Entries and exits of the last session that closed, as the scanner reports them. |
| Forward record | The out-of-sample test from `forward/egx-daily-log.json`, PB and TR separately. |
| Day by day | Entries and exits of each of the last 60 sessions that had any. Trades in the forward log carry a "forward log" badge. |
| Market evaluation | One row per stock, PB or TR: trades, win rate, total R, average R, all history and last 12 months, the last trade and any open trade. Sort by clicking a column; filter by name; click a row for the stock's full trade list. |

**Percentages.** An open trade's **Open %** is the price move from entry to the latest price. A closed trade's % is
its R times the risk % at entry, so it is net of costs and includes the partial exits at TP1, TP2 and TP3, like R.
It shows next to R wherever a closed trade appears (exits, day by day, a stock's trade list).

## Provisional and final

- **During the session** (Sun–Thu 10:00–14:35 Cairo) the server refreshes every 5 minutes, and on **Refresh now**.
  Each refresh takes about 45 seconds. It fetches the last 30 daily bars of every stock and keeps them in memory
  only. The "Decide before the close" box changes until the close, and nothing in it is logged.
- **From 15:00 Cairo** a bar dated today counts as finished. The next refresh (every 30 minutes outside the session)
  sees that the log is behind and runs the end-of-day scan: a full download, then exactly what `scan-egx.mjs` does
  (`forward/latest.md` and the forward log). The mode then reads **FINAL**.
- **Nothing provisional reaches the disk.** Full downloads made during the session have today's forming bar trimmed
  off every CSV, in the server and in `scan-egx.mjs` alike. Run during the session, `scan-egx.mjs` scans up to the
  last finished bar.
- A stock whose download fails keeps the data it has and is listed in the red banner as stale; it is never dropped,
  so its logged trades are not mistaken for vanished ones (`scan-egx.mjs` does the same).
- The end-of-day scan never runs without data, and never over a forward log it cannot read. Either problem shows in the
  red banner and stays there until an end-of-day scan succeeds.
- If a stock's recent bars disagree with the disk copy by more than 0.5% (a dividend re-adjusted its history), that
  stock alone is downloaded again in full.

## Caveats

- **Prices may be delayed.** They come from TradingView's public feed without a login, which may run about 15
  minutes behind. This has not been checked yet. Compare the page with your TradingView chart during a session.
  Until then the page says "may be delayed".
- The "if it closed now" view is exactly that. A stock that sits just under its stop at 13:00 can close above it.
- The 7 stocks in the fidelity caveat of `forward/README.md` can differ from their charts by a trade; check those on
  the chart before acting.

## Files

| File | What |
|---|---|
| `server.mjs` | HTTP server (`/`, `/api/state`, `/api/stock/:sym`, `POST /api/refresh`), refresh scheduler, end-of-day scan. |
| `live-feed.mjs` | `fetchTail` (last n daily bars from the feed) and `mergeTail` (merge onto disk history, detect re-adjustment and gaps). |
| `state.mjs` | `provisional`, `openRows`, `dayByDay`, `evaluate`. |
| `public/index.html` | The page: plain HTML and JS, no build step, no internet needed beyond the price feed. |
| `start.cmd` | Windows launcher. |
| `*.test.mjs` | `node --test tools/dashboard/ tools/backtest/scan-core.test.mjs` |
