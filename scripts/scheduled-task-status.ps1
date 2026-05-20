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
