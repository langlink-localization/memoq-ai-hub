param(
    [string]$SdkRoot = $env:MEMOQ_SDK_DIR,
    [string]$CacheRoot,
    [switch]$ForceDownload
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sdkVersion = "2.4.4"
$sdkUrl = "https://docs.memoq.com/current/sdk-docs/memoQ-MT-SDK-2.4.4.zip"
$sdkArchiveSha256 = "FCB0E684CD15037E90D8B3B5C658501D9FF53C1FD35243D9739341F336D69386"
$requiredAssemblies = [ordered]@{
    "MemoQ.Addins.Common.dll" = "54ADF687A09C1273803D73550ADD039A71573005D9356F7586C20097D4194720"
    "MemoQ.MTInterfaces.dll" = "D3178228F8422A4BC90D2C12F9D8BA5009E30E50335DDF0A47077FA807C86B5D"
}

function Get-Sha256([string]$Path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

function Find-MemoQReferenceDirectory([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "memoQ SDK directory does not exist: $Root"
    }

    $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
    $candidates = @($resolvedRoot) + @(
        Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Directory -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
    )

    foreach ($candidate in $candidates) {
        $hasAllAssemblies = $true
        foreach ($assemblyName in $requiredAssemblies.Keys) {
            if (-not (Test-Path -LiteralPath (Join-Path $candidate $assemblyName) -PathType Leaf)) {
                $hasAllAssemblies = $false
                break
            }
        }

        if ($hasAllAssemblies) {
            return $candidate
        }
    }

    throw "Could not find MemoQ.Addins.Common.dll and MemoQ.MTInterfaces.dll under $resolvedRoot."
}

if ($SdkRoot) {
    Write-Host "Using memoQ SDK assemblies from MEMOQ_SDK_DIR / -SdkRoot."
    Write-Output (Find-MemoQReferenceDirectory $SdkRoot)
    exit 0
}

if (-not $CacheRoot) {
    $CacheRoot = Join-Path $repoRoot ".memoq-sdk"
}

$versionRoot = Join-Path $CacheRoot "mt-sdk-$sdkVersion"
$archivePath = Join-Path $versionRoot "memoQ-MT-SDK-2.4.4.zip"
$referenceDir = Join-Path $versionRoot "References"

New-Item -ItemType Directory -Force -Path $versionRoot | Out-Null

if ($ForceDownload -or -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    Write-Host "Downloading memoQ MT SDK $sdkVersion from the official memoQ documentation site."
    Invoke-WebRequest -Uri $sdkUrl -OutFile $archivePath
}

$archiveHash = Get-Sha256 $archivePath
if ($archiveHash -ne $sdkArchiveSha256) {
    throw "memoQ SDK archive hash mismatch. Expected $sdkArchiveSha256 but received $archiveHash. Delete $archivePath and retry only after verifying the official artifact."
}

New-Item -ItemType Directory -Force -Path $referenceDir | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($assemblyName in $requiredAssemblies.Keys) {
        $normalizedSuffix = "/Code/References/$assemblyName"
        $entry = $archive.Entries |
            Where-Object { ("/" + ($_.FullName -replace "\\", "/")).EndsWith($normalizedSuffix, [System.StringComparison]::OrdinalIgnoreCase) } |
            Select-Object -First 1

        if (-not $entry) {
            throw "The official SDK archive does not contain $assemblyName at Code/References."
        }

        $destination = Join-Path $referenceDir $assemblyName
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)

        $assemblyHash = Get-Sha256 $destination
        $expectedAssemblyHash = $requiredAssemblies[$assemblyName]
        if ($assemblyHash -ne $expectedAssemblyHash) {
            throw "$assemblyName hash mismatch. Expected $expectedAssemblyHash but received $assemblyHash."
        }
    }
} finally {
    $archive.Dispose()
}

Write-Host "Resolved only the two required memoQ SDK reference assemblies into the ignored local cache."
Write-Output $referenceDir
