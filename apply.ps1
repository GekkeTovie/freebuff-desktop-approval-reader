# Applies the approval-reader stylesheet to a local Freebuff Desktop install.
#
#   .\apply.ps1              # normal run (Freebuff must be closed)
#   .\apply.ps1 -DryRun      # build and verify the patched archive, change nothing
#   .\apply.ps1 -Force       # replace the archive even if Freebuff is still running
#
# Presentation only: one stylesheet is injected into the app windows. Nothing about
# approvals, permissions or tool execution changes.

[CmdletBinding()]
param(
  [string]$AppDir = "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop",
  [switch]$DryRun,
  [switch]$Force,
  [switch]$AnyVersion
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$asar = Join-Path $AppDir 'resources\app.asar'
$pinSha = 'AA6D928700BEF0219E2A2376B3CEC0AF9AB8E3482BA1860581BE4332AB524FF5'
$pinLabel = 'Freebuff Desktop 0.0.205'

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return [string]$cmd.Source }
  $bun = Join-Path $AppDir 'resources\bun\bun.exe'
  if (Test-Path $bun) { return [string]$bun }
  throw 'Neither node nor the bundled bun was found; install Node.js.'
}

if (-not (Test-Path $asar)) { throw "app.asar not found at $asar" }

$nodeExe = Find-Node
$patchTool = Join-Path $here 'tools\patch.mjs'
$css = Join-Path $here 'approval-reader.css'
if (-not (Test-Path $patchTool)) { throw "tools\patch.mjs missing next to this script" }

# Already patched? Stop early instead of nesting a second copy of the block.
& $nodeExe $patchTool --check $asar | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Already patched: this install has the approval-reader stylesheet.' -ForegroundColor Green
  exit 0
}

if (-not $AnyVersion) {
  $sha = (Get-FileHash -Algorithm SHA256 -Path $asar).Hash
  if ($sha -ne $pinSha) {
    throw "This installer is pinned to $pinLabel (app.asar $pinSha).`nFound: $sha`nAn app update changes the archive; check the new build and re-pin, or pass -AnyVersion to try anyway."
  }
}

$running = Get-Process -Name Freebuff -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
  throw 'Freebuff is running. Quit it completely (tray icon too) and run this again, or pass -Force.'
}

$backup = "$asar.orig-0.0.205"
if (-not (Test-Path $backup)) {
  Copy-Item -LiteralPath $asar -Destination $backup
  Write-Host "Backup: $backup"
}

$mode = if ($DryRun) { '--dry-run' } else { '--apply' }
& $nodeExe $patchTool --asar $asar --css $css $mode
if ($LASTEXITCODE -ne 0) { throw 'Patch failed; the install was not modified.' }

if ($DryRun) {
  Write-Host 'Dry run only. Re-run without -DryRun to write it into the install.' -ForegroundColor Yellow
  exit 0
}

Write-Host ''
Write-Host 'Applied. Close Freebuff completely, then start it again to pick it up.' -ForegroundColor Green
Write-Host 'Undo at any time with: .\revert.ps1'
