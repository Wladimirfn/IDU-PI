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
  $rootSlash = ([string]$Root).TrimEnd('\').Replace('\', '/')
  $rootBoundaryPattern = '(^|[^A-Za-z0-9._-])' + [regex]::Escape($rootSlash) + '(?=$|[^A-Za-z0-9._-])'

  function Test-BridgeCommandLine($CommandLine) {
    if (-not $CommandLine) { return $false }
    $commandSlash = ([string]$CommandLine).Replace('\', '/')
    return $commandSlash.Contains($distIndexSlash) -or
      (($commandSlash -match $rootBoundaryPattern) -and $commandSlash.Contains('dist/src/index.js'))
  }

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -match '^(node|node\.exe)$' -and
      (Test-BridgeCommandLine $_.CommandLine)
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
  Log 'Starting bridge via scripts/start-bridge.ps1 (detached)'
  $startBridge = Join-Path $Root 'scripts/start-bridge.ps1'
  # Record the launch time so we can tell the NEW bridge's pidfile apart from a
  # stale one. #493: Stop-Process -Force does not run graceful shutdown, so
  # deletePidfile (src/bridge-pidfile.ts) never fires and the old bridge.pid
  # survives on disk. Its PID was just freed — if Windows recycles it, the PID
  # alone would falsely read as alive before the bridge starts. The project
  # already trusts pidfile mtime freshness for liveness (HEARTBEAT_INTERVAL_MIN
  # in src/bridge-pidfile.ts); apply the same convention here.
  $startedAt = Get-Date
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$startBridge) -WindowStyle Hidden

  $pidfile = Join-Path $Root 'bridge.pid'
  $deadline = (Get-Date).AddSeconds(50)
  $alivePid = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $pidfile) {
      # Reject a stale pidfile: it must have been WRITTEN after we launched.
      # A recycled PID or a leftover file cannot satisfy this, so a freed-and-
      # recycled PID cannot produce a false success.
      $fresh = $false
      try {
        $fresh = (Get-Item $pidfile).LastWriteTime -gt $startedAt
      } catch {
        $fresh = $false
      }
      if ($fresh) {
        try {
          $candidate = [int](Get-Content $pidfile -Raw -ErrorAction Stop).Trim()
        } catch {
          $candidate = 0
        }
        if ($candidate -gt 0) {
          $proc = Get-Process -Id $candidate -ErrorAction SilentlyContinue
          if ($proc) {
            $alivePid = $candidate
            break
          }
        }
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if ($alivePid) {
    Log "Bridge alive PID $alivePid"
    exit 0
  }

  Log 'Bridge did not come up within the deadline (no fresh live pidfile).'
  exit 1
}
