$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'supervisor-tick.log'

function Log($Message) {
	$line = (Get-Date -Format o) + ' ' + $Message
	try {
		Add-Content -Path $LogFile -Value $line -ErrorAction Stop
	} catch {
		Write-Host 'Log ocupado; continuo sin escribir esta linea' -ForegroundColor DarkYellow
	}
}

function Step($Message) {
	Write-Host ''
	Write-Host ('==> ' + $Message) -ForegroundColor Cyan
	Log ('STEP ' + $Message)
}

# Read interval from env var, default 15 minutes.
$IntervalMinutes = 15
if ($env:IDU_PI_TICK_INTERVAL_MINUTES) {
	try { $IntervalMinutes = [int]$env:IDU_PI_TICK_INTERVAL_MINUTES } catch { $IntervalMinutes = 15 }
}

# Read trigger engine opt-in.
$EnvTriggerEngine = $env:IDU_PI_TRIGGER_ENGINE
if (-not $EnvTriggerEngine) { $EnvTriggerEngine = '1' }

$banner = 'Idu-pi supervisor tick — interval=' + $IntervalMinutes + 'min, trigger_engine=' + $EnvTriggerEngine
Step $banner
Log ('interval_minutes=' + $IntervalMinutes + ' trigger_engine=' + $EnvTriggerEngine)

# Step 1: ensure project is in working state.
try {
	corepack pnpm tsc -p tsconfig.json 2>&1 | Out-Null
	if ($LASTEXITCODE -ne 0) {
		throw ('tsc falló con exit code ' + $LASTEXITCODE)
	}
} catch {
	Write-Host 'tsc falló; no corro alerts tick.' -ForegroundColor Red
	Log ('tsc_failed: ' + $_)
	exit 1
}

# Step 2: run automaticov1 cycle. The trigger engine wireo (in cli.ts) runs
# post-tick when IDU_PI_TRIGGER_ENGINE=1.
try {
	$env:IDU_PI_TRIGGER_ENGINE = $EnvTriggerEngine
	$cliPath = Join-Path $Root 'dist/src/cli.js'
	$output = & node $cliPath idu-automaticov1 cycle 2>&1
	$exitCode = $LASTEXITCODE
	Log ('automaticov1_exit=' + $exitCode)
	Write-Host $output
} catch {
	Write-Host ('automaticov1 cycle falló: ' + $_) -ForegroundColor Red
	Log ('automaticov1_failed: ' + $_)
}

# Step 3: read pending injections and surface them in the log so the
# orchestrator can pick them up.
try {
	$cliPath = Join-Path $Root 'dist/src/cli.js'
	$pendingOutput = & node $cliPath idu-pending-injections 2>&1
	Log ('pending_injections_query: ' + ($pendingOutput -join ' | '))
} catch {
	Log ('pending_injections_query_failed: ' + $_)
}

# Step 4: log next-scheduled run.
$nextRun = (Get-Date).AddMinutes($IntervalMinutes).ToString('o')
Write-Host ('Proximo tick programado: ' + $nextRun) -ForegroundColor DarkGray
Log ('next_run=' + $nextRun)
