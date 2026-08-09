# Issue #483: update the deployment directory of the supervisor tick.
#
# Runs on every merge (or whenever the operator wants to pull the latest
# main into the deployment directory). The script pulls origin/main,
# runs `pnpm install` if needed, then rebuilds dist/. The cron task's
# next tick runs against the updated code.
#
# Pre-requisite: install-deploy-tick.ps1 was run once.

$ErrorActionPreference = 'Stop'

$DeploymentRoot = 'C:\idu-pi-deploy'

if (-not (Test-Path $DeploymentRoot)) {
	Write-Error "Deployment directory not found at $DeploymentRoot. Run scripts/install-deploy-tick.ps1 first."
	exit 1
}

Set-Location $DeploymentRoot
git pull origin main
corepack pnpm install
corepack pnpm tsc -p tsconfig.json

# Issue #487: never print "updated" for a compile that cannot boot its
# config. Run the deployed copy's own verification script and stop hard
# on failure.
& "$DeploymentRoot\scripts\verify-deploy.ps1"
if ($LASTEXITCODE -ne 0) {
	Write-Error "Deployment verification failed (exit code $LASTEXITCODE). The deployed CLI cannot boot its config (e.g. install without .env); fix before reporting success."
	exit $LASTEXITCODE
}

Write-Host "Deployment directory updated at: $DeploymentRoot" -ForegroundColor Green
