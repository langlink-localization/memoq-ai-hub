param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$SdkRoot = $env:MEMOQ_SDK_DIR,
    [string]$RuntimeRoot = $env:MEMOQ_RUNTIME_DIR
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resolverPath = Join-Path $PSScriptRoot "resolve-memoq-sdk.ps1"
$projectPath = Join-Path $repoRoot "tests\plugin-regression\PluginRegression.csproj"

if (-not $RuntimeRoot) {
    $memoQInstallRoot = Join-Path ([Environment]::GetFolderPath("ProgramFiles")) "memoQ"
    if (Test-Path -LiteralPath $memoQInstallRoot) {
        $RuntimeRoot = Get-ChildItem -LiteralPath $memoQInstallRoot -Directory -Filter "memoQ-*" |
            Sort-Object Name -Descending |
            Where-Object {
                (Test-Path -LiteralPath (Join-Path $_.FullName "MemoQ.Addins.Common.dll")) -and
                (Test-Path -LiteralPath (Join-Path $_.FullName "MemoQ.MTInterfaces.dll")) -and
                (Test-Path -LiteralPath (Join-Path $_.FullName "Kilgray.Utils.dll"))
            } |
            Select-Object -First 1 -ExpandProperty FullName
    }
}

if (-not $RuntimeRoot -or -not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
    throw "Plugin regression tests require a locally licensed memoQ installation. Set MEMOQ_RUNTIME_DIR to its installation directory."
}

if (-not $SdkRoot) {
    $SdkRoot = $RuntimeRoot
}

$memoQSdkDir = & $resolverPath -SdkRoot $SdkRoot

if (-not $memoQSdkDir) {
    throw "memoQ SDK resolver did not return a reference directory."
}

$previousRuntimeDirectory = $env:MEMOQ_TEST_RUNTIME_DIR
try {
    $env:MEMOQ_TEST_RUNTIME_DIR = (Resolve-Path -LiteralPath $RuntimeRoot).Path
    dotnet run --project $projectPath -c $Configuration -p:MemoQSdkDir="$memoQSdkDir"
    if ($LASTEXITCODE -ne 0) {
        throw "Plugin regression tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousRuntimeDirectory) {
        Remove-Item Env:MEMOQ_TEST_RUNTIME_DIR -ErrorAction SilentlyContinue
    }
    else {
        $env:MEMOQ_TEST_RUNTIME_DIR = $previousRuntimeDirectory
    }
}
