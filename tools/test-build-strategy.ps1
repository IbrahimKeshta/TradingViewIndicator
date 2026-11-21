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
