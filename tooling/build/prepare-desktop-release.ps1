param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$desktopDir = Join-Path $repoRoot "apps\desktop"
$stagingRoot = Join-Path $desktopDir "build-resources"
$integrationDir = Join-Path $stagingRoot "memoq-integration"
$helperStagingDir = Join-Path $desktopDir "helper"
$pluginCandidates = @(
    (Join-Path $repoRoot "native\plugin\MemoQ.AI.Desktop.Plugin\bin\$Configuration\net48\MemoQ.AI.Hub.Plugin.dll"),
    (Join-Path $repoRoot "native\plugin\MemoQ.AI.Desktop.Plugin\bin\$Configuration\net48\MemoQ.AI.Desktop.Plugin.dll")
)
$previewHelperProject = Join-Path $repoRoot "native\preview-helper\MemoQ.AI.Preview.Helper\MemoQ.AI.Preview.Helper.csproj"
$previewHelperOutputDir = Join-Path $repoRoot "native\preview-helper\MemoQ.AI.Preview.Helper\bin\forge\$Configuration\net48"
$previewHelperOutput = Join-Path $previewHelperOutputDir "MemoQ.AI.Preview.Helper.exe"
$previewHelperIntermediate = Join-Path $repoRoot "native\preview-helper\MemoQ.AI.Preview.Helper\obj\forge\$Configuration"
$clientDevConfig = Join-Path $repoRoot "docs\reference\ClientDevConfig.xml"
$pluginSource = $pluginCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:DOTNET_CLI_UI_LANGUAGE = "en"
$env:VSLANG = "1033"

if (-not $pluginSource) {
    throw "Built plugin DLL not found. Checked: $($pluginCandidates -join ', ')"
}

if (-not (Test-Path $clientDevConfig)) {
    throw "ClientDevConfig.xml not found: $clientDevConfig"
}

New-Item -ItemType Directory -Force -Path $integrationDir | Out-Null
New-Item -ItemType Directory -Force -Path $helperStagingDir | Out-Null
Copy-Item -Force $pluginSource (Join-Path $integrationDir "MemoQ.AI.Hub.Plugin.dll")
Copy-Item -Force $clientDevConfig (Join-Path $integrationDir "ClientDevConfig.xml")

if (Test-Path $previewHelperProject) {
    New-Item -ItemType Directory -Force -Path $previewHelperIntermediate | Out-Null
    dotnet build $previewHelperProject -c $Configuration `
        -p:BaseIntermediateOutputPath="$previewHelperIntermediate\" `
        -p:IntermediateOutputPath="$previewHelperIntermediate\" `
        -p:OutputPath="$previewHelperOutputDir\" | Out-Host
    if (-not (Test-Path $previewHelperOutput)) {
        throw "Built preview helper EXE not found: $previewHelperOutput"
    }
    Copy-Item -Force $previewHelperOutput (Join-Path $helperStagingDir "MemoQ.AI.Preview.Helper.exe")
}

Write-Host "Prepared desktop release resources:"
Write-Host "  - Plugin: $pluginSource"
Write-Host "  - Staging: $integrationDir"
if (Test-Path $previewHelperOutput) {
    Write-Host "  - Preview helper: $previewHelperOutput"
}
