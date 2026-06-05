# Autonomous Alert Loop v3 — Native Objective Alignment and OS-Priority Scheduler

## Status

Design approved by user direction on 2026-06-05.

## Purpose

Autonomous Alert Loop v3 makes Idu-pi run its supervisor/auditor loop on a real schedule without losing the core project objective. The system must not become Telegram-centric: Telegram is only an optional remote control surface. Idu-pi must work through core state, CLI, MCP, and the Pi orchestrator whether Telegram exists or not.

Plan Maestro objective anchor:

> Idu-pi is a supervisor/auditor for the Pi orchestrator. It turns human intent, documentation, sources, and repository evidence into a Master Plan, contracts, risks, recommended audit-only AgentLabs, and safe execution checklists.

## Non-goals

- No in-process bridge interval enabled in this slice.
- No uncontrolled daemon.
- No automatic AgentLabs.
- No dependency update automation.
- No rule, skill, contract, or Master Plan promotion.
- No Telegram dependency for scheduled execution.
- No writes outside `stateRoot`.

## Architecture

### 1. Native objective cache

Add a small native module that stores a compact Master Plan alignment snapshot under `stateRoot/reports`. It exists so scheduled/autonomous code can re-anchor itself without loading long docs or relying on conversational memory.

The snapshot contains only bounded governance fields:

- project id/path;
- plan status and whether the plan is approved;
- objective;
- short summary;
- relevant contracts/flow names when available;
- blockers/risks summary;
- generated time and expiry time;
- `advisoryOnly: true`.

The cache is refreshed with a TTL, defaulting to one hour. Scheduled execution reads the cache and refreshes it when stale. If the plan is missing, stale, blocked, or not approved, the scheduled executor returns a safe `blocked`/`skipped` result instead of creating tasks.

### 2. Single scheduled executor

Create one core executor for scheduled autonomous alerts. CLI and future bridge integration call the same executor; no surface gets its own divergent tick logic.

Executor inputs:

- `projectPath` or resolved project runtime;
- `allowTaskCreation`, default `false`;
- scheduler source, e.g. `os_scheduler`, `manual_cli`, or future `bridge_interval`;
- clock for deterministic tests.

Executor steps:

1. Resolve registered project and safe `stateRoot`.
2. Check Idu active/session state.
3. Read alert control state: active/off, pause, disabled domains.
4. Acquire scheduler lock/lease.
5. Load or refresh objective cache.
6. Run the existing alert engine through the same decision path used by CLI/MCP.
7. Create capped tasks only when explicitly allowed and not blocked by protected domains.
8. Persist evidence under `stateRoot/reports`.
9. Release/expire lock safely.

### 3. Lock, lease, and idempotency

A scheduler state file under `stateRoot/reports` tracks:

- current lock owner;
- lock acquisition time;
- lock expiry time;
- last run time;
- last result summary;
- decision ids already materialized into tasks.

The lock is a lease, not a permanent mutex. If a process dies, another run may acquire it after expiry. If another process is already inside the lease window, the executor returns `skipped_locked` without running the alert engine.

Task idempotency uses decision identity/cooldown key before task creation. A decision that already has a created task id must not create another task even if two schedulers race or retry.

### 4. OS-priority scheduling

This slice enables an OS-friendly command path first, for example:

```text
idu-pi alerts scheduled-tick
```

The command calls the single scheduled executor. It does not require Telegram. It defaults to read-only unless an explicit flag enables task creation.

Windows Task Scheduler support may be added as a script or documented command. It should use OS-level duplicate protection such as `MultipleInstances IgnoreNew`, but the internal lock remains mandatory because OS configuration alone is not enough.

### 5. Bridge interval designed but off

The bridge may later call the same executor from an interval, but v3 does not enable that interval. This prevents hidden duplication across multiple bridge processes and keeps the first real autonomous path inspectable through OS scheduler and CLI.

### 6. Telegram accessory audit

After implementation, run an explicit audit proving:

- core executor imports do not depend on Telegram entrypoint;
- CLI/MCP scheduled execution works without Telegram;
- Telegram handlers only call/control existing core surfaces;
- disabling or removing Telegram startup does not disable Idu-pi core scheduling paths.

## Safety Rules

- Read-only default: scheduled tick must not create tasks unless explicit task creation is enabled.
- Human escalation for security, DB, dependency, core, rule, skill, contract, or AgentLab actions.
- Protected-domain decisions never become routine tasks.
- All scheduler state, objective cache, decision logs, and evidence stay under `stateRoot/reports`.
- Scheduled execution must include raw honesty: if coverage is partial, the report says so.
- AgentLabs remain audit-only and explicit-run only.

## Testing Strategy

- Objective cache tests:
  - creates bounded cache under stateRoot;
  - refreshes when TTL expires;
  - blocks when plan is not approved or objective is missing;
  - never writes repo files.
- Scheduler state tests:
  - lock acquisition and locked skip;
  - expired lease recovery;
  - idempotent created task mapping.
- Scheduled executor tests:
  - inactive Idu skips;
  - paused/off alerts skip;
  - default run is read-only;
  - explicit task creation creates capped routine tasks;
  - protected security/db decisions ask human and do not create tasks;
  - objective cache is consulted before decisions.
- CLI tests:
  - `alerts scheduled-tick` calls executor;
  - no Telegram requirement.
- Audit tests:
  - scheduled executor module does not import Telegram entrypoint;
  - existing MCP source remains free of Telegram entrypoint imports.

## Acceptance Criteria

- Idu-pi has a native cached objective snapshot for autonomous/scheduled work.
- A single scheduled executor exists and is callable from CLI.
- OS-priority scheduled execution is available without Telegram.
- Duplicate protection exists through lock/lease and decision-to-task idempotency.
- Bridge interval is documented/designed but not enabled.
- Default scheduled tick is read-only.
- Full verification passes.
- Fresh reviewer confirms Telegram remains accessory-only.
