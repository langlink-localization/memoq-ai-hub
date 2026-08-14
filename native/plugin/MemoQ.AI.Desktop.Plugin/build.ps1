param(
    [string]$Configuration = "Release",
    [string]$SdkRoot = $env:MEMOQ_SDK_DIR
)

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
& (Join-Path $repoRoot "tooling\scripts\build-windows.ps1") -Configuration $Configuration -SdkRoot $SdkRoot
