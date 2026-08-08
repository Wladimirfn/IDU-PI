# Issue #487: verify the deployed compile boots its config before the
# installer/updater prints "ready/updated". `node dist\src\cli.js status`
# forces a full config load (cli.ts createCliRuntime -> loadConfig), so a
# deploy without .env ("Missing required env var: DEFAULT_CWD") fails here
# with a non-zero exit instead of a green installer. `status` is read-only:
# no side effects, no registry auto-create (cli.ts:2055-2060).
#
# Paths resolve relative to $PSScriptRoot so the same script works from the
# operator's checkout and from the deployed copy (C:\idu-pi-deploy\scripts\).
# The deploy env vars default to the bootstrap's values; an already-set
# value (test override or operator-adjusted layout) wins.

$ErrorActionPreference = 'Stop'

$DeployRoot = Split-Path -Parent $PSScriptRoot
$CliPath = Join-Path $DeployRoot 'dist\src\cli.js'

if (-not $env:IDU_PI_TICK_STATE_ROOT) {
	$env:IDU_PI_TICK_STATE_ROOT = 'C:\Users\elmas\Documents\bridge-agents\projects\idu-pi'
}
if (-not $env:AGENT_WORKSPACE_ROOT) {
	$env:AGENT_WORKSPACE_ROOT = 'C:\Users\elmas\Documents\bridge-agents'
}
if (-not $env:IDU_PI_REGISTRY_PATH) {
	$env:IDU_PI_REGISTRY_PATH = 'C:\Users\elmas\Documents\bridge-agents\registry\projects.json'
}
# Issue #487: the deploy never copies .env; IDU_PI_DOTENV_PATH carries the
# operator's single .env so token rotation stays in one place.
if (-not $env:IDU_PI_DOTENV_PATH) {
	$env:IDU_PI_DOTENV_PATH = 'C:\Users\elmas\pi-telegram-bridge\.env'
}

if (-not (Test-Path -LiteralPath $CliPath)) {
	Write-Host "Deployed CLI not found at: $CliPath. Run the build first." -ForegroundColor Red
	exit 1
}

Push-Location $DeployRoot
try {
	& node $CliPath status
	$exitCode = $LASTEXITCODE
} finally {
	Pop-Location
}

if ($exitCode -ne 0) {
	Write-Host "Deployed CLI failed to boot with exit code $exitCode. The deployment is not ready — its config would not load (e.g. missing .env)." -ForegroundColor Red
	exit $exitCode
}