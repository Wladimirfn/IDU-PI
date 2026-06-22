param(
	[string]$StateRoot
)

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
if (-not $StateRoot) { $StateRoot = $env:IDU_PI_TICK_STATE_ROOT }
if (-not $StateRoot) {
	$StateRoot = Join-Path $env:USERPROFILE 'Documents\bridge-agents\projects\idu-pi'
}

$PowerShell = (Get-Command powershell.exe).Source
# Wrap the env var setting in a small PowerShell bootstrap so the
# child process inherits IDU_PI_TICK_STATE_ROOT + the workspace +
# registry context derived from it. The shell prefix `KEY="value"`
# is bash, not PowerShell — using it from New-ScheduledTaskAction
# does nothing on Windows.
#
# IDU_PI_REGISTRY_PATH is the lever: with no DEFAULT_CWD, the tick
# can't resolve the active project from the package-root default
# registry (`<packageRoot>/data/projects.json`). Pointing the
# registry to the workspace-root canonical registry
# (`<workspaceRoot>/registry/projects.json`, per the onboarding
# convention in `src/cli-onboard-project.ts:99`) gives the runtime
# a registry that has the real project registered.
$BootstrapScript = Join-Path $Root 'scripts/idu-supervisor-tick-bootstrap.ps1'
# The operator convention is `<workspaceRoot>/projects/<id>` for
# the stateRoot (e.g. `bridge-agents/projects/idu-pi` => workspace
# `bridge-agents`). Two `Split-Path -Parent` calls climb the
# `projects/<id>` segment. The on-disk registry lives at
# `<workspaceRoot>/registry/projects.json` per the onboarding
# convention in `src/cli-onboard-project.ts:99`.
$WorkspaceRoot = (Split-Path -Parent (Split-Path -Parent "$StateRoot"))
$RegistryPath = Join-Path $WorkspaceRoot 'registry/projects.json'
$BootstrapContent = @"
`$env:IDU_PI_TICK_STATE_ROOT = "$StateRoot"
`$env:AGENT_WORKSPACE_ROOT = "$WorkspaceRoot"
`$env:IDU_PI_REGISTRY_PATH = "$RegistryPath"
& "$TickScript"
"@
Set-Content -Path $BootstrapScript -Value $BootstrapContent -Encoding UTF8
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$BootstrapScript`""

# Build the action. The stateRoot env var is injected via the
# bootstrap wrapper (compatible with PS5 ScheduledTasks).
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root

$RepetitionDuration = (New-TimeSpan -Days 365)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration $RepetitionDuration

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -MultipleInstances IgnoreNew -StartWhenAvailable

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Tarea instalada: $TaskName" -ForegroundColor Green
Write-Host "Script: $TickScript"
Write-Host "Intervalo: cada 1 hora"
Write-Host "stateRoot: $StateRoot"
Write-Host "Trigger engine opt-in: IDU_PI_TRIGGER_ENGINE=1 (default)"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para correr ahora: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para desinstalar: powershell -NoProfile -File scripts/uninstall-supervisor-tick.ps1"
