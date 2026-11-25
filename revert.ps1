# Restores the original app.asar from the backup apply.ps1 made.
#
#   .\revert.ps1
#   .\revert.ps1 -Force   # restore even if Freebuff is still running

[CmdletBinding()]
param(
  [string]$AppDir = "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop",
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$asar = Join-Path $AppDir 'resources\app.asar'
if (-not (Test-Path $asar)) { throw "app.asar not found at $asar" }

$backup = Get-ChildItem -Path "$asar.orig-*" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $backup) { throw "No backup found next to $asar (looked for app.asar.orig-*)." }

$running = Get-Process -Name Freebuff -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
  throw 'Freebuff is running. Quit it completely (tray icon too) and run this again, or pass -Force.'
}

Copy-Item -LiteralPath $backup.FullName -Destination $asar -Force
Write-Host "Restored $asar from $($backup.Name)" -ForegroundColor Green
Write-Host 'Close Freebuff completely, then start it again.'
