# ThndrX Session Order Flow overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second ThndrX userscript that draws Session Order Flow exactly as the Pine does, with real intrabars from
Thndr's datafeed.

**Architecture:** The SOF engine (`tools/backtest/sof-engine.mjs`) gains a Pine drawing registry and the missing Pine
parts behind options that default to today's backtest behaviour. A pure plan module turns the registry and the
dashboard values into painter items and panel rows. A datafeed loader supplies intrabars. The ICT overlay's main loop
and UI become shared, parameterised modules used by both userscripts.

**Tech Stack:** Plain ES modules, `node --test`, the dependency-free bundler `tools/thndrx/build.mjs`, Playwright MCP
for the live pass.

**Spec:** `docs/superpowers/specs/2026-11-26-thndrx-sof-overlay-design.md`

## Global Constraints

- No npm dependencies; bundles are plain JavaScript with `@grant none`; Node is run with
  `export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"`.
- `src/session-orderflow.pine` is the source of truth for every text, colour, transparency, cap and order.
- Pine caps: `max_boxes_count = 200`, `max_lines_count = 500`, `max_labels_count = 500`.
- Drawings: `disableSave`, `disableUndo`, removed only by the ids we created; repaint only on closed bars, ≥ 60 s apart.
- Existing `runSof` output must not change for existing callers (snapshot `before.json`, 97 cases).
- Datafeed path `ChartApiInstance._studyEngine._externalDatafeed`; `countBack >= 1`; base resolutions 1, 5, 10, 60.
- Storage key `thndrx-sof:inputs:v1`. README.md ships with the code.

## Review Focus

1. Datafeed missing or erroring mid-load → dashboard says intrabars unavailable, engine runs on chart bars (Pine's
   fallback), nothing throws. Test in Task 2 (`loader falls back when the datafeed is missing / rejects`).
2. Symbol switch while intrabars are paging → the stale load is dropped, never painted on the new symbol. Test in
   Task 5 (`symbol change during intrabar load paints only the new symbol`).
3. Forming bar → no pool resolution, no breakout, no entry on it (Pine `barstate.isconfirmed`). Test in Task 1
   (`lastBarOpen leaves pools and sessions unresolved on the last bar`).
4. Both overlays on one chart → buttons and panels do not overlap, history loads do not interleave. Test in Task 4
   (`two overlays stack panels in one corner`, `history loads are serialised`).
5. Holiday gaps longer than a page → paging continues back to the window start. Test in Task 2
   (`paging steps over an empty chunk`).

---

### Task 1: Engine — Pine parity additions and drawing registry

**Files:** Modify `tools/backtest/sof-engine.mjs`, `tools/backtest/sof-data.mjs` (buildChart moves into the engine and
is re-exported); Test `tools/backtest/sof-engine.test.mjs`.

**Interfaces — Produces:**
- `buildChart({...})` exported from `sof-engine.mjs` (browser-safe), re-exported by `sof-data.mjs`.
- New cfg keys (defaults keep backtests unchanged): `showTrades: true`, `entryModel: 'Sweep reversal'`,
  `runStopAtr: 8`, `runTrendLen: 200`, `lastBarOpen: false`, `render: false` plus the Pine display inputs
  (`showAsia/showLondon/showNewYork/londonSession/newYorkSession/showOpenRange/showPools/keepTaken/poolThickMult/
  showProfile/showPrevProfile/prevKeep/showRefLines`).
- `chart.sessionStartMin` (optional): multi-hour intraday periods align to it instead of the UTC grid.
- Result gains `runTrades`, `runOpen`, `drawings` (when `render`): `{ boxes, lines, labels }`, each item
  `{ seq, kind, ... Pine props }`, and `final`: the dashboard's last-bar values.

- [ ] Step 1: tests — registry caps (201st box deletes the oldest alive), `lastBarOpen` leaves pools/sessions
  unresolved, run model vs `data/sof/tvlogs/RUN_COMI_1D.csv` (33/33) and `RUN_BTC_240.csv` (46/46) when the data
  folder is present.
- [ ] Step 2: implement; Step 3: tests pass and the snapshot script reproduces `before.json` exactly; Step 4: commit.

### Task 2: Intrabar loader

**Files:** Create `tools/thndrx/sof-ltf.mjs`, test `sof-ltf.test.mjs`.

**Interfaces — Produces:** `ltfFor(chartRes, deltaTfInput) -> string|null` (Pine ltfTf; null = chart bars),
`baseFor(ltf) -> '1'|'5'|'10'|'60'`, `aggregate(rows, ltfMin, { tz, sessionStartMin }) -> rows`,
`findDatafeed(frameWin) -> df|null`, `pageBars(df, symbolInfo, base, { fromSec, toSec, cancelled, sleep }) -> rows`,
`createLtfStore({ idb, now })` with `load(key, fetcher) / tail(key, fetcher)`.

- [ ] Steps: tests (aggregation 10m→30m session-aligned, 60m→240m at 10:00, paging backwards to fromSec, empty chunk
  skipped, missing/rejecting datafeed → null), implement, pass, commit.

### Task 3: SOF inputs

**Files:** Create `tools/thndrx/sof-inputs.mjs`, test `sof-inputs.test.mjs`.

**Interfaces — Produces:** `SOF_INPUTS`, `sofDefaults()`, `sofIsValid(input, v)`, `loadSofValues(storage)`,
`saveSofValues(storage, values)`, `sofEngineCfg(values) -> cfg`. `logTrades` carries `unavailable`.

- [ ] Steps: tests (every Pine input present, defaults equal Pine, invalid stored values replaced), implement, commit.

### Task 4: Shared shell (overlay loop, UI factory, history lock)

**Files:** Create `tools/thndrx/overlay.mjs`; modify `main.mjs`, `ui.mjs`, `chart-port.mjs`, `painter.mjs` (box text);
tests updated.

**Interfaces — Produces:** `startOverlay(app, win, opts)`; `createUi({ prefix, buttonText, buttonTitle, title, inputs,
defaults, isValid, slot })`; `app = { tag, ui, loadValues, saveValues, messagePanel, buildPlan(bars, values, ctx),
prepare?(sess, helpers) , refresh?(sess, helpers) }`; history lock `withHistoryLock(frameWin, fn)`.

- [ ] Steps: ICT tests stay green; new tests for panel stacking and the lock; commit.

### Task 5: SOF plan, panel and app

**Files:** Create `sof-plan.mjs`, `sof-panel.mjs`, `sof-main.mjs`; extend `format.mjs`; tests.

**Interfaces — Consumes:** Tasks 1–4. **Produces:** `buildSofPlan(bars, values, ctx) -> RenderPlan`,
`sofPanel(final, values, ctx) -> Panel`, `startSof(win, opts)`.

- [ ] Steps: tests (dashboard rows/texts per verdict branch, plan items from registry, symbol change during intrabar
  load), implement, commit.

### Task 6: Build both bundles, README

**Files:** Modify `build.mjs`, `build.test.mjs`, `tools/thndrx/README.md`, `README.md` if it lists the overlay.

- [ ] Steps: build writes `dist/thndrx-ict.user.js` and `dist/thndrx-sof.user.js`; tests; docs; commit.

### Task 7: Live pass on ThndrX, then review

- [ ] Inject the bundle into the logged-in Playwright page with drawing/layout writes blocked; check drawings, panel,
  settings, 1D/60/15/1W, symbol switches, both overlays, timing; record results in
  `docs/superpowers/plans/2026-11-26-thndrx-sof-live-results.md`.
- [ ] Fable-model code review of the branch; fix confirmed findings; commit.
