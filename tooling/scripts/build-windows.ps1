param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$SdkRoot = $env:MEMOQ_SDK_DIR
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectPath = Join-Path $repoRoot "native\plugin\MemoQ.AI.Desktop.Plugin\MemoQ.AI.Desktop.Plugin.csproj"
$resolverPath = Join-Path $PSScriptRoot "resolve-memoq-sdk.ps1"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:DOTNET_CLI_UI_LANGUAGE = "en"
$env:VSLANG = "1033"

if (-not (Test-Path $projectPath)) {
    throw "Plugin project not found: $projectPath"
}

$memoQSdkDir = & $resolverPath -SdkRoot $SdkRoot
if (-not $memoQSdkDir) {
    throw "memoQ SDK resolver did not return a reference directory."
}

dotnet build $projectPath -c $Configuration -p:MemoQSdkDir="$memoQSdkDir"
if ($LASTEXITCODE -ne 0) {
    throw "Plugin build failed with exit code $LASTEXITCODE."
}
