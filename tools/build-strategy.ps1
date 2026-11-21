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
