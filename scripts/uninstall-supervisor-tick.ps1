$ErrorActionPreference = 'Stop'

$TaskName = $env:IDU_PI_SUPERVISOR_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Supervisor Tick' }

try {
	Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
	Write-Host "Tarea desinstalada: $TaskName" -ForegroundColor Green
} catch {
	Write-Host "No se encontró la tarea: $TaskName (ya estaba desinstalada)" -ForegroundColor DarkYellow
}
