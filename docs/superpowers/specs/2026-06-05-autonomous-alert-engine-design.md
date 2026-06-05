# Autonomous Alert Engine v1 Design

## Goal
Make Idu-pi a living project supervisor that turns the approved Master Plan and captured project signals into bounded micro-tasks, warnings, and escalation decisions without waiting for a human prompt every time.

The engine must close the macro-to-micro loop:

```text
Master Plan
  -> captured signals
  -> alert rules and cooldowns
  -> alert decisions
  -> micro-tasks or human escalations
  -> evidence and review
  -> updated project awareness
```

## Master Plan Alignment
Idu-pi is a supervisor/auditor for the orchestrator. A real supervisor must not only answer when called; it must notice repeated drift, forgotten work, stale domains, ecosystem changes, and risk signals. The engine exists to keep the project centered when both human and AI lose focus.

This design extends the completed self-maintenance advisory. The advisory builder detects pressure. The alert engine decides whether that pressure should become:

- a routine low/medium-risk task;
- a paused/snoozed alert;
- a human escalation;
- a report-only warning.

## Raw Honesty Contract
Idu-pi must practice explicit raw honesty. This is not a tone preference; it is an output contract.

Every alert report must include direct evidence-first truths when the system detects drift, weak evidence, repeated failures, or missing coverage. It must not soften serious issues into vague summaries.

```ts
type RawHonestyFields = {
  rawHonesty: true;
  uncomfortableTruths: Array<{
    claim: string;
    evidenceRefs: string[];
    impact: string;
    requiredNext: string;
    omittedComfort?: string;
  }>;
};
```

Examples:

- "External ecosystem coverage is weak: npm advisories are currently limited/skipped by allowlist behavior. Do not claim full dependency-risk awareness."
- "Backlog pressure is real: tasks are accumulating faster than they are closed. Creating more tasks without pruning will make the supervisor noisy."
- "The same bug pattern appeared four times. Treating it as separate incidents is evidence of process failure, not progress."
- "No completed optimization review was recorded recently. Resource efficiency is being assumed, not proven."

Rules:

- Raw honesty must be backed by `evidenceRefs`.
- It must be concise and actionable.
- It must not expose raw prompt/chat text or secrets.
- It must not bother the human with trivial routine facts.
- It must escalate uncomfortable high-impact facts plainly.

## Authority Model
The engine is autonomous in detection and routine task proposal/creation only. It is not autonomous remediation.

Allowed without asking the human every time:

- read bounded stateRoot signals;
- evaluate thresholds and cooldowns;
- create routine low/medium-risk structured tasks with evidence;
- deduplicate and cap alert-created tasks;
- record alert decisions under stateRoot;
- pause/snooze/stop alerts when configured;
- recommend Bibliotecario, security, DB, optimization, bug, or backlog review tasks.

Human escalation required:

- core architecture changes;
- security-sensitive changes;
- DB/schema/data migration changes;
- dependency downloads/updates or broad external fetches;
- rule, contract, skill, or Master Plan promotion;
- AgentLab execution;
- high-risk loops or large implementation batches;
- anything with cost, credentials, secrets, or production impact.

Forbidden in v1:

- no automatic code implementation;
- no automatic AgentLab run;
- no automatic dependency update;
- no arbitrary web/news search;
- no automatic rule/contract/skill modification;
- no deletion of repo/stateRoot data;
- no bypass of Idu inactive/off state.

## Stop and Pause Controls
The user must be able to stop the loop.

V1 needs a dedicated alert-control state, separate from full Idu deactivation:

```ts
type AlertEngineControlState = {
  version: 1;
  active: boolean;
  pausedUntil?: string;
  disabledDomains: string[];
  reason?: string;
  updatedAt: string;
};
```

Required controls:

- global off/on;
- pause until timestamp or duration;
- disable one domain, e.g. `bibliotecario`, `security`, `db`, `optimization`;
- alert tick must do nothing when inactive or paused;
- `idu_off` remains a stronger global stop because guardrails are inactive.

## Inputs
V1 reads only bounded, existing, safe surfaces:

- structured task queue;
- supervisor self-maintenance advisory;
- supervisor activity events;
- usage events;
- AgentLab effectiveness events;
- semantic audit status;
- source library/digest status;
- external intelligence report metadata and allowlisted source registry;
- Idu session active/inactive state;
- approved Master Plan snapshot.

V1 must not depend on raw chat history or raw prompt content.

## Alert Domains

### Repeated bug loop
Trigger when similar bug/failure language appears at least 4 times across open/recent tasks or failure telemetry.

Default action:
- create a routine task to investigate the pattern and add/verify a regression test.

Escalate to human if:
- the pattern touches security, DB/schema, auth, contracts, or core orchestration.

### Backlog and stale work loop
Trigger when open tasks, stale running tasks, guarded tasks, or failed tasks exceed thresholds.

Default action:
- create backlog pruning or stale task cleanup task.

Escalate to human if:
- backlog is caused by high-risk guarded tasks or blocked governance decisions.

### Neglected area loop
Trigger when an area appears repeatedly in tasks/signals but has weak completion evidence.

Initial areas:
- Telegram;
- Bibliotecario;
- security;
- DB/data;
- optimization/resources;
- context pressure;
- AgentLab;
- tests.

Default action:
- create a focused area review task.

### Bibliotecario/version loop
Trigger on schedule or stale source intelligence.

Initial cadence examples:
- every 3 days: review registered local/source-library recommendations;
- every 3 days: check allowlisted ecosystem source recommendations;
- every 2 days: inspect npm/security advisory source status if available.

Default action:
- create a Bibliotecario review task that uses only allowlisted/registered sources.

Escalate to human if:
- a dependency update/download is needed;
- the source requires broad web search;
- the evidence says a vulnerability affects the project.

### Security and DB review staleness loop
Trigger when no recent security or DB review evidence exists while related files/tasks/signals exist.

Default action:
- create a review task.

Escalate to human if:
- schema/auth/security changes are proposed.

### Optimization staleness loop
Trigger when no resource/performance/context optimization review has happened within the configured window.

Default action:
- create a bounded optimization audit task.

## Alert Decision Contract

```ts
type AutonomousAlertDecision = {
  version: 1;
  id: string;
  generatedAt: string;
  projectId: string;
  authority: "advisory";
  domain:
    | "repeated_bug"
    | "backlog"
    | "stale_work"
    | "neglected_area"
    | "bibliotecario"
    | "security"
    | "db"
    | "optimization"
    | "semantic_audit"
    | "agentlab";
  severity: "info" | "warning" | "high";
  confidence: number;
  evidenceRefs: string[];
  rawHonesty: true;
  uncomfortableTruths: Array<{
    claim: string;
    evidenceRefs: string[];
    impact: string;
    requiredNext: string;
    omittedComfort?: string;
  }>;
  recommendedAction:
    | "create_task"
    | "report_only"
    | "ask_human"
    | "snooze"
    | "blocked_by_pause";
  taskDraft?: {
    text: string;
    category: "bug" | "feature" | "review" | "docs" | "maintenance";
    priority: number;
    guardRisk: "low" | "medium" | "high";
    evidenceRefs: string[];
  };
  cooldownKey: string;
  cooldownUntil?: string;
  requiresHuman: boolean;
  forbiddenActions: string[];
};
```

## Alert Report Contract

```ts
type AutonomousAlertEngineReport = {
  version: 1;
  authority: "advisory";
  mode: "autonomous_detection";
  generatedAt: string;
  projectId: string;
  active: boolean;
  paused: boolean;
  noImplementation: true;
  agentLabsExecuted: false;
  rulesApplied: false;
  skillsModified: false;
  contractsModified: false;
  dependenciesUpdated: false;
  rawHonesty: true;
  uncomfortableTruths: RawHonestyFields["uncomfortableTruths"];
  decisions: AutonomousAlertDecision[];
  tasksCreated: Array<{ taskId: string; alertId: string; evidenceRefs: string[] }>;
  humanEscalations: AutonomousAlertDecision[];
  suppressedByCooldown: AutonomousAlertDecision[];
  safeNotes: string[];
};
```

## State and Deduplication
V1 needs a small stateRoot-only alert ledger:

```text
reports/autonomous-alert-engine-state.json
reports/autonomous-alert-decisions.jsonl
```

State must track:

- last alert per cooldown key;
- active/pause/domain disable controls;
- task ids created by alert id;
- acknowledged/snoozed alerts;
- last tick summary.

Task creation must be capped:

- maximum tasks per tick: default 3;
- maximum task per domain per cooldown window: default 1;
- no duplicate task if an open task already contains the same alert id/cooldown key/evidence.

## MCP Surface
Add advisory-first tools:

```text
idu_autonomous_alerts_status
idu_autonomous_alerts_tick
idu_autonomous_alerts_control
```

### `idu_autonomous_alerts_status`
Read-only. Shows control state, latest decisions, cooldowns, and raw honesty summary. No task creation.

### `idu_autonomous_alerts_tick`
Evaluates rules and may create low/medium-risk structured tasks only when:

- Idu is active;
- alert engine is active;
- not paused;
- cooldown allows it;
- task risk is not high;
- task is capped and deduplicated;
- `allowTaskCreation` is true.

It must never implement, run AgentLabs, update dependencies, mutate rules/skills/contracts, or promote docs.

### `idu_autonomous_alerts_control`
Allows safe control state writes:

- `enable`;
- `disable`;
- `pause`;
- `resume`;
- `disable_domain`;
- `enable_domain`.

This is a stateRoot-only governance write, not a repo write.

## CLI / Telegram Surface
Later or same implementation if small:

```text
idu-pi alerts status
idu-pi alerts tick --allow-task-creation
idu-pi alerts pause 24h
idu-pi alerts off
```

Telegram may expose compact status/control buttons later, but v1 should prioritize MCP/CLI correctness.

## Testing
Required tests:

- status is read-only and returns raw honesty fields;
- tick does nothing when Idu is inactive;
- tick does nothing when alert engine is paused;
- repeated bug threshold creates one low/medium task and records evidence;
- cooldown suppresses duplicate tasks;
- high-risk/security/DB/core alert escalates to human and creates no task;
- Bibliotecario stale check creates only an allowlisted review task;
- report safe flags remain false for AgentLabs/rules/skills/contracts/dependencies;
- control tool writes only stateRoot control state;
- existing `context.md` local-only noise is not staged or committed.

## Rollout Plan
1. Design/spec and plan.
2. Pure alert engine builder and tests.
3. State ledger/control module and tests.
4. MCP `status` and `tick` with task creation capped and deduped.
5. MCP `control` for stop/pause/domain disable.
6. Fresh reviewer and full verification.
7. Later slices: CLI/Telegram surfacing, richer Bibliotecario cadence, scheduler integration.

## Non-Goals for v1
- No daemon scheduler inside the bridge unless separately designed.
- No arbitrary web intelligence.
- No automatic dependency updates.
- No automatic AgentLabs.
- No automatic code changes.
- No infinite implementation loop without review evidence.

## Acceptance Criteria
- Idu-pi can evaluate autonomous alert conditions without a fresh user prompt.
- Idu-pi can create routine low/medium-risk micro-tasks under strict caps.
- Idu-pi escalates high-risk/core/security/DB/dependency/contract/skill/rule changes to the human.
- Idu-pi has explicit stop/pause controls.
- Reports include raw honesty fields and uncomfortable evidence-first truths.
- All outputs are JSON-first, bounded, and safe.
- Full build/test/postflight/reviewer evidence passes before push.
