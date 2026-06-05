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

function Invoke-Checked($FilePath, $Arguments) {
  $display = @($FilePath) + @($Arguments)
  Write-Host ("> " + ($display -join ' ')) -ForegroundColor DarkGray
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $($display -join ' ')"
  }
}

Step 'Validando configuracion'
if (-not (Test-Path (Join-Path $Root '.env'))) {
  Write-Host 'No existe .env. Ejecutando setup inicial...' -ForegroundColor Yellow
  Invoke-Checked 'node' @('scripts/setup-env.mjs')
}

Step 'Buscando bridge anterior'
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
    Write-Host "Cerrando bridge anterior PID $($process.ProcessId)" -ForegroundColor Yellow
    Stop-Process -Id $process.ProcessId -Force
  }
} else {
  Write-Host 'No encontre bridge anterior abierto.' -ForegroundColor Green
}

Step 'Instalando dependencias si faltan'
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  Invoke-Checked 'corepack' @('pnpm', 'install')
} else {
  Write-Host 'node_modules existe; omito install.' -ForegroundColor Green
}

Step 'Compilando bridge'
Invoke-Checked 'corepack' @('pnpm', 'build')

Step 'Iniciando bot'
Write-Host 'Deja esta ventana abierta. Para detener: Ctrl+C o cerrar ventana.' -ForegroundColor Green
Log "Starting node $distIndex"
& node $distIndex 2>&1 | Tee-Object -FilePath $LogFile -Append
$NodeExitCode = $LASTEXITCODE
Log "Node exited with code $NodeExitCode"
exit $NodeExitCode
