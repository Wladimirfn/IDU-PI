$ErrorActionPreference = 'Stop'

# Ensure console output is UTF-8 so the non-ASCII characters in the
# log lines (e.g. "tsc falló") survive being captured by external
# runners (CI, execFile, etc.). Without this, PowerShell 5 on
# Windows defaults to the legacy OEM code page and the captured
# stdout ends up with replacement characters.
try {
	[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	$OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
	# PowerShell 5 on Linux/macOS may not have [Console]; ignore.
}

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

# Read interval from env var, default 60 minutes (1 hour).
$IntervalMinutes = 60
if ($env:IDU_PI_TICK_INTERVAL_MINUTES) {
	try { $IntervalMinutes = [int]$env:IDU_PI_TICK_INTERVAL_MINUTES } catch { $IntervalMinutes = 60 }
}

# Read trigger engine opt-in.
$EnvTriggerEngine = $env:IDU_PI_TRIGGER_ENGINE
if (-not $EnvTriggerEngine) { $EnvTriggerEngine = '0' }
$triggerOptIn = if ($EnvTriggerEngine -eq '1') { 'enabled' } else { 'disabled' }
Step ("Trigger engine opt-in: " + $triggerOptIn)
Log ("trigger_opt_in: " + $triggerOptIn)

$banner = 'Idu-pi supervisor tick — interval=' + $IntervalMinutes + 'min, trigger_engine=' + $EnvTriggerEngine
Step $banner
Log ('interval_minutes=' + $IntervalMinutes + ' trigger_engine=' + $EnvTriggerEngine)

# Step 0: skip when an interactive CLI is open. The user is in a
# session; do not interrupt them with a tick. Force the tick with
# IDU_PI_TICK_FORCE=1 if you want it to run anyway.
#
# IMPORTANT: do NOT include 'node' in the skip-list. The script
# itself runs on `node` (via `& node $cliPath idu-automaticov1
# cycle`), so Get-Process -Name 'node' always returns the current
# process and the guard would self-detect — skipping the tick even
# when no human CLI is open. The interactive CLIs we care about are
# the human-facing shells (pi, opencode variants), not the node
# runtime.
if (-not $env:IDU_PI_TICK_FORCE -or $env:IDU_PI_TICK_FORCE -ne '1') {
	$cliNames = @('pi', 'opencode', 'opencode-go', 'opencode-zen')
	$active = @()
	foreach ($name in $cliNames) {
		$processes = Get-Process -Name $name -ErrorAction SilentlyContinue
		if ($processes) {
			foreach ($p in $processes) { $active += $p.ProcessName }
		}
	}
	if ($active.Count -gt 0) {
		$reason = 'skipped: CLI active (' + ($active -join ', ') + ')'
		Write-Host $reason -ForegroundColor DarkYellow
		Log $reason
		Step 'Step 0: skip because a pi/opencode CLI session is active. Set IDU_PI_TICK_FORCE=1 to override.'
		exit 0
	}
}

# Step 0.5: honour the user opt-in. If the TUI "Configurar
# IDU-Pi" → "Trigger supervisor" panel has disabled the scheduled
# trigger, the file `<stateRoot>/supervisor-trigger.json` exists
# with `enabled: false`. The script must skip the tick in that
# case with a clear log line.
#
# `IDU_PI_TICK_STATE_ROOT` is the active project's stateRoot. The
# install-supervisor-tick.ps1 script sets it as a task env var
# when the scheduled task is registered (see
# scripts/install-supervisor-tick.ps1). For ad-hoc runs the
# operator can set it manually. When unset, the trigger opt-in
# check is skipped (the script still runs) — the TUI opt-in is
# best-effort, not a hard gate, so the cron job never silently
# breaks because of a missing stateRoot.
#
# Silent-when-disabled: when the trigger is disabled by the user,
# the script exits silently (no console output, no log line). This
# matches the operator expectation that a disabled trigger should
# be invisible — interrupting their day-to-day work or showing
# "skipped" lines is exactly what the opt-in exists to prevent.
$StateRoot = $env:IDU_PI_TICK_STATE_ROOT
if ($StateRoot) {
	$triggerFile = Join-Path $StateRoot 'supervisor-trigger.json'
	if (Test-Path $triggerFile) {
		try {
			$triggerContent = Get-Content $triggerFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
			if ($triggerContent.enabled -eq $false) {
				# Silent exit: no Write-Host, no Log. The user opted out.
				exit 0
			}
		} catch {
			Log ('trigger_file_parse_failed: ' + $_ + ' (path=' + $triggerFile + ')')
		}
	}
}

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

# Step 2.5: run cron preflight. Fires the postflight -> sensor -> AgentLab
# -> supervisor chain and writes supervisor_advisory to injections.jsonl
# (PR-105a + PR-105b). The changedFiles arg is the list of files modified
# since the LAST PROCESSED commit (not just HEAD~1..HEAD). If multiple
# commits land between ticks (e.g. a burst of PR merges), all of them
# are diffed in one pass. If the repo has no HEAD (first commit) or git
# is unavailable, the preflight runs with no changed files and produces
# no sensor impulses — this is the safe no-op path.
try {
	$cliPath = Join-Path $Root 'dist/src/cli.js'
	$changedFiles = @()
	try {
		# Persist the last processed SHA so we diff lastSha..HEAD
		# instead of HEAD~1..HEAD. The latter only catches the most
		# recent commit and silently misses intermediate commits when
		# multiple PRs merge in quick succession (e.g. 3 squashes in
		# 30 minutes). The state file is a single line with the SHA.
		$shaFile = if ($StateRoot) { Join-Path $StateRoot 'cron-last-sha.txt' } else { $null }
		$lastSha = $null
		if ($shaFile -and (Test-Path $shaFile)) {
			$lastSha = (Get-Content $shaFile -Raw -ErrorAction SilentlyContinue).Trim()
		}
		$currentSha = git rev-parse HEAD 2>$null
		if ($lastSha -and $currentSha -and ($lastSha -ne $currentSha)) {
			# Normal path: diff from the last processed commit to HEAD.
			# This catches ALL commits since the last tick, not just one.
			$diffOutput = git diff --name-only $lastSha HEAD 2>$null
		} elseif (-not $lastSha -and $currentSha) {
			# First run (no state file yet): fall back to HEAD~1..HEAD
			# so we don't dump the entire history on the first tick.
			$diffOutput = git diff --name-only HEAD~1 HEAD 2>$null
		} else {
			# No changes since last tick (lastSha === currentSha) or
			# git unavailable: no diff.
			$diffOutput = $null
		}
		if ($diffOutput) {
			$changedFiles = $diffOutput -split "`n" | Where-Object { $_ -ne '' }
		}
		# Persist the current SHA as the new watermark AFTER computing
		# the diff (not before, so a crash mid-tick retries the same
		# diff on the next run rather than skipping it).
		if ($shaFile -and $currentSha) {
			Set-Content -Path $shaFile -Value $currentSha.Trim() -NoNewline -ErrorAction SilentlyContinue
		}
	} catch {
		Log ('changed_files_git_failed: ' + $_)
	}
	$env:IDU_PI_TRIGGER_ENGINE = $EnvTriggerEngine
	$preflightArgs = @('idu-run-cron-preflight') + $changedFiles
	$preflightOutput = & node $cliPath @preflightArgs 2>&1
	$preflightExit = $LASTEXITCODE
	Log ('cron_preflight_exit=' + $preflightExit + ' changed_files=' + $changedFiles.Count)
	Log ('cron_preflight_output: ' + ($preflightOutput -join ' | '))
	Write-Host $preflightOutput
} catch {
	Write-Host ('cron preflight falló: ' + $_) -ForegroundColor Red
	Log ('cron_preflight_failed: ' + $_)
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

# Step 3.5: user escalation check. PR-105c. Reads last-user-interaction.json
# (if present) and the pending injections file. Escalation fires when:
#   - unacked_critical_threshold (3+ critical)
#   - unacked_total_threshold (10+ total)
#   - hours_since_interaction (6h+ since last user touch)
# If the state file is missing, treat last interaction as now (no escalation
# from the hours-since rule).
try {
	$cliPath = Join-Path $Root 'dist/src/cli.js'
	$escalationOutput = & node $cliPath idu-check-user-escalation 2>&1
	$escalationExit = $LASTEXITCODE
	Log ('user_escalation_exit=' + $escalationExit)
	Log ('user_escalation_output: ' + ($escalationOutput -join ' | '))
	Write-Host $escalationOutput
} catch {
	Log ('user_escalation_check_failed: ' + $_)
}

# Step 4: log next-scheduled run.
$nextRun = (Get-Date).AddMinutes($IntervalMinutes).ToString('o')
Write-Host ('Proximo tick programado: ' + $nextRun) -ForegroundColor DarkGray
Log ('next_run=' + $nextRun)
