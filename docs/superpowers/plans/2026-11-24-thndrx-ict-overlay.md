# ThndrX ICT Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tampermonkey userscript that draws the full ICT + RSI/MA Confluence indicator on ThndrX's desktop TradingView chart, from the existing JavaScript engine port.

**Architecture:** Pure, Node-testable core: the engine (`tools/backtest/ict-engine.mjs`, extended) produces trades plus final state, `render-plan.mjs` turns that into a flat list of drawable items with stable keys and Pine's own lifetimes and caps, and `panel.mjs` builds the info-panel rows. A thin browser shell finds the chart iframe's `tradingViewApi`, feeds it bars, and a painter diffs each new render plan against what it drew before, using only chart-API drawings created with `disableSave`. A dependency-free build script concatenates everything into one `.user.js`.

**Tech Stack:** Node 20 ES modules, `node:test`, no npm dependencies; TradingView Trading Platform library v31.1.0 chart API (inside ThndrX); Tampermonkey; Playwright MCP for live checks.

**Spec:** `docs/superpowers/specs/2026-11-24-thndrx-ict-overlay-design.md`

## Global Constraints

- Node is not on PATH: every command is run after `export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"`.
- No npm dependencies anywhere (engine, tools, tests, build).
- Every drawing is created with `disableSave: true` and `disableUndo: true`; the painter removes only entity IDs it created.
- Never place, change or read orders; never click anything in ThndrX's trading UI.
- Desktop Chrome/Edge only; `@match https://x.thndr.app/*`.
- `Require Index Trend` is unavailable on ThndrX: forced off, its inputs shown disabled with a note.
- The engine runs on full history back to the series start; drawings keep Pine's anchor limit `HIST_LIMIT = 5000` (`anchorBar(b) = max(b, last - 4999)`) and per-type caps of 500 boxes / 500 lines / 500 labels.
- Engine trade results must not change: `validate.mjs` output is byte-identical before and after every engine edit.
- Settings persist in `localStorage` under `thndrx-ict:inputs:v1`.
- README.md and README.ar.md document the userscript in the same commit that ships it (standing instruction).
- Data for Node tests that need real bars: `ICT_DATA=G:/TradingViewIndicator/data/egx-div` (gitignored, local only). Tests that need it skip when it is missing.

## Review Focus

1. **Symbol or time-frame switch while a recompute is in flight**: the user expects the old symbol's drawings never to appear on the new chart. Pinned by `painter.test.mjs › stale token is discarded` (Task 10).
2. **A stock with very little history** (new listing, 30 daily bars, or an intraday chart with a few hundred bars): no exception, panel shows `—` where Pine shows `—`, no drawing at a NaN price. Pinned by `render-plan.test.mjs › short history renders without NaN` (Task 6).
3. **Zero or missing volume** (thin EGX names, index symbols): anchored VWAP and participation drop out like Pine, and no label text ever contains `NaN`. Pinned by `render-plan.test.mjs › zero volume has no NaN text` (Task 6).
4. **The user's own drawings on the same chart**: never removed or modified. Pinned by `painter.test.mjs › foreign entities untouched` (Task 10).
5. **Chart time frame at or above Bias Timeframe** (for example 1W chart with `htfBiasTf = 1D`): HTF filter disables itself, as in Pine. Pinned by `htf.test.mjs › inactive when chart tf >= htf` (Task 3).

---

### Task 1: ThndrX live recon and go/no-go

Confirms the four facts the browser half of the plan rests on. Driven with the Playwright MCP browser; the user logs in themselves (OTP included). Read-only apart from creating and deleting one test drawing.

**Files:**
- Create: `docs/superpowers/plans/2026-11-24-thndrx-recon.md`

**Interfaces:**
- Produces: the recon notes later tasks read: desktop chart route, iframe selector, how `tradingViewApi` is reached, `exportData` result shape, how to load history back to the series start, symbol/mintick/resolution source, the chart event to listen to for live updates, the exact shape names and override keys for each `RenderPlan` item kind (Task 10 table), and where a settings button can be mounted.

- [ ] **Step 1: Open ThndrX and hand over for login**

`browser_navigate` to `https://x.thndr.app/`. Ask the user to log in in that window. Wait for their go-ahead.

- [ ] **Step 2: Find the desktop chart route and the API**

Open a stock chart from the UI. Record the URL. With `browser_evaluate`, find the iframe whose `contentWindow.tradingViewApi` exists; record a selector for it, `typeof api.activeChart`, `api.activeChart().symbol()`, `.resolution()`, `.symbolExt?.()`.

- [ ] **Step 3: Read bars and probe history depth**

Call `await chart.exportData({ includeTime: true, includeSeries: true, includedStudies: [] })`; record the schema and bar count. Then try, in order, until the first bar stops moving or the series start is reached: `chart.setVisibleRange({ from: <1990-01-01>, to: <now> })`, scrolling via `chart.getTimeScale().scrollToFirstBar?.()`, repeated left scroll. Record which works, how long full history takes for a daily EGX stock, and the first bar date reached. Repeat on 60m.

- [ ] **Step 4: Go/no-go — `disableSave` really keeps drawings out of the saved layout**

Create one `rectangle` with `{ disableSave: true, disableUndo: true, lock: true, disableSelection: true }`. Wait 15 s (auto-save is 5 s). Reload the page. Pass = the rectangle is gone after reload. **If it persists, stop the plan and report to the user.** Also record whether shapes accept `zOrder`, and whether `chart.getAllShapes()` lists it.

- [ ] **Step 5: Pin the shape table**

For each plan item kind (box, line, ray, label up/down/left, series path, filled polygon, marker up/down, background band), create one shape, screenshot it, delete it, and record the working `shape` name and override keys (colour, fill, line style, width, text, font size, background, text alignment). Record whether multipoint paths accept more than 1000 points and how slow 5000 points is. Record the live-update hook (`chart.onDataLoaded()`, `chart.onSymbolChanged()`, `chart.onIntervalChanged()`, tick or bar events) and where a button fits (`api.createButton?`, or a fixed-position element inside the iframe document).

- [ ] **Step 6: Write the recon notes and commit**

Write `docs/superpowers/plans/2026-11-24-thndrx-recon.md` with one section per step above. Include the exact snippets that worked.

```bash
git add docs/superpowers/plans/2026-11-24-thndrx-recon.md
git commit -m "docs(thndrx): live recon of the ThndrX chart API"
```

---

### Task 2: Engine additions for rendering (no trade changes)

**Files:**
- Modify: `tools/backtest/ict-engine.mjs` (DEFAULTS, PRESETS, `runEngine`)
- Create: `tools/backtest/ict-engine.test.mjs`

**Interfaces:**
- Produces (all additive; existing fields unchanged):
  - `DEFAULTS.killzoneAlwaysEarned = false`; `PRESETS['egx-daily'].killzoneAlwaysEarned = true`. When true, `killzonePointOn` is true and the killzone point is earned on every bar (Pine lines 846 and 850, `egxPreset or ...`).
  - `opts.htfBias?: Int8Array` (per chart bar, 1 / -1 / 0) and `opts.htfActive?: boolean`. `htfLongOk(i) = !(cfg.requireHtfBias && opts.htfActive) || opts.htfBias[i] === 1`, short mirrored; both ANDed into `bullHardOk` / `bearHardOk`. The old `throw` for `requireHtfBias` is removed. Without `opts.htfBias` the filter is inactive.
  - Zones gain `left: number` (FVG: `i - 2`; OB: `i - off`).
  - Trade objects (`mkTrade`) gain `liq1, liq2, liq3` from `selectTargets`.
  - Return value gains:
    - `series: { ma, rsi, structAtr, spanA, spanB, killzoneActive, trailLong, trailShort, trailDir: Int8Array, avwapLow, avwapHigh, longSetup: Uint8Array, shortSetup: Uint8Array }` (Float64Array unless noted; `trailLong/trailShort/trailDir/avwap*` are the per-bar values the loop computes).
    - `events: Array<{ bar, tier: 'major'|'internal', type: 'BOS'|'CHoCH', side: 'bull'|'bear', level, levelBar }>`, one per tier per bar with `bullBreak || bearBreak`.
    - `opens: Array<{ bar, model: 'PB'|'TR', side }>`, every trade opened.
    - `final: { majorSt, intSt, inRange, majorHighs, majorLows, intHighs, intLows, bullFvg, bearFvg, bullOb, bearOb, pbTrade, trTrade, gate }` as of the last bar; `pbTrade`/`trTrade` are `null` unless live (`closeReason === null`).
    - `final.gate: { long: boolean, score, of, reason, marks: { mom, part, ichi } }`: Pine lines 1075-1089 and 2021-2023, with `reason` one of `'no trend'|'in range'|'htf bias'|'index trend'|'anchored vwap'|'awaiting confirmation'|'no zone touch'|'score short'|'READY'` (`'bar not closed'` is added by the panel, Task 8). Marks are `'✓'|'✗'|'–'`.

- [ ] **Step 1: Record the baseline**

Run: `node tools/backtest/validate.mjs --data G:/TradingViewIndicator/data/egx-div --cut 2026-11-04 --combos base,r4,conf,idx,both,r1,r2,r3 > /tmp/validate-before.txt`
Expected: the table ends with group rows (today: `ict base 25 24 24 24`, `runner r4 45 40 40 40`).

- [ ] **Step 2: Write the failing tests**

```js
// tools/backtest/ict-engine.test.mjs
test('zones carry their left edge', () => { /* synthetic bars with one bullish FVG at bar 10 */
  const res = runEngine(bars, {}, {});
  assert.equal(res.final.bullFvg.at(-1).left, 8);
});
test('events record BOS/CHoCH per tier', () => { assert.ok(res.events.every(e => ['BOS','CHoCH'].includes(e.type))); });
test('final.gate names the first unmet condition', () => { assert.ok(GATE_REASONS.includes(res.final.gate.reason)); });
test('htf bias blocks longs when active and bias is -1', () => {
  const all = runEngine(bars, {}, {}), blocked = runEngine(bars, { requireHtfBias: true }, { htfActive: true, htfBias: new Int8Array(bars.length).fill(-1) });
  assert.ok(all.opens.some(o => o.side === 'long')); assert.ok(!blocked.opens.some(o => o.side === 'long'));
});
test('killzoneAlwaysEarned scores the point on every bar', () => { const a = runEngine(hourly, { scoreKillzone: false }), b = runEngine(hourly, { scoreKillzone: false, killzoneAlwaysEarned: true }); assert.equal(b.final.gate.of, a.final.gate.of + 1); assert.equal(b.final.gate.score, a.final.gate.score + 1); });
test('series lengths equal bar count', () => { for (const k of Object.keys(res.series)) assert.equal(res.series[k].length, bars.length); });
```

Synthetic bars come from a helper `makeBars(closes, { start, stepSec })` in `tools/thndrx/test-bars.mjs` (create it here: OHLC from closes with fixed ±1% wicks, volume 1000, `date` in Africa/Cairo).

- [ ] **Step 3: Run to see them fail**

Run: `node --test tools/backtest/ict-engine.test.mjs`
Expected: FAIL (`left` undefined, `res.final` undefined).

- [ ] **Step 4: Implement the additions listed under Interfaces**

Gate reason follows Pine line 1088 in order; `gateTouch` is `effBullHit` / `effBearHit`; `gateAwaiting` reads `pend.bull.active` / `pend.bear.active`.

- [ ] **Step 5: Tests pass and trades are unchanged**

Run: `node --test tools/backtest/ict-engine.test.mjs tools/backtest/scan-core.test.mjs` → PASS.
Run the Step 1 command into `/tmp/validate-after.txt`; `diff /tmp/validate-before.txt /tmp/validate-after.txt` → no output.

- [ ] **Step 6: Commit**

```bash
git add tools/backtest/ict-engine.mjs tools/backtest/ict-engine.test.mjs tools/thndrx/test-bars.mjs
git commit -m "feat(engine): expose render state, HTF bias input and preset killzone point"
```

---

### Task 3: Higher-time-frame bias from the chart's own bars

**Files:**
- Create: `tools/thndrx/htf.mjs`, `tools/thndrx/htf.test.mjs`

**Interfaces:**
- Produces:
  - `tfSeconds(tf: string): number`: `'1'..'240'` minutes, `'1D'`/`'D'` 86400, `'1W'`/`'W'` 604800, `'1M'` 2592000.
  - `resampleBars(bars, htfTf: string): { htfBars: Bar[], map: Int32Array }`: groups chart bars into HTF periods in Africa/Cairo time (day = Cairo date; week starts **Sunday**, as TradingView's EGX weeks do; minute TFs = floor of minutes since Cairo midnight). `map[i]` = HTF index of chart bar `i`.
  - `htfBiasSeries(bars, { htfBiasTf, htfSwingLen }, chartTf): { bias: Int8Array, active: boolean }`: `active = tfSeconds(htfBiasTf) > tfSeconds(chartTf)`. Runs `htfBiasCalc` (the Pine function of that name, `ta.pivothigh/low` with the engine's `strictRight` tie rule) over `htfBars`, then `bias[i] = calc[map[i] - 1]` (0 when `map[i] < 1`): the last *closed* HTF bar, Pine's `[1]` + `lookahead_on`.

- [ ] **Step 1: Write the failing tests**

```js
test('daily bars group into Sunday weeks', () => { /* 10 Cairo trading days Sun..Thu x2 */ assert.equal(resampleBars(bars, '1W').htfBars.length, 2); });
test('60m bars group into Cairo days', () => { /* 2 days x 5 hourly bars */ assert.deepEqual([...resampleBars(bars, '1D').map], [0,0,0,0,0,1,1,1,1,1]); });
test('bias reads the previous closed HTF bar', () => { /* HTF break up on htf bar 7: chart bars of htf bar 7 read 0 or prior, bars of htf bar 8 read 1 */ });
test('inactive when chart tf >= htf', () => { assert.equal(htfBiasSeries(bars, { htfBiasTf: '1D', htfSwingLen: 5 }, '1W').active, false); });
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tools/thndrx/htf.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement `tools/thndrx/htf.mjs`**

- [ ] **Step 4: Run tests**

Run: `node --test tools/thndrx/htf.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/htf.mjs tools/thndrx/htf.test.mjs
git commit -m "feat(thndrx): HTF bias resampled from the chart's own bars"
```

---

### Task 4: Input schema, preset resolution, colours, formatting

**Files:**
- Create: `tools/thndrx/inputs.mjs`, `tools/thndrx/colors.mjs`, `tools/thndrx/format.mjs`, `tools/thndrx/inputs.test.mjs`

**Interfaces:**
- Produces:
  - `INPUTS: ReadonlyArray<{ id, label, group, type: 'int'|'float'|'bool'|'string'|'session'|'color'|'timeframe'|'time', def, options?, min?, max?, step?, tooltip?, unavailable?: string }>`: all 125 Pine inputs in declaration order, `id` = the Pine variable name (`stopOnCloseOnlyIn`, `panelPosInput`, ...). The four Index Filter inputs carry `unavailable: 'Not available on ThndrX: the index needs a second data feed.'`.
  - `defaultValues(): Record<string, any>`.
  - `resolveConfig(values): { engineCfg, display, presetTag }`. `engineCfg` uses `DEFAULTS` key names and applies Pine lines 123-130 (EGX Daily forces `stopOnCloseOnly, runnerMode, trailFromEntry, longOnly, applyCosts = true`, `trailTier 'Major'`, `minRiskTicks 10`) plus `killzoneAlwaysEarned` and `requireIndexTrend: false`. `display` holds every show-flag, colour, `panelPos`, `panelBg`, `rsiOverbought`, `rsiOversold`, `htfSwingLen`, `htfBiasTf`. `presetTag` is `' · EGX DAILY'` or `''`.
  - `loadValues(storage): values` and `saveValues(storage, values)` under key `thndrx-ict:inputs:v1`; unknown ids dropped, missing ids filled from defaults, wrong-typed values replaced by defaults.
  - `colors.mjs`: `PINE_COLORS` (Pine v6 named colours as hex), `colorNew(c, transp): string` (`'rgba(r, g, b, a)'`, `a = 1 - transp/100`).
  - `format.mjs`: `fmtPrice(x, mintick)` (Pine `format.mintick`: decimals of mintick), `fmtNum(x, pattern)` for `'0'`, `'0.0'`, `'0.00'`, `'#.##'` (Pine `str.tostring` patterns; `'#.##'` drops trailing zeros).

- [ ] **Step 1: Write the failing tests**

```js
test('schema matches every input declared in the Pine', () => {
  const src = fs.readFileSync('src/ict-rsi-ma-indicator.pine', 'utf8');
  const ids = [...src.matchAll(/^(\w+)\s*=\s*input\./gm)].map(m => m[1]);
  assert.equal(ids.length, 125); assert.deepEqual(INPUTS.map(i => i.id), ids);
});
test('defaults resolve to engine DEFAULTS', () => { const { engineCfg } = resolveConfig(defaultValues()); for (const [k, v] of Object.entries(engineCfg)) if (k in DEFAULTS && k !== 'killzoneAlwaysEarned') assert.deepEqual(v, DEFAULTS[k], k); });
test('EGX Daily resolves to the egx-daily preset', () => { const { engineCfg, presetTag } = resolveConfig({ ...defaultValues(), presetInput: 'EGX Daily' }); for (const [k, v] of Object.entries(PRESETS['egx-daily'])) assert.deepEqual(engineCfg[k], v, k); assert.equal(presetTag, ' · EGX DAILY'); });
test('index filter is forced off', () => { assert.equal(resolveConfig({ ...defaultValues(), requireIndexTrend: true }).engineCfg.requireIndexTrend, false); });
test('loadValues repairs storage', () => { const s = fakeStorage({ 'thndrx-ict:inputs:v1': JSON.stringify({ minScore: 'x', bogus: 1 }) }); const v = loadValues(s); assert.equal(v.minScore, 5); assert.ok(!('bogus' in v)); });
test('format', () => { assert.equal(fmtPrice(12.3, 0.01), '12.30'); assert.equal(fmtNum(54.1, '#.##'), '54.1'); assert.equal(fmtNum(-0.04, '0.0'), '-0.0'); assert.equal(colorNew('#FF9800', 80), 'rgba(255, 152, 0, 0.2)'); });
```

Pin `fmtNum(-0.04, '0.0')` against TradingView in Task 9 (Pine may print `0.0`); adjust if it differs.

- [ ] **Step 2: Run to see them fail**: `node --test tools/thndrx/inputs.test.mjs` → FAIL.

- [ ] **Step 3: Implement the three modules.** Copy labels, groups, defaults, options, bounds and tooltips verbatim from Pine lines 14-195.

- [ ] **Step 4: Run tests**: `node --test tools/thndrx/inputs.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/inputs.mjs tools/thndrx/colors.mjs tools/thndrx/format.mjs tools/thndrx/inputs.test.mjs
git commit -m "feat(thndrx): Pine input schema, preset resolution, colours and number formats"
```

---

### Task 5: Render plan — zones, structure, break events, signals, RSI readout

**Files:**
- Create: `tools/thndrx/render-plan.mjs`, `tools/thndrx/render-plan.test.mjs`

**Interfaces:**
- Consumes: `runEngine` result (Task 2), `htfBiasSeries` (Task 3), `resolveConfig`, `colorNew`, `fmtPrice`, `fmtNum` (Task 4).
- Produces:
  - `buildRenderPlan(bars, values, ctx: { symbol, mintick, resolution, lastBarOpen }): RenderPlan`
  - `RenderPlan = { meta, boxes, lines, labels, series, fills, markers, bands, panel }`, every item with a stable string `key`; times are `bars[i].time` (unix seconds):
    - `meta: { symbol, resolution, bars, firstTime, lastTime, warnings: string[] }`
    - `boxes: { key, t1, t2, top, bottom, border, bg, order }[]`
    - `lines: { key, t1, p1, t2, p2, extendRight, color, style: 'solid'|'dotted', width, order }[]`
    - `labels: { key, time, price, text, style: 'up'|'down'|'left', color, textColor, size: 'tiny'|'small', order }[]`
    - `series: { key, points: {time, price}[], color, width }[]` (one entry per NaN-free run)
    - `fills: { key, points: {time, price}[], color }[]` (closed polygon)
    - `markers: { key, time, shape: 'triangleup'|'triangledown', location: 'belowbar'|'abovebar', color }[]`
    - `bands: { key, t1, t2, color }[]`
    - `order` is the Pine creation order (a running counter), used by `applyPineCaps`.
  - `applyPineCaps(plan): plan`: keep the newest 500 of each of boxes, lines, labels by `order` (Pine deletes the oldest).
  - Keys: `fvg:bull:<bar>`, `ob:bear:<tier>:<bar>`, `tag:major:high:<bar>`, `ray:major:low:<bar>`, `brk:<tier>:<bar>`, `sig:<bar>`, `rsi`.

What to emit (Pine line references; the Pine is the source of truth for colours, text and style):
- FVG/OB zones alive at the last bar (`final.bullFvg` …): box from `left` to last bar (Pine extends `box.set_right` every bar until mitigated), label at `(left, …)` per Pine lines 488-489, 497-498, 613-614, 624-625. Mitigated zones are not drawn.
- Swing tags (1770-1777, skipped outside the anchor range) and rays (1781-1786, clamped, extend right) for the tiers the display flags enable.
- Break events (1790-1799), every entry in `events` of an enabled tier: dotted line `anchorBar(levelBar) → bar` and a `BOS`/`CHoCH` label at `bar`.
- Signal markers (1744-1750): bullish where an `opens` entry at that bar has side `long` (first opener's side wins, PB before TR); bearish where an open is `short`, or `longOnly && series.shortSetup[bar]`.
- RSI readout (213-219): one label at the last bar, `high`, `'RSI ' + fmtNum(rsi, '#.##') + (' OB'|' OS'|'')`.

- [ ] **Step 1: Write the failing tests**

```js
test('only live zones are drawn, from their left edge to the last bar', () => { const p = buildRenderPlan(bars, defaultValues(), ctx); for (const b of p.boxes.filter(b => b.key.startsWith('fvg:'))) assert.equal(b.t2, bars.at(-1).time); });
test('break events persist, rays only for unbroken swings', () => { /* engine events count equals brk lines; every ray swing has broken === false */ });
test('tags outside the anchor range are skipped', () => { /* 6000 synthetic bars; no tag time older than bars[n-5000].time */ });
test('caps keep the newest 500 per type', () => { const p = applyPineCaps({ ...empty, labels: Array.from({ length: 600 }, (_, k) => ({ key: 'l' + k, order: k })) }); assert.equal(p.labels.length, 500); assert.equal(p.labels[0].key, 'l100'); });
test('display flags hide their items', () => { const p = buildRenderPlan(bars, { ...defaultValues(), showFVG: false, showMajorTags: false }, ctx); assert.ok(!p.boxes.some(b => b.key.startsWith('fvg:'))); assert.ok(!p.labels.some(l => l.key.startsWith('tag:'))); });
test('VLMRA daily matches engine trades', { skip: !process.env.ICT_DATA }, () => { /* loadSymbol('VLMRA'); signal markers bars === engine opens bars */ });
```

- [ ] **Step 2: Run to see them fail**: `node --test tools/thndrx/render-plan.test.mjs` → FAIL.

- [ ] **Step 3: Implement `buildRenderPlan` (this task's items only), `applyPineCaps`, and `anchorBar`**

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/render-plan.mjs tools/thndrx/render-plan.test.mjs
git commit -m "feat(thndrx): render plan for zones, structure, signals and RSI readout"
```

---

### Task 6: Render plan — plotted series, Kumo, killzone shading

**Files:**
- Modify: `tools/thndrx/render-plan.mjs`, `tools/thndrx/render-plan.test.mjs`

**Interfaces:**
- Consumes: `res.series` (Task 2).
- Produces: `series` items `ma`, `trail:long:<run>`, `trail:short:<run>`, `avwap:low:<run>`, `avwap:high:<run>`; `fills` items `kumo:<run>`; `bands` items `kz:<name>:<run>`; `futureTime(bars, k, resolution): number`.

What to emit:
- MA (203): orange, width 2, always.
- Trail lines (824-825), only when `showTrailStop`: long line where `trailDir === 1`, short where `-1`, `linebr` = break into runs.
- Anchored VWAP (1031-1032), only when `showAvwap`: aqua and fuchsia, width 2.
- Kumo (785-787), only when `showKumo`: spans A/B shifted forward `ichiDisp` bars (the last `ichiDisp` points use `futureTime`), drawn as two series at 60% transparency plus fill polygons split at every crossing, coloured `kumoBullColor` when A > B else `kumoBearColor`.
- Killzones (637-639): one band per contiguous run of bars in each enabled session, colours at transparency 90. Only when resolution is intraday (on 1D/1W the Pine `time(timeframe.period, session)` is never true for EGX, which the engine already reflects).
- `futureTime`: intraday = last time + k × resolution seconds within the EGX session (10:00-14:30 Cairo, Sun-Thu); daily = next k EGX trading days (skip Fri/Sat); weekly = +7 days each.

- [ ] **Step 1: Write the failing tests**

```js
test('NaN splits a series into runs', () => { /* trail with dir flips gives >1 run, no NaN prices */ });
test('kumo shifts forward by ichiDisp bars', () => { const p = buildRenderPlan(bars, { ...defaultValues(), showKumo: true }, ctx); const a = p.series.find(s => s.key.startsWith('kumoA')); assert.ok(a.points.at(-1).time > bars.at(-1).time); });
test('killzone bands only intraday', () => { assert.equal(buildRenderPlan(daily, defaultValues(), { ...ctx, resolution: '1D' }).bands.length, 0); assert.ok(buildRenderPlan(hourly, defaultValues(), { ...ctx, resolution: '60' }).bands.length > 0); });
test('short history renders without NaN', () => { const p = buildRenderPlan(makeBars(closes30), defaultValues(), ctx); assertNoNaN(p); });
test('zero volume has no NaN text', () => { const p = buildRenderPlan(zeroVolBars, { ...defaultValues(), showAvwap: true }, ctx); assertNoNaN(p); assert.ok(!p.labels.some(l => /NaN/.test(l.text))); });
test('futureTime skips the EGX weekend', () => { /* last bar Thursday; futureTime(.., 1, '1D') is Sunday */ });
```

`assertNoNaN(plan)` walks every numeric field of every item.

- [ ] **Step 2: Run to see them fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**: `node --test tools/thndrx/render-plan.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/render-plan.mjs tools/thndrx/render-plan.test.mjs
git commit -m "feat(thndrx): render plan for MA, trails, VWAP, Kumo and killzones"
```

---

### Task 7: Render plan — live trades and trade history

**Files:**
- Modify: `tools/thndrx/render-plan.mjs`, `tools/thndrx/render-plan.test.mjs`

**Interfaces:**
- Consumes: `res.trades`, `res.final.pbTrade`, `res.final.trTrade` (with `liq1..3`), `series.structAtr`.
- Produces: items keyed `trade:<PB|TR>:<openBar>:box|head|entry|sl|tp1|tp2|tp3` (lines and their `left` labels) and `res:<PB|TR>:<closeIdx>`.

What to emit:
- Live trades (1850-1877), when `showTradeLevels`: box `anchorBar(openBar)` → last bar between `zoneTop`/`zoneBottom` (for TR the engine stores entry and stop there), header label `'LONG · ' | 'SHORT · '` + (`'TRAIL · '` for TR) + grade + `' · score/of'`, and five level lines extending right with `left` labels: `Entry`, `SL` (current `stop`), `TP1..3` text per `targetLabelText` (1838-1842; dotted once hit, `✓` suffix, `· EQH`/`· EQL` when liquid).
- History labels (1897-1907), when `showTradeHistory`: one per closed trade at `closeIdx`, price = exit; text `'+1.2R · Stopped'`, TR adds `' · T · '`; colour green/red at transparency 20; the TR label moves by `1.5 × structAtr[closeIdx]` away when a PB trade closed on the same bar.

- [ ] **Step 1: Write the failing tests**

```js
test('live PB trade draws box, header and five levels', () => { /* bars ending inside an open trade */ const p = ...; for (const s of ['box','head','entry','sl','tp1','tp2','tp3']) assert.ok(keys(p).some(k => k.endsWith(':' + s)), s); });
test('target label text', () => { assert.equal(targetLabelText(1, 12.5, true, true, 10, 1, 1, 0.01), 'TP1 12.50 · 2.5R · EQH ✓'); });
test('history label per closed trade with R and reason', () => { const p = ...; assert.equal(p.labels.filter(l => l.key.startsWith('res:')).length, res.trades.length); });
test('same-bar TR label moves clear of the PB label', () => { /* both close on bar k */ });
```

- [ ] **Step 2: Run to see them fail** → FAIL.
- [ ] **Step 3: Implement; export `targetLabelText(n, price, isLiq, isLong, entry, r, tpHit, mintick)`.**
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/render-plan.mjs tools/thndrx/render-plan.test.mjs
git commit -m "feat(thndrx): render plan for live trade levels and trade history"
```

---

### Task 8: Info panel rows

**Files:**
- Create: `tools/thndrx/panel.mjs`, `tools/thndrx/panel.test.mjs`
- Modify: `tools/thndrx/render-plan.mjs` (sets `plan.panel = buildPanel(...)`)

**Interfaces:**
- Produces: `buildPanel(res, resolved, ctx): { position: 'top_right'|'top_left'|'bottom_right'|'bottom_left', bg, rows: { cells: [Cell, Cell] }[] } | null`, `Cell = { text, color, bg? }`. Null when `showStructurePanel` is off.

Rows follow Pine lines 1911-2091 exactly, in this order with the same row budget: STRUCTURE header, Major trend, Range, Last event, Internal; Confirm (if `showConfirmPanel`); Gate (if `showGatePanel`; text `L|S · reason · score/of` + `' · T:L|S'` when the trail model is on; reason `'bar not closed'` replaces `'READY'` when `ctx.lastBarOpen`); TRADE block (6 rows) per live slot; PERFORMANCE block per enabled model (7 rows, or 2 before the first close; header gets `presetTag`); POINTS blocks when `showPointStats`. Stats come from `res.trades` split by `model`: wins `r > 0`, losses `r < 0`, grade counts/sums, point true/false counts/sums from the `kz, mom, ma, maj, brk, part, ichi` fields. Open R uses the last close (`openRof`, 1726-1732). Add one extra row, `Data`, at the bottom, holding `meta.warnings` (history incomplete, index filter unavailable, HTF bias without enough bars), only when there are warnings.

- [ ] **Step 1: Write the failing tests**

```js
test('row budget with defaults and no trades', () => { const p = buildPanel(resNoTrades, resolved, ctx); assert.deepEqual(p.rows.map(r => r.cells[0].text), ['STRUCTURE','Major trend','Range','Last event','Internal','Confirm','Gate','PERFORMANCE','No closed trades']); });
test('EGX Daily tags the header', () => { assert.equal(rowsOf(egxPanel)[7], 'PERFORMANCE · EGX DAILY'); });
test('bar not closed replaces READY on a forming bar', () => { /* gate.reason READY, ctx.lastBarOpen true */ });
test('stats from trades', () => { /* 3 PB trades r = 1, -1, 0 -> n = 3, 1W / 1L, Total R +0.00R */ });
test('VLMRA EGX Daily panel numbers', { skip: !process.env.ICT_DATA }, () => { /* n and Total R equal summarize(res.trades, t => t.model === 'PB') */ });
```

- [ ] **Step 2: Run to see them fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**: `node --test tools/thndrx/panel.test.mjs tools/thndrx/render-plan.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/panel.mjs tools/thndrx/panel.test.mjs tools/thndrx/render-plan.mjs
git commit -m "feat(thndrx): info panel rows matching the Pine table"
```

---

### Task 9: Parity against the Pine on TradingView (daily and intraday)

Proves the Node core equals the Pine before anything is painted on ThndrX.

**Files:**
- Modify: `tools/backtest/fetch-egx.mjs` (new `--interval <tf>` flag, default `1D`; output dir unchanged)
- Create: `tools/thndrx/parity.mjs`, `docs/superpowers/plans/2026-11-24-thndrx-parity-results.md`

**Interfaces:**
- Produces: `node tools/thndrx/parity.mjs --data <dir> --symbol <SYM> --tf <tf> [--values '<json>'] [--log <pine-log.csv>]`, printing the panel rows and, with `--log`, a trade-by-trade diff in the format of `compare-log.mjs`.

- [ ] **Step 1: Add `--interval`** to `fetch-egx.mjs` (passed to `create_series` in place of `'1D'`) and fetch `ADJ=dividends` bars for COMI, TMGH, VLMRA, SWDY at `1D` and `60`.

- [ ] **Step 2: Write `parity.mjs`** (loads bars with `loadCsv`, runs `buildRenderPlan`, prints `plan.panel` rows and counts of each item kind, and diffs trades against a Pine Logs CSV when given).

- [ ] **Step 3: TradingView pass with Playwright** (memory: *Pine has no test framework*: Autosave off first, indicator cap, Pine Logs download). For each symbol × {1D, 60} × {Custom defaults, EGX Daily}: read the panel rows, download Pine logs with `Log Closed Trades` on, screenshot the chart.

- [ ] **Step 4: Compare and record**

Run `parity.mjs` for each case with `--log`. Pass = every trade matches, and every panel row matches except where the TradingView history depth differs (recorded with both depths). Also confirm the colour hex values and `fmtNum` edge cases from Task 4 against what TradingView renders, and fix them in `colors.mjs` / `format.mjs` if they differ. Write the results file with a table per case.

- [ ] **Step 5: Commit**

```bash
git add tools/backtest/fetch-egx.mjs tools/thndrx/parity.mjs docs/superpowers/plans/2026-11-24-thndrx-parity-results.md
git commit -m "test(thndrx): render plan parity against the Pine on daily and 60m"
```

---

### Task 10: Painter with diffing over a chart port

**Files:**
- Create: `tools/thndrx/painter.mjs`, `tools/thndrx/painter.test.mjs`

**Interfaces:**
- Consumes: `RenderPlan` (Tasks 5-8); the shape table from the recon notes (Task 1).
- Produces:
  - `ChartPort = { createShape(point, options): Promise<id>, createMultipointShape(points, options): Promise<id>, removeEntity(id): void }`
  - `toShapeCalls(item, kind): { multi: boolean, points: {time, price}[], options }`: maps one plan item to one call using the recon table; every `options` includes `disableSave: true, disableUndo: true, lock: true, disableSelection: true`.
  - `class Painter { constructor(port); begin(): number /* new token */; async apply(plan, token): Promise<{ created, removed, kept } | 'stale'>; async clear(): Promise<void> }`. Items are compared by `key` plus a hash of their drawn fields; unchanged items are kept, changed ones removed and recreated, vanished ones removed. `apply` with a token older than the latest `begin()` stops and returns `'stale'` before creating anything more, and removes what it already created for that token.

- [ ] **Step 1: Write the failing tests (FakePort records calls and hands out ids)**

```js
test('every call disables saving', () => { /* apply a plan with one item of every kind */ assert.ok(port.calls.every(c => c.options.disableSave === true && c.options.disableUndo === true)); });
test('second identical apply creates nothing', async () => { await painter.apply(plan, painter.begin()); const r = await painter.apply(plan, painter.begin()); assert.deepEqual([r.created, r.removed], [0, 0]); });
test('changed item is recreated, vanished item removed', async () => { /* move one label, drop one box */ });
test('stale token is discarded', async () => { const t1 = painter.begin(); const p = painter.apply(bigPlan, t1); painter.begin(); assert.equal(await p, 'stale'); assert.equal(port.live().size, 0); });
test('foreign entities untouched', async () => { port.seedForeign('user-1'); await painter.apply(plan, painter.begin()); await painter.clear(); assert.ok(port.live().has('user-1')); });
```

- [ ] **Step 2: Run to see them fail**: `node --test tools/thndrx/painter.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/painter.mjs tools/thndrx/painter.test.mjs
git commit -m "feat(thndrx): diffing painter that only touches its own unsaved drawings"
```

---

### Task 11: ThndrX chart port, scheduler, panel and settings UI, build

**Files:**
- Create: `tools/thndrx/chart-port.mjs`, `tools/thndrx/ui.mjs`, `tools/thndrx/main.mjs`, `tools/thndrx/build.mjs`, `tools/thndrx/build.test.mjs`, `tools/thndrx/dist/thndrx-ict.user.js` (generated, committed)

**Interfaces:**
- Consumes: recon notes (Task 1), `buildRenderPlan`, `Painter`, `loadValues/saveValues`, `INPUTS`.
- Produces:
  - `chart-port.mjs`: `findChart(win, timeoutMs = 60000): Promise<{ api, chart, iframe }>`; `loadAllBars(chart): Promise<{ bars, complete }>` (history back to the series start by the recon method; `bars` in the engine shape `{ time, date, open, high, low, close, volume }`, `date` = Cairo `YYYY-MM-DD`); `chartInfo(chart): { symbol, mintick, resolution }`; `isLastBarOpen(bars, resolution, now): boolean` (EGX session 10:00-14:30 Cairo; intraday: bar end > now); `subscribe(chart, { onReload, onTick }): () => void`; `makePort(chart): ChartPort`.
  - `ui.mjs`: `renderPanel(doc, panel)` (one absolutely positioned table inside the iframe document, Pine colours, `position` corner), `mountButton(doc, onClick)`, `openSettings(doc, values, onSave)` (groups and fields from `INPUTS`, tooltips as `title`, `unavailable` inputs disabled with their note, Save / Cancel / Reset to defaults).
  - `main.mjs`: `start(win = window)`: find chart → load bars → plan → paint → panel; `onReload` (symbol/interval change) = `painter.begin()` + full reload; `onTick` = recompute at most every 2 s when the last bar's OHLC changed; settings save = recompute.
  - `build.mjs`: `node tools/thndrx/build.mjs` writes `tools/thndrx/dist/thndrx-ict.user.js`: Tampermonkey header (`@name ThndrX ICT + RSI/MA Confluence`, `@match https://x.thndr.app/*`, `@grant none`, `@run-at document-idle`, `@version` from `tools/thndrx/VERSION`), then the modules in dependency order (`ict-engine`, `colors`, `format`, `inputs`, `htf`, `panel`, `render-plan`, `painter`, `chart-port`, `ui`, `main`) with `import` lines removed and `export ` stripped, inside one IIFE that calls `start()`.

- [ ] **Step 1: Write the failing build test**

```js
test('bundle has the header, no imports and starts', () => {
  execFileSync(process.execPath, ['tools/thndrx/build.mjs']);
  const js = fs.readFileSync('tools/thndrx/dist/thndrx-ict.user.js', 'utf8');
  assert.match(js, /@match\s+https:\/\/x\.thndr\.app\/\*/); assert.doesNotMatch(js, /^\s*(import|export)\s/m);
  new Function(js.replace(/start\(\);\s*\}\)\(\);\s*$/, '})();')); // parses
});
```

- [ ] **Step 2: Run to see it fail**: `node --test tools/thndrx/build.test.mjs` → FAIL.
- [ ] **Step 3: Implement the four modules and `VERSION` (`0.1.0`).**
- [ ] **Step 4: Run all tests**: `node --test tools/thndrx/ tools/backtest/ict-engine.test.mjs tools/backtest/scan-core.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/thndrx/
git commit -m "feat(thndrx): chart port, panel and settings UI, userscript build"
```

---

### Task 12: Live verification on ThndrX and docs

**Files:**
- Create: `tools/thndrx/README.md`, `docs/superpowers/plans/2026-11-24-thndrx-live-results.md`
- Modify: `README.md`, `README.ar.md` (a "ThndrX overlay" section: what it is, install in Tampermonkey from `tools/thndrx/dist/thndrx-ict.user.js`, daily + intraday, what is unavailable, that nothing is saved to Thndr)

- [ ] **Step 1: Inject the bundle into the logged-in Playwright session** (`browser_evaluate` with the file contents, or `browser_run_code_unsafe` with `addInitScript`; the user logs in if the session expired).

- [ ] **Step 2: Check on COMI and VLMRA, 1D and 60m, with defaults and EGX Daily**

Pass = drawings appear and follow scroll and zoom; the panel rows equal the TradingView panel rows from Task 9 for the same symbol, time frame and settings (or the difference is explained by history depth or Thndr's data, recorded); symbol and time-frame switches leave no stale drawings; settings save and survive a reload.

- [ ] **Step 3: Nothing saved**: wait 15 s after drawing, reload **without** the script. Pass = none of our drawings are present.

- [ ] **Step 4: Thndr vs TradingView data**: for the four Task 9 symbols on 1D, export ThndrX bars (`exportData`) and diff against the TradingView CSVs: count bars, closes differing > 0.5%, dates of the differences, and the trades that differ because of them. Record in the live-results file.

- [ ] **Step 5: Write the READMEs and commit**

```bash
git add tools/thndrx/README.md README.md README.ar.md docs/superpowers/plans/2026-11-24-thndrx-live-results.md
git commit -m "docs(thndrx): install and use the ThndrX overlay; live verification results"
```
