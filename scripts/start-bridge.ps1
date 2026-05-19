$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
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
& node $distIndex
