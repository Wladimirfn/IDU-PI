$ErrorActionPreference = 'Stop'

$TaskName = $env:IDU_PI_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Telegram Bridge' }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No existe la tarea: $TaskName" -ForegroundColor Yellow
  exit 1
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Tarea: $TaskName"
Write-Host "Estado: $($task.State)"
Write-Host "Ultima ejecucion: $($info.LastRunTime)"
Write-Host "Resultado ultimo run: $($info.LastTaskResult)"
Write-Host "Proxima ejecucion: $($info.NextRunTime)"

# Effective state: the scheduled task may say Ready/Running, but if the
# operator disabled autostart via the TUI flag (bridge-autostart.json),
# start-bridge.ps1 exits without launching the bridge. Report both so
# the two surfaces don't diverge — same lesson as rail.enabled: a flag
# the reporting tool ignores is a flag that lies.
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$AutostartFile = Join-Path $Root 'bridge-autostart.json'
$flagEnabled = $true
if (Test-Path $AutostartFile) {
  try {
    $flagConfig = Get-Content $AutostartFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($flagConfig.enabled -eq $false) { $flagEnabled = $false }
  } catch {
    # Corrupt flag file — treat as enabled (default)
  }
}

Write-Host ""
if ($flagEnabled) {
  Write-Host 'Autostart (flag): activado'
  Write-Host "Estado efectivo: $($task.State) - el bridge arrancara al iniciar sesion"
} else {
  Write-Host 'Autostart (flag): DESACTIVADO por operador'
  Write-Host 'Estado efectivo: suprimido - start-bridge.ps1 no arrancara aunque la tarea dispare'
}
