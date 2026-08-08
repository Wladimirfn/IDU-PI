# Issue #483: bootstrap the deployment directory of the supervisor tick.
#
# The cron task previously ran scripts\idu-supervisor-tick.ps1 from the
# operator's working checkout (`C:\Users\elmas\pi-telegram-bridge`). Every
# branch the operator checked out was, by extension, the production code
# running on the tick — bypassing CI, review, and merge. The fix is a
# deployment directory: a separate clone of the repo, kept on `main`,
# which the cron task points to via WorkingDir.
#
# This script does the one-time operator work: create the deployment
# directory, clone the repo, check out main, build. The cron task must
# still be re-registered manually to point to this directory — the PR
# cannot do that, and assuming the merge is enough is exactly the bug
# this issue documents.

$ErrorActionPreference = 'Stop'

# Operator path. The deployment directory is a separate clone of the
# repo on the same machine. The path is intentionally absolute so the
# script works regardless of where it is invoked from.
$DeploymentRoot = 'C:\idu-pi-deploy'
$RepoUrl = 'https://github.com/Wladimirfn/IDU-PI.git'

if (-not (Test-Path $DeploymentRoot)) {
	New-Item -ItemType Directory -Path $DeploymentRoot -Force | Out-Null
}

if (-not (Test-Path (Join-Path $DeploymentRoot '.git'))) {
	git clone $RepoUrl $DeploymentRoot
}

Set-Location $DeploymentRoot
git fetch origin main
git checkout main
git pull origin main

if (-not (Test-Path (Join-Path $DeploymentRoot 'node_modules'))) {
	corepack pnpm install
}

corepack pnpm tsc -p tsconfig.json

# Issue #487: never print "ready" for a compile that cannot boot its
# config. Run the deployed copy's own verification script (the clone
# carries it on main) and stop hard on failure.
& "$DeploymentRoot\scripts\verify-deploy.ps1"
if ($LASTEXITCODE -ne 0) {
	Write-Error "Deployment verification failed (exit code $LASTEXITCODE). The deployed CLI cannot boot its config (e.g. install without .env); fix before re-running."
	exit $LASTEXITCODE
}

Write-Host ''
Write-Host "Deployment directory ready at: $DeploymentRoot" -ForegroundColor Green
Write-Host ''
Write-Host 'NEXT STEP (operator, manual):' -ForegroundColor Cyan
Write-Host '  Re-register the Windows task "Idu-pi Supervisor Tick" with:' -ForegroundColor Cyan
Write-Host "    WorkingDir : $DeploymentRoot" -ForegroundColor Cyan
Write-Host '    Action     : powershell.exe -NoProfile -ExecutionPolicy Bypass' -ForegroundColor Cyan
Write-Host '               -File scripts\idu-supervisor-tick-bootstrap.ps1' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Until the task is re-registered, the cron still runs from the old' -ForegroundColor DarkYellow
Write-Host 'working checkout. The PR brings the script and the directory; the' -ForegroundColor DarkYellow
Write-Host 'task re-registration is the operator''s job.' -ForegroundColor DarkYellow
