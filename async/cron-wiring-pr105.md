# PR-105: Cron Tick Wiring — Plan

> Date: 2026-06-15. Author: orchestrator (scout failed; inline research).
> State root: `C:\Users\elmas\pi-telegram-bridge`. The 4 prior PRs (#111, #113, #115, #117) are merged to main.

## 1. Current cron state (verified by reading the code)

**File**: `scripts/idu-supervisor-tick.ps1`. Runs every 15 min via Windows Task Scheduler.

### What it does (today)

1. **Skip guard**: If a `pi` / `opencode` / `opencode-go` / `opencode-zen` process is active, skip with log line. `IDU_PI_TICK_FORCE=1` overrides.
2. **Opt-in guard**: Reads `<stateRoot>/supervisor-trigger.json` and silently exits (no log, no console) if `enabled: false`. Silent-when-disabled.
3. **Compile**: `corepack pnpm tsc -p tsconfig.json`. If tsc fails, exit 1.
4. **Automaticov1 cycle**: `node dist/src/cli.js idu-automaticov1 cycle`. This runs:
   - `runAutonomousAlertScheduledTick` (the scheduler)
   - `runIduSupervisorLoop` (supervisor)
   - `runMcpContextPackAutoRefreshTick` (context pack refresh)
   - `detectContractDrift` (PR-98)
5. **Pending injections**: `node dist/src/cli.js idu-pending-injections` (logs the result).
6. **Schedule log**: `next_run=...`.

### What it does NOT do (the gap)

- Does **not** run `idu_postflight`. So the **sensor → AgentLab → supervisor** chain (PR-102 + PR-103) does **not** fire from the cron path.
- Does **not** wake the supervisor-main to **categorize** AgentLab findings.
- Does **not** write a `supervisor_advisory` injection to `injections.jsonl`.
- Does **not** handle user escalation (the "6h+ / accumulation extreme → user" rule from the impulse architecture).

### Tools available (already exist)

- `idu_postflight`: full sensor→AgentLab→supervisor chain (PR-102/103). Wired in MCP server.
- `idu_automaticov1_cycle`: alerts + supervisor hooks. Wired in MCP server and cron.
- `idu_supervisor_consult`: manual consult with rails. Wired in MCP server.
- `idu_pending_injections`: read pending advisories. Used by cron.

### State root

`IDU_PI_TICK_STATE_ROOT` env var is set by `scripts/install-supervisor-tick.ps1` when the scheduled task is registered. This is the projectPath the cron uses for `supervisor-trigger.json`. The cron does **not** currently use this to know the projectPath for postflight — that's the gap.

## 2. Gap analysis

| Piece | Cron path | MCP path |
|-------|-----------|----------|
| Run `idu_postflight` (sensors + AgentLab) | ❌ Not called | ✅ Called |
| Supervisor categorizes findings | ❌ Not called | ✅ Called |
| Write `supervisor_advisory` injection | ❌ Not written | ✅ Written |
| `idu_pending_injections` surfaces | ✅ Read | ✅ Read |
| Automaticov1 cycle (alerts + supervisor hook) | ✅ Called | ✅ Called |
| `detectContractDrift` | ✅ Via cycle | ✅ Via postflight |
| User escalation (6h+ / accumulation) | ❌ Not implemented | ❌ Not implemented |

The cron has the scheduler and supervisor cycle, but not the postflight chain. That's the missing impulse.

## 3. Design for PR-105

### Goal

The cron tick should be the **self-repair trigger**. Every 15 min:
1. Run postflight (or a "snapshot" tool that runs only the sensor chain, not the orchestrator's full postflight).
2. The postflight runs the sensor→AgentLab→supervisor chain.
3. If supervisor categorizes critical findings, the bypass-by-capas (PR-104) can fire.
4. The supervisor_advisory is written to `injections.jsonl`.
5. The orchestrator reads via `idu_pending_injections` on the next MCP call.
6. **User escalation** (PR-105c): if extreme accumulation or 6h+ of unprocessed findings, write a "user_escalation" event.

### Sub-PRs

**PR-105a — `idu_run_cron_preflight` CLI tool** (~150 lines, ~3-5 tests):
- New CLI command: `idu-run-cron-preflight <projectPath>`
- Calls `idu_postflight` internally (reuses the existing MCP path)
- Returns the full envelope (sensorImpulses + supervisorAdvisory)
- This is the entry point the cron will call

**PR-105b — Wire the PS1 script to call the new tool** (~30 lines, 0 tests):
- Modify `scripts/idu-supervisor-tick.ps1` to call `idu-run-cron-preflight` after the `tsc` step
- Keep the `automaticov1 cycle` call (for the alerts)
- Add a `getAdvisories` step that reads `injections.jsonl` and surfaces count

**PR-105c — User escalation** (~100 lines, ~3-4 tests):
- New function: `checkUserEscalation({ stateRoot, lastUserInteractionAt })`:
  - Reads `injections.jsonl` for un-acked `supervisor_advisory` findings
  - If `unackedCount > N` OR `now - lastUserInteractionAt > 6h`, returns "should escalate"
  - Writes a `user_escalation` event to `events.jsonl`
- Wire into cron and into `idu_pending_injections` (if escalation pending, surface to user)

**PR-105d (optional) — Live verify + cron schedule check**:
- Run the cron manually
- Verify supervisor_advisory is written
- Verify pending_injections returns the new advisory
- Update install script if needed

### Recommended first PR

**PR-105a**: small, focused, testable in isolation. The new tool is the building block. Once it's working, PR-105b is just 1 line of PowerShell.

### Tests for PR-105a

- `test/idu-run-cron-preflight.test.ts`:
  - Empty postflight → empty sensorImpulses → null supervisorAdvisory
  - Postflight with 2 sensor matches → 2 sensorImpulses → supervisorAdvisory
  - Postflight with no role enabled → supervisorAdvisory with `reason: "role_not_enabled"`
  - Postflight failure → returns the error envelope

## 4. Open questions / risks

1. **Project path in cron**: `IDU_PI_TICK_STATE_ROOT` is the stateRoot. The postflight needs the `projectPath` (where the repo is). We can derive it from the registry (`data/projects.json` → `projects[].path`). Or pass it as a separate env var.
2. **Idempotency**: cron runs every 15 min. We don't want the supervisor to wake 4 times/hour for the same finding. The `existing` advisor check should compare with the last supervisor_advisory and only fire if new findings.
3. **Failure mode**: if postflight fails, the cron should log + continue (not abort). The existing `try/catch` in the PS1 script handles this.
4. **Test flakiness**: the supervisor model call is non-deterministic. We need to mock `promptForRole` in tests.
5. **Performance**: postflight + sensor + categorize = 3+ model calls. With 15 min interval, that's 12+ model calls/hour. The rails (PR-101) and cooldowns handle this, but the cron config may need adjustment.

## 5. Files to touch

### PR-105a
- New: `src/idu-cron-preflight.ts` (the entry point)
- New: `test/idu-cron-preflight.test.ts` (TDD)
- Modified: `src/cli.ts` (add `idu-run-cron-preflight` case)
- Modified: `src/mcp-server.ts` (optionally add the tool too, but not required for cron)

### PR-105b
- Modified: `scripts/idu-supervisor-tick.ps1` (1 line change)
- Modified: `scripts/install-supervisor-tick.ps1` (no change needed)

### PR-105c
- New: `src/user-escalation.ts`
- New: `test/user-escalation.test.ts`
- Modified: `src/idu-supervisor-cron.ts` (or wherever the cron handler lives)
- Modified: `src/idu-supervisor-hooks.ts` (for the orchestrator surface)

## 6. Live verification (after all 3 sub-PRs)

1. `git pull`
2. `pnpm build`
3. Manually invoke the cron: `node dist/src/cli.js idu-run-cron-preflight "C:/path/to/project"`
4. Verify: `cat <stateRoot>/injections.jsonl` shows `supervisor_advisory` entries
5. Verify: `node dist/src/cli.js idu-pending-injections` returns the new advisories
6. Optionally: trigger the Windows Task Scheduler and check the log
