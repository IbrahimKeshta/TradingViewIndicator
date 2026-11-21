# EGX Trust Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Pine v6 indicator for EGX stocks. It maps each stock to EGX30 or EGX70, gates long dip-in-uptrend entries on that index's regime, scores each entry with a two-part trust score, and measures itself on Tuning vs Test periods so it can be validated against a pre-declared 80% out-of-sample bar.

**Architecture:** One file, `src/egx-trust-indicator.pine`, built top to bottom in seven sections: inputs → index map → index regime → stock trend → setup/confirmation/score → trade engine/stats → panel/plots/alerts. It does not share state with `src/ict-rsi-ma-indicator.pine`.

**Tech Stack:** Pine Script v6 (TradingView). No compiler or test runner exists outside TradingView, so each code task ends in a static read-back. The controller then compiles and checks the script live in TradingView through the Playwright MCP browser.

**Spec:** `docs/superpowers/specs/2026-11-02-egx-trust-indicator-design.md`

## Global Constraints

- Pine v6, `indicator(..., overlay = true)`; never `strategy()`.
- Long only. No shorts anywhere.
- Index symbols: `EGX_DLY:EGX30` and `EGX_DLY:EGX70EWI`. EGX stocks resolve under the `EGX_DLY` prefix.
- Constituent lists were fetched from egx.com.eg on 2026-11-02. The EGX30 page reads "Last Update Date: 01/11/2026". `LIST_DATE = "2026-11-01"`.
- Every `ta.*` call sits at unconditional global scope ([[pine-v6-gotchas]]).
- UDT fields that change after construction are mutated **only inside functions that receive the object**, never by top-level `:=`. Fields carry no default values; all values go through `Trade.new(...)` positionally.
- No `for i = a to b` loop where `b` can be below `a`. No array access guarded only by `and`.
- Use the number format `"0.00"`, never `"#.00"`.
- Stay well under 64 plots (target ≤ 20).
- Costs default to 0.1% slippage per side and 2 EGP per order. Default position size for converting commission to R is 100,000 EGP.
- Same-bar stop and T1 → stop first (loss). A gap through a level fills at the open.
- README.md and README.ar.md change in the same branch as the code ([[keep-readme-updated]]).
- Never claim a compile happened unless TradingView actually ran the script.

## Review Focus

1. **Symbol in neither list, or a non-EGX symbol.** It must fall back to EGX30, read `Unlisted` in STATUS, and never error. Owner: Task 1 (live check on `NASDAQ:AAPL`).
2. **Short history** (monthly chart, or a recent listing like EFIH). The 200-bar gate is skipped and flagged; a regime with no data (`na`) blocks entries and reads `No data`; nothing crashes. Owner: Task 1 (live check on the monthly timeframe).
3. **Tiny split-adjusted prices**, where the whole risk sits inside a tick. The risk floor `max(0.5 ATR, 10 ticks)` must apply, so R never divides by a near-zero risk. Owner: Task 3 (check on MASR or ELEC daily).
4. **Gaps through stop or T1.** Fill at the open (worse for a stop, better for a target), never at the level price. Owner: Task 3 (read-back step).
5. **No volume data**, e.g. on an index chart. The liquidity gate stays closed, STATUS says `no volume`, and there are no trades. Owner: Task 1 (live check on `EGX_DLY:EGX30`).

---

### Task 1: Skeleton, inputs, index map, regime, stock trend, STATUS panel

**Files:**
- Create: `src/egx-trust-indicator.pine`

**Interfaces:**
- Produces (globals later tasks rely on): `indexName` (simple string "EGX30"|"EGX70"), `indexHow` ("Auto"|"Override"|"Unlisted"), `indexSym`, `regime` (int: 1 Up, 0 Neutral, -1 Down, `na` no data), `idxClose`, `atr`, `smaLong`, `smaMid`, `sma20`, `rsi`, `volAvg`, `valueTraded`, `rsAbove`, `rsRising`, `longKnown`, `trendBreak`, `gateRegime`, `gateTrend`, `gateLiq`, `gatesOpen`, `lastSwingLow`, `lastSwingHigh`, `lastSwingLowBar`, `lastSwingHighBar`, every input variable named below, `panel` (table), `panelPos()`.
- The file ends with a section marker comment for each later task. Later tasks insert code at their marker:
  `// @@SETUP@@`, `// @@ENGINE@@`, `// @@OUTPUT@@`.

- [ ] **Step 1: Create the file with this exact content**

```pine
//@version=6
indicator("EGX Trust Score", shorttitle = "EGX-TRUST", overlay = true, max_labels_count = 500)

// ============================================================
// INPUTS
// ============================================================

// ---------------- Index ----------------
indexMode = input.string("Auto", "Index", options = ["Auto", "EGX30", "EGX70"], group = "Index", tooltip = "Auto looks the stock up in the built-in constituent lists (date in the STATUS panel). Pick EGX30 or EGX70 to override when the lists are stale after a rebalance. A stock in neither list falls back to EGX30 and reads Unlisted.")
regimeLen = input.int(50, "Index MA Length", minval = 2, group = "Index")
slopeLen  = input.int(10, "Slope Lookback (bars)", minval = 1, group = "Index", tooltip = "An average counts as rising when it is above its own value this many bars ago. Shared by the index regime and the relative-strength trend.")

// ---------------- Stock Trend ----------------
longLen        = input.int(200, "Long MA Length", minval = 2, group = "Stock Trend")
midLen         = input.int(50, "Medium MA Length", minval = 2, group = "Stock Trend")
rsLen          = input.int(50, "Relative Strength MA Length", minval = 2, group = "Stock Trend")
minValueTraded = input.float(2000000, "Min Avg Value Traded (EGP)", minval = 0, step = 100000, group = "Stock Trend", tooltip = "20-bar average of close x volume, per bar. Setups below it are ignored: thin EGX70 names do not fill anywhere near their chart prices.")

// ---------------- Setup ----------------
rsiLen       = input.int(2, "RSI Length", minval = 1, group = "Setup")
rsiThreshold = input.float(10, "RSI Oversold Below", minval = 1, maxval = 50, group = "Setup")
confirmBars  = input.int(3, "Confirmation Window (bars)", minval = 1, group = "Setup", tooltip = "A confirmation candle must close within this many bars of the most recent oversold bar.")
setupExpiry  = input.int(5, "Setup Expiry (bars)", minval = 1, group = "Setup", tooltip = "Hard cap counted from the first oversold bar. Repeated oversold bars refresh the confirmation window but cannot keep a setup alive past this.")
cancelAtr    = input.float(0.5, "Cancel Below Setup Low (x ATR)", minval = 0, step = 0.1, group = "Setup", tooltip = "A close this far below the latest oversold bar's low cancels the setup.")
swingLen     = input.int(5, "Swing Pivot Length", minval = 1, group = "Setup", tooltip = "Bars either side for the swing lows and highs used as support and for the retracement zone.")

// ---------------- Trade ----------------
atrLen       = input.int(14, "ATR Length", minval = 1, group = "Trade")
stopBufAtr   = input.float(0.25, "Stop Buffer (x ATR)", minval = 0, step = 0.05, group = "Trade")
minRiskAtr   = input.float(0.5, "Min Risk (x ATR)", minval = 0, step = 0.1, group = "Trade")
minRiskTicks = input.int(10, "Min Risk (ticks)", minval = 0, group = "Trade", tooltip = "Split-adjusted EGX history can put a whole stop inside one tick. The risk floor is the larger of this and Min Risk (x ATR).")
maxRiskAtr   = input.float(3.0, "Max Risk (x ATR)", minval = 0.1, step = 0.1, group = "Trade", tooltip = "Setups whose stop would sit further than this are skipped, not taken with a wide stop.")
t1R          = input.float(0.75, "Target 1 (R)", minval = 0.1, step = 0.05, group = "Trade", tooltip = "Half the position exits here and the stop moves to breakeven. A trade counts as a win when it reaches Target 1 before any exit.")
trailAtr     = input.float(2.5, "Trail (x ATR)", minval = 0.1, step = 0.1, group = "Trade", tooltip = "Chandelier trail for the second half: highest high since entry minus this many ATR, never below breakeven.")
timeStopBars = input.int(20, "Time Stop (bars)", minval = 1, group = "Trade", tooltip = "A trade that has not reached Target 1 after this many bars exits at the close.")

// ---------------- Costs ----------------
slippagePct   = input.float(0.1, "Slippage per Side (%)", minval = 0, step = 0.05, group = "Costs")
commissionEgp = input.float(2.0, "Commission per Order (EGP)", minval = 0, step = 0.5, group = "Costs")
positionEgp   = input.float(100000, "Position Size (EGP)", minval = 1, step = 10000, group = "Costs", tooltip = "Only used to convert the per-order commission into R.")

// ---------------- Trust Score ----------------
useFIndex   = input.bool(true, "Score: Index Regime", group = "Trust Score")
useFTrend   = input.bool(true, "Score: Stock Trend", group = "Trust Score")
useFRs      = input.bool(true, "Score: Relative Strength", group = "Trust Score")
useFSupport = input.bool(true, "Score: Support Location", group = "Trust Score")
useFPart    = input.bool(true, "Score: Participation", group = "Trust Score")
useFConf    = input.bool(true, "Score: Confirmation Strength", group = "Trust Score")
minHistory  = input.int(10, "Track Record Minimum Trades", minval = 1, group = "Trust Score", tooltip = "Below this many closed trades in a band, the entry label says 'building history' instead of quoting a win rate.")

// ---------------- Validation ----------------
testStart = input.time(timestamp("01 Jan 2024 00:00 +0200"), "Test Start", group = "Validation", tooltip = "Trades entered before this time count under Tuning, from it onward under Test. Tune settings by the Tuning column only.")

// ---------------- Display ----------------
showPanel  = input.bool(true, "Show Panel", group = "Display")
panelPosIn = input.string("Top Right", "Panel Position", options = ["Top Right", "Bottom Right", "Top Left", "Bottom Left"], group = "Display")
showLabels = input.bool(true, "Show Trade Labels", group = "Display")
logTrades  = input.bool(false, "Log Trades", group = "Display", tooltip = "Writes one CSV line per closed trade to Pine Logs. Pine Logs only work on a personal, unpublished copy of the script.")

// ============================================================
// INDEX MAP
// ============================================================
// Pine cannot fetch index membership, so the constituents live here and go stale at every
// semi-annual EGX rebalance. Refresh both strings from egx.com.eg (Current Constituents for
// EGX 30 and EGX 70 EWI) and bump LIST_DATE together. The commas on both ends make the
// substring test exact: ",VLMR," cannot match inside ",VLMRA,".
LIST_DATE  = "2026-11-01"
EGX30_LIST = ",ABUK,ADIB,ALCN,AMOC,BTFH,CLHO,COMI,EAST,EFID,HRHO,EFIH,EGAL,EMFD,FWRY,GBCO,HELI,ISPH,JUFO,MCQE,MFPC,ORAS,ORHD,PHDC,CCAP,RAYA,SKPC,TMGH,ETEL,RMDA,VLMR,VLMRA,"
EGX70_LIST = ",ACTF,ATLC,AMER,ARAB,AMIA,AIDC,AIHC,ARCC,ASCM,ASPI,AIFI,BONY,COSG,POUL,CSAG,PRCL,CNFN,CIEB,DAPH,DSCW,EGCH,EGTS,PHAR,MPRC,ETRS,EHDR,ELKA,KABO,OBRI,ELSH,ELEC,NIPH,UEGC,SWDY,ENGC,EXPA,ZEOT,GDWA,GOUR,GPIM,HDBK,IEEC,ICFC,ISMQ,IDRE,ISMA,LCSW,MCRO,MASR,MPCO,MEPA,MPCI,MBSC,ATQA,MTIE,NCCW,OFH,OIH,ORWE,PRDC,SIPC,SDTI,SCEM,OCDI,SVCE,TAQA,MOED,VALU,UNIP,ZMID,"

tickerKey = "," + syminfo.ticker + ","
inEgx30   = str.contains(EGX30_LIST, tickerKey)
inEgx70   = str.contains(EGX70_LIST, tickerKey)
indexName = indexMode != "Auto" ? indexMode : inEgx70 and not inEgx30 ? "EGX70" : "EGX30"
indexHow  = indexMode != "Auto" ? "Override" : inEgx30 or inEgx70 ? "Auto" : "Unlisted"
indexSym  = indexName == "EGX70" ? "EGX_DLY:EGX70EWI" : "EGX_DLY:EGX30"

// ============================================================
// INDEX REGIME
// ============================================================
// Same timeframe as the chart, no lookahead: on a historical bar the index value is the one
// that bar could actually have seen.
[idxClose, idxMa, idxMaPast] = request.security(indexSym, timeframe.period, [close, ta.sma(close, regimeLen), ta.sma(close, regimeLen)[slopeLen]], lookahead = barmerge.lookahead_off)

int regime = na(idxMa) or na(idxMaPast) or na(idxClose) ? na : idxClose > idxMa and idxMa > idxMaPast ? 1 : idxClose < idxMa and idxMa < idxMaPast ? -1 : 0

// ============================================================
// STOCK TREND
// ============================================================
atr         = ta.atr(atrLen)
smaLong     = ta.sma(close, longLen)
smaMid      = ta.sma(close, midLen)
sma20       = ta.sma(close, 20)
rsi         = ta.rsi(close, rsiLen)
volAvg      = ta.sma(volume, 20)
valueTraded = ta.sma(close * volume, 20)
rsRatio     = close / idxClose
rsMa        = ta.sma(rsRatio, rsLen)
rsAbove     = not na(rsMa) and rsRatio > rsMa
rsRising    = not na(rsMa[slopeLen]) and rsMa > rsMa[slopeLen]
longKnown   = not na(smaLong)
trendBreak  = ta.crossunder(close, smaMid)

// A regime with no data blocks entries rather than passing as "not Down".
gateRegime = not na(regime) and regime != -1
gateTrend  = longKnown ? close > smaLong : true
gateLiq    = not na(valueTraded) and valueTraded >= minValueTraded
gatesOpen  = gateRegime and gateTrend and gateLiq

pl = ta.pivotlow(low, swingLen, swingLen)
ph = ta.pivothigh(high, swingLen, swingLen)
var float lastSwingLow     = na
var float lastSwingHigh    = na
var int   lastSwingLowBar  = na
var int   lastSwingHighBar = na
if not na(pl)
    lastSwingLow    := pl
    lastSwingLowBar := bar_index - swingLen
if not na(ph)
    lastSwingHigh    := ph
    lastSwingHighBar := bar_index - swingLen

// @@SETUP@@

// @@ENGINE@@

// ============================================================
// PANEL
// ============================================================
panelPos() =>
    switch panelPosIn
        "Bottom Right" => position.bottom_right
        "Top Left"     => position.top_left
        "Bottom Left"  => position.bottom_left
        => position.top_right

PANEL_ROWS = 16
var table panel = showPanel ? table.new(panelPos(), 3, PANEL_ROWS, bgcolor = color.new(color.black, 15), border_width = 1) : na

cellStatus(int row, string key, string val, color valColor) =>
    table.cell(panel, 0, row, key, text_color = color.silver, text_size = size.small, text_halign = text.align_left)
    table.cell(panel, 1, row, val, text_color = valColor, text_size = size.small, text_halign = text.align_left)
    table.merge_cells(panel, 1, row, 2, row)

regimeText(int r) =>
    na(r) ? "No data" : r == 1 ? "Up" : r == -1 ? "Down" : "Neutral"

regimeColor(int r) =>
    na(r) ? color.gray : r == 1 ? color.lime : r == -1 ? color.red : color.yellow

if showPanel and barstate.islast
    table.cell(panel, 0, 0, "EGX TRUST", text_color = color.white, text_size = size.small, text_halign = text.align_left)
    table.cell(panel, 1, 0, "lists " + LIST_DATE, text_color = color.gray, text_size = size.tiny, text_halign = text.align_left)
    table.merge_cells(panel, 1, 0, 2, 0)
    cellStatus(1, "Index", indexName + " (" + indexHow + ")", indexHow == "Unlisted" ? color.orange : color.white)
    cellStatus(2, "Regime", regimeText(regime), regimeColor(regime))
    cellStatus(3, "Trend gate", longKnown ? (gateTrend ? "Above " + str.tostring(longLen) + " MA" : "Below " + str.tostring(longLen) + " MA") : "skipped (<" + str.tostring(longLen) + " bars)", longKnown ? (gateTrend ? color.lime : color.red) : color.orange)
    cellStatus(4, "Liquidity", na(valueTraded) or valueTraded == 0 ? "no volume" : str.tostring(valueTraded / 1000000, "0.0") + "M EGP/bar", gateLiq ? color.lime : color.red)

// @@OUTPUT@@

// ============================================================
// DATA WINDOW (verification readouts)
// ============================================================
plot(idxClose, "DBG Index Close", display = display.data_window)
plot(idxMa, "DBG Index MA", display = display.data_window)
plot(nz(regime, -9), "DBG Regime (1 Up, 0 Neutral, -1 Down, -9 none)", display = display.data_window)
plot(gatesOpen ? 1 : 0, "DBG Gates Open", display = display.data_window)
```

- [ ] **Step 2: Static read-back**

Read the whole file top to bottom and confirm, writing each answer down:

1. Every `ta.*` call (atr, sma ×5, rsi, crossunder, pivotlow, pivothigh, and the sma inside `request.security`) is at global scope, outside any `if` or function.
2. `indexSym` is built only from an input, a const string and `syminfo.ticker`, so it is a `simple string`. `request.security` accepts it.
3. `regime` is `na` whenever any of the three index values is `na`.
4. `gateRegime` is false when `regime` is `na`.
5. The three section markers `// @@SETUP@@`, `// @@ENGINE@@`, `// @@OUTPUT@@` are present, each on its own line.
6. Count the tickers in each list: EGX30_LIST has 31 entries (30 companies, Valmore has two lines) and EGX70_LIST has 70. Count the commas with PowerShell:
   `((Select-String -Path src/egx-trust-indicator.pine -Pattern '^EGX30_LIST').Line.Split(',').Count - 2)` should print `31`. The same command with `^EGX70_LIST` should print `70`. (Splitting `X = ",A,B,"` gives the leading `X = "` piece, the tickers, then the closing `"` piece, so subtract 2.)

- [ ] **Step 3: Commit**

```bash
git add src/egx-trust-indicator.pine
git commit -m "feat: add EGX trust indicator skeleton with index map, regime and gates"
```

- [ ] **Step 4 (controller, browser): live compile and checks**

Paste the file into the Pine Editor using the [[pine-has-no-test-framework]] recipe and click Add to chart. Expected:
- It compiles; `EGX-TRUST` appears in the legend; no runtime error.
- `EGX_DLY:COMI` 1D: STATUS shows `EGX30 (Auto)`.
- `EGX_DLY:ORWE` 1D: STATUS shows `EGX70 (Auto)`.
- `NASDAQ:AAPL` 1D: STATUS shows `EGX30 (Unlisted)` in orange, with no error.
- `EGX_DLY:EGX30` 1D: Liquidity reads `no volume` or fails the gate; `DBG Gates Open` = 0.
- `EGX_DLY:COMI` 1M: either the trend gate reads `skipped (<200 bars)` or the regime reads a value; no error.
- External reference: on `EGX_DLY:COMI` 1D, hover a bar and read `DBG Index Close` in the Data Window. Switch to `EGX_DLY:EGX30` and check that the same date's close matches.

Fix any compile error in the source, commit `fix: …`, and repeat.

---

### Task 2: Setup detector, confirmation, trust score factors

**Files:**
- Modify: `src/egx-trust-indicator.pine`. Replace the line `// @@SETUP@@` with the block below. Task 3 inserts at `// @@ENGINE@@`.

**Interfaces:**
- Consumes: every Task 1 global.
- Produces:
  - `confirmed` (bool), `strongConfirm` (bool)
  - `supportCount(float lvl) => int`
  - `factorSet(float lowRef, float pbVolAvg) => [float score, int band, string flags]`
  - `bandName(int band) => string`
  - setup state vars: `setupActive`, `setupStartBar`, `lastOversoldBar`, `setupLow`, `setupBarLow`, `setupVolSum`, `setupVolN`
  - functions `startSetup()` and `stepSetup() => bool` (true when this bar's confirmation qualifies for entry). Both mutate the setup state through a single `var` UDT `SetupState ss` passed by reference, so no global scalar is reassigned inside a function.

- [ ] **Step 1: Insert this block at `// @@SETUP@@`**

```pine
// ============================================================
// SETUP, CONFIRMATION, TRUST SCORE
// ============================================================
// Confirmation candles. The setup bar itself never confirms (see stepSetup): an RSI(2) dip
// bar that also closes above the prior high is a contradiction in practice, and allowing it
// would let one bar be both the dip and the turn.
barRange      = high - low
bodySize      = math.abs(close - open)
lowerWick     = math.min(open, close) - low
closeAbovePrv = close > high[1]
bullEngulf    = close > open and close[1] < open[1] and open <= close[1] and close >= open[1]
hammer        = barRange > 0 and lowerWick > 0 and lowerWick >= 2 * bodySize and close >= low + barRange * 2.0 / 3.0
confirmed     = closeAbovePrv or bullEngulf or hammer
strongConfirm = bullEngulf or (barRange > 0 and close >= high - 0.25 * barRange)

// Supports within 1 ATR of the pullback low. Each kind counts once: the last confirmed swing
// low, SMA(20), SMA(50), and the 38.2-61.8% retracement of the last swing up.
supportCount(float lvl) =>
    int n = 0
    if not na(lastSwingLow) and math.abs(lvl - lastSwingLow) <= atr
        n += 1
    if not na(sma20) and math.abs(lvl - sma20) <= atr
        n += 1
    if not na(smaMid) and math.abs(lvl - smaMid) <= atr
        n += 1
    if not na(lastSwingLow) and not na(lastSwingHigh) and not na(lastSwingLowBar) and not na(lastSwingHighBar)
        if lastSwingHighBar > lastSwingLowBar and lastSwingHigh > lastSwingLow
            swingRange = lastSwingHigh - lastSwingLow
            zoneTop    = lastSwingHigh - 0.382 * swingRange
            zoneBottom = lastSwingHigh - 0.618 * swingRange
            dist       = lvl > zoneTop ? lvl - zoneTop : lvl < zoneBottom ? zoneBottom - lvl : 0.0
            if dist <= atr
                n += 1
    n

bandName(int band) =>
    band == 2 ? "High" : band == 1 ? "Mid" : "Low"

// Six independent factor groups, equal weight, never fitted. A factor that proves
// anti-predictive on the tuning set is switched off with its input, not re-weighted.
factorSet(float lowRef, float pbVolAvg) =>
    float fIndex = regime == 1 ? 1.0 : regime == 0 ? 0.5 : 0.0
    float fTrend = longKnown ? (close > smaMid and smaMid > smaLong ? 1.0 : close > smaLong ? 0.5 : 0.0) : (close > smaMid ? 0.5 : 0.0)
    float fRs    = rsAbove and rsRising ? 1.0 : rsAbove ? 0.5 : 0.0
    int   nSup   = supportCount(lowRef)
    float fSup   = nSup >= 2 ? 1.0 : nSup == 1 ? 0.5 : 0.0
    bool  pbLow  = not na(pbVolAvg) and not na(volAvg) and pbVolAvg < volAvg
    bool  cfHigh = not na(volAvg) and volume > volAvg
    float fPart  = pbLow and cfHigh ? 1.0 : pbLow or cfHigh ? 0.5 : 0.0
    float fConf  = strongConfirm ? 1.0 : 0.5
    float total  = (useFIndex ? fIndex : 0.0) + (useFTrend ? fTrend : 0.0) + (useFRs ? fRs : 0.0) + (useFSupport ? fSup : 0.0) + (useFPart ? fPart : 0.0) + (useFConf ? fConf : 0.0)
    int   nOn    = (useFIndex ? 1 : 0) + (useFTrend ? 1 : 0) + (useFRs ? 1 : 0) + (useFSupport ? 1 : 0) + (useFPart ? 1 : 0) + (useFConf ? 1 : 0)
    float score  = nOn > 0 ? 100.0 * total / nOn : 0.0
    int   band   = score >= 75 ? 2 : score >= 50 ? 1 : 0
    string flags = "I" + str.tostring(fIndex, "0.0") + " T" + str.tostring(fTrend, "0.0") + " R" + str.tostring(fRs, "0.0") + " S" + str.tostring(fSup, "0.0") + " P" + str.tostring(fPart, "0.0") + " C" + str.tostring(fConf, "0.0")
    [score, band, flags]

// Setup state lives in one UDT so functions can mutate it by reference.
type SetupState
    bool  active
    int   startBar
    int   lastOversoldBar
    float lowest
    float oversoldLow
    float volSum
    int   volN

var SetupState ss = SetupState.new(false, na, na, na, na, 0.0, 0)

startSetup(SetupState s) =>
    s.active          := true
    s.startBar        := bar_index
    s.lastOversoldBar := bar_index
    s.lowest          := low
    s.oversoldLow     := low
    s.volSum          := volume
    s.volN            := 1
    s.active

clearSetup(SetupState s) =>
    s.active := false
    s.volSum := 0.0
    s.volN   := 0
    s.active

// Advances an armed setup by one bar. Returns true when this bar's close is a qualifying
// confirmation; the caller decides whether a trade can actually open (risk cap, open trade).
stepSetup(SetupState s) =>
    bool fire = false
    s.lowest := math.min(s.lowest, low)
    if rsi < rsiThreshold
        s.lastOversoldBar := bar_index
        s.oversoldLow     := low
    bool expired  = bar_index - s.startBar > setupExpiry
    bool canceled = close < s.oversoldLow - cancelAtr * atr
    int  sinceOs  = bar_index - s.lastOversoldBar
    bool inWindow = sinceOs >= 1 and sinceOs <= confirmBars
    if expired or canceled or not gateRegime or not gateLiq
        clearSetup(s)
    else if inWindow and confirmed
        fire := true
    else
        s.volSum += volume
        s.volN   += 1
    fire
```

After this step only `// @@ENGINE@@` and `// @@OUTPUT@@` remain as markers.

- [ ] **Step 2: Static read-back**

Confirm and write down:
1. No `ta.*` call was added inside a function. `high[1]`, `close[1]` and `open[1]` are history references, not `ta.*`; they're fine at global scope.
2. Only `stepSetup` adds the confirmation bar's volume, and only when the bar doesn't fire. So `volSum / volN` averages the pullback bars and excludes the confirmation bar.
3. `startSetup`, `clearSetup` and `stepSetup` each end in an expression line (`s.active` or `fire`).
4. `SetupState` fields have no default values. `ss` is built with every field passed positionally.
5. Worked example by hand: bars 0..4 with RSI(2) = 8, 6, 30, 40, 45; bar 2 closes above bar 1's high. Bar 0 starts the setup; bar 1 re-arms (`lastOversoldBar` = 1); at bar 2, `sinceOs` = 1, which is in the window and confirmed, so `fire` = true. Check that the code produces exactly that.

- [ ] **Step 3: Commit**

```bash
git add src/egx-trust-indicator.pine
git commit -m "feat: add EGX setup detector, confirmation candles and trust score factors"
```

(Task 2 has no live check of its own. Nothing calls `startSetup` or `stepSetup` until Task 3, so the controller's compile check runs after Task 3.)

---

### Task 3: Trade engine, costs, stats, track record, labels, panel results, log, alerts

**Files:**
- Modify: `src/egx-trust-indicator.pine`. Replace `// @@ENGINE@@` with block A and `// @@OUTPUT@@` with block B. Append block C to the end of the DATA WINDOW section.

**Interfaces:**
- Consumes: Task 1 globals; Task 2's `ss`, `startSetup`, `stepSetup`, `clearSetup`, `factorSet`, `bandName`.
- Produces:
  - `type Trade`
  - `var Trade trade`
  - `advanceTrade(Trade t) => [bool closed, float exitPx, string reason]`
  - `tradeR(Trade t, float exitPx) => float`
  - stat arrays `statN statW statR statStreak statMaxStreak bandN bandW bandR trackN trackW`
  - signals `entrySignal`, `tradeClosedNow`, `exitWarn`
  - plot vars `plotEntry plotStop plotT1`

- [ ] **Step 1: Block A, replacing `// @@ENGINE@@`**

```pine
// ============================================================
// TRADE ENGINE
// ============================================================
// One trade at a time. Fields that change after entry are only ever mutated inside
// advanceTrade, which receives the object; top-level := on UDT fields is not trusted here.
type Trade
    int    entryBar
    int    entryTime
    float  entry
    float  stop
    float  risk
    float  t1
    float  score
    int    band
    string flags
    bool   inTest
    bool   t1Hit
    float  t1Exit
    float  highest
    float  mfe
    float  mae

var Trade trade = na

// R for one leg, after slippage on both sides.
legR(float entry, float exitPx, float risk) =>
    (exitPx - entry - slippagePct / 100.0 * (entry + exitPx)) / risk

// Blended R: half at Target 1 and half at the final exit when Target 1 was reached, otherwise
// the whole position at the exit. Commission: 2 orders, or 3 when Target 1 split the exit.
tradeR(Trade t, float exitPx) =>
    float gross  = t.t1Hit ? 0.5 * legR(t.entry, t.t1Exit, t.risk) + 0.5 * legR(t.entry, exitPx, t.risk) : legR(t.entry, exitPx, t.risk)
    int   orders = t.t1Hit ? 3 : 2
    float shares = positionEgp / t.entry
    gross - orders * commissionEgp / (shares * t.risk)

// Exit warnings: the index regime is Down, or the stock just closed back under its medium MA.
// A crossunder, not a level test, because a dip entry can legitimately sit below SMA(50).
idxDown   = regime == -1
exitWarn  = trendBreak or (idxDown and nz(regime[1], 0) != -1)

// Advances an open trade by one bar (never on its entry bar). Gaps fill at the open: a stop
// gapped through fills worse, a target gapped through fills better. A bar that touches both
// the stop and Target 1 counts the stop first.
advanceTrade(Trade t) =>
    bool   closed = false
    float  exitPx = na
    string reason = ""
    if not t.t1Hit
        if low <= t.stop
            closed := true
            exitPx := math.min(open, t.stop)
            reason := "Stop"
        else if high >= t.t1
            t.t1Hit  := true
            t.t1Exit := math.max(open, t.t1)
            t.stop   := t.entry
            if idxDown or trendBreak
                closed := true
                exitPx := close
                reason := idxDown ? "Exit: Index" : "Exit: Trend"
        else if idxDown or trendBreak
            closed := true
            exitPx := close
            reason := idxDown ? "Exit: Index" : "Exit: Trend"
        else if bar_index - t.entryBar >= timeStopBars
            closed := true
            exitPx := close
            reason := "Time"
    else
        // The trail uses the highest high of earlier bars only. Raising it with this bar's own
        // high and then testing this bar's low would assume the high printed first.
        float remStop = math.max(t.stop, t.highest - trailAtr * atr)
        if low <= remStop
            closed := true
            exitPx := math.min(open, remStop)
            reason := remStop > t.entry ? "Trail" : "Breakeven"
        else if idxDown or trendBreak
            closed := true
            exitPx := close
            reason := idxDown ? "Exit: Index" : "Exit: Trend"
        else
            t.stop := remStop
    t.highest := math.max(t.highest, high)
    t.mfe     := math.max(t.mfe, (high - t.entry) / t.risk)
    t.mae     := math.max(t.mae, (t.entry - low) / t.risk)
    [closed, exitPx, reason]

// Stats. Period index: 0 Tuning, 1 Test. Band arrays are indexed period * 3 + band.
// trackN / trackW pool both periods and feed the live track record on entry labels.
var array<int>   statN         = array.new<int>(2, 0)
var array<int>   statW         = array.new<int>(2, 0)
var array<float> statR         = array.new<float>(2, 0.0)
var array<int>   statStreak    = array.new<int>(2, 0)
var array<int>   statMaxStreak = array.new<int>(2, 0)
var array<int>   bandN         = array.new<int>(6, 0)
var array<int>   bandW         = array.new<int>(6, 0)
var array<float> bandR         = array.new<float>(6, 0.0)
var array<int>   trackN        = array.new<int>(3, 0)
var array<int>   trackW        = array.new<int>(3, 0)

recordTrade(Trade t, float r) =>
    int  p   = t.inTest ? 1 : 0
    int  bi  = p * 3 + t.band
    bool win = t.t1Hit
    array.set(statN, p, array.get(statN, p) + 1)
    array.set(statR, p, array.get(statR, p) + r)
    array.set(bandN, bi, array.get(bandN, bi) + 1)
    array.set(bandR, bi, array.get(bandR, bi) + r)
    array.set(trackN, t.band, array.get(trackN, t.band) + 1)
    if win
        array.set(statW, p, array.get(statW, p) + 1)
        array.set(bandW, bi, array.get(bandW, bi) + 1)
        array.set(trackW, t.band, array.get(trackW, t.band) + 1)
        array.set(statStreak, p, 0)
    else
        int s = array.get(statStreak, p) + 1
        array.set(statStreak, p, s)
        array.set(statMaxStreak, p, math.max(array.get(statMaxStreak, p), s))
    win

trackText(int band) =>
    int n = array.get(trackN, band)
    int w = array.get(trackW, band)
    n >= minHistory ? bandName(band) + " " + str.tostring(w) + "/" + str.tostring(n) + " (" + str.tostring(100.0 * w / n, "0") + "%)" : bandName(band) + " — building history"

var float plotEntry = na
var float plotStop  = na
var float plotT1    = na

bool tradeClosedNow = false
bool entrySignal    = false

// 1. Manage the open trade.
if not na(trade) and bar_index > trade.entryBar
    [closed, exitPx, reason] = advanceTrade(trade)
    if closed
        float r   = tradeR(trade, exitPx)
        bool  win = recordTrade(trade, r)
        tradeClosedNow := true
        if showLabels
            label.new(bar_index, high, (r >= 0 ? "+" : "") + str.tostring(r, "0.00") + "R · " + reason, style = label.style_label_down, color = win ? color.new(color.teal, 10) : color.new(color.maroon, 10), textcolor = color.white, size = size.small)
        if logTrades
            log.info("TRADE," + syminfo.ticker + "," + str.format_time(trade.entryTime, "yyyy-MM-dd") + "," + str.tostring(trade.entry) + "," + str.format_time(time, "yyyy-MM-dd") + "," + str.tostring(exitPx) + "," + str.tostring(r, "0.0000") + "," + (win ? "1" : "0") + "," + reason + "," + str.tostring(trade.score, "0") + "," + bandName(trade.band) + "," + trade.flags + "," + str.tostring(trade.mfe, "0.00") + "," + str.tostring(trade.mae, "0.00") + "," + str.tostring(bar_index - trade.entryBar) + "," + (trade.inTest ? "Test" : "Tuning"))
        trade := na

// 2. No open trade: arm, advance or fire a setup.
if na(trade)
    if ss.active
        bool fire = stepSetup(ss)
        if fire
            float stopRaw = ss.lowest - stopBufAtr * atr
            float minRisk = math.max(minRiskAtr * atr, minRiskTicks * syminfo.mintick)
            float risk    = math.max(close - stopRaw, minRisk)
            if risk <= maxRiskAtr * atr
                float pbVol = ss.volN > 0 ? ss.volSum / ss.volN : na
                [score, band, flags] = factorSet(ss.lowest, pbVol)
                string track = trackText(band)
                trade := Trade.new(bar_index, time, close, close - risk, risk, close + t1R * risk, score, band, flags, time >= testStart, false, na, high, 0.0, 0.0)
                entrySignal := true
                if showLabels
                    label.new(bar_index, low, "BUY · Trust " + str.tostring(score, "0") + " · " + track, style = label.style_label_up, color = band == 2 ? color.new(color.green, 0) : band == 1 ? color.new(color.olive, 0) : color.new(color.gray, 0), textcolor = color.white, size = size.small)
            clearSetup(ss)
    else if gatesOpen and rsi < rsiThreshold
        startSetup(ss)

// Lines for the open trade; the stop line follows the trail once Target 1 is reached.
if na(trade)
    plotEntry := na
    plotStop  := na
    plotT1    := na
else
    plotEntry := trade.entry
    plotStop  := trade.stop
    plotT1    := trade.t1
```

Read-back note: `trade.entry` and the other fields are only read when `not na(trade)` has already been checked in an enclosing `if`, never through an `and` chain.

- [ ] **Step 2: Block B, replacing `// @@OUTPUT@@`**

```pine
cellResult(int row, string key, string tuneVal, string testVal) =>
    table.cell(panel, 0, row, key, text_color = color.silver, text_size = size.small, text_halign = text.align_left)
    table.cell(panel, 1, row, tuneVal, text_color = color.white, text_size = size.small)
    table.cell(panel, 2, row, testVal, text_color = color.white, text_size = size.small)

winText(int p) =>
    int n = array.get(statN, p)
    n > 0 ? str.tostring(100.0 * array.get(statW, p) / n, "0.0") + "% (" + str.tostring(array.get(statW, p)) + ")" : "—"

avgText(int p) =>
    int n = array.get(statN, p)
    n > 0 ? str.tostring(array.get(statR, p) / n, "0.00") : "—"

bandText(int p, int band) =>
    int bi = p * 3 + band
    int n  = array.get(bandN, bi)
    n > 0 ? str.tostring(n) + " · " + str.tostring(100.0 * array.get(bandW, bi) / n, "0") + "% · " + str.tostring(array.get(bandR, bi) / n, "0.00") + "R" : "—"

if showPanel and barstate.islast
    cellStatus(5, "Setup", not na(trade) ? "In trade" : ss.active ? "Armed (" + str.tostring(bar_index - ss.startBar) + " bars)" : "Watching", not na(trade) ? color.aqua : ss.active ? color.yellow : color.gray)
    table.cell(panel, 0, 6, "RESULTS", text_color = color.white, text_size = size.small, text_halign = text.align_left)
    table.cell(panel, 1, 6, "Tuning", text_color = color.gray, text_size = size.small)
    table.cell(panel, 2, 6, "Test", text_color = color.gray, text_size = size.small)
    cellResult(7, "Trades", str.tostring(array.get(statN, 0)), str.tostring(array.get(statN, 1)))
    cellResult(8, "Win %", winText(0), winText(1))
    cellResult(9, "Avg R", avgText(0), avgText(1))
    cellResult(10, "Total R", str.tostring(array.get(statR, 0), "0.00"), str.tostring(array.get(statR, 1), "0.00"))
    cellResult(11, "Max loss run", str.tostring(array.get(statMaxStreak, 0)), str.tostring(array.get(statMaxStreak, 1)))
    cellResult(12, "High (n·win·avg)", bandText(0, 2), bandText(1, 2))
    cellResult(13, "Mid", bandText(0, 1), bandText(1, 1))
    cellResult(14, "Low", bandText(0, 0), bandText(1, 0))
    table.cell(panel, 0, 15, "costs " + str.tostring(slippagePct, "0.00") + "%/side + " + str.tostring(commissionEgp, "0.0") + " EGP/order", text_color = color.gray, text_size = size.tiny, text_halign = text.align_left)
    table.merge_cells(panel, 0, 15, 2, 15)

plot(plotEntry, "Entry", color = color.new(color.white, 30), style = plot.style_linebr)
plot(plotStop, "Stop", color = color.new(color.red, 0), style = plot.style_linebr)
plot(plotT1, "Target 1", color = color.new(color.lime, 0), style = plot.style_linebr)
plotshape(exitWarn, "Exit Warning", shape.xcross, location.abovebar, color.new(color.orange, 0), text = "EXIT", size = size.tiny)

alertcondition(entrySignal, "EGX Trust Entry", "BUY on {{ticker}} {{interval}}: see the chart label for the trust score, stop and Target 1.")
alertcondition(exitWarn, "EGX Exit Warning", "EXIT warning on {{ticker}} {{interval}}: the index regime turned Down or the stock lost its medium MA.")
alertcondition(tradeClosedNow, "EGX Trade Closed", "Trade closed on {{ticker}} {{interval}}: see the result label for R and reason.")
```

- [ ] **Step 3: Block C, appended after the existing DBG plots**

Machine-readable totals for the validation sweep. They're read from the Data Window on the last bar.

```pine
plot(array.get(statN, 0), "DBG Tune N", display = display.data_window)
plot(array.get(statW, 0), "DBG Tune Wins", display = display.data_window)
plot(array.get(statR, 0), "DBG Tune R", display = display.data_window)
plot(array.get(statN, 1), "DBG Test N", display = display.data_window)
plot(array.get(statW, 1), "DBG Test Wins", display = display.data_window)
plot(array.get(statR, 1), "DBG Test R", display = display.data_window)
plot(array.get(bandN, 5), "DBG Test High N", display = display.data_window)
plot(array.get(bandW, 5), "DBG Test High Wins", display = display.data_window)
plot(array.get(bandR, 5), "DBG Test High R", display = display.data_window)
plot(array.get(bandN, 2), "DBG Tune High N", display = display.data_window)
plot(array.get(bandW, 2), "DBG Tune High Wins", display = display.data_window)
plot(array.get(bandR, 2), "DBG Tune High R", display = display.data_window)
```

That makes 4 + 12 + 3 lines + 1 shape = 20 plots, under the 64 cap.

- [ ] **Step 4: Static read-back**

Confirm and write down:
1. No `ta.*` call is inside a function or an `if`. `exitWarn`, `idxDown` and `trendBreak` are global.
2. `advanceTrade` never runs on the entry bar (`bar_index > trade.entryBar`).
3. A bar with `low <= stop` and `high >= t1` closes as `Stop` (the stop branch is tested first).
4. A gap: open below the stop gives exitPx = open; open above T1 gives t1Exit = open.
5. Worked R example by hand. Entry 100, risk 2, T1 hit at 101.5, remainder exits at 100 (breakeven), slippage 0.1%, commission 2 EGP, position 100,000 EGP (1,000 shares):
   - leg1 = (101.5 − 100 − 0.001 × 201.5) / 2 = (1.5 − 0.2015) / 2 = 0.64925
   - leg2 = (0 − 0.001 × 200) / 2 = −0.1
   - gross = 0.5 × 0.64925 + 0.5 × (−0.1) = 0.274625
   - commission = 3 × 2 / (1000 × 2) = 0.003
   - **R = 0.271625**

   Check that `tradeR` computes this exactly.
6. The track-record label reads `trackN/trackW` *before* `recordTrade` of any later trade. The entry happens after step 1 on the same bar, but only one trade exists at a time, so the counts include only trades closed on earlier bars, or earlier on this bar when the previous trade closed and the setup fired on the same bar. The setup must have been armed on an earlier bar while no trade was open, so a trade closing this bar is impossible. Confirm this argument holds.
7. Every `Trade.new` call passes 15 positional arguments in field order.

- [ ] **Step 5: Commit**

```bash
git add src/egx-trust-indicator.pine
git commit -m "feat: add EGX trust trade engine, costs, results panel, trade log and alerts"
```

- [ ] **Step 6 (controller, browser): live compile and external-reference checks**

1. Compiles and adds to the chart; no runtime error on `EGX_DLY:COMI` 1D, `EGX_DLY:MASR` 1D, `EGX_DLY:COMI` 1W and `EGX_DLY:COMI` 1M.
2. The panel shows STATUS rows 0–5 and the RESULTS rows; Tuning and Test both have trades on COMI 1D.
3. Turn on `Log Trades`, then download the Pine Logs CSV for COMI 1D. In PowerShell, sum column R, count rows and count wins per period, and check that they match `DBG Tune/Test N/Wins/R` exactly. Coerce with `[double]`.
4. Bar Replay on COMI 1D, 5 trades: for each, check against the written rules by eye. Gates were open at the setup bar (index regime on the EGX30 chart, close > SMA200), RSI(2) < 10 on the setup bar, the confirmation candle type, stop = pullback low − 0.25 ATR (or the floor), T1 = entry + 0.75R, and the close reason. Repeat on ORWE 1D. Record each trade's verdict in the validation doc.

Any mismatch is a bug: diagnose it (superpowers:systematic-debugging), fix, commit, and re-run the check.

---

### Task 4: README sections (English and Arabic)

**Files:**
- Modify: `README.md` (add a top-level section `## EGX Trust Score indicator`, placed after the last indicator section and before any license/footer section)
- Modify: `README.ar.md` (the same section translated, placed in the matching position)

**Interfaces:** consumes the input names, panel rows and behavior from Tasks 1–3 exactly as written.

- [ ] **Step 1: Write the English section.** Cover:
  - what it does, in one paragraph
  - how the index is chosen (Auto / Override / Unlisted, `LIST_DATE`, refreshing at the semi-annual rebalance)
  - the regime rule
  - the three gates
  - setup and confirmation
  - stop, T1, trail, time stop and exit warnings
  - the trust score table (six factors, full/half credit) and the track-record label format
  - the panel rows
  - costs
  - the Validation group (`Test Start`) and why to tune on the Tuning column only
  - `Log Trades` (personal, unpublished copy only)
  - known limits: survivorship bias (today's constituent lists are applied to all history), split-adjusted tick granularity, and that the indicator has no shorts

  Every input named must match the script's label string exactly.
- [ ] **Step 2: Write the Arabic section** with the same structure and the same input names. Input labels stay in English in backticks, since that's what TradingView shows.
- [ ] **Step 3: Read-back.** Grep each backticked input name in both READMEs against `src/egx-trust-indicator.pine`; every one must exist as an input label.
- [ ] **Step 4: Commit**

```bash
git add README.md README.ar.md
git commit -m "docs: document the EGX trust score indicator (EN + AR)"
```

---

### Task 5 (controller, browser): Validation round 1

**Files:**
- Create: `docs/superpowers/plans/2026-11-02-egx-trust-validation.md` (results doc)
- Create: `docs/superpowers/plans/2026-11-02-egx-trust-raw-results.tsv` (one row per chart per run)

**Symbol sets, fixed now, before any run.** All daily, prefix `EGX_DLY:`.

| Set | EGX30 | EGX70 |
|---|---|---|
| Tuning (bars < 2024-01-01) and Test-A (same symbols, bars ≥ 2024-01-01) | COMI, TMGH, ETEL, EAST, FWRY, ABUK, HRHO, ORAS, AMOC, MFPC | SWDY, ORWE, MASR, ELEC, EGCH |
| Test-B round 1 (never viewed, full history) | PHDC, CCAP, ADIB, SKPC, JUFO | OCDI, AMER, CIEB, MTIE, LCSW |
| Test-C round 2 (never viewed) | EFID, HELI, ORHD, ISPH, CLHO | ATQA, KABO, EHDR, PHAR, TAQA |
| Test-D round 3 (never viewed) | MCQE, EGAL, GBCO, BTFH, RMDA | ISMQ, ENGC, OIH, SCEM, ZMID |

**Pass rule, fixed now:** on the pooled test set of the round,
- win rate ≥ 80%, and
- Total R > 0, and
- n ≥ 30, and
- Total R > 0 on ≥ 60% of the test charts that have ≥ 5 trades.

The pooled test set is Test-A + Test-B in round 1. In rounds 2 and 3 it is the fresh batch alone (C, then D); Test-A is reported but doesn't decide.

**Tuning grid, fixed now:** `RSI Oversold Below` ∈ {5, 10, 15} × `Target 1 (R)` ∈ {0.5, 0.75, 1.0}, read from the **Tuning** column only, pooled over the 15 tuning charts. Pick the combo with the highest pooled tuning win rate among combos with pooled tuning Total R > 0 and tuning n ≥ 50. Factor drops: after the pick, compare each factor's full-credit trades against the rest on the tuning log. Drop a factor (its `Score:` input off) only if its full-credit win rate is lower than its zero-credit win rate by 5 points or more, with at least 20 trades on each side. A factor drop changes only the score, not which trades are taken.

- [ ] **Step 1:** For each grid combo, sweep the 15 tuning charts and record `DBG Tune N/Wins/R` from the Data Window on the last bar into the TSV (`round, combo, symbol, set, n, wins, R`). Don't read or record the Test columns during this step.
- [ ] **Step 2:** Pick the combo by the rule above. Write the pick and the reasoning into the results doc **before** reading any Test number.
- [ ] **Step 3:** With the picked settings, read `DBG Test N/Wins/R` for the 15 Test-A charts and `DBG Tune N/Wins/R + Test N/Wins/R` for the 10 Test-B charts. Test-B is out-of-sample over its whole history, so for those charts use Tune + Test summed. Record everything in the TSV.
- [ ] **Step 4:** Compute the pooled verdict in PowerShell from the TSV, coercing numbers. Write the verdict, the per-chart table and the per-band (High) numbers into the results doc. Commit both files.
- [ ] **Step 5:** If it passes, go to Task 6. If it fails and rounds remain, return to Step 1 with the tuning-set evidence only. Allowed changes: the grid above, factor drops, and at most one rule change per round that is justified by a pattern in the tuning-set trade log (MFE/MAE, close reasons). Record the change before judging on the next fresh batch.

---

### Task 6: Close-out

- [ ] **Step 1:** Results doc final section:
  - the verdict per round
  - the best honest out-of-sample numbers
  - any trust band that reaches ≥ 80% out-of-sample on n ≥ 30
  - known biases (survivorship from today's lists; costs as modelled)
  - recommended default settings
- [ ] **Step 2:** If the picked settings differ from the script defaults, change the input defaults in `src/egx-trust-indicator.pine` and update both READMEs to match. Commit.
- [ ] **Step 3:** Final whole-branch review (superpowers:requesting-code-review). Then superpowers:finishing-a-development-branch.
