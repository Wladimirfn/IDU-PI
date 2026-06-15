$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$TaskName = $env:IDU_PI_SUPERVISOR_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Supervisor Tick' }
$TickScript = Join-Path $Root 'scripts/idu-supervisor-tick.ps1'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Resolve the stateRoot that the tick script should consult for the
# trigger opt-in. The TUI's "Configurar IDU-Pi" -> "Trigger
# supervisor" menu writes to `<stateRoot>/supervisor-trigger.json`,
# so the cron job must know which stateRoot to read. Without this
# env var the script silently skips the opt-in check (see comment
# in idu-supervisor-tick.ps1 Step 0.5).
#
# Priority: explicit -StateRoot arg > IDU_PI_TICK_STATE_ROOT env >
# canonical idu-pi stateRoot (best-effort default for the live
# install on this machine). Operators with multiple projects must
# install one scheduled task per stateRoot.
param(
	[string]$StateRoot
)
if (-not $StateRoot) { $StateRoot = $env:IDU_PI_TICK_STATE_ROOT }
if (-not $StateRoot) {
	$StateRoot = Join-Path $env:USERPROFILE 'Documents\bridge-agents\projects\idu-pi'
}

$PowerShell = (Get-Command powershell.exe).Source
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TickScript`""

# Build the action with the stateRoot env var so the tick script
# can resolve the trigger opt-in file.
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$Action.EnvironmentVariables = @(
	[Microsoft.PowerShell.Cmdletization.GeneratedTypes.ScheduledTask.TaskEnvironmentVariable]::new(
		'IDU_PI_TICK_STATE_ROOT', $StateRoot)
)

$RepetitionDuration = (New-TimeSpan -Days 365)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration $RepetitionDuration

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -MultipleInstances IgnoreNew -StartWhenAvailable

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Tarea instalada: $TaskName" -ForegroundColor Green
Write-Host "Script: $TickScript"
Write-Host "Intervalo: cada 15 minutos"
Write-Host "stateRoot: $StateRoot"
Write-Host "Trigger engine opt-in: IDU_PI_TRIGGER_ENGINE=1 (default)"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para correr ahora: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para desinstalar: powershell -NoProfile -File scripts/uninstall-supervisor-tick.ps1"
