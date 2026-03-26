param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$desktopDir = Join-Path $repoRoot "apps\desktop"
$desktopOutDir = Join-Path $desktopDir "out"
$updateManifestPath = Join-Path $desktopOutDir "memoq-ai-hub-updates-stable.json"
$dotnetDefaultPath = Join-Path ${env:ProgramFiles} "dotnet"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:DOTNET_CLI_UI_LANGUAGE = "en"
$env:VSLANG = "1033"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Command([string]$CommandName, [string]$InstallHint) {
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command
    }

    throw "$CommandName is not available. $InstallHint"
}

function Ensure-Dotnet() {
    $dotnet = Get-Command "dotnet" -ErrorAction SilentlyContinue
    if ($dotnet) {
        return $dotnet
    }

    if (Test-Path $dotnetDefaultPath) {
        $env:Path = "$dotnetDefaultPath;$env:Path"
        $dotnet = Get-Command "dotnet" -ErrorAction SilentlyContinue
        if ($dotnet) {
            return $dotnet
        }
    }

    throw "dotnet is not available. Install the .NET SDK or add C:\Program Files\dotnet to PATH before running tooling/scripts/package-windows.ps1."
}

function Get-DesktopVersion() {
    $versionOutput = & node (Join-Path $repoRoot "tooling\scripts\release-metadata.mjs") version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read desktop version from apps/desktop/package.json. node returned exit code $LASTEXITCODE. Output: $versionOutput"
    }

    $normalized = ($versionOutput | Out-String).Trim()
    if (-not $normalized) {
        throw "Unable to read desktop version from apps/desktop/package.json."
    }
    return $normalized
}

function Get-ArtifactFiles([string]$Pattern) {
    if (-not (Test-Path $desktopOutDir)) {
        throw "apps/desktop/out was not created. Packaging did not produce output."
    }

    return @(Get-ChildItem -Path $desktopOutDir -Recurse -File -Filter $Pattern -ErrorAction SilentlyContinue)
}

function Invoke-NativeStep([string]$Command, [scriptblock]$Action) {
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

function Get-UnpackedAppDir() {
    if (-not (Test-Path $desktopOutDir)) {
        throw "apps/desktop/out was not created. Packaging did not produce output."
    }

    return @(Get-ChildItem -Path $desktopOutDir -Directory -Filter "*win32-x64" -ErrorAction SilentlyContinue | Select-Object -First 1)
}

Write-Step "Validating toolchain"
Ensure-Dotnet | Out-Null
Ensure-Command "node" "Install Node.js 22.x and ensure it is available in PATH." | Out-Null
Ensure-Command "pnpm" "Install pnpm and ensure it is available in PATH." | Out-Null

$desktopVersion = Get-DesktopVersion

Write-Step "Building memoQ desktop plugin"
& (Join-Path $repoRoot "tooling\scripts\build-windows.ps1") -Configuration $Configuration

Write-Step "Preparing packaged desktop resources"
& (Join-Path $repoRoot "tooling\build\prepare-desktop-release.ps1") -Configuration $Configuration

Write-Step "Installing workspace dependencies"
Push-Location $repoRoot
try {
    Invoke-NativeStep "pnpm install" { pnpm install }
} finally {
    Pop-Location
}

Push-Location $desktopDir
try {
    Write-Step "Running desktop tests"
    Invoke-NativeStep "pnpm test" { pnpm test }

    Write-Step "Packaging unpacked desktop application"
    Invoke-NativeStep "pnpm run package" { pnpm run package }

    Write-Step "Creating packaged desktop zip"
    Invoke-NativeStep "pnpm run zip:win-unpacked" { pnpm run zip:win-unpacked }

} finally {
    Pop-Location
}

Write-Step "Writing update manifest"
& node (Join-Path $repoRoot "tooling\scripts\release-metadata.mjs") write-manifest $updateManifestPath (Get-Date).ToUniversalTime().ToString("o")
if ($LASTEXITCODE -ne 0) {
    throw "Unable to write update manifest."
}

$unpackedAppDir = @(Get-UnpackedAppDir)
$portableExe = @(Get-ArtifactFiles "*.exe" | Where-Object { $_.DirectoryName -like "*win32-x64*" -and $_.Name -notlike "*Setup*.exe" } | Select-Object -First 1)
$expectedZipPath = Join-Path $desktopOutDir "memoq-ai-hub-win32-x64.zip"
$zipFiles = @()
if (Test-Path $expectedZipPath) {
    $zipFiles = @((Get-Item $expectedZipPath))
}

if (-not $unpackedAppDir) {
    throw "Unpacked desktop application directory was not produced under $desktopOutDir."
}

if (-not $portableExe) {
    throw "Portable EXE was not produced under $desktopOutDir."
}

if (-not $zipFiles.Count) {
    throw "ZIP artifact was not produced at $expectedZipPath."
}

if (-not (Test-Path $updateManifestPath)) {
    throw "Update manifest was not produced at $updateManifestPath."
}

Write-Host ""
Write-Host "Windows packaging completed successfully." -ForegroundColor Green
Write-Host "Version     : $desktopVersion"
Write-Host "Output root : $desktopOutDir"
Write-Host "App dir     : $($unpackedAppDir[0].FullName)"
Write-Host "Portable EXE: $($portableExe[0].FullName)"
Write-Host "Manifest    : $updateManifestPath"
Write-Host "ZIP files   :"
foreach ($zipFile in $zipFiles) {
    Write-Host "  - $($zipFile.FullName)"
}
