$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$TaskName = $env:IDU_PI_TASK_NAME
if (-not $TaskName) { $TaskName = 'Idu-pi Telegram Bridge' }
$StartScript = Join-Path $Root 'scripts/start-bridge.ps1'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$PowerShell = (Get-Command powershell.exe).Source
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
	Write-Host "Register-ScheduledTask necesita PowerShell como Administrador." -ForegroundColor Yellow
	Write-Host "Abri PowerShell con 'Ejecutar como administrador' y volve a correr este script." -ForegroundColor Yellow
	exit 1
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

# Verify the OUTCOME, not that the line ran. Register-ScheduledTask is a CIM
# cmdlet and its "Acceso denegado" does not always honour
# $ErrorActionPreference = 'Stop', so this script used to print a green
# success message after failing to register anything at all.
$Registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Registered) {
	Write-Host "FALLO: la tarea '$TaskName' no quedo registrada." -ForegroundColor Red
	exit 1
}

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$State = (Get-ScheduledTask -TaskName $TaskName).State

Write-Host "Tarea registrada: $TaskName (estado: $State)" -ForegroundColor Green
Write-Host "Script: $StartScript"
