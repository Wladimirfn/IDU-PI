$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$TaskName = $env:IDU_PI_SUPERVISOR_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Supervisor Tick' }
$TickScript = Join-Path $Root 'scripts/idu-supervisor-tick.ps1'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$PowerShell = (Get-Command powershell.exe).Source
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TickScript`""

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$RepetitionDuration = (New-TimeSpan -Days 365)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration $RepetitionDuration

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -MultipleInstances IgnoreNew -StartWhenAvailable

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Tarea instalada: $TaskName" -ForegroundColor Green
Write-Host "Script: $TickScript"
Write-Host "Intervalo: cada 15 minutos"
Write-Host "Trigger engine opt-in: IDU_PI_TRIGGER_ENGINE=1 (default)"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para correr ahora: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para desinstalar: powershell -NoProfile -File scripts/uninstall-supervisor-tick.ps1"
