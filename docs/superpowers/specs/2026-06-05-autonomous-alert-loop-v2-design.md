# Autonomous Alert Loop v2 Design

## Goal
Make Autonomous Alert Engine v1 visible and runnable through normal user/orchestrator surfaces, then move toward a safe self-running loop. V2 must add CLI/Telegram visibility and controls, define safe scheduled execution, and expand alert domains without pretending Idu-pi has intelligence it has not earned yet.

## Raw Honesty
The uncomfortable truth: v1 can evaluate alerts and create capped tasks through MCP, but it is not yet a truly self-running system. MCP is ahead of CLI/Telegram, and domain names such as `security`, `db`, and `optimization` are not yet backed by rich first-class signal sources beyond task text/self-maintenance evidence.

V2 must state these limitations directly in reports and docs:

- alert status/tick exists in MCP first;
- CLI/Telegram are visibility/control surfaces, not separate engines;
- scheduler must not create task spam;
- security/DB/dependency/news claims require allowlisted evidence;
- automatic dependency updates, AgentLabs, rules, skills, contracts, and code changes remain forbidden.

## Authority Model
Allowed:

- expose alert status through CLI and Telegram;
- expose alert control commands for enable/disable/pause/resume/domain toggles;
- run read-only ticks through CLI/Telegram by default;
- define safe scheduled tick behavior;
- add richer advisory domains with bounded task drafts or human escalations;
- write alert control/ledger only under `stateRoot/reports`.

Forbidden:

- no automatic code implementation;
- no automatic AgentLabs;
- no automatic dependency update/download;
- no broad web/news search;
- no rule/skill/contract promotion;
- no remote menu button that creates tasks without confirmation;
- no scheduler that runs when Idu is inactive or alerts are paused.

## V2 Scope
V2 is split into four safe slices.

### Slice 1: CLI visibility/control
Add CLI commands that wrap the existing alert engine/MCP-equivalent behavior:

```text
idu-pi alerts status
idu-pi alerts tick
idu-pi alerts tick --allow-task-creation
idu-pi alerts control enable|disable|pause|resume|disable-domain|enable-domain
```

Defaults:

- `status`: read-only;
- `tick`: `allowTaskCreation=false` unless explicit flag;
- `control`: stateRoot-only write;
- all outputs include raw honesty summary and safe notes.

### Slice 2: Telegram visibility/control
Add Telegram commands:

```text
/idu_alerts_status
/idu_alerts_tick
/idu_alerts_pause
/idu_alerts_resume
/idu_alerts_off
/idu_alerts_on
```

Defaults:

- `/idu_alerts_tick` is read-only by default;
- no Telegram command should create tasks unless a later explicit confirmation flow is designed;
- output must be compact and raw-honest: active/paused, decisions, human escalations, tasks created if any, unsafe actions forbidden.

### Slice 3: Safe scheduled tick
Do not add an always-on uncontrolled daemon in v2. Use a safe scheduler adapter pattern:

- scheduled tick runs only if Idu session is active;
- alert control state is active and not paused;
- throttle/cooldown suppresses repeats;
- default scheduled tick uses `allowTaskCreation=false`;
- task creation from scheduled ticks requires explicit config/flag in a later slice;
- failures are warnings and must not block Telegram/bridge flow.

V2 can implement a safe cron-plan/report surface first:

```text
idu-pi alerts cron-plan
```

or MCP/CLI equivalent that says what would run and why. If an actual process interval is added later, it must have a separate design because multi-instance bridge processes can duplicate work.

### Slice 4: Richer domains, evidence-first
Expand domains only where evidence exists.

Initial domain enrichments:

- `bibliotecario`: source required actions, stale source digest/index, local source recommendations;
- `security`: security task text, external source registry security recommendations, npm advisory report status when available;
- `db`: DB/schema/data task text, semantic/lab DB evidence, source registry database recommendations;
- `optimization`: stale optimization/performance/context-pressure tasks or lack of recent optimization review;
- `version_source`: allowlisted external intelligence metadata for Node/Next/npm advisory status.

Raw honesty requirement:

- if npm advisories are skipped/unavailable, report that directly;
- if no live source was fetched, say registry-only/no-fetch;
- if security/DB signal is only task-text evidence, mark confidence lower;
- high-risk domains default to `ask_human`, not task creation.

## Data Flow

```text
CLI/Telegram/MCP
  -> shared alert runtime helper
  -> read stateRoot control/ledger
  -> read self-maintenance/source/external signals
  -> buildAutonomousAlertEngineReport()
  -> render compact CLI/Telegram text or JSON envelope
  -> optional stateRoot-only control write
  -> optional capped task creation only when explicitly allowed
```

## Files Likely Touched

- `src/cli.ts` — add CLI commands/runtime wrappers.
- `src/command-catalog.ts` — add CLI/Telegram command metadata.
- `src/telegram-command-registry.ts` — allowlist Telegram commands.
- `src/index.ts` — add Telegram handlers.
- `src/remote-menu.ts` — later optional buttons for status/pause/resume only.
- `src/autonomous-alert-engine.ts` — domain expansion.
- `src/mcp-server.ts` — possible helper extraction if shared with CLI/Telegram.
- Tests under `test/*` for CLI, command catalog, Telegram registry/UI, alert engine, MCP parity.

## Acceptance Criteria

- CLI can show alert status and run read-only tick.
- CLI can enable/disable/pause/resume/toggle domains via stateRoot-only control state.
- Telegram can show compact alert status and read-only tick.
- Telegram can pause/resume/off/on alerts without code/dependency/AgentLab changes.
- Scheduled behavior is defined safely and does not create tasks automatically in v2 unless explicitly approved later.
- Richer domains are evidence-first and raw-honest about weak/missing coverage.
- Full verification and fresh reviewer pass before push.

## Non-Goals

- No uncontrolled daemon.
- No dependency update automation.
- No arbitrary news/web crawler.
- No Telegram task-creation button.
- No AgentLabs auto-run.
- No rule/skill/contract mutation.
