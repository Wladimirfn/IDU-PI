param(
  [ValidateSet('status', 'restart', 'stop')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'bridge-control.log'

function Log($Message) {
  $line = "$(Get-Date -Format o) $Message"
  try {
    Add-Content -Path $LogFile -Value $line -ErrorAction Stop
  } catch {
    Write-Host "Log ocupado; continuo sin escribir esta linea: $Message" -ForegroundColor DarkYellow
  }
  Write-Host $Message
}

function Get-BridgeProcesses {
  $distIndex = [System.IO.Path]::GetFullPath((Join-Path $Root 'dist/src/index.js'))
  $distIndexSlash = $distIndex.Replace('\', '/')
  $rootText = ([string]$Root).TrimEnd('\')
  $rootSlash = $rootText.Replace('\', '/')

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -match '^(node|node\.exe)$' -and
      $_.CommandLine -and (
        $_.CommandLine.Contains($distIndex) -or
        $_.CommandLine.Contains($distIndexSlash) -or
        ($_.CommandLine.Contains($rootText) -and $_.CommandLine.Contains('dist/src/index.js')) -or
        ($_.CommandLine.Contains($rootSlash) -and $_.CommandLine.Contains('dist/src/index.js'))
      )
    }
}

function Stop-BridgeProcesses {
  $matches = @(Get-BridgeProcesses)
  if ($matches.Count -eq 0) {
    Log 'No bridge processes found.'
    return
  }
  foreach ($process in $matches) {
    Log "Stopping bridge PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force
  }
}

if ($Action -eq 'status') {
  $matches = @(Get-BridgeProcesses)
  Log "Bridge process count: $($matches.Count)"
  foreach ($process in $matches) { Log "PID $($process.ProcessId): $($process.CommandLine)" }
  exit 0
}

if ($Action -eq 'stop') {
  Stop-BridgeProcesses
  exit 0
}

if ($Action -eq 'restart') {
  Log 'Restart requested.'
  Start-Sleep -Seconds 2
  Stop-BridgeProcesses
  Log 'Starting bridge via scripts/start-bridge.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts/start-bridge.ps1')
  exit $LASTEXITCODE
}
