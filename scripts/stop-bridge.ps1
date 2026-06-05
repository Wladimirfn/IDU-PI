$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'bridge.log'
function Log($Message) {
  $line = "$(Get-Date -Format o) $Message"
  try {
    Add-Content -Path $LogFile -Value $line -ErrorAction Stop
  } catch {
    Write-Host "Log ocupado; continuo sin escribir esta linea: $Message" -ForegroundColor DarkYellow
  }
}

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
  Log "STEP $Message"
}

Step 'Buscando bridges abiertos'
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

$matches = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.Name -match '^(node|node\.exe)$' -and
    (Test-BridgeCommandLine $_.CommandLine)
  }

if ($matches) {
  foreach ($process in $matches) {
    Write-Host "Cerrando bridge PID $($process.ProcessId)" -ForegroundColor Yellow
    Log "Stopping bridge PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force
  }
} else {
  Write-Host 'No encontre bridges abiertos.' -ForegroundColor Green
  Log 'No bridge processes found.'
}
