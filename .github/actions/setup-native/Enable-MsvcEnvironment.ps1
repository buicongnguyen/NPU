param(
    [string] $EnvironmentFile = $env:GITHUB_ENV
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw "vswhere.exe was not found at '$vswhere'"
}

$installationCandidates = & $vswhere `
    -latest `
    -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
$vswhereExitCode = $LASTEXITCODE
$installationPath = $installationCandidates | Select-Object -First 1
if ($vswhereExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($installationPath)) {
    throw 'A Visual Studio installation with the x64 C++ toolchain was not found'
}

$vsDevCmd = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $vsDevCmd -PathType Leaf)) {
    throw "VsDevCmd.bat was not found at '$vsDevCmd'"
}

$before = [System.Collections.Generic.Dictionary[string, string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
Get-ChildItem Env: | ForEach-Object {
    $before[$_.Name] = $_.Value
}

$commandLine = 'call "{0}" -no_logo -arch=x64 -host_arch=x64 && set' -f $vsDevCmd
$environmentLines = & $env:ComSpec /d /c $commandLine
if ($LASTEXITCODE -ne 0) {
    throw "VsDevCmd.bat failed with exit code $LASTEXITCODE"
}

$after = [System.Collections.Generic.Dictionary[string, string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($line in $environmentLines) {
    $separator = $line.IndexOf('=')
    if ($separator -le 0) {
        continue
    }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    if (-not $after.ContainsKey($name)) {
        $after[$name] = $value
        continue
    }

    # Windows environment blocks can contain duplicate names with different
    # casing (for example Path and PATH). VsDevCmd may update only one spelling,
    # so retain the value that differs from the incoming process environment.
    if ($name -ieq 'Path') {
        $existingHasMsvc = $after[$name] -match '\\VC\\Tools\\MSVC\\'
        $candidateHasMsvc = $value -match '\\VC\\Tools\\MSVC\\'
        if ($candidateHasMsvc -and -not $existingHasMsvc) {
            $after[$name] = $value
            continue
        }
        if ($existingHasMsvc -and -not $candidateHasMsvc) {
            continue
        }
    }

    $oldValue = ''
    $hadOldValue = $before.TryGetValue($name, [ref] $oldValue)
    $existingChanged = -not $hadOldValue -or $after[$name] -cne $oldValue
    $candidateChanged = -not $hadOldValue -or $value -cne $oldValue
    if ($candidateChanged -and -not $existingChanged) {
        $after[$name] = $value
    } elseif ($candidateChanged -and $existingChanged -and $after[$name] -cne $value) {
        throw "VsDevCmd.bat emitted conflicting values for environment variable '$name'"
    }
}

$changed = foreach ($entry in $after.GetEnumerator()) {
    $oldValue = ''
    if (-not $before.TryGetValue($entry.Key, [ref] $oldValue) -or $oldValue -cne $entry.Value) {
        $entry
    }
}

foreach ($entry in $changed) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
}

foreach ($tool in @('cl.exe', 'cmake.exe', 'ninja.exe')) {
    if ($null -eq (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is unavailable after initializing the Visual Studio environment"
    }
}

if (-not [string]::IsNullOrWhiteSpace($EnvironmentFile)) {
    foreach ($entry in ($changed | Sort-Object Key)) {
        if ($entry.Key -match '^(GITHUB_|RUNNER_)' -or $entry.Key -eq 'NODE_OPTIONS') {
            continue
        }
        $delimiter = "acim_env_$([Guid]::NewGuid().ToString('N'))"
        Add-Content -LiteralPath $EnvironmentFile -Encoding utf8 -Value @(
            "$($entry.Key)<<$delimiter"
            $entry.Value
            $delimiter
        )
    }
}

Write-Host "Initialized MSVC from $installationPath"
