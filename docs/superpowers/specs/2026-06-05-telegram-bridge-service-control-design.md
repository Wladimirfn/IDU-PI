# Telegram Bridge Service Control Design

## Goal
Make the Telegram bridge behave like a controllable local service: Telegram can request a full bridge restart while the bridge is alive, every bridge startup proactively sends a status message to Telegram, and commands do not claim impossible behavior when the bridge is stopped.

## Problem
Telegram commands only work while the bridge process is running. Therefore `/server run` cannot start a stopped bridge from Telegram because no bot is connected to receive the command. Full restart must be delegated to an external controller process, scheduled task, or manual script.

## Principles
- Telegram is a remote control surface for a live bridge, not a magical bootstrap channel for a stopped process.
- Full bridge lifecycle uses deterministic scripts, not AI improvisation by default.
- AI/orchestrator fallback may be documented as an operational recovery prompt, but not as the primary service-control mechanism.
- Do not kill unrelated Pi/CLI sessions. Only stop processes that belong to this repository/bridge.
- `/reset` must not delete Idu-pi stateRoot, project files, reports, contracts, or repository files.
- Startup status must be sent for manual start, scheduled-task start, and Telegram-requested restart.

## Command Semantics

### `/reset`
Requests a full bridge restart.

Behavior while bridge is alive:
1. Reply to Telegram that restart was requested.
2. Persist a restart intent with chat id, timestamp, origin, and requested status notification.
3. Launch an external detached bridge-control helper.
4. Gracefully stop the active Pi/orchestrator session when possible.
5. Exit or allow the helper to stop the old bridge process.

Behavior while bridge is stopped:
- Impossible from Telegram. Use `start-pi-telegram-bridge.bat`, scheduled task, or watchdog.

### `/server restart`
Alias for `/reset`.

### `/server run`
Does not claim to start a stopped bridge.

Allowed behavior while bridge is alive:
- Show current server status.
- Optionally start/restart only the internal Pi/orchestrator session if that command remains part of the current server API.

### `/server off`
Requests a full bridge stop. It must warn that Telegram cannot restart the bridge after shutdown unless an external watchdog/scheduled task is active. Starting again without a watchdog requires `start-pi-telegram-bridge.bat` or the scheduled task.

### Idu-pi destructive reset
Must remain separate from bridge restart. It requires explicit confirmation and must not be bound to `/reset`.

## Components

### Bridge control helper
A deterministic helper, `scripts/bridge-control.ps1`, supports:

```text
status
restart
stop
```

Responsibilities:
- Find bridge-owned processes for this repository.
- Stop only matching bridge-owned Node processes.
- Start the bridge through the existing `scripts/start-bridge.ps1` path.
- Preserve logs.
- Avoid deleting repo/stateRoot data.

### Restart intent file
A small JSON file records a pending restart/status notification. Suggested location: `logs/bridge-control-intent.json` or another runtime-safe path already ignored by git.

Fields:
- `type`: `restart`
- `origin`: `telegram`
- `chatId`
- `requestedAt`
- `reason`
- `notifyOnStartup`: `true`

### Startup status notifier
During bridge startup, after bot initialization succeeds, the bridge sends a status message to the configured/latest authorized chat when either:
- a restart intent requests notification, or
- startup notifications are enabled by config.

The startup status should include:
- bridge active status
- process PID
- project id/path if known
- Pi/orchestrator session state
- Idu-pi session state
- Telegram command count
- startup origin: manual, scheduled-task, reset, unknown
- timestamp

## Data Flow

```text
Telegram /reset
  -> bridge handler validates authorized user
  -> bridge replies "restart requested"
  -> bridge writes restart intent
  -> bridge launches detached bridge-control restart
  -> helper stops old bridge-owned process
  -> helper starts scripts/start-bridge.ps1
  -> new bridge initializes Telegram bot
  -> startup notifier reads intent
  -> new bridge sends "Bridge active" status to chat
  -> intent is consumed/marked done
```

## Error Handling
- If helper launch fails, reply immediately with the failure and leave the bridge running.
- If startup notification cannot be sent, log the error and keep the bridge running.
- If no authorized chat is known, skip proactive startup message and expose the state in logs/status.
- If matching bridge processes cannot be safely identified, refuse to kill broad Pi/Node processes.

## Recovery Prompt Fallback
If deterministic restart fails, the project may expose a copyable recovery prompt for a human-controlled AI/orchestrator:

```text
Operational recovery task:
Repo: C:\Users\elmas\pi-telegram-bridge
Goal: restart only the Telegram bridge for this repo and verify Telegram startup status.
Constraints:
- Do not kill unrelated Pi/CLI sessions.
- Do not delete stateRoot, project files, reports, contracts, or repo files.
- Run scripts\stop-bridge.ps1.
- Run scripts\start-bridge.ps1.
- Verify a Telegram startup status was sent or report why not.
- Report PID, active project, Pi session status, Idu-pi status, and command count.
```

This fallback is documentation/recovery only, not the primary automated path.

## Testing
- Parser tests for `/reset`, `/server restart`, `/server run`, and `/server off` semantics.
- Unit tests for bridge-control process matching so unrelated Node/Pi processes are not targeted.
- Unit tests for startup status formatting.
- Unit tests for restart intent persistence/consumption.
- Integration-style test that simulates restart intent on startup and verifies Telegram notification payload without sending real Telegram messages.

## Non-Goals
- No destructive Idu-pi project state reset via `/reset`.
- No broad process killing.
- No automatic AgentLab execution.
- No dependency update.
- No claim that Telegram can start a bridge that is already stopped unless a watchdog/scheduled task is configured.

## Rollout
1. Add startup status notifier first.
2. Add deterministic bridge-control helper and intent file.
3. Wire `/reset` and `/server restart` to request restart.
4. Clarify `/server run` and `/server off` messages.
5. Optionally add watchdog/scheduled-task mode later.
