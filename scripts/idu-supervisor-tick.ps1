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
	# Bounded retry for Add-Content failures. The five "Log ocupado"
	# messages in a single forced tick on 2026-07-27 had no content —
	# the operator learned *that* a line was dropped, never *which* or
	# *why*. The retry absorbs the transient case (AV scan, FS slow,
	# brief file contention); the fallback carries the line content
	# + the exception message so a structural failure is still
	# diagnosable.
	$line = (Get-Date -Format o) + ' ' + $Message
	$delays = @(0, 50, 200)
	$written = $false
	$lastError = $null
	foreach ($delay in $delays) {
		if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
		try {
			Add-Content -Path $LogFile -Value $line -ErrorAction Stop
			$written = $true
			break
		} catch {
			$lastError = $_
		}
	}
	if (-not $written) {
		# Fallback must carry the content. Log to host so the operator
		# at the terminal sees WHAT was lost; the exception message
		# explains WHY so the next investigation starts with a direction.
		$reason = if ($lastError.Exception) { $lastError.Exception.Message } else { [string]$lastError }
		Write-Host ('Log ocupado tras retry; mensaje perdido: ' + $line + ' | reason: ' + $reason) -ForegroundColor DarkYellow
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

# Step 0: presence guardian (issue #417, inverted). The operator's
# intent is that an open terminal means "I am working; tick should
# run". The tick runs alongside the operator, touching git and
# lab.db while they work — this is a deliberate decision, not a bug.
# The previous behavior (skip when CLI active) was inverted: it
# skipped on the days with the most operator work, and 5 merges
# went unreviewed in 20 hours.
#
# Known trade-off that the inversion introduces (operator audit,
# 2026-08-07): with the inverted rule, Step 1's `corepack pnpm tsc`
# now runs while the operator is working — including in the window
# where the operator is running `node --test dist/...`. The script
# recompiles dist/ every hour, and the operator's test runner reads
# dist/. The conflict is benign for read-only test runs (tsc writes
# .js files; node reads them) but can produce stale-file races if
# not handled. The operator accepted this consciously; measure
# separately when calibration evidence is available. The cheap
# mitigation is `tsc --noEmit` (type-check only, no output write);
# deferred until the issue is raised.
#
# Inverted rule: if no interactive CLI is open, no operator work
# is happening; the tick is silent (no output, no log line) to
# match the operator's expectation that a disabled presence is
# invisible. Force the tick with IDU_PI_TICK_FORCE=1 if you want
# it to run anyway.
#
# IMPORTANT: do NOT include 'node' in the presence-list. The script
# itself runs on `node` (via `& node $cliPath idu-automaticov1
# cycle`), so Get-Process -Name 'node' always returns the current
# process and the guard would self-detect — running the tick even
# when no human CLI is open (the script would never skip). The
# interactive CLIs we care about are the human-facing shells
# (pi, opencode variants, kimi, claude, minimax), not the node
# runtime.
if (-not $env:IDU_PI_TICK_FORCE -or $env:IDU_PI_TICK_FORCE -ne '1') {
	$cliNames = @('pi', 'opencode', 'opencode-go', 'opencode-zen', 'kimi', 'claude', 'minimax')
	$active = @()
	foreach ($name in $cliNames) {
		$processes = Get-Process -Name $name -ErrorAction SilentlyContinue
		if ($processes) {
			foreach ($p in $processes) { $active += $p.ProcessName }
		}
	}
	if ($active.Count -eq 0) {
		$reason = 'skipped: no interactive CLI active'
		Write-Host $reason -ForegroundColor DarkYellow
		Log $reason
		Step 'Step 0: skip because no interactive CLI is open. The operator is not working. Set IDU_PI_TICK_FORCE=1 to override.'
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
		# #484: $watermarkBase is the diff base actually used this tick and
		# is logged on every run so the next measurement can be done per
		# tick (the SHA was never logged before — the historical
		# distribution was only knowable by snapshot). $advanceWatermark
		# is turned off only when the base is unrecoverable (row 1 below).
		$watermarkBase = $null
		$advanceWatermark = $true
		if ($lastSha -and $currentSha -and ($lastSha -ne $currentSha)) {
			# Validate the watermark before diffing from it. `git diff
			# --name-only <bad-sha> HEAD` does NOT throw under Stop — it
			# returns empty with exit 128, and the old code silently read
			# that as "no changes", advancing the watermark and losing the
			# range. Row 1 must be detected explicitly with cat-file on
			# the peeled commit object.
			git cat-file -e "$lastSha^{commit}" 2>$null
			if ($LASTEXITCODE -ne 0) {
				# Row 1: the watermark object is gone. The base cannot be
				# reconstructed — do NOT fall back to HEAD~1..HEAD (that
				# drops every commit in the middle: the same hole HEAD~1
				# had for burst merges, and what #225 fixed). Do not
				# advance; log firmly so the operator repairs the file.
				$advanceWatermark = $false
				$watermarkBase = $lastSha
				Log ('watermark_OBJECT_MISSING: sha=' + $lastSha + ' (diff base unrecoverable; watermark NOT advanced)')
				$diffOutput = $null
			} else {
				# Object exists. Row 2: it may not be an ancestor of HEAD
				# (a pre-squash fix-branch SHA written into the watermark
				# by a tick that ran from the operator's checkout).
				git merge-base --is-ancestor "$lastSha" HEAD
				if ($LASTEXITCODE -eq 0) {
					# Healthy: the watermark is in HEAD's history.
					$watermarkBase = $lastSha
					$diffOutput = git diff --name-only $watermarkBase HEAD 2>$null
				} else {
					# Row 2: orphan. Recover the FULL range via merge-base
					# instead of diffing from the orphan SHA (which yields
					# a wrong/partial range).
					$watermarkBase = git merge-base "$lastSha" HEAD
					Log ('watermark_ORPHAN: sha=' + $lastSha + ' -> merge-base ' + $watermarkBase + ' (recovered full range)')
					$diffOutput = git diff --name-only $watermarkBase HEAD 2>$null
				}
			}
		} elseif (-not $lastSha -and $currentSha) {
			# True first run (no prior watermark): diff the last commit
			# only so we don't dump the entire history on the first tick.
			# This fallback is ONLY reachable when no watermark exists, so
			# it cannot drop a silently-missing range.
			$watermarkBase = 'HEAD~1'
			$diffOutput = git diff --name-only HEAD~1 HEAD 2>$null
		} else {
			# No changes since last tick (lastSha === currentSha) or
			# git unavailable: no diff.
			$diffOutput = $null
		}
		if ($diffOutput) {
			$changedFiles = $diffOutput -split "`n" | Where-Object { $_ -ne '' }
		}
		# NOTE: the watermark (cron-last-sha.txt) is written AFTER the
		# preflight completes successfully — NOT here. Writing it before
		# the preflight runs would advance the SHA even if the node
		# process crashes, losing that range of commits forever (same
		# class of bug as HEAD~1..HEAD missing burst merges). The
		# watermark write is at the end of this try block, gated on
		# $preflightExit -eq 0.
	} catch {
		Log ('changed_files_git_failed: ' + $_)
	}
	$env:IDU_PI_TRIGGER_ENGINE = $EnvTriggerEngine
	$preflightArgs = @('idu-run-cron-preflight') + $changedFiles
	# Scope $ErrorActionPreference = 'Continue' around the node call only:
	# a deprecation warning on stderr (e.g. DEP0190 from codegraph's
	# shell: true launch) would otherwise be reclassified as a terminating
	# error under the script-wide Stop preference and abort the try
	# before the watermark write. Keeping stderr in $preflightOutput
	# preserves operator visibility; relaxing the preference only inside
	# the call keeps the script-wide Stop behavior everywhere else.
	$prevEAP = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	try {
		$preflightOutput = & node $cliPath @preflightArgs 2>&1
		$preflightExit = $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $prevEAP
	}
	Log ('cron_preflight_exit=' + $preflightExit + ' changed_files=' + $changedFiles.Count + ' watermark_sha=' + $lastSha + ' watermark_base=' + $watermarkBase)
	Log ('cron_preflight_output: ' + ($preflightOutput -join ' | '))
	Write-Host $preflightOutput
	# Advance the watermark ONLY if the preflight succeeded. If the
	# node process crashed or returned non-zero, the watermark stays
	# at the previous SHA so the next tick retries the same range.
	# A persistent failure will show repeated log entries with the
	# same changed_files count — the operator notices and fixes.
	if ($preflightExit -eq 0 -and $advanceWatermark) {
		$shaFile = if ($StateRoot) { Join-Path $StateRoot 'cron-last-sha.txt' } else { $null }
		$currentSha = git rev-parse HEAD 2>$null
		if ($shaFile -and $currentSha) {
			Set-Content -Path $shaFile -Value $currentSha.Trim() -NoNewline -ErrorAction SilentlyContinue
		}
	} elseif ($preflightExit -ne 0) {
		Log ('watermark_NOT_advanced: preflightExit=' + $preflightExit + ' (next tick will retry the same range)')
	}
	# When $advanceWatermark is false (row 1: watermark_OBJECT_MISSING),
	# the reason was already logged and the watermark is left untouched;
	# no extra line here to avoid double-logging the same incident.
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
#   - recent_critical_threshold (1+ NEW open critical findings)
#   - recent_total_threshold (25+ NEW open findings)
# Each rule is idempotent per finding id within the 24h window.
# NOTE: hours_since_interaction is NO LONGER a standalone trigger (pre-A1e);
# it is retained as a delivery-timing modulator for A1e.
# If the state file is missing, treat last interaction as now.
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
