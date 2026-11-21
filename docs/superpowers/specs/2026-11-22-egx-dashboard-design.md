# EGX Daily dashboard: design

Date: 2026-11-22. Status: draft for approval.

## Intent

The EGX Daily preset now has a forward scanner (`tools/backtest/scan-egx.mjs`), but its output is a markdown file
that has to be opened by hand after the close. The user wants one page that shows:

- how every stock is doing under the preset (the market evaluation);
- the trades of each day;
- the trades to close.

The user is at the screen during the EGX session (Sun–Thu, 10:00–14:30 Cairo). The preset acts at the daily close,
so the decisions are made before 14:30. During the session the page must show what the close will do if prices hold.
After the close it shows the final result.

Alerts are on hold. The page informs and does not notify.

## Goals

1. During the session, an **"if it closed now"** view, refreshed every ~5 minutes and on demand:
   - which open trades would exit at the close, and why (a close at or below the stop, or a CHoCH invalidation);
   - which trades would open;
   - which targets would be hit;
   - each open trade's live price, stop, distance to the stop (% and R) and open R.
2. After the close, the **final day**: new entries, trades closed and targets hit, exactly as `scan-egx.mjs` reports
   them. The forward log is updated as it is today.
3. **Day by day**: the entries and exits of each past session (last ~60 sessions). Trades in the forward log, from
   2026-11-21 on, are marked as such.
4. **Market evaluation**: one sortable row per stock, PB and TR separately:
   - trades, win rate, total R, average R;
   - the same over the last 12 months;
   - the last trade and any trade open now;
   - market-wide totals and the forward record against the in-sample reference;
   - a click-through to the stock's full trade list.
5. It runs locally with one start command and no installs.

## Non-goals

- Alerts, sounds or push notifications. They are on hold; the page can grow them later.
- Placing orders or connecting to a broker.
- Changing the indicator, the preset or the engine's trading logic.
- Intraday bars. The live view uses only the forming daily bar.
- Access from other machines. The server binds to localhost only.

## Anti-goals

- **Provisional trades leaking into the forward log.** A trade seen on an unfinished bar must never be written to
  `forward/egx-daily-log.json` or to the CSVs on disk. That would corrupt the only out-of-sample test left.
- **Nudging per-stock cherry-picking.** The evaluation table shows history; it does not mark stocks to avoid or
  favour. Selecting stocks by past per-stock R is hindsight (see EMFD, worst of 92 in-sample). The page says so in
  one line above the table.
- **A page that looks live but isn't.** Every number carries its as-of time. Stale stocks and a stopped feed are
  shown, not hidden.

## Constraints

- Node is not on PATH on this machine (fnm). The start script must set PATH itself.
- Node 20 needs `--experimental-websocket` for the TradingView feed.
- Data is the dividend-adjusted daily feed (`data/egx-div`), the only data the engine matches TradingView on.
- A full download of 100 stocks takes a few minutes, which is too slow for a 5-minute refresh.
- Dividend adjustment rescales older prices after each ex-dividend date, so a fresh tail can disagree with the
  history on disk.
- **Unverified:** whether the unauthenticated feed's forming daily bar for EGX is real-time or delayed (often 15
  minutes for free users). This must be checked during a live session against the user's TradingView chart. Until
  then the page labels prices "TradingView public feed, may be delayed".

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A | The scanner writes a static `forward/dashboard.html`, rerun in a loop during the session; the page reloads itself | Least code, but no refresh button, sorting or click-through |
| **B (picked)** | A small local Node server (`node:http`, no dependencies) running the engine on a timer, serving one page and a JSON API | Interactive and live; costs a terminal window left open |
| C | On TradingView (Pine Screener or watchlist alerts) | Needs Premium for the screener, the preset set on 100 charts, and no market evaluation view; ruled out |

The user picked B: being at the screen during the session, refresh and sorting are what they will use.

## Design

### Layout

```
tools/dashboard/
  server.mjs      HTTP server, refresh scheduler, state
  live-feed.mjs   short tail fetch from the TradingView feed (last ~30 daily bars per stock)
  public/index.html   one page, vanilla JS, no CDN (works offline against localhost)
  start.cmd       sets the fnm PATH and starts the server, then opens the browser
tools/backtest/scan-core.mjs   scanner logic moved out of scan-egx.mjs and shared
```

`scan-egx.mjs` becomes a thin CLI over `scan-core.mjs`, so the dashboard and the CLI cannot drift apart. Its output
(`latest.md`, the log format) does not change.

### Data flow

1. **Start-up.** Load `data/egx-div` from disk. If the newest bar on disk is older than the last finished session,
   start a full download in the background (the existing `fetch-egx.mjs`) and show "updating history" until it ends.
2. **During the session** (Sun–Thu, 10:00–14:30 Cairo, plus a refresh at 14:35), every 5 minutes and on "Refresh now":
   - fetch the last ~30 daily bars per stock;
   - merge them **in memory** onto the disk history, replacing bars with the same time and appending the forming bar;
   - if an overlapping finished bar differs from disk by more than 0.5%, the history has been re-adjusted: fetch that
     stock's full history and replace it on disk (finished bars only);
   - run the engine on every stock with the forming bar treated as if it closed now, and diff the result against the
     same run without the forming bar. The differences are the provisional entries, exits and targets.
3. **After the close** (from 15:00 Cairo on a trading day, my call: 30 minutes for the feed to settle): one full
   download, then the end-of-day scan through `scan-core.mjs`, which writes `latest.md` and the forward log exactly
   as the CLI does. The page switches to "final".

### The closed-session guard

A bar dated today (Cairo) counts as finished only from 15:00 Cairo on a trading day. `scan-core.mjs` drops an
unfinished last bar before it touches the log, for the dashboard and the CLI alike. This also closes a latent hole:
today, running `scan-egx.mjs` mid-session would log trades from a bar that has not closed.

### Server

- Binds `127.0.0.1:8787`.
- `GET /` serves the page.
- `GET /api/state` returns:
  - the session date and mode (`live` / `final` / `closed day`);
  - the last refresh time and the feed status;
  - provisional changes, open trades, today's final trades and the day-by-day list;
  - the per-stock evaluation and the forward record;
  - stale and missing stocks.
- `GET /api/stock/:sym` returns one stock's full trade list.
- `POST /api/refresh` starts a refresh. Only one runs at a time; a second request joins the first.
- State lives in memory. Nothing new is written to disk except what the full download and the end-of-day scan
  already write.

### Page

```
EGX Daily · session 2026-11-22 · LIVE (if it closed now) · prices as of 12:41 · [Refresh now]
 ── Decide before the close ─────────────────────────────────────────────
  Would EXIT   SCEM PB  close 90.10 ≤ stop 90.99   −1.12R
  Would OPEN   ORAS PB  entry 312.0  stop 296.4  TP1 335.0
  Would hit    EFIH PB  TP2 27.35 (last 27.60)
 ── Open trades (13) ── stock · model · opened · entry · stop · to stop % / R · next target · live R
 ── Today (final after 15:00) ── entries · exits · targets
 ── Day by day ── 2026-11-19: 0 in, 0 out · 2026-11-18: SCEM PB in · ...
 ── Market evaluation ── sortable: stock · PB trades/win%/total R/avg R · last 12m · TR same · open now
     "Past results per stock do not predict that stock's future; the edge is across the market."
```

It polls `/api/state` every 60 seconds and has no build step. The UI is in English (my call); the README sections
are in both READMEs.

## Testing

- `node:test` unit tests for:
  - the tail merge (replace, append, re-adjustment detection);
  - the closed-session guard (before and after 15:00, weekend, holiday with no bar);
  - the provisional diff (exit, entry, target, nothing).
- An end-to-end check: after the close, `scan-core` via the server and the `scan-egx.mjs` CLI produce an identical
  `latest.md` and log on the same data.
- A live check during one session: the forming bar is compared with the user's TradingView chart, which settles the
  delay question.

## Left to the builder

- Tail size, the request pattern and whether to fetch a few stocks in parallel (keep a refresh well under 5 minutes).
- Page styling and table details.
- EGX holidays: none are hard-coded. A trading day is one where the feed returns a bar for today.
