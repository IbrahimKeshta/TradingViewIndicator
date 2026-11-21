# EGX Daily dashboard: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web dashboard for the EGX Daily preset that shows:
- an "if it closed now" view during the session;
- the final day after the close;
- the day-by-day trades;
- a per-stock market evaluation.

**Architecture:** The scanner logic moves out of `scan-egx.mjs` into `tools/backtest/scan-core.mjs`, shared by the CLI
and a dependency-free `node:http` server in `tools/dashboard/`. During the session the server fetches a short tail of
daily bars, merges it in memory and runs the engine twice: with the forming bar, and without it. The difference is the
provisional view. After 15:00 Cairo it runs the normal end-of-day scan.

**Tech Stack:** Node 20 (fnm), ES modules, `node:test`, the built-in WebSocket (`--experimental-websocket`), vanilla
HTML/JS.

**Spec:** `docs/superpowers/specs/2026-11-22-egx-dashboard-design.md`

## Global Constraints

- No npm dependencies. No CDN in the page.
- The server binds `127.0.0.1:8787`.
- A bar dated today (Cairo) counts as finished only from 15:00 Cairo.
- Nothing provisional is ever written to `forward/egx-daily-log.json` or to `data/egx-div/*.csv`.
- During the session, refresh every 5 minutes (10:00–14:35 Cairo, Sun–Thu) and on demand. One refresh runs at a time.
- Re-adjustment threshold: an overlapping finished bar differs from disk by more than 0.5% on its close.
- The output of `scan-egx.mjs` (`latest.md`, the log format) does not change.
- Above the evaluation table, the page shows: "Past results per stock do not predict that stock's future; the edge is
  across the market."
- Prices are labelled "TradingView public feed, may be delayed" until a live check settles it.
- The README is updated alongside the code. The README sections go into both README.md and README.ar.md.

## Review Focus

1. **Server started mid-session with stale disk data.** It must still show a correct live view: the background full
   download runs first, or the tail covers the gap. Covered by the `mergeTail` gap test (Task 2).
2. **The CLI run mid-session.** It must not log the forming bar. Covered by the guard test (Task 1).
3. **The feed fails or times out for some stocks.** The page must show those stocks as stale, not crash or silently
   use old data. Covered by `refresh` handling per-symbol errors (Task 4), shown in `state.stale`.
4. **A stock with no bar today** (suspended, or a holiday). It is not treated as live; no provisional rows.
   Covered by the provisional test "no forming bar" (Task 3).
5. **Two refreshes at once** (button plus timer). They must share one run. Covered by the joined-promise test (Task 4).

---

### Task 1: `scan-core.mjs` and the closed-session guard

**Files:**
- Create: `tools/backtest/scan-core.mjs`
- Modify: `tools/backtest/scan-egx.mjs`, which becomes a CLI over the core
- Test: `tools/backtest/scan-core.test.mjs`

**Interfaces:**
- Produces:
  - `cairoParts(now: Date) -> { date: 'YYYY-MM-DD', minutes: number, weekday: 0..6 }`
  - `isBarFinished(barDate: string, now: Date) -> boolean`: true if `barDate < today`, or if `barDate == today` and
    `minutes >= 15*60`.
  - `dropUnfinished(bars, now) -> bars`, which removes the last bar if it is not finished.
  - `runUniverse(barsBySym, meta, indexBars, cfg) -> { closedAll, openAll, lastDate, lastClose }`. `openAll` rows
    have the same shape as `scan-egx.mjs` today.
  - `updateLog(log, closedAll, openAll, session) -> log`, which mutates and returns the log.
  - `renderLatest({ session, symbols, stale, missing, closedAll, openAll, log, trail }) -> string` (markdown).
  - `EGX_CFG(trail = true)`.

- [ ] **Step 1: Write tests.**
  - `isBarFinished('2026-11-22', <2026-11-22 14:59 Cairo>) === false`.
  - `isBarFinished('2026-11-22', <15:00 Cairo>) === true`.
  - `isBarFinished('2026-11-19', <2026-11-22 10:00 Cairo>) === true`.
  - `dropUnfinished` drops only an unfinished last bar.
- [ ] **Step 2: Run** `node --test tools/backtest/scan-core.test.mjs`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.** Move the code out of `scan-egx.mjs` without changing its behaviour. The CLI applies
  `dropUnfinished(bars, new Date())` to each stock before `runUniverse`.
- [ ] **Step 4: Run the tests.** Expect PASS. Then run the equivalence check: the old and the new
  `scan-egx.mjs --no-fetch --log /tmp/x.json --out /tmp/x.md` on the same data give byte-identical output, apart from
  the `lastRun` value.
- [ ] **Step 5: Commit.**

### Task 2: `live-feed.mjs`, the tail fetch and merge

**Files:**
- Create: `tools/dashboard/live-feed.mjs`, `tools/dashboard/live-feed.test.mjs`

**Interfaces:**
- Produces:
  - `fetchTail(tvSymbol: string, n = 30, timeoutMs = 20000) -> Promise<bars[]>`, with bars in the `loadCsv` shape
    (`time, date, open, high, low, close, volume`). It uses a single `create_series` with `n` bars, dividend-adjusted.
  - `mergeTail(disk: bars[], tail: bars[], tol = 0.005) -> { bars, readjusted: boolean, gap: boolean }`:
    - bars with the same `time` are replaced by the tail's;
    - newer bars are appended;
    - `readjusted` is true if an overlapping bar other than the tail's last differs on its close by more than `tol`;
    - `gap` is true if the tail's first bar is newer than the disk's last bar (some bars are missing in between).
- [ ] **Step 1: Write tests.** Cover four cases with explicit bar arrays: replace plus append; readjusted at 0.6%,
  not at 0.4%; a gap; an empty tail, which returns the disk bars unchanged.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.** Reuse the fetcher's message framing (`~m~` encoding and the heartbeat echo). Format
  `date` with `Africa/Cairo`.
- [ ] **Step 4: Run the tests.** Expect PASS. Then smoke-test it: `fetchTail('EGX:COMI', 5)` returns 5 bars whose
  last date matches `data/egx-div/COMI.csv` or is newer.
- [ ] **Step 5: Commit.**

### Task 3: Dashboard state (provisional diff, day by day, evaluation)

**Files:**
- Create: `tools/dashboard/state.mjs`, `tools/dashboard/state.test.mjs`

**Interfaces:**
- Consumes:
  - `runUniverse` and `EGX_CFG` (Task 1);
  - trade objects from `runEngine`: `symbol, model, openDate, closeDate, entry, stop, tp1..3, tpHit, reason, exit, r`;
  - `openAll` rows: `symbol, model, openDate, entry, curStop, tpHit, close, openR, tp1..3`.
- Produces:
  - `provisional(withRun, withoutRun, today) -> { exits, entries, targets }`:
    - `exits` are the `withRun.closedAll` trades with `closeDate === today`;
    - `entries` are the trades in `withRun` (open or closed) with `openDate === today`;
    - `targets` are the open trades matched by `symbol|openDate|model` whose `tpHit` rose; each row is
      `{ symbol, model, openDate, from, to, level }`.
    - If no stock has a bar dated `today`, all three are empty.
  - `openRows(openAll, liveClose) -> rows`. Each row adds `toStopPct` (the distance from the last price to `curStop`
    in % of price) and `toStopR` (the same distance in R).
  - `dayByDay(closedAll, openAll, sessions = 60) -> [{ date, entries: [...], exits: [...] }]`, newest first, only dates
    with activity, limited to the last `sessions` distinct bar dates.
  - `evaluate(closedAll, openAll, asOf) -> { rows: [{ symbol, PB: stats, TR: stats, PB12: stats, TR12: stats, open: [...], last }], totals }`.
    - `stats = { n, wins, winPct, totalR, avgR }`.
    - The 12-month window covers trades with `closeDate > asOf − 365 days`.
- [ ] **Step 1: Write tests.** Use synthetic trade arrays:
  - `provisional` finds one exit, one entry and one TP1→TP2 target;
  - "no forming bar" gives three empty lists;
  - `evaluate` gives the right `winPct` and `avgR`, with `n = 0` giving `avgR = null`;
  - `dayByDay` keeps only active dates, newest first;
  - `toStopR` for a long with entry 10, stop 9 and last 9.5 is 0.5.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit.**

### Task 4: The server

**Files:**
- Create: `tools/dashboard/server.mjs`, `tools/dashboard/server.test.mjs`

**Interfaces:**
- Consumes Tasks 1–3, plus `loadSymbol`, `loadMeta` and `loadIndexBars` from `data.mjs`.
- Produces:
  - `createDashboard({ dataDir, logFile, outFile, now = () => new Date(), fetchTail, fullFetch }) -> { refresh(), state(), stock(sym), endOfDay() }`.
    The feed functions are injectable for the tests.
  - `refresh()` returns the in-flight promise if one is running.
  - On per-symbol fetch errors, the stock keeps its disk bars and is listed in `state().stale` with the error.
  - `state()` returns `{ mode: 'live'|'final'|'closed', session, asOf, feedNote, provisional, open, today, days, evaluation, forward, stale, missing, refreshing, error }`.
  - The HTTP layer runs only when the module is the entry point:
    - `GET /` serves `public/index.html`;
    - `GET /api/state`;
    - `GET /api/stock/:sym` returns that stock's closed and open trades;
    - `POST /api/refresh`.
  - The scheduler:
    - on start, if the newest disk bar is older than the last finished session, run `fullFetch()` (a child process of
      `fetch-egx.mjs` with `ADJ=dividends`), then reload;
    - every 5 minutes, when `cairoParts` is Sun–Thu and 10:00–14:35, run `refresh()`;
    - at the first tick at or after 15:00 on a day that had a forming bar, run `endOfDay()` once. That is a full fetch,
      then the CLI-equivalent scan through `updateLog` and `renderLatest`, writing `logFile` and `outFile`.
  - Modes: `live` while today's bar is unfinished; `final` after `endOfDay` has run; `closed` otherwise (weekend,
    before the open, a holiday).
- [ ] **Step 1: Write tests** with a temp data dir holding 2 synthetic stocks plus stub `fetchTail` and `fullFetch`:
  - two `refresh()` calls at once give the same promise, and `fetchTail` is called once per stock;
  - a stock whose `fetchTail` throws appears in `stale`;
  - in live mode, `logFile` is not written by `refresh()`;
  - `endOfDay()` writes `logFile` and `outFile`.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.** Fetch the tails with a small concurrency limit (4).
- [ ] **Step 4: Run the tests.** Expect PASS. Then smoke-test it: start the server on the real data, `curl /api/state`,
  and check `mode`, `open.length` (13 on the 2026-11-19 data) and `evaluation.rows.length`.
- [ ] **Step 5: Commit.**

### Task 5: The page, the launcher and the docs

**Files:**
- Create: `tools/dashboard/public/index.html`, `tools/dashboard/start.cmd`, `tools/dashboard/README.md`
- Modify: `README.md`, `README.ar.md`, `forward/README.md` (pointers), `tools/backtest/README.md` (`scan-core`)

**Interfaces:**
- Consumes `/api/state`, `/api/stock/:sym` and `/api/refresh` (Task 4).

The page has these sections, as in the spec's sketch:
- a header with the mode, the as-of time, the feed note and a "Refresh now" button;
- "Decide before the close", shown only in live mode;
- open trades;
- today;
- day by day;
- market evaluation: sortable by any column, with a PB/TR toggle, the "all history" and "last 12 months" columns, a
  click-through to the stock's trades, and the fixed line above it.

The page polls every 60 seconds. `start.cmd` prepends `%APPDATA%\fnm\aliases\default` to PATH, starts
`node --experimental-websocket tools\dashboard\server.mjs` from the repo root and opens `http://127.0.0.1:8787`.

- [ ] **Step 1: Build the page.**
- [ ] **Step 2: Verify it in a browser** with Playwright against the running server, using the real data. Every
  section renders, sorting works, the click-through works and the Refresh button works. Take a screenshot.
- [ ] **Step 3: Write the docs.** The README sections cover what the dashboard shows, how to start it, the
  provisional-vs-final rule and the feed-delay caveat.
- [ ] **Step 4: Commit.**

### Task 6: Final review

- [ ] Run a whole-branch code review with a fresh reviewer on the Fable model, as the user asked. Fix the findings
  that are confirmed, then rerun all tests.
