param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectPath = Join-Path $repoRoot "native\plugin\MemoQ.AI.Desktop.Plugin\MemoQ.AI.Desktop.Plugin.csproj"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:DOTNET_CLI_UI_LANGUAGE = "en"
$env:VSLANG = "1033"

if (-not (Test-Path $projectPath)) {
    throw "Plugin project not found: $projectPath"
}

dotnet build $projectPath -c $Configuration
