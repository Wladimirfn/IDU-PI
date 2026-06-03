# Supervisor Activity Telemetry Design

## Goal

Measure Idu-pi supervisor work as a first-class local signal, separate from CLI/MCP/TUI calls to Idu-pi tools.

The supervisor is a core pillar. Its work must be visible without pretending that orchestrator-requested tool calls are autonomous supervisor activity.

## Non-goals

- No remote analytics.
- No token, cost, or context percentage estimates.
- No prompts, full user text, secrets, env, headers, tokens, or raw task text in telemetry.
- No AgentLabs execution.
- No contract promotion.
- No fake autonomy: manual ticks and runtime hooks must be labeled by origin.

## Storage

Use a separate local JSONL file under project stateRoot:

```text
<stateRoot>/reports/idu-supervisor-activity-events.jsonl
```

This must not share `idu-usage-events.jsonl`, because usage calls and supervisor work answer different questions.

## Event model

Each event is safe, structured, and bounded:

```ts
type SupervisorActivityOrigin =
  | "supervisor_auto_hook"
  | "supervisor_manual_tick"
  | "tui_user_action"
  | "pi_runtime_event"
  | "orchestrator_requested";

type SupervisorActivityEventType =
  | "supervisor_hook"
  | "supervisor_tick"
  | "supervisor_cron_plan";
```

Minimum event fields:

```ts
{
  version: 1,
  id: string,
  timestamp: string,
  projectId: string,
  eventType: SupervisorActivityEventType,
  origin: SupervisorActivityOrigin,
  trigger: IduSupervisorTrigger,
  status: "completed" | "skipped" | "warning" | "planned",
  reason?: "idu_inactive" | "no_new_events" | "throttled" | "supervisor_failed" | "not_enough_data",
  active?: boolean,
  bypassedThrottle?: boolean,
  dryRun?: boolean,
  planMode?: boolean,
  stepCounts?: Record<IduSupervisorStepStatus, number>,
  createdTasks?: number,
  auditRunRecorded?: boolean,
  semanticDraftCreated?: boolean,
  agentTaskPlanBuilt?: boolean,
  durationMs?: number,
  ok?: boolean
}
```

Only booleans, counts, enum labels, and sanitized labels are allowed. Store booleans like `semanticDraftCreated`, not full paths.

## Report model

Supervisor activity reports should show:

```text
Actividad supervisor local
hooks automáticos: N
ticks manuales: N
cron plans: N
por origen: ...
por trigger: ...
skips/throttles: ...
auditorías registradas: N
drafts semánticos: N
tareas propuestas: N
tokens supervisor: no medido
% contexto supervisor: no medido
```

## Instrumentation points

### Automatic hooks

`src/idu-supervisor-hooks.ts` should emit one `supervisor_hook` event for each terminal hook result:

- `completed`
- `skipped`
- `warning`

Origin: `supervisor_auto_hook`.

### Manual supervisor tick

`idu-supervisor-tick` in `src/cli.ts` should emit one `supervisor_tick` event.

Origin: `supervisor_manual_tick`.

Manual ticks are supervisor activity, but not autonomous activity.

### Cron planning

Cron planning remains advisory-only. Do not add runtime cron telemetry until there is a real scheduler/runtime caller.

## Panel integration

The project panel may show a separate `Actividad supervisor local` block near `Uso local`.

Do not remove `llamadas Idu-pi`; it still measures tool usage. Do not count supervisor activity as Idu-pi calls.

## Safety rules

- Writes are best-effort and local-only.
- Telemetry failure must not block supervisor hooks or ticks.
- Do not record raw recommendations if they may contain free text.
- Do not record prompt/user/task content.
- Do not store absolute file paths from loop results.
