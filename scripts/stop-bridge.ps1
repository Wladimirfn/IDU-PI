$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'bridge.log'
function Log($Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogFile -Value $line
}

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
  Log "STEP $Message"
}

Step 'Buscando bridges abiertos'
$distIndex = [System.IO.Path]::GetFullPath((Join-Path $Root 'dist/src/index.js'))
$distIndexSlash = $distIndex.Replace('\', '/')
$rootText = ([string]$Root).TrimEnd('\')
$rootSlash = $rootText.Replace('\', '/')

$matches = Get-CimInstance Win32_Process |
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
