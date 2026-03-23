param(
    [string]$SourceDir = "",
    [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$desktopDir = Join-Path $repoRoot "apps\desktop"

function Get-SevenZipCommand() {
    $commandCandidates = @("7z", "7za", "7zr")
    foreach ($commandName in $commandCandidates) {
        $command = Get-Command $CommandName -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    $pathCandidates = @(
        (Join-Path ${env:ProgramFiles} "7-Zip\7z.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "7-Zip\7z.exe")
    ) | Where-Object { $_ }

    foreach ($candidate in $pathCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Get-TarCommand() {
    $command = Get-Command "tar.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $pathCandidates = @(
        (Join-Path $env:SystemRoot "System32\tar.exe")
    ) | Where-Object { $_ }

    foreach ($candidate in $pathCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

if (-not $SourceDir) {
    $SourceDir = Join-Path $desktopDir "out\memoQ AI Hub-win32-x64"
}

if (-not $ZipPath) {
    $ZipPath = Join-Path $desktopDir "out\memoq-ai-hub-win32-x64.zip"
}

if (-not (Test-Path $SourceDir)) {
    throw "Packaged desktop directory not found: $SourceDir"
}

if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}

$sevenZip = Get-SevenZipCommand
$tar = Get-TarCommand

Push-Location $SourceDir
try {
    if ($sevenZip) {
        & $sevenZip a -tzip -y -mx=3 -mmt=on $ZipPath ".\*" | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "7-Zip failed with exit code $LASTEXITCODE."
        }
    } elseif ($tar) {
        & $tar -a -c -f $ZipPath "."
        if ($LASTEXITCODE -ne 0) {
            throw "tar.exe failed with exit code $LASTEXITCODE."
        }
    } else {
        throw "No zip tool is available. Install 7-Zip or ensure Windows tar.exe is available."
    }
} finally {
    Pop-Location
}

Write-Host "Created zip artifact: $ZipPath"
