# Strategy Tester Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ICT script's trades run in TradingView's Strategy Tester, by generating a `strategy()` twin of the indicator whose orders mirror the engine's own decisions.

**Architecture:** The indicator stays the single source of truth and is not edited. A PowerShell build script copies it, swaps the `indicator(` declaration for `strategy(`, removes the `alertcondition(` lines and appends an order-layer fragment. The order layer reads the engine's trade slots and issues `strategy.entry` / `strategy.exit` / `strategy.close`; it decides nothing itself.

**Tech Stack:** Pine Script v6, Windows PowerShell 5.1. No Node, no Pester, no Pine compiler.

**Spec:** `docs/superpowers/specs/2026-10-05-strategy-tester-backtest-design.md` — read it before starting any task.

**Execution method (chosen by the user):** subagent-driven, implementers on Sonnet 5.5 (`model: "sonnet"`). Tasks 1–3 go to subagents. Task 4 drives the user's logged-in TradingView session and runs in the main session with the user present.

## Global Constraints

- `src/ict-rsi-ma-indicator.pine` is never modified. `git diff master -- src/ict-rsi-ma-indicator.pine` must be empty at the end of every task.
- `src/ict-rsi-ma-strategy.pine` is generated. Never edit it by hand; change the indicator or `src/strategy-layer.pine` and rebuild.
- No `plot`, `plotshape` or `bgcolor` call may be added anywhere. The indicator sits at Pine's 64-plot cap and a 65th is a runtime error that only shows on the chart.
- Every identifier the order layer declares starts with `bt` or `showBt`. The indicator has none with that prefix, so nothing can collide.
- `tools/*.ps1` are pure ASCII. PowerShell 5.1 reads a BOM-less script as ANSI and would corrupt any non-ASCII character in it.
- Pine files are UTF-8 without a BOM, CRLF line endings in the working copy.
- Never claim Pine code compiles. Nothing here is compiled until Task 4 pastes it into TradingView. Static review is reported as static review.
- Pine v6 traps that apply to this work: `and` does not short-circuit, so never read a field of a possibly-`na` object in the same expression that tests it — nest `if`s. A function's last statement must be an expression. Do not mutate a UDT field at top level; the layer only reads `Trade` fields.
- Commit messages end with the attribution line the session supplies: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run PowerShell scripts as `powershell -NoProfile -ExecutionPolicy Bypass -File <script>`.

## Review Focus

Inputs and conditions the spec implies that are most likely to bite, each pinned by a test or check in the task named:

1. **The indicator's declaration line changes shape** (an argument added, the title edited). Expected: the build stops with a clear error and writes nothing, never emits a half-converted file. — Task 1, tests 2, 3, 4.
2. **Non-ASCII characters in the source** (the indicator is full of em dashes and `·`). Expected: byte-for-byte survival, no BOM. — Task 1, test 6.
3. **Git checks the generated file out with different line endings.** Expected: `-Check` still says up to date. — Task 1, test 8.
4. **`Runner` and `Stop on Close Only` both on.** The third leg then has neither a limit nor a stop, and `strategy.exit` with neither is a runtime error. Expected: the call is skipped and the leg leaves on the engine's close. — Task 2, read-back check 5.
5. **The selected slot is `na`** (no trade yet, or Trail selected with the trail model off). Expected: no field of it is ever read. — Task 2, read-back check 3.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tools/build-strategy.ps1` | create | Indicator + layer → strategy file. `-Check` reports staleness. |
| `tools/test-build-strategy.ps1` | create | Fixture-driven tests for the build script. |
| `src/strategy-layer.pine` | create | The order layer fragment. |
| `src/ict-rsi-ma-strategy.pine` | create (generated) | What gets pasted into TradingView. |
| `README.md`, `README.ar.md` | modify | Backtesting section, corrected claims, repository layout. |
| `docs/superpowers/plans/2026-10-05-strategy-backtest-validation.md` | create in Task 4 | Recorded results of the live pass. |

---

### Task 1: The build script

**Files:**
- Create: `tools/build-strategy.ps1`
- Create: `tools/test-build-strategy.ps1`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `tools/build-strategy.ps1 [-SourcePath <p>] [-LayerPath <p>] [-OutPath <p>] [-Check]`. Defaults: `src/ict-rsi-ma-indicator.pine`, `src/strategy-layer.pine`, `src/ict-rsi-ma-strategy.pine`, resolved from the repo root (the parent of `tools/`). Exit code 0 on success; non-zero on any error or, under `-Check`, when the output is missing or stale. Task 2 runs it with no arguments.

- [ ] **Step 1: Write the failing tests**

Create `tools/test-build-strategy.ps1` (ASCII only):

```powershell
# Tests for tools/build-strategy.ps1. Plain PowerShell 5.1, no Pester.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-build-strategy.ps1
$ErrorActionPreference = 'Stop'

$build     = Join-Path $PSScriptRoot 'build-strategy.ps1'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:passes   = 0
$script:failures = 0

function Assert-True([bool]$Condition, [string]$Name) {
    if ($Condition) {
        $script:passes++
        Write-Host "PASS  $Name"
    } else {
        $script:failures++
        Write-Host "FAIL  $Name"
    }
}

function New-CaseDir {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('build-strategy-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    return $dir
}

function Write-Fixture([string]$Path, [string[]]$Lines, [string]$Eol = "`r`n") {
    [System.IO.File]::WriteAllText($Path, ($Lines -join $Eol) + $Eol, $utf8NoBom)
}

# Runs the build in-process. A `throw` in the build surfaces as an exception, an `exit N`
# as $LASTEXITCODE; both are reduced to one exit code here.
function Invoke-Build([string]$Dir, [switch]$Check) {
    $global:LASTEXITCODE = 0
    try {
        & $build -SourcePath (Join-Path $Dir 'in.pine') -LayerPath (Join-Path $Dir 'layer.pine') -OutPath (Join-Path $Dir 'out.pine') -Check:$Check | Out-Null
        return $LASTEXITCODE
    } catch {
        return 1
    }
}

function Read-OutLines([string]$Dir) {
    $text = [System.IO.File]::ReadAllText((Join-Path $Dir 'out.pine'), $utf8NoBom)
    return ,($text.Replace("`r`n", "`n").TrimEnd("`n").Split("`n"))
}

$dash = [string][char]0x2014
$dot  = [string][char]0x00B7

$goodSrc = @(
    '//@version=6',
    '// header comment',
    'indicator("Demo Script", shorttitle = "DEMO", overlay = true, max_bars_back = 5000) // keep this comment',
    ('x = close // dash ' + $dash + ' and dot ' + $dot),
    'alertcondition(x > 0, title = "A", message = "m (one)")',
    '// a comment that mentions alertcondition( stays',
    'alertcondition(x < 0, title = "B", message = "m")',
    'plot(x)'
)
$goodLayer = @('// LAYER', 'strategy.entry("BT", strategy.long)')

$expectedDecl = 'strategy("Demo Script Strategy", shorttitle = "DEMO-ST", overlay = true, max_bars_back = 5000, process_orders_on_close = true, pyramiding = 0, initial_capital = 100000, default_qty_type = strategy.fixed, default_qty_value = 1, margin_long = 0, margin_short = 0, commission_type = strategy.commission.percent, commission_value = 0, slippage = 0) // keep this comment'

# ---- 1. happy path ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') $goodSrc
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
$code = Invoke-Build $d
Assert-True ($code -eq 0) '1a build succeeds on a well-formed source'
$out = Read-OutLines $d
Assert-True ($out[0].StartsWith('// GENERATED FILE')) '1b output starts with the generated-file header'
Assert-True ($out -contains '//@version=6') '1c version line survives'
Assert-True ($out -contains $expectedDecl) '1d declaration swapped, arguments and trailing comment kept'
Assert-True (@($out | Where-Object { $_.StartsWith('indicator(') }).Count -eq 0) '1e no indicator( line remains'
Assert-True (@($out | Where-Object { $_.StartsWith('alertcondition(') }).Count -eq 0) '1f alertcondition lines removed'
Assert-True ($out -contains '// a comment that mentions alertcondition( stays') '1g comment mentioning alertcondition kept'
Assert-True ($out -contains 'plot(x)') '1h ordinary lines kept'
Assert-True ($out[$out.Count - 2] -eq '// LAYER' -and $out[$out.Count - 1] -eq 'strategy.entry("BT", strategy.long)') '1i layer appended at the end'
Assert-True ($out.Count -eq 3 + $goodSrc.Count - 2 + 1 + $goodLayer.Count) '1j line count is header + source - alerts + blank + layer'

# ---- 2. no indicator( line ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') @($goodSrc | Where-Object { -not $_.StartsWith('indicator(') })
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Assert-True ((Invoke-Build $d) -ne 0) '2a fails when no indicator( line exists'
Assert-True (-not (Test-Path (Join-Path $d 'out.pine'))) '2b writes nothing on that failure'

# ---- 3. two indicator( lines ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') ($goodSrc + 'indicator("Second", shorttitle = "S", overlay = true)')
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Assert-True ((Invoke-Build $d) -ne 0) '3a fails when two indicator( lines exist'
Assert-True (-not (Test-Path (Join-Path $d 'out.pine'))) '3b writes nothing on that failure'

# ---- 4. declaration in an unexpected shape ----
$d = New-CaseDir
$odd = $goodSrc.Clone()
$odd[2] = 'indicator(title = "Demo Script", overlay = true)'
Write-Fixture (Join-Path $d 'in.pine') $odd
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Assert-True ((Invoke-Build $d) -ne 0) '4a fails when the declaration does not match the expected shape'
Assert-True (-not (Test-Path (Join-Path $d 'out.pine'))) '4b writes nothing on that failure'

# ---- 5. alertcondition problems ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') @($goodSrc | Where-Object { -not $_.StartsWith('alertcondition(') })
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Assert-True ((Invoke-Build $d) -ne 0) '5a fails when the source has no alertcondition( lines'

$d = New-CaseDir
$multi = $goodSrc.Clone()
$multi[4] = 'alertcondition(x > 0, title = "A",'
Write-Fixture (Join-Path $d 'in.pine') $multi
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Assert-True ((Invoke-Build $d) -ne 0) '5b fails on an alertcondition( call that spans lines'
Assert-True (-not (Test-Path (Join-Path $d 'out.pine'))) '5c writes nothing on that failure'

# ---- 6. encoding round trip ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') $goodSrc
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Invoke-Build $d | Out-Null
$bytes = [System.IO.File]::ReadAllBytes((Join-Path $d 'out.pine'))
Assert-True (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)) '6a output has no BOM'
$out = Read-OutLines $d
Assert-True ($out -contains ('x = close // dash ' + $dash + ' and dot ' + $dot)) '6b non-ASCII characters survive unchanged'
$raw = [System.IO.File]::ReadAllText((Join-Path $d 'out.pine'), $utf8NoBom)
Assert-True ($raw.EndsWith("`r`n") -and ($raw.Replace("`r`n", '').IndexOf("`n") -lt 0)) '6c output uses CRLF throughout and ends with a newline'

# ---- 7. -Check: fresh, stale, missing ----
Assert-True ((Invoke-Build $d -Check) -eq 0) '7a -Check passes straight after a build'
$before = [System.IO.File]::ReadAllBytes((Join-Path $d 'out.pine'))
Write-Fixture (Join-Path $d 'in.pine') ($goodSrc + 'y = open')
Assert-True ((Invoke-Build $d -Check) -ne 0) '7b -Check fails once the source changes'
$after = [System.IO.File]::ReadAllBytes((Join-Path $d 'out.pine'))
Assert-True ([Convert]::ToBase64String($before) -ceq [Convert]::ToBase64String($after)) '7c -Check never writes the output'
Remove-Item (Join-Path $d 'out.pine')
Assert-True ((Invoke-Build $d -Check) -ne 0) '7d -Check fails when the output is missing'

# ---- 8. -Check ignores line endings ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') $goodSrc
Write-Fixture (Join-Path $d 'layer.pine') $goodLayer
Invoke-Build $d | Out-Null
$lf = [System.IO.File]::ReadAllText((Join-Path $d 'out.pine'), $utf8NoBom).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText((Join-Path $d 'out.pine'), $lf, $utf8NoBom)
Assert-True ((Invoke-Build $d -Check) -eq 0) '8a -Check passes on an LF checkout of the same content'

# ---- 9. bad layer ----
$d = New-CaseDir
Write-Fixture (Join-Path $d 'in.pine') $goodSrc
Write-Fixture (Join-Path $d 'layer.pine') @('', '   ')
Assert-True ((Invoke-Build $d) -ne 0) '9a fails on an empty layer'
Write-Fixture (Join-Path $d 'layer.pine') @('//@version=6', 'strategy.entry("BT", strategy.long)')
Assert-True ((Invoke-Build $d) -ne 0) '9b fails on a layer that carries its own version line'

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:passes, $script:failures)
if ($script:failures -gt 0) { exit 1 }
exit 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-build-strategy.ps1`
Expected: the run stops with a "Could not find file ... out.pine" error at the first `Read-OutLines` call (the build script does not exist, so nothing was written), after printing `FAIL  1a build succeeds on a well-formed source`. Exit code non-zero. Note that the "fails when..." assertions would pass vacuously at this point; Step 5 deals with that.

- [ ] **Step 3: Write the build script**

Create `tools/build-strategy.ps1` (ASCII only):

```powershell
<#
.SYNOPSIS
Builds src/ict-rsi-ma-strategy.pine from the indicator plus the order layer.

.DESCRIPTION
The indicator is the single source of truth. This script copies it, swaps the indicator()
declaration for strategy(), removes the alertcondition() lines (they do nothing in a strategy)
and appends src/strategy-layer.pine. With -Check it writes nothing and exits 1 if the committed
strategy file is missing or out of date.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 -Check
#>
[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$LayerPath,
    [string]$OutPath,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $SourcePath) { $SourcePath = Join-Path $repoRoot 'src\ict-rsi-ma-indicator.pine' }
if (-not $LayerPath)  { $LayerPath  = Join-Path $repoRoot 'src\strategy-layer.pine' }
if (-not $OutPath)    { $OutPath    = Join-Path $repoRoot 'src\ict-rsi-ma-strategy.pine' }

# .NET file calls resolve relative paths against the process directory, not PowerShell's
# location, so every path is made absolute first.
$SourcePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SourcePath)
$LayerPath  = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LayerPath)
$OutPath    = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutPath)

# The Pine sources contain non-ASCII characters. PowerShell 5.1's default encodings would
# corrupt them on read and add a BOM on write, so both directions name the encoding.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Lines([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }
    $text = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
    $text = $text.TrimStart([char]0xFEFF).Replace("`r`n", "`n").Replace("`r", "`n").TrimEnd("`n")
    return ,($text.Split("`n"))
}

$src   = Read-Lines $SourcePath
$layer = Read-Lines $LayerPath

# ---- validate the layer ----
if (@($layer | Where-Object { $_.Trim().Length -gt 0 }).Count -eq 0) {
    throw "The order layer is empty: $LayerPath"
}
foreach ($line in $layer) {
    if ($line.StartsWith('//@version') -or $line.StartsWith('indicator(') -or $line.StartsWith('strategy(')) {
        throw "The order layer is a fragment and must not declare a script. Offending line: $line"
    }
}

# ---- find and convert the declaration ----
$declIdx = @()
for ($i = 0; $i -lt $src.Count; $i++) {
    if ($src[$i].StartsWith('indicator(')) { $declIdx += $i }
}
if ($declIdx.Count -ne 1) {
    throw "Expected exactly one line starting 'indicator(' in $SourcePath, found $($declIdx.Count)."
}

$declPattern = '^indicator\("(?<title>[^"]+)", shorttitle = "(?<short>[^"]+)", (?<rest>.+?)\)(?<tail>\s*//.*)?$'
$m = [regex]::Match($src[$declIdx[0]], $declPattern)
if (-not $m.Success) {
    throw "The indicator( line is not in the expected shape (title, then shorttitle, then other arguments). Line: $($src[$declIdx[0]])"
}

# Zero costs and no margin limit make the out-of-the-box run the cross-check run. All of these
# are editable in the Strategy Tester's Properties tab.
$extras = 'process_orders_on_close = true, pyramiding = 0, initial_capital = 100000, default_qty_type = strategy.fixed, default_qty_value = 1, margin_long = 0, margin_short = 0, commission_type = strategy.commission.percent, commission_value = 0, slippage = 0'
$newDecl = 'strategy("{0} Strategy", shorttitle = "{1}-ST", {2}, {3}){4}' -f $m.Groups['title'].Value, $m.Groups['short'].Value, $m.Groups['rest'].Value, $extras, $m.Groups['tail'].Value

# ---- validate the alertcondition lines ----
$alertLines = @($src | Where-Object { $_.StartsWith('alertcondition(') })
if ($alertLines.Count -eq 0) {
    throw "Found no line starting 'alertcondition(' in $SourcePath. The indicator has changed shape; review this script."
}
foreach ($line in $alertLines) {
    if (-not $line.TrimEnd().EndsWith(')')) {
        throw "An alertcondition( call spans more than one line, which this script cannot remove safely. Line: $line"
    }
}
foreach ($line in $src) {
    $trimmed = $line.TrimStart()
    if ($trimmed.Contains('alertcondition(') -and -not $line.StartsWith('alertcondition(') -and -not $trimmed.StartsWith('//')) {
        throw "An alertcondition( call does not start its line, which this script cannot remove safely. Line: $line"
    }
}

# ---- assemble ----
$out = New-Object 'System.Collections.Generic.List[string]'
$out.Add('// GENERATED FILE -- do not edit. Built by tools/build-strategy.ps1 from')
$out.Add('// src/ict-rsi-ma-indicator.pine + src/strategy-layer.pine. Edit those and rebuild.')
$out.Add('// Line numbers quoted in comments below refer to the indicator source, not this file.')
for ($i = 0; $i -lt $src.Count; $i++) {
    if ($i -eq $declIdx[0]) {
        $out.Add($newDecl)
    } elseif ($src[$i].StartsWith('alertcondition(')) {
        continue
    } else {
        $out.Add($src[$i])
    }
}
$out.Add('')
foreach ($line in $layer) { $out.Add($line) }

$built = $out -join "`n"

if ($Check) {
    if (-not (Test-Path -LiteralPath $OutPath)) {
        Write-Host "STALE: $OutPath does not exist. Run tools/build-strategy.ps1."
        exit 1
    }
    $existing = (Read-Lines $OutPath) -join "`n"
    if ($existing -cne $built) {
        Write-Host "STALE: $OutPath does not match its sources. Run tools/build-strategy.ps1."
        exit 1
    }
    Write-Host "OK: $OutPath is up to date."
    exit 0
}

[System.IO.File]::WriteAllText($OutPath, ($out -join "`r`n") + "`r`n", $utf8NoBom)
Write-Host "Built $OutPath ($($out.Count) lines, $($alertLines.Count) alertcondition lines removed)."
exit 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-build-strategy.ps1`
Expected: every line starts `PASS`, the summary reads `29 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Prove the failure tests are not vacuous**

The "fails when…" assertions also passed in Step 2, before the script existed. Confirm they now fail for the right reason: temporarily change `if ($declIdx.Count -ne 1)` to `if ($false)` in the build script, rerun the tests, and confirm `2a` or `3a` reports `FAIL` or the run errors. Restore the line and rerun to 29 passed.

- [ ] **Step 6: Verify both scripts are ASCII**

Run:
```powershell
powershell -NoProfile -Command "foreach ($f in 'tools/build-strategy.ps1','tools/test-build-strategy.ps1') { $n = @([System.IO.File]::ReadAllBytes($f) | Where-Object { $_ -gt 127 }).Count; Write-Host $f $n }"
```
Expected: both files report `0`.

- [ ] **Step 7: Commit**

```bash
git add tools/build-strategy.ps1 tools/test-build-strategy.ps1
git commit -m "feat: add the strategy build script and its tests"
```

---

### Task 2: The order layer and the generated strategy

**Files:**
- Create: `src/strategy-layer.pine`
- Create (generated): `src/ict-rsi-ma-strategy.pine`

**Interfaces:**
- Consumes from Task 1: `tools/build-strategy.ps1` with no arguments builds; with `-Check` verifies.
- Consumes from the indicator (all global, all already defined before the layer is appended — do not redefine any):
  - `type Trade` with fields `string side` (`"long"`/`"short"`), `float entry`, `float stop` (current, trailed), `float initialStop`, `float tp1`, `float tp2`, `float tp3`, `int openBar`, `int tpHit` (0–3), `string closeReason` (`na` while live), `bool runner`.
  - `var Trade activeTrade` (pullback slot), `var Trade trailTrade` (trail slot). Either may be `na`.
  - `pbClosed`, `trClosed` — `bool`, true only on the bar that slot's trade closed. The trade object is still in its slot on that bar; it is freed on the next.
  - `tradeLiveOf(Trade t)` → `bool`, safe on `na`.
  - `stopOnCloseOnly` — `bool` input.
  - `MODEL_PULLBACK = 0`, `MODEL_TRAIL = 1`; `statTrades` (`array<int>`, size 2) and `statSumR` (`array<float>`, size 2), indexed by model.
- Produces: `src/ict-rsi-ma-strategy.pine`, which Task 3 documents and Task 4 runs.

There is no Pine compiler here, so this task has no red/green cycle. Its tests are the build checks in Step 3 and the numbered read-back in Step 4.

- [ ] **Step 1: Write the order layer**

Create `src/strategy-layer.pine` (UTF-8, no BOM):

```pine
// ============================================================
// STRATEGY TESTER ORDER LAYER
// ============================================================
// Appended to the indicator by tools/build-strategy.ps1. This file is a fragment: it reads the
// engine's globals and does not compile alone.
//
// It decides nothing. Every entry, stop, target and exit is the engine's; this layer only tells
// TradingView's broker emulator what the engine already did, so the Strategy Tester becomes a
// second, independent accounting of the same trades.
//
// Every identifier declared here starts with `bt` or `showBt`. The indicator has none with that
// prefix, so nothing here can shadow or collide with engine state.
//
// No plot is added: the indicator sits at Pine's 64-plot cap, and a 65th is a runtime error that
// only appears on the chart. The readouts go in a table instead.
btModelInput    = input.string("Pullback", "Backtest Model", options = ["Pullback", "Trail"], group = "Strategy Tester", tooltip = "Which entry model sends orders to the Strategy Tester. A strategy holds one net position per symbol, while the two models can be open at once and in opposite directions, so one run tests one model. The other still draws and still reports in the panel. Selecting Trail does not switch the trail model on — Enable Trailing Stop Model does.")
btSizingInput   = input.string("Fixed Cash Risk", "Sizing", options = ["Fixed Cash Risk", "% of Equity Risk"], group = "Strategy Tester", tooltip = "Fixed Cash Risk puts the same cash amount at risk on every trade, so Net Profit divided by that amount is the result in R — use it to check the Tester against the PERFORMANCE rows. % of Equity Risk compounds, which is the realistic view.")
btRiskCash      = input.float(1000.0, "Risk per Trade (cash)", minval = 0.01, group = "Strategy Tester", tooltip = "Cash lost if the initial stop is hit. Used in Fixed Cash Risk mode.")
btRiskPct       = input.float(1.0, "Risk per Trade (% of equity)", minval = 0.01, maxval = 100.0, step = 0.1, group = "Strategy Tester", tooltip = "Share of current equity lost if the initial stop is hit. Used in % of Equity Risk mode.")
btMaxPosPct     = input.float(0.0, "Max Position (% of equity)", minval = 0.0, step = 10.0, group = "Strategy Tester", tooltip = "Caps the position's value. 0 = no cap. Sizing by risk with a tight stop can ask for a position larger than the account; on a cash-equity market set this to 100. A capped trade risks less than 1R, so the Tester and the PERFORMANCE rows will differ on it — the BACKTEST table counts how many were capped.")
showBtPanel     = input.bool(true, "Show Backtest Panel", group = "Strategy Tester")
btPanelPosInput = input.string("Bottom Left", "Backtest Panel Position", options = ["Top Right", "Top Left", "Bottom Right", "Bottom Left"], group = "Strategy Tester", tooltip = "TradingView draws one table per position, so if this matches Panel Position one hides the other.")

btIsTrail   = btModelInput == "Trail"
btFixedCash = btSizingInput == "Fixed Cash Risk"
btModelIdx  = btIsTrail ? MODEL_TRAIL : MODEL_PULLBACK
// The slot's own close flag, never the shared tradeClosed — the other model closing must not
// flatten this one's position.
btClosedNow = btIsTrail ? trClosed : pbClosed

// A second reference to the selected slot's trade, for reading only. UDTs are references, so
// this is the same object the engine holds; nothing below assigns to a field of it.
Trade bt = na
if btIsTrail
    bt := trailTrade
else
    bt := activeTrade

var int   btEntries = 0
var int   btCapped  = 0
var float btLegQty  = na   // the first two thirds
var float btLastQty = na   // the remainder, so the three legs sum to the position exactly

// Nested, not `and`-chained: Pine does not guarantee short-circuit evaluation, and reading a
// field of a `na` object is a runtime error.
btOpenedNow = false
if not na(bt)
    if bt.openBar == bar_index
        btOpenedNow := true

// ---- entry ----
// A market order on the bar the engine opened the trade. process_orders_on_close fills it at
// this bar's close, which is the entry price the engine recorded.
//
// Sized from initialStop, the same denominator the engine's R uses. With non-positive equity in
// % mode the quantity is not positive and no order is sent; the engine's trade then has no
// counterpart, which shows as entries sent falling behind n.
if btOpenedNow
    btRiskPer = math.abs(bt.entry - bt.initialStop)
    btCash    = btFixedCash ? btRiskCash : strategy.equity * btRiskPct / 100.0
    btQty     = btRiskPer > 0 ? btCash / btRiskPer : 0.0
    if btMaxPosPct > 0
        if bt.entry > 0
            btMaxQty = strategy.equity * btMaxPosPct / 100.0 / bt.entry
            if btQty > btMaxQty
                btQty    := btMaxQty
                btCapped += 1
    if btQty > 0
        btLegQty  := btQty / 3.0
        btLastQty := btQty - 2.0 * btLegQty
        strategy.entry("BT", bt.side == "long" ? strategy.long : strategy.short, qty = btQty)
        btEntries += 1

// ---- exits while the trade is live ----
// One exit order per third, re-issued every bar so the resting stop follows the engine's. The
// engine moves its stop at this bar's close and tests it on the next bar; a stop order placed
// now and evaluated over the next bar is the same thing. A stop that opens beyond its price
// fills at the open, which is the engine's own gap rule.
//
// A leg whose target the engine has already counted is NOT re-issued: its order has filled, and
// calling strategy.exit again under the same id would open a fresh exit against the remainder.
//
// Stop on Close Only: no resting stop at all. A resting stop fills on a wick, which is exactly
// what that mode exists to ignore; the close block below exits at the bar's close instead.
//
// Runner: the last third has no limit at TP3 and leaves by the stop or the close. Read from the
// trade's own snapshot, as the engine does. With both modes on that leg has neither a limit nor
// a stop, and strategy.exit with neither is a runtime error, so the call is skipped.
if tradeLiveOf(bt)
    btStopPx = stopOnCloseOnly ? float(na) : bt.stop
    btLimit3 = bt.runner ? float(na) : bt.tp3
    if bt.tpHit < 1
        strategy.exit("TP1", from_entry = "BT", qty = btLegQty, limit = bt.tp1, stop = btStopPx)
    if bt.tpHit < 2
        strategy.exit("TP2", from_entry = "BT", qty = btLegQty, limit = bt.tp2, stop = btStopPx)
    if not (na(btLimit3) and na(btStopPx))
        strategy.exit("TP3", from_entry = "BT", qty = btLastQty, limit = btLimit3, stop = btStopPx)

// ---- the bar the engine closes the trade ----
// For a wick-mode stop or a TP3 exit the resting order has already filled and this closes
// nothing. For an Invalidated exit, and for every stop under Stop on Close Only, this IS the
// exit, at this bar's close — the price the engine books. It also sweeps up whatever quantity
// rounding left behind, so the Tester is never still in a trade the engine has finished.
if btClosedNow
    strategy.cancel_all()
    if not na(bt)
        strategy.close("BT", comment = bt.closeReason)

// ---- BACKTEST table ----
// Puts both sides of the cross-check next to each other. Tester R is only meaningful under Fixed
// Cash Risk, and the two only agree exactly while flat: an open trade is in entries sent but not
// in n, and thirds it has already banked are in net profit but not yet in Total R.
var table btPanel = na
if barstate.islast
    table.delete(btPanel)
    if showBtPanel
        btPanelPos = switch btPanelPosInput
            "Top Right"    => position.top_right
            "Top Left"     => position.top_left
            "Bottom Right" => position.bottom_right
            => position.bottom_left
        btEngineN = array.get(statTrades, btModelIdx)
        btEngineR = array.get(statSumR,   btModelIdx)
        btIsOpen  = tradeLiveOf(bt)
        btPanel := table.new(btPanelPos, 2, 7, bgcolor = panelBgColor, border_width = 1)
        table.cell(btPanel, 0, 0, "BACKTEST", text_color = color.white, bgcolor = color.new(color.gray, 50))
        table.cell(btPanel, 1, 0, btModelInput, text_color = color.silver, bgcolor = color.new(color.gray, 50))
        table.cell(btPanel, 0, 1, "Entries sent", text_color = color.silver)
        table.cell(btPanel, 1, 1, str.tostring(btEntries), text_color = color.white)
        table.cell(btPanel, 0, 2, "Engine n", text_color = color.silver)
        table.cell(btPanel, 1, 2, str.tostring(btEngineN) + (btIsOpen ? "  (+1 open)" : ""), text_color = color.white)
        table.cell(btPanel, 0, 3, "Tester R", text_color = color.silver)
        table.cell(btPanel, 1, 3, btFixedCash ? str.tostring(strategy.netprofit / btRiskCash, "0.00") + "R" : "n/a (% sizing)", text_color = color.white)
        table.cell(btPanel, 0, 4, "Engine Total R", text_color = color.silver)
        table.cell(btPanel, 1, 4, str.tostring(btEngineR, "0.00") + "R", text_color = color.white)
        table.cell(btPanel, 0, 5, "Capped trades", text_color = color.silver)
        table.cell(btPanel, 1, 5, str.tostring(btCapped), text_color = btCapped > 0 ? color.orange : color.white)
        table.cell(btPanel, 0, 6, "Comparable", text_color = color.silver)
        table.cell(btPanel, 1, 6, btIsOpen ? "trade open — wait for flat" : "yes — flat", text_color = btIsOpen ? color.orange : color.white)
```

`panelBgColor` is the indicator's existing panel-background input; reusing it keeps the two tables matched. Confirm it exists with `grep -n "^panelBgColor" src/ict-rsi-ma-indicator.pine` (expected: one hit near line 64).

- [ ] **Step 2: Build the strategy file**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1`
Expected: `Built ...\src\ict-rsi-ma-strategy.pine (N lines, 11 alertcondition lines removed).` The count must be 11.

- [ ] **Step 3: Run the build checks**

Run each and compare with the expected output:

```bash
git diff master --stat -- src/ict-rsi-ma-indicator.pine
```
Expected: no output. The indicator is untouched.

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 -Check
```
Expected: `OK: ... is up to date.`

```bash
grep -c "^indicator(" src/ict-rsi-ma-strategy.pine; grep -c "^strategy(" src/ict-rsi-ma-strategy.pine; grep -c "^alertcondition(" src/ict-rsi-ma-strategy.pine
```
Expected: `0`, `1`, `0`.

```bash
diff <(tr -d '\r' < src/ict-rsi-ma-indicator.pine) <(tr -d '\r' < src/ict-rsi-ma-strategy.pine) | grep -c '^<'
```
Expected: `12` — the 11 `alertcondition` lines and the one `indicator(` line are the only lines of the indicator missing from the strategy. Any other number means the build altered something it should not have.

```bash
grep -cE "^(plot|plotshape|plotchar|bgcolor|hline|fill)\(" src/strategy-layer.pine
```
Expected: `0`.

```bash
head -c 3 src/ict-rsi-ma-strategy.pine | od -An -tx1
```
Expected: ` 2f 2f 20` (the bytes of `// `), not `ef bb bf`.

```bash
grep -c "—" src/ict-rsi-ma-indicator.pine; grep -c "—" src/ict-rsi-ma-strategy.pine
```
Expected: both numbers are well above `0` (the em dashes survived). Then `grep -c "â€" src/ict-rsi-ma-strategy.pine` must print `0` (no mojibake).

- [ ] **Step 4: Read-back review**

Read `src/strategy-layer.pine` top to bottom and answer each question in writing in your report. Any "no" is a defect to fix before committing.

1. Does every identifier declared in the layer start with `bt` or `showBt`? Run `grep -cE '\b(bt[A-Z]|showBt|bt\b)' src/ict-rsi-ma-indicator.pine` — expected `0`, proving no collision.
2. Is every engine name the layer reads defined in the indicator? Check each with grep: `trClosed`, `pbClosed`, `trailTrade`, `activeTrade`, `tradeLiveOf`, `stopOnCloseOnly`, `MODEL_TRAIL`, `MODEL_PULLBACK`, `statTrades`, `statSumR`, `panelBgColor`, and the `Trade` fields `side`, `entry`, `stop`, `initialStop`, `tp1`, `tp2`, `tp3`, `openBar`, `tpHit`, `closeReason`, `runner`.
3. Is every read of a `bt.` field inside a block that can only run when `bt` is not `na`? (`if btOpenedNow` — set only inside `if not na(bt)`; `if tradeLiveOf(bt)` — false on `na`; the close block's explicit `if not na(bt)`.) Is there any `bt.` read in an expression that also tests `na(bt)`? There must be none.
4. Does the layer assign to any field of `bt`, `activeTrade` or `trailTrade`? It must not.
5. With `runner` true and `stopOnCloseOnly` true, is `strategy.exit("TP3", ...)` skipped? With either one false, is it issued?
6. After the engine counts TP1 (`tpHit` becomes 1), is `"TP1"` no longer re-issued while `"TP2"` and `"TP3"` still are?
7. Is `strategy.close` reached on the closing bar for all four close reasons — Stopped (wick), Stopped (close-only), Target, Invalidated?
8. Does any `ta.*` call, `plot`, `var` inside a function, or user-defined function appear in the layer? None should.
9. Is the `switch` for `btPanelPos` the same shape as the indicator's own `panelPos` switch (four cases, default last)?

- [ ] **Step 5: Commit**

```bash
git add src/strategy-layer.pine src/ict-rsi-ma-strategy.pine
git commit -m "feat: add the Strategy Tester order layer and the generated strategy script"
```

---

### Task 3: README, both languages

**Files:**
- Modify: `README.md` (intro table near line 9; `## Alerts` near line 446; "decision-support tools" paragraph near line 691; `## Repository layout` near line 697)
- Modify: `README.ar.md` (the matching places: intro table; `## التنبيهات (Alerts)` near line 431; `## أمور تستحق المعرفة قبل تداول أي من الاثنين` near line 652; `## هيكل المستودع` near line 678)

**Interfaces:**
- Consumes: the input names and defaults from Task 2 — `Backtest Model` (Pullback), `Sizing` (Fixed Cash Risk), `Risk per Trade (cash)` (1000), `Risk per Trade (% of equity)` (1.0), `Max Position (% of equity)` (0), `Show Backtest Panel` (on), `Backtest Panel Position` (Bottom Left); the BACKTEST table's row labels; the build commands from Task 1.
- Produces: documentation only.

Line numbers are approximate; find each place by its heading or quoted text.

- [ ] **Step 1: Correct the opening claim in `README.md`**

Replace:

```markdown
Two Pine Script v6 indicators for TradingView, written to be read as much as used. Both are single
self-contained files — no libraries, no external data, nothing to install beyond pasting the script
into TradingView.
```

with:

```markdown
Two Pine Script v6 indicators for TradingView, written to be read as much as used. Both are single
self-contained files — no libraries, no external data, nothing to install beyond pasting the script
into TradingView. The confluence indicator also has a generated strategy twin, for running its
trades through TradingView's Strategy Tester.
```

and add this row to the table directly below it, after the `ict-rsi-ma-indicator.pine` row:

```markdown
| [`src/ict-rsi-ma-strategy.pine`](src/ict-rsi-ma-strategy.pine) | The same script as a strategy — identical engine, plus orders — for the Strategy Tester. Generated; see [Backtesting](#backtesting-in-the-strategy-tester) | On the price chart |
```

- [ ] **Step 2: Add the backtesting section to `README.md`**

Insert immediately before the `## Alerts` heading:

````markdown
## Backtesting in the Strategy Tester

The PERFORMANCE rows report in R and stop there. `src/ict-rsi-ma-strategy.pine` is the same script
declared as a strategy, so TradingView's Strategy Tester can add what the panel cannot: an equity
curve, drawdown, commission, slippage and position sizing in money.

It is also a check on the panel. Every number in PERFORMANCE is the engine grading its own work; the
Tester is a second accounting of the same trades by TradingView's broker emulator.

Install it the same way as the indicator — paste, **Add to chart** — and open the **Strategy Tester**
tab. It counts as one of your chart's indicators. It has no alerts; keep the indicator for those.

**The order layer decides nothing.** It reports the engine's trades as orders: a market entry at the
close of the bar a trade opens, three exits of one third each at the three targets, and a resting
stop moved every bar to wherever the engine's stop is. The scale-out in thirds is the same convention
the PERFORMANCE rows already use — here the thirds are real orders.

**One model per run.** A strategy holds one net position per symbol, and the two entry models can be
open at once and in opposite directions. `Backtest Model` picks which one sends orders. The other
still draws and still reports in the panel.

### Two ways to run it

**To check the Tester against the panel** — leave everything at its default. `Sizing` is
`Fixed Cash Risk`, so every trade risks the same amount and *Net Profit ÷ Risk per Trade* is the
result in R. The **BACKTEST** table does the division for you and sets the two side by side:

| Row | Meaning |
|---|---|
| Entries sent | Orders the layer has placed. Should equal `Engine n` |
| Engine n | The selected model's closed trades, as in PERFORMANCE |
| Tester R | Strategy Tester net profit ÷ `Risk per Trade (cash)` |
| Engine Total R | The selected model's Total R, as in PERFORMANCE |
| Capped trades | Trades shrunk by `Max Position` |
| Comparable | The two sides only agree exactly while no trade is open |

**To see realistic results** — set `Sizing` to `% of Equity Risk`, set `Max Position (% of equity)`
to 100 on a cash-equity market, and enter your broker's real commission and slippage in the
strategy's **Properties** tab. Turn `Long Trades Only` on where you cannot short.

### Where the Tester and the panel will differ

These are expected. Anything else is a bug.

- **A stop and a target inside one bar.** The engine always books the stop first. The Tester infers
  the path from the bar's shape and may fill the target first.
- **A gap through a target.** The engine books the target price; the Tester fills at the better open.
- **Quantity rounding.** Thirds of a rounded position are not exact thirds.
- **Trade count.** The Tester lists each one-third exit as its own trade, so its count runs up to
  three times the panel's n. Compare `Entries sent`, not the Tester's trade count.
- **A trade still open.** It is in `Entries sent` but not yet in n, and thirds it has banked are in
  net profit but not yet in Total R.
- **Capped trades**, and **costs** once you set commission or slippage.

### Settings

| Setting | Default | What it does |
|---|---|---|
| Backtest Model | Pullback | Which entry model sends orders. Selecting Trail does not switch the trail model on — `Enable Trailing Stop Model` does |
| Sizing | Fixed Cash Risk | `Fixed Cash Risk` for the cross-check, `% of Equity Risk` for compounding |
| Risk per Trade (cash) | 1000 | Cash lost if the initial stop is hit |
| Risk per Trade (% of equity) | 1.0 | Share of current equity lost if the initial stop is hit |
| Max Position (% of equity) | 0 | Caps position value; 0 is no cap. Sizing by risk with a tight stop can ask for more than the account holds |
| Show Backtest Panel | on | The BACKTEST table |
| Backtest Panel Position | Bottom Left | If it matches `Panel Position`, one table hides the other |

### The strategy file is generated

Never edit `src/ict-rsi-ma-strategy.pine`. It is built from the indicator plus
`src/strategy-layer.pine`, so the two scripts cannot drift apart:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 -Check
```

The first rebuilds it; run it after any change to the indicator or the layer. The second changes
nothing and reports whether the committed file is stale — run it before trusting a Tester number.

````

- [ ] **Step 3: Correct the "not a strategy" paragraph in `README.md`**

Replace:

```markdown
**These are decision-support tools, not a strategy.** Neither script backtests, sizes a position, or
places an order. The trade engine computes levels and records what would have happened; it does not
size a position and it has no idea what your account can absorb. No indicator knows the future, and
confluence between several lagging measurements is still lagging. Nothing here is financial advice.
```

with:

```markdown
**These are decision-support tools, not a trading system.** Neither indicator sizes a position or
places an order. The trade engine computes levels and records what would have happened. The strategy
twin runs those same trades through TradingView's Strategy Tester with a position size, but a
backtest is still a record of the past under assumed fills — it has no idea what your account can
absorb, and it places no live orders. No indicator knows the future, and confluence between several
lagging measurements is still lagging. Nothing here is financial advice.
```

- [ ] **Step 4: Update the repository layout in `README.md`**

Replace:

```
src/                    the two Pine scripts
docs/img/               diagrams used by this README
```

with:

```
src/                    the two indicators, the order layer fragment (strategy-layer.pine)
                        and the generated strategy (ict-rsi-ma-strategy.pine — never edit)
tools/                  build-strategy.ps1, which generates the strategy, and its tests
docs/img/               diagrams used by this README
```

- [ ] **Step 5: Make the same four changes in `README.ar.md`**

Read the surrounding Arabic first and match its conventions: English kept for TradingView and ICT terms and for every input name, Arabic for the prose.

Opening paragraph — append this sentence to the first paragraph under `# مؤشرات TradingView`:

```markdown
وللمؤشر الأول نسخة استراتيجية (strategy) مولَّدة آليًا، لتشغيل صفقاته داخل Strategy Tester في TradingView.
```

and add this row after the `ict-rsi-ma-indicator.pine` row of the table below it:

```markdown
| [`src/ict-rsi-ma-strategy.pine`](src/ict-rsi-ma-strategy.pine) | نفس السكربت كاستراتيجية — المحرك نفسه مع أوامر تنفيذ — لاستخدامه في Strategy Tester. ملف مولَّد؛ انظر [الاختبار الخلفي](#الاختبار-الخلفي-في-strategy-tester) | على الرسم البياني للسعر |
```

Insert immediately before `## التنبيهات (Alerts)`:

````markdown
## الاختبار الخلفي في Strategy Tester

صفوف PERFORMANCE تعرض النتيجة بوحدة R فقط. الملف `src/ict-rsi-ma-strategy.pine` هو السكربت نفسه
معرَّفًا كاستراتيجية، فيضيف Strategy Tester ما لا تستطيعه اللوحة: منحنى رأس المال، أقصى تراجع
(drawdown)، العمولة، الانزلاق السعري (slippage)، وحجم الصفقة بالمال.

وهو أيضًا مراجعة للوحة نفسها. كل رقم في PERFORMANCE هو تقييم المحرك لعمله بنفسه؛ أما Strategy Tester
فمحاسبة ثانية مستقلة للصفقات ذاتها يجريها محاكي الوسيط في TradingView.

يُثبَّت بنفس طريقة المؤشر — لصق ثم **Add to chart** — ثم افتح تبويب **Strategy Tester**. يُحتسب ضمن عدد
المؤشرات المسموح بها على الرسم. لا يحتوي على تنبيهات؛ أبقِ المؤشر لأجلها.

**طبقة الأوامر لا تتخذ أي قرار.** هي تنقل صفقات المحرك كأوامر: دخول بسعر السوق عند إغلاق الشمعة التي
فُتحت فيها الصفقة، وثلاثة خروجات كل منها ثلث الكمية عند الأهداف الثلاثة، ووقف معلَّق يُنقل كل شمعة إلى
حيث يوجد وقف المحرك. الخروج على أثلاث هو نفس العُرف الذي تستخدمه صفوف PERFORMANCE — لكنه هنا أوامر
حقيقية.

**نموذج واحد في كل تشغيل.** الاستراتيجية تحمل مركزًا صافيًا واحدًا لكل رمز، بينما قد يكون نموذجا الدخول
مفتوحين معًا وفي اتجاهين متعاكسين. الإعداد `Backtest Model` يحدد أيهما يرسل الأوامر. الآخر يستمر في
الرسم وفي الظهور باللوحة.

### طريقتان للتشغيل

**لمطابقة Strategy Tester مع اللوحة** — اترك كل شيء على الإعداد الافتراضي. `Sizing` هو
`Fixed Cash Risk`، فكل صفقة تخاطر بالمبلغ نفسه، ويصبح *صافي الربح ÷ Risk per Trade* هو النتيجة بوحدة R.
جدول **BACKTEST** يجري القسمة ويضع الطرفين جنبًا إلى جنب:

| الصف | المعنى |
|---|---|
| Entries sent | عدد الأوامر التي أرسلتها الطبقة. يجب أن يساوي `Engine n` |
| Engine n | الصفقات المغلقة للنموذج المختار، كما في PERFORMANCE |
| Tester R | صافي ربح Strategy Tester ÷ `Risk per Trade (cash)` |
| Engine Total R | إجمالي R للنموذج المختار، كما في PERFORMANCE |
| Capped trades | الصفقات التي صغَّرها `Max Position` |
| Comparable | الطرفان لا يتطابقان تمامًا إلا حين لا توجد صفقة مفتوحة |

**لرؤية نتائج واقعية** — اجعل `Sizing` على `% of Equity Risk`، واجعل `Max Position (% of equity)` 100 في
أسواق الأسهم النقدية، وأدخل عمولة وسيطك وانزلاقه الحقيقيين في تبويب **Properties** للاستراتيجية. فعِّل
`Long Trades Only` حيث لا يمكنك البيع على المكشوف.

### أين سيختلف Strategy Tester عن اللوحة

هذه الفروق متوقعة. أي فرق غيرها خطأ برمجي.

- **وقف وهدف داخل الشمعة نفسها.** المحرك يسجّل الوقف أولًا دائمًا. أما Strategy Tester فيستنتج المسار من
  شكل الشمعة وقد ينفّذ الهدف أولًا.
- **فجوة سعرية تتجاوز الهدف.** المحرك يسجّل سعر الهدف؛ Strategy Tester ينفّذ عند سعر الافتتاح الأفضل.
- **تقريب الكمية.** أثلاث مركز مقرَّب ليست أثلاثًا دقيقة.
- **عدد الصفقات.** Strategy Tester يعرض كل خروج بثلث الكمية كصفقة مستقلة، فيصل عدده إلى ثلاثة أضعاف n في
  اللوحة. قارن `Entries sent` لا عدد صفقات Strategy Tester.
- **صفقة ما زالت مفتوحة.** تدخل في `Entries sent` ولا تدخل بعد في n، وأثلاثها المحققة تدخل في صافي الربح
  ولا تدخل بعد في Total R.
- **الصفقات المصغَّرة (Capped)**، و**التكاليف** عند إدخال عمولة أو انزلاق.

### الإعدادات

| الإعداد | الافتراضي | ماذا يفعل |
|---|---|---|
| Backtest Model | Pullback | أي نموذج دخول يرسل الأوامر. اختيار Trail لا يشغّل نموذج الـ trail — الذي يشغّله هو `Enable Trailing Stop Model` |
| Sizing | Fixed Cash Risk | `Fixed Cash Risk` للمطابقة، و`% of Equity Risk` للنمو المركَّب |
| Risk per Trade (cash) | 1000 | المبلغ المفقود إذا ضُرب الوقف الأولي |
| Risk per Trade (% of equity) | 1.0 | نسبة رأس المال الحالي المفقودة إذا ضُرب الوقف الأولي |
| Max Position (% of equity) | 0 | سقف لقيمة المركز؛ 0 يعني بلا سقف. التحجيم بالمخاطرة مع وقف ضيق قد يطلب مركزًا أكبر من الحساب |
| Show Backtest Panel | مفعَّل | جدول BACKTEST |
| Backtest Panel Position | Bottom Left | إذا طابق `Panel Position` أخفى أحد الجدولين الآخر |

### ملف الاستراتيجية مولَّد

لا تعدّل `src/ict-rsi-ma-strategy.pine` يدويًا أبدًا. هو يُبنى من المؤشر مع `src/strategy-layer.pine`، فلا
يمكن أن يتباعد السكربتان:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 -Check
```

الأمر الأول يعيد بناءه؛ شغّله بعد أي تغيير في المؤشر أو في الطبقة. الثاني لا يغيّر شيئًا ويخبرك إن كان
الملف المحفوظ قديمًا — شغّله قبل الوثوق بأي رقم من Strategy Tester.

````

Under `## أمور تستحق المعرفة قبل تداول أي من الاثنين`, find the paragraph that is the Arabic counterpart of "These are decision-support tools, not a strategy" (it says neither script backtests, sizes a position or places an order) and replace it with:

```markdown
**هذه أدوات لدعم القرار، وليست نظام تداول.** لا يحدد أي من المؤشرين حجم مركز ولا يرسل أمرًا. محرك
الصفقات يحسب المستويات ويسجّل ما كان سيحدث. النسخة الاستراتيجية تمرّر الصفقات نفسها عبر Strategy Tester
بحجم مركز، لكن الاختبار الخلفي يبقى سجلًا للماضي بتنفيذات مفترضة — لا يعرف ما يتحمله حسابك، ولا يرسل
أوامر حقيقية. لا يوجد مؤشر يعرف المستقبل، وتوافق عدة قياسات متأخرة يبقى متأخرًا. لا شيء هنا نصيحة مالية.
```

Under `## هيكل المستودع`, replace the `src/` line of the code block (the line describing `src/` as the two Pine scripts) with these lines, keeping the rest of the block as it is:

```
src/                    المؤشران، وطبقة الأوامر (strategy-layer.pine)
                        والاستراتيجية المولَّدة (ict-rsi-ma-strategy.pine — لا تُعدَّل يدويًا)
tools/                  build-strategy.ps1 الذي يولّد الاستراتيجية، مع اختباراته
```

- [ ] **Step 6: Verify the READMEs against the code**

```bash
for n in "Backtest Model" "Sizing" "Risk per Trade (cash)" "Risk per Trade (% of equity)" "Max Position (% of equity)" "Show Backtest Panel" "Backtest Panel Position" "Entries sent" "Engine n" "Tester R" "Engine Total R" "Capped trades" "Comparable"; do printf '%s: layer=%s en=%s ar=%s\n' "$n" "$(grep -cF "\"$n\"" src/strategy-layer.pine)" "$(grep -cF "$n" README.md)" "$(grep -cF "$n" README.ar.md)"; done
```
Expected: every `layer`, `en` and `ar` count is at least 1. A `layer=0` means the README names something the script does not have.

```bash
grep -c "Neither script backtests" README.md; grep -c "backtesting-in-the-strategy-tester" README.md
```
Expected: `0`, then at least `1`.

- [ ] **Step 7: Commit**

```bash
git add README.md README.ar.md
git commit -m "docs: document Strategy Tester backtesting in both READMEs"
```

---

### Task 4: Live pass and cross-check on TradingView

**Runs in the main session with the user, not a subagent.** It uses the user's logged-in TradingView account, where only one session and one saved layout exist.

**Files:**
- Create: `docs/superpowers/plans/2026-10-05-strategy-backtest-validation.md`

**Interfaces:**
- Consumes: `src/ict-rsi-ma-strategy.pine` from Task 2.
- Produces: the recorded verdict on whether the strategy is trustworthy.

**Pass rule, fixed before any number is read** (from the spec — do not adjust it after seeing results): on each of ELEC 1D, ABUK 4H, MASR 1D and XRP 1H, at default settings, with the selected model flat, `Entries sent` equals `Engine n` exactly, and `Tester R` is within the larger of 2% or 0.5R of `Engine Total R`. All four must pass individually.

- [ ] **Step 1: Confirm the build is current**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 -Check`
Expected: `OK: ... is up to date.`

- [ ] **Step 2: Ask the user before touching their chart**

Ask the user to (a) confirm they are logged in and not using TradingView in another browser, and (b) confirm the chart has a free indicator slot, or free one themselves. Do not remove any of their indicators. Turn layout Autosave off before adding anything (`[data-qa-id="save-load-menu-item-auto-save"]`, DOM click).

- [ ] **Step 3: Load and compile the strategy**

Load the clipboard with `Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 src/ict-rsi-ma-strategy.pine)`. In the Pine Editor click a rendered code line, `Control+a`, `Control+v`. Confirm the status bar reads `Line <N+1>, Col 1` against `wc -l`. Click **Add to chart**.

Expected: no compile error, the script appears in the legend as `ICT-RSI-MA-ST`, the STRUCTURE/PERFORMANCE panel and the BACKTEST table both draw, and the Strategy Tester tab shows trades. If the panel does not draw and no error shows, suspect the indicator cap before the code.

If it fails to compile: fix `src/strategy-layer.pine` (never the generated file), rebuild, repeat this step, and record each error and fix in the validation document.

- [ ] **Step 4: Prove the engine survived the build**

On ELEC 1D, read n and Total R from the strategy's PERFORMANCE rows, then from the indicator on the same chart and settings (swap the scripts if the slot cap does not allow both). They must be identical. A difference means the build changed engine behaviour — stop and investigate before any cross-check.

- [ ] **Step 5: Run the cross-check on the four charts**

For each of ELEC 1D, ABUK 4H, MASR 1D, XRP 1H at default settings: wait ~15 seconds after the chart settles, read the six BACKTEST rows and the Tester's Net Profit, and apply the pass rule. If `Comparable` reads "trade open", note the open trade's banked thirds and judge the rule on the closed trades only.

Also confirm, on any one chart, that a trade which reached all three targets shows as three rows in the Tester's List of Trades.

- [ ] **Step 6: Trace any miss**

For a chart that fails: turn `Log Closed Trades` on, download the Pine log CSV, export the Tester's List of Trades, and match them trade by trade. Each differing trade must be explained by one of the spec's known differences. One that is not is a bug: fix the layer, rebuild, and rerun Steps 3–5 on all four charts.

- [ ] **Step 7: Record a realistic run**

On the same four charts: `Sizing` = `% of Equity Risk`, `Max Position` = 100 on the three EGX charts, `Long Trades Only` on for EGX, and commission and slippage as the user specifies. Record net profit, max drawdown, profit factor and capped trades. This is a first reading, not a pass/fail.

- [ ] **Step 8: Restore the chart**

`page.goto` the layout URL, accept the beforeunload prompt to discard the test changes, then turn Autosave back on. Confirm the legend shows the user's original indicators.

- [ ] **Step 9: Write up and commit**

Write `docs/superpowers/plans/2026-10-05-strategy-backtest-validation.md` with: the pass rule as quoted above; a table of the four charts (Entries sent, Engine n, Tester R, Engine Total R, difference, pass/fail); every traced difference and which known cause it fell under; every compile error met and its fix; the realistic-run figures; and a one-paragraph verdict. If any chart failed and was not resolved, say so plainly. Update the spec's Status line to match the outcome.

```bash
git add docs/superpowers/plans/2026-10-05-strategy-backtest-validation.md docs/superpowers/specs/2026-10-05-strategy-tester-backtest-design.md
git commit -m "docs: record the Strategy Tester cross-check results"
```
