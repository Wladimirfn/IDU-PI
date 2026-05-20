$ErrorActionPreference = 'Stop'

$TaskName = $env:IDU_PI_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Telegram Bridge' }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No existe la tarea: $TaskName" -ForegroundColor Yellow
  exit 0
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarea eliminada: $TaskName" -ForegroundColor Green
