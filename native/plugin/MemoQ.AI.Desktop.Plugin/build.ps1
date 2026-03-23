param(
    [string]$Configuration = "Release"
)

dotnet build (Join-Path $PSScriptRoot "MemoQ.AI.Desktop.Plugin.csproj") -c $Configuration
